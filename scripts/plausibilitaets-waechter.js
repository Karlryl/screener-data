#!/usr/bin/env node
'use strict';
/**
 * Plausibility watcher (Daylauf 7, 24.10.2026): LISTS implausible board rows of the finished findash export.
 * WHY: on 22./23.10. a 14-helper workflow found 16 visible wrong numbers on the boards (provider zeros shown as
 * -100 % growth, annual pairs 91 days apart, market caps off by factor 5 after a split, duplicate issuers).
 * Every one of those classes is detectable mechanically; this script lists them each day.
 *
 * REPORTS ONLY: it changes no number, withholds nothing and never turns the run red. Exit 0 after a successful
 * write, also when the checks crash (then the file says status 'fehler'). Exit 1 only when even that write fails.
 *
 *   node scripts/plausibilitaets-waechter.js [--export <dir>] [--snapshots <dir>] [--board-history <dir>]
 *        [--out <file>] [--gestern <url|file>]
 *
 * Output: <export>/waechter/plausibilitaet.json. A SUBFOLDER on purpose: the daily count gate counts
 * outputs/findash-export/v1/*.json (no recursion), and the Pages deploy copies v1/ including subfolders.
 */
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../lib/atomic-write.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');
const { norm, jahresVergleichIdx } = require('../src/scoring/snapshot.js'); // read-only use of the one accessor

const ROOT = path.join(__dirname, '..');
const SCHEMA = 'plausibilitaets-waechter/v1';
const CAP = 200;
const GESTERN_URL = 'https://raw.githubusercontent.com/Karlryl/screener-data/gh-pages/outputs/findash-export/v1/waechter/plausibilitaet.json';
const CODES = ['wachstum-extrem', 'jahrespaar-abstand', 'quartalspaar-abstand', 'umsatz-null-mit-boersenwert',
  'quartal-gleich-vorjahr', 'boersenwert-sprung', 'kurs-alt', 'doppelte-firma', 'score-grenze'];
const SNAPSHOT_CODES = ['umsatz-null-mit-boersenwert', 'quartal-gleich-vorjahr', 'kurs-alt'];
const JAHR = new Set(['year', 'yearNewerRecord', 'ttm']);
const QUARTAL = new Set(['quarter', 'halfYear']); // halfYear: H1 vs prior-year H1, same one-year gap as a quarter pair
const BASIS_WORT = { quarter: 'Quartal', halfYear: 'Halbjahr', year: 'Geschäftsjahr', yearNewerRecord: 'Geschäftsjahr', ttm: 'Zwölfmonatszeitraum' };
// Legal-form words removed for the duplicate check. Deliberately looser than the engine's issuerKeyLoose
// (src/scoring/score.js): a watcher with the engine's own rule would only check itself.
const RECHTSFORMEN = new Set(['the', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited',
  'plc', 'ag', 'sa', 'se', 'nv', 'spa', 'ab', 'asa', 'oyj', 'llc', 'lp']);

const zahl = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const fmtPct = (x) => (x > 0 ? '+' : '') + zahl.format(x) + ' %';
const fmtMrd = (x) => zahl.format(x / 1e9) + ' Mrd. USD';
const isoTag = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) && Number.isFinite(Date.parse(d.slice(0, 10) + 'T00:00:00Z')) ? d.slice(0, 10) : null);
const datum = (d) => (isoTag(d) ? isoTag(d).split('-').reverse().join('.') : 'ohne Datum');
const tage = (a, b) => (isoTag(a) && isoTag(b) ? Math.round((Date.parse(isoTag(a)) - Date.parse(isoTag(b))) / 864e5) : null);
const posMcap = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
const imBereich = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Weekdays after `von` up to and including `bis`.
// ponytail: Mon-Fri without exchange holidays, so a holiday week counts one day too many; fine for a 5-day alarm.
function handelstage(von, bis) {
  let n = 0;
  for (let t = Date.parse(von + 'T00:00:00Z') + 864e5, end = Date.parse(bis + 'T00:00:00Z'); t <= end; t += 864e5) {
    const tag = new Date(t).getUTCDay();
    if (tag > 0 && tag < 6) n++;
  }
  return n;
}

