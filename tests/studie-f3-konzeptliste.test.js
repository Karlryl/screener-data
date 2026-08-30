'use strict';

// Studie 2.0, Phase F3a — der Waechter ueber der eingefrorenen Konzeptliste.
//
// DIE SACHE: protocol/early-detection/2.1.0/konzeptliste.json friert die in F1
// mechanisch erzeugte und in F2 beschlossene Vierer-Liste ein. Vier Eigenschaften
// muessen Eigenschaften der BYTES sein, nicht Versprechen des Textes:
//
//   (a) die Liste enthaelt exakt diese vier Kennungen und keine fuenfte. Eine
//       stille fuenfte Kennung waere eine Konzeptwahl NACH dem Beschluss.
//   (b) die ausgewiesenen Hashes stimmen mit den nachgerechneten ueberein — und
//       der Listen-Hash ist derselbe, den F1 vor F2 eingefroren hat. Gleicher
//       Hash = bit-identisch dieselbe Liste.
//   (c) der Dissens D9 und der Scope-Satz stehen woertlich da. Beides ist genau
//       das, was ein geglaettetes Protokoll als Erstes verliert.
//   (d) der Eintritts-Modus steht auf reinem Fallback. Modus (a) oeffnet einen
//       im Code belegten Rueckwaerts-Kanal auf die Signalwerte selbst.
//
// JEDE WACHE WIRD HIER AUCH IN IHRER ABWESENHEIT GEPRUEFT: die Pruefung laeuft
// einmal auf der echten Datei (gruen) und einmal auf einer im Speicher
// manipulierten Kopie (muss werfen). Ein Waechter, der nur die Anwesenheit sieht,
// ist nach der ersten Glaettung gruen und wertlos.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const ARTEFAKT = path.join(REPO, 'protocol', 'early-detection', '2.1.0', 'konzeptliste.json');

// Die vier Kennungen des F2-Beschlusses, hier unabhaengig vom Artefakt notiert.
// Eine Liste, die sich ihre eigene Sollmenge mitbringt, prueft nichts.
const KENNUNGEN = [
  'us-gaap:InterestAndDividendIncomeOperating',
  'us-gaap:OilAndGasRevenue',
  'us-gaap:RealEstateRevenueNet',
  'us-gaap:RegulatedAndUnregulatedOperatingRevenue',
].sort();

// Der in F1 VOR dem Blick von F2 eingefrorene Listen-Hash. Zweite, aussenstehende
// Meinung: das Artefakt darf seinen eigenen Hash nicht allein bestimmen.
const F1_LISTEN_SHA256 = '88ba14a298837bcc6287c4f52a3ba61296b6ba56d96ba78cba0470335df99247';

const lies = () => JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
const kopie = (objekt) => JSON.parse(JSON.stringify(objekt));

// Genau die Kanonisierung des F1-Werkzeugs: Schluessel sortiert, keine
// Leerzeichen, Nicht-ASCII nicht escaped, UTF-8. Nur so faellt derselbe Hash
// heraus wie in scripts/studie-f1-konzeptregel.py.
function kanonisch(wert) {
  if (Array.isArray(wert)) return `[${wert.map(kanonisch).join(',')}]`;
  if (wert && typeof wert === 'object') {
    return `{${Object.keys(wert).sort()
      .map((schluessel) => `${JSON.stringify(schluessel)}:${kanonisch(wert[schluessel])}`)
      .join(',')}}`;
  }
  return JSON.stringify(wert);
}

