'use strict';
/**
 * scripts/write-newcomer-log.js — S0.2 aus dem Frueher-finden-Katalog (Masterplan 6.2).
 *
 * WOZU: Die Coverage-Studie S0.1 (17.07.) hat die Katalog-Praemisse widerlegt — CRDO und
 * ALAB standen sehr wohl in den Picks, ab dem 08.05., git-belegt. Die Luecke ist damit
 * eher eine AUFMERKSAMKEITS- als eine Formelluecke. Nur: beweisen laesst sich das fuer
 * keinen einzigen Namen, weil niemand mitgeschrieben hat, WANN ein Name zum ersten Mal
 * in der Uebersicht auftauchte. Der Studien-Text sagt es woertlich: „‚ignoriert' ist
 * mangels Aktions-Log (S0.2) fuer keinen Namen beweisbar."
 *
 * Dieses Skript schliesst die Luecke ab heute. Es schreibt je Lauf EINE Zeile mit der
 * vollstaendigen Mitgliederliste der Uebersicht plus den Zu- und Abgaengen gegenueber dem
 * letzten Eintrag. Rueckwirkend ist nichts zu retten — jeder Tag ohne Mitschrift ist
 * verlorene Evidenz, deshalb faengt es an, bevor der teure E-Ast gebaut wird.
 *
 * WAS ES NICHT IST: kein Score-Eingriff, keine neue Achse, keine Alarm-Kette. Reine
 * Beobachtung, additiv. Faellt es aus, fehlt eine Log-Zeile und sonst nichts.
 *
 * ⚠ picks-history/ wird NIE beruehrt (Schutzliste, Grundgesetz). Dieses Skript baut
 * seinen Pfad ausschliesslich unter newcomer-log/.
 *
 * Usage:
 *   node scripts/write-newcomer-log.js [--dry-run]
 * Exit: 0 = ok ODER nichts zu tun (fehlende Uebersicht ist KEIN Fehler — der Lauf davor
 *           kann aus anderen Gruenden nichts erzeugt haben, und dafuer soll die tägliche
 *           Kette nicht rot werden). 1 = harter Fehler beim Schreiben.
 */
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../lib/atomic-write.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const OVERVIEW = path.join(REPO_ROOT, 'outputs', 'hypergrowth', 'overview.json');
function newcomerLogDir(repoRoot = REPO_ROOT) {
  return path.join(repoRoot, 'newcomer-log');
}
const LOG_DIR = newcomerLogDir();

function isoHeute(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function isCanonicalCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(timestamp)
    && new Date(timestamp).toISOString().slice(0, 10) === value;
}

/** Mitglieder der Uebersicht als Ticker-Liste. Reihenfolge = Rang. */
function mitgliederAus(raw) {
  const liste = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.rows) ? raw.rows : []);
  return liste
    .map((r) => (r && typeof r.ticker === 'string' ? r.ticker : null))
    .filter(Boolean);
}

/**
 * Alle bisherigen Zeilen, aeltester zuerst. Liest ALLE Monatsdateien, nicht nur die
 * aktuelle — sonst waere der erste Eintrag jedes Monats faelschlich ein Neuzugangs-Feuerwerk.
 * Kaputte Zeilen werden uebersprungen statt den Lauf zu kippen (eine unlesbare Zeile ist
 * ein verlorener Tag, kein Grund, den heutigen auch noch zu verlieren).
 *
 * Review-Nachzug Welle 7: Statuszeilen (nicht-messbare Tage, KEIN members-Array) zaehlen
 * hier ausdruecklich mit. Sonst kippt der naechste regulaere Lauf sie beim Rewrite der
 * Monatsdatei stillschweigend raus — der Ausfall waere genau so unsichtbar wie vorher,
 * nur einen Tag spaeter. Wer einen Mitglieder-VORGAENGER sucht, filtert selbst auf
 * Array.isArray(z.members) (siehe run()).
 */
