'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'build-finra-q004-public-catalog-v1.py');
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'finra-q004-public-catalog-contract-v1.json');
const CONTRACT_RAW_SHA256 = 'fc85cc48194b4408ec7f917321a71d85cf7c1265d56acbec42b6a5e76a489654';
const DATA_URL = 'https://api.finra.org/data/group/otcMarket/name/OTCDAILYLIST';

function sha256(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function runPython(args, input = undefined) {
  return spawnSync('python', args, {
    cwd: ROOT,
    input,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

function row(id, time, flags = {}) {
  return {
    OTCDailyListID: id,
    calendarDay: '2020-01-02',
    dailyListDatetime: `2020-01-02 ${time}.000`,
    dailyListEventCode: 'TEST',
    securityAddFlag: 'N',
    securityDeleteFlag: 'N',
    changeSymbolFlag: 'N',
    changeSecurityDescriptionFlag: 'N',
    changeSecurityAttributeFlag: 'N',
    changeFinancialStatusFlag: 'N',
    bankruptcyFlag: 'N',
    dividendNonADRFlag: 'N',
    dividendADRFlag: 'N',
    ...flags,
  };
}

function requestBody(offset) {
  const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
  return {
    fields: contract.dataset.catalogOnlyFields,
    dateRangeFilters: [{ fieldName: 'calendarDay', startDate: '2020-01-02', endDate: '2020-01-02' }],
    limit: 2,
    offset,
    sortFields: ['+calendarDay', '+dailyListDatetime', '+OTCDailyListID'],
  };
}

function page(rows, offset, total) {
  const body = requestBody(offset);
  const request = { method: 'POST', url: DATA_URL, body };
  const raw = Buffer.from(canonical(rows));
  const headers = {
    'content-type': 'application/json',
    'record-total': String(total),
    'record-offset': String(offset),
    'record-limit': '2',
    'total-records-on-page': String(rows.length),
  };
  return {
    request: { ...request, canonicalSha256: sha256(Buffer.from(canonical(request))) },
    response: {
      status: 200,
      headers,
      headersCanonicalSha256: sha256(Buffer.from(canonical(headers))),
      bodyBase64: raw.toString('base64'),
      rawSha256: sha256(raw),
      observedAt: '2026-08-12T15:00:00Z',
    },
  };
}

function fixture() {
  const rows = [
    row(10, '09:00:00', { securityAddFlag: 'Y' }),
    row(11, '10:00:00', { changeSymbolFlag: 'Y' }),
    row(12, '11:00:00', { securityDeleteFlag: 'Y', bankruptcyFlag: 'Y' }),
    row(13, '12:00:00', { dividendNonADRFlag: 'Y' }),
  ];
  return {
    schema: 'finra-q004-capture-fixture/v1',
    contractRawSha256: CONTRACT_RAW_SHA256,
    observedAt: '2026-08-12T15:00:01Z',
    pages: [page(rows.slice(0, 2), 0, 4), page(rows.slice(2), 2, 4)],
  };
}

function refreshResponse(candidate, pageIndex, rows) {
  const target = candidate.pages[pageIndex];
  const raw = Buffer.from(canonical(rows));
  target.response.bodyBase64 = raw.toString('base64');
  target.response.rawSha256 = sha256(raw);
  target.response.headersCanonicalSha256 = sha256(Buffer.from(canonical(target.response.headers)));
}

function refreshRequest(candidate, pageIndex) {
  const target = candidate.pages[pageIndex].request;
  target.canonicalSha256 = sha256(Buffer.from(canonical({ method: target.method, url: target.url, body: target.body })));
}

test('contract records the real free/account/terms split and keeps every claim lock false', () => {
  const raw = fs.readFileSync(CONTRACT);
  const contract = JSON.parse(raw);
  assert.equal(sha256(raw), CONTRACT_RAW_SHA256);
  assert.equal(contract.schema, 'finra-q004-public-catalog-contract/v1');
  assert.equal(contract.bindings.baselineRemoteHead, '56eebdda0fe727d0b1f0714146ee0c28cf30301d');
  const lanes = Object.fromEntries(contract.accessLanes.map((lane) => [lane.laneId, lane]));
  assert.equal(lanes.PUBLIC_CREDENTIAL_QUERY_API.monthlyPriceUsd, 0);
  assert.equal(lanes.PUBLIC_CREDENTIAL_QUERY_API.accountRequired, true);
  assert.equal(lanes.PUBLIC_CREDENTIAL_QUERY_API.permittedInThisNoAccountContract, false);
  assert.equal(lanes.OTCE_WEBSITE_AND_ARCHIVES.classification, 'PUBLIC_VIEW_ONLY_AUTOMATED_CRAWL_LICENSE_UNRESOLVED');
  assert.match(lanes.OTCE_WEBSITE_AND_ARCHIVES.disposition, /BLOCKED_NO_EXPRESS/);
  assert.equal(lanes.FIRM_OR_ORGANIZATION_QUERY_API.monthlyPriceUsd, 1650);
  assert.equal(lanes.FIRM_OR_ORGANIZATION_QUERY_API.disposition, 'PROHIBITED_PAID');
  assert.equal(contract.networkPolicy.networkExecutionAuthorized, false);
  assert.equal(contract.networkPolicy.requestsPerRunMaximum, 0);
  assert.equal(contract.networkPolicy.automaticRetriesAllowed, false);
  assert.equal(contract.networkPolicy.redirectsAllowed, false);
  assert.equal(contract.networkPolicy.proxyUseAllowed, false);
  assert.equal(contract.networkPolicy.proxyBypassAllowed, false);
  assert.deepEqual(new Set(Object.values(contract.claimLocks)), new Set([false]));
  assert.ok(contract.claimCeiling.forbidden.includes('TICKER_ONLY_IDENTITY'));
  assert.ok(contract.claimCeiling.forbidden.includes('TERMINAL_PAYMENT_OR_TERMINAL_WEALTH'));
  assert.ok(contract.claimCeiling.forbidden.includes('PRICE_RETURN_OR_OUTCOME'));
  assert.ok(contract.claimCeiling.forbidden.includes('ORIGINAL_V4_GATE_CREDIT'));
});

test('contract verification, dry run and offline adversarial self-test pass in normal and optimized Python', () => {
  for (const prefix of [[SCRIPT], ['-O', SCRIPT]]) {
    let result = runPython([...prefix, 'verify-contract']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).status, 'PASS');
    result = runPython([...prefix, 'dry-run']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const dry = JSON.parse(result.stdout);
    assert.equal(dry.status, 'BLOCKED_AS_DESIGNED');
    assert.equal(dry.networkRequests, 0);
    assert.equal(dry.filesWritten, 0);
    result = runPython([...prefix, 'self-test']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const self = JSON.parse(result.stdout);
    assert.equal(self.status, 'PASS');
    assert.equal(self.tests, 17);
    assert.equal(self.networkRequests, 0);
  }
});

test('no-account crawl is impossible in normal and optimized Python', () => {
  for (const prefix of [[SCRIPT], ['-O', SCRIPT]]) {
    const result = runPython([...prefix, 'crawl']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /NETWORK_EXECUTION_NOT_AUTHORIZED_NO_ACCOUNT_CONTRACT/);
  }
});

test('valid offline pages produce only catalog counts, hashes and candidate-only claims', () => {
  const result = runPython([SCRIPT, 'build-fixture'], JSON.stringify(fixture()));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const catalog = JSON.parse(result.stdout);
  assert.equal(catalog.schema, 'finra-q004-public-catalog/v1');
  assert.equal(catalog.partitions[0].recordTotal, 4);
  assert.equal(catalog.eventClassCounts.OTC_SECURITY_ADDITION, 1);
  assert.equal(catalog.eventClassCounts.OTC_SECURITY_DELETION, 1);
  assert.equal(catalog.eventClassCounts.OTC_BANKRUPTCY_FLAG, 1);
  assert.equal(catalog.eventClassCounts.OTC_DIVIDEND_DISTRIBUTION_OR_SPLIT, 1);
  assert.equal(catalog.claimCeiling, 'EVENT_CATALOG_CANDIDATE_ONLY');
  assert.deepEqual(new Set(Object.values(catalog.claimLocks)), new Set([false]));
  assert.doesNotMatch(result.stdout, /FAKE|cashAmountText|issueName|oldSymbolCode/);
  assert.equal(catalog.catalogSha256.length, 64);
});

test('atomic write-new creates one exact catalog and refuses replacement', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finra-q004-test-'));
  const output = path.join(directory, 'catalog.json');
  try {
    let result = runPython([SCRIPT, 'build-fixture', '--output', output], JSON.stringify(fixture()));
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(output), true);
    const written = fs.readFileSync(output);
    assert.equal(JSON.parse(result.stdout).outputRawSha256, sha256(written));
    result = runPython([SCRIPT, 'build-fixture', '--output', output], JSON.stringify(fixture()));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /output already exists/);
    assert.equal(sha256(fs.readFileSync(output)), sha256(written));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP-200 error bodies, response tampering and redirects fail closed', () => {
  let candidate = fixture();
  let raw = Buffer.from('{"error":"login required"}');
  candidate.pages[0].response.bodyBase64 = raw.toString('base64');
  candidate.pages[0].response.rawSha256 = sha256(raw);
  let result = runPython([SCRIPT, 'build-fixture'], JSON.stringify(candidate));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /HTTP 200 error/);

  candidate = fixture();
  candidate.pages[0].response.rawSha256 = '0'.repeat(64);
  result = runPython(['-O', SCRIPT, 'build-fixture'], JSON.stringify(candidate));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /raw response hash mismatch/);

  candidate = fixture();
  candidate.pages[0].response.headers.location = 'https://example.invalid/redirect';
  candidate.pages[0].response.headersCanonicalSha256 = sha256(Buffer.from(canonical(candidate.pages[0].response.headers)));
  result = runPython([SCRIPT, 'build-fixture'], JSON.stringify(candidate));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /redirect/);
});

