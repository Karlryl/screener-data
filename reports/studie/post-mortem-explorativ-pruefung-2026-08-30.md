# Explorative Obduktion — Wachstums-Persistenz der Folgequartale

**Lauf:** `post-mortem-explorativ-pruefung-2026-08-30` · **Fenster:** pruefung (2017–2019, Rand 2020-12-31) · **Variante:** S-G · **Perzentil:** 95
**Register:** `post-mortem-explorativ-pruefung-2026-08-30`, eventHash `69b2af0d…41246a0a`, Zweig `main` · **Autorisierung:** ENTSCHIED 45 + 53

> **PFLICHT-STEMPEL (im Register-Eintragstext gehasht):** bekannte Ueberlebens-Verzerrung, Obergrenzen-Lesart — die fehlenden 10,7 % sind **nicht zufaellig**, Verlierer verschwinden oefter. **Jede hier berichtete Rate ist eine OBERGRENZE, keine Punktschaetzung.**

> **EXPLORATIV — NIEMALS KONFIRMATORISCH.** Dieser Lauf erzeugt kein Verdikt, bewegt keine Schwelle, aendert keine Praeregistrierung und darf in keiner spaeteren Argumentation als Bestaetigung zitiert werden. Er gehoert zum Nachlass, nicht zum Verfahren (ENTSCHIED 45).

## AUF EINEN BLICK

**Auf den verfolgbaren Firmen hielt das Wachstum im Signal-Arm in 20,31 % der Faelle ueber alle vier Folgequartale — im Kontrollpool in 21,02 %. Die Differenz betraegt −0,71 Prozentpunkte, also praktisch null und mit dem falschen Vorzeichen.**

- **Signal-Arm:** 66 von 325 entscheidbaren Firmen mit durchgehender Persistenz.
- **Kontrollpool:** 893 von 4.249 entscheidbaren Firmen.
- **Der Selbst-Check traf exakt:** 326/39 (Signal) und 4.285/448 (Kontrolle) — byte-identisch zu den committeten E4a-Zahlen.
- **R4 wurde eingehalten, nicht umgangen:** gemessen wurde die Wachstums-Persistenz, **nie** Kurs, Rendite oder Preis.

**Sprungkarte:** §1 Was gefragt wurde · §2 Die Persistenz-Regel · §3 Zahlen · §4 Selbst-Check · §5 Was diese Zahlen NICHT sagen

## §1 Was gefragt wurde — und was nicht gefragt werden durfte

Karls Wunsch war, die Studie „mit den 89,3 % weiterzufuehren und die Deckung im Nachhinein auszuweisen". Die sanktionierte Form dieses Wunsches (ENTSCHIED 45) ist diese Obduktion: eine Auswertung auf jenen Firmen, die ihre vier Folgequartale tatsaechlich geliefert haben.

Die naheliegende Frage — „ist der Kurs gestiegen?" — **durfte nicht gestellt werden und wurde nicht gestellt.** R4 sperrt diese Signalfamilie dauerhaft von Kurs-, Rendite- und Preis-Endpunkten (`rules.json` R4 `endpunktSperren`: „NIE wieder — auch nicht in Folgeprotokollen, auch nicht als Sekundaerendpunkt"). Der einzige registrierte Anspruch von FEM-SEC-US@2.0.0 ist die **Wachstums-Persistenz der Folgequartale**, und genau der wurde gemessen. Der Laufzeit-Check lief gegen die authoritative Implementierung `lib/studie-verfassung.js::pruefeEndpunktKlasse` und ist bestanden; im Selbsttest wird gegengeprueft, dass derselbe Check einen Kurs- und einen Rendite-Endpunkt tatsaechlich **abweist**.

Das ist keine Ausweichfrage. Sie ist die Obduktion des eigentlichen Signal-Versprechens: Das Signal feuert auf zwei Beschleunigungsquartalen mit echtem Wachstum — die Frage „hielt dieses Wachstum?" prueft genau die Zusage, die das Signal macht.

## §2 Die Persistenz-Regel — kein neuer Knopf

**Persistenz JA** heisst: `g > 0` in **allen vier** Folgequartalen derselben Quellen-Basis.

