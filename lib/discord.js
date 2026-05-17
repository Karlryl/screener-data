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

async function postDiscord(content, opts) {
  const webhook = (opts && opts.webhook) || process.env.DISCORD_WEBHOOK;
  if (!webhook) return false;
  const timeoutMs = (opts && opts.timeoutMs) || 5000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: String(content) }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    return res.status >= 200 && res.status < 300;
  } catch (e) {
    clearTimeout(timer);
    // Surface to caller stdout but never throw — callers treat alert failures
    // as best-effort and continue.
    console.log('Discord post failed: ' + (e && e.message ? e.message : e));
    return false;
  }
}

module.exports = { postDiscord };
