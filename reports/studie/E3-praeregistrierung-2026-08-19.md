# E3 — Präregistrierung 2.0.0 und die Fallzahl-Ampel des Prüffensters

*Etappe E3 der Early-Detection-Studie · Protokoll FEM-SEC-US@2.0.0 · 19.08.2026*
*Zweig `studie/e3-praereg` · Verdikt: **INCONCLUSIVE_DATA für das Prüffenster***

---

## 1. Die eingefrorene Frage — in einem Absatz

Wir fragen: **Bleiben Firmen, deren SEC-Zahlen einen präregistrierten
Beschleunigungs-Schub zeigen, in den nächsten vier Quartalen stärker auf
Wachstumskurs als vier verschiedene Vergleichsgruppen?** „Beschleunigung"
heißt: das Jahresvergleichs-Wachstum einer Firma ist zwei Quartale in Folge
gestiegen, und der letzte Sprung gehört zu den obersten 5 % aller Firmen des
Quartals — gemessen an einem Vergleichsmaßstab, der nur bereits veröffentlichte
Zahlen kennt. Zwei Größen werden so getestet: der Umsatz (**S-U**) und das
Betriebsergebnis (**S-G**). Der Erfolg wird **nur** an den Folge-Quartalszahlen
gemessen — positives Wachstum derselben Kennzahl in mindestens drei der vier
Folgequartale. **Kein Kurs, keine Rendite, kein Preisziel** — dieser Endpunkt
ist für diese Signalfamilie ein für alle Mal verbraucht und ab jetzt auch
technisch gesperrt. Verglichen wird gegen vier Maßstäbe: nach Branche, Größe,
Zeit und Wachstumsniveau gematchte Kontrollfirmen · ein reiner Chart-Vergleich ·
Karls heutiges Screener-System · und eine „Niveau-Null", die nichts kennt außer
dem aktuellen Wachstumstempo. Das ergibt **acht geplante Tests je Zeitfenster**
(2 Signale × 4 Maßstäbe). Ab dem Einfrieren darf an dieser Frage nichts mehr
geändert werden; jede Änderung startet ein neues Protokoll und verliert den
Beweiswert.

---

## 2. Die Fallzahl-Ampel des Prüffensters 2017–2019

Der Zähllauf hat **keinen einzigen Ergebniswert berechnet** — nur gezählt, ob
die Fälle überhaupt da sind. Das ist der ganze Zweck: die Stichprobe prüfen,
**bevor** das versiegelte Endtest-Fenster verbrannt wird.

| Größe | S-U (Umsatz) | S-G (Betriebsergebnis) | gefordert |
|---|---:|---:|---|
| Feuerungen 2017–2019 | 518 | 376 | — |
| auswertbare Firmen-Quartale | 33.413 | 42.202 | — |
| Feuerrate | 1,550 % | 0,891 % | — |
| Firmen mit Erst-Ereignis | 438 | 365 | — |
| davon rechts-zensiert (Fensterkante) | **0** | **0** | — |
| **Fallzahl (Firmen mit reifem Erst-Ereignis)** | **292** | **326** | **≥ 200 ✅** |
| **Auffindbarkeit Signal-Arm** | **66,67 %** | **89,32 %** | **≥ 90 % ❌** |
| Auffindbarkeit Kontrollpool | 74,11 % | 90,53 % | ≥ 90 % (S-U ❌, S-G ✅) |
| Differenz Signal ↔ Kontrolle | 7,44 Punkte | 1,22 Punkte | ≤ 10 Punkte ✅ |
| Kontrollpool-Firmen | 4.163 | 4.733 | — |
| Fallzahl mit Aktienzahl-Nenner (R10) | 234 (80,1 %) | 272 (83,4 %) | Pflichtangabe |
| **Ampel** | **INCONCLUSIVE_DATA** | **INCONCLUSIVE_DATA** | |

**Was das heißt, in einem Satz:** Es sind **genug Firmen da** — 292 und 326
gegen die geforderten 200 —, aber **zu viele von ihnen lassen sich nicht bis
zum Ende verfolgen**. Bei jeder dritten S-U-Firma fehlen die vier
Folgequartale, die für die Antwort gebraucht werden.

