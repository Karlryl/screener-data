# E4a — Warum die Auffindbarkeit reißt: die Klassen-Zerlegung

*Etappe E4a der Early-Detection-Studie · Protokoll FEM-SEC-US@2.0.0 · 19.08.2026*
*Zweig `studie/e3-praereg` · rein zählend, kein Ergebniswert, keine neue Datenquelle*

---

## 1. Verdikt

> **Hypothese BESTÄTIGT — aber sie erklärt nicht, was E4 blockiert.**
>
> Der Kennungswechsel trägt **72,6 %** des Abstands zwischen den beiden
> Varianten: von den 22,65 Prozentpunkten zwischen S-U (66,67 %) und S-G
> (89,32 %) verschwinden **16,44 Punkte**, sobald ein Kennungswechsel als
> Fortsetzung statt als Abbruch gezählt wird. **72 von 146** nicht verfolgbaren
> S-U-Firmen des Prüffensters sind reine Kennungswechsler — Firmen, die alle
> vier Folgequartale geliefert haben, nur unter einem anderen Namen.
>
> **Und trotzdem:** auch ohne jeden Kennungswechsel läge S-U bei **83,11 %**.
> Der Rest des Verlusts hat eine andere Ursache, die S-U und S-G **teilen**.

Zwei Sätze zur Begriffsklärung, weil beide unten dauernd vorkommen:

- **Auffindbarkeit** heißt: Von den Firmen, bei denen das Signal zum ersten Mal
  gefeuert hat — wie viele lassen sich anschließend vier Quartale weit
  verfolgen? Nur die kann man später auswerten.
- **Kennung** ist der Name, unter dem eine Firma ihre Zahl bei der SEC meldet
  (z. B. `Revenues` oder `SalesRevenueNet`). Mit der Bilanzregel **ASC 606**
  haben zum Jahreswechsel 2017/18 sehr viele US-Firmen diesen Namen gewechselt,
  ohne dass sich am Geschäft irgendetwas geändert hätte.

---

## 2. Die Klassen-Zerlegung — woran genau scheitert die Reife?

Jede unreife Erst-Ereignis-Firma bekommt **genau eine** Klasse. Die Klassen sind
vollständig und überschneidungsfrei; dass sie sich auf die Zahl der unreifen
Firmen summieren, prüft der Lauf selbst und bricht sonst ab.

| Klasse | Bedeutung im Klartext |
|---|---|
| **(a)** | Die Firma meldet nach dem Signal **gar nichts** mehr. Weg. |
| **(b)** | Sie meldet **vier oder mehr** Folgequartale — aber unter einer **anderen Kennung**. Nicht die Firma ist verschwunden, unser Zähler hat sie verloren. |
| **(c)** | Sie meldet **ein bis drei** Folgequartale, egal unter welcher Kennung. Zu kurz. |
| **(d)** | Sie taucht in der gewählten Reihe überhaupt nicht auf — darf nicht vorkommen. |

### Prüffenster 2017–2019 (Signal-Arm)

| | Erst-Ereignis-Firmen | reif | **(a)** | **(b)** | **(c)** | **(d)** | Auffindbarkeit |
|---|---:|---:|---:|---:|---:|---:|---:|
| **S-U** (Umsatz, vier Kennungen) | 438 | 292 | 22 | **72** | 52 | 0 | **66,67 %** |
| **S-G** (Betriebsergebnis, eine Kennung) | 365 | 326 | 9 | **0** | 30 | 0 | **89,32 %** |

### Entdeckungsfenster 2009–2015 (Signal-Arm)

| | Erst-Ereignis-Firmen | reif | **(a)** | **(b)** | **(c)** | **(d)** | Auffindbarkeit |
|---|---:|---:|---:|---:|---:|---:|---:|
| **S-U** | 651 | 543 | 21 | **17** | 70 | 0 | **83,41 %** |
| **S-G** | 647 | 557 | 29 | **0** | 61 | 0 | **86,09 %** |

