**T331: Wellen belegt; 4/16047 = 0.02 % alte Fundamentaluhren und 242 erfolgreiche Vollabrufe im Lauf 35438100627 widersprechen sich nicht; ein konstanter 66-Tage-Zyklus ist daraus nicht ableitbar (Konfidenz 99 %).**

> AUF EINEN BLICK: Bestandsalter am CI-Stichtag und erfolgreiche Schreibvorgänge je Lauf haben verschiedene Nenner und Uhren. Das Budget gilt je Shard; ein Gesamtdeckel wäre eine andere Rechnung.

## 1. Messbasis und Fingerabdrücke

Population: C:\Users\Anwender\AppData\Local\Temp\claude\C--Users-Anwender-Market-Structure-research\754a849d-444e-4e77-98cd-1d62ad581fad\scratchpad\ci-merged-35500025507

Logs: C:\Users\Anwender\AppData\Local\Temp\claude\C--Users-Anwender-Market-Structure-research\0f60772b-789d-44ce-a22b-42e2f0e9d856\scratchpad\t331-logs

Populations-SHA256: 27841c97eb794fa02073cfab8bcf61a7a1edc10ac8c8626a0d4703aeda6d29ae

Erwarteter SHA256: 27841c97eb794fa02073cfab8bcf61a7a1edc10ac8c8626a0d4703aeda6d29ae

SHA256 pull-yahoo.js (Dateibytes): b8f8b4c7b01227834c0875b4e13194616c63f2955fc1eb8ba5a42fe18d354336

Hash-Methode identisch zu scripts/t-veraltung-zwei-definitionen.js: rekursiv je Verzeichnis lexikalisch sortierte JSON-Dateien; SHA256 über relative Pfade mit /, NUL, SHA256 der Dateibytes und LF; Manifest eingeschlossen. Keine angrenzenden Verzeichnisse gelesen.

Bestandsuhr: manifest.pulled_at = 2026-09-20T09:52:49.002Z; 16047/16048 JSON-Dateien sind Snapshots, 1 Metadaten-Datei(en). Lesbare meta.fundamentalsAsOf: 16047/16047; unbekannt: 0/16047; Abweichungen zum 4096-Byte-Kopf: 0/16047. Tagesverteilung aus vollständigem meta, UTC.

Log-Abdeckung 24.08.–20.09.2026: 36 gelieferte Läufe; 33/36 mit mindestens 2000000 Bytes, 3/36 nach Brief als „abgebrochen vor dem Pull“ markiert. Keine Nullmessung für kleine Logs. Für 24.08. liegt kein Lauf-Log vor. MB = 1.000.000 Bytes.

| Gelesene Log-Datei | Größe (Bytes) |
| --- | --- |
| 32804215966.log | 11281310 |
| 32925829090.log | 12397328 |
| 33073399036.log | 11145700 |
| 33179562825.log | 11198218 |
| 33187153575.log | 12525266 |
| 33244450690.log | 11381917 |
| 33289964981.log | 13486091 |
| 33293687092.log | 11968238 |
| 33295334800.log | 13316542 |
| 33301076508.log | 13361268 |
| 33483851565.log | 15336603 |
| 33493908237.log | 14689999 |
| 33601800213.log | 12541487 |
| 33613948152.log | 13809154 |
| 33623850297.log | 13401498 |
| 33726630558.log | 13632210 |
| 33847679293.log | 12791465 |
| 33903266385.log | 13560569 |
| 33951123754.log | 12720754 |
| 33959683377.log | 12583782 |
| 33963865924.log | 11857387 |
| 33967836117.log | 12575767 |
| 34198232299.log | 13309209 |
| 34323420979.log | 12755409 |
| 34449167675.log | 11770083 |
| 34573562886.log | 12855201 |
| 34679922322.log | 11619989 |
| 34943017795.log | 12899289 |
| 35069668890.log | 1780188 |
| 35195380849.log | 12848610 |
| 35268331005.log | 1881080 |
| 35270314555.log | 12770324 |
| 35319115201.log | 12792512 |
| 35428969634.log | 1789984 |
| 35438100627.log | 12930281 |
| 35500025507.log | 14541117 |

Zusätzlich gelesen: runs.txt. Logs nacheinander mit readline gestreamt; keine gleichzeitige Vollspeicherung.

## 2. Messung je Lauf

Zähleinheit: Log-Zeile eines Pull-Jobs (Shard), nur Laufzeitmeldungen [INFO]/[WARN] im Pull-Step oder UNKNOWN STEP; keine Prep-Tests oder Shell-Echos. F = fundamentals-stale-Zeile „forcing full pull (fundamentalsAsOf > …)“ (pull-yahoo.js:3730); R = „falling through to full pull“ (:3718); B = breiteres „forcing full pull“ einschließlich schema/currency (:3722/:3724); OK = erfolgreiche Voll-Schreibmeldung „✓ TICKER: revenue=“ nach :4506–4510. F/R sind Versuche, OK erfolgreiche Schreibmeldungen, keine eindeutigen Aktien über mehrere Läufe.

Budget-Suchmuster „Fundamentals-refresh budget:“ aus pull-yahoo.js:4661; Selektor-Muster aus :4667. Schlusszeilen mit Job, Step und Zeit stehen unten wörtlich je Lauf. Fehlende Diagnose bedeutet nicht null. conclusion ist der gesamte Workflow-Status und kein Beweis, dass der Pull ausfiel.

| runId | createdAt (UTC) | event | conclusion | Status | F / Lauf | R / Lauf | B / Lauf | OK / Lauf | Selektor-/Budget-Zeilen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 32804215966 | 2026-08-25T03:11:15Z | schedule | success | Pull-Log messbar | 2 | 246 | 138 | 564 | 0/17 |
| 32925829090 | 2026-08-26T03:16:26Z | schedule | failure | Pull-Log messbar | 4552 | 190 | 4688 | 5063 | 0/17 |
| 33073399036 | 2026-08-27T12:45:27Z | schedule | failure | Pull-Log messbar | 125 | 206 | 275 | 692 | 0/17 |
| 33179562825 | 2026-08-28T14:19:15Z | schedule | failure | Pull-Log messbar | 288 | 222 | 440 | 877 | 0/17 |
| 33187153575 | 2026-08-28T15:51:10Z | workflow_dispatch | failure | Pull-Log messbar | 0 | 183 | 149 | 406 | 0/17 |
| 33244450690 | 2026-08-29T09:00:23Z | schedule | failure | Pull-Log messbar | 422 | 176 | 571 | 829 | 0/17 |
| 33289964981 | 2026-08-30T03:18:37Z | workflow_dispatch | failure | Pull-Log messbar | 0 | 170 | 149 | 1321 | 0/17 |
| 33293687092 | 2026-08-30T04:59:35Z | workflow_dispatch | failure | Pull-Log messbar | 0 | 170 | 169 | 342 | 0/17 |
| 33295334800 | 2026-08-30T05:43:54Z | workflow_dispatch | failure | Pull-Log messbar | 0 | 171 | 169 | 344 | 0/17 |
| 33301076508 | 2026-08-30T08:13:57Z | workflow_dispatch | success | Pull-Log messbar | 0 | 173 | 170 | 341 | 0/17 |
| 33483851565 | 2026-09-01T07:47:37Z | schedule | failure | Pull-Log messbar | 0 | 216 | 20 | 318 | 0/17 |
| 33493908237 | 2026-09-01T09:45:46Z | workflow_dispatch | failure | Pull-Log messbar | 0 | 181 | 20 | 222 | 0/17 |
| 33601800213 | 2026-09-02T07:04:41Z | schedule | failure | Pull-Log messbar | 904 | 133 | 923 | 1136 | 0/17 |
| 33613948152 | 2026-09-02T09:24:36Z | workflow_dispatch | failure | Pull-Log messbar | 0 | 48 | 19 | 107 | 0/17 |
| 33623850297 | 2026-09-02T11:17:43Z | workflow_dispatch | failure | Pull-Log messbar | 0 | 45 | 18 | 101 | 0/17 |
| 33726630558 | 2026-09-03T07:08:55Z | schedule | failure | Pull-Log messbar | 3408 | 84 | 3424 | 3597 | 0/17 |
| 33847679293 | 2026-09-04T07:12:34Z | schedule | failure | Pull-Log messbar | 533 | 83 | 549 | 667 | 0/17 |
| 33903266385 | 2026-09-04T17:57:01Z | workflow_dispatch | failure | Pull-Log messbar | 1 | 53 | 17 | 135 | 0/17 |
| 33951123754 | 2026-09-05T06:55:07Z | schedule | failure | Pull-Log messbar | 494 | 55 | 510 | 576 | 0/17 |
| 33959683377 | 2026-09-05T10:04:47Z | workflow_dispatch | failure | Pull-Log messbar | 0 | 47 | 17 | 66 | 0/17 |
| 33963865924 | 2026-09-05T11:38:12Z | workflow_dispatch | failure | Pull-Log messbar | 0 | 41 | 17 | 68 | 0/17 |
| 33967836117 | 2026-09-05T13:04:29Z | workflow_dispatch | failure | Pull-Log messbar | 0 | 40 | 17 | 65 | 0/17 |
| 34198232299 | 2026-09-08T07:12:57Z | schedule | failure | Pull-Log messbar | 2051 | 94 | 2066 | 2199 | 0/17 |
| 34323420979 | 2026-09-09T07:21:23Z | schedule | failure | Pull-Log messbar | 91 | 108 | 105 | 233 | 0/17 |
| 34449167675 | 2026-09-10T07:16:46Z | schedule | failure | Pull-Log messbar | 1 | 116 | 15 | 153 | 0/17 |
| 34573562886 | 2026-09-11T07:15:46Z | schedule | failure | Pull-Log messbar | 253 | 143 | 267 | 371 | 0/17 |
| 34679922322 | 2026-09-12T07:07:58Z | schedule | failure | Pull-Log messbar | 170 | 67 | 184 | 282 | 0/17 |
| 34943017795 | 2026-09-15T07:41:49Z | schedule | failure | Pull-Log messbar | 259 | 163 | 273 | 397 | 0/17 |
| 35069668890 | 2026-09-16T07:39:45Z | schedule | failure | abgebrochen vor dem Pull | n/a | n/a | n/a | n/a | 0/0 |
| 35195380849 | 2026-09-17T07:36:30Z | schedule | failure | Pull-Log messbar | 228 | 91 | 243 | 431 | 0/17 |
| 35268331005 | 2026-09-17T20:01:33Z | workflow_dispatch | cancelled | abgebrochen vor dem Pull | n/a | n/a | n/a | n/a | 0/0 |
| 35270314555 | 2026-09-17T20:21:31Z | workflow_dispatch | failure | Pull-Log messbar | 0 | 51 | 16 | 119 | 0/17 |
| 35319115201 | 2026-09-18T07:22:34Z | schedule | failure | Pull-Log messbar | 39 | 72 | 54 | 180 | 0/17 |
| 35428969634 | 2026-09-19T07:18:37Z | schedule | failure | abgebrochen vor dem Pull | n/a | n/a | n/a | n/a | 0/0 |
| 35438100627 | 2026-09-19T10:41:45Z | workflow_dispatch | failure | Pull-Log messbar | 135 | 67 | 150 | 242 | 0/17 |
| 35500025507 | 2026-09-20T08:36:36Z | workflow_dispatch | failure | Pull-Log messbar | 0 | 46 | 15 | 67 | 17/17 |

Summe F = 13956 Ereignisse/33 messbare Läufe. Die größten drei Läufe (32925829090: 4552; 33726630558: 3408; 34198232299: 2051) tragen 10011/13956 = 71.73 % dieser Ereignisse.

| Stichprobe runId | Brief: grep forcing full pull | Gemessen B | Gemessen F | B − F |
| --- | --- | --- | --- | --- |
| 32925829090 | 4688 | 4688 | 4552 | 136 |
| 33726630558 | 3424 | 3424 | 3408 | 16 |
| 34198232299 | 2066 | 2066 | 2051 | 15 |
| 33601800213 | 923 | 923 | 904 | 19 |

## 3. Bestandsstempel gegen Tagesabrufe

S = am 2026-09-20T09:52:49.002Z noch vorhandene Snapshots mit fundamentalsAsOf an diesem UTC-Tag, Nenner 16047 Snapshots. F = Summe zeitbedingt erzwungener Versuche nach UTC-Zeit der Log-Zeile, nicht der Dateireihenfolge; Laufzahlen nach createdAt. Quote S/F ist keine Erfolgsquote: andere Abrufgründe, Fehlschläge, spätere Überschreibungen und mehrere Läufe verändern S. Differenz = S − F. Bei fehlender Messung n/a statt Null.

