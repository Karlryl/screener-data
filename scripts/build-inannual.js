'use strict';
/**
 * build-inannual.js — OFFLINE-Generator fuer Indien (analog build-twannual/-krannual/-jpannual).
 * ============================================================================================
 * Zieht die bei der NSE eingereichten SEBI-XBRL-Jahresergebnisse und schreibt
 * external-data/in-secannual.json im secAnnual-Format der Geschwisterdateien.
 *
 * QUELLE: National Stock Exchange of India (www.nseindia.com + nsearchives.nseindia.com),
 * schluessellos. Karl-Entscheid 19.08.2026: "voll nutzen wie jede andere Quelle" — er kennt
 * die NSE-Nutzungsbedingungen. Abrufrate trotzdem schonend (lib/fetch-retry.js, Pause je Host).
 *
 * ZWEI LISTEN, EIN FORMAT (beide live geprueft 19.08.2026 an OFSS/KALYANKJIL/CHENNPETRO):
 *   /api/integrated-filing-results  ab GJ 2025 — Q4-Datei traegt Jahr + Bilanz + Cashflow
 *   /api/corporates-financial-results?period=Annual  ab GJ 2018 — dieselben Elementnamen
 * Die dritte Quelle (/api/annual-reports-xbrl, Taxonomie ind-as) wird BEWUSST NICHT benutzt,
 * siehe "RESTATEMENT" unten — sie bringt keine zusaetzlichen Jahre, aber eine Falle.
 *
 * BOOTSTRAP: www.nseindia.com steht hinter Akamai. Ohne Browser-Kopfzeilen und Cookie-Jar
 * (bm_sz/_abck/ak_bmsc) antwortet die API mit 403. Zwei Aufwaerm-Abrufe auf die HTML-Seiten
 * setzen die Cookies; danach tragen sie alle API-Abrufe. Der Archiv-Host braucht nur Referer.
 *
 * =========================================================================================
 *  FALLE 1 — KONZERN GEGEN EINZELABSCHLUSS. Die teuerste, dritter Anlauf nach TW/JP.
 * =========================================================================================
 * Jede indische Firma reicht BEIDE Abschluesse als GETRENNTE Dateien ein. Live an OFSS,
 * Geschaeftsjahr 2024/25, dieselbe Kennzahl aus zwei Dateien desselben Tages:
 *     Konzern (Consolidated)   68.468.000.000 INR
 *     Einzel  (Standalone)     50.991.000.000 INR      -> Konzern liegt 34,3 % hoeher
 * Wer das verwechselt, misst eine andere Firma. ZWEI unabhaengige Riegel, beide Pflicht:
 *   (a) der Listen-Eintrag muss `consolidated: "Consolidated"` sagen, und
 *   (b) die DATEI SELBST muss `NatureOfReportStandaloneConsolidated = Consolidated` sagen.
 * Widersprechen sie sich, oder fehlt (b), wird KEIN Wert geschrieben. Bei Japan lagen Konzern
 * und Einzelzahl 145 % auseinander, ohne dass die vorgesehene Spalte es sagte — deshalb hier
 * nicht der Liste allein glauben.
 *
 * =========================================================================================
 *  FALLE 2 — DER JAHRES-KONTEXT LUEGT UEBER SEINE EIGENE PERIODE
 * =========================================================================================
 * Quartal (Kontext `OneD`) und kumuliertes Jahr (`FourD`) stehen nebeneinander. Bei OFSS
 * GJ2025: Q4 17.163.000.000 gegen Jahr 68.468.000.000 — Faktor 4. Den Jahreswert am
 * Kontext-NAMEN zu erkennen waere geraten; ihn an den xbrli-Kontextdaten zu erkennen ist
 * NACHWEISLICH FALSCH: in der aelteren Taxonomie (in-bse-fin, GJ2018-GJ2024) traegt der
 * FourD-Kontext dieselben Daten wie OneD. Live an OFSS GJ2024:
 *     <xbrli:context id="OneD">  2024-01-01 .. 2024-03-31
 *     <xbrli:context id="FourD"> 2024-01-01 .. 2024-03-31   <- Quartal, obwohl Jahresblock
 * Die WAHRE Periode steht als FAKT im jeweiligen Kontext:
 *     DateOfStartOfReportingPeriod [FourD] = 2023-04-01
 *     DateOfEndOfReportingPeriod   [FourD] = 2024-03-31     <- 366 Tage, das ist das Jahr
 * Genau daran wird der Jahres-Kontext bestimmt (330-400 Tage, Ende = Geschaeftsjahresende).
 * Das gilt in BEIDEN Taxonomien und ueberlebt jede Umbenennung der Kontext-IDs.
 * Kein passender Kontext = keine Jahreszahl -> Wurf. Mehrere passende Kontexte sind erlaubt,
 * muessen aber je Feld DENSELBEN Wert tragen; widersprechen sie sich, ist der Jahreswert nicht
 * entscheidbar -> Wurf. Nie "der letzte gewinnt".
 *
 * =========================================================================================
 *  FALLE 3 — DIE RUNDUNGSSTUFE IST KEIN FAKTOR
 * =========================================================================================
 * `LevelOfRounding` steht als TEXT in der Datei (Millions/Crores/Lakhs/Thousands). Sie
 * beschreibt die DARSTELLUNG, nicht die Einheit: die XBRL-Werte stehen IMMER in vollen
 * Rupien. Gemessen an zwei Firmen mit VERSCHIEDENER Rundungsstufe:
 *     OFSS       LevelOfRounding=Millions   RevenueFromOperations 68.468.000.000
 *     CHENNPETRO LevelOfRounding=Crores     RevenueFromOperations 786.107.900.000
 * Beide sind bereits volle Rupien (68.468 Mio. bzw. 78.610,79 Crore) — das Verhaeltnis 11,5
 * stimmt nur OHNE Umrechnung. Wer "Crores" als Faktor 10^7 anwendet, liegt um zehn Millionen
 * daneben. Darum: Wert ROH uebernehmen, Rundungsstufe nur als Pflichtfeld mitfuehren, und
 * einen SKALEN-Waechter dagegenstellen, der die Groessenordnung an einer bekannten Groesse
 * misst (Aktienzahl, siehe unten) statt an einem Bauchgefuehl.
 *
 * =========================================================================================
 *  FALLE 4 — GESCHAEFTSJAHR ENDET 31.03.
 * =========================================================================================
 * "GJ2026" = 01.04.2025-31.03.2026. Beschriftet wird nach dem ENDJAHR — dieselbe Achse, die
 * Yahoo und der Japan-Adapter benutzen (auch Japan hat den 31.03.). Eine eigene indische
 * Konvention waere der eigentliche Fehler, weil run-screener.js secAnnual-Reihen GEGEN die
 * Yahoo-Reihen derselben Firma legt. Zusaetzlich:
 *   - `fiscalYearEnd` steht je Firma in der Datei, damit der Versatz sichtbar ist;
 *   - der Stichtag (Monat/Tag) muss ueber alle Jahre einer Firma GLEICH sein — wechselt eine
 *     Firma ihr Geschaeftsjahr, entsteht ein 9- oder 15-Monats-"Jahr", das jede Wachstumsrate
 *     verfaelscht. Der 330-400-Tage-Riegel aus Falle 2 wirft solche Rumpfjahre schon vorher,
 *     der Stichtags-Waechter faengt den Rest.
 *
 * =========================================================================================
 *  FALLE 5 — ROHERTRAG IST IN INDIEN KEIN EIGENER TAG
 * =========================================================================================
 * Er wird aus den drei Aufwandsposten des Schedule III hergeleitet:
 *     Rohertrag = RevenueFromOperations
 *               - (CostOfMaterialsConsumed + PurchasesOfStockInTrade + ChangesInInventories)
 * BEI DIENSTLEISTERN TRAEGT DIE HERLEITUNG NICHT. OFSS meldet alle drei Posten als 0 — die
 * Formel gaebe Rohertrag = Umsatz, also 100 % Marge. Das ist keine Kennzahl, das ist eine
 * Falschaussage. Regel: sind alle vorhandenen Posten exakt 0, gibt es KEINEN Wert (null).
 * ⚠ ABWEICHUNG VOM AUFTRAGS-ANKER, bewusst und gemessen: der Auftrag nennt fuer KALYANKJIL
 * GJ2025 einen Rohertrag von 35.385 Mio. Das ist die ZWEI-Posten-Form ohne PurchasesOfStock-
 * InTrade. Die Drei-Posten-Form ergibt 32.842,55 Mio; die Differenz ist exakt der dritte
 * Posten (2.542,71 Mio zugekaufte Handelsware). Fuer einen Juwelier sind zugekaufte Waren
 * Wareneinsatz — sie wegzulassen ueberzeichnet die Marge um 7,7 % des Rohertrags. Hier gilt
 * die Drei-Posten-Form; tests/in-nse-adapter.test.js nagelt BEIDE Zahlen und die Differenz
 * fest, damit die Formel nicht still kippen kann.
 *
 * =========================================================================================
 *  RESTATEMENT — FESTE VORRANGREGEL, NIE MITTELN
 * =========================================================================================
 * Belegt an KALYANKJIL GJ2024, Umsatz:
 *     185.482.860.000  im Jahresergebnis vom 10.05.2024 (das GJ2024 selbst)
 *     185.155.510.000  im Jahresbericht-XBRL vom 30.09.2025 (Vorjahres-Vergleichszahl)
 * 0,18 % — bei Wachstumsraten kein Rauschen. Vorrangregel, in dieser Reihenfolge:
 *   1. Jedes Geschaeftsjahr kommt AUS SEINER EIGENEN Jahresmeldung. Vergleichszahlen aus
 *      spaeteren Meldungen werden NIE gelesen. Sonst mischte eine Wachstumsrate zwei
 *      Bilanzierungsstaende — und weil nur das juengste Jahr eine spaetere Fassung hat,
 *      waere die Reihe schon von der Bauart her uneinheitlich.
 *   2. Gibt es fuer DASSELBE Geschaeftsjahr mehrere Meldungen (Original + Revision, live bei
 *      OFSS GJ2026), gewinnt die ZULETZT verbreitete. Das ist eine Korrektur derselben
 *      Meldung, kein Standwechsel.
 * Genau deshalb bleibt /api/annual-reports-xbrl ungenutzt: es liefert keine zusaetzlichen
 * Jahre, nur die restated Vorjahreszahl — also nur die Falle.
 *
 * =========================================================================================
 *  WAS INDIEN LIEFERT (gemessen, nicht versprochen)
 * =========================================================================================
 * GJ2025 aufwaerts   GuV + Bilanz + Cashflow (Integrated Filing)
 * GJ2023-GJ2024      GuV + Bilanz + Cashflow
 * GJ2019-GJ2022      GuV, Cashflow nur wenn der Einreicher ihn in den Jahres-Kontext
 *                    gestellt hat (OFSS GJ2021 legte ihn in den QUARTALS-Kontext — dann
 *                    bleibt er null; kein Wert ist besser als ein moeglicher Quartalswert)
 * vor GJ2018         xbrl = "-" -> nur PDF, nicht nutzbar
 *
 * BILANZIERUNGSSTANDARD: Ind AS. NAH AN IFRS, NICHT IDENTISCH (Leasing-Uebergang,
 * Regulatory Deferral Accounts bei Versorgern). Steht als Pflichtfeld `accountingStandard`
 * = 'IND-AS' je Firma — eine Quelle, die den Standard nicht kenntlich macht, ist schlimmer
 * als keine Quelle.
 *
 * WAEHRUNG: INR, roh, KEINE Umrechnung — wie TW/KR/JP. `reportingCurrencyOriginal` traegt sie
 * fuer lib/annual-currency-guard. Absolute Niveaus gegen einen USD-Nenner zu rechnen bleibt
 * verboten (Befund 03.07.: KRW-Zaehler gegen USD-Nenner verfaelschte capitalEfficiency ~1000x).
 * Der Kanal wird von vorzeichen- und verhaeltnisbasierten Signalen gelesen (cycleSeriesPair,
 * roicStability) — die sind waehrungs-invariant.
 *
 * =========================================================================================
 *  WIEDERAUFNAHME — ein Vollbau braucht mehr als einen Lauf
 * =========================================================================================
 * Zweimal live gemessen: nach rund 35 Minuten Dauerabruf hoert NSE auf zu antworten (ECONNRESET
 * auf API UND Startseite, also auch auf jede Cookie-Auffrischung). Ein Vollbau ueber 53 Namen
 * dauert laenger. Der Adapter ist deshalb WIEDERAUFNEHMBAR gebaut: er liest den vorhandenen
 * Bestand ein, ergaenzt ihn und schreibt IMMER, bevor er rot wird. Denselben Befehl spaeter
 * erneut starten holt die fehlenden Namen nach — und zwar ZUERST, sonst verbraucht der
 * zweite Lauf sein Zeitfenster wieder mit den Namen, die schon dastehen. Eine Notbremse (MAX_FOLGE_AUSFAELLE) beendet
 * den Lauf, sobald drei Namen in Folge keine Antwort bekommen — gegen einen Host, der schon
 * Nein gesagt hat, weiterzuklopfen bringt nichts und ist unhoeflich.
 *
 * DETERMINISMUS wie die Geschwister: Netz NUR hier (offline). Die committete
 * in-secannual.json ist die deterministische Quelle; run-screener.js liest sie ohne Netz.
 */
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'external-data', 'in-secannual.json');
const { writeFileAtomic } = require(path.join(ROOT, 'lib/atomic-write.js'));
const { readJsonExistingOrThrow, FEHLT } = require(path.join(ROOT, 'lib/read-json.js'));
const { fetchBuffer } = require(path.join(ROOT, 'lib/fetch-retry.js'));

