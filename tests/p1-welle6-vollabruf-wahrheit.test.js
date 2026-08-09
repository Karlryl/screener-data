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
    const corrupt = path.join(tmp, 'calendar.json');
    fs.writeFileSync(corrupt, '{kaputt');
    assert.throws(() => earnings.loadPreviousCalendar(corrupt), /unlesbar/);
    assert.deepEqual(earnings.loadPreviousCalendar(path.join(tmp, 'fehlt.json')), {});
    fs.rmSync(tmp, { recursive: true, force: true });
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

  console.log(`\nP1-Welle 6: ${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})();
