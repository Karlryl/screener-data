#!/usr/bin/env node
'use strict';
/**
 * write-excluded-list.js — die Ausschluss-Liste (Karl-Entscheid 02.08.2026).
 *
 *   node scripts/write-excluded-list.js      # baut outputs/findash-export/v1/excluded.json
 *
 * WARUM ES DIESE DATEI GIBT
 * -------------------------
 * In score.js produceRankings() faellt jede nicht bewertbare Zeile so:
 *     excluded[k] = (excluded[k] || 0) + 1;  continue;
 * Ein Zaehler steigt, die Zeile ist weg. Kein Kuerzel, kein Name ueberlebt. Am Stand
 * vom 19.08. traf das 5.792 Zeilen aus elf Gruenden — darunter echte Wachstumsfirmen
 * (Nubank, Upstart, Palomar, Lemonade, Root, SoFi). Karls eigener Entscheid vom
 * 02.08. steht woertlich in derselben Datei: "Eine Grenze, die Namen wegnimmt, wird
 * durch eine Einteilung ersetzt, die sie sortiert — niemand verschwindet."
 *
 * DER AUSSCHLUSS SELBST BLEIBT. Hier wird NICHTS geoeffnet und NICHTS neu bewertet:
 * Banken und Versicherer in die Umsatz-Achsen zu lassen setzt Japan Post (+5.420 %),
 * AGNC (+3.650 %) und Sompo (+3.409 %) an die Spitze — reine Bilanz- und
 * Anlageergebnis-Artefakte. Diese Datei macht nur SICHTBAR, wer ausgeschlossen wurde.
 *
 * EINE REGEL-QUELLE, NICHT ZWEI
 * -----------------------------
 * Die Gruende werden NICHT nachgebaut. Gelaufen wird derselbe scoreUniverse()-Pass,
 * den run-screener.js fuer die Boards fuehrt; gesammelt werden genau die Zeilen, die
 * produceRankings() wegzaehlt (action 'exclude' oder 'unrouted'), mit demselben
 * Schluessel (`reason || action`, score.js:1416).
 *
 * WICHTIG (Befund beim Bau): route() allein traegt nur ACHT der elf Gruende
 * (non-us, telecom, balance-sheet-bank, insurer, mortgage-reit, non-operating-rev,
 * lender-gp0, no-sector). Die drei uebrigen entstehen erst in scoreUniverse():
 * data-suspect (Qualitaets-Gate vor dem Scoren), dup-issuer (Emittenten-Dedup) und
 * no-axes (alle Roh-Achsen null). Ein Skript, das nur route() befragt, verloere
 * 2.796 der 5.792 Zeilen — die Haelfte der Liste, still. Deshalb der volle Pass.
 *
 * DIE SUMMEN-WACHE IST DER PRODUKT-KERN
 * -------------------------------------
 * Eine Liste, die WENIGER enthaelt als der Zaehler behauptet, ist genau der stille
 * Verlust, den sie beheben soll. Darum wird je Grund gegen die bereits geschriebenen
 * Zaehler in outputs/findash-export/v1/index.json.excluded geprueft und bei jeder
 * Abweichung ABGEBROCHEN (kein Schreiben, exit 1) — nicht gewarnt.
 *
 * FIRMEN STATT BOERSENPLAETZE
 * ---------------------------
 * Mehrfach-Beine desselben Emittenten (HSBC haelt drei) werden ueber issuerDedupGroups()
 * aus score.js zusammengefasst — dieselbe Gruppierung, die die Produktion fuer den
 * Dedup nutzt, keine zweite. Zusammengefasst heisst NICHT verschluckt: jedes Bein steht
 * einzeln unter `beine`, die Summen-Wache zaehlt Beine, nicht Firmen.
 *
 * Waechter: tests/scoring/ausschlussliste.test.js
 */
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../lib/atomic-write.js');
const { loadUniverse } = require('../src/scoring/run-screener.js');
const {
  scoreUniverse, issuerKeyLoose, issuerDedupGroups, issuerDedupComparator,
} = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'outputs', 'findash-export', 'v1');
const OUT_FILE = path.join(OUT_DIR, 'excluded.json');
const INDEX_FILE = path.join(OUT_DIR, 'index.json');
// T155/W3: Traeger-Datei fuer den Universums-Hash. Bewusst NICHT unter
// outputs/findash-export/v1/ und nicht unter outputs/hypergrowth/ — nur diese beiden
// Verzeichnisse kopiert der gh-pages-Deploy (daily-pull.yml, "cp ../outputs/hypergrowth/*.json"
// bzw. "cp -r ../outputs/findash-export/v1/."). Der Traeger bleibt damit lauf-lokal und
// erzeugt keine neue oeffentliche Datei; wer den Hash oeffentlich braucht, liest ihn aus
// excluded.json bzw. aus dem Vintage.
const UNIVERSE_HASH_FILE = path.join(ROOT, 'outputs', 'universe-hash.json');

