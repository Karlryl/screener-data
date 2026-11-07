'use strict';
// tests/fetch-exchange-quarters-br.test.js — standalone runner (node tests/fetch-exchange-quarters-br.test.js, exit 0/1).
// sd-quellen 07.11.2026: the Brazil (CVM) shadow pass of scripts/fetch-exchange-quarters.js, the quarter
// derivation in lib/exchange-quarter-store.js and scripts/br-shadow-report.js against fake zips in a temp
// directory. No live network, no write to the live store. WEG figures are the real CVM rows of 07.11.2026.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');

https.get = () => { throw new Error('live network access in a test'); };
https.request = () => { throw new Error('live network access in a test'); };

const ROOT = path.join(__dirname, '..');
const LIVE_DIR = path.join(ROOT, 'external-data', 'exchange-quarters');
const sha = (f) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : 'absent');
const liveBefore = ['cn', 'tw', 'br'].map((m) => sha(path.join(LIVE_DIR, m + '.json')));
const { main } = require('../scripts/fetch-exchange-quarters.js');
const S = require('../lib/exchange-quarter-store.js');
const { compareTicker } = require('../scripts/br-shadow-report.js');

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ok  ' + name); } catch (e) { failed += 1; console.log('  FAIL ' + name + '\n       ' + e.stack.split('\n').slice(0, 3).join('\n       ')); }
}
const quiet = () => {};
const NOW = (iso) => () => new Date(iso);
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-br-'));
  assert.notEqual(path.resolve(d), path.resolve(LIVE_DIR), 'test dir must not be the live store');
  return d;
}

// ── a real (stored, method 0) zip with central directory and EOCD ──────────────
function makeZip(files) {
  const locals = [], central = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(name), data = Buffer.from(text, 'latin1');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0, 8);
    h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 6); c.writeUInt16LE(0, 10);
    c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    locals.push(h, n, data); central.push(c, n);
    off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}

const WEG = '84.429.695/0001-11';
const BANK = '00.000.000/0001-91';
const IDX = 'CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;CATEG_DOC;ID_DOC;DT_RECEB;LINK_DOC';
const DRE = 'CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;GRUPO_DFP;MOEDA;ESCALA_MOEDA;ORDEM_EXERC;DT_INI_EXERC;DT_FIM_EXERC;CD_CONTA;DS_CONTA;VL_CONTA;ST_CONTA_FIXA';
const CAP = 'CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;QT_ACAO_ORDIN_CAP_INTEGR;QT_ACAO_PREF_CAP_INTEGR;QT_ACAO_TOTAL_CAP_INTEGR;QT_ACAO_ORDIN_TESOURO;QT_ACAO_PREF_TESOURO;QT_ACAO_TOTAL_TESOURO';
const idx = (cnpj, refer, v, kind, id, rec) => [cnpj, refer, v, 'X S.A.', '005410', kind, id, rec, 'http://x'].join(';');
const row = (cnpj, refer, v, ordem, ini, fim, acc, val, moeda = 'REAL', esc = 'MIL') =>
  [cnpj, refer, v, 'X S.A.', '005410', 'DF', moeda, esc, ordem, ini, fim, acc, acc === '3.01' ? 'Receita de Venda de Bens e/ou Serviços' : 'conta', val, 'S'].join(';');
const csv = (head, rows) => [head, ...rows].join('\n') + '\n';

