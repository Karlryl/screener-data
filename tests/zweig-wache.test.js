'use strict';
/** tests/zweig-wache.test.js — Standalone-Runner (node tests/zweig-wache.test.js, Exit 0/1).
 *
 * DIE ZUSICHERUNG, an der SACHE festgenagelt:
 *   KEIN Schritt in KEINEM Workflow unter .github/workflows/ darf veroeffentlichen
 *   oder committen, ohne vorher die Zweig-Wache konsultiert zu haben.
 *
 * BEFUND (19.08.2026). Jeder Workflow dieses Repos ausser pr-check.yml traegt
 * `workflow_dispatch` ohne Zweig-Einschraenkung — er laesst sich per Hand auf JEDEM
 * Zweig starten. FUENF davon pushen. Ihre veroeffentlichenden Schritte trugen keine
 * Zweig-Bedingung:
 *   daily-pull.yml          6 Schritte (1x main, 4x --force gh-pages, 1x board-history)
 *   monthly-plan-check.yml  1 Schritt  -> git push origin HEAD:main
 *   monthly-sec-xbrl.yml    1 Schritt  -> git push (SEC-Manifest + sec-secannual)
 *   smallcap-pull.yml       1 Schritt  -> git push origin HEAD:main
 *   weekly-guard.yml        1 Schritt  -> git push origin HEAD:main
 * Die drei `HEAD:main`-Schritte rebasen vorher den Zweig auf main: ein Handlauf von
 * einem Feature-Zweig haette also nicht nur eine Datei, sondern den GANZEN ungeprueften
 * Zweig nach main veroeffentlicht. Ausgeloest hat es nie jemand; die Luecke war offen.
 *
 * WARUM DIESER TEST KEINE SCHRITT-NAMEN PINNT. Eine Liste von heute Abend schuetzt
 * den Zustand von heute Abend. Der Pruefer zerlegt jede Datei in SCHRITT-BLOECKE und
 * fragt je Block: enthaelt er eine gefaehrliche Aktion (git push / ein Pages-Deploy-
 * Action-`uses:`)? Und falls ja: wird die Wache VORHER konsultiert? Ein morgen neu
 * eingefuegter ungeschuetzter Push faellt damit genauso auf wie die bekannten.
 * Vorbild der Blockzerlegung: tests/refresh-universe.test.js (pullSchritte()).
 *
 * UND ER PINNT AUCH DIE DATEILISTE NICHT (ZW-0): er liest .github/workflows/ selbst
 * und besteht darauf, dass die Menge der pushenden Dateien exakt die Registry unten
 * ist. Ein NEUER Workflow mit einem Push faellt auf, statt still ungeschuetzt zu leben.
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

const WF_DIR = path.join(__dirname, '..', '.github', 'workflows');
const lies = (datei) => fs.readFileSync(path.join(WF_DIR, datei), 'utf8');

/** Die geschuetzten Workflows.
 *  mindestPublizierer — Blindheits-Bremse: faellt die Zahl der erkannten Publizierer
 *    darunter, ist entweder einer legitim entfernt worden (Zahl anpassen) oder die
 *    Erkennung ist blind geworden (dann waere JEDER Test hier immer gruen).
 *  envSchluessel — was im workflow-weiten env-Block stehen MUSS. Ein zweiter env-Block
 *    auf Spaltenebene 0 ist gueltiges YAML und loescht den ersten still; genau so waere
 *    beim Bau SEC_CONTACT verschwunden und jeder SEC-Abruf haette lautlos 403 kassiert.
 */
