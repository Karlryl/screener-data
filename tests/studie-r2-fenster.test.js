'use strict';

// R2 — Drei Zeitfenster, physisch getrennt.
//
// Die SACHE: eine Anfrage nach einem Quartal des Test- oder Pruef-Fensters aus dem
// Entdeckungs-Modus heraus muss einen FEHLER werfen, nicht eine Warnung loggen. Und
// die Pufferjahre 2016/2020 gehoeren keinem Fenster — sonst reichen Folgequartale
// ueber die Mauer. Geprueft wird in beide Richtungen: jedes Fenster laesst seine
// eigenen Quartale durch und wirft bei allen fremden.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {
  pruefeFenster,
  ladeRegelwerk,
  quartalsSchluessel,
  VerfassungsBruch,
  REGELWERK_PFAD,
} = require('../lib/studie-verfassung');

const regelwerk = ladeRegelwerk();

test('R2: jedes Fenster laesst seine eigenen Randquartale durch', () => {
  for (const [modus, fenster] of Object.entries(regelwerk.fenster)) {
    const optionen = fenster.versiegelt
      ? { regelwerk, oeffnungsprotokoll: regelwerk.oeffnungsprotokollMarke }
      : { regelwerk };
    assert.equal(pruefeFenster(modus, fenster.von, optionen), true, `${modus} verweigert sein eigenes Startquartal`);
    assert.equal(pruefeFenster(modus, fenster.bis, optionen), true, `${modus} verweigert sein eigenes Endquartal`);
  }
});

test('R2: Testfenster-Anfrage im Entdeckungs-Modus wirft', () => {
  assert.throws(
    () => pruefeFenster('entdeckung', '2022q3', { regelwerk }),
    (fehler) => fehler instanceof VerfassungsBruch && /Fenster-Mauer verletzt/.test(fehler.message),
  );
  assert.throws(() => pruefeFenster('entdeckung', '2018q1', { regelwerk }), VerfassungsBruch);
  assert.throws(() => pruefeFenster('validierung', '2013q4', { regelwerk }), VerfassungsBruch);
});

test('R2: die Pufferjahre gehoeren keinem Fenster', () => {
  for (const jahr of regelwerk.pufferjahre) {
    for (const modus of Object.keys(regelwerk.fenster)) {
      assert.throws(
        () => pruefeFenster(modus, `${jahr}q1`, { regelwerk, oeffnungsprotokoll: regelwerk.oeffnungsprotokollMarke }),
        VerfassungsBruch,
        `Pufferjahr ${jahr} ist im Fenster ${modus} erreichbar — Reifebereinigung kaputt`,
      );
    }
  }
});

test('R2/R4: das Endtest-Fenster oeffnet nur mit der Oeffnungsprotokoll-Marke', () => {
  assert.throws(
    () => pruefeFenster('endtest', '2022q1', { regelwerk }),
    (fehler) => fehler instanceof VerfassungsBruch && /versiegelt/.test(fehler.message),
  );
  assert.throws(
    () => pruefeFenster('endtest', '2022q1', { regelwerk, oeffnungsprotokoll: 'irgendwas' }),
    VerfassungsBruch,
  );
  assert.equal(
    pruefeFenster('endtest', '2022q1', { regelwerk, oeffnungsprotokoll: regelwerk.oeffnungsprotokollMarke }),
    true,
  );
});

test('R2: die Versiegelung ist heute ein Aufrufmuster — und die Registry sagt das auch', () => {
  // Gegenrede-Befund 16.08.: pruefeFenster vergleicht nur gegen eine Marke, die als
  // Klartext in der eingecheckten rules.json steht. Wer sie absichtlich lesen will,
  // liest sie — das ist kein Zugriffsschutz. Die Verfassung verspricht fuer R2 aber
  // "eine verschluesselte Datei ist eine Eigenschaft der Bytes".
  //
  // STAND 19.08.2026: Diese Bytes existieren jetzt — panel-endtest.sqlite.enc, aes-256-gcm,
  // die offene Fassung geloescht. Der Schutz ist also da. Was dieser Waechter festnagelt,
  // aendert sich dadurch NICHT: die Marke steht weiterhin im Klartext im Repo, und
  // pruefeFenster() prueft weiterhin nur gegen sie. Wer die Marke liest, kommt an der
  // Fenster-Regel vorbei — er kommt nur nicht mehr an die Daten, weil ihm der Schluessel
  // fehlt. Genau diese Unterscheidung darf nicht verwischen.
  //
  // Der Waechter wird rot, wenn jemand den offen-Vermerk streicht oder zu "ist versiegelt"
  // verkuerzt, ohne die Marke aus dem Repo zu holen — also wenn die Marke stillschweigend
  // fuer den Schluessel gehalten wird. Gegenprobe am 19.08. durchgefuehrt: genau so
  // verkuerzt -> dieser Test rot.
  const roh = fs.readFileSync(REGELWERK_PFAD, 'utf8');
  const r2 = regelwerk.regeln.find((regel) => regel.id === 'R2');
  const offen = String(r2.waechter.offen || '');
  const markeImKlartext = roh.includes(regelwerk.oeffnungsprotokollMarke);
  assert.equal(markeImKlartext, true, 'Annahme dieses Waechters: die Marke steht in der Registry selbst');
  assert.match(
    offen,
    /Klartext/,
    'Die Oeffnungsmarke liegt im Klartext im Repo — dann muss der offen-Vermerk zu R2 genau das sagen',
  );
  assert.match(
    offen,
    /KEIN Zugriffsschutz|kein Zugriffsschutz/,
    'R2 darf nicht als Zugriffsschutz gelesen werden, solange die Marke im Repo steht',
  );
  assert.match(offen, /VERSCHLUESSELUNG|Verschluesselung/, 'Es muss dastehen, was stattdessen noch fehlt');
});

test('R2: die Fenster ueberlappen sich nicht und liegen in der richtigen Reihenfolge', () => {
  const grenzen = ['entdeckung', 'validierung', 'endtest'].map((modus) => ({
    modus,
    von: quartalsSchluessel(regelwerk.fenster[modus].von),
    bis: quartalsSchluessel(regelwerk.fenster[modus].bis),
  }));
  for (let i = 1; i < grenzen.length; i += 1) {
    assert.ok(
      grenzen[i].von > grenzen[i - 1].bis + 4,
      `${grenzen[i - 1].modus} und ${grenzen[i].modus} liegen ohne vier Puffer-Quartale nebeneinander`,
    );
  }
});

test('R2: unbekannter Modus und unlesbares Quartal werden nicht durchgewunken', () => {
  assert.throws(() => pruefeFenster('irgendwas', '2012q1', { regelwerk }), VerfassungsBruch);
  assert.throws(() => pruefeFenster('entdeckung', '2012-03', { regelwerk }), VerfassungsBruch);
});
