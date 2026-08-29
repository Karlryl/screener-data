'use strict';
// tests/exit-event-resolver.test.js — Waechter des Terminal-Ereignis-Aufloesers
// (ENTSCHIED 52, Baustein aus ENTSCHIED 49).
//
// HERMETISCH: kein Netz, kein submissions.zip, kein SEC_CONTACT noetig. Die
// Fixtures unter tests/fixtures/exit-event-resolver/ sind ECHTE, aus dem lokalen
// SEC-Bulk und von EDGAR gezogene Daten (echte Accessions, Daten, Item-Codes,
// Dokumenttexte) — nur auf die relevanten Zeilen bzw. Textfenster getrimmt.
//
// GEPINNT WIRD DIE SACHE, NICHT EIN TEXTMUSTER:
//  (A) Die fuenf Machbarkeits-Faelle aus s0-filing-machbarkeit-2026-08-30.md §6
//      als Ende-zu-Ende-Ergebnis: TWTR 54,20 · ATVI 95,00 (NICHT 27,50) ·
//      BBBY 0-per-Regel · XLNX Verhaeltnis-statt-Preis · FRC unaufloesbar.
//  (B) Jede der vier stillen Fallen aus §4.3 in BEIDEN Richtungen: der Waechter
//      feuert am kranken Eingang UND laesst den gesunden durch. Zusaetzlich wird
//      je Falle der SCHADEN gezeigt, den die ungewaechterte Fassung anrichtet —
//      sonst ist nicht belegt, dass der Waechter ueberhaupt traegt.
//  (C) Die drei Wert-Regime sind sauber getrennt: die Insolvenz-Null darf NIE
//      aus einem Dokument kommen (bewiesen mit einem Abrufer, der beim Aufruf
//      wirft), der Aktientausch NIE einen Preis erzeugen.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = require('../scripts/exit-event-resolver.js');

const FIX = path.join(__dirname, 'fixtures', 'exit-event-resolver');
const SUBS = path.join(FIX, 'submissions');
const DOCS = path.join(FIX, 'docs');
const SLIM = path.join(FIX, 'slim-cache');

const fetchDoc = R.makeDirFetcher(DOCS);
const opts = () => ({ submissionsDir: SUBS, fetchDoc });
const entryName = (cik) => 'CIK' + String(cik).padStart(10, '0') + '.json';

// Ein Abrufer, der jeden Aufruf zum Fehler macht. Damit wird "liest KEIN
// Dokument" beweisbar statt behauptet.
const forbiddenFetch = () => { throw new assert.AssertionError({ message: 'VERBOTEN: dieser Pfad hat ein Dokument abgerufen' }); };

let fails = 0;
function t(name, fn) {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { fails++; console.log('  FAIL ' + name + '\n       ' + (e.message || e)); }
}
async function ta(name, fn) {
  try { await fn(); console.log('  ok  ' + name); }
  catch (e) { fails++; console.log('  FAIL ' + name + '\n       ' + (e.message || e)); }
}
const evidenceHas = (res, accession) => res.evidence.some((e) => e.accession === accession);

// ── (A) Die fuenf Machbarkeits-Faelle ────────────────────────────────────────

