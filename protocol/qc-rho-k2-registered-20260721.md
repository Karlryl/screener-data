# QC-core ρ-Screen K2 — PRÄREGISTRIERUNG (eingefroren 2026-07-21, VOR dem Lauf)

> Discovery-Instrumentierung (kein Validation-Schuss, kein Score-Effekt, HG byte-identisch).
> Zweck: erste, billige Orthogonalitäts-Stufe für eine QC-core-Kandidatenachse.
> Council-Duell 21.07. (2 Linsen konvergent): K2 zuerst, weil heute messbar ohne Bau.
> Akte: Vault `_QC-CORE-DUELL-AKTE-2026-07-21.md`. **Diese Datei friert Achse + Gate
> VOR dem Sehen der ρ-Werte ein (Anti-Fudge, Linsen-Court-Punkt 3).**

## Achse K2 — CFO/NI-Slope (reine Ratio-Slope, GG4: kein Niveau)

Je Firma: Punkte (FY-Index, CFO/NI) für jedes Fiskaljahr mit
`annualNetIncome.value > 0` UND finitem `annualOCF.value`; CFO/NI = OCF/NI.
K2 = **Steigung der linearen Regression** dieser Punkte über den FY-Index.
Mindestens **2 gültige FY**, sonst K2 = null (Firma fällt aus dem Screen).
Datenquelle: `s.secAnnual` (committeter Offline-SEC-annual-Kanal, US-Namen).
Vorzeichen der Slope ist für den |ρ|-Screen irrelevant (|ρ| ist vorzeichen-invariant).

## Gate (eingefroren)

- Statistik: Spearman-|ρ| zwischen K2 und dem live berechneten HG-Score über die
  GETEILTE Menge (Namen mit action='route' + finitem HG + finitem K2).
- **Bestanden = |ρ| < 0,4 POOLED UND in jedem Sektor|Track mit n ≥ 20.**
  (perSector-Maskierungs-Schutz: pooled < 0,4 nützt nichts, wenn ein gut besetzter
  Sektor|Track ≥ 0,4 trägt — genau die roicStability-Falle, wo pooled einen
  wachstums-reitenden Sektor maskiert.)
- |ρ| wird auf |ρ|, nicht signiertem ρ, geprüft (eine anti-korrelierte Achse ist
  NICHT orthogonal — Linsen-Court-Punkt 1).

## Ergebnis-Klassen (eingefroren)

- **|ρ| < 0,4 überall → K2 ist orthogonale DIAGNOSTIC-Achsen-Kandidatin.** NICHT core:
  ρ ist nur der billige Screen (notwendig, nicht hinreichend). Ein w>0-core-Flip
  braucht später GG6 rankIC + Bruchstellen-Bless — und der ist wegen der Vintage-Power
  (N_eff<8, Vintage #1 erst 2026-07-14) Monate entfernt.
- **|ρ| ≥ 0,4 (pooled oder maskierter Sektor) → K2 verworfen** (Muster-Friedhof-Eintrag),
  weiter zu K3 (Beneish DSRI/AQI, braucht Balance-Feld-Extraktions-Bau).

## Nicht-Ziele
Kein Score-Gewicht, kein Board-Flip, keine Live-Dependency. Reine Messung.
Ausgabe: `outputs/quality/_rho-k2.json`.
