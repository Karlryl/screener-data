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
const { issuerKeyLoose, issuerKeyStrengOhneGattung } = require('../src/scoring/score.js');
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
      unschreibbar++;
      console.error(`::warning::U2-Wurzelzwillinge — ${datei} nicht schreibbar (${e.message}); Bein bleibt getrennt.`);
    }
  }
  return { kandidaten: staende.length, geheilt: geheilt.sort(), unlesbar, unschreibbar };
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
 */
function ladeIdentitaetsRegister(registerPfad) {
  let roh;
  try { roh = JSON.parse(fs.readFileSync(registerPfad, 'utf8')); }
  catch (e) { throw new Error(`${registerPfad}: ${e.message}`); }
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) throw new Error(`${registerPfad}: Wurzel muss ein Objekt sein`);
  const eintraege = roh.eintraege;
  if (!Array.isArray(eintraege)) throw new Error(`${registerPfad}: Feld 'eintraege' muss ein Array sein`);
  const ids = new Set();
  const belegteTicker = new Map();
  for (const [i, e] of eintraege.entries()) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error(`${registerPfad}: Eintrag ${i} ist kein Objekt`);
    for (const feld of ['kanonisch', 'beleg', 'aufgenommen']) {
      if (typeof e[feld] !== 'string' || !e[feld].trim()) throw new Error(`${registerPfad}: Eintrag ${i}, Feld ${feld} fehlt/ist leer`);
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
  const heute = get('--heute', new Date().toISOString());

  // B1/B4: fail-closed wie das NAV-Register. Heute leer (B2) — ein Ladefehler stoppt den Lauf
  // trotzdem, sonst waere die spaetere Befuellung still wirkungslos.
  let identitaetsEintraege;
  try { identitaetsEintraege = ladeIdentitaetsRegister(identitaetsRegisterPfad); }
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
  return 0;
}

module.exports = { autorisierteDateinamen, ladeNavRegister, teileEingang, run, MAX_UEBERSPRUNGEN_ANTEIL, MIN_GESCANNT_FUER_ANTEIL, MANIFEST_EINGANG_FELD, DRIFT_VENTIL, ventilObergrenze,
  // U2-BO/NS (ENTSCHIED 21) — fuer TDD. Waechter: tests/u2-wurzelzwillinge.test.js
  istPlatzhalter, besseresBein, wurzelZwillingsUmbenennungen, wendeWurzelZwillingeAn, WURZEL_ZWILLING,
  // U3-Milan (ENTSCHIED 31) — fuer TDD. Waechter: tests/u3-milan-spiegel.test.js
  milanReihe, milanEndlicheQuartale, milanFingerabdruck, milanTor, milanSieger, milanUmbenennungen,
  milanKlassenLesen, milanSchreiben, ladeIdentitaetsRegister,
  MILAN_SPIEGEL, MILAN_KANDIDATEN, MILAN_MIN_QUARTALE, MILAN_SHARES_BAND,
  MILAN_ERWARTETE_BEINE, MILAN_ERWARTETE_GRUPPEN,
  // T179-Nennwert (ENTSCHIED 35.2) — fuer TDD. Waechter: tests/t179-nennwert.test.js
  nennwertStrip, nennwertUmbenennungen, wendeNennwertAn, NENNWERT_KUERZEL, NENNWERT_ANKER,
  // Quarantaene (ENTSCHIED 37) — fuer TDD. Waechter: tests/quarantaene.test.js
  ladeTickerRegister, ladeQuarantaene, quarantaeneFaellig,
  QUARANTAENE_STANDARDPFAD, QUARANTAENE_PFLICHTFELDER, NAV_PFLICHTFELDER };
if (require.main === module) process.exit(run(process.argv));
