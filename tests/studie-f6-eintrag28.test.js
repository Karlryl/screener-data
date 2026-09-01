'use strict';

// Waechter fuer scripts/studie-f6-eintrag28.js — den ueberschreibenden
// konfirmatorischen Akt.
//
// Jeder Riegel wird einmal ABSICHTLICH gebrochen. Die inhaltlichen Proben
// haengen an den sieben vom Akt-Reviewer bewiesenen Luecken (B1..B7) und an
// den ANHANG-3-Korrekturen: was Eintrag 27 gefehlt hat, muss hier NACHWEISBAR
// dastehen, sonst ist der Akt wieder unvollstaendig.
//
// Usage: node --test tests/studie-f6-eintrag28.test.js

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const WERKZEUG = path.join(__dirname, '..', 'scripts', 'studie-f6-eintrag28.js');
const WURZEL = path.join(__dirname, '..');
const LEDGER = path.join(WURZEL, 'protocol', 'early-detection', '2.0.0',
  'outcome-access-ledger.json');
const K = require(WERKZEUG);

function werkbank() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f6-e28-'));
  const dateien = [...Object.keys(K.SKRIPTE), ...Object.keys(K.ARTEFAKTE),
    'protocol/early-detection/2.0.0/hash-manifest.json',
    'reports/studie/f6-aequivalenz-entdeckung-2026-09-01.json'];
  for (const rel of dateien) {
    const quelle = path.join(WURZEL, ...rel.split('/'));
    const ziel = path.join(tmp, ...rel.split('/'));
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    if (fs.existsSync(quelle)) fs.copyFileSync(quelle, ziel);
  }
  return tmp;
}

// Das Register im Stand VOR diesem Akt.
function basisRegister(tmp) {
  const reg = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  // Bis zum Kettenende abschneiden, das DIESES Werkzeug erwartet - nicht bis
  // zu einer festen Laenge. Dieselbe Bruchstelle hatte der Waechter zu
  // Eintrag 27; sie ist beim Bau dieses hier ungeprueft mitgewandert und an
  // Eintrag 29 wieder gerissen. Ein Register waechst - eine Probe, die die
  // Laenge festnagelt, wird beim naechsten Akt rot, ohne dass an ihrem
  // Gegenstand etwas falsch waere.
  while (reg.events.length && reg.events.at(-1).eventHash !== K.ERWARTETER_TAIL) {
    reg.events.pop();
  }
  const p = path.join(tmp, 'basis-register.json');
  fs.writeFileSync(p, JSON.stringify(reg, null, 1));
  return p;
}

function fahre(argv, wurzel, register) {
  const echt = process.stdout.write;
  let ausgabe = '';
  process.stdout.write = (s) => { ausgabe += s; return true; };
  try {
    K.haupt(['--wurzel', wurzel, '--register', register || basisRegister(wurzel), ...argv]);
  } finally {
    process.stdout.write = echt;
  }
  return ausgabe;
}

const eintragVon = (tmp) => JSON.parse(
  fahre(['--zeige-eintrag'], tmp).match(/^EINTRAG:(.*)$/m)[1]);

// ── Riegel 1: keine Reparatur-Betriebsart ─────────────────────────────────
test('--force gibt es nicht (F6-B8)', () => {
  assert.throws(() => K.haupt(['--force']), /--force gibt es nicht/);
});

