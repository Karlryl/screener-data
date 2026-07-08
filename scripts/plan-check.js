#!/usr/bin/env node
'use strict';
// TASK 0.10 (Schutz-Kadenzen) — MONATS-"Stimmt der Plan noch?"-Check.
// Prueft maschinell die Fakten, die ein Skript kennen kann (Masterplan Abschnitt 4 Vendor-Register),
// und LOEST den nicht-automatisierbaren Urteils-Teil sichtbar aus (Report + Banner-Flag + rotes X),
// statt ihn durch Automatik zu ERSETZEN.
//
// ROT (exit 1) NUR bei struktureller Register-Luege: ein deklarierter Detektor wurde GELOESCHT.
// Vendor-Endpoint-4xx/5xx/timeout = ::warning:: (transient/key-gated, kein Alarm). Universe/Cache
// ausserhalb Plausibilitaets-Range = ::warning::. Alle Nicht-rot-Befunde -> needs_human_review-Flag
// im Banner (outputs/plan-check-status.json, coverage-status-Muster) + Checkliste im Report.
//
// Usage: node scripts/plan-check.js [--out outputs/plan-check-status.json] [--report reports/plan-check-<YYYY-MM>.md]
//        node scripts/plan-check.js --selftest
const fs = require('fs');
const path = require('path');

// Vendor-/Quellen-Register (Masterplan Abschnitt 4). endpoint = oeffentlicher Health-Pfad (keyfrei);
// detectors = im Repo existierende Detektor-/Adapter-Dateien, deren FEHLEN eine Register-Luege ist.
const VENDORS = [
  { name: 'Yahoo Finance',      endpoint: 'https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=price', detectors: ['pull-yahoo.js', 'tests/yahoo-schema-canary.js', '.github/workflows/heartbeat.yml'] },
  { name: 'SEC EDGAR/XBRL',     endpoint: 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/Revenues.json', detectors: [] },
  { name: 'TradingView-Scanner', endpoint: 'https://scanner.tradingview.com/germany/scan', detectors: ['.github/workflows/tv-reachability.yml'] },
  { name: 'FinMind (TW)',       endpoint: 'https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo', detectors: [] },
  { name: 'OpenDART (KR)',      endpoint: 'https://opendart.fss.or.kr/api/list.json', detectors: [] },
  { name: 'Wikipedia-Indizes',  endpoint: 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', detectors: [] },
  { name: 'FRED',               endpoint: 'https://api.stlouisfed.org/fred/series?series_id=GDP', detectors: [] },
  { name: 'GitHub Actions',     endpoint: 'https://api.github.com/zen', detectors: ['.github/workflows/heartbeat.yml', 'scripts/coverage-gate.js'] },
];

const CHECKLIST = [
  'Ist-Zustand-Block (Kopf-Block + Modul-Fahrplan) gegen Repo-Realitaet gelesen — stimmt jeder Modul-Status?',
  'Risiken-Register (Abschnitt 4) durchgesehen — ist ein Risiko eingetreten/entfallen/neu?',
  'Vendor-Register-Zeilen: Zugang/Fallback je Quelle noch gueltig (Warnungen dieses Laufs unten)?',
  'Archiv-Pflege faellig (alte Vintages/Snapshots kompaktieren, Grundgesetz 7)?',
];

// --- reine Kernlogik (TDD, kein I/O) ---

// Prueft die deklarierten Detektoren je Vendor. existsFn(path)->bool injizierbar fuer Tests.
// Ein FEHLENDER deklarierter Detektor = harte Register-Luege -> hard=true.
function checkDetectors(vendors, existsFn) {
  const missing = [];
  for (const v of vendors) for (const d of (v.detectors || [])) if (!existsFn(d)) missing.push({ vendor: v.name, detector: d });
  return { missing, hard: missing.length > 0 };
}

// Baut das Banner-Status-Objekt (coverage-status-Muster) aus den Befunden.
function buildStatus(vendorResults, detectors, manifestFacts, snapshotCount, nowIso, monthTag) {
  const driftFlags = [];
  const nTotal = manifestFacts && manifestFacts.n_total;
  if (Number.isFinite(nTotal) && (nTotal < 15000 || nTotal > 60000)) driftFlags.push(`Universe-Groesse n_total=${nTotal} ausserhalb Plausibilitaets-Range [15000..60000]`);
  if (Number.isFinite(snapshotCount) && snapshotCount > 40000) driftFlags.push(`Snapshot-Zahl ${snapshotCount} > 40000 — Archiv-Pflege faellig (Grundgesetz 7)`);
  for (const m of detectors.missing) driftFlags.push(`DETEKTOR FEHLT: ${m.detector} (Register-Zeile "${m.vendor}") — struktureller Register-Drift`);
  const vendorWarnings = vendorResults.filter(v => !v.ok).map(v => `${v.name}: HTTP ${v.code || v.err || '?'}`);
  const needsHuman = true; // der Urteils-Teil ist per Definition jeden Monat faellig
  return {
    schema: 'plan-check-status/v1',
    generated_at: nowIso,
    month: monthTag,
    needs_human_review: needsHuman,
    blocked: detectors.hard,                 // rotes X nur bei Register-Luege
    drift_flags: driftFlags,
    vendor_status: vendorResults.map(v => ({ name: v.name, ok: !!v.ok, code: v.code != null ? v.code : null })),
    vendor_warnings: vendorWarnings,
    checklist: CHECKLIST,
  };
}

function renderReport(status) {
  const L = [];
  L.push(`# Monats-Plan-Check ${status.month}`, '', `_Automatisch erzeugt ${status.generated_at} — Task 0.10._`, '');
  L.push(status.blocked ? '## ❌ ROT — struktureller Register-Drift (Detektor fehlt)' : '## Maschinelle Befunde', '');
  if (status.drift_flags.length) { L.push('**Drift-Flags:**'); for (const f of status.drift_flags) L.push(`- ⚠ ${f}`); L.push(''); }
  else L.push('_Keine Drift-Flags — Universe/Detektoren/Cache im Rahmen._', '');
  L.push('**Vendor-Reachability (4xx/5xx/timeout = nur Bericht, transient/key-gated):**');
  for (const v of status.vendor_status) L.push(`- ${v.ok ? '✅' : '⚠'} ${v.name}${v.code != null ? ` (HTTP ${v.code})` : ''}`);
  L.push('', '## 🧑 Urteils-Teil (nicht automatisierbar — von Karl/KI beim Draufschauen abzuarbeiten):', '');
  for (const c of status.checklist) L.push(`- [ ] ${c}`);
  L.push('', '_Dieser offene Punkt ist der 0.10-Monats-Anti-Drift-Check. Banner-Flag `needs_human_review` bleibt bis zur Durchsicht._');
  return L.join('\n') + '\n';
}

// Live-Reachability (I/O). Node 20+ global fetch, AbortController-Timeout. 2xx/3xx=ok.
async function probe(vendor, timeoutMs) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(vendor.endpoint, { method: 'GET', redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'screener-plan-check/1.0 (contact: repo owner)' } });
    return { name: vendor.name, ok: res.status >= 200 && res.status < 400, code: res.status };
  } catch (e) { return { name: vendor.name, ok: false, err: (e && e.name === 'AbortError') ? 'timeout' : (e && e.message) }; }
  finally { clearTimeout(to); }
}

