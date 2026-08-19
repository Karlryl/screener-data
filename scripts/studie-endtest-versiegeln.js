'use strict';

// R2 macht die Fenster-Mauer zu einer Eigenschaft der BYTES.
//
// Die Endtest-Datei (panel-endtest.sqlite) darf genau einmal, ganz am Ende, geoeffnet
// werden. Eine Filter-Regel im selben Programm ist dafuer nur ein Versprechen — der
// Hauptrisikofaktor ist ein Agent, der versehentlich hineinliest. Verschluesselte
// Bytes sind kein Versprechen: ohne Schluessel steht dort Rauschen.
//
// AES-256-GCM, node-Standardbibliothek, kein Fremd-Paket (R14c deckelt Installationen).
// GCM statt CBC/CTR, weil der Authentifizierungs-Tag jede Manipulation und jeden
// Bitkipper beweisbar macht, statt still etwas Falsches zu entschluesseln.
//
// BEWUSST KEIN OEFFNER: der Rueckentschluesselungs-Code hier laeuft nur im
// Arbeitsspeicher und dient der Verifikation. Er schreibt nie Klartext auf die Platte.
// Ein eigenstaendiges Entschluesselungs-Werkzeug im Repo waere eine Einladung; es
// entsteht erst beim protokollierten Oeffnen.
//
// Reihenfolge ist Sicherheit: erst verschluesseln, dann verifizieren, DANN loeschen.
// Schlaegt die Verifikation fehl, bleibt der Klartext liegen und der Lauf endet rot.
//
//   node scripts/studie-endtest-versiegeln.js               # scharf versiegeln
//   node scripts/studie-endtest-versiegeln.js --nur-pruefen # Siegel spaeter nachpruefen
//
// Der Speicherort kommt aus EARLY_DETECTION_DATA_ROOT (R12a), nie aus dem Code.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { datenwurzel } = require('../lib/studie-verfassung');

const ALGO = 'aes-256-gcm';
const SCHLUESSEL_BYTES = 32;
const IV_BYTES = 12;                      // GCM-Standardlaenge
const KLARTEXT_NAME = 'panel-endtest.sqlite';
const SIEGEL_NAME = KLARTEXT_NAME + '.enc';
const SCHLUESSEL_TEIL = ['schluessel', 'endtest.key'];
const SIDECAR_TEIL = ['protocol', 'early-detection', '2.0.0', 'endtest-versiegelung.json'];
const SCHEMA = 'early-detection-endtest-versiegelung/v1';

class SiegelFehler extends Error {}

// -- Bausteine -----------------------------------------------------------------

// Ein Strom, ein Hash, kein Puffer: die Datei ist mehrere GB gross und darf nie am
// Stueck in den Speicher.
function hashStrom(strom) {
  return new Promise((aufloesen, ablehnen) => {
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    strom.on('error', ablehnen);
    strom.on('data', (stueck) => { bytes += stueck.length; hash.update(stueck); });
    strom.on('end', () => aufloesen({ sha256: hash.digest('hex'), bytes }));
  });
}

const dateiHash = (pfad) => hashStrom(fs.createReadStream(pfad));

// Rueckentschluesselung NUR in den Arbeitsspeicher: der Klartext wandert stueckweise
// in den Hash und wird sofort verworfen. Es entsteht keine temporaere Klartext-Kopie.
function entschluesseltHashen(siegelPfad, schluessel, iv, authTag) {
  return new Promise((aufloesen, ablehnen) => {
    const quelle = fs.createReadStream(siegelPfad);
    const decipher = crypto.createDecipheriv(ALGO, schluessel, iv);
    decipher.setAuthTag(authTag);
    quelle.on('error', ablehnen);
    hashStrom(decipher).then(aufloesen, ablehnen);
    quelle.pipe(decipher);
  });
}

// Ein GCM-Fehlschlag kommt als roher Krypto-Satz ("unable to authenticate data").
// Hier steht stattdessen, was passiert ist.
function alsSiegelFehler(fehler, was) {
  const roh = String((fehler && fehler.message) || fehler);
  if (/authenticate|auth tag|Unsupported state/i.test(roh)) {
    return new SiegelFehler(
      was + ': der Authentifizierungs-Tag passt nicht. Entweder wurde die Siegel-Datei '
      + 'veraendert (ein einzelnes gekipptes Byte reicht) oder es ist der falsche '
      + 'Schluessel. Es wurde kein Klartext erzeugt.',
    );
  }
  return new SiegelFehler(was + ': ' + roh);
}

