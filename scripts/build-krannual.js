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
// corp_code je Ticker. Aufgeloest 19.08.2026 aus der amtlichen OpenDART-Codeliste
// (api/corpCode.xml, 118.714 Firmen) — der Download war am 19.08. vormittags noch
// unvollstaendig (2.981.888 Bytes, ZIP ohne End-of-Central-Directory) und lief beim
// Neuversuch sauber durch (3.596.991 Bytes, EOCD vorhanden). Die Sperre war voruebergehend.
// SK Hynix bestaetigt die Aufloesung: der aus der Liste gelesene Code 00164779 ist derselbe,
// der hier vorher hartkodiert stand.
const KR = {
  '000660.KS': '00164779', // SK hynix Inc.        (Bestand, Zyklus-Luecke des EDGAR-Chats)
  '278470.KS': '01190568', // 에이피알 APR
  '257720.KQ': '00982023', // 실리콘투 Silicon2
  '241710.KQ': '00763473', // 코스메카코리아 Cosmecca Korea
  '003230.KS': '00126955', // 삼양식품 Samyang Foods
  '071050.KS': '00432102', // 한국금융지주 Korea Investment Holdings
  '003540.KS': '00110893', // 대신증권 Daishin Securities
  '214450.KQ': '00970453', // 파마리서치 Pharma Research
  '207940.KS': '00877059', // 삼성바이오로직스 Samsung Biologics
  '023590.KS': '00176914', // 다우기술 Daou Tech
};
// Bekannt ohne die gesuchten Standardkonten — Branchenrealitaet, kein Abrufproblem.
// Finanzunternehmen melden nach dem Branchenschema der FSS: keinen Umsatz/Rohertrag im Sinne
// von ifrs-full_Revenue, sondern Zins- und Provisionsertraege unter eigenen Konten. Sie stehen
// NAMENTLICH hier, damit der Lauf gruen bleiben kann, ohne dass ein echter Zuordnungsfehler
// (kaputter corp_code, umbenannte account_id) mit durchrutscht — jeder NICHT gelistete Ticker
// ohne Zuordnung faerbt den Lauf rot. Waechter: tests/kr-stiller-leerlauf.test.js.
const KR_OHNE_STANDARDKONTEN = {
  '071050.KS': 'Finanzholding (한국금융지주) — meldet nach FSS-Branchenschema, kein ifrs-full_Revenue',
};
// BH-013 fix: was a static [2015..2024] literal -> from 2025 on the build could never reach the
// completed FY2025+ without a manual edit here. Dynamic upper bound = last completed calendar FY;
// a not-yet-filed year just gets skipped below (status!=='000'), so overshooting costs nothing.
function yearsFor(currentYear) {
  return Array.from({ length: currentYear - 2015 }, (_, i) => 2015 + i);
}
const YEARS = yearsFor(new Date().getFullYear());

