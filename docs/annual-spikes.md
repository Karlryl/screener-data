# Jahresausreißer und ihre Identität

> **Auf einen Blick**
>
> P211 ergänzt Canlons belegtes Verlustjahr 2024; am 13.10.2026 sinkt die Zahl neuer Ereignisse von sechs auf fünf, ohne Änderung einer Boardzahl oder Alarmgrenze.
>
> * Ticker, Jahresreihe, Währung und alle drei Werte gehören zur Identität; Perioden werden verglichen, wenn beide Seiten datiert sind.
> * Viaplays Betriebsergebnisse 2022 bis 2025 sind belegt und sichtbar. Kinneviks Reihe bleibt wegen unbelegter neuerer Jahre zurückgehalten.
> * Neue oder nicht sicher zuordenbare Fälle bleiben meldbar. Sämtliche bisherigen Alarmgrenzen und das Ablaufdatum bleiben unverändert.

## Laufender Abgleich

Die Jahreswerte stehen unter `annual.<Reihe>[i].value` in USD. Die Rückrechnung verwendet ausschließlich `meta.fxRateApplied` zusammen mit `meta.reportingCurrencyOriginal`, `meta.reportingCurrency = USD` und `meta.fxConverted = true`. Der Handelswährungsfaktor `meta.tradingFxRateApplied` ist dafür ungeeignet.

Das Periodenende stammt aus `meta.statementPeriods.<Reihe>[i].end`. Vorhandene Metadaten müssen einen zwölfmonatigen Währungsbetrag derselben Berichtswährung beschreiben. Fehlt das Ende, ist ein vorhandenes `annual.<Reihe>Ends[i]` zulässig. Fehlende und `null`-Einträge gelten als fehlende Datierung; dann steht `periode: null` in der nativen Identität. Widersprüchliche Angaben, ungültige Datumswerte und falsche Währungen oder Laufzeiten werden weiterhin abgewiesen. Fehlende Perioden werden nicht durch einen Index oder erfundene Kalenderjahre ersetzt.

Der Schlüssel enthält den Ausreißer und beide Nachbarwerte, jeweils geteilt durch den angewandten Wechselkurs und auf zehn signifikante Stellen gerundet. Der maximale Rundungsfehler liegt ungefähr bei 5 × 10⁻¹⁰ relativ. Das beseitigt reine Rechenungenauigkeit und akzeptiert keine allgemeine Lieferantenrevision. Sind beide Seiten datiert, müssen die Perioden übereinstimmen. Fehlt einer Seite das Periodenende, vergleicht P168d die gültigen nativen Schlüssel ohne Periode. Währung und alle drei Werte müssen weiter übereinstimmen. Ungültige Datierungen werden vor diesem Vergleich abgewiesen. Ohne Datierung lassen sich identische Dreiergruppen verschiedener Jahre nicht unterscheiden.

Alte USD-Schlüssel bleiben lesbar, auch nach der Migration, wenn beim heutigen Fund die native Identität vollständig fehlt. Das umfasst nach Entscheidung 3 auch unbrauchbare Metadaten, die `nativ: null` ergeben; ein gleicher USD-Schlüssel ist dann kein unabhängiger Beleg korrekter Metadaten. Ergänzte oder verschwundene Periodenenden bleiben bei gleicher nativer Dreiergruppe samt Berichtswährung auch mit gleichzeitiger USD-Wechselkursdrift bekannt. Verfügbare, gültige, abweichende native Werte, Währungen oder zwei unterschiedliche belegte Perioden werden nicht durch den USD-Schlüssel überstimmt.

Ein aus Umsatz und Marge berechnetes Betriebsergebnis (`computed-margin`) zählt zusätzlich als bekannt, wenn derselbe Ticker bereits einen Betriebsergebnisfall im Bestand hat, sein Umsatzfund bekannt ist und beide dieselbe ausdrücklich belegte Periode und Berichtswährung tragen. An allen drei Positionen muss `Betriebsergebnis / Umsatz` bis auf 10⁻⁹ relativ gleich sein. Fehlende Datierung, Nullumsatz, echte berichtete Betriebsergebnisse und neue Betriebsergebnisreihen werden dadurch nicht freigegeben. Diese laufende Regel erkennt einen abhängigen Umsatzfall wieder; sie erklärt eine geänderte Marge nicht nachträglich zu Wechselkursdrift. Die Prüfung auf wirkungslose Ausschlüsse berücksichtigt auch diesen Weg.

Der vorhandene Betriebsergebnisfall muss zum aktuellen Fall passen: Eine bereits migrierte Periode muss dieselbe sein, die Währung ebenfalls. Ohne alte Datierung muss die heutige Betriebsergebnis-Dreiergruppe zur alten USD-Dreiergruppe proportional sein, bis auf 10⁻⁹ relativ, mit positivem Faktor und unveränderten Nullen. Ein fremdes Geschäftsjahr desselben Tickers genügt nicht. Ein gleichförmiger Margenwechsel bleibt zulässig, eine neue Reihenform nicht.

## Einmalige Migration

Der Korrekturauftrag P168b vom 11.10.2026 verschärft die proportionale Zuordnung von einem Prozent auf höchstens 10⁻⁹ relative Abweichung. Ein unabhängig gemessener historischer Wechselkurs lässt sich aus den beiden Oktoberständen überwiegend nicht belegen.

Für jede vorhandene USD-Dreiergruppe wird ausschließlich unter demselben Ticker und derselben Jahresreihe gesucht. Mit dem zentralen Wert wird `f = heute / alt` berechnet. Für alle drei Positionen muss `abs(heute / (alt × f) − 1) <= 1e-9` gelten. Null muss Null bleiben; Vorzeichenwechsel und nicht positive Faktoren sind unzulässig. Genau ein heutiger Fund muss passen und eine belegte native Identität tragen. Ein vorhandenes Periodenende wird als Zuordnung aus dem angegebenen Datenstand dokumentiert, nicht als historisch gespeicherter Beleg ausgegeben.

