'use strict';
/**
 * tests/t564-datenkanal.test.js — Waechter fuer die Haertungen aus dem Tag-564-Review
 * des F-17a-Publish (oeffentlicher Datenkanal fuer Termin-Kalender + Bewegungs-Anzeige),
 * nachgeschaerft im Tag-568-Review (T568-F1..F9).
 *
 * Vier Befunde, alle mit Repro belegt, alle an einem gemeinsamen Fehlermuster:
 * der Kanal kann still das Falsche zeigen, ohne dass irgendwo etwas rot wird.
 *
 * T564-B2 (daily-pull.yml, Publish-Schritt): die Retry-Schleife holte den Remote-Stand
 *   erst ab Versuch 2 (`if [ "$i" -gt 1 ]`). Anders als bei den beiden Deploy-Schritten
 *   ist der _ghp-Klon hier NICHT frisch: zwischen Klonen und Publish liegen vier
 *   Schritte (Vintage schreiben, Wert-Gate, main-Commit, Publish). Ein parallel
 *   laufender Lauf (manuell + geplant, siehe R1-SK-003) haette schon im ERSTEN Versuch
 *   per Force-Push zurueckgerollt. -> Fetch+Reset muss unbedingt laufen, ohne Guard.
 *
 * T564-B1 (heartbeat.yml): die Frische-Sonde mass nur den v1-Export. Zwischen
 *   Board-Deploy und Vintage-Publish liegen vier Schritte; scheitert einer, bleibt der
 *   Export frisch, waehrend der Bewegungs-Kanal unbegrenzt lange alt steht — findash
 *   zeigt dann heutige Boards mit gestrigen Pfeilen. Zweite Sonde noetig.
 *
 * T564-B5 (mitgeloest in derselben Sonde): <2 Vintages im Kanal = die Bewegungs-Anzeige
 *   bleibt leer (findash vergleicht die zwei juengsten Staende). stage-public-data.js
 *   kann das nur als ::warning:: melden — kein Kanal, den Karl sieht.
 *
 * T564-B6 (daily-pull.yml, merge-Deploy): der Kalender-cp erbt ein `|| true`; faellt
 *   die frisch gestagete earnings-calendar.json aus, deployt der Schritt gruen ohne sie.
 *
 * T564-B4 (.gitignore): _public/ und _ghp/ sind Runner-Scratch und gehoeren nie ins Repo.
 *
 * ── Tag-568-Review: dieselben Waechter waren teils blind ─────────────────────────────
 * T568-F1: der B2-Check war ein Regex-NEGATIV der Schreibweise (`$i" -gt 1`). Repro M11:
 *   `if [ "$i" != 1 ]` baut denselben Bug wieder ein und laesst den Test GRUEN (ebenso
 *   `-ne`, `((i>1))`, `||`-Formen). Ersetzt durch einen POSITIV-Pin am Objekt: der erste
 *   ausfuehrbare Befehl im Schleifenkoerper MUSS der Fetch sein — dann ist gar kein Platz
 *   fuer eine Bedingung, egal in welcher Schreibweise.
 * T568-F2: die B1-Asserts suchten ::error::/exit(1) in der GANZEN Sonde — der zweite
 *   Zweig (n<2) erfuellte sie mit. Repro M2/M4/M7: der komplette Veraltungs-Zweig liess
 *   sich entfernen, alle Checks blieben gruen. Jetzt am benannten Zweig geprueft.
 * T568-F3: `indexOf('git add -A', iCheck)` liefert -1, wenn der Anker fehlt; `slice(i,-1)`
 *   lief dann bis zum Datei-Ende. Repro M12: eine Kalender-Pruefung HINTER dem Push blieb
 *   gruen. Jetzt wird der Anker selbst asserted (iAdd > iCmp).
 * T568-F7: die Sonde mass nur den Wanduhr-Stempel des Publish. Sie misst jetzt zusaetzlich
 *   das DATUM des juengsten Vintages gegen dieselbe Schwelle.
 * T568-F8: `schritt()` schnitt bis zum naechsten `- name:` — der Kommentarblock des
 *   FOLGE-Schritts (7 Zeilen) wanderte mit in die Sektion und konnte Suchen erfuellen,
 *   die im Schritt selbst nichts finden. Jetzt werden Kommentar-/Leerzeilen am Ende
 *   abgeschnitten.
 * T568-F9: die Sonde darf nie per continue-on-error entschaerft werden.
 *
 * Struktur-Test am OBJEKT (gleiche Bauart wie tests/scoring/h-ghpages-deploy-retry-test.js
 * und bh-b10-otheryml.test.js): geprueft wird der benannte Schritt bzw. der benannte
 * Zweig, nicht die ganze Datei, und Anwesenheit UND Abwesenheit. Jeder Check wurde durch
 * Ausbau des Fixes rot gesehen.
 *
 * Run: node tests/t564-datenkanal.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const daily = lies(path.join('.github', 'workflows', 'daily-pull.yml'));
const heartbeat = lies(path.join('.github', 'workflows', 'heartbeat.yml'));
const gitignore = lies('.gitignore');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

/**
 * Den Rumpf EINES benannten Workflow-Schritts schneiden (bis zum naechsten Listenpunkt
 * auf Schritt-Ebene). T568-F8: der Kommentarblock des FOLGENDEN Schritts steht zwischen
 * beiden und gehoert NICHT in die Sektion — Kommentar- und Leerzeilen am Ende fallen
 * darum weg. Sonst kann eine Suche an einem Kommentar des Nachbarn gruen werden.
 */
