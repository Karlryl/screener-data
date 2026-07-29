#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Trefferquote des einmalertrag-Erkenners — ohne Prognose, ohne Netz, ohne Zirkel.
//
// DIE FRAGE (Karls A-Punkt, Vorbedingung vor jedem Bau): der Erkenner brennt
// heute bei 53 von 5.848 Kohortenzeilen, wirkt aber nirgends im Score. Bevor
// irgendetwas an ihn gehängt wird: stimmt er überhaupt?
//
// WARUM NICHT DIE ANALYSTEN-PROGNOSE ALS MASSSTAB: sie ist die vorgeschlagene
// REGEL. Eine Regel mit sich selbst zu prüfen ist zirkulär. Der unabhängige
// Maßstab steht in den Daten selbst: was ist im Quartal DANACH passiert?
//
// DER AUFBAU — Fenster um ein Quartal zurückschieben:
//   Reihe (neueste zuerst):  [ Q0 | Q1 Q2 Q3 Q4 ... ]
//                              ^     ^^^^^^^^^^^
//                          Zukunft   was der Erkenner sieht
// Der Erkenner urteilt über Q1..Q4 und hat Q0 NIE gesehen. Q0 ist damit ein
// echter Blindtest: sagt der Erkenner "der Ausreisser in diesem Fenster ist
// nicht wiederholbar", muss Q0 auf das Niveau der übrigen Quartale zurückfallen.
//
// ⛔ WIDERLEGT AM 29.07. ABENDS, WENIGE STUNDEN NACH DEM SCHREIBEN. Die unten
// gerechnete "Trefferquote 78,6 % gegen Basisrate 44,9 %" ist ZIRKULÄR und darf
// NICHT mehr zitiert werden. Der Grund steht in Abschnitt [3b] der Ausgabe und
// wird bei jedem Lauf mitgerechnet — das Skript widerlegt sich selbst, statt die
// Zahl still stehen zu lassen. Gefunden hat es eine unabhängige Gegenrechnung,
// nicht ich.
//
// KURZ: das Erfolgskriterium hängt vom Flag-Kriterium ab. Geflaggt heisst
// "Spitze A ist riesig gegen Basis B"; die Trennlinie liegt bei B + 0,5·(A−B)
// und wandert damit MIT A nach oben. Eine geflaggte Zeile muss also viel weniger
// weit fallen, um als "zurückgefallen" zu zählen: Latte im Median 3,74·B gegen
// 1,05·B bei den sauberen. Legt man beiden Gruppen DIESELBE Latte an, dreht sich
// das Vorzeichen um.
//
// DAS URTEIL, vorab festgelegt (keine nachträgliche Schwellensuche):
//   Ausreisser A = groesstes Quartal im Fenster
//   Basis B      = Median der drei uebrigen Fensterquartale
//   ZURUECKGEFALLEN, wenn Q0 < (A + B) / 2 — also naeher an der Basis als am
//   Ausreisser. Die Mitte ist die neutrale Trennlinie und nicht gewaehlt, um
//   ein Ergebnis zu erzeugen; die Empfindlichkeit dieser Wahl wird unten
//   ausgewiesen (dieselbe Rechnung mit 0,25 und 0,75 statt 0,5).
//
// WAS OHNE VERGLEICHSGROESSE WERTLOS WAERE: eine Trefferquote allein sagt
// nichts. Wenn Quartalsumsaetze ohnehin meistens schwanken, faellt auch eine
// zufaellige Zeile "zurueck". Deshalb steht neben der Trefferquote IMMER die
// Basisrate aller nicht geflaggten Zeilen mit vergleichbarer Reihe — der
// Erkenner ist nur so viel wert wie sein Abstand dazu.
//
// DATENLAGE, ungeschoent: gelesen wird der LOKALE snapshots/-Bestand. Der ist
// gitignored, stammt aus frueheren Laeufen (Mai/Juni 2026) und ist mit ~4.800
// Dateien kleiner als das CI-Universum (~12.500). Fuer diese Frage ist das
// zulaessig, weil hier die MECHANIK des Erkenners geprueft wird und nicht ein
// Tagesbestand — aber es ist ausdruecklich KEINE Aussage ueber das heutige
// Universum, und es darf daraus keine Waechter-Basis abgeleitet werden (der
// Fehler vom Vormittag, F1172).
//
// Reine Diagnose: liest nur, schreibt nur nach stdout, kein Netz.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { norm } = require('../src/scoring/snapshot.js');
const { einmalertrag } = require('../src/scoring/lamps.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const SNAP_DIR = path.join(REPO_ROOT, 'snapshots');
const MITTE = 0.5;

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (z, n) => (n ? (100 * z / n).toFixed(1) + ' %' : '—');

// Ein Snapshot-Gerippe, das nur die verschobene Reihe traegt. norm() liest
// snapshot.timeseries.revenueQ und mappt .value — hier nachgesehen, nicht geraten
// (src/scoring/snapshot.js:65 ff., FIELD_REGISTRY-Eintrag 'value').
const alsSnapshot = (werte) => ({ timeseries: { revenueQ: werte.map((v) => ({ value: v })) } });

function auswerten(reihe, lage) {
  const fenster = reihe.slice(1);
  if (fenster.length < 4) return null;
  const vier = fenster.slice(0, 4);
  if (!vier.every((v) => Number.isFinite(v) && v > 0)) return null;
  const zukunft = reihe[0];
  if (!Number.isFinite(zukunft) || zukunft <= 0) return null;

  const geflaggt = einmalertrag(alsSnapshot(fenster));
  if (geflaggt === null) return null;   // nicht bewertbar zaehlt nicht als "sauber"

  const A = Math.max(...vier);
  const B = median(vier.filter((v) => v !== A).concat(vier.filter((v) => v === A).slice(1)).slice(0, 3));
  if (!(A > B)) return null;            // ohne Ausreisser gibt es nichts zu pruefen
  const grenze = B + lage * (A - B);
  return { geflaggt, zurueckgefallen: zukunft < grenze, A, B, zukunft };
}

function lauf(lage) {
  const dateien = fs.readdirSync(SNAP_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  const z = { geflaggtZurueck: 0, geflaggtGehalten: 0, sauberZurueck: 0, sauberGehalten: 0, unbewertbar: 0 };
  const beispiele = { treffer: [], fehlalarm: [] };
  for (const f of dateien) {
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch (_) { continue; }
    let reihe;
    try { reihe = norm(s, 'revenueQ'); } catch (_) { continue; }
    if (!Array.isArray(reihe) || reihe.length < 5) { z.unbewertbar++; continue; }
    const r = auswerten(reihe, lage);
    if (!r) { z.unbewertbar++; continue; }
    const t = f.replace(/\.json$/, '');
    if (r.geflaggt) {
      if (r.zurueckgefallen) { z.geflaggtZurueck++; if (beispiele.treffer.length < 6) beispiele.treffer.push(`${t} (Spitze ${(r.A / 1e6).toFixed(0)} Mio -> danach ${(r.zukunft / 1e6).toFixed(0)} Mio, Basis ${(r.B / 1e6).toFixed(0)})`); }
      else { z.geflaggtGehalten++; if (beispiele.fehlalarm.length < 6) beispiele.fehlalarm.push(`${t} (Spitze ${(r.A / 1e6).toFixed(0)} Mio -> danach ${(r.zukunft / 1e6).toFixed(0)} Mio, Basis ${(r.B / 1e6).toFixed(0)})`); }
    } else {
      if (r.zurueckgefallen) z.sauberZurueck++; else z.sauberGehalten++;
    }
  }
  return { z, beispiele, dateien: dateien.length };
}

function main() {
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(' einmalertrag-Erkenner — Blindtest gegen das Folgequartal');
  console.log('══════════════════════════════════════════════════════════════════');

  const { z, beispiele, dateien } = lauf(MITTE);
  const geflaggt = z.geflaggtZurueck + z.geflaggtGehalten;
  const sauber = z.sauberZurueck + z.sauberGehalten;

  console.log(`\n[1] BESTAND  ${dateien} Snapshots gelesen, davon ${z.unbewertbar} ohne verwertbare 5-Quartals-Reihe`);
  console.log(`    auswertbar: ${geflaggt + sauber}  (geflaggt ${geflaggt} · nicht geflaggt ${sauber})`);

  console.log('\n[2] BLINDTEST — ist das Folgequartal auf die Basis zurueckgefallen?');
  console.log('                                zurueckgefallen   Niveau gehalten');
  console.log(`    Erkenner sagt EINMALERTRAG  ${String(z.geflaggtZurueck).padStart(10)} ${pct(z.geflaggtZurueck, geflaggt).padStart(9)}  ${String(z.geflaggtGehalten).padStart(6)} ${pct(z.geflaggtGehalten, geflaggt).padStart(8)}`);
  console.log(`    Erkenner sagt SAUBER        ${String(z.sauberZurueck).padStart(10)} ${pct(z.sauberZurueck, sauber).padStart(9)}  ${String(z.sauberGehalten).padStart(6)} ${pct(z.sauberGehalten, sauber).padStart(8)}`);

  const trefferquote = geflaggt ? z.geflaggtZurueck / geflaggt : null;
  const basisrate = sauber ? z.sauberZurueck / sauber : null;
  console.log('\n[3] DAS EINZIGE, WAS ZAEHLT: der Abstand zur Basisrate');
  console.log(`    Trefferquote des Erkenners : ${trefferquote === null ? '—' : (100 * trefferquote).toFixed(1) + ' %'}`);
  console.log(`    Basisrate ohne Erkenner    : ${basisrate === null ? '—' : (100 * basisrate).toFixed(1) + ' %'}`);
  if (trefferquote !== null && basisrate !== null) {
    const lift = trefferquote - basisrate;
    console.log(`    Abstand                    : ${(100 * lift).toFixed(1)} Prozentpunkte`);
    // Ist der Abstand mehr als Zufall? Zwei-Stichproben-Test auf Anteile.
    const p = (z.geflaggtZurueck + z.sauberZurueck) / (geflaggt + sauber);
    const se = Math.sqrt(p * (1 - p) * (1 / geflaggt + 1 / sauber));
    const zStat = se > 0 ? lift / se : 0;
    console.log(`    Standardfehler ${(100 * se).toFixed(1)} pp -> ${Math.abs(zStat).toFixed(1)} Standardfehler`);
    console.log(`    => ${Math.abs(zStat) < 2
      ? 'NICHT von Zufall zu unterscheiden. Der Erkenner trennt nicht nachweisbar\n       besser als das blosse Vorhandensein eines Ausreissers.'
      : (lift > 0
        ? 'der Erkenner trennt nachweisbar besser als der blosse Ausreisser.'
        : 'der Erkenner trennt nachweisbar SCHLECHTER — er waere schaedlich.')}`);
  }

  // ── [3b] DIE WIDERLEGUNG — laeuft bei jedem Aufruf mit ─────────────────────
  // Ohne diesen Abschnitt bliebe oben eine Zahl stehen, die wie ein Beleg aussieht.
  console.log('\n[3b] ⛔ GEGENRECHNUNG: die Zahlen oben sind ZIRKULAER');
  {
    const dateien = fs.readdirSync(SNAP_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
    const G = [], S = [];
    for (const f of dateien) {
      let s; try { s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch (_) { continue; }
      let reihe; try { reihe = norm(s, 'revenueQ'); } catch (_) { continue; }
      if (!Array.isArray(reihe) || reihe.length < 5) continue;
      const r = auswerten(reihe, MITTE);
      if (!r) continue;
      (r.geflaggt ? G : S).push({ k: (r.B + MITTE * (r.A - r.B)) / r.B, verhaeltnis: r.zukunft / r.B, spreizung: r.A / r.B });
    }
    console.log(`   Spreizung A/B im Median:  geflaggt ${median(G.map((x) => x.spreizung)).toFixed(2)}  |  sauber ${median(S.map((x) => x.spreizung)).toFixed(2)}`);
    console.log(`   Daraus die Trennlinie:    geflaggt ${median(G.map((x) => x.k)).toFixed(2)}x Basis  |  sauber ${median(S.map((x) => x.k)).toFixed(2)}x Basis`);
    console.log('   Die geflaggte Gruppe wird also gegen eine VIEL tiefer haengende Latte gemessen.');
    // Der mechanische Nullwert: jede geflaggte Zeile behaelt ihre EIGENE Latte, aber
    // das Ergebnis kommt aus der sauberen Verteilung. So oft faellt eine beliebige
    // Zeile unter diese Latte, ganz OHNE dass ein Erkenner etwas geleistet haette.
    let erwartet = 0;
    for (const g of G) erwartet += S.filter((s) => s.verhaeltnis < g.k).length / S.length;
    const null_ = 100 * erwartet / G.length;
    const ist = 100 * G.filter((x) => x.verhaeltnis < x.k).length / G.length;
    console.log(`   Erwartung ohne jede Erkennerleistung: ${null_.toFixed(1)} %`);
    console.log(`   tatsaechlich erreicht:                ${ist.toFixed(1)} %`);
    console.log(`   => der Erkenner liegt ${(null_ - ist).toFixed(1)} pp ${ist < null_ ? 'UNTER' : 'ueber'} dem mechanischen Nullwert.`);
    // WICHTIGE EINSCHRAENKUNG (von einem Richter nachgerechnet, 29.07.): das ist KEIN
    // Schadensnachweis. Auch dieser Nullwert ist konfundiert - 45,2 % der geflaggten
    // Zeilen haben eine laufende Basis unter 10 Mio gegen 1,3 % der sauberen, und eine
    // gemeinsame Latte IN EINHEITEN VON B ist deshalb ebenfalls unfair, nur in die andere
    // Richtung. Bewiesen ist damit nicht "der Erkenner schadet", sondern: es existiert
    // IN KEINER RICHTUNG eine gueltige Wirksamkeitsmessung. Fuer die Frage "darf man
    // darauf eine Regel bauen" aendert das nichts (eine zusammengebrochene Messung traegt
    // keine positive Behauptung); fuer das Zitieren dieser Zahl aendert es alles.
    console.log('      ACHTUNG: das ist KEIN Schadensnachweis. Auch der Nullwert ist verzerrt');
    console.log('      (45,2 % der geflaggten Zeilen haben Basis < 10 Mio gegen 1,3 % der');
    console.log('      sauberen). Belegt ist MESSVERSAGEN in beide Richtungen, nicht Schaden.');
    console.log('\n   Dieselbe Frage mit EINER Latte fuer beide Gruppen:');
    for (const k of [1.0, 1.2, 1.5, 2.0]) {
      const g = 100 * G.filter((x) => x.verhaeltnis < k).length / G.length;
      const s = 100 * S.filter((x) => x.verhaeltnis < k).length / S.length;
      console.log(`     Q0 < ${k.toFixed(1)}x Basis:  geflaggt ${g.toFixed(1)} %  sauber ${s.toFixed(1)} %  Abstand ${(g - s >= 0 ? '+' : '') + (g - s).toFixed(1)} pp`);
    }
    console.log('   => das Vorzeichen des "Befunds" haengt daran, wo die gemeinsame Latte liegt.');
    console.log('      Nur bei exakt 1,0x fuehrt die geflaggte Gruppe. Ein einziger Punkt ist kein Beleg.');
  }

  console.log('\n[4] EMPFINDLICHKEIT der Trennlinie — prueft NICHT, was sie zu pruefen vorgibt');
  console.log('    (sie skaliert (A-B), und genau dieser Abstand ist der Konfundierer aus [3b])');
  for (const lage of [0.25, 0.5, 0.75]) {
    const r = lauf(lage);
    const g = r.z.geflaggtZurueck + r.z.geflaggtGehalten;
    const s = r.z.sauberZurueck + r.z.sauberGehalten;
    const tq = g ? r.z.geflaggtZurueck / g : 0;
    const br = s ? r.z.sauberZurueck / s : 0;
    console.log(`    Grenze bei ${(100 * lage).toFixed(0)} % zwischen Basis und Spitze: Treffer ${(100 * tq).toFixed(1)} % · Basis ${(100 * br).toFixed(1)} % · Abstand ${(100 * (tq - br)).toFixed(1)} pp`);
  }

  // Auffaellig in den Beispielen: JEDER Fehlalarm traegt eine winzige Basis
  // (ABUS 1 Mio, CRNX 0, KYMR 3). Wo praktisch kein laufender Umsatz steht, ist
  // jede Zahl ein "Ausreisser" — und genau dort brennt die Lampe im health-care-
  // Board am haeufigsten. Das ist keine Randnotiz, sondern die Bauanleitung fuer
  // die Regel: sie darf dort nicht greifen, wo es nichts zu vergleichen gibt.
  console.log('\n[4b] AUFSCHLUESSELUNG nach Groesse der laufenden Basis');
  {
    const dateien = fs.readdirSync(SNAP_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
    const klassen = [
      { name: 'Basis < 10 Mio  (praktisch umsatzlos)', min: 0, max: 10e6, g: [0, 0], s: [0, 0] },
      { name: 'Basis 10-100 Mio', min: 10e6, max: 100e6, g: [0, 0], s: [0, 0] },
      { name: 'Basis > 100 Mio', min: 100e6, max: Infinity, g: [0, 0], s: [0, 0] },
    ];
    for (const f of dateien) {
      let s; try { s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch (_) { continue; }
      let reihe; try { reihe = norm(s, 'revenueQ'); } catch (_) { continue; }
      if (!Array.isArray(reihe) || reihe.length < 5) continue;
      const r = auswerten(reihe, MITTE);
      if (!r) continue;
      const k = klassen.find((c) => r.B >= c.min && r.B < c.max);
      if (!k) continue;
      const eimer = r.geflaggt ? k.g : k.s;
      if (r.zurueckgefallen) eimer[0]++; else eimer[1]++;
    }
    console.log('    Klasse                                geflaggt: Treffer   |  sauber: Basisrate  | Abstand');
    for (const k of klassen) {
      const gn = k.g[0] + k.g[1], sn = k.s[0] + k.s[1];
      const tq = gn ? k.g[0] / gn : null, br = sn ? k.s[0] / sn : null;
      const ab = (tq !== null && br !== null) ? (100 * (tq - br)).toFixed(1) + ' pp' : '—';
      console.log(`    ${k.name.padEnd(36)} ${(tq === null ? '—' : (100 * tq).toFixed(1) + ' %').padStart(7)} (n=${String(gn).padStart(3)}) | ${(br === null ? '—' : (100 * br).toFixed(1) + ' %').padStart(7)} (n=${String(sn).padStart(4)}) | ${ab.padStart(8)}`);
    }
  }

  console.log('\n[5] BEISPIELE');
  console.log('    getroffen (Spitze fiel danach zurueck):');
  beispiele.treffer.forEach((b) => console.log('      ' + b));
  console.log('    fehlalarm (Niveau wurde gehalten):');
  beispiele.fehlalarm.forEach((b) => console.log('      ' + b));

  console.log('\n[6] GRENZEN');
  console.log('    - KORRIGIERT: hier stand "der Saison-Schutz laeuft fast nie mit, der');
  console.log('      Erkenner wird in seiner STRENGSTEN Form gemessen". Beides war falsch.');
  console.log('      Der Block-Schutz lief in NULL von 3.491 Faellen (kein lokaler Snapshot');
  console.log('      traegt mehr als 6 Quartale), und er UNTERDRUECKT die Lampe — ohne ihn');
  console.log('      ist der Erkenner BREITER, nicht strenger. Genau dieser Ausfall hat');
  console.log('      H&R Block als "Einmalertrag" gefuehrt, obwohl es die Steuersaison ist.');
  console.log('      Behoben am 29.07.: der Schutz prueft jetzt das EINZELNE Vorjahresquartal.');
  console.log('    - Ein einzelnes Folgequartal ist ein kurzer Beleg. Ein Einmalertrag,');
  console.log('      auf den zufaellig ein starkes Quartal folgt, zaehlt hier als Fehlalarm.');
  console.log('    - Lokaler Snapshot-Bestand, nicht das CI-Universum. Keine Waechter-Basis.');
  console.log('\n══════════════════════════════════════════════════════════════════');
}

main();
