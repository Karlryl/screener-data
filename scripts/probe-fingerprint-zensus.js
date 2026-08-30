#!/usr/bin/env node
'use strict';
/**
 * O1-VOLL-ZENSUS — wie viele bytegleiche Fundamental-Reihen liegen zwischen VERSCHIEDENEN
 * Emittenten im ganzen Snapshot-Bestand?
 *
 * WOFUER: Der Milan-Zweig in `scripts/filter-snapshot-merge.js` benutzt den Fingerabdruck
 * (`timeseries.revenueQ` + `timeseries.grossProfitQ`, wertgleich) als Identitaets-Gegenprobe —
 * aber nur auf der eingefrorenen Milan-Kandidatenliste. Das allgemeine Tor ueber ALLE Suffixe
 * ist vom Gericht 2:1 GESPERRT (`_COURT-MILAN-U3-2026-08-29.md`, A11/§5(c) c1), und seine
 * Vorbedingung ist genau diese Messung plus ein eigenes Retrial.
 *
 * DIESES SKRIPT MISST NUR. Es repariert nichts, es ist kein Gate, es endet immer mit Exit 0 —
 * gleiche Bauform wie `scripts/probe-dedup-fingerprint.js` und `probe-issuer-branchenkonflikt.js`.
 *
 * ── DER UNTERSCHIED ZU probe-dedup-fingerprint.js ───────────────────────────────────────
 * Jenes misst auf dem BOARD-Artefakt (`pit.revenueQ`, nach dem Scoring, nur die gerankten
 * Zeilen). Dieses misst auf dem SNAPSHOT-Bestand (`snapshot.timeseries`, vor dem Scoring, alle
 * ~15.000 Zeilen) — also auf der Ebene, auf der die Vorstufe wirklich handelt. Beide Ebenen
 * wertgleich zu unterstellen war ausdruecklich verboten (Auflage A9); `write-board-history.js`
 * haelt fest, dass BH-108 `revenueQ` bei JEDEM Yahoo-Abruf mit dem dann aktuellen FX-Faktor
 * neu in USD rechnet.
 *
 * Fingerabdruck, Reihen-Entpackung und die ≥-4-Quartals-Auflage werden aus
 * `filter-snapshot-merge.js` IMPORTIERT, nicht nachgebaut: die Drift-Spur muss dasselbe messen,
 * was das Tor entscheidet (Nachbau-Fehler F1334).
 *
 * ── MELDEPFLICHT (Urteil §6.5, Drift-Spur) ──────────────────────────────────────────────
 * Meldepflichtig ist jede Fingerabdruck-Klasse mit VERSCHIEDENEN `issuerKeyLoose` UND
 * mindestens einem der beiden harten Verdachtsmerkmale:
 *   - Aktienzahl-Abstand > 20 % (das Band, mit dem `AVB`/`VMRK` heute geblockt wird), oder
 *   - verschiedenes `meta.country`.
 * Steigt diese Zahl, ist die Kontamination gewachsen und das Tor gehoert wiedervorgelegt,
 * BEVOR irgendeine Ausweitung sie merged.
 *
 * ── DIE MAILAENDER TEILMENGE (`klassenMitMilanBeinDivergent`) ───────────────────────────
 * `klassenMitMilanBein` zaehlt ALLE Klassen mit einem `1XXX.MI`-Bein — divergent oder nicht
 * (heute 783). Die Zahl, die im Milan-Urteil TRAEGT, ist aber die divergente Teilmenge davon:
 * Klassen mit Mailaender Bein UND verschiedenen `issuerKeyLoose` (J3s Vollmessung,
 * `_COURT-MILAN-U3-2026-08-29.md:123`, heute 47). Genau die konnte dieses Skript bis
 * `akte-c2-diskrepanz-2026-08-30.md` (Befund 2 / O-2) nicht drucken — wer sie nachmessen
 * wollte, brauchte Zusatzcode, und eine urteilstragende Kennzahl ohne Drift-Spur driftet
 * unbemerkt.
 *
 * ⚠ EBENEN-WECHSEL: die beiden Zahlen oben (783 / 47) sind auf der KONVERTIERTEN Ebene
 * gemessen, also vor ENTSCHIED 72. Seit der Zensus auf der Melde-Waehrung misst, lautet
 * derselbe Bestand 828 / 54 — die Klassen, die der Abrufzeitpunkt vorher auseinandergerissen
 * hatte, fallen jetzt zusammen. Wer die Zahlenreihe ueber diesen Schnitt hinweg vergleicht,
 * vergleicht zwei Groessen; die Trendaussage beginnt bei 828 / 54 neu.
 *
 * ⚠ WAS DIESE ZAHL NICHT KANN: die Milan-Vorstufe abnehmen. Sie misst Fingerabdruck-KLASSEN,
 * die Vorstufe behandelt board-sichtbare PAARE — und in 10 von 17 Faellen ist der
 * A6-Eintrag ENGER als seine Fingerabdruck-Klasse (die Geschwister-Beine bleiben auf dem
 * alten Namen stehen, `akte-c2-diskrepanz-2026-08-30.md` §6). Der Zensus kann Drift
 * ueberwachen; als Vollzugskontrolle der Vorstufe taugt er grundsaetzlich nicht.
 *
 * ── NUTZUNG ─────────────────────────────────────────────────────────────────────────────
 *   node scripts/probe-fingerprint-zensus.js                    (Standard: snapshots/)
 *   node scripts/probe-fingerprint-zensus.js --store pfad/zu/snapshots
 *   node scripts/probe-fingerprint-zensus.js --json=zensus.json
 *   node scripts/probe-fingerprint-zensus.js --selftest         (Wachprobe ohne Bestand)
 */