const REGISTRY = [
  { datei: 'daily-pull.yml',         mindestPublizierer: 6, envSchluessel: ['SEC_CONTACT', 'VEROEFFENTLICHEN', 'NUR_RECHNEN'] },
  { datei: 'monthly-plan-check.yml', mindestPublizierer: 1, envSchluessel: ['VEROEFFENTLICHEN'] },
  { datei: 'monthly-sec-xbrl.yml',   mindestPublizierer: 1, envSchluessel: ['SEC_CONTACT', 'VEROEFFENTLICHEN'] },
  { datei: 'smallcap-pull.yml',      mindestPublizierer: 1, envSchluessel: ['SHARD_COUNT', 'VEROEFFENTLICHEN'] },
  { datei: 'weekly-guard.yml',       mindestPublizierer: 1, envSchluessel: ['VEROEFFENTLICHEN'] },
];

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
// schreibt, faellt nicht auf. Heute ruft kein Skript unter scripts/ `git push` und kein
// Workflow `gh api` oder eine Deploy-Action (beides 19.08. geprueft).
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

/** Schneidet die Wache aus EINEM Schritt heraus (fuer die Sabotage-Gegenproben).
 *  BEIDE gueltigen Bauformen werden bedient — sonst waere diese Gegenprobe selbst ein
 *  Schreibmuster-Pruefer und wuerde falsch-rot, sobald ein Workflow legitim auf die
 *  andere Form wechselt (an echter Sabotage am 19.08. aufgefallen):
 *    run-Block-Wache -> alles vom `if [ "$VEROEFFENTLICHEN" ... ]` bis zum `fi` auf
 *      derselben Einrueckung (haelt damit auch den laengeren Wache-Block des
 *      Vintage-Schritts, dessen inneres `fi` tiefer steht),
 *    `if:` am Schritt -> genau diese eine Zeile. */
function wacheRaus(yml, schrittName) {
  const z = yml.split('\n');
  const start = z.findIndex((l) => l.trim() === '- name: ' + schrittName);
  assert.ok(start > 0, 'Opfer-Schritt nicht gefunden: ' + schrittName);
  const w = z.findIndex((l, i) => i > start && !istKommentar(l) && WACHE_RE.test(l));
  assert.ok(w > start, 'Wache des Opfer-Schritts nicht gefunden: ' + schrittName);
  if (!z[w].includes('"$VEROEFFENTLICHEN" != "true"')) {
    return [...z.slice(0, w), ...z.slice(w + 1)].join('\n');   // `if:`-Form: eine Zeile
  }
  const einr = z[w].match(/^\s*/)[0];
  const ende = z.findIndex((l, i) => i > w && l === einr + 'fi');
  assert.ok(ende > w, 'Ende des Wache-Blocks nicht gefunden: ' + schrittName);
  return [...z.slice(0, w), ...z.slice(ende + 1)].join('\n');
}

// ── ZW-0: die Dateiliste wird gelesen, nicht geglaubt ─────────────────────────
test('ZW-0: genau die registrierten Workflows pushen (ein neuer Publizierer faellt auf)', () => {
  const alle = fs.readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
  assert.ok(alle.length >= 11, 'nur ' + alle.length + ' Workflow-Dateien gefunden — Verzeichnis richtig?');
  const pushend = alle.filter((f) =>
    lies(f).split('\n').some((z) => !istKommentar(z) && GEFAHR_RE.test(z))).sort();
  assert.deepEqual(pushend, REGISTRY.map((r) => r.datei).sort(),
    'Die Menge der veroeffentlichenden Workflows weicht von der Registry ab.\n' +
    '       gefunden:     ' + pushend.join(', ') + '\n' +
    '       registriert:  ' + REGISTRY.map((r) => r.datei).sort().join(', ') + '\n' +
    '       Ein NEUER Workflow mit git push muss in die Registry (und eine Wache bekommen); ' +
    'faellt einer legitim weg, gehoert er hier raus.');
});

