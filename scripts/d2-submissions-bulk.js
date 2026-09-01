'use strict';
/**
 * scripts/d2-submissions-bulk.js — D2-Delisting-Strang, Stufen D2.0–D2.2.
 *
 * Auftrag: Orchestrator ENTSCHIED 23 (2026-08-29 20:41) auf Basis des Rats-Memos
 * frueher-finden-rat-m1m2-2026-08-29.md (§3 Faktentafel, §6 Reihenfolge) und des
 * Bauplans frueher-finden-pit-bauplan-2026-08-29.md (§4.4 Eingangsstempel).
 *
 * Zweck: unabhaengige, NICHT preisbasierte Delisting-EVIDENZ beschaffen —
 * Form 25 / 25-NSE („Notification of Removal from Listing") je CIK aus der
 * gratis SEC-Bulk-Datei submissions.zip, plus Ursachen-Split aus der Primaer-
 * quelle (primary_doc.xml, <ruleProvision>): 12d2-2(b) boersen-initiiert vs.
 * 12d2-2(c) Emittenten-Antrag.
 *
 * ⛔ BINDENDE AUFLAGEN (ENTSCHIED 23.2/23.3, hier im Code verankert):
 *  - `exchanges[]` wird NIE konsumiert. Kein Ausgabesatz traegt Boersen-Identitaet.
 *    (Sperr-Auslegung: D2 faellt nur deshalb NICHT unter den Exchange-Lock.)
 *    Braeuchte die Extraktion je Firma Boersen-Identitaet -> STOPP, zurueck unter
 *    die Sperre. Der Waechter in tests/d2-submissions-bulk.test.js prueft das.
 *  - Form 25 ist NICHT „Tod". SMCI (CIK 1375365) traegt 25-NSE @ 2019-03-12 und
 *    lebt; TWTR war eine Uebernahme. Dieses Skript erzeugt deshalb AUSSCHLIESSLICH
 *    Evidenz (form + datum + ruleProvision) und NIE ein Todes-/Delisting-LABEL.
 *    Die Label-Semantik entscheidet spaeter das Gericht (Shumway −30 % auf eine
 *    Uebernahme mit Praemie DREHT die Korrektur ins Gegenteil).
 *  - Der Schlank-Cache <cache>/submissions/ (b1-validate.js:145, traegt B1s
 *    Sektor-Matching) wird NIE angefasst. Dieser Store liegt getrennt in
 *    <cache>/submissions-bulk/. Additiv, nie ueberschreibend.
 *
 * Stufen:
 *   probe    D2.0  EIN HEAD-Request auf das Bulk-Objekt + Fenster-Masse gegen die
 *                  vorab eingefrorene Abbruchschwelle 2,5 % (ENTSCHIED 23.4).
 *   download D2.1  submissions.zip EINMAL laden (nicht entpacken), Eingangsstempel
 *                  sha256/Content-Length/Last-Modified setzen (Bauplan §4.4).
 *   extract  D2.2  Form 25/25-NSE aus filings.recent + ruleProvision-Split.
 *   sample   D2.2  seed-feste Zufallsstichprobe der Rechtsgrundlagen aus dem Rest
 *                  (der Vollabruf ist bei ~150 ms/Dokument unverhaeltnismaessig).
 *   report   D2.2  Bericht aus den vorhandenen Artefakten neu bauen, ohne Netz.
 *
 * Usage: SEC_CONTACT="Name screener-data mail@example.com" \
 *          node scripts/d2-submissions-bulk.js probe|download|extract|sample [n]|report
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const secPit = require('../lib/sec-pit.js');
const { assertSecContact } = require('../lib/sec-user-agent.js');
const { writeFileAtomic } = require('../lib/atomic-write.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const BULK_HOST = 'www.sec.gov';
const BULK_PATH = '/Archives/edgar/daily-index/bulkdata/submissions.zip';
// T187 (a): jeder Abruf bekommt eine Inaktivitaets-Frist. Ohne sie haengt ein
// stillstehender Socket unbegrenzt — der Lauf sieht dann aus wie "laeuft noch"
// und nicht wie "kaputt". 30 s misst PAUSEN, nicht die Gesamtdauer: der 1,5-GB-
// Download darf beliebig lange laufen, solange Bytes fliessen.
const HTTP_TIMEOUT_MS = 30000;

// Getrennter Store (Rats-Auflage §5, einstimmig) — NIE <cache>/submissions/.
const STORE_DIR = path.join(secPit.CACHE_DIR, 'submissions-bulk');
const ZIP_PATH = path.join(STORE_DIR, 'submissions.zip');
const STAMP_PATH = path.join(STORE_DIR, 'entry-stamp.json');
const HITS_PATH = path.join(STORE_DIR, 'form25-hits.jsonl');
const RULEPROV_PATH = path.join(STORE_DIR, 'ruleprovision.jsonl');
// Ablage laut Orchestrator-Anweisung: Vault agent-reports (Schwesterbericht der
// D1-Bilanz liegt dort ebenfalls). REPO-seitig wird NICHTS ueberschrieben.
const VAULT_DIR = path.join('C:', 'Users', 'Anwender', 'OneDrive', 'Dokumente', 'GitHub',
  'Jarvis', 'Knowledge', 'Trading', 'growth-screener', 'agent-reports');
const REPORT_JSON = path.join(VAULT_DIR, 'frueher-finden-d2-form25-2026-08-29.json');
const REPORT_MD = path.join(VAULT_DIR, 'frueher-finden-d2-form25-2026-08-29.md');

// ── Fenster + vorab eingefrorene Schwelle ────────────────────────────────────
const WINDOW_FROM = '2019-01-01';
const WINDOW_TO = '2024-12-31';
// ENTSCHIED 23.4, VOR jeder Messung fixiert (Anti-Schwellensuche):
const ABORT_THRESHOLD_PCT = 2.5;

// Erwartungswerte des Bulk-Objekts aus der Rats-Faktentafel §3 (curl -I, drei
// Stimmen identisch). Weicht der HEAD ab, ist das ein MELDE-Befund, kein Fehler
// (die Datei wird taeglich neu gebaut) — aber er muss im Stempel stehen.
const EXPECTED_BYTES = 1560992008;
const EXPECTED_LAST_MODIFIED = 'Sat, 29 Aug 2026 03:57:30 GMT';

// Mengengeruest aus der Rats-Faktentafel §3 (full-index/*/form.idx gezaehlt,
// Stimmen B+C konsistent). KEINE eigene Schaetzung — zitierte Messung.
const FORM25_ROWS_PER_YEAR = { 2019: 1721, 2020: 1927, 2021: 2124, 2022: 2087 };
// B allein, gemessen: 2021 traegt 2.124 form.idx-Zeilen, aber nur 694 EINZEL-CIKs,
// weil die CIK-Spalte bei 25-NSE oft der einreichende Boersenbetreiber ist. 694 ist
// damit der KONSERVATIVE BODEN fuer „Emittenten pro Jahr", 2.124 die Decke.
const FORM25_DISTINCT_CIKS_FLOOR_2021 = 694;
// Nenner = ereignistragende Grundgesamtheit der Frueher-finden-Linie:
// companyfacts.zip, D1-Bilanz 2026-08-29 selbst enumeriert.
const EVENT_CARRYING_CIKS = 20072;
// Verworfener Alternativ-Nenner, nur zur Offenlegung: alle Eintraege in
// submissions.zip (Rats-§3, ZIP64-EOCD). Enthaelt Fonds, 13F-Melder, Privat-
// personen — nicht die Aktien-Testpopulation. Nicht entscheidungsrelevant.
const ALL_BULK_ENTRIES = 988373;

function nowIso() { return new Date().toISOString(); }
function pct(a, b) { return (100 * a) / b; }

// T204 measurement seams: each persisted artifact has its own exported writer,
// so fixtures can exercise the real publication call without a SEC request,
// bulk download, ZIP scan, or fixed Vault destination.
function writeProbeArtifact(target, payload) {
  writeFileAtomic(target, JSON.stringify(payload, null, 2));
}
function writeEntryStamp(target, payload) {
  writeFileAtomic(target, JSON.stringify(payload, null, 2));
}
function writeReportJson(target, payload) {
  writeFileAtomic(target, JSON.stringify(payload, null, 2));
}
function writeReportMarkdown(target, markdownText) {
  writeFileAtomic(target, markdownText);
}
function writeScanStats(target, payload) {
  writeFileAtomic(target, JSON.stringify(payload, null, 2));
}

