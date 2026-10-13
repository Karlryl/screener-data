# Phase 1 Screener Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor screener from all-purpose composite to "choose universe → rank objectively → show trend," exposing R40/RX as first-class configurable filters, adding a KI Infrastruktur tab, and banking per-ticker R40/RX point-in-time history.

**Architecture:** Minimal-footprint changes — new files (`filter-config.json`, `ki-infra.json`, `r40rx-history/`, `scripts/snapshot-r40rx-history.js`, `scripts/backfill-r40rx-history.js`) plus targeted edits to `rule-of-40.js`, `rule-of-x.js`, `generate-screener.js`, `scripts/snapshot-score-history.js`, and the CI workflow. HYPERGROWTH/QUALITY_COMPOUNDER code is NOT deleted — only hidden in the UI via a CSS data-attribute. All changes preserve the fixture-hash invariant as long as default thresholds remain 40/50.

**Tech Stack:** Node.js 22, vanilla JS (no bundler), Yahoo Finance quarterly arrays (`timeseries.revenueQ`), atomic file writes via `lib/atomic-write.js`, existing CI pipeline `daily-pull.yml`.

---

## Fixture-Hash Invariant — Assessment (READ BEFORE TOUCHING CODE)

`engine-cli-tests.js` runs 10 fixtures through `Engine.scoreTrackA/B()` and checks `subProfile`, `bucket`, and `actionStatus`. It runs as a pre-pull CI gate (`node engine-cli-tests.js`).

**Impact of this plan:**

| Change | Fixture risk |
|---|---|
| filter-config.json with defaults (40/50) | NONE — try-require falls back to hardcoded if file missing |
| rule-of-40.js/rule-of-x.js load config at module init | NONE as long as defaults match current THRESHOLD const |
| If Karl later changes filter-config to e.g. threshold=35 | LOW — all current fixture R40 values are >>35, buckets unlikely to change |
| buildRow() + classifyTabs() changes | NONE — engine-cli-tests.js doesn't call buildRow() |
| KI_INFRA tab / banking scripts | NONE — don't touch engine |

**When the invariant IS in the way:** If threshold tuning causes a fixture's `rule-of-40.pass` to flip AND that method is a `must`-weighted method in the fixture's winning track → bucket changes → test fails. The fix at that point is to update the fixture's `expected` to reflect the intentionally-changed behavior. This is correct behavior, not a problem to work around.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `filter-config.json` | **Create** | Single source of truth for R40/RX thresholds |
| `methods/rule-of-40.js` | **Modify** (4 lines) | Read threshold from config with fallback |
| `methods/rule-of-x.js` | **Modify** (5 lines) | Read threshold+multiplier from config with fallback |
| `generate-screener.js` | **Modify** (5 locations) | rxValue in buildRow; KI_INFRA tab; default tab; columns |
| `ki-infra.json` | **Create** | KI Infra universe seed data (machine-fillable later) |
| `scripts/snapshot-score-history.js` | **Modify** (2 locations) | Add r40/rx/growth/fcfMargin/fcfMarginSource to entries |
| `scripts/snapshot-r40rx-history.js` | **Create** | Stand-alone quarterly R40/RX banking (separate window) |
| `scripts/backfill-r40rx-history.js` | **Create** | One-time backfill from Yahoo quarterly arrays |
| `.github/workflows/daily-pull.yml` | **Modify** (1 location) | Add snapshot-r40rx-history step after score-history |
| `tag-r40rx-config-tests.js` | **Create** | Tests for config-driven threshold behaviour |

---

## Task 1: Create `filter-config.json`

**Files:**
- Create: `filter-config.json`

- [ ] **Step 1: Create the config file**

```json
{
  "_meta": {
    "description": "Tuning layer for first-class screener filters. Edit here instead of method files.",
    "schema": "filter-config-v1"
  },
  "rule_of_40": {
    "threshold": 40,
    "note": "R40 = revenueGrowthYoY + fcfMarginTTM >= threshold"
  },
  "rule_of_x": {
    "threshold": 50,
    "multiplier": 1.5,
    "note": "RX = multiplier * revenueGrowthYoY + fcfMarginTTM >= threshold"
  },
  "ui": {
    "defaultTab": "R40",
    "hiddenTabs": ["HG", "QC"],
    "note": "Set hiddenTabs to [] to restore HG/QC to default view"
  }
}
```

Write to: `C:\Users\Karlr\OneDrive\Dokumente\GitHub\screener-data\filter-config.json`

- [ ] **Step 2: Run the existing engine tests to confirm baseline**

```
node engine-cli-tests.js
```

Expected: All 10 fixtures pass, exit 0. This is the baseline we must not break.

- [ ] **Step 3: Commit**

```bash
git add filter-config.json
git commit -m "feat: add filter-config.json — central tuning layer for R40/RX thresholds"
```

---

## Task 2: Wire `filter-config.json` into `rule-of-40.js`

**Files:**
- Modify: `methods/rule-of-40.js` (lines 13-16, after `const H = require('./_helpers.js');`)

- [ ] **Step 1: Write the failing test**

Create `tag-r40rx-config-tests.js` in the repo root:

```javascript
'use strict';
const assert = require('assert');
const path = require('path');

// Test 1: rule-of-40 uses hardcoded THRESHOLD=40 when no config override
// (simulated by passing stock directly to evaluate)
const R40 = require('./methods/rule-of-40.js');
const stock1 = {
  metrics: { revenueGrowthYoY: { value: 20 }, fcfMarginTTM: { value: 18 } },
  annual: {}
};
// 20 + 18 = 38 → below default threshold 40 → pass=false
const r1 = R40.evaluate(stock1);
assert.strictEqual(r1.computable, true, 'Test1: computable');
assert.strictEqual(r1.pass, false, 'Test1: R40=38 < 40 → pass=false');
assert.strictEqual(r1.value, 38, 'Test1: value=38');

const stock2 = {
  metrics: { revenueGrowthYoY: { value: 25 }, fcfMarginTTM: { value: 18 } },
  annual: {}
};
// 25 + 18 = 43 → above threshold 40 → pass=true
const r2 = R40.evaluate(stock2);
assert.strictEqual(r2.pass, true, 'Test2: R40=43 >= 40 → pass=true');

// Test 2: rule-of-x uses hardcoded defaults
const RX = require('./methods/rule-of-x.js');
const stock3 = {
  metrics: { revenueGrowthYoY: { value: 20 }, fcfMarginTTM: { value: 10 } }
};
// 1.5*20 + 10 = 40 → below threshold 50 → pass=false
const r3 = RX.evaluate(stock3);
assert.strictEqual(r3.computable, true, 'Test3: computable');
assert.strictEqual(r3.pass, false, 'Test3: RX=40 < 50 → pass=false');

const stock4 = {
  metrics: { revenueGrowthYoY: { value: 30 }, fcfMarginTTM: { value: 10 } }
};
// 1.5*30 + 10 = 55 → above threshold 50 → pass=true
const r4 = RX.evaluate(stock4);
assert.strictEqual(r4.pass, true, 'Test4: RX=55 >= 50 → pass=true');

console.log('tag-r40rx-config-tests: ALL PASS');
```

