'use strict';
/**
 * scripts/write-board-history.js — Vintage-Writer der eigenen Messreihe (Masterplan 2.3).
 *
 * INERT gebaut: KEIN CI-Wiring, KEIN echtes Vintage #1. Grundgesetz 6 / Task 2.14
 * (revAcceleration-Fix) blockieren den scharfen Start — die Formel darf nicht auf
 * der P2-kaputten Accel-Achse eingefroren werden. Dieses Werkzeug steht bereit,
 * damit es beim 2.14-Landing sofort scharfgeschaltet werden kann.
 *
 * Setzt die 2.8-MESS-FUNDAMENT-Spezifikation um (Formel-Ledger §6/§7, A9/A10/A12):
 *   §6  Voll-Kohorten je Board einfrieren (nicht Top-N) — Substrat outputs/hypergrowth/full/.
 *   §7  PIT-Freeze der Kontroll-Felder je Zeile: Markt-Beta, EV/Sales, Preis/Bruttogewinn
 *       + Umsatz-/GP-Quartalsserien MIT Perioden-Ende + fetchedAt.
 *   A9  Kontroll-Felder aus snapshots/<TICKER>.json joinen (Board-Rows tragen sie nicht);
 *       Beta-Coverage real ~60 % → fehlend explizit null + pitCoverage-Block (Attenuations-Ausweis).
 *   A10 revenueQEnds/grossProfitQEnds kommen parallel via pull-yahoo; fehlt es → null + pitGaps.
 *   A12 Kompaktierung frühestens t0+2Q (≈180 Kalendertage); PIT-Voll-Snapshots vorher nach
 *       board-history-archive/ (GG7c, außerhalb CI-Checkout). NICHTS wird ohne Archiv-Kopie entfernt.
 *       Das Archivziel MUSS per BOARD_HISTORY_ARCHIVE_DIR gesetzt sein (T20, fail-closed) —
 *       weder Temp noch Checkout überleben, und die Archiv-Kopie ist die einzige der PIT-Blöcke.
 *
 * Wert-Plausibilitäts-Gate VOR dem Schreiben (Ledger 2.3 „Wert-Plausibilitäts-Gate"):
 *   Vergleich gegen das jüngste nicht ausgeschlossene Vorgänger-Vintage; P99-Tages-Delta
 *   der Scores. Die wirksame Grenze ist IMMER
 *       Tagesgrenze × Tagesabstand zum Vorgänger,
 *   wobei die Tagesgrenze der gemessene Boden MIN_GATE_THRESHOLD ist, solange ein Board
 *   keine eigene eingefrorene Schwelle hat, sonst die eingefrorene Schwelle (Herleitung
 *   an den Konstanten). Eigene Schwelle = GATE_CALIB_QUANTILE der Tages-Stichproben × 2,
 *   eingefroren erst nach CALIBRATION_SAMPLES Stichproben MIT Bewegung; Stichproben sind
 *   pro Tag normiert, suspect-/Bruch-Tage liefern keine. Liegt der Vorgänger mehr als
 *   GATE_MAX_ABSTAND_TAGE zurück, urteilt die Wert-Achse NICHT (gate.abstandZuGross +
 *   ::warning::) — sonst sperrt sich die Messreihe selbst fest, je länger sie steht.
 *   Schwellen-Bruch / NaN-Einbruch / Coverage-Absturz / Kohorten-Kollaps → Vintage MIT
 *   suspect:true geschrieben (nie still) + exit 2 (0.7-Kanal). KEINE Löschung je.
 *   Neukalibrierung 2026-08-03: die bis dahin eingefrorenen Schwellen stammten
 *   ausnahmslos aus Vintages, die auf board-history/_excluded.json stehen — Details und
 *   Messgrundlage im Kopf von board-history/_gate-calibration.json.
 *
 * picks-history/ wird NIE berührt (Schutzliste, GG). Strukturell erzwungen: assertNoPicksHistory()
 * prüft jeden Ausgabepfad; dieses Skript baut nie einen Pfad mit picks-history-Bezug.
 *
 * Usage:
 *   node scripts/write-board-history.js [--date YYYY-MM-DD] [--dry-run] [--compact]
 * Exit: 0 = ok · 1 = harter Fehler (Inputs fehlen) · 2 = suspect-Vintage geschrieben.
 */
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../lib/atomic-write.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');
const { boardStatus } = require('../src/scoring/board-status.js');

// ── benannte Konstanten (keine Magic Numbers; Herkunft dokumentiert) ─────────
const REPO_ROOT = path.resolve(__dirname, '..');

// Pfade werden aus einem Base gebildet, damit Tests hermetisch gegen ein Temp-Verzeichnis
// laufen können (L4 — keine Abhängigkeit von echten snapshots/outputs). Default = REPO_ROOT.
function resolvePaths(base) {
  // BH-154: ARCHIVE_DIR lag vorher IMMER unter base — für den Produktionspfad
  // (base===REPO_ROOT) hieß das INNERHALB des Checkouts, entgegen dem eigenen
  // Kommentar "außerhalb CI-Checkout": ein frischer actions/checkout löscht den
  // kompletten Baum, eine dort abgelegte Archiv-Kopie wäre flüchtig (BH-103
  // verschärft das zur Messblockade).
  //
  // T20 (03.08.2026): Der BH-154-Fix wählte als Default den Temp-Ordner des Systems.
  // Das tauscht nur die Art der Flüchtigkeit: die Archiv-Kopie ist der EINZIGE
  // Verbleib der PIT-Blöcke, die compact() danach aus dem Vintage strippt — im Temp
  // löscht sie das Betriebssystem, ohne dass irgendjemand es merkt. Es gibt keinen
  // richtigen Default: repo-lokal dupliziert committete Vintages, Temp verliert sie.
  // Also fail-closed — ohne konfiguriertes Ziel wirft der Archivpfad, statt still
  // irgendwohin zu schreiben. Ein Archivziel IM Checkout wirft ebenfalls (das ist
  // genau der BH-154-Defekt). Getter statt Feld, weil resolvePaths() beim Laden des
  // Moduls läuft und jeder Aufrufer sonst am Archiv-Wurf stürbe, auch der normale
  // Vintage-Lauf, der das Archiv nie anfasst. Test-Hermetik (_setPaths(base)) bleibt
  // unverändert base-relativ, weil board-history.test.js Check (c) das Archiv
  // gezielt unter dem Test-Sandkasten erwartet.
  const isDefaultBase = base === REPO_ROOT;
  return {
    FULL_DIR: path.join(base, 'outputs', 'hypergrowth', 'full'),
    CALIBRATION_FILE: path.join(base, 'outputs', 'calibration.json'),
    MACRO_REGIME_FILE: path.join(base, 'outputs', 'macro-regime.json'),
    // T155/W3: Träger des Universums-Hashes, geschrieben von scripts/write-excluded-list.js.
    UNIVERSE_HASH_FILE: path.join(base, 'outputs', 'universe-hash.json'),
    SNAP_DIR: path.join(base, 'snapshots'),
    HISTORY_DIR: path.join(base, 'board-history'),          // GG7b: committet, Messgrundlage
    get ARCHIVE_DIR() {                                      // GG7c: gitignored, außerhalb CI-Checkout
      if (!isDefaultBase) return path.join(base, 'board-history-archive');
      const dir = (process.env.BOARD_HISTORY_ARCHIVE_DIR || '').trim();
      if (!dir) {
        throw new Error('write-board-history: Archivziel nicht konfiguriert — PIT-Daten gehören nicht nach tmp. '
          + 'BOARD_HISTORY_ARCHIVE_DIR auf ein dauerhaftes Verzeichnis AUSSERHALB des Checkouts setzen '
          + '(GG7c); ohne das darf keine Kompaktierung laufen, weil die Archiv-Kopie der einzige '
          + 'Verbleib der PIT-Blöcke ist.');
      }
      const abs = path.resolve(dir);
      if (abs === REPO_ROOT || abs.startsWith(REPO_ROOT + path.sep)) {
        throw new Error('write-board-history: Archivziel liegt innerhalb des Checkouts (' + abs + ') — '
          + 'ein frischer actions/checkout löscht es (BH-154). Ziel außerhalb des Repos wählen.');
      }
      return abs;
    },
    get EXCLUDED_FILE() { return path.join(this.HISTORY_DIR, '_excluded.json'); },
    get GATE_CALIB_FILE() { return path.join(this.HISTORY_DIR, '_gate-calibration.json'); },
    // F-9 Stufe 1 (Rat-gedeckt, REINE MESSUNG): committete Sidecar-Reihe der p99Δ/thr/
    // beta-cov-Werte, die sonst nur im fluechtigen Lauf-Protokoll stehen. Eigener
    // Top-Level-Ordner (nicht unter board-history/), damit die Suspect-Ausschluss-
    // Pathspec ":(exclude)board-history/$VINTAGE_DATE" im Commit-Schritt sie NICHT
    // beruehrt — die Sidecar-Reihe muss gerade an Suspect-Tagen mitfahren.
    P99_DELTA_HISTORY_FILE: path.join(base, 'data-health', 'p99-delta-history.json'),
    // 6.2-E2 (Earnings-Blowout): Quelle des Report-Datums, das buildPit PIT-einfriert.
    EARNINGS_CAL_FILE: path.join(base, 'earnings-calendar.json'),
    base,
  };
}
let P = resolvePaths(REPO_ROOT);
function _setPaths(base) { P = resolvePaths(base || REPO_ROOT); _earningsCache = null; return P; }

