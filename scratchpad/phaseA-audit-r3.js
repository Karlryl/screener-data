export const meta = {
  name: 'phaseA-audit-r3',
  description: 'Phase-A Runde-3 unabhängiges Scoring-Audit: Regress der 6 Court-R2-Fixes + Red-Team-Lücken, getaktet, 3-Stimmen-adversarial-Verify, Synthese',
  phases: [
    { title: 'Finder', detail: '20 unabhängige Finder, Batch 5 (Rate-Limit)' },
    { title: 'Verify', detail: '3 adversariale Skeptiker je Befund, Batch ~6' },
    { title: 'Synthese', detail: 'dedup, kategorisieren, Konvergenz-Urteil' },
  ],
};

const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';

// Kontext, den JEDER Finder kennen muss: die 6 frisch umgesetzten Court-R2-Fixes (Regress-Ziel).
const FIX_CONTEXT = `
DU AUDITIERST den hypergrowth-Scoring-Screener (Node.js) auf Branch loop/hypergrowth-neu @ cd4413d1f8.
REPO: ${REPO}  (Scoring-Code: src/scoring/*.js, Tests: tests/scoring/*.test.js).
node-Aufruf: "C:/Program Files/nodejs/node.exe". Snapshots in ${REPO}/snapshots/ (4683 .json, flaches
norm()-Format: norm(s,'annualRev') liefert flache Zahlen-Arrays, NICHT {value:..}).

GERADE umgesetzt (Court Runde 2) — auf REGRESS prüfen:
- Fall 7 (run-screener.js loadUniverse): neue reine Fn assertCoverageFloor wirft, wenn loaded <
  0.95*manifest.n_ok. Konstante COVERAGE_FLOOR_RATIO. Manifest-relativ.
- Fall 1a+8 (router.js): survival-Track 'pre-revenue-biotech'->'pre-revenue'. isNonOperatingVehicle
  Branch (d): !hasPresent(annualRev) UND Industrie /asset management|closed-end fund|shell companies|
  bdc|term trust/ -> exclude non-operating-rev. EDGE: PIN.L (Asset-Mgmt, annualRev [0,0,0,0]=present-
  Null) bleibt survival (Branch d greift nur !hasPresent). Prüfe: wird ein ECHTES Pre-Rev-Biotech/
  Dev-Stage-Miner fälschlich excludiert? Ist die present-Null-Lücke (PIN.L) ein Problem?
- Fall 4 (axes.js capitalEfficiency): cycleDiscount binäres !rising-Gate -> stetige Rampe
  blend=clamp((cur-prev)/(cur-histRest),0,1); cycleDiscount=1-(1-rawDisc)*(1-blend). Prüfe Monotonie,
  Kanten-Stetigkeit, Extremverhalten.
- Fall 3 (axes.js capitalEfficiency): currentLiabilities NICHT mehr zu 0 koerziert (rechnete ROA für
  48.2%). Jahr zählt nur mit PRESENT curLiab UND invested>0; sonst Achse null -> renorm-on-drop.
  48.2% der Namen haben jetzt capEff=null. EDGE: WTC.AX curLiab=[null*4] -> capEff droppt -> Score
  87->92 (bekannter F41-Stale-Snapshot). Prüfe: ist die 48%-Achsen-Sparsity ein Kohorten-Bias?
  Inflatiert renorm-on-drop unfair (wie der frühere R2F1-Fehler, nur diesmal bei ECHT fehlenden Daten)?
- Fall 2 (lamps.js newestQtrSuspect, EXCLUDE-Lampe): 5. Leg de-firet, wenn q0-OpMarge ~ Vorjahres-Q
  (Idx4, |diff|<=0.20). VCEL de-firet (FP), SNDK+Samsung feuern weiter. Prüfe: über-exoneriert die
  Leg? Was, wenn oi[4]/rev[4] fehlt/<=0? Lässt sie ein ECHT korruptes Quartal durch?

METHODIK-INVARIANTEN (Verletzung = Befund): keine Magic Numbers (Config/Repo-Konvention); renorm-on-
drop nie Fake-50; FIELD_REGISTRY-Namen/Shapes sind Pipeline-Vertrag; Determinismus CI==lokal; Anker
PLTR/CRDO/ALAB/BE + Auslands müssen plausibel bleiben.

REGELN: Lies den ECHTEN Code + rechne wo möglich mit node gegen echte Snapshots. Erfinde NICHTS —
wenn dein Bereich sauber ist, gib clean:true, findings:[] zurück. Jeder Befund MUSS file:line +
konkrete Reproduktion/Evidenz tragen. scoringAffecting=true nur, wenn es Routing/Score/Exclude real
bewegt (nicht Doku/Tote-Code/Test-Lücken).`;