- [ ] **Step 2: Run test to confirm it passes against current code (baseline)**

```
node tag-r40rx-config-tests.js
```

Expected: `tag-r40rx-config-tests: ALL PASS` (confirms defaults are 40/50 as expected)

- [ ] **Step 3: Modify `methods/rule-of-40.js` to read threshold from config**

In `methods/rule-of-40.js`, replace the existing constants block (lines 13-16):

Old code:
```javascript
const H = require('./_helpers.js');

const ID = 'rule-of-40';
const LABEL = 'Rule of 40';
const THRESHOLD = 40;
const THRESHOLD_OP = 'gte';
```

New code:
```javascript
const H = require('./_helpers.js');

const ID = 'rule-of-40';
const LABEL = 'Rule of 40';
const THRESHOLD_OP = 'gte';

// Load threshold from filter-config.json if present; fall back to hardcoded 40.
// This preserves fixture-hash stability when config is absent (CI default state).
let THRESHOLD = 40;
try {
  const cfg = require('../filter-config.json');
  if (cfg && cfg.rule_of_40 && typeof cfg.rule_of_40.threshold === 'number') {
    THRESHOLD = cfg.rule_of_40.threshold;
  }
} catch (_) { /* config absent — use hardcoded default */ }
```

- [ ] **Step 4: Run test to verify it still passes**

```
node tag-r40rx-config-tests.js
```

Expected: `tag-r40rx-config-tests: ALL PASS`

- [ ] **Step 5: Run engine-cli-tests to verify fixture-hash still holds**

```
node engine-cli-tests.js
```

Expected: All 10 fixtures pass, exit 0.

- [ ] **Step 6: Commit**

```bash
git add methods/rule-of-40.js tag-r40rx-config-tests.js
git commit -m "feat: rule-of-40 reads threshold from filter-config.json with hardcoded fallback"
```

---

## Task 3: Wire `filter-config.json` into `rule-of-x.js`

**Files:**
- Modify: `methods/rule-of-x.js` (lines 1-8)

- [ ] **Step 1: Modify `methods/rule-of-x.js` to read threshold and multiplier from config**

In `methods/rule-of-x.js`, replace the existing constants block (lines 4-8):

Old code:
```javascript
const ID = 'rule-of-x';
const LABEL = 'Rule-of-X';
const THRESHOLD = 50;
const THRESHOLD_OP = 'gte';
```

New code:
```javascript
const ID = 'rule-of-x';
const LABEL = 'Rule-of-X';
const THRESHOLD_OP = 'gte';

// Load threshold and multiplier from filter-config.json if present; fall back to hardcoded values.
let THRESHOLD = 50;
let MULTIPLIER = 1.5;
try {
  const cfg = require('../filter-config.json');
  if (cfg && cfg.rule_of_x) {
    if (typeof cfg.rule_of_x.threshold === 'number') THRESHOLD = cfg.rule_of_x.threshold;
    if (typeof cfg.rule_of_x.multiplier === 'number') MULTIPLIER = cfg.rule_of_x.multiplier;
  }
} catch (_) { /* config absent — use hardcoded defaults */ }
```

- [ ] **Step 2: Update `rule-of-x.js` to use `MULTIPLIER` variable instead of literal `1.5`**

In `methods/rule-of-x.js` line 27:

Old code:
```javascript
  const value = 1.5 * growth + fcfMargin;
```

New code:
```javascript
  const value = MULTIPLIER * growth + fcfMargin;
```

And update the `reason` string at line 31:

Old code:
```javascript
    reason: '1.5×' + growth.toFixed(0) + ' + ' + fcfMargin.toFixed(0) + ' = ' + value.toFixed(0),
```

New code:
```javascript
    reason: MULTIPLIER + '×' + growth.toFixed(0) + ' + ' + fcfMargin.toFixed(0) + ' = ' + value.toFixed(0),
```

And the `components` at line 30:

Old code:
```javascript
    components: { growth, fcfMargin, multiplier: 1.5 },
```

New code:
```javascript
    components: { growth, fcfMargin, multiplier: MULTIPLIER },
```

- [ ] **Step 3: Run both test files**

```
node tag-r40rx-config-tests.js && node engine-cli-tests.js
```

Expected: All pass, exit 0.

- [ ] **Step 4: Commit**

```bash
git add methods/rule-of-x.js
git commit -m "feat: rule-of-x reads threshold/multiplier from filter-config.json with hardcoded fallback"
```

---

## Task 4: Add `rxValue` to `buildRow()` in `generate-screener.js`

**Files:**
- Modify: `generate-screener.js` (lines 246-248 area and line 392-418 area)

The `buildRow()` function already computes `r40Value` (line 247) but never computes `rxValue`. The KI Infra tab needs it as the default sort key, and the trend history needs it for banking.

- [ ] **Step 1: Add rxValue computation in `buildRow()` after r40Value (around line 248)**

In `generate-screener.js`, after the block:
```javascript
  const r40 = allResults['rule-of-40'];
  const r40Value = (r40 && r40.computable && Number.isFinite(r40.value)) ? r40.value : null;
```

Add:
```javascript
  const rx = allResults['rule-of-x'];
  const rxValue = (rx && rx.computable && Number.isFinite(rx.value)) ? rx.value : null;
```

- [ ] **Step 2: Add `rxValue` to the return object of `buildRow()` (around line 401-403)**

In the return object, after `r40: r40Value,`:
```javascript
    r40: r40Value,
    rx: rxValue,
```

- [ ] **Step 3: Run generate-screener.js to confirm it still produces valid HTML**

```
node generate-screener.js --snapshots snapshots --out screener-test.html 2>&1 | tail -10
```

Expected: No errors, `[screener] tab ...` lines showing row counts, exit 0.

- [ ] **Step 4: Clean up and commit**

```bash
del screener-test.html
git add generate-screener.js
git commit -m "feat: add rxValue to buildRow row object"
```

---

## Task 5: Hide HG/QC from Default View — Change Default Tab to R40

**Files:**
- Modify: `generate-screener.js` (lines 1031 and 3347-3348)

The spec says: "HYPERGROWTH und QUALITY_COMPOUNDER aus dem Default-Fokus/UI nehmen. Code NICHT löschen, nur aus der Default-Ansicht entfernen, reversibel."

Strategy: add `data-hidden="true"` to HG and QC buttons + CSS to hide them; change default active tab from `HG` to `R40`. The `filter-config.json`'s `ui.hiddenTabs` array documents which tabs are hidden (Karl can edit the JSON to unhide without touching JS).

