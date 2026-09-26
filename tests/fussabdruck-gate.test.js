'use strict';
/**
 * Entscheidungs-Waechter fuer T153 (B3-Retrial-Auflage vom 25.08.).
 *
 * Die alte Suite importierte nur fussabdruck(); pruefen(), seine Vergleichsfelder und der
 * Prozess-Exit waren unberuehrt. Dieser Test ruft deshalb denselben CLI-Befehl wie das Gate
 * auf: `node scripts/fussabdruck.js --pruefen <deklaration> ...` — einmal gruen und einmal
 * gezielt falsch. Geprueft werden Exit-Status UND die benannte Abweichung.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { FIELD_REGISTRY } = require('../src/scoring/snapshot.js');
const { fussabdruck, abweichungenFuer } = require('../scripts/fussabdruck.js');

const REPO = path.resolve(__dirname, '..');

function valueSeries(i, j) {
  const current = 120 + ((i * (j + 7) + j * 13) % 190);
  const growth = 1.02 + (((i * (j + 3)) % 35) / 100);
  return [current, current / growth, current / (growth * growth)].map((value) => ({ value }));
}

function schreibeUniversum(dir, n = 120) {
  const snapshotDir = path.join(dir, 'snapshots');
  fs.mkdirSync(snapshotDir);
  for (let i = 0; i < n; i++) {
    const ticker = `T153-${String(i).padStart(3, '0')}`;
    const snapshot = {
      meta: {
        ticker, name: `T153 Canonical ${String(i).padStart(3, '0')} AG`,
        sector: 'Technology', industry: i % 3 === 0 ? 'Semiconductors' : 'Software - Infrastructure',
        country: 'United States', region: 'US', exchangeName: i % 2 ? 'NYSE' : 'NasdaqGS',
        ipoYear: 2005 + (i % 18), firstTradeDate: `${2005 + (i % 18)}-06-01T00:00:00.000Z`,
        reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD', tradingCurrency: 'USD',
      },
      marketCap: { value: 3e9 + i * 7e7 },
      metrics: {
        beta: { value: 0.7 + (i % 17) / 10 }, forwardPE: { value: 12 + (i % 29) },
        revenueTTM: { value: 500 + i * 11 },
      },
      external: {}, annual: {},
      timeseries: { revenueQEnds: ['2026-03-31', '2025-12-31', '2025-09-30'] },
    };
    let j = 0;
    for (const [field, [container, format]] of Object.entries(FIELD_REGISTRY)) {
      snapshot[container] ||= {};
      if (format === 'value') snapshot[container][field] = valueSeries(i, j);
      else if (format === 'scalar') snapshot[container][field] = valueSeries(i, j).map((x) => x.value);
      else snapshot[container][field] = [{ cash: 30 + i, totalDebt: 20 + (i % 11), totalAssets: 400 + i * 3 }];
      j++;
    }
    fs.writeFileSync(path.join(snapshotDir, `${ticker}.json`), JSON.stringify(snapshot));
  }
  return snapshotDir;
}

function cli(args, env) {
  return spawnSync(process.execPath, ['scripts/fussabdruck.js', ...args], {
    cwd: REPO, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 30_000,
  });
}

test('pruefen() entscheidet nach Anteil, nicht nach absoluter Zeilenzahl', () => {
  const bau = (n, bewegt) => {
    const hashes = {}, basis = {}, kandidat = {};
    for (let i = 0; i < n; i++) {
      const ticker = `P${String(i).padStart(2, '0')}`;
      hashes[ticker] = 'gleich'; basis[ticker] = 50; kandidat[ticker] = i < bewegt ? 55 : 50;
    }
    return fussabdruck(basis, kandidat, hashes);
  };
  const klein = bau(10, 2), gross = bau(20, 4);
  assert.equal(klein.anteilBewegt, gross.anteilBewegt, 'Probe hat nicht denselben Anteil');
  assert.notEqual(klein.zeilenMitScoreAenderung, gross.zeilenMitScoreAenderung,
    'Probe hat nicht verschiedene absolute Zahlen');

  const mitFalscherAbsolutzahl = (gemessen) => ({
    ...gemessen, zeilenMitScoreAenderung: gemessen.zeilenMitScoreAenderung + 1000,
  });
  assert.deepEqual(abweichungenFuer(mitFalscherAbsolutzahl(klein), klein), [],
    '2/10 wird allein wegen der absoluten Zahl rot');
  assert.deepEqual(abweichungenFuer(mitFalscherAbsolutzahl(gross), gross), [],
    '4/20 wird allein wegen der absoluten Zahl rot');
  const falscherAnteil = { ...klein, anteilBewegt: 0.3 };
  assert.deepEqual(abweichungenFuer(falscherAnteil, klein), ['anteilBewegt: deklariert 0.3, gemessen 0.2']);
});

test('CLI-Gate prueft richtige und falsche Deklaration samt Exit und benannter Abweichung', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fussabdruck-gate-'));
  const snapshots = schreibeUniversum(temp);
  const env = { SCREENER_SNAPSHOTS_DIR: snapshots };
  const messung = cli(['--messen', '--achse', 'gpGrowth', '--faktor', '1.10'], env);
  assert.equal(messung.status, 0, `Messvorlauf scheitert:\n${messung.stdout}\n${messung.stderr}`);
  const gemessen = JSON.parse(messung.stdout).gemessen;
  assert.ok(gemessen.zeilenMitScoreAenderung > 0, 'Probe erzeugt keinen entscheidbaren Fussabdruck');

  const richtig = path.join(temp, 'richtig.json');
  const falsch = path.join(temp, 'falsch.json');
  fs.writeFileSync(richtig, JSON.stringify({ erwartet: gemessen }));
  fs.writeFileSync(falsch, JSON.stringify({ erwartet: { ...gemessen, deltaVektorHash: 'T153-FALSCH' } }));

  const gruen = cli(['--pruefen', richtig, '--achse', 'gpGrowth', '--faktor', '1.10'], env);
  assert.equal(gruen.status, 0, `richtige Deklaration wird abgelehnt:\n${gruen.stdout}\n${gruen.stderr}`);
  assert.match(gruen.stdout, /Fussabdruck entspricht der Deklaration\./,
    'Gruenpfad nennt das Gate-Ergebnis nicht');

  const rot = cli(['--pruefen', falsch, '--achse', 'gpGrowth', '--faktor', '1.10'], env);
  assert.equal(rot.status, 1, `falsche Deklaration liefert Exit ${rot.status}:\n${rot.stdout}\n${rot.stderr}`);
  assert.match(rot.stderr, /deltaVektorHash: deklariert T153-FALSCH, gemessen [0-9a-f]{16}/,
    'Rotpfad nennt die konkrete deltaVektorHash-Abweichung nicht');
});
