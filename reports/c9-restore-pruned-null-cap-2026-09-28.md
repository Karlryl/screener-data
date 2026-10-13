# C9 – Wiederaufnahme verlorener Firmen, 28.09.2026

> **Auf einen Blick:** Fünf Firmen wieder aufgenommen; 13 weitere Kandidaten hätten bestehende Emittenten verdoppelt.
> - Alle fünf starten im Probelauf am 29.09. ganz vorn und durchlaufen Summary plus vier Finanzreihen-Abrufe.
> - 21.253 andere verarbeitete Ticker behalten Reihenfolge, Abrufart und Budget; 3.000 Quartalsnachladungen unverändert.
> - Keine Commits oder Pushes. 74 Testdateien bleiben durch Python-Starts in der Sandbox blockiert.

## Änderung und Herkunft

Grundstand: `b2f74e31df7222a36dff1183c949c62a390ba351`. Watchlist: 21.704 → 21.709 Einträge. Fünf historische Objekte wurden vollständig übernommen; die ursprünglichen Aufnahmedaten bleiben bestehen.
Die Abwesenheitsuhr beginnt für die Wiederaufnahme am 28.09. Neu ist `restoreFullPullOn: "2026-09-29"`: Dieser Watchlist-Schlüssel priorisiert ausschließlich an diesem UTC-Tag und ausschließlich bei fehlender Snapshot-Datei. Es gibt keine Änderung an Prune-Regeln, Größenfiltern, Kurs-/Aktienzahlrechnung oder Scoring.
Die Priorisierung ist eine stabile Aufteilung nach der bisherigen Sortierung. Alle übrigen Ticker behalten ihre relative Reihenfolge. Nach einem erfolgreichen Abruf oder ab 30.09. hat das Feld keine Wirkung. Die 13 bestehenden Emittenten werden weder entfernt noch umgestellt.

| Wiederaufnahme | Historischer Eintrag | Gruppe (0-basiert) | Platz vorher → nachher | Vollabruf im Probelauf |
|---|---|---:|---:|---|
| 066970.KS | 4f5251dc40^:watchlist.json | 11 | 1034 → 1 | ja, Summary + 4 Finanzreihen |
| 300475.SZ | 70cd98a10c^:watchlist.json | 10 | 980 → 1 | ja, Summary + 4 Finanzreihen |
| 600019.SS | 70cd98a10c^:watchlist.json | 4 | 951 → 1 | ja, Summary + 4 Finanzreihen |
| 600486.SS | 70cd98a10c^:watchlist.json | 10 | 1019 → 2 | ja, Summary + 4 Finanzreihen |
| OV8.SI | 70cd98a10c^:watchlist.json | 10 | 1194 → 3 | ja, Summary + 4 Finanzreihen |

## Ausgelassene Doppelnotierungen

| Kandidat | Bereits vorhandene Notierung(en) |
|---|---|
| 600547.SS | 1787.HK |
| 601288.SS | 1288.HK, ACGBF, EK7.VI |
| 601800.SS | 1800.HK |
| ASTRAZEN.BO | ASTRAZEN.NS |
| CARL-B.CO | CARL-A.CO, CARL.VI, CARL.WA, CABHF, CABJF |
| FCC.MC | FMOCF |
| GENTERA.MX | CMPRF |
| MCX.NS | MCX.BO |
| NPI.TO | NPIFF |
| RECLTD.NS | RECLTD.BO |
| RELIANCE.NS | RELIANCE.BO |
| VIG.VI | 1VIG.MI, WSV2.SW |
| WDS | WDS.AX |

Der zusätzliche FCC-Fund ist im vorhandenen FMOCF-Snapshot mit `"name": "Fomento de Construcciones y Contratas, S.A."` belegt. Bei 1787.HK, 1288.HK und 1800.HK stimmen die gespeicherten Firmennamen mit den historischen A-Aktien-Einträgen überein. Die anderen Zuordnungen stehen in der Watchlist und in C3. Die fünf verbleibenden Namen/Varianten haben weder in der Haupt-/Smallcap-Watchlist noch in den gelieferten Snapshot-Namen ein weiteres passendes Bein.
1URI.MI und PHK bleiben ausgeschlossen. Die anderen 645 gestrichenen Ticker wurden nicht untersucht; keine neue Abdeckungszahl erhoben.

## Nachweis des Abrufs

