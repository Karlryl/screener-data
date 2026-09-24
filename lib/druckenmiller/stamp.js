'use strict';
/**
 * lib/druckenmiller/stamp.js — die Stempel-Regel des Rats T329 (ratifiziert 2026-09-21,
 * `_T329-RATSVERDIKT-2026-09-21.md`, Beschluss B mit zwei Aenderungen plus Bruecken-Flag).
 *
 * WAS SICH AENDERT: der Stempel `constants_sha256` einer Ledger-Zeile war bisher gegen den
 * Digest zu pruefen, den Datei A AM ZEILENDATUM trug. Das faellt bei einem GitHub-Re-Run
 * faelschlich rot aus (alter Commit, neues `generatedAt`) und schreibt der Zeile einen
 * Digest vor, unter dem sie gar nicht gerechnet wurde. Der Stempel ist jetzt der
 * tatsaechlich verwendete Digest, und geprueft wird DREIERLEI:
 *   (1) Kettenzugehoerigkeit — der Digest steht im Changelog der Datei.
 *   (2) Der Digest war zum Zeitpunkt `generatedAt` TATSAECHLICH in main.
 *   (3) Monotonie — ueber die Zeilen hinweg laeuft der Stempel nie rueckwaerts.
 *
 * EINTRAGUNGSZEIT: UTC, abgeleitet aus dem Merge nach main, nie von Hand getippt.
 *
 * WARUM (2) MIT INTERVALLEN UND NICHT MIT EINEM ZEITPUNKT (Review-Fund, reproduziert):
 * eine Changelog-Zeile kann hinzugefuegt, entfernt und wieder hinzugefuegt werden (ein
 * Revert von Datei A auf einen frueheren Stand erzeugt exakt denselben Digest). Ein
 * Schema "fruehester Eintritt" laesst dann eine Zeile durch, die in der Luecke gerechnet
 * wurde, als der Stand gar nicht in main war. Deshalb werden `+`- UND `-`-Zeilen gelesen
 * und je Digest die Anwesenheits-Ereignisse gefuehrt; gefragt wird "war er ZU DIESEM
 * Zeitpunkt da", nicht "gab es ihn irgendwann".
 *
 * WANN DIE ABLEITUNG VERWEIGERT WIRD (statt falsch sicher zu sein): bei einem flachen Klon
 * zeigt die Historie den Rand-Commit statt des Eintritts, und nach einer Umbenennung zeigt
 * `--first-parent` ohne `--follow` den Umbenennungs-Commit fuer JEDEN Digest. Beide Formen
 * liefern eine plausible, falsche Uhrzeit. Sie werden erkannt und fuehren zu
 * `precision: 'day'` MIT Grund — keine erfundene Praezision.
 *
 * TAGESAUFLOESUNG heisst: die Zeile ist NICHT verifiziert. Sie kann einen Verstoss noch
 * WIDERLEGEN (Changelog-Datum liegt hinter `generatedAt`), aber sie kann keinen
 * Freispruch begruenden. `verified: false` wandert bis in den Aufrufer, und der Waechter
 * auf `main` verlangt fuer jede echte Zeile `verified: true`.
 *
 * BRUECKEN-FLAG (Dissens 2:2, Vorsitz-Beschluss): Zeilen, deren Digest NACH Handelsschluss
 * des Handelstages D in main kam, tragen `constantsAfterClose: true`. Sie werden NICHT
 * blockiert; sie bilden in der Auswertung eine eigene Schicht. Ist die Frage nicht
 * entscheidbar, steht dort `null` (nicht gemessen) — nie `false`.
 *
 * NICHT hier: das Zulaessigkeitstor C (nicht uebernommen) und der Digest nur ueber den
 * Konstantenteil (eigener Ratspunkt T333).
 */
const { execFileSync } = require('node:child_process');

