#!/usr/bin/env node
'use strict';
/**
 * scripts/exit-event-resolver.js — deterministischer Terminal-Ereignis-Aufloeser.
 *
 * AUFTRAG: ENTSCHIED 52 (Baustein aus ENTSCHIED 49), Spezifikation ist die
 * Fallen-Sektion §4.3 und die Ereignis-Sektion §6 des Machbarkeitsberichts
 * `s0-filing-machbarkeit-2026-08-30.md` (Vault agent-reports).
 *
 * WAS ES TUT: CIK + Datumsfenster -> EIN Terminal-Ereignis mit Beleg.
 *   { cik, eventType, eventDate, terminalValue|null, valueBasis,
 *     evidence[], confidence, unresolvedReason? }
 *
 * WAS ES AUSDRUECKLICH NICHT TUT (Auftragsgrenze, nicht Bequemlichkeit):
 *   - KEINE Integration in irgendeine Pipeline. Standalone-Werkzeug. Ob und wie
 *     ein Label daraus wird, entscheidet das Gericht / eine Praeregistrierung
 *     (Form-25-Label-Urteil _COURT-FORM25-LABEL-2026-08-30.md: Form 25 ist NICHT
 *     "Tod"; Shumway -30 % auf eine Uebernahme mit Praemie dreht das Vorzeichen).
 *   - KEIN Siegel, KEIN Ledger, KEIN Register-Eintrag, kein Schreiben in
 *     Studiendaten. Der Aufloeser liest, er urteilt nicht.
 *
 * ── DIE ZWEI EBENEN (§6, zweitwichtigster Befund) ─────────────────────────────
 * Ereignis und Wert sind unterschiedlich schwer, deshalb sind sie hier getrennt:
 *
 *  EREIGNIS  ist durchweg deterministisch und kommt AUSSCHLIESSLICH aus
 *            strukturierten Feldern: Formtyp (25 / 25-NSE / 15-12B / 15-12G),
 *            8-K-Item-Codes (1.03 / 2.01 / 3.01 / 3.03 / 5.01) und Datum.
 *            NIE aus Textdeutung. `eventType` traegt darum auch NICHT die
 *            Gegenleistungsform — bar oder Tausch steht nicht im Item-Code.
 *
 *  WERT      zerfaellt in drei Regime und wird in `valueBasis` benannt:
 *            Barfusion  -> extrahierbar, aber nur aus dem EREIGNIS-Dokument
 *                          bzw. der daran verankerten Vorlage.
 *            Insolvenz  -> 0 PER REGEL (Plan-Wirksamkeit + Item 3.03).
 *                          NIE Extraktion — die Null steht in keinem Dokument.
 *            Aktientausch -> aus SEC-Dokumenten GRUNDSAETZLICH nicht bestimmbar
 *                          (der Erwerberkurs ist ein Marktdatum). Das
 *                          Umtauschverhaeltnis wird woertlich mitgefuehrt.
 *
 * ── DIE VIER FAIL-CLOSED-FALLEN (§4.3 + §A.5) ────────────────────────────────
 * Alle vier haben im Machbarkeitslauf live zugeschlagen und haetten plausibel
 * aussehende FALSCHE Zahlen produziert. Jede hat hier einen benannten Waechter;
 * jeder Waechter ist in tests/exit-event-resolver.test.js einmal absichtlich
 * gebrochen und rot gesehen worden.
 *
 *  FALLE 1  SLIM_CACHE_GUARD — <cache>/submissions/CIK*.json traegt NUR
 *           cik/sic/tickers, `filings` ist leer. Wer ihn liest, bekommt keinen
 *           Fehler, sondern "diese Firma hat nie etwas eingereicht". Hier: ein
 *           Submissions-Objekt ohne `filings.recent.form` ist ein FEHLER, nie
 *           ein leeres Ergebnis.
 *  FALLE 2  ARCHIVE_BLOCK_GUARD — `filings.recent` traegt nur die ~1000
 *           juengsten Einreichungen; bei vielreichenden Firmen (ATVI: 2.043)
 *           liegen aeltere in `filings.files[]`. Hier: JEDER deklarierte Block
 *           wird geladen; ein fehlender Block ist ein Fehler, keine stille Null.
 *  FALLE 3  EVENT_ANCHOR_GUARD (Anti-Vivendi) — "erste passende Vorlage" liefert
 *           fuer ATVI die DEFM14A von 2008 mit $27,50 (Vivendi-Deal) statt der
 *           von 2022 mit $95,00. Hier: die Wert-Vorlage wird an das EREIGNIS-
 *           Datum gebunden (juengste Vorlage VOR dem Ereignis, innerhalb eines
 *           festen Rueckblickfensters), nie an die Reihenfolge im Array.
 *  FALLE 4  ISSUER_DOCS_GUARD (FRC-Klasse) — First Republic hat als
 *           §12(i)-Bank NIE 10-K/10-Q/8-K/Form 25 bei der SEC eingereicht; EDGAR
 *           traegt fuer CIK 1132979 nur Dritt-Einreichungen (SC 13G etc.).
 *           Hier: ehrliches NICHT-AUFLOESBAR mit eigener Ursachenklasse, nie
 *           "Ereignis unbekannt" und niemals ein erfundener Wert.
 *
 * Zusaetzlich, aus derselben Sektion:
 *  PAR_VALUE_GUARD  — die naive Preis-Regex liefert bei XLNX $0,01: das ist der
 *           NENNWERT ("par value $0.01 per share"), nicht der Terminalwert.
 *           Jeder Betrag in Nennwert-Kontext wird verworfen.
 *  DOMINANCE_GUARD  — der Terminalpreis ist im Ankerdokument haeufigkeits-
 *           dominant (TWTR 29:1, ATVI 6:2). Ohne Dominanz: NICHT bestimmbar
 *           statt raten.
 *  SOURCE_AGREEMENT_GUARD — liegen 8-K UND verankerte Vorlage vor und nennen
 *           verschiedene Preise, ist das ein Konflikt, kein Mehrheitsentscheid.
 *
 * Quellenreihenfolge: lokaler submissions.zip-Bestand ZUERST (kein Netz), EDGAR
 * nur fuer die Dokumente der Wert-Seite, hoeflich (~3 Abrufe/s, kontakttragender
 * User-Agent aus SEC_CONTACT, nie hartkodiert) mit Plattencache.
 *
 * Usage:
 *   SEC_CONTACT="Name screener-data mail@example.com" \
 *     node scripts/exit-event-resolver.js --cik 1418091 --from 2022-01-01 --to 2022-12-31
 *   node scripts/exit-event-resolver.js --cik 718877 --from 2023-01-01 --to 2023-12-31 --json
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const secPit = require('../lib/sec-pit.js');
const { assertSecContact } = require('../lib/sec-user-agent.js');
const { fetchBuffer } = require('../lib/fetch-retry.js');
const { RATE_DELAY_MS } = require('../lib/sec-rate-limit.js');

// ── Konstanten, alle benannt (keine Magic Numbers im Ablauf) ─────────────────

/** Der Delisting-Anker. NUR diese Formen beenden eine Notierung strukturiert. */
const ANCHOR_FORMS_STRONG = Object.freeze(['25', '25-NSE']);
/** Schwacher Anker: Abmeldung der Registrierung, wenn keine Form 25 vorliegt. */
const ANCHOR_FORMS_WEAK = Object.freeze(['15-12B', '15-12G']);

