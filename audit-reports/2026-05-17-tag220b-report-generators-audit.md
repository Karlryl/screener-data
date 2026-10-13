# Tag 220b — Report-Generators Audit

**Date:** 2026-05-17
**Scope:** Four user-facing HTML report generators not yet audited:
  - `generate-modes-report.js` (1289 lines, ~66 KB)
  - `generate-methods-report.js` (1081 lines, ~61 KB)
  - `generate-dashboard.js` (596 lines, ~27 KB)
  - `generate-diff-report.js` (116 lines, ~6 KB)

**Trigger:** Tag 217f found a UTF-8 BOM that silently broke
`generate-modes-report.js` for weeks. This audit looks for other latent
bugs in the report generators.

## 1. Executive Summary

**Total findings: 11**

| Severity | Count |
|----------|-------|
| CRITICAL | 1     |
| HIGH     | 3     |
| MEDIUM   | 4     |
| LOW      | 3     |

**Top issues:**

1. **CRITICAL** — `generate-methods-report.js` produces a **267 MB HTML
   file** (smoke test on current snapshots). Every row embeds the full
   `results` + `trends` object as URI-encoded JSON in `data-row=` (~63 KB
   per row × 3528 rows). At 19 k tickers this would exceed 1.3 GB and
   crash the GitHub-Pages artifact upload. Top-Picks table also includes
   ALL rows, not Top-N.
2. **HIGH** — All three "discovery" generators
   (modes/methods/screener) read `_manifest-full.json` as if it were a
   ticker snapshot. The filter only skips `_manifest.json`. Polluts
   leaderboards with a phantom `_manifest-full` entry (visible in current
   smoke-test output).
3. **HIGH** — `generate-methods-report.js`'s `escHtml()` does NOT guard
   `null` / `undefined` and emits the literal strings `"null"` /
   `"undefined"` in the rendered HTML. Currently latent because
   upstream `||` fallbacks supply defaults, but every call site is one
   schema change away from leaking raw `undefined` into the page.

All four scripts ran successfully against current snapshots; no crashes,
no silent BOMs. No exploitable XSS sinks found (escape coverage is
strong), but several attribute-context interpolations rely on the
implicit assumption that tickers are alphanumeric — same pattern Tag
217d flagged in `generate-screener.js`.

## 2. Methodology

- Read all four files end-to-end.
- Smoke-tested each against `./snapshots/` (3528 tickers, ~3.5 GB):
  - `node generate-dashboard.js /tmp/audit/dashboard.html` → 814 KB
  - `node generate-modes-report.js --out /tmp/audit/modes.html` → 2.86 MB
  - `node generate-methods-report.js --out /tmp/audit/methods.html` →
    **266 MB** (!)
  - `node generate-diff-report.js --out /tmp/audit/diff.html` → 283 KB
- `grep -c 'undefined\|"null"'` on every output; methods.html had 3528
  hits (caused by `_manifest-full` row + the literal text inside encoded
  JSON, not raw template leakage).
- Checked file encoding with `file(1)` — none have a BOM.
- Searched for `${something.ticker}`, raw concat in `data-*` / `onclick`,
  sort comparator patterns, `value || null` truthiness traps, and
  `RUN_DATE_UTC` usage.

## 3. Findings

### F-GR-001 — methods-report emits 267 MB HTML (CRITICAL)

**File:** `generate-methods-report.js:275-329` (`topPicksRows`),
plus the matrix table at `:331-357`.

Every row in the Top-Picks table embeds:

```js
const rowData = encodeURIComponent(JSON.stringify({
  ticker, name, sector, marketCap, growthYoY, revenueTTM,
  results: r.results,   // full method-output objects (~30 methods)
  trends: r.trends      // per-method trend objects
}));
return `<tr ... data-row='${rowData}'>...`;
```