/**
 * T155/W3 — Pruefsumme ueber die MENGE der bewerteten Ticker.
 *
 * WOZU. Bewegt sich ein Score zwischen zwei Laeufen, war bisher nicht maschinell
 * unterscheidbar, ob sich die DATEN bewegt haben oder die KOHORTE (das Produkt
 * normiert kohorten-relativ und kalibriert taeglich neu). Mit dem Hash ist die
 * Herkunftsfrage ein Zeichenketten-Vergleich: gleicher Hash + andere Scores =
 * Datenaenderung; anderer Hash = Kohortenwechsel.
 *
 * WAS GEHASHT WIRD. Genau das, was loadUniverse() zurueckgibt — nicht ein
 * Stellvertreter aus einem Board. Ein Board ist gekappt bzw. gefiltert; die
 * Normierungs-Kohorte ist das geladene Universum. Sortiert und dedupliziert, damit
 * die Datei-Lesereihenfolge (OS-abhaengig) den Hash nicht bewegt.
 *
 * FORM. Wie `summeVon` in scripts/snapshot-ticker-map.js:198 (sha256 ueber die
 * sortierte, komma-getrennte Symbolliste, auf 16 Hex gekuerzt) — bewusst NICHT von
 * dort importiert: jenes Modul ruft beim Laden secUserAgent() auf (:68) und wuerde
 * diesen Lauf an eine SEC-Umgebungsvariable binden, die er nicht braucht.
 */
function universumsHash(tickers) {
  // Review-Befund (typescript-reviewer, 28.08.): ohne Pruefung waere ein `undefined`
  // in der Liste KEIN Fehler, sondern eine stille Verschiebung — sort() haengt es
  // hinten an, join() macht ein leeres Feld daraus, und der Hash bewegt sich aus einem
  // Grund, der nichts mit der Kohorte zu tun hat. Genau die Klasse, gegen die diese
  // Pruefsumme gebaut ist. Deshalb: laut werfen statt still faelschen.
  const kaputt = [...tickers].filter((t) => typeof t !== 'string' || t.length === 0).length;
  if (kaputt > 0) {
    throw new Error(`[universums-hash] ${kaputt} von ${[...tickers].length} Eintraegen sind kein nicht-leerer `
      + 'String. Ein solcher Eintrag verschoebe den Hash, ohne dass sich die Kohorte geaendert hat — '
      + 'die Pruefsumme waere damit wertlos.');
  }
  return require('crypto').createHash('sha256')
    .update([...new Set(tickers)].sort().join(',')).digest('hex').slice(0, 16);
}

/**
 * Derselbe Hash, aber ueber ein UNIVERSUM (Snapshot-Objekte) statt ueber eine
 * Tickerliste. Existiert als eigene Funktion, damit die Abbildung
 * `Snapshot -> meta.ticker` gepinnt ist und nicht nur als Einzeiler in main() lebt:
 * ein spaeteres `s.ticker` statt `s.meta.ticker` waere sonst eine Aenderung ohne
 * Waechter (Review-Befund MITTEL, 28.08.). loadUniverse() garantiert `meta.ticker`
 * (run-screener.js:297) — die Pruefung oben faengt eine Aufweichung dieser Garantie.
 */
