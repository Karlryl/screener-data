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
// U3-Milan (s. MILAN_KANDIDATEN unten) braucht zusaetzlich den STRENGEN Schluessel und den
// Listing-Test — beide ebenfalls importiert (Auflage A3 des Urteils, Nachbau-Fehler F1334).
// M10/M1 (s. unten) braucht zusaetzlich die PRODUKTIONS-Gruppierung und den PRODUKTIONS-
// Sieger-Vergleich. Beide werden IMPORTIERT und ausschliesslich GELESEN — ein Nachbau waere
// F1334 ein zweites Mal, und eine Aenderung dort ist unter N8 verboten (Urteil M7).
const { issuerKeyLoose, issuerKeyStrengOhneGattung, issuerDedupGroups, issuerDedupComparator } = require('../src/scoring/score.js');
const { isUsPrimaryListing } = require('../src/scoring/router.js');

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
 *
 * ══════════════════════════════════════════════════════════════════════════════════════
 * ⚠ M6 — BAUFORM-VORENTSCHEID FUER DIE KUENFTIGE G2-ENTSCHEIDUNG. OHNE VOLLZUG.
 * `_COURT-M10-2026-08-30.md` (ENTSCHIED 126), Auflage M6. HEUTE WIRD HIER NICHTS GEAENDERT —
 * dieser Block ist Dokumentation, kein Bau. Er steht hier und nicht in einem Urteil, weil der
 * naechste Bauende HIER hinsieht.
 *
 * FAELLT die G2-Entscheidung, lautet sie: ein HERKUNFTS-KRITERIUM IN DIESER FUNKTION — bei
 * gleichem Platzhalter-Rang schlaegt ein Bein mit `nameSource !== 'watchlist'` eines mit
 * `'watchlist'`. Ausdruecklich NICHT das Abschalten des Schreibers weiter unten
 * (`wendeWurzelZwillingeAn`): der ist die RATIFIZIERTE U2-Heilung (ENTSCHIED 21), nicht der
 * allgemeine Aufpraege-Kanal, den die Akte dort vermutete (Urteil §3 K-4). Der zweite
 * Schreiber (`milanSchreiben`, U3-Milan) ist N1 und unantastbar.
 *
 * WARUM DIE FRAGE UEBERHAUPT AN DIESER FUNKTION HAENGT: `besseresBein` kennt die HERKUNFT des
 * Namens nicht. Ein Watchlist-Name kann hier gewinnen und eine Verschmelzung ERZWINGEN — der
 * Befund der Akte gilt, nur schmaler als dort beschrieben (nur `.BO`/`.NS`-Zwillinge, nur wo
 * `issuerKeyLoose` heute noch verschieden ist).
 *
 * AUSLOESUNG AUSSCHLIESSLICH durch die M1-Messung (data-health/namensherkunft-history.json)
 * plus Orchestrator-Entscheid. Die Schwellen sind im Urteil §8 VORAB festgelegt und duerfen
 * NICHT nachtraeglich ans Ergebnis angepasst werden:
 *   Bucket `fehlt` <= 5 %                      ⇒ die echte Klassengroesse liegt ueberhaupt vor
 *   watchlist-benannte Sieger deutlich > ~500  ⇒ M6 wird vollzogen
 *   unter ~1.500                               ⇒ G2 sinkt endgueltig auf ein Einzelfall-Ventil
 * Vorzeitig: tritt ein ZWEITER belegter Fall der `MRK.SW`-Klasse auf, wird M6 sofort und ohne
 * die volle Messung gezogen.
 *
 * IM EREIGNISFALL gehoert dazu ein DRITTER Fall in `tests/u2-wurzelzwillinge.test.js` — ein
 * WL-benanntes Bein verliert gegen ein feed-benanntes bei gleichem Platzhalter-Rang —, einmal
 * absichtlich gebrochen, und beide bestehenden Wachrichtungen bleiben gruen.
 *
 * ⛔ M7 — G2-a WIRD NICHT VOLLZOGEN UND IST IN DIESER VORSTUFE NICHT VOLLZIEHBAR.
 * Befund K-3 des Urteils, am Code gelesen: `issuerDedupComparator` (`src/scoring/score.js`)
 * sortiert nach US-Primaerlisting, US-Domizil, FX-Verdacht, Marktkapitalisierung und Ticker.
 * KEIN NAMENSBEZUG. Der Name wirkt ausschliesslich ueber `issuerKeyLoose` auf die
 * GRUPPENBILDUNG: er entscheidet die ZUGEHOERIGKEIT, nie den SIEG. `MRK.SW` gewann seine
 * Gruppe wegen der fremden Marktkapitalisierung, nicht wegen des fremden Namens — der Name
 * hat die Zeile nur HINEINGETRAGEN.
 * Folge: wer ein Bein am SIEGEN hindern will, braucht entweder den versiegelten Komparator
 * (N8) oder eine Namens-Ueberschreibung (G7-a, 3:0 dauerhaft verboten). Beide Wege sind zu.
 * WER ES DENNOCH VORBEREITET: STOPP, zurueck ans Gericht.
 * Die Zahl „984 Sieger / 1.254 Beine" ist eine BESCHREIBUNG, kein Hebel — sie beschreibt, wer
 * gewonnen hat, nicht warum. Sie darf in keiner kuenftigen Vorlage als Preisschild fuer G2-a
 * auftreten. Waechter fuer die Premisse: tests/m10-namensherkunft-zaehler.test.js.
 * ══════════════════════════════════════════════════════════════════════════════════════
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
function wurzelZwillingsUmbenennungen(staende, protokoll) {
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
    // M10/M5 (Interims-Protokoll, _COURT-M10-2026-08-30): OPTIONALE Mitschrift, damit der
    // Rueckgabewert derselbe Map-Vertrag bleibt, den tests/u2-wurzelzwillinge.test.js pinnt.
    // Rein beobachtend: keine Umbenennung unterbleibt, keine zusaetzliche kommt hinzu.
    if (Array.isArray(protokoll)) {
      protokoll.push({
        kanal: 'U2-Wurzelzwillinge', datei: verlierer.datei, verlierer: verlierer.ticker,
        sieger: sieger.ticker, name: sieger.name, quelleHerkunft: sieger.nameSource,
      });
    }
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
  // Getrennt gezaehlt: ein Bein, das nicht GELESEN werden konnte, nimmt gar nicht erst
  // teil; eines, das nicht GESCHRIEBEN werden konnte, war ausgewaehlt und blieb trotzdem
  // getrennt. Ein gemeinsamer Zaehler haette beide Lagen als eine Zahl ausgegeben.
  let unlesbar = 0;
  let unschreibbar = 0;
  for (const f of dateien) {
    if (!f.endsWith('.json') || isMetadataSnapshot(f)) continue;
    const ticker = f.slice(0, -'.json'.length);
    if (!WURZEL_ZWILLING.test(ticker)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ziel, f), 'utf8'));
      // `nameSource` NUR fuer das M5-Protokoll mitgelesen — es geht in keine Auswahl ein
      // (`besseresBein` kennt es nicht; die Bauform-Vorentscheidung M6 ist NICHT vollzogen).
      staende.push({ datei: f, ticker, metaTicker: j && j.meta && j.meta.ticker, name: j && j.meta && j.meta.name,
        nameSource: j && j.meta && j.meta.nameSource });
    } catch (e) {
      unlesbar++;
      console.error(`::warning::U2-Wurzelzwillinge — ${f} nicht lesbar (${e.message}); dieses Bein nimmt nicht teil.`);
    }
  }
  const protokoll = [];
  const umbenennungen = wurzelZwillingsUmbenennungen(staende, protokoll);
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
      unschreibbar++;
      console.error(`::warning::U2-Wurzelzwillinge — ${datei} nicht schreibbar (${e.message}); Bein bleibt getrennt.`);
    }
  }
  // M5: nur die WIRKLICH geschriebenen Umbenennungen stehen im Protokoll — ein Bein, das
  // unschreibbar blieb, wurde nicht umbenannt und darf die Zaehlung nicht aufblaehen.
  const geschriebeneDateien = new Set(geheilt.map((t) => t + '.json'));
  return { kandidaten: staende.length, geheilt: geheilt.sort(), unlesbar, unschreibbar,
    protokoll: protokoll.filter((p) => geschriebeneDateien.has(p.datei)) };
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 * U3-MILAN — der Mailaender Spiegel, freigegeben mit elf Auflagen
 * Urteil: `_COURT-MILAN-U3-2026-08-29.md` (K1 3/3 FREIGABE-MIT-AUFLAGEN), ratifiziert als
 * ENTSCHIED 31. Akte: `richter-milan-u3-20260829-akte.md`.
 *
 * BAUFORM WIE PR #92: diese Vorstufe MERGED NICHTS. Sie praegt den Beinen EINES Emittenten
 * denselben Namen auf und laesst den versiegelten Dedup entscheiden (`issuerKeyLoose` +
 * `issuerDedupComparator` + `splitFalseIssuerMerges`). Kein Bein wird geloescht, keine Zeile
 * ausgewaehlt. Alle Schluessel sind IMPORTIERT, keiner nachgebaut (F1334).
 *
 * WARUM DAS HIER GEFAEHRLICHER IST ALS .BO/.NS: das Mailaender `1`-Praefix traegt das
 * HEIMATMARKT-Kuerzel, nicht das US-Kuerzel. `1SAN.MI` ist Sanofi, `SAN` ist Banco Santander;
 * ≥ 29 solcher Fremdpaare sind belegt (Urteil T12/T13). Eine naive Wurzel-Regel wuerde sie
 * verschmelzen und damit eine echte Firma aus dem Board LOESCHEN. Deshalb entscheidet hier
 * NICHT der Ticker, sondern eine Fundamentaldaten-Gegenprobe mit drei weiteren Riegeln.
 *
 * ⚠ ZWEI BEFUNDE DES GERICHTS, DIE DIE BAUFORM BESTIMMEN:
 *   (i) `splitFalseIssuerMerges` (`score.js:264-277`) teilt ueber `issuerKeyStrengOhneGattung`
 *       (`score.js:257-263`) — und der liest DENSELBEN `meta.name` wie der lose Schluessel.
 *       Eine Vorstufe, die Namen vereinheitlicht, macht auch die strengen Schluessel gleich und
 *       hebelt den Schutz aus (T4). Er darf deshalb NICHT als Sicherung eingeplant werden.
 *  (ii) Fuer Milan-Paare feuert er ohnehin nie: er verlangt ≥ 2 US-Primaerlistings, und das
 *       Mailaender Bein ist keins (T2/T3).
 *   FOLGE (Auflage A2): der GESAMTE Fehlverschmelzungs-Schutz liegt HIER, VOR der Namensmutation.
 *
 * DIE ELF AUFLAGEN, UND WO SIE STEHEN:
 *   A1  Wertgleichheit `timeseries.revenueQ` UND `timeseries.grossProfitQ`, keine Toleranz,
 *       ≥ 4 endliche Quartale ≠ 0 auf JEDEM Bein ....................... milanTor(), Stufe 2+3
 *   A2  Schutz VOR der Mutation, nicht im versiegelten Kern ............ diese ganze Datei
 *   A3  US-Primaer-Abstinenz: ≥ 2 US-Primaerlistings mit VERSCHIEDENEN urspruenglichen
 *       strengen Namensschluesseln ⇒ ganze Klasse verworfen ............ milanTor(), Stufe 6
 *   A4  zweite unabhaengige Achse, Pflicht: gleiches nicht-leeres `meta.country`
 *       UND `sharesOutstanding` im 20-%-Band ......................... milanTor(), Stufe 4+5
 *   A5  1:1 — kein zweites Mailaender Bein auf demselben Fingerabdruck . milanTor(), Stufe 7
 *   A6  eingefrorene Kandidatenliste .................................. MILAN_KANDIDATEN
 *   A7  Mengen-Riegel, harter Abbruch bei Abweichung .................. run(), MILAN_ERWARTET_*
 *   A8  Waechter am Objekt, beide Richtungen ......................... tests/u3-milan-spiegel.test.js
 *   A9  Messebene `snapshot.timeseries`, NICHT `pit.*` ................ milanReihe()
 *   A10 Laufzeit-Ausweis: jede Umbenennung mit BEIDEN Tickern geloggt .. run()
 *   A11 Milan-Praefix ONLY — ein allgemeines Fingerabdruck-Tor ueber alle Suffixe ist mit
 *       diesem Urteil NICHT freigegeben (2:1) und braucht Voll-Zensus + eigenes Gericht.
 *       Der Zensus als reines Messskript: `scripts/probe-fingerprint-zensus.js`.
 * ══════════════════════════════════════════════════════════════════════════════════════ */

/** Das Mailaender Spiegel-Praefix. Anker jeder Kandidatenklasse; A11 haengt daran. */
const MILAN_SPIEGEL = /^1(.+)\.MI$/;

/** A1: die Pflicht-Auflage aus `scripts/probe-dedup-fingerprint.js:24-30`, wortgleich uebernommen.
 *  Ohne sie verschmelzen die Pre-Revenue-Zeilen (alle Reihen leer, also alle "identisch") zu
 *  Scheingruppen — am Vintage 2026-07-14 mit 183, 70 und 8 fremden Firmen gemessen. */
const MILAN_MIN_QUARTALE = 4;

/** A4, zweite Achse: gemessener Abstand der Aktienzahl. `AVB`/`VMRK` (bytegleiche Reihen, beide
 *  NYSE, beide `country=United States`) liegen bei 0,642 und werden dadurch geblockt; alle 17
 *  Kandidatenklassen liegen bei 0,000 bis 0,0047 (`1RSG.MI`/`RSG` ist die weiteste). Die
 *  strengere Fassung "exakt gleiche Aktienzahl" scheidet aus: sie wuerde `1RSG.MI` verwerfen und
 *  damit den vom Urteil verlangten Mengen-Riegel 18/17 unerreichbar machen. */
const MILAN_SHARES_BAND = 0.20;

/**
 * A6 — DIE EINGEFRORENE KANDIDATENLISTE.
 *
 * WARUM SIE EXISTIERT, obwohl das Repo Handlisten an Identitaets-Entscheidungen ablehnt
 * (`score.js:82-88`): sie ENTSCHEIDET keine Identitaet, sie BEGRENZT nur die Reichweite. Jeder
 * Eintrag muss trotzdem das volle gemessene Tor bestehen (A1/A3/A4/A5); die Liste kann nie eine
 * Verschmelzung ERZEUGEN, nur eine verhindern. Ihre Fehlerrichtung ist damit ausschliesslich die
 * harmlose (ein Platz bleibt doppelt), nie die teure (eine Firma verschwindet).
 *
 * WARUM SIE NOETIG IST — nachgemessen am Live-Bestand (15.040 Snapshots, Vintage 2026-08-29,
 * `snapshot.timeseries`-Ebene): der Fingerabdruck-Index findet **47** Klassen, die ein
 * Mailaender Bein enthalten UND divergente `issuerKeyLoose` tragen — nicht 17. Vier davon sind
 * XETRA-Kurzform-Paare (`ANL.DE`/`ADI`, `D2MN.DE`/`DUK`, `KMI.VI`/`KMI`, `PRLD.VI`/`PLD`), also
 * die Klasse T179, die das Gericht ausdruecklich NICHT verhandelt hat (§5(c) c2/c5). Ohne diese
 * Liste raeumte der Lauf 8 statt 4 Top-100-Plaetze — was §6.4 des Urteils als FEHLERSIGNAL
 * fuehrt, nicht als Bonus. Die Diskrepanz 17 (Board) vs. 47 (Bestand) vs. 88 (J2-Zensus) ist
 * ratspflichtig und ungeklaert; bis dahin ist diese Liste laut A6 der Notriegel.
 *
 * HERKUNFT DER 17 EINTRAEGE: `befund-doppelgaenger-2026-08-29.md` §5, Zeilen 132-181 — genau die
 * Gruppen, die am 29.08. mit beiden Beinen im SELBEN Board standen. Der Board-Rang steht als
 * Beleg dabei; die vier Top-100-Faelle sind markiert.
 */
const MILAN_KANDIDATEN = [
  { anker: '1ANE.MI',  partner: ['ANE.MC'],           beleg: 'utilities 9+10 (Top 100)' },
  { anker: '1CRCL.MI', partner: ['CRCL'],             beleg: 'financials/unprofitable 12+13 (Top 100)' },
  { anker: '1FWON.MI', partner: ['FWONK'],            beleg: 'software-comm-services 12+13 (Top 100)' },
  { anker: '1NLOK.MI', partner: ['GEN'],              beleg: 'software-comm-services 19+20 (Top 100)' },
  { anker: '1EXC.MI',  partner: ['EXC'],              beleg: 'utilities 116+117' },
  { anker: '1CLNX.MI', partner: ['472.DE'],           beleg: 'real-estate 186+187' },
  { anker: '1SO.MI',   partner: ['SO'],               beleg: 'utilities 205+206' },
  { anker: '1MO.MI',   partner: ['MO'],               beleg: 'consumer-staples 207+208' },
  { anker: '1MDT.MI',  partner: ['MDT'],              beleg: 'health-care 215+216' },
  { anker: '1EIX.MI',  partner: ['EIX'],              beleg: 'utilities 223+224' },
  { anker: '1MTZ.MI',  partner: ['MTZ'],              beleg: 'industrials 292+293' },
  { anker: '1BEI.MI',  partner: ['BEI.DE', 'BEI.SW'], beleg: 'consumer-staples 333+334+335 (Dreibein)' },
  { anker: '1ALC.MI',  partner: ['ALC'],              beleg: 'health-care 414+415' },
  { anker: '1HII.MI',  partner: ['HII'],              beleg: 'industrials 626+627' },
  { anker: '1JCI.MI',  partner: ['JCI'],              beleg: 'industrials 780+781' },
  { anker: '1GEBN.MI', partner: ['GBRA.DE'],          beleg: 'industrials 873+874' },
  { anker: '1RSG.MI',  partner: ['RSG'],              beleg: 'industrials 1279+1280' },
];

