(c) MIXED at the wiring/design level: candidates have a proven artifact-handoff gap and 13F awaits a manual import by design, but the actual CI input inventory and failure reason remain unverified (confidence 95%; `.github/workflows/daily-pull.yml:1342-1345`, `scripts/druckenmiller-13f.js:6-8`, `scripts/write-druckenmiller-export.js:745-754`).

## Evidence boundary and observations

Observation O1: initial `git status --porcelain` printed `?? sd-t048/`; that pre-existing, untracked path was not inspected or changed. Consequently the requested final status containing ONLY the report cannot be achieved without touching somebody else's path.

Observation O2: `Get-Date -Format o` returned `2026-09-20T18:20:19.4789982+02:00`. `Test-Path -LiteralPath 'outputs/findash-export/v1/druckenmiller'` returned `False`; no local export or `_FAILED.json` was available to inspect. These are local observations, not statements about GitHub's deployed files.

Observation O3: the supplied source whitelist excludes `druckenmiller-history/`, `prices/`, `snapshots/`, raw XML locations and CI logs. Their actual contents were not inspected. The required test was executed as explicitly requested; its own reads include supporting files outside the manual inspection whitelist (`tests/druckenmiller/ci-wiring.test.js:108`, `:144`, `:153`).

Premise correction (confidence 100% for code behavior): `--check` is NOT read-only; it calls the marker writer on failure, which removes other export files and writes `_FAILED.json`. Also, the “noch ohne ...” log is NOT itself a failure condition: a valid two-file export is explicitly accepted by W8. Thus “two absent files therefore step 21 writes the marker” does not follow from the current code. The exact live cause requires the marker's `reason` or the failing check log, unavailable here (O2). Evidence: `scripts/write-druckenmiller-export.js:728-754`, `scripts/druckenmiller-log-internals.js:515-529`, `tests/druckenmiller/write-export.test.js:248-252`.

## 1. Daily calls and file-set selection

| Job / named step | Exact command | Mode |
| --- | --- | --- |
| scoring / Druckenmiller-Export schreiben (fail-soft) | `node scripts/write-druckenmiller-export.js || true` | Default write; no chunk argument (`.github/workflows/daily-pull.yml:2121-2122`). |
| scoring / Druckenmiller-Export pruefen (fail-soft, schreibt _FAILED.json) | `node scripts/write-druckenmiller-export.js --check || true` | Check, shell suppresses nonzero exit (`.github/workflows/daily-pull.yml:2124-2125`). |
| druckenmiller-guard / Druckenmiller-Export pruefen (scharf) | `node scripts/write-druckenmiller-export.js --check` | Same check, nonzero exit is not suppressed (`.github/workflows/daily-pull.yml:2619-2620`). |

The CLI selects only check versus write; directories default to history, export, prices and protocol. There is no chunk-mode switch and no chunk-2 pin. Writing always starts with regime/meta, adds 13F if normalized quarter files are present, and adds candidates if the candidates ledger exists (confidence 100%; `scripts/write-druckenmiller-export.js:45-49`, `:599-630`, `:1086-1109`).

The arrays are validation requirements, not producer switches: `DATEIEN_CHUNK1` = two files, `DATEIEN_CHUNK2` adds candidates, `DATEIEN_CHUNK3` adds 13F. Check selects chunk 3 if history/13f contains any `YYYY-MM-DD.json`, otherwise chunk 2 if the candidates ledger exists, otherwise chunk 1. `ALLE_DATEIEN` covers stamp validation of every PRESENT contract file; absent files are skipped in that loop (confidence 100%; `scripts/write-druckenmiller-export.js:54-57`, `:745-766`).

## 2. Producers, prerequisites and the missing handoff

**Candidates:** the export writer itself writes `candidates.json`; the logger writes its INPUT, `druckenmiller-history/candidates-ledger.jsonl`. The writer also needs the internals chain, latest raw rows and registration A; prices supply sessions and registration B supplies an optional display schedule. Missing B is handled with a warning, not by withholding candidates (confidence 100%; `scripts/write-druckenmiller-export.js:126-152`, `:567-587`, `:618-628`; `scripts/druckenmiller-log-internals.js:480-490`).

