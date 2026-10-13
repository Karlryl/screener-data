#!/usr/bin/env node
'use strict';
/**
 * Messung: Wie viele Firmen stehen MEHRFACH im selben Board, weil der Emittenten-Dedup
 * sie nicht als dieselbe Firma erkennt?
 *
 * WOFUER: Der Screener soll pro Unternehmen genau EIN Wertpapier ins Board lassen.
 * Zusammengefasst wird ausschliesslich ueber den Firmennamen (issuerKeyLoose in
 * src/scoring/score.js, benutzt von issuerDedupGroups). Schreibt eine Boerse den Namen
 * anders — "Eli Lilly and Company" gegen "Eli Lilly & Co." —, greift die Gruppierung
 * nicht und beide Beine landen im Board, oft direkt nebeneinander.
 *
 * Dieses Skript MISST das nur. Es repariert nichts und ist kein Gate: es ist die
 * Vorher/Nachher-Messlatte fuer den Dedup-Fix. Bauweise bewusst uebernommen von
 * scripts/probe-issuer-branchenkonflikt.js (in score.js als Vorbild dokumentiert):
 * read-only, gegen einen aufgezeichneten Bestand, Exit 0 auch bei Funden.
 *
 * ── DIE MESSMETHODE ─────────────────────────────────────────────────────────────
 * Zwei Board-Zeilen gehoeren zur selben Firma, wenn ihre FUNDAMENTALDATEN identisch
 * sind: pit.revenueQ UND pit.grossProfitQ Wert fuer Wert gleich. Das ist unabhaengig
 * vom Namen, von der Waehrung des Listings und vom Ticker-Suffix — genau die Achsen,
 * an denen der namensbasierte Dedup scheitert.
 *
 * ⚠ PFLICHT-AUFLAGE, NICHT VERHANDELBAR: mindestens vier endliche Umsatzquartale
 *   ungleich null. Ohne sie verschmelzen die Pre-Revenue-Biotechs — alle mit leeren
 *   Reihen, alle also "identisch" — zu einer einzigen Schein-Gruppe. Am Vintage
 *   2026-07-14 nachgemessen: ohne die Auflage entstehen dort Scheingruppen mit 183,
 *   70 und 8 voellig fremden Firmen. Das ist einmal passiert und darf nicht wieder
 *   passieren; der Waechter dagegen steht in tests/probe-dedup-fingerprint.test.js.
 *
 * ⚠ Die Marktwert-Naehe je Gruppe ist DIAGNOSE-AUSWEIS, NIE Filter. Am Vintage
 *   2026-08-19 liegt die grosse Mehrheit der Gruppen unter 25 % Abweichung; die
 *   Ausreisser sind echte A-/H-Aktien-Doppelnotierungen. Als Kriterium waere die
 *   Marktwert-Naehe FALSCH — sie wuerde ausgerechnet das Top-20-Paar
 *   1377.HK + 301377.SZ verfehlen.
 *
 * ── NUTZUNG ─────────────────────────────────────────────────────────────────────
 *   node scripts/probe-dedup-fingerprint.js 2026-08-19
 *   node scripts/probe-dedup-fingerprint.js 2026-07-14 2026-08-16 2026-08-19
 *   node scripts/probe-dedup-fingerprint.js --alle                  (Trend ueber alles)
 *   node scripts/probe-dedup-fingerprint.js 2026-08-19 --json       (JSON auf stdout)
 *   node scripts/probe-dedup-fingerprint.js --alle --json=mess.json (JSON in Datei)
 *
 * Ein Argument ist entweder ein Vintage-Datum (dann relativ zu board-history/) oder ein
 * Pfad auf ein Vintage-Verzeichnis.
 *
 * ⚠ 2026-07-14 bis 2026-07-18 tragen ein _ALTER-MASSSTAB.md: die Score-Definition hat
 *   sich seither geaendert. Fuer DIESE Messung stoert das nicht (der Fingerabdruck
 *   haengt an den Fundamentaldaten, nicht am Score), wohl aber fuer jeden Rang-Vergleich
 *   ueber diesen Bruch hinweg.
 */
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../lib/atomic-write.js');

