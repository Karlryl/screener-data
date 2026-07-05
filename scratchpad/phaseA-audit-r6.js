export const meta = {
  name: 'phaseA-audit-r6',
  description: 'Phase-A Runde-6 Konvergenz-Audit: Regress ALLER R3+R4+R5-Fixes + Restlücken, getaktet, 3-Stimmen-adversarial-Verify, Synthese',
  phases: [
    { title: 'Finder', detail: '20 unabhängige Finder, Batch 5 (Rate-Limit)' },
    { title: 'Verify', detail: '3 adversariale Skeptiker je Befund, Batch ~6' },
    { title: 'Synthese', detail: 'dedup, kategorisieren, Konvergenz-Urteil' },
  ],
};

const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';

const FIX_CONTEXT = `
DU AUDITIERST den hypergrowth-Scoring-Screener (Node.js) auf Branch loop/hypergrowth-neu @ a8803f29bd.
REPO: ${REPO}  (Scoring-Code: src/scoring/*.js, Tests: tests/scoring/*.test.js).
node-Aufruf: "C:/Program Files/nodejs/node.exe". Snapshots in ${REPO}/snapshots/ (4683 .json, flaches
norm()-Format: norm(s,'annualRev') liefert flache Zahlen-Arrays, NICHT {value:..}).

DIES IST RUNDE 6 (Konvergenz-Check). Verlauf: R3 fand 7 SA -> Court R3 5 Fälle (C1-C5) umgesetzt; R4
bestätigte sie sauber, fand 2 SA (R4-A atomic-write, R4-B signTrack) -> gefixt; R5 bestätigte alles sauber
AUSSER 1 SA -> Court R5 -> 2 Fixes gerade umgesetzt (Stand HEAD a8803f29bd):
- R5-Fix A (score.js Winsor-Bounds): die OBERE opMargin-Schranke ist jetzt die PHYSISCHE 1.0 (opIncQ<=
  revenueQ -> opMargin<=1, wie gm-Clip), NICHT mehr symmetrisches p99 (das klemmte legitime 68-100%-Margen
  FNV/VICI/IBKR/APP auf marginTraj=0). Untere opMargin-Schranke + qoq BLEIBEN data-learned p1/p99. Prüfe:
  klemmt 1.0 jetzt irgendwas Legitimes? Sind >1-Stubs (300251.SZ) korrekt auf 1.0? qoq weiterhin korrekt?
- R5-Fix B (score.js hasCurrentRevenue): strikt annualRev[0] (neuestes GJ) statt firstPresent — RTEZ
  (fuehrende null-Luecke, staler 5000) jetzt korrekt data-suspect. Prüfe: fiel ein LEGITIMER Name mit raus?
- R4-Fix A (run-screener.js): Self-Baseline-Write ATOMAR (writeJsonAtomic). Wirklich zu (tmp+rename)?
- R4-Fix B (score.js trackOf): NetIncome-Rescue bei firstPresent(OpInc)===0 (601162.SS). + C4 wcov===1 Skip.
RUNDE 4/5 stuften als NICHT-scoringAffecting ein (NICHT erneut als SA hochstufen ohne STARKE neue Evidenz):
gpGrowth gpYoY-Level (q rang-neutral), capEff cycleDiscount roic<0-Vorzeichen (ENEL.MI 1 Name, Fall-4),
calibrate.js (Offline), Display-Caps topN, A/H-Dedup + annualCurrencyLeak-Naming (Deploy/kein US-Primary).

Prüfe ALLE Fixes (C1-C5 + peakMargin + R4-A/B + R5-A/B) SCHARF auf REGRESS + verbleibende Lücken:
- C1 (run-screener.js loadUniverse): Coverage-Floor zieht jetzt gegen eine SELF-BASELINE
  (snapshots/_last_good_disk.json High-Water, monoton via nextHighWater) statt manifest.n_ok.
  assertCoverageFloor(loaded, baseline, ratio) rein; I/O in loadUniverse. Prüfe: Race/Reset-Verhalten,
  I/O-Fehler-Robustheit, Erstlauf fail-open, kann ein ECHTES Schrumpfen durchrutschen? High-Water-Lock?
- C5 (router.js Branch d): noOperatingRev = isPreRevenue(s) (=!hasPresent||alle present==0) UND
  NON_OPERATING_VEHICLE_INDUSTRY. PIN.L jetzt exclude. Prüfe: kein echtes Pre-Rev-Biotech/Miner gefangen?
- C2+R5-A (axes.js marginTrajectory/revAcceleration + score.js): opMargin-Schranke = [data-learned p1,
  PHYSISCH 1.0]; qoq-Raten = symmetrisch data-learned p1/p99. Pre-Pass über route-Namen, durch rawAxisValue
  geplumbt. Prüfe: Determinismus (quantile-sort), Sample-Sammlung (route-only?), klemmt 1.0 Legitimes?
  >1-Stubs korrekt? qoq-Symmetrie noch korrekt (kein Hochmargen-Analogon dort)? Interagiert es mit C4?
- C4 (score.js + engine.js coverageWeight): NACH q()+weightedScore ein 2. Pass je Kohorte: score' =
  cohMedian + wcov*(score-cohMedian), wcov = present-Achsen-Gewicht/Gesamt-Gewicht. wcov=1 -> unverändert.
  Heilt das renorm-on-drop-Varianz-Artefakt (Namen mit weniger Achsen rankten zu hoch). Prüfe: cohMedian
  korrekt (Median der BASIS-Scores)? Singleton-/all-low-coverage-Kohorte? Kann Shrinkage einen legitimen
  daten-vollständigen Namen verzerren? wcov-Edge (no-axes)? Determinismus? Interagiert C4 mit C2/C3?
  Wird score≥90 jetzt zu aggressiv unterdrückt (sollten echte 8/8-Top-Namen ≥90 erreichen können)?
- C3 (score.js isDataSuspect + hasCurrentRevenue): data-suspect-Gate vom revenueTTM-Envelope entkoppelt.
  marketCap fehlt = harter Ausschluss; D wegen nanRatio = exclude; nur-revenueTTM-fehlt -> exclude NUR
  wenn KEIN aktueller Umsatz (newest annualRev>0 ODER revQ present>0). data-suspect 30->16. Prüfe: wird
  ein echter Junk-/Null-Umsatz-Name fälschlich re-inkludiert? Greift hasCurrentRevenue korrekt? survival?
- peakMargin (lamps.js): presentValues-Kompaktierung (Null-Lücken). Reine Display-Lampe.

NOCH OFFEN (autonom-fixbar, NICHT umgesetzt — falls du sie findest: bestätige NICHT-scoringAffecting oder
eskaliere NUR mit STARKER neuer Score/Rang-Evidenz): calibrate.js gate-mirror (Offline-Tool 213 Phantom),
dilution Heavy-Diluter-Clamp (perzentil-robust), WINSOR_TAIL-Doku-Praezision. (signTrack ist GEFIXT, R4-B.)
DEPLOY-PHASE (Re-Pull-gebunden, NICHT jetzt): snapshot.js Balance-Trunkierung (~41%, treibt capEff/wcov),
score.js fxSuspect tradingFxRateApplied (0/4683), annualCurrencyLeak-Naming. GBp/GBX = ERLEDIGT (Court R2).

METHODIK-INVARIANTEN (Verletzung = Befund): keine Magic Numbers (Config/Repo-Konvention); renorm-on-drop
nie Fake-50; FIELD_REGISTRY-Shapes Vertrag; Determinismus CI==lokal; effektives N (5000≠5000 unabhängig);
Anker PLTR/CRDO/ALAB/BE + Auslands plausibel.

BASELINE (HEAD a8803f29bd): route 3354, survival 73, data-suspect 17, score≥90: 1, PLTR 79.72/CRDO 77.0/
ALAB 70.9/BE 61.47/2383.TW 86.66/2308.TW 87.59/WTC.AX 67.96, 211 Tests grün, 0 NaN.

REGELN: Lies den ECHTEN Code + rechne mit node gegen echte Snapshots. Erfinde NICHTS — sauberer Bereich ->
clean:true, findings:[]. Jeder Befund MUSS file:line + konkrete Reproduktion tragen. scoringAffecting=true
nur bei echter Routing/Score/Exclude-Wirkung.`;

