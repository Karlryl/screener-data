'use strict';
/**
 * lib/druckenmiller/ledger.js — append-only JSONL-Reihe der Marktinnereien.
 *
 * WOZU: das Druckenmiller-Modul ist eine Messreihe, die erst in Jahren lesbar wird
 * (Rat-Verdikt D2, 2026-09-14). Eine Reihe, die nachtraeglich editierbar ist, belegt
 * nichts — jeder spaetere Befund waere von einer stillen Korrektur nicht zu unterscheiden.
 * Darum: eine Zeile pro Publikationstag, ANGEHAENGT, nie ueberschrieben, und jede Zeile
 * kettet per prevHash an den TEXT der vorigen.
 *
 * WARUM DER TEXT UND NICHT DAS OBJEKT: der Kettenwert ist sha256 der vorigen ZEILE, wie
 * sie auf der Platte steht. Damit braucht es keine kanonische Serialisierung (zweite
 * Fehlerquelle, die genau dann auffaellt, wenn man sie nicht mehr reparieren kann), und
 * eine Aenderung an IRGENDEINER historischen Zeile macht die FOLGEZEILE ungueltig — die
 * Pruefung laeuft ueber die ganze Datei, nicht nur ueber die letzte Zeile.
 *
 * DREI WAECHTER, an der Datei festgenagelt (tests/druckenmiller/ledger.test.js bricht
 * jeden einmal absichtlich):
 *   1. Kette  — editierte Historie -> appendRow verweigert.
 *   2. Datum  — streng steigend; derselbe Tag zweimal oder rueckdatiert -> verweigert.
 *   3. Nie schrumpfen — ein Sidecar-Zaehler (<ledger>.meta.json) haelt fest, wie viele
 *      Zeilen der letzte Anhang hinterliess. Weniger Zeilen als das -> verweigert.
 *      (Der Zaehler ist das GEDAECHTNIS ueber den Runner-Teardown hinweg; er wird mit
 *      der Datei committet.)
 * Dazu die Zahlen-Hygiene: KEIN NaN/Infinity kommt in die Reihe (auch nicht verschachtelt).
 * Eine nicht-endliche Zahl wuerde als `null` serialisiert und waere spaeter von einem
 * ehrlichen "nicht gemessen" nicht mehr zu unterscheiden.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const atomicWrite = require('../atomic-write.js');

const GENESIS = 'GENESIS';

/**
 * Berechnet den SHA-256-Digest des uebergebenen Textes.
 * @param {string} text - Unveraenderter Text fuer die Hash-Pruefung.
 * @returns {string} Hexadezimaler SHA-256-Digest.
 */
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
/**
 * Leitet den Pfad der Metadaten-Sidecar aus dem Ledgerpfad ab.
 * @param {string} ledgerFile - Pfad der JSONL-Ledgerdatei.
 * @returns {string} Ledgerpfad mit angehaengtem .meta.json.
 */
const metaPath = (ledgerFile) => ledgerFile + '.meta.json';

/**
 * Zeilen der Datei (ohne Leerzeilen). Fehlende Datei = [] (Bootstrap ist kein Fehler).
 *
 * Das abschliessende \r wird ABGESCHNITTEN (Review-Fund, reproduziert): gehasht wird der
 * Zeilentext, und ein Checkout mit core.autocrlf=true haengt an jede Zeile ein \r. JSON.parse
 * schluckt es, sha256 nicht — die Kette waere auf so einer Maschine tot, und der Wächter
 * wuerde faelschlich "eine historische Zeile wurde veraendert" melden. Der Haupt-Schutz ist
 * der LF-Pin in .gitattributes; das hier deckt zusaetzlich Kopien ausserhalb von git ab.
 * @param {string} ledgerFile - Pfad der append-only JSONL-Ledgerdatei.
 * @returns {string[]} Nicht leere Textzeilen ohne CR.
 */
function readLines(ledgerFile) {
  if (!fs.existsSync(ledgerFile)) return [];
  return fs.readFileSync(ledgerFile, 'utf8').split('\n')
    .map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
    .filter((l) => l.trim() !== '');
}

