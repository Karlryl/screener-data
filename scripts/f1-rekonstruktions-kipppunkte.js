#!/usr/bin/env node
/**
 * F-1 Nachsorge (Review-Befund 03.08.2026) — Beobachtungsliste zum Rekonstruktions-Kipprisiko.
 * =============================================================================================
 * Die Burn-Bremse liest den OPERATIVEN Cash-Fluss. Fehlt annualOCF an einer Position,
 * rekonstruiert lamps.js operatingCashSeries ihn als FCF minus Capex. Die Identitaet
 * OCF + Capex = FCF haelt fast immer — aber wenn sie bricht, bricht sie GROSS, und dann kann
 * das rekonstruierte VORZEICHEN falsch sein. Das Tor der Lampe ist ein reiner Vorzeichentest
 * (ocf[0] < 0), also entscheidet genau dieses Vorzeichen ueber Lampe und Score-Faktor.
 *
 *   node scripts/f1-rekonstruktions-kipppunkte.js <snapdir> [--band <x>]
 *
 * DAS IST EINE BEOBACHTUNGSLISTE, KEIN GATE. Sie repariert nichts und aendert keinen Score;
 * sie beantwortet nur die Frage "bei wem haengt das Burn-Urteil heute an einer Rekonstruktion,
 * deren Vorzeichen kippen koennte?". Exit ist immer 0 (ausser bei kaputtem Aufruf).
 *
 * WIE "HAENGT DARAN" GEMESSEN WIRD — nicht geschaetzt, sondern gegengerechnet: der
 * rekonstruierte Wert wird an seiner Position mit umgekehrtem Vorzeichen eingesetzt und
 * burnAccelerating (Produktionscode) erneut gefragt. Aendert sich das Urteil, haengt es an
 * der Rekonstruktion. Aendert es sich nicht, ist der Name nicht gefaehrdet — auch wenn er
 * rekonstruiert.
 *
 * WOHER DIE TOLERANZBANDE KOMMT (gemessen 03.08.2026 am lokalen Baum, nicht gewaehlt):
 * an 10.621 Ground-Truth-Positionen (OCF UND FCF UND Capex vorhanden) rekonstruiert die
 * Identitaet 86,8 % auf den Cent genau und 99,7 % auf 1 % genau (die Zahl, die
 * --bandherleitung ausgibt). Der Fehler ist bimodal — Perzentile ueber alle Positionen sind
 * nutzlos (p99,5 = 0). Aussagekraeftig sind die 30 Positionen mit einem relativen Fehler
 * ueber 1 %: deren Median liegt bei 0,205, das Maximum bei 1,074. Anders gesagt: WENN die
 * Identitaet bricht, dann typischerweise um ein Fuenftel der eigenen Groessenordnung.
 * Genau das ist die Bande — ein rekonstruierter Wert, der naeher als das an der Null liegt,
 * haette bei einem solchen Bruch auf der anderen Seite gelegen.
 * Gegenprobe an den drei tatsaechlich beobachteten Vorzeichen-Flips (Abstand ihres
 * rekonstruierten Werts von der Null): 8967.T 0,075 · LBRDB 0,296 · BVC 0,997 — ein
 * naiveres 3 %-Band haette KEINEN davon erfasst, 0,205 erfasst den ersten.
 * Nachmessbar: scripts/f1-rekonstruktions-kipppunkte.js --bandherleitung <snapdir>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');
const { scoreUniverse } = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');
const { norm } = require('../src/scoring/snapshot.js');
const { burnAccelerating } = require('../src/scoring/lamps.js');
const { ladeUniversum } = require('./f1-burnverschiebung.js');

// Median des relativen Rekonstruktionsfehlers an den Positionen, an denen die Identitaet
// UEBERHAUPT verletzt ist (> 1 %). Herleitung im Kopfkommentar, nachmessbar via
// --bandherleitung. KEINE gewaehlte Rundzahl.
const KIPP_BAND = 0.205;
// Nur Index 0 und 1 — mehr liest burnAccelerating nicht.
const POSITIONEN = [0, 1];

// Die zwei Positionen, an denen die Lampe heute TATSAECHLICH rekonstruiert: annualOCF fehlt,
// FCF und Capex sind da. (Fehlt eines der Ersatzteile, liefert operatingCashSeries null und
// die Lampe schweigt — kein Risiko.)
function rekonstruierendePositionen(s) {
  const ocf = norm(s, 'annualOCF'), fcf = norm(s, 'annualFCF'), cap = norm(s, 'annualCapex');
  const out = [];
  for (const i of POSITIONEN) {
    if (Number.isFinite(ocf[i])) continue;
    if (!Number.isFinite(fcf[i]) || !Number.isFinite(cap[i])) continue;
    const wert = fcf[i] - cap[i];
    const skala = Math.max(Math.abs(fcf[i]), Math.abs(cap[i]));
    out.push({ i, wert, skala, abstand: skala > 0 ? Math.abs(wert) / skala : Infinity });
  }
  return out;
}

// Setzt eine explizite OCF-Reihe in eine KOPIE des Snapshots (annualOCF ist im
// FIELD_REGISTRY die {value}-Form). Der Originalsnapshot bleibt unberuehrt — sonst wuerde
// die Gegenrechnung das Universum vergiften, auf dem sie misst.
function mitOcfReihe(s, reihe) {
  return { ...s, annual: { ...(s.annual || {}), annualOCF: reihe.map((v) => ({ value: v })) } };
}

/**
 * Kipp-Befund eines Snapshots. null = kein Kandidat.
 * Kandidat ist, wer BEIDES erfuellt:
 *   (a) das Burn-Urteil haengt am Vorzeichen einer Rekonstruktion (gegengerechnet), UND
 *   (b) mindestens eine dieser Rekonstruktionen liegt naeher als das Band an der Null.
 * Reine Funktion (nur Lesezugriff auf den Snapshot) — deshalb ohne Snapshots pruefbar.
 */