function normName(name) {
  const roh = String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\./g, '').replace(/\s+(class|cl|series)\s+[a-z0-9]$/, '');
  return roh.split(/[^a-z0-9]+/).filter((w) => w && !RECHTSFORMEN.has(w)).join('');
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
function readJsonOrNull(p) { try { return readJson(p); } catch (_) { return null; } }

// Newest board-history vintage strictly before the export day: ticker -> marketCap (pit block, USD).
function vorigerStand(dir, exportTag) {
  if (!dir || !fs.existsSync(dir)) return null;
  const tag = fs.readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < exportTag).sort().pop();
  if (!tag) return null;
  const mcap = new Map();
  for (const f of fs.readdirSync(path.join(dir, tag)).filter((x) => x.endsWith('.json'))) {
    const v = readJsonOrNull(path.join(dir, tag, f));
    for (const r of [...(v?.cohort?.profitable || []), ...(v?.cohort?.unprofitable || [])]) {
      if (r && r.ticker && posMcap(r.pit?.marketCap)) mcap.set(r.ticker, r.pit.marketCap);
    }
  }
  return { tag, mcap };
}

async function ladeGestern(quelle) {
  try {
    let text;
    if (/^https?:\/\//.test(quelle)) {
      const res = await fetch(quelle, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      text = await res.text();
    } else text = fs.readFileSync(quelle, 'utf8');
    const alt = JSON.parse(text);
    if (alt.schema !== SCHEMA || !Array.isArray(alt.faelle)) throw new Error('kein Bericht dieses Wächters');
    return { alt };
  } catch (e) { return { alt: null, hinweis: `Bericht des Vortags nicht verfügbar (${e.message}); kein Vergleich mit gestern.` }; }
}

async function pruefe(opt) {
  const generatedAt = new Date().toISOString();
  const hinweise = [];
  const index = readJsonOrNull(path.join(opt.exportDir, 'index.json'));
  if (!index || !Array.isArray(index.branches) || !index.branches.length) {
    return { schema: SCHEMA, generatedAt, exportGeneratedAt: index?.generated_at ?? null, status: 'kein-export',
      zusammenfassung: {}, faelle: [], gekuerzt: {}, gestern: null,
      hinweise: [`Kein lesbarer Export unter ${path.basename(opt.exportDir)} (index.json fehlt oder nennt keine Boards).`] };
  }
  const exportTag = isoTag(index.generated_at) || generatedAt.slice(0, 10);
  const zeilen = [];
  for (const board of index.branches) {
    const file = [path.join(opt.exportDir, 'full', board + '.json'), path.join(opt.exportDir, board + '.json')].find((f) => fs.existsSync(f));
    if (!file) { hinweise.push(`Board ${board}: keine Datei im Export, nicht geprüft.`); continue; }
    const b = readJson(file); // a broken board file is a crash: status 'fehler', never a silent skip
    for (const track of ['profitable', 'unprofitable']) for (const r of b[track] || []) zeilen.push({ r, board, track });
  }

  const faelle = [];
  const fall = (code, z, werte, grund) => faelle.push({ code, ticker: z.r.ticker, name: z.r.name ?? null, board: z.board,
    track: z.track, rank: z.r.rank ?? null, werte, grund });
  const zeitraum = (r) => `${BASIS_WORT[r.revGrowthBasis] || r.revGrowthBasis} bis ${datum(r.revGrowthPeriodEnd)} gegen bis ${datum(r.revGrowthPriorPeriodEnd)}`;

  for (const z of zeilen) {
    const r = z.r;
    const g = r.revGrowthYoYPct;
    const periode = { revGrowthBasis: r.revGrowthBasis ?? null, revGrowthPeriodEnd: r.revGrowthPeriodEnd ?? null, revGrowthPriorPeriodEnd: r.revGrowthPriorPeriodEnd ?? null };
    if (typeof g === 'number' && Number.isFinite(g) && (g > 1000 || g < -95)) {
      fall('wachstum-extrem', z, { revGrowthYoYPct: g, ...periode },
        `Umsatzwachstum ${fmtPct(g)} (${zeitraum(r)}) liegt außerhalb von -95 % bis +1.000 %`
        + (Math.abs(g + 100) < 0.5 ? '; -100 % ist fast immer eine Null des Datenlieferanten.' : '.'));
    }
    const d = tage(r.revGrowthPeriodEnd, r.revGrowthPriorPeriodEnd);
    if (d !== null && JAHR.has(r.revGrowthBasis) && (d < 334 || d > 397)) {
      fall('jahrespaar-abstand', z, { tage: d, ...periode },
        `Das Jahreswachstum vergleicht das ${zeitraum(r)}; zwischen beiden Enden liegen ${d} Tage statt 334 bis 397.`);
    }
    if (d !== null && QUARTAL.has(r.revGrowthBasis) && (d < 350 || d > 380)) {
      fall('quartalspaar-abstand', z, { tage: d, ...periode },
        `Das Wachstum vergleicht das ${zeitraum(r)}; zwischen beiden Enden liegen ${d} Tage statt 350 bis 380 (ein Jahr).`);
    }
    const fehler = [];
    if (!imBereich(r.score)) fehler.push(`der Score (${r.score ?? 'leer'}) ist keine Zahl zwischen 0 und 100`);
    // scoreShrunk is number|null by contract (docs/findash-export-v1.md); only a present value is judged.
    if (r.scoreShrunk != null && !imBereich(r.scoreShrunk)) fehler.push(`der bereinigte Score (${r.scoreShrunk}) ist keine Zahl zwischen 0 und 100`);
    if (!r.rankGrund && !(Number.isInteger(r.rank) && r.rank > 0)) fehler.push(`der Rang (${r.rank ?? 'leer'}) ist keine positive ganze Zahl, obwohl kein Grund für einen fehlenden Rang angegeben ist`);
    if (fehler.length) fall('score-grenze', z, { score: r.score ?? null, scoreShrunk: r.scoreShrunk ?? null, rank: r.rank ?? null, rankGrund: r.rankGrund ?? null },
      `In dieser Zeile ${fehler.join(' und ')}.`);
  }

  const zusammenfassung = {};
  // boersenwert-sprung: today's market cap against the newest earlier board-history vintage.
  const stand = vorigerStand(opt.boardHistoryDir, exportTag);
  if (!stand) {
    zusammenfassung['boersenwert-sprung'] = null;
    hinweise.push('boersenwert-sprung nicht geprüft: kein Board-Stand vor dem Exporttag gefunden.');
  } else {
    for (const z of zeilen) {
      const heute = z.r.marketCap, vorher = stand.mcap.get(z.r.ticker);
      if (!posMcap(heute) || !posMcap(vorher)) continue;
      const faktor = heute / vorher;
      if (faktor > 3 || faktor < 1 / 3) {
        fall('boersenwert-sprung', z, { marketCap: heute, marketCapVorher: vorher, faktor, vergleichsStand: stand.tag },
          `Börsenwert heute ${fmtMrd(heute)}, im Board-Stand vom ${datum(stand.tag)} ${fmtMrd(vorher)} (Faktor ${zahl.format(faktor)}); ein solcher Sprung kommt oft von einem Aktiensplit oder einer falschen Aktienzahl.`);
      }
    }
  }

  // doppelte-firma: same normalised name twice among RANKED rows of one board, or on two boards with a market
  // cap gap above 10 %. One case per group; the case ticker is the best-ranked row. The key also holds the
  // company country: measured 24.10. on the live export, all 1938 known duplicate-issuer pairs (excluded.json
  // dup-issuer against their board leg) share it, while 9 of the 12 name-only hits were namesakes from two
  // countries (Metro Inc./Metro AG, Pfizer Ltd/Pfizer Inc.).
  const gruppen = new Map();
  for (const z of zeilen.filter((x) => Number.isInteger(x.r.rank) && x.r.rank > 0)) {
    const name = normName(z.r.name);
    if (!name) continue;
    const k = name + '|' + (z.r.country || '');
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(z);
  }
  const beschreibe = (z) => `${z.r.ticker} (${z.board}, Rang ${z.r.rank}, ${posMcap(z.r.marketCap) ? fmtMrd(z.r.marketCap) : 'ohne Börsenwert'})`;
  const zeile = (z) => ({ ticker: z.r.ticker, board: z.board, track: z.track, rank: z.r.rank, marketCap: z.r.marketCap ?? null });
  for (const g of gruppen.values()) {
    g.sort((a, b) => a.r.rank - b.r.rank || cmp(a.r.ticker, b.r.ticker));
    const jeBoard = new Map();
    for (const z of g) { if (!jeBoard.has(z.board)) jeBoard.set(z.board, []); jeBoard.get(z.board).push(z); }
    for (const liste of jeBoard.values()) {
      if (liste.length < 2) continue;
      fall('doppelte-firma', liste[0], { zeilen: liste.map(zeile) },
        `${liste.length} Zeilen mit Rang tragen nach Bereinigung denselben Namen: ${liste.map(beschreibe).join(', ')}; vermutlich dieselbe Firma doppelt im Board.`);
    }
    const ersteJeBoard = [...jeBoard.values()].map((l) => l[0]).filter((z) => posMcap(z.r.marketCap));
    if (ersteJeBoard.length >= 2) {
      const werte = ersteJeBoard.map((z) => z.r.marketCap);
      const abstand = Math.max(...werte) / Math.min(...werte) - 1;
      if (abstand > 0.1) {
        fall('doppelte-firma', ersteJeBoard[0], { zeilen: ersteJeBoard.map(zeile), abstandPct: abstand * 100 },
          `Derselbe Name steht auf ${ersteJeBoard.length} Boards mit Börsenwerten, die ${zahl.format(abstand * 100)} % auseinanderliegen: ${ersteJeBoard.map(beschreibe).join(', ')}.`);
      }
    }
  }

  // Snapshot checks: the same prepared snapshot the export writer reads (hand tables applied).
  let gelesen = 0, fehlend = 0;
  if (!opt.snapshotsDir || !fs.existsSync(opt.snapshotsDir)) {
    for (const c of SNAPSHOT_CODES) zusammenfassung[c] = null;
    hinweise.push(`${SNAPSHOT_CODES.join(', ')} nicht geprüft: kein Snapshot-Ordner.`);
  } else {
    const { prepareSnapshot } = require('../lib/yahoo-q4-known-cases.js');
    let ohneDatum = 0, ersterFehler = null;
    for (const z of zeilen) {
      let s;
      try { s = prepareSnapshot(readJson(path.join(opt.snapshotsDir, safeSnapshotFilename(z.r.ticker)))); }
      catch (e) { fehlend++; if (!ersterFehler && e.code !== 'ENOENT') ersterFehler = e.message; continue; }
      gelesen++;
      for (const [feld, endenFeld, wort] of [['annualRev', s.annual?.annualRevEnds, 'Jahresumsatz'], ['revenueQ', s.timeseries?.revenueQEnds, 'Quartalsumsatz']]) {
        const reihe = norm(s, feld);
        if (!reihe.length || (reihe[0] !== 0 && reihe[0] !== null) || !posMcap(z.r.marketCap)) continue;
        const ende = Array.isArray(endenFeld) ? endenFeld[0] ?? null : null;
        fall('umsatz-null-mit-boersenwert', z, { feld, wert: reihe[0], periodEnd: ende, marketCap: z.r.marketCap },
          `Der neueste ${wort} (Zeitraum bis ${datum(ende)}) steht im Datensatz ${reihe[0] === 0 ? 'als 0' : 'leer'}, der Börsenwert aber bei ${fmtMrd(z.r.marketCap)}.`);
      }
      const q = norm(s, 'revenueQ');
      const v = jahresVergleichIdx(s, 'revenueQ', 0);
      if (v && v.idx < q.length && Number.isFinite(q[0]) && q[0] !== 0 && q[0] === q[v.idx]) {
        const enden = s.timeseries?.revenueQEnds || [];
        fall('quartal-gleich-vorjahr', z, { wert: q[0], periodEnd: enden[0] ?? null, priorPeriodEnd: enden[v.idx] ?? null },
          `Der Quartalsumsatz bis ${datum(enden[0])} ist exakt gleich dem Vorjahresquartal bis ${datum(enden[v.idx])} (${zahl.format(q[0] / 1e6)} Mio. USD); das kann echt sein, ist aber oft eine kopierte Zahl des Datenlieferanten.`);
      }
      // The snapshot keeps only the time of the last successful quote fetch (marketCap.asOf), no exchange trade time.
      const abruf = isoTag(s.marketCap?.asOf) || isoTag(s.meta?.asOf);
      if (!abruf) { ohneDatum++; continue; }
      const n = handelstage(abruf, exportTag);
      if (n > 5) {
        fall('kurs-alt', z, { kursAbruf: abruf, handelstage: n, exportTag },
          `Der Börsenwert stammt aus einem Kursabruf vom ${datum(abruf)}, ${n} Handelstage vor dem Export vom ${datum(exportTag)}.`);
      }
    }
    if (fehlend) hinweise.push(`${fehlend} Boardzeilen ohne lesbaren Snapshot; für sie liefen die Snapshot-Prüfungen nicht.`);
    if (ersterFehler) hinweise.push(`Erster Lesefehler eines Snapshots: ${ersterFehler}`);
    // Not one snapshot read (e.g. a broken hand table makes every prepareSnapshot throw): the checks did not run (T2).
    if (zeilen.length && !gelesen) for (const c of SNAPSHOT_CODES) zusammenfassung[c] = null;
    if (ohneDatum) hinweise.push(`${ohneDatum} Snapshots ohne Abrufdatum des Börsenwerts; kurs-alt dort nicht geprüft.`);
  }

  faelle.sort((a, b) => cmp(a.board, b.board) || cmp(a.track, b.track) || (a.rank ?? Infinity) - (b.rank ?? Infinity) || cmp(a.ticker, b.ticker));
  const gekuerzt = {};
  const gelistet = [];
  for (const code of CODES) {
    const alle = faelle.filter((f) => f.code === code);
    if (!(code in zusammenfassung)) zusammenfassung[code] = alle.length;
    if (alle.length > CAP) {
      gekuerzt[code] = alle.length - CAP;
      console.log(`[plausi] ${code}: ${alle.length} Fälle, ${alle.length - CAP} über der Grenze von ${CAP} nicht gelistet`);
    }
    gelistet.push(...alle.slice(0, CAP));
  }
  gelistet.sort((a, b) => cmp(a.board, b.board) || cmp(a.track, b.track) || (a.rank ?? Infinity) - (b.rank ?? Infinity) || cmp(a.ticker, b.ticker) || cmp(a.code, b.code));

  const { alt, hinweis } = await ladeGestern(opt.gestern);
  let gestern = null;
  if (hinweis) hinweise.push(hinweis);
  else {
    const schluessel = (f) => f.code + '|' + f.ticker;
    const heute = new Set(gelistet.map(schluessel)), vorher = new Set(alt.faelle.map(schluessel));
    const paar = (k) => ({ code: k.split('|')[0], ticker: k.slice(k.indexOf('|') + 1) });
    gestern = { quelle: opt.gestern, exportGeneratedAt: alt.exportGeneratedAt ?? null,
      neu: [...heute].filter((k) => !vorher.has(k)).map(paar), weg: [...vorher].filter((k) => !heute.has(k)).map(paar) };
  }
  return { schema: SCHEMA, generatedAt, exportGeneratedAt: index.generated_at ?? null, status: 'ok',
    quellen: { boardZeilen: zeilen.length, snapshotsGelesen: gelesen, snapshotsFehlend: fehlend, boardHistoryStand: stand ? stand.tag : null },
    zusammenfassung, faelle: gelistet, gekuerzt, gestern, hinweise };
}

function zusammenfassen(bericht) {
  const z = ['## Plausibilitäts-Wächter (nur Meldung, ändert keine Zahl)', ''];
  if (bericht.status !== 'ok') {
    z.push(`Status: ${bericht.status}. ${bericht.fehler || (bericht.hinweise || []).join(' ')}`);
    return z.join('\n') + '\n';
  }
  z.push(`Export vom ${bericht.exportGeneratedAt}, Börsenwert-Vergleich mit dem Board-Stand vom ${bericht.quellen.boardHistoryStand ?? '(keiner)'}.`, '',
    '| Prüfung | Fälle |', '| --- | --- |');
  for (const code of CODES) z.push(`| ${code} | ${bericht.zusammenfassung[code] ?? 'nicht geprüft'} |`);
  if (bericht.gestern) z.push('', `Gegenüber gestern: ${bericht.gestern.neu.length} neu, ${bericht.gestern.weg.length} weg.`);
  for (const h of bericht.hinweise) z.push('', '> ' + h);
  for (const code of CODES) {
    const liste = bericht.faelle.filter((f) => f.code === code);
    if (!liste.length) continue;
    z.push('', `### ${code} (${bericht.zusammenfassung[code]})`);
    for (const f of liste.slice(0, 20)) z.push(`- ${f.board}/${f.track}, ${f.rank != null ? 'Rang ' + f.rank : 'ohne Rang'}, ${f.ticker} ${f.name ?? ''}: ${f.grund}`);
  }
  return z.join('\n') + '\n';
}

async function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const exportDir = path.resolve(arg('--export') || path.join(ROOT, 'outputs', 'findash-export', 'v1'));
  const out = path.resolve(arg('--out') || path.join(exportDir, 'waechter', 'plausibilitaet.json'));
  const opt = { exportDir,
    snapshotsDir: path.resolve(arg('--snapshots') || process.env.FINDASH_SNAPSHOTS_DIR || path.join(ROOT, 'snapshots')),
    boardHistoryDir: path.resolve(arg('--board-history') || path.join(ROOT, 'board-history')),
    gestern: arg('--gestern') || GESTERN_URL };
  let bericht;
  try { bericht = await pruefe(opt); }
  catch (e) {
    bericht = { schema: SCHEMA, generatedAt: new Date().toISOString(), status: 'fehler', fehler: String(e && e.message || e) };
    console.log('::warning::Plausibilitäts-Wächter abgebrochen (nur Meldung, der Lauf geht weiter): ' + bericht.fehler);
  }
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    writeJsonAtomic(out, bericht, { indent: 1 });
  } catch (e) {
    console.log('::warning::Plausibilitäts-Wächter konnte seinen Bericht nicht schreiben: ' + e.message);
    return 1;
  }
  try {
    for (const code of CODES) {
      const n = bericht.zusammenfassung?.[code];
      if (n > 0) console.log(`::warning::Plausibilität ${code}: ${n} Fälle (nur Meldung, keine Zahl geändert)`);
    }
    for (const h of bericht.hinweise || []) console.log('[plausi] ' + h);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, zusammenfassen(bericht));
    console.log(`[plausi] status=${bericht.status} -> ${out}`);
  } catch (e) { console.log('[plausi] Zusammenfassung nicht geschrieben: ' + e.message); }
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
module.exports = { main, normName, handelstage };