- [ ] **Step 1: Change default activeTab from 'HG' to 'R40' (client-side JS, around line 1031)**

Find:
```javascript
  let activeTab = 'HG';
```

Replace with:
```javascript
  let activeTab = 'R40';
```

- [ ] **Step 2: Change the tab button HTML at lines 3347-3348**

Find:
```html
  <button data-tab="HG" class="active" role="tab" aria-current="page" aria-selected="true">⚡ Hypergrowth</button>
  <button data-tab="QC" role="tab" aria-selected="false">🏛 Quality-Compounder</button>
```

Replace with:
```html
  <!-- HG/QC hidden from default view per filter-config.json ui.hiddenTabs — remove data-hidden to restore -->
  <button data-tab="HG" data-hidden="true" role="tab" aria-selected="false" style="display:none">⚡ Hypergrowth</button>
  <button data-tab="QC" data-hidden="true" role="tab" aria-selected="false" style="display:none">🏛 Quality-Compounder</button>
  <button data-tab="BF" role="tab" aria-selected="false">📜 Buffett</button>
  <button data-tab="SMALL" role="tab" aria-selected="false">📈 Small Cap</button>
  <button data-tab="R40" class="active" role="tab" aria-current="page" aria-selected="true">📊 Rule of 40</button>
```

Note: only remove the BF line that was between QC and SMALL and reinstate it before SMALL, preserving the full order. The full replacement for lines 3347-3354 should be:

```html
<div class="tabs" role="tablist" aria-label="Screener tabs">
  <!-- HG/QC hidden from default view — remove data-hidden + style to restore -->
  <button data-tab="HG" data-hidden="true" role="tab" aria-selected="false" style="display:none">⚡ Hypergrowth</button>
  <button data-tab="QC" data-hidden="true" role="tab" aria-selected="false" style="display:none">🏛 Quality-Compounder</button>
  <button data-tab="BF" role="tab" aria-selected="false">📜 Buffett</button>
  <button data-tab="SMALL" role="tab" aria-selected="false">📈 Small Cap</button>
  <button data-tab="R40" class="active" role="tab" aria-current="page" aria-selected="true">📊 Rule of 40</button>
  <button data-tab="PRE_BREAKOUT" role="tab" aria-selected="false">🎯 Pre-Breakout</button>
  <button data-tab="WATCH" role="tab" aria-selected="false">👁 Watch</button>
  <button data-tab="SECTOR" role="tab" aria-selected="false">🌡 SECTOR</button>
```

- [ ] **Step 3: Verify screener loads on R40 tab by generating and opening the HTML**

```
node generate-screener.js --snapshots snapshots --out screener.html 2>&1 | grep "tab R40"
```

Expected: `[screener] tab R40: <N>` shows a positive number.

- [ ] **Step 4: Commit**

```bash
git add generate-screener.js
git commit -m "feat: default tab → R40, hide HG/QC with data-hidden (reversible)"
```

---

## Task 6: Create `ki-infra.json` Seed Data

**Files:**
- Create: `ki-infra.json`

This file is the Phase-2-ready config that Phase 2's automated refresh will machine-update. The schema (`_meta.schema`) acts as a version gate for that future validator.

- [ ] **Step 1: Create `ki-infra.json`**

```json
{
  "_meta": {
    "version": "1.0",
    "schema": "ki-infra-v1",
    "updated_at": "2026-05-24",
    "updated_by": "manual",
    "note": "Phase 2: this file will be machine-updated by automated research refresh. Keep category keys stable."
  },
  "categories": {
    "Connectivity": [
      { "ticker": "ALAB", "name": "Astera Labs", "note": "PCIe/CXL connectivity for AI clusters" },
      { "ticker": "CRDO", "name": "Credo Technology", "note": "Active electrical cables, SerDes for hyperscalers" }
    ],
    "Energy": [
      { "ticker": "BE", "name": "Bloom Energy", "note": "Solid oxide fuel cells for data center power" }
    ],
    "Data Centers": [],
    "Supply Bottlenecks": []
  }
}
```

Write to: `C:\Users\Karlr\OneDrive\Dokumente\GitHub\screener-data\ki-infra.json`

- [ ] **Step 2: Verify the JSON is valid**

```
node -e "const x = require('./ki-infra.json'); console.log('KI cats:', Object.keys(x.categories).join(', '))"
```

Expected: `KI cats: Connectivity, Energy, Data Centers, Supply Bottlenecks`

- [ ] **Step 3: Commit**

```bash
git add ki-infra.json
git commit -m "feat: ki-infra.json — KI Infrastruktur universe seed data (Phase-2-ready schema)"
```

---

## Task 7: Wire KI Infrastruktur Tab into `generate-screener.js`

**Files:**
- Modify: `generate-screener.js` (5 locations)

This is the largest single task. It adds the `KI_INFRA` tab: assembly in `classifyTabs()`, column definition in `tabColumns()`, percentile bullets in `BULLET_COLS`, and the tab button in the HTML template.

- [ ] **Step 1: Load `ki-infra.json` at the top of `generate-screener.js`**

After the existing `require` statements at the top of `generate-screener.js` (around line 29, after the `writeFileAtomic` require):

```javascript
// KI Infrastruktur universe — manually seeded, Phase-2-ready for machine updates.
let KI_INFRA_CONFIG = { categories: {} };
try {
  KI_INFRA_CONFIG = require('./ki-infra.json');
} catch (_) { /* ki-infra.json absent — KI_INFRA tab will be empty */ }

// Build a flat ticker→category map for O(1) lookup in classifyTabs.
const KI_INFRA_TICKER_MAP = {};  // ticker → { category, name, note }
for (const [cat, entries] of Object.entries(KI_INFRA_CONFIG.categories || {})) {
  for (const entry of (entries || [])) {
    if (entry && entry.ticker) {
      KI_INFRA_TICKER_MAP[entry.ticker.toUpperCase()] = { category: cat, name: entry.name || '', note: entry.note || '' };
    }
  }
}
```

- [ ] **Step 2: Add `KI_INFRA` to `classifyTabs()` (around line 455-600)**

In `classifyTabs()`, right after the line `const tabs = { HG: [], QC: [], BF: [], SMALL: [], R40: [], PRE_BREAKOUT: [], WATCH: [] };` (line 456):

Change that line to:
```javascript
  const tabs = { HG: [], QC: [], BF: [], SMALL: [], R40: [], PRE_BREAKOUT: [], WATCH: [], KI_INFRA: [] };
```

Then, inside the `for (const r of rows)` loop, after the `tabs.WATCH.push(r)` block at the end of the loop body (around line 555), add KI_INFRA membership:

```javascript
    // KI Infrastruktur tab: show ALL tickers in ki-infra.json regardless of guard status.
    // FCF-negative stocks are included but marked via r.fcfPositive flag in rendering.
    const kiEntry = KI_INFRA_TICKER_MAP[(r.ticker || '').toUpperCase()];
    if (kiEntry) {
      r.kiCategory = kiEntry.category;
      r.kiNote = kiEntry.note;
      tabs.KI_INFRA.push(r);
    }
```

