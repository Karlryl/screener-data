/**
 * Test Fixtures for v7.3 Engine
 * ============================
 *
 * Each fixture is a canonicalInput object. Values are realistic approximations
 * based on public data circa Q1-Q2 2026. Used to:
 *   - Verify engine produces expected sub-profile classification
 *   - Verify scoring produces expected bucket (A/B/INFLECTION/OUT)
 *   - Catch regressions when engine logic changes
 *
 * NOTE: These are NOT live data. Do NOT use for actual decisions.
 *       For investment, use the live screener with current Yahoo+Aktienfinder data.
 *
 * Karl's actual watchlist included: CRDO, ALAB, NVO, NVDA, Rheinmetall.
 * Plus generic high-coverage stocks: PLTR, ASML, MSFT, META, MNDY.
 */

const fxRates = {
  EUR_USD: 1.07,
  USD_EUR: 0.935,
  DKK_USD: 0.143,
  USD_DKK: 6.99,
  GBP_USD: 1.27
};

// Tag 220 (audit F-220a-02 HIGH fix): fixtures hard-coded `fetchedAt:
// '2026-04-30'`. The engine's 120-day stale-data gate would turn the
// entire fixture suite UNCLASSIFIABLE on ~2026-08-28, silently breaking
// the engine-cli-tests pre-pull guard and the daily Yahoo pull with no
// code change. Compute fetchedAt dynamically as today − 30d so the
// fixtures stay perpetually 30 days old (well inside the 120-day cap).
const _FIXTURE_FETCHED_AT = (() => {
  const d = new Date(Date.now() - 30 * 86400 * 1000);
  return d.toISOString().slice(0, 10);
})();

// Helper to build a metric in canonical form
const m = (value, currency, confidence = 0.85) => value == null
  ? null
  : { value, currency, source: 'fixture', confidence, asOf: _FIXTURE_FETCHED_AT };

const pct = (v, c = 0.85) => v == null ? null : { value: v, source: 'fixture', confidence: c, asOf: _FIXTURE_FETCHED_AT };

// Quarterly series builder: [oldest, ..., newest]
const tsRev = (arr, cur) => arr.map(v => ({ value: v, currency: cur, source: 'fixture', confidence: 0.85 }));

// Annual series: [newest, ..., oldest] (Yahoo convention)
const annual = (arr, cur) => arr.map(v => ({ value: v, currency: cur, source: 'fixture', confidence: 0.8 }));