async function testDieFuenfFaelle() {
  await ta('TWTR — Barfusion, 54,20 aus datums-gebundenem Ereignis-8-K', async () => {
    const r = await R.resolveExitEvent(1418091, '2022-01-01', '2022-12-31', opts());
    assert.strictEqual(r.eventType, R.EventType.MERGER);
    assert.strictEqual(r.eventDate, '2022-10-31');
    assert.strictEqual(r.terminalValue, 54.20);
    assert.ok(/^CASH_MERGER_PRICE/.test(r.valueBasis), 'valueBasis: ' + r.valueBasis);
    // Belege sind die im Bericht namentlich gefuehrten Dokumente.
    assert.ok(evidenceHas(r, '0000876661-22-000890'), '25-NSE 2022-10-28 fehlt im Beleg');
    assert.ok(evidenceHas(r, '0001193125-22-272772'), '8-K 2022-10-31 fehlt im Beleg');
    assert.ok(evidenceHas(r, '0001193125-22-202163'), 'DEFM14A 2022-07-26 fehlt im Beleg');
    assert.ok(r.confidence >= 0.9);
  });

  await ta('ATVI — 95,00 und NICHT 27,50 (Vivendi 2008)', async () => {
    const r = await R.resolveExitEvent(718877, '2023-01-01', '2023-12-31', opts());
    assert.strictEqual(r.eventType, R.EventType.MERGER);
    assert.strictEqual(r.eventDate, '2023-10-13');
    assert.strictEqual(r.terminalValue, 95.00);
    assert.notStrictEqual(r.terminalValue, 27.50);
    assert.ok(evidenceHas(r, '0001104659-22-036155'), 'DEFM14A 2022-03-21 muss der Beleg sein');
    assert.ok(!evidenceHas(r, '0001047469-08-007235'), 'die Vivendi-Vorlage von 2008 darf NIE Beleg sein');
    const tplEv = r.evidence.find((e) => e.role === 'value-template');
    assert.ok(tplEv.rejectedTemplates.some((s) => /2008-06-06/.test(s)),
      'die verworfene 2008er Vorlage muss protokolliert sein, nicht verschwiegen');
  });

  await ta('BBBY — 0 PER REGEL, ohne ein einziges Dokument zu lesen', async () => {
    // Der Abrufer wirft bei jedem Aufruf: gaebe es hier eine Extraktion, waere
    // dieser Test rot. Die Null kommt aus Item 1.03 + 3.03, nicht aus Text.
    const r = await R.resolveExitEvent(886158, '2023-01-01', '2023-12-31',
      { submissionsDir: SUBS, fetchDoc: forbiddenFetch });
    assert.strictEqual(r.eventType, R.EventType.INSOLVENCY);
    assert.strictEqual(r.terminalValue, 0);
    assert.strictEqual(r.valueBasis, R.ValueBasis.INSOLVENCY_ZERO_BY_RULE);
    assert.strictEqual(r.eventDate, '2023-09-29');
    assert.ok(evidenceHas(r, '0001193125-23-247428'), '8-K 2023-09-29 (1.03+3.03) fehlt im Beleg');
    assert.ok(evidenceHas(r, '0001354457-23-000478'), '25-NSE 2023-07-10 fehlt im Beleg');
  });

  await ta('XLNX — Aktientausch: Verhaeltnis woertlich, KEIN Preis', async () => {
    const r = await R.resolveExitEvent(743988, '2022-01-01', '2022-12-31', opts());
    assert.strictEqual(r.eventType, R.EventType.MERGER);
    assert.strictEqual(r.terminalValue, null, 'ein Aktientausch darf NIE einen Terminalwert tragen');
    assert.strictEqual(r.valueBasis, R.ValueBasis.STOCK_NOT_DETERMINABLE);
    assert.strictEqual(r.exchangeRatio, '1.7234');
    assert.ok(/1\.7234 shares/.test(r.exchangeRatioVerbatim), 'Verhaeltnis muss woertlich mitgefuehrt sein');
    assert.strictEqual(r.unresolvedReason, R.Unresolved.STOCK_MERGER);
    // Die Falle explizit: 0,01 ist der Nennwert und darf nirgends auftauchen.
    assert.notStrictEqual(r.terminalValue, 0.01);
    assert.ok(r.confidence >= 0.9, 'das EREIGNIS ist sicher …');
    assert.strictEqual(r.terminalValueConfidence, 0, '… der WERT ist es nie');
  });

  await ta('FRC — ehrliches NICHT-AUFLOESBAR statt "Ereignis unbekannt"', async () => {
    const r = await R.resolveExitEvent(1132979, '2023-01-01', '2023-12-31',
      { submissionsDir: SUBS, fetchDoc: forbiddenFetch });
    assert.strictEqual(r.eventType, R.EventType.UNRESOLVED);
    assert.strictEqual(r.terminalValue, null);
    assert.strictEqual(r.unresolvedReason, R.Unresolved.NO_ISSUER_DOCS);
    assert.strictEqual(r.confidence, 0);
    assert.deepStrictEqual(r.evidence, [], 'ohne Emittenten-Dokumente gibt es keinen Beleg zu zeigen');
  });

  await ta('ATVI 2008 — Kontrollfall: Item 2.01 OHNE Form 25 ist KEIN Terminal-Ereignis', async () => {
    // 2008 fusionierte Vivendi Games IN Activision hinein; ATVI blieb notiert.
    // Ein Aufloeser, der Item 2.01 als Ausstieg liest, erfindet hier ein Ereignis.
    const r = await R.resolveExitEvent(718877, '2008-01-01', '2008-12-31',
      { submissionsDir: SUBS, fetchDoc: forbiddenFetch });
    assert.strictEqual(r.eventType, R.EventType.UNRESOLVED);
    assert.strictEqual(r.unresolvedReason, R.Unresolved.NO_ANCHOR);
    assert.strictEqual(r.terminalValue, null);
  });
}

// ── (B) FALLE 1 — SLIM_CACHE_GUARD ───────────────────────────────────────────

async function testSlimCacheGuard() {
  await ta('Falle 1 — Schlank-Cache wirft laut statt still "0 Einreichungen"', async () => {
    await assert.rejects(() => R.loadFilings(72903, { submissionsDir: SLIM }), /SLIM_CACHE_GUARD/,
      'ein Objekt ohne filings.recent MUSS werfen');
  });

  await ta('Falle 1 — Gegenprobe: ohne den Waechter waere Xcel Energy "aktenlos"', async () => {
    // Genau die Fassung, die im Machbarkeitslauf live zugeschlagen hat.
    const slim = JSON.parse(fs.readFileSync(path.join(SLIM, entryName(72903)), 'utf8'));
    assert.ok(slim.cik && slim.tickers, 'die Fixture ist die echte Schlank-Cache-Form');
    assert.strictEqual(slim.filings, undefined, 'sie traegt KEIN filings-Feld');
    const ohneWaechter = R.toRows(slim.filings && slim.filings.recent, slim.cik);
    assert.deepStrictEqual(ohneWaechter, [], 'ungewaechtert ist das Ergebnis eine stille Null — genau der Schaden');
  });

  await ta('Falle 1 — Gegenrichtung: der Voll-Bestand geht durch', async () => {
    const { rows } = await R.loadFilings(1418091, { submissionsDir: SUBS });
    assert.ok(rows.length > 20, 'TWTR muss Zeilen liefern, der Waechter ist kein Generalriegel');
  });
}

