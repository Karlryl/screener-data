#!/usr/bin/env node
'use strict';

// R1 — Erst festschreiben, dann messen. Der Serverzeit-Teil.
//
// DIE SACHE: Eine Vorab-Anmeldung, die nur lokal existiert, ist kein Beweis. Sie wird
// erst dann einer, wenn sie nachweislich auf dem geschuetzten Server liegt, BEVOR die
// Daten angefasst wurden — und "bevor" wird an der SERVERUHR gemessen, nicht an der
// eigenen. Eine lokale Uhr laesst sich stellen.
//
// Zwei Schritte, in dieser Reihenfolge, nie parallel:
//   1. `anmelden`     — haengt den Eintrag an das Zugriffs-Register. Danach committen
//                       und pushen. Das macht dieses Skript NICHT: ein Skript, das
//                       selbst pusht, verwischt die Grenze zwischen Anmeldung und
//                       Veroeffentlichung.
//   2. `bestaetigen`  — holt den Register-Inhalt von origin zurueck, prueft, dass der
//                       eventHash dort wirklich steht, und schreibt den `Date`-Kopf der
//                       API-Antwort (GitHub-Serveruhr) als `serverConfirmedAt` in ein
//                       Freigabe-Protokoll. Ohne diese Datei laeuft die Zaehlprobe nicht.
//
// Was hier ABSICHTLICH nicht passiert: das Skript entscheidet nicht, ob ein Lauf
// erlaubt ist. Es stellt nur fest, was der Server sagt. Die Erlaubnis steht in der
// Praeregistrierung.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { writeFileAtomic } = require('../lib/atomic-write.js');
const {
  VerfassungsBruch,
  haengeEintragAn,
  pruefeZugriffsRegister,
  pruefeServerzeit,
  ART_ZUGRIFF,
  ART_ZAEHLPROBE,
  ART_C0_REGELFREEZE,
  REGISTER_RELS,
  AKTIVES_REGISTER_REL,
  registerPfadDerRunId,
  istGeschlossen,
} = require('../lib/studie-verfassung');

// Welche Anmeldungs-Arten dieses Skript bestaetigen darf. Die Liste ist bewusst
// geschlossen: eine unbekannte Art bekommt keine Server-Bestaetigung.
//
// Geschuetzt ist die UNBEKANNTE Art, nicht die Zweizahl (_COURT-F6-VOLLZUG-
// 2026-08-31, Frage (c), 3:0, Auflage F6-B16). Die Verfassung fuehrt
// `confirmatory_execution_authorized` selbst als ART_ZUGRIFF in
// ARTEN_MIT_ZUGRIFFSZEIT; dieses Werkzeug fuehrte davon bisher eine echte
// Teilmenge und hinkte damit genau der Art hinterher, fuer die die
// VB-A11-Zeitkette ueberhaupt geschrieben wurde. Die Erweiterung stellt
// Gleichheit her - sie ist Vollendung, keine Aufweichung, und sie kann nichts
// erlauben: dieses Skript entscheidet nicht, ob ein Lauf erlaubt ist (siehe
// Kopf). Die Arten werden IMPORTIERT, nie als Zeichenkette getippt; zwei
// Kopien derselben Regel driften. Wird die Menge je um eine Art erweitert, die
// NICHT in ARTEN_MIT_ZUGRIFFSZEIT steht, ist die Schutzeigenschaft gebrochen
// (Kipp-Bedingung KV-4) - der Gleichheits-Anker in
// tests/studie-r1-bestaetigbar-zugriff.test.js ist ihre maschinelle Fassung.
const BESTAETIGBAR = new Set([ART_ZUGRIFF, ART_ZAEHLPROBE, ART_C0_REGELFREEZE]);

// Der EINE Appender aus protocol/early-detection/2.0.0/register-single-appender-rule.json
// (`rule.singleAppender`). Steht hier als Konstante, damit der Server-Beweis nicht davon
// abhaengt, auf welchem Zweig der Aufrufer zufaellig steht.
const SINGLE_APPENDER_ZWEIG = 'main';

const WURZEL = path.join(__dirname, '..');

