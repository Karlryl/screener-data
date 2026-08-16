# E0 Ratifizierung — Entscheidungsreport

**Datum:** 2026-08-16 · **Protokoll:** FEM-SEC-US@2.0.0 · **Branch:** studie/e0-ratifizierung
**Grundlage:** Neue Verfassung der Early-Detection-Studie, 2026-08-16 (Karl-Freigabe 16.08.)

---

## Was rausgekommen ist

1. **Der Alt-Apparat ist stillgelegt, nichts ist gelöscht.** Der Stilllegungs-Record führt
   14 Beweisartefakte mit ihrem **Inhalts-Hash** und ihrem Fundort (Branch
   `codex/early-detection-v4-gates-20260810`, Commit `2f8a20d97e`, Tag 925). Über den Hash
   fällt auch ein *umbenanntes* oder *überschriebenes* Artefakt auf, nicht nur ein
   gelöschtes. Die Liste selbst ist per Mengen-Digest gebunden: still einen Eintrag
   streichen geht nicht.
2. **Die Herkunftskette des 41-GB-Speichers ist geschlossen.** Alle 127 Roh-Payloads
   (7,54 GB) wurden **gegen die Dateien nachgehasht**, nicht aus dem alten Bericht
   abgeschrieben; jeder trägt Abruf-URL, Archiv-URL und Stand-Kennung. Die drei
   Bau-Skripte sind mit-versiegelt.
3. **Der Neubau funktioniert nachweislich.** Quartal 2009q1 wurde aus seinem Roh-Payload
   neu gebaut: Zeilenzahlen und alle fünf Zeilen-Digests treffen die versiegelten Werte
   exakt. Derselbe Lauf gegen einen absichtlich veränderten Payload ist rot geworden.
4. **Die 17 Regeln sind scharf geschaltet** — neun davon heute wirksam, acht mit Etappe
   *und* Artefakt benannt, an dem sie scharf werden. Keine Regel steht unbewacht da.
5. **Die Vorwärts-Mitschrift läuft ab heute** im Tageslauf und schreibt ihre eigenen
   Lücken mit. Ab jetzt tickt die Zukunfts-Evidenz.

## Warum so entschieden

- **Hashes statt Pfade.** Ein Pfad beweist nichts; nach einem Umbenennen sähe eine
  Pfadliste weiter gesund aus. Der Inhalts-Hash ist die einzige Aussage, die den
  Zeitablauf überlebt.
- **Reproduzierbar statt transportierbar.** „Jeder Motor kann mit einer Kopie
  weiterarbeiten" wäre bei 41 GB eine Schutzbehauptung. Der Daten-Vertrag (2,5 KB) hält
  Prüfsumme, Zeilenzahlen und Neubau-Rezept; der Speicherort kommt aus
  `EARLY_DETECTION_DATA_ROOT`, nicht aus einem fest verdrahteten Pfad.
- **Wächter nur dort, wo es ein Objekt zum Festnageln gibt.** Ein Report-Validator für
  einen Report, den es noch nicht gibt, wäre Zeremonie — genau die Krankheit der
  Altanlage. Deshalb steht bei jeder vertagten Regel die Etappe *und* das Artefakt.
- **Die Mitschrift protokolliert Beobachtungs-Stände, keine Signale.** Die Signalfamilie
  friert erst E2/E3 ein. Würde heute schon „ein Signal" mitgeschrieben, wäre der
  Vorwärtstest in 12 Monaten wertlos, weil das Signal nachträglich gewählt worden wäre.

## Woran verifiziert

**52 Wachtest-Fälle in 9 Dateien, alle grün** (47 beim Bau, 5 aus der Gegenrede-Runde) (`node --test tests/studie-*test.js`).
Jeder Wächter prüft in beide Richtungen: die gültige Form muss durchgehen, die kaputte
auffliegen.

**Die fünf evidenztragenden Wächter wurden einmal absichtlich ausgebaut und mussten rot
werden** — wörtliche Ausgabe:

