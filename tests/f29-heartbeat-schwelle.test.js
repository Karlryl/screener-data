'use strict';
/**
 * F-29 / F-CGPT-045-Rest (Tag 632) — Alarmschwelle der Heartbeat-Preis-Abdeckung.
 *
 * BEFUND: `scripts/heartbeat-preis-abdeckung.js` misst seit Tag 620 den Anteil der
 * Watchlist-Titel ohne jede Kurszeile, kann aber PER DESIGN nie rot werden. Ein
 * Totalausfall des Kurs-Substrats waere im CI genauso gruen wie ein gesunder Tag.
 *
 * KARL-ENTSCHEID F-29c (10.08.2026, Rat-Vorlage _RAT-VORLAGE-heartbeat-schwelle-
 * 2026-08-10.md): Die KERN-Gruppe (US-Boersen + Altbestand ohne Boersen-Hint) wird
 * rot ab 5 % Leer-Anteil. Der Auslandsteil bleibt reine MESSUNG und loest NIE Alarm
 * aus — dort fehlen schon heute 17,8 % (bekannte Beschaffungs-Luecke), und jede
 * Gesamtquote wandert allein durch Zu- und Abgaenge um Prozentpunkte.
 *
 * WAS DIESE DATEI FESTNAGELT (Verhalten, nicht Schreibweise — alle Faelle laufen
 * die echte CLI in einem Wegwerf-Repo gegen gebaute Fixtures):
 *   (a) Kern >= 5 % leer          -> Exit 1 + ::error:: in Spalte 0
 *   (b) Kern gesund, Ausland 100 % leer -> Exit 0, KEIN ::error::  (Kern von Option c)
 *   (c) Messausfall (beide Wege)  -> MESSAUSFALL-Verhalten unveraendert (Exit 0 + ::warning::)
 *   (d) gesunde Daten             -> Exit 0, kein ::error::
 *   (e) Grenzfall 4 % / 5 %       -> nagelt die SCHWELLE fest, nicht nur "irgendwo rot"
 *   (f) Altbestand ohne Hint zaehlt zum Kern; das 14-Tage-Ventil gilt dort weiter
 *   (g) die Kern/Ausland-Aufteilung steht auch im GRUENEN Lauf in der Ausgabe
 *
 * ROT-ZUERST: gegen origin/main (Stand 517ce9a487) faellt (a), (e-rot) und (f) —
 * das Skript kannte dort kein exit 1. Belegt im PR.
 *
 * Standalone-Runner: node tests/f29-heartbeat-schwelle.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SKRIPT_QUELLE = path.join(ROOT, 'scripts', 'heartbeat-preis-abdeckung.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const ALT = '2020-01-01T00:00:00.000Z';                                  // laengst durch das Ventil
const GESTERN = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const SERIE = [{ date: GESTERN, close: 10 }];

/** n Watchlist-Zeilen mit gemeinsamem Boersen-Hint; die ersten `leer` bekommen keine Kurse. */
function gruppe(praefix, n, leer, hint, added_at = ALT) {
  const zeilen = [], kurse = {};
  for (let i = 0; i < n; i++) {
    const t = praefix + i;
    const zeile = { ticker: t, yahoo_symbol: t, added_at };
    if (hint !== undefined) zeile.exchange_hint = hint;
    zeilen.push(zeile);
    if (i >= leer) kurse[t] = SERIE;
  }
  return { zeilen, kurse };
}

/**
 * Wegwerf-Repo: das Skript liest watchlist.json ueber __dirname/.. und den
 * Preis-Store ueber den CWD-relativen Pfad 'prices'. Beides muss also nachgebaut
 * werden — ein Test, der nur den echten Bestand laeuft, kann keine Schwelle pruefen.
 * `prices/history.json` ist der Legacy-Monolith-Pfad des Stores (kein Shard-Aufbau noetig).
 */
function baueRepo(watchlistInhalt, storeInhalt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f29-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'prices'));
  fs.cpSync(path.join(ROOT, 'lib'), path.join(dir, 'lib'), { recursive: true });
  fs.copyFileSync(SKRIPT_QUELLE, path.join(dir, 'scripts', 'heartbeat-preis-abdeckung.js'));
  const schreib = (p, v) => fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v));
  schreib(path.join(dir, 'watchlist.json'), watchlistInhalt);
  schreib(path.join(dir, 'prices', 'history.json'), storeInhalt);
  return dir;
}