function itr(year, { wegV2 = false, bankUsd = false } = {}) {
  const p = 'itr_cia_aberta_';
  const i = [idx(WEG, year + '-03-31', 1, 'ITR', '1', year + '-04-29'), idx(WEG, year + '-06-30', 1, 'ITR', '2', year + '-07-22'),
    idx(WEG, year + '-09-30', 1, 'ITR', '3', year + '-10-21'), idx(BANK, year + '-06-30', 1, 'ITR', '9', year + '-08-12')];
  if (wegV2) i.push(idx(WEG, year + '-06-30', 2, 'ITR', '4', year + '-08-30'));
  const v2 = wegV2 ? 2 : 1;
  const d = [
    row(WEG, year + '-03-31', 1, 'ÚLTIMO', year + '-01-01', year + '-03-31', '3.01', '9468313'),
    row(WEG, year + '-03-31', 1, 'PENÚLTIMO', (year - 1) + '-01-01', (year - 1) + '-03-31', '3.01', '10078571'),   // comparative: not kept
    row(WEG, year + '-06-30', 1, 'ÚLTIMO', year + '-04-01', year + '-06-30', '3.01', '10143555'),
    row(WEG, year + '-06-30', 1, 'ÚLTIMO', year + '-01-01', year + '-06-30', '3.01', '19611868'),
    row(WEG, year + '-09-30', 1, 'ÚLTIMO', year + '-07-01', year + '-09-30', '3.01', '10000000'),
    row(WEG, year + '-09-30', 1, 'ÚLTIMO', year + '-01-01', year + '-09-30', '3.01', '29611868'),
    row(WEG, year + '-09-30', 1, 'ÚLTIMO', year + '-01-01', year + '-09-30', '9.99', '1'),   // account not kept
    row(BANK, year + '-06-30', 1, 'ÚLTIMO', year + '-04-01', year + '-06-30', '3.01', '5', bankUsd ? 'DOLAR' : 'REAL'),
  ];
  if (wegV2) d.push(row(WEG, year + '-06-30', 2, 'ÚLTIMO', year + '-04-01', year + '-06-30', '3.01', '10200000'),
    row(WEG, year + '-06-30', 2, 'ÚLTIMO', year + '-01-01', year + '-06-30', '3.01', '19668313'));
  const dfc = [row(WEG, year + '-03-31', 1, 'ÚLTIMO', year + '-01-01', year + '-03-31', '6.01', '1262449'),
    row(WEG, year + '-06-30', v2, 'ÚLTIMO', year + '-01-01', year + '-06-30', '6.01', '2451238')];
  return makeZip({
    [p + year + '.csv']: csv(IDX, i), [p + 'DRE_con_' + year + '.csv']: csv(DRE, d), [p + 'DRE_ind_' + year + '.csv']: csv(DRE, []),
    [p + 'DFC_MI_con_' + year + '.csv']: csv(DRE, dfc), [p + 'DFC_MD_con_' + year + '.csv']: csv(DRE, []),
    [p + 'DFC_MI_ind_' + year + '.csv']: csv(DRE, []), [p + 'DFC_MD_ind_' + year + '.csv']: csv(DRE, []),
    [p + 'composicao_capital_' + year + '.csv']: csv(CAP, [[WEG, year + '-06-30', v2, 'WEG', '4197317998', '0', '4197317998', '1488307', '0', '1488307'].join(';'),
      [WEG, year + '-09-30', 1, 'WEG', '4197317998', '', '4197317998', '1488307', '', '1488307'].join(';')]),
  });
}
function dfp(year) {
  const p = 'dfp_cia_aberta_';
  const d = [row(WEG, year + '-12-31', 1, 'ÚLTIMO', year + '-01-01', year + '-12-31', '3.01', '40000000000', 'REAL', 'UNIDADE')];
  return makeZip({
    [p + year + '.csv']: csv(IDX, [idx(WEG, year + '-12-31', 1, 'DFP', '7', (year + 1) + '-02-20')]),
    [p + 'DRE_con_' + year + '.csv']: csv(DRE, d), [p + 'DRE_ind_' + year + '.csv']: csv(DRE, []),
    [p + 'DFC_MI_con_' + year + '.csv']: csv(DRE, []), [p + 'DFC_MD_con_' + year + '.csv']: csv(DRE, []),
    [p + 'DFC_MI_ind_' + year + '.csv']: csv(DRE, []), [p + 'DFC_MD_ind_' + year + '.csv']: csv(DRE, []),
    [p + 'composicao_capital_' + year + '.csv']: csv(CAP, []),
  });
}
const VM = 'CNPJ_Companhia;Data_Referencia;Versao;ID_Documento;Nome_Empresarial;Valor_Mobiliario;Sigla_Classe_Acao_Preferencial;Classe_Acao_Preferencial;Codigo_Negociacao;Composicao_BDR_Unit;Mercado;Sigla_Entidade_Administradora;Entidade_Administradora;Data_Inicio_Negociacao;Data_Fim_Negociacao;Segmento;Data_Inicio_Listagem;Data_Fim_Listagem';
const vm = (cnpj, kind, code, mercado = 'Bolsa', fim = '') => [cnpj, '2026-01-01', '1', '1', 'X', kind, '', '', code, '', mercado, 'B3', 'B3', '2006-01-01', fim, 'NM', '1977-01-01', ''].join(';');
function fca(year) {
  return makeZip({ ['fca_cia_aberta_valor_mobiliario_' + year + '.csv']: csv(VM, [
    vm(WEG, 'Ações Ordinárias', 'WEGE3'), vm(BANK, 'Ações Ordinárias', 'BBAS3'),
    vm(BANK, 'Ações Preferenciais', 'BBAS4', 'Bolsa', '2020-01-01'),    // trading ended: not mapped
    vm(WEG, 'Debêntures', 'WEGE11'),                                     // not a share class
    vm('11.111.111/0001-11', 'Ações Ordinárias', 'DUPL3'), vm('22.222.222/0001-22', 'Ações Ordinárias', 'DUPL3'),  // ambiguous
  ]) });
}
const BASE = 'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/';
function cvm(over = {}) {
  const files = {
    'FCA/DADOS/fca_cia_aberta_2026.zip': fca(2026),
    'FCA/DADOS/fca_cia_aberta_2025.zip': makeZip({ ['fca_cia_aberta_valor_mobiliario_2025.csv']: csv(VM, [vm(WEG, 'Ações Ordinárias', 'WEGE3')]) }),
    'ITR/DADOS/itr_cia_aberta_2026.zip': itr(2026, over.itr2026 || {}), 'ITR/DADOS/itr_cia_aberta_2025.zip': itr(2025),
    'DFP/DADOS/dfp_cia_aberta_2025.zip': dfp(2025), 'DFP/DADOS/dfp_cia_aberta_2024.zip': dfp(2024),
    ...(over.files || {}),
  };
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const body = files[url.slice(BASE.length)];
    if (body === undefined) throw new Error(url + ' -> HTTP 404 (nicht wiederholbar)');
    if (body === 'boom') throw new Error(url + ' -> HTTP 500');
    return { code: 200, body, headers: { 'last-modified': 'Sun, 01 Nov 2026 10:43:25 GMT' } };
  };
  fn.calls = calls;
  return fn;
}
const TICKERS = ['WEGE3.SA', 'BBAS3.SA', 'BBAS4.SA', 'DUPL3.SA', 'NOPE3.SA', '600064.SS'];
const run = (dir, fetchBuffer, now = '2026-11-07T15:00:00Z', extra = {}) =>
  main({ dir, markets: ['br'], tickers: TICKERS, fetchBuffer, now: NOW(now), log: quiet, ...extra });

