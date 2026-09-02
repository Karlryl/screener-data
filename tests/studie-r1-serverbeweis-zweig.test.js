'use strict';
/**
 * Wache zu H8 (Nacht-Pruef-Sweep 2026-08-29, Orchestrator ENTSCHIED 29) — Teilbefund
 * "Server-Beweis gegen den falschen Zweig".
 *
 * DER BEFUND: `bestaetigen()` liess `zweig` auf
 * `git rev-parse --abbrev-ref HEAD` defaulten und fragte GitHub dann
 * `contents/<ledger>?ref=<dieser Zweig>`. Damit konnte ein Register-Eintrag, der nur
 * auf einem Zweig lag, sein Server-Siegel bekommen, ohne je auf `main` gelandet zu sein
 * — genau das, was
 * protocol/early-detection/2.0.0/register-single-appender-rule.json verbietet
 * (`ledgerAppendsAllowedOnlyInCommitsLandingDirectlyOn: 'main'`, und Schritt 4 der
 * `branchWorkSequence`: "confirm the MAIN-HOSTED entry"). Kein Aufrufer im Repo
 * uebergibt `--zweig`, der stille Pfad war also der einzige benutzte.
 *
 * BEWUSST NICHT MITGEBAUT: die zweite Haelfte von H8 (`anmelden()` bricht ab, wenn
 * HEAD != main). Sie kollidiert mit der ratifizierten `branchWorkSequence`, die den
 * Eintrag ausdruecklich ueber einen Mini-PR-Zweig nach main fuehrt, und mit dem noch
 * offenen Wortlaut-Befund N16. Das ist eine Methodik-Weiche, kein Einzeiler.
 *
 * GEPRUEFT WIRD DIE SACHE, NICHT DER TEXT: `gh` wird abgefangen und der real
 * abgesetzte API-Pfad gelesen. Beide Richtungen: ohne `--zweig` MUSS main abgefragt
 * werden; mit explizitem `--zweig` bleibt die Ueberschreibung moeglich.
 *
 * Usage: node --test tests/studie-r1-serverbeweis-zweig.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LEDGER_REL = 'protocol/early-detection/2.0.0/outcome-access-ledger.json';
const REGEL_REL = 'protocol/early-detection/2.0.0/register-single-appender-rule.json';

// Ein echter, bestaetigbarer Eintrag aus dem ausgelieferten Register — nicht erfunden,
// sonst prueft die Wache eine Lage, die es nie gibt.
const register = JSON.parse(fs.readFileSync(path.join(ROOT, ...LEDGER_REL.split('/')), 'utf8'));
const eintrag = register.events.find((e) => e.typ === 'count_only_probe_authorized');

// `gh` wird ueber execFileSync aufgerufen und beim Laden des Skripts destrukturiert —
// der Ersatz muss deshalb VOR dem require stehen.
const cp = require('node:child_process');
const echt = cp.execFileSync;
const abgesetzt = [];
cp.execFileSync = (datei, args) => {
  abgesetzt.push({ datei, args });
  if (datei === 'gh' && args[0] === 'repo') return 'Karlryl/screener-data\n';
  if (datei === 'gh' && args[0] === 'api') {
    // Antwort mit Kopf/Rumpf wie `gh api -i`; Serverzeit zwischen registeredAt und
    // accessedAt, damit die echten Zeitpruefungen greifen statt vorher abzubrechen.
    const server = new Date(
      (Date.parse(eintrag.registeredAt) + Date.parse(eintrag.accessedAt)) / 2,
    ).toUTCString();
    // `path` gehoert in die Attrappe, weil die echte API ihn liefert und der
    // Beweis ihn seit F2 gegen den angefragten Pfad haelt. Eine Attrappe, die
    // ihn weglaesst, pruefte eine Antwortform, die es nicht gibt.
    const rumpf = JSON.stringify({
      path: LEDGER_REL,
      encoding: 'base64',
      content: Buffer.from(JSON.stringify(register), 'utf8').toString('base64'),
    });
    return `date: ${server}\r\ncontent-type: application/json\r\n\r\n${rumpf}`;
  }
  return echt(datei, args, { encoding: 'utf8' });
};

const { bestaetigen } = require(path.join(ROOT, 'scripts', 'studie-r1-serverzeit.js'));

function apiPfad() {
  const a = abgesetzt.filter((x) => x.datei === 'gh' && x.args[0] === 'api').pop();
  assert.ok(a, 'es wurde ueberhaupt kein gh api abgesetzt');
  return a.args[2];
}

function lauf(extraArgv) {
  abgesetzt.length = 0;
  const ziel = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'r1-zweig-')), 'freigabe.json');
  bestaetigen(['bestaetigen', '--runid', eintrag.runId, '--ziel', ziel, ...extraArgv]);
  return ziel;
}

test('H8: ohne --zweig wird der Server-Beweis gegen main gefuehrt, nicht gegen HEAD', () => {
  const ziel = lauf([]);
  assert.match(apiPfad(), /[?&]ref=main$/, 'der Beweis muss main abfragen');
  const freigabe = JSON.parse(fs.readFileSync(ziel, 'utf8'));
  assert.equal(freigabe.registerZweig, 'main', 'und das Protokoll muss main ausweisen');

  // Gegenprobe an der SACHE: der lokale HEAD ist hier gerade NICHT main — waere der
  // alte Default noch da, stuende er im Pfad. Ohne diese Zeile pruefte der Test auf
  // einem main-Checkout nichts.
  const head = echt('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', cwd: ROOT }).trim();
  if (head !== 'main') {
    assert.doesNotMatch(apiPfad(), new RegExp(`ref=${head}$`),
      `der Beweis darf nicht gegen den Arbeitszweig ${head} laufen`);
  }
});

test('H8: ein explizites --zweig bleibt moeglich (die Ueberschreibung wird nicht zugemauert)', () => {
  lauf(['--zweig', 'main']);
  assert.match(apiPfad(), /[?&]ref=main$/);
});

test('H8: der Default ist an die Regel gebunden, nicht frei gewaehlt', () => {
  const regel = JSON.parse(fs.readFileSync(path.join(ROOT, ...REGEL_REL.split('/')), 'utf8'));
  assert.equal(regel.rule.singleAppender, 'main',
    'aendert die Regel ihren Appender, muss dieser Default mitwandern statt still falsch zu werden');
  const freigabe = JSON.parse(fs.readFileSync(lauf([]), 'utf8'));
  assert.equal(freigabe.registerZweig, regel.rule.singleAppender);
});
