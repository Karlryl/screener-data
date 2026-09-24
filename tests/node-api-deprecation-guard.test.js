'use strict';

// Statischer Waechter (S59): keine veralteten Node-APIs in lib/, scripts/ und Root-*.js,
// und jede createWriteStream(-Stelle hat einen 'error'-Zuhoerer (oder haengt in pipeline().
// Standalone-Runner: `node tests/node-api-deprecation-guard.test.js` -> Exit 0/1.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const SCAN_DIRS = ['lib', 'scripts'];
const SKIP_DIRS = new Set(['src', 'methods', 'tests', 'node_modules', '.git']);
const EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

// Veraltete / entfernte Node-APIs: jedes Muster muss 0 Treffer haben.
const PATTERNS = [
  { name: 'new Buffer(', re: /\bnew Buffer\(/ },
  { name: 'fs.exists(', re: /\bfs\.exists\(/ },
  { name: 'url.parse(', re: /\burl\.parse\(/ },
  { name: "require('punycode')", re: /\brequire\(\s*['"]punycode['"]\s*\)/ },
  { name: 'util._extend', re: /\butil\._extend\b/ },
  { name: 'process.binding(', re: /\bprocess\.binding\(/ },
  { name: '.substr(', re: /\.substr\(/ },
  { name: 'util.isArray(', re: /\butil\.isArray\(/ },
  { name: 'os.tmpDir(', re: /\bos\.tmpDir\(/ },
  { name: 'crypto.createCipher(', re: /\bcrypto\.createCipher\(/ },
  { name: "require('sys')", re: /\brequire\(\s*['"]sys['"]\s*\)/ },
  { name: 'rmdir(Sync)?(...recursive', re: /\brmdir(Sync)?\([^)]*recursive/ },
];

// Obergrenzen (keine Sollzahlen) fuer createWriteStream-Stellen ohne 'error'-Zuhoerer.
// Jede Datei ausserhalb dieser Liste muss 0 Verstoesse haben.
const WRITE_STREAM_CAPS = {
  'scripts/d2-submissions-bulk.js': 2,
  'scripts/fetch-secbulk.js': 1,
};
const ERROR_LISTENER_WINDOW = 40; // Folgezeilen
const PIPELINE_WINDOW = 5;        // Zeilen davor

const RE_CREATE_WRITE_STREAM = /\bcreateWriteStream\(/;
const RE_ERROR_LISTENER = /\.on\(\s*['"]error['"]/;
const RE_PIPELINE = /\bpipeline\(/;

function istKommentarzeile(line) {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*');
}

/**
 * Reiner Zeilen-Scanner (auch fuer die Selbstpruefung im Speicher).
 * @param {string[]} lines
 * @returns {{ patternHits: Array<{name:string,line:number,text:string}>,
 *             writeStreams: Array<{line:number,covered:boolean}> }}
 */
function scanLines(lines) {
  const patternHits = [];
  const writeStreams = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (istKommentarzeile(line)) continue;
    for (const p of PATTERNS) {
      if (p.re.test(line)) patternHits.push({ name: p.name, line: i + 1, text: line.trim() });
    }
    if (RE_CREATE_WRITE_STREAM.test(line)) {
      let covered = false;
      for (let j = i; j <= Math.min(lines.length - 1, i + ERROR_LISTENER_WINDOW); j++) {
        if (RE_ERROR_LISTENER.test(lines[j])) { covered = true; break; }
      }
      if (!covered) {
        for (let j = Math.max(0, i - PIPELINE_WINDOW); j <= i; j++) {
          if (RE_PIPELINE.test(lines[j])) { covered = true; break; }
        }
      }
      writeStreams.push({ line: i + 1, covered });
    }
  }
  return { patternHits, writeStreams };
}

function sammleDateien() {
  const out = [];
  for (const name of fs.readdirSync(REPO, { withFileTypes: true })) {
    if (name.isFile() && EXTENSIONS.has(path.extname(name.name))) out.push(name.name);
  }
  const walk = (rel) => {
    const abs = path.join(REPO, rel);
    if (!fs.existsSync(abs)) return;
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const relChild = rel + '/' + ent.name;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        walk(relChild);
      } else if (ent.isFile() && EXTENSIONS.has(path.extname(ent.name))) {
        out.push(relChild);
      }
    }
  };
  for (const d of SCAN_DIRS) walk(d);
  return out.sort();
}

function scanRepo() {
  const hitsPerPattern = new Map(PATTERNS.map((p) => [p.name, []]));
  const writeStreamSites = [];
  const files = sammleDateien();
  for (const rel of files) {
    const lines = fs.readFileSync(path.join(REPO, rel), 'utf8').split(/\r?\n/);
    const { patternHits, writeStreams } = scanLines(lines);
    for (const h of patternHits) hitsPerPattern.get(h.name).push(`${rel}:${h.line}  ${h.text}`);
    for (const w of writeStreams) writeStreamSites.push({ file: rel, line: w.line, covered: w.covered });
  }
  return { files, hitsPerPattern, writeStreamSites };
}

const befund = scanRepo();

test('Selbstpruefung: Scanner erkennt new Buffer(, ignoriert Kommentarzeile', () => {
  const positiv = scanLines(['const b = new Buffer(4);']);
  assert.equal(positiv.patternHits.length, 1, 'Positiv-Kontrolle: new Buffer( muss erkannt werden');
  assert.equal(positiv.patternHits[0].name, 'new Buffer(');
  const negativ = scanLines(['// new Buffer(', ' * new Buffer(']);
  assert.equal(negativ.patternHits.length, 0, 'Kommentarzeilen duerfen nicht zaehlen');
  const ws = scanLines(['const ws = fs.createWriteStream(p);', 'ws.write("x");', "ws.on('error', () => {});"]);
  assert.deepEqual(ws.writeStreams, [{ line: 1, covered: true }]);
  const wsOhne = scanLines(['const ws = fs.createWriteStream(p);', 'ws.end();']);
  assert.deepEqual(wsOhne.writeStreams, [{ line: 1, covered: false }]);
  const wsPipe = scanLines(['await pipeline(', '  quelle,', '  fs.createWriteStream(p),', ');']);
  assert.deepEqual(wsPipe.writeStreams, [{ line: 3, covered: true }]);
});

test('Scan-Umfang: lib/, scripts/ und Root-*.js werden gelesen', () => {
  assert.ok(befund.files.length > 50, `zu wenige Dateien gescannt: ${befund.files.length}`);
  assert.ok(befund.files.some((f) => f.startsWith('lib/')), 'lib/ fehlt im Scan');
  assert.ok(befund.files.some((f) => f.startsWith('scripts/')), 'scripts/ fehlt im Scan');
  assert.ok(befund.files.some((f) => !f.includes('/')), 'Root-*.js fehlen im Scan');
  assert.ok(!befund.files.some((f) => /^(src|methods|tests|node_modules|\.git)\//.test(f)), 'Ausschluss-Ordner im Scan');
});

for (const p of PATTERNS) {
  test(`veraltete Node-API nicht verwendet: ${p.name}`, () => {
    const hits = befund.hitsPerPattern.get(p.name);
    assert.equal(hits.length, 0, `${p.name}: ${hits.length} Treffer\n  ${hits.join('\n  ')}`);
  });
}

test("createWriteStream ohne 'error'-Zuhoerer: je Datei innerhalb der Obergrenze", () => {
  const verstoesse = befund.writeStreamSites.filter((s) => !s.covered);
  const jeDatei = new Map();
  for (const v of verstoesse) jeDatei.set(v.file, (jeDatei.get(v.file) || 0) + 1);
  const fehler = [];
  for (const [file, n] of jeDatei) {
    const cap = WRITE_STREAM_CAPS[file] || 0;
    if (n > cap) {
      const zeilen = verstoesse.filter((v) => v.file === file).map((v) => `${v.file}:${v.line}`);
      fehler.push(`${file}: ${n} Verstoesse > Obergrenze ${cap} (${zeilen.join(', ')})`);
    }
  }
  assert.deepEqual(fehler, [], `createWriteStream ohne .on('error' bzw. pipeline(:\n  ${fehler.join('\n  ')}`);
});

test('Ausgabe: Trefferzahl je Muster, createWriteStream-Stellen und Verstoesse', () => {
  const zeilen = [`node-api-deprecation-guard: ${befund.files.length} Dateien gescannt`];
  for (const p of PATTERNS) zeilen.push(`  ${p.name.padEnd(28)} ${befund.hitsPerPattern.get(p.name).length}`);
  const verstoesse = befund.writeStreamSites.filter((s) => !s.covered);
  zeilen.push(`  createWriteStream-Stellen: ${befund.writeStreamSites.length}, Verstoesse: ${verstoesse.length}`);
  for (const v of verstoesse) zeilen.push(`    ohne 'error'-Zuhoerer: ${v.file}:${v.line}`);
  console.log(zeilen.join('\n'));
  assert.ok(befund.writeStreamSites.length >= verstoesse.length);
});