**Das ist der Kern in zwei Zahlen.** Klasse (b) ist im Prüffenster
**72 Firmen** und im Entdeckungsfenster **17** — obwohl das Entdeckungsfenster
mehr Erst-Ereignisse hat. Vor ASC 606 gibt es das Problem fast nicht, nach ASC
606 ist es die größte Einzelklasse. Und der Abstand zwischen den Varianten
schrumpft entsprechend: **22,65 Punkte** im Prüffenster gegen **2,68 Punkte**
im Entdeckungsfenster.

**S-G hat Klasse (b) im Signal-Arm exakt null Mal** — in beiden Fenstern, über
1.012 Erst-Ereignis-Firmen hinweg. Das ist keine Rundung, das ist die Bauart:
S-G läuft auf einer einzigen Kennung, dort *kann* der Name nicht wechseln. Genau
deshalb taugt es als Kontrollgruppe.

**Die Währungseinheit spielt keine Rolle.** Über beide Fenster und beide Arme
zählt der Lauf **844 Kennungswechsel**, davon **841 reine Namenswechsel** und
**3**, bei denen auch die Währungseinheit wechselt. Alle drei liegen im
S-G-Kontrollpool — dort ist ein Wechsel überhaupt nur so möglich, weil der Name
festliegt. Der Verdacht „da rechnet jemand Dollar gegen Euro" ist damit erledigt:
was S-U verliert, verliert es am **Namen**.

---

## 3. Der Jahresverlauf — die Messung, die entscheidet

Das ist der Test, der die Hypothese hätte kippen können: Wenn wirklich ASC 606
schuld ist, **muss** der Effekt zeitlich an 2018 hängen. Ein gleichmäßig
niedriger Verlauf hätte die Hypothese widerlegt.

Jahr = Kalenderjahr, in dem die Zahlen des Signals bei der SEC **eingingen**.

### Prüffenster, Signal-Arm

| Jahr | S-U Firmen | S-U Auffindbarkeit | S-U Anteil Klasse (b) | S-G Auffindbarkeit | S-G Klasse (b) |
|---|---:|---:|---:|---:|---:|
| 2017 | 181 | 71,82 % | 16,0 % | 91,67 % | 0 |
| **2018** | 124 | **54,03 %** | **26,6 %** | 89,21 % | 0 |
| 2019 | 133 | 71,43 % | 7,5 % | 87,69 % | 0 |

**Der Bruch ist da, und er ist genau dort, wo er sein muss.** S-U fällt 2018 um
knapp 18 Punkte ein und erholt sich 2019 wieder — die Kurve hat eine Delle, kein
Niveau. Der Anteil der Kennungswechsler macht dieselbe Bewegung: 16,0 % → 26,6 %
→ 7,5 %. Nach dem Umstellungsjahr ist der Wechsel durch, und Klasse (b) fällt
von 33 auf 10 Firmen.

**Die Kontrollgruppe macht die Delle nicht mit.** S-G läuft glatt und leicht
fallend durch: 91,67 / 89,21 / 87,69. Kein Einbruch 2018. Damit ist
ausgeschlossen, dass 2018 einfach ein schlechtes Jahr für alle war — der Effekt
ist auf die Variante mit dem Kennungswechsel beschränkt.

**Zweite Jahresachse, dieselbe Aussage.** Legt man die Firmen nicht nach dem
Eingangsdatum, sondern nach dem **Bilanzstichtag** des Signals ab, verschiebt
sich der Gipfel der Klasse (b) auf 2017 (43 Firmen gegen 23 in 2018). Das ist
kein Widerspruch, sondern die Mechanik selbst: Das Ereignis liegt **vor** der
Naht, die vier Folgequartale fallen **hinter** sie. Beide Achsen zeigen auf
dieselbe Umstellung, nur von den zwei Seiten.

Im Kontrollpool ist das Bild noch schärfer: Bilanzstichtag 2016 → 94,08 %
auffindbar bei 7 Kennungswechslern; Bilanzstichtag 2017 → 50,49 % bei
**482** Kennungswechslern.

---

## 4. Die hypothetische Rechnung — **keine** Protokolländerung