const FINDERS = [
  { key: 'regress-c1-floor', area: 'C1-Regress: run-screener.js loadUniverse Self-Baseline + nextHighWater + assertCoverageFloor. Race/Reset, I/O-Fehler, Erstlauf, High-Water-Lock bei legitimem Schrumpfen, kann echtes Schrumpfen durchrutschen? Schreibt loadUniverse bei JEDEM Aufruf (Seiteneffekt in Tests/Tools)?' },
  { key: 'regress-c5-pinl', area: 'C5-Regress: router.js Branch (d) noOperatingRev=isPreRevenue. Wird ein ECHTES Pre-Rev-Biotech/Dev-Stage-Miner mit present-all-zero annualRev fälschlich excludiert? isPreRevenue-Coupling-Risiko? node über alle 4683.' },
  { key: 'regress-c2-winsor', area: 'C2-Regress: axes.js marginTrajectory/revAcceleration Winsorisierung + score.js Pre-Pass/quantile/winsorTailBounds. Determinismus (sort-stabilität)? Sample-Sammlung (route-only korrekt)? Klemmt es legitime kleine-aber-reale Firmen? quantile off-by-one/empty/NaN? WINSOR_TAIL=0.01 als Magic Number vertretbar? p1/p99 stabil über Läufe?' },
  { key: 'regress-c4-shrink', area: 'C4-Regress: score.js Coverage-Shrinkage + engine.js coverageWeight. cohMedian = Median der BASIS-Scores korrekt? wcov GEWICHTS-basiert korrekt? Singleton-Kohorte (median=self -> score unverändert)? all-low-coverage-Kohorte (median selbst niedrig-coverage)? Verzerrt Shrinkage einen daten-vollständigen Namen? Wird score>=90 zu aggressiv unterdrückt (kann ein echter 8/8-Top-Name noch >=90)? no-axes-Interaktion? Determinismus?' },
  { key: 'regress-c3-f39', area: 'C3-Regress: score.js isDataSuspect + hasCurrentRevenue. Wird ein echter Junk-/Null-aktuell-Umsatz-Name fälschlich re-inkludiert (Gegenrichtungs-Score)? hasCurrentRevenue (newest annualRev>0 ODER revQ present>0) korrekt gegen firstPresent/presentValues? marketCap-fehlt weiter harter Ausschluss? survival route-only intakt? node: die 16 verbleibenden data-suspect + die 14 neu-inkludierten prüfen.' },
  { key: 'c2-c4-interaction', area: 'INTERAKTION C2×C4×C3: Die drei neuen Pässe komponieren in score.js (Winsor-Pre-Pass -> q/weightedScore -> Shrinkage). Reihenfolge korrekt? Verändert C2 die wcov-Berechnung (Winsor macht eine Achse non-null/null)? Werden C3-neu-inkludierte Namen korrekt geshrinkt? Doppel-Penalty Fall-3+C4? Gibt es eine Kohorte, wo die Komposition einen Namen unplausibel macht?' },
  { key: 'core-q-weighted-cov', area: 'engine.js Kern: q()/percentileRank/weightedScore/coverageWeight. coverageWeight präsent/total korrekt (weight<=0, value null/NaN)? renorm-on-drop Summe? NaN-Lecks? Konsistenz weightedScore-present vs coverageWeight-present (gleiche present-Definition)?' },
  { key: 'new-helpers-quantile', area: 'score.js neue Helfer quantile/winsorTailBounds + die Median-Nutzung in C4. quantile linear-interpoliert korrekt an den Rändern (p=0,1)? leere/1-Element-Samples? NaN-Filter? Median (quantile 0.5) bei gerader/ungerader Länge? Determinismus der sort?' },
  { key: 'axes-other', area: 'axes.js übrige Achsen (revGrowthLevel, ruleOfX, gpGrowth, capitalEfficiency, dilution, revisionsMomentum) — UNGEÄNDERT durch R3, aber Red-Team: ungeguarded Division, Vorzeichen-Flip, near-zero-Nenner anderswo als C2 sie fixte? capEff drop-on-absence (R2 Fall 3) + C4 zusammen korrekt?' },
  { key: 'lamps-all', area: 'lamps.js: peakMargin (C3-Hygiene-Regress: presentValues korrekt, MU feuert weiter?), crashRisk, annualCurrencyLeak (EXCLUDE-Lampe), newestQtrSuspect (R2-Fall-2 De-Fire-Regress). False-Positive/Negative?' },
  { key: 'snapshot-contract', area: 'snapshot.js norm/metricVal/firstPresent/presentValues/hasPresent/FIELD_REGISTRY. Stimmen Feld-Pfade mit echten Shapes? firstPresent/presentValues (von C3/C5 genutzt) korrekt? Stille Fehl-Reads?' },
  { key: 'sector-weights', area: 'formulas/*.js: 12 Sektor-Gewichtsvektoren. wcov (C4) summiert ax.w[track] — sind alle Gewichte present/positiv? Eine Achse mit Gewicht 0 in einem Track (zaehlt nicht in totalW)? marginTrajectory/revAccel-Gewichte plausibel?' },
  { key: 'trackof-signtrack', area: 'score.js trackOf + engine.js signTrack. Der OFFENE signTrack-present-Null-Befund (601162.SS): IST er wirklich nur 1 unsichtbarer Name, oder bewegt er nach C4 (Shrinkage aendert Sichtbarkeit) doch Output? F5-NetIncome-Rescue intakt? Eskaliere wenn jetzt scoringAffecting.' },
  { key: 'country-geo', area: 'country.js normalizeCountry + region. Fehl-Mappings? geo-Anreicherung auf allen Output-Zeilen (auch nach C4-Rangwechsel)?' },
  { key: 'overview-rankings', area: 'score.js produceRankings + overview.js. Nach C4 verschieben sich Ränge stark (PLTR 137->47). topN-Kappung/Sortier-Determinismus (cmpTicker) intakt? geo-Test (overview[0]) robust? Doppel-Zählung? _raw-Strip?' },
  { key: 'dedup-issuer', area: 'score.js Issuer-Dedup. Nach C3 (data-suspect 30->16) aendern sich Dedup-Kandidaten (dup-issuer 183->184). Wählt der Tie-Break korrekt? Verliert ein US-Primärbein? Läuft Dedup VOR/NACH dem geänderten data-suspect-Gate konsistent?' },
  { key: 'router-universe', area: 'router.js structExclude/isUS/isForeignListed + alle Exclude-Gates. Nach C5 (survival 74->73). Fehl-Exclusionen? Reihenfolge? non-us/OTC-Grey?' },
  { key: 'determinism-ci', area: 'Determinismus CI==lokal über die NEUEN Pässe: quantile-sort (C2), Median (C4), winsorBounds, coverageWeight — alle order-/locale-invariant? Hängt ein Score jetzt von fs.readdirSync-Reihenfolge ab? index.json/outputs byte-deterministisch über 2 Läufe?' },
  { key: 'methodology-fdr', area: 'Methodik: Heilt C4 das effektive-N/Falsch-Entdeckungs-Problem WIRKLICH (Inv. 4+7), oder verschiebt es es nur? Führt die Shrinkage Richtung Median eine NEUE Verzerrung ein (z.B. Mittelfeld-Stauchung)? Mehrfachtest/FDR-Sicht über die 12 Kohorten. Stille Caps (topN, WINSOR_TAIL)?' },
  { key: 'score90-suppression', area: 'Nach C4 erreicht nur noch 1 Name score≥90 (vorher ~20). Red-Team: ist das ZU aggressiv? Kann ein genuin exzellenter 8/8-Name (alle Achsen top-Perzentil) noch ≥90 erreichen, oder deckelt die Median-Shrinkage die Spitze unfair? Rechne: max möglicher 8/8-Score je Kohorte vs cohMedian. Plausibel?' },
];

