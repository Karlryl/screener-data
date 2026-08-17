# E1, Vorstufe: Inventur des Beobachtungs-Speichers

**Datum:** 2026-08-17 · **Protokoll:** FEM-SEC-US@2.0.0 · **Zweig:** `studie/e1-datenbasis`
**Werkzeug:** `scripts/studie-payload-inventar.py` (Selbsttest gruen, Siegel-Pruefung
einmal absichtlich entschaerft und rot gesehen)
**Gelesen, nichts geschrieben** am Speicher; kein versiegeltes Artefakt beruehrt.

---

## Was rausgekommen ist

Der Daten-Vertrag benennt eine offene Luecke: *„Ohne Payload-Filter erzeugt Schritt 2 eine
Obermenge […] der Filter selbst ist eine benannte E1-Aufgabe."* Diese Inventur ist die
Vorstufe dazu und beantwortet, **was heute wirklich im Speicher liegt** — nicht was der
Vertrag behauptet.

| Klasse | Anzahl | Bedeutung |
|---|---|---|
| **versiegelt** | **127** | gehoeren in die Datenbank, Mengen-Pruefsumme nachgerechnet und getroffen |
| **Obermenge** | **51** | liegen im Speicher, gehoeren NICHT in die Datenbank |
| **unbekannt** | **5** | weder noch — aufgeklaert, siehe unten |
| Summe | 183 | alle mit Guete `accepted` |

**Kein versiegelter Payload fehlt im Speicher** — der Neubau ist also moeglich. Die
Inventur prueft das ausdruecklich in beide Richtungen; eine reine Vorwaertszaehlung haette
einen fehlenden Payload nie bemerkt.

---

## Drei Befunde, die vorher nicht dokumentiert waren

### 1. Die Differenz 183 gegen 178 ist vollstaendig aufgeklaert

Die fuenf „unbekannten" Beobachtungen sind die Quartale **2025q1, 2025q2, 2025q3, 2025q4
und 2026q1**. Sie liegen **hinter dem Speicher-Ende der Studie** (2024q4) und wurden am
16.08.2026 nachgezogen. Sie sind kein Defekt, sondern Zukunft: der Payload-Filter muss sie
ausschliessen, weil die versiegelte Datenbank sie nicht enthaelt. **Kein Handlungsbedarf,
aber ein Pflichtsatz fuer den Filter-Nachweis** — ohne ihn saehe eine spaetere Sitzung fuenf
unerklaerte Dateien und wuerde sie fuer einen Fehler halten.

### 2. Es gibt einen DRITTEN Beobachtungs-Stand, den R6 nicht nennt

R6 spricht von **zwei** Staenden je Quartal (`legacy_earliest_archived` und
`post_2024_reprocessed_or_current`). Im Speicher liegt ein dritter:

| Stand | versiegelt | Obermenge |
|---|---|---|
| `legacy_earliest_archived` | 64 | 0 |
| `post_2024_reprocessed_or_current` | 63 | 1 |
| **`archived_digest_revision`** | **0** | **50** |

Die 50 Eintraege des dritten Standes sind **ausnahmslos** Obermenge — die Versiegelung hat
sie also bereits sauber ausgeschlossen. **R6 ist damit nicht falsch, aber unvollstaendig
formuliert:** „der Speicher enthaelt je Quartal zwei Beobachtungs-Staende" gilt fuer die
versiegelte Datenbasis, nicht fuer den Speicher. Wer den Satz woertlich nimmt und den
Filter daran baut, laesst 50 Payloads durch. **Vorschlag fuer die naechste Fassung der
Verfassung:** den Satz auf die *versiegelte Datenbasis* beziehen und den dritten Stand
namentlich als ausgeschlossen benennen.

### 3. Der geparkte 2015q4-Sonderfall ist lokalisiert und aufgeloest — ohne Siegel-Aenderung

**2015q4 ist das einzige der 64 Quartale mit nur EINEM versiegelten Stand**
(`legacy_earliest_archived`, beobachtet 2018-03-28). Der reprozessierte Stand fehlt in der
Datenbank.

