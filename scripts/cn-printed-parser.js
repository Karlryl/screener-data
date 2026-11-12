'use strict';

// Pure text parser. No I/O, no vendor-growth matching, no fallback to another income line.
// pdftotext -layout may lose the Chinese glyphs. Two independent amount anchors identify
// the operating-revenue row and its scale; column geometry is only used AFTER both match.
const VERSION = 'cn-q3-layout-v2';
const finite = Number.isFinite;
const amountPattern = /^-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/;
const epsilon = n => Math.max(1e-7, Math.abs(n) * Number.EPSILON * 8);
const half = s => 0.5 * 10 ** -(s.split('.')[1]?.length || 0);
const number = s => Number(s.replace(/,/g, '').replace(/%$/, ''));
const inside = (v, lo, hi) => finite(v) && v >= lo - epsilon(lo) && v <= hi + epsilon(hi);

function eastmoneyAnchor(store, ticker, year = 2026) {
  if (store?.market !== 'CN' || store.currency !== 'CNY' || store.unit !== 1) return null;
  const c = store.companies?.[ticker];
  const nine = c?.ytd?.[year + '-09-30']?.at(-1);
  const six = c?.ytd?.[year + '-06-30']?.at(-1);
  if (!nine || !six || nine.reportType !== '三季报' || six.reportType !== '中报' || nine.table !== six.table) return null;
  if (!finite(nine.operate) || !finite(six.operate)) return null;
  const current = nine.operate - six.operate;
  if (current <= 0 || nine.operate <= 0) return null;
  return { current, ytd: nine.operate, line: 'operate', printedLine: '营业收入',
    vendorLine: 'OPERATE_INCOME', table: nine.table, periodEnd: year + '-09-30',
    operands: { nine: nine.operate, six: six.operate },
    confirmations: { nine: nine.confirmedBy || [], six: six.confirmedBy || [] } };
}

function tokensOf(lines, extended = false) {
  const tokens = [];
  lines.forEach((line, row) => {
    for (const m of line.matchAll(/-?[\d,]+(?:\.\d+)?%?/g)) {
      tokens.push({ raw: m[0], row, endRow: row, x: m.index, end: m.index + m[0].length });
    }
  });
  const amounts = tokens.filter(t => amountPattern.test(t.raw));
  // Split cells in the 8-column restatement table: a comma-group fragment, then the
  // remaining digits in the SAME column on one of the next two physical text lines.
  for (const a of tokens.filter(t => t.raw.includes(',') && !t.raw.includes('.') && !t.raw.endsWith('%'))) {
    const candidates = tokens.filter(b => b.row > a.row && b.row <= a.row + 2 && b.x >= a.x &&
      b.x <= a.end && b.end <= a.end + 3 && (extended ? /^[\d,]+\.\d{2}$/ : /^,?\d+(?:\.\d{2})$/).test(b.raw) && amountPattern.test(a.raw + b.raw));
    if (candidates.length !== 1) continue;
    const b = candidates[0];
    if (tokens.some(t => t !== a && t !== b && t.row > a.row && t.row < b.row && t.x < b.end && t.end > a.x)) continue;
    amounts.push({ ...a, raw: a.raw + b.raw, end: Math.max(a.end, b.end), endRow: b.row, wrapped: true });
  }
  return { tokens, amounts: amounts.filter(a => a.wrapped || !amounts.some(w => w.wrapped && w.row === a.row && w.x === a.x)) };
}

function cell(t, unit) {
  return { printed: t.raw, value: number(t.raw) * unit, decimals: t.raw.split('.')[1]?.length || 0,
    roundingHalfWidth: half(t.raw) * unit };
}

