'use strict';
/**
 * lib/druckenmiller/scoreboard.js — die Eintritts-Regel, die Erstpassage und die
 * Anzeige-Tafel des Scoreboards (BUILD-SPEC v1 §0.4, [REV3-4], [REV5-1], [REV8-1],
 * [REV9-1..4], [REV10-1..3]; Registrierung = Datei B, Chunk 2).
 *
 * DREI DINGE, DIE HIER ABSICHTLICH FEHLEN:
 *  1. KEIN Bootstrap, keine MDE, kein L. Die Rechenwege der Lesung stehen in
 *     scoreboard-read.js und werden NUR vom Lese-Job (R1/R2/R3) importiert. Der
 *     Tageslauf darf sie nicht einmal laden — genau das prueft der Call-Path-Test
 *     ([REV10-5]): eine MDE, die taeglich berechnet werden KANN, wird irgendwann
 *     taeglich angesehen, und dann ist die Vorregistrierung wertlos.
 *  2. KEINE Zahl aus der Luft: jede Konstante hier hat ihre Zeile in Datei B, und
 *     registration.test.js vergleicht Code gegen Datei (Muster R5 aus Chunk 1).
 *  3. KEIN Default fuer die Barrieren-Skalierung. Siehe BARRIER_SCALINGS.
 *
 * DIE BARRIEREN-SKALIERUNG IST ENTSCHIEDEN (Rat 9 Teil 2a, 2026-09-19, Vorsitz ~65 %):
 * sigma_h = sigma_daily(63 Tage) * sqrt(h), k = 1 unveraendert, registriert in Datei B als
 * `barrier.sigmaScaling = "horizon"` und offengelegt im gehashten AMENDMENT 01. Woertlich
 * gelesen (eine Tagesvol breit) loeste die Erstpassage auf echten Balken im Median nach 3
 * Balken auf, 19 % am ersten - damit messen 63 und 126 dasselbe. Beide Lesungen sind hier
 * implementiert, KEINE ist Default: `resolveEntry` verlangt die Skalierung als Argument, und
 * `assertScalingBranch` prueft sie beim LESEN der Registrierung (nicht erst bei der ersten
 * faelligen Aufloesung - Review-Fund).
 *
 * WER DIE DREI WAECHTER RUFT: `assertScalingBranch` laeuft im Tageslauf
 * (scripts/druckenmiller-log-internals.js, registrierungenLesen). `armCollapseCheck` und
 * `armsMatchAlphaStar` gehoeren zum LESE-Job (R1/R2/R3) und werden dort gerufen; im Tageslauf
 * haben sie nichts zu tun, weil es dort keine Lesung gibt. Bis der Lese-Job gebaut ist, sind
 * sie ueber die feste Stichprobe in tests/druckenmiller/fixtures/arm-collapse-sample.json
 * gepruefte Zusicherungen - und `scoreboard-read.assertReadPreconditions` ist die Stelle, die
 * sie verbindlich macht, sobald gelesen wird.
 */

const SIGMA_WINDOW = 63;              // Datei B: barrier.sigmaWindowBars
const K = 1;                          // Datei B: barrier.k (fest)
const HORIZONS = [63, 126];           // Datei B: horizons
const DECISIVE_ARM = 63;              // Datei B: decisiveArm ([REV9-1])
const BLOCK_FLOOR = { 63: 8, 126: 6 };// Datei B: blockFloor ([REV5-1])
const WARMUP_SESSIONS = 20;           // Datei B: warmupLiveSessions ([REV5-2])
const ALPHA_READ = 0.05 / 3;          // Datei B: alphaRead (Bonferroni ueber R1..R3)
const ALPHA_STAR_TWO_ARM = 0.0083;    // Datei B: alphaStar.twoArm   (Residuum 1)
const ALPHA_STAR_ONE_ARM = 0.0167;    // Datei B: alphaStar.singleArm(Residuum 1)
const BETA = 0.20;                    // Datei B: beta
const KNOWLEDGE_BAR_PP = 3;           // Datei B: labelBounds.knowledgeBarPp
const TRADE_BAR_PP = 5;               // Datei B: labelBounds.tradeBarPp
const RETIRE_MDE_PP = 6;              // Datei B: retirement.mdeBoundPp
const SCHEMA = 'druckenmiller-candidates/1';
const SCORED_STATES = ['CONFIRMS', 'WEAK'];

