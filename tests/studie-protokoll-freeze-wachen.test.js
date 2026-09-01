'use strict';

// Freeze guards for protocol records that declare their own immutability.
//
// THE OBJECT, twice over:
//
// (1) H9 (ENTSCHIED 70). protocol/.../h9-single-appender-enforcement-anchor-addendum.json
//     registers lib/ledger-single-appender.js and its executed sabotage probe as the
//     EXECUTABLE enforcement anchor of the single-appender rule. A registration that
//     nobody re-measures is exactly the documentary anchor the addendum exists to
//     supplement, so the hashes it publishes are recomputed here from the working tree
//     and the probe names it lists must exist verbatim in the probe file.
//
// (2) R15a (cross-review HIGH). protocol/.../r15a-verdict-record.json calls itself
//     FROZEN, APPEND_ONLY_NO_EDIT and endgueltig - and nothing enforced any of it: the
//     record is absent from hash-manifest.json (which binds exactly three other files)
//     and no test referenced it at all. A byte pin is the correct semantics for a record
//     whose whole claim is that it never changes again.
//
// WHY THE FRIEDHOF IS PINNED PER ENTRY, NOT PER FILE. friedhof.json is append-only by
// R13: future burials MUST be able to append. A whole-file byte pin would turn the next
// legitimate burial red. The R15a entry itself is what must never move, so the pin sits
// on the entry - including its position, because an insertion before it is a rewrite of
// the burial order.
//
// HASH BASIS. protocol/early-detection/** is pinned to LF by .gitattributes, so raw
// bytes are deterministic there and the frozen record is hashed raw - with an explicit
// no-CR assertion, so a lost .gitattributes pin fails with a readable reason instead of
// an unexplained hash mismatch. lib/ and this tests/ path are NOT LF-pinned, so they are
// hashed CRLF-normalised: a Windows checkout must not decide the verdict.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { checkSingleAppender, LEDGER_REL } = require('../lib/ledger-single-appender');

const ROOT = path.join(__dirname, '..');

const ADDENDUM_REL = 'protocol/early-detection/2.0.0/h9-single-appender-enforcement-anchor-addendum.json';
const BASE_RECORD_REL = 'protocol/early-detection/2.0.0/register-single-appender-rule.json';
const R15A_REL = 'protocol/early-detection/2.0.0/r15a-verdict-record.json';
const FRIEDHOF_REL = 'protocol/early-detection/2.0.0/friedhof.json';

// Pinned independently of the records themselves: a record that carries its own expected
// hash can be edited together with its claim and stay green. These three constants are
// the second, outside opinion.
const BASE_RECORD_SHA256 = 'b020187392bb7fb85ffbe333ec170cfdc25d85b243bea6b912f8f16aa7025495';
const R15A_SHA256 = '87c4fdf54ed909f41930b73157d03f5547badfb591701aaac164474447504381';
const R15A_FRIEDHOF_ID = 'sec-beschleunigung-2.0.0-prueffenster';
const R15A_FRIEDHOF_INDEX = 6;
const R15A_FRIEDHOF_ENTRY_SHA256 = 'ee77c1f470c0d5f84e9dfaf2fc70a1f1b6a6a5ee6da4a0c6bfe86277c57b7a3e';

const readBytes = (relative) => fs.readFileSync(path.join(ROOT, ...relative.split('/')));
const readJson = (relative) => JSON.parse(readBytes(relative).toString('utf8'));
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const sha256Raw = (relative) => sha256(readBytes(relative));
const sha256Lf = (relative) => sha256(
  Buffer.from(readBytes(relative).toString('utf8').replace(/\r\n/g, '\n')),
);

test('H9: the addendum stands next to the base record without moving a byte of it', () => {
  const addendum = readJson(ADDENDUM_REL);

  assert.equal(addendum.schema, 'early-detection-governance-rule-addendum/v1');
  assert.equal(addendum.recordId, 'h9-single-appender-enforcement-anchor-2026-08-30');
  assert.equal(addendum.mode, 'ADDENDUM_NO_BASE_RECORD_EDIT');
  assert.equal(addendum.status, 'BINDING');
  assert.equal(addendum.authority.decision, 'ENTSCHIED 70');

  // The claim "changed: false" is worth exactly as much as the measurement behind it.
  assert.equal(addendum.amends.path, BASE_RECORD_REL);
  assert.equal(addendum.amends.editedByThisAddendum, false);
  assert.equal(addendum.amends.changed, false);
  assert.equal(addendum.amends.sha256AtAddendumTime, BASE_RECORD_SHA256);
  assert.equal(sha256Raw(BASE_RECORD_REL), BASE_RECORD_SHA256, 'base record moved');

  assert.equal(addendum.preservation.baseRecordEdited, false);
  assert.equal(addendum.preservation.ledgerChangedByThisRecord, false);
  assert.equal(addendum.preservation.sealChanged, false);
  assert.equal(addendum.preservation.hashManifestChanged, false);
});

