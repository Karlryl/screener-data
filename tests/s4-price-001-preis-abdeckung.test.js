'use strict';
/**
 * S4-PRICE-001 (Block 5, Verifikation 2026-08-03) — Preis-Abdeckung auf
 * WATCHLIST-Ebene, als MESSUNG.
 *
 * BEFUND: Der Heartbeat prueft das Preis-Substrat nur am Store-Stempel
 * (prices/history/_meta.json) und an der SPY-Serie. Beide sagen, ob der Pull noch
 * schreibt — nicht, fuer wie viele Watchlist-Titel ueberhaupt Kurse dastehen.
 * Gemessen am 03.08.2026: 1.801 von 15.337 Titeln ohne eine einzige Kurszeile,
 * 38 Serien aelter als 30 Tage. _meta und SPY waren dabei frisch.
 *
 * DIESER BAU WAR NUR MESSUNG UND AUSGABE. Seit Tag 632 (Karl-Entscheid F-29c,
 * 10.08.2026) traegt die KERN-Gruppe eine Schwelle von 5 %; der Auslandsteil bleibt
 * reine Messung. Das Alarm-VERHALTEN gehoert ab dort in
 * tests/f29-heartbeat-schwelle.test.js — diese Datei prueft weiter Messung, Ventil,
 * Ausgabe und den Einbau in den Heartbeat.
 *
 * Standalone-Runner: node tests/s4-price-001-preis-abdeckung.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const M = require('../scripts/heartbeat-preis-abdeckung.js');
const SKRIPT = path.join(ROOT, 'scripts', 'heartbeat-preis-abdeckung.js');
const HB = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'heartbeat.yml'), 'utf8');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const JETZT = Date.parse('2026-08-03T12:00:00.000Z');
const vorTagen = (n) => new Date(JETZT - n * 86400000).toISOString();
const serie = (letztesDatum) => [{ date: letztesDatum, close: 10 }];

// ── Die Messung selbst ──────────────────────────────────────────────────────
check('zaehlt Titel ohne jede Kurszeile und nennt den Anteil an der GEMESSENEN Menge', () => {
  const zeilen = [
    { ticker: 'A', added_at: vorTagen(400) },
    { ticker: 'B', added_at: vorTagen(400) },
    { ticker: 'C', added_at: vorTagen(400) },
    { ticker: 'D', added_at: vorTagen(400) },
  ];
  const alle = { A: serie('2026-08-01'), B: serie('2026-08-01'), C: [], /* D fehlt ganz */ };
  const m = M.messePreisAbdeckung(zeilen, alle, { jetzt: JETZT });
  assert.equal(m.leer, 2, 'leere Serie UND fehlender Schluessel zaehlen beide als "ohne Kurszeile"');
  assert.equal(m.basis, 4);
  assert.equal(m.leerAnteil, 0.5);
});

check('zaehlt Serien, deren letzte Zeile aelter als die Grenze ist, und nennt den aeltesten Fall', () => {
  const zeilen = [
    { ticker: 'FRISCH', added_at: vorTagen(400) },
    { ticker: 'ALT', added_at: vorTagen(400) },
    { ticker: 'URALT', added_at: vorTagen(400) },
  ];
  const alle = {
    FRISCH: serie('2026-08-01'),
    ALT: serie('2026-06-01'),      // 63 Tage
    URALT: serie('2025-08-22'),    // 346 Tage
  };
  const m = M.messePreisAbdeckung(zeilen, alle, { jetzt: JETZT });
  assert.equal(m.alt, 2);
  assert.equal(m.aeltester.ticker, 'URALT', 'der schlimmste Fall muss benannt werden, nicht nur gezaehlt');
  assert.equal(m.aeltester.tage, 346);
});

check('Neuzugangs-Ventil: Titel juenger als die Grenze bleiben aus der Messung', () => {
  const zeilen = [
    { ticker: 'GESTERN', added_at: vorTagen(1) },
    { ticker: 'ALTBESTAND', added_at: vorTagen(400) },
  ];
  const m = M.messePreisAbdeckung(zeilen, {}, { jetzt: JETZT });
  assert.equal(m.ventil, 1, 'ein gestern aufgenommener Titel KANN keine Historie haben');
  assert.equal(m.basis, 1);
  assert.equal(m.leer, 1, 'der Altbestand ohne Kurse muss weiter gezaehlt werden');
});