| UTC-Tag | S / Bestand | Läufe (davon klein) | F / Tageslogs | S/F | S − F | Abdeckung |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-07-08 | 1/16047 | 0 (0) | n/a | n/a | n/a | ohne Lauf-Log |
| 2026-08-04 | 1/16047 | 0 (0) | n/a | n/a | n/a | ohne Lauf-Log |
| 2026-08-06 | 1/16047 | 0 (0) | n/a | n/a | n/a | ohne Lauf-Log |
| 2026-08-08 | 1/16047 | 0 (0) | n/a | n/a | n/a | ohne Lauf-Log |
| 2026-08-24 | 0/16047 | 0 (0) | n/a | n/a | n/a | ohne Lauf-Log |
| 2026-08-25 | 153/16047 | 1 (0) | 2 | 7650.00 % | 151 | gemessen |
| 2026-08-26 | 4344/16047 | 1 (0) | 4552 | 95.43 % | -208 | gemessen |
| 2026-08-27 | 211/16047 | 1 (0) | 125 | 168.80 % | 86 | gemessen |
| 2026-08-28 | 454/16047 | 2 (0) | 288 | 157.64 % | 166 | gemessen |
| 2026-08-29 | 493/16047 | 1 (0) | 422 | 116.82 % | 71 | gemessen |
| 2026-08-30 | 1016/16047 | 4 (0) | 0 | nicht definiert | 1016 | gemessen |
| 2026-08-31 | 0/16047 | 0 (0) | n/a | n/a | n/a | ohne Lauf-Log |
| 2026-09-01 | 167/16047 | 2 (0) | 0 | nicht definiert | 167 | gemessen |
| 2026-09-02 | 1025/16047 | 3 (0) | 904 | 113.38 % | 121 | gemessen |
| 2026-09-03 | 3365/16047 | 1 (0) | 3408 | 98.74 % | -43 | gemessen |
| 2026-09-04 | 598/16047 | 2 (0) | 534 | 111.99 % | 64 | gemessen |
| 2026-09-05 | 516/16047 | 4 (0) | 494 | 104.45 % | 22 | gemessen |
| 2026-09-06 | 0/16047 | 0 (0) | n/a | n/a | n/a | ohne Lauf-Log |
| 2026-09-07 | 0/16047 | 0 (0) | n/a | n/a | n/a | ohne Lauf-Log |
| 2026-09-08 | 2022/16047 | 1 (0) | 2051 | 98.59 % | -29 | gemessen |
| 2026-09-09 | 103/16047 | 1 (0) | 91 | 113.19 % | 12 | gemessen |
| 2026-09-10 | 47/16047 | 1 (0) | 1 | 4700.00 % | 46 | gemessen |
| 2026-09-11 | 288/16047 | 1 (0) | 253 | 113.83 % | 35 | gemessen |
| 2026-09-12 | 209/16047 | 1 (0) | 170 | 122.94 % | 39 | gemessen |
| 2026-09-13 | 0/16047 | 0 (0) | n/a | n/a | n/a | ohne Lauf-Log |
| 2026-09-14 | 0/16047 | 0 (0) | n/a | n/a | n/a | ohne Lauf-Log |
| 2026-09-15 | 308/16047 | 1 (0) | 259 | 118.92 % | 49 | gemessen |
| 2026-09-16 | 0/16047 | 1 (1) | n/a | n/a | n/a | nur abgebrochen vor dem Pull |
| 2026-09-17 | 366/16047 | 3 (1) | 228 | 160.53 % | 138 | gemessen |
| 2026-09-18 | 110/16047 | 1 (0) | 39 | 282.05 % | 71 | gemessen |
| 2026-09-19 | 181/16047 | 2 (1) | 135 | 134.07 % | 46 | gemessen |
| 2026-09-20 | 67/16047 | 1 (0) | 0 | nicht definiert | 67 | gemessen |

Prüfung der Stempel-Stichprobe des Briefs (jeweils Nachher-Bestand zur oben genannten Bestandsuhr; Abweichungen werden nicht übernommen):

| fundamentalsAsOf-Tag UTC | Brief / Bestand | Gemessen / Bestand | Differenz |
| --- | --- | --- | --- |
| 2026-08-26 | 4344/16047 | 4344/16047 | 0 |
| 2026-09-03 | 3365/16047 | 3365/16047 | 0 |
| 2026-09-08 | 2021/16047 | 2022/16047 | 1 |
| 2026-08-30 | 1016/16047 | 1016/16047 | 0 |
| 2026-09-02 | 1024/16047 | 1025/16047 | 1 |

Stempel vor 25.08.2026 UTC: 4/16047. Der vollständige Meta-Leser und der Kopf-Leser stimmen überein; die zwei Abweichungen um je einen Snapshot zur Brief-Stichprobe sind keine übernommenen Rundungswerte.

Stempeltage ohne Lauf-Log (gesondert): 2026-07-08: 1/16047; 2026-08-04: 1/16047; 2026-08-06: 1/16047; 2026-08-08: 1/16047.

## 4. Entscheid und zitierfähige Aussagen

**(d) trägt, ergänzt um (b) und (c), Konfidenz 99 %.** Wellen statt konstanter Tagesrate: 10011/13956 erzwungene Versuche liegen in nur 3/33 messbaren Läufen; die korrespondierenden Stempelkohorten sind in Abschnitt 3 sichtbar. Das beweist Konzentration, keine tickerweise Erfolgszuordnung aller historischen Abrufe.

(a) Kein Beleg für Stempel ohne Vollabruf (Konfidenz 95 % für den gelesenen Quellstand): pull-yahoo.js:4492–4506 setzt fundamentalsAsOf beim Schreiben nach dem Vollpfad; :4505 erlaubt gleichzeitig fundamentalsIncomplete. Ein frischer Stempel belegt deshalb keinen vollständigen Fundamentaldatensatz. Ein Tag mit S > F widerlegt den Stempel nicht: F erfasst nur einen Abrufgrund. Historische Quellstände wurden nicht gelesen.

(b) Die 242 sind reproduziert als 242 erfolgreiche Voll-Schreibmeldungen/1 Lauf 35438100627 (createdAt 2026-09-19T10:41:45Z); dagegen 135 zeitbedingt erzwungene Versuche und 67 Preisabruf-Fallbacks/selber Lauf. 242 ist weder der F-Zähler noch eine feste tägliche Kapazität. 16047/242 = 66.31 Läufe ist lediglich ein Quotient unter konstanter Rate, keine gemessene Zyklusdauer; bei Di–Sa sind Läufe zudem keine Kalendertage.

(c) Population und Selektor-Bestand sind nicht identisch: 16047 Nachher-Dateien am 2026-09-20T09:52:49.002Z, Manifest n_eingang_snapshots=17393, n_sel_young_enough=16048, n_sel_young_and_stale=18, n_sel_not_young_but_stale=4. :3604–3616/:3665–3668 zählt vor dem Abruf im verarbeiteten Slice. Kein historischer Eingangsbestand für ein Replay vorhanden.

Zitierfähig: „4/16047 = 0.02 % der gelieferten CI-Snapshots tragen am 2026-09-20T09:52:49.002Z eine fundamentalsAsOf älter als 30 × 24 Stunden.“ Ebenfalls zitierfähig: „242 erfolgreiche Voll-Schreibmeldungen im Lauf 35438100627.“ Nicht zitierfähig als gemessene Wiederkehrzeit: „66-Tage-Vollpull-Zyklus“.

58,2 % und 7,58 %/1.318 werden nicht neu interpretiert: T326 nennt andere historische Quellen/Nenner (lokaler Altbestand bzw. Eingangsbestand), die hier nicht vorliegen. Diese Werte lassen sich aus dieser Nachher-Population nicht reproduzieren; ihr Abstand wird nicht kausal erklärt.

## 5. Vorhersage 21.09.–10.10.2026

Bedingtes Modell, keine gemessene Zukunft (Konfidenz 70 % für die operative Übertragung, Rechnung unter Annahmen deterministisch): Bestand eingefroren; keine vorgezogenen Earnings-/Schema-Abrufe, keine neuen Titel, keine Fehler, alle fälligen Namen erreichbar, je geplanter Lauf erfolgreiche Bedienung bis zum Budget. Schwelle strikt >30 × 24 Stunden (:117–118/:298); Kreuzung = Stempel +30 Tage +1 ms. Lauftage Di–Sa, Start 02:17 UTC (Cron `17 2 * * 2-6` laut Brief). Tatsächliche Starts können später liegen; einige historische schedule-Läufe begannen erst nach 07:00 UTC.

Budget laut Brief 3000; unabhängig in 561 Schlusszeilen überprüft: Caps 3000 je Shard, 561/561 mit „none deferred.“. Maximal beobachtet 313/3000 je Shard und Lauf. :143–148 und :3703–3708 begrenzen den lokalen Prozesszähler; Freifahrten verbrauchen dieses Budget nicht. daily-pull.yml wurde wegen der Lesegrenze nicht geöffnet; Cron ist eine Auftragsannahme.

Shard-Zuordnung für die Prognose aus Pulling-/Erfolgsmeldungen des Populationslaufs 35500025507, unverändert fortgeschrieben: 16047/16047 Snapshots zugeordnet, 0/16047 unbekannt. Vor Beginn schon über der Schwelle: 4/16047. Unbekannte werden als unbedient ausgewiesen, nie still als frisch.

Die Tageskreuzungen schließen auch Stempel ein, die erst nach 02:17 fällig werden: diese stehen am nächsten Lauftag an. „Fällig global“ und „Rest global“ sind eine ausdrücklich kontrafaktische Rechnung mit nur 3000 für alle Shards zusammen; „Max je Shard“ und „Rest Shards“ verwenden das tatsächlich beobachtete Budget je Prozess. Wochenenden/Montage sammeln Bedarf; Rest ist jeweils unmittelbar nach dem modellierten Lauf, nicht Tagesende.

| UTC-Tag | Kreuzungen / 16047 Snapshots | Lauf 02:17 | Fällig global | Rest global (fiktiver Deckel) | Max je Shard / 3000 | Rest Shards | davon unbekannt |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-21 | 0 | nein | — | — | — | — | — |
| 2026-09-22 | 0 | ja | 4 | 0 | 1 | 0 | 0 |
| 2026-09-23 | 0 | ja | 0 | 0 | 0 | 0 | 0 |
| 2026-09-24 | 153 | ja | 0 | 0 | 0 | 0 | 0 |
| 2026-09-25 | 4344 | ja | 153 | 0 | 15 | 0 | 0 |
| 2026-09-26 | 211 | ja | 4344 | 1344 | 301 | 0 | 0 |
| 2026-09-27 | 454 | nein | — | — | — | — | — |
| 2026-09-28 | 493 | nein | — | — | — | — | — |
| 2026-09-29 | 1016 | ja | 2502 | 0 | 97 | 0 | 0 |
| 2026-09-30 | 0 | ja | 1016 | 0 | 76 | 0 | 0 |
| 2026-10-01 | 167 | ja | 0 | 0 | 0 | 0 | 0 |
| 2026-10-02 | 1025 | ja | 167 | 0 | 18 | 0 | 0 |
| 2026-10-03 | 3365 | ja | 1025 | 0 | 75 | 0 | 0 |
| 2026-10-04 | 598 | nein | — | — | — | — | — |
| 2026-10-05 | 516 | nein | — | — | — | — | — |
| 2026-10-06 | 0 | ja | 4479 | 1479 | 309 | 0 | 0 |
| 2026-10-07 | 0 | ja | 1479 | 0 | 0 | 0 | 0 |
| 2026-10-08 | 2022 | ja | 0 | 0 | 0 | 0 | 0 |
| 2026-10-09 | 103 | ja | 2022 | 0 | 139 | 0 | 0 |
| 2026-10-10 | 47 | ja | 103 | 0 | 12 | 0 | 0 |

Vorhersage: Bei einem fiktiven Gesamtdeckel entsteht erstmals 2026-09-26 Budget-Rückstau (1344 unbediente Snapshots nach diesem Lauf). Beim beobachteten Budget je Shard: kein budgetbedingter Rückstau im Prognosefenster; größte modellierte Shard-Nachfrage 309/3000. Eine Gesamtwelle über 3000 allein lässt das reale Budget folglich nicht reißen. Zeit-/Fehler-/Selektorengpässe und geänderte Shard-Zuordnung bleiben außerhalb dieser Kapazitätsprognose.

Offen: Ob der Selektor glätten soll, ist nicht Gegenstand dieses Auftrags. Fehlende historische Eingangsbestände, nicht gelesene historische Quellstände und verzögerte/zusätzliche Läufe begrenzen die kausale und zeitliche Prognose.

### Wörtliche Schlusszeilen je Lauf (Belege zu Abschnitt 2)

#### 32804215966 — 2026-08-25T03:11:15Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (0)	UNKNOWN STEP	2026-08-25T03:55:32.1838121Z [2026-08-25T03:55:32.183Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-08-25T03:56:20.2079640Z [2026-08-25T03:56:20.207Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-08-25T03:56:01.1977226Z [2026-08-25T03:56:01.197Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-08-25T03:56:40.5645849Z [2026-08-25T03:56:40.564Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-08-25T03:55:19.4177798Z [2026-08-25T03:55:19.417Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-08-25T03:55:31.6649300Z [2026-08-25T03:55:31.664Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-08-25T03:55:07.7018940Z [2026-08-25T03:55:07.701Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-08-25T03:56:09.1665822Z [2026-08-25T03:56:09.166Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-08-25T03:55:47.5544005Z [2026-08-25T03:55:47.554Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-08-25T03:55:43.1058661Z [2026-08-25T03:55:43.105Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-08-25T03:54:51.3355473Z [2026-08-25T03:54:51.335Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-08-25T03:55:52.4726908Z [2026-08-25T03:55:52.472Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-08-25T03:56:26.0151703Z [2026-08-25T03:56:26.014Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-08-25T03:55:06.9722158Z [2026-08-25T03:55:06.972Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-08-25T03:55:45.6410729Z [2026-08-25T03:55:45.640Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-08-25T03:55:06.1312116Z [2026-08-25T03:55:06.131Z] [INFO] Fundamentals-refresh budget: 2/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-08-25T03:55:57.6693773Z [2026-08-25T03:55:57.669Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
```

#### 32925829090 — 2026-08-26T03:16:26Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (3)	UNKNOWN STEP	2026-08-26T04:04:39.3261924Z [2026-08-26T04:04:39.326Z] [INFO] Fundamentals-refresh budget: 239/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-08-26T04:07:57.0464246Z [2026-08-26T04:07:57.046Z] [INFO] Fundamentals-refresh budget: 313/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-08-26T04:04:44.6369544Z [2026-08-26T04:04:44.636Z] [INFO] Fundamentals-refresh budget: 261/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-08-26T04:05:54.7549926Z [2026-08-26T04:05:54.754Z] [INFO] Fundamentals-refresh budget: 254/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-08-26T04:05:01.7345560Z [2026-08-26T04:05:01.734Z] [INFO] Fundamentals-refresh budget: 240/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-08-26T04:07:03.8631589Z [2026-08-26T04:07:03.862Z] [INFO] Fundamentals-refresh budget: 296/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-08-26T04:06:11.2215100Z [2026-08-26T04:06:11.221Z] [INFO] Fundamentals-refresh budget: 272/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-08-26T04:04:32.0562822Z [2026-08-26T04:04:32.056Z] [INFO] Fundamentals-refresh budget: 236/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-08-26T04:05:34.1116357Z [2026-08-26T04:05:34.111Z] [INFO] Fundamentals-refresh budget: 269/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-08-26T04:06:01.2582081Z [2026-08-26T04:06:01.258Z] [INFO] Fundamentals-refresh budget: 269/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-08-26T04:05:48.6199800Z [2026-08-26T04:05:48.619Z] [INFO] Fundamentals-refresh budget: 280/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-08-26T04:05:44.8912086Z [2026-08-26T04:05:44.891Z] [INFO] Fundamentals-refresh budget: 262/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-08-26T04:07:25.4233017Z [2026-08-26T04:07:25.423Z] [INFO] Fundamentals-refresh budget: 293/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-08-26T04:05:25.5752227Z [2026-08-26T04:05:25.575Z] [INFO] Fundamentals-refresh budget: 253/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-08-26T04:04:57.4897909Z [2026-08-26T04:04:57.489Z] [INFO] Fundamentals-refresh budget: 249/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-08-26T04:06:00.3128129Z [2026-08-26T04:06:00.312Z] [INFO] Fundamentals-refresh budget: 288/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-08-26T04:06:55.7844881Z [2026-08-26T04:06:55.784Z] [INFO] Fundamentals-refresh budget: 278/3000 time-based full pulls used; none deferred.
```

