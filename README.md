# Karl's v7.3 Stock-Screener — Cron-Pipeline-Repo

Daily Yahoo-Pull + Score + Discord-Alert für Karls Hypergrowth-Watchlist. Buy-only-Tool — Sells laufen über Elliott Waves extern.

## Setup (Einmalig, ~30min)

### 1. GitHub-Repo anlegen

```bash
# Repo anlegen (privat empfohlen — deine Watchlist-Strategie ist nicht öffentlich-bestimmt)
gh repo create karl/screener-data --private --confirm
cd screener-data
```

Oder via Web-UI: github.com → New Repository → Name: `screener-data`, Visibility: Private.

### 2. Files committen

Alle Files aus dem ZIP entpacken ins Repo-Root:

```
screener-data/
├── pull-yahoo.js              ← Yahoo-Pull-Skript (täglich-Pipeline)
├── detect-changes.js          ← Bucket-Wechsel + Hard-Penalty Detection
├── engine-v7.3.js             ← Score-Engine (pure)
├── score-orchestrator.js      ← Multi-Track + Buy-Status (Tag 18)
├── manipulation-filters.js    ← Quality-Heuristics (Tag 8)
├── watchlist.json             ← Karls Watchlist (10 Stocks, position-feld pro Stock)
├── package.json               ← yahoo-finance2 dependency
├── .github/
│   └── workflows/
│       └── daily-pull.yml     ← Cron-Workflow (weekly Mo 08:00 UTC)
├── snapshots/                 ← Output-Ordner (wird vom Workflow committed)
├── alert-state.json           ← Yesterday-State für Diff-Detection (auto-managed)
└── README.md
```

```bash
git add .
git commit -m "init: v7.3 screener cron-pipeline"
git push
```

### 3. Repo-Permissions setzen

GitHub-Repo → Settings → Actions → General → "Workflow permissions" auf **"Read and write permissions"** setzen. Sonst kann der Workflow keine snapshots committen.

### 4. (Optional) Discord-Webhook

Für Buy-Kandidaten-Alerts und Hard-Penalty-Warnings:

1. Discord-Server → Channel-Settings → Integrations → Webhooks → Create Webhook
2. URL kopieren
3. GitHub-Repo → Settings → Secrets and variables → Actions → New secret:
   - Name: `DISCORD_WEBHOOK`
   - Value: die URL

Wenn nicht gesetzt: der Workflow läuft trotzdem, aber ohne Notifications (nur snapshots werden committed).

### 5. Erster Run

```bash
# Lokal testen
npm install
node pull-yahoo.js --watchlist watchlist.json --output snapshots --rate-limit 1500
node detect-changes.js --snapshots snapshots --state alert-state.json --watchlist watchlist.json
```

Wenn das lokal läuft, im GitHub-UI: Actions → "Daily Yahoo Pull" → "Run workflow" → manuell triggern.

## Cron-Schedule

Default: **Montag 08:00 UTC** (= 09:00 Berlin Winter / 10:00 Berlin Sommer). Das ist wöchentlich, nicht täglich — Begründung im Council-Verdict (Tag 18): Watchlist-Stocks bewegen sich quartalsweise mit Filings, daily-Pulls produzieren keine neuen Daten an 360 Tagen pro Jahr.

In `daily-pull.yml` ändern wenn gewünscht:
- `'0 8 * * MON'` = wöchentlich (default)
- `'0 8 * * 1-5'` = täglich Mo-Fr
- `'0 8 1 * *'` = monatlich am 1. des Monats

## Watchlist pflegen

`watchlist.json` editieren, committen, pushen. Beim nächsten Cron-Run werden neue Stocks gepullt, alte rausgeworfen. Felder:

```json
{
  "isin": "US...",
  "ticker": "TICKER",
  "yahoo_symbol": "TICKER",
  "name": "Display Name",
  "track_hint": "A oder B",
  "position": "owned | watching | interested"
}
```

`position`-Logik:
- **owned** — Karl hat gekauft. Tool macht Conviction-Check. DOWNGRADE-Alerts werden zu INFO (kein Sell-Trigger; Sells via EW).
- **watching** — Buy-Kandidat. UPGRADE → CRITICAL (Buy-Signal). DOWNGRADE → WARNING (von Watchlist streichen).
- **interested** — passiv auf Radar. Wird gepullt aber wenig Alert-Noise.

## Alert-Severity (Buy-only-Mapping)

| Event | watching | owned |
|-------|----------|-------|
| Bucket UPGRADE (B→A) | 🔴 **CRITICAL — Buy-Kandidat** | INFO (These bestätigt) |
| Bucket DOWNGRADE (A→B) | 🟡 WARNING (Watchlist-Pflege) | INFO (kein Sell-Trigger; Sells via EW) |
| ACTION → QUALIFIED | 🔴 **CRITICAL — Buy-Kandidat** | INFO |
| ACTION → DISQUALIFIED | 🟡 WARNING | INFO |
| Neue Hard-Penalty | 🔴 **CRITICAL — Buy-Stop** | 🔴 CRITICAL — Conviction-Check |

## Daten-Quellen

- **Yahoo Finance** via yahoo-finance2: TTM-Margins, marketCap, P/S, PE, sector/industry.
- **Yahoo fundamentalsTimeSeries**: annual + quartal Income-Statement (annualRev, OpInc, NetIncome, GrossProfit, FCF) — fängt Yahoo-Nov-2024-Regression auf.
- **Aktienfinder**: Quality-Score via Bookmarklet manuell synced (nicht automatisch — Aktienfinder hat keine offene API).

## Bekannte Limitationen

- Yahoo blockt aggressives Polling — `rate-limit ≥1500ms` zwischen Stocks ist Pflicht.
- Yahoo-Field-Drift möglich. Wenn `annualOpInc` plötzlich leer ist: API-Schema hat sich geändert, `pull-yahoo.js` braucht Update.
- Watchlist >50 Stocks: GitHub-Actions-Time-Limit (10min default) wird knapp. Dann Workflow-Timeout erhöhen oder Watchlist splitten.
- Engine-Score ist deterministisch bei stable-Input. Score-Änderungen kommen aus neuen Yahoo-Daten, nicht aus Engine-Änderungen.

## Engine-Update

Wenn die Engine in `engine-v7.3.js` aktualisiert wird (neue Bucket-Schwellen, neue Penalties etc.), bleiben alte `score_runs` in der Browser-DB unverändert (snapshot-store macht keine Engine-Migration). Karl muss DB resetten im Dashboard wenn er konsistente History-Vergleiche will.

## Troubleshooting

**Pull schlägt fehl mit HTTP 401:** `yahoo-finance2` upgraden (`npm update yahoo-finance2`). Yahoo wechselt regelmäßig den Crumb-Flow.

**Discord-Alerts kommen nicht:** Secret `DISCORD_WEBHOOK` prüfen. Workflow-Logs (Actions-UI) zeigen ob Webhook aufgerufen wurde.

**RHM.DE / andere Stocks scoren UNCLASSIFIABLE:** orchestrator's `_fillDerivedMetrics` sollte das fangen. Wenn nicht: `annualRev` hat <2 Jahre Daten, `revenueGrowthYoY` kann nicht berechnet werden.

---

Bei Fragen: das Tool ist Eigenbau, kein Support. Code ist dokumentiert, Engine-Tests laufen lokal mit `node engine-test.html` (Browser).
