export const meta = {
  name: 'phaseA-court-burnpress',
  description: 'Court: veto-sicherer Score-ABZUG fuer Cash-Verbrenner (burnAccelerating). 3 Richter + Ober-Richter. VETO: CRDO/ALAB/BE nie druecken.',
  phases: [
    { title: 'Richter', detail: '3 Perspektiv-Richter (methodik/robustheit/anker)' },
    { title: 'Ober-Richter', detail: 'Synthese: geblesste Fix-Richtung' },
  ],
};

const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';

const COMMON = `
Richter im COURT, hypergrowth-Screener (Node.js), Branch loop/hypergrowth-neu @ fd9d3d4bfb. REPO: ${REPO}.
node: "C:/Program Files/nodejs/node.exe". Lies den ECHTEN Code (src/scoring/lamps.js burnAccelerating,
src/scoring/score.js scoreUniverse Z.~167-300, src/scoring/axes.js) + rechne mit node.

7 INVARIANTEN (Veto): 3 KEINE Magic Numbers (data-learned/self-scaling); renorm-on-drop nie Fake-50;
Determinismus CI==lokal; effektives N; Falsch-Entdeckung vermeiden. Anker CRDO/ALAB/BE.

KONTEXT: Council/Court hat die Warnlampe burnAccelerating geshipt (Gate: neuestes annualFCF<0 UND
annualOpInc<0 + YoY-Schritt fcf[0]<fcf[1] UND opInc[0]<opInc[1]; feuert IONQ/RKLB, NICHT CRDO/ALAB/BE).
Karl will jetzt den echten SCORE-ABZUG fuer diese Verschlechterer. Der Score-Press wurde deferred, weil
keine Council-Variante veto-sicher+wirksam war. HARTE VETO-BEDINGUNG (Karl, bindend): CRDO (reines
Hyperwachstum) darf NIEMALS gedrueckt werden, ebenso ALAB/BE.

VERIFIZIERTE FAKTEN (node, echte Snapshots @ fd9d3d4bfb):
- 146 route-Namen feuern burnAccelerating. Kohorten: health-care|unprofit 46, software|unprofit 24,
  materials|profit 18, industrials|unprofit 17, ... GENAU 0 in semiconductors|profitable ODER
  industrials|profitable -> CRDO/ALAB (semis|profit) + BE (industrials|profit) haben 0 Feuer-Namen in
  ihrer Kohorte. CRDO/ALAB/BE feuern selbst NICHT (Gate: ihr neuestes FCF & OpInc sind POSITIV).
- Achsen-Praesenz bei Feuer-Namen: ruleOfX 91%, revGrowthLevel 91%, revAcceleration 84%, marginTraj 82%.
- Verschlechterungs-Mass worseFrac = |dOpInc|/dRev (annual, dOpInc=opInc[1]-opInc[0]>0, dRev=rev[0]-rev[1]>0):
  IONQ 4.62, RKLB 0.24, Median 1.45, ACHR 732 (Extrem, winzige dRev). discount=1/(1+worseFrac) ist
  selbst-begrenzt (0,1], braucht KEINE Magic-Number-Kappung.

MEINE ANALYSE (verifiziere/widerlege JEDE Option per node):
- OPTION A (Rabatt auf ROH-Achse, z.B. ruleOfX*discount fuer Feuer-Namen vor q()): PROBLEM — IONQ ist auf
  Wachstums-Achsen ein EXTREMER Ausreisser (ruleOfX ~ alpha*755%). discount=0.178 laesst ihn evtl. IMMER
  NOCH top-Perzentil in software|unprofit -> Rang/Score bewegt sich kaum. WIRKSAMKEIT FRAGLICH -> per node
  pruefen: sinkt IONQs ruleOfX-Perzentil + Netto-Score real?
- OPTION B (Rabatt auf END-SCORE: score' = score * 1/(1+worseFrac) NUR fuer Feuer-Namen, nach der C4-
  Shrinkage): GARANTIERT wirksam + veto-sicher (Nicht-Feuernde discount=1 -> byte-identisch; CRDO feuert
  nicht -> unberuehrt). RISIKO: evtl. zu aggressiv (IONQ 75*0.178=13.4). Ist das ok oder braucht es eine
  sanftere, self-scaling Form OHNE Magic Number?
- OPTION C (sanfterer End-Score-Press, self-scaling ohne Kappung): z.B. score' = score * (1 - worseFrac/
  (1+worseFrac)*k)? -> fuehrt k als Magic Number ein (verworfen?) ODER Shrinkage Richtung Kohorten-Min
  proportional zu worseFrac/(1+worseFrac). Welche self-scaling Form ist methodisch sauber?
- OPTION D (reject Score-Press, nur Lampe): falls kein Weg sauber+wirksam+veto-sicher ist.

Magnitude-Frage: worseFrac auf OpInc-Basis macht RKLB nur 0.24 (milder Press), obwohl RKLBs CASH-Burn
stark waechst (-149M->-322M). Soll die Magnitude FCF-Burn-basiert (|dFCF|/dRev) ODER OpInc-basiert ODER
kombiniert sein? node-verifizieren gegen IONQ/RKLB.

DEINE PERSPEKTIVE: %PERSPECTIVE% (methodik=sauber/keine-Magic-Number/Falsch-Entdeckung; robustheit=
Wirksamkeit+Edge-Cases+Implementierung+Determinismus; anker=Veto CRDO/ALAB/BE byte-identisch + Anker-Range).

Gib JUDGE_SCHEMA: bestOption (A/B/C/D), isReal, decision (fix-now/fix-with-rebless/reject), fixDirection
(konkret, node-verifiziert wirksam UND veto-sicher, keine Magic Number), effektivitaetBeleg (node: sinkt
IONQ/RKLB real?), vetoBeleg (node: CRDO/ALAB/BE byte-identisch), anchorRisk, rebless, reasoning.`;