// ── (B) FALLE 2 — ARCHIVE_BLOCK_GUARD (filings.recent ~1000-Kappe) ───────────

/** Quelle, die den Archivblock verschweigt — die ungeladene Kappe. */
function sourceOhneBlock() {
  return {
    readEntry(name) {
      if (/-submissions-\d+\.json$/.test(name)) return null;
      const p = path.join(SUBS, name);
      return fs.existsSync(p) ? fs.readFileSync(p) : null;
    },
    close() {},
  };
}

async function testArchiveBlockGuard() {
  await ta('Falle 2 — deklarierter, aber nicht lesbarer Archivblock wirft', async () => {
    await assert.rejects(() => R.loadFilings(718877, { source: sourceOhneBlock() }),
      /ARCHIVE_BLOCK_GUARD/, 'ein fehlender Block ist ein Fehler, keine Teilmessung');
  });

  await ta('Falle 2 — der Block traegt Belastendes: die Vivendi-Vorlage liegt NUR dort', async () => {
    const { rows, blocksConsulted } = await R.loadFilings(718877, { submissionsDir: SUBS });
    assert.strictEqual(blocksConsulted.length, 1, 'ATVI (2.043 Einreichungen) hat genau einen Block');
    const vivendi = rows.find((r) => r.accessionNumber === '0001047469-08-007235');
    assert.ok(vivendi, 'die DEFM14A von 2008 muss nach dem Nachladen sichtbar sein');
    assert.strictEqual(vivendi.form, 'DEFM14A');
    assert.strictEqual(vivendi.filingDate, '2008-06-06');
    // … und im recent-Block ist sie NICHT: die Kappe ist real, nicht theoretisch.
    const nurRecent = JSON.parse(fs.readFileSync(path.join(SUBS, entryName(718877)), 'utf8'));
    assert.ok(!nurRecent.filings.recent.accessionNumber.includes('0001047469-08-007235'),
      'ungewaechtert (nur filings.recent) waere die Vorlage von 2008 unsichtbar');
  });

  await ta('Falle 2 — Gegenrichtung: ein CIK ohne Bloecke laeuft ohne Nachladen', async () => {
    const { blocksDeclared, blocksConsulted } = await R.loadFilings(1132979, { submissionsDir: SUBS });
    assert.strictEqual(blocksDeclared, 0);
    assert.strictEqual(blocksConsulted.length, 0);
  });
}

// ── (B) FALLE 3 — EVENT_ANCHOR_GUARD (Anti-Vivendi) ─────────────────────────

async function testAntiVivendi() {
  const { rows } = await R.loadFilings(718877, { submissionsDir: SUBS });
  const EVENT = '2023-10-13';

  await ta('Falle 3 — die Wert-Vorlage wird ans EREIGNIS gebunden, nicht an die Array-Reihenfolge', async () => {
    const tpl = R.pickValueTemplate(rows, EVENT);
    assert.strictEqual(tpl.candidates.length, 2, 'beide DEFM14A muessen zur Wahl stehen — sonst ist der Test hohl');
    assert.strictEqual(tpl.chosen.filingDate, '2022-03-21');
    assert.strictEqual(tpl.chosen.accessionNumber, '0001104659-22-036155');
  });

  await ta('Falle 3 — Gegenprobe: "erste passende Vorlage" griffe die von 2008', async () => {
    // Die ungewaechterte Fassung: erste im (datums-sortierten) Array.
    const naiv = rows.filter((r) => R.VALUE_TEMPLATE_FORMS.includes(r.form))[0];
    assert.strictEqual(naiv.filingDate, '2008-06-06', 'first-match landet auf dem Vivendi-Deal');
    assert.strictEqual(naiv.accessionNumber, '0001047469-08-007235');
    // Und das ist der konkrete Schaden: in genau diesem Dokument ist 27,50 der
    // haeufigkeits-dominante Je-Aktie-Preis (64 Treffer gegen 4 fuer den naechsten).
    const dok = fs.readFileSync(path.join(DOCS, '000104746908007235_a2186151zdefm14a.txt'), 'utf8');
    const c = new Map();
    const re = /\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)\s*per\s+share\b/gi;
    let m;
    while ((m = re.exec(R.plainText(dok))) !== null) {
      const v = Number(m[1].replace(/,/g, ''));
      c.set(v, (c.get(v) || 0) + 1);
    }
    const top = [...c.entries()].sort((a, b) => b[1] - a[1])[0];
    assert.strictEqual(top[0], 27.50, 'der falsche Anker liefert einen sauber formatierten, um 20 Jahre falschen Wert');
    assert.ok(top[1] > 10, 'und er sieht mit ' + top[1] + ' Treffern voellig plausibel aus');
  });

  await ta('Falle 3 — zweite, unabhaengige Sperre: das Rueckblickfenster', async () => {
    // Auch wenn die Sortierung je kippt: 2008 liegt 5.608 Tage vor dem Ereignis.
    const tpl = R.pickValueTemplate(rows, EVENT, { lookbackDays: R.TEMPLATE_LOOKBACK_DAYS });
    assert.ok(tpl.chosen.filingDate >= '2020-10-12', 'Kandidat muss im Rueckblickfenster liegen');
    const eng = R.pickValueTemplate(rows, EVENT, { lookbackDays: 30 });
    assert.strictEqual(eng.chosen, null, 'ausserhalb des Fensters gibt es KEINE Vorlage — nicht die naechstbeste');
  });

  await ta('Falle 3 — Gegenrichtung: eine echte Vorlage vor dem Ereignis wird gefunden', async () => {
    const twtr = (await R.loadFilings(1418091, { submissionsDir: SUBS })).rows;
    const tpl = R.pickValueTemplate(twtr, '2022-10-31');
    assert.strictEqual(tpl.chosen.filingDate, '2022-07-26', 'der Waechter darf den Normalfall nicht abwuergen');
  });

  await ta('Falle 3 — der Anker selbst ist die JUENGSTE Form 25 im Fenster, nicht die aelteste', async () => {
    const kunst = [
      { form: '25-NSE', filingDate: '2023-02-01', accessionNumber: 'alt', items: '' },
      { form: '25-NSE', filingDate: '2023-07-10', accessionNumber: 'neu', items: '' },
    ];
    assert.strictEqual(R.findAnchor(kunst, '2023-01-01', '2023-12-31').row.accessionNumber, 'neu');
  });
}