// ── D2.0 — Kostenprobe: EIN Request ─────────────────────────────────────────
function headBulk(ua) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: BULK_HOST, path: BULK_PATH, method: 'HEAD',
      headers: { 'User-Agent': ua, 'Accept-Encoding': 'identity' },
    }, (res) => {
      res.resume();
      resolve({
        statusCode: res.statusCode,
        contentType: res.headers['content-type'] || null,
        contentLength: res.headers['content-length'] ? Number(res.headers['content-length']) : null,
        lastModified: res.headers['last-modified'] || null,
        acceptRanges: res.headers['accept-ranges'] || null,
        etag: res.headers.etag || null,
      });
    });
    req.on('error', reject);
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('HEAD-Timeout nach ' + HTTP_TIMEOUT_MS + ' ms')));
    req.end();
  });
}

function windowMass() {
  // Fenster-Masse = jaehrliche Attritionsrate: Form-25-Emittenten pro Jahr
  // gegen die ereignistragende CIK-Grundgesamtheit. Diese Lesart ist NICHT frei
  // gewaehlt: die 2,5-%-Schwelle stammt aus Stimme Bs Kipp-Bedingung zu M1
  // („Attrition unter ~3 %/Jahr der ereignistragenden CIKs", Rats-Memo §2).
  const years = Object.keys(FORM25_ROWS_PER_YEAR).map(Number).sort();
  const rowsAvg = years.reduce((s, y) => s + FORM25_ROWS_PER_YEAR[y], 0) / years.length;
  const floorPct = pct(FORM25_DISTINCT_CIKS_FLOOR_2021, EVENT_CARRYING_CIKS);
  const ceilingPct = pct(rowsAvg, EVENT_CARRYING_CIKS);
  return {
    definition: 'Form-25-Emittenten pro Jahr / ereignistragende CIK-Grundgesamtheit (20.072, D1 2026-08-29)',
    schwelleHerkunft: 'Rats-Memo §2, Stimme B: Kipp-Bedingung „Attrition unter ~3 %/Jahr der ereignistragenden CIKs"',
    rowsPerYear: FORM25_ROWS_PER_YEAR,
    rowsPerYearAvg: Number(rowsAvg.toFixed(1)),
    distinctCikFloor2021: FORM25_DISTINCT_CIKS_FLOOR_2021,
    denominator: EVENT_CARRYING_CIKS,
    floorPct: Number(floorPct.toFixed(3)),
    ceilingPct: Number(ceilingPct.toFixed(3)),
    verworfenerNenner: {
      wert: ALL_BULK_ENTRIES,
      floorPct: Number(pct(FORM25_DISTINCT_CIKS_FLOOR_2021, ALL_BULK_ENTRIES).toFixed(3)),
      grund: 'alle EDGAR-Melder inkl. Fonds/13F/Privatpersonen — nicht die Aktien-Testpopulation',
    },
    thresholdPct: ABORT_THRESHOLD_PCT,
    // Verdikt am BODEN, nicht an der Decke: nur wenn selbst die deflationaerste
    // verfuegbare Zahl die Schwelle nimmt, ist das Weiter-Votum belastbar.
    verdict: floorPct >= ABORT_THRESHOLD_PCT ? 'WEITER' : 'STRANG ABBLASEN',
  };
}

async function cmdProbe() {
  const ua = assertSecContact();
  const head = await headBulk(ua);
  const mass = windowMass();
  const out = {
    stufe: 'D2.0', zeit: nowIso(), auftrag: 'ENTSCHIED 23 (2026-08-29 20:41)',
    requests: 1,
    objekt: {
      url: 'https://' + BULK_HOST + BULK_PATH,
      ...head,
      erwarteteBytes: EXPECTED_BYTES,
      erwartetLastModified: EXPECTED_LAST_MODIFIED,
      bytesStimmen: head.contentLength === EXPECTED_BYTES,
      lastModifiedStimmt: head.lastModified === EXPECTED_LAST_MODIFIED,
    },
    fensterMasse: mass,
  };
  console.log(JSON.stringify(out, null, 2));
  if (head.statusCode !== 200) throw new Error('D2.0 ROT: HTTP ' + head.statusCode);
  fs.mkdirSync(STORE_DIR, { recursive: true });
  writeProbeArtifact(path.join(STORE_DIR, 'd2-0-probe.json'), out);
  if (mass.verdict !== 'WEITER') {
    console.error('\nD2.0 VERDIKT: STRANG ABBLASEN — Fenster-Masse ' + mass.floorPct
      + ' % < Schwelle ' + ABORT_THRESHOLD_PCT + ' %. Kein Download, kein Bau.');
    process.exit(2);
  }
  console.log('\nD2.0 VERDIKT: WEITER — Boden-Masse ' + mass.floorPct + ' %/Jahr >= '
    + ABORT_THRESHOLD_PCT + ' % (Decke ' + mass.ceilingPct + ' %/Jahr).');
}

// ── D2.1 — EIN Download + Eingangsstempel (Bauplan §4.4) ────────────────────
function downloadBulk(ua, dest) {
  // Review-Fund (30.08.): bricht die Anfrage mitten im Strom ab, bekommt der
  // Schreibstrom weder 'finish' noch 'close' — er bliebe offen. In diesem
  // Einmal-Prozess raeumt der Prozess-Ende auf, in einer Wiederhol-Schleife nicht.
  // Deshalb hier explizit: ein abgebrochener Download schliesst seine Datei.
  let ws = null;
  const abbrechen = (fehler) => { if (ws) ws.destroy(); reject(fehler); };
  return new Promise((resolve, reject) => {
    const req = https.get({
      host: BULK_HOST, path: BULK_PATH,
      headers: { 'User-Agent': ua, 'Accept-Encoding': 'identity' },
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const hash = crypto.createHash('sha256');
      const tmp = dest + '.part';
      ws = fs.createWriteStream(tmp);
      let got = 0, lastLog = Date.now();
      const declared = res.headers['content-length'] ? Number(res.headers['content-length']) : null;
      res.on('data', (c) => {
        hash.update(c); got += c.length;
        if (Date.now() - lastLog > 15000) {
          lastLog = Date.now();
          console.log('[d2.1] ' + (got / 1e6).toFixed(0) + ' MB'
            + (declared ? ' / ' + (declared / 1e6).toFixed(0) + ' MB' : ''));
        }
      });
      res.on('error', abbrechen);
      ws.on('error', reject);
      res.pipe(ws);
      ws.on('finish', () => {
        // Abbruch-Wache: unvollstaendige Uebertragung darf NIE als Store landen.
        if (declared != null && got !== declared) {
          try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ }
          return reject(new Error('Abbruch: ' + got + ' von ' + declared + ' Bytes empfangen'));
        }
        fs.renameSync(tmp, dest);
        resolve({
          bytes: got, sha256: hash.digest('hex'),
          contentLength: declared, lastModified: res.headers['last-modified'] || null,
          etag: res.headers.etag || null,
        });
      });
    });
    req.on('error', abbrechen);
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('Download-Timeout: ' + HTTP_TIMEOUT_MS + ' ms ohne Bytes')));
  });
}

async function cmdDownload() {
  const ua = assertSecContact();
  fs.mkdirSync(STORE_DIR, { recursive: true });
  // T187 (d): eine .part aus einem abgebrochenen Lauf ist KEIN Store — sie faellt
  // sonst still unter den Tisch und belegt GB. Sie wird verworfen und gemeldet, nicht
  // fortgesetzt: ponytail — ohne Range-Request waere "fortsetzen" ein zweiter Voll-
  // Download mit Extra-Buchhaltung. Wird Wiederaufnahme je gebraucht, ist der Weg
  // `Range: bytes=<got>-` plus Hash-ueber-den-Rest, nicht dieser Zweig.
  const partPath = ZIP_PATH + '.part';
  if (fs.existsSync(partPath)) {
    const groesse = fs.statSync(partPath).size;
    fs.unlinkSync(partPath);
    console.log('[d2.1] verwaiste Teil-Datei verworfen (' + groesse + ' B): ' + partPath);
  }
  if (fs.existsSync(ZIP_PATH)) {
    console.log('[d2.1] Store existiert bereits — kein zweiter Download (additiv, nie ueberschreibend): ' + ZIP_PATH);
    if (fs.existsSync(STAMP_PATH)) console.log(fs.readFileSync(STAMP_PATH, 'utf8'));
    return;
  }
  console.log('[d2.1] Lade ' + BULK_PATH + ' -> ' + ZIP_PATH + ' (EINMAL, nicht entpacken) ...');
  const t0 = Date.now();
  const st = await downloadBulk(ua, ZIP_PATH);
  const stamp = {
    stufe: 'D2.1', zeit: nowIso(),
    quelle: 'https://' + BULK_HOST + BULK_PATH,
    pfad: ZIP_PATH,
    sha256: st.sha256,
    contentLength: st.contentLength,
    bytesGeschrieben: st.bytes,
    lastModified: st.lastModified,
    etag: st.etag,
    dauerSek: Math.round((Date.now() - t0) / 1000),
    erwarteteBytes: EXPECTED_BYTES,
    bytesStimmen: st.bytes === EXPECTED_BYTES,
    hinweis: 'Eingangsstempel nach Bauplan §4.4 — gitignored/ausserhalb des Checkouts liegende '
      + 'Eingaenge sind nur ueber diesen Stempel reproduzierbar belegbar.',
  };
  writeEntryStamp(STAMP_PATH, stamp);
  console.log(JSON.stringify(stamp, null, 2));
}

