const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'run-sec-13f-official-list-private-pilot-v1.py');
const contract = path.join(root, 'research', 'early-detection-v4', 'sec-13f-official-list-private-pilot-contract-v1.json');
const publicOutput = path.join(root, 'reports', 'early-detection', 'sec-13f-official-list-private-pilot-report-v1.json');

function run(args, optimized = false) {
  const pythonArgs = optimized ? ['-O', '-B', script, ...args] : ['-B', script, ...args];
  const result = spawnSync('python', pythonArgs, { cwd: root, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

assert.strictEqual(run(['verify-contract']).status, 'PASS');
assert.strictEqual(run(['verify-contract'], true).status, 'PASS');
const normal = run(['self-test']);
const optimized = run(['self-test'], true);
assert.deepStrictEqual(normal, optimized);
assert.strictEqual(normal.cusipWithPrimarySecLabelParsed, true);
assert.strictEqual(normal.unlabelledCusipRejected, true);
assert.strictEqual(normal.publicCusipExportForbidden, true);
assert.strictEqual(normal.identityCreditForbidden, true);

const value = JSON.parse(fs.readFileSync(contract, 'utf8'));
assert.strictEqual(value.pilotPolicy.networkRequests, 1);
assert.strictEqual(value.pilotPolicy.privateRawStorageRequired, true);
assert.strictEqual(value.pilotPolicy.publicRawCusipStorageAllowed, false);
assert.strictEqual(value.pilotPolicy.issuerNameOnlyMatchAllowed, false);
assert.strictEqual(value.pilotPolicy.tickerOnlyJoinAllowed, false);
assert.strictEqual(value.pilotPolicy.pointEvidenceMayResolveIdentity, false);
assert.strictEqual(value.claimLocks.outcomesAccessed, false);
assert.strictEqual(value.claimLocks.pricesAccessed, false);
assert.strictEqual(value.claimLocks.originalV4GateCredit, false);
assert.strictEqual(fs.existsSync(publicOutput), false);

console.log(JSON.stringify({ status: 'PASS', publicOutputAbsent: true, privatePilotOnly: true }));