| Regel | Ausgebaut | Ergebnis |
|---|---|---|
| R1 | Prüfung „Anmeldung vor Zugriff" entfernt | `✖ R1: Anmeldung NACH dem Zugriff ist kein Register, sondern ein Alibi` → `AssertionError: Missing expected exception.` (1 von 6 rot) |
| R2 | Fenstergrenzen-Prüfung entfernt | `✖ R2: Testfenster-Anfrage im Entdeckungs-Modus wirft` und `✖ R2: die Pufferjahre gehoeren keinem Fenster` → `Pufferjahr 2016 ist im Fenster entdeckung erreichbar — Reifebereinigung kaputt` (2 von 6 rot) |
| R4 | Anmeldungs-Prüfung beim Ergebnis-Lesen entfernt | `✖ R4: ein nicht angemeldeter Lauf kommt an keine Ergebnisdaten` und `✖ R4: ein fremder Register-Eintrag schaltet den eigenen Lauf nicht frei` (2 von 5 rot) |
| R6 | Vintage-Filter entfernt (Zukunftsstand erlaubt) | `✖ R6: ein Stand aus der Zukunft wird nie gewaehlt` → `Eine Sekunde vor Veroeffentlichung ist der Stand noch nicht da` (4 von 5 rot) |
| R13 | Hash-Prüfung der Bau-Skripte entfernt | `✖ Herkunfts-Pruefer faellt bei jedem absichtlichen Bruch um (self-test)` → `self-test: Bruch 'bau_skript_veraendert' blieb unentdeckt` (1 von 6 rot) |

Nach jeder Probe wurde der Ausbau zurückgenommen; der Arbeitsbaum ist wieder grün.

**Nachtrag 16.08. — externe Gegenrede (7 Befunde, alle reproduziert vor dem Fix).**
Ein Review von außen hat einen KRITISCHEN und sechs mittlere Befunde gebracht. Sechs
davon sind behoben (Tags 935/936/937), einer bestritten. Die fünf neuen Wächter wurden
nach demselben Muster einmal absichtlich ausgebaut:

| Probe | Ausgebaut | Ergebnis |
|---|---|---|
| A | `main()` ohne try/catch | `✖ Ein Schreibfehler stuerzt nicht unbehandelt ab, sondern schreit` (1 von 10 rot) |
| B | `JSON.parse` ohne Schutz | `✖ Eine abgebrochene JSONL-Zeile toetet nicht jeden kuenftigen Lauf` (1 von 10 rot) |
| C | Monatsbericht undifferenziert | `✖ Der Monatsbericht unterscheidet Ausfall von Normalbetrieb` (1 von 10 rot) |
| D | LF-Pinnung aus `.gitattributes` entfernt | `✖ R12b: jedes Studien-Artefakt ist in .gitattributes auf LF gepinnt` (1 von 5 rot) |
| E | die zwei neuen Pfad-Muster entfernt | `✖ R12a: der Waechter wuerde einen echten absoluten Pfad auch finden` (1 von 5 rot) |
| F | R2-`offen`-Vermerk auf den alten Stand | `✖ R2: die Versiegelung ist heute ein Aufrufmuster — und die Registry sagt das auch` (1 von 7 rot) |

Bestritten wurde der Befund, ein frischer Windows-Checkout zeige die beiden Evidenz-
Dateien als geändert: die Ursache lag im **Index-Stat-Eintrag dieses Bau-Klons** (Größe
vor der eol-Normalisierung), nicht in den Bytes. Ein Zweit-Klon aus `origin/main` zeigt
den Befund nicht. Byte-versiegelt (`-text`) sind beide trotzdem jetzt.

## Der Befund, der nicht geglättet wird

Der Neubau-Probelauf hat beim allerersten Lauf etwas gefunden, das nicht im Auftrag
stand: **der Speicher enthält 178 akzeptierte Beobachtungen, die versiegelte Datenbank
nur 127.** 51 Payloads (50 Zwischen-Captures des Archivs, 1 aktueller Stand) sind nach
dem Bau dazugekommen. Wer heute mit dem dokumentierten Rezept neu baut, bekommt also eine
**echte Obermenge**, keine Kopie.

Das ist kein Datenverlust und kein Fehler in den 127 — jeder einzelne von ihnen ist
byte-genau nachgewiesen. Es ist ein Loch im *Rezept*. Konsequenz: die 51 zusätzlichen
Hashes stehen namentlich in der Herkunfts-Schließung, der Daten-Vertrag trägt den
Vorbehalt, und der fehlende Payload-Filter ist als E1-Aufgabe benannt statt weggelächelt.

