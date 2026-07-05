export const meta = {
  name: 'phaseA-court-r5',
  description: 'Court Runde 5: 2 Befunde aus dem R5-Audit (C2 Winsor-Asymmetrie + hasCurrentRevenue stale-pass). Je 3 Richter + Ober-Richter. Getaktet.',
  phases: [
    { title: 'Richter', detail: '3 Perspektiv-Richter je Fall (methodik/robustheit/anker)' },
    { title: 'Ober-Richter', detail: 'Synthese: geblesste Fix-Richtung' },
  ],
};

const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';

const COMMON = `
Du bist Richter im COURT für den hypergrowth-Scoring-Screener (Node.js), Branch loop/hypergrowth-neu
@ 3e65b9dfd6. REPO: ${REPO}. node: "C:/Program Files/nodejs/node.exe". Snapshots: ${REPO}/snapshots/
(4683 .json, flaches norm()-Format). Lies den ECHTEN Code + rechne mit node, übernimm NICHTS blind.

7 METHODIK-INVARIANTEN (Verletzung = Veto): 1 Discovery/Validation-Mauer. 2 Präregistrierung. 3 KEINE
aufgezwungenen Niveaus (Magic Numbers — Schwellen AUS DATEN gelernt; ABER physikalische/ökonomische
Schranken wie gm=GP/Rev∈[0,1] sind erlaubt, da invariant, KEIN aufgezwungenes Preis-Niveau). 4
Stationarität + effektives N. 5 Struktur statt Zeit. 6 Nullmodell. 7 Multiple-Testing/FDR. PLUS:
renorm-on-drop nie Fake-50; FIELD_REGISTRY-Shapes Vertrag; Determinismus CI==lokal; Anker
(PLTR/CRDO/ALAB/BE + 2383.TW/2308.TW/WTC.AX) plausibel; Anker-Fixture nur mit ALLOW_FIXTURE_CHANGE=1.

KONTEXT: C2 (Court R3) winsorisiert die per-Quartal-OpMargins (marginTrajectory) und QoQ-Raten
(revAcceleration) an universe-weiten p1/p99-Schranken (WINSOR_TAIL=0.01, SYMMETRISCH), um Stub-Quartal-
Phantome (JOBY 15000$-Quartal -> OpMarge -9991) zu klemmen. C3 (Court R3) entkoppelte das data-suspect-
Gate vom revenueTTM-Envelope: hasCurrentRevenue(s) = firstPresent(annualRev)>0 ODER ein revenueQ present>0.

Baseline (HEAD 3e65b9dfd6): route 3355, survival 73, data-suspect 16, score≥90:1, PLTR 79.72/CRDO 77.0/
ALAB 70.9/BE 61.47/2383.TW 86.67/2308.TW 87.6/WTC.AX 67.96, 209 Tests grün, 0 NaN.

DEINE PERSPEKTIVE: %PERSPECTIVE%
- methodik: Sauber ggü Inv. 3 (physische vs aufgezwungene Schranke) + 4 + 7? Welche Variante ist am
  wenigsten verzerrend / am wenigsten Falsch-Entdeckung?
- robustheit: Edge-Cases, Implementierbarkeit, Determinismus, Regressionsgefahr, Test-Strategie.
- anker: Anker-Wirkung + Kalibrierung. Verschiebt der Fix Anker? Rebless-Umfang?

Gib JUDGE_SCHEMA: isReal, decision (fix-now/fix-with-rebless/defer-deploy/reject), fixDirection (konkret,
umsetzbar), anchorRisk, rebless, rePull, invariantConcern, reasoning.`;

