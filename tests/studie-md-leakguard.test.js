'use strict';

// T184 — Der Leak-Guard fuer die PROSA-Ebene der E4g-/E4h-Studienberichte.
//
// DIE SACHE: `pruefe_ausgabe` in den beiden Studienskripten deckt ausschliesslich
// die JSON-Ausgabe. Die `.md`-Berichte unter reports/studie/ — die Dokumente, aus
// denen der Rat tatsaechlich zitiert — sind von Hand aus dem JSON geschrieben.
// Gemessen (T184-Vorarbeit, 2026-08-30): die Skripte schreiben AUSSCHLIESSLICH
// JSON (`json.dump` in studie-e4g-restursachen.py bzw. studie-e4h-serienende.py).
// Es gibt also gar keinen Schreibpfad, in den man einen Guard haengen koennte —
// der Waechter MUSS ein Test ueber den committeten Artefakten sein. Das ist die
// Bauform, keine Geschmacksfrage.
//
// REGEL: ENTSCHIED 154 setzt Regel (a) durch — NUR WERTE sind verboten.
// Schema- und Lauf-Metadaten-Vokabular (`adsh`, `ddate`, `value`, `version`,
// `letzte_form`, `count_only_probe_authorized` …) ist ausdruecklich ERLAUBT.
// Verboten sind: Firmen-Kennungen (CIK/adsh), Ticker, Signalwerte und
// Konzeptnamen — Letztere mit genau EINER benannten, begruendeten Ausnahme.
//
// ZWEI BAU-AUFLAGEN aus der Vorarbeit, beide hier mechanisch umgesetzt:
//   (1) Hash-Laeufe VOR der Ziffernsuche entfernen. Die Register-Hashes tragen
//       CIK-artige Ziffernfolgen in ihrem Inneren (`…c26273507c0…`,
//       `…a3827070105f…`). Ein Detektor ohne Hash-Ausblendung faellt bei JEDEM
//       Bericht mit Register-Bezug darauf herein — und ein Waechter, der falsch
//       anschlaegt, wird abgeschaltet. Gegenprobe unten explizit.
//   (2) Jede Datei gegen IHR EIGENES Vokabular. E4g meldet 20 Ausgabefelder an,
//       E4h 14 — eine gegen die fremde Liste gepruefte Datei erzeugt
//       Phantom-Treffer (in der Vorarbeit sieben Stueck). Hier strukturell
//       geloest: das erlaubte Vokabular kommt aus der NACHBAR-JSON derselben
//       Datei, nie aus einer global gepinnten Liste.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const BERICHTE = path.join(REPO, 'reports', 'studie');

// Musterbasiert, damit kuenftige Berichte dieser Familien automatisch mitlaufen.
// Wer eine neue E4g-/E4h-Prosa ablegt, bekommt den Waechter geschenkt.
const FAMILIE = /^E4[gh]-.+\.md$/;

// Auflage (1): ein Hash-Lauf ist >= 32 Hex-Zeichen MIT mindestens einem
// Hex-Buchstaben. Die zweite Bedingung ist der Punkt — eine reine Ziffernkette
// wird NIE ausgeblendet, eine zehnstellige CIK ueberlebt die Vorreinigung also
// auch dann, wenn sie zufaellig 32 Stellen lang waere.
const HEX_LAUF = /\b(?=[0-9a-fA-F]{32,}\b)(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]+\b/g;

// `_` gehoert zum Wort: sonst zerfaellt `REIFE_QUARTALE` in zwei Fragmente, von
// denen eines wie ein Ticker aussieht.
const WORT = /[A-Za-zÄÖÜäöüß0-9_]+/gu;

