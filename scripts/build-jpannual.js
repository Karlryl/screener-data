'use strict';
/**
 * build-jpannual.js — OFFLINE-Generator fuer Japan (analog build-twannual/build-krannual).
 * ========================================================================================
 * Zieht die amtlichen EDINET-Jahresberichte (有価証券報告書, docTypeCode=120) als type=5-CSV
 * und schreibt external-data/jp-secannual.json im secAnnual-Format, das run-screener.js
 * bereits liest (SECANNUAL_FILES kennt 'jp-secannual.json').
 *
 * QUELLE UND LIZENZ: EDINET (Financial Services Agency), PDL 1.0 — kommerzielle Nutzung
 * ausdruecklich erlaubt. Die beste Lizenz aller geprueften Nicht-US-Quellen.
 *
 * DER FUNDORT STEHT SCHON FEST: external-data/jp-edinet-index.json haelt je Firma die docID
 * des NEUESTEN Jahresberichts. Das spart 210 Tageslisten-Abrufe — die EDINET-API hat keine
 * Firmensuche, nur Tageslisten. EIN Dokument je Firma reicht, weil der Fuenf-Jahres-Block
 * (SummaryOfBusinessResults) fuenf Geschaeftsjahre in einer Datei traegt.
 *
 * =======================================================================================
 *  DIE 145-PROZENT-FALLE — KONZERN GEGEN EINZELGESELLSCHAFT
 * =======================================================================================
 * Jede EDINET-Datei enthaelt BEIDE Abschluesse nebeneinander: den Konzernabschluss und den
 * Einzelabschluss der Muttergesellschaft. Gemessen an 7685.T (Buysell Technologies), FY2025:
 *
 *     Umsatz Konzern  100.614.584.000 JPY   (Kontext CurrentYearDuration)
 *     Umsatz Einzel    41.094.087.000 JPY   (Kontext CurrentYearDuration_NonConsolidatedMember)
 *                                            ----- 145 % Unterschied, Faktor 2,45
 *
 * VERBOTEN: Die Spalte 連結・個別 (Spalte 5) UNTERSCHEIDET SIE NICHT. Im Fuenf-Jahres-Block
 * meldet sie fuer BEIDE Bloecke その他 (= sonstiges). Wer sich auf sie verlaesst, bekommt bei
 * 7685.T zwei Zeilen, die beide その他 sagen, und muss raten.
 *
 * WAS SIE UNTERSCHEIDET: die KONTEXT-ID (Spalte 3). Empirisch belegt ueber alle 11 Firmen
 * und 13.901 Jahres-Kontext-Zeilen (Kreuztabelle Kontext-Suffix gegen Spalte 5):
 *
 *     Kontext OHNE jeden Member-Zusatz   ->  連結 3.068x · その他 2.765x · 個別     0x
 *     Kontext MIT _NonConsolidatedMember ->  個別 3.235x · その他 1.389x · 連結     0x
 *
 * NULL Gegenbeispiele. Die beiden Merkmale widersprechen sich in keiner einzigen Zeile —
 * wo die Spalte etwas sagt, bestaetigt sie das Kontext-Suffix. Damit ist die Frage
 * "was gilt, wenn gar kein Suffix da ist" NICHT geraten, sondern gemessen: KONZERN.
 *
 * ABER "OHNE SUFFIX" HEISST WIRKLICH OHNE JEDEN SUFFIX. Die Kontext-ID traegt noch viele
 * andere Dimensionen, und _NonConsolidatedMember kann mit ihnen KOMBINIERT auftreten:
 *     CurrentYearDuration                                          <- Konzern-Gesamtwert   OK
 *     CurrentYearDuration_NonConsolidatedMember                    <- Einzelgesellschaft   NEIN
 *     CurrentYearDuration_ShareholdersEquityMember                 <- Eigenkapital-BESTANDTEIL, nicht die Summe  NEIN
 *     CurrentYearDuration_NonConsolidatedMember_CapitalStockMember <- Einzel UND Bestandteil                     NEIN
 *     CurrentYearInstant_No1MajorShareholdersMember                <- ein einzelner Aktionaer                    NEIN
 * Ein Zusatz-Member bedeutet IMMER eine Aufgliederung, nie den Gesamtwert. Darum wird der
 * Kontext EXAKT geprueft (member === ''), nicht per "enthaelt nicht NonConsolidated".
 * Wer nur auf _NonConsolidatedMember filtert, holt sich Eigenkapital-Bestandteile als
 * Eigenkapital ins Board.
 *
 * FAIL-CLOSED, ZWEITER RIEGEL: Der Konzernabschluss wird nur uebernommen, wenn die Firma
 * laut eigener Angabe ueberhaupt einen aufstellt —
 *     jpdei_cor:WhetherConsolidatedFinancialStatementsArePreparedDEI === 'true'.
 * Sonst waeren die suffixlosen Kontexte die Zahlen der Einzelgesellschaft, und genau die
 * duerfen nie als Konzernzahl durchgehen. Firma ohne dieses "true" -> uebersprungen, gezaehlt,
 * kein Wert. Lieber eine Firma weniger als eine Firma mit Faktor 2,45 daneben.
 *
 * WAECHTER STATT KOMMENTAR: pruefeKonsolidierung() stellt die Kreuztabelle bei JEDEM Lauf
 * an den tatsaechlich geholten Zeilen neu auf und wirft, sobald EIN Gegenbeispiel auftaucht.
 * Dreht EDINET die Bedeutung des Suffixes um, wird der Lauf ROT statt still falsch.
 *
 * =======================================================================================
 *  DIE AKTIENZAHL — GEFUNDEN, UND ZWAR IM EINZEL-KONTEXT (das ist KEIN Regelbruch)
 * =======================================================================================
 * Die Vorarbeit meldete die Aktienzahl bei JGAAP-Meldern als "nicht vorhanden" und Japan
 * damit als 7-von-8-Kanal. Das ist WIDERLEGT: jpcrp_cor:TotalNumberOfIssuedSharesSummary-
 * OfBusinessResults liegt bei ALLEN 11 Firmen vor, mit fuenf Jahren Tiefe — aber
 * ausschliesslich im Kontext ...YearInstant_NonConsolidatedMember. Sie wurde gesucht, wo sie
 * per Definition nicht stehen KANN: eine Aktienzahl ist eine Eigenschaft des Emittenten,
 * nicht des Konsolidierungskreises. Einen "Konzern-Aktienbestand" gibt es nicht.
 * Deshalb ist das die einzige Kennzahl, die bewusst aus dem _NonConsolidatedMember-Kontext
 * kommt — als benannte Ausnahme (kreis:'EMITTENT'), die in `feldwahl` sichtbar in der
 * Ausgabedatei steht, nicht als stille Umgehung der Regel.
 * ACHTUNG NICHT split-bereinigt: 7685.T springt 14.624.620 -> 30.877.880 (2:1). Jede
 * Pro-Aktie-Groesse ueber mehrere Jahre braucht eine eigene Bereinigung — hier wird roh
 * gemeldet.
 *
 * =======================================================================================
 *  ZWEI BILANZIERUNGSSTANDARDS NEBENEINANDER
 * =======================================================================================
 * Japan laesst IFRS und den nationalen Standard (JGAAP) nebeneinander zu. Der Standard wird
 * NICHT geraten, sondern aus der Selbstauskunft gelesen: jpdei_cor:AccountingStandardsDEI
 * ('Japan GAAP' | 'IFRS'). Er entscheidet die Elementnamen — dieselbe Kennzahl heisst je
 * nach Standard anders, und das gleiche Wort meint nicht dasselbe:
 *     IFRS   Umsatz = jpcrp_cor:RevenueIFRSSummaryOfBusinessResults
 *     JGAAP  Umsatz = jpcrp_cor:NetSalesSummaryOfBusinessResults
 * Bei 4373.T (IFRS) traegt NetSalesSummaryOfBusinessResults NUR den Einzelabschluss
 * (12.513.000.000) — der Konzernumsatz steht unter dem IFRS-Namen (58.682.000.000).
 * Wer bei einem IFRS-Melder nach dem JGAAP-Namen greift, holt die Einzelgesellschaft:
 * 369 % daneben, noch schlimmer als die 145 % bei 7685.T.
 * Ein unbekannter Standard-Wert (z. B. 'US GAAP') faerbt die Firma rot statt still falsch.
 *
 * EIGENKAPITAL IST NICHT DERSELBE BEGRIFF: IFRS-Melder weisen im Fuenf-Jahres-Block das
 * Eigenkapital der MUTTER aus (EquityAttributableToOwnersOfParent), JGAAP-Melder das
 * Nettovermoegen INKLUSIVE Minderheiten (NetAssets = 純資産). Beide sind die im jeweiligen
 * Standard uebliche Groesse; sie sind aber nicht dasselbe. Darum steht der tatsaechlich
 * benutzte Elementname je Feld in `feldwahl` in der Ausgabedatei — wie bei Taiwan.
 *
 * TIEFE: Der Fuenf-Jahres-Block traegt sechs der acht Kennzahlen fuenf Jahre weit. Rohertrag
 * und Betriebsergebnis stehen NICHT darin, sondern nur im Rechenwerk mit zwei Jahren. Das
 * sind echte Luecken, keine Fehler — aeltere Jahre bleiben null, nie 0 und nie geschaetzt.
 *
 * WAEHRUNG: JPY, roh, KEINE Umrechnung — wie bei Taiwan/Korea. Der Kanal wird von vorzeichen-
 * und verhaeltnisbasierten Signalen gelesen (cycleSeriesPair, roicStability), die waehrungs-
 * invariant sind. reportingCurrencyOriginal traegt die Waehrung fuer lib/annual-currency-guard.
 *
 * DETERMINISMUS wie build-twannual/build-krannual: Netz NUR hier (offline). Die committete
 * jp-secannual.json ist die deterministische Quelle; run-screener.js liest sie ohne Netz.
 */
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'external-data', 'jp-secannual.json');
const INDEX = path.join(ROOT, 'external-data', 'jp-edinet-index.json');
const { writeFileAtomic } = require(path.join(ROOT, 'lib/atomic-write.js'));
const { readJsonExistingOrThrow, FEHLT } = require(path.join(ROOT, 'lib/read-json.js'));
const { fetchBuffer } = require(path.join(ROOT, 'lib/fetch-retry.js'));
const zip = require(path.join(ROOT, 'lib/zip-stream.js'));