/** Vollmacht-/Vorlage-Formen, aus denen ein Barpreis stammen darf. */
const VALUE_TEMPLATE_FORMS = Object.freeze(['DEFM14A', 'DEFM14C']);

/**
 * Emittenten-Berichte. Ein CIK, der KEINE einzige davon traegt, ist die
 * FRC-Klasse: die Firma berichtet nicht an die SEC (§12(i)-Banken laufen ueber
 * die Bankaufsicht). Dritt-Einreichungen (SC 13G/13D, 40-6B) zaehlen NICHT —
 * sie sagen etwas ueber Aktionaere, nichts ueber den Emittenten.
 */
const ISSUER_FORM_PREFIXES = Object.freeze([
  '10-K', '10-Q', '8-K', '20-F', '40-F', '6-K', 'S-1', 'S-3', 'S-4', 'S-8',
  'DEF 14A', 'DEFM14A', 'DEFM14C', 'DEFA14A', 'PREM14A', 'PRE 14A', 'DEF 14C',
  '25', '25-NSE', '15-12B', '15-12G', '11-K', '424B', 'ARS', 'NT 10-K', 'NT 10-Q',
]);

/** 8-K-Item-Codes, die den Ereignistyp tragen. Strukturiertes Feld, kein Text. */
const ITEM_BANKRUPTCY = '1.03';        // Bankruptcy or Receivership
const ITEM_COMPLETION = '2.01';        // Completion of Acquisition or Disposition
const ITEM_DELISTING_NOTICE = '3.01';  // Notice of Delisting
const ITEM_RIGHTS_MODIFIED = '3.03';   // Material Modification to Rights of Security Holders
const ITEM_CONTROL_CHANGE = '5.01';    // Changes in Control of Registrant

/**
 * Wie weit um den Delisting-Anker herum ein 8-K noch zum selben Ereignis gehoert.
 * Grosszuegig, weil die Reihenfolge real streut: BBBY reicht das Insolvenz-8-K
 * 77 Tage VOR und das Plan-Wirksamkeits-8-K 81 Tage NACH der Form 25 ein.
 * Enger gesetzt wuerde genau der Beleg wegfallen, auf dem die Null-Regel steht.
 */
const EVENT_WINDOW_DAYS = 180;

/**
 * Rueckblick fuer die Wert-Vorlage (FALLE 3). Eine Fusions-Vollmacht liegt
 * Monate, nie Jahre vor dem Vollzug: TWTR 97 Tage, ATVI 571 Tage, XLNX 346 Tage.
 * 36 Monate lassen jeden realen Fall durch und schliessen den Vivendi-Deal von
 * 2008 (5.608 Tage vor dem Delisting 2023) unabhaengig vom Sortier-Waechter aus.
 * ZWEI unabhaengige Sperren gegen dieselbe Falle — bewusst, nicht doppelt gemoppelt.
 */
const TEMPLATE_LOOKBACK_DAYS = 1096;

/** Haeufigkeits-Dominanz im Ankerdokument (DOMINANCE_GUARD). */
const DOMINANCE_FACTOR = 2;

const EDGAR_HOST = 'https://www.sec.gov';

