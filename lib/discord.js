'use strict';
/**
 * Tag 219a (audit F-218b systemic): shared Discord webhook poster.
 *
 * Three scripts each carried their own private `postDiscord` implementation
 * (`pipeline-health-check.js`, `check-pull-stats.js`, `picks-regression-check.js`).
 * Tag 181 / F-SC-007 already hardened the pipeline-health-check copy: the
 * previous fire-and-forget `https.request(...)` pattern let `process.exit`
 * run before the request completed, silently dropping the alert this step
 * exists to surface. The other two scripts still had the buggy pattern.
 *
 * This helper consolidates the Tag 181 fix: `await fetch` with an
 * AbortController + hard timeout so a hung Discord webhook can't block CI.
 *
 * Usage:
 *   const { postDiscord } = require('../lib/discord.js');
 *   await postDiscord(message); // resolves true on 2xx, false otherwise
 *
 * Reads DISCORD_WEBHOOK from env. Safe no-op (returns false) when unset.
 */

// Tag 230c-2 (audit F-230c-05 HIGH / F-230c-06 HIGH / F-230c-07 MEDIUM):
// three production-grade gaps in the prior implementation:
//
//   1. No payload truncation. Discord enforces a 2000-character limit on
//      the `content` field; anything longer is rejected with 400 and the
//      alert silently never appears. picks-regression-check assembles
//      messages that interpolate full ticker lists -> easily breaches 2000
//      on a noisy day, killing the regression alert exactly when we need
//      it most. We now truncate with a "...(truncated)" suffix.
//
//   2. No 429 retry. Discord rate-limits webhooks (~5 req/sec/route) and
//      returns 429 with a `retry-after` header (seconds) or a JSON body
//      `{retry_after: <ms>}`. The previous code treated 429 as a failure
//      and dropped the alert. We now honor retry-after for a single
//      sleep+retry. The pipeline-health flow can burst 3 alerts in
//      quick succession; first two often 429.
//
//   3. No retry on transient network/5xx errors. A single TLS handshake
//      blip or a Discord 503 instantly dropped the alert. We now retry
//      once on network error and once on 5xx (idempotent POST is safe
//      here because Discord deduplicates within the rate-limit window,
//      and even a true duplicate alert is far better than a missed one).

const DISCORD_CONTENT_LIMIT = 2000;
const TRUNC_SUFFIX = '...(truncated)';

function _truncate(s) {
  if (s.length <= DISCORD_CONTENT_LIMIT) return s;
  return s.slice(0, DISCORD_CONTENT_LIMIT - TRUNC_SUFFIX.length) + TRUNC_SUFFIX;
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function _postOnce(webhook, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: ctrl.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function postDiscord(content, opts) {
  const webhook = (opts && opts.webhook) || process.env.DISCORD_WEBHOOK;
  if (!webhook) return false;
  const timeoutMs = (opts && opts.timeoutMs) || 5000;
  const maxRetries = (opts && opts.maxRetries != null) ? opts.maxRetries : 2;

  const truncated = _truncate(String(content));
  const body = JSON.stringify({ content: truncated });

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res;
    try {
      res = await _postOnce(webhook, body, timeoutMs);
    } catch (e) {
      // Network/abort error. Retry once on first attempt; surface and bail
      // after that so we don't hold up CI on a hard outage.
      if (attempt < maxRetries) {
        await _sleep(500);
        continue;
      }
      console.log('Discord post failed: ' + (e && e.message ? e.message : e));
      return false;
    }

    if (res.status >= 200 && res.status < 300) return true;

    // 429: honor retry-after (header in seconds, body in milliseconds).
    if (res.status === 429 && attempt < maxRetries) {
      let waitMs = 1000;
      const ra = res.headers.get && res.headers.get('retry-after');
      if (ra && !Number.isNaN(Number(ra))) waitMs = Math.max(waitMs, Number(ra) * 1000);
      try {
        const j = await res.json();
        if (j && Number.isFinite(j.retry_after)) waitMs = Math.max(waitMs, Math.ceil(j.retry_after * 1000));
      } catch (_) { /* body not JSON; header is enough */ }
      // Cap at 10s — beyond that the caller's timeout/CI step time matters more
      // than completing the post.
      await _sleep(Math.min(waitMs, 10000));
      continue;
    }

    // 5xx: transient, retry once.
    if (res.status >= 500 && res.status < 600 && attempt < maxRetries) {
      await _sleep(500);
      continue;
    }

    // 4xx (other than 429): permanent failure (bad webhook URL, body too
    // large despite our truncation, etc.). Log and bail — no retry.
    console.log('Discord post failed: HTTP ' + res.status);
    return false;
  }
  return false;
}

module.exports = { postDiscord };
