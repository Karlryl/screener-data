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
    ausgeschlossen: [{ schluessel: 'BANPU.BK|annualOpInc|2023-12-31', sperrschluessel: 'BANPU.BK|annualOpInc|1', hinweis: 'NICHT ENTSCHEIDBAR (19.08.): Reihe widerspricht sich selbst und dem Emittenten; Verdacht eher auf Nachbarjahr 2022.', seit: '2026-08-29', offenSeit: '2026-08-19' }],
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
        /schriftlichen hinweis/, JSON.stringify(kaputt));
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
      ausgeschlossen: [{ schluessel: 'BANPU.BK|annualOpInc|2023-12-31', sperrschluessel: 'BANPU.BK|annualOpInc|1', hinweis: 'x', seit: '2026-08-29', offenSeit: '2026-08-29' }],
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
      { schluessel: 'BANPU.BK|annualOpInc|2023-12-31', sperrschluessel: 'BANPU.BK|annualOpInc|1', hinweis: 'x' },
      { schluessel: 'WEG.GE|annualRev|2019-12-31', sperrschluessel: 'WEG.GE|annualRev|1', hinweis: 'Tippfehler-Kandidat' },
    ];
    assert.deepEqual(sperrenOhneTreffer(sperren, funde), ['WEG.GE|annualRev|1']);
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
      assert.match(errors.join('\n'), /1 NEUE Jahres-Ausreisser-EREIGNISSE \(erlaubt 0\)/,
        'the strict threshold must be visible in the production error');

      logs = [];
      errors = [];
      process.env.ANNUAL_SPIKE_MAX_NEU = '1';
      assert.equal(watcher.main(), 0, 'the same anomaly must fit a threshold of one');
      assert.equal(errors.length, 0, 'the relaxed control must remain healthy');
      assert.match(logs.join('\n'), /zwei Relationen ohne Sperren 1 \(erlaubt 1\)/,
        'the relaxed threshold must be visible in the production summary');

      logs = [];
      errors = [];
      process.env.ANNUAL_SPIKE_MAX_NEU = '2';
      assert.equal(watcher.main(), 0, 'a non-fixed-point threshold must remain healthy');
      assert.equal(errors.length, 0, 'the non-fixed-point control must remain healthy');
      assert.match(logs.join('\n'), /zwei Relationen ohne Sperren 1 \(erlaubt 2\)/,
        'main must use the parsed threshold unchanged, not transform it');

      logs = [];
      errors = [];
      delete process.env.ANNUAL_SPIKE_MAX_NEU;
      assert.equal(watcher.main(), 0, 'the default threshold must remain healthy');
      assert.equal(errors.length, 0, 'the default control must remain healthy');
      assert.match(logs.join('\n'), /zwei Relationen ohne Sperren 1 \(erlaubt 5\)/,
        'main must use the documented default unchanged');

      logs = [];
      errors = [];
      process.env.ANNUAL_SPIKE_MAX_NEU = '9007199254740991';
      assert.equal(watcher.main(), 0, 'the maximum safe threshold must remain healthy');
      assert.equal(errors.length, 0, 'the maximum-safe control must remain healthy');
      assert.match(logs.join('\n'), /zwei Relationen ohne Sperren 1 \(erlaubt 9007199254740991\)/,
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

// ══ BRUCHPROBEN BP-1 .. BP-8 (Gerichtsbeschluss 02.09.2026, §6) ═══════════════════════
// Hausregel: ein Waechter pinnt die SACHE, nicht ein Textmuster. Jede Probe prueft
// Anwesenheit UND Abwesenheit, und jede war beim Bau einmal absichtlich rot.
{
  const w = require('../scripts/watch-annual-spikes.js');
  const { ereignisse, faecher, cignaFaelle, breitesterFaecherImBestand, sperrSchluessel,
    stabilerSchluessel, baueNeuenBestand, scanSnapshots: scan2 } = w;

  // Ein Fund, wie ihn scanSnapshots() baut.
  const fnd = (ticker, reihe, index, links, wert, rechts) => ({ ticker, reihe, index, links, wert, rechts });

  // ── Ein echter Lauf von main() gegen eine Fixture-Population ────────────────────────
  // Das Tor sitzt in main(); nur hier ist beweisbar, dass GEDRUCKT und GEZAEHLT
  // auseinanderfallen (JA-1). Die Mock-Technik ist dieselbe wie im H20-Block oben.
  function laufMain(snapshots, baseline, maxNeu, jetzt) {
    const originals = { e: fsT.existsSync, r: fsT.readdirSync, f: fsT.readFileSync,
      l: console.log, x: console.error, a: process.argv, v: process.env.ANNUAL_SPIKE_MAX_NEU };
    const logs = [], errors = [];
    fsT.existsSync = () => true;
    fsT.readdirSync = () => Object.keys(snapshots);
    fsT.readFileSync = (file) => {
      const name = pathT.basename(String(file));
      if (snapshots[name]) return JSON.stringify(snapshots[name]);
      if (name === 'annual-spikes-baseline.json') return JSON.stringify(baseline);
      throw new Error('unerwarteter Lesezugriff: ' + file);
    };
    console.log = (...a) => logs.push(a.join(' '));
    console.error = (...a) => errors.push(a.join(' '));
    process.argv = originals.a.filter((x) => x !== '--neu-aufnehmen');
    if (maxNeu === undefined) delete process.env.ANNUAL_SPIKE_MAX_NEU;
    else process.env.ANNUAL_SPIKE_MAX_NEU = String(maxNeu);
    try { return { code: jetzt ? w.main(jetzt) : w.main(), log: logs.join('\n'), err: errors.join('\n') }; }
    finally {
      fsT.existsSync = originals.e; fsT.readdirSync = originals.r; fsT.readFileSync = originals.f;
      console.log = originals.l; console.error = originals.x; process.argv = originals.a;
      if (originals.v === undefined) delete process.env.ANNUAL_SPIKE_MAX_NEU;
      else process.env.ANNUAL_SPIKE_MAX_NEU = originals.v;
    }
  }
  // Ein Snapshot mit genau einem Ausreisser in der genannten Reihe (Index 1).
  const snap = (ticker, reihe, mitte) => ({
    meta: { ticker }, annual: { [reihe]: [{ value: 100e6 }, { value: mitte }, { value: 110e6 }] },
  });

  // ══ JA-8 — DIE ZWILLINGS-PRAEMISSE, BEIDSEITIG FESTGENAGELT ════════════════════════
  // Relation 1 verschmilzt zwei Ticker GENAU DANN, wenn ihre Wert-Signatur byte-gleich
  // ist. Beide Seiten dieser Praemisse muessen stehen, sonst ist sie keine:
  //   (a) byte-gleich  => EIN Ereignis   (BP-1)
  //   (b) FX-proportional, aber ungleich => ZWEI Ereignisse   (BP-2)
  // Ohne (b) bleibt die am echten Bestand gemessene ~27-%-Fehlquote der Relation
  // unsichtbar (52 byte-gleiche Paare gegen 19 FX-proportionale, aber ungleiche) — und
  // der naechste Leser "repariert" sie mit einer Quantisierung, die zwei ECHTE,
  // verschiedene Ausreisser verschmilzt. Genau davor warnt die Vorlage in ihrem Punkt
  // d)-3. Ohne (a) faellt die Relation als Ganzes still aus.
  // Die beiden Proben tragen die am echten Baum gemessenen Realwerte; sie sind
  // ABSICHTLICH nicht dupliziert — die Bruchproben BP-1/BP-2 SIND dieser Block.
  //
  // ── BP-1 (JA-8a): byte-gleiche Signaturen auf zwei Tickern sind EIN Ereignis ────────
  // Realwerte: SESG.PA und SGBAF tragen denselben FX-Stempel 1,1527377 und exakt
  // dieselben drei Zahlen — am echten lokalen Baum gemessen, nicht erfunden.
  check('JA-8 (a) / BP-1: zwei byte-gleiche Signaturen auf zwei Tickern kollabieren zu EINEM Ereignis', () => {
    const f = [
      fnd('SESG.PA', 'annualNetIncome', 2, 17291065.5, -1043227618.5000001, -39193081.800000004),
      fnd('SGBAF', 'annualNetIncome', 2, 17291065.5, -1043227618.5000001, -39193081.800000004),
    ];
    const e = ereignisse(f);
    assert.equal(e.length, 1, 'Relation 1 muss byte-gleiche Signaturen verschmelzen');
    assert.equal(faecher(e[0]), 2, 'und das eine Ereignis spannt zwei Ticker');
  });

  // ── BP-2 (JA-8b): FX-proportional, aber ungleich — kollabiert NICHT ─────────────────
  // Realwerte VIV.PA gegen VIV.VI, dieselbe Firma, beide EUR, FX-Stempel 1,156203 gegen
  // 1,1669973. Ohne diese Probe bleibt die gemessene ~27-%-Fehlquote der Relation 1
  // unsichtbar, und jemand "repariert" sie spaeter mit einer Quantisierung, die zwei
  // echte, verschiedene Ausreisser verschmilzt.
  check('JA-8 (b) / BP-2: FX-proportionale, aber ungleiche Signaturen kollabieren NICHT', () => {
    const vivVI = fnd('VIV.VI', 'annualNetIncome', 1, 23339946, -7006651789.2, 472633906.5);
    const vivPA = fnd('VIV.PA', 'annualNetIncome', 1, 23124060, -6941842812.000001, 468262215.00000006);
    assert.equal(vivPA.links / vivVI.links, 0.9907503642039275,
      'die Fixture muss den ECHTEN gemessenen Faktor tragen, nicht einen gerundeten');
    const e = ereignisse([vivVI, vivPA]);
    assert.equal(e.length, 2, 'zwei verschiedene Signaturen sind zwei Ereignisse — keine Quantisierung');
    // Gegenrichtung im selben Test: byte-gleich verschmilzt sehr wohl.
    assert.equal(ereignisse([vivVI, { ...vivVI, ticker: '1VIV.MI' }]).length, 1);
  });

  // ── BP-3 (JA-2): ein Ticker, alle drei Jahresreihen am selben Index ─────────────────
  check('BP-3: alle drei Jahresreihen am selben Index sind IMMER rot — zwei reichen nicht', () => {
    const drei = ['annualOpInc', 'annualRev', 'annualNetIncome']
      .map((r, i) => fnd('CI', r, 2, 100e6 + i, -9000e6 - i, 110e6 + i));
    assert.deepEqual(cignaFaelle(drei), ['CI|2'], 'die Cigna-Form muss erkannt werden');
    assert.deepEqual(cignaFaelle(drei.slice(0, 2)), [],
      'Gegenprobe: zwei Reihen sind NICHT die Cigna-Form, sonst faengt das Tor den halben Bestand');
    // Und das ist der GRUND fuer das Hart-Tor: die Ereigniszaehlung zieht genau diese
    // drei Funde auf ein einziges Ereignis mit Faecher 1 zusammen. Beide anderen Tore
    // sehen dort nichts.
    assert.equal(ereignisse(drei).length, 1);
    assert.equal(faecher(ereignisse(drei)[0]), 1);
  });

  check('BP-3 (Ende zu Ende): die Cigna-Form ist rot, auch bei riesigem Budget', () => {
    const snaps = {
      'CI.json': { meta: { ticker: 'CI' }, annual: {
        annualOpInc: [{ value: 100e6 }, { value: -9000e6 }, { value: 110e6 }],
        annualRev: [{ value: 100e6 }, { value: -9100e6 }, { value: 110e6 }],
        annualNetIncome: [{ value: 100e6 }, { value: -9200e6 }, { value: 110e6 }],
      } },
    };
    const basis0 = { faelle: [], snapshotsBeiAufnahme: 1, ausgeschlossen: [] };
    const r = laufMain(snaps, basis0, 9007199254740991);
    assert.equal(r.code, 1, 'das Hart-Tor ist unabhaengig vom Budget');
    assert.match(r.err, /ALLEN 3 Jahresreihen am selben Index/);
    assert.match(r.err, /CI\|1/);
    // Abwesenheits-Richtung: nimmt man EINE Reihe weg, schweigt das HART-TOR JA-2.
    //
    // ANGEPASST 03.09.2026 (Rat Q1, Akte _COURT-NACHTLAUF-FRAGEN-2026-09-03.md §5).
    // Die Zusicherung stand als `r2.code === 0` — als STELLVERTRETER fuer "JA-2
    // schweigt". Der Stellvertreter traegt nicht mehr, seit ein zweites, ADDITIVES Tor
    // auf der 2-von-3-Form sitzt: diese Fixture ist selbst faktorgleich (OpInc -9000
    // gegen Rev -9100 bei Nachbarn 100/110 => Faktoren 81,8182 und 82,7273,
    // Verhaeltnis 1,011111 <= 1,02). Der Beschluss verlangt JA-2 unveraendert, nicht
    // die Fixture: die Fixture bleibt BYTE-GLEICH und wird jetzt an der SACHE gepinnt —
    // JA-2 schweigt, das neue Tor spricht. Die Gruen-Richtung steht unmittelbar
    // darunter mit einer nicht faktorgleichen Fixture; beide Richtungen von BP-3
    // bleiben damit erhalten.
    const zwei = { 'CI.json': { meta: { ticker: 'CI' }, annual: {
      annualOpInc: snaps['CI.json'].annual.annualOpInc, annualRev: snaps['CI.json'].annual.annualRev } } };
    const r2 = laufMain(zwei, basis0, 9007199254740991);
    assert.doesNotMatch(r2.err, /ALLEN 3 Jahresreihen am selben Index/,
      'zwei Reihen duerfen das Hart-Tor JA-2 NICHT ausloesen');
    assert.match(r2.err, /ZWEI Jahresreihen am selben Index/,
      'stattdessen spricht das additive Faktor-Gleichheits-Tor (Rat Q1)');

    // Gruen-Richtung, in der Sache unveraendert: zwei Reihen, die NICHT faktorgleich
    // sind (Faktoren 81,8182 gegen 10,9091), lassen denselben Lauf gruen.
    const zweiUngleich = { 'CI.json': { meta: { ticker: 'CI' }, annual: {
      annualOpInc: snaps['CI.json'].annual.annualOpInc,
      annualRev: [{ value: 100e6 }, { value: -1200e6 }, { value: 110e6 }] } } };
    assert.equal(laufMain(zweiUngleich, basis0, 9007199254740991).code, 0,
      'zwei nicht faktorgleiche Reihen lassen den Lauf gruen');
  });

  // ── BP-4 (JA-4): Faecher 8 feuert, der echte 7er-Intel-Faecher feuert nicht ─────────
  check('BP-4: Faecher 8 feuert, der legitime 7er-Intel-Faecher feuert nicht', () => {
    // MESSUNG, kein Glaube: der breiteste Faecher im echten committeten Bestand ist 7 —
    // die eine echte Intel-Abschreibung. Wird der Bestand je neu verankert, muss diese
    // Zahl neu gemessen werden (Kipp-Bedingung K3: Schwelle nachziehen, nicht abschalten).
    const echt = JSON.parse(fsT.readFileSync(
      pathT.join(__dirname, '..', 'data-health', 'annual-spikes-baseline.json'), 'utf8'));
    assert.equal(breitesterFaecherImBestand(echt.faelle), 7,
      'der breiteste bekannte Faecher ist der 7er-Intel-Fall — sonst ist die Eichung veraltet');

    const intel = ['1INTC.MI', '4335.HK', 'INL.DE', 'INTC', 'INTC.SW', 'INTC.VI', 'INTL.WA']
      .map((t) => fnd(t, 'annualNetIncome', 1, -267e6, -18756e6, 1689e6));
    const e7 = ereignisse(intel);
    assert.equal(e7.length, 1, 'der Intel-Fall ist EIN Ereignis');
    assert.equal(faecher(e7[0]), 7);
    assert.ok(!(faecher(e7[0]) > 7), 'Faecher 7 darf gegen den bekannten Faecher 7 NICHT feuern');

    const e8 = ereignisse([...intel, fnd('SENTINEL.XX', 'annualNetIncome', 1, -267e6, -18756e6, 1689e6)]);
    assert.equal(e8.length, 1);
    assert.equal(faecher(e8[0]), 8);
    assert.ok(faecher(e8[0]) > 7, 'Faecher 8 MUSS gegen den bekannten Faecher 7 feuern');
  });

  // ── BP-5 (JA-5): beide Datumsfelder sind Pflicht ────────────────────────────────────
  // Gemessen (Stimme 2, V7): ein Ausschluss OHNE seit wurde bis heute klaglos
  // angenommen, und offenSeit gab es gar nicht.
  check('BP-5: ein Ausschluss ohne offenSeit bzw. ohne seit laesst baueNeuenBestand werfen', () => {
    const gut = {
      schluessel: 'X|annualRev|werte:1|2|3', sperrschluessel: 'X|annualRev|1',
      seit: '2026-08-29', offenSeit: '2026-08-19', hinweis: 'begruendet',
    };
    const funde5 = [fnd('X', 'annualRev', 1, 1, 2, 3)];
    // Anwesenheits-Richtung zuerst: der vollstaendige Eintrag geht durch.
    assert.doesNotThrow(() => baueNeuenBestand({ hinweis: 'x', ausgeschlossen: [gut] }, funde5, 15045));
    for (const feld of ['seit', 'offenSeit', 'sperrschluessel']) {
      const kaputt = { ...gut }; delete kaputt[feld];
      assert.throws(() => baueNeuenBestand({ hinweis: 'x', ausgeschlossen: [kaputt] }, funde5, 15045),
        /Ausschluss-Liste kaputt/, 'fehlendes ' + feld + ' muss werfen');
    }
    for (const mist of ['29.08.2026', '2026-8-29', '', 'gestern', '2026-13-45']) {
      assert.throws(() => baueNeuenBestand({ hinweis: 'x', ausgeschlossen: [{ ...gut, offenSeit: mist }] }, funde5, 15045),
        /Ausschluss-Liste kaputt/, 'offenSeit=' + JSON.stringify(mist) + ' muss werfen');
    }
  });

  // ── BP-5b (JA-5): das ALTERS-TOR selbst ─────────────────────────────────
  // Das Tor war gebaut und hatte keinen Waechter: kein Test hat es je rot gefahren.
  // Seit JA-1 kosten Sperren keinen Budgetplatz mehr, also ist diese Uhr der GESAMTE
  // verbliebene Druck auf einen offenen Fall — ein ungetestetes Tor waere hier genau
  // die stille Erosion, gegen die dieser Beschluss ergangen ist.
  {
    // Fester Zeitpunkt statt Kalender-Zufall: sonst ist das Tor nur an genau einem Tag
    // pruefbar. Die Naht ist der jetzt-Parameter von main().
    const JETZT = new Date('2026-09-02T12:00:00Z');
    const snaps5b = { 'AAA.json': snap('AAA', 'annualRev', 900e6) };
    // Die Sperre TRIFFT den Fund (sonst faengt ihn der Tote-Sperre-Melder ab) und der
    // Fund steht NICHT im Bestand (sonst faengt ihn sperrenOhneWirkung ab). Damit ist
    // das Alters-Tor das EINZIGE, was diesen Lauf noch rot machen kann.
    const sperre5b = (offenSeit, seit) => ({
      schluessel: 'AAA|annualRev|werte:100000000|900000000|110000000',
      sperrschluessel: 'AAA|annualRev|1',
      seit: seit || '2026-08-02', offenSeit, hinweis: 'UNGEPRUEFT',
    });
    const lauf5b = (offenSeit, seit) => laufMain(snaps5b,
      { faelle: [], snapshotsBeiAufnahme: 1, ausgeschlossen: [sperre5b(offenSeit, seit)] }, 5, JETZT);

    check('BP-5b: exakt 30 Tage offen ist gruen, 31 Tage ist rot', () => {
      // Abwesenheits-Richtung, genau auf der Kante: auf der Schwelle feuert NICHTS.
      const gruen = lauf5b('2026-08-03');
      assert.equal(gruen.code, 0, '30 Tage liegen auf der Schwelle und duerfen nicht feuern');
      assert.match(gruen.log, /offen seit 30 Tag\(en\)/);
      assert.doesNotMatch(gruen.err, /laenger als 30 Tage/);

      // Anwesenheits-Richtung: einen Tag darueber MUSS der Lauf rot werden.
      const rot = lauf5b('2026-08-02');
      assert.equal(rot.code, 1, '31 Tage MUESSEN den Lauf rot machen');
      assert.match(rot.log, /offen seit 31 Tag\(en\)/);
      assert.match(rot.err, /::error::1 Ausschluss\/Ausschluesse laenger als 30 Tage offen/);
      assert.match(rot.err, /AAA\|annualRev\|1 \(31 Tage\)/);
    });

    check('BP-5b: eine Neu-Listung stellt die Altersuhr NICHT zurueck', () => {
      // Das ist der ganze Grund fuer offenSeit. seit wandert auf heute (wie bei jeder
      // Neu-Eintragung), offenSeit bleibt stehen -- die Uhr laeuft weiter.
      const r = lauf5b('2026-08-02', '2026-09-02');
      assert.equal(r.code, 1, 'ein frisches seit darf die Altersuhr nicht zuruecksetzen');
      assert.match(r.log, /offen seit 31 Tag\(en\)/);
      assert.match(r.err, /laenger als 30 Tage offen/);
      // Gegenprobe, dass die Uhr wirklich an offenSeit haengt und nicht an seit:
      // dasselbe frische seit, aber junges offenSeit => gruen.
      const r2 = lauf5b('2026-08-30', '2026-09-02');
      assert.equal(r2.code, 0);
      assert.match(r2.log, /offen seit 3 Tag\(en\)/);
    });
  }

  // ── BP-6 (JA-6 + JA-7): der gedriftete Schluessel wird NICHT absorbiert ─────────────
  check('BP-6: eine um 0,024 % gedriftete Signatur wird NICHT in faelle absorbiert', () => {
    const FX = 1.0002436793;  // der am echten Baum gemessene GCP.L-Driftfaktor
    const orig = fnd('BANPU.BK', 'annualOpInc', 2, -28259000, 6003496000, 524803000);
    const drift = fnd('BANPU.BK', 'annualOpInc', 2, orig.links * FX, orig.wert * FX, orig.rechts * FX);
    const sperre = {
      schluessel: stabilerSchluessel(orig), sperrschluessel: sperrSchluessel(orig),
      seit: '2026-08-29', offenSeit: '2026-08-19', hinweis: 'NICHT ENTSCHEIDBAR (19.08.)',
    };
    // Der ALTE Mechanismus haette hier verloren — das ist der gemessene Schaden, gegen
    // den JA-7 gebaut ist: die Wert-Signatur bewegt sich mit dem Wechselkurs.
    assert.notEqual(stabilerSchluessel(drift), sperre.schluessel,
      'die Wert-Signatur MUSS unter FX-Drift wandern, sonst prueft diese Probe nichts');
    // Der NEUE Mechanismus haelt: ticker|reihe|index bewegt sich nicht.
    assert.equal(sperrSchluessel(drift), sperre.sperrschluessel);
    const b = baueNeuenBestand({ hinweis: 'x', ausgeschlossen: [sperre] }, [drift], 15045);
    assert.deepEqual(b.faelle, [], 'der gedriftete Fall darf NICHT in den Bestand rutschen');
    assert.deepEqual(b.ausgeschlossen, [sperre], 'und die Sperre ueberlebt die Verankerung');
  });

  check('BP-6: eine tote Sperre wird im NORMALEN Tageslauf gemeldet, nicht erst beim Verankern', () => {
    const snaps = { 'AAA.json': snap('AAA', 'annualRev', 900e6) };
    const tot = {
      schluessel: 'WEG.GE|annualRev|werte:1|2|3', sperrschluessel: 'WEG.GE|annualRev|1',
      seit: '2026-08-29', offenSeit: '2026-08-29', hinweis: 'Tippfehler-Kandidat',
    };
    const r = laufMain(snaps, { faelle: [], snapshotsBeiAufnahme: 1, ausgeschlossen: [tot] }, 5);
    assert.match(r.log, /treffen HEUTE keinen Fund mehr/,
      'der Melder lief bisher NUR im --neu-aufnehmen-Zweig');
    assert.match(r.log, /WEG\.GE\|annualRev\|1/);
    // Abwesenheits-Richtung: eine TREFFENDE Sperre darf nicht als tot gemeldet werden.
    const treffend = { ...tot, sperrschluessel: 'AAA|annualRev|1' };
    const r2 = laufMain(snaps, { faelle: [], snapshotsBeiAufnahme: 1, ausgeschlossen: [treffend] }, 5);
    assert.doesNotMatch(r2.log, /treffen HEUTE keinen Fund mehr/);
  });

  // ── BP-6c (JA-6/JA-7): die WIRKUNGSLOSE Sperre — trifft, unterdrueckt aber nichts ──
  // Die zweite Art toter Sperre, die JA-7 erst moeglich macht: seit auf ticker|reihe|index
  // gematcht wird, kann ein Schluessel einen Fund treffen, der laengst in `faelle` steht.
  // Dann gewinnt istBekannt() still, die Sperre sieht intakt aus und wirkt nicht mehr —
  // und basisGueltig() sieht es nicht, weil dort Wert-Signaturen verglichen werden.
  // Das ist ein HARTES Tor (datenExit = 1) und hatte als einziges keine Bruchprobe.
  check('BP-6c: eine treffende, aber wirkungslose Sperre wird rot gemeldet', () => {
    const { sperrenOhneWirkung } = w;
    const fund = fnd('AAA', 'annualRev', 1, 100e6, 900e6, 110e6);
    const sperre = {
      schluessel: stabilerSchluessel(fund), sperrschluessel: 'AAA|annualRev|1',
      seit: '2026-08-29', offenSeit: '2026-08-29', hinweis: 'UNGEPRUEFT',
    };
    // Anwesenheit: der getroffene Fund steht bereits im Bestand => die Sperre ist wirkungslos.
    assert.deepEqual(
      sperrenOhneWirkung([sperre], [fund], new Set([stabilerSchluessel(fund)])),
      ['AAA|annualRev|1']);
    // Abwesenheit, beide Richtungen einzeln: Fund NICHT im Bestand => die Sperre wirkt.
    assert.deepEqual(sperrenOhneWirkung([sperre], [fund], new Set()), []);
    // und: Bestand enthaelt den Fund, aber es gibt gar keine Sperre darauf.
    assert.deepEqual(
      sperrenOhneWirkung([{ ...sperre, sperrschluessel: 'ZZZ|annualRev|9' }], [fund],
        new Set([stabilerSchluessel(fund)])), []);
  });

  check('BP-6c (Ende zu Ende): die wirkungslose Sperre macht den Tageslauf ROT', () => {
    const snaps = { 'AAA.json': snap('AAA', 'annualRev', 900e6) };
    // WICHTIG: der schluessel ist hier die ALTE, weggedriftete Wert-Signatur (899 statt
    // 900). Genau deshalb sieht basisGueltig() KEINEN Widerspruch — jener Waechter
    // vergleicht Wert-Signaturen, und die stimmt nicht mehr ueberein. Der sperrschluessel
    // trifft trotzdem. Das ist die Luecke, die JA-7 erst aufmacht, und der einzige Grund,
    // warum sperrenOhneWirkung() existiert.
    const sperre = {
      schluessel: 'AAA|annualRev|werte:100000000|899000000|110000000',
      sperrschluessel: 'AAA|annualRev|1',
      seit: '2026-08-29', offenSeit: '2026-08-29', hinweis: 'UNGEPRUEFT',
    };
    // Der Fund steht im Bestand UND ist gesperrt: istBekannt() gewinnt still.
    const r = laufMain(snaps, {
      faelle: ['AAA|annualRev|werte:100000000|900000000|110000000'],
      snapshotsBeiAufnahme: 1, ausgeschlossen: [sperre],
    }, 5);
    assert.equal(r.code, 1, 'eine Sperre, die nichts mehr unterdrueckt, MUSS rot sein');
    assert.match(r.err, /treffen einen Fund, der bereits im Bestand steht/);
    assert.match(r.err, /AAA\|annualRev\|1/);
    // Gegenprobe: derselbe Lauf mit LEEREM Bestand ist gruen — dann wirkt die Sperre.
    const r2 = laufMain(snaps, { faelle: [], snapshotsBeiAufnahme: 1, ausgeschlossen: [sperre] }, 5);
    assert.equal(r2.code, 0, 'eine wirksame Sperre darf NICHT rot machen');
    assert.doesNotMatch(r2.err, /bereits im Bestand/);
  });

  // ── BP-7 (JA-1): Ausschluesse verlassen das GEZAEHLTE Set, nie das GEDRUCKTE ────────
  // Diese Probe ist der Waechter ueber der eigentlichen Erosionsgefahr. Zieht jemand den
  // Sperr-Filter vor die Druckschleife in main(), verschwindet die gesperrte Zeile aus
  // dem Log und diese Probe faellt.
  check('BP-7: eine gesperrte Zeile steht im GEDRUCKTEN Set und fehlt im GEZAEHLTEN', () => {
    const snaps = {
      'AAA.json': snap('AAA', 'annualRev', 900e6),
      'BANPU.BK.json': snap('BANPU.BK', 'annualOpInc', -900e6),
    };
    const sperre = {
      schluessel: 'BANPU.BK|annualOpInc|werte:100000000|-900000000|110000000',
      sperrschluessel: 'BANPU.BK|annualOpInc|1',
      seit: '2026-08-29', offenSeit: '2026-08-19', hinweis: 'NICHT ENTSCHEIDBAR (19.08.)',
    };
    const r = laufMain(snaps, { faelle: [], snapshotsBeiAufnahme: 2, ausgeschlossen: [sperre] }, 1);
    // GEDRUCKT: beide Funde, der gesperrte ausdruecklich mit.
    assert.match(r.log, /davon NEU: 2/, 'der gedruckte Zaehler nennt BEIDE Funde');
    assert.match(r.log, /NEU {2}BANPU\.BK · annualOpInc\[1\]/,
      'DIE EROSIONSPROBE: die gesperrte Zeile MUSS im Log stehen');
    assert.match(r.log, /NEU {2}AAA · annualRev\[1\]/);
    // GEZAEHLT: nur der ungesperrte. Und die Sperre steht mit ihrem Alter da.
    assert.match(r.log, /zwei Relationen ohne Sperren 1 \(erlaubt 1\)/);
    assert.match(r.log, /SPERRE BANPU\.BK\|annualOpInc\|1 · offen seit \d+ Tag\(en\)/);
    assert.equal(r.code, 0, 'zwei Funde, aber ein gezaehltes Ereignis — das Budget von 1 haelt');
    // Gegenrichtung: ohne die Sperre zaehlen beide und dasselbe Budget reisst.
    const r2 = laufMain(snaps, { faelle: [], snapshotsBeiAufnahme: 2, ausgeschlossen: [] }, 1);
    assert.equal(r2.code, 1, 'ohne Sperre muessen zwei Ereignisse das Budget von 1 sprengen');
    assert.match(r2.err, /2 NEUE Jahres-Ausreisser-EREIGNISSE \(erlaubt 1\)/);
  });

  // ── BP-8 (JA-3): ungleich lange Jahresreihen => Relation 2 verschmilzt NICHT ────────
  check('BP-8: bei ungleich langen Jahresreihen verschmilzt Relation 2 nicht', () => {
    const zwei = [
      fnd('U', 'annualOpInc', 1, 100e6, -900e6, 110e6),
      fnd('U', 'annualNetIncome', 1, 100e6, -950e6, 110e6),
    ];
    // Anwesenheits-Richtung: gleich lange Reihen verschmelzen (das ist Relation 2).
    assert.equal(ereignisse(zwei, () => true).length, 1);
    // Abwesenheits-Richtung: bei ungleich langen Reihen zeigt derselbe Index NICHT auf
    // dasselbe Geschaeftsjahr — dann sind es zwei Ereignisse.
    assert.equal(ereignisse(zwei, () => false).length, 2);
  });

  check('BP-8: scanSnapshots MISST die Praemisse, statt sie zu glauben', () => {
    const dir = fsT.mkdtempSync(pathT.join(osT.tmpdir(), 'annual-spikes-ja3-'));
    try {
      fsT.writeFileSync(pathT.join(dir, 'GLEICH.json'), JSON.stringify({ meta: { ticker: 'GLEICH' }, annual: {
        annualOpInc: [{ value: 1 }, { value: 2 }, { value: 3 }],
        annualNetIncome: [{ value: 1 }, { value: 2 }, { value: 3 }],
      } }));
      fsT.writeFileSync(pathT.join(dir, 'UNGLEICH.json'), JSON.stringify({ meta: { ticker: 'UNGLEICH' }, annual: {
        annualOpInc: [{ value: 1 }, { value: 2 }, { value: 3 }],
        annualNetIncome: [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }],
      } }));
      // Eine FEHLENDE Reihe ist keine Verletzung — nur zwei VORHANDENE ungleicher Laenge.
      fsT.writeFileSync(pathT.join(dir, 'FEHLT.json'), JSON.stringify({ meta: { ticker: 'FEHLT' }, annual: {
        annualOpInc: [{ value: 1 }, { value: 2 }, { value: 3 }],
      } }));
      const r = scan2(dir);
      assert.ok(r.reihenUngleich.has('UNGLEICH'), 'die Verletzung MUSS gemessen werden');
      assert.ok(!r.reihenUngleich.has('GLEICH'), 'ein Zaehler, der immer feuert, waere wertlos');
      assert.ok(!r.reihenUngleich.has('FEHLT'), 'eine fehlende Reihe ist keine Praemissenverletzung');
    } finally { fsT.rmSync(dir, { recursive: true, force: true }); }
  });

  // ══ JA-9 — GROESSE UND ALTERSVERTEILUNG DER AUSSCHLUSS-LISTE, IN JEDEM LAUF ═════════
  // Der Befund hinter der Auflage: 500 fabrizierte Ausschluesse passieren
  // baueNeuenBestand() und basisGueltig() unbeanstandet. Bis JA-1 war die Liste nur
  // deshalb selbstbegrenzend, weil JEDER Eintrag einen Budgetplatz kostete — genau diese
  // Kosten hat JA-1 abgeschafft. Uebrig bleibt als Bremse allein die SICHTBARKEIT, und
  // eine Bremse ohne Waechter ist keine.
  {
    const { ausschlussTelemetrie, AUSSCHLUSS_REFERENZ } = w;
    const JETZT9 = new Date('2026-09-02T12:00:00Z');
    const sperre9 = (ticker, offenSeit) => ({
      schluessel: `${ticker}|annualRev|werte:100000000|900000000|110000000`,
      sperrschluessel: `${ticker}|annualRev|1`,
      seit: '2026-08-29', offenSeit, hinweis: 'UNGEPRUEFT',
    });
    const liste9 = (n, offenSeit) => Array.from({ length: n }, (_, i) => sperre9('T' + i, offenSeit || '2026-08-31'));

    check('JA-9: die Altersverteilung ist min/median/max ueber offenSeit', () => {
      // Ungerade Anzahl: der Median ist der mittlere Wert.
      const drei = ausschlussTelemetrie(
        [sperre9('A', '2026-09-01'), sperre9('B', '2026-08-23'), sperre9('C', '2026-08-31')], JETZT9);
      assert.deepEqual([drei.min, drei.median, drei.max], [1, 2, 10], 'min/median/max ueber [1,2,10]');
      // Gerade Anzahl: Mittel der beiden mittleren — sonst kippt der Median still auf
      // einen der Nachbarn und die Zeile behauptet mehr Genauigkeit, als sie hat.
      const vier = ausschlussTelemetrie([...[sperre9('A', '2026-09-01'), sperre9('B', '2026-08-23'),
        sperre9('C', '2026-08-31'), sperre9('D', '2026-08-29')]], JETZT9);
      assert.deepEqual([vier.min, vier.median, vier.max], [1, 3, 10], 'min/median/max ueber [1,2,4,10]');
      // Leere Liste: keine Verteilung — aber auch kein Absturz und keine erfundene 0.
      const leer = ausschlussTelemetrie([], JETZT9);
      assert.deepEqual([leer.anzahl, leer.min, leer.median, leer.max], [0, null, null, null]);
      // Die Uhr haengt an offenSeit, nicht an seit — dieselbe Naht wie beim Alters-Tor
      // (JA-5). Gleiches seit, verschiedenes offenSeit muss verschiedene Zahlen geben.
      const a = ausschlussTelemetrie([sperre9('A', '2026-08-23')], JETZT9);
      const b = ausschlussTelemetrie([sperre9('A', '2026-09-01')], JETZT9);
      assert.notDeepEqual([a.min, a.max], [b.min, b.max], 'seit ist bei beiden 2026-08-29');
    });

    check('JA-9: Wachstum ueber die Referenz meldet, Nicht-Wachstum schweigt', () => {
      assert.equal(ausschlussTelemetrie(liste9(AUSSCHLUSS_REFERENZ), JETZT9).gewachsen, false,
        'AUF der Referenz darf nichts feuern — sonst ist der Melder ab Tag eins Rauschen');
      assert.equal(ausschlussTelemetrie(liste9(AUSSCHLUSS_REFERENZ + 1), JETZT9).gewachsen, true,
        'eine Sperre MEHR als die Referenz muss gemeldet werden');
      assert.equal(ausschlussTelemetrie(liste9(AUSSCHLUSS_REFERENZ - 1), JETZT9).gewachsen, false);
    });

    check('JA-9 (Ende zu Ende): der Tageslauf druckt Groesse und Verteilung und warnt bei Wachstum', () => {
      const snaps9 = { 'AAA.json': snap('AAA', 'annualRev', 900e6) };
      const mitListe = (n) => laufMain(snaps9,
        { faelle: [], snapshotsBeiAufnahme: 1, ausgeschlossen: liste9(n) }, 5, JETZT9);
      // Abwesenheits-Richtung: auf der Referenzgroesse steht die Zeile da, die Warnung nicht.
      const ruhig = mitListe(AUSSCHLUSS_REFERENZ);
      assert.match(ruhig.log, /Ausschluss-Liste: 4 Sperre\(n\)/, 'die GROESSE steht in jedem Lauf');
      assert.match(ruhig.log, /Ausschluss-Alter \(Tage\): min 2 · median 2 · max 2/,
        'die VERTEILUNG steht in jedem Lauf, nicht nur beim Ausloesen');
      assert.doesNotMatch(ruhig.log, /::warning::Die Ausschluss-Liste ist auf/,
        'ohne Wachstum darf keine Warnung stehen');
      // Anwesenheits-Richtung: eine Sperre mehr => ::warning::.
      const laut = mitListe(AUSSCHLUSS_REFERENZ + 1);
      assert.match(laut.log, /::warning::Die Ausschluss-Liste ist auf 5 Sperren gewachsen \(Referenz 4\)/);
      // Und bewusst KEIN Rot: JA-1 hat die Sperren aus dem Budget genommen, rot wird
      // eine Sperre erst ueber das Alters-Tor (JA-5). Ein zweites Rot waere Doppelzaehlung.
      assert.equal(laut.code, 0, 'JA-9 warnt — es macht den Lauf nicht rot');
    });

    check('JA-9: der Job schreibt dabei nichts (JA-12)', () => {
      // Die Telemetrie darf keinen Schreibpfad brauchen. Die Referenz steht committet im
      // Skript, nicht in einem mitgefuehrten Zustand zwischen zwei Laeufen.
      const schreib = [];
      const origW = fsT.writeFileSync, origA = fsT.appendFileSync;
      fsT.writeFileSync = (f) => { schreib.push(String(f)); };
      fsT.appendFileSync = (f) => { schreib.push(String(f)); };
      try {
        laufMain({ 'AAA.json': snap('AAA', 'annualRev', 900e6) },
          { faelle: [], snapshotsBeiAufnahme: 1, ausgeschlossen: liste9(9) }, 5, JETZT9);
      } finally { fsT.writeFileSync = origW; fsT.appendFileSync = origA; }
      assert.deepEqual(schreib, [], 'der Tageslauf darf keine Datei anfassen');
    });
  }

  // == Q1 (Ratsbeschluss 03.09.2026) — FAKTOR-GLEICHHEITS-TOR AUF DIE 2-VON-3-FORM ====
  // Akte: agent-reports/_COURT-NACHTLAUF-FRAGEN-2026-09-03.md §5 Q1 (2:0 mit Auflagen).
  // Jede Probe hier war beim Bau einmal absichtlich rot und prueft beide Richtungen.
  {
    const { faktorGleicheFaelle, ausreisserFaktor, FAKTOR_GLEICH_TOL, parseMaxNeu } = w;

    // -- Q1-1: DAS ETIKETT AN DER SACHE ---------------------------------------------
    // Realwerte 001450.KS|1, am echten Baum gemessen (nicht gerundet, nicht erfunden):
    // Umsatz 279,6 Mio -> 9.934,7 Mio -> 371,7 Mio und Betriebsergebnis 4,09 -> 145,1
    // -> 5,43 Mio, beide Faktor 26,728480093892 — waehrend das Nettoergebnis ruhig
    // bleibt. Ein Umsatzsprung um Faktor 27 bei unveraendertem Nettoergebnis ist
    // betriebswirtschaftlich unmoeglich.
    const ks = [
      fnd('001450.KS', 'annualOpInc', 1, 4085611.0168801122, 145145887.4848816, 5430383.133459464),
      fnd('001450.KS', 'annualRev', 1, 279644833.46202, 9934694557.486763, 371689468.409272),
    ];
    const verh = (f) => {
      const [a, b] = f.map(ausreisserFaktor);
      return Math.max(a, b) / Math.min(a, b);
    };
    check('Q1-1: das Tor misst MARGEN-STABILITAET, nicht gemeinsame Ursache — x10 auf beide Werte laesst das Verhaeltnis unveraendert', () => {
      assert.deepEqual(faktorGleicheFaelle(ks).gleich, ['001450.KS|1'], 'der Realfall muss feuern');
      // DIE PROBE: beide korrumpierten Werte mit demselben k — k kuerzt sich vollstaendig
      // weg. Das Tor ist BLIND gegen die Korruptionsstaerke; wer "Fingerabdruck
      // gemeinsamer Ursache" hineinliest, liest die Zusicherung zu breit.
      const malZehn = ks.map((x) => ({ ...x, wert: x.wert * 10 }));
      assert.equal(verh(malZehn), verh(ks), 'x10 auf beide Ausreisserwerte darf das Verhaeltnis nicht bewegen');
      assert.deepEqual(faktorGleicheFaelle(malZehn).gleich, ['001450.KS|1'], 'und das Tor feuert weiter');
      assert.ok(ausreisserFaktor(malZehn[0]) > ausreisserFaktor(ks[0]) * 9.9,
        'Gegenprobe: die FAKTOREN selbst sind sehr wohl zehnmal so gross — nur ihr Verhaeltnis nicht');
      // Zweite Richtung, ebenfalls von Stimme 2 gemessen: bewegt man die MARGE des
      // unkorrumpierten Nachbarjahres, wandert das Verhaeltnis und das Tor verstummt.
      const margeBewegt = [ks[0], { ...ks[1], links: ks[1].links * 1.37 }];
      assert.ok(verh(margeBewegt) > FAKTOR_GLEICH_TOL, 'eine bewegte Nachbar-Marge muss das Verhaeltnis heben');
      assert.deepEqual(faktorGleicheFaelle(margeBewegt).gleich, [], 'und derselbe Bruch laeuft durch');
    });

    // -- Q1-3: NAMENTLICHE PIN-LISTE AM COMMITTETEN BESTAND --------------------------
    // Fixture-Quelle ist der committete Bestand (wie bei BP-4), damit die Probe ohne
    // snapshots/ im CI laeuft. Seine Schluessel tragen die ROHWERTE
    // (`ticker|reihe|werte:links|wert|rechts`), aber KEINEN Index — die Gruppierung
    // laeuft deshalb ueber den Ticker, was hier deckungsgleich ist: kein Ticker im
    // Bestand traegt Ausreisser an zwei verschiedenen Indizes.
    //
    // MESSUNG (echter Baum, 15.044 Snapshots / 141 Funde) gegen die Bestands-Fixture,
    // ehrlich ausgewiesen:
    //   echter Baum       22 Formen -> 8 feuern / 14 nicht
    //   Bestands-Fixture  23 Formen -> 8 feuern / 15 nicht
    // Die Differenz ist restlos aufgeklaert und beruehrt die Klassentrennung nicht:
    // CMHC.SW und COPN.VI stehen als Zweitnotierungen von CMOPF im Bestand, im lokalen
    // Baum aber nicht (alle drei bei 3,7235, also ohnehin in der NICHT feuernden
    // Klasse); umgekehrt traegt der Baum die eine bestandsfremde Form 300715.SZ|1 bei
    // 1,6300 — ebenfalls nicht feuernd. 23 - 2 + 1 = 22, und die FEUERNDE Klasse ist
    // auf beiden Ebenen dieselben acht.
    const bestandFormen = () => {
      const echt = JSON.parse(fsT.readFileSync(
        pathT.join(__dirname, '..', 'data-health', 'annual-spikes-baseline.json'), 'utf8'));
      // Alle Ausreisser eines Tickers auf denselben Index legen — der Bestands-
      // Schluessel traegt keinen, und die Gruppierung ist genau "ein Ticker, ein Jahr".
      return echt.faelle.map((k) => {
        const teile = k.split('|');
        return fnd(teile[0], teile[1], 1, Number(teile[2].slice('werte:'.length)),
          Number(teile[3]), Number(teile[4]));
      });
    };
    const ohneIndex = (l) => l.map((k) => k.replace(/\|1$/, '')).sort();

    const FEUERN_8 = ['001450.KS', '8795.T', 'KINV-A.ST', 'KINV-B.ST', 'KYN',
      'MFSL.BO', 'MFSL.NS', 'TDHOF'];
    const STILL_15 = ['002446.SZ', '002759.SZ', '600166.SS', '600975.SS', '601068.SS',
      '601606.SS', '601718.SS', 'CMHC.SW', 'CMOPF', 'COPN.VI', 'DIGIS.MC', 'NEOG',
      'VOGL.BO', 'VOGL.NS', 'VPLAY-A.ST'];
    const ZUSATZ_BEI_125 = ['002446.SZ', '600166.SS', '600975.SS', '601718.SS'];

    check('Q1-3: die acht OpInc+Rev-Formen des Bestands feuern NAMENTLICH, keine der 15 anderen', () => {
      const r = faktorGleicheFaelle(bestandFormen());
      assert.equal(r.zweiVonDrei.length, 23,
        'die Fixture traegt 23 2-von-3-Formen — sonst ist die Eichung veraltet');
      assert.deepEqual(ohneIndex(r.gleich), [...FEUERN_8].sort(), 'exakt diese acht Formen feuern');
      // Abwesenheits-Richtung NAMENTLICH, nicht nur als Zahl.
      const feuernd = new Set(ohneIndex(r.gleich));
      for (const t of STILL_15) {
        assert.ok(!feuernd.has(t), t + ' ist ein echtes Abschreibungsjahr und darf NICHT feuern');
      }
      assert.deepEqual(ohneIndex(r.zweiVonDrei), [...FEUERN_8, ...STILL_15].sort(),
        'die Pin-Liste muss die Fixture vollstaendig und namentlich abdecken');
    });

    check('Q1-3: bei Toleranz 1,25 kommen GENAU die vier gemessenen Klasse-B-Formen dazu', () => {
      // Der Preis, den der Beschluss ausdruecklich NICHT zahlen wollte: 1,25 laege
      // mitten in Klasse B (1,0375 - 6,4162) und schluckte vier Formen, die als echte
      // Abschreibungsjahre eingestuft sind.
      const r125 = faktorGleicheFaelle(bestandFormen(), 1.25);
      assert.deepEqual(ohneIndex(r125.gleich), [...FEUERN_8, ...ZUSATZ_BEI_125].sort(),
        'bei 1,25 feuern die acht plus genau 002446.SZ, 601718.SS, 600975.SS, 600166.SS');
      // Und die Herleitung selbst: das Intervall 1,0000|1,0375 MUSS leer sein. An genau
      // dieser Zeile haengt die Kipp-Bedingung Q1-5 (neu herleiten, nicht nachziehen).
      const jeTicker = new Map(), verhaeltnisse = [];
      for (const x of bestandFormen()) jeTicker.set(x.ticker, [...(jeTicker.get(x.ticker) || []), x]);
      for (const [, a] of jeTicker) {
        const u = [...new Map(a.map((x) => [x.reihe, x])).values()];
        if (u.length !== 2) continue;
        verhaeltnisse.push(verh(u));
      }
      assert.equal(verhaeltnisse.filter((v) => v > 1.0000000001 && v < 1.0375).length, 0,
        'das Intervall 1,0000|1,0375 MUSS leer sein — sonst ist 1,02 NEU herzuleiten');
      assert.ok(FAKTOR_GLEICH_TOL > 1 && FAKTOR_GLEICH_TOL < 1.0375, 'und 1,02 liegt darin');
    });

    // -- Q1-2 (blockierende Auflage): DIE ZAEHLERZEILE -------------------------------
    // Ein Tor, das nur beim Feuern spricht, verschweigt seine eigene Deckungsluecke.
    const snapsZ = {
      'GLEICH2.json': { meta: { ticker: 'GLEICH2' }, annual: {
        annualOpInc: [{ value: 100e6 }, { value: -9000e6 }, { value: 110e6 }],
        annualRev: [{ value: 200e6 }, { value: -18000e6 }, { value: 220e6 }],
      } },
      'UNGLEICH2.json': { meta: { ticker: 'UNGLEICH2' }, annual: {
        annualOpInc: [{ value: 300e6 }, { value: -30000e6 }, { value: 330e6 }],
        annualNetIncome: [{ value: 400e6 }, { value: -8000e6 }, { value: 440e6 }],
      } },
    };
    check('Q1-2: die Zaehlerzeile nennt in JEDEM Lauf beide Seiten — erfasst UND nicht erfasst', () => {
      // snapshotsBeiAufnahme MUSS zur Fixture-Population passen, sonst schlaegt die
      // Populations-Wache VOR den Toren zu und die Probe bestuende vakuum.
      const basisZ = (n) => ({ faelle: [], snapshotsBeiAufnahme: n, ausgeschlossen: [] });
      const r = laufMain(snapsZ, basisZ(2), 9007199254740991);
      assert.match(r.log, /^2-von-3: 2 · faktorgleich \(Tol 1,02\): 1 · NICHT erfasst: 1$/m,
        'die Zeile muss den nicht erfassten Rest ausweisen');
      assert.equal(r.code, 1, 'und die faktorgleiche Form ist rot');
      assert.match(r.err, /GLEICH2\|1/);
      assert.doesNotMatch(r.err, /UNGLEICH2/,
        'die nicht faktorgleiche Form bleibt ungefangen — genau das zaehlt die Zeile mit');

      // ANWESENHEIT AUCH BEI NULL: ohne diese Richtung waere "kein Rest" von "keine
      // Zeile" nicht zu unterscheiden.
      const leer = laufMain({ 'AAA.json': snap('AAA', 'annualRev', 900e6) }, basisZ(1), 5);
      assert.match(leer.log, /^2-von-3: 0 · faktorgleich \(Tol 1,02\): 0 · NICHT erfasst: 0$/m);
      assert.equal(leer.code, 0);
    });

    check('Q1-2 Bruchprobe: mit Toleranz 10 faellt der NICHT erfasste Rest auf 0', () => {
      const funde = [
        fnd('GLEICH2', 'annualOpInc', 1, 100e6, -9000e6, 110e6),
        fnd('GLEICH2', 'annualRev', 1, 200e6, -18000e6, 220e6),
        fnd('UNGLEICH2', 'annualOpInc', 1, 300e6, -30000e6, 330e6),
        fnd('UNGLEICH2', 'annualNetIncome', 1, 400e6, -8000e6, 440e6),
      ];
      const eng = faktorGleicheFaelle(funde);
      assert.equal(eng.zweiVonDrei.length - eng.gleich.length, 1, 'bei 1,02 bleibt genau eine Form liegen');
      const weit = faktorGleicheFaelle(funde, 10);
      assert.equal(weit.zweiVonDrei.length, 2, 'die Grundmenge haengt NICHT an der Toleranz');
      assert.equal(weit.zweiVonDrei.length - weit.gleich.length, 0, 'bei Toleranz 10 bleibt nichts liegen');
    });

    // -- Q1-4: WAS DAS TOR NICHT ANFASSEN DARF ---------------------------------------
    check('Q1-4: JA-2 bleibt bei DREI Reihen, die Schwelle bei 5, und ein feuernder Lauf schreibt nichts (JA-12)', () => {
      const drei4 = ['annualOpInc', 'annualRev', 'annualNetIncome']
        .map((r, i) => fnd('CI', r, 2, 100e6 + i, -9000e6 - i, 110e6 + i));
      assert.deepEqual(cignaFaelle(drei4), ['CI|2']);
      assert.deepEqual(cignaFaelle(drei4.slice(0, 2)), []);
      // Und das neue Tor greift NICHT in die Cigna-Form hinein: drei Reihen gehoeren
      // JA-2, sonst zaehlte derselbe Fall doppelt.
      assert.deepEqual(faktorGleicheFaelle(drei4).zweiVonDrei, []);
      assert.equal(parseMaxNeu(undefined), 5, 'DEFAULT_MAX_NEU bleibt 5');
      // JA-12 auf dem NEUEN Pfad: auch ein Lauf, in dem das neue Tor FEUERT, fasst
      // keine Datei an. Der bestehende JA-12-Test sitzt auf einem Lauf ohne 2-von-3-Form.
      const schreib = [];
      const origW = fsT.writeFileSync, origA = fsT.appendFileSync;
      fsT.writeFileSync = (f) => { schreib.push(String(f)); };
      fsT.appendFileSync = (f) => { schreib.push(String(f)); };
      let code;
      try {
        code = laufMain(snapsZ, { faelle: [], snapshotsBeiAufnahme: 2, ausgeschlossen: [] },
          9007199254740991).code;
      } finally { fsT.writeFileSync = origW; fsT.appendFileSync = origA; }
      assert.equal(code, 1, 'die Probe muss auf einem FEUERNDEN Lauf sitzen, sonst prueft sie nichts');
      assert.deepEqual(schreib, [], 'der Tageslauf darf keine Datei anfassen');
    });
  }
}

console.log('\nannual-spikes: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
