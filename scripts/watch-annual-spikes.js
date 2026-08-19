#!/usr/bin/env node
/**
 * Daten-Waechter: einzelne Jahres-Ausreisser in den gespeicherten Reihen.
 * ======================================================================
 *
 * ANLASS (Cigna, 29.07.2026): Im Store steht fuer Cignas Geschaeftsjahr 2022 ein
 * Betriebsergebnis von **-88.600 Mio**, waehrend die Nachbarjahre bei +7.295 und
 * +8.444 Mio liegen und Yahoo LIVE heute +7.370 (normalisiert) bzw. +8.536 (berichtet)
 * liefert. Der Wert ist also weder Yahoos aktuelle Zahl noch die der SEC — er stammt aus
 * einem einzelnen schlechten Abruf und ist seither eingefroren.
 *
 * DAS IST DIE EIGENTLICHE LUECKE: Der Store hat kein Gedaechtnis fuer Plausibilitaet.
 * Was einmal drinsteht, bleibt drin — auch wenn die Quelle es am naechsten Tag
 * widerruft. Ein Verhaeltnis-Gate (|OpInc| > Umsatz) faengt diesen Fall NICHT: -88,6 Mrd
 * gegen 194 Mrd Umsatz sind "nur" -46 % Marge, und die kann eine echte Abschreibung
 * erzeugen. Was ihn faengt, ist die FORM: ein Jahr, das von BEIDEN Nachbarn um
 * Groessenordnungen abweicht und danach zurueckspringt.
 *
 * WAS DIESER WAECHTER TUT: melden. Er repariert nichts und aendert keinen Score —
 * eine echte Sonderabschreibung sieht genauso aus, und die darf nicht wegretuschiert
 * werden. Er macht nur sichtbar, was sonst niemand sieht.
 *
 * ::error:: sobald mehr Ausreisser gefunden werden als die Schwelle erlaubt.
 *
 * Usage: node scripts/watch-annual-spikes.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');
const { norm, periodEnds } = require('../src/scoring/snapshot.js'); // das einzige Tor zu snapshot.annual.*

const ROOT = path.join(__dirname, '..');
const SNAP_DIR = path.join(ROOT, 'snapshots');
// Ein Ausreisser muss BEIDE Nachbarn um mindestens diesen Faktor uebertreffen. 8 ist
// bewusst grob: eine Verdopplung oder ein Verlustjahr sind normal, ein Achtfaches der
// beiden Nachbarn ist es nicht. Cigna 2022: |-88.600| / max(7.295, 8.444) = 10,5.
const FAKTOR = 8;
// Sehr kleine Zahlen schwanken relativ stark, ohne dass etwas kaputt ist.
const MIN_BETRAG = 50e6;
// Bei 4.700 Firmen sind einzelne echte Sonderjahre erwartbar — am 29.07. sind es 54.
// Eine feste Schwelle waere deshalb entweder von Tag eins an rot (nutzlos) oder so hoch,
// dass sie nichts faengt. Gemessen wird stattdessen das WACHSTUM gegen einen
// mitgefuehrten Bestand: bekannte Faelle schweigen, NEUE fallen auf. Das ist dasselbe
// Muster wie bei den anderen Daten-Waechtern (data-health/*-baseline.json).
const BASELINE_PATH = path.join(ROOT, 'data-health', 'annual-spikes-baseline.json');
// Wie viele NEUE Faelle in einem Lauf noch als Rauschen durchgehen. Ein einzelner
// Neuzugang kann ein echtes Sonderjahr sein; fuenf auf einmal sind ein Muster.
const MAX_NEU = Number(process.env.ANNUAL_SPIKE_MAX_NEU || 5);

const REIHEN = ['annualOpInc', 'annualRev', 'annualNetIncome'];

// ── Capex-Vorzeichen (Review-Befund 03.08.2026) ──────────────────────────────────────
// Die Burn-Bremse rekonstruiert fehlendes OCF als FCF minus Capex (lamps.js
// operatingCashSeries). Dass daraus nie eine Strafe OHNE sichtbare Lampe wird, ruht auf
// einer DATENannahme: Capex steht negativ im Store (Mittelabfluss, wie annualSBC). Die
// Annahme gilt heute vollstaendig — 0 positive Werte bei 17.357 gemessenen im lokalen
// Baum, 0 von 40.950 im CI-Baum vom 03.08. — war aber ungeprueft, und der
// snake_case-Fallback in _ftsValue (pull-yahoo.js) koennte sie theoretisch verletzen.
// Grundlast 0 heisst: JEDES Auftreten ist ein Ereignis, kein Anteil. Deshalb Schwelle
// "mindestens einer", genau wie beim hartkodierten FX-Kurs in watch-fx-sanity.js.
// MELDEN, nicht reparieren — wie der ganze Waechter.
function positiveCapexJahre(s) {
  const treffer = [];
  norm(s || {}, 'annualCapex').forEach((v, index) => {
    if (Number.isFinite(v) && v > 0) treffer.push({ index, wert: v });
  });
  return treffer;
}

// Ein KAPUTTER Bestand ist nicht dasselbe wie ein FEHLENDER (Review-Befund 19.08.2026).
// Bis hierher lieferten beide Faelle {} — und {} laeuft durch basisGueltig() als "Erstlauf"
// glatt durch. Danach ist der Bestand leer, jeder laengst bekannte Fall gilt als neu, und
// der Waechter meldet "163 neue Ausreisser" statt "die Bestandsdatei ist kaputt": die
// falsche Diagnose schickt den Leser in die Funde statt in die Basis. Bei wenigen Funden
// (<= MAX_NEU) rutscht es sogar still durch. Die Schwester-Waechter watch-exchange-coverage
// und watch-fx-sanity wurden am 09.08. (P1-Welle 3) genau dafuer gehaertet; dieser hier
// wurde damals nicht nachgezogen. Exportiert, damit die Sache pruefbar ist statt geglaubt
// (tests/p1-welle3-waechter-wahrheit.test.js, Cluster A).
function loadBaseline(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`Ausreisser-Bestand nicht lesbar (${e.message}) — Baseline wird NICHT ueberschrieben`);
  }
}

/**
 * Findet Positionen, an denen ein Wert von BEIDEN Nachbarn um mindestens `faktor`
 * abweicht. Rein und ohne I/O — die Regel ist damit ohne Snapshots pruefbar.
 * Nur INNERE Positionen: der erste und letzte Wert haben keinen zweiten Nachbarn,
 * und ein Randwert ohne Gegenprobe waere geraten, nicht gemessen.
 */
