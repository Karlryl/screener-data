'use strict';

// Waechter fuer R2, harte Seite: die Endtest-Datei liegt verschluesselt, und zwar so,
// dass Manipulation und falscher Schluessel AUFFLIEGEN statt still durchzugehen.
//
// Die SACHE, die hier festgenagelt wird, ist nicht "das Skript laeuft durch", sondern
// die drei Eigenschaften, an denen die Versiegelung haengt:
//   1. Rueckentschluesselung ergibt byte-genau den Klartext (sonst waere das Siegel
//      ein huebscher Datenverlust).
//   2. Ein einziges gekipptes Byte macht die Pruefung ROT — und eine intakte Kopie
//      danach wieder gruen (sonst prueft der Test nur, dass immer alles rot ist).
//   3. Der Klartext wird NUR nach bestandener Verifikation geloescht; faellt die
//      Verifikation aus, bleibt er liegen.
// Dazu die Zusicherung, die ein Streaming-Verfahren leicht bricht: es entsteht
// nirgends eine zweite Klartext-Kopie auf der Platte.
//
// Getestet wird mit einer kleinen Datei, nie mit der echten mehrere GB grossen.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const siegel = require('../scripts/studie-endtest-versiegeln.js');

const KLARTEXT_NAME = 'panel-endtest.sqlite';
const still = () => {};

// Eine Spielwiese je Test: Panel-Verzeichnis, Schluessel-Ablage, Sidecar.
function buehne(inhalt) {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'studie-siegel-'));
  const panel = path.join(wurzel, 'panel');
  fs.mkdirSync(panel);
  const klartextPfad = path.join(panel, KLARTEXT_NAME);
  fs.writeFileSync(klartextPfad, inhalt);
  return {
    wurzel,
    panel,
    klartextPfad,
    siegelPfad: klartextPfad + '.enc',
    schluesselPfad: path.join(wurzel, 'schluessel', 'endtest.key'),
    sidecarPfad: path.join(wurzel, 'protokoll', 'endtest-versiegelung.json'),
    log: still,
  };
}

// Eine Datei, die nicht zufaellig aussieht: so faellt beim Suchen nach Klartext-Resten
// jede Kopie auf, auch eine halbe.
function testInhalt(bytes = 300 * 1024) {
  const brocken = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 1) brocken[i] = (i * 31 + 7) % 251;
  return brocken;
}

function alleDateien(wurzel) {
  return fs
    .readdirSync(wurzel, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath || e.path, e.name));
}

test('Versiegeln: Rueckentschluesselung ergibt byte-genau den Klartext', async () => {
  const inhalt = testInhalt();
  const b = buehne(inhalt);
  const erwartet = crypto.createHash('sha256').update(inhalt).digest('hex');

  const sidecar = await siegel.versiegele(b);

  assert.equal(sidecar.sha256Klartext, erwartet);
  assert.equal(sidecar.bytesKlartext, inhalt.length);
  assert.equal(sidecar.klartextGeloescht, true);
  assert.equal(fs.existsSync(b.klartextPfad), false, 'Der Klartext muss nach der Verifikation weg sein');
  assert.ok(fs.existsSync(b.siegelPfad), 'Die Siegel-Datei muss existieren');

  // Das Siegel ist wirklich verschluesselt und nicht nur umbenannt.
  const siegelBytes = fs.readFileSync(b.siegelPfad);
  assert.notEqual(siegelBytes.toString('hex'), inhalt.toString('hex'));
  assert.equal(
    crypto.createHash('sha256').update(siegelBytes).digest('hex'),
    sidecar.sha256Siegel,
  );

  // Der Schluessel steht nirgends im Sidecar — nur sein Fingerabdruck.
  const sidecarText = fs.readFileSync(b.sidecarPfad, 'utf8');
  const schluesselHex = fs.readFileSync(b.schluesselPfad, 'utf8').trim();
  assert.equal(sidecarText.includes(schluesselHex), false, 'Der Schluessel darf nie ins Sidecar');
  assert.equal(
    sidecar.sha256Schluessel,
    crypto.createHash('sha256').update(Buffer.from(schluesselHex, 'hex')).digest('hex'),
  );

  // Und die Nachpruefung ist gruen.
  await siegel.pruefe(b);
});