// ── Ist-Stand, je Workflow ────────────────────────────────────────────────────
for (const wf of REGISTRY) {
  const YML = lies(wf.datei);

  test('ZW-1 [' + wf.datei + ']: kein veroeffentlichender Schritt laeuft ohne Zweig-Wache', () => {
    const offen = ungeschuetzteSchritte(YML);
    assert.deepEqual(offen, [],
      'Diese Schritte pushen/deployen, ohne vorher $VEROEFFENTLICHEN zu pruefen — ein Handlauf ' +
      'auf einem Feature-Zweig wuerde damit Karls Repo bzw. seine live veroeffentlichten Daten ' +
      'ueberschreiben:\n       - ' + offen.join('\n       - '));
  });

  test('ZW-2 [' + wf.datei + ']: der Pruefer ist nicht erblindet (er findet die Publizierer noch)', () => {
    const gef = gefaehrlicheSchritte(YML);
    assert.ok(gef.length >= wf.mindestPublizierer,
      'nur ' + gef.length + ' veroeffentlichende Schritte erkannt (erwartet >= ' + wf.mindestPublizierer +
      '): ' + gef.join(', ') + ' — entweder wurde ein Publizierer entfernt (dann Zahl anpassen) ' +
      'oder die Erkennung ist blind geworden.');
  });

  test('ZW-3 [' + wf.datei + ']: die Wache haengt wirklich am Zweig (nicht an irgendeiner Bedingung)', () => {
    const def = gateDefinition(YML);
    assert.ok(def, 'workflow-weite Definition `VEROEFFENTLICHEN:` fehlt — die Wache haette keinen Wert ' +
      'und `[ "$VEROEFFENTLICHEN" != "true" ]` waere in JEDEM Lauf wahr (alles bliebe unveroeffentlicht).');
    assert.match(def, /github\.ref\s*==\s*'refs\/heads\/main'/,
      'die Definition prueft nicht mehr den Zweig: ' + def);
  });

  test('ZW-4 [' + wf.datei + ']: genau EIN workflow-weiter env-Block (ein zweiter loescht den ersten still)', () => {
    const n = (YML.match(/^env:$/gm) || []).length;
    assert.equal(n, 1, n + ' workflow-weite env-Bloecke — bei mehr als einem gewinnt der letzte, ' +
      'die Schluessel des ersten sind lautlos weg.');
    for (const k of wf.envSchluessel) {
      assert.match(YML, new RegExp('^ {2}' + k + ':', 'm'), k + ' nicht mehr im workflow-weiten env');
    }
  });

  // ── Gegenproben je Workflow: der Pruefer muss hier rot werden koennen ───────
  test('ZW-S1 [' + wf.datei + '] Sabotage: Wache an EINEM Schritt entfernt -> rot, Schritt namentlich', () => {
    const opfer = schritte(YML).find((s) => ersteGefahrZeile(s.zeilen) >= 0).name;
    const mutiert = wacheRaus(YML, opfer);
    assert.notEqual(mutiert, YML, 'Mutation griff nicht');
    assert.deepEqual(ungeschuetzteSchritte(mutiert), [opfer],
      'der Pruefer nennt den entwachten Schritt nicht (oder nennt zu viele)');
  });

  test('ZW-S2 [' + wf.datei + '] Sabotage: ein NEUER ungeschuetzter git-push-Schritt -> rot', () => {
    const erster = schritte(YML)[0].name;
    const neu =
      '      - name: Schnellkorrektur nach main\n' +
      '        run: |\n' +
      '          git commit -am "hotfix"\n' +
      '          git push origin HEAD:main\n\n';
    const mutiert = YML.replace('      - name: ' + erster, neu + '      - name: ' + erster);
    assert.notEqual(mutiert, YML, 'Mutation griff nicht');
    assert.deepEqual(ungeschuetzteSchritte(mutiert), ['Schnellkorrektur nach main'],
      'ein frisch eingefuegter ungeschuetzter Push bleibt unentdeckt — dann schuetzt dieser Test nur ' +
      'die Schritte von heute Abend und nichts darueber hinaus.');
  });

  test('ZW-S3 [' + wf.datei + '] Sabotage: Schutz vollstaendig entfernt -> rot an ALLEN Publizierern', () => {
    const mutiert = YML.split('\n').filter((z) => !WACHE_RE.test(z)).join('\n');
    assert.equal(gateDefinition(mutiert), null, 'Definition muss durch die Mutation weg sein');
    assert.equal(ungeschuetzteSchritte(mutiert).length, gefaehrlicheSchritte(YML).length,
      'nach vollstaendigem Ausbau muss JEDER veroeffentlichende Schritt als ungeschuetzt gelten');
  });
}