test('pagination loss, duplication, overlap and count drift fail closed', () => {
  let candidate = fixture();
  let rows = JSON.parse(Buffer.from(candidate.pages[1].response.bodyBase64, 'base64').toString('utf8'));
  rows.pop();
  candidate.pages[1].response.headers['total-records-on-page'] = '1';
  refreshResponse(candidate, 1, rows);
  let result = runPython([SCRIPT, 'build-fixture'], JSON.stringify(candidate));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /row loss|incomplete exhaustion/);

  candidate = fixture();
  rows = JSON.parse(Buffer.from(candidate.pages[1].response.bodyBase64, 'base64').toString('utf8'));
  rows[0].OTCDailyListID = 10;
  refreshResponse(candidate, 1, rows);
  result = runPython(['-O', SCRIPT, 'build-fixture'], JSON.stringify(candidate));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /duplicate/);

  candidate = fixture();
  candidate.pages[1].request.body.offset = 3;
  candidate.pages[1].response.headers['record-offset'] = '3';
  refreshRequest(candidate, 1);
  candidate.pages[1].response.headersCanonicalSha256 = sha256(Buffer.from(canonical(candidate.pages[1].response.headers)));
  result = runPython([SCRIPT, 'build-fixture'], JSON.stringify(candidate));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /pagination gap/);

  candidate = fixture();
  candidate.pages[1].response.headers['record-total'] = '5';
  candidate.pages[1].response.headersCanonicalSha256 = sha256(Buffer.from(canonical(candidate.pages[1].response.headers)));
  result = runPython([SCRIPT, 'build-fixture'], JSON.stringify(candidate));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /record-total drift/);
});