// ── Ergebnis-Vokabular ───────────────────────────────────────────────────────
const EventType = Object.freeze({
  MERGER: 'MERGER',                 // Item 2.01 und/oder 5.01 am Anker
  INSOLVENCY: 'INSOLVENCY',         // Item 1.03 am Anker
  DELISTING_ONLY: 'DELISTING_ONLY', // Anker ohne erklaerendes 8-K
  UNRESOLVED: 'UNRESOLVED',
});
const ValueBasis = Object.freeze({
  CASH_FROM_8K: 'CASH_MERGER_PRICE_FROM_EVENT_8K',
  CASH_FROM_TEMPLATE: 'CASH_MERGER_PRICE_FROM_ANCHORED_DEFM14A',
  CASH_FROM_BOTH: 'CASH_MERGER_PRICE_8K_AND_DEFM14A_AGREE',
  STOCK_NOT_DETERMINABLE: 'STOCK_MERGER_NICHT_BESTIMMBAR_AUS_SEC',
  INSOLVENCY_ZERO_BY_RULE: 'INSOLVENCY_ZERO_BY_RULE',
  NOT_RESOLVABLE: 'NICHT_AUFLOESBAR',
});
const Unresolved = Object.freeze({
  NO_ISSUER_DOCS: 'KEINE_EMITTENTEN_DOKUMENTE_BEI_SEC',
  NO_ANCHOR: 'KEIN_DELISTING_ANKER_IM_FENSTER',
  STOCK_MERGER: 'AKTIENTAUSCH_ERWERBERKURS_IST_MARKTDATUM',
  NO_PRICE: 'KEIN_DOMINANTER_BARPREIS_IM_ANKERDOKUMENT',
  PRICE_CONFLICT: 'WERTKONFLIKT_ZWISCHEN_8K_UND_VORLAGE',
  NO_PLAN_EVIDENCE: 'INSOLVENZ_OHNE_PLAN_WIRKSAMKEITS_BELEG',
  NO_EVENT_DOC: 'KEIN_EREIGNIS_DOKUMENT_ABRUFBAR',
});

// ── Datums-Arithmetik (reine Kalenderrechnung, keine Zeitzonen) ──────────────
const MS_DAY = 86400000;
function days(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / MS_DAY); }

// ── Stufe 1: Einreichungen lesen (FALLE 1 + FALLE 2) ─────────────────────────

/** Nur Kanonisches nach vorn, damit Filter am Objekt greifen statt an Strings. */
function toRows(arrays, cik) {
  const out = [];
  if (!arrays || !Array.isArray(arrays.form)) return out;
  for (let i = 0; i < arrays.form.length; i++) {
    out.push({
      cik: Number(cik),
      form: arrays.form[i],
      filingDate: arrays.filingDate ? arrays.filingDate[i] : null,
      accessionNumber: arrays.accessionNumber ? arrays.accessionNumber[i] : null,
      primaryDocument: arrays.primaryDocument ? (arrays.primaryDocument[i] || null) : null,
      items: arrays.items ? (arrays.items[i] || '') : '',
      acceptanceDateTime: arrays.acceptanceDateTime ? (arrays.acceptanceDateTime[i] || null) : null,
    });
  }
  return out;
}

const SUBMISSIONS_API = 'https://data.sec.gov/submissions/';

/**
 * Quelle der Einreichungen, in dieser Reihenfolge:
 *   1. `submissionsDir` — ein entpackter Bestand bzw. Fixtures (kein Netz).
 *   2. lokaler `submissions.zip`-Bulk — der Auftragsweg "Bulk zuerst".
 *   3. EDGAR `submissions`-API, hoeflich, mit Plattencache.
 *
 * Zu 2: der Bulk traegt ~988.000 Eintraege; ein UNGEFILTERTER Zip-Index kostet
 * mehrere hundert MB Heap. Der dafuer noetige Namensfilter (`openStore(zip,
 * {entryFilter})` + `readEntryByName`) liegt im D2-Strang und ist auf origin/main
 * noch nicht gemergt. Statt ihn hier vorwegzunehmen oder blind zu benutzen, wird
 * er FEATURE-GEPRUEFT — und die Kette faellt LAUT auf EDGAR zurueck, mit
 * Begruendung auf stderr. Ein stiller Rueckfall waere genau die Fehlerklasse,
 * gegen die dieses Werkzeug gebaut ist.
 */
function openSubmissionsSource({ zipPath, submissionsDir, docCacheDir, offline } = {}) {
  if (submissionsDir) {
    return {
      origin: 'dir:' + submissionsDir,
      readEntry(name) {
        const p = path.join(submissionsDir, name);
        return fs.existsSync(p) ? fs.readFileSync(p) : null;
      },
      close() {},
    };
  }
  const zp = zipPath || path.join(secPit.CACHE_DIR, 'submissions-bulk', 'submissions.zip');
  if (fs.existsSync(zp)) {
    // Die Pruefung liest den QUELLTEXT von openStore, statt sie probeweise
    // AUFZURUFEN: ein Probeaufruf ohne Namensfilter baut genau den Voll-Index
    // ueber ~988.000 Eintraege auf, den die Pruefung vermeiden soll — die Probe
    // waere teurer als die Sache. Faellt die Introspektion falsch aus, ist die
    // Folge harmlos: EDGAR statt Bulk, gleiche Daten, nur langsamer.
    const kannFiltern = /entryFilter/.test(String(secPit.openStore));
    let store = null;
    if (kannFiltern) {
      try {
        store = secPit.openStore(zp, { entryFilter: (n) => /^CIK\d{10}(?:-submissions-\d+)?\.json$/.test(n) });
        if (typeof store.readEntryByName !== 'function') { store.close(); store = null; }
      } catch (e) { store = null; }
    }
    if (store) return { origin: 'bulk:' + zp, readEntry: (n) => store.readEntryByName(n), close: () => store.close() };
    process.stderr.write('[exit-event-resolver] HINWEIS: ' + zp + ' liegt vor, aber lib/sec-pit.js '
      + 'traegt (noch) keinen gefilterten Namenszugriff (openStore({entryFilter}) + readEntryByName). '
      + 'Ohne ihn kostet der Bulk-Index mehrere hundert MB fuer nichts. Rueckfall auf die '
      + 'EDGAR-submissions-API — langsamer, gleiche Daten, KEIN stiller Ausfall.\n');
  }
  if (offline) {
    throw new Error('[exit-event-resolver] Keine lokale Quelle nutzbar und --offline gesetzt: '
      + 'weder --submissions-dir noch ein lesbarer submissions.zip-Bulk.');
  }
  return openEdgarSubmissionsSource({ docCacheDir });
}

