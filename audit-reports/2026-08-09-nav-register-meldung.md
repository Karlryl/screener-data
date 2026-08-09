# NAV-Holdings-Register — Schlussmeldung

## 1. Geaenderte Dateien (vollstaendige Liste)

- `audit-reports/2026-08-09-nav-register-meldung.md`
- `data-health/nav-holdings.json`
- `scripts/filter-snapshot-merge.js`
- `tests/nav-holdings-register.test.js`

## 2. Was und warum (5 Saetze max)

Der Konsum-Ort ist `scripts/filter-snapshot-merge.js::run`, weil die CI-Kette `daily-pull.yml` Merge-Schritt „Filter merged snapshots to authorized watchlist universe“ → `filter-snapshot-merge.js` → gefiltertes `snapshots/`-Artefakt → Scoring-Job → `src/scoring/run-screener.js` nachweislich vor jedem Scoring-Einstieg liegt.
Das Register entfernt exakte Snapshot-Dateinamen aus dem weitergereichten Artefakt, laesst Watchlist und Shard-Eingang unangetastet und meldet jeden Lauf mit `NAV-Register: N Namen vom Scoring ausgeschlossen (<tickers>)`.
Aufgenommen sind SMT.L, ADX und AOD als belegte CEF/Trust-Anker (`tests/scoring/score.integration.test.js:516-557`, historischer Tag-440-Commit `06fec31fd4`) sowie III.L und INDU-A.ST als belegte NAV-/Investment-Holdings (dieselbe Teststelle, historischer Commit `53f1aeddec` vom 27.06.); BLK und BX fehlen absichtlich.
Register-Lese-, JSON-, Form-, Pflichtfeld-, Dubletten- und Ticker-Dateinamensfehler stoppen fail-loud, statt still gegen eine leere oder teilweise Liste weiterzulaufen.
`refresh-universe.js` blieb unveraendert, weil der Konsum nicht bei der Watchlist-Pflege, sondern erst im Merge-Flaschenhals vor dem Scoring liegt.

## 3. Test-/Verifikationsausgabe: Rot-Beweis + gruener Gesamtlauf

- **Rot zuerst:** `node tests/nav-holdings-register.test.js` am ungefixten Stand: Exit 1, `1 ok, 3 fail`; INDU-A.ST passierte die Vorstufe (`true !== false`), kaputtes JSON lieferte faelschlich Exit 0 und das Produktionsregister fehlte.
- **Nach Fix, deterministisch:** `node tests/nav-holdings-register.test.js`: Exit 0, `4 ok, 0 fail`; INDU-A.ST ausgeschlossen und sichtbar geloggt, NORMAL byte-identisch uebernommen, kaputtes Register fail-loud, Produktionsregister vollstaendig/ohne BLK und BX.
- **Vorgegebener Gesamtlauf:** `bash -c 'pip install --disable-pip-version-check --quiet numpy==2.3.5; fail=0; for f in tests/*test.js tests/scoring/*test.js lib/*test.js; do node "$f" || { echo "FAIL: $f"; fail=1; }; done; exit $fail'`: Exit 1 wegen Sandbox-Netzsperre (`pip` erhielt 403, daher `numpy` nicht installierbar); einzig protokollierter Fehlschlag war `tests/early-detection-confirmatory.test.js` mit `ModuleNotFoundError: No module named 'numpy'`, die NAV-Tests waren gruen und `score.integration.test.js` meldete erwartbar `18 ok, 0 fail, 16 skipped (kein Universum)`.
- **Diff-Grenze:** `git diff --stat`/`git status --short` zeigen keine Aenderung unter `src/scoring/`, `tests/scoring/`, `protocol/` oder Pfaden mit `early-detection` im Namen.

## 4. Offene Punkte / Unsicherheiten

- Der gewaehlte Ort deckt den CI-Scoring-Job ab: Der Merge-Job ruft das Skript auf und laedt genau dessen Zielordner `snapshots/` als Artefakt hoch; der Scoring-Job laedt dieses Artefakt und startet danach `src/scoring/run-screener.js`.
- Der Filter wirkt damit auch auf weitere Verbraucher desselben finalen Snapshot-Artefakts (laut bestehender Skriptdokumentation insbesondere `monthly-sec-xbrl.yml`); die Rohdaten werden dennoch weiter gepullt und bleiben im unberuehrten Shard-/Eingangsbestand.
- Der volle Gate kann in dieser Sandbox ohne das explizit verlangte, aber netzbedingt nicht installierbare NumPy nicht Exit 0 erreichen; es wurde kein verbotener Workaround gebaut.
- Die im Brief genannten historischen Commit-Objekte sind im vorliegenden gekuerzten Git-Bestand nicht aufloesbar; die Namen sind jedoch in der versionierten Integrationsanker-Datei gemeinsam und semantisch belegt.

## 5. Brief-Feedback (je 1 Satz)

- **Positiv:** Der Brief grenzt versiegelte Scoring-Zonen, erlaubte Dateien, Rot-Beweis und die CI-Kette aussergewoehnlich eindeutig ein.
- **Verbesserung:** Fuer einen flachen Cloud-Checkout sollten historische Belege zusaetzlich als erreichbare Datei-/Zeilenreferenz angegeben werden, damit Commit-Hashes nicht nur als unaufloesbare Metadaten uebernommen werden muessen.