// G10/LR-14 - EIN AUFLOESER, keine Flickerei je Aufrufer. Der Registerpfad stand
// hier als zweite getippte Kopie neben der in lib/ledger-single-appender.js.
// Nach der Naht ist das Register ZWEI Dateien, und eine zurueckgebliebene Kopie
// faellt ihr Urteil ueber die falsche: `bestaetigen` faende die runId eines
// Fortsetzungs-Eintrags nicht und liesse sich fuer ihn keinen Beweis fuehren.
const absolut = (rel) => path.join(WURZEL, ...rel.split('/'));

// LRA-3: DAS ANMELDEZIEL IST DIE AKTIVE DATEI - importiert, nie getippt.
// Bis zum ANHANG stand hier die ERSTE Registerdatei, weil LR-14s Wortlaut-
// Haelfte (ii) den KV-4-Waechter fuer unberuehrbar erklaerte und jede Bewegung
// des Anmeldeziels ihn rot machte. Diese Haelfte ist gefallen; ihre geschuetzte
// EIGENSCHAFT (der KV-4-Gleichheitsanker) steht unveraendert und wird nach der
// Attrappen-Vollendung neu abgenommen (LRA-11).
const ANMELDEZIEL_REL = AKTIVES_REGISTER_REL;
// Fuer die Geschichtsleser: die zuerst beschriebene Datei behaelt ihren Namen.
const LEDGER_REL = REGISTER_RELS[0];
const LEDGER = absolut(LEDGER_REL);
const ANMELDEN_ZIEL = absolut(ANMELDEZIEL_REL);
const PRAEREG = path.join(WURZEL, 'protocol', 'early-detection', '2.0.0', 'preregistration.json');

function argument(argv, name, pflicht = true) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1 || i === argv.length - 1) {
    if (pflicht) throw new VerfassungsBruch(`Argument --${name} fehlt`);
    return null;
  }
  return argv[i + 1];
}

function lies(pfad) {
  return JSON.parse(fs.readFileSync(pfad, 'utf8'));
}

// Fuer den Ketten-Aufloeser: eine Registerdatei, die es (noch) nicht gibt, ist
// ein LEERES GLIED, kein Fehler - vor dem Rollover existierte die Fortsetzung
// nicht, und ein aelterer Checkout kennt sie nicht. Ein ENOENT wird deshalb zu
// null. JEDER andere Fehler fliegt weiter: kaputtes JSON oder fehlende Rechte
// sind eine kaputte MESSUNG, und eine kaputte Messung darf nie als "hier steht
// die runId eben nicht" durchgehen. Genau diese Unterscheidung ist der
// Unterschied zwischen fail-closed und einem stillen Fehlschlag.
function liesWennDa(rel) {
  let roh;
  try {
    roh = lies(absolut(rel));
  } catch (fehler) {
    if (fehler.code === 'ENOENT') return null;
    throw fehler;
  }
  // F6: EINE DATEI, DIE ES GIBT, IST NICHT "NICHT DA". `null`, `""`, `[]` und
  // `{}` parsen alle sauber und rutschten als leeres Glied durch - womit sich
  // die Mehrdeutigkeits-Sperre aushebeln liesse, indem man eine Registerdatei
  // auf `null` setzt. Ein Register ist ein Objekt mit einer events-Liste;
  // alles andere ist eine kaputte Datei und damit eine kaputte MESSUNG.
  if (roh === null || typeof roh !== 'object' || Array.isArray(roh) || !Array.isArray(roh.events)) {
    throw new VerfassungsBruch(
      `R1: ${rel} ist keine Registerdatei (kein Objekt mit events-Liste). Eine vorhandene, `
      + 'aber unbrauchbare Datei ist ein Abbruch, kein leeres Glied.',
    );
  }
  return roh;
}

