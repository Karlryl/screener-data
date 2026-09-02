#!/usr/bin/env node
'use strict';

// Studie 2.0, F6-K17 Schritt 6 — DER UEBERSCHREIBENDE KONFIRMATORISCHE AKT v4.
//
// WARUM ER EXISTIERT: der Akt v3 war IM MOMENT SEINER REGISTRIERUNG NICHT
// AUSFUEHRBAR. Phase 0 des von ihm gebundenen Laeufers braucht den Akt aus der
// Fortsetzung, Phase 1 rehasht Freeze-Eintraege aus der geschlossenen Datei -
// und der Laeufer kannte genau EINEN Registerpfad. KEIN Wert von --register
// haette den Lauf starten koennen. Gefunden wurde das durch die von der
// Bauordnung selbst befohlene Vorpruefung (K17-8) mit ausgefuehrten
// Fixture-Sonden, NICHT durch einen Lauf.
//
// Der Hausmechanismus ist die UEBERSCHREIBUNG, nicht die Auslegung (F6-K11,
// KONTINGENT:393/646: "Ein Ein-Zeilen-Fix bricht die Bindung so vollstaendig
// wie ein Umbau"). Die Reparatur (PR #253) hat den Laeufer angefasst; v3
// bindet damit andere Bytes als die, die laufen werden.
//
// ER LIEGT IN DER FORTSETZUNG, als Eintrag 3: count-only-Akt (1), v3 (2).
//
// LR-2: DER AKT WIRD AUSGESCHRIEBEN, NIE VERZEIGERT. Deshalb komponiert dieses
// Werkzeug ihn aus v3 - der seinerseits Rumpf, Schicht und Vorfall bereits
// AUSGESCHRIEBEN traegt. Eine Hash-Referenz statt des Abdrucks stellte genau
// die Fehlklasse wieder her, an der Eintrag 27 gestorben ist.
//
// LRA-12 / LFA2-11: JEDER gebundene SHA wird im Moment des Akts gegen einen
// sauberen Baum gemessen. Kein Wert wird abgeschrieben - auch kein Wert aus
// einer Commit-Nachricht (siehe C24A_KORREKTUR unten).
//
// Eigenes Einzweck-Werkzeug nach F6-B8; die geprueften Helfer kommen aus dem
// v3-Werkzeug, statt sie ein zweites Mal zu tippen (LR-14).
//
//   node scripts/studie-f6-konfirmatorisch-v4.js                 # Trockenlauf
//   node scripts/studie-f6-konfirmatorisch-v4.js --zeige-eintrag # + Eintrag als JSON
//   node scripts/studie-f6-konfirmatorisch-v4.js --schreiben     # anhaengen

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { writeFileAtomic } = require('../lib/atomic-write.js');
const {
  VerfassungsBruch, haengeEintragAn, pruefeZugriffsRegister, ART_ZUGRIFF,
  REGISTER_RELS, AKTIVES_REGISTER_REL, istGeschlossen,
} = require('../lib/studie-verfassung.js');
const { pruefeR12a } = require('./studie-f6-vorfall.js');
const V3 = require('./studie-f6-konfirmatorisch-v3.js');

const WURZEL = path.join(__dirname, '..');
const absolut = (rel) => path.join(WURZEL, ...rel.split('/'));
const ZIEL_REL = AKTIVES_REGISTER_REL;

const RUN_ID = 'f6-konfirmatorisch-v4-2026-09-02';
const DECKEL_BYTES = V3.DECKEL_BYTES;
const VORLAUF_MINUTEN = V3.VORLAUF_MINUTEN;

// Die EINE Quelle: v3, adressiert nach DATEI + eventHash (LR-21). Er liegt in
// der FORTSETZUNG - nicht in der geschlossenen Datei wie v3s eigene Quellen.
const RUMPF = {
  datei: ZIEL_REL,
  runId: V3.RUN_ID,
  eventHash: '78a46b0369cec5d993a93c5ef74427b45a812ce79fc9a85490a54a776e781d9e',
};

// Die Fortsetzung fuehrt vor diesem Akt GENAU ZWEI Eintraege.
const ERWARTETE_EVENTS = 2;

// Der Stand der Fortsetzung VOR diesem Akt - am Objekt gemessen, nie getippt
// (LFA2-11). Er geht als Ausgangswert der LR-19-Arithmetik in den Akt.
const FORTSETZUNG_VORHER = fs.statSync(path.join(
  __dirname, '..', ...ZIEL_REL.split('/'))).size;

const LAEUFER_REL = 'scripts/studie-f6-lauf.py';
const AUSGENOMMEN = new Set(['runId', 'typ', 'registeredAt', 'accessedAt',
  'previousHash', 'eventHash']);

const dsha = (rel) => crypto.createHash('sha256')
  .update(fs.readFileSync(absolut(rel))).digest('hex');

const argument = (argv, n) => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) throw new VerfassungsBruch(`F6-K11: --${n} ohne Wert.`);
  return v;
};