// 2.3-Gate-Kalibrierung: Anzahl messbarer Tages-Deltas, bevor eine board-eigene Schwelle
// eingefroren wird. Ein Vintage ist erst messbar, wenn es einen Vorgänger hat (Vintage #1
// hat keinen). MINDEST-Anzahl, kein Ausreichen-Kriterium: siehe updateGateCalibration
// (Bewegung nötig).
//
// WAR 3 („erste 3 Live-Vintages", Ledger) — und 3 ist nachweislich zu wenig. Am Live-Stand
// vom 30.07.2026 gemessen: 8 von 13 eingefrorenen Schwellen lagen falsch, in BEIDE Richtungen.
// Vier stammten aus zufällig ruhigen Fenstern und lagen UNTER der normalen Tagesbewegung
// (health-care 1,00 · software-comm-services 1,00 · utilities 1,20 · materials 1,40), vier
// hatten einen einzelnen Bruchtag im Fenster und lagen ÜBER allem, was je gemessen wurde
// (industrials 17,60 · consumer-staples 18,00 · semiconductors 38,20 · it-services 40,20 —
// letzteres aus der Stichprobe [0,0,0,0,0,20,1]). Bei drei Stichproben setzt EINE Messung
// die Schwelle allein; das ist eine Lotterie über die Kalibrierphase, keine Kalibrierung.
// 20 ≈ vier Betriebswochen (Lauf Di–Sa) und ist die Anzahl, ab der GATE_CALIB_QUANTILE
// (s. u.) die beiden größten Stichproben nicht mehr durchschlagen lässt.
const CALIBRATION_SAMPLES = 20;
// Schwelle = P99-Tagesdelta × 2 (Ledger-Anhalt „P99-Tagesdelta × 2").
const THRESHOLD_MULTIPLIER = 2;
// Welche Stichprobe als „repräsentatives Tagesdelta" in die Schwelle eingeht. WAR: das
// MAXIMUM der Stichproben. Genau daran sind die vier zu lockeren Schwellen entstanden —
// ein einziger Bruchtag im Kalibrierfenster hat die Schwelle für alle Zukunft gesetzt
// (it-services: fünf Nullen und eine 20,1 → 40,2). Ein Quantil statt des Maximums heilt
// das automatisch, sobald genug Stichproben da sind — also keine zweite Regel, kein Zweig.
// Nearest-rank heißt idx = ceil(0,9·n)−1: bis n=9 ist das Quantil GENAU das Maximum, ab
// n=10 fällt die größte Stichprobe heraus, ab n=20 die beiden größten. Eingefroren wird
// erst bei n ≥ CALIBRATION_SAMPLES = 20, das Maximum kann eine Schwelle also nie mehr
// allein setzen.
const GATE_CALIB_QUANTILE = 0.9;
// GEMESSENER Boden unter der wirksamen Wert-Gate-Grenze — pro Tag Abstand.
//
// WAR 1.0, hergeleitet als „1 % der 0–100-Skala" — eine gesetzte Zahl, keine Messung, und
// damit zu tief: die normale Tagesbewegung des Universums liegt heute darüber.
//
// Herleitung der 11.5 (nachrechenbar, board-history/_gate-calibration.json → _boden_herleitung):
// Es gibt auf dem HEUTIGEN Maßstab genau zwei Messungen der Tagesbewegung — die beiden
// Läufe, deren Vintages das Gate verworfen hat:
//   Lauf 30516194703 (2026-07-30 gegen 2026-07-29, 1 Tag):  0,40 … 5,30 je Board
//   Lauf 30752200575 (2026-08-02 gegen 2026-07-29, 4 Tage): 1,70 … 22,90 → pro Tag 0,43 … 5,73
// Größte gemessene Tagesbewegung = 5,73 (utilities, in beiden Läufen das lauteste Board:
// 5,30 bzw. 5,73/Tag — also sein Niveau, kein Ausreißertag). × THRESHOLD_MULTIPLIER = 11,46,
// aufgerundet 11,5.
//
// Der Boden gilt für JEDES Board ohne eigene eingefrorene Schwelle. Das ist die Umkehr der
// R3-Regel „ohne Bewegung keine Schwelle", und sie ist begründet: jene Regel wehrte einen
// ERFUNDENEN Boden ab (1.0 stand für kein einziges Messergebnis). Dieser Boden ist an 26
// echten Tagesbewegungen gemessen, die JEDES Board abdecken. Ohne ihn hätte die
// Neukalibrierung — die alle Boards auf „noch nicht kalibriert" zurücksetzt — die Wert-Achse
// für ~20 Läufe komplett abgeschaltet.
//
// PRÄZISIERUNG (Codex-Gegenprüfung 04.08.2026 — die vorherige Fassung hier behauptete, dieser
// Boden mache survival „ab jetzt" wertgeprüft; das ist zu ungenau). evaluateGate() läuft für
// survival GENAUSO wie für jedes andere Board (buildBoardVintage friert es als Single-Track
// 'flat' ein, s. Kommentar dort, und run() ruft evaluateGate() dafür unverändert auf) — die
// STRUKTUR-Prüfungen (cohort-empty, cohort-overlap-collapse, coverage-collapse) greifen also
// genauso. Der WERT-BODEN hier (MIN_GATE_THRESHOLD als Ersatz für eine fehlende eingefrorene
// Schwelle) kann survival dagegen strukturell NIE beurteilen: survival-Zeilen tragen nie einen
// Score (s. „survival-Zeilen sind nie gescort" in buildTrack unten), evaluateGate() sammelt
// Tages-Deltas aber nur aus Zeilenpaaren mit BEIDSEITIG finitem score — die deltas-Liste bleibt
// für survival also immer leer, p99Delta ist immer null, und „p99-delta-exceeds-threshold" kann
// nie feuern. Ohne je ein Sample zu liefern, friert für survival auch nie eine board-eigene
// Schwelle ein (tagesSample bleibt null) — das Board steht im Lauf-Protokoll dauerhaft als
// „calibrating" mit p99Δ=—, mit oder ohne diesen Boden. Der Boden ändert an survivals
// Wert-Prüfbarkeit also NICHTS; er wirkt ausschließlich auf die score-tragenden Boards.
//
// ER IST EIN KALIBRIER-ERSATZ, KEINE DAUER-UNTERGRENZE (Review 03.08.2026). Bis dahin wurde
// er auch auf jede board-eigene, eingefrorene Schwelle gelegt. Damit hätte ein RUHIGES Board
// nie darunter fallen können: it-services misst ein Tagesrauschen von ~2 Punkten, seine
// eigene Schwelle wäre 2 × 2 = 4 — ein Wertfehler von 5 Punkten wäre dort auf ewig unsichtbar
// geblieben, weil 11,5 (aus dem LAUTESTEN Board utilities abgeleitet) darüber lag. Sobald ein
// Board 20 eigene Stichproben hat, zählt nur noch sein eigenes Maß. Das macht das Gate
// schärfer, nicht laxer, und hält die Kalibrierung echt.
const MIN_GATE_THRESHOLD = 11.5;
// Maximaler Vintage-Abstand, über den die Wert-Achse noch urteilt (Kalendertage).
// Darüber wird NICHT gesperrt, sondern laut abgestanden (gate.abstandZuGross + ::warning::).
// Grund ist die Selbstverstärkung, die den Betrieb seit dem 30.07. blockiert hat: ein
// verworfenes Vintage vergrößert den Abstand des nächsten Vergleichs, der dadurch mehr
// Bewegung sieht und noch sicherer verworfen wird. Ein Deckel, der bei Überschreitung
// SPERRT, wäre genau diese Falle mit einer Stufe mehr. Also: über einer Woche gibt es
// keinen Tages-Maßstab mehr — dann ist „nicht geprüft" die ehrliche Antwort, nicht
// „verdächtig". Die übrigen Integritätsprüfungen (NaN-Einbruch, Coverage-Absturz,
// Kohorten-Überlappung) laufen unverändert weiter. 7 Kalendertage = eine volle Woche;
// derselbe Anhalt wie REGIME_MAX_STALE_DAYS weiter unten (Lauf Di–Sa, größte planmäßige
// Lücke Sa→Di = 3 Tage, plus Feiertags-/Ausfallpuffer).
const GATE_MAX_ABSTAND_TAGE = 7;
const P99 = 0.99;
// Coverage-Absturz: fällt der present-Anteil eines Kontroll-Felds gegenüber dem
// Vortag um mehr als das → suspect. Heuristik-Decke (kein Ledger-Wert); 0.25 = ein
// Viertel der Kohorte verliert ein Kontroll-Feld über Nacht = unplausibel.
// ponytail: fixe Decke; datengetrieben nachziehen, falls Coverage real ruckelt.
const COVERAGE_COLLAPSE_DROP = 0.25;
// BH-111: Überlappungs-Boden gegen den Vortag. NaN/Coverage/P99-Delta wurden vorher
// NUR auf der Schnittmenge nowMap∩priorMap gebildet — verschwinden 50–90 % der
// Boardzeilen (Audit-Beleg), sieht die verbleibende Schnittmenge trotzdem "sauber"
// aus. Der Boden liegt an der unteren Kante des beobachteten Bruchbereichs (schon
// 50 % Verlust ist Bruch, nicht erst 90 %).
const MIN_COHORT_OVERLAP = 0.5;
// Maßstab-Bruch: Skala, auf der die Scores laufen (dieselbe 0–100-Skala, auf die sich
// schon MIN_GATE_THRESHOLD beruft, s. o.). Sie übersetzt einen KOHORTEN-Anteil in
// Score-Punkte: fällt der Anteil x der Kohorte weg, kann sich ein kohorten-relatives
// Rang-Perzentil um bis zu x der Skala verschieben. Obere Heuristik, kein Beweis — und
// sie wirkt nur nach UNTEN begrenzend (min gegen den Deckel), nie aufweitend.
const SCORE_SKALA = 100;
// A12: Kompaktierung frühestens nach t0+2Q ≈ 180 Kalendertage (NICHT 84 — §4b/§7-Kopplung).
const RETENTION_DAYS = 180;
const MS_PER_DAY = 86400000;
// F7: Der Regime-Fallback (jüngster Key <= Datum) darf nicht unbegrenzt zurückgreifen —
// ein Wochen-altes Regime als „heute" auszugeben wäre eine stille Lüge. SPY handelt
// ~5 Tage/Woche; die größte normale Lücke (Fr→Mo, plus Feiertag, oder ein Lauf vor
// US-Handelsschluss über ein langes Wochenende) ist ~3–4 Kalendertage. 7 deckt Wochenende
// + Feiertagscluster ab und schlägt erst an, wenn der Macro-Feed wirklich steht — dann ist
// 'unknown' die ehrliche Antwort, kein geerbtes Alt-Label. Kalendertage (kein Ledger-Wert).
const REGIME_MAX_STALE_DAYS = 7;

// ── kleine Helfer ────────────────────────────────────────────────────────────
function isoDay(d) { return new Date(d).toISOString().slice(0, 10); }

// Kalendertage zwischen dem Vorgänger-Vintage und diesem. Die Wert-Achse misst eine
// TAGESbewegung; vergleicht sie in Wahrheit über mehrere Tage, muss die Grenze mitwachsen.
// Belegt an den beiden Läufen mit demselben Vorgänger (2026-07-29): über 1 Tag lagen die
// Board-Bewegungen bei 0,40–5,30, über 4 Tage bei 1,70–22,90 — pro Tag also auf demselben
// Niveau (Median-Verhältnis 0,8 nach Normierung). Deshalb linear in den Tagen, nicht
// wurzelförmig: die Wurzel (Faktor 2,0 statt 4,0) hätte den 4-Tages-Lauf weiter verworfen.
// Ohne verwertbare Daten (Test-Gerippe ohne date, kein Vorgänger) konservativ 1 Tag.
function tagesabstand(vintage, priorVintage) {
  const neu = vintage && vintage.date;
  const alt = priorVintage && priorVintage.date;
  if (typeof neu !== 'string' || typeof alt !== 'string') return 1;
  const tage = Math.round((Date.parse(neu + 'T00:00:00Z') - Date.parse(alt + 'T00:00:00Z')) / MS_PER_DAY);
  return Number.isFinite(tage) && tage >= 1 ? tage : 1;
}

// BH-147: --date wurde bisher jeder String verbatim übernommen und direkt in
// path.join(HISTORY_DIR, date) verwendet — weder Format- noch Zukunfts- noch
// Pfadprüfung. Das Format-Regex schließt einen Pfad-Escape ('../foo') strukturell
// aus (kann nie auf YYYY-MM-DD passen); der resolved-path-Guard in run() ist
// zusätzliche Absicherung an der Schreib-Grenze.
function isValidDateStr(d) { return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d); }

// BH-147: reine Entscheidungsfunktion (hermetisch testbar ohne CLI-Subprozess).
// Ein --date, das vom heutigen Tag abweicht, ist im Live-Betrieb (daily-pull.yml
// läuft OHNE --date) immer manueller Operator-Eingriff — Audit-Risiko "manueller
// Operator-Fehlgebrauch der committeten PIT-Messreihe". --allow-backfill ist der
// explizite Vertrag dafür; --dry-run schreibt nichts und braucht keinen Vertrag.
// Gilt NUR an der CLI-Grenze (require.main===module) — run()/Tests rufen die
// interne API direkt und bewusst mit beliebigem --date auf (Backfill-Fixtures,
// L4-Hermetik), das ist kein Operator-Fehlgebrauch.
function requiresBackfillContract(date, allowBackfill, dryRun) {
  return !!date && date !== isoDay(Date.now()) && !allowBackfill && !dryRun;
}

function assertNoPicksHistory(p) {
  // audit/fix: GG-Schutzliste — kein Ausgabepfad darf je picks-history berühren.
  if (/(^|[\\/])picks-history([\\/]|$)/i.test(p)) {
    throw new Error('write-board-history: refusing to touch picks-history path: ' + p);
  }
  return p;
}

function readJsonOrNull(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

/**
 * T155/W3 — Universums-Hash des Laufs lesen (Träger: scripts/write-excluded-list.js).
 *
 * BEWUSST NICHT readJsonOrNull: dessen pauschales catch würde "Datei gibt es nicht"
 * (legitim — lokaler Lauf ohne Export-Schritt) und "Datei ist kaputt" (ein Defekt, der
 * still eine Metadaten-Spalte der Messreihe leert) ununterscheidbar machen. Genau diese
 * Klasse stillen Fehlschlags soll die Zahl ja aufdecken.
 *
 * KEIN Wurf: ein fehlendes Metadaten-Feld darf das Vintage nicht verhindern — das
 * Vintage ist die Messreihe, der Hash ist Zubehör. Der Defekt wird laut gemeldet und
 * das Feld bleibt ehrlich null.
 */
// Form, die der Erzeuger garantiert (write-excluded-list.js universumsHash: sha256,
// auf 16 Hex gekürzt). Review-Befund MITTEL (28.08.): "irgendein nicht-leerer String"
// nähme auch einen abgeschnittenen, verrutschten oder aus einem anderen Feld kopierten
// Wert widerspruchslos an — und eine falsche Zahl, die richtig aussieht, ist in dieser
// Messreihe der teuerste Ausgang.
const UNIVERSE_HASH_FORM = /^[0-9a-f]{16}$/;

function readUniverseHash(file) {
  // ::warning:: über console.log, wie an jeder anderen Stelle dieser Datei (968, 1268,
  // 1285, 1301) — nicht über console.warn: ein späterer Schritt, der nur stdout mitschneidet,
  // verschluckte sonst genau diese drei Meldungen.
  const meldung = (text) => console.log('::warning::write-board-history: ' + text
    + ' — Vintage wird ohne universeHash geschrieben.');
  let roh;
  try {
    roh = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') { meldung('Universums-Hash nicht lesbar (' + file + '): ' + e.message); return null; }
    // FEHLT: lokal legitim (kein Export-Schritt gelaufen), in der CI NICHT — dort läuft
    // write-excluded-list.js im selben Job vor diesem Schritt. Ein fehlender Träger in der
    // CI heißt, dass die Übergabe gebrochen ist; ohne diese Unterscheidung trüge JEDES
    // künftige Vintage still null, und niemand sähe es. GITHUB_SHA als CI-Merkmal ist
    // dieselbe Quelle, die formulaCommit oben schon benutzt.
    if (process.env.GITHUB_SHA) meldung('Universums-Hash-Träger fehlt (' + file + '), obwohl dieser Lauf in der CI '
      + 'läuft — dort schreibt ihn write-excluded-list.js im selben Job. Die Übergabe ist gebrochen');
    return null;
  }
  let geparst;
  try {
    geparst = JSON.parse(roh);
  } catch (e) {
    meldung('Universums-Hash-Datei ist kein gültiges JSON (' + file + '): ' + e.message);
    return null;
  }
  const h = geparst && typeof geparst === 'object' ? geparst.universeHash : undefined;
  if (typeof h === 'string' && UNIVERSE_HASH_FORM.test(h)) return h;
  meldung('Universums-Hash-Datei ohne brauchbares Feld universeHash (' + file + ', erwartet 16 Hex-Zeichen, '
    + 'gelesen ' + JSON.stringify(h) + ')');
  return null;
}

// AX-SK-001 (Hard Review 2026-07-31): readJsonOrNull() is intentionally lenient for
// most callers here (excludedDates(), per-ticker readSnapshot(), prior-vintage board
// reads) — those read thousands of files per run and a single missing/corrupt one
// must not crash the whole write, documented explicitly at excludedDates(). The TWO
// GOVERNANCE state files below are different: "file missing" legitimately means
// "scaffold a fresh empty structure" (readOrScaffoldExcluded) or "start calibration
// from scratch" (gate-calibration) — but readJsonOrNull() made "file exists but is
// corrupt/unreadable" look IDENTICAL to "missing", so a truncated write or a bad
// permission silently replaced hand-curated exclusions or reset frozen gate
// thresholds instead of failing loud. Distinguish ENOENT (genuinely absent, safe to
// scaffold) from every other failure (refuse — never silently treat as absent).
function readJsonExistingOrThrow(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return null; // legitimately absent — scaffold/reset is safe
    throw new Error('write-board-history: ' + file + ' exists but is unreadable (' + e.message
      + ') — refusing to silently scaffold over it.');
  }
  try { return JSON.parse(raw); }
  catch (e) {
    throw new Error('write-board-history: ' + file + ' exists but contains invalid JSON (' + e.message
      + ') — refusing to silently scaffold over it. Fix it, restore from git history, or delete it explicitly if it should truly be reset.');
  }
}

