'use strict';

// Research-only audit and inventory for FEM-SEC-US@1.2.0.
// It never executes the confirmatory study while a readiness gate is red.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  aiRemoval,
  assertKnownAt,
  canonicalSha256,
  classifyCandidate,
  deriveMarketRecognition,
  evaluateReadiness,
  evaluateHFem,
  matchControls,
  selectPrimarySignals,
  selectPrimaryTheme,
  technicalSnapshot,
  wilsonInterval,
} = require('../lib/early-detection.js');

const ROOT = path.resolve(__dirname, '..');
const PROTOCOL_REL = 'protocol/early-detection/1.2.0';
const PROTOCOL = path.join(ROOT, PROTOCOL_REL);
const MANIFEST = path.join(PROTOCOL, 'hash-manifest.json');
const PARENT_MANIFEST = path.join(ROOT, 'protocol', 'early-detection', '1.0.0', 'hash-manifest.json');
const PARENT_MANIFEST_SHA256 = 'bccdb61fa9ba73ee578049e9a4069a9db106bf90270d2b0fc6f167227c7cec42';
const OUTCOME_CHECKPOINT_REL = `${PROTOCOL_REL}/outcome-access-checkpoint.json`;
const REPORT_DIR = path.join(ROOT, 'reports', 'early-detection');
const VOLATILE_ENVIRONMENT_TEST_PREFIXES = ['tests/discovery/'];
const SEALED_FILES = [
  'lib/early-detection.js',
  `${PROTOCOL_REL}/README.md`,
  `${PROTOCOL_REL}/confirmatory-runtime-lock.json`,
  `${PROTOCOL_REL}/execution-gate-artifact-template.json`,
  `${PROTOCOL_REL}/execution-gate-evidence-template.json`,
  `${PROTOCOL_REL}/CONFIRMATORY_RUNBOOK.md`,
  `${PROTOCOL_REL}/fixtures.json`,
  `${PROTOCOL_REL}/preregistration.json`,
  `${PROTOCOL_REL}/readiness-and-blockers.md`,
  `${PROTOCOL_REL}/preseal-outcome-access-declaration.json`,
  'scripts/early-detection-audit.js',
  'scripts/early-detection-confirmatory.py',
  'tests/early-detection-confirmatory.test.js',
  'tests/early-detection.test.js',
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function deterministicTestFiles() {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && /(?:\.test|-test|_test)\.js$/i.test(entry.name)) {
        const relative = path.relative(ROOT, absolute).replaceAll('\\', '/');
        if (!VOLATILE_ENVIRONMENT_TEST_PREFIXES.some((prefix) => relative.startsWith(prefix))) files.push(relative);
      }
    }
  };
  for (const root of ['lib', 'tests']) {
    const absolute = path.join(ROOT, root);
    if (fs.existsSync(absolute)) visit(absolute);
  }
  return files.sort();
}

function buildManifest(files, sealedAt, frozenAt) {
  const sealedMs = Date.parse(sealedAt);
  const frozenMs = Date.parse(frozenAt);
  if (!Number.isFinite(sealedMs) || !Number.isFinite(frozenMs) || sealedMs < frozenMs) {
    throw new Error('sealedAt must be a valid timestamp at or after identity.frozenAt');
  }
  return {
    schema: 'early-detection-hash-manifest/v1.2',
    protocol: 'FEM-SEC-US@1.2.0',
    parentProtocol: 'FEM-SEC-US@1.1.0',
    parentStatus: 'UNSEALED_REVIEW_REJECTED',
    lastSealedAncestor: 'FEM-SEC-US@1.0.0',
    lastSealedAncestorManifestSha256: PARENT_MANIFEST_SHA256,
    sealedAt,
    algorithm: 'SHA-256 over exact file bytes; manifest excludes itself',
    files,
  };
}

function outcomeCheckpointIssues(state, checkpoint, remoteCheckpoint) {
  const issues = [];
  if (!checkpoint || checkpoint.schema !== 'early-detection-outcome-access-checkpoint/v1'
    || checkpoint.protocol !== 'FEM-SEC-US@1.2.0' || checkpoint.remoteRef !== 'origin/main') {
    issues.push('ledger:checkpoint_identity_mismatch');
    return issues;
  }
  if (checkpoint.eventCount !== state.eventCount || checkpoint.head !== state.head
    || checkpoint.ledgerSha256 !== state.ledgerSha256) {
    issues.push('ledger:current_state_not_exactly_checkpointed');
  }
  if (!remoteCheckpoint || canonicalSha256(remoteCheckpoint) !== canonicalSha256(checkpoint)) {
    issues.push('ledger:local_checkpoint_differs_from_remote_write_once_checkpoint');
  }
  return issues;
}

