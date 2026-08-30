'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pruefePins } = require('./helpers/pin-abdeckung.js');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'studie-descriptive-closure-audit.py');
const REGISTRATION = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'd6-descriptive-closure-audit-registration.json');
const ARTIFACT = path.join(REPO, 'reports', 'studie',
  'D6-descriptive-closure-audit-2026-08-23.json');
const REPORT = path.join(REPO, 'reports', 'studie',
  'D6-descriptive-closure-audit-2026-08-23.md');
const THRESHOLD_SEAL = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'r2-d-threshold-seal.json');

const REQUIRED = [
  'Historische 21 Quellen und aktuelle Schwellen-Skripte sind beide exakt',
  'Fixture-D1 geht als vier plus sechs gleich zehn auf',
  'Fixture-Groessenrichtung bleibt ueber drei Deskriptoren konsistent',
  'Fixture-Sektorflag widerspricht sich sichtbar zwischen D2 und D4',
  'Fixture-Kennungsbruecke geht als zwei plus zwei gleich vier auf',
  'Fixture-Kadenz und Kohorte bleiben gemeinsam als offene Flags sichtbar',
  'Null Fehler laesst den Auditvertrag bestehen',
  'Ein absichtlicher Fehler kippt den Auditvertrag rot',
  'Ein anderes empirisches Flag ist kein Integritaetsfehler',
  'Vier Urteilsfragen bleiben ausschliesslich bei Claude',
  'D6 oeffnet null Panels und erzeugt null neue Beobachtungen',
  'Alle fuenf Quellberichte tragen Ergebniszeile und Pflichtgrenze',
  'D6 schreibt keine Firmenidentitaet',
];

test('D6: der Fixture-Selbsttest ist benannt, zaehlbar und gruen', () => {
  const run = spawnSync(process.env.PYTHON || 'python', [SCRIPT, '--self-test'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const green = new Set(run.stdout.split(/\r?\n/)
    .filter((line) => /^\s{2}ok\s{4}/.test(line))
    .map((line) => line.replace(/^\s{2}ok\s{4}/, '').trim()));
  assert.deepEqual(REQUIRED.filter((name) => !green.has(name)), []);
  assert.equal(green.size, 13);
  assert.match(run.stdout, /SELBSTTEST GRUEN - 13 benannte Pruefungen/);
});

test('D6: Auditvertrag ist ehrlich nach D1-D5-Publikation eingefroren', () => {
  const registration = JSON.parse(fs.readFileSync(REGISTRATION, 'utf8'));
  assert.equal(registration.status,
    'FROZEN_BEFORE_D6_ASSEMBLY_AFTER_D1_D5_PUBLICATION');
  assert.equal(Object.keys(registration.sourceFiles).length, 21);
  assert.match(registration.auditStatistic, /number of .* failures/);
  assert.match(registration.nullModel, /zero integrity failures/);
  assert.match(registration.threshold, /one or more failures/);
  assert.match(registration.interpretationPolicy, /may not choose a study verdict/);
});

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('D6: alle einundzwanzig Quellen und der Auditvertrag sind bytegleich', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const registration = JSON.parse(fs.readFileSync(REGISTRATION, 'utf8'));
  const thresholdSeal = JSON.parse(fs.readFileSync(THRESHOLD_SEAL, 'utf8'));
  assert.equal(result.registration.sha256, sha256(REGISTRATION));
  assert.equal(Object.keys(result.sourceFiles).length, 21);
  assert.deepEqual(result.sourceFiles, registration.sourceFiles,
    'Historische D6-Quellbindung im Artefakt muss unveraendert bleiben');
  // N13-Klasse (Nachtlauf 30.08.): der bisherige `|| expected`-Rueckfall machte den Pin bei
  // einem Schluessel-Tippfehler zur Tautologie - der Eintrag fiel still auf den historischen
  // Hash zurueck und der Test blieb gruen. Verhalten unveraendert, aber die ABDECKUNG ist
  // jetzt eine gepinnte Groesse: ein Tippfehler verschiebt einen Eintrag von `ueberSiegel`
  // nach `historisch` UND erzeugt eine Waise, bricht also gleich zwei Zaehler.
  const abdeckung = pruefePins(REPO, result.sourceFiles, thresholdSeal.currentScripts);
  // Review-Fund 30.08.: NUR die Groesse zu pinnen reicht nicht. Zwei gleichzeitige Aenderungen
  // (ein Schluessel verliert seinen Pin, ein anderer bekommt einen) halten die Zaehler konstant,
  // waehrend sich die Menge komplett verschiebt. Gepinnt wird deshalb die MITGLIEDSCHAFT.
  // Review-Fund 30.08.: NUR die Groesse zu pinnen reicht nicht. Zwei gleichzeitige Aenderungen
  // (ein Schluessel verliert seinen Pin, ein anderer bekommt einen) halten die Zaehler konstant,
  // waehrend sich die Menge komplett verschiebt. Gepinnt wird deshalb die MITGLIEDSCHAFT.
  assert.deepEqual(abdeckung.ueberSiegel.slice().sort(), [
    'scripts/studie-attrition-size-sector.py',
    'scripts/studie-censoring-aware-attrition.py',
    'scripts/studie-entry-cohort-standardization.py',
  ],
    'D6: WELCHE Dateien ueber das aktuelle Siegel gepinnt sind — nicht nur wie viele');
  assert.deepEqual(abdeckung.waisen.slice().sort(), [
    'scripts/studie-threshold-seal.py',
  ],
    'D6: WELCHE Siegel-Schluessel in dieser Bindung fehlen (Schwester-Waechter oder gar keine Bindung)');
  // Der historische Rest ist abgeleitet: Bindung minus Siegel-Pins. Eine eigene Liste waere
  // hier 18 Zeilen Literal ohne Zusatznutzen — die Verschiebung faengt schon die Menge oben.
  assert.equal(abdeckung.historisch.length, 18,
    'D6: Anzahl der auf den historischen Hash gebundenen Dateien');
});

test('D6: Null-Fehler-Vertrag und Scope schließen ohne neue Daten', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  assert.deepEqual(result.auditContract, {
    failures: [],
    nullModel: 'zero integrity failures',
    observedFailures: 0,
    passes: true,
    testStatistic: 'integrity failure count',
    threshold: 'one or more failures fails closed',
  });
  assert.deepEqual(result.scope, {
    companyIdentifiersWritten: 0,
    companyLevelRecordsRead: 0,
    newEmpiricalObservations: 0,
    panelFilesOpened: 0,
    signalsChanged: 0,
    thresholdsChanged: 0,
    verdictsChanged: 0,
  });
  assert.ok(Object.values(result.crossChecks).every(Boolean));
});