Frage: Was wäre die Quote, wenn ein Wechsel **innerhalb** der vier
eingefrorenen Umsatz-Kennungen als Fortsetzung derselben Reihe zählte statt als
Abbruch?

> **Das ist eine Rechnung, kein Einbau.** An der präregistrierten
> Reifedefinition wurde nichts geändert; die Zahlen aus Abschnitt 2 stehen
> unverändert. Eine anschlussfähige Reifedefinition wäre eine
> **Protokolländerung mit eigener Präregistrierung** (E4b).

| | ist | hypothetisch | Differenz |
|---|---:|---:|---:|
| **S-U Prüffenster** | 66,67 % | **83,11 %** | +16,44 Punkte |
| S-G Prüffenster | 89,32 % | 89,32 % | 0,00 |
| S-U Entdeckungsfenster | 83,41 % | 86,02 % | +2,61 Punkte |
| S-G Entdeckungsfenster | 86,09 % | 86,09 % | 0,00 |
| S-U Kontrollpool Prüffenster | 74,11 % | 88,83 % | +14,72 Punkte |
| S-G Kontrollpool Prüffenster | 90,53 % | 90,56 % | +0,03 |

Der Abstand zwischen den Varianten schrumpft damit von **22,65** auf **6,21**
Punkte. Der Kennungswechsel trägt also **72,6 %** des Abstands — das ist die
Zahl, die das Verdikt trägt.

**Die hypothetische Quote von 83,11 % liegt unter der präregistrierten
Schwelle.** Was daraus folgt, ist keine Executor-Frage; hier wird nichts
umgerechnet, verglichen oder empfohlen.

---

## 5. Was der Kennungswechsel **nicht** erklärt

Die vierte Auftragsfrage war: Zeigt S-G denselben Jahresverlauf? Dann steckt der
Verlust in etwas, das beide Varianten teilen. **Antwort: teils — und dieser
geteilte Teil ist im Entdeckungsfenster der größere.**

| | (a) + (c) zusammen | Anteil aller Erst-Ereignis-Firmen |
|---|---:|---:|
| S-U Prüffenster | 74 | 16,9 % |
| S-G Prüffenster | 39 | 10,7 % |
| S-U Entdeckungsfenster | 91 | 14,0 % |
| S-G Entdeckungsfenster | 90 | 13,9 % |

Im Entdeckungsfenster verlieren beide Varianten **praktisch gleich viele**
Firmen aus Gründen, die mit Kennungen nichts zu tun haben — 91 gegen 90. Dort
liegen beide Quoten bei 83–86 %, und **keine** der beiden erreicht 90 %. Der
Kennungswechsel ist also die Erklärung für den **Unterschied** zwischen den
Varianten, nicht für das **Niveau**.

**Und es gibt eine dritte, klar sichtbare Mechanik: den Fensterrand.** Je näher
das Signal an der Kante des Panels liegt, desto häufiger Klasse (c) — bei
**beiden** Varianten:

| Signaljahr (Entdeckungsfenster) | 2012 | 2013 | 2014 | 2015 |
|---|---:|---:|---:|---:|
| S-U, Anteil Klasse (c) | 6,5 % | 7,0 % | 11,5 % | **21,4 %** |
| S-G, Anteil Klasse (c) | 5,4 % | 7,1 % | 11,1 % | **15,7 %** |

Das ist ein glatter, monotoner Anstieg zum Rand hin — und der Lauf meldet für
dieses Band **null zensierte Erst-Ereignisse**. Siehe Abschnitt 6, zweiter
Befund.

---

## 6. Zwei Befunde am geerbten Werkzeug

Beide sind beim Messen aufgefallen. Beide werden hier **gemeldet, nicht
behoben** — ein Executor repariert keine präregistrierte Definition.

### Befund 1: Die Auffindbarkeits-Formel ist an der Fensterkante keine Quote