#### 33073399036 — 2026-08-27T12:45:27Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (5)	UNKNOWN STEP	2026-08-27T13:26:55.1376869Z [2026-08-27T13:26:55.137Z] [INFO] Fundamentals-refresh budget: 5/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-08-27T13:27:44.4267065Z [2026-08-27T13:27:44.426Z] [INFO] Fundamentals-refresh budget: 9/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-08-27T13:27:15.4677446Z [2026-08-27T13:27:15.467Z] [INFO] Fundamentals-refresh budget: 7/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-08-27T13:28:12.4397398Z [2026-08-27T13:28:12.439Z] [INFO] Fundamentals-refresh budget: 10/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-08-27T13:27:32.2695629Z [2026-08-27T13:27:32.269Z] [INFO] Fundamentals-refresh budget: 12/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-08-27T13:27:16.3654951Z [2026-08-27T13:27:16.365Z] [INFO] Fundamentals-refresh budget: 6/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-08-27T13:26:41.6677155Z [2026-08-27T13:26:41.667Z] [INFO] Fundamentals-refresh budget: 4/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-08-27T13:26:57.0174280Z [2026-08-27T13:26:57.017Z] [INFO] Fundamentals-refresh budget: 6/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-08-27T13:27:51.7631082Z [2026-08-27T13:27:51.762Z] [INFO] Fundamentals-refresh budget: 2/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-08-27T13:26:56.5052281Z [2026-08-27T13:26:56.505Z] [INFO] Fundamentals-refresh budget: 7/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-08-27T13:27:21.5205767Z [2026-08-27T13:27:21.520Z] [INFO] Fundamentals-refresh budget: 10/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-08-27T13:26:50.7643719Z [2026-08-27T13:26:50.764Z] [INFO] Fundamentals-refresh budget: 5/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-08-27T13:26:22.3584352Z [2026-08-27T13:26:22.358Z] [INFO] Fundamentals-refresh budget: 5/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-08-27T13:27:44.5777062Z [2026-08-27T13:27:44.577Z] [INFO] Fundamentals-refresh budget: 10/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-08-27T13:28:07.6319377Z [2026-08-27T13:28:07.631Z] [INFO] Fundamentals-refresh budget: 12/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-08-27T13:27:30.5583265Z [2026-08-27T13:27:30.558Z] [INFO] Fundamentals-refresh budget: 8/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-08-27T13:28:04.8814827Z [2026-08-27T13:28:04.881Z] [INFO] Fundamentals-refresh budget: 7/3000 time-based full pulls used; none deferred.
```

#### 33179562825 — 2026-08-28T14:19:15Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (0)	UNKNOWN STEP	2026-08-28T15:04:27.4785680Z [2026-08-28T15:04:27.478Z] [INFO] Fundamentals-refresh budget: 15/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-08-28T15:04:03.7223023Z [2026-08-28T15:04:03.722Z] [INFO] Fundamentals-refresh budget: 11/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-08-28T15:04:26.1544387Z [2026-08-28T15:04:26.154Z] [INFO] Fundamentals-refresh budget: 11/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-08-28T15:03:59.6194733Z [2026-08-28T15:03:59.619Z] [INFO] Fundamentals-refresh budget: 14/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-08-28T15:05:13.1740079Z [2026-08-28T15:05:13.173Z] [INFO] Fundamentals-refresh budget: 21/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-08-28T15:03:56.7301503Z [2026-08-28T15:03:56.730Z] [INFO] Fundamentals-refresh budget: 16/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-08-28T15:04:57.8258123Z [2026-08-28T15:04:57.825Z] [INFO] Fundamentals-refresh budget: 24/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-08-28T15:04:29.2290074Z [2026-08-28T15:04:29.228Z] [INFO] Fundamentals-refresh budget: 20/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-08-28T15:04:38.2476408Z [2026-08-28T15:04:38.247Z] [INFO] Fundamentals-refresh budget: 21/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-08-28T15:04:03.5230130Z [2026-08-28T15:04:03.522Z] [INFO] Fundamentals-refresh budget: 16/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-08-28T15:04:26.5173217Z [2026-08-28T15:04:26.517Z] [INFO] Fundamentals-refresh budget: 19/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-08-28T15:05:14.8182561Z [2026-08-28T15:05:14.818Z] [INFO] Fundamentals-refresh budget: 17/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-08-28T15:04:33.5379699Z [2026-08-28T15:04:33.537Z] [INFO] Fundamentals-refresh budget: 15/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-08-28T15:04:44.5771015Z [2026-08-28T15:04:44.576Z] [INFO] Fundamentals-refresh budget: 18/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-08-28T15:05:38.0685334Z [2026-08-28T15:05:38.068Z] [INFO] Fundamentals-refresh budget: 17/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-08-28T15:05:26.9762015Z [2026-08-28T15:05:26.975Z] [INFO] Fundamentals-refresh budget: 23/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-08-28T15:04:55.1994150Z [2026-08-28T15:04:55.199Z] [INFO] Fundamentals-refresh budget: 10/3000 time-based full pulls used; none deferred.
```

#### 33187153575 — 2026-08-28T15:51:10Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (2)	Run Yahoo Pull (shard 2/17)	2026-08-28T16:31:34.3711353Z [2026-08-28T16:31:34.371Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (3)	Run Yahoo Pull (shard 3/17)	2026-08-28T16:32:23.9956976Z [2026-08-28T16:32:23.995Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (1)	Run Yahoo Pull (shard 1/17)	2026-08-28T16:32:53.9287827Z [2026-08-28T16:32:53.928Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (6)	Run Yahoo Pull (shard 6/17)	2026-08-28T16:33:14.3660751Z [2026-08-28T16:33:14.365Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (15)	Run Yahoo Pull (shard 15/17)	2026-08-28T16:32:24.9017949Z [2026-08-28T16:32:24.901Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (13)	Run Yahoo Pull (shard 13/17)	2026-08-28T16:32:48.3272209Z [2026-08-28T16:32:48.327Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (12)	Run Yahoo Pull (shard 12/17)	2026-08-28T16:32:25.6439186Z [2026-08-28T16:32:25.643Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (0)	Run Yahoo Pull (shard 0/17)	2026-08-28T16:32:27.1505770Z [2026-08-28T16:32:27.150Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (14)	Run Yahoo Pull (shard 14/17)	2026-08-28T16:32:10.6772091Z [2026-08-28T16:32:10.677Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (7)	Run Yahoo Pull (shard 7/17)	2026-08-28T16:33:14.6978282Z [2026-08-28T16:33:14.697Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (4)	Run Yahoo Pull (shard 4/17)	2026-08-28T16:31:53.0980885Z [2026-08-28T16:31:53.097Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (8)	Run Yahoo Pull (shard 8/17)	2026-08-28T16:32:59.7254581Z [2026-08-28T16:32:59.725Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (10)	Run Yahoo Pull (shard 10/17)	2026-08-28T16:32:49.8367950Z [2026-08-28T16:32:49.836Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (5)	Run Yahoo Pull (shard 5/17)	2026-08-28T16:32:09.5067993Z [2026-08-28T16:32:09.506Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (16)	Run Yahoo Pull (shard 16/17)	2026-08-28T16:32:45.9055487Z [2026-08-28T16:32:45.905Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (11)	Run Yahoo Pull (shard 11/17)	2026-08-28T16:33:20.0692292Z [2026-08-28T16:33:20.069Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (9)	Run Yahoo Pull (shard 9/17)	2026-08-28T16:33:05.1537216Z [2026-08-28T16:33:05.153Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
```

#### 33244450690 — 2026-08-29T09:00:23Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (5)	UNKNOWN STEP	2026-08-29T09:45:16.2888758Z [2026-08-29T09:45:16.288Z] [INFO] Fundamentals-refresh budget: 21/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-08-29T09:45:22.0028577Z [2026-08-29T09:45:22.002Z] [INFO] Fundamentals-refresh budget: 24/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-08-29T09:45:22.0724439Z [2026-08-29T09:45:22.072Z] [INFO] Fundamentals-refresh budget: 23/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-08-29T09:45:15.1937139Z [2026-08-29T09:45:15.193Z] [INFO] Fundamentals-refresh budget: 34/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-08-29T09:45:49.4565932Z [2026-08-29T09:45:49.456Z] [INFO] Fundamentals-refresh budget: 24/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-08-29T09:46:29.0686537Z [2026-08-29T09:46:29.068Z] [INFO] Fundamentals-refresh budget: 28/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-08-29T09:46:12.0003437Z [2026-08-29T09:46:12.000Z] [INFO] Fundamentals-refresh budget: 25/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-08-29T09:45:15.9780639Z [2026-08-29T09:45:15.977Z] [INFO] Fundamentals-refresh budget: 26/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-08-29T09:46:28.5628506Z [2026-08-29T09:46:28.562Z] [INFO] Fundamentals-refresh budget: 37/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-08-29T09:45:20.1748524Z [2026-08-29T09:45:20.174Z] [INFO] Fundamentals-refresh budget: 29/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-08-29T09:45:39.3007317Z [2026-08-29T09:45:39.300Z] [INFO] Fundamentals-refresh budget: 19/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-08-29T09:46:20.4436588Z [2026-08-29T09:46:20.443Z] [INFO] Fundamentals-refresh budget: 27/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-08-29T09:45:45.4828804Z [2026-08-29T09:45:45.482Z] [INFO] Fundamentals-refresh budget: 25/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-08-29T09:45:40.2034416Z [2026-08-29T09:45:40.203Z] [INFO] Fundamentals-refresh budget: 20/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-08-29T09:45:48.4358899Z [2026-08-29T09:45:48.435Z] [INFO] Fundamentals-refresh budget: 20/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-08-29T09:44:18.8023316Z [2026-08-29T09:44:18.802Z] [INFO] Fundamentals-refresh budget: 13/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-08-29T09:45:48.5068099Z [2026-08-29T09:45:48.506Z] [INFO] Fundamentals-refresh budget: 27/3000 time-based full pulls used; none deferred.
```