const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    perspective: { type: 'string' },
    bestOption: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
    isReal: { type: 'boolean' },
    decision: { type: 'string', enum: ['fix-now', 'fix-with-rebless', 'reject'] },
    fixDirection: { type: 'string' },
    effektivitaetBeleg: { type: 'string' },
    vetoBeleg: { type: 'string' },
    anchorRisk: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    rebless: { type: 'boolean' }, reasoning: { type: 'string' },
  },
  required: ['perspective', 'bestOption', 'isReal', 'decision', 'fixDirection', 'effektivitaetBeleg', 'vetoBeleg', 'anchorRisk', 'rebless', 'reasoning'],
};
const CHIEF_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['fix-now', 'fix-with-rebless', 'reject'] },
    chosenOption: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
    blessedFixDirection: { type: 'string', description: 'konkret umsetzbar, wirksam (IONQ/RKLB sinken) + veto-sicher (CRDO byte-identisch), keine Magic Number, incl. Magnitude-Basis (OpInc/FCF/kombi)' },
    crdoVerification: { type: 'string' }, effectiveness: { type: 'string' },
    anchorRisk: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    rebless: { type: 'boolean' }, rePull: { type: 'boolean' },
    dissent: { type: 'string' }, invariantCheck: { type: 'string' },
  },
  required: ['decision', 'chosenOption', 'blessedFixDirection', 'crdoVerification', 'effectiveness', 'anchorRisk', 'rebless', 'rePull', 'dissent', 'invariantCheck'],
};

const PERSPECTIVES = ['methodik', 'robustheit', 'anker'];
phase('Richter');
const votes = (await parallel(PERSPECTIVES.map((p) => () =>
  agent(`${COMMON.replace('%PERSPECTIVE%', p)}

Verifiziere JEDE Option per node gegen echte Snapshots (bes. Effektivitaet von A und Veto von B), dann
urteile aus der ${p}-Perspektive.`, { schema: JUDGE_SCHEMA, label: `burn:${p}`, phase: 'Richter' }).then((v) => ({ p, ...v }))))).filter(Boolean);

phase('Ober-Richter');
const brief = votes.map((v) => `[${v.p}] bestOption=${v.bestOption} decision=${v.decision} anchorRisk=${v.anchorRisk}\n  fixDir: ${v.fixDirection}\n  effektiv: ${v.effektivitaetBeleg}\n  veto: ${v.vetoBeleg}`).join('\n\n');
const chief = await agent(`${COMMON.replace('%PERSPECTIVE%', 'OBER-RICHTER (Synthese)')}

DIE 3 RICHTER-VOTEN:
${brief}

Faelle das Urteil: die Variante, die IONQ/RKLB NACHWEISLICH (node) druckt UND CRDO/ALAB/BE byte-identisch
laesst, bei konservativster Precision-Linie. blessedFixDirection MUSS beides node-belegen + keine Magic
Number. Wenn keine sauber+wirksam+veto-sicher ist -> reject (nur Lampe bleibt). Gib CHIEF_SCHEMA.`,
  { schema: CHIEF_SCHEMA, label: 'chief:burnpress', phase: 'Ober-Richter' });

return { votes: votes.map((v) => ({ p: v.p, best: v.bestOption, decision: v.decision })), decision: chief };
