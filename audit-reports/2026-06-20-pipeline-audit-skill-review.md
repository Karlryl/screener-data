<!-- Generated 2026-06-20 by review-pipeline-audit-skill workflow (run wf_2490ab25-d7c): 82 agents, 45/73 weaknesses confirmed via adversarial verification. -->

# Pipeline-Audit Skill — Consolidated Weakness Report

**Scope:** Adversarial review of the `pipeline-audit` agent skill, evaluated specifically as the engine of an **exhaustive, endless, auto-fixing hardening loop** over the `screener-data` codebase (~51k LOC, 227 JS files). Every weakness below survived adversarial refutation against the live repo and the skill text (`SKILL.md` + `references/known-bug-patterns.md`).

**Headline:** The skill has three structural failure axes that compound: (1) it cannot see most of the code it claims to audit (static hand-listed scopes leave the core engine, the 272KB output generator, `lib/`, and ~25 scripts entirely unread); (2) it has no verification stage at all, so unverified findings flow straight toward fixes; and (3) it has no run-level memory or coverage accounting, so the "endless loop" can never converge or even know what it missed. Severities below use the post-refutation `revised_severity`.

---

## CRITICAL

### C1. No coverage ledger / completeness accounting — the loop cannot know what it missed
*Root issue spanning lenses: agent-scaling (W-SCALE-03), coverage (W-COV-08), process-state (W-STATE-07). Also raised by triage-robustness.*

**Evidence:** The only coverage artifact is each agent's self-reported `files_examined`/`files_skipped` (SKILL.md lines 50-51), surfaced in a passive "Agent Coverage" table (lines 302-306) built "one row per agent from their JSON metadata." There is no repo-wide manifest of what *should* be covered, so `files_skipped` is measured against nothing. No step enumerates the tree (`git ls-files`) and diffs it against examined files. NOTES line 363 only handles an agent failing to *write* its JSON — not a file that was in no scope to begin with. The table is purely additive; it never computes the complement (files examined by zero agents).

**Why it matters for the loop:** Without reconciliation, the audit's own coverage claim is unfalsifiable: it cannot distinguish "no bugs here" from "nobody looked here." A clean/empty report is the loop's primary termination/continue signal — and that signal is meaningless if coverage was never measured. The user gets a green report over a partially-audited repo, every iteration, forever.

**v2 fix:** Add triage **STEP 0**: run `git ls-files '*.js' '*.py' '.github/workflows/*'` (minus node_modules), build the union of all agents' `files_examined`, and emit an explicit **UNAUDITED FILES** section listing the difference with line counts. The orchestrator must **fail the run (or auto-spawn a catch-all agent)** if that set is non-empty. Persist this as a committed `audit-state/_coverage-ledger.json` so coverage is *enforced*, not just reported.

---

### C2. Agent count + scopes are hardcoded to 7 fixed files — most of the codebase is never read
*Root issue spanning lenses: agent-scaling (W-SCALE-01, W-SCALE-02), coverage (W-COV-01, W-COV-02, W-COV-03, W-COV-05), prompt-quality (W-PROMPT-06), process-state (W-STATE-07). The single most-cited defect across the entire review.*

**Evidence:** SKILL.md is built around literal fixed counts (Wave 1 = 4 Task calls, Wave 2 = 3) and hand-written scope lists. Mapping all 7 scopes against the tree: only ~6 of 44 root `.js` files are named anywhere. Entirely unscoped, high-value files include:
- **`generate-screener.js` (4,417 lines / 272KB — the largest file, the production output generator)** — requires `methods/runner.js`, `methods/data-quality.js`, `lib/atomic-write.js` and writes the user-facing `screener.html`; invoked directly in `daily-pull.yml`. Read by no agent.
- **`engine-v7.3.js` (1,298 lines — the core scoring engine)** and **`score-orchestrator.js` (347 lines)** — required by in-scope `methods/_helpers.js:75` and `methods/sector-medians-compute.js:361`, but no scope glob (`methods/*.js`) reaches a root-level path. The engine holds 16 `&&…||` patterns, 20 `|| 0 / || null` fallbacks, and only 2 NaN guards — exactly the bug classes the skill hunts.
- **`lib/` (`atomic-write.js` + helpers)** — `lib/atomic-write.js` is required by 40 callers; its own header documents prior bugs F-218c-09 (tmp not fsync'd), F-230c-01 (parent-dir not fsync'd), F-230c-02 (Windows rename EPERM). The State agent's *entire mandate is atomicity*, yet it is never told to read the canonical `writeFileAtomic()`.
- **Secondary ingestion** (`pull-sec-xbrl.js`, `pull-13f-institutional.js`, `pull-insider-form4.js`, `pull-prices-bulk.js`, `pull-historical-prices.js`, `pull-earnings-dates.js`, `backfill-prices.js`) — 1000+ lines of rate-limited network fetchers feeding `prices/` and `external-data/`, audited (if at all) for the wrong risk class.
- **`court-screen.js` / `court-score.js` / `manipulation-filters.js` / `detect-changes.js`** (the latter has a documented HIGH bug per CONTEXT.md Tag 229c) and ~26 of 32 `scripts/*.js`.

The 7 themes are disjoint with no catch-all agent and no step asserting `union(scopes) == file set`.

