'use strict';
/**
 * SEC XBRL -> Snapshot Merge (Folge-PR zu pull-sec-xbrl.js)
 * =========================================================
 * pull-sec-xbrl.js cached companyfacts/CIK<cik>.json fuer SEC-Filer. DIESES Modul
 * extrahiert daraus die TIEFEN ANNUAL-Serien (SEC liefert ~15 Jahre statt Yahoos
 * ~4) und merged sie in die Snapshots. REINE Funktionen, kein Netzwerk, kein I/O
 * (der Aufrufer liest die Cache-Datei).
 *
 * ZWEI BILANZIERUNGSSTANDARDS (19.08.2026): companyfacts liefert Kennzahlen unter
 * 'us-gaap' UND unter 'ifrs-full'. Bis dahin las dieses Modul nur us-gaap und nur
 * 10-K — auslaendische Emittenten mit US-Notierung (20-F/40-F, meist IFRS) fielen
 * damit lautlos heraus, obwohl ihre Zahlen bei der SEC liegen. Sichtbar war das an
 * 45 der 214 Namen in external-data/sec-secannual.json, die als HOHLE Datensaetze
 * ohne eine einzige Zahl im Store standen (BNTX, STLA, LI, YPF, FNV, WFG …).
 * Es wird GENAU EINE Taxonomie je Firma benutzt, nie eine Mischung, und welche es
 * war, steht am Ergebnis (extractSecSeries().taxonomie) — Begruendung an
 * waehleTaxonomie().
 *
 * Ausgabe-Format IDENTISCH zu den Yahoo-Snapshot-Feldern (snapshot.js FIELD_REGISTRY):
 *   annual.*  -> [{value:N|null}] newest-first, INDEX-ALIGNED nach Fiskaljahr
 * -> norm() liest die tieferen Arrays transparent (gleiches {value}-Format).
 *
 * SCOPE (2026-07-02): NUR ANNUAL. Die Quartals-Extraktion (fuer den TTM-ueber-TTM-
 * Pfad overview.js:37 + die Quartals-Achsen) ist ein SEPARATER Folge-Schritt: die
 * juengsten 10-Q-Frames mischen 3-Monats- und YTD-Perioden (an der Datenfront teils
 * mit identischem end-Datum), was ein dediziertes Frame-Dedup braucht. Bis das
 * frame-sicher ist, wird es NICHT gemerged (kein halb-korrekter Fundamental-Pfad).
 *
 * WICHTIGER BEFUND (verifiziert am Code): das Vertiefen der STANDARD-Scoring-Felder
 * ist NICHT score-neutral. Drei Achsen sind tiefen-sensitiv (axes.js): cycleDiscount
 * mittelt ueber ALLE annualOpInc/annualRev-Margenjahre; revAcceleration/marginTrajectory
 * (Quartale). mergeSecIntoSnapshot bietet daher zwei Modi:
 *   - mode='namespace' (DEFAULT, additiv, 0 Score-Aenderung): tiefe Serie unter
 *     snapshot.secAnnual, Standard-Scoring-Felder unberuehrt.
 *   - mode='replace' (Handoff-literal, SCORE-AENDERND): ersetzt die annual-Standard-
 *     felder durch die tiefe SEC-Serie. NUR nach Court+Audit einsetzen.
 */

// --- Jahresbericht-Formen ----------------------------------------------------
// Bis 19.08.2026 stand in annualConcept() hart `form === '10-K'`. Das ist die Form der
// INLAENDISCHEN Filer. Ein auslaendischer Emittent mit US-Notierung reicht 20-F ein,
// ein kanadischer 40-F — beide sind derselbe Jahresbericht. Mit '10-K' allein liefert
// annualConcept() fuer diese Firmen NICHTS, egal welche Taxonomie gelesen wird; das
// Taxonomie-Problem unten waere ohne diese Zeile gar nicht sichtbar geworden.
// Gemessen 19.08.2026 an live geholten companyfacts (Formen je Taxonomie):
//   ARGX 20-F:4238 · GFI 20-F:3384 · DLO 20-F:2127 · BNTX 20-F:2814 · STLA 20-F:6499
//   FNV 40-F:2497 · WFG 40-F:1599   (kein einziger 10-K-Eintrag bei allen sieben)
// BEWUSST OHNE die Berichtigungsformen '10-K/A' / '20-F/A' / '40-F/A': dass Berichtigungen
// unsichtbar bleiben, ist ein EIGENER offener Befund, der ALLE Filer gleich trifft
// (audit-reports/ChatGPT Bug hunt.md, Fundstelle merge-sec-xbrl.js). Hier wird die
// Auslands-Luecke geschlossen, nicht nebenbei die Berichtigungs-Politik geaendert.
// Der Preis ist gemessen, nicht geschaetzt: GFI verliert damit sein aeltestes Jahr
// (FY2017 ist nur im 20-F/A getaggt) — 7 statt 8 Jahre. Ein fehlendes Altjahr ist der
// billigere Fehler als eine still geaenderte Regel fuer 5.000 US-Namen.
const ANNUAL_FORMS = ['10-K', '20-F', '40-F'];