The daily merge job already calls the logger without flags. Its candidate producer uses the loaded price sessions, snapshots and registrations; there is no additional candidates network-fetch step to wire. However, its artifact carries ONLY the internals ledger, its sidecar and raw rows. It omits the candidate ledger and its sidecar; scoring and the guard download that same incomplete artifact. This is a proven handoff gap, not a missing logger invocation (confidence 100%; `.github/workflows/daily-pull.yml:1176-1178`, `:1336-1347`, `:2109-2113`, `:2589-2590`; `scripts/druckenmiller-log-internals.js:359-390`, `:480-490`; sidecar naming: `lib/druckenmiller/ledger.js:36`).

A second, independent candidate condition matters for the reported date: the logger chooses targets strictly AFTER the latest internals-ledger date and returns before candidate initialization when no new session exists. Therefore merely merging Chunk 2 and rerunning against the same last session need not create the first candidates ledger. This is a code-supported alternative, not proof that the reported run took this branch; production availability is unverified under O3 (confidence 100% for the branch, 50% for its involvement in the reported run; `scripts/druckenmiller-log-internals.js:365-390`).

**13F:** the export writer writes `duquesne13f.json` from normalized `druckenmiller-history/13f/YYYY-MM-DD.json`. `druckenmiller-13f.js` produces those quarter files; `lib/druckenmiller/thirteenf.js` transforms XML into a quarter object and does not publish the export. `lese13f` returns null if the directory or dated quarter files are absent; `_coverage.json` is optional and alone does not open the gate (confidence 100%; `scripts/write-druckenmiller-export.js:498-526`, `:608-615`; `scripts/druckenmiller-13f.js:141-152`, `:178-206`; `lib/druckenmiller/thirteenf.js:269-332`).

The named gate is **manual quarterly ingestion followed by availability of normalized quarter files in the daily checkout**. The producer explicitly says “KEIN CI-SCHRITT”; the inspected daily workflow contains no invocation of `druckenmiller-13f.js`. Offline ingestion requires `*form13f_YYYYMMDD.xml`, uses a local snapshot name map, and optionally uses local prices. The alternative `--fetch` makes SEC submissions/archive requests and requires a contact User-Agent; neither mode was run (confidence 100%; `scripts/druckenmiller-13f.js:6-20`, `:50-59`, `:94-97`, `:178-206`, `:267-314`; daily module calls: `.github/workflows/daily-pull.yml:1177`, `:2122-2125`, `:2612-2620`).

Real XML/normalized 13F presence in the repository is **not established** within this whitelist (O3). The allowed export-test source contains synthetic quarters and synthetic coverage, explicitly labeled `Testbestand`; these demonstrate writer behavior, not live holdings and not a daily input source. No fixture is passed by the daily writer command (confidence 100%; `tests/druckenmiller/write-export.test.js:767-800`, `.github/workflows/daily-pull.yml:2122`).

## 3. Exact log and failure conditions

The combined “noch ohne candidates.json/duquesne13f.json (Chunk 2/3)” text is selected solely by `kandidatenZahl === null`, initialized to null and set only after writing candidates. It does NOT test whether 13F was written. Therefore the combined message proves that candidates were not written on that successful writer path, but does not prove both files were absent. With candidates present but no 13F, the separate chunk-3-only text is selected (confidence 100%; `scripts/write-druckenmiller-export.js:608-639`).

The write path returns 0 after that log; it does not emit `_FAILED.json`. The check's `rot(reason)` logs an error, writes the marker and returns 1; uncaught check exceptions also write the marker and return 1. An existing marker is a failure and its original content is preserved. Actual file removal/write happens in the logger helper (confidence 100%; `scripts/write-druckenmiller-export.js:631-640`, `:688-738`; `scripts/druckenmiller-log-internals.js:515-529`).

