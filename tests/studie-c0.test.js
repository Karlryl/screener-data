'use strict';

// C0 — die eingefrorene Themen-Auswahlregel fuer Strang C.
//
// Die SACHE, die hier festgenagelt wird, ist NICHT ein Schreibmuster, sondern die
// Auswahl selbst: eine Themenliste, die sich nachtraeglich veraendern laesst, ohne
// dass es auffliegt, macht den ganzen Strang wertlos. Wer die Vergangenheit nach dem
// Ergebnis umsortiert, bekommt zwangslaeufig "frueh rein lohnt immer" heraus.
//
// Geprueft wird deshalb beides, wie es die Wachtest-Disziplin verlangt:
//   - der AUSGELIEFERTE Stand muss DURCHGEHEN (ein Waechter, der bei richtiger
//     Benutzung rot wird, entwertet sich selbst), und
//   - jede Manipulation muss ROT werden, und
//   - der Waechter OHNE seinen Hash-Vergleich darf die Manipulation NICHT mehr finden.
//     Das ist der Meta-Test: er belegt, dass der Vergleich die tragende Stelle ist und
//     nicht ein danebenstehendes Ritual.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const PROTO = path.join(REPO, 'protocol', 'strang-c');
const SKRIPT = path.join(REPO, 'scripts', 'studie-c0.py');
const REGEL = path.join(PROTO, 'C0-regel.md');
const THEMEN = path.join(PROTO, 'C0-themenliste.json');
const LEITER = path.join(PROTO, 'C0-leiter-log.json');
const FREEZE1 = path.join(PROTO, 'C0-freeze1.json');
const FREEZE2 = path.join(PROTO, 'C0-freeze2.json');
const MANIFEST = path.join(PROTO, 'C0-register-manifest.json');

const vorhanden = (p) => fs.existsSync(p);
const lies = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function python() {
  for (const kandidat of ['python', 'python3', 'py']) {
    const probe = spawnSync(kandidat, ['-c', 'print(1)'], { encoding: 'utf8' });
    if (probe.status === 0) return kandidat;
  }
  throw new Error('Kein Python gefunden');
}

function pruefe(wurzel) {
  return spawnSync(python(), [path.join(wurzel, 'scripts', 'studie-c0.py'), 'pruefen'], {
    encoding: 'utf8',
    env: process.env,
  });
}

// Eine Arbeitskopie: Skript + Protokoll-Ordner. Die grossen Rohdaten bleiben, wo sie
// sind — sie kommen ueber EARLY_DETECTION_DATA_ROOT und werden nur gelesen.
function arbeitskopie() {
  const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'c0-'));
  fs.mkdirSync(path.join(ziel, 'scripts'), { recursive: true });
  fs.copyFileSync(SKRIPT, path.join(ziel, 'scripts', 'studie-c0.py'));
  fs.cpSync(PROTO, path.join(ziel, 'protocol', 'strang-c'), { recursive: true });
  return ziel;
}

test('C0: der Rechen-Selbsttest des Skripts ist gruen', () => {
  // Die vier Rechenstellen (Phrasen-Zerlegung, Spike, Zusammenlegung, Buendelhash)
  // pruefen sich selbst - in beide Richtungen, gueltige Form durch, kaputte auffliegen.
  const lauf = spawnSync(python(), [SKRIPT, 'selbsttest'], { encoding: 'utf8', env: process.env });
  assert.equal(lauf.status, 0, `selbsttest rot:
${lauf.stdout}${lauf.stderr}`);
  assert.match(lauf.stdout, /"selbsttest": "GRUEN"/);
});

