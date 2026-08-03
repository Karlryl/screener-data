#!/usr/bin/env node
'use strict';
/**
 * F-12 (Karl-Entscheid 04.08.2026) — Karteileichen-Filter beim Zusammenfuehren.
 *
 * BEFUND: 1.806 der 12.540 Snapshot-Dateien (14,4 %) gehoeren zu Tickern, die seit der
 * Watchlist-Kuerzung am 17.07. (5eb9a0ae47) nicht mehr in watchlist.json stehen. Der Pull
 * zieht sie nie wieder — sie ueberleben aber in den per-Shard-Caches (daily-pull.yml,
 * "Restore snapshot cache"), wandern von dort in die Shard-Artefakte und beim
 * merge-multiple-Download wieder in EINEN snapshots/-Ordner.
 *
 * WARUM GENAU HIER: dieser Ordner ist der Flaschenhals, durch den JEDER Artefakt-Weg
 * laeuft. Alles, was im merge-Job danach kommt (prune-watchlist, merge-shard-manifests,
 * verify-freshness, coverage-gate, watch-exchange-coverage, watch-unrouted-quote,
 * watch-annual-spikes, watch-fx-sanity, update-ath-state) liest ihn, und das
 * hochgeladene "snapshots"-Artefakt (30 MB) wird daraus gebaut — es speist den
 * scoring-Job UND monthly-sec-xbrl.yml. Ein Filter an einer einzelnen dieser Stationen
 * waere ein Symptom-Pfad; hier ist er einmal wirksam fuer alle.
 *
 * KARL-ENTSCHEID: filtern, KEINE Datei-Loeschung. Deshalb kopiert dieses Skript aus dem
 * Eingangsordner (dorthin laedt download-artifact) in den Zielordner und laesst den
 * Eingang unangetastet — jede Karteileiche bleibt auf der Platte liegen, sie wandert nur
 * nicht mehr weiter.
 *
 * Die Boards waren nie betroffen (filterToAuthorizedUniverse in src/scoring/run-screener.js
 * schneidet dieselbe Menge vor dem Scoring weg). Verzerrt waren die MESSUNGEN: die
 * Frische-Quote las 33,4 % veraltet statt der auf dem autorisierten Universum echten 24,3 %.
 *
 * Usage:
 *   node scripts/filter-snapshot-merge.js --eingang snapshots-eingang --ziel snapshots \
 *                                         [--watchlist watchlist.json]
 */
const fs = require('fs');
const path = require('path');
const { safeSnapshotFilename, isMetadataSnapshot } = require('../lib/snapshot-fs.js');
const { loadWatchlist } = require('../lib/watchlist-fs.js');
const { writeFileAtomic } = require('../lib/atomic-write.js');

/**
 * F-12-R2 (Review Tag 563): Anteil uebersprungener Snapshots, ab dem dieser Schritt hart
 * stoppt. Der bisherige Stop griff erst bei 100 % — ein Namensschema-Bruch, der "nur" die
 * Haelfte erwischt (Suffix-Regel, Grossschreibung, halb geschriebene Watchlist), waere still
 * durchgelaufen und haette das halbe Universum aus jeder Messung und aus dem Artefakt genommen.
 * 0.30 gegen real gemessene 14,4 % (CI) / 15,4 % (lokal): Luft fuer den normalen
 * Karteileichen-Bestand, aber weit unter jedem Bruch-Szenario. Benannte Konstante am
 * Modulkopf wie COVERAGE_FLOOR_RATIO (run-screener.js) und FAIL_MASS_MAX (coverage-gate.js) —
 * dieses Repo fuehrt Schwellen dort, nicht in einer Config-Datei (filter-config.json ist
 * ausdrueckliches Alt-Gut, das kein Produktionscode liest).
 */
const MAX_UEBERSPRUNGEN_ANTEIL = 0.30;

/**
 * T565-M1 (Review Tag 565): der gemessene Anteil RATCHT nach oben und kann nie sinken.
 * Karteileichen werden bewusst NICHT geloescht (Karl-Entscheid), und der Eingang traegt sie
 * ueber die per-Shard-Caches taeglich wieder heran — jedes weitere Watchlist-Prunen hebt den
 * Zaehler, nichts senkt ihn je. 14,4 % waren der Stand vom 04.08.; mit jeder Kuerzung wandert
 * er Richtung 30 %, und dann stoppt dieser Schritt jeden Tag, ohne dass irgendetwas kaputt
 * waere. Das VENTIL (gleiche Bauform wie ALLOW_PULL_DRIFT in scripts/check-pull-stats.js,
 * verdrahtet ueber `vars.` in daily-pull.yml) macht diesen Tag entstoerbar, ohne die Schwelle
 * dauerhaft hochzudrehen: Befund bleibt sichtbar (::warning::), der Lauf laeuft weiter.
 * Die dauerhafte Reparatur ist eine ANDERUNGS- statt Pegel-Messung (Sprung gegenueber dem
 * Vorlauf statt absoluter Anteil) — eigener Punkt, bewusst nicht hier.
 */