// 19.08.2026: der Abruf lief vorher ohne jede Pause und ohne Wiederholung — bei EINEM
// Ticker unauffaellig, bei zehn Tickern x elf Jahren x zwei Endpunkten (~220 Abrufe) ist
// das ein Sturmlauf gegen eine Amtsquelle. Pause und Wiederholung stehen jetzt zentral in
// lib/fetch-retry.js (dieselbe Bremse nutzen auch build-twannual/build-jpannual).
// OpenDART verlangt weiterhin einen User-Agent (sonst 302).
const { fetchJson } = require(path.join(ROOT, 'lib/fetch-retry.js'));
function getJSON(u) {
  return fetchJson(u, { headers: { 'User-Agent': 'Mozilla/5.0 screener-krannual' } });
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
// ⚠ HAERTUNG (19.08.2026): account_id ist NICHT eindeutig — der Abschluss-Teil muss mit.
// Live gemessen an SK Hynix FY2025 (230 Zeilen): 'ifrs-full_Equity' kommt 9x vor,
// 'ifrs-full_ProfitLoss' ebenfalls 9x. Je eine Zeile stammt aus der Bilanz (sj_div=BS)
// bzw. der GuV (CIS) — die anderen acht aus dem EIGENKAPITALSPIEGEL (sj_div=SCE) mit
// voellig anderen Werten (Equity: 120.666.751 Mio. KRW in BS gegen u. a. 150.573 und
// 895.371.400 in SCE). Das bisherige list.find(account_id) traf HEUTE das Richtige,
// weil BS und CIS in der Antwort vor SCE stehen — diese Reihenfolge ist nirgends
// zugesichert. Ohne sj_div-Filter waere die Ausweitung auf Bilanzsumme/Eigenkapital/
// Nettoergebnis genau die stille Datenkorruption, die kein Test faengt.
// Waechter: tests/kr-sjdiv-eindeutigkeit.test.js (echte OpenDART-Fixture).
//
// sj_div-Werte: BS=Bilanz · CIS=Gesamtergebnisrechnung · CF=Kapitalflussrechnung · SCE=Eigenkapitalspiegel.
// Zeilen OHNE sj_div werden durchgelassen: die echte OpenDART-Antwort traegt das Feld
// immer, aber der bestehende Test-Seam (tests/p0-haertung3, fakeDart) stubbt nur
// account_id/thstrm_amount. Gegen die echte Quelle wirkt der Filter also strikt.
const pick = (list, id, sjDiv, re) => list.find((x) => x.account_id === id && (x.sj_div === undefined || x.sj_div === sjDiv))
  || list.find((x) => re.test(x.account_nm || '') && (x.sj_div === undefined || x.sj_div === sjDiv));

// Die acht Kennzahlen. sj_div bindet jede an IHREN Abschluss-Teil (siehe pick oben).
// annualOpInc/annualRev standen schon vorher drin und behalten Feldnamen und Bedeutung —
// der Zyklus-Daempfer (score.js cycleSeriesPair) liest sie unveraendert weiter.
const KR_FELDER = {
  annualRev:         { id: 'ifrs-full_Revenue',                                  sj: 'CIS', re: /^매출액$/ },
  annualGrossProfit: { id: 'ifrs-full_GrossProfit',                              sj: 'CIS', re: /^매출총이익/ },
  annualOpInc:       { id: 'dart_OperatingIncomeLoss',                           sj: 'CIS', re: /^영업이익/ },
  annualNetIncome:   { id: 'ifrs-full_ProfitLoss',                               sj: 'CIS', re: /^당기순이익/ },
  annualAssets:      { id: 'ifrs-full_Assets',                                   sj: 'BS',  re: /^자산총계$/ },
  annualEquity:      { id: 'ifrs-full_Equity',                                   sj: 'BS',  re: /^자본총계$/ },
  annualOCF:         { id: 'ifrs-full_CashFlowsFromUsedInOperatingActivities',   sj: 'CF',  re: /^영업활동/ },
};

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
  const r = buildSeriesN({ annualOpInc: opByYear, annualRev: revByYear }, years);
  return { fys: r.fys, annualOpInc: r.annualOpInc, annualRev: r.annualRev };
}