test('C0: die Regeldatei liegt vor und traegt ihre Pflichtstuecke', () => {
  assert.ok(vorhanden(REGEL), 'protocol/strang-c/C0-regel.md fehlt');
  const text = fs.readFileSync(REGEL, 'utf8');
  // Nicht die Formulierung wird gepinnt, sondern die drei Stellen, an denen die Regel
  // gegen Rueckblick-Anpassung schuetzt. Fehlt eine, ist die Regel entkernt.
  for (const sache of [
    'eindeutiger CIKs',        // Zaehlgroesse: Firmen, nicht Dokumente
    'NIE mitglieds-getriggert', // Leiter: Zaehlstand, nie Mitgliedschaft
    'Kalibrier-Offenlegung',    // Eichung an Flops offengelegt
    'MANDAT',                   // Pflicht-Verwechsler unloeschbar markiert
  ]) {
    assert.ok(text.includes(sache), `Die Regeldatei fuehrt "${sache}" nicht mehr`);
  }
});

test('C0: das Register-Manifest fuehrt seine Luecken als Luecken', () => {
  assert.ok(vorhanden(MANIFEST), 'C0-register-manifest.json fehlt');
  const manifest = lies(MANIFEST);
  assert.ok(Array.isArray(manifest.luecken), 'Kein Luecken-Feld — eine stille Luecke ist der schlimmste Fall');
  for (const luecke of manifest.luecken) {
    assert.ok(luecke.quelle && luecke.jahrgang, 'Luecke ohne Quelle/Jahrgang');
    assert.ok((luecke.grund || '').length > 10, `Luecke ${luecke.quelle}/${luecke.jahrgang} ohne Begruendung`);
  }
  for (const eintrag of manifest.eintraege) {
    assert.ok(eintrag.sha256, 'Register-Eintrag ohne Pruefsumme (R7)');
  }
});

test('C0: die Leiter ist zaehlstand-getriggert, nie mitglieds-getriggert', () => {
  assert.ok(vorhanden(LEITER), 'C0-leiter-log.json fehlt');
  const leiter = lies(LEITER);
  const themen = vorhanden(THEMEN) ? lies(THEMEN).themen.map((t) => t.thema) : [];
  for (const schritt of leiter.schritte.slice(1)) {
    assert.ok(
      /Zaehlstand/.test(schritt.ausgeloestDurch || ''),
      `Leiter-Schritt ${schritt.schritt} nennt keinen Zaehlstand als Ausloeser`,
    );
    // Die Gegenprobe, die wirklich etwas beweist: kein Schritt darf ein THEMA nennen.
    for (const name of themen) {
      assert.ok(
        !(schritt.ausgeloestDurch || '').includes(name) && !(schritt.beschreibung || '').includes(name),
        `Leiter-Schritt ${schritt.schritt} nennt das Thema "${name}" — das waere mitglieds-getriggert`,
      );
    }
  }
});

test('C0: jeder Pflicht-Verwechsler ist abgedeckt — selbst erzeugt oder als MANDAT', () => {
  assert.ok(vorhanden(THEMEN), 'C0-themenliste.json fehlt');
  const liste = lies(THEMEN);
  const pflicht = ['3D-Druck', 'Metaverse', 'Wasserstoff', 'Cannabis', 'Blockchain'];
  for (const name of pflicht) {
    const alsMandat = liste.themen.some((t) => t.herkunft === 'MANDAT' && t.thema === name);
    const selbstErzeugt = liste.themen.some((t) => (t.pflichtVerwechsler || []).includes(name));
    assert.ok(alsMandat || selbstErzeugt, `Pflicht-Verwechsler ${name} fehlt in der Themenliste`);
  }
  for (const thema of liste.themen) {
    assert.ok(['REGEL', 'MANDAT'].includes(thema.herkunft), `Thema ${thema.thema} ohne Herkunft`);
  }
});

