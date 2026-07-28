#!/usr/bin/env node
'use strict';
/**
 * PHASE 4.1 — SEC-Langhistorie aus dem BULK-Archiv (Regenerierungs-Tool, offline/periodisch)
 * =========================================================================================
 * Holt die tiefen Jahresreihen fuer ALLE US-Namen des Universums und schreibt sie nach
 * external-data/sec-annual-bulk.jsonl — EIN Objekt je Zeile.
 *
 * ⚠ DIESE DATEI FUETTERT DAS SCORING NICHT. Sie ist die Datenbasis fuer den
 * Verlaesslichkeits-Bericht (scripts/roic-reliability.js). Das Urteil vom 28.07.
 * (_URTEIL-4.1-2026-07-28.md) haelt W_ROIC_STABILITY bei 0, bis ein praeregistriertes
 * Split-Half-rho klar ueber 0,35 liegt. Der Scorer liest weiterhin nur sec-secannual.json.
 *
 * WARUM BULK STATT EINZELABRUF (Urteil, Auflage 3):
 * build-secannual.js waehlt seine Kandidaten mit dem Filter des ZYKLUS-DAEMPFERS
 * (oscExcess/revMaxDrawdown/signFlips) — der sucht SCHWANKENDE Firmen. Die
 * ROIC-Stabilitaets-Achse braucht das Gegenteil. Ergebnis heute: 124 Namen, davon 6 im
 * Quality-Board. Wer den Filter stehen laesst, bekommt auch mit Bulk dieselben 124.
 * Hier gibt es deshalb KEINEN Kandidaten-Filter: US-geroutet reicht.
 *
 * WARUM NICHT EIN DURCHLAUF UEBER 1,39 GB:
 * Das Archiv traegt sein Inhaltsverzeichnis am Ende. Wer es zuerst liest (1,77 MB), kennt
 * Position und Groesse jedes der 20.102 Eintraege — und holt dann per Range-Abruf NUR die
 * gebrauchten. Benachbarte Eintraege werden zu einem Abruf zusammengefasst; bei ~14 %
 * Trefferquote sind das Groessenordnungen weniger Anfragen als Eintraege.
 * Nebenwirkung, die zaehlt: ein Abbruch kostet einen Block, nicht 1,39 GB.
 *
 * Run:  node scripts/fetch-secbulk.js [--limit N] [--out <pfad>]
 *       SEC ist gratis. Nichts Unkomprimiertes landet auf Platte.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const ROOT = path.join(__dirname, '..');
const zip = require(path.join(ROOT, 'lib/zip-stream.js'));

const SNAP = process.env.SEC_SNAPSHOTS_DIR || path.join(ROOT, 'snapshots');
const OUT_DEFAULT = path.join(ROOT, 'external-data', 'sec-annual-bulk.jsonl');
const BULK_URL = 'https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip';
const UA = require(path.join(ROOT, 'lib/sec-user-agent.js')).secUserAgent();
const { route, isUS } = require(path.join(ROOT, 'src/scoring/router.js'));
const { extractSecSeries } = require(path.join(ROOT, 'merge-sec-xbrl.js'));
const { fetchSecTickers } = require(path.join(ROOT, 'discovery/sec-tickers.js'));

// SEC erlaubt 10 Anfragen/s. Wir bleiben deutlich darunter — der Lauf ist monatlich,
// Eile bringt nichts, ein Ban braeche die Kette.
const PAUSE_MS = 150;
// Zwei Eintraege werden zu EINEM Abruf zusammengefasst, wenn die Luecke dazwischen kleiner
// ist als das hier. Groesser = weniger Anfragen, aber mehr weggeworfene Bytes.
//
// NICHT geschaetzt, sondern am echten Verzeichnis gemessen (28.07., 2.234 von 20.102
// Eintraegen gesucht, Archiv 1.391 MB):
//     Luecke      Bloecke   Transfer   Ersparnis
//        0 KB       1.891     390 MB       72 %
//      256 KB       1.091     482 MB       65 %   <== gewaehlt
//      512 KB         639     656 MB       53 %
//        2 MB          73   1.212 MB       13 %
// Der erste Ansatz (2 MB) sparte praktisch nichts: bei 11 % Trefferdichte liegt der
// mittlere Abstand zweier gesuchter Eintraege unter der Toleranz, also verschmolz alles
// zu 73 Riesenbloecken und der gezielte Abruf war wieder ein Volldownload.
// 256 KB ist der Knick: ab hier kostet jede weitere Halbierung mehr Anfragen als sie
// Bytes spart. Etwas langsamer als 2 MB (mehr Pausen), aber ein Drittel des Datenvolumens —
// bei einem Monatslauf ist die Uhr egal und die Last bei der SEC nicht.
const LUECKE_MAX = 256 * 1024;
const BLOCK_MAX = 48 * 1024 * 1024;   // Obergrenze je Abruf, damit ein Fehlschlag billig bleibt

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** HTTPS-GET mit optionalem Range. Liefert einen Buffer. */
function hole(url, range, tiefe = 0) {
  if (tiefe > 5) return Promise.reject(new Error('zu viele Weiterleitungen'));
  const headers = { 'User-Agent': UA, 'Accept-Encoding': 'identity' };
  if (range) headers.Range = 'bytes=' + range[0] + '-' + range[1];
  return new Promise((res, rej) => {
    const req = https.get(url, { headers }, (r) => {
      if (r.statusCode === 301 || r.statusCode === 302) {
        r.resume();
        return hole(r.headers.location, range, tiefe + 1).then(res).catch(rej);
      }
      // 206 = Teilinhalt (Range akzeptiert), 200 = Vollinhalt.
      if (r.statusCode !== 200 && r.statusCode !== 206) { r.resume(); return rej(new Error('HTTP ' + r.statusCode)); }
      // Fail-loud: liefert der Server trotz Range die GANZE Datei (Range ignoriert), waeren
      // das 1,39 GB im Speicher. Lieber sofort abbrechen als den Runner sprengen.
      if (range && r.statusCode === 200) { r.destroy(); return rej(new Error('Server ignoriert Range-Anfragen — Abbruch statt 1,39 GB in den Speicher')); }
      const c = [];
      r.on('data', (d) => c.push(d));
      r.on('end', () => res(Buffer.concat(c)));
      r.on('error', rej);
    });
    req.on('error', rej);
    req.setTimeout(120000, () => { req.destroy(); rej(new Error('Zeitueberschreitung')); });
  });
}