const FINDERS = [
  { key: 'regress-fall7-floor', area: 'Fall-7-Regress: run-screener.js loadUniverse + assertCoverageFloor. Greift der Floor korrekt? Was bei fehlendem/0/NaN manifest.n_ok? Bricht er legitime Läufe? Ist 0.95 eine versteckte Magic Number oder sauber benannt/begründet?' },
  { key: 'regress-fall1-8-vehicle', area: 'Fall-1a+8-Regress: router.js Relabel + isNonOperatingVehicle Branch (d). Wird ein ECHTES Pre-Rev-Biotech oder legitimer Dev-Stage-Name (Uran/Lithium/Gold) fälschlich excludiert? Ist die present-Null-Lücke (PIN.L: annualRev [0,0,0,0] bleibt survival) inkonsistent? Matcht die Industrie-Regex zu breit/eng? Prüfe gegen echte snapshots.' },
  { key: 'regress-fall4-cycle', area: 'Fall-4-Regress: axes.js capitalEfficiency cycleDiscount-Rampe. Ist sie monoton (mehr OpInc nie niedrigerer Score)? Stetig an der alten Kante? Division durch ~0 (cur-histRest klein)? Extremverhalten == altem Gate? node-Gegenrechnung an Grenzfällen.' },
  { key: 'regress-fall3-capeff', area: 'Fall-3-Regress: axes.js capitalEfficiency drop-on-absence. 48.2% capEff=null -> renorm-on-drop. Inflatiert das Scores unfair (vgl R2F1-Lektion)? Ist die Achse jetzt zu sparse für faire Kohorten-Perzentile? WTC.AX 87->92 — symptomatisch für ein breiteres Problem? node-Lauf: verteile capEff-null über Branchen/Tracks.' },
  { key: 'regress-fall2-newestqtr', area: 'Fall-2-Regress: lamps.js newestQtrSuspect 5. De-Fire-Leg. Über-exoneriert sie (lässt echt korruptes Q durch)? Verhalten bei oi[4]/rev[4] fehlend/<=0/negativ? Kann ein fabriziertes Quartal, das zufällig dem Vorjahres-Q gleicht, durchrutschen? Andere EXCLUDE-Lampe (annualCurrencyLeak) unberührt?' },
  { key: 'core-q-percentile', area: 'engine.js Kern-Numerik: q()/percentileRank/weightedScore. Off-by-one in Perzentil-Rängen? renorm-on-drop-Gewichtung korrekt (Summe=1)? Tie-Handling? NaN/Infinity-Lecks? Leere/Einzel-Kohorte?' },
  { key: 'axes-revgrowth-ruleofx', area: 'axes.js übrige Achsen: revGrowthLevel, ruleOfX/ruleOf40, und alle Achsen außer capEff. Ungeguarded Division? Vorzeichen-Flips bei negativen/near-zero Nennern? Stationaritäts-/Vol-Norm-Probleme?' },
  { key: 'lamp-crashrisk-leak', area: 'lamps.js: crashRisk + annualCurrencyLeak (2. EXCLUDE-Lampe) + die restlichen Timing-Lampen. False-Positive/Negative? annualCurrencyLeak ccy-Logik korrekt? peakMargin/cyclePeak konsistent mit axes cycleDiscount?' },
  { key: 'snapshot-fieldregistry', area: 'snapshot.js: norm()/metricVal/FIELD_REGISTRY. Stimmen alle Feld-Pfade mit den echten Snapshot-Shapes? Stille Fehl-Reads (falsches Feld -> null)? Vertrag verletzt? Fuzz gegen echte snapshots.' },
  { key: 'sector-weights', area: 'formulas/*.js: die 12 Sektor-Gewichtsvektoren + routingPredicate je Formel. Summieren Gewichte sinnvoll? Achsen-Keys existieren alle? Ein Sektor mit kaputtem/fehlendem Achsen-Verweis? Inkonsistenz zwischen Formeln?' },
  { key: 'trackof-engine', area: 'score.js trackOf + engine.js signTrack/fcfTrack. Profitable/unprofitable-Split korrekt (NetIncome-Rescue F5)? Grenzfälle leere annualOpInc? fcfTrack-Artefakt-Erkennung?' },
  { key: 'country-geo', area: 'country.js normalizeCountry + region-Buckets. Fehl-Mappings? Länder ohne Bucket -> Default falsch? Berührt es Routing (.IR/.AE/non-us)? Konsistenz mit isForeignListed.' },
  { key: 'overview-rankings', area: 'score.js produceRankings + overview.js. topN-Kappung korrekt (overview-Länge vs branch-Länge)? geo-Anreicherung auf ALLEN Zeilen? Sortier-Determinismus (cmpTicker)? Doppel-Zählung zwischen Töpfen?' },
  { key: 'dilution-axis', area: 'axes.js dilution (post-R2F1). Clampt statt droppt korrekt? Slope-Term bei near-zero old robust? Heavy-Diluter behält Achse? Gegen echte Diluter-Namen rechnen.' },
  { key: 'gpgrowth-margintraj', area: 'axes.js gpGrowth (F9) + marginTrajectory (F12) Guards. Greifen gm∈[0,1] und revenueQ>0 vollständig? Restliche Vorzeichen-Flip-Pfade? Korrupte Alt-Margen?' },
  { key: 'dedup-issuer', area: 'score.js Issuer-Dedup (mcapOf/fxSuspect/cmpTicker), UNABHÄNGIG von Fall 5. Wählt der Tie-Break in same-ccy-Gruppen korrekt? Verliert ein US-Primärbein an ein Auslandsbein? meta.name-Issuer-Key-Kollisionen?' },
  { key: 'datasuspect-grade', area: 'score.js isDataSuspect + F39 live re-grade + methods/data-quality.js gradeSnapshot. Re-Gradet das Gate korrekt (nicht stale)? route-only-Scoping intakt (survival exempt)? Falsch-Exclusionen?' },
  { key: 'router-structexclude', area: 'router.js structExcludeReason/isUS/isForeignListed + balance-sheet-bank/insurer/mortgage-reit/lender-gp0-Gates. Fehl-Exclusionen/-Inklusionen? Reihenfolge-Bugs? non-us/OTC-Grey-Logik.' },
  { key: 'calibrate-tool', area: 'calibrate.js buildCalibMatrix (Offline-Tool, F35). Spiegelt es scoreUniverse-Membership (data-suspect/dup-issuer-Gate)? Drift zum Live-Scoring? (Output-folgenlos, aber Konsistenz.)' },
  { key: 'methodology-fdr', area: 'Methodik-Gesamtsicht: Mehrfachtest/FDR-Ehrlichkeit, stille Caps (topN, sampling), effektives N (5000 Aktien != 5000 unabhängige), Kohorten-Summen-Konsistenz. Versteckte Annahmen, die Falsch-Entdeckungen begünstigen?' },
];