function outcomeCheckpointHistoryIssues(snapshots, genesisHash) {
  const issues = [];
  let previousEvents = [];
  let previousCount = 0;
  for (const [index, snapshot] of (snapshots || []).entries()) {
    const events = snapshot && snapshot.ledger && Array.isArray(snapshot.ledger.events) ? snapshot.ledger.events : null;
    const checkpoint = snapshot && snapshot.checkpoint;
    if (!events || !checkpoint) {
      issues.push(`ledger:checkpoint_history_${index}:invalid_snapshot`);
      continue;
    }
    let head = genesisHash;
    for (const [eventIndex, event] of events.entries()) {
      const body = { ...event };
      delete body.eventHash;
      if (event.previousHash !== head || event.eventHash !== canonicalSha256(body)) {
        issues.push(`ledger:checkpoint_history_${index}:event_${eventIndex}_chain_invalid`);
      }
      head = event.eventHash;
    }
    if (events.length < previousCount || previousEvents.some((event, eventIndex) => events[eventIndex]?.eventHash !== event.eventHash)) {
      issues.push(`ledger:checkpoint_history_${index}:non_monotone_or_non_prefix`);
    }
    if (checkpoint.eventCount !== events.length || checkpoint.head !== head
      || checkpoint.ledgerSha256 !== snapshot.ledgerSha256) {
      issues.push(`ledger:checkpoint_history_${index}:checkpoint_state_mismatch`);
    }
    previousEvents = events;
    previousCount = events.length;
  }
  return issues;
}

function verifyOutcomeAccessLedger(requireClean = false) {
  const ledger = readJson(path.join(PROTOCOL, 'outcome-access-ledger.json'));
  const declaration = readJson(path.join(PROTOCOL, 'preseal-outcome-access-declaration.json'));
  const issues = [];
  if (ledger.schema !== 'early-detection-outcome-access-ledger/v2') issues.push('ledger:schema_mismatch');
  if (ledger.protocol !== 'FEM-SEC-US@1.2.0') issues.push('ledger:protocol_mismatch');
  if (ledger.initialStatus !== 'NO_CONFIRMATORY_OUTCOME_ACCESS') issues.push('ledger:initial_status_mismatch');
  if (ledger.lastSealedAncestor !== declaration.lastSealedAncestor) issues.push('ledger:last_sealed_ancestor_mismatch');
  if (JSON.stringify(ledger.confirmatoryWindows) !== JSON.stringify(declaration.confirmatoryWindows)) {
    issues.push('ledger:confirmatory_windows_mismatch');
  }
  if (!Array.isArray(ledger.events)) issues.push('ledger:events_not_array');
  let previousHash = declaration.liveLedgerInitialSha256;
  for (const [index, event] of (Array.isArray(ledger.events) ? ledger.events : []).entries()) {
    if (!event || typeof event !== 'object') {
      issues.push(`ledger:event_${index}:invalid`);
      continue;
    }
    if (event.previousHash !== previousHash) issues.push(`ledger:event_${index}:previous_hash_mismatch`);
    if (!event.accessAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(event.accessAt)) {
      issues.push(`ledger:event_${index}:access_timestamp_invalid`);
    }
    if (!event.actor || !event.scope || !event.purpose) issues.push(`ledger:event_${index}:required_field_missing`);
    if (!['confirmatory_execution_authorized', 'manual_confirmatory_access'].includes(event.eventType)) {
      issues.push(`ledger:event_${index}:event_type_invalid`);
    }
    if (event.eventType === 'confirmatory_execution_authorized') {
      const requiredHashes = ['inputFileSha256', 'gateEvidenceFileSha256', 'researchCorpusSha256', 'protocolManifestSha256'];
      if (typeof event.runId !== 'string' || !event.runId
        || typeof event.analysisCutoffAt !== 'string'
        || requiredHashes.some((field) => !/^[0-9a-f]{64}$/.test(String(event[field] || '')))) {
        issues.push(`ledger:event_${index}:execution_authorization_incomplete`);
      }
    }
    const body = { ...event };
    delete body.eventHash;
    const computed = canonicalSha256(body);
    if (event.eventHash !== computed) issues.push(`ledger:event_${index}:event_hash_mismatch`);
    previousHash = event.eventHash;
  }
  if (requireClean && ledger.events.length) issues.push('ledger:not_clean_before_seal');
  if (!requireClean) {
    const checkpointPath = path.join(ROOT, OUTCOME_CHECKPOINT_REL);
    let checkpoint = null;
    let remoteCheckpoint = null;
    try { checkpoint = readJson(checkpointPath); } catch (error) { issues.push('ledger:local_checkpoint_missing_or_invalid'); }
    if (checkpoint) {
      const fetch = spawnSync('git', ['fetch', '--quiet', 'origin', 'main'], {
        cwd: ROOT, encoding: 'utf8', timeout: 60000,
      });
      if (fetch.status !== 0) issues.push('ledger:remote_checkpoint_fetch_failed');
      const remoteRead = spawnSync('git', ['show', `${checkpoint.remoteRef}:${OUTCOME_CHECKPOINT_REL}`], {
        cwd: ROOT, encoding: 'utf8', timeout: 15000,
      });
      if (remoteRead.status !== 0 || !remoteRead.stdout) issues.push('ledger:remote_write_once_checkpoint_unavailable');
      else {
        try { remoteCheckpoint = JSON.parse(remoteRead.stdout); } catch (error) { issues.push('ledger:remote_checkpoint_invalid'); }
      }
      issues.push(...outcomeCheckpointIssues({
        eventCount: ledger.events.length,
        head: previousHash,
        ledgerSha256: sha256File(path.join(PROTOCOL, 'outcome-access-ledger.json')),
      }, checkpoint, remoteCheckpoint));
      if (fetch.status === 0) {
        const ledgerRel = `${PROTOCOL_REL}/outcome-access-ledger.json`;
        const historyRead = spawnSync('git', ['log', '--format=%H', '--reverse', 'origin/main', '--', OUTCOME_CHECKPOINT_REL, ledgerRel], {
          cwd: ROOT, encoding: 'utf8', timeout: 15000,
        });
        if (historyRead.status !== 0) issues.push('ledger:remote_checkpoint_history_unavailable');
        else {
          const snapshots = [];
          for (const commit of historyRead.stdout.split(/\r?\n/).filter(Boolean)) {
            const checkpointRead = spawnSync('git', ['show', `${commit}:${OUTCOME_CHECKPOINT_REL}`], { cwd: ROOT, encoding: 'utf8', timeout: 15000 });
            const ledgerRead = spawnSync('git', ['show', `${commit}:${ledgerRel}`], { cwd: ROOT, encoding: 'buffer', timeout: 15000 });
            if (checkpointRead.status !== 0 || ledgerRead.status !== 0) continue;
            try {
              snapshots.push({
                checkpoint: JSON.parse(checkpointRead.stdout),
                ledger: JSON.parse(ledgerRead.stdout.toString('utf8')),
                ledgerSha256: crypto.createHash('sha256').update(ledgerRead.stdout).digest('hex'),
              });
            } catch (error) { issues.push(`ledger:remote_checkpoint_history_parse_failed:${commit}`); }
          }
          if (!snapshots.length) issues.push('ledger:remote_checkpoint_history_empty');
          else issues.push(...outcomeCheckpointHistoryIssues(snapshots, declaration.liveLedgerInitialSha256));
        }
      }
    }
  }
  if (issues.length) throw new Error(`outcome access ledger verification failed: ${issues.join(', ')}`);
  return { events: ledger.events.length, head: previousHash, externallyCheckpointed: !requireClean };
}

