# T157 — Auflage 4: welchen Fehlermodus fing sie als EINZIGE ab?

**Diagnose-Lauf, 2026-09-19 (Daylauf 19.09., Lane D). Kein Code, keine Entscheidung.**
Gemessen am Artefakt auf `origin/main` @ `06f11f1ddc`, Worktree `lane-d/T157`.
Gegengeprueft im Duell (Codex gpt-6-astra, read-only, §4d) — drei Einwaende reproduziert und
eingearbeitet, siehe §6.

Der Auftrag T157 hat drei Bau-Auflagen und **eine offene Frage**. Die drei Bau-Auflagen sind
seit dem 29.08. an T131 gekettet (Gauntlet, Board-Identitaet) bzw. gegenstandslos; dieser
Bericht beantwortet die offene Frage und legt die Zahlen nach, die T131 braucht.

---

## 1. Antwort in einem Satz

**Auflage 4 ist die einzige der fuenf, deren Pruefgegenstand die AUSGABE ist — die Rangordnung
auf Daten, die nicht zum Tunen benutzt wurden. Die anderen vier pruefen Eingaben (1, 2a, 2b, 3)
oder den Prozess (5). Der Fehlermodus, den nur sie laufend faengt: das Board rankt Rauschen,
waehrend jede einzelne Eingabe korrekt ist** — im Kern Anpassung an dieselben Daten, an denen
geurteilt wird (Re-Tuning/In-Sample-Fit). Konfidenz ~85 %.

In dieser Welt bleibt **jede** der anderen vier Auflagen gruen: die Achsen stimmen gegen das
Filing (1), die Verwaesserungs- und Manipulations-Lampen feuern korrekt (2a/2b), die Coverage
reicht (3), zwei Augenpaare haben es gelesen (5) — und das Board ist trotzdem wertlos.
Das ist das Loch, das die Aussetzung reisst.

**Einschraenkung, die der Duell-Gegner belegt hat (und die haelt):** „nur Auflage 4 schuetzt
ueberhaupt gegen BH-014 und Re-Tuning" waere zu weit gegriffen. Zwei Teil-Ersaetze existieren:

- Der **Yahoo-Selektionsbias (BH-014)** ist im Auflagen-Text selbst an das Rejection-Sampling
  `scripts/probe-smallcap-messlauf3.js` gebunden und wurde dort einmal gemessen
  (`reports/smallcap-probe-messlauf3-2026-07-19.md`). Das ist eine **Punktmessung vom 19.07.**,
  kein mitlaufender Test — sie altert mit jeder Universums-Aenderung.
- Gegen Re-Tuning steht `docs/threshold-discipline.md` (Schwellen nur auf out-of-sample
  bestaetigte Evidenz). Dort woertlich: *"This is a behavioural policy. Not enforced by
  tooling."* (`docs/threshold-discipline.md:62-65`).

Beides adressiert Teilursachen und keines misst die Ausgabe-Rangordnung. Ein gleichwertiger,
tatsaechlich vorhandener Small-Cap-OOS-Rangordnungstest existiert im Repo nicht.

Haertester Angriff auf die Kernthese: *"Auflage 3 (Coverage-Gate) faengt das auch — zu duenne
Daten sind der haeufigste Weg zu Rausch-Raengen."* Haelt nicht: Coverage misst die Anwesenheit
von Eingaben, nicht die Trennschaerfe der Ausgabe. Ein Board mit 100 % Coverage und einem
ueberangepassten Score ist coverage-gruen und rankIC-tot; die Richtung ist einseitig.

## 2. Drei Befunde, die der Vermerk vom 29.08. noch nicht hat

### B1 — Eine Vintage-Reihe allein macht Auflage 4 nicht KONFIRMATORISCH pruefbar (~75 %)

`protocol/rank-ic-families/g1.json` ist die **eingefrorene** Testfamilie (`familyId`
`rank-ic-confirmatory-g1`, `thresholdFreeze.frozenAt` 2026-07-14, `payloadHash` gesetzt). Sie
enumeriert 14 Boards — **kein `smallcap-*` darunter**. `scripts/rank-ic.js:893` bildet
`registeredBoards` genau aus dieser Liste; alles andere landet als
`UNREGISTERED_OBSERVATIONAL` im Report.

Folge: wuerde ab heute eine Small-Cap-Vintage-Reihe geschrieben, waeren ihre Boards
**beobachtend, nicht konfirmatorisch** — gemessen, aber ohne eingefrorene Schwelle und ohne
Platz in der BY-FDR-Buchhaltung.