const FINDING_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    area: { type: 'string' },
    clean: { type: 'boolean', description: 'true wenn KEIN echtes Problem gefunden' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low', 'note'] },
          file: { type: 'string' },
          line: { type: 'string' },
          scoringAffecting: { type: 'boolean' },
          evidence: { type: 'string', description: 'konkrete Reproduktion/node-Beleg' },
        },
        required: ['title', 'severity', 'file', 'line', 'scoringAffecting', 'evidence'],
      },
    },
  },
  required: ['area', 'clean', 'findings'],
};

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    refuted: { type: 'boolean', description: 'true wenn der Befund WIDERLEGT/kein echtes Problem ist' },
    reason: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['refuted', 'reason', 'confidence'],
};

const SYNTH_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['CLEAN', 'FINDINGS'], description: 'CLEAN wenn 0 bestätigte scoringAffecting-Befunde' },
    confirmedCount: { type: 'number' },
    regressions: { type: 'array', items: { type: 'string' } },
    newScoringAffecting: { type: 'array', items: { type: 'string' } },
    autonomousFixable: { type: 'array', items: { type: 'string' } },
    deployPhase: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['verdict', 'confirmedCount', 'regressions', 'newScoringAffecting', 'autonomousFixable', 'deployPhase', 'summary'],
};