function universumsHashVon(universe) {
  return universumsHash(universe.map((s) => (s && s.meta ? s.meta.ticker : undefined)));
}
const SCHEMA = 'findash-export/v1';

// Derselbe Schluessel wie produceRankings (score.js:1416). Bewusst hier als EINZEILER
// gespiegelt statt neu gedacht: 'unrouted' traegt kein reason, faellt also auf action.
const grundVon = (e) => e.reason || e.action;

// Eine Ausschluss-Zeile, wie Karl sie liest. name/sector/marketCap/revGrowthYoYPct
// haengt scoreUniverse selbst an JEDE Ergebniszeile (score.js "A2", auch an die
// excludierten); industry lebt nur im Snapshot und kommt darum von dort.
function zeile(e) {
  const meta = (e.snapshot && e.snapshot.meta) || null;
  return {
    ticker: e.ticker,
    name: e.name ?? null,
    reason: grundVon(e),
    sector: e.sector ?? null,
    industry: (meta && typeof meta.industry === 'string' && meta.industry) || null,
    marketCap: Number.isFinite(e.marketCap) ? e.marketCap : null,
    revGrowthYoYPct: Number.isFinite(e.revGrowthYoYPct) ? e.revGrowthYoYPct : null,
  };
}

// Wachstum absteigend, Namenlose ans Ende, Ticker als deterministischer Tie-Break.
// (Karls erste Frage an diese Liste ist "wer waechst da unten am staerksten".)
function nachWachstum(a, b) {
  const av = Number.isFinite(a.revGrowthYoYPct) ? a.revGrowthYoYPct : -Infinity;
  const bv = Number.isFinite(b.revGrowthYoYPct) ? b.revGrowthYoYPct : -Infinity;
  if (av !== bv) return bv - av;
  return String(a.ticker) < String(b.ticker) ? -1 : (String(a.ticker) > String(b.ticker) ? 1 : 0);
}

// Dieselbe Bedingung, unter der produceRankings eine Zeile wegzaehlt (score.js:1414).
const istRaus = (e) => e.action === 'exclude' || e.action === 'unrouted';

/**
 * results (aus scoreUniverse) + universe -> { rows, legs, byReason }.
 * Reine Funktion, kein I/O — der Waechter fuettert sie mit Fixtures.
 */
