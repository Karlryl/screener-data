'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED_METHOD_CONTRACT = deepFreeze({
  protocolVersion: 'rank-ic-confirmatory-v1',
  horizonsDays: [28, 84],
  decisionHorizonDays: 84,
  testDefinition: '28d=max(raw,residual)-IUT; 84d=max(raw,residual)-IUT; underpowered=1',
  correction: { method: 'benjamini-yekutieli', q: 0.10 },
  minimumNeff: 8,
  ciLevel: 0.90,
  bootstrapIterations: 10000,
  bootstrapBlockLength: 2,
  threshold28: 0.03,
  threshold84: 0.05,
});

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalValue(value[key]);
    return out;
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalValue(value));
}

function computePayloadHash(manifest) {
  if (!isPlainObject(manifest)) throw new Error('[rank-ic-families] Manifest muss ein Objekt sein');
  const semantic = {};
  for (const [key, value] of Object.entries(manifest)) if (key !== 'payloadHash') semantic[key] = value;
  return 'sha256:' + crypto.createHash('sha256').update(canonicalStringify(semantic), 'utf8').digest('hex');
}

function assertExactKeys(value, expected, where) {
  if (!isPlainObject(value)) throw new Error('[rank-ic-families] ' + where + ' muss ein Objekt sein');
  const actual = Object.keys(value).sort();
  const wanted = expected.slice().sort();
  const unknown = actual.filter((key) => !wanted.includes(key));
  const missing = wanted.filter((key) => !actual.includes(key));
  if (unknown.length) throw new Error('[rank-ic-families] ' + where + ': unbekannte Felder: ' + unknown.join(', '));
  if (missing.length) throw new Error('[rank-ic-families] ' + where + ': fehlende Felder: ' + missing.join(', '));
}

function assertIsoDate(value, where) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('[rank-ic-families] ' + where + ' muss ein ISO-Datum YYYY-MM-DD sein');
  }
  const parsed = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('[rank-ic-families] ' + where + ' ist kein gueltiges ISO-Datum');
  }
}

function assertNonEmptyString(value, where) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('[rank-ic-families] ' + where + ' muss ein nichtleerer String sein');
  }
}

function assertSortedUnique(values, where, comparator) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('[rank-ic-families] ' + where + ' muss eine nichtleere Liste sein');
  }
  if (new Set(values).size !== values.length) {
    throw new Error('[rank-ic-families] ' + where + ' muss eindeutig sein; doppelte Werte sind verboten');
  }
  const sorted = values.slice().sort(comparator);
  if (canonicalStringify(values) !== canonicalStringify(sorted)) {
    throw new Error('[rank-ic-families] ' + where + ' muss kanonisch sortiert sein');
  }
}

function validateMethodContract(contract) {
  assertExactKeys(contract, [
    'protocolVersion', 'horizonsDays', 'decisionHorizonDays', 'testDefinition', 'correction',
    'minimumNeff', 'ciLevel', 'bootstrapIterations', 'bootstrapBlockLength', 'threshold28', 'threshold84',
  ], 'methodContract');
  assertExactKeys(contract.correction, ['method', 'q'], 'methodContract.correction');
  assertSortedUnique(contract.horizonsDays, 'methodContract.horizonsDays', (a, b) => a - b);
  if (contract.horizonsDays.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error('[rank-ic-families] methodContract.horizonsDays enthaelt ungueltige Horizonte');
  }
  if (JSON.stringify(contract).includes('COURT_PENDING')) {
    throw new Error('[rank-ic-families] COURT_PENDING ist im Produktionsprotokoll verboten');
  }
  if (canonicalStringify(contract) !== canonicalStringify(SUPPORTED_METHOD_CONTRACT)) {
    throw new Error('[rank-ic-families] methodContract weicht vom einzig unterstuetzten ausfuehrbaren Protokoll ab');
  }
}