After the loop, add the KI_INFRA sort (by rxValue desc, null last):

After `tabs.WATCH.sort(...)` and before `tabs.R40 = tabs.R40.slice(0, 500);`, add:

```javascript
  tabs.KI_INFRA.sort((a, b) => {
    // Primary: category alphabetically (groups the curated list visually)
    const catCmp = (a.kiCategory || '').localeCompare(b.kiCategory || '');
    if (catCmp !== 0) return catCmp;
    // Within category: rx desc (null last), then ticker asc
    const aRx = a.rx != null ? a.rx : -Infinity;
    const bRx = b.rx != null ? b.rx : -Infinity;
    return (bRx - aRx) || _tickerCmp(a, b);
  });
```

- [ ] **Step 3: Add `KI_INFRA` to `tabColumns()` (around line 1441)**

After the `if (tab === 'WATCH') return [...]` block and before the final `return [];`:

```javascript
    if (tab === 'KI_INFRA') return [
      {k:'#',w:30}, {k:'Ticker',w:65}, {k:'Company',w:220}, {k:'Category',w:120},
      {k:'RX',w:60,num:true}, {k:'R40',w:60,num:true},
      {k:'RevGr%',w:70,num:true}, {k:'FCFM%',w:70,num:true},
      {k:'FCF+',w:50}, {k:'State',w:80}, {k:'Trend',w:75}
    ];
```

- [ ] **Step 4: Add `KI_INFRA` to `BULLET_COLS` (around line 1447)**

Add to `BULLET_COLS`:
```javascript
    'KI_INFRA': ['rx', 'r40', 'growth', 'fcfMargin'],
```

And add to `_rowMetricForBullet()` for the `rx` key:
```javascript
    if (key === 'rx') return r.rx;
```

- [ ] **Step 5: Wire `KI_INFRA` columns in the `renderRow()` function**

Search `generate-screener.js` for the `renderRow` function and find where tab-specific column rendering happens. There will be `if (tab === 'R40')` or similar branches. Add the KI_INFRA branch:

The exact section to find (search for `renderRow` → find the inner `switch`/`if` block on `tab` and `cols[i].k`). Add handling for `'RX'`, `'Category'`, `'FCF+'` column keys:

In the column rendering loop (where `cols[i].k` is used to pick cell content), add these cases alongside existing `'R40'` / `'RevGr%'` / `'FCFM%'` handlers:

```javascript
// KI_INFRA-specific column keys
if (k === 'RX')        return bulletCell(r.rx != null ? r.rx.toFixed(1) : '—', pm['rx'] && pm['rx'][r.ticker]);
if (k === 'Category')  return '<td>' + escHtml(r.kiCategory || '—') + '</td>';
if (k === 'FCF+') {
  // Mark FCF-negative stocks visually rather than hiding them
  const pos = r.fcfPositive;
  if (pos === null) return '<td>—</td>';
  return pos ? '<td class="g-pos">✓</td>' : '<td class="g-neg" title="FCF-negativ — typisch für wachsende KI-Infra-Namen">✗</td>';
}
```

Note: `r.fcfPositive` already exists in `buildRow()` at line 361 — it's the latest annual FCF > 0 flag.

- [ ] **Step 6: Add the KI Infrastruktur tab button to the HTML template**

In the `<div class="tabs">` block, add the KI_INFRA button after the R40 button:

```html
  <button data-tab="KI_INFRA" role="tab" aria-selected="false">🤖 KI Infrastruktur</button>
```

Place it between the `R40` button and `PRE_BREAKOUT` button.

- [ ] **Step 7: Add `TAB_EXPLAINERS` entry for KI_INFRA**

Find the `TAB_EXPLAINERS` object (around line 1651) and add:

```javascript
    KI_INFRA: 'KI Infrastruktur — manuell geseedete Startliste (Data Centers · Connectivity · Energy · Supply Bottlenecks). Sortiert nach Rule-of-X. FCF-negative Namen sind markiert (✗) statt versteckt. Kein automatischer Filter — Universum = ki-infra.json.',
```

- [ ] **Step 8: Generate screener and verify KI_INFRA tab has entries**

```
node generate-screener.js --snapshots snapshots --out screener.html 2>&1 | grep "tab KI_INFRA"
```

Expected: `[screener] tab KI_INFRA: 3` (ALAB + CRDO + BE — or whatever subset has snapshot data)

- [ ] **Step 9: Run engine-cli-tests to confirm no regression**

```
node engine-cli-tests.js
```

Expected: All 10 fixtures pass.

- [ ] **Step 10: Commit**

```bash
git add generate-screener.js ki-infra.json
git commit -m "feat: KI Infrastruktur tab — category-sorted, RX default sort, FCF-negative marked not hidden"
```

---

## Task 8: Bank R40/RX in `scripts/snapshot-score-history.js`

**Files:**
- Modify: `scripts/snapshot-score-history.js` (lines 135-147 and 170-179)

The existing `computeEntryForStock()` function (line 135) builds `{ date, hgScore, qcScore, pbScore, hgTier, qcTier, hgClass }`. We extend it to also capture `r40`, `rx`, `growth`, `fcfMargin`, and `fcfMarginSource` using the same `allResults` that are already computed.

CRITICAL: We must use the same FCF margin that rule-of-40.js used (including the 201c TTM→3y-annual-median fallback). The `components` field of the rule-of-40 result already tracks `fcfMarginSource`.

- [ ] **Step 1: Extend `computeEntryForStock()` to include R40/RX fields**

In `scripts/snapshot-score-history.js`, modify `computeEntryForStock()` (lines 135-147):

Old code:
```javascript
function computeEntryForStock(stock, today) {
  const allResults = Runner.evaluateStock(stock);
  const evHG = SM.evaluateMode(stock, 'HYPERGROWTH', allResults);
  const evQC = SM.evaluateMode(stock, 'QUALITY_COMPOUNDER', allResults);
  const hgScore = (evHG && Number.isFinite(evHG.score)) ? Math.round(evHG.score * 100) / 100 : null;
  const qcScore = (evQC && Number.isFinite(evQC.score)) ? Math.round(evQC.score * 100) / 100 : null;
  const hgTier = evHG ? evHG.tier : null;
  const qcTier = evQC ? evQC.tier : null;
  const hgClassRes = allResults['hypergrowth-quality-class'];
  const hgClass = (hgClassRes && hgClassRes.computable && hgClassRes.components && hgClassRes.components.class) || null;
  const pbScoreRaw = _computePbScore(stock, allResults);
  const pbScore = (pbScoreRaw != null && Number.isFinite(pbScoreRaw)) ? Math.round(pbScoreRaw * 100) / 100 : null;
  return { date: today, hgScore, qcScore, pbScore, hgTier, qcTier, hgClass };
}
```