Die von E3 übernommene Formel teilt die Zahl **aller** reifen Firmen durch die
Zahl der **nicht zensierten** Erst-Ereignis-Firmen. „Zensiert" heißt: das
Ereignis liegt so nah am Rand, dass die vier Folgequartale womöglich gar nicht
mehr im Panel liegen können. Das ist eine **Warnung**, kein Nachweis — eine
zensierte Firma **kann** reif sein. Wo beides zusammenkommt, steht im Zähler
mehr als im Nenner, und es kommt eine „Quote" über 1 heraus.

Im Ankerband 2012–2016 des Entdeckungsfensters passiert genau das: für das
Pufferjahr 2016 liefert die Formel **1,4**. Der erste Lauf ist daran
abgebrochen — der Wächter hat funktioniert.

**Für E3 ändert sich dadurch nichts:** im Prüffenster ist die Zahl der
zensierten Erst-Ereignisse null, dort ist die Formel wohldefiniert und liefert
exakt E3s Zahlen. Die Diagnose definiert die Formel **nicht** um; sie meldet
dort, wo die Formel keine Quote liefert, **NICHT BERECHENBAR** statt einer Zahl,
die keine ist.

### Befund 2: Das Zensur-Kriterium ist zu großzügig

E3s Zensur-Regel rechnet mit **80 Tagen je Folgequartal**, also 320 Tagen ab
Eingang des Signals. Vier echte Quartalsmeldungen brauchen realistisch rund ein
Jahr (≈ 91 Tage Abstand plus Meldeverzug). Die Regel erklärt deshalb Ereignisse
für „nicht zensiert", die ihre vier Folgequartale gar nicht mehr haben können —
und genau diese Firmen landen dann in Klasse (c) statt in der Zensur.

Der Beleg steht in der Tabelle oben: null zensierte Ereignisse, aber ein
Klasse-(c)-Anteil, der zum Rand hin von 6,5 % auf 21,4 % steigt.

**Was das heißt und was nicht:** E3s Satz „die Fensterkante trägt die Erklärung
nicht" gilt für E3s **Zensur-Kriterium** — und stimmt in dem Sinn. Für den
**Randeffekt selbst** gilt er nicht. Ob das Kriterium anzupassen ist, ist eine
Methodik-Frage für den Orchestrator; hier wird sie nur gestellt, nicht
beantwortet.

---

## 7. Warum es so entschieden wurde

**Der Code ist importiert, nicht nachgebaut.** Signaldefinition, Reifedefinition
und sämtliche Wächter kommen aus `scripts/studie-zaehlprobe.py` und
`scripts/studie-basisraten.py`. Beide hängen im gesiegelten Manifest und wurden
**nicht angefasst**. Ein Nachbau hätte die Zahlen auseinanderlaufen lassen — und
eine Diagnose, die andere Zahlen misst als der Befund, den sie erklären soll,
erklärt nichts.

**Die versiegelte Präregistrierung bleibt unberührt.** Die Diagnose braucht mehr
Ausgabefelder als die Zählprobe (die Klassen, die hypothetische Rechnung, die
Jahresachse). Statt die versiegelte Allowlist zu erweitern — ein nachträglich
erweitertes Siegel wäre keines mehr — führt die Diagnose eine **eigene**
Allowlist nach demselben Muster und **meldet sie im Zugriffs-Register an**. Ein
Wächter (W9) hält beide Seiten Feld für Feld zusammen: Wer ein Feld ergänzt,
ohne es anzumelden, fliegt auf. Der Beleg, dass das greift: eine gültige
Zählproben-Freigabe **reicht für die Diagnose nicht** und bricht ab.

**Genau eine Klasse je Firma, und die bindende Ursache gewinnt.** Eine Firma mit
zwei Folgequartalen unter neuer Kennung hat beide Probleme — sie zählt als (c),
weil sie die Reife auch quellenübergreifend verfehlt hätte. Das ist die
konservative Richtung: Klasse (b) ist damit eine **Untergrenze** des
Kennungswechsel-Effekts, keine Obergrenze.

**Beide Arme durch denselben Code.** Signal und Kontrollpool rufen dieselbe
Funktion mit derselben Fehlbehandlung. Die Vorstudie ist daran gestorben, dass
fehlende Werte in einer Gruppe strenger gebucht wurden als in der anderen; nur
deshalb ist der Vergleich der beiden Arme in Abschnitt 4 überhaupt etwas wert.