(async () => {
  await t('parseCvmCsv: a row with the wrong field count throws (no column guessing)', () => {
    assert.deepEqual(S.parseCvmCsv('A;B\n1;2\n', 'f'), [{ A: '1', B: '2' }]);
    assert.throws(() => S.parseCvmCsv('A;B\n1;2;3\n', 'f.csv'), /f\.csv line 2: 3 fields/);
  });

  await t('monthsSpan and quarterBefore', () => {
    assert.equal(S.monthsSpan('2026-04-01', '2026-06-30'), 3);
    assert.equal(S.monthsSpan('2026-01-01', '2026-09-30'), 9);
    assert.equal(S.monthsSpan('2026-01-02', '2026-03-31'), null);
    assert.equal(S.monthsSpan('2026-01-01', '2026-03-30'), null);
    assert.equal(S.quarterBefore('2026-12-31'), '2026-09-30');
    assert.equal(S.quarterBefore('2026-03-31'), '2025-12-31');
    assert.equal(S.quarterBefore('2026-08-31'), '2026-05-31');
  });

  await t('brSingleQuarters: filed quarter, Q4 = year minus nine months, cash flow from YTD, filed beats derived', () => {
    const o = (rec, values, basis = 'con') => [{ received: rec, basis, values, confirmedBy: [] }];
    const q = S.brSingleQuarters({ docs: {
      'ITR 2025-03-31': o('2025-04-29', { '3.01 2025-01-01': 100, '6.01 2025-01-01': 10 }),
      'ITR 2025-06-30': o('2025-07-22', { '3.01 2025-01-01': 210, '3.01 2025-04-01': 110, '6.01 2025-01-01': 25 }),
      'ITR 2025-09-30': o('2025-10-21', { '3.01 2025-01-01': 330, '3.01 2025-07-01': 120, '6.01 2025-01-01': 45 }),
      'DFP 2025-12-31': o('2026-02-20', { '3.01 2025-01-01': 460, '6.01 2025-01-01': 70 }),
    } });
    assert.deepEqual(q['2025-03-31'].rev, { value: 100, received: '2025-04-29', derived: false, basis: 'con' });
    assert.equal(q['2025-06-30'].rev.value, 110);
    assert.equal(q['2025-06-30'].rev.derived, false, 'the filed three-month row wins over 210 - 100');
    assert.deepEqual(q['2025-12-31'].rev, { value: 130, received: '2026-02-20', derived: true, basis: 'con' });
    assert.equal(q['2025-06-30'].cfo.value, 15);
    assert.equal(q['2025-12-31'].cfo.value, 25);
    assert.equal(q['2025-03-31'].cfo.derived, false);
  });

  await t('brSingleQuarters: no Q4 when the nine months are missing or the basis differs', () => {
    const q = S.brSingleQuarters({ docs: {
      'ITR 2025-09-30': [{ received: '2025-10-21', basis: 'ind', values: { '3.01 2025-01-01': 330 } }],
      'DFP 2025-12-31': [{ received: '2026-02-20', basis: 'con', values: { '3.01 2025-01-01': 460 } }],
      'DFP 2024-12-31': [{ received: '2025-02-20', basis: 'con', values: { '3.01 2024-01-01': 400 } }],
    } });
    assert.equal(q['2025-12-31'], undefined);
    assert.equal(q['2024-12-31'], undefined);
  });

  await t('first pass: mapping, newest version, own period only, scale, currency guard, nothing for other markets', async () => {
    const dir = tmpDir();
    const f = cvm({ itr2026: { wegV2: true, bankUsd: true } });
    const r = await run(dir, f);
    assert.equal(r.exitCode, 0, JSON.stringify(r.results));
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'br.json'), 'utf8'));
    assert.equal(s.market, 'BR'); assert.equal(s.currency, 'BRL');
    assert.deepEqual(Object.keys(s.tickers), ['BBAS3.SA', 'WEGE3.SA'], 'ended class, debenture, ambiguous and unknown codes are not mapped');
    assert.deepEqual(r.results[0].ambiguous, 1);
    const weg = s.companies[WEG];
    const q2 = weg.docs['ITR 2026-06-30'];
    assert.equal(q2.length, 1);
    assert.equal(q2[0].version, 2, 'the newest VERSAO the index lists');
    assert.equal(q2[0].received, '2026-08-30');
    assert.deepEqual(q2[0].values, { '3.01 2026-01-01': 19668313000, '3.01 2026-04-01': 10200000000, '6.01 2026-01-01': 2451238000 });
    assert.deepEqual(q2[0].shares, { on: 4197317998, pn: 0, treasuryOn: 1488307, treasuryPn: 0 });
    assert.deepEqual(weg.docs['ITR 2026-09-30'][0].shares, { on: 4197317998, pn: null, treasuryOn: 1488307, treasuryPn: null }, 'an empty share count is null, not 0');
    assert.deepEqual(weg.docs['ITR 2026-03-31'][0].values, { '3.01 2026-01-01': 9468313000, '6.01 2026-01-01': 1262449000 }, 'the PENÚLTIMO comparative is not kept');
    assert.equal(weg.docs['ITR 2026-09-30'][0].values['9.99 2026-01-01'], undefined);
    assert.equal(weg.docs['DFP 2025-12-31'][0].values['3.01 2025-01-01'], 40000000000, 'UNIDADE scale is 1');
    assert.equal(s.companies[BANK].docs['ITR 2026-06-30'], undefined, 'a non-REAL document is skipped');
    assert.equal(r.results[0].otherCurrency, 1);
    assert.equal(S.brSingleQuarters(weg)['2025-12-31'].rev.value, 10388132000, 'derived Q4 = DFP year 40,000,000,000 minus nine months 29,611,868,000');
    assert.deepEqual(r.results[0].missingYears, ['DFP 2026'], 'DFP of the current year may be missing');
    assert.ok(!fs.existsSync(path.join(dir, 'cn.json')) && !fs.existsSync(path.join(dir, 'tw.json')));
  });

  await t('cadence: a second pass inside 6 days is skipped; forced re-read confirms nothing new; new version is a change', async () => {
    const dir = tmpDir();
    await run(dir, cvm());
    const before = fs.readFileSync(path.join(dir, 'br.json'), 'utf8');
    const f2 = cvm();
    const r2 = await run(dir, f2, '2026-11-10T15:00:00Z');
    assert.equal(r2.results[0].skipped, true);
    assert.equal(f2.calls.length, 0);
    const r3 = await run(dir, cvm(), '2026-11-14T15:00:00Z');
    assert.equal(r3.results[0].new, 0);
    assert.equal(r3.results[0].changed, 0);
    const after = JSON.parse(fs.readFileSync(path.join(dir, 'br.json'), 'utf8'));
    assert.equal(Object.keys(after.sources).length, 2);
    assert.equal(JSON.stringify(after.companies), JSON.stringify(JSON.parse(before).companies), 'same filing, same receipt date: no new line');
    const r4 = await run(dir, cvm({ itr2026: { wegV2: true } }), '2026-11-21T15:00:00Z');
    assert.equal(r4.results[0].changed, 1, 'ITR 2026-06-30 version 2 (values and share row live in one observation)');
    const s4 = JSON.parse(fs.readFileSync(path.join(dir, 'br.json'), 'utf8'));
    assert.equal(s4.companies[WEG].docs['ITR 2026-06-30'].length, 2, 'the old observation stays');
  });

  await t('404 is a named gap only where CVM may not have opened the file yet; otherwise it aborts and writes nothing', async () => {
    const dir = tmpDir();
    const r = await run(dir, cvm({ files: { 'ITR/DADOS/itr_cia_aberta_2026.zip': undefined } }), '2026-03-01T15:00:00Z');
    assert.equal(r.exitCode, 0, JSON.stringify(r.results));
    assert.deepEqual(r.results[0].missingYears, ['ITR 2026', 'DFP 2026']);
    const dirNov = tmpDir();
    const rNov = await run(dirNov, cvm({ files: { 'ITR/DADOS/itr_cia_aberta_2026.zip': undefined } }));
    assert.equal(rNov.exitCode, 1, 'the current ITR file vanishing in November is a failure, not a gap');
    assert.match(rNov.results[0].aborted, /ITR 2026: HTTP 404/);
    assert.ok(!fs.existsSync(path.join(dirNov, 'br.json')));
    const rMar = await run(tmpDir(), cvm({ files: { 'DFP/DADOS/dfp_cia_aberta_2025.zip': undefined } }), '2026-03-01T15:00:00Z');
    assert.equal(rMar.exitCode, 0, 'DFP of the previous year may be missing until April');
    assert.deepEqual(rMar.results[0].missingYears, ['DFP 2026', 'DFP 2025']);
    const rMay = await run(tmpDir(), cvm({ files: { 'DFP/DADOS/dfp_cia_aberta_2025.zip': undefined } }), '2026-05-02T15:00:00Z');
    assert.equal(rMay.exitCode, 1, 'from May on a missing DFP of the previous year is a failure');
    const dir2 = tmpDir();
    const r2 = await run(dir2, cvm({ files: { 'DFP/DADOS/dfp_cia_aberta_2024.zip': undefined } }));
    assert.equal(r2.exitCode, 1);
    assert.match(r2.results[0].aborted, /DFP 2024: HTTP 404/);
    assert.ok(!fs.existsSync(path.join(dir2, 'br.json')));
    const dir3 = tmpDir();
    const r3 = await run(dir3, cvm({ files: { 'ITR/DADOS/itr_cia_aberta_2025.zip': 'boom' } }));
    assert.equal(r3.exitCode, 1);
    assert.ok(!fs.existsSync(path.join(dir3, 'br.json')));
  });

  await t('FCA: both years are read; a company that has not filed the new form keeps its mapping; the newer year wins', async () => {
    const dir = tmpDir();
    const r = await run(dir, cvm({ files: { 'FCA/DADOS/fca_cia_aberta_2026.zip': undefined } }));
    assert.equal(r.exitCode, 0, JSON.stringify(r.results));
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'br.json'), 'utf8'));
    assert.deepEqual(Object.keys(s.tickers), ['WEGE3.SA']);
    assert.deepEqual(Object.values(s.sources)[0].unmapped, ['BBAS3.SA', 'BBAS4.SA', 'DUPL3.SA', 'NOPE3.SA'], 'unmapped watchlist tickers are named');
    const dir2 = tmpDir();
    const early = makeZip({ ['fca_cia_aberta_valor_mobiliario_2026.csv']: csv(VM, [vm(BANK, 'Ações Ordinárias', 'BBAS3')]) });
    const old = makeZip({ ['fca_cia_aberta_valor_mobiliario_2025.csv']: csv(VM, [vm(WEG, 'Ações Ordinárias', 'WEGE3'), vm('99.999.999/0001-99', 'Ações Ordinárias', 'BBAS3')]) });
    const r2 = await run(dir2, cvm({ files: { 'FCA/DADOS/fca_cia_aberta_2026.zip': early, 'FCA/DADOS/fca_cia_aberta_2025.zip': old } }));
    assert.equal(r2.exitCode, 0, JSON.stringify(r2.results));
    const t2 = JSON.parse(fs.readFileSync(path.join(dir2, 'br.json'), 'utf8')).tickers;
    assert.deepEqual(t2, { 'BBAS3.SA': { cnpj: BANK, cls: 'ON' }, 'WEGE3.SA': { cnpj: WEG, cls: 'ON' } });
    const r3 = await run(tmpDir(), cvm({ files: { 'FCA/DADOS/fca_cia_aberta_2025.zip': undefined } }));
    assert.equal(r3.exitCode, 1, 'the previous year FCA must exist');
  });

  await t('zeros are no values: a consolidated DRE of zeros falls back to the individual one (TIM DFP 2025)', async () => {
    const dir = tmpDir();
    const p = 'dfp_cia_aberta_';
    const tim = makeZip({
      [p + '2025.csv']: csv(IDX, [idx(WEG, '2025-12-31', 1, 'DFP', '7', '2026-02-20')]),
      [p + 'DRE_con_2025.csv']: csv(DRE, [row(WEG, '2025-12-31', 1, 'ÚLTIMO', '2025-01-01', '2025-12-31', '3.01', '0.0000000000'),
        row(WEG, '2025-12-31', 1, 'ÚLTIMO', '2025-01-01', '2025-12-31', '3.11', '0.0000000000')]),
      [p + 'DRE_ind_2025.csv']: csv(DRE, [row(WEG, '2025-12-31', 1, 'ÚLTIMO', '2025-01-01', '2025-12-31', '3.01', '26624721'),
        row(WEG, '2025-12-31', 1, 'ÚLTIMO', '2025-01-01', '2025-12-31', '3.11', '4311984'),
        row(WEG, '2025-12-31', 1, 'ÚLTIMO', '2025-01-01', '2025-12-31', '3.03', '')]),
      [p + 'DFC_MI_con_2025.csv']: csv(DRE, []), [p + 'DFC_MD_con_2025.csv']: csv(DRE, []),
      [p + 'DFC_MI_ind_2025.csv']: csv(DRE, []), [p + 'DFC_MD_ind_2025.csv']: csv(DRE, []), [p + 'composicao_capital_2025.csv']: csv(CAP, []),
    });
    const r = await run(dir, cvm({ files: { 'DFP/DADOS/dfp_cia_aberta_2025.zip': tim } }));
    assert.equal(r.exitCode, 0, JSON.stringify(r.results));
    const o = JSON.parse(fs.readFileSync(path.join(dir, 'br.json'), 'utf8')).companies[WEG].docs['DFP 2025-12-31'][0];
    assert.equal(o.basis, 'ind');
    assert.deepEqual(o.values, { '3.01 2025-01-01': 26624721000, '3.11 2025-01-01': 4311984000 }, 'the empty 3.03 is a gap, not 0');
    assert.equal(r.results[0].badNumbers, 1);
  });

  await t('zeros are no values: niParent 0 next to a real 3.11 is missing; one zero leg derives nothing (Azul Q4 2025)', () => {
    const o = (rec, values, label = 'Receita de Venda de Bens e/ou Serviços') => [{ received: rec, basis: 'con', revenueLabel: label, values }];
    const q = S.brSingleQuarters({ docs: {
      'ITR 2025-09-30': o('2025-11-13', { '3.11 2025-01-01': -1755161000, '3.11.01 2025-01-01': 0, '3.01 2025-01-01': 0 }),
      'DFP 2025-12-31': o('2026-03-10', { '3.11 2025-01-01': 124858000, '3.11.01 2025-01-01': 124858000, '3.01 2025-01-01': 20000000000 }),
    } });
    assert.equal(q['2025-12-31'].niParent, undefined, 'not the whole year as a quarter (+124.9 m)');
    assert.equal(q['2025-12-31'].ni.value, 124858000 + 1755161000);
    assert.equal(q['2025-12-31'].rev, undefined, 'nine months of 0 against a real year: not derivable');
    const intb = S.brSingleQuarters({ docs: {
      'ITR 2026-03-31': o('2026-05-05', { '3.11 2026-01-01': 150000000, '3.11.01 2026-01-01': 150000000 }),
      'ITR 2026-06-30': o('2026-08-04', { '3.11 2026-01-01': 308300000, '3.11 2026-04-01': 158300000,
        '3.11.01 2026-01-01': -3400000, '3.11.01 2026-04-01': 0 }),
    } });
    assert.equal(intb['2026-06-30'].niParent, undefined, 'a filed 0 next to a real 3.11 is missing, and no YTD difference (-153.4 m) stands in for it');
    assert.equal(intb['2026-06-30'].ni.value, 158300000);
    assert.equal(intb['2026-03-31'].niParent.value, 150000000);
    const fin = S.brSingleQuarters({ docs: { 'ITR 2026-06-30': o('2026-08-12', { '3.01 2026-04-01': 5, '3.11 2026-04-01': 1 }, 'Receitas da Intermediação Financeira') } });
    assert.deepEqual(fin, {}, 'the financial DRE scheme gives no quarters');
  });

  await t('dry run fetches and checks but writes nothing', async () => {
    const dir = tmpDir();
    const r = await run(dir, cvm(), '2026-11-07T15:00:00Z', { dryRun: true });
    assert.equal(r.exitCode, 0, JSON.stringify(r.results));
    assert.equal(r.results[0].written, false);
    assert.ok(r.results[0].docs > 0);
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  await t('a zip without an expected entry aborts', async () => {
    const dir = tmpDir();
    const r = await run(dir, cvm({ files: { 'DFP/DADOS/dfp_cia_aberta_2025.zip': makeZip({ 'dfp_cia_aberta_2025.csv': csv(IDX, []) }) } }));
    assert.equal(r.exitCode, 1);
    assert.match(r.results[0].aborted, /entry dfp_cia_aberta_DRE_con_2025\.csv missing/);
  });

  await t('br-shadow-report: one rate per pull makes the comparison currency-neutral; categories', () => {
    const store = { tickers: { 'WEGE3.SA': { cnpj: WEG, cls: 'ON' } }, companies: { [WEG]: { docs: {
      'ITR 2026-06-30': [{ received: '2026-07-22', basis: 'con', revenueLabel: 'Receita de Venda de Bens e/ou Serviços', values: { '3.01 2026-04-01': 10143555000, '3.03 2026-04-01': 0, '3.11 2026-04-01': 1600000000, '3.11.01 2026-04-01': 1558636300 } }],
      'ITR 2026-09-30': [{ received: '2026-10-21', basis: 'con', values: { '3.01 2026-07-01': 10500000000 } }],
      'ITR 2025-09-30': [{ received: '2025-10-22', basis: 'con', values: { '3.01 2025-07-01': 9000000000 } }],
      'ITR 2025-06-30': [{ received: '2025-07-23', basis: 'con', values: { '3.01 2025-04-01': 5000000000 } }],
    } } } };
    const snap = { meta: { ticker: 'WEGE3.SA', reportingCurrency: 'USD', reportingCurrencyOriginal: 'BRL', fxConverted: true, fxRateApplied: 0.19428794 },
      timeseries: { revenueQ: [{ value: 1970770405.2266998 }, { value: 1839579028 }, { value: 1983141106.94238 }], revenueQEnds: ['2026-06-30', '2025-12-31', '2025-06-30'],
        netIncomeQ: [{ value: 302823594 }], netIncomeQEnds: ['2026-06-30'], grossProfitQ: [{ value: 655250649 }], grossProfitQEnds: ['2026-06-30'] } };
    const r = compareTicker(snap, store, 0.01);
    const cat = (field, end) => r.cells.find((c) => c.field === field && c.end === end).cat;
    assert.equal(cat('revenueQ', '2026-06-30'), 'agree');
    assert.equal(cat('revenueQ', '2026-09-30'), 'cvm-newer');
    assert.equal(cat('revenueQ', '2025-09-30'), 'cvm-only', 'the gap inside the Yahoo span');
    assert.equal(cat('revenueQ', '2025-12-31'), 'yahoo-only');
    assert.equal(cat('revenueQ', '2025-06-30'), 'disagree');
    assert.equal(cat('netIncomeQ', '2026-06-30'), 'agree', 'Yahoo net income is the parent owners part (3.11.01), not 3.11 with minorities');
    assert.equal(cat('grossProfitQ', '2026-06-30'), 'cvm-zero');
    assert.match(compareTicker({ meta: { ...snap.meta, ticker: 'XXXX3.SA' } }, store, 0.01).unchecked, /not in the CVM ticker map/);
    assert.match(compareTicker({ meta: { ...snap.meta, reportingCurrencyOriginal: 'USD', reportingCurrency: 'USD' } }, store, 0.01).unchecked, /statement currency USD/);
    assert.match(compareTicker({ ...snap, meta: { ...snap.meta, statementCurrencyOriginal: 'USD', statementFxRateApplied: 1 } }, store, 0.01).unchecked,
      /statement series in USD \(hand table\)/, 'Petrobras, Embraer, Vale: USD series from SEC filings');
    const bank = { tickers: { 'BBAS3.SA': { cnpj: BANK, cls: 'ON' } }, companies: { [BANK]: { docs: { 'ITR 2026-06-30': [{ received: '2026-08-12', basis: 'con',
      revenueLabel: 'Receitas de Intermediação Financeira', values: { '3.01 2026-04-01': 5 } }] } } } };
    assert.match(compareTicker({ ...snap, meta: { ...snap.meta, ticker: 'BBAS3.SA' } }, bank, 0.01).unchecked, /financial DRE scheme/);
  });

  await t('shadow guarantee: no code outside the BR pass and its report opens br.json; loadStores reads cn and tw only', () => {
    const allowed = new Set(['scripts/fetch-exchange-quarters.js', 'scripts/br-shadow-report.js', 'tests/fetch-exchange-quarters-br.test.js']);
    const hits = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const rel = d ? d + '/' + e.name : e.name;
        if (e.isDirectory()) { if (!/^(node_modules|\.git|snapshots|prices-max|board-history|picks-history|data-cache|external-data|tests\/fixtures)$/.test(rel)) walk(rel); continue; }
        if (!/\.(js|cjs|mjs|ya?ml)$/.test(e.name) || allowed.has(rel)) continue;
        // a file NAME in code ('br.json', or 'br' + '.json'), not prose: comments may describe the store
        if (/['"`]br\.json['"`]|['"`]br['"`]\s*\+\s*['"`]\.json/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8'))) hits.push(rel);
      }
    };
    walk('');
    assert.deepEqual(hits, [], 'br.json is read somewhere: the store is no longer a shadow, this needs the formula path first');
    const X = require('../lib/exchange-quarter-check.js');
    const withBr = tmpDir();
    fs.writeFileSync(path.join(withBr, 'br.json'), JSON.stringify({ schemaVersion: 1, market: 'BR', currency: 'BRL', companies: {}, sources: {} }));
    assert.deepEqual(Object.keys(X.loadStores(withBr)).sort(), ['cn', 'tw', 'warnings'], 'an existing br.json is not loaded');
  });

  await t('the live stores are untouched', () => {
    assert.deepEqual(['cn', 'tw', 'br'].map((m) => sha(path.join(LIVE_DIR, m + '.json'))), liveBefore);
  });

  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