function seal(now = new Date().toISOString()) {
  verifyFixtures();
  const preregistration = readJson(path.join(PROTOCOL, 'preregistration.json'));
  const declaration = readJson(path.join(PROTOCOL, 'preseal-outcome-access-declaration.json'));
  if (preregistration.identity.status !== 'preregistered' || !preregistration.identity.frozenAt) {
    throw new Error('protocol must be final and preregistered with a real frozenAt before sealing');
  }
  verifyOutcomeAccessLedger(true);
  const ledgerSha256 = sha256File(path.join(PROTOCOL, 'outcome-access-ledger.json'));
  if (declaration.status !== 'NO_CONFIRMATORY_OUTCOME_ACCESS' || !Array.isArray(declaration.events)
    || declaration.events.length || declaration.liveLedgerInitialSha256 !== ledgerSha256) {
    throw new Error('sealed pre-access declaration does not match the clean live outcome ledger');
  }
  if (!fs.existsSync(PARENT_MANIFEST) || sha256File(PARENT_MANIFEST) !== PARENT_MANIFEST_SHA256) {
    throw new Error('parent protocol manifest hash mismatch');
  }
  const testFiles = deterministicTestFiles();
  if (!testFiles.includes('tests/early-detection.test.js') || testFiles.length < 100) {
    throw new Error('deterministic repository test inventory is unexpectedly incomplete');
  }
  const testRun = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...testFiles], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180000,
  });
  if (testRun.error || testRun.status !== 0) {
    const detail = String(testRun.stderr || testRun.stdout || (testRun.error && testRun.error.message) || '').trim();
    throw new Error(`full repository test preflight failed: ${detail.slice(-1200)}`);
  }
  const files = {};
  for (const relative of SEALED_FILES) {
    const absolute = path.join(ROOT, relative);
    if (!fs.existsSync(absolute)) throw new Error(`missing sealed file: ${relative}`);
    files[relative.replaceAll('\\', '/')] = sha256File(absolute);
  }
  if (fs.existsSync(MANIFEST)) {
    const existing = readJson(MANIFEST);
    if (JSON.stringify(existing.files) !== JSON.stringify(files)) {
      throw new Error('sealed protocol version is immutable; create a new semantic version');
    }
    verifyManifest();
    return files;
  }
  writeJson(MANIFEST, buildManifest(files, now, preregistration.identity.frozenAt));
  verifyManifest();
  return files;
}

