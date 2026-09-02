'use strict';
/**
 * Waechter fuer den Ausreisser-Waechter (29.07., Anlass Cigna).
 *
 * DIE SACHE: Wird ein Jahr erkannt, das von BEIDEN Nachbarn um Groessenordnungen
 * abweicht? Und — genauso wichtig — bleibt eine normale Reihe unauffaellig? Ein
 * Detektor, der alles meldet, ist so wertlos wie einer, der nichts meldet. Beide
 * Richtungen werden hier geprueft.
 *
 * Usage: node tests/annual-spikes.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { findeAusreisser } = require('../scripts/watch-annual-spikes.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
const reihe = (...zahlen) => zahlen.map((v) => (v === null ? null : { value: v * 1e6 }));

check('der echte Cigna-Fall wird gefunden', () => {
  // Reihenfolge wie im Store (neueste zuerst): null, 8.444, -88.600, 7.295, 15.570 Mio
  const t = findeAusreisser(reihe(null, 8444, -88600, 7295, 15570));
  assert.equal(t.length, 1, 'genau ein Ausreisser erwartet');
  assert.equal(t[0].index, 2);
  assert.equal(t[0].wert, -88600e6);
});

check('eine normale Reihe bleibt still — auch bei kraeftigem Wachstum', () => {
  assert.deepEqual(findeAusreisser(reihe(1200, 900, 700, 500, 380)), []);
  // Verdopplung je Jahr: schnell, aber kein Ausreisser.
  assert.deepEqual(findeAusreisser(reihe(1600, 800, 400, 200, 100)), []);
  // Ein Verlustjahr in normaler Groessenordnung ist kein Ausreisser.
  assert.deepEqual(findeAusreisser(reihe(500, -300, 400, 450, 480)), []);
});

check('Raender werden NICHT beurteilt — ohne zweiten Nachbarn waere es geraten', () => {
  assert.deepEqual(findeAusreisser(reihe(-99000, 700, 800, 900)), []);
  assert.deepEqual(findeAusreisser(reihe(700, 800, 900, -99000)), []);
});

check('Luecken brechen die Pruefung nicht und erzeugen keinen Treffer', () => {
  assert.deepEqual(findeAusreisser(reihe(700, null, -99000, null, 900)), []);
  assert.deepEqual(findeAusreisser([]), []);
  assert.deepEqual(findeAusreisser(null), []);
  assert.deepEqual(findeAusreisser(undefined), []);
});

check('winzige Betraege loesen nichts aus, auch wenn das Verhaeltnis gross ist', () => {
  // 8 Mio gegen 0,5 Mio ist Faktor 16 — aber unter der Betragsschwelle.
  assert.deepEqual(findeAusreisser(reihe(0.4, 8, 0.5, 0.6)), []);
});

check('die Schwelle ist einstellbar und wirkt', () => {
  const r = reihe(100, 500, 100, 100);
  assert.equal(findeAusreisser(r, 8).length, 0, 'Faktor 5 liegt unter der Standardschwelle 8');
  assert.equal(findeAusreisser(r, 4).length, 1, 'mit Faktor 4 muss derselbe Punkt auffliegen');
});

// --- Populations-Wache (Fund 29.07.2026) -----------------------------------
// Die Wache klagt die BASIS an, wenn sie auf einer anderen Population aufgenommen
// wurde. Geprueft wird beides: dass sie feuert UND dass sie schweigt — eine Wache,
// die immer feuert, ist genauso wertlos wie eine, die nie feuert.
const { basisGueltig, POP_TOLERANZ } = require('../scripts/watch-annual-spikes.js');
const basisMit = (n) => ({ faelle: ['A|annualRev|1'], snapshotsBeiAufnahme: n });

check('gleiche Population -> Basis gilt, es wird normal geprueft', () => {
  assert.equal(basisGueltig(basisMit(12000), 12000).ok, true);
  assert.equal(basisGueltig(basisMit(12000), 13000).ok, true, '8 % Wachstum ist Alltag');
});

check('andere Population -> die BASIS wird angeklagt, nicht die Funde', () => {
  const r = basisGueltig(basisMit(4768), 12482);
  assert.equal(r.ok, false);
  assert.match(r.grund, /UNGUELTIG, nicht die Funde/,
    'die Meldung muss auf die Basis zeigen — sonst untersucht der Leser die falschen Zahlen');
  assert.match(r.grund, /4768/, 'die Aufnahme-Zahl gehoert in die Meldung');
  assert.match(r.grund, /12482/, 'die heutige Zahl gehoert in die Meldung');
  // auch der umgekehrte Fall: Population geschrumpft
  assert.equal(basisGueltig(basisMit(12482), 4768).ok, false);
});

check('die Toleranzgrenze wirkt in BEIDE Richtungen', () => {
  const n = 10000, knappDrunter = Math.round(n * (1 + POP_TOLERANZ * 0.9));
  const knappDrueber = Math.round(n * (1 + POP_TOLERANZ * 1.1));
  assert.equal(basisGueltig(basisMit(n), knappDrunter).ok, true, 'knapp innerhalb muss durchgehen');
  assert.equal(basisGueltig(basisMit(n), knappDrueber).ok, false, 'knapp ausserhalb muss auffliegen');
});

check('Basis ohne Populationsangabe ist ungueltig — Schweigen waere hier das Schlimmste', () => {
  const r = basisGueltig({ faelle: ['A|annualRev|1'] }, 12482);
  assert.equal(r.ok, false);
  assert.match(r.grund, /snapshotsBeiAufnahme/);
});

check('Erstlauf ohne Basis wird NICHT angeklagt', () => {
  assert.equal(basisGueltig({}, 12482).ok, true);
  assert.equal(basisGueltig(null, 12482).ok, true);
});

// --- Capex-Vorzeichen (Review-Befund 03.08.2026) ---------------------------
// Die Burn-Bremse rekonstruiert fehlendes OCF als FCF minus Capex (lamps.js
// operatingCashSeries). Dass daraus nie eine Strafe OHNE sichtbare Lampe wird, ruht auf
// einer DATENannahme: Capex ist negativ gespeichert (Mittelabfluss). Heute gilt sie
// vollstaendig — 0 positive Werte bei 17.357 gemessenen im lokalen Baum, 0 von 40.950 im
// CI-Baum. Ungeprueft war sie trotzdem, und der snake_case-Fallback in _ftsValue koennte
// sie theoretisch verletzen. Grundlast 0 heisst: JEDES Auftreten ist ein Ereignis, nicht
// ein Anteil (dieselbe Schwellen-Logik wie beim hartkodierten FX-Kurs in watch-fx-sanity).
const { positiveCapexJahre } = require('../scripts/watch-annual-spikes.js');

check('positiveCapexJahre: der Normalfall (alles negativ) meldet nichts', () => {
  assert.deepEqual(positiveCapexJahre({ annual: { annualCapex: [-500e6, -300e6, null, -100e6] } }), []);
  assert.deepEqual(positiveCapexJahre({ annual: {} }), [], 'fehlende Reihe ist kein Befund');
  assert.deepEqual(positiveCapexJahre({}), []);
});

check('positiveCapexJahre: ein POSITIVER Wert fliegt auf, mit Position und Betrag', () => {
  const t = positiveCapexJahre({ annual: { annualCapex: [-500e6, 42e6, -100e6] } });
  assert.equal(t.length, 1);
  assert.equal(t[0].index, 1);
  assert.equal(t[0].wert, 42e6);
  // mehrere zugleich werden alle gemeldet, keine stille Kappung
  assert.equal(positiveCapexJahre({ annual: { annualCapex: [7, -1, 9] } }).length, 2);
});

check('positiveCapexJahre: exakt 0 ist KEIN Verstoss (Capex <= 0 ist die Annahme)', () => {
  assert.deepEqual(positiveCapexJahre({ annual: { annualCapex: [0, -1] } }), []);
});

// --- Parse-Fehler-Zaehler (Review-Befund 03.08.2026) -----------------------
// Bis hierher verschluckte der Scan kaputte Snapshots per "catch (_) { continue; }". Folge:
// die Pruefmenge schrumpft lautlos, und die Zeile "Jahres-Ausreisser: N in M Snapshots" nennt
// M = gefundene DATEIEN, nicht M = tatsaechlich GELESENE. Ein Verzeichnis voll unlesbarer
// Dateien meldet damit "0 Ausreisser bei 12.482 Snapshots" — eine Entwarnung fuer einen Lauf,
// der nichts gelesen hat. watch-fx-sanity zaehlt ueber DERSELBEN Population bereits
// parseFehler und wird ab dem ersten rot; hier fehlte das Gegenstueck.
const fsT = require('node:fs');
const osT = require('node:os');
const pathT = require('node:path');
const { scanSnapshots } = require('../scripts/watch-annual-spikes.js');

check('scanSnapshots zaehlt kaputte Dateien, statt die Pruefmenge lautlos zu schrumpfen', () => {
  const dir = fsT.mkdtempSync(pathT.join(osT.tmpdir(), 'annual-spikes-test-'));
  try {
    fsT.writeFileSync(pathT.join(dir, 'GUT.json'), JSON.stringify({
      meta: { ticker: 'GUT' }, annual: { annualCapex: [-100e6, -90e6] },
    }));
    fsT.writeFileSync(pathT.join(dir, 'KAPUTT.json'), '{ das ist kein JSON');
    const r = scanSnapshots(dir);
    assert.equal(r.gescannt, 2, 'beide Dateien liegen im Verzeichnis und werden angefasst');
    assert.equal(r.parseFehler, 1, 'die kaputte Datei MUSS gezaehlt werden, nicht verschluckt');
    assert.equal(r.capexWerte, 2, 'nur die lesbare Datei kann Werte beitragen');
  } finally { fsT.rmSync(dir, { recursive: true, force: true }); }
});

check('scanSnapshots: ein sauberes Verzeichnis meldet 0 Parse-Fehler (Gegenprobe)', () => {
  const dir = fsT.mkdtempSync(pathT.join(osT.tmpdir(), 'annual-spikes-test-'));
  try {
    fsT.writeFileSync(pathT.join(dir, 'A.json'), JSON.stringify({
      meta: { ticker: 'A' }, annual: { annualCapex: [-5e6], annualRev: [{ value: 100e6 }, { value: 900e6 }, { value: 110e6 }] },
    }));
    const r = scanSnapshots(dir);
    assert.equal(r.gescannt, 1);
    assert.equal(r.parseFehler, 0, 'ein Zaehler, der immer feuert, waere so wertlos wie keiner');
    assert.equal(r.funde.length, 1, 'der eingebaute Ausreisser (900 gegen 100/110) muss gefunden werden');
    assert.equal(r.funde[0].ticker, 'A');
  } finally { fsT.rmSync(dir, { recursive: true, force: true }); }
});

// ── WEG C (29.08.2026): die Ausschluss-Liste der Neuaufnahme ─────────────────────────
// --neu-aufnehmen absorbierte bisher ALLE heutigen Funde — ein bewusst offen gelassener
// Fall (BANPU.BK, 19.08.) waere still verschluckt worden und haette nie wieder gefeuert.
// Beide Richtungen: der Ausschluss haelt UND Nicht-Ausgeschlossenes wird aufgenommen
// UND die Liste ueberlebt die Neuaufnahme unveraendert.
{
  const { baueNeuenBestand } = require('../scripts/watch-annual-spikes.js');
  const fund = (ticker, reihe2, periode) => ({ ticker, reihe: reihe2, periode, index: 1, wert: 9e9, links: 1e8, rechts: 1e8 });
  const funde = [
    fund('BANPU.BK', 'annualOpInc', '2023-12-31'),
    fund('AAA', 'annualRev', '2024-12-31'),
    fund('BBB', 'annualNetIncome', '2022-12-31'),
  ];
  const basis = {
    hinweis: 'x',
    ausgeschlossen: [{ schluessel: 'BANPU.BK|annualOpInc|2023-12-31', hinweis: 'NICHT ENTSCHEIDBAR (19.08.): Reihe widerspricht sich selbst und dem Emittenten; Verdacht eher auf Nachbarjahr 2022.', seit: '2026-08-29' }],
  };

  check('Weg C: der Ausschluss haelt — ein gesperrter Fall wird NIE in den Bestand aufgenommen', () => {
    const b = baueNeuenBestand(basis, funde, 15045, new Date('2026-08-29T12:00:00Z'));
    assert.ok(!b.faelle.includes('BANPU.BK|annualOpInc|2023-12-31'), 'BANPU darf nicht absorbiert werden');
    assert.equal(b.anzahl, b.faelle.length, 'anzahl beschreibt den Bestand, nicht die Funde');
  });

  check('Weg C: Nicht-Ausgeschlossenes wird aufgenommen (Gegenrichtung)', () => {
    const b = baueNeuenBestand(basis, funde, 15045, new Date('2026-08-29T12:00:00Z'));
    assert.ok(b.faelle.includes('AAA|annualRev|2024-12-31'));
    assert.ok(b.faelle.includes('BBB|annualNetIncome|2022-12-31'));
    assert.equal(b.faelle.length, 2);
    assert.equal(b.snapshotsBeiAufnahme, 15045);
    assert.equal(b.aufgenommenAm, '2026-08-29');
  });

  check('Weg C: die Ausschluss-Liste ueberlebt die Neuaufnahme UNVERAENDERT', () => {
    const b = baueNeuenBestand(basis, funde, 15045, new Date('2026-08-29T12:00:00Z'));
    assert.deepEqual(b.ausgeschlossen, basis.ausgeschlossen,
      'eine Neuaufnahme, die die Sperren verschluckt, waere exakt der Fehler, den sie verhindern soll');
  });

  check('Weg C: ein Ausschluss ohne schriftlichen Hinweis wird NICHT geschrieben (throw)', () => {
    for (const kaputt of [
      [{ schluessel: 'X|annualRev|2024-12-31' }],
      [{ schluessel: 'X|annualRev|2024-12-31', hinweis: '   ' }],
      [{ hinweis: 'Grund ohne Schluessel' }],
      [null],
    ]) {
      assert.throws(() => baueNeuenBestand({ ...basis, ausgeschlossen: kaputt }, funde, 15045),
        /schluessel UND schriftlichen hinweis/, JSON.stringify(kaputt));
    }
  });

  check('Weg C: ohne Ausschluss-Liste verhaelt sich die Neuaufnahme wie bisher (Bestandsfaelle)', () => {
    const b = baueNeuenBestand({ hinweis: 'x' }, funde, 15045, new Date('2026-08-29T12:00:00Z'));
    assert.equal(b.faelle.length, 3, 'alle Funde absorbiert, wie vor Weg C');
    assert.deepEqual(b.ausgeschlossen, [], 'leere Liste wird explizit geschrieben, nicht weggelassen');
  });

  // Review-Befund HIGH (29.08.): "Feld fehlt" darf still [] sein, "Feld da aber kein
  // Array" NICHT — sonst hoebe ein kaputter Merge alle Sperren lautlos auf.
  check('Weg C: ausgeschlossen mit falschem Typ wirft, statt still alle Sperren aufzuheben', () => {
    for (const kaputt of [null, 'BANPU.BK', { schluessel: 'x' }, 42]) {
      assert.throws(() => baueNeuenBestand({ hinweis: 'x', ausgeschlossen: kaputt }, funde, 15045),
        /statt einer Liste/, `ausgeschlossen=${JSON.stringify(kaputt)}`);
    }
  });

  // Review-Befund MITTEL (29.08.): Sperre in ausgeschlossen UND faelle -> faelle gewinnt
  // still in istBekannt(). basisGueltig() faengt den handgebauten Zustand jetzt laut.
  check('Weg C: Schluessel in ausgeschlossen UND faelle macht den Bestand UNGUELTIG', () => {
    const { basisGueltig } = require('../scripts/watch-annual-spikes.js');
    const widerspruch = {
      faelle: ['BANPU.BK|annualOpInc|2023-12-31'],
      snapshotsBeiAufnahme: 15045,
      ausgeschlossen: [{ schluessel: 'BANPU.BK|annualOpInc|2023-12-31', hinweis: 'x', seit: '2026-08-29' }],
    };
    const g = basisGueltig(widerspruch, 15045);
    assert.equal(g.ok, false);
    assert.match(g.grund, /ausgeschlossen UND in faelle/);
    // Abwesenheits-Richtung: disjunkte Mengen bleiben gueltig.
    const sauber = basisGueltig({ ...widerspruch, faelle: ['AAA|annualRev|2024-12-31'] }, 15045);
    assert.equal(sauber.ok, true, sauber.grund);
  });

  // Review-Befund MITTEL (29.08.): eine Sperre ohne heutigen Treffer unterdrueckt nichts
  // mehr und muss sichtbar werden (Aufloesung ODER kaputter Schluessel).
  check('Weg C: Sperren ohne heutigen Treffer werden benannt, treffende nicht', () => {
    const { sperrenOhneTreffer } = require('../scripts/watch-annual-spikes.js');
    const sperren = [
      { schluessel: 'BANPU.BK|annualOpInc|2023-12-31', hinweis: 'x' },
      { schluessel: 'WEG.GE|annualRev|2019-12-31', hinweis: 'Tippfehler-Kandidat' },
    ];
    assert.deepEqual(sperrenOhneTreffer(sperren, funde), ['WEG.GE|annualRev|2019-12-31']);
    assert.deepEqual(sperrenOhneTreffer([], funde), []);
  });
}

// --- ANNUAL_SPIKE_MAX_NEU fail-closed boundary (H20) -----------------------
// A malformed threshold used to become NaN. Every comparison `count > NaN` is
// false, so an operator typo disabled precisely the anomaly gate it configured.
{
  const watcher = require('../scripts/watch-annual-spikes.js');

  check('ANNUAL_SPIKE_MAX_NEU accepts only the documented safe integer domain', () => {
    assert.equal(watcher.parseMaxNeu(undefined), 5, 'unset keeps the documented default');
    assert.equal(watcher.parseMaxNeu(''), 5, 'empty keeps the established default');
    assert.equal(watcher.parseMaxNeu('0'), 0, 'zero remains a valid strict threshold');
    assert.equal(watcher.parseMaxNeu('5'), 5);
    assert.equal(watcher.parseMaxNeu('9007199254740991'), Number.MAX_SAFE_INTEGER);

    for (const bad of [
      null, 5, true, ' ', '-1', '+5', '1.5', '1e2', '0x10', 'Infinity',
      'NaN', '5x', '9007199254740992', {},
    ]) {
      assert.throws(() => watcher.parseMaxNeu(bad), /ANNUAL_SPIKE_MAX_NEU/,
        `must reject ${JSON.stringify(bad)}`);
    }
  });

  check('invalid threshold is rejected before snapshot filesystem access', () => {
    const originalExistsSync = fsT.existsSync;
    const previous = process.env.ANNUAL_SPIKE_MAX_NEU;
    let filesystemCalls = 0;
    fsT.existsSync = () => {
      filesystemCalls++;
      throw new Error('annual-spike filesystem tripwire');
    };
    try {
      process.env.ANNUAL_SPIKE_MAX_NEU = 'not-a-number';
      assert.throws(() => watcher.main(), /ANNUAL_SPIKE_MAX_NEU/);
      assert.equal(filesystemCalls, 0, 'invalid configuration must fail before snapshot access');

      process.env.ANNUAL_SPIKE_MAX_NEU = '0';
      assert.throws(() => watcher.main(), /annual-spike filesystem tripwire/,
        'valid control must reach the filesystem tripwire');
      assert.equal(filesystemCalls, 1, 'the valid control proves the tripwire is live');
    } finally {
      fsT.existsSync = originalExistsSync;
      if (previous === undefined) delete process.env.ANNUAL_SPIKE_MAX_NEU;
      else process.env.ANNUAL_SPIKE_MAX_NEU = previous;
    }
    assert.equal(fsT.existsSync, originalExistsSync, 'filesystem stub must be restored');
  });

  check('the parsed threshold controls the real anomaly comparison', () => {
    const originalExistsSync = fsT.existsSync;
    const originalReaddirSync = fsT.readdirSync;
    const originalReadFileSync = fsT.readFileSync;
    const originalLog = console.log;
    const originalError = console.error;
    const originalArgv = process.argv;
    const previous = process.env.ANNUAL_SPIKE_MAX_NEU;
    const snapshot = JSON.stringify({
      meta: { ticker: 'AAA' },
      annual: {
        annualRev: [{ value: 100e6 }, { value: 900e6 }, { value: 100e6 }],
        annualCapex: [-1],
      },
    });
    const baseline = JSON.stringify({
      faelle: [], snapshotsBeiAufnahme: 1, ausgeschlossen: [],
    });
    let logs = [];
    let errors = [];

    fsT.existsSync = () => true;
    fsT.readdirSync = () => ['AAA.json'];
    fsT.readFileSync = (file) => {
      const name = pathT.basename(String(file));
      if (name === 'AAA.json') return snapshot;
      if (name === 'annual-spikes-baseline.json') return baseline;
      throw new Error(`unexpected annual-spike read: ${file}`);
    };
    console.log = (...args) => { logs.push(args.join(' ')); };
    console.error = (...args) => { errors.push(args.join(' ')); };
    process.argv = originalArgv.filter((arg) => arg !== '--neu-aufnehmen');
    try {
      process.env.ANNUAL_SPIKE_MAX_NEU = '0';
      assert.equal(watcher.main(), 1, 'one new anomaly must exceed a zero threshold');
      assert.match(errors.join('\n'), /1 NEUE Jahres-Ausreisser \(erlaubt 0\)/,
        'the strict threshold must be visible in the production error');

      logs = [];
      errors = [];
      process.env.ANNUAL_SPIKE_MAX_NEU = '1';
      assert.equal(watcher.main(), 0, 'the same anomaly must fit a threshold of one');
      assert.equal(errors.length, 0, 'the relaxed control must remain healthy');
      assert.match(logs.join('\n'), /davon NEU: 1 \(erlaubt 1\)/,
        'the relaxed threshold must be visible in the production summary');

      logs = [];
      errors = [];
      process.env.ANNUAL_SPIKE_MAX_NEU = '2';
      assert.equal(watcher.main(), 0, 'a non-fixed-point threshold must remain healthy');
      assert.equal(errors.length, 0, 'the non-fixed-point control must remain healthy');
      assert.match(logs.join('\n'), /davon NEU: 1 \(erlaubt 2\)/,
        'main must use the parsed threshold unchanged, not transform it');

      logs = [];
      errors = [];
      delete process.env.ANNUAL_SPIKE_MAX_NEU;
      assert.equal(watcher.main(), 0, 'the default threshold must remain healthy');
      assert.equal(errors.length, 0, 'the default control must remain healthy');
      assert.match(logs.join('\n'), /davon NEU: 1 \(erlaubt 5\)/,
        'main must use the documented default unchanged');

      logs = [];
      errors = [];
      process.env.ANNUAL_SPIKE_MAX_NEU = '9007199254740991';
      assert.equal(watcher.main(), 0, 'the maximum safe threshold must remain healthy');
      assert.equal(errors.length, 0, 'the maximum-safe control must remain healthy');
      assert.match(logs.join('\n'), /davon NEU: 1 \(erlaubt 9007199254740991\)/,
        'main must neither truncate nor cap the validated safe-integer domain');
    } finally {
      fsT.existsSync = originalExistsSync;
      fsT.readdirSync = originalReaddirSync;
      fsT.readFileSync = originalReadFileSync;
      console.log = originalLog;
      console.error = originalError;
      process.argv = originalArgv;
      if (previous === undefined) delete process.env.ANNUAL_SPIKE_MAX_NEU;
      else process.env.ANNUAL_SPIKE_MAX_NEU = previous;
    }
    assert.equal(fsT.existsSync, originalExistsSync, 'existsSync stub must be restored');
    assert.equal(fsT.readdirSync, originalReaddirSync, 'readdirSync stub must be restored');
    assert.equal(fsT.readFileSync, originalReadFileSync, 'readFileSync stub must be restored');
    assert.equal(console.log, originalLog, 'console.log stub must be restored');
    assert.equal(console.error, originalError, 'console.error stub must be restored');
    assert.equal(process.argv, originalArgv, 'process.argv identity must be restored');
  });

  check('the real CLI reports malformed threshold configuration instead of scanning', () => {
    const { spawnSync } = require('node:child_process');
    const script = pathT.join(__dirname, '..', 'scripts', 'watch-annual-spikes.js');
    const run = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, ANNUAL_SPIKE_MAX_NEU: 'not-a-number' },
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /::error::watch-annual-spikes.*ANNUAL_SPIKE_MAX_NEU/s);
    assert.doesNotMatch(run.stderr, /snapshots\/ fehlt/,
      'configuration must fail before the snapshot-directory branch');
  });
}

console.log('\nannual-spikes: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
