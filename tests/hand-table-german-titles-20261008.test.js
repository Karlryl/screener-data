'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STOP_WORDS = /\b(the|and|of|for|with|from|by|to|in|on|statements|statement|presented|report|results|release|annual|financial|consolidated|quarter|interim|management|accounts|filing|publications|dates|issuer|prospectus|offering|matches|same|identical|cover page|period|ended|after|split|reverse)\b/gi;
const ABBREVIATIONS = /\b(FY|9M|H1|Q[1-4])\s?\d{2,4}\b/g;
const URLS = /https?:\/\/[^\s;]+/g;
const ALLOWED_TOKENS = [
  // "in" is also a German preposition, used in the statement-currency sources.
  { scope: /.*/, token: /\bin\b/gi },
  // Only the two individual tokens of ANDG's original section name are exempt.
  { scope: /^share-count-hand-table\.json:ANDG\.source\.form$/,
    token: /(?<=„)The(?= offering“)|(?<=„The )offering(?=“)/g },
  // AEON Financial Service is the issuer's proper name, not English prose.
  { scope: /^financial-known-cases\.json:aeon-/,
    token: /(?<=\bAEON )Financial(?= Service\b)/g },
  // Preserve FY2024/25/26 only inside these existing Japanese original report names.
  { scope: /^financial-known-cases\.json:(?:aeon|okasan)-/,
    token: /(?<=決算短信 )FY202[456](?= \((?:\d{4}-\d{2}-\d{2}|\d{4}年3月期)\), 連結経営成績)/g },
];

function findViolations(text, location) {
  const allowed = ALLOWED_TOKENS.filter(entry => entry.scope.test(location))
    .flatMap(entry => [...text.matchAll(entry.token)]);
  return [...text.matchAll(STOP_WORDS), ...text.matchAll(ABBREVIATIONS)]
    .filter(hit => !allowed.some(token => token.index === hit.index && token[0] === hit[0]))
    .map(hit => hit[0]);
}

function checkText(text, location) {
  assert.equal(typeof text, 'string', location);
  assert.ok(text.trim(), location + ': empty source text');
  assert.deepStrictEqual(findViolations(text, location), [], location + ': ' + text);
}

const readTable = name => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'configs', name), 'utf8'));
const rows = table => Object.entries(table).filter(([key]) => !key.startsWith('_'));
// Same extraction as lib/export-provenance.js; do not translate or reorder these fragments.
const extractQuotes = text => [...text.matchAll(/"([^"]+)"/g)].map(match => match[1]);
const EXPECTED_QUOTES = {
  HSAI: ['Following the ADS Ratio Change, each ADS now represents eight (8) Class B ordinary shares.'],
  BSBR: ['Each ADS represents one (1) unit', 'each representing one common share and one preferred share'],
};

test('all 33 Q4 source titles and both notes use German prose', () => {
  const file = 'yahoo-q4-known-cases.json';
  let titles = 0, notes = 0;
  for (const row of readTable(file).cases) {
    for (const [index, source] of row.sources.entries()) {
      const location = `${file}:${row.caseId}.sources[${index}]`;
      checkText(source.title, location + '.title');
      titles++;
      if (Object.hasOwn(source, 'note')) {
        checkText(source.note, location + '.note');
        notes++;
      }
    }
  }
  assert.equal(titles, 33, 'No Q4 title may be silently omitted');
  assert.equal(notes, 2, 'Both Q4 source notes must be checked');
});

test('every ADS source remains a string with German prose outside quotes and URLs', () => {
  const file = 'ads-hand-table.json';
  for (const [ticker, row] of rows(readTable(file))) {
    assert.equal(typeof row.source, 'string', ticker);
    checkText(row.source.replace(/"([^"]+)"/g, ' ').replace(URLS, ' '), `${file}:${ticker}.source`);
  }
});

test('HSAI and BSBR retain every verbatim quote in its original order', () => {
  const table = readTable('ads-hand-table.json');
  for (const [ticker, expected] of Object.entries(EXPECTED_QUOTES)) {
    assert.deepStrictEqual(extractQuotes(table[ticker].source), expected, ticker);
  }
});

test('every statement-currency source uses German prose outside URLs', () => {
  const file = 'statement-currency-hand-table.json';
  for (const [ticker, row] of rows(readTable(file))) {
    assert.equal(typeof row.source, 'string', ticker);
    checkText(row.source.replace(URLS, ' '), `${file}:${ticker}.source`);
  }
});

test('every share-count source form and title uses German prose', () => {
  const file = 'share-count-hand-table.json';
  for (const [ticker, row] of rows(readTable(file))) {
    const fields = ['form', 'title'].filter(field => Object.hasOwn(row.source, field));
    assert.ok(fields.length, ticker + ': no source form or title');
    for (const field of fields) checkText(row.source[field], `${file}:${ticker}.source.${field}`);
  }
});

test('every financial-known-cases source title is checked, preserving original names', () => {
  const file = 'financial-known-cases.json';
  let titles = 0;
  for (const row of readTable(file).cases) {
    for (const [index, source] of row.sources.entries()) {
      if (Object.hasOwn(source, 'title')) {
        checkText(source.title, `${file}:${row.caseId}.sources[${index}].title`);
        titles++;
      }
    }
  }
  assert.ok(titles > 0, 'Financial source titles must be checked');
});

test('token exceptions never exempt surrounding English or unrelated abbreviations', () => {
  checkText('Die Abschlüsse sind in EUR dargestellt.', 'fixture');
  const section = 'share-count-hand-table.json:ANDG.source.form';
  checkText('Abschnitt „The offering“', section);
  assert.deepStrictEqual(findViolations('The offering', section), ['The', 'offering']);
  assert.deepStrictEqual(findViolations('„The offering“ report', section), ['report']);
  const japanese = 'financial-known-cases.json:aeon-2026-02-28-annualRev.sources[0].title';
  const original = 'AEON Financial Service 決算短信 FY2026 (2026-04-08), 連結経営成績';
  checkText(original, japanese);
  assert.deepStrictEqual(findViolations(original + ' financial FY2026', japanese), ['financial', 'FY2026']);
  for (const text of ['ANNUAL report', 'cover page', 'FY2025', '9M2025', 'H1 2025', 'Q42025']) {
    assert.throws(() => checkText(text, 'fixture'), assert.AssertionError, text);
  }
  checkText('Konzernabschluss, Veröffentlichungstermine und Emittent', 'fixture');
});

// Reuse the exact core check for the required in-memory proof against pre-translation texts.
module.exports = { findViolations };