// --- SEC-Konzept-Namen (us-gaap) --------------------------------------------
// Umsatz wechselt das Konzept ueber die Jahre -> Prioritaets-Union (aktuelles zuerst).
const REV_CONCEPTS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax', // ~2019+
  'RevenueFromContractWithCustomerIncludingAssessedTax', // ~2019+, Filer die Verkaufssteuern
  //   im Umsatz ausweisen (Einzelhandel, Vertriebe). GLEICHE Groesse, andere Steuer-Behandlung
  //   -> als Gesamtumsatz brauchbar. Live-Beleg 28.07.: AAR Corp fuehrt AUSSCHLIESSLICH dieses
  //   Tag fuer 8 Jahre, hatte damit 8/16 statt 16/16 Umsatzjahren.
  'Revenues',                                            // Fallback-Uebergangsjahre
  'SalesRevenueNet',                                     // ~2017-
];
// BEWUSST NICHT in der Liste: SalesRevenueGoodsNet / SalesRevenueServicesNet. Das sind
// BESTANDTEILE des Umsatzes, keine Gesamtgroesse — bei AAR stehen beide (je 8 Jahre) NEBEN
// SalesRevenueNet. Als Fallback wuerde ein Filer, der Waren und Dienste getrennt ausweist,
// stillschweigend nur seinen Warenanteil melden. Eine fehlende Jahreszahl ist ehrlich,
// ein Bestandteil in der Rolle der Gesamtgroesse ist falsch.
const C_OPINC = 'OperatingIncomeLoss';
const C_NETINC = 'NetIncomeLoss';
const C_OCF = 'NetCashProvidedByUsedInOperatingActivities';
const C_CAPEX = 'PaymentsToAcquirePropertyPlantAndEquipment'; // positiver Cash-Abfluss
const C_GP = 'GrossProfit';
// Bilanz (Phase 4.1): Assets/LiabilitiesCurrent -> invested = Assets - CurrLiab je FY (wie capitalEfficiency/
// roicStability). Kanonische, ueber 10-15J stabile us-gaap-Tags (probe-verifiziert: MU 15J, MSFT/NVDA 16J
// lueckenlos). Falls ein frueher Filer driftet: Prio-Union analog REV_CONCEPTS ergaenzen (add when).
const C_ASSETS = 'Assets';
const C_CURLIAB = 'LiabilitiesCurrent';
const SHARE_CONCEPTS = [
  ['dei', 'EntityCommonStockSharesOutstanding', false],
  ['us-gaap', 'CommonStockSharesOutstanding', false],
  ['us-gaap', 'WeightedAverageNumberOfSharesOutstandingBasic', true],
];

