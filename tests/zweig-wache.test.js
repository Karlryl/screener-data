'use strict';
/** tests/zweig-wache.test.js — Standalone-Runner (node tests/zweig-wache.test.js, Exit 0/1).
 *
 * DIE ZUSICHERUNG, an der SACHE festgenagelt:
 *   KEIN Schritt in daily-pull.yml darf veroeffentlichen oder committen, ohne vorher
 *   die Zweig-Wache konsultiert zu haben.
 *
 * BEFUND (19.08.2026). daily-pull.yml traegt `on: workflow_dispatch:` ohne
 * Zweig-Einschraenkung — der Tageslauf laesst sich per Hand auf JEDEM Zweig starten.
 * Seine SECHS veroeffentlichenden Schritte trugen aber keine Zweig-Bedingung:
 *   merge      · Commit Snapshots                             -> git push (main)
 *   merge      · Deploy to GitHub Pages                       -> git push --force gh-pages
 *   scoring    · Deploy Scoring Output to GitHub Pages        -> git push --force gh-pages
 *   scoring    · Commit board-history vintage to main         -> git push origin HEAD:main
 *   scoring    · Publish board-history vintages ... (F-17a)   -> git push --force gh-pages
 *   laufstatus · Statusmarker nach gh-pages veroeffentlichen  -> git push --force gh-pages
 * Ein Handlauf von einem Feature-Zweig haette Karls live veroeffentlichte Daten mit
 * Zahlen ueberschrieben, die ungepruefter Zweig-Code gerechnet hat — per Force-Push,
 * also nicht zurueckrollbar. Ausgeloest hat es nie jemand; die Luecke war trotzdem offen.
 *
 * WARUM DIESER TEST NICHT DIE SECHS NAMEN PINNT. Eine Liste von heute Abend schuetzt
 * den Zustand von heute Abend. Der Pruefer zerlegt darum die Datei in SCHRITT-BLOECKE
 * und fragt je Block: enthaelt er eine gefaehrliche Aktion (git push / ein Pages-Deploy-
 * Action-`uses:`)? Und falls ja: wird die Wache VORHER konsultiert? Ein morgen neu
 * eingefuegter ungeschuetzter Push faellt damit genauso auf wie die sechs bekannten.
 * Vorbild der Blockzerlegung: tests/refresh-universe.test.js (pullSchritte()).
 *
 * REIHENFOLGE IST TEIL DER SACHE: eine Wache HINTER dem Push schuetzt nichts. Der
 * Pruefer sucht die Wache ausschliesslich im Kopf VOR der ersten gefaehrlichen Zeile.
 *
 * ANWESENHEIT UND ABWESENHEIT werden beide geprueft (Gegenproben unten): die
 * gueltigen Formen muessen DURCHGEHEN, die kaputten muessen auffliegen.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const YML_PFAD = path.join(__dirname, '..', '.github', 'workflows', 'daily-pull.yml');
const YML = fs.readFileSync(YML_PFAD, 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// ── Zerlegung ─────────────────────────────────────────────────────────────────
// Alle Schritte liegen auf 6 Leerzeichen Einrueckung; Job-Schluessel auf 2. Block 0
// (alles vor dem ersten Schritt) ist der Workflow-Kopf und wird verworfen.
const schritte = (yml) => yml.split(/^ {6}- name: /m).slice(1).map((b) => ({
  name: b.split('\n')[0].trim(),
  zeilen: b.split('\n'),
}));

const istKommentar = (z) => /^\s*#/.test(z);

// Was "veroeffentlichen oder committen" heisst — bewusst eng und konkret: jeder
// git-push (auch --force, auch `origin HEAD:main`) und die gaengigen Pages-Deploy-
// Actions. Kein `git fetch`, kein `git commit` ohne Push: ein lokaler Commit auf
// einem Runner, der danach weggeworfen wird, veroeffentlicht nichts.
// Review 19.08.: `git -C _ghp push` rutschte durch — und genau dieses Muster liegt nahe,
// weil die Deploy-Schritte in _ghp/_site-Klonen arbeiten. Globale git-Optionen zwischen
// `git` und `push` werden darum mitgelesen.
// ponytail: Textmuster, kein Parser. Bekannte Decke: ein Publizierer, der ueber ein
// Helfer-Skript (`node scripts/publish-x.js`) oder die Contents-API (`gh api -X PUT`)
// schreibt, faellt nicht auf. Heute ruft kein Skript unter scripts/ `git push` (geprueft).
// Aufruestpfad, wenn das je vorkommt: die Skript-Aufrufe des Blocks mitverfolgen.
const GEFAHR_RE = new RegExp(
  '(?:^|[\\s;&|(])git(?:\\s+-\\S+(?:\\s+\\S+)?)*\\s+push\\b' +
  '|uses:\\s*(?:actions/deploy-pages' +
  '|peaceiris/actions-gh-pages' +
  '|JamesIves/github-pages-deploy-action' +
  '|crazy-max/ghaction-github-pages)'
);

// Die Wache ist EINE Variable, workflow-weit definiert. Der Pruefer sucht ihren
// Namen (in jeder Schreibweise: $X, ${X}, "$X", env.X) — nicht ein bestimmtes
// if-Konstrukt. Damit bleibt auch eine spaetere andere, aber gueltige Bauform gruen.
const WACHE_RE = /VEROEFFENTLICHEN/;

/** Index der ersten gefaehrlichen (nicht auskommentierten) Zeile, sonst -1. */
function ersteGefahrZeile(zeilen) {
  for (let i = 0; i < zeilen.length; i++) {
    if (istKommentar(zeilen[i])) continue;
    if (GEFAHR_RE.test(zeilen[i])) return i;
  }
  return -1;
}

