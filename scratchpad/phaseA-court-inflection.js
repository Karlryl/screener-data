export const meta = {
  name: 'phaseA-court-inflection',
  description: 'Court (Karl-Direktive): capitalEfficiency ROIC-LEVEL bestraft Profitabilitaets-Inflection-Namen. 3 Richter + Ober-Richter.',
  phases: [
    { title: 'Richter', detail: '3 Perspektiv-Richter (methodik/robustheit/anker)' },
    { title: 'Ober-Richter', detail: 'Synthese: geblesste Fix-Richtung' },
  ],
};

const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';

const COMMON = `
Du bist Richter im COURT fuer den hypergrowth-Scoring-Screener (Node.js), Branch loop/hypergrowth-neu
@ 76d34d7863. REPO: ${REPO}. node: "C:/Program Files/nodejs/node.exe". Snapshots: ${REPO}/snapshots/
(4683 .json, flaches norm()-Format). Lies den ECHTEN Code (src/scoring/axes.js capitalEfficiency
Z.141-207) + rechne mit node, uebernimm NICHTS blind.

7 METHODIK-INVARIANTEN (Verletzung = Veto): 1 Discovery/Validation-Mauer. 2 Praeregistrierung. 3 KEINE
aufgezwungenen Niveaus (Magic Numbers — data-learned bzw. bestehende Schwellen/Struktur wiederverwenden).
4 Stationaritaet/effektives N. 5 Struktur statt Zeit. 6 Nullmodell. 7 FDR/Praezision. PLUS: renorm-on-drop
nie Fake-50; Determinismus CI==lokal; Anker (PLTR/CRDO/ALAB/BE) plausibel; Anker-Fixture nur mit ALLOW_FIXTURE_CHANGE=1.

KARL-DIREKTIVE (Produkt-Owner, bindend): "Der Screener soll Unternehmen NICHT bestrafen, weil sie noch
nicht profitabel sind ODER gerade erst profitabel werden — denn der Profitabilitaets-Wendepunkt ist oft
genau die Phase der staerksten Kursgewinne." Das WHETHER (Inflection nicht bestrafen) ist entschieden; ihr
entscheidet das WIE — sauber, ohne die Qualitaets-Funktion zu zerstoeren.

Baseline (HEAD 76d34d7863, 7-Achsen nach revisionsMomentum-Entfernung): route 3354, CRDO 80.66/PLTR 79.43/
ALAB 70.4/BE 60.01, 213 Tests gruen.

DEINE PERSPEKTIVE: %PERSPECTIVE%
- methodik: Sauber ggue Inv. 3 (data-learned/keine Magic Number) + 4/7? Welche Variante belohnt echte
  Inflection OHNE Kapital-Verschwender/ROIC-Verschlechterer hochzuspuelen (Falsch-Entdeckung)?
- robustheit: Edge-Cases, Implementierbarkeit, Determinismus, Interaktion mit den bestehenden Termen
  (Asset-Growth-Penalty, cycleDiscount, Fall-3-drop-on-absence). Regressionsgefahr. Test-Strategie.
- anker: Anker-Wirkung. CRDO/ALAB (Inflection, capEff-Perzentil 11/18) sollten steigen; reife Hoch-ROIC-
  Namen (NVDA 92, TSM 87) duerfen NICHT unplausibel fallen. Rebless-Umfang?

Gib JUDGE_SCHEMA: isReal, decision (fix-now/fix-with-rebless/reject), fixDirection (konkret, data-learned,
node-verifiziert), anchorRisk, rebless, rePull, invariantConcern, reasoning.`;

const CASE = {
  id: 'INFLECTION-capeff-roic-level',
  title: 'capitalEfficiency ROIC-LEVEL bestraft Profitabilitaets-Inflection (mittelt Vor-Profit-Verlustjahre ein)',
  body: `capitalEfficiency (axes.js:141-207) rechnet ROIC = mean(OpInc_paired) / mean(Invested_paired) ueber
ALLE gepaarten Jahre — INKLUSIVE der Verlustjahre VOR der Profitabilitaet. Eine Firma, die gerade den
Wendepunkt schafft (neuestes OpInc>0, aeltere <0), wird dadurch durch ihre eigene Vergangenheit runter-
gezogen: mean(OpInc) enthaelt die alten Verluste -> niedriges/negatives ROIC -> niedriges Kohorten-Perzentil.

NODE-BELEG (semiconductors|profitable, echte Daten): Inflection-Namen (neuestes annualOpInc>0, aelteres <0)
haben capEff-ROIC-Perzentil im Schnitt 29 vs reife 53 (~24 Punkte Nachteil). CRDO 11. Perzentil, ALAB 18.
(beide KI-Halbleiter am Wendepunkt, beide fast am Achsen-Boden). Universe-weit 339 Inflection-Namen.
capEff-Gewicht profitable=0.8 (nicht dominant, aber ein echter Abzug). Der Screener belohnt Margen-
VERBESSERUNG bereits (marginTrajectory-Achse, gpGrowth-gmTraj) und splittet Track (unprofitable-Topf ist
growth-dominant) — die RESIDUALE Inflection-Strafe sitzt spezifisch im ROIC-LEVEL der capEff-Achse.

ZIEL: den ROIC so berechnen/ergaenzen, dass die AKTUELLE + sich VERBESSERNDE Kapitalrendite zaehlt, nicht
das durch Vor-Profit-Verluste gedrueckte Mehrjahres-Mittel. OHNE dass ein Kapital-VERSCHLECHTERER (ROIC
faellt) oder ein reiner Kapital-Verschwender profitiert.

ENTSCHEIDUNGS-RAUM (verifiziere/verwerfe JEDE gegen echte Daten mit node; KEINE Magic Number):
(a) RECENCY: ROIC aus dem JUENGSTEN gepaarten Jahr (oder juengste 1-2) statt Mehrjahres-Mittel — die
    aktuelle Kapitalrendite zaehlt; die Vor-Profit-Verluste fallen raus. Rausch-Risiko (1 Jahr)?
(b) TRAJEKTORIE: ROIC-Level + Bonus fuer STEIGENDES ROIC (juengstes vs aelteres), analog marginTrajectory/
    cycleDiscount — belohnt die Verbesserung, bestraft Verschlechterung. Wie gewichten ohne Magic Number?
(c) POSITIVE-JAHRE: mean(OpInc) nur ueber Jahre mit OpInc>0 (Vor-Profit-Verluste ausklammern) — misst die
    Rendite im profitablen Regime. Verzerrt das reife Namen mit 1 Ausrutscher-Jahr?
(d) DOWN-WEIGHT capEff im profitable-Track (schwaecht Qualitaets-Signal generell — Karl will Qualitaet NICHT
    ganz aufgeben, nur die Inflection-Strafe).
(e) Kombination. Welche EINE Variante erfuellt Karls Direktive am saubersten (Inflection belohnt, Qualitaet
    erhalten, keine Kapital-Verschwender-Inflation)? node: pruefe CRDO/ALAB steigen, NVDA/TSM (reif, hohes
    ROIC) bleiben stabil, und ein ROIC-Verschlechterer (falls auffindbar) steigt NICHT.`,
};