// ── Riegel 2: ein anderer Hash ist ein anderes Skript ─────────────────────
test('ein veraendertes gebundenes Skript bricht den Akt ab', () => {
  const tmp = werkbank();
  fahre([], tmp);                                    // gruen, bevor gebrochen wird
  fs.appendFileSync(path.join(tmp, 'scripts', 'studie-f6-zaehlwerk.py'),
    '\n# absichtlich veraendert\n');
  assert.throws(() => fahre([], tmp), /studie-f6-zaehlwerk\.py weicht ab/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 3: das Kettenende ist gebunden ─────────────────────────────────
test('ein anderes Kettenende bricht den Akt ab', () => {
  const tmp = werkbank();
  const p = basisRegister(tmp);
  const reg = JSON.parse(fs.readFileSync(p, 'utf8'));
  reg.events.pop();
  fs.writeFileSync(p, JSON.stringify(reg, null, 1));
  assert.throws(() => fahre([], tmp, p), /fuehrt 26 Eintraege|Kettenende/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 4: die Zeitkette (VB-A11) ──────────────────────────────────────
test('wirksam-ab vor der Anmeldung bricht ab', () => {
  const tmp = werkbank();
  // Beide Zeiten in der VERGANGENHEIT, damit wirklich der Zeitketten-Riegel
  // feuert und nicht der Zukunfts-Riegel davor.
  assert.throws(() => fahre(['--anmeldezeit', '2026-09-01T05:00:00.000Z',
    '--wirksam-ab', '2026-09-01T04:00:00.000Z'], tmp), /VB-A11|wirksam-ab/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('eine Anmeldezeit in der Zukunft bricht ab', () => {
  const morgen = new Date(Date.now() + 86400000).toISOString();
  assert.throws(() => K.haupt(['--anmeldezeit', morgen]), /liegt in der Zukunft/);
});

// ── Riegel 5: der Trockenlauf schreibt nichts ─────────────────────────────
test('der Trockenlauf laesst das echte Register byte-gleich', () => {
  const tmp = werkbank();
  const vorher = crypto.createHash('sha256').update(fs.readFileSync(LEDGER)).digest('hex');
  const ausgabe = fahre([], tmp);
  assert.strictEqual(
    crypto.createHash('sha256').update(fs.readFileSync(LEDGER)).digest('hex'), vorher);
  assert.match(ausgabe, /TROCKENLAUF - es wurde NICHTS geschrieben/);
  assert.match(ausgabe, /"previousHash": "5ad8a38a9f0c/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 6: B7 — 37 Pfade, JEDER mit seiner Pflicht ─────────────────────
test('alle 37 Ausgabepfade tragen die Pflicht, die sie verlangt (F6-B12)', () => {
  assert.strictEqual(K.ALLOWED_OUTPUTS.length, 37);
  assert.strictEqual(new Set(K.ALLOWED_OUTPUTS).size, 37);
  assert.strictEqual(K.DATEN_SCHLUESSEL.length, 30);
  for (const schluessel of K.ALLOWED_OUTPUTS) {
    const pflicht = K.PFLICHT_JE_SCHLUESSEL[schluessel];
    assert.ok(pflicht && pflicht.length > 20,
      `${schluessel} traegt keine Pflicht - genau die Luecke von Eintrag 27`);
    assert.match(pflicht, /F6-/, `${schluessel}: die Pflicht nennt keine Auflage`);
  }
  // Die drei tor-Pfade sind da und haengen unter differenz_punkte.
  for (const k of ['differenz_punkte.tor.verdikt', 'differenz_punkte.tor.weiter',
    'differenz_punkte.tor.grund']) {
    assert.ok(K.ALLOWED_OUTPUTS.includes(k), `${k} fehlt (F6-C13b)`);
  }
  // Kein Umschlag-Feld im Datensatz (F6-B10).
  for (const umschlag of ['runId', 'ersterZugriffAm', 'beendetAm', 'panelSha256']) {
    assert.ok(!K.ALLOWED_OUTPUTS.includes(umschlag));
  }
});

// ── Riegel 7: die Bindungskarte ist NICHT rollenlos (F6-C7e-c) ────────────
test('jede Bindung traegt art und rolle', () => {
  const arten = new Set(['erzeuger', 'ausfuehrend', 'erzeuger-und-teilausfuehrend']);
  for (const [rel, b] of Object.entries(K.SKRIPTE)) {
    assert.ok(arten.has(b.art), `${rel}: unzulaessige art ${b.art}`);
    assert.ok(b.rolle && b.rolle.length > 20, `${rel}: kein rolle-Satz`);
    assert.match(b.sha, /^[0-9a-f]{64}$/);
  }
  // Das Skript, an dem Eintrag 27 zerbrach, traegt die Dreifachrolle.
  const e2 = K.SKRIPTE['scripts/studie-e2-verbreitert.py'];
  assert.strictEqual(e2.art, 'erzeuger-und-teilausfuehrend');
  assert.match(e2.rolle, /DREI Rollen/);
  assert.match(e2.rolle, /KALIBRIER-HAELFTE wird es NICHT aufgerufen/);
});

// ── Riegel 8: der Eintrag traegt B1..B7 und die ANHANG-3-Korrekturen ──────
test('der Eintrag schliesst jede vom Reviewer bewiesene Luecke', () => {
  const tmp = werkbank();
  const e = eintragVon(tmp);

  assert.strictEqual(e.typ, 'confirmatory_execution_authorized');
  assert.strictEqual(e.previousHash, K.ERWARTETER_TAIL);
  assert.strictEqual(e.allowedOutputs.length, 37);

  // B1 — der SE-Freeze-Eintrag mit eventHash.
  assert.strictEqual(e.gateEvidenz.seFreezeEintrag.eventHash,
    'e9e0eeb3edcf5ac2af64bdd054ba6f2c28be9e82e30ec5eaff9e8c718e64ed8d');
  // B2 — die vier von F6-B19 verlangten Stuecke.
  assert.strictEqual(e.f6b19Beurkundung.prNummer, 186);
  assert.strictEqual(e.f6b19Beurkundung.vorherSha256,
    'c2c858d3bca134a829a6b50e4fce19426a5fb51dd02ea18717da04131ee8056b');
  assert.strictEqual(e.f6b19Beurkundung.nachherSha256,
    '21fba6882239d24ca70e6e3fd2f6610baa5d7bddfded0d0d030bbe4090ec5257');
  assert.match(e.f6b19Beurkundung.testnameAnker, /BESTAETIGBAR ist genau die/);
  for (const r of ['richtung1', 'richtung2', 'richtung3']) {
    assert.ok(e.f6b19Beurkundung.bruchproben[r].length > 40, `Bruchprobe ${r} fehlt`);
  }
  // B3 — der zweite Zeuge, woertlich, als Dokumentationspflicht.
  assert.match(e.zweiterZeuge.zitat, /S-U p_final 95 \(Rate 1,4219 %, 540 reife Firmen\)/);
  assert.match(e.zweiterZeuge.art, /KEIN PRUEFGLIED/);
  // B4 — die Dreifach-Bezeichnung.
  assert.match(e.dreifachBezeichnung.woertlich, /DREI Rollen gefuehrt, die einander NICHT ersetzen/);
  assert.match(e.dreifachBezeichnung.woertlich, /ERZEUGER-BINDUNG/);
  assert.match(e.dreifachBezeichnung.drittesEtikett, /GLEICHBEDEUTENDE Fassung/);
  // B5 — die Panel-Bau-Abweichung woertlich.
  assert.match(e.panelBauAbweichung.woertlich,
    /schlagen die Pufferjahre dem jeweils FRUEHEREN Fenster zu/);
  // B6 — die drei SHA-Schluessel stehen IN aequivalenzTor.
  for (const k of ['modulSha256', 'zaehlwerkSha256', 'zaehlprobeSha256']) {
    assert.match(e.aequivalenzTor[k], /^[0-9a-f]{64}$/, `${k} fehlt in aequivalenzTor`);
  }
  // ... und zwar der STAND DES TORS, nicht der neue Stand.
  assert.strictEqual(e.aequivalenzTor.zaehlwerkSha256,
    'f47f10d555c701c08e1282aa7e3b41424b836b0851edbdbb80f83839b9f99410');
  assert.strictEqual(e.eingabenHashes.skripte['scripts/studie-f6-zaehlwerk.py'].dateiSha256,
    '3f21cd0aaa68028ae51945d3b51d7bd74e005de98204015bc5874eb352fc780a');

  // ANHANG 3 — Bein 3 sechs Literale, Ruege, Symmetrie.
  assert.strictEqual(e.bein3Berichtigung.gemesseneZaehlung.gesamt, 6);
  assert.strictEqual(e.bein3Berichtigung.gemesseneZaehlung.f6c9_ziffern_gesamt, 5);
  assert.match(e.bein3Berichtigung.satzBerichtigt, /WAHRE ZAHL UEBER EINER FALSCHEN MENGE/);
  assert.match(e.bein3Berichtigung.ruege, /STILL genommen, nach NAMEN/);
  assert.match(e.bein3Berichtigung.symmetrie, /ES FEHLTE DIE BEURKUNDUNG, NICHT DER SCHUTZ/);
  // ANHANG 3 — die Richtungs-Offenlegung, ungeschoent.
  assert.match(e.torBerichtigung.richtungsOffenlegung.ausgabeflaeche, /34 -> 37/);
  assert.match(e.torBerichtigung.namensTransparenz, /KEINE ENTSCHEIDUNG DES GERICHTS/);
  // F6-C24c — die drei Gruende im Klartext.
  assert.strictEqual(e.supersedierung.dreiGruende.length, 3);
  assert.strictEqual(e.supersedierung.ueberholterEintrag.eventHash, K.ERWARTETER_TAIL);
  assert.match(e.supersedierung.reihenfolge, /ERLISCHT MIT DER UEBERSCHREIBUNG/);
  // F6-C24a — der SPERRENDE KZ-20-Abschnitt, Treffer UND Nicht-Treffer.
  assert.ok(e.kz20Ruecklauf.nichtTreffer.length >= 5, 'die Nicht-Treffer fehlen');
  assert.strictEqual(e.kz20Ruecklauf.treffer.length, 3);
  assert.match(e.kz20Ruecklauf.bewertung, /VOLLZOGEN, NICHT VERBRAUCHT/);
  // Die Berichtigungen aus dem Review.
  assert.match(e.ausgabesatz.anker.laeuferKommentar, /:415-447/);
  assert.match(e.panelRandHerkunft.rulesJson, /auf der WURZEL von rules\.json, NICHT unter/);
  assert.match(e.gliedCWiedervorlage, /SAMT WIEDERVORLAGE/);
  // Der Lauf haengt am DELTA-Review.
  assert.match(e.laufFreigabe, /DELTA-REVIEW/);
  assert.match(e.laufFreigabe, /FEUERT NICHT MIT DIESEM EINTRAG/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 9: R12a am Eintrag ─────────────────────────────────────────────
test('der Eintrag traegt keinen Nutzerpfad', () => {
  const tmp = werkbank();
  const e = eintragVon(tmp);
  const BS = String.fromCharCode(92);
  const roh = JSON.stringify(e);
  assert.ok(!new RegExp(`\\b[A-Za-z]:[${BS}${BS}/]{1,2}Users\\b`).test(roh));
  assert.ok(!new RegExp(`[${BS}${BS}/]Users[${BS}${BS}/][A-Za-z]`).test(roh));
  assert.strictEqual(e.arbeitspfad.kurzform, 'f6-arbeit');
  // Und der Riegel feuert, wenn man ihn bricht.
  assert.throws(() => K.pruefeKeinNutzerpfad({ a: `C:${BS}Users${BS}Jemand` }),
    /Windows-Laufwerkspfad/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 10: die Anker sind gemessen, nicht geraten ─────────────────────
test('die F6-C18-Anker treffen die tatsaechlichen Zeilen', () => {
  const band = fs.readFileSync(path.join(WURZEL, 'scripts', 'studie-vb-b4-band.py'), 'utf8')
    .split(/\r?\n/);
  const bei = (spanne) => band[Number(spanne.slice(1).split('-')[0]) - 1];
  assert.match(bei(K.ANKER.gate_gerissen), /def gate_gerissen/);
  assert.match(bei(K.ANKER.im_band), /if abs\(abstand\) <= breite_abs/);
  assert.match(bei(K.ANKER.ausserhalb_band), /if abstand > breite_abs/);
  // Der berichtigte Laeufer-Anker: 415-447 ist ein zusammenhaengender
  // Kommentarblock, davor Leerzeile, danach Code.
  const lauf = fs.readFileSync(path.join(WURZEL, 'scripts', 'studie-f6-lauf.py'), 'utf8')
    .split(/\r?\n/);
  const [von, bis] = K.ANKER.laeuferKommentar.match(/:(\d+)-(\d+)/).slice(1).map(Number);
  for (let n = von; n <= bis; n += 1) {
    assert.match(lauf[n - 1], /^\s*#/, `Zeile ${n} ist keine Kommentarzeile`);
  }
  assert.strictEqual(lauf[von - 2].trim(), '', `Zeile ${von - 1} muss leer sein`);
  assert.doesNotMatch(lauf[bis], /^\s*#/, `Zeile ${bis + 1} darf kein Kommentar sein`);
});