// ── F6-C24a: DIE DREI DRIFT-DATEIEN ALS EIGENER BENANNTER WECHSEL ──────────
//
// Sie duerfen mitfahren, aber NICHT UNBENANNT (F6-C24c: "Grund umetikettiert").
// vorher = Stand auf main 3961ed8ace; nachher = Stand des Draft-Commits
// 3d0073abe9 im Reparatur-PR.
//
// ALLE WERTE HIER SIND BYTE-EXAKT NACHGEMESSEN, nicht aus der Commit-Nachricht
// uebernommen - siehe C24A_KORREKTUR.
const C24A_DRIFT = [
  {
    pfad: LAEUFER_REL,
    vorher: '5c0f685ec61e437d420814db72ce4f2aaedf919415bb5484e64ff44633ad1681',
    nachher: '945ee6f5d52350be9169915d6fb65694d5888b67dc347feac2345c762124500b',
    art: 'datei',
    rolle: 'ausfuehrend - der konfirmatorische Laeufer',
    was: 'HIGH-2: pruefe_arbeit_beschreibbar(), gerufen in Phase 2a VOR der '
      + 'Zaehlschleife. Die Arbeitsdatei entsteht in studie-f6-zaehlwerk.py '
      + 'erst HINTER der Paneloeffnung; ein nicht beschreibbares '
      + 'Arbeitsverzeichnis toetete den Lauf also NACH dem Panel - genau die '
      + 'Klasse, die den einen autorisierten Lauf gekostet hat. Dazu MEDIUM-1: '
      + 'ZaehlwerkAbbruch geht durch schruppe_text wie BasisratenFehler, und '
      + 'die Kommentar-Berichtigung, die zwei Waechter-Klassen entflechtet '
      + '(Firmen-Kennungen nach F6-B14 gegen Pfade nach R12a).',
  },
  {
    pfad: 'tests/studie-f6-lauf.test.js',
    vorher: '23eef2ac2b3e85d832c9b7ac0d5fd9e58150555222fd97354042eb5027b21e79',
    nachher: '8b1bd659fbbcfc9b7b78d37dba6ecc3764c35763174d9cefc944d7bd8bf74b7f',
    art: 'datei',
    rolle: 'waechter',
    was: 'Die vier Proben zu HIGH-2 und MEDIUM-1: Schreibprobe rot, '
      + 'Schreibprobe gruen ohne Rueckstand, Protokoll-Ehrlichkeit '
      + '(ENTFAELLT), und e2e ein ZaehlwerkAbbruch mit Kontopfad, der den '
      + 'Lauf geschruppt verlaesst.',
  },
  {
    pfad: 'tests/studie-f6-konfirmatorisch-v3.test.js',
    vorher: 'a79a780cfe7076154afd6e84ea44df2c02fc8de1409783294cd6ad2ade431fec',
    nachher: '77aa64824b8328dd0ab6f9fbc54cd5c3112ef92a42318fb36630e43acfd0b717',
    art: 'datei',
    rolle: 'waechter',
    was: 'MEDIUM-2 (LIVE-BINDUNG iteriert skripte UND artefakte, 21 statt 12 '
      + 'Pfade), die Ketten-Bindung als reine Funktion ohne runId, und die '
      + 'datierte UEBERGANGS_BRUECKE samt selbstaufhebender Probe.',
  },
];

const C24A_KORREKTUR = 'BERICHTIGUNG EINER MESSUNG, nicht einer Tatsache: die '
  + 'Commit-Nachricht von 3d0073abe9 fuehrt fuer die BEIDEN TESTDATEIEN falsche '
  + 'vorher-Werte (a8348072... und 27194a19...). Sie stammen aus einer '
  + 'PowerShell-Umleitung, die den git-Ausgabestrom als UTF-16 neu kodierte - '
  + 'gemessen: 120.684 B statt der echten 59.098 B derselben Datei. Der dort '
  + 'genannte Laeufer-Wert 5c0f685e... ist RICHTIG, weil er nachtraeglich '
  + 'byte-exakt nachgemessen wurde. Die hier gefuehrten Werte sind alle '
  + 'byte-exakt (git show | sha256sum). Die Nachricht des Commits ist '
  + 'unveraenderlich; DIESER Akt ist der massgebliche Nachweis (LFA2-11: kein '
  + 'Anker wird ungeprueft uebernommen).';

// ── Die Reparatur selbst: der Wechsel, den DIESER Akt bindet ──────────────
const REPARATUR_PR = 'PR #253 (gemergt als 2f809246e4)';