// Die EINE Wahrheit darüber, ob ein Board eine gültige, eingefrorene Gate-Schwelle hat.
// Beide Wege gehen hier durch (Auswerten in evaluateGate, Weiter-Sammeln in
// updateGateCalibration), damit „eingefroren" nie zwei Bedeutungen bekommt.
//
// DEGENERIERT = frozen:true mit threshold <= 0 (live: energy und it-services, je 3× Delta 0).
// Eine 0-Schwelle stammt aus keinem einzigen echten Messwert — das Board hat sich im ganzen
// Kalibrierfenster nicht bewegt. Solche Boards gelten hier als NICHT eingefroren und sammeln
// weiter, bis echte Bewegung da war. Bewusst als Laufzeit-Heilung statt Datei-Migration:
// board-history/_gate-calibration.json ist eine Datendatei mit echten Messwerten, die
// dailyP99Samples bleiben unangetastet roh; threshold/frozen sind daraus ABGELEITETE Felder
// und werden beim nächsten Schreiben ohnehin neu berechnet (dann auch in der Datei geheilt).
//
// OHNE BODEN (Review 03.08.2026): MIN_GATE_THRESHOLD ist der Kalibrier-ERSATZ, keine
// Dauer-Untergrenze — Begründung an der Konstante selbst.
function frozenThresholdOf(gateState) {
  if (!gateState || !gateState.frozen) return null;
  const t = gateState.threshold;
  return Number.isFinite(t) && t > 0 ? t : null;
}

// P-Quantil einer Zahlenliste (nearest-rank, konservativ aufgerundet).
function quantile(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const idx = Math.min(v.length - 1, Math.ceil(p * v.length) - 1);
  return v[Math.max(0, idx)];
}

// ── §7 PIT-Extraktion aus einem Snapshot (A9-Join) ───────────────────────────
function readSnapshot(ticker) {
  const fp = path.join(P.SNAP_DIR, safeSnapshotFilename(ticker));
  return readJsonOrNull(fp);
}

// 6.2-E2 (Earnings-Blowout): Report-Datum je Ticker aus earnings-calendar.json. Einmal je
// Lauf gelesen (585 KB Datei, ~9 000 Board-Zeilen — je Zeile neu parsen waere der Lauf-Killer);
// _setPaths setzt den Cache zurueck, damit Tests mit eigenem baseDir nie den Repo-Kalender
// sehen. Fehlt die Datei, bleibt der Cache ein leeres Objekt: das ist eine Datenluecke
// (pitGaps), kein Grund, den Tageslauf anzuhalten.
let _earningsCache = null;
function earningsEntryFor(ticker) {
  if (_earningsCache === null) {
    const raw = readJsonOrNull(P.EARNINGS_CAL_FILE);
    _earningsCache = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  }
  const e = ticker ? _earningsCache[ticker] : null;
  return (e && typeof e === 'object' && typeof e.date === 'string') ? e : null;
}

// Preis/Bruttogewinn = MarketCap/GrossProfit = priceSales / grossMargin.
// (grossMargin ist in %.) Nenner ≤0/undefiniert → null (LOSS-/GM0-Firmen, §4a-NaN-Linie).
function priceGrossProfit(metrics) {
  const ps = metrics && metrics.priceSales && metrics.priceSales.value;
  const gm = metrics && metrics.grossMargin && metrics.grossMargin.value;
  if (!Number.isFinite(ps) || !Number.isFinite(gm) || gm <= 0) return null;
  return ps / (gm / 100);
}

function seriesValues(arr) {
  if (!Array.isArray(arr)) return null;
  // revenueQ/grossProfitQ sind [{value}] (pull-yahoo-Serialisierung).
  return arr.map((x) => (x && typeof x === 'object' && 'value' in x ? x.value : x));
}

// Baut den §7-PIT-Block je Board-Zeile. Fehlende Kontroll-Felder EXPLIZIT null
// (Missing-Beta-Regel), fehlende Perioden-Enden → null + pitGaps-Vermerk.
function buildPit(snap, pitGaps, ticker) {
  if (!snap) { pitGaps.add('snapshot-missing'); return null; }
  const m = snap.metrics || {};
  const ts = snap.timeseries || {};
  const meta = snap.meta || {};
  const val = (o) => (o && Number.isFinite(o.value) ? o.value : null);
  // bh-null-ends (T2, Karl-Semantik freigegeben): present = das Array traegt MINDESTENS
  // EIN gueltiges (nicht-null) Perioden-Ende. Ein FTS-Cache-Treffer vor A10 liefert []
  // (leer) oder [null,null,null] (Serie ohne echtes Datum) — beides ist truthy != null
  // und wurde vorher faelschlich als "vorhanden" gezaehlt (weder pitGaps-Vermerk noch
  // Coverage-Verlust). Normalisierung an EINER Stelle heilt pitGaps UND pitCoverageBlock
  // gleichzeitig, da beide von revEnds/gpEnds lesen.
  const validEnds = (a) => (Array.isArray(a) && a.some((x) => x != null)) ? a : null;
  // Waehrungs-Waechter fuer die MISCH-Verhaeltnisse (Review-Fix 16.08.).
  // evSales (metrics.enterpriseToRevenue) und priceSales sind Yahoo-Verhaeltnisse mit dem
  // Zaehler in der HANDELS- und dem Nenner in der BERICHTS-Waehrung. Fallen die beiden
  // auseinander, ist der Wert um genau Handelsfaktor/Berichtsfaktor verzerrt — bei BREN.JK
  // war das der Faktor 17 831 (evSales 766 149 statt ~43). pull-yahoo korrigiert das seit
  // Waehrungs-Chunk 3 und vermerkt es als meta.mischVerhaeltnisFaktor; ein Snapshot OHNE
  // diesen Vermerk hat die Korrektur nachweislich nicht gesehen. Anders als beim Board ist
  // das hier nicht nur Anzeige: board-history ist die DAUERHAFTE Vintage-Historie, aus der
  // rank-ic.js und lib/e1-compression.js rechnen — ein falscher Wert bleibt dort fuer immer.
  // Genullt wird nur bei SICHTBARER Divergenz ohne Vermerk (am eingefrorenen Bestand 501 von
  // 2 800 Zeilen mit evSales); wo Handel und Bericht uebereinstimmen oder die Waehrungen
  // unbekannt sind, bleibt alles wie bisher — der Wert ist dann nicht verzerrt.
  const rcPit = meta.reportingCurrencyOriginal || meta.reportingCurrency;
  const tcPit = meta.tradingCurrencyOriginal || meta.tradingCurrency;
  const mischVerzerrt = !!rcPit && !!tcPit
    && String(rcPit).toUpperCase() !== String(tcPit).toUpperCase()
    && !Number.isFinite(meta.mischVerhaeltnisFaktor);
  if (mischVerzerrt) pitGaps.add('mischverhaeltnis-unkorrigiert');
  const mischVal = (o) => (mischVerzerrt ? null : val(o));
  const revEnds = validEnds(ts.revenueQEnds);
  const gpEnds = validEnds(ts.grossProfitQEnds);
  if (revEnds == null) pitGaps.add('revenueQEnds-missing');   // A10: parallel in pull-yahoo
  if (earningsEntryFor(ticker) == null) pitGaps.add('earningsDate-missing');   // 6.2-E2
  if (gpEnds == null) pitGaps.add('grossProfitQEnds-missing');
  return {
    beta: val(m.beta),                       // Markt-Beta (Kontroll-Feld §7)
    evSales: mischVal(m.enterpriseToRevenue), // EV/Sales (§7) — Misch-Verhaeltnis, s. Waechter oben
    priceGrossProfit: priceGrossProfit(m),   // Preis/Bruttogewinn (§7)
    fetchedAt: meta.fetchedAt || meta.asOf || null,
    revenueQ: seriesValues(ts.revenueQ),
    revenueQEnds: revEnds,
    grossProfitQ: seriesValues(ts.grossProfitQ),
    grossProfitQEnds: gpEnds,
    // BH-108: revenueQ/grossProfitQ werden bei JEDEM pull-yahoo-Abruf mit dem dann
    // aktuellen FX-Faktor neu in USD umgerechnet (live belegt: identische Periode
    // driftet über Vintages ohne neue Unternehmensperiode). Ohne Provenienz kann
    // niemand nachträglich zwischen echtem Umsatzdelta und Abruf-FX-Bewegung
    // unterscheiden. pull-yahoo.js schreibt reportingCurrencyOriginal/fxRateApplied
    // bereits (Tag 134/148ff) — hier nur additiv PIT-gefroren, kein neuer Fetch.
    // Konsum (Delivery-IC auf konsistenter FX-Basis) ist Sache von rank-ic.js, nicht
    // dieses Writers.
    reportingCurrencyOriginal: (typeof meta.reportingCurrencyOriginal === 'string' && meta.reportingCurrencyOriginal) || null,
    fxRateApplied: Number.isFinite(meta.fxRateApplied) ? meta.fxRateApplied : null,
    // 6.2-E1 Option B (Court 2026-07-17, PASS_MIT_AUFLAGEN, Auflage 4): echtes Price/Sales
    // MIT eigener Bewertungs-asOf ab heute additiv in die committete Historie schreiben —
    // startet die 12-Monats-Eigenhistorie-Uhr. Rein additiv (kein neuer Fetch: metrics.priceSales
    // wird bereits Z. priceGrossProfit() gelesen); ans Ende gehängt, damit alle Bestandsfelder
    // (evSales …) byte-identisch bleiben. priceSalesAsOf ist der WAHRE Bewertungs-Zeitstempel
    // (kann Wochen VOR meta.fetchedAt liegen — genau der KILL-4-Widerspruch); E1s Freshness-Gate
    // keyed hierauf, NIE auf fetchedAt.
    priceSales: mischVal(m.priceSales),
    priceSalesAsOf: (m.priceSales && m.priceSales.asOf) || null,
    // audit/fix (Hard-Review R4-SCR-02): screener-formel-ledger.md §4a fixiert die Regressor-Liste
    // 'Size (log-MarketCap), Markt-Beta, 1-2 Bewertungs-Proxys' -- buildPit() lieferte beta/evSales/
    // priceGrossProfit, aber KEIN marketCap-Feld, obwohl rank-ic.js Size als Kontroll-Regressor
    // braucht. Rein additiv am ENDE (wie priceSales/priceSalesAsOf, E1 Option B): kein neuer Fetch
    // (snap.marketCap liegt bereits am Snapshot, wie score.js mcapOf() es liest), Bestandsfelder
    // bleiben byte-identisch positioniert.
    marketCap: val(snap.marketCap),
    // 6.2-E2 (Earnings-Blowout), analog E1 Option B: das Report-Datum PIT einfrieren.
    // WARUM HIER UND NICHT ERST IM MELDEWEG: earnings-calendar.json ist eine LEBENDE Datei —
    // sie kennt nur den heutigen Stand. Wer sie beim Auswerten eines alten Vintages liest,
    // datiert einen Report mit Wissen von spaeter (derselbe Anachronismus, den E1s
    // priceSalesAsOf verhindert). Rein additiv, kein neuer Abruf: die Datei liegt committet
    // im Repo. earningsDateAsOf = wann WIR das Datum gezogen haben (pulledAt), nicht der
    // Report selbst — dieselbe Trennung wie priceSales/priceSalesAsOf.
    earningsDate: (earningsEntryFor(ticker) || {}).date || null,
    earningsDateAsOf: (earningsEntryFor(ticker) || {}).pulledAt || null,
  };
}