#### 33289964981 — 2026-08-30T03:18:37Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (0)	Run Yahoo Pull (shard 0/17)	2026-08-30T04:01:07.3967308Z [2026-08-30T04:01:07.396Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (11)	Run Yahoo Pull (shard 11/17)	2026-08-30T04:02:22.6828139Z [2026-08-30T04:02:22.682Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (9)	Run Yahoo Pull (shard 9/17)	2026-08-30T04:02:00.5658248Z [2026-08-30T04:02:00.565Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (3)	Run Yahoo Pull (shard 3/17)	2026-08-30T04:00:40.4688251Z [2026-08-30T04:00:40.468Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (4)	Run Yahoo Pull (shard 4/17)	2026-08-30T04:00:47.0091790Z [2026-08-30T04:00:47.009Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (8)	Run Yahoo Pull (shard 8/17)	2026-08-30T04:01:22.2041077Z [2026-08-30T04:01:22.203Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (15)	Run Yahoo Pull (shard 15/17)	2026-08-30T04:01:05.0147820Z [2026-08-30T04:01:05.014Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (12)	Run Yahoo Pull (shard 12/17)	2026-08-30T04:01:07.3767370Z [2026-08-30T04:01:07.376Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (10)	Run Yahoo Pull (shard 10/17)	2026-08-30T04:01:29.9083897Z [2026-08-30T04:01:29.908Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (6)	Run Yahoo Pull (shard 6/17)	2026-08-30T04:02:10.3398220Z [2026-08-30T04:02:10.339Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (14)	Run Yahoo Pull (shard 14/17)	2026-08-30T04:01:04.2531657Z [2026-08-30T04:01:04.253Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (1)	Run Yahoo Pull (shard 1/17)	2026-08-30T04:01:26.4333399Z [2026-08-30T04:01:26.433Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (5)	Run Yahoo Pull (shard 5/17)	2026-08-30T04:01:13.1763395Z [2026-08-30T04:01:13.176Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (16)	Run Yahoo Pull (shard 16/17)	2026-08-30T04:01:16.0203974Z [2026-08-30T04:01:16.017Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (13)	Run Yahoo Pull (shard 13/17)	2026-08-30T04:01:31.0694935Z [2026-08-30T04:01:31.069Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (7)	Run Yahoo Pull (shard 7/17)	2026-08-30T04:02:24.7511962Z [2026-08-30T04:02:24.751Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (2)	Run Yahoo Pull (shard 2/17)	2026-08-30T04:00:08.8680965Z [2026-08-30T04:00:08.867Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
```

#### 33293687092 — 2026-08-30T04:59:35Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (11)	UNKNOWN STEP	2026-08-30T05:41:44.2140330Z [2026-08-30T05:41:44.213Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-08-30T05:40:20.7019803Z [2026-08-30T05:40:20.701Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-08-30T05:41:24.3937064Z [2026-08-30T05:41:24.393Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-08-30T05:40:43.4942572Z [2026-08-30T05:40:43.494Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-08-30T05:40:55.6372866Z [2026-08-30T05:40:55.637Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-08-30T05:41:10.7836556Z [2026-08-30T05:41:10.783Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-08-30T05:40:20.1898767Z [2026-08-30T05:40:20.189Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-08-30T05:41:14.8782879Z [2026-08-30T05:41:14.878Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-08-30T05:41:14.1008431Z [2026-08-30T05:41:14.100Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-08-30T05:41:38.8306224Z [2026-08-30T05:41:38.830Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-08-30T05:40:44.9478972Z [2026-08-30T05:40:44.947Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-08-30T05:40:27.9329377Z [2026-08-30T05:40:27.932Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-08-30T05:40:51.8375053Z [2026-08-30T05:40:51.837Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-08-30T05:40:55.2020566Z [2026-08-30T05:40:55.201Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-08-30T05:40:01.2899137Z [2026-08-30T05:40:01.289Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-08-30T05:41:39.4064625Z [2026-08-30T05:41:39.406Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-08-30T05:41:10.3704199Z [2026-08-30T05:41:10.370Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
```

#### 33295334800 — 2026-08-30T05:43:54Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (0)	Run Yahoo Pull (shard 0/17)	2026-08-30T06:25:06.5015530Z [2026-08-30T06:25:06.498Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (7)	Run Yahoo Pull (shard 7/17)	2026-08-30T06:25:54.6004290Z [2026-08-30T06:25:54.600Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (2)	Run Yahoo Pull (shard 2/17)	2026-08-30T06:24:09.8934955Z [2026-08-30T06:24:09.893Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (1)	Run Yahoo Pull (shard 1/17)	2026-08-30T06:25:17.5920189Z [2026-08-30T06:25:17.591Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (13)	Run Yahoo Pull (shard 13/17)	2026-08-30T06:25:04.0182503Z [2026-08-30T06:25:04.018Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (14)	Run Yahoo Pull (shard 14/17)	2026-08-30T06:24:33.1319444Z [2026-08-30T06:24:33.131Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (4)	Run Yahoo Pull (shard 4/17)	2026-08-30T06:24:22.8776404Z [2026-08-30T06:24:22.877Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (12)	Run Yahoo Pull (shard 12/17)	2026-08-30T06:24:54.2653690Z [2026-08-30T06:24:54.265Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (8)	Run Yahoo Pull (shard 8/17)	2026-08-30T06:25:26.5307119Z [2026-08-30T06:25:26.530Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (5)	Run Yahoo Pull (shard 5/17)	2026-08-30T06:24:28.3685411Z [2026-08-30T06:24:28.368Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (9)	Run Yahoo Pull (shard 9/17)	2026-08-30T06:25:30.6506343Z [2026-08-30T06:25:30.650Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (10)	Run Yahoo Pull (shard 10/17)	2026-08-30T06:25:07.2579095Z [2026-08-30T06:25:07.257Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (15)	Run Yahoo Pull (shard 15/17)	2026-08-30T06:25:10.6393102Z [2026-08-30T06:25:10.639Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (6)	Run Yahoo Pull (shard 6/17)	2026-08-30T06:25:45.7783089Z [2026-08-30T06:25:45.778Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (11)	Run Yahoo Pull (shard 11/17)	2026-08-30T06:26:00.9053234Z [2026-08-30T06:26:00.905Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (3)	Run Yahoo Pull (shard 3/17)	2026-08-30T06:24:32.1888449Z [2026-08-30T06:24:32.188Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (16)	Run Yahoo Pull (shard 16/17)	2026-08-30T06:25:01.6848254Z [2026-08-30T06:25:01.684Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
```

#### 33301076508 — 2026-08-30T08:13:57Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (1)	Run Yahoo Pull (shard 1/17)	2026-08-30T08:55:20.5370926Z [2026-08-30T08:55:20.537Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (11)	Run Yahoo Pull (shard 11/17)	2026-08-30T08:56:01.6992644Z [2026-08-30T08:56:01.699Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (9)	Run Yahoo Pull (shard 9/17)	2026-08-30T08:55:30.7023932Z [2026-08-30T08:55:30.702Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (2)	Run Yahoo Pull (shard 2/17)	2026-08-30T08:54:17.0931168Z [2026-08-30T08:54:17.092Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (4)	Run Yahoo Pull (shard 4/17)	2026-08-30T08:54:34.0094497Z [2026-08-30T08:54:34.009Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (0)	Run Yahoo Pull (shard 0/17)	2026-08-30T08:55:06.4664968Z [2026-08-30T08:55:06.466Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (6)	Run Yahoo Pull (shard 6/17)	2026-08-30T08:56:01.4055915Z [2026-08-30T08:56:01.405Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (10)	Run Yahoo Pull (shard 10/17)	2026-08-30T08:55:17.6235007Z [2026-08-30T08:55:17.623Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (7)	Run Yahoo Pull (shard 7/17)	2026-08-30T08:56:10.2807354Z [2026-08-30T08:56:10.280Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (5)	Run Yahoo Pull (shard 5/17)	2026-08-30T08:54:35.7925394Z [2026-08-30T08:54:35.792Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (16)	Run Yahoo Pull (shard 16/17)	2026-08-30T08:55:15.3630579Z [2026-08-30T08:55:15.362Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (3)	Run Yahoo Pull (shard 3/17)	2026-08-30T08:54:47.6621055Z [2026-08-30T08:54:47.661Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (13)	Run Yahoo Pull (shard 13/17)	2026-08-30T08:55:25.5312243Z [2026-08-30T08:55:25.528Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (8)	Run Yahoo Pull (shard 8/17)	2026-08-30T08:55:32.7475797Z [2026-08-30T08:55:32.747Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (14)	Run Yahoo Pull (shard 14/17)	2026-08-30T08:54:47.2511641Z [2026-08-30T08:54:47.251Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (12)	Run Yahoo Pull (shard 12/17)	2026-08-30T08:54:56.3099764Z [2026-08-30T08:54:56.306Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (15)	Run Yahoo Pull (shard 15/17)	2026-08-30T08:55:09.2377099Z [2026-08-30T08:55:09.237Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
```

#### 33483851565 — 2026-09-01T07:47:37Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (2)	Run Yahoo Pull (shard 2/17)	2026-09-01T08:29:20.2852335Z [2026-09-01T08:29:20.285Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (4)	Run Yahoo Pull (shard 4/17)	2026-09-01T08:29:46.6577398Z [2026-09-01T08:29:46.657Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (3)	Run Yahoo Pull (shard 3/17)	2026-09-01T08:29:55.5579506Z [2026-09-01T08:29:55.557Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (9)	Run Yahoo Pull (shard 9/17)	2026-09-01T08:30:43.8640903Z [2026-09-01T08:30:43.863Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (5)	Run Yahoo Pull (shard 5/17)	2026-09-01T08:30:17.8822536Z [2026-09-01T08:30:17.882Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (8)	Run Yahoo Pull (shard 8/17)	2026-09-01T08:30:53.9309916Z [2026-09-01T08:30:53.930Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (12)	Run Yahoo Pull (shard 12/17)	2026-09-01T08:30:17.1695423Z [2026-09-01T08:30:17.169Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (6)	Run Yahoo Pull (shard 6/17)	2026-09-01T08:31:00.3079619Z [2026-09-01T08:31:00.307Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (11)	Run Yahoo Pull (shard 11/17)	2026-09-01T08:31:30.6482943Z [2026-09-01T08:31:30.648Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (13)	Run Yahoo Pull (shard 13/17)	2026-09-01T08:30:25.9483365Z [2026-09-01T08:30:25.948Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (15)	Run Yahoo Pull (shard 15/17)	2026-09-01T08:30:15.5892811Z [2026-09-01T08:30:15.589Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (1)	Run Yahoo Pull (shard 1/17)	2026-09-01T08:30:27.8896434Z [2026-09-01T08:30:27.889Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (7)	Run Yahoo Pull (shard 7/17)	2026-09-01T08:31:19.0612375Z [2026-09-01T08:31:19.061Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (0)	Run Yahoo Pull (shard 0/17)	2026-09-01T08:30:39.8310027Z [2026-09-01T08:30:39.830Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (14)	Run Yahoo Pull (shard 14/17)	2026-09-01T08:30:22.8496543Z [2026-09-01T08:30:22.849Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (10)	Run Yahoo Pull (shard 10/17)	2026-09-01T08:30:31.6793155Z [2026-09-01T08:30:31.678Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (16)	Run Yahoo Pull (shard 16/17)	2026-09-01T08:30:52.2998702Z [2026-09-01T08:30:52.299Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
```

#### 33493908237 — 2026-09-01T09:45:46Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (3)	UNKNOWN STEP	2026-09-01T10:27:33.9920022Z [2026-09-01T10:27:33.991Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-09-01T10:27:19.6184009Z [2026-09-01T10:27:19.618Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-09-01T10:28:28.3315151Z [2026-09-01T10:28:28.331Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-09-01T10:27:45.7649892Z [2026-09-01T10:27:45.764Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-09-01T10:27:35.9314870Z [2026-09-01T10:27:35.931Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-09-01T10:28:13.1995399Z [2026-09-01T10:28:13.199Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-09-01T10:27:41.1133273Z [2026-09-01T10:27:41.113Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-09-01T10:27:23.3784682Z [2026-09-01T10:27:23.378Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-09-01T10:27:58.4274717Z [2026-09-01T10:27:58.427Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-09-01T10:27:31.1699915Z [2026-09-01T10:27:31.169Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-09-01T10:26:32.3682117Z [2026-09-01T10:26:32.368Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-09-01T10:27:44.5911385Z [2026-09-01T10:27:44.590Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-09-01T10:28:03.0889810Z [2026-09-01T10:28:03.088Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-09-01T10:27:28.9389367Z [2026-09-01T10:27:28.938Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-09-01T10:28:30.5474702Z [2026-09-01T10:28:30.547Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-09-01T10:27:41.7886786Z [2026-09-01T10:27:41.788Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-09-01T10:27:36.5041697Z [2026-09-01T10:27:36.503Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
```

