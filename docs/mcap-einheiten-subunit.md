> **Auf einen Blick**
>
> Die Universumsvorprüfung rechnet Marktwerte bei GBp, GBX, ZAc und ILA ohne zusätzliche Teilung durch 100 in US-Dollar um.
>
> Der Kurs steht in der kleinen Einheit, der Marktwert bereits in der Hauptwährung. Die Protokollzeile nennt die bepreisten Notierungen, die davon behaltenen Notierungen und den größten umgerechneten Marktwert.

## Welche Einheit gilt?

Yahoo liefert Kurse britischer Notierungen in Pence, südafrikanischer Notierungen in Cent und israelischer Notierungen in Agorot. Der zugehörige Marktwert steht bereits in Pfund, Rand beziehungsweise Schekel. Deshalb ordnet `toUsd` die Codes GBp und GBX dem Wechselkurs GBP, ZAc dem Wechselkurs ZAR und ILA dem Wechselkurs ILS zu. Der Marktwert wird nur mit diesem Wechselkurs multipliziert. Die Umrechnung einzelner Aktienkurse behält ihren eigenen Teiler.

## Was wurde gemessen?

Die Messdatei vom 08.10.2026 enthält den Marktwert, den Kurs und die Aktienzahl. Das Verhältnis wird als `marketCap / (price * shares)` berechnet. Ein Verhältnis nahe 0,01 zeigt, dass der Marktwert in der hundertmal größeren Währungseinheit als der Kurs vorliegt.

Quelle ist die lokale [Messdatei probe-units.json](C:/Users/Anwender/.codex/reports/warteschlange-2026-10-05/ergebnisse/P157/replay/probe-units.json). Der gesuchte Feldname lautet wörtlich `ratio_mcap_over_priceXshares`. Die folgenden Werte sind auf zehn Nachkommastellen gerundet.

| Ticker | Währungscode des Kurses | Verhältnis |
| --- | --- | --- |
| LLOY.L | GBp | 0,0100000006 |
| BARC.L | GBp | 0,0100000007 |
| III.L | GBp | 0,0100000007 |
| NPN.JO | ZAc | 0,0100128640 |
| GFI.JO | ZAc | 0,0100000001 |
| SBK.JO | ZAc | 0,0099999995 |
| AGL.JO | ZAc | 0,0099999993 |
| VOD.JO | ZAc | 0,0099999999 |
| TEVA.TA | ILA | 0,0099999994 |
| NICE.TA | ILA | 0,0099999996 |
| LUMI.TA | ILA | 0,0099999990 |
| POLI.TA | ILA | 0,0099999990 |
| ICL.TA | ILA | 0,0099999993 |
| ESLT.TA | ILA | 0,0100000002 |

NPN.JO liegt nahe 0,01, aber nicht exakt darauf. Die Messdatei enthält zusätzlich RIO.L mit rund 0,012963; dieser Wert wird hier nicht als Einheitenbeleg verwendet. GBX wird als weiterer Code für Pence getestet, ist jedoch in dieser Messdatei nicht vertreten.

## Was rechnen die fünf Aufrufer um?

| Aufrufer | Bedeutung des übergebenen Wertes |
| --- | --- |
| `discovery/mcap-prefilter.js`, `gradeQuote` | `q.marketCap` ist der gesamte Marktwert aus der Yahoo-Kursantwort in der Hauptwährung. |
| `discovery/tv-scanner.js`, `verarbeiteZeilen` | `market_cap_basic` ist der gesamte Marktwert zur Währungsspalte der TradingView-Zeile. |
| `refresh-universe.js`, `lokaleSchranken` | Der Wert 1 bedeutet eine Hauptwährungseinheit der Filterwährung für `intradaymarketcap`. Damit werden die Marktwertgrenzen aus US-Dollar in diese Währung umgerechnet. |
| `refresh-universe.js`, Schleife der vordefinierten Screener | `q.marketCap` ist der gesamte Marktwert aus der Yahoo-Antwort in der Hauptwährung. |
| `refresh-universe.js`, Schleife der Börsenscreener | `q.marketCap` ist der gesamte Marktwert aus der Yahoo-Antwort in der Hauptwährung. |

Kein Eintrag von `EXCHANGE_KANAELE` verwendet einen Code für eine Untereinheit. LSE und JNB gehören zu den ausgeschlossenen Kanälen. Die Grenze ist jeweils in der Hauptwährung der Filterwährung angegeben.

## Welche Wirkung hat die Korrektur?

Notierungen in den genannten Untereinheiten verlieren an der Aufnahmegrenze keinen Faktor 100 mehr. Der Lloyds-Test verwendet einen Marktwert von 60.249.000.000 GBP und den vorgegebenen Wechselkurs 1,324398. Daraus entstehen rund 79,79 Milliarden US-Dollar; damit bleibt LLOY.L oberhalb der Grenze von 800 Millionen US-Dollar.

Auch `build-smallcap-universe.js` verwendet dieselbe Vorprüfung und übernimmt die Korrektur für sein Band von 300 bis 800 Millionen US-Dollar. `scripts/messung-entdeckungsband.js` erhält ebenfalls die korrigierten Marktwerte. Die Schwellen, die Bewertungspunkte, die Rangberechnung und die Kursumrechnung werden durch diese Änderung nicht angepasst.

Die zusätzliche Rückgabe `subunit` zählt jede bewertete Aktienantwort mit bekanntem Untereinheitscode und endlichem Marktwert in US-Dollar. Für jeden vorkommenden Code werden die Zahl der bepreisten Antworten und die Zahl ab der Schwelle festgehalten. Außerdem wird die größte dieser Antworten mit Symbol und Marktwert angegeben. Ohne solche Antworten meldet die Protokollzeile „Sub-Einheit-Notierungen: keine“.