function lauf(zeilen, kurse) {
  const dir = baueRepo(zeilen, kurse);
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'heartbeat-preis-abdeckung.js')],
    { cwd: dir, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status, alles: (r.stdout || '') + (r.stderr || ''), out: r.stdout || '', err: r.stderr || '' };
}

/** Ein Workflow-Command wirkt nur am ZEILENANFANG — eingerueckt ist er blosser Text. */
const ROT = /^::error::/m;

// ── (a) Kern ueber der Schwelle: rot ────────────────────────────────────────
check('(a) Kern-Leer-Anteil >= 5 % macht den Lauf rot (Exit 1 + ::error:: in Spalte 0)', () => {
  const g = gruppe('K', 20, 2, 'NASDAQ');            // 2/20 = 10 %
  const r = lauf(g.zeilen, g.kurse);
  assert.equal(r.code, 1, 'ein Kern-Ausfall MUSS den Schritt rot faerben — sonst ist F-29 nicht gefixt');
  assert.match(r.alles, ROT, 'ohne ::error:: in Spalte 0 sieht GitHub nur Text und der Lauf bleibt optisch stumm');
  const zeile = r.alles.split(/\r?\n/).find((z) => z.startsWith('::error::'));
  assert.match(zeile, /10[.,]0 %/, 'die Fehlerzeile muss die gemessene Kern-Quote nennen');
  assert.match(zeile, /\b20\b/, 'die Fehlerzeile muss die Kern-Groesse nennen (sonst ist die Quote nicht einzuordnen)');
  assert.match(zeile, /Schwelle 5 %/, 'die Fehlerzeile muss die Schwelle nennen, an der sie gemessen hat');
  assert.match(r.out, /Status: ALARM/, 'auch die taegliche Aufteilungs-Zeile muss den Alarm aussprechen');
});

// ── (b) Der eigentliche Karl-Entscheid: Ausland alarmiert NIE ───────────────
check('(b) Ausland zu 100 % leer, Kern gesund -> Exit 0 und KEIN ::error::', () => {
  const k = gruppe('K', 100, 0, 'NYSE');
  const a = gruppe('A', 50, 50, 'EUROTLX');          // Gesamtquote 33 %, Kern 0 %
  const r = lauf(k.zeilen.concat(a.zeilen), Object.assign({}, k.kurse, a.kurse));
  assert.equal(r.code, 0, 'der Auslandsteil ist per Karl-Entscheid F-29c reine Messung — er darf nie ausloesen');
  assert.ok(!ROT.test(r.alles), 'ein Alarm auf die Gesamtquote waere Option a, nicht die entschiedene Option c');
  assert.match(r.out, /Ausland/, 'die Auslands-Zahl muss trotzdem sichtbar bleiben (sonst misst niemand die Luecke)');
});

check('(b2) GEGENPROBE zur Aufteilung: dieselben 50 leeren Titel im KERN sind rot', () => {
  const k = gruppe('K', 100, 0, 'NYSE');
  const a = gruppe('A', 50, 50, 'NASDAQ');           // gleiche Menge, nur andere Boerse
  const r = lauf(k.zeilen.concat(a.zeilen), Object.assign({}, k.kurse, a.kurse));
  assert.equal(r.code, 1, 'sonst haengt (b) nicht an der Gruppierung, sondern daran, dass nie etwas feuert');
});

// ── (c) MESSAUSFALL-Semantik (F-CGPT-045-Fix, Tag 620) unveraendert ─────────
check('(c1) Messausfall Watchlist: Exit 0 mit ::warning::, kein ::error::', () => {
  const r = lauf('{ kaputt', {});
  assert.equal(r.code, 0, 'ein Messausfall ist kein Kern-Befund — er darf den neuen Alarm nicht ausloesen');
  assert.match(r.alles, /::warning::MESSAUSFALL:/);
  assert.ok(!ROT.test(r.alles), 'sonst waere jeder Lese-Schluckauf ein Kurs-Alarm und der Alarm verliert seine Bedeutung');
});

