'use strict';
/**
 * scripts/pipeline-status.js — schreibt den LAUF-Statusmarker
 * outputs/pipeline-status/v1/latest.json (Vertrag `screener-pipeline-status/v1`).
 *
 * WOZU. Vom 12. bis 15.08.2026 fielen vier Nachtlaeufe rot; Karls Boards standen vier
 * Tage auf dem Stand vom 09.08. und NICHTS hat es ihm gesagt — das Cockpit zeigte die
 * alten Raenge stillschweigend weiter. findash hat seit dem 16.08. die rote Warnleiste
 * dafuer (Repo findash, `web/src/lib/screener-rows.ts`, `pipelineWarnung`), aber sie war
 * blind: den Marker publizierte niemand (404 auf gh-pages). Diese Datei ist die fehlende
 * Datenquelle.
 *
 * DER ROTE FALL IST DER EINZIGE, DER ZAEHLT. Ein Marker, der nur bei gruenem Lauf
 * hochgeladen wird, ist genau so nutzlos wie keiner. Deshalb laeuft der erzeugende Job
 * in daily-pull.yml unter `if: always()` und deployt selbst — er haengt an keinem
 * `if: success()` wie die beiden bestehenden gh-pages-Deploys.
 *
 * MUSTER. Bewusst dieselbe Bauform wie scripts/coverage-gate.js (Karls anderer, aelterer
 * Alarm-Marker outputs/coverage-status.json): eine REINE baueMarker()-Funktion ohne
 * Disk-Zugriff, ein validateMarker() als Vertrags-Waechter, ein `--selftest`, der beide
 * ueber alle Status-Klassen pinnt. Kein neues Konzept.
 *
 * DER VERTRAG WIRD DRUEBEN GEPRUEFT, NICHT HIER GERATEN. findash verwirft einen
 * abweichenden Marker vollstaendig (`shapePipelineStatus` -> null) und zeigt statt der
 * Warnleiste die Meldung "verletzt den Statusvertrag" — ein Formfehler hier schaltet also
 * genau den Alarm ab, um den es geht. validateMarker() unten bildet die Regeln aus
 * findash `data-layer/screener.js` (Stand origin/master 5ae2e21) nach:
 *
 *   schema                       == 'screener-pipeline-status/v1' (exakt)
 *   status                       ∈ {'success','failure'}
 *   attempt_run_id               String ODER Zahl; wir schreiben IMMER String (s. u.)
 *   run_attempt                  ganzzahlig >= 1; wir schreiben IMMER Zahl (s. u.)
 *   head_sha                     genau 40 Hex-Zeichen
 *   started_at / completed_at    parsebare Zeitangabe, PFLICHT
 *   last_success_at              null ODER parsebare Zeitangabe
 *   failed_job                   PFLICHT (nicht leer) wenn status == 'failure'
 *   reason                       nur bei failure gelesen, drueben NIE gerendert
 *
 * FORM DER LAUF-NUMMER (die andere Seite akzeptiert beides — wir entscheiden uns EINMAL):
 *   attempt_run_id ist ein undurchsichtiger Bezeichner -> JSON-STRING ("31769403945").
 *   run_attempt ist ein Zaehler -> JSON-ZAHL (1). Beides auf jedem Lauf gleich, nie gemischt.
 *
 * ZEITANGABEN MIT ZONE — STRENGER ALS DRUEBEN. findash prueft nur, ob Date.parse() etwas
 * ergibt; '2026-08-16T05:00:00' parst dort als ORTSZEIT. Genau diese Luecke hat drueben
 * schon einmal Banner und Kopfzeile einen ganzen Kalendertag auseinanderlaufen lassen
 * (R2-FE-018). validateMarker() verlangt darum eine explizite Zone (Z oder +hh:mm) —
 * der Fehler kann so gar nicht erst die Quelle verlassen.
 *
 * last_success_at IST DER FUMMELIGE TEIL. Er kann nicht aus DIESEM Lauf kommen, wenn er
 * rot ist — er muss aus dem VORGAENGER-Marker fortgeschrieben werden:
 *   gruener Lauf -> last_success_at = completed_at dieses Laufs (neu gesetzt)
 *   roter Lauf   -> last_success_at = last_success_at des Vorgaengers (unveraendert)
 *   kein Vorgaenger (allererster Lauf) -> null, ehrlich leer.
 * Weil der gruene Zweig das Feld immer selbst fuellt, genuegt dem roten Zweig genau EIN
 * Feld des Vorgaengers. findash macht aus dem leeren Feld KEIN "vom unbekannt": bei
 * fehlendem Datum entfaellt drueben der ganze Datumssatz (nachgesehen in screener-rows.ts).
 *
 * Aufruf (im Workflow, Job `laufstatus`) — Eingaben kommen aus der Umgebung:
 *   NEEDS_JSON   = ${{ toJSON(needs) }}   (Ergebnisse aller Jobs aus JOB_REIHENFOLGE)
 *   RUN_ID / RUN_ATTEMPT / HEAD_SHA / STARTED_AT / COMPLETED_AT
 *   node scripts/pipeline-status.js --out outputs/pipeline-status/v1/latest.json \
 *        --vorgaenger _vorgaenger.json
 * Selbsttest:
 *   node scripts/pipeline-status.js --selftest
 */
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'screener-pipeline-status/v1';

