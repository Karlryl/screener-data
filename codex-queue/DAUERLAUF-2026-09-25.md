# Codex-DAUERLAUF 2026-09-25 — Regeln, Lane-Zuweisung, Queue-Stand (beide Repos)

Diese Datei ist die Steuer-Datei fuer die 8 Codex-Chats (Lanes L1–L8) vom 25.09.2026.
Sie ergaenzt die Queues vom 24.09. (Task-Texte bleiben dort) und ERSETZT deren Zeitplan-
und Worktree-Regeln. Bei Widerspruch gilt: diese Datei > QUEUE.md > AGENTS.md > Bequemlichkeit.

Quellen (immer per `git fetch` frisch holen, sie koennen sich waehrend des Laufs aendern):
- Regeln + Lanes (diese Datei): `git show origin/claude/sweet-pascal-w2u2xa:codex-queue/DAUERLAUF-2026-09-25.md`
- Task-Texte screener-data: `git show origin/claude/codex-limit-optimization-2u1g6h:codex-queue/QUEUE.md` (S01–S66)
- Task-Texte findash (im findash-Repo): `git show origin/claude/codex-limit-optimization-2u1g6h:codex-queue/QUEUE.md` (F01–F86)
- Konflikt-Audits: `codex-queue/AUDIT-screener-data-2026-09-24.md` bzw. `codex-queue/AUDIT-findash-2026-09-24.md` (gleicher Branch)
- Tagesplan Claude: `codex-queue/PLAN-2026-09-25.md` (Branch `claude/sweet-pascal-w2u2xa`)

Variablen:
- MODELL = GPT-6 Astra (`gpt-6-astra`), EFFORT = max — fuer den Koordinator UND jeden Subagenten.
- REPO-PFAD = `C:\Users\Anwender\OneDrive\Dokumente\GitHub\<screener-data|findash>`
- VAULT-LOG = `C:\Users\Anwender\OneDrive\Dokumente\GitHub\Jarvis\Knowledge\Trading\growth-screener\agent-reports\dauerlauf-2026-09-25\L<n>.md`
- WORKTREE-POOL = `..\codex-wt\<REPO>\L<n>-1` … `L<n>-4` (plus `L<n>-log`)
- HAUPTZWEIG = `main` (screener-data) bzw. `master` (findash)
- ENDE = keines. Dauerlauf bis Karl im Chat woertlich `STOPP` schreibt.

---

## 1. DAUERLAUF-PROTOKOLL (bindend fuer alle 8 Lanes)

### 1.1 Rolle
- Du bist KOORDINATOR deiner Lane. Du implementierst NICHT selbst. Je Task startest du drei
  Subagenten: IMPLEMENTIERER (Brief = Regeln + Task-Text + Worktree), REVIEWER (Diff gegen
  Brief: TABU-Pfade, Test-Abschwaechung, Loeschungen, Verifikation selbst laufen lassen),
  NACHLAUF (Break-once jeder neuen Testdatei + komplette Repo-Suite im Worktree, Ergebnis als
  PR-Kommentar). Mehrere Tasks gleichzeitig: Ziel >= 8 Subagenten GLEICHZEITIG je Lane
  (Karl-Ziel 50 ueber alle Lanen). Sobald einer fertig ist, startest du den naechsten.
- Jeder Subagent laeuft mit `gpt-6-astra` und Effort `max` (Codex-Konfiguration
  `model_reasoning_effort = "max"`; wenn deine Version das nicht je Subagent erlaubt, den
  hoechsten verfuegbaren Wert nehmen und das EINMAL im Log vermerken).
- Gibt es in deiner Codex-Version keine Subagenten: sequentiell arbeiten, EINE Zeile im Log.

### 1.2 Zustaendigkeit und Claim
- Du bearbeitest NUR die Tasks deiner Lane (Abschnitt 2/3), in der dort genannten Reihenfolge,
  soweit Voraussetzungen erfuellt sind. Fremde Lane-Tasks erst, wenn deine Liste UND deine
  Wiedervorlage leer sind — dann nur Tasks, deren Dateiraum deinen nicht verlaesst.
