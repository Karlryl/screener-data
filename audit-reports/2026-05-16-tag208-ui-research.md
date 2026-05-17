# Tag 208 — UI/UX Research: Best-in-Class Financial Dashboard Patterns

**Date:** 2026-05-16
**Scope:** Evolving `screener.html` (Bloomberg-terminal-inspired, 6 tabs, ~512 KB single-file embedded `window.SCREENER_DATA`) toward institutional-grade visualization. Pure HTML/CSS/JS, no frameworks, no CDN deps.
**Current state inspected:** `generate-screener.js` (1319 lines, full CSS + CLIENT_JS template), `screener.html` (727 lines + embedded data blob). Zero `@media` queries, zero export/print code, single dark theme hard-coded.

---

## 1. Industry pattern survey (compact)

| Platform | Pattern worth stealing | Why it works |
|---|---|---|
| **Bloomberg Terminal** | Monochrome bg + 4-color semantic palette (green/red/amber/cyan) on bg-0; data first, chrome last; sticky column headers; column-aligned monospace numbers | Sub-second scanning of dense tables; eye trained on color = meaning, not decoration |
| **Refinitiv Eikon** | Heatmap "tile-wall" sector view; persistent breadcrumb showing active filters as removable chips | Spatial recall (where in the grid) outperforms textual recall (which row in the list) |
| **TradingView Screener** | Saved-views as named tabs; column picker dialog; conditional formatting (cell-level color scales) | Lets each user shape the table without forking the product |
| **Koyfin** | Bullet-style mini-bars in cells (actual vs target as a horizontal fill); per-metric percentile rank shown inline as 0–100 | Replaces 3 columns (value, peer median, percentile) with one glanceable bar |
| **Finviz** | Sector × performance heatmap with proportional rectangles (treemap) | Whole-market view in one screen; sized = mcap, color = performance |
| **Finchat AI** | Hybrid chat panel docked right of the dashboard; chart-as-card with "ask why" button | Question-driven exploration anchors data to decisions |
| **Observable / d3.js** | Small-multiples grid: same chart, repeated across slices (sector, region) | Eyes compare more accurately at scale-locked thumbnails than at one big chart |

Convergent lessons: **information density > whitespace**, **color = data type (not branding)**, **direct manipulation > modal dialogs**, **defaults that feel curated, escape hatches when they're wrong**.

---

## 2. Five concrete visualization upgrades

### Upgrade 1 — Inline percentile-rank bullet bar (cell-level)
**What it adds:** Every numeric cell (`R40`, `RevGr%`, `FCFM%`, `MCap`) gets a 60-px-wide horizontal bar behind the number, filled 0–100% by where this row ranks **within the current filtered list**. Replaces the user's need to mentally rank 50 rows on each scroll.
**Sketch (inline SVG inside `<td>`):**
```js
function bulletCell(value, allValues, fmt) {
  if (value == null) return '<td class="num">—</td>';
  const sorted = allValues.filter(v=>v!=null).sort((a,b)=>a-b);
  const pct = sorted.indexOf(value) / Math.max(1, sorted.length-1);
  const color = pct >= 0.66 ? '#00cc88' : pct >= 0.33 ? '#3d8fff' : '#8899aa';
  return `<td class="num"><div style="position:relative;display:inline-block;width:70px;text-align:right;">
    <div style="position:absolute;left:0;top:0;bottom:0;width:${(pct*100).toFixed(0)}%;background:${color}22;"></div>
    <span style="position:relative;">${fmt(value)}</span></div></td>`;
}
```
**Effort:** 30–90 min (compute percentile arrays once per `renderTable()` pass, wire 4 columns).
**Anchor:** Pure additive — `bulletCell()` replaces `'<td class="num">'+x+'</td>'` calls in `renderRow()`. Falls back to plain text if `allValues` empty. Existing column widths unchanged.

### Upgrade 2 — Sticky filter-state breadcrumb chips
**What it adds:** Active filters (`Sector=Tech, State=RECENT|STABLE, DQ≤B, MinR40=20`) render as removable chips below the filter bar. One click on the × removes that filter. Solves the current "lost in filters" problem where users forget what's narrowing the result.
**Sketch:**
```js
function renderActiveChips(){
  const chips = [];
  if (filterSector) chips.push({k:'sector', label:'Sector: '+filterSector});
  if (filterIpo !== 'ALL') chips.push({k:'ipo', label:'IPO: '+filterIpo});
  // ...one per active filter
  const html = chips.map(c =>
    `<span class="chip" data-chip="${c.k}">${c.label} <span class="x">×</span></span>`).join('');
  document.getElementById('chips').innerHTML = html;
}
// CSS: .chip{display:inline-block;padding:2px 6px;margin:2px;border:1px solid var(--border-bright);font-size:10px;font-family:var(--mono);} .chip .x{margin-left:4px;cursor:pointer;color:var(--text-2);} .chip .x:hover{color:var(--red);}
```
**Effort:** ≤30 min.
**Anchor:** New `<div id="chips">` slot under the filters bar; no existing element changes.