// BH-109: juengstes Ende einer Enden-Serie als ms-Timestamp (oder null). Serien
// sind [ISO-Datum|null, ...] — Reihenfolge nicht vorausgesetzt, es zaehlt das Max.
function latestEndMs(ends) {
  if (!Array.isArray(ends)) return null;
  let latest = null;
  for (const e of ends) {
    if (typeof e !== 'string') continue;
    const t = Date.parse(e + 'T00:00:00Z');
    if (Number.isFinite(t) && (latest == null || t > latest)) latest = t;
  }
  return latest;
}

// pitCoverage: Anteil present je Kontroll-Feld über die Kohorte (A9-Attenuations-Ausweis).
function pitCoverageBlock(rows, date) {
  const fields = ['beta', 'evSales', 'priceGrossProfit', 'revenueQEnds', 'grossProfitQEnds'];
  const cov = {};
  const n = rows.length || 1;
  for (const f of fields) {
    let present = 0;
    for (const r of rows) if (r.pit && r.pit[f] != null) present++;
    cov[f] = present / n;
  }
  // BH-109: "present" oben zaehlt jedes Enden-Array mit MINDESTENS einem gueltigen
  // Datum, auch wenn das juengste Ende Jahre alt ist (Audit-Beleg 18.07.2026: 26/205
  // present-Zeilen mit juengstem Ende >1 Jahr alt — u. a. MKS.L 2023-03-31, SBRY.L
  // 2011-06-30). Additive Fresh-Metrik: nur Zeilen, deren juengstes Ende innerhalb
  // RETENTION_DAYS (~2Q, dieselbe A12-Konstante) vor dem Vintage-Datum liegt, gelten
  // als fuer den +2Q-Delivery-Vergleich tatsaechlich nutzbar. Bestehende *Ends-Felder
  // bleiben unveraendert (Bestandsleser/Tests).
  if (date) {
    const vintageMs = Date.parse(date + 'T00:00:00Z');
    if (Number.isFinite(vintageMs)) {
      for (const f of ['revenueQEnds', 'grossProfitQEnds']) {
        let fresh = 0;
        for (const r of rows) {
          const latest = latestEndMs(r.pit && r.pit[f]);
          if (latest != null && (vintageMs - latest) <= RETENTION_DAYS * MS_PER_DAY) fresh++;
        }
        cov[f + 'Fresh'] = fresh / n;
      }
    }
  }
  return cov;
}

// ── Vintage-Aufbau für EIN Board ─────────────────────────────────────────────
function buildBoardVintage(board, boardData, date, calibMeta, universeHash = null) {
  const pitGaps = new Set();
  const buildTrack = (arr, track) => (Array.isArray(arr) ? arr : []).map((row, i) => ({
    rank: i + 1,                    // Board-Rang (Zeilenreihenfolge = sortierte Kohorte)
    ticker: row.ticker,
    track,
    // KEIN Skalen-Deckel hier — und das ist die wichtigste Zeile dieser Datei (19.08.2026).
    //
    // Der erste Entwurf deckelte hier ebenfalls auf 100. Der Waechter (f3) in
    // tests/board-history.test.js wurde daraufhin ROT und legte den Grund offen: er stellt
    // einen echten Wertbruch nach (Score springt 92 -> 132) und erwartet, dass das Wert-Gate
    // anschlaegt. Gedeckelt wurde aus dem Sprung von +40 ein Sprung von +8 — unter der
    // Alarmschwelle. Der Deckel haette das Sicherheitsnetz stillgelegt.
    //
    // board-history ist die MESSREIHE, auf der das Wert-Gate rechnet: hier steht der echte
    // Wert. Gedeckelt wird ausschliesslich die ANZEIGE (scripts/write-findash-export.js) —
    // Karl sieht 100, gemessen wird 101. Wer das je zusammenlegt, blendet das Gate.
    score: row.score != null ? row.score : null, // survival-Zeilen sind nie gescort → null statt key-drop
    runwayQuarters: row.runwayQuarters != null ? row.runwayQuarters : null, // survival-Sortier-Substanz
    scoreBase: row.scoreBase != null ? row.scoreBase : null,
    scoreShrunk: row.scoreShrunk != null ? row.scoreShrunk : null,
    coverageAxes: row.coverageAxes != null ? row.coverageAxes : null,
    axisBreakdown: Array.isArray(row.axisBreakdown) ? row.axisBreakdown : null,
    lamps: Array.isArray(row.lamps) ? row.lamps : null,
    pit: buildPit(readSnapshot(row.ticker), pitGaps, row.ticker),  // §7-PIT-Freeze (A9-Join)
  }));
  // audit/fix: survival.json ist eine FLACHE Liste (nie gescort, keine Tracks) — als
  // Single-Track 'flat' einfrieren statt still leere profitable/unprofitable zu schreiben.
  const isFlat = Array.isArray(boardData);
  const profitable = isFlat ? buildTrack(boardData, 'flat') : buildTrack(boardData.profitable, 'profitable');
  const unprofitable = isFlat ? [] : buildTrack(boardData.unprofitable, 'unprofitable');
  const allRows = profitable.concat(unprofitable);
  return {
    date,
    board,
    boardStatus: boardStatus(board),           // core|diagnostic (src/scoring/board-status.js)
    formulaVersion: calibMeta.formulaVersion,  // Proxy: calibration.schema (siehe Kopf-Doku)
    // BH-105: formulaVersion haengt an calibration.schema und blieb ueber mehrfache
    // Scoring-Aenderungen (Tags 323, 334-340) konstant "calibration/v4" — kein
    // unveraenderlicher Formel-Marker. GITHUB_SHA ist der commit, der die Vintage-
    // Zeile TATSAECHLICH erzeugt hat; in der CI (daily-pull.yml, der einzige Ort,
    // der committete Messreihen erzeugt) automatisch gesetzt. Additiv, formulaVersion
    // bleibt fuer Bestandsleser unveraendert.
    // ponytail: kein git-rev-parse-Fallback fuer lokale Ad-hoc-Laeufe — die reale
    // Messreihe entsteht ausschliesslich in CI. Fallback nachziehen, falls lokale
    // Vintages je in rank-ic einfliessen sollen.
    formulaCommit: process.env.GITHUB_SHA || null,
    // T155/W3 (Rat vom 25.08.): Prüfsumme über die Menge der bewerteten Ticker DIESES
    // Laufs. Erst damit ist die Herkunft einer Score-Verschiebung ein Zeichenketten-
    // Vergleich statt einer Vermutung: gleicher Hash + andere Scores = Datenänderung,
    // anderer Hash = Kohortenwechsel. Das Produkt normiert kohorten-relativ; ohne diese
    // Zahl war die Kohortenwirkung von der Datenwirkung nicht trennbar (B1/B2).
    // Berechnet wird er genau EINMAL pro Lauf, in scripts/write-excluded-list.js (dort
    // liegt das Universum ohnehin geladen); hier wird er nur mitgeschrieben. Zwei
    // Rechenstellen würden driften, ein zweiter Scan über ~15.000 Snapshots wäre
    // derselbe Wert zum doppelten Preis.
    // null ist ein gültiger, ehrlicher Wert (lokaler Ad-hoc-Lauf ohne Export-Schritt).
    universeHash,
    calibrationGeneratedAt: calibMeta.generatedAt,
    cohortCount: { profitable: profitable.length, unprofitable: unprofitable.length },
    pitCoverage: pitCoverageBlock(allRows, date),
    pitGaps: Array.from(pitGaps).sort(),
    // gate wird nach der Gate-Auswertung befüllt (calibrating/threshold/suspect/...)
    gate: null,
    cohort: { profitable, unprofitable },
  };
}