- Claim vor jedem Task (verhindert Doppelarbeit ueber Lanes):
  `git push origin origin/<HAUPTZWEIG>:refs/heads/codex/<ID>` — schlaegt der Push fehl, weil
  der Branch existiert, ist der Task vergeben (oder gestern schon gelaufen): naechsten nehmen.
  Existierende `codex/<ID>`-Branches vom 24.09. (S01 S05 S06 S07 S09 S10 S14 S18 S26) sind
  PRs und gehoeren L1.
- Tasks mit STATUS `CLAUDE bearbeitet` / `UEBERSPRINGEN` / `ENTFAELLT` in der QUEUE nie starten.

### 1.3 Worktree-Pool (neu, ersetzt „Worktree je Task")
- Je Lane genau 4 Arbeits-Worktrees `..\codex-wt\<REPO>\L<n>-1..4` (relativ zum Repo-Ordner)
  plus `..\codex-wt\<REPO>\L<n>-log`. Anlegen einmalig:
  `git fetch origin <HAUPTZWEIG> && git worktree add ..\codex-wt\<REPO>\L<n>-1 origin/<HAUPTZWEIG>`
  (findash zusaetzlich je Worktree `npm ci` im Root und `cd web && npm install` — NICHT
  `npm ci` in web/, solange F07 nicht gemerged ist; `web/package-lock.json` nie committen).
- Neuer Task in einem freien Worktree: `git fetch origin && git checkout -B codex/<ID> origin/<HAUPTZWEIG>`.
  Nach dem Push bleibt der Branch auf origin; der Worktree wird fuer den naechsten Task
  wiederverwendet. Nie `git worktree remove`, nie Karls Haupt-Working-Tree anfassen.
- Stapel-Basis: Haengt ein Task an einem noch nicht gemergten Branch (z. B. `claude/S35`,
  `codex/S26`, `claude/F27`), darfst du von diesem Branch aus starten
  (`git checkout -B codex/<ID> origin/<basis>`), MUSST das aber im PR-Body unter
  `## OFFEN / RISIKO` als „Stapel auf <basis>, schrumpft nach dessen Merge" nennen.

### 1.4 Verifikation (vor JEDEM Push, lokal, vollstaendig)
- screener-data: `node scripts/test-gate.js --selftest` und `node scripts/test-gate.js --mode=all`
  (exakt das faehrt der PR-Check). Lokal bekannt rot und KEIN Defekt: `tests/scoring/calibration-ref.test.js`
  (Block R2.9 Test B) und `tests/waehrung-ausliefer-waechter.test.js` (LIVE-Block). Deshalb NICHT nur
  den Exit-Code lesen, sondern die `Test failed:`-Zeilen: erlaubt sind genau diese zwei. Jede dritte
  rote Datei stoppt den Task. Die Zeile `UEBERSPRUNGEN (0 Pruefungen …): 7 — tests/scoring/…` ist
  bei leerem `snapshots/` normal (auch in gruenen CI-Laeufen) und kein Fehler.
- findash: `npm ci` (Root), `cd web && npm install && npm run build && cd ..`, `npm test`,
  `cd web && npx tsc --noEmit && cd ..`, `npm run typecheck:e2e`, `cd web && npm run test:render`.
  (Das ist die Reihenfolge des CI-Jobs „Unit-Tests"; Node 24 wie in CI — unter Node < 22.18 sind
  zwei Testdateien faelschlich rot.) e2e (`npx playwright test`) nur L8 und nur fuer e2e-Tasks.
- Break-once: jede neue Testdatei einmal per Sabotage rot sehen (Funktion unter Test auf
  `() => null` stubben oder die Zusicherung invertieren), Exit != 0 zeigen, zuruecksetzen; Ausgabe in den PR-Body.
- Vor dem Push: `git fetch origin && git merge origin/<HAUPTZWEIG>` (KEIN Rebase auf bereits
  gepushten Branches, kein Force-Push), danach die Suite erneut.

### 1.5 PR-Format
- Push `codex/<ID>`, dann `gh pr create --base <HAUPTZWEIG> --title "<ID>: <Betreff>"` mit Body:
  ```
  ## ERGEBNIS
  <3-6 Zeilen>
  ## VERIFIZIERT
  <exakte Befehle + Exit-Codes / Zaehler vorher -> nachher; Break-once-Ausgabe>
  ## REVIEW
  <Befund des Reviewer-Subagenten, woertlich>
  ## OFFEN / RISIKO
  <was nicht ging, Stapel-Basis, was Karl/Claude pruefen soll>
  ```