/** EDGAR-submissions-API als Rueckfall. Hoeflich, mit Plattencache. */
function openEdgarSubmissionsSource({ docCacheDir } = {}) {
  const dir = docCacheDir || path.join(secPit.CACHE_DIR, 'exit-event-submissions');
  const ua = assertSecContact();
  return {
    origin: 'edgar:' + SUBMISSIONS_API,
    async readEntry(name) {
      fs.mkdirSync(dir, { recursive: true });
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return fs.readFileSync(p);
      let r;
      try {
        r = await fetchBuffer(SUBMISSIONS_API + name, {
          headers: { 'User-Agent': ua },
          pauseMs: Math.max(RATE_DELAY_MS * 2, 250),
        });
      } catch (e) {
        // 404 = der Eintrag existiert nicht. Die Waechter oben deuten das —
        // hier wird NICHT entschieden, ob "kein Eintrag" ein Ergebnis ist.
        if (/HTTP 404/.test(e.message)) return null;
        throw e;
      }
      const body = decoded(r);
      fs.writeFileSync(p, body);
      return body;
    },
    close() {},
  };
}

/**
 * node:https dekomprimiert NICHT von selbst. data.sec.gov liefert je nach Pfad
 * gzip — ein ungepacktes JSON.parse darauf wirft einen kryptischen SyntaxError
 * (live passiert). Entpackt wird darum am Content-Encoding, nicht auf Verdacht.
 */
function decoded(res) {
  const enc = String((res.headers && res.headers['content-encoding']) || '').toLowerCase();
  if (enc === 'gzip') return zlib.gunzipSync(res.body);
  if (enc === 'deflate') return zlib.inflateSync(res.body);
  if (enc === 'br') return zlib.brotliDecompressSync(res.body);
  return res.body;
}

/**
 * Alle Einreichungen eines CIK — `filings.recent` PLUS jeden deklarierten
 * Archivblock. Wirft laut bei Slim-Cache (FALLE 1) und bei fehlendem
 * Archivblock (FALLE 2). Gibt NIE eine leere Liste zurueck, um ein Leseproblem
 * zu verbergen.
 */
async function loadFilings(cik, opts = {}) {
  const { source } = opts;
  const src = source || openSubmissionsSource(opts);
  const owns = !source;
  try {
    const base = 'CIK' + String(cik).padStart(10, '0');
    const buf = await src.readEntry(base + '.json');
    if (!buf) {
      throw new Error('[exit-event-resolver] ISSUER_DOCS_GUARD: kein submissions-Objekt fuer CIK '
        + cik + ' im Bestand. Das ist ein Bestandsproblem, kein Messergebnis.');
    }
    const sub = JSON.parse(buf.toString('utf8'));

    // FALLE 1 — SLIM_CACHE_GUARD. Der Schlank-Cache <cache>/submissions/ traegt
    // nur cik/sic/tickers. Ein Objekt ohne filings.recent.form ist ein FEHLER,
    // niemals "diese Firma hat nie eingereicht".
    const recent = sub.filings && sub.filings.recent;
    if (!recent || !Array.isArray(recent.form)) {
      throw new Error('[exit-event-resolver] SLIM_CACHE_GUARD: submissions-Objekt fuer CIK ' + cik
        + ' traegt kein filings.recent.form. Das ist die Schlank-Cache-Form '
        + '(nur cik/sic/tickers) — sie wuerde still "0 Einreichungen" bedeuten. '
        + 'Gelesen werden muss der Voll-Bestand (submissions.zip / EDGAR submissions-API).');
    }

    let rows = toRows(recent, sub.cik != null ? sub.cik : cik);
    const blocks = (sub.filings && sub.filings.files) || [];
    const blocksConsulted = [];
    for (const b of blocks) {
      // FALLE 2 — ARCHIVE_BLOCK_GUARD. filings.recent traegt nur die ~1000
      // juengsten Einreichungen. Bei ATVI (2.043) liegt die Vivendi-Vorlage von
      // 2008 im Block; ohne ihn faende der Aufloeser sie nicht — und ein Aufruf
      // fuer ein Fenster VOR der recent-Kante saehe schlicht nichts.
      const bbuf = await src.readEntry(b.name);
      if (!bbuf) {
        throw new Error('[exit-event-resolver] ARCHIVE_BLOCK_GUARD: Archivblock ' + b.name
          + ' ist deklariert (' + b.filingFrom + '..' + b.filingTo + ', ' + b.filingCount
          + ' Einreichungen), aber nicht lesbar. Ohne ihn traegt das Ergebnis eine '
          + 'stille Luecke — Abbruch statt Teilmessung.');
      }
      const parsed = JSON.parse(bbuf.toString('utf8'));
      // Blockdateien tragen die Arrays direkt (kein filings-Wrapper).
      rows = rows.concat(toRows(parsed.filings ? parsed.filings.recent : parsed, sub.cik != null ? sub.cik : cik));
      blocksConsulted.push(b.name);
    }
    rows.sort((a, b) => (a.filingDate < b.filingDate ? -1 : a.filingDate > b.filingDate ? 1 : 0));
    return { cik: Number(cik), name: sub.name || null, rows, blocksConsulted, blocksDeclared: blocks.length };
  } finally {
    if (owns) src.close();
  }
}

/** FALLE 4 — ISSUER_DOCS_GUARD. Traegt der CIK ueberhaupt Emittenten-Berichte? */
function hasIssuerDocs(rows) {
  return rows.some((r) => ISSUER_FORM_PREFIXES.some((p) => r.form === p || r.form.startsWith(p + '/')
    || (p === '424B' && r.form.startsWith('424B'))));
}

