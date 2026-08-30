'use strict';
/**
 * Waechter T181 (Master-Task-Inbox) — zwei gekoppelte Sachen, in DIESER Reihenfolge:
 *
 *   (A) der Tag-226a-2-Schema-Melder entscheidet allein am Bilanz-Schluessel (!hasCA).
 *       Die alte ODER-Haelfte `!(hasSGA || hasDepr)` ist raus.
 *   (B) annualSGA / annualDepreciation / annualShares werden nach INHALT geschrieben
 *       (`_nonNullCount(...) > 0`), nicht nach LAENGE (`.length > 0`).
 *
 * WARUM DIE REIHENFOLGE DIE EIGENTLICHE SACHE IST: (B) allein waere ein Rueckschritt.
 * Die Wache laesst bei durchgehenden Null-Reihen den Schluessel weg; ein Melder, der
 * noch die LAENGE von annualSGA/annualDepreciation liest, wuerde diese Snapshots ab
 * dem naechsten Lauf als schema-stale melden. Der ausgeloeste Voll-Abruf schreibt
 * `canonical` komplett neu, die Wache unterdrueckt das Feld wieder — und der Melder
 * feuert erneut. Dauerhafte Voll-Abruf-Schleife, am Budget vorbei: exakt das Bug-13-
 * Muster, das im Code darueber schon dokumentiert ist. Gemessen waeren das 51 Namen.
 * Mit (A) VOR (B) ist der Netto-Effekt +0.
 *
 * MESSLAGE (Bestand 2026-08-29, am 30.08. unveraendert nachgemessen; 15.028 Snapshots
 * im Melder-Tor bzw. 15.044 mit annual-Block):
 *     Melder gesamt heute            149   |  !hasCA allein            149   MENGENGLEICH
 *     !(hasSGA||hasDepr) allein       16   |  davon eigener Beitrag      0   (tote Klausel)
 *     Null-Reihen  annualSGA 1.138 · annualDepreciation 849 · annualShares 10 (Union 1.944)
 *     schema-stale vorher 149  ->  nachher 149  (0 hinzu, 0 weg)
 *     Gegenprobe: Wachen OHNE Melder-Fix  ->  200  (+51, die Bug-13-Falle)
 *
 * WAS DIESER WAECHTER PINNT — die Sache, nicht ein Textmuster:
 *   1. den ECHTEN Melder: `_existingSnapshotMissingTag211lFields` wird aus pull-yahoo.js
 *      IMPORTIERT und AUFGERUFEN (dafuer wurde er auf Modul-Ebene gehoben). Ein Nachbau
 *      waere Fehler F1334 — der Waechter wuerde gegen eine andere Regel messen als die,
 *      die im Lauf wirklich entscheidet.
 *   2. ANWESENHEIT und ABWESENHEIT: der Melder muss bei fehlendem currentAssets feuern
 *      und bei vorhandenem Schluessel schweigen — sonst pinnt Punkt 1 nur eine Haelfte.
 *   3. die KOPPLUNG: genau die Snapshot-Form, die die Wachen aus (B) erzeugen
 *      (SGA/Depr-Schluessel weg, currentAssets da), darf NICHT stale sein.
 *   4. die VERDRAHTUNG der drei Wachen, an der Zuweisung aufgesucht statt an einer
 *      Zeilennummer (gleiche Lage/Begruendung wie tests/t142-…: die Zuweisungen liegen
 *      mitten im Netzwerkpfad von pullAll() und haben keinen aufrufbaren Einstieg).
 *   5. GEGENPROBEN: derselbe Parser an der ALTEN Fassung muss rot werden, sonst bliebe
 *      Punkt 4 auch dann gruen, wenn er gar nichts mehr findet.
 *
 * Usage:  node tests/t181-schema-melder-inhalts-wache.test.js   (Exit 0/1), netzwerkfrei.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
const { _existingSnapshotMissingTag211lFields: melder, _nonNullCount } = require('../pull-yahoo.js');

const FELDER = ['annualSGA', 'annualDepreciation', 'annualShares'];

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e.stack || e.message)); }
}

/** Snapshot-Form wie sie auf der Platte liegt; `annual` wird gezielt ueberschrieben. */
function snap(annual) {
  return { meta: { asOf: '2026-08-30' }, annual: Object.assign({ annualRev: [100, 90, 80] }, annual) };
}
const BILANZ_MIT_CA = [{ currentAssets: null, currentLiabilities: null, totalLiabilities: 5 }];
const BILANZ_OHNE_CA = [{ totalLiabilities: 5 }];

