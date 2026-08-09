'use strict';
/**
 * P1-Welle 6 — stille Ausfaelle der Earnings-/Vollabruf-Kette werden sichtbar.
 * Rot-zuerst gegen f23a72fd: die exportierten Waechter fehlten bzw. korrupte Kalender,
 * unlesbare Zeitanker, alte Carries und leere FTS-Antworten galten als gesund.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const earnings = require('../pull-earnings-dates.js');
const yahoo = require('../pull-yahoo.js');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e)); }
}

(async () => {
  await test('Befund 1: korrupter Kalender ist fatal, ENOENT bleibt Erstlauf', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p1w6-'));
    try {
      const corrupt = path.join(tmp, 'calendar.json');
      fs.writeFileSync(corrupt, '{kaputt');
      assert.throws(() => earnings.loadPreviousCalendar(corrupt), /unlesbar/);
      assert.deepEqual(earnings.loadPreviousCalendar(path.join(tmp, 'fehlt.json')), {});
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await test('Befund 3: erster parsbarer Anker gewinnt; beide kaputt sind faellig', () => {
    const now = new Date('2026-08-10T00:00:00Z').getTime();
    assert.equal(yahoo.fundamentalsStaleness({ fundamentalsAsOf: 'kaputt', fetchedAt: '2026-08-09' }, now).stale, false);
    assert.deepEqual(yahoo.fundamentalsStaleness({ fundamentalsAsOf: 'kaputt', fetchedAt: 'auch-kaputt' }, now), { stale: true, unparseable: true });
  });

  await test('Befund 4: >30 Tage alter Carry zaehlt nicht als frisch', () => {
    const entry = earnings.resolveEntry({ date: '2026-06-01', pulledAt: '2026-06-01' }, null, '2026-08-10', 3);
    assert.equal(earnings.isFreshEntry(entry, '2026-08-10'), false);
    assert.equal(entry.date, '2026-06-01');
  });

  await test('Befund 5: Antwort ohne Datum nimmt denselben Carry-Pfad', () => {
    const prior = { date: '2026-09-01', pulledAt: '2026-08-01' };
    assert.deepEqual(earnings.carryEntryWithoutDate(prior, '2026-08-10', 3), prior);
  });

  await test('Befund 6: FTS-Teilausfall und komplett leere Serien sind messbar', () => {
    assert.deepEqual(yahoo.ftsFailureSummary({ annualFin: [], quarterlyFin: [], annualCash: [], annualBs: [], _failedSeries: 4 }), { failedSeries: 4, allEmpty: true });
    assert.deepEqual(yahoo.ftsFailureSummary({ annualFin: [{}], quarterlyFin: [], annualCash: [], annualBs: [], _failedSeries: 3 }), { failedSeries: 3, allEmpty: false });
  });

  // Nachzug Tag 622 (Review-Fund HOCH): der Tag-621-Fix loeschte bei vier leeren
  // FTS-Serien nur meta.fundamentalsAsOf — und neutralisierte sich damit selbst.
  // BEIDE Verbraucher fallen dann auf meta.fetchedAt zurueck, das der Vollabruf
  // GERADE frisch gestempelt hat, also galt der luecken hafte Snapshot 30 Tage als
  // voll-frisch. Das explizite Flag muss die Anker-Kette schlagen.
  await test('Nachzug 622: unvollstaendiger Vollabruf schlaegt den frischen Zeitanker', () => {
    const jetzt = Date.parse('2026-08-09T12:00:00Z');
    const stempel = new Date(jetzt).toISOString();
    const unvollstaendig = { asOf: stempel, fetchedAt: stempel, fundamentalsIncomplete: true };
    assert.equal(yahoo.fundamentalsStaleness(unvollstaendig, jetzt + 1000).stale, true);
    assert.equal(yahoo.needsFullPull(unvollstaendig, { date: '2026-08-08' }, new Date(jetzt)), 'full');
    // Gegenprobe: ohne das Flag gewinnt der frische Anker weiterhin — sonst waere
    // jeder Snapshot dauerhaft faellig und der Waechter bewiese nichts.
    const vollstaendig = { asOf: stempel, fetchedAt: stempel };
    assert.equal(yahoo.fundamentalsStaleness(vollstaendig, jetzt + 1000).stale, false);
    assert.equal(yahoo.needsFullPull(vollstaendig, { date: '2026-08-08' }, new Date(jetzt)), 'price-only');
  });

  // Nachzug Tag 622 (Review-Fund HOCH): GitHub erkennt ::warning:: NUR am
  // Zeilenanfang. _log stellt '[ts] [WARN] ' davor, die Annotation verpuffte also.
  await test('Nachzug 622: Workflow-Annotationen laufen nie durch _log', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
    const verpufft = src.split('\n').filter(z => z.includes('_log(') && z.includes('::warning::'));
    assert.deepEqual(verpufft, [], 'annotation via _log bekommt einen [ts]-Praefix und wird von GitHub ignoriert');
    // Anwesenheit: der Kanal existiert ueberhaupt noch (sonst waere die Abwesenheit
    // oben auch durch Loeschen aller Annotationen zu erfuellen).
    assert.ok(/console\.warn\(`::warning::/.test(src), 'rohe ::warning::-Zeilen fehlen ganz');
  });

  console.log(`\nP1-Welle 6: ${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})();
