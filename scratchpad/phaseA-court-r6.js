export const meta = {
  name: 'phaseA-court-r6',
  description: 'Court Runde 6: newestQtrSuspect False-Positive auf LQDA (echte Rampe faelschlich excludiert). 3 Richter + Ober-Richter.',
  phases: [
    { title: 'Richter', detail: '3 Perspektiv-Richter (methodik/robustheit/anker)' },
    { title: 'Ober-Richter', detail: 'Synthese: geblesste Fix-Richtung' },
  ],
};

const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';

const COMMON = `
Du bist Richter im COURT fuer den hypergrowth-Scoring-Screener (Node.js), Branch loop/hypergrowth-neu
@ a8803f29bd. REPO: ${REPO}. node: "C:/Program Files/nodejs/node.exe". Snapshots: ${REPO}/snapshots/
(4683 .json, flaches norm()-Format). Lies den ECHTEN Code (src/scoring/lamps.js newestQtrSuspect
Z.170-206) + rechne mit node, uebernimm NICHTS blind.

7 METHODIK-INVARIANTEN (Verletzung = Veto): 1 Discovery/Validation-Mauer. 2 Praeregistrierung. 3 KEINE
aufgezwungenen Niveaus (Magic Numbers — Schwellen AUS DATEN gelernt bzw. bestehende leg-Schwellen
wiederverwenden). 4 Stationaritaet/effektives N. 5 Struktur statt Zeit. 6 Nullmodell. 7 FDR/Praezision.
PLUS: renorm-on-drop nie Fake-50; Determinismus CI==lokal; newestQtrSuspect ist eine EXCLUDE-Lampe
(DATA_SUSPECT_LAMPS) — ein False-Positive wirft einen ECHTEN Namen aus dem Ranking (Precision-first!).

KONTEXT: newestQtrSuspect ist ein 4-Leg-Detektor (Court R2 Fall 2 ergaenzte eine 5. YoY-Saisonalitaets-
De-Fire-Leg fuer VCEL). Er soll Yahoo-Fabrikation eines korrupten NEUESTEN Quartals fangen (Samsung
005930.KS: opM-Spike 42.8% vs ~10%). leg1=opM-Diskontinuitaet>0.20, leg2=q0gm>0.55, leg3=Revenue-Sprung
>1.35*trailMed, leg4=q0opm>=1.9*q1opm ('Spike, kein Ramp'), legSeasonal=YoY-De-Fire (|q0opm-q4opm|<=0.20).

BASELINE (HEAD a8803f29bd): route 3354, survival 73, data-suspect 17, PLTR 79.72/CRDO 77.0/ALAB 70.9/
BE 61.47, 211 Tests gruen. Firing-Set {005930.KS, LQDA, ONEX.TO, SNDK} (stabil seit R2).

DEINE PERSPEKTIVE: %PERSPECTIVE%
- methodik: Sauber ggue Inv. 3 (keine neue Magic Number — bestehende Schwellen/Struktur wiederverwenden)
  + 7 (Precision — den FP toeten OHNE echte Fabrikation durchzulassen)? Welche Variante ist am robustesten?
- robustheit: Edge-Cases, Implementierbarkeit, Regressionsgefahr. Der De-Fire darf NUR LQDA treffen, NICHT
  Samsung/SNDK/ONEX. Teste jede Kandidaten-Bedingung gegen ALLE 4 feuernden Namen mit node.
- anker: Anker-/Ranking-Wirkung. LQDA wuerde ohne Lampe health-care/unprofitable @68.69 Rang 14/129 routen.
  Kein Anker betroffen. Rebless-Umfang? (MU-Fixture testet peakMargin, nicht newestQtrSuspect.)

Gib JUDGE_SCHEMA: isReal, decision (fix-now/fix-with-rebless/defer-deploy/reject), fixDirection (konkret,
KEINE Magic Number, gegen alle 4 Namen node-verifiziert), anchorRisk, rebless, rePull, invariantConcern, reasoning.`;