#### 33601800213 — 2026-09-02T07:04:41Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (8)	Run Yahoo Pull (shard 8/17)	2026-09-02T07:48:58.8517936Z [2026-09-02T07:48:58.851Z] [INFO] Fundamentals-refresh budget: 54/3000 time-based full pulls used; none deferred.
pull (6)	Run Yahoo Pull (shard 6/17)	2026-09-02T07:49:08.3712434Z [2026-09-02T07:49:08.371Z] [INFO] Fundamentals-refresh budget: 47/3000 time-based full pulls used; none deferred.
pull (11)	Run Yahoo Pull (shard 11/17)	2026-09-02T07:49:42.0716909Z [2026-09-02T07:49:42.071Z] [INFO] Fundamentals-refresh budget: 52/3000 time-based full pulls used; none deferred.
pull (0)	Run Yahoo Pull (shard 0/17)	2026-09-02T07:48:34.0519425Z [2026-09-02T07:48:34.051Z] [INFO] Fundamentals-refresh budget: 64/3000 time-based full pulls used; none deferred.
pull (7)	Run Yahoo Pull (shard 7/17)	2026-09-02T07:49:37.1347111Z [2026-09-02T07:49:37.134Z] [INFO] Fundamentals-refresh budget: 60/3000 time-based full pulls used; none deferred.
pull (2)	Run Yahoo Pull (shard 2/17)	2026-09-02T07:47:47.1674603Z [2026-09-02T07:47:47.167Z] [INFO] Fundamentals-refresh budget: 48/3000 time-based full pulls used; none deferred.
pull (3)	Run Yahoo Pull (shard 3/17)	2026-09-02T07:48:01.4642807Z [2026-09-02T07:48:01.464Z] [INFO] Fundamentals-refresh budget: 44/3000 time-based full pulls used; none deferred.
pull (14)	Run Yahoo Pull (shard 14/17)	2026-09-02T07:48:31.2363846Z [2026-09-02T07:48:31.236Z] [INFO] Fundamentals-refresh budget: 63/3000 time-based full pulls used; none deferred.
pull (1)	Run Yahoo Pull (shard 1/17)	2026-09-02T07:48:28.8824895Z [2026-09-02T07:48:28.882Z] [INFO] Fundamentals-refresh budget: 52/3000 time-based full pulls used; none deferred.
pull (10)	Run Yahoo Pull (shard 10/17)	2026-09-02T07:49:06.3719709Z [2026-09-02T07:49:06.371Z] [INFO] Fundamentals-refresh budget: 64/3000 time-based full pulls used; none deferred.
pull (16)	Run Yahoo Pull (shard 16/17)	2026-09-02T07:48:54.4915081Z [2026-09-02T07:48:54.491Z] [INFO] Fundamentals-refresh budget: 46/3000 time-based full pulls used; none deferred.
pull (12)	Run Yahoo Pull (shard 12/17)	2026-09-02T07:48:00.5761153Z [2026-09-02T07:48:00.575Z] [INFO] Fundamentals-refresh budget: 42/3000 time-based full pulls used; none deferred.
pull (13)	Run Yahoo Pull (shard 13/17)	2026-09-02T07:48:18.8828016Z [2026-09-02T07:48:18.882Z] [INFO] Fundamentals-refresh budget: 46/3000 time-based full pulls used; none deferred.
pull (5)	Run Yahoo Pull (shard 5/17)	2026-09-02T07:48:06.5193636Z [2026-09-02T07:48:06.519Z] [INFO] Fundamentals-refresh budget: 50/3000 time-based full pulls used; none deferred.
pull (4)	Run Yahoo Pull (shard 4/17)	2026-09-02T07:48:11.8726109Z [2026-09-02T07:48:11.872Z] [INFO] Fundamentals-refresh budget: 60/3000 time-based full pulls used; none deferred.
pull (15)	Run Yahoo Pull (shard 15/17)	2026-09-02T07:48:45.7665963Z [2026-09-02T07:48:45.766Z] [INFO] Fundamentals-refresh budget: 56/3000 time-based full pulls used; none deferred.
pull (9)	Run Yahoo Pull (shard 9/17)	2026-09-02T07:49:08.6728790Z [2026-09-02T07:49:08.672Z] [INFO] Fundamentals-refresh budget: 56/3000 time-based full pulls used; none deferred.
```

#### 33613948152 — 2026-09-02T09:24:36Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (6)	Run Yahoo Pull (shard 6/17)	2026-09-02T10:07:00.5404967Z [2026-09-02T10:07:00.540Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (9)	Run Yahoo Pull (shard 9/17)	2026-09-02T10:06:48.7228995Z [2026-09-02T10:06:48.722Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (3)	Run Yahoo Pull (shard 3/17)	2026-09-02T10:06:18.4554008Z [2026-09-02T10:06:18.455Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (14)	Run Yahoo Pull (shard 14/17)	2026-09-02T10:06:07.9210354Z [2026-09-02T10:06:07.920Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (4)	Run Yahoo Pull (shard 4/17)	2026-09-02T10:05:40.1380585Z [2026-09-02T10:05:40.137Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (7)	Run Yahoo Pull (shard 7/17)	2026-09-02T10:07:17.5445686Z [2026-09-02T10:07:17.544Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (15)	Run Yahoo Pull (shard 15/17)	2026-09-02T10:06:30.7364029Z [2026-09-02T10:06:30.736Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (13)	Run Yahoo Pull (shard 13/17)	2026-09-02T10:06:20.1327244Z [2026-09-02T10:06:20.132Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (12)	Run Yahoo Pull (shard 12/17)	2026-09-02T10:06:10.2375170Z [2026-09-02T10:06:10.237Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (2)	Run Yahoo Pull (shard 2/17)	2026-09-02T10:05:34.0002565Z [2026-09-02T10:05:34.000Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (1)	Run Yahoo Pull (shard 1/17)	2026-09-02T10:06:32.2518003Z [2026-09-02T10:06:32.251Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (16)	Run Yahoo Pull (shard 16/17)	2026-09-02T10:06:44.5802330Z [2026-09-02T10:06:44.580Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (11)	Run Yahoo Pull (shard 11/17)	2026-09-02T10:07:24.9635436Z [2026-09-02T10:07:24.963Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (0)	Run Yahoo Pull (shard 0/17)	2026-09-02T10:06:13.1548097Z [2026-09-02T10:06:13.154Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (5)	Run Yahoo Pull (shard 5/17)	2026-09-02T10:06:03.9429580Z [2026-09-02T10:06:03.942Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (8)	Run Yahoo Pull (shard 8/17)	2026-09-02T10:06:44.9554360Z [2026-09-02T10:06:44.955Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (10)	Run Yahoo Pull (shard 10/17)	2026-09-02T10:06:23.6507990Z [2026-09-02T10:06:23.650Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
```

#### 33623850297 — 2026-09-02T11:17:43Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (3)	Run Yahoo Pull (shard 3/17)	2026-09-02T11:58:54.3842426Z [2026-09-02T11:58:54.384Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (8)	Run Yahoo Pull (shard 8/17)	2026-09-02T11:59:21.1334185Z [2026-09-02T11:59:21.133Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (7)	Run Yahoo Pull (shard 7/17)	2026-09-02T11:59:56.2874243Z [2026-09-02T11:59:56.287Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (2)	Run Yahoo Pull (shard 2/17)	2026-09-02T11:58:12.1375955Z [2026-09-02T11:58:12.137Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (6)	Run Yahoo Pull (shard 6/17)	2026-09-02T11:59:43.7580681Z [2026-09-02T11:59:43.757Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (0)	Run Yahoo Pull (shard 0/17)	2026-09-02T11:59:09.1973672Z [2026-09-02T11:59:09.197Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (5)	Run Yahoo Pull (shard 5/17)	2026-09-02T11:58:39.9239063Z [2026-09-02T11:58:39.923Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (4)	Run Yahoo Pull (shard 4/17)	2026-09-02T11:58:21.5888328Z [2026-09-02T11:58:21.588Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (13)	Run Yahoo Pull (shard 13/17)	2026-09-02T11:59:07.5373563Z [2026-09-02T11:59:07.537Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (15)	Run Yahoo Pull (shard 15/17)	2026-09-02T11:59:06.6728571Z [2026-09-02T11:59:06.672Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (16)	Run Yahoo Pull (shard 16/17)	2026-09-02T11:59:28.3870296Z [2026-09-02T11:59:28.386Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (12)	Run Yahoo Pull (shard 12/17)	2026-09-02T11:58:53.1733751Z [2026-09-02T11:58:53.173Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (1)	Run Yahoo Pull (shard 1/17)	2026-09-02T11:59:05.5602072Z [2026-09-02T11:59:05.560Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (11)	Run Yahoo Pull (shard 11/17)	2026-09-02T12:00:14.5110636Z [2026-09-02T12:00:14.510Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (9)	Run Yahoo Pull (shard 9/17)	2026-09-02T11:59:35.3849725Z [2026-09-02T11:59:35.384Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (10)	Run Yahoo Pull (shard 10/17)	2026-09-02T11:59:13.9666823Z [2026-09-02T11:59:13.966Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (14)	Run Yahoo Pull (shard 14/17)	2026-09-02T11:58:51.6032318Z [2026-09-02T11:58:51.603Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
```

#### 33726630558 — 2026-09-03T07:08:55Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (2)	UNKNOWN STEP	2026-09-03T07:59:20.3510820Z [2026-09-03T07:59:20.350Z] [INFO] Fundamentals-refresh budget: 219/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-09-03T07:58:21.7413520Z [2026-09-03T07:58:21.741Z] [INFO] Fundamentals-refresh budget: 184/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-09-03T07:59:54.2416489Z [2026-09-03T07:59:54.241Z] [INFO] Fundamentals-refresh budget: 194/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-09-03T08:00:51.6286460Z [2026-09-03T08:00:51.628Z] [INFO] Fundamentals-refresh budget: 217/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-09-03T07:59:45.8604386Z [2026-09-03T07:59:45.860Z] [INFO] Fundamentals-refresh budget: 219/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-09-03T07:58:22.6114334Z [2026-09-03T07:58:22.611Z] [INFO] Fundamentals-refresh budget: 156/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-09-03T07:59:26.8023289Z [2026-09-03T07:59:26.802Z] [INFO] Fundamentals-refresh budget: 190/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-09-03T07:59:17.1780058Z [2026-09-03T07:59:17.177Z] [INFO] Fundamentals-refresh budget: 189/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-09-03T07:59:25.1132244Z [2026-09-03T07:59:25.113Z] [INFO] Fundamentals-refresh budget: 175/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-09-03T08:00:57.6857961Z [2026-09-03T08:00:57.685Z] [INFO] Fundamentals-refresh budget: 218/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-09-03T07:59:58.3839893Z [2026-09-03T07:59:58.383Z] [INFO] Fundamentals-refresh budget: 216/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-09-03T08:01:01.6092899Z [2026-09-03T08:01:01.609Z] [INFO] Fundamentals-refresh budget: 223/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-09-03T08:01:31.3682796Z [2026-09-03T08:01:31.368Z] [INFO] Fundamentals-refresh budget: 232/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-09-03T07:58:33.0382965Z [2026-09-03T07:58:33.038Z] [INFO] Fundamentals-refresh budget: 169/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-09-03T07:59:40.6291299Z [2026-09-03T07:59:40.628Z] [INFO] Fundamentals-refresh budget: 210/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-09-03T07:58:56.8386004Z [2026-09-03T07:58:56.838Z] [INFO] Fundamentals-refresh budget: 188/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-09-03T07:59:46.8074224Z [2026-09-03T07:59:46.807Z] [INFO] Fundamentals-refresh budget: 209/3000 time-based full pulls used; none deferred.
```

#### 33847679293 — 2026-09-04T07:12:34Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (0)	UNKNOWN STEP	2026-09-04T07:59:14.7865705Z [2026-09-04T07:59:14.786Z] [INFO] Fundamentals-refresh budget: 30/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-09-04T07:59:02.6358614Z [2026-09-04T07:59:02.635Z] [INFO] Fundamentals-refresh budget: 34/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-09-04T07:59:13.0003803Z [2026-09-04T07:59:13.000Z] [INFO] Fundamentals-refresh budget: 31/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-09-04T07:59:50.7805491Z [2026-09-04T07:59:50.780Z] [INFO] Fundamentals-refresh budget: 40/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-09-04T08:00:23.5945806Z [2026-09-04T08:00:23.594Z] [INFO] Fundamentals-refresh budget: 38/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-09-04T08:00:04.9885655Z [2026-09-04T08:00:04.988Z] [INFO] Fundamentals-refresh budget: 20/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-09-04T07:59:17.7559689Z [2026-09-04T07:59:17.755Z] [INFO] Fundamentals-refresh budget: 31/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-09-04T07:59:21.5972330Z [2026-09-04T07:59:21.597Z] [INFO] Fundamentals-refresh budget: 19/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-09-04T08:00:10.4911587Z [2026-09-04T08:00:10.490Z] [INFO] Fundamentals-refresh budget: 39/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-09-04T07:58:59.9636951Z [2026-09-04T07:58:59.963Z] [INFO] Fundamentals-refresh budget: 21/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-09-04T07:59:24.9118862Z [2026-09-04T07:59:24.911Z] [INFO] Fundamentals-refresh budget: 32/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-09-04T07:59:37.5501401Z [2026-09-04T07:59:37.549Z] [INFO] Fundamentals-refresh budget: 36/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-09-04T07:59:17.0367480Z [2026-09-04T07:59:17.036Z] [INFO] Fundamentals-refresh budget: 23/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-09-04T07:59:25.2751705Z [2026-09-04T07:59:25.274Z] [INFO] Fundamentals-refresh budget: 32/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-09-04T07:59:32.3978647Z [2026-09-04T07:59:32.397Z] [INFO] Fundamentals-refresh budget: 42/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-09-04T08:00:29.0316665Z [2026-09-04T08:00:29.031Z] [INFO] Fundamentals-refresh budget: 34/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-09-04T07:58:40.5623104Z [2026-09-04T07:58:40.562Z] [INFO] Fundamentals-refresh budget: 31/3000 time-based full pulls used; none deferred.
```

#### 33903266385 — 2026-09-04T17:57:01Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (2)	Run Yahoo Pull (shard 2/17)	2026-09-04T18:44:54.5667798Z [2026-09-04T18:44:54.566Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (10)	Run Yahoo Pull (shard 10/17)	2026-09-04T18:45:07.0455518Z [2026-09-04T18:45:07.045Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (1)	Run Yahoo Pull (shard 1/17)	2026-09-04T18:45:04.1271403Z [2026-09-04T18:45:04.126Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (6)	Run Yahoo Pull (shard 6/17)	2026-09-04T18:46:02.5784413Z [2026-09-04T18:46:02.578Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (13)	Run Yahoo Pull (shard 13/17)	2026-09-04T18:45:36.8814469Z [2026-09-04T18:45:36.881Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (11)	Run Yahoo Pull (shard 11/17)	2026-09-04T18:46:29.1687511Z [2026-09-04T18:46:29.168Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (5)	Run Yahoo Pull (shard 5/17)	2026-09-04T18:44:46.9507126Z [2026-09-04T18:44:46.950Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (0)	Run Yahoo Pull (shard 0/17)	2026-09-04T18:45:03.1544715Z [2026-09-04T18:45:03.154Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (3)	Run Yahoo Pull (shard 3/17)	2026-09-04T18:44:47.8325719Z [2026-09-04T18:44:47.832Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (4)	Run Yahoo Pull (shard 4/17)	2026-09-04T18:44:56.2798675Z [2026-09-04T18:44:56.279Z] [INFO] Fundamentals-refresh budget: 1/3000 time-based full pulls used; none deferred.
pull (15)	Run Yahoo Pull (shard 15/17)	2026-09-04T18:45:26.6623473Z [2026-09-04T18:45:26.662Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (14)	Run Yahoo Pull (shard 14/17)	2026-09-04T18:45:18.0423607Z [2026-09-04T18:45:18.042Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (16)	Run Yahoo Pull (shard 16/17)	2026-09-04T18:45:29.2424180Z [2026-09-04T18:45:29.242Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (8)	Run Yahoo Pull (shard 8/17)	2026-09-04T18:45:09.2276633Z [2026-09-04T18:45:09.227Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (12)	Run Yahoo Pull (shard 12/17)	2026-09-04T18:45:00.7849444Z [2026-09-04T18:45:00.784Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (7)	Run Yahoo Pull (shard 7/17)	2026-09-04T18:46:37.8181412Z [2026-09-04T18:46:37.817Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (9)	Run Yahoo Pull (shard 9/17)	2026-09-04T18:45:45.2418419Z [2026-09-04T18:45:45.241Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
```

