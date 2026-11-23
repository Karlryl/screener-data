# Market-Screener — Projekt-Kontext

> Projekt-Fakten für dieses Repo. Die allgemeinen Arbeitsregeln stehen im gemeinsamen Kern in `C:\Users\Anwender\.claude\CLAUDE.md` (für Codex wortgleich in `C:\Users\Anwender\.codex\AGENTS.md`); diese Datei ergänzt Projekt-Fakten und die Regeln, die nur dieses Projekt betreffen (Abschnitt „Projektregeln aus dem gemeinsamen Kern“ am Ende). Dynamische, sich mit dem Code ändernde Fakten leben im Memory (`~/.claude/projects/…-screener-data/memory/`), **nicht** hier.

## Was das Projekt ist
Growth-/Qualitäts-**Screener** für Aktien. Öffentliches Repo `Karlryl/screener-data`, seit 13.10.2026 mit frischer Versionsgeschichte; die alte Geschichte liegt in einem privaten Archiv-Repo (lokaler Remote `archiv`). Branch `main`, Tageslauf `.github/workflows/daily-pull.yml` (Cron `17 2 * * 2-6`, Di–Sa 02:17 UTC geplant; GitHub startet ihn Stunden später), Veröffentlichung auf `gh-pages`. Engine: `src/scoring/`; Technik-Überblick in `README.md`, Einzelthemen in `docs/`.

## Einstieg
Lesereihenfolge und Vorrang regelt der Kern. Vault-Einstieg: `C:\Users\Anwender\OneDrive\Dokumente\GitHub\Jarvis\Knowledge\Trading\growth-screener\START.md`. Reihenfolge der Arbeit: `C:\Users\Anwender\OneDrive\Dokumente\GitHub\karl-plan\WUNSCHLISTE.md`. Der Vault-Masterplan (`…\growth-screener\_MASTERPLAN-screener-findash.md`) ist Nachschlagewerk, kein Auftraggeber.
- **Commit-Konvention (H2):** `Tag <n>: <Betreff>` — `n` = höchste `Tag`-Nummer aus `git log --oneline origin/main` + 1, ein Tag pro logischem Chunk (endgültig erst beim Zusammenführen, siehe Fallen).
- **Daily-run expectations:** Every PR that changes a board number adds its predicted values to `data-health/erwartungen.json`, with the PR number as `pr` and the first live data day as `gueltigAb` (entry format in the header of `scripts/tageslauf-erwartungen.js`). After the daily run the master runs `node scripts/tageslauf-erwartungen.js`, which checks every entry due on the export's data day against the published export (exit 0 all met or expired, 1 at least one not met or not measurable, or a held reporting currency past its deadline ("ALARM an Karl" with firm, deadline and owner), 2 export index not loadable or expectations file invalid). A prediction that no longer applies gets a `gueltigBis` instead of being removed.
- **Prüfen, Zusammenführen, Löschen, Versionsgeschichte:** nach den Regeln des Kerns zu Prüfung, Löschen und Versionsgeschichte.
- **Schutzliste (nie löschen/überschreiben, deckungsgleich mit `.codex-deny.txt`):** `picks-history/`, `methods-history/`, `board-history/`, `score-history/`, `r40rx-history/`, `earnings-calendar.json`. Neue Tage in `board-history/` schreibt nur der Tageslauf oder ein dokumentierter Nachtrag (`docs/board-history-backfills.md`). `picks-history/` ist darüber hinaus **inhaltlich eingefroren** (Stichtag 2026-07-02, Karl 2026-08-16, dauerhaft) — auch keine Korrektur, kein Backfill, kein Aufräum-Commit und keine „Reparatur" von Prüfskript-Meldungen; Details und Begründung in [`picks-history/_FROZEN.md`](./picks-history/_FROZEN.md). Nachfolger: `board-history/`. Der frühere Schutz-Branch `loop/formel-haertung` liegt nur noch im Archiv-Repo.