function bisherigeZeilen(dir = LOG_DIR) {
  if (!fs.existsSync(dir)) return [];
  const dateien = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort();
  const raus = [];
  for (const f of dateien) {
    const zeilen = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/);
    for (let i = 0; i < zeilen.length; i++) {
      const z = zeilen[i];
      if (!z.trim()) continue;
      try {
        const o = JSON.parse(z);
        if (o && typeof o.date === 'string'
          && (Array.isArray(o.members) || typeof o.status === 'string')) raus.push(o);
      } catch (e) {
        // BK-SK-001: die Zeile wird weiterhin uebersprungen (ein verlorener Tag ist kein
        // Grund, den heutigen auch zu verlieren) — aber nicht mehr stumm. Faellt die
        // JUENGSTE Zeile aus, vergleicht der heutige Lauf gegen einen aelteren Vorgaenger
        // und meldet Zu-/Abgaenge, die es so nie gab.
        console.log('::warning::Kaputte Zeile im Newcomer-Log uebersprungen: ' + f + ':' + (i + 1)
          + ' (' + e.message + ') — die Zu-/Abgaenge dieses Tages sind verloren.');
      }
    }
  }
  return raus.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Reine Funktion: aus Vorgaenger und heutiger Liste die Zu-/Abgaenge. Getrennt gehalten,
 * damit der Test sie ohne Dateisystem prueft.
 */
function diffMitglieder(vorher, heute) {
  const alt = new Set(vorher || []);
  const neu = new Set(heute || []);
  return {
    newcomers: (heute || []).filter((t) => !alt.has(t)),
    departures: (vorher || []).filter((t) => !neu.has(t)),
  };
}

/**
 * Schreibt EINE Zeile in die Monatsdatei — Rewrite statt Append, damit ein Zweitlauf
 * desselben Tages seinen Eintrag ERSETZT statt zu duplizieren. Gilt fuer Mitglieder-
 * UND Statuszeilen (Review-Nachzug Welle 7: der Append im Leer-Zweig legte bei jedem
 * Wiederholungslauf eine weitere "nicht-messbar"-Zeile fuer denselben Tag an).
 * Rueckgabe: repo-relativer Pfad — konsistent fuer beide Zweige.
 */
function schreibeMonatszeile(logDir, datum, eintrag, dryRun, zeilen) {
  const datei = path.join(logDir, datum.slice(0, 7) + '.jsonl');
  const alle = zeilen || bisherigeZeilen(logDir);
  const behalten = alle.filter((z) => z.date !== datum && z.date.slice(0, 7) === datum.slice(0, 7));
  const inhalt = [...behalten, eintrag]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((o) => JSON.stringify(o))
    .join('\n') + '\n';
  if (!dryRun) {
    fs.mkdirSync(logDir, { recursive: true });
    // writeJsonAtomic erwartet ein Objekt; JSONL wird deshalb direkt geschrieben —
    // aber ueber eine Temp-Datei plus rename, damit ein abgebrochener Lauf keine halbe
    // Datei hinterlaesst (dasselbe Versprechen, anderes Format).
    const tmp = datei + '.tmp';
    fs.writeFileSync(tmp, inhalt, 'utf8');
    fs.renameSync(tmp, datei);
  }
  return path.relative(REPO_ROOT, datei);
}