const BASIS = 'https://www.nseindia.com';
const AUFWAERMEN = [
  `${BASIS}/`,
  `${BASIS}/companies-listing/corporate-filings-financial-results`,
];
const MIN_JAHRE = 3;            // wie TW/KR/JP: weniger ist keine Reihe
const MAX_JAHRE = 9;            // GJ2018-GJ2026; aeltere Eintraege tragen xbrl = "-"
const NSE_PAUSE_MS = 1500;      // ueber dem Default (1200) — Gratis-Quelle ohne Vertrag
// Akamai-Sitzungen leben nicht ewig. LIVE GEMESSEN am Probelauf 19.08.2026: die ersten 37
// Ticker liefen sauber durch, danach beantwortete NSE jeden Abruf mit ECONNRESET bzw. lief in
// den Timeout — nach rund 35 Minuten. Ein Vollbau ueber 53 Namen dauert laenger als das.
// Darum wird der Cookie-Jar vorsorglich erneuert, und ein gescheiterter Listen-Abruf loest
// EINEN sofortigen Erneuerungsversuch aus. Ohne das ist der Adapter nur fuer kurze Laeufe
// brauchbar und faellt in einem Nachtlauf still auf halber Strecke aus.
const JAR_MAX_ALTER_MS = 8 * 60 * 1000;
// NOTBREMSE. Zweimal live gemessen (Probelauf 19.08.2026, beide Male nach rund 35 Minuten):
// NSE hoert irgendwann auf zu antworten und wirft ECONNRESET — auf die API UND auf die blanke
// Startseite, also auch auf jeden Auffrischungsversuch. Es ist keine abgelaufene Sitzung,
// sondern eine Drosselung. Weiterzumachen bringt dann nichts, kostet aber je Ticker ein
// Dutzend Wiederholungen gegen einen Host, der schon Nein gesagt hat. Nach drei Namen in
// Folge ohne Antwort wird abgebrochen — geschrieben wird trotzdem, und der naechste Lauf
// setzt fort: `main` liest den Altbestand ein und ergaenzt ihn nur (WIEDERAUFNAHME unten).
const MAX_FOLGE_AUSFAELLE = 3;

// Ein Jahres-Kontext muss zwischen 330 und 400 Tagen spannen. 366 ist der Normalfall;
// die Spanne laesst Schaltjahre und ein paar Tage Schlamperei zu, aber kein Rumpfjahr
// (Geschaeftsjahr-Wechsel: 9 oder 15 Monate) und kein Halbjahr.
const JAHR_MIN_TAGE = 330;
const JAHR_MAX_TAGE = 400;
const TAG_MS = 86400000;

// Die Rundungsstufen, die SEBI zulaesst. Ein unbekannter Wert faerbt rot — nicht weil er
// gerechnet wuerde (er wird NIE gerechnet), sondern weil eine neue Stufe bedeuten koennte,
// dass die Quelle ihre Werte-Konvention geaendert hat.
const RUNDUNGSSTUFEN = new Set(['Millions', 'Crores', 'Lakhs', 'Thousands', 'Actual', 'Billions']);

