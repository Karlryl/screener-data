'use strict';

const fs = require('node:fs');
const path = require('node:path');
const [action, root, target] = process.argv.slice(2);
const input = JSON.parse(process.env.T204_INPUT);

if (action === 'inspect') {
  const ledger = require(path.join(root, 'lib/druckenmiller/ledger.js'));
  const state = { meta: ledger.readMeta(target), rows: ledger.readRows(target),
    verified: ledger.verifyChain(target) };
  if (input && input.retry) {
    try { ledger.appendRow(target, { date: '2099-01-03' }); }
    catch (error) { state.retryError = error.message; }
  }
  console.log(JSON.stringify(state));
} else if (action === 'meta') {
  require(path.join(root, 'lib/druckenmiller/ledger.js')).appendRow(input.ledger, input.row);
} else {
  const logger = require(path.join(root, 'scripts/druckenmiller-log-internals.js'));
  if (action === 'raw') {
    logger.schreibeRoh(path.dirname(path.dirname(target)), input.date, input.rows);
  } else if (action === 'failed') {
    const NativeDate = Date;
    global.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : ['2099-01-02T03:04:05.000Z'])); }
    };
    // Preserve the production catch-and-log contract (no artificial throw).
    logger.schreibeFehlermarker(path.dirname(target), input.reason, console.log, input.failedAt);
  } else if (action === 'direct') {
    fs.writeFileSync(target, 'bypass');
  } else {
    throw new Error('Unknown fixture action: ' + action);
  }
}
