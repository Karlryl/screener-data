export const meta = {
  name: 'phaseA-court-r3-C4',
  description: 'Court R3 Fall C4 (renorm-on-drop Varianz-Artefakt) — Wiederholung nach Rate-Limit-Tod der Synthese. 3 Richter + Ober-Richter.',
  phases: [
    { title: 'Richter', detail: '3 Perspektiv-Richter (methodik/robustheit/anker)' },
    { title: 'Ober-Richter', detail: 'Synthese: geblesste Fix-Richtung' },
  ],
};

const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';

const COMMON = `
Du bist Richter im COURT für den hypergrowth-Scoring-Screener (Node.js), Branch loop/hypergrowth-neu
@ cd4413d1f8. REPO: ${REPO}. node: "C:/Program Files/nodejs/node.exe". Snapshots: ${REPO}/snapshots/
(4683 .json, flaches norm()-Format). Lies den ECHTEN Code (engine.js weightedScore Z.57-71, score.js
Achsen-Sammlung+Scoring Z.~180-300, axes.js) + rechne mit node, übernimm NICHTS blind.

7 METHODIK-INVARIANTEN (Verletzung = Veto): 1 Discovery/Validation-Mauer. 2 Präregistrierung. 3 KEINE
aufgezwungenen Niveaus (Magic Numbers — Schwellen AUS DATEN gelernt). 4 Stationarität + effektives N
(5000 Aktien ≠ 5000 unabhängige Samples). 5 Struktur statt Zeit. 6 Nullmodell-Pflicht. 7 Multiple-Testing-
Ehrlichkeit (FDR). PLUS: renorm-on-drop nie Fake-50; FIELD_REGISTRY-Shapes sind Vertrag; Determinismus
CI==lokal; Anker (PLTR/CRDO/ALAB/BE + 2383.TW/2308.TW/WTC.AX) müssen plausibel bleiben; Anker-Fixture nur
mit ALLOW_FIXTURE_CHANGE=1+Bless.

Baseline (HEAD cd4413d1f8): route 3343, survival 74, data-suspect 30, PLTR 79.7 / CRDO 77.0 / ALAB 70.9 /
BE 61.5 / 2383.TW 89.3 / 2308.TW 87.6 / WTC.AX 92.0, 196 Tests grün.

DEINE PERSPEKTIVE: %PERSPECTIVE%
- methodik: methodisch sauber ggü Inv. 4 (effektives N) + 7 (FDR/Falsch-Entdeckung)? Welche Variante
  eliminiert das Tail-Artefakt ohne Magic Number / aufgezwungenes Niveau?
- robustheit: Edge-Cases, Implementierbarkeit (zweistufige Kohorten-Sammlung?), Determinismus,
  Regressionsgefahr, Test-Strategie. Robusteste Variante ohne neue Annahme?
- anker: Anker-Wirkung. Die 4 US-Anker (8/8 Achsen) ranken aktuell auf 137/181/>200/>200 — ein Fix der
  Niedrig-Achsen-Inflation hebt sie. Plausibel? Rebless-Umfang? Konservativste Linie.

Gib JUDGE_SCHEMA: isReal, decision (fix-now/fix-with-rebless/defer-deploy/reject), fixDirection (konkret,
data-learned, KEINE Magic Number), anchorRisk, rebless, rePull, invariantConcern, reasoning.`;

const CASE = {
  id: 'C4-renorm-variance',
  title: 'renorm-on-drop Achsenzahl→Score-Varianz-Artefakt (+ Fall-3-Verstärkung) — TIEFSTER Befund',
  body: `Der wichtigste methodische Befund (R3-Audit, 3/3-Skeptiker bestätigt). renorm-on-drop (engine.js:
57-71 weightedScore + score.js Achsen-Sammlung/Scoring): fehlt einer Achse der Wert, wird über die übrigen
renormiert. FOLGE: Score-Std fällt MONOTON mit der Achsenzahl — 1-Achse Std=31.0 → 8-Achsen Std=13.5;
P(score≥85) 33%→0.5%; KEIN 8/8-Name erreicht je ≥90. 40% der ≥90-Namen haben ≤4 Achsen (3.6x Tail-
Übergewicht). Overview-Top-30 voll von 2-6/8-Achsen-Namen (0489.HK 3/8 @96.9 Rang1, 7012.T 2/8 @94.8);
ALLE 4 Anker (8/8 Achsen) auf 137/181/>200/>200. Namen mit WENIGER Daten gewinnen die Spitze — effektives
N pro Name ignoriert → klassische FALSCH-ENTDECKUNG (Inv. 4+7). KEIN per-Name Mindest-Achsen-/Coverage-Gate.
Fall-3 (capEff drop-on-absence) VERSTÄRKT das: höchstgewichtete Achse für 41.9% NEU gedroppt → 42% in den
Hochvarianz-Niedrig-Achsen-Bereich; capEff-absent stellt 71/100 der Top-100.

ENTSCHEIDUNGS-RAUM (Kern = effektives-N/Falsch-Entdeckung, Inv. 4+7; KEINE Magic Number, kein aufgezwungenes
Niveau): (a) per-Name Mindest-Achsen-COVERAGE-Gate: Namen mit < K (data-gelernt) present-Achsen bzw. < X%
des Achsen-Gewichts aus dem Ranking halten oder klar flaggen (analog data-suspect, aber coverage-basiert).
(b) Coverage-/Shrinkage-Penalty: Score Richtung Kohorten-Median schrumpfen proportional zum FEHLENDEN
Achsen-Gewicht (James-Stein-artig, data-learned — die Schrumpfung folgt aus dem fehlenden Gewicht, keine
freie Konstante). (c) Varianz-Normalisierung innerhalb Achsenzahl-Strata. (d) Kombination a+b.
Welche Variante eliminiert das Tail-Artefakt methodisch sauber, data-learned, OHNE legitime daten-reiche
Namen zu bestrafen? Anker (8/8) würden steigen — Rebless-Umfang? Wie interagiert die Wahl mit Fall-3 (capEff-
Drop bleiben + Coverage-Gate ergänzen, oder anders)? WICHTIG: am echten Code verifizieren, wie score.js die
Achsen sammelt und renormiert (zweistufig wie q()), damit die Fix-Richtung implementierbar+deterministisch ist.`,
};