**Die Reihenfolge ist die Methodik.** Einfrieren → Push → Serverbestätigung →
Zugriff, für jedes Fenster einzeln, zweimal sauber durchlaufen:

| | Anmeldung im Register | Server-Bestätigung (GitHub-Uhr) | frühester Zugriff |
|---|---|---|---|
| Prüffenster, Lauf 1 | 16:50:45 UTC | 16:51:01 UTC | 17:02:45 UTC |
| Entdeckungsfenster, Lauf 1 | 16:50:45 UTC | 16:51:02 UTC | 17:02:45 UTC |
| Prüffenster, Neulauf | 17:09:31 UTC | 17:09:44 UTC | 17:12:31 UTC |
| Entdeckungsfenster, Neulauf | 17:09:31 UTC | 17:09:45 UTC | 17:12:31 UTC |
| Prüffenster, Lauf nach Code-Review | 17:36:27 UTC | 17:36:41 UTC | 17:39:27 UTC |
| Entdeckungsfenster, Lauf nach Code-Review | 17:36:27 UTC | 17:36:42 UTC | 17:39:27 UTC |

**Warum es drei Anmeldungen je Fenster gibt.** Jedes Mal, wenn sich die
Skript-Bytes änderten, wurde neu angemeldet und neu gefahren — ein Ergebnis, das
nicht zum Code seines Laufs gehört, ist wertlos:

1. **Lauf 1**: der erste Stand. Der Entdeckungsfenster-Lauf ist am
   Fensterkanten-Befund abgebrochen (Abschnitt 6).
2. **Neulauf**: nach dem Fensterkanten-Fix. Liefert die Zahlen dieses Reports.
3. **Lauf nach Code-Review**: nach den vier Review-Befunden. **Gemessen, nicht
   behauptet:** die Zahlen sind byte-identisch mit dem Neulauf — jede Klasse,
   jede Jahreszeile, jede Quote. Die ausgelieferten Artefakte stammen aus diesem
   dritten Lauf und gehören damit zum endgültigen Code-Stand.

Alle Vorläufe bleiben in der Akte und werden nicht ersetzt.

---

## 8. Woran es verifiziert wurde

**Der Anker greift wirklich — und zwar an vier veröffentlichten Zahlenpaaren.**
Der Lauf bricht ab, wenn er die bekannten Zahlen nicht reproduziert:

| Anker | Quelle | erwartet | gemessen |
|---|---|---|---|
| Prüffenster S-U | E3-Zählprobe | 438 Firmen / 292 reif / 0 zensiert | **identisch** |
| Prüffenster S-G | E3-Zählprobe | 365 / 326 / 0 | **identisch** |
| Entdeckung S-U, Band 2012–2016 | E2-Basisraten | 731 / 512 / 219 unreif | **identisch** |
| Entdeckung S-G, Band 2012–2016 | E2-Basisraten | 811 / 546 / 265 unreif | **identisch** |

Der **Kontrollpool** ist ebenfalls festgenagelt, nur an anderer Stelle: ein Test
hält die ausgelieferten Artefakte gegeneinander und verlangt, dass E4a und E3
bit-für-bit dieselben Kontrollpool-Zahlen tragen (4.163 Firmen / 74,11 % bei
S-U, 4.733 / 90,53 % bei S-G). Das ist der zweite Arm desselben Laufs — träfe er
E3 nicht, liefen die beiden Arme eben eher nicht durch denselben Code.

**Elf Sabotagen, jede einmal absichtlich gemacht und rot gesehen.** Das
Fixture trägt den Unterschied wirklich: je eine Firma der Klassen (a), (b1),
(b2) und (c), eine reife Firma, und dieselben fünf Firmen ein zweites Mal unter
der Ein-Kennungs-Variante. Ohne diese Firmen könnte die Sabotage einer einzelnen
Klasse gar nicht auffliegen.