function kippBefund(s, band = KIPP_BAND) {
  const rek = rekonstruierendePositionen(s);
  if (rek.length === 0) return null;
  const urteil = burnAccelerating(s);
  if (urteil === null) return null; // nicht bewertbar -> kein Urteil, das kippen koennte

  // Gegenrechnung: dieselbe operative Reihe, aber die rekonstruierten Stellen mit
  // umgekehrtem Vorzeichen. Aendert das das Urteil, haengt es an der Rekonstruktion.
  const ocf = norm(s, 'annualOCF'), fcf = norm(s, 'annualFCF'), cap = norm(s, 'annualCapex');
  const laenge = Math.max(ocf.length, fcf.length, cap.length);
  const reihe = [];
  for (let i = 0; i < laenge; i++) {
    if (Number.isFinite(ocf[i])) { reihe.push(ocf[i]); continue; }
    reihe.push((Number.isFinite(fcf[i]) && Number.isFinite(cap[i])) ? fcf[i] - cap[i] : null);
  }
  const gedreht = reihe.slice();
  for (const r of rek) gedreht[r.i] = -r.wert;
  const gegenUrteil = burnAccelerating(mitOcfReihe(s, gedreht));
  if (gegenUrteil === urteil) return null; // Urteil steht auch mit gedrehtem Vorzeichen -> nicht gefaehrdet

  const knapp = rek.filter((r) => r.abstand < band);
  if (knapp.length === 0) return null;
  return {
    ticker: (s.meta && s.meta.ticker) || '?',
    urteil,
    gegenUrteil,
    positionen: knapp.map((r) => ({ i: r.i, wert: r.wert, abstand: r.abstand })),
  };
}

/**
 * UMFANGS-WACHE (Review-Befund 03.08.2026) — rein, ohne I/O, damit sie ohne Snapshots pruefbar ist.
 *
 * Diese Liste antwortet mit einer ZAHL, und "0" hat zwei voellig verschiedene Bedeutungen:
 * "gemessen, niemand gefaehrdet" und "nichts gemessen". Reproduziert am 03.08.2026 gegen ein
 * leeres Temp-Verzeichnis: "geroutete Zeilen: 0 · KIPP-KANDIDATEN: 0 · (keiner — kein
 * gerouteter Name haengt heute an einer knappen Rekonstruktion)", Exit 0. Das ist wortwoertlich
 * eine Entwarnung fuer einen Lauf, der nichts angesehen hat. Dieselbe Luecke wurde am selben
 * Tag in den Schwester-Waechtern geschlossen (watch-fx-sanity gescannt===0, watch-annual-spikes
 * leeres Verzeichnis) — hier steht sie nur deshalb noch offen, weil das Skript heute nirgends
 * automatisiert laeuft. Vor der ersten Verdrahtung ist sie zu.
 *
 * KEINE gewaehlte Untergrenze. Geprueft wird ausschliesslich der Nullfall — jede positive
 * Mindestzahl waere eine Magic Number ohne Anker im Datenbestand (das Skript kennt seine
 * Referenz-Population nicht; es bekommt sein Verzeichnis per argv). Der NAHE-Null-Fall
 * braucht sie auch nicht: der Umfang steht als "geroutete Zeilen: N" direkt ueber dem
 * Ergebnis, ein Lauf ueber drei Dateien ist dort als solcher lesbar. Nur die echte Null
 * liest sich als Befund, und genau die faellt hier auf.
 */
function umfangGueltig(geladen, geroutet) {
  if (!(geladen > 0)) {
    return {
      ok: false,
      grund: `0 Snapshots geladen — die Kipp-Liste hat NICHTS geprueft. Ihre Null-Zaehler sind `
        + 'kein Gesundheitszeugnis, sondern eine unbeantwortete Frage. Zeigt der uebergebene '
        + 'Pfad auf das richtige Snapshot-Verzeichnis?',
    };
  }
  if (!(geroutet > 0)) {
    return {
      ok: false,
      grund: `${geladen} Snapshots geladen, aber 0 geroutete Zeilen — die Kandidaten werden AUS `
        + 'den gerouteten Zeilen gezogen, also hat die Liste NICHTS geprueft. Entweder passt das '
        + 'Verzeichnis nicht zur watchlist.json oder der Scoring-Pfad ist kaputt.',
    };
  }
  return { ok: true, grund: '' };
}

