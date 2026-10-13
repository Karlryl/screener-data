'use strict';
/**
 * T179-NENNWERT (Befund `befund-t178-t179-evidenz-2026-08-30.md` §B1-B6, freigegeben als
 * ENTSCHIED 35 Punkt 2) — Waechter der Nennwert-Normalisierung in
 * `scripts/filter-snapshot-merge.js`.
 *
 * WAS AUF DEM SPIEL STEHT: N1 ist NICHT einseitig sicher. U1/U2 koennen eine Verschmelzung nur
 * VERHINDERN (ein schlechterer Name trennt); das Abschneiden hier macht Schluessel GLEICHER und
 * kann sie deshalb ERZWINGEN. Eine Fehlverschmelzung LOESCHT eine echte Firma aus dem Board,
 * eine ausbleibende kostet nur einen Platz. Die vier Wachen unten sind die Kipp-Bedingung aus
 * Befund §B5, in derselben Reihenfolge.
 *
 * ⚠ DIE WACHEN SITZEN AUF DER REINEN FUNKTION, nicht auf dem Live-Bestand: `nennwertStrip` und
 * `nennwertUmbenennungen` sind das, was spaeter wirklich entscheidet, und eine Fixture ist
 * reproduzierbar, waehrend der Bestand Wetter ist (Urteil T19: 133 -> 53 Doppelgaenger-Gruppen
 * in zwei Wochen ohne einen einzigen Fix).
 *
 * Standalone-Runner, keine Frameworks, kein Netz.
 * Run: node tests/t179-nennwert.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  nennwertStrip, nennwertUmbenennungen, wendeNennwertAn, NENNWERT_KUERZEL, NENNWERT_ANKER,
} = require('../scripts/filter-snapshot-merge.js');
// Die Produktionsregel selbst — die Wache misst am Schluessel, der spaeter wirklich gruppiert,
// nicht an einem Nachbau (Fehler F1334).
const { issuerKeyLoose } = require('../src/scoring/score.js');

let fehler = 0;
const pruefe = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { fehler++; console.error(`  FAIL ${name}\n       ${e.message}`); }
};
const schluessel = (name) => issuerKeyLoose({ meta: { name } });

/**
 * DIE ACHT ECHTEN NAMEN aus dem Live-Bestand (Vintage 2026-08-30, 15.040 Snapshots),
 * unabhaengig nachgemessen. Sie sind der Anker fuer Wache 1 und Wache 3.
 */
const ECHTE_TREFFER = [
  ['ANL.DE',  'ANALOG DEVICES INC.DL-166',  'ANALOG DEVICES INC'],
  ['D2MN.DE', 'DUKE EN.CORP.    DL -,001',  'DUKE EN.CORP.'],
  ['FIV.DE',  'FISERV INC.        DL-,01',  'FISERV INC.'],
  ['GE9.DE',  'GENMAB AS            DK 1',  'GENMAB AS'],
  ['3P7.DE',  'PANDORA A/S         DK 1',   'PANDORA A/S'],
  ['3SM.DE',  'SMITH -A.O.- CORP.   DL 1',  'SMITH -A.O.- CORP.'],
  ['472.DE',  'CELLNEX TELECOM SA EO-,25',  'CELLNEX TELECOM SA'],
  ['GBRA.DE', 'GEBERIT AG NA DISP. SF-10',  'GEBERIT AG NA DISP.'],
];

console.log('T179-Nennwert — Waechter');

/* ── WACHE 1 (Befund §B5.1) — ANWESENHEIT ────────────────────────────────────────────────
 * Ein Stand mit Nennwert-Anhaengsel und einer ohne muessen NACH N1 denselben
 * `issuerKeyLoose` liefern. Ohne diese Richtung waere der ganze Bau wirkungslos.
 * Absichtlich gebrochen: Anker `\s+` statt `(?:^|[\s.\-])` -> "ANALOG DEVICES INC.DL-166"
 * (kein Leerzeichen vor DL) bleibt stehen, Schluessel `analogdevicesincdl166` != `analogdevicesinc`, rot. */
