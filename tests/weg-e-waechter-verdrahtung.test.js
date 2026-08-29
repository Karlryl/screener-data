'use strict';
/**
 * Weg E — der ausgekoppelte Waechter bleibt sichtbar und blockiert nichts.
 * ========================================================================
 *
 * ANLASS (Gerichtsurteil 28.08.2026, Auflage aus R2): Der Jahres-Ausreisser-Waechter
 * ist aus dem merge-Job in einen eigenen Job gewandert, damit sein rotes X nicht mehr
 * den ganzen Scoring-Tag kostet. Genau dieser Umbau hat eine neue Fallgrube:
 *
 *   Ein eigener Job ist nur dann in Karls Alarm-Kanal sichtbar, wenn er in ZWEI
 *   Listen steht — `laufstatus.needs` in daily-pull.yml UND JOB_REIHENFOLGE in
 *   scripts/pipeline-status.js.
 *
 * Fehlt EINE der beiden, wirft `leseJobErgebnisse()` von selbst (Drift-Pruefung in
 * beide Richtungen, pipeline-status.js) — das ist bereits laut und braucht hier
 * keinen Test. Fehlt der Job in BEIDEN, wirft niemand: er ist dann aus der
 * Blockade-Kette UND aus dem Statusmarker verschwunden, und niemand merkt es.
 * Das ist die Luecke, die diese Datei schliesst.
 *
 * WAS FESTGENAGELT WIRD:
 *   (a) der Job existiert ueberhaupt in daily-pull.yml
 *   (b) er steht in laufstatus.needs (sonst: unsichtbar trotz Drift-Pruefung)
 *   (c) er steht in JOB_REIHENFOLGE
 *   (d) ANWESENHEIT der Gegenrichtung: er steht dort am ENDE, nicht vor merge/scoring
 *   (e) KEIN anderer Job haengt an ihm — er darf nichts blockieren (der ganze Zweck)
 *   (f) der Sammelschritt im merge-Job nennt ihn NICHT mehr
 *
 * Standalone: node tests/weg-e-waechter-verdrahtung.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JOB = 'jahres-ausreisser-waechter';
const YML = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily-pull.yml'), 'utf8');
const { JOB_REIHENFOLGE } = require('../scripts/pipeline-status.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

/** Die `needs:`-Zeile des laufstatus-Jobs, als Liste von Job-Namen. */
function laufstatusNeeds() {
  const i = YML.indexOf('\n  laufstatus:');
  assert.ok(i > 0, 'laufstatus-Job nicht gefunden — wurde er umbenannt?');
  const m = /\n\s*needs:\s*\[([^\]]*)\]/.exec(YML.slice(i));
  assert.ok(m, 'laufstatus hat keine needs-Liste in Klammernform');
  return m[1].split(',').map((x) => x.trim()).filter(Boolean);
}

check('(a) der Job existiert in daily-pull.yml', () => {
  assert.ok(new RegExp('\\n  ' + JOB + ':\\s*\\n').test(YML),
    JOB + ' ist kein eigener Job (mehr) — Weg E ist dann nicht gebaut');
});

check('(b) der Job steht in laufstatus.needs — sonst unsichtbar im Statusmarker', () => {
  assert.ok(laufstatusNeeds().includes(JOB),
    'fehlt in laufstatus.needs: der Job faellt aus toJSON(needs), die Drift-Pruefung in '
    + 'pipeline-status.js sieht ihn nie, und sein Ausfall bleibt in Karls Alarm-Kanal unsichtbar');
});

check('(c) der Job steht in JOB_REIHENFOLGE', () => {
  assert.ok(JOB_REIHENFOLGE.includes(JOB), 'fehlt in JOB_REIHENFOLGE (scripts/pipeline-status.js)');
});

check('(d) er steht am ENDE, nicht vor merge/scoring', () => {
  const i = JOB_REIHENFOLGE.indexOf(JOB);
  assert.ok(i > JOB_REIHENFOLGE.indexOf('merge'), 'steht vor merge — im Banner staende die Diagnose statt des Datenschritts');
  assert.ok(i > JOB_REIHENFOLGE.indexOf('scoring'), 'steht vor scoring — dito');
});