/**
 * A7 — DER MENGEN-RIEGEL (2:1-Mehrheitsentscheid; J2s Sondervotum "nur ::warning::" ist
 * ueberstimmt). Am Live-Bestand vom 29.08. gemessen: 16 Klassen mit je einem Verlierer-Bein plus
 * `1BEI.MI` mit zweien = 18 umbenannte Beine, 17 kollabierte Gruppen.
 *
 * ⚠ DIESE ZAHL IST EIN STOLPERDRAHT, KEIN GLEICHGEWICHT. Die Population ist Wetter (Urteil T19:
 * 133 → 53 Doppelgaenger-Gruppen in zwei Wochen ohne einen einzigen Fix). Liefert Yahoo fuer
 * eines der elf Platzhalter-Beine (`GEN`, `EXC`, `SO`, `MO`, `MDT`, `EIX`, `MTZ`, `BEI.DE`,
 * `HII`, `JCI`, `RSG`) beim naechsten Zug einen Klarnamen, faellt die Zahl auf 17 und DIESER
 * LAUF BRICHT AB. Das ist die vom Gericht gewollte Wirkung: die Kandidatenliste soll neu
 * vorgelegt werden, statt still zu driften. Wer den Abbruch sieht, misst nach
 * (`node scripts/probe-fingerprint-zensus.js`) und legt die Liste neu vor — er dreht NICHT die
 * Zahl hoch. Das Ventil ist die Wiedervorlage, nicht eine Repo-Variable.
 */
const MILAN_ERWARTETE_BEINE = 18;
const MILAN_ERWARTETE_GRUPPEN = 17;

const IDENTITAETS_REGISTER_STANDARDPFAD = path.join(__dirname, '..', 'data-health', 'issuer-identity.json');

/**
 * FX1/FX2 — SIGNIFIKANTE STELLEN DER FINGERABDRUCK-KANONISIERUNG.
 * Urteil: `_COURT-A7-FX-2026-08-30.md` (ENTSCHIED 72), Akte: `akte-a7-fx-melde-waehrung-2026-08-30.md`.
 *
 * DIE KONSTANTE BLEIBT EIN LITERAL (FX1). Nie `process.env`, nie `configs/`, nie
 * Funktionsargument, nie vererbt ohne Neumessung. Ein Parameter mit genau EINEM zulaessigen Wert
 * ist kein Knopf; ein drehbarer waere die Toleranz, die A1 ("Wertgleichheit, keine Toleranz")
 * verbietet. Der Praezedenzfall steht im selben Repo: `pull-yahoo.js:86` liest
 * `FUNDAMENTALS_MAX_AGE_DAYS` als `parseInt(process.env.… || '7', 10)` — aus einer gemessenen
 * Zahl wird ein Umgebungsknopf, ohne dass jemand die Messung wiederholt. Genau das darf hier
 * nicht passieren.
 *
 * WARUM 15: ein IEEE-754-Double traegt ~15,95 Dezimalstellen. Die Ruecktransformation x/fx ist
 * NICHT selbstinvers: `fl(fl(r*f1)/f1) === fl(fl(r*f2)/f2)` gilt ueber 939.715 gemessene
 * Wertpaare aus 34 Waehrungen nur in 82,95 % der Faelle; die Abweichung ist immer 1 oder 2 ULP,
 * nie mehr. 15 signifikante Stellen schneiden genau diese Rausch-Stelle ab: Reparatur 100,000 %,
 * Fehlverschmelzung auf Ein-Einheiten-Abstand 0,000 % (gemessene Gegenprobe ueber denselben
 * Bestand). Weniger Stellen kaufen nichts und kosten Trennschaerfe (13 Stellen: bereits 3,3 %
 * Fehlverschmelzung bei 1 Einheit Abstand).
 *
 * DREI GRENZEN, DIE MITZULESEN SIND (FX2 — keine davon ist kosmetisch):
 *
 * 1. DIE GRENZE IST RELATIV, NICHT ABSOLUT. 15 signifikante Stellen heissen bei einer
 *    30-Mrd-Zeile eine Unterscheidungsschwelle von ~30 Melde-Einheiten, nicht von einem Cent.
 *    Die Cent-Aufloesung traegt A4 (gleiches `country` UND `sharesOutstanding` im 20-%-Band),
 *    nicht der Fingerabdruck. Auf Cent-Abstand verschmilzt die Kanonisierung gemessen 3,3 % —
 *    dieser Rest faellt A4 zu und ist vom Gericht ausdruecklich ratifiziert (FX22).
 *
 * 2. DIE 0,000 % SIND EINE EIGENSCHAFT DER POPULATION, NICHT DER KONSTANTE.
 *    Reichweite = eingefrorene Milan-Kandidatenliste (A6/A11); jede Erbschaft nach T179/T180
 *    oder ein Voll-Tor misst die Fehlverschmelzungsrate auf der NEUEN Population neu, BEVOR sie
 *    landet. Wer die Liste erweitert und diese Zahl uebernimmt, hat sie nicht gemessen.
 *
 * 3. GEMESSENE OBERGRENZE: ab ~1e15 Melde-Einheiten (16 signifikante Stellen) trennen 15 Stellen
 *    EINE Einheit nicht mehr. Fuer EUR/CHF der Milan-Population (~1e9) folgenlos, fuer eine
 *    JPY/KRW/IDR-Klasse nicht. Der RUECKWAERTS-Waechter ist deshalb auf das Band
 *    1e9 <= x < 1e15 geeicht (FX8) — unterhalb davon feuert seine Bruchprobe nicht, oberhalb ist
 *    er schon vor jeder Sabotage rot.
 *
 * NICHT auf Ganzzahl runden, obwohl ALLE 1.986 Mailaender Nicht-USD-Werte ganzzahlig sind:
 * ueber den ganzen Bestand sind es nur 63,1 % (`000002.SZ` meldet CNY mit Cent-Stellen). Das
 * Modul erbt laut A11 spaeter T179/T180 — eine Rundung, die heute folgenlos ist, waere dort eine
 * Toleranz-Ausweitung gegen A1, und ihre Sicherheit haengt an einer Momentaufnahme, die sich
 * nicht anpinnen laesst (Urteil F4, 2/2).
 */
const FINGERABDRUCK_STELLEN = 15;

/**
 * A9 — MESSEBENE, durch die A7-FX-Bank fortgeschrieben (FX20). Das Messwerkzeug
 * `probe-dedup-fingerprint.js` liest `pit.revenueQ` aus dem Board-Artefakt; diese Vorstufe
 * laeuft davor und liest `snapshot.timeseries`, **auf Melde-Waehrung zurueckgerechnet**.
 *
 * Die Fortschreibung ist die Erfuellung von A9s Sinn, keine Aufweichung: A9 begruendet die
 * Ebenenwahl selbst mit BH-108s FX-Neurechnung (`write-board-history.js:463-478` haelt fest,
 * dass `revenueQ` bei JEDEM Yahoo-Abruf mit dem dann aktuellen FX-Faktor neu in USD gerechnet
 * wird). Derselbe Gedanke traegt eine Ebene weiter: dieselbe Eigenschaft trifft auch
 * `snapshot.timeseries`, sobald zwei Beine an verschiedenen Tagen gezogen werden. "Dort messen,
 * wo gehandelt wird" heisst dann auf der Melde-Waehrung, weil der Handelsort FX-verschoben ist.
 * Beide Ebenen wertgleich zu unterstellen war ausdruecklich verboten — sie sind es fuer alle 35
 * Milan-Beine (Gegenprobe J3). Entpackt wird weiterhin wie `seriesValues()` dort
 * ([{value}]-Serialisierung von pull-yahoo).
 */
function milanReihe(arr) {
  if (!Array.isArray(arr)) return null;
  return arr.map((x) => (x && typeof x === 'object' && 'value' in x ? x.value : x));
}
function milanEndlicheQuartale(reihe) {
  if (!Array.isArray(reihe)) return 0;
  let n = 0;
  for (const x of reihe) if (Number.isFinite(x) && x !== 0) n++;
  return n;
}
/** A1: Umsatz- UND Bruttogewinn-Reihe zusammen, Wert fuer Wert, ohne Toleranz. Beide, weil eine
 *  einzelne Reihe zufaellig uebereinstimmen kann (runde Zahlen, kurze Reihen); beide zusammen
 *  nicht. Wortgleich zu `probe-dedup-fingerprint.js:82-84`, nur eine Datenebene frueher. */
function milanFingerabdruck(bein) {
  // `JSON.stringify` schreibt NaN, Infinity, -Infinity und undefined ALLE als `null` — zwei
  // Reihen, die sich nur in nicht-endlichen Feldern unterscheiden, bekaemen denselben
  // Fingerabdruck, obwohl A1 "Wert fuer Wert, ohne Toleranz" verlangt. Reproduziert:
  // [100,200,300,400,NaN] und [100,200,300,400,Infinity] waren bytegleich. Nicht-endliche
  // Werte werden deshalb als ihr eigener Name serialisiert; `null`, `NaN`, `Infinity`,
  // `-Infinity` und `undefined` bleiben damit paarweise verschieden.
  //
  // A7-FX: VERGLICHEN WIRD AUF DER MELDE-WAEHRUNG, NICHT AUF DEN GESPEICHERTEN WERTEN.
  // `pull-yahoo.js:1083` multipliziert JEDE timeseries-Reihe mit dem beim Abruf gueltigen Kurs
  // und protokolliert ihn als `meta.fxRateApplied` (`:1090`). Zwei Beine desselben Emittenten
  // werden vom Shard-Lauf an verschiedenen Tagen gezogen (gemessen: 21 Tage Versatz in der
  // Klasse 1JCI.MI) und tragen dann verschiedene Kurse — im Bestand liegen 16 verschiedene
  // EUR- und 8 verschiedene CHF-Kurse. Bytegleichheit auf der konvertierten Ebene ist damit ein
  // Abruf-Timing-Zufall: in der Simulation ueber alle real vorkommenden Kurspaare halten 0 von
  // 52 Faellen. Die Melde-Waehrung ist die einzige Ebene, auf der dieselben Fundamentaldaten
  // dieselbe Zahl ergeben, egal wann sie geholt wurden. Zur Pflicht-Kanonisierung siehe
  // FINGERABDRUCK_STELLEN: die nackte Division allein repariert nur 57,7 % der Faelle.
  const fx = bein.fx;
  const melde = (x) => {
    if (typeof x !== 'number' || !Number.isFinite(x)) return String(x);
    // Fail-closed: OHNE Kurs ist der Wert nicht vergleichbar. Nie stillschweigend auf die
    // konvertierte Ebene zurueckfallen — das waere genau die Bombe. Der Fall kann hier
    // strukturell nicht auftreten (milanKlassenLesen laesst ein Bein ohne Kurs gar nicht erst
    // entstehen, s. u.); die Schranke steht als zweite Verteidigungslinie und macht ein Bein
    // ohne Kurs zu einem, das mit NICHTS uebereinstimmt.
    if (!Number.isFinite(fx) || fx <= 0) return 'OHNE-FX:' + bein.ticker;
    // FX3 — QUOTIENTEN-FINITHEIT, PFLICHT. `Number.isFinite` auf dem EINGANG und `fx > 0`
    // genuegen nicht: der QUOTIENT kann ueberlaufen. Reproduziert (Urteil §3 K-1):
    //   Infinity.toPrecision(15) -> "Infinity" -> Number(…) -> Infinity -> JSON.stringify -> null
    //   JSON.stringify([Number((1e300/5e-324).toPrecision(15))]) -> [null]
    //   JSON.stringify([Number((2e300/5e-324).toPrecision(15))]) -> [null]
    // Zwei Beine mit VERSCHIEDENEN Werten werden bytegleich — dieselbe Nullen-Faltung, die der
    // Kommentar oben fuer den Eingangspfad bereits einmal repariert hat, nur eine Rechnung
    // spaeter. Ein nicht-endlicher Quotient matcht ab hier mit NICHTS.
    const y = x / fx;
    if (!Number.isFinite(y)) return 'UNENDLICH:' + bein.ticker;
    return Number(y.toPrecision(FINGERABDRUCK_STELLEN));
  };
  const fest = (reihe) => JSON.stringify(Array.isArray(reihe) ? reihe.map(melde) : reihe);
  return fest(bein.revenueQ) + '|' + fest(bein.grossProfitQ);
}

/**
 * DAS TOR. Reine Funktion ueber EINE Kandidatenklasse; gibt IMMER einen Grund zurueck, auch beim
 * Ja. Die Reihenfolge der Stufen ist Vertrag, nicht Geschmack: der Waechter pinnt je Fremdpaar
 * den ERSTEN greifenden Riegel, und genau daran wird sichtbar, wenn ein einzelner Riegel
 * stirbt. Faellt Stufe 2 heraus, wechselt `1DGX.MI`/`DGX` von 'fingerabdruck' auf 'aktienzahl'
 * und der Test wird rot — bei einer blossen Ja/Nein-Zusicherung waere der Tod des
 * Fingerabdrucks unter den redundanten Riegeln unsichtbar geblieben.
 *
 * `milanFingerabdruecke` ist die Menge der Fingerabdruecke, die im Bestand von MEHR ALS EINEM
 * Mailaender Bein getragen werden (A5). Fehlt sie, entfaellt Stufe 7 — das ist nur fuer
 * Register-Klassen ohne Mailaender Bein zulaessig.
 */
function milanTor(beine, mehrfachAbdruecke) {
  if (!Array.isArray(beine) || beine.length < 2 || beine.some((b) => !b)) return 'beine-unvollstaendig';
  const abdruck = milanFingerabdruck(beine[0]);
  if (beine.some((b) => milanFingerabdruck(b) !== abdruck)) return 'fingerabdruck';
  if (beine.some((b) => milanEndlicheQuartale(b.revenueQ) < MILAN_MIN_QUARTALE)) return 'umsatzquartale';
  const land = beine[0].country;
  if (typeof land !== 'string' || !land.trim() || beine.some((b) => b.country !== land)) return 'land';
  const shares = beine.map((b) => b.shares);
  if (shares.some((s) => !Number.isFinite(s) || s <= 0)) return 'aktienzahl';
  for (let i = 0; i < shares.length; i++) {
    for (let j = i + 1; j < shares.length; j++) {
      if (Math.abs(shares[i] - shares[j]) / Math.max(shares[i], shares[j]) > MILAN_SHARES_BAND) return 'aktienzahl';
    }
  }
  // A3, strengste Fassung (J3): nicht "beide Beine US-primaer", sondern ≥ 2 US-Primaerlistings
  // mit VERSCHIEDENEN urspruenglichen strengen Schluesseln — dann faellt die GANZE Klasse.
  // Das ist der `AVB`/`VMRK`-Riegel, den `splitFalseIssuerMerges` nach der Umbenennung nicht
  // mehr stellen koennte (T4), hier VOR der Mutation nachgebildet. Fuer die 17 Milan-Klassen
  // feuert er strukturell nie (hoechstens EIN Bein ist US-primaer) — er steht trotzdem, weil
  // dasselbe Modul die Klassen T179/T180 erben wird.
  const usPrimaer = beine.filter((b) => b.usPrimaerlisting);
  if (usPrimaer.length >= 2 && new Set(usPrimaer.map((b) => b.strengerSchluessel)).size >= 2) return 'us-primaerlisting';
  if (mehrfachAbdruecke && mehrfachAbdruecke.has(abdruck)) return 'mehrdeutig';
  if (new Set(beine.map((b) => b.schluessel)).size === 1) return 'schon-vereint';
  return 'umbenennen';
}

/**
 * Welcher Name gilt fuer die ganze Klasse. Das MAILAENDER Bein gewinnt — gemessen an allen 17
 * Klassen traegt es durchgehend den sauberen Emittentennamen ("Cellnex Telecom S.A.",
 * "Geberit AG", "Gen Digital Inc."), waehrend die Partner die Feed-Artefakte tragen
 * (Platzhalter `GEN`, XETRA-Nennwert-Anhaengsel "CELLNEX TELECOM SA EO-,25", Kurzformen).
 * `besseresBein` aus der .BO/.NS-Strecke taugt hier NICHT: seine Regel "der laengere Name
 * gewinnt" ist an indischen Feeds gemessen und wuerde ausgerechnet die XETRA-Anhaengsel zum
 * Sieger machen.
 *
 * EINZIGE AUSNAHME: traegt das Mailaender Bein selbst nur einen Platzhalter, faellt es zurueck
 * auf das beste Partner-Bein (`besseresBein`) — geraten wird nichts, und wenn ALLE Beine
 * Platzhalter tragen, gibt es nichts zu uebertragen.
 */
function milanSieger(beine) {
  const echt = beine.filter((b) => !istPlatzhalter(b.name, b.ticker, b.metaTicker));
  if (!echt.length) return null;
  return echt.includes(beine[0]) ? beine[0] : echt.reduce(besseresBein);
}

/**
 * Reiner Kern (kein I/O): Kandidatenklassen -> Map<Datei, neuer Name> plus je Klasse ein
 * nachvollziehbares Urteil. Nur VERLIERER-Beine stehen in der Map.
 */