/**
 * Alle Zeilen als Objekte. Eine unlesbare Zeile ist ROT — sie still zu ueberspringen
 * hiesse, ein Loch in der Reihe als vollstaendige Reihe auszugeben.
 * @param {string} ledgerFile - Pfad der append-only JSONL-Ledgerdatei.
 * @returns {Array<Object>} Geparste Ledgerzeilen.
 */
function readRows(ledgerFile) {
  return readLines(ledgerFile).map((line, i) => {
    try { return JSON.parse(line); }
    catch (e) {
      throw new Error(`[druckenmiller] Ledger-Zeile ${i + 1} in ${ledgerFile} ist nicht lesbar (${e.message}) — `
        + 'eine kaputte Zeile wird NICHT uebersprungen: die Reihe waere danach still unvollstaendig.');
    }
  });
}

/** Kette ueber die ganze Datei pruefen. { ok, error, rows }.
 * @param {string} ledgerFile - Pfad der append-only JSONL-Ledgerdatei.
 * @returns { {ok: boolean, rows: Array<Object>, error?: string} } Befund ueber Hash-Kette, Datumsfolge und Sidecar.
 */
function verifyChain(ledgerFile) {
  const lines = readLines(ledgerFile);
  let rows;
  try { rows = readRows(ledgerFile); } catch (e) { return { ok: false, error: e.message, rows: [] }; }
  for (let i = 0; i < rows.length; i++) {
    const erwartet = i === 0 ? GENESIS : sha256(lines[i - 1]);
    if (rows[i].prevHash !== erwartet) {
      return {
        ok: false,
        rows,
        error: `[druckenmiller] Kette gebrochen in Zeile ${i + 1} (${rows[i].date}): prevHash ist `
          + `${String(rows[i].prevHash).slice(0, 12)}…, erwartet ${erwartet.slice(0, 12)}… — eine `
          + 'historische Zeile wurde nach dem Schreiben veraendert.',
      };
    }
    if (i > 0 && !(rows[i].date > rows[i - 1].date)) {
      return {
        ok: false,
        rows,
        error: `[druckenmiller] Datum nicht streng steigend: Zeile ${i + 1} (${rows[i].date}) `
          + `nach ${rows[i - 1].date}.`,
      };
    }
  }
  // REVIEW-FUND (reproduziert): die Schleife oben prueft Zeile i gegen Zeile i-1 — die
  // LETZTE Zeile hat keinen Nachfolger und war damit frei editierbar. appendRow haette es
  // am naechsten Tag gemerkt, --check meldete HEUTE gruen. Der Beweis lag die ganze Zeit
  // ungenutzt daneben: appendRow schreibt lastHash in den Sidecar. Jetzt wird er gelesen.
  const meta = readMeta(ledgerFile);
  if (rows.length && meta && meta.lastHash) {
    const ist = sha256(lines[lines.length - 1]);
    if (ist !== meta.lastHash) {
      return {
        ok: false,
        rows,
        error: '[druckenmiller] Die LETZTE Zeile (' + rows[rows.length - 1].date + ') stimmt nicht '
          + 'mit dem Sidecar ueberein: ' + ist.slice(0, 12) + '…, erwartet '
          + String(meta.lastHash).slice(0, 12) + '… — sie wurde nach dem Schreiben veraendert.',
      };
    }
    if (meta.lastDate && meta.lastDate !== rows[rows.length - 1].date) {
      return {
        ok: false,
        rows,
        error: '[druckenmiller] Der Sidecar nennt ' + meta.lastDate + ' als letzten Tag, die Datei '
          + rows[rows.length - 1].date + ' — eine der beiden wurde ausgetauscht.',
      };
    }
  }
  return { ok: true, rows };
}