### Upgrade 3 — Score-history sparkline in every row (replaces single-modal-only)
**What it adds:** A 60×16 px sparkline of the last N daily `hgScore` values inside a new "Trend" column, plus a Δ7d delta badge. Currently this lives **only inside the modal** — promoting it to row-level surfaces the trend without a click.
**Sketch (reuse the existing `spark()` helper but compress):**
```js
function microSpark(values, w=60, h=16){
  const vs = values.filter(v=>v!=null);
  if (vs.length < 2) return '';
  const min = Math.min(...vs), max = Math.max(...vs), r = (max-min)||1;
  const pts = vs.map((v,i)=>`${(i/(vs.length-1)*w).toFixed(1)},${(h - (v-min)/r*h).toFixed(1)}`).join(' ');
  const color = vs[vs.length-1] >= vs[0] ? '#00cc88' : '#ff3d5a';
  return `<svg width="${w}" height="${h}" style="vertical-align:middle"><polyline points="${pts}" stroke="${color}" stroke-width="1" fill="none"/></svg>`;
}
```
**Effort:** 30–90 min (add column to `tabColumns()`, wire `r.scoreHistory.history` in `renderRow()`).
**Anchor:** Add `{k:'Trend', w:75}` to HG/QC/R40 column arrays; skip on PRE_BREAKOUT/WATCH/SMALL to preserve their narrower layouts. No existing column touched.

### Upgrade 4 — Conditional-format row stripes (semantic, not aesthetic)
**What it adds:** Row background tint = the row's **dominant signal** (green tint if Δ7d ≥ +5; red tint if any hard-gate flag is set; amber if DQ ∈ {C,D}; default if neutral). 2–4 % alpha — subtle enough to scan past, present enough to spot clusters.
**Sketch (extend `renderRow()` per-tab):**
```js
function rowTint(r){
  if (r.qSpikeFail || r.lossMagFail || r.metricDivFail) return 'background:rgba(255,61,90,0.04);';
  if (r.scoreHistory && r.scoreHistory.deltaScore7d >= 5) return 'background:rgba(0,204,136,0.04);';
  if (r.dqGrade === 'C' || r.dqGrade === 'D') return 'background:rgba(255,187,51,0.04);';
  return '';
}
// then in the HG tr template:
// '<tr class="row" style="'+rowTint(r)+'" data-tk="...'
```
**Effort:** ≤30 min.
**Anchor:** Tint stacks under hover (`:hover` overrides background fully). No data dependency the row didn't already use.

### Upgrade 5 — Small-multiples annual-trend strip in the modal header
**What it adds:** Replace the modal's 2×2 chart grid (Revenue, GM, OpM, FCFM — each 300×160) with a **single horizontal strip of 4 small-multiples at 140×40**, sitting right under the cards. User sees all four trends at once without scrolling. The large 300×160 charts can stay below as drill-down.
**Sketch:**
```js
const stripCharts = [
  {ct:'Rev', s:r.annual.rev,    bar:true},
  {ct:'GM%', s:gmSeries,        bar:false},
  {ct:'OpM%',s:omSeries,        bar:false},
  {ct:'FCFM%',s:fmSeries,       bar:false}
];
html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:8px 0 16px;">';
for (const c of stripCharts) {
  html += `<div style="background:var(--bg-2);border:1px solid var(--border);padding:4px 6px;">
    <div style="font-size:10px;color:var(--text-2);text-transform:uppercase;">${c.ct}</div>
    ${miniSpark(c.s, 140, 36, c.bar)}</div>`;
}
html += '</div>';
```
**Effort:** 30–90 min (need a `miniSpark()` variant of `spark()` with fewer axis labels).
**Anchor:** Sits between cards and existing charts. Existing large-charts section unchanged.

---

## 3. Two new tab/section ideas

### Tab idea A — "Sector Heatmap"
A Finviz-style treemap (or simpler: a grid of fixed-size tiles grouped by sector header). Each tile = one ticker; size = `mcap` (4 buckets: micro/small/mid/large/mega); fill color = `hgScore` (or current sort-key); hover = tooltip with key metrics; click = open modal. Implementation in pure SVG: ~150 lines, no library. Solves "which sectors are dense with quality right now?" — currently unanswerable without sorting + scrolling 6 tabs.

**Why no framework:** SVG `<rect>` with absolute positions inside a `viewBox`; CSS `grid-template-columns` for sector lanes; ~80 lines of generation logic in `generate-screener.js`.