New code:
```javascript
function computeEntryForStock(stock, today) {
  const allResults = Runner.evaluateStock(stock);
  const evHG = SM.evaluateMode(stock, 'HYPERGROWTH', allResults);
  const evQC = SM.evaluateMode(stock, 'QUALITY_COMPOUNDER', allResults);
  const hgScore = (evHG && Number.isFinite(evHG.score)) ? Math.round(evHG.score * 100) / 100 : null;
  const qcScore = (evQC && Number.isFinite(evQC.score)) ? Math.round(evQC.score * 100) / 100 : null;
  const hgTier = evHG ? evHG.tier : null;
  const qcTier = evQC ? evQC.tier : null;
  const hgClassRes = allResults['hypergrowth-quality-class'];
  const hgClass = (hgClassRes && hgClassRes.computable && hgClassRes.components && hgClassRes.components.class) || null;
  const pbScoreRaw = _computePbScore(stock, allResults);
  const pbScore = (pbScoreRaw != null && Number.isFinite(pbScoreRaw)) ? Math.round(pbScoreRaw * 100) / 100 : null;

  // R40/RX banking: use the same allResults so FCF margin source (TTM vs 3y-annual-median)
  // is IDENTICAL to what rule-of-40.js uses for the live filter. fcfMarginSource tracks
  // which definition was used — history MUST match live filter definition exactly.
  const r40Res = allResults['rule-of-40'];
  const r40 = (r40Res && r40Res.computable && Number.isFinite(r40Res.value))
    ? Math.round(r40Res.value * 10) / 10 : null;
  const rxRes = allResults['rule-of-x'];
  const rx = (rxRes && rxRes.computable && Number.isFinite(rxRes.value))
    ? Math.round(rxRes.value * 10) / 10 : null;
  const growth = (r40Res && r40Res.computable && r40Res.components)
    ? (r40Res.components.growth != null ? Math.round(r40Res.components.growth * 10) / 10 : null) : null;
  const fcfMargin = (r40Res && r40Res.computable && r40Res.components)
    ? (r40Res.components.fcfMargin != null ? Math.round(r40Res.components.fcfMargin * 10) / 10 : null) : null;
  const fcfMarginSource = (r40Res && r40Res.components && r40Res.components.fcfMarginSource) || 'TTM';

  return { date: today, hgScore, qcScore, pbScore, hgTier, qcTier, hgClass, r40, rx, growth, fcfMargin, fcfMarginSource };
}
```

- [ ] **Step 2: Update the null-skip guard to not skip when only r40/rx are available**

In `main()` (line 170-175), the existing guard skips writing when `hgScore == null && qcScore == null && pbScore == null && hgTier == null && qcTier == null`. This is still correct — only skip when NOTHING is computable. Since r40/rx may be available even when hgScore is null (e.g. non-HG stocks), we can relax the guard:

Find:
```javascript
      if (entry.hgScore == null && entry.qcScore == null && entry.pbScore == null
          && entry.hgTier == null && entry.qcTier == null) {
        skipped++;
        continue;
      }
```

Replace with:
```javascript
      if (entry.hgScore == null && entry.qcScore == null && entry.pbScore == null
          && entry.hgTier == null && entry.qcTier == null
          && entry.r40 == null && entry.rx == null) {
        skipped++;
        continue;
      }
```

- [ ] **Step 3: Run the script locally on a small subset to verify the new fields appear**

```
node scripts/snapshot-score-history.js --snapshots snapshots --out score-history 2>&1 | tail -5
```

Then check a specific ticker:
```
node -e "const f=require('./score-history/CRDO.json'); console.log(JSON.stringify(f.entries.slice(-1), null, 2))"
```

Expected output includes: `"r40": 217.5, "rx": 285.0, "growth": 195.5, "fcfMargin": 22.0, "fcfMarginSource": "TTM"` (exact numbers depend on current snapshot data)

- [ ] **Step 4: Run engine-cli-tests to confirm no regression**

```
node engine-cli-tests.js
```