/** Die zwei implementierten Lesungen der Barrieren-Breite. Keine ist Default. */
const BARRIER_SCALINGS = {
  daily: () => 1,
  horizon: (arm) => Math.sqrt(arm),
};

/** Die vier registrierten Etiketten, geordnet und erschoepfend ([REV8-1]). */
const LABELS = [
  { id: 1, text: 'nicht belegt', test: (L) => L <= 0 },
  { id: 2, text: 'Effekt belegt, unter Wissenslatte (3 pp)', test: (L) => L > 0 && L < KNOWLEDGE_BAR_PP },
  { id: 3, text: 'belegt, Wissenslatte erreicht, unter Handelsschwelle (5 pp)', test: (L) => L >= KNOWLEDGE_BAR_PP && L < TRADE_BAR_PP },
  { id: 4, text: 'belegt, Handelsschwelle (5 pp) erreicht', test: (L) => L >= TRADE_BAR_PP },
];
const LABEL_NOT_READABLE = 'noch nicht lesbar';
/** Residuum 2: fester Satz, nie gerechnet. */
const MULTIPLICITY_NOTE = 'Ein Etikett kann zwischen zwei Lesungen bei UNVERAENDERTER Evidenz '
  + 'zurueckfallen, weil alpha* strenger wird, sobald der zweite Arm mitgelesen wird — das ist ein '
  + 'Artefakt der Mehrfachtestung, keine neue Messung.';

/** Anzeige-Vertrag ([REV10-5] + Residuum 3: der 126-Arm friert mit demselben Stempel). */
const PANEL_FROZEN_FIELDS = ['label', 'L', 'MDE', 'level', 'readId', 'readDate', 'nextReadDate',
  'L126', 'MDE126', 'level126'];
const PANEL_LIVE_FIELDS = ['entries', 'resolved', 'blocks', 'lastSessionDate'];

const entryIdOf = (e) => `${e.ticker}|${e.date}|${e.arm}`;

/** Stichproben-Standardabweichung der Tages-Log-Renditen der letzten <SIGMA_WINDOW> Balken. */
function sigmaAtEntry(closes) {
  if (!Array.isArray(closes) || closes.length < SIGMA_WINDOW + 1) return null;
  const teil = closes.slice(closes.length - (SIGMA_WINDOW + 1));
  const r = [];
  for (let i = 1; i < teil.length; i++) r.push(Math.log(teil[i] / teil[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) * (b - m), 0) / (r.length - 1));
  return Number.isFinite(sd) && sd > 0 ? sd : null;
}

/**
 * Darf diese Sitzung Eintraege schreiben? Vier Ausschluesse, alle vorregistriert und alle
 * mit demselben Grund: die Zeile misst an so einem Tag nicht den Markt (Residuum 5).
 */
function sessionEligible(session) {
  if (!session) return { eligible: false, reason: 'no-session' };
  if (session.backfilled) return { eligible: false, reason: 'backfilled' };
  if (session.lowFreshness) return { eligible: false, reason: 'lowFreshness' };
  if (session.highChurn) return { eligible: false, reason: 'highChurn' };
  if (session.raw) return { eligible: false, reason: 'separation-gate-raw' };
  return { eligible: true, reason: null };
}

/**
 * Zustandswechsel eines Tickers gegen seinen LETZTEN BEOBACHTETEN Zustand — nicht gegen
 * den Vortag. Ein Ticker, der zwei Wochen ohne Balken war, wechselt erst, wenn er wieder
 * sichtbar ist (Wieder-Bewaffnung, [REV8-1]/§0.4: kein Nachdatieren, kein Nachholeintrag).
 */