const FINDING_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    area: { type: 'string' }, clean: { type: 'boolean' },
    findings: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: {
        title: { type: 'string' }, severity: { type: 'string', enum: ['high', 'medium', 'low', 'note'] },
        file: { type: 'string' }, line: { type: 'string' },
        scoringAffecting: { type: 'boolean' }, evidence: { type: 'string' },
      },
      required: ['title', 'severity', 'file', 'line', 'scoringAffecting', 'evidence'],
    } },
  },
  required: ['area', 'clean', 'findings'],
};
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } },
  required: ['refuted', 'reason', 'confidence'],
};
const SYNTH_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['CLEAN', 'FINDINGS'] }, confirmedCount: { type: 'number' },
    regressions: { type: 'array', items: { type: 'string' } },
    newScoringAffecting: { type: 'array', items: { type: 'string' } },
    autonomousFixable: { type: 'array', items: { type: 'string' } },
    deployPhase: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' },
  },
  required: ['verdict', 'confirmedCount', 'regressions', 'newScoringAffecting', 'autonomousFixable', 'deployPhase', 'summary'],
};

const finderPrompt = (f) => `${FIX_CONTEXT}

DEIN BEREICH: ${f.area}

Gründlich: Code lesen, mit node gegen echte Snapshots rechnen. FINDING_SCHEMA zurück (clean:true wenn
sauber). scoringAffecting nur bei echter Routing/Score/Exclude-Wirkung.`;