// Die Jobs des Tageslaufs als PRIORITAETS-Liste. Gemeldet wird als `failed_job` der ERSTE
// nicht-gruene Eintrag.
//
// WARUM PRIORITAET UND NICHT "ABHAENGIGKEITS-REIHENFOLGE" (Review 16.08.): der Tageslauf ist
// keine einzelne Kette. prep -> pull -> merge -> scoring IST eine (jeder haengt am
// Vorgaenger, faellt prep, werden die anderen nur noch uebersprungen). Die beiden Waechter
// sind aber GESCHWISTER, keine Kettenglieder: `entdeckungs-waechter` haengt allein an prep
// (wie pull), `earnings-transport-waechter` an [prep, merge]. Beide sind nicht-blockierende
// Diagnose-Jobs — es haengt nichts an ihnen. Seit dem 28.08. gehoert `jahres-ausreisser-waechter`
// zu dieser Gruppe (Weg E: aus dem merge-Job ausgekoppelt, damit sein rotes X nicht mehr den
// Scoring-Tag kostet).
// Fallen ein Waechter und ein Datenschritt UNABHAENGIG gleichzeitig, waere "der erste in der
// Datei" die falsche Ursache: der Marker meldete den Diagnose-Job, waehrend der Datenschritt
// der Grund fuer die uebersprungenen Folgejobs ist. Darum stehen die Kettenglieder zuerst und
// die Diagnose-Waechter dahinter — ein echter Datenausfall schlaegt eine Diagnose.
// BEWUSST OHNE ZAHLEN: hier standen "sechs Jobs" und "die vier Kettenglieder ... die zwei
// Waechter", beides schon vor dem 28.08. veraltet. Eine Zahl im Fliesstext veraltet bei jedem
// neuen Job still; die Liste unten ist die einzige Wahrheit.
// Das vollstaendige Bild steht ohnehin in `reason` (alle sechs Ergebnisse), fuer den, der
// die Rohdatei liest; findash zeigt bewusst nur den einen Bereich.
//
// Die Namen sind die Job-IDs aus daily-pull.yml — findash uebersetzt genau diese in Klartext
// ("scoring" -> "Scoring"). Ein unbekannter Name wird drueben ROH angezeigt statt zu
// verschwinden (nachgemessen am echten pipelineWarnung(): failed_job 'voellig-neuer-job'
// rendert als "im Bereich voellig-neuer-job ab"; findash screener-rows.ts nutzt
// `LABELS[job] ?? job` und hat den frueheren Sammelbegriff "Pipeline" bewusst abgeschafft).
// tests/pipeline-status-marker.test.js pinnt SOWOHL die Menge (gegen die Workflow-Datei,
// damit kein neuer Job still herausfaellt) ALS AUCH diese Reihenfolge (weil sie bestimmt,
// welcher Job als Ursache genannt wird).
const JOB_REIHENFOLGE = [
  'prep',
  'pull',
  // 18.08.: der Kursabruf ist ein eigener Job geworden (vorher ein Schritt im merge-Job,
  // der taeglich in sein Timeout lief und dabei schwieg). Er steht hier zwischen pull und
  // merge, weil er ein DATEN-Kettenglied ist: faellt er zusammen mit einem Diagnose-
  // Waechter aus, soll im Banner der Datenschritt stehen, nicht die Diagnose — sonst sucht
  // Karl am falschen Job.
  'prices',
  'merge',
  'scoring',
  'entdeckungs-waechter',
  'earnings-transport-waechter',
  // 28.08. (Weg E, Gerichtsurteil): der Jahres-Ausreisser-Waechter ist aus dem
  // merge-Job ausgekoppelt und laeuft jetzt als eigener Job parallel zu `scoring`.
  // Er steht am ENDE bei den anderen Diagnose-Waechtern, nie vor merge/scoring:
  // faellt er zusammen mit einem Datenschritt aus, soll im Banner der Datenschritt
  // stehen und nicht die Diagnose — sonst sucht Karl am falschen Job.
  'jahres-ausreisser-waechter',
];