function buildExcludedList(results, universe) {
  // scoreUniverse LOESCHT e.snapshot am Ende jedes Laufs (score.js, "SOLANGE der Snapshot
  // lebt"). Ohne ihn gaebe es weder industry noch einen Emittenten-Schluessel, und beides
  // waere still leer. Er kommt ueber die POSITION zurueck, nicht ueber den Ticker: die
  // Ergebnis-Schleife in scoreUniverse laeuft `for (const s of snapshots)` und pusht in
  // JEDEM Zweig genau einmal, ohne Filter, Splice oder Sortierung — results[i] gehoert also
  // zu universe[i]. Nachgezaehlt am echten Universum: 4.494/4.494, 0 Abweichungen. Ein Join
  // ueber den Ticker haette dagegen eine stille Fehlklasse: zwei Snapshots mit demselben
  // Ticker (nirgends erzwungen) haetten einer Zeile den Snapshot der FALSCHEN Firma
  // angehaengt — falsche Branche, falsche Gruppe, und die Summen-Wache sieht es nicht,
  // weil die Zeilenzahl stimmt.
  const alle = (Array.isArray(results) ? results : [])
    .map((e, i) => ({ ...e, snapshot: (universe || [])[i] || null }));

  // EINE Gruppierung ueber ALLE Zeilen, mit derselben Funktion, die die Produktion fuer den
  // Dedup nutzt (inkl. splitFalseIssuerMerges: zwei verschiedene Firmen mit gleich
  // normalisiertem Namen werden bewusst NICHT verschmolzen). Ausgeschlossene und bewertete
  // Beine derselben Firma landen dadurch garantiert in derselben Gruppe. Eine zweite,
  // handgebaute Zuordnung koennte davon abweichen und "steht im Board als X" auf eine
  // FREMDE Firma zeigen lassen — lautlos, weil keine Zahl dabei kaputtgeht.
  //
  // issuerDedupGroups() laesst Eintraege OHNE Emittenten-Schluessel (kein meta.name)
  // ersatzlos fallen — in der Produktion harmlos (sie koennen nicht Dublette sein), hier
  // waere es exakt der stille Verlust, gegen den diese Datei gebaut ist. Sie werden darum
  // als eigene Ein-Bein-Gruppen nachgereicht.
  const ohneSchluessel = alle.filter((e) => istRaus(e) && !issuerKeyLoose(e.snapshot));
  const gruppen = issuerDedupGroups(alle).concat(ohneSchluessel.map((e) => [e]));

  const rows = [];
  for (const g of gruppen) {
    // Derselbe Comparator, den die Produktion fuer die Bein-Wahl nutzt (score.js) —
    // das fuehrende Bein ist damit dasselbe, das der Dedup bevorzugt haette.
    const beine = g.filter(istRaus).sort(issuerDedupComparator);
    if (!beine.length) continue; // Firma vollstaendig bewertet -> gehoert nicht in die Liste
    // dup-issuer stellt fast die Haelfte der Liste. Ohne diesen Hinweis liest sich die
    // Zeile, als sei die Firma weg — dabei steht ihr Hauptlisting im Board.
    const imBoard = g.filter((e) => !istRaus(e)).sort(issuerDedupComparator)[0] || null;
    rows.push({
      ...zeile(beine[0]),
      // ACHTUNG beim Lesen: die ZEILE ist die Firma, nicht der Schluessel. Nach
      // splitFalseIssuerMerges koennen zwei verschiedene Firmen denselben lockeren
      // Schluessel tragen und stehen dann bewusst als zwei Zeilen da.
      issuerKey: issuerKeyLoose(beine[0].snapshot) || null,
      // Tragen die Beine verschiedene Gruende (25 von 980 im Messlauf, meist Heimatboerse
      // + Grey-Market-Schatten), zeigt `reason` nur den des fuehrenden Beins — hier stehen
      // sie alle, damit die Uebersichtszeile nicht die Haelfte verschweigt.
      gruende: [...new Set(beine.map(grundVon))].sort(),
      imBoardAls: imBoard ? imBoard.ticker : null,
      beine: beine.map(zeile),
    });
  }
  rows.sort(nachWachstum);

  const raus = alle.filter(istRaus);
  const byReason = {};
  for (const e of raus) { const k = grundVon(e); byReason[k] = (byReason[k] || 0) + 1; }

  return { rows, legs: raus.length, byReason };
}

/**
 * Summen-Wache: je Grund Liste gegen index.json.excluded. Gibt die Abweichungen
 * zurueck (leer = sauber). Ueber die VEREINIGUNG beider Schluesselmengen — ein Grund,
 * den nur eine Seite kennt, ist genauso ein Bruch wie eine falsche Zahl.
 */
function pruefeSummen(byReason, indexExcluded) {
  const links = byReason || {};
  const rechts = indexExcluded || {};
  const fehler = [];
  for (const k of [...new Set([...Object.keys(links), ...Object.keys(rechts)])].sort()) {
    const a = links[k] || 0, b = rechts[k] || 0;
    if (a !== b) fehler.push(`${k}: Liste ${a}, index.json.excluded ${b}`);
  }
  return fehler;
}

// Anzahl der Beine ueber alle Firmenzeilen — muss legs entsprechen, sonst hat die
// Gruppierung selbst etwas verschluckt.
const beineGesamt = (rows) => rows.reduce((n, r) => n + r.beine.length, 0);

/**
 * Liest die Zaehler, gegen die geprueft wird. Eigene Funktion, damit der Waechter sie
 * ausfuehren kann: "nicht da", "da aber kaputt" und "da, aber ohne excluded-Objekt"
 * duerfen NIEMALS zu "keine Abweichung" degradieren — genau die Degradierung waere der
 * stille Verlust, gegen den diese Datei gebaut ist. Wirft immer, gibt nie null zurueck.
 */
