#!/usr/bin/env node
/**
 * WAECHTER: Achsen-Redundanz (Court 29.07.2026, Teil T3 — 3 von 3 Richtern gehalten)
 *
 * WAS ER FESTNAGELT (die SACHE, nicht ein Schreibmuster):
 * Kein Achsenpaar der Scoring-Formel darf innerhalb der Kohorten so stark
 * korrelieren, dass eine Achse faktisch eine Kopie der anderen ist — es sei
 * denn, die Doppelung ist hier ausdruecklich als Waiver eingetragen und
 * begruendet. Gemessen wird an den ECHTEN Rohwerten aus der juengsten
 * calibration.json, nicht an Quelltext-Mustern: benennt jemand eine Achse um,
 * baut eine neue Doppelachse oder aendert eine Formel so, dass zwei Achsen
 * dasselbe messen, faellt es hier auf.
 *
 * ER IST BEIDSEITIG:
 *   (a) unwaivierte Doppelung  -> ROT (neue Redundanz eingeschleppt)
 *   (b) Waiver ohne Doppelung  -> ROT (Waiver ist verwaist, gehoert raus —
 *       sonst deckt eine alte Ausnahme spaeter eine neue Doppelung zu)
 *
 * ANLASS: Am 29.07.2026 ergab die Pruefung, dass `ruleOfX` per Konstruktion
 * `alpha * revGrowthLevel + FCF-Marge` ist und bei 41,1 % aller 5.677
 * gerouteten Zeilen (kein gueltiger FCF-Term) eine REINE Skalierung von
 * `revGrowthLevel` — also dasselbe Kohorten-Perzentil. Gemessen: Spearman
 * +0,945. Das ist der eine bekannte Fall; er steht unten als begruendeter
 * Waiver. Jeder WEITERE Fall soll auffallen, ohne dass ihn jemand suchen muss.
 *
 * ABSICHTLICHE BRUCHPROBE (Pflicht laut Court, siehe unten `--selbsttest`):
 *   node tests/scoring/achsen-redundanz.test.js --selbsttest
 * konstruiert eine kuenstlich verdoppelte Achse und erwartet, dass der Waechter
 * sie faengt — und entfernt den bekannten Waiver und erwartet, dass die
 * Verwaisungs-Regel greift. Faengt er nichts, ist der Waechter selbst kaputt.
 */

const fs = require('fs');
const path = require('path');

const SCHWELLE = 0.90;      // |rho| darueber = faktische Doppelung
const MIN_N = 30;           // Kohorten kleiner als das sind zu verrauscht
const MIN_KOHORTEN = 3;     // ein Paar braucht so viele auswertbare Kohorten

// --- Waiver: bekannte, ausdruecklich begruendete Doppelungen ----------------
// Ein Waiver ist eine ENTSCHEIDUNG, kein Stummschalter. Er nennt Grund und
// Datum; verschwindet die Doppelung, wird der Waiver ROT (verwaist).
const WAIVER = [
  {
    paar: ['revGrowthLevel', 'ruleOfX'],
    grund:
      'ruleOfX ist per Konstruktion alpha*revGrowthLevel + FCF-Marge (axes.js). ' +
      'Court 29.07.2026: DENIED fuer jeden Umbau — die Rangfolge wird dadurch ' +
      'nachweislich nicht besser (gewichtsneutraler Ausbau: Spearman 0,9957), und ' +
      'ein Vorher-Test auf "besser" existiert nicht. Wachstums-Dominanz ist ' +
      'dokumentierte Absicht. Wiedervorlage: siehe _URTEIL-FORMEL-UEBERLAPPUNG-2026-07-29.',
    seit: '2026-07-29',
  },
];

// --- Statistik --------------------------------------------------------------
function raenge(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const mittel = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = mittel;
    i = j + 1;
  }
  return r;
}

function pearson(a, b) {
  const n = a.length;
  if (n < 3) return null;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    sab += da * db; saa += da * da; sbb += db * db;
  }
  if (saa === 0 || sbb === 0) return null;   // konstante Achse: keine Aussage
  return sab / Math.sqrt(saa * sbb);
}

function spearman(a, b) {
  return pearson(raenge(a), raenge(b));
}

// --- Messung ----------------------------------------------------------------
function paarSchluessel(a, b) {
  return [a, b].sort().join(' ~ ');
}

