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
const { execFileSync } = require('node:child_process');

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
  const alle = text.slice(s).split('\n');
  const zeilen = [alle[0]];
  for (let i = 1; i < alle.length; i++) {
    // KV571-1a (Review Tag 571, Ausbau-Probe 3): das Ende eines Schritts ist der
    // naechste Listenpunkt auf Schritt-Ebene ODER das Ende des JOBS — jede nicht-leere
    // Zeile mit weniger Einrueckung. Ohne den zweiten Fall lief die Sektion des LETZTEN
    // Schritts eines Jobs bis zum naechsten `- ` im FOLGE-Job weiter; dessen
    // job-eigenes `if: always()` erfuellte dann eine Zusicherung, die im Schritt selbst
    // nichts findet. Belegt: der Ausbau von `if: always()` am Schritt "Earnings-Ausgang
    // festhalten" blieb gruen, weil `entdeckungs-waechter:` sein eigenes mitbrachte.
    if (/^ {6}- /.test(alle[i]) || /^ {0,5}\S/.test(alle[i])) break;
    zeilen.push(alle[i]);
  }
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
    else if (text[k] === '}' && --tiefe === 0) {
      const z = text.slice(m.index, k + 1);
      // KV571-2 (Review Tag 571, Repro G): der Zaehler oben kennt keine Strings — eine
      // unbalancierte `{` im Meldungstext treibt die Tiefe hoch, das echte Zweig-Ende
      // schliesst sie nicht mehr, und der Schnitt laeuft in den NACHBAR-Zweig hinein.
      // Alle hier geprueften Zweige sind einzeilig; ein Zeilenumbruch im Schnitt ist
      // deshalb IMMER ein Ueberlauf, egal wodurch er entstanden ist.
      assert.ok(!/[\r\n]/.test(z), 'der Schnitt fuer den Zweig "' + wie + '" ist ueber sein Ende '
        + 'hinausgelaufen (mehrzeilig) — vermutlich eine unbalancierte { in einem Meldungstext. '
        + 'Der Schnitt enthaelt dann den NACHBAR-Zweig, dessen ::error:: + process.exit(1) jede '
        + 'Zusicherung gruen halten, waehrend der gemeinte Zweig ausgebaut sein kann. Schnitt: '
        + JSON.stringify(z.slice(0, 200)));
      return z;
    }
  }
  return assert.fail('Zweig "' + wie + '" hat keine schliessende Klammer');
}

// ── KV571-2 (Review Tag 571, Repro G): zweig() muss den Nachbarn ausschliessen ────
// Der Klammerzaehler oben kennt keine Strings. Eine unbalancierte `{` im MELDUNGSTEXT
// eines Zweigs treibt die Tiefe hoch, das echte Zweig-Ende schliesst sie nicht mehr,
// und der Schnitt laeuft in den NACHBAR-Zweig hinein. Repro G: der komplette
// Veraltungs-Zweig liess sich entschaerfen (kein ::error::, kein exit 1) — beide
// Zusicherungen blieben gruen, weil sie den n<2-Nachbarn mitschnitten. Genau die
// Fehlerklasse, gegen die zweig() ueberhaupt gebaut wurde (T568-F2).
// Alle drei hier geprueften Zweige sind einzeilig; ein mehrzeiliger Schnitt ist
// deshalb IMMER ein ueberlaufener Schnitt, egal wodurch.
const REPRO_G = [
  "if(age>MAX){ console.log('Schwelle {MAX ueberschritten'); }",
  "if(n<2){ console.log('::error::zu wenige'); process.exit(1); }",
  '});',
].join('\n');