For missing files, the precise failure predicate is: **any file in the dynamically selected `pflichtDateien` is absent**. No 13F input and no candidates input means only regime/meta are required, so missing candidates/13F alone is accepted. A 13F input without a candidates ledger selects all four files and can consequently fail on missing candidates. Other paths include mismatched timestamps, broken/shrunk ledger, gaps, asOf mismatch and invalid registration; the missing-file log cannot identify which fired (confidence 100%; `scripts/write-druckenmiller-export.js:745-784`, `:848-888`, `:1053-1061`; `tests/druckenmiller/write-export.test.js:248-252`).

## 4. Verdict and what the wiring test actually pins

**MIXED, qualified:** a candidate transport omission is certain; a manual 13F input gate is intentional. The strict event-level version of option (c), including “inputs are present” for (a) and “not yet available” for (b), remains unproven without the excluded input inventory and CI marker. This report does not equate a code merge with a successful data import or a new session (confidence 95% for the wiring/design classification; `.github/workflows/daily-pull.yml:1342-1345`; `scripts/druckenmiller-log-internals.js:373-390`; `scripts/druckenmiller-13f.js:6-8`; observations O2/O3).

C12 pins write/check/upload/deploy order, C13 fail-soft exports, C14 the current ledger artifact download and raw-row upload, and C15 the sharp guard. C14 does **not** assert candidates or 13F transport and does not forbid extra paths. Thus the current test can pass with the candidate omission; the fix should ADD candidate-ledger/sidecar assertions rather than relax any existing assertion. No test change is needed merely to permit the extra paths (confidence 100%; `tests/druckenmiller/ci-wiring.test.js:200-255`).

## 5. Minimal proposed patch — NOT applied

Only the proven candidate handoff defect is patched below; this is not a claim that the concrete live red run would be cured. `.github/workflows/daily-pull.yml` is **deny-listed - Claude applies**. The only accompanying JavaScript change is additive test coverage in `tests/druckenmiller/ci-wiring.test.js:240-242`; no production-script change is needed. A daily SEC fetch would contradict the producer's explicit manual design and is not proposed (confidence 98%; workflow `:1342-1345`, test `:228-242`, `scripts/druckenmiller-13f.js:6-8`).

```diff
--- a/.github/workflows/daily-pull.yml
+++ b/.github/workflows/daily-pull.yml
@@ -1342,6 +1342,8 @@
           path: |
             druckenmiller-history/internals-ledger.jsonl
             druckenmiller-history/internals-ledger.jsonl.meta.json
+            druckenmiller-history/candidates-ledger.jsonl
+            druckenmiller-history/candidates-ledger.jsonl.meta.json
             druckenmiller-history/raw/
           if-no-files-found: error
           retention-days: 7
--- a/tests/druckenmiller/ci-wiring.test.js
+++ b/tests/druckenmiller/ci-wiring.test.js
@@ -239,6 +239,10 @@
   // fuer genau die Sitzung blind, fuer die es gilt.
   assert.match(ohneKommentarzeilen(block(ARTEFAKT)), /druckenmiller-history\/raw\//,
     'das Ledger-Artefakt traegt die Roh-Zeilen des Tages nicht');
+  const paths = ohneKommentarzeilen(block(ARTEFAKT)).split('\n').map((l) => l.trim());
+  for (const file of ['candidates-ledger.jsonl', 'candidates-ledger.jsonl.meta.json']) {
+    assert.ok(paths.includes('druckenmiller-history/' + file), 'missing candidate handoff: ' + file);
+  }
 });
 
 test('C15 der scharfe Export-Check im Waechter-Job traegt KEIN continue-on-error', () => {
```

The same artifact reaches scoring and the guard, so these two added paths repair both handoffs once the producer has made the input. They do not create a missing first candidate session or import 13F; those remain their respective producer prerequisites (confidence 100%; `.github/workflows/daily-pull.yml:2112-2113`, `:2589-2590`; `scripts/druckenmiller-log-internals.js:373-390`; `scripts/write-druckenmiller-export.js:504-508`).