function transitionsFor(lastStates, stated) {
  const out = [];
  for (const k of stated) {
    if (!k || k.state === null) continue;
    const vorher = lastStates.get(k.ticker);
    if (vorher === k.state) continue;
    out.push({ ticker: k.ticker, from: vorher === undefined ? null : vorher, to: k.state, m1: k.m1, m2: k.m2 });
  }
  return out;
}

/**
 * Abkuehlzeit je Arm: nach einem Eintritt fuer denselben Ticker im selben Arm gibt es
 * <arm> Balken lang keinen weiteren. Gezaehlt wird in SITZUNGEN der Reihe, nicht in
 * Kalendertagen — der Ledger ist die Uhr.
 */
function coolOffOver(lastEntryIndex, currentIndex, arm) {
  if (lastEntryIndex === undefined || lastEntryIndex === null) return true;
  return currentIndex - lastEntryIndex >= arm;
}

/**
 * Die Eintraege einer Sitzung, je Arm. Reine Funktion: sie bekommt die Historie als
 * Karten (letzter Zustand, letzter Eintritt je Ticker+Arm) und gibt die neuen Zeilen.
 */
function buildEntries(opts) {
  const { session, stated, lastStates, lastEntryIndex, sessionIndex, warmup } = opts;
  const zulassung = sessionEligible(session);
  if (!zulassung.eligible) return { rows: [], skipped: zulassung.reason, transitions: 0 };
  const byTicker = new Map(stated.map((k) => [k.ticker, k]));
  // DIE ERSTE BEOBACHTUNG IST KEIN WECHSEL (gemessen 2026-09-19 am echten Lauf: ohne diese
  // Zeile schreibt die allererste Sitzung 2.794 Eintraege — 1.397 Ticker x 2 Arme — weil
  // jeder Ticker aus `null` kommt. Das waere ein Massen-Eintritt in EINEM Block, und die
  // Abkuehlzeit haette danach 63 bzw. 126 Sitzungen lang fast alles gesperrt. Die
  // Spezifikation spricht von einem ZUSTANDSWECHSEL und von Wieder-Bewaffnung am NAECHSTEN
  // Wechsel; ein Ticker ohne Vorzustand bewaffnet sich also, er tritt nicht ein.)
  const alle = transitionsFor(lastStates, stated);
  const armiert = alle.filter((w) => w.from === null).length;
  const wechsel = alle.filter((w) => w.from !== null && SCORED_STATES.includes(w.to));
  const rows = [];
  for (const w of wechsel) {
    // sigma63 und Schlusskurs kommen aus der Roh-Zeile desselben Durchgangs
    // (confirmation.rowExtra) — ohne sigma gibt es keine Barriere und damit keinen Eintrag.
    const k0 = byTicker.get(w.ticker);
    if (!k0 || !Number.isFinite(k0.sigma63) || !Number.isFinite(k0.close) || k0.close <= 0) continue;
    for (const arm of HORIZONS) {
      if (!coolOffOver(lastEntryIndex.get(`${w.ticker}|${arm}`), sessionIndex, arm)) continue;
      rows.push({
        schema: SCHEMA, kind: 'ENTRY', date: session.date, generatedAt: session.generatedAt,
        ticker: w.ticker, arm, state: w.to, fromState: w.from,
        entryClose: k0.close, sigma63: k0.sigma63, k: K,
        m1: Number.isFinite(w.m1) ? w.m1 : null, m2: Number.isFinite(w.m2) ? w.m2 : null,
        sessionIndex, warmup: warmup === true,
      });
    }
  }
  return { rows, skipped: null, transitions: wechsel.length, armedFirstObservation: armiert };
}

/**
 * Erstpassage EINES Eintrags. `scaling` ist Pflicht ('daily' | 'horizon') und kommt aus
 * Datei B — ohne sie wirft die Funktion, statt eine Lesung zu unterstellen.
 * `forward` = die Schlusskurse NACH dem Eintritt, in Reihenfolge, maximal <arm> Stueck.
 */