const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    isReal: { type: 'boolean' },
    decision: { type: 'string', enum: ['fix-now', 'fix-with-rebless', 'reject'] },
    fixDirection: { type: 'string' },
    anchorRisk: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    rebless: { type: 'boolean' }, rePull: { type: 'boolean' },
    dataVerification: { type: 'string', description: 'node-Beleg: CRDO/ALAB steigen, NVDA/TSM stabil, Kapital-Verschwender steigt nicht' },
    invariantConcern: { type: 'string' }, reasoning: { type: 'string' },
  },
  required: ['isReal', 'decision', 'fixDirection', 'anchorRisk', 'rebless', 'rePull', 'dataVerification', 'invariantConcern', 'reasoning'],
};
const CHIEF_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    caseId: { type: 'string' }, isReal: { type: 'boolean' },
    decision: { type: 'string', enum: ['fix-now', 'fix-with-rebless', 'reject'] },
    blessedFixDirection: { type: 'string', description: 'konkrete, umsetzbare, data-learned Fix-Richtung, node-verifiziert' },
    anchorRisk: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    rebless: { type: 'boolean' }, rePull: { type: 'boolean' },
    dissent: { type: 'string' }, invariantCheck: { type: 'string' },
    interactionNote: { type: 'string', description: 'Interaktion mit Asset-Growth-Penalty + cycleDiscount + Fall-3-drop' },
  },
  required: ['caseId', 'isReal', 'decision', 'blessedFixDirection', 'anchorRisk', 'rebless', 'rePull', 'dissent', 'invariantCheck', 'interactionNote'],
};

const PERSPECTIVES = ['methodik', 'robustheit', 'anker'];
phase('Richter');
const votes = (await parallel(PERSPECTIVES.map((p) => () =>
  agent(`${COMMON.replace('%PERSPECTIVE%', p)}

FALL ${CASE.id} — ${CASE.title}
${CASE.body}

Verifiziere am echten Code+node (rechne jede Kandidaten-Variante gegen CRDO/ALAB + NVDA/TSM + einen
ROIC-Verschlechterer), dann urteile aus der ${p}-Perspektive.`,
    { schema: JUDGE_SCHEMA, label: `INFL:${p}`, phase: 'Richter' }).then((v) => ({ p, ...v }))))).filter(Boolean);

phase('Ober-Richter');
const voteBrief = votes.map((v) => `[${v.p}] isReal=${v.isReal} decision=${v.decision} anchorRisk=${v.anchorRisk} rebless=${v.rebless}\n  fixDir: ${v.fixDirection}\n  dataVerif: ${v.dataVerification}\n  reason: ${v.reasoning}`).join('\n\n');
const chief = await agent(`${COMMON.replace('%PERSPECTIVE%', 'OBER-RICHTER (Synthese aus 3 Voten)')}

FALL ${CASE.id} — ${CASE.title}
${CASE.body}

DIE 3 RICHTER-VOTEN:
${voteBrief}

Faelle das Urteil: Mehrheit, bei Split die konservativste Linie (Falsch-Entdeckung verhindern > Feature;
Karls Direktive erfuellen ohne Kapital-Verschwender hochzuspuelen). blessedFixDirection MUSS konkret +
node-verifiziert sein (CRDO/ALAB steigen, NVDA/TSM stabil). KEINE Magic Number. interactionNote:
Zusammenspiel mit Asset-Growth-Penalty + cycleDiscount + Fall-3-drop. Gib CHIEF_SCHEMA.`,
  { schema: CHIEF_SCHEMA, label: 'chief:INFL', phase: 'Ober-Richter' });

return { decision: chief, votes: votes.map((v) => ({ p: v.p, decision: v.decision, fixDirection: v.fixDirection, dataVerification: v.dataVerification })) };