const CASE = {
  id: 'R6-lqda-newestqtr-fp',
  title: 'newestQtrSuspect False-Positive: LQDA (echte monotone Rampe) faelschlich als data-suspect excludiert',
  body: `Das R6-Audit (3/3 bestaetigt, node gegen echte Snapshots) fand: LQDA (Liquidia, Drug Manufacturers)
feuert newestQtrSuspect=true -> wird als data-suspect EXCLUDIERT, obwohl das neueste Quartal nachweislich
eine ECHTE monotone Umsatz-/Margen-Rampe ist (fruehstage-Biotech-Kommerzialisierung), KEINE Yahoo-Korruption.
Ohne die Lampe routet LQDA health-care/unprofitable @ Score 68.69, Rang 14/129 (oberes Dezil).

DATEN (opMargin = opIncQ/revenueQ, newest-first; revenueQ newest-first):
- LQDA (FP, muss DE-FIRE): opM=[0.463, 0.215, 0.033, -4.244, -11.354]; revQ=[132.9M, 92.0M, 54.3M, 8.8M, 3.1M].
  Umsatz 44x in 5 Quartalen (3M->133M), Marge von -11.35 auf +0.46 (Operating-Leverage einer skalierenden
  Firma). revenueTTM=288M = exakt Summe der 4 neuesten Q (intern konsistent). leg4: 0.463>=1.9*0.215=0.409
  -> true. legSeasonal kann NICHT de-firen (q4opm=-11.35, |0.463-(-11.35)|=11.8>>0.20).
- 005930.KS Samsung (muss WEITER feuern): opM=[0.428, 0.214, 0.141, 0.063, 0.084]; reife Mega-Firma, deren
  reale opM ~10-15% ist -> 42.8% ist ein bogus-Spike (Fabrikation). Marge-Zuwachs DISPROPORTIONAL zum
  moderaten Umsatz einer reifen Firma.
- SNDK (muss WEITER feuern; Court R2: SNDK != sauberer FP): opM=[0.7, 0.355, 0.083, 0.027, -0.025]; 70%
  opM fuer NAND ist implausibel (Spin-off-Accounting-Artefakt).
- ONEX.TO (muss WEITER feuern): opM=[0.785, 0.302, 0.75, 0.801, 0.102]; nicht-monotone Sprung-Serie.

WICHTIG — NAIVE MONOTONIE VERSAGT: LQDA UND Samsung UND SNDK haben alle die ersten 4 opM strikt steigend
(node-verifiziert). Ein simpler 'opM strikt monoton -> de-fire' wuerde Samsung+SNDK faelschlich exonerieren.
Der Diskriminator muss subtiler sein. KANDIDATEN-Ideen (verifiziere/verwerfe JEDE gegen alle 4 mit node,
KEINE Magic Number — bestehende leg-Struktur/Schwellen wiederverwenden wo moeglich):
(i) EXPLOSIVES Umsatzwachstum als Rampe-Signal: LQDA revQ0/revQ(oldest)=133/3=44x bzw. QoQ durchweg gross;
    Samsung/SNDK haben moderates Umsatzwachstum -> ein sehr hoher Umsatz-Wachstumsfaktor ueber das ganze
    Fenster (nicht nur leg3 q0-vs-median) trennt die skalierende Frueh-Firma von der reifen mit Margen-Spike.
(ii) GLATTHEIT der 2. Differenz: LQDAs Margen-Inkremente sind glatt/dezelerierend (Annaeherung an
    Profitabilitaet), Samsungs neuestes Inkrement ist ein diskontinuierlicher Sprung (Inkrement verdoppelt).
(iii) Konsistenz newest-Q mit revenueTTM (LQDA: TTM=exakt Summe der 4Q -> konsistent).
(iv) Kombination. Welche EINE Bedingung (oder minimaler Zusatz-Leg) de-firet GENAU LQDA und laesst
    Samsung/SNDK/ONEX weiter feuern? Precision-first: im Zweifel NICHT de-firen.

ENTSCHEIDUNGS-RAUM: fix (5./6. De-Fire-Leg, NUR entschaerfend, nie zusaetzlich excludierend — wie R2 Fall 2)
ODER reject (LQDA-Exclude ist vertretbar). Falls fix: konkrete Bedingung + node-Beleg, dass GENAU {LQDA}
de-firet und {005930.KS, SNDK, ONEX.TO} weiter feuern. Rebless: neuer Lampen-Unit-Test (kein Anker-Fixture).`,
};