test('ticker-only, payment, terminal/outcome-shaped and date-inverted rows fail closed', () => {
  for (const [field, value, pattern] of [
    ['symbolCode', 'FAKE', /exact keys mismatch/],
    ['cashAmountText', '1.00', /exact keys mismatch/],
    ['terminalPayment', 1, /exact keys mismatch/],
    ['return', 0.1, /exact keys mismatch/],
  ]) {
    const candidate = fixture();
    const rows = JSON.parse(Buffer.from(candidate.pages[0].response.bodyBase64, 'base64').toString('utf8'));
    rows[0][field] = value;
    refreshResponse(candidate, 0, rows);
    const result = runPython(['-O', SCRIPT, 'build-fixture'], JSON.stringify(candidate));
    assert.equal(result.status, 2);
    assert.match(result.stderr, pattern);
  }

  const candidate = fixture();
  const rows = JSON.parse(Buffer.from(candidate.pages[0].response.bodyBase64, 'base64').toString('utf8'));
  rows[0].dailyListDatetime = '2030-01-02 09:00:00.000';
  refreshResponse(candidate, 0, rows);
  const result = runPython([SCRIPT, 'build-fixture'], JSON.stringify(candidate));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /date inversion|partition loss/);
});

test('runner exposes no network, secret, proxy, retry or account surface', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(source, /urllib|requests\.|http\.client|socket\.|aiohttp|fetch\(/);
  assert.doesNotMatch(source, /os\.environ|os\.getenv|API[_-]?KEY|CLIENT[_-]?SECRET|BEARER/i);
  assert.doesNotMatch(source, /ProxyHandler|HTTPRedirectHandler|retry_after|sleep\(/i);
  assert.match(source, /NETWORK_EXECUTION_NOT_AUTHORIZED_NO_ACCOUNT_CONTRACT/);
  assert.match(source, /EXPECTED_CONTRACT_RAW_SHA256/);
  assert.match(source, /atomic_write_new/);
});
