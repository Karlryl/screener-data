#!/usr/bin/env node
'use strict';
/**
 * scripts/reconcile-smallcap.js — Reconciliation des 5.2-Small-Cap-Universums.
 * ============================================================================
 * Erfuellt die offenen Auflagen 4 und 5 aus
 * protocol/5.2-weg1b-universe-registered-20260722.md (Codex-Duell-Einwaende):
 *
 *   Auflage 4 — "prune <200-Guard blockt kleine Liste": der Small-Cap-Prune bekommt
 *     einen EIGENEN Mechanismus statt scripts/prune-watchlist.js. Dessen Ueberprune-
 *     Sperre ist `max(200, 50 % des Vorbestands)` — eine absolute Untergrenze, die
 *     fuer eine bewusst kleine Membership-Liste keine Bedeutung hat. Hier gilt
 *     stattdessen eine REIN RELATIVE Sperre (Standard: nie mehr als 25 % in einem
 *     Lauf entfernen), die bei jeder Listengroesse dasselbe schuetzt.
 *
 *   Auflage 5 — "kein Hoechst-Cap-Prune -> herausgewachsene bleiben": Namen, die
 *     ueber die Bandobergrenze ($800M) gewachsen sind, verlassen die Liste; ebenso
 *     Nicht-Operating-Vehikel (CEF/Shell/Bullion-Trust), die route() ohnehin
 *     verwirft und die sonst taeglich weiter abgerufen wuerden.
 *
 *   Auflage 6 (Eigentumsgrenze gegen das Hauptuniversum) wird hier NUR GEMESSEN
 *     und berichtet, NICHT umgesetzt: welche Liste das Band 300-800 Mio. besitzt,
 *     beruehrt die registrierte Universums-Definition und ist ein Karl-Entscheid.
 *
 * ENTFERNT wird bewusst NUR aus den drei dauerhaften, in den Auflagen benannten
 * Gruenden (delisted / non-operating / ueber der Bandobergrenze). Alles andere —
 * Datenluecken, fehlender Sektor, Pre-Revenue, Nicht-US, unter der Bandunter-
 * grenze — wird BERICHTET, nicht entfernt: das sind teils transiente Zustaende,
 * und ein Prune darauf wuerde das registrierte Universum still erodieren
 * (Survivorship-Attrition).
 *
 * Zusaetzlicher Schutz gegen transiente Fehlurteile: ein Snapshot darf nur dann
 * einen Namen entfernen, wenn er FRISCH ist (asOf juenger als --max-age-days).
 * Ein veralteter Snapshot berichtet, entfernt aber nie.
 *
 * Run:
 *   node scripts/reconcile-smallcap.js [--watchlist watchlist-smallcap.json]
 *        [--snapshots snapshots-smallcap] [--main-watchlist watchlist.json]
 *        [--max-age-days 60] [--max-remove-pct 25] [--dry-run] [--force]
 *        [--report <pfad.json>]
 */
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../lib/atomic-write.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');
const { route, NON_OPERATING_VEHICLE_INDUSTRY } = require('../src/scoring/router.js');
const { MAX_MCAP, MIN_MCAP } = require('../src/scoring/smallcap-route.js');

const REPO = path.join(__dirname, '..');

