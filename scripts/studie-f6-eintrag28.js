#!/usr/bin/env node
'use strict';

// Studie 2.0, F6-Tor — EINTRAG 28: DER UEBERSCHREIBENDE KONFIRMATORISCHE AKT.
//
// EIGENES Werkzeug nach F6-B8. Das Werkzeug zu Eintrag 27
// (scripts/studie-f6-konfirmatorisch.js) ist zum SCHREIBEN stillgelegt und
// bekommt seinen Schreibweg NICHT zurueck; es bleibt als Beleg stehen, wie
// Eintrag 27 entstand.
//
// Eintrag 27 ist aus DREI Spuren ROT (Schritt-8-Review) und wird nach F6-C24c
// SUPERSEDIERT. Dieser Akt traegt alles, was Eintrag 27 trug, PLUS die sieben
// bewiesenen Luecken (B1..B7), PLUS die ANHANG-3-Korrekturen.
//
// Trockenlauf ist der STANDARD. Kein --force. Die Sollwerte stehen hier
// UNABHAENGIG von den geprueften Dateien und werden zur Laufzeit am Objekt
// nachgerechnet.
//
//   node scripts/studie-f6-eintrag28.js                 # Trockenlauf
//   node scripts/studie-f6-eintrag28.js --zeige-eintrag # + Eintrag als JSON
//   node scripts/studie-f6-eintrag28.js --schreiben     # anhaengen

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { writeFileAtomic } = require('../lib/atomic-write.js');
const { canonicalSha256 } = require('../lib/early-detection.js');
const {
  VerfassungsBruch, haengeEintragAn, pruefeZugriffsRegister, ART_ZUGRIFF,
} = require('../lib/studie-verfassung.js');

const WURZEL = path.join(__dirname, '..');
const LEDGER_REL = 'protocol/early-detection/2.0.0/outcome-access-ledger.json';
const LEDGER = path.join(WURZEL, ...LEDGER_REL.split('/'));

const RUN_ID = 'f6-konfirmatorisch-v2-2026-09-01';
const VORLAUF_MINUTEN = 120;
const ERWARTETE_EVENTS = 27;
const ERWARTETER_LETZTER_RUNID = 'f6-konfirmatorisch-2026-09-01';
const ERWARTETER_TAIL = '5ad8a38a9f0cb6fcebb82878e944d691cdc76df66725cc6e63fb8ac8e75f16c3';
const UEBERHOLTER_EINTRAG = 'f6-konfirmatorisch-2026-09-01';

// ── F6-C7e-c(1) — DER WURZELFIX: die Bindungskarte ist NICHT mehr rollenlos.
// Jede Bindung traegt `art` und einen `rolle`-Satz mit der tragenden Auflage.
// In Eintrag 27 stand studie-e2-verbreitert.py rollenlos in einer flachen
// Karte unter einem Fehlertext, der pauschal "die ausfuehrenden Skripte"
// behauptete - dadurch war die von F6-C7e befohlene Negativ-Klausel AKTIV
// FALSCH. Ohne diesen Wurzelfix ebnet der naechste Eintrag dieselbe Trennung
// wieder ein.
const SKRIPTE = {
  'scripts/studie-f6-lauf.py': {
    sha: 'd04a0eaeeb05a17631122cb2f87ac587946d9e345705e348d265ba4dcd9fb688',
    art: 'ausfuehrend',
    rolle: 'Der Laeufer des einen konfirmatorischen Laufs (F6-C24(1)).',
  },
  'scripts/studie-f6-zaehlwerk.py': {
    sha: '3f21cd0aaa68028ae51945d3b51d7bd74e005de98204015bc5874eb352fc780a',
    art: 'ausfuehrend',
    rolle: 'Das gebundene Zaehlwerk hinter dem eingefrorenen Vertrag zaehle() (F6-C1).',
  },
  'scripts/studie-zaehlprobe.py': {
    sha: 'a3fce5a1672e231fe12d7d7ffc8a3655ad8e3ef9b3bd2a2195e1af5fcbdbf17b',
    art: 'ausfuehrend',
    rolle: 'Praeregistrierte Regelfunktionen (arm_zaehlen, ist_zensiert, im_signalband), F6-C2.',
  },
  'scripts/studie-basisraten.py': {
    sha: '997a80d26871937f848b3eea76a9b4ba1a4e1c76f1cc3c30db98d7888ec2601d',
    art: 'ausfuehrend',
    rolle: 'Das VERSIEGELTE Modul; als Ausfuehrungsbeweis gebunden (F6-C24, F6-C4).',
  },
  'scripts/studie-f6-klumpen-se.py': {
    sha: 'bf10becdfe2dc08a303d22a97dda3eb65988fb72a50f8811c23b2c377c11a1d3',
    art: 'ausfuehrend',
    rolle: 'Die Klumpen-SE als eigener Prozess, Wortlaut F6-SE-KLUMPEN/v1 (Eintrag 24).',
  },
  'scripts/studie-vb-b4-band.py': {
    sha: 'c5ff07d3e2b5037e20073da0a7abb9b71443430efc63986d4ddbeb1a85ed76d8',
    art: 'erzeuger-und-teilausfuehrend',
    rolle: 'Byte-Pin des Band-Artefakts UND im Lauf gerufenes Bandmodul (F6-B4 / F6-C18).',
  },
  'scripts/studie-e2-verbreitert.py': {
    sha: '9a24ed94e943e9a6f5b4a1373ba6c6aa2001ddadb2d60a705277bf5eb359984b',
    art: 'erzeuger-und-teilausfuehrend',
    rolle: 'DREI Rollen, die einander nicht ersetzen - siehe Feld dreifachBezeichnung '
      + '(F6-C7e-b). Erzeuger des Schwellen-Satzes; ausfuehrendes Werkzeug '
      + 'AUSSCHLIESSLICH der Bein-1-Lauf-Haelfte; Laufzeit-Bindung und PIN aus '
      + 'Eintrag 23. Fuer die KALIBRIER-HAELFTE wird es NICHT aufgerufen.',
  },
  'scripts/studie-panel-digest.py': {
    sha: '14414d2633f74b94662d503336db61be6825f3c7b89b6ebcf3275a841396f33f',
    art: 'ausfuehrend',
    rolle: 'Der Byte-Digest des Panels (F6-C23).',
  },
  'scripts/studie-r1-serverzeit.js': {
    sha: '21fba6882239d24ca70e6e3fd2f6610baa5d7bddfded0d0d030bbe4090ec5257',
    art: 'ausfuehrend',
    rolle: 'Anmeldung und Serverbeweis der Zeitkette (VB-A11 / F6-B19).',
  },
  'scripts/studie-f6-aequivalenz-anmeldung.js': {
    sha: '68785c7aa46432ae4da0c880306645c272b1d91134b305ce6075bcbdac868d4d',
    art: 'erzeuger',
    rolle: 'Einzweck-Anhaenger des Zaehlproben-Akts (Eintrag 25). Nicht ausfuehrend.',
  },
  'scripts/studie-f6-berichtigung-bein2.js': {
    sha: '0a1bede8772b6ec30fc03becc79b12d4a1aff3f8af720848396db48ea79c7096',
    art: 'erzeuger',
    rolle: 'Einzweck-Anhaenger des Bein-2-Berichtigungs-Vermerks (Eintrag 26). Nicht ausfuehrend.',
  },
};

const ARTEFAKTE = {
  'protocol/early-detection/2.0.0/preregistration.json':
    '799f925142860b4db97b5f18894b62c749aeb014872279aa6a7df8ee99ac5a6c',
  'protocol/early-detection/2.0.0/rules.json':
    'dc008723798f58fdae3cc67b36817aebf88b090acd8472cedda141f1e4b021bc',
  'protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json':
    '80798025d2ad6387b3ed72048227112426369ec8392ae633a92df58f0cf4d1e5',
  'protocol/early-detection/2.1.0/f6-vollzug-zweig-a-2026-08-31.json':
    '8c66818e80140b16a473c278a47327d726601e14de83450d2ed6d353e55e4427',
  'protocol/early-detection/2.1.0/b4-bandregel-2026-08-30.json':
    'd9c5990ad403b6baca2e3a4228218af0b73367e4f51ffd213ac654fc41cdc5da',
  'protocol/early-detection/2.1.0/jahrgang-registrierung-2026-08-30.json':
    'aa4277fa9f39f38b3d1ffa4f9048d76f33e2515aa64afa021165d7895cb6074f',
  'protocol/early-detection/2.1.0/konzeptliste.json':
    'f7a123f9f5fc5109c07e9c18754da4b785d45b2391a9417fe4150fb48798357b',
  'protocol/early-detection/2.1.0/f6-se-klumpen-v1-wortlaut.json':
    '10e812fa345bba545077f333de7d81edf18bb371e9e48ee7b697558c1bc944e8',
  'reports/studie/E4d-kadenz-entdeckung-2026-08-19.json':
    '46e191ec68e0480a336fd287dc548c8b6a975b8d50a07c6e0162274c6dbd8fdf',
};