// ── (B) FALLE 4 — ISSUER_DOCS_GUARD (FRC-Klasse) ────────────────────────────

async function testIssuerDocsGuard() {
  await ta('Falle 4 — nur Dritt-Einreichungen zaehlen NICHT als Emittenten-Doku', async () => {
    const { rows } = await R.loadFilings(1132979, { submissionsDir: SUBS });
    assert.ok(rows.length > 0, 'die 43 Dritt-Einreichungen sind da …');
    assert.strictEqual(R.hasIssuerDocs(rows), false, '… und trotzdem berichtet der Emittent nicht');
    const formen = [...new Set(rows.map((r) => r.form))].sort();
    assert.deepStrictEqual(formen, ['40-6B/A', 'SC 13G', 'SC 13G/A']);
  });

  await ta('Falle 4 — Gegenprobe: "es gibt Einreichungen" haette hier ein Ereignis gesucht', async () => {
    const { rows } = await R.loadFilings(1132979, { submissionsDir: SUBS });
    // Die ungewaechterte Fassung fragte nur nach rows.length > 0 und lieferte
    // dann "Ereignis unbekannt" — eine Messaussage, wo eine Strukturaussage hingehoert.
    assert.ok(rows.length > 0 && !R.hasIssuerDocs(rows),
      'genau diese Kombination trennt "nichts gefunden" von "kann strukturell nichts finden"');
  });

  await ta('Falle 4 — Gegenrichtung: normale Emittenten passieren', async () => {
    for (const cik of [1418091, 718877, 886158, 743988]) {
      // eslint-disable-next-line no-await-in-loop
      assert.strictEqual(R.hasIssuerDocs((await R.loadFilings(cik, { submissionsDir: SUBS })).rows), true, 'CIK ' + cik);
    }
  });
}

// ── PAR_VALUE_GUARD + DOMINANCE_GUARD ───────────────────────────────────────

