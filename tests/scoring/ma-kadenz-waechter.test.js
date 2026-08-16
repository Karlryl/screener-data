// tests/scoring/ma-kadenz-waechter.test.js — Standalone-Runner (assert + process.exit).
//
// Waechter fuer M-A (Beschluss Quartalsreihen 16.08.2026 + Nachtrag): die
// 75..105-Tage-Kadenz-Anforderung gilt an BEIDEN Rechenorten, in STRIKTER Lesart.
//
// Der Test prueft in BEIDE Richtungen — das ist Absicht und nicht verhandelbar:
// ein Waechter, der nur das Blocken prueft, ist mit `return null` zu bestehen.
// Zu jedem "muss draussen bleiben" gehoert deshalb ein "muss durchkommen".
//
// Und er nagelt die SACHE fest, nicht ein Schreibmuster: wo eine Zeile blockiert wird,
// wird zusaetzlich bewiesen, dass ALLE UEBRIGEN Vorbedingungen des alten Codes erfuellt
// waren (Jahrespartner vorhanden, Werte positiv, keine Luecke) — sonst koennte der Test
// gruen bleiben, weil ein ganz anderer Zweig gegriffen hat.
//
// Run: node tests/scoring/ma-kadenz-waechter.test.js
'use strict';
const assert = require('assert');
const axes = require('../../src/scoring/axes.js');
const snap = require('../../src/scoring/snapshot.js');
const lamps = require('../../src/scoring/lamps.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

const TAG = 86400000;
// Enden aus Periodenlaengen bauen: perioden[i] = Tage zwischen Ende i und Ende i+1
// (newest-first, genau die Richtung, die periodeIstQuartal misst).
function endenAus(neuestesIso, perioden) {
  const out = [neuestesIso];
  let t = Date.parse(neuestesIso + 'T00:00:00Z');
  for (const p of perioden) { t -= p * TAG; out.push(new Date(t).toISOString().slice(0, 10)); }
  return out;
}
// Snapshot NUR mit Quartalsreihe — bewusst OHNE annualRev/annualGP: dann ist jeder
// Jahres-Fallback verschlossen, und "null" beweist eindeutig, dass der Quartals-Weg
// nicht gegangen wurde. Mit Jahresreihe waere das Ergebnis nicht zuordenbar.
function snapQ(werte, enden) {
  return { timeseries: { revenueQ: werte.map((v) => ({ value: v })), revenueQEnds: enden } };
}
// Alle Vorbedingungen des Codes VOR dem Kadenz-Gate — muss true sein, damit ein
// erwartetes null wirklich dem Gate zuzuschreiben ist.
function altePfadeOffen(s, i) {
  const rq = snap.norm(s, 'revenueQ');
  const v = snap.jahresVergleichIdx(s, 'revenueQ', i);
  if (v === null || v.idx >= rq.length) return false;
  if (!rq.slice(0, v.idx + 1).every(Number.isFinite)) return false;
  return rq[i] > 0 && rq[v.idx] > 0;
}
const steigend = (n) => Array.from({ length: n }, (_, i) => 100 + 10 * (n - i));

// ── A. Rechenort 1: revQuartalsYoY ───────────────────────────────────────────

check('A1 DURCHLASSEN — bestaetigte Quartals-Kadenz behaelt das Quartals-Bein', () => {
  const enden = endenAus('2026-04-30', [89, 92, 92, 92]);          // CRDO/NVDA-Form
  const s = snapQ(steigend(5), enden);
  assert.strictEqual(snap.periodeIstQuartal(s, 'revenueQ', 0), true, 'Periode 0 muss bestaetigt sein');
  assert.notStrictEqual(axes.revQuartalsYoY(s), null, 'saubere Reihe darf ihr Quartals-Bein NICHT verlieren');
});

check('A2 BLOCKIEREN — Halbjahres-Eimer als juengste Periode bildet kein Quartals-Bein', () => {
  const enden = endenAus('2026-06-30', [184, 91, 90, 92]);         // 2548.TW-Form
  const s = snapQ(steigend(5), enden);
  assert.ok(altePfadeOffen(s, 0), 'Vorbedingung: ohne das Gate haette der alte Code hier gerechnet');
  assert.strictEqual(snap.periodeIstQuartal(s, 'revenueQ', 0), false);
  assert.strictEqual(axes.revQuartalsYoY(s), null, 'ein 184-Tage-Eimer ist kein Quartal');
});

check('A3 BLOCKIEREN — datierte Reihe, aber Periode 0 nicht messbar', () => {
  // Enden vorhanden, aber nur zwei Stueck und der Partner sitzt jenseits davon: Periode 0
  // laesst sich nicht bestaetigen. Das ist der Regelfall des "nicht messbar" — und er wird
  // strikt behandelt, weil eine datierte Reihe sehr wohl etwas vorliegen hat, worueber zu
  // urteilen waere (im Unterschied zur F-4-Klausel, Waechter E1).
  const s = snapQ(steigend(5), ['2026-03-31', null, null, null, null]);
  assert.strictEqual(snap.periodeIstQuartal(s, 'revenueQ', 0), null, 'Vorgaenger-Ende fehlt');
  assert.ok(altePfadeOffen(s, 0), 'Vorbedingung: der alte Code haette hier ueber die Positionsregel gerechnet');
  assert.strictEqual(axes.revQuartalsYoY(s), null, 'strikte Lesart: nicht bestaetigt = nicht erfuellt');
});

check('A4 NUR Index 0 wird gegated — der datierte Jahrespartner darf unmessbar sein', () => {
  // Genau die Anker-Form: 5 Quartale, Partner ist der AELTESTE Index (nicht messbar).
  // Wuerde der Partner mitgegated, verloeren CRDO/NVDA/ALAB/BE/PLTR ihr Quartals-Bein.
  const enden = endenAus('2026-03-31', [90, 92, 92, 91]);
  const s = snapQ(steigend(5), enden);
  const v = snap.jahresVergleichIdx(s, 'revenueQ', 0);
  assert.strictEqual(v.idx, 4, 'Partner ist der aelteste Index');
  assert.strictEqual(snap.periodeIstQuartal(s, 'revenueQ', 4), null, 'dessen Laenge ist nicht messbar');
  assert.notStrictEqual(axes.revQuartalsYoY(s), null, 'trotzdem muss das Quartals-Bein stehen');
});

check('A5 die fuenf gemessenen Anker-Kadenzen behalten alle ihr Quartals-Bein', () => {
  for (const [name, ende, per] of [
    ['CRDO', '2026-04-30', [89, 92, 92, 92]], ['NVDA', '2026-04-30', [89, 92, 92, 92]],
    ['ALAB', '2026-03-31', [90, 92, 92, 91]], ['BE', '2026-03-31', [90, 92, 92, 91]],
    ['PLTR', '2026-03-31', [90, 92, 92, 91]],
  ]) {
    const s = snapQ(steigend(5), endenAus(ende, per));
    assert.notStrictEqual(axes.revQuartalsYoY(s), null, name + ' verliert sein Quartals-Bein');
  }
});

// ── B. Rechenort 2: die eigene Paar-Bildung von revAcceleration ──────────────
// Alle Faelle OHNE annualRev -> null beweist "Quartals-Zweig nicht erreicht".

check('B1 ERREICHEN — 7 bestaetigte Quartale wecken den Zweig wieder auf', () => {
  const s = snapQ(steigend(8), endenAus('2026-03-31', [90, 92, 92, 91, 90, 92, 92]));
  for (const i of [0, 1, 4, 5]) {
    assert.strictEqual(snap.periodeIstQuartal(s, 'revenueQ', i), true, 'Index ' + i + ' muss bestaetigt sein');
  }
  assert.notStrictEqual(axes.revAcceleration(s, null), null,
    'mit >=7 bestaetigten Quartalen MUSS der Quartals-Zweig tragen (Wiederaufleben, Court-Termin)');
});

check('B2 SCHLAEFT — 6 saubere Quartale reichen strikt nicht (der dokumentierte Normalfall)', () => {
  const s = snapQ(steigend(6), endenAus('2026-03-31', [90, 92, 92, 91, 90]));
  // Ohne Gate haette der alte Code hier ZWEI Paare gehabt — genau das wird bewiesen:
  assert.ok(altePfadeOffen(s, 0) && altePfadeOffen(s, 1), 'Vorbedingung: zwei Paare waren bildbar');
  assert.strictEqual(snap.periodeIstQuartal(s, 'revenueQ', 5), null, 'das aelteste Quartal ist nicht messbar');
  assert.strictEqual(axes.revAcceleration(s, null), null, 'ein unbestaetigtes Quartal bildet kein Paar');
});

check('B3 BLOCKIEREN — verletzte Kadenz mitten in der Reihe nimmt das zweite Paar', () => {
  // Dieselbe Tiefe wie B1 (7 Quartale, sonst 2 Paare) — nur Periode 1 ist ein
  // Halbjahres-Eimer. Damit bleibt EIN Paar, und der Zweig faellt zurueck.
  const s = snapQ(steigend(7), endenAus('2026-03-31', [90, 183, 92, 91, 90, 92]));
  assert.strictEqual(snap.periodeIstQuartal(s, 'revenueQ', 1), false);
  assert.ok(altePfadeOffen(s, 1), 'Vorbedingung: das Paar waere ohne Gate gebildet worden');
  assert.strictEqual(axes.revAcceleration(s, null), null, 'ein Halbjahres-Eimer darf kein YoY-Paar stellen');
});

check('B4 BEIDE Paar-Seiten zaehlen, nicht nur die juengere', () => {
  // Index 0 ist sauber, sein datierter Jahres-PARTNER (Index 4) ist ein Eimer.
  // Gaete nur die junge Seite, bliebe dieses Paar stehen und der Zweig aktiv.
  const s = snapQ(steigend(7), endenAus('2026-03-31', [90, 92, 92, 91, 183, 92]));
  const v = snap.jahresVergleichIdx(s, 'revenueQ', 0);
  assert.strictEqual(v.idx, 4, 'Partner von Index 0 ist Index 4');
  assert.strictEqual(snap.periodeIstQuartal(s, 'revenueQ', 0), true, 'junge Seite ist sauber');
  assert.strictEqual(snap.periodeIstQuartal(s, 'revenueQ', 4), false, 'Partner-Seite ist kein Quartal');
  assert.ok(altePfadeOffen(s, 0), 'Vorbedingung: das Paar waere ohne Gate gebildet worden');
  assert.strictEqual(axes.revAcceleration(s, null), null,
    'eine Beschleunigung aus einer quartalsreinen und einer nicht-quartalsreinen YoY-Rate ist keine');
});

// ── C. EINE Quelle fuer das Band — Lampe und Gate kippen an derselben Kante ───

check('C1 Bandgrenzen sind inklusiv 75..105', () => {
  assert.strictEqual(snap.istQuartalsAbstand(75), true);
  assert.strictEqual(snap.istQuartalsAbstand(105), true);
  assert.strictEqual(snap.istQuartalsAbstand(74), false);
  assert.strictEqual(snap.istQuartalsAbstand(106), false);
  assert.strictEqual(snap.istQuartalsAbstand(NaN), false);
  assert.strictEqual(snap.istQuartalsAbstand(null), false);
});

check('C2 SACHE-Pin: einmalertrag-Lampe und Rang-Gate kippen bei DERSELBEN Tageszahl', () => {
  // Reihe mit einem dominanten Quartal (>=50 % des Fensters) und ohne Anlauf/Saison-
  // Entlastung: die Lampe waere bewertbar — sofern die Kadenz stimmt. Am Bandrand
  // muessen BEIDE Seiten gleichzeitig umschlagen; taete es nur eine, gaebe es zwei Baender.
  // Restperioden so gewaehlt, dass die Summe auf ~365 Tage kommt — sonst faende
  // jahresVergleichIdx gar keinen Partner und der Test waere aus dem falschen Grund gruen.
  const werte = [1000, 90, 100, 80, 95];
  for (const [tage, drin] of [[105, true], [106, false]]) {
    const s = snapQ(werte, endenAus('2026-04-30', [tage, 92, 92, 365 - tage - 184]));
    assert.ok(snap.jahresVergleichIdx(s, 'revenueQ', 0), 'Vorbedingung: Jahrespartner muss gefunden werden');
    assert.strictEqual(snap.periodeIstQuartal(s, 'revenueQ', 0), drin, 'Gate-Seite bei ' + tage + ' Tagen');
    assert.strictEqual(axes.revQuartalsYoY(s) !== null, drin, 'Rang-Gate bei ' + tage + ' Tagen');
    // Lampe: null heisst "wegen ungleicher Kadenz nicht bewertbar".
    assert.strictEqual(lamps.einmalertrag(s) !== null, drin, 'Lampen-Seite bei ' + tage + ' Tagen');
  }
});

// ── E. Die F-4-Klausel: eng, benannt, und an BEIDEN Enden festgenagelt ───────

check('E1 F-4-KLAUSEL — Reihe ganz ohne Enden bleibt bei der Positionsregel', () => {
  // Der aeltere, registrierte Vertrag (Karl-Mandat 03.08.2026): "fehlendes Datum ist KEIN
  // Beweis". Ohne Enden greift M-A nicht — an beiden Rechenorten.
  const s = snapQ(steigend(6), null);
  assert.deepStrictEqual(snap.jahresVergleichIdx(s, 'revenueQ', 0), { idx: 4, quelle: 'position' });
  assert.notStrictEqual(axes.revQuartalsYoY(s), null, 'Rechenort 1 darf hier nicht greifen');
  assert.notStrictEqual(axes.revAcceleration(s, null), null, 'Rechenort 2 darf hier nicht greifen');
});

check('E2 F-4-KLAUSEL ist ENG — ein einziges vorhandenes Ende macht die Reihe strikt', () => {
  // Sonst waere die Klausel ein Freibrief fuer jedes Unmessbare, und das Gate praktisch aus
  // (gemessen: 1.660 statt 6 Zweig-Nutzer). Dieselben Werte wie E1, nur EIN Datum gesetzt.
  const s = snapQ(steigend(6), ['2026-03-31', null, null, null, null, null]);
  assert.strictEqual(axes.revQuartalsYoY(s), null, 'mit Enden-Reihe gilt strikt');
  assert.strictEqual(axes.revAcceleration(s, null), null, 'mit Enden-Reihe gilt strikt');
});

check('E3 die Klausel rettet KEINE datierte Reihe mit verletzter Kadenz', () => {
  const s = snapQ(steigend(5), endenAus('2026-06-30', [184, 91, 90, 92]));
  assert.strictEqual(axes.revQuartalsYoY(s), null, 'der 184-Tage-Eimer bleibt geblockt');
});

// ── D. periodeIstQuartal: drei Ausgaenge, nicht zwei ─────────────────────────

check('D1 true / false / null werden auseinandergehalten', () => {
  const s = snapQ(steigend(3), endenAus('2026-03-31', [90, 183]));
  assert.strictEqual(snap.periodeIstQuartal(s, 'revenueQ', 0), true, 'gemessen und im Band');
  assert.strictEqual(snap.periodeIstQuartal(s, 'revenueQ', 1), false, 'gemessen und ausserhalb');
  assert.strictEqual(snap.periodeIstQuartal(s, 'revenueQ', 2), null, 'aeltester Index: nicht messbar');
  assert.strictEqual(snap.periodeIstQuartal(s, 'revenueQ', 99), null, 'ausserhalb der Serie: nicht messbar');
});

console.log(fail ? `\n${fail} FAILED` : '\nalle gruen');
process.exit(fail ? 1 : 0);
