'use strict';
/**
 * T196-Zensus — wie oft traegt eine PIT-Zeile `revenueQEnds`, und in welcher Form?
 * =================================================================================
 * Zaehlt auf dem juengsten `board-history/<datum>/`-Stand die vier Groessen, an denen
 * sich der Rohzugriff in `src/scoring/lamps.js:657` und der typisierte Leser
 * `periodEnds()` (`src/scoring/snapshot.js:266`) UNTERSCHEIDEN wuerden:
 *   - Laenge von `revenueQEnds` != Laenge von `revenueQ`  -> periodEnds() nullt die GANZE Reihe
 *   - kalendarisch unmoegliches Datum (Round-Trip-Probe)  -> periodEnds() nullt den Eintrag
 *   - nicht-ISO-Eintrag (z. B. ein beliebiger String)     -> periodEnds() nullt den Eintrag,
 *     der Rohzugriff laesst ihn zur Datumspruefung durch und verwirft die ZEILE (nicht die Lampe)
 * Dazu die Belegung selbst und die Zahl der Zeilen mit vier brauchbaren Enden (das ist,
 * was der Einmalertrag-Kadenz-Waechter verlangt).
 *
 * LLM-frei, read-only, kein Netz. Bericht: reports/t196-revenueqends-registerfrage-2026-09-19.md
 * Grenze: `board-history` ist die gefilterte Board-Population, nicht das Voll-Universum.
 */
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', 'board-history');
const MS_PRO_TAG = 86400000;

// Dieselbe Round-Trip-Probe wie snapshot.js:_tagesnummer — "2025-02-30" rollt bei
// Date.parse still auf den 2. Maerz weiter und waere sonst ein falsches Datum.
function datumBrauchbar(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(d)) return false;
  const t = Date.parse(d.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(t)) return false;
  return new Date(t).toISOString().slice(0, 10) === d.slice(0, 10);
}

function zensus(tag) {
  const dir = path.join(BASE, tag);
  // KEIN Unterstrich-Filter (Waechter tests/p1-welle8-metadata-filter.js, R1-SK-008): in
  // board-history/<datum>/ liegt real keine `_`-Datei — die Sidecars _excluded.json und
  // _gate-calibration.json liegen eine Ebene hoeher. Eine Datei ohne `cohort` traegt hier
  // ohnehin keine Zeile bei.
  const dateien = fs.readdirSync(dir).filter((x) => x.endsWith('.json'));
  const z = {
    tag, dateien: dateien.length, zeilenGesamt: 0, zeilenOhnePit: 0, pitZeilen: 0, mitEnds: 0,
    laengeUngleichRevenueQ: 0, vierBrauchbar: 0, wenigerAlsVier: 0, unmoeglicheDaten: 0,
    formatFehler: 0,
  };
  for (const f of dateien) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const kohorte = j.cohort || {};
    for (const spur of Object.keys(kohorte)) {
      const zeilen = Array.isArray(kohorte[spur]) ? kohorte[spur] : [];
      for (const r of zeilen) {
        z.zeilenGesamt++;
        const p = r && r.pit;
        // Der Nenner wird AUSGEWIESEN, nicht stillschweigend gekuerzt: eine Zeile ohne
        // PIT-Block ist keine Zeile ohne Enden, sie ist ungemessen.
        if (!p) { z.zeilenOhnePit++; continue; }
        z.pitZeilen++;
        const e = p.revenueQEnds;
        if (!Array.isArray(e) || e.length === 0) continue;
        z.mitEnds++;
        if (!Array.isArray(p.revenueQ) || p.revenueQ.length !== e.length) z.laengeUngleichRevenueQ++;
        const vier = e.slice(0, 4);
        if (vier.length === 4 && vier.every((d) => typeof d === 'string' && d)) z.vierBrauchbar++;
        else z.wenigerAlsVier++;
        for (const d of e) {
          if (d === null || d === undefined) continue;          // ehrliche Luecke, kein Formfehler
          if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) {
            if (!datumBrauchbar(d)) z.unmoeglicheDaten++;       // ISO-Form, aber kalendarisch unmoeglich
          } else {
            z.formatFehler++;                                   // Duell-Einwand E1: nicht-ISO-Eintrag
          }
        }
      }
    }
  }
  return z;
}

function main(argv) {
  const tage = fs.readdirSync(BASE).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const tag = argv[0] || tage[tage.length - 1];
  if (!tage.includes(tag)) {
    console.error(`T196-Zensus: kein board-history-Stand "${tag}"`);
    return 1;
  }
  console.log(JSON.stringify(zensus(tag), null, 1));
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { zensus, datumBrauchbar };
