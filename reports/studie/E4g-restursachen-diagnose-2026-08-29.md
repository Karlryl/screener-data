# E4g — Restursachen-Diagnose der S-G-Verluste (Prüffenster 2017–2019)

**Lauf-ID** `e4g-restursachen-pruefung-v2-2026-08-29` · **Fenster** `pruefung` ·
**Variante** S-G · **Panelrand** 2020-12-31 · **Perzentil** 95
**Register-Eintrag** `4183c3419b3f22def55207c26273507c0d99601c00b267399eb934b74d148207`
(17. Eintrag, `count_only_probe_authorized`, main-first vor dem Zugriff angemeldet)
**Auftrag** T171 · ENTSCHIED 1 + 17 + 26 (orchestrator-2026-08-29.md)
**Maschinen-Ausgabe** `reports/studie/E4g-restursachen-diagnose-2026-08-29.json`
**Freigabe-Beleg** `reports/studie/E4g-v2-freigabe-pruefung-2026-08-29.json`

> **Dieser Bericht entscheidet NICHTS.** Die Entscheidungsregel steht VORAB
> eingefroren in orchestrator-2026-08-29.md, ENTSCHIED 2 — geschrieben vor
> Kenntnis dieser Zahlen. Sie wird vom Orchestrator angewandt, nicht hier.

---

## 0. Selbst-Check (Bit-Anker, im Register-Eintragstext gehasht) — BESTANDEN

Die Rekonstruktion der eingefrorenen E4a-Klassenpopulation musste exakt die
committeten E4a-Zahlen ergeben. Jede Abweichung wäre ein Sofort-Stopp gewesen.

| Größe | Soll (E4a, committet) | Ist (dieser Lauf) |
| --- | --- | --- |
| S-G Signal-Verluste | 39 | **39** |
| S-G Kontrollpool-Verluste | 448 | **448** |
| S-G Signal-Fallzahl (Gegenanker) | 326 | **326** |
| S-G Kontrollpool-Fallzahl (Gegenanker) | 4285 | **4285** |

Quelle der Sollwerte: `reports/studie/E4a-diagnose-pruefung-2026-08-19.json`,
Band 2017-2019, Variante S-G. Die Fallzahl läuft als **zweiter, unabhängiger**
Anker mit: eine Rekonstruktion, die zufällig 39 Verluste bei falscher Population
liefert, fällt daran auf. Beide Anker sind im Code hart gepinnt
(`scripts/studie-e4g-restursachen.py::pruefe_anker`); die Selbsttest-Sabotagen
38/40/39-bei-327/447 feuern nachweislich.

Gelesen wurde ausschließlich `panel/panel-validierung.sqlite` — die Panel-Datei
des angemeldeten, bereits **verbrauchten** Prüffensters, dieselbe Quelle wie E4a.
Geschrieben wurde ausschließlich der eigene Zwischenstand unter `arbeit/`. Das
Endtest-Siegel ist unberührt (Siegel-Wache: Klartext-Kopie nein, Schlüssel nicht
angefasst, SHA-256 geprüft). Kein anderes Fenster, kein Schlüsselmaterial, keine
Naht-ID des Brücken-Artefakts, keine Firmen-Kennung.

---

## 1. Die exakte Operationalisierung (Offenlegungspflicht)

### Sonde 1 — KANTENPROBE, alles auf der ACCEPTED-Achse

```
melderhythmus  = max( Median{ accepted(q_i+1) − accepted(q_i) } , 365/4 )
                 über alle Quartale q der GEWÄHLTEN Reihe mit ddate(q) ≤ ddate(Signal)
kantenfenster  = 4 × melderhythmus
restlaufzeit   = ordinal(2020-12-31) − ordinal(accepted(Signal))
kante_unmoeglich  ⇔  kantenfenster > restlaufzeit
```