// ── Stufe 2: Ereignis (nur strukturierte Felder) ─────────────────────────────

function hasItem(row, code) {
  return String(row.items || '').split(/\s*,\s*/).includes(code);
}
const inWindow = (d, from, to) => !!d && d >= from && d <= to;

/**
 * Delisting-Anker: die JUENGSTE Form 25/25-NSE im Fenster (§A.5 nennt "Anker auf
 * der aeltesten statt juengsten Einreichung" als behobenen Messfehler). Ohne
 * starke Form: 15-12B/15-12G als schwacher Anker mit Konfidenz-Abschlag.
 */
function findAnchor(rows, from, to) {
  const pick = (forms) => rows.filter((r) => forms.includes(r.form) && inWindow(r.filingDate, from, to))
    .sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1))[0] || null;
  const strong = pick(ANCHOR_FORMS_STRONG);
  if (strong) return { row: strong, strength: 'strong' };
  const weak = pick(ANCHOR_FORMS_WEAK);
  if (weak) return { row: weak, strength: 'weak' };
  return null;
}

/**
 * Ereignistyp aus Formtyp + Item-Codes + Datum. KEINE Textdeutung.
 * Insolvenz schlaegt Fusion: ein Item 1.03 am selben Anker ist eindeutig, ein
 * Item 2.01 daneben waere der Verkauf von Vermoegen IM Verfahren.
 */
function classifyEvent(rows, anchor) {
  const near = rows.filter((r) => r.form === '8-K' && r.filingDate
    && Math.abs(days(anchor.row.filingDate, r.filingDate)) <= EVENT_WINDOW_DAYS);

  const bankruptcy = near.filter((r) => hasItem(r, ITEM_BANKRUPTCY))
    .sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1));
  if (bankruptcy.length) {
    // Wert-Beleg: Plan-Wirksamkeit zeigt sich strukturell als 8-K, das 1.03 UND
    // 3.03 traegt (Eigenkapitalrechte erloschen). Fehlt es, bleibt der Wert offen.
    const planEffective = bankruptcy.find((r) => hasItem(r, ITEM_RIGHTS_MODIFIED)) || null;
    return {
      eventType: EventType.INSOLVENCY,
      eventDate: (planEffective || bankruptcy[0]).filingDate,
      eventRows: planEffective ? [planEffective, bankruptcy[bankruptcy.length - 1]] : [bankruptcy[0]],
      planEffective,
    };
  }

  const completion = near.filter((r) => hasItem(r, ITEM_COMPLETION) || hasItem(r, ITEM_CONTROL_CHANGE))
    .sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1));
  if (completion.length) {
    return { eventType: EventType.MERGER, eventDate: completion[0].filingDate, eventRows: [completion[0]], planEffective: null };
  }

  const notice = near.filter((r) => hasItem(r, ITEM_DELISTING_NOTICE));
  return {
    eventType: EventType.DELISTING_ONLY,
    eventDate: anchor.row.filingDate,
    eventRows: notice.length ? [notice[0]] : [],
    planEffective: null,
  };
}

/**
 * FALLE 3 — EVENT_ANCHOR_GUARD (Anti-Vivendi).
 * Die Wert-Vorlage ist die JUENGSTE Vorlage VOR dem Ereignis innerhalb des
 * Rueckblickfensters — nie die erste im Array, nie die aelteste.
 * Fuer ATVI stehen 2008-06-06 ($27,50, Vivendi) und 2022-03-21 ($95,00) zur
 * Wahl; die Sortierung waehlt 2022, das Rueckblickfenster schliesst 2008
 * zusaetzlich unabhaengig aus.
 */
function pickValueTemplate(rows, eventDate, { forms = VALUE_TEMPLATE_FORMS, lookbackDays = TEMPLATE_LOOKBACK_DAYS } = {}) {
  const candidates = rows.filter((r) => forms.includes(r.form) && r.filingDate && r.filingDate <= eventDate);
  const inLookback = candidates.filter((r) => days(r.filingDate, eventDate) <= lookbackDays);
  const chosen = inLookback.sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1))[0] || null;
  return { chosen, candidates, rejected: candidates.filter((r) => r !== chosen) };
}

// ── Stufe 3: Wert ────────────────────────────────────────────────────────────

function plainText(raw) {
  return String(raw)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#\d+;|&[a-z]+;/g, "'")
    .replace(/\s+/g, ' ');
}

/**
 * Aktientausch-Erkennung. Sie laeuft VOR jeder Preis-Extraktion und ist damit
 * der benannte Waechter gegen die XLNX-Nennwert-Falle: das einzige "$"-Muster
 * im Xilinx-8-K ist "par value $0.01 per share" (der Nennwert der AMD-Aktie),
 * eine naive Regex haette daraus einen Terminalwert von 1 Cent gemacht.
 *
 * BEWUSST NICHT auf die Wortmarke "Exchange Ratio" gestuetzt: die steht auch in
 * reinen Barfusionen (ATVI-8-K: 3 Vorkommen, betrifft die Umrechnung von
 * Mitarbeiter-Aktienrechten). Gebunden wird an die GEGENLEISTUNGS-Aussage —
 * "converted into the right to receive N.NNNN shares".
 */
function detectExchangeRatio(text) {
  const re = /(?:right to receive|converted into|convert(?:ed|ible)? into the right to receive)[^.;]{0,160}?\b(\d+(?:\.\d{2,6})?)\s+shares\b/i;
  const m = re.exec(text);
  if (!m) return null;
  const start = Math.max(0, m.index);
  return { ratio: m[1], verbatim: text.slice(start, Math.min(text.length, m.index + m[0].length + 120)).trim() };
}

