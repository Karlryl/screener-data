'use strict';

// T183 — Die H6-Vorpruefung als ERZWUNGENER Schritt statt als Handaufruf.
//
// DIE SACHE: `scripts/studie-bridge-proof-modeguard.py` liegt seit PR #109 mit
// neun Waechtern auf main und schliesst den H6-Befund inhaltlich. Die
// AUFRUFREIHENFOLGE stand danach aber ausschliesslich im Docstring des Moduls —
// kein Workflow, keine Runbook-Zeile, kein Skript-Aufruf hat sie erzwungen. Wer
// `studie-identity-bridge-artifact.py` direkt startet, umgeht das Tor
// vollstaendig; im gepinnten Skript ist das Loch unveraendert vorhanden
// (Akte `akte-bruecken-addendum-H6H7M13-2026-08-30.md` §2.3, „Restloch").
//
// WAS HIER GEHT UND WAS NICHT — ehrlich benannt:
// Das Bruecken-Skript ist byte-gepinnt (`r2-a1-v120-closure-record.json`,
// `40669a86…`). Ein Tor IM Skript waere die staerkste Form und ist genau deshalb
// nicht baubar, ohne ein gepinntes Byte anzufassen. Erzwingbar ist deshalb die
// REIHENFOLGE ueberall dort, wo der Bruecken-Aufruf ueberhaupt aufgeschrieben
// ist: Runbook, Workflow, npm-Skript. Aus dem Docstring-Satz wird damit eine
// maschinell gehaltene Ordnung — und ein neuer Aufruf, der die Vorpruefung
// vergisst, faerbt rot, statt still zu existieren.
//
// Der Waechter haengt am OBJEKT (dem Aufruf des Bruecken-Skripts), nicht an
// einem Textmuster einer bestimmten Zeile: er sucht JEDE Datei, die den Aufruf
// traegt, und verlangt in derselben Datei eine Vorpruefung DAVOR.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const BRUECKE = 'studie-identity-bridge-artifact.py';
const VORPRUEFUNG = 'studie-bridge-proof-modeguard.py';
const RUNBOOK = path.join('entwurf', 'ENTWURF-r2-a1-v120-reproof-runbook.md');

// JEDE getrackte Datei, die den Bruecken-Skriptnamen ueberhaupt traegt — nicht
// eine Ordner-/Endungsliste. Eine Liste waere genau das vacuous-green-Loch: ein
// neuer Aufrufort (Makefile, scripts/run-bridge.py, entwurf/ci/bridge.yml,
// pyproject.toml) liefe stumm daran vorbei, waehrend der Test gruen bliebe.
// Ausgenommen sind nur zwei Selbstbezuege: das Vorpruefungs-Modul (sein Docstring
// IST die Vorlage und wird unten eigens geprueft) und diese Testdatei selbst
// (ihre eigenen Proben enthalten Beispiel-Kommandos).
const NICHT_ORDNUNGSFLAECHE = [
  `scripts/${VORPRUEFUNG}`,
  'tests/studie-h6-vorpruefung-verdrahtung.test.js',
];

function ordnungstraeger() {
  const lauf = spawnSync('git', ['grep', '-lF', BRUECKE, '--', '.'],
    { cwd: REPO, encoding: 'utf8' });
  assert.ok(lauf.status === 0 || lauf.status === 1,
    `git grep ist nicht gelaufen: ${lauf.stderr}`);
  return (lauf.stdout || '').split(/\r?\n/)
    .filter((rel) => rel && !NICHT_ORDNUNGSFLAECHE.includes(rel))
    .filter((rel) => fs.existsSync(path.join(REPO, rel)));
}

// Ein AUFRUF, nicht bloss eine Erwaehnung. Zwei Formen, damit kein Runner
// durchrutscht:
//   (a) bekannter Interpreter/Runner vor dem Skript — `python`, `py3.12`,
//       `uv run`, `poetry run`, `$PYTHON`;
//   (b) Skript unmittelbar gefolgt von einem Kommandozeilen-Schalter — faengt
//       jeden Runner, den (a) nicht kennt. Prosa traegt keinen `--schalter`.
// Der Lookbehind haelt "copy scripts/…py" heraus: ohne ihn zaehlte das `py` am
// Wortende von "copy" als Interpreter.
const RUNNER = 'python[0-9.]*|py|uv\\s+run|poetry\\s+run|pipenv\\s+run'
  + '|\\$\\{?PYTHON\\}?|%PYTHON%';