function testPreisWaechter() {
  t('PAR_VALUE_GUARD — der Nennwert 0,01 wird verworfen und der Wurf gezaehlt', () => {
    const xlnx = fs.readFileSync(path.join(DOCS, '000110465922021762_tm226258d1_8k.txt'), 'utf8');
    const p = R.extractCashPrice(xlnx);
    assert.strictEqual(p.value, null, 'aus dem Xilinx-8-K darf KEIN Preis kommen');
    assert.ok(p.parRejected >= 1, 'der Nennwert-Wurf muss sichtbar sein, nicht still (war: ' + p.parRejected + ')');
    // Gegenprobe: ohne den Waechter gewaenne genau 0,01.
    const ohne = new Map();
    let m;
    const re = /\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)\s*per\s+share\b/gi;
    while ((m = re.exec(R.plainText(xlnx))) !== null) {
      const v = Number(m[1]);
      ohne.set(v, (ohne.get(v) || 0) + 1);
    }
    assert.strictEqual([...ohne.entries()].sort((a, b) => b[1] - a[1])[0][0], 0.01,
      'ungewaechtert waere der Terminalwert 1 Cent — zuversichtlich und falsch');
  });

  t('PAR_VALUE_GUARD — Gegenrichtung: der echte Barpreis geht durch', () => {
    const twtr = fs.readFileSync(path.join(DOCS, '000119312522272772_d411753d8k.txt'), 'utf8');
    assert.strictEqual(R.extractCashPrice(twtr).value, 54.20);
  });

  t('UNIT_SCALE_GUARD — ein Aggregat ist KEIN Je-Aktie-Preis', () => {
    // Selbstfund am 5,1-MB-Vivendi-Dokument: "aggregate purchase price of
    // approximately $1.731 billion in cash" passt auf die Gegenleistungs-Formel
    // und haette 1,731 als Terminalwert je Aktie geliefert. Die Dominanz allein
    // haette das NICHT gefangen — der Betrag war der haeufigste seiner Stufe.
    const aggregat = 'purchased shares for an aggregate purchase price of approximately '
      + '$1.731 billion in cash. The aggregate consideration of $1.731 billion in cash '
      + 'was funded from available cash. A further $1.731 billion in cash followed. ';
    const p = R.extractCashPrice(aggregat);
    assert.strictEqual(p.value, null, 'Milliardenbetraege sind keine Je-Aktie-Preise');
    assert.ok(p.scaleRejected >= 3, 'die Wuerfe muessen sichtbar sein (war: ' + p.scaleRejected + ')');
    assert.strictEqual(R.isAggregateAmount(' billion in cash', 'price of approximately '), true);
    assert.strictEqual(R.isAggregateAmount(' in cash for each of the 780 million shares', 'receive '), false,
      'ein Skalenwort WEITER HINTEN im Satz darf einen Je-Aktie-Preis nicht entwerten');
    assert.strictEqual(R.isAggregateAmount(' in cash, without interest', 'right to receive '), false,
      'die echte Gegenleistungs-Formel darf NICHT als Aggregat gelten');
  });

  t('UNIT_SCALE_GUARD — Gegenrichtung: TWTR und ATVI bleiben unberuehrt', () => {
    const twtr = fs.readFileSync(path.join(DOCS, '000119312522272772_d411753d8k.txt'), 'utf8');
    const atvi = fs.readFileSync(path.join(DOCS, '000110465923108985_tm2328253d1_8k.txt'), 'utf8');
    assert.strictEqual(R.extractCashPrice(twtr).value, 54.20);
    assert.strictEqual(R.extractCashPrice(atvi).value, 95.00);
  });

  t('DOMINANCE_GUARD — ohne klare Dominanz lieber kein Wert als ein plausibler', () => {
    const patt = 'converted into the right to receive $40.00 in cash. '
      + 'Alternatively holders receive $50.00 in cash under the other agreement. ';
    assert.strictEqual(R.extractCashPrice(patt).value, null, 'Gleichstand -> NICHT bestimmbar');
    assert.strictEqual(R.extractCashPrice(patt + 'each share converted into $40.00 in cash. '
      + 'the $40.00 in cash consideration').value, 40, 'klare Dominanz -> Wert');
  });

  t('Aktientausch-Erkennung haengt an der GEGENLEISTUNG, nicht an der Wortmarke', () => {
    // Die ATVI-Barfusion nennt "Exchange Ratio" dreimal (Umrechnung von
    // Mitarbeiter-Aktienrechten). Wer daran haengt, verliert 95,00 an ein NULL.
    const atvi = fs.readFileSync(path.join(DOCS, '000110465923108985_tm2328253d1_8k.txt'), 'utf8');
    assert.ok(/Exchange Ratio/.test(atvi), 'die Wortmarke steht wirklich drin …');
    assert.strictEqual(R.detectExchangeRatio(R.plainText(atvi)), null, '… loest aber KEINEN Tausch aus');
    const xlnx = fs.readFileSync(path.join(DOCS, '000110465922021762_tm226258d1_8k.txt'), 'utf8');
    assert.strictEqual(R.detectExchangeRatio(R.plainText(xlnx)).ratio, '1.7234');
  });
}

// ── Ereignis-Ebene: strukturierte Felder, nie Text ──────────────────────────

