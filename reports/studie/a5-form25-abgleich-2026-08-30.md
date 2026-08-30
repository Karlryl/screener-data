# A.5-Annex — Abgleich der Abgaenge gegen die lokale Form-25-Evidenz

**Lauf:** `a5-form25-abgleich-2026-08-30` · **Fenster:** pruefung (2017–2019, Rand 2020-12-31) · **Variante:** S-G · **Perzentil:** 95
**Register:** `a5-form25-abgleich-2026-08-30`, eventHash `af9fa8d9…fdd88fbee`, Zweig `main` · **Autorisierung:** ENTSCHIED 38 + 54

> **PFLICHT-STEMPEL (im Register-Eintragstext gehasht):** bekannte Ueberlebens-Verzerrung, Obergrenzen-Lesart — die fehlenden 10,7 % sind **nicht zufaellig**, Verlierer verschwinden oefter. **Jede hier berichtete Rate ist eine OBERGRENZE, keine Punktschaetzung.**

> **FORM 25 IST KEIN TODESBELEG.** Der Gegenbeleg 25-NSE bei lebender Firma gilt unveraendert. Form 25 meldet das Delisting eines **Wertpapiers von einer Boerse**, nicht das Ende einer Firma. Dieser Lauf liefert **Ereignis-Evidenz, keine Zustands-Aussage**, und darf nicht als Abgangs-Bestaetigung gelesen werden.

> **EXPLORATIV — NIEMALS KONFIRMATORISCH.** Beschreibender **Annex** zum R15a-Abschluss, ausdruecklich **nicht** dessen Bedingung (ENTSCHIED 38). Kein Verdikt, keine Schwelle, keine Praeregistrierung.

## AUF EINEN BLICK

**Der bindende Selbst-Check traf exakt: 8 Abgaenge im Signal-Arm, 172 im Kontrollpool. Von den 8 Signal-Abgaengen tragen 3 eine Form-25-Zeile im plausiblen Fenster (37,5 %), von den 172 Kontroll-Abgaengen 30 (17,4 %).**

- **Kein einziger Fall unentscheidbar** — der Evidenz-Cache (2016-01-04 bis 2024-12-31) deckt jedes plausible Fenster vollstaendig.
- **7 Firmen** tragen Form-25-Zeilen ausschliesslich **ausserhalb** ihres Fensters (1 Signal, 6 Kontrolle) — ausgewiesen, nie gefiltert.
- **Join-Deckung belegt:** 1.866 der 6.123 Panel-CIKs kommen im Cache vor — der Abgleich ist verdrahtet, null Treffer waeren ein Befund gewesen und kein Formatfehler.
- **Die Mehrheit der Abgaenge traegt gar keine Form 25** (5 von 8 bzw. 142 von 172).

**Sprungkarte:** §1 Population · §2 Fenster & Quellen · §3 Zahlen · §4 Selbst-Check · §5 Was das NICHT heisst

## §1 Die Population — importiert, nicht nachgebaut

„Abgang" heisst hier eng und genau: eine Firma, die nach ihrem Signal-Melde-Zeitpunkt **gar keine Zeile mehr** einreicht — in keiner Form, auch kein 8-K, kein S-1. Das ist E4gs strengste Lesart (`letzte_form_nach_signal = "keine"`).

Die Funktion `formularregime` wird aus `scripts/studie-e4g-restursachen.py` **importiert**, nicht nachgebaut — dieselbe Grenze, dieselbe Definition. Nur deshalb kann der Bit-Anker ueberhaupt treffen: ein Nachbau haette die Population auseinanderlaufen lassen.

## §2 Das plausible Fenster und die zwei Quellen

**Fenster = Melde-Zeitpunkt des Signals + 4 × 91,25 Tage = 365 Tage.** Beide Faktoren sind eingefroren uebernommen (`REIFE_QUARTALE` aus `studie-basisraten.py`, `FISKALQUARTAL_TAGE` aus `studie-e4g-restursachen.py`); hier wird **keine dritte Zahl erfunden**. Es ist genau das Fenster, in dem die vier fehlenden Folgequartale haetten liegen muessen.

Treffer ausserhalb werden **ausgewiesen, nie gefiltert** — dieselbe Disziplin wie im D2-Bericht.

**Zwei Quellen, beide lokal, kein Netzzugriff:**

