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
// U2-BO/NS (s. WURZEL_ZWILLING unten): der Emittenten-Schluessel wird IMPORTIERT, nie nachgebaut.
// Lesen aus src/scoring/** ist ausdruecklich erlaubt; das GQS-Siegel bindet nur AENDERUNGEN dort.
const { issuerKeyLoose } = require('../src/scoring/score.js');

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
const NAV_REGISTER_STANDARDPFAD = path.join(__dirname, '..', 'data-health', 'nav-holdings.json');

/**
 * U2-BO/NS (Orchestrator ENTSCHIED 21 vom 2026-08-29, Akte
 * `befund-doppelgaenger-2026-08-29.md` inkl. Addendum) — Wurzel-Zwillinge der beiden
 * indischen Boersen als EIN Emittent.
 *
 * BEFUND: 53 Emittenten-Gruppen standen am 29.08. mit BEIDEN Beinen im Board (107 Zeilen,
 * 54 ueberzaehlige Plaetze; 13 Gruppen mit beiden Beinen in den Top 100). 12 davon sind
 * BSE/NSE-Zwillinge: `KRN.BO` + `KRN.NS` ist eine Firma an zwei Boersen, aber die beiden
 * Feeds schreiben ihren Namen verschieden ("KRN Heat Exchanger and Refrigeration Limited"
 * gegen die NSE-Kurzform "KRN HEAT EXCHANGE N REF L"). Der Emittenten-Dedup gruppiert ueber
 * den NAMEN (`issuerKeyLoose`, `src/scoring/score.js:134`) — verschiedene Namen, also zwei
 * Zeilen.
 *
 * WARUM HIER UND NICHT IM DEDUP: `src/scoring/**` ist GQS-versiegelt. Der Namenskanal ist
 * der einzige unversiegelte Hebel, und dieses Skript ist die letzte Station, durch die JEDER
 * Snapshot vor dem Scoring laeuft (s. Modulkopf). Diese Vorstufe FUEHRT NICHT SELBST ZUSAMMEN
 * — sie gibt beiden Beinen denselben Emittenten-Namen und laesst danach den vorhandenen,
 * gepruefeten Dedup entscheiden. Damit bleiben Sieger-Regel (`issuerDedupComparator`) und
 * Fehlverschmelzungs-Schutz (`splitFalseIssuerMerges`) unveraendert zustaendig; hier wird kein
 * Bein geloescht und keine Zeile ausgewaehlt.
 *
 * BELEGLAGE (unabhaengig am Live-Bestand nachgemessen, Vintage 2026-08-29, 15.046 Snapshots):
 * 524 Wurzel-Zwillinge `.BO`/`.NS`; nach `issuerKeyLoose` bleiben nur eine Handvoll Paare
 * ueberhaupt getrennt, und die abweichenden Paare (JNPR, SKFINDUS, TARIL, TATAPOWER) sind
 * allesamt DIESELBE Firma — Platzhalter, Feed-Abkuerzung, Artikel. NULL Fremdpaare. Fuer die
 * beiden indischen Boersen ist die Wurzel-Identitaet eine Tatsache der Boersen, keine Heuristik.
 *
 * BEWUSST NUR `.BO`/`.NS`. Die naheliegende Verallgemeinerung "gleiche Wurzel + irgendein
 * Boersensuffix" ist NICHT gemessen und wird hier NICHT gebaut. Der Mailaender Spiegel
 * (`1XXX.MI`) traegt das HEIMATMARKT-Kuerzel und liefert 28 belegte Fremdpaare
 * (`1SAN.MI` Sanofi gegen `SAN` Banco Santander, `1MRK.MI` Merck KGaA gegen `MRK` Merck & Co.).
 * Er ist ein PRAEFIX und faellt durch die Suffix-Regel unten ohnehin heraus; er bleibt laut
 * ENTSCHIED 21 Punkt 3 dem Gericht vorbehalten. Eine Fehlverschmelzung LOESCHT eine echte Firma
 * aus dem Board — eine ausbleibende Verschmelzung kostet nur einen Platz.
 */
const WURZEL_ZWILLING = /^(.+)\.(BO|NS)$/;

/**
 * "Kein Name" heisst hier auch: der Name IST nur die Kennung (Platzhalter aus
 * `pull-yahoo.js`, wenn Yahoo weder `longName` noch `shortName` liefert). Gleiche Bauform und
 * gleicher Grund wie `platzhalter()` in `refresh-universe.js:883-887`, nur eine Ebene tiefer:
 * dort ueber die Watchlist-Zeilen EINES Symbols, hier ueber die beiden Beine EINES Emittenten.
 */