/**
 * Liest die Metadaten-Sidecar und unterscheidet fehlenden von korruptem Bestand.
 * @param {string} ledgerFile - Pfad der JSONL-Ledgerdatei.
 * @returns {Object|null} Metadaten oder null bei fehlender Sidecar.
 * @throws {Error} Vorhandene Metadaten sind unlesbar oder ungueltiges JSON.
 */
function readMeta(ledgerFile) {
  const p = metaPath(ledgerFile);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) {
    // Kein stiller null-Rueckfall: ein unlesbarer Sidecar nimmt der never-shrink-Regel und
    // dem Letzte-Zeile-Beweis die Grundlage. Das ist ein Befund, kein "gibt es halt nicht".
    throw new Error('[druckenmiller] Sidecar ' + p + ' ist nicht lesbar (' + e.message + ') — '
      + 'ohne ihn gibt es weder die never-shrink-Regel noch den Beweis fuer die letzte Zeile.');
  }
}

/** Rekursiv: keine nicht-endliche Zahl irgendwo im Objekt.
 * @param {unknown} wert - Rekursiv zu pruefender JSON-Wert.
 * @param {string} [pfad] - Feldpfad fuer die Fehlermeldung.
 * @returns {void} Akzeptiert Werte ohne NaN oder unendliche Zahlen.
 * @throws {Error} Eine nicht endliche Zahl wurde gefunden.
 */
function assertFinite(wert, pfad = 'row') {
  if (typeof wert === 'number') {
    if (!Number.isFinite(wert)) {
      throw new Error(`[druckenmiller] ${pfad} ist ${wert} — nicht endliche Zahlen kommen NICHT in die `
        + 'Reihe (JSON macht daraus null, und null heisst hier "nicht gemessen").');
    }
    return;
  }
  if (Array.isArray(wert)) { wert.forEach((v, i) => assertFinite(v, `${pfad}[${i}]`)); return; }
  if (wert && typeof wert === 'object') {
    for (const [k, v] of Object.entries(wert)) assertFinite(v, `${pfad}.${k}`);
  }
}

/**
 * Eine Zeile anhaengen. Prueft VORHER Kette, Schrumpfen, Datum und Zahlen; bei jedem
 * Verstoss wirft sie und schreibt NICHTS (ein abgelehnter Anhang darf keine Spur hinterlassen).
 * @param {string} ledgerFile - Ziel des append-only Ledgers.
 * @param {{date: string}} row - Neue Zeile; weitere Felder werden serialisiert.
 * @returns {string} Geschriebene JSON-Zeile mit prevHash.
 * @throws {Error} Kette, Datum, endliche Werte oder Dateioperationen sind ungueltig.
 */
function appendRow(ledgerFile, row) {
  if (!row || typeof row !== 'object' || !row.date) {
    throw new Error('[druckenmiller] Ledger-Zeile ohne date — jede Zeile gehoert zu genau einem Handelstag.');
  }
  assertFinite(row);

  const lines = readLines(ledgerFile);
  const meta = readMeta(ledgerFile);
  if (meta && lines.length < meta.rows) {
    throw new Error(`[druckenmiller] Der Ledger ist von ${meta.rows} auf ${lines.length} Zeilen geschrumpft `
      + `(${ledgerFile}). Eine append-only-Reihe schrumpft nie — hier wurde geloescht, abgeschnitten oder `
      + 'ein alter Stand ueberschrieben. Kein Anhang, bis das geklaert ist.');
  }
  const chain = verifyChain(ledgerFile);
  if (!chain.ok) throw new Error(chain.error);

  const letzte = chain.rows[chain.rows.length - 1];
  if (letzte && !(row.date > letzte.date)) {
    throw new Error(`[druckenmiller] Datum ${row.date} ist nicht groesser als die letzte Zeile `
      + `(${letzte.date}) — die Reihe laeuft streng vorwaerts; ein Loch in der Vergangenheit wird `
      + 'gemeldet (ledgerGapDays), nicht nachtraeglich gestopft.');
  }

  const prevHash = lines.length === 0 ? GENESIS : sha256(lines[lines.length - 1]);
  const line = JSON.stringify(Object.assign({}, row, { prevHash }));
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  fs.appendFileSync(ledgerFile, line + '\n');
  atomicWrite.writeFileAtomic(metaPath(ledgerFile), JSON.stringify({
    rows: lines.length + 1, lastDate: row.date, lastHash: sha256(line),
  }, null, 1) + '\n');
  return line;
}

