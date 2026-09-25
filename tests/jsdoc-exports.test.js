'use strict';

// Run standalone: node tests/jsdoc-exports.test.js
// Static inspection only: library modules are never loaded or executed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

// S18's original claim that no guard hashes lib sources was false. These exact
// paths are registered byte artifacts; comments move their hashes too. Their
// exports remain visible in the inventory, but documentation cannot require a
// reseal. Registration/seal changes belong to Karl/Claude, not this guard.
const VERSIEGELT = {
  'lib/early-detection.js':
    'FEM-SEC-US@1.2.0: protocol/early-detection/1.2.0/hash-manifest.json:11; '
    + 'tests/early-detection-siegel-wachposten.test.js:50-53 calls '
    + 'scripts/early-detection-audit.js:333-368 to verify every manifest member',
  'lib/ledger-single-appender.js':
    'H9 executable anchor: protocol/early-detection/2.0.0/'
    + 'h9-single-appender-enforcement-anchor-addendum-3.json:24-27; '
    + 'tests/studie-protokoll-freeze-wachen.test.js:94-120 follows the addendum '
    + 'chain and checks the LF-normalized module hash',
  'lib/studie-verfassung.js':
    'H9 registered dependency: protocol/early-detection/2.0.0/'
    + 'h9-single-appender-enforcement-anchor-addendum-3.json:35-40 pins its '
    + 'LF-normalized hash; tests/studie-protokoll-freeze-wachen.test.js:116-131 '
    + 'checks the parent module/probe, not this dependency hash directly',
};

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
      chars[start] = '0'; // Keep an operand marker for statement-boundary checks.
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
      chars[start] = '0'; // Keep an operand marker for statement-boundary checks.
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
  // Only module-scope bindings can back these CommonJS exports. A documented
  // same-name inner helper must never replace the actual exported definition.
  const moduleScope = new Uint8Array(mask.length);
  let depth = 0;
  for (let i = 0; i < mask.length; i++) {
    moduleScope[i] = depth === 0 ? 1 : 0;
    if ('{(['.includes(mask[i])) depth++;
    else if ('})]'.includes(mask[i])) depth--;
  }
  function isDeclarationStart(index) {
    if (!moduleScope[index]) return false;
    const prefix = mask.slice(0, index);
    if (/^\s*$/.test(prefix) || /[;}]$/.test(prefix.trimEnd())) return true;
    // ASI allows a declaration on the next line, except while an expression
    // is waiting for an operand (including a named function expression).
    return /\n[ \t\r]*$/.test(prefix)
      && !/(?:[=(:,[!&|?+*/%~<>-]|\b(?:new|return|throw|yield|await|void|typeof|delete|in|instanceof))\s*$/.test(prefix);
  }
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
    if (!isDeclarationStart(m.index)) continue;
    const open = m.index + m[0].lastIndexOf('(');
    add(m[1], m.index, open, closing(mask, open, '(', ')'));
  }
  for (const m of mask.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?/g)) {
    if (!moduleScope[m.index]) continue;
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

// Scope collisions must preserve the documentation status of the outer binding.
const nestedDocumented = [
  'function exported(x) { return x; }',
  'function container() {',
  '/** Inner helper. @param {number} x Input. */',
  'function exported(x) { return x; }',
  'return exported(1);',
  '}',
  'module.exports = { exported };',
].join('\n');
assert.equal(inspect(nestedDocumented).length, 1, 'the exported module binding is retained');
assert.equal(inspect(nestedDocumented)[0].line, 1, 'a nested helper cannot replace the outer definition');
assert.equal(inspect(nestedDocumented)[0].valid, false, 'inner JSDoc cannot document an outer export');
const outerDocumented = '/** Outer function. @param {number} x Input. */\n'
  + nestedDocumented.replace('/** Inner helper. @param {number} x Input. */', '');
assert.equal(inspect(outerDocumented)[0].valid, true, 'an undocumented inner helper cannot invalidate a documented outer export');
const namedExpression = [
  '/** Outer function. @param {number} x Input. */',
  'function exported(x) { return x; }',
  'const another = function exported(x) { return x; };',
  'module.exports = { exported, another };',
].join('\n');
assert.deepEqual(inspect(namedExpression).map(fn => [fn.publicName, fn.valid]),
  [['exported', true], ['another', false]], 'a named function expression binds the const, not its inner name');
assert.equal(inspect('const another =\nfunction inner(x) { return x; };\nmodule.exports = { inner, another };').length,
  1, 'the inner name of a multiline function expression is not a module binding');
assert.equal(inspect('const marker = 1\n/** Purpose. */\nfunction zero() {}\nmodule.exports = { zero };')[0].valid,
  true, 'ASI before a module-scope declaration is supported');

for (const operand of ['"literal"', '/a{2}/']) {
  const afterLiteral = 'const marker = ' + operand
    + '\n/** Purpose. */\nfunction zero() {}\nmodule.exports = { zero };';
  assert.equal(inspect(afterLiteral)[0].valid, true, 'ASI after a literal preserves a following declaration');
}


const files = ['lib', 'lib/druckenmiller'].flatMap(dir => fs.readdirSync(path.join(ROOT, dir))
  .filter(name => name.endsWith('.js') && !name.endsWith('.test.js'))
  .map(name => dir + '/' + name)).sort();
for (const file of Object.keys(VERSIEGELT)) {
  assert.ok(files.includes(file), `Stale sealed-source exemption: ${file}`);
}
let total = 0;
let sealed = 0;
const failures = [];
for (const file of files) {
  const functions = inspect(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  total += functions.length;
  if (Object.hasOwn(VERSIEGELT, file)) {
    assert.ok(functions.length > 0, `Sealed source has no inventoried exports: ${file}`);
    sealed += functions.length;
    console.log(`VERSIEGELT ${file}: funktions-exports=${functions.length} ohne-pflichtdoku=${functions.filter(fn => !fn.valid).length}; ${VERSIEGELT[file]}`);
    console.log('  exports: ' + functions.map(fn => `${fn.publicName}:${fn.line}`).join(', '));
  } else {
    for (const fn of functions) if (!fn.valid) failures.push(`${file}:${fn.line} ${fn.publicName}`);
  }
}
console.log(`funktions-exports=${total} pruefpflichtig=${total - sealed} versiegelt=${sealed} fehlend=${failures.length}`);
for (const failure of failures) console.error(failure);
assert.deepEqual(failures, [], 'Every nonsealed local function export needs adjacent JSDoc and parameter documentation');