function milanUmbenennungen(klassen, mehrfachAbdruecke) {
  const umbenennungen = new Map();
  const urteile = [];
  const kollisionen = [];
  // datei -> { name, anker }: welche Klasse hat fuer diese Datei welchen Emittentennamen belegt.
  const beansprucht = new Map();
  for (const k of klassen) {
    const beine = k.beine;
    // A5 haengt daran, OB die Klasse ein Mailaender Bein traegt — nicht daran, woher die Klasse
    // kommt. Vorher war der Riegel fuer jede Register-Klasse pauschal aus, obwohl nichts einen
    // Register-Eintrag daran hindert, einen `1XXX.MI`-Ticker zu nennen; die Zusicherung stand
    // nur im Kommentar. Jetzt greift er ueberall dort, wo er greifen kann.
    const mitMilanBein = Array.isArray(beine) && beine.some((b) => b && MILAN_SPIEGEL.test(b.ticker));
    let grund = milanTor(beine, mitMilanBein ? mehrfachAbdruecke : null);
    let sieger = null;
    const verlierer = [];
    if (grund === 'umbenennen') {
      sieger = milanSieger(beine);
      if (!sieger) grund = 'nur-platzhalter';
      else {
        const geplant = beine.filter((b) => b.schluessel !== sieger.schluessel);
        // Jede Klasse erhebt EINEN Anspruch je beteiligter Datei: "der Emittentenname dieses
        // Beins ist X". Fuer die Verlierer heisst das "wird zu X", fuer den Sieger "ist bereits
        // X" — dieselbe Aussage, deshalb dieselbe Buchung. Nur so faellt auch der Fall auf, in
        // dem ein Ticker in Klasse A Verlierer und in Klasse B Sieger ist: reproduziert mit
        // `T` als Verlierer von `1AAA.MI` und Sieger von `1BBB.MI` — `T` wurde auf
        // "Erste Holding AG" umbenannt, waehrend `1BBB.MI` auf "Tango Corp" ging und damit
        // genau die Identitaet verlor, die Klasse B bescheinigt hatte. Beide Richtungen, jede
        // Reihenfolge.
        // KOLLISION: zwei Klassen beanspruchen DASSELBE Bein mit VERSCHIEDENEN Namen. Ohne
        // diesen Riegel gewaenne still die zuletzt gerechnete Klasse — und weil der
        // Mengen-Riegel A7 nur die Kandidatenliste zaehlt, koennte ein Register-Eintrag, der
        // ein Bein der Liste mitnennt, ihm lautlos einen fremden Emittentennamen aufpraegen.
        // Reproduziert: Register-Eintrag mit Mitglied `GEN` gegen Klasse `1NLOK.MI`/`GEN` —
        // `GEN.json` bekam den Namen des Register-Eintrags. Ein Bein, zwei Identitaets-
        // Aussagen, ist immer ein Widerspruch; hier wird KEINE der beiden ausgefuehrt, und
        // run() bricht danach ab. Der Riegel sitzt bewusst hier, wo ALLE Klassen-Quellen
        // zusammenlaufen, nicht am Register-Lader allein.
        const kollision = [sieger, ...geplant]
          .find((b) => beansprucht.has(b.datei) && beansprucht.get(b.datei).name !== sieger.name);
        if (kollision) {
          grund = 'kollision';
          kollisionen.push({ anker: k.anker, ticker: kollision.ticker, wollte: sieger.name, steht: beansprucht.get(kollision.datei).name, von: beansprucht.get(kollision.datei).anker });
        } else {
          beansprucht.set(sieger.datei, { name: sieger.name, anker: k.anker });
          for (const b of geplant) {
            beansprucht.set(b.datei, { name: sieger.name, anker: k.anker });
            umbenennungen.set(b.datei, sieger.name);
            verlierer.push(b.ticker);
          }
          if (!verlierer.length) grund = 'schon-vereint';
        }
      }
    }
    urteile.push({
      anker: k.anker, quelle: k.registerQuelle || 'kandidatenliste', grund,
      beine: beine.map((b) => (b ? b.ticker : null)),
      sieger: grund === 'umbenennen' ? sieger.ticker : null,
      name: grund === 'umbenennen' ? sieger.name : null,
      verlierer,
    });
  }
  return { umbenennungen, urteile, kollisionen };
}

/**
 * B1/B2/B4 (Urteilsfrage K2, 3/3 BEIDES-MIT-ARBEITSTEILUNG) — das Identitaets-Register als
 * belegpflichtiges VENTIL neben der gemessenen Regel.
 *
 * EIGENE DATEI, ausdruecklich NICHT `nav-holdings.json` (B1): jenes ist eine AUSSCHLUSS-Liste
 * mit sieben Einzeltickern und kann die Aussage "A und B sind derselbe Emittent" strukturell
 * gar nicht ausdruecken.
 *
 * LEER AUSGELIEFERT (B2), und das ist das Ziel — dasselbe Urteil wie `ISSUER_ALIASE`
 * (`score.js:82-88`): "Eine Handliste ist an einer Identitaets-Entscheidung immer die
 * schlechtere Loesung: sie waechst still, und was nicht drinsteht, faellt lautlos durch."
 * `ISSUER_ALIASE` bleibt unberuehrt und leer (B5).
 *
 * B4 — REVALIDIERUNG GEGEN LIVE-DATEN: ein Eintrag ist KEIN Freifahrtschein. Er wird zu einer
 * ganz normalen Kandidatenklasse und muss dasselbe Tor bestehen wie die Milan-Liste (A1/A3/A4).
 * Ticker werden im Bestand recycelt (`VMRK` belegt, dass der Store Zeilen mit fremder Identitaet
 * fuehrt); ein stehender Eintrag wuerde sonst still fehlverschmelzen. Nicht-Treffer = Verwurf
 * mit Ausweis, nie stille Wirkung.
 *
 * Fail-closed geladen wie das NAV-Register: eine kaputte Datei stoppt den Lauf, statt ihn ohne
 * Register weiterlaufen zu lassen.
 *
 * ══ M17 (_COURT-M10-2026-08-30, G6 3:0) — DIE AUFNAHMESCHWELLE WIRD MASCHINELL GEHAERTET ══
 * REIHENFOLGE-AUFLAGE: diese Haertung kommt VOR dem Identitaets-Tripwire, nicht danach. Grund
 * ist nicht Vorsicht, sondern Arithmetik (Urteil §2 zu G6): der schaerfste bisherige Riegel war
 * ein Test, der das Register LEER verlangt — eine Bedingung mit eingebautem Verfallsdatum, die
 * am Tag des ersten Eintrags zwangslaeufig faellt. Eine zuverlaessig feuernde Lampe vor einer
 * weichen Schwelle ist ein Trichter.
 *
 * VERIFIZIERT WEICH, nicht vermutet weich (Urteil §3 K-8): bis hierher war `beleg` ein FREIER
 * STRING. `{ beleg: 'Messung X' }` und sogar `{ "beleg": "klar" }` luden sauber durch —
 * geprueft wurden Typen, Dubletten und Mehrfach-Ticker, nie der Inhalt.
 *
 * (a) `beleg` IST JETZT STRUKTURIERT und die zitierte Berichtsdatei muss IM REPO EXISTIEREN.
 *     Ein Beleg, den die CI nicht oeffnen kann, ist keiner. Das schliesst Vault-Pfade
 *     (`agent-reports/...`) bewusst aus: wer eine echte Firma vom Board nehmen will, legt die
 *     Messung dorthin, wo jeder Leser sie findet.
 *     ⚠ SELBST-GEGENREDE, ausdruecklich (Urteil M17): die Existenzpruefung mechanisiert die
 *     ZITIERPFLICHT, nicht den BEWEIS. B3(i) verlangt einen Negativbeweis ueber den vollen
 *     Bestand — den kann kein Lader pruefen. Sie hebt die Schwelle, sie ersetzt sie nicht.
 * (b) D-A — ABLAUFDATUM JE EINTRAG, FAIL-CLOSED. Ein Identitaets-Eintrag verschmilzt
 *     Emittenten; er darf nicht als Dauerzustand einschlafen. Abgelaufen heisst hier hart
 *     Abbruch (anders als die Quarantaene, die nur warnt): die Quarantaene VERWIRFT eine
 *     bewiesen vergiftete Zeile und schuetzt auch ueberfaellig korrekt weiter — dieses
 *     Register FUEHRT ZUSAMMEN, und eine ueberfaellige Zusammenfuehrung schuetzt niemanden.
 * (c) D-D (Zaehler-Anker) sitzt im Waechter, nicht hier: tests/u3-milan-spiegel.test.js pinnt
 *     `IDENTITAETS_REGISTER_ANKER` nach dem Muster des A7-Mengen-Riegels.
 *
 * M13 (3:0): REIHEN-GLEICHHEIT IST MELDUNG, NIE BEGRUENDUNG. Anker B (geteilte Umsatzreihe)
 * darf in keinem Eintrag der alleinige Beleg sein — bei Zweitnotierungen ist die geteilte
 * Reihe der Normalfall und beweist NICHTS (Produktionstext in data-health/quarantine.json).
 * ⚠ Die Pruefung haengt an der SELBSTAUSKUNFT `beleg.anker`; wer das Feld weglaesst, kommt an
 * ihr vorbei. Sie ist ein Gelaender, kein Schloss — das Schloss ist B3(i) plus M18.
 */
const IDENTITAETS_BELEG_PFLICHTFELDER = ['bericht', 'abschnitt', 'gemessenAm'];

/**
 * KALENDER-ECHT, nicht nur formatrichtig (Review-Fund 30.08.).
 *
 * Eine reine Formatpruefung `/^\d{4}-\d{2}-\d{2}$/` liess `"2026-13-45"` durch. Der D-A-Ablauf
 * vergleicht danach LEXIKOGRAFISCH — und `'2026-13-45' < '2026-08-30'` ist FALSE. Ein Eintrag
 * mit einem Unsinnsdatum waere also nie abgelaufen: ein fail-OPEN mitten in dem einzigen
 * Register, das ausdruecklich fail-closed sein muss. Reproduziert.
 *
 * `Date.UTC` + Rueckvergleich faengt den Monats-/Tagesueberlauf, den JS sonst still weiterrollt
 * (aus dem 31.02. wird der 03.03.).
 */
const IST_ISO_DATUM = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [j, m, t] = s.split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1, t));
  return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t;
};

/**
 * M17c (D-D) — DER ZAEHLER-ANKER, Nachfolger des Leer-Tests.
 *
 * Der bisherige Riegel war `REGISTER B2`: "die ausgelieferte Datei laedt und ist LEER". Er ist
 * strukturell wirksam, solange er steht — und er faellt ZWANGSLAEUFIG am Tag des ersten
 * Eintrags. Ein Riegel mit eingebautem Verfallsdatum ist keine Absicherung, sondern ein
 * Countdown (Urteil §2 zu G6).
 *
 * Gleiche Bauform wie MILAN_ERWARTETE_BEINE/-GRUPPEN (A7): die Zusage lautet nicht mehr
 * "leer", sondern "GENAU DIESE Zahl". 0 ist heute der Sollwert; ein erster Eintrag hebt ihn —
 * aber nur zusammen mit einer bewussten Aenderung DIESER Zeile, in demselben Diff, unter
 * denselben Augen. Genau das ist der Unterschied zu einem Riegel, der sich selbst aufloest.
 *
 * WER DIESE ZAHL HEBEN DARF: der Rat (N5). Der Anspruchstyp "A und B sind derselbe Emittent"
 * ist ratspflichtig; dieses Register wird nicht vom Executor befuellt.
 */
const IDENTITAETS_REGISTER_ANKER = 0;

function ladeIdentitaetsRegister(registerPfad, heute, repoWurzel = path.join(__dirname, '..')) {
  let roh;
  try { roh = JSON.parse(fs.readFileSync(registerPfad, 'utf8')); }
  catch (e) { throw new Error(`${registerPfad}: ${e.message}`); }
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) throw new Error(`${registerPfad}: Wurzel muss ein Objekt sein`);
  const eintraege = roh.eintraege;
  if (!Array.isArray(eintraege)) throw new Error(`${registerPfad}: Feld 'eintraege' muss ein Array sein`);
  // Ohne Datum kann D-A nicht pruefen — und ein Ablauf, der bei fehlendem Datum stillschweigend
  // durchlaesst, ist genau die Bauform, die dieses Register nicht haben darf.
  const heuteTag = String(heute || '').slice(0, 10);
  if (!IST_ISO_DATUM(heuteTag)) throw new Error(`${registerPfad}: kein brauchbares Datum uebergeben (${heute}); D-A kann nicht pruefen`);
  const ids = new Set();
  const belegteTicker = new Map();
  for (const [i, e] of eintraege.entries()) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error(`${registerPfad}: Eintrag ${i} ist kein Objekt`);
    for (const feld of ['kanonisch', 'aufgenommen']) {
      if (typeof e[feld] !== 'string' || !e[feld].trim()) throw new Error(`${registerPfad}: Eintrag ${i}, Feld ${feld} fehlt/ist leer`);
    }
    // ── M17a: strukturierter Beleg mit Existenzpruefung ──────────────────────────────────
    if (!e.beleg || typeof e.beleg !== 'object' || Array.isArray(e.beleg)) {
      throw new Error(`${registerPfad}: Eintrag ${i}, 'beleg' muss ein Objekt sein { ${IDENTITAETS_BELEG_PFLICHTFELDER.join(', ')} } — ein freier String ist seit M17a kein Beleg mehr`);
    }
    for (const feld of IDENTITAETS_BELEG_PFLICHTFELDER) {
      if (typeof e.beleg[feld] !== 'string' || !e.beleg[feld].trim()) throw new Error(`${registerPfad}: Eintrag ${i}, Feld beleg.${feld} fehlt/ist leer`);
    }
    if (!IST_ISO_DATUM(e.beleg.gemessenAm)) throw new Error(`${registerPfad}: Eintrag ${i}, beleg.gemessenAm muss JJJJ-MM-TT sein (ist "${e.beleg.gemessenAm}")`);
    const berichtRel = e.beleg.bericht.trim();
    const berichtAbs = path.resolve(repoWurzel, berichtRel);
    if (path.isAbsolute(berichtRel) || !berichtAbs.startsWith(path.resolve(repoWurzel) + path.sep)) {
      throw new Error(`${registerPfad}: Eintrag ${i}, beleg.bericht muss ein Pfad INNERHALB des Repos sein (ist "${berichtRel}")`);
    }
    if (!fs.existsSync(berichtAbs)) {
      throw new Error(`${registerPfad}: Eintrag ${i}, beleg.bericht "${berichtRel}" existiert nicht im Repo. Ein Beleg, den die CI nicht oeffnen kann, ist keiner — die Messung gehoert nach reports/ oder data-health/, nicht in den Vault`);
    }
    // ── M13: Anker B darf nie der ALLEINIGE Beleg sein ───────────────────────────────────
    if (e.beleg.anker !== undefined) {
      if (!Array.isArray(e.beleg.anker) || e.beleg.anker.some((a) => typeof a !== 'string' || !a.trim())) {
        throw new Error(`${registerPfad}: Eintrag ${i}, beleg.anker muss eine Liste nicht-leerer Bezeichner sein`);
      }
      if (e.beleg.anker.length && e.beleg.anker.every((a) => a.trim().toUpperCase() === 'B')) {
        throw new Error(`${registerPfad}: Eintrag ${i} nennt ausschliesslich Anker B als Beleg. Reihen-Gleichheit ist MELDUNG, nie BEGRUENDUNG (Auflage M13): bei Zweitnotierungen ist die geteilte Reihe der Normalfall und beweist NICHTS`);
      }
    }
    // ── M17b (D-A): Ablaufdatum, fail-closed ─────────────────────────────────────────────
    if (typeof e.gueltigBis !== 'string' || !IST_ISO_DATUM(e.gueltigBis)) {
      throw new Error(`${registerPfad}: Eintrag ${i}, 'gueltigBis' fehlt oder ist kein JJJJ-MM-TT (D-A, fail-closed): ein Identitaets-Eintrag darf nicht als Dauerzustand einschlafen`);
    }
    if (e.gueltigBis < heuteTag) {
      throw new Error(`${registerPfad}: Eintrag ${i} (${e.kanonisch}) ist seit ${e.gueltigBis} abgelaufen (heute ${heuteTag}). Stop: eine ueberfaellige Zusammenfuehrung schuetzt niemanden. Eintrag neu belegen oder austragen`);
    }
    if (!Array.isArray(e.mitglieder) || e.mitglieder.length < 2
      || e.mitglieder.some((t) => typeof t !== 'string' || !t.trim())) {
      throw new Error(`${registerPfad}: Eintrag ${i}, 'mitglieder' braucht mindestens zwei nicht-leere Ticker`);
    }
    if (ids.has(e.kanonisch)) throw new Error(`${registerPfad}: kanonische ID ${e.kanonisch} ist doppelt`);
    ids.add(e.kanonisch);
    // Derselbe Ticker in zwei Eintraegen waere eine still widerspruechliche Identitaets-Aussage:
    // beide Klassen wuerden ihn umbenennen, die letzte gewaenne. Hart statt lautlos.
    for (const t of e.mitglieder) {
      if (belegteTicker.has(t)) throw new Error(`${registerPfad}: Ticker ${t} steht in ${belegteTicker.get(t)} UND ${e.kanonisch}`);
      belegteTicker.set(t, e.kanonisch);
    }
  }
  return eintraege;
}

/**
 * I/O-Mantel. Liest genau drei Sorten Dateien: die Beine der eingefrorenen Kandidatenliste, die
 * Beine der Register-Eintraege und ALLE Mailaender Beine (fuer die A5-Mehrdeutigkeitsprobe —
 * ~900 von 15.000 Dateien).
 *
 * REIHENFOLGE IST SICHERHEIT: erst alles lesen, dann das Tor rechnen, dann den Mengen-Riegel
 * pruefen, ERST DANN schreiben. Ein Abbruch nach A7 darf keinen halb umbenannten Bestand
 * hinterlassen.
 */
