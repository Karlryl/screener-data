# Design: Persistenter Kontext — Drei-Ebenen-Architektur (CLAUDE.md + Memory)

**Datum:** 2026-06-20
**Status:** Entwurf, vom User abgenommen (Abschnitte 1–3)
**Auslöser:** Frage des Users, wie man „die CLAUDE.md am besten updatet" — bzw. ob das der falsche Ansatz ist.

---

## 1. Problem

Der User wollte **dauerhaften Kontext**: Claude soll Projektstand, Speicherorte und Konventionen kennen, ohne dass er sich jede Session wiederholt. Die vermutete Lösung („CLAUDE.md updaten") setzt jedoch am falschen Punkt an. Die Erkundung ergab:

1. **Es existiert gar keine CLAUDE.md** — weder in `docGPT`, noch in `screener-data`, noch global unter `~/.claude`. Die einzige bisherige Lösung ist das auto-Memory-System.
2. **Der Kontext ist auf zwei getrennte, projekt-gekoppelte Memory-Stores zersplittert:**
   - `~/.claude/projects/…-docGPT/memory/` — 10 Dateien, **strategisch** (Autonomie, GateGuard, Projekt-Rahmen, Formel-Gauntlet, Vault-Orte, Qualität-only).
   - `~/.claude/projects/…-screener-data/memory/` — 11 Dateien, **operativ/technisch** (CI-Gates, Fixture-Hashes, Yahoo-Schema, Toolchain, Parallel-Race, GitHub-Auth).
   - Keine Session sieht je beide. Es existieren echte Dubletten (`autonomy-preference` vs. `autonomy_mode`), die auseinanderdriften.
3. **Der Workspace ist der falsche Ordner.** `docGPT` ist ein **leeres Repo** (Working-Tree enthält nur `.git`) eines fremden Projekts (ein „ChatGPT-für-Dokumente"). Die Screener-Arbeit läuft teils aus diesem leeren Ordner — und dort hängt die Hälfte des Gedächtnisses fest. `screener-data` ist das echte Repo (eigenes `.git`, Code, Audit-Reports) und hat weder CLAUDE.md noch AGENTS.md.
4. **Der User startet nachweislich aus mehreren Orten** — es existieren Projekt-Ordner für `docGPT`, `docGPT/.git` und `screener-data`. Auf die Frage „von wo startest du?" antwortete er „weiß ich nicht genau".

**Kernproblem (umgedeutet):** Nicht „die CLAUDE.md ist veraltet", sondern **Wissens-Fragmentierung + falscher Workspace**.

## 2. Ziel

Ein Setup, in dem jeder Fakt **genau ein Zuhause** hat, der richtige Kontext **automatisch am richtigen Ort** lädt, und es egal ist, wenn der User mal vergisst, von wo er startet.

Nicht-Ziele (YAGNI): keine globale CLAUDE.md, die Screener-Details in fremde Projekte schleppt; kein Tooling/Automatismus; keine inhaltliche Überarbeitung der einzelnen Fakten über die nötige Migration hinaus.

## 3. Architektur: drei Ebenen nach Lebensdauer der Information

Memory ist für **dynamische, sich entwickelnde** Fakten gemacht — nicht für **immer-gültige Regeln**. Deshalb Trennung nach Lebensdauer:

| Ebene | Ort | Lädt wann | Wofür |
|---|---|---|---|
| **① Du (global)** | `~/.claude/CLAUDE.md` | jede Session, egal von wo | Wer der User ist — gilt überall |
| **② Das Projekt** | `screener-data/CLAUDE.md` (versioniert) | beim Start aus screener-data | Stabile Projekt-Wahrheit & Prozesse |
| **③ Lebende Fakten** | `screener-data/memory/` | selektiv per Beschreibung | Dinge, die sich mit dem Code ändern |

**Leitprinzipien:**
1. **Keine Dubletten zwischen Ebenen.** Jede Info hat genau ein Zuhause, bestimmt durch ihre Lebensdauer. (Verhindert das heutige Drift-Problem.)
2. **`screener-data` wird der kanonische Workspace.** `docGPT` wird nicht mehr für Screener-Arbeit benutzt. Ebene ① ist das Sicherheitsnetz, falls der User sich verirrt.
3. **CLAUDE.md ist versioniert → keine Secrets.** Token/Auth-Mechanik bleibt in Memory (③), nie in der committeten CLAUDE.md.

## 4. Inhalts-Sortierung

### Ebene ① — `~/.claude/CLAUDE.md` (global)
- `autonomy-preference` **+** `autonomy_mode` → **ein gemergter Fakt**. Echte Dublette; gilt überall. Operative Details der reicheren screener-data-Version (/goal, Tag-Commits, „nicht refusen wenn lokale Validierung unmöglich") bleiben erhalten.
- `gateguard-off` → GateGuard aus + Shell via PowerShell-Tool (gilt für jede Arbeit an der Box).
- `toolchain_local` → „Was auf Karls Windows-Box verfügbar ist" (kein node lokal …), projektübergreifend.
- *(neu)* Deutsch antworten; User ist kein Quant/Dev (liest Ergebnisse, nicht Implementierung); **Pointer: Hauptprojekt = `screener-data` unter `C:\Users\Karlr\OneDrive\Dokumente\GitHub\screener-data` — dorthin orientieren, falls Session woanders startet.**

### Ebene ② — `screener-data/CLAUDE.md` (stabile Projekt-Wahrheit)
- `screener-quality-only-by-design` → Bewertung extern (Elliott-Wellen), Qualität-only, BUFFETT raus, Fitness-Rückgang nach Purity-Fix erwartet.
- `market-screener-project` (Teil) → Was das Projekt ist + **3 Pflicht-Test-Gates**.
- `formula-development-gauntlet` → Prozess Research → Council → Court (max Härte) → Retrial bis PASS.
- `screener-haertungs-loop` → **`screener-formel-ledger.md` = Source of Truth (zuerst lesen!)**, Fitness-Gate-Disziplin, Baseline, fitness/-Ordner.
- `no-cost-limit-loop` → Beim Loop nicht wegen Kosten drosseln/pausieren.
- `screener-research-vault-location` → Vault-Pfad `Jarvis\Knowledge\Trading\growth-screener` (≠ Code).
- `parallel_agent_race` → nie shared Registry-Files parallel editieren (Coordinator/Wave-Serialize).
- `audit_parallel_pattern` → /audit = 5 Agenten parallel, Commit je als Tag NNNa-e.

### Ebene ③ — `screener-data/memory/` (lebende Fakten)
`court-screen-data-gaps`, `formula-quality-audit-2026-06-20` (aus docGPT migrieren) sowie die bereits dort liegenden `fixture_hash_invariant`, `yahoo_finance2_schema_spam`, `dead_code_method_activation`, `ci_coverage_gate_calibration`, `workflow_triggers`, `github_auth`.

### Bewusste Grenzfall-Entscheidungen
- **„Stand Tag 239"** aus `market-screener-project` → **raus.** Git-Tags sagen den echten Stand; eine fixe Zahl veraltet sofort.
- **`ci_coverage_gate_calibration` & `workflow_triggers`** → Memory (③), nicht CLAUDE.md. Eher „wie Code/CI gerade tickt" als ewige Regel.

## 5. Migrations- & Aufräumplan

**Aufbau (additiv, nichts geht verloren):**
1. `~/.claude/CLAUDE.md` anlegen (Ebene ①). Existiert nicht → kein Überschreiben. Falls doch vorhanden: mergen statt clobbern.
2. `screener-data/CLAUDE.md` anlegen (Ebene ②) — 8 stabile Fakten zu sauberer Prosa gemergt, keine Secrets.
3. Die 2 strategischen ③-Fakten (`court-screen-data-gaps`, `formula-quality-audit-2026-06-20`) ins `screener-data/memory/` migrieren + dortigen `MEMORY.md`-Index ergänzen.

**Aufräumen (heikel → mit Sicherung):**
4. docGPT-`MEMORY.md` auf einen Einzeiler-Wegweiser eindampfen („Screener-Kontext lebt jetzt in screener-data — dort starten"); die 10 Altdateien **vorerst liegen lassen**.
5. **Löschen der Altdateien = separater Schritt, nur nach ausdrücklichem OK des Users** (Regel: nie ohne Rückfrage löschen), erst nachdem in einer echten screener-data-Session bestätigt wurde, dass alles ankommt.

**Festschreiben:**
6. `screener-data/CLAUDE.md` ins screener-data-Repo committen. Memory liegt unter `~/.claude` → wird *nicht* committet.
7. Diesen Spec nach `screener-data/docs/superpowers/specs/` committen.

**Reihenfolge-Logik:** Erst alles Neue aufbauen und gegenprüfen, *dann* erst das Alte anfassen. Zu keinem Zeitpunkt existiert ein Fakt nur an einem halb-fertigen Ort.

## 6. Verifikation

- Nach Aufbau prüfen: `~/.claude/CLAUDE.md` und `screener-data/CLAUDE.md` existieren, wohlgeformt, ohne Secrets, ohne Dubletten zur jeweils anderen Ebene.
- `screener-data/memory/MEMORY.md`-Index listet die 2 migrierten Fakten.
- Voller Load-Test (lädt CLAUDE.md beim Start aus screener-data?) erfordert eine echte Session aus screener-data heraus — explizit als manueller Abnahmeschritt durch den User markiert, bevor Schritt 5 (Löschen) freigegeben wird.

## 7. Offene Punkte / Risiken

- **Gewohnheits-Umstellung:** Der User muss sich angewöhnen, aus `screener-data` zu starten. Ebene ① mildert Fehlstarts ab, ersetzt die Gewohnheit aber nicht.
- **Doppelte Pflege vermeiden:** Disziplin nötig, neue stabile Regeln in CLAUDE.md zu schreiben statt in Memory (und umgekehrt). Prinzip 1 ist die Leitplanke.
- **`docGPT`-Sessions** bleiben technisch möglich; der Wegweiser (Schritt 4) fängt sie ab.