#### 33951123754 — 2026-09-05T06:55:07Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (4)	UNKNOWN STEP	2026-09-05T07:36:36.9202983Z [2026-09-05T07:36:36.920Z] [INFO] Fundamentals-refresh budget: 27/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-09-05T07:37:14.2637193Z [2026-09-05T07:37:14.263Z] [INFO] Fundamentals-refresh budget: 33/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-09-05T07:37:47.8582327Z [2026-09-05T07:37:47.858Z] [INFO] Fundamentals-refresh budget: 24/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-09-05T07:36:33.7889880Z [2026-09-05T07:36:33.788Z] [INFO] Fundamentals-refresh budget: 26/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-09-05T07:37:22.5817704Z [2026-09-05T07:37:22.581Z] [INFO] Fundamentals-refresh budget: 34/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-09-05T07:37:02.9059990Z [2026-09-05T07:37:02.905Z] [INFO] Fundamentals-refresh budget: 26/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-09-05T07:36:40.3874103Z [2026-09-05T07:36:40.387Z] [INFO] Fundamentals-refresh budget: 23/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-09-05T07:37:29.9551160Z [2026-09-05T07:37:29.954Z] [INFO] Fundamentals-refresh budget: 27/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-09-05T07:38:29.7498481Z [2026-09-05T07:38:29.749Z] [INFO] Fundamentals-refresh budget: 38/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-09-05T07:37:29.7231711Z [2026-09-05T07:37:29.722Z] [INFO] Fundamentals-refresh budget: 24/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-09-05T07:38:05.3395132Z [2026-09-05T07:38:05.339Z] [INFO] Fundamentals-refresh budget: 35/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-09-05T07:37:22.9203047Z [2026-09-05T07:37:22.920Z] [INFO] Fundamentals-refresh budget: 29/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-09-05T07:37:26.9070941Z [2026-09-05T07:37:26.906Z] [INFO] Fundamentals-refresh budget: 34/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-09-05T07:37:02.6985340Z [2026-09-05T07:37:02.698Z] [INFO] Fundamentals-refresh budget: 25/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-09-05T07:37:06.5798660Z [2026-09-05T07:37:06.579Z] [INFO] Fundamentals-refresh budget: 27/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-09-05T07:36:57.9897747Z [2026-09-05T07:36:57.989Z] [INFO] Fundamentals-refresh budget: 25/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-09-05T07:37:30.3851944Z [2026-09-05T07:37:30.385Z] [INFO] Fundamentals-refresh budget: 37/3000 time-based full pulls used; none deferred.
```

#### 33959683377 — 2026-09-05T10:04:47Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (4)	UNKNOWN STEP	2026-09-05T10:43:47.2078549Z [2026-09-05T10:43:47.207Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-09-05T10:44:53.6723457Z [2026-09-05T10:44:53.672Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-09-05T10:44:22.5264503Z [2026-09-05T10:44:22.526Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-09-05T10:44:38.6548244Z [2026-09-05T10:44:38.654Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-09-05T10:43:43.0251277Z [2026-09-05T10:43:43.024Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-09-05T10:44:06.8869716Z [2026-09-05T10:44:06.886Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-09-05T10:44:14.9781119Z [2026-09-05T10:44:14.977Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-09-05T10:44:19.3055556Z [2026-09-05T10:44:19.305Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-09-05T10:45:06.5405608Z [2026-09-05T10:45:06.540Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-09-05T10:45:14.4917030Z [2026-09-05T10:45:14.491Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-09-05T10:44:16.3836002Z [2026-09-05T10:44:16.383Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-09-05T10:44:33.1319416Z [2026-09-05T10:44:33.131Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-09-05T10:44:17.9518514Z [2026-09-05T10:44:17.951Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-09-05T10:44:17.0836082Z [2026-09-05T10:44:17.083Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-09-05T10:44:29.6469821Z [2026-09-05T10:44:29.646Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-09-05T10:44:29.9978406Z [2026-09-05T10:44:29.997Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-09-05T10:43:42.5621360Z [2026-09-05T10:43:42.561Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
```

#### 33963865924 — 2026-09-05T11:38:12Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (7)	UNKNOWN STEP	2026-09-05T12:19:20.2707609Z [2026-09-05T12:19:20.270Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-09-05T12:18:27.2152932Z [2026-09-05T12:18:27.215Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-09-05T12:18:08.1746128Z [2026-09-05T12:18:08.169Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-09-05T12:18:45.4940160Z [2026-09-05T12:18:45.493Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-09-05T12:18:37.5015116Z [2026-09-05T12:18:37.501Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-09-05T12:18:35.8867406Z [2026-09-05T12:18:35.886Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-09-05T12:18:39.2525350Z [2026-09-05T12:18:39.252Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-09-05T12:17:56.4222723Z [2026-09-05T12:17:56.422Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-09-05T12:18:33.5538847Z [2026-09-05T12:18:33.553Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-09-05T12:19:03.5737073Z [2026-09-05T12:19:03.573Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-09-05T12:19:14.5198193Z [2026-09-05T12:19:14.519Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-09-05T12:19:02.1522826Z [2026-09-05T12:19:02.152Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-09-05T12:19:29.5054941Z [2026-09-05T12:19:29.505Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-09-05T12:18:36.7849963Z [2026-09-05T12:18:36.784Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-09-05T12:18:36.7298582Z [2026-09-05T12:18:36.729Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-09-05T12:18:43.5745458Z [2026-09-05T12:18:43.574Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-09-05T12:18:27.1598528Z [2026-09-05T12:18:27.159Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
```

#### 33967836117 — 2026-09-05T13:04:29Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (6)	UNKNOWN STEP	2026-09-05T13:47:49.5213205Z [2026-09-05T13:47:49.521Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-09-05T13:47:08.5575304Z [2026-09-05T13:47:08.557Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-09-05T13:46:34.8595152Z [2026-09-05T13:46:34.859Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-09-05T13:47:05.2818474Z [2026-09-05T13:47:05.281Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-09-05T13:46:22.7002292Z [2026-09-05T13:46:22.700Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-09-05T13:47:22.5850924Z [2026-09-05T13:47:22.584Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-09-05T13:47:12.5062598Z [2026-09-05T13:47:12.506Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-09-05T13:46:40.1580127Z [2026-09-05T13:46:40.157Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-09-05T13:47:03.1860822Z [2026-09-05T13:47:03.185Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-09-05T13:47:52.6310691Z [2026-09-05T13:47:52.630Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-09-05T13:47:03.5809881Z [2026-09-05T13:47:03.580Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-09-05T13:46:58.6155383Z [2026-09-05T13:46:58.615Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-09-05T13:47:09.6548740Z [2026-09-05T13:47:09.654Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-09-05T13:47:00.7873320Z [2026-09-05T13:47:00.787Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-09-05T13:47:34.4108400Z [2026-09-05T13:47:34.410Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-09-05T13:47:49.4966394Z [2026-09-05T13:47:49.496Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-09-05T13:47:09.8880978Z [2026-09-05T13:47:09.887Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
```

#### 34198232299 — 2026-09-08T07:12:57Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (4)	UNKNOWN STEP	2026-09-08T07:56:21.5487990Z [2026-09-08T07:56:21.548Z] [INFO] Fundamentals-refresh budget: 111/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-09-08T07:56:34.3215886Z [2026-09-08T07:56:34.321Z] [INFO] Fundamentals-refresh budget: 130/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-09-08T07:58:13.7517400Z [2026-09-08T07:58:13.751Z] [INFO] Fundamentals-refresh budget: 133/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-09-08T07:57:50.5501003Z [2026-09-08T07:57:50.549Z] [INFO] Fundamentals-refresh budget: 142/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-09-08T07:56:48.1293417Z [2026-09-08T07:56:48.129Z] [INFO] Fundamentals-refresh budget: 116/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-09-08T07:56:49.7313791Z [2026-09-08T07:56:49.731Z] [INFO] Fundamentals-refresh budget: 121/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-09-08T07:56:26.8460187Z [2026-09-08T07:56:26.845Z] [INFO] Fundamentals-refresh budget: 98/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-09-08T07:57:09.7822725Z [2026-09-08T07:57:09.782Z] [INFO] Fundamentals-refresh budget: 128/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-09-08T07:57:52.7919100Z [2026-09-08T07:57:52.791Z] [INFO] Fundamentals-refresh budget: 123/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-09-08T07:55:51.0053448Z [2026-09-08T07:55:51.005Z] [INFO] Fundamentals-refresh budget: 99/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-09-08T07:57:06.1195304Z [2026-09-08T07:57:06.119Z] [INFO] Fundamentals-refresh budget: 129/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-09-08T07:57:24.8769181Z [2026-09-08T07:57:24.876Z] [INFO] Fundamentals-refresh budget: 131/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-09-08T07:56:16.5655732Z [2026-09-08T07:56:16.565Z] [INFO] Fundamentals-refresh budget: 89/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-09-08T07:57:39.6470432Z [2026-09-08T07:57:39.646Z] [INFO] Fundamentals-refresh budget: 131/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-09-08T07:57:06.1738283Z [2026-09-08T07:57:06.173Z] [INFO] Fundamentals-refresh budget: 129/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-09-08T07:57:09.7565731Z [2026-09-08T07:57:09.756Z] [INFO] Fundamentals-refresh budget: 101/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-09-08T07:57:29.3059643Z [2026-09-08T07:57:29.305Z] [INFO] Fundamentals-refresh budget: 140/3000 time-based full pulls used; none deferred.
```

#### 34323420979 — 2026-09-09T07:21:23Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (4)	UNKNOWN STEP	2026-09-09T08:03:57.7446589Z [2026-09-09T08:03:57.744Z] [INFO] Fundamentals-refresh budget: 4/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-09-09T08:03:33.3220381Z [2026-09-09T08:03:33.321Z] [INFO] Fundamentals-refresh budget: 3/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-09-09T08:05:18.3356455Z [2026-09-09T08:05:18.335Z] [INFO] Fundamentals-refresh budget: 9/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-09-09T08:04:21.4817898Z [2026-09-09T08:04:21.481Z] [INFO] Fundamentals-refresh budget: 5/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-09-09T08:04:26.2925744Z [2026-09-09T08:04:26.292Z] [INFO] Fundamentals-refresh budget: 8/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-09-09T08:03:55.7824152Z [2026-09-09T08:03:55.782Z] [INFO] Fundamentals-refresh budget: 7/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-09-09T08:04:30.8532389Z [2026-09-09T08:04:30.853Z] [INFO] Fundamentals-refresh budget: 9/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-09-09T08:04:54.7092502Z [2026-09-09T08:04:54.706Z] [INFO] Fundamentals-refresh budget: 4/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-09-09T08:04:19.6604712Z [2026-09-09T08:04:19.660Z] [INFO] Fundamentals-refresh budget: 4/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-09-09T08:04:43.2227574Z [2026-09-09T08:04:43.222Z] [INFO] Fundamentals-refresh budget: 6/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-09-09T08:04:09.6822306Z [2026-09-09T08:04:09.682Z] [INFO] Fundamentals-refresh budget: 1/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-09-09T08:04:22.3522374Z [2026-09-09T08:04:22.352Z] [INFO] Fundamentals-refresh budget: 6/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-09-09T08:05:19.0329443Z [2026-09-09T08:05:19.032Z] [INFO] Fundamentals-refresh budget: 8/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-09-09T08:04:18.2234959Z [2026-09-09T08:04:18.223Z] [INFO] Fundamentals-refresh budget: 8/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-09-09T08:04:20.9331023Z [2026-09-09T08:04:20.932Z] [INFO] Fundamentals-refresh budget: 4/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-09-09T08:04:59.0109040Z [2026-09-09T08:04:59.010Z] [INFO] Fundamentals-refresh budget: 2/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-09-09T08:04:20.9777779Z [2026-09-09T08:04:20.977Z] [INFO] Fundamentals-refresh budget: 3/3000 time-based full pulls used; none deferred.
```

#### 34449167675 — 2026-09-10T07:16:46Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (2)	UNKNOWN STEP	2026-09-10T07:58:40.1480180Z [2026-09-10T07:58:40.147Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-09-10T07:59:10.9808370Z [2026-09-10T07:59:10.980Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-09-10T08:00:06.8021868Z [2026-09-10T08:00:06.801Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-09-10T07:59:37.8254437Z [2026-09-10T07:59:37.825Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-09-10T07:59:00.2793564Z [2026-09-10T07:59:00.279Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-09-10T07:59:32.2337407Z [2026-09-10T07:59:32.233Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-09-10T07:59:14.4035762Z [2026-09-10T07:59:14.403Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-09-10T07:59:17.5176791Z [2026-09-10T07:59:17.517Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-09-10T08:00:10.6542228Z [2026-09-10T08:00:10.654Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-09-10T07:59:15.0282600Z [2026-09-10T07:59:15.028Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-09-10T07:58:57.2539476Z [2026-09-10T07:58:57.253Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-09-10T07:59:35.9561793Z [2026-09-10T07:59:35.955Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-09-10T08:00:05.3898438Z [2026-09-10T08:00:05.389Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-09-10T07:59:21.5314518Z [2026-09-10T07:59:21.531Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-09-10T07:59:23.6611121Z [2026-09-10T07:59:23.660Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-09-10T07:59:17.1086222Z [2026-09-10T07:59:17.108Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-09-10T07:59:24.6513416Z [2026-09-10T07:59:24.651Z] [INFO] Fundamentals-refresh budget: 1/3000 time-based full pulls used; none deferred.
```

#### 34573562886 — 2026-09-11T07:15:46Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (9)	UNKNOWN STEP	2026-09-11T08:01:25.8572812Z [2026-09-11T08:01:25.857Z] [INFO] Fundamentals-refresh budget: 14/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-09-11T08:02:16.1170736Z [2026-09-11T08:02:16.116Z] [INFO] Fundamentals-refresh budget: 25/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-09-11T08:01:06.7080591Z [2026-09-11T08:01:06.707Z] [INFO] Fundamentals-refresh budget: 16/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-09-11T08:00:25.0736479Z [2026-09-11T08:00:25.073Z] [INFO] Fundamentals-refresh budget: 9/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-09-11T08:00:43.3530418Z [2026-09-11T08:00:43.352Z] [INFO] Fundamentals-refresh budget: 17/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-09-11T08:00:59.4760118Z [2026-09-11T08:00:59.475Z] [INFO] Fundamentals-refresh budget: 12/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-09-11T08:01:03.6355373Z [2026-09-11T08:01:03.635Z] [INFO] Fundamentals-refresh budget: 17/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-09-11T08:01:05.2594175Z [2026-09-11T08:01:05.259Z] [INFO] Fundamentals-refresh budget: 20/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-09-11T08:01:57.3364898Z [2026-09-11T08:01:57.336Z] [INFO] Fundamentals-refresh budget: 16/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-09-11T08:00:48.8272053Z [2026-09-11T08:00:48.827Z] [INFO] Fundamentals-refresh budget: 19/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-09-11T08:01:16.0516965Z [2026-09-11T08:01:16.051Z] [INFO] Fundamentals-refresh budget: 15/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-09-11T08:01:08.0416264Z [2026-09-11T08:01:08.041Z] [INFO] Fundamentals-refresh budget: 10/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-09-11T08:01:11.5890733Z [2026-09-11T08:01:11.584Z] [INFO] Fundamentals-refresh budget: 15/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-09-11T08:01:01.8042625Z [2026-09-11T08:01:01.803Z] [INFO] Fundamentals-refresh budget: 14/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-09-11T08:01:26.5767100Z [2026-09-11T08:01:26.576Z] [INFO] Fundamentals-refresh budget: 14/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-09-11T08:01:57.9639901Z [2026-09-11T08:01:57.963Z] [INFO] Fundamentals-refresh budget: 9/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-09-11T08:01:11.8611893Z [2026-09-11T08:01:11.861Z] [INFO] Fundamentals-refresh budget: 11/3000 time-based full pulls used; none deferred.
```

