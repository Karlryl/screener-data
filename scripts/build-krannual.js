'use strict';
/**
 * build-krannual.js — OFFLINE-Generator (analog scripts/build-secannual.js).
 * ========================================================================
 * Zieht tiefe koreanische annual OpInc/Rev-Serien von OpenDART (FSS, gratis) und schreibt
 * external-data/kr-secannual.json im SEC-secannual-Format:
 *   { "<meta.ticker>": { corpCode, annualOpInc:[{value}], annualRev:[{value}] } }  (newest-first)
 *
 * ZWECK (EDGAR-Chat-Luecke): SK Hynix ist non-US -> per SEC unerreichbar, Yahoo-annualOpInc = [] ->
 * der Zyklus-Daempfer (score.js cycleSeriesPair/cycleSignal) konnte nie feuern. Mit dieser tiefen
 * Serie fliesst SK Hynix durch DENSELBEN secAnnual-Kanal wie Micron via SEC -> Daempfer refresh-robust.
 * Das Signal (oscExcess=OpInc-Vorzeichen-Flips, revMaxDrawdown=relativer Umsatz-Einbruch) ist
 * vorzeichen-/verhaeltnis-basiert -> KRW ist waehrungs-invariant unbedenklich.
 *
 * DETERMINISMUS wie bei build-secannual: Netzwerk NUR hier (offline). Die committete kr-secannual.json
 * ist die deterministische Quelle; run-screener.js liest sie OHNE Netz (CI==lokal). OpenDART verlangt
 * einen User-Agent-Header (sonst 302). Key aus process.env.OPENDART_KEY oder .env.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'external-data', 'kr-secannual.json');
function loadKey() {
  if (process.env.OPENDART_KEY) return process.env.OPENDART_KEY;
  try { return (fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/OPENDART_KEY=(\w+)/) || [])[1]; }
  catch (_) { return null; }
}

// meta.ticker (Snapshot-Schluessel) -> OpenDART corp_code. Erweiterbar; Start: SK Hynix (die eine
// vom EDGAR-Chat offen gelassene non-US-Zyklus-Luecke). Weitere KR-Zykliker hier ergaenzen.
const KR = { '000660.KS': '00164779' }; // SK hynix Inc.
const YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];

function getJSON(u) {
  return new Promise((res, rej) => {
    const r = https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 screener-krannual' } }, (x) => {
      let b = ''; x.on('data', (c) => b += c);
      x.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(new Error('parse')); } });
    });
    r.on('error', rej);
    r.setTimeout(20000, () => { r.destroy(); rej(new Error('timeout')); });
  });
}
const numOf = (x) => (x ? Number(String(x.thstrm_amount || '').replace(/,/g, '')) : null);
// Konto-Pick: primaer stabile IFRS/DART-account_id, sonst koreanischer Name (Fallback).
const pick = (list, id, re) => list.find((x) => x.account_id === id) || list.find((x) => re.test(x.account_nm || ''));

async function main() {
  const KEY = loadKey();
  if (!KEY) { console.error('build-krannual: kein OPENDART_KEY (process.env oder .env)'); process.exit(1); }
  const out = {};
  for (const [tk, corp] of Object.entries(KR)) {
    const opByYear = {}, revByYear = {};
    for (const yr of YEARS) {
      const u = `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?crtfc_key=${KEY}`
        + `&corp_code=${corp}&bsns_year=${yr}&reprt_code=11011&fs_div=CFS`;
      let j; try { j = await getJSON(u); } catch (_) { continue; }
      if (j.status !== '000' || !Array.isArray(j.list)) continue; // 013=keine Daten fuer das Jahr -> skip
      const rev = pick(j.list, 'ifrs-full_Revenue', /^매출액$/);
      const op = pick(j.list, 'dart_OperatingIncomeLoss', /^영업이익/);
      const rv = numOf(rev), ov = numOf(op);
      if (Number.isFinite(rv)) revByYear[yr] = rv;
      if (Number.isFinite(ov)) opByYear[yr] = ov;
    }
    const desc = [...YEARS].sort((a, b) => b - a); // newest-first
    const annualOpInc = desc.filter((y) => y in opByYear).map((y) => ({ value: opByYear[y] }));
    const annualRev = desc.filter((y) => y in revByYear).map((y) => ({ value: revByYear[y] }));
    if (annualOpInc.length >= 3 && annualRev.length >= 3) {
      out[tk] = { corpCode: corp, annualOpInc, annualRev };
      console.log(`${tk}: OpInc-Jahre=${annualOpInc.length}, Rev-Jahre=${annualRev.length}`);
    } else {
      console.warn(`${tk}: zu wenig Daten (op=${annualOpInc.length}, rev=${annualRev.length}) -> uebersprungen`);
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`geschrieben: ${OUT} (${Object.keys(out).length} Namen)`);
}
main();