// Der Ketten-Aufloeser aus LR-14, an EINER Stelle. Er wirft benannt, wenn keine
// Registerdatei die runId fuehrt - "nicht gefunden" darf nie in ein leeres
// Verdikt kippen, und ein Beweis ohne Eintrag ist wertlos.
//
// Mehrdeutigkeit wirft im Aufloeser selbst (siehe dort). Hier bleibt der Fall
// "in keiner Datei" - "nicht gefunden" darf nie in ein leeres Verdikt kippen,
// und ein Beweis ohne Eintrag ist wertlos.
function registerDerRunId(runId) {
  // F7: EINE Lesung je Datei, und der gelesene Stand wird herausgegeben. Vorher
  // las der Aufloeser, dann las der Aufrufer noch einmal, und spaeter ein
  // drittes Mal - drei Zeitpunkte auf derselben Datei. Zwischen ihnen konnte
  // der Eintrag ein anderer werden, und bewiesen wuerde dann etwas, das beim
  // Aufloesen nicht dastand.
  const gelesen = new Map();
  const einmal = (rel) => {
    if (!gelesen.has(rel)) gelesen.set(rel, liesWennDa(rel));
    return gelesen.get(rel);
  };
  const rel = registerPfadDerRunId(runId, einmal);
  if (!rel) {
    throw new VerfassungsBruch(
      `R1: runId ${runId} steht in keiner der Registerdateien der Kette (${REGISTER_RELS.join(', ')})`,
    );
  }
  return { rel, pfad: absolut(rel), register: gelesen.get(rel) };
}

// Das Register wird mit derselben Formatierung zurueckgeschrieben, mit der es
// ausgeliefert wurde (ein Leerzeichen Einrueckung). Ein umformatiertes Register waere
// im Diff ein Neuschrieb und im Review nicht mehr lesbar.
//
// UND ATOMAR, ueber lib/atomic-write.js: ein direktes writeFileSync auf ein
// nur-anhaengendes, verkettetes Register laesst bei einem Abbruch mitten im
// Schreiben (Platte voll, Kill, Stromausfall, OneDrive-/AV-Sperre) eine halbe,
// ungueltige Datei zurueck - und dafuer gibt es keinen Reparaturweg im Werkzeug,
// nur `git checkout`. Der naechste Lauf saehe einen rohen SyntaxError aus
// JSON.parse. Genommen wird der vorhandene Helfer (Tag 189, ~20 Aufrufer im
// Repo), nicht ein zweiter Eigenbau: er kann mehr als tmp+rename - fsync der
// tmp-Datei VOR dem Umbenennen, Wiederholung des rename unter Windows-
// EPERM/EBUSY (OneDrive/AV halten Handles), fsync des Verzeichnisses, Schleife
// ueber Teilschreibvorgaenge. Zwei Kopien derselben Regel driften; eine nicht.
function schreibeRegister(register) {
  // LRA-2: DER SCHREIB-RAND. Genau hier, vor dem writeFileAtomic, und
  // nirgends sonst. Im Speicher anhaengen bleibt erlaubt - persistieren in
  // eine geschlossene Datei nicht.
  //
  // GEPRUEFT WIRD DIE DATEI, NICHT DAS UEBERGEBENE OBJEKT. Die erste Fassung
  // dieses Riegels prueft `register` - und das traegt den NEUEN Eintrag bereits
  // am Ende, nicht mehr den Abschluss-Akt. Der Riegel fiel damit lautlos durch
  // und die Probe schrieb in die geschlossene Datei (Eintrag 32, 198.510 B),
  // bevor sie ihn stellte. Die Eigenschaft haengt am ZIEL: ist die Datei, in
  // die geschrieben werden soll, mit ihrem Abschluss-Akt geschlossen?
  const zielStand = liesWennDa(ANMELDEZIEL_REL);
  if (zielStand && istGeschlossen(zielStand)) {
    throw new VerfassungsBruch(
      `R1: ${ANMELDEZIEL_REL} ist mit ihrem Abschluss-Akt GESCHLOSSEN - ihr letzter Eintrag `
      + 'verbietet jeden weiteren. Es wird nichts geschrieben. Ein Akt fuer die Fortsetzung '
      + 'braucht seinen eigenen Einzweck-Anhaenger mit --register.',
    );
  }
  writeFileAtomic(ANMELDEN_ZIEL, `${JSON.stringify(register, null, 1)}\n`, 'utf8');
}