pruefe('Wache 1 ANWESENHEIT: Anhaengsel-Stand und sauberer Stand teilen den Schluessel', () => {
  assert.equal(schluessel(nennwertStrip('TESTFIRMA AG DL-166')), schluessel(nennwertStrip('Testfirma AG')),
    'TESTFIRMA AG DL-166 und Testfirma AG muessen nach N1 denselben issuerKeyLoose tragen');
  // Der Top-100-Fall: das Kuerzel KLEBT am Vorwort, es gibt kein Leerzeichen vor `DL`.
  assert.equal(schluessel(nennwertStrip('ANALOG DEVICES INC.DL-166')), schluessel('Analog Devices, Inc.'),
    'der geklebte XETRA-Fall (ANL.DE/ADI, Board-Rang 21+22) muss schliessen');
  for (const [ticker, roh, erwartet] of ECHTE_TREFFER) {
    assert.equal(nennwertStrip(roh), erwartet, `${ticker}: ${JSON.stringify(roh)} -> ${JSON.stringify(erwartet)}`);
  }
});

/* ── WACHE 2 (Befund §B5.2) — ABWESENHEIT ────────────────────────────────────────────────
 * Die Regel ist am NAMENSENDE verankert. Ein Anhaengsel MITTEN im Namen, ein Kuerzel ohne
 * Zahl, ein nicht beobachtetes Kuerzel und ein Name ohne jedes Kuerzel bleiben unberuehrt.
 * Absichtlich gebrochen: `$` aus dem Muster entfernt -> "Sektor 7 DL 1 Holding AG" wird zu
 * "Sektor 7 Holding AG" und der Test ist rot. */
pruefe('Wache 2 ABWESENHEIT: mitten im Namen, ohne Zahl, fremdes Kuerzel, gar kein Kuerzel', () => {
  const unberuehrt = [
    'Sektor 7 DL 1 Holding AG',   // Anhaengsel MITTEN im Namen — der Fall aus Befund §B5.2
    'DL 1 Vorne Holding AG',      // ganz am Anfang
    'Testfirma AG DL',            // Kuerzel ohne Zahl
    'Testfirma AG SK-1',          // eines der SIEBEN bewusst NICHT aufgenommenen Kuerzel
    'Testfirma AG',               // gar kein Kuerzel
    'World Class Extractions Inc.',
    'BEIJING ONMICRO ELECTRONICS CO ', // nur Leerzeichen am Ende: KEIN Nennwert-Fall (s. u.)
  ];
  for (const n of unberuehrt) {
    assert.equal(nennwertStrip(n), n, `${JSON.stringify(n)} darf NICHT angefasst werden`);
  }
  // Nicht-Strings gehen unveraendert durch — `meta.name` kann fehlen.
  for (const n of [undefined, null, 42, {}]) assert.equal(nennwertStrip(n), n);
  // Ein Name, der NUR aus dem Anhaengsel besteht, bliebe sonst leer -> issuerKeyLoose === null.
  assert.equal(nennwertStrip('DL-166'), 'DL-166', 'ein leerer Name waere schlechter als der Feed-Artefakt');
});

/* ── WACHE 2b — die `test`-VORPRUEFUNG ───────────────────────────────────────────────────
 * Eigene Wache, weil sie einen eigenen Schaden verhindert: ohne die Vorpruefung schriebe der
 * blosse `.trim()` auch jeden Namen um, der nur ein Leerzeichen am Ende traegt. Am Live-Bestand
 * gemessen ist das `688790.SS` — 9 statt 8 Treffer, ein Schreibvorgang ohne Wirkung auf den
 * Schluessel und ein Anker, der bei jeder Feed-Schlamperei wandert.
 * Absichtlich gebrochen: `if (!NENNWERT_KUERZEL.test(name))` entfernt -> 9 statt 8, rot. */