* **Achse:** accepted auf BEIDEN Seiten. Das ist der ganze Zweck von T171 — E4d
  bildete den Median über `ddate` und ankerte die Zensur auf `accepted`;
  Meldeverzug fiel dadurch durch den Rost.
* **Zensur-Anker:** `accepted` des Signals gegen den Panelrand 2020-12-31, exakt
  wie E3/E4d (`studie-e4d-kadenz.py::abstand_zum_rand`).
* **Schwellenwerte:** Reifeschwelle 4 Folgequartale (unverändert aus
  `studie-basisraten.py::REIFE_QUARTALE`), Untergrenze des Melderhythmus
  365/4 = 91,25 Tage — **wortgleich** aus E4d übernommen
  (`studie-e4d-kadenz.py::FISKALQUARTAL_TAGE`, begründet über SEC Exchange Act
  Rule 13a-13 + 13a-1). Es wurde KEINE zweite Untergrenze gewählt.
* **Kein Vorgriff (R11):** Nur Quartale VOR dem Signal gehen in den Rhythmus ein.
  Der Selbsttest prüft das direkt (ein nachgeschobenes Quartal darf die Kadenz
  nicht ändern).

### ⚠ ABWEICHUNG ZUR MESSTECHNIKER-LESART — ausdrücklich benannt

Die Vormessung des Messtechnikers (orchestrator-2026-08-29.md, Stimme 3) nannte
„10 der 30 (c)-Firmen liegen unter **728 Tagen** Restlauf". Das ist ein **fester
Maßstab** (2 Jahre bzw. 8 Quartale). Die registrierte Kantenprobe ist dagegen
**firmenindividuell**: 4 × der EIGENE gemessene Melderhythmus. Für einen
Quartalsmelder sind das 4 × 91,25 = **365 Tage**, nicht 728.

Beide Lesarten wurden am selben Lauf gemessen. Ich habe **nicht** in Richtung
einer erwarteten Zahl harmonisiert; die registrierte Lesart steht im JSON, die
alternative Lesart steht hier als Offenlegung:

| Lesart | Signalarm (von 39) | Kontrollpool (von 448) |
| --- | --- | --- |
| **REGISTRIERT:** 4 × eigener Melderhythmus > Restlaufzeit | **0** | **0** |
| Fester 728-Tage-Maßstab: Restlaufzeit < 728 Tage | 16 | 49 |

**Warum die registrierte Lesart 0 ergibt — gemessen, nicht behauptet:**
Alle 39 Signal-Verluste melden vor ihrem Signal quartalsweise; ihr gemessener
Median-Abstand liegt bei **allen 39** auf der Untergrenze 91,25 Tage (im
Kontrollpool bei 443 von 448; 5 liegen knapp darüber, max. 92,5 Tage). Das
Kantenfenster ist damit praktisch durchgehend 365 Tage. Die kürzeste gemessene
Restlaufzeit im Signalarm beträgt 413 Tage; das engste Verhältnis
Kantenfenster/Restlaufzeit ist **0,884** — die knappste Firma hatte noch rund
12 % Luft. Das ist **kein Messer-auf-der-Kippe-Ergebnis**, sondern deutlich.

Strukturell dahinter: das Signalband endet auf der Anmelde-Achse am 2019-12-31,
der Panelrand liegt am 2020-12-31. Die minimal mögliche Restlaufzeit im Band ist
damit 366 Tage — gegen 365 Tage Kantenfenster eines Quartalsmelders. **Ein
Quartalsmelder kann in diesem Band bauartbedingt kaum kantenunmöglich werden.**
Das ist eine Eigenschaft des Bandzuschnitts, keine Eigenschaft der Firmen, und
sie gehört in jede Auslegung dieser Null.

### Sonde 2 — FORMULARREGIME nach dem Signal

Aus derselben `bericht`-Tabelle, je Firma alle Zeilen mit
`accepted > accepted(Signal)`:

