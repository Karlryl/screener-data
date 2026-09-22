# T135 — Paritaetsluecke je Board, Vintage 2026-09-22 (CI-Population)

**Ergebnis: die Luecke zwischen dem Verify-Primitiv und dem Produktions-Board ist exakt der
Coverage-Floor — 35 Zeilen, Name fuer Name, sonst nichts.** 9 von 24 Board×Track tragen eine
Luecke; jede davon ist ein UEBERHANG des Primitivs (`productionCohortRanking` behaelt Zeilen, die
das Board wegwirft), es fehlt dem Primitiv **keine** Zeile, und die Reihenfolge ist ueberall sonst
gleich. Die Summe der Ueberhang-Namen ist 35 und damit genau die Zahl, die derselbe Lauf als
`thin-coverage-excludiert` protokolliert.

Damit ist die Lane-D-Prämisse vom 19.09. auf der CI-Population bestaetigt: der Abdeckungsboden
(p10 je Lauf, `src/scoring/run-screener.js:755-766`) laeuft nur in `runSmallcapPass`;
`productionCohortRanking` (`src/scoring/calibrate.js:219-222`) wendet ihn nie an. Er ist der
EINZIGE Unterschied.

## Messebene (Provenienz)

| | |
| --- | --- |
| Code | `main` **f8b730a93c**, `src/scoring/` ohne lokale Aenderungen |
| Population | Artefakt `smallcap-store-merged`, Run **35717615639** (Workflow „Small-Cap Pull (5.2, isoliert)", 2026-09-22T10:44:14Z, headSha f8b730a93c), Artefakt-ID 10689349514, 770 Dateien / 1.686.502 Bytes |
| Geladen | 494 Small-Cap-Zeilen (`loadSmallcapUniverse`): 0 parse-fail, 0 ohne `meta.ticker`, 275 nicht in `watchlist-smallcap.json` |
| Watchlist | `watchlist-smallcap.json` auf f8b730a93c, 500 Namen (vom Lauf unveraendert, s. u.) |
| Coverage-Floor dieses Laufs | p10 = **0,510**, thin-coverage-excludiert = **35** |
| Messkommando | `node scripts/t135-paritaetsluecke.js --snapshots <artefakt-ordner> --vintage 2026-09-22` |

**Caveat zur Herkunft, ausdruecklich:** der Run 35717615639 ist als `failure` abgeschlossen. Alle
vier Pull-Shards liefen `success`; der `merge`-Job fiel am Schritt „Small-Cap Reconciliation
(Auflagen 4+5)" mit `Startschwellen-Sperre (unter-startschwelle-498)`. Der Store-Upload laeuft
danach unter `if: always()` und hat die 770 Dateien vollstaendig hochgeladen. Die Sperre betrifft
die **Watchlist-Aufraeumung**, nicht den Inhalt des Stores — deshalb ist die Population als
Messebene brauchbar, und deshalb steht dieser Absatz hier statt in einer Fussnote.

## Ergebnis je Board

| Board | Track | Board (Zeilen) | Primitiv | Ueberhang (nur Primitiv) | Fehlt im Primitiv |
| --- | --- | --- | --- | --- | --- |
| smallcap-software-comm-services | unprofitable | 15 | 19 | AIBZ, DVLT, SUPX, QNC | — |
| smallcap-health-care | unprofitable | 52 | 64 | XFOR, ARVN, ASMB, QTTB, EDIT, EVMN, PALI, CBIO, LYEL, ABEO, PRTA, RGNX | — |
| smallcap-consumer-discretionary | unprofitable | 15 | 16 | XMAX | — |
| smallcap-industrials | profitable | 33 | 35 | BUUU, ERII | — |
| smallcap-financials | profitable | 9 | 17 | GLAD, ECC, FDUS, SLRC, VVR, PFL, ASGI, NML | — |
| smallcap-financials | unprofitable | 10 | 11 | GAIN | — |
| smallcap-consumer-staples | profitable | 19 | 22 | DDL, OFRM, ENHA | — |
| smallcap-materials | profitable | 12 | 14 | ITRG, ASPI | — |
| smallcap-real-estate | profitable | 18 | 20 | FPH, OPI | — |

Die uebrigen 15 Board×Track sind deckungsgleich. Kein Board fehlt (jede der 12 Formel-IDs hat ein
geschriebenes Board — der Floor hat also keinem Board alle Zeilen genommen). Volle Tabelle inklusive
der deckungsgleichen Zeilen: Ausgabe des Messkommandos.

**Nachgerechnet:** 35 Ueberhang-Nennungen, 35 verschiedene Ticker, 0 fehlende Zeilen. Der Lauf
protokolliert `thin-coverage-excludiert=35`. Die Mengen stimmen in der Zahl ueberein; eine
namentliche Gegenprobe gegen die Ausschlussliste des Boards ist nicht moeglich, weil der Board-Pfad
nur die Anzahl protokolliert (~90 %, die Zahl allein laesst eine zufaellige Uebereinstimmung offen).

## Einordnung

- Die Luecke ist **einseitig**: das Primitiv ist immer die groessere Menge. Ein Name, den das Board
  fuehrt und das Primitiv nicht, existiert in keinem der 24 Faelle. Das ist die Signatur eines
  reinen Filters, nicht zweier verschiedener Rankings.
- Gleichstands-Sortierung ist **kein** Befund: `rankBy` sortiert nur nach Score, das Board bricht
  Gleichstaende nach Ticker. Das Messskript weist das aus.
- Vergleich zum Rauchtest vom 21.09. (lokaler Altbestand, 81 Zeilen, nicht zitierbar): dort 5/24
  mit Luecke. Der Unterschied ist die Populationsgroesse, nicht der Mechanismus — die Richtung
  (nur Ueberhang, nie fehlend) ist in beiden Messungen dieselbe.
- **Fix gehoert nicht hierher.** Beide Dateien sind GQS-00-gepinnt (`calibrate.js` in
  `protocol/gqs-00/1.2.0-pending/transition.json`, `run-screener.js` in
  `gqs-00/1.1.0/formula-registry.json`). Master-Entscheid vom 21.09.: Option B jetzt (siegelneutrale
  MESSUNG, versiegelte Funktionen werden nur aufgerufen, der Boden wird nie nachgebaut), Fix als
  Teil des naechsten GQS-00-Uebergangs mit Re-Pin beider Dateien. Diese Messung ist die bis dahin
  gepinnte, bekannte Abweichung.

## Nebenbefund (nur gemeldet, nichts geaendert)

Die Startschwellen-Sperre laesst den `merge`-Job **jeden** Nicht-Samstags-Lauf scheitern, sobald der
Reconcile mindestens einen Namen entfernen wuerde: `scripts/reconcile-smallcap.js:263-266` sperrt
bei `vorher >= 500 && behalten < 500`, und die Liste steht auf exakt 500. Am 22.09. waren es zwei
Namen (NRGV, NUAI, beide `band-austritt-oben`) — 0,4 % — und der Job endete mit Exit 1. Die Sperre
tut, wofuer sie gebaut wurde (sie schuetzt die Startschwelle des naechsten Laufs), aber solange die
Liste genau auf der Schwelle steht, ist sie unaufloesbar: die Liste kann nicht schrumpfen, und der
Job kann nicht gruen werden. Das ist eine Entscheidung fuer den Screener-Betrieb, kein Bug in dieser
Messung — hier steht sie, weil sie die Herkunft dieser Population erklaert.

Auslegung, ~85 %: die Zahl 500 ist absichtlich doppelt hartkodiert (Skript und
`.github/workflows/smallcap-pull.yml`, gegenseitig kommentiert), also ist jede Aenderung ein
bewusster Doppel-Akt und kein Nebenbei-Fix.
