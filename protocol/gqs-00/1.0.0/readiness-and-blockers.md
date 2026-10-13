# Readiness und Blocker

Stand: 8. August 2026. Verantwortlichkeit bezeichnet die nächste ausführende Rolle, keine bereits erteilte Freigabe.

| Gegenstand | Status | Verantwortlichkeit | Exit-Kriterium |
|---|---|---|---|
| Produktionscommit-Zuordnung 7. August | READY | GQS-Freeze | Workflowcheckout, Board-/Datencommit und Scoring-Tree belegt; abgeschlossen. |
| `GQS-00@1.0.0` Register und Hash | READY | GQS-Freeze | Kanonischer SHA-256, 13 Zweige und Sourcehashes bestehen Verify-Lauf. |
| Golden-Fixtures und Volltraces | READY | GQS-Freeze | 25 Realfälle + Tie; alle Pflichtfälle; deterministischer Rebuild und Negativtest grün. |
| Score-/Ranggleichheit | READY | GQS-Freeze | 14.654 rohe Ergebniszeilen und 8.763 publizierte Zeilen ohne Abweichung. |
| Dauerhafte Vollsnapshot-Retention | NOT_READY | Datenpipeline | Jeder produktive Lauf schreibt unveränderliches Payload-/Manifestartefakt mit dauerhafter Retention und Rebuildtest. |
| Entity-/Listing-Ledger | NOT_READY | PIT Foundation M1 | Effekt-datierte Listings/Events; 500er Audit ≥99,5 %; keine überlappenden Primärlistings. |
| Append-only SEC-as-filed Store | PARTIALLY_READY | PIT Foundation M2 | Acceptance-Zeitpunkte, Payloadrevisionen, Original/Amendment, Idempotenz und Hash-Rebuild vollständig. |
| Historische Universe-Mitgliedschaft | NOT_READY | PIT Foundation M3 | Stichtagsvintages seit Pilotstart mit regelversioniertem Manifest; Delistete bleiben erhalten. |
| As-of-Query / Leakage-Gate | NOT_READY | PIT Foundation M3 | 100 Leakage-Fixtures, 0 Verstöße gegen `known_at<=t`. |
| Historischer GQS-00 Snapshotadapter | NOT_READY | PIT Foundation M3 | Heutige Goldenfälle reproduziert; historische Inputs ausschließlich aus damals bekannten Facts. |
| Adjusted Prices / Corporate Actions / Delistings | PARTIALLY_READY | PIT Foundation M4 | Alle Pilotlistings, verifizierte Delistingterms, Splits/Spins/Merger; ungeklärt ≤5 %. |
| Historischer PIT-Consensus | NOT_FOUND | spätere Quellenentscheidung | Lizenzierte, revisionssichere Consensus-Snapshots oder Faktor bleibt in neuer Version ausgeschlossen. |
| SEC-US GES-Präregistrierung | READY | Research Governance | JSON- und Scoped-Hash versiegelt; Formeln, Splits, Metriken und Kill-Kriterien fix. |
| SEC-US Pilot ausführen | NOT_READY | Research nach M0–M6 | Alle Foundation-Gates grün und unabhängiger Readiness-Audit bestanden. |
| Globale PIT-Ausweitung | UNKNOWN | spätere Architekturentscheidung | SEC-US-Pilot technisch bestanden; Entity-, Filing-, Preis- und Lizenzquellen je Region belegt. |

Die Readiness-Ampel ist damit zweigeteilt: **Baseline grün**, **PIT-/Pilot-Ausführung rot**. Rot bedeutet hier nicht gescheitert, sondern bewusst nicht freigegeben: Es liegen noch keine Pilotresultate vor, und das Protokoll verbietet ihre Berechnung vor Schließung der Daten-Gates.
