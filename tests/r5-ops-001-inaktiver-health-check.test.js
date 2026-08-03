'use strict';
/**
 * R5-OPS-001 (Block 5, Verifikation 2026-08-03) — der gruene Haken, der nichts
 * geprueft hat.
 *
 * BEFUND: Der Schritt "Pipeline Health Check" laeuft seit dem Hypergrowth-Umbau
 * ins Leere. Der Umbau loeschte jedes Skript, das je einen pipeline-health/-Bericht
 * schrieb; EXPECTED_SCRIPTS ist seither leer, pipeline-health/ steht in .gitignore,
 * und der Checker meldet folgerichtig "nothing to check" und exit 0. Von aussen
 * bleibt ein gruener Haken mit dem Namen "Pipeline Health Check" stehen — das ist
 * kein Fehler im Code, sondern eine falsche Auskunft an den Leser.
 *
 * BEHOBEN OHNE LOGIK-AENDERUNG: der Schritt heisst jetzt "(inaktiv)" und sagt im
 * Protokoll, was er nicht prueft und wann er aufwacht. Der Checker selbst bleibt
 * unangetastet — er taugt unveraendert, sobald wieder jemand Berichte schreibt.
 *
 * Dieser Waechter haelt zusaetzlich die PRAEMISSE fest: taucht wieder ein Erzeuger
 * von pipeline-health/-Berichten auf, wird "(inaktiv)" zur Luege und der Waechter
 * muss rot werden.
 *
 * Standalone-Runner: node tests/r5-ops-001-inaktiver-health-check.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const YML = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily-pull.yml'), 'utf8');
const CHECKER = fs.readFileSync(path.join(ROOT, 'scripts', 'pipeline-health-check.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

/** Nur die YAML-Schluessel des Schritts (bis zur ersten Kommentar-/Namenszeile). */
function schrittKoerper(namensAnfang) {
  const i = YML.indexOf('- name: ' + namensAnfang);
  assert.ok(i > 0, 'Schritt nicht gefunden: ' + namensAnfang);
  const zeilen = YML.slice(i).split(/\r?\n/);
  const raus = [];
  for (let k = 1; k < zeilen.length; k++) {
    const t = zeilen[k].trim();
    if (t.startsWith('#') || t.startsWith('- name:')) break;
    raus.push(zeilen[k]);
  }
  return raus.join('\n');
}

check('der Schritt heisst im Klartext "(inaktiv)"', () => {
  assert.match(YML, /- name: Pipeline Health Check \(inaktiv\)/,
    'ein gruener Haken namens "Pipeline Health Check" liest sich wie eine bestandene Pruefung');
});

check('der Schritt sagt im Protokoll, dass er NICHTS prueft', () => {
  const k = schrittKoerper('Pipeline Health Check');
  assert.match(k, /prueft derzeit NICHTS/,
    'ohne Hinweis im Protokoll merkt es nur, wer den Quelltext des Checkers liest');
  assert.match(k, /EXPECTED_SCRIPTS/, 'der Hinweis muss die Ursache benennen, nicht nur den Zustand');
});

check('der Hinweis nennt die echten Datenwaechter, damit niemand hier Sicherheit sucht', () => {
  const k = schrittKoerper('Pipeline Health Check');
  assert.match(k, /Verify Pull Coverage/);
  assert.match(k, /Verify Snapshot/);
});

check('der Hinweis nennt die Bedingung fuers Aufwachen', () => {
  const k = schrittKoerper('Pipeline Health Check');
  assert.match(k, /wacht auf/, 'sonst weiss ein spaeterer Leser nicht, ob "inaktiv" endgueltig ist');
});

check('der Checker wird weiterhin aufgerufen — keine Logik entfernt', () => {
  const k = schrittKoerper('Pipeline Health Check');
  assert.match(k, /node scripts\/pipeline-health-check\.js/,
    'der Checker taugt unveraendert, sobald wieder jemand Berichte schreibt');
});

check('am Checker selbst wurde NICHTS geaendert: leere Allowlist, harte Schwelle', () => {
  assert.match(CHECKER, /const EXPECTED_SCRIPTS = \[\];/);
  assert.match(CHECKER, /const THRESHOLD = 0\.05;/);
});

/** Faehrt den Checker mit einem erfundenen pipeline-health/-Bericht. */
function checkerMit(bericht) {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r5ops-'));
  fs.mkdirSync(path.join(dir, 'pipeline-health'));
  fs.writeFileSync(path.join(dir, 'pipeline-health', 'x.json'), JSON.stringify(bericht));
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'pipeline-health-check.js')],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return 0;
  } catch (e) { return e.status; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

check('der Checker ist unveraendert SCHARF: ein echter Bruch macht ihn rot', () => {
  // Kein Quelltext-Anker: `process.exit(1)` steht an zwei Stellen im Checker, ein
  // Text-Treffer haette den entschaerften Bruch-Pfad nicht bemerkt (im ersten Anlauf
  // genau so passiert). Also den Checker laufen lassen.
  assert.equal(checkerMit({ script: 'x', n_total: 10, n_ok: 5, n_failed: 5, failure_rate: 0.5 }), 1,
    'aus "inaktiv" darf nicht "entschaerft" geworden sein');
});

check('GEGENPROBE: ein sauberer Bericht laesst ihn gruen', () => {
  assert.equal(checkerMit({ script: 'x', n_total: 10, n_ok: 10, n_failed: 0, failure_rate: 0 }), 0);
});

check('PRAEMISSE: es gibt weiterhin keinen Erzeuger von pipeline-health/-Berichten', () => {
  // Wird das wieder falsch, ist "(inaktiv)" eine Falschauskunft — dann muss dieser
  // Waechter rot werden und nicht der Leser es merken.
  let treffer;
  try {
    treffer = execFileSync('git', ['grep', '-l', 'pipeline-health', '--', '*.js', '*.yml'],
      { cwd: ROOT, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  } catch (e) { treffer = []; }   // kein Treffer -> git grep endet mit 1
  const erlaubt = new Set(['scripts/pipeline-health-check.js', '.github/workflows/daily-pull.yml']);
  const fremd = treffer.filter((f) => !erlaubt.has(f));
  assert.deepEqual(fremd, [],
    'neue Datei(en) fassen pipeline-health an: ' + fremd.join(', ')
    + ' — schreibt sie Berichte, ist der Schritt nicht mehr inaktiv: "(inaktiv)" aus dem Namen nehmen, '
    + 'Skript in EXPECTED_SCRIPTS eintragen und diesen Waechter nachziehen.');
});

check('pipeline-health/ ist weiterhin gitignored (Teil der Ursache, nicht Deko)', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(gi, /^pipeline-health\/$/m);
});

console.log('\nGeprueft: Schritt "Pipeline Health Check (inaktiv)" in .github/workflows/daily-pull.yml '
  + '(Name, vier Aussagen des Hinweises, unveraenderter Aufruf), scripts/pipeline-health-check.js '
  + '(Allowlist/Schwelle/Exit-1 unveraendert) und die Praemisse per git grep ueber alle '
  + 'versionierten *.js/*.yml.');
console.log('r5-ops-001: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