check('(c2) Messausfall Preis-Store: Exit 0 mit ::warning::, kein ::error::', () => {
  const g = gruppe('K', 20, 0, 'NASDAQ');
  const r = lauf(g.zeilen, 'null');                  // Store liefert kein Ticker-Objekt -> wirft
  assert.equal(r.code, 0);
  assert.match(r.alles, /::warning::MESSAUSFALL:/);
  assert.ok(!ROT.test(r.alles), 'ein leerer/unlesbarer Store saehe wie 100 % leer aus — genau deshalb NIE Alarm daraus');
});

// ── (d) Negativ-Kontrolle ───────────────────────────────────────────────────
check('(d) gesunde Daten: Exit 0, kein ::error::', () => {
  const k = gruppe('K', 50, 0, 'NASDAQ');
  const a = gruppe('A', 30, 0, 'TSX');
  const r = lauf(k.zeilen.concat(a.zeilen), Object.assign({}, k.kurse, a.kurse));
  assert.equal(r.code, 0);
  assert.ok(!ROT.test(r.alles), 'ein Wachhund, der auf gesunde Daten anschlaegt, wird nach zwei Tagen ignoriert');
});

// ── (e) Die SCHWELLE selbst, nicht nur "irgendwo rot" ───────────────────────
check('(e1) 4 von 100 Kern-Titeln leer (4 %) bleibt gruen', () => {
  const g = gruppe('K', 100, 4, 'NYSE');
  const r = lauf(g.zeilen, g.kurse);
  assert.equal(r.code, 0, 'unter der Schwelle bleibt es Messung — sonst waere jeder Beschaffungs-Huster rot');
  assert.ok(!ROT.test(r.alles));
});

check('(e2) 5 von 100 Kern-Titeln leer (genau 5 %) ist rot', () => {
  const g = gruppe('K', 100, 5, 'NYSE');
  const r = lauf(g.zeilen, g.kurse);
  assert.equal(r.code, 1, 'die Schwelle ist ">= 5 %"; ein ">" liesse den entschiedenen Grenzwert selbst durch');
  assert.match(r.alles, ROT);
});

// ── (f) Kern-Definition: Altbestand und Ventil ──────────────────────────────
check('(f1) Altbestand OHNE exchange_hint zaehlt zum Kern (Rat-Vorlagen-Definition)', () => {
  const g = gruppe('ALT', 20, 2, undefined, undefined);   // kein Hint, kein added_at
  const r = lauf(g.zeilen, g.kurse);
  assert.equal(r.code, 1, 'ohne den Altbestand bewacht der Alarm genau die Titel nicht, die am laengsten dabei sind');
});

check('(f2) das 14-Tage-Ventil gilt im Kern weiter: frische Neuzugaenge loesen nicht aus', () => {
  const gestern = new Date(Date.now() - 86400000).toISOString();
  const alt = gruppe('K', 20, 0, 'NASDAQ');
  const neu = gruppe('N', 80, 80, 'NASDAQ', gestern);     // 80 nagelneue Titel, alle noch ohne Kurse
  const r = lauf(alt.zeilen.concat(neu.zeilen), Object.assign({}, alt.kurse, neu.kurse));
  assert.equal(r.code, 0, 'ein gestern aufgenommener Titel KANN keine Historie haben — das waere Dauer-Alarm');
  assert.ok(!ROT.test(r.alles));
});

check('(f3) die Nasdaq-Falle: "Nasdaq Stockholm" & Co. sind KEIN Kern', () => {
  // Review-Befund 10.08.: ohne diesen Fall bliebe die Suite gruen, wenn jemand den exakten
  // Set-Treffer zu startsWith('NASDAQ') "vereinfacht" — 132 nordische Titel (Stockholm 79,
  // Copenhagen 25, Helsinki 19, Iceland 9) rutschten dann in die alarmfaehige Gruppe.
  const k = gruppe('K', 100, 0, 'NASDAQ');
  const nordisch = [];
  const kurse = Object.assign({}, k.kurse);
  ['Nasdaq Stockholm', 'Nasdaq Copenhagen', 'Nasdaq Helsinki', 'Nasdaq Iceland'].forEach((hint, i) => {
    const g = gruppe('N' + i + '_', 25, 25, hint);   // alle leer
    nordisch.push(...g.zeilen);
  });
  const r = lauf(k.zeilen.concat(nordisch), kurse);
  assert.equal(r.code, 0, '"Nasdaq Stockholm" ist die Stockholmer Boerse, keine US-Boerse');
  assert.ok(!ROT.test(r.alles));
  assert.match(r.out, /Kern[^\n]*von 100 leer/, 'die 100 nordischen Titel duerfen die Kern-Groesse nicht aufblaehen');
});