const DRIFT_VENTIL = 'ALLOW_UEBERSPRUNGEN_DRIFT';

/**
 * T569-F8 (Review Tag 569): das Ventil war ein SCHALTER (`=== '1'`) und damit ein Dauer-AN.
 * Genau der Anteil, der laut T565-M1 monoton nach oben ratcht, waere nach einmaligem Setzen
 * nie wieder aufgefallen — 35 %, 50 %, 80 % uebersprungene Snapshots haetten alle dieselbe
 * ::warning::-Zeile erzeugt, und der eigentliche Zweck der Wache (Namensschema-/Watchlist-
 * Bruch) waere dauerhaft abgeschaltet gewesen. Der Wert ist jetzt die OBERGRENZE (Anteil in
 * (0,1]), BIS ZU DER das Ventil gilt; darueber stoppt der Lauf wieder hart.
 * `1` bleibt rueckwaerts-kompatibel: 1.0 = 100 % = kein Deckel, also exakt das bisherige
 * Verhalten fuer eine eventuell schon gesetzte Repo-Variable. Alles Unbrauchbare (leer, '0',
 * 'ja', negativ, >1) oeffnet nichts (fail-closed).
 * Reine Funktion, damit die Auswertung ohne Prozess pruefbar ist.
 */
function ventilObergrenze(rohwert) {
  const v = Number(rohwert);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : null;
}

/**
 * Mindest-Fallzahl, unter der ein ANTEIL nichts aussagt (2 von 3 Dateien sind 67 %, aber kein
 * Befund). Gleiche Bauform wie MIN_HISTORY_RUNS (check-pull-stats.js) und MIN_COHORT_N
 * (score.js): erst genug Masse, dann quoteln. Real kommen ~12.500 Snapshots an — ein Lauf
 * unter 100 ist ohnehin katastrophal und wird vom Coverage-Gate gefangen, nicht hier. Der
 * 100-%-Stop darunter greift unabhaengig von dieser Grenze.
 */
const MIN_GESCANNT_FUER_ANTEIL = 100;

/**
 * F-12-R1 (Review Tag 563): Feldname der Eingangs-Zahl im Manifest. Siehe schreibeEingangsZahl().
 */
const MANIFEST_EINGANG_FELD = 'n_eingang_snapshots';

/**
 * Watchlist-Eintraege -> Menge der ERWARTETEN Snapshot-Dateinamen. Bewusst ueber
 * safeSnapshotFilename (dieselbe Funktion, mit der pull-yahoo.js schreibt) statt ueber
 * meta.ticker aus dem Dateiinhalt: 12.500 Dateien oeffnen kostet Minuten, und Schreiber
 * und Leser teilen sich damit exakt eine Namensregel (BRK.B, _CON.json, Klein-/
 * Grossschreibung). Ein Eintrag ohne brauchbaren Ticker wird gezaehlt, nicht verschluckt.
 */
function autorisierteDateinamen(stocks) {
  const erlaubt = new Set();
  let unbrauchbar = 0;
  // F-12-R6 (Review Tag 563): der Grund wurde verschluckt. "3 Eintraege ohne brauchbaren
  // Ticker" ist ohne die erste Fehlermeldung nicht diagnostizierbar — null/undefined,
  // leerer String und ein Ticker, der nach der Bereinigung nur aus "_" besteht, sind drei
  // verschiedene Watchlist-Defekte mit drei verschiedenen Ursachen.
  let ersterFehler = null;
  for (const s of stocks || []) {
    const t = typeof s === 'string' ? s : (s && s.ticker);
    try { erlaubt.add(safeSnapshotFilename(t)); }
    catch (e) {
      unbrauchbar++;
      if (ersterFehler === null) ersterFehler = `erster Fall: ${JSON.stringify(t) || String(t)} -> ${e.message}`;
    }
  }
  return { erlaubt, unbrauchbar, ersterFehler };
}

