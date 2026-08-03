'use strict';
/**
 * BH-117 regression (batch w2-dailyfollow, .github/workflows/daily-pull.yml).
 * Nachzuegler aus Welle 1 (Tag 364): assertCoverageFloor() (src/scoring/run-screener.js)
 * hatte in JEDEM CI-Lauf baseline=null, weil snapshots/_last_good_disk.json (git-ignored)
 * von keinem Schritt im scoring-Job ueber Job-Grenzen persistiert wurde. Fix lebt komplett
 * in der YAML (Cache-Restore/Save nach dem Tag-261-Shard-Cache-Muster) — kein Code in
 * run-screener.js noetig (dessen Lese-/Schreiblogik war bereits korrekt).
 *
 * Standalone runner (node <datei>, exit 0/1) — keine Netz-Zugriffe, nur lokales
 * Dateisystem (die ausgecheckte Workflow-Datei + Inline-Fixtures).
 *
 * Run: node tests/scoring/bh-w2-dailyfollow.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const YML_PATH = path.join(ROOT, '.github', 'workflows', 'daily-pull.yml');
const yml = fs.readFileSync(YML_PATH, 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

function section(startMarker, endMarker) {
  const s = yml.indexOf(startMarker);
  assert.ok(s >= 0, 'Marker nicht gefunden: ' + startMarker);
  const eSearchFrom = s + startMarker.length;
  const e = endMarker ? yml.indexOf(endMarker, eSearchFrom) : yml.length;
  assert.ok(!endMarker || e > s, 'End-Marker nicht gefunden: ' + endMarker);
  return yml.slice(s, e < 0 ? yml.length : e);
}

// ── YAML-Parse-Check ─────────────────────────────────────────────────────────
// Kein js-yaml im Repo (keine neue Dependency erlaubt) -> minimaler, aber echter
// Struktur-Validator: Einrueckungs-Stack (Sequenz-/Mapping-Ebenen muessen exakt auf
// eine offene Ebene matchen), keine Tabs ausserhalb von Block-Skalaren, jede
// strukturelle Zeile ist entweder ein Sequenz-Item ("- ...") oder "key: value"/"key:",// Anfuehrungszeichen pro Zeile ausgeglichen. Block-Skalare (run: |, path: |,
// restore-keys: |) werden erkannt und ihr kompletter Koerper (jede Zeile tiefer
// eingerueckt als der Key) von der Struktur-Pruefung ausgenommen — genau dort haben
// echte YAML-Brueche in diesem Repo schon zugeschlagen (Kommentar Zeile 148-149:
// ein Heredoc am Spaltenanfang wuerde den Block-Skalar vorzeitig beenden).
function checkYamlStructure(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const stack = [-1];
  let blockScalarFloor = null;

  function findTopLevelColon(s) {
    let inSingle = false, inDouble = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "'" && !inDouble) inSingle = !inSingle;
      else if (c === '"' && !inSingle) inDouble = !inDouble;
      else if (c === ':' && !inSingle && !inDouble) {
        if (i + 1 === s.length || s[i + 1] === ' ') return i;
      }
    }
    return -1;
  }

  function checkQuoteBalance(s, lineNo) {
    let inSingle = false, inDouble = false;
    for (const c of s) {
      if (c === "'" && !inDouble) inSingle = !inSingle;
      else if (c === '"' && !inSingle) inDouble = !inDouble;
    }
    if (inSingle || inDouble) {
      throw new Error(`Zeile ${lineNo}: unausgeglichenes Anfuehrungszeichen: ${JSON.stringify(s)}`);
    }
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const lineNo = idx + 1;

    if (blockScalarFloor !== null) {
      if (raw.trim() === '') continue;
      const ind = raw.match(/^ */)[0].length;
      if (ind > blockScalarFloor) continue;
      blockScalarFloor = null; // Block-Skalar endet — diese Zeile normal weiterverarbeiten
    }

    if (raw.trim() === '') continue;
    if (raw.trim().startsWith('#')) continue;
    if (raw.includes('\t')) {
      throw new Error(`Zeile ${lineNo}: Tab-Zeichen ausserhalb eines Block-Skalars — YAML verbietet Tabs zur Einrueckung.`);
    }

    const indent = raw.match(/^ */)[0].length;
    const trimmed = raw.trim();

    // Ein Dedent (Pop) MUSS exakt auf eine bereits offene Ebene landen — eine
    // Ebene "tiefer als die neue Stack-Spitze, aber flacher als die gerade
    // geschlossene" ist ambig (Python-Tokenizer-Analogon: "unindent does not
    // match any outer indentation level"). Neu-Pushen ist nur erlaubt, wenn
    // DIESE Zeile ohne vorherigen Pop direkt tiefer geht (echte neue Ebene).
    let popped = false;
    while (stack.length > 1 && indent < stack[stack.length - 1]) { stack.pop(); popped = true; }
    if (!popped && indent > stack[stack.length - 1]) {
      stack.push(indent);
    } else if (indent !== stack[stack.length - 1]) {
      throw new Error(`Zeile ${lineNo}: Einrueckung ${indent} matcht keine offene Ebene (${stack.join(',')}) — inkonsistente YAML-Struktur.`);
    }

    const isSeqItem = /^-(\s|$)/.test(trimmed);
    const body = isSeqItem ? trimmed.replace(/^-\s*/, '') : trimmed;
    if (body === '') continue; // leeres Sequenz-Item ("- ")

    const colon = findTopLevelColon(body);
    if (colon === -1) {
      if (!isSeqItem) {
        throw new Error(`Zeile ${lineNo}: weder Sequenz-Item ("- ...") noch "key: value" erkennbar: ${JSON.stringify(trimmed)}`);
      }
      continue; // reiner Skalar-Sequenz-Eintrag ("- someValue")
    }
    const valuePart = body.slice(colon + 1).trim();
    checkQuoteBalance(valuePart, lineNo);
    if (['|', '|-', '|+', '>', '>-'].includes(valuePart)) {
      blockScalarFloor = indent; // Key-Zeilen-Einrueckung ist die Untergrenze fuer den Koerper
    }
  }
}