phase('Finder');
let raw = [];
for (let i = 0; i < FINDERS.length; i += 5) {
  const batch = FINDERS.slice(i, i + 5);
  const res = await parallel(batch.map((f) => () =>
    agent(finderPrompt(f), { schema: FINDING_SCHEMA, label: 'find:' + f.key, phase: 'Finder' })));
  raw.push(...res.map((r, j) => r ? { ...r, _key: batch[j].key } : { _key: batch[j].key, _failed: true }));
  log(`Finder-Batch ${i / 5 + 1}/${Math.ceil(FINDERS.length / 5)}: ${res.filter(Boolean).length}/${batch.length}`);
}
const failed = raw.filter((r) => r._failed).map((r) => r._key);
if (failed.length) {
  const retryDefs = FINDERS.filter((f) => failed.includes(f.key));
  for (let i = 0; i < retryDefs.length; i += 5) {
    const batch = retryDefs.slice(i, i + 5);
    const res = await parallel(batch.map((f) => () => agent(finderPrompt(f), { schema: FINDING_SCHEMA, label: 'retry:' + f.key, phase: 'Finder' })));
    res.forEach((r, j) => { if (r) { const idx = raw.findIndex((x) => x._key === batch[j].key); raw[idx] = { ...r, _key: batch[j].key }; } });
  }
}
const allFindings = [];
for (const r of raw) if (r && r.findings) for (const f of r.findings) allFindings.push({ ...f, _from: r._key });
const respondedCount = raw.filter((r) => !r._failed).length;
log(`Finder fertig: ${respondedCount}/${FINDERS.length} Bereiche, ${allFindings.length} Roh-Befunde`);