// Skalen-Riegel gegen Falle 3. Die Aktienzahl ist die einzige Groesse in der Datei, deren
// Groessenordnung von aussen bekannt ist: ein an der NSE notiertes Unternehmen hat zwischen
// hunderttausend und einer Billion Aktien. Wuerde jemand die Rundungsstufe als Faktor
// anwenden, verschoebe sich PaidUpValueOfEquityShareCapital um 10^6 bis 10^7 und die
// hergeleitete Aktienzahl fiele aus diesem Band. Der Nennwert (FaceValue) ist davon nicht
// betroffen — er ist ein rechtlicher Betrag je Aktie in Rupien (1/2/5/10) und wird nicht
// gerundet dargestellt. Genau diese Asymmetrie macht den Riegel scharf.
const AKTIEN_MIN = 1e5;
const AKTIEN_MAX = 1e12;

const XBRL_TOT = /\/-$/;        // "https://…/corporate/xbrl/-" = kein XBRL, nur PDF

// ───────────────────────────────────────────────────────────────────────────────────────
//  Die 53 indischen Top-30-Plaetze aus Karls Boards (board-history/2026-08-19, alle Reiter,
//  beide Kohorten). Bewusst eine EXPLIZITE Liste statt einer Ableitung aus board-history:
//  der Board-Stand aendert sich taeglich, der Generator soll deterministisch bleiben.
//  ⚠ NUR .NS. Karls Boards fuehren rund 250 weitere indische Namen mit .BO-Ticker (BSE).
//  Ein ".BO-Zwilling" laesst sich NICHT aus dem NSE-Symbol ableiten — TIINDIA.BO heisst an
//  der NSE TI, TMPV.BO heisst TMCV. Geraten waere genau der Fehler, den die Invarianten
//  verbieten; die .BO-Abdeckung braucht eine belegte Zuordnung (offener Punkt).
// ───────────────────────────────────────────────────────────────────────────────────────
const IN = [
  'ACUTAAS.NS', 'ADANIPOWER.NS', 'AEGISLOG.NS', 'ATGL.NS', 'ATHERENERG.NS', 'BAJAJHLDNG.NS',
  'BIKAJI.NS', 'CCL.NS', 'CHENNPETRO.NS', 'COFORGE.NS', 'CPPLUS.NS', 'CRAFTSMAN.NS',
  'CUPID.NS', 'ECLERX.NS', 'EMMVEE.NS', 'ENDURANCE.NS', 'ENRIN.NS', 'ETERNAL.NS',
  'FIRSTCRY.NS', 'FSL.NS', 'GODREJPROP.NS', 'GRANULES.NS', 'HCLTECH.NS', 'HEROMOTOCO.NS',
  'HINDCOPPER.NS', 'HINDPETRO.NS', 'KALYANKJIL.NS', 'LAURUSLABS.NS', 'LENSKART.NS',
  'LTM.NS', 'LTTS.NS', 'MANORAMA.NS', 'MCX.NS', 'MINDACORP.NS', 'MRPL.NS', 'OBEROIRLTY.NS',
  'OFSS.NS', 'PAYTM.NS', 'PERSISTENT.NS', 'PHOENIXLTD.NS', 'PWL.NS', 'QPOWER.NS',
  'RATEGAIN.NS', 'REDINGTON.NS', 'SAREGAMA.NS', 'TCS.NS', 'TDPOWERSYS.NS', 'TECHM.NS',
  'THYROCARE.NS', 'TI.NS', 'TSFINV.NS', 'VIJAYA.NS', 'WAAREEENER.NS',
];

const symbolVon = (tk) => tk.replace(/\.NS$/, '');

// ═══════════════════════════════════════════════════════════════════════════════════════
//  XBRL-Leser
// ═══════════════════════════════════════════════════════════════════════════════════════

const KONFLIKT = Symbol('zwei-verschiedene-werte');

/**
 * Zerlegt eine SEBI-XBRL-Instanz in Kontexte und Fakten. Reine Funktion, kein Netz.
 * Namensraum-agnostisch: in-capmkt (ab GJ2025) und in-bse-fin (GJ2018-GJ2024) benutzen
 * dieselben lokalen Elementnamen — an OFSS ueber sieben Geschaeftsjahre nachgezaehlt.
 * Darum EIN Parser statt zweier; der Namensraum wird nur als Herkunft mitgefuehrt.
 *
 * @returns {{taxonomie:string, kontexte:Map<string,{start,ende,instant,dims:number}>,
 *            fakten:Map<string,Map<string,(string|symbol)>>}}
 */
function parseXbrl(text) {
  const taxonomie = (/xmlns:(in-capmkt|in-bse-fin|ind-as)=/.exec(text) || [])[1] || null;

  const kontexte = new Map();
  for (const m of text.matchAll(/<xbrli:context id="([^"]+)"[^>]*>([\s\S]*?)<\/xbrli:context>/g)) {
    const rumpf = m[2];
    kontexte.set(m[1], {
      start: (/<xbrli:startDate>([^<]+)</.exec(rumpf) || [])[1] || null,
      ende: (/<xbrli:endDate>([^<]+)</.exec(rumpf) || [])[1] || null,
      instant: (/<xbrli:instant>([^<]+)</.exec(rumpf) || [])[1] || null,
      // Ein Kontext MIT Dimension ist eine Aufgliederung (Segment, Aufwandsposten,
      // Aktiengattung), nie der Gesamtwert — dieselbe Regel wie beim Japan-Adapter.
      // BEIDE Dimensionsformen. Ein typedMember ist genauso eine Aufgliederung wie ein
      // explicitMember; nur den einen zu zaehlen liesse die andere Form als Gesamtwert durch.
      dims: (rumpf.match(/xbrldi:(?:explicit|typed)Member/g) || []).length,
    });
  }

  const fakten = new Map();
  // ⚠ `contextRef` MUSS Teil des Musters sein, nicht erst hinterher geprueft werden.
  // Sonst passt das Wurzelelement <xbrli:xbrl …> … </xbrli:xbrl> als erstes und verschluckt
  // das GANZE Dokument — matchAll setzt danach hinter dem Dateiende auf und findet null
  // Fakten. Der Adapter haette still leere Firmen geliefert (beim Bau passiert, an der
  // 942-KB-Datei aufgefallen).
  for (const m of text.matchAll(/<([\w-]+):([\w.-]+)\s([^>]*?contextRef="([^"]+)"[^>]*?)>([\s\S]*?)<\/\1:\2>/g)) {
    const ctx = m[4];
    const wert = m[5];
    if (wert.length > 2000) continue;         // Textblock (Anhang, Pruefvermerk)
    const name = m[2];
    if (!fakten.has(name)) fakten.set(name, new Map());
    const je = fakten.get(name);
    const vorher = je.get(ctx);
    // Zwei verschiedene Werte fuer dieselbe Kennzahl im selben Kontext sind nicht
    // entscheidbar. NICHT hier werfen: das kommt in Feldern vor, die wir gar nicht lesen
    // (CashAndCashEquivalentsCashFlowStatement traegt Anfangs- UND Endbestand im selben
    // Kontext). Gemerkt wird es trotzdem — wer so ein Feld LIEST, bekommt den Wurf.
    if (vorher !== undefined && vorher !== wert) je.set(ctx, KONFLIKT);
    else if (vorher === undefined) je.set(ctx, wert);
  }
  return { taxonomie, kontexte, fakten };
}

/** Rohwert eines Fakts in einem bestimmten Kontext. Wirft bei Konflikt. */
function fakt(p, name, ctx, tk) {
  const je = p.fakten.get(name);
  if (!je) return null;
  const v = je.get(ctx);
  if (v === undefined) return null;
  if (v === KONFLIKT) {
    throw new Error(`${tk}: ${name} traegt im Kontext ${ctx} zwei verschiedene Werte. `
      + 'Welcher gilt, ist nicht entscheidbar — Abbruch statt stiller Auswahl.');
  }
  return v;
}

