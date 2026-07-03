'use strict';
/**
 * Tag 228a: retroactive cleanup of `_manifest-full` (and any `_*`) phantom
 * tickers from `methods-history/*.json`.
 *
 * Why: Tag 227c found that `snapshot-methods-history.js` had been processing
 * `snapshots/_manifest-full.json` as a real ticker until Tag 220 added the
 * `!f.startsWith('_')` filter. Vintages written before that fix contain a
 * phantom `_manifest-full` row inside `stocks{}` plus inflated
 * `summary.totalStocks` and `summary.anyComputable` counters. The phantom
 * biases coverage % and pass-rate distributions in
 * `scripts/method-effectiveness.js` and `scripts/walk-forward-perf.js`.
 *
 * Surgical fix: parse each vintage, delete every `stocks._*` key, adjust the
 * `summary` counters (totalStocks -= removed count, anyComputable -= number of
 * removed rows that had `computable > 0`, allPass -= number of removed rows
 * whose `computable === Object.keys(results).length && passing === computable`).
 * Write atomically via `lib/atomic-write.js` so a SIGKILL mid-rewrite can't
 * leave a half-truncated vintage file on disk.
 *
 * Idempotent: vintages without any `_*` keys are skipped silently.
 */
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../lib/atomic-write.js');

const HISTORY_DIR = path.join(__dirname, '..', 'methods-history');

function main() {
  const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json')).sort();
  let cleaned = 0;
  let totalRowsRemoved = 0;
  // audit F-A-2026-06-22: batch-abort / partial-rewrite — a single corrupt or
  // unparseable vintage previously threw out of the loop AFTER earlier files in
  // the sorted order had already been rewritten, leaving the batch half-applied
  // with a raw stack trace. Wrap each file in try/catch so one bad vintage is
  // logged and skipped instead of aborting the whole cleanup.
  let failed = 0;
  for (const f of files) {
    const fp = path.join(HISTORY_DIR, f);
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      const j = JSON.parse(raw);
      if (!j.stocks || typeof j.stocks !== 'object') {
        console.log(`  ${f}: skip (no stocks{})`);
        continue;
      }
      const phantomKeys = Object.keys(j.stocks).filter(k => k.startsWith('_'));
      if (phantomKeys.length === 0) {
        // silent skip
        continue;
      }
      let removedAnyComputable = 0;
      let removedAllPass = 0;
      for (const k of phantomKeys) {
        const row = j.stocks[k];
        if (row && typeof row === 'object') {
          if (typeof row.computable === 'number' && row.computable > 0) {
            removedAnyComputable++;
          }
          const resultsLen = (row.results && typeof row.results === 'object')
            ? Object.keys(row.results).length
            : 0;
          if (
            typeof row.computable === 'number' && typeof row.passing === 'number' &&
            row.computable === resultsLen && row.passing === row.computable && resultsLen > 0
          ) {
            removedAllPass++;
          }
        }
        delete j.stocks[k];
      }
      // Adjust summary counters if present.
      if (j.summary && typeof j.summary === 'object') {
        if (typeof j.summary.totalStocks === 'number') {
          j.summary.totalStocks -= phantomKeys.length;
        }
        if (typeof j.summary.anyComputable === 'number') {
          j.summary.anyComputable -= removedAnyComputable;
        }
        if (typeof j.summary.allPass === 'number') {
          j.summary.allPass -= removedAllPass;
        }
      }
      // Preserve original on-disk format: snapshot-methods-history.js writes
      // with `JSON.stringify(data)` (no indent) for ~30-40% size savings.
      const payload = JSON.stringify(j);
      writeFileAtomic(fp, payload, { encoding: 'utf8' });
      cleaned++;
      totalRowsRemoved += phantomKeys.length;
      const rowsAfter = Object.keys(j.stocks).length;
      console.log(
        `  ${f}: removed ${phantomKeys.length} phantom row(s) [${phantomKeys.join(',')}], ` +
        `anyComputable -${removedAnyComputable}, allPass -${removedAllPass}, ` +
        `${rowsAfter} stocks remaining (summary.totalStocks=${j.summary && j.summary.totalStocks})`
      );
    } catch (err) {
      // audit F-A-2026-06-22: one corrupt vintage must not abort the batch
      // mid-rewrite — log the offending file and continue with the rest.
      failed++;
      console.error(`  ${f}: ERROR — skipped (${err && err.message ? err.message : err})`);
      continue;
    }
  }
  console.log(`\nTag 228a cleanup: ${cleaned} vintage(s) cleaned, ${totalRowsRemoved} phantom row(s) removed${failed ? `, ${failed} vintage(s) skipped due to errors` : ''}.`);
}

// audit F-A-2026-06-22: unguarded import / unhandled crash — `main()` ran on
// bare import with no require.main guard and no catch, so any throw escaped as a
// raw stack trace and the script could not be imported without side effects.
// Guard the entry point and exit non-zero on failure so callers/CI can detect it.
if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