function schritt(text, startMarker) {
  const s = text.indexOf(startMarker);
  assert.ok(s >= 0, 'Schritt nicht gefunden: ' + startMarker);
  let e = text.indexOf('\n      - ', s + startMarker.length);
  if (e < 0) e = text.length;
  const zeilen = text.slice(s, e).split('\n');
  while (zeilen.length && /^\s*(#.*)?$/.test(zeilen[zeilen.length - 1])) zeilen.pop();
  return zeilen.join('\n');
}

/** Der Koerper der `for i in 1 2 3; do ... done`-Schleife innerhalb eines Schritts. */
function schleifenKoerper(section) {
  const lines = section.split('\n');
  const body = [];
  let started = false;
  for (const line of lines) {
    if (!started) { if (line.includes('for i in 1 2 3; do')) started = true; continue; }
    if (line.trim() === 'done') break;
    body.push(line);
  }
  assert.ok(started, 'Retry-Schleife ("for i in 1 2 3; do") nicht gefunden');
  return body.join('\n');
}

/** Die erste ausfuehrbare (Nicht-Kommentar-, Nicht-Leer-)Zeile eines Shell-Blocks. */
function ersterBefehl(block) {
  for (const zeile of block.split('\n')) {
    const t = zeile.trim();
    if (t === '' || t.startsWith('#')) continue;
    return t;
  }
  return '';
}

/**
 * Einen Anker pinnen, der GENAU EINMAL vorkommen muss. Ein zweites Vorkommen (typisch:
 * derselbe Ausdruck noch einmal in einem Meldungstext) koennte die Suche erfuellen,
 * waehrend die gemeinte Stelle laengst ausgebaut ist — die Fehlerklasse, die den
 * Tag-568-Review ausgeloest hat.
 */
function einmalig(text, re, meldung) {
  const m = re.exec(text);
  assert.ok(m, meldung);
  assert.ok(!re.test(text.slice(m.index + m[0].length)),
    'der Anker ' + re + ' kommt mehrfach vor — ein zweites Vorkommen koennte die Pruefung '
    + 'gruen halten, waehrend die gemeinte Stelle kaputt ist.');
}

/**
 * Den Rumpf EINES benannten if-Zweigs schneiden (ab der oeffnenden Klammer,
 * klammer-balanciert) — damit eine Zusicherung nicht vom NACHBAR-Zweig erfuellt wird
 * (T568-F2). Der Kopf muss eindeutig sein: ein zweites Vorkommen koennte die Suche
 * erfuellen, waehrend der gemeinte Zweig laengst entschaerft ist.
 */
function zweig(text, kopfRe, wie) {
  const m = kopfRe.exec(text);
  assert.ok(m, 'Zweig nicht gefunden: ' + wie);
  const ende = m.index + m[0].length;
  assert.ok(!kopfRe.test(text.slice(ende)),
    'Zweig-Kopf "' + wie + '" kommt mehrfach vor — die Pruefung koennte am falschen Vorkommen gruen werden.');
  let tiefe = 0;
  for (let k = ende - 1; k < text.length; k++) {
    if (text[k] === '{') tiefe++;
    else if (text[k] === '}' && --tiefe === 0) return text.slice(m.index, k + 1);
  }
  return assert.fail('Zweig "' + wie + '" hat keine schliessende Klammer');
}

// ── T564-B2: Publish-Schleife holt den Remote-Stand ab Versuch 1 ──────────────────
const publish = schritt(daily, 'name: Publish board-history vintages to public data channel (F-17a)');
const publishBody = schleifenKoerper(publish);

test('B2: der Publish-Schleifenkoerper holt und resettet gegen origin/gh-pages', () => {
  assert.match(publishBody, /git fetch origin gh-pages/,
    'kein "git fetch origin gh-pages" im Publish-Schleifenkoerper');
  assert.match(publishBody, /git reset --hard origin\/gh-pages/,
    'kein "git reset --hard origin/gh-pages" im Publish-Schleifenkoerper');
});

// T568-F1: Positiv-Pin statt Regex-Negativ. Ein Negativ pinnt nur EINE Schreibweise
// (`$i" -gt 1`); `if [ "$i" != 1 ]`, `-ne`, `((i>1))` bauen denselben Bug gruen wieder
// ein (Repro M11). Steht der Fetch als ERSTER Befehl, ist fuer eine Bedingung kein
// Platz — unabhaengig von der Schreibweise.
test('B2: der ERSTE ausfuehrbare Befehl im Publish-Schleifenkoerper ist der Fetch (Positiv-Pin)', () => {
  const erste = ersterBefehl(publishBody);
  assert.match(erste, /^(if\s+!?\s*)?git fetch origin gh-pages\b/,
    'der Schleifenkoerper beginnt mit "' + erste + '" statt mit dem Fetch — jede Bedingung davor '
    + '(egal in welcher Schreibweise) baut den B2-Bug wieder ein: der minutenalte _ghp-Klon '
    + 'rollte einen parallelen Lauf schon im ersten Versuch per Force-Push zurueck.');
});

test('B2: Reihenfolge bleibt fetch/reset -> Kopie -> commit -> push', () => {
  const iReset = publishBody.indexOf('git reset --hard origin/gh-pages');
  const iCp = publishBody.indexOf('cp -r ../_public/board-history');
  const iCommit = publishBody.indexOf('git commit -m "deploy: board-history vintages');
  const iPush = publishBody.indexOf('git push --force origin gh-pages');
  assert.ok(iReset >= 0 && iCp > iReset && iCommit > iCp && iPush > iCommit,
    'Reihenfolge verletzt (reset=' + iReset + ' cp=' + iCp + ' commit=' + iCommit + ' push=' + iPush + ')');
});

// T568-F5: ein transienter Fetch-Ausfall darf nicht in denselben Blind-Force-Push
// muenden, den B2 verhindern sollte. Existiert origin/gh-pages, aber der Fetch kippt,
// gehoert der Versuch abgebrochen (continue), nicht gepusht.
test('F5: fehlgeschlagener Fetch fuehrt zum naechsten Versuch, nicht zum Blind-Force-Push', () => {
  const iFetch = publishBody.indexOf('git fetch origin gh-pages');
  const iPush = publishBody.indexOf('git push --force origin gh-pages');
  assert.ok(iFetch >= 0 && iPush > iFetch, 'Fetch/Push nicht in erwarteter Reihenfolge gefunden');
  assert.match(publishBody.slice(iFetch, iPush), /^\s*continue\s*$/m,
    'zwischen Fetch und Push steht kein "continue" — ein transienter Fetch-Ausfall pusht den '
    + 'minutenalten Klon per --force und rollt damit genau den Stand zurueck, den B2 schuetzt.');
});

test('F5: der Fetch verschluckt seine Fehlermeldung nicht (kein 2>/dev/null)', () => {
  assert.ok(!/git fetch origin gh-pages\s+2>\/dev\/null/.test(publishBody),
    'der Fetch schreibt nach /dev/null — die Meldung gehoert ins Log, sonst ist im Fehlerfall '
    + 'nicht erkennbar, warum der Publish neu ansetzt.');
});

// ── T564-B1/B5: zweite Frische-Sonde auf den Bewegungs-Kanal ──────────────────────
// Lazy geschnitten: fehlt der Schritt ganz, soll JEDER Check einzeln rot melden statt
// das Testmodul beim Laden abzubrechen (dann sieht man nur den ersten Befund).
const sonde = () => schritt(heartbeat, 'name: Check board-history channel freshness');

test('B1: die Sonde misst gh-pages outputs/board-history/index.json an dessen generated_at', () => {
  assert.match(sonde(), /gh-pages\/outputs\/board-history\/index\.json/,
    'die Sonde curlt nicht den publizierten board-history-Index');
  assert.match(sonde(), /generated_at/, 'die Sonde liest kein generated_at');
});

// T568-F2: am benannten Zweig geprueft. Vorher genuegte irgendein ::error::/exit(1)
// irgendwo in der Sonde — der n<2-Zweig erfuellte beide Checks, der ganze
// Veraltungs-Zweig liess sich spurlos ausbauen (Repro M2/M4/M7).
test('B1: der VERALTUNGS-Zweig selbst meldet ::error:: (Karls einziger Kanal ist das rote X)', () => {
  assert.match(zweig(sonde(), /if\s*\(\s*age\s*>\s*MAX\s*\)\s*\{/, 'age>MAX'), /::error::/,
    'der Zweig "Kanal veraltet" meldet sich nicht per ::error::');
});

test('B1: der VERALTUNGS-Zweig selbst beendet den Lauf rot (process.exit(1))', () => {
  assert.match(zweig(sonde(), /if\s*\(\s*age\s*>\s*MAX\s*\)\s*\{/, 'age>MAX'), /process\.exit\(1\)/,
    'der Zweig "Kanal veraltet" kann den Workflow nicht rot machen');
});

test('B1: die Schwelle haengt am Schritt (BH_MAX_AGE_DAYS: 2)', () => {
  einmalig(sonde(), /BH_MAX_AGE_DAYS:\s*'2'/,
    'die Schwelle ist nicht mehr auf 2 Tage gepinnt — eine stillschweigend erhoehte Schwelle '
    + 'macht die Sonde wirkungslos, ohne dass ein Test rot wird.');
});

test('B1: KEIN Skew-Vergleich gegen den v1-Export (der Publish liegt konstruktionsbedingt dahinter)', () => {
  assert.ok(!/findash-export/.test(sonde()),
    'die Sonde vergleicht gegen den v1-Export — der Vintage-Publish liegt Minuten dahinter, '
    + 'das waere ein Dauer-Falschalarm.');
});

test('B5: der Mindest-Vintage-Zweig selbst meldet ::error:: und beendet rot', () => {
  const z = zweig(sonde(), /if\s*\(\s*n\s*<\s*2\s*\)\s*\{/, 'n<2');
  assert.match(z, /::error::/, 'der Zweig "<2 Vintages" meldet sich nicht per ::error::');
  assert.match(z, /process\.exit\(1\)/, 'der Zweig "<2 Vintages" kann den Workflow nicht rot machen');
});

// T568-F7: der Wanduhr-Stempel des Publish sagt nur, dass der Publish LIEF — nicht, dass
// er frische Staende trug. Ein Lauf, der jeden Tag dieselben zwei alten Vintages neu
// hochschiebt, haelt generated_at ewig frisch. Darum zusaetzlich das DATUM des juengsten
// Vintages gegen dieselbe Schwelle (Kadenz Di–Sa: Montag vs. Samstags-Datum = floor 2,
// gruen; faellt der Samstag aus, sind es 3 -> rot).
// Gepinnt wird die RECHNUNG (Date.parse am Vintage-Datum), nicht das blosse Vorkommen
// von `idx.vintages.at(-1).date`: das steht auch in zwei Meldungstexten und haette die
// Suche gruen gehalten, waehrend die Messung selbst ausgebaut ist.
test('F7: die Sonde misst zusaetzlich das Datum des juengsten Vintages', () => {
  einmalig(sonde(), /Date\.parse\(idx\.vintages\.at\(-1\)\.date\)/,
    'die Sonde rechnet nicht mit dem Datum des juengsten Vintages — sie misst nur, DASS publiziert wurde.');
});

test('F7: der Vintage-Datums-Zweig selbst meldet ::error:: und beendet rot', () => {
  const z = zweig(sonde(), /if\s*\(\s*vAlter\s*>\s*MAX\s*\)\s*\{/, 'vAlter>MAX');
  assert.match(z, /::error::/, 'der Zweig "Vintage-Datum veraltet" meldet sich nicht per ::error::');
  assert.match(z, /process\.exit\(1\)/, 'der Zweig "Vintage-Datum veraltet" kann den Workflow nicht rot machen');
});

// T568-F9: ein continue-on-error am Schritt macht ::error:: + exit 1 wirkungslos —
// die Sonde bliebe im Baum stehen und meldete nichts mehr.
test('F9: die Sonde ist nicht entschaerft (kein continue-on-error)', () => {
  assert.ok(!/continue-on-error/.test(sonde()),
    'continue-on-error am Frische-Check macht Karls einzigen Kanal (das rote X) wirkungslos.');
});

// T568-F8: die Sektion darf nicht in den Kommentarblock des Folgeschritts hineinlaufen.
test('F8: schritt() endet am Schritt — keine Kommentarzeilen des Folgeschritts in der Sektion', () => {
  const zeilen = sonde().split('\n');
  const letzte = zeilen[zeilen.length - 1];
  assert.ok(letzte.trim() !== '' && !letzte.trim().startsWith('#'),
    'die Sektion endet auf "' + letzte + '" — der Kommentarblock des FOLGE-Schritts wandert mit '
    + 'hinein und kann Suchen erfuellen, die im Schritt selbst nichts finden.');
});

// ── T564-B6: der Kalender ueberlebt das `|| true` des merge-Deploy nicht still ────
const mergeDeploy = schleifenKoerper(schritt(daily, 'name: Deploy to GitHub Pages'));

// T568-F4: die alte Pruefung `[ ! -f outputs/earnings-calendar.json ]` sah in den
// gh-pages-KLON, in dem der Kalender von GESTERN immer schon liegt — praktisch ein
// No-Op (faellt die Quelle aus, wird der Stand von gestern still weiterdeployt).
// Verglichen wird darum der INHALT gegen die frisch gestagete Quelle.
// T568-F3: der Fenster-Anker `git add -A` wird selbst asserted — fehlt er, liefe das
// Fenster bis zum Datei-Ende und eine Pruefung HINTER dem Push bliebe gruen (Repro M12).
test('B6: der merge-Deploy vergleicht die Kalender-Kopie mit der frisch gestageten Quelle', () => {
  const iCp = mergeDeploy.indexOf('cp -r ../outputs/.');
  assert.ok(iCp >= 0, 'die outputs-Kopie fehlt im Schleifenkoerper');
  const iCmp = mergeDeploy.indexOf('cmp -s ../outputs/earnings-calendar.json outputs/earnings-calendar.json');
  assert.ok(iCmp > iCp,
    'nach dem `cp ... || true` steht kein INHALTS-Vergleich der Kalender-Kopie gegen die Quelle — '
    + 'eine blosse Existenzpruefung findet die Datei von gestern im gh-pages-Klon und laesst einen '
    + 'ausgefallenen Kalender gruen durchgehen.');
  const iAdd = mergeDeploy.indexOf('git add -A', iCmp);
  assert.ok(iAdd > iCmp,
    'kein "git add -A" nach der Kalender-Pruefung — ohne diesen Anker liefe das Pruef-Fenster bis '
    + 'zum Ende des Schleifenkoerpers und eine Pruefung HINTER dem Push bliebe gruen.');
  const fenster = mergeDeploy.slice(iCmp, iAdd);
  assert.match(fenster, /exit 1/, 'die Kalender-Pruefung macht den Schritt nicht rot');
  assert.match(fenster, /::error::/, 'die Kalender-Pruefung meldet sich nicht in Karls Kanal');
});

// ── T564-B4: Runner-Scratch gehoert nicht ins Repo ────────────────────────────────
test('B4: .gitignore deckt _public/ und _ghp/ ab', () => {
  const zeilen = gitignore.split('\n').map((z) => z.trim());
  for (const eintrag of ['_public/', '_ghp/']) {
    assert.ok(zeilen.includes(eintrag), eintrag + ' fehlt in .gitignore (Runner-Scratch des F-17a-Publish)');
  }
});

console.log('\nt564-datenkanal.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