test('YAML-Parse-Check: daily-pull.yml ist strukturell valide', () => {
  checkYamlStructure(yml); // wirft bei Bruch — kein Wurf = bestanden
});
test('YAML-Parse-Check: erkennt Tab-Zeichen als Bruch (Negativ-Fixture)', () => {
  assert.throws(() => checkYamlStructure('jobs:\n  foo:\n\t  bar: baz\n'), /Tab-Zeichen/);
});
test('YAML-Parse-Check: erkennt inkonsistente Einrueckung als Bruch (Negativ-Fixture)', () => {
  assert.throws(() => checkYamlStructure('jobs:\n  foo:\n    bar: 1\n   baz: 2\n'), /matcht keine offene Ebene/);
});
test('YAML-Parse-Check: erkennt fehlendes "key:"/Sequenz-Item als Bruch (Negativ-Fixture)', () => {
  assert.throws(() => checkYamlStructure('jobs:\n  foo:\n    just some text\n'), /weder Sequenz-Item/);
});
test('YAML-Parse-Check: erkennt unausgeglichenes Anfuehrungszeichen als Bruch (Negativ-Fixture)', () => {
  assert.throws(() => checkYamlStructure("jobs:\n  foo:\n    bar: 'unterminated\n"), /unausgeglichenes Anfuehrungszeichen/);
});
test('YAML-Parse-Check: Block-Skalar-Koerper ist von der Struktur-Pruefung ausgenommen (Positiv-Fixture)', () => {
  // Bash-Body mit Doppelpunkten/Tabs-artigen Mustern/unausgeglichenen Anfuehrungszeichen
  // im Kommentar waere ausserhalb eines Block-Skalars ein Bruch — im Koerper legal.
  checkYamlStructure("jobs:\n  foo:\n    run: |\n      echo \"a: b 'c\"\n      # comment: with colon\n    next: 1\n");
});