/** Wird die Wache VOR der ersten gefaehrlichen Zeile konsultiert? */
function wacheDavor(zeilen, bis) {
  return zeilen.slice(0, bis).some((z) => !istKommentar(z) && WACHE_RE.test(z));
}

function gefaehrlicheSchritte(yml) {
  return schritte(yml).filter((s) => ersteGefahrZeile(s.zeilen) >= 0).map((s) => s.name);
}

/** DIE Zusicherung: Namen aller Schritte, die ungeschuetzt veroeffentlichen. */
function ungeschuetzteSchritte(yml) {
  const befund = [];
  for (const s of schritte(yml)) {
    const i = ersteGefahrZeile(s.zeilen);
    if (i < 0) continue;
    if (!wacheDavor(s.zeilen, i)) befund.push(s.name);
  }
  return befund;
}

const gateDefinition = (yml) => {
  const m = yml.match(/^ {2}VEROEFFENTLICHEN:\s*(.+)$/m);
  return m ? m[1].trim() : null;
};

// ── Ist-Stand ─────────────────────────────────────────────────────────────────
test('ZW-1: kein veroeffentlichender Schritt laeuft ohne Zweig-Wache', () => {
  const offen = ungeschuetzteSchritte(YML);
  assert.deepEqual(offen, [],
    'Diese Schritte pushen/deployen, ohne vorher $VEROEFFENTLICHEN zu pruefen — ein Handlauf ' +
    'auf einem Feature-Zweig wuerde damit Karls live veroeffentlichte Daten ueberschreiben:\n       - ' +
    offen.join('\n       - '));
});

test('ZW-2: der Pruefer ist nicht erblindet (er findet die bekannten Publizierer noch)', () => {
  // Ein Pruefer, der NICHTS mehr als gefaehrlich erkennt, waere immer gruen. Sechs
  // Publizierer sind der Stand vom 19.08.2026; faellt einer legitim weg, ist diese
  // Zahl anzupassen — das ist der gewollte, seltene Reibungspunkt.
  const gef = gefaehrlicheSchritte(YML);
  assert.ok(gef.length >= 6,
    'nur ' + gef.length + ' veroeffentlichende Schritte erkannt (erwartet >= 6): ' + gef.join(', ') +
    ' — entweder wurde ein Publizierer entfernt (dann Zahl anpassen) oder die Erkennung ist blind geworden.');
});