Zusätzliche Gegenprüfungen verhindern belegte Fehlzuordnungen. Bei der Berichtswährung USD muss der Faktor bis auf Rechenungenauigkeit eins sein. Bei `computed-margin` muss die Marge gegen eine passende alte und heutige Umsatzreihe derselben belegten Periode unverändert sein, mit höchstens 10⁻⁹ relativer Rechenabweichung. Gleichmäßig skalierte Betriebsergebnisse nach einer Margenrevision werden daher weiterhin nicht migriert. Das betrifft unter anderem 001450.KS und NVG; die separate laufende Umsatzregel kann diese abhängigen Funde dennoch wiedererkennen. Fehlt die Gegenprobe, wird nicht migriert.

Bis einschließlich P168e verhindert die Eichregel eine Freigabe durch alte Baseline-Einträge: KINV-A.ST, KINV-B.ST, MFSL.BO und MFSL.NS jeweils mit Betriebsergebnis und Umsatz sowie VPLAY-A.ST mit Betriebsergebnis und Nettoergebnis bleiben darüber NEU. Seit P168e kann die tatsächlich angewandte Handtabellenkorrektur der genauen Zelle diesen Vorrang aufheben. P168f ergänzt die unten belegte Freigabe des Viaplay-Nettoverlusts. P168b entfernt gezielt drei zuvor migrierte native Zuordnungen der beiden Zwillinge; ihre ursprünglichen USD-Einträge bleiben als Eichbestand erhalten. Die Ausschlussliste bleibt ebenfalls wirksam.

`faelle`, `anzahl`, `aufgenommenAm`, Hinweise und Ausschlüsse bleiben unverändert. Ergänzt wird `nativeIdentitaeten`, mit dem ursprünglichen Schlüssel, nativer Dreiergruppe, Periodenende, Währung, Datenstand, aktuellem Umrechnungsfaktor, beobachtetem USD-Verhältnis und größter Zuordnungsabweichung. Mehrere historische USD-Versionen können dieselbe native Identität erhalten. Eine Wiederholung ändert bereits migrierte Einträge nicht. Fehlende, mehrdeutige und nicht passende Fälle behalten ihre alten Einträge.

Auf dem Stand vom 10.10.2026 kommen 50 native Zuordnungen vorhandener Fälle hinzu. Nach Rücknahme der drei Eichzuordnungen bleiben 136 Einträge mit 130 verschiedenen nativen Identitäten. Die größte Migrationsabweichung beträgt 3,33 × 10⁻¹⁶. Es bleiben alle 155 alten Fallschlüssel erhalten; kein Fall außerhalb dieses Bestands wird aufgenommen.

Die proportionale Zuordnung ist die ausdrücklich erlaubte Arbeitsregel, kein unabhängiger Beweis einer Wechselkursbewegung. Eine gleichmäßige Revision aller drei Originalwerte kann grundsätzlich genauso aussehen. Die Gegenprüfung berechneter Margen schließt den konkret nachgewiesenen Fehlerweg. Diese verbleibende Grenze wird im Ergebnisbericht ausgewiesen.

```text
node scripts/annual-spikes-migrate-identity.js <absoluter-Snapshot-Ordner> 2026-10-10
node scripts/annual-spikes-migrate-identity.js <absoluter-Snapshot-Ordner> 2026-10-10 --write
```

Der erste Befehl prüft ohne Schreiben. Erst nach Prüfung des Ergebnisses schreibt der zweite Befehl die Ergänzungen atomar in die vorhandene Baseline. `--neu-aufnehmen` ist für einen bereits migrierten Bestand gesperrt, weil eine Gesamtneuaufnahme die überprüften Identitäten und ihre Herkunft verlieren würde. Die normale Tagesprüfung schreibt weiterhin nichts und verwendet unverändert den Snapshot-Ordner des Repositorys.

## Nachweise

`tests/annual-spikes-native-identity-p168.test.js` prüft drei Prozent reine Wechselkursdrift, gleiche USD-Werte bei geändertem Nativwert, fehlende Neuaufnahme, Altformat-Kompatibilität und die absichtliche Rückkehr zum falschen USD-Vergleich in einer temporären Modulkopie. Der letzte Fall muss einen `AssertionError` auslösen. Prüfsummen sichern dabei den unveränderten Live-Wächter und die Baseline ab. Weitere Gegenproben schützen Perioden, Metadaten, Eichfälle, Margenrevisionen, Mehrdeutigkeiten und Ausschlüsse.

`tests/annual-spikes-native-identity-p168b.test.js` sichert jede der fünf Entscheidungen mit einer eigenen absichtlichen Bruchprobe sowie Gegenfällen. Beide Rechercheprogramme werden mit vollständig im Speicher liegenden Testdaten ausgeführt und verwenden denselben Bekannt-Abgleich. Ihre historischen Standardpfade werden dabei nicht gelesen oder beschrieben. Im Signaturbericht heißt die bisherige Spalte `exakt?` nun `bekannt?`; sie folgt dem Wächter statt allein dem alten USD-Schlüssel.

Bei festgehaltener Uhr `2026-10-11T12:00:00Z` ergeben beide Datenstände vom 09. und 10.10. gegenüber P168 jeweils 54 → 22 neue Funde und 38 → 12 gezählte Ereignisse. Die Gleichfaktorprüfung meldet durch die Eichzwillinge jetzt vier statt zwei Ticker. Beide Läufe bleiben rot, bei unverändertem Budget fünf, Faktor acht, Gleichfaktortoleranz 1,02 und `MELDEND_BIS = 2026-10-10T00:00:00Z`.

## Gezielte Aufnahme P168d am 11.10.2026

AHG (Betriebsergebnis 2025), Credia (Nettoergebnis, Quellenjahr 2024), Sofina (Nettoergebnis 2024; drei Notierungen) und Syncona (Nettoergebnis 2025) sind nach erneutem Lesen der Originalberichte als vier echte Sonderjahre aufgenommen. Die sechs neuen Fallschlüssel und nativen Identitäten stammen aus dem unveränderten Snapshot-Stand 10.10.2026. Alle 155 alten Schlüssel und 136 alten nativen Einträge bleiben erhalten. `anzahl` steigt auf 161; 142 native Einträge sind vorhanden. Das bestehende Feld `hinweis` enthält je Ereignis URL, Originalzitat, Seite, Berichtsende und Prüfdatum. Das alte Aufnahmedatum und sämtliche Ausschlüsse bleiben unverändert. Es wurde kein Bestand neu erzeugt.