### Tab idea B — "Peer Comparison"
User selects 2–5 tickers (multi-select chips at top, persisted in URL hash). Renders a parallel-coordinates chart: 7 axes (Growth, FCFM, OpM, GM, R40, MCap, hgScore), one polyline per ticker, colored distinctly. Below: an aligned table with same metrics, +/− shading per cell against the cohort median. Critical for "is GOOGL or MSFT a better R40 today?" comparisons that the existing single-row modal cannot answer.

**Why no framework:** Parallel-coords is ~60 lines of SVG (axes = scaled lines, polylines = `<polyline>`). Multi-select chips reuse the chip pattern from Upgrade 2.

---

## 4. Mobile UX critique (1 issue, biggest)

**Show-stopper:** `generate-screener.js` ships zero `@media` queries. On phone (~390 px wide):

- The 11-column HG table at `width:100%` forces horizontal scroll inside `.table-wrap`, but the **`<header>` and `.tabs` bar use `display:flex` with non-wrapping children** — the brand + search + tab list overflow the viewport with no scroll fallback, hiding tabs 4–6 entirely.
- `.modal-content` sets `max-width:1100px` but no `width:100%` fallback; on mobile it renders centered with margin overflow, and the `.cards` grid (`grid-template-columns:repeat(3,1fr)`) makes each card ~110 px wide → the 26 px metric value wraps badly.
- Filter bar's 8 `<select>` + 4 `<input type=number>` + 5 state pills wrap into ~6 rows of unclickable 11-px tap targets (Apple HIG minimum is 44 px).

**Minimal fix (~30 min):** Add at the end of the CSS template:
```css
@media (max-width:700px){
  header{flex-wrap:wrap;}
  .tabs{overflow-x:auto;white-space:nowrap;}
  .tabs button{flex-shrink:0;}
  .cards{grid-template-columns:1fr;}
  .charts{grid-template-columns:1fr;}
  .modal-content{margin:0;padding:12px;max-width:100%;}
  .filters select,.filters input,.filters button.f{min-height:32px;font-size:12px;}
  table.dt th,table.dt td{padding:4px 6px;font-size:11px;}
}
```

---

## 5. Print/export gap analysis (what users can NOT do today)

| Capability | Status | Gap |
|---|---|---|
| **CSV download of current view** | Missing | The filtered+sorted `currentList` is in memory; users must screenshot or copy-paste. Cost: 1 button + ~20 lines of `Blob`+`URL.createObjectURL` |
| **Print to PDF** | Half-broken | No `@media print` stylesheet. Printing the page outputs the dark bg as solid black ink (paper-wasteful) and clips the table at the viewport edge |
| **Save current filter combo** | Missing | No URL-hash sync of filter state; can't bookmark "Tech + RECENT + R40 > 30" or share with a colleague |
| **Per-ticker tear-sheet PDF** | Missing | Modal can't be exported; users screenshot for personal notebooks |
| **JSON export of single row** | Missing | Useful for piping into spreadsheets / agent workflows (`ROWS[ticker]` is right there) |

**Minimal print-stylesheet fix (~15 min):**
```css
@media print{
  body{background:#fff;color:#000;font-size:10pt;}
  header,.tabs,.filters,.pagination{display:none;}
  table.dt{font-size:9pt;} table.dt th{background:#eee;color:#000;}
  .pill{border:1px solid #888;} .modal{position:static;background:#fff;}
}
```

**Minimal CSV-export fix (~20 min):** One button in the header → builds CSV string from `currentList` → `Blob` → `<a download>` click. No deps.

**Minimal URL-state fix (~30 min):** Wrap each filter setter to call `history.replaceState(null, '', '#' + new URLSearchParams({tab:activeTab, sector:filterSector, ...}))` and parse on load.

---

## 6. Theme switching (bonus, since stack permits)

Current CSS uses CSS custom properties on `:root` (already prepared!). Adding a light theme is **one CSS block + one toggle button**:

```css
:root[data-theme="light"]{
  --bg-0:#fafbfc; --bg-1:#fff; --bg-2:#f0f3f6; --bg-hover:#e8edf3;
  --border:#d0d7de; --border-bright:#8c959f;
  --text-0:#1f2328; --text-1:#656d76; --text-2:#9098a1;
  --green:#1a7f37; --red:#cf222e; --yellow:#9a6700; --blue:#0969da;
}
```
Persist in `localStorage`, default to `prefers-color-scheme`. ~15 min total.

---

## 7. Constraint check

All proposals: pure HTML/CSS/JS, inline SVG only, zero CDN/external libs, single-file output preserved. The chip/tint/sparkline upgrades are pure DOM string concatenation in `generate-screener.js`; the heatmap/peer-comparison tabs are net-new render functions that follow the existing `renderTable()` dispatch pattern. None of them mutate the `SCREENER_DATA` schema — they all consume fields already present (`scoreHistory`, `dqGrade`, `qSpikeFail`, etc.).

---

**Word count:** ~1450