// --- Taxonomien (us-gaap + ifrs-full) ---------------------------------------
// companyfacts liefert Kennzahlen nach BILANZIERUNGS-STANDARD getrennt. Bis 19.08.2026 las
// extractSecSeries() ausschliesslich facts['us-gaap'] — Firmen, die nach IFRS bilanzieren,
// fielen lautlos heraus. Live gemessen 19.08.2026: ARGX 250 ifrs-full-Kennungen (us-gaap: 2),
// DLO 236 (us-gaap: 0, gar keine us-gaap-Sektion), GFI 279.
//
// Die Zuordnung ist NICHT geraten, sondern je Rolle an den drei Testfaellen abgelesen
// (20-F, fp=FY, Einheit USD; Werte in Mio. USD, neuestes Jahr zuerst):
//   Umsatz    ifrs-full:Revenue                     GFI 7J 2024=5202/2023=4501 · DLO 5J 2025=1094/2024=746
//   OpInc     ProfitLossFromOperatingActivities     ARGX 6J 2025=1054/2024=-22 · DLO 5J 2025=220
//   NetInc    ProfitLoss                            ARGX 6J 2025=1292 · GFI 8J 2024=1291 · DLO 5J 2025=197
//   OCF       CashFlowsFromUsedInOperatingActivities ARGX 5J 2025=685 · GFI 8J 2024=1607 · DLO 5J 2025=416
//   Capex     PurchaseOfPropertyPlantAndEquipment-   ARGX 5J 2025=6,2 · GFI 8J 2024=1183 · DLO 5J 2025=2,3
//             ClassifiedAsInvestingActivities        (positiver Abfluss, gleiche Konvention wie us-gaap)
//   GP        GrossProfit (gleicher Name wie us-gaap) DLO 5J 2025=403 · ARGX/GFI fuehren keins
//   Assets    Assets      (gleicher Name)            alle drei
//   CurrLiab  CurrentLiabilities                     alle drei   (us-gaap heisst es LiabilitiesCurrent)
//
// ⚠ UMSATZ: die Liste enthaelt BEWUSST NUR 'Revenue' — dieselbe Regel wie bei den us-gaap-
// Bestandteilen oben, hier an ARGX belegt. argenx fuehrt kein 'Revenue' in USD, dafuer
// 'RevenueFromContractsWithCustomers' — das aber als BESTANDTEIL: FY2023 stehen dort 35,5 Mio.
// neben 'RevenueFromSaleOfGoods' 1.190,8 Mio. (Gesamtzeile des Abschlusses: 1.268,6 Mio.).
// Wer RevenueFromContractsWithCustomers als Gesamtumsatz nimmt, meldet fuer argenx 35,5 statt
// 1.226 Mio. — Faktor 35 zu niedrig, lautlos, in jede Wachstums- und Margenachse hinein.
// Ebenso NICHT drin: 'RevenueAndOperatingIncome' (ARGX 6J). Das ist Umsatz PLUS sonstige
// betriebliche Ertraege (FY2023 1.268,6 = 1.190,8 + 35,5 + 42,3) — eine andere Groesse. Sie
// neben 'Revenue' zu stellen hiesse, GFI und ARGX mit zwei verschiedenen Definitionen in
// DERSELBEN Spalte zu vergleichen. Folge, so gewollt: argenx bekommt KEINE Umsatzjahre aus
// SEC (annualRev bleibt null -> Yahoo-Fallback), seine sieben uebrigen Reihen kommen an.
// Ein fehlendes Jahr ist ehrlich, ein Bestandteil in der Rolle der Gesamtgroesse ist falsch.
const TAXONOMIEN = {
  // Reihenfolge ist Teil der Regel: bei Gleichstand im juengsten Geschaeftsjahr gewinnt
  // us-gaap (siehe waehleTaxonomie) -> reine US-Filer verhalten sich exakt wie vorher.
  'us-gaap': {
    rev: REV_CONCEPTS,
    opinc: C_OPINC, netinc: C_NETINC, ocf: C_OCF, capex: C_CAPEX,
    gp: C_GP, assets: C_ASSETS, curliab: C_CURLIAB,
  },
  'ifrs-full': {
    rev: ['Revenue'],
    opinc: 'ProfitLossFromOperatingActivities',
    netinc: 'ProfitLoss',
    ocf: 'CashFlowsFromUsedInOperatingActivities',
    capex: 'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',
    gp: 'GrossProfit',
    assets: 'Assets',
    curliab: 'CurrentLiabilities',
  },
};

// NUR die USD-Einheit — und das ist bei IFRS-Filern kein Versehen, sondern der Schutz vor
// dem Waehrungs-Mix. companyfacts fuehrt dieselbe Kennzahl teils in mehreren Waehrungen:
// argenx z. B. 2.959 USD- neben 1.900 EUR-Eintraegen (bis FY2020 wurde in EUR berichtet,
// ab FY2021 in USD). Wer die Erstbeste naehme, saehe eine Umsatzreihe, in der 2019 EUR und
// 2022 USD steht — ein erfundenes Wachstum. Weil dieser Filter fuer JEDE Kennzahl gleich
// greift, ist jeder gelieferte Wert USD; ein Jahr ohne USD-Fassung faellt heraus (null),
// statt in fremder Waehrung mitzulaufen. Sichtbare Folge: ARGX' 'Revenue' steht nur in EUR
// (FY2015-2017) und wird korrekt verworfen.
function usdUnits(tax, concept) {
  const node = tax && tax[concept];
  return (node && node.units && Array.isArray(node.units.USD)) ? node.units.USD : [];
}