const API = 'https://api.edinet-fsa.go.jp/api/v2/documents/';
const MIN_JAHRE = 3;          // wie Taiwan/Korea: weniger ist keine Reihe
const MIN_BELEGE = 20;        // Mindest-Beweislast, damit der Waechter nicht leer durchwinkt

// Spalten der type=5-CSV (9 Spalten, TAB-getrennt, UTF-16LE):
// 要素ID | 項目名 | コンテキストID | 相対年度 | 連結・個別 | 期間・時点 | ユニットID | 単位 | 値
const SP = { element: 0, kontext: 2, kreis: 4, wert: 8 };
const KONZERN_SPALTE = '連結';
const EINZEL_SPALTE = '個別';
const KOPF_ERSTE_SPALTE = '要素ID';

/**
 * Zerlegt eine Kontext-ID in Bezugsjahr, Art und Member-Zusatz.
 * Gibt null zurueck, wenn es kein Jahres-Kontext ist (z. B. FilingDateInstant).
 * `member` ist '' fuer den Gesamtwert und sonst der komplette Zusatz.
 */
function kontextTeile(k) {
  const m = /^(?:CurrentYear|Prior([1-9])Year)(Duration|Instant)(.*)$/.exec(k || '');
  if (!m) return null;
  return { versatz: m[1] ? Number(m[1]) : 0, art: m[2], member: m[3] || '' };
}

