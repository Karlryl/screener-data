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

const GENESIS = 'GENESIS';

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const metaPath = (ledgerFile) => ledgerFile + '.meta.json';

/** Zeilen der Datei (ohne Leerzeilen). Fehlende Datei = [] (Bootstrap ist kein Fehler). */
function readLines(ledgerFile) {
  if (!fs.existsSync(ledgerFile)) return [];
  return fs.readFileSync(ledgerFile, 'utf8').split('\n').filter((l) => l.trim() !== '');
}

/**
 * Alle Zeilen als Objekte. Eine unlesbare Zeile ist ROT — sie still zu ueberspringen
 * hiesse, ein Loch in der Reihe als vollstaendige Reihe auszugeben.
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

/** Kette ueber die ganze Datei pruefen. { ok, error, rows }. */
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
  return { ok: true, rows };
}

function readMeta(ledgerFile) {
  const p = metaPath(ledgerFile);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Rekursiv: keine nicht-endliche Zahl irgendwo im Objekt. */
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
  fs.writeFileSync(metaPath(ledgerFile), JSON.stringify({
    rows: lines.length + 1, lastDate: row.date, lastHash: sha256(line),
  }, null, 1) + '\n');
  return line;
}

/**
 * LOECHER INNERHALB der Reihe: Sitzungen zwischen erster und letzter Zeile ohne Zeile.
 * Bewusst NICHT ueber das Ende hinaus — der Tag, an dem der naechste Lauf noch nicht
 * gelaufen ist, ist kein Loch. Dafuer gibt es staleSessions().
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
 */
function quantileInput(rows) {
  return rows.filter((r) => r.backfilled !== true && r.lowFreshness !== true);
}

module.exports = {
  GENESIS, sha256, metaPath, readLines, readRows, verifyChain, readMeta,
  appendRow, ledgerGapDays, staleSessions, quantileInput,
};