function findeAusreisser(reihe, faktor = FAKTOR, minBetrag = MIN_BETRAG) {
  const werte = (Array.isArray(reihe) ? reihe : []).map((x) => (x && typeof x.value === 'number' && Number.isFinite(x.value) ? x.value : null));
  const treffer = [];
  for (let i = 1; i < werte.length - 1; i++) {
    const v = werte[i], l = werte[i - 1], r = werte[i + 1];
    if (v == null || l == null || r == null) continue;
    if (Math.abs(v) < minBetrag) continue;
    const nachbar = Math.max(Math.abs(l), Math.abs(r));
    if (nachbar === 0) continue;
    if (Math.abs(v) / nachbar >= faktor) treffer.push({ index: i, wert: v, links: l, rechts: r });
  }
  return treffer;
}

function stabilerSchluessel(x) {
  const periode = x.periode || `werte:${x.links}|${x.wert}|${x.rechts}`;
  return `${x.ticker}|${x.reihe}|${periode}`;
}
// Zaehlt die heutigen Funde je "ticker|reihe" — der Massstab, an dem unten entschieden
// wird, ob die Legacy-Index-Toleranz ueberhaupt noch tragen kann.
// Funde, die die stabile Signatur exakt trifft, bleiben AUSSEN VOR: sie verlassen
// istBekannt() sofort und brauchen die Toleranz nie. Zaehlten sie mit, kippte der
// Abgleich fuer die uebrigen Funde derselben Reihe und eine REINE Indexverschiebung
// fiele faelschlich als NEU auf (Falsch-Rot, im Review reproduziert).
// `bestand` ist Pflicht — ein vergessenes Argument wirft hier laut, statt still den
// zu grossen Zaehler zu liefern.
function fundeJeReihe(funde, bestand) {
  const zaehler = new Map();
  for (const x of funde) {
    if (bestand.has(stabilerSchluessel(x))) continue;
    const k = `${x.ticker}|${x.reihe}`;
    zaehler.set(k, (zaehler.get(k) || 0) + 1);
  }
  return zaehler;
}