function readExcludedCounter(indexFile) {
  let idx;
  try { idx = JSON.parse(fs.readFileSync(indexFile, 'utf8')); }
  catch (e) {
    throw new Error(`[excluded-list] ${indexFile} fehlt/unlesbar (${e.message}) — ohne die Zaehler ist die `
      + 'Liste unpruefbar. Zuerst run-screener.js und write-findash-export.js laufen lassen.');
  }
  if (!idx || !idx.excluded || typeof idx.excluded !== 'object' || Array.isArray(idx.excluded)) {
    throw new Error(`[excluded-list] ${indexFile} traegt kein excluded-Objekt — Liste unpruefbar.`);
  }
  return idx.excluded;
}

function main() {
  const universe = loadUniverse();
  // Gleicher Referenz-Modus wie run-screener.js: ist ein Lineal gesetzt, muss dieser
  // Pass gegen DASSELBE scoren, sonst weichen die no-axes-Zahlen ab und die
  // Summen-Wache faerbt den Lauf zu Recht rot. Fail-loud wie dort.
  let refCalibration = null;
  const refPath = process.env.SCORING_REF_CALIB;
  if (refPath) {
    try { refCalibration = JSON.parse(fs.readFileSync(refPath, 'utf8')); }
    catch (e) { throw new Error(`[excluded-list] SCORING_REF_CALIB gesetzt, aber nicht lesbar (${refPath}): ${e.message}`); }
  }
  const results = scoreUniverse(universe, formulas, refCalibration ? { refCalibration } : {});
  const { rows, legs, byReason } = buildExcludedList(results, universe);

  const fehler = pruefeSummen(byReason, readExcludedCounter(INDEX_FILE));
  if (fehler.length) {
    throw new Error('[excluded-list] Summen-Wache gebrochen — die Liste deckt sich nicht mit den Zaehlern:\n  '
      + fehler.join('\n  '));
  }
  if (beineGesamt(rows) !== legs) {
    throw new Error(`[excluded-list] Gruppierung hat Zeilen verschluckt: ${beineGesamt(rows)} Beine in ${rows.length} Firmen, erwartet ${legs}.`);
  }

  // T155/W3: der Hash wird HIER berechnet, weil hier das Universum ohnehin schon
  // geladen ist — ein zweiter Scan ueber ~15.000 Snapshot-Dateien waere derselbe Wert
  // zum doppelten Preis. write-board-history.js liest ihn spaeter aus der Traeger-Datei
  // (daily-pull.yml: dieser Schritt laeuft vor dem Vintage-Schreiber).
  const universeHash = universumsHashVon(universe);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeJsonAtomic(OUT_FILE, {
    schema: SCHEMA,
    generated_at: new Date().toISOString(),
    generatedFromSnapshots: universe.length,
    universeHash,
    counts: { firmen: rows.length, zeilen: legs, byReason },
    rows,
  });
  fs.mkdirSync(path.dirname(UNIVERSE_HASH_FILE), { recursive: true });
  writeJsonAtomic(UNIVERSE_HASH_FILE, {
    schema: 'universe-hash/v1',
    generated_at: new Date().toISOString(),
    universeHash,
    universeCount: universe.length,
  });
  console.log(`[excluded-list] Universums-Hash ${universeHash} ueber ${universe.length} bewertete Ticker`);
  console.log(`[excluded-list] ${legs} Ausschluss-Zeilen in ${rows.length} Firmen -> ${path.relative(ROOT, OUT_FILE)} `
    + `(${(fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`[excluded-list] Summen je Grund decken sich mit index.json.excluded: `
    + Object.keys(byReason).sort().map((k) => `${k}=${byReason[k]}`).join(' · '));
}

module.exports = { buildExcludedList, pruefeSummen, beineGesamt, readExcludedCounter, grundVon, zeile, universumsHash, universumsHashVon, SCHEMA, OUT_FILE, INDEX_FILE, UNIVERSE_HASH_FILE };

if (require.main === module) main();