/** Median |rho| je Achsenpaar ueber alle auswertbaren Kohorten. */
function messeRedundanz(cohortBases) {
  const proPaar = new Map();

  for (const [kohorte, eintrag] of Object.entries(cohortBases)) {
    const achsen = (eintrag && eintrag.axes) || {};
    const namen = Object.keys(achsen).filter((k) => Array.isArray(achsen[k]));
    for (let i = 0; i < namen.length; i++) {
      for (let j = i + 1; j < namen.length; j++) {
        const xs = achsen[namen[i]], ys = achsen[namen[j]];
        if (xs.length !== ys.length) continue;
        const a = [], b = [];
        for (let k = 0; k < xs.length; k++) {
          if (typeof xs[k] === 'number' && typeof ys[k] === 'number'
              && Number.isFinite(xs[k]) && Number.isFinite(ys[k])) {
            a.push(xs[k]); b.push(ys[k]);
          }
        }
        if (a.length < MIN_N) continue;
        const rho = spearman(a, b);
        if (rho === null) continue;
        const key = paarSchluessel(namen[i], namen[j]);
        if (!proPaar.has(key)) proPaar.set(key, []);
        proPaar.get(key).push({ kohorte, rho, n: a.length });
      }
    }
  }

  const ergebnis = [];
  for (const [key, messungen] of proPaar) {
    if (messungen.length < MIN_KOHORTEN) continue;
    const abs = messungen.map((m) => Math.abs(m.rho)).sort((x, y) => x - y);
    const mitte = Math.floor(abs.length / 2);
    const median = abs.length % 2 ? abs[mitte] : (abs[mitte - 1] + abs[mitte]) / 2;
    ergebnis.push({
      paar: key,
      medianAbsRho: median,
      kohorten: messungen.length,
      maxAbsRho: abs[abs.length - 1],
    });
  }
  ergebnis.sort((a, b) => b.medianAbsRho - a.medianAbsRho);
  return ergebnis;
}

function istGewaivert(paarKey) {
  return WAIVER.some((w) => paarSchluessel(w.paar[0], w.paar[1]) === paarKey);
}

/** Der eigentliche Wächter: liefert die Liste der Verstoesse. */
function pruefe(cohortBases, waiverListe = WAIVER) {
  const gemessen = messeRedundanz(cohortBases);
  const verstoesse = [];

  // (a) unwaivierte Doppelung
  for (const g of gemessen) {
    const gewaivert = waiverListe.some(
      (w) => paarSchluessel(w.paar[0], w.paar[1]) === g.paar
    );
    if (g.medianAbsRho > SCHWELLE && !gewaivert) {
      verstoesse.push({
        art: 'neue-doppelung',
        text: `${g.paar}: Median |rho| = ${g.medianAbsRho.toFixed(4)} ueber `
            + `${g.kohorten} Kohorten (Schwelle ${SCHWELLE}) — kein Waiver eingetragen.`,
      });
    }
  }

  // (b) verwaister Waiver
  for (const w of waiverListe) {
    const key = paarSchluessel(w.paar[0], w.paar[1]);
    const g = gemessen.find((x) => x.paar === key);
    if (!g) {
      verstoesse.push({
        art: 'waiver-ohne-messung',
        text: `Waiver fuer ${key} (seit ${w.seit}) — dieses Achsenpaar kommt in `
            + `der Kalibrierung nicht mehr auswertbar vor. Waiver entfernen.`,
      });
    } else if (g.medianAbsRho <= SCHWELLE) {
      verstoesse.push({
        art: 'waiver-verwaist',
        text: `Waiver fuer ${key} (seit ${w.seit}) ist verwaist: Median |rho| = `
            + `${g.medianAbsRho.toFixed(4)} liegt unter der Schwelle ${SCHWELLE}. `
            + `Die Doppelung ist weg — Waiver entfernen, sonst deckt er kuenftig `
            + `eine NEUE Doppelung desselben Paares zu.`,
      });
    }
  }

  return { gemessen, verstoesse };
}

// --- Datenquelle ------------------------------------------------------------
function juengsteKalibrierung() {
  const wurzel = path.join(__dirname, '..', '..', 'board-history');
  if (!fs.existsSync(wurzel)) return null;
  const tage = fs.readdirSync(wurzel)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  for (let i = tage.length - 1; i >= 0; i--) {
    const p = path.join(wurzel, tage[i], 'calibration.json');
    if (fs.existsSync(p)) return { pfad: p, datum: tage[i] };
  }
  return null;
}