**Das ist ein Erfolg der Methode, kein Misserfolg.** Genau dafür gibt es diese
Probe: Der Mangel fällt **vor** der Einmal-Öffnung auf, nicht danach. Das
Endtest-Fenster bleibt zu.

### Der Befund, der die Erwartung kippt

Der Planer war davon ausgegangen, die niedrige Auffindbarkeit des
Entdeckungsfensters (512 von 731 = 70,0 %) sei ein Artefakt der Fensterkante:
Feuerungen am Fensterrand *können* ihre Folgequartale gar nicht mehr im Panel
haben. **Diese Erklärung trägt nicht.** Im Prüffenster ist die Zahl der
rechts-zensierten Erst-Ereignisse **exakt null** — das Pufferjahr 2020 liegt im
Panel und trägt die Folgequartale —, und trotzdem landet S-U bei 66,67 %, also
noch unter dem Entdeckungswert. Die Lücke ist real und nicht der Fensterkante
geschuldet.

**Woran es stattdessen liegen dürfte** (Hypothese, in E4a zu prüfen, nicht
behauptet): an der **Umsatz-Kennung**, die 2018 mit ASC 606 den Namen wechselt.
Die Reife verlangt vier Folgequartale **derselben** Quelle — wechselt eine Firma
mitten im Fenster von `SalesRevenueNet` auf
`RevenueFromContractWithCustomerExcludingAssessedTax`, reißt ihre Reihe. Die
Indizien: S-G läuft auf **einer einzigen** Kennung (`OperatingIncomeLoss`, kein
ASC-606-Wechsel) und kommt auf 89,32 %; S-U läuft auf **vier** Kennungen mit
Wechsel und kommt auf 66,67 %. Derselbe Code, dasselbe Fenster, dieselbe
Reifedefinition — 23 Punkte Unterschied. Und die Kontrollpools spiegeln es
(90,53 % gegen 74,11 %): Es ist eine Eigenschaft der **Daten**, nicht des
Signals.

**S-G verfehlt das Gate um 0,68 Punkte.** Das wird hier ausdrücklich **nicht**
gerundet, nicht weggeredet und nicht durch eine nachträglich gelockerte Schwelle
gerettet. Die 90-%-Schwelle stand vor dem Lauf fest; genau an dieser Sorte
Nachjustierung ist die Vorstudie gestorben.

---

## 3. Warum es so entschieden wurde

**Die Schwelle liegt auf Firmen, nicht auf Ereignissen.** 200 reife
**Erst-Ereignis-Firmen** je Variante je Fenster. Grund: die Firmen-Trennung (R3)
macht die Firma zur statistischen Einheit — eine Schwelle auf Feuerungen würde
Dichte mit Stichprobe verwechseln. Das alte Doppelkriterium der Version 1.2.0
(200 Ereignisse *und* 50 Signale) fällt in sich zusammen, weil Ereignis und
Signal in 2.0.0 dasselbe sind; verbindlich ist die schärfere Lesart.

**Der Kurs-Endpunkt ist dreifach gesperrt** — in der versiegelten
Präregistrierung, dauerhaft in der Regel-Registry (die überlebt
Protokollversionen, die Präregistrierung nicht) und in der Laufzeit: jeder
künftige Auswertecode bricht ab, sobald ein Endpunkt-Name eine gesperrte Klasse
trifft, **auch wenn der Lauf ordnungsgemäß angemeldet ist**. Ein Registry-Eintrag
allein wäre ein Versprechen, ein Testwächter allein stürbe mit dem Testlauf.

**Signal- und Kontrollzeilen laufen durch exakt denselben Code.** Die
Vorstudie ist daran gescheitert, dass fehlende Werte in einer Gruppe strenger
gebucht wurden als in der anderen. Beide Arme rufen hier dieselbe Funktion mit
derselben Fehlbehandlung — das ist der Grund, warum die 7,44 Punkte Differenz
bei S-U als Zahl überhaupt etwas wert sind.

**Die Reihenfolge ist die Methodik.** Einfrieren → Push → Serverbestätigung →
Zugriff, zweimal sauber durchlaufen:

| | Anmeldung im Register | Server-Bestätigung (GitHub-Uhr) | erster Datenzugriff |
|---|---|---|---|
| Lauf 1 | 16:08:50 UTC | 16:09:42 UTC | 16:13:58 UTC |
| Lauf 2 (nach Code-Review) | 16:24:42 UTC | 16:24:51 UTC | 16:27:47 UTC |