function verifyManifest() {
  if (!fs.existsSync(MANIFEST)) throw new Error('hash-manifest.json missing; run --seal after review');
  const manifest = readJson(MANIFEST);
  const preregistration = readJson(path.join(PROTOCOL, 'preregistration.json'));
  const issues = [];
  if (!fs.existsSync(PARENT_MANIFEST) || sha256File(PARENT_MANIFEST) !== PARENT_MANIFEST_SHA256) {
    issues.push('manifest:parent_file_hash_mismatch');
  }
  if (manifest.schema !== 'early-detection-hash-manifest/v1.2') issues.push('manifest:schema_mismatch');
  if (manifest.protocol !== 'FEM-SEC-US@1.2.0') issues.push('manifest:protocol_mismatch');
  if (manifest.parentProtocol !== preregistration.identity.parentProtocol) issues.push('manifest:parent_protocol_mismatch');
  if (manifest.parentStatus !== preregistration.identity.parentStatus) issues.push('manifest:parent_status_mismatch');
  if (manifest.lastSealedAncestor !== preregistration.identity.lastSealedAncestor
    || manifest.lastSealedAncestorManifestSha256 !== preregistration.identity.lastSealedAncestorManifestSha256
    || manifest.lastSealedAncestorManifestSha256 !== PARENT_MANIFEST_SHA256) issues.push('manifest:ancestor_hash_mismatch');
  const sealedMs = Date.parse(manifest.sealedAt);
  const frozenMs = Date.parse(preregistration.identity.frozenAt);
  if (!Number.isFinite(sealedMs) || !Number.isFinite(frozenMs) || sealedMs < frozenMs) {
    issues.push('manifest:invalid_seal_time');
  }
  for (const relative of SEALED_FILES) {
    const key = relative.replaceAll('\\', '/');
    const absolute = path.join(ROOT, relative);
    if (!fs.existsSync(absolute)) issues.push(`${key}:missing`);
    else if ((manifest.files || {})[key] !== sha256File(absolute)) issues.push(`${key}:hash_mismatch`);
  }
  for (const key of Object.keys(manifest.files || {})) {
    if (!SEALED_FILES.map((item) => item.replaceAll('\\', '/')).includes(key)) issues.push(`${key}:unexpected_manifest_entry`);
  }
  if (issues.length) throw new Error(`manifest verification failed: ${issues.join(', ')}`);
  return manifest;
}

function verifyRemoteManifest() {
  const fetch = spawnSync('git', ['fetch', '--quiet', 'origin', 'main'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000,
  });
  if (fetch.status !== 0) throw new Error('remote manifest fetch failed');
  const manifestRel = `${PROTOCOL_REL}/hash-manifest.json`;
  const remoteRead = spawnSync('git', ['show', `origin/main:${manifestRel}`], {
    cwd: ROOT, encoding: 'buffer', timeout: 15000,
  });
  if (remoteRead.status !== 0 || !remoteRead.stdout) throw new Error('remote sealed manifest unavailable');
  const localBytes = fs.readFileSync(MANIFEST);
  if (!remoteRead.stdout.equals(localBytes)) throw new Error('local sealed manifest differs byte-for-byte from origin/main');
  const manifest = JSON.parse(localBytes.toString('utf8'));
  const issues = [];
  for (const [relative, expectedSha256] of Object.entries(manifest.files || {})) {
    const remoteFile = spawnSync('git', ['show', `origin/main:${relative}`], {
      cwd: ROOT, encoding: 'buffer', timeout: 15000,
    });
    if (remoteFile.status !== 0) issues.push(`${relative}:remote_missing`);
    else if (crypto.createHash('sha256').update(remoteFile.stdout).digest('hex') !== expectedSha256) {
      issues.push(`${relative}:remote_hash_mismatch`);
    }
  }
  if (issues.length) throw new Error(`remote sealed files verification failed: ${issues.join(', ')}`);
  const headRead = spawnSync('git', ['rev-parse', 'origin/main'], { cwd: ROOT, encoding: 'utf8', timeout: 15000 });
  if (headRead.status !== 0 || !/^[0-9a-f]{40}$/.test(headRead.stdout.trim())) throw new Error('remote head unavailable');
  return { manifestSha256: sha256File(MANIFEST), remoteHead: headRead.stdout.trim() };
}