/** Der Gesamtwert des KONZERNS: Jahres-Kontext ohne JEDEN Member-Zusatz. */
function istKonzern(k) {
  const t = kontextTeile(k);
  return !!t && t.member === '';
}

/** Der Gesamtwert der EINZELGESELLSCHAFT (Emittent): genau ein Zusatz, und zwar dieser. */
function istEinzel(k) {
  const t = kontextTeile(k);
  return !!t && t.member === '_NonConsolidatedMember';
}

/**
 * TSV-Parser mit Anfuehrungszeichen. Die Textblock-Zellen enthalten Zeilenumbrueche und
 * eingebettete Anfuehrungszeichen — ein split('\n') zerschneidet sie mitten im Wert und
 * verschiebt danach ALLE Spalten. Das faellt nicht auf, es liefert nur falsche Zahlen.
 */
function parseTsv(text) {
  const zeilen = [];
  let feld = '', zeile = [], inQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuote) {
      if (c !== '"') { feld += c; continue; }
      if (text[i + 1] === '"') { feld += '"'; i += 1; continue; }
      inQuote = false;
      continue;
    }
    if (c === '"') { inQuote = true; continue; }
    if (c === '\t') { zeile.push(feld); feld = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { zeile.push(feld); zeilen.push(zeile); zeile = []; feld = ''; continue; }
    feld += c;
  }
  if (feld !== '' || zeile.length) { zeile.push(feld); zeilen.push(zeile); }
  return zeilen;
}