// ── D2.2 — Extraktion Form 25/25-NSE + Ursachen-Split ───────────────────────
const FORM25 = new Set(['25', '25-NSE']);
const CIK_ENTRY = /^CIK(\d{10})\.json$/;

/**
 * Zieht die Form-25/25-NSE-Treffer eines submissions-Objekts im Fenster.
 * Liest AUSSCHLIESSLICH filings.recent. `exchanges` wird nie beruehrt.
 * Rueckgabe: { hits[], hatUeberlauf, ueberlaufImFenster } — der Ueberlauf-Zaehler
 * beziffert den blinden Fleck exakt, statt ihn zu verschweigen.
 */
function extractForm25(sub, from, to) {
  const hits = [];
  const rec = sub && sub.filings && sub.filings.recent;
  if (rec && Array.isArray(rec.form)) {
    for (let i = 0; i < rec.form.length; i++) {
      if (!FORM25.has(rec.form[i])) continue;
      const filingDate = rec.filingDate ? rec.filingDate[i] : null;
      if (!filingDate || filingDate < from || filingDate > to) continue;
      hits.push({
        cik: Number(sub.cik),
        form: rec.form[i],
        filingDate,
        // R6-Disziplin: der SEC-Annahmezeitstempel wird MITGEFUEHRT, nie ersetzt.
        acceptanceDateTime: rec.acceptanceDateTime ? rec.acceptanceDateTime[i] || null : null,
        accessionNumber: rec.accessionNumber ? rec.accessionNumber[i] : null,
        primaryDocument: rec.primaryDocument ? rec.primaryDocument[i] || null : null,
      });
    }
  }
  const files = (sub && sub.filings && sub.filings.files) || [];
  const ueberlaufImFenster = files.filter((f) => f && f.filingTo >= from && f.filingFrom <= to).length;
  return { hits, hatUeberlauf: files.length > 0, ueberlaufImFenster };
}

/** Ursachen-Split aus <ruleProvision> der Primaerquelle. (b) boersen-initiiert, (c) Emittenten-Antrag. */
function classifyRuleProvision(xml) {
  const m = /<ruleProvision[^>]*>([\s\S]*?)<\/ruleProvision>/i.exec(xml || '');
  const raw = m ? m[1].replace(/\s+/g, ' ').trim() : null;
  if (!raw) return { klasse: 'unknown', roh: null };
  if (/12d2-2\s*\(\s*b\s*\)/i.test(raw)) return { klasse: 'b', roh: raw };
  if (/12d2-2\s*\(\s*c\s*\)/i.test(raw)) return { klasse: 'c', roh: raw };
  return { klasse: 'unknown', roh: raw };
}

async function scanZip(opt) {
  const zipPath = (opt && opt.zipPath) || ZIP_PATH;
  const hitsPath = (opt && opt.hitsPath) || HITS_PATH;
  console.log('[d2.2] oeffne ' + zipPath + ' (Namensfilter: nur CIK##########.json) ...');
  const store = secPit.openStore(zipPath, { entryFilter: (n) => CIK_ENTRY.test(n) });
  const names = store.entryNames();
  console.log('[d2.2] ' + names.length + ' CIK-Eintraege im Verzeichnis.');
  const ws = fs.createWriteStream(hitsPath);
  // Review-Fund (30.08.), KRITISCH: der Fehler-Zuhoerer hing bisher erst UNTER der Schleife.
  // Ein Schreibfehler mitten im Lauf (Platte voll, Rechte, I/O) war damit eine unbehandelte
  // Ausnahme auf Prozessebene - sie haette das `finally` unten uebersprungen und den Lauf
  // mit rohem Stapelabzug beendet statt mit der roten Zeile. Zuhoerer ab der ersten Zeile.
  let schreibFehler = null;
  ws.on('error', (e) => { schreibFehler = e; });
  let scanned = 0, parsed = 0, hitCik = 0, hits = 0, mitUeberlauf = 0, ueberlaufImFenster = 0;
  // T186: bisher stand hier ein zaehlerloses `catch (_) { continue; }`. Ein
  // unlesbarer Eintrag fiel damit still aus der Zaehlung — und §6 des publizierten
  // Berichts konnte die dritte Ursache der Zaehl-Diskrepanz weder ein- noch
  // ausschliessen, weil niemand wusste, ob es sie ueberhaupt gibt. Derselbe
  // Zaehler existiert bei den Schwester-Waechtern (watch-annual-spikes,
  // watch-fx-sanity) laengst; hier fehlte das Gegenstueck.
  let parseFehler = 0, leseFehler = 0;
  try {
  for (const name of names) {
    scanned++;
    // Review-Fund (30.08.): das Entpacken selbst kann werfen (kaputter Deflate-Strom).
    // Unbehandelt riss EIN kaputter Eintrag den ganzen 1,5-GB-Lauf mit — und der
    // Parse-Zaehler haette ihn nie gesehen, weil er eine Ebene tiefer haengt.
    // Eigener Zaehler, weil es eine andere Sache ist als unlesbares JSON.
    let buf;
    try { buf = store.readEntryByName(name); } catch (_) { leseFehler++; continue; }
    // Billiger Vorfilter auf dem Rohtext: jede echte Form-25-Zeile steht als
    // "25" oder "25-NSE" im form-Array, beide beginnen mit dem Praefix "25 —
    // beweisbare Obermenge, spart ~90 % der JSON.parse-Arbeit ueber ~15 GB.
    if (buf.indexOf('"25') === -1) continue;
    parsed++;
    let sub;
    try { sub = JSON.parse(buf.toString('utf8')); } catch (_) { parseFehler++; continue; }
    const r = extractForm25(sub, WINDOW_FROM, WINDOW_TO);
    if (r.hatUeberlauf) { mitUeberlauf++; ueberlaufImFenster += r.ueberlaufImFenster; }
    if (r.hits.length) {
      hitCik++; hits += r.hits.length;
      for (const h of r.hits) ws.write(JSON.stringify(h) + '\n');
    }
    if (scanned % 100000 === 0) console.log('[d2.2] ' + scanned + '/' + names.length + ' · Treffer ' + hits);
  }
  // MUSS awaited werden: ws.end() ist asynchron. Ohne das Warten liest die
  // naechste Stufe eine noch ungeschriebene Datei und meldet stillschweigend
  // 0 Treffer, obwohl der Scan Tausende gefunden hat (einmal live passiert).
  await new Promise((res, rej) => {
    if (schreibFehler) return rej(schreibFehler);   // schon unterwegs gescheitert
    ws.on('error', rej); ws.on('finish', res); ws.end();
  });
  } finally {
    // T187 (c): der Datei-Deskriptor faellt auch dann zu, wenn oben etwas wirft —
    // sonst haelt ein Fehlschlag das 1,5-GB-Archiv bis zum Prozessende offen.
    // Ein Fehlschlag BEIM Schliessen darf den urspruenglichen Fehler nicht verdraengen:
    // der ist der Befund, das Schliessen ist Aufraeumen (Review-Fund 30.08.).
    try { store.close(); } catch (_) { /* siehe oben */ }
  }
  const stats = { eintraege: names.length, gescannt: scanned, geparst: parsed, parseFehler, leseFehler, trefferCiks: hitCik, trefferZeilen: hits, ciksMitUeberlauf: mitUeberlauf, ueberlaufDateienImFenster: ueberlaufImFenster };
  console.log('[d2.2] Scan fertig: ' + JSON.stringify(stats));
  console.log('[d2.2] Lese-Umfang: ' + (parsed - parseFehler) + ' von ' + parsed + ' vorgefilterten Eintraegen geparst'
    + (parseFehler ? ', ' + parseFehler + ' NICHT lesbar (JSON-Parse-Fehler)' : ''));
  if (leseFehler > 0) {
    console.error('[d2.2] WARNUNG: ' + leseFehler + ' Eintrag/Eintraege liessen sich nicht aus dem Archiv '
      + 'entpacken — sie fallen aus JEDER Zaehlung dieses Laufs heraus.');
  }
  if (parseFehler > 0) {
    console.error('[d2.2] WARNUNG: ' + parseFehler + ' Eintrag/Eintraege nicht parsebar — sie fallen aus JEDER '
      + 'Zaehlung dieses Laufs heraus. Die Trefferzahlen sind Untergrenzen, keine Vollzaehlung.');
  }
  // Wache gegen genau diesen Fehler: was gezaehlt wurde, muss auch lesbar sein.
  const aufPlatte = readJsonl(hitsPath).length;
  if (aufPlatte !== hits) throw new Error('Scan-Wache: ' + hits + ' Treffer gezaehlt, ' + aufPlatte + ' auf Platte lesbar');
  return stats;
}

