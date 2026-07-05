const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const L = require(path.join(ROOT,'src/scoring/lamps.js'));
const dir = path.join(ROOT,'snapshots');
const files = fs.readdirSync(dir).filter(f=>f.endsWith('.json'));
const nqs=[], acl=[];
let err=0;
for (const f of files) {
  let s;
  try { s = JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')); } catch(e){ err++; continue; }
  let nq=null, al=null;
  try { nq = L.newestQtrSuspect(s); } catch(e){ nq='ERR:'+e.message; }
  try { al = L.annualCurrencyLeak(s); } catch(e){ al='ERR:'+e.message; }
  if (nq===true || (typeof nq==='string')) nqs.push([f.replace('.json',''), nq]);
  if (al===true || (typeof al==='string')) acl.push([f.replace('.json',''), al]);
}
console.log('files=',files.length,'parseErr=',err);
console.log('--- newestQtrSuspect TRUE (n='+nqs.length+') ---');
console.log(nqs.map(x=>x[0]).join(', '));
console.log('--- annualCurrencyLeak TRUE (n='+acl.length+') ---');
console.log(acl.map(x=>x[0]).join(', '));