function testEreignisNurStrukturiert() {
  const anchor = { row: { form: '25-NSE', filingDate: '2023-07-10', accessionNumber: 'a', items: '' }, strength: 'strong' };
  const basis = [
    { form: '8-K', filingDate: '2023-04-24', accessionNumber: 'x', items: '1.01,1.03,2.03' },
    { form: '8-K', filingDate: '2023-09-29', accessionNumber: 'y', items: '1.03,3.03,5.02' },
  ];

  t('Ereignistyp ignoriert Dokumenttext vollstaendig', () => {
    const vergiftet = basis.map((r) => Object.assign({}, r, {
      text: 'each share converted into the right to receive $999.00 in cash',
      primaryDocument: 'merger-at-999-per-share.htm',
    }));
    const a = R.classifyEvent(basis, anchor);
    const b = R.classifyEvent(vergiftet, anchor);
    assert.strictEqual(b.eventType, a.eventType);
    assert.strictEqual(b.eventDate, a.eventDate);
    assert.strictEqual(b.eventType, R.EventType.INSOLVENCY);
  });

  t('Insolvenz schlaegt Fusion am selben Anker', () => {
    const gemischt = basis.concat([{ form: '8-K', filingDate: '2023-08-01', accessionNumber: 'z', items: '2.01,9.01' }]);
    assert.strictEqual(R.classifyEvent(gemischt, anchor).eventType, R.EventType.INSOLVENCY,
      'ein Item 2.01 im Verfahren ist ein Asset-Verkauf, kein Ausstiegspreis');
  });

  t('Item 1.03 OHNE 3.03: Verfahren belegt, Wert bleibt OFFEN (keine Null auf Verdacht)', () => {
    const nurPetition = [{ form: '8-K', filingDate: '2023-04-24', accessionNumber: 'x', items: '1.01,1.03,2.03' }];
    const c = R.classifyEvent(nurPetition, anchor);
    assert.strictEqual(c.eventType, R.EventType.INSOLVENCY);
    assert.strictEqual(c.planEffective, null, 'ohne 3.03 gibt es keinen Plan-Wirksamkeits-Beleg');
  });

  t('Form 25 allein ist KEIN Todes-Label', () => {
    // SMCI traegt 25-NSE @ 2019-03-12 und lebt (Auflage aus dem D2-Strang).
    const c = R.classifyEvent([{ form: '8-K', filingDate: '2023-07-01', accessionNumber: 'q', items: '3.01' }], anchor);
    assert.strictEqual(c.eventType, R.EventType.DELISTING_ONLY);
  });

  t('Ereignisfenster deckt die reale Streuung um den Anker', () => {
    // BBBY: Insolvenz-8-K 77 Tage VOR, Plan-8-K 81 Tage NACH der Form 25.
    assert.ok(R.EVENT_WINDOW_DAYS >= 90, 'zu eng gesetzt faellt der Beleg der Null-Regel weg');
    const weit = [{ form: '8-K', filingDate: '2022-01-01', accessionNumber: 'w', items: '2.01' }];
    assert.strictEqual(R.classifyEvent(weit, anchor).eventType, R.EventType.DELISTING_ONLY,
      'ein 8-K 1,5 Jahre daneben gehoert NICHT zum Ereignis');
  });
}

// ── SOURCE_AGREEMENT_GUARD ──────────────────────────────────────────────────

async function testQuellenkonflikt() {
  await ta('Widersprechen sich 8-K und verankerte Vorlage, wird NICHT gewaehlt', async () => {
    const luegner = async (_cik, acc) => {
      if (acc === '0001193125-22-272772') return 'converted into the right to receive $54.20 in cash, without interest';
      return 'you will be entitled to receive $61.00 in cash for each share';
    };
    const r = await R.resolveExitEvent(1418091, '2022-01-01', '2022-12-31',
      { submissionsDir: SUBS, fetchDoc: luegner });
    assert.strictEqual(r.terminalValue, null);
    assert.strictEqual(r.unresolvedReason, R.Unresolved.PRICE_CONFLICT);
  });

  await ta('Gegenrichtung: stimmen beide ueberein, steigt die Konfidenz', async () => {
    const r = await R.resolveExitEvent(1418091, '2022-01-01', '2022-12-31', opts());
    assert.strictEqual(r.valueBasis, R.ValueBasis.CASH_FROM_BOTH);
    assert.ok(r.confidence > 0.9);
  });
}

// ── Schema-Vertrag ──────────────────────────────────────────────────────────

async function testSchema() {
  const PFLICHT = ['cik', 'eventType', 'eventDate', 'terminalValue', 'valueBasis', 'evidence', 'confidence'];
  for (const [cik, from, to] of [[1418091, '2022-01-01', '2022-12-31'], [886158, '2023-01-01', '2023-12-31'],
    [743988, '2022-01-01', '2022-12-31'], [1132979, '2023-01-01', '2023-12-31']]) {
    // eslint-disable-next-line no-await-in-loop
    await ta('Schema vollstaendig fuer CIK ' + cik, async () => {
      const r = await R.resolveExitEvent(cik, from, to, { submissionsDir: SUBS, fetchDoc });
      for (const k of PFLICHT) assert.ok(k in r, 'Pflichtfeld fehlt: ' + k);
      assert.ok(Array.isArray(r.evidence));
      for (const e of r.evidence) {
        assert.ok('accession' in e && 'doc' in e, 'jeder Beleg traegt Accession UND Dokument');
      }
      assert.ok(r.terminalValue === null || Number.isFinite(r.terminalValue));
      assert.ok(r.confidence >= 0 && r.confidence <= 1);
      if (r.terminalValue === null && r.valueBasis !== R.ValueBasis.INSOLVENCY_ZERO_BY_RULE) {
        assert.ok(r.unresolvedReason, 'kein Wert ohne benannten Grund — das ist der ganze Punkt');
      }
    });
  }
}

// ── (D) Waechter aus dem Review-Durchgang ───────────────────────────────────
// Jeder Punkt hier wurde ZUERST reproduziert und dann gefixt; der Test haelt
// die Reproduktion fest, damit der Fix nicht wieder wegdriftet.