// Die Ausgabe-Allowlist des Laufs. Ohne `--allowlist` ist es die der versiegelten
// Zaehlprobe — das ist der Normalfall und bleibt unveraendert. MIT `--allowlist`
// meldet ein Lauf seine EIGENEN Ausgabefelder an; gebraucht wird das ab E4a, wo die
// Diagnose mehr zaehlt als die Zaehlprobe und die versiegelte Praeregistrierung dafuer
// NICHT angefasst werden darf. Fail-closed: die Datei muss eine nicht leere Liste
// eindeutiger Zeichenketten enthalten, sonst waere eine kaputte Datei stillschweigend
// eine unbegrenzte Ausgabe.
function allowlistAus(pfad, praereg) {
  if (!pfad) return praereg.zaehlprobe.ausgabeAllowlist;
  const roh = JSON.parse(fs.readFileSync(pfad, 'utf8'));
  if (!Array.isArray(roh) || roh.length === 0
      || roh.some((n) => typeof n !== 'string' || n.trim() === '')) {
    throw new VerfassungsBruch(
      `R1: --allowlist ${pfad} enthaelt keine nicht leere Liste von Feldnamen. Eine Anmeldung `
      + 'ohne benannte Ausgabefelder waere eine Blankovollmacht.',
    );
  }
  if (new Set(roh).size !== roh.length) {
    throw new VerfassungsBruch(`R1: --allowlist ${pfad} fuehrt einen Feldnamen doppelt`);
  }
  return roh;
}

function anmelden(argv) {
  const runId = argument(argv, 'runid');
  const fenster = argument(argv, 'fenster');
  const zugriffAb = argument(argv, 'zugriff-ab');
  const praereg = lies(PRAEREG);
  const erlaubt = allowlistAus(argument(argv, 'allowlist', false), praereg);
  const begruendung = argument(argv, 'begruendung', false);

  // LRA-4: die Eindeutigkeit der runId gilt ueber die GANZE Kette, nicht je
  // Datei. Ohne diese Umstellung naehme die Umhaengung einen bestehenden Fang
  // weg: eine runId, die nur in der geschlossenen Datei steht, waere wieder
  // anmeldbar - und der spaetere Beweis fuer sie braeche an der
  // Mehrdeutigkeits-Sperre ab. Das waere Erosion, nicht Vollendung.
  if (registerPfadDerRunId(runId, liesWennDa)) {
    throw new VerfassungsBruch(
      `R1: runId ${runId} steht schon im Register. Nur-Anhaengen heisst auch: keine zweite Anmeldung `
      + 'unter demselben Namen — sonst waere hinterher nicht entscheidbar, welcher Lauf gemeint war.',
    );
  }
  const register = lies(ANMELDEN_ZIEL);
  const jetzt = new Date();
  const registeredAt = jetzt.toISOString();
  if (Date.parse(zugriffAb) <= Date.parse(registeredAt)) {
    throw new VerfassungsBruch(
      `R1: --zugriff-ab (${zugriffAb}) muss NACH der Anmeldung (${registeredAt}) liegen. `
      + 'Eine Anmeldung, die den Zugriff schon erlaubt, ist ein Nachher-Protokoll.',
    );
  }
  const eintrag = {
    runId,
    typ: ART_ZAEHLPROBE,
    registeredAt,
    accessedAt: zugriffAb,
    fenster: [fenster],
    allowedOutputs: erlaubt,
    erlaubt:
      'Ausschliesslich die Zaehlfelder der Ausgabe-Allowlist je Signalvariante. Keine Firmen-Kennungen, '
      + 'keine Monatsreihen, keine Wachstums- oder Persistenzwerte, keine Aktienzahl-Werte.',
    verboten:
      'Jede Ausgabe eines Umsatz-, Gewinn-, Aktienzahl- oder Kurswertes; jeder Zugriff auf ein anderes '
      + 'Fenster; jeder Zugriff auf Schluesselmaterial.',
    begruendung: begruendung
      || 'R15b Nur-Zaehlen-Probe vor der Einmal-Oeffnung (Angriff P3). Praeregistrierung FEM-SEC-US@2.0.0, '
      + 'Abschnitt zaehlprobe.',
    endtestSiegel:
      'unberuehrt — dieser Lauf oeffnet ausschliesslich die Panel-Datei des angemeldeten Fensters. Das '
      + 'Endtest-Fenster ist Sperrzone (Karl, 2026-08-19) und wird nicht gezaehlt.',
  };
  const neu = haengeEintragAn(register, eintrag);
  pruefeZugriffsRegister(neu);
  schreibeRegister(neu);
  const letzter = neu.events[neu.events.length - 1];
  process.stdout.write(
    `${JSON.stringify({ runId, registeredAt, accessedAt: zugriffAb, eventHash: letzter.eventHash }, null, 1)}\n`,
  );
  process.stdout.write(
    '\nJETZT: committen und pushen. Erst danach `bestaetigen` aufrufen — die Reihenfolge IST die Methodik.\n',
  );
  return 0;
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', cwd: WURZEL, maxBuffer: 64 * 1024 * 1024 });
}

