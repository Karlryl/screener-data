# E4f — Unabhängige Nachrechnung des E4d/E4e-Berichts durch einen zweiten Motor

*Etappe E4f der Early-Detection-Studie · Protokoll FEM-SEC-US@2.0.0 · 23.08.2026*
*Zweig `studie/e4f-nachrechnung` · rein nachrechnend, kein Datenzugriff, kein Studienlauf,
keine neue Anmeldung im Zugriffs-Register*

**Dieses Dokument ändert den Bericht vom 19.08. nicht.** Es ist ein append-only Nachtrag.
Der Originalbericht `reports/studie/E4d-E4e-kadenz-2026-08-19.md` bleibt byte-identisch
stehen, samt seiner Fehler — nach derselben Regel, unter der am 14.08. ein veröffentlichter
falscher Prüfer append-only repariert statt umgeschrieben wurde.

---

## 1 · Warum es diese Etappe gibt

Der E4d/E4e-Bericht führt in Abschnitt 12 als offenen Prüfschritt Nummer 6:

> „**Unabhängige Nachrechnung durch einen zweiten Motor:** entfällt (Codex-Kontingent leer)."

Das Kontingent ist wieder da. Der Schritt ist damit nachgeholt und **Punkt 6 ist
geschlossen**.

**Aufbau:** Ein zweiter Motor (Codex, `codex-cli 0.146.0`, `model_reasoning_effort=xhigh`)
hat den Bericht read-only gegen die eingefrorenen Artefakte geprüft — mit dem ausdrücklichen
Auftrag, ihn zu **widerlegen**, nicht zu bestätigen. Sieben Prüfungen: Arithmetik,
Zähler-Herkunft, Regel-Treue, Siegel-Treue, Code-Treue des Kadenz-Kriteriums,
Sabotage-Protokoll, Überbehauptung. Der Brief liegt unter
`~\.codex\delegation-locks\studie-duell-e4d-20260823-124344.md`, die Antwort daneben
als `…-ANTWORT.md`. Der Motor hatte keinen Schreibzugriff, kein Netz, keinen Zugriff auf
das Endtest-Fenster und arbeitete in einem wegwerfbaren Auscheck, nicht im Produktivbaum.

**Jeder Befund unten wurde danach an den Rohumschlägen selbst reproduziert**, bevor er
hier steht. Zwei Befunde des Motors sind dabei schärfer geworden, keiner ist gestorben.

---

## 2 · Das Verdikt trägt

> # ROT / INCONCLUSIVE_DATA bleibt bestehen.

Vier der sieben Prüfungen sind vollständig bestätigt, und es sind genau die vier, an denen
das Verdikt hängt:

| Prüfung | Ergebnis |
|---|---|
| **Arithmetik** | Jede Stelle stimmt. 326/365 = 89,315068493…, Abstand zu 90 % = 0,684931507 → 0,685. 4.284/4.732 = 90,532544379… → 90,533. Ungerundete Differenz 1,217475886 → **1,217**. Abweichung 0,000. Dass 90,533 − 89,315 = 1,218 ergibt, ist Rundung der bereits gerundeten Armwerte; der Bericht rechnet korrekt mit den Rohquoten. |
| **Regel-Treue** | Die Regel steht wörtlich als `>= 0.90` UND `>= 0.90` UND `<= 0.10`, UND-verknüpft, mit „sonst ROT". Gemessen 0,893150685 / 0,905325444 / 0,012174759. Es scheitert ausschließlich, aber eindeutig die erste Bedingung. **Keine zulässige Lesart erzeugt GRÜN** — weder inklusive Schwelle noch Rundung. |
| **Siegel-Treue** | `preregistration.json` führt wörtlich `"gate": {"minimum": 0.9, "gilt": "Signal-Arm UND Kontrollpool", "maxDifferenzPunkte": 10}`. Der Freeze übernimmt `minimum: 0.9` und `maxDifferenz: 0.1`. Schwellen und Richtung stimmen überein. |
| **Code-Treue** | `studie-e4d-kadenz.py:369-397` bildet den Median über die **`ddate`-Bilanzstichtage** (nicht über accepted-Werte), filtert inklusiv mit `d <= f["ddate"]`, und die Untergrenze 91,25 greift **nach** der Medianbildung. Der Zensuranker kommt separat aus `f["accepted"]`, der Vergleich ist strikt `>`. Das ist exakt der veröffentlichte Wortlaut. |

**Der härteste gefahrene Angriff auf das Verdikt** war die ungerundete Neuberechnung
verbunden mit der gezielten Suche nach einer GRÜN-Lesart der versiegelten Regel. Er
scheitert eindeutig: 326/365 liegt unter 0,90, und keine Umformung der Regel ändert das.

---

## 3 · Vier Befunde am Bericht — das Ergebnis hält, die Beschreibung nicht überall

Alle vier betreffen **wie der Bericht redet**, keiner betrifft eine Messung. Sie sind
trotzdem ernst: drei davon behaupten mehr, als die eigenen Zahlen tragen, und einer davon
ist die Keimzelle eines späteren Arguments gegen das Gate.

