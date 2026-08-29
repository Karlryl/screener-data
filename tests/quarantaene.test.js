'use strict';
/**
 * QUARANTAENE (Orchestrator ENTSCHIED 37, Beleg `fix-mrksw-vmrk-2026-08-30.md`) — Waechter des
 * Ausschlussregisters in `scripts/filter-snapshot-merge.js`.
 *
 * WAS AUF DEM SPIEL STEHT — in BEIDE Richtungen, und beide sind teuer:
 *   - Greift der Ausschluss NICHT, scort das Board eine Zeile, deren Zahlen einer anderen Firma
 *     gehoeren (`VMRK` traegt AvalonBays kompletten Block). Ab dem 25.09. verschaerft sich das:
 *     der 30-Tage-Refresh erzwingt einen Vollzug, der auch AvalonBays NAMEN in den Store
 *     schreibt — dann stuende AvalonBay zweimal im Board.
 *   - Greift er zu WEIT, verschwindet eine echte Firma. Das ist die teurere Richtung, deshalb
 *     pruefen die Wachen unten die Nicht-Wirkung genauso scharf wie die Wirkung.
 *
 * ⚠ DIESES REGISTER VERWIRFT, WAEHREND ALLE ANDEREN VORSTUFEN NUR UMBENENNEN. Wache 6 pinnt
 * genau diesen Unterschied: das Verwerfen darf die drei Umbenennungs-Strecken nicht beruehren.
 *
 * Standalone-Runner, keine Frameworks, kein Netz.
 * Run: node tests/quarantaene.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  teileEingang, ladeQuarantaene, quarantaeneFaellig, run,
  QUARANTAENE_STANDARDPFAD, QUARANTAENE_PFLICHTFELDER,
} = require('../scripts/filter-snapshot-merge.js');

let fehler = 0;
const pruefe = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { fehler++; console.error(`  FAIL ${name}\n       ${e.message}`); }
};

/** Baut einen vollstaendigen Mini-Lauf (Eingang + Watchlist + alle drei Register) im tmp. */
function bau(quarantaeneInhalt, tickers) {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'quar-'));
  const eingang = path.join(wurzel, 'eingang');
  const ziel = path.join(wurzel, 'ziel');
  fs.mkdirSync(eingang);
  for (const [t, name] of Object.entries(tickers)) {
    fs.writeFileSync(path.join(eingang, `${t}.json`), JSON.stringify({ meta: { ticker: t, name } }));
  }
  fs.writeFileSync(path.join(eingang, '_manifest.json'), '{}');
  const wl = path.join(wurzel, 'watchlist.json');
  fs.writeFileSync(wl, JSON.stringify({ stocks: Object.keys(tickers).map((t) => ({ ticker: t })) }));
  const quar = path.join(wurzel, 'quarantine.json');
  fs.writeFileSync(quar, typeof quarantaeneInhalt === 'string' ? quarantaeneInhalt : JSON.stringify(quarantaeneInhalt));
  const nav = path.join(wurzel, 'nav.json');
  fs.writeFileSync(nav, '[]');
  const ident = path.join(wurzel, 'ident.json');
  fs.writeFileSync(ident, JSON.stringify({ eintraege: [] }));
  const argv = ['node', 'x', '--eingang', eingang, '--ziel', ziel, '--watchlist', wl,
    '--quarantaene', quar, '--nav-register', nav, '--identitaets-register', ident, '--heute', '2026-08-30'];
  return { wurzel, eingang, ziel, argv };
}
const eintrag = (ticker, extra = {}) => Object.assign({
  ticker, grund: 'Traegt den Fundamentalblock einer anderen Firma.',
  beleg: 'agent-reports/fix-mrksw-vmrk-2026-08-30.md', aufgenommen: '2026-08-30', pruefungBis: '2026-09-25',
}, extra);
/** Faengt console.log/error ein — die Meldezeile IST der halbe Vertrag. */
function mitLog(fn) {
  const zeilen = [];
  const l = console.log, e = console.error;
  console.log = (...a) => zeilen.push(a.join(' '));
  console.error = (...a) => zeilen.push(a.join(' '));
  try { return { rc: fn(), log: zeilen.join('\n') }; } finally { console.log = l; console.error = e; }
}