function milanKlassenLesen(ziel, kandidaten, registerEintraege) {
  const gelesen = new Map();
  // FEHLT ist nicht KAPUTT. Beide enden im Tor auf 'beine-unvollstaendig' und fuehren damit nie
  // zu einer Umbenennung — aber sie sind zwei verschiedene Weltzustaende, und der Unterschied
  // traegt den Mengen-Riegel: "keine Datei da" ist ein anderes Universum (Fixture, Kaltstart),
  // "alle Dateien da, keine lesbar" ist ein Bruch. Ohne die Trennung liess ein systemischer
  // Lesefehler ueber alle 17 Anker die Zahl auf 0 fallen, der Riegel wurde uebersprungen und die
  // Log-Zeile war von der harmlosen Lage nicht zu unterscheiden. Reproduziert: 120 Fuell-
  // Snapshots + alle 34 Kandidaten-Dateien mit kaputtem JSON -> Exit 0, "Riegel uebersprungen".
  const lesefehler = [];
  const dateienImBestand = new Set();
  const lies = (ticker) => {
    if (gelesen.has(ticker)) return gelesen.get(ticker);
    let bein = null;
    let datei = null;
    try {
      datei = safeSnapshotFilename(ticker);
      const roh = fs.readFileSync(path.join(ziel, datei), 'utf8');
      dateienImBestand.add(ticker);
      const j = JSON.parse(roh);
      const meta = (j && j.meta) || {};
      const ts = (j && j.timeseries) || {};
      // A7-FX: OHNE Kurs kein vergleichbarer Fingerabdruck. Der Wurf laeuft in denselben catch
      // wie kaputtes JSON — das Bein faellt mit Ausweis (`lesefehler` + ::warning::) heraus und
      // die Klasse endet im Tor auf 'beine-unvollstaendig'. Fail-closed statt eines Vergleichs
      // auf einer Ebene, die der Abrufzeitpunkt verschiebt.
      //
      // DIE INVARIANTE GEHOERT DEM SCHREIBER, nicht dieser Zeile (FX12): `meta.fxRateApplied`
      // wird an genau vier Stellen zugewiesen (`pull-yahoo.js:866/:879/:903/:1090`, alle in
      // `_convertSnapshotToUSD`); jeder ungestempelte Rueckweg flaggt `fxConversionFailed`
      // (`:821/:867/:904/:976/:1111`, letzteres der fail-closed-Wrapper
      // `_convertSnapshotToUSDGuarded`), und ein geflaggter Snapshot wird GELOESCHT statt
      // geschrieben (`:3734-3738`, `_removeStaleFiles`). Der billige Kurs-Pfad verlangt einen
      // finiten Kurs (`:2846-2848`) und weist fruehere Fehlschlaege ab (`:2850`). Deshalb ist
      // dieser Zweig heute unerreichbar — er steht fuer den Tag, an dem er es nicht mehr ist.
      // Die Kette Loeschung -> ENOENT -> 'beine-unvollstaendig' -> A7-Abbruch ist VORBESTEHEND
      // und nicht von dieser Schranke erzeugt.
      if (!Number.isFinite(meta.fxRateApplied) || meta.fxRateApplied <= 0) {
        throw new Error('kein brauchbares meta.fxRateApplied — Fingerabdruck nicht vergleichbar');
      }
      bein = {
        datei, ticker, metaTicker: meta.ticker, name: meta.name, country: meta.country,
        shares: meta.sharesOutstanding, fx: meta.fxRateApplied,
        revenueQ: milanReihe(ts.revenueQ), grossProfitQ: milanReihe(ts.grossProfitQ),
        usPrimaerlisting: isUsPrimaryListing(meta),
        schluessel: issuerKeyLoose(j), strengerSchluessel: issuerKeyStrengOhneGattung(j),
      };
    } catch (e) {
      bein = null;
      // ENOENT ist der legitime Normalfall (der Ticker steht nicht im Bestand). Alles andere —
      // kaputtes JSON, Rechte, ein Wurf aus issuerKeyLoose/isUsPrimaryListing — ist ein Befund
      // und wird gemeldet, gleiche Bauform wie in wendeWurzelZwillingeAn oben.
      if (!e || e.code !== 'ENOENT') {
        lesefehler.push({ ticker, grund: e && e.message ? e.message : String(e) });
        console.error(`::warning::U3-Milan — ${datei || ticker} nicht auswertbar (${e && e.message ? e.message : e}); dieses Bein nimmt nicht teil.`);
      }
    }
    gelesen.set(ticker, bein);
    return bein;
  };

  // A5: welche Fingerabdruecke traegt MEHR ALS EIN Mailaender Bein? Nur diese Menge, nicht der
  // ganze Index — ein Voll-Index ueber alle Suffixe waere genau das von A11 gesperrte Tor.
  const proAbdruck = new Map();
  let milanBeine = 0;
  for (const f of fs.readdirSync(ziel)) {
    if (!f.endsWith('.json') || isMetadataSnapshot(f)) continue;
    const ticker = f.slice(0, -'.json'.length);
    if (!MILAN_SPIEGEL.test(ticker)) continue;
    const b = lies(ticker);
    if (!b || milanEndlicheQuartale(b.revenueQ) < MILAN_MIN_QUARTALE) continue;
    milanBeine++;
    const a = milanFingerabdruck(b);
    proAbdruck.set(a, (proAbdruck.get(a) || 0) + 1);
  }
  const mehrfachAbdruecke = new Set();
  for (const [a, n] of proAbdruck) if (n > 1) mehrfachAbdruecke.add(a);

  const klassen = [];
  for (const k of kandidaten) {
    klassen.push({ anker: k.anker, beine: [k.anker, ...k.partner].map(lies) });
  }
  for (const e of registerEintraege || []) {
    klassen.push({ anker: e.kanonisch, registerQuelle: 'identitaets-register', beine: e.mitglieder.map(lies) });
  }
  const kandidatenTicker = kandidaten.flatMap((k) => [k.anker, ...k.partner]);
  return {
    klassen, mehrfachAbdruecke, milanBeine, lesefehler,
    // Fuer den Mengen-Riegel: wie viele Kandidaten-DATEIEN liegen ueberhaupt im Bestand
    // (unabhaengig davon, ob sie auswertbar waren)?
    kandidatenDateien: kandidatenTicker.filter((t) => dateienImBestand.has(t)).length,
  };
}

/**
 * Schreibt die beschlossenen Umbenennungen — atomar wie jeder andere Schreiber hier.
 *
 * `kennung`/`stufe` sind Parameter, weil T179 (unten) denselben Schreiber braucht: ein
 * zweiter, wortgleicher Schreiber waere eine Kopie, die beim naechsten Fix genau einmal
 * mitgezogen wird und einmal nicht. Die Voreinstellung ist exakt das bisherige Verhalten.
 * `stufe` ist verschieden, weil die Fehlerrichtung verschieden ist: eine halb ausgefuehrte
 * MILAN-Vereinheitlichung ist ein Board auf halbem Stand (::error::, run() bricht ab), eine
 * ausgefallene NENNWERT-Normalisierung kostet nur einen doppelten Platz (::warning::, wie in
 * wendeWurzelZwillingeAn).
 */
function milanSchreiben(ziel, umbenennungen, kennung = 'U3-Milan', stufe = 'error') {
  const geschrieben = [];
  let unschreibbar = 0;
  for (const [datei, neuerName] of umbenennungen) {
    const p = path.join(ziel, datei);
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!j || typeof j !== 'object' || !j.meta) throw new Error('kein meta-Block');
      j.meta.name = neuerName;
      writeFileAtomic(p, JSON.stringify(j));
      geschrieben.push(datei.slice(0, -'.json'.length));
    } catch (e) {
      unschreibbar++;
      console.error(`::${stufe}::${kennung} — ${datei} nicht schreibbar (${e.message}); Bein bleibt getrennt.`);
    }
  }
  return { geschrieben, unschreibbar };
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 * T179 — NENNWERT-NORMALISIERUNG der XETRA-Kurzform
 * Befund: `befund-t178-t179-evidenz-2026-08-30.md` §B1-B6 (Empfehlung "N1 in der
 * 4-Kuerzel-Fassung freigeben", 0 Fremdpaare bei 100 % Pruefquote), freigegeben als
 * ENTSCHIED 35 Punkt 2, dispatcht mit ENTSCHIED 39.
 *
 * DAS PROBLEM: XETRA haengt an den Emittentennamen die Nennwert-Kurzform an —
 * "ANALOG DEVICES INC.DL-166", "GENMAB AS            DK 1", "CELLNEX TELECOM SA EO-,25".
 * `issuerKeyLoose` wirft nur Nicht-Buchstaben weg, das Anhaengsel bleibt also im Schluessel
 * stehen (`analogdevicesincdl166` gegen `analogdevicesinc`) und dieselbe Firma steht zweimal
 * im Board.
 *
 * BAUFORM WIE PR #92/#104: diese Vorstufe MERGED NICHTS. Sie nimmt das Anhaengsel vom Namen
 * und laesst danach den versiegelten Dedup entscheiden (`issuerKeyLoose` +
 * `issuerDedupComparator` + `splitFalseIssuerMerges`). Kein Bein wird geloescht, keine Zeile
 * ausgewaehlt, `src/scoring/**` bleibt unberuehrt.
 *
 * ⚠ N1 IST NICHT EINSEITIG SICHER (Kipp-Bedingung, Befund §B5). U1 kann eine Verschmelzung
 * nur VERHINDERN; das Abschneiden hier macht Schluessel GLEICHER und kann sie deshalb
 * ERZWINGEN. Der einzige tragende Beleg ist die Fremdpaar-Messung: alle 14 neuen Paare
 * wurden EINZELN fundamental gegengeprobt (positionsweiser Vergleich der ersten bis zu vier
 * `annual.annualRev`-Werte, "fremd" ab 15 % Abweichung) — 0 Fremdpaare, 0 nicht pruefbar,
 * 100 % Pruefquote statt einer Stichprobe. Am Live-Bestand 2026-08-30 unabhaengig
 * reproduziert: 8 Namen, 14 Paare, 0 Fremdpaare.
 *
 * NUR DIE VIER BEOBACHTETEN KUERZEL (Befund §B1 Entscheid 2). Die Gegenprobe mit sieben
 * weiteren plausiblen Kuerzeln (SK NK LS YE HD CD RC) liefert EXAKT dasselbe Ergebnis —
 * die Erweiterung kauft nichts und vergroessert nur die Angriffsflaeche fuer Falschtreffer.
 *
 * ANKER `(?:^|[\s.\-])` STATT `\s+` (Befund §B1 Entscheid 1): XETRA klebt das Kuerzel an das
 * Vorwort, "ANALOG DEVICES INC.DL-166" hat KEIN Leerzeichen vor `DL`. Ein `\s+`-Anker
 * verfehlt genau den Top-100-Fall.
 *
 * WAS N1 AUSDRUECKLICH NICHT LOEST (Befund §B3, Auflage b der Entscheidungsvorlage — damit
 * niemand spaeter ein fehlendes Ergebnis fuer einen Bug haelt): `D2MN.DE`/`DUK` scheitert an
 * der Wort-ABKUERZUNG ("Energy" -> "EN."), `3SM.DE`/`AOS` an der WORTSTELLUNG
 * ("SMITH -A.O.-"). Zwei eigene, ungemessene Klassen; N1 tut fuer sie nichts. Die
 * Ticket-Angabe "5 von 5" ist als Namensform richtig, als Wirkung aber zu optimistisch:
 * N1 schliesst 3 der 5 benannten Gruppen plus 2 im Ticket nicht genannte.
 * ══════════════════════════════════════════════════════════════════════════════════════ */
const NENNWERT_KUERZEL = /(?:^|[\s.\-])(DL|EO|DK|SF)\s*-?\s*[0-9]*[.,]?[0-9]+\s*$/i;

/**
 * Nicht-Regressions-Anker (Befund §B5 Waechter 3): so viele Namen aendern sich am Live-Bestand
 * unter N1, gemessen am Vintage 2026-08-30 ueber alle 15.040 Snapshots. JEDES Anwachsen ist ein
 * Neubefund, kein stiller Normalzustand.
 *
 * BEWUSST ::warning:: STATT HARTEM ABBRUCH — anders als der Milan-Riegel A7, und das ist kein
 * Versehen: A7 ist eine Auflage des Milan-Urteils (2:1 gegen J2s Sondervotum), N1 hat keine
 * solche Anordnung. Dazu kommt ein messtechnischer Grund: dieser Schritt laeuft NACH U3-Milan
 * (s. run()), und Milan hat `472.DE` bis dahin schon auf den sauberen Cellnex-Namen gesetzt —
 * die Laufzeit sieht also 7, waehrend die Vor-Milan-Messung 8 sieht. Beide Zahlen sind richtig,
 * eine harte Gleichheit waere hier eine Falle. Die scharfe Wache sitzt deshalb auf der reinen
 * Funktion in tests/t179-nennwert.test.js.
 */
const NENNWERT_ANKER = 8;

/**
 * Schneidet das Nennwert-Anhaengsel am NAMENSENDE ab. Reine Funktion.
 *
 * DIE `test`-VORPRUEFUNG IST NICHT ZIERRAT. Ohne sie wuerde `.trim()` auch jeden Namen
 * umschreiben, der bloss ein Leerzeichen am Ende traegt — am Live-Bestand gemessen faellt
 * `688790.SS` ("BEIJING ONMICRO ELECTRONICS CO ") genau so hinein: 9 statt 8 geaenderte Namen,
 * ein Schreibvorgang ohne jede Wirkung auf den Schluessel (`issuerKeyLoose` wirft Leerzeichen
 * ohnehin weg) und ein Anker, der bei jeder Feed-Schlamperei wandert. Nur echte Treffer
 * werden angefasst.
 *
 * Ein Name, der NUR aus dem Anhaengsel besteht, bleibt unveraendert: ein leerer Name waere ein
 * `issuerKeyLoose === null` und damit schlechter als der Feed-Artefakt.
 */
function nennwertStrip(name) {
  if (typeof name !== 'string' || !NENNWERT_KUERZEL.test(name)) return name;
  const kurz = name.replace(NENNWERT_KUERZEL, '').trim();
  return kurz || name;
}

/** Reiner Kern (kein I/O): Staende -> Map<Datei, neuer Name>. Nur echte Treffer stehen drin. */
function nennwertUmbenennungen(staende) {
  const umbenennungen = new Map();
  for (const s of staende || []) {
    if (!s) continue;
    const neu = nennwertStrip(s.name);
    if (typeof neu === 'string' && neu !== s.name) umbenennungen.set(s.datei, neu);
  }
  return umbenennungen;
}

/**
 * I/O-Mantel. Liest ALLE Snapshots — anders als die .BO/.NS- und die Milan-Strecke, die sich
 * ueber den Ticker vorfiltern koennen. Das geht hier nicht: die Regel haengt am NAMEN, und der
 * steht in der Datei. Ein Vorfilter auf `.DE` waere eine ungemessene Verengung der Regel
 * (heute liegen alle acht Treffer auf XETRA, aber das ist ein Messergebnis, keine Eigenschaft).
 * Gemessener Preis: 15.046 Dateien parsen kostet ~1 s — neben dem Kopieren derselben Dateien
 * eine Zeile weiter oben faellt das nicht auf.
 *
 * Eine unlesbare Datei ist KEIN Abbruch (gleiche Bauform und gleicher Grund wie in
 * wendeWurzelZwillingeAn): dieser Schritt ist im Tageslauf vorgeschaltet, ein einzelner
 * kaputter Snapshot darf die Pipeline nicht toeten — er faellt aber laut auf.
 */
function wendeNennwertAn(ziel, dateien) {
  const staende = [];
  let unlesbar = 0;
  for (const f of dateien) {
    if (!f.endsWith('.json') || isMetadataSnapshot(f)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ziel, f), 'utf8'));
      staende.push({ datei: f, name: j && j.meta && j.meta.name });
    } catch (e) {
      unlesbar++;
      console.error(`::warning::T179-Nennwert — ${f} nicht lesbar (${e.message}); dieser Stand nimmt nicht teil.`);
    }
  }
  const umbenennungen = nennwertUmbenennungen(staende);
  const { geschrieben, unschreibbar } = milanSchreiben(ziel, umbenennungen, 'T179-Nennwert', 'warning');
  return { kandidaten: staende.length, geplant: umbenennungen.size, geheilt: geschrieben.sort(), unlesbar, unschreibbar };
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 * M10 / M1 + M5 — DER HERKUNFTS-ZAEHLER UND DAS INTERIMS-PROTOKOLL
 * Urteil: `_COURT-M10-2026-08-30.md`, Auflagen M1 (Frist 20.09.2026), M2, M5.
 *
 * WARUM ES DIESE DATEI GIBT (Urteil §6): `meta.nameSource` (pull-yahoo.js) rettet die
 * Beweisspur je ZEILE — aber `snapshots/` ist gitignoriert, es gibt keine Versionshistorie,
 * und jeder Voll-Zug ueberschreibt seinen eigenen Vorzustand. Wer am 26.09. den Bestand
 * abfragt, sieht das ERGEBNIS der 30-Tage-Rotation, nie ihren VERLAUF. Die Erosions-Frist ist
 * durch das Feld also nicht gestoppt, sondern von der Feld-Frist auf die ZAEHLER-Frist
 * UMGEZOGEN. Diese Datei ist der Verlauf.
 *
 * BAUFORM IDENTISCH ZU `data-health/p99-delta-history.json` (Urteil §3 K-6): committete
 * Tagesreihe, `_doc` + `byDate`, REINE MESSUNG — kein Gate, kein rc-Beitrag, kein Konsument
 * im Scoring. Der Schritt kann NIE einen Lauf faellen: jeder Wurf wird gefangen und als
 * ::warning:: ausgewiesen (eine still ausfallende Messung waere schlimmer als keine).
 *
 * ⚠ DER BUCKET `fehlt` IST DIE GANZE AUFLAGE (Urteil M1, §6 Feststellung 3). Eine Zeile, die
 * den Schluessel `nameSource` gar nicht traegt, wurde seit PR #136 nicht neu gezogen. Ohne
 * diesen Bucket wird der wachsende Deckungsgrad als schrumpfende Fehlerklasse fehlgelesen —
 * die 6.862 watchlist-benannten Zeilen fallen im Zaehler, weil sie noch nicht gezogen wurden,
 * nicht weil sie einen Feed-Namen bekamen. Das ist der Nenner-Fehler, an dem diese Messung als
 * Einziges scheitern kann.
 *
 * MESSEBENE, ausdruecklich benannt: gezaehlt wird NACH den Umbenennungs-Stufen dieses Laufs,
 * also auf genau der Population, die der versiegelte Dedup anschliessend sieht. Nur auf dieser
 * Ebene ist "unterdruecktes Bein" eine echte Zahl. Die Umbenennungen des Laufs selbst stehen
 * getrennt im Feld `umbenennungen` (M5) — Vorher und Nachher werden nie vermischt.
 *
 * WAS HIER NICHT PASSIERT (Urteil M2, M7): keine Zeile wird angefasst, keine Gruppierung,
 * keine Sieger-Wahl und keine Umbenennung liest `nameSource`. `issuerDedupGroups` und
 * `issuerDedupComparator` werden IMPORTIERT und nur gelesen; `src/scoring/**` bleibt
 * unveraendert (N8). Die Zahlen beschreiben, sie steuern nichts.
 * ══════════════════════════════════════════════════════════════════════════════════════ */
/**
 * Die Reihe gehoert zu dem BESTAND, den sie gemessen hat — deshalb wird der Pfad aus dem
 * Zielordner abgeleitet und NICHT fest auf das Repo gelegt. Im Tageslauf ist `--ziel snapshots`
 * im Repo-Wurzelverzeichnis, die Datei landet also unter `data-health/` und faehrt im
 * `git add -A` des merge-Jobs mit (daily-pull.yml:1162), genau wie die Schwesterreihe
 * `data-health/p99-delta-history.json`.
 *
 * WARUM NICHT `__dirname/..`: mehrere Waechter fahren dieses Skript mit einem Temp-Ziel
 * (tests/quarantaene.test.js, tests/nav-holdings-register.test.js, tests/u3-milan-spiegel.test.js,
 * tests/f12-merge-filter.test.js). Mit einem festen Repo-Pfad haette JEDER Testlauf eine
 * Tageszeile aus einer FIXTURE-Population in die echte Messreihe geschrieben — eine Reihe, die
 * ihre eigenen Testlaeufe mitzaehlt, ist als Beweis wertlos. Ueberschreibbar bleibt der Pfad
 * ueber `--namensherkunft`.
 */
const namensherkunftStandardpfad = (ziel) => path.join(path.dirname(path.resolve(ziel)), 'data-health', 'namensherkunft-history.json');
/** Die SECHS Pflicht-Zaehlgroessen der Zeilen-Verteilung (Urteil M1, Beweis 1). Ihre Summe
 *  MUSS die Zahl der gelesenen Zeilen ergeben (Beweis 2) — deshalb ist `fehlt` ein Bucket
 *  neben den Sprossen und keine Restgroesse, die man wegrechnen kann. */
