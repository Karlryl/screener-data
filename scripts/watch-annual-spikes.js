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
const { writeFileAtomic } = require('../lib/atomic-write.js');
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
const DEFAULT_MAX_NEU = 5;

function parseMaxNeu(raw) {
  if (raw === undefined || raw === '') return DEFAULT_MAX_NEU;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw new Error('ANNUAL_SPIKE_MAX_NEU muss eine nichtnegative ganze Dezimalzahl sein; '
      + `erhalten: ${JSON.stringify(raw)}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error('ANNUAL_SPIKE_MAX_NEU liegt ausserhalb des sicheren Ganzzahlbereichs; '
      + `erhalten: ${JSON.stringify(raw)}`);
  }
  return value;
}

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
// (<= ANNUAL_SPIKE_MAX_NEU) rutscht es sogar still durch. Die Schwester-Waechter watch-exchange-coverage
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

/**
 * JA-7 (Gerichtsbeschluss 02.09.2026) — der SPERR-Schluessel hoert auf, eine
 * Fliesskomma-Zahl zu sein.
 *
 * stabilerSchluessel() traegt fuer 141 von 141 Funden den `werte:`-Fallback, also eine
 * reine Wert-Signatur. Gemessen: eine FX-Bewegung von 0,024 % (der echte GCP.L-Faktor
 * 1,0002436793) macht aus
 *   BANPU.BK|annualOpInc|werte:-28259000|6003496000|524803000
 *   BANPU.BK|annualOpInc|werte:-28265886.1333387|6004958927.702833|524930883.6276779
 * — die Sperre trifft nicht mehr, und bei der naechsten Verankerung wird der Fall in
 * `faelle` absorbiert: dauerhaft "bekannt" und FUER IMMER still. Das ist der leise,
 * echte Verlust, gegen den dieses Tor gebaut ist.
 *
 * Gewaehlt wurde die billigere der beiden vom Gericht zugelassenen Varianten:
 * `ticker|reihe|index` statt eines FX-invarianten Perioden-Schluessels. Grund, gemessen:
 * ein Perioden-Schluessel ist auf diesem Weg strukturell unerreichbar — periodEnds()
 * liefert fuer 100 % der Jahresfunde null, und selbst der Container-Fix (JA-10) heilte
 * nur 5 von 141 Funden, waehrend annualNetIncome NIRGENDS eine Enden-Reihe hat. Genau
 * die Drift-Klasse (GCP.L, HMT-Zwillinge) ist annualNetIncome.
 *
 * PREIS, ausdruecklich benannt: kommt ein Geschaeftsjahr dazu, verschiebt sich der Index
 * und die Sperre trifft nicht mehr. Aber sie faellt dann LAUT aus — der Fall laeuft als
 * NEU auf und sperrenOhneTreffer() meldet die tote Sperre im Tageslauf (JA-6) — statt
 * still zu verschwinden. Die Fehlerrichtung ist damit umgedreht, und das war der Zweck.
 */
function sperrSchluessel(x) { return `${x.ticker}|${x.reihe}|${x.index}`; }
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
  // Funde laufen als NEU auf. Das Falsch-Rot-Risiko puffert DEFAULT_MAX_NEU=5.
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
  // Review-Befund MITTEL (29.08.): steht ein Schluessel in ausgeschlossen UND in faelle
  // (Hand-Edit, Merge-Artefakt), gewinnt faelle in istBekannt() still — der Fall gilt
  // als bekannt, obwohl die Sperre "bleibt rot-faehig" verspricht. baueNeuenBestand()
  // kann den Zustand nicht erzeugen; diese Wache faengt den Weg daran vorbei.
  if (Array.isArray(basis.ausgeschlossen)) {
    const faelle = new Set(basis.faelle);
    const doppelt = basis.ausgeschlossen
      .filter((a) => a && typeof a.schluessel === 'string' && faelle.has(a.schluessel))
      .map((a) => a.schluessel);
    if (doppelt.length) {
      return {
        ok: false,
        grund: `Der Ausreisser-Bestand widerspricht sich: ${doppelt.length} Schluessel stehen in `
          + `ausgeschlossen UND in faelle (${doppelt.join(' · ')}). faelle wuerde still gewinnen und `
          + 'die Sperre aushebeln — Bestand von Hand bereinigen (Schluessel gehoert auf GENAU eine Seite).',
      };
    }
  }
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
        + '"node scripts/watch-annual-spikes.js --neu-aufnehmen" gegen eine CI-POPULATION laufen '
        + 'lassen — im CI oder lokal gegen ein heruntergeladenes CI-Artefakt '
        + '("gh run download <RUN_ID> -n snapshots -D snapshots"); NIEMALS gegen das lokale '
        + 'snapshots/ (gitignored, nur Schutt alter Laeufe). Danach PFLICHT: derselbe Befehl OHNE '
        + 'Flag gegen dieselbe Population — der Verankerungslauf prueft sich selbst nicht.',
    };
  }
  return { ok: true, grund: '' };
}

// Wie lange ein Ausschluss offen stehen darf, bevor der Waechter ihn selbst anmahnt.
// 30 Tage, und die Zahl ist die einzige, die dieses Tor ueberhaupt hat: seit JA-1 kosten
// Sperren keinen Budgetplatz mehr, also ist diese Uhr der GESAMTE verbliebene Druck auf
// einen offenen Fall. Ein Tor, das jeden Tag gleich feuert, traegt keine Information —
// dieses feuert genau dann, wenn 30 Tage lang nichts geschehen ist.
const AUSSCHLUSS_MAX_TAGE = 30;
const istTag = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const tageSeit = (tag, jetzt) => Math.floor((jetzt.getTime() - Date.parse(tag + 'T00:00:00Z')) / 86400000);

/**
 * EINE Stelle, an der die Ausschluss-Liste geprueft wird — und zwar auf BEIDEN Wegen.
 * Vorher sah nur baueNeuenBestand() sie an; im Tageslauf konnte eine kaputte Liste still
 * zu "keine Sperren" werden. Seit JA-1 haengt an ihr nicht mehr ein Budgetplatz, sondern
 * die Sperre selbst — eine still kaputte Liste ist jetzt teurer als vorher.
 *
 * JA-5: `seit` UND `offenSeit` sind Wurf-Bedingungen wie `hinweis`. Gemessen (Stimme 2,
 * V7): ein Eintrag OHNE `seit` wurde bis heute klaglos angenommen. `offenSeit` ist der
 * Tag, an dem der FALL offen wurde, nicht der Tag der Eintragung — alle vier Eintraege
 * trugen `seit: 2026-08-29`, obwohl BANPU seit dem Entscheid vom 19.08. offen ist. Eine
 * Altersuhr auf `seit` startete bei jeder Neu-Listung still neu.
 * JA-7: `sperrschluessel` (ticker|reihe|index) ist Pflicht und ist das, WORAUF gematcht
 * wird. `schluessel` (die Wert-Signatur) bleibt als Herkunfts-Nachweis und fuer die
 * Widerspruchs-Wache in basisGueltig() erhalten.
 */
function pruefeAusschluesse(basis) {
  // Review-Befund HIGH (29.08.): "Feld fehlt" (Alt-Bestand vor Weg C) und "Feld da, aber
  // falscher Typ" (kaputter Merge, versehentliches null) sind zwei verschiedene Faelle.
  // Nur der erste darf still zu [] werden — der zweite hoebe ALLE Sperren lautlos auf.
  const roh = basis ? basis.ausgeschlossen : undefined;
  if (roh !== undefined && !Array.isArray(roh)) {
    throw new Error(`Ausschluss-Liste kaputt: ausgeschlossen ist ${JSON.stringify(roh)} statt einer Liste — `
      + 'eine still zu [] degradierte Sperrliste hoebe alle Sperren lautlos auf.');
  }
  const ausgeschlossen = roh || [];
  for (const a of ausgeschlossen) {
    if (!a || typeof a.schluessel !== 'string' || !a.schluessel
      || typeof a.sperrschluessel !== 'string' || !/^[^|]+\|[^|]+\|\d+$/.test(a.sperrschluessel)
      || typeof a.hinweis !== 'string' || !a.hinweis.trim()
      || !istTag(a.seit) || !istTag(a.offenSeit)) {
      throw new Error('Ausschluss-Liste kaputt: jeder Eintrag braucht schluessel, sperrschluessel '
        + '(ticker|reihe|index), seit UND offenSeit (beide YYYY-MM-DD) UND schriftlichen hinweis — '
        + `gefunden: ${JSON.stringify(a)}. Eine unbegruendete oder undatierte Sperre wird nicht geschrieben.`);
    }
  }
  return ausgeschlossen;
}

/**
 * WEG C (Gerichts-/Rat-Strecke Ausreisser-Bestand, 29.08.2026) — die Ausschluss-Liste.
 *
 * `--neu-aufnehmen` schreibt die Fallliste aus ALLEN heutigen Funden neu. Genau daran
 * starb der Fix am 28.08.: BANPU.BK (bewusst offen gelassener, NICHT ENTSCHEIDBARER
 * Fall vom 19.08.) waere still in den Bestand gerutscht und haette nie wieder gefeuert.
 * Der Entscheid vom 19.08. lebte bis heute nur als Prosa im `hinweis`-Feld — ab jetzt
 * traegt der Bestand ihn maschinenlesbar: `ausgeschlossen` ist eine Liste von
 * Faellen, die eine Neuaufnahme NIE absorbieren darf. Sie bleiben dadurch dauerhaft
 * "NEU" und damit rot-faehig, bis ein Mensch sie einzeln klaert und AKTIV von der
 * Liste nimmt. Ein Ausschluss ohne schriftliche Begruendung ist verboten (throw) —
 * eine unbegruendete Sperre waere derselbe stille Verlust in Gruen.
 *
 * Rein und ohne I/O, damit der Waechter (tests/annual-spikes.test.js) beide
 * Richtungen fixieren kann: Ausschluss haelt UND Nicht-Ausgeschlossenes wird
 * aufgenommen UND die Liste selbst ueberlebt die Neuaufnahme.
 */
function baueNeuenBestand(basis, funde, snapshotsBeiAufnahme, jetzt = new Date()) {
  // Review-Befund HIGH (29.08.): "Feld fehlt" (Alt-Bestand vor Weg C) und "Feld da,
  // aber falscher Typ" (kaputter Merge, versehentliches null) sind zwei verschiedene
  // Faelle. Nur der erste darf still zu [] werden — der zweite wuerde sonst ALLE
  // Sperren lautlos aufheben: genau die Fehlerklasse, die Weg C schliesst.
  const ausgeschlossen = pruefeAusschluesse(basis);
  const gesperrt = new Set(ausgeschlossen.map((a) => a.sperrschluessel));
  // JA-7 (Gericht 02.09.2026): gefiltert wird ueber den FX-festen Sperr-Schluessel, NICHT
  // ueber die Wert-Signatur. Genau diese Zeile war der gemessene Verlust-Weg: eine
  // FX-Bewegung von 0,024 % verschiebt die Signatur, die Sperre trifft nicht mehr, und
  // der Fall wird hier in `faelle` absorbiert — dauerhaft bekannt und fuer immer still.
  const faelle = [...new Set(funde.filter((x) => !gesperrt.has(sperrSchluessel(x))).map(stabilerSchluessel))].sort();
  return {
    hinweis: (basis && basis.hinweis)
      || 'Bestand der bekannten Jahres-Ausreisser. Der Waechter meldet nur, was DAZUKOMMT.',
    aufgenommenAm: jetzt.toISOString().slice(0, 10),
    snapshotsBeiAufnahme,
    anzahl: faelle.length,
    // Die Liste wird UNVERAENDERT fortgeschrieben — eine Neuaufnahme, die sie
    // verschluckt, waere exakt der Fehler, den sie verhindern soll.
    ausgeschlossen,
    faelle,
  };
}

/**
 * Review-Befund MITTEL (29.08.): eine Sperre, deren Schluessel heute NICHTS mehr trifft
 * (Wert-Revision verschiebt die werte:-Signatur, Tippfehler beim Eintragen), sieht in
 * der JSON intakt aus und unterdrueckt trotzdem nichts mehr. Sichtbar machen statt
 * schweigen: 0 Treffer heisst entweder "Fall hat sich aufgeloest -> Sperre AKTIV
 * entfernen" oder "Schluessel kaputt -> reparieren". Rein, fuer den Waechter.
 */
function sperrenOhneTreffer(ausgeschlossen, funde) {
  const heutig = new Set(funde.map(sperrSchluessel));
  return (ausgeschlossen || []).filter((a) => a && !heutig.has(a.sperrschluessel)).map((a) => a.sperrschluessel);
}

/**
 * Die zweite Art toter Sperre, die JA-7 ueberhaupt erst sichtbar macht: der Schluessel
 * TRIFFT einen heutigen Fund, aber derselbe Fund steht laengst in `faelle` — dann gewinnt
 * istBekannt() still und die Sperre unterdrueckt nichts mehr, obwohl sie intakt aussieht.
 * basisGueltig() faengt nur den Fall, in dem BEIDE Seiten dieselbe Wert-Signatur tragen;
 * seit die Sperre auf `ticker|reihe|index` matcht, gibt es den Weg daran vorbei.
 */
function sperrenOhneWirkung(ausgeschlossen, funde, bestand) {
  const gesperrt = new Set((ausgeschlossen || []).map((a) => a && a.sperrschluessel));
  return [...new Set(funde
    .filter((x) => gesperrt.has(sperrSchluessel(x)) && bestand.has(stabilerSchluessel(x)))
    .map(sperrSchluessel))];
}

// == EREIGNIS-ZAEHLUNG (Gerichtsbeschluss 02.09.2026, Option 1) =======================
// Gezaehlt wird ab hier in EREIGNISSEN, nicht in Funden. Zwei Relationen, beide am
// echten Bestand nachgemessen:
//
//   R1 — byte-gleiche Wert-Signatur ueber verschiedene Ticker ist EIN Ereignis
//        (dieselbe Firma, mehrfach gelistet). Belegt: SESG.PA und SGBAF tragen denselben
//        FX-Stempel 1,1527377 und exakt dieselben drei Werte. Die GEGENPROBE, die nicht
//        verschmelzen darf, ist ebenso gemessen: VIV.PA gegen VIV.VI — dieselbe Firma,
//        beide EUR, aber die FX-Stempel stehen im Verhaeltnis 0,9907503642039275, also
//        zwei verschiedene Signaturen und zwei Ereignisse. Gemessene Fehlquote dieser
//        Relation: ~27 % (52 byte-gleiche Paare gegen 19 FX-proportionale, aber
//        ungleiche). Sie verschmilzt bewusst zu WENIG statt zu viel: eine Quantisierung,
//        die den Rest einfinge, verschmoelze auch zwei echte, verschiedene Ausreisser.
//
//   R2 — derselbe Ticker am selben INDEX ist EIN Ereignis.
//        JA-3 verlangt, dass das hier ausdruecklich steht: "selbes Geschaeftsjahr" ist
//        aus den Daten NICHT lesbar — periodEnds() liefert fuer 100 % der Jahresfunde
//        null (Container-Fehlgriff, siehe JA-10; annualNetIncome hat nirgends eine
//        Enden-Reihe). Einziger verfuegbarer Proxy ist x.index. Die Praemisse dahinter —
//        die Jahresreihen eines Tickers sind gleich lang, sonst zeigt derselbe Index auf
//        verschiedene Geschaeftsjahre — wird nicht geglaubt, sondern in scanSnapshots()
//        gemessen und hier durchgesetzt: bei ungleich langen Reihen verschmilzt R2 NICHT.
//        Grundlast der Verletzung: 0 von 15.028 Snapshots => JEDES Auftreten ist ein
//        Ereignis, dieselbe Praezedenz wie beim Capex-Vorzeichen weiter oben.
//
// Beide Relationen zusammen bilden die TRANSITIVE Huelle (Union-Find): laeuft eine Kette
// ueber R1 und R2, ist sie EIN Ereignis. Getrennt gezaehlt waere sie zwei.
// ponytail: Union-Find ohne Rang-Heuristik — bei ~150 Funden je Lauf reicht das.
const r1Schluessel = (x) => `${x.reihe}|${x.links}|${x.wert}|${x.rechts}`;
const r2Schluessel = (x) => `${x.ticker}|${x.index}`;

function ereignisse(funde, reihenGleichLang = () => true) {
  const eltern = funde.map((_, i) => i);
  const wurzel = (i) => { while (eltern[i] !== i) { eltern[i] = eltern[eltern[i]]; i = eltern[i]; } return i; };
  const vereinen = (a, b) => {
    const ra = wurzel(a), rb = wurzel(b);
    if (ra !== rb) eltern[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const ersteR1 = new Map(), ersteR2 = new Map();
  funde.forEach((x, i) => {
    const k1 = r1Schluessel(x);
    if (ersteR1.has(k1)) vereinen(ersteR1.get(k1), i); else ersteR1.set(k1, i);
    if (!reihenGleichLang(x.ticker)) return;  // JA-3: Praemisse verletzt => R2 gilt hier nicht
    const k2 = r2Schluessel(x);
    if (ersteR2.has(k2)) vereinen(ersteR2.get(k2), i); else ersteR2.set(k2, i);
  });
  const gruppen = new Map();
  funde.forEach((x, i) => {
    const w = wurzel(i);
    if (!gruppen.has(w)) gruppen.set(w, []);
    gruppen.get(w).push(x);
  });
  return [...gruppen.values()];
}

// Die Faecherung eines Ereignisses: ueber wie viele Ticker es sich spannt.
const faecher = (ereignis) => new Set(ereignis.map((x) => x.ticker)).size;

/**
 * JA-2 — HART-TOR auf die Cigna-Form: ein Ticker, dessen ALLE Jahresreihen am selben
 * Index feuern. Grund, gemessen: R2 entschaerft genau die Fehlerklasse, fuer die dieser
 * Waechter ueberhaupt gebaut wurde. Eine Firma mit einem vollstaendig korrumpierten
 * Geschaeftsjahr faellt heute als 3 Funde auf, nach R2 als 1 Ereignis mit Faecher 1;
 * zwei solche Brueche waren heute 6 Funde = ROT und waeren nachher 2 Ereignisse = GRUEN.
 * Das Faecher-Tor zaehlt Ticker und sieht 1, das Alters-Tor betrifft nur Ausschluesse —
 * beide sind blind dafuer. Deshalb ist diese Form IMMER rot, unabhaengig vom Budget und
 * unabhaengig von der Ereigniszaehlung.
 * Grundlast im echten Bestand: 2, beide bereits verankert und damit nicht in `neu` —
 * das Tor kostet heute nichts. Steigt sie (Kipp-Bedingung K4), braucht es eine
 * differenzierte Form; das ist eine Gerichtsfrage, keine Lockerung an dieser Stelle.
 */
function cignaFaelle(funde) {
  const reihenJeJahr = new Map();
  for (const x of funde) {
    const k = `${x.ticker}|${x.index}`;
    if (!reihenJeJahr.has(k)) reihenJeJahr.set(k, new Set());
    reihenJeJahr.get(k).add(x.reihe);
  }
  return [...reihenJeJahr.entries()].filter(([, r]) => r.size === REIHEN.length).map(([k]) => k);
}

/**
 * JA-4 — das Faecher-Tor misst WACHSTUM, nicht Breite.
 * Die Wortfassung der Vorlage ("ein Ereignis mit > 5 Tickern ist immer rot") feuert auf
 * einen LEGITIMEN Fall: eine einzige echte Intel-Abschreibung steht im Bestand als
 * 7er-Faecher (1INTC.MI · 4335.HK · INL.DE · INTC · INTC.SW · INTC.VI · INTL.WA).
 * Unabhaengig nachgemessen: breitester Faecher im Bestand = 7, und es ist der einzige
 * ueber 5. Gebraucht wird das Tor auch gar nicht gegen Skalierungsfehler — die
 * kollabieren nie (acht Ticker mit je eigener falscher Zahl sind acht Ereignisse) —
 * sondern gegen den KONSTANTEN Sentinel-Wert, der ueber viele Ticker identisch
 * gestempelt wird. Der zeigt sich als Faecher breiter als alles Bekannte.
 * ponytail: nur der erste Arm der Auflage. Der zweite ("gewachsen seit dem letzten
 * Lauf") braucht mitgefuehrten Zustand zwischen zwei Laeufen, und dieser Job darf nichts
 * schreiben (kein Commit-Schritt, ENTSCHIED 12:40 vom 29.08.). Der committete Bestand
 * IST die vorhandene Referenz. Aufruestpfad, falls je gebraucht: Faecherbreite je
 * Signatur in den Bestand schreiben und gegen die Vorlauf-Zahl vergleichen.
 */
function breitesterFaecherImBestand(faelle) {
  const jeSignatur = new Map();
  for (const k of faelle || []) {
    const i = k.indexOf('|');
    if (i < 0) continue;
    const ticker = k.slice(0, i), signatur = k.slice(i + 1);
    // Alt-Eintraege im Index-Format ("reihe|<zahl>") tragen KEINE Wert-Signatur; ueber
    // sie zu gruppieren verschmoelze fremde Ticker am selben Index zu einem Faecher.
    if (/^[^|]+\|\d+$/.test(signatur)) continue;
    if (!jeSignatur.has(signatur)) jeSignatur.set(signatur, new Set());
    jeSignatur.get(signatur).add(ticker);
  }
  let breitester = 0;
  for (const t of jeSignatur.values()) if (t.size > breitester) breitester = t.size;
  return breitester;
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
  // JA-3: die Ticker, bei denen die vorhandenen Jahresreihen NICHT gleich lang sind.
  // Bei ihnen zeigt derselbe Index nicht auf dasselbe Geschaeftsjahr, also darf
  // Relation 2 dort nicht verschmelzen. Gemessen statt geglaubt — die Praemisse war
  // heute in 15.028 von 15.028 Snapshots sauber, Grundlast der Verletzung also 0.
  const reihenUngleich = new Set();
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
    // Eine FEHLENDE Reihe ist keine Praemissenverletzung — nur zwei VORHANDENE Reihen
    // verschiedener Laenge sind eine.
    const laengen = new Set(REIHEN
      .map((n) => (Array.isArray(annual[n]) ? annual[n].length : 0))
      .filter((l) => l > 0));
    if (laengen.size > 1) reihenUngleich.add(ticker);
    for (const name of REIHEN) {
      const enden = periodEnds(s, name);
      for (const t of findeAusreisser(annual[name])) {
        funde.push({ ticker, reihe: name, periode: enden[t.index], ...t });
      }
    }
    capexWerte += norm(s, 'annualCapex').filter(Number.isFinite).length;
    for (const t of positiveCapexJahre(s)) capexPositiv.push({ ticker, ...t });
  }
  return { funde, capexPositiv, capexWerte, gescannt, parseFehler, reihenUngleich };
}

function main() {
  const maxNeu = parseMaxNeu(process.env.ANNUAL_SPIKE_MAX_NEU);
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

  // Bewusstes Neuaufnehmen: NUR gegen eine CI-POPULATION sinnvoll (siehe Populations-Wache
  // unten) — im CI oder lokal gegen ein heruntergeladenes CI-Artefakt, niemals gegen das
  // lokale snapshots/. Entschiedener Weg seit 30.08.2026 (ENTSCHIED 113 / RA6): Einmal-Akt
  // LOKAL gegen das Artefakt, Commit durch den Ausfuehrenden — der CI-Job hat bewusst
  // keinen Commit-Schritt (ENTSCHIED 12:40 vom 29.08.).
  // ⚠ DIESER ZWEIG PRUEFT NICHTS: das `return datenExit` unten kehrt VOR der
  // Populations-Wache und VOR beiden Ausreisser-Toren zurueck. Deshalb ist ein
  // flagfreier Kontrolllauf gegen dieselbe Population PFLICHT (RA8), bevor der
  // Verankerungs-Commit gilt.
  if (process.argv.includes('--neu-aufnehmen')) {
    const neuerBestand = baueNeuenBestand(basis, funde, scan.gescannt);
    // T204: atomar. Diese Datei IST die Sperrliste - ein abgerissener Schreibvorgang
    // hinterliesse eine halbe oder leere Liste, und eine leere Sperrliste hebt jede
    // Sperre lautlos auf. Genau davor schuetzt weiter oben schon baueNeuenBestand();
    // hier wird der zweite Weg dorthin geschlossen.
    writeFileAtomic(BASELINE_PATH, JSON.stringify(neuerBestand, null, 1) + '\n', 'utf8');
    if (neuerBestand.ausgeschlossen.length) {
      console.log(`::warning::${neuerBestand.ausgeschlossen.length} Fall/Faelle stehen auf der Ausschluss-Liste `
        + 'und wurden NICHT in den Bestand aufgenommen — sie bleiben rot-faehig, bis sie einzeln geklaert sind: '
        + neuerBestand.ausgeschlossen.map((a) => a.schluessel).join(' · '));
      const leer = sperrenOhneTreffer(neuerBestand.ausgeschlossen, funde);
      if (leer.length) {
        console.log(`::warning::${leer.length} Sperre(n) treffen HEUTE keinen Fund mehr — entweder hat sich der `
          + 'Fall aufgeloest (Sperre AKTIV entfernen) oder der Schluessel ist kaputt (reparieren): '
          + leer.join(' · '));
      }
    }
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

  // ── JA-1 (Gerichtsbeschluss 02.09.2026): AUSSCHLUESSE VERLASSEN DAS GEZAEHLTE SET,
  // NIEMALS DAS GEDRUCKTE. Die naechsten beiden Zeilen sind unveraendert und muessen es
  // bleiben. Wird der Sperr-Filter VOR diesen Block gezogen, verschwinden die gesperrten
  // Faelle aus dem Log — und das WAERE die Erosion, gegen die dieser Beschluss ergangen
  // ist ("ihr nehmt den einzigen Druck weg, den ihr habt"). Der Filter steht deshalb
  // ausschliesslich unten am Tor, auf `gezaehlt`. Bruchprobe BP-7 zieht ihn absichtlich
  // hierher und muss dabei rot werden.
  console.log(`Jahres-Ausreisser: ${funde.length} in ${gelesen} gelesenen Snapshots · davon NEU: ${neu.length}`);
  // Immer die NEUEN vollstaendig zeigen — sie sind der Grund fuer diesen Lauf.
  for (const x of neu) console.log(`  NEU  ${x.ticker} · ${x.reihe}[${x.index}] = ${mio(x.wert)} Mio, Nachbarn ${mio(x.links)} / ${mio(x.rechts)}`);
  // Vom Bestand nur eine Kostprobe, aber die Zahl bleibt genannt — kein stilles Kappen.
  const bekannt = funde.filter((x) => istBekannt(x, bestand, heuteJeReihe));
  for (const x of bekannt.slice(0, 15)) console.log(`  bek. ${x.ticker} · ${x.reihe}[${x.index}] = ${mio(x.wert)} Mio, Nachbarn ${mio(x.links)} / ${mio(x.rechts)}`);
  if (bekannt.length > 15) console.log(`  … und ${bekannt.length - 15} weitere bekannte`);

  // ── Die Ausschluss-Liste: Zustand, Alter und WIRKUNG, in jedem Lauf sichtbar ──
  const ausgeschlossen = pruefeAusschluesse(basis);
  const gesperrt = new Set(ausgeschlossen.map((a) => a.sperrschluessel));
  const jetzt = new Date();
  console.log(`Ausschluss-Liste: ${ausgeschlossen.length} Sperre(n), Alters-Tor bei ${AUSSCHLUSS_MAX_TAGE} Tagen`);
  const ueberfaellig = [];
  for (const a of ausgeschlossen) {
    const tage = tageSeit(a.offenSeit, jetzt);
    console.log(`  SPERRE ${a.sperrschluessel} · offen seit ${tage} Tag(en) (offenSeit ${a.offenSeit})`);
    if (tage > AUSSCHLUSS_MAX_TAGE) ueberfaellig.push(`${a.sperrschluessel} (${tage} Tage)`);
  }
  // JA-5: die Altersuhr laeuft ausschliesslich auf offenSeit.
  if (ueberfaellig.length) {
    datenExit = 1;
    console.error(`::error::${ueberfaellig.length} Ausschluss/Ausschluesse laenger als ${AUSSCHLUSS_MAX_TAGE} Tage `
      + `offen: ${ueberfaellig.join(' · ')}. Seit der Ausschluss-Trennung kosten Sperren keinen Budgetplatz `
      + 'mehr — diese Uhr IST der verbliebene Druck. Entweder den Fall klaeren und die Sperre AKTIV entfernen, '
      + 'oder den Entscheid erneuern (offenSeit hochsetzen ist eine begruendete Handlung, kein Automatismus).');
  }
  // JA-6: der Tote-Sperre-Melder lief bisher NUR im --neu-aufnehmen-Zweig, hinter dessen
  // `return`. Zwischen zwei Verankerungen war eine tote Sperre damit unsichtbar — genau
  // der Zustand, den eine Schluessel-Drift erzeugt.
  // BEWUSST ::warning:: und nicht ::error::, und der Unterschied zur Zeile darunter ist
  // die SICHTBARKEIT: eine Sperre ohne Treffer unterdrueckt nichts, also laeuft ihr Fall
  // — wenn es ihn noch gibt — in derselben Ausgabe als NEU auf und wird ohnehin gezaehlt.
  // Ein zweites Rot dafuer waere Doppelzaehlung. Bleibt sie unbearbeitet, macht das
  // Alters-Tor sie nach AUSSCHLUSS_MAX_TAGE Tagen sowieso rot. Die Sperre EINE Zeile
  // tiefer ist der andere Fall: die trifft, wirkt aber nicht — und die geht still, also rot.
  const tot = sperrenOhneTreffer(ausgeschlossen, funde);
  if (tot.length) {
    console.log(`::warning::${tot.length} Sperre(n) treffen HEUTE keinen Fund mehr — entweder hat sich der `
      + 'Fall aufgeloest (Sperre AKTIV entfernen) oder der Schluessel ist kaputt (reparieren): ' + tot.join(' · '));
  }
  const wirkungslos = sperrenOhneWirkung(ausgeschlossen, funde, bestand);
  if (wirkungslos.length) {
    datenExit = 1;
    console.error(`::error::${wirkungslos.length} Sperre(n) treffen einen Fund, der bereits im Bestand steht — `
      + `istBekannt() gewinnt still und die Sperre unterdrueckt nichts mehr: ${wirkungslos.join(' · ')}. `
      + 'Der Schluessel gehoert auf GENAU eine Seite.');
  }

  // ── JA-11: die Ereigniszahl in ALLEN VIER Zaehlvarianten, in JEDEM Lauf ──
  // Damit werden die Kipp-Bedingungen K1/K2 aus dem Log ABGELESEN statt neu verhandelt.
  const gleichLang = (t) => !scan.reihenUngleich.has(t);
  const neuOhneSperren = neu.filter((x) => !gesperrt.has(sperrSchluessel(x)));
  const ereignisseNeu = ereignisse(neu, gleichLang);
  const gezaehlt = ereignisse(neuOhneSperren, gleichLang).length;
  console.log(`Zaehlwerk: roh ${neu.length} · naiver Set-Key ${new Set(neu.map(r1Schluessel)).size}`
    + ` · zwei Relationen ${ereignisseNeu.length} · zwei Relationen ohne Sperren ${gezaehlt} (erlaubt ${maxNeu})`);
  if (scan.reihenUngleich.size) {
    console.log(`::warning::${scan.reihenUngleich.size} Ticker mit ungleich langen Jahresreihen — dort zeigt `
      + 'derselbe Index NICHT auf dasselbe Geschaeftsjahr, Relation 2 verschmilzt bei ihnen nicht (JA-3). '
      + 'Grundlast dieser Verletzung war 0 von 15.028: ' + [...scan.reihenUngleich].slice(0, 10).join(' · '));
  }

  // ── JA-4a: die Faecherung JE EREIGNIS, unbedingt — nicht nur beim Ausloesen ──
  // Untergrenze 1: ein "Faecher" ueber einen einzigen Ticker ist keiner. Ohne sie feuerte
  // das Tor auf einem leeren Bestand (Erstlauf) auf jeden Einzelfund.
  const bekannterFaecher = Math.max(breitesterFaecherImBestand(basis.faelle), 1);
  console.log(`Faecherung je Ereignis (breitester Faecher im Bestand: ${bekannterFaecher}):`);
  const zuBreit = [];
  for (const e of ereignisseNeu) {
    const ticker = [...new Set(e.map((x) => x.ticker))];
    console.log(`  Ereignis · ${e.length} Fund(e), ${ticker.length} Ticker · ${e[0].reihe}[${e[0].index}] · ${ticker.join(', ')}`);
    if (ticker.length > bekannterFaecher) zuBreit.push(`${e[0].reihe}[${e[0].index}] mit ${ticker.length} Tickern`);
  }
  // JA-4b: das Tor misst WACHSTUM gegen den breitesten bekannten Faecher, nicht Breite.
  if (zuBreit.length) {
    datenExit = 1;
    console.error(`::error::${zuBreit.length} Ereignis(se) spannen einen breiteren Faecher als alles im Bestand `
      + `(${bekannterFaecher}): ${zuBreit.join(' · ')}. Ein Skalierungsfehler ueber eine ganze Boerse kollabiert `
      + 'NIE zu einem Ereignis (acht eigene falsche Zahlen sind acht Ereignisse) — ein Faecher, der ueber das '
      + 'Bekannte hinauswaechst, ist der Fingerabdruck eines KONSTANTEN Sentinel-Werts, der ueber viele Ticker '
      + 'identisch gestempelt wurde. Waechst hier ein LEGITIMER Faecher (Kipp-Bedingung K3): Schwelle ueber den '
      + 'Bestand nachziehen, nicht das Tor abschalten.');
  }

  // ── JA-2: Hart-Tor auf die Cigna-Form, unabhaengig von Budget UND Ereigniszaehlung ──
  const cigna = cignaFaelle(neu);
  if (cigna.length) {
    datenExit = 1;
    console.error(`::error::${cigna.length} Ticker mit ALLEN ${REIHEN.length} Jahresreihen am selben Index: `
      + `${cigna.join(' · ')}. Das ist die Gruendungs-Fehlerklasse dieses Waechters (Cigna 2022), und sie ist `
      + 'IMMER rot: die Ereigniszaehlung zoege sie zu EINEM Ereignis mit Faecher 1 zusammen, wo drei Funde '
      + 'stehen — Faecher-Tor und Alters-Tor sind beide blind dafuer. Grundlast im Bestand: 2, beide verankert.');
  }

  // ── Das Rausch-Budget, ab jetzt in Ereignissen und ohne die Sperren (JA-1) ──
  if (gezaehlt > maxNeu) {
    datenExit = 1;
    console.error(`::error::${gezaehlt} NEUE Jahres-Ausreisser-EREIGNISSE (erlaubt ${maxNeu}) — einzelne Jahre `
      + `weichen um Faktor ${FAKTOR}+ von BEIDEN Nachbarn ab. Entweder echte Sonderjahre oder frisch `
      + `eingefrorene Fehlabrufe; Liste oben. Gezaehlt wird in EREIGNISSEN (zwei Relationen) und ohne die `
      + `${ausgeschlossen.length} Sperre(n) — gedruckt werden unveraendert alle ${neu.length} Funde.`);
  }
  return datenExit;
}

module.exports = { findeAusreisser, basisGueltig, loadBaseline, positiveCapexJahre, scanSnapshots, stabilerSchluessel, istBekannt, fundeJeReihe, altIndexEintraege, baueNeuenBestand, sperrenOhneTreffer, parseMaxNeu, main, FAKTOR, MIN_BETRAG, POP_TOLERANZ,
  // Gerichtsbeschluss 02.09.2026 (JA-1..JA-7): exportiert, damit die Bruchproben die
  // SACHE pinnen koennen und nicht ein Textmuster im Log.
  sperrSchluessel, pruefeAusschluesse, sperrenOhneWirkung, ereignisse, faecher, cignaFaelle,
  breitesterFaecherImBestand, r1Schluessel, r2Schluessel, tageSeit, AUSSCHLUSS_MAX_TAGE };

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    // Ein abgestuerzter Waechter darf NICHT Erfolg melden (siehe tests/waechter-absturz.test.js).
    console.error('::error::watch-annual-spikes abgestuerzt (hat NICHT geprueft): ' + e.message);
    process.exit(1);
  }
}