| Quelle | Inhalt |
| --- | --- |
| Panel-Datei des verbrauchten Prueffensters | Input-Scope woertlich der E4a-Registrierung und des E4g-v2-Eintrags |
| Form-25-Evidenz-Cache | `d2-nachernte-2026-08-30.jsonl` + `d2-2016-2018-2026-08-30.jsonl`, Union 2016–2024, **9.028 Accessions**, 4.281 CIKs |

Der Cache ist ein **lokaler Bestand** aus dem `submissions.zip`-Re-Harvest — keine neue externe Quelle, kein Fetch. Damit ist der in der A.5-Eskalation geruegte Scope-Bruch „neue Quelle" geschlossen. Der Lauf prueft die Accession-Zahl gegen die angemeldeten 9.028 und bricht bei Abweichung ab: ein anderer Bestand waere eine andere Quelle.

Gelesen werden aus dem Cache ausschliesslich `cik` und `filingDate`. Accession-Nummern, Formtypen und Wertpapier-Beschreibungen werden nicht uebernommen.

## §3 Die Zahlen

### Arm-Ebene

| Groesse | Signal-Arm | Kontrollpool | Gesamt |
| --- | --- | --- | --- |
| **Abgaenge (Fallzahl)** | **8** | **172** | **180** |
| mit Form-25-Treffer im Fenster | 3 | 30 | 33 |
| ohne Form-25-Treffer im Fenster | 5 | 142 | 147 |
| unentscheidbar | 0 | 0 | 0 |
| Nenner | 8 | 172 | 180 |
| **Trefferquote** | **37,50 %** | **17,44 %** | 18,33 % |
| davon: Treffer nur ausserhalb des Fensters | 1 | 6 | 7 |

### Je Signaljahr

**Signal-Arm**

| Jahr | Fallzahl | mit Treffer | ohne | ausserhalb | Trefferquote |
| --- | --- | --- | --- | --- | --- |
| 2017 | 2 | 0 | 2 | 0 | 0,00 % |
| 2019 | 6 | 3 | 3 | 1 | 50,00 % |

**Kontrollpool**

| Jahr | Fallzahl | mit Treffer | ohne | ausserhalb | Trefferquote |
| --- | --- | --- | --- | --- | --- |
| 2017 | 109 | 21 | 88 | 5 | 19,27 % |
| 2018 | 41 | 4 | 37 | 0 | 9,76 % |
| 2019 | 22 | 5 | 17 | 1 | 22,73 % |

Der Signal-Arm hat kein Abgangs-Jahr 2018. Bei 8 Faellen insgesamt und 2 bzw. 6 je Jahr traegt **keine** dieser Quoten statistisches Gewicht — sie sind Beschreibung, nicht Messung.

## §4 Selbst-Check und Wachen

**Der bindende Bit-Anker (im Eintragstext gehasht):**

| Arm | Soll | Ist | |
| --- | --- | --- | --- |
| Signal | 8 | **8** | ✅ |
| Kontrollpool | 172 | **172** | ✅ |

Quelle: `reports/studie/E4g-restursachen-diagnose-2026-08-29.json`, `letzte_form_nach_signal = "keine"`. Jede Abweichung waere ein Sofort-Stopp mit Eskalation gewesen — kein Weiterrechnen, keine Anpassung an die Sollzahl, keine zweite Variante. Der Selbsttest prueft, dass 7, 9 und 171 tatsaechlich abbrechen.

