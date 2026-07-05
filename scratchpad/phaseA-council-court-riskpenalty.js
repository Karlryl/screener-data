export const meta = {
  name: 'phaseA-council-court-riskpenalty',
  description: 'Council (4 Design-Vorschlaege: was soll den Score druecken?) -> Court (3 Richter + Ober-Richter). Harte Bedingung: CRDO nie druecken.',
  phases: [
    { title: 'Council', detail: '4 Design-Vorschlaege fuer eine daten-basierte Verschlechterungs-Bremse' },
    { title: 'Court', detail: '3 Richter + Ober-Richter adjudizieren' },
  ],
};

const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';

const CONTEXT = `
Screener: hypergrowth-Scoring (Node.js), Branch loop/hypergrowth-neu @ 20c295312b. REPO: ${REPO}.
node: "C:/Program Files/nodejs/node.exe". Snapshots ${REPO}/snapshots/ (flaches norm()-Format).
7 Achsen (Gewichte je Sektor): revGrowthLevel, revAcceleration (schwerste), gpGrowth, ruleOfX,
marginTrajectory, capitalEfficiency (ROIC, jetzt trailing-loss-getrimmt), dilution. Track-Split
profitable/unprofitable. Score = gewichtetes Kohorten-Perzentil-Mittel (0-100). PLUS Warnlampen
(lamps.js: unprofit/burning/highDilution/lowRoic/crashRisk/peakMargin/... — aktuell REIN WARNEND,
druecken den Score NICHT; nur 2 EXCLUDE-Lampen newestQtrSuspect/annualCurrencyLeak werfen raus).

PROBLEM (Karl): der Screener schaut NUR ZURUECK (Karl hat Analysten-Erwartungen bewusst entfernt).
Firmen wie IONQ glaenzen mit historischem Wachstum, verbrennen aber BESCHLEUNIGT Cash / Verluste wachsen
-> ihre gute Zeit ist evtl. vorbei. Frage: soll so etwas den Score druecken (daten-basiert, KEIN Analysten-
Signal)? UND die eingebaute Spannung: Karl will NICHT-/gerade-profitable NICHT bestrafen (Wendepunkt =
Kursphase) — aber Verschlechterer schon.

HARTE NEBENBEDINGUNG (Karl, bindend, VETO): CRDO (reines Hyperwachstum) darf NIEMALS gedrueckt werden.
Ebenso ALAB/BE (Turnaround zu POSITIVEM FCF). Jede Design-Variante, die CRDO/ALAB/BE drueckt, ist RAUS.

REFERENZ-DATEN (annualFCF neu->alt):
- CRDO [29M,17M,-46M,-48M] fcfMarginTTM +16% -> TURNAROUND zu POSITIV (NIE druecken).
- ALAB [282M,102M,-15M,-40M] +24% -> POSITIV (NIE druecken). BE [57M,33M,-456M,-308M] +11% -> POSITIV.
- IONQ [-300M,-124M,-93M,-57M] -49% -> Burn BESCHLEUNIGT (Kandidat zum Druecken). revenueQ 755% Wachstum,
  aber opInc-Verlust waechst -77M->-228M. RKLB [-322M,-116M,-154M,-149M] -32% -> Burn verschlechtert.

METHODIK-INVARIANTEN: keine Magic Numbers (data-learned/bestehende Schwellen); renorm-on-drop nie Fake-50;
Determinismus CI==lokal; effektives N; Falsch-Entdeckung vermeiden. Der Screener-Zweck: JUNGE stark-
wachsende Firmen surfacen (CRDO/ALAB/BE-Typ), reife Langsam-Wachser (Novo/SAP) sinken lassen.`;

const PROPOSER_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    angle: { type: 'string' },
    signal: { type: 'string', description: 'das daten-basierte Signal, konkret + wo im Code' },
    magnitude: { type: 'string', description: 'wie stark druecken (data-learned, keine Magic Number)' },
    hitsDeteriorating: { type: 'string', description: 'node-Beleg: trifft IONQ/RKLB?' },
    sparesCRDO: { type: 'string', description: 'node-Beleg: CRDO/ALAB/BE UNBERUEHRT (Pflicht!)' },
    universeEffect: { type: 'string' },
    tradeoff: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['angle', 'signal', 'magnitude', 'hitsDeteriorating', 'sparesCRDO', 'universeEffect', 'tradeoff', 'reasoning'],
};

const ANGLES = [
  { key: 'burn-acceleration', hint: 'annualFCF-Trajektorie wird MEHR negativ (Burn beschleunigt) — als data-learned Score-Abzug ODER als aktivierte Lampe. Wie messen (Vorzeichen/Steigung), wie druecken ohne Turnaround-zu-positiv (CRDO/ALAB) zu treffen?' },
  { key: 'loss-vs-growth', hint: 'Verlust/Burn waechst SCHNELLER als der Umsatz (Skalierung verschlechtert die Einheit statt sie zu verbessern). marginTrajectory ist bei IONQ +2.92 (pro-Umsatz-Marge verbessert sich!) — reicht das, oder braucht es ein absolutes Burn-Signal?' },
  { key: 'lamp-to-score', hint: 'bestehende burning/highDilution/crashRisk-Lampen SANFT in den Score einspeisen (kleiner Malus je Lampe) statt nur warnen. Wie kalibrieren, dass CRDO (welche Lampen traegt CRDO?) NICHT gedrueckt wird? Prüfe CRDOs Lampen per node.' },
  { key: 'reject-keep-warn', hint: 'GEGEN einen Score-Malus argumentieren: der Screener soll rein daten-surfacen + warnen, die Vorwaerts-/Persistenz-Frage gehoert zu Karls eigener Recherche. Belege, warum ein Malus mehr Falsch-Entdeckung/Willkuer bringt als Nutzen (bes. Kollision mit dem nicht-bestrafen-Wunsch).' },
];