function parseArgs(argv) {
  const a = {
    watchlist: path.join(REPO, 'watchlist-smallcap.json'),
    snapshots: path.join(REPO, 'snapshots-smallcap'),
    mainWatchlist: path.join(REPO, 'watchlist.json'),
    maxAgeDays: 60,
    maxRemovePct: 25,
    report: null,
    dryRun: false,
    force: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const v = argv[i + 1];
    if (argv[i] === '--watchlist' && v) a.watchlist = argv[++i];
    else if (argv[i] === '--snapshots' && v) a.snapshots = argv[++i];
    else if (argv[i] === '--main-watchlist' && v) a.mainWatchlist = argv[++i];
    else if (argv[i] === '--max-age-days' && v) a.maxAgeDays = parseInt(argv[++i], 10);
    else if (argv[i] === '--max-remove-pct' && v) a.maxRemovePct = parseFloat(argv[++i]);
    else if (argv[i] === '--report' && v) a.report = argv[++i];
    else if (argv[i] === '--dry-run') a.dryRun = true;
    else if (argv[i] === '--force') a.force = true;
  }
  if (!Number.isFinite(a.maxAgeDays) || a.maxAgeDays < 1) throw new Error('--max-age-days muss >= 1 sein');
  if (!Number.isFinite(a.maxRemovePct) || a.maxRemovePct <= 0 || a.maxRemovePct > 100) {
    throw new Error('--max-remove-pct muss in (0,100] liegen');
  }
  return a;
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function tickersOf(wl) {
  if (Array.isArray(wl)) return wl.map((e) => (typeof e === 'string' ? e : e && e.ticker)).filter(Boolean);
  if (wl && Array.isArray(wl.stocks)) return wl.stocks.map((e) => (typeof e === 'string' ? e : e && e.ticker)).filter(Boolean);
  return [];
}

function ageDays(asOf, now) {
  const t = Date.parse(asOf || '');
  if (!Number.isFinite(t)) return Infinity;
  return (now - t) / 86400000;
}

/**
 * Klassifiziert EINEN Eintrag. Rein funktional (Snapshot rein, Urteil raus) —
 * damit der Test ohne Dateisystem und ohne Netz auskommt.
 * Rueckgabe: { entscheidung: 'entfernen'|'behalten', grund, mcap }
 */
function classify(snapshot, opts) {
  const maxAgeDays = opts.maxAgeDays;
  const now = opts.now;
  if (!snapshot) return { entscheidung: 'behalten', grund: 'kein-snapshot' };   // wartet auf ersten Pull

  const meta = snapshot.meta || {};
  const frisch = ageDays(meta.asOf || meta.fetchedAt, now) <= maxAgeDays;

  // (1) Auflage 4 — endgueltig delisted. Hier gilt die Frische-Sperre BEWUSST NICHT:
  //     der Pull setzt meta.delisted erst nach einer Nicht-gefunden-Serie
  //     (NOT_FOUND_DELIST_STREAK), das Flag ist also bereits entprellt — und ein
  //     delisteter Name bekommt naturgemaess keinen frischen Snapshot mehr.
  if (meta.delisted === true) return { entscheidung: 'entfernen', grund: 'delisted' };

  const mcRaw = snapshot.marketCap;
  const mcap = (mcRaw && Number.isFinite(mcRaw.value)) ? mcRaw.value : null;

  // Ab hier entscheidet nur ein FRISCHER Snapshot ueber eine Entfernung.
  if (!frisch) return { entscheidung: 'behalten', grund: 'snapshot-veraltet', mcap };

  // (2) Auflage 5 — Band-Austritt nach OBEN. Die Auflage nennt ausdruecklich
  //     ">$800M"; ein Unterschreiten der Untergrenze wird nur berichtet, weil
  //     ein zeitweise abgerutschter Name sonst dauerhaft verloren ginge und nur
  //     ueber einen teuren Builder-Lauf zurueckkaeme.
  //
  // ⚠ EIGENE, STRENGERE FRISCHE fuer den Band-Austritt (unabhaengige Pruefung 27.07.):
  // die allgemeine Sperre oben laesst bis zu --max-age-days (Standard 60) alte Staende zu.
  // Fuer 'delisted' ist das richtig — ein delisteter Name bekommt naturgemaess keinen frischen
  // Snapshot mehr. Fuer einen MARKTWERT ist es falsch: der schwankt taeglich, und ein Name, der
  // vor sieben Wochen einmal auf 810 Mio. sprang und heute bei 500 Mio. steht, waere dauerhaft
  // aus der Liste geflogen. Die Entfernung ist einseitig — es gibt keinen Weg zurueck ausser
  // einem teuren Builder-Lauf.
  //
  // 14 Tage sind grosszuegig: der Small-Cap-Lauf laeuft fuenfmal die Woche, ein Name mit einem
  // aelteren Stand hat also ein anderes Problem und soll dann eben nur berichtet werden.
  const BAND_MAX_AGE_DAYS = 14;
  const bandFrisch = ageDays(meta.asOf || meta.fetchedAt, now) <= BAND_MAX_AGE_DAYS;
  if (mcap != null && mcap > MAX_MCAP) {
    return bandFrisch
      ? { entscheidung: 'entfernen', grund: 'band-austritt-oben', mcap }
      : { entscheidung: 'behalten', grund: 'band-austritt-aber-stand-zu-alt', mcap };
  }
  if (mcap != null && mcap < MIN_MCAP) return { entscheidung: 'behalten', grund: 'unter-bandgrenze', mcap };

  // (3) Auflage 5 — Nicht-Operating. Single-Source ueber route(): dieselbe
  //     Klassifikation, die smallcapRoute() zur Score-Zeit anwendet. Nur DIESER
  //     eine route()-Grund entfernt; alle uebrigen Ausschluesse (no-sector,
  //     Datenmangel, pre-revenue, non-us) sind transient oder Definitionsfragen
  //     und werden nur berichtet.
  // ⚠ KORREKTUR (unabhaengige Pruefung 27.07., bestaetigt an echten Daten): route() allein
  // reicht hier NICHT. Der Grund 'non-operating-rev' entsteht in router.js auch ueber Zweig (a)
  // — EIN einziges negatives Jahresumsatz-Jahr genuegt. Das Regelwerk dort gesteht den
  // Fehltreffer selbst ein ("1 harmloser Borderline: NBTX, ein Biotech mit korruptem
  // -8.4M-Glitch-Jahr"). Im Scoring ist das harmlos: der Name faellt fuer EINEN Tag aus dem
  // Board und ist morgen wieder da. Hier ist dieselbe Heuristik eine MITGLIEDSCHAFTS-
  // Entscheidung — der Name faellt dauerhaft aus dem Universum und kommt nur ueber einen
  // teuren Builder-Lauf zurueck. Dieselbe Regel, voellig andere Folgen.
  //
  // Am echten Bestand belegt: ALT = Altimmune, Inc., Branche Biotechnology, 545,5 Mio. USD,
  // Snapshot frisch — waere am ersten scharfen Samstag entfernt worden. Genau das, was der
  // Kopf dieser Datei ausschliesst ("ein Prune darauf wuerde das registrierte Universum still
  // erodieren").
  //
  // Entfernt wird deshalb nur, wenn die INDUSTRIE das Vehikel ausweist (Fonds, Shell,
  // Asset-Manager, BDC) — eine Eigenschaft der Gesellschaft, keine Eigenschaft einer
  // Umsatzreihe. Alles andere wird BERICHTET.
  const r = route(snapshot);
  if (r.action === 'exclude' && r.reason === 'non-operating-rev') {
    const industrie = String((meta && meta.industry) || '').toLowerCase();
    if (NON_OPERATING_VEHICLE_INDUSTRY.test(industrie)) {
      return { entscheidung: 'entfernen', grund: 'nicht-operativ', mcap };
    }
    return { entscheidung: 'behalten', grund: 'auffaellige-umsatzreihe-aber-operative-branche', mcap };
  }
  if (r.action !== 'route') return { entscheidung: 'behalten', grund: 'route-' + (r.reason || r.action), mcap };

  return { entscheidung: 'behalten', grund: 'im-band', mcap };
}

function main() {
  const args = parseArgs(process.argv);
  const now = Date.now();
  const wl = readJson(args.watchlist);
  if (!wl) { console.error('::error::Watchlist nicht lesbar: ' + args.watchlist); process.exit(1); }
  const wrapped = !Array.isArray(wl) && Array.isArray(wl.stocks);
  const entries = wrapped ? wl.stocks : (Array.isArray(wl) ? wl : null);
  if (!entries) { console.error('::error::Unbekanntes Watchlist-Format: ' + args.watchlist); process.exit(1); }

  // Auflage 6 promises a measured overlap on every run. An unavailable or
  // unknown-shape measurement input is not the same thing as a measured zero,
  // so reject it before snapshot work, reporting, or a destructive write.
  // Both supported empty-list forms remain valid and truthfully measure zero.
  const mainWatchlist = readJson(args.mainWatchlist);
  const mainEntries = Array.isArray(mainWatchlist)
    ? mainWatchlist
    : (mainWatchlist && typeof mainWatchlist === 'object' && Array.isArray(mainWatchlist.stocks)
      ? mainWatchlist.stocks
      : null);
  if (!mainEntries) {
    console.error('::error::Haupt-Watchlist nicht lesbar oder unbekanntes Format: ' + args.mainWatchlist);
    process.exit(1);
  }

  const vorher = entries.length;
  const behalten = [];
  const entfernt = [];
  const gruende = Object.create(null);

  for (const e of entries) {
    const ticker = typeof e === 'string' ? e : (e && e.ticker);
    if (!ticker) { behalten.push(e); continue; }
    const file = path.join(args.snapshots, safeSnapshotFilename(ticker));
    const snap = readJson(file);
    const urteil = classify(snap, { maxAgeDays: args.maxAgeDays, now });
    gruende[urteil.grund] = (gruende[urteil.grund] || 0) + 1;
    if (urteil.entscheidung === 'entfernen') entfernt.push({ ticker, grund: urteil.grund, mcap: urteil.mcap ?? null });
    else behalten.push(e);
  }

  // Auflage 6 — NUR MESSEN: Ueberschneidung mit dem Hauptuniversum.
  const mainTickers = new Set(tickersOf(mainEntries));
  const ueberschneidung = behalten
    .map((e) => (typeof e === 'string' ? e : e && e.ticker))
    .filter((t) => t && mainTickers.has(t));

  console.log('Small-Cap-Reconciliation');
  console.log('  Vorbestand:        ' + vorher);
  console.log('  Entfernt:          ' + entfernt.length);
  console.log('  Bleibt:            ' + behalten.length);
  console.log('  Gruende:           ' + JSON.stringify(gruende));
  console.log('  Auflage 6 (nur gemessen): ' + ueberschneidung.length + ' von ' + behalten.length
    + ' Namen stehen AUCH im Hauptuniversum -> taeglicher Doppel-Abruf.');
  if (entfernt.length) {
    console.log('  Entfernte Namen:');
    for (const x of entfernt) {
      console.log('    - ' + x.ticker + ' (' + x.grund + (x.mcap != null ? ', ' + Math.round(x.mcap / 1e6) + ' Mio. USD' : '') + ')');
    }
  }


  // Auflage 4 — RELATIVE Ueberprune-Sperre (keine absolute Untergrenze, die bei
  // kleinen Listen entweder wirkungslos oder blockierend waere).
  const entferntPct = vorher ? (entfernt.length / vorher) * 100 : 0;
  let gesperrt = null;
  if (!args.force && entferntPct > args.maxRemovePct) {
    gesperrt = 'ueberprune-' + entferntPct.toFixed(1) + '-pct';
  }
  // ⚠ ZWEITE SPERRE (unabhaengige Pruefung 27.07.): die relative Sperre allein kann die Liste
  // unter die Startschwelle des Workflows druecken. .github/workflows/smallcap-pull.yml
  // verweigert den Abruf bei weniger als MIN_LISTE Eintraegen ("possibly corrupted list") —
  // ein Reconcile, der 40 % von 775 entfernt, laesst 465 uebrig und legt damit den NAECHSTEN
  // Lauf still. Eine Aufraeumung, die den Betrieb blockiert, ist keine Aufraeumung.
  // Die Zahl ist bewusst hier UND dort hartkodiert und gegenseitig kommentiert: ein Skript
  // kann die YAML-Datei nicht lesen, und eine dritte Konfigurationsdatei waere mehr Risiko
  // als Nutzen. Wer eine der beiden aendert, aendert die andere mit.
  //
  // ⚠ Die Grenze greift NUR, wenn die Liste vorher darueber lag. Sonst waere sie genau die
  // absolute Untergrenze, die Auflage 4 ausdruecklich verbietet ("keine absolute Untergrenze,
  // die bei kleinen Listen entweder wirkungslos oder blockierend waere") — eine bewusst kleine
  // oder eine Test-Liste duerfte dann gar nicht mehr aufgeraeumt werden. Verhindert wird nur
  // das EINE: dass ein gesunder Bestand unter die Betriebsschwelle geprunt wird.
  // Der Testfall (f3) haelt genau diese Unterscheidung fest.
  const MIN_LISTE = 500;
  if (!gesperrt && !args.force && vorher >= MIN_LISTE && behalten.length < MIN_LISTE) {
    gesperrt = 'unter-startschwelle-' + behalten.length;
  }


  // ⚠ Der Bericht wird JETZT geschrieben, nicht mehr vor der Sperre (unabhaengige Pruefung
  // 27.07.): vorher behauptete das Artefakt eine Liste entfernter Namen auch dann, wenn die
  // Sperre gegriffen und NICHTS geschrieben hatte. Ein Bericht, der etwas anderes sagt als
  // die Wirklichkeit, ist schlimmer als keiner. Jetzt steht der tatsaechliche Ausgang drin.
  const geschrieben = !gesperrt && !args.dryRun && entfernt.length > 0;
  if (args.report) {
    const rep = {
      erzeugt: new Date(now).toISOString(),
      watchlist: path.relative(REPO, args.watchlist).replace(/\\/g, '/'),
      vorher, nachher: geschrieben ? behalten.length : vorher,
      geschrieben,
      gesperrt,
      dryRun: !!args.dryRun,
      entfernt: geschrieben ? entfernt : [],
      wuerde_entfernen: geschrieben ? [] : entfernt,
      gruende,
      auflage6_ueberschneidung: { anzahl: ueberschneidung.length, tickers: ueberschneidung.slice(0, 2000) },
      hinweis: 'entfernt = tatsaechlich geschrieben. wuerde_entfernen = nur vorgeschlagen (dry-run oder Sperre).',
    };
    writeFileAtomic(args.report, JSON.stringify(rep, null, 2));
    console.log('  Bericht: ' + args.report);
  }

  if (gesperrt) {
    // Der Name der Sperre gehoert in die Meldung — wer sie liest, muss ohne Code-Blick wissen,
    // WELCHE der beiden gegriffen hat. Der Test (f1) nagelt das fest.
    const sperrName = gesperrt.startsWith('ueberprune') ? 'Ueberprune-Sperre' : 'Startschwellen-Sperre';
    console.error('::error::' + sperrName + ' (' + gesperrt + '): ' + entfernt.length
      + ' von ' + vorher + ' Namen (' + entferntPct.toFixed(1) + ' %) waeren entfernt worden, '
      + 'uebrig blieben ' + behalten.length + '. Kein Schreibvorgang. Ursache pruefen '
      + '(falscher --snapshots-Pfad? kaputter Pull?), dann --force setzen, wenn es wirklich stimmt.');
    process.exit(1);
  }
  if (args.dryRun) { console.log('  (dry-run — nichts geschrieben)'); return; }
  if (!entfernt.length) { console.log('  Nichts zu tun.'); return; }

  let out;
  if (wrapped) {
    out = Object.assign({}, wl, { stocks: behalten });
    // AS-SK-002 (P1-Welle 1): Object.assign kopierte _meta unveraendert mit — inklusive
    // count, den der Builder EINMAL beim Bau gesetzt hat. Jeder Reconcile entfernte danach
    // Namen, ohne den Zaehler nachzuziehen: live stand 775 bei 540 tatsaechlichen Zeilen.
    // Wer die Datei liest statt sie zu zaehlen, bekam eine um 235 Namen falsche Auskunft.
    // Die uebrigen _meta-Felder (band/source/builder/builtAt) beschreiben den BAU und
    // bleiben deshalb unangetastet; nur der abgeleitete Zaehler wird nachgezogen.
    if (out._meta && typeof out._meta === 'object' && 'count' in out._meta) {
      out._meta = Object.assign({}, out._meta, { count: behalten.length });
    }
    out.lastReconcile = new Date(now).toISOString();
    out.lastReconcileRemoved = entfernt;
  } else {
    out = behalten;
  }
  writeFileAtomic(args.watchlist, JSON.stringify(out, null, 2));
  console.log('  Geschrieben: ' + args.watchlist);
}

if (require.main === module) main();

module.exports = { classify, parseArgs, tickersOf, main };
