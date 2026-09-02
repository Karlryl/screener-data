'use strict';

// Dedicated preload for scripts/test-gate.js. Keeping this separate is part of
// the contract: Worker threads inherit parsed --require entries, so preloading
// the gate itself could cache and suppress a later Worker entry into that file.
const fs = require('node:fs');

const PROBE_ENV = 'SCREENER_TEST_GATE_NODE_TEST_PROBE';
const RESTORE_ENV = 'SCREENER_TEST_GATE_NODE_OPTIONS_RESTORE';
const PROBE_FD = 3;

function installNodeTestProbe() {
  const nodeTestFlag = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  const markNodeTestLoaded = () => Atomics.store(nodeTestFlag, 0, 1);
  const Module = require('node:module');

  if (typeof Module.registerHooks === 'function') {
    Module.registerHooks({
      load(url, context, nextLoad) {
        if (url === 'node:test') markNodeTestLoaded();
        return nextLoad(url, context);
      },
    });
  } else {
    // package.json permits Node 22. _load covers CommonJS; register plus the
    // shared flag covers ESM imports performed in the asynchronous hook thread.
    const originalLoad = Module._load;
    Module._load = function probedLoad(request) {
      if (request === 'node:test') markNodeTestLoaded();
      return Reflect.apply(originalLoad, this, arguments);
    };
    const asyncHookSource = [
      'let flag;',
      'export function initialize(data) { flag = new Int32Array(data.flag); }',
      'export async function load(url, context, nextLoad) {',
      "  if (url === 'node:test') Atomics.store(flag, 0, 1);",
      '  return nextLoad(url, context);',
      '}',
    ].join('\n');
    Module.register('data:text/javascript,' + encodeURIComponent(asyncHookSource), {
      data: { flag: nodeTestFlag.buffer },
    });
  }

  const originalGetBuiltinModule = process.getBuiltinModule;
  if (typeof originalGetBuiltinModule === 'function') {
    process.getBuiltinModule = function probedGetBuiltinModule(id) {
      if (id === 'node:test') markNodeTestLoaded();
      return Reflect.apply(originalGetBuiltinModule, this, arguments);
    };
  }

  process.once('exit', () => {
    try { fs.writeSync(PROBE_FD, Atomics.load(nodeTestFlag, 0) ? '1\n' : '0\n'); } catch (_) {}
  });
}

if (module.isPreloading && process.env[PROBE_ENV] === '1') {
  const restoredNodeOptions = process.env[RESTORE_ENV] || '';
  delete process.env[PROBE_ENV];
  delete process.env[RESTORE_ENV];
  if (restoredNodeOptions) process.env.NODE_OPTIONS = restoredNodeOptions;
  else delete process.env.NODE_OPTIONS;
  installNodeTestProbe();
}