* `ohne_zeile_nach_signal` — **gar keine Zeile mehr, in KEINER Form** (auch kein
  8-K, kein S-1). Strengste Lesart von „echter Abgang".
* `jahreskadenz` — periodische Zeilen ja, aber **kein 10-Q mehr**; nur noch
  10-K/20-F/40-F. Die Firma lebt, kann vier FolgeQUARTALE aber bauartbedingt
  nicht liefern.
* `letzte_form_nach_signal` — Formstamm der spätesten Zeile nach dem Signal,
  über ALLE Formen. Eine Firma, die nur noch 8-K meldet, steht damit sichtbar
  zwischen „lebt" und „weg" — sie zählt weder als Abgang noch als Jahreskadenz.

**Grenze, hier benannt statt versteckt:** Das Panel endet am Rand. „Keine Zeile
mehr" heißt „keine Zeile mehr **bis 2020-12-31**", nicht „nie wieder".

### Sonde 3 — afs-GRUPPE (Gegenprobe zu D2)

`afs` der **frühesten periodischen** Zeile der Firma (Eintritts-Konvention),
Zuordnung wortgleich aus `scripts/studie-attrition-size-sector.py`:
1-LAF/2-ACC → `larger`, 3-SRA/4-NON/5-SML → `smaller`, leer/unbekannt →
eigene Klasse (**keine** stille Zuordnung).

---

## 2. Signalarm — die 39 Verluste

| Größe | Wert |
| --- | --- |
| `nenner_restursachen` (Verluste) | **39** |
| `fallzahl` (reife Firmen, Gegenanker) | 326 |
| `klasse_a_keine_folgequartale` | 9 |
| `klasse_c_zu_wenige_folgequartale` | 30 |
| `kante_unmoeglich_ja` / `_nein` | **0** / 39 |
| `jahreskadenz_ja` / `_nein` | **2** / 37 |
| `ohne_zeile_nach_signal` | **8** |
| `median_abstand_accepted_tage` | 91,25 |
| `kantenfenster_accepted_tage` | 365,0 |
| `restlaufzeit_accepted_tage` (Median) | 902,0 |
| `letzte_form_nach_signal` | 10-Q 25 · keine 8 · 10-K 4 · 8-K 2 |
| `afs` | 5-SML 19 · 2-ACC 12 · 1-LAF 5 · 4-NON 3 |
| `afs_gruppe` | smaller 22 · larger 17 |

### Die zwei entscheidungsrelevanten Zahlen

* **kantenunmöglich ODER Jahreskadenz: 2 von 39.** (0 ∪ 2; die Mengen sind
  disjunkt, weil die Kantenprobe niemand trifft.)
* **Echte Abgänge — gar keine Zeile mehr nach dem Signal: 8 von 39.**

**Schwellennähe (Auflage 2):** Die eingefrorene Schwelle liegt bei ≥ 10.
Der gemessene Wert **2** liegt **8 unter** der Schwelle — also **NICHT** im
±2-Band um 10. In der alternativen 728-Tage-Lesart läge die Vereinigung dagegen
bei 16 + 2 − (Überschneidung) und damit **über** der Schwelle. Die Wahl der
Lesart ist damit die entscheidende Weiche; sie liegt beim Orchestrator, nicht
hier.

### Die restlichen 29

25 Firmen reichen nach ihrem Signal weiterhin **10-Q** ein, 2 weiterhin 10-K
(ohne Jahreskadenz, d. h. mit mindestens einem 10-Q dazwischen), 2 nur noch 8-K.
Sie leben, melden quartalsweise weiter — und liefern der gewählten Reihe trotzdem
keine vier auswertbaren Folgequartale.

Ein Fall verdient eine eigene Zeile: **eine Klasse-(a)-Firma reicht nach dem
Signal weiter 10-Q ein.** Klasse (a) heißt „die gewählte Reihe endet mit dem
Ereignis" — die Firma meldet also, nur trägt ihre Meldung keinen auswertbaren
`OperatingIncomeLoss` mehr. Von den 9 Klasse-(a)-Firmen sind **8 echte Abgänge**
und **1 ein Zählerverlust bei lebender Firma**.