| # | Sabotage | Reaktion |
|---|---|---|
| S1 | Klasse (b) wird nie vergeben, Kennungswechsler landen in (c) | rot: „Klasse (b) … genau zweimal" + „(b1)" + „(b2)" |
| S2 | beide Jahresachsen aus demselben Feld gerechnet | rot: „die beiden Jahresachsen sind NICHT dieselbe Achse" |
| S3 | Typprüfung der Zählfelder ausgebaut | rot: „ein geleckter Wachstumswert fliegt am Typ auf" |
| S4 | hypothetische Rechnung greift schon ab 1 Folgequartal | rot: (b), (b1) und (c) gleichzeitig |
| S5 | Anker-Prüfung meldet Erfolg ohne zu vergleichen | rot: „eine um EINS verschobene Fallzahl fliegt auf" (beide Fenster) |
| S6 | Fensterkanten-Regel gibt wieder eine Zahl über 1 aus | rot: „eine Quote über 1 heißt NICHT BERECHENBAR statt Zahl" |
| S7 | eine Kontrollpool-Zahl im ausgelieferten Artefakt um eins verschoben | rot: „Der Kontrollpool trifft E3 bit-für-bit" |
| S8 | (b1) und (b2) im Code vertauscht | rot, dreifach: alle drei „Zuordnung direkt"-Prüfungen |
| S9 | harte Sperre gegen Klasse (d) ausgebaut | rot: „eine Firma OHNE gewählte Reihe bricht die Zerlegung ab" |
| S10 | Reifeschwellen-Vergleich umgedreht | rot: „REIFE-ABBRUCH: … Zwei Schwellen für dieselbe Sache heißt: keine" |
| S11 | Register-Auswahl der Zählprobe wieder auf Typ + Fenster verkürzt | rot: „Der gewählte Eintrag ist e4a-… — das ist kein Zählproben-Lauf" |

Nach jeder Sabotage wurde der Stand zurückgenommen; das Arbeitsverzeichnis war
danach sauber und die Prüfungen wieder grün.

**Determinismus-Gegenprobe:** Je Fenster **drei** vollständige Läufe, zwei davon
unter identischem Code, der dritte nach dem Code-Review. Alle drei liefern
**byte-identische** Zahlen — jede Klasse, jede Jahreszeile, jede Quote.
Verschieden sind nur die Felder des Lauf-Umschlags, die sich unterscheiden
*müssen* (Lauf-Kennung und Zeitstempel).

**Die Ergebnis-Sperre hat gehalten.** Beide Läufe melden
`ergebnisdatenBeruehrt: false`, haben genau **eine** Datei gelesen (die
Panel-Datei ihres angemeldeten Fensters) und die Ausgabe gegen die
Vierzehn-Felder-Allowlist geprüft — auf beiden Ebenen und in beide Richtungen.
Zusätzlich eine **Typprüfung**: Zählfelder müssen ganze Zahlen sein, Quoten
liegen in [0,1] oder heißen NICHT BERECHENBAR. Ein durchgereichter Messwert
fällt damit auf, auch wenn er sich unter einem erlaubten Namen versteckt.

**Die Sperrzone ist zu geblieben.** Das Endtest-Fenster ist auf der Kommandozeile
gar nicht erreichbar, der Code-Pfad weigert sich zusätzlich, und die Datei
enthält keinen Entschlüsselungs-Aufruf — beides ist im Test nachgesehen. Das
Endtest-Siegel wurde vor jedem Lauf voll nachgerechnet (5.025.230.848 Bytes,
SHA-256 unverändert), und **der Schlüssel wurde nicht angefasst**.

**Code-Review vor „fertig": vier Befunde, alle gefixt — drei davon Wächter, die
nicht hielten.** Zwei Reviewer haben den Diff unabhängig geprüft:

- **Der schwerste Befund war ein Wächter, der nicht wehtat.** Vertauscht man im
  Code (b1) und (b2), blieb der Selbsttest grün: beide Fixture-Firmen liefern
  genau eine Zählung, und 1 = 1 bleibt nach dem Tausch wahr. Genau die Falle, vor
  der der Dateikopf selbst warnt. Die Zuordnung wird jetzt in **sechs Fällen
  einzeln** direkt geprüft, nicht mehr nur über Summen (Sabotage S8).