Expected: All 10 fixtures pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/snapshot-score-history.js
git commit -m "feat: extend score-history entries with r40/rx/growth/fcfMargin/fcfMarginSource"
```

---

## Task 9: Create `scripts/snapshot-r40rx-history.js` (Quarterly Banking)

**Files:**
- Create: `scripts/snapshot-r40rx-history.js`

The score-history sliding window keeps 30 daily entries. For the R40/RX history TABLE in the detail modal, we want a QUARTERLY view going back as far as possible. This script banks the computed R40/RX value once per calendar quarter (keyed by "YYYY-QN"), updating the current quarter's entry on every run.

- [ ] **Step 1: Write the script**

```javascript
#!/usr/bin/env node
/**
 * Quarterly R40/RX Point-in-Time History
 * ========================================
 * For each ticker: appends/updates the current quarter's
 * { quarter, date, r40, rx, growth, fcfMargin, fcfMarginSource }
 * entry in r40rx-history/<TICKER>.json.
 *
 * Keyed by calendar quarter ("2026-Q2") so re-runs within the same
 * quarter overwrite rather than append — the last value of the quarter
 * freezes at the quarter boundary naturally.
 *
 * MAX_QUARTERS: retain last 20 quarters (5 years).
 *
 * Run: node scripts/snapshot-r40rx-history.js [--snapshots ./snapshots] [--out ./r40rx-history]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Runner = require('../methods/runner.js');
const { writeFileAtomic } = require('../lib/atomic-write.js');

const SCHEMA_VERSION = 1;
const MAX_QUARTERS = 20;

function parseArgs(argv) {
  const args = { snapshots: './snapshots', out: './r40rx-history' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
  }
  return args;
}

function isoToQuarter(iso) {
  // "2026-05-24" → "2026-Q2"
  const month = parseInt(iso.slice(5, 7), 10);
  const q = Math.ceil(month / 3);
  return iso.slice(0, 4) + '-Q' + q;
}

async function loadSnapshotsAsync(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  const BATCH = 200;
  const results = [];
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const loaded = await Promise.all(batch.map(async f => {
      try {
        const raw = await fs.promises.readFile(path.join(dir, f), 'utf8');
        const stock = JSON.parse(raw);
        return (stock && stock.meta && stock.meta.ticker) ? stock : null;
      } catch (e) { return null; }
    }));
    results.push(...loaded.filter(Boolean));
  }
  return results;
}

function readHistoryFile(outDir, ticker) {
  const file = path.join(outDir, ticker + '.json');
  if (!fs.existsSync(file)) return { ticker, schemaVersion: SCHEMA_VERSION, entries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) {
      return { ticker, schemaVersion: SCHEMA_VERSION, entries: [] };
    }
    return { ticker, schemaVersion: SCHEMA_VERSION, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch (e) {
    return { ticker, schemaVersion: SCHEMA_VERSION, entries: [] };
  }
}

function appendAndPrune(history, entry) {
  // Replace any existing entry for the same quarter
  const filtered = (history.entries || []).filter(e => e.quarter !== entry.quarter);
  filtered.push(entry);
  // Sort by quarter string asc (lexicographic: "2026-Q1" < "2026-Q2")
  filtered.sort((a, b) => (a.quarter < b.quarter ? -1 : a.quarter > b.quarter ? 1 : 0));
  const trimmed = filtered.length > MAX_QUARTERS ? filtered.slice(filtered.length - MAX_QUARTERS) : filtered;
  return Object.assign({}, history, { entries: trimmed, schemaVersion: SCHEMA_VERSION });
}

function computeEntry(stock, today, quarter) {
  const allResults = Runner.evaluateStock(stock);
  const r40Res = allResults['rule-of-40'];
  const rxRes  = allResults['rule-of-x'];

  const r40 = (r40Res && r40Res.computable && Number.isFinite(r40Res.value))
    ? Math.round(r40Res.value * 10) / 10 : null;
  const rx = (rxRes && rxRes.computable && Number.isFinite(rxRes.value))
    ? Math.round(rxRes.value * 10) / 10 : null;

  if (r40 == null && rx == null) return null;  // nothing to bank

  const growth = (r40Res && r40Res.components && r40Res.components.growth != null)
    ? Math.round(r40Res.components.growth * 10) / 10 : null;
  const fcfMargin = (r40Res && r40Res.components && r40Res.components.fcfMargin != null)
    ? Math.round(r40Res.components.fcfMargin * 10) / 10 : null;
  const fcfMarginSource = (r40Res && r40Res.components && r40Res.components.fcfMarginSource) || 'TTM';

  return { quarter, date: today, r40, rx, growth, fcfMargin, fcfMarginSource };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.out)) fs.mkdirSync(args.out, { recursive: true });

  const today = process.env.RUN_DATE_UTC || new Date().toISOString().slice(0, 10);
  const quarter = isoToQuarter(today);
  console.log('[r40rx-history] date=' + today + ' quarter=' + quarter);

  const stocks = await loadSnapshotsAsync(args.snapshots);
  console.log('[r40rx-history] stocks loaded: ' + stocks.length);

  let written = 0, skipped = 0, failed = 0;
  for (const stock of stocks) {
    const ticker = stock.meta && stock.meta.ticker;
    if (!ticker) { skipped++; continue; }
    try {
      const entry = computeEntry(stock, today, quarter);
      if (!entry) { skipped++; continue; }
      const history = readHistoryFile(args.out, ticker);
      const next = appendAndPrune(history, entry);
      writeFileAtomic(path.join(args.out, ticker + '.json'), JSON.stringify(next));
      written++;
    } catch (e) {
      failed++;
      if (failed <= 10) console.error('[r40rx-history] ERROR ' + ticker + ': ' + e.message);
    }
  }

  // Pipeline health
  const healthDir = './pipeline-health';
  if (!fs.existsSync(healthDir)) fs.mkdirSync(healthDir, { recursive: true });
  writeFileAtomic(
    path.join(healthDir, 'snapshot-r40rx-history.json'),
    JSON.stringify({ script: 'snapshot-r40rx-history', date: today, quarter, written, skipped, failed })
  );
  console.log('[r40rx-history] written=' + written + ' skipped=' + skipped + ' failed=' + failed);
  if (stocks.length > 0 && failed / stocks.length > 0.05) {
    console.error('::error::snapshot-r40rx-history failure rate > 5%');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(e => { console.error('snapshot-r40rx-history failed: ' + e.message); process.exit(1); });
}

module.exports = { computeEntry, appendAndPrune, isoToQuarter, SCHEMA_VERSION, MAX_QUARTERS };
```

- [ ] **Step 2: Run the script locally**

```
node scripts/snapshot-r40rx-history.js --snapshots snapshots --out r40rx-history 2>&1 | tail -5
```

Expected: `[r40rx-history] written=<N> skipped=<M> failed=0`

- [ ] **Step 3: Verify a specific ticker's output**

```
node -e "const f=require('./r40rx-history/CRDO.json'); console.log(JSON.stringify(f.entries, null, 2))"
```

Expected: One entry for the current quarter with r40/rx/growth/fcfMargin fields.

- [ ] **Step 4: Commit**

```bash
git add scripts/snapshot-r40rx-history.js r40rx-history/
git commit -m "feat: snapshot-r40rx-history.js — quarterly R40/RX point-in-time banking"
```

---

## Task 10: Add `snapshot-r40rx-history` Step to CI Workflow

**Files:**
- Modify: `.github/workflows/daily-pull.yml`

- [ ] **Step 1: Add the new step after the "Snapshot Score-History" step (around line 389)**

Find:
```yaml
      - name: Snapshot Score-History
        env:
          AUDIT_SCORE_MULTIPLIERS: '1'
        run: node scripts/snapshot-score-history.js --snapshots snapshots --out score-history
        continue-on-error: true
```

After that block, add:
```yaml
      - name: Snapshot R40/RX History (quarterly)
        env:
          AUDIT_SCORE_MULTIPLIERS: '1'
        run: node scripts/snapshot-r40rx-history.js --snapshots snapshots --out r40rx-history
        continue-on-error: true
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/daily-pull.yml
git commit -m "ci: add snapshot-r40rx-history step after score-history (AUDIT_SCORE_MULTIPLIERS=1)"
```

---

## Task 11: Backfill Historical R40/RX from Yahoo Quarterly Arrays

**Files:**
- Create: `scripts/backfill-r40rx-history.js`

**Important limitation:** Yahoo's `timeseries.revenueQ` gives up to 8 quarters of revenue, enabling YoY growth for quarters [0..3] (index 0=most recent, index 4 needed for YoY comparison). For FCF margin at historical quarters, we do NOT have per-quarter FCF data (only TTM/annual). The backfill uses the ANNUAL FCF data to approximate historical FCF margins — this is a best-effort approximation. A note is embedded in each backfilled entry (`fcfMarginSource: 'annual-approx'`) so the history table can warn the user.

The exact match constraint ("FCF-Margin-Definition muss EXAKT der des Live-Filters entsprechen") applies to LIVE entries (from Task 9) — backfill entries are explicitly labeled as approximations.

- [ ] **Step 1: Write the backfill script**

```javascript
#!/usr/bin/env node
/**
 * One-time backfill: compute historical R40/RX from existing snapshots.
 *
 * Uses timeseries.revenueQ for historical revenue (up to 8Q) and annual
 * FCF data as a margin proxy. Writes backfill entries to r40rx-history/
 * ONLY for quarters not already present (safe to re-run).
 *
 * FCF margin for backfilled entries uses annual FCF/revenue as an approximation
 * (tagged fcfMarginSource:'annual-approx') because per-quarter FCF is not
 * in the snapshot. Live forward-banked entries (from snapshot-r40rx-history.js)
 * use the exact same definition as the live filter (fcfMarginSource:'TTM').
 *
 * Run: node scripts/backfill-r40rx-history.js [--snapshots ./snapshots] [--out ./r40rx-history]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../lib/atomic-write.js');
const { appendAndPrune, isoToQuarter, SCHEMA_VERSION, MAX_QUARTERS } = require('./snapshot-r40rx-history.js');

function parseArgs(argv) {
  const args = { snapshots: './snapshots', out: './r40rx-history' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
  }
  return args;
}

function unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

// Approximate the calendar quarter-end date for array index i in revenueQ.
// revenueQ[0] = most recent reported quarter (approximately today's fetchedAt).
// revenueQ[i] is approximately i quarters earlier.
function arrayIndexToApproxQuarter(fetchedAt, i) {
  const d = new Date((fetchedAt || new Date().toISOString()) + 'T00:00:00Z');
  // Step back i * 3 months
  d.setUTCMonth(d.getUTCMonth() - i * 3);
  const iso = d.toISOString().slice(0, 10);
  return isoToQuarter(iso);
}

// Compute historical R40/RX for up to 4 back-quarters from snapshot data.
// Returns array of { quarter, r40, rx, growth, fcfMargin, fcfMarginSource, date }
function computeHistoricalEntries(stock) {
  const fetchedAt = stock.meta && stock.meta.fetchedAt;
  const ts = stock.timeseries || {};
  const annual = stock.annual || {};

  const revQ = Array.isArray(ts.revenueQ) ? ts.revenueQ.map(unwrap) : [];
  // Annual FCF margin approximation: most recent 3 annual entries
  const annualFCF = Array.isArray(annual.annualFCF) ? annual.annualFCF.map(unwrap) : [];
  const annualRev = Array.isArray(annual.annualRev) ? annual.annualRev.map(unwrap) : [];

  // Precompute annual FCF margins (newest first)
  const annualFcfMargins = [];
  for (let y = 0; y < Math.min(annualFCF.length, annualRev.length, 4); y++) {
    const f = annualFCF[y], r = annualRev[y];
    annualFcfMargins.push((f != null && r != null && r > 0) ? (f / r) * 100 : null);
  }

  const entries = [];
  // Can compute YoY growth for indices 0..3 (needs index+4 for prior year)
  for (let i = 0; i < 4 && i + 4 < revQ.length; i++) {
    const qRev = revQ[i];
    const priorRev = revQ[i + 4];
    if (qRev == null || priorRev == null || priorRev === 0) continue;
    const growth = (qRev - priorRev) / Math.abs(priorRev) * 100;

    // Unit guard: revenue values must be > 1 (not decimals)
    if (Math.abs(growth) <= 1) continue;

    // FCF margin: use most recent annual FCF margin as approximation
    // (annualFcfMargins[0] covers most recently completed fiscal year)
    const fcfMargin = annualFcfMargins[Math.min(i, annualFcfMargins.length - 1)] || null;
    if (fcfMargin == null) continue;

    const r40 = Math.round((growth + fcfMargin) * 10) / 10;
    const rx  = Math.round((1.5 * growth + fcfMargin) * 10) / 10;
    const quarter = arrayIndexToApproxQuarter(fetchedAt, i);
    // Approximate date: last day of the quarter
    entries.push({
      quarter,
      date: fetchedAt ? fetchedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
      r40, rx,
      growth: Math.round(growth * 10) / 10,
      fcfMargin: Math.round(fcfMargin * 10) / 10,
      fcfMarginSource: 'annual-approx'  // NOT the same as live filter — labelled for UI warning
    });
  }
  return entries;
}

function readHistoryFile(outDir, ticker) {
  const file = path.join(outDir, ticker + '.json');
  if (!fs.existsSync(file)) return { ticker, schemaVersion: SCHEMA_VERSION, entries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) return { ticker, schemaVersion: SCHEMA_VERSION, entries: [] };
    return { ticker, schemaVersion: SCHEMA_VERSION, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch (e) { return { ticker, schemaVersion: SCHEMA_VERSION, entries: [] }; }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.out)) fs.mkdirSync(args.out, { recursive: true });

  if (!fs.existsSync(args.snapshots)) { console.error('snapshots dir not found: ' + args.snapshots); process.exit(1); }
  const files = fs.readdirSync(args.snapshots).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  console.log('[backfill] processing ' + files.length + ' snapshots');

  let filled = 0, skipped = 0, failed = 0;
  for (const f of files) {
    let stock;
    try { stock = JSON.parse(fs.readFileSync(path.join(args.snapshots, f), 'utf8')); } catch (e) { failed++; continue; }
    const ticker = stock && stock.meta && stock.meta.ticker;
    if (!ticker) { skipped++; continue; }

    const historical = computeHistoricalEntries(stock);
    if (historical.length === 0) { skipped++; continue; }

    const history = readHistoryFile(args.out, ticker);
    const existingQuarters = new Set((history.entries || []).map(e => e.quarter));

    let changed = false;
    let current = history;
    for (const entry of historical) {
      // Only backfill quarters NOT already present (don't overwrite live-banked entries)
      if (existingQuarters.has(entry.quarter)) continue;
      current = appendAndPrune(current, entry);
      changed = true;
    }

    if (changed) {
      writeFileAtomic(path.join(args.out, ticker + '.json'), JSON.stringify(current));
      filled++;
    } else {
      skipped++;
    }
  }

  console.log('[backfill] filled=' + filled + ' skipped=' + skipped + ' failed=' + failed);
}

if (require.main === module) {
  main().catch(e => { console.error('backfill-r40rx-history failed: ' + e.message); process.exit(1); });
}
```

- [ ] **Step 2: Run the backfill**

```
node scripts/backfill-r40rx-history.js --snapshots snapshots --out r40rx-history 2>&1 | tail -5
```

Expected: `[backfill] filled=<N> skipped=<M> failed=0`

- [ ] **Step 3: Verify a ticker that has historical data**

```
node -e "const f=require('./r40rx-history/CRDO.json'); console.log(JSON.stringify(f.entries, null, 2))"
```

Expected: Multiple entries for different quarters, including at least one with `fcfMarginSource: 'annual-approx'` (backfill) and one with `fcfMarginSource: 'TTM'` (live-banked from Task 9).

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-r40rx-history.js r40rx-history/
git commit -m "feat: backfill-r40rx-history.js — one-time historical R40/RX from Yahoo quarterly arrays (annual-approx labeled)"
```

---

## Task 12: Show R40/RX History Table in Detail Modal

**Files:**
- Modify: `generate-screener.js` (the detail modal HTML section)

The detail modal currently has 6 sections. We add a 7th: "R40/RX History" — a compact table showing one row per quarter in the `r40rx-history/` file. Also wire the score-history entries' new `r40`/`rx` fields into the trend sparkline for the R40 tab (replacing the current hgScore proxy).

- [ ] **Step 1: Load r40rx-history in generate-screener.js**

Near the top of `generate-screener.js` where `readScoreHistory` is defined (around line 140), add a parallel `readR40rxHistory` function:

```javascript
const R40RX_HISTORY_DIR = './r40rx-history';
const _r40rxHistoryCache = new Map();
function readR40rxHistory(ticker) {
  if (_r40rxHistoryCache.has(ticker)) return _r40rxHistoryCache.get(ticker);
  let result = null;
  try {
    const file = path.join(R40RX_HISTORY_DIR, ticker + '.json');
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && Array.isArray(parsed.entries)) result = parsed;
    }
  } catch (e) { /* swallow */ }
  _r40rxHistoryCache.set(ticker, result);
  return result;
}
```

- [ ] **Step 2: Add `r40rxHistory` field to `buildRow()` return object**

In `buildRow()`, after the `scoreHistory` computation (around line 390):

```javascript
  const r40rxHistRaw = readR40rxHistory(ticker);
  // For the modal table: pass the last 12 entries (3 years of quarterly data).
  const r40rxHistory = (r40rxHistRaw && Array.isArray(r40rxHistRaw.entries))
    ? r40rxHistRaw.entries.slice(-12)
    : [];