// ── Nur daily-pull.yml: Ventil und Wert-Gate ──────────────────────────────────
const DAILY = lies('daily-pull.yml');

test('ZW-5: das Ventil ist da und steht auf "veroeffentlichen" (sonst publiziert der Cron nie mehr)', () => {
  // Nur daily-pull hat `nur_rechnen`: dort deckt es einen 4-Stunden-Lauf mit sechs
  // Publizierern ab, den man auf main einmal komplett durchrechnen lassen will. Bei den
  // vier anderen ist der Trockenlauf jetzt einfach der Zweig-Lauf — deshalb kein Ventil.
  const block = DAILY.split(/^ {6}nur_rechnen:$/m)[1];
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
  const s = schritte(DAILY).find((x) => x.name === 'Commit board-history vintage to main');
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

test('ZW-S5 Sabotage: Wert-Gate-Alarm aus dem Wache-Zweig entfernt -> ZW-6 wird rot', () => {
  // Ohne diese Gegenprobe waere ZW-6 nur eine Behauptung. Hier wird der Alarm wirklich
  // herausgeschnitten und geprueft, dass die Zusicherung faellt.
  const zeilen = DAILY.split('\n');
  const i = zeilen.findIndex((l) => l.includes('SUSPECT geflaggt (Wert-Gate)') && l.includes('nicht veroeffentlicht'));
  assert.ok(i > 0, 'der Alarm im Wache-Zweig ist nicht auffindbar — dann prueft diese Gegenprobe nichts');
  // Zeile davor ist das `if`, danach `exit 2` und `fi` -> die vier Zeilen raus.
  const mutiert = [...zeilen.slice(0, i - 1), ...zeilen.slice(i + 3)].join('\n');
  assert.notEqual(mutiert, DAILY, 'Mutation griff nicht');
  const s = schritte(mutiert).find((x) => x.name === 'Commit board-history vintage to main');
  const gStart = s.zeilen.findIndex((l) => l.includes('"$VEROEFFENTLICHEN" != "true"'));
  const gEnde = s.zeilen.findIndex((l, k) => k > gStart && /^ {10}fi$/.test(l));
  assert.doesNotMatch(s.zeilen.slice(gStart, gEnde).join('\n'), /::error::/,
    'der Alarm steht nach der Mutation immer noch im Wache-Zweig — dann belegt ZW-6 nichts.');
});

// ── Bauform-Gegenproben (einmal, sie pruefen den Pruefer selbst) ──────────────
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
    "  group: ${{ github.event_name == 'workflow_dispatch' && format('manual-{0}', github.run_id) || 'main-push' }}",
  ]) {
    assert.equal(ersteGefahrZeile([harmlos]), -1, 'falsch-rot bei: ' + harmlos.trim());
  }
  for (const gefahr of [
    '          git push',
    '          git push --force origin gh-pages',
    '          if git push origin HEAD:main; then ok=1; fi',
    '          git -C _ghp push --force origin gh-pages',
    '          git --git-dir=_ghp/.git push --force origin gh-pages',
    '              if git pull --rebase --autostash origin main && git push origin HEAD:main; then :; fi',
    '        uses: peaceiris/actions-gh-pages@v3',
  ]) {
    assert.ok(ersteGefahrZeile([gefahr]) >= 0, 'muss als Publizierer gelten: ' + gefahr.trim());
  }
});

console.log('\nzweig-wache.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