- **Reif/unreif wurde zweimal entschieden.** Die Diagnose fragte die
  Reifeschwelle der Zählprobe ab, während `studie-basisraten.py` mit ihrer
  **eigenen** entscheidet — zwei getrennt gepflegte Konstanten für dieselbe
  Sache. Heute stehen beide auf 4; jetzt zählt die Listenzugehörigkeit, und ein
  Auseinanderlaufen bricht ab (S10).
- **Die Register-Auswahl der Zählprobe zeigte auf den falschen Eintrag.** Meine
  erste Reparatur band sie an Eintragsart + Fenster — beides teilt die
  E4a-Anmeldung. Die Tests blieben zufällig grün, prüften aber den falschen Lauf.
  Sie hängt jetzt an der **Sache**: an der Ausgabe-Allowlist der versiegelten
  Präregistrierung (S11).
- **Klasse (d) wurde gezählt, aber nie durchgesetzt.** Ein Datenintegritätsbefund
  wäre stumm durchgelaufen. Sie bricht jetzt ab und hat einen positiven Test (S9).
  Dazu eine kleine Härtung am Fixture-Aufbau (offene SQLite-Verbindung bei
  Fehlschlag).

**Prüfungszahl:** vorher **100 Tests, alle grün, EXIT=0** — nachher **113 Tests,
alle grün, EXIT=0**. Der Selbsttest der Diagnose ist von 0 auf **49 benannte
Prüfungen** gewachsen; der Node-Test wertet sie **namentlich** aus, nicht am
Exit-Code: Fällt eine Zeile weg, ist der Test rot.

---

## 9. Was der Code anders sagt als der E3-Report

Zwei Stellen. Überall gilt der Code; die Abweichung steht hier, statt still
geglättet zu werden.

| Stelle | E3-Report | gemessen | wer hat recht |
|---|---|---|---|
| Auffindbarkeit des Entdeckungsfensters | „512 von 731 = 70,0 %" | Mit E3s **eigener** Formel (Nenner ohne zensierte) sind es **83,52 %**; 70,0 % ist die Quote ohne Zensur-Abzug | beide Zahlen stimmen, aber sie sind **nicht dieselbe Größe** |
| Daraus gezogener Schluss | „S-U landet bei 66,67 %, also noch **unter** dem Entdeckungswert" | 66,67 % gegen 83,52 % bei gleicher Formel — der Abstand ist **größer**, nicht kleiner | Der Schluss stimmt in der Richtung, aber er verglich zwei verschiedene Größen |

Der inhaltliche Kern des E3-Satzes hält also — er hat ihn nur mit dem falschen
Vergleichswert belegt. Das Prüffenster ist wirklich schlechter als das
Entdeckungsfenster, und zwar deutlicher als dort behauptet.

---

## 10. Neue Fragen und Hypothesen (R16)

- **E4b — Reifedefinition „anschlussfähig statt identisch".** Die Voraussetzung
  aus E3 ist erfüllt: der Kennungswechsel ist gemessen und trägt 72,6 % des
  Variantenabstands. Der Entwurf muss den Wechsel als Fortsetzung akzeptieren,
  **ohne über die Naht zu rechnen** — das ist der Punkt, an dem es schwierig
  wird, denn `Revenues` und `SalesRevenueNet` liegen nicht auf demselben Niveau.
  Protokolländerung mit eigener Präregistrierung. *Zeitschätzung: 2 Tage.*
- **E4d — Das Zensur-Kriterium nachrechnen (Befund 2).** 80 Tage je Folgequartal
  gegen die tatsächliche Meldekadenz. Rein zählend: Wie viele Erst-Ereignisse
  liegen so nah am Rand, dass vier Folgequartale rechnerisch unmöglich sind, und
  wie viele davon zählt das heutige Kriterium als „nicht zensiert"? Das ist
  **keine** Schwellenfrage, sondern die Frage, ob der Nenner die richtigen Fälle
  enthält. *Zeitschätzung: 0,5 Tage.*