/** Gesamtgroesse per HEAD — ohne sie kann man das Datei-Ende nicht adressieren. */
function groesse(url, tiefe = 0) {
  if (tiefe > 5) return Promise.reject(new Error('zu viele Weiterleitungen'));
  return new Promise((res, rej) => {
    const req = https.request(url, { method: 'HEAD', headers: { 'User-Agent': UA } }, (r) => {
      r.resume();
      if (r.statusCode === 301 || r.statusCode === 302) return groesse(r.headers.location, tiefe + 1).then(res).catch(rej);
      if (r.statusCode !== 200) return rej(new Error('HEAD HTTP ' + r.statusCode));
      const n = Number(r.headers['content-length']);
      if (!Number.isFinite(n) || n <= 0) return rej(new Error('HEAD ohne brauchbare content-length'));
      res(n);
    });
    req.on('error', rej);
    req.setTimeout(60000, () => { req.destroy(); rej(new Error('HEAD-Zeitueberschreitung')); });
    req.end();
  });
}

/**
 * Fasst Eintraege zu Abruf-Bloecken zusammen.
 * Reine Funktion — der ganze Sparmechanismus steckt hier, also ist er einzeln testbar.
 */
function baueBloecke(eintraege, lueckeMax = LUECKE_MAX, blockMax = BLOCK_MAX) {
  const sortiert = eintraege.slice().sort((a, b) => a.lfhOffset - b.lfhOffset);
  const bloecke = [];
  for (const e of sortiert) {
    const bis = e.lfhOffset + zip.bytesFuer(e) - 1;
    const letzter = bloecke[bloecke.length - 1];
    const passt = letzter
      && e.lfhOffset - letzter.bis <= lueckeMax
      && bis - letzter.von + 1 <= blockMax;
    if (passt) { letzter.bis = Math.max(letzter.bis, bis); letzter.eintraege.push(e); }
    else bloecke.push({ von: e.lfhOffset, bis, eintraege: [e] });
  }
  return bloecke;
}

/** Alle US-gerouteten Ticker des Universums — KEIN Kandidaten-Filter (Urteil, Auflage 3). */
function usTicker() {
  const raus = [];
  let dateien;
  try { dateien = fs.readdirSync(SNAP); } catch (_) { return raus; }
  for (const f of dateien) {
    if (!f.endsWith('.json') || f.startsWith('_manifest') || f === '_last_good_disk.json') continue;
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(SNAP, f), 'utf8')); } catch (_) { continue; }
    if (!s || !s.meta || !s.meta.ticker) continue;
    if (route(s).action !== 'route') continue;
    if (!isUS(s)) continue;
    raus.push(s.meta.ticker);
  }
  return raus;
}

/**
 * Bildet CIK -> Ticker ab. 1.471 CIKs tragen MEHRERE Ticker (GOOGL/GOOG, BRK-A/BRK-B).
 * Beim ticker-getriebenen Abruf war das egal; hier wird je CIK genau einmal geholt und das
 * Ergebnis auf alle zugehoerigen Ticker verteilt.
 */
function cikKarte(ticker, tmap) {
  const proCik = new Map();
  let ohneCik = 0;
  for (const tk of ticker) {
    const e = tmap.get(tk);
    if (!e || !e.cik) { ohneCik += 1; continue; }
    const cik = String(e.cik).replace(/\D/g, '').padStart(10, '0');
    if (!proCik.has(cik)) proCik.set(cik, []);
    proCik.get(cik).push(tk);
  }
  return { proCik, ohneCik };
}