const NAMENSHERKUNFT_BUCKETS = ['longName', 'shortName', 'watchlist', 'ticker', 'null', 'fehlt'];
const NAMENSHERKUNFT_DOC = 'M10/M1 (_COURT-M10-2026-08-30, Frist 20.09.2026) — taegliche Herkunftsreihe von meta.nameSource. REINE MESSUNG: kein Gate, keine rc-Semantik, kein Konsument im Scoring (Auflage M2). Bucket "fehlt" = die Zeile traegt den Schluessel nameSource gar nicht, wurde also seit PR #136 nicht neu gezogen; ohne ihn wird wachsender Deckungsgrad als schrumpfende Fehlerklasse fehlgelesen. Invariante: Summe aller Buckets === gelesen. Gemessen NACH den Umbenennungs-Stufen des Laufs (die Population, die der Dedup sieht); die Umbenennungen des Laufs stehen getrennt unter "umbenennungen" (Auflage M5).';

/**
 * In welchen Bucket faellt eine Zeile? FEHLT ist nicht NULL: "der Schluessel steht gar nicht
 * da" (alter Zug) und "keine Sprosse hat geliefert" (Total-Leerzeile, pull-yahoo.js setzt
 * bewusst `null`) sind zwei verschiedene Weltzustaende. Sie zusammenzuwerfen wuerde genau die
 * Klasse verschleiern, die dieses Feld sichtbar machen soll.
 *
 * Ein UNBEKANNTER Wert bekommt seinen eigenen Bucket statt still in `fehlt` zu verschwinden —
 * eine neue Sprosse in pull-yahoo.js soll hier auffallen, nicht in einer Sammelgroesse
 * untergehen.
 */
function namensherkunftBucket(meta) {
  if (!meta || typeof meta !== 'object' || !Object.prototype.hasOwnProperty.call(meta, 'nameSource')) return 'fehlt';
  const q = meta.nameSource;
  if (q === null || q === undefined) return 'null';
  return NAMENSHERKUNFT_BUCKETS.includes(q) && q !== 'null' && q !== 'fehlt' ? q : `unbekannt:${String(q)}`;
}

/**
 * Reiner Kern (kein I/O): Zeilen -> die Tages-Zaehlung. `zeilen` traegt je Eintrag den
 * vorberechneten Bucket und einen SCHLANKEN Snapshot ({meta, marketCap}) — genau die Felder,
 * die `issuerDedupGroups`/`issuerDedupComparator` lesen (issuerKeyLoose/isUsPrimaryListing/
 * isUS/fxSuspect/mcapOf greifen ausschliesslich auf `meta` und `marketCap.value` zu).
 */
function namensherkunftZaehlen(zeilen) {
  const verteilung = Object.fromEntries(NAMENSHERKUNFT_BUCKETS.map((b) => [b, 0]));
  for (const z of zeilen) verteilung[z.bucket] = (verteilung[z.bucket] || 0) + 1;

  const gruppen = issuerDedupGroups(zeilen.map((z) => ({ ticker: z.ticker, snapshot: z.snapshot })));
  let mehrbeinGruppen = 0, watchlistSieger = 0, unterdrueckteBeine = 0;
  for (const g of gruppen) {
    if (g.length < 2) continue;
    mehrbeinGruppen++;
    // Genau die Produktions-Sortierung. Kopie statt in-place, damit der Aufrufer-Zustand
    // unberuehrt bleibt — diese Messung darf nichts bewegen, auch keine Array-Reihenfolge.
    const sieger = [...g].sort(issuerDedupComparator)[0];
    const q = sieger && sieger.snapshot && sieger.snapshot.meta ? sieger.snapshot.meta.nameSource : undefined;
    if (q === 'watchlist') { watchlistSieger++; unterdrueckteBeine += g.length - 1; }
  }
  return { gelesen: zeilen.length, verteilung, gruppen: gruppen.length, mehrbeinGruppen, watchlistSieger, unterdrueckteBeine };
}

/**
 * I/O-Mantel: liest ALLE Snapshots des Ziels. Gleicher Preis und gleiche Begruendung wie
 * `wendeNennwertAn` (~15.000 Dateien parsen kostet ~1 s neben dem Kopieren derselben Dateien).
 *
 * Unlesbare Dateien werden GEZAEHLT, nicht verschluckt: ohne die Zahl saehe ein systemischer
 * Lesefehler wie ein geschrumpfter Bestand aus, und jeder Bucket faellt gleichzeitig — die
 * Reihe wuerde einen Rueckgang zeigen, wo ein Bruch steht.
 */
function namensherkunftLesen(ziel) {
  const zeilen = [];
  let unlesbar = 0;
  for (const f of fs.readdirSync(ziel)) {
    if (!f.endsWith('.json') || isMetadataSnapshot(f)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ziel, f), 'utf8'));
      const meta = (j && j.meta) || {};
      zeilen.push({
        ticker: f.slice(0, -'.json'.length),
        bucket: namensherkunftBucket(j && j.meta),
        snapshot: { meta, marketCap: j && j.marketCap },
      });
    } catch (e) { unlesbar++; }
  }
  return { zeilen, unlesbar };
}

/**
 * Haengt den Tages-Eintrag an die Reihe an. ANHAENGEN, NIE UEBERSCHREIBEN — die Reihe IST die
 * Auflage; eine Datei, die nur den letzten Tag traegt, misst genau das, was ohne sie auch
 * schon sichtbar waere.
 *
 * EINE KAPUTTE BESTANDSDATEI WIRD NICHT UEBERSCHRIEBEN. Sie ist der einzige Ort, an dem der
 * Verlauf liegt; ein "dann fange ich eben neu an" haette den Beweis vernichtet, den diese
 * Auflage retten soll. Fehlende Datei (Erstanlage) ist dagegen der Normalfall.
 */
function namensherkunftSchreiben(pfad, datum, eintrag) {
  let roh = null;
  try {
    roh = JSON.parse(fs.readFileSync(pfad, 'utf8'));
  } catch (e) {
    if (e && e.code === 'ENOENT') roh = { _doc: NAMENSHERKUNFT_DOC, byDate: {} };
    else throw new Error(`${pfad} liegt vor, ist aber nicht lesbar/parsebar (${e.message}); die Reihe wird NICHT ueberschrieben`);
  }
  if (!roh || typeof roh !== 'object' || Array.isArray(roh) || !roh.byDate || typeof roh.byDate !== 'object' || Array.isArray(roh.byDate)) {
    throw new Error(`${pfad}: 'byDate' fehlt oder ist kein Objekt; die Reihe wird NICHT ueberschrieben`);
  }
  roh._doc = NAMENSHERKUNFT_DOC;
  roh.byDate[datum] = eintrag;
  fs.mkdirSync(path.dirname(pfad), { recursive: true });
  writeFileAtomic(pfad, JSON.stringify(roh, null, 2) + '\n');
  return Object.keys(roh.byDate).length;
}

/**
 * M5 — das Interims-Protokoll. Zaehlt die Umbenennungen dieses Laufs je HERKUNFT des
 * QUELL-Beins (also des Beins, dessen Name aufgepraegt wird) und listet die
 * `watchlist`-Faelle NAMENTLICH.
 *
 * KEINE WIRKUNG: keine Umbenennung unterbleibt, keine Zeile wird angefasst. Am
 * Entscheidungstag (G2, Urteil §8) liegt damit nicht nur eine Zahl vor, sondern die pruefbare
 * Liste — und genau das ist der Unterschied zwischen "es gibt die Klasse" und "hier ist sie".
 */
/**
 * M5, Nachlese-Halbteil: die Herkunft des SIEGER-Beins einer U3-Milan-Umbenennung. REIN
 * LESEND — `milanSchreiben`/U3 ist N1 und wird nicht angefasst (Urteil §7); der Sieger wird
 * von keiner Stufe umgeschrieben, sein `nameSource` ist also unveraendert.
 *
 * EIGENE FUNKTION, damit die Unterscheidung pruefbar ist (Review-Fund 30.08., MEDIUM): NICHT
 * LESBAR ist nicht KEINE HERKUNFT. Vorher landeten beide Lagen im Bucket `fehlt`, und ein
 * systemischer Lesefehler war von einem Tag ohne watchlist-benannte Sieger nicht zu
 * unterscheiden — dieselbe Verwechslung, die dieselbe Datei an drei anderen Stellen
 * ausdruecklich vermeidet.
 */
function siegerHerkunftNachlesen(ziel, ticker) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ziel, safeSnapshotFilename(ticker)), 'utf8'));
    return { herkunft: j && j.meta ? j.meta.nameSource : undefined, unlesbar: false };
  } catch (e) {
    return { herkunft: '(unlesbar)', unlesbar: true, grund: e && e.message ? e.message : String(e) };
  }
}

function umbenennungsProtokoll(eintraege) {
  const jeHerkunft = {};
  const watchlistFaelle = [];
  for (const e of eintraege || []) {
    const q = e.quelleHerkunft === null || e.quelleHerkunft === undefined ? 'fehlt' : String(e.quelleHerkunft);
    jeHerkunft[q] = (jeHerkunft[q] || 0) + 1;
    if (q === 'watchlist') watchlistFaelle.push(`${e.verlierer}<-${e.sieger}`);
  }
  return { gesamt: (eintraege || []).length, jeHerkunft, watchlistFaelle: watchlistFaelle.sort() };
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 * M10 / M8-M16 — DER IDENTITAETS-TRIPWIRE (Anker A + B), MELDEND
 * Urteil: `_COURT-M10-2026-08-30.md` (ENTSCHIED 126), Auflagen M8, M9, M10, M11, M12, M14, M15.
 *
 * ⚠ DIE ABGRENZUNGSFORMEL, WOERTLICH BESCHLOSSEN (M16, G6 3:0) — sie steht hier und im
 * `_doku` von data-health/issuer-identity.json:
 *
 *   „Erkennung und Meldung sind erlaubt; jede Verschmelzungs-Entscheidung auf Basis dieser
 *    Erkennung bleibt bis zu einem eigenen Gericht gesperrt."
 *
 * DIESER BAUSTEIN SCHREIBT EINE ZEILE IN EINEN BERICHT. Er faellt keine Zeile, er verschmilzt
 * keine, er benennt keine um, er faerbt den Lauf nicht und er aendert den Exit-Code nicht.
 * Das ist der ganze Unterschied zum 2:1 GESPERRTEN Voll-Tor (A11/c1): jenes praegt einen Namen
 * auf und ERZEUGT eine Verschmelzung, dieses meldet. Fehlerrichtung dort: eine echte Firma
 * verschwindet. Hier: ein Fehlalarm kostet einen Blick.
 *
 * MESSEBENE — VOR DEN UMBENENNUNGS-STUFEN, und das ist der Kern der Auflage (Urteil §3.2, §5).
 * P1 (der Monatszensus) misst HINTER der Vorstufe: die behandelten Klassen tragen dort bereits
 * den vereinheitlichten Namen, sind also nicht mehr divergent und koennen nie meldepflichtig
 * werden — ein wirksamer Eingriff loescht seine eigene Klasse aus der Spur. Deshalb liest
 * dieser Baustein den Bestand DIREKT NACH DEM KOPIEREN, und meldet erst ganz am Schluss. Die
 * Vorstufe weist ihre eigenen Umbenennungen wie bisher aus; beides zusammen ergibt das
 * Vorher/Nachher.
 *
 * FAIL-OPEN, ABER NICHT STILL (M8 + Kanzler-Zusatz). Praezedenz: eine Vorstufen-Reihenfolge hat
 * in dieser Datei schon einmal einen harten Tageslauf-Abbruch verursacht; ein Wurf im neuen
 * Baustein kostet dann die Tagesfrische ALLER ~15.000 Zeilen — verursacht von einer Lampe ohne
 * Datenwirkung. Also wird jeder Wurf gefangen. Aber eine still ausfallende Lampe ist keine
 * Lampe: die Degradation nennt den ausgefallenen Anker beim Namen.
 *
 * 🔒 M15 — F-16-STOPP-KLAUSEL, WOERTLICH VERFUEGT. Die Anker vergleichen Zeilen verschiedener
 * Handelsplaetze AUSSCHLIESSLICH ueber Aktienzahlen, Umsatzreihen und Namensschluessel. KEINE
 * Listing-Waehrungs-Logik, KEINE Waehrungs-Umrechnungsregel, KEINE Boersen-Identitaet je Firma,
 * KEIN `exchanges[]`. Wird eines davon gebraucht: SOFORT STOPP, zurueck unter die Sperre,
 * Wiedervorlage Ende Oktober — keine Umgehung ueber eine Hilfsgroesse.
 * Die Kanonisierung der Umsatzreihe laeuft ueber `milanFingerabdruck`, also ueber die BEREITS
 * RATIFIZIERTE A7-FX-Ruecknahme (`x / meta.fxRateApplied`, Milan-Urteil). Das ist WIEDERVERWENDUNG
 * einer bestehenden Regel, keine neue Waehrungslogik — und ohne sie waere der Vergleich ein
 * Abruf-Timing-Zufall, weil zwei Beine an verschiedenen Tagen mit verschiedenen Kursen gezogen
 * werden (0 von 52 Faellen halten auf der konvertierten Ebene).
 * ══════════════════════════════════════════════════════════════════════════════════════ */

/**
 * ANKER A — SELBSTWIDERSPRUCH EINER ZEILE. Die gemeldete Aktienzahl gegen die Aktienzahl in
 * der EIGENEN Jahresreihe. Kalibriert an `VMRK` (2,79: traegt AvalonBays Fundamentalblock
 * unter eigenem Namen). Das Band stammt aus der Tripwire-Skizze O5 des Memos.
 *
 * A braucht KEINEN Gruppenkontext — er ist der einzige Anker, der eine einzelne Zeile allein
 * beurteilen kann, und der einzige, der den KONTAMINATIONS-Selbstwiderspruch sieht, den Anker B
 * ausdruecklich als „beweist NICHTS" abtut.
 */
const TRIPWIRE_A_BAND = [0.80, 1.25];

/**
 * M12 — DIE KGaA-/KOMPLEMENTAER-AUSNAHME, AM OBJEKT VERANKERT.
 *
 * `MRK.DE` (Merck KGaA) liegt strukturell bei 0,297, weil nur ~30 % des Kapitals boersennotiert
 * sind — das ist KEIN Befund. Der Produktionstext dazu stand schon vor jedem Tripwire fest
 * (`data-health/quarantine.json`, `_doku`): „Eine maschinelle Aktienzahl-Regel braucht diese
 * Ausnahme, sonst meldet sie KGaAs und Partnerships dauerhaft falsch."
 *
 * VERANKERT AN DER RECHTSFORM IM EIGENEN NAMEN DER ZEILE, NICHT AN EINER TICKER-LISTE. Eine
 * Ticker-Liste waere selbst die Handliste, die dieses Gericht unter G7 ablehnt: sie waechst
 * still, und was nicht drinsteht, faellt lautlos durch. Die Rechtsform ist ein Strukturmerkmal
 * der Zeile und traegt die ganze Klasse — genau das verlangt die Auflage.
 *
 * Am Live-Bestand 2026-08-30 nimmt sie 12 von 1.416 A-Treffern aus: 1MRK.MI/MRCK.VI/MRK.DE
 * (Merck KGaA 0,297), DRW3.DE (Draegerwerk 0,459), HEN.DE/HEN3.DE (Henkel 0,611/0,365),
 * ESBA/FISK/OGCP (Empire State Realty OP, L.P.), IEP (Icahn Enterprises L.P. 1,265),
 * MNR (MACH NATURAL RESOURCES LP 1,268), PAGP (Plains GP Holdings, L.P. 0,281).
 */
const TRIPWIRE_KOMPLEMENTAERFORM = /(\bKGaA\b|\bKG\s*a\.?\s*A\.?|&\s*Co\.?\s*KG\b|\bL\.?\s?P\.?$|\bLLP\b|\bS\.?C\.?A\.?$)/i;

/**
 * Wie viele EINZELMELDUNGEN je Anker in den committeten Bericht wandern. Die ZAEHLUNGEN sind
 * immer vollstaendig; gekappt wird nur die Detailliste, und die Kappung steht mit ihrer Zahl
 * im Bericht.
 * ponytail: harte Kappung mit bekannter Decke — der Bericht wird taeglich neu geschrieben, und
 * ein taeglicher 1.400-Zeilen-Diff in data-health/ kostet mehr Repo als er Erkenntnis bringt.
 * Wenn die Vollliste je gebraucht wird, gehoert sie in einen eigenen, nicht committeten Lauf.
 */
const TRIPWIRE_KAPPUNG = 25;

/** Locale-frei, gleicher Grund wie `cmpTicker` in score.js: `localeCompare` haengt an der
 *  OS-Locale und liesse CI gegen lokal auseinanderlaufen. */
const cmpTickerLokal = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

/** Reiner Kern: Anker A ueber alle Zeilen. Gibt IMMER auch die ausgenommenen zurueck — eine
 *  Ausnahme, die man nicht zaehlen kann, ist von einem toten Anker nicht zu unterscheiden. */
function tripwireAnkerA(zeilen) {
  const treffer = [];
  let ausgenommen = 0, ohneBasis = 0;
  for (const z of zeilen || []) {
    if (!Number.isFinite(z.shares) || z.shares <= 0 || !Number.isFinite(z.jahresAktien) || z.jahresAktien <= 0) { ohneBasis++; continue; }
    const wert = z.shares / z.jahresAktien;
    if (wert >= TRIPWIRE_A_BAND[0] && wert <= TRIPWIRE_A_BAND[1]) continue;
    if (TRIPWIRE_KOMPLEMENTAERFORM.test(String(z.name || ''))) { ausgenommen++; continue; }
    treffer.push({
      anker: 'A', wert, ticker: z.ticker, name: z.name, nameSource: z.nameSource,
      schluessel: z.schluessel, fingerabdruck: z.fingerabdruck,
      shares: z.shares, jahresAktien: z.jahresAktien,
      // A ist ein EINZEILEN-Anker. Es gibt strukturell kein Partner-Bein; ein erfundenes
      // waere schlimmer als ein fehlendes, deshalb steht hier ausdruecklich null mit Grund.
      gegenstueck: null,
      gegenstueckGrund: 'Selbstwiderspruch EINER Zeile — dieser Anker hat strukturell kein Partner-Bein',
    });
  }
  // Schaerfster Fall zuerst: |ln(Verhaeltnis)| absteigend, dann Ticker (deterministisch, damit
  // die Kappung nicht taeglich andere Zeilen zeigt).
  treffer.sort((a, b) => Math.abs(Math.log(b.wert)) - Math.abs(Math.log(a.wert)) || cmpTickerLokal(a.ticker, b.ticker));
  return { treffer, ausgenommen, ohneBasis };
}

/**
 * ANKER B — REIHEN-EIGENTUM. Eine identische Jahresumsatz-Reihe, getragen von Zeilen aus
 * ZWEI VERSCHIEDENEN Emittentengruppen (`issuerKeyLoose`).
 *
 * ⚠ M13, BINDEND: Anker B ist als MELDUNG brauchbar und als BEWEIS untauglich. Bei
 * Zweitnotierungen ist die geteilte Reihe der Normalfall — „Dass sie AvalonBays Umsatzreihe
 * traegt, ist bei einer Zweitnotierung der Normalfall und beweist NICHTS" (Produktionstext in
 * data-health/quarantine.json). Der Register-Lader weist einen Eintrag ab, der nur B zitiert.
 */
function tripwireAnkerB(zeilen) {
  const nachAbdruck = new Map();
  for (const z of zeilen || []) {
    if (!z.hatUmsatz || !z.schluessel || !z.fingerabdruck) continue;
    if (!nachAbdruck.has(z.fingerabdruck)) nachAbdruck.set(z.fingerabdruck, []);
    nachAbdruck.get(z.fingerabdruck).push(z);
  }
  const treffer = [];
  for (const [fingerabdruck, beine] of nachAbdruck) {
    const schluessel = new Set(beine.map((b) => b.schluessel));
    if (schluessel.size < 2) continue;
    treffer.push({
      anker: 'B', wert: schluessel.size, fingerabdruck,
      // Der Fingerabdruck steht EINMAL auf Klassenebene, nicht je Bein: seine GLEICHHEIT ueber
      // alle Beine IST der Anker. Ihn n-mal zu wiederholen waere kein zweiter Beleg, sondern
      // dieselbe Zeichenkette in einem taeglich committeten Bericht.
      beine: [...beine].sort((a, b) => cmpTickerLokal(a.ticker, b.ticker)).map((b) => ({
        ticker: b.ticker, name: b.name, nameSource: b.nameSource, schluessel: b.schluessel,
      })),
      hinweis: 'MELDUNG, KEIN BELEG (M13): bei Zweitnotierungen ist die geteilte Reihe der Normalfall',
    });
  }
  treffer.sort((a, b) => b.wert - a.wert || b.beine.length - a.beine.length || cmpTickerLokal(a.beine[0].ticker, b.beine[0].ticker));
  return { treffer };
}

/**
 * I/O-Mantel: liest die Felder, die BEIDE Anker brauchen, in EINEM Durchgang. Bewusst nur
 * skalare Felder plus zwei Reihen — der volle Snapshot mal 15.000 waere Speicher ohne Nutzen.
 *
 * Ein Bein OHNE `meta.fxRateApplied` bekommt ueber `milanFingerabdruck` den Platzhalter
 * `OHNE-FX:<ticker>` und matcht damit mit NICHTS (fail-closed, ratifizierte A7-FX-Bauform) —
 * es kann also keine Klasse erfinden.
 */
function tripwireLesen(ziel) {
  const zeilen = [];
  let unlesbar = 0;
  // DAS VERZEICHNIS, NICHT DIE UEBERNAHME-LISTE (Review-Fund 30.08., MEDIUM, reproduziert).
  // Vorher las dieser Durchgang `uebernehmen`, also nur die Dateien DIESES Laufs — waehrend
  // sein Schwester-Zaehler (`namensherkunftLesen`) das ganze Verzeichnis liest. Dieser Schritt
  // raeumt `ziel` nie ab (s. "DAS EINZIGE LOCH IM AUSSCHLUSS" in run()): lokal kann ein Stand
  // aus einem frueheren Lauf liegenbleiben, der weiter gescort WIRD — und genau der waere
  // an beiden Ankern vorbeigelaufen, waehrend die Schwester-Messung ihn zaehlt. Zwei
  // Messungen desselben Urteils duerfen nicht zwei verschiedene Populationen meinen.
  // In CI faellt der Unterschied nicht auf (frischer Runner, `ziel` startet leer) — das ist
  // der Grund, warum er ohne diesen Fund nie aufgefallen waere.
  for (const f of fs.readdirSync(ziel)) {
    if (!f.endsWith('.json') || isMetadataSnapshot(f)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ziel, f), 'utf8'));
      const meta = (j && j.meta) || {};
      const annual = (j && j.annual) || {};
      const jahresUmsatz = milanReihe(annual.annualRev);
      const jahresAktienReihe = milanReihe(annual.annualShares);
      zeilen.push({
        ticker: f.slice(0, -'.json'.length),
        // M9 verlangt die HERKUNFT beider Namen. Genommen wird der M1-Bucket, nicht der
        // Rohwert: `JSON.stringify` laesst ein `undefined` einfach WEG, und ein fehlender
        // Schluessel im Bericht waere von "Herkunft unbekannt" nicht zu unterscheiden —
        // dieselbe Verwechslung, die der Bucket `fehlt` beim Zaehler verhindert. Gleiches
        // Vokabular in Bericht und Messreihe, damit man sie nebeneinander lesen kann.
        name: meta.name, nameSource: namensherkunftBucket(meta),
        schluessel: issuerKeyLoose(j),
        shares: meta.sharesOutstanding,
        jahresAktien: Array.isArray(jahresAktienReihe) && jahresAktienReihe.length ? jahresAktienReihe[0] : null,
        hatUmsatz: Array.isArray(jahresUmsatz) && jahresUmsatz.some((x) => Number.isFinite(x) && x !== 0),
        fingerabdruck: milanFingerabdruck({ ticker: f.slice(0, -'.json'.length), fx: meta.fxRateApplied, revenueQ: jahresUmsatz, grossProfitQ: null }),
      });
    } catch (e) { unlesbar++; }
  }
  return { zeilen, unlesbar };
}