test('C0: kein verbotenes Merkmal im Ableitungs-Code', () => {
  // Kurse, Renditen, Marktwert, Index-/ETF-Zugehoerigkeit, Analystenurteile duerfen in
  // der AUSWAHL nicht vorkommen.
  //
  // Gesucht wird die BENUTZUNG, nicht das Wort. Die erste Fassung schlug an der Zeile
  // an, die genau diese Merkmale VERBIETET (der Erlaubnis-/Verbotstext der
  // Register-Anmeldung) - ein Waechter, der das Verbot fuer den Verstoss haelt, ist am
  // Tag 1 falsch-rot. Deshalb zwei Suchen: das blosse Wort ausserhalb der
  // Erlaubnis-Zeilen, und ueberall die Form 'wort... =' / 'wort...(' / 'wort....',
  // also eine Zuweisung, ein Aufruf oder ein Feldzugriff.
  const VERBOTEN = ['kurs', 'rendite', 'marktkap', 'market_cap', 'etf', 'analyst', 'volatil'];
  const roh = fs.readFileSync(SKRIPT, 'utf8');
  const zeilen = roh.split(String.fromCharCode(10)).map((z) => z.split('#')[0]);
  const ohneErlaubnistext = zeilen
    .filter((z) => !/"(verboten|erlaubt|begruendung|endtestSiegel)"/.test(z))
    .join(String.fromCharCode(10)).toLowerCase();
  for (const verboten of VERBOTEN) {
    assert.ok(!ohneErlaubnistext.includes(verboten),
      `Der Ableitungs-Code nennt "${verboten}" ausserhalb des Erlaubnistexts`);
  }
  const benutzung = new RegExp('(^|[^a-z])(' + VERBOTEN.join('|') + ')[a-z_]*[ ]*[=([.]', 'i');
  const treffer = benutzung.exec(zeilen.join(String.fromCharCode(10)));
  assert.equal(treffer, null, `Verbotenes Merkmal wird benutzt: ${treffer && treffer[0]}`);

  // Gegenprobe am Waechter selbst: eine echte Benutzung muss auffliegen, ein blosses
  // Verbot im Text nicht.
  assert.ok(benutzung.test('kursrendite = lies(x)'), 'Der Waechter uebersieht eine echte Benutzung');
  assert.ok(benutzung.test('    marktkapitalisierung(x)'), 'Der Waechter uebersieht einen Aufruf');
  assert.ok(!benutzung.test('"verboten": "Jeder Kurs-, Rendite- oder Marktwert"'),
    'Der Waechter haelt das Verbot fuer den Verstoss');
});

test('C0: die beiden Freezes haengen aneinander', () => {
  assert.ok(vorhanden(FREEZE1) && vorhanden(FREEZE2), 'Freeze-Dateien fehlen');
  const zwei = lies(FREEZE2);
  const eins = lies(FREEZE1);
  assert.ok(
    zwei.buendel.some((z) => z.startsWith('protocol/strang-c/C0-freeze1.json')),
    'FREEZE 2 haengt nicht am FREEZE-1-Stand — dann waere das Vokabular nachtraeglich austauschbar',
  );
  assert.equal(eins.stufe, 'FREEZE_1');
  assert.equal(zwei.stufe, 'FREEZE_2');
});

test('W1: der ausgelieferte Stand geht durch den Waechter', () => {
  const lauf = pruefe(REPO);
  assert.equal(lauf.status, 0, `pruefen ist auf dem Auslieferungsstand rot:\n${lauf.stdout}${lauf.stderr}`);
});

test('W2: ein umbenanntes Thema wird ROT', () => {
  const kopie = arbeitskopie();
  const gruen = pruefe(kopie);
  assert.equal(gruen.status, 0, 'Die unveraenderte Arbeitskopie ist schon rot — dann beweist die Sabotage nichts');

  const pfad = path.join(kopie, 'protocol', 'strang-c', 'C0-themenliste.json');
  const liste = JSON.parse(fs.readFileSync(pfad, 'utf8'));
  liste.themen[0].thema = `${liste.themen[0].thema}-umbenannt`;
  fs.writeFileSync(pfad, `${JSON.stringify(liste, null, 1)}\n`, 'utf8');

  const rot = pruefe(kopie);
  assert.equal(rot.status, 1, 'Ein umbenanntes Thema kommt am Waechter vorbei');
  assert.match(rot.stdout, /C0-themenliste\.json/, 'Der Waechter nennt die manipulierte Datei nicht');
  fs.rmSync(kopie, { recursive: true, force: true });
});