// Annual (Volljahr): Jahresbericht-Form (ANNUAL_FORMS) & fp 'FY', dedupe je fy
// (neueste 'end' gewinnt). -> Map fy -> {val, end}
function annualConcept(tax, concept) {
  const out = new Map();
  for (const x of usdUnits(tax, concept)) {
    if (ANNUAL_FORMS.includes(x.form) && x.fp === 'FY' && x.fy != null && Number.isFinite(x.val)) {
      const prev = out.get(x.fy);
      // BH-007: keep accn (filing identity) alongside the value so callers can
      // verify two concepts for the same fy actually came from the same 10-K.
      // 4.1 Auflage 5 (29.07.): `filed` = das EINREICHUNGSDATUM der Fassung, aus der der
      // Wert stammt. Ohne es ist jede Rueckrechnung vergiftet — ein Wert fuer 2016 in der
      // Fassung von 2019 war 2016 noch nicht bekannt. Was jetzt nicht mitgeschrieben wird,
      // fehlt spaeter unwiederbringlich (dieselbe Lektion wie beim Ticker-Mitschnitt).
      const laterEnd = !prev || x.end > prev.end;
      const sameEndLaterFiling = prev && x.end === prev.end && (x.filed || '') > (prev.filed || '');
      if (laterEnd || sameEndLaterFiling) out.set(x.fy, { val: x.val, end: x.end, accn: x.accn, filed: x.filed || null });
    }
  }
  return out;
}

// Umsatz-Union: je fy den Wert des zum Datum gueltigen Konzepts (Prioritaets-Reihenfolge).
// S4-SEC-001-Fix: der erste (hoechst-priorisierte) Treffer gewinnt NICHT mehr blind. Meldet
// ein niedriger priorisiertes Konzept fuer DASSELBE fy einen Wert, der um mehr als Faktor 2
// abweicht, ist das kein Rundungsrauschen, sondern ein Konzept-Mismatch (Beleg: 58,1 Mio. vs.
// 805,7 Mio. im selben Geschaeftsjahr). Fail closed statt raten: das fy wird verworfen (nicht
// in die Union aufgenommen) und fail-loud geloggt (Ticker + beide Konzepte + Werte), statt
// einen falschen Umsatz lautlos in jede Wachstumsachse zu speisen.
// revConcepts: Prioritaets-Liste der GESAMTUMSATZ-Konzepte der gewaehlten Taxonomie
// (Default us-gaap — die bestehenden Aufrufer/Tests bleiben unveraendert).
function annualRevUnion(gaap, ticker, revConcepts = REV_CONCEPTS) {
  const maps = revConcepts.map((c) => annualConcept(gaap, c));
  const fySet = new Set();
  for (const m of maps) for (const fy of m.keys()) fySet.add(fy);
  const out = new Map();
  for (const fy of fySet) {
    let winnerIdx = -1, winner = null, conflictIdx = -1;
    for (let i = 0; i < maps.length; i++) {
      const row = maps[i].get(fy);
      if (!row) continue;
      if (winner === null) { winner = row; winnerIdx = i; continue; }
      // Review-Fund 02.08.: `a > 0 && b > 0` nahm ausgerechnet den schaedlichsten Fall aus
      // der Pruefung — meldet der hoeher priorisierte Tag eine 0 und der andere den echten
      // Umsatz, war der Faktor nicht berechenbar, der Konflikt blieb unbemerkt und die 0
      // ging als Jahresumsatz in die Union. Ein Nullumsatz vergiftet Wachstums- und
      // Margen-Achsen staerker als der Konzept-Mismatch, den die Pruefung fangen soll.
      // Ebenso raus: Math.abs verglich −805 Mio. gegen +805 Mio. als Faktor 1 (kein
      // Konflikt) — ein Vorzeichenfehler im Tag waere so durchgerutscht.
      const a = winner.val, b = row.val;
      const einsNull = (a === 0) !== (b === 0);
      const vorzeichenweg = a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b);
      const faktor = a !== 0 && b !== 0 && Math.max(Math.abs(a), Math.abs(b)) / Math.min(Math.abs(a), Math.abs(b)) > 2;
      if (einsNull || vorzeichenweg || faktor) { conflictIdx = i; break; }
    }
    if (conflictIdx >= 0) {
      const loser = maps[conflictIdx].get(fy);
      console.warn(
        `[merge-sec-xbrl] Umsatz-Konflikt ${ticker || 'unknown'} FY${fy}: ${revConcepts[winnerIdx]}=${winner.val} ` +
        `vs. ${revConcepts[conflictIdx]}=${loser.val} (Null-gegen-Wert, Vorzeichen oder Faktor>2) — Jahr verworfen statt geraten`
      );
      continue;
    }
    if (winner) out.set(fy, winner);
  }
  return out;
}

