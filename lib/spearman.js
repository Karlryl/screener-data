'use strict';
/**
 * fitness/lib/spearman.js
 * Pure Spearman rank correlation with average-rank tie handling.
 * No I/O, no Date.now(), no Math.random().
 */

/**
 * averageRank(values) → 1-based ranks with average-rank tie handling.
 * Tied values share the mean of their ordinal positions.
 * @param {number[]} values
 * @returns {number[]}
 */
function averageRank(values) {
  const n = values.length;
  // Create indexed array and sort by value ascending
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v || a.i - b.i);

  const ranks = new Array(n);
  let pos = 0;
  while (pos < n) {
    // Find the extent of ties at this value
    let end = pos;
    while (end < n - 1 && indexed[end + 1].v === indexed[pos].v) end++;
    // Average rank: positions are 1-based, so ordinal range is [pos+1 .. end+1]
    const avgRank = (pos + 1 + end + 1) / 2;
    for (let k = pos; k <= end; k++) {
      ranks[indexed[k].i] = avgRank;
    }
    pos = end + 1;
  }
  return ranks;
}

/**
 * spearman(a, b) → Pearson correlation computed on the average-ranks of a and b.
 * Returns null if lengths differ, n < 3, or either series has zero variance.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number|null}
 */
function spearman(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const n = a.length;
  if (n !== b.length) return null;
  if (n < 3) return null;
  // Bug 10: fail loud on non-finite inputs — a NaN/null value would otherwise
  // get an arbitrary rank and produce a plausible-looking but bogus correlation.
  if (!a.every(Number.isFinite) || !b.every(Number.isFinite)) return null;

  const ra = averageRank(a);
  const rb = averageRank(b);

  // Pearson correlation of the rank vectors
  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += ra[i]; sumB += rb[i]; }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let num = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i] - meanA;
    const db = rb[i] - meanB;
    num += da * db;
    varA += da * da;
    varB += db * db;
  }

  if (varA === 0 || varB === 0) return null; // zero variance
  return num / Math.sqrt(varA * varB);
}

module.exports = { averageRank, spearman };