/**
 * Barpreis je Aktie aus einem Dokument. Zwei Waechter:
 *  PAR_VALUE_GUARD  — jeder Betrag im Nennwert-Kontext faellt raus.
 *  DOMINANCE_GUARD  — der Sieger muss den Zweitplatzierten um Faktor 2 schlagen.
 * Zwei Muster-Stufen: "in cash" ist die Gegenleistungs-Formel, "per share"
 * die schwaechere Rueckfallebene. Stufe 2 wird nur betrachtet, wenn Stufe 1
 * leer bleibt — sonst gewinnen Bewertungs-Tabellen gegen die Gegenleistung.
 */
function extractCashPrice(rawText) {
  const t = plainText(rawText);
  const tiers = [
    /\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)(?:[^.$;]{0,40}?)\bin\s+cash\b/gi,
    /\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:\([^)]{0,40}\)\s*)?per\s+share\b/gi,
  ];
  let parRejected = 0;   // ueber alle Stufen gezaehlt: der PAR_VALUE_GUARD muss
                         // im Ergebnis SICHTBAR sein, sonst feuert er still.
  for (let tier = 0; tier < tiers.length; tier++) {
    const counts = new Map();
    let m;
    const re = tiers[tier];
    re.lastIndex = 0;
    while ((m = re.exec(t)) !== null) {
      const ctx = t.slice(Math.max(0, m.index - 110), m.index + 110);
      // PAR_VALUE_GUARD — "common stock, par value $0.01 per share".
      if (/par\s+value/i.test(ctx)) { parRejected++; continue; }
      const value = Number(m[1].replace(/,/g, ''));
      if (!Number.isFinite(value) || value <= 0) continue;
      const e = counts.get(value) || { value, hits: 0, sample: null };
      e.hits++;
      if (!e.sample) e.sample = ctx.trim();
      counts.set(value, e);
    }
    const ranked = [...counts.values()].sort((a, b) => b.hits - a.hits);
    if (!ranked.length) continue;
    const [best, runnerUp] = ranked;
    // DOMINANCE_GUARD — ohne klare Dominanz lieber nichts als eine plausible Zahl.
    if (runnerUp && best.hits < runnerUp.hits * DOMINANCE_FACTOR) {
      return { value: null, reason: Unresolved.NO_PRICE, tier, parRejected, ranked: ranked.slice(0, 3) };
    }
    return { value: best.value, hits: best.hits, runnerUpHits: runnerUp ? runnerUp.hits : 0, tier, parRejected, sample: best.sample };
  }
  return { value: null, reason: Unresolved.NO_PRICE, tier: null, parRejected, ranked: [] };
}

// ── Dokument-Abruf: EDGAR, hoeflich, mit Plattencache ────────────────────────

function edgarDocUrl(cik, accessionNumber, doc) {
  return EDGAR_HOST + '/Archives/edgar/data/' + Number(cik) + '/'
    + String(accessionNumber).replace(/-/g, '') + '/' + doc;
}

function makeEdgarFetcher({ cacheDir } = {}) {
  const dir = cacheDir || path.join(secPit.CACHE_DIR, 'exit-event-docs');
  const ua = assertSecContact();
  return async function fetchDoc(cik, accessionNumber, doc) {
    fs.mkdirSync(dir, { recursive: true });
    const key = String(accessionNumber).replace(/-/g, '') + '_' + String(doc).replace(/[^\w.-]/g, '_');
    const p = path.join(dir, key);
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    const r = await fetchBuffer(edgarDocUrl(cik, accessionNumber, doc), {
      headers: { 'User-Agent': ua },
      pauseMs: Math.max(RATE_DELAY_MS * 2, 250),
    });
    const body = decoded(r).toString('utf8');
    fs.writeFileSync(p, body);
    return body;
  };
}

/** Liest Fixture-Dokumente aus einem Ordner (hermetische Tests, kein Netz). */
function makeDirFetcher(dir) {
  return async function fetchDoc(_cik, accessionNumber, doc) {
    const key = String(accessionNumber).replace(/-/g, '') + '_' + String(doc).replace(/\.html?$/i, '') + '.txt';
    const p = path.join(dir, key);
    if (!fs.existsSync(p)) throw new Error('Fixture-Dokument fehlt: ' + p);
    return fs.readFileSync(p, 'utf8');
  };
}

// ── Stufe 4: Auflösung ───────────────────────────────────────────────────────

const ev = (row, role) => ({
  role,
  form: row.form,
  filingDate: row.filingDate,
  accession: row.accessionNumber,
  doc: row.primaryDocument,
  items: row.items || null,
});

function unresolved(cik, reason, evidence, extra) {
  return Object.assign({
    cik: Number(cik),
    eventType: EventType.UNRESOLVED,
    eventDate: null,
    terminalValue: null,
    valueBasis: ValueBasis.NOT_RESOLVABLE,
    evidence: evidence || [],
    confidence: 0,
    unresolvedReason: reason,
  }, extra || {});
}

/**
 * Loest EIN Terminal-Ereignis auf.
 * @param {number} cik
 * @param {string} from ISO-Datum
 * @param {string} to   ISO-Datum
 * @param {object} [opts] { fetchDoc, source, zipPath, submissionsDir, crossCheck }
 */