function shareFacts(taxonomy, concept) {
  const node = taxonomy && taxonomy[concept];
  const units = node && node.units;
  if (!units) return [];
  if (Array.isArray(units.shares)) return units.shares;
  const first = units[Object.keys(units)[0]];
  return Array.isArray(first) ? first : [];
}

// gewaehlt = die fuer diese Firma gewaehlte Taxonomie-Sektion (us-gaap ODER ifrs-full).
// Der dei-Eintrag traegt die Last: dei ist standard-unabhaengig und im 20-F/40-F genauso
// getaggt wie im 10-K (gemessen: ARGX 9, GFI 16, DLO 5 Eintraege). Die beiden us-gaap-
// Kennungen darunter existieren in ifrs-full schlicht nicht -> IFRS-Filer ohne dei-Eintrag
// bekommen null (kein Wert), nie einen fremden. IFRS-eigene Aktien-Kennungen
// (NumberOfSharesOutstanding/-Issued) sind bewusst nicht ergaenzt: dei deckt alle drei
// Testfaelle ab, ergaenzen wenn ein Filer ohne dei-Eintrag auftaucht.
function sharesAtFyEnd(gewaehlt, dei, fyEnd) {
  if (!fyEnd) return null;
  for (const [taxonomy, concept, annualOnly] of SHARE_CONCEPTS) {
    const tax = taxonomy === 'dei' ? dei : gewaehlt;
    let best = null;
    for (const x of shareFacts(tax, concept)) {
      if (!x || !Number.isFinite(x.val) || !x.end || x.end > fyEnd) continue;
      if (annualOnly && (!ANNUAL_FORMS.includes(x.form) || x.fp !== 'FY')) continue;
      if (!best || x.end >= best.end) best = x;
    }
    if (best) return best.val;
  }
  return null;
}

