#!/usr/bin/env node
'use strict';
/**
 * scripts/druckenmiller-13f.js — der 13F-Lauf des Druckenmiller-Moduls (Chunk 3).
 *
 * KEIN CI-SCHRITT. Nach `laneC/architektur-spec.md` §3.3 Punkt 4 ist das ein MANUELLER
 * Quartals-Lauf; er schreibt `druckenmiller-history/13f/<period>.json`, und erst der
 * Export-Schreiber baut daraus die Auslieferung. Der Tageslauf bleibt unberuehrt.
 *
 * MODI
 *   --from-dir <ordner>  Offline-Einlesen bereits geholter Informationstabellen
 *                        (`*form13f_<YYYYMMDD>.xml`). Das ist der Weg ohne Netz und die
 *                        Provenienz-Quelle der ersten acht Quartale.
 *   --fetch              Holt die Einreichungen bei der SEC (gratis, data.sec.gov). Pflicht:
 *                        SEC_CONTACT (User-Agent mit Kontakt, so verlangt es die SEC), max.
 *                        ein Abruf je 150 ms. Kein Schluessel, keine Kosten, keine neue
 *                        Abhaengigkeit.
 *   --coverage <csv>     Misst die Abdeckung der LOKALEN Namenskarte ueber eine
 *                        Emittentenliste (BUILD-SPEC §0.6 verlangt diese Messung) und
 *                        schreibt sie nach druckenmiller-history/13f/_coverage.json.
 *
 * WAS HIER NICHT PASSIERT: kein OpenFIGI (neue Abhaengigkeit = Stop-Bedingung), keine
 * Kursquelle ausser dem hauseigenen Store, keine Bewertung, keine Aussage ueber Renditen.
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const T = require('../lib/druckenmiller/thirteenf.js');
const universe = require('../lib/druckenmiller/universe.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(REPO_ROOT, 'druckenmiller-history', '13f');
const DEFAULT_SNAPSHOTS = path.join(REPO_ROOT, 'snapshots');
const CIK = '0001536411';                    // Duquesne Family Office LLC
const SEC_HOST = 'data.sec.gov';
const ARCHIVE_HOST = 'www.sec.gov';
const ABRUF_PAUSE_MS = 150;                  // SEC: hoechstens 10 Abrufe je Sekunde

/**
 * Die lokale Namenskarte: Ticker -> Firmenname aus den Snapshots. GELESEN WIRD NUR
 * `meta.name` und `meta.ticker` — die uebrigen meta-Felder gehoeren zur gesperrten F-16-Klasse
 * und haben in diesem Modul nichts zu suchen.
 */
function ladeNamenskarte(snapshotsDir, log) {
  const karte = new Map();
  if (!fs.existsSync(snapshotsDir)) {
    if (log) {
      log('::warning::[druckenmiller] 13F: kein Snapshot-Ordner unter ' + snapshotsDir
        + ' — ohne lokale Namenskarte bleibt jede Zeile ohne Ticker (Abdeckung 0). Das ist eine '
        + 'Aussage, kein Absturz.');
    }
    return karte;
  }
  for (const datei of fs.readdirSync(snapshotsDir)) {
    if (!datei.endsWith('.json') || datei.startsWith('_')) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(snapshotsDir, datei), 'utf8')); }
    catch { continue; }
    const meta = j && j.meta;
    if (!meta || !meta.ticker || !meta.name) continue;
    if (meta.country !== 'United States') continue;      // Lane B: nur US-Notierungen
    if (universe.hasSuffix(meta.ticker)) continue;        // reiner String-Test, F-16-frei
    karte.set(meta.ticker, meta.name);
  }
  return karte;
}