async function run() {
  const argv = process.argv;
  const get = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
  const now = new Date();
  const monthTag = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const outPath = get('--out', path.join('outputs', 'plan-check-status.json'));
  const reportPath = get('--report', path.join('reports', `plan-check-${monthTag}.md`));

  const detectors = checkDetectors(VENDORS, (p) => fs.existsSync(p));
  let manifest = null; try { manifest = JSON.parse(fs.readFileSync(path.join('snapshots', '_manifest.json'), 'utf8')); } catch (e) {}
  let snapCount = null; try { snapCount = fs.readdirSync('snapshots').filter(f => f.endsWith('.json') && f !== '_manifest.json' && !f.startsWith('_')).length; } catch (e) {}

  const vendorResults = [];
  for (const v of VENDORS) vendorResults.push(await probe(v, 20000));

  const status = buildStatus(vendorResults, detectors, manifest, snapCount, now.toISOString(), monthTag);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(status, null, 2) + '\n');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, renderReport(status));

  for (const f of status.drift_flags) console.log(`  drift: ${f}`);
  for (const v of status.vendor_status) console.log(`  vendor: ${v.name} -> ${v.ok ? 'ok' : 'WARN'}${v.code != null ? ' (' + v.code + ')' : ''}`);
  console.log(`plan-check: report=${reportPath} status=${outPath} needs_human_review=true blocked=${status.blocked}`);
  if (status.blocked) {
    console.error(`::error::MONATS-PLAN-CHECK ROT — deklarierter Detektor fehlt (Register-Luege): ${detectors.missing.map(m => m.detector).join(', ')}. Register vs. Repo divergiert.`);
    process.exit(1);
  }
  console.log(`::warning::Monats-Plan-Review offen (needs_human_review) — ${status.drift_flags.length} Drift-Flag(s), ${status.vendor_warnings.length} Vendor-Warnung(en). Report: ${reportPath}. Kein rotes X (kein Detektor fehlt), aber Banner zeigt es.`);
  process.exit(0);
}