Prüfuhr: `2026-09-29T02:17:00.000Z`. Echte Selektionsfunktionen `planReload`, `mergeCandidates`, `sortByStaleness` und `pullAll`; Yahoo-Antworten und Schreibzugriffe virtuell. Die Namen werden durch die bestehende Smallcap-Eigentumsprüfung geleitet.
Veröffentlichte Ranglisten: `2026-09-26T09:05:35.367Z`, aus dem vom produktiven Ranglisten-Lader verwendeten gh-pages-Pfad. 4.011 Quartalskandidaten; Auswahl unverändert genau 3.000. 21.258 Ticker verarbeitet, davon fünf Wiederaufnahmen. Alle fünf sind Vollabrufe und belegen die ersten ein bis drei Plätze ihrer Gruppen.
Gegenlauf: gleiche Daten, Wiederaufnahme-Priorität deaktiviert. Null Änderungen bei übrigen Watchlist-Zeilen samt Metadaten, übriger relativer Reihenfolge, ausgeführter Abrufart und beobachtetem Fundamentaldaten-Budget. Die Quartalsauswahl wurde zusätzlich ohne die fünf Wiederaufnahmen verglichen und ist identisch.
Watchlist sowie eingelesene Snapshot-/Cache-Dateien sind nach der Prüfung SHA256-identisch. Prune wurde mit dem vollständigen Watchlist-Abbild und den aktuellen Eingabedaten auf einer virtuellen Kopie ausgeführt; alle fünf bleiben erhalten.
Der Probelauf belegt Planung und Codepfad. Erfolgreiche echte Yahoo-Antworten und Laufzeitabschluss am Dienstag bleiben abhängig von Veröffentlichung vor Laufbeginn und Anbieter-/Runner-Verfügbarkeit.

Wiederholen: `node scripts/check-restored-null-cap-pulls.js` mit `SCREENER_SNAPSHOTS_DIR` auf dem im Auftrag angegebenen usd-snap, `C9_BOARD_DIR` auf `_scratch/c9-boards` und `C9_CACHE_DIR` auf dem Hauptrepo-Verzeichnis `fundamentals-cache`. Alle Verzeichnisse sind reine Leseeingaben; der Bericht geht auf stdout.
Der feste Vergleichsstand statt `HEAD` ist absichtlich gewählt: Ein unabhängiger Prüfer stellte nach, dass `HEAD` nach dem Commit bereits die Wiederaufnahmen enthält und den Vergleich fälschlich rot färben würde. Behoben im Prüfskript, Grundstand in der Fixture festgehalten.

## Tests und Prüfung

`node tests/restore-pruned-null-cap.test.js --break-once`: grün. Präsenz, Herkunftsfelder, Abwesenheitsuhr, Ausschlüsse und Emittenten-Dubletten geprüft; realer Prune-Pass; echte Vollabrufe; Ablaufdatum und vorhandene Snapshots als Gegenfälle.
Vier absichtliche Brüche auf In-Memory-Kopien werden erkannt: fehlende 300475.SZ, hinzugefügte PHK, hinzugefügte FCC.MC und veraltete Abwesenheitsuhr. Live-Watchlist SHA256 vor/nach jedem Bruch unverändert.
Unabhängige blinde Prüfung: Codex / GPT-6 Astra, ultra. Keine offenen blockierenden Befunde; Urteilssicherheit des Prüfers 96 %.

Vollsuite: `node scripts/test-gate.js --mode=all`; Git/bin vor PATH; `SCREENER_SNAPSHOTS_DIR` exakt wie beauftragt. NODE_PATH nutzte die bereits installierten Hauptrepo-Abhängigkeiten. Ergebnis: 577 Dateien, 501 grün, 76 rot, Exit 1.
Zwei lokale Paketpfadfehler wurden durch Kopieren der vorhandenen yahoo-finance2-Installation in das ignorierte node_modules behoben und separat grün nachgeprüft: `tests/refresh-universe.test.js` (75/0) und `tests/scoring/f1-ausschuettungsfelder.test.js` (7/0). Kein Download und keine Änderung an Tests oder Bibliothek. Damit 503 geprüfte Dateien grün; 74 bleiben umgebungsbedingt rot.
Alle 74 erneut mit unveränderter Rückgabe von spawnSync beobachtet: Python-Start EPERM; bei studie-t173-formtyp und studie-c0 zusätzlich python3 ENOENT. Das sind keine bestandenen Tests. Studienpfad und lockbox wurden nicht geöffnet. Keine Testabschwächung.

### Exakte verbleibende Sandbox-Fehler