/**
 * Sucht die Bedingung, die unmittelbar vor `canonical.annual.<feld> = <variable>` steht.
 * Anker ist die ZUWEISUNG (das Objekt), nicht eine Zeilennummer und nicht der Wortlaut
 * der Bedingung — der Waechter ueberlebt jede Umformatierung, die die Sache nicht aendert.
 */
function bedingungVor(quelle, feld) {
  const variable = 'ftsAnnual' + feld.slice('annual'.length);
  const m = new RegExp(
    `if\\s*\\(([^\\n]*?)\\)\\s*canonical\\.annual\\.${feld}\\s*=\\s*${variable}\\s*;`,
  ).exec(quelle);
  if (m) return m[1].trim();
  const roh = new RegExp(`canonical\\.annual\\.${feld}\\s*=\\s*${variable}\\s*;`);
  assert.ok(roh.test(quelle),
    `${feld}: die Zuweisung canonical.annual.${feld} = ${variable} fehlt ganz — `
    + 'dann bekommt der Snapshot die Reihe nie.');
  return null;
}

// --- 1. Der ECHTE Melder ist aufrufbar --------------------------------------

test('der Schema-Melder ist exportiert (sonst misst dieser Waechter einen Nachbau)', () => {
  assert.equal(typeof melder, 'function',
    '_existingSnapshotMissingTag211lFields muss aus pull-yahoo.js exportiert sein — '
    + 'er wurde dafuer auf Modul-Ebene gehoben (F1334)');
});

// --- 2. ANWESENHEIT und ABWESENHEIT des Bilanz-Schluessels ------------------

test('feuert, wenn der currentAssets-SCHLUESSEL fehlt', () => {
  assert.equal(melder(snap({ annualBalance: BILANZ_OHNE_CA })), true,
    'ohne currentAssets-Schluessel ist der Snapshot vor-Tag-211l — der Melder MUSS feuern, '
    + 'sonst holt die Pipeline das Schema nie nach');
  assert.equal(melder(snap({ annualBalance: [] })), true, 'gar keine Bilanzzeilen');
  assert.equal(melder(snap({ annualBalance: [null] })), true,
    'EINE Zeile, und die ist null: keine Zeile traegt den Schluessel, also ist das Schema '
    + 'nicht nachweisbar aktuell. Bleibt stale — auch nach T182.');
  // T182 (30.08.2026): die Gegenrichtung, und sie ist der eigentliche Fix. Vorher fiel der
  // positionale bal[0]-Zugriff auf die null und meldete stale, obwohl die zweite Zeile den
  // Schluessel traegt — 131 der 149 Dauerschleifen hatten genau diese Form.
  assert.equal(melder(snap({ annualBalance: [null, { currentAssets: 120 }] })), false,
    'erste Zeile null, ZWEITE traegt den Schluessel: irgendeine Zeile mit dem Schluessel '
    + 'beweist den Voll-Abruf nach Tag 211l — der Melder darf hier NICHT mehr feuern');
  assert.equal(melder(snap({ annualBalance: [null, { umsatz: 1 }] })), true,
    'spaetere Zeile OHNE den Schluessel heilt nichts — sonst wuerde die Regel raten');
  assert.equal(melder(snap({ annualBalance: undefined })), true, 'annualBalance fehlt ganz');
});

