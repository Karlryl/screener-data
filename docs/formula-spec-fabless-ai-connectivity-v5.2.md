# Formula Spec — Fabless AI/Connectivity Semis · v5.2 (Durability-Achse v3)

> **SUPERSEDED / ORPHANED (Stand 2026-07-19):** `court-screen.js`, `court-score.js`,
> `court-score-tests.js` und `scripts/_proto-durability-v3.js` existieren nur noch
> in `outputs/_backup-pre-dlst/`, nicht im aktiven Baum. Die aktive Engine
> `src/scoring/` (inkl. `formulas/`) hat **keine** Durability-Achse dieses Namens
> — die hier beschriebene Formel ist nicht implementiert/verifizierbar. Der
> Verifikationsbefehl unten (`node court-screen.js; ...; 17/17`) läuft nicht mehr.
> Diese Spec bleibt als Herleitungs-Dokument stehen; vor einer Reaktivierung
> erst gegen den aktuellen `src/scoring/`-Stand neu verdrahten und neu testen.

> **CO-LOCATED beside the code** (Court-Auflage Iteration 10: die Spec lag bisher nur im Jarvis-Vault).
> v5.2 ändert AUSSCHLIESSLICH die **Durability-Achse** (court-screen.js). Alle übrigen Achsen, Membership,
> Stage-Bucketing, Penalties, Realness-Harness etc. **unverändert per v5.1**
> (`Jarvis/.../formula-spec-fabless-ai-connectivity-v5.1-2026-06-15.md`). Bucket: `fabless_semi`.
> Quelle der Herleitung + Validierung: `screener-formel-ledger.md` Eintrag 18/19 (+Addendum) / 20.
> **Status der Konstanten: [TODO-CAL]** — verified-DESIGN + verified-INSTANCE (Real-Quartalsdaten),
> NICHT verified-by-forward-fitness. „Besser" erst ab forward-fitness ~2026-07-14 belegbar; bis dahin
> gilt der Anspruch: **age-/längen-neutral + Gates grün + plausibel + kein stiller Regress + λ-Envelope-stabil**.

## §5 (ersetzt v5.1-Zeile 81) — Durability-Achse v3

| Achse | Quelle | k_sat | w (v0) |
|---|---|---|---|
| **Durability** (recency-gewichtete Downside-Drawdown-Ratio, scale-normalisiert) | SEC-Quartals-YoY (`payload.ftsQuarterly.revQYoYsec`); annual YoY Fallback | 1.0 | 0.25 |

**Berechnung (court-screen.js):** YoY-Reihe `g` newest-first (i=0 = neuestes Quartal).
Fenster `gW = g.slice(0, W)`, **W = 12** (≈3 Jahre; Window-Cap = primäre Recency-Kontrolle).

```
med = median(gW)
Below = { i : gW[i] < med }
w_i   = rho^i / mean_{Below}(rho^·)          # rho = 0.9; Renormierung auf Mittel 1 über Below  → LÄNGEN-NEUTRAL
dd    = sqrt( Σ_{i∈Below} w_i · (gW[i]−med)² / COUNT_below )    # ÷ COUNT_below, NICHT ÷ n
durRaw = ( med − λ·dd ) / ( |med| + floor )   # λ = 1.0 ;  floor = 0.10  → scale-normalisiert (dimensionslos)
durS  = tanh( (durRaw − median_cohort(durRaw)) / MAD_cohort(durRaw) / k ),  k = 1.0
```
**KEIN dCred / kein Längen- oder Alters-Term.** Quelle-Wahl: `revQYoYsec` falls ≥4 Punkte, sonst annual YoY.