Die bestehende Handtabelle hält Max Financials Jahresumsatz 2024 und die älteren Werte für MFSL.BO und MFSL.NS zurück, damit kein Wachstum über die belegte Mischung aus Konzern- und Einzelabschluss berechnet wird. Ein Zahlenersatz würde eine durchgehend vergleichbare Quellenbasis voraussetzen. Die Betriebsergebnisse von Max Financial, Kinnevik und Viaplay passen noch nicht in die bestehende Einzelwerttabelle und bleiben für P177 offen. Banpus Betriebsergebnis bleibt ohne eindeutigen Ersatz offen. PCT und Treasury Wine Estates bleiben unverändert NEU. Insbesondere Viaplays falsches Vorzeichen wird durch P168d noch nicht korrigiert.

Der Wächter liest rohe Snapshots, keine Handtabellenkorrekturen. Nach P168d ergeben beide festgehaltenen Tage jeweils 22 → 16 neue Funde und 12 → 8 gezählte Ereignisse; vier Gleichfaktor-Ticker bleiben. Beide Läufe bleiben bei erlaubten fünf Ereignissen rot (Exit 1). Der Test `tests/annual-spikes-native-identity-p168d.test.js` prüft beide Datierungswechsel mit USD-Drift, Gegenfälle für Währung, Werte und Perioden, die echten Baseline-Aufnahmen und die Max-Financial-Rückhaltung. Die Bruchprobe deaktiviert nur den neuen Vergleich in einer temporären Modulkopie; Prüfsummen schützen den Live-Stand.

## Handtabellenabgleich P168e am 11.10.2026

Der Scan findet die Ausreißer weiterhin in den unveränderten Rohdaten und führt für betroffene Snapshots zusätzlich die vorhandene `applyFinancialCases()` im Speicher aus. Bekannt wird nur die exakt angewandte Zelle mit passendem Ticker beziehungsweise Alias, Jahresreihe, Periodenende und Anbieterwert. Eine gezielte Rückhaltung mit `null` zählt ebenfalls, da der falsche Wert das Board nicht erreicht. Eine bloße Tabellenzeile, ein veralteter Fingerabdruck, eine andere Währung oder die automatisch fortgesetzte Rückhaltung älterer Jahre genügt nicht. Bereits gespeicherte Korrekturen benötigen ihren passenden aktuellen Fall samt Werten, Währung und Revision. Die Rohdaten und die Baseline werden dabei nicht verändert.

Viaplay 2023 erhält −10.276 Mio. SEK statt +10.276 Mio. SEK, Kinnevik 2023 erhält für beide Aktienklassen −5.123 Mio. SEK statt +893,85192 Mio. SEK. Viaplays −558 Mio. SEK gehören zu 2024. Quellen, Seiten, Originalzitate und Datierungen stehen in den beiden angehängten Tabellenfällen. Der bestehende P177-Schutz hält die vollständigen Betriebsergebnisreihen zurück, solange 2025 nicht durch die erlaubten Quellen belegt ist. Der neue Ersatzwert ist daher hinterlegt; die derzeit wirksame Ausgabe ist eine erklärte Lücke.

Die Handtabelle behandelt fünf Ausreißer: Viaplays Betriebsergebnis, beide Kinnevik-Betriebsergebnisse und beide bestehenden MFSL-Umsatzrückhaltungen. Andere Reihen derselben Firma werden dadurch nicht bekannt. Offen bleiben insbesondere Kinneviks Umsatzzuordnung, MFSLs aus der Marge berechnetes Betriebsergebnis, Banpus uneindeutiges Betriebsergebnis und Viaplays Nettoergebnis als eigener, bisher nicht freigegebener Eichfund. Die beiden U-Ereignisse PCT und Treasury Wine Estates bleiben NEU.

Auf den Datenständen 09.10. und 10.10. mit Uhr `2026-10-11T12:00:00Z` sinken die neuen Einzelwerte von 16 auf 11 und die Gleichfaktor-Ticker von vier auf null. Die Ereigniszahl bleibt acht, weil jeweils andere Reihen derselben Ereignisse offen bleiben. Beide Läufe enden mit Exit 1 bei unverändert erlaubten fünf. Faktor acht, Toleranz 1,02 und MELDEND_BIS bleiben unverändert.

P168e stellt außerdem die alte Reihenfolge der 258 P177-Tabellenfälle wieder her und hängt MFSL sowie die zwei neuen Fälle an. Die Tests pinnen jetzt 261 Fälle, davon 40 jährliche. Der Baseline-Zähler wird ausschließlich um die sechs bereits belegten P168d-Schlüssel von 155 auf 161 berichtigt. `tests/annual-spikes-native-identity-p168e.test.js` prüft Anwesenheit und Abwesenheit der Korrektur, falsche Kontexte, Aliase, andere Reihen, fortgesetzte Rückhaltungen und bereits gespeicherte Korrekturen. Die absichtliche Abschaltung der Erkennung in einer rein im Speicher gehaltenen Modulkopie muss rot werden; Prüfsummen schützen Wächter, Baseline und Tabelle.

## Belegte Jahreswerte P168f am 11.10.2026

Viaplays Betriebsergebnisreihe zeigt 2025 bis 2022 nun −486, −558, −10.276 und +413 Mio. SEK. Drei Bestätigungsfälle ergänzen den bestehenden Vorzeichenfall. Der Geschäftsbericht 2025, Seite 84, belegt −486 Mio. SEK; der Geschäftsbericht 2024, Seiten 32 und 130, belegt die übrigen Jahre. Die eigene Revision des 2023-Falls wird aktualisiert, damit auch schon gespeicherte P168e-Rückhaltungen erneut geprüft werden. Sein sichtbarer Grund nennt jetzt Bericht und Seite; seine Quellen bleiben am Korrekturmarker erhalten. Die Bibliothek, der Schutz gegen ungeprüfte neue Jahre und die allgemeine Tabellenrevision bleiben unverändert.