function aufrufIndex(text, skript) {
  const s = skript.replace(/[.]/g, '\\.');
  const re = new RegExp(
    `(?<![A-Za-z])(?:${RUNNER})\\s+(?:-[^\\s]+\\s+)*[^\\s'"]*${s}`
    + `|[^\\s'"\`]*${s}(?=\\s+-{1,2}[A-Za-z])`, 'g');
  const treffer = new Set();
  let m = re.exec(text);
  while (m) { treffer.add(m.index); m = re.exec(text); }
  return [...treffer].sort((a, b) => a - b);
}

test('Das Modul und sein Waechter sind ueberhaupt da', () => {
  for (const rel of [path.join('scripts', VORPRUEFUNG), path.join('scripts', BRUECKE),
    RUNBOOK]) {
    assert.ok(fs.existsSync(path.join(REPO, rel)), `${rel} fehlt`);
  }
});

test('Der Runbook-Lauf ruft das Bruecken-Skript ueberhaupt auf', () => {
  // Ohne diese Zeile waere die Ordnungspruefung unten eine leere Schleife: kein
  // Aufruf, keine Verletzung, ewiges Gruen.
  const text = fs.readFileSync(path.join(REPO, RUNBOOK), 'utf8');
  assert.ok(aufrufIndex(text, BRUECKE).length >= 1,
    `${RUNBOOK} nennt keinen Aufruf von ${BRUECKE} mehr — die Verdrahtung haengt in der Luft`);
});

test('Kein Bruecken-Aufruf ohne Vorpruefung DAVOR — auf jeder Ordnungsflaeche', () => {
  let geprueft = 0;
  for (const rel of ordnungstraeger()) {
    const text = fs.readFileSync(path.join(REPO, rel), 'utf8');
    const bruecke = aufrufIndex(text, BRUECKE);
    if (bruecke.length === 0) continue;
    geprueft += 1;
    const wache = aufrufIndex(text, VORPRUEFUNG);
    assert.ok(wache.length >= 1,
      `${rel} startet ${BRUECKE}, ruft aber nie ${VORPRUEFUNG} — das Tor ist umgangen`);
    // JEDER Bruecken-Aufruf, nicht nur der erste: ein zweiter Aufruf weiter
    // unten (Rollback-Notiz, zweiter Block) darf sich nicht am Schutz des
    // ersten waermen.
    const ungedeckt = bruecke.filter((b) => !wache.some((w) => w < b));
    assert.deepEqual(ungedeckt, [],
      `${rel}: Bruecken-Aufruf(e) an Zeichen ${ungedeckt} ohne Vorpruefung davor `
      + `(Wachen an ${wache}) — eine Wache nach dem Lauf ist keine Wache`);
  }
  assert.ok(geprueft >= 1, 'Keine einzige Ordnungsflaeche traegt den Aufruf');
});

// DECKE, benannt: die Pruefung ist DATEIWEISE. Ein Aufruf in Datei A, dessen
// Vorpruefung nur in Datei B steht (Composite-Action, zwei Makefile-Ziele in
// getrennten Dateien), gilt hier als ungedeckt — der Test wird dann rot, nicht
// blind. Das ist die sichere Richtung; wer so verdrahtet, muss die Wache in
// dieselbe Datei holen oder diese Regel bewusst aendern.

test('Die Runbook-Zeile sagt, was ein roter Exit-Code bedeutet', () => {
  // Eine Reihenfolge ohne Konsequenz ist eine Empfehlung. Der Schritt muss
  // ausdruecklich sagen, dass der Bau bei rot NICHT gefahren wird.
  const text = fs.readFileSync(path.join(REPO, RUNBOOK), 'utf8');
  const wache = aufrufIndex(text, VORPRUEFUNG)[0];
  const bruecke = aufrufIndex(text, BRUECKE)[0];
  // Ohne diese Zeile wuerde `slice(undefined, x)` still zu `slice(0, x)` und der
  // Test liefe ueber den halben Runbook-Text — er faende "Exit-Code" dort
  // zufaellig und ginge gruen durch, obwohl ein Aufruf fehlt.
  assert.ok(wache !== undefined && bruecke !== undefined,
    `Dem Runbook fehlt einer der beiden Aufrufe (Wache ${wache}, Bruecke ${bruecke})`);
  const dazwischen = text.slice(wache, bruecke);
  assert.match(dazwischen, /Exit-Code/i, 'Der Schritt nennt keinen Exit-Code');
  // ponytail: Wortkopplung, bewusst. Eine Umformulierung faerbt rot, ohne dass
  // die Verdrahtung kaputt waere — dann gehoert die neue Formulierung hier
  // hinein, nicht die Bedingung heraus.
  assert.match(dazwischen, /nicht gefahren|NICHT gefahren|kein Bau|abgebrochen/,
    'Der Schritt sagt nicht, dass ein roter Exit-Code den Bau verhindert');
});