const fixtures = [

  // ─────────────────────────────────────────────────────────────
  // CRDO — Credo Technology Group (Hyper-growth Hardware/Semis)
  // Q1 2026: AI-Datacenter-Connectivity Boom
  // ─────────────────────────────────────────────────────────────
  {
    expected: { subProfile: 'HARDWARE', track: 'A', bucketAtLeast: 'INFLECTION', actionStatus: 'QUALIFIED' },
    canonical: {
      identifier: { primary: 'TICKER', value: 'CRDO' },
      meta: { ticker: 'CRDO', name: 'Credo Technology Group', sector: 'Technology',
              industry: 'Semiconductors', region: 'US', reportingCurrency: 'USD',
              fetchedAt: _FIXTURE_FETCHED_AT },
      marketCap: m(15e9, 'USD'),
      metrics: {
        revenueTTM: m(900e6, 'USD'),
        revenueGrowthYoY: pct(180),  // +180% YoY at AI-boom peak
        grossMargin: pct(64),
        operatingMargin: pct(20),
        fcfMarginTTM: pct(15),
        priceSales: pct(16),
        sbcRatio: pct(18),
        forwardPE: pct(60)
      },
      timeseries: {
        revenueQ: tsRev([60, 90, 130, 200, 280, 350], 'USD'),       // 6Q
        grossProfitQ: tsRev([38, 58, 84, 130, 180, 224], 'USD'),
        opIncQ: tsRev([5, 12, 25, 50, 85, 115], 'USD')
      },
      annual: {
        annualRev: annual([900e6, 320e6, 110e6], 'USD'),  // 3Y
        annualOpInc: annual([180e6, 30e6, -10e6], 'USD'),
        annualGP: annual([576e6, 200e6, 65e6], 'USD'),
        annualNetIncome: annual([135e6, 15e6, -20e6], 'USD'),
        annualFCF: annual([135e6, -5e6, -15e6], 'USD'),
        annualBalance: []  // Track B not applicable
      },
      external: { aktienfinderScore: { value: 5, source: 'aktienfinder', confidence: 0.6 } }
    }
  },

  // ─────────────────────────────────────────────────────────────
  // ALAB — Astera Labs (Hyper-growth Hardware, IPO 2024)
  // ─────────────────────────────────────────────────────────────
  {
    expected: { subProfile: 'HARDWARE', track: 'A', bucketAtLeast: 'B', actionStatus: 'QUALIFIED' },
    canonical: {
      identifier: { primary: 'TICKER', value: 'ALAB' },
      meta: { ticker: 'ALAB', name: 'Astera Labs', sector: 'Technology',
              industry: 'Semiconductors', region: 'US', reportingCurrency: 'USD',
              fetchedAt: _FIXTURE_FETCHED_AT },
      marketCap: m(12e9, 'USD'),
      metrics: {
        revenueTTM: m(700e6, 'USD'),
        revenueGrowthYoY: pct(120),
        grossMargin: pct(76),
        operatingMargin: pct(15),
        fcfMarginTTM: pct(12),
        priceSales: pct(17),
        sbcRatio: pct(22),
        forwardPE: pct(70)
      },
      timeseries: {
        revenueQ: tsRev([45, 80, 120, 170, 210, 250], 'USD'),
        grossProfitQ: tsRev([34, 60, 92, 130, 160, 190], 'USD'),
        opIncQ: tsRev([3, 8, 18, 35, 50, 65], 'USD')
      },
      annual: {
        annualRev: annual([700e6, 250e6], 'USD'),  // only 2Y data — insufficient for Track B
        annualOpInc: annual([105e6, 20e6], 'USD'),
        annualGP: annual([530e6, 175e6], 'USD'),
        annualFCF: annual([85e6, -5e6], 'USD'),
        annualBalance: []
      },
      external: { aktienfinderScore: null }
    }
  },

  // ─────────────────────────────────────────────────────────────
  // NVO — Novo Nordisk (Quality Healthcare Compounder)
  // ─────────────────────────────────────────────────────────────
  {
    expected: { subProfile: 'HEALTHCARE', track: 'B', bucketAtLeast: 'B', actionStatus: 'QUALIFIED' },
    canonical: {
      identifier: { primary: 'ISIN', value: 'DK0062498333' },
      meta: { ticker: 'NVO', name: 'Novo Nordisk', sector: 'Healthcare',
              industry: 'Drug Manufacturers', region: 'EU', reportingCurrency: 'DKK',
              fetchedAt: _FIXTURE_FETCHED_AT },
      marketCap: m(450e9, 'USD'),  // already converted in input
      metrics: {
        revenueTTM: m(265e9, 'DKK'),
        revenueGrowthYoY: pct(22),
        grossMargin: pct(83),
        operatingMargin: pct(45),
        fcfMarginTTM: pct(33),
        priceSales: pct(11),
        sbcRatio: pct(2),
        forwardPE: pct(28)
      },
      timeseries: {
        revenueQ: tsRev([55, 60, 65, 68, 70, 72], 'DKK').map(x => ({ ...x, value: x.value * 1e9 })),
        grossProfitQ: tsRev([46, 50, 54, 56, 58, 60], 'DKK').map(x => ({ ...x, value: x.value * 1e9 })),
        opIncQ: tsRev([26, 28, 30, 31, 32, 33], 'DKK').map(x => ({ ...x, value: x.value * 1e9 }))
      },
      annual: {
        annualRev: annual([265e9, 215e9, 175e9, 140e9, 122e9], 'DKK'),
        annualOpInc: annual([119e9, 95e9, 75e9, 60e9, 50e9], 'DKK'),
        annualGP: annual([220e9, 175e9, 145e9, 115e9, 100e9], 'DKK'),
        annualNetIncome: annual([95e9, 73e9, 56e9, 45e9, 38e9], 'DKK'),
        annualFCF: annual([90e9, 70e9, 50e9, 40e9, 35e9], 'DKK'),
        annualBalance: [
          { totalEquity: 100e9, longTermDebt: 30e9, shortTermDebt: 5e9, cash: 25e9 },
          { totalEquity: 90e9,  longTermDebt: 28e9, shortTermDebt: 4e9, cash: 22e9 },
          { totalEquity: 80e9,  longTermDebt: 25e9, shortTermDebt: 4e9, cash: 20e9 },
          { totalEquity: 70e9,  longTermDebt: 22e9, shortTermDebt: 3e9, cash: 18e9 },
          { totalEquity: 65e9,  longTermDebt: 20e9, shortTermDebt: 3e9, cash: 15e9 }
        ]
      },
      external: { aktienfinderScore: { value: 7, source: 'aktienfinder', confidence: 0.7 } }
    }
  },

  // ─────────────────────────────────────────────────────────────
  // NVDA — NVIDIA (Cross-Profile: Hyper-growth + Quality)
  // ─────────────────────────────────────────────────────────────
  {
    expected: { subProfile: 'HARDWARE', track: 'A', bucketAtLeast: 'A', actionStatus: 'QUALIFIED', isCrossProfile: true },
    canonical: {
      identifier: { primary: 'TICKER', value: 'NVDA' },
      meta: { ticker: 'NVDA', name: 'NVIDIA', sector: 'Technology',
              industry: 'Semiconductors', region: 'US', reportingCurrency: 'USD',
              fetchedAt: _FIXTURE_FETCHED_AT },
      marketCap: m(2800e9, 'USD'),
      metrics: {
        revenueTTM: m(120e9, 'USD'),
        revenueGrowthYoY: pct(85),
        grossMargin: pct(75),
        operatingMargin: pct(60),
        fcfMarginTTM: pct(48),
        priceSales: pct(23),
        sbcRatio: pct(4),
        forwardPE: pct(35)
      },
      timeseries: {
        revenueQ: tsRev([18e9, 22e9, 26e9, 30e9, 34e9, 38e9], 'USD'),
        grossProfitQ: tsRev([13e9, 16e9, 19e9, 22e9, 25e9, 28e9], 'USD'),
        opIncQ: tsRev([10e9, 12e9, 15e9, 18e9, 21e9, 23e9], 'USD')
      },
      annual: {
        annualRev: annual([120e9, 60e9, 27e9, 27e9, 16e9], 'USD'),
        annualOpInc: annual([72e9, 32e9, 4e9, 10e9, 4e9], 'USD'),
        annualGP: annual([90e9, 45e9, 17e9, 17e9, 10e9], 'USD'),
        annualNetIncome: annual([60e9, 30e9, 4e9, 9e9, 4e9], 'USD'),
        annualFCF: annual([56e9, 27e9, 4e9, 8e9, 4e9], 'USD'),
        annualBalance: [
          { totalEquity: 65e9, longTermDebt: 9e9, shortTermDebt: 1e9, cash: 26e9 },
          { totalEquity: 42e9, longTermDebt: 9e9, shortTermDebt: 1e9, cash: 17e9 },
          { totalEquity: 26e9, longTermDebt: 11e9, shortTermDebt: 1e9, cash: 13e9 },
          { totalEquity: 26e9, longTermDebt: 11e9, shortTermDebt: 1e9, cash: 22e9 },
          { totalEquity: 17e9, longTermDebt: 6e9, shortTermDebt: 0,    cash: 11e9 }
        ]
      },
      external: { aktienfinderScore: { value: 8, source: 'aktienfinder', confidence: 0.7 } }
    }
  },

  // ─────────────────────────────────────────────────────────────
  // RHM.DE — Rheinmetall (Industrial / Defense, EUR)
  // Tests Industrial sub-profile + currency conversion
  // ─────────────────────────────────────────────────────────────
  {
    // ChatGPT-P0-Fix-6: 38% Wachstum landet legitim INFLECTION (Hypergrowth-Floor 40% nicht erreicht).
    // Das ist KEIN Bug, sondern korrektes Verhalten — REVIEW ist die richtige Action für Karl.
    expected: { subProfile: 'INDUSTRIAL', track: 'A', bucketAtLeast: 'INFLECTION', actionStatus: 'REVIEW' },
    canonical: {
      identifier: { primary: 'ISIN', value: 'DE0007030009' },
      meta: { ticker: 'RHM.DE', name: 'Rheinmetall AG', sector: 'Industrials',
              industry: 'Aerospace & Defense', region: 'EU', reportingCurrency: 'EUR',
              fetchedAt: _FIXTURE_FETCHED_AT },
      marketCap: m(45e9, 'USD'),  // ~42B EUR
      metrics: {
        revenueTTM: m(11e9, 'EUR'),
        revenueGrowthYoY: pct(38),
        grossMargin: pct(28),
        operatingMargin: pct(13),
        fcfMarginTTM: pct(8),
        priceSales: pct(4.1),
        sbcRatio: pct(1),
        forwardPE: pct(22)
      },
      timeseries: {
        revenueQ: tsRev([2.0e9, 2.3e9, 2.6e9, 2.8e9, 3.0e9, 3.2e9], 'EUR'),
        grossProfitQ: tsRev([0.55e9, 0.64e9, 0.74e9, 0.79e9, 0.85e9, 0.91e9], 'EUR'),
        opIncQ: tsRev([0.20e9, 0.27e9, 0.32e9, 0.36e9, 0.40e9, 0.43e9], 'EUR')
      },
      annual: {
        annualRev: annual([11e9, 7.2e9, 6.4e9, 5.6e9, 5.2e9], 'EUR'),
        annualOpInc: annual([1.4e9, 0.9e9, 0.75e9, 0.6e9, 0.55e9], 'EUR'),
        annualGP: annual([3.1e9, 2.0e9, 1.7e9, 1.5e9, 1.4e9], 'EUR'),
        annualFCF: annual([0.9e9, 0.5e9, 0.3e9, 0.4e9, 0.2e9], 'EUR'),
        annualBalance: [
          { totalEquity: 4.2e9, longTermDebt: 1.8e9, shortTermDebt: 0.4e9, cash: 1.1e9 },
          { totalEquity: 3.1e9, longTermDebt: 1.6e9, shortTermDebt: 0.3e9, cash: 0.9e9 },
          { totalEquity: 2.4e9, longTermDebt: 1.5e9, shortTermDebt: 0.3e9, cash: 0.7e9 },
          { totalEquity: 2.0e9, longTermDebt: 1.4e9, shortTermDebt: 0.3e9, cash: 0.6e9 },
          { totalEquity: 1.8e9, longTermDebt: 1.3e9, shortTermDebt: 0.3e9, cash: 0.5e9 }
        ]
      },
      external: { aktienfinderScore: { value: 6, source: 'aktienfinder', confidence: 0.6 } }
    }
  },

  // ─────────────────────────────────────────────────────────────
  // PLTR — Palantir (SaaS / Software)
  // ─────────────────────────────────────────────────────────────
  {
    // ChatGPT-P0-Fix-6: PLTR ist policy-abhängig. Mit Fix-1 (Valuation aus Score)
    // wird PLTR fundamental QUALIFIED bleiben, expectationsRisk separat = EXTREME.
    expected: { subProfile: 'SAAS', track: 'A', bucketAtLeast: 'INFLECTION', actionStatus: 'QUALIFIED', expectationsRiskAtLeast: 'ELEVATED' },
    canonical: {
      identifier: { primary: 'TICKER', value: 'PLTR' },
      meta: { ticker: 'PLTR', name: 'Palantir Technologies', sector: 'Technology',
              industry: 'Software', region: 'US', reportingCurrency: 'USD',
              fetchedAt: _FIXTURE_FETCHED_AT },
      marketCap: m(280e9, 'USD'),
      metrics: {
        revenueTTM: m(3.5e9, 'USD'),
        revenueGrowthYoY: pct(45),
        grossMargin: pct(82),
        operatingMargin: pct(20),
        fcfMarginTTM: pct(35),
        priceSales: pct(80),  // extreme valuation
        sbcRatio: pct(15),
        forwardPE: pct(180)
      },
      timeseries: {
        revenueQ: tsRev([700e6, 780e6, 850e6, 920e6, 1000e6, 1100e6], 'USD'),
        grossProfitQ: tsRev([574e6, 640e6, 697e6, 754e6, 820e6, 902e6], 'USD'),
        opIncQ: tsRev([100e6, 130e6, 160e6, 190e6, 220e6, 240e6], 'USD')
      },
      annual: {
        annualRev: annual([3.5e9, 2.4e9, 1.9e9, 1.5e9, 1.1e9], 'USD'),
        annualOpInc: annual([0.7e9, 0.4e9, 0.1e9, -0.1e9, -0.4e9], 'USD'),
        annualGP: annual([2.9e9, 2.0e9, 1.5e9, 1.2e9, 0.8e9], 'USD'),
        annualFCF: annual([1.2e9, 0.7e9, 0.2e9, 0.05e9, -0.3e9], 'USD'),
        annualBalance: [
          { totalEquity: 4.2e9, longTermDebt: 0.2e9, shortTermDebt: 0,    cash: 5.0e9 },
          { totalEquity: 3.5e9, longTermDebt: 0.2e9, shortTermDebt: 0,    cash: 3.5e9 },
          { totalEquity: 2.9e9, longTermDebt: 0.2e9, shortTermDebt: 0,    cash: 2.6e9 },
          { totalEquity: 2.4e9, longTermDebt: 0.2e9, shortTermDebt: 0,    cash: 2.0e9 },
          { totalEquity: 1.8e9, longTermDebt: 0.3e9, shortTermDebt: 0,    cash: 1.5e9 }
        ]
      },
      external: { aktienfinderScore: { value: 7, source: 'aktienfinder', confidence: 0.7 } }
    }
  },

  // ─────────────────────────────────────────────────────────────
  // ASML — Hardware Compounder, EU
  // ─────────────────────────────────────────────────────────────
  {
    expected: { subProfile: 'HARDWARE', track: 'B', bucketAtLeast: 'B', actionStatus: 'QUALIFIED' },
    canonical: {
      identifier: { primary: 'ISIN', value: 'NL0010273215' },
      meta: { ticker: 'ASML', name: 'ASML Holding', sector: 'Technology',
              industry: 'Semiconductor Equipment & Lithography', region: 'EU', reportingCurrency: 'EUR',
              fetchedAt: _FIXTURE_FETCHED_AT },
      marketCap: m(380e9, 'USD'),
      metrics: {
        revenueTTM: m(28e9, 'EUR'),
        revenueGrowthYoY: pct(15),
        grossMargin: pct(52),
        operatingMargin: pct(31),
        fcfMarginTTM: pct(28),
        priceSales: pct(13),
        sbcRatio: pct(2),
        forwardPE: pct(32)
      },
      timeseries: {
        revenueQ: tsRev([6.5e9, 6.8e9, 7.0e9, 7.2e9, 7.4e9, 7.6e9], 'EUR'),
        grossProfitQ: tsRev([3.4e9, 3.5e9, 3.6e9, 3.7e9, 3.8e9, 3.9e9], 'EUR'),
        opIncQ: tsRev([2.0e9, 2.1e9, 2.2e9, 2.3e9, 2.3e9, 2.4e9], 'EUR')
      },
      annual: {
        annualRev: annual([28e9, 27e9, 21e9, 19e9, 14e9], 'EUR'),
        annualOpInc: annual([8.7e9, 8.5e9, 6.7e9, 5.9e9, 3.8e9], 'EUR'),
        annualGP: annual([14.6e9, 14.0e9, 11.0e9, 9.7e9, 7.0e9], 'EUR'),
        annualNetIncome: annual([7.8e9, 7.6e9, 5.6e9, 4.9e9, 3.6e9], 'EUR'),
        annualFCF: annual([7.8e9, 7.2e9, 4.5e9, 5.5e9, 3.8e9], 'EUR'),
        annualBalance: [
          { totalEquity: 14e9, longTermDebt: 4.5e9, shortTermDebt: 0.5e9, cash: 6.0e9 },
          { totalEquity: 12e9, longTermDebt: 4.5e9, shortTermDebt: 0.5e9, cash: 5.5e9 },
          { totalEquity: 9.5e9, longTermDebt: 4.0e9, shortTermDebt: 0.5e9, cash: 5.0e9 },
          { totalEquity: 8.0e9, longTermDebt: 3.5e9, shortTermDebt: 0.5e9, cash: 4.5e9 },
          { totalEquity: 6.5e9, longTermDebt: 3.0e9, shortTermDebt: 0.5e9, cash: 4.0e9 }
        ]
      },
      external: { aktienfinderScore: { value: 8, source: 'aktienfinder', confidence: 0.7 } }
    }
  },

  // ─────────────────────────────────────────────────────────────
  // MSFT — Mature SaaS Compounder
  // ─────────────────────────────────────────────────────────────
  {
    expected: { subProfile: 'SAAS', track: 'B', bucketAtLeast: 'A', actionStatus: 'QUALIFIED' },
    canonical: {
      identifier: { primary: 'TICKER', value: 'MSFT' },
      meta: { ticker: 'MSFT', name: 'Microsoft', sector: 'Technology',
              industry: 'Software', region: 'US', reportingCurrency: 'USD',
              fetchedAt: _FIXTURE_FETCHED_AT },
      marketCap: m(3500e9, 'USD'),
      metrics: {
        revenueTTM: m(260e9, 'USD'),
        revenueGrowthYoY: pct(15),
        grossMargin: pct(70),
        operatingMargin: pct(45),
        fcfMarginTTM: pct(28),
        priceSales: pct(13),
        sbcRatio: pct(4),
        forwardPE: pct(33)
      },
      timeseries: {
        revenueQ: tsRev([56e9, 60e9, 62e9, 65e9, 68e9, 70e9], 'USD'),
        grossProfitQ: tsRev([39e9, 42e9, 43e9, 45e9, 48e9, 49e9], 'USD'),
        opIncQ: tsRev([24e9, 27e9, 28e9, 29e9, 31e9, 32e9], 'USD')
      },
      annual: {
        annualRev: annual([260e9, 230e9, 210e9, 200e9, 170e9], 'USD'),
        annualOpInc: annual([117e9, 100e9, 88e9, 83e9, 70e9], 'USD'),
        annualGP: annual([182e9, 156e9, 140e9, 130e9, 115e9], 'USD'),
        annualNetIncome: annual([90e9, 78e9, 70e9, 66e9, 60e9], 'USD'),
        annualFCF: annual([72e9, 65e9, 60e9, 56e9, 50e9], 'USD'),
        annualBalance: [
          { totalEquity: 250e9, longTermDebt: 60e9, shortTermDebt: 5e9, cash: 80e9 },
          { totalEquity: 220e9, longTermDebt: 55e9, shortTermDebt: 5e9, cash: 75e9 },
          { totalEquity: 200e9, longTermDebt: 50e9, shortTermDebt: 5e9, cash: 70e9 },
          { totalEquity: 180e9, longTermDebt: 50e9, shortTermDebt: 5e9, cash: 65e9 },
          { totalEquity: 160e9, longTermDebt: 50e9, shortTermDebt: 5e9, cash: 60e9 }
        ]
      },
      external: { aktienfinderScore: { value: 7, source: 'aktienfinder', confidence: 0.7 } }
    }
  },

  // ─────────────────────────────────────────────────────────────
  // META — Marketplace / Ads Compounder (Cross-profile)
  // ─────────────────────────────────────────────────────────────
  {
    expected: { subProfile: 'MARKETPLACE', track: 'B', bucketAtLeast: 'A', actionStatus: 'QUALIFIED' },
    canonical: {
      identifier: { primary: 'TICKER', value: 'META' },
      meta: { ticker: 'META', name: 'Meta Platforms', sector: 'Communication Services',
              industry: 'Internet Content', region: 'US', reportingCurrency: 'USD',
              fetchedAt: _FIXTURE_FETCHED_AT },
      marketCap: m(1400e9, 'USD'),
      metrics: {
        revenueTTM: m(155e9, 'USD'),
        revenueGrowthYoY: pct(20),
        grossMargin: pct(82),
        operatingMargin: pct(40),
        fcfMarginTTM: pct(30),
        priceSales: pct(9),
        sbcRatio: pct(8),
        forwardPE: pct(24)
      },
      timeseries: {
        revenueQ: tsRev([34e9, 36e9, 38e9, 40e9, 42e9, 44e9], 'USD'),
        grossProfitQ: tsRev([28e9, 30e9, 31e9, 33e9, 35e9, 36e9], 'USD'),
        opIncQ: tsRev([14e9, 15e9, 16e9, 17e9, 18e9, 18e9], 'USD')
      },
      annual: {
        annualRev: annual([155e9, 134e9, 117e9, 116e9, 86e9], 'USD'),
        annualOpInc: annual([62e9, 47e9, 28e9, 47e9, 32e9], 'USD'),
        annualGP: annual([127e9, 110e9, 92e9, 92e9, 65e9], 'USD'),
        annualNetIncome: annual([55e9, 39e9, 23e9, 39e9, 29e9], 'USD'),
        annualFCF: annual([46e9, 43e9, 19e9, 39e9, 23e9], 'USD'),
        annualBalance: [
          { totalEquity: 165e9, longTermDebt: 18e9, shortTermDebt: 0,    cash: 60e9 },
          { totalEquity: 153e9, longTermDebt: 18e9, shortTermDebt: 0,    cash: 65e9 },
          { totalEquity: 138e9, longTermDebt: 10e9, shortTermDebt: 0,    cash: 50e9 },
          { totalEquity: 124e9, longTermDebt: 0,    shortTermDebt: 0,    cash: 45e9 },
          { totalEquity: 100e9, longTermDebt: 0,    shortTermDebt: 0,    cash: 60e9 }
        ]
      },
      external: { aktienfinderScore: { value: 8, source: 'aktienfinder', confidence: 0.7 } }
    }
  },

  // ─────────────────────────────────────────────────────────────
  // MNDY — monday.com (SaaS, smaller)
  // ─────────────────────────────────────────────────────────────
  {
    // F-EN-012 (Tag 188): Vorher widersprach der Comment der expected-Annahme:
    // Comment behauptete "nicht blind DISQUALIFIED", aber actionStatus war
    // DISQUALIFIED — das Fixture testete am eigenen Anspruch vorbei.
    // Heutiges Verhalten: MNDY wird DISQUALIFIED (bucket=OUT bei revenueGrowth=33%
    // < hyper-floor, plus weiche SBC-Penalty). Das ist nicht der ursprünglich
    // intendierte Zustand (Fix-6 wollte Track-A-INFLECTION), aber der Engine-Pfad
    // dorthin existiert noch nicht. Bis das nachgezogen wird:
    //   - actionStatus locken wir explizit auf DISQUALIFIED (observed reality)
    //   - reasonCodeContains 'SBC_EXTREME_WARNING' wird zum echten Guardrail:
    //     wenn jemand die weiche SBC-Behandlung (engine-v7.3.js:749-752) zurück
    //     zu HARD ändert, fällt der Test. Damit kann das Fixture nicht mehr
    //     versehentlich Pre-Fix-6-Logik durchwinken.
    expected: {
      subProfile: 'SAAS', track: 'A',
      actionStatus: 'DISQUALIFIED',
      reasonCodeContains: ['SBC_EXTREME_WARNING']
    },
    canonical: {
      identifier: { primary: 'TICKER', value: 'MNDY' },
      meta: { ticker: 'MNDY', name: 'monday.com', sector: 'Technology',
              industry: 'Software', region: 'US', reportingCurrency: 'USD',
              fetchedAt: _FIXTURE_FETCHED_AT },
      marketCap: m(13e9, 'USD'),
      metrics: {
        revenueTTM: m(950e6, 'USD'),
        revenueGrowthYoY: pct(33),
        grossMargin: pct(89),
        operatingMargin: pct(-2),
        fcfMarginTTM: pct(22),
        priceSales: pct(13),
        sbcRatio: pct(28),  // SBC trigger
        forwardPE: pct(60)
      },
      timeseries: {
        revenueQ: tsRev([195e6, 215e6, 230e6, 250e6, 270e6, 290e6], 'USD'),
        grossProfitQ: tsRev([174e6, 192e6, 205e6, 223e6, 240e6, 258e6], 'USD'),
        opIncQ: tsRev([-2e6, 1e6, 3e6, 5e6, 8e6, 10e6], 'USD')
      },
      annual: {
        annualRev: annual([950e6, 728e6, 519e6, 308e6, 161e6], 'USD'),
        annualOpInc: annual([10e6, -130e6, -120e6, -50e6, -25e6], 'USD'),
        annualGP: annual([845e6, 645e6, 459e6, 273e6, 142e6], 'USD'),
        annualFCF: annual([200e6, 130e6, 50e6, -30e6, -40e6], 'USD'),
        annualBalance: []
      },
      external: { aktienfinderScore: null }
    }
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fixtures, fxRates };
} else if (typeof window !== 'undefined') {
  window.EngineFixtures = { fixtures, fxRates };
}