function istPlatzhalter(name, ...kennungen) {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n) return true;
  return kennungen.some((k) => k && String(k).trim().toUpperCase() === n.toUpperCase());
}

/**
 * Welcher der beiden Namen gilt fuer beide Beine. Rangfolge, an den 44 real abweichenden
 * Paaren des Live-Bestands geprueft:
 *   1. Platzhalter verliert immer      (`JNPR.BO` "JNPR.BO" gegen "Juniper Green Energy Limited")
 *   2. sonst der LAENGERE Name         (BSE schneidet bei 30 Zeichen ab, NSE kuerzt auf ~25 mit
 *                                       "N" fuer "and" und "L" fuer "Limited" — laenger ist
 *                                       durchgehend der vollstaendigere: "Transformers and
 *                                       Rectifiers (India) Limited" gegen "TRANS & RECTI. LTD")
 *   3. Gleichstand: Code-Unit-Vergleich. Locale-frei aus demselben Grund wie `cmpTicker`
 *      (`score.js`): `localeCompare` haengt an der OS-Locale und wuerde CI gegen lokal
 *      auseinanderlaufen lassen. Erreichbar nur bei gleich langen, verschiedenen Namen —
 *      gleiche Namen kommen wegen der Schluessel-Vorpruefung gar nicht bis hierher.
 */
function besseresBein(a, b) {
  const rang = (s) => (istPlatzhalter(s.name, s.ticker, s.metaTicker) ? 0 : 1);
  if (rang(a) !== rang(b)) return rang(a) > rang(b) ? a : b;
  const la = String(a.name || '').length;
  const lb = String(b.name || '').length;
  if (la !== lb) return la > lb ? a : b;
  return String(a.name) <= String(b.name) ? a : b;
}

/**
 * Reiner Kern (kein I/O): Staende -> Map<Datei, neuer Name>. Nur VERLIERER-Beine stehen drin,
 * und nur dann, wenn der Dedup sie heute wirklich NICHT zusammenfuehrt.
 *
 * `issuerKeyLoose` wird aus `src/scoring/score.js` IMPORTIERT, nicht nachgebaut. Lesen von
 * `src/scoring/**` ist ausdruecklich erlaubt (Orchestrator-Entscheid 2026-08-29 13:15; das
 * Siegel bindet Aenderungen, nicht Lesen), und ein Nachbau des Schluessels ist der bekannte
 * Fehler F1334: die Vorstufe wuerde gegen eine ANDERE Regel messen als die, die anschliessend
 * gruppiert, und damit entweder umsonst umbenennen oder Faelle uebersehen.
 *
 * Beide Wachrichtungen sind Vertrag und in `tests/u2-wurzelzwillinge.test.js` festgenagelt:
 *   - ein `.BO`/`.NS`-Zwillingspaar mit abweichenden Namen WIRD vereinheitlicht,
 *   - alles ohne gemeinsame Wurzel (und jedes andere Suffix) wird NIE angefasst.
 */
function wurzelZwillingsUmbenennungen(staende) {
  const nachWurzel = new Map();
  for (const s of staende || []) {
    const m = WURZEL_ZWILLING.exec(s.ticker);
    if (!m) continue;
    if (!nachWurzel.has(m[1])) nachWurzel.set(m[1], new Map());
    // Ein doppelt geliefertes Suffix (kann es ueber Dateinamen nicht geben) wuerde still das
    // zweite gewinnen lassen — deshalb nur den ERSTEN Stand je Suffix nehmen.
    if (!nachWurzel.get(m[1]).has(m[2])) nachWurzel.get(m[1]).set(m[2], s);
  }
  const umbenennungen = new Map();
  for (const beine of nachWurzel.values()) {
    const bo = beine.get('BO');
    const ns = beine.get('NS');
    if (!bo || !ns) continue; // kein Zwilling: ein einzelnes .BO oder .NS bleibt unberuehrt
    if (issuerKeyLoose({ meta: { name: bo.name } }) === issuerKeyLoose({ meta: { name: ns.name } })) continue;
    const sieger = besseresBein(bo, ns);
    const verlierer = sieger === bo ? ns : bo;
    // Beide Beine ohne brauchbaren Namen: es gibt nichts zu uebertragen. Ein Platzhalter auf
    // BEIDEN Seiten bleibt ein Platzhalter — geraten wird hier nichts.
    if (istPlatzhalter(sieger.name, sieger.ticker, sieger.metaTicker)) continue;
    umbenennungen.set(verlierer.datei, sieger.name);
  }
  return umbenennungen;
}