function resolveEntry(entry, forward, scaling) {
  if (!Object.prototype.hasOwnProperty.call(BARRIER_SCALINGS, String(scaling))) {
    throw new Error('[druckenmiller] Barrieren-Skalierung fehlt oder ist unbekannt: '
      + `${String(scaling)} — erlaubt sind ${Object.keys(BARRIER_SCALINGS).join('|')}, und Datei B muss sie benennen.`);
  }
  const faktor = BARRIER_SCALINGS[String(scaling)](entry.arm);
  const breite = entry.k * entry.sigma63 * faktor;
  const up = entry.entryClose * Math.exp(breite);
  const down = entry.entryClose * Math.exp(-breite);
  const fenster = forward.slice(0, entry.arm);
  for (let i = 0; i < fenster.length; i++) {
    const p = fenster[i].close;
    if (!Number.isFinite(p) || p <= 0) continue;
    if (p >= up) return { outcome: 'UP', bars: i + 1, date: fenster[i].date, barrierUp: up, barrierDown: down, scaling };
    if (p <= down) return { outcome: 'DOWN', bars: i + 1, date: fenster[i].date, barrierUp: up, barrierDown: down, scaling };
  }
  if (fenster.length < entry.arm) {
    return { outcome: null, bars: fenster.length, date: null, barrierUp: up, barrierDown: down, scaling };
  }
  // Am Horizont nicht erreicht = zensiert, als Nicht-Ereignis gezaehlt und getrennt
  // berichtet ([REV4-5]) — nie weggeworfen.
  return { outcome: 'CENSORED', bars: entry.arm, date: fenster[fenster.length - 1].date, barrierUp: up, barrierDown: down, scaling };
}

/** Zeile fuer den append-only-Ledger: eine Aufloesung aendert nie die Eintritts-Zeile. */
function resolutionRow(entry, res, generatedAt) {
  return {
    schema: SCHEMA, kind: 'RESOLUTION', date: res.date, generatedAt,
    entryId: entryIdOf(entry), ticker: entry.ticker, arm: entry.arm, state: entry.state,
    outcome: res.outcome, bars: res.bars, barrierUp: res.barrierUp, barrierDown: res.barrierDown,
    scaling: res.scaling, warmup: entry.warmup === true,
  };
}

/**
 * Nicht ueberlappende Datums-Bloecke, die die Eintritts-Daten aufspannen ([REV4-5]).
 * Gezaehlt wird auf dem Sitzungs-Raster: ein Block ist <blockBars> aufeinanderfolgende
 * Sitzungen. Das sind KALENDER-Bloecke, keine unabhaengigen Bloecke — der Geltungssatz
 * dazu steht in Datei B und auf der Tafel.
 */
function blockCount(entryDates, sessions, blockBars) {
  if (!entryDates.length || !sessions.length) return 0;
  const idx = new Map(sessions.map((d, i) => [d, i]));
  const belegt = entryDates.map((d) => idx.get(d)).filter((i) => i !== undefined).sort((a, b) => a - b);
  if (!belegt.length) return 0;
  let bloecke = 0, grenze = -1;
  for (const i of belegt) {
    if (i > grenze) { bloecke++; grenze = i + blockBars - 1; }
  }
  return bloecke;
}

/** Das Etikett zu einem L (in Prozentpunkten). Erste passende Regel gewinnt. */
function labelFor(L) {
  if (!Number.isFinite(L)) return { id: null, text: LABEL_NOT_READABLE };
  const t = LABELS.find((l) => l.test(L));
  return { id: t.id, text: t.text };
}

/** alpha* je Lesung: zwei Arme -> 0,0083, ein Arm -> 0,0167 (Residuum 1, beide Literale). */
function alphaStarFor(armsRead) {
  return armsRead >= 2 ? ALPHA_STAR_TWO_ARM : ALPHA_STAR_ONE_ARM;
}