const fs = require('fs');
const path = require('path');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');
const {
  milanReihe, milanEndlicheQuartale, milanFingerabdruck, MILAN_MIN_QUARTALE, MILAN_SHARES_BAND, MILAN_SPIEGEL,
} = require('./filter-snapshot-merge.js');
const { issuerKeyLoose } = require('../src/scoring/score.js');

/** Groesster relativer Abstand der Aktienzahlen einer Klasse. null, wenn ein Bein keinen hat. */
function sharesAbstand(beine) {
  const s = beine.map((b) => b.shares);
  if (s.some((x) => !Number.isFinite(x) || x <= 0)) return null;
  let max = 0;
  for (let i = 0; i < s.length; i++) {
    for (let j = i + 1; j < s.length; j++) {
      const r = Math.abs(s[i] - s[j]) / Math.max(s[i], s[j]);
      if (r > max) max = r;
    }
  }
  return max;
}

/** Reiner Kern (kein I/O): Beine -> Zensus. Damit die Auswertung ohne Bestand pruefbar ist. */
function zensus(beine) {
  const nachAbdruck = new Map();
  for (const b of beine) {
    if (milanEndlicheQuartale(b.revenueQ) < MILAN_MIN_QUARTALE) continue;
    const a = milanFingerabdruck(b);
    if (!nachAbdruck.has(a)) nachAbdruck.set(a, []);
    nachAbdruck.get(a).push(b);
  }
  const klassen = [];
  for (const gruppe of nachAbdruck.values()) {
    if (gruppe.length < 2) continue;
    const schluessel = new Set(gruppe.map((b) => b.schluessel));
    const laender = new Set(gruppe.map((b) => b.country));
    const abstand = sharesAbstand(gruppe);
    const divergent = schluessel.size > 1;
    // Ein unbekannter Abstand (Bein ohne Aktienzahl) zaehlt als Verdacht, nicht als Entwarnung:
    // die zweite Achse kann dort gar nicht greifen.
    const sharesVerdacht = abstand === null || abstand > MILAN_SHARES_BAND;
    klassen.push({
      tickers: gruppe.map((b) => b.ticker).sort(),
      namen: gruppe.map((b) => b.name),
      schluessel: [...schluessel],
      laender: [...laender],
      sharesAbstand: abstand,
      mitMilanBein: gruppe.some((b) => MILAN_SPIEGEL.test(b.ticker)),
      divergent,
      meldepflichtig: divergent && (sharesVerdacht || laender.size > 1),
    });
  }
  klassen.sort((a, b) => (a.tickers[0] < b.tickers[0] ? -1 : a.tickers[0] > b.tickers[0] ? 1 : 0));
  return {
    beineGesamt: beine.length,
    beineBelastbar: beine.filter((b) => milanEndlicheQuartale(b.revenueQ) >= MILAN_MIN_QUARTALE).length,
    klassen: klassen.length,
    klassenDivergent: klassen.filter((k) => k.divergent).length,
    klassenMeldepflichtig: klassen.filter((k) => k.meldepflichtig).length,
    klassenMitMilanBein: klassen.filter((k) => k.mitMilanBein).length,
    klassenMitMilanBeinDivergent: klassen.filter((k) => k.mitMilanBein && k.divergent).length,
    detail: klassen,
  };
}