---

## 3. Kontrollpool — die 448 Verluste (Gegenprobe, gleicher Code)

| Größe | Wert |
| --- | --- |
| `nenner_restursachen` | **448** |
| `fallzahl` | 4285 |
| `klasse_a_keine_folgequartale` | 165 |
| Klasse (b), Kennungswechsel (Etikett `b` in der Zeilentabelle) | 1 |
| `klasse_c_zu_wenige_folgequartale` | 282 |
| `kante_unmoeglich_ja` / `_nein` | **0** / 448 |
| `jahreskadenz_ja` / `_nein` | **53** / 395 |
| `ohne_zeile_nach_signal` | **172** |
| `median_abstand_accepted_tage` | 91,25 |
| `kantenfenster_accepted_tage` | 365,0 |
| `restlaufzeit_accepted_tage` (Median) | 1143,0 |
| `letzte_form_nach_signal` | 10-Q 192 · keine 172 · 10-K 61 · 8-K 17 · S-1 3 · 20-F 1 · 6-K 1 · S-4 1 |
| `afs` | 5-SML 251 · 2-ACC 66 · 4-NON 66 · 1-LAF 65 |
| `afs_gruppe` | smaller 317 · larger 131 |

**Der Kontrollpool verhält sich qualitativ anders**: 38,4 % echte Abgänge
(172/448) gegen 20,5 % im Signalarm (8/39), und 11,8 % Jahreskadenz (53/448)
gegen 5,1 % (2/39). Die Signalfirmen sind also **lebendiger** als der
Kontrollpool — was gegen „die S-G-Signalfirmen verschwinden einfach" spricht.

Der Register-Eintrag benennt Zähler nur für die Klassen (a) und (c). Die EINE
Klasse-(b)-Firma des Kontrollpools (E4a hat diese Zahl bereits veröffentlicht)
fällt deshalb nicht unter den Tisch, sondern steht als Etikett `b` in der
Zeilentabelle des JSON — die Zerlegung geht auf 448 auf.

---

## 4. BEIDE Nenner (Auflage 3 — die bequeme Richtung)

Zensur leert den Nenner und hebt die Quote, **ohne dass eine einzige Firma
zusätzlich gefunden würde**. Deshalb hier beide Seiten, für jede Lesart:

| Lesart | Zähler | Nenner | Auffindbarkeit S-G Signal |
| --- | --- | --- | --- |
| E4a/E3, committet (0 zensiert) | 326 | 365 | 89,32 % |
| 2 Jahreskadenz-Firmen als zensiert | 326 | 363 | 89,81 % |
| REGISTRIERTE Kantenprobe (0 kantenunmöglich) | 326 | 365 | 89,32 % — **unverändert** |
| Fester 728-Tage-Maßstab (16 zensiert) | 326 | 349 | 93,41 % |

Tor: 90 % bzw. 329/365 = 90,14 %.

* Unter der **registrierten** Lesart bewegt sich der Nenner um **null** Firmen;
  89,32 % bleibt stehen, das Tor bleibt gerissen.
* Selbst wenn man beide Jahreskadenz-Firmen als zensiert herausnähme, blieben
  89,81 % — **immer noch unter 90 %**.
* Der feste 728-Tage-Maßstab hebt die Quote in EINEM Schritt auf 93,41 % und
  über das Tor — **allein durch Nennerleerung**, ohne eine einzige zusätzlich
  aufgefundene Firma. Genau diese Richtung ist die bequeme; sie steht hier
  ausdrücklich als Warnung, nicht als Vorschlag.