// ── Wert-Plausibilitäts-Gate ─────────────────────────────────────────────────
// Vergleicht das neue Board-Vintage gegen das Vortags-Vintage. Liefert
// { calibrating, p99Delta, threshold, suspect, reasons }.
function evaluateGate(vintage, priorVintage, gateState, bruch, board) {
  const reasons = [];
  const rowsByTicker = (v) => {
    const m = new Map();
    if (!v) return m;
    for (const t of ['profitable', 'unprofitable']) {
      for (const r of (v.cohort && v.cohort[t]) || []) m.set(r.ticker, r);
    }
    return m;
  };
  const nowMap = rowsByTicker(vintage);
  const priorMap = rowsByTicker(priorVintage);

  // BH-111: absolute Mindestgröße + Überlappungs-Boden GEGEN DIE VOLLEN Ticker-Sets
  // (vor jeder Schnittmengen-Bildung) — NaN/Coverage/P99-Delta unten werden NUR auf
  // nowMap∩priorMap gebildet, sodass ein fast leerer Volloutput trotzdem "sauber"
  // aussehen kann (Audit-Beleg: 50–90 % Boardzeilen-Verlust blieb unauffällig). Ein
  // leeres Board (0 Zeilen) ist unabhängig von jeder Schnittmenge ein Datenbruch.
  if (nowMap.size === 0) reasons.push('cohort-empty');
  if (priorVintage && priorMap.size > 0) {
    let matched = 0;
    for (const tk of nowMap.keys()) if (priorMap.has(tk)) matched++;
    if (matched / priorMap.size < MIN_COHORT_OVERLAP) reasons.push('cohort-overlap-collapse');
  }

  // Harter Integritäts-Check: NaN/null-Score wo vorher ein Wert stand (immer suspect,
  // auch in der Kalibrierphase — kein Threshold-Thema, sondern Datenbruch).
  let nanBreak = false;
  for (const [tk, r] of nowMap) {
    const p = priorMap.get(tk);
    if (p && Number.isFinite(p.score) && !Number.isFinite(r.score)) { nanBreak = true; break; }
  }
  if (nanBreak) reasons.push('nan-break');

  // Coverage-Absturz gegen Vortag (immer suspect).
  if (priorVintage && priorVintage.pitCoverage) {
    for (const f of Object.keys(vintage.pitCoverage)) {
      const drop = (priorVintage.pitCoverage[f] || 0) - vintage.pitCoverage[f];
      if (drop > COVERAGE_COLLAPSE_DROP) { reasons.push('coverage-collapse:' + f); }
    }
  }

  // Tages-Delta der Scores (nur wo Ticker in beiden Vintages vorhanden).
  // SCORE-DEFINITIONS-BRUCH (16.08.2026): ist dieses Board im Register namentlich genannt UND
  // benennt der Eintrag eine erklaerende Lampe, bleiben die Zeilen MIT dieser Lampe aus dem
  // p99 heraus — ihre Bewegung IST die registrierte Definitionsaenderung, nicht der Messfehler,
  // den das Gate sucht. Bewusst kein Zuschlag auf die Schwelle: ein Deckel, der eine Bewegung
  // von ~28 Punkten (2548.TW 78->50) abdeckt, wuerde in derselben Nacht jeden beliebigen echten
  // Wertfehler mit durchlassen. So bleibt die Schwelle fuer ALLE anderen Zeilen unveraendert
  // streng, und was herausgerechnet wird, ist an der Lampe abzaehlbar statt gesetzt.
  const erklaerendeLampe = (bruch && board && bruch.boards.has(board)) ? bruch.erklaerendeLampe : null;
  const traegtLampe = (row) => !!row && Array.isArray(row.lamps) && row.lamps.includes(erklaerendeLampe);
  const deltas = [];
  let erklaerteZeilen = 0;
  for (const [tk, r] of nowMap) {
    const p = priorMap.get(tk);
    if (!(p && Number.isFinite(p.score) && Number.isFinite(r.score))) continue;
    // Vorher ODER nachher: eine Zeile, die die Lampe gerade VERLIERT, bewegt sich aus
    // demselben Grund wie eine, die sie bekommt.
    if (erklaerendeLampe && (traegtLampe(r) || traegtLampe(p))) { erklaerteZeilen++; continue; }
    deltas.push(Math.abs(r.score - p.score));
  }
  const p99Delta = deltas.length ? quantile(deltas, P99) : null;

  // Keine gültige eingefrorene Schwelle (nie kalibriert ODER degeneriert) → Kalibrierphase.
  // Die BOARD-EIGENE Schwelle fehlt dann; geprüft wird trotzdem, nämlich am gemessenen
  // Boden (MIN_GATE_THRESHOLD, Herleitung dort). Nur so ist die Neukalibrierung — die alle
  // Boards auf „noch nicht kalibriert" zurücksetzt — keine Abschaltung der Wert-Achse.
  const threshold = frozenThresholdOf(gateState);
  const calibrating = threshold == null;
  const basisSchwelle = threshold != null ? threshold : MIN_GATE_THRESHOLD;

  // Tagesabstand zum Vorgänger. Über GATE_MAX_ABSTAND_TAGE hinaus gibt es keinen
  // Tages-Maßstab mehr: dann urteilt die Wert-Achse NICHT (kein suspect aus dem Delta),
  // sondern weist den Abstand aus. Alles andere wäre die Selbstverstärkung mit einer
  // Stufe mehr — je länger die Messreihe steht, desto sicherer bliebe sie stehen.
  const gapDays = priorVintage ? tagesabstand(vintage, priorVintage) : 1;
  const abstandZuGross = !!priorVintage && gapDays > GATE_MAX_ABSTAND_TAGE;

  // ── Maßstab-Bruch: erhöhte Tagesgrenze für den EINEN Neu-gegen-Alt-Vergleich ──
  // Ändert sich die Score-DEFINITION (z. B. die Kohorte wird entdoppelt), misst der
  // Vergleich Neu-gegen-Alt zwei verschiedene Maßstäbe. Die eingefrorene Schwelle kann
  // das nicht beurteilen — sie ist auf dem alten Maßstab kalibriert. Ohne Ausnahme
  // bliebe das Folge-Vintage dauerhaft suspect (es landet nie, der Vergleich zeigt
  // morgen wieder auf denselben alten Stand) und die Messreihe stünde still.
  //
  // DREI Bedingungen MÜSSEN zusammenkommen, sonst gilt unverändert die normale Schwelle:
  //   1. der gefundene Vorgänger ist im Register EXAKT als letztes_altes_vintage eines
  //      Bruchs benannt (prüft der Aufrufer über massstabBruchFuer — Begründung dort),
  //   2. dieses Board steht dort NAMENTLICH (Court-Auflage: keine rein dynamische
  //      Auswahl — sonst hebt ein beliebiger unabhängiger Datenfehler, der die Kohorte
  //      schrumpfen lässt, seine eigene Grenze an),
  //   3. die Kohorte ist gegenüber dem Vergleichsstand MESSBAR geschrumpft.
  // Die HÖHE kommt bewusst NICHT aus dem Register (eine von Hand eingetragene Messzahl
  // wäre eine ungeprüfte Selbstauskunft), sondern aus den beiden verglichenen Vintages.
  //
  // Eine VIERTE Bedingung stand hier bis zum 03.08.2026: „es gibt überhaupt eine
  // eingefrorene Schwelle (in der Kalibrierphase wäre jeder Deckel erfunden)". Sie ist
  // gefallen, weil die Neukalibrierung von Tag 513 ALLE Boards auf calibrating gesetzt
  // hat und CALIBRATION_SAMPLES=20 ≈ vier Betriebswochen bedeutet: ein in diesem Fenster
  // registrierter Maßstab-Bruch (historisch ~1×/Monat) hätte auf bruchGrenze=null
  // getroffen und wäre nur am nackten Boden gemessen worden — mehrtägiger Rückfall in
  // genau die Dauersperre, die Tag 513 beheben soll. Erfunden ist der Deckel dabei nicht:
  // basisSchwelle ist in der Kalibrierphase der an 26 echten Tagesbewegungen GEMESSENE
  // Boden (Herleitung an MIN_GATE_THRESHOLD), keine gesetzte Zahl.
  let bruchGrenze = null;
  if (bruch && board && bruch.boards.has(board) && priorMap.size > 0 && nowMap.size < priorMap.size) {
    const schrumpfung = (priorMap.size - nowMap.size) / priorMap.size;
    const strukturgrenze = SCORE_SKALA * schrumpfung;
    const deckel = THRESHOLD_MULTIPLIER * basisSchwelle;
    // max(): die Grenze wird nie STRENGER als die normale Schwelle (sonst erzeugte eine
    // Mini-Schrumpfung Fehlalarme). min(): sie wird nie weiter als das Doppelte —
    // derselbe Multiplikator, mit dem das System aus einer gemessenen Spitze ohnehin
    // eine Schwelle macht.
    const tagesschwelle = Math.max(basisSchwelle, Math.min(strukturgrenze, deckel));
    bruchGrenze = {
      tag: bruch.tag,
      zeilenVorher: priorMap.size,
      zeilenNachher: nowMap.size,
      strukturgrenze,
      deckel,
      normaleSchwelle: basisSchwelle,
      tagesschwelle,
      // Der Zuschlag ÜBER der normalen Schwelle — das, was der Maßstab-Wechsel selbst
      // erklärt. Er wird genau EINMAL gewährt (s. wirksameSchwelle).
      allowance: tagesschwelle - basisSchwelle,
    };
  }
  // Normale Tagesgrenze × Tagesabstand: dieselbe Bewegung ist über vier Tage normal und
  // an einem Tag ein Fund. Ohne diesen Faktor scheitert jede Neukalibrierung am ersten
  // Lauf nach einer Lücke — genau daran ist der Betrieb seit dem 30.07. hängen
  // geblieben (30.07. gegen 29.07. = 1 Tag → 4 Boards suspect; 02.08. gegen denselben
  // 29.07. = 4 Tage → 8 Boards suspect, utilities 22,90 gegen Schwelle 1,20).
  //
  // Die Bruch-Allowance wird dabei NICHT mitskaliert (Review 03.08.2026): eine
  // Definitionsänderung passiert EINMAL für den einen Alt-gegen-Neu-Vergleich, sie
  // akkumuliert nicht pro Kalendertag. Vorher wurde die ganze Bruch-Tagesschwelle mit
  // gapDays multipliziert — bei fünf Tagen Abstand stand die Grenze bei 74,56 statt
  // 60,91 (Fixture-Zahlen aus tests/board-history-massstabbruch.test.js), ein echter
  // Wertfehler dazwischen wäre verschluckt worden. Bei gapDays=1 — dem Normalfall am
  // Bruch-Tag — ist die Zerlegung identisch mit der alten Rechnung.
  const wirksameSchwelle = abstandZuGross
    ? null
    : basisSchwelle * gapDays + (bruchGrenze ? bruchGrenze.allowance : 0);

  if (!abstandZuGross && p99Delta != null && p99Delta > wirksameSchwelle) {
    reasons.push('p99-delta-exceeds-threshold');
  }

  return {
    calibrating, p99Delta, threshold, bruchGrenze,
    gapDays, abstandZuGross, wirksameSchwelle,
    // Sichtbar machen, was herausgerechnet wurde — eine stille Ausnahme waere schlimmer
    // als keine. Ohne registrierten Definitions-Bruch: null / 0.
    erklaerendeLampe: erklaerendeLampe || null, erklaerteZeilen,
    suspect: reasons.length > 0, reasons,
  };
}

// Aktualisiert den Gate-Kalibrierungs-Zustand je Board: sammelt messbare P99-Tagesdeltas
// und friert die Schwelle ein, sobald das Fenster AUSSAGEKRÄFTIG ist.
// Aussagekräftig = genug Samples DA (>= CALIBRATION_SAMPLES) UND mindestens eines > 0.
// Die zweite Bedingung ist der Kern: aus 3× Delta 0 lässt sich keine Schwelle ableiten —
// „das Board hat sich nie bewegt" heißt „noch nicht gemessen", nicht „Schwelle 0".
// Ein solches Fenster sammelt weiter (Gate bleibt im Log-Modus), bis echte Bewegung da war.
function updateGateCalibration(gateCalib, board, p99Delta, date) {
  const b = gateCalib.boards[board] || (gateCalib.boards[board] = { dailyP99Samples: [], sampleDates: [], threshold: null, frozen: false });
  if (frozenThresholdOf(b) != null) return b;   // echt eingefroren → Messreihe ist abgeschlossen
  if (p99Delta != null) {
    // F8: je Vintage-Datum genau EIN Sample. dailyP99Samples[i] gehört zu sampleDates[i]
    // (Map Datum→Sample als zwei index-gleiche Arrays — hält dailyP99Samples ein reines
    // number[], sodass Schwellen-Mathematik, .length und alle Leser unverändert bleiben).
    if (!Array.isArray(b.sampleDates)) b.sampleDates = [];
    // Migration bestehender Roh-Arrays (Live-Stand: energy/it-services tragen [0,0,0] OHNE
    // sampleDates): die N Alt-Samples stammen aus N distinkten VERGANGENEN Tagen, deren
    // Datum die Datei nie festhielt. Distinkte Platzhalter-Keys bewahren die Zählung, ohne
    // einen Kalendertag zu erfinden (kollidieren nie mit einem echten ISO-Datum). Roh-Werte
    // bleiben unangetastet — nichts wird umgeschrieben, nur die fehlenden Datums-Marker ergänzt.
    while (b.sampleDates.length < b.dailyP99Samples.length) b.sampleDates.push('legacy#' + b.sampleDates.length);
    const idx = date != null ? b.sampleDates.indexOf(date) : -1;
    if (idx >= 0) b.dailyP99Samples[idx] = p99Delta;   // Rerun DESSELBEN Vintage-Tags → ersetzen, nicht anhängen
    else { b.dailyP99Samples.push(p99Delta); b.sampleDates.push(date != null ? date : ('nodate#' + b.sampleDates.length)); }
  }
  // Repräsentatives Tagesdelta = GATE_CALIB_QUANTILE der Kalibrier-Stichproben, × 2.
  // WAR: das Maximum. Damit setzte ein einzelner Bruchtag die Schwelle für alle Zukunft
  // (it-services [0,0,0,0,0,20.1] → 40,2 — das Board konnte danach nicht mehr auffallen).
  // nearest-rank (idx = ceil(0,9·n)−1): bis n=9 ist das Quantil exakt das Maximum, ab
  // n=10 fällt die größte Stichprobe heraus, ab n=20 (= CALIBRATION_SAMPLES, dem
  // frühesten Einfrier-Zeitpunkt) die beiden größten.
  const peak = quantile(b.dailyP99Samples, GATE_CALIB_QUANTILE);
  const ready = b.dailyP99Samples.length >= CALIBRATION_SAMPLES && Number.isFinite(peak) && peak > 0;
  // KEIN Boden auf der board-eigenen Schwelle (Review 03.08.2026): der Boden stammt aus
  // dem lautesten Board und würde ein ruhiges Board (it-services, Tagesrauschen ~2) für
  // immer bei 11,5 halten — Wertfehler von 2 bis 11 Punkten blieben dort unsichtbar.
  // Er gilt nur, solange es kein board-eigenes Maß gibt (evaluateGate: basisSchwelle).
  b.threshold = ready ? peak * THRESHOLD_MULTIPLIER : null;
  b.frozen = ready;
  return b;
}

// F-9 Stufe 1 (Rat-gedeckt, REINE MESSUNG — kein Gate-/rc-Einfluss): traegt die
// Tageswerte aus dem Lauf-Protokoll (p99Δ/thr/beta-cov, s. CLI-Ausgabe unten) zusaetzlich
// in die committete Sidecar-Datei ein. AUCH an SUSPECT-Tagen (results traegt jeden Board-
// Eintrag unabhaengig von suspect) — die Sidecar-Commits laufen an Suspect-Tagen ohnehin
// (git add board-history/ + newcomer-log/ + ticker-map/ unabhaengig vom rc, .github/
// workflows/daily-pull.yml "Commit board-history vintage to main"); data-health/ faehrt
// dort im selben unbedingten Zweig mit.
// thr = wirksameSchwelle (exakt die Zahl hinter "thr=" im Lauf-Protokoll, NICHT die roh
// eingefrorene threshold — die ist mit Tagesabstand/Bruch-Allowance bereits multipliziert).
// betaCov = pitCoverage.beta (Anteil 0..1, Log zeigt denselben Wert ×100 gerundet als %).
// Reines Anhaengen je Datum (byDate[date] = ...) — ein Rerun desselben Tages ersetzt den
// Eintrag statt ihn zu duplizieren, fruehere Tage bleiben unberuehrt.
function updateP99DeltaHistory(existing, date, results) {
  const out = existing && typeof existing === 'object' ? existing : {};
  if (typeof out._doc !== 'string') {
    out._doc = 'Taegliche p99Δ/thr/beta-cov-Messreihe je Board (F-9 Stufe 1, Rat-gedeckt, REINE '
      + 'MESSUNG — kein Gate-Verhalten, keine rc-Semantik). thr = wirksameSchwelle des Laufs '
      + '(dieselbe Zahl wie "thr=" im Lauf-Protokoll), betaCov = pitCoverage.beta (Anteil 0..1), '
      + 'suspect = gate.suspect. Wird AUCH an SUSPECT-Tagen geschrieben — die Sidecar-Commits '
      + 'laufen an Suspect-Tagen ohnehin ("chore: nur Sidecars"-Pfad).';
  }
  if (!out.byDate || typeof out.byDate !== 'object') out.byDate = {};
  const day = {};
  for (const b of results) {
    day[b.board] = { p99Delta: b.p99Delta, thr: b.wirksameSchwelle, betaCov: b.pitCoverage.beta, suspect: b.suspect };
  }
  out.byDate[date] = day;
  return out;
}

