'use strict';
/**
 * Tag 137: Insider-Buy-Cluster
 * =============================
 * Detects clusters of open-market insider purchases in the last 90 days.
 * Data source: stock.insiderActivity (populated by pull-yahoo.js from
 * the insiderTransactions Yahoo Finance module).
 *
 * Pass: >= 2 distinct insider buy transactions in last 90 days.
 * Value: clusterBuys90d count.
 */
const H = require('./_helpers.js');

const ID = 'insider-buy-cluster';
const THRESHOLD = 2;
const THRESHOLD_OP = 'gte';

function evaluate(stock) {
  const act = stock && stock.insiderActivity;
  if (!act) {
    return H.buildResult({ computable: false, reason: 'no insiderActivity data (insiderTransactions not pulled)', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP });
  }

  const buys = act.clusterBuys90d;
  if (buys == null) {
    return H.buildResult({ computable: false, reason: 'insiderActivity.clusterBuys90d missing', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP });
  }

  const pass = buys >= THRESHOLD;
  return H.buildResult({
    value: buys,
    pass,
    computable: true,
    threshold: THRESHOLD,
    thresholdOp: THRESHOLD_OP,
    reason: `${buys} insider buy(s) in last 90d (need >= ${THRESHOLD}); net shares: ${act.netShares90d != null ? act.netShares90d.toLocaleString() : 'n/a'}; last buy: ${act.lastBuyDate || 'none'}`,
    components: {
      clusterBuys90d: act.clusterBuys90d,
      buyCount90d: act.buyCount90d,
      sellCount90d: act.sellCount90d,
      netShares90d: act.netShares90d,
      lastBuyDate: act.lastBuyDate
    }
  });
}

module.exports = {
  id: ID,
  label: 'Insider-Buy-Cluster',
  description: 'Insider cluster buying: >= 2 open-market purchases in last 90 days (Form 4 signal)',
  threshold: THRESHOLD,
  thresholdOp: THRESHOLD_OP,
  unit: 'count',
  evaluate
};
