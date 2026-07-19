# B1-PRÄREGISTRIERUNG — Umsatz+Gewinn-Beschleunigung (EINGEFROREN 2026-07-19)

> Backtest B1 des Früher-finden-Katalogs (Vault: `_BACKTEST-KATALOG-frueher-finden-2026-07-16.md`).
> Council 3 Stimmen + Court max Härte: Runde 1 DENIED (6 Anklagen) → Revision → Retrial
> PASSED mit Auflagen H1–H3 inkl. Veto-Regel (vom Retrial-Ankläger formuliert, wörtlich
> übernommen). Dieses Dokument ist die EINE Wahrheit; jede Änderung nach dem Einfrieren
> ist ein dokumentierter Neustart der Präregistrierung (neue Datei, neues Datum).
> SHA-256 dieses Dokuments wird im Commit + Vault geloggt.
> **Provenienz-Attest (H1):** Vor dem Einfrieren existierte KEINE B1-Rechnung — kein
> B1-Code, kein Event-Scan, kein Artefakt (Court-verifiziert am Repo-Stand Tag 388).
> Alle Schwellen sind Literatur-/Event-Study-Konventionen (P90 = oberstes Dezil,
> CANSLIM-/Faktorliteratur; ±2σ, 60d-Realized-Vol, 250 Handelstage = generische
> Standards). Die einzige je gesehene Firmen-Zahlenreihe (CRDO Umsatz/NI, PIT-Beweis
> Tag 388) enthält weder Querschnitts-Perzentile noch Vol-Werte. Das Anker-Panel
> (NVDA/SMCI/CELH/ENPH/SHOP/DDOG) wird ERST NACH dem Validation-Verdikt deskriptiv
> geöffnet.

## 1 Event-Definition (Haupttest, vollständig fixiert)

Firma i hat ein Event in Fiskalquartal t gdw. (alle Größen point-in-time zum
Erkennungs-Stichtag, s. §3):
- ΔYoY(t) > 0 UND ΔYoY(t−1) > 0, mit ΔYoY(t) = YoY(t) − YoY(t−1) und
  YoY(t) = Umsatz(q_t)/Umsatz(q_{t−4}) − 1 (Paarung über den Fiskalquartal-Index
  der firmeneigenen Serie; abgeleitetes Q4 = FY − (Q1+Q2+Q3) eingeschlossen;
  Transition-/53-Wochen-Perioden ausgeschlossen und gezählt).
- ΔYoY(t) ≥ P90 des PIT-Querschnitts: Kohorte = alle Firmen-Quartale, deren
  Fiskalquartals-ENDE im selben KALENDERquartal liegt; ΔYoY wird an P1/P99 der
  Kohorte winsorisiert, DANN P90 bestimmt; Mindest-Kohorten-N = 200, sonst erzeugt
  das Kalenderquartal keine Events (Ausweis).
- Δ(OpInc/Umsatz)(t) > 0 (Operating-Margen-Ausweitung, OpInc = OperatingIncomeLoss;
  gleiche Fiskal-Paarung q_t vs. q_{t−4}).
- Umsatz(q_{t−4}) > 0 (YoY definiert), beide OpMargin-Terme definiert.

## 2 Daten + Konzepte

SEC companyfacts.zip (PIT-Reader `lib/sec-pit.js`, Tag 388: bekannt-am-Stichtag =
filed ≤ asOf, Korrektur gewinnt). Umsatz: REV_CONCEPTS (freshness-first). OpInc:
OperatingIncomeLoss. Preise: Yahoo adjclose (`prices-max/`), Tages-SCHLUSSKURSE.
US-only (SEC-Pflicht); Klausel im Report.

## 3 Tag 0 + Einstieg

Erkennungs-Stichtag = filed-KALENDERDATUM des Quartal-t-Filings (Bulk trägt keine
Uhrzeit — ehrlich dokumentiert). Konfirmatorischer Einstieg = Schlusskurs von
Tag 0 + 1 Handelstag (uhrzeitunabhängig, nie Look-ahead).

## 4 Outcome (First-Passage, exakt)

Barrieren ±2·σ_lokal um den Einstiegskurs; σ_lokal = Realized-Vol der Tages-Log-
Returns über die 60 Handelstage vor Tag 0, skaliert auf den Horizont (σ_Barriere =
σ_daily·√250·Faktor 1 — d. h. Barrieren = Einstieg·exp(±2·σ_daily·√250)); Timeout
250 Handelstage. Bewertung NUR auf Tages-Schlusskursen: der erste Tag, dessen Close
eine Barriere durchbricht, entscheidet; Gegenseiten-Barrieren können per Close nicht
am selben Tag brechen (Ties strukturell ausgeschlossen; Intraday-Berührungen
unsichtbar = dokumentierte, gruppensymmetrische Präzisions-Limitation). Timeout =
„nicht-oben-zuerst" (Miss) für beide Gruppen. Primärstatistik = Differenz der
Oben-zuerst-Raten Event − Kontrolle über gematchte Paare.

