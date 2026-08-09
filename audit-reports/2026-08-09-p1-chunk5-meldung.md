# P1-Chunk 5 v2 — Schlussmeldung

## 1. Geänderte Dateien (vollständig)

- `audit-reports/2026-08-09-p1-chunk5-meldung.md`
- `scripts/restore-test-prices-max.ps1`
- `tests/waechter-absturz.test.js`
- `scripts/value-spot-check.js`
- `scripts/heartbeat-preis-abdeckung.js`
- `index.html`
- `tests/p1-welle5-pruefer-wahrheit.test.js`

## 2. Befund-Cluster: Was und warum

### Cluster A — F-CGPT-018 + AE-CI-006

Gewählt wurde Variante **(b)**: Count und Bytes werden weiterhin vollständig, Inhalte aber ausdrücklich nur als Stichprobe `20/N` ausgewiesen; die Grünmeldung sagt nun `KEIN Vollbeweis` statt „Backup ist echt“. Das ist der engste Wahrheits-Fix und vermeidet die potenziell sehr lange Vollhash-Laufzeit über tausende Dateien; PowerShell war in der Linux-Sandbox nicht installiert, deshalb erfolgte die Änderung als sorgfältiger Text-/Logik-Edit ohne Ausführung.

### Cluster B — NR1-SK-04

Der Meta-Wächter zählt nun geschweifte Klammern und berücksichtigt Strings, statt den Catch-Body mit einer Lazy-Regex am ersten `}…)` abzuschneiden. Damit wurde der echte Catch in `value-spot-check.js` am ungefixten HEAD als Verstoß erkannt und nach Cluster C wieder grün.

### Cluster C — F-CGPT-046 + NR1-SK-03

Ein nicht lesbarer Snapshot-Ordner sowie ein Absturz melden jetzt `::error::` und Exit 1; eine zu kleine Probe bleibt datenlagenbedingt Exit 0, heißt aber eindeutig `MESSAUSFALL` und trifft keine Aussage zur Wertequalität. `runCli` macht den Absturzpfad injizierbar testbar, und der eingebaute `--selftest` prüft diesen Pfad zusätzlich.

### Cluster D — F-CGPT-045

Alle drei Fehlerpfade des Heartbeats melden jetzt `::warning::MESSAUSFALL: <Grund> — keine Aussage ueber Abdeckung`; Exit 0 und die reine Messungssemantik bleiben unverändert. Der neue Test injiziert einen unlesbaren Watchlist-Zugriff und belegt Kennzeichnung plus Exit 0.

### Cluster E — AS-DOC-001 + AS-DOC-002

Die Startseite nennt nun den echten Rhythmus „werktags außer Montag (Di–Sa, Cron ca. 02:17 UTC; Veröffentlichung nach Abschluss)“. Keines der zehn behaupteten Fachartefakte besitzt unter den tatsächlich veröffentlichten `outputs/**` ein fachlich gleichwertiges Ziel, daher bleiben alle Karten sichtbar, werden aber einzeln link-los als „Derzeit nicht veröffentlicht“ markiert:

1. `screener.html` (Screener — Bloomberg View): link-los markiert.
2. `dashboard.html` (Dashboard — Leaderboards): link-los markiert.
3. `modes-report.html` (Modes-Report): link-los markiert.
4. `diff-report.html` (Diff-Report): link-los markiert.
5. `outputs/pick-diff.html` (Pick-Diff + Jaccard): link-los markiert.
6. `outputs/methodology-report.md` (Methodology-Report): link-los markiert.
7. `methods-report.html` (Methods-Report): link-los markiert.
8. `outputs/elliott-export-HYPERGROWTH.csv`: link-los markiert.
9. `outputs/elliott-export-QUALITY_COMPOUNDER.csv`: link-los markiert.
10. `outputs/elliott-export-TURNAROUND.csv`: link-los markiert.

## 3. Rot-zuerst-Ausgaben und Tests

### Cluster B/C — gehärteter Wächter gegen ungefixtes `value-spot-check.js` aus HEAD `26522ba407`

```text
FAIL   scripts/value-spot-check.js: meldet beim eigenen Absturz Erfolg (process.exit(0) im catch)

waechter-absturz: 55 Einstiegspunkte geprueft, 1 mit stillem Erfolg beim Absturz
RC=1
```

### Cluster B/C — nach dem Fix

```text
waechter-absturz: 55 Einstiegspunkte geprueft, 0 mit stillem Erfolg beim Absturz
```

### Cluster C/D — neuer Verhaltenstest

```text
ok   Cluster C: eigener Absturz wird ::error:: und Exit 1
ok   Cluster C: unlesbarer Snapshot-Pfad ist rot
ok   Cluster C: kleine Probe bleibt Exit 0, aber ist MESSAUSFALL
ok   Cluster D: Heartbeat-Messausfall bleibt Exit 0 und ist eindeutig

P1-Welle 5: 4 bestanden, 0 fehlgeschlagen
```

### Gesamtlauf — letzte Zeilen

```text
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 15.881181
FULL_RC=1
```

Der einzige Fehlschlag war die im Brief bekannte Sandbox-Ausnahme `tests/early-detection-confirmatory.test.js`: `pip install numpy==2.3.5` scheiterte am gesperrten Proxy mit HTTP 403, anschließend fehlte `numpy`; alle übrigen Standalone-Runner liefen durch. `git diff --check` war grün, und die verbotene-Pfade-Prüfung lieferte keine Treffer.

## 4. Offene Punkte / Workflow-Wirkungen

- `.github/workflows/weekly-guard.yml` wurde nur gelesen und nicht verändert: Sein Schritt `(c) Wert-Spot-Check` führt das Skript direkt aus und kann bei nicht lesbaren Snapshots oder einem Eigenabsturz jetzt korrekt mit rotem X enden.
- Das Restore-Handskript konnte mangels `pwsh` in dieser Linux-Sandbox nicht ausgeführt werden; offen bleibt ausschließlich ein optionaler Windows-Probelauf, nicht die Meldungssemantik.
- Keine Änderungen liegen unter `src/scoring/`, `tests/scoring/`, `protocol/`, `data-health/`, `.github/` oder Pfaden mit `early-detection` im Namen.

## 5. Brief-Feedback

Die explizite Unterscheidung zwischen Defekt, Messausfall und Messergebnis machte die erwarteten Exit- und Meldungssemantiken eindeutig prüfbar.