/**
 * Stilllegungs-Regel ([REV10-1]), ausgewertet NUR bei R2 und R3 — nie bei R1, nie
 * zwischen Lesungen. Erschoepfend und symmetrisch in L und MDE.
 */
function retirementDecision(opts) {
  const { readId, blocksReached, L, mde } = opts;
  if (readId === 'R1') return { branch: null, retire: false, reason: 'no-retirement-evaluation-at-R1' };
  if (!blocksReached) {
    return readId === 'R3'
      ? { branch: 'sunset', retire: true, reason: 'block floor never reached — no evidence path ([REV9-3])' }
      : { branch: 'i', retire: false, reason: LABEL_NOT_READABLE };
  }
  if (L <= 0 && mde <= RETIRE_MDE_PP) return { branch: 'ii', retire: true, reason: 'well-powered null' };
  if (L < KNOWLEDGE_BAR_PP && mde > RETIRE_MDE_PP) return { branch: 'iii', retire: true, reason: 'undecidable at twice the knowledge bar' };
  return { branch: 'iv', retire: false, reason: 'badge stays with its label' };
}

/**
 * Monatsende <m> Monate nach <iso>, OHNE den Tag im Monat mitzuschleppen.
 *
 * REVIEW-FUND (js-Reviewer, reproduziert 2026-09-19): `Date.UTC(jahr, monat + m, tag)` rollt
 * still in den Folgemonat, wenn der Tag dort nicht existiert — T0 = 2028-02-29 ergab R2 =
 * 2030-03-31 statt 2030-02-28, also eine Lesung einen Monat zu spaet, ohne einen Laut. Der
 * Tag wird hier nie gebraucht (gelesen wird am Monatsende), also darf er auch nicht mitreisen.
 */
const monatsEndeNach = (iso, m) => {
  const d = new Date(iso + 'T00:00:00Z');
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m + 1, 0));
  return t.toISOString().slice(0, 10);
};

/**
 * Lese-Plan ([REV9-4]): T0 = Hash-Datum von Datei B. R2/R3 sind Kalender (24/36 Monate),
 * R1 ist das erste Monatsende, an dem BEIDE Bedingungen halten (12 Monate aufgeloeste
 * Eintraege UND Blockuntergrenze des 63-Arms). Liegt R1 hinter R2, entfaellt R1.
 */
function readSchedule(t0, r1Ready) {
  const r2 = monatsEndeNach(t0, 24);
  const r3 = monatsEndeNach(t0, 36);
  const r1Frueh = monatsEndeNach(t0, 12);
  let r1 = null;
  if (r1Ready) r1 = r1Ready > r1Frueh ? monatsEndeNach(r1Ready, 0) : r1Frueh;
  if (r1 && r1 >= r2) r1 = null;             // uebersprungen, R2 ist die erste Lesung
  return { T0: t0, R1: r1, R2: r2, R3: r3 };
}

/** Das naechste Lesedatum nach <readId>; nach R3 ist es null (Residuum 8). */
function nextReadDate(schedule, readId) {
  if (readId === 'R3') return null;
  if (readId === 'R2') return schedule.R3;
  if (readId === 'R1') return schedule.R2;
  return schedule.R1 || schedule.R2;
}

/**
 * Die Tafel. `lastRead` ist der EINGEFRORENE Lesungs-Datensatz (oder null vor R1),
 * `counters` sind die Tageszaehler. Die zwei Feldlisten sind der Vertrag: die eingefrorenen
 * Felder kommen ausschliesslich aus `lastRead`, die Zaehler nie in die eingefrorene Zeile.
 */