test('ZW-3: die Wache haengt wirklich am Zweig (nicht an irgendeiner Bedingung)', () => {
  const def = gateDefinition(YML);
  assert.ok(def, 'workflow-weite Definition `VEROEFFENTLICHEN:` fehlt — die Wache haette keinen Wert ' +
    'und `[ "$VEROEFFENTLICHEN" != "true" ]` waere in JEDEM Lauf wahr (alles bliebe unveroeffentlicht).');
  assert.match(def, /github\.ref\s*==\s*'refs\/heads\/main'/,
    'die Definition prueft nicht mehr den Zweig: ' + def);
});

test('ZW-4: genau EIN workflow-weiter env-Block (ein zweiter loescht den ersten still)', () => {
  // Selbst gebaut und hier gepinnt: ein zweiter `env:`-Block auf Spaltenebene 0 ist
  // gueltiges YAML — der letzte gewinnt, der erste verschwindet kommentarlos. Genau so
  // waere SEC_CONTACT verschwunden und JEDER SEC-Abruf haette mit leerem User-Agent
  // still 403 kassiert.
  const n = (YML.match(/^env:$/gm) || []).length;
  assert.equal(n, 1, n + ' workflow-weite env-Bloecke — bei mehr als einem gewinnt der letzte, ' +
    'die Schluessel des ersten sind lautlos weg.');
  assert.match(YML, /^ {2}SEC_CONTACT:/m, 'SEC_CONTACT nicht mehr im workflow-weiten env');
  assert.match(YML, /^ {2}VEROEFFENTLICHEN:/m, 'VEROEFFENTLICHEN nicht mehr im workflow-weiten env');
});

test('ZW-5: das Ventil ist da und steht auf "veroeffentlichen" (sonst publiziert der Cron nie mehr)', () => {
  const block = YML.split(/^ {6}nur_rechnen:$/m)[1];
  assert.ok(block, 'workflow_dispatch-Eingabe `nur_rechnen` fehlt — es gaebe keinen dokumentierten Weg, ' +
    'einen Lauf bewusst rechnen zu lassen ohne zu publizieren.');
  assert.match(block.split('\n').slice(0, 4).join('\n'), /default:\s*false/,
    'nur_rechnen hat nicht mehr `default: false` — ein Vorgabewert true wuerde den taeglichen ' +
    'Cron-Lauf still zum Trockenlauf machen: gruen, aber Karls Boards frieren ein.');
});

test('ZW-6: die Wache verschluckt den Wert-Gate-Alarm des Vintage-Schritts nicht', () => {
  // BEFUND zweier unabhaengiger Reviews (19.08.). "Write board-history vintage" setzt bei
  // einem strittigen Tages-Delta rc=2; der Commit-Schritt macht daraus am Ende ein
  // ::error:: + exit 2 — laut scripts/write-board-history.js ausdruecklich "nie still".
  // Die erste Fassung der Zweig-Wache stand VOR dieser Pruefung und stieg mit exit 0 aus:
  // auf jedem Zweig- und jedem nur_rechnen-Lauf wurde aus dem roten X eine Warnung in
  // einem gruenen Job. Ausgerechnet im Trockenlauf, der zum Pruefen einer Aenderung da ist.
  const s = schritte(YML).find((x) => x.name === 'Commit board-history vintage to main');
  assert.ok(s, 'Schritt "Commit board-history vintage to main" nicht gefunden');
  const gStart = s.zeilen.findIndex((l) => l.includes('"$VEROEFFENTLICHEN" != "true"'));
  assert.ok(gStart > 0, 'keine Zweig-Wache in diesem Schritt');
  const gEnde = s.zeilen.findIndex((l, i) => i > gStart && /^ {10}fi$/.test(l));
  assert.ok(gEnde > gStart, 'Ende des Wache-Blocks nicht gefunden');
  const zweig = s.zeilen.slice(gStart, gEnde).join('\n');

  assert.match(zweig, /\$VINTAGE_RC" = "2"/,
    'der Wache-Zweig prueft das Wert-Gate nicht — ein SUSPECT-Vintage bliebe auf jedem '
    + 'Zweig- und Trockenlauf unsichtbar, obwohl genau dort danach gefragt wird.');
  assert.match(zweig, /::error::/, 'der Wert-Gate-Alarm im Wache-Zweig ist keine Fehlermeldung — '
    + 'eine Warnung in einem gruenen Job erreicht Karls Alarmkanal (das rote X) nicht.');
  assert.match(zweig, /exit 2/, 'der Wache-Zweig endet nicht mit exit 2 — der Job bliebe gruen.');

  // Und die Voraussetzung dafuer: dieselbe Variable wie der Alarm am Schrittende, also
  // MUSS sie vor der Wache gesetzt sein. Sonst prueft der Zweig eine leere Variable und
  // waere dauerhaft still — gruen, und niemand merkt es.
  assert.ok(s.zeilen.slice(0, gStart).some((l) => /^\s*VINTAGE_RC=/.test(l)),
    'VINTAGE_RC wird erst NACH der Wache gesetzt — im Wache-Zweig waere sie leer und der '
    + 'Alarm koennte nie feuern.');
});

