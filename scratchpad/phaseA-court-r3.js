export const meta = {
  name: 'phaseA-court-r3',
  description: 'Court Runde 3: 5 scoringAffecting-Befunde aus dem R3-Audit. Je 3 Richter (methodik/robustheit/anker) + Ober-Richter-Synthese. Getaktet ≤6.',
  phases: [
    { title: 'Richter', detail: '3 Perspektiv-Richter je Fall, Batch 2 Fälle (6 Agenten)' },
    { title: 'Ober-Richter', detail: 'Synthese je Fall: geblesste Fix-Richtung' },
  ],
};

const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';

const COMMON = `
Du bist Richter im COURT für den hypergrowth-Scoring-Screener (Node.js), Branch loop/hypergrowth-neu
@ cd4413d1f8. REPO: ${REPO}. node: "C:/Program Files/nodejs/node.exe". Snapshots: ${REPO}/snapshots/
(4683 .json, flaches norm()-Format). Lies den ECHTEN Code + rechne mit node, übernimm NICHTS blind.

7 METHODIK-INVARIANTEN (Verletzung = Veto): 1 Discovery/Validation-Mauer. 2 Präregistrierung.
3 KEINE aufgezwungenen Niveaus (Fibonacci/runde Levels/Magic Numbers — Korrektur-/Schwellen-Größen
werden AUS DATEN gelernt, nicht hartkodiert). 4 Stationarität + effektives N (5000 Aktien ≠ 5000
unabhängige Samples — konservativ schätzen). 5 Struktur statt Zeit. 6 Nullmodell-Pflicht. 7 Multiple-
Testing-Ehrlichkeit (FDR). PLUS Repo-Regeln: renorm-on-drop nie Fake-50; FIELD_REGISTRY-Shapes sind
Vertrag; Determinismus CI==lokal; Anker (PLTR/CRDO/ALAB/BE + Auslands 2383.TW/2308.TW/WTC.AX) müssen
plausibel bleiben; Anker-Fixture-Änderung nur mit ALLOW_FIXTURE_CHANGE=1+Bless.

Befund-Baseline (HEAD cd4413d1f8, nach Court-R2-Fixes): route 3343, survival 74, data-suspect 30,
PLTR 79.7 / CRDO 77.0 / ALAB 70.9 / BE 61.5 / 2383.TW 89.3 / 2308.TW 87.6 / WTC.AX 92.0, 196 Tests grün.

DEINE PERSPEKTIVE: %PERSPECTIVE%
- methodik: Ist der Fix methodisch sauber ggü den 7 Invarianten (bes. 3 keine-Levels, 4 effektives-N,
  7 FDR)? Welche Variante minimiert Falsch-Entdeckungen? Lehne Magic-Number-Lösungen ab.
- robustheit: Edge-Cases, Implementierbarkeit, Determinismus, Regressionsgefahr, Test-Strategie. Welche
  Variante ist am robustesten ohne neue Annahme?
- anker: Anker-Wirkung + Kalibrierung. Verschiebt der Fix Anker aus plausibler Range? Rebless nötig?
  Re-Pull-gebunden? Konservativste Linie für die 11 Anker.

Gib JUDGE_SCHEMA zurück: isReal, decision (fix-now/fix-with-rebless/defer-deploy/reject), fixDirection
(konkret, umsetzbar, KEINE Magic Number), anchorRisk, rebless, rePull, invariantConcern, reasoning.`;