function verifyFixtures() {
  const fixtureFile = readJson(path.join(PROTOCOL, 'fixtures.json'));
  const failures = [];
  let verifiedDirectly = 0;
  for (const fixture of fixtureFile.fixtures) {
    if (fixture.function === 'assertKnownAt') {
      if (assertKnownAt(fixture.input, fixture.evaluationAt) !== fixture.expected) failures.push(fixture.id);
      verifiedDirectly += 1;
    } else if (fixture.function === 'classifyCandidate') {
      const levels = fixture.input;
      const evidenceSources = ['T', 'E', 'L', 'M']
        .filter((dimension) => (levels[dimension] || 0) > 0)
        .map((dimension) => ({
          sourceId: `S-${dimension}`,
          sourceClass: 'public_web',
          source_published_at: '2024-01-01T00:00:00Z',
          observed_at: '2024-01-01T00:00:00Z',
        }));
      const revenues = [100, 100, 100, 100, 105, 105, 105, 105, 140, 141, 142, 143, 144];
      const monthDays = ['03-31', '06-30', '09-30', '12-31'];
      const growthVisibilityRows = revenues.map((revenue, index) => {
        const fiscalYear = 2019 + Math.floor(index / 4);
        const fiscalQuarter = index % 4 + 1;
        return {
          entityId: 'ENTITY-1', fiscalYear, fiscalQuarter, revenue, sectorPercentile: 79,
          sourceClass: 'sec_filing',
          acceptedAt: `${fiscalYear}-${monthDays[fiscalQuarter - 1]}T20:00:00Z`,
          observedAt: `${fiscalYear}-${monthDays[fiscalQuarter - 1]}T20:01:00Z`,
          sectorPercentileKnownAt: `${fiscalYear}-${monthDays[fiscalQuarter - 1]}T20:02:00Z`,
        };
      });
      const actual = classifyCandidate({ ...fixture.input, evidenceSources, growthVisibilityRows });
      if (actual.state !== fixture.expected.state || actual.elliottReview !== fixture.expected.elliottReview) failures.push(fixture.id);
      verifiedDirectly += 1;
    } else if (fixture.function === 'aiRemoval' && fixture.case === 'nineteen_classified_one_unknown') {
      const rows = Array.from({ length: 20 }, (_, index) => ({ entityId: `E${index}`, listingId: `L${index}`, evaluationAt: '2024-06-01T00:00:00Z' }));
      const ledger = rows.slice(0, 19).map((row) => ({
        entityId: row.entityId, listingId: row.listingId, aiClass: 'independent',
        effectiveFrom: '2024-01-01T00:00:00Z', effectiveTo: null, sourceId: `S-${row.entityId}`,
        sourceClass: 'public_web', source_published_at: '2024-01-01T00:00:00Z', observed_at: '2024-01-02T00:00:00Z',
      }));
      const actual = aiRemoval(rows, ledger, 'material');
      if (actual.status !== fixture.expectedBelowMinimum || actual.primaryResultAllowed !== false
        || !actual.sensitivityBoundsAvailable) failures.push(fixture.id);
      verifiedDirectly += 1;
    } else if (fixture.function === 'technicalSnapshot') {
      const bars = Array.from({ length: 300 }, (_, index) => ({ date: new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10), close: 100 + index / 10 }));
      const actual = technicalSnapshot(bars);
      if (actual.squeeze.status !== fixture.expectedSqueezeStatus || actual.dataCapabilities.adjustedClose !== false) failures.push(fixture.id);
      verifiedDirectly += 1;
    } else if (fixture.function === 'deriveMarketRecognition') {
      const bars = Array.from({ length: 200 }, (_, index) => ({
        date: new Date(Date.UTC(2023, 6, 16 + index)).toISOString().slice(0, 10),
        close: index === 199 ? 103 : 100,
      }));
      const benchmark = bars.map((bar) => ({ date: bar.date, close: 100 }));
      const actual = deriveMarketRecognition({
        entityId: 'ENTITY-1',
        listingId: 'LISTING-1',
        vintageMonth: '2024-01',
        bars,
        benchmarks: { sectorBars: benchmark, marketBars: benchmark },
        vintageCalendar: [
          { vintageMonth: '2023-12', closeDate: '2023-12-29', closeAt: '2023-12-29T21:00:00Z', nextOpenAt: '2024-01-02T14:30:00Z' },
          { vintageMonth: '2024-01', closeDate: bars.at(-1).date, closeAt: '2024-01-31T21:00:00Z', nextOpenAt: '2024-02-01T14:30:00Z' },
        ],
        priceMetadata: { adjustmentPolicy: 'point_in_time_total_return', corporateActionKnownAtPolicy: 'point_in_time' },
      });
      if (actual.status !== 'COMPUTABLE' || actual.level !== fixture.expectedLevel) failures.push(fixture.id);
      verifiedDirectly += 1;
    } else if (fixture.function === 'evaluateReadiness') {
      const gates = Object.fromEntries([
        'protocolSealed', 'confirmatoryAnalysisImplementationSealed', 'entityListingLedger', 'appendOnlySecStore', 'historicalUniverse', 'asOfLeakageGate',
        'adjustedOhlcv', 'corporateActionsDelistings', 'historicalGqsAdapter', 'conceptMapFrozen',
        'independentAuditPassed', 'blindCodingAgreementPassed', 'researchCorpusSealed',
      ].map((gate) => [gate, true]));
      gates.historicalUniverse = false;
      if (evaluateReadiness(gates).status !== fixture.expectedWhenAnyMissing
        || evaluateReadiness().status !== 'NOT_READY_TO_EXECUTE') failures.push(fixture.id);
      verifiedDirectly += 1;
    } else if (fixture.function === 'wilsonInterval') {
      const actual = wilsonInterval(fixture.successes, fixture.total);
      if (!(actual.estimate === fixture.expectedEstimate && actual.lower < fixture.expectedLowerThan)) failures.push(fixture.id);
      verifiedDirectly += 1;
    } else if (fixture.function === 'selectPrimaryTheme') {
      const actual = selectPrimaryTheme(fixture.rows, fixture.entityId, fixture.signalAvailableAt);
      if (!actual || actual.themeId !== fixture.expectedThemeId) failures.push(fixture.id);
      verifiedDirectly += 1;
    } else if (fixture.function === 'selectPrimarySignals') {
      const calendarSha256 = canonicalSha256(fixture.vintageCalendar);
      const calendarByMonth = new Map(fixture.vintageCalendar.map((item) => [item.vintageMonth, item]));
      const rows = fixture.rows.map((row) => {
        const item = calendarByMonth.get(row.vintageMonth);
        const eligible = ['PRE_GROWTH_CANDIDATE', 'MARKET_CONFIRMING'].includes(row.state);
        return {
          ...row,
          ...(eligible ? { candidateVintage: {
            vintageMonth: row.vintageMonth, evaluationAt: item.closeAt,
            signalAvailableAt: item.nextOpenAt, vintageCalendarSha256: calendarSha256,
          } } : {}),
          ...(row.state === 'MARKET_CONFIRMING' ? { marketRecognition: {
            status: 'COMPUTABLE', entityId: row.entityId, listingId: row.listingId, vintageMonth: row.vintageMonth,
            marketKnownAt: item.closeAt, signalAvailableAt: item.nextOpenAt, vintageCalendarSha256: calendarSha256,
          } } : {}),
        };
      });
      const actual = selectPrimarySignals(rows, fixture.vintageCalendar);
      if (actual.length !== fixture.expectedCount || actual[0].vintageMonth !== fixture.expectedFirstMonth) failures.push(fixture.id);
      verifiedDirectly += 1;
    } else if (fixture.function === 'matchControls') {
      const actual = matchControls(fixture.signal, fixture.controls);
      if (actual.map((row) => row.entityId).join(',') !== fixture.expectedEntityOrder.join(',')) failures.push(fixture.id);
      verifiedDirectly += 1;
    } else if (fixture.function === 'evaluateHFem') {
      const actual = evaluateHFem(fixture.gates);
      if (actual.status !== fixture.expectedStatus) failures.push(fixture.id);
      verifiedDirectly += 1;
    } else {
      failures.push(`${fixture.id}:unsupported_fixture_function`);
    }
  }
  const preregistration = readJson(path.join(PROTOCOL, 'preregistration.json'));
  if (fixtureFile.protocol !== 'FEM-SEC-US@1.2.0' || preregistration.identity.version !== '1.2.0') {
    failures.push('PROTOCOL-VERSION-MISMATCH');
  }
  for (const [level, rule] of [['1', 'M1'], ['2', 'M2'], ['3', 'M3']]) {
    if (preregistration.matrix.dimensions.M.levels[level] !== preregistration.technicalFeatures.candidateStateRules[rule]) {
      failures.push(`${rule}-PROTOCOL-SEMANTIC-MISMATCH`);
    }
  }
  if (failures.length) throw new Error(`fixture verification failed: ${failures.join(', ')}`);
  return { total: fixtureFile.fixtures.length, verifiedDirectly };
}

function listJsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function inspectKeys(value, output = new Set(), depth = 0) {
  if (depth > 8 || value == null) return output;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 5)) inspectKeys(item, output, depth + 1);
  } else if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      output.add(key);
      inspectKeys(child, output, depth + 1);
    }
  }
  return output;
}

function safeJson(file) {
  try { return readJson(file); } catch { return null; }
}

function priceInventory(overview) {
  const directory = path.join(ROOT, 'prices-max');
  const files = listJsonFiles(directory);
  const payloadFiles = files.filter((file) => !path.basename(file).startsWith('_manifest'));
  const standardManifest = safeJson(path.join(directory, '_manifest.json'));
  const researchManifest = safeJson(path.join(directory, '_manifest-research.json'));
  const standardTickers = Object.keys((standardManifest && standardManifest.done) || {});
  const researchTickers = Object.keys((researchManifest && researchManifest.done) || {});
  const payloadNames = new Set(payloadFiles.map((file) => path.basename(file, '.json')));
  const hasPayload = (ticker) => payloadNames.has(ticker) || (ticker === 'CON' && payloadNames.has('_CON'));
  const requested = ['SPY', ...overview.slice(0, 50).map((row) => row.ticker)];
  const unique = [...new Set(requested.map(String))];
  const sample = [];
  for (const ticker of unique) {
    const file = path.join(directory, `${ticker}.json`);
    if (!fs.existsSync(file)) continue;
    const bars = safeJson(file);
    if (!Array.isArray(bars)) continue;
    const snapshot = technicalSnapshot(bars);
    sample.push({
      ticker,
      rows: bars.length,
      firstDate: bars[0] && bars[0].date,
      lastDate: bars.at(-1) && bars.at(-1).date,
      adjustedClose: snapshot.dataCapabilities ? snapshot.dataCapabilities.adjustedClose : false,
      ohlc: snapshot.dataCapabilities ? snapshot.dataCapabilities.ohlc : false,
      volume: snapshot.dataCapabilities ? snapshot.dataCapabilities.volume : false,
    });
  }
  return {
    directory: 'prices-max',
    payloadJsonFiles: payloadFiles.length,
    payloadBytes: payloadFiles.reduce((sum, file) => sum + fs.statSync(file).size, 0),
    manifests: {
      standardEntries: standardTickers.length,
      standardEntriesWithPayload: standardTickers.filter(hasPayload).length,
      researchEntries: researchTickers.length,
      researchEntriesWithPayload: researchTickers.filter(hasPayload).length,
      provenanceWarning: 'The research manifest is present, but its upstream retrieval and corporate-action provenance have not passed the FEM data gate.',
    },
    deterministicSampleRule: 'SPY plus first 50 current overview rows when files exist',
    sampleCount: sample.length,
    sample,
    conclusion: sample.length && sample.every((row) => row.adjustedClose && !row.ohlc && !row.volume)
      ? 'ADJUSTED_CLOSE_ONLY_IN_SAMPLE'
      : 'MIXED_OR_UNPROVEN_CAPABILITY',
    confirmatoryOhlcvReady: false,
  };
}