async function resolveExitEvent(cik, from, to, opts = {}) {
  const { rows, name, blocksConsulted, blocksDeclared } = await loadFilings(cik, opts);

  // FALLE 4 — ISSUER_DOCS_GUARD, vor allem anderen: bei der FRC-Klasse ist jede
  // weitere Aussage eine Erfindung.
  if (!hasIssuerDocs(rows)) {
    return unresolved(cik, Unresolved.NO_ISSUER_DOCS, [], {
      companyName: name,
      note: 'EDGAR traegt fuer diesen CIK ausschliesslich Dritt-Einreichungen ('
        + [...new Set(rows.map((r) => r.form))].slice(0, 6).join(', ')
        + '). Kein Emittenten-Bericht — die Ereignis-Aufloesung aus SEC-Quellen ist '
        + 'strukturell unmoeglich, nicht bloss ergebnislos.',
      filingsSeen: rows.length,
      blocksConsulted,
    });
  }

  const anchor = findAnchor(rows, from, to);
  if (!anchor) {
    return unresolved(cik, Unresolved.NO_ANCHOR, [], {
      companyName: name,
      note: 'Keine Form 25/25-NSE und keine Form 15 im Fenster ' + from + '..' + to
        + '. Ein Item-2.01-8-K allein ist KEIN Terminal-Ereignis — es kann der '
        + 'Erwerb durch die Firma sein (ATVI 2008: Vivendi Games wurde in ATVI '
        + 'hineinfusioniert, ATVI blieb notiert).',
      filingsSeen: rows.length,
      blocksConsulted,
    });
  }

  const cls = classifyEvent(rows, anchor);
  const evidence = [ev(anchor.row, 'delisting-anchor')].concat(cls.eventRows.map((r) => ev(r, 'event-8k')));
  const base = {
    cik: Number(cik),
    companyName: name,
    eventType: cls.eventType,
    eventDate: cls.eventDate,
    anchorStrength: anchor.strength,
    blocksConsulted,
    blocksDeclared,
  };

  // ── Insolvenz: 0 PER REGEL, NIE Extraktion ────────────────────────────────
  // Hier wird bewusst KEIN Dokument abgerufen. Die Null steht in keinem Text;
  // sie folgt aus Plan-Wirksamkeit + Item 3.03 (Eigenkapitalrechte erloschen).
  if (cls.eventType === EventType.INSOLVENCY) {
    if (!cls.planEffective) {
      return Object.assign({}, base, {
        terminalValue: null,
        valueBasis: ValueBasis.NOT_RESOLVABLE,
        evidence,
        confidence: 0.4,
        unresolvedReason: Unresolved.NO_PLAN_EVIDENCE,
        note: 'Item 1.03 belegt das Verfahren, aber kein 8-K traegt 1.03 UND 3.03. '
          + 'Ohne Beleg der Plan-Wirksamkeit bleibt der Terminalwert offen — die '
          + 'Null-Regel wird nicht auf Verdacht angewandt.',
      });
    }
    return Object.assign({}, base, {
      terminalValue: 0,
      valueBasis: ValueBasis.INSOLVENCY_ZERO_BY_RULE,
      evidence,
      confidence: 0.85,
      note: 'Wert 0 PER REGEL, nicht per Extraktion: der bestaetigte Plan wurde '
        + 'wirksam (8-K ' + cls.planEffective.filingDate + ', Items ' + cls.planEffective.items
        + ') — Item 3.03 belegt das Erloeschen der Eigenkapitalrechte. Im Dokument '
        + 'steht dazu KEINE Zahl. Diese Regel braucht EINE juristische Validierung, '
        + 'danach ist sie universell; sie ist keine Messung.',
    });
  }

  if (cls.eventType === EventType.DELISTING_ONLY) {
    return Object.assign({}, base, {
      terminalValue: null,
      valueBasis: ValueBasis.NOT_RESOLVABLE,
      evidence,
      confidence: 0.3,
      unresolvedReason: Unresolved.NO_EVENT_DOC,
      note: 'Delisting belegt, Ursache nicht: kein 8-K mit Item 1.03/2.01/5.01 im '
        + 'Ereignisfenster. Form 25 allein ist KEIN Todes-Label (SMCI traegt '
        + '25-NSE @ 2019-03-12 und lebt).',
    });
  }

  // ── Fusion: Aktientausch zuerst, dann Barpreis ────────────────────────────
  const fetchDoc = opts.fetchDoc || makeEdgarFetcher(opts);
  const eventRow = cls.eventRows[0];
  if (!eventRow || !eventRow.primaryDocument) {
    return Object.assign({}, base, {
      terminalValue: null, valueBasis: ValueBasis.NOT_RESOLVABLE, evidence, confidence: 0.3,
      unresolvedReason: Unresolved.NO_EVENT_DOC,
    });
  }
  let eventText;
  try {
    eventText = await fetchDoc(eventRow.cik, eventRow.accessionNumber, eventRow.primaryDocument);
  } catch (e) {
    return Object.assign({}, base, {
      terminalValue: null, valueBasis: ValueBasis.NOT_RESOLVABLE, evidence, confidence: 0.3,
      unresolvedReason: Unresolved.NO_EVENT_DOC, note: 'Ereignis-Dokument nicht abrufbar: ' + e.message,
    });
  }
  const eventPlain = plainText(eventText);

  // XLNX-Waechter: Aktientausch schlaegt jede Preis-Extraktion. Kein Fall-through.
  const ratio = detectExchangeRatio(eventPlain);
  if (ratio) {
    return Object.assign({}, base, {
      terminalValue: null,
      valueBasis: ValueBasis.STOCK_NOT_DETERMINABLE,
      exchangeRatio: ratio.ratio,
      exchangeRatioVerbatim: ratio.verbatim,
      evidence,
      confidence: 0.95,          // das EREIGNIS ist sicher; der WERT ist es nie
      terminalValueConfidence: 0,
      unresolvedReason: Unresolved.STOCK_MERGER,
      note: 'Aktientausch erkannt. Der Terminalwert waere Umtauschverhaeltnis x '
        + 'Erwerberkurs — der Kurs ist ein MARKTDATUM und steht in keinem '
        + 'SEC-Dokument. Es wird KEIN Preis ausgegeben. Der einzige $-Betrag in '
        + 'diesem Dokument ist typischerweise der Nennwert ("par value $0.01 per '
        + 'share"); eine naive Regex haette daraus 1 Cent Terminalwert gemacht.',
    });
  }

  const fromEvent = extractCashPrice(eventPlain);

  // Verankerte Vorlage als Zweitquelle (FALLE 3 sitzt in pickValueTemplate).
  const tpl = pickValueTemplate(rows, cls.eventDate);
  let fromTemplate = null;
  if (tpl.chosen && opts.crossCheck !== false) {
    try {
      const tplText = await fetchDoc(tpl.chosen.cik, tpl.chosen.accessionNumber, tpl.chosen.primaryDocument);
      fromTemplate = extractCashPrice(tplText);
      evidence.push(Object.assign(ev(tpl.chosen, 'value-template'), {
        anchoredTo: cls.eventDate,
        rejectedTemplates: tpl.rejected.map((r) => r.filingDate + ' ' + r.form + ' ' + r.accessionNumber),
      }));
    } catch (_) { /* Vorlage optional — der 8-K-Pfad traegt allein. */ }
  }

  const a = fromEvent.value;
  const b = fromTemplate && fromTemplate.value;
  if (a != null && b != null && a !== b) {
    // SOURCE_AGREEMENT_GUARD — Konflikt ist kein Mehrheitsentscheid.
    return Object.assign({}, base, {
      terminalValue: null, valueBasis: ValueBasis.NOT_RESOLVABLE, evidence, confidence: 0.5,
      unresolvedReason: Unresolved.PRICE_CONFLICT,
      note: 'Ereignis-8-K nennt ' + a + ', die verankerte Vorlage ' + b + '. Zwei '
        + 'Primaerquellen widersprechen sich — hier wird nicht gewaehlt.',
    });
  }
  if (a != null) {
    return Object.assign({}, base, {
      terminalValue: a,
      valueBasis: b != null ? ValueBasis.CASH_FROM_BOTH : ValueBasis.CASH_FROM_8K,
      evidence,
      confidence: b != null ? 0.95 : 0.9,
      extraction: { hits: fromEvent.hits, runnerUpHits: fromEvent.runnerUpHits, tier: fromEvent.tier, parValueRejected: fromEvent.parRejected },
    });
  }
  if (b != null) {
    return Object.assign({}, base, {
      terminalValue: b,
      valueBasis: ValueBasis.CASH_FROM_TEMPLATE,
      evidence,
      confidence: 0.85,
      extraction: { hits: fromTemplate.hits, runnerUpHits: fromTemplate.runnerUpHits, tier: fromTemplate.tier, parValueRejected: fromTemplate.parRejected },
    });
  }
  return Object.assign({}, base, {
    terminalValue: null, valueBasis: ValueBasis.NOT_RESOLVABLE, evidence, confidence: 0.4,
    unresolvedReason: Unresolved.NO_PRICE,
    note: 'Fusion belegt, aber kein haeufigkeits-dominanter Barpreis (Nennwert-'
      + 'Treffer verworfen: ' + fromEvent.parRejected + '). Lieber ohne Wert als '
      + 'mit einem plausiblen falschen.',
  });
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) continue;
    a[m[1]] = m[2] !== undefined ? m[2] : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.cik || !a.from || !a.to) {
    console.error('Usage: node scripts/exit-event-resolver.js --cik <CIK> --from YYYY-MM-DD --to YYYY-MM-DD\n'
      + '         [--json] [--no-cross-check] [--offline] [--submissions-dir <dir>] [--zip <submissions.zip>]');
    process.exit(2);
  }
  const res = await resolveExitEvent(Number(a.cik), String(a.from), String(a.to), {
    crossCheck: !a['no-cross-check'],
    zipPath: a.zip || undefined,
    submissionsDir: a['submissions-dir'] || undefined,
    offline: !!a.offline,
  });
  if (a.json) { console.log(JSON.stringify(res, null, 2)); return; }
  console.log('CIK ' + res.cik + (res.companyName ? '  ' + res.companyName : ''));
  console.log('  eventType     ' + res.eventType + (res.eventDate ? '  @ ' + res.eventDate : ''));
  console.log('  terminalValue ' + (res.terminalValue === null ? 'null' : res.terminalValue));
  console.log('  valueBasis    ' + res.valueBasis);
  if (res.exchangeRatio) console.log('  exchangeRatio ' + res.exchangeRatio + '  (verbatim: ' + res.exchangeRatioVerbatim + ')');
  console.log('  confidence    ' + res.confidence);
  if (res.unresolvedReason) console.log('  unresolved    ' + res.unresolvedReason);
  for (const e of res.evidence) console.log('  evidence      [' + e.role + '] ' + e.filingDate + ' ' + e.form + ' ' + e.accession + ' ' + (e.doc || ''));
  if (res.note) console.log('  note          ' + res.note);
}

if (require.main === module) {
  main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}

module.exports = {
  resolveExitEvent, loadFilings, hasIssuerDocs, findAnchor, classifyEvent,
  pickValueTemplate, extractCashPrice, detectExchangeRatio, plainText,
  openSubmissionsSource, makeDirFetcher, makeEdgarFetcher, edgarDocUrl, toRows, hasItem,
  EventType, ValueBasis, Unresolved,
  ANCHOR_FORMS_STRONG, ANCHOR_FORMS_WEAK, VALUE_TEMPLATE_FORMS, ISSUER_FORM_PREFIXES,
  EVENT_WINDOW_DAYS, TEMPLATE_LOOKBACK_DAYS, DOMINANCE_FACTOR,
};