- Nachlauf-Subagent kommentiert den PR (`gh pr comment`) mit Suite-Ergebnis + Break-once.
- Nicht gruen nach 2 ernsthaften Anlaeufen: PR als DRAFT mit Diagnose oeffnen, Task auf deine
  WIEDERVORLAGE setzen, weitergehen. Kein Task blockiert dich laenger als 45 Minuten am Stueck —
  aber nichts wird aufgegeben: Wiedervorlage stuendlich erneut versuchen.
- Commit-Text: screener-data `Tag <n>: <Betreff>` (n = hoechste Tag-Nummer im Log + 1; Kollisionen
  zwischen Lanes sind ok, Karl nummeriert beim Merge), findash kurzer Imperativsatz. Gezielt per
  Pathspec committen, vorher `git status --short`.

### 1.6 Log-Pflicht (fortlaufend, append-only)
- VAULT-LOG `…\agent-reports\dauerlauf-2026-09-25\L<n>.md` (Ordner anlegen, falls fehlt).
  Kopf: Lane, Repo, Start, Modell/Effort, Subagenten-Konfiguration.
  Nach JEDEM abgeschlossenen Task ein Block:
  `## <hh:mm> <ID> — <Status gruen|draft|wiedervorlage>` mit PR-URL, Verifikations-Befehl + Exit,
  Dauer, Anzahl Subagenten, 1 Zeile Lektion.
  Alle 20 Minuten eine Heartbeat-Zeile: `- <hh:mm> laufend: <IDs>, Subagenten aktiv: <n>, Wiedervorlage: <IDs>`.
- Log-Branch (damit Claude in der Cloud mitlesen kann): Worktree `..\codex-wt\<REPO>\L<n>-log`
  auf Branch `codex/log/L<n>-20260925` (von origin/<HAUPTZWEIG>), einzige Datei
  `codex-queue/logs/2026-09-25/L<n>.md` = Kopie des Vault-Logs. Stuendlich committen
  (`log L<n>: <hh:mm>`) und `git push origin codex/log/L<n>-20260925`.
- Im Chat nach jedem Task 3 Zeilen: ID | PR-URL | gruen/draft + was als naechstes laeuft.
- Berichte zaehlen Ergebnisse (PRs, Zaehler vorher -> nachher, gefundene Defekte), nicht Prozessschritte.

### 1.7 NIEMALS AUFHOEREN — Selbst-Nachschub-Protokoll
Wenn deine Lane-Liste leer ist (oder alles Offene blockiert):
1. WIEDERVORLAGE zuerst (Draft-PRs gruen machen, blockierte Tasks nach Merge der Voraussetzung).
2. PR-PFLEGE der eigenen PRs: CI-Status pruefen (`gh pr checks`), nach Merges auf dem Hauptzweig
   `git merge origin/<HAUPTZWEIG>` + Suite + Push.
