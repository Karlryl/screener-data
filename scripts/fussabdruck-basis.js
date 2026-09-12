#!/usr/bin/env node
/**
 * Basis-Fixture fuer den Fussabdruck-Vertrag - Gerichtsauflage 3 vom 23.08.
 *
 * Das Gericht hat den Vertrag unter anderem daran gekippt, dass er kein Substrat hat:
 * `snapshots/` ist gitignored, der PR-Check laedt keine. Zusammen mit "Skip != Pass" haette der
 * REGELBETRIEB rote Laeufe erzeugt - und ein roter Automatiklauf wirft den Freigabe-Zaehler
 * zurueck. Das war K6 und zaehlte nach der eingefrorenen Regel als toedlich.
 *
 * Dieses Fixture loest zugleich den ZWEITEN toedlichen Punkt (K5): der Codex-Richter hatte
 * beanstandet, dass eine absolute Zeilenzahl mit dem Universum waechst - dieselbe anteilige
 * Wirkung ergaebe morgen eine andere Zahl, und eine Deklaration von heute wuerde rot, ohne dass
 * jemand etwas geaendert hat. Wird gegen ein EINGEFRORENES Fixture geprueft statt gegen das
 * lebende Universum, gibt es kein Wachstum, gegen das die Zahl driften koennte.
 *
 * Was drinsteht, und nur das:
 *   - `linealHash`  : gegen welches Lineal gescort wurde (sonst misst man Lineal statt Code)
 *   - `zeilen`      : je Ticker [score, stabilHash] - der Score als Vergleichsgroesse, der
 *                     Hash als Beleg, dass der Eingang derselbe ist
 * KEINE Rohdaten, keine Snapshots, keine Kurse. Das Fixture ist ein Messpunkt, kein Datensatz.
 *
 * GRENZE, ehrlich: das Fixture erbt das Alter des Substrats, aus dem es gebaut wurde. Es ist
 * ein fester Referenzpunkt, kein aktuelles Marktbild - und genau deshalb taugt es zum Vergleich.
 *
 * Aufruf:  node scripts/fussabdruck-basis.js --schreiben [--ziel <pfad>]
 *          node scripts/fussabdruck-basis.js --pruefen             (Fixture gegen aktuellen Code)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');
const { scoreUniverse } = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');
const { inputHash } = require('../lib/input-hash.js');

const REPO = path.resolve(__dirname, '..');
const STANDARD_ZIEL = path.join(REPO, 'tests', 'fixtures', 'fussabdruck-basis.json');
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex').slice(0, 16);
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };

function ladeUniversum() {
  const dir = process.env.SCREENER_SNAPSHOTS_DIR || path.join(REPO, 'snapshots');
  const u = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !isMetadataSnapshot(x))) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (s && s.meta && s.meta.ticker) u.push(s);
    } catch (_) { /* unlesbar zaehlt nicht zum Universum */ }
  }
  return u;
}

function linealPfad() {
  return process.env.SCORING_REF_CALIB || path.join(REPO, 'board-history', '2026-08-19', 'calibration.json');
}

/** Misst den aktuellen Stand: Score und stabilen Eingangs-Hash je geroutetem Ticker. */
function messeStand() {
  const universum = ladeUniversum();
  if (universum.length < 100) {
    throw new Error(`Universum zu klein (${universum.length}) - ohne Substrat kein Fixture. Skip ist nicht Pass.`);
  }
  const lp = linealPfad();
  const lineal = JSON.parse(fs.readFileSync(lp, 'utf8'));
  const ergebnis = scoreUniverse(universum, formulas, { refCalibration: lineal });
  const stabilVon = {};
  for (const s of universum) stabilVon[s.meta.ticker] = inputHash(s).stabil;
  const zeilen = {};
  for (const e of ergebnis) {
    if (!e || e.action !== 'route' || !e.ticker) continue;
    if (!stabilVon[e.ticker]) continue;
    zeilen[e.ticker] = [e.score, stabilVon[e.ticker]];
  }
  return {
    schema: 'fussabdruck-basis/v1',
    linealHash: sha(JSON.stringify(lineal)),
    linealQuelle: path.relative(REPO, lp).split(path.sep).join('/'),
    universum: universum.length,
    geroutet: Object.keys(zeilen).length,
    zeilen,
  };
}

/** Vergleicht ein Fixture mit dem aktuellen Code. Gibt die Abweichungen zurueck, wirft nie. */
function pruefeGegenFixture(fixture) {
  const jetzt = messeStand();
  const abweichungen = [];
  if (fixture.linealHash !== jetzt.linealHash) {
    abweichungen.push(`linealHash: Fixture ${fixture.linealHash}, jetzt ${jetzt.linealHash} - `
      + 'gegen ein anderes Lineal gemessen, der Vergleich ist ungueltig (nicht falsch)');
  }
  let scoreAbweichend = 0, eingangAbweichend = 0, fehlend = 0, neu = 0;
  for (const [t, [score, stabil]] of Object.entries(fixture.zeilen)) {
    const j = jetzt.zeilen[t];
    if (!j) { fehlend++; continue; }
    if (j[1] !== stabil) { eingangAbweichend++; continue; }   // Eingang bewegt -> nicht dem Code zuzurechnen
    if (j[0] !== score) scoreAbweichend++;
  }
  for (const t of Object.keys(jetzt.zeilen)) if (!fixture.zeilen[t]) neu++;
  return { abweichungen, scoreAbweichend, eingangAbweichend, fehlend, neu, jetzt };
}

module.exports = { messeStand, pruefeGegenFixture, STANDARD_ZIEL };

if (require.main === module) {
  const ziel = arg('--ziel', STANDARD_ZIEL);
  try {
    if (process.argv.includes('--schreiben')) {
      const f = messeStand();
      fs.mkdirSync(path.dirname(ziel), { recursive: true });
      // indent 0: das Fixture wird maschinell gelesen, nicht gelesen-gelesen.
      fs.writeFileSync(ziel, JSON.stringify(f));
      const kb = (fs.statSync(ziel).size / 1024).toFixed(1);
      console.log(`Fixture geschrieben: ${path.relative(REPO, ziel)}  ${kb} KB  `
        + `(${f.geroutet} geroutete Zeilen aus ${f.universum} Snapshots, Lineal ${f.linealHash})`);
      process.exit(0);
    }
    if (process.argv.includes('--pruefen')) {
      const f = JSON.parse(fs.readFileSync(ziel, 'utf8'));
      const r = pruefeGegenFixture(f);
      console.log(JSON.stringify({
        linealAbweichung: r.abweichungen, scoreAbweichend: r.scoreAbweichend,
        eingangAbweichend: r.eingangAbweichend, fehlend: r.fehlend, neu: r.neu,
      }, null, 1));
      process.exit(r.scoreAbweichend > 0 ? 1 : 0);
    }
    console.error('Aufruf: node scripts/fussabdruck-basis.js --schreiben | --pruefen [--ziel <pfad>]');
    process.exit(2);
  } catch (err) {
    console.error('::error::' + err.message);
    process.exit(2);
  }
}