const INHALT_SHA = {
  'protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json':
    'c4a888906e4cb26a1a4994c54fc34b89c068e40646a800d3d07c7051308b2bee',
  'protocol/early-detection/2.1.0/f6-vollzug-zweig-a-2026-08-31.json':
    '792f4ff58687945167e273d08ca509544f4ad7fd7ecd9eaa60d5dac3118c99f7',
  'protocol/early-detection/2.1.0/b4-bandregel-2026-08-30.json':
    '1fd6a9f3ceb6dab0076c6812f57483889708345d6a87c6103a7515689cf8c46e',
  'protocol/early-detection/2.1.0/jahrgang-registrierung-2026-08-30.json':
    '0363702f5aa6fd486a6901aecaef3108f81828248657bcfb455b6a4ae413c567',
  'protocol/early-detection/2.1.0/konzeptliste.json':
    '88ba14a298837bcc6287c4f52a3ba61296b6ba56d96ba78cba0470335df99247',
};
// Wie in Eintrag 27 gemessen und dort offengelegt: die Artefakte mit eigenem
// Feld inhaltSha256 sind PYTHON-seitig kanonisiert; der Haus-Kanonisierer
// reproduziert sie nicht. Sie werden als SELBSTDEKLARIERT gefuehrt (die Bytes
// traegt der dateiSha256-Riegel); nur konzeptliste.json wird nachgerechnet.
const INHALT_MODUS = {
  'protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json': ['selbstdeklariert', null],
  'protocol/early-detection/2.1.0/f6-vollzug-zweig-a-2026-08-31.json': ['selbstdeklariert', null],
  'protocol/early-detection/2.1.0/b4-bandregel-2026-08-30.json': ['selbstdeklariert', null],
  'protocol/early-detection/2.1.0/jahrgang-registrierung-2026-08-30.json':
    ['selbstdeklariert', null],
  'protocol/early-detection/2.1.0/konzeptliste.json': ['nachgerechnet', 'konzeptliste'],
};

const MANIFEST_REL = 'protocol/early-detection/2.0.0/hash-manifest.json';
const MANIFEST_SHA = '3eff89b487914f39c9a7317d56912506a77860cb37c63380310257cdb6091d26';
const BERICHT_REL = 'reports/studie/f6-aequivalenz-entdeckung-2026-09-01.json';
const BERICHT_SHA = 'e461dda396bc0401e24f12e9d4142e0d78f7445cf91ae1102ca8ea7eccb7b541';
const WORTLAUT_TEXT_SHA =
  'd4f8d4d79927c2b58e351074bb9b026b3e79915652d7cd5b1b9b51eccdbafda1';

// ── B7 — JEDER Ausgabepfad traegt die Pflicht, die ihn verlangt (F6-B12).
// 30 DATEN-Schluessel + 4 differenz-Unterschluessel + 3 tor-Unterschluessel = 37.
const PFLICHT_JE_SCHLUESSEL = {};
const _gruppe = (pflicht, keys) => keys.forEach((k) => { PFLICHT_JE_SCHLUESSEL[k] = pflicht; });
_gruppe('F6-B12 Gruppe 1 (Zaehlung): der Netto-Tornenner und seine Rate.',
  ['zaehler_reife', 'nenner_tor', 'anteil']);
_gruppe('F6-B12 Gruppe 2 (Streuung): Wortlaut F6-SE-KLUMPEN/v1, Eintrag 24.',
  ['se_binomial', 'se_klumpen_robust', 'se_stern', 'se_entschied', 'klumpen_anzahl']);
_gruppe('F6-B12 Gruppe 3 (Band): b4-bandregel-Artefakt, F6-B4 / F6-C18.',
  ['wilson95_unten', 'wilson95_oben', 'abstand_zu_090', 'abstand_zu_329_von_365',
    'bandbreite_absolut', 'bandbreite_in_se', 'schwelle', 'fallzahl_min',
    'messgeraet_vollstaendig']);
_gruppe('F6-B12 Gruppe 4 (Verdikt): F6-C17 Zweig-Pflichtteilmengen, F6-C19 Null-Anwesenheit.',
  ['verdikt', 'weiter', 'grund', 'etikett', 'pflichtsatz', 'zweitsatz']);
_gruppe('F6-B12 Gruppe 5 (Zerlegung): A16-Kreuz ueber n_B_unreif (Ruling 1).',
  ['n_A', 'n_B_reif', 'n_B_unreif', 'n_verloren', 'feuerfaehig',
    'strukturell_nicht_feuerfaehig', 'rechts_zensiert']);
_gruppe('F6-C13 / F6-C15: der EINE armuebergreifende Schluessel differenz_punkte.',
  ['differenz_punkte.wert', 'differenz_punkte.maxDifferenzPunkte',
    'differenz_punkte.erfuellt', 'differenz_punkte.quelle']);
_gruppe('F6-C13b (ANHANG 3): das Tor-Verdikt als UNTEROBJEKT des EINEN Schluessels.',
  ['differenz_punkte.tor.verdikt', 'differenz_punkte.tor.weiter',
    'differenz_punkte.tor.grund']);

const DATEN_SCHLUESSEL = Object.keys(PFLICHT_JE_SCHLUESSEL)
  .filter((k) => !k.startsWith('differenz_punkte.'));
const ALLOWED_OUTPUTS = Object.keys(PFLICHT_JE_SCHLUESSEL);

// F6-C18 / KZ-7 — am Objekt gemessen, unmittelbar vor diesem Akt, am
// GEMERGTEN Stand aeefb68125.
const ANKER = {
  datei: 'scripts/studie-vb-b4-band.py',
  funktion: 'auswerten :145-227',
  konvention: 'fuehrende Zeile (def bzw. das entscheidende `if`) plus die vollstaendige '
    + 'return-Anweisung',
  gate_gerissen: ':168-172',
  im_band: ':213-217',
  ausserhalb_band: ':218-227',
  laeuferKommentar: 'scripts/studie-f6-lauf.py :415-447 (ZWEIG_PFLICHT-Zuweisung :452)',
  laeuferKommentarBerichtigt:
    'BERICHTIGT gegenueber Eintrag 27 (dort ":395-426 / Zuweisung :432"). Zwei Gruende: '
    + 'der Block hatte schon damals eine Zeile mehr (:427 trug "# Strikte Gleichheit waere '
    + 'hier ein Fehlalarm - genau V3s Korrektur." und fiel aus der Spanne), und die '
    + 'Zeilennummern haben sich durch PR G+H verschoben. Hier steht der am GEMERGTEN '
    + 'Stand neu gemessene Wert: 33 zusammenhaengende Kommentarzeilen, davor eine '
    + 'Leerzeile, danach Code ab :448.',
};

const ARBEITSPFAD_KURZ = 'f6-arbeit';