/** Zeilen -> Spalten-Arrays, nur die 9-Spalten-Datenzeilen (Kopfzeile faellt weg). */
function leseZeilen(text) {
  const out = [];
  for (const z of parseTsv(text)) {
    if (z.length < 9) continue;
    if (z[SP.element] === KOPF_ERSTE_SPALTE) continue;
    out.push(z);
  }
  return out;
}

const zahl = (v) => {
  if (v == null || !/^-?\d+(\.\d+)?$/.test(String(v).trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * DER WAECHTER DER 145-PROZENT-FALLE.
 *
 * Stellt die Kreuztabelle Kontext-Suffix x Spalte 連結・個別 an den TATSAECHLICH geholten
 * Zeilen auf und prueft die Behauptung, auf der der ganze Adapter steht:
 *     suffixlos               =>  niemals 個別 (Einzel)
 *     _NonConsolidatedMember  =>  niemals 連結 (Konzern)
 * Wirft beim ersten Gegenbeispiel. Verlangt ausserdem eine MINDEST-Beweislast: eine Datei,
 * in der die Spalte nie etwas sagt, kann die Regel nicht bestaetigen — dann ist sie
 * unbelegt, und unbelegt heisst hier rot, nicht "wird schon stimmen".
 */
function pruefeKonsolidierung(tk, zeilen) {
  let konzernBelegt = 0, einzelBelegt = 0;
  const verstoesse = [];
  for (const z of zeilen) {
    const t = kontextTeile(z[SP.kontext]);
    if (!t) continue;
    const spalte = z[SP.kreis];
    if (t.member === '') {
      if (spalte === KONZERN_SPALTE) konzernBelegt += 1;
      else if (spalte === EINZEL_SPALTE) {
        verstoesse.push(`suffixloser Kontext ${z[SP.kontext]} meldet 個別 (${z[SP.element]})`);
      }
    } else if (/(^|_)NonConsolidatedMember(_|$)/.test(t.member)) {
      if (spalte === EINZEL_SPALTE) einzelBelegt += 1;
      else if (spalte === KONZERN_SPALTE) {
        verstoesse.push(`${z[SP.kontext]} meldet 連結 (${z[SP.element]})`);
      }
    }
  }
  if (verstoesse.length) {
    throw new Error(`${tk}: Konsolidierungs-Schluessel verletzt — ${verstoesse.slice(0, 3).join(' · ')}`
      + `${verstoesse.length > 3 ? ` (+${verstoesse.length - 3} weitere)` : ''}. Der Adapter nimmt den `
      + 'suffixlosen Kontext als KONZERN. Gilt das nicht mehr, waere jede Zahl potenziell die '
      + 'Einzelgesellschaft — bei 7685.T Faktor 2,45 daneben. Abbruch statt stiller Fehlzahl.');
  }
  // Die Mindest-Beweislast haengt bewusst an der EINZEL-Seite, nicht an der Summe beider.
  // Grund, an 4373.T gemessen: bei einem IFRS-Melder sagt die Spalte NIE 連結 (der
  // IFRS-Konzernabschluss steht unter jpigp_cor:* und laesst die Spalte auf その他), also
  // ist konzernBelegt dort 0. Was die Falle abwehrt, ist ohnehin die andere Richtung:
  // dass JEDE Zeile, die 個別 meldet, ihren _NonConsolidatedMember-Zusatz traegt — und
  // damit keine Einzelzahl in den suffixlosen Kreis rutschen kann. Genau das wird verlangt.
  // Eine Datei ohne 個別-Zeilen kann die Trennung nicht belegen -> rot statt Vermutung.
  if (einzelBelegt < MIN_BELEGE) {
    throw new Error(`${tk}: Konsolidierungs-Schluessel NICHT belegbar — nur ${einzelBelegt} Zeilen melden `
      + `ueberhaupt 個別 in Spalte 連結・個別 (mind. ${MIN_BELEGE} noetig; Konzern-Belege: ${konzernBelegt}). `
      + 'Ohne diesen Gegenbeleg ist die Trennung Konzern/Einzel geraten, nicht gemessen. '
      + 'Abbruch statt Vermutung.');
  }
  return { konzernBelegt, einzelBelegt };
}

/** Wert eines DEI-Feldes (steht am Einreichungs-Stichtag, nicht in einem Jahres-Kontext). */
function dei(zeilen, element) {
  for (const z of zeilen) if (z[SP.element] === element) return z[SP.wert];
  return null;
}

// Elementnamen je Standard.
// kreis:'KONZERN'  -> Kontext OHNE jeden Member-Zusatz
// kreis:'EMITTENT' -> Kontext _NonConsolidatedMember (NUR die Aktienzahl, Begruendung im Kopf)
// Reihenfolge = Vorrang; der Elementname mit den meisten Jahren traegt die ganze Reihe.
const S = 'jpcrp_cor:';
const FELDER = {
  IFRS: {
    annualRev: { kreis: 'KONZERN', el: [`${S}RevenueIFRSSummaryOfBusinessResults`] },
    annualNetIncome: { kreis: 'KONZERN', el: [`${S}ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults`] },
    annualAssets: { kreis: 'KONZERN', el: [`${S}TotalAssetsIFRSSummaryOfBusinessResults`] },
    annualEquity: { kreis: 'KONZERN', el: [`${S}EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults`] },
    annualOCF: { kreis: 'KONZERN', el: [`${S}CashFlowsFromUsedInOperatingActivitiesIFRSSummaryOfBusinessResults`] },
    // Nur im Rechenwerk, nur zwei Jahre — der Fuenf-Jahres-Block fuehrt beide nicht.
    annualGrossProfit: { kreis: 'KONZERN', el: ['jpigp_cor:GrossProfitIFRS'] },
    annualOpInc: { kreis: 'KONZERN', el: ['jpigp_cor:OperatingProfitLossIFRS'] },
    annualShares: { kreis: 'EMITTENT', el: [`${S}TotalNumberOfIssuedSharesSummaryOfBusinessResults`] },
  },
  JGAAP: {
    annualRev: { kreis: 'KONZERN', el: [`${S}NetSalesSummaryOfBusinessResults`] },
    annualNetIncome: { kreis: 'KONZERN', el: [`${S}ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults`] },
    annualAssets: { kreis: 'KONZERN', el: [`${S}TotalAssetsSummaryOfBusinessResults`] },
    // 純資産 — INKLUSIVE Minderheiten. Der IFRS-Block meldet an dieser Stelle die Mutter
    // allein; beide sind im jeweiligen Standard ueblich, aber nicht derselbe Begriff.
    annualEquity: { kreis: 'KONZERN', el: [`${S}NetAssetsSummaryOfBusinessResults`] },
    annualOCF: { kreis: 'KONZERN', el: [`${S}NetCashProvidedByUsedInOperatingActivitiesSummaryOfBusinessResults`] },
    annualGrossProfit: { kreis: 'KONZERN', el: ['jppfs_cor:GrossProfit'] },
    // NICHT OrdinaryIncome (経常利益) nehmen — das ist das ordentliche Ergebnis inkl.
    // Finanzergebnis, nicht das Betriebsergebnis. Es stuende sogar fuenf Jahre tief im
    // Block; genau deshalb ist die Verwechslung verlockend und falsch.
    annualOpInc: { kreis: 'KONZERN', el: ['jppfs_cor:OperatingIncome'] },
    annualShares: { kreis: 'EMITTENT', el: [`${S}TotalNumberOfIssuedSharesSummaryOfBusinessResults`] },
  },
};
const FELD_NAMEN = Object.keys(FELDER.JGAAP);

const STANDARD_AUS_DEI = { 'Japan GAAP': 'JGAAP', IFRS: 'IFRS' };

/**
 * Sammelt fuer EIN Element und EINEN Konsolidierungskreis die Werte je Jahres-Versatz.
 * Zwei VERSCHIEDENE Werte fuer denselben Versatz sind nicht entscheidbar -> Wurf
 * (identische Dubletten sind harmlos und gehen durch, wie bei Taiwan).
 */
function werteJeVersatz(zeilen, element, kreis, tk) {
  const passt = kreis === 'EMITTENT' ? istEinzel : istKonzern;
  const out = new Map();
  for (const z of zeilen) {
    if (z[SP.element] !== element) continue;
    if (!passt(z[SP.kontext])) continue;
    const v = zahl(z[SP.wert]);
    if (v == null) continue;
    const versatz = kontextTeile(z[SP.kontext]).versatz;
    const vorher = out.get(versatz);
    if (vorher !== undefined && vorher !== v) {
      throw new Error(`${tk}: ${element} liefert fuer ${z[SP.kontext]} zwei verschiedene Werte `
        + `(${vorher} und ${v}). Welcher gilt, ist nicht entscheidbar — Abbruch statt stiller Auswahl.`);
    }
    out.set(versatz, v);
  }
  return out;
}

/**
 * Baut die Jahresreihen EINER Firma aus den CSV-Zeilen. Reine Funktion — testbar ohne Netz.
 * @param {string[][]} zeilen  Datenzeilen der type=5-CSV
 * @param {string} periodEnd   Geschaeftsjahresende des Dokuments, 'YYYY-MM-DD'
 * @param {string} tk          Ticker, nur fuer Fehlermeldungen
 */
function bauJahre(zeilen, periodEnd, tk) {
  const waechter = pruefeKonsolidierung(tk, zeilen);

  // Fail-closed Riegel: ohne ausdrueckliches "ja, wir stellen einen Konzernabschluss auf"
  // waeren die suffixlosen Kontexte die Einzelgesellschaft.
  const konsFlag = dei(zeilen, 'jpdei_cor:WhetherConsolidatedFinancialStatementsArePreparedDEI');
  if (String(konsFlag).toLowerCase() !== 'true') {
    throw new Error(`${tk}: kein Konzernabschluss (WhetherConsolidatedFinancialStatementsArePreparedDEI=`
      + `${JSON.stringify(konsFlag)}). Dann traegt der suffixlose Kontext die EINZELGESELLSCHAFT, und die `
      + 'darf nie als Konzernzahl ins Board. Firma uebersprungen statt Zahl geraten.');
  }

  const stdRoh = dei(zeilen, 'jpdei_cor:AccountingStandardsDEI');
  const standard = STANDARD_AUS_DEI[String(stdRoh).trim()];
  if (!standard) {
    throw new Error(`${tk}: unbekannter Bilanzierungsstandard ${JSON.stringify(stdRoh)}. Die Elementnamen `
      + 'haengen am Standard (IFRS-Umsatz heisst anders als JGAAP-Umsatz); raten hiesse bei einem '
      + 'IFRS-Melder den Einzelabschluss zu greifen (4373.T: 369 % daneben). Abbruch.');
  }

  const endJahr = Number(String(periodEnd).slice(0, 4));
  if (!Number.isFinite(endJahr)) throw new Error(`${tk}: periodEnd ${JSON.stringify(periodEnd)} unbrauchbar`);

  const proFeld = {}, feldwahl = {};
  for (const feld of FELD_NAMEN) {
    const def = FELDER[standard][feld];
    let bester = null, besteWerte = null;
    for (const el of def.el) {
      const w = werteJeVersatz(zeilen, el, def.kreis, tk);
      if (besteWerte == null || w.size > besteWerte.size) { bester = el; besteWerte = w; }
    }
    proFeld[feld] = besteWerte || new Map();
    // Sichtbar machen, WELCHER Begriff die Reihe traegt und aus welchem Kreis er stammt.
    feldwahl[feld] = besteWerte && besteWerte.size ? `${bester} [${def.kreis}]` : null;
  }

  // Gemeinsame Achse: alle Jahres-Versaetze, zu denen irgendein Feld einen Wert hat.
  const versaetze = new Set();
  for (const feld of FELD_NAMEN) for (const v of proFeld[feld].keys()) versaetze.add(v);
  const sortiert = [...versaetze].sort((a, b) => a - b);       // 0 = neuestes Jahr zuerst
  const fys = sortiert.map((v) => endJahr - v);

  const serien = {};
  for (const feld of FELD_NAMEN) {
    serien[feld] = sortiert.map((v) => {
      const w = proFeld[feld].get(v);
      // Fehlt ein Jahr, bleibt es null — nie 0, nie geschaetzt, nie aus einem Nachbarjahr.
      return { value: Number.isFinite(w) ? w : null };
    });
  }
  return Object.assign({ fys, standard, _waechter: waechter, _feldwahl: feldwahl }, serien);
}

const zaehle = (arr) => arr.filter((e) => Number.isFinite(e && e.value)).length;

/** Holt das type=5-ZIP und gibt den Text der Jahresbericht-CSV zurueck. */
async function holeCsv(docID, key, holen) {
  const a = await holen(`${API}${docID}?type=5&Subscription-Key=${encodeURIComponent(key)}`);
  const buf = a.body;
  const schwanz = buf.subarray(Math.max(0, buf.length - zip.EOCD_MAX_SUCHE));
  const z = zip.leseVerzeichnisZeiger(schwanz, buf.length);
  const eintraege = zip.leseVerzeichnis(buf.subarray(z.cdOffset, z.cdOffset + z.cdGroesse), z.anzahl);
  // Der Jahresbericht selbst — nicht die beiden Pruefvermerke (jpaud-*) im selben ZIP.
  const e = eintraege.find((x) => /jpcrp\d+-asr.*\.csv$/i.test(x.name));
  if (!e) {
    throw new Error(`${docID}: keine jpcrp*-asr-CSV im ZIP (${eintraege.map((x) => x.name).join(', ')})`);
  }
  const roh = zip.entpackeEintrag(buf.subarray(e.lfhOffset, e.lfhOffset + zip.bytesFuer(e)), e);
  // UTF-16LE mit BOM — jeder Leser mit Standard-Kodierung liest hier Muell.
  return roh.toString('utf16le').replace(/^﻿/, '');
}

function ladeSchluessel() {
  if (process.env.EDINET_KEY) return process.env.EDINET_KEY;
  try {
    const fs = require('fs');
    return (fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/EDINET_KEY=([^\s]+)/) || [])[1] || null;
  } catch (_) { return null; }
}

// opts = Test-Seam (wie fetchJson in build-twannual).
async function main(opts = {}) {
  const holen = opts.fetchBuffer || fetchBuffer;
  const outPfad = opts.out || OUT;
  const key = opts.key || ladeSchluessel();
  if (!key) throw new Error('EDINET_KEY fehlt (process.env.EDINET_KEY oder .env) — EDINET type=5 braucht ihn.');

  const idx = readJsonExistingOrThrow(opts.index || INDEX);
  if (idx === FEHLT) throw new Error('external-data/jp-edinet-index.json fehlt — ohne Fundort kein Abruf.');
  const firmen = opts.firmen || idx.firmen;

  const vorher = readJsonExistingOrThrow(outPfad);
  const out = vorher === FEHLT ? {} : vorher;
  const gescheitert = [];

  for (const [sec, f] of Object.entries(firmen)) {
    const tk = `${sec}.T`;
    let csv;
    try {
      csv = await holeCsv(f.docID, key, holen);
    } catch (e) {
      gescheitert.push(`${tk}: ${e.message}`);
      console.warn(`${tk}: Abruf fehlgeschlagen (${e.message}) -> Altbestand bleibt unveraendert`);
      continue;
    }
    let j;
    try {
      j = bauJahre(leseZeilen(csv), f.periodEnd, tk);
    } catch (e) {
      // Waechter-Wurf: Konsolidierung/Standard nicht sicher zuzuordnen. NICHT schreiben.
      gescheitert.push(`${tk}: ${e.message}`);
      console.warn(`${tk}: ${e.message}`);
      continue;
    }
    const serien = {};
    for (const feld of FELD_NAMEN) serien[feld] = j[feld];
    if (zaehle(serien.annualRev) < MIN_JAHRE) {
      gescheitert.push(`${tk}: nur ${zaehle(serien.annualRev)} Jahre Umsatz (mind. ${MIN_JAHRE} noetig)`);
      console.warn(`${tk}: zu wenig Jahre (Umsatz=${zaehle(serien.annualRev)}) -> uebersprungen`);
      continue;
    }
    out[tk] = Object.assign({
      docID: f.docID,
      source: 'EDINET (Financial Services Agency, amtlich; PDL 1.0)',
      accountingStandard: j.standard === 'IFRS' ? 'JP-IFRS' : 'JGAAP',
      consolidation: 'CFS',              // Kontext ohne Member-Zusatz — nie Einzelabschluss
      reportingCurrencyOriginal: 'JPY',  // roh, keine Umrechnung
      fiscalYearEnd: f.periodEnd,        // Japan hat uneinheitliche Stichtage (03-31 und 12-31)
      derived: {
        annualShares: 'Kontext _NonConsolidatedMember — eine Aktienzahl ist eine Eigenschaft des '
          + 'EMITTENTEN, nicht des Konsolidierungskreises; roh, NICHT split-bereinigt',
      },
      // Welcher Elementname je Feld die Reihe traegt und aus welchem Kreis. Steht in der Datei,
      // damit sichtbar ist, dass IFRS hier das Eigenkapital der Mutter meint und JGAAP das
      // Nettovermoegen inkl. Minderheiten.
      feldwahl: j._feldwahl,
      nfy: j.fys[0],
      generatedAt: new Date().toISOString(),
      fys: j.fys,
    }, serien);
    console.log(`${tk}: ${j.fys.length} Jahre [${j.standard}] — rev=${zaehle(serien.annualRev)}`
      + ` gp=${zaehle(serien.annualGrossProfit)} op=${zaehle(serien.annualOpInc)}`
      + ` ni=${zaehle(serien.annualNetIncome)} assets=${zaehle(serien.annualAssets)}`
      + ` eq=${zaehle(serien.annualEquity)} ocf=${zaehle(serien.annualOCF)} shares=${zaehle(serien.annualShares)}`);
  }

  writeFileAtomic(outPfad, JSON.stringify(out, null, 1));
  console.log(`geschrieben: ${outPfad} (${Object.keys(out).length} Namen)`);
  // Erst schreiben (Merge erhaelt den Altbestand), dann rot werden.
  if (gescheitert.length) {
    throw new Error(`build-jpannual unvollstaendig — ${gescheitert.join('; ')}`
      + ' (Altbestand erhalten, aber der Lauf hat NICHT vollstaendig aktualisiert)');
  }
}

if (require.main === module) main().catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });

module.exports = {
  bauJahre, pruefeKonsolidierung, kontextTeile, istKonzern, istEinzel, parseTsv, leseZeilen,
  werteJeVersatz, dei, zahl, holeCsv, main, FELDER, FELD_NAMEN, SP, MIN_JAHRE, MIN_BELEGE,
};