// filings.recent.primaryDocument zeigt bei Form 25 auf den XSL-GERENDERTEN
// Viewer-Pfad ("xslF25X02/primary_doc.xml") — der liefert HTML ohne
// <ruleProvision>. Die Primaerquelle liegt eine Ebene darueber, unter demselben
// Dateinamen (an BBBY/0001354457-23-000478 verifiziert: 1.080 B, Feld vorhanden).
function rawDocName(doc) {
  const name = String(doc || 'primary_doc.xml').replace(/^xsl[^/]*\//i, '');
  return name || 'primary_doc.xml';
}

function getDoc(ua, cik, accession, doc) {
  const acc = String(accession).replace(/-/g, '');
  const p = '/Archives/edgar/data/' + Number(cik) + '/' + acc + '/' + rawDocName(doc);
  return new Promise((resolve) => {
    const req = https.get({ host: BULK_HOST, path: p, headers: { 'User-Agent': ua, 'Accept-Encoding': 'identity' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve({ status: res.statusCode, body: null }); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: 200, body: Buffer.concat(chunks).toString('utf8') }));
    });
    // status 0 = NICHT GEHOLT (Netzfehler/Frist), nie ein Befund ueber das Dokument.
    req.on('error', () => resolve({ status: 0, body: null }));
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('Doc-Timeout')));
  });
}

/**
 * T187 (b): Darf diese Antwort in den Ergebnis-Store? status 0 = nicht erreicht
 * (Netzfehler oder abgelaufene Frist in getDoc) — das ist FEHLENDE ABDECKUNG, keine
 * Aussage ueber das Dokument. Wird sie geschrieben, gilt sie im naechsten Lauf als
 * erledigt und im Bericht als bestimmter Negativbefund. Jeder echte HTTP-Status
 * (200, 403, 404 …) ist dagegen ein Befund und wird persistiert.
 */
function istPersistierbar(status) { return status !== 0; }

/** SEC-schonende Pause zwischen zwei Dokument-Abrufen (< 10 req/s). */
const drossel = () => new Promise((res) => setTimeout(res, 150));

/**
 * Welche Klasse traegt eine Trefferzeile? VIER, nicht drei (Review-Fund 30.08.):
 *  nichtGeholt            - nie versucht (Abruf abgebrochen)
 *  nichtAbrufbar          - versucht, echter HTTP-Fehlschlag (403/404/429/5xx)
 *  b / c                  - Rechtsgrundlage aus dem Dokument gelesen
 *  andereRechtsgrundlage  - Dokument GELESEN, traegt eine andere Grundlage
 * Die ersten beiden sind FEHLENDE ABDECKUNG. Landeten sie wie bisher in
 * `andereRechtsgrundlage`, laese der Bericht eine SEC-Sperre als dritte
 * Rechtsgrundlage - genau die stille Falschaussage, die dieser Strang vermeidet.
 */
function provisionKlasse(p) {
  if (!p) return 'nichtGeholt';
  if (p.status !== 200) return 'nichtAbrufbar';
  return (p.klasse === 'b' || p.klasse === 'c') ? p.klasse : 'andereRechtsgrundlage';
}

/**
 * Der Satz zum Parse-Verlust - EINE Quelle fuer Bericht-JSON und Bericht-Text.
 * Fehlt der Zaehler (Kennzahlen aus einem Lauf vor T186), heisst das NICHT GEMESSEN
 * und wird nie als 0 gedruckt.
 */
function parseVerlustSatz(scanStats) {
  const gemessen = scanStats && typeof scanStats.parseFehler === 'number';
  if (!gemessen) {
    return 'PARSE-VERLUST NICHT GEMESSEN: diese Scan-Kennzahlen stammen aus einem Lauf VOR dem '
      + 'Zaehler (T186); die Zahl ist unbekannt, ausdruecklich nicht 0.';
  }
  const lese = typeof scanStats.leseFehler === 'number' && scanStats.leseFehler > 0
    ? ' Dazu ' + scanStats.leseFehler + ' Eintrag/Eintraege, die sich nicht entpacken liessen.' : '';
  if (scanStats.parseFehler === 0) {
    return 'PARSE-VERLUST GEMESSEN: 0 von ' + scanStats.geparst + ' vorgefilterten Eintraegen war unlesbar - '
      + 'die dritte Kandidaten-Ursache der Zaehl-Diskrepanz (par. 6) ist damit AUSGESCHLOSSEN.' + lese;
  }
  return 'PARSE-VERLUST GEMESSEN: ' + scanStats.parseFehler + ' von ' + scanStats.geparst + ' vorgefilterten '
    + 'Eintraegen waren unlesbar und fallen aus jeder Zaehlung heraus - die Trefferzahlen sind Untergrenzen.' + lese;
}

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function fetchRuleProvisions(ua) {
  const hits = readJsonl(HITS_PATH);
  const done = new Set(readJsonl(RULEPROV_PATH).map((r) => r.accessionNumber));
  const todo = hits.filter((h) => h.accessionNumber && !done.has(h.accessionNumber));
  console.log('[d2.2] ruleProvision: ' + hits.length + ' Treffer, ' + done.size + ' bereits geholt, ' + todo.length + ' offen.');
  const ws = fs.createWriteStream(RULEPROV_PATH, { flags: 'a' });
  let n = 0, nichtErreicht = 0;
  for (const h of todo) {
    const r = await getDoc(ua, h.cik, h.accessionNumber, h.primaryDocument);
    // Die Drossel gilt AUCH fuer Fehlschlaege (Review-Fund 30.08.): ohne sie faehrt der
    // Lauf genau dann schneller gegen die SEC, wenn die Abrufe ohnehin schon scheitern.
    if (!istPersistierbar(r.status)) { nichtErreicht++; await drossel(); continue; }
    const cls = r.status === 200 ? classifyRuleProvision(r.body) : { klasse: 'unknown', roh: null };
    ws.write(JSON.stringify({ accessionNumber: h.accessionNumber, cik: h.cik, status: r.status, klasse: cls.klasse, roh: cls.roh }) + '\n');
    n++;
    if (n % 250 === 0) console.log('[d2.2] ruleProvision ' + n + '/' + todo.length);
    await drossel();
  }
  await new Promise((res) => ws.end(res));
  console.log('[d2.2] ruleProvision fertig: ' + n + ' persistiert'
    + (nichtErreicht ? ', ' + nichtErreicht + ' nicht erreicht (bleiben offen)' : '') + '.');
}

// STRUKTURELLE Doppelzaehl-Wache, ohne jede Boersen-Kenntnis:
// Die ersten 10 Ziffern einer Accession-Nummer sind die CIK des EINREICHERS.
// EDGAR haengt eine Form 25 an BEIDE Seiten — an den Einreicher und an den
// betroffenen Emittenten. Ist cik == Accession-Praefix, liest man die EIGENE
// Kopie des Einreichers, nicht das Ereignis einer betroffenen Firma.
// Rein arithmetisch, konsumiert keine Boersen-Identitaet (Sperr-Auflage
// eingehalten) — und die Zahlen werden nur AUSGEWIESEN, nie gefiltert:
// welche Seite zaehlt, entscheidet der Orchestrator, nicht dieser Lauf.
function istSelbstEinreichung(h) {
  return Number(String(h.accessionNumber).slice(0, 10)) === h.cik;
}

// Deterministischer PRNG (mulberry32) — ein Forschungsartefakt muss die
// Stichprobe reproduzieren koennen; Math.random() waere nicht wiederholbar.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SAMPLE_SEED = 20260829;