function shortPriceHistoryInventory() {
  const directory = path.join(ROOT, 'prices', 'history');
  const metaFile = path.join(directory, '_meta.json');
  const meta = fs.existsSync(metaFile) ? safeJson(metaFile) : null;
  const shards = fs.existsSync(directory)
    ? fs.readdirSync(directory).filter((name) => /^history-\d+\.json$/.test(name)).sort()
    : [];
  let firstSample = null;
  if (shards.length) {
    const payload = safeJson(path.join(directory, shards[0]));
    const firstTicker = payload && Object.keys(payload).sort()[0];
    const bars = firstTicker ? payload[firstTicker] : null;
    firstSample = Array.isArray(bars) ? {
      ticker: firstTicker,
      rows: bars.length,
      keys: bars[0] ? Object.keys(bars[0]).sort() : [],
      firstDate: bars[0] && bars[0].date,
      lastDate: bars.at(-1) && bars.at(-1).date,
    } : null;
  }
  return {
    directory: 'prices/history',
    schema: meta && meta.schema,
    updatedAt: meta && meta.updatedAt,
    currentTickerCount: meta && meta.tickerCount,
    shards: shards.length,
    deterministicSample: firstSample,
    conclusion: 'CURRENT-TICKER ADJUSTED-CLOSE STORE; NOT A HISTORICAL POINT-IN-TIME UNIVERSE',
  };
}

function secInventory() {
  const directory = path.join(ROOT, 'external-data', 'sec-xbrl');
  const allFiles = listJsonFiles(directory);
  const files = allFiles.filter((file) => path.basename(file) !== '_manifest.json');
  const manifest = safeJson(path.join(directory, '_manifest.json'));
  const manifestEntries = Object.keys((manifest && manifest.entries) || {});
  const localNames = new Set(files.map((file) => path.basename(file, '.json')));
  const sampleFiles = files.slice(0, 25);
  const samples = sampleFiles.map((file) => {
    const payload = safeJson(file);
    const keys = payload ? [...inspectKeys(payload)].sort() : [];
    return {
      file: path.basename(file),
      parseable: Boolean(payload),
      hasFiledKey: keys.includes('filed'),
      hasAccessionKey: keys.includes('accn') || keys.includes('accessionNumber'),
      hasAcceptanceTimestamp: keys.includes('acceptanceDateTime') || keys.includes('accepted'),
    };
  });
  const bulk = path.join(ROOT, 'external-data', 'sec-annual-bulk.jsonl');
  let bulkSummary = { exists: false };
  if (fs.existsSync(bulk)) {
    const text = fs.readFileSync(bulk, 'utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    let first = null;
    try { first = JSON.parse(lines[0]); } catch { first = null; }
    const keys = first && typeof first === 'object' ? Object.keys(first).sort() : [];
    let companyYears = 0;
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        companyYears += row && row.annual && Array.isArray(row.annual._fys) ? row.annual._fys.length : 0;
      } catch { /* parseability is reflected by the count shortfall */ }
    }
    bulkSummary = {
      exists: true,
      bytes: fs.statSync(bulk).size,
      companyRows: lines.length,
      companyYearSlots: companyYears,
      firstRowKeys: keys,
      hasFilingAvailabilityInFirstRow: keys.some((key) => /filed|accept|published|known.?at/i.test(key)),
    };
  }
  return {
    directory: 'external-data/sec-xbrl',
    payloadJsonFiles: files.length,
    manifestEntries: manifestEntries.length,
    localPayloadsPresentInManifest: [...localNames].filter((name) => manifestEntries.includes(name)).length,
    localPayloadsAbsentFromManifest: [...localNames].filter((name) => !manifestEntries.includes(name)).length,
    deterministicSampleRule: 'first 25 filenames lexicographically',
    sampleCount: samples.length,
    sampleWithFiledKey: samples.filter((row) => row.hasFiledKey).length,
    sampleWithAccessionKey: samples.filter((row) => row.hasAccessionKey).length,
    sampleWithAcceptanceTimestamp: samples.filter((row) => row.hasAcceptanceTimestamp).length,
    annualBulk: bulkSummary,
    conclusion: 'USEFUL_FOR_PROTOTYPING_BUT_APPEND_ONLY_REVISION_AND_ACCEPTANCE_HISTORY_NOT_PROVEN',
    confirmatoryPitReady: false,
  };
}