`r.results[m].components`, `r.results[m].flags`, `dataAsOf`, and
`sectorPercentile` are all included — each row's `data-row` attribute is
~63 KB after URI-encoding. With 3528 unique stocks: **3528 × 63 KB =
~220 MB** of inline `data-row` attributes alone, plus the rendered HTML
and the matrix table. Total measured output: **267 MB**.

Beyond the size, `ranked = [...rows]` (`:216`) sorts the **whole
universe**, not Top-N — `topPicksRows` then renders all 3528 rows. The
header even says "Top-Picks" but there is no slice.

**Mechanism:** Browser will choke (>500 MB heap after parse), and the
GitHub Actions artifact-upload step has a per-file soft limit much lower
than 250 MB. At 19 k tickers this exceeds 1.3 GB.

**Suggested fix:**
1. Slice `ranked.slice(0, TOP_PICKS_N)` (e.g. 200) before rendering.
2. Drop `data-row` entirely — the modal can look up data from a shared
   global `STOCK_DATA_MAP` keyed by ticker (same pattern Tag F-PF-006
   introduced in modes-report).
3. If `data-row` must stay, strip `r.results[m].flags`,
   `methodType`, `dataAsOf`, `dataAgeDays`, `sectorPercentile`,
   `confidence`, and `components` — only the fields the modal actually
   reads.

### F-GR-002 — `_manifest-full.json` rendered as a phantom ticker (HIGH)

**Files:**
  - `generate-methods-report.js:32` — `f !== '_manifest.json'`
  - `generate-modes-report.js:74` — `f !== '_manifest.json'`
  - `generate-screener.js:67` — same pattern (out of scope, but
    affected)

`pull-yahoo.js:1626` writes a richer `_manifest-full.json` next to
`_manifest.json`. All three discovery readers exclude only the latter,
so `_manifest-full.json` is parsed as a stock snapshot. Because it lacks
`meta.ticker`, the tickerisation falls back to `file.replace(/\.json$/,
'')` → `_manifest-full`.

Visible proof in the smoke-test output:
```
data-row='%7B%22ticker%22%3A%22_manifest-full%22%2C%22name%22%3A%22_manifest-full%22 ...
```

**Impact:** A row labelled "_manifest-full" appears in
methods-report's Top-Picks and matrix tables. The same row appears in
modes-report `evaluated` (then mostly filtered out by sector/MUST
gates, but still consumes a `renderCard` slot in some near-miss
buckets). Sector distribution counts are off by one.

**Suggested fix:** Change all three filters to either
`!f.startsWith('_')` or an explicit allow-list pattern like
`/^[A-Z0-9._-]+\.json$/i` that matches real ticker filenames.

### F-GR-003 — methods-report `escHtml()` renders `"null"` / `"undefined"` (HIGH, latent)

**File:** `generate-methods-report.js:27-29`

```js
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({...}[c]));
}
```

vs. `generate-modes-report.js:52-54` and
`generate-diff-report.js:22-24` which both guard
`String(s == null ? '' : s)`.

`String(null) === "null"`, `String(undefined) === "undefined"`. Today
every call site has an upstream `|| '...'` or `... != null ? ... :
'—'` guard, so the bug is latent. But e.g. line 320 `escHtml(r.ticker)`
relies on the (untrue!) assumption that `meta.ticker` is always a
string — `_manifest-full.json` falls back to `file.replace(...)` and is
fine, but the next snapshot whose `meta` is missing entirely would
print `"undefined"` to the page.

**Suggested fix:** Add the `s == null ? '' : s` guard to match the
other two generators' `escHtml`.

### F-GR-004 — `renderRow` has undefined `stockSlim` reference (MEDIUM, dead code)

**File:** `generate-modes-report.js:433`

```js
return `<div class="row" data-stock="${escHtml(JSON.stringify(stockSlim))}" ...`;
```