check('GEGENPROBE: das Ventil verschluckt NICHT den Altbestand ohne added_at', () => {
  // 3.298 Watchlist-Zeilen haben gar kein added_at (aelter als das Feld). Wer die
  // als "neu" behandelt, blendet genau die aeltesten Luecken aus — 1COV.DE und
  // 3333.HK, die beiden schlimmsten Faelle im echten Bestand, haengen daran.
  const m = M.messePreisAbdeckung([{ ticker: 'OHNE_STEMPEL' }], {}, { jetzt: JETZT });
  assert.equal(m.ventil, 0, 'fehlendes added_at heisst Altbestand, nicht Neuzugang');
  assert.equal(m.leer, 1);
});

check('GEGENPROBE: ein unlesbares added_at fuehrt nicht zum stillen Ausschluss', () => {
  const m = M.messePreisAbdeckung([{ ticker: 'X', added_at: 'neulich' }], {}, { jetzt: JETZT });
  assert.equal(m.ventil, 0);
  assert.equal(m.basis, 1);
});

check('leere Grundmenge ergibt keinen Anteil statt 0 % oder NaN', () => {
  const m = M.messePreisAbdeckung([{ ticker: 'NEU', added_at: vorTagen(1) }], {}, { jetzt: JETZT });
  assert.equal(m.basis, 0);
  assert.equal(m.leerAnteil, null, '0/0 als "0 %" zu drucken waere die falscheste aller Zahlen');
});

check('alle drei Watchlist-Schreibweisen werden gelesen', () => {
  const eine = [{ ticker: 'A' }];
  assert.equal(M.watchlistZeilen(eine).length, 1);
  assert.equal(M.watchlistZeilen({ stocks: eine }).length, 1);
  assert.equal(M.watchlistZeilen({ A: { ticker: 'A' } }).length, 1);
});

