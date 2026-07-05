const fs = require('fs');
const path = require('path');
const { norm, firstTwoPresent } = require('./src/scoring/snapshot.js');
const dir = path.join(__dirname,'snapshots');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
const named = ['JOBY','UEC','KMTS','NUVB','TE','ONDS'];
const namedSet = new Set(named);
let vals = [];
let extreme = [];
let namedHits = {};
for (const f of files) {
  const ticker = f.replace(/\.json$/,'');
  let s;
  try { s = JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')); } catch(e){ continue; }
  const gp = norm(s,'annualGP');
  const two = firstTwoPresent(gp);
  if (!two || two[1] <= 0) continue;
  const gpYoY = two[0]/two[1] - 1;
  vals.push(gpYoY);
  if (gpYoY > 5) extreme.push([ticker, gpYoY, two[0], two[1]]);
  if (namedSet.has(ticker)) namedHits[ticker] = {gpYoY: +gpYoY.toFixed(2), two, gp5: gp.slice(0,5)};
}
vals.sort((a,b)=>a-b);
const q = (p)=>{ const i=(vals.length-1)*p; const lo=Math.floor(i),hi=Math.ceil(i); return vals[lo]+(vals[hi]-vals[lo])*(i-lo); };
console.log('N (gpYoY computed) =', vals.length);
console.log('p1 =', q(0.01).toFixed(4), 'p99 =', q(0.99).toFixed(4), 'max =', vals[vals.length-1].toFixed(4), 'min =', vals[0].toFixed(4));
console.log('count gpYoY>5 =', vals.filter(v=>v>5).length);
console.log('--- named cases ---');
for (const t of named) console.log(t, JSON.stringify(namedHits[t]||'NOT FOUND'));
console.log('--- top 10 extreme ---');
extreme.sort((a,b)=>b[1]-a[1]);
for (const e of extreme.slice(0,10)) console.log(e[0], 'gpYoY='+e[1].toFixed(2), 'two='+e[2]+'/'+e[3]);