`stockSlim` is never declared anywhere in the file. The function is
labelled "Legacy: keep renderRow as alias for backward compat" but is
not exported (verified `module.exports = { eligibleForMode, topByMethod,
topAllMust, evaluateAll, dedupeByCompany }`), not called internally,
and would throw `ReferenceError` if anyone ever invoked it.

Also flagged in `findings/generators-cli.json` (F-GC-006) — still
unresolved.

**Suggested fix:** Delete `renderRow` (`:374-445`); it is dead code.

### F-GR-005 — `value || null` truthiness traps for legitimate zero (MEDIUM)

**File:** `generate-methods-report.js:63-66, 107`

```js
marketCap:   stock.marketCap && stock.marketCap.value || null,
revenueTTM:  stock.metrics && stock.metrics.revenueTTM && stock.metrics.revenueTTM.value || null,
growthYoY:   stock.metrics && stock.metrics.revenueGrowthYoY && stock.metrics.revenueGrowthYoY.value || null,
fcfMargin:   stock.metrics && stock.metrics.fcfMarginTTM && stock.metrics.fcfMarginTTM.value || null,
... grossMargin = ... && stock.metrics.grossMargin.value || null;
```

When the real value is `0` (e.g. a company with exactly 0% YoY growth,
or a freshly-spun-off entity with `revenueTTM = 0`), the expression
short-circuits both at the inner `&&` and the outer `||`, producing
`null`. The deep-dive and leaderboard tables then drop the row instead
of showing it as a valid "0%" entry.

**Suggested fix:** Use explicit nullish check, e.g.
`stock.metrics?.fcfMarginTTM?.value ?? null` (Node 14+ supports `??`
and `?.`), or `const m = stock.metrics?.revenueTTM; m?.value !=
null ? m.value : null`.

### F-GR-006 — Dashboard mode-pick row throws on null primaryMetric.value (MEDIUM)

**File:** `generate-dashboard.js:405`

```js
const valFmt = p.primaryMetric ? p.primaryMetric.value.toFixed(1) : '—';
```

If `p.primaryMetric` is `{ value: null }` (or `{ value: undefined }`),
`toFixed(1)` throws `TypeError`. Picks-history is upstream-generated;
nothing here guarantees `value` is always finite when `primaryMetric`
exists.

**Suggested fix:**
```js
const v = p.primaryMetric?.value;
const valFmt = (v != null && Number.isFinite(v)) ? v.toFixed(1) : '—';
```

### F-GR-007 — No `RUN_DATE_UTC` use across all four generators (MEDIUM)

**Files:**
  - `generate-modes-report.js:573, 1272`
  - `generate-methods-report.js:147`
  - `generate-dashboard.js:177, 356`

All four generators call `new Date().toISOString()` directly. Per
Tag-219 F-219b-01 the pipeline should pass `RUN_DATE_UTC` so all
reports in one run share a single date stamp. Today, if the workflow
straddles 00:00 UTC, `dashboard.html`, `modes-report.html`,
`methods-report.html`, `diff-report.html`, and `screener.html` can
display *different* "Last build" dates from a single workflow run.

**Suggested fix:** Add a shared helper (e.g.
`lib/run-date.js`) that reads `process.env.RUN_DATE_UTC` first and
falls back to `new Date().toISOString()`. Wire it into the workflow
the same way the screener does.

### F-GR-008 — Dashboard `onclick="openDetail('${ticker}')"` only escapes single quotes (LOW)

**File:** `generate-dashboard.js:409, 438`

```js
parts.push('<td class="tk"><button onclick="openDetail(\\''+p.ticker.replace(/'/g,"\\\\'")+'\\')">' ...);
```

Single quotes are escaped, but if a ticker ever contained `<`, `>`, or
a literal newline, the attribute would terminate early. Tickers today
are alphanumeric + `.` + `-`, so latent. Same issue Tag 217d flagged
in `generate-screener.js`.