function serverAntwort(pfad) {
  // `-i` liefert die Kopfzeilen mit. Der `Date`-Kopf ist die GitHub-Serveruhr; genau
  // sie verlangt R1, weil die lokale Uhr dem Laufenden gehoert.
  const roh = gh(['api', '-i', pfad]);
  const trenner = roh.indexOf('\r\n\r\n') >= 0 ? '\r\n\r\n' : '\n\n';
  const schnitt = roh.indexOf(trenner);
  if (schnitt === -1) throw new VerfassungsBruch('R1: Antwort ohne Kopf/Rumpf-Trennung');
  const kopf = roh.slice(0, schnitt);
  const rumpf = roh.slice(schnitt + trenner.length);
  const datum = /^date:\s*(.+)$/im.exec(kopf);
  if (!datum) {
    throw new VerfassungsBruch(
      'R1: die API-Antwort traegt keinen Date-Kopf. Ohne Serveruhr gibt es keine Bestaetigung — '
      + 'ein lokaler Zeitstempel waere genau das Alibi, das R1 ausschliesst.',
    );
  }
  const server = new Date(datum[1].trim());
  if (Number.isNaN(server.getTime())) {
    throw new VerfassungsBruch(`R1: unlesbarer Date-Kopf: ${datum[1]}`);
  }
  return { serverConfirmedAt: server.toISOString(), rumpf };
}