/** Changelog-Zeile: <datum> <trenner> <datei> <trenner> <sha256> <trenner> <grund>. */
const CHANGELOG_ZEILE = /^(\d{4}-\d{2}-\d{2})\s*[·*]\s*(\S+)\s*[·*]\s*([0-9a-f]{64})/;
/** Ein Datum, das es wirklich gibt — `Number('')` ist 0 und wuerde sonst durchrutschen. */
const DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Ein Zeitpunkt MIT Zone. Ohne Zone liest ihn Node als Ortszeit — das Urteil haengt sonst am Runner. */
const ZEITPUNKT_MIT_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const GIT_TIMEOUT_MS = 60000;

/** Die Kette einer Datei in DATEIREIHENFOLGE (bei Datumsgleichheit entscheidet sie).
 * @param {string} changelogText - Vollstaendiger Changelog-Text.
 * @param {string} dateiPfad - Gesuchter Registrierungspfad im Changelog.
 * @returns {Array<{date: string, digest: string}>} Digestfolge in Dateireihenfolge.
 */
function digestChain(changelogText, dateiPfad) {
  const kette = [];
  for (const zeile of String(changelogText).split('\n')) {
    const m = zeile.match(CHANGELOG_ZEILE);
    if (m && m[2] === dateiPfad) kette.push({ date: m[1], digest: m[3] });
  }
  return kette;
}