Kontrollpool zum Vergleich: 4285/4733 = 90,53 % committet · 4285/4680 = 91,56 %
ohne die 53 Jahreskadenz-Firmen · 4285/4684 = 91,48 % unter dem 728-Tage-Maßstab.

Die Quoten dieser Tabelle sind **Arithmetik über bereits committete E4a-Zahlen
plus die Zähler dieses Laufs** — sie sind KEIN Ausgabefeld dieses Laufs und
stehen bewusst nicht im JSON (dessen Ausgabe-Allowlist umfasst exakt die 20
registrierten Felder).

---

## 5. Neue Fragen und Hypothesen (R16)

Offene Fragen, die dieser Lauf AUFGEWORFEN, aber nicht beantwortet hat. Keine
davon ist hier entschieden; sie gehören vor den Orchestrator.

1. **Welche Kanten-Lesart gilt?** Die registrierte (4 × eigener Melderhythmus)
   trifft 0 von 39, ein fester 728-Tage-Maßstab trifft 16 von 39. Beide messen
   auf derselben Achse dieselbe Population; sie unterscheiden sich nur darin, ob
   der Maßstab firmenindividuell oder fest ist. Die Weiche der Studien-
   Fortsetzung hängt an dieser Wahl.
2. **Ist der Bandzuschnitt selbst der Befund?** Minimal mögliche Restlaufzeit im
   Band 366 Tage gegen 365 Tage Kantenfenster eines Quartalsmelders — das
   Pufferjahr ist exakt so breit wie die Reifeanforderung, mit einem Tag Luft.
   Hypothese: die Kantenprobe ist in diesem Bandzuschnitt strukturell nahezu
   nicht auslösbar; ein Fenster mit schmalerem Puffer würde sie sofort auslösen.
   Das ist eine Eigenschaft des Designs, nicht der Daten.
3. **Warum verliert der Zähler lebende Quartalsmelder?** 25 der 39 reichen nach
   dem Signal weiter 10-Q ein und liefern der gewählten Reihe trotzdem keine
   vier auswertbaren Folgequartale — darunter eine Klasse-(a)-Firma, deren
   gewählte Reihe mit dem Ereignis endet, obwohl sie weiter meldet. Hypothese:
   ein Teil der 30 Klasse-(c)-Fälle ist kein Firmen-Ereignis, sondern eine
   Lücke in der Quellenwahl (`OperatingIncomeLoss` fehlt oder ist in einer
   Fassung nicht auswertbar). Prüfbar wäre das nur mit einer Zählprobe auf der
   Quellen-Ebene — eine EIGENE Anmeldung, nicht in diesem Scope.
4. **Ist die Jahreskadenz systematisch?** 2/39 im Signalarm gegen 53/448 im
   Kontrollpool. Wenn Jahresmelder überhaupt nie vier Folgequartale liefern
   können, ist ihre Aufnahme in den Nenner eine Definitionsfrage, keine
   Datenfrage — und sie trifft den Kontrollpool fünfmal härter als den
   Signalarm.
5. **Warum sind die Signalfirmen lebendiger als der Kontrollpool?** 20,5 %
   echte Abgänge gegen 38,4 %. Das ist die Gegenrichtung zur naheliegenden
   Erwartung („die Verlierer verschwinden") und bislang unerklärt.

## 6. Was dieser Lauf nicht getan hat

Keine Entscheidung, keine neue Klassendefinition, keine Schwellen- oder
Reifeänderung, keine neue Präregistrierung, kein Ledger-Append, kein
Siegel-Kontakt, kein anderes Fenster, kein Endtest, keine Firmen-Kennung, kein
Umsatz-/Gewinn-/Aktienzahl-/Kurswert, keine Naht-ID des Brücken-Artefakts. Der
Lauf startete aus einem frischen Worktree von `origin/main` (Post-#93-Stand,
17-Einträge-Kette), damit Erzeuger UND Verbraucher an die gültige Registerkette
binden; der Studienzweig bekommt den main-Ledger nicht.
