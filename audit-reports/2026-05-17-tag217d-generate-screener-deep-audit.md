# Tag 217d — generate-screener.js Deep Audit

**Date:** 2026-05-17
**Scope:** `generate-screener.js` (2422 lines: Node-side data load + row
construction + tab classification + score normalization + embedded CSS +
embedded CLIENT_JS template + HTML assembly + writer).
**Smoke test:** `node generate-screener.js` runs clean, emits 21,534 KB
`screener.html`. Tab counts HG=53 / QC=836 / SMALL=21 / R40=500 /
PRE_BREAKOUT=22 / WATCH=1289.

## 1. Executive Summary

**Total findings: 7**

| Severity  | Count |
|-----------|-------|
| CRITICAL  | 0     |
| HIGH      | 2     |
| MEDIUM    | 3     |
| LOW       | 2     |

Two HIGH-severity XSS / DOM-corruption bugs in client code, both stemming
from spots where the existing `esc()` helper was not applied. One is a
real, exploitable-style HTML-injection sink (header search results render
raw Yahoo `name` strings — 124 anchor stocks already contain `&` / `'`).
The other is in the R40 ticker cell where the warning-badge concat path
bypassed `esc(r.ticker)` (tickers are currently metachar-free across all
3528 snapshots, so impact is latent; but the same code shape is one bad
Yahoo response away from breaking the R40 tab).

MEDIUMs cover (a) `_buildScoreHistoryPayload` swallowing non-finite
`hgScore` payload values silently, (b) score-history `isFinite()` /
`Number.isFinite()` inconsistency in `rowTint()` letting `Infinity` past
the >=5 check, and (c) a peer-sort fall-back that uses raw ROIC ratio
mixed with 0-100 rank, producing nonsensical peer ordering when the
sector-medians file is mid-migration.

LOWs are a `searchInput.addEventListener('input')` with no debounce
(O(n) scan of ~3500 rows per keystroke) and `unwrap()` silently dropping
`{value: 0}` wrapped zeros that are technically finite but landed in the
"return null" path due to the `Number.isFinite(v.value)` short-circuit
(0 is finite, so this actually works — false alarm, see §3 LOW-2 for the
real edge).

## 2. Methodology

**Chunks read** (covering all 2422 lines):

- Lines 1–400: header, `escHtml`, `unwrap`, `loadStocks`, score-history
  loader, `_buildScoreHistoryPayload`, `buildRow` (per-stock row).
- Lines 400–850: tab classification (`classifyTabs` with all hard-gate
  reasons), R40 penalty, CSS template (themes, command palette, mobile,
  print, light theme overrides).
- Lines 850–1300: CLIENT_JS top — state, chip rendering, clearChipFilter,
  applyFilters, sortList, bullet-percentile maps, microSpark, trendCell,
  renderRow per tab.
- Lines 1300–1750: sector heatmap (`buildSectorHeatmap`, `_heatColor`,
  `renderSectorHeatmap`, `renderTable`), modal (`spark`, `showModal` with
  Sections A–G including peer-comparison Tag 210h), search results.
- Lines 1750–2200: command palette (`presetSave/Load/Delete`, command
  registry, cpQuery, cpRender, cpExecute, event wiring), keydown
  handlers, theme toggle.
- Lines 2200–2422: HTML template (header, tabs, filters, modal,
  commandPalette), `main()`.

**Sections covered:**
- XSS: every `innerHTML =` / `+= '<'` / `'>'+x+'<'` interpolation site
  scanned via Grep, cross-checked against `esc()` calls.
- Data-flow: tab classifier traced against `BULLET_COLS`, `applyFilters`,
  `sortList`, `presetApply` setters.
- Edge cases: empty list (`.empty-state` div), null arithmetic (
  `r.hgScore||0`, `b.r40||0`), pagination reset (`page = 1`).
- Smoke test: `node generate-screener.js` — clean run, 21.5 MB output.
- Final scan: `grep '<script>' screener.html` returns exactly 2 hits
  (data block + CLIENT_JS), no payload-injected script tags.

## 3. Findings

### HIGH-1 — Raw `h.ticker` / `h.name` injected into search results

**File:line:** `generate-screener.js:1747`
**Severity:** HIGH

```js
html += '<div class="sr" data-tk="'+h.ticker+'"><strong>'+h.ticker+
  '</strong> '+h.name+(badge?'<span class="badge">'+badge+'</span>':'')+ ...
```

