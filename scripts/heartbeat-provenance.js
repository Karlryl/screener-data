#!/usr/bin/env node
'use strict';
/**
 * P109 (06.10.2026): provenance status of the PUBLISHED findash export, for the Data Freshness
 * Heartbeat. Red when a status marker says `failed`, or when a board header does not match its
 * manifest / ok marker (the P22 `--check` logic, lib/export-provenance.js provenanceErrors).
 * Green otherwise. An export generated before the provenance contract was merged carries neither
 * headers nor markers; that stays green with a note. The same absence in a later export is a
 * silent loss and is red.
 *
 * Usage: node scripts/heartbeat-provenance.js --base <url of .../outputs/findash-export/v1>
 *        node scripts/heartbeat-provenance.js --root <local copy of findash-export/v1>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { provenanceErrors, MANIFEST_PATHS } = require('../lib/export-provenance.js');

// Merge of the provenance contract (0d4c38c85d, Tag 1422, 2026-10-06T14:21:18+02:00).
const CONTRACT_SINCE = Date.parse('2026-10-06T12:21:18Z');
const MARKERS = Object.values(MANIFEST_PATHS).map(p => path.posix.join(path.posix.dirname(p), '_failed.json'));
const RULE40 = 'rule40/overview.json';
const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

/** Board files the check covers: every branch of the index; rule40 only when published (fail-soft board). */
function boardFiles(root, index) {
  if (!Array.isArray(index?.branches) || !index.branches.length) throw new Error('index.json ohne branches');
  const files = index.branches.map(b => b + '.json');
  if (fs.existsSync(path.join(root, RULE40))) files.push(RULE40);
  return files;
}

/** @param {string} root Local findash-export/v1 tree. @returns {{ok: boolean, lines: string[]}} */
function checkExport(root) {
  const index = readJson(root, 'index.json');
  const files = boardFiles(root, index);
  const markers = MARKERS.filter(m => fs.existsSync(path.join(root, m)));
  const headers = files.filter(f => fs.existsSync(path.join(root, f)) && Object.hasOwn(readJson(root, f), 'provenanceVersion'));
  const generated = Date.parse(index.generated_at);
  if (!markers.length && !headers.length) {
    if (Number.isFinite(generated) && generated < CONTRACT_SINCE) {
      return { ok: true, lines: [`OK: Export vom ${index.generated_at} ist älter als der Herkunftsvertrag (Tag 1422); keine Prüfung.`] };
    }
    return { ok: false, lines: [`Herkunft fehlt still: Export vom ${index.generated_at} trägt weder Board-Kopf noch Statusmarker.`] };
  }
  const lines = [];
  for (const m of markers) {
    const marker = readJson(root, m);
    if (marker.status === 'failed') lines.push(`Herkunft zurückgehalten (${marker.board}): ${marker.reason}`);
  }
  for (const e of provenanceErrors(root, files, true)) lines.push('Herkunft ungültig: ' + e);
  return lines.length ? { ok: false, lines } : { ok: true, lines: [`OK: Herkunft gültig für ${files.length} Board-Dateien (Export ${index.generated_at}).`] };
}

/** Fetches the files the check needs into a temp tree; 404 = absent, any other failure throws. */
async function fetchExport(base) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heartbeat-provenance-'));
  const get = async (rel, required) => {
    const res = await fetch(base.replace(/\/$/, '') + '/' + rel, { signal: AbortSignal.timeout(60000) });
    if (res.status === 404 && !required) return false;
    if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
    return true;
  };
  await get('index.json', true);
  const index = readJson(root, 'index.json');
  for (const b of index.branches || []) await get(b + '.json', true);
  await get(RULE40, false);
  for (const rel of [...MARKERS, ...Object.values(MANIFEST_PATHS)]) await get(rel, false);
  return root;
}

async function main(argv) {
  const at = flag => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  try {
    const root = at('--root') || await fetchExport(at('--base') || '');
    const result = checkExport(root);
    for (const line of result.lines) console.log(result.ok ? line : '::error::' + line);
    return result.ok ? 0 : 1;
  } catch (e) {
    // Unreachable or unparsable counts as red, same fail-loud convention as the other heartbeat steps.
    console.log('::error::Herkunftsprüfung nicht möglich: ' + e.message);
    return 1;
  }
}

if (require.main === module) main(process.argv.slice(2)).then(code => process.exit(code));
module.exports = { checkExport, fetchExport, CONTRACT_SINCE };