- `tests/early-detection-blind-coding.test.js`: python EPERM
- `tests/early-detection-pit-compact.test.js`: python EPERM
- `tests/early-detection-pit-compare.test.js`: python EPERM
- `tests/early-detection-pit-integrity.test.js`: python EPERM
- `tests/early-detection-pit-orphan-audit.test.js`: python EPERM
- `tests/early-detection-pit.test.js`: python EPERM
- `tests/studie-a5-form25-abgleich.test.js`: python EPERM
- `tests/studie-attrition-size-sector.test.js`: python EPERM
- `tests/studie-bridge-proof-modeguard.test.js`: python EPERM
- `tests/studie-cadence-edge-bias.test.js`: python EPERM
- `tests/studie-censoring-aware-attrition.test.js`: python EPERM
- `tests/studie-d-artifact-backcalc.test.js`: python EPERM
- `tests/studie-descriptive-closure-audit.test.js`: python EPERM
- `tests/studie-e3-praereg.test.js`: python EPERM
- `tests/studie-e4a-diagnose.test.js`: python EPERM
- `tests/studie-e4d-kadenz.test.js`: python EPERM
- `tests/studie-e4g-restursachen.test.js`: python EPERM
- `tests/studie-e4h-serienende.test.js`: python EPERM
- `tests/studie-entry-cohort-standardization.test.js`: python EPERM
- `tests/studie-f1-datenfundament.test.js`: python EPERM
- `tests/studie-f6-anhang3.test.js`: python EPERM
- `tests/studie-f6-klumpen-se.test.js`: python EPERM
- `tests/studie-f6-lauf.test.js`: python EPERM
- `tests/studie-f6-prg-naehte.test.js`: python EPERM
- `tests/studie-f6-vollzug-zweig-a.test.js`: python EPERM
- `tests/studie-f6-zaehlprobe-fortsetzung.test.js`: python EPERM
- `tests/studie-f6-zaehlwerk.test.js`: python EPERM
- `tests/studie-herkunft.test.js`: python EPERM
- `tests/studie-identifier-bridge.test.js`: python EPERM
- `tests/studie-identity-bridge-artifact.test.js`: python EPERM
- `tests/studie-panel-digest.test.js`: python EPERM
- `tests/studie-panel-survival.test.js`: python EPERM
- `tests/studie-post-mortem-obduktion.test.js`: python EPERM
- `tests/studie-r1-bestaetigbar-zugriff.test.js`: python EPERM
- `tests/studie-rr9-a2-nullpunkt-repro.test.js`: python EPERM
- `tests/studie-rr9-bremsen.test.js`: python EPERM
- `tests/studie-rr9-nullpunkt.test.js`: python EPERM
- `tests/studie-t173-formtyp.test.js`: python EPERM; python3 ENOENT
- `tests/studie-threshold-seal.test.js`: python EPERM
- `tests/studie-vb-b3-spaltung.test.js`: python EPERM
- `tests/studie-vb-b4-band.test.js`: python EPERM
- `tests/studie-zaehlprobe.test.js`: python EPERM
- `tests/early-detection-commoncrawl-filings.test.js`: python EPERM
- `tests/early-detection-commoncrawl-static.test.js`: python EPERM
- `tests/early-detection-concept-audit.test.js`: python EPERM
- `tests/early-detection-concept-map-checkpoint.test.js`: python EPERM
- `tests/early-detection-concept-semantic-audit.test.js`: python EPERM
- `tests/early-detection-corporate-actions.test.js`: python EPERM
- `tests/early-detection-entity-bridge.test.js`: python EPERM
- `tests/early-detection-entity-listing-ledger.test.js`: python EPERM
- `tests/early-detection-filing-transport-decision.test.js`: python EPERM
- `tests/early-detection-foundation.test.js`: python EPERM
- `tests/early-detection-gqs-calendar.test.js`: python EPERM
- `tests/early-detection-gqs-inputs.test.js`: python EPERM
- `tests/early-detection-identity-transition-dossiers.test.js`: python EPERM
- `tests/early-detection-independent-final-audit.test.js`: python EPERM
- `tests/early-detection-midas.test.js`: python EPERM
- `tests/early-detection-midas-index.test.js`: python EPERM
- `tests/early-detection-nasdaq-directory-evidence.test.js`: python EPERM
- `tests/early-detection-nasdaq-symbols.test.js`: python EPERM
- `tests/early-detection-price-cohort.test.js`: python EPERM
- `tests/early-detection-research-metadata.test.js`: python EPERM
- `tests/early-detection-sec-company-tickers.test.js`: python EPERM
- `tests/early-detection-sec-filing-archive.test.js`: python EPERM
- `tests/early-detection-sec-filing-gap.test.js`: python EPERM
- `tests/early-detection-sec-filing-individual.test.js`: python EPERM
- `tests/early-detection-sec-index.test.js`: python EPERM
- `tests/early-detection-sec-oldloads.test.js`: python EPERM
- `tests/early-detection-sec-store-checkpoint.test.js`: python EPERM
- `tests/early-detection-sec-wayback.test.js`: python EPERM
- `tests/early-detection-sec-wayback-truncation-audit.test.js`: python EPERM
- `tests/early-detection-sic-routing.test.js`: python EPERM
- `tests/early-detection-web-archive.test.js`: python EPERM
- `tests/studie-c0.test.js`: python EPERM; python3 ENOENT; py EPERM

Problem → Lösung → Nutzen: Firmen waren nach fehlendem Marktwert verschwunden → fünf historische Einträge mit gezieltem einmaligem Vorrang wiederhergestellt → fünf zusätzliche Firmen zum Prüfen, ohne weitere Emittenten zu verdoppeln.