**Mechanism:** The header search-dropdown re-creates DOM via `innerHTML`
with **raw** ticker + name. Inventory of current snapshots: 124 anchor
companies have `&`, `'` in their `name` (e.g. `Sun Hung Kai & Co. Limited`,
`AVIC Xi'an Aircraft Industry Group Company Ltd.`, `Goldwind
Science&Technology Co., Ltd.`). When the user types e.g. `Goldwind` into
the search box, the result row's `&Technology` substring will be
HTML-entity decoded (browser treats `&T...` as a malformed entity, yields
`&Technology` rendered correctly but with browser quirks). More
importantly, any future Yahoo feed that returns a name containing `<`
(e.g. an ETF named `S&P 500 <Index>`) injects arbitrary DOM into the
search-results panel. The `data-tk` attribute is also unquoted-safe: a
ticker with `"` would break the attribute and let a name with `onclick=`
fire on hover.

**Suggested fix:** Wrap every interpolation in the existing in-scope
`esc()` helper (defined at line 807; identical to the one used at line
1178 / 1182 / 1186 / 1189 / etc.):

```js
html += '<div class="sr" data-tk="'+esc(h.ticker)+'"><strong>'+
  esc(h.ticker)+'</strong> '+esc(h.name)+(badge? ...
```

This matches the row-render code's existing pattern and costs nothing
(`esc` is already a hot-path call).

### HIGH-2 — Raw `r.ticker` in R40 warning-badge concat

**File:line:** `generate-screener.js:1202–1203`
**Severity:** HIGH (latent — no current input triggers it)

```js
const tkCell = r.ticker + warnBadges.join('');
return rowOpen+'<td>'+(i+1)+'</td><td class="ticker">'+tkCell+'</td> ...
```

**Mechanism:** Every other tab uses `esc(r.ticker)` for the ticker cell
(lines 1182 / 1186 / 1189 / 1213 / 1223). The R40 path is the only one
that concatenates `r.ticker` with the badge HTML, then injects the joined
string raw. All 3528 current tickers are metachar-free, so this is not
exploitable today — but if Yahoo ever returns a ticker like
`BRK.B` followed by something containing `<` (e.g. an upstream pull bug
that splits a name into the ticker field), the entire R40 table breaks.

**Suggested fix:**

```js
const tkCell = esc(r.ticker) + warnBadges.join('');
```

### MEDIUM-1 — `_buildScoreHistoryPayload` silently drops invalid `hgScore`

**File:line:** `generate-screener.js:132`
**Severity:** MEDIUM

```js
const hgToday = today && Number.isFinite(today.hgScore) ? today.hgScore : null;
```

**Mechanism:** When a history entry exists but its `hgScore` was written
as `null` / `undefined` / `NaN` (e.g. a snapshot day where mode-eval
returned an incomputable score), `hgToday` falls to `null` and the
delta returns `null`. That's correct behavior — but the trim at line 143
(`history.entries.slice(-30)`) returns the **raw** entries including
those with `hgScore: null`. Downstream `microSpark()` at line 1142
filters them out (`return v != null`), so the sparkline silently
shortens when a snapshot day is missing scores. Result: a 30-day
sparkline can render as a 3-point line with no indication that 27 days
were dropped, misleading the user about the depth of history.

**Suggested fix:** Either annotate the modal's "(N daily snapshots)"
hint to count finite-score entries only, or write the trimmed array in
`_buildScoreHistoryPayload` to drop null-hgScore entries up front so the
displayed count matches the rendered sparkline.

### MEDIUM-2 — `rowTint()` uses `isFinite()` (global) instead of `Number.isFinite()`

**File:line:** `generate-screener.js:823`
**Severity:** MEDIUM

```js
if (r.scoreHistory && isFinite(r.scoreHistory.deltaScore7d) && r.scoreHistory.deltaScore7d >= 5) {
```

**Mechanism:** Global `isFinite()` coerces its argument (`isFinite("5") === true`,
`isFinite(true) === true`, `isFinite(null) === true` — yes,
`isFinite(null)` is `true` because `Number(null) === 0`). If
`deltaScore7d` is ever serialized as a string by an upstream snapshot
script (e.g. a JSON round-trip that emitted `"5.0"`), the >=5 check
evaluates `"5.0" >= 5` → `true`, painting a green tint even though the
property was logically corrupt. Same pattern at line 1147 (Δ7d badge in
trendCell) and 1154. The whole file uses `Number.isFinite()` (strict)
everywhere else (90+ occurrences); these are the only three globals.

**Suggested fix:** Replace `isFinite(` → `Number.isFinite(` at 823,
1147, 1154, 1126 (microSpark), 1142, 1635 (peerRoicPct), 1640
(peerGpTa), 1673, 1674. All trivial and tighten the invariants the rest
of the file already enforces.