const CASES = [
  {
    id: 'C1-coverage-floor',
    title: 'Fall-7 Coverage-Floor vergleicht desynchronisierte Populationen',
    body: `MEIN Court-R2-Fall-7-Fix (run-screener.js:23-82) hat einen DEFEKT. assertCoverageFloor(loaded,
manifestNOk) wirft wenn loaded < 0.95*manifest.n_ok. ABER: loaded = u.length = on-disk Snapshot-Count
(snapshots/ ist gitignored, akkumuliert LOKAL über mehrere Pulls). manifest.n_ok = OK-Count des LETZTEN
Pulls (committed _manifest.json), git-historisch volatil 3978..11827 (5016/5058/5062/8531/11827 in den
letzten 25 Commits). Das sind VERSCHIEDENE Populationen. node-Repro: on-disk=4681 heute; für n_ok≥5016
ist floor>4765>4681 → THROW eines KERNGESUNDEN Laufs. 5/25 jüngste Manifeste (20%) würden so abbrechen.
Heutiger HEAD passt nur zufällig (n_ok=4739, floor=4503, headroom=178). Kontext ist LOKAL (Screener noch
nicht in CI; daily-pull.yml:81-82 'Loop B wires its own pre-pull gate later').

ENTSCHEIDUNGS-RAUM (wäge ab, KEINE Magic Number): (a) Floor gegen eine POPULATIONS-KONSISTENTE Baseline
statt n_ok: z.B. den letzten erfolgreichen on-disk-Count persistieren (run-screener schreibt einen
last-good-disk-count) und gegen den floorn. (b) absoluter Mindest-Floor statt manifest-relativ (aber
Invariante 3!). (c) Toleranz dramatisch weiten (verfehlt den Schutzzweck). (d) Floor nur erzwingen wenn
manifest+disk nachweislich synchron (partial=false UND manifest jünger als die ältesten geladenen
Snapshots) — sonst nur warnen. (e) Fall-7-Floor zurücknehmen (kein Schutz). Welche ist methodisch sauber,
robust und behält den Schutzzweck (stilles Schrumpfen fangen) OHNE gesunde Läufe abzubrechen?`,
  },
  {
    id: 'C2-stub-quarter-axes',
    title: 'marginTrajectory + revAcceleration: Stub-Quartale erzeugen Phantom-Extreme (CLUSTER)',
    body: `VORBESTEHEND (kein R2-Regress). Zwei Achsen haben keine Plausibilitäts-Schranke gegen winzige
Stub-Quartale: (#2) marginTrajectory (axes.js:99-116, present.push(o/r), Gewicht 0.8) — JOBY oldest
revenueQ=15000, opIncQ=-149.875M → Marge -9991.67 → marginTraj +9983 → 98.9-Perzentil; 11 Namen Top-Dezil
mit Stub-Anker (JOBY/ABXXF/CRNX/SEPN/CYTK/ASTS/RLAY/LXRX/NUVB/TNGX/LQDA). Mit Clip[-1,1]: JOBY -6.3Pkt/-6
Ränge, ACHR -12.9Pkt. (#3) revAcceleration (axes.js:52-61, g.push(rq[i]/rq[i+1]-1), SCHWERSTE Achse
Gewicht 2.8) — JOBY älteste Rate 22.574M/15000-1=+1503.93 → revAccel -1504 → 1.0-Perzentil; 59 Namen
|revAccel|>2. GLEICHE Wurzel: keine Schranke auf abgeleiteten Quartals-Größen bei near-zero-Nenner.
Schwester-Achsen sind gehärtet (gpGrowth gm-Clip[0,1], dilution Endpunkt-Clamp) — diese zwei übersehen.

ENTSCHEIDUNGS-RAUM (Invariante 3: data-learned, KEIN hartkodierter Level): (a) Quartale mit Umsatz <<
Eigen-Median (z.B. < f * median(eigene revenueQ), f data-/perzentil-gelernt) als Anker VERWERFEN (analog
dilution-Clamp / gpYoY-Floor). (b) abgeleitete Raten/Margen winsorisieren an einem KOHORTEN-gelernten
Perzentil (nicht magnitude-kappen mit fixem Wert). (c) marginTrajectory: Endpunkt aus Quartal mit Umsatz
< Eigen-Median verwerfen; revAccel analog auf QoQ-Raten. Welche Variante härtet beide Achsen data-learned
(keine Magic Number) ohne legitime kleine-aber-reale Firmen zu verwerfen? Gemeinsam behandeln (eine Wurzel).`,
  },
  {
    id: 'C3-f39-criticalmissing',
    title: 'F39 criticalMissing-Floor exkludiert 22 scorebare Real-Umsatz-Namen',
    body: `VORBESTEHEND (F39-Verwandt). Der grade-D-Floor (methods/data-quality.js:192-196: criticalMissing
= fehlendes metrics.revenueTTM ODER marketCap) wird in score.js:54 (isDataSuspect) als Ranking-EXCLUDE-Gate
(reason data-suspect) benutzt. ABER die Scoring-Achsen lesen annual.annualRev (axes.js:75,154,165,222) bzw.
metrics.revenueGrowthYoY (axes.js:46,87) — NICHT metrics.revenueTTM. node über 4683: 23 route-Namen vom
grade-D-Arm exkludiert, ALLE wegen criticalMissing (nanRatio≤0.6, sonst A+/A/B), 21 mit marketCap PRESENT,
D nur weil revenueTTM-Envelope null. Monkeypatch (D→C)+Re-Score: 22 liefern validen Score: VFS=90.3 (Rang
#1 consumer-disc/unprofit, annualRev-YoY +137%), DNLI=78.6, ERIC=22.6 (A+, voller annualRev ~29B), +9
Biotechs. Router hat bereits datengetriebenen isPreRevenue-Guard (echte umsatzlose → survival); diese 22
PASSIERTEN ihn (echte Umsatzhistorie), werden dann vom strikteren TTM-Envelope re-exkludiert, das das
Scoring gar nicht braucht. Pinning-Test (score.integration.test.js:283-294) deckt nur Doppel-Missing.

ENTSCHEIDUNGS-RAUM: (a) data-suspect-Gate entkoppeln vom revenueTTM-Arm: Gate excludiert nur bei echtem
Scoring-relevantem Datenmangel (marketCap fehlt ODER die von den Achsen GELESENEN Felder fehlen), nicht
beim revenueTTM-Envelope allein. (b) criticalMissing-Floor in data-quality.js belassen (für andere
Consumer), aber score.js isDataSuspect die TTM-Arm-Exklusion überspringen wenn annualRev present. (c)
nichts ändern (22 echte Namen bleiben unfair exkludiert). Anker unberührt (alle revenueTTM present).
Anker-Risiko: re-inkludiert 22 Namen → VFS Rang #1 → Kohorten-Perzentile verschieben. Rebless nötig?`,
  },
  {
    id: 'C4-renorm-variance',
    title: 'renorm-on-drop Achsenzahl→Score-Varianz-Artefakt (+ Fall-3-Verstärkung) — TIEFSTER Befund',
    body: `Der wichtigste methodische Befund. renorm-on-drop (engine.js:57-71 weightedScore + score.js:
187-196,286-298): fehlt einer Achse der Wert, wird über die übrigen renormiert. FOLGE: Score-Std fällt
MONOTON mit der Achsenzahl — 1-Achse Std=31.0 → 8-Achsen Std=13.5; P(score≥85) 33%→0.5%; KEIN 8/8-Name
erreicht je ≥90. 40% der ≥90-Namen haben ≤4 Achsen (3.6x Tail-Übergewicht). Overview-Top-30 voll von
2-6/8-Achsen-Namen (0489.HK 3/8 @96.9 Rang1, 7012.T 2/8 @94.8); ALLE 4 Anker (8/8 Achsen) auf 137/181/
>200/>200. Namen mit WENIGER Daten (weniger Achsen) gewinnen die Spitze, nicht die mit mehr — effektives
N pro Name ignoriert → klassische FALSCH-ENTDECKUNG (Invariante 4+7). KEIN per-Name Mindest-Achsen-/
Coverage-Gate existiert. Fall-3 (capEff drop-on-absence) VERSTÄRKT das: höchstgewichtete Achse für 41.9%
NEU gedroppt → 42% in den Hochvarianz-Niedrig-Achsen-Bereich; capEff-absent stellt 71/100 der Top-100.

ENTSCHEIDUNGS-RAUM (das Kernproblem ist effektives-N/Falsch-Entdeckung — Invariante 4+7): (a) per-Name
Mindest-Achsen-Coverage-Gate: Namen mit < K_data-gelernt present-Achsen (bzw. < X% des Achsen-Gewichts)
werden aus dem Ranking gehalten oder klar geflaggt (analog data-suspect, aber coverage-basiert). (b)
Coverage-/Shrinkage-Penalty: Score Richtung Kohorten-Median schrumpfen proportional zum fehlenden Achsen-
Gewicht (James-Stein-artig, data-learned). (c) Varianz-Normalisierung innerhalb Achsenzahl-Strata. (d)
Kombination a+b. Welche Variante eliminiert das Tail-Artefakt methodisch sauber OHNE Magic Number und
OHNE legitime daten-reiche Namen zu bestrafen? Anker (8/8) würden steigen — Rebless sicher nötig. Wie
interagiert die Wahl mit Fall-3 (soll capEff-Drop bleiben + Coverage-Gate ergänzen, oder anders)?`,
  },
  {
    id: 'C5-pinl-vehicle',
    title: 'PIN.L present-Null entgeht Non-Operating-Vehikel-Filter (mein Fall-1-Edge)',
    body: `MEIN Court-R2-Fall-1a+8-Edge. router.js:159 Branch (d): if (!hasPresent(revAnn) &&
NON_OPERATING_VEHICLE_INDUSTRY.test(ind)) return true. PIN.L (Pantheon International, PE-Investment-Trust,
industry 'Asset Management') hat annualRev=[0,0,0,0] → hasPresent=true (0 ist present) → Branch (d) feuert
NICHT → isPreRevenue=true (alle present==0) → survival. node: route(PIN.L)={action:survival,track:
pre-revenue}. Ein Asset-Mgmt-Vehikel mit present-Null-Umsatz ist genauso non-operating wie eines mit
leerem annualRev. Blast-Radius EXAKT 1/4683 (nur PIN.L matcht NON_OPERATING-Regex + all-zero; 0 FP unter
76 echten Dev-Stage-Survivors).

ENTSCHEIDUNGS-RAUM: (a) Branch (d) erweitern auf (!hasPresent(revAnn) || presentValues(revAnn).every(v=>
v===0)) && NON_OPERATING_VEHICLE_INDUSTRY.test(ind) → fängt PIN.L, 0 FP (industrie-gescoped). (b) nichts
(1 Name, low). Anker-Risiko none (kein Anker ist CEF/Asset-Mgmt). Rebless? Vermutlich nur Router-Unit-Test.`,
  },
];