// --- runnable self-check: node scripts/plan-check.js --selftest ---
function selftest() {
  const assert = require('node:assert/strict');
  let pass = 0, fail = 0;
  const t = (n, fn) => { try { fn(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.error('FAIL   ' + n + '\n       ' + e.message); } };

  t('checkDetectors: alle da -> nicht hard', () => {
    const r = checkDetectors(VENDORS, () => true);
    assert.equal(r.hard, false); assert.equal(r.missing.length, 0);
  });
  t('checkDetectors: ein Detektor geloescht -> hard=true (Register-Luege)', () => {
    const r = checkDetectors(VENDORS, (p) => p !== 'tests/yahoo-schema-canary.js');
    assert.equal(r.hard, true);
    assert.ok(r.missing.some(m => m.detector === 'tests/yahoo-schema-canary.js'));
  });
  t('buildStatus: gesund -> blocked=false, needs_human_review=true (Urteil immer faellig)', () => {
    const vr = VENDORS.map(v => ({ name: v.name, ok: true, code: 200 }));
    const s = buildStatus(vr, { missing: [], hard: false }, { n_total: 23689 }, 6088, '2026-07-08T00:00:00Z', '2026-07');
    assert.equal(s.blocked, false); assert.equal(s.needs_human_review, true);
    assert.equal(s.drift_flags.length, 0); assert.equal(s.schema, 'plan-check-status/v1');
  });
  t('buildStatus: fehlender Detektor -> blocked=true + Drift-Flag', () => {
    const vr = VENDORS.map(v => ({ name: v.name, ok: true, code: 200 }));
    const s = buildStatus(vr, { missing: [{ vendor: 'Yahoo Finance', detector: 'pull-yahoo.js' }], hard: true }, { n_total: 23689 }, 6088, '2026-07-08T00:00:00Z', '2026-07');
    assert.equal(s.blocked, true);
    assert.ok(s.drift_flags.some(f => f.includes('pull-yahoo.js')));
  });
  t('buildStatus: Universe-Kollaps + Snapshot-Flut -> Drift-Flags (aber nicht blocked)', () => {
    const vr = VENDORS.map(v => ({ name: v.name, ok: true, code: 200 }));
    const s = buildStatus(vr, { missing: [], hard: false }, { n_total: 500 }, 45000, '2026-07-08T00:00:00Z', '2026-07');
    assert.equal(s.blocked, false);
    assert.ok(s.drift_flags.some(f => f.includes('Universe-Groesse')));
    assert.ok(s.drift_flags.some(f => f.includes('Snapshot-Zahl')));
  });
  t('buildStatus: Vendor-4xx -> vendor_warnings, NICHT blocked', () => {
    const vr = VENDORS.map((v, i) => ({ name: v.name, ok: i !== 0, code: i === 0 ? 429 : 200 }));
    const s = buildStatus(vr, { missing: [], hard: false }, { n_total: 23689 }, 6088, '2026-07-08T00:00:00Z', '2026-07');
    assert.equal(s.blocked, false);
    assert.ok(s.vendor_warnings.some(w => w.includes('Yahoo Finance')));
  });
  t('renderReport enthaelt Checkliste + Urteils-Teil', () => {
    const s = buildStatus(VENDORS.map(v => ({ name: v.name, ok: true, code: 200 })), { missing: [], hard: false }, { n_total: 23689 }, 6088, '2026-07-08T00:00:00Z', '2026-07');
    const md = renderReport(s);
    assert.ok(md.includes('Urteils-Teil')); assert.ok(md.includes('Ist-Zustand-Block'));
  });

  console.log(`\nplan-check selftest: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

module.exports = { checkDetectors, buildStatus, renderReport, VENDORS, CHECKLIST };
if (process.argv.includes('--selftest')) selftest();
else if (require.main === module) run().catch(e => { console.error(`::error::plan-check crashed: ${e && e.stack || e}`); process.exit(1); });