console.log('Quarantaene — Waechter');

/* ── WACHE 1 — WIRKUNG: der Eintrag ist aus dem Scoring-Input weg UND steht in der Meldezeile ─
 * Beide Haelften zusammen, weil jede allein taeuschbar ist: ein stiller Drop waere nicht
 * nachvollziehbar, eine Meldezeile ohne Drop waere eine Luege.
 * Absichtlich gebrochen: in teileEingang die `quarantaeneDateinamen.has(f)`-Zeile entfernt ->
 * VMRK.json landet im Ziel, Wache rot. */
pruefe('Wache 1 WIRKUNG: quarantaenierter Ticker fehlt im Ziel UND steht in der lauten Zeile', () => {
  const b = bau({ eintraege: [eintrag('VMRK')] }, { VMRK: 'Vivmark Residential', AVB: 'AvalonBay Communities Inc', ADI: 'Analog Devices, Inc.' });
  const { rc, log } = mitLog(() => run(b.argv));
  assert.equal(rc, 0, `Lauf muss gruen sein, war ${rc}\n${log}`);
  assert.equal(fs.existsSync(path.join(b.ziel, 'VMRK.json')), false, 'VMRK darf NICHT im Scoring-Input liegen');
  assert.ok(/QUARANTAENE: 1 Zeilen — VMRK/.test(log), `laute Meldezeile fehlt:\n${log}`);
  fs.rmSync(b.wurzel, { recursive: true, force: true });
});

/* ── WACHE 2 — NICHT-WIRKUNG: alles andere bleibt unberuehrt ─────────────────────────────
 * Die teure Fehlerrichtung. Absichtlich gebrochen: in teileEingang `quarantaeneDateinamen.has(f)`
 * durch `true` ersetzt -> das ganze Universum verschwindet, Wache rot. */
pruefe('Wache 2 NICHT-WIRKUNG: jede nicht gelistete Zeile kommt unveraendert durch', () => {
  const b = bau({ eintraege: [eintrag('VMRK')] }, { VMRK: 'Vivmark Residential', AVB: 'AvalonBay Communities Inc', ADI: 'Analog Devices, Inc.' });
  const { rc } = mitLog(() => run(b.argv));
  assert.equal(rc, 0);
  for (const t of ['AVB', 'ADI']) {
    assert.ok(fs.existsSync(path.join(b.ziel, `${t}.json`)), `${t} muss durchkommen`);
    const j = JSON.parse(fs.readFileSync(path.join(b.ziel, `${t}.json`), 'utf8'));
    assert.equal(j.meta.ticker, t, `${t} darf nicht veraendert werden`);
  }
  assert.ok(fs.existsSync(path.join(b.ziel, '_manifest.json')), 'Metadateien gehen weiter durch');
  fs.rmSync(b.wurzel, { recursive: true, force: true });
});

/* ── WACHE 3 — LEERES REGISTER = NULL WIRKUNG ────────────────────────────────────────────
 * Absichtlich gebrochen: den Vorrang in teileEingang auf `!quarantaeneDateinamen.has(f)`
 * gedreht -> bei leerem Register faellt alles raus, Wache rot. */
pruefe('Wache 3 LEER: leeres Register laesst ALLES durch, meldet aber trotzdem', () => {
  for (const leer of [{ eintraege: [] }, '[]']) {
    const b = bau(leer, { VMRK: 'Vivmark Residential', AVB: 'AvalonBay Communities Inc' });
    const { rc, log } = mitLog(() => run(b.argv));
    assert.equal(rc, 0, `Lauf muss gruen sein, war ${rc}\n${log}`);
    for (const t of ['VMRK', 'AVB']) assert.ok(fs.existsSync(path.join(b.ziel, `${t}.json`)), `${t} muss bei leerem Register durchkommen`);
    // Auch bei 0 wird gemeldet: ein Register, das nur beim Zuschlagen spricht, ist von einem
    // kaputt geladenen nicht zu unterscheiden.
    assert.ok(/QUARANTAENE: 0 Zeilen/.test(log), `Meldezeile fehlt bei leerem Register:\n${log}`);
    fs.rmSync(b.wurzel, { recursive: true, force: true });
  }
});

