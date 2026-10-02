'use strict';

// Historical commits that tests pin by id (`git show <commit>:<path>`).
//
// A history rewrite that only replaces personal strings keeps every author and committer
// date and every subject line, but gives the commits new ids. A test that pins the old id
// would then read nothing, and the only way to keep it green would be to edit the test in
// the rewritten checkout - so the tested state would no longer be the published state.
//
// resolveCommit(pinned) therefore checks a commit by its FINGERPRINT (raw author date,
// raw committer date, subject), never by its id alone:
//   1. the pinned id exists        -> its fingerprint must match (else throw), return it;
//   2. the pinned id is missing    -> the one reachable commit with that fingerprint
//                                     (two or more -> throw), return its id;
//   3. no commit has it            -> return the pinned id unchanged, so the caller fails
//                                     or skips exactly as it did before.
// What a test proves about the commit's CONTENT (sha256 of the bytes it reads) is untouched:
// a commit found by fingerprint must still carry the very bytes the test pins.
//
// Every pinned id must be registered here; an unregistered one throws, so a new pin cannot
// silently fall back to id-only matching. Dates are `--date=raw` (epoch + zone), which every
// git version prints the same way.

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');

const ANCHORS = [
  { id: '10e08e3746494ca7f064dc773fbdcf92e931ceea', authorDate: '1788248139 +0200', committerDate: '1788248139 +0200',
    subject: 'F6 konfirmatorischer Akt: Serverbeweis (VB-A11-Zeitkette, f6-konfirmatorisch-2026-09-01) (#214)' },
  { id: 'aeefb681254d6f94d55dd08c9c2a091367e37e8e', authorDate: '1788252446 +0200', committerDate: '1788252446 +0200',
    subject: 'PR G+H: die zehn Naht-Fixes und die ANHANG-3-Verdrahtung (NICHT MERGEN) (#215)' },
  { id: 'f949cbc5f9cd8e01fb781a5f3cb951036c69b35f', authorDate: '1788296354 +0200', committerDate: '1788296354 +0200',
    subject: 'F6-K13/K14/K15: Wurzelreparatur des Wachpostens — VORGELEGT, nicht zu mergen (#229)' },
  { id: '3961ed8ace6595a7e3956ac42c465789ef5f7d99', authorDate: '1788331278 +0200', committerDate: '1788331278 +0200',
    subject: 'Split pence factor: aggregates use the major unit, per-share quotes the sub-unit (#252)' },
  { id: '3d0073abe92de60f4766a5b5b2cb14103697f4bb', authorDate: '1788334389 +0200', committerDate: '1788334389 +0200',
    subject: 'F6: Arbeitsbaum-Drift der Vorsitzung als benannter Wechsel' },
  { id: '2f809246e48fbf76bdabc8ced3185b4feaec6f22', authorDate: '1788343102 +0200', committerDate: '1788343102 +0200',
    subject: 'F6: SE-Fang an drei Sterbestellen und Ketten-Aufloesung in beiden Phasen (#253)' },
  { id: '6f11048063b622a53a0fd0f2e0e9f40ca2a7ff05', authorDate: '1790240065 +0000', committerDate: '1790240065 +0000',
    subject: 'chore: yahoo-pull 2026-09-24T08:54:25Z' },
  { id: '2f8a20d97eaa6b9879a6d7f6a27f50b0d3e7c9d0', authorDate: '1786866241 +0200', committerDate: '1786866241 +0200',
    subject: 'Tag 925: Q010-SC005 nativen Routenlaufzeitgraph reparieren' },
];

const FORMAT = '%H%x00%ad%x00%cd%x00%s';
const key = (a) => [a.authorDate, a.committerDate, a.subject].join('\0');

function gitLog(repo, args) {
  const r = spawnSync('git', ['log', '--date=raw', `--format=${FORMAT}`, ...args],
    { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) return null;
  return r.stdout.split('\n').filter(Boolean).map((line) => {
    const [id, authorDate, committerDate, ...subject] = line.split('\0');
    return { id, authorDate, committerDate, subject: subject.join('\0') };
  });
}

const indexCache = new Map();
function fingerprintIndex(repo) {
  if (!indexCache.has(repo)) {
    const index = new Map();
    for (const c of gitLog(repo, ['--all']) || []) {
      const k = key(c);
      index.set(k, [...(index.get(k) || []), c.id]);
    }
    indexCache.set(repo, index);
  }
  return indexCache.get(repo);
}

function resolveCommit(pinned, { repo = REPO, anchors = ANCHORS } = {}) {
  const hits = anchors.filter((a) => a.id.startsWith(String(pinned).toLowerCase()));
  if (String(pinned).length < 7 || hits.length !== 1) {
    throw new Error(`history anchor ${pinned} is not registered (exactly once) in tests/helpers/history-anchor.js`);
  }
  const anchor = hits[0];
  const own = gitLog(repo, ['-1', '--no-walk', `${anchor.id}^{commit}`]);
  if (own && own.length === 1) {
    if (key(own[0]) !== key(anchor)) {
      throw new Error(`history anchor ${pinned}: the commit exists but its fingerprint differs from the registry`);
    }
    return pinned;
  }
  const found = fingerprintIndex(repo).get(key(anchor)) || [];
  if (found.length > 1) {
    throw new Error(`history anchor ${pinned}: ${found.length} commits share its fingerprint (${found.join(', ')})`);
  }
  return found.length === 1 ? found[0] : pinned;
}

module.exports = { ANCHORS, resolveCommit };