function liesStore(store) {
  const beine = [];
  let unlesbar = 0;
  let ohneKurs = 0;
  for (const f of fs.readdirSync(store)) {
    if (!f.endsWith('.json') || isMetadataSnapshot(f)) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(store, f), 'utf8')); }
    catch (_) { unlesbar++; continue; }
    const meta = (j && j.meta) || {};
    const ts = (j && j.timeseries) || {};
    // A7-FX: der Kurs wandert MIT. `milanFingerabdruck` vergleicht seit ENTSCHIED 72 auf der
    // Melde-Waehrung; misst die Drift-Spur weiter auf der konvertierten Ebene, misst sie eine
    // andere Groesse als die, die das Tor entscheidet — genau der Nachbau-Fehler F1334, nur
    // durch die Hintertuer. Der Import allein genuegt dafuer nicht mehr, das Bein braucht `fx`.
    if (!Number.isFinite(meta.fxRateApplied) || meta.fxRateApplied <= 0) ohneKurs++;
    beine.push({
      ticker: f.slice(0, -'.json'.length), name: meta.name, country: meta.country,
      shares: meta.sharesOutstanding, schluessel: issuerKeyLoose(j), fx: meta.fxRateApplied,
      revenueQ: milanReihe(ts.revenueQ), grossProfitQ: milanReihe(ts.grossProfitQ),
    });
  }
  return { beine, unlesbar, ohneKurs };
}