3. NEUE TASKS aus dem Entdeckungsverfahren deiner Lane (Abschnitt 2/3, „Selbst-Nachschub").
   Jeder neue Task bekommt ID `<Lane>-N<nn>` (z. B. `L3-N01`), einen Brief im Vault-Log im Format
   ZIEL / ZIEL-DATEIEN / VERBOTEN / FERTIG-WENN / VERIFIKATION und wird VOR dem Start von einem
   Reviewer-Subagenten gegen TABU-Liste, Anti-Bloat („im Zweifel weglassen") und die Lane-Grenzen
   freigegeben. Erlaubte Klasse: Tests, Robustheit, Doku-Drift, Portabilitaet, Messwerkzeuge,
   kleine Refactorings ohne Verhaltensaenderung. Verboten: Scoring/Formeln/Methoden/Architektur,
   neue Features, neue Dependencies, UI-Umbauten, alles auf der Karl-Entscheidungsliste (PLAN Abschnitt 5).
4. Ist wirklich nichts offen: Suite dreimal fahren und Flakes protokollieren, offene PRs der eigenen
   Lane gegen den Brief nachlesen, Testlaufzeiten messen. Nie laenger als 5 Minuten untaetig; kein
   `Start-Sleep` ueber 300 s.
5. Codex-Wochenlimit erreicht: Stand ins Log und in den Chat, dann stuendlich erneut versuchen —
   nicht beenden. Nur Karls `STOPP` beendet die Lane; danach Schlussbericht (Tabelle
   ID | PR-URL | Status | Verifikations-Befehl, dann Liste OFFEN) und nichts mehr pushen.

### 1.8 HARTE VERBOTE (gelten ueber allem)
Nie Dateien loeschen; nie Tests abschwaechen (kein skip/only/todo/fixme, keine gelockerten
Assertions, keine geloeschten Faelle); nie TABU-Pfade (`.codex-deny.txt` + QUEUE-Regelblock;
screener-data zusaetzlich `src/scoring/**`, `methods/**`, `tests/scoring/**`, `.github/**`,
`*-history/`, `earnings-calendar.json`, `README.md`, `docs/findash-export-v1*`; findash
`data/**`, `deploy/**`, `.github/**`, Root-`public/*`, `server.js`-Routen nur additiv); nie
Force-Push/History-Rewrite; nie Scoring/Formeln/Methoden/Architektur; keine neuen Dependencies;
keine kostenpflichtigen Calls; kein Netz in Tests; nie `.env` oder Secrets ausgeben; nie
`prettier --write` auf `web/src/routes/index.tsx` (byte-gelockt, `web/.prettierignore`);
`picks-history/` ist inhaltlich eingefroren. Temp-Fixtures in `os.tmpdir()` immer aufraeumen.

---

## 2. LANES screener-data (L1–L4)

Dateiraum-Trennung (Kollisionsfreiheit nach Audit 24.09.):
- L1 = bestehende PR-Branches `codex/*` (S01 S05 S06 S07 S09 S10 S14 S18 S26) + `claude/S*`-PRs + Gate-Laeufe.
- L2 = `lib/*.test.js`, `tests/*.test.js` (nicht `tests/scoring/`), `tests/_mutations-*`; lib-Produktivcode nur S12 (frueh).
- L3 = `scripts/` SEC-/Pull-/Backfill-/DUP-Kette + Root-Pull-Skripte (`pull-*.js`, `refresh-universe.js` nur S31-Rest).
- L4 = isolierte Skripte (Mess-/Report-/Watch-Skripte), Harness, `index.html`, Docs, Skills; S17 zuletzt.

### L1 · screener-data · PR-Pflege, Merge-Vorbereitung, Gate
Start-Tasks in dieser Reihenfolge:
1. **PR 361 (S26) gruen machen.** Ursache (Claude 25.09., lokal reproduziert): `tests/reconcile-smallcap.test.js`
   Faelle g1–g5 rot mit `"undefined" is not valid JSON`. Der Test (Z. 318–356) ersetzt per `Module._load`
   NUR fuer `parent.filename === script && request === 'fs'` das fs des Skripts durch einen In-Memory-Stub.
   S26 hat `readJson` aus `scripts/reconcile-smallcap.js` nach `lib/read-json.js` verlagert; der Leser
   nutzt jetzt das echte `fs` von lib und umgeht den Stub. Option A (empfohlen, kleinster ehrlicher Diff):
   `scripts/reconcile-smallcap.js` aus S26 herausnehmen (lokales `readJson` bleibt), Zaehler im PR
   auf 20 -> 7 korrigieren und den Grund nennen. Option B: Test-Stub um `request === '../lib/read-json.js'`
   erweitern, der `readJsonOrNull` aus `files` bedient — nur wenn der Reviewer bestaetigt, dass alle
   g-Faelle dieselben Zusicherungen behalten (keine Abschwaechung). Danach `origin/main` einmergen, Suite, Push.
2. **PR 360 (S18) gruen machen.** CI-Log: `Test failed: tests/early-detection-siegel-wachposten.test.js`
   und `tests/studie-protokoll-freeze-wachen.test.js`. Beide sind Siegel-/Freeze-Waechter, die
   registrierte lib-Dateien hashen (freeze-wachen Z. 119–131: `lib/ledger-single-appender.js` + Probe,
   sha256 ueber LF-normalisierte Bytes; siegel-wachposten Z. 84: Eltern-Manifest des early-detection-
   Siegels -> dessen Mitgliedsdateien). Die S18-Praemisse „kein Test hasht lib-Quelltext" war falsch.
   Fix: in JEDER versiegelten Datei die JSDoc-Aenderung zuruecknehmen (`git checkout origin/main -- <datei>`),
   im Waechter `tests/jsdoc-exports.test.js` eine `VERSIEGELT`-Liste mit Grund (welcher Waechter,
   welche Zeile) — versiegelte Dateien werden gemeldet, nicht verlangt — Sollzahlen im PR anpassen.
   Re-Seal ist Karl/Claude-Sache (Branch `claude/siegel-reseal-20260830`), nie Codex. Voller Gate-Lauf.
3. **Alle 9 offenen PRs (354–362)** auf aktuellen `origin/main` bringen (merge, kein rebase), Suite, Push;
   Draft-Status aufheben, wenn gruen und der Brief erfuellt ist (357/S10: laut Audit ~80 % Doppelarbeit
   mit S14/S37/S38/S53 — im PR-Body als Hinweis fuer Karl vermerken, nicht schliessen).
4. **Merge-Reihenfolge-Doku** `codex-queue/logs/2026-09-25/MERGE-REIHENFOLGE-screener-data.md` auf deinem
   Log-Branch: Tabelle PR | Branch | CI | Konflikte mit | empfohlene Tag-Nummer | Reihenfolge (Audit-
   Tabellen 1 und 4 als Grundlage). Nach jedem Merge durch Karl aktualisieren.
5. **PRs fuer die 12 Claude-Branches** `claude/S22 S24 S25 S35 S36 S37 S38 S43 S49 S53 S59 S62` oeffnen
   (head = der Claude-Branch, base = main, KEINE Aenderung an der Historie): vorher je Branch in einem
   Worktree Suite fahren und den Diff gegen TABU/Test-Abschwaechung lesen; PR-Body im MELDEFORMAT mit dem
   Bericht aus dem Branch-Commit. Ist etwas rot: additiver Fix-Commit auf dem Claude-Branch, im Body nennen.
6. **S04** (Voll-Gate-Befund als `reports/codex-gate-lauf-2026-09-25.md`, PR) — nutzt spaeter `scripts/test-laufzeit.js` aus S44 (L4), bis dahin Tabelle von Hand.
Dauerbetrieb: alle 30 Minuten `gh pr list --state open` + `gh pr checks` fuer alle offenen PRs beider
Herkuenfte (`codex/*`, `claude/S*`); Rot in Reichweite fixen, nach Karl-Merges alle offenen PRs nachziehen.
Selbst-Nachschub: `::warning::`-Zeilen der Gate-Laeufe triagieren (je Warnung: Ursache, Task-Brief oder
„bewusst so" mit Beleg); Suite 3x fahren, nicht-deterministische Dateien listen; PR-Reviews der anderen
Lanes gegenlesen (Findings als Kommentar, Fix bleibt bei der Lane).
Nicht deins: neue Queue-Tasks S02–S66 (ausser S04), Produktivcode ausserhalb der PR-Fixes.

### L2 · screener-data · lib/ und tests/ Haertung (Mutations-/Coverage-Kette)
Reihenfolge: **S12** (frueh, weil lib/atomic-write.js und lib/fetch-retry.js spaeter von L3 S27/S28
angefasst werden) -> **S16** (nach S14 = PR 359; Stapel auf `origin/codex/S14`, bis gemerged) -> **S11**
-> **S54** (nach S12) -> **S55** -> **S02 gekuerzt** (Audit Abschnitt 2: nur `ledger-single-appender`,
`fetch-retry._internals.warteAufSlot`, zip-stream-Roundtrip Store/Deflate; NICHT ledger-single-appender
per JSDoc anfassen, die Datei ist versiegelt — nur testen) -> **S60** (nutzt `lib/env-key.js` aus
`claude/S25`; Stapel erlaubt) -> **S61** -> **S32** -> **S30** (Sollwerte auf `corruptYoung`,
`ftsCacheParse` reduziert, weil S14 `hitRate` lebendig macht) -> **S15** (nach S16 und nach Merge/Stapel
von `claude/S22` + `claude/S25`; 3 geteilte Testdateien mit S16 -> S16 zuerst) -> **S13** (zuletzt,
nach S47/L4 und S28/L3; pinnt das Endformat).
Selbst-Nachschub: mit dem S09-Werkzeug (`origin/codex/S09`: `node scripts/test-coverage-report.js
--tests "lib/*test.js,tests/*test.js" --fns`) die schwaechsten lib-Dateien messen und je Datei einen
Test-Task briefen; mit der S14-Probe (`tests/_mutations-probe.js`) Ueberlebende in `tests/` suchen
(Paar-Dateien `tests/_mutations-pairs/L2-*.json`); Tests ohne Zusicherung, `doesNotThrow`-only,
stille Skips, Tests > 10 s (S44-Harness sobald vorhanden).
Nicht deins: `scripts/*.js`-Produktivcode (L3/L4), `tests/scoring/**` (TABU), Docs (L4).

### L3 · screener-data · scripts/ SEC-/Pull-/DUP-Kette
Reihenfolge: **S50** -> **S51** -> **S42** -> **S57** -> **S58** -> **S20** -> **S52** (nach `claude/S24`;
Stapel erlaubt) -> **S27** (nach S26 = PR 361; Stapel auf `origin/codex/S26`; erst NACH S50/S51/S42 in
dieser Lane und nach Merge/Stapel von `claude/S36` + `claude/S43`, weil dieselben Dateien) -> **S28** ->
**S29** -> **S31** (OHNE den refresh-universe-Teil, solange `claude/S35` nicht gemerged ist; Soll 37 -> 40
Keys; `fetch-secbulk.js`-Exporte erst nach S42) -> **S21** -> **S39**.
Regel: jede Datei aus Audit-Tabelle 1 -> vor dem Push `git merge origin/main` und die dort genannten
Bestandstests erneut. `scripts/coverage-gate.js` (S26) ist der PULL-Coverage-Gate aus daily-pull.yml:
dort nur den Leser tauschen, nichts sonst.
Selbst-Nachschub (statische Scans ueber `scripts/*.js`, `pull-*.js`, `discovery/*.js`; je Fund ein
Brief): Schreib-/Lesestroeme ohne `'error'`-Zuhoerer; nackte `JSON.parse` auf Fremddaten ohne Pfad in der
Fehlermeldung; Env-Zahlen ohne NaN/0-Wache (`% 0`, Endlosschleifen); Unix-Shell-Outs (`unzip`, `curl`,
`bash -lc`) ohne Windows-Pfad; fehlende `require.main`-Guards; byte-gleiche Helfer-Kopien (S30-Werkzeug).
Nur melden, nicht bauen: alles, was Netz-Verhalten in Produktion aendert (Retry-Zeiten, Rate-Limits).
Nicht deins: Mess-/Report-/Watch-Skripte (L4), Tests ausserhalb deiner Task-Briefe (L2), Docs (L4).

### L4 · screener-data · isolierte Skripte, Harness, Doku, Skills (S17 zuletzt)
Reihenfolge: **S44** (Laufzeit-Harness, entblockt S04/L1) -> **S48** -> **S47** (importiert `mdCell` aus S48)
-> **S08** -> **S40** -> **S41** -> **S56** -> **S45** -> **S46** -> **S34** -> **S23** -> **S33** -> **S19**
-> **S63** -> **S64** -> **S66** -> **S65** (nach S63) -> **S17** (ZULETZT: Ausschlussliste
`t135-paritaetsluecke.js`, `t-veraltung-zwei-definitionen.js`, `t-kdrift-signatur.js` — gepinnt durch
S07/S08 — und alle Skripte, die L3 in seinen offenen PRs gerade aendert; vorher `gh pr list` lesen).
Selbst-Nachschub: Doku-Drift (Backtick-Pfade in `docs/**`, `AGENTS.md`, Skills gegen `ls`), tote Links in
`index.html`/`outputs/*.html`, Skripte ohne `--help`, CLIs mit Exit 0 bei unbekannter Option (nur melden,
Karl-Punkt 8), Laufzeit-Ausreisser aus dem S44-Harness (je Ausreisser ein Brief fuer L2), SUPERSEDED-Banner
fehlend. Nicht deins: SEC-/Pull-Skripte (L3), lib/ (L2), Scoring-Docs-Inhalte (Engine-Wahrheit = README/docs, TABU).

---

## 3. LANES findash (L5–L8) — Kurzfassung; Volltext im findash-Repo `codex-queue/DAUERLAUF-2026-09-25.md`

- **L5 · Backend** (`data-layer/`, `server.js` additiv, `test/`): F04 F23 F24 F26 F10 -> F11 F32 F35 F36 F37
  F56 F61 F63 -> F25 (nach `claude/F27`, Stapel) -> F16 -> F20 -> F29 (nach `claude/F03`+`F28`, Stapel)
  -> F59, F65 nur als DRAFT „Karl-Entscheid Routen nur additiv".
- **L6 · web/test + web/src/lib** (nie `routes/index.tsx`, nie `lib/api.ts`): **F07 ZUERST**, dann F12 F17 F18
  F19 F53 F55 F79 F80 F81 F82 F83 F84 F85 F86 F73 -> F75 -> F76 F74 F71 F08 F02 (verengt).
- **L7 · index.tsx/api.ts seriell** (einzige Lane, die diese zwei Dateien schreibt): F13 Batch 1–5 -> F46 -> F47
  -> F48 -> F49 -> F50 -> F51 -> F45 (nur index.tsx-Anteil) -> F66 -> F69 -> F67 -> F77 ∥ F70 -> F15 (nach
  `claude/F68`+`F72`, Stapel) -> F13 Batch 6 -> F01 (zuletzt).
- **L8 · PR-Pflege + e2e**: PRs fuer die 22 `claude/F*`-Branches, CI-Wache aller findash-PRs, Actions-Minuten
  (privates Repo), dann e2e-Kette F40 -> F41 -> F44 -> F42 -> F45 (e2e-Anteil) -> F05 -> F14 (zuletzt).

---

## 4. Queue-Stand 25.09. (morgens, von Claude verifiziert)

screener-data (S01–S66):
- PR offen, CI gruen: S01 (#354), S05 (#355), S06 (#356), S07 (#358), S09 (#362, Draft), S10 (#357, Draft), S14 (#359).
- PR offen, CI rot: S18 (#360, Draft), S26 (#361, Draft) — Ursachen oben (L1).
- Claude-Branch fertig, kein PR: S22 S24 S25 S35 S36 S37 S38 S43 S49 S53 S59 S62 (L1 oeffnet PRs).
- Entfaellt: S03 (Bestand deckt). Offen fuer Lanes: alle uebrigen, Zuordnung Abschnitt 2.
findash (F01–F86):
- Keine Codex-PRs vom 24.09. Claude-Branch fertig, kein PR: F03 F06 F09 F21 F22 F27 F28 F30 F31 F33 F34 F38
  F39 F43 F54 F57 F58 F60 F62 F64 F68 F72 (L8 oeffnet PRs). Entfaellt: F52. Offen: alle uebrigen (Abschnitt 3).
Hauptzweige: screener-data `main` @ e803a15 (24.09., chore board-history), findash `master` @ 79efe01 (21.09.).

## 5. Bekannte Fallen
- screener-data lokal: zwei bekannt rote Tests (1.4). `snapshots/` ist im Worktree leer -> 7 scoring-Dateien
  „UEBERSPRUNGEN", normal. Vier `studie-*`-Tests brauchen vollstaendige Git-Historie (kein shallow clone).
- findash: `cd web && npm ci` bricht ab bis F07 gemerged ist -> `npm install`, Lockfile nie committen;
  `web/src/routes/index.tsx` nie formatieren; CI laeuft auf Node 24; e2e braucht Chromium (`npx playwright install chromium` ist erlaubt, kein kostenpflichtiger Call).
- Tag-Nummern kollidieren ueber Lanes (ok). Alle PRs vom 24.09. tragen „Tag 1369/1370".
- OneDrive: Worktrees liegen unter `..\codex-wt` (Konvention vom 24.09.); OneDrive-Sync nicht anhalten,
  aber grosse `node_modules` nur im Worktree-Pool (4 je Lane), nicht je Task.