### MEDIUM-3 — Peer sort mixes raw ROIC ratio with 0-100 rank

**File:line:** `generate-screener.js:1627–1637`
**Severity:** MEDIUM

```js
const peerRoicPct = (x) => {
  const m = x.results && x.results['sector-relative-roic'];
  if (!m || m.value == null || !isFinite(m.value)) return -Infinity;
  return m.value;  // <-- raw value: could be 0-100 rank OR -1..1 ratio
};
```

**Mechanism:** Comment at line 1630 explicitly acknowledges the dual
value-space (0-100 when computable=true, raw ratio when
computable=false), then sorts on the raw `m.value` anyway. Within a
single peer group (all same sector), this **usually** works because
all peers share the same mid-migration state. But during a partial
re-pull where some sector members have the new sector-medians file and
some don't, peer A's `value=0.42` (raw ratio = 42% ROIC) sorts above
peer B's `value=85` (85th-percentile rank). The user sees a "worse"
peer ranked higher.

Compare to the heatmap path at line 1268 which correctly branches on
`m.computable`.

**Suggested fix:** Apply the same branch as `_rowMetric()` line 1268:

```js
if (m.computable) return m.value;
return m.value * 100;  // align to percent-of-100 axis
```

### LOW-1 — Search-results `input` handler has no debounce

**File:line:** `generate-screener.js:1752`
**Severity:** LOW

```js
searchInput.addEventListener('input', e => runSearch(e.target.value));
```

`runSearch()` walks `Object.values(ROWS)` (~3500 entries) on every
keystroke. Modern hardware swallows this fine, but on a slow laptop
typing "GOOGL" fires 5 full scans in <1s. Wrap with a 60ms debounce
(matches the keystroke cadence) and the work drops to 1 scan per
typing burst. Same applies to `cpInput`'s `input` handler at line 2093
(searches `Object.values(ROWS)` plus a nested `TABS[t].some(...)` per
hit — O(n × tabs × hits) inside the inner loop at 1985–1987).

**Suggested fix:**

```js
let _debTimer = null;
searchInput.addEventListener('input', e => {
  const v = e.target.value;
  clearTimeout(_debTimer);
  _debTimer = setTimeout(() => runSearch(v), 60);
});
```

### LOW-2 — `unwrap()` returns null for `{value: 0}` only when `value` is missing

**File:line:** `generate-screener.js:58–63`
**Severity:** LOW (verified non-issue, documenting for the reviewer)

```js
function unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}
```

`Number.isFinite(0)` is `true`, so `{value: 0}` unwraps to `0`
correctly. False alarm. The real edge: an object **without** a `value`
property (e.g. `{computable: false}`) silently returns null. That's the
correct behavior — all current callers handle null — but no diagnostic
is emitted, so a malformed snapshot field would be invisible until
visible-in-modal time. Optionally tag the return path with a one-time
console.warn for the developer-only "object without numeric value"
case (not user-facing).

## 4. Clean Sections

The following recent additions were inspected end-to-end and are clean:

- **Tag 209e chip breadcrumbs + row tint + responsive + print:** `esc()`
  applied at chip label, removal dispatcher comprehensive, print CSS
  hides chrome correctly.
- **Tag 210f light theme toggle:** all CSS vars redefined for
  `.theme-light` (lines 662–688), localStorage `screener_theme` read in
  try/catch (line 2240), no theme variables fall through to dark.
- **Tag 210g sector heatmap:** clean-tabs universe correctly excludes
  WATCH, sector="—" skipped (line 1293), empty case handled (line 1357
  emits "No sector data" panel), `_heatColor()` palette aligns with
  row-tint colors.
- **Tag 210h peer comparison:** sector check + mcap > 0 guard at line
  1643, peer-row keyboard (tabindex/Enter/Space) wired at 1701–1714,
  graceful "no peers" message with reason at 1655–1659.
- **Tag 211g typography polish + focus rings + tabular-nums +
  micro-interactions:** `:focus-visible` ring at 537–540 with offset
  override for legacy `:focus`, tabular-nums on body, empty-state CSS
  at 639–641, peer-row `:hover` moved from JS inline to CSS (line 637).
- **Tag 212c bullet-bar percentile cells:** `buildPercentileMaps`
  computed once per `renderTable()` (memoized via local `pctMaps`
  passed to `renderRow`), gracefully degrades when all column values
  are null (the map is empty, `bulletCell` falls through to plain td).
