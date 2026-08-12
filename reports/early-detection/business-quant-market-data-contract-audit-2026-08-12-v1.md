# Business Quant market-data contract audit — 2026-08-12

## Decision

**SUPPLEMENTAL_PILOT_CANDIDATE_NOT_ORIGINAL_V4_GATE_ELIGIBLE**

Business Quant is a genuinely new no-cost candidate for event dates and a
row-level terminal-session cross-check. It is not a complete replacement for
the sealed Original-V4 market-data contract. No account was created, no API
key was obtained, no terms were accepted, no vendor data row was accessed and
no outcome was read or computed.

## Official documentation reviewed

- API overview: <https://businessquant.com/docs/api/>
- Universe: <https://businessquant.com/docs/api/universe>
- Stock profile: <https://businessquant.com/docs/api/stocks-profile>
- Quotes: <https://businessquant.com/docs/api/quotes>
- Corporate actions: <https://businessquant.com/docs/api/corporate-actions>
- Dividends: <https://businessquant.com/docs/api/dividends>
- Pricing and free-tier limits: <https://businessquant.com/pricing>
- Terms of use: <https://businessquant.com/terms-of-use>

This is a documentation-contract audit, not a captured-data validation. The
provider documentation is current web content and was not treated as a
historical point-in-time observation.

## Five missing Original-V4 semantics

| Required semantic | Verdict | Reason |
| --- | --- | --- |
| Historical validity intervals | NOT CLOSED | Universe/profile expose current identifiers and first/last price dates, but no versioned `valid_from`/`valid_to` ticker, security and exchange intervals. |
| Consolidated adjusted OHLCV | NOT CLOSED | Quotes document raw daily OHLCV. The documented action workflow requires users to calculate split adjustments; no complete factor chain or stable-security binding is supplied. |
| Complete corporate actions | PARTIAL ONLY | The endpoint documents splits, dividends, mergers, acquisitions, spin-offs, bankruptcies and delistings, but important merger/delisting values may be null and complete universal time coverage is not warranted. |
| Observed terminal sessions | CONDITIONAL ROW-LEVEL CANDIDATE | A delisted profile's `lastpricedate` can be reconciled with the maximum completed EOD quote, but a missing final bar is not proof of a terminal session and identity must be established independently. |
| Delisting returns/final payments | NOT CLOSED | No CRSP-style delisting return, liquidation recovery or normalized cash/stock merger consideration is documented. A delisting date and last quote do not establish terminal wealth. |

## Access, scale and reproducibility boundary

- The free plan is documented as USD 0 with 30 calls per day and 0.1 GB per
  month, but access requires registration and an API key.
- At 5,780 distinct candidate tickers, one profile call per ticker alone would
  require at least 193 perfect 30-call days. Quotes are additionally paginated.
- The terms permit API use for internal analysis but restrict systematic web
  scraping, substantial database extraction and redistribution. A complete
  reproducibility corpus therefore needs written clearance before productive
  bulk acquisition.
- A browser or Playwright session is not an alternative acquisition channel:
  the provider documents the API as the authorized automated path.

## Three-agent adversarial review

- METHOD audit: browser/chart extraction cannot establish a survivorship-safe
  security master, point-in-time adjustment policy or terminal payment.
- DATA audit: Business Quant can enrich corporate-action dates and may confirm
  a terminal session row by row, but it closes none of the five semantics for
  the complete 2009–2024 universe.
- COUNTEREXAMPLE audit: a delisting row with a final quote but null event value
  leaves the investor's terminal return indeterminate; this defeats Original-V4
  eligibility even when the remaining endpoints agree.

All three reviews are Codex-agent audits, not HUMAN attestations.

## Allowed next use

Revisit only if Karl explicitly authorizes creation of a free account and the
provider's terms are accepted for a small private pilot, or if the provider
offers a no-account/public snapshot with durable reproduction rights. Any
pilot must remain a separate coverage-bounded AI-amended track, must be sealed
before outcome access and may not be described as Full-Market,
survivorship-safe, H-LATE or H-FEM evidence.

## Outcome lock

- `originalV4OfficialGatesGreen = 2/13`
- `resultComputationAllowed = false`
- `outcomesAccessed = false`
- `productiveGqsModified = false`
- `humanAttestation = false`