## Zähler für Karl (R14b, reine Berichtsgröße)

8 Commits, davon **8 mit Inhalt**, 0 reine Verwaltungs-Commits (5 Bau + 3 Gegenrede). Größtes neues Artefakt:
Herkunfts-Schließung mit 116 KB (Deckel 200 KB). Werkzeuge: Python-Standardbibliothek +
sqlite3, node-Standardbibliothek. Keine neue Abhängigkeit, kein bezahlter Dienst,
kein Eingriff in `src/scoring`.

## Was NICHT umgesetzt ist — und warum

- **Verschlüsselung der Endtest-Datei (R2).** Die drei Fenster-Dateien entstehen erst in
  E1; vorher gibt es nichts zu verschlüsseln. Die Fenster-Mauer selbst ist heute schon
  Code, und das Endtest-Fenster öffnet nur mit der Öffnungsprotokoll-Marke. **Diese Marke
  steht im Klartext in der eingecheckten Registry** — R2 ist damit heute ein Aufrufmuster
  mit Wachtest, kein Zugriffsschutz gegen absichtliches Vorab-Lesen. Ein eigener Wächter
  hält genau diesen Satz fest, damit R2 nicht stillschweigend als versiegelt gilt.
- **Server-Push-Zeit gegen ersten Datenzugriff (R1).** Braucht einen echten Push *und*
  einen echten Zugriff. Beides existiert vor E3 nicht; die Hash-Kette und die
  Reihenfolge-Prüfung sind heute schon scharf.
- **Dedupe-Regel und Sensitivitätslauf 2018-gegen-2025 (R6).** Gehören ins Panel (E1).
- **R3, R5, R8–R11, R15, R17.** Alle mit Etappe und Artefakt in der Registry — sie haben
  heute schlicht kein Objekt, an dem ein Wächter greifen könnte.
- **Das Beweisstück `sec-cik-growth-persistence-analysis-v1.json` (Verdikt INCONCLUSIVE)
  liegt nur auf dem Alt-Branch, nicht auf main.** Sein Hash steht im Record und wird
  geprüft, sobald das Commit-Objekt im Checkout liegt; in einem flachen CI-Checkout wird
  es namentlich als UNGEPRÜFT ausgegeben, nie stumm übersprungen. Kopiert wurde es
  bewusst nicht — Umetikettieren zwischen den Fassungen ist verboten.

## Neue Fragen und Hypothesen (R16)

1. **Warum fehlen 51 akzeptierte Beobachtungen in der versiegelten Datenbank?** Zwei
   Erklärungen sind offen: der Bau lief vor ihrer Erfassung, oder es gab eine
   Vintage-Auswahlregel, die nicht im Bau-Skript steht. Die Antwort entscheidet, ob der
   Payload-Filter eine Liste oder eine Regel wird.
2. **Ist „zwei Beobachtungs-Stände je Quartal" (Verfassung, R6) überhaupt die richtige
   Beschreibung?** Tatsächlich gibt es bis zu drei. Für 2015q4 gibt es nur einen. Die
   Vintage-Regel muss den Ein-Stand-Fall und den Drei-Stand-Fall aushalten — der Code tut
   das bereits, die Präregistrierung 2.0.0 muss es benennen.
3. **Was ist die richtige Ereignis-Auflösung der Vorwärts-Mitschrift?** Heute hält sie den
   Kanal-Stand fest. Ob das für einen belastbaren Vorwärtstest reicht oder ob je
   Einreichung protokolliert werden muss, hängt an der Signalfamilie aus E2 — die Frage
   wird dort beantwortet, nicht vorher geraten.
4. **Trägt die 2009q1-Probe genug?** Sie ist das kleinste Quartal. Eine zweite Probe auf
   einem großen, späten Quartal würde zusätzlich die Speicher- und Laufzeitseite prüfen.

- VORSCHLAG E0b: zweite Neubau-Probe auf großem Quartal 2023q1 plus Klärung der 51 zusätzlichen Beobachtungen — 1 Tag.
- VORSCHLAG E1-Vorzug: Payload-Filter im Bau-Skript, damit das Rezept byte-gleich einlöst statt einer Obermenge — 1 Tag, gehört in E1.