## Kern-Designprinzip: der Score misst Qualität, nie Preis
Der offizielle Score misst Qualität, nicht Preis, und Karls Grundsatz schlägt jeden Rat; eigene Gewichte gibt es nur in Karls Filter-Reiter. [G8] Im Code heißt das:
- Ein preisnormiertes Signal (Yield, P/E, PEG, EV/EBITDA, DCF/Margin-of-Safety, Target-Upside, Preis-Momentum) in einer Score-Formel unter `src/scoring/formulas/` ist ein **Mandats-Verstoß**. Bewertungskennzahlen gibt es nur getrennt vom Score und ohne Rang (`scripts/write-bewertung-export.js`).
- **BUFFETT-Mode** (value+quality, DCF/MoS) ist entfernt (Karl-Entscheidung 2026-06-20).
- **Fitness-Spannung:** Das Fitness-Maß (`scripts/rank-ic.js`, Bericht `outputs/rank-ic-report.json`, auf `gh-pages` unter `outputs/rank-ic/`) optimiert Forward-Return-Rank-IC und belohnt damit strukturell Cheapness — es zieht genau die verbotenen Bewertungssignale zurück. Sinkt die Fitness nach dem Entfernen von Bewertung: **erwartet und korrekt, NICHT durch Wieder-Einbau „reparieren".**

## Pflicht-Test-Gates (bindend nach jeder Methoden-/Scoring-Änderung)
Die alten Root-Gates (`tag28-tests.js`, `engine-cli-tests.js`, `tests/integration-anchor-test.js`) sind **entfernt**. Bindend ist der vorhandene Testläufer `node scripts/test-gate.js --mode=all` (beide Spuren, Exit 1 bei rot; derselbe Aufruf läuft im PR-Check, der Tageslauf fährt `--mode=blocking`). Die blockierende Spur globbt **`tests/*test.js`, `tests/scoring/*test.js`, `lib/*test.js`, `tests/druckenmiller/*test.js`** (`BLOCKING_GLOBS` in `scripts/test-gate.js`; jede Datei ist ein Standalone-Runner: `node <datei>`, Exit 0/1). Nach jeder Scoring-/Methoden-Änderung die **komplette Suite** grün fahren — Anker u. a. `tests/scoring/anchors.fixture.test.js` (Fixture-Oracle), `score.integration.test.js`, `run-screener.test.js`.
```powershell
node scripts/test-gate.js --mode=all
```
Score-Methoden-Änderungen flippen den Fixture-Hash → das ist gewollt und der Nachweis. Quelle der Wahrheit: `BLOCKING_GLOBS` in `scripts/test-gate.js`. (`node` und `gh` liegen auf PATH.)

## Formeln
Formeländerungen laufen über den Formel-Weg (Wortlaut unten in dieser Datei, Abschnitt „Projektregeln aus dem gemeinsamen Kern“). Im Repo: eine Formel je Branchen-Route (`src/scoring/formulas/index.js`, derzeit 13 Routen; Zuordnung in `src/scoring/router.js`). Das Vorher/Nachher am selben Datentag liegt als `docs/<thema>-vorher-nachher-<datum>.md` (Beispiel: `docs/g31-umschaltung-vorher-nachher-2026-10-17.md`).

Neue Formeln starten in `src/scoring/board-status.js` als **`diagnostic`** (gerechnet und sichtbar als unbewiesen); die Aufnahme in `core` ist ein bewusster Eintrag dort, erst nach Walk-Forward-Beleg pro Sektor.

Neue Board-/Achsen-Kandidaten: belegte Recherche → Formel-Weg. Reihenfolge nur über die Wunschliste. Nachschlagewerk, kein Auftraggeber: Ideen-Ledger `…\growth-screener\_IDEEN-LEDGER-2026-07-16.md`, Formel-Ledger `…\growth-screener\screener-formel-ledger.md` (Fitness-Baseline, Befunde).