/** Schlusskurse am Periodenende je Ticker aus dem hauseigenen Store (fuer die Preisprobe). */
function ladeSchlusskurse(pricesDir, periodEnd, karte, log) {
  const store = require('../lib/price-history-store.js');
  const kurse = new Map();
  if (!fs.existsSync(pricesDir)) return kurse;
  const perShard = new Map();
  for (const ticker of karte.keys()) {
    const n = store.shardOf(ticker);
    if (!perShard.has(n)) perShard.set(n, []);
    perShard.get(n).push(ticker);
  }
  for (const [n, tickers] of perShard) {
    let shard;
    try { shard = store.loadShard(pricesDir, n); } catch { continue; }
    if (!shard) continue;
    for (const t of tickers) {
      const serie = shard[t];
      if (!Array.isArray(serie)) continue;
      // Der letzte Balken AM oder VOR dem Periodenende — nie einer danach.
      let letzter = null;
      for (const b of serie) {
        if (!b || !b.date || !Number.isFinite(b.close)) continue;
        if (b.date <= periodEnd && (!letzter || b.date > letzter.date)) letzter = b;
      }
      if (letzter) kurse.set(t, letzter.close);
    }
  }
  if (log) log('[druckenmiller] 13F: ' + kurse.size + ' Schlusskurse zum ' + periodEnd + ' aus dem Store.');
  return kurse;
}

/** Ein Quartal schreiben (eine Datei je Periode, damit Aenderungen im Diff sichtbar sind). */
function schreibeQuartal(outDir, quartal) {
  fs.mkdirSync(outDir, { recursive: true });
  const p = path.join(outDir, quartal.period + '.json');
  fs.writeFileSync(p, JSON.stringify(quartal, null, 1) + '\n');
  return p;
}