function overviewInventory(overview) {
  const sectors = {};
  for (const row of overview) sectors[row.sector || 'Unknown'] = (sectors[row.sector || 'Unknown'] || 0) + 1;
  return {
    rows: overview.length,
    unitedStatesRows: overview.filter((row) => row.country === 'United States').length,
    sectors: Object.fromEntries(Object.entries(sectors).sort((a, b) => b[1] - a[1])),
    currentGqsTop20DescriptiveOnly: overview.slice(0, 20).map((row, index) => ({
      rank: index + 1,
      ticker: row.ticker,
      name: row.name,
      sector: row.sector,
      score: row.score,
    })),
    disclaimer: 'Current GQS output only. These rows are not FEM candidates, Elliott reviews, valuations or buy signals.',
  };
}

function buildInventory(protocolSealed, confirmatoryAnalysisImplementationSealed) {
  const overviewFile = path.join(ROOT, 'outputs', 'hypergrowth', 'overview.json');
  const overview = fs.existsSync(overviewFile) ? readJson(overviewFile) : [];
  const gates = {
    protocolSealed,
    confirmatoryAnalysisImplementationSealed,
    entityListingLedger: false,
    appendOnlySecStore: false,
    historicalUniverse: false,
    asOfLeakageGate: false,
    adjustedOhlcv: false,
    corporateActionsDelistings: false,
    historicalGqsAdapter: false,
    conceptMapFrozen: false,
    independentAuditPassed: false,
    blindCodingAgreementPassed: false,
    researchCorpusSealed: false,
  };
  const readiness = evaluateReadiness(gates);
  const report = {
    schema: 'early-detection-data-inventory/v1',
    generatedAt: new Date().toISOString(),
    protocol: 'FEM-SEC-US@1.2.0',
    status: 'DESCRIPTIVE_ONLY',
    overview: overviewInventory(overview),
    prices: priceInventory(overview),
    shortPriceHistory: shortPriceHistoryInventory(),
    sec: secInventory(),
    readiness: { ...readiness, gates },
    forbiddenConclusions: [
      'GQS is late',
      'FEM detects future growth',
      'technical indicators predict growth',
      'the non-AI universe is robust',
      'a company is investable or technically buyable',
    ],
    environmentSmokes: {
      status: 'SEPARATE_NON_SEALING_GATE',
      excludedPrefixes: VOLATILE_ENVIRONMENT_TEST_PREFIXES,
      reason: 'Discovery smoke tests call live external registers and may return 429/5xx independently of repository correctness.',
    },
  };
  writeJson(path.join(REPORT_DIR, 'current-descriptive-inventory.json'), report);
  writeJson(path.join(REPORT_DIR, 'readiness.json'), {
    schema: 'early-detection-readiness/v1',
    protocol: 'FEM-SEC-US@1.2.0',
    generatedAt: report.generatedAt,
    ...report.readiness,
  });
  writeJson(path.join(REPORT_DIR, 'elliott-review.json'), {
    schema: 'early-detection-elliott-review/v1',
    protocol: 'FEM-SEC-US@1.2.0',
    generatedAt: report.generatedAt,
    status: 'NOT_READY',
    candidates: [],
    reason: 'No company yet has accepted T/E/L evidence from a sealed point-in-time research corpus. Empty is the only non-misleading result.',
    disclaimer: 'No valuation, buy signal, technical buyability or Elliott-wave count is produced here.',
  });
  return report;
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--seal')) {
    const files = seal();
    console.log(`sealed ${Object.keys(files).length} files`);
  }
  const manifest = verifyManifest();
  const remoteSeal = args.has('--seal') ? null : verifyRemoteManifest();
  const fixtures = verifyFixtures();
  const accessLedger = verifyOutcomeAccessLedger(args.has('--seal'));
  console.log(`manifest PASS ${Object.keys(manifest.files).length} files`);
  if (remoteSeal) console.log(`remote-manifest PASS ${remoteSeal.manifestSha256} at ${remoteSeal.remoteHead}`);
  console.log(`fixtures PASS ${fixtures.verifiedDirectly}/${fixtures.total} contracts directly executed`);
  console.log(`outcome-access-ledger PASS ${accessLedger.events} event(s)`);

  if (args.has('--inventory') || args.size === 0 || args.has('--execute-confirmatory')) {
    const report = buildInventory(true, accessLedger.externallyCheckpointed === true);
    console.log(`inventory ${report.status}; confirmatory=${report.readiness.resultComputationAllowed}`);
    if (args.has('--execute-confirmatory')) {
      throw new Error(`CONFIRMATORY EXECUTION BLOCKED: ${report.readiness.missing.join(', ')}`);
    }
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[early-detection-audit] ${error.message}`);
    process.exit(1);
  }
}

module.exports = { buildManifest, deterministicTestFiles, outcomeCheckpointHistoryIssues, outcomeCheckpointIssues, seal, verifyFixtures, verifyManifest, verifyOutcomeAccessLedger, verifyRemoteManifest };
