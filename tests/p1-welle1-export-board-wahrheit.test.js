'use strict';
/**
 * P1-Welle 1 (09.08.2026) — Bucket a: "Was auf dem Board/Export steht, stimmt nicht".
 * ===================================================================================
 * Gemeinsamer Nenner: der Export/das Board zeigt eine Zahl, die der letzte Lauf
 * NICHT gemessen hat — und nichts sagt es.
 *
 *   F-CGPT-024   scripts/write-findash-export.js   alter Index schlaegt frischen Fehlermarker
 *   F-CGPT-040   scripts/write-findash-export.js   --check haelt unlesbaren Index fuer Schema-OK
 *   AS-SK-002    scripts/reconcile-smallcap.js     _meta.count bleibt auf dem Vorbestand stehen
 *   AT-SK-ATH-001 scripts/update-ath-state.js      ATH aus der Zukunft wird als "vor 0 Monaten" angezeigt
 *   R1-SK-010    watchlist.json / refresh-universe.js  zwei Zeilen, ein yahoo_symbol -> Board-Dublette
 *
 * (AT-SK-REGION-001 steht bewusst NICHT hier: lib/region-mapping.js::getRegion hat
 *  keinen einzigen Produktionsaufrufer — der tote Zweig erreicht kein Board. Der
 *  Nicht-Aufruf ist unten als Wachposten festgenagelt, damit ein spaeterer Aufrufer
 *  nicht still in den OTHER-Eimer laeuft.)
 *
 * Kein Netz, keine Frameworks. Tmp-Verzeichnisse statt echter outputs/ — kein Test-
 * lauf darf eine produktive Datei anfassen.
 * Run: node tests/p1-welle1-export-board-wahrheit.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const wfe = require('../scripts/write-findash-export.js');
const { displayFor } = require('../scripts/update-ath-state.js');
const { kollabiereYahooDubletten } = require('../refresh-universe.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p1w1-'));
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack ? e.stack : e)); }
}
const tmpdir = (p) => fs.mkdtempSync(path.join(TMP, p));
// mtime explizit setzen: die Reihenfolge zweier Schreibvorgaenge innerhalb einer
// Millisekunde ist sonst nicht deterministisch, und genau die Reihenfolge ist hier
// die Aussage.
function schreibeMit(p, inhalt, sekunden) {
  fs.writeFileSync(p, inhalt);
  const t = new Date(Date.UTC(2026, 7, 9, 0, 0, sekunden));
  fs.utimesSync(p, t, t);
}

// ── F-CGPT-024: der FRISCHERE Zustand gewinnt, nicht der Dateityp ────────────────────
// Belegt (Sweep-Verifikation, Harness 24): schlaegt das Loeschen des alten index.json
// fehl (ACL/Handle), schreibt der Fehlerpfad danach _failed — und beide liegen da.
// qualityExportMode prueft index ZUERST und meldet 'export': der Export serviert das
// Board des VORLAUFS und maskiert den QC-Ausfall dieses Laufs, still und mit Exit 0.
// Die Umkehrung (Marker zuerst) waere die naechste Ganztags-Ausfallklasse: ein stehen
// gebliebenes _failed eines Vorlaufs wuerde jeden spaeteren Erfolgslauf blenden
// (Tag-343-Semantik). Deshalb entscheidet die Frische — beide Richtungen geprueft.
for (const [label, modeOf] of [['quality', wfe.qualityExportMode], ['smallcap', wfe.smallcapExportMode]]) {
  test(`F-CGPT-024 ${label}: frischer Fehlermarker schlaegt den alten Index`, () => {
    const d = tmpdir(label + '-a-');
    schreibeMit(path.join(d, 'index.json'), '{"boards":["x"]}', 10);
    schreibeMit(path.join(d, '_failed'), '{"reason":"boom"}', 20);
    assert.equal(modeOf(d), 'failed',
      'der QC-/Small-Cap-Ausfall dieses Laufs wird vom liegen gebliebenen Index des Vorlaufs maskiert');
  });

  test(`F-CGPT-024 ${label}: frischer Index schlaegt den alten Fehlermarker (keine neue Ausfallklasse)`, () => {
    const d = tmpdir(label + '-b-');
    schreibeMit(path.join(d, '_failed'), '{"reason":"gestern"}', 10);
    schreibeMit(path.join(d, 'index.json'), '{"boards":["x"]}', 20);
    assert.equal(modeOf(d), 'export',
      'ein stehen gebliebenes _failed des Vorlaufs darf den frischen Erfolgslauf nicht blenden');
  });

  test(`F-CGPT-024 ${label}: nur Index -> export, nur Marker -> failed, nichts -> absent`, () => {
    const nur = (datei) => { const d = tmpdir(label + '-c-'); if (datei) schreibeMit(path.join(d, datei), '{}', 10); return modeOf(d); };
    assert.equal(nur('index.json'), 'export');
    assert.equal(nur('_failed'), 'failed');
    assert.equal(nur(null), 'absent');
  });

  test(`F-CGPT-024 ${label}: Gleichstand ist kein Muenzwurf (betrieblich unerreichbar -> export)`, () => {
    const d = tmpdir(label + '-d-');
    schreibeMit(path.join(d, 'index.json'), '{"boards":["x"]}', 30);
    schreibeMit(path.join(d, '_failed'), '{"reason":"x"}', 30);
    assert.equal(modeOf(d), 'export',
      'zwei Writes im selben Millisekunden-Fenster (nur in Tests erreichbar) muessen ein STABILES '
      + 'Urteil ergeben — sonst flackert jeder Test, der beide Dateien hintereinander schreibt');
  });
}

test('F-CGPT-024 E2E: buildQuality exportiert bei frischem Marker den Marker, kein Alt-Board', () => {
  const qualityDir = tmpdir('q-src-');
  const qoutDir = tmpdir('q-out-');
  schreibeMit(path.join(qualityDir, 'index.json'), JSON.stringify({ boards: ['quality-alt'] }), 10);
  schreibeMit(path.join(qualityDir, 'quality-alt.json'), JSON.stringify({ profitable: [], unprofitable: [] }), 10);
  schreibeMit(path.join(qualityDir, '_failed'), JSON.stringify({ reason: 'qc-pass geworfen' }), 20);
  const r = wfe.buildQuality(null, { qualityDir, qoutDir });
  assert.equal(r.failed, true, 'der Ausfall wird nicht als solcher zurueckgemeldet');
  assert.ok(fs.existsSync(path.join(qoutDir, '_failed')), 'der Fehlermarker fehlt im Export');
  assert.ok(!fs.existsSync(path.join(qoutDir, 'index.json')),
    'ein Board-Index steht im Export, obwohl der QC-Pass dieses Laufs gescheitert ist');
  assert.ok(!fs.existsSync(path.join(qoutDir, 'alt.json')),
    'das Board des Vorlaufs wurde erneut publiziert');
});

// ── F-CGPT-040: "nicht da" und "da, aber unlesbar" sind nicht dasselbe ───────────────
// readJSONOrNull liefert fuer beides null; der Optional-Zweig (`if (!idx) return []`)
// macht daraus in beiden Faellen "kein Verstoss". --check bescheinigt damit einem
// vorhandenen, korrupten Export Schema-Konformitaet.
for (const [label, sub, validate] of [
  ['quality', 'quality', wfe.validateQualityExport],
  ['smallcap', 'smallcap', wfe.validateSmallcapExport],
]) {
  test(`F-CGPT-040 ${label}: vorhandener, unlesbarer Index ist ein Verstoss`, () => {
    const d = tmpdir(label + '-v-');
    fs.writeFileSync(path.join(d, 'index.json'), '{"schema":"v1","boards":[');
    const errs = validate(d);
    assert.ok(errs.length > 0,
      '--check haelt einen vorhandenen, unlesbaren ' + sub + '/index.json fuer Schema-OK');
    assert.ok(errs.some((e) => String(e).startsWith(sub + '/')),
      'der Verstoss traegt nicht das ' + sub + '/-Praefix und landet im falschen Alarmkanal: ' + JSON.stringify(errs));
  });

  test(`F-CGPT-040 ${label}: fehlender Index bleibt optional (kein Verstoss)`, () => {
    assert.deepEqual(validate(tmpdir(label + '-w-')), [],
      'ein abwesender Optional-Feed darf den Gate nicht rot faerben');
  });
}

// ── AS-SK-002: die Metadaten muessen die geschriebene Liste beschreiben ──────────────
// Object.assign({}, wl, {stocks: behalten}) kopiert _meta unveraendert mit — inklusive
// count. Live: watchlist-smallcap.json meldet 775 bei 540 Zeilen (Delta 235).
test('AS-SK-002 E2E: reconcile-smallcap zieht _meta.count auf die geschriebene Liste nach', () => {
  const dir = tmpdir('sc-');
  const wlPfad = path.join(dir, 'watchlist-smallcap.json');
  const snaps = path.join(dir, 'snapshots-smallcap'); fs.mkdirSync(snaps);
  const mainPfad = path.join(dir, 'watchlist.json');
  const stocks = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'TOT'].map((t) => ({ ticker: t }));
  fs.writeFileSync(wlPfad, JSON.stringify({ _meta: { count: stocks.length, band: { minUsd: 3e8, maxUsd: 8e8 } }, stocks }));
  fs.writeFileSync(mainPfad, JSON.stringify({ stocks: [] }));
  // genau EIN entprellt delisteter Name -> 12,5 % < 25 % Ueberprune-Sperre, Liste < 500
  fs.writeFileSync(path.join(snaps, 'TOT.json'), JSON.stringify({ meta: { delisted: true, asOf: new Date().toISOString() } }));

  const argv = process.argv;
  process.argv = ['node', 'reconcile-smallcap.js', '--watchlist', wlPfad, '--snapshots', snaps, '--main-watchlist', mainPfad];
  try { delete require.cache[require.resolve('../scripts/reconcile-smallcap.js')]; require('../scripts/reconcile-smallcap.js').main(); }
  finally { process.argv = argv; }

  const nach = JSON.parse(fs.readFileSync(wlPfad, 'utf8'));
  assert.equal(nach.stocks.length, 7, 'der delistete Name wurde gar nicht entfernt — die Probe belegt nichts');
  assert.equal(nach._meta.count, nach.stocks.length,
    '_meta.count beschreibt weiter den VORBESTAND (' + nach._meta.count + ') statt der geschriebenen Liste (' + nach.stocks.length + ')');
  assert.equal(nach._meta.band.maxUsd, 8e8, 'die uebrigen _meta-Felder duerfen dabei nicht verloren gehen');
});

// ── AT-SK-ATH-001: ein ATH aus der Zukunft ist keine Anzeige ────────────────────────
// ath/athDate kommen aus dem Max-Batch (prices-max/), lastClose/lastDate aus dem
// rollenden 400-Tage-Store. Bleibt ein Ticker im 400d-Store stehen, liegt athDate
// VOR dem letzten Schlusskurs — monthsBetween klemmt die negative Differenz auf 0 und
// die Zeile behauptet "ATH heute". Live: 1 von 956 Eintraegen (CSH-UN.TO).
test('AT-SK-ATH-001: athDate nach lastDate -> keine Anzeige statt "vor 0 Monaten"', () => {
  const d = displayFor({ ath: 200, athDate: '2026-07-03', lastClose: 150, lastDate: '2026-06-15', needsReseed: false });
  assert.equal(d, null,
    'ein ATH, den der Schlusskurs-Store noch gar nicht erreicht hat, wird als heutiger ATH angezeigt: ' + JSON.stringify(d));
});

test('AT-SK-ATH-001: athDate == lastDate bleibt eine gueltige Anzeige (heutiges Hoch)', () => {
  const d = displayFor({ ath: 200, athDate: '2026-06-15', lastClose: 200, lastDate: '2026-06-15', needsReseed: false });
  assert.ok(d && d.monthsAgo === 0 && d.distancePct === 0,
    'das legitime "ATH ist der letzte Schlusskurs" darf nicht mit abgeschaltet werden');
});

// ── R1-SK-010: ein Emittent, eine Zeile ─────────────────────────────────────────────
// pull-yahoo zieht je Zeile ueber yahoo_symbol und legt die Snapshot-Datei unter
// TICKER ab. Zwei Zeilen mit demselben yahoo_symbol erzeugen also zwei identische
// Snapshots -> derselbe Emittent steht zweimal im Board und zaehlt zweimal in jeder
// Kohorte. Live belegt: HRMS.PA und RMS.PA -> beide 'RMS.PA' (Hermes).
test('R1-SK-010 Bestand: keine zwei watchlist.json-Zeilen teilen ein yahoo_symbol', () => {
  const wl = JSON.parse(fs.readFileSync(path.join(REPO, 'watchlist.json'), 'utf8'));
  const nach = new Map();
  for (const s of wl.stocks) {
    if (!s || !s.yahoo_symbol) continue;
    const k = String(s.yahoo_symbol).toUpperCase();
    if (!nach.has(k)) nach.set(k, []);
    nach.get(k).push(s.ticker);
  }
  const dubletten = [...nach].filter(([, v]) => v.length > 1);
  assert.deepEqual(dubletten, [],
    'derselbe Emittent steht mehrfach im Universum und zaehlt mehrfach in jedem Board: ' + JSON.stringify(dubletten));
});

test('R1-SK-010 kollabiereYahooDubletten: Yahoo-eigene Zeile ueberlebt, Metadaten wandern mit', () => {
  const stocks = [
    { ticker: 'HRMS.PA', yahoo_symbol: 'RMS.PA', name: 'Hermes International', isin: 'FR0000052292' },
    { ticker: 'RMS.PA', yahoo_symbol: 'RMS.PA', name: 'RMS.PA' },
    { ticker: 'AAPL', yahoo_symbol: 'AAPL', name: 'Apple' },
  ];
  const r = kollabiereYahooDubletten(stocks);
  assert.equal(r.dropped, 1, 'die Dublette wurde nicht kollabiert');
  assert.deepEqual(r.stocks.map((s) => s.ticker), ['RMS.PA', 'AAPL'],
    'ueberleben muss die Zeile, deren ticker === yahoo_symbol ist (die pullbare Identitaet)');
  assert.equal(r.stocks[0].isin, 'FR0000052292', 'komplementaere Metadaten der verworfenen Zeile gingen verloren');
});

test('R1-SK-010 kollabiereYahooDubletten: ohne Dublette bleibt die Liste unveraendert', () => {
  const stocks = [{ ticker: 'A', yahoo_symbol: 'A' }, { ticker: 'B', yahoo_symbol: 'B' }, { ticker: 'C' }];
  const r = kollabiereYahooDubletten(stocks);
  assert.equal(r.dropped, 0);
  assert.equal(r.stocks.length, 3, 'eine Zeile ohne yahoo_symbol darf nicht verschwinden');
});

test('R1-SK-010 kollabiereYahooDubletten: kein Kandidat mit ticker===yahoo_symbol -> erste Zeile ueberlebt', () => {
  const stocks = [{ ticker: 'X1', yahoo_symbol: 'Z' }, { ticker: 'X2', yahoo_symbol: 'Z' }];
  const r = kollabiereYahooDubletten(stocks);
  assert.deepEqual(r.stocks.map((s) => s.ticker), ['X1']);
});

// ── AT-SK-REGION-001: Wachposten statt Fix ──────────────────────────────────────────
// Der gemeldete Schaden ("Region faellt universumweit auf OTHER") existiert nicht:
// getRegion hat keinen Produktionsaufrufer. Die Board-Region kommt aus
// src/scoring/country.js, das genau fuer das reale Snapshot-Shape gebaut ist.
// Der tote meta.exchange-Zweig wird deshalb NICHT repariert — aber festgehalten,
// dass niemand getRegion verdrahtet, ohne ihn vorher an das Shape anzupassen.
test('AT-SK-REGION-001 Wachposten: getRegion hat keinen Produktionsaufrufer', () => {
  const treffer = [];
  const durchsuche = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'outputs' || e.name === '.claude') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'tests') durchsuche(p); continue; }
      if (!e.name.endsWith('.js') || p.endsWith(path.join('lib', 'region-mapping.js'))) continue;
      const txt = fs.readFileSync(p, 'utf8');
      // Aufruf, nicht Erwaehnung: ein Kommentar wie "getRegion bleibt unberuehrt" zaehlt nicht.
      if (/\bgetRegion\s*\(/.test(txt.replace(/^\s*(\/\/|\*).*$/gm, ''))) treffer.push(path.relative(REPO, p));
    }
  };
  durchsuche(REPO);
  assert.deepEqual(treffer, [],
    'getRegion wird jetzt aufgerufen — auf dem realen Snapshot-Shape (kein meta.exchange, '
    + 'keine price.currency) liefert es fuer jeden Auslandsnamen OTHER. Vorher das Shape fixen: '
    + treffer.join(', '));
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