Die Bestätigungszeit stammt aus dem Antwortkopf des GitHub-Servers, nicht von
diesem Rechner — eine lokale Uhr lässt sich stellen. Läge der Zugriff davor,
hätte das Skript abgebrochen.

**Warum es zwei Läufe gibt:** Lauf 1 lief unter dem Code-Stand **vor** dem
Code-Review. Die Härtungen ändern die Zähl-Logik nicht, aber sie ändern die
Bytes des Probe-Skripts und damit sein Siegel — ein Ergebnis, dessen Siegel
nicht mehr zum Code passt, ist wertlos. Also: zweite Anmeldung, zweiter Push,
zweite Serverbestätigung, zweiter Lauf. Lauf 1 bleibt in der Akte und wird
nicht ersetzt.

---

## 4. Woran es verifiziert wurde

**Sechs Wächter, jeder einmal absichtlich kaputtgemacht und rot gesehen.**

| # | Wächter | Sabotage | Reaktion |
|---|---|---|---|
| W1 | Freeze-Siegel | ein Wert in der Präregistrierung nach dem Siegeln geändert | rot: „W1-ABBRUCH: preregistration.json weicht vom Siegel ab (ist dd27fed1…, soll 799f9251…)" |
| W2 | R1-Serverzeit | Serverzeit-Vergleich aus dem Lauf entfernt (Manifest nachgesiegelt, damit W1 den Fehler nicht abfängt) | rot: der Lauf meldet kein `W2-ABBRUCH` mehr |
| W3 | Ausgabe-Allowlist | die Probe gibt zusätzlich einen Persistenz-Mittelwert aus | rot, zweifach: „W3-ABBRUCH: Variante S-U gibt nicht gelistete Größen aus: persistenz_mittelwert" **und** der 0.777-Marker taucht im Output auf |
| W4 | Klartext-/Siegel-Wache | die Klartext-Prüfung ausgebaut | rot: „eine KLARTEXT-Kopie des Endtest-Panels fliegt auf" |
| W5 | Endpunkt-Sperre (Laufzeit) | Klassen-Prüfung aus `leseErgebnisdaten` entfernt | rot: „Missing expected exception: kursrendite_12m hätte fliegen müssen" |
| W6a | Minima-Ampel | Schwellenvergleich entfernt | rot: 199 Firmen werden GRUEN statt INCONCLUSIVE_DATA |
| W6b | R3-Zählung | die „früheste je Firma"-Reduktion ausgebaut | rot: „R3-ABBRUCH: eine Firma trägt mehr als ein Erst-Ereignis" |

W5 wurde **in beiden Richtungen** geprüft: der Kurs-Endpunkt fliegt, der
erlaubte Endpunkt geht durch. Ein Wächter, der alles blockt, ist genauso kaputt
wie einer, der nichts blockt. Für W6 trägt das Fixture den Unterschied wirklich:
es gibt einen 199- und einen 200-Firmen-Fall und eine Firma mit **zwei** reifen
Ereignissen — ohne die könnte die R3-Sabotage gar nicht auffliegen.

**Determinismus-Gegenprobe:** Die beiden Läufe liefern **byte-identische
Zahlen** — jede der elf Zählgrößen beider Varianten und jeder einzelne
Diagnose-Zähler stimmt überein. Unterschiedlich sind nur die Felder des
Lauf-Umschlags, die sich unterscheiden *müssen* (Lauf-Kennung und die vier
Zeitstempel). Damit ist der Determinismus-Check des Öffnungsprotokolls für die
Zählprobe bereits erbracht.

**Code-Review vor „fertig":** Zwei Reviewer haben den Diff unabhängig geprüft
und **dieselben zwei harten Befunde** gefunden — beide sind gefixt, jeder mit
einem Test, der ohne den Fix grün gewesen wäre:

- **Die Ausgabe-Sperre hatte ein Loch.** Zähler mit dem Präfix `aktienzahl_`
  liefen ungeprüft durch, obwohl die Fehlermeldung eine Zeile darüber genau das
  ausschließt. Heute harmlos (die Bibliothek setzt nur feste Namen), aber der
  Wächter prüfte nicht, was er zu prüfen behauptete. Jetzt namentlich
  aufgezählt.