function panelDisplay(lastRead, counters, schedule) {
  const frozen = {};
  for (const f of PANEL_FROZEN_FIELDS) frozen[f] = lastRead && lastRead[f] !== undefined ? lastRead[f] : null;
  if (lastRead && lastRead.readId) frozen.nextReadDate = nextReadDate(schedule, lastRead.readId);
  if (!lastRead) frozen.label = LABEL_NOT_READABLE;
  const live = {};
  for (const f of PANEL_LIVE_FIELDS) live[f] = counters && counters[f] !== undefined ? counters[f] : null;
  return {
    frozen, live,
    stamp: lastRead && lastRead.readDate
      ? `Stand: Read ${lastRead.readId} vom ${lastRead.readDate} · naechster Read ${frozen.nextReadDate || '—'}`
      : null,
    multiplicityNote: MULTIPLICITY_NOTE,
    countersAreNotEvidence: true,
  };
}

/**
 * DIE FORM DES KANDIDATEN-LEDGERS: EINE Zeile je Sitzung. appendRow (Chunk 0) laesst nur
 * streng vorwaerts laufende Daten zu — drei Zeilen mit demselben Datum sind unmoeglich.
 * Also traegt eine Sitzungs-Zeile ihre Eintraege und Aufloesungen als Listen und ihre
 * Zustandswechsel als Karte. Die vier Reduktionen darunter lesen genau diese Form.
 */

/** Letzter BEOBACHTETER Zustand je Ticker (aus den Zustandswechseln der Sitzungen). */
function lastStateByTicker(sessionRows) {
  const m = new Map();
  for (const r of sessionRows) {
    if (!r || !r.stateChanges) continue;
    for (const [t, z] of Object.entries(r.stateChanges)) m.set(t, z);
  }
  return m;
}

/** Letzter Eintritts-Sitzungsindex je Ticker und Arm (fuer die Abkuehlzeit). */
function lastEntryIndexFrom(sessionRows) {
  const m = new Map();
  for (const r of sessionRows) {
    for (const e of (r && r.entries) || []) m.set(`${e.ticker}|${e.arm}`, e.sessionIndex);
  }
  return m;
}

/** Noch nicht aufgeloeste Eintraege: Eintritt ohne passende Aufloesung. */
function openEntriesFrom(sessionRows) {
  const offen = new Map();
  for (const r of sessionRows) {
    for (const e of (r && r.entries) || []) offen.set(entryIdOf(e), e);
    for (const a of (r && r.resolutions) || []) offen.delete(a.entryId);
  }
  return Array.from(offen.values());
}

/** Live-Sitzungen (nicht rueckgerechnet) — die Uhr des 20-Sitzungen-Warm-ups. */
function liveSessionCount(sessionRows) {
  return sessionRows.filter((r) => r && r.backfilled === false).length;
}

/**
 * WAECHTER 1 (Rat 9 Teil 2a, Bedingung 4): die in Datei B genannte Skalierung MUSS der
 * Zweig sein, der zur Laufzeit gerufen wird. Kein stiller Default, keine zweite Lesung.
 */
function assertScalingBranch(registered) {
  if (!Object.prototype.hasOwnProperty.call(BARRIER_SCALINGS, String(registered))) {
    throw new Error('[druckenmiller] Datei B nennt die Barrieren-Skalierung ' + JSON.stringify(registered)
      + ' — implementiert sind nur ' + Object.keys(BARRIER_SCALINGS).join('|') + '.');
  }
  return { scaling: String(registered), factorAt63: BARRIER_SCALINGS[String(registered)](63),
    factorAt126: BARRIER_SCALINGS[String(registered)](126) };
}

/** Zweiseitige KS-Statistik zweier Stichproben (D und D*sqrt(n_eff)). */
function ksTwoSample(a, b) {
  if (!a.length || !b.length) return { D: null, Dscaled: null };
  const x = a.slice().sort((p, q) => p - q), y = b.slice().sort((p, q) => p - q);
  const werte = [...new Set(x.concat(y))].sort((p, q) => p - q);
  let D = 0, i = 0, j = 0;
  for (const v of werte) {
    while (i < x.length && x[i] <= v) i++;
    while (j < y.length && y[j] <= v) j++;
    D = Math.max(D, Math.abs(i / x.length - j / y.length));
  }
  const ne = Math.sqrt((x.length * y.length) / (x.length + y.length));
  return { D, Dscaled: D * ne, n1: x.length, n2: y.length };
}