**Der Stille-Null-Waechter.** Die gefaehrlichste Fehlerklasse dieses Laufs waere ein CIK-Formatbruch zwischen den beiden Quellen: der Join liefert null Treffer, und null Treffer liest sich wie ein Befund („keine der Abgangsfirmen hat eine Form 25"). Der Waechter prueft deshalb nicht die 180 Abgaenge, sondern die **gesamte** Panel-Population gegen den Cache — **1.866 von 6.123 Panel-CIKs** kommen dort vor. Bei null Ueberschneidung waere abgebrochen worden.

**Deckungs-Ehrlichkeit.** Ragt das plausible Fenster einer Firma ueber den Cache-Bestand hinaus, gilt sie als **unentscheidbar**, nicht als „ohne Treffer" — ein fehlender Bestand ist kein Beleg fuer ein fehlendes Ereignis. Hier trat der Fall null Mal ein, weil der Cache das gesamte Band deckt.

**Weitere Wachen, alle bestanden:** Siegel-Wache (Endtest-Panel byte-unveraendert, kein Schluesselzugriff) · Manifest-Pruefung · Serverzeit-Kette (`serverConfirmedAt 2026-08-29T23:01:30Z < ersterZugriffAm`) · W9 Anmeldung-deckt-Ausgabe (11 Felder, beide Richtungen) · W3 Ausgabe-Sperre mit Typpruefung (CIK oder Accession-Nummer in der Ausgabe bricht ab).

## §5 Was das NICHT heisst

1. **Kein Todesbeleg.** Eine Form 25 im Fenster belegt ein Delisting-**Ereignis**, keinen Firmen-Tod. Umgekehrt belegt eine fehlende Form 25 kein Ueberleben: die Firma kann ueber einen Merger verschwunden sein, nie boersennotiert gewesen sein oder von einer anderen Partei gemeldet worden sein.
2. **Die Differenz 37,5 % zu 17,4 % ist keine Messung.** Acht Faelle. Ein einziger Fall verschiebt die Signal-Quote um 12,5 Punkte. Es wurde keine Teststatistik gerechnet und keine gerechnet werden duerfen.
3. **Der Annex ist nicht die Bedingung des R15a-Abschlusses** (ENTSCHIED 38) — er beschreibt, er entscheidet nicht.
4. **Obergrenzen-Lesart bleibt.** Die Abgangs-Population selbst ist das Ergebnis der Ueberlebens-Verzerrung, die den ganzen Befund traegt.

Die ehrliche Lesart in einem Satz: **Fuer rund ein Sechstel bis gut ein Drittel der echten Abgaenge findet sich im plausiblen Fenster eine Form-25-Zeile — die Mehrheit verschwindet ohne jede Delisting-Spur, und was gefunden wurde, ist Ereignis-Evidenz und kein Todesbeleg.**

## §6 Neue Fragen und Hypothesen (R16)

Offene Fragen, die dieser Lauf **aufgeworfen, aber nicht beantwortet** hat. Keine davon ist hier entschieden.

1. **Warum traegt die Mehrheit der Abgaenge gar keine Form 25?** 147 von 180 Firmen verschwinden ohne Delisting-Zeile im Fenster. Drei Hypothesen, alle ungeprueft: (a) die Firma war nie an einer US-Boerse gelistet, die eine Form 25 verlangt; (b) sie verschwand per Merger, wo der Erwerber meldet und die Zeile unter dessen CIK laeuft; (c) sie meldete schlicht weiter nichts mehr, ohne formales Delisting. (b) waere mit dem bereits gebauten Ereignis-Aufloeser pruefbar.
2. **Ist die CIK die richtige Join-Achse?** Der D2-Bericht weist einen Split zwischen Emittenten-Seite und Eigenkopie des Einreichers aus (Accession-Praefix = CIK des Einreichers). Dieser Lauf joint ausschliesslich ueber das `cik`-Feld der Zeile. Wenn ein Teil der Abgaenge nur unter dem Einreicher-CIK auftaucht, ist die Trefferquote nach unten verzerrt — die Richtung ist bekannt, die Groesse nicht.
3. **Ist der Unterschied 37,5 % zu 17,4 % irgendetwas?** Acht Faelle im Signal-Arm. Ein einziger Fall bewegt die Quote um 12,5 Punkte. Die Frage, ob Signal-Firmen anders *aussteigen* als Kontrollfirmen, ist interessant und mit dieser Fallzahl nicht beantwortbar.
4. **Ist das 365-Tage-Fenster zu eng?** 7 Firmen tragen Form-25-Zeilen ausschliesslich ausserhalb. Ein Delisting-Verfahren kann sich ueber Quartale ziehen; ein breiteres Fenster faende mehr, kaufte sich das aber mit mehr Zufallstreffern ein. Die Fenstergroesse ist bewusst aus eingefrorenen Konstanten abgeleitet und wurde NICHT auf die Trefferquote optimiert — jede Nachjustierung waere genau die verbotene Anpassung ans Ergebnis.
5. **Fehlt 2018 im Signal-Arm zufaellig?** Der Signal-Arm hat Abgaenge nur 2017 (2) und 2019 (6). Ob das Struktur oder Zufall ist, traegt die Fallzahl nicht.

- VORSCHLAG: Join zusaetzlich ueber den Einreicher-CIK und Ausweis beider Quoten nebeneinander, um Punkt 2 zu schliessen — eigener Register-Eintrag noetig, Aufwand rund 1 Tag.
- VORSCHLAG: Sensitivitaets-Ausweis der Trefferquote ueber mehrere Fenstergroessen, vorab festgelegt und vollstaendig berichtet statt selektiv — Aufwand rund 1 Tag.