const sha256Text = (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

// --- die vier Wachen, als Funktionen, damit jede gegen eine Kopie laufen kann ---

function wacheKennungen(inhalt) {
  const gefunden = inhalt.konzeptliste.map((e) => `${e.taxonomy}:${e.concept}`).sort();
  assert.deepEqual(gefunden, KENNUNGEN, 'die Konzeptliste ist nicht die beschlossene Vierer-Liste');
  // Absicherung gegen die Doppelung, die deepEqual auf sortierten Listen sonst sieht:
  assert.equal(new Set(gefunden).size, 4, 'eine Kennung steht doppelt in der Liste');
  // Keine der vom Urteil ausgeschlossenen Kennungen darf durch die Hintertuer
  // wieder auftauchen — das Artefakt fuehrt sie namentlich.
  const ausgeschlossen = inhalt.ausschluesse.map((e) => e.kennung);
  assert.ok(ausgeschlossen.length >= 5, 'die Ausschlussliste ist verkuerzt');
  for (const kennung of ausgeschlossen) {
    assert.ok(!gefunden.includes(kennung), `ausgeschlossene Kennung in der Liste: ${kennung}`);
  }
}

function wacheHashes(inhalt) {
  const listeGerechnet = sha256Text(kanonisch(inhalt.konzeptliste));
  assert.equal(listeGerechnet, inhalt.konzeptlisteSha256,
    'ausgewiesener und nachgerechneter Listen-Hash laufen auseinander');
  assert.equal(listeGerechnet, F1_LISTEN_SHA256,
    'die Liste ist nicht mehr bit-identisch die in F1 eingefrorene');
  assert.equal(inhalt.hashRechenweg.konzeptliste.erwartet, listeGerechnet,
    'der dokumentierte Rechenweg nennt einen anderen Wert als das Feld');

  const textGerechnet = sha256Text(inhalt.kontaminationsVorgeschichte);
  assert.equal(textGerechnet, inhalt.kontaminationsVorgeschichteSha256,
    'ausgewiesener und nachgerechneter Hash der Kontaminations-Vorgeschichte laufen auseinander');
  assert.equal(inhalt.hashRechenweg.kontaminationsVorgeschichte.erwartet, textGerechnet,
    'der dokumentierte Rechenweg nennt einen anderen Wert als das Feld');
}

function wacheWortlaut(inhalt) {
  // Die Kontaminations-Vorgeschichte, woertlich (K3 Bedingung 5 / A16).
  assert.match(inhalt.kontaminationsVorgeschichte,
    /Diese Konzeptliste entsteht in Kenntnis eines gerissenen Tors bei 89,32 %/);
  assert.match(inhalt.kontaminationsVorgeschichte, /330\/365 = 90,411 %/);
  assert.match(inhalt.kontaminationsVorgeschichte, /A18/);

  // Der Dissens D9 — offen, woertlich, mit Messtermin vor F5b.
  const d9 = inhalt.dissens.find((e) => e.id === 'D9');
  assert.ok(d9, 'der Dissens D9 fehlt');
  assert.equal(d9.offen, true, 'D9 ist als geschlossen ausgewiesen');
  assert.match(d9.messtermin, /F5b/, 'D9 traegt keinen Messtermin vor F5b');
  const woertlich = d9.woertlich.join('\n');
  assert.match(woertlich, /1:3 bestritten/);
  assert.match(woertlich, /eine Regel aendert man vor den Zahlen oder gar nicht/);
  assert.match(woertlich, /Der Dissens D9 bleibt bestehen und wird nicht geglaettet/);
  assert.match(woertlich, /Rettungs-Untergrenze/);
  assert.equal(d9.unterschreitung.ciksRettung, 10, 'die protokollierte Z0-Unterschreitung fehlt');

  // Der Scope-Satz: IFRS ist eine Grenze, keine geschlossene Luecke.
  assert.match(inhalt.scopeSatz,
    /IFRS-Melder sind damit keine Luecke, die wir schliessen, sondern eine Grenze des Geltungsbereichs/);
}

function wacheEintrittsModus(inhalt) {
  assert.equal(inhalt.eintrittsModus.modus, 'b_reiner_fallback',
    'der Eintritts-Modus steht nicht auf reinem Fallback');
  assert.match(inhalt.eintrittsModus.regel,
    /greift NUR, wenn die Firma keine akzeptierte Reihe hat/);
  // Der Modus steht an JEDEM Listeneintrag, nicht nur im Kopf: die Liste reist
  // weiter, der Kopf bleibt hier.
  for (const eintrag of inhalt.konzeptliste) {
    assert.equal(eintrag.eintrittsModus, 'reiner_fallback',
      `${eintrag.concept} traegt einen anderen Eintritts-Modus`);
    assert.equal(eintrag.brutto, true, `${eintrag.concept} ist nicht auf brutto gestellt`);
  }
  // Rang-4-Sperre und Bank-Stratum haengen daran: nur die Bank-Kennung ist Zins.
  const bank = inhalt.konzeptliste.find((e) => e.concept === 'InterestAndDividendIncomeOperating');
  assert.equal(bank.eigenesStratum, true, 'die Bank-Kennung laeuft nicht als eigenes Stratum');
  assert.deepEqual(bank.entityKlassen, ['bank']);
  assert.match(inhalt.rang4Sperre.satz,
    /Zins-Teilposten sind nie Umsatz ausserhalb des Bank-\/Zins-Stratums/);
  assert.match(inhalt.bankStratum.surrogatNullmodell, /ZEIT block-gebootstrappt/);
}

// --- Anwesenheit: die echte Datei ------------------------------------------

const ECHT = lies();

test('F3a (a): die Liste traegt exakt die vier beschlossenen Kennungen', () => {
  wacheKennungen(ECHT);
});

test('F3a (b): ausgewiesene und nachgerechnete Hashes stimmen ueberein', () => {
  wacheHashes(ECHT);
});

test('F3a (c): Dissens D9 und Scope-Satz stehen woertlich da', () => {
  wacheWortlaut(ECHT);
});

test('F3a (d): der Eintritts-Modus steht auf reinem Fallback', () => {
  wacheEintrittsModus(ECHT);
});

test('F3a: 2.1.0 ist eine eigene Version, kein Nachtrag zu 2.0.0', () => {
  assert.equal(ECHT.version, '2.1.0');
  assert.match(ECHT.eigeneVersion.satz, /KEIN Nachtrag zu 2\.0\.0/);
  // F3a schreibt keinen Register-Eintrag — das ist F3b.
  assert.ok(ECHT.wasF3aNichtTut.some((z) => /outcome-access-ledger\.json/.test(z)),
    'die Abgrenzung gegen den Register-Eintrag 21 fehlt');
});

// --- Abwesenheit: jede Wache muss rot werden koennen ------------------------

test('F3a: Gegenprobe (a) — eine fuenfte Kennung fliegt auf', () => {
  const kaputt = kopie(ECHT);
  kaputt.konzeptliste.push({
    taxonomy: 'us-gaap',
    concept: 'RevenueFromRelatedParties',
    entityKlassen: ['operativ'],
    eintrittsModus: 'reiner_fallback',
    brutto: true,
    eigenesStratum: false,
  });
  assert.throws(() => wacheKennungen(kaputt), /Vierer-Liste/);
});

test('F3a: Gegenprobe (b) — ein veraenderter Listeneintrag bricht den Hash', () => {
  const kaputt = kopie(ECHT);
  kaputt.konzeptliste[0].entityKlassen = ['bank', 'operativ'];
  assert.throws(() => wacheHashes(kaputt), /Listen-Hash laufen auseinander/);
  // Und die zweite Haelfte getrennt: ein geglaetteter Kontaminationstext.
  const zweit = kopie(ECHT);
  zweit.kontaminationsVorgeschichte = zweit.kontaminationsVorgeschichte.replace('89,32 %', '90 %');
  assert.throws(() => wacheHashes(zweit), /Kontaminations-Vorgeschichte laufen auseinander/);
});

test('F3a: Gegenprobe (c) — ein geglaetteter Dissens und ein fehlender Scope-Satz fliegen auf', () => {
  const ohneDissens = kopie(ECHT);
  ohneDissens.dissens = ohneDissens.dissens.filter((e) => e.id !== 'D9');
  assert.throws(() => wacheWortlaut(ohneDissens), /Dissens D9 fehlt/);

  const geglaettet = kopie(ECHT);
  const d9 = geglaettet.dissens.find((e) => e.id === 'D9');
  d9.offen = false;
  d9.woertlich = ['Die Versorger-Kennung wurde nach Abwaegung aufgenommen.'];
  assert.throws(() => wacheWortlaut(geglaettet));

  const ohneScope = kopie(ECHT);
  ohneScope.scopeSatz = 'IFRS-Melder werden spaeter ergaenzt.';
  assert.throws(() => wacheWortlaut(ohneScope), /Grenze des Geltungsbereichs/);
});

test('F3a: Gegenprobe (d) — Modus (a) faellt durch, im Kopf wie an der Liste', () => {
  const kopfKaputt = kopie(ECHT);
  kopfKaputt.eintrittsModus.modus = 'a_neuer_rang';
  assert.throws(() => wacheEintrittsModus(kopfKaputt), /nicht auf reinem Fallback/);

  const listeKaputt = kopie(ECHT);
  listeKaputt.konzeptliste[1].eintrittsModus = 'neuer_rang';
  assert.throws(() => wacheEintrittsModus(listeKaputt), /anderen Eintritts-Modus/);
});

test('F3a: die Kanonisierung selbst kann daneben liegen', () => {
  // Ohne diese Probe wuesste niemand, ob der Nachrechen-Weg ueberhaupt etwas
  // misst: gleiche Schluessel in anderer Reihenfolge muessen denselben Hash
  // ergeben, ein anderer Wert einen anderen.
  assert.equal(kanonisch({ b: 1, a: [true, 'x'] }), kanonisch({ a: [true, 'x'], b: 1 }));
  assert.notEqual(kanonisch({ a: 1 }), kanonisch({ a: '1' }));
  assert.equal(sha256Text(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});