- **Die Pfad-Beobachtung war prozessweit statt laufweit.** Zwei Läufe im selben
  Prozess hätten im Feld „was hat dieser Lauf angefasst" die Pfade des Vorgängers
  mitgeführt — ausgerechnet dort.

Dazu sieben kleinere Härtungen, darunter: die Freigabe-Datei wird zur Laufzeit
nicht mehr blind geglaubt, sondern gegen das Zugriffs-Register gehalten; eine
Ausgabe ohne Varianten besteht die Prüfung nicht mehr; ein unlesbarer
Zeitstempel bricht ab, statt still als „nicht zensiert" zu gelten.

**Prüfungszahl:** vorher 65 Tests, davon 62 grün und 3 rot (Exit-Code 1) —
nachher **100 Tests, alle grün (Exit-Code 0)**. Die drei vorbestehenden Roten
waren echte Befunde und wurden geheilt, keiner durch Abschwächung eines
Wächters.

**Unabhängiger Anker für den Zähllauf:** Die Probe zählt im Prüffenster
**148.912 Einreichungen, davon 99.819 periodische**. Der E1-Abdeckungsreport
kommt über einen völlig anderen Weg auf **exakt dieselben zwei Zahlen**. Damit
ist belegt, dass die Probe das richtige Panel mit denselben Filtern gelesen hat.

**Die Ergebnis-Sperre hat gehalten:** Der Lauf meldet `ergebnisdatenBeruehrt:
false`, hat genau eine Datei gelesen (`panel/panel-validierung.sqlite`) und die
Ausgabe gegen die eingefrorene Elf-Felder-Allowlist geprüft. Das Endtest-Siegel
wurde vor dem Lauf voll nachgerechnet (5.025.230.848 Bytes, SHA-256
unverändert), es liegt keine Klartext-Kopie auf der Platte, und **der Schlüssel
wurde nicht angefasst**.

---

## 5. Was der Code anders sagt als das Entscheid-Dokument

Fünf Stellen. Überall gilt der Code; die Abweichung steht in der
Präregistrierung, statt still geglättet zu werden.

| Stelle | Entscheid-Dokument | Code | wer hatte recht |
|---|---|---|---|
| Signalbedingung | `a(t) > P95` | `a(t) >= P95` | Code |
| Perzentil 95 | als gesetzter Parameter beschrieben | **Ergebnis** einer Kalibrierung (Start 90, ein Schritt) | Code — ab jetzt eingefroren |
| Ausschlussquote | „3.959 von 11.156 (35,91 %)" | 35,91 % gehört zum Nenner 11.024; gegen 11.156 wären es 35,49 % | Code |
| Dateiname Prüffenster | `panel-pruefung.sqlite` | `panel-validierung.sqlite` | Code |
| Kennungs-Falle | „`Revenues` 27,8 % → 11,4 %" | das ist `SalesRevenueNet`; `Revenues` liegt in beiden Fenstern bei 46,0 % | E1-Report |

Dazu eine Klärung, die kein Fehler war, aber die Zahlen erklärt: **E2 hatte das
Pufferjahr 2016 im Signalband** (Kalibrierungsband 2012–2016), obwohl die
Registry das Entdeckungsfenster bei 2015q4 enden lässt. Ab 2.0.0 gilt
verbindlich: Signalband **ohne** Pufferjahr, Reife **darf** das Pufferjahr
nutzen. Für das Prüffenster heißt das: Signale 2017–2019, Reife bis 2020-12-31.

---

## 6. Was das für die nächste Etappe heißt

**E4 (Validierung 2017–2019) ist nach der präregistrierten Regel blockiert.**
Ein Auffindbarkeits-Gate ist gerissen; damit werden keine p-Werte gerechnet
(R9). Das Endtest-Fenster bleibt versiegelt.

Das ist **kein** Ende der Studie, sondern eine Weiche. Drei Wege stehen offen,
und keiner davon darf die Schwelle anfassen:

1. **Die Lücke erklären statt umgehen** (E4a, siehe Folgefragen): messen, ob der
   Kennungswechsel wirklich der Treiber ist. Wenn ja, ist die Reifedefinition
   „vier Folgequartale derselben Quelle" für S-U zu eng gebaut — und eine
   *quellenübergreifend anschlussfähige* Reifedefinition wäre eine
   Protokolländerung mit neuer Präregistrierung, kein Nachjustieren.