async function testReviewWaechter() {
  await ta('PATH_GUARD — ein Blockname aus ferngeliefertem JSON darf nie in einen Pfad', async () => {
    // Reproduziert: {"name":"../GEHEIM.json"} wurde GELESEN und der Block galt
    // als konsultiert. Der Name kommt aus fremdem JSON, nie vom Aufrufer.
    // Die Quelle liefert den Ausbruchspfad BEREITWILLIG aus — sie simuliert ein
    // Dateisystem, in dem der Traversal gelingt. Ohne Waechter laeuft loadFilings
    // damit sauber durch; NUR der Waechter kann hier noch werfen.
    let ausbruchGelesen = false;
    const giftig = {
      readEntry(name) {
        if (/^CIK\d{10}\.json$/.test(name)) {
          return Buffer.from(JSON.stringify({ cik: 42, name: 'X', filings: {
            recent: { form: ['8-K'], filingDate: ['2023-01-01'], accessionNumber: ['a'], primaryDocument: ['d.htm'], items: ['2.01'] },
            files: [{ name: '../../GEHEIM.json', filingFrom: '2000-01-01', filingTo: '2001-01-01', filingCount: 1 }] } }));
        }
        ausbruchGelesen = true;
        return Buffer.from(JSON.stringify({ form: [], filingDate: [], accessionNumber: [] }));
      },
      close() {},
    };
    // Auf die konkrete Waechter-Meldung geprueft, nicht auf das Wort PATH_GUARD:
    // eine Test-eigene Fehlermeldung, die dasselbe Wort traegt, wuerde den Test
    // sonst selbst gruen faerben, egal ob der Waechter existiert.
    await assert.rejects(() => R.loadFilings(42, { source: giftig }),
      /unzulaessiger submissions-Eintragsname/);
    assert.strictEqual(ausbruchGelesen, false, 'der Ausbruchspfad darf gar nicht erst gelesen werden');
  });

  t('PATH_GUARD — auch Dokumentname und Accession, aber echte SEC-Pfade bleiben gueltig', () => {
    // Form 25 traegt REGULAER einen Schraegstrich — der darf nicht mitverboten werden.
    assert.strictEqual(R.edgarDocUrl(886158, '0001354457-23-000478', 'xslF25X02/primary_doc.xml'),
      'https://www.sec.gov/Archives/edgar/data/886158/000135445723000478/xslF25X02/primary_doc.xml');
    assert.throws(() => R.edgarDocUrl(1, '0001354457-23-000478', '../../../etc/passwd'), /PATH_GUARD/);
    assert.throws(() => R.edgarDocUrl(1, '../../evil', 'd.htm'), /PATH_GUARD/);
  });

  await ta('ARCHIVE_BLOCK_GUARD — ein lesbarer Block der FALSCHEN Form ist auch ein Fehler', async () => {
    // Reproduziert: ein Block mit {"error":"Not Found"} parste, lieferte 0 Zeilen
    // und galt als konsultiert — obwohl 900 Einreichungen deklariert waren.
    const kaputt = {
      readEntry(name) {
        if (/^CIK\d{10}\.json$/.test(name)) {
          return Buffer.from(JSON.stringify({ cik: 43, name: 'Y', filings: {
            recent: { form: ['8-K'], filingDate: ['2023-01-01'], accessionNumber: ['a'], primaryDocument: ['d.htm'], items: ['2.01'] },
            files: [{ name: 'CIK0000000043-submissions-001.json', filingFrom: '2000-01-01', filingTo: '2001-01-01', filingCount: 900 }] } }));
        }
        return Buffer.from('{"error":"Not Found"}');
      },
      close() {},
    };
    await assert.rejects(() => R.loadFilings(43, { source: kaputt }), /ARCHIVE_BLOCK_GUARD/);
  });

  t('Aktientausch — Singular und eine Nachkommastelle werden erkannt', () => {
    // Beide Varianten fielen durch und landeten damit in der Preis-Extraktion:
    // dieselbe Fehlerklasse wie die XLNX-Nennwert-Falle, nur ueber die Formulierung.
    const satz = (s) => 'each share was converted into the right to receive ' + s + ' of Parent common stock';
    assert.strictEqual(R.detectExchangeRatio(satz('0.6323 of a share')).ratio, '0.6323', 'Singular');
    assert.strictEqual(R.detectExchangeRatio(satz('1.5 shares')).ratio, '1.5', 'eine Nachkommastelle');
    assert.strictEqual(R.detectExchangeRatio(satz('0.5 shares')).ratio, '0.5', 'Verhaeltnis unter 1');
    assert.strictEqual(R.detectExchangeRatio(satz('1.7234 shares')).ratio, '1.7234', 'der XLNX-Fall bleibt');
  });

  t('IMPLIED_VALUE_GUARD — Fairness-Opinion-Bewertung ist keine Gegenleistung', () => {
    // "implied a value of $X per share" steht nachweislich im echten TWTR-DEFM14A
    // und wiederholt sich oft genug, um die Dominanz zu gewinnen.
    const boiler = 'the analysis implied a value of $120.00 per share. A second approach '
      + 'implied a value of $120.00 per share. A third implied a value of $120.00 per share.';
    assert.strictEqual(R.extractCashPrice(boiler).value, null);
    const echt = fs.readFileSync(path.join(DOCS, '000119312522202163_d283119ddefm14a.txt'), 'utf8');
    assert.ok(/impl(?:ied|ies)[^.]{0,40}value/i.test(echt), 'die Formel steht wirklich in echten Vorlagen');
    assert.strictEqual(R.extractCashPrice(echt).value, 54.20, 'und der echte Preis ueberlebt den Waechter');
  });

  t('UNIT_SCALE_GUARD — "aggregate … per share" ist ein ECHTER Je-Aktie-Preis', () => {
    // Eine Rueckwaertssuche nach "aggregate" stand kurz im Waechter und verwarf
    // genau diese Formulierung. Sie ist wieder raus; das Skalenwort genuegt.
    const s = 'the aggregate merger consideration per share of $54.20 in cash was paid. '
      + 'aggregate merger consideration per share of $54.20 in cash. aggregate per share of $54.20 in cash.';
    assert.strictEqual(R.extractCashPrice(s).value, 54.20);
  });

  await ta('Ein AUSGEFALLENER Quervergleich ist nicht dasselbe wie keiner', async () => {
    // Reproduziert: ein 503 auf die Vorlage lieferte Wert 54,20 bei Konfidenz 0,9 —
    // ununterscheidbar vom sauberen Einzelquellen-Fall, ohne jede Spur.
    const echt = R.makeDirFetcher(DOCS);
    const flaky = async (cik, acc, doc) => {
      if (acc === '0001193125-22-202163') throw new Error('HTTP 503 (nicht wiederholbar)');
      return echt(cik, acc, doc);
    };
    const r = await R.resolveExitEvent(1418091, '2022-01-01', '2022-12-31', { submissionsDir: SUBS, fetchDoc: flaky });
    assert.strictEqual(r.terminalValue, 54.20, 'der 8-K-Pfad traegt weiter');
    assert.ok(r.crossCheckError, 'aber der Ausfall MUSS im Ergebnis stehen');
    assert.ok(r.confidence < 0.9, 'und Konfidenz kosten (war: ' + r.confidence + ')');
    assert.ok(/fehlgeschlagen/i.test(r.note || ''), 'mit lesbarer Begruendung');
  });

  await ta('WINDOW_GUARD — ein nicht nullgepolstertes Datum schneidet still falsch', async () => {
    assert.strictEqual('2022-01-15' >= '2022-1-1', false, 'der Zeichenketten-Vergleich ist der Mechanismus');
    for (const bad of ['2022-1-1', '20220101', '', null, '2022-13-45x']) {
      // eslint-disable-next-line no-await-in-loop
      await assert.rejects(() => R.resolveExitEvent(1418091, bad, '2022-12-31', opts()), /WINDOW_GUARD/,
        'from=' + JSON.stringify(bad));
    }
    await assert.rejects(() => R.resolveExitEvent(1418091, '2022-12-31', '2022-01-01', opts()), /WINDOW_GUARD/,
      'leeres Fenster');
  });

  await ta('Namenstrennung — fehlender Bestand ist NICHT die FRC-Klasse', async () => {
    // Beide hiessen ISSUER_DOCS_GUARD und waren im Log nicht trennbar:
    // "wir haben die Datei nicht" vs. "die Firma berichtet nicht an die SEC".
    const leer = { readEntry() { return null; }, close() {} };
    await assert.rejects(() => R.loadFilings(999999, { source: leer }), /SUBMISSIONS_NOT_FOUND/);
    // Und die echte FRC-Klasse traegt weiterhin IHREN Namen — die beiden duerfen
    // sich nicht wieder angleichen.
    const frc = await R.resolveExitEvent(1132979, '2023-01-01', '2023-12-31',
      { submissionsDir: SUBS, fetchDoc: forbiddenFetch });
    assert.strictEqual(frc.unresolvedReason, R.Unresolved.NO_ISSUER_DOCS);
  });

  await ta('Insolvenz-Null traegt die fehlende juristische Validierung maschinenlesbar', async () => {
    const r = await R.resolveExitEvent(886158, '2023-01-01', '2023-12-31',
      { submissionsDir: SUBS, fetchDoc: forbiddenFetch });
    assert.strictEqual(r.terminalValue, 0);
    assert.strictEqual(r.ruleValidated, false,
      'ein Konsument filtert auf Felder, nicht auf Fliesstext');
  });
}

async function main() {
  console.log('tests/exit-event-resolver.test.js');
  console.log(' (A) die fuenf Machbarkeits-Faelle');
  await testDieFuenfFaelle();
  console.log(' (B) die vier stillen Fallen, beide Richtungen');
  await testSlimCacheGuard();
  await testArchiveBlockGuard();
  await testAntiVivendi();
  await testIssuerDocsGuard();
  console.log(' (C) Wert-Regime und Schema');
  testPreisWaechter();
  testEreignisNurStrukturiert();
  await testQuellenkonflikt();
  console.log(' (D) Waechter aus dem Review-Durchgang');
  await testReviewWaechter();
  await testSchema();
  if (fails) { console.error('\n' + fails + ' WAECHTER ROT'); process.exit(1); }
  console.log('\nALLE EXIT-EVENT-WAECHTER GRUEN');
}

if (require.main === module) main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
module.exports = { main };