function parseLayout(text, anchor, { ticker, year = 2026 } = {}, extended = false) {
  const gap = (reason, detail = {}) => ({ parseStatus: 'unparsed', reason, parserVersion: VERSION, ...detail });
  if (!anchor || !finite(anchor.current) || !finite(anchor.ytd) || anchor.line !== 'operate') return gap('operating-revenue-anchor-missing');
  if (typeof text !== 'string' || !text.trim()) return gap('text-empty');
  // The supplied extraction is pages 1-4; some reports put the main table on page 3.
  // Repeated anchors, including income-statement matches, are refused as ambiguous.
  const lines = text.replace(/\r/g, '').split('\f').slice(0, 4).join('\f').split('\n').slice(0, 180);
  // Match a WHOLE digit run, never a code embedded in an account/amount. Observed
  // co-listings append one 5/6-digit code, or a 5-digit and a 6-digit code.
  if (ticker && !new RegExp('(^|\\D)' + ticker.slice(0, 6) +
    (extended ? '(?:\\d{5}|\\d{6}|\\d{11})?' : '') + '(\\D|$)').test(lines.slice(0, 20).join('\n'))) return gap('security-code-not-in-header');
  if (!new RegExp('\\b' + year + '\\b').test(lines.slice(0, 20).join('\n'))) return gap('report-year-not-in-header');
  const { tokens, amounts } = tokensOf(lines, extended);
  const anchors = [];
  for (const unit of extended ? [1, 1000, 10000, 1000000] : [1, 1000, 10000]) {
    const matches = (t, v) => inside(v, number(t.raw) * unit - half(t.raw) * unit, number(t.raw) * unit + half(t.raw) * unit);
    for (const q of amounts.filter(t => matches(t, anchor.current))) {
      for (const y of amounts.filter(t => matches(t, anchor.ytd) && t.x > q.end + 3 && Math.abs(t.row - q.row) <= 8)) {
        anchors.push({ q, y, unit });
      }
    }
  }
  if (anchors.length !== 1) return gap(anchors.length ? 'ambiguous-revenue-anchors' : 'revenue-or-ytd-anchor-mismatch');
  const { q, y, unit } = anchors[0];
  const lo = Math.max(0, Math.min(q.row, y.row) - 6), hi = Math.max(q.endRow, y.endRow) + 8;
  if (lines.slice(lo, hi + 1).some(l => /营业总收入/.test(l))) return gap('total-revenue-label-not-supported');
  // The first amount in both value columns must be the anchored revenue cell. A later
  // accidental value match (e.g. profit) cannot be used as the row anchor.
  if (amounts.some(t => t.row >= lo && t.row < q.row && t.x <= q.end && t.end >= q.x) ||
      amounts.some(t => t.row >= lo && t.row < y.row && t.x <= y.end && t.end >= y.x)) return gap('not-first-revenue-row');
  // A profit amount/growth on a later row is not a revenue prior column. For
  // staggered restatements, the first two prior columns may precede/follow Q3.
  const nextQ = Math.min(...amounts.filter(t => t.row > q.endRow && t.x <= q.end && t.end >= q.x).map(t => t.row));
  const middle = amounts.filter(t => t.row >= (extended ? lo : q.row - 1) &&
    t.row <= (extended ? Math.max(q.row, y.row) : q.row + 3) &&
    (!extended || t.row < nextQ || t.row === y.row) && t.x > q.end && t.end < y.x);
  const firstRow = Math.min(...middle.map(t => t.row));
  const prior = middle.filter(t => t.row === firstRow).sort((a, b) => a.x - b.x);
  const singlePrior = extended && prior.length === 1 &&
    new RegExp((year - 1) + '\\s+7-9').test(lines.slice(lo, q.row).join('\n')) &&
    new RegExp((year - 1) + '\\s+1-9').test(lines.slice(lo, q.row).join('\n'));
  if (prior.length !== 0 && prior.length !== 2 && !singlePrior) return gap('unknown-prior-column-layout');
  const restated = prior.length === 2;
  const left = prior.length ? prior.at(-1).end : q.end;
  const percentHeader = extended && lines.slice(lo, Math.min(q.row, y.row) + 1)
    .some(l => /^\s*\(?%\)?\s*$/.test(l.slice(left, y.x)));
  const growthTokens = tokens.filter(t => t.row >= lo && t.row <= hi && t.x >= left && t.end <= y.x &&
    /^-?\d{1,3}(?:,\d{3})*\.\d{1,2}%?$/.test(t.raw) && (!ticker?.endsWith('.SZ') || t.raw.endsWith('%') || percentHeader) &&
    !amounts.some(a => a.wrapped && t.row >= a.row && t.row <= a.endRow && t.x >= a.x && t.end <= a.end));
  if (!growthTokens.length) return gap('growth-column-missing');
  const g = growthTokens[0];
  if (lines.slice(lo, g.row + 1).some(l => /--|不适用/.test(l.slice(left, y.x)))) return gap('growth-column-missing-marker');
  if (growthTokens.some(t => t !== g && t.row === g.row)) return gap('ambiguous-growth-column');
  if (!restated && g.row > q.row + 5) return gap('unknown-growth-offset');
  if (restated || singlePrior) {
    const yp = amounts.filter(t => t.row >= y.row && t.row <= y.row + 5 && t.x > y.end);
    const yf = Math.min(...yp.map(t => t.row));
    if (yp.filter(t => t.row === yf).length !== prior.length) return gap('unknown-restatement-ytd-layout');
  }
  const current = cell(q, unit), growth = { printed: g.raw, value: number(g.raw),
    decimals: g.raw.replace(/%$/, '').split('.')[1].length, roundingHalfWidth: half(g.raw.replace(/%$/, '')) };
  const priorValues = prior.length ? { before: singlePrior ? null : cell(prior[0], unit), after: cell(prior.at(-1), unit) } : null;
  if (growth.value - growth.roundingHalfWidth <= -100) return gap('growth-denominator-nonpositive');
  if (priorValues) {
    const p = priorValues.after, a = current;
    if (p.value <= p.roundingHalfWidth) return gap('printed-prior-nonpositive');
    const gMin = ((a.value - a.roundingHalfWidth) / (p.value + p.roundingHalfWidth) - 1) * 100;
    const gMax = ((a.value + a.roundingHalfWidth) / (p.value - p.roundingHalfWidth) - 1) * 100;
    if (gMin > growth.value + growth.roundingHalfWidth + 1e-8 || gMax < growth.value - growth.roundingHalfWidth - 1e-8) return gap('printed-prior-growth-inconsistent');
  }
  // New layouts retain the header/geometry evidence as well as the numeric row.
  const first = Math.min(q.row, y.row, g.row, ...prior.map(t => t.row), ...(extended ? [lo] : []));
  const last = Math.max(q.endRow, y.endRow, g.endRow, ...prior.map(t => t.endRow));
  const layout = singlePrior ? 'single-prior' : restated ? (q.wrapped ? 'restated-wrapped' : 'restated') :
    g.row < q.row ? 'growth-above' : g.row === q.row ? 'growth-inline' : 'growth-below';
  return { parseStatus: 'parsed', reason: null, parserVersion: VERSION, layout, unit,
    unitName: ({ 1: '元', 1000: '千元', 10000: '万元', 1000000: '百万元' })[unit],
    unitEvidence: 'scale-uniquely-matched-to-quarter-and-ytd-operating-revenue',
    rowLabel: '营业收入', rowEvidence: 'OPERATE_INCOME-quarter-and-ytd-value-anchors',
    current, ytd: cell(y, unit), growth, priorValues,
    quoteLines: lines.slice(first, last + 1).map((line, i) => ({ line: first + i + 1,
      page: 1 + lines.slice(0, first + i + 1).filter(l => l.includes('\f')).length, text: line })),
    anchor: { ...anchor } };
}