**Why it matters for the loop:** "Find every error" is structurally impossible when ~85% of root files and several whole directories fall outside all scopes. The same files stay uninspected on **every** iteration — no amount of looping closes a gap that no agent is ever instructed to read. The loop converges to "no findings" over large permanently-blind regions, including the core engine and the actual output generator.

**v2 fix:** Replace the two hardcoded WAVE sections with a mandatory **PHASE 0 — PLAN**: (0a) enumerate the surface via `git ls-files '*.js' '*.yml' '*.py'`, recording path + LOC; (0b) partition into audit units of ≤~1,500 LOC, grouped by directory/concern; (0c) derive `N_agents` from the partition (never a constant); (0d) write the partition to the coverage ledger (C1); (0e) follow the require-graph one hop (any shared helper required by an in-scope file is in-scope, pulling in `engine-v7.3.js`, `score-orchestrator.js`, `lib/*`). Decouple the 7 thematic prompts into a reusable **lens library** that any agent applies to its assigned files. Add a hard **COVERAGE-GATE**: the audit is not complete until every tracked `.js`/`.yml`/`.py` (minus node_modules) has status `examined`.

---

### C3. No verification stage — unverified findings flow straight into fixes, on self-reported trust
*Root issue spanning lenses: verification-gap (W-VER-01, W-VER-02, W-VER-04, W-VER-05). Also raised by prompt-quality (W-PROMPT-05) and model-dispatch (W-TIER-03).*

**Evidence:** The pipeline is exactly 3 phases — Wave 1, Wave 2, Triage — with no verify/refute stage. A grep for `refut|adversar|independent|majority|vote|disconfirm` returns ZERO hits. Triage STEP 4 re-scores severity but never asks "is this finding true?"; the only source-reading step (STEP 3) is gated to *compound interaction* detection and *assumes both bugs are real*. The triage agent reads the author's full persuasive narrative (description/mechanism/reproducer/impact), anchoring it toward agreement — judge-with-no-prosecutor. Compounding this, `evidence_tier` (T1/T2/T3) and `confidence` are 100% **author-set** (SKILL.md lines 42, 52; "be honest in the confidence field" is a request, not a control), and triage dedup *trusts the self-grade verbatim* ("Keep the finding with the higher evidence tier") while TOP-5 selection sorts on self-reported confidence. Live output confirms the overconfidence cluster: `findings/methods-engine.json` self-labels 5 of 6 findings T1.

**Why it matters for the loop:** This is the single most dangerous gap for an auto-fixing loop. A plausible-but-wrong T2/T3 finding (e.g. "this `|| 0` hides missing data") gets promoted to TOP 5 by a number the suspect agent assigned itself, then Phase 3 turns it into a patch. Over an endless loop, false-positive fixes accumulate and corrupt exactly the production output the audit exists to protect — and an unverified fix can break the anchors CONTEXT.md forbids breaking. *(Note: the skill itself says "Never auto-apply fixes — always present as proposals," which is a real interposed gate; the catastrophic path is realized only because the user runs this inside an autonomous loop. That tempers blast radius but not the structural gap.)*

**v2 fix:** Insert a mandatory **PHASE 1.5 — VERIFY** between waves and triage. For each finding, spawn an **independent refuter** (a *distinct* Task invocation, never the author) that receives ONLY `{file, line_range, one-line claim, category}` — never the author's mechanism prose (anti-anchoring) — and must independently re-derive from source, then output `CONFIRMED | REFUTED | UNCERTAIN` with a counter-trace. Make `evidence_tier` a **derived** field set by the refuter. Replace the dedup tie-break with "higher *verified* tier." Rank Phase 3 selection on `verified_confidence`. No finding reaches patching without `verdict=CONFIRMED`. Where the code is pure/unit-testable, require an executable `reproducer_script` the verifier runs (see H9).

---

### C4. Triage loads exactly 7 hardcoded filenames and silently drops any other agent's JSON — already losing a CRITICAL finding
*Root issue spanning lenses: triage-robustness (W-COV-01-triage), prompt-quality (W-PROMPT-09), process-state (W-STATE-09).*