// --bandherleitung: die Messung aus dem Kopfkommentar reproduzierbar machen.
function bandherleitung(dir) {
  const abweichungen = [];
  let ground = 0, exakt = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || isMetadataSnapshot(f)) continue;
    let s; try { s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
    if (!s || !s.annual) continue;
    const ocf = norm(s, 'annualOCF'), fcf = norm(s, 'annualFCF'), cap = norm(s, 'annualCapex');
    const n = Math.max(ocf.length, fcf.length, cap.length);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(ocf[i]) || !Number.isFinite(fcf[i]) || !Number.isFinite(cap[i])) continue;
      const skala = Math.max(Math.abs(ocf[i]), Math.abs(fcf[i]), Math.abs(cap[i]));
      if (skala <= 0) continue;
      ground++;
      const rel = Math.abs(ocf[i] - (fcf[i] - cap[i])) / skala;
      if (rel <= 0.01) exakt++; else abweichungen.push(rel);
    }
  }
  abweichungen.sort((a, b) => a - b);
  const median = abweichungen.length ? abweichungen[Math.floor(abweichungen.length / 2)] : null;
  console.log(`Ground-Truth-Positionen: ${ground} · davon bis 1 % genau: ${exakt} (${(100 * exakt / ground).toFixed(1)} %)`);
  console.log(`Echte Abweichungen (> 1 %): ${abweichungen.length} · Median ${median === null ? '—' : median.toFixed(3)}`
    + ` · Max ${abweichungen.length ? abweichungen[abweichungen.length - 1].toFixed(3) : '—'}`);
  console.log(`Eingebautes Band: ${KIPP_BAND} (der Median oben, gerundet auf drei Stellen)`);
}

function main() {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) {
    console.error('Aufruf: node scripts/f1-rekonstruktions-kipppunkte.js <snapdir> [--band <x>] [--bandherleitung]');
    process.exit(2);
  }
  if (process.argv.includes('--bandherleitung')) { bandherleitung(dir); return; }
  const bandIdx = process.argv.indexOf('--band');
  const band = bandIdx > 0 ? Number(process.argv[bandIdx + 1]) : KIPP_BAND;
  if (!Number.isFinite(band) || band <= 0) { console.error('--band braucht eine positive Zahl'); process.exit(2); }

  const universum = ladeUniversum(dir, false);
  const geroutet = new Set(
    scoreUniverse(universum, formulas, {})
      .filter((e) => e.action === 'route' && Number.isFinite(e.score))
      .map((e) => e.ticker));

  // Umfang ZUERST: eine Kandidaten-Null ohne gepruefte Menge ist keine Aussage (s.o.).
  const umfang = umfangGueltig(universum.length, geroutet.size);
  if (!umfang.ok) {
    console.error('FEHLER: ' + umfang.grund);
    console.error(`Messebene: ${dir}`);
    process.exit(2);   // kaputter Aufruf — dieselbe Klasse wie ein fehlendes Verzeichnis
  }

  let rekonstruierend = 0;
  const kandidaten = [];
  for (const s of universum) {
    if (!geroutet.has(s.meta && s.meta.ticker)) continue;
    if (rekonstruierendePositionen(s).length > 0) rekonstruierend++;
    const b = kippBefund(s, band);
    if (b) kandidaten.push(b);
  }

  console.log(`Messebene            : ${dir}`);
  console.log(`geroutete Zeilen     : ${geroutet.size}`);
  console.log(`davon rekonstruierend: ${rekonstruierend} (annualOCF fehlt an Position 0 oder 1)`);
  console.log(`Toleranzbande        : ${band} (relativer Abstand des rekonstruierten Werts von der Null)`);
  console.log(`KIPP-KANDIDATEN      : ${kandidaten.length}`);
  for (const k of kandidaten.sort((a, b) => a.positionen[0].abstand - b.positionen[0].abstand)) {
    const p = k.positionen.map((x) => `[${x.i}] ${(x.wert / 1e6).toFixed(1)} Mio, Abstand ${x.abstand.toFixed(3)}`).join(' · ');
    console.log(`  ${String(k.ticker).padEnd(12)} Urteil ${k.urteil} -> bei gedrehtem Vorzeichen ${k.gegenUrteil}  ${p}`);
  }
  if (kandidaten.length === 0) console.log('  (keiner — kein gerouteter Name haengt heute an einer knappen Rekonstruktion)');
  console.log('\nBEOBACHTUNGSLISTE, KEIN GATE: Exit 0 unabhaengig vom Ergebnis.');
}

if (require.main === module) main();
module.exports = { kippBefund, rekonstruierendePositionen, umfangGueltig, KIPP_BAND };