/* ── WACHE 4 — FAIL-CLOSED: kaputtes/unvollstaendiges Register stoppt den Lauf ────────────
 * Ein Register, das Zeilen verwirft, darf nie lautlos leer laufen.
 * Absichtlich gebrochen: das try/catch um ladeQuarantaene in run() entfernt -> Wurf statt
 * kontrolliertem Exit 1, Wache rot. */
pruefe('Wache 4 FAIL-CLOSED: kaputtes JSON und jedes fehlende Pflichtfeld stoppen', () => {
  const kaputt = ['{ kein json', JSON.stringify({ eintraege: 'nope' }), JSON.stringify({}), JSON.stringify(42)];
  for (const k of kaputt) {
    const b = bau(k, { AVB: 'AvalonBay Communities Inc' });
    const { rc, log } = mitLog(() => run(b.argv));
    assert.equal(rc, 1, `${k.slice(0, 30)} haette stoppen muessen`);
    assert.ok(/Quarantaene-Register nicht ladbar/.test(log), `Grund fehlt in der Meldung:\n${log}`);
    fs.rmSync(b.wurzel, { recursive: true, force: true });
  }
  // JEDES der fuenf Pflichtfelder einzeln — inklusive pruefungBis, dem Feld, das dieses
  // Register von nav-holdings.json unterscheidet.
  assert.deepEqual(QUARANTAENE_PFLICHTFELDER, ['ticker', 'grund', 'beleg', 'aufgenommen', 'pruefungBis']);
  for (const feld of QUARANTAENE_PFLICHTFELDER) {
    const e = eintrag('VMRK'); delete e[feld];
    const b = bau({ eintraege: [e] }, { VMRK: 'Vivmark Residential' });
    const { rc } = mitLog(() => run(b.argv));
    assert.equal(rc, 1, `fehlendes Feld ${feld} haette stoppen muessen`);
    fs.rmSync(b.wurzel, { recursive: true, force: true });
  }
  // Doppelter Ticker = still widerspruechliche Pflege.
  const b2 = bau({ eintraege: [eintrag('VMRK'), eintrag('VMRK')] }, { VMRK: 'x' });
  assert.equal(mitLog(() => run(b2.argv)).rc, 1, 'doppelter Ticker haette stoppen muessen');
  fs.rmSync(b2.wurzel, { recursive: true, force: true });
});

/* ── WACHE 5 — WIRKUNGSLOSER EINTRAG faellt auf ──────────────────────────────────────────
 * Ein Eintrag ohne Datei im Eingang schuetzt nichts. Genau so schliefe die 25.09.-Falle
 * wieder ein, wenn der Feed den Ticker umbenennt.
 * Absichtlich gebrochen: die Warn-Schleife entfernt -> keine Meldung, Wache rot. */
pruefe('Wache 5 WIRKUNGSLOS: Eintrag ohne Datei im Eingang wird laut gemeldet', () => {
  const b = bau({ eintraege: [eintrag('GIBTESNICHT')] }, { AVB: 'AvalonBay Communities Inc' });
  const { rc, log } = mitLog(() => run(b.argv));
  assert.equal(rc, 0, 'ein toter Eintrag ist legitim (Delisting) und darf nicht stoppen');
  assert.ok(/QUARANTAENE: GIBTESNICHT liegt nicht im Eingang/.test(log), `Warnung fehlt:\n${log}`);
  fs.rmSync(b.wurzel, { recursive: true, force: true });
});

/* ── WACHE 6 — DER STALE-STAND IM ZIEL ───────────────────────────────────────────────────
 * Dieser Schritt kopiert nur, er raeumt das Ziel nicht ab. Ein Stand aus einem Lauf VOR der
 * Aufnahme wuerde weiter gescort, waehrend das Log den Ausschluss als wirksam meldet — der
 * teuerste denkbare stille Fehler dieses Registers.
 * Absichtlich gebrochen: die existsSync-Schleife nach dem Kopieren entfernt -> Exit 0 mit
 * vergifteter Datei im Ziel, Wache rot. */