// Verallgemeinerung derselben BH-012-Achse auf beliebig viele Felder (19.08.2026, Ausweitung
// auf alle acht Kennzahlen). buildSeries() oben bleibt als 2-Feld-Fassade bestehen, weil
// tests/scoring/bh-w2-krannual.test.js genau diese Signatur festnagelt — die Achse ist
// dieselbe, nur die Feldzahl waechst. fys = Vereinigung der Jahre, in denen IRGENDEIN Feld
// einen Wert hat; jedes Feld wird auf dieser gemeinsamen Achse null-gepolstert, damit die
// Indizes ueber alle acht Serien fiskaljahr-gleich bleiben.
function buildSeriesN(byField, years) {
  const felder = Object.keys(byField);
  const fys = years.filter((y) => felder.some((f) => y in byField[f])).sort((a, b) => b - a); // newest-first
  const out = { fys };
  for (const f of felder) out[f] = fys.map((y) => ({ value: y in byField[f] ? byField[f][y] : null }));
  return out;
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
  // opts.kr = Test-Seam fuer die Ticker-Karte (Bauform wie opts.tickers in build-twannual).
  for (const [tk, corp] of Object.entries(opts.kr || KR)) {
    // je Kennzahl ein {jahr: wert}-Behaelter; annualShares kommt aus einem ZWEITEN Endpunkt.
    const proFeld = {};
    for (const f of Object.keys(KR_FELDER)) proFeld[f] = {};
    proFeld.annualShares = {};
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
      for (const [feld, def] of Object.entries(KR_FELDER)) {
        const v = numOf(pick(j.list, def.id, def.sj, def.re));
        if (Number.isFinite(v)) proFeld[feld][yr] = v;
      }

      // Aktienzahl: NICHT in fnlttSinglAcntAll enthalten (nachgeprueft — dort steht nur
      // das Ergebnis je Aktie). Sie kommt aus stockTotqySttus, am 19.08.2026 erstmals
      // live bestaetigt (die Recherche hatte diesen Endpunkt offen gelassen):
      // SK Hynix FY2025 -> se='합계' (Summe aller Gattungen), istc_totqy=728.002.365.
      // Das ist ein AUSGEWIESENER Wert, keine Herleitung.
      const uAk = `https://opendart.fss.or.kr/api/stockTotqySttus.json?crtfc_key=${KEY}`
        + `&corp_code=${corp}&bsns_year=${yr}&reprt_code=11011`;
      let ja; try { ja = await holen(uAk); } catch (e) { jahresFehler++; console.warn(`${tk} ${yr}: Aktienzahl-Abruf fehlgeschlagen (${e.message})`); continue; }
      if (ja.status === '000' && Array.isArray(ja.list)) {
        // '합계' = Summe ueber alle Aktiengattungen; faellt sie aus, '보통주' (Stammaktien).
        const z = ja.list.find((x) => x.se === '합계') || ja.list.find((x) => x.se === '보통주');
        const n = numOf(z && { thstrm_amount: z.istc_totqy });
        if (Number.isFinite(n)) proFeld.annualShares[yr] = n;
      } else if (ja.status !== '013') {
        jahresFehler++;
        console.warn(`${tk} ${yr}: stockTotqySttus-Status ${ja.status || '<keiner>'}`
          + (ja.message ? ` (${ja.message})` : '') + ' — kein legitimer Jahres-Skip');
      }
    }
    const serien = buildSeriesN(proFeld, YEARS);
    const fys = serien.fys;
    // Gate on finite-value counts, not array length -- the shared axis (BH-012) can now be
    // longer than either field's own coverage.
    const opCount = Object.keys(proFeld.annualOpInc).length, revCount = Object.keys(proFeld.annualRev).length;
    if (jahresFehler > 0) {
      unvollstaendig.push(`${tk}: ${jahresFehler} Jahresabruf(e) fehlgeschlagen`);
      console.warn(`${tk}: ${jahresFehler} Jahresabruf(e) fehlgeschlagen (nur ${opCount}/${revCount} Jahre erreicht) `
        + '-> Altbestand bleibt unveraendert, kein Teil-Ueberschreiben');
      continue;
    }
    if (opCount >= 3 && revCount >= 3) {
      // BH-013 fix: generatedAt/nfy freshness metadata, mirrors sec-secannual.json's `nfy` field
      // (build-secannual.js) so a future CI check can flag a stale/incomplete pull.
      const { fys: _weg, ...felder } = serien;
      out[tk] = Object.assign({
        corpCode: corp,
        source: 'OpenDART (FSS, amtlich)',
        accountingStandard: 'K-IFRS',
        consolidation: 'CFS',             // fs_div=CFS im Abruf — Konzern, nie Einzelabschluss (OFS)
        reportingCurrencyOriginal: 'KRW', // roh, keine Umrechnung
        nfy: fys[0],
        generatedAt: new Date().toISOString(),
        fys,
      }, felder);
      const n = (f) => Object.keys(proFeld[f]).length;
      console.log(`${tk}: ${fys.length} Jahre — rev=${n('annualRev')} gp=${n('annualGrossProfit')} op=${n('annualOpInc')} `
        + `ni=${n('annualNetIncome')} assets=${n('annualAssets')} eq=${n('annualEquity')} ocf=${n('annualOCF')} shares=${n('annualShares')}`);
    } else if (KR_OHNE_STANDARDKONTEN[tk]) {
      // Bekannt und begruendet -> kein Fehlalarm, der Lauf bleibt gruen.
      console.warn(`${tk}: keine Standardkonten (op=${opCount}, rev=${revCount}) — bekannt: ${KR_OHNE_STANDARDKONTEN[tk]}`);
    } else {
      // Befund Silent-Failure-Review 19.08.2026: dieser Zweig war die einzige Ausfahrt fuer
      // "alle Jahresabrufe kamen sauber zurueck, aber es wurde nichts zugeordnet" — und er
      // faerbte den Lauf NICHT rot. Genau so saehe ein kaputter corp_code, eine umbenannte
      // account_id oder ein pick()-Regress aus: Transport gruen, Zuordnung leer, CI gruen,
      // Altbestand veraltet still. Bei EINEM Ticker fiel das nie auf; mit zehn Tickern ist es
      // eine reale Blindstelle. Unbekannte Faelle sind jetzt ein Fehler.
      unvollstaendig.push(`${tk}: nur ${opCount}/${revCount} Jahre zugeordnet, obwohl alle Abrufe sauber waren`);
      console.warn(`${tk}: zu wenig Daten (op=${opCount}, rev=${revCount}) trotz fehlerfreier Abrufe `
        + '-> Verdacht auf Zuordnungsfehler (corp_code/account_id), nicht auf fehlende Meldung');
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

module.exports = { numOf, buildSeries, buildSeriesN, yearsFor, main, pick, KR, KR_FELDER, KR_OHNE_STANDARDKONTEN };