function baueEintrag(registeredAt, zugriffAb, v3, wand) {
  const eintrag = {
    runId: RUN_ID,
    typ: ART_ZUGRIFF,
    registeredAt,
    accessedAt: zugriffAb,
  };
  // LR-2: ALLES aus v3, ausgeschrieben. v3 traegt Rumpf, Eintrag-29-Schicht
  // und Vorfall bereits selbst - eine Referenz statt des Abdrucks waere der
  // Rueckfall in die Fehlklasse von Eintrag 27.
  for (const [k, v] of Object.entries(v3)) {
    if (!AUSGENOMMEN.has(k)) eintrag[k] = JSON.parse(JSON.stringify(v));
  }

  // ── LRA-12: ALLE Bindungen frisch am Objekt gemessen ────────────────────
  const drift = [];
  const messe = (karte) => {
    for (const [rel, wert] of Object.entries(karte)) {
      const ist = dsha(rel);
      if (wert.dateiSha256 !== ist) drift.push({ rel, vorher: wert.dateiSha256, nachher: ist });
      wert.dateiSha256 = ist;
    }
  };
  messe(eintrag.eingabenHashes.skripte);
  messe(eintrag.eingabenHashes.artefakte);
  const ab = eintrag.eingabenHashes.aequivalenzBericht;
  if (ab) ab.dateiSha256 = dsha(ab.pfad);

  // ── F6-C24a: die Drift-Bytes als EIGENER benannter Wechsel ─────────────
  const vn = eintrag.eingabenHashes.vorherNachher;
  vn[LAEUFER_REL] = {
    vorher: RUMPF_LAEUFER(v3),
    nachher: eintrag.eingabenHashes.skripte[LAEUFER_REL].dateiSha256,
    durch: `Die Reparatur-Familie aus _COURT-F6-LAUFFAEHIGKEIT-2026-09-02 und `
      + `ihrem ANHANG 1, ${REPARATUR_PR}: Q1 (SE-Fang an den drei `
      + `Sterbestellen unter sieben konjunktiven Merkmalen), Q2 `
      + `(Ketten-Aufloesung in beiden Phasen), LF-3/4/7/8/12..17, die `
      + `Fix-Welle des Fokus-Reviews und die LF-K7-Neumessung `
      + `(Weisslisten-Inversion von Merkmal f, Byte-Riegel, LF-3 als `
      + `Gleichheitsprobe).`,
  };
  vn.f6c24aDriftBytes = {
    auflage: 'F6-C24a/F6-C24c: die vor dem Reparatur-PR bereits im Arbeitsbaum '
      + 'liegenden Bytes bekommen einen EIGENEN BENANNTEN WECHSEL mit '
      + 'vorher/nachher-SHA, art, rolle und PR-Nummer. Sie duerfen mitfahren; '
      + 'sie duerfen NICHT UNBENANNT mitfahren - das waere genau der "Grund '
      + 'umetikettiert", den F6-C24c verbietet.',
    prNummer: REPARATUR_PR,
    commit: '3d0073abe9 - als erster Commit des PR bewusst von der Reparatur '
      + 'getrennt gehalten, damit der Wechsel benennbar bleibt.',
    dateien: C24A_DRIFT,
    korrektur: C24A_KORREKTUR,
  };
  vn.hinweis = `${vn.hinweis} DIESER AKT: alle Werte sind erneut im Moment des `
    + 'Akts gegen einen sauberen Baum gemessen (LRA-12/LFA2-11); die '
    + 'Drift-Bytes der Vorsitzung sind unter f6c24aDriftBytes benannt.';

  // ── LF-20: DIE EHRLICHKEITSPFLICHT UEBER v3, zehn Punkte ────────────────
  eintrag.supersedierungVonV3 = {
    ueberholterEintrag: { datei: RUMPF.datei, runId: RUMPF.runId, eventHash: RUMPF.eventHash },
    adressierungshinweis: 'LR-21: nach DATEI und eventHash adressiert. Der '
      + 'ueberholte Akt liegt in DERSELBEN Datei wie dieser - der erste Fall '
      + 'dieser Art; eine Ordnungszahl waere hier doppelt mehrdeutig.',

    dreiGruende: {
      eins: 'v3 WURDE UNAUSFUEHRBAR REGISTRIERT. Kein Euphemismus: Phase 0 des '
        + 'von v3 gebundenen Laeufers verlangt den Akt, Phase 1 die '
        + 'Freeze-Eintraege f6-tor-freeze-2026-08-31 und '
        + 'f6-se-klumpen-freeze-2026-08-31. Nach der R14a-Naht liegen sie '
        + 'nachweislich NICHT in derselben Registerdatei. KEIN WERT VON '
        + '--register HAETTE DEN LAUF STARTEN KOENNEN.',
      zwei: 'Bein 1, ohne --register, gefahren: "F6-LAUF-ABBRUCH: runId '
        + '\'f6-konfirmatorisch-v3-2026-09-02\' steht 0-mal im '
        + 'Zugriffs-Register. Genau einmal ist richtig."',
      drei: 'Bein 2, mit --register auf die Fortsetzung, gefahren: '
        + '"F6-LAUF-ABBRUCH: Die Bindung fuer '
        + 'protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json '
        + 'beruft sich auf den Register-Eintrag \'f6-tor-freeze-2026-08-31\', '
        + 'den es nicht gibt."',
      beideBeineReproduziert: 'Beide Abbruchtexte sind im Reparatur-PR als '
        + 'Bruchprobe BP-L9 rot-vor-gruen protokolliert und werden dort '
        + 'dauerhaft gefahren.',
    },

    wieGefunden: 'DURCH VORPRUEFUNG MIT AUSGEFUEHRTEN FIXTURE-SONDEN, NICHT '
      + 'DURCH EINEN LAUF. Die Bauordnung befiehlt diese Vorpruefung selbst '
      + '(K17-8); dass sie den Defekt gefunden hat, ist das Funktionieren des '
      + 'Systems, nicht sein Scheitern.',

    todesklasseUeberlebte: 'DIE TODESKLASSE DES ERSTEN ANLAUFS HATTE DIE '
      + 'v3-REPARATUR UEBERLEBT: ein Datenausgang, der NACH dem Panel als '
      + 'Abbruch endet. Der Laeufer zitierte die Anordnung des Gerichts in '
      + 'seinem eigenen Abbruchtext ("Folge ohne Ermessen: BandNichtAuswertbar '
      + '-> ... WEITER = 0") und vollzog sie dann nicht. Q1 dieses Zuges '
      + 'vollzieht sie - an DREI Sterbestellen, nicht an einer; die zweite '
      + '(uebersetze) und dritte (differenz_objekt) waeren sonst zur Laufzeit '
      + 'unter dem Ein-Mal-Deckel aufgetaucht.',

    f6k22Form: {
      panelByte: 'Unter v3 wurde KEIN PANEL-BYTE gelesen.',
      bandverdikt: 'Es fiel KEIN BANDVERDIKT.',
      nichtUnterscheidbar: '"NICHT UNTERSCHEIDBAR" WURDE NICHT GEMESSEN.',
      b4Pflichtsatz: 'Der b4-Pflichtsatz ist hier VERBOTEN und steht deshalb '
        + 'nicht in diesem Akt.',
      friedhof: 'Es gibt KEINEN FRIEDHOFSEINTRAG.',
      siegel: 'Das Endtest-Siegel bleibt ZU und UNVERBRAUCHT (F6-A16/K27); nur '
        + 'Karls ausdrueckliche Freigabe oeffnet es.',
    },

    einMalDeckel: {
      behauptung: 'AUSDRUECKLICH BEHAUPTET, damit kein spaeterer Leser sie '
        + 'erschliessen muss: der Versuchszaehler nach F6-K19 steht bei EINS '
        + 'verbraucht (der abgebrochene Lauf unter Eintrag 28). DER ZWEITE UND '
        + 'LETZTE VERSUCH STEHT UNVERBRAUCHT ZUR VERFUEGUNG.',
      grund: 'LF-K5, vom Orchestrator entschieden: DER ZAEHLER ZAEHLT '
        + 'GEFEUERTE LAEUFE, NICHT REGISTRIERTE AKTE. v3 hat nie gefeuert und '
        + 'kein Panel-Byte beruehrt (2:0 festgestellte Tatsache).',
      lesartGehoertNichtDemBauer: 'Die Lesart dieser Zaehlung gehoert dem '
        + 'Orchestrator bzw. dem Gericht, NIE dem Bauenden (LF-K5). Sollte ein '
        + 'kuenftiges Gericht sie anders lesen, gilt die strengere Lesart ab '
        + 'dann - nie rueckwirkend.',
    },

    blindAttestErneuerung: 'BLIND-ATTEST (F6-K5), erneuert fuer ALLE an dieser '
      + 'Vorpruefung Mitwirkenden: KEINERLEI Information aus dem abgebrochenen '
      + 'Lauf ist verwendet worden. Der versiegelte zwischenstand.sqlite ist '
      + 'ungeoeffnet, unbewegt und sein Verzeichnis unbetreten geblieben '
      + '(F6-K1). Gefahren wurden AUSSCHLIESSLICH Fixture- und '
      + 'Nicht-Panel-Sonden.',

    c24Wiederscharf: 'F6-C24(3) ERLISCHT MIT DIESER UEBERSCHREIBUNG UND IST '
      + 'DANACH WIEDER SCHARF: jede Aenderung an Laeufer, Zaehlwerk, '
      + 'Zaehlprobe oder Aufrufer NACH diesem Eintrag bricht die Bindung '
      + 'erneut. Der Hausmechanismus ist die UEBERSCHREIBUNG, nicht die '
      + 'Auslegung (KONTINGENT:393/646: "Ein Ein-Zeilen-Fix bricht die Bindung '
      + 'so vollstaendig wie ein Umbau").',

    metaTatsache: 'OHNE UMETIKETTIERUNG (F6-C24c), die unbequeme Meta-Tatsache: '
      + 'MIT DIESEM AKT SIND NUN ZWEI AKTE HINTEREINANDER VOR EINEM GRUENEN '
      + 'SCHRITT-8-REVIEW UEBERSCHRIEBEN WORDEN (28 -> v3, v3 -> v4). Wer '
      + 'daraus ein eingespieltes Muster liest, liest falsch; wer die Haeufung '
      + 'nicht bemerkt, auch.',

    wasV3Bleibt: 'v3 bleibt gueltige Akte darueber, WAS am 2026-09-02 '
      + 'registriert wurde. Er wird nicht editiert und nicht entwertet; er '
      + 'wird ersetzt, soweit er kuenftiges Handeln autorisiert - und er hat '
      + 'nie etwas autorisiert, weil er nicht ausfuehrbar war.',
  };

  // ── LF-8: der benannte Restposten (v4-Punkt 9) ─────────────────────────
  eintrag.restpostenLF8 = {
    auflage: 'LF-8: die dritte Sterbestelle ist die EINZIGE Stelle ohne '
      + 'ratifizierten Text und wird deshalb NAMENTLICH beurkundet, nicht '
      + 'stillschweigend gebaut.',
    stelle: 'differenz_objekt in scripts/studie-f6-lauf.py',
    frage: 'Was ist differenz_punkte, wenn ein Arm keinen Anteil hat, weil '
      + 'seine Zelle das Ersatzverdikt traegt?',
    gewaehlteForm: 'wert = null, erfuellt = null - NIE true, NIE false. Die '
      + 'Schluesselmenge bleibt unveraendert (wert, maxDifferenzPunkte, '
      + 'erfuellt, quelle, tor).',
    warumSicher: 'NUR deshalb sicher, weil tor_verdikt bei "NICHT '
      + 'UNTERSCHEIDBAR" KURZSCHLIESST, BEVOR erfuellt gelesen wird - "die '
      + 'Bandfolge DOMINIERT". Faellt dieser Kurzschluss je weg, ist diese '
      + 'Form neu zu pruefen.',
    engGefasst: 'AUSDRUECKLICH ENG: nur null - der ausgewiesene Ausgang der '
      + 'Ersatz-Zelle - nimmt diesen Weg. NaN, Infinity und jeder Nicht-Float '
      + 'bleiben der unveraenderte Abbruch. Eine Weitung auf "alles '
      + 'Nicht-Endliche" haette eine BESTEHENDE Schranke geschwaecht, und das '
      + 'waere keine Reparatur (F6-K26).',
  };

  // ── LF-K7: die Neumessung und ihr Ergebnis (LFA2-1, LFA2-14) ───────────
  eintrag.lfK7Neumessung = {
    ausloeser: 'LF-K7 verlangt eine Neumessung, sobald eine weitere '
      + 'aufrufer-seitige, markertragende Ursache gefunden wird. Das Review '
      + 'hat eine gefunden: eine formal gueltige, aber typfalsche Temp-Tafel '
      + 'erzeugt eine Markerzeile und waere unter der ersten Fassung von '
      + 'Merkmal f in ein Verdikt gewaschen worden.',
    umfang: 'ZWEI unabhaengige Stimmen, beide gegen das hash-verifizierte '
      + 'eingefrorene Modul, zusammen 25 + 22 gefahrene Faelle ueber die '
      + 'eingefrorene CLI. Der ERSTE Zweig von LF-K7 ist NICHT ausgeloest '
      + '(14 raise-Stellen, alle mit Marker); der ZWEITE ist ausgeloest und '
      + 'beantwortet.',
    ergebnis: 'DER FANG WIRD NICHT ZURUECKGENOMMEN. Die Ruecknahme-Alternative '
      + 'von LF-K7 IST VERBRAUCHT, NICHT DIE AUFLAGE - sie lebt wieder auf, '
      + 'wenn eine weitere aufrufer-seitige, markertragende Ursache gefunden '
      + 'wird, die von der beschlossenen Schliessform nicht erfasst ist '
      + '(LF-K10).',
    schliessform: 'Merkmal f ist POLARITAETS-INVERTIERT: statt EINE Rinne zu '
      + 'verneinen, laesst eine positive WEISSLISTE der zehn geregelten '
      + 'Ziffer-8-Praefixe passieren; alles andere ist Abbruch. Geprueft '
      + 'ausschliesslich auf der ersten stderr-Zeile. SIEBEN MERKMALE BLEIBEN '
      + 'SIEBEN, a-g behalten ihre Nummern, kein achtes Merkmal.',
    reviewerFormWiderlegt: 'Die im Trigger vorgeschlagene Schliessform ("jede '
      + 'Markerzeile ablehnen, die die Klumpen-Datei nennt") ist WIDERLEGT, '
      + 'nicht verworfen: sie ist unterinklusiv. "Klumpen-Datei" steht nur an '
      + 'zwei Stellen des Moduls; die Eintrags-Formklasse an :255 benennt '
      + 'keine Datei, und die im Trigger selbst genannte Nutzlast '
      + '[[1,1,1],[0,1]] bliebe damit offen. Der Grund steht hier, damit kein '
      + 'spaeterer Leser sie als gleichwertige Alternative wieder aufnimmt.',
    ankerNeumessung: 'LFA2-11, und sie hat sich sofort bewaehrt: der Ratstext '
      + 'fuehrt den Praefix "die Residuenquadratsumme ist nicht endlich". Im '
      + 'Quelltext des Moduls BRICHT DIE ZEILE nach "nicht " (:326/:327); als '
      + 'Ganzes uebernommen haette der Praefix den Praesenz-Anker AM '
      + 'UNVERAENDERTEN MODUL sofort rot gefaerbt. Aufgenommen ist die '
      + 'gemessene, zusammenhaengende Form. Die uebrigen neun stehen '
      + 'zusammenhaengend - jeder einzeln gegen den Quelltext geprueft, samt '
      + 'Marker davor. KEIN ANKER DIESER SITZUNG IST UNGEPRUEFT UEBERNOMMEN '
      + 'WORDEN.',
    byteRiegel: 'LFA2-7: sha256 der Tally-Bytes nach os.fsync gemerkt, nach '
      + 'dem Kind-Prozess und VOR dem Fang neu gehasht; Abweichung oder '
      + 'Nichtlesbarkeit ist Abbruch mit benanntem Grund, nie Verdikt. Als '
      + 'KLEMPNEREI-RIEGEL der LF-3-Familie gebaut, ausdruecklich NICHT als '
      + 'achtes Merkmal (OB-L1-Rueckfall). Er wird gebraucht, weil die '
      + 'Weissliste liest, was das Kind SAGT - sie kann nicht sehen, ob es '
      + 'ueberhaupt noch unsere Tafel gelesen hat.',
    gleichheitsprobe: 'LFA2-8: LF-3 ist eine GLEICHHEITSPROBE, niemals eine '
      + 'Strukturpruefung. Die Tafel wird einmal gebunden, geschrieben, '
      + 'gefsynct, zurueckgelesen und mit != gegen dasselbe Objekt gehalten. '
      + 'Eine Liste-von-Paaren-Pruefung im Laeufer waere die Zweitkopie der '
      + 'Formregel des eingefrorenen Moduls (LR-14-Klasse) und ist verboten; '
      + 'ein Waechter prueft ihre Abwesenheit ausdruecklich mit. '
      + 'ROLLENTEILUNG: die Gleichheitsprobe deckt das Fenster VOR dem '
      + 'Kind-open, der Byte-Riegel das Fenster DANACH. KEINE ERSETZT DIE '
      + 'ANDERE.',
    obL1: {
      frage: 'Welche FORM traegt der Byte-Riegel - achtes konjunktives '
        + 'Merkmal h, oder Klempnerei-Riegel der LF-3-Familie?',
      stand: 'OHNE BESCHLUSS. Beide Positionen werden konserviert: Stimme K '
        + 'haelt ein achtes Merkmal fuer eine Neunummerierung der '
        + 'Unterscheidungsregel und lehnt es ab; Stimme W nennt es "das '
        + 'tragende Glied" und will es in der Regel selbst.',
      folge: 'Der Kanzler-Rueckfall gilt: gebaut als Klempnerei-Riegel VOR dem '
        + 'Fang, damit LF-2 und die Sieben-Merkmal-Klausel buchstabengetreu '
        + 'bleiben. Die SUBSTANZ des Riegels ist 2:0 beschlossen; nur seine '
        + 'Form war offen. Kipp-bewehrt: LF-K9.',
    },
  };

  // ── LFA2-9: die Restluecken, ausgewiesen statt wegdokumentiert ─────────
  eintrag.restlueckenLFA2_9 = {
    auflage: 'LFA2-9: die Restluecken werden im Akt AUSGEWIESEN, nicht '
      + 'wegdokumentiert. Eine Luecke, die niemand aufschreibt, wird spaeter '
      + 'als Zusicherung gelesen.',
    eins: 'Eine Ersetzung der Temp-Tafel durch eine FORMAL GUELTIGE Tafel mit '
      + 'falschen Summen ist am Draht von einer echten Ziffer-8-Klasse NICHT '
      + 'UNTERSCHEIDBAR und bleibt VERDIKT. Sie ist durch KEINE '
      + 'Markerzeilen-Regel schliessbar.',
    zwei: 'Der Byte-Riegel schliesst einen Tausch NICHT, der die Original-Bytes '
      + 'vor dem Nach-Hash wiederherstellt (TOCTOU). Das ist seine '
      + 'dokumentierte Decke, kein Grund gegen ihn.',
    drei: 'DAS BEDROHUNGSMODELL, getrennt benannt: die drei REALEN Fehlermodi '
      + '(voller Datentraeger, Virenscanner-Quarantaene, Temp-Aufraeumer) '
      + 'erzeugen ausschliesslich "nicht lesbar" oder eine fehlende Datei - '
      + 'beide schon von der Weissliste erfasst. Die neue Rinne ist nur unter '
      + 'einem ERSETZUNGS-Modell erreichbar. DIE DRINGLICHKEIT IST DIE EINES '
      + 'RIEGELS, NICHT DIE EINES BRANDES.',
    imCode: 'Alle drei Saetze stehen zusaetzlich als Kommentar an der Stelle '
      + 'im Laeufer, an der sie gelten - nicht nur hier.',
  };

  // ── LFA2-12 / LFA2-13: protokolliert, NICHT gebaut ─────────────────────
  eintrag.nurProtokolliert = {
    auflage: 'LFA2-12 und LFA2-13: beurkundet und getrennt behandelt. Kein '
      + 'Byte dieses Zuges hat sie angefasst.',
    dokuDrift: {
      fundstelle: 'scripts/studie-f6-klumpen-se.py:239-240',
      befund: 'Der Kommentar behauptet, der Fall sei "ueber den Funktionsaufruf '
        + 'erreichbar - und die Funktion ist der Eintrittspunkt, den der '
        + 'F6-Laeufer benutzt". Gemessen ist das FALSCH: der Laeufer ruft das '
        + 'Modul ueber seine CLI.',
      folge: 'NICHT STILL GEFIXT. Das Modul ist der FUENFTE PIN und '
        + 'hash-gebunden; jede Textaenderung dort ist ein FREEZE-AKT, kein '
        + 'Bauer-Fix. NULL BYTES an der Datei (LF-18 unveraendert).',
    },
    intNebenbefund: {
      befund: 'Der Laeufer zwingt jeden Klumpen durch int(...); ein Zaehlwerk, '
        + 'das 1.5 oder true liefert, wird dort STILL GEKUERZT. Die '
        + 'Ziffer-8-Klassen b und c erreichen den Draht damit NIE in ihrer '
        + 'echten Gestalt.',
      folge: 'KEIN WASCH-SCHADEN - beide Wege enden im Verdikt. Aber die '
        + 'Behauptung "acht Klassen fahren ueber den Draht" IST FALSCH: ES '
        + 'SIND SECHS. Das steht hier als benannter Satz und geht NICHT in '
        + 'diesen Bau (LF-K14).',
    },
  };

  // ── LF-1 / LF-20 Punkt 10: der Baumzustand, beide Messebenen ───────────
  eintrag.baumzustandLF1 = {
    auflage: 'LF-1: der Stand wird BENANNT, nicht angenommen - beide '
      + 'Messebenen, mit vorher/nachher-SHA.',
    commitEbene: {
      vorDerReparatur: '3961ed8ace6595a7e3956ac42c465789ef5f7d99',
      nachDerReparatur: '2f809246e48fbf76bdabc8ced3185b4feaec6f22',
      laeuferVorher: '5c0f685ec61e437d420814db72ce4f2aaedf919415bb5484e64ff44633ad1681',
      laeuferNachher: dsha(LAEUFER_REL),
    },
    arbeitsbaumEbene: {
      befund: 'Zum Zeitpunkt der Ratsmessung trug der Arbeitsbaum drei nicht '
        + 'committete Dateien - die Drift der Vorsitzung. Der Rat sah den '
        + 'Laeufer deshalb als a42096d7..., der Commit-Stand fuehrte '
        + '5c0f685e... KEIN WIDERSPRUCH: zwei Messebenen.',
      aufloesung: 'Die Drift ist als eigener erster Commit des Reparatur-PR '
        + 'benannt worden (siehe eingabenHashes.vorherNachher.f6c24aDriftBytes) '
        + 'und liegt heute auf main. Der Arbeitsbaum ist bei der Komposition '
        + 'dieses Akts sauber.',
    },
    ankerGehalten: 'Der in Eintrag 28 und in v3 beurkundete Zeilen-Anker '
      + '"scripts/studie-f6-lauf.py :415-447 (ZWEIG_PFLICHT-Zuweisung :452)" '
      + 'IST GEHALTEN WORDEN, obwohl die Reparatur den Laeufer um mehrere '
      + 'hundert Zeilen erweitert hat: alle neuen Modul-Bytes stehen '
      + 'UNTERHALB des Ankers, und :92-93 wurde zwei-gegen-zwei getauscht. '
      + 'Zeilen 1-460 sind gegenueber dem Stand vor der Reparatur byte-gleich '
      + 'bis auf diesen Tausch. Eine beurkundete Messung ist nicht '
      + 'nachzuziehen, wenn sie sich halten laesst.',
  };

  // ── LR-19: DIE WAND, gemessen und beurkundet ───────────────────────────
  eintrag.wandLR19 = {
    auflage: 'LR-19: die Wand-Arithmetik wird am FERTIGEN Entwurf gemessen, '
      + 'bevor geschrieben wird - nicht geschaetzt und nicht nachtraeglich.',
    deckelBytes: DECKEL_BYTES,
    vorherBytes: FORTSETZUNG_VORHER,
    vorherEreignisse: ERWARTETE_EVENTS,

    // DIE ZAHLEN SIND EIN FIXPUNKT und stehen trotzdem hier: das Werkzeug
    // baut den Akt so lange neu, bis die eingesetzten Werte genau die sind,
    // die der fertige Akt erzeugt, und bricht ab, wenn das nicht konvergiert.
    // Sie sind damit WAHR DURCH KONSTRUKTION, nicht behauptet - und der
    // Endwert bleibt zusaetzlich trivial nachmessbar: er IST die Groesse der
    // Datei, in der dieser Satz steht.
    nachherBytes: wand.danach,
    zuwachsBytes: wand.zuwachs,
    restluftBytes: wand.restluft,
    messform: 'FIXPUNKT-MESSUNG: der Akt ist iterativ gebaut worden, bis die '
      + 'hier eingesetzten Zahlen mit den vom fertigen Akt erzeugten Zahlen '
      + 'zusammenfallen. Weicht eine ab, schreibt das Werkzeug nicht.',

    berichtigungDerPlanung: 'BERICHTIGUNG EINER PLANUNGSGROESSE, auf dem Papier '
      + 'statt im Kopf: die Uebergabe dieser Familie fuehrte "v4 in v3-Groesse '
      + '(62.504 B) -> Restluft ~67.859 B, reicht fuer GENAU EINEN weiteren '
      + `Akt dieser Groesse". GEMESSEN sind es ${wand.zuwachs} B Zuwachs und `
      + `${wand.restluft} B Restluft. Die Folge kehrt sich um: es passt NULL `
      + 'weiterer Akt DIESER Groesse. Der Satz der Uebergabe ist damit hiermit '
      + 'berichtigt und nicht absorbiert.',
    grundDesZuwachses: 'Der Mehrbedarf ist STRUKTURELL, nicht Wildwuchs: die 49 '
      + 'geerbten Felder stehen nach LR-2 ausgeschrieben statt verzeigert, und '
      + 'jeder neue Abschnitt ist angeordnet (LF-20 mit zehn Punkten, F6-C24a, '
      + 'LF-8, LFA2-9, LFA2-12/13, LFA2-14 samt LF-K7-Block und OB-L1, LF-1). '
      + 'Kuerzen hiesse wegdokumentieren - genau das, was LFA2-9 verbietet.',

    reichweiteDerNullreserve: 'DIE ERSCHOEPFTE RESERVE GILT NUR FUER EINEN '
      + 'WEITEREN VOLLEN UEBERSCHREIBUNGS-AKT DIESER GROESSE. Fuer einen '
      + 'solchen existiert INNERHALB DIESER FAMILIE KEIN RECHTMAESSIGES '
      + 'SZENARIO MEHR:',
    zweiFolgen: {
      abbruch: 'Endet der Lauf in einem Abbruch welcher Art auch immer, beendet '
        + 'F6-K19 die Studienfamilie - dann gibt es kein v5 zu schreiben.',
      erfolg: 'Laeuft er durch, entstehen ERGEBNIS-Eintraege, die um eine '
        + 'Groessenordnung kleiner sind als ein Supersedierungs-Akt; die '
        + `gemessenen ${wand.restluft} B Restluft tragen sie bequem.`,
    },
    verhaeltnisZuLR18: 'Jeder Akt jenseits dieser beiden Faelle WAR BEREITS '
      + 'eine Gerichtsfrage nach LR-18 (kein Routine-Rollover). Die '
      + 'Nullreserve macht denselben Sachverhalt PHYSISCH statt prozedural - '
      + 'sie fuegt keine neue Sperre hinzu, sie nimmt der bestehenden nur die '
      + 'Ausweichmoeglichkeit. Wer nach diesem Akt Platz braucht, braucht ein '
      + 'Gericht, nicht einen Trick.',
    ohneEuphemismus: 'Klartext: nach diesem Eintrag ist die Fortsetzungsdatei '
      + 'zu rund drei Vierteln voll, und der Weg "noch einmal alles neu '
      + 'beurkunden" steht nicht mehr offen. Das ist eine Verengung, und sie '
      + 'wird hier als Verengung benannt, nicht als Reserve umettikettiert.',
  };

  // ── Weggefallenes, mechanisch geprueft (Dokumentationspflicht 4) ───────
  const sollFelder = Object.keys(v3).filter((k) => !AUSGENOMMEN.has(k));
  const verloren = sollFelder.filter((k) => !(k in eintrag));
  eintrag.weggefallenes = {
    ...eintrag.weggefallenes,
    eigenePruefungV4: {
      verfahren: 'Mechanisch: jedes Feld von v3 (ohne Umschlag-/Kettenfelder) '
        + 'wird gegen die Feldmenge dieses Akts gehalten. Kein Auge, ein '
        + 'Vergleich.',
      gepruefteFelder: sollFelder.length,
      treffer: verloren,
      nichtTreffer: `${sollFelder.length - verloren.length} von ${sollFelder.length} `
        + 'Feldern nachweislich getragen.',
    },
  };
  V3.pruefeWeggefallenes(sollFelder, eintrag);

  eintrag.laufFreigabe = 'DER LAUF FEUERT NICHT MIT DIESEM EINTRAG. Er startet '
    + 'erst nach dem Serverbeweis, dem gruenen Fokus-Delta nach F6-K17/K18 und '
    + 'auf das AUSDRUECKLICHE, GETRENNTE Signal des Orchestrators. Nach F6-K19 '
    + 'ist dieser Anlauf DER LETZTE: ein weiterer Abbruch welcher Art auch '
    + 'immer beendet die Studienfamilie. Nach diesem Eintrag ist F6-C24(3) '
    + 'unveraendert scharf.';
  eintrag.blindAttest = 'BLIND-ATTEST (F6-K5): der Ausfuehrende haelt '
    + 'KEINERLEI Information aus dem abgebrochenen Lauf. Der versiegelte '
    + 'Zwischenstand ist ungeoeffnet, unbewegt und sein Verzeichnis unbetreten '
    + 'geblieben (F6-K1). Gefahren wurden ausschliesslich Fixture- und '
    + 'Nicht-Panel-Sonden.';
  eintrag.fortsetzungsHinweis = 'DRITTER Eintrag der Fortsetzungsdatei: '
    + 'count-only-Akt (1), v3 (2), dieser Akt (3). Die erste Registerdatei ist '
    + 'mit ihrem Abschluss-Akt geschlossen; die Kette laeuft ueber '
    + 'genesisSha256 = Tail-Event-Hash jener Datei ungebrochen weiter - und '
    + 'der Laeufer loest sie seit dieser Reparatur SELBST ueber beide Dateien '
    + 'auf, statt eine davon zu erraten.';

  return { eintrag, drift };
}