const finderPrompt = (f) => `${FIX_CONTEXT}

DEIN BEREICH: ${f.area}

Arbeite gründlich: Code lesen, mit node gegen echte Snapshots rechnen wo es Evidenz schafft. Gib das
FINDING_SCHEMA zurück (clean:true + findings:[] wenn sauber). Severity ehrlich, scoringAffecting nur
bei echter Routing/Score/Exclude-Wirkung.`;

// --- Phase 1: Finder, getaktet in Batches von 5 (Server-Rate-Limit) ---
phase('Finder');
let raw = [];
for (let i = 0; i < FINDERS.length; i += 5) {
  const batch = FINDERS.slice(i, i + 5);
  const res = await parallel(batch.map((f) => () =>
    agent(finderPrompt(f), { schema: FINDING_SCHEMA, label: 'find:' + f.key, phase: 'Finder' })));
  raw.push(...res.map((r, j) => r ? { ...r, _key: batch[j].key } : { _key: batch[j].key, _failed: true }));
  log(`Finder-Batch ${i / 5 + 1}/${Math.ceil(FINDERS.length / 5)}: ${res.filter(Boolean).length}/${batch.length} geantwortet`);
}
// Retry-Pass für gefallene Finder (1x)
const failed = raw.filter((r) => r._failed).map((r) => r._key);
if (failed.length) {
  log(`Retry ${failed.length} gefallene Finder: ${failed.join(', ')}`);
  const retryDefs = FINDERS.filter((f) => failed.includes(f.key));
  for (let i = 0; i < retryDefs.length; i += 5) {
    const batch = retryDefs.slice(i, i + 5);
    const res = await parallel(batch.map((f) => () =>
      agent(finderPrompt(f), { schema: FINDING_SCHEMA, label: 'retry:' + f.key, phase: 'Finder' })));
    res.forEach((r, j) => { if (r) { const idx = raw.findIndex((x) => x._key === batch[j].key); raw[idx] = { ...r, _key: batch[j].key }; } });
  }
}

// Befunde flach sammeln (nur echte, mit Quelle markiert)
const allFindings = [];
for (const r of raw) {
  if (r && r.findings) for (const f of r.findings) allFindings.push({ ...f, _from: r._key });
}
const respondedCount = raw.filter((r) => !r._failed).length;
log(`Finder fertig: ${respondedCount}/${FINDERS.length} Bereiche geantwortet, ${allFindings.length} Roh-Befunde`);

