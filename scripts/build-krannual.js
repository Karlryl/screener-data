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
// BH-013 fix: atomic tmp+rename write (was plain fs.writeFileSync — a crash mid-write left a
// truncated kr-secannual.json). Same fix build-secannual.js already uses (Tag 189/BH-010).
const { writeFileAtomic } = require(path.join(ROOT, 'lib/atomic-write.js'));
const { readJsonExistingOrThrow, FEHLT } = require(path.join(ROOT, 'lib/read-json.js'));
function loadKey() {
  if (process.env.OPENDART_KEY) return process.env.OPENDART_KEY;
  try { return (fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/OPENDART_KEY=(\w+)/) || [])[1]; }
  catch (_) { return null; }
}

// meta.ticker (Snapshot-Schluessel) -> OpenDART corp_code. Erweiterbar; Start: SK Hynix (die eine
// vom EDGAR-Chat offen gelassene non-US-Zyklus-Luecke). Weitere KR-Zykliker hier ergaenzen.
const KR = { '000660.KS': '00164779' }; // SK hynix Inc.
// BH-013 fix: was a static [2015..2024] literal -> from 2025 on the build could never reach the
// completed FY2025+ without a manual edit here. Dynamic upper bound = last completed calendar FY;
// a not-yet-filed year just gets skipped below (status!=='000'), so overshooting costs nothing.
function yearsFor(currentYear) {
  return Array.from({ length: currentYear - 2015 }, (_, i) => 2015 + i);
}
const YEARS = yearsFor(new Date().getFullYear());

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
// T2: absent/blank thstrm_amount must stay null, not become a real $0. '' || ''
// coerced straight into Number() gave 0 (Number('')===0, isFinite(0)===true) for
// BOTH a genuinely missing field and a genuinely empty string — indistinguishable
// from an actual reported zero. Check blank/absent BEFORE the Number() coercion.
const numOf = (x) => {
  if (!x) return null;
  const raw = x.thstrm_amount;
  if (raw == null) return null;
  const cleaned = String(raw).replace(/,/g, '').trim(); // strip thousands-seps first, so ',' / ', ,' also count as blank
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};
// Konto-Pick: primaer stabile IFRS/DART-account_id, sonst koreanischer Name (Fallback).
const pick = (list, id, re) => list.find((x) => x.account_id === id) || list.find((x) => re.test(x.account_nm || ''));

// BH-012 fix: shared fy-axis (union of years present in EITHER field), null-padded, instead of
// each series independently .filter()-compacting its own years. An asymmetric year-gap (op
// present, rev missing for the same FY, or vice versa) used to silently shift the two arrays'
// indices out of alignment relative to fiscal year. No live consumer pairs op[i]/rev[i] today
// (score.js's oscExcess/revMaxDrawdown run independently per-series; axes.js cycleDiscount reads
// Yahoo, not secAnnual -- see BH-012 verdict), so this doesn't change today's output for a ticker
// with full coverage in both fields (SK Hynix currently has 10/10) -- it hardens against a future
// index-pairing consumer or a field-only gap year. Mirrors merge-sec-xbrl.js buildAnnual's
// fy-union pattern. Exported for the hermetic regression check.
function buildSeries(opByYear, revByYear, years) {
  const fys = years.filter((y) => y in opByYear || y in revByYear).sort((a, b) => b - a); // newest-first
  const cell = (m, y) => ({ value: y in m ? m[y] : null });
  return { fys, annualOpInc: fys.map((y) => cell(opByYear, y)), annualRev: fys.map((y) => cell(revByYear, y)) };
}