function bestaetigen(argv) {
  const runId = argument(argv, 'runid');
  const ziel = argument(argv, 'ziel');
  // Der Beweis gilt GEGEN main, nicht gegen den Zweig, auf dem man gerade steht.
  // register-single-appender-rule.json sagt beides ausdruecklich:
  // ledgerAppendsAllowedOnlyInCommitsLandingDirectlyOn = 'main', und Schritt 4 der
  // branchWorkSequence verlangt "confirm the MAIN-HOSTED entry and its independent
  // server time". Der bisherige Default `git rev-parse --abbrev-ref HEAD` liess die
  // Bestaetigung genau daran vorbeilaufen: ein Eintrag, der nur auf einem Zweig lag,
  // bekam sein Server-Siegel, ohne je auf main gelandet zu sein — und kein Aufrufer im
  // Repo uebergibt --zweig, der stille Pfad war also der einzige benutzte.
  const zweig = argument(argv, 'zweig', false) || SINGLE_APPENDER_ZWEIG;

  // G10/LR-14: die Datei wird ueber die KETTE aufgeloest, nicht am aktiven Ende
  // geraten. Ein Eintrag aus der Zeit vor der Naht liegt fuer immer in der
  // geschlossenen Datei - und GEGEN DIESE muss sein Beweis laufen.
  // F7: der Aufloeser gibt das BEREITS GELESENE Register heraus. Vorher wurde
  // dieselbe Datei dreimal gelesen (Aufloeser, hier, spaeter) - drei Lesungen,
  // drei Zeitpunkte, und der Eintrag konnte zwischen ihnen ein anderer werden.
  const { rel: registerRel, register } = registerDerRunId(runId);
  pruefeZugriffsRegister(register);
  const eintrag = (register.events || []).find((e) => e.runId === runId);
  if (!eintrag) throw new VerfassungsBruch(`R1: runId ${runId} steht nicht im lokalen Register`);
  if (!BESTAETIGBAR.has(eintrag.typ || eintrag.type)) {
    throw new VerfassungsBruch(
      `R1: Eintrag ${runId} traegt die Art ${eintrag.typ || eintrag.type} — bestaetigbar sind nur `
      + `${[...BESTAETIGBAR].join(', ')}`,
    );
  }

  const nwo = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
    encoding: 'utf8', cwd: WURZEL,
  }).trim();
  const { serverConfirmedAt, rumpf } = serverAntwort(
    `repos/${nwo}/contents/${registerRel}?ref=${encodeURIComponent(zweig)}`,
  );
  const inhalt = JSON.parse(rumpf);
  // F2: DIE ANTWORT WIRD GEPRUEFT, NICHT NUR GELESEN. Die API liefert `path`
  // und `sha` mit; beides wurde bisher weggeworfen. Ein Beweis, der nicht
  // nachsieht, WELCHE Datei er bekommen hat, beweist nichts ueber die Datei,
  // die er nennt.
  // UNBEDINGT, seit die Attrappe den Pfad liefert (LRA-1). Die Toleranz
  // `!== undefined` war die Kollisionsnarbe der gefallenen UNBERUEHRT-Klausel;
  // sie ist mit dem ANHANG gegenstandslos. Die echte GitHub-Antwort traegt
  // `path` immer - eine Antwort ohne ihn ist keine.
  if (inhalt.path !== registerRel) {
    throw new VerfassungsBruch(
      `R1: die API-Antwort traegt den Pfad ${inhalt.path || '<keiner>'}, angefragt war ${registerRel}. `
      + 'Ein Beweis gegen eine andere Datei als die, die den Eintrag fuehrt, ist kein Beweis.',
    );
  }
  const entfernt = Buffer.from(inhalt.content || '', inhalt.encoding || 'base64').toString('utf8');
  // Gegenprobe an der eigenen Kette: das, was auf dem Server liegt, muss dieselbe
  // gueltige Kette sein wie lokal. Ein Server-Stand mit gebrochener Kette waere ein
  // gepushter Nachher-Eintrag.
  const fern = JSON.parse(entfernt);
  pruefeZugriffsRegister(fern);
  // F2, DER KERN: frueher stand hier `entfernt.includes(eintrag.eventHash)` -
  // eine Textsuche in den ROHEN BYTES. Die Naht STELLT DIESE KOLLISION SELBST
  // HER: der eventHash des Abschluss-Akts steht dreimal im KOPF der
  // Fortsetzung (genesisSha256, vorgaengerTailHash,
  // vorgaengerCheckpointEventHash). Eine Fortsetzung mit NULL Eintraegen
  // liefert damit einen vollstaendig gruenen Beweis. Gesucht wird deshalb der
  // EINTRAG - ueber seine runId - und sein eventHash wird verglichen. Das
  // Python-Gegenstueck (scripts/studie-zaehlprobe.py) macht es seit jeher so.
  const fernEintraege = (fern.events || []).filter((e) => e.runId === runId);
  if (fernEintraege.length !== 1) {
    throw new VerfassungsBruch(
      `R1: der Register-Eintrag ${runId} steht ${fernEintraege.length}-mal in ${registerRel} auf `
      + `origin/${zweig}, erwartet genau einmal. Ein Zaehllauf ohne eindeutige, bestaetigte `
      + 'Vorab-Anmeldung ist wertlos und beschaedigt die Studie — es wird nicht gezaehlt.',
    );
  }
  if (fernEintraege[0].eventHash !== eintrag.eventHash) {
    throw new VerfassungsBruch(
      `R1: der Eintrag ${runId} traegt auf origin/${zweig} den eventHash `
      + `${String(fernEintraege[0].eventHash).slice(0, 16)}..., lokal ${eintrag.eventHash.slice(0, 16)}.... `
      + 'Der Stand auf dem Server ist ein anderer als der, der hier bewiesen werden soll.',
    );
  }

  const freigabe = {
    schema: 'early-detection-zaehlprobe-freigabe/v1',
    protokoll: 'FEM-SEC-US@2.0.0',
    runId,
    fenster: (eintrag.fenster || [])[0],
    registerEventHash: eintrag.eventHash,
    // F9: WELCHE Registerdatei den Eintrag fuehrt, gehoert in den Beweis. Ohne
    // dieses Feld muss der Leser (und scripts/studie-zaehlprobe.py) raten, und
    // nach der Naht ist Raten falsch.
    registerDatei: registerRel,
    registerZweig: zweig,
    registeredAt: eintrag.registeredAt,
    accessedAt: eintrag.accessedAt,
    serverConfirmedAt,
    quelle: `gh api -i repos/${nwo}/contents/${registerRel}?ref=${zweig} — Date-Kopf der Antwort`,
    bedeutung:
      'Ab serverConfirmedAt ist maschinell belegt, dass die Vorab-Anmeldung auf origin liegt. Jeder '
      + 'Datenzugriff dieses Laufs muss SPAETER liegen; scripts/studie-zaehlprobe.py bricht sonst ab.',
  };
  // Sanity: die Anmeldung muss vor der Serverbestaetigung liegen, sonst hat jemand die
  // Reihenfolge gedreht.
  if (Date.parse(eintrag.registeredAt) >= Date.parse(serverConfirmedAt)) {
    throw new VerfassungsBruch(
      `R1: die Anmeldung (${eintrag.registeredAt}) liegt nicht vor der Server-Bestaetigung (${serverConfirmedAt}).`,
    );
  }
  // Der Vergleich, der hier wirklich etwas beweist: die im Register angemeldete
  // FRUEHESTE Zugriffszeit muss nach der Server-Bestaetigung liegen. Sonst hat der
  // Push laenger gedauert als das Zeitfenster der Anmeldung, und der Lauf muss neu
  // angemeldet werden. (Die erste Fassung reichte hier einen selbst konstruierten
  // Zeitpunkt hinein und konnte deshalb per Konstruktion nie fehlschlagen —
  // Code-Review 19.08.)
  pruefeServerzeit({ serverConfirmedAt, ersterZugriffAm: eintrag.accessedAt });
  fs.mkdirSync(path.dirname(path.resolve(ziel)), { recursive: true });
  // Auch das Freigabe-Protokoll atomar: scripts/studie-zaehlprobe.py liest es als
  // Tor vor dem Datenzugriff. Eine halbe Datei waere dort kein Halt, sondern ein
  // Parse-Fehler an einer Stelle, an der ein Halt gemeint war.
  writeFileAtomic(ziel, `${JSON.stringify(freigabe, null, 1)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(freigabe, null, 1)}\n`);
  return 0;
}