**Suggested fix:** Use `escapeAttr(p.ticker)` (the existing helper)
inside the JS string, OR move the click handler to a delegated
event-listener that reads `data-ticker` (modes-report's pattern).

### F-GR-009 — methods-report writes non-atomic on slow disks (LOW)

**File:** `generate-methods-report.js:1069`,
`generate-dashboard.js:589`, `generate-diff-report.js:111, 35`

All three use raw `fs.writeFileSync(args.out, html)` rather than
`writeFileAtomic` from `lib/atomic-write.js`. modes-report already
uses the atomic helper for its pipeline-health output (Tag 217e), but
the main HTML output is still raw — including these three.

With 267 MB writes (methods-report) a CI cancellation mid-write
leaves a half-written file that GitHub Pages then serves.

**Suggested fix:** Switch the four main HTML writes to
`writeFileAtomic`.

### F-GR-010 — methods-report matrix column sort breaks on `—` cells (LOW)

**File:** `generate-methods-report.js:869-878`

```js
rows2.sort(function(a, b) {
  var av = a.cells[idx].textContent.trim();
  var bv = b.cells[idx].textContent.trim();
  var an = parseFloat(av.replace(/[^0-9.-]/g, ''));
  var bn = parseFloat(bv.replace(/[^0-9.-]/g, ''));
  if (!isNaN(an) && !isNaN(bn)) return dir === 'asc' ? an - bn : bn - an;
  return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
});
```

When some cells are `—` (incomputable) and others are numeric, the
comparator falls back to string sort for those pairs only, mixing two
ordering scales mid-sort → non-deterministic ordering of `—` rows
relative to numeric rows.

**Suggested fix:** Treat `NaN` cells as always-last (return `+1`/`-1`
depending on direction), as the modes-report sort (`:212-219`)
already does.

### F-GR-011 — diff-report shows `+?` for null delta on NEW status (LOW, cosmetic)

**File:** `generate-diff-report.js:93`

```js
html += `... <td class="${dirClass}">${d.delta > 0 ? '+' : ''}${d.delta != null ? d.delta : '?'}</td> ...`;
```

For NEW status (`prevPass == null`), `d.delta` is `undefined`. The
expression yields `+?` for the "no previous data" case which is
confusing.

**Suggested fix:** Use a NEW-status branch:
```js
const deltaTxt = d.status === 'NEW' ? 'NEW' :
                  ((d.delta > 0 ? '+' : '') + d.delta);
```

## 4. Clean files

- `generate-diff-report.js` — clean overall (only minor cosmetic
  F-GR-011 + the writeFileAtomic gap F-GR-009). Escape coverage is
  complete (`escHtml(d.ticker)`, `escHtml(d.methodId)`, plus
  formatted numbers).
- `generate-dashboard.js` — no XSS sinks (all interpolations go
  through `escapeAttr`), no `_manifest-full` issue (it reads from
  `picks-history/latest.json` upstream which has its own filter).
  Bugs limited to F-GR-006 + F-GR-007 + F-GR-008 + F-GR-009.

## 5. XSS-safety table

For each report, every user-data interpolation site and whether it
uses `esc()` / sanitisation.

### generate-modes-report.js

| Line | Sink | Source | Escape | Status |
|------|------|--------|--------|--------|
| 326  | `chip title="${esc...}"` | method label, value | `escHtml` | OK |
| 344  | `chip title="${esc...}"` | method label, value | `escHtml` | OK |
| 355  | `data-ticker, data-name, data-sector, ...` | meta | `escHtml` | OK |
| 357  | `<span class="card-ticker">` | ticker | `escHtml` | OK |
| 360  | `<div class="card-name">` | name | `escHtml` | OK |
| 362  | `card-sector title="..."` | sector | `escHtml` | OK |
| 364  | `card-pstate` | pstate label | `escHtml` | OK |
| 433  | **`data-stock="${escHtml(JSON.stringify(stockSlim))}"`** | undefined | n/a | **F-GR-004 (dead code, but ReferenceError if called)** |
| 511, 512 | `<option value="...">` | sector, country | `escHtml` | OK |
| 561  | `<p class="mode-desc">` | mode.description | `escHtml` | OK |
| 983  | `<p class="sub">` | totalStocks (number) | n/a | OK (number) |
| 1003 | `<div>Generated ...</div>` | generatedAt | `escHtml` | OK |
| 1010 | `<script>var STOCK_DATA_MAP = ${stockDataMapJson};</script>` | stock data | `JSON.stringify` only | **PARTIAL — no `</script>` escape**. A ticker name containing `</script>` would break out. Tickers currently never contain it, but other names might in future. |

### generate-methods-report.js

| Line | Sink | Source | Escape | Status |
|------|------|--------|--------|--------|
| 150  | `<th title="...">` | method.description | `escHtml` | OK |
| 181, 187 | sector cells | sector | `escHtml` | OK |
| 312  | `data-ticker="${r.ticker}"` | ticker | **none** | LOW (tickers are clean today; same risk as generate-screener.js Tag 217d) |
| 318  | `data-row='${rowData}'` | URI-encoded JSON | encodeURIComponent | OK |
| 320, 321, 323 | row cells | ticker, name, sector | `escHtml` | OK; but **F-GR-003** — `escHtml(null)` → `"null"` |
| 324-327 | row cells | display strings | `escHtml` | OK |
| 335  | `td title="${esc(result.reason)}"` | reason | `escHtml` | OK |
| 344  | `td title="${esc(result.reason)} | ..."` | reason | `escHtml` | OK |
| 349  | `data-ticker="${r.ticker}"` | ticker | **none** | LOW (same as :312) |
| 350-352 | row cells | ticker, name, sector | `escHtml` | OK |
| 445, 447 | `<tr data-ticker="...">` + cell | ticker | `escHtml` | OK |
| 448, 449, 450 | name, sector, display | various | `escHtml` | OK |
| 589  | filter checkboxes `<label>` | method label | `escHtml` | OK |
| 652-664 | `topm-row` cells | ticker, name, reason, valDisplay | `escHtml` | OK |
| 660  | `<strong>` ticker | ticker | `escHtml` | OK |
| 975  | client `escH()` modal helper | data.ticker, data.name, data.sector, ck, r.components values, r.reason | `escH` | OK (Tag 179 fix) |

### generate-dashboard.js

| Line | Sink | Source | Escape | Status |
|------|------|--------|--------|--------|
| 313  | `Stand <strong>${esc(asOf)}</strong>` | asOf | `escapeHTML` | OK |
| 397, 405 | mode pick rendering | ticker, name | `escapeAttr` | OK |
| 409, 438 | `onclick="openDetail('${ticker}')"` | ticker | `.replace(/'/g, ...)` only | **F-GR-008 — single-quote-only escape** |
| 428  | metric `<h2>` label + desc | label, desc | `escapeAttr` | OK |
| 435, 439 | metric leader row | ticker, name | `escapeAttr` | OK |
| 470-477 | modal head | ticker, meta.name, meta.sector, meta.industry, quality | `escapeAttr` | OK |
| 490  | modeStatus interpolates `inPick.score` raw | score (number) | n/a | OK |
| 540, 544 | method-row | id (method id), ticker | `escapeAttr` | OK |
| 364  | `<script>const DATA = ${dataJSON};</script>` | full payload | `JSON.stringify + .replace(/</g, '\\u003c')` | OK (closing `</script>` mitigated by `<` replacement) |

### generate-diff-report.js

| Line | Sink | Source | Escape | Status |
|------|------|--------|--------|--------|
| 83   | `<h1>` date labels | latest.date, previous.date | `escHtml` | OK |
| 93   | row cells | ticker, status, delta | `escHtml` on ticker; numbers raw | OK |
| 105  | row cells | ticker, methodId, deltas | `escHtml` on ticker + methodId | OK |

---

**Author:** Tag 220b parallel-audit agent (read-only).