// ── IMMER ausgeben (Tag-520-Lehre) ──────────────────────────────────────────
check('der Lauf am ECHTEN Bestand druckt beide Kennzahlen', () => {
  // spawnSync statt execFileSync (Tag 632): seit dem Karl-Entscheid F-29c KANN der
  // Lauf berechtigt auf 1 enden (Kern-Quote >= 5 %). execFileSync wuerde dann werfen
  // und dieser Test waere rot, obwohl das Skript genau richtig gearbeitet hat — und
  // der naechste Leser "repariert" den Alarm statt der Kursdaten.
  const r = spawnSync(process.execPath, [SKRIPT], { cwd: ROOT, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  if (/::warning::MESSAUSFALL:/.test(out)) {
    // Auch der Messausfall ist ein Ergebnis — er muss nur laut sein, nicht still.
    return;
  }
  assert.ok(r.status === 0 || /^::error::/m.test(out),
    'Exit 1 ist nur mit ausgesprochenem ::error:: erlaubt — ein stummer roter Lauf erklaert nichts');
  assert.match(out, /KENNZAHL 1 — ohne jede Kurszeile: \d+ von \d+/);
  assert.match(out, /KENNZAHL 2 — letzte Kurszeile aelter als \d+ Tage: \d+/);
  assert.match(out, /Neuzugangs-Ventil:\s+\d+ Titel/,
    'ohne die Zahl der ausgenommenen Titel liest man die Restquote fuer die ganze Wahrheit (Tag-520-Lehre)');
});

/**
 * TAG 632: Hier stand bis zum Karl-Entscheid F-29c (10.08.2026) der Wachhund
 * "das Skript kann gar nicht rot werden" — ein Quelltext-Grep auf `process.exit(1)`
 * und `::error::`. Er war ausdruecklich ein Platzhalter bis zur Rat-Entscheidung
 * ("eine Rot-Schwelle ist Rat-pflichtig"). Der Rat hat entschieden: Kern rot ab 5 %.
 * Das VERHALTEN nagelt jetzt tests/f29-heartbeat-schwelle.test.js fest (11 CLI-Laeufe).
 *
 * An dieser Stelle bleibt die Sache stehen, die ein Verhaltens-Test NICHT sehen kann:
 * die Schwelle ist eine feste Konstante — kein Config-Eintrag, kein Env-Ventil. Eine
 * zur Laufzeit weichstellbare Schwelle ist im Ernstfall genau dann weich, wenn sie
 * jemand weggedreht hat (Karl-Auflage zum Entscheid F-29c).
 */
check('die Alarmschwelle ist fest verdrahtet (kein Env-Ventil, kein Config-Schalter)', () => {
  const src = fs.readFileSync(SKRIPT, 'utf8');
  assert.match(src, /const KERN_ALARM_ANTEIL = 0\.05;/,
    'die Schwelle aus Karl-Entscheid F-29c muss als benannte Konstante dastehen');
  const zeile = src.split(/\r?\n/).find((z) => z.includes('KERN_ALARM_ANTEIL ='));
  assert.ok(!/process\.env|config|Number\(/.test(zeile),
    'die Schwelle darf nicht aus Umgebung oder Config kommen: ' + zeile);
});

check('GEGENPROBE zur Schreibweise: ein VERGIFTETER Store macht den Lauf trotzdem nicht rot', () => {
  // Der Test darueber greppt nur Schreibweisen (kein exit(1), kein ::error::) — rot wird
  // der Schritt aber auch durch eine WERFENDE Messung. Realer Weg dorthin: loadAll gibt
  // im Legacy-Zweig geparstes null zurueck (prices/history.json mit Inhalt "null"), dann
  // wirft messePreisAbdeckung TypeError, node endet auf 1 und der Schritt faerbt rot —
  // und ausgerechnet dann fehlen die "immer drucken"-Kennzahlen. Hier laeuft deshalb der
  // ECHTE main()-Pfad gegen einen Store, der genau das tut.
  const store = require('../lib/price-history-store.js');
  const echtesLoadAll = store.loadAll;
  const echtesLog = console.log;
  const gedruckt = [];
  let rc, err = null;
  try {
    store.loadAll = () => null;
    console.log = (...a) => gedruckt.push(a.join(' '));
    rc = M.main();
  } catch (e) {
    err = e;
  } finally {
    store.loadAll = echtesLoadAll;
    console.log = echtesLog;
  }
  const out = gedruckt.join('\n');
  assert.equal(err, null, 'main() darf nicht werfen — ein Wurf ist Exit 1 und damit ein roter Schritt: '
    + (err && err.message));
  assert.equal(rc, 0, 'der Schritt endet immer mit 0');
  assert.ok(!/watchlist\.json nicht lesbar/.test(out),
    'sonst bestaende der Test nur, weil er vor der Messung abgebogen ist');
  assert.match(out, /::warning::/, 'der Messausfall muss laut sein, nicht still');
});

// ── Einbau in den Heartbeat ─────────────────────────────────────────────────
check('der Heartbeat ruft die Messung als DRITTEN Schritt auf, nach den beiden Frische-Pruefungen', () => {
  const iExport = HB.indexOf('- name: Check export freshness');
  const iSubstrat = HB.indexOf('- name: Check price-substrate freshness (A7-b)');
  const iNeu = HB.indexOf('node scripts/heartbeat-preis-abdeckung.js');
  assert.ok(iExport > 0 && iSubstrat > iExport, 'die beiden Bestands-Schritte fehlen oder stehen falsch');
  assert.ok(iNeu > iSubstrat, 'die Messung fehlt im Heartbeat oder laeuft vor den Frische-Pruefungen');
});

/**
 * NUR die YAML-Schluessel des Schritts — nicht bis zum naechsten `- name:`.
 * Zwischen zwei Schritten steht in dieser Datei ein Kommentarblock, und der
 * Block unter diesem Schritt enthaelt selbst das Wort "if: always()". Ein Fenster
 * bis zum naechsten Schritt bliebe deshalb gruen, wenn man den Schluessel HIER
 * entfernt (im ersten Anlauf genau so passiert).
 */
function schrittKoerper(name) {
  const i = HB.indexOf('- name: ' + name);
  assert.ok(i > 0, 'der Schritt fehlt oder heisst anders: ' + name);
  const zeilen = HB.slice(i).split(/\r?\n/);
  const koerper = [];
  for (let k = 1; k < zeilen.length; k++) {
    const t = zeilen[k].trim();
    if (t.startsWith('#') || t.startsWith('- name:')) break;
    koerper.push(zeilen[k]);
  }
  return koerper.join('\n');
}

check('die Messung laeuft auch, wenn ein Schritt davor rot war (if: always())', () => {
  const s = schrittKoerper('Check price coverage');
  assert.match(s, /if: always\(\)/,
    'sonst faellt genau bei einem Substrat-Alarm die Zahl aus, die erklaert, wie schlimm es ist');
  assert.ok(!/continue-on-error/.test(s),
    'seit Tag 632 kann der Schritt rot werden — eine Maskierung wuerde den Kern-Alarm wirkungslos machen');
});

console.log('\nGeprueft: scripts/heartbeat-preis-abdeckung.js (messePreisAbdeckung an 6 Fixtures inkl. '
  + 'beider Ventil-Gegenrichtungen + ein echter Lauf gegen watchlist.json und den Preis-Store) '
  + 'sowie der Einbau in .github/workflows/heartbeat.yml (Reihenfolge, if: always(), kein continue-on-error). '
  + 'Das Alarm-Verhalten selbst steht in tests/f29-heartbeat-schwelle.test.js.');
console.log('s4-price-001: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