const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    isReal: { type: 'boolean' },
    decision: { type: 'string', enum: ['fix-now', 'fix-with-rebless', 'defer-deploy', 'reject'] },
    fixDirection: { type: 'string', description: 'konkret umsetzbar, KEINE Magic Number / kein aufgezwungenes Niveau' },
    anchorRisk: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    rebless: { type: 'boolean' },
    rePull: { type: 'boolean' },
    invariantConcern: { type: 'string', description: 'welche der 7 Invarianten berührt/gefährdet' },
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
    blessedFixDirection: { type: 'string', description: 'die geblesste, konkret umsetzbare Richtung (Mehrheit/konservativste Linie), data-learned, keine Magic Number' },
    anchorRisk: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    rebless: { type: 'boolean' },
    rePull: { type: 'boolean' },
    dissent: { type: 'string' },
    invariantCheck: { type: 'string', description: 'bestätige, dass die geblesste Richtung keine der 7 Invarianten verletzt' },
    implementationOrder: { type: 'string', enum: ['stufe1-autonom', 'stufe2-rebless', 'stufe3-deploy'], description: 'Umsetzungs-Staffel' },
  },
  required: ['caseId', 'isReal', 'decision', 'blessedFixDirection', 'anchorRisk', 'rebless', 'rePull', 'dissent', 'invariantCheck', 'implementationOrder'],
};

