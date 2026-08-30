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
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const BRUECKE = 'studie-identity-bridge-artifact.py';
const VORPRUEFUNG = 'studie-bridge-proof-modeguard.py';
const RUNBOOK = path.join('entwurf', 'ENTWURF-r2-a1-v120-reproof-runbook.md');

// Die Flaechen, auf denen eine Aufrufreihenfolge ueberhaupt steht. Das Modul
// selbst ist ausgenommen: sein Docstring IST die Vorlage und wird unten eigens
// geprueft, statt sich hier selbst zu bestaetigen.
function ordnungstraeger() {
  const dateien = [RUNBOOK, 'package.json'];
  for (const ordner of ['entwurf', path.join('.github', 'workflows')]) {
    const voll = path.join(REPO, ordner);
    if (!fs.existsSync(voll)) continue;
    for (const name of fs.readdirSync(voll)) {
      if (/\.(md|ya?ml)$/.test(name)) dateien.push(path.join(ordner, name));
    }
  }
  return [...new Set(dateien)].filter((rel) => fs.existsSync(path.join(REPO, rel)));
}

// Ein AUFRUF, nicht bloss eine Erwaehnung: der Skriptname muss hinter einem
// Interpreter stehen. Sonst zaehlte jede Prosa-Nennung als Verdrahtung.
function aufrufIndex(text, skript) {
  const treffer = [];
  const re = new RegExp(`(?:python[0-9.]*|py)\\s+(?:-[^\\s]+\\s+)*[^\\s'"]*${
    skript.replace(/[.]/g, '\\.')}`, 'g');
  let m = re.exec(text);
  while (m) { treffer.push(m.index); m = re.exec(text); }
  return treffer;
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
    assert.ok(wache[0] < bruecke[0],
      `${rel}: die Vorpruefung steht HINTER dem Bruecken-Aufruf (Zeichen ${wache[0]} `
      + `gegen ${bruecke[0]}) — eine Wache nach dem Lauf ist keine Wache`);
  }
  assert.ok(geprueft >= 1, 'Keine einzige Ordnungsflaeche traegt den Aufruf');
});

test('Die Runbook-Zeile sagt, was ein roter Exit-Code bedeutet', () => {
  // Eine Reihenfolge ohne Konsequenz ist eine Empfehlung. Der Schritt muss
  // ausdruecklich sagen, dass der Bau bei rot NICHT gefahren wird.
  const text = fs.readFileSync(path.join(REPO, RUNBOOK), 'utf8');
  const wache = aufrufIndex(text, VORPRUEFUNG)[0];
  const bruecke = aufrufIndex(text, BRUECKE)[0];
  const dazwischen = text.slice(wache, bruecke);
  assert.match(dazwischen, /Exit-Code/i, 'Der Schritt nennt keinen Exit-Code');
  assert.match(dazwischen, /nicht gefahren|NICHT gefahren|kein Bau|abgebrochen/,
    'Der Schritt sagt nicht, dass ein roter Exit-Code den Bau verhindert');
});

test('Der Docstring des Moduls traegt dieselbe Ordnung wie das Runbook', () => {
  // Vorlage und Verdrahtung duerfen nicht auseinanderlaufen: sonst steht die
  // Reihenfolge zweimal da und irgendwann verschieden.
  const quelle = fs.readFileSync(path.join(REPO, 'scripts', VORPRUEFUNG), 'utf8');
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
  assert.equal(aufrufIndex(`python scripts/${BRUECKE} --discovery x`, BRUECKE).length, 1);
  assert.equal(aufrufIndex(`python3 scripts/${BRUECKE}`, BRUECKE).length, 1);
  assert.equal(aufrufIndex(`Das Skript \`scripts/${BRUECKE}\` ist gepinnt.`, BRUECKE).length, 0,
    'Eine Prosa-Nennung darf nicht als Verdrahtung zaehlen');
  assert.equal(aufrufIndex('python scripts/etwas-anderes.py', BRUECKE).length, 0);
});
