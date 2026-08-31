# T204 synthetic write-reachability fixtures

Every payload in this directory is fabricated for writer testing. None is a
study input, an outcome, a SEC response, or a production report. The harness
requires byte-copied scripts and `lib/atomic-write.js` from a fresh OS temp tree
and invokes only their exported writer seams; script mains and command paths are
never executed. Runtime traces prove sibling-temp opens and target renames. One
non-retryable EIO rename failure per target proves the old target survives and
the abandoned temp file is cleaned. An executed direct-writer twin proves the
runtime assertions turn red against the pre-conversion behaviour.

The fixture hashes are pinned in `tests/t204-write-reachability.test.js`.