function validateManifest(manifest, filename) {
  if (!isPlainObject(manifest)) throw new Error('[rank-ic-families] ' + filename + ': Manifest muss ein Objekt sein');
  if (typeof manifest.payloadHash !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(manifest.payloadHash)) {
    throw new Error('[rank-ic-families] ' + filename + ': payloadHash muss sha256:<64 hex> sein');
  }
  const actualHash = computePayloadHash(manifest);
  if (actualHash !== manifest.payloadHash) {
    throw new Error('[rank-ic-families] ' + filename + ': payloadHash stimmt nicht (erwartet ' + actualHash + ')');
  }
  assertExactKeys(manifest, [
    'schemaVersion', 'familyId', 'generation', 'hypothesisId', 'artifactCreatedAt', 'provenance',
    'firstEligibleVintage', 'methodContract', 'boards', 'payloadHash',
  ], filename);
  assertExactKeys(manifest.provenance, ['registration', 'thresholdFreeze'], filename + '.provenance');
  assertExactKeys(manifest.provenance.registration, ['specifiedAt', 'confirmedAt', 'source'], filename + '.provenance.registration');
  assertExactKeys(manifest.provenance.thresholdFreeze, ['frozenAt', 'source'], filename + '.provenance.thresholdFreeze');

  if (manifest.schemaVersion !== 1) throw new Error('[rank-ic-families] ' + filename + ': schemaVersion muss 1 sein');
  assertNonEmptyString(manifest.familyId, filename + '.familyId');
  assertNonEmptyString(manifest.hypothesisId, filename + '.hypothesisId');
  if (!Number.isInteger(manifest.generation) || manifest.generation < 1) {
    throw new Error('[rank-ic-families] ' + filename + ': generation muss eine positive Ganzzahl sein');
  }
  const filenameMatch = /^g(\d+)\.json$/.exec(filename);
  if (!filenameMatch || Number(filenameMatch[1]) !== manifest.generation) {
    throw new Error('[rank-ic-families] ' + filename + ': Dateiname und generation muessen uebereinstimmen');
  }
  assertIsoDate(manifest.artifactCreatedAt, filename + '.artifactCreatedAt');
  assertIsoDate(manifest.firstEligibleVintage, filename + '.firstEligibleVintage');
  assertIsoDate(manifest.provenance.registration.specifiedAt, filename + '.provenance.registration.specifiedAt');
  assertIsoDate(manifest.provenance.registration.confirmedAt, filename + '.provenance.registration.confirmedAt');
  assertIsoDate(manifest.provenance.thresholdFreeze.frozenAt, filename + '.provenance.thresholdFreeze.frozenAt');
  assertNonEmptyString(manifest.provenance.registration.source, filename + '.provenance.registration.source');
  assertNonEmptyString(manifest.provenance.thresholdFreeze.source, filename + '.provenance.thresholdFreeze.source');
  const registration = manifest.provenance.registration;
  if (!(registration.specifiedAt <= registration.confirmedAt && registration.confirmedAt < manifest.firstEligibleVintage)) {
    throw new Error('[rank-ic-families] ' + filename + ': verlangt specifiedAt <= confirmedAt < firstEligibleVintage');
  }
  if (manifest.provenance.thresholdFreeze.frozenAt > manifest.firstEligibleVintage) {
    throw new Error('[rank-ic-families] ' + filename + ': thresholdFreeze.frozenAt muss <= firstEligibleVintage sein');
  }
  assertSortedUnique(manifest.boards, filename + '.boards', (a, b) => {
    const left = String(a), right = String(b);
    return left < right ? -1 : (left > right ? 1 : 0);
  });
  for (const board of manifest.boards) assertNonEmptyString(board, filename + '.boards[]');
  validateMethodContract(manifest.methodContract);
  if (JSON.stringify(manifest).includes('COURT_PENDING')) {
    throw new Error('[rank-ic-families] ' + filename + ': COURT_PENDING ist im Produktionsbetrieb verboten');
  }
  return manifest;
}

function loadFamiliesOrThrow(registryDir) {
  let entries;
  try { entries = fs.readdirSync(registryDir, { withFileTypes: true }); }
  catch (error) {
    throw new Error('[rank-ic-families] Registry-Verzeichnis fehlt oder ist unlesbar: ' + registryDir + ' (' + error.message + ')');
  }
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name).sort();
  if (files.length === 0) {
    throw new Error('[rank-ic-families] Registry leer: keine Manifestdateien in ' + registryDir);
  }
  const families = files.map((filename) => {
    const fullPath = path.join(registryDir, filename);
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8')); }
    catch (error) { throw new Error('[rank-ic-families] ' + filename + ': ungueltiges JSON (' + error.message + ')'); }
    return validateManifest(parsed, filename);
  }).sort((a, b) => a.generation - b.generation);
  if (families.length === 0) throw new Error('[rank-ic-families] null erfolgreich geladene Familien');

  const generations = new Set();
  const familyIds = new Set();
  const hypothesisIds = new Set();
  for (let i = 0; i < families.length; i++) {
    const family = families[i];
    if (generations.has(family.generation)) throw new Error('[rank-ic-families] doppelte generation: ' + family.generation);
    if (familyIds.has(family.familyId)) throw new Error('[rank-ic-families] doppelte familyId: ' + family.familyId);
    if (hypothesisIds.has(family.hypothesisId)) {
      throw new Error('[rank-ic-families] hypothesisId darf in einer spaeteren Generation nicht erneut registriert werden: ' + family.hypothesisId);
    }
    if (family.generation !== i + 1) {
      throw new Error('[rank-ic-families] Generationen muessen lueckenlos bei 1 beginnen; erwartet ' + (i + 1));
    }
    if (i > 0 && family.firstEligibleVintage <= families[i - 1].firstEligibleVintage) {
      throw new Error('[rank-ic-families] firstEligibleVintage muss je spaeterer Generation strikt steigen');
    }
    generations.add(family.generation);
    familyIds.add(family.familyId);
    hypothesisIds.add(family.hypothesisId);
  }
  return deepFreeze(families.slice());
}

module.exports = {
  SUPPORTED_METHOD_CONTRACT,
  canonicalStringify,
  computePayloadHash,
  validateManifest,
  loadFamiliesOrThrow,
};
