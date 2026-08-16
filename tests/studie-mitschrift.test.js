'use strict';

// Waechter der Vorwaerts-Mitschrift.
//
// Die SACHE ist nicht "es wird etwas geschrieben", sondern: die Mitschrift schreibt
// ihre eigenen LUECKEN mit. Ein Log, das nach einem Ausfall einfach weiterlaeuft, als
// waere nichts gewesen, macht aus fehlender Evidenz stillschweigend saubere Evidenz —
// und genau darauf soll in 12 Monaten der einzige wirklich blinde Test der Studie
// stehen. Geprueft wird deshalb der Ausfall, nicht der Normalbetrieb.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const SPLIT_ZEILEN = new RegExp('\r?\n');

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studie-mitschrift-'));
process.env.STUDIE_MITSCHRIFT_DIR = TEMP;

const mitschrift = require('../scripts/studie-mitschrift');

function tagVor(tage) {
  return new Date(Date.now() - tage * 86400000).toISOString().slice(0, 10);
}

test('Ein Eintrag haelt jeden SEC-Kanal mit Inhalts-Hash fest', () => {
  const eintrag = mitschrift.baueEintrag(tagVor(20));
  assert.equal(eintrag.schema, mitschrift.SCHEMA);
  assert.ok(eintrag.kanaele.length >= 3, 'Es werden mehrere SEC-Kanaele beobachtet');
  for (const kanal of eintrag.kanaele) {
    if (kanal.vorhanden) {
      assert.match(kanal.sha256, /^[0-9a-f]{64}$/, `${kanal.id}: ohne Inhalts-Hash ist der Stand nicht belegbar`);
      assert.ok(kanal.bytes > 0);
    } else {
      assert.ok(String(kanal.grund).length > 0, `${kanal.id}: fehlender Kanal ohne Grund`);
    }
  }
  mitschrift.anhaengen(eintrag);
});

test('Ein Ausfall wird als Kalender-Luecke mit Tagen protokolliert', () => {
  const eintrag = mitschrift.baueEintrag(tagVor(5));
  const luecke = eintrag.luecken.find((element) => element.art === 'kalender');
  assert.ok(luecke, 'Nach 15 Tagen ohne Lauf muss eine Kalender-Luecke im Eintrag stehen');
  assert.equal(luecke.fehlendeTage, 14, 'Die Zahl der fehlenden Tage muss stimmen, nicht nur das Wort Luecke');
  assert.equal(luecke.von, tagVor(20));
  assert.equal(eintrag.status, 'MIT_LUECKEN');
  mitschrift.anhaengen(eintrag);
});

test('Ein Kanal, der sich nicht bewegt hat, ist auch eine Luecke', () => {
  const eintrag = mitschrift.baueEintrag(tagVor(4));
  const unveraendert = eintrag.luecken.filter((element) => element.art === 'kanal-unveraendert');
  assert.ok(
    unveraendert.length >= 1,
    'Byte-gleiche Kanaele bedeuten kein neues Beobachtungswissen — das muss dastehen',
  );
  assert.ok(unveraendert.every((element) => element.seit === tagVor(5)));
  assert.deepEqual(
    eintrag.luecken.filter((element) => element.art === 'kalender'),
    [],
    'Ein Lauf am Folgetag ist keine Kalender-Luecke',
  );
});

test('Derselbe Tag wird nicht zweimal protokolliert', () => {
  const datum = tagVor(3);
  const umgebung = { ...process.env, STUDIE_MITSCHRIFT_DIR: TEMP };
  const skript = path.join(__dirname, '..', 'scripts', 'studie-mitschrift.js');
  const erster = spawnSync(process.execPath, [skript, 'erfassen', datum], { encoding: 'utf8', env: umgebung });
  assert.equal(erster.status, 0, erster.stderr);
  const nachEins = mitschrift.alleEintraege().length;
  const zweiter = spawnSync(process.execPath, [skript, 'erfassen', datum], { encoding: 'utf8', env: umgebung });
  assert.equal(zweiter.status, 0, zweiter.stderr);
  assert.match(zweiter.stdout, /bereits protokolliert/);
  assert.equal(mitschrift.alleEintraege().length, nachEins, 'Ein zweiter Lauf am selben Tag darf nichts anhaengen');
});

test('Der Monatsbericht nennt die Luecken, nicht nur die Eintraege', () => {
  const monat = tagVor(5).slice(0, 7);
  const bericht = mitschrift.monatsbericht(monat);
  assert.match(bericht, /Eintraege/);
  assert.match(bericht, /Kalendertage ohne Lauf/);
  const bericht2 = mitschrift.monatsbericht('1999-01');
  assert.match(bericht2, /kein einziger Eintrag/, 'Ein leerer Monat muss als Befund gemeldet werden, nicht als 0');
});


test('Die Mitschrift haengt wirklich am Tageslauf — und VOR dem Commit-Schritt', () => {
  // Nicht die Schreibweise wird gepinnt, sondern die Sache: der Aufruf muss im
  // merge-Job stehen (dem einzigen Job, der nach main committet) und VOR dem
  // Commit-Schritt kommen. Stuende er dahinter, liefe er zwar taeglich, aber sein
  // Eintrag wuerde nie committet — eine Mitschrift, die niemand je zu sehen bekommt.
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'daily-pull.yml'), 'utf8');
  const zeilen = workflow.split(SPLIT_ZEILEN);
  const jobStart = zeilen.findIndex((zeile) => /^  merge:\s*$/.test(zeile));
  assert.ok(jobStart >= 0, 'merge-Job nicht gefunden — der Workflow hat sich strukturell geaendert');
  let jobEnde = zeilen.findIndex((zeile, index) => index > jobStart && /^  [a-z][\w-]*:\s*$/.test(zeile));
  if (jobEnde < 0) jobEnde = zeilen.length;
  const block = zeilen.slice(jobStart, jobEnde);

  const aufruf = block.findIndex((zeile) => /run:\s*node scripts\/studie-mitschrift\.js/.test(zeile));
  assert.ok(aufruf >= 0, 'Der Mitschrift-Aufruf steht nicht im merge-Job des Tageslaufs');
  const commit = block.findIndex((zeile) => /^\s*- name: Commit Snapshots\s*$/.test(zeile));
  assert.ok(commit >= 0, 'Commit-Schritt nicht gefunden');
  assert.ok(aufruf < commit, 'Die Mitschrift laeuft NACH dem Commit — ihr Eintrag wuerde nie gepusht');

  // Additiv heisst additiv: der Schritt darf nichts anderes anfassen.
  assert.match(block[aufruf].trim(), /^run: node scripts\/studie-mitschrift\.js erfassen$/);
  assert.match(block[aufruf + 1] || '', /continue-on-error:\s*true/, 'Die Mitschrift darf Karls Datenlauf nie blocken');
});

test('Aufraeumen', () => {
  fs.rmSync(TEMP, { recursive: true, force: true });
  assert.equal(fs.existsSync(TEMP), false);
});