const KENNUNG_ADSH = /\b\d{10}-\d{2}-\d{6}\b/g;
const KENNUNG_BENANNT = /\b(?:cik|adsh)\b\W{0,4}\d+/gi;
// Gemessen an beiden committeten Berichten: NULL Ziffernlaeufe >= 5 nach der
// Hash-Vorreinigung. Deutsche Tausenderpunkte und Datumsteile zerfallen an der
// Wortgrenze; ein nackter fuenfstelliger Lauf ist in einem Zaehl-Bericht bereits
// die Anomalie, auf die dieser Waechter anhalten soll.
const KENNUNG_ZIFFERN = /\b\d{5,}\b/g;

// Konzeptname = XBRL-Tag-Form: zusammengeschriebene Woerter mit >= 2 Grosshuegeln.
// Deutsche Komposita haben genau EINEN Grossbuchstaben und fallen nicht darunter;
// `FolgeQUARTALE` ebenso wenig (der zweite Huegel ist nicht [A-Z][a-z]+).
const KONZEPT_FORM = /\b[A-ZÄÖÜ][a-zäöüß]+(?:[A-ZÄÖÜ][a-zäöüß]+)+\b/gu;

// Die Handvoll us-gaap-Konzepte, die aus EINEM Wort bestehen und deshalb nicht
// unter die Huegel-Form fallen. `Revenues` steht namentlich in der Testtabelle
// des RR-6-Audits (§ P9) als Fall, den der alte Waechter durchliess.
// ponytail: benannte Liste statt Taxonomie-Import — die Huegel-Form deckt die
// grosse Mehrheit der Konzeptnamen; kommt ein weiteres Ein-Wort-Konzept in einem
// Bericht vor, gehoert es hier hinein (eine Zeile, sichtbar im Diff).
const KONZEPT_EINWORT = new Set([
  'Revenues', 'Assets', 'Liabilities', 'Equity', 'Goodwill', 'Inventory',
  'Cash', 'Depreciation', 'Investments', 'Sales',
]);

// Ein Signalwert kommt nie ohne Einheit. Zaehl-Berichte tragen keine Waehrung —
// gemessen: beide committeten Berichte enthalten NULL Treffer.
// ponytail: Groessenordnungs-Marker statt Zahlenanalyse. Deckt Umsatz-, Gewinn-,
// Aktienzahl- und Kurswerte in ihrer ueblichen Schreibweise; eine nackte Zahl
// ohne Einheit faengt erst eine Nachbar-JSON-Abgleichstufe, die Regel (a) heute
// nicht verlangt.
const SIGNALWERT = /\b(?:USD|EUR|CHF|GBP|Mio|Mrd|Millionen|Milliarden)\b|[$€£]/g;

const TICKER_FORM = /^[A-ZÄÖÜ][A-ZÄÖÜ0-9]{1,4}$/u;
// Studien- und Protokoll-Kennungen: D2, E3, E4a, R11, T171. Eine Form, keine Liste
// — sonst waechst der Waechter mit jedem neuen Auftrag.
const STUDIEN_ID = /^[A-Z]\d{1,4}[a-zA-Z]?$/;

// Die EINZIGE Konzeptname-Ausnahme, benannt und begruendet statt stillschweigend
// geduldet. Wer eine zweite eintraegt, hinterlaesst eine sichtbare Zeile.
const KONZEPT_AUSNAHMEN = new Map([
  ['OperatingIncomeLoss',
    'Vor-eingefroren: steht seit der Praeregistrierung 2.0.0 (protocol/early-detection/'
    + '2.0.0/preregistration.json) als gewaehlte Reihe im Repo, sieben Wochen vor dem '
    + 'E4g-Lauf. RR-6-Audit § P3/P11 stuft ihn als harmlos ein; ENTSCHIED 154 Regel (a) '
    + 'verbietet WERTE, nicht die Benennung des Messinstruments.'],
]);