// ── Exclusion-Gerüst (Writer schreibt nie Einträge, legt nur das Gerüst an) ───
function readOrScaffoldExcluded(dryRun) {
  const existing = readJsonExistingOrThrow(P.EXCLUDED_FILE);
  if (existing) return existing;
  const scaffold = {
    _doc: 'Vintage-Ausschlussliste. Von Hand/Audit gepflegt (Datum + Grund). ' +
      'scripts/rank-ic.js KONSUMIERT diese Liste und schließt gelistete Vintages aus der Auswertung aus. ' +
      'write-board-history.js schreibt hier NIE Einträge (legt nur dieses Gerüst an). Keine Löschung, nur ein Flag.',
    excluded: [],  // z. B. [{ "date": "2026-08-01", "board": "semiconductors", "reason": "..." }]
  };
  if (!dryRun) { fs.mkdirSync(P.HISTORY_DIR, { recursive: true }); writeJsonAtomic(assertNoPicksHistory(P.EXCLUDED_FILE), scaffold); }
  return scaffold;
}

// ── Vorheriges Vintage-Datum finden (jüngstes Datum < target) ────────────────
// Ausgeschlossene Vintages kommen NICHT als Vergleichsbasis in Frage. Das ist keine
// Kosmetik, sondern verhindert einen Dauerzustand: nach dem Maßstab-Bruch von Tag 437/438
// stehen die Vintages bis 2026-07-18 in board-history/_excluded.json. Das Wert-Gate verglich
// das erste neue Vintage gegen den 18.07., meldete erwartungsgemäß ein zu großes Tagesdelta
// (die Beschleunigungs-Achse misst seither etwas anderes) → suspect → rc=2 → der Commit-Schritt
// nimmt genau dieses Vintage vom Commit aus und der Lauf wird rot. Weil das suspect-Vintage
// dadurch NIE in main landet, bleibt der 18.07. auch morgen der jüngste Vorgänger — der Lauf
// wäre ab jetzt JEDEN TAG rot, ohne dass sich etwas ändern kann. Live eingetreten im Lauf
// 30217057400 (26.07.2026).
//
// Karl-Entscheid 10 sagt genau das aus, was hier zu tun ist: über den Bruch hinweg wird nicht
// verglichen. Ein ausgeschlossener Vorgänger zählt deshalb als „kein vergleichbarer Vorgänger"
// — dasselbe, was beim allerersten Vintage gilt. Das Gate straft dann nicht, es sammelt.
function priorVintageDate(date) {
  if (!fs.existsSync(P.HISTORY_DIR)) return null;
  const ausgeschlossen = excludedDates();
  const dates = fs.readdirSync(P.HISTORY_DIR)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < date && !ausgeschlossen.has(d))
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

// Live belegt am 2026-07-29: an diesem Tag standen ALLE Vorgaenger (14.-18.07. wegen
// Tag 437, 26.-28.07. wegen Tag 489) auf der Ausschlussliste. priorDate war null, das
// Wert-Gate hat also NICHTS verglichen — und im geschriebenen Vintage steht dann
// p99Delta: null, suspect: false. Das ist von "geprueft und sauber" nicht zu
// unterscheiden, weder in der Datei noch im Lauf-Protokoll (dort stand nur ein
// beilaeufiges "prior=null" in der Kopfzeile).
//
// Genau dieselbe Luecke, die der Kommentar an der GATE-Kopfzeile im CLI-Teil fuer den
// Bruch-Fall schon benennt: "sonst ist gruen nicht von Gate uebergangen zu
// unterscheiden". Der Fall "gar keine Vergleichsbasis" gehoert in denselben Kanal.
//
// Unterschieden werden muessen zwei Faelle, die beide priorDate=null ergeben:
//   (a) erster Lauf ueberhaupt — es gibt nichts zu vergleichen, voellig in Ordnung
//   (b) es GAB Vorgaenger, sie sind nur alle ausgeschlossen — heute wurde blind
//       geschrieben, und das muss im Protokoll stehen
// Diese Funktion liefert die uebersprungenen Daten; leer heisst Fall (a).
function uebersprungeneVorgaenger(date) {
  if (!fs.existsSync(P.HISTORY_DIR)) return [];
  const ausgeschlossen = excludedDates();
  return fs.readdirSync(P.HISTORY_DIR)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < date && ausgeschlossen.has(d))
    .sort();
}

// Global ausgeschlossene Vintage-Daten aus board-history/_excluded.json. Bewusst nur die
// GLOBALEN Einträge (ohne board-Feld): ein board-enger Ausschluss betrifft die Messreihe
// dieses einen Boards, nicht die Vergleichbarkeit des Tages insgesamt. Defensiv: eine
// fehlende oder unlesbare Datei ergibt eine leere Menge — das Gate verhält sich dann wie
// bisher, statt hier hart abzubrechen.
function excludedDates() {
  const raw = readJsonOrNull(P.EXCLUDED_FILE);
  const out = new Set();
  if (!raw) return out;
  const eintraege = Array.isArray(raw) ? raw : (Array.isArray(raw.excluded) ? raw.excluded : []);
  for (const e of eintraege) {
    if (typeof e === 'string') out.add(e);
    else if (e && typeof e === 'object' && !e.board && typeof e.date === 'string') out.add(e.date);
  }
  return out;
}

// Maßstab-Bruch-Eintrag aus board-history/_excluded.json (_massstab_brueche), gesucht
// über den ERWARTETEN VORGÄNGER — nicht über das Datum des neuen Vintages.
//
// Warum der Vorgänger und nicht der Bruch-Tag: beides wurde durchgespielt, beides bricht.
//   • „gilt am Tag X" (festes Kalenderdatum): landet das Vintage von X aus einem FREMDEN
//     Grund nicht (ein anderes Board wird suspect — der Commit-Schritt nimmt das ganze
//     Tagesverzeichnis raus), ist die Ausnahme verbraucht, ohne je gewirkt zu haben. Am
//     Folgetag zeigt der Vergleich wieder auf denselben alten Stand → dieselbe Dauersperre.
//   • „gilt, solange der Vorgänger älter als X ist": dann aktiviert auch eine DATENLÜCKE
//     die erhöhte Grenze — fehlt der 27.07. und liegt nur der 26.07. vor, ginge eine über
//     mehrere Tage kumulierte Bewegung unbeanstandet durch.
// Der exakte Vorgänger löst beides: er greift genau dann, wenn wirklich Neu-gegen-Alt
// verglichen wird, überlebt einen ausgefallenen Lauf, endet von selbst, sobald ein Vintage
// im neuen Maßstab gelandet ist (dann ist der Vorgänger ein anderer), und eine unerwartete
// Vergleichsbasis fällt auf die strengere normale Schwelle zurück.
//
// Ein Eintrag trägt NUR Daten und eine Board-NAMENSLISTE — bewusst keine Größenangabe:
// die Höhe der Tagesgrenze rechnet evaluateGate selbst aus den verglichenen Vintages,
// damit es nichts gibt, dessen Vertippen die Grenze aufblähen könnte.
// Fail-closed in jeder Richtung: fehlende/unlesbare Datei, kein Eintrag, anderer
// Vorgänger, kein Vorgänger oder eine leere Board-Liste ergeben null.
// Zwei Einträge mit demselben letztes_altes_vintage sind mehrdeutig (welche Board-Liste
// gilt?) und brechen HART ab, statt still zu mergen — der Fall entsteht real beim
// Nachtragen eines späteren Bruchs ohne Blick auf den vorherigen.
function massstabBruchFuer(priorDate) {
  if (!priorDate) return null;
  const raw = readJsonOrNull(P.EXCLUDED_FILE);
  if (!raw || !Array.isArray(raw._massstab_brueche)) return null;
  const treffer = raw._massstab_brueche.filter((b) => b && b.letztes_altes_vintage === priorDate);
  if (treffer.length > 1) {
    throw new Error('write-board-history: ' + treffer.length + ' Massstab-Brueche nennen dasselbe '
      + 'letztes_altes_vintage ' + priorDate + ' — mehrdeutig. Register bereinigen (kein stiller Merge).');
  }
  if (treffer.length === 0) {
    // Tag 951: Das VERFEHLEN der Bindung war der stillste Pfad im ganzen Gate. Zeigt ein
    // Eintrag auf ein anderes Vintage als das tatsächlich verglichene, liefert diese
    // Funktion null, die Ausnahme greift nicht, das Board wird SUSPECT — und der
    // Commit-Schritt nimmt das ganze TAGESVERZEICHNIS raus, ohne dass im Protokoll ein
    // Wort dazu stünde. Genau diese Bugklasse hat Karls Boards vom 12.–15.08. stillgelegt.
    // Das Verhalten bleibt unverändert fail-closed (null); ergänzt wird nur Sichtbarkeit.
    //
    // Gemeldet wird ausschließlich der WARTENDE Eintrag — einer, dessen gebundenes Vintage
    // NACH dem verglichenen Vorgänger liegt, der sein Vintage also noch nicht gesehen hat.
    // Ein Eintrag HINTER der Vergleichsfront ist verbraucht und von einem sauber erledigten
    // Übergang nicht zu unterscheiden; würde er mitmelden, schrien die drei Alt-Einträge
    // (2026-07-27/-07-28/-08-03) ab sofort jeden Tag für immer, und ein Alarm, der immer
    // feuert, ist in Karls einzigem Alarmkanal schlechter als keiner.
    // Kanal ist derselbe wie bei GATE BLIND / Maßstab-Bruch / GATE ABSTAND.
    for (const w of raw._massstab_brueche) {
      if (!w || typeof w.letztes_altes_vintage !== 'string') continue;
      if (w.letztes_altes_vintage <= priorDate) continue;
      console.log('::warning::GATE-BINDUNG VERFEHLT: Register-Eintrag '
        + (w.tag || w.typ || '(ohne tag)') + ' ist an den Vorgaenger '
        + w.letztes_altes_vintage + ' gebunden, verglichen wird aber gegen ' + priorDate
        + '. Die registrierte Ausnahme greift deshalb NICHT (fail-closed) — der Uebergang '
        + 'wird gegen die normale Schwelle gemessen und faellt voraussichtlich als SUSPECT '
        + 'aus dem Tagesverzeichnis. letztes_altes_vintage im Register auf ' + priorDate
        + ' nachziehen oder den Fall neu bewerten.');
    }
    return null;
  }
  const b = treffer[0];
  const boards = Array.isArray(b.boards) ? b.boards.filter((s) => typeof s === 'string' && s) : [];
  if (boards.length === 0) return null;
  // Typ 2 (16.08.2026): SCORE-DEFINITIONS-BRUCH. Der Schrumpfungs-Zweig oben deckt nur
  // Brueche ab, bei denen die Kohorte kleiner wird. Aendert sich die Score-DEFINITION ohne
  // eine einzige Zeile zu verlieren (Einmalertrag-Verdrahtung: gleiche Zeilenzahl, andere
  // Scores), greift er nicht — und der erste Neu-gegen-Alt-Lauf misst die volle Bewegung
  // gegen eine Schwelle, die auf dem alten Massstab kalibriert ist.
  // Statt eine HOEHE zu gewaehren, benennt der Eintrag die LAMPE, welche die betroffenen
  // Zeilen traegt: genau diese Zeilen zaehlen fuer den einen registrierten Vergleich nicht
  // in das p99. Alles andere wird unveraendert streng gemessen — eine unabhaengige Drift
  // in derselben Nacht faellt weiterhin auf. Auch hier steht keine Zahl im Register.
  const erklaerendeLampe = (typeof b.erklaerende_lampe === 'string' && b.erklaerende_lampe) ? b.erklaerende_lampe : null;
  return { tag: b.tag || null, letztesAltesVintage: priorDate, boards: new Set(boards), erklaerendeLampe };
}

