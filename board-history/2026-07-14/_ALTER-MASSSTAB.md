# ALTER MASSSTAB — nicht mit spaeteren Vintages vergleichen

Dieses Vintage stammt aus der Zeit **vor Tag 437** (`ece786900b`, 26.07.2026).

Damals war die Beschleunigungs-Achse (Umsatz-Beschleunigung) **saison-verseucht**: sie verglich
Quartale, die jahreszeitlich gar nicht vergleichbar sind. Mit Tag 437 wurde das repariert.
Seitdem misst der Score etwas anderes als hier aufgezeichnet.

**Was das bedeutet**

- Die Zahlen in diesem Ordner sind **nicht falsch** — sie waren der damals gueltige Massstab.
- Sie duerfen aber **nicht** mit Vintages ab Tag 437 in einer Reihe verglichen werden.
  Ein Rang-Vergleich ueber diesen Bruch hinweg misst den Fix, nicht den Markt.
- Deshalb steht dieses Datum in `board-history/_excluded.json`. `scripts/rank-ic.js` laesst es
  aus der Auswertung heraus. Geloescht oder neu gerechnet wird **nichts**
  (Karl-Entscheid 10, 26.07.2026: aufgezeichnete Vergangenheit wird in einem Messsystem
  nicht ueberschrieben).

**Die neue Messreihe beginnt mit dem ersten Vintage ab Tag 437.**