// Wie viele Bestandseintraege dieser Reihe noch im ALTEN Format stehen ("…|<index>",
// dritter Abschnitt eine reine Zahl). Perioden-/Wertsignaturen zaehlen nicht mit — die
// treffen exakt und brauchen keine Toleranz.
function altIndexEintraege(bestand, ticker, reihe) {
  const prefix = `${ticker}|${reihe}|`;
  let n = 0;
  for (const key of bestand) if (key.startsWith(prefix) && /^\d+$/.test(key.slice(prefix.length))) n++;
  return n;
}

function istBekannt(x, bestand, heutigeFundeJeReihe = new Map()) {
  // Die stabile Signatur trifft exakt und gilt immer.
  if (bestand.has(stabilerSchluessel(x))) return true;
  // Altbestand (Indexschluessel) bleibt fuer die laufende und fuer eine um genau
  // ein neues Geschaeftsjahr verschobene Generation lesbar. Neu geschriebene
  // Baselines verwenden ausschliesslich die stabile Perioden-/Wertsignatur.
  //
  // REVIEW-BEFUND 09.08.2026: genau diese +-1-Toleranz verschluckte einen ECHTEN
  // Neuzugang, sobald sein Index zufaellig auf oder neben einem Alt-Eintrag DERSELBEN
  // Reihe lag — der Waechter schwieg ueber den Fall, fuer den er gebaut ist. Der
  // Altbestand enthaelt nur "ticker|reihe|index" und keine Werte, eine Gegenprobe am
  // Inhalt ist also unmoeglich. Was bleibt, ist die ZAHL: solange diese Reihe heute
  // nicht mehr Funde hat als der Bestand Alt-Eintraege, kann jeder Fund von einem
  // Alt-Eintrag stammen und die Toleranz ist plausibel. Kommt einer dazu, kann sie
  // nicht mehr alle decken — dann faellt sie fuer diese Reihe ganz weg und ALLE ihre
  // Funde laufen als NEU auf. Das Falsch-Rot-Risiko puffert MAX_NEU=5.
  const alt = altIndexEintraege(bestand, x.ticker, x.reihe);
  if (alt === 0) return false;
  // Ohne Zaehlung (Direktaufruf mit zwei Argumenten) gilt der Einzelfund als Massstab —
  // definierte Bedeutung: "dies ist der einzige Fund seiner Reihe". RISIKO-RICHTUNG:
  // vergisst ein kuenftiger BULK-Aufrufer den Zaehler, faellt er auf die alte, laxe
  // Toleranz zurueck. Beide Produktions-Aufrufer stehen in main() und uebergeben ihn;
  // Cluster F/F2/F3 nageln beide Lesarten fest.
  const heute = heutigeFundeJeReihe.get(`${x.ticker}|${x.reihe}`) || 1;
  if (heute > alt) return false;
  return bestand.has(`${x.ticker}|${x.reihe}|${x.index}`)
    || (x.index > 0 && bestand.has(`${x.ticker}|${x.reihe}|${x.index - 1}`));
}

// Wie weit die heutige Population vom Aufnahme-Zeitpunkt abweichen darf, bevor der
// Bestand als ungueltig gilt. 20 % ist grob: das Universum waechst taeglich um
// einzelne Namen, aber nicht um ein Drittel.
const POP_TOLERANZ = 0.2;

/**
 * POPULATIONS-WACHE (Fund 29.07.2026) — rein, ohne I/O, damit sie pruefbar ist.
 *
 * Ein Bestand, der auf einer ANDEREN Population aufgenommen wurde, kann nicht sagen,
 * was neu ist. Anlass: der erste Bestand wurde am 29.07. LOKAL auf 4.768 Snapshots
 * aufgenommen, waehrend der CI-Lauf mit 12.482 arbeitet. snapshots/ steht seit Tag 151
 * in der .gitignore — was lokal liegt, ist Schutt alter Laeufe und kein Ausschnitt der
 * Wirklichkeit. Folge im ersten Echtlauf: 75 "neue" Faelle, fast alle blosse
 * Zweitnotierungen laengst bekannter (1INTC.MI und 4335.HK zahlengleich mit INTC).
 * Ohne diese Wache untersucht der naechste Leser die FUNDE statt der BASIS.
 */
