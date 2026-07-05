'use strict';
const { r7, r8, formulas7 } = require('./r8_audit.js');

const m7 = {}, m8 = {};
for (const e of r7) m7[e.ticker] = e;
for (const e of r8) m8[e.ticker] = e;

// --- (d) no-axes / action-Flip: welche Namen aendern action zwischen 8 und 7 Achsen? ---
console.log('=== ACTION-Flips (8-Achsen -> 7-Achsen) ===');
let flips = 0;
for (const t of Object.keys(m7)) {
  const a8 = m8[t] ? m8[t].action : 'MISSING';
  const a7 = m7[t].action;
  if (a8 !== a7) {
    flips++;
    console.log(t.padEnd(10), a8, '->', a7,
      '| 8:', m8[t]?(m8[t].reason||m8[t].formulaId||''):'', '7:', m7[t].reason||m7[t].formulaId||'');
  }
}
console.log('total action-flips:', flips);

// --- no-axes members in each ---
const noax7 = r7.filter(e=>e.action==='exclude'&&e.reason==='no-axes').map(e=>e.ticker).sort();
const noax8 = r8.filter(e=>e.action==='exclude'&&e.reason==='no-axes').map(e=>e.ticker).sort();
console.log('\nno-axes 8-Achsen:', noax8.length, noax8.join(','));
console.log('no-axes 7-Achsen:', noax7.length, noax7.join(','));
console.log('NEU raus (nur in 7):', noax7.filter(t=>!noax8.includes(t)).join(','));
console.log('war raus (nur in 8):', noax8.filter(t=>!noax7.includes(t)).join(','));

// --- Groesste Score-Verschiebungen (route in beiden) ---
console.log('\n=== Groesste |score7-score8| (route in beiden) ===');
const shifts = [];
for (const t of Object.keys(m7)) {
  if (m7[t].action!=='route' || !m8[t] || m8[t].action!=='route') continue;
  if (!Number.isFinite(m7[t].score) || !Number.isFinite(m8[t].score)) continue;
  shifts.push({ t, s7:m7[t].score, s8:m8[t].score, d:m7[t].score-m8[t].score, fid:m7[t].formulaId, track:m7[t].track });
}
shifts.sort((a,b)=>Math.abs(b.d)-Math.abs(a.d));
for (const x of shifts.slice(0,25)) {
  console.log(x.t.padEnd(10), x.fid.padEnd(22), x.track.padEnd(11),
    's8='+x.s8.toFixed(2), 's7='+x.s7.toFixed(2), 'd='+(x.d>=0?'+':'')+x.d.toFixed(2));
}

// --- Per-Sektor: mittlere |Verschiebung| + max ---
console.log('\n=== Per-Sektor mittlere/max |score-shift| ===');
const bySec = {};
for (const x of shifts) (bySec[x.fid] ||= []).push(Math.abs(x.d));
for (const id of Object.keys(formulas7)) {
  const arr = bySec[id]||[];
  if (!arr.length) { console.log(id.padEnd(24),'no overlap'); continue; }
  const mean = arr.reduce((a,b)=>a+b,0)/arr.length;
  const max = Math.max(...arr);
  console.log(id.padEnd(24), 'n='+String(arr.length).padStart(4), 'mean|d|='+mean.toFixed(2), 'max|d|='+max.toFixed(2));
}