function git(repoRoot, args) {
  return execFileSync('git', [
    // Eine externe Diff-Engine oder ein textconv-Attribut wuerde Ausgabe erzeugen, die der
    // `+`-Parser falsch liest. Beides hier hart abgeschaltet, kostet nichts.
    '-c', 'diff.external=', '-c', 'core.pager=cat',
  ].concat(args), {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: GIT_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Gruende, aus denen die Zeit-Ableitung NICHT vertrauenswuerdig waere. Beide wurden im
 * Review an synthetischen Repos reproduziert: sie liefern eine plausible falsche Uhrzeit,
 * nicht einen Fehler — deshalb werden sie vorher abgefragt.
 * @param {string} repoRoot - Lokales Git-Repository.
 * @param {string} changelogRelPfad - Repository-relativer Changelog-Pfad.
 * @returns {string|null} Grund gegen eine genaue Zeit-Ableitung oder null.
 */
function derivationBlocker(repoRoot, changelogRelPfad) {
  let flach;
  try {
    flach = git(repoRoot, ['rev-parse', '--is-shallow-repository']).trim();
  } catch (e) {
    return 'git nicht lesbar: ' + String(e && e.message ? e.message : e).trim().replace(/\s+/g, ' ');
  }
  if (flach === 'true') {
    return 'flacher Klon (git rev-parse --is-shallow-repository = true) — die Historie reicht '
      + 'nicht bis zum Eintritt, der Rand-Commit waere eine erfundene Uhrzeit';
  }
  let umbenennungen = '';
  try {
    umbenennungen = git(repoRoot, [
      'log', '--first-parent', '--diff-filter=R', '--format=%H', '--', changelogRelPfad,
    ]).trim();
  } catch (e) {
    return 'Umbenennungs-Pruefung nicht moeglich: '
      + String(e && e.message ? e.message : e).trim().replace(/\s+/g, ' ');
  }
  if (umbenennungen) {
    return 'die Datei wurde umbenannt (' + umbenennungen.split('\n').length + ' Commit(s) mit '
      + 'Rename) — ohne --follow zeigt die Historie fuer JEDEN Digest den Umbenennungs-Commit';
  }
  return null;
}

/**
 * Anwesenheits-Ereignisse je Digest: wann kam die Changelog-Zeile nach main (`add`), wann
 * verschwand sie wieder (`del`). `--first-parent -m` zeigt je Merge genau das, was er main
 * hinzugefuegt oder genommen hat; `%cI` ist die Zeit dieses Merges.
 * @param {string} repoRoot - Lokales Git-Repository.
 * @param {string} changelogRelPfad - Repository-relativer Changelog-Pfad.
 * @returns {Map<string, Array<{at: string, ms: number, kind: string}>>} Zeitlich sortierte Eintritts- und Austrittsereignisse je Digest.
 * @throws {Error} Git kann die Historie nicht innerhalb des Zeitlimits lesen.
 */
function gitEntryEvents(repoRoot, changelogRelPfad) {
  const roh = git(repoRoot, [
    'log', '--first-parent', '-m', '--format=%x00%cI', '-p', '--no-textconv', '--', changelogRelPfad,
  ]);
  const proDigest = new Map();
  let zeitpunkt = null;
  for (const zeile of roh.split('\n')) {
    if (zeile.charCodeAt(0) === 0) { zeitpunkt = zeile.slice(1).trim(); continue; }
    const kind = zeile.startsWith('+') && !zeile.startsWith('+++') ? 'add'
      : (zeile.startsWith('-') && !zeile.startsWith('---') ? 'del' : null);
    if (!kind || !zeitpunkt) continue;
    const m = zeile.slice(1).match(CHANGELOG_ZEILE);
    if (!m) continue;
    const ms = Date.parse(zeitpunkt);
    if (!Number.isFinite(ms)) continue;
    if (!proDigest.has(m[3])) proDigest.set(m[3], []);
    proDigest.get(m[3]).push({ at: new Date(ms).toISOString(), ms, kind });
  }
  for (const ereignisse of proDigest.values()) ereignisse.sort((a, b) => a.ms - b.ms);
  return proDigest;
}

/**
 * Eintragungszeit je Digest der Kette. Scheitert oder misstraut die Ableitung, ist das kein
 * stiller Rueckfall: der Eintrag sagt, dass er nur Tagesaufloesung hat, und WARUM.
 * @param {string} repoRoot - Lokales Git-Repository.
 * @param {string} changelogRelPfad - Repository-relativer Changelog-Pfad.
 * @param {Array<{date: string, digest: string}>} kette - Zu datierende Changelog-Eintraege.
 * @returns {Map<string, Object>} Zeitbelege mit UTC-Ereignissen oder erklaerter Tagesaufloesung.
 */
function entryTimes(repoRoot, changelogRelPfad, kette) {
  let proDigest = new Map();
  let grund = derivationBlocker(repoRoot, changelogRelPfad);
  if (!grund) {
    try {
      proDigest = gitEntryEvents(repoRoot, changelogRelPfad);
    } catch (e) {
      // Die ganze Meldung, nicht nur die erste Zeile: git haengt seinen stderr ab Zeile 2 an,
      // und genau der sagt, warum.
      grund = 'git-Historie nicht lesbar: '
        + String(e && e.message ? e.message : e).trim().replace(/\s+/g, ' ');
    }
  }
  const zeiten = new Map();
  for (const e of kette) {
    const ereignisse = grund ? null : proDigest.get(e.digest);
    zeiten.set(e.digest, (ereignisse && ereignisse.length)
      ? { events: ereignisse, precision: 'utc', date: e.date, at: ereignisse[0].at }
      : {
        events: null,
        at: null,
        precision: 'day',
        date: e.date,
        reason: grund || 'kein Merge nach main gefunden, der diese Changelog-Zeile hinzufuegt',
      });
  }
  return zeiten;
}

/** War der Digest zum Zeitpunkt `ms` in main? Letztes Ereignis davor entscheidet.
 * @param {{precision: string, events: Array<{ms: number, at: string, kind: string}>|null}} eintrag - Zeitbeleg eines Digests.
 * @param {number} ms - Zu pruefender UTC-Zeitpunkt in Millisekunden.
 * @returns {boolean|null} Anwesenheit des Digests oder null ohne UTC-Ereignisse.
 */
function presentAt(eintrag, ms) {
  if (eintrag.precision !== 'utc' || !eintrag.events) return null;
  let letztes = null;
  for (const ev of eintrag.events) { if (ev.ms <= ms) letztes = ev; else break; }
  return letztes ? letztes.kind === 'add' : false;
}

/** Der `add`, der den Digest fuer diesen Zeitpunkt in main gebracht hat.
 * @param {{precision: string, events: Array<{ms: number, at: string, kind: string}>|null}} eintrag - Zeitbeleg eines Digests.
 * @param {number} ms - Zu pruefender UTC-Zeitpunkt in Millisekunden.
 * @returns {Object|null} Zu diesem Zeitpunkt wirksamer Eintritt oder null.
 */
function effectiveAdd(eintrag, ms) {
  if (eintrag.precision !== 'utc' || !eintrag.events) return null;
  let letzter = null;
  for (const ev of eintrag.events) {
    if (ev.ms > ms) break;
    letzter = ev.kind === 'add' ? ev : null;
  }
  return letzter;
}

/** UTC-Versatz von America/New_York zu einem UTC-Zeitpunkt (Intl, keine Abhaengigkeit).
 * @param {number} utcMs - UTC-Zeitpunkt in Millisekunden.
 * @returns {number} New-York-Versatz zu UTC in Millisekunden.
 */
function etOffsetMs(utcMs) {
  const teile = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const p = {};
  for (const t of teile) p[t.type] = t.value;
  const stunde = p.hour === '24' ? 0 : Number(p.hour);   // h23/h24 je nach ICU-Stand
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day),
    stunde, Number(p.minute), Number(p.second)) - utcMs;
}

/**
 * Handelsschluss des Tages D in UTC: 16:00 America/New_York. Der Versatz wird MITTAGS
 * gemessen, nie um Mitternacht — die Zeitumstellung liegt um 02:00 lokal, ein Mittagswert
 * ist an jedem Kalendertag eindeutig.
 *
 * ponytail: feste 16:00 — die halben Handelstage (13:00 ET, Tag nach Thanksgiving,
 * 24.12.) sind hier NICHT abgebildet. An ihnen gilt ein Eintrag zwischen 13:00 und 16:00
 * ET als "vor Schluss". Aufruesten hiesse einen Feiertagskalender einzufuehren; das lohnt
 * erst, wenn das Flag analytisch benutzt wird und eine solche Zelle traegt.
 * @param {string} datum - Existierender Kalendertag YYYY-MM-DD.
 * @returns {number} UTC-Millisekunden fuer 16:00 New York; halbe Handelstage bleiben unberuecksichtigt.
 * @throws {Error} Format oder Kalendertag ist ungueltig.
 */
function closeOfTradingDayUTC(datum) {
  const m = DATUM.exec(String(datum));
  if (!m) {
    throw new Error('[druckenmiller] Handelsschluss fuer unlesbares Datum '
      + JSON.stringify(datum) + ' verlangt.');
  }
  const y = Number(m[1]), mon = Number(m[2]), d = Number(m[3]);
  const probe = Date.UTC(y, mon - 1, d, 17, 0, 0);
  // Rueckprobe: Date.UTC rollt einen 30. Februar stillschweigend weiter. Ein Datum, das
  // nicht auf sich selbst zurueckfaellt, gibt es nicht — und darf keine Zahl liefern.
  const zurueck = new Date(probe).toISOString().slice(0, 10);
  if (zurueck !== String(datum)) {
    throw new Error('[druckenmiller] ' + JSON.stringify(datum) + ' ist kein existierender '
      + 'Kalendertag (rollt auf ' + zurueck + ') — dafuer gibt es keinen Handelsschluss.');
  }
  return Date.UTC(y, mon - 1, d, 16, 0, 0) - etOffsetMs(probe);
}

/** `generatedAt` in ms, oder ein Grund, warum es nicht benutzbar ist.
 * @param {string} generatedAt - ISO-Zeitpunkt mit expliziter Zeitzone.
 * @returns { {ms: number|null, why: string|null} } UTC-Millisekunden oder begruendeter Lesefehler.
 */
function parseGeneratedAt(generatedAt) {
  if (typeof generatedAt !== 'string' || !ZEITPUNKT_MIT_ZONE.test(generatedAt)) {
    return {
      ms: null,
      why: 'generatedAt=' + JSON.stringify(generatedAt) + ' traegt keine Zeitzone (erwartet '
        + 'z. B. 2026-09-22T09:07:12.775Z) — ohne Zone liest Node es als Ortszeit, und das '
        + 'Urteil haenge dann am Runner statt an der Zeile',
    };
  }
  const ms = Date.parse(generatedAt);
  return Number.isFinite(ms) ? { ms, why: null }
    : { ms: null, why: 'generatedAt=' + JSON.stringify(generatedAt) + ' ist keine lesbare Zeit' };
}

/**
 * Pruefung (2): war der gestempelte Stand zum Zeitpunkt `generatedAt` in main?
 * `verified` sagt, ob die Antwort auf einer abgeleiteten Zeit beruht. Auf Tagesaufloesung
 * kann diese Pruefung nur WIDERLEGEN, nie freisprechen.
 * @param {Object} eintrag - Digest-Zeitbeleg mit Ereignissen oder Tagesaufloesung.
 * @param {string} generatedAt - Erzeugungszeitpunkt der Ledgerzeile mit Zone.
 * @returns { {ok: boolean, verified: boolean, detail: string} } Anwesenheitspruefung mit ausgewiesener Belegpraezision.
 */
function entryNotAfterGenerated(eintrag, generatedAt) {
  const gen = parseGeneratedAt(generatedAt);
  if (gen.ms == null) return { ok: false, verified: false, detail: gen.why };
  if (eintrag.precision === 'utc') {
    const da = presentAt(eintrag, gen.ms);
    return {
      ok: da === true,
      verified: true,
      detail: 'in main seit ' + eintrag.events.map((e) => e.kind + ' ' + e.at).join(', ')
        + '; generatedAt ' + generatedAt,
    };
  }
  const genTag = new Date(gen.ms).toISOString().slice(0, 10);
  return {
    ok: eintrag.date <= genTag,
    verified: false,
    detail: 'nur Tagesaufloesung (' + eintrag.reason + '): Changelog-Zeile vom ' + eintrag.date
      + ' gegen generatedAt-Tag ' + genTag + ' — das kann einen Verstoss widerlegen, aber '
      + 'keinen Freispruch begruenden',
  };
}

/**
 * Bruecken-Flag: kam der Digest NACH Handelsschluss des Handelstages D in main?
 * `value: null` heisst NICHT "nein", sondern "nicht entscheidbar".
 *
 * Auf Tagesaufloesung ist nur die Richtung "danach" entscheidbar: die Merge-Zeit liegt
 * immer AM oder NACH dem Datum der Changelog-Zeile, also ist eine Zeile mit spaeterem
 * Datum sicher nach Schluss. Ein frueheres Datum sagt gar nichts — gemessen an diesem
 * Repo lagen zwischen dem Datum einer Zeile (14.09.) und ihrem Eintritt in main (19.09.)
 * fuenf Tage. Ein `false` daraus waere eine Aussage, die niemand gemessen hat.
 * @param {Object} eintrag - Zeitbeleg des verwendeten Digests.
 * @param {string} sessionDate - Handelstag YYYY-MM-DD.
 * @param {string} generatedAt - Erzeugungszeitpunkt der Ledgerzeile.
 * @returns {Object} Bruecken-Flag mit Praezision und gegebenenfalls Unentscheidbarkeitsgrund.
 * @throws {Error} Der Sitzungstag ist bei einer UTC-Pruefung ungueltig.
 */
function afterClose(eintrag, sessionDate, generatedAt) {
  if (eintrag.precision === 'utc') {
    const gen = generatedAt == null ? { ms: Infinity } : parseGeneratedAt(generatedAt);
    const add = effectiveAdd(eintrag, gen.ms == null ? Infinity : gen.ms);
    if (!add) {
      return {
        value: null,
        precision: 'utc',
        detail: 'zum Zeitpunkt ' + String(generatedAt) + ' war ' + eintrag.date
          + ' kein Eintritt dieses Digests in main wirksam',
      };
    }
    return { value: add.ms > closeOfTradingDayUTC(sessionDate), precision: 'utc', at: add.at };
  }
  if (eintrag.date > sessionDate) return { value: true, precision: 'day' };
  return {
    value: null,
    precision: 'day',
    detail: 'Changelog-Zeile vom ' + eintrag.date + ' ohne abgeleitete Uhrzeit ('
      + eintrag.reason + ') — die Merge-Zeit kann Tage spaeter liegen, vor oder nach '
      + 'Handelsschluss des ' + sessionDate + ' ist so nicht entscheidbar',
  };
}

/**
 * Die zwei Felder, die der Schreiber an jede Zeile haengt. Eigene Funktion, damit die
 * Entscheidung geprueft werden kann, ohne den ganzen Schreiber zu fahren.
 * @param {Object} eintrag - Zeitbeleg des verwendeten Digests.
 * @param {string} sessionDate - Handelstag YYYY-MM-DD.
 * @param {string} generatedAt - Erzeugungszeitpunkt der Ledgerzeile.
 * @returns {Object} constantsAfterClose, constantsEntryPrecision und gegebenenfalls eine Warnung.
 * @throws {Error} Der Sitzungstag ist bei einer UTC-Pruefung ungueltig.
 */
function stampFields(eintrag, sessionDate, generatedAt) {
  const nachSchluss = afterClose(eintrag, sessionDate, generatedAt);
  const felder = {
    constantsAfterClose: nachSchluss.value,
    constantsEntryPrecision: nachSchluss.precision,
  };
  if (nachSchluss.value === null) {
    felder.warn = '[druckenmiller] ' + sessionDate + ': constantsAfterClose nicht entscheidbar — '
      + nachSchluss.detail + '. Die Zeile traegt null (nicht gemessen), nicht false.';
  }
  return felder;
}

/**
 * Die Stempel-Pruefung ueber eine ganze Reihe. Gibt `{checked, stamped, unverified}` zurueck
 * und wirft beim ersten Verstoss.
 *
 * `stamped` ist die Zahl der Zeilen, deren Stempel WIRKLICH geprueft wurde — der Aufrufer
 * muss sie ansehen, sonst kann die Pruefung leerlaufen (leere Reihe, alles backfilled, ein
 * verrutschtes `registeredOn`) und trotzdem gruen melden.
 *
 * Unveraendert aus [REV5-6]/[REV7-3]: nur ausdrueckliche Backfills sind ausgenommen; eine
 * vorhandene, aber ungueltige Stempelung faellt NIE in die historische Provenienz-Ausnahme.
 * @param {Array<Object>} rows - Ledgerzeilen mit Datum, Digest und Erzeugungszeit.
 * @param {{registeredOn: string, verifiedPostHashRows?: Array<{date: string}>}} registration - Registrierungsdatum und historische Provenienznachweise.
 * @param {Array<{date: string, digest: string}>} kette - Geordnete gueltige Digestfolge.
 * @param {Map<string, Object>} zeiten - Zeitbelege fuer die Digests der Kette.
 * @returns { {checked: number, stamped: number, unverified: Array<Object>} } Pruefzaehler und Zeilen ohne genaue Zeitverifikation.
 * @throws {Error} Eingaben, Provenienz, Digest-Anwesenheit oder Stempel-Monotonie sind verletzt.
 */
function assertStampedRows(rows, registration, kette, zeiten) {
  if (!Array.isArray(rows)) {
    throw new Error('[druckenmiller] Stempel-Pruefung ohne Zeilen-Array (' + typeof rows + ').');
  }
  if (!registration || !DATUM.test(String(registration.registeredOn))) {
    throw new Error('[druckenmiller] die Registrierung nennt kein gueltiges registeredOn ('
      + JSON.stringify(registration && registration.registeredOn) + ') — ohne es filtert die '
      + 'Pruefung JEDE Zeile weg und meldet gruen.');
  }
  if (!Array.isArray(kette) || !kette.length) {
    throw new Error('[druckenmiller] leere Changelog-Kette — ohne sie ist kein Stempel pruefbar.');
  }
  // ERSTES Vorkommen zaehlt: wird ein Digest spaeter erneut eingetragen (Revert von Datei A
  // auf einen frueheren Stand), ist die Rueckkehr zu ihm ein Rueckwaertslauf und soll als
  // solcher auffallen. Die letzte Stelle zu nehmen wuerde genau diesen Fall durchlassen.
  const index = new Map();
  kette.forEach((e, i) => { if (!index.has(e.digest)) index.set(e.digest, i); });

  const nachHash = rows
    .filter((r) => r && r.date > registration.registeredOn && r.backfilled !== true)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const verified = new Set((registration.verifiedPostHashRows || []).map((r) => r.date));
  let hoechsterIndex = -1;
  let stamped = 0;
  const unverified = [];

  for (const row of nachHash) {
    if (!Object.prototype.hasOwnProperty.call(row, 'constants_sha256')) {
      if (!verified.has(row.date)) {
        throw new Error(row.date + ': no constants_sha256 and no verifiedPostHashRows provenance');
      }
      continue;
    }
    const stempel = row.constants_sha256;
    // (1) Kettenzugehoerigkeit
    if (!index.has(stempel)) {
      throw new Error(row.date + ': constants_sha256=' + String(stempel) + ' steht in keiner '
        + 'Changelog-Zeile der Registrierungs-Datei — der Stempel nennt einen Stand, den es nie '
        + 'gab. Bekannt sind ' + kette.length + ' Digests, zuletzt ' + kette[kette.length - 1].digest + '.');
    }
    const eintrag = zeiten.get(stempel);
    if (!eintrag) {
      throw new Error(row.date + ': keine Eintragungszeit fuer ' + stempel + ' — die Zeittafel '
        + 'passt nicht zur Kette.');
    }
    // (2) War der Stand beim Rechnen in main?
    const zeit = entryNotAfterGenerated(eintrag, row.generatedAt);
    if (!zeit.ok) {
      throw new Error(row.date + ': constants_sha256=' + stempel + ' war zum Zeitpunkt '
        + 'generatedAt nicht in main — ' + zeit.detail + '. Unter diesem Stand kann die Zeile '
        + 'nicht gerechnet worden sein.');
    }
    if (!zeit.verified) unverified.push({ date: row.date, detail: zeit.detail });
    // (3) Monotonie
    const i = index.get(stempel);
    if (i < hoechsterIndex) {
      throw new Error(row.date + ': der Stempel laeuft rueckwaerts — ' + stempel + ' steht an '
        + 'Kettenstelle ' + i + ', eine fruehere Zeile stand schon auf ' + hoechsterIndex
        + '. Die Reihe darf nicht auf einen aelteren Konstanten-Stand zurueckfallen.');
    }
    hoechsterIndex = i;
    stamped++;
  }
  return { checked: nachHash.length, stamped, unverified };
}

module.exports = {
  CHANGELOG_ZEILE, DATUM, ZEITPUNKT_MIT_ZONE,
  digestChain, derivationBlocker, gitEntryEvents, entryTimes, presentAt, effectiveAdd,
  etOffsetMs, closeOfTradingDayUTC, parseGeneratedAt, entryNotAfterGenerated, afterClose,
  stampFields, assertStampedRows,
};
