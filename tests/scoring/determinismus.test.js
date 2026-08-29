'use strict';
/**
 * Waechter: derselbe Code, dieselben Daten -> dasselbe Ergebnis.
 *
 * Karls Frage (19.08.2026): "kann bei zwei Laeufen ueber denselben Datenstand
 * Verschiedenes rauskommen?" Ist die Antwort nicht ueberpruefbar JA, ist jeder
 * Rangvergleich zwischen zwei Tagen wertlos — man wuesste nicht, ob sich der
 * Markt bewegt hat oder nur der Zufall.
 *
 * Der einzige realistische Kanal fuer "gleiche Daten, anderes Ergebnis" ist die
 * REIHENFOLGE der Eingabe: das Universum kommt aus fs.readdirSync (run-screener.js
 * loadUniverse), und die haengt am Dateisystem/Betriebssystem (CI-ubuntu != Windows).
 * Sortiert der Code irgendwo ohne eindeutigen Tie-Break, entscheidet die Eingabe-
 * reihenfolge ueber die Reihenfolge gleichstehender Zeilen. Genau das wird hier
 * gemessen, NICHT bloss "zweimal derselbe Aufruf" (der ist trivial gleich).
 *
 *   1) Reihenfolge-Invarianz: umgedrehtes/rotiertes Universum -> identische
 *      UNGERUNDETE Scores und identische Kohorten-Reihenfolge.
 *   2) Gleichstand: zwei Firmen mit exakt gleichem Score stehen ticker-alphabetisch,
 *      egal in welcher Reihenfolge sie hereinkommen (deterministischer Tie-Break).
 *   3) Selbstpruefung: der Vergleicher muss eine ECHTE Abweichung sehen. Ohne diese
 *      Probe koennte er stumpf sein und alles gruen melden.
 *
 * Usage:  node tests/scoring/determinismus.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { scoreUniverse, produceRankings } = require('../../src/scoring/score.js');
const formulas = require('../../src/scoring/formulas/index.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

const V = (arr) => arr.map((v) => ({ value: v }));
function semi(ticker, g) {
  const r0 = 100 * (1 + g / 100), gp0 = r0 * 0.5;
  return {
    meta: { sector: 'Technology', industry: 'Semiconductors', region: 'US', ticker },
    marketCap: { value: 5e9 },
    metrics: { revenueTTM: { value: r0 }, revenueGrowthYoY: { value: g }, fcfMarginTTM: { value: 0.12 } },
    annual: { annualRev: V([r0, 100, 80, 65]), annualGP: V([gp0, 50, 40, 33]),
      annualOpInc: V([r0 * 0.2, 18, 14, 10]), annualNetIncome: V([r0 * 0.15, 14, 11, 8]),
      annualFCF: V([r0 * 0.1, 9, 7, 5]), annualOCF: V([r0 * 0.12, 11, 9, 7]) },
    timeseries: {
      revenueQ: V([r0 / 4 * 1.05, r0 / 4, 24, 23, 22, 21, 20, 19]),
      opIncQ: V([r0 * 0.05, r0 * 0.048, 4.5, 4.3, 4.1, 3.9, 3.7, 3.5]),
      grossProfitQ: V([gp0 / 4 * 1.05, gp0 / 4, 12, 11.5, 11, 10.5, 10, 9.5]),
    },
  };
}

// 20 Namen mit gespreiztem Wachstum + ZWEI Zwillinge (identische Zahlen, nur anderer
// Ticker) -> echter Gleichstand, der Kandidat Nr. 1 fuer reihenfolgeabhaengige Raenge.
function baueUniversum() {
  const u = [];
  for (let i = 0; i < 20; i++) u.push(semi('PF' + String(i).padStart(2, '0'), 5 + i * 4));
  u.push(semi('ZWILLING_B', 41));
  u.push(semi('ZWILLING_A', 41));
  return u;
}

/**
 * Messbarer Abzug eines Laufs. Bewusst ALLE vier Listen, die produceRankings baut, nicht nur
 * die volle Kohorte: overview wird eigenstaendig aufgebaut und eigenstaendig sortiert,
 * survival sortiert sogar nach einem anderen Schluessel (Runway). Ein Reihenfolge-Fehler nur
 * in einem dieser Pfade waere sonst unsichtbar (Review-Befund 2, 19.08.2026).
 */