```

Add to the return object:
```javascript
    r40rxHistory,
```

- [ ] **Step 3: Update the trendCell function to use actual r40 values from score-history**

Find the `trendCell` function (around line 1514) comment that says:
`// r40 isn't stored in score-history so the R40 tab falls back to hgScore as a correlated proxy`

After Task 8, r40 IS now stored in score-history. Update the trendCell to use it when `tab === 'R40'` or `tab === 'KI_INFRA'`:

Find the section that selects which score field to use for the sparkline and update the R40/KI_INFRA case. The exact change depends on trendCell's implementation — locate it and change the fallback from hgScore to `entry.r40` for R40/KI_INFRA tabs.

- [ ] **Step 4: Add the R40/RX history table to the modal HTML template**

In the modal HTML template (search for `Section D` or the score history section), add a new table section after the existing sections:

```javascript
// Inside the modal detail renderer, add this section for r40rxHistory:
function renderR40rxHistorySection(r) {
  const entries = (r.r40rxHistory || []).slice().reverse();  // newest first
  if (entries.length === 0) return '';
  let rows = entries.map(e => {
    const approx = e.fcfMarginSource && e.fcfMarginSource !== 'TTM';
    const approxNote = approx ? ' <span title="FCF-Margin: Jahres-Approximation, nicht TTM — Backfill-Daten" style="color:var(--text-2)">~</span>' : '';
    const r40Fmt = e.r40 != null ? e.r40.toFixed(1) : '—';
    const rxFmt  = e.rx  != null ? e.rx.toFixed(1)  : '—';
    const grFmt  = e.growth != null ? e.growth.toFixed(1) + '%' : '—';
    const fcfFmt = e.fcfMargin != null ? e.fcfMargin.toFixed(1) + '%' : '—';
    const r40Color = e.r40 != null ? (e.r40 >= 40 ? 'var(--green)' : 'var(--red)') : '';
    const rxColor  = e.rx  != null ? (e.rx  >= 50 ? 'var(--green)' : 'var(--red)') : '';
    return `<tr>
      <td>${escHtml(e.quarter)}</td>
      <td style="color:${r40Color}">${r40Fmt}${approxNote}</td>
      <td style="color:${rxColor}">${rxFmt}${approxNote}</td>
      <td>${grFmt}</td>
      <td>${fcfFmt}</td>
    </tr>`;
  }).join('');
  return `
    <div class="modal-section">
      <div class="modal-section-title">R40 / RX Historie <span style="color:var(--text-2);font-size:0.75em">(~ = Backfill-Approximation)</span></div>
      <table class="hist-table">
        <thead><tr><th>Quartal</th><th>R40</th><th>RX (1.5×)</th><th>RevGr%</th><th>FCF-M%</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