test('Keine zweite Klartext-Kopie auf der Platte', async () => {
  const inhalt = testInhalt();
  const b = buehne(inhalt);
  await siegel.versiegele(b);

  const anfang = inhalt.subarray(0, 4096);
  for (const datei of alleDateien(b.wurzel)) {
    const bytes = fs.readFileSync(datei);
    assert.equal(
      bytes.includes(anfang),
      false,
      `${path.relative(b.wurzel, datei)} enthaelt Klartext-Bytes — eine Kopie ist entstanden`,
    );
  }
  // Gegenprobe am Sucher selbst: haette er eine Kopie gefunden?
  const koeder = path.join(b.wurzel, 'koeder.bin');
  fs.writeFileSync(koeder, inhalt);
  assert.ok(alleDateien(b.wurzel).some((d) => fs.readFileSync(d).includes(anfang)));
  fs.unlinkSync(koeder);
});

test('Bruchprobe 1: ein gekipptes Byte macht die Pruefung rot, die intakte Kopie wieder gruen', async () => {
  const b = buehne(testInhalt());
  await siegel.versiegele(b);

  const intakt = fs.readFileSync(b.siegelPfad);
  const kaputt = Buffer.from(intakt);
  kaputt[1234] ^= 0x01;                       // genau EIN Bit
  fs.writeFileSync(b.siegelPfad, kaputt);

  await assert.rejects(
    () => siegel.pruefe(b),
    (fehler) => {
      assert.ok(fehler instanceof siegel.SiegelFehler, 'Kein roher Krypto-Fehler nach aussen');
      assert.match(fehler.message, /Authentifizierungs-Tag passt nicht/);
      assert.match(fehler.message, /kein Klartext erzeugt/);
      return true;
    },
  );

  fs.writeFileSync(b.siegelPfad, intakt);
  await siegel.pruefe(b);                     // wieder gruen
});

test('Bruchprobe 2: der falsche Schluessel scheitert verstaendlich, nicht mit Stacktrace', async () => {
  const b = buehne(testInhalt());
  const sidecar = await siegel.versiegele(b);

  const fremd = crypto.randomBytes(32);
  fs.writeFileSync(b.schluesselPfad, fremd.toString('hex') + '\n');

  // Erste Mauer: der Fingerabdruck im Sidecar.
  await assert.rejects(
    () => siegel.pruefe(b),
    (fehler) => {
      assert.ok(fehler instanceof siegel.SiegelFehler);
      assert.match(fehler.message, /Falscher Schluessel/);
      return true;
    },
  );

  // Zweite Mauer: auch wenn jemand den Fingerabdruck im Sidecar mitfaelscht, kommt
  // kein Klartext heraus — dann schlaegt der GCM-Tag an.
  const gefaelscht = {
    ...sidecar,
    sha256Schluessel: crypto.createHash('sha256').update(fremd).digest('hex'),
  };
  fs.writeFileSync(b.sidecarPfad, JSON.stringify(gefaelscht, null, 2));
  await assert.rejects(
    () => siegel.pruefe(b),
    (fehler) => {
      assert.ok(fehler instanceof siegel.SiegelFehler);
      assert.match(fehler.message, /Authentifizierungs-Tag passt nicht|falsche.? Schluessel/);
      assert.equal(/at .*\.js:\d+/.test(fehler.message), false, 'Keine Stacktrace-Zeile in der Meldung');
      return true;
    },
  );
});

test('Rote Verifikation loescht den Klartext NICHT', async () => {
  const b = buehne(testInhalt());
  // Die Verifikation wird echt gebrochen: sie entschluesselt mit einem fremden
  // Schluessel. Genau das muss den Lauf anhalten, BEVOR geloescht wird.
  const echt = crypto.createDecipheriv;
  crypto.createDecipheriv = (algo, _schluessel, iv) => echt(algo, crypto.randomBytes(32), iv);
  try {
    await assert.rejects(
      () => siegel.versiegele(b),
      (fehler) => {
        assert.match(fehler.message, /Verifikation fehlgeschlagen/);
        return true;
      },
    );
  } finally {
    crypto.createDecipheriv = echt;
  }
  assert.ok(fs.existsSync(b.klartextPfad), 'Bei roter Verifikation muss der Klartext liegen bleiben');
  assert.equal(fs.existsSync(b.sidecarPfad), false, 'Ohne Verifikation entsteht kein Siegel-Protokoll');
});

test('Ein zweiter Lauf ueberschreibt weder Schluessel noch Siegel', async () => {
  const b = buehne(testInhalt(1024));
  await siegel.versiegele(b);
  const schluesselVorher = fs.readFileSync(b.schluesselPfad, 'utf8');

  fs.writeFileSync(b.klartextPfad, testInhalt(1024));   // jemand baut das Panel neu
  await assert.rejects(
    () => siegel.versiegele(b),
    (fehler) => {
      assert.match(fehler.message, /liegt schon eine Siegel-Datei/);
      return true;
    },
  );
  assert.equal(fs.readFileSync(b.schluesselPfad, 'utf8'), schluesselVorher);
});