check('(e) KEIN anderer Job haengt an ihm (ausser laufstatus) — er blockiert nichts', () => {
  // Diese Probe ist die tragende Aussage der ganzen Datei — deshalb hier KEINE
  // Zeilen-Regex. Review-Befund 28.08.: die erste Fassung las `needs:` nur bis zum
  // Zeilenende und haette die YAML-BLOCKFORM (`needs:` + Listenzeilen darunter) nur
  // mit ihrem ERSTEN Eintrag gesehen. Eine Abhaengigkeit an zweiter Stelle waere
  // unsichtbar geblieben, die Probe gruen — genau die Blockade, die Weg E aufloest,
  // waere still zurueckgekehrt. Ausserdem verglich sie per Teilzeichenkette, sodass
  // ein kuenftiger Job `<etwas>-jahres-ausreisser-waechter-gate` falsch angeschlagen
  // haette. Jetzt: Job-Bloecke trennen, beide YAML-Formen lesen, exakt vergleichen.
  const bloecke = [];
  const kopf = /^  ([a-z0-9-]+):[ \t]*$/gm;
  let k, letzte = null;
  while ((k = kopf.exec(YML)) !== null) {
    if (letzte) bloecke.push({ name: letzte.name, text: YML.slice(letzte.start, k.index) });
    letzte = { name: k[1], start: k.index };
  }
  if (letzte) bloecke.push({ name: letzte.name, text: YML.slice(letzte.start) });
  assert.ok(bloecke.length >= 8, 'nur ' + bloecke.length + ' Job-Bloecke erkannt — die Zerlegung greift nicht mehr');

  const nenner = [];
  for (const b of bloecke) {
    const m = /\n    needs:[ \t]*(.*)\n/.exec(b.text);
    if (!m) continue;
    let namen;
    const rest = m[1].trim();
    if (rest.startsWith('[')) {                       // Flussform: needs: [a, b]
      namen = rest.replace(/^\[|\]$/g, '').split(',');
    } else if (rest) {                                // Skalar: needs: a
      namen = [rest];
    } else {                                          // Blockform: needs:\n      - a
      const nach = b.text.slice(b.text.indexOf(m[0]) + m[0].length);
      namen = [];
      for (const zeile of nach.split('\n')) {
        const e = /^\s+-\s+(.+?)\s*$/.exec(zeile);
        if (!e) break;
        namen.push(e[1]);
      }
    }
    if (namen.map((x) => x.trim()).includes(JOB)) nenner.push(b.name);
  }
  assert.deepEqual(nenner, ['laufstatus'],
    'diese Jobs haengen am Waechter: ' + (nenner.join(', ') || '(keine)')
    + ' — erlaubt ist NUR laufstatus (if: always(), blockiert nichts). Alles andere '
    + 'stellt die Blockade wieder her, die Weg E gerade aufgeloest hat');
});

check('(f) der Sammelschritt im merge-Job nennt den Waechter nicht mehr', () => {
  // Auf den SCHRITT ankern, nicht auf die blosse Wendung: weiter oben in derselben
  // Datei steht ein Kommentar, der "Daten-Waechter einsammeln" nur ERWAEHNT
  // (Zeile ~278). Ein indexOf auf die Wendung landete dort, und das Fenster erreichte
  // den echten Sammelschritt nie — die Probe war blind und meldete gruen, waehrend
  // w_spikes wieder drinstand. Beim Brechen aufgefallen, deshalb steht es hier.
  const i = YML.indexOf('- name: Daten-Waechter einsammeln');
  assert.ok(i > 0, 'Sammelschritt nicht gefunden — wurde er umbenannt?');
  const ende = YML.indexOf('\n      - name:', i + 10);
  const block = YML.slice(i, ende > i ? ende : i + 2000);
  assert.ok(/w_exchange/.test(block), 'Fenster trifft den Sammelschritt nicht (kein w_exchange darin)');
  assert.ok(!/steps\.w_spikes\.outcome/.test(block),
    'der Sammelschritt liest w_spikes weiterhin — dann faerbt der Waechter den merge-Job '
    + 'wie zuvor rot und Weg E ist wirkungslos');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