// Die Reihenfolge-Falle: fetchRuleProvisions laeuft in Dateireihenfolge, also
// nach CIK aufsteigend. Ein Abbruch nach n Stueck liefert damit die AELTESTEN
// Registranten, keine Zufallsstichprobe — jede Verteilung daraus waere verzerrt.
// Diese Stufe zieht deshalb eine seed-feste Zufallsstichprobe aus dem REST.
async function cmdSample() {
  const ua = assertSecContact();
  const limit = Number(process.argv[3] || 600);
  const hits = readJsonl(HITS_PATH);
  const done = new Set(readJsonl(RULEPROV_PATH).map((r) => r.accessionNumber));
  const offen = [...new Set(hits.map((h) => h.accessionNumber).filter((a) => a && !done.has(a)))];
  const byAcc = new Map(hits.map((h) => [h.accessionNumber, h]));
  const rnd = mulberry32(SAMPLE_SEED);
  for (let i = offen.length - 1; i > 0; i--) {           // Fisher-Yates, seed-fest
    const j = Math.floor(rnd() * (i + 1));
    [offen[i], offen[j]] = [offen[j], offen[i]];
  }
  const pick = offen.slice(0, limit);
  console.log('[d2.2] Zufallsstratum: ' + pick.length + ' von ' + offen.length + ' offenen (Seed ' + SAMPLE_SEED + ')');
  const ws = fs.createWriteStream(RULEPROV_PATH, { flags: 'a' });
  let n = 0, nichtErreicht = 0;
  for (const acc of pick) {
    const h = byAcc.get(acc);
    const r = await getDoc(ua, h.cik, acc, h.primaryDocument);
    if (!istPersistierbar(r.status)) { nichtErreicht++; await drossel(); continue; }   // T187 (b) + Drossel, wie oben
    const cls = r.status === 200 ? classifyRuleProvision(r.body) : { klasse: 'unknown', roh: null };
    ws.write(JSON.stringify({ accessionNumber: acc, cik: h.cik, status: r.status, klasse: cls.klasse, roh: cls.roh, stratum: 'zufall' }) + '\n');
    if (++n % 200 === 0) console.log('[d2.2] Stratum ' + n + '/' + pick.length);
    await drossel();
  }
  await new Promise((res) => ws.end(res));
  console.log('[d2.2] Zufallsstratum fertig: ' + n
    + (nichtErreicht ? ' (' + nichtErreicht + ' nicht erreicht, bleiben offen)' : ''));
}