/**
 * Dokumentweite Pflichtangabe (Geschaeftsjahresende, Waehrung, Rundungsstufe). Diese Fakten
 * stehen in mehreren Kontexten derselben Datei und muessen ueberall DASSELBE sagen.
 *
 * ⚠ Nicht "erster Treffer gewinnt" (Review-Befund 19.08.2026): das Geschaeftsjahresende ist
 * die Achse, auf der alles andere sitzt. Traegt eine Datei zwei verschiedene, entscheidet
 * sonst die Map-Reihenfolge, welches Jahr gilt — eine stille Auswahl genau an der
 * empfindlichsten Stelle. Widerspruch = Wurf, wie bei allen Zahlenfeldern auch.
 */
function faktDokument(p, name, tk) {
  const je = p.fakten.get(name);
  if (!je) return null;
  let gefunden = null;
  for (const v of je.values()) {
    if (v === KONFLIKT) {
      throw new Error(`${tk}: ${name} traegt in einem Kontext zwei verschiedene Werte — `
        + 'nicht entscheidbar, Abbruch statt stiller Auswahl.');
    }
    if (gefunden != null && gefunden !== v) {
      throw new Error(`${tk}: ${name} sagt an zwei Stellen der Datei Verschiedenes `
        + `(${JSON.stringify(gefunden)} und ${JSON.stringify(v)}). Eine dokumentweite `
        + 'Pflichtangabe darf nicht mehrdeutig sein — Abbruch statt stiller Auswahl.');
    }
    gefunden = v;
  }
  return gefunden;
}

