// Waechter fuer den Waechter — .github/workflows/findash-watchdog.yml (Masterplan 7.2.4).
//
// Geprueft wird die SACHE, nicht ein Schreibmuster: der Waechter muss (a) von selbst
// laufen, (b) die Hetzner-API mit dem Repo-Secret befragen, (c) bei JEDEM Befund
// wirklich abbrechen. Ein Waechter, der rot meldet und trotzdem gruen endet, ist
// schlimmer als keiner — er behauptet Aufsicht, die es nicht gibt.
//
// Damit der Pruefer nicht selbst zur Attrappe wird, laeuft er hier gegen die echte
// Datei (gueltige Form muss DURCHGEHEN) UND gegen absichtlich kaputt gemachte
// Kopien (jede muss auffliegen). Zusaetzlich gegen eine harmlos veraenderte Kopie
// (andere Uhrzeit, andere Schwelle) — die darf NICHT rot werden, sonst waere der
// Pruefer an Literale statt an die Sache gepinnt.
//
// Run: node tests/findash-watchdog-workflow.test.js   (Exit 0/1)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WF = path.join(__dirname, '..', '.github', 'workflows', 'findash-watchdog.yml');
const STEP = 'Hetzner-Konto- und Serverlage';

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// --- Block-Extraktion: am benannten Objekt suchen, nicht in der ganzen Datei ---
function blockAb(lines, start) {
  const indent = lines[start].match(/^\s*/)[0].length;
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (lines[i].match(/^\s*/)[0].length <= indent) return lines.slice(start, i);
  }
  return lines.slice(start);
}
function topBlock(yml, key) {
  const lines = yml.split('\n');
  const i = lines.findIndex((l) => l.startsWith(key + ':'));
  return i === -1 ? null : blockAb(lines, i).join('\n');
}
function stepBlock(yml, name) {
  const lines = yml.split('\n');
  const i = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  return i === -1 ? null : blockAb(lines, i).join('\n');
}

// --- Der eigentliche Pruefer: gibt die Liste der Maengel zurueck ---
function maengel(yml) {
  const m = [];
  const on = topBlock(yml, 'on');
  if (!on || !/schedule:/.test(on) || !/-\s*cron:\s*'[^']+'/.test(on)) {
    m.push('kein schedule mit cron unter on: — der Waechter laeuft nie von selbst');
  }
  if (!on || !/workflow_dispatch/.test(on)) m.push('kein workflow_dispatch — nicht von Hand pruefbar');

  const step = stepBlock(yml, STEP);
  if (!step) { m.push(`Pruef-Step "${STEP}" fehlt`); return m; }

  if (!/secrets\.HETZNER_API_TOKEN/.test(step)) m.push('Pruef-Step referenziert das Secret HETZNER_API_TOKEN nicht');
  if (!/api\.hetzner\.cloud\/v1\/servers/.test(step)) m.push('Pruef-Step fragt die Hetzner-Server-API nicht ab');
  if (/continue-on-error/.test(step)) m.push('continue-on-error am Pruef-Step — Befunde koennten still gruen enden');
  if (!/set -euo pipefail/.test(step)) m.push('kein "set -euo pipefail" — unbemerkt scheiternde Befehle');
  // nur echte Kommandozeilen, nicht der Kommentar, der set -x ausdruecklich verbietet
  if (/^\s*set -x\b/m.test(step)) m.push('"set -x" im Step — der Token koennte in den Log geraten');
  if (!new RegExp('\\$\\{?HCLOUD_TOKEN').test(step)) m.push('Token wird nicht als Variable verwendet');

  // Fail-loud: jede ::error::-Meldung muss innerhalb der naechsten Zeilen abbrechen.
  const zeilen = step.split('\n');
  let fehlerMeldungen = 0;
  zeilen.forEach((z, i) => {
    // nur echte Ausgabezeilen zaehlen — ein Kommentar, der ::error:: bloss erwaehnt,
    // ist kein Fehlerpfad und braucht kein exit.
    if (!/^\s*echo\b[^\n]*::error::/.test(z)) return;
    fehlerMeldungen++;
    const folge = zeilen.slice(i + 1, i + 4).join('\n');
    if (!/exit 1/.test(folge)) m.push(`::error:: in Zeile ${i + 1} des Steps bricht nicht ab (kein "exit 1") — stille Panne`);
  });
  if (fehlerMeldungen < 4) m.push(`nur ${fehlerMeldungen} ::error::-Pfade — API-Fehler, fehlender Server, Nicht-Laufen und Kostenlage muessen einzeln rot werden`);

  // Die Schwelle ist der semantische Knopf: benannt, numerisch, und wirklich benutzt.
  const schwelle = yml.match(/MAX_MONATSKOSTEN_EUR:\s*'([\d.]+)'/);
  if (!schwelle) m.push('MAX_MONATSKOSTEN_EUR fehlt oder ist nicht numerisch');
  else if (!(Number(schwelle[1]) > 0)) m.push('MAX_MONATSKOSTEN_EUR ist keine positive Zahl');
  // Nicht "kommt vor", sondern "entscheidet": die Schwelle muss in einer Verzweigung
  // gegen den gemessenen Wert stehen. Ein blosses echo der Zahl waere Deko.
  if (!/^\s*if\b[^\n]*MAX_MONATSKOSTEN_EUR/m.test(step)) {
    m.push('die Schwelle steht in keiner Verzweigung — sie wird nicht verglichen, nur erwaehnt');
  }

  // Preis-Zuordnung: select() erzeugt fuer einen Server ohne Preis-Treffer schlicht
  // keinen Summanden — die Kostensumme waere dann still untererfasst und die Schwelle
  // unerreichbar. Also muss VOR der Summe gezaehlt und bei Luecke abgebrochen werden.
  const summeIdx = zeilen.findIndex((z) => /price_monthly/.test(z));
  const zaehlIdx = zeilen.findIndex((z) => /prices\[\]/.test(z) && /\|\s*length/.test(z));
  if (summeIdx === -1) {
    m.push('keine Kostensumme aus price_monthly — die Kostenlage wird gar nicht abgeleitet');
  } else if (zaehlIdx === -1 || zaehlIdx > summeIdx) {
    m.push('vor der Kostensumme wird die Zahl der Preis-Treffer nicht ermittelt — Server ohne Treffer fielen still aus der Summe');
  } else if (!/exit 1/.test(zeilen.slice(zaehlIdx, summeIdx).join('\n'))) {
    m.push('die Preis-Treffer-Zahl entscheidet nicht (kein "exit 1" zwischen Zaehlung und Summe) — Untererfassung bliebe folgenlos');
  }

  // Falsch-Gruen-Ping: ein HTTP-Ping gegen die Access-geschuetzte URL beweist nichts.
  if (/app\.findash\.cc/.test(step)) m.push('Ping gegen app.findash.cc im Pruef-Step — Cloudflare Access antwortet selbst, das waere Falsch-Gruen');

  return m;
}

