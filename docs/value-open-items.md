# Value open-items list (Tag 1398)

Guide for the AI daily run. The list is worked by the AI daily run, never by the owner's chat.

## What it is

`data-health/value-open-items.json` names every company and field whose stored value moved by
more than factor 3 against its last accepted value. It is written only by the daily workflow step
"Value open-items (factor 3, sticky)" (`scripts/value-open-items.js`, rules in
`lib/value-open-items.js`). It changes no board number, score, rank, threshold or exit code; the
step has `continue-on-error` and runs after the screener, before "Build findash-export v1". The
commit step commits the file together with the vintage.

Compared values, all in stored units (USD, as in `board-history/<date>/<board>.json` `pit`):

| field | key | source |
|---|---|---|
| `revenueQ` | ticker + period end (`pit.revenueQEnds`) | quarterly revenue |
| `grossProfitQ` | ticker + period end (`pit.grossProfitQEnds`) | quarterly gross profit |
| `marketCap` | ticker | market cap |

A cell **opens** when the comparison value b is > 0 and today's value v is either 0 or
`max(v/b, b/v) > 3` (strictly; exactly 3.0 does not open). Not a hit: v missing (coverage is a
separate check), v negative (sign change), a key never seen before (new period, new company).

The comparison value b ("last accepted value") is, in this order:
1. the cell's `acceptedValue` while it sits in an OPEN item. This is sticky: the next day is
   compared with the same accepted value again, so a wrong value never becomes the new normal;
2. otherwise the most recent value > 0 of the key in ANY earlier stored vintage that is not
   globally excluded (`board-history/_excluded.json`) and not structurally flagged
   (`gate.structural`). A value that returns after an absence is therefore compared (XVALO.MC,
   absent 17.09. to 29.09., back on 30.09. about 5.1x higher);
3. but when the key's last item was closed on or after that day, the value it had at the close
   (`closedValue`): a close accepts what it saw (also a 0, for example a quarantined series).

Stored days the list has not seen yet (`updatedFor` is older than the newest stored day) are
replayed first, so a missed run loses no transition.

## Reading the file

```
{ "schema": "value-open-items/v1", "factor": 3, "updatedFor": "YYYY-MM-DD",
  "items": [ { "id": "<ticker>|<field>|<firstSeen>", "company", "board", "field",
               "periodEnd", "acceptedValue", "newValue", "factor",      <- headline cell
               "firstSeen", "lastSeen",
               "cells": [ { "periodEnd", "acceptedValue", "acceptedFrom", "newValue", "factor",
                            "firstSeen", "lastSeen", "closedValue"?,
                            "acceptedShares"?, "newShares"? } ],      <- marketCap only
               "labels": [...], "status": "open|closed", "closedBy", "closedAt" } ] }
```

- One item per company and field. A further jumping quarter of the same company and field joins
  the open item as a new cell.
- The headline fields describe the cell with the largest factor at the time the item opened.
- `factor` is `null` when the new value is 0. `newValue`, `factor` and `lastSeen` show the last
  day the value was still more than factor 3 away; `acceptedFrom` is the stored day (or
  `acceptance:<n>`) the accepted value came from.
- Append-only: items are never removed; `id`, `company`, `field`, `firstSeen`, `acceptedValue` and
  every cell's `periodEnd`, `acceptedValue`, `firstSeen` never change; a closed item never reopens
  (a new item opens instead). The step throws and writes nothing if that would break.
- `"seed": "replay"` marks the one-time seed (see below); the first live run drops it.

## Labels (they describe, they never close)

| label | meaning |
|---|---|
| `korrigiert-von-uns` | the company (or a listing alias) has a row in one of our hand tables: `configs/financial-known-cases.json` (cases, coverage, quarantines), `configs/ads-hand-table.json`, `configs/share-count-hand-table.json`, `configs/statement-currency-hand-table.json`, `configs/yahoo-q4-known-cases.json`. Often our own repair moved the value (a correction, not an error). |
| `kapitalmassnahme` | marketCap item whose vendor share count (`pit.sharesOutstanding`) moved by the same factor (within 5 %): split, bonus shares, reverse split. Not computable while the accepted value's vintage has no share count (vintages before Tag 1398); the step logs that. |
| `zurueckgekehrt` | every cell is back within factor 3 of its accepted value today. The item stays open. |
| `nicht-auf-board` | the company is not on any board today. |

## Closing an item