const zahl = (v) => {
  if (v == null || !/^-?\d+(\.\d+)?$/.test(String(v).trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const spanneTage = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / TAG_MS) + 1;

/**
 * DER WAECHTER DER YTD-FALLE (Falle 2).
 *
 * Liefert ALLE Kontexte, deren SELBSTGEMELDETE Berichtsperiode das volle Geschaeftsjahr ist —
 * nicht die, deren Kontext-ID "FourD" heisst, und nicht die, deren xbrli-Daten danach
 * aussehen (die luegen in der alten Taxonomie nachweislich).
 *
 * ZWEI DATENMAENGEL DER QUELLE, beide live gemessen, beide hier abgefangen:
 *  (a) Aeltere Dateien (OFSS GJ2019/GJ2021) DEKLARIEREN die Kontexte OneD/FourD ueberhaupt
 *      nicht — die Fakten verweisen auf eine <xbrli:context>-Marke, die es im Dokument nicht
 *      gibt. Ein solcher "ins Leere zeigender" Verweis kann per Bauart KEINE Dimension
 *      tragen (die stuende im fehlenden Element), ist also nie eine Aufgliederung. Er wird
 *      zugelassen — aber nur, wenn er seine Periode selbst als Fakt meldet, also mit exakt
 *      derselben Beweislast wie ein deklarierter Kontext. Ohne diese Nachsicht faellt jedes
 *      Geschaeftsjahr vor GJ2023 weg, obwohl seine Periode schwarz auf weiss dasteht.
 *  (b) Ausgeschlossen bleibt nur, was NACHWEISLICH eine Aufgliederung ist: ein deklarierter
 *      Kontext mit xbrldi-Dimension.
 *
 * Leere Liste = in dieser Datei gibt es keine Jahreszahl -> Wurf. Mehrere Treffer sind
 * erlaubt, solange sie fuer jedes gelesene Feld DENSELBEN Wert tragen (das prueft `dauerZahl`);
 * widersprechen sie sich, ist der Jahreswert nicht entscheidbar -> Wurf.
 */
function jahresKontexte(p, fyEnde, tk) {
  const treffer = [];
  const verworfen = [];
  const kandidaten = new Set();
  for (const je of p.fakten.values()) for (const ctx of je.keys()) kandidaten.add(ctx);
  for (const id of kandidaten) {
    const k = p.kontexte.get(id);
    if (k && k.dims) continue;                  // deklarierte Aufgliederung -> nie Gesamtwert
    if (k && k.instant) continue;               // Stichtags-Kontext
    const start = fakt(p, 'DateOfStartOfReportingPeriod', id, tk);
    const ende = fakt(p, 'DateOfEndOfReportingPeriod', id, tk);
    if (!start || !ende) continue;              // Kontext ohne Selbstauskunft -> nicht wertbar
    const tage = spanneTage(start, ende);
    // ⚠ `!Number.isFinite(tage)` ist nicht optional. Ist eines der beiden Daten unlesbar,
    // liefert Date.parse NaN — und `NaN < 330` ist false UND `NaN > 400` ist false. Die
    // ganze Spannenpruefung fiele damit lautlos aus, und ein beliebiger Kontext ginge als
    // Jahres-Kontext durch. (Review-Befund 19.08.2026.)
    if (ende !== fyEnde || !Number.isFinite(tage) || tage < JAHR_MIN_TAGE || tage > JAHR_MAX_TAGE) {
      verworfen.push(`${id}:${start}..${ende}(${tage}d)`);
      continue;
    }
    treffer.push({ id, start, ende, tage });
  }
  if (!treffer.length) {
    throw new Error(`${tk}: kein Jahres-Kontext (Ende=${fyEnde}, ${JAHR_MIN_TAGE}-${JAHR_MAX_TAGE} Tage) `
      + `gefunden. Verworfen: ${verworfen.slice(0, 4).join(' · ') || 'nichts'}. Ein Quartals- oder `
      + 'Rumpfjahres-Kontext darf nie als Jahreswert durchgehen (OFSS GJ2025: Q4 17.163 gegen '
      + 'Jahr 68.468 Mio., Faktor 4). Abbruch statt Auswahl.');
  }
  return treffer.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Stichtags-Kontexte zum Geschaeftsjahresende (Bilanz). Leere Liste = keine Bilanz in dieser
 * Datei (bei Meldungen vor GJ2023 der Normalfall, kein Fehler).
 *
 * ⚠ NICHT "genau einer": CHENNPETRO GJ2026 deklariert 25 dimensionslose Stichtags-Kontexte
 * zum 31.03.2026 (OneI plus 24 Aufgliederungen der Sammelposten, die OHNE xbrldi-Dimension
 * gebaut sind — `I_OtherCurrentAssets3` und Geschwister). Wer "es muss genau einer sein"
 * verlangt, verliert dort die ganze Bilanz. Gelesen wird deshalb ueber alle Kandidaten mit
 * Eindeutigkeits-Pflicht je Feld: `Assets` steht nur in OneI, nie in einem der Sammelposten.
 */
function stichtagsKontexte(p, fyEnde) {
  const treffer = [];
  for (const [id, k] of p.kontexte) {
    if (k.dims || !k.instant) continue;
    if (k.instant === fyEnde) treffer.push(id);
  }
  return treffer.sort();
}

/**
 * Liest EIN Element ueber mehrere Kontexte und verlangt Eindeutigkeit. Identische Dubletten
 * sind harmlos; zwei VERSCHIEDENE Werte sind nicht entscheidbar -> Wurf (nie "der letzte
 * gewinnt", das waere eine stille Wertaenderung).
 */
function ueberKontexte(p, name, ctxIds, tk) {
  let gefunden = null, ausCtx = null;
  for (const id of ctxIds) {
    const v = zahl(fakt(p, name, id, tk));
    if (v == null) continue;
    if (gefunden != null && gefunden !== v) {
      throw new Error(`${tk}: ${name} traegt in zwei Kontexten derselben Periode verschiedene `
        + `Werte (${ausCtx}=${gefunden} und ${id}=${v}). Nicht entscheidbar — Abbruch statt `
        + 'stiller Auswahl.');
    }
    gefunden = v; ausCtx = ausCtx || id;
  }
  return { wert: gefunden, ctx: ausCtx };
}

// Elementnamen je Feld. Reihenfolge = Vorrang; der erste vorhandene Name traegt das Feld.
// Alle Namen in BEIDEN Taxonomien identisch (an OFSS GJ2018-GJ2026 nachgezaehlt).
const DAUER_FELDER = {
  annualRev: ['RevenueFromOperations'],
  annualNetIncome: ['ProfitLossForPeriod'],
  annualOCF: ['CashFlowsFromUsedInOperatingActivities'],
};
const STICHTAG_FELDER = {
  annualAssets: ['Assets'],
  // Anteilseigner der Mutter zuerst — passt zum Nettoergebnis. `Equity` schliesst
  // Minderheiten ein (KALYANKJIL GJ2024: 41.890,57 gegen 41.877,67 Mio.).
  annualEquity: ['EquityAttributableToOwnersOfParent', 'Equity'],
};
// Wareneinsatz nach Schedule III. ChangesInInventories ist mit Vorzeichen zu addieren
// (Bestandsaufbau ist negativ und MINDERT den Wareneinsatz).
const WARENEINSATZ = [
  'CostOfMaterialsConsumed',
  'PurchasesOfStockInTrade',
  'ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade',
];
const FELD_NAMEN = [
  'annualRev', 'annualGrossProfit', 'annualOpInc', 'annualNetIncome',
  'annualAssets', 'annualEquity', 'annualOCF', 'annualShares',
];

/**
 * Baut EIN Geschaeftsjahr aus EINER XBRL-Datei. Reine Funktion — testbar ohne Netz.
 *
 * @param {string} xml        Rohtext der XBRL-Instanz
 * @param {string} tk         Ticker (nur fuer Fehlermeldungen)
 * @param {string} listeSagt  Konsolidierungskreis laut Listen-Eintrag ('Consolidated'|…)
 */
function bauJahr(xml, tk, listeSagt) {
  const p = parseXbrl(xml);

  // ── Geschaeftsjahresende: die Achse, auf der alles andere sitzt (Falle 4) ──────────────
  const fyEnde = faktDokument(p, 'DateOfEndOfFinancialYear', tk);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fyEnde))) {
    throw new Error(`${tk}: DateOfEndOfFinancialYear fehlt oder ist unbrauchbar `
      + `(${JSON.stringify(fyEnde)}). Ohne Geschaeftsjahresende laesst sich der Jahres-Kontext `
      + 'nicht bestimmen — Abbruch.');
  }

  const jk = jahresKontexte(p, fyEnde, tk);
  const sk = stichtagsKontexte(p, fyEnde);
  const jkIds = jk.map((x) => x.id);
  const jkLabel = jkIds.join('+');

  // ── Riegel 1+2 der Konsolidierungs-Falle (Falle 1) ────────────────────────────────────
  // ⚠ Konsens ueber ALLE Jahres-Kontexte, nicht "erster Treffer" (Review-Befund 19.08.2026).
  // Fuer jedes ZAHLEN-Feld verlangt `ueberKontexte` Uebereinstimmung; ausgerechnet beim
  // teuersten Feld — dem Konsolidierungskreis — waere ein Widerspruch sonst von der
  // alphabetischen Kontext-Reihenfolge entschieden worden.
  let dateiSagt = null;
  for (const id of jkIds) {
    const v = fakt(p, 'NatureOfReportStandaloneConsolidated', id, tk);
    if (v == null) continue;
    if (dateiSagt != null && dateiSagt !== v) {
      throw new Error(`${tk}: zwei Jahres-Kontexte melden verschiedene Konsolidierungskreise `
        + `(${JSON.stringify(dateiSagt)} und ${JSON.stringify(v)}). Dann ist nicht entscheidbar, `
        + 'welche Zahl der Konzern ist — kein Wert statt geratenem Wert.');
    }
    dateiSagt = v;
  }
  if (dateiSagt !== 'Consolidated') {
    throw new Error(`${tk}: die Datei meldet Konsolidierungskreis ${JSON.stringify(dateiSagt)} `
      + 'statt "Consolidated". Der Einzelabschluss darf nie als Konzernzahl ins Board — bei OFSS '
      + 'GJ2025 liegen beide 34,3 % auseinander (68.468 gegen 50.991 Mio.). Uebersprungen.');
  }
  if (listeSagt !== 'Consolidated') {
    throw new Error(`${tk}: die Datei sagt "Consolidated", der Listen-Eintrag aber `
      + `${JSON.stringify(listeSagt)}. Widersprechen sich die beiden Quellen, ist der `
      + 'Konsolidierungskreis nicht belegt — kein Wert statt geratenem Wert.');
  }

  // ── Waehrung: nie mischen ─────────────────────────────────────────────────────────────
  const waehrung = faktDokument(p, 'DescriptionOfPresentationCurrency', tk);
  if (waehrung !== 'INR') {
    throw new Error(`${tk}: Berichtswaehrung ${JSON.stringify(waehrung)} statt INR. Waehrungen `
      + 'werden nie gemischt (Befund 03.07.: KRW-Zaehler gegen USD-Nenner verfaelschte '
      + 'capitalEfficiency um Faktor ~1000). Abbruch.');
  }

  // ── Rundungsstufe: gelesen, mitgefuehrt, NIE gerechnet (Falle 3) ──────────────────────
  const rundung = faktDokument(p, 'LevelOfRounding', tk)
    || faktDokument(p, 'LevelOfRoundingUsedInFinancialStatements', tk);
  if (!RUNDUNGSSTUFEN.has(String(rundung))) {
    throw new Error(`${tk}: unbekannte Rundungsstufe ${JSON.stringify(rundung)}. Sie wird nicht `
      + 'gerechnet (die XBRL-Werte stehen immer in vollen Rupien), aber eine unbekannte Stufe '
      + 'kann bedeuten, dass die Quelle ihre Werte-Konvention geaendert hat. Abbruch statt Annahme.');
  }

  // Nur der WERT, fuer Herleitungen. Die Kontext-Herkunft holt `erster` separat.
  const dauerZahl = (name) => ueberKontexte(p, name, jkIds, tk).wert;
  const stichtagZahl = (name) => ueberKontexte(p, name, sk, tk).wert;
  const erster = (namen, ctxIds) => {
    for (const n of namen) {
      const t = ueberKontexte(p, n, ctxIds, tk);
      if (t.wert != null) return { name: n, wert: t.wert, ctx: t.ctx };
    }
    return { name: null, wert: null, ctx: null };
  };

  const werte = {};
  const feldwahl = {};
  for (const [feld, namen] of Object.entries(DAUER_FELDER)) {
    const t = erster(namen, jkIds);
    werte[feld] = t.wert;
    feldwahl[feld] = t.name ? `${t.name} [${t.ctx}]` : null;
  }
  for (const [feld, namen] of Object.entries(STICHTAG_FELDER)) {
    const t = erster(namen, sk);
    werte[feld] = t.wert;
    feldwahl[feld] = t.name ? `${t.name} [${t.ctx}]` : null;
  }

  // ── Rohertrag: Herleitung mit Dienstleister-Riegel (Falle 5) ──────────────────────────
  // ⚠ ALLE drei Posten muessen getaggt sein (0 ist ein Wert, "fehlt" ist keiner). Wer einen
  // fehlenden Posten wie 0 behandelt, unterzeichnet den Wareneinsatz und ueberzeichnet den
  // Rohertrag — genau die Fehlerklasse, die Falle 5 verhindern soll. (Review-Befund 19.08.2026.)
  const posten = WARENEINSATZ.map((n) => ({ n, v: dauerZahl(n) }));
  const vollstaendig = posten.every((x) => x.v != null);
  if (werte.annualRev != null && vollstaendig && posten.some((x) => x.v !== 0)) {
    werte.annualGrossProfit = werte.annualRev - posten.reduce((s, x) => s + x.v, 0);
    feldwahl.annualGrossProfit = `RevenueFromOperations - (${posten.map((x) => x.n).join(' + ')}) [${jkLabel}]`;
  } else {
    // Dienstleister (OFSS: alle drei Posten 0) — die Formel gaebe 100 % Marge, also eine
    // Falschaussage. Lieber kein Wert als ein falscher.
    werte.annualGrossProfit = null;
    feldwahl.annualGrossProfit = null;
  }

  // ── Betriebsergebnis: Umsatz - (Gesamtaufwand - Finanzaufwand) ────────────────────────
  // Ind AS kennt keine Zeile "Betriebsergebnis". Die Herleitung ist exakt und intern
  // pruefbar: Income - Expenses = ProfitBeforeExceptionalItemsAndTax (an CHENNPETRO GJ2026
  // auf die letzte Stelle nachgerechnet). Sonstige Ertraege bleiben aussen vor, Finanz-
  // aufwand wird zurueckgerechnet — damit ist es das operative Ergebnis, nicht das
  // ordentliche. Fehlt einer der beiden Posten, gibt es keinen Wert.
  const aufwand = dauerZahl('Expenses');
  const finanz = dauerZahl('FinanceCosts');
  if (werte.annualRev != null && aufwand != null && finanz != null) {
    werte.annualOpInc = werte.annualRev - (aufwand - finanz);
    feldwahl.annualOpInc = `RevenueFromOperations - (Expenses - FinanceCosts) [${jkLabel}]`;
  } else {
    werte.annualOpInc = null;
    feldwahl.annualOpInc = null;
  }

  // ── Aktienzahl + SKALEN-WAECHTER gegen die Rundungs-Falle ─────────────────────────────
  const eingezahlt = dauerZahl('PaidUpValueOfEquityShareCapital');
  const nennwert = dauerZahl('FaceValueOfEquityShareCapital');
  if (eingezahlt != null && nennwert != null && nennwert > 0) {
    const stueck = eingezahlt / nennwert;
    if (!(stueck >= AKTIEN_MIN && stueck <= AKTIEN_MAX)) {
      throw new Error(`${tk}: hergeleitete Aktienzahl ${stueck} liegt ausserhalb `
        + `[${AKTIEN_MIN}, ${AKTIEN_MAX}] (eingezahlt=${eingezahlt}, Nennwert=${nennwert}, `
        + `Rundungsstufe=${rundung}). Genau so sieht es aus, wenn jemand die Rundungsstufe als `
        + 'Faktor angewandt hat — die XBRL-Werte stehen bereits in vollen Rupien. Abbruch.');
    }
    werte.annualShares = stueck;
    feldwahl.annualShares = `PaidUpValueOfEquityShareCapital / FaceValueOfEquityShareCapital [${jkLabel}]`;
  } else {
    werte.annualShares = null;
    feldwahl.annualShares = null;
  }

  return {
    fy: Number(fyEnde.slice(0, 4)),   // Beschriftung nach dem ENDJAHR (Falle 4)
    fiscalYearEnd: fyEnde,
    taxonomie: p.taxonomie,
    rundung,
    kontexte: { jahr: jkLabel, jahrTage: jk[0].tage, stichtagKandidaten: sk.length },
    feldwahl,
    werte,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Auswahl der Meldungen (Restatement-Vorrangregel)
// ═══════════════════════════════════════════════════════════════════════════════════════

const MONATE = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const zweistellig = (n) => String(n).padStart(2, '0');

/** '31-MAR-2025' / '31-Mar-2025' -> '2025-03-31'. null, wenn unbrauchbar. */
function nseDatum(s) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const mon = MONATE[m[2].toUpperCase()];
  if (!mon) return null;
  return `${m[3]}-${zweistellig(mon)}-${zweistellig(Number(m[1]))}`;
}

/** '10-May-2024 20:57:50' -> Millisekunden. 0, wenn unlesbar (sortiert dann nach hinten). */
function nseZeit(s) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return 0;
  const mon = MONATE[m[2].toUpperCase()];
  if (!mon) return 0;
  return Date.parse(`${m[3]}-${zweistellig(mon)}-${zweistellig(Number(m[1]))}T${m[4]}:${m[5]}:${m[6]}Z`) || 0;
}