function basisGueltig(basis, anzahlSnapshots) {
  if (!basis || !Array.isArray(basis.faelle)) return { ok: true, grund: '' };  // Erstlauf: nichts zu pruefen
  const beiAufnahme = Number(basis.snapshotsBeiAufnahme) || 0;
  if (beiAufnahme <= 0) {
    return {
      ok: false,
      grund: 'Der Ausreisser-Bestand nennt nicht, auf wie vielen Snapshots er aufgenommen wurde '
        + '(Feld snapshotsBeiAufnahme). Damit ist nicht pruefbar, ob er zur heutigen Population passt — '
        + 'einmal IM CI mit --neu-aufnehmen erneuern.',
    };
  }
  const abweichung = Math.abs(anzahlSnapshots - beiAufnahme) / beiAufnahme;
  if (abweichung > POP_TOLERANZ) {
    return {
      ok: false,
      grund: `Der Ausreisser-Bestand ist UNGUELTIG, nicht die Funde: aufgenommen auf ${beiAufnahme} `
        + `Snapshots, dieser Lauf hat ${anzahlSnapshots} (${(abweichung * 100).toFixed(0)} % Abweichung). `
        + 'Ein Bestand aus einer anderen Population kann nicht sagen, was neu ist. Heilung: '
        + '"node scripts/watch-annual-spikes.js --neu-aufnehmen" IM CI laufen lassen (nie lokal — '
        + 'snapshots/ ist gitignored und lokal nur Schutt alter Laeufe).',
    };
  }
  return { ok: true, grund: '' };
}

/**
 * EIN Durchgang, alle Zaehler — mit dem Umfang, den er wirklich hatte (Review-Befund 03.08.2026).
 *
 * Vorher stand hier ein "catch (_) { continue; }": eine unlesbare Datei fiel still aus jeder
 * Zaehlung, und die Ergebniszeile nannte trotzdem die Zahl der GEFUNDENEN Dateien als Umfang.
 * Ein Verzeichnis voll kaputter Snapshots haette also "0 Ausreisser in 12.482 Snapshots"
 * gemeldet — die Entwarnung eines Laufs, der nichts gelesen hat. Der Schwester-Waechter
 * watch-fx-sanity fuehrt ueber DERSELBEN Population (snapshots/) laengst einen
 * parseFehler-Zaehler; hier fehlte das Gegenstueck.
 * Rein bis auf das Lesen des uebergebenen Verzeichnisses — damit ohne den echten Baum pruefbar
 * (tests/annual-spikes.test.js, Temp-Fixture mit einer kaputten Datei).
 */
function scanSnapshots(snapDir) {
  const funde = [];
  const capexPositiv = [];
  let capexWerte = 0, gescannt = 0, parseFehler = 0;
  const dateien = fs.existsSync(snapDir)
    ? fs.readdirSync(snapDir).filter((f) => f.endsWith('.json') && !isMetadataSnapshot(f))
    : [];
  for (const f of dateien) {
    gescannt++;
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(snapDir, f), 'utf8')); } catch (_) { parseFehler++; continue; }
    const annual = s && s.annual;
    if (!annual) continue;
    const ticker = (s.meta && s.meta.ticker) || f.replace(/\.json$/, '');
    for (const name of REIHEN) {
      const enden = periodEnds(s, name);
      for (const t of findeAusreisser(annual[name])) {
        funde.push({ ticker, reihe: name, periode: enden[t.index], ...t });
      }
    }
    capexWerte += norm(s, 'annualCapex').filter(Number.isFinite).length;
    for (const t of positiveCapexJahre(s)) capexPositiv.push({ ticker, ...t });
  }
  return { funde, capexPositiv, capexWerte, gescannt, parseFehler };
}