// Grossgeschriebene Fachbegriffe der Studienprosa, die kein Ticker sind und weder
// in der Nachbar-JSON noch in einer anderen Schreibweise im Dokument stehen.
// Bewusst kurz gehalten — jede Ergaenzung ist eine sichtbare, gereviewte Zeile,
// und ein Ticker in dieser Liste faellt genau deshalb auf.
const STUDIEN_VOKABULAR = new Set([
  // afs-Codes, wortgleich aus scripts/studie-e4g-restursachen.py::AFS. Sie stehen
  // hier vollstaendig, nicht nur soweit ein Arm sie zufaellig getroffen hat.
  'LAF', 'ACC', 'SRA', 'NON', 'SML',
  // Fachjargon der Berichte.
  'ID', 'PR', 'SEC', 'SHA', 'SQL', 'VORAB', 'WHERE',
]);

/**
 * Gibt jeden Fund als {klasse, wert, zeile} zurueck. Leeres Array = sauber.
 *
 * `nachbarJson` ist der Text der gleichnamigen `.json` — das maschinell
 * bewachte Ausgabe-Artefakt derselben Datei. Was dort drinsteht, hat den
 * JSON-Waechter (`pruefe_ausgabe`) bereits passiert und ist damit auch in der
 * Prosa erlaubt. Genau das ist Auflage (2): jede Datei gegen IHR Vokabular.
 */
function pruefeBericht(text, nachbarJson = '') {
  const zeilen = text.split(/\r?\n/).map((z) => z.replace(HEX_LAUF, ' '));
  const alleWorte = zeilen.join('\n').match(WORT) || [];
  const jsonVokabular = new Set((nachbarJson.match(WORT) || []).map((w) => w.toUpperCase()));
  // Deutsche VERSALIEN-Betonung: das Wort steht anderswo im selben Dokument in
  // normaler Schreibweise. Ein Ticker hat diesen Zwilling nicht.
  const kleinZwilling = new Set(
    alleWorte.filter((w) => w !== w.toUpperCase()).map((w) => w.toUpperCase()),
  );

  const funde = [];
  zeilen.forEach((zeile, i) => {
    const melde = (klasse, wert) => funde.push({ klasse, wert, zeile: i + 1 });
    for (const t of zeile.match(KENNUNG_ADSH) || []) melde('Firmen-Kennung', t);
    for (const t of zeile.match(KENNUNG_BENANNT) || []) melde('Firmen-Kennung', t);
    for (const t of zeile.match(KENNUNG_ZIFFERN) || []) melde('Firmen-Kennung', t);
    for (const t of zeile.match(KONZEPT_FORM) || []) {
      if (!KONZEPT_AUSNAHMEN.has(t)) melde('Konzeptname', t);
    }
    for (const t of zeile.match(WORT) || []) {
      if (KONZEPT_EINWORT.has(t) && !KONZEPT_AUSNAHMEN.has(t)) melde('Konzeptname', t);
    }
    for (const t of zeile.match(SIGNALWERT) || []) melde('Signalwert', t);
    for (const t of zeile.match(WORT) || []) {
      if (!TICKER_FORM.test(t)) continue;
      if (STUDIEN_ID.test(t) || STUDIEN_VOKABULAR.has(t)) continue;
      if (kleinZwilling.has(t) || jsonVokabular.has(t)) continue;
      melde('Ticker', t);
    }
  });
  return funde;
}

function berichte() {
  return fs.readdirSync(BERICHTE).filter((n) => FAMILIE.test(n)).sort();
}

function lies(name) {
  const md = fs.readFileSync(path.join(BERICHTE, name), 'utf8');
  const nachbar = path.join(BERICHTE, name.replace(/\.md$/, '.json'));
  return { md, json: fs.existsSync(nachbar) ? fs.readFileSync(nachbar, 'utf8') : '' };
}

function klassen(funde) {
  return [...new Set(funde.map((f) => f.klasse))].sort();
}

// ── Abdeckung ────────────────────────────────────────────────────────────────