/**
 * Waehlt je Geschaeftsjahr GENAU EINE Konzern-Meldung aus beiden Listen.
 *
 * Vorrangregel (siehe Kopf, "RESTATEMENT"):
 *   - nur Meldungen, die das Geschaeftsjahr SELBST betreffen (keine Vergleichszahlen);
 *   - bei mehreren fuer dasselbe Jahr gewinnt die ZULETZT verbreitete (Revision schlaegt
 *     Original), bei Gleichstand die aus der neueren Liste (Integrated Filing).
 *
 * @param {Array} integrated  Eintraege aus /api/integrated-filing-results
 * @param {Array} jahres      Eintraege aus /api/corporates-financial-results?period=Annual
 * @returns {Map<string,{fyEnde,url,quelle,zeit,listeSagt}>} Schluessel = Geschaeftsjahresende
 */
function waehleMeldungen(integrated, jahres) {
  const kandidaten = [];

  // ⚠ NICHT `broadcast_Date` allein nehmen. Bei OFSS GJ2026 traegt die REVISION dieses Feld
  // als null (nur `creation_Date` ist gesetzt) — mit broadcast_Date allein sortiert sie auf
  // 0 und die ueberholte Original-Meldung gewinnt. Genau die Vorrangregel waere dann
  // stillschweigend umgedreht. Also der SPAETESTE aller vorhandenen Zeitstempel, und bei
  // Gleichstand die hoehere laufende Nummer (152215 > 152208 = spaeter eingereicht).
  const spaeteste = (...werte) => Math.max(0, ...werte.map(nseZeit));
  const laufnummer = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  // (a) Jahresmeldungen der alten Liste: `financialYear` nennt die Periode ausdruecklich.
  for (const r of jahres || []) {
    if (r.consolidated !== 'Consolidated') continue;
    if (r.cumulative !== 'Cumulative') continue;
    if (!r.xbrl || XBRL_TOT.test(r.xbrl)) continue;    // vor GJ2018: nur PDF
    const m = /To\s+(\d{1,2}-[A-Za-z]{3}-\d{4})\s*$/.exec(String(r.financialYear || ''));
    const fyEnde = m && nseDatum(m[1]);
    if (!fyEnde) continue;
    kandidaten.push({
      fyEnde, url: r.xbrl, quelle: 'financial-results', listeSagt: r.consolidated,
      zeit: spaeteste(r.exchdisstime, r.broadCastDate), nr: laufnummer(r.seqNumber),
    });
  }

  // (b) Integrated Filings: die Q4-Datei traegt das Jahr. Welcher Quartalsstichtag das ist,
  //     wird NICHT auf Maerz geraten, sondern aus (a) uebernommen — nur wenn (a) leer ist
  //     (junger Boersengang), gilt der gesetzliche Regelfall 31.03. Ein Fehlgriff kostet
  //     hoechstens einen Abruf: der Jahres-Kontext-Waechter verwirft alles, was kein
  //     12-Monats-Kontext ist.
  const stichtageAusA = new Set(kandidaten.map((k) => k.fyEnde.slice(5)));
  const monatTag = stichtageAusA.size === 1 ? [...stichtageAusA][0] : '03-31';
  for (const r of integrated || []) {
    if (r.type !== 'Integrated Filing- Financials') continue;
    if (r.consolidated !== 'Consolidated') continue;
    if (!r.xbrl || XBRL_TOT.test(r.xbrl)) continue;
    const fyEnde = nseDatum(r.qe_Date);
    if (!fyEnde || fyEnde.slice(5) !== monatTag) continue;
    kandidaten.push({
      fyEnde, url: r.xbrl, quelle: 'integrated-filing', listeSagt: r.consolidated,
      zeit: spaeteste(r.creation_Date, r.broadcast_Date), nr: laufnummer(r.seq_Id),
    });
  }

  const je = new Map();
  for (const k of kandidaten) {
    const alt = je.get(k.fyEnde);
    if (!alt) { je.set(k.fyEnde, k); continue; }
    if (k.zeit !== alt.zeit) { if (k.zeit > alt.zeit) je.set(k.fyEnde, k); continue; }
    // ⚠ Die laufenden Nummern der beiden Listen sind NICHT vergleichbar: `seqNumber` der
    // alten Liste laeuft siebenstellig (~1,1 Mio.), `seq_Id` der Integrated Filings
    // fuenf-/sechsstellig (~87k-177k). Wer sie quer vergleicht, laesst bei Zeitgleichstand
    // strukturell immer die ALTE Liste gewinnen und macht den Stich darunter zu totem Code.
    // (Review-Befund 19.08.2026.)
    if (k.quelle === alt.quelle && k.nr !== alt.nr) { if (k.nr > alt.nr) je.set(k.fyEnde, k); continue; }
    // Letzter Stich: die neuere Liste (Integrated Filing) — damit bleibt die Wahl auch bei
    // voellig gleichen Zeitstempeln deterministisch statt reihenfolgeabhaengig.
    if (alt.quelle !== 'integrated-filing' && k.quelle === 'integrated-filing') je.set(k.fyEnde, k);
  }
  return je;
}

