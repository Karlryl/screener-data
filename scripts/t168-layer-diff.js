#!/usr/bin/env node
'use strict';
/**
 * t168-layer-diff.js — Abnahme-Artefakt zum T168-Prioritaets-Dreh (ENTSCHIED 13).
 * ==============================================================================
 * Rechnet fuer JEDEN Namen beider secannual-Schichten die Umsatzreihe ZWEIMAL aus
 * DENSELBEN companyfacts — einmal mit der ALTEN REV_CONCEPTS-Reihenfolge (Including
 * vor Revenues), einmal mit der NEUEN (Revenues vor Including) — und meldet jede
 * Zelle, die sich unterscheidet. Weil beide Laeufe dieselbe Eingabe sehen, ist der
 * Diff AUSSCHLIESSLICH die Wirkung des Dreh; SEC-Neu-Einreichungen seit dem letzten
 * Build koennen ihn nicht faelschen (das ist der Unterschied zu einem Live-Rebuild).
 *
 * Kein Netzwerk. Liest nur den lokalen companyfacts-Cache; Namen ohne Cache werden
 * als NICHT PRUEFBAR gezaehlt, nie als "unveraendert" unterstellt.
 *
 * Run:  node scripts/t168-layer-diff.js [--cache <dir>] [--out <datei.md>]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { buildAnnual, waehleTaxonomie, TAXONOMIEN } = require(path.join(ROOT, 'merge-sec-xbrl.js'));

// Die ALTE Reihenfolge steht hier als LITERAL und wird nicht aus dem Modul abgeleitet —
// sonst wuerde der Vergleich mit jeder kuenftigen Listen-Aenderung stillschweigend
// mitwandern und der Diff waere nicht mehr der T168-Diff.
const ALT_REV = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'Revenues',
  'SalesRevenueNet',
];
const NEU_REV = TAXONOMIEN['us-gaap'].rev;

const LAYERS = [
  ['largecap', path.join(ROOT, 'external-data', 'sec-secannual.json')],
  ['smallcap', path.join(ROOT, 'external-data', 'sec-secannual-smallcap.json')],
];

function argOf(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

// Beide Laeufe stumm: annualRevUnion() loggt jeden Faktor-2-Konflikt: das sind bei
// 500 Namen tausende Zeilen, die den eigentlichen Diff unlesbar machen.
function stumm(fn) {
  const orig = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = orig; }
}

// Reihe unter EINER vorgegebenen Umsatz-Prioritaet. Getauscht wird nur die us-gaap-
// Umsatzliste — die ifrs-full-Liste (nur 'Revenue') ist von T168 nicht beruehrt, und
// die Taxonomie-Wahl selbst bleibt exakt die produktive (waehleTaxonomie).
function reiheMit(companyfacts, ticker, revOrder) {
  const facts = (companyfacts && companyfacts.facts) || {};
  const w = waehleTaxonomie(facts);
  const konzepte = w.name === 'us-gaap' ? Object.assign({}, w.konzepte, { rev: revOrder }) : w.konzepte;
  const a = stumm(() => buildAnnual(w.tax, facts.dei || {}, ticker, konzepte));
  const m = new Map();
  a._fys.forEach((fy, i) => m.set(fy, a.annualRev[i].value));
  return { taxonomie: w.name, rev: m };
}

function run() {
  // Mehrere Cache-Verzeichnisse mit ';' — der Repo-Cache deckt 127 der 502 Namen, der
  // Rest muss (gratis) von data.sec.gov nachgezogen werden und liegt dann woanders.
  const cacheDirs = argOf('--cache', path.join(ROOT, 'external-data', 'sec-xbrl')).split(';').filter(Boolean);
  const outFile = argOf('--out', null);
  const vorhanden = new Map(); // cik -> Dateipfad
  for (const d of cacheDirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.json') || f === '_manifest.json') continue;
      if (!vorhanden.has(f.slice(0, -5))) vorhanden.set(f.slice(0, -5), path.join(d, f));
    }
  }

  // Ein Tippfehler im --cache-Pfad lieferte bisher "Namen mit veraenderter Umsatzreihe: 0"
  // und EXITCODE 0 — ein Bericht, der nicht luegt, sondern leer ist, und dabei aussieht
  // wie ein Negativbefund. Eine leere Messmenge ist kein Ergebnis.
  if (!vorhanden.size) {
    console.error(`::error::t168-layer-diff: kein einziger companyfacts-Cache unter `
      + `${cacheDirs.join(';')} gefunden. Eine leere Messmenge ist KEIN Negativbefund.`);
    throw new Error(`t168-layer-diff: leere Cache-Menge (${cacheDirs.join(';')})`);
  }

  const zeilen = [];
  const geprueftNamen = new Set();
  const stat = { namen: 0, geprueft: 0, ohneCache: 0, kaputt: 0, bewegt: 0, zellen: 0 };
  for (const [layer, p] of LAYERS) {
    const store = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const tk of Object.keys(store).sort()) {
      stat.namen++;
      const cik = store[tk].cik;
      if (!cik || !vorhanden.has(cik)) { stat.ohneCache++; continue; }
      let cf;
      // "kein Cache" und "kaputter Cache" sind zwei verschiedene Befunde. Bei einem
      // ephemeren Runner-Cache ist Trunkierung die WAHRSCHEINLICHSTE Stoerung — sie
      // senkte bisher die Bewegungszahl still, waehrend der Bericht "kein Cache" behauptete.
      try { cf = JSON.parse(fs.readFileSync(vorhanden.get(cik), 'utf8')); }
      catch (e) {
        stat.kaputt++;
        console.error(`[t168-layer-diff] KAPUTTER Cache fuer ${tk} (CIK ${cik}): ${e.message}`);
        continue;
      }
      stat.geprueft++; geprueftNamen.add(tk);
      const alt = reiheMit(cf, tk, ALT_REV);
      const neu = reiheMit(cf, tk, NEU_REV);
      const fys = [...new Set([...alt.rev.keys(), ...neu.rev.keys()])].sort((a, b) => b - a);
      const deltas = [];
      for (const fy of fys) {
        const a = alt.rev.get(fy) === undefined ? null : alt.rev.get(fy);
        const n = neu.rev.get(fy) === undefined ? null : neu.rev.get(fy);
        if (a !== n) deltas.push({ fy, alt: a, neu: n });
      }
      if (deltas.length) {
        stat.bewegt++; stat.zellen += deltas.length;
        zeilen.push({ layer, tk, cik, taxonomie: neu.taxonomie, deltas });
      }
    }
  }
  return { stat, zeilen, cacheDirs, outFile, geprueftNamen, vorhanden };
}

// ── T174-Teil: was kostet die Ganzserien-Haertung an Abdeckung? ───────────────
// looseSanity() ist die Wache VOR dem Schreiben in die Schicht. Wird sie strenger,
// werden Namen nicht mehr aufgefrischt (sie behalten via Merge-Basis ihren Altstand).
// Diese Messung braucht BEIDE Seiten — SEC-Reihe und Yahoo-Snapshot — und laeuft
// deshalb nur, wenn die (git-ignorierten) Snapshot-Verzeichnisse mitgegeben werden.
const { extractSecSeries } = require(path.join(ROOT, 'merge-sec-xbrl.js'));
const V = (a) => (a || []).map((x) => (x && typeof x === 'object' ? x.value : x));
// Die ALTE Wache woertlich, wie sie bis 29.08.2026 stand — Literal aus demselben Grund
// wie ALT_REV oben: sie darf nicht mit der produktiven Fassung mitwandern.
function altSanity(yOpArr, sOpArr, yRevArr, sRevArr) {
  const first = (a) => { for (const v of V(a)) if (Number.isFinite(v)) return v; return null; };
  const yOp = first(yOpArr), sOp = first(sOpArr);
  if (yOp !== null && sOp !== null && Math.sign(yOp) !== Math.sign(sOp) && yOp !== 0 && sOp !== 0) return false;
  const yR = first(yRevArr), sR = first(sRevArr);
  if (yR !== null && sR !== null && yR > 0 && sR > 0 && Math.max(yR, sR) / Math.min(yR, sR) > 2) return false;
  const r = V(sRevArr).filter(Number.isFinite);
  for (let i = 1; i < r.length - 1; i++) if (r[i] > 0 && r[i] * 10 < r[i - 1] && r[i] * 10 < r[i + 1]) return false;
  return true;
}
// VERENGTE Variante (ENTSCHIED 14 Punkt 2): Umsatz-Skala ueber die ganze Reihe,
// OpInc-Vorzeichen bleibt beim neuesten Jahr. Auch dieses Literal steht hier und nicht
// in build-secannual.js — es wird GEMESSEN, bevor entschieden wird, ob es dorthin gehoert.
function nurUmsatzSanity(yOpArr, sOpArr, yRevArr, sRevArr) {
  const first = (a) => { for (const v of V(a)) if (Number.isFinite(v)) return v; return null; };
  const yOp = first(yOpArr), sOp = first(sOpArr);
  if (yOp !== null && sOp !== null && Math.sign(yOp) !== Math.sign(sOp) && yOp !== 0 && sOp !== 0) return false;
  const yR = first(yRevArr), sR = first(sRevArr);
  if (yR !== null && sR !== null && yR > 0 && sR > 0 && Math.max(yR, sR) / Math.min(yR, sR) > 2) return false;
  const y = V(yRevArr), s = V(sRevArr);
  for (let i = 0; i < Math.min(y.length, s.length); i++) {
    const a = y[i], b = s[i];
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 && Math.max(a, b) / Math.min(a, b) > 2) return false;
  }
  const r = V(sRevArr).filter(Number.isFinite);
  for (let i = 1; i < r.length - 1; i++) if (r[i] > 0 && r[i] * 10 < r[i - 1] && r[i] * 10 < r[i + 1]) return false;
  return true;
}

// Jahres-Versatz-Erkennung, mechanisch statt per Augenmass — dieselbe Methode wie die
// Erhebung vom 28.07. (merge-sec-xbrl.js:405-410): je Versatz -2..+2 zaehlen, wie viele
// Umsatz-Paare auf <2 % zusammenfallen.
//
// H5 (Nacht-Pruef-Sweep 29.08., Memo 30.08., ENTSCHIED 52) — DIE VERGABEREGEL:
// FEHLALARM ist ein ENTLASTUNGS-Urteil, und die Beweislast liegt bei der Entlastung.
// Die alte Fassung startete mit `hits = -1` und `best.off = 0`; bei null Treffern ueber
// alle fuenf Versaetze feuerte `0 > -1` beim ERSTEN Durchlauf und der Rueckgabewert war
// -2 — ein Versatz, den nichts belegte. Bei Gleichstand gewann ebenso der zuerst
// gesehene, also der aeusserste negative. `hits` verliess die Funktion zwar, wurde aber
// nie gedruckt: der Bericht schrieb allein aus `off !== 0` ein FEHLALARM. Genau die
// Signatur, die eine Umsatz-Skalen-Wache FANGEN soll (null passende Umsatzpaare),
// wurde so als Messfehler wegsortiert. Gegenregel M12 ("eine leere Messmenge ist KEIN
// Negativbefund") ist in dieser Datei bereits ratifiziert; dies ist derselbe Satz eine
// Ebene tiefer.
//
// Drei Ausgaenge, keiner aus dem anderen abgeleitet:
//   lage 'versatz'       ein Versatz != 0 ist BELEGT (eindeutige Spitze, >= MIN_PAARE
//                        Treffer; die strikte Dominanz gegenueber off = 0 folgt daraus,
//                        weil 0 dann nicht in der Spitze liegt) -> FEHLALARM zulaessig.
//   lage 'null-versatz'  off = 0 ist die eindeutige, belegte Spitze -> die positionsweise
//                        Pruefung ist ausgerichtet, der Kipp ist echt.
//   lage 'unaufgeloest'  zu wenige Treffer ODER Gleichstand -> KEINE Aussage. Nie
//                        FEHLALARM, nie Befund.
// `off` traegt nur im Fall 'versatz' eine Zahl; sonst das Sentinel VERSATZ_UNBESTIMMT
// (null) — nie wieder eine erfundene -2.
const VERSATZ_UNBESTIMMT = null;
// Ein einziges zusammenfallendes Umsatzjahr belegt keine Ausrichtung (jede Reihe trifft
// irgendwo einmal). Die Zahl stand bis zum 30.08. auch als REV_ALIGN_MIN_PAIRS in
// scripts/opinc-source-migrate.js; dort hat ENTSCHIED 52 (N1) die Schwelle durch VOLLE
// Fensterdeckung ersetzt, weil eine Teil-Deckung den Tausch des ganzen Fensters
// lizenzierte. Hier wird nicht getauscht, sondern nur ein Versatz BENANNT — deshalb
// bleibt die Mindestschwelle das richtige Werkzeug und steht seither eigenstaendig.
const VERSATZ_MIN_PAARE = 2;

function besterVersatz(yRevArr, sRevArr) {
  const y = V(yRevArr), s = V(sRevArr);
  const jeVersatz = new Map();
  for (let off = -2; off <= 2; off++) {
    let hits = 0;
    for (let i = 0; i < y.length; i++) {
      const a = y[i], b = s[i + off];
      if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) continue;
      if (Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) < 0.02) hits++;
    }
    jeVersatz.set(off, hits);
  }
  const maxHits = Math.max(...jeVersatz.values());
  const spitze = [...jeVersatz.keys()].filter((o) => jeVersatz.get(o) === maxHits);
  const einzig = spitze.length === 1 ? spitze[0] : null;
  const lage = (einzig === null || maxHits < VERSATZ_MIN_PAARE) ? 'unaufgeloest'
    : (einzig === 0 ? 'null-versatz' : 'versatz');
  return {
    off: lage === 'versatz' ? einzig : VERSATZ_UNBESTIMMT,
    hits: maxHits, hits0: jeVersatz.get(0), spitze, lage,
  };
}

// VOLLE Variante (Vorzeichen UND Umsatz ueber die ganze Reihe). Auch sie ist ein LITERAL
// und wird NICHT aus build-secannual.js importiert: der Bericht muss die Messung weiter
// belegen koennen, nachdem T174 aus dem PR geflogen ist (ENTSCHIED 14 Punkt 2, Anhang zum
// offenen Inbox-Eintrag). Ein Import haette die Messung beim Revert still auf 0 gedreht.
function vollSanity(yOpArr, sOpArr, yRevArr, sRevArr) {
  if (!nurUmsatzSanity(yOpArr, sOpArr, yRevArr, sRevArr)) return false;
  const y = V(yOpArr), s = V(sOpArr);
  for (let i = 0; i < Math.min(y.length, s.length); i++) {
    const a = y[i], b = s[i];
    if (Number.isFinite(a) && Number.isFinite(b) && a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b)) return false;
  }
  return true;
}

function t174Messung(vorhanden, snapDirs) {
  const res = { geprueft: 0, altGruen: 0, kippen: [], kippenNurUmsatz: [] };
  const paare = [['largecap', LAYERS[0][1], snapDirs[0]], ['smallcap', LAYERS[1][1], snapDirs[1]]];
  for (const [layer, lp, sd] of paare) {
    if (!sd || !fs.existsSync(sd)) continue;
    const store = JSON.parse(fs.readFileSync(lp, 'utf8'));
    for (const tk of Object.keys(store).sort()) {
      const cf = vorhanden.get(store[tk].cik);
      const sp = path.join(sd, tk + '.json');
      if (!cf || !fs.existsSync(sp)) continue;
      res.geprueft++;
      const snap = JSON.parse(fs.readFileSync(sp, 'utf8'));
      const sec = stumm(() => extractSecSeries(JSON.parse(fs.readFileSync(cf, 'utf8')), tk));
      const yO = snap.annual && snap.annual.annualOpInc, yR = snap.annual && snap.annual.annualRev;
      const a = altSanity(yO, sec.annual.annualOpInc, yR, sec.annual.annualRev);
      const b = vollSanity(yO, sec.annual.annualOpInc, yR, sec.annual.annualRev);
      const c = nurUmsatzSanity(yO, sec.annual.annualOpInc, yR, sec.annual.annualRev);
      if (a) res.altGruen++;
      const vs = besterVersatz(yR, sec.annual.annualRev);
      if (a !== b) res.kippen.push({ layer, tk, versatz: vs });
      if (a !== c) res.kippenNurUmsatz.push({ layer, tk, versatz: vs });
    }
  }
  return res;
}

// ENTSCHIED 13 sagte "exakt 6 Namen" voraus — abgeleitet aus einer GROBEN Attribution
// (Including gewaehlt UND 'Revenues' irgendwo beim selben Filer vorhanden). Diese Liste
// steht hier, damit der Bericht die Prognose gegen die exakte Messung haelt, statt sie
// stillschweigend zu ersetzen.
const PROGNOSE = ['CWCO', 'CLF', 'EXE', 'FA', 'HE', 'VYX'];

const M = (v) => (v === null ? '—' : (v / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 3 }));

function bericht(r) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const L = [];
  L.push('# T168 — Schicht-Diff Vorher/Nachher (Prioritaets-Dreh Revenues vor IncludingAssessedTax)');
  L.push('');
  L.push(`Erzeugt ${ts} UTC · \`node scripts/t168-layer-diff.js\` · ${r.cacheDirs.length} Cache-Verzeichnis(se)`);
  L.push('');
  L.push('**Methode:** dieselben companyfacts, zwei Konzept-Prioritaeten, Zelle gegen Zelle.');
  L.push('Der Diff zeigt damit AUSSCHLIESSLICH die Wirkung des Dreh — kein Live-Pull, keine');
  L.push('Neu-Einreichungen, kein Kalender-Effekt. Kein Netzwerk.');
  L.push('');
  L.push('## Bilanz');
  L.push('');
  L.push('| Groesse | Wert |');
  L.push('| --- | ---: |');
  L.push(`| Namen in beiden Schichten | ${r.stat.namen} |`);
  L.push(`| davon lokal nachrechenbar (companyfacts im Cache) | ${r.stat.geprueft} |`);
  L.push(`| davon ohne lokalen Cache — **nicht geprueft, nicht als unveraendert unterstellt** | ${r.stat.ohneCache} |`);
  L.push(`| **Namen mit veraenderter Umsatzreihe** | **${r.stat.bewegt}** |`);
  L.push(`| veraenderte Jahres-Zellen | ${r.stat.zellen} |`);
  L.push('');
  L.push('## Bewegte Namen — je Jahr');
  L.push('');
  if (!r.zeilen.length) {
    L.push('_keine_');
  } else {
    L.push('| Ticker | Schicht | FY | vorher (Mio. USD) | nachher (Mio. USD) | Faktor |');
    L.push('| --- | --- | ---: | ---: | ---: | ---: |');
    for (const z of r.zeilen) {
      for (const d of z.deltas) {
        const f = (d.alt && d.neu && d.alt !== 0 && d.neu !== 0)
          ? (Math.max(Math.abs(d.alt), Math.abs(d.neu)) / Math.min(Math.abs(d.alt), Math.abs(d.neu))).toFixed(3)
          : '—';
        L.push(`| ${z.tk} | ${z.layer} | ${d.fy} | ${M(d.alt)} | ${M(d.neu)} | ${f} |`);
      }
    }
  }
  L.push('');
  if (r.t174) {
    L.push('## T174 — was die Ganzserien-Haertung an Abdeckung kostet');
    L.push('');
    L.push('Gemessen an den Namen, fuer die BEIDE Seiten lokal vorliegen (companyfacts UND');
    L.push('Yahoo-Snapshot): alte Wache (nur neuestes Jahr) gegen neue (ganze Reihe).');
    L.push('`looseSanity() === false` loescht nichts — der Name behaelt via Merge-Basis seinen');
    L.push('Altstand, wird aber **nicht mehr aufgefrischt**.');
    L.push('');
    L.push('| Groesse | Wert |');
    L.push('| --- | ---: |');
    L.push(`| beidseitig pruefbar | ${r.t174.geprueft} |`);
    L.push(`| unter der ALTEN Wache gruen | ${r.t174.altGruen} |`);
    L.push(`| kippen unter der VOLLEN Variante (Vorzeichen + Umsatz) | ${r.t174.kippen.length} |`);
    L.push(`| **kippen unter der VERENGTEN Variante (nur Umsatz-Skala)** | **${r.t174.kippenNurUmsatz.length}** |`);
    L.push('');
    L.push('Jahres-Versatz je Kandidat mechanisch bestimmt (Methode der 28.07.-Erhebung:');
    L.push('Versatz aus -2..+2 nach Zahl der Umsatz-Paare unter 2 % Abweichung).');
    L.push('**Vergaberegel (H5, ENTSCHIED 52): FEHLALARM ist ein Entlastungs-Urteil und');
    L.push(`braucht einen positiven Beleg** — eine eindeutige Spitze mit mindestens ${VERSATZ_MIN_PAARE}`);
    L.push('Umsatz-Paaren. Die Trefferzahl steht deshalb mit in der Tabelle. Ein Gleichstand');
    L.push('oder eine leere Messmenge belegt NICHTS und heisst **UNAUFGELOEST** — nie');
    L.push('FEHLALARM und nie Befund.');
    L.push('');
    L.push('| Ticker | Schicht | kippt bei VOLL | kippt bei NUR-UMSATZ | bester Versatz | Umsatz-Paare: bester (Versatz 0) | Einordnung |');
    L.push('| --- | --- | :---: | :---: | :---: | :---: | --- |');
    const nurU = new Set(r.t174.kippenNurUmsatz.map((k) => k.tk));
    for (const k of r.t174.kippen) {
      const v = k.versatz;
      const einordnung = v.lage === 'versatz' ? '**FEHLALARM (Jahres-Versatz)**'
        : v.lage === 'null-versatz' ? 'Tag-Divergenz-Signatur'
        : `**UNAUFGELOEST** — ${v.hits === 0 ? 'kein Versatz trifft ein einziges Umsatzpaar'
          : v.spitze.length > 1 ? `Gleichstand (${v.spitze.join('/')})` : `nur ${v.hits} Paar(e)`}`;
      L.push(`| ${k.tk} | ${k.layer} | ja | ${nurU.has(k.tk) ? '**ja**' : 'nein'} | ${
        v.off === VERSATZ_UNBESTIMMT ? 'NICHT BESTIMMBAR' : v.off} | ${v.hits} (${v.hits0}) | ${einordnung}` + ' |');
    }
    L.push('');
  }
  L.push('## Prognose (ENTSCHIED 13: "exakt 6 Namen") gegen Messung');
  L.push('');
  L.push('| Name | prognostiziert | lokal nachrechenbar | bewegt sich | Befund |');
  L.push('| --- | :---: | :---: | :---: | --- |');
  const bewegt = new Set(r.zeilen.map((z) => z.tk));
  for (const tk of PROGNOSE) {
    const pruef = r.geprueftNamen.has(tk);
    L.push(`| ${tk} | ja | ${pruef ? 'ja' : 'NEIN'} | ${bewegt.has(tk) ? '**ja**' : 'nein'} | ${
      bewegt.has(tk) ? 'Prognose bestaetigt'
        : !pruef ? 'unentschieden — kein companyfacts-Cache'
        : 'Prognose widerlegt: Including und Revenues melden fuer JEDES koexistierende fy denselben Wert (Faktor 1,000) — der Dreh aendert nichts'}` + ' |');
  }
  for (const tk of [...bewegt].filter((t) => !PROGNOSE.includes(t))) {
    L.push(`| ${tk} | **nein** | ja | **ja** | von der Prognose UEBERSEHEN — Grob-Attribution zaehlte ihn nur in den Faktor>2-Eimer, sein Blind-Zonen-Jahr fiel durch |`);
  }
  L.push('');
  L.push('## Lesehilfe');
  L.push('');
  L.push('`—` in einer Spalte heisst: fuer dieses Geschaeftsjahr steht in der jeweiligen');
  L.push('Fassung KEIN Umsatz (Zelle null) — entweder weil kein Konzept das Jahr traegt oder');
  L.push('weil `annualRevUnion()` es wegen Faktor-2-Konflikt verworfen hat.');
  return L.join('\n') + '\n';
}

if (require.main === module) {
  const r = run();
  // --snapshots "<largecapDir>;<smallcapDir>" schaltet den T174-Teil frei. Ohne die
  // (git-ignorierten) Snapshots bleibt der Abschnitt weg statt geraten zu werden.
  const snapArg = argOf('--snapshots', null);
  if (snapArg) r.t174 = t174Messung(r.vorhanden, snapArg.split(';'));
  const txt = bericht(r);
  if (r.outFile) { fs.writeFileSync(r.outFile, txt, 'utf8'); console.log('geschrieben:', r.outFile); }
  else process.stdout.write(txt);
  console.error(`[t168-layer-diff] geprueft=${r.stat.geprueft} ohneCache=${r.stat.ohneCache} kaputt=${r.stat.kaputt} bewegt=${r.stat.bewegt} zellen=${r.stat.zellen}`);
}

module.exports = { run, bericht, besterVersatz, ALT_REV, NEU_REV, reiheMit,
  VERSATZ_MIN_PAARE, VERSATZ_UNBESTIMMT };