MFSLs aus 466.183.100.000 INR Umsatz und einer aktuellen Marge berechnetes Betriebsergebnis 2023/24 von 5.538.254.761,8169 INR wird für beide Notierungen gezielt zurückgehalten. Der Konzernabschluss, Druckseite 235/PDF 237, nennt Gesamtertrag und Vorsteuergewinn, aber keinen direkt austauschbaren Betriebsgewinn. 46,61,832.00 lakh sind exakt 466.183.200.000 INR; der Vorsteuergewinn wird nicht zum Betriebsgewinn umbenannt. Ältere Jahre werden durch die bestehende Regel mit zurückgehalten. Die Tabelle enthält damit 265 Fälle, davon 44 jährliche.

Kinneviks 3.538 Mio. SEK für 2022 sind auf Druckseite 70/PDF 72 des Geschäftsberichts 2023 ausdrücklich erhaltene Dividenden. Ihre Zuordnung zum allgemeinen Umsatzfeld bleibt ungeklärt; deshalb bleibt die Anbieter-Null unverändert und der Umsatzfund meldbar. Banpu, PCT und Treasury Wine Estates bleiben ebenfalls offen.

Viaplays Nettoverlust 2023 von 9.747 Mio. SEK ist auf Seite 32 des Geschäftsberichts 2024 belegt. Nur diese Nettoergebnisreihe entfällt aus der pauschalen Eichsperre. Der vorhandene USD-Schlüssel erhält eine native Identität, SEK [106.000.000, −9.747.000.000, 323.000.000], Periode 31.12.2023. Alle 161 historischen Schlüssel, die sechs Eichformen und sämtliche Ausschlüsse bleiben unverändert; es gibt jetzt 143 native Einträge. Q1-3 prüft weiterhin dieselben acht auslösenden und 15 nicht auslösenden Formen, darunter Viaplay als echtes Abschreibungsjahr. Neue synthetische Gegenfälle sichern abweichende Beträge, Währungen und Jahre sowie fehlende Autorität ab. Weder Grenzwerte noch Frist werden verändert.

Der Nachlauf beider Datenstände vom 09. und 10.10.2026 mit Uhr `2026-10-11T12:00:00Z` ergibt jeweils elf → acht neue Einzelwerte und acht → fünf gezählte Ereignisse. Sieben Ausreißer werden durch die Handtabelle behandelt; der zusätzliche Nettoverlust ist über seine belegte Identität bekannt. Die Gleichfaktorzahl bleibt null. Beide Wächterläufe sind mit Exit 0 grün, genau bei unverändert erlaubten fünf Ereignissen.

## Canlons belegtes Verlustjahr P211 am 13.10.2026