**Evidence:** Triage STEP 1 (lines 234-241) reads a fixed literal list of 7 files. The **live `findings/` directory contains an 8th file, `methodology.json`** (agent "methodology", 13 findings including 1 CRITICAL + 5 HIGH look-ahead-bias findings, the audit's highest-value category). It is not in the list. The realized loss is on disk: `audit-reports/2026-06-13.md` reports "51 raw findings across 7 agents," its coverage table has exactly 7 rows with no methodology row, and **zero of the 13 `F-MD-*` IDs appear anywhere** — a CRITICAL finding silently vanished. NOTES line 363 cannot catch this because it only handles an *expected* agent failing to write, not an *unexpected/extra* agent file.

**Why it matters for the loop:** Silently losing an entire agent's coverage is the worst failure mode — the report looks complete (Executive Summary + 7-agent table) while ~16% of findings disappear. Any agent added/renamed in future waves is invisible until someone manually edits the literal list.

**v2 fix:** Replace the hardcoded list with: "Glob ALL `findings/*.json` (excluding `archive-*/` subdirs), validate each against the schema, load every valid file regardless of agent name." Emit an expected-vs-found agent manifest; drive the Agent Coverage table from the discovered set; add a warning row for any expected agent whose file is missing or invalid.

---

### C5. Interactive "re-run or reuse?" prompt hard-blocks the autonomous loop
*Lens: process-state (W-STATE-03).*

**Evidence:** SKILL.md line 364: "If `findings/` already has JSON from a previous run, ask the user: 'Re-run agents or use existing findings for triage only?'" The live `findings/` **already contains** prior-run JSON (dated Jun 13) plus `archive-*` subdirs, so this prompt fires on the very next invocation. CONTEXT.md's binding directive is explicitly autonomous: "arbeite kontinuirlich bis dein Limit aufgebraucht ist … do not ask clarifying questions, dispatch the next wave."

**Why it matters for the loop:** A single human-gate halts the endless loop indefinitely on every iteration and directly violates the project's documented autonomy contract. Re-running an in-repo audit is none of the project's documented confirmation edges (secrets, force-push, money-costing API calls).

**v2 fix:** Remove the interactive prompt. Replace with deterministic policy: auto-archive the previous `findings/` to `findings/archive-<prev-run-id>/`, then proceed. Decide reuse-vs-rerun **per file from the ledger hash** (H10), never by asking. Reserve human confirmation only for documented edges.

---

## HIGH

### H1. Author = verifier with no independence; tiers/confidence never cross-checked
*Folded into C3 as the verification root, but flagged here because the **independence rule** is a distinct, concrete sub-fix (W-VER-05).* The refuter MUST be a distinct Task invocation, MUST receive only `{file, line_range, claim, category}` (never mechanism/reproducer/impact prose), and MUST produce its own trace before comparison. Disagreement ⇒ REFUTED. Without this, any improvised verification rubber-stamps fluent-but-wrong mechanisms.

### H2. Verification not tied to the repo's deterministic test oracle
*Root issue spanning lenses: verification-gap (W-VER-07), model-dispatch (W-TIER-03).*

**Evidence:** The repo ships runnable, deterministic gates — `tag28-tests.js` (155/155), `engine-cli-tests.js` (10/10), `tests/integration-anchor-test.js` (10/10), and a frozen fixture hash `tests/fixture-hash.txt = fd4a13856b18fc7b`. CONTEXT.md makes them binding after every method change. A grep across the entire skill for `tag28|engine-cli|integration-anchor|fixture-hash|node.exe|npm test` returns ZERO execution-context hits. The skill's "verification" is whatever a model asserts in a `confidence` field or a free-text "Test:" line.

**Why it matters for the loop:** A 16-char fixture hash that flips on any scoring drift + 175 passing assertions is the cheapest, strongest refuter available — and it is never run. Trusting "Opus says it's fixed" over a command that returns a deterministic hash is strictly worse for a hardening loop, and is the difference between "provably converged" and "a model felt good about it."

**v2 fix:** In the verify stage, for any CONFIRMED finding whose fix touches scored code (a `SCORE_WEIGHTS`-listed method), the verifier MUST: (a) apply the fix to a scratch copy; (b) run all three suites via the absolute Node path `"C:\Program Files\nodejs\node.exe"` (Node is off-PATH per CONTEXT.md); (c) confirm 155/155 + 10/10 + 10/10 AND fixture-hash unchanged (unless the fix intentionally changes a scored method). Any failure ⇒ auto-REFUTED. Also run as a **pre-flight baseline at audit START** so the loop never blames a pre-existing red gate on its own patch. Scope the gate to scored-code findings so doc/CI/yaml findings don't force a full run.

### H3. No persistent ledger / incremental mode — every run re-reads ~51k LOC from zero
*Root issue spanning lenses: process-state (W-STATE-01, W-STATE-02). Also the false "~15-25 min" runtime claim.*

**Evidence:** The skill has no run ledger and no content-hash mechanism; `files_examined` lives inside a per-run JSON that is overwritten next run. SKILL.md line 21 claims "Total expected runtime: ~15-25 min," but 7 agents reasoning over 51k LOC (Methods alone = 103 files / 16,360 LOC; `pull-yahoo.js` is read by 3 agents with no shared cache) cannot finish in that window — real audits of this size run hours. A grep for `increment|content-hash|git diff|--mode|since|skip|cache` finds only `node_modules/`.

**Why it matters for the loop:** The single most important loop capability is to **not redo work already done**. With no ledger, every iteration burns the full token/time budget on rediscovery instead of progressing to changed/un-audited code, and the false runtime budget makes a scheduling wrapper fire the next iteration too early or time out mid-wave leaving partial state.

**v2 fix:** Add a committed `audit-state/ledger.json` (NOT gitignored) keyed by file path: content SHA-256, last-audit timestamp, last commit touching the file, finding-IDs produced, per-file status (`clean | findings-open | fixed-verified`). Each agent's first step: hash each in-scope file, compare to the ledger, SKIP unchanged files whose status is `clean`/`fixed-verified`. Add `--mode=full|incremental` (default incremental once a ledger exists); incremental mode scopes to `git diff --name-only <last-audit-commit>..HEAD ∩ agent-scope`. Replace the fixed time estimate with a cost model ("first full run: O(hours); incremental: minutes, proportional to changed files").

### H4. No convergence / dry-loop stop condition
*Lens: process-state (W-STATE-05).*

**Evidence:** The skill is a single linear pass (PHASE 1 → 2 → optional 3 → stop). There is no loop construct, no convergence definition, no termination predicate, and nothing re-audits a fixed file to confirm the finding is gone. A grep for `loop|converg|dry|re-audit|consecutive` returns no process-level hits.

**Why it matters for the loop:** An exhaustive auto-fixing loop must terminate on a real signal. Without one, it either runs forever doing nothing useful or a human guesses when to stop — defeating the autonomy goal.

**v2 fix:** Define the STOP predicate in SKILL.md: stop when (a) the changed-file set since last run is empty, OR (b) a full pass yields 0 new findings at severity ≥ HIGH AND every ledger entry with status `findings-open` has been re-audited to `fixed-verified`. Add a loop wrapper: audit → apply fixes (gated) → re-audit ONLY touched files → repeat until predicate holds. Record `consecutive_dry_passes`; stop at N (configurable).

### H5. "Output ONLY valid JSON" is unenforced; live findings already violate the STRICT enum
*Lens: prompt-quality (W-PROMPT-02). Related to C4 (silent agent drop).*

**Evidence:** SKILL.md line 27 calls the schema STRICT; the `category` enum (line 37) omits `concept-flaw`, yet live findings contain `category:"concept-flaw"` 14 times (3× in `ci-workflow.json`, 11× in `methodology.json`). Each prompt says "Output ONLY valid JSON" with NO validation gate anywhere; "failure" is undefined. An agent emitting prose, a fenced ```json block, or out-of-enum values flows uninspected. The enum is simultaneously too strict (rejects legitimate `concept-flaw`) and unenforced.

**Why it matters for the loop:** A single malformed JSON silently drops an entire agent's findings with no error — coverage looks complete but a 7th of the audit vanishes. False confidence plus silent loss.

**v2 fix:** Add a validation gate after each wave (a tiny Node validator): parse every `findings/*.json`, check required keys and that `category` is in an **extensible** enum (add `concept-flaw`, `architecture`, `other` + required `category_note` for `other`), write `findings/_validation.json`. On failure, re-spawn just that agent with the parse error appended ("Your previous output failed validation: <error>. Re-emit ONLY the JSON."). Tell agents to write with `fs`, never to stdout, never wrapped in fences.

### H6. "Log the failure but continue" loses coverage with no retry, re-dispatch, or salvage
*Lens: triage-robustness (W-FAULT-02). Compounds C4 and H5.*

**Evidence:** SKILL.md line 363 logs-and-continues with no retry, no re-dispatch, and no prose-salvage. The INVOCATION steps only "wait for all agents to complete" (Task returns) — not "assert the artifact exists." A prose-emitting agent (a common LLM failure) "completes successfully" so the orchestrator never notices; the "triage will note missing coverage" promise is unimplemented (triage reads a hardcoded list, and the coverage table is built only from JSONs that loaded).

**Why it matters for the loop:** A single agent that emits prose permanently drops its entire scope (e.g. CI or backtest) for that run with no self-healing. Over many iterations whole subsystems stay under-audited and nobody notices.

**v2 fix:** Add an orchestrator gate after each wave: for every dispatched agent, assert `findings/<agent>.json` exists AND passes schema validation. On failure: (1) re-dispatch that single agent up to N=2 times with "your previous output was missing/invalid JSON"; (2) attempt a salvage pass converting prose → schema JSON; (3) only then record a HARD coverage gap that triage MUST surface as a **top-line warning in the Executive Summary**, not a table omission.

### H7. Specialist prompts never load `known-bug-patterns.md` or CONTEXT.md — agents lack the binding invariants
*Lens: prompt-quality (W-PROMPT-08). The biggest *safety* gap for "safely fix every error."*

**Evidence:** `references/known-bug-patterns.md` exists and its header says "Specialist agents should cross-reference these patterns," but NO prompt instructs agents to read it; prompts re-inline a partial subset (Pattern C) and omit others (Pattern E index-bounds, Pattern I rate-limit boundary). A grep for `node.exe|tag28-tests|FTS_CACHE_VERSION|never.edit|audit-classifications` returns NONE — so none of CONTEXT.md's binding rules reach the agents: never change `FTS_CACHE_VERSION`; no hardcoded ticker exclusions ("fix the guard"); never parallel-edit `methods/index.js`; keep `audit-classifications.js` gitignored; run the 3 test gates after any method change.

**Why it matters for the loop:** An auto-fixing loop blind to the invariants WILL propose a forbidden fix — e.g. "bump `FTS_CACHE_VERSION` to force refresh" (CONTEXT.md shows the team's correct fix explicitly avoids this), "add a hardcoded ticker exclusion to pass the guard," or a parallel `index.js` edit. All explicitly banned. And without the pattern library, agents re-derive a weaker subset each run.

**v2 fix:** (1) Prepend a shared **CONSTRAINTS** block to every specialist AND fix-proposal prompt, lifted from CONTEXT.md's operating constraints. (2) Add to each specialist prompt: "First read `references/known-bug-patterns.md`; cross-reference every pattern class against your scope; cite the pattern letter in `compound_hint`." (3) Add a triage/Phase-3 rule: reject any `suggested_fix` violating a CONSTRAINTS item, and require fixes touching `methods/*` to include the 3 test-gate commands in the Test field.

### H8. Compound-bug detection leans on self-reported `compound_hint`, structurally blind to cross-agent interactions
*Lens: triage-robustness (W-COMPOUND-05).*

**Evidence:** STEP 3 keys on `compound_hint` plus an unstructured "any findings you judge may interact" fallback over 83 findings. Each specialist sees only its own scope, so of 46 hints, **45 are same-agent and only 1 cross-agent**. The actual triage output produced 14 compound groups, 13 same-agent, only 1 cross-agent — and the flagship cross-cutting case (a data-pipeline FX bug feeding methods-engine wrong ratios, the Tag 219c class that hit ~46.5% of the universe) appears as `F-DQ-001` marked `compound: none`, with no downstream link drawn. The highest-value compounds are exactly what triage exists to find and exactly what it misses.

**Why it matters for the loop:** The audit's unique value over a linter is cross-file interaction detection; relying on same-agent hints systematically discards it.

**v2 fix:** Make compound detection candidate-driven and deterministic-first: after dedup, auto-generate cross-agent candidate pairs by shared normalized-file, shared symbol/field name, or producer→consumer category pairs (e.g. `silent-corruption/schema-drift → logic-bug/data-quality`). Feed that candidate list (not raw self-hints) to the LLM for source-level confirmation. **Same-file findings from different agents are mandatory compound candidates.** Keep `compound_hint` as a supplementary signal only.

### H9. `reproducer` is declarative prose, never executed
*Lens: verification-gap (W-VER-08). Mechanism for C3's executable verification.*

**Evidence:** Schema line 44 defines `reproducer` as prose; live `F-ME-201` is a hand-written "`normalizeMethodScore(...)` returns 0.99" assertion that nothing ever runs. Even the ~16 findings already written as runnable commands ("`-> 0.0108`") are never executed; asserted outputs are taken on faith.

**Why it matters for the loop:** The reproducer is the natural unit of adversarial verification — if executable, the refuter gets a binary CONFIRMED/REFUTED for free. This is a Node codebase with pure scoring functions (`normalizeMethodScore`, `_rankRoic`, `effectiveThreshold`), so most are testable.

**v2 fix:** Add a schema field `reproducer_script` (runnable node snippet) and have the verify stage EXECUTE it; CONFIRMED requires the script to actually produce the asserted wrong output. Where execution isn't feasible (CI yaml, async race), mark `reproducer_executable:false` and route to argumentative verification with a lower auto-fix trust ceiling.

### H10. Triage consumes stale/extra JSONs with no run-id/vintage gate
*Root issue spanning lenses: process-state (W-STATE-09, W-RERUN-07).*

**Evidence:** Triage reads the 7 hardcoded files with no timestamp/run-id validation against the schema's per-file `timestamp` (line 32) and no check that source hasn't changed since. Live proof: `data-pipeline.json` was written 2026-06-13 07:39, but `pull-yahoo.js` (its scope) was modified the same day at 23:33 — source newer than findings. The reuse path ("use existing findings for triage only") will triage whatever sits there, mixing agents from different runs. `methodology.json` carries timestamp 2026-06-12 alongside the others' 2026-06-13.

**Why it matters for the loop:** Triaging stale findings against changed source produces fixes for bugs already fixed (CONTEXT.md lists many killed bugs) or against dangling line ranges, and silently changes coverage run-to-run.

**v2 fix:** Triage must read findings ONLY from the current `audit-state/run-<id>/findings/`, glob ALL `*.json` there, and validate each embedded `run_id`/`timestamp` matches the active run — reject/skip and log mismatches. Warn if any source file's mtime is newer than its findings timestamp. Record `run_id`/`schema_version` per file; refuse to triage mixed `run_id`s without explicit override.

### H11. `priority × confidence` references a per-finding confidence the schema does not provide
*Lens: triage-robustness (W-PRIO-06).*

**Evidence:** STEP 4 defines only severity bucketing (no numeric formula); STEP 5's TOP-5 header says "(sorted by priority × confidence)" but `confidence` exists ONLY at agent/file level — 0 of 83 findings carry a per-finding `confidence`. So `× confidence` collapses to a per-agent constant (identical across an agent's findings) or is undefined, and `evidence_tier` — the real per-finding certainty signal — is never used in ranking.

**Why it matters for the loop:** TOP 5 is the only part most users act on and the direct input to Phase 3 fix generation. A loud T3 pattern-match CRITICAL can outrank a T1 fully-proven HIGH, sending fix agents at speculative findings first and wasting fix budget.

**v2 fix:** Define a deterministic score: `priority_score = severity_weight (C=4..L=1) × tier_weight (T1=1.0, T2=0.7, T3=0.4) × agent_confidence`, with a compound bonus (×1.25 if in a `compound_group`). Add an optional per-finding `confidence` and prefer it when present. State the exact sort key (`score desc, then severity, then id`) so ordering is reproducible.

### H12. No architecture / higher-altitude dimension — every agent is line-level only
*Lens: prompt-quality (W-PROMPT-04).*

**Evidence:** A grep for `architect|altitude|structural|refactor|"better way"` returns no agent-prompt hits. All 7 prompts hunt line-level bugs. The repo screams for altitude: CONTEXT.md's own punch-list says "pull-yahoo.js at 19k+ tickers projects to 14.6h — eventual GH Actions matrix-sharding architecture needed," `generate-screener.js` is a single 272KB god-file, and the standing goal is "the screener is at ~20% of its potential." No agent is scoped to raise any of this.

**Why it matters for the loop:** A bug-only audit can never move the "20% of potential" number — it polishes lines while the structure that wastes hours per run goes unquestioned. Omitting design review caps the loop's ceiling at micro-fixes.

**v2 fix:** Add a dedicated **Architecture & Altitude** agent (8th, feeding triage on an ARCH tier) with an open-ended prompt: where is time/compute wasted (re-parsing 14MB files, 14.6h pulls, O(n²) over 15k tickers); what is structured awkwardly (god-files >50KB, duplicated logic); is there a fundamentally better way; what single structural change most raises the screener toward its potential. Output ARCH-tier findings with effort/payoff, ranked on a separate axis from line-level bugs.

### H13. No model tiering — finder/triage/fixer/verifier models are unpinned
*Lens: model-dispatch (W-TIER-01). (W-TIER-06's "triage downgrade" risk folds in here.)*

**Evidence:** The skill spawns 7 finders + triage + N fixers via Task but NEVER specifies a model. A grep for `model|subagent_type|sonnet|opus|haiku` finds only `evidence_tier` (unrelated). Every sub-agent inherits the orchestrator's model by default. CONTEXT.md mandates an endless autonomous loop where model mix is the dominant cost/quality lever.

**Why it matters for the loop:** Either the whole fleet runs pure-Opus (~3-5× more expensive than necessary) or — if a future cost-saving flag tiers sub-agents to Sonnet — the deep triage/compound-bug/verify stage silently downgrades at exactly the place that needs the strongest model. The outcome is accidental, not designed.

**v2 fix:** Add a `## MODEL TIERING (binding)` section pinning a model per stage via the Task `model` param: broad mechanical sweeps (Data-Pipeline, CI/Workflow, Performance) → Sonnet; cross-cutting semantic reasoning (Methods/Engine, State-Management, Data-Quality, Backtest) → Opus; **triage = Opus (non-overridable)** with rationale "cross-file causal reasoning — never downgrade"; fixers → Sonnet (scoped single-file edits); **verifier = Opus (non-overridable)**.

---

## MEDIUM

### M1. 103 method plugins globbed into one agent; `methods/index.js` registry not called out
*Lens: coverage (W-COV-09).*

**Evidence:** Agent 2's `methods/*.js` nominally covers 103 files / 16,360 LOC but hands them to one Task call — ~5-6× the next-largest agent's load. `methods/index.js` (the 269-line registry that decides which methods run via `optional:true` silent-skip) is unnamed; CONTEXT.md independently flags it as race-prone and never-parallel-edit.

**Why it matters for the loop:** Nominal coverage ≠ effective coverage; a single agent over 103 files skims and per-file envelope/precedence bugs are lost. A method silently de-registered/mis-wired in `index.js` is a high-impact, low-visibility bug the "plugins" framing under-weights.

**v2 fix:** Shard `methods/` by registry category (CORE/DATAGUARD/DIAGNOSTIC) into ~20-30-file buckets; name `methods/index.js` explicitly with an instruction to audit enable/disable/`optional` registration logic; scale the number of method-auditing agents to file count.

### M2. Non-JS production surfaces unaudited (Python PDF generator + HTML dashboards + their generators)
*Lens: coverage (W-COV-10).*

**Evidence:** `generate_screener_report.py` (379 lines, reads `outputs/court-results.json`) and the HTML outputs (`dashboard.html`, `screener.html`, etc.) are in no scope (all 7 are `.js`/`.yml`). The HTML is emitted by `generate-dashboard.js`, `generate-screener.js`, `generate-methods-report.js`, `generate-diff-report.js` — four large generators, only one of which is partially scoped. CONTEXT.md's standing directive foregrounds the dashboard ("arbeite weiter am dashboard damit es professioneller aussieht").

**Why it matters for the loop:** A whole language (Python) and the entire presentation layer rendering results to the user go unreviewed for field-name agreement, stale binding, and `value || '-'` masking a real 0 — the skill's own bug classes, on the surface the owner cares most about.

**v2 fix:** Add a "Reporting/Presentation" agent covering `generate_screener_report.py` and the `*.html` generators (data-binding correctness, field-name agreement with emitted JSON, number/locale formatting). At minimum, extend the coverage ledger (C1) to track `.py` and `.html`.

### M3. No cross-run memory / dedup-against-history — the loop re-reports accepted findings forever
*Lens: prompt-quality (W-PROMPT-10).*

**Evidence:** The skill is single-shot, writing fresh reports each run; `audit-reports/` already holds 67 dated reports and CONTEXT.md tracks "7 documented MEDIUM/LOW findings across Tag 227c/229c/230c/231a" as KNOWN/accepted. No prompt reads prior reports or a known-issues ledger, so every run re-surfaces the same accepted-LOW items. (The user already solved this for the parallel formula loop via a source-of-truth ledger read first each iteration — the audit skill lacks the equivalent.)

**Why it matters for the loop:** Without distinguishing NEW from already-known-and-accepted, the loop drowns in repeats and never reaches a quiet steady state — the operator can't tell if iteration N found anything genuinely new.

**v2 fix:** Introduce `audit-reports/known-issues.json` (id, `fingerprint = file+line+category+title-hash`, status `open|fixed|accepted-wontfix`, first/last_seen). In triage STEP 2, fingerprint each finding, diff against the ledger, mark NEW / RECURRING / REGRESSED; demote `accepted-wontfix` out of TOP-5 into an appendix; add "N new, M recurring, K regressed" to the Executive Summary. Loop stop-condition becomes "zero new CRITICAL/HIGH for K consecutive runs."

### M4. Non-atomic, non-isolated state writes to `findings/` on a OneDrive+Windows box
*Lens: process-state (W-STATE-10).*

**Evidence:** Agents write directly to `findings/<agent>.json` with no tmp+rename — ironic, since the skill audits for exactly this (Pattern D) and `lib/atomic-write.js`'s own comments document silent state-write loss when OneDrive/AV grabs a handle mid-write on Karl's Windows box. `findings/` is under `C:/Users/Karlr/OneDrive/...`.

**Why it matters for the loop:** An agent killed mid-write, or OneDrive grabbing the file between open and flush, leaves truncated JSON; triage then misreads or drops that agent's findings. For an unattended endless loop this is a recurring, unwatched silent-coverage source.

**v2 fix:** Mandate atomic writes for all skill state (`<file>.tmp` then rename — reuse the repo's `writeJsonAtomic` from `lib/atomic-write.js`). Write to run-scoped dirs. Triage must `JSON.parse` inside try/catch and treat a parse failure as "agent missing / degraded coverage" surfaced in the report, not a silent proceed.

### M5. Dead-code / repo-hygiene dimension entirely absent
*Lens: prompt-quality (W-PROMPT-03). (Downgraded from high.)*

**Evidence:** A grep for `dead.code|unused|refactor|reachability|orphan` returns nothing; no scope asks "is this file/function still used?" The repo root contains stray artifacts no agent flags: a file named `=` (0 bytes), `:TEMPcs_out.txt`, `_audit_e3.js`, an empty `methods/disabled/` dir, plus large untracked junk (`_preview-test.html` ~50MB). 44 root `.js` files include plausibly-orphaned one-offs (`backtest-*`, `diagnose-spec`, `analyze-correlation`) never reachability-checked.

**Why it matters for the loop:** An endless hardening loop should monotonically reduce clutter and risk surface; because no dimension owns this, clutter only grows and a stale legacy JSON could be silently loaded.

**v2 fix:** Add a propose-only "Dead-Code & Repo-Hygiene" agent: build a require/import graph from entrypoints (workflows + package.json scripts), report (a) `.js` reachable by nobody, (b) exported functions never imported, (c) stray non-source artifacts at root, (d) `*-legacy`/`*-old` files, (e) empty dirs — each LOW/MEDIUM with a removal-safety note. Must only PROPOSE deletions (per CONTEXT.md), never delete.

---

## LOW

### L1. Stale scope path: `prune-watchlist.js` named at root but lives at `scripts/prune-watchlist.js`
*Lens: coverage (W-COV-06). (Downgraded from medium.)* Agent 1 points at a non-existent path → silent zero coverage; the lists mix root and `scripts/` paths inconsistently and were never validated against the tree. **Fix:** resolve/validate every scope path at invocation (error if missing); prefer directory globs (`scripts/*.js`) over hardcoded filenames. (Largely subsumed by the C2 PHASE-0 enumeration + coverage gate.)

### L2. `evidence_tier`/`confidence` self-assessment distorts prioritization (proposals-only path)
*Lens: prompt-quality (W-PROMPT-05). (Downgraded from medium — the catastrophic auto-fix chain is C3; the residual here is degraded TOP-5 ordering under the skill's own no-auto-apply gating.)* **Fix (additive to C3):** require T1 findings to carry a verbatim `evidence_quote` + `proof` field; have triage independently re-read source for every CRITICAL and every T1 finding regardless of compound status, downgrade any whose quote doesn't prove the mechanism, record `original_tier` vs `verified_tier`; forbid Phase-3 auto-fix on any verified-T3 or empty-quote finding.

### L3. Output filename collides across same-day runs
*Lens: process-state (W-STATE-08). (Downgraded from high — the "69 broken files" evidence was misattributed to the user's manual loop; the 7 plain `YYYY-MM-DD.md` files this skill emits are collision-free.)* The genuine residual: a manual same-day double-run would overwrite the prior report with no run-index. **Fix:** name reports `audit-reports/<run-id>.md` (`YYYY-MM-DDTHHMMSS-<commit-short>`) and maintain `audit-reports/index.json` (run-id → commit, timestamp, severity counts, delta vs previous) to power convergence trending (H4/M3).

### L4. Concurrency cap / batching abstraction missing
*Lens: agent-scaling (W-SCALE-04). (Downgraded from high — conditional on C2's dynamic scaling; the cited "concurrency=8" is actually the Yahoo HTTP worker-pool size, NOT an agent cap, and must not be wired to the scheduler.)* Once agent count is dynamic, batching is needed. **Fix:** in PHASE 0, let `CAP` = max concurrent agents (honor the documented "3-5 agents per wave" norm from `audit_parallel_pattern.md`), schedule `ceil(U / CAP)` sequential waves, announce the plan up front, launch wave k+1 only after wave k's JSON is written. Derive wave count; never hardcode 2. Do **not** tie CAP to `PULL_CONCURRENCY`.

### L5. Thematic concerns bolted to fixed agents → human must edit the skill as the repo grows
*Lens: agent-scaling (W-SCALE-06). Resolved by C2's lens-library/file-partition decoupling.* Keep the concern checklists as a static `references/` lens library; in PHASE 0 attach the relevant lens subset to each audit unit at plan time from the actual inventory ("every file gets ≥1 structural-correctness lens"). Each spawned agent receives `{file list, applicable lenses}` assembled at runtime.

---

## v2 Blueprint — ordered changes to make this skill correct for an endless auto-fixing loop

Ordered by dependency and leverage. Earlier items unblock later ones.

1. **PHASE 0 — PLAN + Coverage Ledger (foundation).** Before any Task call: `git ls-files '*.js' '*.yml' '*.py'` (minus node_modules), record path + LOC, follow the require-graph one hop (pulls in `engine-v7.3.js`, `score-orchestrator.js`, `lib/*`), partition into ≤~1,500-LOC units, and write `audit-state/_coverage-ledger.json` (committed, per-file: path, loc, content-SHA-256, unit_id, assigned_agent, status, last_audited_commit, finding_ids). *Fixes C1, C2, M1, M2, L1, L5; foundation for everything.*

2. **Derive agent count + waves dynamically.** `N_agents` = number of units; wave count = `ceil(units / CAP)` honoring the 3-5-per-wave norm; announce the plan. Delete the hardcoded "4 + 3 / 7 agents" literals everywhere (including the triage prompt). *Fixes C2, L4.*

3. **Decouple lenses from file partition.** Move the 7 thematic checklists into a `references/` lens library; add an Architecture & Altitude lens and a Dead-Code/Repo-Hygiene lens; attach applicable lenses to each unit at plan time. Every file gets ≥1 structural-correctness lens. *Fixes C2, H12, M5, L5.*

4. **Inject binding context into every prompt.** Prepend a CONSTRAINTS block (FTS_CACHE_VERSION, no ticker exclusions, never parallel-edit `index.js`, gitignored `audit-classifications.js`, Node path, mandatory test gates) and require agents to read `references/known-bug-patterns.md` and cite pattern letters. *Fixes H7.*

5. **Robust, fault-tolerant per-wave output handling.** Atomic writes (`writeJsonAtomic`) to run-scoped `audit-state/run-<id>/findings/`; a post-wave validator (required keys + extensible `category` enum) that re-spawns failed agents (N=2) then salvages prose → JSON, then records a HARD coverage gap. *Fixes H5, H6, M4.*

6. **Roster-agnostic, vintage-gated triage.** Glob ALL `findings/*.json` (exclude `archive-*/`), validate `run_id`/`timestamp` against the active run, warn on source-newer-than-findings. Drive the Agent Coverage table from the discovered set + the ledger; emit an explicit UNAUDITED FILES section; fail/auto-spawn-catch-all if the unaudited set is non-empty. *Fixes C1, C4, H10, M4.*

7. **Adversarial PHASE 1.5 — VERIFY (independent refuters).** For each finding, a distinct Task agent receives only `{file, line_range, claim, category}` (no mechanism prose), re-derives from source, runs the `reproducer_script` where executable, and runs the deterministic test gates (`tag28`/`engine-cli`/`integration-anchor` + fixture-hash) for scored-code fixes via the absolute Node path. Outputs `CONFIRMED|REFUTED|UNCERTAIN`; sets the **derived** `evidence_tier`. Only CONFIRMED proceeds. *Fixes C3, H1, H2, H9, L2.*

8. **Deterministic, candidate-driven triage scoring + compounds.** Auto-generate cross-agent compound candidates (shared file / shared symbol / producer→consumer category pairs; same-file-different-agent = mandatory). Define `priority_score = severity_weight × tier_weight × verified_confidence × compound_bonus` with an explicit stable sort key. *Fixes H8, H11.*

9. **Gated auto-fix + convergence loop.** Keep "propose only" as default; in loop mode, apply only CONFIRMED fixes that pass the test gates, re-audit ONLY touched files, update the ledger (`fixed-verified`), and STOP when changed-set is empty OR a full pass yields 0 new ≥HIGH findings AND all `findings-open` are `fixed-verified`. Reject any fix violating CONSTRAINTS. *Fixes C3, H2, H4.*

10. **Incremental mode + cross-run memory.** `--mode=incremental` (default once a ledger exists) scoping to `git diff ∩ scope` + unchanged-hash skip; `known-issues.json` fingerprint diff (NEW/RECURRING/REGRESSED, demote accepted-wontfix); run-id'd report filenames + `index.json` for trending. Replace the false "15-25 min" estimate with a cost model. *Fixes H3, M3, L3.*

11. **Remove the interactive prompt; add model tiering.** Auto-archive prior findings and decide reuse per-file from the ledger hash (no human gate). Add a binding MODEL TIERING section: Sonnet for mechanical sweeps and fixers; **Opus non-overridable for triage and verifier**; Opus for semantic finders. *Fixes C5, H13.*

After these 11 changes, the skill becomes: *complete* (provable full-tree coverage via the ledger + gate), *scalable* (agent count derived from the actual surface), *trustworthy* (every fixed finding independently re-derived AND validated against the repo's deterministic oracle), *autonomous* (no human gate, deterministic stop predicate), *efficient* (incremental + cross-run memory), and *cost-tuned* (model tiering) — the requirements of an exhaustive endless auto-fixing hardening loop.