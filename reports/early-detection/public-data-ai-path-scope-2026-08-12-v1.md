# FEM-SEC-US-PUBLIC-AI — finaler No-Cost-Scope V1

Status: `FINAL_PRE_OUTCOME_SCOPE`

Erstellt: 2026-08-12T01:43:16+02:00

## Zweck

Dieser Pfad ist ein kostenloser, durch Codex-Subagents adversarial geprüfter Zusatz zur versiegelten Growth-Screener-Früherkennungsstudie V4. Er beantwortet ausschließlich Datenabdeckungs-, Identitäts- und technische Machbarkeitsfragen in einer explizit beobachteten Public-Data-Kohorte. Er ersetzt weder den Original-V4-Vollmarktvertrag noch dessen H-LATE-/H-FEM-Test.

Vor einer eigenen Versiegelung dürfen keine nachfolgend gesperrten Endpunkte gelesen oder berechnet werden.

## Unveränderliche Trennung

- Original-V4: 2/13 grün; voller 2009–2024-In-Scope-Markt und ursprüngliche Gate-Semantik.
- Public-AI-Pfad: coverage-bounded, nicht survivorship-safe, AI-geprüft und ohne HUMAN-Attestation.
- Kein Ergebnis des Public-AI-Pfads darf als Original-V4-, Vollmarkt- oder Human-geprüftes Ergebnis bezeichnet werden.

## Vorab festgelegte kostenlose Eingänge

1. Forschungs-Korpus V94: 296 ausgewählte Evidenzen, 1.161 Kontrollen, 119 unveränderliche Evidenzen.
2. Archivierte Nasdaq-/Otherlisted-Punktzustände 2009–2014 aus dem bestehenden Listing-Snapshot-Bestand.
3. Bounded-Price-Cohort-Inventar 2009–2014:
   - 23.165 beobachtete Listing-Zeilen,
   - 5.780 Tickerstrings,
   - 2.028 valide Preisdateien,
   - 8.179 Zeilen mit mindestens einem vorherigen Kursbalken,
   - 8.042 Zeilen mit mindestens 126 vorherigen Balken,
   - 7.925 Zeilen mit mindestens 252 vorherigen Balken,
   - 14.070 fehlende oder nicht valide Zuordnungen.
4. SEC-Identity-, Form-25/15-, FINRA-, CAT- und Nasdaq-Punktbelege aus dem versiegelten V94-Korpus.
5. Nur bereits rechtmäßig gespeicherte oder später nachweislich kostenfreie Quellen; keine Accounts, Trials, Schlüssel, Vertragsannahmen oder Käufe.

## Deterministische Kohortengrenze

Eine Zeile ist nur für eine spätere, separat versiegelte Machbarkeitsauswertung zulässig, wenn:

1. sie in einem archivierten Nasdaq-/Otherlisted-Punktzustand 2009–2014 tatsächlich beobachtet wurde;
2. die Preisdatei exakt durch den im bestehenden Inventar gebundenen Tickerstring adressiert wird;
3. mindestens 252 vorherige datierte Balken vorhanden sind;
4. kein im V94-Korpus bekannter Ticker-Reuse-, Multi-CIK-, Multi-Symbol-, Share-Class- oder Nachfolgerkonflikt die Zuordnung mehrdeutig macht;
5. keine fehlende Identität synthetisch ergänzt wird;
6. die Zeile nicht zur Behauptung eines kontinuierlichen Listingintervalls, eines letzten Handelstags oder einer Delisting-Rendite verwendet wird.

Der nach diesen Regeln verbleibende Umfang ist erst nach Versiegelung des Selektors zu bestimmen. Die oben genannten 7.925 Zeilen sind deshalb eine obere Abdeckungsgrenze, kein vorweggenommenes Analysesample.

## Zulässige Fragen

- Wie groß ist die reproduzierbare Preis- und Identitätsabdeckung je beobachtetem Archivzeitpunkt und Listingdatei-Typ?
- Welche Anteile scheitern an fehlenden Preisdateien, unzureichender Historie oder mehrdeutiger Identität?
- Welche der kostenlosen Quellenfamilien reduziert welchen klar benannten Datenfehler?
- Welche Marktmerkmale wären in der streng gefilterten Kohorte technisch berechenbar, ohne sie als Punkt-in-Zeit-konforme Original-V4-Signale auszugeben?
- Welche verbleibenden Datenverträge verhindern eine generalisierbare Früherkennungsaussage?

## Gesperrte Fragen und Endpunkte

Bis zu einer eigenen Vorabversiegelung und auch danach ohne geeignete Daten ausdrücklich verboten:

- Original-V4 H-LATE oder H-FEM Support/Reject/Inconclusive,
- Full-Universe-Präzision, Recall oder Handoff-Raten,
- Pre-Breakout-Performance,
- Survivorship-safe Renditen oder Delisting-Renditen,
- technische Signalrenditen, Squeeze-/Volumenbehauptungen oder terminale Performance,
- kontinuierliche Listing-, Identitäts- oder Abwesenheitsbehauptungen,
- Umdeutung von Codex-Agents als natürliche Personen oder HUMAN-Attestation.

## Mindestprüfungen vor Versiegelung

1. Ein deterministischer Selektor mit ausschließlich vorab genannten Feldern.
2. Ein eigenständiger Codex-Subagent-Audit für Methodik, ein zweiter für Datenbindung und ein dritter für Gegenbeispiele.
3. Hashmanifest über Scope, Selektor, Eingangsmanifeste und alle Verifier.
4. Negative Tests für Ticker-Reuse, Multi-CIK, unzureichende Historie, spätere Corporate-Action-Faktoren, fehlende Dateien und Outcome-Injektion.
5. Explizite Bestätigung, dass weder Original-V4-Outcomes noch Public-AI-Endpunkte vor der Versiegelung gelesen wurden.

## Was diesen Pfad später erweitern darf

Nur eine neue kostenlose Quelle mit mindestens einer bisher fehlenden Semantik:

- historische Gültigkeitsintervalle,
- konsolidierte historisch angepasste OHLCV,
- vollständige Corporate Actions,
- beobachtete Terminal-Sessions,
- Delisting-Renditen beziehungsweise letzte Zahlungen.

Weitere reine Punktzustände oder aktuelle Ticker-Preisdateien ohne neue Semantik erweitern den Anspruch nicht.

## Ergebnis-Sperre

- `resultComputationAllowed=false`
- `outcomesAccessed=false`
- `productiveGqsModified=false`