// ── Gegenproben: der Pruefer muss rot werden koennen ──────────────────────────
test('ZW-S1 Sabotage: Wache an EINEM Schritt entfernt -> rot, und der Schritt wird namentlich genannt', () => {
  const opfer = 'Deploy Scoring Output to GitHub Pages';
  const zeilen = YML.split('\n');
  const start = zeilen.findIndex((z) => z.trim() === '- name: ' + opfer);
  assert.ok(start > 0, 'Opfer-Schritt nicht gefunden — dann prueft diese Gegenprobe nichts');
  const w = zeilen.findIndex((z, i) => i > start && z.includes('"$VEROEFFENTLICHEN" != "true"'));
  assert.ok(w > start && w - start < 10, 'Wache des Opfer-Schritts nicht gefunden');
  const mutiert = [...zeilen.slice(0, w), ...zeilen.slice(w + 4)].join('\n');  // if/echo/exit/fi
  assert.notEqual(mutiert, YML, 'Mutation griff nicht');
  assert.deepEqual(ungeschuetzteSchritte(mutiert), [opfer],
    'der Pruefer nennt den entwachten Schritt nicht (oder nennt zu viele)');
});

test('ZW-S2 Sabotage: ein NEUER ungeschuetzter git-push-Schritt -> rot (das ist die eigentliche Zusicherung)', () => {
  const neu =
    '      - name: Schnellkorrektur nach main\n' +
    '        run: |\n' +
    '          git commit -am "hotfix"\n' +
    '          git push origin HEAD:main\n\n';
  const mutiert = YML.replace('      - name: Commit Snapshots', neu + '      - name: Commit Snapshots');
  assert.notEqual(mutiert, YML, 'Mutation griff nicht');
  assert.deepEqual(ungeschuetzteSchritte(mutiert), ['Schnellkorrektur nach main'],
    'ein frisch eingefuegter ungeschuetzter Push bleibt unentdeckt — dann schuetzt dieser Test nur ' +
    'die sechs Schritte von heute Abend und nichts darueber hinaus.');
});

test('ZW-S3 Sabotage: Schutz vollstaendig entfernt -> rot an allen sechs', () => {
  const mutiert = YML.split('\n').filter((z) => !WACHE_RE.test(z)).join('\n');
  assert.equal(gateDefinition(mutiert), null, 'Definition muss durch die Mutation weg sein');
  assert.equal(ungeschuetzteSchritte(mutiert).length, gefaehrlicheSchritte(YML).length,
    'nach vollstaendigem Ausbau muss JEDER veroeffentlichende Schritt als ungeschuetzt gelten');
});