// Der Laeufer-SHA, den v3 gebunden hat - aus v3 gelesen, nicht getippt.
function RUMPF_LAEUFER(v3) {
  return v3.eingabenHashes.skripte[LAEUFER_REL].dateiSha256;
}

function haupt(argv) {
  if (argv.includes('--force')) {
    throw new VerfassungsBruch('F6-K11: --force gibt es nicht (F6-B8).');
  }
  const schreiben = argv.includes('--schreiben');
  const registerPfad = argument(argv, 'register') || absolut(ZIEL_REL);

  const registeredAt = argument(argv, 'anmeldezeit') || new Date().toISOString();
  if (new Date(registeredAt).getTime() > Date.now() + 60000) {
    throw new VerfassungsBruch('F6-K11: die Anmeldezeit liegt in der Zukunft.');
  }
  const zugriffAb = argument(argv, 'zugriff-ab')
    || new Date(new Date(registeredAt).getTime() + VORLAUF_MINUTEN * 60000).toISOString();
  if (!(new Date(registeredAt) < new Date(zugriffAb))) {
    throw new VerfassungsBruch('F6-K11: zugriff-ab muss NACH der Anmeldung liegen (VB-A11).');
  }

  const rohBytes = fs.readFileSync(registerPfad);
  const register = JSON.parse(rohBytes.toString('utf8'));
  if (istGeschlossen(register)) {
    throw new VerfassungsBruch(
      `F6-K11: ${registerPfad} ist mit ihrem Abschluss-Akt geschlossen.`);
  }
  const events = register.events || [];
  if (events.length !== ERWARTETE_EVENTS) {
    throw new VerfassungsBruch(
      `F6-K11: die Fortsetzung fuehrt ${events.length} Eintraege, erwartet ${ERWARTETE_EVENTS}. `
      + 'Dieser Akt ist ihr DRITTER.');
  }
  if (events.some((e) => e.runId === RUN_ID)) {
    throw new VerfassungsBruch(`F6-K11: die runId ${RUN_ID} ist bereits belegt.`);
  }

  // Die Quelle liegt in DERSELBEN Datei - gelesen wird der Stand, der gerade
  // gemessen wurde, nicht ein zweites Mal von der Platte.
  const v3 = V3.quellAkt(RUMPF, register);

  // ── FIXPUNKT: die LR-19-Zahlen stehen IM Akt und werden von ihm erzeugt ──
  // Naiv eingesetzt waeren sie sofort falsch: jede Ziffer, die dazukommt,
  // aendert die Groesse, die sie beschreibt. Also wird gebaut, gemessen,
  // eingesetzt und neu gebaut, bis beide zusammenfallen. Ohne Konvergenz wird
  // NICHT geschrieben - eine Zahl, die sich selbst widerspricht, ist genau die
  // Klasse von Beurkundung, an der diese Familie schon einmal gestorben ist.
  let wand = { danach: 0, zuwachs: 0, restluft: 0 };
  let eintrag; let drift; let neu; let serialisiert; let bytesNachher;
  let runden = 0;
  for (; runden < 6; runden += 1) {
    ({ eintrag, drift } = baueEintrag(registeredAt, zugriffAb, v3, wand));
    neu = haengeEintragAn(register, eintrag);
    serialisiert = `${JSON.stringify(neu, null, 1)}\n`;
    bytesNachher = Buffer.byteLength(serialisiert, 'utf8');
    const gemessen = {
      danach: bytesNachher,
      zuwachs: bytesNachher - rohBytes.length,
      restluft: DECKEL_BYTES - bytesNachher,
    };
    if (gemessen.danach === wand.danach) break;
    wand = gemessen;
  }
  if (bytesNachher !== wand.danach) {
    throw new VerfassungsBruch(
      `F6-K11: die LR-19-Zahlen konvergieren nicht (${runden} Runden, zuletzt `
      + `${wand.danach} gegen ${bytesNachher}). Es wird NICHT geschrieben.`);
  }
  pruefeR12a(eintrag);
  pruefeZugriffsRegister(neu);
  const fertig = neu.events[neu.events.length - 1];

  process.stdout.write(
    'Akt            DER UEBERSCHREIBENDE KONFIRMATORISCHE AKT v4 (F6-K11 / K17 Schritt 6)\n'
    + `runId          ${RUN_ID}\n`
    + `typ            ${ART_ZUGRIFF}\n`
    + `Ziel           ${ZIEL_REL} (Eintrag ${events.length + 1})\n`
    + `Quelle         ${RUMPF.runId} / ${RUMPF.eventHash.slice(0, 16)}... (DIESELBE Datei)\n`
    + `registeredAt   ${registeredAt}\n`
    + `accessedAt     ${zugriffAb}  (+${VORLAUF_MINUTEN} min, Fussboden fuer den Lauf)\n`
    + `Felder         ${Object.keys(fertig).length}\n`
    + `SHA-Drift      ${drift.length} gegen die Bindung von v3\n`
    + `${drift.map((d) => `   - ${d.rel}\n     vorher  ${d.vorher}\n     nachher ${d.nachher}`).join('\n')}\n`
    + `Weggefallenes  ${eintrag.weggefallenes.eigenePruefungV4.gepruefteFelder} Felder geprueft, `
    + `${eintrag.weggefallenes.eigenePruefungV4.treffer.length} Treffer\n`
    + `PRUEFZEILE: "previousHash": "${fertig.previousHash}"\n`
    + `eventHash dieses Akts: ${fertig.eventHash}\n`
    + '\n=== LR-19 WAND-ARITHMETIK, am fertigen Entwurf gemessen ===\n'
    + `Akt-Groesse         ${Buffer.byteLength(JSON.stringify(fertig), 'utf8')} B kompakt\n`
    + `Fortsetzung vorher  ${rohBytes.length} B, ${events.length} Ereignisse\n`
    + `Fortsetzung danach  ${bytesNachher} B von ${DECKEL_BYTES} B (R14a)\n`
    + `Zuwachs             ${bytesNachher - rohBytes.length} B\n`
    + `Restluft            ${DECKEL_BYTES - bytesNachher} B\n`
    + `Passt noch          ${Math.floor((DECKEL_BYTES - bytesNachher)
        / (bytesNachher - rohBytes.length))} weiterer Akt dieser Groesse\n\n`);

  pruefeDeckelV4(bytesNachher);

  if (!schreiben) {
    if (argv.includes('--zeige-eintrag')) {
      process.stdout.write(`EINTRAG:${JSON.stringify(fertig)}\n`);
    }
    process.stdout.write('TROCKENLAUF - es wurde NICHTS geschrieben.\n');
    return 0;
  }
  writeFileAtomic(registerPfad, serialisiert);
  process.stdout.write(`GESCHRIEBEN: ${registerPfad}\n`);
  return 0;
}

// Eigener Deckel-Ruf, damit die Fehlermeldung diesen Akt benennt.
function pruefeDeckelV4(bytesNachher) {
  if (bytesNachher >= DECKEL_BYTES) {
    throw new VerfassungsBruch(
      `F6-K11: die Fortsetzung waere nach diesem Akt ${bytesNachher} B und erreichte damit den `
      + `R14a-Deckel von ${DECKEL_BYTES} B. Es wird NICHT geschrieben (LR-20).`);
  }
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
  RUN_ID, RUMPF, ZIEL_REL, DECKEL_BYTES, ERWARTETE_EVENTS, VORLAUF_MINUTEN,
  C24A_DRIFT, C24A_KORREKTUR, baueEintrag, pruefeDeckelV4, haupt, WURZEL,
};