function parseText(text, anchor, options = {}) {
  const original = parseLayout(text, anchor, options);
  // Existing accepted observations retain their value, unit, growth and exact quote.
  // All identity, dual-anchor, first-row and rounding guards also run on new layouts.
  return original.parseStatus === 'parsed' ? original : parseLayout(text, anchor, options, true);
}

function comparable(parsed) {
  if (parsed?.parseStatus !== 'parsed') return null;
  const p = parsed.priorValues?.after;
  if (p) return { method: parsed.layout === 'single-prior' ? 'printed-prior' : 'printed-adjusted-prior', value: p.value,
    lower: p.value - p.roundingHalfWidth, upper: p.value + p.roundingHalfWidth };
  const c = parsed.current, g = parsed.growth;
  if (!c || !g || g.value - g.roundingHalfWidth <= -100) return null;
  return { method: 'inverted-printed-growth', value: c.value / (1 + g.value / 100),
    lower: (c.value - c.roundingHalfWidth) / (1 + (g.value + g.roundingHalfWidth) / 100),
    upper: (c.value + c.roundingHalfWidth) / (1 + (g.value - g.roundingHalfWidth) / 100) };
}

function compare(parsed, priorAnchor) {
  const band = comparable(parsed);
  if (!band) return { status: 'unparsed', reason: parsed?.reason || 'no-report', comparable: null };
  if (!priorAnchor) return { status: 'printed-only', reason: 'prior-eastmoney-operating-revenue-missing', comparable: band };
  return { status: inside(priorAnchor.current, band.lower, band.upper) ? 'agree' : 'mixed-basis',
    reason: null, comparable: band, eastmoneyPrior: priorAnchor.current, line: 'OPERATE_INCOME' };
}

module.exports = { VERSION, eastmoneyAnchor, parseText, comparable, compare };