test('W3 (Meta): ohne den Hash-Vergleich findet der Waechter nichts mehr', () => {
  const kopie = arbeitskopie();
  const skript = path.join(kopie, 'scripts', 'studie-c0.py');
  const quelle = fs.readFileSync(skript, 'utf8');
  // Der Ausbau: genau die eine Zeile, die Soll gegen Ist stellt, wird entschaerft.
  const entschaerft = quelle.replace(
    '        if soll.get(name) != ist.get(name):',
    '        if False:',
  ).replace(
    '    if gesamt != freeze["buendelSha256"]:',
    '    if False:',
  );
  assert.notEqual(entschaerft, quelle, 'Der Hash-Vergleich steht nicht mehr da, wo der Meta-Test ihn ausbaut');
  fs.writeFileSync(skript, entschaerft, 'utf8');

  const pfad = path.join(kopie, 'protocol', 'strang-c', 'C0-themenliste.json');
  const liste = JSON.parse(fs.readFileSync(pfad, 'utf8'));
  liste.themen[0].thema = `${liste.themen[0].thema}-umbenannt`;
  fs.writeFileSync(pfad, `${JSON.stringify(liste, null, 1)}\n`, 'utf8');

  const blind = pruefe(kopie);
  assert.equal(
    blind.status, 0,
    'Der ausgebaute Waechter wird trotzdem rot — dann macht die Arbeit etwas anderes als der Hash-Vergleich, '
    + 'und W2 beweist nicht, was es zu beweisen vorgibt',
  );
  fs.rmSync(kopie, { recursive: true, force: true });
});

test('C0: die Anmeldung im Zugriffs-Register liegt VOR dem ersten EDGAR-Zugriff', () => {
  const { pruefeZugriffsRegister, ART_C0_REGELFREEZE } = require('../lib/studie-verfassung');
  const register = lies(path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'outcome-access-ledger.json'));
  pruefeZugriffsRegister(register);
  const c0 = register.events.filter((e) => (e.typ || e.type) === ART_C0_REGELFREEZE);
  assert.ok(c0.length >= 1, 'Keine C0-Anmeldung im Zugriffs-Register');
  const freeze1 = c0.find((e) => e.runId.includes('freeze1'));
  assert.ok(freeze1, 'Keine FREEZE-1-Anmeldung');
  assert.ok(
    Date.parse(freeze1.registeredAt) < Date.parse(freeze1.accessedAt),
    'Die C0-Anmeldung erlaubt den Zugriff schon zum Anmeldezeitpunkt — das waere ein Nachher-Protokoll',
  );
  const buendel = lies(FREEZE1).buendelSha256;
  assert.ok(
    (freeze1.begruendung || '').includes(buendel),
    'Die Anmeldung nennt den FREEZE-1-Buendelhash nicht — dann bindet sie nichts',
  );
});

test('C0: der Buendelhash ist gegen Umbenennen blind — Gegenprobe am Hashverfahren', () => {
  // Der Hash laeuft ueber "name  sha256"-Zeilen. Waere er nur ueber die Pruefsummen
  // gebildet, koennte man zwei Dateien vertauschen, ohne dass es auffaellt.
  const zwei = lies(FREEZE2);
  for (const zeile of zwei.buendel) {
    assert.match(zeile, /^\S.*\s{2}[0-9a-f]{64}$/, `Buendelzeile ohne Name+Hash: ${zeile}`);
  }
  const namen = zwei.buendel.map((z) => z.replace(/\s{2}[0-9a-f]{64}$/, ''));
  assert.equal(new Set(namen).size, namen.length, 'Ein Name steht doppelt im Buendel');
  assert.ok(namen.some((n) => n.startsWith('protocol/strang-c/filer/')), 'Keine Filer-Liste im Buendel');
  assert.ok(namen.some((n) => n.includes('C0-query-log.jsonl')), 'Kein Query-Log im Buendel');
});

test('C0: git kennt die Datei — der Waechter darf nicht ins Leere laufen', () => {
  const spur = execFileSync('git', ['ls-files', 'protocol/strang-c'], { cwd: REPO, encoding: 'utf8' });
  assert.ok(spur.includes('C0-regel.md'), 'Die Regeldatei ist nicht in git — dann ist sie nicht eingefroren');
});