**Ehrliche Grenze dieser Aussage (Duell-Einwand, angenommen):** der Auflagen-Text
(`protocol/5.2-smallcap-registered-20260721.md`, Auflage 4) verlangt „rankIC-Vorzeichen-
Konsistenz OOS" und nennt fuer BH-014 ausdruecklich `probe-smallcap-messlauf3.js` — **die
Familie g1 nennt er nicht**. Dass Auflage 4 nur unter einer registrierten Familie erfuellbar
ist, ist also eine Auslegung (meine, ~75 %), keine Textstelle. Genau diese Auslegung gehoert
mit in T131: wird Small-Cap konfirmatorisch gefahren (dann g2 mit eigenem Freeze **vor** dem
ersten Vintage) oder reicht eine beobachtende Reihe mit vorab fixiertem Kriterium?

Nebenbefund, unabhaengig davon: Small-Cap ist heute auch **kein `p=1`-Platzhalter** in der
BY-FDR-Familie. Die BH-107-Regel ("nicht messbare Tests zaehlen mit p=1") greift nur fuer
registrierte Slots. Die ausgesetzte Auflage ist in der Multiple-Testing-Buchhaltung nicht
einmal als Luecke sichtbar — sie ist abwesend.

### B2 — Der Preis der Option "Reihe schreiben": ~672 Kalendertage bis zum ersten Urteil (~90 %, bedingt auf den g1-Vertrag)

Aus dem eingefrorenen `methodContract` von g1: `decisionHorizonDays` 84, disjunkte
84-Kalendertage-Fenster (`rank-ic.js` §1, Fensterwahl `:448/:701`), `minimumNeff` 8, darunter
"unterpowert — KEIN Urteil" (§3d, `:77/:275/:721`). Acht disjunkte Entscheidungspunkte spannen
`t0 … t0+588 d`, der letzte braucht 84 d Vorlauf: **t0 + 672 d**. Start heute (2026-09-19)
heisst frueheste Auflage-4-Aussage **~2028-07-22** — Untergrenze, weil `N_eff` aus der
Lag-1-Autokorrelation gerechnet wird und in aller Regel **unter** der Fensterzahl liegt.

Die Zahl gilt unter dem g1-Vertrag. Setzt T131 einen anderen Kontrakt (kuerzerer Horizont,
andere Mindest-Power), verschiebt sie sich — die Groessenordnung "Jahre, nicht Monate" bleibt,
solange OOS-Fenster gefordert sind.

Zur Kalibrierung: die grosse Reihe laeuft seit `2026-07-14` und hat heute **31 Vintages ueber
67 Kalendertage** — sie hat ihr erstes disjunktes 84-Tage-Fenster selbst noch nicht voll.

### B3 — Ein Teil-Ersatz existiert bereits, deckt aber den Fehlermodus nicht (~90 %)

`src/scoring/board-status.js:44` (nur gelesen) setzt fuer jedes Formel-Id mit Praefix
`smallcap-` den Board-Status hart auf `diagnostic`; `scripts/write-findash-export.js:852-853`
fuehrt das in den Export. Das Board traegt seinen Vorlaeufigkeits-Status also maschinell, nicht
per Kalendernotiz — der "ausweisen"-Teil von T131 ist faktisch gebaut.

Was das NICHT ersetzt: ein Etikett sagt "ungeprueft", es misst nicht.

## 3. Stand der drei Bau-Auflagen aus T157

| Auflage | Stand 19.09. | Begruendung |
|---|---|---|
| (1) maschineller Wiederscharf-Trigger | **blockiert an T131** | Die "noetige Laenge" ist erst definiert, wenn feststeht, unter welchem Kontrakt Small-Cap gemessen wird (B1/B2). Ein Trigger auf selbstgewaehlter Laenge waere eine Methodik-Setzung durch die Hintertuer. |
| (2) Reihe ab heute passiv mitschreiben | **blockiert an T131** | Das Schreiben der Reihe IST die eine Haelfte der T131-Weiche ("Reihe schreiben" gegen "Auflage 4 formal aussetzen"). Vorwegnahme, kein Vollzug. |
| (3) "unsichtbar" gilt nachgelagert | **gegenstandslos** | Karls Entscheid 29.08.: Board bleibt sichtbar (DIAGNOSTIC). Unveraendert. |