**EHRLICHKEIT (verbindlich — Court-Auflagen):**
- **Kein „Sortino"/„Semideviation"-Label bei dünner Historie.** Bei n≤3 (1 Punkt unter Median) reduziert sich `dd` auf `|min−med|/√1` → ein **(median,min)-Blend**, KEINE Semideviation. Der Begriff Semideviation ist erst ab ≥2–3 below-median-Punkten zulässig (nur mit der tiefen Quartalshistorie erreichbar).
- **Längen-/Tiefen-Neutralität:** `÷COUNT_below` + `rho`-Gewichte auf Mittel 1 renormiert → der Wert ist eine **reine Funktion des recent-W-Fensters**, unabhängig von Gesamthistorie/Listing-Alter. Regression-Test: gleiche recent-12-Shape + beliebig viele ältere Quartale → **identische durRaw** (court-score-tests.js „LÄNGEN-NEUTRAL").
- **Scale-Normalisierung** durch `(|med|+0.10)` → NICHT growth-gekoppelt (verified-instance: `pearson(durS, growthS)=0.24`; v2 war 0.749).
- **Recency:** Window-Cap (W=12) wirft Alt-Zyklen raus; `rho=0.9` gewichtet innerhalb des Fensters jüngere Quartale stärker. So zieht ein **alter** Einbruch weniger als ein **frischer**. (AMBA: jüngste Erholung +44/+53/+58 wird kreditiert; der echte 5-Quartals-Einbruch −5/−12/−31/−27/−31 ~1.5–3J zurück zieht trotzdem runter → Demotion EHRLICH, kein Mis-Grade.)
- **Window-Cap ist load-bearing:** ohne ihn kontaminiert NVDAs 60-Quartals-Historie (2008–2019-Zyklen) den Median → NVDA durS −0.83 / Rang 4. Mit W=12 → durS +0.33 / Rang 2.
- **Lampe `thin-durability`** (nur Warnung, KEIN Score-Eingriff) wenn das Fenster <4 YoY hat (annual Fallback). Die irreführende `8q-approx`-Lampe (v5.1) ist **entfernt** (sie referenzierte Quartale, die die annual-Metrik nie nutzte).

**WARUM v3 (Root-Cause v2-DENIED, Ledger Eintrag 19):** v5.1 rechnete `median/MAD` (bzw. Iter-10-v2 `median−downsideDev`) über **3 annuelle YoY** → n=3 degenerierte zu (median,min), **dominierte den Score** (`spearman(score,durS)=0.976`), war scale-/längen-gekoppelt und permutations-invariant. v3 löst die Wurzel via tieferer SEC-Quartalshistorie + längen-/scale-neutraler, recency-bewusster Metrik.

## §5.1 (ersetzt v5.1-Zeile 88) — Kollaps-Detektor JETZT GEWIRED (nicht nur Lampe)

court-score.js veröffentlicht **jeden Lauf BEIDE** Maße (Court-Auflage „decompose WHICH block collapses"):
- `collapseSpearman` = `Spearman(Score, GM+Durability-Block)` (v5.1-Detektor).
- `rhoDomAxisDurability` = `Spearman(Score, Durability-Achse ALLEIN)` (der eigentliche v2-Befund: Score ~monoton in EINER Achse).

**Harte Re-Gewichtung (Backstop, deterministisch):** wenn `rhoDomAxisDurability > T` (**T = 0.90**, offengelegt):
`haircut = clip((ρ−T)/(1−T), 0, 1) · 0.5` (≤50 %) → `w_durability ·= (1−haircut)`, freigewordenes Gewicht **pro-rata** auf Growth/GM/Accel; Scores neu berechnet; Lampe `collapse-reweight-applied` + Logging von ρ + Vorher/Nachher-Gewicht. (Hinweis: pro-rata-Umverteilung re-koppelt im Feuer-Fall leicht an Growth — offengelegt.)
**Verified-instance:** `rhoDomAxisDurability = 0.79 < 0.90` → Backstop feuert NICHT; Scale-Norm + Window-Cap drücken die Domination schon unter die Schwelle (von v2 0.976). Der Guard ist Sicherung, keine tragende Krücke.

## Stability-Envelope (λ-Sweep, verified-instance)

λ ∈ {0.5 … 2.0}: Invarianten halten — ALAB/NVDA Top-2, CRDO Top-3, MXL/AMBA Tail; `rhoDomAxisDurability < 0.90` für λ ≥ 0.75 (bei λ=0.5 steigt sie auf 0.88). Gewählt **λ=1.0** [TODO-CAL]; `rho=0.9`, `floor=0.10`, `W=12`, `T=0.90` ebenfalls [TODO-CAL] bis forward-fitness.

**Verified-instance Ranking (Real-SEC-Quartalsdaten, 2026-06):** ALAB > NVDA > CRDO > ARM > AVGO > AMD > MXL > AMBA. CRDO durS −0.33 (realer FY2024-Einbruch) wird per Growth/GM Top-3 gerettet — Youth-Bias-Fix wirkt auf Ranking-Ebene, nicht über das durS-Vorzeichen.

## Re-Court-v2-Disclosures (2026-06-17, verbindlich)

- **Determinismus & KILL:** Der skeptiker-verifizierte KILL-Filter (`KMTS` etc., court-score.js) MUSS aktiv bleiben — sonst leckt KMTS in den fabless-Cohort (9 Member), kontaminiert Median/MAD und kippt NVDA durS→0. Regression-Test `universeSize===8 & kein KILL-Ticker` sperrt das ein. Pipeline ist deterministisch (2 sequentielle Läufe byte-identisch); die zuvor beobachtete 8↔9-Oszillation war ein PARALLEL-Lauf-Race auf der geteilten Output-Datei (siehe Harness-Isolation).
- **Tie-averaged Spearman:** `collapseSpearman`/`rhoDomAxisDurability` nutzen jetzt Mittel-Ränge → order-stabil. `rhoDomAxisDurability = 0.78` (stabil; vorher reihenfolge-abhängig 0.68–0.86 wegen durS-Ties MXL=AMBA=−1). λ=0.5 treibt rhoDom auf 0.88 → **λ NICHT unter 0.75 tunen** ([TODO-CAL]).
- **Harness-Isolation:** court-score-tests.js + jeder Verify-Lauf schreiben via `COURT_CAND_OUT`/`COURT_OUT` in TEMP-Dateien (`outputs/_court-*.test.json`), NIE in die geteilten Produktions-Artefakte → parallele Court-Judges können das Artefakt nicht mehr racen.
- **Short-window-Flattering-Bias (offengelegt):** Bei `winN<12` (ALAB 7Q, ARM 8Q → Lampe `short-durability-window`) kann ein decel-from-peak-Name leicht höher ausfallen als auf 12Q (~+0.07 durRaw gemessen); im Worst-Case-Decel-Counterfactual könnte ALAB(#1)/NVDA(#2) kippen. Benigne SOLANGE ALABs echte Post-IPO-Trajektorie beschleunigt — **bei forward-fitness ~2026-07-14 re-bestätigen**; falls ALAB mit wachsendem Fenster dezeleriert, muss durS ohne Sprung mitlaufen.
- **rho-Inertness bei countBelow==1:** Die Mean-1-Renormierung zwingt das einzige Below-Gewicht auf 1.0 → die Recency-(rho)-Neigung ist bei genau 1 Below-Punkt mathematisch VAKUANT. Harmlos hier (alle 8 Member countBelow≥3); der „recency-aware"-Anspruch gilt erst ab countBelow≥2 — explizit so deklariert.
- **Near-zero-median-Amplifikation:** Wenn `median(gW)≈0` bläht `/(|med|+0.10)` den Rohwert auf (z.B. MXL durRaw −3.65); `tanh` sättigt durS→−1 → RANG unberührt, aber der Rohwert ist ein Artefakt → Lampe `near-zero-median-amplified` offenbart es. (floor=0.10 [TODO-CAL].)

**Verifizierbarkeit:** `cd screener-data; node scripts/enrich-q-revenue.js; node court-screen.js; node court-score.js; node court-score-tests.js` (**17/17**, inkl. universeSize-Guard + Längen-Neutralität; isolierte Temp-Outputs) · `node scripts/_proto-durability-v3.js` (Config F). Quartals-Quelle: `companyfacts.zip` via `scripts/enrich-q-revenue.js` → `payload.ftsQuarterly.revQYoYsec`. KILL aktiv → `fabless_semi.universeSize===8`, `rhoDomAxisDurability 0.78<0.90`.