// Tiefe annual-Serien, alle auf EINER fy-Achse (Union der fy) index-aligned, newest-first.
// `tax` ist EINE Taxonomie-Sektion, `konzepte` die dazu passende Zeile aus TAXONOMIEN —
// beide gehoeren zusammen und werden nie ueber Kreuz gemischt (siehe waehleTaxonomie).
// Default us-gaap: die bestehenden Aufrufer buildAnnual(gaap) / buildAnnual(gaap, {})
// verhalten sich unveraendert.
function buildAnnual(tax, dei = {}, ticker, konzepte = TAXONOMIEN['us-gaap']) {
  const rev = annualRevUnion(tax, ticker, konzepte.rev);
  const opinc = annualConcept(tax, konzepte.opinc);
  const ni = annualConcept(tax, konzepte.netinc);
  const ocf = annualConcept(tax, konzepte.ocf);
  const capex = annualConcept(tax, konzepte.capex);
  const gp = annualConcept(tax, konzepte.gp);
  const assets = annualConcept(tax, konzepte.assets);
  const curliab = annualConcept(tax, konzepte.curliab);

  // gemeinsame fy-Achse = Union ueber die Serien; numerisch absteigend (newest-first).
  const fySet = new Set();
  for (const m of [rev, opinc, ni, ocf, capex, gp, assets, curliab]) for (const fy of m.keys()) fySet.add(fy);
  const fys = [...fySet].sort((a, b) => b - a);
  const fyEnds = new Map();
  for (const m of [rev, opinc, ni, ocf, capex, gp, assets, curliab]) {
    for (const [fy, row] of m) if (!fyEnds.has(fy)) fyEnds.set(fy, row.end);
  }

  const cell = (m, fy) => (m.has(fy) ? { value: m.get(fy).val } : { value: null });
  const fcfCell = (fy) => (ocf.has(fy) && capex.has(fy))
    ? { value: ocf.get(fy).val - capex.get(fy).val }  // FCF = OCF - Capex(positiv)
    : { value: null };
  // BH-007 fix: same fy alone doesn't prove same 10-K -- a fy-union axis can pair
  // an Assets/CurrLiab value that was later amended against an OpInc value that
  // wasn't (or vice versa). axes.js roicStabilitySource relies on this trio being
  // filing-coherent (comment there: "NIE feldweise gemischt"), so gate the balance-
  // sheet cell on matching accn (filing identity) with OpInc for that fy; on
  // mismatch null it out (fail closed) instead of silently pairing two vintages.
  const balCell = (m, fy) => {
    if (!m.has(fy)) return { value: null };
    const opRow = opinc.get(fy);
    if (opRow && m.get(fy).accn !== opRow.accn) return { value: null };
    return { value: m.get(fy).val };
  };

  return {
    _fys: fys,
    annualRev: fys.map((fy) => cell(rev, fy)),
    annualOpInc: fys.map((fy) => cell(opinc, fy)),
    annualNetIncome: fys.map((fy) => cell(ni, fy)),
    annualOCF: fys.map((fy) => cell(ocf, fy)),
    annualFCF: fys.map((fy) => fcfCell(fy)),
    annualGP: fys.map((fy) => cell(gp, fy)),
    // Bilanz (Phase 4.1): index-aligned auf dieselbe _fys-Achse -> Assets/CurrLiab/OpInc eines FY
    // stammen aus DEMSELBEN 10-K (accn-geprueft via balCell) -> invested = Assets - CurrLiab FY-kohaerent.
    annualAssets: fys.map((fy) => balCell(assets, fy)),
    annualCurrentLiabilities: fys.map((fy) => balCell(curliab, fy)),
    annualShares: fys.map((fy) => ({ value: sharesAtFyEnd(tax, dei, fyEnds.get(fy)) })),
    // Je Geschaeftsjahr das SPAETESTE Einreichungsdatum unter den Konzepten, die diese
    // Zeile gefuellt haben — bewusst das spaeteste: erst ab diesem Tag war die ganze
    // Zeile oeffentlich. Ein frueheres Datum wuerde eine Rueckrechnung Wissen unterstellen,
    // das damals noch nicht da war. Null, wenn die SEC kein filed mitliefert.
    annualFiled: fys.map((fy) => {
      let spaetestes = null;
      for (const m of [rev, opinc, ni, ocf, capex, gp, assets, curliab]) {
        const row = m.get(fy);
        const f = row && row.filed;
        if (f && (spaetestes == null || f > spaetestes)) spaetestes = f;
      }
      return { value: spaetestes };
    }),
  };
}

// Juengstes Geschaeftsjahr, das diese Taxonomie ueberhaupt hergibt — gemessen mit
// annualConcept(), also mit EXAKT denselben Form-/fp-/USD-Regeln, nach denen nachher
// gebaut wird. Bewusst keine zweite, schnellere Zaehl-Logik: eine zweite Regel waere die
// naechste Drift-Stelle. `null` = diese Taxonomie liefert kein einziges Jahr.
function neuestesJahr(tax, konzepte) {
  let max = null;
  for (const c of [...konzepte.rev, konzepte.opinc, konzepte.netinc, konzepte.ocf, konzepte.assets]) {
    for (const fy of annualConcept(tax, c).keys()) if (max === null || fy > max) max = fy;
  }
  return max;
}

