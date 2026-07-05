export const meta = {
  name: 'phaseA-formula-audit',
  description: 'Prueft alle 12 Sektor-Formeln (Achsen/Gewichte/splitMetric/alpha) auf Konsistenz, Reste + Sinnhaftigkeit. 12 Pruefer + Synthese.',
  phases: [
    { title: 'Pruefer', detail: '1 Pruefer je Sektor-Formel, Batch 6' },
    { title: 'Synthese', detail: 'Gesamturteil: sauber oder Probleme' },
  ],
};

const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';

const CONTEXT = `
Screener: hypergrowth-Scoring (Node.js), Branch loop/hypergrowth-neu @ 15cc23eca4. REPO: ${REPO}.
node: "C:/Program Files/nodejs/node.exe". Formel-Dateien: src/scoring/formulas/<sektor>.js — je eine
duenne Deklaration: id, splitMetric ('OpInc'/'FCF'/'NetIncome'/'none'), alpha (Rule-of-X), axes[] mit
{key, w:{profitable,unprofitable}}. Es gibt jetzt 7 Achsen (revisionsMomentum/Analysten wurde per Karl-
Direktive aus ALLEN Formeln entfernt): revGrowthLevel, revAcceleration, gpGrowth, ruleOfX,
marginTrajectory, capitalEfficiency, dilution. Gewichte muessen NICHT auf 1 summieren (weightedScore
renormiert). Die Engine (routing, q()-Perzentil, renorm-on-drop, Track-Split, Lampen, C4-Coverage-
Shrinkage, Burn-Press) ist generisch — die Formel liefert NUR Gewichte + splitMetric + alpha.

KARL-ZIEL: junge, stark WACHSENDE Firmen surfacen (CRDO/ALAB/BE-Typ), reife Langsam-Wachser (Novo/SAP)
sinken lassen; Wachstum dominiert. 7 INVARIANTEN (bes. keine Magic Numbers / keine aufgezwungenen Niveaus).

PRUEFE DEINEN SEKTOR (%SECTOR%): (a) hat die Formel GENAU die 7 Achsen (kein revisionsMomentum-Rest,
keine fehlende/doppelte Achse, kein Tippfehler im key)? (b) sind die Gewichte SINNVOLL fuer Hypergrowth
(Wachstums-Achsen dominant? plausible Verhaeltnisse? kein 'Rest'-Gewicht von der Analysten-Entfernung,
das jetzt eine Achse unplausibel dominiert — z.B. materials hatte revisionsMomentum=2.4)? (c) ist
splitMetric fuer den Sektor richtig (OpInc/FCF/NetIncome/none)? (d) alpha plausibel? (e) node-Check:
scoreUniverse laufen lassen, die Top-5 profitable + Top-5 unprofitable dieses Sektors ansehen —
ergeben sie fuer einen Hypergrowth-Screener Sinn, oder rankt etwas Unplausibles oben (reifer Langsam-
Wachser, Nicht-Wachstums-Name)? Lies die ECHTE Formel-Datei + rechne mit node. Erfinde nichts.`;

const SECTORS = ['semiconductors', 'software-comm-services', 'health-care', 'consumer-discretionary',
  'consumer-staples', 'industrials', 'financials', 'energy', 'utilities', 'materials', 'real-estate', 'it-services'];

const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    sector: { type: 'string' },
    clean: { type: 'boolean' },
    axesOk: { type: 'boolean', description: 'genau 7 korrekte Achsen, kein Rest/Fehler' },
    weightsSensible: { type: 'boolean' },
    splitMetricOk: { type: 'boolean' },
    topNamesPlausible: { type: 'string', description: 'Top-Namen + ob sie fuer Hypergrowth Sinn ergeben' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { severity: { type: 'string', enum: ['high', 'medium', 'low', 'note'] }, issue: { type: 'string' }, evidence: { type: 'string' } },
        required: ['severity', 'issue', 'evidence'],
      },
    },
  },
  required: ['sector', 'clean', 'axesOk', 'weightsSensible', 'splitMetricOk', 'topNamesPlausible', 'findings'],
};
const SYNTH_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['ALLE_SAUBER', 'PROBLEME'] },
    sectorsClean: { type: 'number' }, sectorsWithIssues: { type: 'array', items: { type: 'string' } },
    highlights: { type: 'array', items: { type: 'string' }, description: 'die wichtigsten Befunde ueber alle Sektoren' },
    crossCutting: { type: 'string', description: 'sektor-uebergreifende Muster (z.B. Analysten-Rest, unplausible Gewichts-Dominanz)' },
    summary: { type: 'string' },
  },
  required: ['verdict', 'sectorsClean', 'sectorsWithIssues', 'highlights', 'crossCutting', 'summary'],
};

phase('Pruefer');
let reviews = [];
for (let i = 0; i < SECTORS.length; i += 6) {
  const batch = SECTORS.slice(i, i + 6);
  const res = await parallel(batch.map((sec) => () =>
    agent(`${CONTEXT.replace('%SECTOR%', sec)}

DEIN SEKTOR: ${sec} (Datei src/scoring/formulas/${sec}.js). Gib REVIEW_SCHEMA zurueck.`,
      { schema: REVIEW_SCHEMA, label: 'formel:' + sec, phase: 'Pruefer' })));
  reviews.push(...res.filter(Boolean));
  log(`Pruefer-Batch ${i / 6 + 1}/2: ${res.filter(Boolean).length}/${batch.length}`);
}

phase('Synthese');
const brief = reviews.map((r) => `### ${r.sector} — clean=${r.clean} axesOk=${r.axesOk} weightsSensible=${r.weightsSensible} splitOk=${r.splitMetricOk}\ntopNames: ${r.topNamesPlausible}\nfindings: ${r.findings.map((f) => `[${f.severity}] ${f.issue} (${f.evidence})`).join(' | ') || '(keine)'}`).join('\n\n');
const synth = await agent(`${CONTEXT.replace('%SECTOR%', 'ALLE')}

Unten die 12 Sektor-Reviews. Synthese: sind ALLE 12 Formeln sauber (7 korrekte Achsen, sinnvolle Gewichte,
richtiger splitMetric, plausible Top-Namen) oder gibt es Probleme? Sei streng bei sektor-uebergreifenden
Mustern (Analysten-Entfernungs-Reste, unplausible Gewichts-Dominanz, falsche splitMetrics). Gib SYNTH_SCHEMA.

DIE 12 REVIEWS:
${brief}`, { schema: SYNTH_SCHEMA, label: 'synthese', phase: 'Synthese' });

return { reviews: reviews.map((r) => ({ sector: r.sector, clean: r.clean, findings: r.findings })), synthesis: synth };
