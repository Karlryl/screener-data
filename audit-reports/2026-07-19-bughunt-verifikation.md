# ChatGPT-Bug-hunt — Verifikation & Fix-Nacht 2026-07-19

> Auftrag (Karl): alle 198 Findings des ChatGPT-Audits pruefen (echt oder nicht) und die echten fixen.
> Rollen: Fable plant/ueberwacht, Opus prueft (23 Verifikations- + 31 Review-Agenten), Sonnet fixt (31 Fix-/Refix-Agenten).
> Baseline: `04053462b4` (== Audit-Stand, == origin/main bei Start). Endstand: `38d0f75a3b` (Tags 356–383) + findash `99ddcda`.

## Was ist rausgekommen

- **Verdikt ueber 198 Findings:** 182 bestaetigt, 15 teilweise, 1 widerlegt (BH-192). Kein einziges unpruefbar.
- **Schweregrad-Neubewertung (unabhaengig vom Audit-Label):** 1× KRITISCH (BH-038), 33× HOCH, 95× MITTEL, 55× NIEDRIG, 14× HINWEIS. ChatGPTs "19 KRITISCH / 103 HOCH" war stark ueberzeichnet — die Mechanismen stimmen fast immer, die Wirkungs-Einschaetzung oft nicht.
- **184 Findings gefixt** in 28 Tag-Commits (356–383) + 2 findash-Commits, jeder Batch mit eigenem hermetischem Testfile und adversarialem Opus-Review. **4× "bereits korrekt"** (Behauptung stimmte zum Fix-Zeitpunkt nicht mehr; Pin-Tests ergaenzt). **11× bewusste Karl-Weiche** statt Autonomie-Fix → `_KARL-ENTSCHEIDE.md` Block "AUDIT-NACHT 19.07.".
- **Wichtigster Einzelfund bestaetigt und gefixt:** BH-038 — der Universe-Refresh brach am inkompatiblen Yahoo-Screener-Call mit exit(1) ab, BEVOR irgendein Laenderadapter lief; CI schluckte das gruen. Seit Tag 360 laufen die Adapter unabhaengig, der API-Vertrag ist repariert, der Ausfall waere rot.
- **Methodik (rank-ic, uebernommener E-7-Slot):** M2 ✔ (Residual-Power-Gate), M3 weitgehend ✔ (BY-Familie ohne Vorauswahl, p=1 fuer unterpowerte), M4 ✔ (UND-Konjunktion max(p_raw,p_resid), Berger-IUT), alles Tag 358. **R2.11/BH-148: Block-Bootstrap exakt nach eingefrorener Ledger-Spez gebaut — Anker-Beweis ROT:** Ueberdeckung bei ρ=0,6 nur 62,1 % (alt-IID 54,4 %, gefordert ≥85 %; Blocklaenge 5 braechte 65,2 %). Die Spezifikation selbst unterdeckt bei n≈20 → E-20260719-1 (HART). Milderung: nEff-Gate faengt ~57 % der ρ=0,6-Faelle als "unterpowert", rank-ic ist rein diagnostisch.

## Warum so entschieden

- **Kein Fund wurde dem Audit geglaubt:** jedes Verdikt stammt aus einer eigenen Opus-Pruefung gegen den Code auf exakt der Audit-Baseline, mit Pflicht zur Gegenbeweis-Suche; Store-Behauptungen wurden per Scan reproduziert (z. B. 28.025 Wochenendbars, 19.774 nichtpositive Closes, KLAC-Faktor-10-Bars — alle exakt bestaetigt).
- **Fixes minimal am Root-Cause**, nie am Symptom; Schutzpfade (picks-history/, methods-history/, earnings-calendar.json) unberuehrt; keine neuen Dependencies; nichts geloescht (einzige Ausnahme: toter Messlauf-1-Codepfad INNERHALB von probe-smallcap-coverage.js, per Verdikt empfohlen).
- **Grundsatzweichen (Restatement-Policy, PIT-Schema, Insider-Consumer, Bootstrap-Spez, …) wurden NICHT autonom gestellt** — sie stehen mit Default-Vorschlag in der Queue. Methodik-Reparaturen Richtung Praeregistrierung (FDR-Familie, Block-Bootstrap nach Ledger-Wortlaut) galten als Reparatur, nicht als Neu-Design.
- **Delta-Uebergabe der Nacht-Session 18.07. eingearbeitet:** Tags 350–355 waren in der Baseline (Audit-Schweigen ≠ Freispruch); deren Testdateien blieben unangetastet und laufen gruen; die 4 offenen Nacht-Flags stehen in der Queue (E-20260719-7); BH-038-Karl-Entscheid (erst exit(1)-Blocker) war schon durch Tag 360 erfuellt.