// G13: der Anker wird als KETTE gelesen, nicht als Einzelpfad. Eine
// Vollendung des Moduls (G7) veraltet den Basis-Anker notwendig; registriert
// wird sie durch ein WEITERES Addendum, nie durch Editieren des vorherigen
// (LR-16). Gueltig ist das juengste Glied der Kette.
// Die Kette wird GELAUFEN, nicht Glied fuer Glied abgetippt: jedes weitere
// Addendum haette sonst eine Aenderung an DIESER Datei erzwungen, und ein
// Waechter, den jede Neuregistrierung anfasst, ist selbst die Drift. Gelaufen
// wird, solange das naechste Glied existiert; gueltig ist das juengste.
const ADDENDUM_N_REL = (n) =>
  `protocol/early-detection/2.0.0/h9-single-appender-enforcement-anchor-addendum-${n}.json`;
function ankerKette() {
  const glieder = [readJson(ADDENDUM_REL)];
  const relVon = [ADDENDUM_REL];
  for (let n = 2; fs.existsSync(path.join(ROOT, ADDENDUM_N_REL(n))); n += 1) {
    const rel = ADDENDUM_N_REL(n);
    const glied = readJson(rel);
    const vorherRel = relVon[relVon.length - 1];
    assert.equal(glied.mode, 'ADDENDUM_NO_BASE_RECORD_EDIT');
    assert.equal(glied.vorgaengerAddendum.recordId, glieder[glieder.length - 1].recordId,
      `${rel} muss auf sein Vorgaenger-Glied zeigen - sonst ist es keine Kette`);
    assert.equal(glied.vorgaengerAddendum.dateiSha256Lf, sha256Lf(vorherRel),
      `${vorherRel} wurde bewegt - LR-16 verbietet genau das`);
    glieder.push(glied);
    relVon.push(rel);
  }
  // Ein Waechter ueber einer Kette, die er nie laeuft, belegt nichts.
  assert.ok(glieder.length >= 2, 'die Anker-Kette muss mindestens ein Addendum fuehren');
  return glieder[glieder.length - 1];
}

test('H9: the registered executable anchor is the code and the probe that actually exist', () => {
  const { module: modul, probe } = ankerKette().executableEnforcementAnchor;

  assert.equal(modul.path, 'lib/ledger-single-appender.js');
  assert.equal(sha256Lf(modul.path), modul.sha256, 'registered module hash is stale');
  assert.equal(typeof checkSingleAppender, 'function');
  assert.equal(LEDGER_REL, 'protocol/early-detection/2.0.0/outcome-access-ledger.json');
  for (const name of modul.exports) {
    assert.ok(
      Object.hasOwn(require('../lib/ledger-single-appender'), name),
      `registered export missing: ${name}`,
    );
  }

  assert.equal(probe.path, 'tests/studie-register-single-appender-rule.test.js');
  assert.equal(sha256Lf(probe.path), probe.sha256, 'registered probe hash is stale');

  // Registered probe names must be real. A list of aspirational test titles would be the
  // same documentary anchor this addendum exists to supplement.
  const probeSource = readBytes(probe.path).toString('utf8');
  assert.ok(probe.executedProbes.length >= 5);
  for (const name of probe.executedProbes) {
    assert.ok(probeSource.includes(`test('${name}'`), `probe not found in the probe file: ${name}`);
  }
});

test('R15a: the frozen verdict record is byte-identical to its freeze state', () => {
  const bytes = readBytes(R15A_REL);

  // .gitattributes pins protocol/early-detection/** to LF. If that ever lapses, say so
  // in words instead of handing back an unexplained hash mismatch.
  assert.equal(bytes.includes(0x0d), false, `${R15A_REL} carries CR bytes; the LF pin lapsed`);
  assert.equal(sha256(bytes), R15A_SHA256, `${R15A_REL} is FROZEN and must not change`);

  // The pin's reason lives in the record; if the self-declaration is ever softened, the
  // pin should go red for the honest reason and not merely on the hash.
  const record = JSON.parse(bytes.toString('utf8'));
  assert.equal(record.status, 'FROZEN_R15A_VERDICT');
  assert.equal(record.mode, 'APPEND_ONLY_NO_EDIT');
  assert.equal(record.endgueltig, true);
  assert.equal(record.verdikt, 'INCONCLUSIVE_DATA');
  assert.equal(record.frozenAt, '2026-08-29T23:20:57Z');
});

test('R13: the R15a friedhof entry is immutable while the friedhof stays append-only', () => {
  const friedhof = readJson(FRIEDHOF_REL);

  // Deliberately NOT a whole-file pin: R13 is append-only, and a future burial must be
  // able to land. Position is pinned too - an insertion before this entry rewrites the
  // burial order, which R13 forbids just as much as an edit.
  assert.ok(friedhof.eintraege.length >= 7, 'friedhof entries disappeared');
  assert.equal(friedhof.eintraege[R15A_FRIEDHOF_INDEX].id, R15A_FRIEDHOF_ID);

  const eintrag = friedhof.eintraege[R15A_FRIEDHOF_INDEX];
  assert.equal(
    sha256(Buffer.from(JSON.stringify(eintrag), 'utf8')),
    R15A_FRIEDHOF_ENTRY_SHA256,
    // ponytail: content pin over the parsed entry, so it survives reformatting of the
    // surrounding file. Ceiling: a whitespace-only reformat INSIDE this entry passes.
    // Upgrade path if that ever matters: pin the raw byte prefix up to the entry's
    // closing brace, which appends leave untouched.
    'the R15a friedhof entry is a burial record and must not be edited (R13)',
  );
  assert.equal(eintrag.stand.startsWith('INCONCLUSIVE_DATA'), true);
});