function abzug(universe) {
  const results = scoreUniverse(structuredClone(universe), formulas, {});
  const ranked = produceRankings(results, { topN: 100 });
  const zeilen = [];
  for (const e of results.slice().sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0))) {
    // reason gehoert dazu: derselbe Ticker kann in beiden Laeufen 'exclude' sein und trotzdem
    // aus verschiedenen Gruenden (dup-issuer vs. data-suspect) — das ist eine Abweichung.
    zeilen.push(['R', e.ticker, e.action, e.reason ?? '', e.formulaId ?? '', e.track ?? '',
      e.cohortN ?? '', e.cohortFallback ?? '',
      e.score === null || e.score === undefined ? 'null' : e.score.toPrecision(21)].join('|'));
  }
  for (const id of Object.keys(ranked.full).sort()) {
    for (const track of ['profitable', 'unprofitable']) {
      ((ranked.full[id] || {})[track] || []).forEach((r, i) => zeilen.push(['F', id, track, i + 1, r.ticker].join('|')));
      // die AUSGELIEFERTE, topN-gekappte Board-Liste getrennt mitfuehren — dass sie heute ein
      // Slice derselben Sortierung ist, ist Implementierungsdetail, kein Vertrag.
      (((ranked.branches || {})[id] || {})[track] || []).forEach((r, i) => zeilen.push(['B', id, track, i + 1, r.ticker].join('|')));
    }
  }
  (ranked.overview || []).forEach((r, i) => zeilen.push(['O', 'overview', r.formulaId ?? '', i + 1, r.ticker].join('|')));
  (ranked.survival || []).forEach((r, i) => zeilen.push(['S', 'survival', String(r.runwayQuarters ?? 'null'), i + 1, r.ticker].join('|')));
  return zeilen;
}

/**
 * Abweichungen zwischen zwei Abzuegen. 0 = identisch. Zaehlt Score UND Position getrennt.
 * Ein doppelt vergebener Schluessel INNERHALB eines Abzugs zaehlt selbst als Abweichung —
 * sonst wuerde eine Map die zweite Zeile still ueberschreiben und ein Duplikat-Bug (z.B.
 * Gross-/Kleinschreibungs-Kollision Linux/Windows) bliebe unsichtbar (Review-Befund 1).
 */
function vergleiche(a, b) {
  const sA = new Map(), sB = new Map(), pA = new Map(), pB = new Map();
  let doppelt = 0;
  const fuellen = (zeilen, s, p) => {
    for (const z of zeilen) {
      const t = z.split('|');
      if (t[0] === 'R') { if (s.has(t[1])) doppelt++; s.set(t[1], z); }
      else { const k = t[0] + '|' + t[1] + '|' + t[2] + '|' + t[4]; if (p.has(k)) doppelt++; p.set(k, Number(t[3])); }
    }
  };
  fuellen(a, sA, pA); fuellen(b, sB, pB);
  let score = doppelt, rang = 0, maxRang = 0;
  for (const [k, v] of sA) if (sB.get(k) !== v) score++;
  for (const k of sB.keys()) if (!sA.has(k)) score++;
  for (const [k, v] of pA) {
    const w = pB.get(k);
    if (w === undefined) { rang++; continue; }
    if (w !== v) { rang++; maxRang = Math.max(maxRang, Math.abs(w - v)); }
  }
  for (const k of pB.keys()) if (!pA.has(k)) rang++;
  return { score, rang, maxRang, doppelt };
}

const universum = baueUniversum();
const referenz = abzug(universum);

test('Setup: der Abzug deckt volle Kohorte, Board-Liste UND Uebersicht ab', () => {
  assert.ok(referenz.length > 40, 'Abzug zu duenn: ' + referenz.length);
  for (const [praefix, was] of [['F|semiconductors|profitable|', 'volle Kohorte'],
    ['B|semiconductors|profitable|', 'ausgelieferte Board-Liste'], ['O|overview|', 'Uebersicht']]) {
    assert.ok(referenz.some((z) => z.startsWith(praefix)), was + ' fehlt im Abzug');
  }
});

test('zweiter Lauf ueber dieselben Daten: 0 Score- und 0 Rangabweichungen', () => {
  const d = vergleiche(referenz, abzug(universum));
  assert.equal(d.score, 0, `${d.score} Zeilen mit anderem Score`);
  assert.equal(d.rang, 0, `${d.rang} Zeilen mit anderem Rang (max ${d.maxRang} Plaetze)`);
});

test('umgedrehte Eingabereihenfolge (anderes Dateisystem/OS): 0 Abweichungen', () => {
  const d = vergleiche(referenz, abzug(universum.slice().reverse()));
  assert.equal(d.score, 0, `${d.score} Zeilen mit anderem Score`);
  assert.equal(d.rang, 0, `${d.rang} Zeilen mit anderem Rang (max ${d.maxRang} Plaetze)`);
});