async function run() {
  const argv = process.argv.slice(2);
  const limitIdx = argv.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : Infinity;
  const outIdx = argv.indexOf('--out');
  const OUT = outIdx >= 0 ? argv[outIdx + 1] : OUT_DEFAULT;

  const ticker = usTicker();
  if (ticker.length === 0) {
    // Fail-loud, nicht der stille No-Op von build-secannual.js: ein leeres Universum ist hier
    // IMMER ein Fehler (fehlender Snapshot-Restore), nie ein zulaessiger Zustand.
    console.error('::error::fetch-secbulk: leeres Universum — snapshots/ nicht wiederhergestellt?');
    process.exit(1);
  }
  const tmap = await fetchSecTickers();
  const { proCik, ohneCik } = cikKarte(ticker, tmap);
  console.log('US-geroutet: ' + ticker.length + ' Ticker -> ' + proCik.size + ' CIKs (ohne CIK: ' + ohneCik + ')');

  const gesamt = await groesse(BULK_URL);
  console.log('Archiv: ' + (gesamt / 1e9).toFixed(2) + ' GB');

  const schwanzVon = Math.max(0, gesamt - zip.EOCD_MAX_SUCHE);
  const schwanz = await hole(BULK_URL, [schwanzVon, gesamt - 1]);
  const zeiger = zip.leseVerzeichnisZeiger(schwanz, gesamt);
  console.log('Verzeichnis: ' + zeiger.anzahl + ' Eintraege, ' + (zeiger.cdGroesse / 1e6).toFixed(2) + ' MB' + (zeiger.zip64 ? ' (ZIP64)' : ''));

  await sleep(PAUSE_MS);
  const cd = await hole(BULK_URL, [zeiger.cdOffset, zeiger.cdOffset + zeiger.cdGroesse - 1]);
  // anzahlErwartet: wirft, wenn das Verzeichnis nicht vollstaendig gelesen wurde. Ohne diese
  // Pruefung faende der Lauf still zu wenige Firmen — und das saehe wie ein Datenproblem aus.
  const alle = zip.leseVerzeichnis(cd, zeiger.anzahl);

  const gewuenscht = [];
  for (const e of alle) {
    const m = e.name.match(/CIK(\d{10})\.json$/);
    if (m && proCik.has(m[1])) gewuenscht.push(Object.assign({ cik: m[1] }, e));
  }
  const fehlend = proCik.size - new Set(gewuenscht.map((e) => e.cik)).size;
  console.log('Treffer: ' + gewuenscht.length + ' von ' + proCik.size + ' CIKs (' + fehlend + ' haben keine companyfacts)');

  const auswahl = Number.isFinite(limit) ? gewuenscht.slice(0, limit) : gewuenscht;
  const bloecke = baueBloecke(auswahl);
  const bytes = bloecke.reduce((s, b) => s + (b.bis - b.von + 1), 0);
  console.log('Abrufe: ' + bloecke.length + ' Bloecke, ' + (bytes / 1e6).toFixed(0) + ' MB'
    + ' (statt ' + (gesamt / 1e9).toFixed(2) + ' GB Volldurchlauf)');

  const strom = fs.createWriteStream(OUT + '.tmp');
  let geschrieben = 0, kaputt = 0;
  for (let i = 0; i < bloecke.length; i++) {
    const b = bloecke[i];
    let block;
    try { block = await hole(BULK_URL, [b.von, Math.min(b.bis, gesamt - 1)]); }
    catch (e) { console.error('Block ' + i + ' fehlgeschlagen: ' + e.message); kaputt += b.eintraege.length; await sleep(PAUSE_MS * 4); continue; }
    for (const e of b.eintraege) {
      try {
        const roh = zip.entpackeEintrag(block.subarray(e.lfhOffset - b.von), e);
        const cf = JSON.parse(roh.toString('utf8'));
        const reihen = extractSecSeries(cf);
        for (const tk of proCik.get(e.cik)) {
          strom.write(JSON.stringify({ ticker: tk, cik: e.cik, name: cf.entityName || null, annual: reihen.annual }) + '\n');
          geschrieben += 1;
        }
      } catch (err) { kaputt += 1; }
    }
    if (i % 25 === 0 || i === bloecke.length - 1) {
      console.log('  ' + (i + 1) + '/' + bloecke.length + ' Bloecke · ' + geschrieben + ' Zeilen');
    }
    await sleep(PAUSE_MS);
  }
  await new Promise((res) => strom.end(res));
  fs.renameSync(OUT + '.tmp', OUT);
  console.log('fertig: ' + geschrieben + ' Zeilen -> ' + OUT + ' (' + (fs.statSync(OUT).size / 1e6).toFixed(1) + ' MB)'
    + (kaputt ? ' | unlesbar: ' + kaputt : ''));
}

module.exports = { baueBloecke, cikKarte, usTicker, BULK_URL };

if (require.main === module) run().catch((e) => { console.error('::error::' + e.message); process.exit(1); });