#### 34679922322 — 2026-09-12T07:07:58Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (5)	UNKNOWN STEP	2026-09-12T07:54:38.1712155Z [2026-09-12T07:54:38.171Z] [INFO] Fundamentals-refresh budget: 14/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-09-12T07:55:02.4031568Z [2026-09-12T07:55:02.403Z] [INFO] Fundamentals-refresh budget: 10/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-09-12T07:55:26.3274926Z [2026-09-12T07:55:26.327Z] [INFO] Fundamentals-refresh budget: 12/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-09-12T07:54:30.8333547Z [2026-09-12T07:54:30.833Z] [INFO] Fundamentals-refresh budget: 13/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-09-12T07:54:52.4481926Z [2026-09-12T07:54:52.448Z] [INFO] Fundamentals-refresh budget: 7/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-09-12T07:55:03.7575671Z [2026-09-12T07:55:03.757Z] [INFO] Fundamentals-refresh budget: 7/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-09-12T07:55:08.8818327Z [2026-09-12T07:55:08.881Z] [INFO] Fundamentals-refresh budget: 10/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-09-12T07:55:29.2002026Z [2026-09-12T07:55:29.200Z] [INFO] Fundamentals-refresh budget: 11/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-09-12T07:55:05.7904712Z [2026-09-12T07:55:05.790Z] [INFO] Fundamentals-refresh budget: 6/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-09-12T07:55:20.3261726Z [2026-09-12T07:55:20.326Z] [INFO] Fundamentals-refresh budget: 13/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-09-12T07:56:19.4543793Z [2026-09-12T07:56:19.454Z] [INFO] Fundamentals-refresh budget: 12/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-09-12T07:54:48.8255128Z [2026-09-12T07:54:48.825Z] [INFO] Fundamentals-refresh budget: 7/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-09-12T07:55:17.3697919Z [2026-09-12T07:55:17.369Z] [INFO] Fundamentals-refresh budget: 7/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-09-12T07:55:38.8433453Z [2026-09-12T07:55:38.843Z] [INFO] Fundamentals-refresh budget: 10/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-09-12T07:56:10.4545942Z [2026-09-12T07:56:10.454Z] [INFO] Fundamentals-refresh budget: 11/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-09-12T07:55:54.9195187Z [2026-09-12T07:55:54.919Z] [INFO] Fundamentals-refresh budget: 9/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-09-12T07:55:19.5158486Z [2026-09-12T07:55:19.515Z] [INFO] Fundamentals-refresh budget: 11/3000 time-based full pulls used; none deferred.
```

#### 34943017795 — 2026-09-15T07:41:49Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (9)	UNKNOWN STEP	2026-09-15T08:29:36.1704726Z [2026-09-15T08:29:36.170Z] [INFO] Fundamentals-refresh budget: 16/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-09-15T08:29:46.8641835Z [2026-09-15T08:29:46.864Z] [INFO] Fundamentals-refresh budget: 8/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-09-15T08:29:21.6268476Z [2026-09-15T08:29:21.626Z] [INFO] Fundamentals-refresh budget: 15/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-09-15T08:28:30.8740021Z [2026-09-15T08:28:30.873Z] [INFO] Fundamentals-refresh budget: 15/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-09-15T08:29:10.0718898Z [2026-09-15T08:29:10.071Z] [INFO] Fundamentals-refresh budget: 13/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-09-15T08:29:03.2501693Z [2026-09-15T08:29:03.249Z] [INFO] Fundamentals-refresh budget: 18/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-09-15T08:28:32.4322690Z [2026-09-15T08:28:32.432Z] [INFO] Fundamentals-refresh budget: 15/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-09-15T08:29:39.5091856Z [2026-09-15T08:29:39.509Z] [INFO] Fundamentals-refresh budget: 21/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-09-15T08:29:24.2316254Z [2026-09-15T08:29:24.231Z] [INFO] Fundamentals-refresh budget: 12/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-09-15T08:29:21.1318025Z [2026-09-15T08:29:21.131Z] [INFO] Fundamentals-refresh budget: 17/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-09-15T08:28:32.7927376Z [2026-09-15T08:28:32.792Z] [INFO] Fundamentals-refresh budget: 10/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-09-15T08:28:55.1440553Z [2026-09-15T08:28:55.143Z] [INFO] Fundamentals-refresh budget: 14/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-09-15T08:29:17.6477790Z [2026-09-15T08:29:17.647Z] [INFO] Fundamentals-refresh budget: 22/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-09-15T08:29:23.8599865Z [2026-09-15T08:29:23.859Z] [INFO] Fundamentals-refresh budget: 17/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-09-15T08:29:50.7954522Z [2026-09-15T08:29:50.795Z] [INFO] Fundamentals-refresh budget: 17/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-09-15T08:29:23.7627380Z [2026-09-15T08:29:23.762Z] [INFO] Fundamentals-refresh budget: 17/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-09-15T08:29:00.4847790Z [2026-09-15T08:29:00.484Z] [INFO] Fundamentals-refresh budget: 12/3000 time-based full pulls used; none deferred.
```

#### 35069668890 — 2026-09-16T07:39:45Z

abgebrochen vor dem Pull (Größenregel des Briefs).

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 0/17 erwartete Shards nach Populationsmanifest.

```text
```

#### 35195380849 — 2026-09-17T07:36:30Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (2)	UNKNOWN STEP	2026-09-17T08:26:13.0982989Z [2026-09-17T08:26:13.098Z] [INFO] Fundamentals-refresh budget: 20/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-09-17T08:26:47.7551394Z [2026-09-17T08:26:47.754Z] [INFO] Fundamentals-refresh budget: 15/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-09-17T08:27:22.4250261Z [2026-09-17T08:27:22.424Z] [INFO] Fundamentals-refresh budget: 10/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-09-17T08:27:15.2841769Z [2026-09-17T08:27:15.283Z] [INFO] Fundamentals-refresh budget: 14/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-09-17T08:27:21.8637006Z [2026-09-17T08:27:21.863Z] [INFO] Fundamentals-refresh budget: 15/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-09-17T08:27:13.3683727Z [2026-09-17T08:27:13.368Z] [INFO] Fundamentals-refresh budget: 11/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-09-17T08:26:51.7799654Z [2026-09-17T08:26:51.779Z] [INFO] Fundamentals-refresh budget: 11/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-09-17T08:27:13.2449691Z [2026-09-17T08:27:13.244Z] [INFO] Fundamentals-refresh budget: 13/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-09-17T08:26:47.2082890Z [2026-09-17T08:26:47.208Z] [INFO] Fundamentals-refresh budget: 14/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-09-17T08:27:09.5115203Z [2026-09-17T08:27:09.511Z] [INFO] Fundamentals-refresh budget: 10/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-09-17T08:27:29.9659087Z [2026-09-17T08:27:29.965Z] [INFO] Fundamentals-refresh budget: 15/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-09-17T08:27:03.1270032Z [2026-09-17T08:27:03.126Z] [INFO] Fundamentals-refresh budget: 17/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-09-17T08:27:49.5074937Z [2026-09-17T08:27:49.507Z] [INFO] Fundamentals-refresh budget: 13/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-09-17T08:27:40.5597084Z [2026-09-17T08:27:40.559Z] [INFO] Fundamentals-refresh budget: 16/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-09-17T08:26:50.4192577Z [2026-09-17T08:26:50.419Z] [INFO] Fundamentals-refresh budget: 9/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-09-17T08:26:56.6080808Z [2026-09-17T08:26:56.607Z] [INFO] Fundamentals-refresh budget: 10/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-09-17T08:26:35.0833483Z [2026-09-17T08:26:35.083Z] [INFO] Fundamentals-refresh budget: 15/3000 time-based full pulls used; none deferred.
```

#### 35268331005 — 2026-09-17T20:01:33Z

abgebrochen vor dem Pull (Größenregel des Briefs).

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 0/17 erwartete Shards nach Populationsmanifest.

```text
```

#### 35270314555 — 2026-09-17T20:21:31Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (3)	UNKNOWN STEP	2026-09-17T21:09:35.7260439Z [2026-09-17T21:09:35.725Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-09-17T21:09:45.7494124Z [2026-09-17T21:09:45.749Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-09-17T21:09:56.1258274Z [2026-09-17T21:09:56.125Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-09-17T21:09:21.6111628Z [2026-09-17T21:09:21.611Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-09-17T21:09:43.8760517Z [2026-09-17T21:09:43.875Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-09-17T21:09:02.9743014Z [2026-09-17T21:09:02.974Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-09-17T21:09:34.6911238Z [2026-09-17T21:09:34.690Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-09-17T21:09:41.8047049Z [2026-09-17T21:09:41.804Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-09-17T21:09:34.8475367Z [2026-09-17T21:09:34.847Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-09-17T21:09:43.1561583Z [2026-09-17T21:09:43.155Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-09-17T21:09:45.8053055Z [2026-09-17T21:09:45.805Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-09-17T21:10:29.2631171Z [2026-09-17T21:10:29.262Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-09-17T21:08:47.8852632Z [2026-09-17T21:08:47.885Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-09-17T21:09:13.4029964Z [2026-09-17T21:09:13.402Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-09-17T21:10:20.9308134Z [2026-09-17T21:10:20.930Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-09-17T21:09:53.2582578Z [2026-09-17T21:09:53.258Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-09-17T21:09:38.0241330Z [2026-09-17T21:09:38.023Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
```