Das ist Bedingung (c) der Signaldefinition (`studie-basisraten.py::signale` — „echtes Wachstum, kein langsameres Schrumpfen") vorwaerts gelegt, **nicht** eine neu gewaehlte Schwelle. Eine eigene Schwelle waere eine zweite Schwelle fuer dieselbe Sache — also keine.

Drei Disziplinen sind eingebaut:

| Fall | Behandlung | Warum |
| --- | --- | --- |
| Alle vier Folgequartale `g > 0` | **ja** | die Zusage hielt |
| Mindestens eines `g <= 0` | **nein** | `g == 0` ist kein Wachstum |
| Mindestens eines ohne berechenbaren `g` | **unentscheidbar** | „wir wissen es nicht" ist keine Antwort — die Firma faellt aus dem Nenner, statt als Misserfolg zu zaehlen |
| Folgequartal fremder Quellen-Basis | zaehlt **nicht** mit | der Naht-Waechter `basis_gleich` vergleicht hier wirklich |

Wuerde Unwissen als „nein" verbucht, faelschte das die Rate nach unten. Der Selbsttest haelt genau diese Unterscheidung fest.

## §3 Die Zahlen

### Arm-Ebene

| Groesse | Signal-Arm | Kontrollpool |
| --- | --- | --- |
| Erst-Ereignis-Firmen (Verfolgbarkeits-Nenner) | 365 | 4.733 |
| davon verfolgbar (reif, vier Folgequartale) | 326 | 4.285 |
| Verfolgbarkeits-Quote | 89,32 % | 90,54 % |
| unentscheidbar | 1 | 36 |
| **Persistenz-Nenner** | **325** | **4.249** |
| Persistenz ja | 66 | 893 |
| Persistenz nein | 259 | 3.356 |
| **Persistenz-Rate** | **20,31 %** | **21,02 %** |

**Differenz Signal − Kontrolle: −0,71 Prozentpunkte.**

### Folgequartals-Ebene

| Groesse | Signal-Arm | Kontrollpool |
| --- | --- | --- |
| Folgequartals-Slots (4 je verfolgbarer Firma) | 1.304 | 17.140 |
| davon mit berechenbarem `g` | 1.302 | 17.097 |
| zensiert | 2 | 43 |

Die Slot-Summe wird als Invariante nachgerechnet: verfuegbar + zensiert muss exakt vier je verfolgbarer Firma ergeben, und ja + nein + unentscheidbar muss die verfolgbaren Firmen decken. Beides haelt in beiden Armen.

## §4 Selbst-Check

Der Register-Eintrag verlangt fuer die Obduktion **keine** Populations-Sollzahl — er verlangt die Obergrenzen-Lesart. Der Konsistenz-Check gegen die committeten E4a-Zahlen lief trotzdem mit, weil eine auseinandergelaufene Rekonstruktion sonst unbemerkt bliebe:

| Arm | reif (soll/ist) | unreif (soll/ist) |
| --- | --- | --- |
| Signal | 326 / **326** | 39 / **39** |
| Kontrolle | 4.285 / **4.285** | 448 / **448** |

Quelle: `reports/studie/E4a-diagnose-pruefung-2026-08-19.json`. Bei Abweichung waere abgebrochen und **nicht** an die Sollzahl angepasst worden.

**Weitere Wachen, alle bestanden:** Siegel-Wache (Endtest-Panel byte-unveraendert, Klartext-Kopie nein, Schluessel nicht angefasst) · Manifest-Pruefung · Serverzeit-Kette (`serverConfirmedAt 2026-08-29T22:54:12Z < ersterZugriffAm`) · W9 Anmeldung-deckt-Ausgabe (14 Felder, beide Richtungen) · W3 Ausgabe-Sperre inklusive Typpruefung.

**Beruehrte Pfade:** gelesen `panel/panel-validierung.sqlite`; geschrieben `arbeit/Obduktion-pruefung-zwischenstand.sqlite`. Kein anderes Fenster, kein Schluesselmaterial, kein Endtest.

## §5 Was diese Zahlen NICHT sagen

1. **Sie sind eine Obergrenze, kein Punktwert.** Die 10,7 % nicht verfolgbaren Firmen fehlen nicht zufaellig — wer verschwindet, verschwindet oefter nach schlechten Zahlen. Die wahren Raten liegen tiefer, und zwar in beiden Armen unterschiedlich stark.
2. **Sie sind kein Verdikt.** Der Lauf entscheidet nichts, bewegt keine Schwelle und ist ausdruecklich nicht konfirmatorisch. Er darf spaeter nicht als Bestaetigung — und die negative Differenz nicht als Widerlegung — zitiert werden.
3. **Sie sagen nichts ueber Kurse.** Weder berechnet noch ausgegeben, per R4 dauerhaft ausgeschlossen.
4. **Die Differenz ist nicht auf Signifikanz geprueft.** Es wurden Zaehlungen gemeldet, keine Teststatistik, kein Konfidenzintervall, keine FDR-Korrektur — das waere konfirmatorische Arbeit und ist hier verboten.

Die ehrliche Lesart in einem Satz: **Auf dem verbrauchten Prueffenster und unter bekannter Ueberlebens-Verzerrung laesst sich kein Persistenz-Vorsprung des Signal-Arms erkennen; die beobachtete Differenz zeigt sogar minimal nach unten.**

## §6 Neue Fragen und Hypothesen (R16)

Offene Fragen, die dieser Lauf **aufgeworfen, aber nicht beantwortet** hat. Keine davon ist hier entschieden.

1. **Warum liegt die Persistenz in BEIDEN Armen bei nur rund einem Fuenftel?** „`g > 0` in allen vier Folgequartalen" ist eine harte Latte — vier Mal hintereinander positives Jahreswachstum schafft offenbar nur jede fuenfte Firma, unabhaengig vom Signal. Hypothese: die Latte misst weniger die Signalqualitaet als die allgemeine Volatilitaet von Quartalswachstum. Das waere eine Eigenschaft des Endpunkts, nicht des Signals.
2. **Verdeckt die binaere Regel einen graduellen Unterschied?** Eine Firma mit 3 von 4 positiven Folgequartalen zaehlt hier wie eine mit 0 von 4. Falls das Signal die Wachstums-*Dauer* verlaengert, ohne sie durchgehend zu machen, waere dieser Effekt in der Ja/Nein-Zaehlung unsichtbar. Ein Zaehler „Anzahl positiver Folgequartale je Firma" haette dieselbe Zaehlproben-Klasse und waere anmeldbar.
3. **Ist die Ueberlebens-Verzerrung zwischen den Armen ungleich?** Die Verfolgbarkeit liegt im Signal-Arm bei 89,32 %, im Kontrollpool bei 90,54 %. Der Signal-Arm verliert also *mehr* Firmen. Wenn dort ueberproportional die Verlierer verschwinden, ist der Signal-Arm staerker nach oben verzerrt — und die ohnehin negative Differenz waere in Wahrheit noch negativer. Diese Richtung ist begruendbar, aber nicht gemessen.
4. **Traegt die Differenz ueberhaupt Information?** −0,71pp bei 325 gegen 4.249 Firmen wurde bewusst nicht auf Signifikanz geprueft. Ohne Teststatistik laesst sich nicht sagen, ob hier ein schwacher echter Nachteil oder schlicht Rauschen steht. Die Frage gehoert in eine Praeregistrierung, nicht in eine Obduktion.
5. **Haengt die Persistenz am Feuerungs-Jahrgang?** Der Lauf aggregiert ueber 2017–2019. Ob ein Jahrgang die Rate traegt oder alle drei gleich aussehen, ist mit den angemeldeten Feldern nicht beantwortbar.

- VORSCHLAG: Gliederung der Persistenz-Zaehlung nach Feuerungs-Jahrgang und nach Anzahl positiver Folgequartale (0–4) statt binaer — eigener Register-Eintrag noetig, Aufwand rund 1 Tag.
- VORSCHLAG: Messung der armweisen Verfolgbarkeits-Differenz als eigene Verzerrungs-Sonde, damit Punkt 3 belegt statt vermutet wird — Aufwand rund 2 Tage.
