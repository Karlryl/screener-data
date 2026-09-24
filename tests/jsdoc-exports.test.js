'use strict';

// Run standalone: node tests/jsdoc-exports.test.js
// Static inspection only: library modules are never loaded or executed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

function scanSource(source) {
  const chars = source.split('');
  const comments = [];
  const blank = (start, end) => {
    for (let k = start; k < end; k++) if (chars[k] !== '\n' && chars[k] !== '\r') chars[k] = ' ';
  };
  let i = 0;
  let previous = '';
  while (i < source.length) {
    const start = i;
    const ch = source[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '/' && source[i + 1] === '/') {
      i = source.indexOf('\n', i + 2);
      if (i < 0) i = source.length;
      comments.push({ start, end: i, text: source.slice(start, i) });
      blank(start, i);
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      assert.notEqual(end, -1, 'unterminated source comment');
      i = end + 2;
      comments.push({ start, end: i, text: source.slice(start, i) });
      blank(start, i);
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i++] === ch) break;
      }
      blank(start, i);
      previous = 'literal';
      continue;
    }
    if (ch === '/' && (!previous || /^(?:[=(:,[!&|?{};]|return|case|=>)$/.test(previous))) {
      i++;
      let inClass = false;
      while (i < source.length) {
        const c = source[i++];
        if (c === '\\') { i++; continue; }
        if (c === '[') inClass = true;
        if (c === ']') inClass = false;
        if (c === '/' && !inClass) break;
      }
      while (/[a-z]/i.test(source[i] || '') && i < source.length) i++;
      blank(start, i);
      previous = 'literal';
      continue;
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
    if (word) { previous = word[0]; i += word[0].length; }
    else if (source.slice(i, i + 2) === '=>') { previous = '=>'; i += 2; }
    else { previous = ch; i++; }
  }
  return { mask: chars.join(''), comments };
}

function closing(mask, start, left, right) {
  let depth = 0;
  for (let i = start; i < mask.length; i++) {
    if (mask[i] === left) depth++;
    if (mask[i] === right && --depth === 0) return i;
  }
  throw new Error('unbalanced ' + left + ' at ' + start);
}

function inspect(source) {
  const { mask, comments } = scanSource(source);
  const definitions = new Map();
  function add(name, start, open, end) {
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    const doc = comments.findLast(c => c.end <= start && /^\/\*\*/.test(c.text)
      && /^\s*$/.test(source.slice(c.end, start)));
    const description = doc && doc.text.slice(3, -2).split(/\r?\n/)
      .map(line => line.replace(/^\s*\*?\s?/, '').trim()).find(Boolean);
    const hasParams = mask.slice(open + 1, end).trim().length > 0;
    const valid = Boolean(description && !description.startsWith('@')
      && (!hasParams || /@param\b/.test(doc.text)));
    definitions.set(name, { name, start: lineStart, line: source.slice(0, start).split('\n').length,
      hasParams, documented: Boolean(doc), valid, docStart: doc ? doc.start : null });
  }
  for (const m of mask.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const open = m.index + m[0].lastIndexOf('(');
    add(m[1], m.index, open, closing(mask, open, '(', ')'));
  }
  for (const m of mask.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?/g)) {
    const restStart = m.index + m[0].length;
    const rest = mask.slice(restStart);
    const expression = /^(?:function(?:\s+[A-Za-z_$][\w$]*)?\s*)?\(/.exec(rest);
    if (expression) {
      const open = restStart + expression[0].lastIndexOf('(');
      const end = closing(mask, open, '(', ')');
      if (expression[0].startsWith('function') || /^\s*=>/.test(mask.slice(end + 1))) {
        add(m[1], m.index, open, end);
      }
    } else {
      const arrow = /^([A-Za-z_$][\w$]*)\s*=>/.exec(rest);
      if (arrow) add(m[1], m.index, restStart - 1, restStart + arrow[1].length);
    }
  }
  const exported = new Map();
  function exportName(publicName, localName) {
    if (definitions.has(localName)) exported.set(publicName, { ...definitions.get(localName), publicName });
  }
  for (const m of mask.matchAll(/\bmodule\s*\.\s*exports\s*=\s*\{/g)) {
    const start = m.index + m[0].lastIndexOf('{');
    const end = closing(mask, start, '{', '}');
    let partStart = start + 1;
    let depth = 0;
    for (let i = partStart; i <= end; i++) {
      if (i === end || (mask[i] === ',' && depth === 0)) {
        const part = mask.slice(partStart, i).trim();
        const entry = /^([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?$/.exec(part);
        if (entry) exportName(entry[1], entry[2] || entry[1]);
        partStart = i + 1;
      } else if ('{(['.includes(mask[i])) depth++;
      else if ('})]'.includes(mask[i])) depth--;
    }
  }
  for (const m of mask.matchAll(/\b(?:module\s*\.\s*)?exports\s*\.\s*([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)(?=[ \t]*(?:[;,]|\r?\n|$))/g)) {
    exportName(m[1], m[2]);
  }
  return [...exported.values()];
}

// Counterexamples keep the parser from passing by overlooking supported declarations.
const example = [
  '/** Adds one. @param {number} x Input. */', 'function plain(x) { return x + 1; }',
  '/** Awaits a number. @param {number} x Input. */', 'async function promised(x) { return x; }',
  '/** Returns a number. @param {number} x Input. */', 'const expression = function (x) { return x; };',
  '/** Returns an arrow result. @param {number} x Input. */', 'const arrow = async (x) => x;',
  'const constant = 3; class Example {}', "const reexport = require('./other');",
  'module.exports = { plain, alias: promised, constant, Example, reexport };',
  'module.exports.expression = expression;', 'exports.arrow = arrow;',
].join('\n');
assert.equal(inspect(example).length, 4, 'three export forms and four declaration forms');
assert.ok(inspect(example).every(f => f.valid), 'documented parser fixture');
assert.equal(inspect('function missing(x) {}\nmodule.exports = { missing };')[0].valid, false);
assert.equal(inspect('/** Purpose only. */\nfunction missing(x) {}\nexports.missing = missing;')[0].valid, false);
assert.equal(inspect('/** Purpose. @param {number} x Input. */\n// detached\nfunction missing(x) {}\nexports.missing = missing;')[0].valid, false);
assert.equal(inspect('/** Purpose. */\n\nfunction zero() {}\nmodule.exports = { zero };')[0].valid, true);
assert.equal(inspect('// module.exports = { fake };\nconst text = "function fake() {}";').length, 0);

assert.equal(inspect('/** @param {number} x - Value. */\nfunction tagOnly(x) {}\nmodule.exports = { tagOnly };')[0].valid, false, 'parameter tags cannot replace a purpose sentence');
for (const assignment of ['module.exports.missing = missing', 'exports.missing = missing']) {
  for (const ending of ['', '\n', '\nconst following = 1;']) {
    const undocumented = inspect('function missing(x) {}\n' + assignment + ending);
    assert.equal(undocumented.length, 1, 'property exports are found at EOF and ASI boundaries');
    assert.equal(undocumented[0].valid, false, 'an undocumented property export must be rejected');
    const documented = inspect('/** Returns its input. @param {number} x - Value. */\nfunction missing(x) { return x; }\n' + assignment + ending);
    assert.equal(documented.length, 1, 'documented property exports retain their inventory entry');
    assert.equal(documented[0].valid, true, 'documented property exports pass at EOF and ASI boundaries');
  }
}


const files = ['lib', 'lib/druckenmiller'].flatMap(dir => fs.readdirSync(path.join(ROOT, dir))
  .filter(name => name.endsWith('.js') && !name.endsWith('.test.js'))
  .map(name => dir + '/' + name)).sort();
let total = 0;
const failures = [];
for (const file of files) {
  const functions = inspect(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  total += functions.length;
  for (const fn of functions) if (!fn.valid) failures.push(`${file}:${fn.line} ${fn.publicName}`);
}
console.log(`funktions-exports=${total} fehlend=${failures.length}`);
for (const failure of failures) console.error(failure);
assert.deepEqual(failures, [], 'Every local function export needs adjacent JSDoc and parameter documentation');