function bericht(z, store, unlesbar, ohneKurs) {
  const zeilen = [];
  zeilen.push(`O1-Fingerabdruck-Zensus ueber ${store} (Ebene: snapshot.timeseries, auf Melde-Waehrung zurueckgerechnet)`);
  zeilen.push(`  Snapshots .................... ${z.beineGesamt}${unlesbar ? ` (${unlesbar} nicht lesbar)` : ''}`);
  // Ohne diese Zeile waere ein Bestand ohne FX-Stempel von einem sauberen nicht zu
  // unterscheiden: ein Bein ohne Kurs bekommt einen Abdruck, der mit nichts matcht, faellt
  // also aus JEDER Klasse — und der Zensus meldete stillschweigend "0 meldepflichtig".
  zeilen.push(`  ohne brauchbaren FX-Kurs ..... ${ohneKurs === undefined ? '?' : ohneKurs}${ohneKurs ? '  ⚠ diese Beine bilden keine Klasse' : ''}`);
  zeilen.push(`  belastbar (>=${MILAN_MIN_QUARTALE} Umsatzquartale) ... ${z.beineBelastbar}`);
  zeilen.push(`  Fingerabdruck-Klassen (>=2) .. ${z.klassen}`);
  zeilen.push(`  davon divergente issuerKeyLoose ${z.klassenDivergent}`);
  zeilen.push(`  davon mit Mailaender Bein .... ${z.klassenMitMilanBein}`);
  zeilen.push(`     davon divergent ........... ${z.klassenMitMilanBeinDivergent}`);
  zeilen.push(`  MELDEPFLICHTIG (§6.5) ........ ${z.klassenMeldepflichtig}`);
  zeilen.push('');
  zeilen.push('Meldepflichtig = divergente Emittenten-Schluessel UND (Aktienzahl-Abstand > '
    + (MILAN_SHARES_BAND * 100).toFixed(0) + ' % ODER verschiedenes Land).');
  zeilen.push('Das ist die Drift-Spur, nicht das Tor: dieses Skript entscheidet nichts.');
  const m = z.detail.filter((k) => k.meldepflichtig);
  if (m.length) {
    zeilen.push('');
    zeilen.push('── Meldepflichtige Klassen ' + '─'.repeat(40));
    for (const k of m) {
      zeilen.push(`  ${k.tickers.join(' + ')}`);
      zeilen.push(`      Namen: ${k.namen.map((n) => JSON.stringify(n)).join(' / ')}`);
      zeilen.push(`      Land: ${k.laender.join(' / ')}  Aktienzahl-Abstand: ${k.sharesAbstand === null ? 'unbekannt' : k.sharesAbstand.toFixed(3)}`
        + `${k.mitMilanBein ? '  [Mailaender Bein]' : ''}`);
    }
  }
  return zeilen.join('\n');
}

/**
 * Wachprobe ohne Bestand: der Zensus muss die drei Lagen unterscheiden koennen, um die sie
 * gebaut ist. Ohne sie waere ein stiller Rueckfall auf "0 meldepflichtig" nicht von einem
 * sauberen Bestand zu unterscheiden.
 */