**Er ist aber nicht verloren:** er liegt im Speicher als Obermengen-Beobachtung
(`post_2024_reprocessed_or_current`, beobachtet 2025-02-01,
`payloadSha256 1723b41e…`). Er ist der **einzige** reprozessierte Eintrag der ganzen
Obermenge.

Was das fuer die offene Frage heisst („geht die Auswertung auch ohne Siegel-Aenderung?"):

- **Fuer den Pflicht-Sensitivitaetslauf nach R6** (Alt-Stand gegen reprozessierten Stand,
  **auf Fakten-Ebene**) liefert die versiegelte Datenbank **63 von 64 Quartalen** vollstaendig.
  Nur 2015q4 fehlt.
- Der fehlende Vergleich laesst sich fuehren, **ohne ein Siegel anzufassen**: der Payload
  liegt vor und wird gelesen, nicht die versiegelte Menge veraendert. Ob dieser Zusatz-Lesevorgang
  zulaessig ist, ist eine **Methodik-Entscheidung** (er erweitert, was der Sensitivitaetslauf
  abdeckt) und gehoert vor die entscheidende Instanz, nicht in die Ausfuehrung.
- **Einordnung, damit die Lage nicht groesser wirkt als sie ist:** 2015q4 liegt im
  **Entdeckungs-Fenster** (2009–2015). Fuer dieses ganze Fenster gibt es laut R6-Praezisierung
  ohnehin **keinen zeitgenoessischen Stand** — der Alt-Stand ist durchgehend eine
  Archiv-Aufnahme vom Maerz 2018. Die Zeitpunkt-Ehrlichkeit ist durch das fehlende Quartal
  also **nicht** zusaetzlich beschaedigt; betroffen ist allein die Vollstaendigkeit des
  Sensitivitaetslaufs.

---

## Was das Werkzeug leistet und was nicht

**Leistet:** Es prueft ZUERST die eigene Lesart — die Payload-Liste wird nachgerechnet und
muss die im Vertrag *und* in der Herkunfts-Schliessung stehende Mengen-Pruefsumme treffen.
Trifft sie nicht, bricht es ab, statt eine plausibel aussehende Erlaubnisliste fuer eine
andere Menge zu erzeugen. Es schreibt die **Erlaubnisliste** (die 127 Pruefsummen mit
Mengen-Pruefsumme) als eigene kleine Datei — das ist das Stueck, das der spaetere Filter
konsumiert, gleich wie er gebaut wird.

**Leistet nicht:** den Filter-Vollzug. Wie der Filter die **hash-gepinnten** Bau-Skripte
unberuehrt laesst (`early-detection-pit-compact.py` steht mit sha256 im Daten-Vertrag),
ist eine eigene Weiche und wird getrennt entschieden.

**Woran verifiziert:** Selbsttest ohne Speicher — Klassifikation in drei Klassen, ein
absichtlich fehlender versiegelter Payload muss auffallen, drei Verfaelschungen des Siegels
(veraenderte Liste, falsche Mengen-Pruefsumme, auseinanderlaufende Vertrag/Schliessung)
muessen abbrechen. Zusaetzlich wurde die Siegel-Pruefung im laufenden Modul einmal durch
eine wirkungslose ersetzt: der Selbsttest wird rot und benennt den Fall.

## Folgefragen (R16)

1. Darf der Sensitivitaetslauf fuer 2015q4 den Obermengen-Payload lesen? (Methodik, gehoert
   vor die entscheidende Instanz — Aufwand danach: unter einem Tag.)
2. Wird R6 in der naechsten Verfassungsfassung auf „zwei Staende **in der versiegelten
   Datenbasis**" praezisiert und `archived_digest_revision` namentlich ausgeschlossen?
   (Redaktionell, halber Tag.)
3. Braucht der Filter-Nachweis einen Voll-Neubau, oder genuegt die bereits im Vertrag
   stehende Quartals-Probe (`rebuildProbe` 2009q1, PASS mit roter Gegenprobe)? Teil der
   Filter-Weiche.
