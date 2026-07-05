const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const { route } = require(ROOT + '/src/scoring/router.js');
const { evaluateLamps } = require(ROOT + '/src/scoring/lamps.js');
const { gradeSnapshot } = require(ROOT + '/methods/data-quality.js');

function load(t) { return JSON.parse(fs.readFileSync(ROOT + '/snapshots/' + t + '.json','utf8')); }

// Samsung newestQtrSuspect?
const sam = load('005930.KS');
console.log('005930.KS route:', route(sam).action, 'lamps:', evaluateLamps(sam).active.join(','));

// AMLX grade-D?
const amlx = load('AMLX');
console.log('AMLX route:', route(amlx).action, 'grade:', gradeSnapshot(amlx).grade, 'lamps:', evaluateLamps(amlx).active.join(','));

// Tencent 0700.HK is dup-issuer loser leg?
const ten = load('0700.HK');
console.log('0700.HK name:', ten.meta && ten.meta.name, 'route:', route(ten).action);