300715.SZ ist Jiangsu Canlon Building Materials, in Shenzhen notiert. Die Originalberichte bestätigen alle sechs Werte der Dreiergruppe 2025/2024/2023 in CNY, Einheit des Abschlusses `元` (Yuan). Der [Geschäftsbericht 2024](https://static.cninfo.com.cn/finalpage/2025-04-19/1223143379.PDF), Druck-/PDF-Seite 72, nennt für 2024/2023 „三、营业利润（亏损以“－”号填列） -651,163,336.96 -1,528,740.02“ und „1.归属于母公司股东的净利润 -538,648,272.66 22,637,174.89“. Die Einheit steht auf Seite 71. Seite 72 zeigt außerdem Kreditwertberichtigungen von 481.462.169,29 CNY und weitere Wertberichtigungen von 105.566.816,26 CNY; Seite 2 nennt Umsatzrückgang und Wertberichtigungen als Verlustursachen. Das ist ein belegtes Sonderjahr, kein nachgewiesener Anbieterfehler. Sicherheit 99 %.

Der [Geschäftsbericht 2025](https://static.cninfo.com.cn/finalpage/2026-04-24/1225163584.PDF), Seite 73, bestätigt die 2024er Vergleichswerte und nennt für 2025 „三、营业利润（亏损以“－”号填列） 16,789,103.06 -651,163,336.96“ sowie „1.归属于母公司股东的净利润 20,396,737.72 -538,648,272.66“. Der [Geschäftsbericht 2023](https://static.cninfo.com.cn/finalpage/2024-04-20/1219690891.PDF), Seite 80, bestätigt „三、营业利润（亏损以“－”号填列） -1,528,740.02 -186,294,318.77“ und „1.归属于母公司股东的净利润 22,637,174.89 -159,018,962.78“ (2023/2022). Die Einheiten stehen jeweils eine Seite davor. Zeilenumbrüche innerhalb der chinesischen Bezeichnungen sind hier zusammengezogen.

Genau zwei USD-Schlüssel und zwei native Identitäten kommen in der vorhandenen Form hinzu, einschließlich Quellen im Feld `hinweis`. Der Bestand steigt von 161 auf 163 Schlüssel und von 143 auf 145 native Einträge. Alle bisherigen Einträge, Aufnahmedatum und Ausschlüsse bleiben erhalten. Die unveränderte Rundung auf zehn signifikante Stellen macht aus den 2024er Verlusten im Identitätsschlüssel −651.163.337 und −538.648.272,7 CNY; die Originalbeträge mit Cent bleiben im Quellenbeleg. `usdFaktor = 1` und `maxRelativeAbweichung = 0` beziehen sich ausschließlich auf denselben Snapshot vom 13.10., nicht auf eine historische Migration.

Die Handtabelle und der Programmcode bleiben unverändert. Die Änderung betrifft nur die bekannte Fallliste des Wächters; kein Jahreswert, Score oder Rang wird geändert. Bei Uhr `2026-10-13T12:00:00Z` sinkt der Stand vom 13.10. von zehn auf acht neue Einzelwerte und von sechs auf fünf Ereignisse. Der Stand vom 10.10. bleibt bei acht Einzelwerten und fünf Ereignissen; dort fehlt 300715.SZ noch. Beide Nachläufe enden mit Exit 0, genau bei erlaubten fünf. Faktor 8, Toleranz 1,02, `MELDEND_BIS` und Altersprüfung bleiben unverändert. Alle bisherigen 23 Eichformen bleiben erhalten; Canlon ergänzt genau eine nicht auslösende Form (24 insgesamt, acht auslösend, 16 nicht auslösend).

Stand P211, durch P218 unten geklärt: 000301.SZ blieb ausdrücklich offen: `annualOpInc|1`, ursprünglicher Beginn 29.08., erneuerter Beginn `offenSeit = 2026-09-26`, am 13.10. 17 Tage alt. Die Sperre verhinderte die Aufnahme als bekannt und nahm den Fund aus dem Ereignisbudget. Das unveränderte Tor wäre ab **27.10.2026 00:00 UTC** rot geworden, weil es erst bei mehr als 30 vollen Tagen greift. P168f belegte keine fachliche Klärung. Benötigt wurden ein unabhängiger Originalbericht und die eindeutige Zuordnung von Betriebsergebnis, Geschäftsjahr 2024 und Nachbarjahren; eine native Identität allein genügt dafür nicht.

## Gezielte Klärung P218 am 13.10.2026

000301.SZ ist Jiangsu Eastern Shenghong (江苏东方盛虹股份有限公司). Im Snapshot vom 13.10.2026, Abruf 10:02:57.950 UTC, stimmen `meta.statementPeriods` und `annual.*Ends` für beide Ergebnisreihen überein: Index 0 ist 2025, Index 1 ist 2024 und Index 2 ist 2023, jeweils zwölf Monate bis 31.12., Währung CNY. Die Rückrechnung verwendet den gespeicherten Kurs `fxRateApplied = 0.14963564`. Die folgenden Konzernbeträge stimmen centgenau mit dem Anbieter überein.

| Index / Jahr | Betriebsergebnis in CNY Yuan | Nettoergebnis der Mutteraktionäre in CNY Yuan | Originalbericht und gedruckte Seite |
|---|---:|---:|---|
| 0 / 2025 | −264.997.053,94 | 133.746.317,81 | [Geschäftsbericht 2025](https://static.cninfo.com.cn/finalpage/2026-04-29/1225243361.pdf), Seite 89, Einheit auf Seite 88 |
| 1 / 2024 | −3.470.528.891,53 | −2.296.841.255,74 | [Geschäftsbericht 2024](https://static.cninfo.com.cn/finalpage/2025-04-29/1223385370.PDF), Seite 98, Einheit auf Seite 97 |
| 2 / 2023 | 243.863.557,83 | 717.031.594,87 | [Geschäftsbericht 2023](https://static.cninfo.com.cn/finalpage/2024-04-26/1219829278.PDF), Seite 115/242, Einheit auf Seite 114 |

Die Einheit lautet jeweils `单位：元`. Der Geschäftsbericht 2024 erklärt auf Seite 117 `本财务报表以人民币列示。`, also Darstellung in Renminbi. Die Originalzitate aus den Konzernrechnungen, mit zusammengezogenen Zeilenumbrüchen und unveränderten Beträgen, lauten:

* 2025, Seite 89, Spalten 2025/2024: `三、营业利润（亏损以“－”号填列） -264,997,053.94 -3,470,528,891.53`; `1.归属于母公司股东的净利润 133,746,317.81 -2,296,841,255.74`.
* 2024, Seite 98, Spalten 2024/2023: `三、营业利润（亏损以“-”号填列） -3,470,528,891.53 243,863,557.83`; `1.归属于母公司股东的净利润 -2,296,841,255.74 717,031,594.87`.
* 2023, Seite 115, Spalten 2023/2022: `三、营业利润（亏损以“－”号填列） 243,863,557.83 500,886,016.41`; `1.归属于母公司股东的净利润 717,031,594.87 611,000,794.98`.

Der gesuchte Begriff `归属于上市公司股东的净利润（元）` steht außerdem im Kennzahlenüberblick 2024 auf Seite 8 mit −2.296.841.255,74 für 2024 und 717.031.594,87 für 2023. Er entspricht dem hier verwendeten zurechenbaren Ergebnis. Der stärkste Gegencheck ist die Abgrenzung zum gesamten Konzern-Nettoergebnis: Dieses beträgt 2024 −2.283.873.644,82 CNY und ist ausdrücklich nicht der gespeicherte Wert.

Der Bericht 2024 nennt auf Seite 25 schwankende Ölpreise und schwache petrochemische Nachfrage als Hintergrund. Das kurze Originalzitat `公司部分产品价差收窄导致炼化业务亏损` benennt geringere Produktspannen als Ursache der Raffinerieverluste. Damit ist das ungewöhnliche Verlustjahr belegt, Sicherheit 99 %. Eine einmalige Abschreibung als Hauptursache wird nicht behauptet.

Genau ein USD-Schlüssel und eine native Identität für `annualOpInc`, Ende 31.12.2024, kommen hinzu. Der native Vergleich lautet unverändert auf zehn signifikante Stellen gerundet `[-264997053.9, -3470528892, 243863557.8]`. Bestand 163 → 164 Schlüssel, 145 → 146 native Einträge. `usdFaktor = 1` und `maxRelativeAbweichung = 0` beziehen sich auf denselben Snapshot. Alle bisherigen Einträge, Aufnahmedatum und Vergleichspopulation bleiben erhalten. Die einzige entfernte Sperre ist `000301.SZ|annualOpInc|1`, weil ihr ausdrücklich vorgesehener Quellenbeleg nun vorliegt; ihr Beginn wird nicht verschoben. Die frühere Begründung bleibt in der Versionsgeschichte und der historische Ablauf im Hinweis erhalten.

**Boardwirkung: keine.** Geändert werden nur die bekannte Fallliste des Wächters, ihre Sperrliste, Dokumentation und Tests. Die Handtabelle, ihre Bibliothek, der Wächtercode und die Formeln bleiben unverändert. Kein Jahreswert, Score oder Rang ändert sich. Das Nettoergebnis wurde gegengeprüft, ist aber selbst kein Jahresausreißer und erhält keine zusätzliche Freigabe.

Der neue Test `annual-spikes-p218.test.js` prüft Quellenzuordnung, Wechselkursdrift, geänderte Zentral- und Nachbarwerte, Währung, Jahr, Firma, Reihe, fehlende Autorität und die unveränderte Altersgrenze. Zwei absichtliche Bruchproben entfernen ausschließlich im Arbeitsspeicher die native Autorität beziehungsweise setzen die erledigte Sperre wieder ein; Live-Prüfsummen bleiben dabei gleich. Der bestehende Vergleich bei fehlender nativer Datierung und der exakte USD-Rückfall bleiben unverändert. Die 24 historischen Zwei-Reihen-Eichformen werden nicht geändert.

Die Nachstellung verwendet ausschließlich die 16.300 Snapshots vom 13.10.2026. Der Produktionswächter wird im Arbeitsspeicher mit diesem Eingabeordner und der jeweils festgehaltenen Uhr aufgerufen, ohne Aufnahmeflag. Die Prüfsumme aller Snapshot-JSON-Dateien vor und nach beiden Nachläufen ist identisch. Der Wächtercode ist bytegleich mit dem Ausgangsstand, einschließlich aller Grenzwerte und Altersregeln.

| Uhr in UTC | Neue Einzelwerte vorher → nachher | Gezählt, erlaubt 5 | Sperren vorher → nachher | Exit vorher → nachher |
|---|---:|---:|---:|---:|
| 13.10.2026 12:00 | 8 → 7 | 5 → 5 | 1 → 0 | 0 → 0 |
| 27.10.2026 12:00 | 8 → 7 | 5 → 5 | 1 → 0 | 1 → 0 |

Die identischen Zusammenfassungen für beide Uhren, abgesehen vom früheren Altersalarm, lauten:

```text
Vorher:
Jahres-Ausreisser: 158 in 16300 gelesenen Snapshots · davon NEU: 8
Handtabelle: 7 Ausreisser vor der Board-Berechnung korrigiert oder gezielt zurueckgehalten
Zaehlwerk: roh 8 · naiver Set-Key 7 · zwei Relationen 6 · zwei Relationen ohne Sperren 5 (erlaubt 5)
2-von-3: 1 · faktorgleich (Tol 1,02): 0 · NICHT erfasst: 1

Nachher:
Jahres-Ausreisser: 158 in 16300 gelesenen Snapshots · davon NEU: 7
Handtabelle: 7 Ausreisser vor der Board-Berechnung korrigiert oder gezielt zurueckgehalten
Zaehlwerk: roh 7 · naiver Set-Key 6 · zwei Relationen 5 · zwei Relationen ohne Sperren 5 (erlaubt 5)
2-von-3: 1 · faktorgleich (Tol 1,02): 0 · NICHT erfasst: 1
```

Vorher hatte die Sperre am 13.10. ein Alter von 17 Tagen, am 27.10. von 31 Tagen; nur letzteres überschritt die unveränderte Altersgrenze. Nachher bleiben BANPU.BK, KINV-A.ST, KINV-B.ST, PCT.L und das gemeinsame Ereignis TSRYF/TWE.AX unverändert offen und meldbar. Beide Nachläufe sind grün, aber das Budget bleibt ausgeschöpft. Das Ergebnis mit der Uhr am 27.10. gilt für den geprüften Datenstand vom 13.10.; unbekannte spätere Anbieteränderungen sind damit nicht vorweggenommen.

## Gezielte Klärung P275 am 20.10.2026

Der planmäßige Lauf 39387109481 vom 20.10.2026 meldete acht neue Einzelwerte in sechs Ereignissen bei erlaubten fünf. Die Nachstellung verwendet ausschließlich das CI-Artefakt `snapshots` dieses Laufs (16.107 Snapshot-Dateien). Der unveränderte Produktionswächter wird mit diesem Eingabeordner und der Uhr `2026-10-20T12:00:00Z` ohne Aufnahmeflag aufgerufen. Er liefert vorher dieselben acht Funde wie das CI und endet mit Exit 1. Die Zuordnung Index zu Geschäftsjahr folgt für jeden Fall übereinstimmenden `meta.statementPeriods` und `annual.*Ends`; die Rückrechnung in die Berichtswährung verwendet den gespeicherten `fxRateApplied`.

| Fund | Geschäftsjahr, nativ | Urteil | Beleg |
|---|---|---|---|
| TYG annualNetIncome[1] | 30.11.2024: 210.921.731 USD, Nachbarn 19.355.818 / −15.622.613 | echtes Sonderjahr, aufgenommen | N-CSR FY2024 S. 38, FY2025 S. 11, FY2023 S. 42 |
| PCT.L annualNetIncome[2] | 30.04.2024: 1.115.437 Tsd. GBP, Nachbarn 118.355 / −105.182 | echtes Sonderjahr, aufgenommen | Annual Report 2024 S. 102, 2025 S. 106 |
| 603822.SS annualNetIncome[1] | 2024: −366.940.285,42 CNY, Nachbarn 31.348.113,74 / −7.540.228,65 | echtes Sonderjahr, aufgenommen | Geschäftsbericht 2025 S. 7/196, 2024 S. 6/219 |
| PCT.L annualRev[2] | 30.04.2024: 1.118.772 Tsd. GBP (Anbieterwert) | Jahr echt, Wert nicht gedruckt; bleibt NEU | siehe unten |
| TWE.AX / TSRYF annualOpInc[1] | 30.06.2025: 518,1 Mio AUD, Nachbarn 57,5 / 42,6 | Anbieterwert ohne Berichtszeile; bleibt NEU | Annual Report 2025 S. 90 |
| KINV-A.ST / KINV-B.ST annualRev[2] | 2023: 936 Mio SEK, Nachbarn 23 / 0 | rechter Nachbar falsch; Eichfall, bleibt NEU | Geschäftsbericht 2023 S. 70 |

**TYG** (Tortoise Energy Infrastructure Corp., Closed-End-Fonds, Geschäftsjahr bis 30.11.). Der gespeicherte Wert ist die Zeile „Net Increase (Decrease) in Net Assets Applicable to Common Stockholders Resulting from Operations“. Sie besteht fast nur aus realisierten und unrealisierten Kursgewinnen; das Sonderjahr ist der Kursanstieg der Midstream-Werte im Geschäftsjahr 2024. Alle drei Werte stimmen dollargenau:

* [N-CSR FY2024](https://www.sec.gov/Archives/edgar/data/1268533/000120677425000062/tyg4427083-ncsr.htm), Seite 38, erste Spalte: `Resulting from Operations $ 210,921,731`.
* [N-CSR FY2025](https://www.sec.gov/Archives/edgar/data/1268533/000121390026013154/ea0272590-01_ncsr.htm), Seite 11: `Resulting from Operations $ 19,355,818`.
* [N-CSR FY2023](https://www.sec.gov/Archives/edgar/data/1268533/000120677424000089/tyg4285943-ncsr.htm), Seite 42, erste Spalte: `Resulting from Operations $ (15,622,613 )`.

Die bestehende TYG-Sperre der Handtabelle (`tyg-stale-2017-packet-20261001`) bleibt unberührt. Ihr Fingerabdruck passt nicht mehr, weil das Datenpaket inzwischen bis zum Geschäftsjahr 2025 reicht; die Freigabe dieser Sperre ist eine eigene Entscheidung.

**PCT.L** (Polar Capital Technology Trust plc, Investment Trust, Geschäftsjahr bis 30.04.). Das Nettoergebnis ist die Gesamtspalte von „Net profit/(loss) for the year and total comprehensive income/(expense)“, getragen von Gewinnen auf Anlagen von 1.147.978 Tsd. GBP im Jahr bis 30.04.2024. Die Werte stimmen tausendgenau:

* [Annual Report 2024](https://www.pctannualhighlights.co.uk/static/literature/PCTT_Annual_Report_2024.pdf), Seite 102, Spalten 2024/2023: `comprehensive income/(expense) (9,219) 1,124,656 1,115,437 (6,860) (98,322) (105,182)`.
* [Annual Report 2025](https://data.fca.org.uk/artefacts/NSM/Portal/NI-000124607/NI-000124607.pdf), Seite 106: `comprehensive income (11,286) 129,641 118,355`.

Der Anbieter-Umsatz von PCT.L (122.389 / 1.118.772 / −101.774 Tsd. GBP) steht in keinem Bericht. Die nächste gedruckte Zeile ist „Gain/(loss) before finance costs and tax“ mit 122,507 / 1,119,253 / (101,436). Das Sonderjahr ist damit belegt, der gespeicherte Wert nicht. Außerdem läge PCT.L mit beiden Reihen als Zwei-Reihen-Form mit einem Faktorverhältnis von 1,031 in der Eichlücke 1,0000 bis 1,0375; Q1-5 verlangt in diesem Fall eine Neuherleitung der Toleranz 1,02. Das ist eine Methodenentscheidung und gehört nicht zu dieser Aufnahme. Der Umsatzfund bleibt deshalb NEU.

**603822.SS** (浙江嘉澳环保科技股份有限公司, Zhejiang Jiaao Enprotech, heute „ST嘉澳“). Gespeichert ist das den Aktionären der Muttergesellschaft zurechenbare Ergebnis, nicht das Konzern-Nettoergebnis (2024: −373.415.096,90 CNY). Die Einheit lautet `单位：元币种：人民币`.

* [Geschäftsbericht 2025](https://static.cninfo.com.cn/finalpage/2026-04-10/1225091341.PDF), Seite 7/196, Spalten 2025/2024/2023: `归属于上市公司股东的净利润 31,348,113.74 -366,940,285.42 不适用 -7,540,228.65`; Einheit auf Seite 6/196.
* [Geschäftsbericht 2024](https://static.cninfo.com.cn/finalpage/2025-04-29/1223386657.PDF), Seite 6/219, dieselben Werte für 2024 und 2023. Der Wert für 2023 ist der nach dem korrigierten Bericht 2023 angepasste Stand. Seite 10/219 nennt als Ursache des Verlusts `亏损主要受原材料价格上涨，欧盟生物柴油反倾销，市场需求疲软`.

**TWE.AX / TSRYF** (Treasury Wine Estates, Zweitnotierung TSRYF mit identischen Zahlen). Die Anbieterreihe 57,5 / 518,1 / 42,6 / 182,7 Mio AUD steht in keinem Bericht. Der [Annual Report 2025](https://announcements.asx.com.au/asxpdf/20250813/pdf/06mt6g6f8jsktk.pdf) zeigt auf Seite 90 `Profit before tax and finance costs` 736,6 (2025) und 266,6 (2024) Mio AUD. Mit diesen gemeldeten Werten läge 2025 höchstens beim 2,8-Fachen eines Nachbarn, also kein Sonderjahr. Der Fall wird nicht aufgenommen; eine Korrektur über die Handtabelle ist eine eigene Entscheidung.

**KINV-A.ST / KINV-B.ST**. Der Umsatz des Anbieters ist bei Kinnevik die Zeile „Dividends received“. Der [Geschäftsbericht 2023](https://www.kinnevik.com/files/mfn/c534f5b4-c274-46a1-a7a5-61da9da7be9c/annual-sustainability-report-2023.pdf), Druckseite 70, nennt 936 (2023) und 3 538 (2022) Mio SEK. Der rechte Nachbar 2022 steht im Snapshot als 0 und ist damit falsch; mit 3 538 gäbe es keinen Ausreißer. Die Reihe ist ein Eichfall und bleibt NEU.

Genau drei USD-Schlüssel und drei native Identitäten kommen hinzu: Bestand 164 → 167 Schlüssel, 146 → 149 native Einträge. `usdFaktor = 1` und `maxRelativeAbweichung = 0` beziehen sich auf denselben Snapshot. Alle bisherigen Einträge, Aufnahmedatum und Vergleichspopulation bleiben erhalten. Im Test P168d entfällt nur die Erwartung, dass das Nettoergebnis von PCT.L NEU bleibt; der Umsatz von PCT.L, BANPU.BK und TWE.AX/TSRYF bleiben dort NEU.

**Boardwirkung: keine.** Geändert werden nur die bekannte Fallliste des Wächters, Dokumentation und Tests. Die Fallliste liest außer dem Wächter nur Diagnoseskripte; Scoring, Board-Export und Handtabelle lesen sie nicht. Wächtercode, Handtabelle und ihre Bibliothek sind bytegleich mit dem Ausgangsstand, einschließlich Faktor 8, `MIN_BETRAG`, erlaubter Zahl 5, Toleranz 1,02, `MELDEND_BIS` und Altersgrenze.

Der neue Test `annual-spikes-p275.test.js` prüft Quellenzuordnung, Wechselkursdrift, geänderte Zentral- und Nachbarwerte, Währung, Jahr, Firma und Reihe, die abgelehnten Fälle und die unveränderten Grenzwerte. Die Bruchprobe entfernt im Arbeitsspeicher jeweils eine native Autorität; Live-Prüfsummen bleiben gleich. Zusätzlich wurde einmal der Eintrag von 603822.SS in der Arbeitskopie entfernt: drei Tests wurden rot, der Wächter zählte fünf Ereignisse, danach wurde die Datei bytegleich wiederhergestellt.

```text
Vorher:
Jahres-Ausreisser: 149 in 16107 gelesenen Snapshots · davon NEU: 8
Zaehlwerk: roh 8 · naiver Set-Key 7 · zwei Relationen 6 · zwei Relationen ohne Sperren 6 (erlaubt 5)
Exit 1

Nachher:
Jahres-Ausreisser: 149 in 16107 gelesenen Snapshots · davon NEU: 5
Zaehlwerk: roh 5 · naiver Set-Key 4 · zwei Relationen 4 · zwei Relationen ohne Sperren 4 (erlaubt 5)
Exit 0
```

Nachher bleiben KINV-A.ST, KINV-B.ST, der Umsatz von PCT.L und das gemeinsame Ereignis TSRYF/TWE.AX offen und meldbar. Der Lauf ist grün, mit einem freien Ereignis im Budget.

## Nachtrag P276 am 21.10.2026

Die Handtabelle trägt jetzt die gemeldeten Betriebsergebnisse von Treasury Wine Estates (TWE.AX / TSRYF, „Profit before tax and finance costs“ 736,6 Mio. AUD für das Geschäftsjahr bis 30.06.2025, Nachbarn −1.279,6 und 266,6) und hält den Umsatz von Kinnevik (KINV-A.ST / KINV-B.ST, die Quartale auch bei KNEVF) vollständig zurück (keine Umsatzzeile im Abschluss); Einzelheiten in `docs/financial-corrections.md`, Abschnitt „Handtabelle P276“. Auf dem Artefakt des Laufs 39563364953 (16.121 gelesene Snapshots, Uhr `2026-10-21T12:00:00Z`) meldet der unveränderte Wächter vorher 5 NEU-Werte (4 Ereignisse) und nachher 1 (PCT.L annualRev, 1 Ereignis, erlaubt 5). Die TYG-Sperre bleibt; PCT.L Umsatz bleibt bis zur Methodenentscheidung zu Q1-5 offen.

## Gezielte Aufnahme P299 am 30.10.2026

Grundlage ist das CI-Artefakt `snapshots` des Laufs 41027769596 (15.899 gelesene Snapshots, Daten-Commit `d4a3e7c368`). Der Befehl `--neu-aufnehmen` endet auf dem nativen Bestand mit Exit 1 und schreibt nichts; diese Sperre bleibt. Auf derselben Population hätte eine Gesamtneuaufnahme ohne die Sperre 149 native Identitäten und 112 Schlüssel verloren und PCT.L Umsatz still aufgenommen; bei 0,1 % Wechselkursdrift stünden 52 Ereignisse an, mit dem heutigen Bestand 2. Deshalb gilt wie bei P211, P218 und P275 die gezielte Aufnahme mit nachgelesenen Berichten.

AMLX `annualGP[2]` (Amylyx, Geschäftsjahr 2023, USD) wird als echtes Datenereignis aufgenommen. Die Dreiergruppe −37.262 / 355.345 / 19.237 Tsd. USD für 2024 / 2023 / 2022 ist centgenau Umsatz minus aller Zeilen, die der Emittent als Cost of sales ausweist:

* [10-K FY2024](https://www.sec.gov/Archives/edgar/data/1658551/000095017025031309/R4.htm): `Product revenue, net` 87,371 und 380,786; `Cost of sales` 5,953 und 25,441; `Cost of sales - inventory impairment and loss on firm purchase commitments` 118,680 (2024).
* [10-K FY2023](https://www.sec.gov/Archives/edgar/data/1658551/000095017024018447/R4.htm): `Product revenue, net` 380,786 und 22,230; `Cost of sales` 25,441 und 2,993.

Die Grenze ist ausdrücklich benannt: Ohne die Abschreibungszeile läge der Bruttogewinn 2024 bei +81.418 Tsd. USD, der Faktor bei 4,4 statt 9,5, und es gäbe keinen Fund. Der Emittent führt die Zeile selbst als Cost of sales; ein Anbieterfehler liegt deshalb nicht vor. Der Wächter meldet künftig genau diese Dreiergruppe nicht mehr. Eine geänderte Zahl, Währung oder Periode läuft wieder als NEU auf.

Nicht aufgenommen: PCT.L `annualRev[2]` bleibt NEU, weil die Methodenfrage P276 Punkt 4 offen ist. 002822.SZ `annualGP[1]` steht nicht in dieser Population: Das Größenaustritts-Verzeichnis nennt 793,9 Mio. USD gegen die Grenze von 800 Mio. USD am 27.10.2026, ein Snapshot fehlt. Kehrt die Aktie zurück, läuft der Fund wieder als NEU auf und belegt ein Ereignis. Auf dem Artefakt vom 24.10. beträgt der Bruttogewinn −652,2 Mio. CNY, Nachbarn −21,7 und 43,1, gleich Umsatz minus Kosten; an der Quelle ist er nicht geprüft.

Bestand 167 → 168 Schlüssel, 149 → 150 native Einträge; Aufnahmedatum und Vergleichspopulation bleiben, weil es keine Gesamtneuaufnahme ist. Damit beginnt auch das Fenster K1 im Zählwerk nicht. Grenzwerte und Wächtercode sind unverändert.

```text
Vorher:
Jahres-Ausreisser: 144 in 15899 gelesenen Snapshots · davon NEU: 2
Zaehlwerk: roh 2 · naiver Set-Key 2 · zwei Relationen 2 · zwei Relationen ohne Sperren 2 (erlaubt 5)
Exit 0

Nachher:
Jahres-Ausreisser: 144 in 15899 gelesenen Snapshots · davon NEU: 1
Zaehlwerk: roh 1 · naiver Set-Key 1 · zwei Relationen 1 · zwei Relationen ohne Sperren 1 (erlaubt 5)
Exit 0
```