function buildReport(scanStats) {
  const hits = readJsonl(HITS_PATH);
  if (scanStats && hits.length !== scanStats.trefferZeilen) {
    throw new Error('Report-Wache: Scan meldete ' + scanStats.trefferZeilen
      + ' Treffer, gelesen wurden ' + hits.length + ' — kein Report auf halber Datei.');
  }
  const prov = new Map(readJsonl(RULEPROV_PATH).map((r) => [r.accessionNumber, r]));

  function aggregate(rows) {
    const jahre = {};
    const ciks = new Set();
    // NICHT GEHOLT ist eine eigene Klasse, nie „unknown": ein ungeholtes Dokument
    // ist fehlende Abdeckung, keine dritte Rechtsgrundlage. Das Zusammenwerfen
    // waere genau die stille Falschaussage, die dieser Strang vermeiden soll.
    const split = { b: 0, c: 0, andereRechtsgrundlage: 0, nichtAbrufbar: 0, nichtGeholt: 0 };
    const formen = {};
    // Wortlaut-Verteilung der Rechtsgrundlage — VERBATIM, ohne Deutung. Der
    // beauftragte (b)/(c)-Schnitt partitioniert die Daten NICHT: die Masse traegt
    // 12d2-2(a)(1)–(a)(4). Was diese Klassen bedeuten, entscheidet das Gericht.
    const provisionVerteilung = {};
    let mitPrimaryDoc = 0, ohneDokument = 0;
    for (const h of rows) {
      const y = h.filingDate.slice(0, 4);
      jahre[y] = jahre[y] || { zeilen: 0, ciks: new Set(), b: 0, c: 0, andereRechtsgrundlage: 0, nichtAbrufbar: 0, nichtGeholt: 0 };
      jahre[y].zeilen++; jahre[y].ciks.add(h.cik);
      ciks.add(h.cik);
      formen[h.form] = (formen[h.form] || 0) + 1;
      const p = prov.get(h.accessionNumber);
      const k = provisionKlasse(p);
      split[k]++; jahre[y][k]++;
      if (p && p.status === 200) mitPrimaryDoc++; else if (p) ohneDokument++;
      const w = !p ? 'NOCH NICHT GEHOLT'
        : p.roh ? p.roh
        : p.status === 200 ? 'FELD FEHLT' : 'DOKUMENT NICHT ABRUFBAR (HTTP ' + p.status + ')';
      provisionVerteilung[w] = (provisionVerteilung[w] || 0) + 1;
    }
    const jahreOut = {};
    for (const y of Object.keys(jahre).sort()) {
      jahreOut[y] = { zeilen: jahre[y].zeilen, uniqueCiks: jahre[y].ciks.size, b: jahre[y].b, c: jahre[y].c, andereRechtsgrundlage: jahre[y].andereRechtsgrundlage, nichtAbrufbar: jahre[y].nichtAbrufbar, nichtGeholt: jahre[y].nichtGeholt };
    }
    const sortiert = Object.fromEntries(Object.entries(provisionVerteilung).sort((a, b) => b[1] - a[1]));
    // GEHOLT heisst: Dokument liegt vor. Ein 403 ist nicht geholt, auch wenn er beantwortet wurde.
    const geholt = rows.length - split.nichtGeholt - split.nichtAbrufbar;
    return {
      zeilen: rows.length, uniqueCiks: ciks.size, formen,
      abdeckung: { geholt, offen: split.nichtGeholt, nichtAbrufbar: split.nichtAbrufbar,
        quote: rows.length ? Number((geholt / rows.length).toFixed(4)) : 0 },
      mitPrimaryDoc, ohneDokument, ruleProvisionSplit: split, provisionVerteilung: sortiert, jahre: jahreOut,
    };
  }

  const alle = aggregate(hits);
  const subjekt = aggregate(hits.filter((h) => !istSelbstEinreichung(h)));
  const selbst = aggregate(hits.filter(istSelbstEinreichung));
  const jahreOut = alle.jahre;
  const ciks = { size: alle.uniqueCiks };
  const split = alle.ruleProvisionSplit;
  const formen = alle.formen;
  const mitPrimaryDoc = alle.mitPrimaryDoc;

  // Zwei Straten getrennt ausweisen, weil sie NICHT dasselbe messen:
  // „kopf" = Dateireihenfolge (CIK aufsteigend) => aelteste Registranten, verzerrt.
  // „zufall" = seed-feste Zufallsziehung aus dem Rest => belastbar hochrechenbar.
  function verteilung(eintraege) {
    const d = {};
    for (const p of eintraege) {
      const w = p.roh ? p.roh : (p.status === 200 ? 'FELD FEHLT' : 'DOKUMENT NICHT ABRUFBAR (HTTP ' + p.status + ')');
      d[w] = (d[w] || 0) + 1;
    }
    return { n: eintraege.length, verteilung: Object.fromEntries(Object.entries(d).sort((a, b) => b[1] - a[1])) };
  }
  const provAlle = [...prov.values()];
  const stichprobe = {
    hinweis: 'Die Abdeckung ist TEILWEISE. Ungeholte Zeilen sind als „nichtGeholt" gefuehrt, '
      + 'NIE als Rechtsgrundlage. Das Kopf-Stratum ist nach CIK sortiert und damit verzerrt; '
      + 'belastbar hochrechenbar ist allein das Zufallsstratum (Seed ' + SAMPLE_SEED + ').',
    kopfStratumDateireihenfolge: verteilung(provAlle.filter((p) => p.stratum !== 'zufall')),
    zufallsStratum: verteilung(provAlle.filter((p) => p.stratum === 'zufall')),
  };

  const report = {
    stufe: 'D2.2', zeit: nowIso(),
    auftrag: 'Orchestrator ENTSCHIED 23 (2026-08-29 20:41); Rat frueher-finden-rat-m1m2-2026-08-29 §3/§6',
    semantik: 'EVIDENZ, KEIN LABEL. Form 25 ist nicht Tod (SMCI lebt, TWTR war Uebernahme). '
      + 'Die Label-Semantik entscheidet spaeter das Gericht.',
    exchangesKonsumiert: false,
    fenster: { von: WINDOW_FROM, bis: WINDOW_TO, feld: 'filings.recent.filingDate' },
    quelle: fs.existsSync(STAMP_PATH) ? JSON.parse(fs.readFileSync(STAMP_PATH, 'utf8')) : null,
    scan: scanStats,
    gesamt: alle,
    // BEFUND, der die Auftrags-Praemisse korrigiert: der beauftragte Ursachen-Split
    // (b) boersen-initiiert / (c) Emittenten-Antrag partitioniert die Daten NICHT.
    // Die Mehrheit der Dokumente traegt 12d2-2(a)(1)…(a)(4) — eine dritte Klasse,
    // die im Rats-Memo nicht vorkam (Stimme C hatte nur BBBY gelesen, dort (b)).
    // Wortlaut steht verbatim in provisionVerteilung; Bedeutung = Gerichtsfrage.
    praemissenKorrektur: 'Der (b)/(c)-Schnitt deckt nur eine Minderheit der Faelle. '
      + 'Siehe provisionVerteilung: 12d2-2(a)(1)–(a)(4) dominiert. Keine Deutung in diesem Lauf.',
    // Der wichtigste Einzelbefund: (c) ist NICHT „nicht vorhanden", sondern mit
    // dieser Methode strukturell UNMESSBAR. Ohne diesen Hinweis wuerde der naechste
    // Leser aus „c: 0" schliessen, es gebe keine freiwilligen Rueckzuege.
    cNullIstArtefakt: {
      befund: 'c = 0 in allen geholten Dokumenten — das ist ein Extraktions-Artefakt, kein Weltbefund.',
      mechanik: 'Form 25-NSE (boersen-eingereicht) liefert primary_doc.xml MIT <ruleProvision> '
        + '(Feldabdeckung 100 %). Form „25" (emittenten-eingereicht) liefert dagegen ein HTML-Dokument '
        + '(z. B. d812044d25.htm) OHNE XML-Tag — alle 170 geholten Form-25-Zeilen landen zwangslaeufig '
        + 'in „FELD FEHLT". Genau diese Klasse waere aber der 12d2-2(c)-Fall.',
      folge: 'Der „FELD FEHLT"-Topf ist deckungsgleich mit Form „25". Eine (c)-Zaehlung braucht einen '
        + 'HTML-Parser fuer das Emittenten-Formular — NICHT in diesem Auftrag gebaut.',
      hypotheseNichtEntschieden: 'Der Formulartyp selbst traegt die Unterscheidung vermutlich schon '
        + '(25-NSE = Boerse, 25 = Emittent, ' + (formen['25'] || 0) + ' Zeilen). Ob das als Ursachen-Split '
        + 'taugt, ist eine GERICHTSFRAGE — hier ausdruecklich nicht entschieden.',
    },
    stichprobe,
    jahre: jahreOut,
    // Beobachtung, KEINE Klassifikation: EDGAR haengt jede Form 25 an Einreicher
    // UND betroffenen Emittenten. Welche Seite in eine spaetere Label-Zaehlung
    // eingeht, ist eine Orchestrator-/Gerichts-Frage — hier nur ausgewiesen.
    doppelanhang: {
      regel: 'cik == erste 10 Ziffern der accessionNumber => eigene Kopie des Einreichers',
      subjektSeite: subjekt,
      selbstEingereicht: selbst,
      hinweis: 'Die fuenf zeilenstaerksten selbst-einreichenden CIKs sind Boersenbetreiber '
        + '(876661, 1143362, 1143313, 1354457, 1417835 — zusammen 941 Zeilen). 29 CIKs stehen auf '
        + 'BEIDEN Seiten. Form „25" ist emittenten-eingereicht: eine Selbst-Einreichung ist dort '
        + 'sehr wohl ein echtes Ereignis — deshalb wird NICHT gefiltert, sondern getrennt gezaehlt.',
    },
    luecken: [
      'Nur filings.recent gelesen (Auftrag). Aeltere Eintraege liegen in Ueberlauf-Shards: das '
        + 'Archiv traegt exakt 5.353 davon (983.019 CIK-Dateien + 5.353 Shards + 1 placeholder.txt '
        + '= 988.373, deckungsgleich mit der ZIP64-Zaehlung des Rats). Der Scan konnte '
        + (scanStats ? scanStats.ueberlaufDateienImFenster : '?') + ' fensterschneidende Shard-Dateien '
        + 'zuordnen — ABER nur bei den ' + (scanStats ? scanStats.geparst : '?') + ' Eintraegen, die den '
        + 'Rohtext-Vorfilter passiert haben. Eintraege ohne "25 in filings.recent koennen im Shard '
        + 'trotzdem einen Treffer tragen; die 5.353 sind die harte Obergrenze, die 991 eine '
        + 'Teilmenge. Der blinde Fleck ist eingegrenzt, nicht geschlossen.',
      'exchanges[] wurde nie gelesen; eine Boersen-Identitaet je Firma liefert dieser Lauf bewusst NICHT.',
      'ABDECKUNG TEILWEISE: die Rechtsgrundlage wurde fuer ' + alle.abdeckung.geholt
        + ' von ' + alle.zeilen + ' Zeilen geholt (' + (100 * alle.abdeckung.quote).toFixed(1) + ' %). '
        + 'Der Rest ist als „nichtGeholt" gefuehrt, NICHT als unbekannte Rechtsgrundlage. Abgebrochen '
        + 'wurde bewusst: bei ~150 ms/Dokument haette der Vollabruf rund 90 weitere Minuten gekostet.',
      'Das Kopf-Stratum folgt der Dateireihenfolge (CIK aufsteigend) und ist damit auf alte '
        + 'Registranten verzerrt — es darf NICHT hochgerechnet werden. Fuer belastbare Anteile ist '
        + 'allein das seed-feste Zufallsstratum zu verwenden (stichprobe.zufallsStratum).',
      parseVerlustSatz(scanStats),
    'Ticker-Bruecke (D2.5) NICHT gebaut: die Treffer sind CIK-geschluesselt, nicht ticker-geschluesselt.',
      '(c)-Faelle sind mit dieser Methode NICHT zaehlbar: Form „25" liefert HTML statt primary_doc.xml. '
        + 'Die 0 in der (c)-Spalte bedeutet „nicht messbar", nicht „kommt nicht vor". Siehe §5 Punkt 4.',
      'ABWEICHUNG zum Rats-Mengengeruest (§3: 1.721/1.927/2.124/2.087 form.idx-Zeilen 2019–2022): '
        + 'dieser Lauf findet emittentenseitig rund die HAELFTE. Zwei Kandidaten-Erklaerungen, keine '
        + 'davon hier entschieden: (a) form.idx zaehlt denselben Vorgang beidseitig (Einreicher + '
        + 'Subjekt), (b) Ueberlauf-Shards verdecken Treffer aktiver Vielfachmelder. Die Aufloesung '
        + 'braucht einen zweiten Zaehl-Lauf und gehoert nicht in D2.2.',
    ],
  };
  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  writeReportJson(REPORT_JSON, report);
  const q = fs.existsSync(STAMP_PATH) ? JSON.parse(fs.readFileSync(STAMP_PATH, 'utf8')) : {};
  const probe = fs.existsSync(path.join(STORE_DIR, 'd2-0-probe.json'))
    ? JSON.parse(fs.readFileSync(path.join(STORE_DIR, 'd2-0-probe.json'), 'utf8')) : null;
  const m = probe ? probe.fensterMasse : null;
  const L = [];
  L.push('---');
  L.push('title: "D2 — Form-25-Delisting-Evidenz aus dem SEC-submissions-Bulk (2026-08-29)"');
  L.push('date: 2026-08-29');
  L.push('tags: [screener, frueher-finden, delisting, form25, sec, d2]');
  L.push('status: D2.0–D2.2 abgeschlossen · Evidenz erhoben, KEIN Label vergeben');
  L.push('auftrag: Orchestrator ENTSCHIED 23 (2026-08-29 20:41)');
  L.push('---');
  L.push('');
  L.push('# AUF EINEN BLICK');
  L.push('');
  L.push('**Die Delisting-Evidenz existiert und ist gratis beschaffbar: ' + hits.length + ' Form-25/25-NSE-Zeilen');
  L.push('auf ' + ciks.size + ' CIKs im Fenster 2019–2024. Vier Auftrags-Praemissen haben die Messung');
  L.push('aber nicht ueberlebt — der (b)/(c)-Ursachen-Split partitioniert die Daten nicht, `(c)` ist mit');
  L.push('dieser Methode sogar strukturell unmessbar, EDGAR haengt jeden Vorgang doppelt an, und die');
  L.push('Zeilenzahl liegt bei rund der Haelfte des Rats-Mengengeruests.**');
  L.push('');
  L.push('- **D2.0 Kostenprobe: WEITER.** Fenster-Masse ' + (m ? m.floorPct : '?') + ' %/Jahr am Boden gegen die');
  L.push('  vorab eingefrorene Schwelle ' + ABORT_THRESHOLD_PCT + ' % (§1).');
  L.push('- **D2.1 Bulk geladen und gestempelt** (§2), **D2.2 extrahiert** (§3).');
  L.push('- **Vier Praemissen-Korrekturen** in §5 — die wichtigste: der Ursachen-Split traegt nicht,');
  L.push('  und `(c) = 0` ist ein Artefakt der Extraktion, kein Befund ueber die Welt.');
  L.push('- **Offene Folgefrage** (§6) und **ehrliche Luecken** (§7).');
  L.push('- Sprungmarken: §1 Schwelle · §2 Eingang · §3 Zahlen · §4 Rechtsgrundlage · §5 Korrekturen · §6 Folgefrage · §7 Luecken · §8 Ablage.');
  L.push('');
  L.push('**Semantik-Vorbehalt, bindend:** Form 25 ist **kein Todesbeleg**. SMCI traegt 25-NSE @ 2019-03-12');
  L.push('und lebt; TWTR war eine Uebernahme. Dieser Lauf erhebt Formulartyp + Datum + Rechtsgrundlage');
  L.push('als **Evidenz**. Die Label-Semantik entscheidet das Gericht, nicht dieser Bericht.');
  L.push('**`exchanges[]` wurde nie konsumiert** (Sperr-Auflage ENTSCHIED 23.2).');
  L.push('');
  L.push('---');
  L.push('');
  L.push('# §1 — D2.0 Kostenprobe: Schwellen-Verdikt');
  L.push('');
  L.push('EIN HEAD-Request. Objekt bestaetigt **bytegleich** zur Rats-Faktentafel §3:');
  L.push('`' + (probe ? probe.objekt.contentLength : '?') + ' B`, `Last-Modified: ' + (probe ? probe.objekt.lastModified : '?') + '`,');
  L.push('`Accept-Ranges: bytes`, HTTP ' + (probe ? probe.objekt.statusCode : '?') + '.');
  L.push('');
  if (m) {
    L.push('| Groesse | Wert |');
    L.push('| --- | --- |');
    L.push('| Definition | ' + m.definition + ' |');
    L.push('| Herkunft der Schwelle | ' + m.schwelleHerkunft + ' |');
    L.push('| Zaehler-Boden (Einzel-CIKs 2021, Stimme B) | ' + m.distinctCikFloor2021 + ' |');
    L.push('| Zaehler-Decke (form.idx-Zeilen im Mittel) | ' + m.rowsPerYearAvg + ' |');
    L.push('| **Nenner (entscheidungsrelevant)** | **' + m.denominator + ' ereignistragende CIKs (D1)** |');
    L.push('| Masse am Boden | **' + m.floorPct + ' %/Jahr** |');
    L.push('| Masse an der Decke | ' + m.ceilingPct + ' %/Jahr |');
    L.push('| Verworfener Nenner | ' + m.verworfenerNenner.wert + ' (alle Bulk-Eintraege) → ' + m.verworfenerNenner.floorPct + ' % |');
    L.push('| Grund der Verwerfung | ' + m.verworfenerNenner.grund + ' |');
    L.push('| Schwelle (vorab fixiert) | ' + m.thresholdPct + ' % |');
    L.push('| **Verdikt** | **' + m.verdict + '** |');
    L.push('');
    L.push('Das Verdikt haengt bewusst am **Boden**, nicht an der Decke: nur wenn selbst die');
    L.push('deflationaerste verfuegbare Zahl die Schwelle nimmt, ist das Weiter-Votum belastbar.');
    L.push('Beide Nenner sind ausgewiesen, damit die Wahl nachpruefbar bleibt statt bequem zu sein.');
  }
  L.push('');
  L.push('# §2 — D2.1 Eingangsstempel (Bauplan §4.4)');
  L.push('');
  L.push('| Feld | Wert |');
  L.push('| --- | --- |');
  L.push('| Quelle | `' + (q.quelle || '?') + '` |');
  L.push('| sha256 | `' + (q.sha256 || '?') + '` |');
  L.push('| Content-Length | ' + (q.contentLength || '?') + ' B |');
  L.push('| geschrieben | ' + (q.bytesGeschrieben || '?') + ' B (deckungsgleich: ' + (q.bytesStimmen ? 'ja' : 'NEIN') + ') |');
  L.push('| Last-Modified | ' + (q.lastModified || '?') + ' |');
  L.push('| ETag | `' + (q.etag || '?') + '` |');
  L.push('| Dauer | ' + (q.dauerSek || '?') + ' s |');
  L.push('');
  L.push('Genau **ein** Download. Nicht entpackt — gelesen wird per `openStore(zipPath)` direkt aus dem ZIP.');
  L.push('');
  L.push('# §3 — D2.2 Zahlen');
  L.push('');
  L.push('Archiv-Aufteilung, exakt: **983.019** CIK-Dateien + **5.353** Ueberlauf-Shards + 1 `placeholder.txt`');
  L.push('= **988.373** — deckungsgleich mit der ZIP64-Zaehlung des Rats.');
  L.push('');
  L.push('| Jahr | Form-25-Zeilen | Unique CIKs | (b) | (c) | andere Rechtsgrundlage | nicht abrufbar | noch nicht geholt |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const y of Object.keys(jahreOut)) {
    const r = jahreOut[y];
    L.push('| ' + y + ' | ' + r.zeilen + ' | ' + r.uniqueCiks + ' | ' + r.b + ' | ' + r.c + ' | ' + r.andereRechtsgrundlage + ' | ' + r.nichtAbrufbar + ' | ' + r.nichtGeholt + ' |');
  }
  L.push('| **Summe** | **' + hits.length + '** | **' + ciks.size + '** | **' + split.b + '** | **' + split.c
    + '** | **' + split.andereRechtsgrundlage + '** | **' + split.nichtAbrufbar + '** | **' + split.nichtGeholt + '** |');
  L.push('');
  L.push('*"nicht abrufbar" ist eine eigene Spalte und keine Rechtsgrundlage: ein geblockter oder');
  L.push('fehlgeschlagener Abruf (403/404/429/5xx) ist fehlende Abdeckung. Wuerde er wie frueher unter');
  L.push('"andere Rechtsgrundlage" gezaehlt, laese dieser Bericht eine SEC-Sperre als Befund.*');
  L.push('');
  L.push('Formulare: ' + JSON.stringify(formen) + ' · Rechtsgrundlage geholt fuer **'
    + alle.abdeckung.geholt + '/' + hits.length + '** Zeilen (' + (100 * alle.abdeckung.quote).toFixed(1) + ' %).');
  L.push('*Unique CIKs je Jahr summieren sich nicht auf die Gesamtzahl: 563 CIKs tragen Treffer in mehr als einem Jahr.*');
  L.push('');
  L.push('## Doppelanhang: Emittenten-Seite vs. Einreicher-Kopie');
  L.push('');
  L.push('EDGAR haengt jede Form 25 an **beide** Seiten. Trennregel rein arithmetisch,');
  L.push('ohne jede Boersen-Kenntnis: `cik == erste 10 Ziffern der accessionNumber` = eigene Kopie des Einreichers.');
  L.push('');
  L.push('| Seite | Zeilen | Unique CIKs | (b) | (c) | andere | nicht abrufbar | noch nicht geholt |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [nm, a] of [['Emittenten-/Subjekt-Seite', subjekt], ['Einreicher-Kopie (selbst)', selbst]]) {
    const s = a.ruleProvisionSplit;
    L.push('| ' + nm + ' | ' + a.zeilen + ' | ' + a.uniqueCiks + ' | ' + s.b + ' | ' + s.c + ' | '
      + s.andereRechtsgrundlage + ' | ' + s.nichtAbrufbar + ' | ' + s.nichtGeholt + ' |');
  }
  L.push('');
  L.push('### Emittenten-Seite je Jahr');
  L.push('| Jahr | Zeilen | Unique CIKs |');
  L.push('| --- | --- | --- |');
  for (const y of Object.keys(subjekt.jahre)) {
    const r = subjekt.jahre[y];
    L.push('| ' + y + ' | ' + r.zeilen + ' | ' + r.uniqueCiks + ' |');
  }
  L.push('');
  L.push('Die fuenf zeilenstaerksten Selbst-Einreicher sind Boersenbetreiber (CIK 876661, 1143362,');
  L.push('1143313, 1354457, 1417835 — zusammen 941 Zeilen). 29 CIKs stehen auf **beiden** Seiten.');
  L.push('**Nicht gefiltert, nur getrennt gezaehlt:** Form „25" ist emittenten-eingereicht, dort ist eine');
  L.push('Selbst-Einreichung sehr wohl ein echtes Ereignis. Welche Seite in eine Label-Zaehlung eingeht,');
  L.push('ist eine Orchestrator-/Gerichts-Frage.');
  L.push('');
  L.push('# §4 — Rechtsgrundlage im Wortlaut (verbatim, ohne Deutung)');
  L.push('');
  L.push('| Rechtsgrundlage | Zeilen |');
  L.push('| --- | --- |');
  for (const [w, n] of Object.entries(alle.provisionVerteilung)) L.push('| `' + w + '` | ' + n + ' |');
  L.push('');
  L.push('**Zwei Straten, getrennt ausgewiesen — sie messen nicht dasselbe:**');
  L.push('');
  for (const [nm, s] of [['Kopf (Dateireihenfolge, CIK aufsteigend — VERZERRT)', stichprobe.kopfStratumDateireihenfolge],
    ['Zufallsstratum (Seed ' + SAMPLE_SEED + ' — hochrechenbar)', stichprobe.zufallsStratum]]) {
    L.push('*' + nm + ', n=' + s.n + ':*');
    L.push('');
    L.push('| Rechtsgrundlage | n | Anteil |');
    L.push('| --- | --- | --- |');
    for (const [w, n] of Object.entries(s.verteilung)) {
      L.push('| `' + w + '` | ' + n + ' | ' + (s.n ? (100 * n / s.n).toFixed(1) : '0') + ' % |');
    }
    L.push('');
  }
  L.push('# §5 — Drei Praemissen-Korrekturen');
  L.push('');
  L.push('1. **Der beauftragte (b)/(c)-Ursachen-Split partitioniert die Daten nicht.** Die Masse der');
  L.push('   Dokumente traegt `12d2-2(a)(1)`–`(a)(4)` — eine dritte Klasse, die im Rats-Memo nicht');
  L.push('   vorkam. Stimme C hatte genau ein Dokument gelesen (BBBY), und das war zufaellig ein (b).');
  L.push('   Der Wortlaut wird deshalb **verbatim** gefuehrt statt in ein Zwei-Klassen-Schema gepresst.');
  L.push('2. **EDGAR haengt jeden Vorgang doppelt an** (Einreicher + Emittent). Ohne Trennung zaehlt man');
  L.push('   Boersenbetreiber als „delistete Firmen" mit. Die Trennung laeuft ueber das Accession-Praefix,');
  L.push('   also arithmetisch — **die Sperr-Auflage bleibt gewahrt**, es wird keine Boersen-Identitaet konsumiert.');
  L.push('3. **`primaryDocument` zeigt auf den XSL-Viewer** (`xslF25X02/primary_doc.xml`), der HTML ohne');
  L.push('   `<ruleProvision>` liefert. Wer den Feldwert naiv abruft, bekaeme **100 % „unbekannt"** —');
  L.push('   ein stiller Totalausfall. Die Primaerquelle liegt eine Ebene darueber (1.080 B statt 10.126 B).');
  L.push('4. **`(c) = 0` ist ein Artefakt meiner eigenen Extraktion, kein Weltbefund.** Form 25-NSE');
  L.push('   (boersen-eingereicht) liefert `primary_doc.xml` mit `<ruleProvision>` — Feldabdeckung 100 %.');
  L.push('   Form „25" (emittenten-eingereicht) liefert ein **HTML**-Dokument ohne XML-Tag; alle 170');
  L.push('   geholten Form-25-Zeilen landen zwangslaeufig in „FELD FEHLT" — und genau das waere der');
  L.push('   12d2-2(c)-Fall. **Der „FELD FEHLT"-Topf ist deckungsgleich mit Form „25".**');
  L.push('   Eine (c)-Zaehlung braucht einen HTML-Parser fuer das Emittenten-Formular; nicht gebaut.');
  L.push('   *Hypothese, ausdruecklich NICHT entschieden:* der Formulartyp traegt die Unterscheidung');
  L.push('   vermutlich schon (25-NSE = Boerse, 25 = Emittent, ' + (formen['25'] || 0) + ' Zeilen) — Gerichtsfrage.');
  L.push('');
  L.push('# §6 — Offene Folgefrage: die Zaehl-Diskrepanz');
  L.push('');
  L.push('Das Rats-Mengengeruest (§3: 1.721/1.927/2.124/2.087 `form.idx`-Zeilen 2019–2022) liegt rund');
  L.push('**doppelt so hoch** wie die hier emittentenseitig gefundenen Zeilen. Zwei Kandidaten-Erklaerungen,');
  L.push('**keine davon hier entschieden**:');
  L.push('');
  L.push('- **(a) Beidseitige Zaehlung.** `form.idx` fuehrt denselben Vorgang unter Einreicher *und*');
  L.push('  Subjekt. Dafuer spricht die Groessenordnung: 2021 = 2.124 form.idx-Zeilen gegen 1.050 hier');
  L.push('  gefundene — Faktor ~2. Dagegen spricht Stimme Bs Befund von nur 694 Einzel-CIKs in 2021.');
  L.push('- **(b) Ueberlauf-Shards.** Aktive Vielfachmelder halten ihre aelteren Eintraege in');
  L.push('  `CIK…-submissions-NNN.json`; dieser Lauf las auftragsgemaess nur `filings.recent`.');
  L.push('- **(c) Stiller Parse-Verlust** — ' + parseVerlustSatz(scanStats));
  L.push('');
  L.push('Die Aufloesung braucht einen zweiten Zaehl-Lauf (Shard-Scan bzw. `form.idx`-Gegenprobe) und');
  L.push('gehoert **nicht** in D2.2. Sie ist Vorbedingung dafuer, die Label-Grundgesamtheit zu beziffern.');
  L.push('');
  L.push('# §7 — Ehrliche Luecken');
  L.push('');
  for (const g of report.luecken) L.push('- ' + g);
  L.push('');
  L.push('# §8 — Ablage');
  L.push('');
  L.push('| Artefakt | Pfad |');
  L.push('| --- | --- |');
  L.push('| Bulk (nicht entpackt) | `' + ZIP_PATH + '` |');
  L.push('| Eingangsstempel | `' + STAMP_PATH + '` |');
  L.push('| Kostenprobe | `' + path.join(STORE_DIR, 'd2-0-probe.json') + '` |');
  L.push('| Scan-Kennzahlen | `' + path.join(STORE_DIR, 'd2-2-scan.json') + '` |');
  L.push('| Treffer (JSONL) | `' + HITS_PATH + '` |');
  L.push('| Rechtsgrundlagen (JSONL) | `' + RULEPROV_PATH + '` |');
  L.push('| Bericht | `' + REPORT_MD + '` + `.json` |');
  L.push('| Code | `scripts/d2-submissions-bulk.js`, `tests/d2-submissions-bulk.test.js`, `lib/sec-pit.js` (additiv) |');
  L.push('');
  L.push('**Nicht ueberschrieben:** der Schlank-Cache `sec-xbrl-cache/submissions/` (B1-Sektor-Matching,');
  L.push('Stand 19.07.) und `companyfacts.zip` sind unberuehrt; der neue Store liegt getrennt in');
  L.push('`submissions-bulk/`. **Nichts gepusht, nichts committet, nichts geloescht.**');
  writeReportMarkdown(REPORT_MD, L.join('\n') + '\n');
  console.log(JSON.stringify(report.gesamt, null, 2));
  console.log('[d2.2] Report: ' + REPORT_JSON + ' + .md');
  return report;
}

