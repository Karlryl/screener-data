# P1-Welle 7 — Meldung

## 1. Geänderte Dateien

- `audit-reports/2026-08-10-p1-welle7-meldung.md`
- `lib/e1-compression.js`
- `scripts/pull-13f-institutional.js`
- `scripts/write-newcomer-log.js`
- `scripts/prune-watchlist.js`
- `scripts/cadence-marker.js`
- `tests/p1-welle7-messbarkeit-wahrheit.test.js`

## 2. Befunde: Was und warum

- **B1 / F-CGPT-006:** E1 berichtet bei fehlendem Tagesverzeichnis oder null lesbaren Cohort-Boards `measurable:false`, `boardsRead`, Dateizähler und Einzeldateifehler, annotiert `::error::`, endet ungleich null und lässt einen vorhandenen State unangetastet. Ein fehlender State darf weiterhin als echte Erstanlage angelegt werden; ein vorhandener korrupter State wird vor der Board-Prüfung hart abgewiesen.
- **B2 / V-SK-003:** Der Research-Status verlangt nun neben zehn lebenden Instituten auch zehn höchstens **100 Tage** alte `fetchedAt`-Anker; sonst lautet er `stale`. 100 Tage entsprechen dem bestehenden Cache-TTL und decken einen 13F-Quartalswechsel samt 45-Tage-Meldefrist ab; Legacy-Einträge ohne Anker bleiben bis zum nächsten Pull kompatibel.
- **B3 / F-CGPT-031:** Gewählte Variante **partiell markieren**: Ein No-Base-Amendment gilt nur bei lesbarer Cover-Page `RESTATEMENT` als Vollbuch; `NEW HOLDINGS` und unbekannte Typen tragen `lowPositionAmendment:true` plus `amendmentType`. So bleiben die Zeilen diagnostisch erhalten, ohne Vollständigkeit vorzutäuschen.
- **B4 / F-CGPT-043-REST:** Eine leere Übersicht erzeugt bei Exit 0 eine rohe `::warning::`-Zeile und schreibt für den Tag `status:nicht-messbar`/`reason:uebersicht-leer` in die Monatsdatei. Der unlesbare und der bewusst stille fehlende-Übersicht-Zweig blieben unverändert.
- **B5 / F-CGPT-047:** Parse- und Schemafehler der Watchlist verwenden jetzt wie der Over-Prune-Guard eine rohe `::error::`-Annotation und Exit 1. Damit kann ein kaputter Eingang nicht mehr als erfolgreich übersprungener Prune erscheinen.
- **B6 / F-CGPT-044:** Gewählte Variante **unbekannt markieren**: Nach Backup einer kaputten Markerdatei werden beide Kadenzen zunächst explizit auf `unknown` und der Marker auf `partially-unknown` gesetzt, bevor nur das Zielfeld gestempelt wird. Der bestehende Selftest wurde nicht angepasst; der bestehende BH-128-Test wurde ebenfalls nicht verändert und läuft mit der verschärften Semantik grün.

## 3. Rot-zuerst und grüner Gesamtlauf

- Rot-zuerst wurde aus `git archive HEAD` in einem Temp-Verzeichnis ausgeführt; `node_modules` wurde verlinkt und nur der neue Test hineinkopiert. Ergebnis gegen den unveränderten HEAD: `RED_EXIT=1`, **0 bestanden, 6 fehlgeschlagen**; sichtbar waren unter anderem alter Cache weiterhin `active`, fehlender No-Base-Klassifizierer, keine Statusdatei für die leere Übersicht, Watchlist-Exit 0 und kein Abbruch/Unbekannt-Zustand beim kaputten Marker.
- Nach dem Fix: `P1-Welle 7: 6 bestanden, 0 fehlgeschlagen`.
- Grün-Pflicht-Anker: `bh-w2-13f.test.js: 15 ok, 0 fail`; die Datei blieb unangetastet.
- Gesamtlauf endete ausschließlich wegen der bekannten Sandbox-Ausnahme mit Exit 1: `FAIL: tests/early-detection-confirmatory.test.js`; `pip` konnte `numpy==2.3.5` wegen `Tunnel connection failed: 403 Forbidden` nicht installieren. Die letzten Zeilen des Laufs waren: `# pass 1`, `# fail 0`, `# duration_ms 11.394121`; alle übrigen Gate-Dateien waren grün.

## 4. Offene Punkte / Betriebs-Wirkung

- E1 kann beim täglichen Lauf nun rot werden, wenn das Tagesverzeichnis fehlt oder kein einziges lesbares Cohort-Board vorhanden ist; einzelne kaputte/kohortenlose Boards bleiben bei mindestens einem validen Board messbar, sind aber im Report gezählt (typisch 0, bei Defekt einzelne Dateien).
- Der manuelle 13F-Pull kann einen zuvor `active` aussehenden Bestand als `stale` ausgeben, sobald weniger als zehn lebende Einträge innerhalb von 100 Tagen aktualisiert wurden; bei normalem Quartalsbetrieb ist `active` unverändert zu erwarten.
- Der tägliche Newcomer-Lauf kann bei einer leeren Übersicht nun eine Warnung erzeugen (typisch höchstens eine Warnung und Statuszeile pro betroffenem Tag), bleibt aber bis zum Dienstag-Cron bewusst Exit 0.
- Der tägliche Prune endet bei kaputter Watchlist jetzt Exit 1. Der Aufrufer in `daily-pull.yml` hat weiterhin `continue-on-error:true`; die Sichtbarkeit entsteht daher heute über `::error::`, und das Entfernen von `continue-on-error` bleibt ausdrücklich außerhalb dieses Auftrags offen.
- Wochen-/Monatsmarker mit Parsefehler erzeugen nun eine Warnannotation und bewahren die Dead-Man-Semantik als `unknown` statt das Geschwisterfeld wegzulassen; normal lesbare Marker bleiben unverändert.
- Keine TABU-Zone und keine Daten-/Workflow-Datei wurde geändert. Der externe Masterplan war in der Linux-Sandbox nicht vorhanden und konnte daher nicht gelesen werden; der bindende Delegationsbrief enthielt den vollständigen Taskstatus.

## 5. Brief-Feedback

- Der Brief benennt die sechs Ausfallklassen, Gegenproben und erlaubten Sichtbarkeitskanäle so präzise, dass die Regressionen hermetisch ohne Netz reproduzierbar waren.
