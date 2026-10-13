'use strict';

/**
 * Preload used by scripts/test-offline-fixtures.js. Any attempted network use
 * permanently makes the process fail, even when application code catches the
 * immediate error or later calls process.exit(0).
 */

const path = require('node:path');
const fs = require('node:fs');

const STATE_KEY = Symbol.for('screener.offlineNetworkGuard');

function appendSelfToNodeOptions() {
  const nativePath = path.resolve(__filename);
  const optionPath = nativePath.replace(/\\/g, '/');
  const existing = String(process.env.NODE_OPTIONS || '').trim();
  if (existing.includes(nativePath) || existing.includes(optionPath)) return;
  const requireOption = `--require=${JSON.stringify(optionPath)}`;
  process.env.NODE_OPTIONS = existing ? `${existing} ${requireOption}` : requireOption;
}

function replaceFunction(target, name, replacement) {
  if (!target || typeof target[name] !== 'function') return;
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, {
    configurable: descriptor ? descriptor.configurable !== false : true,
    enumerable: descriptor ? descriptor.enumerable : true,
    writable: true,
    value: replacement,
  });
}

function install() {
  if (globalThis[STATE_KEY]) {
    appendSelfToNodeOptions();
    return globalThis[STATE_KEY];
  }

  const originalExit = process.exit.bind(process);
  const state = { attempts: [] };
  Object.defineProperty(globalThis, STATE_KEY, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: state,
  });

  function blockedError(api) {
    const error = new Error(`[offline-network-guard] blocked network API: ${api}`);
    error.code = 'ERR_OFFLINE_NETWORK_BLOCKED';
    state.attempts.push(api);
    const markerPath = process.env.SCREENER_OFFLINE_NETWORK_MARKER;
    if (markerPath) {
      try {
        fs.appendFileSync(markerPath, `${process.pid}:${api}\n`, 'utf8');
      } catch (markerError) {
        process.stderr.write(`[offline-network-guard] could not write marker: ${markerError.message}\n`);
      }
    }
    if (!process.exitCode) process.exitCode = 1;
    process.stderr.write(`${error.message}\n`);
    return error;
  }

  function blockedSync(api) {
    return function offlineNetworkBlocked() {
      throw blockedError(api);
    };
  }

  function blockedPromise(api) {
    return function offlineNetworkBlockedPromise() {
      return Promise.reject(blockedError(api));
    };
  }

  if (typeof globalThis.fetch === 'function') {
    globalThis.fetch = blockedPromise('fetch');
  }

  const http = require('node:http');
  const https = require('node:https');
  replaceFunction(http, 'request', blockedSync('http.request'));
  replaceFunction(http, 'get', blockedSync('http.get'));
  replaceFunction(https, 'request', blockedSync('https.request'));
  replaceFunction(https, 'get', blockedSync('https.get'));

  const net = require('node:net');
  replaceFunction(net, 'connect', blockedSync('net.connect'));
  replaceFunction(net, 'createConnection', blockedSync('net.createConnection'));
  replaceFunction(net.Socket && net.Socket.prototype, 'connect', blockedSync('net.Socket.connect'));

  const tls = require('node:tls');
  replaceFunction(tls, 'connect', blockedSync('tls.connect'));
  replaceFunction(tls.TLSSocket && tls.TLSSocket.prototype, 'connect', blockedSync('tls.TLSSocket.connect'));

  const dns = require('node:dns');
  const dnsMethods = [
    'lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny',
    'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs',
    'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTlsa', 'resolveTxt', 'reverse',
  ];
  for (const name of dnsMethods) replaceFunction(dns, name, blockedSync(`dns.${name}`));
  if (dns.Resolver && dns.Resolver.prototype) {
    for (const name of dnsMethods) {
      replaceFunction(dns.Resolver.prototype, name, blockedSync(`dns.Resolver.${name}`));
    }
  }

  const dnsPromises = dns.promises;
  const dnsPromiseMethods = dnsMethods;
  for (const name of dnsPromiseMethods) {
    replaceFunction(dnsPromises, name, blockedPromise(`dns.promises.${name}`));
  }
  if (dnsPromises.Resolver && dnsPromises.Resolver.prototype) {
    for (const name of dnsPromiseMethods) {
      replaceFunction(
        dnsPromises.Resolver.prototype,
        name,
        blockedPromise(`dns.promises.Resolver.${name}`),
      );
    }
  }

  const dgram = require('node:dgram');
  replaceFunction(dgram, 'createSocket', blockedSync('dgram.createSocket'));
  if (dgram.Socket && dgram.Socket.prototype) {
    for (const name of ['bind', 'connect', 'send']) {
      replaceFunction(dgram.Socket.prototype, name, blockedSync(`dgram.Socket.${name}`));
    }
  }

  process.exit = function guardedProcessExit(code) {
    const requestedCode = code === undefined ? (process.exitCode || 0) : code;
    const finalCode = state.attempts.length && Number(requestedCode) === 0 ? 1 : requestedCode;
    return originalExit(finalCode);
  };
  process.on('beforeExit', () => {
    if (state.attempts.length && !process.exitCode) process.exitCode = 1;
  });

  appendSelfToNodeOptions();
  return state;
}

const state = install();

module.exports = { STATE_KEY, install, state };