test('rotierte Eingabereihenfolge: 0 Abweichungen', () => {
  const rot = universum.slice(7).concat(universum.slice(0, 7));
  const d = vergleiche(referenz, abzug(rot));
  assert.equal(d.score, 0, `${d.score} Zeilen mit anderem Score`);
  assert.equal(d.rang, 0, `${d.rang} Zeilen mit anderem Rang (max ${d.maxRang} Plaetze)`);
});

test('Gleichstand: die Zwillinge stehen ticker-alphabetisch, in BEIDEN Eingabereihenfolgen', () => {
  const posVon = (zeilen, ticker) => {
    const treffer = zeilen.filter((z) => z.startsWith('F|') && z.endsWith('|' + ticker));
    assert.equal(treffer.length, 1, `${ticker} steht ${treffer.length}x in den vollen Kohorten (erwartet: genau 1x)`);
    return Number(treffer[0].split('|')[3]);
  };
  const vorwaerts = referenz, rueckwaerts = abzug(universum.slice().reverse());
  const aV = posVon(vorwaerts, 'ZWILLING_A'), bV = posVon(vorwaerts, 'ZWILLING_B');
  const aR = posVon(rueckwaerts, 'ZWILLING_A'), bR = posVon(rueckwaerts, 'ZWILLING_B');
  // Der Gleichstand muss echt sein, sonst prueft der Test nichts.
  const score = (zeilen, t) => zeilen.find((z) => z.startsWith('R|' + t + '|')).split('|').pop();
  assert.equal(score(vorwaerts, 'ZWILLING_A'), score(vorwaerts, 'ZWILLING_B'),
    'Zwillinge haben keinen identischen Score — der Gleichstands-Fall wird nicht geprueft');
  assert.ok(aV < bV, `A muss vor B stehen (vorwaerts: A=${aV}, B=${bV})`);
  assert.equal(aV, aR, `A wandert bei umgedrehter Eingabe (${aV} -> ${aR})`);
  assert.equal(bV, bR, `B wandert bei umgedrehter Eingabe (${bV} -> ${bR})`);
});

test('Selbstpruefung 1: eine ECHTE Datenaenderung wird vom Vergleicher gesehen', () => {
  const kaputt = structuredClone(universum);
  const ziel = kaputt.find((s) => s.meta.ticker === 'PF10');
  ziel.timeseries.revenueQ[0].value *= 2;   // ein einziger veraenderter Quartalsumsatz
  const d = vergleiche(referenz, abzug(kaputt));
  assert.ok(d.score > 0, 'Vergleicher ist blind: veraenderte Daten -> 0 Score-Abweichungen');
  assert.ok(d.rang > 0, 'Vergleicher ist blind: veraenderte Daten -> 0 Rangabweichungen');
});

test('Selbstpruefung 2: zwei Firmen, die die Plaetze tauschen, werden in JEDER Liste gesehen', () => {
  // Die Rangnummer steht als Feld in der Abzug-Zeile (nicht als Array-Position) — der reale
  // Fehlerfall ist deshalb "zwei Zeilen tragen die Rangnummer der jeweils anderen".
  for (const praefix of ['F|', 'B|', 'O|', 'S|']) {
    const idx = referenz.map((z, i) => i).filter((i) => referenz[i].startsWith(praefix));
    if (idx.length < 2) continue;   // Liste in diesem Fixture leer (z.B. survival) -> nichts zu tauschen
    const kopie = referenz.slice();
    const [i1, i2] = idx;
    const t1 = kopie[i1].split('|'), t2 = kopie[i2].split('|');
    const merk = t1[3]; t1[3] = t2[3]; t2[3] = merk;
    kopie[i1] = t1.join('|'); kopie[i2] = t2.join('|');
    const d = vergleiche(referenz, kopie);
    assert.ok(d.rang > 0, `Vergleicher ist blind fuer getauschte Raenge in der Liste '${praefix}'`);
  }
});

test('Selbstpruefung 3: ein doppelt vorkommender Ticker wird nicht stillschweigend geschluckt', () => {
  const dubletten = referenz.concat([referenz.find((z) => z.startsWith('R|'))]);
  const d = vergleiche(referenz, dubletten);
  assert.ok(d.doppelt > 0 && d.score > 0, 'Vergleicher ueberschreibt Duplikate still statt sie zu melden');
});

console.log(`\ndeterminismus: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