check('(f4) unbekannte und kaputte Hints landen im Ausland, ohne zu werfen', () => {
  // Vertrag laut Kopfkommentar: Unbekanntes faellt bewusst ins Ausland (nie Fehlalarm aus
  // einer Kohorte, die gar nicht gemeint war). Zahl/Objekt/Array duerfen dabei nicht werfen —
  // ein Wurf waere ein MESSAUSFALL und wuerde die ganze Messung verschlucken.
  const k = gruppe('K', 100, 0, 'NYSE');
  const kaputt = [
    { ticker: 'Z1', added_at: ALT, exchange_hint: 42 },
    { ticker: 'Z2', added_at: ALT, exchange_hint: { name: 'NYSE' } },
    { ticker: 'Z3', added_at: ALT, exchange_hint: ['NYSE'] },
    { ticker: 'Z4', added_at: ALT, exchange_hint: 'VOELLIG NEUE BOERSE' },
  ];
  const r = lauf(k.zeilen.concat(kaputt), k.kurse);
  assert.equal(r.code, 0, 'kein Wurf, kein Alarm');
  assert.ok(!/MESSAUSFALL/.test(r.alles), 'ein kaputter Hint darf nicht die ganze Messung kippen');
  assert.match(r.out, /Ausland[^\n]*4 von 4 leer/, 'sie gehoeren sichtbar ins Ausland, nicht in den Kern');
});

check('(f5) 5 von 101 Kern-Titeln (4,95 %) bleibt gruen UND sagt das auch', () => {
  // Review-Befund 10.08.: die gerundete Anzeige zeigt hier "5.0 %" bei Schwelle "5 %".
  // Ohne den ausgeschriebenen Status liest Karl einen verschluckten Alarm.
  const g = gruppe('K', 101, 5, 'NYSE');
  const r = lauf(g.zeilen, g.kurse);
  assert.equal(r.code, 0);
  assert.match(r.out, /Status: OK/, 'die gerundete Zahl allein widerspricht hier der Entscheidung');
  assert.ok(!/Status: ALARM/.test(r.out));
});

// ── (g) Sichtbarkeit im gruenen Lauf ────────────────────────────────────────
check('(g) die Kern/Ausland-Aufteilung steht auch im gruenen Lauf in der Ausgabe', () => {
  const k = gruppe('K', 40, 1, 'NYSE');
  const a = gruppe('A', 20, 10, 'ASX');
  const r = lauf(k.zeilen.concat(a.zeilen), Object.assign({}, k.kurse, a.kurse));
  assert.equal(r.code, 0);
  assert.match(r.out, /Kern[^\n]*40/, 'die Kern-Groesse muss taeglich mitlaufen — eine Zahl nur im Alarmfall ist keine Messreihe');
  assert.match(r.out, /Ausland[^\n]*20/, 'der Auslandsteil wird weiter voll gedruckt, nur ohne Alarm');
  assert.match(r.out, /Schwelle 5 %/, 'die geltende Schwelle gehoert in die taegliche Ausgabe, nicht nur in den Quelltext');
});

console.log('\nGeprueft: die Alarmschwelle aus Karl-Entscheid F-29c (Kern rot ab 5 %, Ausland reine Messung) '
  + 'an 14 CLI-Laeufen gegen gebaute Wegwerf-Repos — inkl. Grenzfall 4 %/5 %/4,95 %, Gruppierungs-'
  + 'Gegenprobe, Nasdaq-Stockholm-Falle, kaputter Hint-Typen, beider Messausfall-Wege und des '
  + 'Neuzugangs-Ventils.');
console.log('f29-heartbeat-schwelle: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
