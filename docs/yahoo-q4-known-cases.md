# C2: Yahoo-Q4-Handtabelle, 28.09.2026

> **Auf einen Blick:** 25 belegte falsche Quartalswerte werden ersetzt, zwei Gestamp-Werte bleiben mit Begründung leer.
> - Zehn Fälle betreffen 27 Zellen auf 17 Notierungen; alle 44 Kontrollzellen bleiben unverändert.
> - 16.015 echte Snapshots geprüft: 15.998 vollständig unverändert, alle anderen Eingabezeilen und alle Quelldatei-Hashes identisch.
> - Kein Commit, Push oder Aufspielen; Claude prüft den endgültigen Stand vor der Veröffentlichung.

Auftrag: C2 = B2', Karls Wunsch W2, Sitzung 76c9ee18, Basis b2f74e31df7222a36dff1183c949c62a390ba351.
Die Primärquellenprüfung vom 27.09. ist als unabhängige Testgrundlage erhalten: 27 WRONG, 22 CORRECT, 22 UNDECIDED.

## Wirkungsbereich

Die Tabelle bindet Notierung, Quartalsende, Kennzahl, native Währung, Einheit, falschen Lieferwert und den dazugehörigen Jahreswert. Bei datierten Jahresreihen muss das Jahresdatum passen; bei undatierten alten FTS-Reihen darf der exakt belegte Jahreswert an jeder Position stehen. Ein neu vorangestelltes Geschäftsjahr hebt die Korrektur eines weiterhin exakt falschen Q4 nicht auf. Andere Kennzahlen oder Jahre werden nicht bearbeitet. Überschneidungen mit der Währungs-Handtabelle werden beim Laden abgewiesen.

Neue Abrufe erhalten die Korrektur vor der vorhandenen USD-Umrechnung. Wiederverwendete Snapshots werden beim Lesen für Haupt- und Smallcap-Scoring korrigiert; Quality übernimmt dasselbe Universum. Findash-Belegzähler, Rule40, neue Board-Historien, der Datenqualitätsbericht, die Quartalsfrische-Prüfung und die Smallcap-Routingbegründung lesen dieselbe Korrektur. Es gibt weder einen neuen Abrufzyklus noch eine Änderung der Währungslogik. Alte Historien werden nicht umgeschrieben.

Die Tabelle wird bereits beim Start von `pull-yahoo.js` geladen und validiert. Ein Konfigurationsfehler beendet den Start vor dem Abruf. Laufzeitfehler der Korrektur tragen `YAHOO_Q4_HAND_TABLE_FAILED` und werden bis zum Prozessabbruch weitergereicht; sie werden niemals zu `fxConversionFailed` oder `fx-unknown` mit Snapshot-Löschung.

Bei USD-Caches muss der gespeicherte Wert exakt dem falschen nativen Wert mal dem nachgewiesenen gespeicherten Kurs entsprechen. Nur der Ersatzwert wird einmal mit diesem Kurs umgerechnet. Alle anderen Zahlen bleiben unverändert. Die Quelldatei wird nicht geschrieben.

Jede Änderung trägt unmittelbar neben dem Wert `yahooQ4Correction`: originale Lieferantenzeile, nativen Originalwert, Ersatzwert oder Grund, Währung, Quellen, Datentypen der Veröffentlichungsdaten, Rechenoperanden und Quellenstand. Ein veränderter Lieferwert/Jahresfingerabdruck wird als `stale` gezählt und protokolliert; der Wert bleibt stehen. Neue Rechenmuster außerhalb der Tabelle liefern ausschließlich Beobachtungen. Schon korrigierte Werte bleiben identisch.

`currencyAtCorrection` und `fxFactorAtCorrection` beschreiben ausdrücklich den Eingang zum Zeitpunkt der Korrektur: beim frischen Abruf native Währung und Faktor 1, beim bereits umgerechneten Cache USD und dessen gespeicherten Kurs. Sie behaupten keine aktuelle Währung nach einer späteren Umrechnung; diese steht weiterhin in `meta`.

Die Prozesszähler heißen `corrected`, `missing`, `stale`, `observed`, `alreadyCorrected`. Der echte Eingabelauf ergab 25 Ersatzwerte, zwei Lücken, null veraltete Tabellenfingerabdrücke und 23 reine Beobachtungen. Zähler zählen Aufrufe, nicht weltweit eindeutige Firmen.

Nach Verarbeitung mindestens eines benannten Snapshots erscheint beim Prozessende genau eine Zusammenfassungszeile, bei `stale > 0` oder `observed > 0` als GitHub-Actions-`::warning::`, sonst als normales Protokoll. Ein bloßer Modulimport oder eine fehlende Datei erzeugt keinen Lauf. Beobachtungen ändern den Exitcode nicht. Das Manifestfeld heißt **`yahooQ4HandTable`**; Zwischenstand, vollständiges und schlankes Pull-Manifest enthalten die Zähler dieses Laufs, das zusammengeführte Manifest summiert die Teil-Läufe und prüft Typ sowie Zahlenbereich. Die Prozesszusammenfassung bleibt über alle Aufrufe kumulativ.