/**
 * Den `needs`-Kontext des Workflows (via `toJSON(needs)`) in die geordnete Ergebnisliste
 * umsetzen — UND dabei Drift melden. Das ist der Grund fuer diese Funktion: ein neu
 * dazugekommener Job in daily-pull.yml, den niemand hier eintraegt, wuerde sonst still
 * aus der Statusmeldung fallen. Sein Ausfall bliebe unsichtbar, obwohl der Lauf rot ist —
 * exakt die Fehlerklasse, gegen die dieser ganze Marker gebaut ist.
 *
 * Wirft bei Drift in BEIDE Richtungen: unbekannter Job in `needs` (neu gebaut, hier nicht
 * eingetragen) und fehlender Job (umbenannt oder aus `needs:` gefallen).
 */
function leseJobErgebnisse(needsJson) {
  let needs;
  try { needs = JSON.parse(needsJson); } catch (e) {
    throw new Error(`NEEDS_JSON ist kein lesbares JSON (${e.message}) — ohne die Job-Ergebnisse `
      + 'kann kein ehrlicher Statusmarker entstehen.');
  }
  if (!needs || typeof needs !== 'object' || Array.isArray(needs)) {
    throw new Error('NEEDS_JSON ist kein Objekt — erwartet wird der `toJSON(needs)`-Kontext.');
  }
  const bekannt = new Set(JOB_REIHENFOLGE);
  const fremd = Object.keys(needs).filter((k) => !bekannt.has(k));
  if (fremd.length) {
    throw new Error(`Der Tageslauf kennt Jobs, die dieser Marker nicht abbildet: ${fremd.join(', ')}. `
      + 'Ihr Ausfall bliebe im Statusmarker unsichtbar. JOB_REIHENFOLGE in scripts/pipeline-status.js '
      + 'ergaenzen (und drueben in findash PIPELINE_JOB_LABELS eine Uebersetzung nachtragen).');
  }
  const fehlend = JOB_REIHENFOLGE.filter((k) => !(k in needs));
  if (fehlend.length) {
    throw new Error(`Diese Jobs stehen in JOB_REIHENFOLGE, aber nicht im needs-Kontext: ${fehlend.join(', ')}. `
      + 'Entweder wurden sie umbenannt/entfernt oder das `needs:` des laufstatus-Jobs ist unvollstaendig — '
      + 'ein fehlender Job zaehlt sonst nie als Ausfall.');
  }
  return JOB_REIHENFOLGE.map((name) => ({ name, result: String(needs[name].result || '') }));
}