#### 35319115201 — 2026-09-18T07:22:34Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (7)	UNKNOWN STEP	2026-09-18T08:15:55.6553868Z [2026-09-18T08:15:55.651Z] [INFO] Fundamentals-refresh budget: 3/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-09-18T08:15:40.9405041Z [2026-09-18T08:15:40.940Z] [INFO] Fundamentals-refresh budget: 2/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-09-18T08:14:41.7022261Z [2026-09-18T08:14:41.702Z] [INFO] Fundamentals-refresh budget: 1/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-09-18T08:15:17.9981178Z [2026-09-18T08:15:17.997Z] [INFO] Fundamentals-refresh budget: 1/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-09-18T08:15:19.4667390Z [2026-09-18T08:15:19.466Z] [INFO] Fundamentals-refresh budget: 5/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-09-18T08:14:41.9079778Z [2026-09-18T08:14:41.907Z] [INFO] Fundamentals-refresh budget: 1/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-09-18T08:15:39.7256798Z [2026-09-18T08:15:39.725Z] [INFO] Fundamentals-refresh budget: 2/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-09-18T08:15:25.8428987Z [2026-09-18T08:15:25.842Z] [INFO] Fundamentals-refresh budget: 1/3000 time-based full pulls used; none deferred.
pull (1)	UNKNOWN STEP	2026-09-18T08:15:24.2372935Z [2026-09-18T08:15:24.237Z] [INFO] Fundamentals-refresh budget: 4/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-09-18T08:15:19.5750608Z [2026-09-18T08:15:19.574Z] [INFO] Fundamentals-refresh budget: 5/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-09-18T08:15:13.2504971Z [2026-09-18T08:15:13.250Z] [INFO] Fundamentals-refresh budget: 2/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-09-18T08:15:38.6226703Z [2026-09-18T08:15:38.622Z] [INFO] Fundamentals-refresh budget: 3/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-09-18T08:15:03.6096204Z [2026-09-18T08:15:03.609Z] [INFO] Fundamentals-refresh budget: 4/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-09-18T08:15:43.1781309Z [2026-09-18T08:15:43.177Z] [INFO] Fundamentals-refresh budget: 1/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-09-18T08:16:37.0173005Z [2026-09-18T08:16:37.017Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-09-18T08:15:32.9184520Z [2026-09-18T08:15:32.918Z] [INFO] Fundamentals-refresh budget: 2/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-09-18T08:15:42.5358888Z [2026-09-18T08:15:42.535Z] [INFO] Fundamentals-refresh budget: 2/3000 time-based full pulls used; none deferred.
```

#### 35428969634 — 2026-09-19T07:18:37Z

abgebrochen vor dem Pull (Größenregel des Briefs).

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 0/17 erwartete Shards nach Populationsmanifest.

```text
```

#### 35438100627 — 2026-09-19T10:41:45Z

Pull-Log messbar.

Selector-Diagnose: nicht vorhanden (keine Nullmessung). Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (1)	UNKNOWN STEP	2026-09-19T11:34:18.9347920Z [2026-09-19T11:34:18.934Z] [INFO] Fundamentals-refresh budget: 1/3000 time-based full pulls used; none deferred.
pull (3)	UNKNOWN STEP	2026-09-19T11:34:28.4258159Z [2026-09-19T11:34:28.425Z] [INFO] Fundamentals-refresh budget: 7/3000 time-based full pulls used; none deferred.
pull (12)	UNKNOWN STEP	2026-09-19T11:34:20.7945027Z [2026-09-19T11:34:20.794Z] [INFO] Fundamentals-refresh budget: 8/3000 time-based full pulls used; none deferred.
pull (2)	UNKNOWN STEP	2026-09-19T11:33:40.2942285Z [2026-09-19T11:33:40.294Z] [INFO] Fundamentals-refresh budget: 6/3000 time-based full pulls used; none deferred.
pull (7)	UNKNOWN STEP	2026-09-19T11:35:03.5282220Z [2026-09-19T11:35:03.528Z] [INFO] Fundamentals-refresh budget: 9/3000 time-based full pulls used; none deferred.
pull (5)	UNKNOWN STEP	2026-09-19T11:33:29.8779654Z [2026-09-19T11:33:29.877Z] [INFO] Fundamentals-refresh budget: 4/3000 time-based full pulls used; none deferred.
pull (0)	UNKNOWN STEP	2026-09-19T11:34:36.5716047Z [2026-09-19T11:34:36.571Z] [INFO] Fundamentals-refresh budget: 12/3000 time-based full pulls used; none deferred.
pull (13)	UNKNOWN STEP	2026-09-19T11:34:23.1807754Z [2026-09-19T11:34:23.180Z] [INFO] Fundamentals-refresh budget: 5/3000 time-based full pulls used; none deferred.
pull (11)	UNKNOWN STEP	2026-09-19T11:35:27.8979518Z [2026-09-19T11:35:27.897Z] [INFO] Fundamentals-refresh budget: 10/3000 time-based full pulls used; none deferred.
pull (9)	UNKNOWN STEP	2026-09-19T11:35:17.3064612Z [2026-09-19T11:35:17.306Z] [INFO] Fundamentals-refresh budget: 14/3000 time-based full pulls used; none deferred.
pull (14)	UNKNOWN STEP	2026-09-19T11:35:22.6142224Z [2026-09-19T11:35:22.614Z] [INFO] Fundamentals-refresh budget: 8/3000 time-based full pulls used; none deferred.
pull (15)	UNKNOWN STEP	2026-09-19T11:34:40.4306840Z [2026-09-19T11:34:40.430Z] [INFO] Fundamentals-refresh budget: 11/3000 time-based full pulls used; none deferred.
pull (6)	UNKNOWN STEP	2026-09-19T11:35:23.1257590Z [2026-09-19T11:35:23.125Z] [INFO] Fundamentals-refresh budget: 7/3000 time-based full pulls used; none deferred.
pull (10)	UNKNOWN STEP	2026-09-19T11:34:39.9115737Z [2026-09-19T11:34:39.911Z] [INFO] Fundamentals-refresh budget: 9/3000 time-based full pulls used; none deferred.
pull (16)	UNKNOWN STEP	2026-09-19T11:34:45.9684656Z [2026-09-19T11:34:45.968Z] [INFO] Fundamentals-refresh budget: 12/3000 time-based full pulls used; none deferred.
pull (8)	UNKNOWN STEP	2026-09-19T11:34:42.6609360Z [2026-09-19T11:34:42.660Z] [INFO] Fundamentals-refresh budget: 4/3000 time-based full pulls used; none deferred.
pull (4)	UNKNOWN STEP	2026-09-19T11:34:23.2575831Z [2026-09-19T11:34:23.257Z] [INFO] Fundamentals-refresh budget: 8/3000 time-based full pulls used; none deferred.
```

#### 35500025507 — 2026-09-20T08:36:36Z

Pull-Log messbar.

Selector-Diagnose: wörtliche Zeilen unten. Budget-Schlusszeilen: 17/17 erwartete Shards nach Populationsmanifest.

```text
pull (6)	Run Yahoo Pull (shard 6/17)	2026-09-20T09:29:16.8387553Z [2026-09-20T09:29:16.838Z] [INFO] Selector-Diagnose: 964 Ticker durch das 7-Tage-Tor, davon 0 mit fundamentalsAsOf > 30d; jenseits des Tors 0 ueberfaellig und 0 mit nicht lesbarer Uhr.
pull (1)	Run Yahoo Pull (shard 1/17)	2026-09-20T09:28:43.2433292Z [2026-09-20T09:28:43.243Z] [INFO] Selector-Diagnose: 902 Ticker durch das 7-Tage-Tor, davon 1 mit fundamentalsAsOf > 30d; jenseits des Tors 0 ueberfaellig und 0 mit nicht lesbarer Uhr.
pull (10)	Run Yahoo Pull (shard 10/17)	2026-09-20T09:28:42.9673777Z [2026-09-20T09:28:42.967Z] [INFO] Selector-Diagnose: 970 Ticker durch das 7-Tage-Tor, davon 1 mit fundamentalsAsOf > 30d; jenseits des Tors 0 ueberfaellig und 0 mit nicht lesbarer Uhr.
pull (15)	Run Yahoo Pull (shard 15/17)	2026-09-20T09:28:35.8356396Z [2026-09-20T09:28:35.835Z] [INFO] Selector-Diagnose: 911 Ticker durch das 7-Tage-Tor, davon 0 mit fundamentalsAsOf > 30d; jenseits des Tors 0 ueberfaellig und 0 mit nicht lesbarer Uhr.
pull (12)	Run Yahoo Pull (shard 12/17)	2026-09-20T09:28:53.2160970Z [2026-09-20T09:28:53.215Z] [INFO] Selector-Diagnose: 962 Ticker durch das 7-Tage-Tor, davon 2 mit fundamentalsAsOf > 30d; jenseits des Tors 1 ueberfaellig und 0 mit nicht lesbarer Uhr.
pull (3)	Run Yahoo Pull (shard 3/17)	2026-09-20T09:28:45.1968029Z [2026-09-20T09:28:45.193Z] [INFO] Selector-Diagnose: 905 Ticker durch das 7-Tage-Tor, davon 0 mit fundamentalsAsOf > 30d; jenseits des Tors 0 ueberfaellig und 0 mit nicht lesbarer Uhr.
pull (11)	Run Yahoo Pull (shard 11/17)	2026-09-20T09:29:28.0252740Z [2026-09-20T09:29:28.022Z] [INFO] Selector-Diagnose: 1040 Ticker durch das 7-Tage-Tor, davon 1 mit fundamentalsAsOf > 30d; jenseits des Tors 0 ueberfaellig und 0 mit nicht lesbarer Uhr.
pull (0)	Run Yahoo Pull (shard 0/17)	2026-09-20T09:28:33.9955210Z [2026-09-20T09:28:33.991Z] [INFO] Selector-Diagnose: 893 Ticker durch das 7-Tage-Tor, davon 0 mit fundamentalsAsOf > 30d; jenseits des Tors 0 ueberfaellig und 0 mit nicht lesbarer Uhr.
pull (2)	Run Yahoo Pull (shard 2/17)	2026-09-20T09:27:43.9123825Z [2026-09-20T09:27:43.912Z] [INFO] Selector-Diagnose: 944 Ticker durch das 7-Tage-Tor, davon 0 mit fundamentalsAsOf > 30d; jenseits des Tors 0 ueberfaellig und 0 mit nicht lesbarer Uhr.
pull (5)	Run Yahoo Pull (shard 5/17)	2026-09-20T09:28:08.8386563Z [2026-09-20T09:28:08.838Z] [INFO] Selector-Diagnose: 970 Ticker durch das 7-Tage-Tor, davon 1 mit fundamentalsAsOf > 30d; jenseits des Tors 1 ueberfaellig und 0 mit nicht lesbarer Uhr.
pull (14)	Run Yahoo Pull (shard 14/17)	2026-09-20T09:28:52.6226630Z [2026-09-20T09:28:52.622Z] [INFO] Selector-Diagnose: 924 Ticker durch das 7-Tage-Tor, davon 2 mit fundamentalsAsOf > 30d; jenseits des Tors 1 ueberfaellig und 0 mit nicht lesbarer Uhr.
pull (13)	Run Yahoo Pull (shard 13/17)	2026-09-20T09:28:29.6761181Z [2026-09-20T09:28:29.675Z] [INFO] Selector-Diagnose: 936 Ticker durch das 7-Tage-Tor, davon 2 mit fundamentalsAsOf > 30d; jenseits des Tors 0 ueberfaellig und 0 mit nicht lesbarer Uhr.
pull (16)	Run Yahoo Pull (shard 16/17)	2026-09-20T09:28:46.4687974Z [2026-09-20T09:28:46.464Z] [INFO] Selector-Diagnose: 850 Ticker durch das 7-Tage-Tor, davon 3 mit fundamentalsAsOf > 30d; jenseits des Tors 0 ueberfaellig und 0 mit nicht lesbarer Uhr.
pull (9)	Run Yahoo Pull (shard 9/17)	2026-09-20T09:29:07.8797974Z [2026-09-20T09:29:07.879Z] [INFO] Selector-Diagnose: 1023 Ticker durch das 7-Tage-Tor, davon 1 mit fundamentalsAsOf > 30d; jenseits des Tors 0 ueberfaellig und 0 mit nicht lesbarer Uhr.
pull (8)	Run Yahoo Pull (shard 8/17)	2026-09-20T09:28:51.6977865Z [2026-09-20T09:28:51.697Z] [INFO] Selector-Diagnose: 945 Ticker durch das 7-Tage-Tor, davon 0 mit fundamentalsAsOf > 30d; jenseits des Tors 0 ueberfaellig und 0 mit nicht lesbarer Uhr.
pull (4)	Run Yahoo Pull (shard 4/17)	2026-09-20T09:28:27.7737199Z [2026-09-20T09:28:27.769Z] [INFO] Selector-Diagnose: 893 Ticker durch das 7-Tage-Tor, davon 1 mit fundamentalsAsOf > 30d; jenseits des Tors 0 ueberfaellig und 0 mit nicht lesbarer Uhr.
pull (7)	Run Yahoo Pull (shard 7/17)	2026-09-20T09:29:00.6705439Z [2026-09-20T09:29:00.670Z] [INFO] Selector-Diagnose: 1016 Ticker durch das 7-Tage-Tor, davon 3 mit fundamentalsAsOf > 30d; jenseits des Tors 1 ueberfaellig und 0 mit nicht lesbarer Uhr.
pull (6)	Run Yahoo Pull (shard 6/17)	2026-09-20T09:29:16.8385211Z [2026-09-20T09:29:16.838Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (1)	Run Yahoo Pull (shard 1/17)	2026-09-20T09:28:43.2431672Z [2026-09-20T09:28:43.242Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (10)	Run Yahoo Pull (shard 10/17)	2026-09-20T09:28:42.9672393Z [2026-09-20T09:28:42.967Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (15)	Run Yahoo Pull (shard 15/17)	2026-09-20T09:28:35.8354731Z [2026-09-20T09:28:35.835Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (12)	Run Yahoo Pull (shard 12/17)	2026-09-20T09:28:53.2159767Z [2026-09-20T09:28:53.215Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (3)	Run Yahoo Pull (shard 3/17)	2026-09-20T09:28:45.1933933Z [2026-09-20T09:28:45.193Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (11)	Run Yahoo Pull (shard 11/17)	2026-09-20T09:29:28.0251814Z [2026-09-20T09:29:28.022Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (0)	Run Yahoo Pull (shard 0/17)	2026-09-20T09:28:33.9919432Z [2026-09-20T09:28:33.991Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (2)	Run Yahoo Pull (shard 2/17)	2026-09-20T09:27:43.9122122Z [2026-09-20T09:27:43.912Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (5)	Run Yahoo Pull (shard 5/17)	2026-09-20T09:28:08.8385031Z [2026-09-20T09:28:08.838Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (14)	Run Yahoo Pull (shard 14/17)	2026-09-20T09:28:52.6224304Z [2026-09-20T09:28:52.622Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (13)	Run Yahoo Pull (shard 13/17)	2026-09-20T09:28:29.6758709Z [2026-09-20T09:28:29.675Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (16)	Run Yahoo Pull (shard 16/17)	2026-09-20T09:28:46.4644724Z [2026-09-20T09:28:46.464Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (9)	Run Yahoo Pull (shard 9/17)	2026-09-20T09:29:07.8795482Z [2026-09-20T09:29:07.879Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (8)	Run Yahoo Pull (shard 8/17)	2026-09-20T09:28:51.6977027Z [2026-09-20T09:28:51.697Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (4)	Run Yahoo Pull (shard 4/17)	2026-09-20T09:28:27.7698648Z [2026-09-20T09:28:27.769Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
pull (7)	Run Yahoo Pull (shard 7/17)	2026-09-20T09:29:00.6704280Z [2026-09-20T09:29:00.670Z] [INFO] Fundamentals-refresh budget: 0/3000 time-based full pulls used; none deferred.
```

Reproduktion: `node scripts/t331-fundamentaluhr-wellen.js --population <POPULATION> --logs <LOGS>`; Test: `node tests/t331-fundamentaluhr-wellen.test.js`.