### B1 (schwer) · Die 83–90-%-Hypothese in Abschnitt 11 ist zahlenwidrig

Der Bericht schreibt:

> „Die Auffindbarkeit liegt in beiden Fenstern und in beiden Familien zwischen 83 % und
> 90 %, nie darüber. Wenn das ein Niveau dieser Datenbasis ist […], dann ist eine
> 90-%-Schwelle auf diesen Daten grundsätzlich schwer erreichbar."

Nachgerechnet aus den beiden Rohumschlägen, alle acht Arme:

| Fenster | Arm | Zähler/Nenner | Quote | im Band 83–90 %? |
|---|---|---|---:|---|
| Prüffenster | S-G Kontrollpool | 4.284/4.732 | **90,533 %** | **nein — darüber** |
| Prüffenster | S-G Signal | 326/365 | 89,315 % | ja |
| Prüffenster | S-U Kontrollpool | 3.085/4.162 | **74,123 %** | **nein — darunter** |
| Prüffenster | S-U Signal | 292/438 | **66,667 %** | **nein — weit darunter** |
| Entdeckung | S-G Kontrollpool | 5.000/5.768 | 86,685 % | ja |
| Entdeckung | S-G Signal | 557/647 | 86,090 % | ja |
| Entdeckung | S-U Kontrollpool | 3.760/4.513 | 83,315 % | ja |
| Entdeckung | S-U Signal | 543/651 | 83,410 % | ja |

**Drei von vier Armen des Prüffensters liegen außerhalb des behaupteten Bandes — und
zwar in beide Richtungen.** Das „nie darüber" ist durch 90,533 % widerlegt, das Band selbst
durch 74,123 % und 66,667 %. Nur das Entdeckungsfenster sitzt vollständig im Band.

*(Der zweite Motor fand die Aussage über den S-U-Wert 66,667 %; die Prüfung aller acht Arme
und damit der Nachweis, dass die Behauptung in **beiden** Richtungen und auf **drei von
vier** Armen bricht, stammt aus der Reproduktion hier.)*

**Warum das mehr ist als ein Schönheitsfehler:** Diese Hypothese ist der einzige Satz im
Bericht, aus dem sich später ableiten ließe, die 90-%-Schwelle sei auf dieser Datenbasis
unfair gewählt. Sie trägt nicht. **Die Schwelle bleibt präregistriert und wird durch diesen
Nachtrag ausdrücklich nicht angetastet** — aber wer sie eines Tages angreifen will, kann
sich nicht auf Abschnitt 11 stützen.

### B2 (mittel) · „Das Kadenz-Kriterium zensiert nichts" gilt nur für den Signal-Arm

Der Bericht sagt an einer Stelle ohne Einschränkung, das Kadenz-Kriterium habe nichts
zensiert. Die vier `zensiert_kadenz`-Werte des Prüffensters lauten **1, 0, 1, 0** — die
beiden Kontrollpools zensieren je einen Fall. Richtig ist die Aussage nur für die beiden
Signal-Arme (S-G und S-U je 0). Die Kernaussage des Berichts — dass sich die Zahl des
S-G-Signalarms um exakt null bewegt hat — bleibt davon unberührt und ist korrekt.

### B3 (mittel) · Abschnitt 4 und 6 behaupten Ursachen, die nicht gemessen wurden

- „An der Fensterkante liegt nichts, was man zensieren könnte" ist **eng** gedeckt: belegt
  ist `zensiert_kadenz: 0` für den S-G-Signalarm, also dass *dieses Kriterium* dort nichts
  zensierte. Ob es reife Erst-Ereignisse knapp jenseits der Zensurgrenze gibt, sagt der
  Bericht in Abschnitt 12 Punkt 3 **selbst**, dass er es nicht gezeigt hat. Die stärkere
  Formulierung in Abschnitt 4 widerspricht dem eigenen Vorbehalt.
- „kein Kanten-Schatten, sondern **reale Abwanderung**" ist eine Ursachenaussage. Belegt
  sind leere Klasse-(c)-Fächer im Randbereich; Delisting, Übernahme, Fusion und Formwechsel
  sind laut Abschnitt 12 Punkt 4 ausdrücklich **nicht gemessen**. Was gezeigt ist: die
  Verluste liegen nicht an der Fensterkante. Warum sie auftreten, ist offen.

### B4 (gering) · „alle Fächer ausgegeben — auch die leeren" stimmt nicht

Die Histogramm-Tabelle des Berichts endet bei `1365–1455`. Die Rohumschläge führen in
**allen vier** Armen zusätzlich das Fach `"1456-1546": 0` (viermal reproduziert). Der Wert
ist null, die Aussage über das Bild ändert sich nicht — aber die Behauptung, die Tabelle
zeige alles, ist falsch.

### B5 (gering, Testabdeckung) · Eine Sabotage-Lücke im Entdeckungsfenster