/**
 * WAECHTER DER BEGRIFFS-EINHEITLICHKEIT (Review-Befund 19.08.2026, TW-Muster uebernommen).
 *
 * `annualEquity` hat eine Vorrangliste: `EquityAttributableToOwnersOfParent`, sonst `Equity`.
 * Das sind ZWEI VERSCHIEDENE BEGRIFFE — der zweite schliesst Minderheitsanteile ein
 * (KALYANKJIL GJ2024: 41.890,57 gegen 41.877,67 Mio.). Faellt ein einzelnes Jahr auf den
 * Zweitbegriff zurueck, entsteht mitten in der Reihe ein Sprung, den jeder Zyklus-Daempfer
 * als echte Bewegung liest. Dasselbe gilt fuer den Rohertrag, dessen Herleitung sich aendert,
 * wenn eine Firma einen Wareneinsatz-Posten nicht mehr taggt.
 *
 * Deshalb: EIN Begriff je Feld fuer die ganze Reihe — der des NEUESTEN Jahres. Jahre, die
 * einen anderen benutzen, verlieren genau dieses Feld (null) und werden gemeldet. Das ist
 * derselbe Grundsatz wie bei build-twannual: lieber eine Luecke als ein erfundener Sprung.
 * Aendert die Ausgabe direkt, deshalb kein blosser Kommentar.
 */
function vereinheitlicheBegriffe(jahre) {
  const nurName = (w) => (w == null ? null : String(w).replace(/\s*\[[^\]]*\]\s*$/, ''));
  const meldungen = [];
  const leitend = {};
  for (const feld of FELD_NAMEN) leitend[feld] = nurName(jahre[0].feldwahl[feld]);
  for (const j of jahre.slice(1)) {
    for (const feld of FELD_NAMEN) {
      const hier = nurName(j.feldwahl[feld]);
      if (hier == null || leitend[feld] == null || hier === leitend[feld]) continue;
      meldungen.push(`${j.fiscalYearEnd}: ${feld} kaeme aus "${hier}" statt "${leitend[feld]}" `
        + '— anderer Begriff, deshalb kein Wert statt eines erfundenen Sprungs');
      j.werte[feld] = null;
      j.feldwahl[feld] = null;
    }
  }
  return meldungen;
}

/**
 * WAECHTER DER GESCHAEFTSJAHRES-ACHSE (Falle 4).
 * Alle Jahre einer Firma muessen denselben Stichtag (Monat/Tag) tragen und paarweise
 * verschiedene Jahreszahlen haben. Ein Stichtagswechsel erzeugt sonst ein Rumpfjahr neben
 * einem vollen Jahr, und jede Wachstumsrate darueber ist erfunden.
 */
function pruefeJahresachse(tk, jahre) {
  const stichtage = new Set(jahre.map((j) => j.fiscalYearEnd.slice(5)));
  if (stichtage.size > 1) {
    throw new Error(`${tk}: der Geschaeftsjahres-Stichtag wechselt (${[...stichtage].join(', ')}). `
      + 'Dann steht ein Rumpfjahr neben einem vollen Jahr und jede Wachstumsrate darueber ist '
      + 'erfunden. Abbruch statt gemischter Achse.');
  }
  const fys = jahre.map((j) => j.fy);
  if (new Set(fys).size !== fys.length) {
    throw new Error(`${tk}: dasselbe Geschaeftsjahr kommt mehrfach vor (${fys.join(', ')}). `
      + 'Nicht entscheidbar, welche Meldung gilt — Abbruch.');
  }
  return { stichtag: [...stichtage][0], jahre: fys.length };
}

const zaehle = (arr) => arr.filter((e) => Number.isFinite(e && e.value)).length;

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Abruf
// ═══════════════════════════════════════════════════════════════════════════════════════

const BROWSER = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'identity',
};

/** Cookie-Jar. NSE/Akamai gibt ohne bm_sz/_abck/ak_bmsc 403 auf jeden API-Abruf. */
function neuerJar() {
  const jar = new Map();
  let gesetztAm = 0;
  return {
    frischGesetzt() { gesetztAm = Date.now(); },
    alterMs() { return gesetztAm ? Date.now() - gesetztAm : Infinity; },
    schlucke(headers) {
      for (const sc of (headers && headers['set-cookie']) || []) {
        const m = /^([^=]+)=([^;]*)/.exec(sc);
        if (m) jar.set(m[1], m[2]);
      }
    },
    kopf() {
      return jar.size ? [...jar].map(([k, v]) => `${k}=${v}`).join('; ') : null;
    },
    groesse() { return jar.size; },
  };
}