// T182-Nachzug (Review-Fund 30.08.): die Sonde ist fail-open - wirft sie, gilt der Snapshot
// als "Schema aktuell". Das bleibt so (eine kaputte Sonde darf nicht 16.000 Voll-Abrufe
// ausloesen), ist aber ab jetzt gezaehlt und geloggt statt still.
// EHRLICHE GRENZE dieses Blocks: der Zaehler selbst ist modul-lokal und von aussen nicht
// lesbar - geprueft wird hier nur, dass das Verhalten fail-open BLEIBT. Die Sichtbarkeit
// haengt an der WARN-Zeile und der Lauf-Zusammenfassung, nicht an dieser Probe.
test('wirft die Sonde, bleibt sie fail-open (und faellt nicht durch)', () => {
  const kaputt = { annual: { annualRev: [1, 2, 3] } };
  Object.defineProperty(kaputt.annual, 'annualBalance', {
    get() { throw new Error('absichtlich kaputt'); },
  });
  assert.equal(melder(kaputt), false,
    'eine geworfene Sonde darf den Lauf nicht in 16.000 Voll-Abrufe kippen');
});

test('schweigt, wenn der currentAssets-SCHLUESSEL da ist — auch bei Wert null', () => {
  assert.equal(melder(snap({ annualBalance: BILANZ_MIT_CA })), false,
    'Bug 13: Banken/Versicherer tragen currentAssets:null. Der SCHLUESSEL ist das '
    + '"Schema ist aktuell"-Signal, nicht ein finiter Wert — sonst dauerhafte Voll-Abruf-Schleife');
});

test('die Vor-Tore bleiben unangetastet', () => {
  assert.equal(melder(null), false, 'kein Snapshot');
  assert.equal(melder({}), false, 'kein annual-Block');
  assert.equal(melder({ annual: { annualRev: [], annualBalance: BILANZ_OHNE_CA } }), false,
    'Price-only-Seed (kein annualRev): darf NICHT voll abgerufen werden, nur um Tag-211l-'
    + 'Felder nachzuruesten — der normale Altersablauf holt ihn ohnehin');
});

// --- 3. DIE KOPPLUNG: die tote Klausel ist raus -----------------------------

test('KERN T181: ohne SGA/Depr, aber mit currentAssets -> NICHT stale', () => {
  // Genau die Form, die die Wachen aus (B) ab dem naechsten Lauf auf die Platte legen.
  assert.equal(melder(snap({ annualBalance: BILANZ_MIT_CA })), false,
    'beide Schluessel ABWESEND + currentAssets da: mit der alten ODER-Klausel waere das '
    + 'stale gewesen — und beim naechsten Lauf wieder, und wieder (Bug-13-Schleife, '
    + 'gemessen 51 Namen). Der Melder darf SGA/Depr nicht mehr lesen.');
  assert.equal(melder(snap({ annualSGA: [], annualDepreciation: [], annualBalance: BILANZ_MIT_CA })), false,
    'leere Reihen statt fehlender Schluessel — dieselbe Sache');
  assert.equal(melder(snap({
    annualSGA: [null, null, null], annualDepreciation: [null, null], annualBalance: BILANZ_MIT_CA,
  })), false, 'durchgehende Null-Reihen (der Zustand von 1.944 Snapshots heute)');
});

test('KERN T181: SGA/Depr aendern die Entscheidung in KEINE Richtung mehr', () => {
  // Der scharfe Teil: nicht nur "ohne SGA nicht stale", sondern SGA/Depr sind fuer den
  // Melder komplett folgenlos. Ueber alle 4 Kombinationen x beide Bilanz-Zustaende.
  for (const bal of [BILANZ_MIT_CA, BILANZ_OHNE_CA]) {
    const erwartet = melder(snap({ annualBalance: bal }));
    for (const sga of [undefined, [], [null], [42]]) {
      for (const dep of [undefined, [], [null], [7]]) {
        const s = snap({ annualSGA: sga, annualDepreciation: dep, annualBalance: bal });
        assert.equal(melder(s), erwartet,
          `SGA=${JSON.stringify(sga)} Depr=${JSON.stringify(dep)} hat die Melder-Entscheidung `
          + 'gekippt — dann liest er die beiden Reihen wieder, und die Kopplung an die '
          + 'Schreib-Wachen ist zurueck.');
      }
    }
  }
});