test('D6: Schlagzahlen sind gegen D1-D5 neu gerechnet und geschlossen', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const sources = ['D1-panel-survival', 'D2-attrition-size-sector',
    'D3-identifier-bridge', 'D4-censoring-aware-attrition',
    'D5-entry-cohort-standardization'];
  const [d1, d2, d3, d4, d5] = sources.map((name) => JSON.parse(fs.readFileSync(
    path.join(REPO, 'reports', 'studie', `${name}-2026-08-23.json`), 'utf8')));
  assert.equal(result.headlines.d1.companies, d1.counts.companies);
  assert.equal(result.headlines.d1.medianStayQuarters, d1.medianStayQuarters);
  assert.equal(result.headlines.d2.rawSizeAttritionDifferencePercentagePoints,
    d2.size.riskDifferencePercentagePointsSmallerMinusLarger);
  assert.equal(result.headlines.d2.sectorCramersV, d2.sector.cramersV);
  const target = d3.results.find((row) => row.window === 'pruefung'
    && row.arm === 'signal');
  assert.equal(result.headlines.d3.targetIdentityOnlyRecovered, target.identityOnlyRecovered);
  assert.equal(result.headlines.d3.targetRemainingAttrition, target.remainingAttrition);
  assert.equal(result.headlines.d3.targetIdentityOnlyRecovered
    + result.headlines.d3.targetRemainingAttrition,
  result.headlines.d3.targetAttritionBeforeBridge);
  assert.equal(result.headlines.d4.sizeSurvivalDifferencePercentagePoints,
    d4.size.survivalDifferencePercentagePointsSmallerMinusLarger);
  assert.equal(result.headlines.d4.sectorSurvivalRangePercentagePoints,
    d4.sector.maxMinusMinSurvivalPercentagePoints);
  assert.equal(result.headlines.d5.standardizedSizeSurvivalDifferencePercentagePoints,
    d5.standardizedSize.survivalDifferencePercentagePointsSmallerMinusLarger);
  assert.equal(result.headlines.d5.entryCohortRangePercentagePoints,
    d5.entryCohorts.maxMinusMinSurvivalPercentagePoints);
});