pruefe('Wache 2b: blosse Rand-Leerzeichen sind KEIN Nennwert-Treffer', () => {
  assert.equal(NENNWERT_KUERZEL.test('BEIJING ONMICRO ELECTRONICS CO '), false);
  const staende = [
    { datei: 'A.json', name: 'BEIJING ONMICRO ELECTRONICS CO ' },
    { datei: 'B.json', name: '  Testfirma AG  ' },
  ];
  assert.equal(nennwertUmbenennungen(staende).size, 0,
    'Namen mit blossen Rand-Leerzeichen duerfen nicht in den Umbenennungsplan geraten');
});

/* ── WACHE 3 (Befund §B5.3) — NICHT-REGRESSION / ANKER ───────────────────────────────────
 * Die Zahl der Namen, die sich unter N1 aendern, ist am Live-Bestand 8. Jedes ANWACHSEN ist
 * ein Neubefund (jeder neue Treffer ist ein ungeprueftes Paar), kein stiller Normalzustand.
 * Absichtlich gebrochen: die sieben zusaetzlichen Kuerzel (SK NK LS YE HD CD RC) ins Muster
 * aufgenommen und `SK-1` in die Fixture gelegt -> 9 statt 8, rot. */
pruefe('Wache 3 ANKER: genau die 8 gemessenen Namen, kein neunter', () => {
  assert.equal(NENNWERT_ANKER, 8, 'der Anker ist die am 2026-08-30 gemessene Zahl');
  const staende = [
    ...ECHTE_TREFFER.map(([t, roh]) => ({ datei: `${t}.json`, name: roh })),
    // Die Nachbarschaft aus Befund §B2, die NICHT mitgerissen werden darf.
    { datei: 'ADI.json', name: 'Analog Devices, Inc.' },
    { datei: 'GMAB.json', name: 'Genmab A/S' },
    { datei: '688790.SS.json', name: 'BEIJING ONMICRO ELECTRONICS CO ' },
    { datei: 'X1.json', name: 'Testfirma AG SK-1' },
    { datei: 'X2.json', name: 'Testfirma AG NK 100' },
    { datei: 'X3.json', name: 'Muster ADR Inc.' },
    { datei: 'X4.json', name: 'Muster Holding O.N.' },
  ];
  const plan = nennwertUmbenennungen(staende);
  assert.equal(plan.size, NENNWERT_ANKER, `erwartet ${NENNWERT_ANKER} Treffer, bekommen ${plan.size}: ${[...plan.keys()].join(', ')}`);
  for (const [t] of ECHTE_TREFFER) assert.ok(plan.has(`${t}.json`), `${t} fehlt im Plan`);
});

/* ── WACHE 4 (Befund §B5.4) — FREMDPAAR-WACHE ────────────────────────────────────────────
 * Der EINZIGE tragende Beleg des Baus: keines der neuen Paare darf fundamental fremd sein.
 * Die Wache haelt die Regel offen fuer den Fall, in dem ein Zwei-Buchstaben-Kuerzel plus Zahl
 * am Namensende BEDEUTUNGSTRAGEND ist — dann verschmilzt N1 zwei verschiedene Firmen.
 * Absichtlich gebrochen: `nennwertStrip` auf `n.replace(/[^A-Za-z]+$/,'')` umgestellt ->
 * "Nordwerk DL 1" und "Nordwerk DL 2" (zwei Gattungen) kollabieren auf denselben Schluessel, rot. */
