'use strict';
// DL13 K-exchange-quarter-store, T-06. P2 gap: scalar company metadata and noData exception.
// No DL3/DL8 defect asserted. Runs the public module with no real company store.
const assert = require('node:assert/strict');
const { assertAppendOnly } = require('../lib/exchange-quarter-store.js');
const seed = () => ({sources:{A:{fetchedAt:'2026-10-07T00:00:00Z'}},
  companies:{SYN:{label:'Synthetic company',status:null,noData:{Q1:'absent'},seasons:{}}}});
let passed=0;
function test(name,fn){fn();passed++;console.log('ok '+name);}
test('initial store and identical existing metadata are accepted',()=>{
  assert.doesNotThrow(()=>assertAppendOnly(null,seed()));
  const s=seed(); assert.doesNotThrow(()=>assertAppendOnly(s,structuredClone(s)));
});
test('scalar company metadata cannot change or disappear',()=>{
  const prev=seed();
  for(const edit of [n=>{n.companies.SYN.label='changed';},n=>{delete n.companies.SYN.label;},n=>{n.companies.SYN.status='known';}]){
    const next=structuredClone(prev);edit(next);
    assert.throws(()=>assertAppendOnly(prev,next),/company field changed/);
  }
  assert.deepEqual(prev,seed());
});
test('intentional noData bookkeeping exception accepts changed object or scalar state',()=>{
  const prev=seed();
  for(const noData of [{Q2:'absent'},null,'none']){
    const next=structuredClone(prev);next.companies.SYN.noData=noData;
    assert.doesNotThrow(()=>assertAppendOnly(prev,next));
  }
  const scalar=seed();scalar.companies.SYN.noData='none';
  const next=structuredClone(scalar);next.companies.SYN.noData='updated';
  assert.doesNotThrow(()=>assertAppendOnly(scalar,next));
});
test('source content remains immutable even at unchanged cardinality',()=>{
  const prev=seed(),next=structuredClone(prev);next.sources.A.fetchedAt='2026-10-08T00:00:00Z';
  assert.throws(()=>assertAppendOnly(prev,next),/source entry removed or changed/);
});
console.log(passed+' tests passed');