test('Der Waechter deckt die committeten E4g-/E4h-Berichte wirklich ab', () => {
  const gefunden = berichte();
  // Ohne diese Zeile waere ein umbenannter Bericht ein lautloses Gruen: der Glob
  // faende nichts, jede Schleife liefe null Mal, der Test bliebe gruen.
  assert.ok(gefunden.length >= 2, `Nur ${gefunden.length} Berichte gefunden: ${gefunden}`);
  for (const pflicht of ['E4g-restursachen-diagnose-2026-08-29.md',
    'E4h-serienende-diagnose-2026-08-29.md']) {
    assert.ok(gefunden.includes(pflicht), `${pflicht} faellt nicht mehr unter das Muster`);
  }
});

test('Kein Wert-Leck in den committeten E4g-/E4h-Berichten', () => {
  for (const name of berichte()) {
    const { md, json } = lies(name);
    const funde = pruefeBericht(md, json);
    assert.deepEqual(funde, [],
      `${name} traegt: ${funde.map((f) => `${f.klasse} '${f.wert}' (Zeile ${f.zeile})`).join(' | ')}`);
  }
});

// ── Bruchproben: jede verbotene Klasse einmal eingeschmuggelt ────────────────
//
// Eingeschmuggelt wird in eine KOPIE des echten Berichts, nicht in einen
// Kunsttext: der Waechter muss den Fund im echten Rauschen finden, nicht in
// einem Satz, den er sich selbst gebaut hat.

const ECHT = () => lies('E4g-restursachen-diagnose-2026-08-29.md');

function mitLeck(einschub) {
  const { md, json } = ECHT();
  const zeilen = md.split(/\r?\n/);
  zeilen.splice(150, 0, einschub);
  return pruefeBericht(zeilen.join('\n'), json);
}

for (const [name, einschub, klasse] of [
  ['eine CIK', 'Auffaellig ist die Firma 0000320193 im Signalarm.', 'Firmen-Kennung'],
  ['eine adsh', 'Beleg: Einreichung 0000320193-19-000066.', 'Firmen-Kennung'],
  ['ein Ticker', 'Der Fall AAPL zeigt das Muster am deutlichsten.', 'Ticker'],
  ['ein Konzeptname', 'Die Reihe bricht bei NetIncomeLoss ab.', 'Konzeptname'],
  ['ein Signalwert', 'Der Umsatz faellt von 383,29 Mrd auf 274,52 Mrd USD.', 'Signalwert'],
]) {
  test(`Bruchprobe: ${name} faerbt den Waechter rot — mit benannter Klasse`, () => {
    const funde = mitLeck(einschub);
    assert.ok(funde.length > 0, `${name} ist unbemerkt durchgegangen`);
    assert.ok(klassen(funde).includes(klasse),
      `Gemeldet wurde ${klassen(funde)}, erwartet war ${klasse}`);
    assert.equal(funde.find((f) => f.klasse === klasse).zeile, 151,
      'Der Fund muss die Zeile nennen, sonst sucht der naechste von Hand');
  });
}

// ── Gegenproben: die zwei historischen Fehlalarme muessen GRUEN bleiben ──────

test('Gegenprobe 1: CIK-artige Ziffern IM Register-Hash sind kein Fund', () => {
  // Die beiden echten Register-Hashes der Berichte. In ihrem Inneren stehen
  // `26273507` und `3827070105` — genau die zwei Fehlalarme der Vorarbeit.
  const hashes = [
    '4183c3419b3f22def55207c26273507c0d99601c00b267399eb934b74d148207',
    '381fd9e08651fd0410b4adc98a941300e8d0a3827070105fa70f60f417ec7c17',
  ];
  const text = `**Register-Eintrag** \`${hashes[0]}\`\nund \`${hashes[1]}\`\n`;
  assert.deepEqual(pruefeBericht(text), [],
    'Ein Bericht MIT Register-Hash darf nicht anschlagen');

  // Positiv-Gegenprobe: ohne die Hash-Vorreinigung WUERDE der Detektor feuern.
  // Ohne sie waere das Gruen oben nicht von einem kaputten Detektor zu
  // unterscheiden.
  for (const h of hashes) {
    assert.ok(/\b\d{5,}\b/.test(h.replace(/[a-f]/g, ' ')),
      'Der Hash traegt gar keine CIK-artige Ziffernfolge — die Probe ist wertlos');
  }
  assert.equal(hashes[0].replace(HEX_LAUF, ' ').trim(), '',
    'Die Hash-Vorreinigung greift nicht');
});

