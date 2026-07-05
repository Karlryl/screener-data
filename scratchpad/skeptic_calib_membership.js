const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const { route } = require(ROOT + '/src/scoring/router.js');
const { scoreUniverse } = require(ROOT + '/src/scoring/score.js');
const formulas = require(ROOT + '/src/scoring/formulas/index.js');

const dir = ROOT + '/snapshots';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
const universe = [];
for (const f of files) {
  try { universe.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); }
  catch (e) {}
}
console.log('universe loaded:', universe.length);

const calibRoute = new Set();
for (const s of universe) {
  const r = route(s);
  if (r.action !== 'route') continue;
  if (!formulas[r.formulaId]) continue;
  calibRoute.add((s.meta && s.meta.ticker) || '?');
}
console.log('calib-route members (route+formula):', calibRoute.size);

const results = scoreUniverse(universe, formulas);
const liveRoute = new Set();
const excludedReasons = {};
for (const e of results) {
  if (e.action === 'route') liveRoute.add(e.ticker);
  if (e.action === 'exclude') excludedReasons[e.reason] = (excludedReasons[e.reason]||0)+1;
}
console.log('live-route members:', liveRoute.size);
console.log('exclude reasons:', JSON.stringify(excludedReasons));

const phantom = [...calibRoute].filter(t => !liveRoute.has(t));
console.log('PHANTOM (calib has, live drops):', phantom.length, '=', (100*phantom.length/calibRoute.size).toFixed(2)+'%');

const resByTicker = {};
for (const e of results) resByTicker[e.ticker] = e;
const byReason = {};
for (const t of phantom) {
  const e = resByTicker[t];
  const reason = e ? (e.action === 'route' ? 'STILL-ROUTE?!' : (e.reason || e.action)) : 'NOT-IN-RESULTS';
  byReason[reason] = (byReason[reason]||0)+1;
}
console.log('phantom by live-drop-reason:', JSON.stringify(byReason));

// data-suspect only count + dup-issuer only count (distinct)
const dsPhantom = phantom.filter(t => resByTicker[t] && resByTicker[t].reason === 'data-suspect');
const dupPhantom = phantom.filter(t => resByTicker[t] && resByTicker[t].reason === 'dup-issuer');
console.log('data-suspect phantom:', dsPhantom.length, dsPhantom.slice(0,8));
console.log('dup-issuer phantom:', dupPhantom.length, dupPhantom.slice(0,8));