test('D6: jede Schlagzahl und Urteilsfrage im Bericht stammt aus dem Artefakt', () => {
  const result = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const report = fs.readFileSync(REPORT, 'utf8');
  const firstLine = report.split(/\r?\n/)[0];
  assert.ok(firstLine.includes(`${result.auditContract.observedFailures} Integritätsfehlern`));
  assert.ok(firstLine.includes(`${Object.keys(result.sourceFiles).length} bytegebundene`));
  assert.ok(firstLine.includes(`${result.scope.panelFilesOpened} Paneldateien`));
  assert.ok(firstLine.includes(`${result.reviewQueue.length} Urteilsfragen`));

  const expectedLines = [
    `| D1 | Firmen | ${result.headlines.d1.companies} |`,
    `| D1 | terminale Ausstiege | ${result.headlines.d1.terminalExits} |`,
    `| D1 | rechtszensiert | ${result.headlines.d1.rightCensored} |`,
    `| D1 | Median Verweildauer | ${result.headlines.d1.medianStayQuarters} Quartale |`,
    `| D2 | rohe Schwunddifferenz smaller minus larger | ${result.headlines.d2.rawSizeAttritionDifferencePercentagePoints.toFixed(12)} Prozentpunkte |`,
    `| D2 | Sektor Cramérs V | ${result.headlines.d2.sectorCramersV.toFixed(12)} |`,
    `| D3 | S-U-Prüfsignal Firmen beim ersten Ereignis | ${result.headlines.d3.targetFirstEventCompanies} |`,
    `| D3 | Schwund vor Kennungsbrücke | ${result.headlines.d3.targetAttritionBeforeBridge} |`,
    `| D3 | reine Kennungsfälle zurückgewonnen | ${result.headlines.d3.targetIdentityOnlyRecovered} |`,
    `| D3 | verbleibender Schwund | ${result.headlines.d3.targetRemainingAttrition} |`,
    `| D3 | verbleibende Schwundquote | ${(100 * result.headlines.d3.targetRemainingAttritionRate).toFixed(6)} % |`,
    `| D3 | Retention nach Brücke | ${(100 * result.headlines.d3.targetRetentionAfterBridge).toFixed(6)} % |`,
    `| D4 | Survivaldifferenz smaller minus larger | ${result.headlines.d4.sizeSurvivalDifferencePercentagePoints.toFixed(12)} Prozentpunkte |`,
    `| D4 | Sektorspannweite Survival Q12 | ${result.headlines.d4.sectorSurvivalRangePercentagePoints.toFixed(12)} Prozentpunkte |`,
    `| D5 | standardisierte Survivaldifferenz smaller minus larger | ${result.headlines.d5.standardizedSizeSurvivalDifferencePercentagePoints.toFixed(12)} Prozentpunkte |`,
    `| D5 | absolute Verschiebung gegenüber D4 | ${result.headlines.d5.absoluteShiftFromD4PercentagePoints.toFixed(12)} Prozentpunkte |`,
    `| D5 | Kadenzdifferenz annual minus quarterly | ${result.headlines.d5.cadenceDifferencePercentagePoints.toFixed(12)} Prozentpunkte |`,
    `| D5 | Eintrittskohorten-Spannweite | ${result.headlines.d5.entryCohortRangePercentagePoints.toFixed(12)} Prozentpunkte |`,
  ];
  for (const line of expectedLines) {
    assert.ok(report.includes(line), `Schlagzahl fehlt: ${line}`);
  }
  for (const item of result.reviewQueue) {
    assert.ok(report.includes(`| ${item.key} |`), `Urteilsfrage fehlt: ${item.key}`);
    assert.equal(item.decisionOwner, 'Claude');
    assert.equal(item.resolvedByD6, false);
  }
  const limitation = report.split('## Was ausdrücklich nicht gezeigt ist')[1];
  assert.ok(limitation && limitation.trim().length > 0,
    'Pflichtabschnitt "Was ausdrücklich nicht gezeigt ist" fehlt oder ist leer');
});