pruefe('Wache 6 STALE: alter Stand im Ziel stoppt den Lauf statt still weiterzuscoren', () => {
  const b = bau({ eintraege: [eintrag('VMRK')] }, { VMRK: 'Vivmark Residential', AVB: 'AvalonBay Communities Inc' });
  fs.mkdirSync(b.ziel, { recursive: true });
  fs.writeFileSync(path.join(b.ziel, 'VMRK.json'), JSON.stringify({ meta: { ticker: 'VMRK', name: 'Vivmark Residential' } }));
  const { rc, log } = mitLog(() => run(b.argv));
  assert.equal(rc, 1, 'ein Altstand im Ziel muss den Lauf stoppen');
  assert.ok(/liegt noch aus einem frueheren Lauf im Ziel/.test(log), `Diagnose fehlt:\n${log}`);
  fs.rmSync(b.wurzel, { recursive: true, force: true });
});

/* ── WACHE 7 — WIEDERVORLAGE ─────────────────────────────────────────────────────────────
 * Ein Ausschluss ohne Ablauf wird still zum Dauerzustand. Reine Funktion, Datum injiziert.
 * Absichtlich gebrochen: den Vergleich in quarantaeneFaellig auf `>` gedreht -> genau falsch
 * herum, Wache rot. */
pruefe('Wache 7 WIEDERVORLAGE: ueberfaelliger Eintrag meldet sich, frischer schweigt', () => {
  const e = eintrag('VMRK', { pruefungBis: '2026-09-25' });
  assert.deepEqual(quarantaeneFaellig([e], '2026-08-30T04:17:00Z'), [], 'vor dem Stichtag: still');
  assert.deepEqual(quarantaeneFaellig([e], '2026-09-25T04:17:00Z'), [], 'am Stichtag selbst: noch still');
  assert.deepEqual(quarantaeneFaellig([e], '2026-09-26T04:17:00Z').map((x) => x.ticker), ['VMRK'], 'einen Tag danach: faellig');
  const b = bau({ eintraege: [e] }, { VMRK: 'Vivmark Residential' });
  b.argv[b.argv.indexOf('--heute') + 1] = '2026-10-01';
  const { log } = mitLog(() => run(b.argv));
  assert.ok(/zur Wiedervorlage faellig/.test(log), `Wiedervorlage-Warnung fehlt:\n${log}`);
  fs.rmSync(b.wurzel, { recursive: true, force: true });
});

/* ── WACHE 8 — DIE AUSGELIEFERTE DATEI ───────────────────────────────────────────────────
 * Das Register im Repo muss ladbar sein und VMRK fuehren — sonst ist der ganze Bau Dekoration.
 * Absichtlich gebrochen: den VMRK-Eintrag aus data-health/quarantine.json entfernt -> rot. */
pruefe('Wache 8 AUSLIEFERUNG: data-health/quarantine.json ist ladbar und fuehrt VMRK', () => {
  const q = ladeQuarantaene(QUARANTAENE_STANDARDPFAD);
  assert.ok(q.tickers.has('VMRK'), 'VMRK ist der erste Eintrag (ENTSCHIED 37)');
  const v = q.eintraege.find((e) => e.ticker === 'VMRK');
  assert.match(v.beleg, /fix-mrksw-vmrk-2026-08-30\.md/, 'die Belegdatei gehoert an den Eintrag');
  assert.equal(v.pruefungBis, '2026-09-25', 'die Frist ist der Tag, an dem der 30-Tage-Refresh zuschlaegt');
  // AVBC.VI wurde untersucht und ausdruecklich NICHT aufgenommen (legitime Wiener Notierung).
  assert.equal(q.tickers.has('AVBC.VI'), false, 'AVBC.VI ist eine echte AvalonBay-Notierung, kein Fremdlaeufer');
});

console.log(fehler ? `\nQuarantaene: ${fehler} Wache(n) ROT` : '\nQuarantaene: alle Wachen gruen');
process.exit(fehler ? 1 : 0);
