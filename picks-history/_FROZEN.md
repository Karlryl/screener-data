# picks-history/ — EINGEFROREN

**Stichtag: 2026-07-02.** Danach wurde in dieses Verzeichnis nichts mehr geschrieben.
**Bestätigt von Karl am 2026-08-16 — dauerhaft. Nie wieder auftauen.**

## Warum

Dieses Verzeichnis ist der **unbestechliche Beleg, was der Screener wann vorgeschlagen hat**.
Sein Wert liegt genau darin, dass er *nicht* nachträglich angefasst wird. Jede Korrektur —
auch eine gut gemeinte — zerstört die Beweiskraft rückwirkend und für immer.

Der Nachfolger ist **`board-history/`** (`scripts/write-board-history.js`). Alles, was
heute an Vintage-Historie entsteht, gehört dorthin.

## Was das ausdrücklich NICHT erlaubt

Die folgenden Vorhaben klingen harmlos und sind trotzdem verboten:

- **„nur die kaputten Zeilen reparieren"** — Schema-Drift (fehlendes `score`,
  fehlendes `evaluatedTickers`), Datums-Lücken (z. B. 2026-05-12) und alte Feldnamen
  sind historische Tatsachen, keine Defekte. Sie bleiben stehen.
- **ein Aufräum-Commit** — kein Reformatieren, kein Sortieren, kein Verdichten,
  kein Verschieben ins Archiv, kein Löschen „alter" Vintages.
- **eine Reaktion auf die Defekt-Meldung eines Prüfskripts** — insbesondere die
  `coverageWarning: 'picks-history coverage gap: …'` aus `scripts/walk-forward-perf.js`.
  Diese Meldung ist reine Information über einen *gewollten* Zustand. Sie ist kein
  Arbeitsauftrag. Wer sie „behebt", verletzt diesen Entscheid.
- **ein Backfill** — fehlende Tage bleiben fehlend.

Wenn ein Skript, ein Audit oder eine KI zu dem Schluss kommt, hier müsse etwas
in Ordnung gebracht werden: **Der Schluss ist falsch.** Erst Karl fragen.

## Technische Absicherung

- `scripts/archive-old-snapshots.js` ist **fail-closed**: ohne ausdrückliches
  `--picks-keep-days` wird hier nichts angefasst, und jeder Flag-Wert, der Vintages
  entfernen würde, bricht den Lauf laut ab (`::error::`, Exit 1).
- Wächter: `tests/archive-picks-frozen.test.js` (läuft im CI-Gate-Glob).
- `scripts/write-board-history.js`, `write-findash-export.js` und `write-newcomer-log.js`
  haben eigene Guards, die jeden Ausgabepfad mit `picks-history`-Bezug blockieren.
- Schutzliste in `CLAUDE.md` und `AGENTS.md`.

## Inhalt

36 Vintages `YYYY-MM-DD.json` (2026-05-08 bis 2026-07-02) plus `latest.json`
und `_first-seen.json`. Diese Zahl ändert sich nicht mehr.