const CASES = [
  {
    id: 'R5-A-winsor-asymmetry',
    title: 'C2 symmetrischer p99-Winsor klemmt legitime Hochmargen-Firmen (marginTrajectory -> 0)',
    body: `Das R5-Audit (3/3 bestätigt, node gegen 4681 Snapshots) fand: die per-Quartal-OpMargin-Verteilung
ist STARK LINKSSCHIEF (p1=-13.09, median=+0.111, p99=+0.677). Der SYMMETRISCHE p1/p99-Winsor (C2,
score.js:100 WINSOR_TAIL + axes.js quarterOpMargins/marginTrajectory) erzeugt damit eine zu enge OBERE
Schranke (0.677). Reale Operating-Margen 68-100% (Royalty FNV.TO/OR/RPRX, Börsen IBKR/CME, Asset-Mgr
BAM/VICI, High-Margin-SW APP/VRSN, Moutai 600519.SS) sind ÖKONOMISCH REAL, keine Stub-Phantome. node:
GENAU 19 route-Namen haben BEIDE marginTrajectory-Endpunkte (newest UND oldest) > p99 -> beide klemmen
auf 0.677 -> marginTrajectory = EXAKT 0 (echter Operating-Leverage vernichtet). Belege: APP +0.057->0,
FNV.TO +0.078->0, VICI +0.307->0, IBKR +0.018->0, BAM +0.011->0. Netto-Effekt (symmetrisch vs nur-untere-
Schranke): ~1010-1450 Scores geändert, 14-82 um >1 Pkt, 2-21 um >3 Pkt (VICI 53.28->57.77, SAFE
48.06->44.19), 1-2 top-200-Swaps am Rand. Anker UNBERÜHRT (8/8, Margen in-band). Die UNTERE Schranke
(-13.09, JOBY/NAMS-Stub-Fix) ist KORREKT. Determinismus/quantile selbst sauber. Es ist KEIN C2-Spec-
Regress (Symmetrie war Design), sondern eine unentdeckte Verzerrung des symmetrischen Designs.

WICHTIG: opMargin = opIncQ/revenueQ. Operatives opInc ≤ Umsatz (COGS+opex≥0) -> opMargin ≤ 1 ist eine
PHYSISCHE Schranke (wie gm=GP/Rev≤1, axes.js:76 bereits Court-geblesst F9). Die ECHTE Stub-Artefakt-Seite
ist die UNTERE (extreme negative Margen aus near-zero-Umsatz-Quartalen mit Verlust); legitime Hochmargen
liegen in [0, 1].

ENTSCHEIDUNGS-RAUM: (1) ASYMMETRISCH: nur untere Tail-Schranke (data-learned p1), KEINE obere — Risiko:
positive-Stub-Artefakte (opMargin >> 1 aus winzigem Umsatz + positivem opInc) ungeklemmt. (2) PHYSISCHE
Obergrenze: unten data-learned p1, oben harte +1.0 (opMargin≤1, analog gm-Clip — keine Magic Number,
physische Invariante) -> fängt impossible->1-Artefakte UND erhält alle legitimen ≤1-Margen. (3) höheres
oberes Perzentil (p99.9≈0.955). Welche Variante? Und: braucht revAcceleration (QoQ-Raten, p99≈1.36,
Artefakt war OBERE Seite +1503) dieselbe/andere Behandlung, oder ist dessen symmetrischer Winsor OK?
Anker bleiben unberührt -> Rebless nur Tests + ggf. Doku. KEINE Anker-Fixture.`,
  },
  {
    id: 'R5-B-hascurrentrev-stale',
    title: 'C3 hasCurrentRevenue akzeptiert via firstPresent einen STALEN älteren annualRev-Wert (RTEZ)',
    body: `Das R5-Audit fand: hasCurrentRevenue (score.js:72-76) nutzt firstPresent(norm(s,'annualRev'))>0.
firstPresent liefert den NEUESTEN PRESENT-Wert — überspringt aber ein null-neuestes-GJ. node: GENAU 1 Name
RTEZ (annualRev=[null,5000,null,519443], revenueQ=[]) wird durch den STALEN 5000-Wert (2 GJ alt) als
'aktueller Umsatz present' gewertet -> route #2375/3355 (score 42.44) statt data-suspect exclude. Das
neueste GJ (Index 0) ist null -> ökonomisch KEIN aktueller Umsatz. 1 Name, kein Rang-Flip nahe Spitze,
kein Anker. Der C3-Court-Spruch sagte wörtlich 'neuester present-Wert in norm(s,annualRev) > 0' = genau
firstPresent — die INTENTION war aber 'AKTUELLER Umsatz'.

ENTSCHEIDUNGS-RAUM: (a) härten: annualRev[0] (striktes neuestes GJ) present-und->0 verlangen statt
firstPresent (RTEZ -> exclude; matcht die C3-Intention 'aktuell'; prüfen, dass die 13 anderen C3-re-
inkludierten Namen (VFS/ERIC/…) annualRev[0] present tragen und NICHT mit rausfallen). (b) lassen
(firstPresent = wörtlicher C3-Spruch, 1 harmloser Name). Anker unberührt. Rebless nur ggf. Pinning-Test.`,
  },
];