/**
 * Waehlt GENAU EINE Taxonomie je Firma — nie eine Mischung.
 *
 * WARUM NICHT MISCHEN: dieselbe Firma kann unter zwei Standards unterschiedliche Werte
 * melden (die Doppelnotierungen im Universum zeigen Abweichungen von 1,2 % beim Rohertrag
 * bis 14 % beim Umsatz). Eine Reihe, in der 2019 aus us-gaap und 2023 aus ifrs-full kommt,
 * erfindet an der Nahtstelle einen Sprung, den es nie gab. Deshalb: eine Firma, eine
 * Taxonomie, und welche es war, steht am Datensatz (extractSecSeries().taxonomie).
 *
 * WARUM NACH DEM JUENGSTEN JAHR und nicht "us-gaap zuerst, sonst ifrs": weil "us-gaap hat
 * irgendwas" nicht heisst "us-gaap ist der aktuelle Standard". Gold Fields (GFI) ist der
 * Beleg — 350 us-gaap-Kennungen, aber alle aus den Ueberleitungs-Jahren bis FY2015 und
 * OHNE Umsatz; ifrs-full traegt FY2018-2024 samt Umsatz. Blosser us-gaap-Vorrang haette
 * GFI eine zehn Jahre alte, umsatzlose Reihe angehaengt und das als Erfolg gezaehlt.
 * Gleichstand -> us-gaap (Schluesselreihenfolge in TAXONOMIEN, strikter Vergleich unten):
 * reine US-Filer haben ohnehin nur eine Taxonomie mit Jahren und bleiben unveraendert.
 */
function waehleTaxonomie(facts) {
  let best = null;
  for (const name of Object.keys(TAXONOMIEN)) {
    const tax = (facts && facts[name]) || {};
    const fy = neuestesJahr(tax, TAXONOMIEN[name]);
    if (fy === null) continue;
    if (best === null || fy > best.fy) best = { name, tax, konzepte: TAXONOMIEN[name], fy };
  }
  // Keine Taxonomie liefert ein Jahr -> 'nicht verfuegbar'. Es wird NICHT auf us-gaap
  // "zurueckgefallen" und keine Null erfunden; der Aufrufer sieht taxonomie === null und
  // zaehlt den Fall (build-secannual.js: ohneReihe).
  return best || { name: null, tax: {}, konzepte: TAXONOMIEN['us-gaap'] };
}

/**
 * extractSecSeries(companyfacts, ticker) -> { annual:{...}, taxonomie:'us-gaap'|'ifrs-full'|null }
 * Reine Funktion. companyfacts = geparste CIK<cik>.json. ticker ist OPTIONAL — nur fuer die
 * S4-SEC-001-Konflikt-Logzeile in annualRevUnion (Aufrufer, die ihn nicht kennen, bekommen 'unknown').
 *
 * `taxonomie` ist die HERKUNFT der Reihen und gehoert an jeden Datensatz, der daraus
 * entsteht (build-secannual.js / build-secannual-smallcap.js schreiben sie neben `cik`,
 * fetch-secbulk.js in jede jsonl-Zeile). null = weder us-gaap noch ifrs-full liefert ein
 * Jahr -> nicht verfuegbar, gezaehlt, nie eine 0 und nie ein geschaetzter Wert.
 */
function extractSecSeries(companyfacts, ticker) {
  const facts = (companyfacts && companyfacts.facts) || {};
  const dei = facts.dei || {};
  const w = waehleTaxonomie(facts);
  return { annual: buildAnnual(w.tax, dei, ticker, w.konzepte), taxonomie: w.name };
}

// --- Overlap-Validierung (SEC vs Yahoo fuer die gemeinsamen Fuehrungsjahre) ---
const cleanVals = (arr) => (Array.isArray(arr) ? arr.map((x) => (x && typeof x === 'object' ? x.value : x)) : []);

/**
 * ⚠ ANNAHME, die hier drinsteckt und bis 28.07. nirgends stand: Position i der Yahoo-Reihe
 * und Position i der SEC-Reihe meinen DASSELBE Geschaeftsjahr. Der Yahoo-Jahresblock
 * traegt keine Jahres-Labels — die Annahme ist also nicht aus den Daten selbst pruefbar.
 *
 * Am 28.07. erstmals gegengeprueft, indem je Firma der beste Versatz am UMSATZ bestimmt
 * wurde (bei beiden Quellen eindeutig, keine Definitionsfrage), ueber 1.827 Firmen:
 *     Versatz 0 bestaetigt (<2 % Abweichung) : 1.472  (80,6 %)
 *     Versatz +-1 oder +-2                   :    55  ( 2,9 %)
 *     kein Treffer bei keinem Versatz        :   300  (16,4 %)
 * Die Annahme traegt also ueberwiegend, aber nicht immer. Wer diese Funktion fuer eine
 * ERNSTE Aussage benutzt (nicht nur die grobe loose-sanity-Pruefung, fuer die sie gebaut
 * wurde), muss vorher die Zuordnung je Firma belegen — sonst misst er bei jeder fuenften
 * Firma zwei verschiedene Jahre gegeneinander.
 */
