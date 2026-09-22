**Triage-Ergebnis: gleiche Klasse, KEINE neuen Namen in der 2-von-3-Klasse. Der Zaehlerwechsel 17/8/9 (20.09.) -> 16/6/10 (22.09.) vergleicht zwei verschiedene Populationen und ist kein neuer Befund. Konfidenz 85 %.**

# Jahres-Ausreisser-Waechter, rotes X vom 22.09.2026 (Lauf 35700832192)

AUF EINEN BLICK: Der Waechter meldet `2-von-3: 16 · faktorgleich (Tol 1,02): 6 · NICHT erfasst: 10`.
Nur ein Bericht, keine Waechter-Aenderung (Auftrag: "Report ONLY"). Zwei Saetze vorweg:
(1) jeder Ticker mit zwei Feld-Funden von heute stand schon am 20.09. auf der Liste;
(2) die beiden Namen, die den Unterschied erklaeren, existieren in der gemessenen Population gar nicht.

## 1. Was heute rot ist

Verdikt-Zeile aus dem CI-Log (Job `jahres-ausreisser-waechter`, 2026-09-22T09:10:00Z):
`2-von-3: 16 · faktorgleich (Tol 1,02): 6 · NICHT erfasst: 10`.

Die Ereignis-Zeilen desselben Jobs nennen als Ticker mit ZWEI Feld-Funden am selben Index:
600975.SS[2], 601068.SS[2], 601718.SS[1], 8795.T[2], TDHOF[2], DIGIS.MC[1], KINV-A.ST[2],
KINV-B.ST[2], MFSL.BO[1], VOGL.BO[1], VOGL.NS[1], VPLAY-A.ST[2].

**Alle zwoelf stehen bereits in der 2-von-3-Menge des 20.09.-Berichts.** Kein neuer Name in dieser Klasse.

## 2. Die neuen Namen sind eine ANDERE Klasse

Heute neu in den Ereignis-Zeilen: BVS.AX, CUBEINVIT.BO, CXO.AX, ENTOF, GCP.L, HMT.BO, MDV.WA,
PPT.AX, SFNXF, SGM.AX, TABCF, TAH.AX, TSRYF, TWE.AX, UNBLF, URW.PA, VIV.PA.

Diese tragen je **einen** Feld-Fund. Das Faktor-Gleichheits-Tor setzt `reihen.size === 2` voraus
(`watch-annual-spikes.js:569`), also zwei Felder desselben Tickers am selben Index. Ein-Fund-Ereignisse
kommen in der 2-von-3-Zaehlung nie vor. Sie sind fuer das rote X dieser Zeile irrelevant und duerfen
nicht als "neue Faelle derselben Klasse" gelesen werden.

## 3. Warum die Zahlen sich verschoben haben — Populationsfrage, kein Datenfund

Der 20.09.-Bericht (`t-jahresausreisser-nicht-erfasst-2026-09-20.md`) mass **17/8/9** und markierte
selbst eine unerklaerte Abweichung von +2/+2/0 gegenueber dem damals zitierten Log; als Ursache nannte
er die beiden Zusatzpaare INDU-A.ST[2] und INDU-C.ST[2].

Direkt nachgemessen (Dateipraesenz im Snapshot-Verzeichnis):

| Ticker | roh 35438100627 (18.09., Basis des 20.09.-Berichts) | gemergt 35500025507 (20.09.) | gemergt 35700832192 (22.09.) |
| --- | --- | --- | --- |
| INDU-A.ST | vorhanden | **fehlt** | **fehlt** |
| INDU-C.ST | vorhanden | **fehlt** | **fehlt** |
| 001450.KS, 002446.SZ, 002759.SZ, MFSL.BO, 8795.T, TDHOF, KINV-A.ST, KINV-B.ST, VOGL.BO | vorhanden | vorhanden | vorhanden |

**Der 20.09.-Bericht lief auf der ROHEN 17-Shard-Population (17.392 Dateien), der CI-Waechter laeuft auf
der GEMERGTEN (16.091).** INDU-A.ST und INDU-C.ST kommen nur in der rohen vor. Beide standen am 20.09.
in der faktorgleichen Menge — ihr Fehlen erklaert den Rueckgang faktorgleich 8 -> 6 vollstaendig und
rechnerisch exakt. `NICHT erfasst` ist die Differenz 2-von-3 minus faktorgleich, steigt also von 9 auf 10,
ohne dass ein einziger neuer Fall hinzugekommen waere.

## 4. Was das heisst

- Die Zahlen 17/8/9 und 16/6/10 sind **nicht vergleichbar**; sie stammen aus verschiedenen Populationen.
  Ein Vergleich, der das nicht sagt, erzeugt einen Scheinbefund.
- Das rote X ist **kein neuer Datenfehler**. Es ist derselbe Bestand wie am 20.09., gemessen auf der
  gemergten Population.
- Offen und NICHT gemessen: die exakten 16er-/6er-Mengen von heute. Der Waechter druckt nur Zaehler,
  keine Mengen; `scripts/t-jahresausreisser-klassifikation.js` kann sie nicht liefern, ohne dass man
  seine fest verdrahtete Population (`POP`, Zeile 10) UND seine Populations-Assertion (17.392 Dateien)
  aendert. Beides waere eine Aenderung am Messwerkzeug und ist hier unterblieben (Report-only).
  Wer die Mengen braucht: dem Skript einen Populationspfad als Argument geben — das ist ein eigener,
  kleiner Auftrag, kein Waechter-Eingriff.
- **Kein Vorschlag zur Waechter-Aenderung.** Der Auftrag war Bericht; die Schwelle 1,02 und die
  Tor-Logik bleiben unberuehrt.

**Gegenrede an mich selbst:** Der staerkste Angriff waere "die zwoelf Namen sind nur die, die es in
Ereignis-Zeilen geschafft haben — die restlichen vier der 16 koennten neu sein". Er haelt teilweise:
ich kann die vollen Mengen nicht rekonstruieren (s. o.), deshalb 85 % und nicht mehr. Was ich belegen
kann, ist die Population als Erklaerung des Zaehlerwechsels — und die traegt ohne die fehlenden vier.