// ── Retention/Kompaktierung (A12) ────────────────────────────────────────────
// Vintages älter als RETENTION_DAYS: PIT-Voll-Snapshot nach board-history-archive/
// kopieren (GG7c), dann im Vintage die per-Zeile-pit-Blöcke strippen (Kern bleibt:
// rank/score/scoreBase/scoreShrunk/flags/axisBreakdown). NICHTS ohne Archiv-Kopie.
//
// NICHT VERDRAHTET, UND DAS IST SO GEWOLLT (F-16-Akte §6/§7, gemessen 03.08.2026):
// compact() steht in KEINEM der 7 Workflows. Im Mess-Zweig-Konzept ist das
// Kompaktieren bereits COMMITTETER Vintages verboten — ein committetes Vintage ist
// die Messgrundlage, sein nachträgliches Strippen ändert rückwirkend, was gemessen
// wurde. Wer diesen Pfad scharfschaltet, braucht vorher eine Entscheidung zu §6/§7,
// nicht nur ein Archivziel. Das Archivziel (P.ARCHIVE_DIR) ist seit T20 fail-closed.
function compact(date, dryRun) {
  if (!fs.existsSync(P.HISTORY_DIR)) return { compacted: [] };
  const cutoff = new Date(date + 'T00:00:00Z').getTime() - RETENTION_DAYS * MS_PER_DAY;
  const compacted = [];
  for (const d of fs.readdirSync(P.HISTORY_DIR)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (new Date(d + 'T00:00:00Z').getTime() > cutoff) continue;  // jünger als t0+2Q → unberührt
    const dir = path.join(P.HISTORY_DIR, d);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json') || f.startsWith('_')) continue;
      const fp = path.join(dir, f);
      const v = readJsonOrNull(fp);
      // F9: nur echte Board-Vintages kompaktieren. Sidecars (calibration.json/regime.json —
      // ohne '_'-Präfix und ohne cohort) bekämen sonst vom Lean-Write ein leeres cohort
      // injiziert; rank-ic.js:boardsOf erkennt Boards genau über !!(v && v.cohort) und
      // zählte sie danach als Phantom-Boards. Gleiche inhaltsbasierte Prüfung wie dort.
      if (!v || v.compacted || !v.cohort) continue;
      const archivePath = assertNoPicksHistory(path.join(P.ARCHIVE_DIR, d, f));
      if (!dryRun) {
        fs.mkdirSync(path.dirname(archivePath), { recursive: true });
        writeJsonAtomic(archivePath, v);           // 1) Archiv-Kopie ZUERST (Voll-Snapshot)
      }
      // 2) Kern-Version schreiben (pit gestrippt, Rest bleibt)
      const strip = (rows) => (rows || []).map((r) => { const { pit, ...core } = r; return core; });
      const lean = {
        ...v,
        compacted: true,
        compactedAt: isoDay(Date.now()),
        archivedTo: path.relative(REPO_ROOT, archivePath),
        cohort: { profitable: strip(v.cohort && v.cohort.profitable), unprofitable: strip(v.cohort && v.cohort.unprofitable) },
      };
      if (!dryRun) writeJsonAtomic(assertNoPicksHistory(fp), lean);
      compacted.push(path.relative(REPO_ROOT, fp));
    }
  }
  return { compacted };
}

// ── Regime-Ausweis (nur Ausweis, §5) ─────────────────────────────────────────
// macro.regimes ist nach SPY-Handelsdatum gekeyt (macro-regime.js). Ein exakter
// Key-Lookup verfehlt jeden Lauf, dessen Vintage-Datum (heute UTC) noch keinen
// SPY-Schluss trägt — Wochenenden, Feiertage, Läufe vor US-Handelsschluss (F7):
// er lieferte dann fälschlich 'unknown' statt des letzten gültigen Regimes. Fix:
// den jüngsten Key <= Ziel-Datum erben. Der Staleness-Wächter (REGIME_MAX_STALE_DAYS)
// verhindert, dass ein Wochen-altes Regime still als „heute" durchgeht; asOf weist
// immer aus, WELCHER Handelstag tatsächlich gilt.
function regimeForDate(date) {
  const macro = readJsonOrNull(P.MACRO_REGIME_FILE);
  const regimes = macro && macro.regimes;
  if (!regimes) return { date, label: 'unknown', source: 'macro-regime.json(absent)' };
  let keyDate = regimes[date] ? date : null;
  if (!keyDate) {
    const priorKeys = Object.keys(regimes).filter((k) => k < date).sort();
    keyDate = priorKeys.length ? priorKeys[priorKeys.length - 1] : null;
  }
  // §5: kein Key <= Datum (Macro beginnt erst später) → 'unknown', kein Datenfehler.
  if (!keyDate) return { date, label: 'unknown', source: 'macro-regime.json(date-missing)' };
  const ageDays = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(keyDate + 'T00:00:00Z')) / MS_PER_DAY);
  if (ageDays > REGIME_MAX_STALE_DAYS) {
    // Zu alt → ehrlich 'unknown' MIT Grund + Alter; kein geerbtes Alt-Label (keine stille Lüge).
    return { date, label: 'unknown', source: 'macro-regime.json(stale>' + REGIME_MAX_STALE_DAYS + 'd)', asOf: keyDate, staleDays: ageDays };
  }
  const entry = regimes[keyDate];
  // Schema-Toleranz wie walk-forward-perf._regimeOf (G-B, Alt-Format-Robustheit).
  const isObj = entry && typeof entry === 'object';
  return { date, label: isObj ? entry.regime : entry, price: isObj ? entry.price : undefined, sma200: isObj ? entry.sma200 : undefined, source: 'macro-regime.json', asOf: keyDate };
}

// BH-155: folgt sameAs-Verweisen rückwärts bis zur echten Vollkopie der
// Kalibrierung (Dedup-Kette). Deckel = RETENTION_DAYS (wiederverwendete Konstante,
// kein neuer Magic-Wert) als reine Bremse gegen korrupte/zyklische Verweise.
function resolveFullCalibration(date) {
  let d = date;
  for (let hops = 0; hops < RETENTION_DAYS; hops++) {
    const v = readJsonOrNull(path.join(P.HISTORY_DIR, d, 'calibration.json'));
    if (!v) return null;
    if (v.sameAs) { d = v.sameAs; continue; }
    return { date: d, json: JSON.stringify(v) };
  }
  return null;
}

