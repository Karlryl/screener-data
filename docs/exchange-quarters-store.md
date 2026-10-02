# Exchange-quarters store (Tag 1399)

Append-only record of revenue as printed by exchange-fed sources, kept for the pair guard and the
gap fill of the next step (G2b). **Nothing reads it yet**: scoring, exports, board history and the
pull are unchanged, no board number can move through it.

| File | Source | Content |
|---|---|---|
| `external-data/exchange-quarters/cn.json` | Eastmoney `RPT_F10_FINANCE_GINCOME` (general companies) and `RPT_F10_FINANCE_SINCOME` (securities firms), whole market per period, filtered to `watchlist.json` | Year-to-date revenue in yuan as printed: `total` = `TOTAL_OPERATE_INCOME`, `operate` = `OPERATE_INCOME`, `reportType` (一季报/中报/三季报/年报), `noticeDate` |
| `external-data/exchange-quarters/tw.json` | MOPS `POST https://mops.twse.com.tw/mops/api/t164sb04`, one company and season per call | The row `營業收入合計` (or `收益合計` for securities/futures firms) with the printed column titles, in thousand TWD |

Writer: `scripts/fetch-exchange-quarters.js`, run by `.github/workflows/exchange-quarters.yml`
(daily 13:47 UTC; branch runs are dry runs). Precedent for storing Eastmoney data:
`scripts/build-cnannual.js` lines 19-21 (owner decision of 19.08.2026). Banks and insurers are
not stored (their tables are not verified). The legacy host `mopsov.twse.com.tw` (robots
`Disallow: /`) is never called.

## Shape

```
{ "schemaVersion": 1, "market": "CN", "currency": "CNY", "unit": 1, "about": "...",
  "sources":   { "cn-20261002T070000Z": { "fetchedAt", "endpoint", "periods", "calls", "requests": [...] } },
  "companies": { "600064.SS": { "secucode": "600064.SH",
      "ytd": { "2025-09-30": [ { "table": "GINCOME", "orgType": "通用", "reportType": "三季报",
                 "total": 2399700641.02, "operate": 2399700641.02, "noticeDate": "2025-10-31",
                 "confirmedBy":  [ { "src", "fetchedAt", "updateDate": "2025-10-31" } ],
                 "lastConfirmed": { "src", "fetchedAt", "updateDate" } } ] } } } }
```

Taiwan: `companies["6446.TW"] = { companyId, seasons: { "114Q3": [ { reportType, line,
columns: [["114年第3季", 3893772], ...], confirmedBy, lastConfirmed } ] }, noData: { "115Q3": { at, code } } }`.

## Rules

- **Append-only.** Same numbers again: no new observation; a confirmation is appended only when
  Eastmoney's `UPDATE_DATE` changes (one confirmation per fetch would add about 2.4 MB per China
  run), `lastConfirmed` records the newest fetch that returned these numbers. Different numbers:
  a new observation is appended (restatement signal). Nothing is removed; `assertAppendOnly`
  checks the new file against the old one before every atomic write. `noData` is bookkeeping for
  the Taiwan queue and not part of the guarantee.
- **Windows.** China: the 7 quarter ends before today plus the fiscal-year end before the oldest
  (02.10.2026: 2024-12-31 .. 2026-09-30). Taiwan: the 5 quarter ends before today as MOPS seasons;
  a season is first asked 25 days after its quarter end.
- **Cadence and caps.** China: daily in the report seasons 15.03.-05.05., 15.07.-05.09.,
  15.10.-20.11., at most every 6 days otherwise; cap 150 calls. Taiwan: never-fetched keys (board
  rows first, then rows with quarter gaps), then the newest season of each company every 7 days;
  cap 600 calls; pause 1.5 s per host.
- **Failure.** China: any odd answer aborts the market without writing. Taiwan: 406 (not filed)
  waits 3 days, no revenue line waits 30 days, other failures are skipped and counted; 10 in a row
  or more than 20 % abort without writing. Exit code 1 on any abort.

## Derivation helpers (`lib/exchange-quarter-store.js`)

`chinaSingleQuarters` (YTD -> single quarter with the 一季报 -> 中报 -> 三季报 -> 年报 chain check;
anything else = unchecked), `taiwanSeasonValues` (column titles checked per season: season 1 is
`[YTD, quarter, prior YTD, prior quarter]`, seasons 2-3 `[quarter, prior quarter, YTD, prior YTD]`,
season 4 `[FY, prior FY]`; YTD must start on 01-01), `taiwanSingleQuarters` (Q4 = FY - 9M, TWD).
Not wired into `prepareSnapshot`.