- **Tag 212d per-row score sparklines:** `microSpark` returns empty
  string on `<2` valid points, `trendCell` falls back to mute em-dash.
- **Tag 213c command palette:** Ctrl+K / Cmd+K / "/" wired, `inField`
  check at line 2190 correctly suppresses "/" inside form fields,
  Escape dismisses palette before modal (order at line 2192–2196 is
  correct), `cpInput` event handlers all wired.
- **Tag 213d filter presets:** localStorage all in try/catch (1799,
  1803, 1855, 1859, 1864, 1873, 1877), `presetApply` uses
  `Object.assign` with defaults (lines 1830–1832) so a preset missing
  new fields (e.g. a future `filterRegion`) won't crash — it merges
  into the default and renders. Schema-migration-graceful by
  construction.

## 5. Security Review — XSS

**Sinks audited (every innerHTML / template-literal site):**

| Site | Field | Escaped? |
|------|-------|----------|
| chip label (881) | `c.label` | YES — `esc(c.label)` |
| row open `data-tk` (1178) | `r.ticker` | YES |
| HG/QC/SMALL/PRE/WATCH ticker+name+sector+country cells (1182–1223) | `r.{ticker,name,sector,country}` | YES |
| **R40 ticker cell (1203)** | `r.ticker` via `tkCell` | **NO — HIGH-2** |
| WATCH reason cell (1223) | `r.watchReasons.join(',')` | safe (enum strings, server-built) |
| sector heatmap row (1372, 1380) | `row.sector`, title | YES |
| modal header (1508) | `r.{ticker,name,sector,industry,country}` | YES |
| peer rows (1676–1677) | `p.ticker`, `p.name` | YES |
| **search-results (1747)** | `h.ticker`, `h.name` | **NO — HIGH-1** |
| command palette result rows (2008–2024) | `r.row.{ticker,name}`, `r.label` | YES via local `escHtml()` (line 2035) |
| sector/country `<option>` (2325, 2328) | server-side `escHtml()` (line 54) | YES |
| SCREENER_DATA JSON block (2281) | `</` → `<\/` guard | YES |

**Storage XSS / preset poisoning:** `presetLoad` wraps `JSON.parse` in
try/catch (line 1864–1867). A maliciously-crafted preset can populate
e.g. `filterSector = '<script>...'`. The chip bar **does** call `esc()`
on the label so the script tag is rendered as text. The
`document.getElementById('fSector').value = ...` at line 1843 sets a
`<select>` value (not innerHTML) — DOM-safe. No XSS via preset poisoning.

**`</script>` break-out guard:** Verified at line 2281 (`json.replace(/<\//g, '<\\/')`).
The output `screener.html` contains exactly 2 `<script>` tags (data +
client) — no breakouts from data-derived content.

## 6. Performance Notes

- **buildPercentileMaps (line 1090):** Re-runs on every `renderTable()`
  call. Each call sorts up to ~836 rows × 6 columns = ~5000 comparisons.
  Memoizing per `(filter-hash + tab)` would save ~1ms per filter
  keystroke. Not urgent (current cost is ~3–5ms total per render).
- **Sector heatmap (line 1279):** Cached at module level via
  `_sectorHeatmapCache`. Good.
- **Command palette `cpQuery` ticker search (1979):** O(n × tabs × hits)
  due to inner `TABS[t].some(x => x.ticker === r.ticker)` at line 1986
  to build tab badges per hit. With 7 tabs × up to 836 rows per tab × up
  to 30 hits = ~175k comparisons per keystroke. Build a one-time
  `tabsByTicker` reverse-index at palette init for O(1) lookup. Modest
  win on slow hardware.
- **Per-stock JSON.stringify in hot paths:** None found. The single
  `JSON.stringify(payload)` at line 2281 runs once at build time.
- **`Object.values(ROWS)` allocations:** Called from `runSearch` (1736),
  `cpQuery` (1977), `showModal` peer scan (1645). These allocate a new
  array each time. With 3527 entries × 3 sites × per-keystroke, this is
  noticeable on low-end devices. A module-scope `const ALL_ROWS =
  Object.values(ROWS);` computed once at init would remove the
  allocation churn.
- **`scoreHistory.history.slice(-30)` per row:** Done server-side, not
  per-render. No issue.
- **HTML output size:** 21.5 MB. Single-file dashboard — expected.
  `renderHTML()` correctly de-duplicates rows by emitting `rowsByTicker`
  + ticker-only tab arrays (line 2268–2269). Without this, payload
  would be ~50 MB.