Das Sabotage-Protokoll ist mit einer Ausnahme namentlich durch Tests gedeckt. Die Lücke:
im Prüffenster werden Signal **und** Pool gekippt, im Entdeckungsfenster ausschließlich
`S-G/signal/fallzahl` — **keine Entdeckungs-Poolzahl wird sabotiert**. Dazu ein
grundsätzlicher Vorbehalt des zweiten Motors, dem hier ausdrücklich zugestimmt wird: der
heutige Quellstand kann nicht beweisen, dass die historischen manuellen Sabotagen
*tatsächlich einmal rot gesehen* wurden. Er beweist nur, dass die genannten Tests existieren.

---

## 4 · Was daraus folgt

1. **Am Verdikt ändert sich nichts.** ROT / INCONCLUSIVE_DATA für S-G im Prüffenster steht.
   Die Signalfamilie erhält keinen konfirmatorischen Status, E4 bleibt zu, und die
   90-%-Schwelle bleibt unangetastet.
2. **Abschnitt 11 des Originalberichts ist als widerlegt zu behandeln.** Wer ihn zitiert,
   zitiert eine Behauptung, die drei von vier Prüffenster-Armen widerlegen. Der
   Originaltext bleibt append-only stehen; dieser Nachtrag ist die Korrektur.
3. **B5 ist ein offener Prüfschritt, kein Restrisiko** — eine Sabotage der
   Entdeckungs-Poolzahl wäre nachzuziehen, bevor das Sabotage-Protokoll dieser Etappe als
   vollständig gilt. Sie ändert keine gemessene Zahl.
4. **Abschnitt 12 Punkt 6 ist geschlossen.** Die unabhängige Nachrechnung hat
   stattgefunden, mit dem Auftrag zu widerlegen, und das Ergebnis hat gehalten.

**Was dieser Nachtrag ausdrücklich NICHT tut:** Er misst nichts nach, was Datenzugriff
bräuchte. Er öffnet das Endtest-Fenster 2021–2023 nicht. Er schlägt keine Schwellenänderung
vor. Er schreibt den Originalbericht nicht um. Und er ersetzt keine menschliche
Zweitkodierung — ein zweites Sprachmodell ist ein zweiter Motor, nicht ein zweiter Kopf;
die Lektion vom 14.08. („Mehr Wiederholungen ersetzen keine fehlende Evidenzart") gilt
hier unverändert weiter.

---

## 5 · Artefakte

| Pfad | Inhalt |
|---|---|
| `~\.codex\delegation-locks\studie-duell-e4d-20260823-124344.md` | der Prüfauftrag an den zweiten Motor, wörtlich |
| `~\.codex\delegation-locks\studie-duell-e4d-20260823-ANTWORT.md` | seine sieben Blöcke im Format-Vertrag, unverändert |
| `reports/studie/E4d-E4e-kadenz-2026-08-19.md` | der geprüfte Originalbericht — **unverändert** |
| `reports/studie/E4d-kadenz-pruefung-2026-08-19.json` | Rohumschlag Prüffenster (alle vier Arme, Histogrammfächer) |
| `reports/studie/E4d-kadenz-entdeckung-2026-08-19.json` | Rohumschlag Entdeckungsfenster |

---

## 6 · Neue Fragen und Hypothesen (Pflichtblock nach R16)

Dieser Block führt ausschließlich zusammen, was der Bericht oben selbst als offenen
Punkt oder als ausdrückliche Grenze benennt.

- **B5 ist offen, nicht erledigt.** Der Bericht führt B5 als offenen Prüfschritt: eine
  Sabotage der Entdeckungs-Poolzahl ist nachzuziehen, bevor das Sabotage-Protokoll
  dieser Etappe als vollständig gilt. Sie ändert keine gemessene Zahl — offen ist
  ausschließlich die Testabdeckung.
- **Die menschliche Zweitkodierung fehlt weiterhin.** Der Bericht hält ausdrücklich
  fest, dass er keine menschliche Zweitkodierung ersetzt: ein zweites Sprachmodell ist
  ein zweiter Motor, nicht ein zweiter Kopf. Offen bleibt, welche Evidenzart diese
  Lücke schließen könnte — mehr Wiederholungen tun es laut der zitierten Lektion vom
  14.08. nicht.
- **Abschnitt 11 des Originalberichts gilt als widerlegt.** Der Originaltext bleibt
  append-only stehen. Offen bleibt, ob weitere Zitate dieser Aussage im Bestand
  existieren, die denselben Nachtrag brauchen.
- **Was diese Etappe nicht nachmessen konnte.** Der Bericht misst nichts nach, was
  Datenzugriff bräuchte, und öffnet das Endtest-Fenster 2021–2023 nicht. Jede
  Anschlussfrage, die daran hinge, ist aus diesem Nachtrag heraus nicht beantwortbar.

**Keine neue Etappe vorgeschlagen.** Ein Etappen-Vorschlag mit Zeitschätzung nach R16
wäre eine Forschungsentscheidung des Autors und wird hier nicht nachträglich erfunden.