phase('Verify');
const verified = [];
for (let i = 0; i < allFindings.length; i += 2) {
  const batch = allFindings.slice(i, i + 2);
  const results = await parallel(batch.map((finding) => () =>
    parallel([0, 1, 2].map((vi) => () =>
      agent(`${FIX_CONTEXT}

ADVERSARIALE VERIFIKATION (Skeptiker ${vi + 1}/3). Versuche, diesen Befund zu WIDERLEGEN. Lies den echten
Code, rechne mit node. Default refuted=true bei Unsicherheit/nicht-reproduzierbar. refuted=false NUR bei
unabhängiger Bestätigung.

BEFUND (Bereich ${finding._from}, severity ${finding.severity}, scoringAffecting ${finding.scoringAffecting}):
"${finding.title}"
Datei: ${finding.file}:${finding.line}
Evidenz: ${finding.evidence}

VERDICT_SCHEMA zurück.`, { schema: VERDICT_SCHEMA, label: `verify:${finding._from}#${vi + 1}`, phase: 'Verify' })))
      .then((votes) => {
        const v = votes.filter(Boolean);
        return { ...finding, votes: v, notRefuted: v.filter((x) => !x.refuted).length, confirmed: v.filter((x) => !x.refuted).length >= 2 };
      })));
  verified.push(...results.filter(Boolean));
  log(`Verify ${Math.min(i + 2, allFindings.length)}/${allFindings.length}`);
}
const confirmed = verified.filter((f) => f.confirmed);
log(`Verify fertig: ${confirmed.length}/${verified.length} bestätigt`);

phase('Synthese');
const confirmedBrief = confirmed.map((f) =>
  `[${f.severity}${f.scoringAffecting ? ',scoringAffecting' : ''}] ${f.title} (${f.file}:${f.line}, ${f._from}, ${f.notRefuted}/3) — ${f.evidence}`).join('\n');
const synth = await agent(`${FIX_CONTEXT}

Synthese-Richter Runde 6 (Konvergenz-Check). Unten die BESTÄTIGTEN Befunde (>=2/3 Skeptiker konnten nicht
widerlegen). Dedup, kategorisiere, fälle das Konvergenz-Urteil. verdict=CLEAN nur bei 0 bestätigten
scoringAffecting-Befunden (Regress ODER neu). Autonom-fixbare + Deploy-Phase zählen NICHT gegen CLEAN, sind
aber zu listen. Sei streng: vager/nicht-reproduzierter Befund gehört NICHT in newScoringAffecting.

BESTÄTIGTE BEFUNDE (${confirmed.length}):
${confirmedBrief || '(keine)'}

SYNTH_SCHEMA zurück.`, { schema: SYNTH_SCHEMA, label: 'synthese', phase: 'Synthese' });

return {
  finderCoverage: `${respondedCount}/${FINDERS.length}`,
  rawFindings: allFindings.length,
  confirmedFindings: confirmed.length,
  synthesis: synth,
  confirmedDetail: confirmed.map((f) => ({ title: f.title, severity: f.severity, scoringAffecting: f.scoringAffecting, file: f.file, line: f.line, from: f._from, notRefuted: f.notRefuted, evidence: f.evidence })),
};