**Bau-fertig, sobald T131 faellt** (damit niemand die Analyse zweimal macht):
Weg "Reihe schreiben" braucht drei Dinge in dieser Reihenfolge — (i) den Kontrakt: entweder
`g2.json` mit den Small-Cap-Boards, eigenem `firstEligibleVintage` und Freeze **vor** dem
ersten Vintage, oder eine ausdrueckliche Feststellung, dass eine beobachtende Reihe mit vorab
fixiertem Kriterium genuegt; (ii) den Writer-Zweig in `scripts/write-board-history.js` (heute
liest der Writer nur `outputs/hypergrowth/full`, `:78/:1409`; einziger `smallcap`-Treffer ist
die SEC-Dateiliste `:762`); (iii) den Trigger als Waechter, der rot wird, sobald die
Mindest-Power des gewaehlten Kontrakts erreicht ist UND die Auflage noch als ausgesetzt
gefuehrt wird. Weg "formal aussetzen" braucht (ii)/(iii) nicht, dafuer die Aussetzung als
praeregistriertes Dokument plus einen `p=1`-Platzhalter, damit die Luecke in der
FDR-Buchhaltung sichtbar bleibt (B1).

## 4. Geltungsbereich und Grenzen

- Gemessen am Repo-Stand `06f11f1ddc`; alle Zahlen sind aus Dateien gelesen, nichts geschaetzt.
- Die 672 Tage sind eine bedingte Untergrenze unter dem heute eingefrorenen g1-Vertrag.
- Dieser Bericht entscheidet **nichts**: weder ob die Reihe geschrieben wird, noch ob Auflage 4
  ausgesetzt wird. Beides ist T131 (Gauntlet, Board-Identitaet).
- `src/scoring/` wurde ausschliesslich gelesen (eine Zeile zitiert), nicht veraendert.

## 5. Belege

| Aussage | Beleg |
|---|---|
| g1 enumeriert 14 Boards ohne Small-Cap | `protocol/rank-ic-families/g1.json` |
| Unregistrierte Boards werden `UNREGISTERED_OBSERVATIONAL` | `scripts/rank-ic.js:893-896` |
| 84 d / `minimumNeff` 8 / unterpowert = kein Urteil | `protocol/rank-ic-families/g1.json` (`methodContract`), `scripts/rank-ic.js:4-40, 448, 701, 77, 275, 721` |
| Keine Small-Cap-Datei in irgendeinem Vintage | Vollinventur `board-history/`: 31 Staende, 434 Board-Artefakte, 14 verschiedene Board-IDs, 0 Small-Cap |
| Writer schreibt keine Small-Cap-Vintages | `scripts/write-board-history.js:78, :1409` (liest nur `outputs/hypergrowth/full`), `:762` = SEC-Dateiliste |
| Small-Cap-Boards sind hart `diagnostic` | `src/scoring/board-status.js:44`, `scripts/write-findash-export.js:852-853` |
| BH-014 einmal gegengemessen, nicht mitlaufend | `reports/smallcap-probe-messlauf3-2026-07-19.md`, `scripts/probe-smallcap-messlauf3.js` |
| Re-Tuning-Regel ohne technische Durchsetzung | `docs/threshold-discipline.md:24-27, 62-65` |
| Auflagen-Wortlaut und Zustand | `protocol/5.2-smallcap-registered-20260721.md`, `protocol/5.2-smallcap-auflage4-vermerk-20260829.md` |

## 6. Gegenpruefung (Duell-Lane §4d, Codex gpt-6-astra, read-only)

Drei Einwaende, alle **selbst nachgemessen** statt uebernommen, alle eingearbeitet:

1. **"Der Bericht uebertraegt g1 auf Auflage 4, ohne die Bindung nachzuweisen."** Reproduziert:
   der Auflagen-Text nennt g1 nicht. B1 traegt die Einschraenkung jetzt, Konfidenz von 95 % auf
   75 % gesenkt, die Frage ist an T131 weitergereicht.
2. **"16 Dateien je Stand stimmt nicht — fuenf Staende haben 17."** Reproduziert: die fuenf
   aeltesten Staende (2026-07-14 bis -18) tragen zusaetzlich `_ALTER-MASSSTAB.md`. Die
   Beleg-Zeile ist auf die Vollinventur umgestellt.
3. **"'Nur Auflage 4 schuetzt gegen BH-014/Re-Tuning' ist zu weit."** Reproduziert: BH-014 hat
   eine Punktmessung (19.07.), Re-Tuning eine ausdruecklich nicht durchgesetzte Policy. Die
   These ist auf "die einzige, die die Ausgabe-Rangordnung laufend misst" praezisiert.

Nicht gefallen ist die Kernthese: ein gleichwertiger Small-Cap-OOS-Rangordnungstest existiert
im Repo nicht (beide Motoren, unabhaengig gesucht).