// Aus der Aufgabenstellung, nicht frei gewaehlt — siehe PFLICHT-AUFLAGE oben.
const MIN_UMSATZQUARTALE = 4;
// "Top 20" ist die Zone, in der Karl ueberhaupt hinsieht; ein Doppelgaenger weiter unten
// verzerrt die Liste, einer hier oben verbrennt einen der 20 Plaetze.
const TOP_N = 20;
// Nur fuer die Ausweis-Spalte "wie weit liegen die Marktwerte auseinander" — kein Filter.
const MCAP_AUSWEIS_SCHWELLE = 0.25;

const BOARD_HISTORY = path.join(__dirname, '..', 'board-history');

/** Zahl der Quartale, die als echte Umsatzmeldung zaehlen: endlich und ungleich null. */
function endlicheQuartale(reihe) {
  if (!Array.isArray(reihe)) return 0;
  let n = 0;
  for (const x of reihe) if (Number.isFinite(x) && x !== 0) n++;
  return n;
}

/** Die PFLICHT-AUFLAGE. Zeilen darunter nehmen an der Gruppierung gar nicht erst teil. */
function istBelastbar(pit) {
  return !!pit && endlicheQuartale(pit.revenueQ) >= MIN_UMSATZQUARTALE;
}

/**
 * Der Fingerabdruck: Umsatz- UND Bruttogewinn-Reihe zusammen. Beide, weil eine einzelne
 * Reihe zufaellig uebereinstimmen kann (runde Zahlen, kurze Reihen); beide zusammen nicht.
 */
function fingerabdruck(pit) {
  return JSON.stringify(pit.revenueQ) + '|' + JSON.stringify(pit.grossProfitQ);
}

/**
 * Liest ein Vintage-Verzeichnis. Board-Dateien sind die JSONs mit .cohort — calibration.json
 * und regime.json haben keine und werden namentlich als uebersprungen ausgewiesen, damit
 * niemand raten muss, ob eine Datei fehlt oder absichtlich draussen ist.
 *
 * Kaputtes JSON wird NICHT verschluckt: ein nicht lesbares Board wuerde die Gruppenzahl
 * still zu niedrig machen — genau die Sorte Fehlmessung, die dieses Skript verhindern soll.
 */