const medianOf = (xs) => {
  if (!xs.length) return null;
  const s2 = xs.slice().sort((p, q) => p - q), m = s2.length >> 1;
  return s2.length % 2 ? s2[m] : (s2[m - 1] + s2[m]) / 2;
};

/**
 * WAECHTER 2 (Rat 9 Teil 2a, Bedingung 4): der ARM-KOLLAPS-Waechter. Unterscheiden sich die
 * Aufloesungszeiten der beiden Arme auf der festen Stichprobe NICHT, dann messen 63 und 126
 * dasselbe — und eine BH-Korrektur ueber zwei identische Tests ist eine Testfamilien-Panne.
 * Dann wird nicht gewertet.
 *
 * Gemessen 2026-09-19 unter H auf Shard 0 (die Stichprobe in
 * tests/druckenmiller/fixtures/arm-collapse-sample.json): Median 31 vs 58 Balken,
 * Verhaeltnis 1,87, KS D = 0,450, D*sqrt(n_eff) = 10,28 gegen die 1-%-Schwelle 1,63.
 */
function armCollapseCheck(bars63, bars126, thresholds) {
  const t = thresholds || {};
  const ksMin = Number.isFinite(t.ksScaledMin) ? t.ksScaledMin : 1.63;      // alpha 0,01
  const medMin = Number.isFinite(t.medianRatioMin) ? t.medianRatioMin : 1.25;
  const ks = ksTwoSample(bars63, bars126);
  const m63 = medianOf(bars63), m126 = medianOf(bars126);
  const ratio = m63 && m126 ? m126 / m63 : null;
  const differ = ks.Dscaled !== null && ratio !== null && ks.Dscaled >= ksMin && ratio >= medMin;
  return {
    differ, blocksScoring: !differ,
    ks, median63: m63, median126: m126, medianRatio: ratio,
    thresholds: { ksScaledMin: ksMin, medianRatioMin: medMin },
    reason: differ ? null : 'arm-collapse: die Aufloesungszeiten der beiden Arme unterscheiden sich nicht',
  };
}

/**
 * WAECHTER 3 (Rat 9 Teil 2a, Bedingung 4): die Zahl formal getrennter Arme IST das N der
 * alpha*-Korrektur. Wer einen Arm streicht oder hinzufuegt, aendert alpha* — nie stillschweigend.
 */
function armsMatchAlphaStar(arms) {
  const n = Array.isArray(arms) ? new Set(arms).size : 0;
  const alphaStar = alphaStarFor(n);
  const erwartet = n >= 2 ? ALPHA_STAR_TWO_ARM : ALPHA_STAR_ONE_ARM;
  return { arms: n, alphaStar, ok: alphaStar === erwartet && n === HORIZONS.length };
}

module.exports = {
  SCHEMA, SIGMA_WINDOW, K, HORIZONS, DECISIVE_ARM, BLOCK_FLOOR, WARMUP_SESSIONS,
  ALPHA_READ, ALPHA_STAR_TWO_ARM, ALPHA_STAR_ONE_ARM, BETA, KNOWLEDGE_BAR_PP, TRADE_BAR_PP,
  RETIRE_MDE_PP, SCORED_STATES, BARRIER_SCALINGS, LABELS, LABEL_NOT_READABLE, MULTIPLICITY_NOTE,
  PANEL_FROZEN_FIELDS, PANEL_LIVE_FIELDS,
  entryIdOf, sigmaAtEntry, sessionEligible, transitionsFor, coolOffOver, buildEntries,
  lastStateByTicker, lastEntryIndexFrom, openEntriesFrom, liveSessionCount,
  resolveEntry, resolutionRow, blockCount, labelFor, alphaStarFor, retirementDecision,
  readSchedule, monatsEndeNach, nextReadDate, panelDisplay,
  assertScalingBranch, ksTwoSample, medianOf, armCollapseCheck, armsMatchAlphaStar,
};
