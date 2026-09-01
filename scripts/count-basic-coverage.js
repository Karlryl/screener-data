'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../lib/atomic-write.js');

const root = path.resolve(__dirname, '..');
const cacheDir = path.join(root, 'fundamentals-cache');
const smallcapDir = path.join(root, 'snapshots-smallcap');
const reportPath = path.join(root, 'reports', '52-basic-coverage-2026-08-05.md');
const BASIC_KEYS = new Set(['basicAverageShares', 'basic_average_shares']);

function jsonFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
}

function emptyStats() {
  return {
    cacheFiles: 0,
    parseErrors: 0,
    annualFirmYears: 0,
    annualShareSlots: 0,
    resolvedAnnualShares: 0,
    directBasicValues: 0,
    directBasicNumericValues: 0,
    filesWithDirectBasicKey: 0,
  };
}

function valueLeaves(value) {
  if (Array.isArray(value)) return value.reduce((count, item) => count + valueLeaves(item), 0);
  return 1;
}

function numericLeaves(value) {
  if (Array.isArray(value)) return value.reduce((count, item) => count + numericLeaves(item), 0);
  return Number.isFinite(value) ? 1 : 0;
}

function directBasicCounts(value) {
  const counts = { keys: 0, values: 0, numericValues: 0 };
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = directBasicCounts(item);
      counts.keys += nested.keys;
      counts.values += nested.values;
      counts.numericValues += nested.numericValues;
    }
    return counts;
  }
  if (!value || typeof value !== 'object') return counts;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (BASIC_KEYS.has(key)) {
      counts.keys += 1;
      counts.values += valueLeaves(nestedValue);
      counts.numericValues += numericLeaves(nestedValue);
    }
    const nested = directBasicCounts(nestedValue);
    counts.keys += nested.keys;
    counts.values += nested.values;
    counts.numericValues += nested.numericValues;
  }
  return counts;
}

function annualFirmYears(payload) {
  const annual = payload && payload.ftsAnnual;
  if (!annual || typeof annual !== 'object' || Array.isArray(annual)) return 0;
  return Math.max(0, ...Object.values(annual).filter(Array.isArray).map((series) => series.length));
}

function addCache(stats, parsed) {
  const payload = parsed && parsed.payload;
  stats.annualFirmYears += annualFirmYears(payload);

  const shares = payload && payload.ftsAnnualShares;
  if (Array.isArray(shares)) {
    stats.annualShareSlots += shares.length;
    stats.resolvedAnnualShares += shares.filter(Number.isFinite).length;
  }

  const basic = directBasicCounts(parsed);
  if (basic.keys > 0) stats.filesWithDirectBasicKey += 1;
  stats.directBasicValues += basic.values;
  stats.directBasicNumericValues += basic.numericValues;
}

function percent(numerator, denominator) {
  return denominator === 0 ? 'n/a' : `${(numerator / denominator * 100).toFixed(2)}%`;
}

function summaryRow(label, stats) {
  return [
    `| ${label} | ${stats.cacheFiles} | ${stats.parseErrors} | ${stats.annualFirmYears} | ${stats.directBasicNumericValues} / ${stats.annualFirmYears} (${percent(stats.directBasicNumericValues, stats.annualFirmYears)}) | ${stats.resolvedAnnualShares} / ${stats.annualShareSlots} (${percent(stats.resolvedAnnualShares, stats.annualShareSlots)}) |`,
  ].join('\n');
}

const cacheFiles = jsonFiles(cacheDir);
const smallcapFiles = new Set(jsonFiles(smallcapDir));
const all = emptyStats();
const routedProxy = emptyStats();
const missingSmallcapCaches = [...smallcapFiles].filter((name) => !cacheFiles.includes(name));

for (const fileName of cacheFiles) {
  const isRoutedProxy = smallcapFiles.has(fileName);
  all.cacheFiles += 1;
  if (isRoutedProxy) routedProxy.cacheFiles += 1;

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(cacheDir, fileName), 'utf8'));
  } catch (_) {
    all.parseErrors += 1;
    if (isRoutedProxy) routedProxy.parseErrors += 1;
    continue;
  }

  addCache(all, parsed);
  if (isRoutedProxy) addCache(routedProxy, parsed);
}

