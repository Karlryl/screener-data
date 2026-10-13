# Preregistrierung: SEC-US Growth Emergence Score Pilot

Version `1.0.0`, eingefroren am 8. August 2026. Status: **PREREGISTERED, NOT_READY_TO_EXECUTE, keine Ergebnisse angesehen**.

Die maschinenlesbare und allein vollständige Festlegung steht in `ges-sec-us-pilot-preregistration.json`; ihr scoped SHA-256 und der vollständige Dateihash stehen im `hash-manifest.json`. Jede Änderung nach Versiegelung verlangt eine neue Protokollversion und ein noch ungeöffnetes Testfenster.

## Forschungsentscheidung

Der Pilot wird zuerst auf in den USA börsennotierte, inländische SEC-Filer begrenzt. Das ist kein Anspruch auf globale Gültigkeit, sondern die einzige heute belastbar planbare Point-in-Time-Strecke. Banken, Versicherer, REITs und Pre-Revenue-Biotech werden im Primärtest nicht mit operativen Gesellschaften vermischt; sie dürfen nur als getrennte Sekundärstrata erscheinen. ADRs und Foreign Private Issuers bleiben aus der Primäranalyse, bis Entity-, Rechnungslegungs- und Primärlistingregeln separat belegt sind.

## Eingefrorener GES

Der fundamentale `GES_F` besteht aus fünf gleich gewichteten, kohortenrelativen Midrank-Perzentilen:

1. Umsatzbeschleunigung über zwei jüngste gegenüber zwei vorherigen Quartals-YoY-Paaren.
2. Bruttogewinnbeschleunigung nach derselben Zeitlogik.
3. Bruttomargen-Inflection: Mittel der jüngsten zwei Quartale minus Mittel der vier Vorquartale.
4. Operating-Leverage-Inflection nach derselben 2-gegen-4-Logik.
5. Verwässerungsdisziplin: negatives Wachstum der ausstehenden Aktien gegenüber dem Vorjahresquartal.

Es gelten keine Imputation und kein Jahresfallback. Mindestens vier Faktoren müssen vorhanden sein; die festen 20-%-Gewichte werden nur über vorhandene Faktoren renormalisiert. Der sekundäre `GES_FM` mischt 80 % `GES_F` mit 20 % ausschließlich vor dem Filing bekannter Marktanerkennung. Ein Erwartungslückenfaktor ist ausdrücklich `NOT_READY`, weil kein lizenzierter Point-in-Time-Konsensspeicher existiert; er darf nicht still ersetzt werden.

`GQS-00@1.0.0` bleibt unverändert Baseline. Für historische Stichtage wird dieselbe eingefrorene Formel auf einen SEC-as-of-Snapshotadapter angewendet. Der Adapter darf Datenformen abbilden, aber weder GQS-Achsen noch Gewichte, Tracks, Missingness, Faktoren, Filter oder Ranking ändern.

## Timing und Auswertung

Availability ist der SEC-Acceptance-Zeitpunkt beziehungsweise der spätere unabhängig erfasste Release-Zeitpunkt. Ausführung ist der erste reguläre Börsen-Open strikt danach. Monatsvintages verwenden nur das jüngste, höchstens 180 Tage alte Signal. Fakten, Tickerzuordnungen, Restatements, Delistingwissen oder Adjustments aus der Zukunft sind verboten.

Die Walk-forward-Testfenster sind 2019–2020, 2021–2022 und 2023–2025 mit den im JSON festgelegten wachsenden Train-/Validation-Fenstern. Random Shuffle ist ausgeschlossen. Fundamentale Horizonte sind 4/8/12/20 Quartale, Aktienhorizonte 3/6/12/24/36/60 Monate. Nicht vollständig gereifte Horizonte werden nur gezählt und nicht bewertet.

Primärmetriken sind Rank-IC, Topdezil-Spread und Hit Rate; die inkrementelle Prüfung kontrolliert GQS-00, Sektor, Größe und Regime. Transaktionskosten sind primär 50 Basispunkte Roundtrip, mit 20/100 bps als Sensitivität. Alle Horizonte, Varianten, Strata und Ablationen bilden eine gemeinsame Multiple-Testing-Familie mit Benjamini-Hochberg `q=0,05`; White Reality Check, Hansen SPA, PBO/CSCV und gegebenenfalls Deflated Sharpe ergänzen die Modellkontrolle.

## Vorab festgelegtes Urteil

Erfolg verlangt positive fundamentale Rank-ICs in mindestens zwei Testfenstern mit positivem gepooltem, FDR-korrigiertem Intervall, positiven inkrementellen Informationswert gegenüber GQS-00 sowie positive after-cost Renditespreads in mindestens zwei reifen Fenstern. Vorzeichenumkehr in zwei Fenstern, fehlende Robustheit ohne Microcaps/COVID/AI-Boom oder nichtpositive gepoolte Primärwirkung falsifizieren die These.

Der Lauf wird vor Ergebnissichtung abgebrochen, wenn Point-in-Time-Leakage auftaucht, historische Entity-Zuordnung unter 99,5 % fällt, mehr als 5 % der Delisting-Outcomes ungeklärt sind oder die Vier-von-fünf-Faktorabdeckung in zwei Jahren unter 60 % liegt.

Bis sämtliche Foundation-Gates grün sind, ist jede Ergebnisberechnung, Gewichtsoptimierung oder Siegerbehauptung untersagt.