function haupt(argv) {
  const befehl = argv[0];
  if (befehl === 'anmelden') return anmelden(argv);
  if (befehl === 'bestaetigen') return bestaetigen(argv);
  process.stderr.write(
    'Aufruf:\n'
    + '  node scripts/studie-r1-serverzeit.js anmelden --runid <id> --fenster <name> --zugriff-ab <ISO>\n'
    + '        [--allowlist <datei.json>] [--begruendung <text>]\n'
    + '  node scripts/studie-r1-serverzeit.js bestaetigen --runid <id> --ziel <freigabe.json> [--zweig <name>]\n',
  );
  return 2;
}

if (require.main === module) {
  try {
    process.exit(haupt(process.argv.slice(2)));
  } catch (fehler) {
    process.stderr.write(`${fehler instanceof VerfassungsBruch ? 'VERFASSUNGSBRUCH' : 'FEHLER'}: ${fehler.message}\n`);
    process.exit(1);
  }
}

// Die bestaetigbaren Arten nach aussen: eine KOPIE, nie der lebende Handgriff
// auf BESTAETIGBAR. Der Gleichheits-Anker (F6-B17a) soll die Menge am OBJEKT
// pruefen statt sie abzutippen — aber ein exportiertes Set liesse sich von
// jedem requirenden Modul per `.add()` erweitern, und das waere dieselbe
// fail-closed-Schranke, nur von innen geoeffnet.
function bestaetigbareArten() {
  return new Set(BESTAETIGBAR);
}

module.exports = {
  anmelden, bestaetigen, serverAntwort, allowlistAus, bestaetigbareArten,
  // Der Ketten-Aufloeser nach aussen, damit seine Fehlklassen GEPRUEFT werden
  // koennen statt nur behauptet: ein Aufloeser, der still auf die falsche Datei
  // zeigt, laesst einen Beweis gegen den falschen Eintrag gruen durchgehen.
  registerDerRunId, liesWennDa,
};