// ── Hauptlauf ────────────────────────────────────────────────────────────────
function run(opts) {
  opts = opts || {};
  if (opts.baseDir) _setPaths(opts.baseDir);   // Test-Hermetik (L4); Default bleibt REPO_ROOT
  const date = opts.date || isoDay(Date.now());
  const dryRun = !!opts.dryRun;

  // BH-147: Format- + Zukunfts-Guard gilt für JEDEN Aufrufer (auch --compact nutzt
  // date als Cutoff-Referenz). Das Format-Regex schließt einen Pfad-Escape strukturell
  // aus; die "Backfill-Vertrag"-Regel (--allow-backfill) ist eine CLI-Grenze und lebt
  // bewusst NICHT hier — run() ist die interne API, die Tests/andere Skripte mit
  // beliebigem historischem --date aufrufen dürfen.
  if (!isValidDateStr(date)) throw new Error('write-board-history: invalid --date (expected YYYY-MM-DD): ' + date);
  if (date > isoDay(Date.now())) throw new Error('write-board-history: --date is in the future: ' + date);

  if (opts.compact) {
    const res = compact(date, dryRun);
    return { mode: 'compact', date, dryRun, ...res, exitCode: 0 };
  }

  if (!fs.existsSync(P.FULL_DIR)) throw new Error('missing full-cohort dir: ' + P.FULL_DIR);
  const calib = readJsonOrNull(P.CALIBRATION_FILE);
  const calibMeta = {
    formulaVersion: (calib && calib.schema) || null,     // Proxy für Formel-Lineage (§7)
    generatedAt: (calib && calib.generated_at) || null,
  };
  const boards = fs.readdirSync(P.FULL_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
  if (boards.length === 0) throw new Error('no full-cohort board files in ' + P.FULL_DIR);

  readOrScaffoldExcluded(dryRun);
  const gateCalib = readJsonExistingOrThrow(P.GATE_CALIB_FILE)
    || { _doc: 'Gate-Kalibrierung je Board: messbare P99-Tagesdeltas sammeln; nach '
      + CALIBRATION_SAMPLES + ' Stichproben MIT Bewegung wird die Schwelle eingefroren '
      + '(Quantil ' + GATE_CALIB_QUANTILE + ' der Stichproben x ' + THRESHOLD_MULTIPLIER + '). '
      + 'Bis dahin gilt der gemessene Boden ' + MIN_GATE_THRESHOLD + ' je Tag Abstand.', boards: {} };
  const priorDate = priorVintageDate(date);
  // Der Bruch hängt am EXAKTEN Vorgänger (Begründung an der Funktion): er greift genau
  // dann, wenn tatsächlich gegen den letzten Stand des alten Maßstabs verglichen wird,
  // und endet von selbst, sobald ein Vintage im neuen Maßstab gelandet ist.
  const bruch = massstabBruchFuer(priorDate);
  const dateDir = path.join(P.HISTORY_DIR, date);
  // BH-147: Defense-in-depth — der resolved Pfad muss unter HISTORY_DIR bleiben.
  // Das Format-Regex oben schließt einen Escape bereits strukturell aus; dieser
  // Guard fängt jede künftige Aufweichung der Regex an der Schreib-Grenze selbst ab.
  const resolvedDateDir = path.resolve(dateDir);
  const resolvedHistoryDir = path.resolve(P.HISTORY_DIR);
  if (resolvedDateDir !== resolvedHistoryDir && !resolvedDateDir.startsWith(resolvedHistoryDir + path.sep)) {
    throw new Error('write-board-history: resolved date dir escapes HISTORY_DIR: ' + resolvedDateDir);
  }

  const results = [];
  let anySuspect = false;
  // T155/W3: einmal je Lauf lesen, nicht je Board — 13 identische Lesevorgänge derselben
  // Datei wären 13 Gelegenheiten, unterschiedliche Werte in ein Vintage zu schreiben.
  const universeHash = readUniverseHash(P.UNIVERSE_HASH_FILE);
  for (const board of boards) {
    const boardPath = path.join(P.FULL_DIR, board + '.json');
    const boardData = readJsonOrNull(boardPath);
    // X2: an unreadable/corrupt board file is a missing INPUT — the same class as the
    // FULL_DIR-guards above (missing dir / no board files), which already throw -> exit 1.
    // It is NOT a value-plausibility question (exit 2 "suspect"), which presumes a parsed
    // vintage exists to judge. A silent `continue` here left anySuspect untouched -> exit 0
    // with a board missing from the vintage, contradicting the header's own exit contract
    // ("1 = harter Fehler (Inputs fehlen)") and the fail-loud line the FULL_DIR-guards set.
    if (!boardData) throw new Error('unreadable full-cohort board file: ' + boardPath);
    const vintage = buildBoardVintage(board, boardData, date, calibMeta, universeHash);
    const priorVintage = priorDate ? readJsonOrNull(path.join(P.HISTORY_DIR, priorDate, board + '.json')) : null;
    const gate = evaluateGate(vintage, priorVintage, gateCalib.boards[board], bruch, board);
    // Kalibrier-Sample nachziehen (frozen erst NACH Auswertung, damit die aktuelle
    // Auswertung noch in der Kalibrierphase mit calibrating:true läuft).
    // BH-111: ein bereits als suspect erkannter Tag darf die eingefrorene Schwelle
    // NICHT mitziehen — sonst kalibriert genau der Datenbruch, den das Gate fangen
    // soll, das Gate selbst hoch. suspect-Tage liefern daher kein Sample (null statt
    // p99Delta); die Kalibrierung sammelt einfach weiter, bis ein sauberer Tag kommt.
    // Ein Bruch-Tag liefert AUCH kein Sample: sein Delta enthält den Maßstab-Wechsel,
    // nicht nur Tagesbewegung — es würde die eingefrorene Schwelle dauerhaft hochziehen
    // (dieselbe Falle wie beim suspect-Tag, nur mit umgekehrtem Vorzeichen im Urteil).
    // Die Kalibrierung lernt eine TAGESbewegung: ein Vergleich über mehrere Tage geht
    // deshalb pro Tag ein, nicht roh — sonst zöge jede Lücke die Schwelle hoch (dieselbe
    // Falle wie beim suspect- und beim Bruch-Tag, nur mit dem Kalender als Auslöser).
    // Ein Vergleich jenseits von GATE_MAX_ABSTAND_TAGE liefert gar kein Sample: er wurde
    // nicht beurteilt, und eine Normierung über mehr als eine Woche wäre eine Annahme,
    // keine Messung.
    const tagesSample = (gate.suspect || gate.bruchGrenze || gate.abstandZuGross || gate.p99Delta == null)
      ? null : gate.p99Delta / gate.gapDays;
    const gs = updateGateCalibration(gateCalib, board, tagesSample, date);
    vintage.gate = {
      calibrating: gate.calibrating,
      p99Delta: gate.p99Delta,
      threshold: gate.threshold,          // unverändert die KALIBRIERTE Schwelle (Historie bleibt ehrlich)
      // …und daneben die Grenze, an der HEUTE tatsächlich gemessen wurde (Boden bzw.
      // Bruch-Grenze × Tagesabstand). Ohne sie stünde in der Historie ein threshold:null,
      // obwohl geprüft wurde — „nicht kalibriert" wäre von „nicht geprüft" nicht zu
      // unterscheiden, dieselbe Lücke, die Tag 502 für den blinden Tag geschlossen hat.
      wirksameSchwelle: gate.wirksameSchwelle,
      gapDays: gate.gapDays,
      abstandZuGross: gate.abstandZuGross,
      bruchGrenze: gate.bruchGrenze || null,   // an einem Bruch-Tag: die tatsächlich angelegte Grenze + ihre Herleitung
      suspect: gate.suspect,
      reasons: gate.reasons,
      priorDate: priorDate,
      calibrationSamples: gs.dailyP99Samples.length,
    };
    if (gate.suspect) anySuspect = true;
    if (!dryRun) {
      fs.mkdirSync(dateDir, { recursive: true });
      writeJsonAtomic(assertNoPicksHistory(path.join(dateDir, board + '.json')), vintage);
    }
    results.push({ board, suspect: gate.suspect, calibrating: gate.calibrating, p99Delta: gate.p99Delta, threshold: gate.threshold, wirksameSchwelle: gate.wirksameSchwelle, gapDays: gate.gapDays, abstandZuGross: gate.abstandZuGross, bruchGrenze: gate.bruchGrenze || null, rows: vintage.cohort.profitable.length + vintage.cohort.unprofitable.length, pitCoverage: vintage.pitCoverage });
  }

  // Seiten-Artefakte je Datum: calibration.json-Kopie + regime.json.
  if (!dryRun) {
    fs.mkdirSync(dateDir, { recursive: true });
    if (calib) {
      // BH-155: calibration.json wurde bisher JEDEN Tag voll kopiert (~0,8 MB, Stand
      // 18.07.2026), obwohl sich die Kalibrierung oft tagelang nicht ändert; compact()
      // überspringt Sidecars ausdrücklich (F9) UND läuft in Produktion nie (BH-153) —
      // Kompaktierung allein löst das Wachstum also nicht, der Fix muss am
      // Schreib-Zeitpunkt selbst ansetzen. Dedup gegen die letzte VOLLE Kopie (Kette
      // folgt sameAs-Verweise zurück); bei Byte-Gleichheit nur ein kleiner Verweis.
      const prevFull = priorDate ? resolveFullCalibration(priorDate) : null;
      const calibJson = JSON.stringify(calib);
      if (prevFull && prevFull.json === calibJson) {
        writeJsonAtomic(assertNoPicksHistory(path.join(dateDir, 'calibration.json')),
          { sameAs: prevFull.date, _doc: 'BH-155-Dedup: unveraendert seit sameAs; volle Kopie dort.' });
      } else {
        writeJsonAtomic(assertNoPicksHistory(path.join(dateDir, 'calibration.json')), calib);
      }
    }
    writeJsonAtomic(assertNoPicksHistory(path.join(dateDir, 'regime.json')), regimeForDate(date));
    writeJsonAtomic(assertNoPicksHistory(P.GATE_CALIB_FILE), gateCalib);
    // F-9 Stufe 1: UNBEDINGT (auch bei anySuspect) — reine Zusatzmessung, kein Gate-Zweig.
    const p99History = readJsonExistingOrThrow(P.P99_DELTA_HISTORY_FILE) || {};
    fs.mkdirSync(path.dirname(P.P99_DELTA_HISTORY_FILE), { recursive: true });
    writeJsonAtomic(assertNoPicksHistory(P.P99_DELTA_HISTORY_FILE), updateP99DeltaHistory(p99History, date, results));
  }

  // Fall (b) aus uebersprungeneVorgaenger(): es gab Vorgaenger, alle ausgeschlossen.
  // Nur dann ist "heute wurde nichts verglichen" eine meldepflichtige Tatsache.
  const blind = priorDate === null ? uebersprungeneVorgaenger(date) : [];

  return { mode: 'write', date, dryRun, priorDate, ohneVergleichsbasis: blind.length ? blind : null, bruch: bruch ? { tag: bruch.tag, boards: Array.from(bruch.boards) } : null, boards: results, regime: regimeForDate(date), exitCode: anySuspect ? 2 : 0 };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { dryRun: false, compact: false, date: null, allowBackfill: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--compact') o.compact = true;
    else if (a === '--allow-backfill') o.allowBackfill = true;   // BH-147: expliziter Operator-Vertrag
    else if (a === '--date') o.date = argv[++i];
    else if (a.startsWith('--date=')) o.date = a.slice(7);
  }
  return o;
}

if (require.main === module) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    // BH-147: manuelles --date-Backfill ist Operator-Risiko (Audit: "manueller
    // Operator-Fehlgebrauch der committeten PIT-Messreihe"). CI läuft ohne --date
    // (daily-pull.yml). Ein von heute abweichendes Datum verlangt daher explizit
    // --allow-backfill; ohne den Vertrag bricht die CLI VOR jedem Schreibzugriff.
    if (requiresBackfillContract(opts.date, opts.allowBackfill, opts.dryRun)) {
      console.error('write-board-history: --date ' + opts.date + ' weicht vom heutigen Tag ab — erfordert --allow-backfill (Operator-Vertrag, BH-147).');
      process.exit(1);
    }
    const res = run(opts);
    const tag = res.dryRun ? '[dry-run] ' : '';
    if (res.mode === 'compact') {
      console.log(tag + 'compact ' + res.date + ': ' + res.compacted.length + ' Vintages kompaktiert');
      res.compacted.forEach((f) => console.log('  archiviert+gestrippt: ' + f));
    } else {
      console.log(tag + 'board-history ' + res.date + ' (prior=' + res.priorDate + ', regime=' + res.regime.label + ')');
      // "Heute wurde gar nicht verglichen" gehoert in denselben Alarmkanal wie die
      // erhoehte Bruch-Schwelle darunter — sonst sieht ein blinder Tag im Protokoll
      // genauso aus wie ein sauber gepruefter (p99Delta null, suspect false).
      if (res.ohneVergleichsbasis) {
        console.log('::warning::GATE BLIND fuer ' + res.date + ': keine Vergleichsbasis — alle '
          + res.ohneVergleichsbasis.length + ' Vorgaenger stehen auf der Ausschlussliste ('
          + res.ohneVergleichsbasis.join(', ') + '). Das Wert-Gate hat heute NICHTS geprueft; '
          + 'p99Delta=null in allen Boards heisst "nicht gemessen", nicht "sauber". Der naechste '
          + 'Lauf vergleicht wieder, sobald ein nicht ausgeschlossenes Vintage vorliegt.');
      }
      // Karls einziger Alarmkanal ist das Lauf-Protokoll: eine ausgesetzte oder erhöhte
      // Grenze MUSS im Klartext dort stehen, sonst ist "gruen" nicht von "Gate uebergangen"
      // zu unterscheiden. Kopfzeile vor der Board-Liste, damit sie ohne Scrollen sichtbar ist.
      if (res.bruch) {
        const erhoeht = res.boards.filter((b) => b.bruchGrenze).length;
        // 30.07.: ::warning:: ERGAENZT. Der Kanal war asymmetrisch — der BLINDE Tag (Z. 850)
        // meldete im Warnkanal, die AKTIVE Ausnahme schrieb nur eine stille Zeile. Damit war
        // ausgerechnet der Fall, in dem die Grenze bewusst angehoben wurde, schlechter
        // sichtbar als der, in dem gar nicht verglichen wurde. Alle drei Richter des
        // Gate-Urteils vom 30.07. haben dieselbe Ein-Zeilen-Korrektur gefordert; der
        // Kommentar zwei Zeilen darueber verlangt sie eigentlich schon selbst.
        console.log('::warning::GATE: Massstab-Bruch aktiv fuer ' + res.date
          + (res.bruch.tag ? ' (' + res.bruch.tag + ')' : '')
          + ' — ' + erhoeht + ' Board(s) mit erhoehter Tagesschwelle, '
          + (res.boards.length - erhoeht) + ' unveraendert; uebrige Integritaetspruefungen AKTIV');
      }
      // Dritter Fall im selben Alarmkanal wie GATE BLIND und Massstab-Bruch: der Vergleich
      // spannt mehr als GATE_MAX_ABSTAND_TAGE. Dann urteilt die Wert-Achse bewusst nicht —
      // das MUSS im Klartext stehen, sonst sieht ein ungeprueftes Vintage aus wie ein
      // bestandenes (dieselbe Verwechslung, die Tag 502 fuer den blinden Tag geschlossen hat).
      const zuWeit = res.boards.filter((b) => b.abstandZuGross);
      if (zuWeit.length) {
        // Der Abstand wird je Board gemessen (ein Board ohne Vorgaenger-Datei hat einen
        // anderen). Deshalb die tatsaechlich vorkommenden Abstaende ausgeben statt
        // zuWeit[0] fuer alle zu behaupten — sonst steht im Alarm eine Zahl, die fuer
        // einen Teil der genannten Boards nicht gilt.
        const abstaende = [...new Set(zuWeit.map((b) => b.gapDays))].sort((a, b) => a - b);
        console.log('::warning::GATE ABSTAND fuer ' + res.date + ': Vorgaenger ' + res.priorDate
          + ' liegt ' + abstaende.join('/') + ' Tage zurueck (Maximum ' + GATE_MAX_ABSTAND_TAGE
          + '). Die Wert-Achse hat in ' + zuWeit.length + ' Board(s) NICHT geurteilt — p99Δ steht '
          + 'im Protokoll, ist aber "nicht geprueft", nicht "sauber". NaN-Einbruch, Coverage-Absturz '
          + 'und Kohorten-Ueberlappung wurden unveraendert geprueft.');
      }
      for (const b of res.boards) {
        if (b.error) { console.log('  ' + b.board + ': ' + b.error); continue; }
        const flag = b.suspect ? ' SUSPECT[' + '⚠' + ']' : (b.calibrating ? ' (calibrating)' : '');
        const g = b.bruchGrenze;
        // Alle Bestandteile getrennt: gemessene Schrumpfung → Strukturgrenze → Deckel →
        // angelegte Grenze. Wer die Zeile liest, kann die Rechnung nachvollziehen.
        const bruchText = g
          ? ' [Bruch: Kohorte ' + g.zeilenNachher + ' von ' + g.zeilenVorher
            + ' = -' + (100 * (g.zeilenVorher - g.zeilenNachher) / g.zeilenVorher).toFixed(1) + '%'
            + ' -> Strukturgrenze ' + g.strukturgrenze.toFixed(2)
            + ', Deckel ' + g.deckel.toFixed(2)
            + ' -> Tagesschwelle ' + g.tagesschwelle.toFixed(2)
            + ' statt ' + g.normaleSchwelle.toFixed(2) + ']'
          : '';
        // thr= ist jetzt die WIRKSAME Grenze (Tagesgrenze × Tagesabstand) und sagt in
        // Klammern dazu, woher die Tagesgrenze kommt — Boden oder board-eigene Messung.
        // Vorher stand hier die kalibrierte Schwelle, die seit der Tagesabstands-Rechnung
        // nicht mehr die Zahl ist, an der geurteilt wurde.
        const grenzeText = b.abstandZuGross
          ? ', thr=— (Abstand ' + b.gapDays + 'd > ' + GATE_MAX_ABSTAND_TAGE + 'd: Wert-Achse NICHT geprueft)'
          : ', thr=' + (b.wirksameSchwelle == null ? '—' : b.wirksameSchwelle.toFixed(2))
            + ' (' + (b.threshold == null ? 'Boden ' + MIN_GATE_THRESHOLD.toFixed(2) : 'kalibriert ' + b.threshold.toFixed(2))
            + ' x ' + b.gapDays + 'd'
            + (b.bruchGrenze ? ' + Bruch-Allowance ' + b.bruchGrenze.allowance.toFixed(2) + ' einmalig' : '')
            + ')';
        console.log('  ' + b.board + ': ' + b.rows + ' Zeilen, p99Δ=' + (b.p99Delta == null ? '—' : b.p99Delta.toFixed(2)) +
          grenzeText +
          ', beta-cov=' + (b.pitCoverage.beta * 100).toFixed(0) + '%' + flag + bruchText);
      }
      if (res.exitCode === 2) console.log('EXIT 2: mindestens ein suspect-Vintage geschrieben (0.7-Kanal).');
    }
    process.exit(res.exitCode);
  } catch (e) {
    console.error('write-board-history FEHLER: ' + (e && e.stack || e));
    process.exit(1);
  }
}

module.exports = {
  run, parseArgs, buildBoardVintage, readUniverseHash, evaluateGate, updateGateCalibration,
  updateP99DeltaHistory,
  compact, readOrScaffoldExcluded, regimeForDate, priceGrossProfit, pitCoverageBlock,
  quantile, assertNoPicksHistory, buildPit,
  priorVintageDate, excludedDates, massstabBruchFuer,
  _setPaths, resolvePaths,
  frozenThresholdOf,
  isValidDateStr, requiresBackfillContract, resolveFullCalibration,   // BH-147/BH-155
  tagesabstand,
  _const: { CALIBRATION_SAMPLES, THRESHOLD_MULTIPLIER, MIN_GATE_THRESHOLD, COVERAGE_COLLAPSE_DROP, RETENTION_DAYS, MIN_COHORT_OVERLAP, GATE_CALIB_QUANTILE, GATE_MAX_ABSTAND_TAGE },
};