function main() {
  if (!fs.existsSync(SNAP_DIR)) {
    console.error('::error::watch-annual-spikes: snapshots/ fehlt — Snapshot-Restore kaputt?');
    return 1;
  }
  const scan = scanSnapshots(SNAP_DIR);
  if (scan.gescannt === 0) {
    console.error('::error::watch-annual-spikes: leeres Snapshot-Verzeichnis — nichts geprueft');
    return 1;
  }
  const { funde, capexPositiv, capexWerte } = scan;
  const gelesen = scan.gescannt - scan.parseFehler;
  const schluessel = stabilerSchluessel;
  const basis = loadBaseline(BASELINE_PATH);
  const mio = (v) => (v / 1e6).toFixed(0);

  // LESE-UMFANG ZUERST, aus demselben Grund wie die Capex-Pruefung darunter: er haengt nicht am
  // Ausreisser-Bestand und darf deshalb weder von der Populations-Wache noch vom
  // --neu-aufnehmen-Zweig uebersprungen werden. Schwelle "mindestens einer" wie beim
  // hartkodierten FX-Kurs: watch-fx-sanity zaehlt ueber demselben Verzeichnis und wird ab dem
  // ersten Parse-Fehler rot — die Grundlast ist dort bereits als 0 erzwungen.
  console.log(`Lese-Umfang: ${gelesen} von ${scan.gescannt} Snapshot-Dateien gelesen`
    + (scan.parseFehler ? `, ${scan.parseFehler} nicht lesbar` : ''));
  let datenExit = 0;
  if (scan.parseFehler > 0) {
    datenExit = 1;
    console.error(`::error::${scan.parseFehler} Snapshot-Datei(en) nicht lesbar (JSON-Parse-Fehler) — sie fallen `
      + 'still aus JEDER Zaehlung dieses Waechters heraus (Ausreisser wie Capex-Vorzeichen). Die Zahlen unten '
      + 'gelten nur fuer die gelesenen Dateien, nicht fuer das Universum. Grundlast im Bestand: 0.');
  }

  // Capex-Vorzeichen ZUERST und UNABHAENGIG von allem darunter: die Annahme, auf der die
  // OCF-Rekonstruktion der Burn-Bremse ruht, hat mit dem Ausreisser-Bestand nichts zu tun.
  // Stuende die Pruefung weiter unten, wuerde sie von der Populations-Wache und vom
  // --neu-aufnehmen-Zweig uebersprungen — also genau dann schweigen, wenn ohnehin niemand
  // hinsieht. Der gepruefte UMFANG wird immer mitgenannt: "0 Verstoesse" ohne ihn ist keine
  // Entwarnung, sondern eine unbeantwortete Frage.
  console.log(`Capex-Vorzeichen: ${capexPositiv.length} positive Werte bei ${capexWerte} geprueften (Annahme: Capex <= 0)`);
  for (const x of capexPositiv.slice(0, 20)) console.log(`  POSITIV  ${x.ticker} · annualCapex[${x.index}] = ${mio(x.wert)} Mio`);
  if (capexPositiv.length > 20) console.log(`  … und ${capexPositiv.length - 20} weitere`);
  if (capexPositiv.length > 0) {
    datenExit = 1;
    console.error(`::error::${capexPositiv.length} POSITIVE annualCapex-Werte (Grundlast im Bestand: 0 von 40.950 — jedes Auftreten ist ein Ereignis). `
      + 'Die Burn-Bremse rekonstruiert fehlendes OCF als FCF minus Capex (lamps.js operatingCashSeries) und rechnet dabei mit Capex <= 0. '
      + 'Ist das Vorzeichen gedreht, kann eine Strafe entstehen, die die Lampe nicht anzeigt. Liste oben.');
  }

  // Bewusstes Neuaufnehmen: NUR im CI sinnvoll (siehe Populations-Wache unten).
  if (process.argv.includes('--neu-aufnehmen')) {
    const neuerBestand = {
      hinweis: basis.hinweis || 'Bestand der bekannten Jahres-Ausreisser. Der Waechter meldet nur, was DAZUKOMMT.',
      aufgenommenAm: new Date().toISOString().slice(0, 10),
      snapshotsBeiAufnahme: scan.gescannt,
      anzahl: funde.length,
      faelle: [...new Set(funde.map(schluessel))].sort(),
    };
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(neuerBestand, null, 1) + '\n', 'utf8');
    // BEWUSST exit 0, nicht 1. Erste Fassung liess den Lauf absichtlich rot werden
    // ("die Basis ist sein eigenes Ergebnis, also wurde nichts geprueft"). Das ist
    // methodisch sauber und operativ falsch: der Waechter laeuft VOR dem Commit und
    // VOR dem scoring-Job — ein roter Lauf kostet einen ganzen Tag Score, Vintage und
    // Export, ohne dass irgendjemand etwas dazulernt. Neuaufnehmen passiert nur auf
    // ausdruecklichen Zuruf eines Menschen; der weiss, was er getan hat, und es steht
    // im Bestand (aufgenommenAm, snapshotsBeiAufnahme) und hier im Protokoll.
    console.log(`::warning::Ausreisser-Bestand NEU AUFGENOMMEN: ${neuerBestand.faelle.length} Faelle `
      + `auf ${scan.gescannt} Snapshots. Dieser Lauf ist damit NICHT auf neue Ausreisser geprueft `
      + '(die Basis ist sein eigenes Ergebnis) — der naechste ist es wieder.');
    return datenExit; // Lese-Umfang und Capex-Pruefung oben liefen trotzdem und behalten ihr Urteil
  }

  // POPULATIONS-WACHE (Fund 29.07.): Ein Bestand, der auf einer ANDEREN Population
  // aufgenommen wurde, ist ungueltig — nicht die Funde sind dann verdaechtig, sondern
  // die Basis. Anlass: der erste Bestand wurde am 29.07. lokal auf 4.768 Snapshots
  // aufgenommen, waehrend der CI-Lauf mit 12.482 arbeitet. snapshots/ ist per
  // .gitignore NICHT im Repo (Tag 151) — was lokal liegt, ist Schutt alter Laeufe und
  // kein Ausschnitt der Wirklichkeit. Ergebnis: 75 "neue" Faelle, fast alle nur
  // Zweitnotierungen laengst bekannter (1INTC.MI und 4335.HK zahlengleich mit INTC).
  // Ohne diese Wache haette der naechste Leser die FUNDE untersucht statt der BASIS.
  const gueltig = basisGueltig(basis, scan.gescannt);
  if (!gueltig.ok) {
    console.error('::error::' + gueltig.grund);
    return 1;
  }

  const bestand = new Set(basis.faelle || []);
  const heuteJeReihe = fundeJeReihe(funde, bestand);
  const neu = funde.filter((x) => !istBekannt(x, bestand, heuteJeReihe));

  console.log(`Jahres-Ausreisser: ${funde.length} in ${gelesen} gelesenen Snapshots · davon NEU: ${neu.length} (erlaubt ${MAX_NEU})`);
  // Immer die NEUEN vollstaendig zeigen — sie sind der Grund fuer diesen Lauf.
  for (const x of neu) console.log(`  NEU  ${x.ticker} · ${x.reihe}[${x.index}] = ${mio(x.wert)} Mio, Nachbarn ${mio(x.links)} / ${mio(x.rechts)}`);
  // Vom Bestand nur eine Kostprobe, aber die Zahl bleibt genannt — kein stilles Kappen.
  const bekannt = funde.filter((x) => istBekannt(x, bestand, heuteJeReihe));
  for (const x of bekannt.slice(0, 15)) console.log(`  bek. ${x.ticker} · ${x.reihe}[${x.index}] = ${mio(x.wert)} Mio, Nachbarn ${mio(x.links)} / ${mio(x.rechts)}`);
  if (bekannt.length > 15) console.log(`  … und ${bekannt.length - 15} weitere bekannte`);

  if (neu.length > MAX_NEU) {
    console.error(`::error::${neu.length} NEUE Jahres-Ausreisser (erlaubt ${MAX_NEU}) — einzelne Jahre weichen um Faktor ${FAKTOR}+ von BEIDEN Nachbarn ab. Entweder echte Sonderjahre oder frisch eingefrorene Fehlabrufe; Liste oben.`);
    return 1;
  }
  return datenExit;
}

module.exports = { findeAusreisser, basisGueltig, loadBaseline, positiveCapexJahre, scanSnapshots, stabilerSchluessel, istBekannt, fundeJeReihe, altIndexEintraege, FAKTOR, MIN_BETRAG, POP_TOLERANZ };

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    // Ein abgestuerzter Waechter darf NICHT Erfolg melden (siehe tests/waechter-absturz.test.js).
    console.error('::error::watch-annual-spikes abgestuerzt (hat NICHT geprueft): ' + e.message);
    process.exit(1);
  }
}