// --- Phase 2: 3-Stimmen-adversariales Verify, getaktet (≤6 Agenten gleichzeitig = 2 Befunde × 3) ---
phase('Verify');
const verified = [];
for (let i = 0; i < allFindings.length; i += 2) {
  const batch = allFindings.slice(i, i + 2);
  const results = await parallel(batch.map((finding) => () =>
    parallel([0, 1, 2].map((vi) => () =>
      agent(`${FIX_CONTEXT}

ADVERSARIALE VERIFIKATION (Skeptiker ${vi + 1}/3). Versuche, diesen Befund zu WIDERLEGEN. Lies den
echten Code, rechne mit node. Default: refuted=true bei Unsicherheit oder wenn die Evidenz nicht
real reproduzierbar ist. refuted=false NUR, wenn du das Problem unabhängig BESTÄTIGEN kannst.

BEFUND (Bereich ${finding._from}, severity ${finding.severity}, scoringAffecting ${finding.scoringAffecting}):
"${finding.title}"
Datei: ${finding.file}:${finding.line}
Evidenz des Finders: ${finding.evidence}

Gib VERDICT_SCHEMA zurück.`, { schema: VERDICT_SCHEMA, label: `verify:${finding._from}#${vi + 1}`, phase: 'Verify' })))
      .then((votes) => {
        const v = votes.filter(Boolean);
        const notRefuted = v.filter((x) => !x.refuted).length;
        const confirmed = notRefuted >= 2; // Mehrheit kann NICHT widerlegen -> real
        return { ...finding, votes: v, notRefuted, confirmed };
      })));
  verified.push(...results.filter(Boolean));
  log(`Verify ${Math.min(i + 2, allFindings.length)}/${allFindings.length} Befunde`);
}

const confirmed = verified.filter((f) => f.confirmed);
log(`Verify fertig: ${confirmed.length}/${verified.length} bestätigt (>=2/3 Skeptiker konnten nicht widerlegen)`);

// --- Phase 3: Synthese ---
phase('Synthese');
const confirmedBrief = confirmed.map((f) =>
  `[${f.severity}${f.scoringAffecting ? ',scoringAffecting' : ''}] ${f.title} (${f.file}:${f.line}, von ${f._from}, ${f.notRefuted}/3 bestätigt) — ${f.evidence}`).join('\n');

const synth = await agent(`${FIX_CONTEXT}

Du bist der Synthese-Richter für Runde 3 des Phase-A-Audits. Unten die BESTÄTIGTEN Befunde
(>=2/3 adversariale Skeptiker konnten sie nicht widerlegen). Dedupliziere, kategorisiere und fälle
das Konvergenz-Urteil.

KONVERGENZ-DEFINITION: verdict=CLEAN nur, wenn 0 bestätigte scoringAffecting-Befunde (Regress oder
neu) übrig sind. Autonom-fixbare Nicht-scoringAffecting-Befunde (Doku/Test-Lücken/Tote-Code) und
Deploy-Phase-Befunde (Re-Pull-gebunden) zählen NICHT gegen CLEAN, sind aber zu listen.

Kategorien: regressions (bricht einen der 6 Fixes), newScoringAffecting (neu, bewegt Score/Routing/
Exclude -> Council/Court vor Fix), autonomousFixable (kein Output-Effekt), deployPhase (Re-Pull/
Datenschicht). Sei streng: ein vager oder nicht-reproduzierter Befund gehört NICHT in
newScoringAffecting.

BESTÄTIGTE BEFUNDE (${confirmed.length}):
${confirmedBrief || '(keine)'}

Gib SYNTH_SCHEMA zurück.`, { schema: SYNTH_SCHEMA, label: 'synthese', phase: 'Synthese' });

return {
  finderCoverage: `${respondedCount}/${FINDERS.length}`,
  rawFindings: allFindings.length,
  confirmedFindings: confirmed.length,
  synthesis: synth,
  confirmedDetail: confirmed.map((f) => ({ title: f.title, severity: f.severity, scoringAffecting: f.scoringAffecting, file: f.file, line: f.line, from: f._from, notRefuted: f.notRefuted, evidence: f.evidence })),
};
