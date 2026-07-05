'use strict';
// CORE METHODOLOGY QUESTION: is wcov the RIGHT shrinkage factor for the variance artifact?
//
// The renorm-on-drop base score is a weighted mean of present per-axis percentiles.
// Each present percentile ~ approximately uniform-ish on [0,100] under the null (a name with
// no real signal ranks uniformly). Var(percentile) = sigma^2 (~ 833 for U[0,100]).
// Weighted mean over present axes with weights w_i (renormalized): 
//   Var(base) = sigma^2 * sum(w_i^2) / (sum w_i)^2   [assuming ~indep axes]
// This is the "effective 1/k" — for equal weights k axes present, Var = sigma^2/k.
//
// wcov = sum(present w_i)/sum(all w_i). This is NOT the same as sum(w_i^2)/(sum w_i)^2.
// So the shrinkage factor wcov does NOT equal the ratio of variances. Let's quantify the gap.
//
// James-Stein-correct shrink toward mean would use factor ~ Var_full/Var_partial (to equalize variance),
// i.e. sqrt or ratio. Here they use LINEAR wcov. Question: does linear-wcov OVER- or UNDER-correct?

// Take the consumer-staples axis weights and simulate.
const fs=require('fs'),path=require('path');
const formulas=require('./src/scoring/formulas/index.js');
function axisVarRatio(weights, presentMask){
  // full variance factor: sum(w^2)/(sum w)^2 over ALL axes
  const allW=weights;
  const sumAll=allW.reduce((a,b)=>a+b,0);
  const varFull=allW.reduce((a,b)=>a+b*b,0)/(sumAll*sumAll);
  // partial: only present
  const pw=allW.filter((_,i)=>presentMask[i]);
  const sumP=pw.reduce((a,b)=>a+b,0);
  const varPart=pw.reduce((a,b)=>a+b*b,0)/(sumP*sumP);
  const wcov=sumP/sumAll;
  // To equalize the SD of the partial to the full, the correct shrink factor is sqrt(varFull/varPart).
  const sdShrinkCorrect=Math.sqrt(varFull/varPart);
  return {wcov, varFull, varPart, sdShrinkCorrect, ratio_wcov_over_correct: wcov/sdShrinkCorrect};
}

// Example: consumer-staples weights, drop the two smallest (revAccel 0.5, marginTraj 0.3) like 9633.HK
const cs=formulas['consumer-staples'];
const track='profitable';
const w=cs.axes.map(a=>a.w[track]);
console.log('consumer-staples weights:',cs.axes.map(a=>`${a.key}=${a.w[track]}`).join(' '));
// drop revAcceleration & marginTrajectory
const mask=cs.axes.map(a=>!['revAcceleration','marginTrajectory'].includes(a.key));
console.log('drop revAccel+marginTraj:',axisVarRatio(w,mask));

// Now a HEAVY drop: name that dropped a heavy axis (revGrowthLevel w=4.2)
const mask2=cs.axes.map(a=>a.key!=='revGrowthLevel');
console.log('\ndrop revGrowthLevel(4.2):',axisVarRatio(w,mask2));

// A name with only the 2 heaviest present (dilution 2.4 + revGrowth 4.2), rest dropped
const mask3=cs.axes.map(a=>['revGrowthLevel','dilution','capitalEfficiency'].includes(a.key));
console.log('\nonly 3 heavy present:',axisVarRatio(w,mask3));