function selftest() {
  const assert = require('node:assert/strict');
  const reihe = (n) => Array.from({ length: 5 }, (_, i) => (i + 1) * n);
  // A7-FX: `fx` ist PFLICHT, seit der Fingerabdruck auf der Melde-Waehrung vergleicht. Ohne
  // Kurs faellt jeder endliche Wert in die OHNE-FX-Schranke, die Reihe kollabiert auf einen
  // ticker-eigenen Platzhalter und KEINE der fuenf Lagen bildet noch eine Klasse — die
  // Wachprobe waere dann gruen im Sinne von "nichts gefunden", also blind.
  const b = (ticker, name, country, shares, n, gp, fx) => ({
    ticker, name, country, shares, schluessel: issuerKeyLoose({ meta: { name } }),
    fx: fx === undefined ? 1 : fx,
    revenueQ: reihe(n), grossProfitQ: reihe(gp === undefined ? n / 2 : gp),
  });
  // 1. gleiche Firma, gleiche Reihe, gleicher Schluessel -> Klasse, aber nicht divergent
  let z = zensus([b('AAA', 'Acme Inc', 'US', 100, 7), b('AAA.DE', 'Acme Inc', 'US', 100, 7)]);
  assert.equal(z.klassen, 1); assert.equal(z.klassenDivergent, 0); assert.equal(z.klassenMeldepflichtig, 0);
  // 2. verschiedene Namen, gleiche Aktienzahl, gleiches Land -> divergent, NICHT meldepflichtig
  z = zensus([b('BBB', 'Beta Inc', 'US', 100, 7), b('BBB.DE', 'BETA IND.DL-1', 'US', 100, 7)]);
  assert.equal(z.klassenDivergent, 1); assert.equal(z.klassenMeldepflichtig, 0);
  // 3. AVB/VMRK-Lage: bytegleiche Reihen, gleiches Land, Aktienzahl weit auseinander -> MELDEN
  z = zensus([b('AVB', 'AvalonBay', 'US', 142, 7), b('VMRK', 'Vivmark Residential', 'US', 398, 7)]);
  assert.equal(z.klassenMeldepflichtig, 1);
  // 4. Sanofi/Santander-Lage: verschiedene Reihen -> gar keine Klasse
  z = zensus([b('1SAN.MI', 'Sanofi', 'France', 1198, 7), b('SAN', 'Banco Santander', 'Spain', 14266, 9)]);
  assert.equal(z.klassen, 0);
  // 5. Pre-Revenue: leere Reihen bilden KEINE Scheingruppe (die Pflicht-Auflage)
  const leer = (t) => ({ ticker: t, name: t, country: 'US', shares: 1, schluessel: t, revenueQ: [], grossProfitQ: [], fx: 1 });
  assert.equal(zensus([leer('X1'), leer('X2'), leer('X3')]).klassen, 0);
  // 6. A7-FX: dieselbe Firma, VERSCHIEDENE Kurse -> auf der Melde-Waehrung EINE Klasse.
  //    Die Drift-Spur muss genau das messen, was das Tor entscheidet; misst sie weiter auf der
  //    konvertierten Ebene, faellt diese Klasse aus dem Zensus und der Bericht meldet einen
  //    Bestand als sauber, den das Tor gerade zusammenfuehrt.
  const mitKurs = (t, name, fx) => ({
    ticker: t, name, country: 'DE', shares: 100, schluessel: issuerKeyLoose({ meta: { name } }), fx,
    revenueQ: reihe(7).map((x) => x * fx), grossProfitQ: reihe(3.5).map((x) => x * fx),
  });
  z = zensus([mitKurs('1CCC.MI', 'Cee AG', 1.1550012), mitKurs('CCC.DE', 'CCC.DE', 1.1511453)]);
  assert.equal(z.klassen, 1, 'verschiedene Kurse duerfen die Klasse nicht zerreissen');

  // ── Die Mailaender Teilmenge: drei Klassen, die die drei Verwechslungen trennen ────────
  // A) Milan UND divergent -> zaehlt.  B) Milan, aber NICHT divergent -> zaehlt nicht.
  // C) divergent, aber OHNE Mailaender Bein -> zaehlt nicht.
  // Alle sechs Beine: gleiches Land, gleiche Aktienzahl -> nichts wird meldepflichtig, der
  // Bericht bleibt damit auf seinem Kopf ohne Klassen-Block und ist als Ganzes einfrierbar.
  // `b()` setzt `fx` auf 1, der Fingerabdruck rechnet also durch 1 zurueck (ENTSCHIED 72) —
  // die Teilmengen-Lage haengt an Namen und Reihen, nicht am Kurs.
  const teilmenge = [
    b('1AAA.MI', 'Alpha Industries', 'US', 100, 3), b('AAA', 'Zeta Holding', 'US', 100, 3),
    b('1BBB.MI', 'Beta Works', 'US', 100, 4), b('BBB', 'Beta Works', 'US', 100, 4),
    b('CCC', 'Gamma Group', 'US', 100, 5), b('CCC.DE', 'Delta Trust', 'US', 100, 5),
  ];
  // 7. die neue Kennzahl ist die UND-Verknuepfung, nicht eine der beiden Haelften
  z = zensus(teilmenge);
  assert.equal(z.klassen, 3);
  assert.equal(z.klassenDivergent, 2, 'A und C sind divergent, B nicht');
  assert.equal(z.klassenMitMilanBein, 2, 'A und B tragen ein Mailaender Bein, C nicht');
  assert.equal(z.klassenMitMilanBeinDivergent, 1, 'nur A erfuellt BEIDES');
  // 8. eine absichtliche Divergenz in B hebt die Zahl — ohne sie waere eine tote Kennzahl
  //    (konstant 0 oder konstant = klassenMitMilanBein) nicht von einer lebenden zu unterscheiden
  const gedriftet = teilmenge.map((x) => (x.ticker !== 'BBB' ? x
    : { ...x, name: 'Omega Beteiligungen', schluessel: issuerKeyLoose({ meta: { name: 'Omega Beteiligungen' } }) }));
  assert.equal(zensus(gedriftet).klassenMitMilanBeinDivergent, 2, 'die neue Divergenz in B muss ankommen');
  assert.equal(zensus(gedriftet).klassenMitMilanBein, 2, 'sie schafft aber keine neue Milan-Klasse');
  // 9. DIE ALTEN BERICHTSZEILEN SIND EINGEFROREN. Der Zensus ist ein Drift-Instrument: seine
  //    Monatsberichte (reports/fingerprint-zensus-*.txt) werden ueber Jahre verglichen. Die
  //    neue Zeile darf additiv dazukommen, keine bestehende darf sich um ein Byte bewegen.
  //    Der Kopf traegt seit ENTSCHIED 72 die Melde-Waehrungs-Ebene und die FX-Kurs-Zeile; beide
  //    sind hier mit eingefroren, damit ein stiller Rueckfall auf die konvertierte Ebene oder
  //    ein verschwundener FX-Ausweis genauso auffaellt wie eine verrutschte alte Zeile.
  const zeilen = bericht(zensus(teilmenge), 'FIXTURE', 0, 0).split('\n');
  assert.deepEqual(zeilen.slice(0, 9), [
    'O1-Fingerabdruck-Zensus ueber FIXTURE (Ebene: snapshot.timeseries, auf Melde-Waehrung zurueckgerechnet)',
    '  Snapshots .................... 6',
    '  ohne brauchbaren FX-Kurs ..... 0',
    '  belastbar (>=4 Umsatzquartale) ... 6',
    '  Fingerabdruck-Klassen (>=2) .. 3',
    '  davon divergente issuerKeyLoose 2',
    '  davon mit Mailaender Bein .... 2',
    '     davon divergent ........... 1',
    '  MELDEPFLICHTIG (§6.5) ........ 0',
  ], 'Berichtskopf byte-identisch, neue Zeile eingerueckt UNTER ihrer Obermenge');
  console.log('probe-fingerprint-zensus --selftest: 9 ok');
  return 0;
}

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const get = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
  const store = get('--store', path.join(__dirname, '..', 'snapshots'));
  let gelesen;
  try { gelesen = liesStore(store); }
  catch (e) {
    console.error(`::warning::probe-fingerprint-zensus — Bestand ${store} nicht lesbar (${e.message}). Nichts gemessen.`);
    return 0; // Messwerkzeug, kein Gate
  }
  const z = zensus(gelesen.beine);
  console.log(bericht(z, store, gelesen.unlesbar, gelesen.ohneKurs));

  const jsonArg = argv.find((a) => a === '--json' || a.startsWith('--json='));
  if (jsonArg) {
    const text = JSON.stringify({
      erzeugtAm: new Date().toISOString(),
      methode: {
        ebene: 'snapshot.timeseries, auf Melde-Waehrung zurueckgerechnet (x / meta.fxRateApplied)',
        fingerabdruck: 'timeseries.revenueQ + timeseries.grossProfitQ wertgleich',
        auflage: `mindestens ${MILAN_MIN_QUARTALE} endliche Umsatzquartale ungleich null`,
        sharesBand: MILAN_SHARES_BAND,
        meldepflicht: 'divergente issuerKeyLoose UND (Aktienzahl-Abstand > Band ODER verschiedenes Land)',
      },
      beineOhneKurs: gelesen.ohneKurs,
      zensus: z,
    }, null, 2);
    const ziel = jsonArg.indexOf('--json=') === 0 ? jsonArg.slice('--json='.length) : null;
    if (ziel) { fs.writeFileSync(ziel, text); console.log('\nJSON geschrieben: ' + ziel); }
    else console.log('\n' + text);
  }
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { sharesAbstand, zensus, liesStore, bericht, selftest, main };
