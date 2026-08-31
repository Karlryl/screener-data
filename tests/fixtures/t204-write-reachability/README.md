# T204 synthetic write-reachability fixtures

Every payload in this directory is fabricated for writer testing. None is a
study input, an outcome, a SEC response, or a production report. The harness
requires byte-copied scripts from a fresh OS temp tree and invokes only their
exported writer seams; script mains and command paths are never executed.

The fixture hashes are pinned in `tests/t204-write-reachability.test.js`.