/**
 * M9 — MELDEFORM: JEDE MELDUNG IST ALLEIN NACHRECHENBAR. Kein OR-verschmolzenes Boolean; A und
 * B erscheinen als ZWEI Zaehlgroessen und zwei Listen, nie als eine (M11). Je Meldung stehen
 * Anker, Wert, Ticker, Name, Fingerabdruck und die HERKUNFT des Namens (`nameSource`) da —
 * ein Mensch kann ohne Zusatzabfrage entscheiden, ob die Klasse echt ist.
 *
 * Der Bericht wird COMMITTET, nicht nur ins fluechtige Actions-Log geschrieben. Er wird
 * taeglich UEBERSCHRIEBEN: er ist ein Bericht ueber den heutigen Stand, keine Messreihe —
 * die Messreihe ist data-health/namensherkunft-history.json (M1).
 */
function tripwireBericht(a, b, kopf) {
  // EIN AUSGEFALLENER ANKER IST NICHT EIN ANKER OHNE BEFUND (Review-Fund 30.08.).
  // Vorher wurde der committete Bericht nur geschrieben, wenn BEIDE Anker durchliefen — ein
  // Wurf in A nahm also auch Bs bereits fertig gerechnete Meldungen aus der persistierten
  // Datei, und die fail-open-Zusage "faellt A aus, meldet B trotzdem" galt nur fuers Log.
  // Jetzt wird der Bericht immer geschrieben, und der ausgefallene Anker steht ausdruecklich
  // als `ausgefallen: true` da statt als 0 — dieselbe Trennung wie FEHLT gegen NULL beim
  // Zaehler: "nicht gemessen" darf nie wie "nichts gefunden" aussehen.
  const teil = (r, name) => (r
    ? { ausgefallen: false, gemeldet: r.treffer.length, gelistet: Math.min(r.treffer.length, TRIPWIRE_KAPPUNG), meldungen: r.treffer.slice(0, TRIPWIRE_KAPPUNG) }
    : { ausgefallen: true, gemeldet: null, gelistet: 0, meldungen: [],
        grund: `Anker ${name} ist in diesem Lauf ausgefallen (s. ::warning:: im Lauf-Log). NICHT als 0 lesen: dieser Anker hat heute NICHTS gemessen.` });
  return {
    _doku: [
      'IDENTITAETS-TRIPWIRE — MELDUNG, KEINE ENTSCHEIDUNG (_COURT-M10-2026-08-30, ENTSCHIED 126).',
      '',
      '"Erkennung und Meldung sind erlaubt; jede Verschmelzungs-Entscheidung auf Basis dieser',
      'Erkennung bleibt bis zu einem eigenen Gericht gesperrt." (Auflage M16, woertlich beschlossen)',
      '',
      'KEINE MELDUNG HIER IST JE ALLEIN BELEG fuer einen Eintrag in data-health/issuer-identity.json',
      '(Auflage M18). Anker B taugt ueberhaupt nie als alleinige Begruendung (Auflage M13): bei',
      'Zweitnotierungen ist die geteilte Umsatzreihe der Normalfall und beweist NICHTS.',
      '',
      'GEMESSEN VOR den Umbenennungs-Stufen des Laufs (U2/U3/T179) — sonst loeschte ein wirksamer',
      'Eingriff seine eigene Klasse aus der Spur. Der Lauf weist seine Umbenennungen getrennt aus.',
      '',
      'A = Selbstwiderspruch: meta.sharesOutstanding gegen annual.annualShares[0], Band',
      `[${TRIPWIRE_A_BAND[0]}, ${TRIPWIRE_A_BAND[1]}]. Ausgenommen sind Komplementaer-/Partnership-Strukturen`,
      '(Auflage M12) — an der RECHTSFORM im eigenen Namen der Zeile, NICHT an einer Ticker-Liste.',
      'B = Reihen-Eigentum: eine identische Jahresumsatz-Reihe ueber >= 2 Emittentengruppen.',
      'A und B stehen getrennt (Auflage M11); Anker C ist NICHT gebaut (aufschiebend bedingt).',
      '',
      `Die Detaillisten sind bei ${TRIPWIRE_KAPPUNG} Eintraegen je Anker gekappt; die Zaehlungen sind vollstaendig.`,
    ],
    ...kopf,
    zaehlung: {
      ankerA: a ? a.treffer.length : null,
      ankerA_ausgenommen: a ? a.ausgenommen : null,
      ankerA_ohneBasis: a ? a.ohneBasis : null,
      ankerB: b ? b.treffer.length : null,
    },
    ankerA: teil(a, 'A'),
    ankerB: teil(b, 'B'),
  };
}

/** Gleiche Begruendung wie beim Herkunfts-Zaehler: der Bericht gehoert zu dem Bestand, den er
 *  gemessen hat, nicht fest ins Repo — sonst schriebe jeder Waechter-Lauf mit Temp-Ziel einen
 *  Fixture-Bericht in die echte Datei. */
const tripwireStandardpfad = (ziel) => path.join(path.dirname(path.resolve(ziel)), 'data-health', 'identitaets-tripwire.json');

/**
 * Gemeinsamer Lader der beiden TICKER-Register (NAV-Ausschluss und Quarantaene). Ein einziger
 * Lader, weil beide dieselben Wachen brauchen — Pflichtfelder, Ticker-Dublette,
 * Dateinamen-Dublette — und eine Kopie genau einmal mitgezogen wuerde und einmal nicht.
 *
 * Zwei Container-Formen, beide erlaubt: ein blankes Array (nav-holdings.json, historisch) oder
 * ein Objekt mit `eintraege` (quarantine.json, wie issuer-identity.json — nur so passt die
 * Doku IN die Datei, und bei einem Register, das Zeilen VERWIRFT, gehoert sie dorthin).
 *
 * `pflichtFelder` unterscheidet die beiden: die Quarantaene verlangt zusaetzlich ein
 * Wiedervorlage-Datum, damit ein Eintrag nicht als Dauerzustand einschlaeft.
 */