// --- Selbsttest: den Waechter absichtlich kaputtmachen ----------------------
// Court-Auflage: ein Waechter, den niemand hat feuern sehen, ist kein Beleg.
function selbsttest() {
  const fehler = [];

  // Kuenstliche Kohorten: eine echte Achse und eine exakte Kopie davon.
  const n = 60;
  const basis = Array.from({ length: n }, (_, i) => Math.sin(i * 1.7) * 100);
  const unabhaengig = Array.from({ length: n }, (_, i) => Math.cos(i * 0.31) * 50);
  const kuenstlich = {};
  for (let k = 0; k < MIN_KOHORTEN; k++) {
    kuenstlich['test-kohorte-' + k] = {
      axes: {
        achseA: basis.slice(),
        achseAKopie: basis.map((v) => 2.3 * v),   // monotone Skalierung = Doppelung
        achseB: unabhaengig.slice(),
      },
    };
  }

  // (1) Faengt er eine neue Doppelung ohne Waiver?
  const r1 = pruefe(kuenstlich, []);
  if (!r1.verstoesse.some((v) => v.art === 'neue-doppelung')) {
    fehler.push('BRUCHPROBE 1 FEHLGESCHLAGEN: verdoppelte Achse wurde NICHT gefangen.');
  }

  // (2) Schweigt er, wenn genau diese Doppelung gewaivert ist?
  const r2 = pruefe(kuenstlich, [{ paar: ['achseA', 'achseAKopie'], grund: 'test', seit: '2026-07-29' }]);
  if (r2.verstoesse.some((v) => v.art === 'neue-doppelung')) {
    fehler.push('BRUCHPROBE 2 FEHLGESCHLAGEN: gewaivertes Paar loeste trotzdem aus '
              + '(dann waere jeder Waiver wirkungslos).');
  }

  // (3) Faengt er einen VERWAISTEN Waiver auf ein unkorreliertes Paar?
  const r3 = pruefe(kuenstlich, [{ paar: ['achseA', 'achseB'], grund: 'test', seit: '2026-07-29' }]);
  if (!r3.verstoesse.some((v) => v.art === 'waiver-verwaist')) {
    fehler.push('BRUCHPROBE 3 FEHLGESCHLAGEN: verwaister Waiver wurde NICHT gemeldet.');
  }

  // (4) Faengt er einen Waiver auf ein Paar, das es gar nicht gibt?
  const r4 = pruefe(kuenstlich, [{ paar: ['gibtEsNicht', 'auchNicht'], grund: 'test', seit: '2026-07-29' }]);
  if (!r4.verstoesse.some((v) => v.art === 'waiver-ohne-messung')) {
    fehler.push('BRUCHPROBE 4 FEHLGESCHLAGEN: Waiver auf nicht existierendes Paar blieb still.');
  }

  return fehler;
}

// --- Lauf -------------------------------------------------------------------
const nurSelbsttest = process.argv.includes('--selbsttest');
let fehlgeschlagen = 0;

const bruchproben = selbsttest();
if (bruchproben.length) {
  fehlgeschlagen += bruchproben.length;
  for (const f of bruchproben) console.error('  x ' + f);
} else {
  console.log('  ok Bruchproben 1-4: der Waechter feuert, wenn er soll, und schweigt, wenn er soll.');
}

if (!nurSelbsttest) {
  const quelle = juengsteKalibrierung();
  if (!quelle) {
    console.log('  - keine board-history/<datum>/calibration.json gefunden — uebersprungen.');
  } else {
    const cal = JSON.parse(fs.readFileSync(quelle.pfad, 'utf8'));
    const cohortBases = cal.cohortBases || {};
    const anzahl = Object.keys(cohortBases).length;
    if (!anzahl) {
      console.error(`  x ${quelle.datum}/calibration.json enthaelt keine cohortBases — `
                  + 'der Waechter haette hier still nichts geprueft.');
      fehlgeschlagen++;
    } else {
      const { gemessen, verstoesse } = pruefe(cohortBases);
      console.log(`  i Kalibrierung ${quelle.datum}: ${anzahl} Kohorten, `
                + `${gemessen.length} auswertbare Achsenpaare.`);
      const top = gemessen.slice(0, 3)
        .map((g) => `${g.paar}=${g.medianAbsRho.toFixed(3)}`).join('  ');
      if (top) console.log('  i staerkste Paare (Median |rho|): ' + top);
      if (verstoesse.length) {
        fehlgeschlagen += verstoesse.length;
        for (const v of verstoesse) console.error('  x ' + v.text);
      } else {
        console.log('  ok keine unwaivierte Achsen-Doppelung, kein verwaister Waiver.');
      }
    }
  }
}

if (fehlgeschlagen) {
  console.error(`\n::error::achsen-redundanz: ${fehlgeschlagen} Verstoss/Verstoesse — `
              + 'entweder ist eine neue Doppelung in die Formel gekommen oder ein '
              + 'Waiver ist verwaist. Beides gehoert entschieden, nicht weggeklickt.');
  process.exit(1);
}
console.log('achsen-redundanz: GRUEN');
process.exit(0);