const yml = fs.readFileSync(WF, 'utf8');

check('die echte Workflow-Datei ist mangelfrei', () => {
  assert.deepEqual(maengel(yml), []);
});

// --- Gegenprobe: harmlose Aenderungen duerfen NICHT rot werden ---
check('harmlose Aenderung (andere Uhrzeit + andere Schwelle) bleibt gruen', () => {
  const ok = yml
    .replace(/cron: '23 6 \* \* \*'/, "cron: '7 4 * * *'")
    .replace(/MAX_MONATSKOSTEN_EUR: '20\.00'/, "MAX_MONATSKOSTEN_EUR: '25.50'");
  assert.notEqual(ok, yml, 'Mutation griff nicht — Test waere wertlos');
  assert.deepEqual(maengel(ok), []);
});

// --- Gegenprobe: jede kaputte Form muss auffliegen ---
const mutanten = {
  'schedule entfernt': (s) => s.replace(/^\s*schedule:\n\s*- cron:.*$/m, ''),
  'Secret-Referenz durch Literal ersetzt': (s) => s.replace(/\$\{\{ secrets\.HETZNER_API_TOKEN \}\}/, "''"),
  'continue-on-error am Pruef-Step': (s) =>
    s.replace(`- name: ${STEP}`, `- name: ${STEP}\n        continue-on-error: true`),
  'API-Aufruf entfernt': (s) => s.replace('https://api.hetzner.cloud/v1/servers', 'https://example.invalid/'),
  'ein exit 1 zu exit 0 entschaerft': (s) => s.replace('exit 1', 'exit 0'),
  'Schwellwert-Vergleich entfernt': (s) =>
    s.replace(/if awk -v k="\$kosten" -v m="\$MAX_MONATSKOSTEN_EUR".*\n(.*\n){2}\s*fi\n/, ''),
  'set -x eingeschleust (Token-Leak)': (s) => s.replace('set -euo pipefail', 'set -euo pipefail\n          set -x'),
  // Genau der Review-Befund vom 09.08.2026: ohne diesen Vorab-Check verschwinden
  // Server ohne Preis-Treffer lautlos aus der Summe.
  'Preis-Treffer-Check vor der Kostensumme entfernt': (s) =>
    s.replace(/\s*treffer=\$\(jq[\s\S]*?\n\s*fi\n/, '\n'),
  'Preis-Treffer-Check erhoben, aber folgenlos (exit entfernt)': (s) =>
    s.replace(/if \[ "\$treffer" != "\$gesamt" \]; then\n[\s\S]*?\n\s*fi\n/, ''),
  'Falsch-Gruen-Ping eingebaut': (s) =>
    s.replace('set -euo pipefail', 'set -euo pipefail\n          curl -sS https://app.findash.cc/ >/dev/null'),
};
for (const [name, mutate] of Object.entries(mutanten)) {
  check(`Mutant faellt auf: ${name}`, () => {
    const kaputt = mutate(yml);
    assert.notEqual(kaputt, yml, 'Mutation griff nicht — der Test wuerde nichts beweisen');
    assert.ok(maengel(kaputt).length > 0, 'kaputte Form wurde NICHT beanstandet');
  });
}

console.log(fail ? `\n${fail} FAIL` : '\nAlle findash-watchdog-Checks ok');
process.exit(fail ? 1 : 0);