function ladeTickerRegister(registerPfad, pflichtFelder) {
  let roh;
  try { roh = JSON.parse(fs.readFileSync(registerPfad, 'utf8')); }
  catch (e) { throw new Error(`${registerPfad}: ${e.message}`); }
  const eintraege = Array.isArray(roh) ? roh : (roh && typeof roh === 'object' ? roh.eintraege : undefined);
  if (!Array.isArray(eintraege)) throw new Error(`${registerPfad}: Wurzel muss ein Array sein oder ein Objekt mit dem Array 'eintraege'`);
  const tickers = new Set();
  // T612-L1 (Review Tag 612): die Dublette wird auf DATEINAMEN-Ebene gesucht, nicht auf der
  // Rohstring-Ebene. safeSnapshotFilename faltet (Grossschreibung, [^A-Z0-9.-] -> _), also
  // sind 'nflx' und 'NFLX' zwei verschiedene Rohstrings fuer EINE Datei — ein Register-Fehler,
  // der als "zwei Eintraege" durchging und beim Pflegen die zweite Begruendung verstecken wuerde.
  const dateinamen = new Map();
  for (const [i, e] of eintraege.entries()) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error(`${registerPfad}: Eintrag ${i} ist kein Objekt`);
    for (const feld of pflichtFelder) {
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
  return { tickers, eintraege };
}

const NAV_PFLICHTFELDER = ['ticker', 'grund', 'beleg', 'aufgenommen'];
function ladeNavRegister(registerPfad) { return ladeTickerRegister(registerPfad, NAV_PFLICHTFELDER).tickers; }

/* ══════════════════════════════════════════════════════════════════════════════════════
 * QUARANTAENE — das Ausschlussregister fuer BEWIESEN vergiftete Zeilen
 * Auftrag: ENTSCHIED 37 (Orchestrator 2026-08-29 22:57), Beleg
 * `fix-mrksw-vmrk-2026-08-30.md` §4/§6 Punkt 2.
 *
 * WARUM ES DIESE DATEI GEBEN MUSS, obwohl es schon Ausschluss-Wege gibt (der Sofort-Fix hat
 * alle vier durchgeprueft und alle vier verworfen, §4 Punkt 3):
 *   - `nav-holdings.json` ist inhaltlich fuer NAV-Holdings und Closed-End-Fonds gebaut (alle
 *     sieben Eintraege sind das). Ein Datenkreuzungs-Fall dort waere ein Kategoriefehler.
 *   - `board-history/_excluded.json` schliesst VINTAGES aus, keine Ticker.
 *   - die `ausgeschlossen`-Liste der Neuverankerung gehoert zum Jahres-Ausreisser-Waechter
 *     und nimmt keine Zeile vom Board.
 *   - die Scoring-Ausschluesse in `src/scoring/router.js` sind versiegelt.
 *
 * ⚠ HIER WIRD VERWORFEN, NICHT UMBENANNT — und das ist der Unterschied zu ALLEM anderen in
 * dieser Datei. U2/U3/T179 praegen Namen auf und lassen den versiegelten Dedup entscheiden,
 * weil dort die Identitaet UNSICHER ist. Hier ist sie BEWIESEN falsch: `VMRK` traegt
 * AvalonBays kompletten Zahlenblock, zweimal unabhaengig nachgezogen (26.08. und 29.08.), und
 * widerspricht sich selbst (`sharesOutstanding` 398.834.711 gegen die eigene Jahresreihe
 * 142.826.382 = Faktor 2,79). Eine Zeile, deren Zahlen einer anderen Firma gehoeren, kann
 * durch keine Umbenennung richtig werden — sie kann nur draussen bleiben.
 *
 * NICHTS WIRD GELOESCHT (Karl-Entscheid F-12, s. Modulkopf): der Eingang behaelt jede Datei,
 * sie wandert nur nicht ins Ziel und damit nicht ins Scoring.
 *
 * DIE AUFNAHMESCHWELLE IST HOCH, denn die Fehlerrichtung ist teuer: ein falscher Eintrag
 * LOESCHT eine echte Firma aus dem Board. Ein Eintrag braucht
 *   (i)   einen BEWEIS, dass die Zahlen der Zeile einer anderen Firma gehoeren — nicht bloss
 *         einen Verdacht, und nicht bloss "teilt eine Reihe mit X" (s. AVBC.VI in der Datei),
 *   (ii)  einen zweiten, unabhaengigen Zug mit demselben Fremdergebnis (transient vs. stehend),
 *   (iii) die Belegdatei im Feld `beleg` und ein Wiedervorlage-Datum in `pruefungBis`.
 * ══════════════════════════════════════════════════════════════════════════════════════ */
const QUARANTAENE_STANDARDPFAD = path.join(__dirname, '..', 'data-health', 'quarantine.json');
const QUARANTAENE_PFLICHTFELDER = ['ticker', 'grund', 'beleg', 'aufgenommen', 'pruefungBis'];
function ladeQuarantaene(registerPfad) { return ladeTickerRegister(registerPfad, QUARANTAENE_PFLICHTFELDER); }

/**
 * Wiedervorlage: welche Eintraege sind ueber ihr `pruefungBis` hinaus? Ein Ausschluss ohne
 * Ablaufdatum wird still zum Dauerzustand, und genau das soll dieses Register NICHT werden —
 * es ist eine Notbremse, kein Friedhof. Reine Funktion (Datum injizierbar), damit die Wache
 * ohne Systemuhr pruefbar ist.
 */
function quarantaeneFaellig(eintraege, heute) {
  const stichtag = String(heute).slice(0, 10);
  return (eintraege || []).filter((e) => typeof e.pruefungBis === 'string' && e.pruefungBis.trim() < stichtag);
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
 *
 * DIE QUARANTAENE WIRD ZUERST GEFRAGT. Steht ein Ticker in beiden Registern, ist die
 * Quarantaene die staerkere Aussage ("diese Zeile traegt fremde Zahlen") und soll auch die
 * gemeldete sein; ohne die feste Reihenfolge haette derselbe Ticker je nach Register-Pflege
 * mal die eine, mal die andere Meldezeile erzeugt, und doppelt gezaehlt wuerde er auch.
 */
function teileEingang(files, erlaubt, navDateinamen = new Set(), quarantaeneDateinamen = new Set()) {
  const uebernehmen = [], uebersprungen = [], navAusgeschlossen = [], quarantaeneAusgeschlossen = [];
  let gescannt = 0;
  for (const f of files) {
    if (!f.endsWith('.json') || isMetadataSnapshot(f)) { uebernehmen.push(f); continue; }
    gescannt++;
    if (quarantaeneDateinamen.has(f)) quarantaeneAusgeschlossen.push(f);
    else if (navDateinamen.has(f)) navAusgeschlossen.push(f);
    else if (erlaubt.has(f)) uebernehmen.push(f); else uebersprungen.push(f);
  }
  return { uebernehmen, uebersprungen, navAusgeschlossen, quarantaeneAusgeschlossen, gescannt };
}

function run(argv) {
  const get = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
  const eingang = get('--eingang', 'snapshots-eingang');
  const ziel = get('--ziel', 'snapshots');
  const watchlistPfad = get('--watchlist', 'watchlist.json');
  const navRegisterPfad = get('--nav-register', NAV_REGISTER_STANDARDPFAD);
  const identitaetsRegisterPfad = get('--identitaets-register', IDENTITAETS_REGISTER_STANDARDPFAD);
  const quarantaenePfad = get('--quarantaene', QUARANTAENE_STANDARDPFAD);
  const namensherkunftPfad = get('--namensherkunft', namensherkunftStandardpfad(ziel));
  const tripwirePfad = get('--tripwire-bericht', tripwireStandardpfad(ziel));
  const heute = get('--heute', new Date().toISOString());

  // B1/B4: fail-closed wie das NAV-Register. Heute leer (B2) — ein Ladefehler stoppt den Lauf
  // trotzdem, sonst waere die spaetere Befuellung still wirkungslos.
  let identitaetsEintraege;
  try { identitaetsEintraege = ladeIdentitaetsRegister(identitaetsRegisterPfad, heute); }
  catch (e) {
    console.error(`::error::filter-snapshot-merge — Identitaets-Register nicht ladbar (${e.message}). Abbruch statt lautlosem Lauf ohne das belegpflichtige Ventil.`);
    return 1;
  }

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

  // Quarantaene (ENTSCHIED 37): fail-closed wie die beiden anderen Register. Eine kaputte Datei
  // stoppt den Lauf — ein Register, das Zeilen VERWIRFT, darf niemals lautlos leer laufen: das
  // Ergebnis waere ein Board mit bewiesen vergifteten Zahlen darin.
  let quarantaene;
  try { quarantaene = ladeQuarantaene(quarantaenePfad); }
  catch (e) {
    console.error(`::error::filter-snapshot-merge — Quarantaene-Register nicht ladbar (${e.message}). Abbruch statt lautlosem Scoring mit bewiesen vergifteten Zeilen.`);
    return 1;
  }
  let quarantaeneDateinamen;
  try { quarantaeneDateinamen = new Map([...quarantaene.tickers].map((t) => [safeSnapshotFilename(t), t])); }
  catch (e) {
    console.error(`::error::filter-snapshot-merge — Quarantaene-Register enthaelt unbrauchbaren Ticker (${e.message}). Abbruch statt Teilfilterung.`);
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

  const { uebernehmen, uebersprungen, navAusgeschlossen, quarantaeneAusgeschlossen, gescannt } = teileEingang(files, erlaubt, navDateinamen, quarantaeneDateinamen);

  // DIE LAUTE MELDEZEILE — vor jeder Wache, damit sie auch dann im Log steht, wenn der Lauf
  // gleich abbricht. Sie steht in JEDEM Lauf, auch bei 0: ein Register, das nur dann etwas
  // sagt, wenn es zuschlaegt, ist von einem kaputt geladenen Register nicht zu unterscheiden.
  const quarantaeneTickerListe = quarantaeneAusgeschlossen.map((f) => f.slice(0, -'.json'.length)).sort();
  console.log(`QUARANTAENE: ${quarantaeneTickerListe.length} Zeilen — ${quarantaeneTickerListe.join(', ') || '(keine)'} [Register: ${quarantaene.tickers.size} Eintraege]`);

  // Gleiche Bauform wie die NAV-Wache darunter, und hier noch wichtiger: ein Quarantaene-
  // Eintrag ohne Datei im Eingang ist ein STILL WIRKUNGSLOSER Ausschluss. Genau das ist die
  // 25.09.-Falle in der anderen Richtung — wer den Ticker umbenannt findet, muss es merken.
  //
  // BEWUSST ANDERER WORTLAUT als die NAV-Zeile darunter ("hatte keinen Treffer im Eingang").
  // Zwei Register duerfen nicht denselben Satz sagen: `tests/nav-holdings-register.test.js`
  // pinnt M1 ueber genau diese Formulierung, und mit einem geteilten Wortlaut haette die
  // Quarantaene-Meldung dort einen fremden Befund vorgetaeuscht (reproduziert: M1 wurde rot,
  // obwohl am NAV-Register nichts falsch war). Jede Meldung nennt ihr eigenes Register.
  const imEingang = new Set(files);
  for (const [datei, ticker] of quarantaeneDateinamen) {
    if (!imEingang.has(datei)) {
      console.error(`::warning::QUARANTAENE: ${ticker} liegt nicht im Eingang (delisted/umbenannt/Tippfehler?) — der Ausschluss ist damit wirkungslos.`);
    }
  }
  // Wiedervorlage: ein Ausschluss ohne Ablauf wird still zum Dauerzustand. Kein Hardstop —
  // die Zeile ist ja weiterhin vergiftet, der ueberfaellige Eintrag schuetzt also korrekt.
  for (const e of quarantaeneFaellig(quarantaene.eintraege, heute)) {
    console.error(`::warning::QUARANTAENE: ${e.ticker} ist seit ${e.pruefungBis} zur Wiedervorlage faellig (aufgenommen ${e.aufgenommen}, Beleg ${e.beleg}). Nachziehen oder austragen — nicht einschlafen lassen.`);
  }

  // T612-M1 (Review Tag 612): ein Register-Eintrag, zu dem gar keine Datei im Eingang liegt, war
  // still wirkungslos — ein Tippfehler (oder ein delisteter/umbenannter Name) haette das Register
  // dauerhaft leerlaufen lassen, ohne dass es irgendwo auffaellt. Kein Hardstop: der Zustand ist
  // beim Delisting legitim, und ein toter Eintrag schadet nichts ausser seiner eigenen Wirkung.
  // Nur "Datei gar nicht im Eingang" ist der Warnfall — ein Treffer, der ausgeschlossen wurde,
  // ist genau der Normalbetrieb.
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
  //
  // Die Quarantaene gehoert aus DEMSELBEN Grund abgezogen: ihre Treffer zaehlen in `gescannt`,
  // landen aber nie in `uebersprungen`. Ohne den Abzug haette schon der erste Eintrag (VMRK)
  // denselben T612-H1-Schaden ein zweites Mal angerichtet und den ALL-Stop abgeschaltet.
  const zuPruefen = gescannt - navAusgeschlossen.length - quarantaeneAusgeschlossen.length;

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

  // DAS EINZIGE LOCH IM AUSSCHLUSS: dieser Schritt KOPIERT nur, er raeumt das Ziel nicht ab.
  // In CI ist das folgenlos (frischer Runner, `snapshots/` ist gitignoriert und existiert
  // beim Checkout gar nicht), lokal kann aber ein Stand aus einem Lauf VOR der Aufnahme
  // liegenbleiben — der Ausschluss saehe im Log wirksam aus und das Scoring bekaeme die
  // vergiftete Zeile trotzdem. Nicht selbst geloescht (Karl-Entscheid F-12: filtern, nie
  // loeschen), aber laut gemeldet, mit dem Handgriff in der Meldung.
  for (const [datei, ticker] of quarantaeneDateinamen) {
    if (fs.existsSync(path.join(ziel, datei))) {
      console.error(`::error::QUARANTAENE: ${ticker} ist ausgeschlossen, aber ${path.join(ziel, datei)} liegt noch aus einem frueheren Lauf im Ziel und wuerde weiter gescort. Diese Datei von Hand entfernen (der Eingang behaelt sie).`);
      return 1;
    }
  }
  schreibeEingangsZahl(ziel, gescannt); // F-12-R1: NACH dem Kopieren (das Manifest kommt aus dem Eingang mit)

  // M10/M8 — TRIPWIRE-ROHDATEN, GELESEN VOR JEDER UMBENENNUNG.
  // Die Stelle ist die Auflage, nicht Geschmack (Urteil §3.2): U2/U3/T179 vereinheitlichen
  // gleich Namen, und genau die Divergenz, die dieser Baustein sehen soll, verschwindet dabei.
  // Ein Wächter, der nichts sieht, sobald das bewachte Objekt wirkt, misst die Abwesenheit
  // seines Gegenstands. GEMELDET wird trotzdem erst ganz am Schluss (sequenziell, fail-open).
  let tripwireRoh = null;
  try {
    tripwireRoh = tripwireLesen(ziel);
  } catch (e) {
    console.error(`::warning::M10-Tripwire — Rohdaten nicht erhoben (${e && e.message ? e.message : e}); Anker A UND B fallen heute aus. Der Lauf laeuft weiter (reine Meldung, keine Datenwirkung).`);
  }

  // U2-BO/NS: NACH dem Kopieren, damit der Eingang unangetastet bleibt (Karl-Entscheid F-12:
  // filtern statt loeschen — hier entsprechend: nur die Arbeitskopie bekommt den Namen).
  const zwillinge = wendeWurzelZwillingeAn(ziel, uebernehmen);
  // Die Ausfallzahlen gehoeren AN diese Zeile: ohne sie lautet die Meldung bei
  // Totalausfall "0 von 0 .BO/.NS-Beinen ... gesetzt" und ist nicht von "keine
  // Zwillinge im Bestand" zu unterscheiden — dieselbe Zeile fuer zwei Weltzustaende.
  console.log(`[u2-wurzelzwillinge] ${zwillinge.geheilt.length} von ${zwillinge.kandidaten} .BO/.NS-Beinen auf den Emittenten-Namen des Zwillings gesetzt${zwillinge.geheilt.length ? ` (${zwillinge.geheilt.join(', ')})` : ''}; nicht lesbar: ${zwillinge.unlesbar}, nicht schreibbar: ${zwillinge.unschreibbar}. Zusammengefuehrt wird weiterhin ausschliesslich im Dedup (issuerKeyLoose + splitFalseIssuerMerges); hier wird kein Bein entfernt.`);

  // U3-Milan (ENTSCHIED 31): NACH der .BO/.NS-Strecke, gleiche Bauform, gleiche Stelle — und
  // erst NACH dem Kopieren, damit der Eingang unangetastet bleibt.
  const milan = milanKlassenLesen(ziel, MILAN_KANDIDATEN, identitaetsEintraege);
  const { umbenennungen: milanPlan, urteile, kollisionen } = milanUmbenennungen(milan.klassen, milan.mehrfachAbdruecke);
  const ausListe = urteile.filter((u) => u.quelle === 'kandidatenliste');
  const ausRegister = urteile.filter((u) => u.quelle === 'identitaets-register');
  const geplanteBeine = ausListe.reduce((s, u) => s + u.verlierer.length, 0);
  const geplanteGruppen = ausListe.filter((u) => u.grund === 'umbenennen').length;

  // A10 — Laufzeit-Ausweis: JEDE Umbenennung mit beiden Tickern, keine stille Wirkung. Auch die
  // Nein-Faelle stehen hier, sonst waere "hat das Tor gehalten oder gar nicht erst gegriffen?"
  // aus dem Log nicht beantwortbar.
  for (const u of urteile) {
    if (u.grund === 'umbenennen') {
      console.log(`[u3-milan] ${u.verlierer.join(' + ')} -> Emittenten-Name von ${u.sieger} ("${u.name}") [${u.beine.join(' + ')}, Quelle ${u.quelle}]`);
    } else {
      console.log(`[u3-milan] ${u.anker}: keine Umbenennung (${u.grund}) [${u.beine.join(' + ')}, Quelle ${u.quelle}]`);
    }
  }

  // Widerspruechliche Identitaets-Aussage: ein Bein, zwei Klassen, zwei Namen. Vor jedem
  // Mengen-Riegel und vor jedem Schreiben — die betroffenen Klassen sind bereits verworfen,
  // aber ein Widerspruch im Kandidaten-/Registerbestand ist ein Pflege-Fehler, kein Betriebszustand.
  if (kollisionen.length) {
    for (const k of kollisionen) {
      console.error(`::error::U3-Milan — Kollision: ${k.ticker} soll gleichzeitig "${k.wollte}" (Klasse ${k.anker}) und "${k.steht}" (Klasse ${k.von}) heissen. Beide Klassen sind verworfen.`);
    }
    console.error(`::error::U3-Milan — ${kollisionen.length} widerspruechliche Identitaets-Aussage(n). Stop: ein Bein gehoert zu genau EINEM Emittenten. Kandidatenliste und Identitaets-Register in Deckung bringen.`);
    return 1;
  }

  // A7 — Mengen-Riegel. VOR dem Schreiben, damit ein Abbruch keinen halb umbenannten Bestand
  // hinterlaesst. Harter Abbruch, kein ::warning:: (2:1 gegen J2s Sondervotum, s. Urteil §4).
  //
  // Die Mindest-Fallzahl ist dieselbe wie beim Karteileichen-Anteil oben und aus demselben Grund
  // (s. MIN_GESCANNT_FUER_ANTEIL): eine Zahl aus einer Handvoll Dateien ist kein Befund, sondern
  // eine andere Population. Real kommen ~12.500 Snapshots an; die 17 Mailaender Anker stehen dort
  // seit Monaten. Ein Bestand unter 100 ist entweder eine Fixture oder eine Katastrophe, die das
  // Coverage-Gate faengt — der Riegel wuerde dort nur denselben Alarm ein zweites Mal schlagen.
  // Still ist das nie: der Ueberspring-Fall wird ausgewiesen.
  //
  // ZWEITE Ausnahme, aus demselben Grund: liegt von der eingefrorenen Liste ueberhaupt KEIN Bein
  // im Bestand, ist das keine Mengen-Abweichung, sondern ein anderes Universum (Fixture,
  // Teil-Shard, Kaltstart). Sobald auch nur EIN Anker da ist, bindet der Riegel wieder voll —
  // ein Bestand, aus dem die Haelfte der Anker verschwunden ist, bricht also ab.
  // Gezaehlt werden DATEIEN, nicht auswertbare Beine: sonst schaltet ein systemischer Lesefehler
  // ueber alle Anker den Riegel ab und die Log-Zeile sieht aus wie der harmlose Fall.
  if (zuPruefen < MIN_GESCANNT_FUER_ANTEIL || milan.kandidatenDateien === 0) {
    console.log(`[u3-milan] Mengen-Riegel uebersprungen: ${zuPruefen} zu pruefende Snapshots, ${milan.kandidatenDateien} Dateien der Kandidatenliste im Bestand, ${milan.lesefehler.length} nicht auswertbar. Geplant waren ${geplanteBeine} Beine in ${geplanteGruppen} Gruppen.`);
  } else if (geplanteBeine !== MILAN_ERWARTETE_BEINE || geplanteGruppen !== MILAN_ERWARTETE_GRUPPEN) {
    // FX5 — ZENSUS IN DIE ABBRUCHZEILE: `milanBeine` und die Zahl der mehrdeutigen Abdruecke
    // beantworten die erste Triage-Frage — "hat sich die EBENE bewegt oder die MENGE?" — ohne
    // Nachmessung. FX6 — DIE FX-URSACHENKLASSE: bei FX-Desync ist die Population unveraendert,
    // und die Kandidatenliste neu vorzulegen waere exakt der falsche Griff.
    console.error(`::error::U3-Milan — Mengen-Riegel gerissen: ${geplanteBeine} umbenannte Beine / ${geplanteGruppen} kollabierte Gruppen, erwartet ${MILAN_ERWARTETE_BEINE}/${MILAN_ERWARTETE_GRUPPEN}. Kein Bein wurde angefasst. Zensus dieses Laufs: ${milan.milanBeine} Mailaender Beine geprueft, ${milan.mehrfachAbdruecke.size} mehrdeutige Fingerabdruecke. ${milan.lesefehler.length} Kandidaten-Datei(en) waren nicht auswertbar${milan.lesefehler.length ? ` (${milan.lesefehler.map((f) => f.ticker).join(', ')})` : ''}. Erst \`meta.fxRateApplied\` der Beine paarweise vergleichen; Kandidatenliste nur bei tatsaechlicher Mengenaenderung neu vorlegen. Auflage A7 des Milan-Urteils (ENTSCHIED 31): die eingefrorene Kandidatenliste gehoert neu vorgelegt, NICHT die Zahl nachgezogen. Nachmessen: node scripts/probe-fingerprint-zensus.js`);
    return 1;
  }

  // A5-INTEGRITAETS-RIEGEL — ein unlesbares MAILAENDER Bein bricht den Lauf ab.
  //
  // WARUM DAS KEIN "zweiter Hardstop" IM SINNE VON FX17 IST: FX17 verbietet einen zweiten harten
  // Abbruch auf die A5-MENGE — auf eine Zahl also, die in einer Wetter-Population driftet und zum
  // Hochdrehen einlaedt. Dieser Riegel haengt an keiner Zahl, sondern an der Datenintegritaet des
  // A5-Index, und er deckt genau die Luecke, die A7 STRUKTURELL NICHT SEHEN KANN:
  //   - Ist ein KANDIDATEN-Bein unlesbar, faellt `geplanteBeine` unter 18 und A7 oben bricht
  //     bereits ab. Dieser Fall kommt hier gar nicht mehr an.
  //   - Ist eines der ~857 uebrigen Mailaender Beine unlesbar, bewegt sich KEINE Zaehlgroesse:
  //     das Bein faellt per `if (!b || …) continue` (fail-OPEN) aus dem Mehrdeutigkeits-Index,
  //     `mehrfachAbdruecke` schrumpft, und eine Klasse, die als 'mehrdeutig' haette scheitern
  //     muessen, wird umbenannt. Gemessen am Fixture: mit drei lesbaren Beinen greift A5
  //     (`mehrfachAbdruecke.size` 1, Urteil 'mehrdeutig'); verliert das zweite Mailaender Bein
  //     seinen Kurs, steht es zwar im Ausweis, aber die Menge faellt auf 0 und die Klasse WIRD
  //     umbenannt. Der Ausweis (FX4) macht den Kanal sichtbar — er schliesst ihn nicht.
  //
  // Die Fehlerrichtung ist die teuerste, die dieses Modul kennt: eine Fehlverschmelzung loescht
  // eine echte Firma, ein Abbruch kostet einen Board-Tag. Deshalb dieselbe Haltung wie A7:
  // hart, VOR jeder Mutation, kein Bein wird angefasst.
  const milanBeineUnlesbar = milan.lesefehler.filter((f) => MILAN_SPIEGEL.test(f.ticker));
  if (milanBeineUnlesbar.length) {
    console.error(`::error::U3-Milan — A5-Integritaet gerissen: ${milanBeineUnlesbar.length} Mailaender Bein(e) nicht auswertbar (${milanBeineUnlesbar.map((f) => f.ticker).join(', ')}). Kein Bein wurde angefasst. Ein unlesbares Mailaender Bein faellt fail-OPEN aus dem A5-Mehrdeutigkeits-Index; eine Klasse, die als 'mehrdeutig' haette scheitern muessen, wuerde still umbenannt — und eine Fehlverschmelzung loescht eine echte Firma. Erst die Datei reparieren oder ihren fehlenden \`meta.fxRateApplied\` klaeren, dann erneut laufen. NICHT die Kandidatenliste neu vorlegen: die Population ist unveraendert.`);
    return 1;
  }

  const milanGeschrieben = milanSchreiben(ziel, milanPlan);
  if (milanGeschrieben.unschreibbar > 0) {
    console.error(`::error::U3-Milan — ${milanGeschrieben.unschreibbar} von ${milanPlan.size} beschlossenen Umbenennungen sind nicht geschrieben worden. Der Bestand ist halb vereinheitlicht; Stop statt eines Boards auf halbem Stand.`);
    return 1;
  }
  // FX4 — `lesefehler` GEHOERT AUCH IN DEN GRUEN-PFAD. Der A5-Index ist fail-OPEN: ein
  // unlesbares Mailaender Bein faellt oben per `if (!b || …) continue` aus dem
  // Mehrdeutigkeits-Index heraus, und eine Klasse, die als 'mehrdeutig' haette scheitern
  // muessen, passiert — leise. Die Kanonisierung erzeugt diese Asymmetrie nicht, sie
  // verbreitert ihre Ausloeseflaeche von "kaputtes JSON" auf "kaputtes JSON ODER fehlender
  // Kurs". Weil `lies()` seine Nicht-ENOENT-Fehler in dieselbe `lesefehler`-Liste schreibt,
  // schliesst der Ausweis hier die Luecke mechanisch, nicht kosmetisch: ein stiller Erfolgslauf
  // mit Lesefehlern ist ab sofort nicht mehr still.
  console.log(`[u3-milan] ${milanGeschrieben.geschrieben.length} Beine in ${geplanteGruppen} Gruppen auf den Emittenten-Namen gesetzt (${milan.milanBeine} Mailaender Beine geprueft, ${milan.mehrfachAbdruecke.size} mehrdeutige Fingerabdruecke, ${milan.lesefehler.length} nicht auswertbar${milan.lesefehler.length ? ` (${milan.lesefehler.map((f) => f.ticker).join(', ')})` : ''}, Identitaets-Register: ${identitaetsEintraege.length} Eintraege / ${ausRegister.filter((u) => u.grund === 'umbenennen').length} wirksam). Zusammengefuehrt wird weiterhin ausschliesslich im Dedup; hier wird kein Bein entfernt.`);

  // T179-Nennwert: NACH U3-Milan, und die Reihenfolge ist SICHERHEIT, nicht Geschmack.
  //
  // `472.DE` ("CELLNEX TELECOM SA EO-,25") ist ein Nennwert-Treffer UND zugleich das
  // Partner-Bein der Milan-Klasse `1CLNX.MI`. Liefe N1 VOR Milan, waeren beide Schluessel
  // schon gleich (`cellnextelecomsa`), `milanTor` gaebe 'schon-vereint' zurueck, der
  // Mengen-Riegel A7 zaehlte 17/16 statt 18/17 — und der GANZE Tageslauf braeche ab.
  // Am Live-Bestand 2026-08-30 nachgemessen: genau eine der 17 Milan-Klassen kippt so
  // (`1CLNX.MI`; `1GEBN.MI`/`GBRA.DE` wird zwar auch beruehrt, behaelt aber zwei Schluessel).
  //
  // Nach Milan ist der Fall harmlos: Milan hat `472.DE` da bereits den sauberen Namen des
  // Mailaender Beins aufgepraegt, das Anhaengsel ist weg, und N1 findet dort nichts mehr zu
  // tun. Der ENDZUSTAND ist in beiden Reihenfolgen identisch — nur diese haelt den vom
  // Milan-Urteil gesetzten Stolperdraht am Leben. Wer N1 vorzieht, dreht damit A7 ab.
  const nennwert = wendeNennwertAn(ziel, uebernehmen);
  console.log(`[t179-nennwert] ${nennwert.geheilt.length} von ${nennwert.kandidaten} Namen um das XETRA-Nennwert-Anhaengsel gekuerzt${nennwert.geheilt.length ? ` (${nennwert.geheilt.join(', ')})` : ''}; nicht lesbar: ${nennwert.unlesbar}, nicht schreibbar: ${nennwert.unschreibbar}. Zusammengefuehrt wird weiterhin ausschliesslich im Dedup; hier wird kein Bein entfernt.`);
  if (nennwert.geplant > NENNWERT_ANKER) {
    // Befund §B5 Waechter 3: das Anwachsen ist der gefaehrliche Fall — N1 kann Verschmelzungen
    // ERZWINGEN (Kipp-Bedingung), und jeder neue Treffer ist ein ungeprueftes Paar.
    console.error(`::warning::T179-Nennwert — ${nennwert.geplant} Treffer, Anker ist ${NENNWERT_ANKER} (Live-Bestand 2026-08-30). Jeder zusaetzliche Treffer ist ein Neubefund und braucht die Fremdpaar-Gegenprobe aus Befund §B4, bevor er als Normalzustand gilt.`);
  }

  const navTickerListe = navAusgeschlossen.map((f) => f.slice(0, -'.json'.length)).sort();
  console.log(`NAV-Register: ${navTickerListe.length} Namen vom Scoring ausgeschlossen (${navTickerListe.join(', ')})`);
  const anteil = gescannt > 0 ? (uebersprungen.length / gescannt * 100).toFixed(1) : '0.0';
  console.log(`[f12-filter] ${uebersprungen.length} von ${gescannt} Snapshots uebersprungen (kein Watchlist-Eintrag) = ${anteil} % — ${uebernehmen.length} Dateien nach ${ziel} uebernommen. Nichts geloescht: ${eingang} bleibt vollstaendig. Eingangs-Zahl fuer den Coverage-Floor: ${MANIFEST_EINGANG_FELD}=${gescannt}.`);

  // ── M10/M1 + M5 (Urteil _COURT-M10-2026-08-30) — REINE MESSUNG, ganz am Schluss ──────────
  // SEQUENZIELL und ZULETZT: dieser Schritt liest den Bestand, den alle Stufen davor
  // hinterlassen haben, und aendert nichts mehr. Ein Wurf hier darf den Tageslauf niemals
  // faellen (Praezedenz: der harte Tageslauf-Abbruch aus einer Vorstufen-Reihenfolge,
  // orchestrator-2026-08-29.md:554) — deshalb faengt der Mantel ALLES und weist die
  // Degradation aus. Eine still ausfallende Messung ist keine Messung.
  // ZWEI GETRENNTE MAENTEL, nicht einer (Review-Fund 30.08., MEDIUM). M5 ist ein Diagnose-
  // Protokoll, M1 ist die Auflage MIT FRIST — und M1 lag im selben try wie der komplexere
  // M5-Teil (Array-Bau, Datei-Nachlesen, `safeSnabshotFilename`, das bei einem kaputten Ticker
  // wirft). Ein Wurf auf der M5-Seite haette die M1-Tageszeile still verschluckt, und die
  // Warnzeile haette nicht gesagt, welche Haelfte gebrochen ist. Genau der Verlust, den die
  // Frist verhindern soll.
  let protokoll = null;
  try {
    // M5: die Quell-Herkunft der U3-Milan-Umbenennungen wird REIN LESEND nachgeholt (Urteil
    // §7: `milanSchreiben`/U3 ist N1 und wird nicht angefasst). Der Sieger wird von keiner
    // Stufe umgeschrieben, sein `nameSource` ist also unveraendert.
    const milanProtokoll = [];
    let siegerUnlesbar = 0;
    for (const u of urteile) {
      if (u.grund !== 'umbenennen') continue;
      const nachlese = siegerHerkunftNachlesen(ziel, u.sieger);
      if (nachlese.unlesbar) {
        siegerUnlesbar++;
        console.error(`::warning::M10-Protokoll (M5) — Sieger-Bein ${u.sieger} nicht nachlesbar (${nachlese.grund}); seine Herkunft zaehlt als (unlesbar), nicht als fehlend. Die Umbenennung selbst ist davon unberuehrt.`);
      }
      for (const v of u.verlierer) {
        milanProtokoll.push({ kanal: 'U3-Milan', verlierer: v, sieger: u.sieger, name: u.name, quelleHerkunft: nachlese.herkunft });
      }
    }
    protokoll = umbenennungsProtokoll([...(zwillinge.protokoll || []), ...milanProtokoll]);
    console.log(`[m10-umbenennungs-protokoll] ${protokoll.gesamt} Umbenennungen in der Vorstufe, je Herkunft des Quell-Beins: ${JSON.stringify(protokoll.jeHerkunft)} (${siegerUnlesbar} Sieger-Beine nicht nachlesbar). Kein Bein wurde deswegen anders behandelt — das Protokoll beobachtet nur (Auflage M5).`);
    console.log(`[m10-umbenennungs-protokoll] watchlist-benannte Quell-Beine: ${protokoll.watchlistFaelle.length} — ${protokoll.watchlistFaelle.join(', ') || '(keine)'}`);
  } catch (e) {
    console.error(`::warning::M10-Protokoll (M5) — Interims-Protokoll ausgefallen (${e && e.message ? e.message : e}). Der Herkunfts-Zaehler (M1) laeuft davon UNBERUEHRT weiter; im Tages-Eintrag fehlt nur das Feld 'umbenennungen'.`);
  }

  try {
    const { zeilen, unlesbar: mUnlesbar } = namensherkunftLesen(ziel);
    const zaehlung = namensherkunftZaehlen(zeilen);
    const summe = Object.values(zaehlung.verteilung).reduce((a, b) => a + b, 0);
    if (summe !== zaehlung.gelesen) {
      // Kann nur brechen, wenn jemand die Bucket-Zuordnung aufweicht. Dann ist die Reihe
      // falsch, und eine falsche Messreihe ist schlimmer als eine fehlende.
      throw new Error(`Bucket-Arithmetik gerissen: Summe ${summe} !== gelesene Zeilen ${zaehlung.gelesen}`);
    }
    // `umbenennungen: null` statt eines stillen Weglassens: ein fehlendes Feld waere von
    // "an diesem Tag wurde nichts umbenannt" nicht zu unterscheiden.
    const eintrag = { ...zaehlung, unlesbar: mUnlesbar, umbenennungen: protokoll };
    const tage = namensherkunftSchreiben(namensherkunftPfad, String(heute).slice(0, 10), eintrag);
    console.log(`[m10-namensherkunft] ${zaehlung.gelesen} Zeilen gezaehlt (${mUnlesbar} nicht lesbar): ${JSON.stringify(zaehlung.verteilung)}; ${zaehlung.mehrbeinGruppen} mehrbeinige Emittentengruppen, davon ${zaehlung.watchlistSieger} mit Sieger nameSource='watchlist' (${zaehlung.unterdrueckteBeine} unterdrueckte Beine). Reihe: ${tage} Tage in ${namensherkunftPfad}. REINE MESSUNG — kein Gate, kein Konsument.`);
  } catch (e) {
    console.error(`::warning::M10-Herkunftszaehler — Messung ausgefallen (${e && e.message ? e.message : e}). Der Lauf laeuft weiter (Exit 0, reine Messung), aber die Tageszeile FEHLT in ${namensherkunftPfad}. Auflage M1 (_COURT-M10-2026-08-30) hat Frist 20.09.2026 — ein wiederholter Ausfall ist ein Befund, kein Wetter.`);
  }

  // ── M10/M8-M16 — DER IDENTITAETS-TRIPWIRE, MELDEND, ZULETZT, FAIL-OPEN ───────────────────
  // Jeder Anker faengt SEINEN Wurf selbst: faellt A aus, meldet B trotzdem. Eine gemeinsame
  // Klammer haette aus einem kaputten Anker ein stilles Doppel-Aus gemacht, und die Meldung
  // haette nicht gesagt, WELCHE Lampe erloschen ist (Auflage M8).
  if (!tripwireRoh) {
    console.error('::warning::M10-Tripwire — keine Rohdaten (s. Meldung oben): Anker A und Anker B melden heute nicht.');
  } else {
    let a = null, b = null;
    try { a = tripwireAnkerA(tripwireRoh.zeilen); }
    catch (e) { console.error(`::warning::M10-Tripwire — ANKER A ausgefallen (${e && e.message ? e.message : e}); Anker B meldet weiter.`); }
    try { b = tripwireAnkerB(tripwireRoh.zeilen); }
    catch (e) { console.error(`::warning::M10-Tripwire — ANKER B ausgefallen (${e && e.message ? e.message : e}); Anker A meldet weiter.`); }
    // M11: ZWEI Zaehlgroessen, nie eine. Ein OR-verschmolzenes Boolean waere genau die
    // Meldeform, die das Urteil ausschliesst — man koennte einer Meldung nicht mehr ansehen,
    // welcher Anker sie erzeugt hat und mit welchem Wert.
    if (a) console.log(`[m10-tripwire] Anker A (Selbstwiderspruch Aktienzahl): ${a.treffer.length} Meldungen, ${a.ausgenommen} Komplementaer-/Partnership-Strukturen ausgenommen (M12), ${a.ohneBasis} Zeilen ohne rechenbare Basis.`);
    if (b) console.log(`[m10-tripwire] Anker B (geteilte Jahresumsatz-Reihe ueber >=2 Emittentengruppen): ${b.treffer.length} Klassen. MELDUNG, NIE BEGRUENDUNG (M13).`);
    console.log('[m10-tripwire] Erkennung und Meldung sind erlaubt; jede Verschmelzungs-Entscheidung auf Basis dieser Erkennung bleibt bis zu einem eigenen Gericht gesperrt (M16). Keine Zeile faellt, keine verschmilzt, Exit bleibt 0.');
    try {
      // Auch bei nur EINEM lebenden Anker wird geschrieben (Review-Fund 30.08.): sonst nimmt
      // ein Wurf in A die fertig gerechneten Meldungen von B aus der committeten Datei, und
      // die fail-open-Zusage gaelte nur fuers fluechtige Log. Der ausgefallene Anker steht im
      // Bericht als `ausgefallen: true`, nie als 0.
      const bericht = tripwireBericht(a, b, {
        stand: String(heute).slice(0, 10),
        gelesen: tripwireRoh.zeilen.length,
        unlesbar: tripwireRoh.unlesbar,
        messebene: 'vor den Umbenennungs-Stufen U2/U3/T179 dieses Laufs',
      });
      fs.mkdirSync(path.dirname(tripwirePfad), { recursive: true });
      writeFileAtomic(tripwirePfad, JSON.stringify(bericht, null, 2) + '\n');
      console.log(`[m10-tripwire] Bericht geschrieben: ${tripwirePfad} (Detaillisten bei ${TRIPWIRE_KAPPUNG} je Anker gekappt, Zaehlungen vollstaendig).`);
    } catch (e) {
      console.error(`::warning::M10-Tripwire — Bericht nicht geschrieben (${e && e.message ? e.message : e}). Die Zahlen stehen oben im Lauf-Log, der committete Bericht FEHLT heute.`);
    }
  }
  return 0;
}

module.exports = { autorisierteDateinamen, ladeNavRegister, teileEingang, run, MAX_UEBERSPRUNGEN_ANTEIL, MIN_GESCANNT_FUER_ANTEIL, MANIFEST_EINGANG_FELD, DRIFT_VENTIL, ventilObergrenze,
  // U2-BO/NS (ENTSCHIED 21) — fuer TDD. Waechter: tests/u2-wurzelzwillinge.test.js
  istPlatzhalter, besseresBein, wurzelZwillingsUmbenennungen, wendeWurzelZwillingeAn, WURZEL_ZWILLING,
  // U3-Milan (ENTSCHIED 31) — fuer TDD. Waechter: tests/u3-milan-spiegel.test.js
  milanReihe, milanEndlicheQuartale, milanFingerabdruck, milanTor, milanSieger, milanUmbenennungen,
  milanKlassenLesen, milanSchreiben, ladeIdentitaetsRegister,
  // M10/M17 (_COURT-M10-2026-08-30) — Aufnahmeschwelle. Waechter: tests/u3-milan-spiegel.test.js
  IDENTITAETS_REGISTER_ANKER, IDENTITAETS_BELEG_PFLICHTFELDER, IDENTITAETS_REGISTER_STANDARDPFAD,
  MILAN_SPIEGEL, MILAN_KANDIDATEN, MILAN_MIN_QUARTALE, MILAN_SHARES_BAND,
  MILAN_ERWARTETE_BEINE, MILAN_ERWARTETE_GRUPPEN,
  // T179-Nennwert (ENTSCHIED 35.2) — fuer TDD. Waechter: tests/t179-nennwert.test.js
  nennwertStrip, nennwertUmbenennungen, wendeNennwertAn, NENNWERT_KUERZEL, NENNWERT_ANKER,
  // Quarantaene (ENTSCHIED 37) — fuer TDD. Waechter: tests/quarantaene.test.js
  ladeTickerRegister, ladeQuarantaene, quarantaeneFaellig,
  QUARANTAENE_STANDARDPFAD, QUARANTAENE_PFLICHTFELDER, NAV_PFLICHTFELDER,
  // M10/M1 + M5 (_COURT-M10-2026-08-30) — fuer TDD. Waechter: tests/m10-namensherkunft-zaehler.test.js
  namensherkunftBucket, namensherkunftZaehlen, namensherkunftLesen, namensherkunftSchreiben,
  umbenennungsProtokoll, siegerHerkunftNachlesen, NAMENSHERKUNFT_BUCKETS, namensherkunftStandardpfad,
  // M10/M8-M16 Identitaets-Tripwire — fuer TDD. Waechter: tests/m10-tripwire.test.js
  tripwireAnkerA, tripwireAnkerB, tripwireLesen, tripwireBericht, tripwireStandardpfad,
  TRIPWIRE_A_BAND, TRIPWIRE_KOMPLEMENTAERFORM, TRIPWIRE_KAPPUNG };
if (require.main === module) process.exit(run(process.argv));