/**
 * I/O-Mantel: liest NUR die Zwillings-Kandidaten (ca. 1.000 von 15.000 Dateien) und schreibt
 * nur die wenigen Verlierer-Beine zurueck — atomar wie jeder andere Schreiber hier.
 *
 * Eine unlesbare Datei ist KEIN Abbruch: dieser Schritt ist im Tageslauf vorgeschaltet, und
 * ein einzelner kaputter Snapshot darf die Pipeline nicht toeten. Sie faellt aber laut auf,
 * statt still zu einer ausbleibenden Vereinheitlichung zu werden.
 */
function wendeWurzelZwillingeAn(ziel, dateien) {
  const staende = [];
  let unlesbar = 0;
  for (const f of dateien) {
    if (!f.endsWith('.json') || isMetadataSnapshot(f)) continue;
    const ticker = f.slice(0, -'.json'.length);
    if (!WURZEL_ZWILLING.test(ticker)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ziel, f), 'utf8'));
      staende.push({ datei: f, ticker, metaTicker: j && j.meta && j.meta.ticker, name: j && j.meta && j.meta.name });
    } catch (e) {
      unlesbar++;
      console.error(`::warning::U2-Wurzelzwillinge — ${f} nicht lesbar (${e.message}); dieses Bein nimmt nicht teil.`);
    }
  }
  const umbenennungen = wurzelZwillingsUmbenennungen(staende);
  const geheilt = [];
  for (const [datei, neuerName] of umbenennungen) {
    const p = path.join(ziel, datei);
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!j || typeof j !== 'object' || !j.meta) throw new Error('kein meta-Block');
      j.meta.name = neuerName;
      writeFileAtomic(p, JSON.stringify(j));
      geheilt.push(datei.slice(0, -'.json'.length));
    } catch (e) {
      unlesbar++;
      console.error(`::warning::U2-Wurzelzwillinge — ${datei} nicht schreibbar (${e.message}); Bein bleibt getrennt.`);
    }
  }
  return { kandidaten: staende.length, geheilt: geheilt.sort(), unlesbar };
}

function ladeNavRegister(registerPfad) {
  let eintraege;
  try { eintraege = JSON.parse(fs.readFileSync(registerPfad, 'utf8')); }
  catch (e) { throw new Error(`${registerPfad}: ${e.message}`); }
  if (!Array.isArray(eintraege)) throw new Error(`${registerPfad}: Wurzel muss ein Array sein`);
  const tickers = new Set();
  // T612-L1 (Review Tag 612): die Dublette wird auf DATEINAMEN-Ebene gesucht, nicht auf der
  // Rohstring-Ebene. safeSnapshotFilename faltet (Grossschreibung, [^A-Z0-9.-] -> _), also
  // sind 'nflx' und 'NFLX' zwei verschiedene Rohstrings fuer EINE Datei — ein Register-Fehler,
  // der als "zwei Eintraege" durchging und beim Pflegen die zweite Begruendung verstecken wuerde.
  const dateinamen = new Map();
  for (const [i, e] of eintraege.entries()) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error(`${registerPfad}: Eintrag ${i} ist kein Objekt`);
    for (const feld of ['ticker', 'grund', 'beleg', 'aufgenommen']) {
      if (typeof e[feld] !== 'string' || !e[feld].trim()) throw new Error(`${registerPfad}: Eintrag ${i}, Feld ${feld} fehlt/ist leer`);
    }
    const ticker = e.ticker.trim();
    if (tickers.has(ticker)) throw new Error(`${registerPfad}: Ticker ${ticker} ist doppelt`);
    tickers.add(ticker);
    // Ein Ticker ohne ableitbaren Dateinamen wird hier NICHT gemeldet: run() rechnet gleich
    // danach dieselbe Abbildung und stoppt mit der spezifischen "unbrauchbarer Ticker"-Diagnose.
    let datei = null;
    try { datei = safeSnapshotFilename(ticker); } catch (_) { /* s. o. — run() meldet den Fall */ }
    if (datei === null) continue;
    if (dateinamen.has(datei)) {
      throw new Error(`${registerPfad}: Ticker ${ticker} und ${dateinamen.get(datei)} zeigen auf dieselbe Snapshot-Datei ${datei}`);
    }
    dateinamen.set(datei, ticker);
  }
  return tickers;
}

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
function teileEingang(files, erlaubt, navDateinamen = new Set()) {
  const uebernehmen = [], uebersprungen = [], navAusgeschlossen = [];
  let gescannt = 0;
  for (const f of files) {
    if (!f.endsWith('.json') || isMetadataSnapshot(f)) { uebernehmen.push(f); continue; }
    gescannt++;
    if (navDateinamen.has(f)) navAusgeschlossen.push(f);
    else if (erlaubt.has(f)) uebernehmen.push(f); else uebersprungen.push(f);
  }
  return { uebernehmen, uebersprungen, navAusgeschlossen, gescannt };
}