test('Gegenprobe (absichtlicher Bruch): der alte Melder faellt bei genau diesem Fall auf', () => {
  // Ohne diese Probe koennte der Test oben auch dann gruen sein, wenn der Fall gar nichts
  // unterscheidet. Die ALTE Fassung woertlich nachgebaut — sie MUSS anders antworten.
  const alt = s => {
    const A = s && s.annual;
    if (!A || !(Array.isArray(A.annualRev) && A.annualRev.length > 0)) return false;
    const hasSGA = Array.isArray(A.annualSGA) && A.annualSGA.length > 0;
    const hasDepr = Array.isArray(A.annualDepreciation) && A.annualDepreciation.length > 0;
    const bal = A.annualBalance;
    const hasCA = Array.isArray(bal) && bal[0] && ('currentAssets' in bal[0]);
    return !(hasSGA || hasDepr) || !hasCA;
  };
  const nachWache = snap({ annualBalance: BILANZ_MIT_CA });
  assert.equal(alt(nachWache), true, 'der alte Melder muss hier feuern (sonst ist die Probe blind)');
  assert.equal(melder(nachWache), false, 'der neue Melder darf hier NICHT feuern');
});

// --- 4. Die VERDRAHTUNG der drei Schreib-Wachen -----------------------------

test('alle drei Reihen werden ueber _nonNullCount gewacht, nicht ueber .length', () => {
  assert.equal(typeof _nonNullCount, 'function', '_nonNullCount muss exportiert bleiben (T142)');
  for (const feld of FELDER) {
    const bed = bedingungVor(SRC, feld);
    assert.ok(bed !== null,
      `${feld}: die Zuweisung steht ohne Wache da — ein leerer FTS-Cache schreibt dann `
      + 'unbesehen ins Schema.');
    assert.ok(/_nonNullCount\s*\(/.test(bed),
      `${feld}: die Wache benutzt _nonNullCount nicht (steht da: "${bed}") — dann misst sie `
      + 'etwas anderes als der FTS-Merge daneben.');
    assert.ok(!/\.length\b/.test(bed),
      `${feld}: die Wache liest wieder die LAENGE (steht da: "${bed}") — genau der T181-Fund: `
      + '[null,null,null] hat Laenge 3 und schreibt ein durchgehend leeres Feld ins Schema.');
  }
});

test('_nonNullCount trennt Inhalt von Laenge — an den Formen dieser drei Reihen', () => {
  assert.equal(_nonNullCount([null, null, null]), 0,
    'DER Fall: drei Jahres-Platzhalter ohne einen einzigen Wert — Laenge 3, Inhalt 0');
  assert.equal(_nonNullCount([]), 0, 'leere Reihe');
  assert.equal(_nonNullCount([{ value: null }, { value: null }]), 0, '{value}-Huelle ohne Werte');
  assert.equal(_nonNullCount([null, 1.2e9, null]), 1, 'ein einziger Wert genuegt');
  assert.equal(_nonNullCount([0]), 1,
    'NULL IST EINE ZAHL: eine Firma mit belegten 0 Abschreibungen hat Daten, keine Luecke');
});

// --- 5. GEGENPROBEN am Parser ----------------------------------------------

test('Gegenprobe (absichtlicher Bruch): die alte .length-Fassung faellt auf', () => {
  const alt = SRC.replace(
    /if\s*\([^\n]*?\)\s*canonical\.annual\.annualSGA\s*=\s*ftsAnnualSGA\s*;/,
    'if ((ftsAnnualSGA || []).length > 0)          canonical.annual.annualSGA = ftsAnnualSGA;',
  );
  assert.notEqual(alt, SRC, 'die Ersetzung hat nicht gegriffen — die Gegenprobe waere wirkungslos');
  const bed = bedingungVor(alt, 'annualSGA');
  assert.ok(bed !== null && /\.length\b/.test(bed) && !/_nonNullCount\s*\(/.test(bed),
    'der Parser muss die alte Laengen-Wache als solche erkennen');
});

test('Gegenprobe (absichtlicher Bruch): eine ganz fehlende Zuweisung faellt auf', () => {
  const ohne = SRC.replace(
    /if\s*\([^\n]*?\)\s*canonical\.annual\.annualShares\s*=\s*ftsAnnualShares\s*;/,
    '',
  );
  assert.notEqual(ohne, SRC, 'die Ersetzung hat nicht gegriffen');
  assert.throws(() => bedingungVor(ohne, 'annualShares'),
    'eine verschwundene Zuweisung MUSS diesen Waechter rot machen');
});

console.log(`\nt181-schema-melder-inhalts-wache.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