- **E4e — Die Fensterkanten-Formel (Befund 1).** Zähler und Nenner der
  Auffindbarkeit behandeln zensierte Firmen ungleich. Vorschlag zur
  Entscheidung, nicht zur Ausführung: eine konsistente Fassung präregistrieren.
  Berührt die E3-Zahlen nicht (dort null zensiert). *Zeitschätzung: 0,5 Tage.*
- **Offene Frage — warum verliert S-U auch ohne Kennungswechsel mehr als S-G?**
  Im Prüffenster 16,9 % gegen 10,7 % aus den Klassen (a) und (c), im
  Entdeckungsfenster praktisch gleich (14,0 % gegen 13,9 %). Entweder ist die
  Umsatzreihe im Prüffenster zusätzlich fragmentiert, oder die Quellenwahl
  wechselt dort häufiger die Reihe. Das wäre der nächste zählende Schritt nach
  E4b. *Zeitschätzung: 1 Tag.*
- **Beobachtung ohne Etappenvorschlag:** Auch im Kontrollpool des
  Entdeckungsfensters gibt es einen frühen Kennungswechsel-Gipfel (2010:
  27 von 314 Firmen, 8,6 %) — vermutlich die XBRL-Einführungsphase. Für die
  Studie irrelevant, aber es zeigt, dass ASC 606 nicht die einzige Naht in den
  Daten ist.

---

## 11. Offene Prüfschritte — was nicht ausgeführt werden konnte

Das sind **offene Prüfschritte, keine Restrisiken**:

1. **Endtest-Fenster:** nicht angefasst (Sperrzone). Die Diagnose kennt das
   Fenster gar nicht als gültiges Argument; ein Entschlüsselungs-Aufruf wurde
   bewusst nicht gebaut. Ob die Kennungswechsel-Quote dort ähnlich liegt, ist
   damit **unbekannt** — und bleibt es bis zu Karls Entscheid.
2. **Unabhängige Nachrechnung durch den Zweitmotor:** entfällt (Codex-Kontingent
   leer). Die Zahlen sind gegen vier veröffentlichte E2/E3-Anker geankert, aber
   nicht von einem zweiten Motor nachgebaut.
3. **Welche Kennung wohin wechselt:** nicht gemessen. Die Ergebnis-Sperre
   verbietet Kennungsnamen im Ausgabe-Artefakt, und für die gestellte Frage
   („wie viele gehen verloren") wird die Richtung nicht gebraucht. Für E4b wäre
   sie nützlich und bräuchte eine erweiterte Anmeldung.
4. **Zusammenhang zwischen Klasse (c) und Firmengröße/Sektor:** nicht gemessen.
   Wäre die naheliegende nächste Frage zum geteilten Verlust, geht aber über den
   Auftrag hinaus.

---

## 12. Artefakte dieser Etappe

| Pfad | Inhalt |
|---|---|
| `scripts/studie-e4a-diagnose.py` | die Diagnose samt Selbsttest (42 Prüfungen) und eigener Ausgabe-Allowlist |
| `tests/studie-e4a-diagnose.test.js` | namentliche Auswertung des Selbsttests, W8 (Anker) und W9 (Anmeldung deckt Ausgabe) |
| `reports/studie/E4a-diagnose-pruefung-2026-08-19.json` | vollständiger Lauf-Umschlag Prüffenster (Neulauf) |
| `reports/studie/E4a-diagnose-entdeckung-2026-08-19.json` | vollständiger Lauf-Umschlag Entdeckungsfenster inkl. E2-Ankerband |
| `protocol/early-detection/2.0.0/outcome-access-ledger.json` | +6 verkettete Einträge, alle vor dem Zugriff gepusht und serverbestätigt |
| `scripts/studie-r1-serverzeit.js` | neuer Schalter `--allowlist`: ein Lauf meldet seine eigenen Ausgabefelder an, statt die versiegelte Präregistrierung zu erweitern |