## Woran verifiziert

- **Volle Suite nach beiden Wellen: 101 Testdateien, 100 gruen.** Einziger Fail: `tests/discovery/szse-cn.test.js` — Live-Test gegen Shenzhen-Endpoint, von dieser Box ECONNREFUSED (Geo/Netz), nachweislich VOR unseren Aenderungen identisch; kein Codefehler.
- 30 neue hermetische Testdateien `tests/scoring/bh-*.test.js` (je Batch), plus modernisierte SEC-/13F-/Canary-Smokes; alle 6 geaenderten Workflow-YAMLs per PyYAML geparst; TSX-Live-Probe vor/nach Fix verglichen (hyphen=0 war vorbestehend, Filter entfernt nur .PR/.P/.WT: TSXV 1503→1345).
- Jeder Batch: adversarialer Opus-Diff-Review (pass erst nach Nachbesserung); 6 Batches brauchten eine Refix-Runde.
- Kalibrierungs-Batch (Tag 376): tests/scoring-Suite (57 Dateien) vor UND nach den Fixes gruen, **kein Fixture-Hash-Flip** — die Achsen-Reparaturen aendern die Anker-Scores nicht.
- R2.11-Anker: Simulationsrezept aus `_R-GATE-2R-BEFUNDE` §R2.11 (AR(1), n=20, Produktions-B=2000, T=1500) gegen die NEUE bootstrapCI gefahren; Zahlen oben.

## Offen / bewusst nicht gemacht

- 19 Entscheidungs-Findings + R2.11-Anker + M1-Vorfrage + 4 Nacht-Flags → `_KARL-ENTSCHEIDE.md` ⟪AUDIT-NACHT 19.07.⟫ (nichts davon blockiert den Betrieb; ueberall gilt ein dokumentierter Default).
- BH-072 (Offline-Vertragsnetz fuer Intake/Preis/Earnings, Aufwand L) und BH-008 (PIT-Store-Schema) sind Bau-Tasks, keine Nacht-Fixes.
- Vault-Statuskorrekturen (BH-173–178, Masterplan/Ledger/Entscheide) sind editiert aber **nicht committet** — im Jarvis-Repo liegen fremde Aenderungen anderer Ketten, die ich nicht mit-committe.
- Historische **Datenbereinigung** (Phantom-Wochenendbars, Negativ-Closes im Preis-Store) wurde NICHT durchgefuehrt — die Writer sind gefixt, der Altbestand heilt beim naechsten 400-Tage-Refresh bzw. braucht einen bewussten Bereinigungslauf (Loeschen von Daten = Karl-Stop).

## Anhang: Verdikt- und Ergebnis-Tabelle (198 Findings)