2. **S-G allein weiterführen.** Es verfehlt das Gate um 0,68 Punkte; ob das eine
   sinnvolle Ein-Varianten-Studie ergibt, ist eine Methodik-Frage für den
   Orchestrator, keine für den Executor.
3. **Ehrlich abbrechen** (INCONCLUSIVE_DATA endgültig) und die geparkte
   Geldfrage stellen — erst mit dokumentiertem Gratis-Suchvermerk nach R17.

**Karls einzige offene Entscheidung aus dieser Etappe** (eine Sperrzonen-Frage,
keine Methodik-Frage): Soll die Nur-Zählen-Probe auch auf dem **verschlüsselten
Endtest-Fenster** laufen dürfen? Sie würde nur zählen, nie ein Ergebnis rechnen,
und den Schlüssel im Arbeitsspeicher benutzen. Der Planer hält den Lauf
methodisch für richtig; er ist **nicht** ausgeführt worden, weil er gegen Karls
Wort „nicht öffnen, keinen Öffner bauen" verstößt. Für E4 wird er nicht
gebraucht.

---

## 7. Pflichtsätze (R11)

- Über Firmen ohne auswertbaren Umsatz in den vier eingefrorenen Quellen trifft
  diese Studie **keine** Aussage. Ihre Ergebnisse gelten nicht für den ganzen
  US-Markt. Im Prüffenster liefern **2.332 Firmen** in keiner der vier Quellen
  einen auswertbaren Umsatz (die Quote lässt sich aus dieser Probe nicht bilden,
  siehe offene Prüfschritte).
- Der Zukauf-Wächter (Akquisitions-Anteil am Wachstum) ist mit freien Daten
  **nicht berechenbar**. Die Je-Aktie-Rechnung fängt nur den
  Kapitalerhöhungs-Teil.
- Das Universum sind SEC-Einreicher mit ausreichender Historie — **keine**
  überlebenden-sichere Vollerhebung. Die SEC-Nummer (CIK) ist eine Firmen-, keine
  Wertpapier-Identität.
- **Pseudo-prospektiv, nie vollständig blind:** Die Schwellen kommen regelbasiert
  aus der Entdeckungs-Verteilung, aber ich weiß, wer 2017–2024 gewonnen hat. Der
  einzige wirklich blinde Test ist die Vorwärts-Mitschrift.
- 2009q1 ist in beiden Beobachtungs-Ständen leer — ein Loch am Anfang jeder
  Zeitreihe, die dort beginnt.

---

## 8. Offene Prüfschritte — was nicht ausgeführt werden konnte

Das sind **offene Prüfschritte, keine Restrisiken**:

1. **Zähllauf auf dem Endtest-Fenster:** nicht ausgeführt (Sperrzone). Der
   Code-Pfad kennt das Fenster, prüft seine Siegel-Wache und weigert sich dann;
   ein Entschlüsselungs-Aufruf wurde bewusst **nicht** gebaut. Karl-Entscheid
   offen.
2. **Ausschlussquote der Grundgesamtheit je Fenster:** Die Ausgabe-Allowlist der
   Probe führt den Zähler „Firmen ohne Umsatzquelle" (2.332), aber nicht seinen
   Nenner. Die Quote ist damit für das Prüffenster **noch nicht** berichtet,
   obwohl sie Pflichtangabe ist. Sie ist ohne neuen Datenzugriff nachholbar (reine
   Zählgröße), braucht aber eine Ergänzung der Allowlist — und die ist eine
   Änderung an der versiegelten Präregistrierung, also eine Orchestrator-Weiche.
3. **Unabhängige Nachrechnung durch den Zweitmotor:** entfällt derzeit
   (Codex-Kontingent leer). Die Zahlen sind gegen den E1-Report geankert, aber
   nicht von einem zweiten Motor nachgebaut.
4. **Anker-Lauf der Zählprobe auf dem Entdeckungsfenster:** wäre der sauberste
   Beweis, dass die Probe E2s 512/731 exakt reproduziert. Nicht gefahren, weil
   die Freigabe nur für das Prüffenster gilt.

---

## 9. Neue Fragen und Hypothesen (R16)