function run(opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const datum = opts.date == null ? isoHeute() : opts.date;
  const overview = opts.overview || OVERVIEW;
  const logDir = opts.logDir || LOG_DIR;

  // The date becomes both evidence provenance and part of the monthly filename.
  // Reject traversal, non-canonical forms and impossible calendar days before
  // reading the overview or creating a directory. Otherwise "../evil" escapes
  // logDir, while "undefined" creates a file the reader never discovers.
  if (!isCanonicalCalendarDate(datum)) {
    return {
      status: 'datum-ungueltig',
      date: datum,
      error: 'expected a real YYYY-MM-DD calendar date, got ' + JSON.stringify(datum),
      exitCode: 1,
    };
  }

  if (!fs.existsSync(overview)) {
    return { status: 'keine-uebersicht', date: datum, exitCode: 0 };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(overview, 'utf8'));
  } catch (e) {
    // Unlesbare Uebersicht: NICHT still weitergehen. Das ist ein echter Defekt weiter
    // vorn in der Kette, und eine leere Mitgliederliste zu schreiben waere schlimmer als
    // gar nichts — morgen saehe sie wie 200 Neuzugaenge aus.
    return { status: 'uebersicht-unlesbar', date: datum, error: String(e && e.message || e), exitCode: 1 };
  }
  const members = mitgliederAus(raw);
  if (!members.length) {
    const statuszeile = { date: datum, board: 'hypergrowth-overview', status: 'nicht-messbar', reason: 'uebersicht-leer' };
    const datei = schreibeMonatszeile(logDir, datum, statuszeile, dryRun);
    return { status: 'uebersicht-leer', date: datum, datei, statuszeile, dryRun, exitCode: 0 };
  }

  const zeilen = bisherigeZeilen(logDir);
  // Rerun DESSELBEN Tages ersetzt seinen Eintrag, statt einen zweiten anzuhaengen —
  // sonst waere der zweite Lauf eines Tages immer „null Neuzugaenge" und der erste
  // Eintrag bliebe als Karteileiche stehen.
  // Vorgaenger ist die letzte Zeile MIT Mitgliederliste: ein nicht messbarer Tag
  // (Statuszeile) darf nicht als „Board war leer" in die Zu-/Abgangsrechnung eingehen.
  const frueher = zeilen.filter((z) => z.date < datum && Array.isArray(z.members));
  const vorgaenger = frueher.length ? frueher[frueher.length - 1] : null;
  const { newcomers, departures } = diffMitglieder(vorgaenger ? vorgaenger.members : null, members);

  const eintrag = {
    date: datum,
    board: 'hypergrowth-overview',
    prior: vorgaenger ? vorgaenger.date : null,
    n: members.length,
    // Beim allerersten Eintrag ist JEDER Name „neu". Das waere irrefuehrend, deshalb
    // wird der Fall benannt statt gezaehlt.
    erstaufnahme: vorgaenger === null,
    newcomers: vorgaenger === null ? [] : newcomers,
    departures: vorgaenger === null ? [] : departures,
    members,
  };

  const datei = schreibeMonatszeile(logDir, datum, eintrag, dryRun, zeilen);
  return {
    status: 'geschrieben', date: datum, prior: eintrag.prior, n: members.length,
    erstaufnahme: eintrag.erstaufnahme,
    newcomers: eintrag.newcomers, departures: eintrag.departures,
    datei, dryRun, exitCode: 0,
  };
}

if (require.main === module) {
  const argv = process.argv;
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  const dateIndex = argv.indexOf('--date');
  // Absence means "use today"; a present flag without a value is invalid input.
  const date = dateIndex < 0 ? null : (argv[dateIndex + 1] ?? '');
  const dryRun = argv.includes('--dry-run');
  // --overview/--log-dir existieren, damit der CLI-Pfad (und nur der annotiert) in
  // einem Temp-Verzeichnis verhaltensgetestet werden kann statt per Quelltext-Regex.
  const res = run({ dryRun, overview: flag('--overview'), logDir: flag('--log-dir'), date });
  const tag = res.dryRun ? '[dry-run] ' : '';
  if (res.status === 'datum-ungueltig') {
    console.error('::error::newcomer-log: invalid date - ' + res.error);
  } else if (res.status === 'keine-uebersicht') {
    console.log('newcomer-log: keine outputs/hypergrowth/overview.json — nichts zu tun.');
  } else if (res.status === 'uebersicht-leer') {
    console.log('::warning::newcomer-log: Uebersicht hat null Zeilen — Tag als nicht messbar mitgeschrieben.');
  } else if (res.status === 'uebersicht-unlesbar') {
    console.error('newcomer-log FEHLER: Uebersicht unlesbar — ' + res.error);
  } else {
    console.log(tag + 'newcomer-log ' + res.date + ' (prior=' + (res.prior || '—') + '): '
      + res.n + ' Mitglieder'
      + (res.erstaufnahme
        ? ' — ERSTAUFNAHME, Zu-/Abgaenge erst ab dem naechsten Lauf messbar'
        : ' · ' + res.newcomers.length + ' neu · ' + res.departures.length + ' raus'));
    if (res.newcomers.length) console.log('  neu:  ' + res.newcomers.join(' '));
    if (res.departures.length) console.log('  raus: ' + res.departures.join(' '));
  }
  process.exit(res.exitCode);
}

module.exports = { run, diffMitglieder, mitgliederAus, bisherigeZeilen, isoHeute, newcomerLogDir };