// F-CGPT-021 (P0-Haertung 09.08.2026): der Writer startete mit `const out = {}` und schrieb
// das Ergebnis EINES Laufs als kompletten Store. Live nachgestellt (echtes main(), Netz
// gestubbt): antworten nur 2015-2017 und alle spaeteren Jahre laufen auf ECONNRESET, dann
// genuegen drei Jahre fuer einen gruenen Neu-Write — die zehnjaehrige Historie und jeder
// andere Name im Store waren weg, Exit 0.
//
// Semantik jetzt:
//   Erstanlage      = kr-secannual.json fehlt (dann {} als Basis).
//   Merge-Basis     = vorhandener Store; korrupt -> Wurf, nichts wird ueberschrieben.
//   Ersetzen        = ein Ticker wird NUR ueberschrieben, wenn KEIN Jahresabruf fehlgeschlagen
//                     ist. Ein Jahr, das die Quelle bewusst nicht liefert (status!='000', z.B.
//                     noch nicht eingereicht), ist kein Fehler; ein Netz-/Parse-Fehler schon.
//   Laut            = jeder fehlgeschlagene Jahresabruf faerbt den Lauf am Ende rot; der
//                     Altbestand bleibt dabei erhalten (Merge-Write laeuft vorher).
// opts ist der Test-Seam (getJSON/out) — Bauform wie SEC_SNAPSHOTS_DIR in build-secannual.
async function main(opts = {}) {
  const holen = opts.getJSON || getJSON;
  const outPfad = opts.out || OUT;
  const KEY = loadKey();
  if (!KEY) { console.error('build-krannual: kein OPENDART_KEY (process.env oder .env)'); process.exit(1); }
  const vorher = readJsonExistingOrThrow(outPfad);
  const out = vorher === FEHLT ? {} : vorher;
  const unvollstaendig = [];
  for (const [tk, corp] of Object.entries(KR)) {
    const opByYear = {}, revByYear = {};
    let jahresFehler = 0;
    for (const yr of YEARS) {
      const u = `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?crtfc_key=${KEY}`
        + `&corp_code=${corp}&bsns_year=${yr}&reprt_code=11011&fs_div=CFS`;
      let j; try { j = await holen(u); } catch (e) { jahresFehler++; console.warn(`${tk} ${yr}: Abruf fehlgeschlagen (${e.message})`); continue; }
      // R609-2: NUR '013' (keine Daten fuer dieses Geschaeftsjahr) ist ein legitimer Skip.
      // Vorher galt JEDER Nicht-000-Status als Skip — 020 (Rate-Limit/Tageskontingent),
      // 800 (Wartung) und 010 (ungueltiger Key) liefen damit als "der Ticker hat dieses
      // Jahr eben nicht" durch. Folge: der Lauf zaehlte sich als vollstaendig, blieb
      // gruen und ersetzte die gepflegte Historie durch einen Teilstand. Jeder andere
      // Nicht-000-Status (und ein 000 ohne .list) ist jetzt ein Jahresfehler — dann
      // bleibt der Altbestand unangetastet (siehe jahresFehler-Zweig unten) und der
      // Lauf wird rot, nachdem der erhaltende Write durch ist.
      if (j.status === '013') continue;
      if (j.status !== '000' || !Array.isArray(j.list)) {
        jahresFehler++;
        console.warn(`${tk} ${yr}: OpenDART-Status ${j.status || '<keiner>'}`
          + (j.message ? ` (${j.message})` : '') + ' — kein legitimer Jahres-Skip');
        continue;
      }
      const rev = pick(j.list, 'ifrs-full_Revenue', /^매출액$/);
      const op = pick(j.list, 'dart_OperatingIncomeLoss', /^영업이익/);
      const rv = numOf(rev), ov = numOf(op);
      if (Number.isFinite(rv)) revByYear[yr] = rv;
      if (Number.isFinite(ov)) opByYear[yr] = ov;
    }
    const { fys, annualOpInc, annualRev } = buildSeries(opByYear, revByYear, YEARS);
    // Gate on finite-value counts, not array length -- the shared axis (BH-012) can now be
    // longer than either field's own coverage.
    const opCount = Object.keys(opByYear).length, revCount = Object.keys(revByYear).length;
    if (jahresFehler > 0) {
      unvollstaendig.push(`${tk}: ${jahresFehler} Jahresabruf(e) fehlgeschlagen`);
      console.warn(`${tk}: ${jahresFehler} Jahresabruf(e) fehlgeschlagen (nur ${opCount}/${revCount} Jahre erreicht) `
        + '-> Altbestand bleibt unveraendert, kein Teil-Ueberschreiben');
      continue;
    }
    if (opCount >= 3 && revCount >= 3) {
      // BH-013 fix: generatedAt/nfy freshness metadata, mirrors sec-secannual.json's `nfy` field
      // (build-secannual.js) so a future CI check can flag a stale/incomplete pull.
      out[tk] = { corpCode: corp, nfy: fys[0], generatedAt: new Date().toISOString(), annualOpInc, annualRev };
      console.log(`${tk}: OpInc-Jahre=${opCount}, Rev-Jahre=${revCount}`);
    } else {
      console.warn(`${tk}: zu wenig Daten (op=${opCount}, rev=${revCount}) -> uebersprungen`);
    }
  }
  writeFileAtomic(outPfad, JSON.stringify(out, null, 1));
  console.log(`geschrieben: ${outPfad} (${Object.keys(out).length} Namen)`);
  // Erst schreiben (der Merge erhaelt den Altbestand), dann rot werden: ein stiller Exit 0
  // ueber einem halb abgerufenen Lauf ist genau der Befund.
  if (unvollstaendig.length) {
    throw new Error('build-krannual unvollstaendig — ' + unvollstaendig.join('; ')
      + ' (Altbestand erhalten, aber der Lauf hat NICHT aktualisiert)');
  }
}
if (require.main === module) main().catch((e) => { console.error('::error::' + e.message); process.exit(1); });

module.exports = { numOf, buildSeries, yearsFor, main };