function ladeVintage(dir) {
  if (!fs.existsSync(dir)) throw new Error('Vintage-Verzeichnis fehlt: ' + dir);
  const zeilen = [];
  const boards = [];
  const ohneKohorte = [];
  for (const datei of fs.readdirSync(dir).sort()) {
    if (!datei.endsWith('.json')) continue;
    const p = path.join(dir, datei);
    let j;
    try {
      j = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (err) {
      throw new Error('Board-Datei nicht lesbar: ' + p + ' — ' + err.message);
    }
    if (!j || !j.cohort) { ohneKohorte.push(datei); continue; }
    const board = j.board || datei.replace(/\.json$/, '');
    boards.push(board);
    for (const track of Object.keys(j.cohort)) {
      const liste = j.cohort[track];
      if (!Array.isArray(liste)) continue;
      for (const r of liste) {
        zeilen.push({ board, track, ticker: r.ticker, rank: r.rank, score: r.score, pit: r.pit || null });
      }
    }
  }
  return { zeilen, boards, ohneKohorte };
}

/**
 * Marktwert-Naehe einer Gruppe: (max - min) / max.
 * null, wenn nicht mindestens zwei Beine einen brauchbaren Wert haben.
 */
function mcapNaehe(beine) {
  const werte = beine.map((b) => b.pit && b.pit.marketCap).filter((m) => Number.isFinite(m) && m > 0);
  if (werte.length < 2) return null;
  const max = Math.max.apply(null, werte);
  const min = Math.min.apply(null, werte);
  return (max - min) / max;
}

/**
 * Die eigentliche Messung ueber eine Zeilenliste.
 * Gibt die Gruppen mit mindestens zwei Beinen zurueck, samt Diagnose je Gruppe.
 */
function messe(zeilen) {
  const belastbar = zeilen.filter((z) => istBelastbar(z.pit));
  const nachAbdruck = new Map();
  for (const z of belastbar) {
    const fp = fingerabdruck(z.pit);
    let g = nachAbdruck.get(fp);
    if (!g) { g = []; nachAbdruck.set(fp, g); }
    g.push(z);
  }

  const gruppen = [];
  for (const beine of nachAbdruck.values()) {
    if (beine.length < 2) continue;
    const sortiert = beine.slice().sort((a, b) => (a.rank || 0) - (b.rank || 0));
    const naehe = mcapNaehe(sortiert);
    // Top-20-Paar: mindestens zwei Beine derselben Board-LISTE (Board + Track, denn die
    // Raenge fangen je Track wieder bei 1 an) stehen beide in den Top 20.
    const proListe = new Map();
    for (const b of sortiert) {
      if (!Number.isFinite(b.rank) || b.rank > TOP_N) continue;
      const k = b.board + '|' + b.track;
      let v = proListe.get(k);
      if (!v) { v = []; proListe.set(k, v); }
      v.push(b);
    }
    const topPaare = [];
    for (const [k, v] of proListe) {
      if (v.length < 2) continue;
      topPaare.push({
        board: k.split('|')[0],
        track: k.split('|')[1],
        beine: v.map((b) => ({ ticker: b.ticker, rank: b.rank, score: b.score })),
      });
    }
    gruppen.push({
      umsatzquartale: endlicheQuartale(sortiert[0].pit.revenueQ),
      boards: Array.from(new Set(sortiert.map((b) => b.board))),
      beine: sortiert.map((b) => ({
        ticker: b.ticker, board: b.board, track: b.track, rank: b.rank, score: b.score,
        marketCap: (b.pit && Number.isFinite(b.pit.marketCap)) ? b.pit.marketCap : null,
      })),
      mcapNaehe: naehe,
      mcapAusweis: naehe === null ? 'ohne Marktwert' : (naehe < MCAP_AUSWEIS_SCHWELLE ? 'nah' : 'weit'),
      topPaare,
    });
  }
  // Stabile Ausgabe-Reihenfolge: bestplatziertes Bein zuerst, dann Ticker.
  gruppen.sort((a, b) => (a.beine[0].rank || 0) - (b.beine[0].rank || 0)
    || String(a.beine[0].ticker).localeCompare(String(b.beine[0].ticker)));
  return { gruppen, zeilenGesamt: zeilen.length, zeilenBelastbar: belastbar.length };
}

/** Ein Vintage messen und den Bericht bauen. */
function messeVintage(datum, dir) {
  const geladen = ladeVintage(dir);
  const gemessen = messe(geladen.zeilen);
  const gruppen = gemessen.gruppen;

  const jeBoard = {};
  const eintrag = (name) => (jeBoard[name] || (jeBoard[name] = { gruppen: 0, topPaare: 0 }));
  for (const b of geladen.boards) eintrag(b);
  for (const g of gruppen) {
    for (const b of g.boards) eintrag(b).gruppen++;
    for (const tp of g.topPaare) eintrag(tp.board).topPaare++;
  }

  const mitNaehe = gruppen.filter((g) => g.mcapNaehe !== null);
  return {
    datum,
    verzeichnis: dir,
    boards: geladen.boards.length,
    uebersprungen: geladen.ohneKohorte,
    zeilenGesamt: gemessen.zeilenGesamt,
    zeilenBelastbar: gemessen.zeilenBelastbar,
    gruppen: gruppen.length,
    beineGesamt: gruppen.reduce((s, g) => s + g.beine.length, 0),
    topPaare: gruppen.reduce((s, g) => s + g.topPaare.length, 0),
    mcapDiagnose: {
      mitMarktwert: mitNaehe.length,
      unterSchwelle: mitNaehe.filter((g) => g.mcapNaehe < MCAP_AUSWEIS_SCHWELLE).length,
      schwelle: MCAP_AUSWEIS_SCHWELLE,
    },
    jeBoard,
    gruppenDetail: gruppen,
  };
}

// ── Textbericht fuer Karl ─────────────────────────────────────────────────────
function prozent(x) { return (100 * x).toFixed(1).replace('.', ',') + ' %'; }

function textbericht(berichte) {
  const z = [];
  z.push('Doppelt gelistete Firmen im Board (Fingerabdruck: Umsatz- + Bruttogewinn-Reihe identisch,');
  z.push('mindestens ' + MIN_UMSATZQUARTALE + ' Umsatzquartale ungleich null).');
  for (const b of berichte) {
    z.push('');
    z.push('── ' + b.datum + ' ' + '─'.repeat(Math.max(0, 56 - b.datum.length)));
    z.push('  Board-Zeilen ......... ' + b.zeilenGesamt + ' (mit belastbarer Umsatzreihe: ' + b.zeilenBelastbar + ')');
    z.push('  Gruppen .............. ' + b.gruppen + '  (' + b.beineGesamt + ' Zeilen, also ' + (b.beineGesamt - b.gruppen) + ' Plaetze zu viel)');
    z.push('  davon in den Top ' + TOP_N + ' .. ' + b.topPaare);
    z.push('  Marktwert-Ausweis .... ' + b.mcapDiagnose.unterSchwelle + ' von ' + b.mcapDiagnose.mitMarktwert
      + ' Gruppen unter ' + prozent(b.mcapDiagnose.schwelle) + ' Abweichung (nur Diagnose, kein Filter)');
    if (b.uebersprungen.length) z.push('  ohne Kohorte (kein Board): ' + b.uebersprungen.join(', '));

    const topGruppen = b.gruppenDetail.filter((g) => g.topPaare.length);
    if (topGruppen.length) {
      z.push('  Paare in den Top ' + TOP_N + ':');
      for (const g of topGruppen) {
        for (const tp of g.topPaare) {
          const wer = tp.beine.map((x) => x.ticker + ' (Platz ' + x.rank + ')').join(' + ');
          const n = g.mcapNaehe === null ? 'ohne Marktwert' : 'Marktwert-Abstand ' + prozent(g.mcapNaehe);
          z.push('    ' + tp.board + (tp.track === 'profitable' ? '' : '/' + tp.track) + ': ' + wer + '  [' + n + ']');
        }
      }
    }
    const boardZeilen = Object.keys(b.jeBoard)
      .filter((k) => b.jeBoard[k].gruppen || b.jeBoard[k].topPaare)
      .sort((a, c) => b.jeBoard[c].gruppen - b.jeBoard[a].gruppen);
    if (boardZeilen.length) {
      z.push('  je Board:');
      for (const name of boardZeilen) {
        const v = b.jeBoard[name];
        z.push('    ' + name.padEnd(26) + String(v.gruppen).padStart(3) + ' Gruppen'
          + (v.topPaare ? ', davon ' + v.topPaare + ' in den Top ' + TOP_N : ''));
      }
    }
  }
  if (berichte.length > 1) {
    z.push('');
    z.push('Trend: ' + berichte.map((b) => b.datum + ' = ' + b.gruppen).join('  ->  '));
  }
  return z.join('\n');
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function vintageVerzeichnis(arg) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) return { datum: arg, dir: path.join(BOARD_HISTORY, arg) };
  return { datum: path.basename(arg.replace(/[\\/]+$/, '')), dir: arg };
}

