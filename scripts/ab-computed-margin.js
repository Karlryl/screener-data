#!/usr/bin/env node
/**
 * A/B-Messung: was aendert sich, wenn der Financials-Notbehelf 'computed-margin' wegfaellt?
 * ========================================================================================
 * Spezifikation: _SPEC-AB-MESSUNG-NOTBEHELF-2026-07-30.md (Karl-Kreuzerl M, 10.08.2026).
 * Klasse: DISCOVERY / Messwerkzeug. Score-neutral. Schreibt NICHTS ausser einem Report.
 *
 * Der Notbehelf (pull-yahoo.js, Pfad 3 von _deriveOpIncForFinancials) fuellt fehlende
 * Jahres-Betriebsergebnisse von Finanzfirmen mit `Umsatz[jahr] x operatingMargins(TTM)`.
 * Jeder so gefuellte Snapshot traegt `meta.opIncSource === 'computed-margin'`.
 * Gemessen wird: derselbe Snapshot-Bestand ZWEIMAL durch die Produktions-Engine —
 *   Lauf A: unveraendert.
 *   Lauf B: bei genau diesen Snapshots gilt annualOpInc als FEHLEND.
 * Danach der Vergleich der beiden Kohorten je Board.
 *
 * WARUM DER SCHALTER IN DEN DATEN SITZT UND NICHT IM SCORING-CODE
 * ---------------------------------------------------------------
 * Die Spezifikation schlug drei Zeilen in `norm()` (src/scoring/snapshot.js:65) vor,
 * gesteuert per Umgebungsvariable. src/scoring/** ist fuer diesen Auftrag versiegelt,
 * und der Datenweg ist ohnehin der genauere: `norm()` liefert laut eigenem Vertrag (iii)
 * fuer ein "komplett fehlendes ODER leeres Rohfeld" `[]` — verifiziert an snapshot.js:93-94
 * (`raw = snapshot[container][field]; if (!Array.isArray(raw) || raw.length === 0) return []`).
 * Ein geloeschtes `annual.annualOpInc` erzeugt also EXAKT die Ausgabe, die der vorgeschlagene
 * Schalter erzwungen haette — fuer alle zwoelf Verbraucher gleichzeitig, ohne dass eine
 * Produktionsdatei angefasst wird. Nebeneffekt: der in der Spezifikation geforderte
 * Waechter gegen einen versehentlich im Tageslauf gesetzten Schalter wird gegenstandslos,
 * weil es keinen Schalter gibt, den der Tageslauf setzen koennte.
 * secAnnual (committete SEC-Serie) bleibt unberuehrt — sie ist eine unabhaengige, echte
 * Quelle und war nie Teil des Notbehelfs.
 *
 * Aufruf:
 *   node scripts/ab-computed-margin.js <snapdir> [--min-snapshots=10000] [--out=<datei>] [--selbsttest]
 *
 * Selbstpruefungen (fail-loud, exit 1) — Spezifikation Abschnitt 3:
 *   A  Bestandsgroesse    < --min-snapshots  -> Abbruch (zu kleiner Bestand = Scheinmessung)
 *   B  computed-margin    == 0               -> Abbruch (der Lauf wuerde nichts messen)
 *   C  Determinismus      Lauf A zweimal identisch, sonst Abbruch
 * --selbsttest ergaenzt die Wirksamkeits-Probe in BEIDE Richtungen (Waechter-Regel):
 *   der Schalter muss an einem computed-margin-Snapshot wirken UND an einem 'native'
 *   Snapshot nachweislich NICHT, und die Ruecknahme muss den Ausgangszustand herstellen.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ladeUniversum } = require('./score-digest.js');
const { scoreUniverse, produceRankings, signFlips, cycleSignal, cycleDamperFactor } = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');
const { norm, presentValues, ratioSeries } = require('../src/scoring/snapshot.js');
const { capitalEfficiency } = require('../src/scoring/axes.js');
// Die Quantils-Formel des Wert-Gates selbst — nicht nachgebaut, sondern importiert.
const { quantile, frozenThresholdOf, _const } = require('./write-board-history.js');

const ROOT = path.join(__dirname, '..');
const P99 = 0.99;                       // wie write-board-history.js (P99-Tagesdelta)
const MARKE = 'computed-margin';
const GATE_CALIB = path.join(ROOT, 'board-history', '_gate-calibration.json');

const istMarkiert = (s) => !!(s && s.meta && s.meta.opIncSource === MARKE);

// --- der Schalter, als Datenoperation ---------------------------------------
// Entfernt annual.annualOpInc bei markierten Snapshots und liefert die Ruecknahme.
function schalterAn(universum) {
  const gemerkt = [];
  for (const s of universum) {
    if (!istMarkiert(s) || !s.annual || s.annual.annualOpInc === undefined) continue;
    gemerkt.push([s, s.annual.annualOpInc]);
    delete s.annual.annualOpInc;
  }
  return () => { for (const [s, wert] of gemerkt) s.annual.annualOpInc = wert; };
}

// --- ein Lauf ----------------------------------------------------------------
// Liefert je Board (full-Key) die Ticker->Score-Abbildung plus die Groessen, an denen
// die beiden stillen Sicherungen haengen.
function lauf(universum) {
  const results = scoreUniverse(universum, formulas, {});
  const ranked = produceRankings(results, { topN: 100 });
  const boards = new Map();
  for (const id of Object.keys(ranked.full)) {
    const m = new Map();
    for (const track of Object.keys(ranked.full[id])) {
      for (const r of ranked.full[id][track]) {
        if (r && r.ticker && Number.isFinite(r.score)) m.set(r.ticker, r.score);
      }
    }
    boards.set(id, m);
  }
  const zeilen = new Map();   // ticker -> {track, formulaId, score, factorCycle}
  for (const e of results) {
    if (e.action !== 'route' || !Number.isFinite(e.score)) continue;
    zeilen.set(e.ticker, { track: e.track, formulaId: e.formulaId, score: e.score, factorCycle: e._factorCycle });
  }
  return { boards, zeilen };
}

// --- die beiden stillen Sicherungen -----------------------------------------
// Zyklus-Daempfer: braucht >=2 Vorzeichenwechsel in der OpInc-Jahresreihe (score.js
// oscExcess>=1). Zyklus-Spitzen-Korrektur (axes.js capitalEfficiency, cycleDiscount):
// braucht cur > histRest der OpMargen-Reihe. Eine per TTM-Marge zurueckgerechnete Reihe
// hat konstantes Vorzeichen UND konstante Marge — beide Bedingungen sind dort per
// Konstruktion unerreichbar. Genau das wird hier gezaehlt statt behauptet.
function sicherungen(universum) {
  let n = 0, flips0 = 0, margeKonstant = 0, daempferAktiv = 0;
  const capEff = new Map();
  for (const s of universum) {
    if (!istMarkiert(s)) continue;
    n++;
    const op = presentValues(norm(s, 'annualOpInc'));
    if (signFlips(op) === 0) flips0++;
    if (cycleSignal(s, 0) > 0) daempferAktiv++;   // ddThreshold=0 = guenstigste Annahme
    const m = presentValues(ratioSeries(norm(s, 'annualOpInc'), norm(s, 'annualRev')));
    if (m.length >= 3) {
      const spanne = Math.max(...m) - Math.min(...m);
      const skala = Math.max(...m.map(Math.abs)) || 1;
      if (spanne / skala < 1e-9) margeKonstant++;
    }
    const c = capitalEfficiency(s);
    if (Number.isFinite(c)) capEff.set(s.meta.ticker, c);
  }
  return { n, flips0, margeKonstant, daempferAktiv, capEff };
}

// --- Vergleich ---------------------------------------------------------------
function vergleich(a, b, schwellen) {
  const zeilen = [];
  for (const [board, mA] of a.boards) {
    const mB = b.boards.get(board) || new Map();
    const deltas = [];
    let betroffen = 0;
    for (const [tk, sA] of mA) {
      const sB = mB.get(tk);
      if (!Number.isFinite(sB)) continue;
      const d = Math.abs(sA - sB);
      deltas.push(d);
      if (d > 0) betroffen++;
    }
    const thr = schwellen.get(board);
    zeilen.push({
      board,
      zeilenA: mA.size,
      zeilenB: mB.size,
      schnittmenge: deltas.length,
      betroffen,
      p99Delta: deltas.length ? quantile(deltas, P99) : null,
      maxDelta: deltas.length ? Math.max(...deltas) : null,
      schwelle: thr,
      deckel: Number.isFinite(thr) ? thr * 2 : null,
    });
  }
  zeilen.sort((x, y) => (y.p99Delta || 0) - (x.p99Delta || 0));
  return zeilen;
}

function ladeSchwellen() {
  const m = new Map();
  let j;
  try {
    j = JSON.parse(fs.readFileSync(GATE_CALIB, 'utf8'));
  } catch (e) {
    // fail-loud: fehlende Datei ist planmaessig, kaputte/unlesbare NICHT — sonst
    // stuende im Report ueberall "Schwelle: —" und saehe aus wie ein Ergebnis.
    if (e.code !== 'ENOENT') console.error(`::warning::_gate-calibration.json nicht lesbar (${GATE_CALIB}): ${e.message} — Schwellen/Deckel fehlen im Report.`);
    return m;
  }
  for (const [board, st] of Object.entries((j && j.boards) || {})) {
    const t = frozenThresholdOf(st);
    m.set(board, Number.isFinite(t) ? t : _const.MIN_GATE_THRESHOLD);
  }
  return m;
}

// --- Selbsttest (beide Richtungen) -------------------------------------------
function selbsttest(universum) {
  const markiert = universum.filter(istMarkiert);
  // A1/K1.2 (Urteil T164, ENTSCHIED 15): das Etikett 'native' heisst seit 29.08.2026
  // 'yahoo-adjusted'. Beide werden akzeptiert — Alt-Snapshots aus den Shard-Caches tragen
  // das alte Etikett, bis ein Vollabruf oder scripts/opinc-source-migrate.js sie anfasst.
  // Waere hier nur der neue Wert gepruegt worden, faende der Selbsttest auf einem Alt-Store
  // null Vergleichsnamen und meldete "NICHT AUSFUEHRBAR" statt zu messen.
  const nativ = universum.filter((s) => s && s.meta
    && (s.meta.opIncSource === 'yahoo-adjusted' || s.meta.opIncSource === 'native')
    && s.annual && Array.isArray(s.annual.annualOpInc) && s.annual.annualOpInc.length);
  const zeilen = [];
  let ok = true;
  if (!markiert.length || !nativ.length) {
    console.error(`SELBSTTEST NICHT AUSFUEHRBAR — markiert=${markiert.length}, native=${nativ.length}`);
    return false;
  }
  const vorM = norm(markiert[0], 'annualOpInc').length;
  const vorN = norm(nativ[0], 'annualOpInc').length;
  const zurueck = schalterAn(universum);
  const nachM = norm(markiert[0], 'annualOpInc').length;
  const nachN = norm(nativ[0], 'annualOpInc').length;
  zurueck();
  const zurueckM = norm(markiert[0], 'annualOpInc').length;

  const wirkt = vorM > 0 && nachM === 0;
  const verschont = vorN > 0 && nachN === vorN;
  const reversibel = zurueckM === vorM;
  ok = wirkt && verschont && reversibel;
  zeilen.push(`(1) wirkt bei ${MARKE}   : ${wirkt ? 'OK' : 'FEHLER'} — ${markiert[0].meta.ticker}: norm() ${vorM} -> ${nachM} Jahre`);
  zeilen.push(`(2) verschont 'native'   : ${verschont ? 'OK' : 'FEHLER'} — ${nativ[0].meta.ticker}: norm() ${vorN} -> ${nachN} Jahre`);
  zeilen.push(`(3) Ruecknahme           : ${reversibel ? 'OK' : 'FEHLER'} — ${vorM} Jahre wiederhergestellt (${zurueckM})`);
  for (const z of zeilen) console.log(z);
  return ok;
}

function report(kopf, zeilen, sichA, sichB, trackWechsel, capEffDiff) {
  const L = [];
  L.push('# A/B-Messung Financials-Notbehelf (computed-margin)');
  L.push('');
  for (const [k, v] of Object.entries(kopf)) L.push(`- **${k}**: ${v}`);
  L.push('');
  L.push('## Board-Vergleich (Lauf A = mit Notbehelf, Lauf B = ohne)');
  L.push('');
  L.push('| Board | Zeilen A | Zeilen B | Schnittmenge | veraendert | p99-Delta | max-Delta | Schwelle | Deckel (2x) |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  const z3 = (x) => (x == null ? '—' : x.toFixed(3));
  for (const r of zeilen) {
    L.push(`| ${r.board} | ${r.zeilenA} | ${r.zeilenB} | ${r.schnittmenge} | ${r.betroffen} | ${z3(r.p99Delta)} | ${z3(r.maxDelta)} | ${z3(r.schwelle)} | ${z3(r.deckel)} |`);
  }
  L.push('');
  L.push('## Die zwei stillen Sicherungen (bindende Erweiterung des Messauftrags, 10.08.)');
  L.push('');
  L.push('| Groesse | Lauf A (mit Notbehelf) | Lauf B (ohne) |');
  L.push('|---|---:|---:|');
  L.push(`| markierte Snapshots | ${sichA.n} | ${sichB.n} |`);
  L.push(`| davon OpInc-Reihe ohne jeden Vorzeichenwechsel | ${sichA.flips0} | ${sichB.flips0} |`);
  L.push(`| davon OpMarge ueber alle Jahre konstant (<1e-9) | ${sichA.margeKonstant} | ${sichB.margeKonstant} |`);
  L.push(`| Zyklus-Daempfer feuert (guenstigste Annahme dd=0) | ${sichA.daempferAktiv} | ${sichB.daempferAktiv} |`);
  L.push(`| capitalEfficiency berechenbar | ${sichA.capEff.size} | ${sichB.capEff.size} |`);
  L.push(`| davon zwischen A und B veraendert | ${capEffDiff} | — |`);
  L.push('');
  L.push(`## Einstufungs-Wechsel (Track)`);
  L.push('');
  L.push(`Gesamt: **${trackWechsel.length}**`);
  if (trackWechsel.length) {
    L.push('');
    L.push('| Ticker | Formel | Track A | Track B | Score A | Score B |');
    L.push('|---|---|---|---|---:|---:|');
    for (const w of trackWechsel.slice(0, 50)) {
      L.push(`| ${w.ticker} | ${w.formulaId} | ${w.trackA} | ${w.trackB} | ${w.scoreA.toFixed(3)} | ${w.scoreB.toFixed(3)} |`);
    }
    if (trackWechsel.length > 50) L.push(`| … | | | | | | (${trackWechsel.length - 50} weitere)`);
  }
  return L.join('\n') + '\n';
}

function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'snapshots');
  const arg = (name, def) => {
    const a = args.find((x) => x.startsWith('--' + name + '='));
    return a ? a.slice(name.length + 3) : def;
  };
  const minSnapshots = Number(arg('min-snapshots', 10000));
  const outPfad = arg('out', path.join(ROOT, 'reports', 'ab-computed-margin-' + new Date().toISOString().slice(0, 10) + '.md'));
  const mitSelbsttest = args.includes('--selbsttest');

  if (!fs.existsSync(dir)) {
    console.error(`::error::Snapshot-Verzeichnis nicht gefunden: ${dir}`);
    process.exit(2);
  }
  const universum = ladeUniversum(dir);

  // SELBSTPRUEFUNG A — Bestandsgroesse.
  if (!(universum.length >= minSnapshots)) {
    console.error(`::error::Selbstpruefung A gerissen: ${universum.length} Snapshots < ${minSnapshots}. `
      + 'Ein zu kleiner Bestand misst den eigenen Spiegel, nicht die Kohorte. '
      + '(--min-snapshots nur fuer bewusst nicht-belastbare Probelaeufe herabsetzen.)');
    process.exit(1);
  }
  // SELBSTPRUEFUNG B — gibt es ueberhaupt etwas zu messen?
  const markiert = universum.filter(istMarkiert).length;
  if (markiert === 0) {
    console.error(`::error::Selbstpruefung B gerissen: 0 Snapshots mit meta.opIncSource === '${MARKE}'. Der Lauf wuerde nichts messen.`);
    process.exit(1);
  }
  console.log(`Snapshot-Baum : ${dir}`);
  console.log(`Universum     : ${universum.length} Snapshots, davon ${markiert} mit ${MARKE}`);

  if (mitSelbsttest && !selbsttest(universum)) {
    console.error('SELBSTTEST FEHLGESCHLAGEN — diese Messung taugt nicht als Beleg.');
    process.exit(1);
  }

  const a = lauf(universum);
  const a2 = lauf(universum);
  // SELBSTPRUEFUNG C — Determinismus.
  let abweichung = null;
  for (const [tk, r] of a.zeilen) {
    const r2 = a2.zeilen.get(tk);
    if (!r2 || r2.score !== r.score || r2.track !== r.track) { abweichung = tk; break; }
  }
  if (abweichung) {
    console.error(`::error::Selbstpruefung C gerissen: Lauf A ist nicht deterministisch (${abweichung}).`);
    process.exit(1);
  }
  const sichA = sicherungen(universum);

  const zurueck = schalterAn(universum);
  const b = lauf(universum);
  const sichB = sicherungen(universum);
  zurueck();

  // Ruecknahme-Probe: nach dem Zuruecksetzen muss Lauf A wieder exakt A ergeben.
  const a3 = lauf(universum);
  let ruecknahmeOk = a3.zeilen.size === a.zeilen.size;
  if (ruecknahmeOk) {
    for (const [tk, r] of a.zeilen) {
      const r3 = a3.zeilen.get(tk);
      if (!r3 || r3.score !== r.score) { ruecknahmeOk = false; break; }
    }
  }
  if (!ruecknahmeOk) {
    console.error('::error::Ruecknahme gerissen: der Schalter hat den Bestand nicht sauber zurueckgesetzt.');
    process.exit(1);
  }

  const trackWechsel = [];
  for (const [tk, rA] of a.zeilen) {
    const rB = b.zeilen.get(tk);
    if (rB && rB.track !== rA.track) {
      trackWechsel.push({ ticker: tk, formulaId: rA.formulaId, trackA: rA.track, trackB: rB.track, scoreA: rA.score, scoreB: rB.score });
    }
  }
  // Vereinigung beider Schluesselmengen: ein Ticker, der erst in B berechenbar
  // wird (A: kein Eintrag), ist eine Veraenderung und darf nicht durchrutschen.
  let capEffDiff = 0;
  for (const tk of new Set([...sichA.capEff.keys(), ...sichB.capEff.keys()])) {
    if (sichA.capEff.get(tk) !== sichB.capEff.get(tk)) capEffDiff++;
  }

  const zeilen = vergleich(a, b, ladeSchwellen());
  const kopf = {
    'Snapshot-Baum': dir,
    'Universum': `${universum.length} Snapshots`,
    'davon computed-margin': markiert,
    'gescorte Zeilen A/B': `${a.zeilen.size} / ${b.zeilen.size}`,
    'Einstufungs-Wechsel': trackWechsel.length,
    'Selbstpruefungen': `A ok (>=${minSnapshots}) · B ok (${markiert}>0) · C ok (deterministisch) · Ruecknahme ok`,
    'erzeugt': new Date().toISOString(),
  };
  const txt = report(kopf, zeilen, sichA, sichB, trackWechsel, capEffDiff);
  fs.mkdirSync(path.dirname(outPfad), { recursive: true });
  fs.writeFileSync(outPfad, txt, 'utf8');
  console.log('\n' + txt);
  console.log(`Report geschrieben: ${outPfad}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, txt);
}

if (require.main === module) main();
module.exports = { schalterAn, istMarkiert, lauf, vergleich, sicherungen };