Risk: a missing proposed artifact path would fail the added C14 assertions; invalid or stale transported candidates can make the sharp export guard red through candidate-ledger/asOf checks. Scoring's write/check stay fail-soft, so these errors are not newly made a board-deploy gate. Existing C14 cannot detect the omission until the proposed test addition is applied (confidence 100%; `tests/druckenmiller/ci-wiring.test.js:214-248`; `scripts/write-druckenmiller-export.js:895-898`, `:936-942`; `.github/workflows/daily-pull.yml:2122-2125`, `:2620`).

## 6. Offline verification and non-runnable checks

Observation O4: executed `node tests/druckenmiller/ci-wiring.test.js`; process exit **0**. Last output lines (runner emits totals/exit at `tests/druckenmiller/ci-wiring.test.js:257-258`):

```text
  ok   C12 Chunk 1: schreiben und pruefen stehen hinter dem Vertrags-Tor und VOR dem Deploy
  ok   C13 KERN: beide Export-Schritte sind fail-soft — Karls Boards haengen nie an der Messreihe
  ok   C14 der Schreiber bekommt die Zeile von HEUTE (sonst veroeffentlicht er ewig gestern)
  ok   C15 der scharfe Export-Check im Waechter-Job traegt KEIN continue-on-error

ci-wiring.test.js: 15 ok, 0 fail
```

`node scripts/write-druckenmiller-export.js --check`: **not runnable here: no read-only mode; a failed check writes/removes files in the protected export directory and reads inputs beyond the whitelist.** Not executed; exit code **N/A**, no fabricated output. The local export directory is absent (O2). Redirecting it to a scratch directory would still violate report-only writes and would not verify the real export (`scripts/write-druckenmiller-export.js:745-754`, `:1102-1109`; `scripts/druckenmiller-log-internals.js:515-529`).

Chunk-3 dry run: **not runnable here: no dry-run mode exists in its CLI; offline ingestion writes quarter files and the fetch mode uses the network.** No execution; exit code **N/A**. XML availability outside the whitelist remains unknown, not asserted absent. The only dispatched modes are `--coverage`, `--from-dir`, `--fetch`; passing an invented flag would not provide a dry run (`scripts/druckenmiller-13f.js:371-392`, `:141-152`, `:206`, `:267-268`).

Observation O5: before writing this new report, both `git diff --stat` and `git diff --stat --ignore-cr-at-eol` returned empty stdout (Git exit 0 each). An untracked new report is not included in ordinary `git diff`; final status and a no-index report comparison are supplied in the completion response instead of staging files.

## Scope and remaining evidence

No code/workflow/export regeneration, network requests, methodology review, commits, staging, deletion or moves were performed. Only this report was created; the embedded patch remains text. The completion checks document that claim. The brief's whitelist took precedence over AGENTS' broader CLAUDE/Masterplan reading instructions, as its delegation rule explicitly permits (`AGENTS.md:75-84`; observations O1-O5).

To turn the qualified classification into an event-level diagnosis, Claude needs the failing `_FAILED.json.reason`/`failedAt`, candidate-ledger presence on the merge runner and trigger checkout, and the actual normalized 13F inventory. The marker fields and the source gates identify exactly what to inspect; no new methodology decision is involved (confidence 100%; `scripts/druckenmiller-log-internals.js:521-528`; `scripts/write-druckenmiller-export.js:504-508`, `:618-628`, `:745-754`).

Brief feedback: the useful whitelist excluded the very history/XML/CI-marker inputs needed to prove live availability, and the requested read-only check is actually destructive on failure (`scripts/write-druckenmiller-export.js:712`, `scripts/druckenmiller-log-internals.js:517-529`; O2/O3). The explicit source list and named binary test worked well for locating the handoff omission and checking existing protections (`.github/workflows/daily-pull.yml:1342-1345`, `tests/druckenmiller/ci-wiring.test.js:228-258`; O4).
