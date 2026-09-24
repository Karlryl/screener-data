# Abschlussbericht Codex-Limit-Lauf 2026-09-24 (19:11–20:25)

## AUF EINEN BLICK
- Codex: 5 PRs auf screener-data (S01, S05, S06, S07, S10), alle von Claude geprueft/kommentiert; 0 PRs auf findash (keine findash-Threads gestartet).
- Claude: 34 Branches `claude/<ID>` gepusht (12 screener-data, 22 findash), alle FERTIG, keine PRs (Karl entscheidet).
- Queues fuer die naechsten Laeufe: screener-data S01–S66, findash F01–F86 (alle verifiziert, mit Konflikt-Audit und Reihenfolge).

## 1. Codex-PRs (screener-data)
| PR | Task | Claude-Urteil | Bemerkung |
|---|---|---|---|
| 354 | S01 sechs lib-Tests | GELB → GRUEN nach Nachkommit 87a5858 (Wachposten AT-SK-REGION-001 uebersprang Testdateien nicht) | Tag-Kollision 1369 mit S05/S06/S07/S10 beim Merge umnummerieren |
| 355 | S05 CLI-Vertraege | GRUEN, CI gruen | Nit: Temp-Fixtures aufraeumen |
| 356 | S06 rule40 Reserved-Name | GRUEN, Break-once doppelt bestaetigt | Nit: aufraeumen() fehlt |
| 357 | S10 lib-Restzweige | Schnellpruefung: nur Testdatei, keine TABU-Pfade | CI entscheidet |
| 358 | S07 Mess-Skripte CLI | Schnellpruefung: nur Testdatei, Offline-Guard, Hash-Wachen | CI entscheidet |

## 2. Claude-Branches (alle gepusht, keine PRs)
screener-data: S22 (CRLF-Textleser), S24 (safeSnapshotFilename in 2 Lesern), S25 (lib/env-key), S35 (refresh-universe-Helfer, 19 Tests), S36 (Checkpoint-Env-Guard gegen `% 0`), S37 (annual-currency-guard 12→41 Checks), S38 (read-json/artifact-path Edge-Faelle), S43 (JSON.parse fail-loud, 3 Stellen), S49 (field-coverage 26 Tests), S53 (newest-qtr-guard 12→39), S59 (Node-API-Wachposten), S62 (m10 Login-Shell weg, 11,5 s→4,4 s).
findash: F03 (README-Routen +3, Waechter), F06 (HEAD/405 fuer 18 Routen, 87 Faelle), F09 (Haushalt null-Posten), F21 (Kontrakt-Validator 12→32), F22 (screener-sync 11→18), F27 (loadScreener: 2 Defekte gefixt), F28 (24 Env-Variablen dokumentiert + Waechter), F30 (tsconfig/vitest include + Waechter), F31 (Zinskalender-Horizont-Waechter), F33 (Backup-Kette), F34 (Rotationsdeckel 50/20/20), F38 (Pruefer-Tabellen 46 Zeilen), F39 (Crash-Fenster), F43 (dauer-reporter 11 Tests), F54 (ausschluss.ts 11 Tests), F57 (fremdBoardTreffer 11 Tests), F58 (rule40-Helfer 10 Tests), F60 (sendJson: `gzip;q=0`-Defekt gefixt), F62 (readJson-Zweige 16 Faelle), F64 (Statik-Vertrag), F68 (scope=col + aria-current), F72 (Seitenleiste aria-label + Test).
Jeder Bericht: `report-<ID>.md` (Scratchpad der Session); alle mit Verifikations-Ausgaben, die meisten mit Break-once.