test('KV571-2: zweig() sammelt bei unbalancierter { im Meldungstext NICHT den Nachbarn ein', () => {
  assert.throws(() => zweig(REPRO_G, /if\(age>MAX\)\{/, 'age>MAX'),
    /ueber sein Ende hinaus|hinausgelaufen/,
    'zweig() liefert bei einer unbalancierten { im Meldungstext einen Schnitt, der den '
    + 'NACHBAR-Zweig enthaelt — dessen ::error:: + process.exit(1) halten die Zusicherungen '
    + 'gruen, waehrend der gemeinte Zweig komplett ausgebaut sein kann (Repro G).');
});

test('KV571-2: der gesunde einzeilige Zweig geht unveraendert durch (Gegenprobe)', () => {
  const gesund = [
    "if(age>MAX){ console.log('::error::veraltet'); process.exit(1); }",
    "if(n<2){ console.log('::error::zu wenige'); process.exit(1); }",
    '});',
  ].join('\n');
  const z = zweig(gesund, /if\(age>MAX\)\{/, 'age>MAX');
  assert.equal(z, "if(age>MAX){ console.log('::error::veraltet'); process.exit(1); }",
    'ein sauberer einzeiliger Zweig muss weiterhin exakt geschnitten werden — sonst ist die '
    + 'Haertung ein Falsch-Rot-Generator statt einer Wache.');
});

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

// ── KV571-1 (Review Tag 571): TRANSPORT-Netz fuer den Earnings-Pull ───────────────
// BEFUND: der cmp-Check oben deckt "Quelle fehlt/weicht ab", nicht "Quelle alt". Der
// Schritt "Pull Earnings-Calendar" traegt continue-on-error und earnings-calendar.json
// ist git-getrackt: faellt Yahoo aus, steht der gestrige Stand beidseitig identisch da,
// cmp wird gruen und der alte Kalender geht kommentarlos in den Datenkanal. Dasselbe
// gilt fuer ein still fehlgeschlagenes cp (gleiche alte Bytes). check-pull-stats zaehlt
// nur Abwaerts-Drift der PULL-Zahlen und sieht den Kalender nie.
// Geprueft wird das VERHALTEN: der case/esac-Rumpf wird aus der Workflow-Datei
// herausgeschnitten und mit gesetztem $AUSGANG ausgefuehrt (gleiche Bauart wie
// tests/r5-sk-002-fx-frische-drei-zustaende.test.js) — ein Nachbau wuerde genau die
// Abweichung nicht finden, um die es geht.
const transportSchritt = () => schritt(daily, 'name: Earnings-Transport pruefen (KV571-1)');

/** Eine ausfuehrbare `sh` finden (Linux/CI: auf PATH; Windows: die von Git). */
function shBinaer() {
  const kandidaten = ['sh', 'C:/Program Files/Git/usr/bin/sh.exe', 'C:/Program Files (x86)/Git/usr/bin/sh.exe'];
  for (const k of kandidaten) {
    try { execFileSync(k, ['-c', 'exit 0'], { stdio: 'ignore' }); return k; } catch (e) { /* naechster */ }
  }
  return assert.fail('keine ausfuehrbare sh gefunden (' + kandidaten.join(', ') + ') — dieser Waechter '
    + 'kann das Verhalten des Transport-Checks dann nicht messen. Ein stiller Skip waere hier der '
    + 'schlimmste Ausgang: die Wache saehe aus wie bestanden.');
}

/** Den case/esac-Rumpf des Transport-Checks mit gesetztem AUSGANG fahren. */
function transportLauf(ausgang) {
  const s = transportSchritt();
  const i = s.indexOf('case "$AUSGANG" in');
  assert.ok(i >= 0, 'kein `case "$AUSGANG" in` im Transport-Check — der Ausgang wird nicht ausgewertet');
  const j = s.indexOf('esac', i);
  assert.ok(j > i, 'kein `esac` im Transport-Check');
  const block = s.slice(i, j + 4).split('\n').map((z) => z.replace(/^ {10}/, '')).join('\n');
  try {
    const out = execFileSync(shBinaer(), ['-c', block],
      { encoding: 'utf8', env: Object.assign({}, process.env, { AUSGANG: ausgang }), stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status === undefined ? -1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

test('KV571-1a: der Earnings-Pull-Ausgang steht als Job-Ausgang zur Verfuegung', () => {
  const pull = schritt(daily, 'name: Pull Earnings-Calendar');
  assert.match(pull, /^\s*id:\s*pull_earnings\s*$/m,
    'der Schritt "Pull Earnings-Calendar" hat keine id — ohne sie gibt es kein steps.<id>.outcome '
    + 'und der Ausfall des Pulls bleibt job-lokal und damit unsichtbar.');
  const halten = schritt(daily, 'name: Earnings-Ausgang festhalten');
  assert.match(halten, /if:\s*always\(\)/,
    'der Ausgang wird nicht mit `if: always()` festgehalten — faellt ein spaeterer prep-Schritt, '
    + 'gaebe es gar keinen Ausgang und der Transport-Check saehe einen leeren Wert.');
  assert.match(halten, /steps\.pull_earnings\.outcome/, 'der festgehaltene Ausgang ist nicht der des Earnings-Pulls');
  einmalig(daily, /pull_earnings_outcome:\s*\$\{\{\s*steps\.earnings_ausgang\.outputs\.outcome\s*\}\}/,
    'der prep-Job reicht den Earnings-Ausgang nicht als Job-Ausgang heraus — der merge-Job kaeme '
    + 'nie an das Ergebnis heran (Schritt-Ergebnisse sind job-lokal).');
});

test('KV571-1a: der Transport-Check verbraucht genau diesen Job-Ausgang', () => {
  assert.match(transportSchritt(), /needs\.prep\.outputs\.pull_earnings_outcome/,
    'der Transport-Check liest nicht den Earnings-Ausgang des prep-Jobs.');
});

test('KV571-1a: Ausgang "failure" macht den Deploy-Pfad ROT', () => {
  const r = transportLauf('failure');
  assert.equal(r.code, 1, 'ein gefallener Earnings-Pull laeuft gruen durch (exit ' + r.code + ') — genau der '
    + 'Ausfall, bei dem der Stand von gestern still weiterdeployt wird.');
  assert.match(r.out, /::error::/, 'der Fehlschlag meldet sich nicht in Karls einzigem Kanal (rotes X).');
});

test('KV571-1a: auch "cancelled"/"skipped"/leer machen ROT (nicht-success ist nicht gruen)', () => {
  for (const a of ['cancelled', 'skipped', '']) {
    const r = transportLauf(a);
    assert.equal(r.code, 1, 'Ausgang "' + a + '" laeuft gruen durch — ein weder-gruen-noch-rot beendeter '
      + 'Pull ist von einem gesunden Lauf nicht zu unterscheiden.');
    assert.match(r.out, /::error::/, 'Ausgang "' + a + '" meldet sich nicht per ::error::');
  }
});

test('KV571-1a: Ausgang "success" geht gruen durch (Gegenprobe, kein Dauer-Falschalarm)', () => {
  const r = transportLauf('success');
  assert.equal(r.code, 0, 'ein gruener Earnings-Pull macht den Lauf rot (exit ' + r.code + ') — die Wache '
    + 'waere ein Falsch-Rot-Generator: ' + r.out.trim());
  assert.ok(!/::error::/.test(r.out), 'der Erfolgsfall meldet einen Fehler: ' + r.out.trim());
});

// ── T573-R1 (SFH-Review ueber Tag 573, F2566): der Check darf den Lauf nicht kapern ──
// BEFUND: der Transport-Check sass als LETZTER SCHRITT im merge-Job und trug kein
// continue-on-error. Sein `exit 1` machte damit die merge-CONCLUSION rot, und `scoring`
// (needs: merge, KEIN eigenes if:) wird bei einer roten Conclusion komplett UEBERSPRUNGEN:
// Hypergrowth-/findash-Deploy, Vintage-Messreihe und die nicht nachholbare "Snapshot
// ticker map" fielen aus. Eintrittsbedingung war ein gewoehnlicher Yahoo-Ausfall.
// Geprueft wird die STRUKTUR am Objekt (der Check ist aus dem merge-Job raus, der neue
// Job traegt if: always(), niemand haengt an ihm) UND das Verhalten des VOLLEN
// run-Blocks inklusive des neuen MERGE-Vorlaufs.
/** Den Rumpf EINES benannten Jobs schneiden (bis zum naechsten Eintrag auf Job-Ebene). */
function job(text, name) {
  const kopf = '\n  ' + name + ':\n';
  const s = text.indexOf(kopf);
  assert.ok(s >= 0, 'Job nicht gefunden: ' + name);
  const alle = text.slice(s + 1).split('\n');
  const zeilen = [alle[0]];
  for (let i = 1; i < alle.length; i++) {
    // Naechster Eintrag auf Job-Ebene (2 Leerzeichen) ODER Datei-Ebene = Job zu Ende.
    if (/^ {0,2}\S/.test(alle[i])) break;
    zeilen.push(alle[i]);
  }
  return zeilen.join('\n');
}

test('T573-R1: der Transport-Check sitzt NICHT mehr im merge-Job', () => {
  const m = job(daily, 'merge');
  assert.ok(m.includes('- name: Deploy to GitHub Pages'),
    'der merge-Job wurde nicht richtig geschnitten (kein Deploy-Schritt darin) — dann prueft '
    + 'die Abwesenheits-Zusicherung unten nichts.');
  assert.ok(!/Earnings-Transport pruefen/.test(m),
    'der Transport-Check steht wieder im merge-Job. Sein `exit 1` faerbt dann die '
    + 'merge-CONCLUSION rot, und `scoring` (needs: merge, kein eigenes if:) wird komplett '
    + 'uebersprungen — ein ausgefallener Earnings-Pull kostet dann Hypergrowth-Deploy, '
    + 'Vintage-Messreihe und die nicht nachholbare Snapshot-ticker-map (T573-R1/F2566).');
});

test('T573-R1: es gibt einen eigenen Waechter-Job mit if: always() und needs [prep, merge]', () => {
  const w = job(daily, 'earnings-transport-waechter');
  assert.match(w, /^ {4}if:\s*always\(\)\s*$/m,
    'der Waechter-Job traegt kein job-eigenes `if: always()` — dann meldet er nicht mehr, '
    + 'wenn der merge-Job selbst gefallen ist, also genau im interessanten Fall.');
  assert.match(w, /^ {4}needs:\s*\[prep, merge\]\s*$/m,
    'der Waechter haengt nicht an [prep, merge] — prep liefert den Ausgang (Schritt-Ergebnisse '
    + 'sind job-lokal), merge sorgt fuer die Reihenfolge nach dem Deploy.');
  // Am SCHLUESSEL geprueft, nicht am Wort: "continue-on-error" steht auch im Meldungstext
  // des failure-Zweigs (er erklaert, warum der PULL weiterlief). Eine Substring-Suche waere
  // hier dauerhaft falsch-rot gewesen — und umgekehrt haette sie, einmal auf den Text
  // umgebogen, jede echte Entschaerfung gedeckt.
  assert.ok(!/^\s*continue-on-error\s*:/m.test(w),
    'continue-on-error am Waechter macht sein exit 1 wirkungslos — Karls einziger Alarm-Kanal '
    + 'ist das rote X.');
  assert.ok(w.includes('- name: Earnings-Transport pruefen (KV571-1)'),
    'der Check-Schritt liegt nicht in diesem Job.');
});

test('T573-R1: KEIN Job haengt am Waechter (er darf nichts blockieren)', () => {
  // Positiv-Pin am Objekt: jede needs-Zeile der Datei wird gelesen, nicht nur nach dem
  // Namen gesucht — ein `needs: earnings-transport-waechter` in irgendeinem Folge-Job
  // wuerde genau den Befund wieder einbauen (Ausfall reisst andere Jobs mit).
  const needsZeilen = daily.split('\n').filter((z) => /^ {4}needs:/.test(z));
  assert.ok(needsZeilen.length >= 4, 'zu wenige needs-Zeilen gefunden (' + needsZeilen.length
    + ') — der Sucher greift nicht mehr, die Zusicherung waere leer.');
  for (const z of needsZeilen) {
    assert.ok(!z.includes('earnings-transport-waechter'),
      'ein Job haengt am Transport-Waechter ("' + z.trim() + '") — dann reisst dessen rotes X '
      + 'wieder fremde Jobs mit, und T573-R1 ist rueckgaengig gemacht.');
  }
});

/** Den VOLLEN run-Block des Transport-Checks fahren (inkl. MERGE-Vorlauf, T573-R1). */
function transportVollLauf(mergeErgebnis, ausgang) {
  const s = transportSchritt();
  const i = s.indexOf('run: |');
  assert.ok(i >= 0, 'kein `run: |` im Transport-Check');
  const block = s.slice(i + 'run: |'.length).split('\n').map((z) => z.replace(/^ {10}/, '')).join('\n')
    .replace(/\$\{\{\s*needs\.merge\.result\s*\}\}/g, mergeErgebnis)
    .replace(/\$\{\{\s*needs\.prep\.outputs\.pull_earnings_outcome\s*\}\}/g, ausgang);
  assert.ok(!block.includes('${{'),
    'im ausgefuehrten Block steht noch ein unersetzter GitHub-Ausdruck — dann misst dieser '
    + 'Waechter etwas anderes als der Runner ausfuehrt. Rest: '
    + JSON.stringify((block.match(/\$\{\{[^}]*\}\}/) || [''])[0]));
  try {
    const out = execFileSync(shBinaer(), ['-c', block], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status === undefined ? -1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

test('T573-R1: uebersprungener merge-Job -> Warnung statt rot (Erreichbarkeit unveraendert)', () => {
  for (const m of ['skipped', 'cancelled']) {
    const r = transportVollLauf(m, 'failure');
    assert.equal(r.code, 0, 'merge=' + m + ' macht den Waechter rot — es wurde aber gar nichts '
      + 'deployt, die Meldung "hat den Kalender von gestern deployt" waere schlicht falsch. '
      + 'Im merge-Job war dieser Fall unerreichbar; als eigener Job mit if: always() ist er es '
      + 'nicht mehr. Ausgabe: ' + r.out.trim());
    assert.match(r.out, /::warning::/, 'merge=' + m + ' meldet sich gar nicht — stiller gruener '
      + 'Haken auf einen Lauf, ueber den nichts auszusagen ist.');
    assert.ok(!/::error::/.test(r.out), 'merge=' + m + ' meldet ::error:: statt ::warning::');
  }
});

test('T573-R1: gelaufener merge-Job -> der Ausgang entscheidet (rot bei failure, still bei success)', () => {
  const rot = transportVollLauf('success', 'failure');
  assert.equal(rot.code, 1, 'bei gelaufenem merge macht ein gefallener Earnings-Pull den Waechter '
    + 'nicht rot — dann ist der Alarm ausgebaut. Ausgabe: ' + rot.out.trim());
  assert.match(rot.out, /::error::/, 'der Fehlschlag meldet sich nicht in Karls einzigem Kanal.');
  const still = transportVollLauf('success', 'success');
  assert.equal(still.code, 0, 'ein gruener Earnings-Pull macht den Waechter rot — Falsch-Rot-Generator: '
    + still.out.trim());
  assert.ok(!/::error::|::warning::/.test(still.out), 'der Erfolgsfall meldet einen Alarm: ' + still.out.trim());
});

// ── T573-R3 (SFH-Review ueber Tag 573, F2566): schritt() endet am JOB-Ende ────────
// Der Wurzelfix aus Tag 573 (KV571-1a, Ausbau-Probe 3) hatte keinen eigenen Test — er
// wurde nur zufaellig ueber die echte Workflow-Datei mitgetestet und waere bei jeder
// Umstellung dort still verschwunden. Synthetisches Fixture: LETZTER Schritt eines Jobs,
// der FOLGE-Job traegt ein job-eigenes `if: always()`.
test('T573-R3: schritt() nimmt den FOLGE-Job nicht mit (Regression zu Ausbau-Probe 3)', () => {
  const fixture = [
    'jobs:',
    '  ersterJob:',
    '    steps:',
    '      - name: Letzter Schritt des Jobs',
    '        if: always()',
    '        run: echo hallo',
    '',
    '  folgeJob:',
    '    needs: ersterJob',
    '    if: always()',
    '    steps:',
    '      - name: Irgendetwas',
    '        run: echo welt',
  ].join('\n');
  const s = schritt(fixture, 'name: Letzter Schritt des Jobs');
  assert.match(s, /run: echo hallo/, 'der Schritt selbst ist unvollstaendig geschnitten');
  assert.ok(!s.includes('folgeJob'), 'der Schnitt laeuft in den FOLGE-Job hinein');
  assert.ok(!s.includes('echo welt'), 'der Schnitt enthaelt Befehle des FOLGE-Jobs');
  assert.equal((s.match(/if:\s*always\(\)/g) || []).length, 1,
    'der Schnitt enthaelt mehr als das EINE `if: always()` des Schritts — das zweite stammt '
    + 'aus dem Folge-Job und wuerde eine Zusicherung erfuellen, die im Schritt selbst nichts findet.');
  // Beleg, dass GENAU DAS die alte Logik durchgelassen haette (das IST der Befund):
  const altSchnitt = (text, marker) => {
    const i = text.indexOf(marker);
    const alle = text.slice(i).split('\n');
    const z = [alle[0]];
    for (let k = 1; k < alle.length; k++) { if (/^ {6}- /.test(alle[k])) break; z.push(alle[k]); }
    return z.join('\n');
  };
  const alt = altSchnitt(fixture, 'name: Letzter Schritt des Jobs');
  assert.ok(alt.includes('folgeJob') && (alt.match(/if:\s*always\(\)/g) || []).length === 2,
    'die alte, nur am naechsten `- ` orientierte Logik haette hier NICHT in den Folge-Job '
    + 'gelesen — dann bildet das Fixture den Befund nicht ab und der Test beweist nichts.');
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