function leseSchluessel(pfad) {
  let roh;
  try {
    roh = fs.readFileSync(pfad, 'utf8').trim();
  } catch (fehler) {
    throw new SiegelFehler('Schluessel nicht lesbar (' + pfad + '): ' + fehler.message);
  }
  if (!/^[0-9a-f]{64}$/i.test(roh)) {
    throw new SiegelFehler('Die Schluessel-Datei enthaelt keine 64 Hex-Zeichen: ' + pfad);
  }
  return Buffer.from(roh, 'hex');
}

const bufHash = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function schreibeSidecar(pfad, inhalt) {
  fs.mkdirSync(path.dirname(pfad), { recursive: true });
  fs.writeFileSync(pfad, JSON.stringify(inhalt, null, 2) + '\n');
}

// -- Versiegeln ----------------------------------------------------------------

async function versiegele({ klartextPfad, siegelPfad, schluesselPfad, sidecarPfad, log = console.log }) {
  if (!fs.existsSync(klartextPfad)) {
    throw new SiegelFehler('Keine Endtest-Datei gefunden: ' + klartextPfad);
  }
  if (fs.existsSync(siegelPfad)) {
    throw new SiegelFehler(
      'Hier liegt schon eine Siegel-Datei: ' + siegelPfad
      + ' — ein zweiter Lauf wuerde sie ueberschreiben. Erst pruefen, was das ist.',
    );
  }
  if (fs.existsSync(schluesselPfad)) {
    throw new SiegelFehler(
      'Hier liegt schon ein Schluessel: ' + schluesselPfad
      + ' — ihn zu ueberschreiben wuerde eine bereits versiegelte Datei fuer immer '
      + 'unoeffenbar machen. Abbruch, bevor irgendetwas geschrieben wird.',
    );
  }

  // Schluessel zuerst: wenn die Ablage klemmt, soll das VOR der langen Verschluesselung
  // auffliegen, nicht danach. Modus 0600 = nur der Besitzer darf lesen.
  const schluessel = crypto.randomBytes(SCHLUESSEL_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  fs.mkdirSync(path.dirname(schluesselPfad), { recursive: true });
  fs.writeFileSync(schluesselPfad, schluessel.toString('hex') + '\n', { flag: 'wx', mode: 0o600 });
  log('Schluessel abgelegt: ' + schluesselPfad + ' (Fingerabdruck ' + bufHash(schluessel).slice(0, 16) + '...)');

  log('1/4  Klartext messen ...');
  const klartext = await dateiHash(klartextPfad);
  log('     ' + klartext.bytes + ' Bytes, sha256 ' + klartext.sha256);

  log('2/4  Verschluesseln (' + ALGO + ') ...');
  const cipher = crypto.createCipheriv(ALGO, schluessel, iv);
  await pipeline(
    fs.createReadStream(klartextPfad),
    cipher,
    fs.createWriteStream(siegelPfad, { flags: 'wx' }),   // wx: nie ein bestehendes Siegel ueberschreiben
  );
  const authTag = cipher.getAuthTag();

  log('3/4  Siegel messen ...');
  const siegel = await dateiHash(siegelPfad);

  log('4/4  Rueckentschluesselung im Arbeitsspeicher gegenpruefen ...');
  let probe;
  try {
    probe = await entschluesseltHashen(siegelPfad, schluessel, iv, authTag);
  } catch (fehler) {
    throw alsSiegelFehler(fehler, 'Verifikation fehlgeschlagen — der Klartext bleibt liegen');
  }
  if (probe.sha256 !== klartext.sha256 || probe.bytes !== klartext.bytes) {
    throw new SiegelFehler(
      'Verifikation fehlgeschlagen: das Entschluesselte ist nicht der Klartext ('
      + probe.bytes + ' Bytes / ' + probe.sha256 + ' statt ' + klartext.bytes + ' / '
      + klartext.sha256 + '). Der Klartext bleibt liegen, nichts wird geloescht.',
    );
  }

  const sidecar = {
    schema: SCHEMA,
    protokoll: 'FEM-SEC-US@2.0.0',
    regel: 'R2 — Drei Zeitfenster, physisch getrennt',
    algorithmus: ALGO,
    versiegeltAm: new Date().toISOString(),
    klartextDatei: path.basename(klartextPfad),
    siegelDatei: path.basename(siegelPfad),
    schluesselAblage: '<EARLY_DETECTION_DATA_ROOT>/' + SCHLUESSEL_TEIL.join('/'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    sha256Klartext: klartext.sha256,
    sha256Siegel: siegel.sha256,
    sha256Schluessel: bufHash(schluessel),
    bytesKlartext: klartext.bytes,
    bytesSiegel: siegel.bytes,
    klartextGeloescht: false,
    hinweis:
      'Der Schluessel steht hier bewusst NICHT. sha256Schluessel ist der Fingerabdruck '
      + 'seiner 32 Rohbytes — damit beweist die spaetere Oeffnung, dass der vorgelegte '
      + 'Schluessel derselbe ist, mit dem versiegelt wurde. Verifiziert wurde durch '
      + 'Rueckentschluesselung im Arbeitsspeicher; es lag zu keiner Zeit eine zweite '
      + 'Klartext-Kopie auf der Platte.',
  };
  schreibeSidecar(sidecarPfad, sidecar);

  // Erst jetzt. Der Klartext ist ein reproduzierbares Zwischenprodukt (deterministisch
  // aus den 127 versiegelten Payloads neu baubar), keine Evidenz — Loesch-Freigabe
  // Karl, 18.08.2026. Das Sidecar wird zweimal geschrieben, damit ein Absturz zwischen
  // Loeschung und Protokoll nie ein Siegel ohne iv/authTag hinterlaesst.
  fs.unlinkSync(klartextPfad);
  sidecar.klartextGeloescht = true;
  schreibeSidecar(sidecarPfad, sidecar);
  log('Klartext geloescht: ' + klartextPfad);
  log('Sidecar: ' + sidecarPfad);
  log('\nVersiegelt. Ohne ' + path.basename(schluesselPfad) + ' ist die Endtest-Datei Rauschen.');
  return sidecar;
}

// -- Nachpruefen ---------------------------------------------------------------
// Kein Oeffner: liest das Siegel, entschluesselt in den Arbeitsspeicher, vergleicht
// Pruefsummen — und gibt nie ein Byte Inhalt aus.

async function pruefe({ siegelPfad, schluesselPfad, sidecarPfad, log = console.log }) {
  const sidecar = JSON.parse(fs.readFileSync(sidecarPfad, 'utf8'));
  if (sidecar.schema !== SCHEMA) throw new SiegelFehler('Das Sidecar hat ein fremdes Schema: ' + sidecar.schema);
  const schluessel = leseSchluessel(schluesselPfad);
  const fingerabdruck = bufHash(schluessel);
  if (fingerabdruck !== sidecar.sha256Schluessel) {
    throw new SiegelFehler(
      'Falscher Schluessel: sein Fingerabdruck ist ' + fingerabdruck.slice(0, 16)
      + '..., diese Versiegelung erwartet ' + String(sidecar.sha256Schluessel).slice(0, 16)
      + '.... Das ist der Schluessel einer anderen Datei.',
    );
  }
  const siegel = await dateiHash(siegelPfad);
  if (siegel.sha256 !== sidecar.sha256Siegel) {
    log('WARNUNG: die Siegel-Bytes weichen vom Sidecar ab — der Tag muss das gleich bestaetigen.');
  }
  let probe;
  try {
    probe = await entschluesseltHashen(
      siegelPfad, schluessel, Buffer.from(sidecar.iv, 'hex'), Buffer.from(sidecar.authTag, 'hex'),
    );
  } catch (fehler) {
    throw alsSiegelFehler(fehler, 'Siegel-Pruefung rot');
  }
  if (probe.sha256 !== sidecar.sha256Klartext) {
    throw new SiegelFehler('Siegel-Pruefung rot: der entschluesselte Inhalt hat sha256 ' + probe.sha256);
  }
  log('Siegel intakt: ' + probe.bytes + ' Bytes, sha256 ' + probe.sha256 + ' — wie versiegelt.');
  return sidecar;
}

// -- CLI -----------------------------------------------------------------------

function argWert(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

function pfade(argv) {
  const wurzel = argWert(argv, '--datenwurzel') || datenwurzel();
  const panel = argWert(argv, '--panel') || path.join(wurzel, 'panel');
  return {
    klartextPfad: path.join(panel, KLARTEXT_NAME),
    siegelPfad: path.join(panel, SIEGEL_NAME),
    schluesselPfad: path.join(wurzel, ...SCHLUESSEL_TEIL),
    sidecarPfad: argWert(argv, '--sidecar') || path.join(__dirname, '..', ...SIDECAR_TEIL),
  };
}

async function main(argv) {
  const p = pfade(argv);
  if (argv.includes('--nur-pruefen')) return pruefe(p);
  return versiegele(p);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((fehler) => {
    console.error('FEHLER: ' + ((fehler && fehler.message) || fehler));
    process.exitCode = 1;
  });
}

module.exports = { versiegele, pruefe, leseSchluessel, SiegelFehler, ALGO, SCHEMA };