pruefe('Wache 4 FREMDPAAR: N1 darf nur die 3 belegten Gruppen schliessen, nicht die 2 offenen', () => {
  // Die drei Gruppen, die N1 laut Messung SCHLIESST.
  for (const [anhang, sauber] of [
    ['ANALOG DEVICES INC.DL-166', 'Analog Devices, Inc.'],
    ['FISERV INC.        DL-,01', 'Fiserv, Inc.'],
    ['GENMAB AS            DK 1', 'Genmab A/S'],
  ]) {
    assert.equal(schluessel(nennwertStrip(anhang)), schluessel(sauber), `${anhang} muss mit ${sauber} schliessen`);
  }
  // Die zwei Gruppen, die N1 NACHWEISLICH NICHT schliesst (Befund §B3, Auflage b): Wort-
  // Abkuerzung und Wortstellung. Wuerden sie hier gruen, haette jemand die Regel heimlich
  // erweitert — genau die Richtung, die Firmen loescht.
  assert.notEqual(schluessel(nennwertStrip('DUKE EN.CORP.    DL -,001')), schluessel('Duke Energy Corporation'),
    'D2MN.DE/DUK ist eine Wort-ABKUERZUNGS-Klasse und darf von N1 NICHT geschlossen werden');
  assert.notEqual(schluessel(nennwertStrip('SMITH -A.O.- CORP.   DL 1')), schluessel('A. O. Smith Corporation'),
    '3SM.DE/AOS ist eine WORTSTELLUNGS-Klasse und darf von N1 NICHT geschlossen werden');
  // DIE KIPP-BEDINGUNG SELBST (Befund §B5): N1 kippt, sobald ein Zwei-Buchstaben-Kuerzel plus
  // Zahl am Namensende BEDEUTUNGSTRAGEND ist. Genau deshalb ist die Regel auf die VIER
  // gemessenen Kuerzel beschraenkt und nicht auf "irgendzwei Buchstaben" verallgemeinert.
  // Am Live-Bestand 2026-08-30 nachgemessen: 0 Namen wuerden von der allgemeinen Fassung
  // zusaetzlich getroffen — die Verallgemeinerung kauft NICHTS und riskiert alles.
  // Unter der allgemeinen Fassung fielen die drei folgenden Namen auf EINEN Schluessel
  // zusammen und der Dedup loeschte zwei echte Firmen aus dem Board.
  const kipp = ['Sektor Beteiligungen SE 100', 'Sektor Beteiligungen KG 100', 'Sektor Beteiligungen'];
  for (const n of kipp.slice(0, 2)) assert.equal(nennwertStrip(n), n, `${JSON.stringify(n)} traegt ein bedeutungstragendes Kuerzel und darf nicht gekuerzt werden`);
  assert.equal(new Set(kipp.map((n) => schluessel(nennwertStrip(n)))).size, kipp.length,
    'drei verschiedene Emittenten muessen drei verschiedene Schluessel behalten');
});

/* ── WACHE 5 — I/O-MANTEL: kaputte Datei toetet den Schritt nicht, faellt aber laut auf ──
 * Absichtlich gebrochen: das try/catch in wendeNennwertAn entfernt -> Wurf statt Zaehler, rot. */
pruefe('Wache 5 I/O: kaputte Datei -> unlesbar+1, Rest wird trotzdem normalisiert', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't179-'));
  try {
    fs.writeFileSync(path.join(tmp, 'ANL.DE.json'), JSON.stringify({ meta: { name: 'ANALOG DEVICES INC.DL-166' } }));
    fs.writeFileSync(path.join(tmp, 'KAPUTT.json'), '{ das ist kein json');
    fs.writeFileSync(path.join(tmp, 'HEIL.json'), JSON.stringify({ meta: { name: 'Analog Devices, Inc.' } }));
    fs.writeFileSync(path.join(tmp, '_manifest.json'), '{}');
    const r = wendeNennwertAn(tmp, fs.readdirSync(tmp));
    assert.equal(r.unlesbar, 1, 'die kaputte Datei muss gezaehlt werden');
    assert.deepEqual(r.geheilt, ['ANL.DE'], 'der heile Treffer wird trotzdem normalisiert');
    assert.equal(r.unschreibbar, 0);
    const j = JSON.parse(fs.readFileSync(path.join(tmp, 'ANL.DE.json'), 'utf8'));
    assert.equal(j.meta.name, 'ANALOG DEVICES INC', 'der Name muss wirklich auf der Platte stehen');
    // Das Metadaten-File darf nicht als Kandidat gezaehlt werden.
    assert.equal(r.kandidaten, 2, 'nur echte Ticker-Staende sind Kandidaten');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

console.log(fehler ? `\nT179-Nennwert: ${fehler} Wache(n) ROT` : '\nT179-Nennwert: alle Wachen gruen');
process.exit(fehler ? 1 : 0);