function run(argv) {
  const get = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
  const eingang = get('--eingang', 'snapshots-eingang');
  const ziel = get('--ziel', 'snapshots');
  const watchlistPfad = get('--watchlist', 'watchlist.json');
  const navRegisterPfad = get('--nav-register', NAV_REGISTER_STANDARDPFAD);

  let navTickers;
  try { navTickers = ladeNavRegister(navRegisterPfad); }
  catch (e) {
    console.error(`::error::filter-snapshot-merge — NAV-Register nicht ladbar (${e.message}). Abbruch statt lautlosem Scoring ohne Ausschlussliste.`);
    return 1;
  }
  // Dateiname -> Ticker (statt nur einer Namensmenge): teileEingang braucht nur `.has`, die
  // Treffer-Wache (T612-M1) braucht zur Meldung den Ticker zurueck. Die Abbildung ist dank der
  // Dateinamen-Dublettenpruefung in ladeNavRegister eindeutig.
  let navDateinamen;
  try { navDateinamen = new Map([...navTickers].map((t) => [safeSnapshotFilename(t), t])); }
  catch (e) {
    console.error(`::error::filter-snapshot-merge — NAV-Register enthaelt unbrauchbaren Ticker (${e.message}). Abbruch statt Teilfilterung.`);
    return 1;
  }

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

  const { uebernehmen, uebersprungen, navAusgeschlossen, gescannt } = teileEingang(files, erlaubt, navDateinamen);

  // T612-M1 (Review Tag 612): ein Register-Eintrag, zu dem gar keine Datei im Eingang liegt, war
  // still wirkungslos — ein Tippfehler (oder ein delisteter/umbenannter Name) haette das Register
  // dauerhaft leerlaufen lassen, ohne dass es irgendwo auffaellt. Kein Hardstop: der Zustand ist
  // beim Delisting legitim, und ein toter Eintrag schadet nichts ausser seiner eigenen Wirkung.
  // Nur "Datei gar nicht im Eingang" ist der Warnfall — ein Treffer, der ausgeschlossen wurde,
  // ist genau der Normalbetrieb.
  const imEingang = new Set(files);
  for (const [datei, ticker] of navDateinamen) {
    if (!imEingang.has(datei)) {
      console.error(`::warning::NAV-Register: ${ticker} hatte keinen Treffer im Eingang (delisted/umbenannt/Tippfehler?)`);
    }
  }

  // T612-H1 (Review Tag 612): die Wachen unten rechnen ueber die um die Register-Treffer
  // BEREINIGTE Population. NAV-Ausschluesse zaehlen in `gescannt`, landen aber nie in
  // `uebersprungen` — mit `gescannt` als Nenner war `uebersprungen === gescannt` ab dem ersten
  // Register-Treffer im Eingang unerreichbar, und der ALL-Stop (der teuerste Wachhund im Skript:
  // Namensschema-/Watchlist-Bruch, komplettes Universum still weg) war dauerhaft ausgeknipst.
  // `gescannt` bleibt die Zahl fuer den Coverage-Floor (schreibeEingangsZahl weiter unten) —
  // der zaehlt bewusst den vollen Eingang, nicht die Pruef-Population.
  const zuPruefen = gescannt - navAusgeschlossen.length;

  // 0 gescannte Snapshots ist ein eigener Befund: entweder ein Kaltstart ohne jeden
  // Shard-Cache oder ein leerer Download. Kein harter Stop (der Zustand ist legitim und
  // wird flussabwaerts vom Coverage-Gate als degradiert/katastrophal gefangen), aber
  // niemals still.
  if (gescannt === 0) {
    console.error(`::warning::filter-snapshot-merge — 0 Snapshots im Eingang ${eingang} gescannt (${files.length} Eintraege insgesamt). Kein Shard hat Snapshots geliefert; das Coverage-Gate entscheidet ueber den Lauf.`);
  } else if (zuPruefen > 0 && uebersprungen.length === zuPruefen) {
    // Jeder einzelne Snapshot unautorisiert heisst nicht "alles Karteileichen", sondern
    // Namensschema- oder Watchlist-Bruch. Ohne diesen Stop waere das komplette Universum
    // still weg — die teuerste denkbare Variante eines leisen Fehlers.
    console.error(`::error::filter-snapshot-merge — ALLE ${zuPruefen} Snapshots gelten als nicht autorisiert (Watchlist ${watchlistPfad}: ${wl.stocks.length} Eintraege). Das ist ein Namensschema-/Watchlist-Bruch, keine Karteileichen-Lage. Stop.`);
    return 1;
  } else if (zuPruefen >= MIN_GESCANNT_FUER_ANTEIL && uebersprungen.length > MAX_UEBERSPRUNGEN_ANTEIL * zuPruefen) {
    // F-12-R2 (Review Tag 563): derselbe Fehler eine Stufe frueher. Ein Bruch, der nicht
    // gleich 100 % erwischt, hat bisher still das halbe Universum aus dem Artefakt genommen —
    // und die Boards haetten auf der Reststrecke ganz normal gerankt.
    const befund = `${uebersprungen.length} von ${zuPruefen} Snapshots nicht autorisiert (${(uebersprungen.length / zuPruefen * 100).toFixed(1)} %), ueber der Schwelle ${(MAX_UEBERSPRUNGEN_ANTEIL * 100).toFixed(0)} %. Der reale Karteileichen-Bestand liegt bei ~15 %; so viel auf einmal ist ein Namensschema-/Watchlist-Bruch, keine Karteileichen-Lage.`;
    // T565-M1: Ventil (s. DRIFT_VENTIL oben) — der Anteil ratcht monoton, ein legitimer
    // Karteileichen-Berg darf den Tageslauf nicht dauerhaft toeten. Befund bleibt sichtbar.
    // T569-F8: der Ventil-Wert ist die OBERGRENZE, nicht ein An/Aus (s. ventilObergrenze).
    const deckel = ventilObergrenze(process.env[DRIFT_VENTIL]);
    const istAnteil = uebersprungen.length / zuPruefen;
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

  // U2-BO/NS: NACH dem Kopieren, damit der Eingang unangetastet bleibt (Karl-Entscheid F-12:
  // filtern statt loeschen — hier entsprechend: nur die Arbeitskopie bekommt den Namen).
  const zwillinge = wendeWurzelZwillingeAn(ziel, uebernehmen);
  console.log(`[u2-wurzelzwillinge] ${zwillinge.geheilt.length} von ${zwillinge.kandidaten} .BO/.NS-Beinen auf den Emittenten-Namen des Zwillings gesetzt${zwillinge.geheilt.length ? ` (${zwillinge.geheilt.join(', ')})` : ''}. Zusammengefuehrt wird weiterhin ausschliesslich im Dedup (issuerKeyLoose + splitFalseIssuerMerges); hier wird kein Bein entfernt.`);

  const navTickerListe = navAusgeschlossen.map((f) => f.slice(0, -'.json'.length)).sort();
  console.log(`NAV-Register: ${navTickerListe.length} Namen vom Scoring ausgeschlossen (${navTickerListe.join(', ')})`);
  const anteil = gescannt > 0 ? (uebersprungen.length / gescannt * 100).toFixed(1) : '0.0';
  console.log(`[f12-filter] ${uebersprungen.length} von ${gescannt} Snapshots uebersprungen (kein Watchlist-Eintrag) = ${anteil} % — ${uebernehmen.length} Dateien nach ${ziel} uebernommen. Nichts geloescht: ${eingang} bleibt vollstaendig. Eingangs-Zahl fuer den Coverage-Floor: ${MANIFEST_EINGANG_FELD}=${gescannt}.`);
  return 0;
}

module.exports = { autorisierteDateinamen, ladeNavRegister, teileEingang, run, MAX_UEBERSPRUNGEN_ANTEIL, MIN_GESCANNT_FUER_ANTEIL, MANIFEST_EINGANG_FELD, DRIFT_VENTIL, ventilObergrenze,
  // U2-BO/NS (ENTSCHIED 21) — fuer TDD. Waechter: tests/u2-wurzelzwillinge.test.js
  istPlatzhalter, besseresBein, wurzelZwillingsUmbenennungen, wendeWurzelZwillingeAn, WURZEL_ZWILLING };
if (require.main === module) process.exit(run(process.argv));