const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    isReal: { type: 'boolean' },
    decision: { type: 'string', enum: ['fix-now', 'fix-with-rebless', 'defer-deploy', 'reject'] },
    fixDirection: { type: 'string' },
    anchorRisk: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    rebless: { type: 'boolean' },
    rePull: { type: 'boolean' },
    invariantConcern: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['isReal', 'decision', 'fixDirection', 'anchorRisk', 'rebless', 'rePull', 'invariantConcern', 'reasoning'],
};

const CHIEF_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    caseId: { type: 'string' },
    isReal: { type: 'boolean' },
    decision: { type: 'string', enum: ['fix-now', 'fix-with-rebless', 'defer-deploy', 'reject'] },
    blessedFixDirection: { type: 'string' },
    anchorRisk: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    rebless: { type: 'boolean' },
    rePull: { type: 'boolean' },
    dissent: { type: 'string' },
    invariantCheck: { type: 'string' },
    implementationOrder: { type: 'string', enum: ['stufe1-autonom', 'stufe2-rebless', 'stufe3-deploy'] },
    fall3Interaction: { type: 'string', description: 'wie der Fix mit Court-R2-Fall-3 (capEff drop-on-absence) interagiert' },
  },
  required: ['caseId', 'isReal', 'decision', 'blessedFixDirection', 'anchorRisk', 'rebless', 'rePull', 'dissent', 'invariantCheck', 'implementationOrder', 'fall3Interaction'],
};

const PERSPECTIVES = ['methodik', 'robustheit', 'anker'];
phase('Richter');
const votes = (await parallel(PERSPECTIVES.map((p) => () =>
  agent(`${COMMON.replace('%PERSPECTIVE%', p)}

FALL ${CASE.id} — ${CASE.title}
${CASE.body}

Verifiziere am echten Code+node, dann urteile aus der ${p}-Perspektive.`,
    { schema: JUDGE_SCHEMA, label: `C4:${p}`, phase: 'Richter' }).then((v) => ({ p, ...v }))))).filter(Boolean);

phase('Ober-Richter');
const voteBrief = votes.map((v) => `[${v.p}] isReal=${v.isReal} decision=${v.decision} anchorRisk=${v.anchorRisk} rebless=${v.rebless} rePull=${v.rePull} invariant=${v.invariantConcern}\n  fixDir: ${v.fixDirection}\n  reason: ${v.reasoning}`).join('\n\n');
const chief = await agent(`${COMMON.replace('%PERSPECTIVE%', 'OBER-RICHTER (Synthese aus 3 Voten)')}

FALL ${CASE.id} — ${CASE.title}
${CASE.body}

DIE 3 RICHTER-VOTEN:
${voteBrief}

Fälle das Urteil: Mehrheit, bei Split die methodisch konservativste Linie (Falsch-Entdeckung verhindern >
Feature). blessedFixDirection KONKRET umsetzbar + data-learned (KEINE Magic Number). invariantCheck:
explizit Inv. 3+4+7. fall3Interaction: wie interagiert der Fix mit capEff drop-on-absence. Gib CHIEF_SCHEMA.`,
  { schema: CHIEF_SCHEMA, label: 'chief:C4', phase: 'Ober-Richter' });

return { decision: chief, votes: votes.map((v) => ({ p: v.p, decision: v.decision, fixDirection: v.fixDirection, anchorRisk: v.anchorRisk, reasoning: v.reasoning })) };