const periodeAus = (dateiname) => {
  const m = dateiname.match(/(\d{4})(\d{2})(\d{2})\.xml$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

function offlineEinlesen({ fromDir, outDir, snapshotsDir, pricesDir, log }) {
  const dateien = fs.readdirSync(fromDir).filter((f) => /form13f_\d{8}\.xml$/.test(f)).sort();
  if (!dateien.length) {
    throw new Error('[druckenmiller] 13F: keine *form13f_<YYYYMMDD>.xml in ' + fromDir + '.');
  }
  const karte = ladeNamenskarte(snapshotsDir, log);
  const nameIndex = karte.size ? T.buildNameIndex(karte) : null;
  const letzte = dateien.slice(-T.QUARTERS_PUBLISHED);
  log('[druckenmiller] 13F: ' + dateien.length + ' Einreichungen gefunden, verarbeitet werden die '
    + letzte.length + ' jüngsten (Vertrag: ' + T.QUARTERS_PUBLISHED + ' Quartale); Namenskarte '
    + karte.size + ' US-Ticker.');
  let vorher = null;
  const geschrieben = [];
  // Ein Quartal davor wird nur gelesen, um `new`/`exited` des ersten Quartals zu haben.
  const mitVorlauf = dateien.slice(Math.max(0, dateien.length - T.QUARTERS_PUBLISHED - 1));
  for (const datei of mitVorlauf) {
    const period = periodeAus(datei);
    if (!period) continue;
    const xml = fs.readFileSync(path.join(fromDir, datei), 'utf8');
    const kurse = pricesDir ? ladeSchlusskurse(pricesDir, period, karte, null) : null;
    const quartal = T.buildQuarter({
      period, xml, nameIndex, closes: kurse && kurse.size ? kurse : null,
      previousCusips: vorher, now: new Date(),
      filedAt: null, acceptedAt: null,
    });
    vorher = new Set(quartal.rows.filter((r) => r.putCall === null && Number.isFinite(r.valueUSD))
      .map((r) => r.cusip));
    if (!letzte.includes(datei)) continue;               // war nur der Vorlauf
    schreibeQuartal(outDir, quartal);
    geschrieben.push(quartal);
    log('[druckenmiller] 13F ' + period + ': ' + quartal.positions + ' Positionen · '
      + (quartal.totalValueUSD === null ? 'Wert unbekannt'
        : (quartal.totalValueUSD / 1e9).toFixed(3) + ' Mrd USD')
      + ' · Einheit ' + quartal.units + ' (' + quartal.unitCheck.mode + ')'
      + ' · Top10 ' + (quartal.top10Share === null ? 'n/a' : (quartal.top10Share * 100).toFixed(1) + ' %')
      + ' · Abdeckung ' + (quartal.coverage === null ? 'n/a' : (quartal.coverage * 100).toFixed(1) + ' %')
      + (quartal.quarantined ? ' · QUARANTAENE: ' + quartal.quarantineReason : ''));
  }
  return geschrieben;
}

/** Ein GET gegen die SEC, mit dem von ihr verlangten Kontakt-User-Agent. */
function hole(host, pfad) {
  const kontakt = process.env.SEC_CONTACT;
  if (!kontakt) {
    return Promise.reject(new Error('[druckenmiller] 13F --fetch braucht SEC_CONTACT (z. B. '
      + '"Karl Viehrig karl@example.com"). Die SEC verlangt einen Kontakt im User-Agent; ohne ihn '
      + 'wird gesperrt, und ein anonymer Abruf ist keine Option.'));
  }
  return new Promise((resolve, reject) => {
    const req = https.get({
      host, path: pfad,
      headers: { 'User-Agent': kontakt, 'Accept-Encoding': 'gzip, deflate', Host: host },
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('[druckenmiller] 13F: ' + host + pfad + ' antwortete ' + res.statusCode));
        return;
      }
      const teile = [];
      res.on('data', (d) => teile.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(teile);
        const enc = res.headers['content-encoding'];
        if (!enc) return resolve(buf.toString('utf8'));
        const zlib = require('node:zlib');
        try {
          resolve((enc === 'gzip' ? zlib.gunzipSync(buf) : zlib.inflateSync(buf)).toString('utf8'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('[druckenmiller] 13F: Zeitueberschreitung bei ' + pfad)));
  });
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

async function holen({ outDir, snapshotsDir, pricesDir, log }) {
  const roh = await hole(SEC_HOST, '/submissions/CIK' + CIK + '.json');
  const j = JSON.parse(roh);
  const recent = j.filings && j.filings.recent;
  if (!recent || !Array.isArray(recent.form)) {
    throw new Error('[druckenmiller] 13F: die Einreichungsliste der SEC hat eine andere Form als erwartet.');
  }
  const kandidaten = [];
  for (let i = 0; i < recent.form.length; i++) {
    if (!/^13F-HR/.test(recent.form[i])) continue;
    kandidaten.push({
      accession: recent.accessionNumber[i].replace(/-/g, ''),
      period: recent.reportDate[i],
      filedAt: recent.filingDate[i],
      acceptedAt: recent.acceptanceDateTime ? recent.acceptanceDateTime[i] : null,
      form: recent.form[i],
    });
  }
  kandidaten.sort((a, b) => (a.period < b.period ? -1 : 1));
  const zuHolen = kandidaten.slice(-(T.QUARTERS_PUBLISHED + 1));
  log('[druckenmiller] 13F: ' + kandidaten.length + ' 13F-HR gelistet, geholt werden ' + zuHolen.length + '.');
  const karte = ladeNamenskarte(snapshotsDir, log);
  const nameIndex = karte.size ? T.buildNameIndex(karte) : null;
  let vorher = null;
  const geschrieben = [];
  for (const k of zuHolen) {
    await warte(ABRUF_PAUSE_MS);
    const verzeichnis = '/Archives/edgar/data/' + Number(CIK) + '/' + k.accession + '/index.json';
    const idx = JSON.parse(await hole(ARCHIVE_HOST, verzeichnis));
    const eintraege = (idx.directory && idx.directory.item) || [];
    // Die Informationstabelle ist die XML-Datei, die NICHT das Deckblatt ist.
    const tabelle = eintraege.find((e) => /\.xml$/i.test(e.name) && !/primary_doc/i.test(e.name));
    if (!tabelle) {
      log('::warning::[druckenmiller] 13F ' + k.period + ': keine Informationstabelle im Index — uebersprungen.');
      continue;
    }
    await warte(ABRUF_PAUSE_MS);
    const xml = await hole(ARCHIVE_HOST, '/Archives/edgar/data/' + Number(CIK) + '/' + k.accession + '/' + tabelle.name);
    const kurse = pricesDir ? ladeSchlusskurse(pricesDir, k.period, karte, null) : null;
    const quartal = T.buildQuarter({
      period: k.period, xml, nameIndex, closes: kurse && kurse.size ? kurse : null,
      previousCusips: vorher, now: new Date(),
      filedAt: k.filedAt, acceptedAt: k.acceptedAt,
    });
    vorher = new Set(quartal.rows.filter((r) => r.putCall === null && Number.isFinite(r.valueUSD))
      .map((r) => r.cusip));
    if (k === zuHolen[0] && zuHolen.length > T.QUARTERS_PUBLISHED) continue;   // Vorlauf-Quartal
    schreibeQuartal(outDir, quartal);
    geschrieben.push(quartal);
    log('[druckenmiller] 13F ' + k.period + ' (' + k.form + ', angenommen ' + (k.acceptedAt || 'n/a') + '): '
      + quartal.positions + ' Positionen, Einheit ' + quartal.units
      + (quartal.quarantined ? ', QUARANTAENE: ' + quartal.quarantineReason : ''));
  }
  return geschrieben;
}

/** Abdeckungs-Messung der lokalen Namenskarte (BUILD-SPEC §0.6). */
function abdeckungMessen({ csvPfad, outDir, snapshotsDir, log }) {
  const text = fs.readFileSync(csvPfad, 'utf8');
  const zeilen = text.split('\n').map((z) => z.trim()).filter(Boolean);
  const kopf = zeilen[0].split(',').map((s) => s.trim().toLowerCase());
  const iCusip = kopf.indexOf('cusip'), iIssuer = kopf.indexOf('issuer');
  if (iCusip < 0 || iIssuer < 0) {
    throw new Error('[druckenmiller] 13F: die Emittentenliste braucht die Spalten cusip und issuer.');
  }
  const issuers = zeilen.slice(1).map((z) => {
    const teile = z.split(',');
    return { cusip: teile[iCusip], issuer: teile.slice(iIssuer).join(',').replace(/^"|"$/g, '') };
  }).filter((x) => x.cusip && x.issuer);
  const karte = ladeNamenskarte(snapshotsDir, log);
  const ergebnis = T.matcherCoverage(issuers, T.buildNameIndex(karte));
  const bericht = {
    _was: 'Abdeckung der LOKALEN Namenskarte (Snapshots, nur meta.name) ueber die Emittentenliste '
      + 'des 13F-Bestands. BUILD-SPEC v1 §0.6 verlangt diese Messung; OpenFIGI ist ausgeschlossen.',
    gemessenAm: new Date().toISOString(),
    quelleListe: path.basename(csvPfad),
    nameMapSize: karte.size,
    issuers: ergebnis.n,
    matched: ergebnis.matched,
    share: ergebnis.share,
    ambiguous: ergebnis.ambiguous,
    identityRejected: ergebnis.identityRejected,
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '_coverage.json'), JSON.stringify(bericht, null, 1) + '\n');
  log('[druckenmiller] 13F-Abdeckung: ' + ergebnis.matched + ' von ' + ergebnis.n + ' Emittenten ('
    + (ergebnis.share * 100).toFixed(1) + ' %) ueber ' + karte.size + ' lokale Namen; '
    + ergebnis.ambiguous + ' mehrdeutig, ' + ergebnis.identityRejected + ' von der Identitaets-Wache abgelehnt.');
  return bericht;
}

async function main(argv, log) {
  const args = argv || process.argv.slice(2);
  const say = log || console.log;
  const get = (k, dflt) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : dflt; };
  const outDir = path.resolve(get('--out', DEFAULT_OUT));
  const snapshotsDir = path.resolve(get('--snapshots', DEFAULT_SNAPSHOTS));
  const pricesDir = args.includes('--no-prices') ? null : path.resolve(get('--prices-dir', path.join(REPO_ROOT, 'prices')));
  if (args.includes('--coverage')) {
    abdeckungMessen({ csvPfad: path.resolve(get('--coverage')), outDir, snapshotsDir, log: say });
    return 0;
  }
  if (args.includes('--from-dir')) {
    offlineEinlesen({ fromDir: path.resolve(get('--from-dir')), outDir, snapshotsDir, pricesDir, log: say });
    return 0;
  }
  if (args.includes('--fetch')) {
    await holen({ outDir, snapshotsDir, pricesDir, log: say });
    return 0;
  }
  say('Aufruf: node scripts/druckenmiller-13f.js --from-dir <ordner> | --fetch | --coverage <csv>'
    + ' [--out <ordner>] [--snapshots <ordner>] [--prices-dir <ordner>|--no-prices]');
  return 1;
}

module.exports = { main, ladeNamenskarte, ladeSchlusskurse, offlineEinlesen, abdeckungMessen, CIK };

if (require.main === module) {
  main().then((rc) => process.exit(rc)).catch((e) => {
    console.log('::error::' + (e && e.message ? e.message : String(e)));
    process.exit(1);
  });
}
