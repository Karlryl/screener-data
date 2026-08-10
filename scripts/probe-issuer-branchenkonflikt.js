#!/usr/bin/env node
'use strict';
/**
 * Messung (Tag 465): Wie oft traegt derselbe Emittent je Boersenplatz eine ANDERE Branche —
 * und wie oft aendert das die Branchenformel?
 *
 * Warum das zaehlt: der Issuer-Dedup laesst pro Emittent genau EIN Bein ueberleben. Traegt
 * ausgerechnet dieses Bein eine falsche Branche, wird die Firma gegen die falsche Kohorte
 * gemessen — still, ohne dass ein Gate anschlaegt.
 *
 * ⚠ NUR gegen einen CI-Bestand laufen lassen, nie gegen den lokalen snapshots/-Ordner: der ist
 *   auf Entwicklungsrechnern regelmaessig Monate alt und liefert falsche Zahlen.
 *
 *   gh run download <RUN_ID> -n snapshots -D <ordner>
 *   node scripts/probe-issuer-branchenkonflikt.js <ordner>
 *
 * Ergebnis am Lauf 30230485209 (27.07.2026, 12.453 Snapshots):
 *   8.100 Gruppen, 2.647 mehrbeinig, 4 mit abweichender Branche, 21 mit abweichender Formel —
 *   davon 20 nur wegen metadatenloser OTC-Schattenbeine, die ohnehin ausgeschlossen sind.
 *   EIN echter Fall: Anglo American plc (AAL.SW steht als „Airlines" statt Bergbau) — siehe
 *   den Kommentar an issuerDedupComparator in src/scoring/score.js.
 */
const fs = require('fs');
const path = require('path');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');

const { issuerKeyLoose, issuerDedupGroups, issuerDedupComparator } = require('../src/scoring/score.js');
const { sectorRoute, route } = require('../src/scoring/router.js');

const SNAPS = process.argv[2];
if (!SNAPS || !fs.existsSync(SNAPS)) {
  console.error('Nutzung: node scripts/probe-issuer-branchenkonflikt.js <snapshot-ordner-aus-CI>');
  process.exit(1);
}

const dateien = fs.readdirSync(SNAPS).filter((f) => f.endsWith('.json') && !isMetadataSnapshot(f));
const eintraege = [];
for (const f of dateien) {
  let s;
  try { s = JSON.parse(fs.readFileSync(path.join(SNAPS, f), 'utf8')); } catch (e) { continue; }
  if (!s || !s.meta || !issuerKeyLoose(s)) continue;
  eintraege.push({ ticker: s.ticker || f.replace(/\.json$/, ''), snapshot: s });
}

const gruppen = issuerDedupGroups(eintraege);
const mehrbeinig = gruppen.filter((g) => g.length > 1);

const branchenAbweichung = [];
const formelAbweichung = [];
for (const g of mehrbeinig) {
  const branchen = new Set(g.map((e) => String(e.snapshot.meta.industry || '').toLowerCase()).filter(Boolean));
  const formeln = new Set(g.map((e) => sectorRoute(e.snapshot)).filter(Boolean));
  if (branchen.size > 1) branchenAbweichung.push(g);
  if (formeln.size > 1) formelAbweichung.push(g);
}

// Der Teil, der wirklich zaehlt: mehr als EIN board-faehiges Bein UND uneinige Formel.
// Ausgeschlossene Beine (OTC-Schatten ohne Metadaten) verzerren die Rohzahl sonst nach oben.
const echt = [];
for (const g of formelAbweichung) {
  const drin = g.filter((e) => { try { return route(e.snapshot).action !== 'exclude'; } catch (_) { return false; } });
  if (drin.length > 1 && new Set(drin.map((e) => sectorRoute(e.snapshot))).size > 1) echt.push({ g, drin });
}

console.log(`Snapshots ............ ${dateien.length}`);
console.log(`Emittenten-Gruppen ... ${gruppen.length} (mehrbeinig: ${mehrbeinig.length})`);
console.log(`abweichende Branche .. ${branchenAbweichung.length}`);
console.log(`abweichende Formel ... ${formelAbweichung.length} (roh, inkl. ausgeschlossener Beine)`);
console.log(`ECHTE Faelle ......... ${echt.length} (mehr als ein board-faehiges Bein, uneinige Formel)`);

for (const { g, drin } of echt) {
  const sortiert = [...g].sort(issuerDedupComparator);
  const sieger = sortiert[0];
  console.log(`\n  ${issuerKeyLoose(sieger.snapshot)}`);
  for (const e of drin) {
    console.log(`    ${String(e.ticker).padEnd(10)} ${String(e.snapshot.meta.industry || '(ohne)').padEnd(34)} -> ${sectorRoute(e.snapshot)}`);
  }
  console.log(`    Dedup-Sieger: ${sieger.ticker} -> ${sectorRoute(sieger.snapshot)}`);
}

// Exit 0 auch bei Funden: das hier ist ein Messwerkzeug, kein Gate. Ein Gate braeuchte einen
// stabilen Schwellenwert — den gibt es erst, wenn die Zahl ueber mehrere Laeufe beobachtet ist.
process.exit(0);