- **VORSCHLAG E4a — Kennungswechsel als Reife-Killer messen.** Hypothese: Der
  ASC-606-Namenswechsel erklärt den größten Teil der 23-Punkte-Lücke zwischen S-U
  (66,67 %) und S-G (89,32 %). Gemessen wird auf dem Prüffenster, rein zählend:
  Anteil der unreifen Erst-Ereignis-Firmen, deren Reihe genau an einer
  Namensgrenze endet. Kein Ergebniswert, keine neue Datenquelle. *Zeitschätzung:
  1 Tag.*
- **VORSCHLAG E4b — Reifedefinition „anschlussfähig statt identisch".** Wenn E4a
  die Hypothese bestätigt: eine Reifedefinition entwerfen, die einen
  präregistrierten Kennungswechsel als Fortsetzung derselben Reihe akzeptiert,
  ohne über die Naht zu rechnen. Das ist eine **Protokolländerung** mit eigener
  Präregistrierung — nie ein Nachjustieren am laufenden Protokoll. *Zeitschätzung:
  2 Tage.*
- **VORSCHLAG E4c — Auffindbarkeit des Entdeckungsfensters nachmessen.** Dieselbe
  Zählprobe auf `panel-entdeckung.sqlite`, Signalband 2009–2015 ohne Pufferjahr.
  Damit wäre erstens der E2-Anker hart geprüft und zweitens beantwortet, ob die
  70 % des Entdeckungsfensters dieselbe Ursache haben. *Zeitschätzung: 0,5 Tage.*
- **Offene Frage ohne Etappenvorschlag:** Ist ein Auffindbarkeits-Gate von 90 %
  für **Fundamentaldaten** überhaupt die richtige Schwelle? Es stammt aus der
  Kurs-Vorstudie, wo fehlende Nachverfolgbarkeit fast immer Delisting bedeutete.
  Bei SEC-Zahlen bedeutet sie auch „Firma hat die Kennung gewechselt". Die Frage
  gehört vor den Orchestrator, **nicht** vor den Executor — und sie darf erst
  nach E4a gestellt werden, sonst wäre sie eine Schwellensenkung mit Ergebnis im
  Rücken.
- **Offene Frage:** Der Aktienzahl-Nenner (R10) deckt im Prüffenster 80,1 %
  (S-U) beziehungsweise 83,4 % (S-G) der reifen Firmen — im Entdeckungsfenster
  waren es 84,0 %. Die Größenordnung hält also über die Fenster. Bleibt die
  Unsicherheits-Schranke nach R11 damit schmal genug, um eine Aussage zu tragen?
  Zu beantworten in E4, wenn die Schranken zum ersten Mal gerechnet werden.

---

## 10. Artefakte dieser Etappe

| Pfad | Inhalt |
|---|---|
| `protocol/early-detection/2.0.0/preregistration.json` | die eingefrorene Frage, 8 Tests, Minima, vier Pflicht-Klauseln, alle Abweichungen mit Grund |
| `protocol/early-detection/2.0.0/hash-manifest.json` | SHA-256-Bindung von Präregistrierung + Zählprobe + `studie-basisraten.py` |
| `protocol/early-detection/2.0.0/outcome-access-ledger.json` | +1 verketteter Eintrag `count_only_probe_authorized` (Prüffenster), vor dem Zugriff gepusht |
| `protocol/early-detection/2.0.0/friedhof.json` | S-UG, Banken-Sonderfamilie, Treasury-Nenner, NetIncome-Alternative, Kurs-Endpunkt, Themen-Codierung |
| `protocol/early-detection/2.0.0/rules.json` | R1 geschlossen, R4-Endpunktsperren, R9/R15 von Vorlage auf Skript |
| `lib/studie-verfassung.js` | Endpunkt-Klassen-Sperre, Zählproben-Eintragsart, Serverzeit-Vergleich |
| `scripts/studie-zaehlprobe.py` | die Nur-Zählen-Probe samt Selbsttest (29 Prüfungen) |
| `scripts/studie-r1-serverzeit.js` | Vorab-Anmeldung und Server-Bestätigung |
| `tests/studie-e3-praereg.test.js`, `tests/studie-zaehlprobe.test.js` | W1–W6 |
| `reports/studie/E3-zaehlprobe-pruefung-2026-08-19.json` | der vollständige Lauf-Umschlag mit allen Zählern (Lauf 2) |