const PERSPECTIVES = ['methodik', 'robustheit', 'anker'];
const judgePrompt = (c, p) => `${COMMON.replace('%PERSPECTIVE%', p)}

FALL ${c.id} — ${c.title}
${c.body}

Verifiziere am echten Code+node, dann urteile aus der ${p}-Perspektive.`;

// --- Phase 1: Richter, getaktet 2 Fälle/Batch (= 6 Agenten) ---
phase('Richter');
const votesByCase = {};
for (let i = 0; i < CASES.length; i += 2) {
  const batch = CASES.slice(i, i + 2);
  const thunks = [];
  for (const c of batch) for (const p of PERSPECTIVES) thunks.push(() =>
    agent(judgePrompt(c, p), { schema: JUDGE_SCHEMA, label: `${c.id}:${p}`, phase: 'Richter' }).then((v) => ({ cid: c.id, p, v })));
  const res = await parallel(thunks);
  for (const r of res.filter(Boolean)) { (votesByCase[r.cid] = votesByCase[r.cid] || []).push({ p: r.p, ...r.v }); }
  log(`Richter-Batch ${i / 2 + 1}/${Math.ceil(CASES.length / 2)} fertig`);
}

// --- Phase 2: Ober-Richter-Synthese je Fall ---
phase('Ober-Richter');
const chiefThunks = CASES.map((c) => () => {
  const votes = (votesByCase[c.id] || []);
  const voteBrief = votes.map((v) => `[${v.p}] isReal=${v.isReal} decision=${v.decision} anchorRisk=${v.anchorRisk} rebless=${v.rebless} rePull=${v.rePull} invariant=${v.invariantConcern}\n  fixDir: ${v.fixDirection}\n  reason: ${v.reasoning}`).join('\n\n');
  return agent(`${COMMON.replace('%PERSPECTIVE%', 'OBER-RICHTER (Synthese aus 3 Voten)')}

FALL ${c.id} — ${c.title}
${c.body}

DIE 3 RICHTER-VOTEN:
${voteBrief}

Fälle das Urteil: Mehrheit, bei Split die methodisch konservativste Linie (Falsch-Entdeckung verhindern >
Feature). Bei Re-Pull-Abhängigkeit → defer-deploy. blessedFixDirection muss KONKRET umsetzbar und
data-learned sein (KEINE Magic Number, kein aufgezwungenes Niveau — Invariante 3). invariantCheck:
bestätige explizit Invarianten-Konformität. Gib CHIEF_SCHEMA.`, { schema: CHIEF_SCHEMA, label: `chief:${c.id}`, phase: 'Ober-Richter' });
});
const chiefs = [];
for (let i = 0; i < chiefThunks.length; i += 4) {
  chiefs.push(...(await parallel(chiefThunks.slice(i, i + 4))).filter(Boolean));
}

return {
  cases: CASES.length,
  decisions: chiefs.map((d) => ({
    caseId: d.caseId, isReal: d.isReal, decision: d.decision, anchorRisk: d.anchorRisk,
    rebless: d.rebless, rePull: d.rePull, order: d.implementationOrder,
    blessedFixDirection: d.blessedFixDirection, dissent: d.dissent, invariantCheck: d.invariantCheck,
  })),
};
