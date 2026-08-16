'use strict';

// Waechter ueber die Regel-Registry selbst.
//
// Die SACHE: KEINE der 17 Regeln darf still unbewacht sein. Eine Regel ist entweder
// jetzt scharf (mit einem Wachtest, den es wirklich gibt und den das CI-Gate auch
// faehrt) oder sie nennt die Etappe UND das Artefakt, an dem sie scharf wird. "Steht
// im Dokument" ist kein Zustand — genau so sind im Altapparat tote Wachtests
// entstanden. Zusaetzlich prueft dieser Waechter die Forschungs-Schleife R16: ein
// Etappen-Report ohne Folgefragen-Block ist unvollstaendig.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const REGELWERK = path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'rules.json');
const REPORTS = path.join(REPO, 'reports', 'studie');

const regelwerk = JSON.parse(fs.readFileSync(REGELWERK, 'utf8'));

test('Alle 17 Regeln stehen in der Registry, luecken- und doppelfrei', () => {
  const ids = regelwerk.regeln.map((regel) => regel.id);
  const erwartet = Array.from({ length: 17 }, (unused, index) => `R${index + 1}`);
  assert.deepEqual(ids, erwartet, 'Regel fehlt, ist doppelt oder steht in falscher Reihenfolge');
  assert.equal(regelwerk.version, '2.0.0');
});

test('Keine Regel ist still unbewacht', () => {
  for (const regel of regelwerk.regeln) {
    const waechter = regel.waechter;
    assert.ok(String(regel.nagelt || '').length > 20, `${regel.id}: ohne Satz, WAS der Waechter festnagelt`);
    assert.ok(
      Object.keys(regelwerk.waechterArten).includes(waechter.art),
      `${regel.id}: unbekannte Waechter-Art '${waechter.art}'`,
    );
    assert.ok(String(waechter.scharfAb || '').length > 0, `${regel.id}: ohne Angabe, ab wann sie scharf ist`);

    if (waechter.art === 'vorlage') {
      assert.equal(waechter.test, null, `${regel.id}: Vorlagen-Regel darf keinen Wachtest vortaeuschen`);
      assert.ok(
        String(waechter.artefakt || '').length > 0,
        `${regel.id}: eine noch nicht scharfe Regel muss das Artefakt benennen, an dem sie scharf wird`,
      );
    } else {
      assert.ok(
        /^tests\/.*test\.js$/.test(String(waechter.test)),
        `${regel.id}: Wachtest '${waechter.test}' liegt nicht unter tests/ und wuerde vom CI-Gate nicht erfasst`,
      );
      assert.ok(
        fs.existsSync(path.join(REPO, waechter.test)),
        `${regel.id}: benannter Wachtest existiert nicht: ${waechter.test}`,
      );
    }
  }
});

test('Die fuenf evidenztragenden Waechter sind scharf und waren einmal absichtlich rot', () => {
  assert.deepEqual(
    regelwerk.evidenztragendeWaechter,
    ['R1', 'R2', 'R4', 'R6', 'R13'],
    'Die Verfassung benennt genau diese fuenf — die Liste ist keine freie Wahl',
  );
  for (const id of regelwerk.evidenztragendeWaechter) {
    const regel = regelwerk.regeln.find((eintrag) => eintrag.id === id);
    assert.ok(regel, `${id} fehlt in der Registry`);
    assert.notEqual(regel.waechter.art, 'vorlage', `${id} darf keine blosse Vorlage sein`);
    assert.equal(regel.waechter.ausbauProbe, true, `${id}: ohne Ausbau-Probe`);
    assert.match(
      String(regel.waechter.rotGezeigtAm),
      /^\d{4}-\d{2}-\d{2}$/,
      `${id}: kein Datum, an dem der Waechter absichtlich rot war`,
    );
  }
});

test('Was noch nicht scharf ist, wird offen benannt statt weggelassen', () => {
  // Ein "offen"-Feld ist erlaubt — verschwiegene Luecken sind es nicht. Jede Regel,
  // die eine Teil-Pruefung vertagt, muss sagen worauf.
  for (const regel of regelwerk.regeln) {
    if (regel.waechter.offen !== undefined) {
      assert.ok(String(regel.waechter.offen).length > 30, `${regel.id}: 'offen' ohne Inhalt`);
    }
  }
  const vertagt = regelwerk.regeln.filter((regel) => regel.waechter.art === 'vorlage').map((regel) => regel.id);
  assert.ok(vertagt.length > 0 && vertagt.length < 17, 'Entweder alles vertagt oder nichts — beides waere unehrlich');
});

test('R16: jeder Etappen-Report fuehrt den Block Neue Fragen und Hypothesen', () => {
  if (!fs.existsSync(REPORTS)) return; // vor dem ersten Report gibt es nichts zu pruefen
  const berichte = fs.readdirSync(REPORTS).filter((name) => name.endsWith('.md'));
  assert.ok(berichte.length > 0, 'reports/studie/ existiert, ist aber leer');
  for (const name of berichte) {
    const text = fs.readFileSync(path.join(REPORTS, name), 'utf8');
    assert.ok(
      /Neue Fragen und Hypothesen/i.test(text),
      `${name}: Etappen-Report ohne Folgefragen-Block ist nach R16 unvollstaendig`,
    );
    // Vorgeschlagene neue Etappen brauchen eine Zeitschaetzung, sonst werden sie
    // nicht angenommen — die Schaetzung steht in derselben Zeile.
    for (const zeile of text.split('\n').filter((line) => /^\s*[-*]\s*VORSCHLAG/i.test(line))) {
      assert.match(
        zeile,
        /\d+\s*(-|bis|–)?\s*\d*\s*(Tag|Tage|Stunden)/i,
        `${name}: Etappen-Vorschlag ohne Zeitschaetzung: ${zeile.trim()}`,
      );
    }
  }
});