async function holeNse(url, jar, holen, art) {
  const headers = Object.assign({}, BROWSER, art === 'html'
    ? { Accept: 'text/html,application/xhtml+xml', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none', 'Upgrade-Insecure-Requests': '1' }
    : { Accept: '*/*', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin', Referer: `${BASIS}/` });
  const cookie = jar.kopf();
  if (cookie) headers.Cookie = cookie;
  const a = await holen(url, { headers, pauseMs: NSE_PAUSE_MS });
  jar.schlucke(a.headers);
  return a;
}

async function aufwaermen(jar, holen) {
  for (const u of AUFWAERMEN) await holeNse(u, jar, holen, 'html');
  jar.frischGesetzt();
  if (!jar.groesse()) {
    throw new Error('NSE-Bootstrap ohne Cookie — ohne bm_sz/_abck/ak_bmsc antwortet die API mit '
      + '403. Abbruch statt einer Runde leerer Abrufe.');
  }
}

async function holeJson(url, jar, holen) {
  const a = await holeNse(url, jar, holen, 'api');
  const text = a.body.toString('utf8');
  let j;
  try { j = JSON.parse(text); } catch (_) {
    throw new Error(`${url} -> Antwort ist kein JSON (${a.body.length} Bytes, beginnt mit `
      + `${JSON.stringify(text.slice(0, 80))}). Bei NSE heisst das fast immer: Cookie abgelaufen.`);
  }
  if (Array.isArray(j)) return j;
  // ⚠ Kein `j.data || []`. Eine Fehler-/Drosselungs-Antwort ohne `data` saehe sonst aus wie
  // "diese Firma hat keine Meldungen" — bei abgelaufenem Cookie waeren das 53 scheinbar
  // unabhaengige Datenluecken statt eines Alarms. (Review-Befund 19.08.2026.)
  if (!j || typeof j !== 'object' || !Array.isArray(j.data)) {
    throw new Error(`${url} -> Antwort ohne verwertbare data-Liste `
      + `(Schluessel: ${j && typeof j === 'object' ? Object.keys(j).join(',') : typeof j}). `
      + 'Bei NSE heisst das fast immer: Cookie abgelaufen oder Drosselung.');
  }
  return j.data;
}

// ═══════════════════════════════════════════════════════════════════════════════════════

async function main(opts = {}) {
  const holen = opts.fetchBuffer || fetchBuffer;
  const outPfad = opts.out || OUT;
  const tickers = opts.tickers || IN;
  const maxJahre = opts.maxJahre || MAX_JAHRE;

  const vorher = readJsonExistingOrThrow(outPfad);
  const out = vorher === FEHLT ? {} : vorher;
  const gescheitert = [];
  // FEHLENDE ZUERST. Ohne das ist die Wiederaufnahme wertlos: der zweite Lauf arbeitet die
  // Namen in derselben Reihenfolge ab, verbringt seine 35 Minuten mit genau denen, die schon
  // dastehen, und laeuft in dieselbe Drosselung, BEVOR er bei den fehlenden ankommt.
  // Live gemessen am Probelauf 19.08.2026: Lauf 2 war nach 12 Minuten bei Name 23 von 53 —
  // die fehlenden beginnen bei 38. Innerhalb beider Gruppen bleibt die uebergebene
  // Reihenfolge erhalten (stabile Sortierung), damit der Lauf deterministisch bleibt.
  const reihenfolge = [...tickers].sort((a, b) => (out[a] ? 1 : 0) - (out[b] ? 1 : 0));
  const jar = neuerJar();
  await aufwaermen(jar, holen);
  let folgeAusfaelle = 0;
  let gedrosselt = null;

  for (const tk of reihenfolge) {
    if (folgeAusfaelle >= MAX_FOLGE_AUSFAELLE) {
      gedrosselt = `nach ${folgeAusfaelle} Namen ohne Antwort abgebrochen (ab ${tk})`;
      break;
    }
    const sym = symbolVon(tk);
    const holeListen = async () => [
      await holeJson(`${BASIS}/api/integrated-filing-results?index=equities&symbol=${encodeURIComponent(sym)}&size=200`, jar, holen),
      await holeJson(`${BASIS}/api/corporates-financial-results?index=equities&symbol=${encodeURIComponent(sym)}&period=Annual`, jar, holen),
    ];
    if (jar.alterMs() > JAR_MAX_ALTER_MS) {
      try { await aufwaermen(jar, holen); } catch (e) {
        console.warn(`Cookie-Auffrischung fehlgeschlagen (${e.message}) — es wird mit dem alten versucht`);
      }
    }
    let integrated, jahresliste;
    try {
      [integrated, jahresliste] = await holeListen();
    } catch (ersterFehler) {
      // Ein einzelner Fehlschlag ist fast immer die abgelaufene Akamai-Sitzung. EIN Versuch
      // mit frischem Cookie — schlaegt auch der fehl, ist es ein echter Ausfall und wird laut.
      try {
        await aufwaermen(jar, holen);
        [integrated, jahresliste] = await holeListen();
        console.warn(`${tk}: Listen-Abruf erst nach Cookie-Auffrischung erfolgreich (${ersterFehler.message})`);
      } catch (zweiterFehler) {
        gescheitert.push(`${tk}: ${zweiterFehler.message}`);
        folgeAusfaelle += 1;
        console.warn(`${tk}: Listen-Abruf fehlgeschlagen, auch nach Cookie-Auffrischung `
          + `(${zweiterFehler.message}) -> Altbestand bleibt unveraendert`);
        continue;
      }
    }

    folgeAusfaelle = 0;   // eine beantwortete Anfrage setzt die Notbremse zurueck

    const meldungen = [...waehleMeldungen(integrated, jahresliste).values()]
      .sort((a, b) => (a.fyEnde < b.fyEnde ? 1 : -1))       // neuestes Jahr zuerst
      .slice(0, maxJahre);

    const jahre = [];
    const luecken = [];
    for (const m of meldungen) {
      let xml;
      try {
        const a = await holeNse(m.url, jar, holen, 'archiv');
        xml = a.body.toString('utf8');
      } catch (e) {
        luecken.push(`${m.fyEnde}: Abruf ${e.message}`);
        continue;
      }
      try {
        jahre.push(Object.assign(bauJahr(xml, tk, m.listeSagt), { quelle: m.quelle, url: m.url }));
      } catch (e) {
        // Waechter-Wurf fuer EIN Jahr: dieses Jahr faellt weg, die Firma bleibt.
        // Kein Wert ist immer besser als ein Wert aus dem falschen Kreis/Kontext.
        luecken.push(`${m.fyEnde}: ${e.message}`);
      }
    }

    if (jahre.length < MIN_JAHRE) {
      gescheitert.push(`${tk}: nur ${jahre.length} Jahre verwertbar (mind. ${MIN_JAHRE})`
        + (luecken.length ? ` — ${luecken.slice(0, 3).join(' · ')}` : ''));
      console.warn(`${tk}: zu wenig Jahre (${jahre.length}) -> uebersprungen`);
      continue;
    }

    luecken.push(...vereinheitlicheBegriffe(jahre));

    let achse;
    try { achse = pruefeJahresachse(tk, jahre); } catch (e) {
      gescheitert.push(`${tk}: ${e.message}`);
      console.warn(`${tk}: ${e.message}`);
      continue;
    }

    const serien = {};
    for (const feld of FELD_NAMEN) {
      // Fehlt ein Jahr, bleibt es null — nie 0, nie geschaetzt, nie aus einem Nachbarjahr.
      serien[feld] = jahre.map((j) => ({ value: Number.isFinite(j.werte[feld]) ? j.werte[feld] : null }));
    }
    if (zaehle(serien.annualRev) < MIN_JAHRE) {
      gescheitert.push(`${tk}: nur ${zaehle(serien.annualRev)} Jahre Umsatz (mind. ${MIN_JAHRE})`);
      console.warn(`${tk}: zu wenig Umsatzjahre -> uebersprungen`);
      continue;
    }

    out[tk] = Object.assign({
      source: 'NSE India (SEBI-XBRL-Jahresergebnisse, amtliche Einreichung)',
      accountingStandard: 'IND-AS',       // nah an IFRS, NICHT identisch
      consolidation: 'CFS',               // doppelt verriegelt: Liste UND Datei
      reportingCurrencyOriginal: 'INR',   // roh, keine Umrechnung
      fiscalYearEnd: jahre[0].fiscalYearEnd,
      levelOfRounding: jahre[0].rundung,  // Darstellungsangabe — NIE als Faktor gerechnet
      derived: {
        annualGrossProfit: 'Umsatz - (CostOfMaterialsConsumed + PurchasesOfStockInTrade + '
          + 'ChangesInInventories) — Herleitung, kein Ausweis; bei Dienstleistern (alle Posten 0) '
          + 'bewusst KEIN Wert statt 100 % Marge',
        annualOpInc: 'Umsatz - (Expenses - FinanceCosts) — Ind AS kennt keine Zeile '
          + '"Betriebsergebnis"; sonstige Ertraege bleiben aussen vor',
        annualShares: 'PaidUpValueOfEquityShareCapital / FaceValueOfEquityShareCapital — '
          + 'Herleitung, kein Ausweis; auf die Rundungsstufe des eingezahlten Kapitals genau '
          + '(KALYANKJIL GJ2025: 1.031.435.000 gegen amtlich 1.031.435.375, 3,6e-7 Abweichung)',
      },
      // Welcher Elementname je Feld die Reihe traegt und aus welchem Kontext — wie bei TW/JP.
      feldwahl: jahre[0].feldwahl,
      // Verworfene Geschaeftsjahre MIT Grund, in der Datei statt nur im Log. Ein fehlendes
      // Jahr ist keine Falschzahl (es taucht schlicht nicht in `fys` auf) und faerbt den Lauf
      // deshalb nicht rot — aber unsichtbar darf es auch nicht sein, sonst wird die Reihe
      // ueber Monate still flacher und niemand merkt es. Rot wird erst, wer unter die
      // Mindesttiefe faellt oder eine widerspruechliche Jahresachse hat.
      luecken,
      taxonomie: [...new Set(jahre.map((j) => j.taxonomie))].join('+'),
      nfy: jahre[0].fy,
      generatedAt: new Date().toISOString(),
      fys: jahre.map((j) => j.fy),
    }, serien);

    console.log(`${tk}: ${jahre.length} Jahre [${out[tk].taxonomie}, GJ-Ende ${achse.stichtag}]`
      + ` — rev=${zaehle(serien.annualRev)} gp=${zaehle(serien.annualGrossProfit)}`
      + ` op=${zaehle(serien.annualOpInc)} ni=${zaehle(serien.annualNetIncome)}`
      + ` assets=${zaehle(serien.annualAssets)} eq=${zaehle(serien.annualEquity)}`
      + ` ocf=${zaehle(serien.annualOCF)} shares=${zaehle(serien.annualShares)}`
      + (luecken.length ? ` | ${luecken.length} Jahr(e) verworfen` : ''));
    for (const l of luecken) console.log(`    verworfen ${l}`);
  }

  writeFileAtomic(outPfad, JSON.stringify(out, null, 1));
  console.log(`geschrieben: ${outPfad} (${Object.keys(out).length} Namen)`);
  // Erst schreiben (Merge erhaelt den Altbestand), dann rot werden.
  if (gedrosselt) {
    throw new Error(`build-inannual abgebrochen — die Quelle antwortet nicht mehr, ${gedrosselt}. `
      + `${Object.keys(out).length} Namen stehen in der Datei. Denselben Befehl spaeter erneut `
      + 'laufen lassen: bereits geholte Namen bleiben erhalten, der Lauf ergaenzt nur. '
      + `Bis dahin gescheitert: ${gescheitert.join('; ')}`);
  }
  if (gescheitert.length) {
    throw new Error(`build-inannual unvollstaendig — ${gescheitert.join('; ')}`
      + ' (Altbestand erhalten, aber der Lauf hat NICHT vollstaendig aktualisiert)');
  }
}

if (require.main === module) main().catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });

module.exports = {
  parseXbrl, fakt, faktDokument, zahl, spanneTage, jahresKontexte, stichtagsKontexte, ueberKontexte,
  bauJahr, waehleMeldungen, pruefeJahresachse, vereinheitlicheBegriffe, nseDatum, nseZeit,
  neuerJar, aufwaermen, main, JAR_MAX_ALTER_MS,
  IN, FELD_NAMEN, WARENEINSATZ, DAUER_FELDER, STICHTAG_FELDER, RUNDUNGSSTUFEN,
  MIN_JAHRE, MAX_JAHRE, JAHR_MIN_TAGE, JAHR_MAX_TAGE, AKTIEN_MIN, AKTIEN_MAX, KONFLIKT,
  MAX_FOLGE_AUSFAELLE,
};