// ── BH-117: Cross-Run-Persistenz der Coverage-Floor-Baseline im scoring-Job ──────
test('BH-117: Restore-Step folgt direkt auf Download Snapshots Artifact, vor dem Live-Universum-Gate', () => {
  const iDl = yml.indexOf('name: Download Snapshots Artifact');
  const iRestore = yml.indexOf('name: Restore Coverage-Floor Baseline');
  const iGate = yml.indexOf('name: Live-Universum-Gate');
  assert.ok(iDl > 0 && iRestore > iDl && iGate > iRestore, 'Reihenfolge Download -> Restore-Baseline -> Live-Universum-Gate verletzt');
});
test('BH-117: Restore-Step cached exakt snapshots/_last_good_disk.json (nicht den ganzen Ordner)', () => {
  const s = section('name: Restore Coverage-Floor Baseline', 'name: Live-Universum-Gate');
  assert.match(s, /uses: actions\/cache\/restore@[0-9a-f]{40} # v4\.\d+\.\d+/);
  assert.match(s, /path: snapshots\/_last_good_disk\.json/);
  // F-12 (04.08.2026): der Namespace-SUFFIX darf sich aendern — ein Wechsel ist die
  // CI-Fassung des dokumentierten Baseline-Resets (run-screener.js: "bei legitimem
  // Schrumpfen snapshots/_last_good_disk.json loeschen zum Reset"), und der F-12-Filter
  // nimmt dem scoring-Job einmalig 14 % Karteileichen weg. Festgenagelt bleibt die SACHE
  // (strenger als vorher): Praefix last-good-disk-scoring-, per-Lauf-Schluessel
  // (github.run_id) UND ein restore-keys-Fallback mit GENAU demselben Namespace — vorher
  // reichte dort das blosse Praefix, ein abweichender Suffix waere durchgegangen.
  const ns = s.match(/key: (last-good-disk-scoring-[\w.-]*)\$\{\{ github\.run_id \}\}/);
  assert.ok(ns, 'Restore-Key muss last-good-disk-scoring-<namespace>${{ github.run_id }} lauten');
  assert.match(s, new RegExp('restore-keys:\\s*\\|\\s*\\n\\s*' + ns[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\n'));
});
// F-12-R5 (Review Tag 563, M5): der Test oben nagelt fest, DASS eine restore-keys-Zeile mit
// dem Key-Namespace existiert — nicht, dass sie die EINZIGE ist. Repro: eine breitere
// Fallback-Zeile darunter (`last-good-disk-scoring-`) liess ihn gruen, waehrend der Cache-
// Restore beim Prefix-Fallback wieder den Vor-f12-Stand geholt haette. Genau das, wogegen
// der Namespace-Wechsel gebaut war. Der Block traegt GENAU EINE Zeile.
function restoreKeysZeilen(abschnitt) {
  const m = abschnitt.match(/^([ ]*)restore-keys:[ ]*\|[ ]*\r?$/m);
  assert.ok(m, 'restore-keys-Blockskalar fehlt');
  const keyIndent = m[1].length;
  const rest = abschnitt.slice(abschnitt.indexOf(m[0]) + m[0].length).split('\n').slice(1);
  const zeilen = [];
  for (const roh of rest) {
    const z = roh.replace(/\r$/, '');
    if (z.trim() === '') { if (zeilen.length) break; else continue; }
    if (z.match(/^ */)[0].length <= keyIndent) break;
    zeilen.push(z.trim());
  }
  return zeilen;
}

test('BH-117 (F-12-R5): der restore-keys-Block traegt GENAU EINE Zeile (kein breiterer Fallback darunter)', () => {
  const s = section('name: Restore Coverage-Floor Baseline', 'name: Live-Universum-Gate');
  const ns = s.match(/key: (last-good-disk-scoring-[\w.-]*)\$\{\{ github\.run_id \}\}/);
  const zeilen = restoreKeysZeilen(s);
  assert.equal(zeilen.length, 1, 'eine zweite, breitere Fallback-Zeile holt beim Restore den Vor-Namespace-Stand zurueck: ' + JSON.stringify(zeilen));
  assert.equal(zeilen[0], ns[1], 'die eine Zeile muss GENAU der Namespace des Keys sein');
});

test('BH-117 (F-12-R5): eine zweite Fallback-Zeile fliegt auf (Negativ-Fixture)', () => {
  const kaputt = [
    '        with:',
    '          key: last-good-disk-scoring-f12-${{ github.run_id }}',
    '          restore-keys: |',
    '            last-good-disk-scoring-f12-',
    '            last-good-disk-scoring-',
    '',
  ].join('\n');
  assert.equal(restoreKeysZeilen(kaputt).length, 2, 'der breitere Fallback muss sichtbar werden');
});

test('BH-117: Save-Step folgt direkt auf Run Hypergrowth Screener, vor Build findash-export', () => {
  const iRun = yml.indexOf('name: Run Hypergrowth Screener');
  const iSave = yml.indexOf('name: Save Coverage-Floor Baseline');
  const iExport = yml.indexOf('name: Build findash-export v1');
  assert.ok(iRun > 0 && iSave > iRun && iExport > iSave, 'Reihenfolge Run-Screener -> Save-Baseline -> Build-findash-export verletzt');
});
test('BH-117: Save-Step laeuft if:always() (sonst Bootstrapping-Deadlock, analog Tag-261-Shard-Cache)', () => {
  const s = section('name: Save Coverage-Floor Baseline', 'name: Build findash-export v1');
  assert.match(s, /if:\s*always\(\)/);
  assert.match(s, /uses: actions\/cache\/save@[0-9a-f]{40} # v4\.\d+\.\d+/);
  assert.match(s, /path: snapshots\/_last_good_disk\.json/);
  // F-12: Namespace-Suffix frei (s. Restore-Test oben), per-Lauf-Schluessel Pflicht.
  // Dass Restore und Save DENSELBEN Namespace tragen, prueft der Gleichheits-Test unten.
  assert.match(s, /key: last-good-disk-scoring-[\w.-]*\$\{\{ github\.run_id \}\}/);
});
test('BH-117: Save-Key traegt denselben Namespace/Praefix wie der Restore-Key (sonst nie ein Cache-Hit)', () => {
  const restoreSection = section('name: Restore Coverage-Floor Baseline', 'name: Live-Universum-Gate');
  const saveSection = section('name: Save Coverage-Floor Baseline', 'name: Build findash-export v1');
  const restoreKey = restoreSection.match(/key: (last-good-disk-scoring-[^\n]+)/)[1].trim();
  const saveKey = saveSection.match(/key: (last-good-disk-scoring-[^\n]+)/)[1].trim();
  assert.equal(restoreKey, saveKey, 'Restore- und Save-Key weichen voneinander ab');
});
test('BH-117: actions/cache SHA-Pin stimmt mit dem bereits im Repo genutzten Shard-Cache-Pin ueberein (Tag 136 Pin-Policy)', () => {
  const shardPin = yml.match(/uses: actions\/cache\/restore@([0-9a-f]{40}) # v4\.\d+\.\d+/)[1];
  const baselineRestore = section('name: Restore Coverage-Floor Baseline', 'name: Live-Universum-Gate');
  assert.match(baselineRestore, new RegExp('uses: actions/cache/restore@' + shardPin));
});

console.log('\nbh-w2-dailyfollow.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