/**
 * LOECHER INNERHALB der Reihe: Sitzungen zwischen erster und letzter Zeile ohne Zeile.
 * Bewusst NICHT ueber das Ende hinaus — der Tag, an dem der naechste Lauf noch nicht
 * gelaufen ist, ist kein Loch. Dafuer gibt es staleSessions().
 * @param {Array<{date: string}>} rows - Vorhandene Ledgerzeilen.
 * @param {string[]} sessions - Geordnetes Sitzungstagsraster.
 * @returns {number} Fehlende Sitzungen zwischen erster und letzter Zeile.
 */
function ledgerGapDays(rows, sessions) {
  if (!rows.length) return 0;
  const haben = new Set(rows.map((r) => r.date));
  const von = rows[0].date, bis = rows[rows.length - 1].date;
  return sessions.filter((s) => s >= von && s <= bis && !haben.has(s)).length;
}

/**
 * LOECHER AM ENDE: Sitzungen NACH der letzten Zeile, fuer die es schon Kurse gibt.
 * Das ist der stille Ausfall, den ledgerGapDays konstruktionsbedingt nicht sieht: der
 * Logger stirbt, die Reihe bleibt in sich lueckenlos und altert einfach weg.
 * @param {Array<{date: string}>} rows - Vorhandene Ledgerzeilen.
 * @param {string[]} sessions - Geordnetes Sitzungstagsraster.
 * @returns {number} Sitzungen seit dem letzten Ledgerdatum.
 */
function staleSessions(rows, sessions) {
  if (!rows.length) return 0;
  const letzte = rows[rows.length - 1].date;
  return sessions.filter((s) => s > letzte).length;
}

/**
 * Rat D2: rueckgerechnete Zeilen sind aus Quantilen und H-INT AUSGESCHLOSSEN. Sie
 * entstehen alle am selben Tag aus demselben rollenden Fenster; als Verteilungs-Basis
 * wuerden sie den Live-Tagen ihre eigene Herkunft als Massstab vorsetzen.
 * Gericht Runde 1 (14.09.2026) nimmt den zweiten Fall dazu: eine Zeile mit zu wenig
 * frischen Tickern (lowFreshness) misst Runner-Tempo, nicht Marktbreite — sie bleibt in
 * der Reihe stehen (Loeschen waere Geschichtsklitterung), speist aber kein Quantil.
 * DRITTER FALL (BUILD-SPEC v1 [REV6-4]/[REV10-4], registriert in Datei A als
 * courtGates.churnMaxShare): eine Sitzung, in der U um mehr als 5 % umgeschlagen hat
 * (highChurn), vergleicht zwei verschiedene Grundgesamtheiten und faellt aus demselben
 * Grund heraus. Zeilen OHNE das Feld sind unberuehrt (undefined !== true) — der Churn
 * wird derzeit schreiber-seitig in regime.json gefuehrt, nicht in der Ledger-Zeile;
 * die Regel steht hier trotzdem, damit sie nicht erst mit ihrem Produzenten entsteht.
 * @param {Array<{backfilled?: boolean, lowFreshness?: boolean, highChurn?: boolean}>} rows - Ledgerzeilen mit Ausschlussmarkierungen.
 * @returns {Array<Object>} Zeilen ohne eine ausdruecklich gesetzte Ausschlussmarkierung.
 */
function quantileInput(rows) {
  return rows.filter((r) => r.backfilled !== true && r.lowFreshness !== true && r.highChurn !== true);
}

module.exports = {
  GENESIS, sha256, metaPath, readLines, readRows, verifyChain, readMeta, assertFinite,
  appendRow, ledgerGapDays, staleSessions, quantileInput,
};