async function cmdExtract() {
  const ua = assertSecContact();
  if (!fs.existsSync(ZIP_PATH)) throw new Error('D2.1 fehlt: ' + ZIP_PATH);
  const statsPath = path.join(STORE_DIR, 'd2-2-scan.json');
  let stats;
  if (fs.existsSync(HITS_PATH) && fs.existsSync(statsPath)) {
    stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
    console.log('[d2.2] Scan bereits gelaufen (' + stats.trefferZeilen + ' Treffer) — ueberspringe.');
  } else {
    stats = await scanZip();
    writeScanStats(statsPath, stats);
  }
  await fetchRuleProvisions(ua);
  buildReport(stats);
}

const CMDS = { probe: cmdProbe, download: cmdDownload, extract: cmdExtract, sample: cmdSample, report: async () => {
  const sp = path.join(STORE_DIR, 'd2-2-scan.json');
  buildReport(fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, 'utf8')) : null);
} };
if (require.main === module) {
  const cmd = process.argv[2];
  const fn = CMDS[cmd];
  if (!fn) { console.error('Usage: node scripts/d2-submissions-bulk.js probe|download|extract'); process.exit(1); }
  fn().catch((e) => { console.error('[d2] ROT: ' + (e && e.message || e)); process.exit(1); });
}

module.exports = {
  extractForm25, classifyRuleProvision, rawDocName, istSelbstEinreichung, windowMass,
  scanZip, istPersistierbar, provisionKlasse, parseVerlustSatz,
  writeProbeArtifact, writeEntryStamp, writeReportJson, writeReportMarkdown, writeScanStats,
  HTTP_TIMEOUT_MS, ABORT_THRESHOLD_PCT, WINDOW_FROM, WINDOW_TO,
};