test('Die Konsequenz nennt die Schrittnummer, die den Bruecken-Aufruf traegt', () => {
  // Genau die Falle, die beim Einfuegen des neuen Schrittes zugeschlagen hat:
  // eine Nummer im Text, die nach dem Umnummerieren woandershin zeigt.
  const text = fs.readFileSync(path.join(REPO, RUNBOOK), 'utf8');
  const bruecke = aufrufIndex(text, BRUECKE)[0];
  const schritte = [...text.slice(0, bruecke).matchAll(/^(\d+)\.\s/gm)];
  assert.ok(schritte.length >= 1, 'Vor dem Bruecken-Aufruf steht kein nummerierter Schritt');
  const nummer = schritte[schritte.length - 1][1];
  const wache = aufrufIndex(text, VORPRUEFUNG)[0];
  assert.match(text.slice(wache, bruecke), new RegExp(`Schritt ${nummer}\\b`),
    `Die Konsequenz nennt nicht Schritt ${nummer} — genau den, der den Bau startet`);
});

test('Der Docstring des Moduls traegt dieselbe Ordnung wie das Runbook', () => {
  // Vorlage und Verdrahtung duerfen nicht auseinanderlaufen: sonst steht die
  // Reihenfolge zweimal da und irgendwann verschieden.
  const quelle = fs.readFileSync(path.join(REPO, 'scripts', VORPRUEFUNG), 'utf8');
  // Annahme, hier benannt: das ERSTE Dreifach-Anfuehrungspaar der Datei ist der
  // Modul-Docstring. Wer darin ein `"""` einbettet, schneidet diese Probe ab.
  const auf = quelle.indexOf('"""');
  assert.notEqual(auf, -1, 'Das Modul hat keinen Docstring mehr');
  const doku = quelle.slice(auf + 3, quelle.indexOf('"""', auf + 3));
  const wache = aufrufIndex(doku, VORPRUEFUNG);
  const bruecke = aufrufIndex(doku, BRUECKE);
  assert.ok(wache.length >= 1 && bruecke.length >= 1,
    'Der Docstring nennt die Aufrufreihenfolge nicht mehr');
  assert.ok(wache[0] < bruecke[0], 'Der Docstring nennt die Vorpruefung nach dem Bau');
});

test('Der Aufruf-Erkenner unterscheidet Aufruf von blosser Erwaehnung', () => {
  // Positiv- und Negativprobe des Werkzeugs selbst. Ohne sie waere ein gruener
  // Lauf oben nicht von einem Erkenner zu unterscheiden, der nie etwas findet.
  for (const kommando of [
    `python scripts/${BRUECKE} --discovery x`,
    `python3 scripts/${BRUECKE}`,
    `py -3 scripts/${BRUECKE}`,
    `uv run scripts/${BRUECKE} --discovery x`,      // Runner ohne "python"
    `poetry run scripts/${BRUECKE} --discovery x`,
    `$PYTHON scripts/${BRUECKE} --discovery x`,
    `make-irgendwas scripts/${BRUECKE} --discovery x`,  // nur ueber den Schalter
  ]) {
    assert.equal(aufrufIndex(kommando, BRUECKE).length, 1, `nicht erkannt: ${kommando}`);
  }
  assert.equal(aufrufIndex(`Das Skript \`scripts/${BRUECKE}\` ist gepinnt.`, BRUECKE).length, 0,
    'Eine Prosa-Nennung darf nicht als Verdrahtung zaehlen');
  assert.equal(aufrufIndex(`Copy scripts/${BRUECKE} ins Archiv.`, BRUECKE).length, 0,
    "Das 'py' am Ende von 'Copy' darf nicht als Interpreter zaehlen");
  assert.equal(aufrufIndex('python scripts/etwas-anderes.py', BRUECKE).length, 0);
});