function alleVintages() {
  return fs.readdirSync(BOARD_HISTORY)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && fs.statSync(path.join(BOARD_HISTORY, d)).isDirectory())
    .sort();
}

function main(argv) {
  const jsonArg = argv.find((a) => a === '--json' || a.startsWith('--json='));
  const rest = argv.filter((a) => a !== jsonArg);
  const ziele = rest.indexOf('--alle') >= 0 ? alleVintages() : rest.filter((a) => a.indexOf('--') !== 0);
  if (!ziele.length) {
    console.error('Nutzung: node scripts/probe-dedup-fingerprint.js <datum|pfad> [...] [--alle] [--json[=datei]]');
    return 1;
  }
  const berichte = ziele.map((a) => {
    const v = vintageVerzeichnis(a);
    return messeVintage(v.datum, v.dir);
  });

  console.log(textbericht(berichte));

  if (jsonArg) {
    const nutz = {
      erzeugtAm: new Date().toISOString(),
      methode: {
        fingerabdruck: 'pit.revenueQ + pit.grossProfitQ wertgleich',
        auflage: 'mindestens ' + MIN_UMSATZQUARTALE + ' endliche Umsatzquartale ungleich null',
        topN: TOP_N,
        mcapAusweisSchwelle: MCAP_AUSWEIS_SCHWELLE,
        mcapIstKeinFilter: true,
      },
      vintages: berichte,
    };
    const text = JSON.stringify(nutz, null, 2);
    const ziel = jsonArg.indexOf('--json=') === 0 ? jsonArg.slice('--json='.length) : null;
    // T204: atomar.
    if (ziel) { writeFileAtomic(ziel, text); console.log('\nJSON geschrieben: ' + ziel); }
    else console.log('\n' + text);
  }
  // Exit 0 auch bei Funden: Messwerkzeug, kein Gate — genau wie probe-issuer-branchenkonflikt.js.
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = {
  endlicheQuartale, istBelastbar, fingerabdruck, ladeVintage, mcapNaehe, messe, messeVintage,
  textbericht, main, MIN_UMSATZQUARTALE, TOP_N, MCAP_AUSWEIS_SCHWELLE,
};