```

Call this function inside the modal rendering code to inject the section.

- [ ] **Step 5: Generate screener and manually verify the KI Infra tab and history table look correct**

```
node generate-screener.js --snapshots snapshots --out screener.html
```

Open `screener.html` in a browser. Check:
1. KI Infrastruktur tab is visible
2. ALAB, CRDO appear under Connectivity; BE under Energy
3. FCF-negative stocks show ✗ in the FCF+ column
4. Click any KI ticker → detail modal shows R40/RX history section
5. R40 tab is the default (HG/QC tabs are hidden)

- [ ] **Step 6: Run all tests**

```
node engine-cli-tests.js && node tag-r40rx-config-tests.js && node tag21-tests.js && node tag22-tests.js && node tag28-tests.js
```

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add generate-screener.js scripts/snapshot-r40rx-history.js r40rx-history/
git commit -m "feat: R40/RX history table in detail modal, r40-aware trend sparklines for R40/KI_INFRA tabs"
```

---

## Self-Review: Spec Coverage Check

| Spec item | Covered by task(s) | Gap? |
|---|---|---|
| R40 as first-class filter with adjustable threshold | Task 1 (config) + Task 2 (wire) | None |
| RX as first-class filter with adjustable threshold+multiplier | Task 1 (config) + Task 3 (wire) | None |
| DATAGUARDs kept as Sanity-Layer (q-spike, revenue-shock, r40-sanity-cap) | Not modified — already active | None |
| Central config without code edit | Task 1: filter-config.json | None |
| HYPERGROWTH/QUALITY_COMPOUNDER hidden, not deleted, reversible | Task 5 | None |
| KI Infra tab with categories: Data Centers, Connectivity, Energy, Supply Bottlenecks | Task 6 (seed) + Task 7 (tab) | None |
| KI Infra seed: ALAB + CRDO under Connectivity, BE under Energy | Task 6 | None |
| KI tab: RX as default sort | Task 7 (sort in classifyTabs) | None |
| KI tab: R40 as extra column | Task 7 (tabColumns) | None |
| KI tab: FCF-negative marked not hidden | Task 7 (FCF+ column) | None |
| KI tab: Trend column | Task 7 + Task 12 | None |
| R40/RX history table per ticker (quarterly) | Task 9 (banking) + Task 11 (backfill) + Task 12 (modal UI) | None |
| History: forward-banking every pull | Task 9 + Task 10 (CI step) | None |
| History: backfill from Yahoo quarterly arrays | Task 11 | Approximation noted |
| FCF-margin definition consistent between live and history | Task 8+9 (fcfMarginSource field), Task 11 (annual-approx label) | Backfill is approximate — documented |
| Fixture-hash invariant assessment | This document + Task 2 Step 2 | None |
| Phase 2 data structure for future machine update | ki-infra.json _meta.schema field | None |

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-24-phase1-screener-rebuild.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