## 5 Kontrolle (kontemporär)

Kontrolle = Nicht-Event-Firma mit Pseudo-Event am SELBEN Handelstag (Tag 0
identisch). Nearest-Neighbor auf: log-MarketCap, Sektor (exakt), 6-Monats-Momentum,
EV/Sales-Querschnitts-Perzentil. Caliper: Mahalanobis-Distanz ≤ 1,0 auf den
standardisierten Nicht-Sektor-Variablen; Event ohne Caliper-Match fällt aus
(Quote ausgewiesen). Jede Kontrolle max. 1× je Kalenderquartal.

## 6 Split

Discovery = Fiskalperioden ≤ 2018-12-31: NUR Daten-Hygiene-Instrumentierung
(Coverage, FY-Transition-Verluste, Fehlquoten, Cluster-Struktur, Verteilungs-
Deskription) und Power-Analyse — NIEMALS Hypothesen-/Schwellen-/Familien-Wahl.
Validation = 2019-01-01 bis 2024-12-31: konfirmatorisch, EIN Lauf. Lockbox =
2025-01-01+: unberührt bis zum finalen einmaligen Lauf. Firmen mit Discovery-Event
sind aus dem Validation-Event-Pool ausgeschlossen (Zeit- UND Firmen-Trennung).
CRDO/ALAB nie kalibrierend.

## 7 Konfirmatorische Familie (fix, m = 6, BY-FDR q = 0,10)

1. Haupttest (§1/§4/§5). 2. P75 statt P90. 3. Barrieren ±1,5σ. 4. Ohne
OpMargin-Bedingung. 5. t+5-Umsetzbarkeitstest (Einstieg Schlusskurs Tag 0+5).
6. Delisting-Imputations-Sensitivität (Shumway 1997: performance-bedingte
Serienenden = −30 % imputiert; Klassifikation via `lib/forward-returns.classify`).
Alles andere (QoQ-Reihen, Q4-freier Cut, Leave-one-Regime-out, Regime-/P/S-Schnitte,
Worst-Case-Schranken, Event-Histogramm Sektor×Halbjahr) ist DESKRIPTIV, null
Entscheidungsgewalt.

## 8 Verdikt-Regel (inkl. Veto — Wortlaut der Court-Auflage)

Ein Positiv-Verdikt erfordert: Primärtest überlebt BY **UND** Balance-Gate ≤ 5 pp
**UND** die Delisting-Imputations-View (Shumway −30 %) kehrt das Vorzeichen der
Primärdifferenz nicht um; andernfalls „nicht belastbar unter Attrition".
- **Balance-Gate:** |Preis-Fehlquote(Event) − Fehlquote(Kontrolle)| > 5 Prozent-
  punkte → „nicht belastbar unter Attrition" (KEIN Urteil in beide Richtungen).
- **Power-Gate (H3):** N_eff ≥ 8 auf Ebene der Sektor×Kalenderquartal-Cluster
  (distinkte Event-Cluster, deflationiert um Cluster-Korrelation via Block-Bootstrap;
  Kendall-korrigierte N_eff-Maschinerie sinngemäß) — darunter lautet JEDES Ergebnis
  „unterpowert, kein Urteil".
- Inferenz: Block-Bootstrap über Sektor×Kalenderquartal-Cluster, BCa, bestehende
  Verbreiterungs-Konvention (E-20260719-1 sinngemäß); Wilcoxon-Rang-Zweitstatistik
  deskriptiv.
- Survivorship-Bilanz: Nenner/Attrition auf der VOLLEN companyfacts-CIK-Population
  (inkl. tote CIKs, ohne Ticker-Mapping zählbar); Preis-Verfügbarkeit je Gruppe im
  Report.

## 9 Konsequenz-Klausel

Validiertes Positiv → Council/Court-Vorlage zur revAcceleration-Achsen-Gewichtung
(kein automatischer Score-Eingriff). Negativ → Friedhof mit Begründung.
„Nicht belastbar"/„unterpowert" → dokumentiert, keine Score-Folge. Erwarteter Edge
ehrlich: PEAD-Fenster zwischen 1. und 3. Beschleunigungsquartal; „kein Effekt" ist
ein gültiges, wertvolles Ergebnis.