| ID | Verdikt | Schwere (neu) | Ergebnis |
|---|---|---|---|
| BH-001 | CONFIRMED | HOCH | gefixt — Tag 356 |
| BH-002 | CONFIRMED | MITTEL | gefixt — Tag 356 |
| BH-003 | CONFIRMED | HOCH | gefixt — Tag 364 |
| BH-004 | CONFIRMED | HOCH | gefixt — Tag 365 |
| BH-005 | CONFIRMED | MITTEL | gefixt — Tag 367 |
| BH-006 | CONFIRMED | MITTEL | Karl-Queue E-20260719-2 (Restatement-Policy) |
| BH-007 | CONFIRMED | MITTEL | gefixt — Tag 367 |
| BH-008 | CONFIRMED | MITTEL | Karl-Queue E-20260719-2 (PIT-Schema, Bau-Task) |
| BH-009 | PARTIAL | NIEDRIG | gefixt — Tag 367 |
| BH-010 | CONFIRMED | MITTEL | gefixt — Tag 367 |
| BH-011 | CONFIRMED | NIEDRIG | gefixt — Tag 362 |
| BH-012 | PARTIAL | NIEDRIG | gefixt — Tag 382 |
| BH-013 | CONFIRMED | NIEDRIG | gefixt — Tag 382 |
| BH-014 | CONFIRMED | MITTEL | Limitation im Report verankert (Tag 372); echter Zufalls-Messlauf -> Queue E-20260719-4 |
| BH-015 | CONFIRMED | NIEDRIG | gefixt — Tag 372 |
| BH-016 | PARTIAL | HINWEIS | gefixt — Tag 372 |
| BH-017 | CONFIRMED | NIEDRIG | gefixt — Tag 373 |
| BH-018 | CONFIRMED | MITTEL | bereits korrekt (SEC_COMPANYFACTS_ZIP-Env), Producer-Verdrahtung offen -> Queue |
| BH-019 | CONFIRMED | MITTEL | gefixt — Tag 372 |
| BH-020 | CONFIRMED | NIEDRIG | gefixt — Tag 370 |
| BH-021 | CONFIRMED | NIEDRIG | gefixt — Tag 370 |
| BH-022 | CONFIRMED | NIEDRIG | gefixt — Tag 370 |
| BH-023 | CONFIRMED | NIEDRIG | gefixt — Tag 370 |
| BH-024 | CONFIRMED | NIEDRIG | gefixt — Tag 370 |
| BH-025 | CONFIRMED | NIEDRIG | gefixt — Tag 370 |
| BH-026 | CONFIRMED | NIEDRIG | gefixt — Tag 370 |
| BH-027 | CONFIRMED | MITTEL | CI-seitig entschaerft (Tag 364); Consumer-Frage -> Queue E-20260719-3 |
| BH-028 | CONFIRMED | NIEDRIG | gefixt — Tag 371 |
| BH-029 | CONFIRMED | MITTEL | gefixt — Tag 371 |
| BH-030 | CONFIRMED | MITTEL | gefixt — Tag 371 |
| BH-031 | CONFIRMED | MITTEL | gefixt — Tag 371 |
| BH-032 | CONFIRMED | NIEDRIG | gefixt — Tag 371 |
| BH-033 | CONFIRMED | NIEDRIG | research-status-Kennzeichnung (Tag 371); Grundsatz -> Queue E-20260719-3 |
| BH-034 | CONFIRMED | NIEDRIG | gefixt — Tag 371 |
| BH-035 | CONFIRMED | MITTEL | gefixt — Tag 364 |
| BH-036 | CONFIRMED | MITTEL | gefixt — Tag 370 |
| BH-037 | CONFIRMED | NIEDRIG | gefixt — Tag 370 |
| BH-038 | CONFIRMED | KRITISCH | gefixt — Tag 360 |
| BH-039 | CONFIRMED | MITTEL | gefixt — Tag 360 |
| BH-040 | CONFIRMED | MITTEL | gefixt — Tag 360 |
| BH-041 | CONFIRMED | HOCH | gefixt — Tag 380 |
| BH-042 | CONFIRMED | MITTEL | gefixt — Tag 361 |
| BH-043 | CONFIRMED | MITTEL | gefixt — Tag 361 |
| BH-044 | PARTIAL | NIEDRIG | gefixt — Tag 361 |
| BH-045 | CONFIRMED | MITTEL | gefixt — Tag 361 |
| BH-046 | CONFIRMED | MITTEL | gefixt — Tag 361 |
| BH-047 | CONFIRMED | HOCH | gefixt — Tag 361 |
| BH-048 | CONFIRMED | NIEDRIG | gefixt — Tag 361 |
| BH-049 | CONFIRMED | HOCH | gefixt — Tag 356 |
| BH-050 | CONFIRMED | HOCH | gefixt — Tag 356 |
| BH-051 | CONFIRMED | HOCH | gefixt — Tag 356 |
| BH-052 | CONFIRMED | NIEDRIG | gefixt — Tag 356 |
| BH-053 | CONFIRMED | MITTEL | gefixt — Tag 356 |
| BH-054 | CONFIRMED | NIEDRIG | gefixt — Tag 356 |
| BH-055 | PARTIAL | MITTEL | gefixt — Tag 374 |
| BH-056 | CONFIRMED | MITTEL | gefixt — Tag 374 |
| BH-057 | PARTIAL | NIEDRIG | gefixt — Tag 374 |
| BH-058 | CONFIRMED | NIEDRIG | gefixt — Tag 369 |
| BH-059 | CONFIRMED | NIEDRIG | gefixt — Tag 369 |
| BH-060 | CONFIRMED | MITTEL | gefixt — Tag 369 |
| BH-061 | CONFIRMED | MITTEL | gefixt — Tag 369 |
| BH-062 | CONFIRMED | MITTEL | gefixt — Tag 369 |
| BH-063 | CONFIRMED | MITTEL | gefixt — Tag 369 |
| BH-064 | PARTIAL | HINWEIS | gefixt — Tag 369 |
| BH-065 | PARTIAL | HINWEIS | gefixt — Tag 369 |
| BH-066 | CONFIRMED | MITTEL | gefixt — Tag 375 |
| BH-067 | CONFIRMED | MITTEL | gefixt — Tag 375 |
| BH-068 | CONFIRMED | MITTEL | gefixt — Tag 375 |
| BH-069 | CONFIRMED | NIEDRIG | gefixt — Tag 375 |
| BH-070 | PARTIAL | NIEDRIG | gefixt — Tag 375 |
| BH-071 | CONFIRMED | MITTEL | bereits korrekt (verifiziert, Pin-Test ergaenzt) |
| BH-072 | CONFIRMED | HINWEIS | Backlog (Offline-Vertragsnetz, Aufwand L) — nicht in dieser Nacht |
| BH-073 | CONFIRMED | MITTEL | gefixt — Tag 364 |
| BH-074 | CONFIRMED | MITTEL | gefixt — Tag 376 |
| BH-075 | CONFIRMED | MITTEL | gefixt — Tag 376 |
| BH-076 | CONFIRMED | MITTEL | gefixt — Tag 376 |
| BH-077 | CONFIRMED | MITTEL | gefixt — Tag 363 |
| BH-078 | CONFIRMED | MITTEL | gefixt — Tag 377 |
| BH-079 | CONFIRMED | MITTEL | gefixt — Tag 376 |
| BH-080 | CONFIRMED | MITTEL | gefixt — Tag 376 |
| BH-081 | CONFIRMED | MITTEL | gefixt — Tag 376 |
| BH-082 | CONFIRMED | NIEDRIG | gefixt — Tag 376 |
| BH-083 | CONFIRMED | NIEDRIG | gefixt — Tag 376 |
| BH-084 | CONFIRMED | HINWEIS | gefixt — Tag 363 |
| BH-085 | CONFIRMED | HINWEIS | gefixt — Tag 363 |
| BH-086 | CONFIRMED | NIEDRIG | gefixt — Tag 377 |
| BH-087 | CONFIRMED | MITTEL | gefixt — findash bc199aa |
| BH-088 | CONFIRMED | MITTEL | gefixt — findash bc199aa |
| BH-089 | CONFIRMED | HOCH | gefixt — findash bc199aa |
| BH-090 | CONFIRMED | HOCH | gefixt — findash bc199aa |
| BH-091 | CONFIRMED | HOCH | gefixt — findash bc199aa |
| BH-092 | CONFIRMED | MITTEL | gefixt — findash bc199aa |
| BH-093 | CONFIRMED | HOCH | gefixt — findash bc199aa |
| BH-094 | CONFIRMED | MITTEL | gefixt — findash bc199aa |
| BH-095 | CONFIRMED | MITTEL | gefixt — findash bc199aa |
| BH-096 | CONFIRMED | MITTEL | gefixt — findash bc199aa |
| BH-097 | CONFIRMED | MITTEL | gefixt — findash bc199aa |
| BH-098 | CONFIRMED | MITTEL | gefixt — findash bc199aa |
| BH-099 | CONFIRMED | HINWEIS | gefixt — findash 99ddcda |
| BH-100 | CONFIRMED | MITTEL | gefixt — Tag 360 |
| BH-101 | CONFIRMED | HOCH | bereits korrekt in lib; Konsument gefixt (Tag 357/358) + Pin-Tests |
| BH-102 | CONFIRMED | HOCH | gefixt — Tag 357 |
| BH-103 | CONFIRMED | HOCH | gefixt — Tag 358 |
| BH-104 | CONFIRMED | HOCH | gefixt — Tag 358 |
| BH-105 | CONFIRMED | MITTEL | gefixt — Tag 359 |
| BH-106 | CONFIRMED | MITTEL | gefixt — Tag 358 |
| BH-107 | CONFIRMED | HOCH | gefixt — Tag 358 |
| BH-108 | CONFIRMED | HOCH | gefixt — Tag 359 |
| BH-109 | CONFIRMED | MITTEL | gefixt — Tag 359 |
| BH-110 | CONFIRMED | MITTEL | gefixt — Tag 358 |
| BH-111 | CONFIRMED | HOCH | gefixt — Tag 359 |
| BH-112 | CONFIRMED | MITTEL | bereits korrekt (Vertrag vorhanden, Tag 357-Pin) |
| BH-113 | CONFIRMED | HOCH | gefixt — Tag 364 |
| BH-114 | CONFIRMED | HOCH | gefixt — Tag 364 |
| BH-115 | CONFIRMED | MITTEL | gefixt — Tag 364 |
| BH-116 | CONFIRMED | HOCH | gefixt — Tag 362 |
| BH-117 | CONFIRMED | HOCH | gefixt — Tag 381 |
| BH-118 | CONFIRMED | MITTEL | gefixt — Tag 364 |
| BH-119 | CONFIRMED | HOCH | gefixt — Tag 365 |
| BH-120 | CONFIRMED | MITTEL | gefixt — Tag 368 |
| BH-121 | CONFIRMED | HOCH | gefixt — Tag 364 |
| BH-122 | PARTIAL | NIEDRIG | Karl-Queue E-20260719-6d (toter Health-Step) |
| BH-123 | CONFIRMED | MITTEL | gefixt — Tag 378 |
| BH-124 | CONFIRMED | MITTEL | gefixt — Tag 378 |
| BH-125 | CONFIRMED | MITTEL | gefixt — Tag 378 |
| BH-126 | CONFIRMED | HOCH | gefixt — Tag 368 |
| BH-127 | CONFIRMED | MITTEL | gefixt — Tag 368 |
| BH-128 | CONFIRMED | MITTEL | gefixt — Tag 378 |
| BH-129 | CONFIRMED | MITTEL | gefixt — Tag 378 |
| BH-130 | PARTIAL | NIEDRIG | gefixt — Tag 365 |
| BH-131 | CONFIRMED | NIEDRIG | gefixt — Tag 365 |
| BH-132 | CONFIRMED | MITTEL | gefixt — Tag 368 |
| BH-133 | CONFIRMED | NIEDRIG | gefixt — Tag 368 |
| BH-134 | CONFIRMED | HINWEIS | gefixt — Tag 365 |
| BH-135 | CONFIRMED | HINWEIS | gefixt — Tag 365 |
| BH-136 | CONFIRMED | HINWEIS | gefixt — Tag 364 |
| BH-137 | CONFIRMED | NIEDRIG | gefixt — Tag 378 |
| BH-138 | PARTIAL | MITTEL | gefixt — Tag 378 |
| BH-139 | CONFIRMED | HOCH | gefixt — Tag 366 |
| BH-140 | CONFIRMED | MITTEL | gefixt — Tag 379 |
| BH-141 | CONFIRMED | NIEDRIG | gefixt — Tag 379 |
| BH-142 | CONFIRMED | NIEDRIG | gefixt — Tag 366 |
| BH-143 | CONFIRMED | MITTEL | gefixt — Tag 364 |
| BH-144 | CONFIRMED | MITTEL | gefixt — Tag 366 |
| BH-145 | CONFIRMED | NIEDRIG | gefixt — Tag 366 |
| BH-146 | CONFIRMED | MITTEL | gefixt — Tag 379 |
| BH-147 | CONFIRMED | MITTEL | gefixt — Tag 359 |
| BH-148 | CONFIRMED | HOCH | gefixt — Tag 358 (Block-Bootstrap nach Ledger-Spez); ANKER ROT -> Queue E-20260719-1 |
| BH-149 | CONFIRMED | MITTEL | gefixt — Tag 358 |
| BH-150 | CONFIRMED | MITTEL | gefixt — Tag 358 |
| BH-151 | CONFIRMED | HINWEIS | gefixt — Tag 358 |
| BH-152 | CONFIRMED | MITTEL | gefixt — Tag 364 |
| BH-153 | CONFIRMED | MITTEL | gefixt — Tag 364 |
| BH-154 | CONFIRMED | MITTEL | gefixt — Tag 359 |
| BH-155 | CONFIRMED | MITTEL | gefixt — Tag 359 |
| BH-156 | CONFIRMED | MITTEL | gefixt — Tag 364 |
| BH-157 | PARTIAL | MITTEL | gefixt — Tag 358 (milde Lesart); Schwellen-Frage -> Queue E-20260719-5 |
| BH-158 | CONFIRMED | HOCH | gefixt — Tag 358 |
| BH-159 | CONFIRMED | MITTEL | gefixt — Tag 363 |
| BH-160 | CONFIRMED | NIEDRIG | gefixt — Tag 377 |
| BH-161 | CONFIRMED | MITTEL | gefixt — Tag 383 |
| BH-162 | CONFIRMED | MITTEL | gefixt — Tag 383 |
| BH-163 | CONFIRMED | MITTEL | gefixt — Tag 383 |
| BH-164 | CONFIRMED | MITTEL | gefixt — Tag 383 |
| BH-165 | CONFIRMED | MITTEL | gefixt — Tag 383 |
| BH-166 | CONFIRMED | HOCH | gefixt — Tag 383 |
| BH-167 | CONFIRMED | HOCH | gefixt — Tag 383 |
| BH-168 | CONFIRMED | MITTEL | gefixt — Tag 383 |
| BH-169 | CONFIRMED | MITTEL | gefixt — Tag 383 |
| BH-170 | CONFIRMED | NIEDRIG | gefixt — Tag 383 |
| BH-171 | CONFIRMED | NIEDRIG | gefixt — Tag 383 |
| BH-172 | CONFIRMED | MITTEL | gefixt — Tag 383 |
| BH-173 | CONFIRMED | MITTEL | gefixt — Vault (uncommitted) |
| BH-174 | CONFIRMED | MITTEL | gefixt — Vault (uncommitted) |
| BH-175 | CONFIRMED | MITTEL | gefixt — Vault (uncommitted) |
| BH-176 | CONFIRMED | NIEDRIG | gefixt — Vault (uncommitted) |
| BH-177 | CONFIRMED | NIEDRIG | gefixt — Vault (uncommitted) |
| BH-178 | CONFIRMED | HOCH | gefixt — Vault (uncommitted) |
| BH-179 | CONFIRMED | MITTEL | gefixt — Tag 377 |
| BH-180 | CONFIRMED | MITTEL | gefixt — Tag 377 |
| BH-181 | CONFIRMED | MITTEL | gefixt — Tag 383 |
| BH-182 | CONFIRMED | HOCH | gefixt — Tag 361 |
| BH-183 | CONFIRMED | NIEDRIG | gefixt — Tag 383 |
| BH-184 | PARTIAL | NIEDRIG | gefixt — Tag 378 |
| BH-185 | CONFIRMED | NIEDRIG | Karl-Queue E-20260719-6e (Legacy-Backtest retten/pensionieren) |
| BH-186 | CONFIRMED | NIEDRIG | gefixt — Tag 379 |
| BH-187 | CONFIRMED | NIEDRIG | gefixt — Tag 379 |
| BH-188 | CONFIRMED | NIEDRIG | gefixt — Tag 379 |
| BH-189 | CONFIRMED | HINWEIS | gefixt — Tag 357 |
| BH-190 | CONFIRMED | NIEDRIG | gefixt — Tag 366 |
| BH-191 | CONFIRMED | HINWEIS | Karl-Queue E-20260719-6f (YAGNI bestaetigen) |
| BH-192 | REFUTED | NIEDRIG | WIDERLEGT — kein Fix noetig |
| BH-193 | CONFIRMED | MITTEL | gefixt — Tag 360 |
| BH-194 | PARTIAL | NIEDRIG | gefixt — Tag 361 |
| BH-195 | CONFIRMED | NIEDRIG | gefixt — Tag 383 |
| BH-196 | CONFIRMED | NIEDRIG | gefixt — Tag 375 |
| BH-197 | CONFIRMED | HINWEIS | gefixt — Tag 367 |
| BH-198 | CONFIRMED | NIEDRIG | gefixt — Tag 362 |