const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    isReal: { type: 'boolean' },
    decision: { type: 'string', enum: ['fix-now', 'fix-with-rebless', 'defer-deploy', 'reject'] },
    fixDirection: { type: 'string' },
    anchorRisk: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    rebless: { type: 'boolean' }, rePull: { type: 'boolean' },
    defireVerification: { type: 'string', description: 'node-Beleg: welche Namen de-firen unter deiner Bedingung (muss NUR LQDA sein)' },
    invariantConcern: { type: 'string' }, reasoning: { type: 'string' },
  },
  required: ['isReal', 'decision', 'fixDirection', 'anchorRisk', 'rebless', 'rePull', 'defireVerification', 'invariantConcern', 'reasoning'],
};
const CHIEF_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    caseId: { type: 'string' }, isReal: { type: 'boolean' },
    decision: { type: 'string', enum: ['fix-now', 'fix-with-rebless', 'defer-deploy', 'reject'] },
    blessedFixDirection: { type: 'string', description: 'konkrete de-fire-Bedingung, node-verifiziert NUR LQDA, keine Magic Number' },
    anchorRisk: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    rebless: { type: 'boolean' }, rePull: { type: 'boolean' },
    defireSet: { type: 'string', description: 'welche der 4 Namen de-firen (Soll: nur LQDA)' },
    dissent: { type: 'string' }, invariantCheck: { type: 'string' },
  },
  required: ['caseId', 'isReal', 'decision', 'blessedFixDirection', 'anchorRisk', 'rebless', 'rePull', 'defireSet', 'dissent', 'invariantCheck'],
};

const PERSPECTIVES = ['methodik', 'robustheit', 'anker'];
phase('Richter');
const votes = (await parallel(PERSPECTIVES.map((p) => () =>
  agent(`${COMMON.replace('%PERSPECTIVE%', p)}

FALL ${CASE.id} — ${CASE.title}
${CASE.body}

Verifiziere am echten Code+node (rechne die legs + jede Kandidaten-Bedingung gegen ALLE 4 feuernden Namen),
dann urteile aus der ${p}-Perspektive.`,
    { schema: JUDGE_SCHEMA, label: `R6:${p}`, phase: 'Richter' }).then((v) => ({ p, ...v }))))).filter(Boolean);

phase('Ober-Richter');
const voteBrief = votes.map((v) => `[${v.p}] isReal=${v.isReal} decision=${v.decision} anchorRisk=${v.anchorRisk} rebless=${v.rebless}\n  fixDir: ${v.fixDirection}\n  defireVerif: ${v.defireVerification}\n  reason: ${v.reasoning}`).join('\n\n');
const chief = await agent(`${COMMON.replace('%PERSPECTIVE%', 'OBER-RICHTER (Synthese aus 3 Voten)')}

FALL ${CASE.id} — ${CASE.title}
${CASE.body}

DIE 3 RICHTER-VOTEN:
${voteBrief}

Faelle das Urteil: Mehrheit, bei Split die konservativste Precision-Linie (im Zweifel NICHT de-firen).
blessedFixDirection MUSS konkret + node-verifiziert sein, dass GENAU LQDA de-firet und Samsung/SNDK/ONEX
weiter feuern. KEINE Magic Number. defireSet ausfuellen. invariantCheck: explizit Inv. 3+7. Gib CHIEF_SCHEMA.`,
  { schema: CHIEF_SCHEMA, label: 'chief:R6', phase: 'Ober-Richter' });

return { decision: chief, votes: votes.map((v) => ({ p: v.p, decision: v.decision, fixDirection: v.fixDirection, defireVerification: v.defireVerification })) };