## Wissensbasis / Recherche (getrennt vom Code)
Sektor-Dossiers (evidence-graded, zitiert; ältere liegen noch englisch vor) liegen im **Obsidian-Vault**
`C:\Users\Anwender\OneDrive\Dokumente\GitHub\Jarvis\Knowledge\Trading\growth-screener\` — **NICHT** im screener-data-Repo. Hub: `growth-screener-knowledge-base`, verlinkt mit `elliott-wellen-referenz`.

## Engineering-Regeln für Multi-Agent-Arbeit
- **Nie shared Registry-Files parallel editieren:** `src/scoring/formulas/index.js`, `src/scoring/formulas/quality/index.js`, `src/scoring/score.js` → Write-Races. Parallelarbeit nach der Sperr-Regel des Kerns (je Projekt schreibt nur eine Sitzung); die Registry besitzt dabei ein einziger Schreiber (Coordinator-Pattern), die Reihenfolge der Zusammenführung entscheidet der Master der Sitzung. Neue `src/scoring/formulas/<sector>.js` kollidieren nicht, entstehen aber ebenfalls nur in einer eigenen Klon-Lane.
- **`git commit` ohne Pathspec staged ALLES** (auch Dateien laufender Agenten) → vor Commit `git status --short`, dann gezielt `git commit -- <pfade>`.
- **Alte Befehle nicht ausführen:** `.claude/commands/audit.md`, `.claude/commands/screener.md` und `.claude/skills/methods-audit/` arbeiten gegen die entfernte Engine (`methods/`, `tag28-tests.js`). Umgang mit Prüfbefunden nach dem Kern (erst nachstellen, dann beheben; Funde sind Vorschläge).

## Fallen
Belegpfade der Form `done\…` und `ergebnisse\…` liegen unter `C:\Users\Anwender\.codex\reports\warteschlange-2026-10-05\`; „Brief §3.x“ meint dort `DIENER-BRIEF-20261006.md`.
- **`GitHub\screener-data-fix`** = eingefrorene Kopie/Ex-Worktree (18.05.2026) — **nicht anfassen**.
- **`GitHub\docGPT`** = totes Fremd-Repo (Kandidat für die monatliche Löschliste) — nie als Workspace nutzen.
- **Zwei Tests sind auf dieser Maschine dauerhaft rot und in CI grün — kein Defekt, sondern Umgebung.** Gemessen 30.08.2026 gegen den gleichen Stand, der als PR-Check grün durchlief:
  - `tests/scoring/calibration-ref.test.js` — genau ein Block (*R2.9 Test B*) hat eine **Vorbedingung**, die lokal nicht gilt: er braucht die Kohorte `utilities|unprofitable` als FEHLEND im lokalen Kalibrier-Artefakt. Lokal ist sie da. 16 von 17 Blöcken grün.
  - `tests/waehrung-ausliefer-waechter.test.js` — der LIVE-Block läuft über die **lokal ausgelieferten** Beine und findet dort Kreuznotiz-Verstöße (Mehrfachlistings desselben Emittenten). Das ist die bekannte Listing-Währungs-Falle. **Listing-Währungs-Klasse: keine Datums-Sperre**; Bau erlaubt, Bedingung: Vorher/Nachher auf der ausgelieferten Menge zeigt 0 veränderte korrekte Zeilen, zweite KI geprüft. Die synthetischen Blöcke derselben Datei sind grün.
  - **Regel:** Diese zwei lokalen Roten sind **kein** Grund, einen Chunk anzuhalten oder zu „reparieren". Jede *dritte* rote Datei ist es sehr wohl. Wer den lokalen Lauf sauber braucht: `git config core.autocrlf false` beseitigt eine dritte, ältere Klasse (Zeilenenden), nicht diese beiden.
- **Höchstens zwei volle Test-Gate-Läufe gleichzeitig, und nur solange C: beim Start mehr als 60 GB frei hat; darunter nur einer.** Die Tests legen Tempordner (`bh-*` u. a.) an und räumen sie selbst nicht auf; seit Tag 1425 (#434) gibt `scripts/test-gate.js` jeder Testdatei einen eigenen Temp-Ordner und entfernt ihn danach (vorher am 06.10.: fast 50.000 Temp-Ordner an einem Tag, laut P94). Die Größe hängt stark vom Präfix ab: `bh-*` sind klein, `findash-movement-*` und `fd-deploy-git-*` belegten je mehrere GB (Nachmessung D12, `ergebnisse\P90\findash-tmp-befund.md`). Während des Laufs belegt ein volles Gate trotzdem vorübergehend viel Platz (Brief §3.26: rund 17 GB). Den Plattenengpass am 06.10. verursachten vor allem Codex-Arbeitsbereiche (49 GB). Vor dem Start die offenen `GATE-START`-Zeilen ohne `GATE-END` (jünger als 40 Minuten) zählen, dann `GATE-START <lane>` und danach `GATE-END` ins Heartbeat-Log schreiben. (Beleg: `done\P94.md`, #434, Brief §3.17 und §3.26)
- **`TEMP`/`TMP` vor jedem vollen Lauf umlenken** auf `C:\Users\Anwender\.codex\t\<ID>`, und zwar außerhalb des Klons, weil ungetrackte Ordner im Klon gate-check rot machen. (Beleg: Brief §3.19; Brief §3.24: kurzer Pfad, sonst scheitert early-detection-foundation an 260 Zeichen)
- **Windows-Speicheroptimierung räumt `%TEMP%`, sobald C: knapp wird.** Am 06.10. um 13:04 lag C: unter 5 GB, danach verschwanden Tempordner mitten im Lauf, und Tests meldeten `EBUSY`. Arbeits- und Testordner gehören nicht nach `%TEMP%`. Die Einstellung ist Systemsache, also Karls. (Beleg: Brief §3.22)
- **`tests/in-nse-adapter.test.js` ist nur rot, wenn er aus `%TEMP%` heraus läuft**; im Klon oder bei umgelenktem TEMP ist er grün. Rot in `%TEMP%` gilt als Umgebung, nicht als Defekt. (Beleg: nacht-heartbeat.log 13:24 (D10): EBUSY beim Umbenennen, mit umgelenktem TMP 49 bestanden / 0 rot)
- **Jedes neue Export-Modul unter `lib/` braucht JSDoc** (Zweckzeile und `@param`), sonst bricht `tests/jsdoc-exports.test.js` die blockierende Testspur ab („blocking run before Yahoo pull“). Lokal leicht als Umgebungsrot zu verkennen. (Beleg: PR #420, CI-Lauf 37434939947; `done\P33.md`)
- **Die Tag-Nummer („Tag <n>: …“) steht erst beim Zusammenführen fest.** Mehrere Lanes vergeben parallel dieselbe Nummer; maßgeblich ist der Betreff des Merge-Commits auf main. So wurde #420 mit „Tag 1411“ gebaut und als `b0406b20e4 … Tag 1416` zusammengeführt. (Beleg: `git log origin/main`)
- **Zweiter Schreiber nur in einer frischen Klon-Lane** unter `C:\Users\Anwender\.codex\worktrees\<lane>`, mit eigenem `.git`, eigener Sperre nach dem Klon-Ordner, eigenem Zweig und PR. Den Hauptordner fasst diese Lane nie an, auch kein `git fetch`. (Beleg: KI 06.10.; Fehler F6047)


## Zwei-Motoren-Betrieb (Codex)

Rollen, Modellwahl, Prüfung durch die andere KI und die Sperre vor dem ersten Schreiben stehen im Kern; das Verfahren steht im Skill `codex-delegieren`. Für dieses Repo heißt die Sperre `C:\Users\Anwender\.claude\skills\codex-delegieren\gate-check.ps1 -Mode Claim -Repo C:\Users\Anwender\OneDrive\Dokumente\GitHub\screener-data` (Sperrdatei `C:\Users\Anwender\.codex\delegation-locks\screener-data.lock.json`). Commits `WIP (Codex, ungereviewt)` zuerst prüfen; ist etwas zu ändern, kommt ein neuer Korrekturcommit obendrauf.

## Projektregeln aus dem gemeinsamen Kern (verlegt beim Umbau 2026-11)

Gelten für Claude und Codex in diesem Repo. Klammern wie im Kern: ein Datum heißt Karl, KI = ohne Spur von Karl; G, T, L verweisen auf das Archiv.

- **Formel-Weg:** Formeländerung sichtbar mit Vorher/Nachher am selben Datentag, von der anderen KI geprüft, danach live; die alte Formel läuft höchstens 4 Wochen sichtbar als Vergleich mit, bei einem Fehler wird zurückgeschaltet. Was Karl selbst entschieden hat, braucht keinen Beleg, dass es besser ist. Alte Vorschläge werden nie geschönt. „3 grüne Läufe“, Gauntlet und F-16 sperren nichts mehr. [Teil 2, Archiv, 13.10.]
- **Vorher/Nachher:** hält alles außer der geprüften Änderung fest (gleicher Datentag, gleiche Kalibrierung, gleiche Firmenliste). Eine daraus gezogene Folgerung („Score wäre X“) geht erst als Tatsache an Karl, wenn sie mit festgehaltenem Datentag nachgerechnet ist; beim Wirkdatum steht dabei, ob die Firma dafür erst neu geladen werden muss. [L15]
- Eine Formelidee wird ohne Wartefrist mit den besten Gratisdaten rückwärts getestet, Lücken werden genannt; historisch geprüft zählt mehr als vorwärts. [13.10. sinngemäß]
- Fehlen Daten (etwa später verschwundene Firmen), läuft der Rückwärtstest trotzdem und nennt die Lücke und ihre wahrscheinliche Wirkung; keine Regel darf eine Prüfung um Monate verzögern. Ein Fund zählt, wenn er nur damals bekannte Daten nutzt und einen Vergleich mit zufällig gewählten Aktien schlägt; wie das sauber gerechnet wird, entscheiden Claude und Codex. Die Regeln der Studie gelten hier nie. [G6, G7, 12.11., 13.10.]
- Repariert wird an der Wurzel, also ganze Fehlerklassen vor Einzelfehlern; einzeln repariert wird, was Karl sieht. [G6, 12.11.]
- Die Boards zeigen je Firma die neuesten gemeldeten Zahlen, mit dem Zeitraum beschriftet; Aktualität geht vor einem einheitlichen Zeitraum für alle. Umgesetzt wird das über den Formel-Weg mit Vorher/Nachher. [G31, 11.10.]
- Jeder Reiter sagt in einem Satz, was er misst und warum eine Firma oben steht; versteht Karl ihn nicht, ist er nicht fertig. [28.07. sinngemäß, Rest gewählt]
- Jede Anzeige nennt das Datum der Daten selbst, nicht des Abrufs; ein Wächter meldet, wenn die Quelle Neueres hat. [20.07., 18.11. sinngemäß]
- Zusatz zur Aktualität: Jede Quelle wird so oft abgerufen, wie sie Neues liefert, und ein Wächter meldet jede Reihe, die hinter ihrer Quelle zurückliegt. Ist ein Board älter als einen Handelstag, steht oben in findash eine rote Zeile. [G14, 11.10., 12.11.]
- Qualitätsmesser: Monatlich werden etwa 100 zufällige angezeigte Zahlen gegen die Originalquelle geprüft; Karl bekommt den Fehleranteil in einem Satz. [KI, auf Karls Frage vom 18.11.]
- Für den antizyklischen Screener werden Kauf- und Verkaufssignale als Test gerechnet, vorwärts gemessen und als Testsignal gekennzeichnet gezeigt; auch sie sind keine Empfehlung. [G5, 13.10.]
- Ist der tägliche Datenlauf rot: Ursache am selben Abend nachstellen; ein echter Fehler wird repariert, gewolltes Verhalten wird Rotstelle mit Zuständigem und Ablauf nach höchstens 14 Tagen, danach Alarm an Karl; Grenzen nie anheben, nur damit es grün wird. Falsche Board-Zahl: per Handtabelle plus Wächter reparieren, nie per Automatik, die richtige Zeilen mitverändert. Eine Lücke füllen oder eine falsche Zahl per Handtabelle reparieren ist keine große Entscheidung. [Teil 2, T1, G20]
- Dass die Screener-Daten öffentlich sind, nimmt Karl in Kauf, solange es nie etwas kostet. [13.10.]
- Insider-Daten wirken erst ab dem Handelstag nach `filed`; das gilt für jede künftige Insider-Familie und ist maschinell prüfbar (ein Test dafür fehlt noch, Stand 22.11.). [T7]
- Projekt-Bedeutung nie aus Feldnamen raten: fehlt sie im Auftrag, steht sie als Annahme in der Schlussmeldung. Das gilt auch für Zeilennamen in Abschlüssen; vor einem Abgleich die Lage der Zeile in der Rechnung prüfen (bei HIVE war „income from operations“ das Vorsteuerergebnis). [L7]
- Ändert sich ein geteilter Darstellungs-Baustein (Achse, Skala, Tooltip, Farblogik), jede Seite ansehen, die ihn nutzt, mit echten Größenordnungen; ein mitgelieferter Test ist kein Beleg für Richtigkeit, seine Annahme wird mitgeprüft. [L5]
- Eine wiederholte Hilfsfunktion kommt einmal ins vorhandene Helfer-Modul; vorher prüfen, wie oft ihr Aufrufpfad läuft. [L11]
- Für jede Arbeit hier gelten außerdem die Zeilen in den allgemeinen Regeldateien, Kern und Anhang (`C:\Users\Anwender\.claude\CLAUDE.md`, `C:\Users\Anwender\.codex\AGENTS.md`): Bruchtest des Wächters nur an Testdaten (T3, T9), echte Ausgabe und Feldnamen (T4), Abdeckungszahl mit Gegenrichtung (T8), Ticker ist nicht Firma (L8), Prüfkette bis zum Blick auf den Reiter, OneDrive-Gegenprobe und BOM, Verschwiegenheit bei laufenden Blindtests (L18, W15b), Sichern vor dem Löschen.