test('Gegenprobe 2: jede Datei gegen IHR Vokabular — nie gegen die fremde Liste', () => {
  // E4h fuehrt Felder, die E4gs Allowlist nicht kennt, und umgekehrt. In der
  // Vorarbeit erzeugte genau diese Kreuzung sieben Phantom-Treffer.
  const e4h = lies('E4h-serienende-diagnose-2026-08-29.md');
  const e4g = ECHT();

  assert.deepEqual(pruefeBericht(e4h.md, e4h.json), [], 'E4h gegen sein eigenes JSON');
  assert.deepEqual(pruefeBericht(e4g.md, e4g.json), [], 'E4g gegen sein eigenes JSON');

  // Und der eigentliche Punkt: das Ergebnis haengt NICHT daran, welche fremde
  // Feldliste jemand danebenlegt. Regel (a) laesst Schema-Vokabular ohnehin zu;
  // der Waechter darf davon nicht abweichen, wenn das Nachbar-JSON fehlt.
  assert.deepEqual(pruefeBericht(e4h.md, e4g.json), [], 'E4h gegen die FREMDE E4g-Liste');
  assert.deepEqual(pruefeBericht(e4g.md, e4h.json), [], 'E4g gegen die FREMDE E4h-Liste');
  assert.deepEqual(pruefeBericht(e4h.md), [], 'E4h ganz ohne Nachbar-JSON');
  assert.deepEqual(pruefeBericht(e4g.md), [], 'E4g ganz ohne Nachbar-JSON');
});

test('Gegenprobe 3: Schema- und Metadaten-Vokabular ist erlaubt (Regel a)', () => {
  // Die Tokens, die die Vorarbeit als "ausserhalb der Allowlist, aber erlaubt"
  // gemessen hat. Sie duerfen den Waechter nicht ausloesen.
  const text = 'Spalten `adsh` `ddate` `value` `version` `accepted` `bericht`, '
    + 'Fenster `pruefung`, Eintragsart `count_only_probe_authorized`, '
    + 'Funktion `lies_fakt_metadaten`, Praefix `letzte_form`, afs-Codes '
    + '`larger`/`smaller`, Felder `signal_weiterfiler` `qtrs_abgedeckt` '
    + '`sondenSpalten` `nenner_restursachen` `letzte_form_nach_signal`.';
  assert.deepEqual(pruefeBericht(text), []);
});

// ── Die Ausnahme ist benannt, nicht geduldet ────────────────────────────────

test('Jede Konzeptname-Ausnahme traegt ihre Begruendung mit Fundstelle', () => {
  assert.deepEqual([...KONZEPT_AUSNAHMEN.keys()], ['OperatingIncomeLoss'],
    'Eine zweite Ausnahme ist eine Entscheidung, kein Wartungsschritt');
  for (const [konzept, grund] of KONZEPT_AUSNAHMEN) {
    assert.ok(grund.length > 80, `${konzept} hat keine echte Begruendung`);
    assert.match(grund, /preregistration\.json|prereg/i,
      `${konzept} nennt keine Fundstelle fuer das Vor-Einfrieren`);
  }
  // Und die Ausnahme ist EINE Zeichenkette, kein Freibrief fuer die Klasse.
  assert.ok(klassen(pruefeBericht('Wert von OperatingIncomeLoss und Revenues.'))
    .includes('Konzeptname'), 'Ein zweiter Konzeptname darf nicht mitrutschen');
  assert.deepEqual(pruefeBericht('Die gewaehlte Reihe ist OperatingIncomeLoss.'), []);
});