/**
 * F-12-R1 (Review Tag 563, H1): die Zahl der GESCANNTEN Eingangs-Snapshots ins Ziel-Manifest.
 *
 * WARUM: seit diesem Filter enthaelt snapshots/ nur noch die watchlist-autorisierten Staende.
 * Der Coverage-Floor in run-screener.js zaehlte genau dieses Verzeichnis — und maass damit
 * wieder das Watchlist-Pruning statt der Snapshot-Korruption, die er fangen soll. Das ist die
 * Kopplung, die BH-116/C1 bewusst geloest hatte (prune-watchlist darf bis 50 %/Tag kuerzen,
 * COVERAGE_FLOOR_RATIO=0.95 -> jeder Schrumpf ueber 5 % riss den Folgelauf hart ab). Dieser
 * Schritt ist der einzige Ort, der BEIDE Zahlen kennt; er reicht die ungefilterte weiter.
 *
 * KOMPATIBEL ERGAENZT: das vorhandene Manifest (aus dem Eingang mitkopiert) wird gelesen und
 * nur um dieses eine Feld erweitert — merge-shard-manifests.js ueberschreibt die Datei
 * gleich danach vollstaendig und uebernimmt das Feld bewusst (siehe dort). Atomar wie jeder
 * andere Schreiber dieser Datei (NRE-SK-001).
 */
function schreibeEingangsZahl(ziel, gescannt) {
  const p = path.join(ziel, '_manifest.json');
  let manifest = {};
  try {
    const vorhanden = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (vorhanden && typeof vorhanden === 'object' && !Array.isArray(vorhanden)) manifest = vorhanden;
  } catch (_) { /* kein/kaputtes Manifest im Eingang: merge-shard-manifests schreibt es ohnehin neu */ }
  manifest[MANIFEST_EINGANG_FELD] = gescannt;
  writeFileAtomic(p, JSON.stringify(manifest));
}

/**
 * Reine Aufteilung einer Dateiliste (TDD-Kern, kein I/O).
 *   uebernehmen  = autorisierte Snapshots + Nicht-Snapshot-Dateien (Metadateien wie
 *                  _manifest.json, alles ohne .json) — die gehen unveraendert durch,
 *                  sie sind keine Ticker-Staende und traegen keine Karteileichen-Daten.
 *   uebersprungen = Snapshots ohne Watchlist-Eintrag.
 *   gescannt      = nur die echten Ticker-Snapshots (der Nenner des Zaehl-Logs).
 */
function teileEingang(files, erlaubt) {
  const uebernehmen = [], uebersprungen = [];
  let gescannt = 0;
  for (const f of files) {
    if (!f.endsWith('.json') || isMetadataSnapshot(f)) { uebernehmen.push(f); continue; }
    gescannt++;
    if (erlaubt.has(f)) uebernehmen.push(f); else uebersprungen.push(f);
  }
  return { uebernehmen, uebersprungen, gescannt };
}

