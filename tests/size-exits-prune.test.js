'use strict';
// Only virtual files are deleted. Source mutants stay in memory; writing tests are never mutation targets.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const sourcePath = path.join(ROOT, 'lib/size-exits.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const targets = [sourcePath, path.join(ROOT, 'pull-yahoo.js')];
const hashes = () => targets.map(p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
const before = hashes();
const out = path.join(ROOT, '_scratch', 'size-exits-prune-virtual');
const now = Date.parse('2026-10-08T12:00:00Z'), week = 7 * 86400000;
const report = n => `_manifest-size-exits.shard-${n}.run-123456-1.json`;

function check(text) {
  const module = { exports: {} };
  vm.runInNewContext(text, { module, __dirname: path.dirname(sourcePath), console,
    require(id) { if (id === 'path') return path;
      if (id === 'fs') return new Proxy({}, { get() { assert.fail('Production fs must never be used'); } });
      if (id === './atomic-write.js') return { writeFileAtomic() { assert.fail('No writes allowed'); } };
      assert.fail('Unexpected import'); } });
  const files = new Map([
    [report(0), now - week - 1000], [report(1), now - week + 1000], [report(2), now - week],
    [report(3), now - week - 1000], ['_manifest-size-exits.json', 0], ['AAPL.json', 0],
    ['_manifest-size-exits.shard-x.run-123456-1.json', 0], ['report.json', 0],
    [report(4), 0], [report(5), 0], [report(6), 0], [report(7), NaN], [report(8), 0],
  ]);
  const warnings = [], unlinked = [], stats = [];
  const basename = p => { assert.equal(path.dirname(p), out, 'only the virtual output directory'); return path.basename(p); };
  const io = {
    readdirSync(p) { assert.equal(p, out); return [...files.keys()]; },
    statSync(p) { const name = basename(p); stats.push(name);
      if (name === report(4)) throw new Error('stat denied');
      return { mtimeMs: files.get(name), isFile: () => name !== report(8) }; },
    unlinkSync(p) { const name = basename(p);
      if (name === report(5)) throw new Error('unlink denied');
      unlinked.push(name); files.delete(name); },
  };
  const removed = module.exports.pruneSizeExitReports(out, path.join(out, report(3)), {
    fs: io, clock: () => now, warn: s => warnings.push(s),
  });
  assert.deepEqual(Array.from(removed), [report(0), report(6)], 'strict seven-day boundary and failure isolation');
  assert.deepEqual(unlinked, [report(0), report(6)]);
  for (const name of [report(1), report(2), report(3), report(4), report(5), report(7), report(8),
    '_manifest-size-exits.json', 'AAPL.json', '_manifest-size-exits.shard-x.run-123456-1.json', 'report.json']) {
    assert(files.has(name), 'must keep ' + name);
  }
  assert(!stats.includes(report(3)), 'current report is protected before stat');
  assert(!stats.includes('_manifest-size-exits.json'), 'merged report is never examined');
  assert.equal(warnings.length, 2);
  assert(warnings.some(s => s.includes(report(4)) && s.includes('stat denied')));
  assert(warnings.some(s => s.includes(report(5)) && s.includes('unlink denied')));
  const unreadable = module.exports.pruneSizeExitReports(out, path.join(out, report(3)), {
    fs: { readdirSync() { throw new Error('directory denied'); } }, clock: () => now, warn: s => warnings.push(s),
  });
  assert.deepEqual(Array.from(unreadable), []);
  assert(warnings.at(-1).includes(out) && warnings.at(-1).includes('directory denied'));
}

check(source);
console.log('PASS prune: seven-day boundaries, current/merged/nonmatching protection, stat/unlink warnings and continued deletion');
function actualPull(mutation) {
  return spawnSync(process.execPath, [path.join(__dirname, 'size-exits.test.js'), '--prune-only'], {
    cwd: ROOT, encoding: 'utf8', timeout: 30000, env: { ...process.env, SIZE_EXIT_MUTATION: mutation || '' },
  });
}
const pull = actualPull();
assert.equal(pull.status, 0, pull.stderr);
assert.match(pull.stdout, /PASS actual pullAll prune/);
console.log(pull.stdout.trim());
if (process.argv.includes('--break-once')) {
  const mutations = [
    ['age', '      if (!stat.isFile() || !(stat.mtimeMs < cutoff)) continue;', '      if (!stat.isFile() || !(stat.mtimeMs > cutoff)) continue;'],
    ['boundary', '      if (!stat.isFile() || !(stat.mtimeMs < cutoff)) continue;', '      if (!stat.isFile() || !(stat.mtimeMs <= cutoff)) continue;'],
    ['scope', '    if (!SIZE_EXIT_SHARD_PATTERN.test(file) || path.resolve(filePath) === path.resolve(currentReport)) continue;', '    if (path.resolve(filePath) === path.resolve(currentReport)) continue;'],
    ['current', '    if (!SIZE_EXIT_SHARD_PATTERN.test(file) || path.resolve(filePath) === path.resolve(currentReport)) continue;', '    if (!SIZE_EXIT_SHARD_PATTERN.test(file)) continue;'],
    ['delete', '      io.unlinkSync(filePath);', '      // mutant: report removal without deleting'],
    ['warning', '    } catch (e) { warn(`[size-exits] ${file}: ${e.message}`); }', '    } catch (e) { /* mutant: silent failure */ }'],
    ['continue', '    } catch (e) { warn(`[size-exits] ${file}: ${e.message}`); }', '    } catch (e) { warn(`[size-exits] ${file}: ${e.message}`); break; }'],
  ];
  for (const [name, from, to] of mutations) {
    const lines = source.split(/\r?\n/);
    assert.equal(lines.filter(l => l === from).length, 1, 'whole-line anchor ' + name);
    assert.throws(() => check(lines.map(l => l === from ? to : l).join('\n')), assert.AssertionError);
    assert.deepEqual(hashes(), before, 'live sources unchanged after ' + name);
    console.log('BREAK_ONCE prune ' + name + ' detected=true liveHashesUnchanged=true');
  }
  const broken = actualPull('prune-call');
  assert.equal(broken.status, 1, broken.stderr);
  assert.match(broken.stderr, /AssertionError.*prune must precede the first checkpoint/s);
  assert.deepEqual(hashes(), before, 'live sources unchanged after call-site mutation');
  console.log('BREAK_ONCE prune actual-pullAll-call exit=1 detected=true liveHashesUnchanged=true');
}
assert.deepEqual(hashes(), before);
console.log('size-exits-prune.test.js: all passed; diskWrites=0 networkCalls=0');
