'use strict';

const fs = require('node:fs');
const path = require('node:path');

const [action, repoRoot, target] = process.argv.slice(2);
const input = JSON.parse(process.env.T204_INPUT || 'null');

switch (action) {
  case 'studie': {
    process.env.STUDIE_MITSCHRIFT_DIR = path.dirname(target);
    const { anhaengen } = require(path.join(repoRoot, 'scripts', 'studie-mitschrift.js'));
    anhaengen(input);
    break;
  }
  case 'ab': {
    const { writeReportArtifact } = require(path.join(repoRoot, 'scripts', 'ab-computed-margin.js'));
    writeReportArtifact(target, input);
    break;
  }
  case 'f4': {
    const { writeReportArtifact } = require(path.join(repoRoot, 'scripts', 'f4-quartalsvergleich.js'));
    writeReportArtifact(target, input);
    break;
  }
  case 'qc': {
    const { writeOverlapArtifact } = require(path.join(repoRoot, 'scripts', 'qc-overlap.js'));
    writeOverlapArtifact(target, input);
    break;
  }
  case 't168': {
    const { writeLayerDiffReport } = require(path.join(repoRoot, 'scripts', 't168-layer-diff.js'));
    writeLayerDiffReport(target, input);
    break;
  }
  case 'direct':
    fs.writeFileSync(target, input, 'utf8');
    break;
  default:
    throw new Error(`unknown T204 remainder fixture action: ${action}`);
}