const argument = (argv, n) => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) throw new VerfassungsBruch(`F6-E28: --${n} ohne Wert.`);
  return v;
};
const lies = (p) => {
  if (!fs.existsSync(p)) throw new VerfassungsBruch(`F6-E28: nicht gefunden: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};
const dsha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// R12a an der Schreib-Grenze, ueber den GEPARSTEN Baum (JSON verdoppelt
// Rueckstriche; ein Muster ueber den Text greift daran vorbei).
function pruefeKeinNutzerpfad(obj) {
  const werte = [];
  (function sammle(v) {
    if (typeof v === 'string') werte.push(v);
    else if (Array.isArray(v)) v.forEach(sammle);
    else if (v && typeof v === 'object') {
      for (const [k, w] of Object.entries(v)) { werte.push(k); sammle(w); }
    }
  }(obj));
  const BS = String.fromCharCode(92);
  const S = `[${BS}${BS}/]`;
  const MUSTER = [
    ['Windows-Laufwerkspfad', new RegExp(`\\b[A-Za-z]:${S}{1,2}Users\\b`)],
    ['Windows-Nutzerverzeichnis', new RegExp(`${S}Users${S}[A-Za-z]`)],
    ['Unix-Heimverzeichnis', new RegExp(`(^|[\\s"'(=])/${['ho', 'me'].join('')}/[a-z]`, 'm')],
    ['Umgebungs-Nutzerpfad',
      new RegExp(`%${['USER', 'PROFILE'].join('')}%|\\$${['HO', 'ME'].join('')}\\b`)],
    ['Windows-Laufwerkspfad, beliebiges Ziel',
      new RegExp(`(^|[\\s"'(=[,])[A-Za-z]:${S}{1,2}[A-Za-z0-9_.-]`, 'm')],
  ];
  for (const [name, regex] of MUSTER) {
    for (const wert of werte) {
      const treffer = regex.exec(wert);
      if (treffer) {
        throw new VerfassungsBruch(
          `F6-E28: der Eintrag traegt ${name} (${treffer[0]}). R12a verbietet das in `
          + 'einem 2.0.0-Artefakt.');
      }
    }
  }
}

function pruefeAlles(wurzel) {
  const gemessen = { skripte: {}, artefakte: {} };
  for (const [rel, bindung] of Object.entries(SKRIPTE)) {
    const p = path.join(wurzel, ...rel.split('/'));
    if (!fs.existsSync(p)) throw new VerfassungsBruch(`F6-E28: gebundenes Skript fehlt: ${rel}`);
    const ist = dsha(p);
    if (ist !== bindung.sha) {
      throw new VerfassungsBruch(
        `F6-E28: ${rel} weicht ab (ist ${ist}, soll ${bindung.sha}). Ein anderer Hash ist ein `
        + 'anderes Skript. Die Karte fuehrt je Bindung ART und ROLLE (F6-C7e-c); dieser '
        + 'Text behauptet NICHT pauschal, alle Eintraege seien ausfuehrende Skripte.');
    }
    gemessen.skripte[rel] = { dateiSha256: ist, art: bindung.art, rolle: bindung.rolle };
  }
  for (const [rel, soll] of Object.entries(ARTEFAKTE)) {
    const p = path.join(wurzel, ...rel.split('/'));
    if (!fs.existsSync(p)) throw new VerfassungsBruch(`F6-E28: gebundenes Artefakt fehlt: ${rel}`);
    const ist = dsha(p);
    if (ist !== soll) throw new VerfassungsBruch(`F6-E28: ${rel} weicht ab (ist ${ist}).`);
    const e = { dateiSha256: ist };
    if (INHALT_SHA[rel]) {
      const d = lies(p);
      const [modus, zweig] = INHALT_MODUS[rel];
      const ii = modus === 'nachgerechnet' ? canonicalSha256(d[zweig]) : d.inhaltSha256;
      if (ii !== INHALT_SHA[rel]) {
        throw new VerfassungsBruch(
          `F6-E28: ${rel} inhaltSha256 ist ${ii}, soll ${INHALT_SHA[rel]} (Modus ${modus}).`);
      }
      e.inhaltSha256 = ii;
      e.inhaltSha256Herkunft = modus;
    }
    gemessen.artefakte[rel] = e;
  }
  const mp = path.join(wurzel, ...MANIFEST_REL.split('/'));
  const mist = dsha(mp);
  if (mist !== MANIFEST_SHA) {
    throw new VerfassungsBruch(`F6-E28: hash-manifest weicht ab (ist ${mist}).`);
  }
  // Der Aequivalenz-Bericht: Datei UND Verdikt.
  const bp = path.join(wurzel, ...BERICHT_REL.split('/'));
  if (!fs.existsSync(bp)) throw new VerfassungsBruch('F6-E28: Aequivalenz-Bericht fehlt.');
  const bist = dsha(bp);
  if (bist !== BERICHT_SHA) {
    throw new VerfassungsBruch(`F6-E28: Aequivalenz-Bericht weicht ab (ist ${bist}).`);
  }
  const bericht = lies(bp);
  if (bericht.daten.bestanden !== true) {
    throw new VerfassungsBruch('F6-E28: der Aequivalenz-Bericht fuehrt bestanden != true.');
  }
  // Der eingefrorene Wortlaut, gegen den Bein 3 seine Ziffer 5 haelt.
  const wp = path.join(wurzel, 'protocol', 'early-detection', '2.1.0',
    'f6-se-klumpen-v1-wortlaut.json');
  const wtext = lies(wp).wortlaut;
  const wsha = crypto.createHash('sha256').update(Buffer.from(wtext, 'utf8')).digest('hex');
  if (wsha !== WORTLAUT_TEXT_SHA) {
    throw new VerfassungsBruch(`F6-E28: der Wortlaut-Text ist ${wsha}, registriert ${WORTLAUT_TEXT_SHA}.`);
  }
  return { gemessen, manifest: mist, bericht: { dateiSha256: bist, daten: bericht.daten } };
}

function baueEintrag(registeredAt, wirksamAb, m) {
  return {
    runId: RUN_ID,
    typ: ART_ZUGRIFF,
    registeredAt,
    accessedAt: wirksamAb,
    fenster: ['pruefung'],
    allowedOutputs: ALLOWED_OUTPUTS,

    erlaubt: 'Ausgegeben werden ausschliesslich die in allowedOutputs gelisteten Pfade: die '
      + '30 DATEN-Felder je Variante x Arm, die vier Unterschluessel des EINEN '
      + 'armuebergreifenden Objekts differenz_punkte (F6-C15) und die drei Unterschluessel '
      + 'des darunter liegenden Tor-Objekts differenz_punkte.tor (F6-C13b).',
    verboten: 'Jede Firmen-Kennung, jede Monatsreihe, jeder Wachstums-, Persistenz-, '
      + 'Aktienzahl-, Kurs- oder Renditewert; jeder Zugriff auf ein anderes Fenster; jede '
      + 'Ausgabe ausserhalb von allowedOutputs (ein nicht gelisteter Schluessel ist ein '
      + 'ABBRUCH, kein Filter - preregistration.json:232).',

    begruendung: 'DER UEBERSCHREIBENDE KONFIRMATORISCHE AKT. Er ersetzt Eintrag 27 '
      + '(f6-konfirmatorisch-2026-09-01), dessen Schritt-8-Review aus DREI Spuren ROT '
      + 'zurueckkam. Er traegt alles, was Eintrag 27 trug, PLUS die sieben vom '
      + 'Akt-Reviewer bewiesenen Luecken, PLUS die Korrekturen aus ANHANG 3. Autorisiert '
      + 'wird der EINE konfirmatorische F6-Lauf auf dem Prueffenster unter Kontingent EINS '
      + '(K2/A10) - und nur er.',

    endtestSiegel: 'unberuehrt und in ALLEN Zweigen ZU. Dieser Lauf oeffnet ausschliesslich '
      + 'die Panel-Datei des angemeldeten Prueffensters. Auch bei BESTANDEN gibt es KEINEN '
      + 'Automatismus in Richtung Endtest (F6-A16, Karls ausdrueckliche Freigabe).',

    eingabenHashes: {
      hinweis: 'Die Karte fuehrt je Bindung ART und ROLLE (F6-C7e-c). Sie behauptet NICHT '
        + 'pauschal, alle Eintraege seien ausfuehrende Skripte - genau diese Einebnung war '
        + 'ein Supersedierungsgrund von Eintrag 27.',
      skripte: m.gemessen.skripte,
      artefakte: m.gemessen.artefakte,
      aequivalenzBericht: { pfad: BERICHT_REL, dateiSha256: m.bericht.dateiSha256 },
      vorherNachher: {
        hinweis: 'F6-C24b: alle Code-Aenderungen an Laeufer und Zaehlwerk liegen VOR diesem '
          + 'Eintrag; er bindet ihre neuen SHA neu.',
        'scripts/studie-f6-lauf.py': {
          vorher: '36664e70128fe02c114e5cdaa81c394091bb8fae809940f109dbc6abe7a168d0',
          nachher: SKRIPTE['scripts/studie-f6-lauf.py'].sha,
          durch: 'PR #215 (die zehn Naht-Fixes des Schritt-8-Reviews und die '
            + 'ANHANG-3-Verdrahtung), gemergt als aeefb68125.',
        },
        'scripts/studie-f6-zaehlwerk.py': {
          vorher: 'f47f10d555c701c08e1282aa7e3b41424b836b0851edbdbb80f83839b9f99410',
          nachher: SKRIPTE['scripts/studie-f6-zaehlwerk.py'].sha,
          durch: 'PR #215, gemergt als aeefb68125.',
        },
      },
    },

    // ── B1 — gateEvidenz vollstaendig: der SE-Freeze-Eintrag mit eventHash.
    gateEvidenz: {
      b4Artefakt: ARTEFAKTE['protocol/early-detection/2.1.0/b4-bandregel-2026-08-30.json'],
      b4InhaltSha256: INHALT_SHA['protocol/early-detection/2.1.0/b4-bandregel-2026-08-30.json'],
      seFreezeEintrag: {
        runId: 'f6-se-klumpen-freeze-2026-08-31',
        ordinal: 'Eintrag 24',
        eventHash: 'e9e0eeb3edcf5ac2af64bdd054ba6f2c28be9e82e30ec5eaff9e8c718e64ed8d',
        berichtigt: 'Eintrag 27 fuehrte hier NUR den Namen und liess den eventHash weg - das '
          + 'eine Element, das F6-B2 (VOLLZUG:283) ausdruecklich nennt. Nachgetragen.',
      },
      zaehlprobeEintrag: {
        runId: 'f6-aequivalenz-entdeckung-2026-09-01',
        eventHash: '847084648a7fa5d7d8535c7eec3285de44ac94c02cce1e94f204528f34358d41',
      },
      berichtigungsEintrag: {
        runId: 'f6-bein2-berichtigung-2026-09-01',
        eventHash: 'f9fbaac79675c08cf9137b9c51d022c9b32003940de01435b4f260d2b928c2a9',
      },
    },

    // ── B2 — die vollstaendige F6-B19-Beurkundung von PR B.
    f6b19Beurkundung: {
      pflicht: 'F6-B19 (VOLLZUG:310) verlangt woertlich: "Vorher/Nachher-SHA-256 der Datei, '
        + 'PR-Nummer, Testname und Bruchprobe werden in Eintrag 25 namentlich beurkundet." '
        + 'F6-C24(4) macht "Eintrag 25" zu diesem Eintrag. In Eintrag 27 fehlten ALLE VIER '
        + 'Stuecke.',
      datei: 'scripts/studie-r1-serverzeit.js',
      prNummer: 186,
      prTitel: 'BESTAETIGBAR fuehrt die konfirmatorische Zugriffsart (F6-B16..B19)',
      zweig: 'f6-bestaetigbar',
      mergeCommit: '51068c54c3408f560c93bbd1fcc3c97545e191db',
      mergedAt: '2026-08-31T21:50:32Z',
      vorherSha256: 'c2c858d3bca134a829a6b50e4fce19426a5fb51dd02ea18717da04131ee8056b',
      nachherSha256: '21fba6882239d24ca70e6e3fd2f6610baa5d7bddfded0d0d030bbe4090ec5257',
      shaGemessenAn: 'vorher am ersten Elternteil b61f5135e1101429a8b95ac26ea6e9e1bd937f21, '
        + 'nachher am Merge-Commit; der Nachher-Wert ist zusaetzlich am heutigen '
        + 'origin/main gegengemessen und identisch.',
      aenderung: 'BESTAETIGBAR = new Set([ART_ZAEHLPROBE, ART_C0_REGELFREEZE]) wurde zu '
        + 'new Set([ART_ZUGRIFF, ART_ZAEHLPROBE, ART_C0_REGELFREEZE]); dazu der '
        + 'ART_ZUGRIFF-Import und der Kopie-Getter bestaetigbareArten().',
      testdatei: 'tests/studie-r1-bestaetigbar-zugriff.test.js (neu in #186, 7 Proben)',
      testnameAnker: 'F6-B17(a): BESTAETIGBAR ist genau die Zugriffszeit-Menge der Verfassung',
      weitereTestnamen: [
        'F6-B17(b): ein confirmatory_execution_authorized-Eintrag wird bestaetigt',
        'F6-B17(c): eine Phantasie-Art wirft weiterhin VerfassungsBruch, mit der Art im Text',
        'F6-B17(c): eine BEKANNTE, aber nicht bestaetigbare Art faellt an BESTAETIGBAR auf',
        'F6-B17(d): anmelden() meldet weiterhin als ZAEHLPROBE an, nie konfirmatorisch',
        'F6-B17(e): eine konfirmatorische Freigabe bricht die Zaehlprobe mit W2-ABBRUCH ab',
        'F6-B16: dieser Test hat das Zugriffs-Register nicht angefasst',
      ],
      bruchproben: {
        quelle: 'Der PR-Text von #186, Abschnitt "BRUCHPROBEN - PROTOKOLL, DREI RICHTUNGEN '
          + '(F6-B18 / KV-3), nach der Getter-Umstellung neu gefahren". Die Ausgaben stehen '
          + 'NUR dort; die Gerichtsakten bezeugen, DASS sie liefen '
          + '(_COURT-F6-ZAEHLWERK-2026-09-01.md:636-637: "mit beidseitiger + dritter '
          + 'Bruchprobe").',
        richtung1: 'ART_ZUGRIFF wieder entfernen -> Gleichheits-Anker UND Positivtest rot '
          + '(7 Proben, 5 gruen, 2 rot), letzterer am echten Guard mit der Art im Klartext.',
        richtung2: 'Eine vierte Art einfuegen (R15b_NUR_ZAEHLEN: der Verfassung bekannt, '
          + 'aber KEINE Zugriffsart - der KV-4-Fall) -> Gleichheits-Anker rot und "die nicht '
          + 'bestaetigbare Art muss namentlich im Abbruch stehen" rot.',
        richtung3: 'Die VERFASSUNG waechst, das Werkzeug bleibt bei drei -> Anker rot, und '
          + 'zusaetzlich rot die Zusicherung aus PR #187. Das stille Nachhinken faellt an '
          + 'ZWEI Stellen auf. Genau diese Richtung war mit der abgeschriebenen Fassung '
          + 'gruen geblieben - deshalb der Export-PR.',
        ergebnis: 'Alle drei Richtungen restauriert; danach wieder 7/7 bzw. 15/15 gruen.',
      },
      reihenfolge: 'F6-B19 verlangt, dass der PR auf main liegt, BEVOR dieser Eintrag '
        + 'geschrieben wird, und dass der Serverbeweis nicht in dem Commit entsteht, den er '
        + 'beweist. #186 wurde am 2026-08-31 gemergt, dieser Eintrag entsteht am '
        + '2026-09-01; der Serverbeweis folgt als eigener Akt nach diesem Eintrag.',
    },

    // ── B3 — der ZWEITE ZEUGE, woertlich aus Register-Eintrag 23.
    zweiterZeuge: {
      pflicht: 'ANHANG 1, Doku-Pflicht 5: eine unabhaengig geschriebene Prosa-Transkription '
        + 'aus Register-Eintrag 23, zitiert, ausdruecklich als DOKUMENTATIONSPFLICHT, KEIN '
        + 'PRUEFGLIED. In Eintrag 27 fehlte sie vollstaendig.',
      quelle: 'Register-Eintrag 23 (f6-tor-freeze-2026-08-31), eventHash '
        + '5def37b9ff21529761dfcd4f084cd9a61060603529d814167fd937b980cb0675, Feld '
        + 'begruendung (outcome-access-ledger.json:667).',
      zitat: 'S-U p_final 95 (Rate 1,4219 %, 540 reife Firmen) - S-G p_final 95 (1,0564 %, '
        + '546) - S-UG kein p_final (0,0789 %, 30, scheitert an K1, Mindest-Fallzahl 300) '
        + 'auf der Fassung verbreitertOhneBank, ausschliesslich (ENTSCHIED 150).',
      art: 'DOKUMENTATIONSPFLICHT, KEIN PRUEFGLIED. Zweck ist, dass ein spaeterer Leser eine '
        + 'ZWEITE, unabhaengige Aufzeichnung der verbreitertOhneBank-Herkunft findet und '
        + 'nicht nur die Behauptung des Bauenden - genau die Redundanz, die das Gericht nach '
        + 'dem F6-C7a-Praemissenbruch eingezogen hat.',
    },

    // ── B4 — die DREIFACH-BEZEICHNUNG, woertlich nach F6-C7e-b.
    dreifachBezeichnung: {
      skript: 'scripts/studie-e2-verbreitert.py',
      sha256: '9a24ed94e943e9a6f5b4a1373ba6c6aa2001ddadb2d60a705277bf5eb359984b',
      woertlich: 'scripts/studie-e2-verbreitert.py (sha256 9a24ed94e943e9a6f5b4a1373ba6c6aa'
        + '2001ddadb2d60a705277bf5eb359984b) wird in DREI Rollen gefuehrt, die einander NICHT '
        + 'ersetzen: (1) ERZEUGER-BINDUNG des Schwellen-Satz-Artefakts '
        + 'protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json (dort '
        + 'provenienz.erzeugtMit = "scripts/studie-e2-verbreitert.py") - F6-C7e; fuer die '
        + 'KALIBRIER-HAELFTE wird es NICHT aufgerufen, dort entscheiden allein Doppel-Hash '
        + 'und Laufzeit-Konstanten-Abgleich (F6-C7c/d). (2) AUSFUEHRENDES WERKZEUG '
        + 'AUSSCHLIESSLICH DER BEIN-1-LAUF-HAELFTE, unveraendert gefahren ueber '
        + '"durchlauf --modus alt" (F6-C7b), Ausgabe ausschliesslich nach --ergebnis, nie '
        + 'ins Artefakt - NIEMALS der Kalibrier-Haelfte. (3) LAUFZEIT-BINDUNG des Laeufers '
        + 'und zugleich ratifizierter PIN aus Register-Eintrag 23; jede Aenderung bricht '
        + 'beides zugleich (F6-C7f). Die Negativ-Klausel F6-C7e gilt nach ihrem eigenen '
        + 'ersten Satz nur fuer die Kalibrier-Haelfte; ihr verkuerzter Nachsatz "nicht als '
        + 'ausfuehrendes Skript" ist in dieser Reichweite zu lesen. Beide ratifizierten '
        + 'Saetze bleiben damit wahr.',
      ankerNeuGemessen: 'Der Aufruf "durchlauf --modus alt" steht am GEMERGTEN Stand in '
        + 'scripts/studie-f6-zaehlwerk.py:1231 (ANHANG 3 zitiert :965-967 vom Stand VOR '
        + 'PR #215; die Zeilen haben sich verschoben). Die Laufzeit-Bindung des Laeufers '
        + 'steht in scripts/studie-f6-lauf.py:306-309.',
      aktenfehlerEintrag27: 'In Eintrag 27 stand das Skript ROLLENLOS in einer flachen Karte '
        + 'unter einem Fehlertext, der pauschal "die ausfuehrenden Skripte" behauptete; das '
        + 'Wort ERZEUGER kam in der ganzen Datei 0-mal vor. Der von F6-C7e befohlene Satz '
        + '"nicht als ausfuehrendes Skript" war damit AKTIV FALSCH. Das ist der dritte '
        + 'Supersedierungsgrund.',
      drittesEtikett: 'F6-C7e-c(2): die Laeufer-Beschriftung scripts/studie-f6-lauf.py:308 '
        + '("Auslese-Werkzeug (WERKZEUG-Nachweis, ausdruecklich KEINE zweite Regel)") ist '
        + 'ein DRITTES Etikett fuer dasselbe Objekt. Es wird hier ausdruecklich als dritte, '
        + 'GLEICHBEDEUTENDE Fassung ausgewiesen - der von F6-C7e-c(2) zugelassene zweite '
        + 'Weg. Drei Etiketten fuer ein Objekt sind der Weg, auf dem Bezeichnungen driften; '
        + 'deshalb steht die Gleichbedeutung hier und nicht im Code-Kommentar.',
    },

    // ── B5 — die Panel-Bau-Abweichung, WOERTLICH (F6-C22).
    panelBauAbweichung: {
      pflicht: 'F6-C22 (ZAEHLWERK:506): "Die in scripts/studie-panel-bau.py:89-96 SELBST '
        + 'BENANNTE Abweichung von rules.json (Pufferjahre dem frueheren Fenster '
        + 'zugeschlagen) wird WOERTLICH mitbeurkundet." Eintrag 27 zitierte nur :99 (das '
        + 'FENSTER-Tupel) und liess genau den Abweichungsblock weg.',
      fundstelle: 'scripts/studie-panel-bau.py:89-96',
      fundstelleBerichtigt: 'ANHANG 3 und der Reviewer nennen :88-95. Am Objekt gemessen '
        + 'traegt :88 nur das leere Kommentarzeichen, der Text laeuft von :89 bis :96 - der '
        + 'Schlusssatz "deshalb traegt jede Bericht-Zeile ihr accepted-Datum mit." steht in '
        + ':96 und faellt aus der zitierten Spanne. Hier steht die gemessene Spanne.',
      woertlich: 'ABWEICHUNG VON protocol/early-detection/2.0.0/rules.json - hier benannt, '
        + 'nicht stillschweigend: dort sind die Fenster quartalsbasiert und lassen die '
        + 'Pufferjahre 2016 und 2020 frei (2009q1..2015q4 / 2017q1..2019q4 / '
        + '2021q1..2023q4). Die Schnitte hier stammen aus dem E1-Vertrag und schlagen die '
        + 'Pufferjahre dem jeweils FRUEHEREN Fenster zu; 2024 faellt zusaetzlich in den '
        + 'Endtest. Beide Verschiebungen laufen containment-sicher (nichts wandert aus dem '
        + 'Endtest heraus). Wer spaeter strikt nach rules.json rechnet, filtert die '
        + 'Pufferjahre beim Lesen weg - deshalb traegt jede Bericht-Zeile ihr '
        + 'accepted-Datum mit.',
      warumEsZaehlt: 'Die Pufferjahr-2020-Regel dieses Laufs ("ein Erst-Ereignis mit '
        + 'accepted im Pufferjahr 2020 ist ein ABBRUCH, kein Sonderfall") ist die '
        + 'VERRIEGELUNG GEGEN GENAU DIESE Abweichung. Eintrag 27 registrierte die '
        + 'Verriegelung ohne die Abweichung, die sie verriegelt. Seit PR #215 ist die Regel '
        + 'ein benannter Abbruch im Zaehlpfad, kein stiller Filter mehr.',
    },

    // ── B7 — jeder Ausgabepfad mit der Pflicht, die ihn verlangt (F6-B12).
    ausgabesatz: {
      pflicht: 'F6-B12 (VOLLZUG:298), Schlusssatz: "JEDER SCHLUESSEL TRAEGT IM EINTRAG DIE '
        + 'EINGEFRORENE PFLICHT, DIE IHN VERLANGT." Eintrag 27 fuehrte die Schluessel '
        + 'zweimal als nackte Namensliste.',
      anzahl: ALLOWED_OUTPUTS.length,
      zusammensetzung: '30 DATEN-Felder je Variante x Arm + 4 Unterschluessel '
        + 'differenz_punkte + 3 Unterschluessel differenz_punkte.tor = 37.',
      pflichtJeSchluessel: PFLICHT_JE_SCHLUESSEL,
      anker: ANKER,
      zweigPflichtTeilmengen: {
        form: 'F6-C17-Fassung, key-exakt gegen scripts/studie-f6-lauf.py',
        gate_gerissen: 'DATEN_SCHLUESSEL minus {bandbreite_absolut, abstand_zu_329_von_365, '
          + 'etikett}',
        im_band: 'DATEN_SCHLUESSEL minus {etikett}',
        ausserhalb_band: 'DATEN_SCHLUESSEL minus {pflichtsatz, zweitsatz}',
        warnung: 'Die Prosa-Kurzform "alle ausser drei / einem / zwei" ist UNZULAESSIG - sie '
          + 'benennt die Schluessel nicht und ist genau die Ungenauigkeit, die F6-C17 '
          + 'abstellt.',
      },
    },

    // ── ANHANG 3 — Bein 3, sechs Literale, getrennt gezaehlt (F6-C9e).
    bein3Berichtigung: {
      satzBerichtigt: 'BERICHTIGT: Eintrag 27 beurkundete "Bein 3: fuenf Wortlaut-Literale '
        + 'aus preregistration.json (F6-C9)". Das war eine WAHRE ZAHL UEBER EINER FALSCHEN '
        + 'MENGE - die gepruefte Fuenfermenge enthielt ein bauseitiges Zusatz-Literal und '
        + 'NICHT die fuenfte Ziffer des Gerichts. Der Satz wird hier ausdruecklich als '
        + 'berichtigt ausgewiesen, nicht stillschweigend ersetzt.',
      jetzt: 'Bein 3 fuehrt SECHS geprueft Literale, quellengebunden und GETRENNT gezaehlt: '
        + 'VIER Praereg-Literale (preregistration.json :80, :81, :82, :87) + EIN '
        + 'Eintrag-24-Literal (byte-genau aus dem eingefrorenen Wortlaut F6-SE-KLUMPEN/v1, '
        + 'Ziffer 8) = FUENF F6-C9-Ziffern, PLUS EIN bauseitiges Zusatz-Literal '
        + '(reife_definition_anfang), das ausdruecklich als BAUSEITIG ERGAENZT gefuehrt wird '
        + 'und NIE als eine der fuenf Ziffern zaehlt.',
      gemesseneZaehlung: {
        f6c9_praereg: 4, f6c9_eintrag24: 1, f6c9_ziffern_gesamt: 5,
        bauseitig_ergaenzt: 1, gesamt: 6,
      },
      hashGate: 'Jede Quellgruppe wird gegen IHRE EIGENE Quelle geprueft, deren SHA VOR dem '
        + 'Literalvergleich nachgerechnet wird: preregistration.json '
        + '799f925142860b4db97b5f18894b62c749aeb014872279aa6a7df8ee99ac5a6c; '
        + 'f6-se-klumpen-v1-wortlaut.json Datei '
        + '10e812fa345bba545077f333de7d81edf18bb371e9e48ee7b697558c1bc944e8 und Text '
        + WORTLAUT_TEXT_SHA + '. Zusaetzlich wird geprueft, dass Artefakt und '
        + 'Register-Eintrag 24 (vorschriftWortlaut.text) denselben Text fuehren - ein loser '
        + 'Lesezugriff auf die Registerdatei genuegt nicht (F6-C9b).',
      fundstellenBerichtigung: 'AKTEN-/PROSA-BERICHTIGUNG (Form F6-C18): die Kanzler-Prosa '
        + '_COURT-F6-ZAEHLWERK-2026-09-01.md:184 ("woertlich transkribiert aus '
        + 'preregistration.json:80 und :87") ist zu eng gefasst. Gemessen stehen die vier '
        + 'erhebbaren Praereg-Literale in :80, :81, :82 und :87. Das fuenfte Literal stammt '
        + 'aus KEINER Praereg-Fassung.',
      ruege: 'RUEGE (F6-C9g/1): der Ausschluss der fuenften Ziffer wurde im Bau STILL '
        + 'genommen, nach NAMEN, im Inneren des Wachpostens, mit ZAHLERHALTENDER '
        + 'Substitution - "Filter statt ABBRUCH" auf der Pruefflaeche, dieselbe Klasse, die '
        + 'preregistration.json:232 auf der Ausgabeflaeche verbietet. Es war eine '
        + 'METHODIKFRAGE (welche Quelle Ziffer 5 bindet), still vom Bauenden mitentschieden '
        + '- genau das, was F6-C16 seiner Form nach ausschliesst.',
      symmetrie: 'SYMMETRIE, ausdruecklich (F6-C9g/2): die SUBSTANZ war nie ungeschuetzt. '
        + 'Die Regel ist an drei Stellen fail-closed und rot-geprobt. ES FEHLTE DIE '
        + 'BEURKUNDUNG, NICHT DER SCHUTZ. Ein "literal in text"-Test gegen die Praereg '
        + 'haette jeden Lauf abgebrochen; der fail-closed ABBRUCH ist die methodisch '
        + 'STAERKERE Haertung.',
      ankerBerichtigung: 'F6-C9g/3 (Form F6-C18): der Kommentar in scripts/studie-f6-lauf.py '
        + 'zitierte preregistration.json:196 fuer den Satz "Ein nicht gelisteter Schluessel '
        + 'ist ein ABBRUCH, kein Filter." Gemessen steht der Satz in :232; :196 ist die '
        + 'Zeile "ausgabeAllowlist": [. Im selben PR #215 berichtigt.',
      formfrageOffen: 'Ob dies eine Praemissen-Berichtigung von F6-C9 oder eine Klarstellung '
        + 'seiner Reichweite ist, hat ANHANG 3 NICHT ENTSCHIEDEN (OB-1, KZ-22) - die '
        + 'Haertung ist in beiden Lesarten dieselbe und wird vollstaendig vollzogen. Der '
        + 'Wortlaut von F6-C9 bleibt unangetastet.',
      bruchproben: 'Vier Proben protokolliert (F6-C9f), alle gruen im PR #215: (1) ein '
        + 'verstelltes Zeichen im Eintrag-24-Literal -> Bein 3 bricht ab; (2) ein aus der '
        + 'Pruefmenge entfernter Schluessel -> die Mengengleichheit meldet ihn NAMENTLICH '
        + '(der Waechter, der den urspruenglichen stillen Ausschluss gefangen haette); '
        + '(3) ohne den Guard studie-f6-zaehlwerk -> eine Nennereinheit ohne Kennung wird '
        + 'still uebersprungen statt gemeldet; (4) ohne die Kreuzprobe Summe_g n_g == N in '
        + 'studie-f6-klumpen-se -> ein falsches N faellt nicht mehr auf.',
    },

    // ── ANHANG 3 — F6-C13: die Richtungs-Offenlegung, ungeschoent.
    torBerichtigung: {
      befund: 'Der Laeufer emittierte je Variante BEREITS ein zweites armuebergreifendes '
        + 'Objekt "tor", das in KEINEM Register-Eintrag stand und ausschliesslich durch die '
        + 'Literal-Ausnahme - {"tor"} unsichtbar war: die von F6-C15/DZ-4 verworfene '
        + 'Zwei-Schluessel-Form im gebauten Stand, verborgen. "Filter statt ABBRUCH" auf der '
        + 'Registrierungsebene.',
      form: 'F6-C13b: registriert werden DREI Pfade als Unterobjekt des EINEN ratifizierten '
        + 'armuebergreifenden Schluessels: differenz_punkte.tor.verdikt / .weiter / .grund. '
        + 'Damit bleiben F6-B11 ("genau einen") und F6-C15 ("Erweiterung von EINEM auf ZWEI '
        + '... nicht zulaessig") BUCHSTAEBLICH intakt.',
      namensTransparenz: 'ZWINGEND (F6-C13b): unter dem Namen differenz_punkte steht ab '
        + 'jetzt AUCH das komponierte TOR-Verdikt. Dieser Name stammt historisch aus F6-B11 '
        + 'und beschreibt den Inhalt nicht mehr allein. Die Wahl ist ein RUECKFALL BEI '
        + 'STIMMENGLEICHSTAND UND KEINE ENTSCHEIDUNG DES GERICHTS; die Umbenennungsfrage '
        + 'geht als eigene Weiche zurueck (OB-2, KZ-21).',
      richtungsOffenlegung: {
        ausgabeflaeche: 'Gegen den RATIFIZIERTEN Stand +3 registrierte Pfade (34 -> 37) - '
          + 'SIE WAECHST. Gegen den GEBAUTEN Stand -2 Unterfelder (regeltext, richtung) und '
          + 'unregistrierte Schluessel 1 (mit 5 Unterfeldern) -> 0.',
        abbruchBilanz: '+3 (Variantenebene zweiseitig; Unterfeld-Mengengleichheit; '
          + 'pruefe_verbotene auf Variantenebene), -1 (entfernte Ausnahme). KEIN einziger '
          + 'stehender STOPP wird entfernt - die reine F6-C7a-Richtung, anders als F6-C8i.',
        regelUnveraendert: 'Die Zusammensetzung kann WEITER nur ERSCHWEREN, nie ERZEUGEN. '
          + 'Kein tor-Feld traegt eine Groesse, die nicht bereits registriert ist: '
          + 'verdikt/weiter sind eine deterministische Funktion zweier Arm-Verdikte und '
          + 'differenz_punkte.erfuellt; grund interpoliert ausschliesslich differenz["wert"] '
          + 'und MAX_DIFFERENZ_PUNKTE.',
        gegengewicht: 'EHRLICH BENANNT: preregistration.json:232 regelt das EMITTIEREN '
          + 'ungelisteter Schluessel, nicht das REGISTRIEREN weiterer; es wird durch '
          + 'Registrieren erfuellt und durch die bisherige Ausnahme verletzt. Die Wahl steht '
          + 'nicht zwischen Flaeche und keiner Flaeche, sondern zwischen REGISTRIERTER und '
          + 'VERBORGENER Flaeche.',
      },
      regeltextAusgelagert: 'F6-C13c: TOR_REGELTEXT und TOR_RICHTUNG sind eingefrorene '
        + 'Konstanten, keine Messungen. Sie wurden frueher in JEDES tor-Objekt '
        + 'mitgeschrieben und haben die Datenflaeche verlassen. Der Regeltext steht hier: '
        + '"WEITER = 1 nur bei (beide Arm-Bandverdikte BESTANDEN) UND (differenz_punkte <= '
        + '10). Ein Arm NICHT UNTERSCHEIDBAR -> Gesamt NICHT UNTERSCHEIDBAR, WEITER = 0. '
        + 'Ein Arm NICHT BESTANDEN -> Tor gerissen, WEITER = 0. Beide BESTANDEN, aber '
        + 'differenz_punkte > 10 -> Tor gerissen nach preregistration.json:139 '
        + '(INCONCLUSIVE_DATA, kein p-Wert), WEITER = 0. Kein Band, kein SE und kein '
        + 'Ermessen auf der Differenz."',
      waechterDeckung: 'F6-C13e: die in F6-C15 gegebene Begruendung ("pruefe_verbotene laeuft '
        + 'rekursiv ohnehin durch") traf auf der VARIANTENEBENE NICHT zu - die Aufrufe '
        + 'standen nur an den Arm-Werten und am Umschlag, das armuebergreifende Objekt '
        + 'entsteht erst nach der Armschleife und passierte den Wachposten nie. BERICHTIGT '
        + 'WIRD DIE DECKUNGSBEHAUPTUNG, NICHT DIE SCHUTZLAGE: es folgte KEIN Leck, das '
        + 'Objekt fuehrt Gleitkommazahlen, einen Bool und Prosa. Seit PR #215 laeuft der '
        + 'Wachposten auch dort.',
      bruchproben: 'Drei Proben protokolliert (F6-C13f), alle gruen im PR #215: (1) ein '
        + 'unregistrierter Unterschluessel -> ABBRUCH; (2) ein entfernter '
        + 'Pflicht-Unterschluessel -> ABBRUCH, und ein GANZ verschwundenes differenz_punkte '
        + 'faellt ebenfalls auf; (3) Strukturprobe: auf dem Variantenpfad existiert KEINE '
        + 'Ausnahme nach Namen mehr.',
    },

    // ── F6-C24a — DER KZ-20-ABSCHNITT. Sperrend: ohne ihn kein Eintrag.
    kz20Ruecklauf: {
      auflage: 'F6-C24a: KZ-20 ist GEFEUERT. Das Ergebnis des vollstaendigen '
        + 'Quellspalten-Ruecklaufs JEDES Sollwerts der Familie F6-C7/C8/C9 - TREFFER UND '
        + 'NICHT-TREFFER - steht als eigener benannter Abschnitt im Eintrag. Ohne diesen '
        + 'Abschnitt kein Eintrag.',
      nichtTreffer: [
        'Bein-1 torSoll, alle SECHS Zahlen gegen provenienz.aequivalenzTorSoll des '
          + 'gepinnten Schwellen-Satzes: S-U 512/219, S-G 546/265, S-UG 29/12 - KEINE DRIFT.',
        'Bein-1 Kalibrierzahlen, alle ACHT gegen jeFamilie desselben Artefakts '
          + '(1109 -> 540, 68079, 540, 226; 1309 -> 546, 82642, 546, 265) - KEINE DRIFT.',
        'Bein-2, alle VIER Zellen gegen die Spalten fallzahl / nenner_e3 / zensiert_e3: '
          + '543/651/0, 3761/4514/0, 557/647/0, 5000/5768/0 - KEINE DRIFT, und die vier '
          + 'exakten Gleitkomma-Identitaeten halten.',
        'Bein-3: alle sechs Literale stehen woertlich in ihrer je eigenen Quelle.',
        'Alle rund 20 SHA-Bindungen am Objekt nachgerechnet - NULL Abweichungen.',
        'pFinal = 95 und reife_quartale = 4 in beiden Richtungen gegengeprueft.',
      ],
      treffer: [
        '(a) Das fuenfte F6-C9-Literal ist aus der Praeregistrierung NICHT erhebbar; der '
          + 'Bau hat es still nach Namen ausgeschlossen und trotzdem "fuenf" beurkundet.',
        '(b) Ein unregistrierter zweiter armuebergreifender Schluessel, durch eine '
          + 'Literal-Ausnahme verborgen, bei nur einseitig geprueft Variantenebene.',
        '(c) Eine Mehrfachrolle zur Alleinrolle eingeebnet (studie-e2-verbreitert.py '
          + 'rollenlos) - zaehlt nach F6-C7e-a AUSDRUECKLICH NICHT als weitere Divergenz '
          + 'zwischen Text und Wirklichkeit; nur (a) und (b) zaehlen auf KZ-20.',
      ],
      bewertung: 'Die drei Befunde sind FUNDE DIESES RUECKLAUFS, nicht drei aufgelesene '
        + 'Einzelfaelle. Je Fehlerklasse steht ein WURZELFIX statt eines Pflasters: die '
        + 'Ausnahmeliste ist tot, die Zweiseitigkeit gilt auf beiden Ebenen, und die '
        + 'Bindungskarte fuehrt art/rolle. KZ-20 ist damit VOLLZOGEN, NICHT VERBRAUCHT '
        + '(KZ-25 ist ab jetzt scharf: eine fuenfte Text-gegen-Wirklichkeit-Divergenz '
        + 'eskaliert, statt korrigiert zu werden).',
    },

    // ── F6-C24b/c — die Ueberschreibung selbst.
    supersedierung: {
      ueberholterEintrag: {
        runId: UEBERHOLTER_EINTRAG,
        ordinal: 'Eintrag 27',
        eventHash: ERWARTETER_TAIL,
      },
      dreiGruende: [
        '1. WAHRE ZAHL UEBER FALSCHER MENGE BEI BEIN 3: fuenf beurkundet, aber nicht die '
          + 'fuenf Ziffern des Gerichts.',
        '2. EIN UNREGISTRIERTER ZWEITER ARMUEBERGREIFENDER SCHLUESSEL, durch eine '
          + 'Literal-Ausnahme verborgen, bei nur einseitig geprueft Variantenebene.',
        '3. EINE MEHRFACHROLLE ZUR ALLEINROLLE EINGEEBNET (studie-e2-verbreitert.py '
          + 'rollenlos, die Negativ-Klausel dadurch aktiv falsch).',
      ],
      keinGrundUmetikettiert: 'Die drei Gruende stehen im Klartext; keiner ist umetikettiert. '
        + 'Die Zahlenzitierungen und Saetze, die diese Befunde erben, sind hier als GEERBT '
        + 'UND BERICHTIGT ausgewiesen, damit kein spaeterer Leser zwei Fassungen '
        + 'nebeneinander findet.',
      reihenfolge: 'F6-C24b, beide tragenden Gruende: (1) UNTER EINTRAG 27 IST KEIN LAUF '
        + 'GEFEUERT - er sagte selbst "DER LAUF FEUERT NICHT MIT DIESEM EINTRAG: er startet '
        + 'erst nach GRUENEM REVIEW dieses Eintrags-Akts (Bauordnung Schritt 8)", und das '
        + 'Review ging ROT. (2) Die Sperre aus Eintrag 27 (jede nachtraegliche Aenderung an '
        + 'Laeufer, Zaehlwerk oder studie-zaehlprobe.py nach diesem Eintrag, F6-C24(3)) '
        + 'ERLISCHT MIT DER UEBERSCHREIBUNG VON EINTRAG 27 - SIE WIRD NICHT UMGANGEN. Nach '
        + 'diesem Eintrag ist F6-C24(3) unveraendert scharf.',
    },

    // ── Der Rest der Akte, aus Eintrag 27 uebernommen und wo noetig berichtigt.
    aequivalenzTor: {
      bestanden: true,
      laufAm: '2026-09-01T06:19:45.963Z',
      // ── B6 — die drei SHA-Schluessel stehen wieder IN aequivalenzTor (ZAEHLWERK:209,
      // F6-C8h(5): "Das Feld aequivalenzTor BEHAELT SEINE FORM"). In Eintrag 27 fehlten
      // sie hier und standen nur verstreut in eingabenHashes.
      modulSha256: '997a80d26871937f848b3eea76a9b4ba1a4e1c76f1cc3c30db98d7888ec2601d',
      zaehlwerkSha256: 'f47f10d555c701c08e1282aa7e3b41424b836b0851edbdbb80f83839b9f99410',
      zaehlprobeSha256: 'a3fce5a1672e231fe12d7d7ffc8a3655ad8e3ef9b3bd2a2195e1af5fcbdbf17b',
      shaHinweis: 'DIESE DREI SHA BESCHREIBEN DEN STAND, DER DAS TOR GEFAHREN HAT '
        + '(2026-09-01), NICHT den Stand, der den konfirmatorischen Lauf fahren wird. Der '
        + 'zaehlwerkSha256 ist deshalb bewusst der ALTE Wert f47f10d5...; die neuen Werte '
        + 'stehen in eingabenHashes.skripte. Zwei verschiedene Fragen, zwei verschiedene '
        + 'Antworten - das Zusammenziehen waere eine falsche Auskunft.',
      registerEintragDerZaehlprobe: 'f6-aequivalenz-entdeckung-2026-09-01 / 847084648a7f',
      registerEintragDerBerichtigung: 'f6-bein2-berichtigung-2026-09-01 / f9fbaac79675',
      laufHaelfte: {
        werkzeug: 'scripts/studie-e2-verbreitert.py, durchlauf --modus alt',
        soll: { 'S-U': { firmen_reif: 512, firmen_unreif: 219 },
          'S-G': { firmen_reif: 546, firmen_unreif: 265 },
          'S-UG': { firmen_reif: 29, firmen_unreif: 12 } },
        gemessen: { 'S-U': { firmen_reif: 512, firmen_unreif: 219 },
          'S-G': { firmen_reif: 546, firmen_unreif: 265 },
          'S-UG': { firmen_reif: 29, firmen_unreif: 12 } },
      },
      artefaktHaelfte: {
        form: 'NICHT GEFAHREN, SONDERN GEPRUEFT',
        dateiSha256: ARTEFAKTE['protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json'],
        inhaltSha256: INHALT_SHA['protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json'],
        konstantenAbgleichBestanden: true,
        kalibrierZahlen: {
          'S-U': { schritt0_p: 90, schritt0_firmen_reif: 1109, schritt1_p: 95,
            schritt1_firmen_reif: 540, auswertbar_band: 68079, firmenReif: 540,
            firmenUnreif: 226 },
          'S-G': { schritt0_p: 90, schritt0_firmen_reif: 1309, schritt1_p: 95,
            schritt1_firmen_reif: 546, auswertbar_band: 82642, firmenReif: 546,
            firmenUnreif: 265 },
        },
      },
      bein2: {
        spaltenpfad: 'baender["2009-2015"].varianten[<Variante>].<signal|kontrolle>.'
          + '{fallzahl,nenner_e3,zensiert_e3}',
        armAbbildung: 'kontrollpool -> kontrolle',
        zellen: {
          'S-U/signal': { zaehler: 543, nenner: 651, zensiert: 0 },
          'S-U/kontrollpool': { zaehler: 3761, nenner: 4514, zensiert: 0 },
          'S-G/signal': { zaehler: 557, nenner: 647, zensiert: 0 },
          'S-G/kontrollpool': { zaehler: 5000, nenner: 5768, zensiert: 0 },
        },
        basisblind: 'DREI der vier Zellen sind basisblind (e3 == kadenz); nur '
          + 'S-U/kontrollpool trennt die Basen.',
        gegenprobe: 'auffindbarkeit_e3 0.8331856446610545 = 3761/4514 gegen '
          + 'auffindbarkeit_kadenz 0.8331486815865278 = 3760/4513; das Ein-Ereignis-'
          + 'Mechanismus +1/+1/-1 reproduziert exakt. Keine Firmenkennung, kein Datum, '
          + 'keine Prueffenster-Groesse.',
      },
      bein3: {
        form: 'SECHS Literale, quellengebunden, getrennt gezaehlt - siehe '
          + 'bein3Berichtigung. Ohne Panel-Lauf.',
        zaehlung: { f6c9_praereg: 4, f6c9_eintrag24: 1, f6c9_ziffern_gesamt: 5,
          bauseitig_ergaenzt: 1, gesamt: 6 },
      },
    },

    fensterVon: '2017-01-01',
    fensterBis: '2019-12-31',
    panelRand: '2020-12-31',
    panelRandHerkunft: {
      abgeleitet: 'Der Panel-Rand wird zur Laufzeit aus rules.json ABGELEITET, nicht gesetzt '
        + '(F6-C23). scripts/studie-zaehlprobe.py:97 ist NUR Korroboration, nie Quelle.',
      rulesJson: 'rules.json fenster.validierung = {"von": "2017q1", "bis": "2019q4"}; '
        + 'pufferjahre = [2016, 2020] steht auf der WURZEL von rules.json, NICHT unter '
        + 'fenster.',
      pfadTiefeBerichtigt: 'BERICHTIGT gegenueber Eintrag 27: dort las die komma-verbundene '
        + 'Formulierung "rules.json fenster.validierung ... und pufferjahre [2016, 2020]" '
        + 'wie EIN Pfad und legte pufferjahre unter fenster. Am Objekt gemessen liegt '
        + 'pufferjahre auf der Wurzel. Das ist genau die Pfadtiefen-Mehrdeutigkeit, die '
        + 'F6-C8c fuer Bein-2-Sollzahlen verbietet; hier freiwillig nachgezogen.',
      praereg: 'preregistration.json:298 woertlich: "Fuer das Pruefenster heisst das: '
        + 'Signalband 2017-2019, Reife bis 2020-12-31." (Tippfehler "Pruefenster" ist im '
        + 'Original.)',
      schnitt: 'Realisiert in scripts/studie-panel-bau.py:99 - siehe panelBauAbweichung '
        + 'fuer die dort SELBST BENANNTE Abweichung von rules.json.',
    },

    panelDigest: {
      datei: 'panel-validierung.sqlite',
      groesseBytes: 4447633408,
      sha256: '0330f8154608791cf3d56069b8219a67f0ea1084d55fcfb57b09fd1016418c4c',
      werkzeug: 'scripts/studie-panel-digest.py',
      werkzeugSha256: SKRIPTE['scripts/studie-panel-digest.py'].sha,
      verriegelung: 'SEIT PR #215 EIN ECHTER RIEGEL: scripts/studie-f6-zaehlwerk.py prueft '
        + 'die Groesse per os.fstat gegen 4447633408 und bricht VOR dem ersten Panel-Byte '
        + 'ab. In Eintrag 27 war "verriegelt" eine Behauptung ohne Riegel - der Reviewer hat '
        + 'nachgewiesen, dass kein Laufzeit-Pin existierte.',
    },

    arbeitspfad: {
      kurzform: ARBEITSPFAD_KURZ,
      lage: 'unmittelbar im Nutzerverzeichnis des Auftraggebers, AUSSERHALB des Repos',
      gebundenAn: 'ARBEITSPFAD_VORGABE in scripts/studie-f6-zaehlwerk.py, dessen SHA dieser '
        + 'Eintrag bindet.',
      lauf: 'SEIT PR #215 bekommt jeder Lauf ein FRISCHES, LEERES Unterverzeichnis '
        + 'lauf-<runId> darunter; ein nicht leeres Verzeichnis ist ein ABBRUCH, und '
        + 'geloescht wird nie. In Eintrag 27 zeigte die Bindung auf ein VERZEICHNIS, '
        + 'waehrend der Zwischenstand eine DATEI verlangt - der Lauf waere NACH dem '
        + 'Panel-Zugriff mit unterdruecktem Grund gestorben.',
      laufzeitPruefung: 'SEIT PR #215 liest der Laeufer die Bindung aus DIESEM Feld '
        + '(arbeitspfad.gebundenAn) statt aus der Freigabe-Datei, die es nie fuehrte; ein '
        + 'abweichendes --arbeit ist ein ABBRUCH.',
      r12a: 'Der volle Pfad steht NICHT hier: R12a verbietet Nutzerverzeichnisse in einem '
        + '2.0.0-Artefakt, F6-C5 verlangt Benennung vor der Freigabe. Beide Schutzzwecke '
        + 'ueberleben - der Hash der Konstante pinnt den Pfad genauer als ein '
        + 'abgeschriebenes Literal. Vom Orchestrator ratifiziert.',
    },

    differenzRegeltext: {
      quelle: 'preregistration.json:88 woertlich: "gate": {"minimum": 0.9, "gilt": '
        + '"Signal-Arm UND Kontrollpool", "maxDifferenzPunkte": 10}',
      wert: 'abs(anteil_signal - anteil_kontrollpool) * 100.0',
      einheit: 'PUNKTE gegen 10',
      gleichheitBesteht: '<= 10; exakt 10,0 reisst NICHT; keine Rundung',
      keinBandKeinSE: 'Auf der Differenz gibt es kein Band, kein SE und kein Ermessen.',
      entschiedenVom: 'Gericht (F6-C16), nicht still vom Bauenden mitentschieden.',
    },

    restrisiko: {
      'F6-C7g(c)': 'Die eingefrorene Ableitung ist auf UNVERAENDERTHEIT geprueft, nicht auf '
        + 'WAHRHEIT.',
      'F6-C7g(d)': 'Das Entdeckungs-Panel traegt keinen registrierten Byte-Pin.',
      'F6-C7g(e)': 'Die Herkunft von e2-verbreitert ruht auf ihrem eigenen Tor plus Bein 2.',
      'F6-C8j(f)': 'Bein 2 beweist den E4d-Lauf vom 19.08. nicht.',
      'F6-C8j(g)': 'Bein 2 beweist nichts ueber das kadenz-Instrument.',
      'F6-C8j(h)': 'Das Entdeckungs-Panel bleibt ungepinnt.',
      'F6-C11(a)': 'Der Tally hat keinen Vorgaenger, gegen den er sich vergleichen liesse.',
      'F6-C11(b)': 'Prueffenster-Datenformen sind nicht durch Entdeckungsdaten ersetzbar.',
      'ANHANG-3(OB-1)': 'Die KORREKTURFORM von Befund (a) ist OHNE BESCHLUSS (KZ-22).',
      'ANHANG-3(OB-2)': 'Die SCHLUESSELFORM von Befund (b) ist OHNE BESCHLUSS (KZ-21); '
        + 'registriert ist der nicht-schwaechende Rueckfall.',
    },

    vorabDeterminiertheit: 'F6-B25: die Zweig-Pflichtteilmengen, der Differenz-Regeltext und '
      + 'das Tor-Verdikt sind VOR dem Lauf festgelegt und stehen in diesem Eintrag. Nichts '
      + 'davon wird nach dem Lauf gewaehlt. KV-6 ist benannt: der Eintrag beschreibt die '
      + 'REGEL, nie den erwarteten Ausgang.',
    erwartungsblock: 'REFERENZIERT, NICHT NEU GERECHNET: '
      + 'protocol/early-detection/2.1.0/f6-vollzug-zweig-a-2026-08-31.json, inhaltSha256 '
      + '792f4ff58687945167e273d08ca509544f4ad7fd7ecd9eaa60d5dac3118c99f7. Kein Satz dieses '
      + 'Eintrags sagt etwas ueber die Richtung der kuenftigen Messung.',
    gliedCWiedervorlage: 'ANHANG-1 Doku-Pflicht 8: NICHT BESCHLOSSEN und deshalb nicht '
      + 'vollzogen sind A1s Glied c und die Aufnahme des Bericht-SHA 6ecf3ef2... in die '
      + 'Bindungsliste - SAMT WIEDERVORLAGE: die Frage geht mit diesem Eintrag erneut an '
      + 'den Orchestrator und ist mit dem Delta-Review wiederaufzurufen. In Eintrag 27 fehlte '
      + 'der Wiedervorlage-Zeiger.',

    researchCorpus: 'NICHT ANWENDBAR - beantwortet, nicht weggelassen (F6-B2). Dieser Lauf '
      + 'liest keine Forschungs-Korpora, sondern genau eine Panel-Datei des angemeldeten '
      + 'Prueffensters.',
    protocolManifestSha256: m.manifest,
    analysisCutoffAt: {
      form: 'JAHRGANGS-IDENTITAET, KEIN ZEITSTEMPEL (F6-C21).',
      jahrgang: 'legacy_earliest_archived',
      artefakt: 'protocol/early-detection/2.1.0/jahrgang-registrierung-2026-08-30.json',
      inhaltSha256: INHALT_SHA['protocol/early-detection/2.1.0/jahrgang-registrierung-2026-08-30.json'],
      registerEintrag: 'Eintrag 22',
      panelDatei: 'panel-validierung.sqlite',
      panelBytes: 4447633408,
      hinweis: 'Kein registriertes Artefakt fuehrt einen analysisCutoffAt-WERT.',
    },
    actor: 'Karl Viehrig (Auftraggeber, Freigabe-Inhaber) - ausgefuehrt durch den '
      + 'Nacht-Agenten der Session 07 unter dem Review-Tor des Orchestrators.',
    scope: 'EIN Fenster (pruefung), EIN Tor, AUSDRUECKLICH NICHT die acht Tests.',
    purpose: 'Der EINE konfirmatorische F6-Lauf unter Kontingent EINS (K2/A10).',

    laufFreigabe: 'DER LAUF FEUERT NICHT MIT DIESEM EINTRAG. Er startet erst nach dem '
      + 'GRUENEN DELTA-REVIEW, das der Orchestrator mit frischen Augen ansetzt und das jeden '
      + 'der elf Blocker sowie die gemeldeten Findings gegen den ENDSTAND prueft. Ein rotes '
      + 'oder unvollstaendiges Delta-Review heisst: kein Lauf. Nach diesem Eintrag ist '
      + 'F6-C24(3) unveraendert scharf - jede Aenderung an Laeufer, Zaehlwerk oder '
      + 'studie-zaehlprobe.py nach diesem Eintrag bricht die Bindung.',
  };
}

function haupt(argv) {
  if (argv.includes('--force')) {
    throw new VerfassungsBruch('F6-E28: --force gibt es nicht (F6-B8). Ein Register-Akt, '
      + 'der eine Schranke ueberreden kann, ist keine Schranke.');
  }
  const schreiben = argv.includes('--schreiben');
  const wurzel = argument(argv, 'wurzel') || WURZEL;
  const registerPfad = argument(argv, 'register') || LEDGER;

  const jetzt = new Date();
  const registeredAt = argument(argv, 'anmeldezeit') || jetzt.toISOString();
  if (new Date(registeredAt).getTime() > Date.now() + 60000) {
    throw new VerfassungsBruch('F6-E28: die Anmeldezeit liegt in der Zukunft.');
  }
  const wirksamAb = argument(argv, 'wirksam-ab')
    || new Date(new Date(registeredAt).getTime() + VORLAUF_MINUTEN * 60000).toISOString();
  if (!(new Date(registeredAt) < new Date(wirksamAb))) {
    throw new VerfassungsBruch('F6-E28: wirksam-ab muss NACH der Anmeldung liegen (VB-A11).');
  }

  const m = pruefeAlles(wurzel);

  const register = lies(registerPfad);
  const events = register.events || [];
  if (events.length !== ERWARTETE_EVENTS) {
    throw new VerfassungsBruch(
      `F6-E28: das Register fuehrt ${events.length} Eintraege, erwartet ${ERWARTETE_EVENTS}.`);
  }
  const letzter = events[events.length - 1];
  if (letzter.runId !== ERWARTETER_LETZTER_RUNID || letzter.eventHash !== ERWARTETER_TAIL) {
    throw new VerfassungsBruch(
      `F6-E28: das Kettenende ist ${letzter.runId} / ${letzter.eventHash}, erwartet `
      + `${ERWARTETER_LETZTER_RUNID} / ${ERWARTETER_TAIL}.`);
  }
  if (events.some((e) => e.runId === RUN_ID)) {
    throw new VerfassungsBruch(`F6-E28: die runId ${RUN_ID} ist bereits belegt.`);
  }

  const eintrag = baueEintrag(registeredAt, wirksamAb, m);
  pruefeKeinNutzerpfad(eintrag);
  const neu = haengeEintragAn(register, eintrag);
  pruefeZugriffsRegister(neu);
  const fertig = neu.events[neu.events.length - 1];

  process.stdout.write(
    'Akt           EINTRAG 28 - DER UEBERSCHREIBENDE KONFIRMATORISCHE AKT\n'
    + `runId         ${RUN_ID}\n`
    + `typ           ${ART_ZUGRIFF}\n`
    + `ueberschreibt ${UEBERHOLTER_EINTRAG} (Eintrag 27)\n`
    + `allowedOutputs ${ALLOWED_OUTPUTS.length} Pfade (30 + 4 + 3)\n`
    + `Skripte       ${Object.keys(SKRIPTE).length} gebunden, je mit art und rolle\n`
    + `Artefakte     ${Object.keys(ARTEFAKTE).length} gebunden (+${Object.keys(INHALT_SHA).length} inhaltSha256)\n`
    + `Bericht       ${m.bericht.dateiSha256}\n`
    + `Kettenende vor dem Eintrag: ${ERWARTETER_LETZTER_RUNID} / ${ERWARTETER_TAIL}\n`
    + `PRUEFZEILE: "previousHash": "${fertig.previousHash}"\n`
    + `eventHash dieses Eintrags: ${fertig.eventHash}\n`
    + `Eintraege nach dem Anhaengen: ${neu.events.length}\n\n`);

  if (!schreiben) {
    if (argv.includes('--zeige-eintrag')) {
      process.stdout.write(`EINTRAG:${JSON.stringify(fertig)}\n`);
    }
    process.stdout.write('TROCKENLAUF - es wurde NICHTS geschrieben.\n');
    return 0;
  }
  writeFileAtomic(registerPfad, `${JSON.stringify(neu, null, 1)}\n`);
  process.stdout.write(`GESCHRIEBEN: ${registerPfad}\n`);
  return 0;
}

if (require.main === module) {
  try {
    process.exit(haupt(process.argv.slice(2)));
  } catch (fehler) {
    process.stderr.write(`${fehler.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  SKRIPTE, ARTEFAKTE, INHALT_SHA, INHALT_MODUS, ALLOWED_OUTPUTS, DATEN_SCHLUESSEL,
  PFLICHT_JE_SCHLUESSEL, ANKER, RUN_ID, ERWARTETER_TAIL, pruefeKeinNutzerpfad,
  pruefeAlles, baueEintrag, haupt, WURZEL, LEDGER,
};