test('ZW-S5 Sabotage: Wert-Gate-Alarm aus dem Wache-Zweig entfernt -> ZW-6 wird rot', () => {
  // Ohne diese Gegenprobe waere ZW-6 nur eine Behauptung. Hier wird der Alarm wirklich
  // herausgeschnitten und geprueft, dass die Zusicherung faellt.
  const zeilen = YML.split('\n');
  const i = zeilen.findIndex((l) => l.includes('SUSPECT geflaggt (Wert-Gate)') && l.includes('nicht veroeffentlicht'));
  assert.ok(i > 0, 'der Alarm im Wache-Zweig ist nicht auffindbar — dann prueft diese Gegenprobe nichts');
  // Zeile davor ist das `if`, danach `exit 2` und `fi` -> die vier Zeilen raus.
  const mutiert = [...zeilen.slice(0, i - 1), ...zeilen.slice(i + 3)].join('\n');
  assert.notEqual(mutiert, YML, 'Mutation griff nicht');
  const s = schritte(mutiert).find((x) => x.name === 'Commit board-history vintage to main');
  const gStart = s.zeilen.findIndex((l) => l.includes('"$VEROEFFENTLICHEN" != "true"'));
  const gEnde = s.zeilen.findIndex((l, k) => k > gStart && /^ {10}fi$/.test(l));
  assert.doesNotMatch(s.zeilen.slice(gStart, gEnde).join('\n'), /::error::/,
    'der Alarm steht nach der Mutation immer noch im Wache-Zweig — dann belegt ZW-6 nichts.');
});

test('ZW-S4 Sabotage: Wache HINTER dem Push zaehlt nicht als Schutz', () => {
  const zeilen = [
    '        run: |',
    '          git push --force origin gh-pages',
    '          if [ "$VEROEFFENTLICHEN" != "true" ]; then exit 0; fi',
  ];
  const i = ersteGefahrZeile(zeilen);
  assert.equal(i, 1, 'die Gefahr wird nicht erkannt — dann prueft diese Gegenprobe nichts');
  assert.equal(wacheDavor(zeilen, i), false,
    'eine Wache NACH dem Push gilt als Schutz — sie schuetzt nichts, der Push ist schon raus.');
});

// ── Falsch-Rot-Proben: gueltige Formen muessen DURCHGEHEN ─────────────────────
test('ZW-G1 Gegenrichtung: eine andere, aber gueltige Schutzform bleibt gruen', () => {
  // Ein `if:` auf Schritt-Ebene ist NICHT die hier gewaehlte Bauform (ein uebersprungener
  // Schritt sieht in Actions aus wie ein erfolgreicher), er verhindert die
  // Veroeffentlichung aber genauso. Der Pruefer nagelt die SACHE fest ("kann nicht vom
  // Zweig publizieren"), nicht ein Schreibmuster — er darf hier also nicht rot werden.
  const zeilen = [
    "        if: env.VEROEFFENTLICHEN == 'true'",
    '        run: |',
    '          git push --force origin gh-pages',
  ];
  const i = ersteGefahrZeile(zeilen);
  assert.ok(i > 0);
  assert.equal(wacheDavor(zeilen, i), true, 'gueltige Alternativform faellt faelschlich durch');
});

test('ZW-G2 Gegenrichtung: harmlose Schritte gelten nicht als Publizierer', () => {
  for (const harmlos of [
    '          git fetch origin gh-pages',
    '          echo "gh-pages push attempt $i failed, retrying..."',
    '          git commit -m "lokal"',
    '          # git push --force origin gh-pages   (auskommentierte Erklaerung)',
    '          node scripts/write-board-history.js',
  ]) {
    assert.equal(ersteGefahrZeile([harmlos]), -1, 'falsch-rot bei: ' + harmlos.trim());
  }
  for (const gefahr of [
    '          git push',
    '          git push --force origin gh-pages',
    '          if git push origin HEAD:main; then ok=1; fi',
    '          git -C _ghp push --force origin gh-pages',
    '          git --git-dir=_ghp/.git push --force origin gh-pages',
    '        uses: peaceiris/actions-gh-pages@v3',
  ]) {
    assert.equal(ersteGefahrZeile([gefahr]), 0, 'muss als Publizierer gelten: ' + gefahr.trim());
  }
});

console.log('\nzweig-wache.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