Die vollständige Leserzuordnung steht in `tests/fixtures/yahoo-q4-reader-policy.json`: 61 Produktionsdateien mit Quartalsfeld oder passendem Scoring-Import haben eine Anbindung beziehungsweise einen begründeten Ausnahme-Eintrag. Der Wächter erfasst auch relative und über `path.join` zusammengesetzte Importe. Auch die Routing-Auswahl der drei SEC-Aufbereiter verwendet korrigierte Eingaben; ihre Jahresbelege bleiben unverändert. Reine Rechenfunktionen erhalten korrigierte Eingaben; rohe Anbieterdiagnostik, Notierungs-Fingerabdrücke und eingefrorene Forschungs-/Historienbelege bleiben ausdrücklich roh. Der Wächter findet neue, noch nicht eingeordnete Leser sowie entfernte Anbindungen.

## Zehn Fälle, 27 Zellen

Alle Beträge sind vollständige native Währungseinheiten, Periode 2025-12-31. Quellen, Originalbegriffe, Seiten und Datentypen stehen je Fall in `configs/yahoo-q4-known-cases.json`.

| Notierungen | Feld | Alt | Neu | Währung |
|---|---|---:|---:|---|
| 1AENA.MI, AEN2.VI, AENA.MC, ANNSF | opIncQ | 1713004000 | 736818000 | EUR |
| 1IDR.MI, IDR.MC, IDR.VI | revenueQ | 3006858000 | 1845300000 | EUR |
| 1REP.MI, REP.DE, REP.MC, REP.VI, REPYF | opIncQ | 1691000000 | 739000000 | EUR |
| 1REP.MI, REP.DE, REP.MC, REP.VI, REPYF | revenueQ | 26923000000 | 13724000000 | EUR |
| 8150.TW, IMOS | grossProfitQ | 1400430000 | 935488000 | TWD |
| 8150.TW, IMOS | opIncQ | 751593000 | 635560000 | TWD |
| 8150.TW, IMOS | revenueQ | 12053400000 | 6521076000 | TWD |
| GEST.MC | opIncQ | 260897000 | null | EUR |
| GEST.MC | revenueQ | 5504684000 | null | EUR |
| PHM.MC, PHM.VI | opIncQ | 39649000 | 43608000 | EUR |