function run(argv) {
  const get = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
  const eingang = get('--eingang', 'snapshots-eingang');
  const ziel = get('--ziel', 'snapshots');
  const watchlistPfad = get('--watchlist', 'watchlist.json');

  // Ladefehler != leere Watchlist. Genau dieselbe Unterscheidung wie in loadUniverse
  // (S5-SC-001): eine unlesbare Datei liefert stocks=[] und wuerde hier ALLES als
  // Karteileiche wegfiltern — das Universum verschwaende still. Hart abbrechen.
  const wl = loadWatchlist(watchlistPfad);
  if (wl.error) {
    console.error(`::error::filter-snapshot-merge — Watchlist nicht ladbar (${watchlistPfad}): ${wl.error}. Abbruch statt lautlosem Filtern gegen eine leere Menge.`);
    return 1;
  }
  const { erlaubt, unbrauchbar, ersterFehler } = autorisierteDateinamen(wl.stocks);
  if (unbrauchbar > 0) {
    console.error(`::warning::filter-snapshot-merge — ${unbrauchbar} Watchlist-Eintraege ohne brauchbaren Ticker (kein Dateiname ableitbar); ihre Snapshots gelten als nicht autorisiert. ${ersterFehler}`);
  }

  let files;
  try { files = fs.readdirSync(eingang); }
  catch (e) {
    console.error(`::error::filter-snapshot-merge — Eingangsordner ${eingang} nicht lesbar (${e.message}). Der Download der Shard-Snapshots ist die Voraussetzung dieses Schritts.`);
    return 1;
  }

  const { uebernehmen, uebersprungen, gescannt } = teileEingang(files, erlaubt);

  // 0 gescannte Snapshots ist ein eigener Befund: entweder ein Kaltstart ohne jeden
  // Shard-Cache oder ein leerer Download. Kein harter Stop (der Zustand ist legitim und
  // wird flussabwaerts vom Coverage-Gate als degradiert/katastrophal gefangen), aber
  // niemals still.
  if (gescannt === 0) {
    console.error(`::warning::filter-snapshot-merge — 0 Snapshots im Eingang ${eingang} gescannt (${files.length} Eintraege insgesamt). Kein Shard hat Snapshots geliefert; das Coverage-Gate entscheidet ueber den Lauf.`);
  } else if (uebersprungen.length === gescannt) {
    // Jeder einzelne Snapshot unautorisiert heisst nicht "alles Karteileichen", sondern
    // Namensschema- oder Watchlist-Bruch. Ohne diesen Stop waere das komplette Universum
    // still weg — die teuerste denkbare Variante eines leisen Fehlers.
    console.error(`::error::filter-snapshot-merge — ALLE ${gescannt} Snapshots gelten als nicht autorisiert (Watchlist ${watchlistPfad}: ${wl.stocks.length} Eintraege). Das ist ein Namensschema-/Watchlist-Bruch, keine Karteileichen-Lage. Stop.`);
    return 1;
  } else if (gescannt >= MIN_GESCANNT_FUER_ANTEIL && uebersprungen.length > MAX_UEBERSPRUNGEN_ANTEIL * gescannt) {
    // F-12-R2 (Review Tag 563): derselbe Fehler eine Stufe frueher. Ein Bruch, der nicht
    // gleich 100 % erwischt, hat bisher still das halbe Universum aus dem Artefakt genommen —
    // und die Boards haetten auf der Reststrecke ganz normal gerankt.
    const befund = `${uebersprungen.length} von ${gescannt} Snapshots nicht autorisiert (${(uebersprungen.length / gescannt * 100).toFixed(1)} %), ueber der Schwelle ${(MAX_UEBERSPRUNGEN_ANTEIL * 100).toFixed(0)} %. Der reale Karteileichen-Bestand liegt bei ~15 %; so viel auf einmal ist ein Namensschema-/Watchlist-Bruch, keine Karteileichen-Lage.`;
    // T565-M1: Ventil (s. DRIFT_VENTIL oben) — der Anteil ratcht monoton, ein legitimer
    // Karteileichen-Berg darf den Tageslauf nicht dauerhaft toeten. Befund bleibt sichtbar.
    // T569-F8: der Ventil-Wert ist die OBERGRENZE, nicht ein An/Aus (s. ventilObergrenze).
    const deckel = ventilObergrenze(process.env[DRIFT_VENTIL]);
    const istAnteil = uebersprungen.length / gescannt;
    if (deckel !== null && istAnteil <= deckel) {
      console.error(`::warning::filter-snapshot-merge — ${befund} ${DRIFT_VENTIL}=${process.env[DRIFT_VENTIL]} deckelt bis ${(deckel * 100).toFixed(0)} %: Lauf faehrt trotzdem weiter.`);
    } else {
      const zusatz = deckel === null
        ? `${DRIFT_VENTIL} auf die tolerierte Obergrenze setzen (Anteil 0..1, z. B. 0.35) — der Anteil ratcht monoton nach oben, weil nichts ausgetragen wird.`
        : `${DRIFT_VENTIL}=${process.env[DRIFT_VENTIL]} deckelt nur bis ${(deckel * 100).toFixed(0)} %, gemessen sind ${(istAnteil * 100).toFixed(1)} % — die Obergrenze bewusst neu setzen oder die Ursache suchen.`;
      console.error(`::error::filter-snapshot-merge — ${befund} Stop. (${zusatz})`);
      return 1;
    }
  }

  fs.mkdirSync(ziel, { recursive: true });
  for (const f of uebernehmen) fs.copyFileSync(path.join(eingang, f), path.join(ziel, f));
  schreibeEingangsZahl(ziel, gescannt); // F-12-R1: NACH dem Kopieren (das Manifest kommt aus dem Eingang mit)

  const anteil = gescannt > 0 ? (uebersprungen.length / gescannt * 100).toFixed(1) : '0.0';
  console.log(`[f12-filter] ${uebersprungen.length} von ${gescannt} Snapshots uebersprungen (kein Watchlist-Eintrag) = ${anteil} % — ${uebernehmen.length} Dateien nach ${ziel} uebernommen. Nichts geloescht: ${eingang} bleibt vollstaendig. Eingangs-Zahl fuer den Coverage-Floor: ${MANIFEST_EINGANG_FELD}=${gescannt}.`);
  return 0;
}

module.exports = { autorisierteDateinamen, teileEingang, run, MAX_UEBERSPRUNGEN_ANTEIL, MIN_GESCANNT_FUER_ANTEIL, MANIFEST_EINGANG_FELD, DRIFT_VENTIL, ventilObergrenze };
if (require.main === module) process.exit(run(process.argv));