function overlapDivergence(yahooArr, secArr) {
  const y = cleanVals(yahooArr), s = cleanVals(secArr);
  const n = Math.min(y.length, s.length);
  let maxRel = 0, compared = 0;
  for (let i = 0; i < n; i++) {
    const a = y[i], b = s[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const denom = Math.max(Math.abs(a), Math.abs(b));
    if (denom === 0) continue;
    maxRel = Math.max(maxRel, Math.abs(a - b) / denom);
    compared++;
  }
  return { maxRel, compared };
}

/**
 * mergeSecIntoSnapshot(snapshot, sec, opts) -> report
 *   opts.mode = 'namespace' (default, additiv) | 'replace' (score-aendernd)
 *   opts.overlapTolerance = 0.12 (12% — SEC audited vs Yahoo weichen leicht ab)
 * Mutiert snapshot in place. Bei grober Overlap-Divergenz (>Toleranz) im replace-Modus
 * das betroffene Feld NICHT ersetzen (Konzept-Mismatch/Restatement) und flaggen.
 */
// Felder, die im replace-Modus ersetzt UND auf Overlap-Divergenz geprueft werden.
// Bug 15: Gate-Loop und Replace-Loop MUESSEN dieselbe Liste nutzen, sonst laufen
// annualFCF/annualOCF ungeprueft durch.
const ANNUAL_FIELDS = ['annualRev', 'annualOpInc', 'annualNetIncome', 'annualFCF', 'annualOCF'];

// Feld hat mindestens eine finite Zelle? (Bug 14: Null-Serie soll echte Yahoo-Werte nicht ueberschreiben.)
function hasFiniteCell(arr) {
  return Array.isArray(arr) && arr.some((c) => Number.isFinite(c && c.value));
}

function mergeSecIntoSnapshot(snapshot, sec, opts = {}) {
  const mode = opts.mode || 'namespace';
  const tol = opts.overlapTolerance != null ? opts.overlapTolerance : 0.12;
  if (!snapshot || typeof snapshot !== 'object') return { merged: false, reason: 'no-snapshot' };
  snapshot.annual = snapshot.annual || {};

  const divergences = {};
  const compared = {};
  for (const f of ANNUAL_FIELDS) {
    const d = overlapDivergence(snapshot.annual[f], sec.annual[f]);
    compared[f] = d.compared;
    if (d.compared > 0 && d.maxRel > tol) divergences[f] = Number(d.maxRel.toFixed(3));
  }

  if (mode === 'replace') {
    for (const f of ANNUAL_FIELDS) {
      if (divergences[f]) continue;                          // grobe Divergenz -> Yahoo behalten + flaggen
      if (!hasFiniteCell(sec.annual[f])) continue;           // Bug 14: reine Null-Serie darf echte Yahoo-Werte nicht ueberschreiben
      // Bug 14: hat Yahoo echte Werte, war aber kein Overlap-Vergleich moeglich (disjunkte fy) -> konservativ Yahoo behalten.
      // Fehlt Yahoo das Feld ganz, darf SEC weiterhin vertiefen (compared===0 ist dann kein Konflikt).
      if (!compared[f] && hasFiniteCell(snapshot.annual[f])) continue;
      if (sec.annual[f] && sec.annual[f].length) snapshot.annual[f] = sec.annual[f];
    }
  } else {
    // additiv: tiefe Serie separat ablegen, Scoring-Felder unberuehrt.
    snapshot.secAnnual = sec.annual;
  }
  return { merged: true, mode, divergences, years: sec.annual._fys.length };
}

module.exports = {
  extractSecSeries, mergeSecIntoSnapshot,
  // fuer Tests / gezielte Wiederverwendung
  buildAnnual, annualConcept, annualRevUnion, overlapDivergence,
  waehleTaxonomie, ANNUAL_FORMS, TAXONOMIEN,
};