const report = `# Basic-Average-Shares-Abdeckung in FTS-Caches\n\nStand: 2026-08-05 (offline, erzeugt mit \`node scripts/count-basic-coverage.js\`)\n\n## Hauptbefund\n\n\`basicAverageShares\` ist in den untersuchten Cache-Dateien nicht als Rohfeld vorhanden: **${all.directBasicNumericValues} / ${all.annualFirmYears} Firmenjahre (${percent(all.directBasicNumericValues, all.annualFirmYears)})**. Das ist keine Aussage, dass Yahoo fuer diese Jahre keinen Basic-Wert geliefert hat. Der Cache-Writer loest je Jahres-Row zuerst \`dilutedAverageShares\`, dann \`basicAverageShares\` auf und speichert anschliessend nur die resultierende, quellenlose Reihe \`ftsAnnualShares\` (\`pull-yahoo.js:2806-2810\`, Cache-Write \`pull-yahoo.js:2838-2843\`). Die Herkunft eines gespeicherten Werts ist deshalb nachtraeglich nicht mehr bestimmbar.\n\n## Zaehllauf\n\n| Menge | Cache-Dateien | Parse-Errors | Firmenjahre (FTS annual) | Direkte numerische \`basicAverageShares\`-Werte | Aufgeloeste \`ftsAnnualShares\`-Werte |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${summaryRow('Alle FTS-Caches', all)}\n${summaryRow('Small-Cap-Routing-Proxymenge', routedProxy)}\n\nZusatz zur Proxymenge: \`snapshots-smallcap/\` enthaelt **${smallcapFiles.size}** Dateien; **${routedProxy.cacheFiles}** haben eine gleichnamige Cache-Datei. **${missingSmallcapCaches.length}** Small-Cap-Snapshots ohne gleichnamigen Cache wurden nicht in die Cache-Zeilen aufgenommen.\n\n## Routing-Definition fuer die eingeschraenkte Auswertung\n\nDie Lampe liefert nur dann eine Aussage, wenn der Small-Cap-Aufrufer einen Kohorten-Kontext \`shareGrowthPctlFn\` bereitstellt (\`src/scoring/lamps.js:549-572\`); die Reihe selbst bevorzugt SEC und faellt sonst auf \`annualShares\` zurueck (\`src/scoring/lamps.js:482-489\`). Die genaue zur Laufzeit geroutete Menge ist in den laut Brief erlaubten Offline-Dateien nicht vollstaendig rekonstruierbar. Daher ist die zweite Tabellenzeile bewusst als **Proxy** definiert: jeder Dateiname in \`snapshots-smallcap/\`, der exakt mit einem Dateinamen in \`fundamentals-cache/\` uebereinstimmt.\n\nDiese Definition misst die vorhandene lokale Small-Cap-Teilmenge, nicht die vollstaendige historische Runner-Menge und auch nicht nur ausgeloeste Lampen. Sie ist deshalb nicht mit einer extern genannten Referenzzahl gerouteter Zeilen gleichzusetzen.\n\n## Methodik und Grenzen\n\n- Es wurden alle \`.json\`-Dateien in \`fundamentals-cache/\` offline gelesen. Nicht parsebare Dateien werden als Parse-Error gezaehlt, nicht repariert und tragen keine Werte bei.\n- Ein Firmenjahr ist hier ein Positions-Slot der laengsten Jahresreihe in \`payload.ftsAnnual\` je Cache-Datei. Der Nenner umfasst damit auch alte Cache-Formen ohne \`ftsAnnualShares\`.\n- Der direkte Basic-Zaehler durchsucht jede parsebare Cache-JSON rekursiv nach \`basicAverageShares\` und \`basic_average_shares\`; nur numerische Blattwerte zaehlen als vorhandene Basic-Werte.\n- Die zusaetzliche Spalte \`ftsAnnualShares\` zaehlt die gespeicherten aufgeloesten Jahreswerte. Sie zeigt die messbare Reihendeckung, kann aber nicht in diluted versus basic aufgeteilt werden.\n- Es werden keine Pipeline-, Lampen- oder Scoring-Dateien geaendert und keine Netzquelle verwendet.\n`;

writeFileAtomic(reportPath, report, 'utf8');
console.log('FTS basicAverageShares coverage');
console.log(`Cache files: ${all.cacheFiles}; parse errors: ${all.parseErrors}`);
console.log(`All annual FTS firm-years: ${all.annualFirmYears}; direct basicAverageShares: ${all.directBasicNumericValues} (${percent(all.directBasicNumericValues, all.annualFirmYears)})`);
console.log(`Small-cap proxy: ${routedProxy.cacheFiles}/${smallcapFiles.size} cache matches; annual FTS firm-years: ${routedProxy.annualFirmYears}; direct basicAverageShares: ${routedProxy.directBasicNumericValues} (${percent(routedProxy.directBasicNumericValues, routedProxy.annualFirmYears)})`);
console.log(`Report: ${path.relative(root, reportPath)}`);