phase('Council');
const proposals = (await parallel(ANGLES.map((a) => () =>
  agent(`${CONTEXT}

DU BIST COUNCIL-MITGLIED (Design-Perspektive: ${a.key}). Entwirf EINEN konkreten, daten-basierten Vorschlag
(oder argumentiere dagegen, wenn dein Angle 'reject' ist), was den Score druecken soll und WARUM.
FOKUS DEINES ANGLES: ${a.hint}

PFLICHT: verifiziere per node gegen echte Snapshots, dass dein Design (a) IONQ/RKLB trifft (falls es druecken
soll) und (b) CRDO/ALAB/BE NICHT druckt (harte Veto-Bedingung). Keine Magic Number. Gib PROPOSER_SCHEMA.`,
    { schema: PROPOSER_SCHEMA, label: `council:${a.key}`, phase: 'Council' }).then((v) => ({ angle: a.key, ...v }))))).filter(Boolean);

const proposalBrief = proposals.map((p) => `### Angle ${p.angle}\nSignal: ${p.signal}\nMagnitude: ${p.magnitude}\ntrifft-Verschlechterer: ${p.hitsDeteriorating}\nschont-CRDO: ${p.sparesCRDO}\nUniverse-Effekt: ${p.universeEffect}\nTradeoff: ${p.tradeoff}\nBegruendung: ${p.reasoning}`).join('\n\n');

const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    perspective: { type: 'string' },
    bestAngle: { type: 'string', description: 'welcher Council-Vorschlag (oder reject/kombi)' },
    recommendation: { type: 'string', enum: ['adopt', 'adapt', 'reject', 'defer'] },
    crdoSafe: { type: 'boolean', description: 'bleibt CRDO garantiert ungedrueckt?' },
    fixDirection: { type: 'string' },
    concerns: { type: 'string' }, reasoning: { type: 'string' },
  },
  required: ['perspective', 'bestAngle', 'recommendation', 'crdoSafe', 'fixDirection', 'concerns', 'reasoning'],
};
const CHIEF_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['adopt', 'adapt', 'reject', 'defer'] },
    blessedDesign: { type: 'string', description: 'die geblesste, konkret umsetzbare Fix-Richtung ODER Begruendung fuer reject/defer' },
    crdoVerification: { type: 'string', description: 'expliziter Beleg, dass CRDO NIE gedrueckt wird' },
    anchorRisk: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    rebless: { type: 'boolean' }, rePull: { type: 'boolean' },
    dissent: { type: 'string' }, invariantCheck: { type: 'string' },
  },
  required: ['decision', 'blessedDesign', 'crdoVerification', 'anchorRisk', 'rebless', 'rePull', 'dissent', 'invariantCheck'],
};

phase('Court');
const perspectives = ['methodik', 'robustheit', 'anker'];
const judges = (await parallel(perspectives.map((p) => () =>
  agent(`${CONTEXT}

DU BIST RICHTER (${p}) im COURT. Unten die 4 COUNCIL-Vorschlaege. Verifiziere jeden per node gegen echte
Daten (bes. die CRDO-Veto-Bedingung), dann urteile aus der ${p}-Perspektive, welcher (falls einer) geblesst
werden soll. Precision-first: im Zweifel reject/defer. crashRisk-Malus/willkuerliche Konstanten ablehnen.

DIE 4 COUNCIL-VORSCHLAEGE:
${proposalBrief}

Gib JUDGE_SCHEMA.`, { schema: JUDGE_SCHEMA, label: `court:${p}`, phase: 'Court' }).then((v) => ({ perspective: p, ...v }))))).filter(Boolean);

const judgeBrief = judges.map((j) => `[${j.perspective}] best=${j.bestAngle} rec=${j.recommendation} crdoSafe=${j.crdoSafe}\n  fixDir: ${j.fixDirection}\n  concerns: ${j.concerns}`).join('\n\n');
const chief = await agent(`${CONTEXT}

OBER-RICHTER. Die 4 Council-Vorschlaege + die 3 Richter-Voten unten. Faelle das Urteil: bei Split die
konservativste Precision-Linie. VETO: jede Variante, die CRDO/ALAB/BE druckt, ist RAUS (crdoVerification
MUSS belegen, dass CRDO ungedrueckt bleibt). blessedDesign konkret + data-learned (keine Magic Number) ODER
sauber begruendetes reject/defer (dann bleibt es bei 'Lampen warnen nur'). Gib CHIEF_SCHEMA.

COUNCIL:
${proposalBrief}

RICHTER-VOTEN:
${judgeBrief}`, { schema: CHIEF_SCHEMA, label: 'chief:riskpenalty', phase: 'Court' });

return { councilProposals: proposals.map((p) => ({ angle: p.angle, signal: p.signal, sparesCRDO: p.sparesCRDO })), judges: judges.map((j) => ({ p: j.perspective, best: j.bestAngle, rec: j.recommendation })), decision: chief };