## 3. Echte Defekte gefunden/gefixt (auf Branches)
- F27: `index.coverage` als Array wurde durchgereicht; korrupte `sync-status.json` wurde still wie fehlend behandelt.
- F60: `Accept-Encoding: gzip;q=0` lieferte trotzdem gzip (RFC 9110).
- S36: `PRICE_CHECKPOINT_BATCHES=0|abc` → `% 0`/`% NaN` → Timeout-Checkpoint feuerte nie.
- S43: drei nackte JSON.parse auf Fremddaten ohne Quelle in der Fehlermeldung.
- S24: `_CON.DE.json` (Windows-reservierter Stamm) wurde von 2 Lesern still uebersprungen.
- Nur gemeldet (in Queue-Tasks): cache.js TypeError bei JSON-Primitiv (F23), calendar.js 500 bei nicht-string date (F24), Prototyp-Schluessel aus externen Feldern (F25, F86), Provider-Parser ohne Container-Wachen (F26), proxyToWeb streamt nach Client-Abbruch weiter (F65), watchlist-close RangeError bei Riesen-Zeitstempel (F86), eindeutigeSchluessel erzeugt doppelte React-Keys (F84).

## 4. Karl-Entscheidungen (nicht Codex, nicht Claude-Subagent)
1. server.js setzt keine Security-Header (nosniff, X-Frame-Options, CSP, Referrer-Policy) — evtl. Cloudflare-Sache.
2. `ROUTE_METHODS` kennt `/api/betrieb`, `/api/screener/excluded`, Vollboard-Pfade nicht → falsche Methode dort 404 statt 405 (F03/F06-Befund).
3. 9.836 prettier-Fehler in web/ (`npm run lint` rot); CI fuehrt kein Lint aus (.github ist TABU). F01 ist darauf verengt.
4. Anzeige-Inkonsistenzen: Rule-of-40-Seite mit englischem Dezimalpunkt; zwei `eur`-Formatierer; fuenf Vorzeichen-Konventionen; zwei zeitzonenabhaengige Anzeigen (betriebs-banner, rule40-page).
5. 44 tote shadcn-Dateien + 37 nur dort genutzte Dependencies in web/ (nie loeschen ohne dich; F73 snapshottet).
6. `lib/sub-profile.js` hat keinen Konsumenten mehr (0 % Abdeckung).
7. Zinskalender config/decision-dates.json: 2027-Termine fehlen; Waechter F31 wird ab ~09.11. rot.
8. beide CLIs (earnings-cli, watchlist-cli) akzeptieren unbekannte Optionen mit Exit 0.

## 5. Queue-Stand fuer morgen
- screener-data: S01–S66, Konflikt-Audit + Reihenfolge in `codex-queue/AUDIT-screener-data-2026-09-24.md` (Welle 1: S14, S09, S44, S48, S12, S07, S08, S26; zuletzt S17, S18; S03 entfaellt).
- findash: F01–F86, Audit in `codex-queue/AUDIT-findash-2026-09-24.md` im findash-Repo. Wichtig: viele Tasks fassen `web/src/routes/index.tsx` an → seriell.
- Regeln: Subagenten-Ziel 50, Reviewer + Nachlauf je Task, Temp-Fixtures aufraeumen, Regel-Vorrang vor Task-Text.

## 6. Offen / Risiken
- Codex-PRs 357/358 nur schnellgeprueft (Zeitlimit, Claude-Cloud-Limit): CI-Check entscheidet.
- Claude-Branches: nur gezielte Tests gefahren, keine Vollsuiten (4 Kerne, ~40 Agenten). Vor Merge: `node --test` (findash) bzw. `node scripts/test-gate.js --mode=blocking` (screener-data) auf jedem Branch; PR-Check uebernimmt das.
- Alle 5 Codex-PRs tragen „Tag 1369" → beim Merge fortlaufend umnummerieren.
- Vier studie-Tests sind im Container rot (unvollstaendige Git-Historie, CPython 3.11) — auf deinem Rechner gegenpruefen (S43-Bericht).
- Masterplan/WORKLOG im Vault konnte aus der Cloud nicht aktualisiert werden (kein Zugriff) — dieser Bericht ist die Vorlage.