const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    isReal: { type: 'boolean' },
    decision: { type: 'string', enum: ['fix-now', 'fix-with-rebless', 'defer-deploy', 'reject'] },
    fixDirection: { type: 'string' },
    anchorRisk: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    rebless: { type: 'boolean' }, rePull: { type: 'boolean' },
    invariantConcern: { type: 'string' }, reasoning: { type: 'string' },
  },
  required: ['isReal', 'decision', 'fixDirection', 'anchorRisk', 'rebless', 'rePull', 'invariantConcern', 'reasoning'],
};
const CHIEF_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    caseId: { type: 'string' }, isReal: { type: 'boolean' },
    decision: { type: 'string', enum: ['fix-now', 'fix-with-rebless', 'defer-deploy', 'reject'] },
    blessedFixDirection: { type: 'string' },
    anchorRisk: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    rebless: { type: 'boolean' }, rePull: { type: 'boolean' },
    dissent: { type: 'string' }, invariantCheck: { type: 'string' },
    revAccelTreatment: { type: 'string', description: 'nur Fall A: ob/wie revAcceleration mitbehandelt wird' },
  },
  required: ['caseId', 'isReal', 'decision', 'blessedFixDirection', 'anchorRisk', 'rebless', 'rePull', 'dissent', 'invariantCheck', 'revAccelTreatment'],
};

const PERSPECTIVES = ['methodik', 'robustheit', 'anker'];
const judgePrompt = (c, p) => `${COMMON.replace('%PERSPECTIVE%', p)}

FALL ${c.id} — ${c.title}
${c.body}

Verifiziere am echten Code+node, dann urteile aus der ${p}-Perspektive.`;

phase('Richter');
const votesByCase = {};
for (let i = 0; i < CASES.length; i += 2) {
  const batch = CASES.slice(i, i + 2);
  const thunks = [];
  for (const c of batch) for (const p of PERSPECTIVES) thunks.push(() =>
    agent(judgePrompt(c, p), { schema: JUDGE_SCHEMA, label: `${c.id}:${p}`, phase: 'Richter' }).then((v) => ({ cid: c.id, p, v })));
  const res = await parallel(thunks);
  for (const r of res.filter(Boolean)) (votesByCase[r.cid] = votesByCase[r.cid] || []).push({ p: r.p, ...r.v });
}

phase('Ober-Richter');
const chiefs = await parallel(CASES.map((c) => () => {
  const votes = votesByCase[c.id] || [];
  const voteBrief = votes.map((v) => `[${v.p}] isReal=${v.isReal} decision=${v.decision} anchorRisk=${v.anchorRisk} rebless=${v.rebless} invariant=${v.invariantConcern}\n  fixDir: ${v.fixDirection}\n  reason: ${v.reasoning}`).join('\n\n');
  return agent(`${COMMON.replace('%PERSPECTIVE%', 'OBER-RICHTER (Synthese aus 3 Voten)')}

FALL ${c.id} — ${c.title}
${c.body}

DIE 3 RICHTER-VOTEN:
${voteBrief}

Fälle das Urteil: Mehrheit, bei Split die methodisch konservativste Linie (Falsch-Entdeckung verhindern >
Feature). blessedFixDirection KONKRET umsetzbar. invariantCheck: explizit Inv. 3 (physische vs
aufgezwungene Schranke). Bei Fall A: revAccelTreatment ausfüllen. Gib CHIEF_SCHEMA.`,
    { schema: CHIEF_SCHEMA, label: `chief:${c.id}`, phase: 'Ober-Richter' });
}));

return { cases: CASES.length, decisions: chiefs.filter(Boolean) };