/**
 * REIN (kein Disk-Zugriff), damit der Selftest jeden Zweig pinnen kann.
 *
 * FAIL-CLOSED: gruen ist der Lauf nur, wenn JEDER Job 'success' meldet. 'failure',
 * 'cancelled', 'skipped' und ein leerer Wert zaehlen alle als roter Lauf. Ein
 * uebersprungener scoring-Job heisst, dass die Boards heute nicht deployt wurden —
 * fuer Karl ist das derselbe Schaden wie ein abgestuerzter, und genau der Ausgang,
 * den ein "nur failure zaehlt"-Marker verschwiegen haette.
 */
function baueMarker(e) {
  const jobs = e.jobErgebnisse;
  const kaputt = jobs.find((j) => j.result !== 'success') || null;
  const status = kaputt ? 'failure' : 'success';
  const marker = {
    schema: SCHEMA,
    status,
    attempt_run_id: String(e.runId == null ? '' : e.runId),   // immer String
    run_attempt: Number(e.runAttempt),                        // immer Zahl
    head_sha: String(e.headSha == null ? '' : e.headSha),
    started_at: e.startedAt,
    completed_at: e.completedAt,
    failed_job: kaputt ? kaputt.name : null,
    // Nur zur Nachschau im Rohmarker; findash rendert `reason` bewusst NIE (XSS-Grenze
    // drueben — der Wert kommt aus einer fremden Datei).
    reason: kaputt ? jobs.map((j) => `${j.name}=${j.result || '<leer>'}`).join(',') : null,
    last_success_at: status === 'success'
      ? e.completedAt
      : (e.vorgaenger && typeof e.vorgaenger.last_success_at === 'string'
        ? e.vorgaenger.last_success_at
        : null),
  };
  return marker;
}

// Zeitangabe MIT Zone. `Date.parse` allein genuegt nicht: '2026-08-16T05:00:00' parst
// als Ortszeit und liegt drueben je nach Uhrzeit einen Kalendertag daneben.
const MIT_ZONE = /(Z|[+-]\d{2}:?\d{2})$/;
function zeitOk(v) {
  return typeof v === 'string' && MIT_ZONE.test(v) && Number.isFinite(Date.parse(v));
}

/**
 * Vertrags-Waechter. Liefert die Liste der Verletzungen (leer = ok). Bildet die
 * Pruefungen aus findash `shapePipelineStatus` nach — plus die Zonen-Pflicht.
 */
function validateMarker(mk) {
  if (!mk || typeof mk !== 'object' || Array.isArray(mk)) return ['marker ist kein Objekt'];
  const errs = [];
  if (mk.schema !== SCHEMA) errs.push(`schema=${mk.schema}`);
  if (!['success', 'failure'].includes(mk.status)) errs.push(`status=${mk.status}`);
  if (typeof mk.attempt_run_id !== 'string' || mk.attempt_run_id.trim() === '') {
    errs.push('attempt_run_id ist kein nicht-leerer String');
  }
  if (!Number.isInteger(mk.run_attempt) || mk.run_attempt < 1) errs.push(`run_attempt=${mk.run_attempt}`);
  if (!/^[a-fA-F0-9]{40}$/.test(String(mk.head_sha || ''))) errs.push(`head_sha=${mk.head_sha}`);
  for (const f of ['started_at', 'completed_at']) {
    if (!zeitOk(mk[f])) errs.push(`${f}=${mk[f]} (fehlt, unparsbar oder ohne Zeitzone)`);
  }
  if (mk.last_success_at !== null && !zeitOk(mk.last_success_at)) {
    errs.push(`last_success_at=${mk.last_success_at} (weder null noch Zeitangabe mit Zone)`);
  }
  if (mk.status === 'failure' && (typeof mk.failed_job !== 'string' || mk.failed_job.trim() === '')) {
    errs.push('failed_job fehlt bei status=failure — findash verwirft den ganzen Marker');
  }
  return errs;
}

function lesJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function run() {
  const ziel = arg('--out', 'outputs/pipeline-status/v1/latest.json');
  const vorgaengerPfad = arg('--vorgaenger', '');
  // Kein Vorgaenger ist ein LEGITIMER Zustand (allererster Lauf) — aber auch der Zustand
  // "Abruf ging schief". Der Workflow unterscheidet die beiden (HTTP 404 vs. Rest) und
  // meldet den zweiten per ::warning::; hier ist beides gleich: kein Datum zum Erben.
  const vorgaenger = vorgaengerPfad ? lesJson(vorgaengerPfad) : null;

  const marker = baueMarker({
    jobErgebnisse: leseJobErgebnisse(process.env.NEEDS_JSON),
    runId: process.env.RUN_ID,
    runAttempt: process.env.RUN_ATTEMPT,
    headSha: process.env.HEAD_SHA,
    startedAt: process.env.STARTED_AT,
    completedAt: process.env.COMPLETED_AT,
    vorgaenger,
  });

  const bad = validateMarker(marker);
  if (bad.length) {
    // HART, nicht als Warnung: ein vertragswidriger Marker wird drueben komplett
    // verworfen. Er zu publizieren waere schlimmer als kein Marker — findash zeigte
    // dann dauerhaft "verletzt den Statusvertrag" statt der roten Warnleiste.
    console.log(`::error::Statusmarker verletzt den Vertrag ${SCHEMA}: ${bad.join('; ')}. `
      + 'findash wuerde ihn verwerfen und statt der roten Warnleiste eine Vertragsmeldung zeigen. '
      + 'NAECHSTER SCHRITT: Actions -> Job "laufstatus" -> Schritt "Statusmarker schreiben".');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  fs.writeFileSync(ziel, JSON.stringify(marker, null, 2) + '\n');
  console.log(`Statusmarker geschrieben: ${ziel} — status=${marker.status}`
    + `${marker.failed_job ? ` failed_job=${marker.failed_job}` : ''}`
    + ` last_success_at=${marker.last_success_at || '<keiner>'}`);
}

// --- Selbsttest: node scripts/pipeline-status.js --selftest ---------------------------
function selftest() {
  const assert = require('node:assert/strict');
  const SHA = 'a'.repeat(40);
  const basis = {
    runId: '31769403945',
    runAttempt: '1',
    headSha: SHA,
    startedAt: '2026-08-16T02:17:00Z',
    completedAt: '2026-08-16T05:37:00Z',
    vorgaenger: null,
  };
  const alleGruen = JOB_REIHENFOLGE.map((name) => ({ name, result: 'success' }));
  let fail = 0;
  const t = (name, fn) => {
    try { fn(); console.log('  ok   ' + name); }
    catch (err) { fail++; console.error('FAIL   ' + name + '\n       ' + err.message); }
  };

  t('gruener Lauf: status=success, kein failed_job, last_success_at = jetzt', () => {
    const m = baueMarker({ ...basis, jobErgebnisse: alleGruen });
    assert.equal(m.status, 'success');
    assert.equal(m.failed_job, null);
    assert.equal(m.reason, null);
    assert.equal(m.last_success_at, basis.completedAt);
    assert.deepEqual(validateMarker(m), []);
  });

  // Am NAMEN gesetzt, nie am Index: die Liste ist eine Prioritaets-Reihenfolge und darf sich
  // aendern, ohne dass ein Test still etwas anderes misst als er behauptet.
  const mit = (...paare) => {
    const jobs = alleGruen.map((j) => ({ ...j }));
    for (const [name, result] of paare) {
      const j = jobs.find((x) => x.name === name);
      assert.ok(j, 'unbekannter Job im Test: ' + name);
      j.result = result;
    }
    return jobs;
  };

  t('roter Lauf: ERSTER nicht-gruener Job wird gemeldet (nicht der letzte)', () => {
    const jobs = mit(['merge', 'failure'], ['scoring', 'skipped']);
    const m = baueMarker({ ...basis, jobErgebnisse: jobs });
    assert.equal(m.status, 'failure');
    assert.equal(m.failed_job, 'merge');
    assert.match(m.reason, /merge=failure/);
    assert.match(m.reason, /scoring=skipped/);
    assert.deepEqual(validateMarker(m), []);
  });

  t('ein echter Datenausfall schlaegt einen gleichzeitig roten Diagnose-Waechter', () => {
    const jobs = mit(['pull', 'failure'], ['entdeckungs-waechter', 'failure']);
    const m = baueMarker({ ...basis, jobErgebnisse: jobs });
    assert.equal(m.failed_job, 'pull',
      'gemeldet wird der Diagnose-Waechter statt des Datenschritts. Beide haengen unabhaengig an '
      + 'prep — der Datenausfall ist der Grund fuer die uebersprungenen Folgejobs, der Waechter '
      + 'nur eine Nebenmeldung. Karl suchte am falschen Job.');
    assert.match(m.reason, /entdeckungs-waechter=failure/,
      'der zweite Ausfall verschwindet ganz — reason muss das volle Bild tragen.');
  });

  t('fail-closed: skipped/cancelled/leer sind KEIN gruener Lauf', () => {
    for (const ausgang of ['skipped', 'cancelled', '']) {
      const m = baueMarker({ ...basis, jobErgebnisse: mit(['scoring', ausgang]) });
      assert.equal(m.status, 'failure', `Ausgang "${ausgang}" gilt faelschlich als gruen`);
      assert.equal(m.failed_job, 'scoring');
    }
  });

  t('roter Lauf ERBT last_success_at vom Vorgaenger (wird NIE ueberschrieben)', () => {
    const jobs = mit(['prep', 'failure']);
    const m = baueMarker({
      ...basis,
      jobErgebnisse: jobs,
      vorgaenger: { last_success_at: '2026-08-09T17:27:00.000Z', completed_at: '2026-08-15T05:00:00Z' },
    });
    assert.equal(m.last_success_at, '2026-08-09T17:27:00.000Z',
      'ein roter Lauf hat den letzten Erfolgszeitpunkt ueberschrieben — genau die Zahl, an der '
      + 'Karl im Banner abliest, seit wann seine Raenge stehen.');
    assert.notEqual(m.last_success_at, m.completed_at);
  });

  t('roter Lauf OHNE Vorgaenger: last_success_at bleibt ehrlich leer (null)', () => {
    const jobs = mit(['prep', 'failure']);
    for (const v of [null, {}, { last_success_at: null }]) {
      const m = baueMarker({ ...basis, jobErgebnisse: jobs, vorgaenger: v });
      assert.equal(m.last_success_at, null);
      assert.deepEqual(validateMarker(m), [], 'ein leeres last_success_at ist vertragsgemaess');
    }
  });

  t('Lauf-Nummer: attempt_run_id String, run_attempt Zahl — auch aus Text-Env', () => {
    const m = baueMarker({ ...basis, runId: 31769403945, runAttempt: '2', jobErgebnisse: alleGruen });
    assert.equal(typeof m.attempt_run_id, 'string');
    assert.equal(m.attempt_run_id, '31769403945');
    assert.equal(typeof m.run_attempt, 'number');
    assert.equal(m.run_attempt, 2);
  });

  t('validateMarker faengt jede Vertragsverletzung, die findash verwerfen wuerde', () => {
    const gut = baueMarker({ ...basis, jobErgebnisse: alleGruen });
    const kaputt = [
      ['schema', { schema: 'coverage-status/v1' }],
      ['status', { status: 'maybe' }],
      ['attempt_run_id leer', { attempt_run_id: '' }],
      ['attempt_run_id als Zahl', { attempt_run_id: 42 }],
      ['run_attempt 0', { run_attempt: 0 }],
      ['run_attempt Text', { run_attempt: 'eins' }],
      ['head_sha kurz', { head_sha: 'abc' }],
      ['started_at unparsbar', { started_at: 'kaputt' }],
      ['completed_at fehlt', { completed_at: undefined }],
      ['last_success_at kaputt', { last_success_at: 'irgendwann' }],
    ];
    for (const [wie, patch] of kaputt) {
      assert.ok(validateMarker({ ...gut, ...patch }).length > 0, `${wie} kommt durch den Waechter`);
    }
    assert.deepEqual(validateMarker(gut), [], 'der gesunde Marker muss DURCHGEHEN (kein Falsch-Rot)');
  });

  t('Zonen-Pflicht: Zeit ohne Zone faellt auf (der Kalendertag-Fehler von drueben)', () => {
    const gut = baueMarker({ ...basis, jobErgebnisse: alleGruen });
    assert.ok(validateMarker({ ...gut, completed_at: '2026-08-16T05:37:00' }).length > 0,
      'eine Zeitangabe ohne Zone kommt durch — sie parst drueben als Ortszeit und liegt ab ca. '
      + '22 Uhr UTC einen Kalendertag daneben (R2-FE-018).');
    for (const mitZone of ['2026-08-16T05:37:00Z', '2026-08-16T07:37:00+02:00', '2026-08-16T05:37:00.000Z']) {
      assert.deepEqual(validateMarker({ ...gut, completed_at: mitZone }), [], `${mitZone} muss durchgehen`);
    }
  });

  const needsKontext = (patch) => JSON.stringify(Object.assign(
    Object.fromEntries(JOB_REIHENFOLGE.map((n) => [n, { result: 'success', outputs: {} }])), patch || {}));

  t('needs-Kontext wird in die feste Reihenfolge gebracht', () => {
    const jobs = leseJobErgebnisse(needsKontext({ merge: { result: 'failure' } }));
    assert.deepEqual(jobs.map((j) => j.name), JOB_REIHENFOLGE);
    assert.equal(jobs.find((j) => j.name === 'merge').result, 'failure');
  });

  t('Drift-Alarm: ein NEUER Job im Lauf, den der Marker nicht kennt, faellt auf', () => {
    assert.throws(() => leseJobErgebnisse(needsKontext({ 'neuer-waechter': { result: 'failure' } })),
      /nicht abbildet/,
      'ein neu gebauter Job kann still aus der Statusmeldung fallen — sein Ausfall waere '
      + 'unsichtbar, obwohl der Lauf rot ist.');
  });

  t('Drift-Alarm: ein FEHLENDER Job (umbenannt / nicht in needs) faellt auf', () => {
    const ohneScoring = JSON.parse(needsKontext());
    delete ohneScoring.scoring;
    assert.throws(() => leseJobErgebnisse(JSON.stringify(ohneScoring)), /nicht im needs-Kontext/);
  });

  t('kaputtes NEEDS_JSON wirft, statt einen leeren Erfolg zu erfinden', () => {
    for (const roh of ['', '{kaputt', 'null', '[]', '"text"']) {
      assert.throws(() => leseJobErgebnisse(roh), /NEEDS_JSON/,
        `"${roh}" liefert still eine leere Job-Liste — die waere per Definition "alle gruen".`);
    }
  });

  t('failed_job ist bei status=failure PFLICHT (sonst verwirft findash alles)', () => {
    const gut = baueMarker({ ...basis, jobErgebnisse: alleGruen });
    assert.ok(validateMarker({ ...gut, status: 'failure', failed_job: null }).length > 0);
    assert.deepEqual(validateMarker({ ...gut, status: 'failure', failed_job: 'merge' }), []);
  });

  console.log(fail ? `\npipeline-status selftest: ${fail} FAIL` : '\npipeline-status selftest: alles gruen');
  process.exit(fail ? 1 : 0);
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) selftest();
  else run();
}

module.exports = { baueMarker, validateMarker, leseJobErgebnisse, JOB_REIHENFOLGE, SCHEMA };