An item closes only when EVERY cell is covered, by one of:

1. **A hand-table row** (the preferred way when the value is wrong):
   - a `configs/financial-known-cases.json` case for the company (ticker or listing alias), the
     item's field and the cell's period end (`revenueQ`/`grossProfitQ`);
   - a quarantine in the same file for the company: covers every item of the company;
   - for a `marketCap` item: a row for the ticker in `configs/ads-hand-table.json` or
     `configs/share-count-hand-table.json`.
   `closedBy` then reads `hand-table:<caseId>`, `hand-table:quarantine:<caseId>`,
   `hand-table:ads:<ticker>` or `hand-table:shares:<ticker>`.
2. **An acceptance entry** (when the new value is right, or the move is explained): append to
   `data-health/value-acceptances.json` through the normal PR flow of the AI daily run. Never
   edit or remove an existing entry. Shape (illustrative values, not a real acceptance):

```json
{ "itemId": "JBS|marketCap|2026-08-18", "value": 14400000000, "acceptedAt": "2026-10-06",
  "by": "AI daily run", "reason": "Issuer count 1,070,929,187 shares x close 13.45 USD (10-Q cover page)",
  "sources": [ { "url": "https://www.sec.gov/...", "quote": "776,086,920 Class A common shares" } ] }
```

   - `itemId`, `value` (> 0, stored units), `acceptedAt` (YYYY-MM-DD, the day of the review) and
     `reason` are required; `periodEnd` is optional (absent = every cell of the item; give it for
     multi-quarter items, one entry per cell).
   - An entry covers only cells whose `firstSeen` is on or before its `acceptedAt`. A quarter that
     joins the item later was never reviewed and needs its own entry.
   - If today's value is within factor 3 of `value`, the item closes (`closedBy: acceptance:<n>`,
     n = 1-based position in the file). Otherwise it closes AND a new item opens with
     `acceptedValue = value`, so a vendor that flips back is caught again.
   - If the company is not on a board on the day the entry is applied, the item closes with
     `closedValue = value`; when the company returns, its value is compared with `value`.
   - A value of 0 cannot be accepted. A real zero (for example revenue that really stopped) is
     closed with a `configs/financial-known-cases.json` row for that quarter.
   - An unknown `itemId` or a malformed entry gives a `::warning::` and is ignored, never a crash.

Never closed by time, by a label, or by the value returning (that only adds `zurueckgekehrt`).

## Daily triage (AI daily run)

1. Read `items` with `status: "open"`, newest `lastSeen` first.
2. Per item decide with a primary source (filing, exchange notice): wrong value -> hand-table row
   (financial-known-cases, ADS or share-count table, own PR with the usual review); right value
   or explained move (split, restatement, our own repair) -> acceptance entry with the source.
3. Labels help sort: `korrigiert-von-uns` and `kapitalmassnahme` are usually acceptances;
   unlabelled items are the likely real errors.

## Exit codes and run time

- Exit 0: written. Exit 1: unreadable input (state file, acceptances, a hand table, a stored or
  today's board file) or an append-only violation; nothing is written, the step is red but the
  run continues.
- One `::warning::VALUE OPEN-ITEMS <date>: <n> open (<new> new, <closed> closed today)` line per run.
- The step re-reads every stored vintage (about 1.5 s for 28 days locally). Once it nears 60 s,
  keep a last-seen index inside the state file instead (marked `ponytail:` in the script).

## Seed

The committed list was seeded once by replaying the step over all stored, not globally excluded
vintages from 2026-08-05 with the hand tables of the seed commit:

```
node scripts/value-open-items.js --replay --from 2026-08-05 --to 2026-10-01
```

`seedInputs` records the command and a fingerprint of the hand tables and the acceptances file.
`tests/value-open-items.test.js` re-runs the replay on the stored history and compares it with the
committed seed while the file is still the seed and the fingerprint matches; otherwise it skips
visibly.

## Owner-facing wording (for the findash marking in PR3)

Deutsch, für den markierten Wert:

> Dieser Wert ist markiert, weil er sich gegenüber dem zuletzt geprüften Stand um mehr als das Dreifache verändert hat (vorher {vorher}, jetzt {jetzt}, seit {seit}). Die Zahl bleibt sichtbar und fließt weiter in die Berechnung ein, bis wir sie geprüft haben. Die Markierung verschwindet erst, wenn die Zahl mit einer Quelle bestätigt oder korrigiert ist, nicht von selbst.
