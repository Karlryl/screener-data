const fs = require('fs');
const { norm, ratioSeries, presentValues } = require('./src/scoring/snapshot.js');
const s = JSON.parse(fs.readFileSync('snapshots/AWR.json','utf8'));
const margins = presentValues(ratioSeries(norm(s,'annualOpInc'), norm(s,'annualRev')));
console.log('margins:', margins);
const mean = a => a.reduce((p,c)=>p+c,0)/a.length;
const cur = margins[0];                 // 0.3098 (newest valid margin = FY-idx1)
const histRest = mean(margins.slice(1));// mean(0.3301, 0.2575) = 0.2938
const rising = margins[0] > margins[1]; // 0.3098 > 0.3301 ? false -> not rising
console.log('cur:', cur, 'histRest:', histRest, 'rising:', rising);
console.log('cur > histRest:', cur > histRest);
const overshoot = cur/histRest - 1;
console.log('overshoot:', overshoot, 'disc:', 1/(1+Math.max(0,overshoot)));
// Is the discount self-consistent / sensible? cur is the newest computable margin,
// compared to mean of its own older margins. That is exactly the intended semantics.
