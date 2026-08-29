'use strict';
/**
 * P1-Welle 3 (09.08.2026) — Waechter-Baselines duerfen Blindheit nicht seeden.
 *
 * Rot-zuerst gegen e75e206525 belegt: A/B warfen korrupte Baselines nicht,
 * C kannte keine Liste ungepruefter Metriken, D erzeugte bei null/null keine
 * Messwarnung, E meldete KOSDAQ bei Median 0 nicht und F kannte nur den Index.
 * Run: node tests/p1-welle3-waechter-wahrheit.test.js (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const exchange = require('../scripts/watch-exchange-coverage.js');
const fx = require('../scripts/watch-fx-sanity.js');
const unrouted = require('../scripts/watch-unrouted-quote.js');
const pullStats = require('../scripts/check-pull-stats.js');
const plan = require('../scripts/plan-check.js');
const annual = require('../scripts/watch-annual-spikes.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p1w3-'));
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e)); }
}
function corrupt(name) { const p = path.join(TMP, name); fs.writeFileSync(p, '{kaputt'); return p; }

test('Cluster A: korrupte Exchange-/FX-Baselines sind kein Erstseeding', () => {
  assert.throws(() => exchange.loadBaseline(corrupt('exchange.json')), /NICHT ueberschrieben/);
  assert.throws(() => fx.loadBaseline(corrupt('fx.json')), /NICHT ueberschrieben/);
  assert.deepEqual(exchange.loadBaseline(path.join(TMP, 'fehlt-exchange.json')), {});
  assert.equal(fx.loadBaseline(path.join(TMP, 'fehlt-fx.json')), null);
  // Nachzug Tag 997: watch-annual-spikes wurde am 09.08. nicht mitgehaertet und lieferte
  // fuer "Datei kaputt" DENSELBEN leeren Bestand wie fuer "Datei fehlt". Leerer Bestand =
  // jeder bekannte Fall gilt als neu; das ist entweder ein Riss mit falscher Diagnose oder
  // — bei wenigen Funden — stilles Durchrutschen. Beide Richtungen werden hier festgenagelt.
  assert.throws(() => annual.loadBaseline(corrupt('annual.json')), /NICHT ueberschrieben/);
  assert.deepEqual(annual.loadBaseline(path.join(TMP, 'fehlt-annual.json')), {},
    'fehlende Datei bleibt Erstlauf — eine Wache, die immer wirft, waere so wertlos wie keine');
});

test('Cluster B: korrupte Label-Baseline wirft; leerer Scan ist sichtbar leer', () => {
  assert.throws(() => unrouted.loadBaseline(corrupt('labels.json')), /NICHT ueberschrieben/);
  assert.equal(unrouted.loadBaseline(path.join(TMP, 'fehlt-labels.json')), null);
  const leer = unrouted.scanSnapshots(path.join(TMP, 'kein-snapshot-dir'));
  assert.equal(leer.routable, 0);
  // Verhalten statt Quelltext-Regex (Review-Nachzug Tag 618): ein leerer Scan meldet
  // "NICHTS geprueft" UND fasst die Baseline nicht an — sonst kocht er die bekannten
  // Labels auf den leeren Stand von heute ein und der Taxonomie-Kanarienvogel verstummt.
  const leerBefund = unrouted.befundeFuer(leer, { labels: ['sector:Technology'] });
  assert.match(leerBefund.problems.join(' | '), /NICHTS geprueft/);
  assert.equal(leerBefund.darfSchreiben, false);
  // Gegenprobe: bei echtem Scan wird geschrieben und ein bekanntes Label ist kein Befund.
  const vollBefund = unrouted.befundeFuer({ routable: 100, noSector: 2, labels: new Set(['sector:Technology']) },
    { labels: ['sector:Technology'] });
  assert.deepEqual(vollBefund.problems, []);
  assert.equal(vollBefund.darfSchreiben, true);
  // und ein NEUES Label faellt auf, sobald eine Baseline existiert
  const neuesLabel = unrouted.befundeFuer({ routable: 100, noSector: 2, labels: new Set(['sector:Quantum Ponies']) },
    { labels: ['sector:Technology'] });
  assert.match(neuesLabel.problems.join(' | '), /not in baseline: sector:Quantum Ponies/);
});

test('Cluster C: Null-Metrik bleibt im Gesamtfazit als ungeprueft sichtbar', () => {
  const history = Array.from({ length: 4 }, (_, i) => ({ asOf: String(i), yahooOk: 100, fxRatesCount: 10,
    earningsWithDate: 20, priceTickerCount: 30, snapshotsCount: 40 }));
  const today = { yahooOk: 100, fxRatesCount: 10, earningsWithDate: 20, priceTickerCount: null, snapshotsCount: 40 };
  assert.deepEqual(pullStats.uncheckedStats(today, history), ['priceTickerCount']);
  assert.deepEqual(pullStats.detectStatsDrift(today, history), []);
});

test('Cluster D: nicht messbare Manifest-/Snapshot-Fakten verbieten "im Rahmen"', () => {
  const vendors = plan.VENDORS.map(v => ({ name: v.name, ok: true, code: 200 }));
  const status = plan.buildStatus(vendors, { missing: [], hard: false }, null, null,
    '2026-08-09T00:00:00Z', '2026-08', ['Manifest: kaputtes JSON', 'Snapshot-Zahl: EACCES']);
  assert.equal(status.measurement_errors.length, 2);
  assert.match(plan.renderReport(status), /NICHT MESSBAR/);
  assert.doesNotMatch(plan.renderReport(status), /Universe\/Detektoren\/Cache im Rahmen/);
});

test('Cluster E: aktive KOSDAQ-Phase alarmiert trotz alter Nullen; tote Reihen bleiben still', () => {
  const kosdaq = [0, 0, 0, 0, 0, 0, 0, 0, 68, 71, 72, 70, 72, 72];
  assert.equal(exchange.isExchangeAlarming(0, kosdaq), true);
  for (const tot of ['Kuala Lumpur', 'Dubai', '(unknown)']) {
    assert.equal(exchange.isExchangeAlarming(0, Array(14).fill(0)), false, tot + ' ist durchgehend tot');
  }
});

test('Cluster F: stabile Signatur ueberlebt Indexverschiebung und liest Altbestand', () => {
  const vor = { ticker: 'ABC', reihe: 'annualRev', index: 1, wert: 900, links: 100, rechts: 110, periode: null };
  const nach = { ...vor, index: 2 };
  assert.equal(annual.stabilerSchluessel(vor), annual.stabilerSchluessel(nach));
  assert.equal(annual.istBekannt(nach, new Set(['ABC|annualRev|1'])), true, 'eine neue FY-Zeile verschiebt Legacy-Index um eins');
  assert.equal(annual.istBekannt(nach, new Set([annual.stabilerSchluessel(vor)])), true);
});

// ── Review-Nachzug Tag 618 ───────────────────────────────────────────────────────────

test('Cluster F2: Legacy-Toleranz verschluckt keinen ECHTEN Neuzugang derselben Reihe', () => {
  // Der Alt-Bestand kennt nur "ticker|reihe|index" — keine Werte, also keine Gegenprobe.
  // Liegt ein NEUER Ausreisser zufaellig auf oder neben dem Alt-Index, deckt ihn die
  // +-1-Toleranz zu: der Waechter schweigt genau ueber den Fall, fuer den er gebaut ist.
  const bestand = new Set(['1CORZ.MI|annualOpInc|3']);
  const neuFall = { ticker: '1CORZ.MI', reihe: 'annualOpInc', index: 4, wert: -777e6, links: 5e6, rechts: 6e6, periode: null };
  // ZWEI heutige Funde gegen EINEN Alt-Eintrag: einer davon kann unmoeglich bekannt sein.
  assert.equal(annual.istBekannt(neuFall, bestand, new Map([['1CORZ.MI|annualOpInc', 2]])), false,
    'Kollision auf dem Alt-Index darf den Neuzugang nicht decken');
  // Gegenprobe (Cluster F bleibt gueltig): bei EINEM Fund ist es reine Indexverschiebung.
  assert.equal(annual.istBekannt(neuFall, bestand, new Map([['1CORZ.MI|annualOpInc', 1]])), true,
    'reine Verschiebung bleibt bekannt — die Haertung darf kein Falsch-Rot erzeugen');
  assert.deepEqual(annual.fundeJeReihe([neuFall, { ...neuFall, index: 3 }], bestand), new Map([['1CORZ.MI|annualOpInc', 2]]));
});

test('Cluster F3: ein Signatur-Treffer blaeht den Massstab nicht auf (kein Phantom-NEU)', () => {
  // Review-Fund zum Fix selbst: gezaehlt werden darf nur, was die Legacy-Toleranz ueberhaupt
  // braucht. Ein Fund, den die stabile Signatur exakt trifft, verlaesst istBekannt() sofort —
  // zaehlt er trotzdem mit, kippt der Zaehl-Abgleich und eine REINE Indexverschiebung in
  // derselben Reihe faellt faelschlich als NEU auf. Das ist Falsch-Rot, der zweite Tod eines Waechters.
  const bestand = new Set(['X|R|3', 'X|R|2019-12-31']);
  const signaturTreffer = { ticker: 'X', reihe: 'R', index: 1, wert: 900, links: 100, rechts: 110, periode: '2019-12-31' };
  const verschoben = { ticker: 'X', reihe: 'R', index: 4, wert: 800, links: 90, rechts: 95, periode: null };
  const zaehler = annual.fundeJeReihe([signaturTreffer, verschoben], bestand);
  assert.deepEqual(zaehler, new Map([['X|R', 1]]), 'nur der Fund ohne Signatur-Treffer zaehlt');
  assert.equal(annual.istBekannt(signaturTreffer, bestand, zaehler), true);
  assert.equal(annual.istBekannt(verschoben, bestand, zaehler), true, 'reine Verschiebung bleibt bekannt');
});

test('Cluster C2: ungepruefte Metriken bleiben auch im DRIFT-Zweig sichtbar', () => {
  // Vorher hing die Blindheits-Info am driftfreien Zweig: driftete irgendeine ANDERE
  // Metrik, verschwand die Liste der ungepruefte spurlos.
  const alerts = [{ metric: 'yahooOk', today: 10, median: 100, drift: -0.9 }];
  const mitDrift = pullStats.fazitZeilen(alerts, ['priceTickerCount']).join('\n');
  assert.match(mitDrift, /DRIFT DETECTED/);
  assert.match(mitDrift, /::warning::[\s\S]*priceTickerCount/);
  const ohneDrift = pullStats.fazitZeilen([], ['priceTickerCount']).join('\n');
  assert.match(ohneDrift, /::warning::[\s\S]*priceTickerCount/);
  assert.match(ohneDrift, /no drift detected/);
  assert.deepEqual(pullStats.fazitZeilen([], []).filter((z) => z.includes('::warning::')), []);
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nP1-Welle 3: ${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