Gestamp: Jahresbericht, englischer/spanischer Neunmonatsbericht und CNMV-Fundstelle geprüft. Der englische Bericht nennt ausdrücklich „Rounding adjustments“ (S. 3); 9M-Umsatz 8486,0 Mio. und Betriebsergebnis 398,8 Mio. stehen gerundet auf S. 7. Der direkte CNMV-Abruf lief in ein Zeitlimit. Exakte Neunmonatsoperanden wurden nicht etabliert; beide Lücken tragen `known wrong, exact Q4 not established`. [Gestamp 9M](https://www.gestamp.com/Gestamp11/media/GestampFiles/Shareholders%20Investors/Economic%20Financial%20information/Quarterly%20Information/2025/2025_10_30-Q3-2025-Management-Report.pdf?ext=.pdf).

Indra verwendet das direkt veröffentlichte Q4, nicht die Differenz einzeln gerundeter Jahreszahlen. ChipMOS-Bruttogewinn verwendet den berichteten konsolidierten Zwischensaldo einschließlich Altmaterial-Veräußerungsgewinnen; der abweichende Yahoo-Jahressaldo ist ausschließlich Fingerabdruck. Die ergänzende Q4-Präsentation sagt „(NT$ Millions)“ (S. 13), während die primären FY/9M-Abschlüsse Tausend verwenden; ein eigener Test schützt diese Unterscheidung. [ChipMOS-Präsentation](https://www.chipmos.com/upfiles/ADUpload/english/en_ir_planner_1850867603.pdf).

## Heute veröffentlichte Board-Zeilen und Gegenlauf

Geprüft gegen `origin/gh-pages` 0c7f9e0236c6e7db5228359c444343813ff46429, Exportstand 26.09.2026, etwa 09:05 UTC. Hauptauswahl: 1REP.MI (Energy #65), IDR.VI (IT Services #21). Zusätzlich Vollboards: AEN2.VI (Industrials #394), GEST.MC (Consumer Discretionary #471), PHM.VI (Health Care #619), IMOS (Semiconductors #168). Quality zeigt AEN2.VI #67 und IDR.VI #81; Rule40 zeigt IDR.VI #417.

Der vollständige Gegenlauf nutzt dieselben 16.011 watchlist-zugelassenen Snapshots und die vorhandenen SEC-Jahresdaten. Die sechs Growth-Ausgangsscores stimmen mit dem veröffentlichten Stand überein.

| Notierung | Growth-Score vorher → nachher | Sichtbares Umsatzwachstum vorher → nachher |
|---|---:|---:|
| 1REP.MI | 64,9 → 64,9 | +35,48 % → +35,48 % |
| IDR.VI | 69,9 → 69,9 | +43,49 % → +43,49 % |
| AEN2.VI | 64,5 → 64,5 | +9,48 % → +9,48 % |
| GEST.MC | 52,6 → 47,3 | +3,49 % → −5,44 % |
| PHM.VI | 27,8 → 27,8 | −12,04 % → −12,04 % |
| IMOS | 45,3 → 45,3 | +28,72 % → +28,72 % |

Gestamps Umsatzbelege fallen von fünf auf vier. Das bestehende Wachstumsverfahren fällt auf den Jahresvergleich zurück; dessen Rule-of-X-Beiwert wird −11,5 statt +9,0. Die Q4-Felder selbst sind leer. Die beiden aktuell sichtbaren Quality-Scores bleiben 77,6 und 43,2. Künftige Ränge können sich durch neue Eingangsdaten und Kohorten ändern; dies ist ein Gegenlauf, keine Veröffentlichung.

## Prüfungen und Nachstellen

`node tests/yahoo-q4-known-cases.test.js`: Prüfblöcke mit gesetztem `SCREENER_SNAPSHOTS_DIR`, einschließlich 71 Belegzellen, Null/Einheit/Währung/Periode/Feld/Fingerabdruck, aller Notierungen, nativer Umrechnung, Caches, Scoring-/Export-/PIT-Lesern, Prozessabbruch, Manifesten und Zusammenfassung. Die absichtlichen Brüche entfernen eine Tabellenzeile, entfernen die Board-Historien-Anbindung und stellen die alte Jahresposition-0-Regel wieder her — ausschließlich in Speicherkopien: Grün → Rot → Grün. Originaldateien und ihre Hashes bleiben unverändert. Die Fremdfeld-Prüfung behält das korrigierbare Originalfeld und verlangt zugleich, dass das zusätzlich belegte Fremdfeld unverändert bleibt.

`node scripts/yahoo-q4-known-cases-replay.js <snapshot-dir>`: genau 27 Änderungen, 44 Kontrollen; alle sonstigen Zeilen serialisieren identisch, alle Quelldatei-Hashes sind vorher/nachher gleich. Aggregierter SHA256: `38d131b24a40ea550ddad4f9df019a82aa2e8c7c0985d245e6c2e000467798e1`.

`node scripts/yahoo-q4-known-cases-board-replay.js <snapshot-dir>`: heutige veröffentlichte Zugehörigkeit sowie Growth-/Quality-Gegenlauf. Beide Skripte lesen ausschließlich; Ausgabe geht an stdout.

Der vorhandene GQS-Hashwächter erfasst auch den Snapshot-Leser. Dessen exakter neuer Hash ist im bestehenden offenen Übergang mit C2-Auftrag und Messbeleg registriert. Der Wächter besteht mit null Score-/Rangabweichungen seiner Golden-Fixtures; ein falscher Übergangs-Hash wurde unabhängig absichtlich abgewiesen. Eingefrorene Nachweise bleiben erhalten.

Unabhängige Astra-Prüfung abgeschlossen, keine offenen Befunde, Urteil 98 %. Die Quellenetikett-Korrektur wurde gegen die Primärquelle reproduziert und mit einem Test abgesichert.

Der unabhängige Opus-Prüfer hat den Stand `0896df8011` außerhalb der Sandbox mit `node scripts/test-gate.js --mode=all` geprüft und **709/709 grün** gemeldet. Die genaue Nachzählung seines `gate.out` ergibt **577/577 erfolgreiche Testdateien**; die 709 PASS-Zeilen enthalten zusätzlich 132 Ausgaben interner Untertests. Das externe Ergebnis bleibt vollständig grün. Die 25 Ersatzwerte wurden dabei gegen die primären PDFs bestätigt. Die zweite Runde behebt die anschließend gemeldeten Leser-, Fehlerpfad-, Jahreswechsel- und Nachweisbefunde; sie ist kein Commit und keine Freigabe durch den Erbauer.

Folgeaufträge, ausdrücklich nicht Teil dieser Korrektur: Gestamp `grossProfitQ` für 2025-12-31 erst nach primärem Beleg untersuchen; den sichtbaren Gestamp-Lückengrund in findash ergänzen. Der Bruttogewinn bleibt hier eine reine Beobachtung und wird nicht geändert.

Problem → Lösung → Nutzen: 27 falsche Q4-Zahlen → eng begrenzte Handtabelle mit Wächter → belegte Werte beziehungsweise begründete Lücken wirken beim nächsten Scoring auch aus bestehenden Snapshots.
