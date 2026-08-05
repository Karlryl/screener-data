# Harter Prüf-Sweep — `screener-data`

PRÜF-COMMIT: `84332060095aee8a5a056d81d3977ae9e8074c35`

PRÜFSTAND: `main`; `HEAD`, `origin/main` und `git ls-remote origin refs/heads/main` zeigten zu Prüfbeginn denselben SHA. Alle Befunde und Zählungen beziehen sich ausschließlich auf diesen Git-Baum.

ZÄHLMETHODE: Dateibestand mit `git ls-tree -r --name-only <SHA>`; Inhalte mit `git show <SHA>:<pfad>`; Referenzen mit vollständiger `git grep`-/Textmatrix über alle getrackten Textdateien. Lokale ignorierte Laufzeitdateien sind ausdrücklich nicht eingerechnet.

## Sweep 1 — Stille Fehler

### F-CGPT-1 | datei=pull-yahoo.js:335 | klasse=sweep1 | schwere=hoch
BEFUND: Fehlende, unlesbare, veraltete oder strukturell falsche FX-Daten werden durch fest eingebaute Kurse ersetzt; dadurch sehen USD-Werte numerisch gesund aus, ohne dass Fehlerquote oder Exit-Status steigen.
BELEG: `if (!require('fs').existsSync(fxPath)) return;` sowie `console.log('[FX] ... using fallback')` in Zeilen 335–342; die Fallback-Tabelle wird danach in Zeilen 419–420 benutzt.
REPRO: `fx-rates.json` entfernen oder ungültiges JSON einsetzen und einen Nicht-USD-Snapshot ziehen; anschließend Manifest-Zähler und Exit-Code mit den ausgegebenen USD-Werten vergleichen.
FIX-SKIZZE: Produktions-Fallback als degradierten/fehlgeschlagenen Lauf im Manifest und Exit-Status markieren.

### F-CGPT-2 | datei=pull-yahoo.js:2431 | klasse=sweep1 | schwere=hoch
BEFUND: Fehlt `quote.currency`, setzt der Pull für einen Nicht-USD-Handelsplatz den Umrechnungsfaktor auf `1` und kennzeichnet den Preis trotzdem als USD.
BELEG: `tradingFactor = (fxApplied !== 1 && origCcy !== 'USD') ? fxApplied : 1;` (2431–2437) und anschließend `priceCurrency: 'USD'` im Updatepfad.
REPRO: `_priceOnlyUpdate` mit einem HK-Ticker und Quote ohne `currency` ausführen; der HKD-Zahlenwert bleibt unverändert, während die Metadaten USD ausweisen.
FIX-SKIZZE: Bei unbekannter Handelswährung keinen gesunden USD-Wert erzeugen.

### F-CGPT-3 | datei=pull-yahoo.js:2385 | klasse=sweep1 | schwere=hoch
BEFUND: Jede wahrheitswerte Quote gilt als Erfolg, auch wenn Preis und Marktkapitalisierung fehlen; der bestehende Snapshot wird unverändert als erfolgreicher `price-only`-Lauf neu geschrieben.
BELEG: Einzige Eingangsprüfung ist `if (!q) throw`; der Pfad 2438–2480/2527–2528 gibt danach `status: 'price-only'` zurück.
REPRO: Als Quote nur `{ "currency": "USD" }` liefern und den Rückgabestatus sowie `n_ok` prüfen.
FIX-SKIZZE: Vor dem Erfolgsstatus mindestens die zwingenden Quote-Felder validieren.

### F-CGPT-4 | datei=pull-yahoo.js:2488 | klasse=sweep1 | schwere=hoch
BEFUND: Mehrere fachlich notwendige Löschungen werden mit leeren Catch-Blöcken quittiert; alte Cache-/Snapshotdateien können dadurch trotz `removed`, `fx-unknown` oder `skipped-mcap` weiterbestehen.
BELEG: Wiederholtes Muster `try { fs.unlinkSync(...) } catch (e) {}` in Zeilen 2488, 3199, 3224, 3230, 3237 und 3280.
REPRO: Eine Zieldatei gegen Löschen sperren und den jeweiligen Ausschlusspfad auslösen; Status/Manifest melden den Ausschluss, die Datei bleibt liegen.
FIX-SKIZZE: Löschfehler zählen und den Ausschluss erst nach bestätigter Entfernung als erfolgreich melden.

### F-CGPT-5 | datei=pull-yahoo.js:3567 | klasse=sweep1 | schwere=hoch
BEFUND: Kann ein altes `_manifest.json` vor dem Lauf nicht entfernt werden, läuft der Pull nach einer Warnung weiter; bei Abbruch vor dem ersten Checkpoint bleibt der alte Erfolgsstand sichtbar.
BELEG: Zeilen 3567–3569 fangen den Löschfehler ab, loggen nur `WARN` und setzen den Lauf fort.
REPRO: Manifest schreib-/löschsperren, Pull starten und vor dem ersten Manifest-Write abbrechen; danach steht weiterhin das alte Manifest am kanonischen Pfad.
FIX-SKIZZE: Ohne entwertetes Altmanifest den Lauf nicht als normal fortsetzen.

### F-CGPT-6 | datei=lib/e1-compression.js:257 | klasse=sweep1 | schwere=hoch
BEFUND: Fehlendes Tagesverzeichnis oder unlesbare Board-JSONs werden als leere Datenlage gerechnet; der Bericht kann so null Alarme und null Lücken ausweisen.
BELEG: Fehlendes Verzeichnis liefert `[]` (257–265), Board-Parsefehler setzen `v = null`; kein Parsefehler geht in das Resultat ein.
REPRO: Ein Board-Vintage-Verzeichnis entfernen oder alle Boarddateien beschädigen und den E1-Bericht erzeugen; Alarme/Gaps bleiben leer.
FIX-SKIZZE: Nicht lesbare Pflichtvintages als eigenen Fehlerzustand ausgeben.

### F-CGPT-7 | datei=lib/e1-compression.js:231 | klasse=sweep1 | schwere=hoch
BEFUND: Ein korrupter E1-Zustand wird wie eine Neuanlage behandelt und setzt Cooldown, Dwell und Historienuhr zurück.
BELEG: `catch (_) { /* neu anlegen */ }` in Zeilen 231–241.
REPRO: Zustandsdatei auf ungültiges JSON setzen und den nächsten Kompressionslauf starten; der neue Zustand enthält keine vorherige Historie.
FIX-SKIZZE: Nur `ENOENT` als Neuanlage akzeptieren, vorhandene korrupte Zustände sperren.

### F-CGPT-8 | datei=lib/price-history-store.js:88 | klasse=sweep1 | schwere=hoch
BEFUND: Ein korruptes `_meta.json` wird zu `null`; damit entfällt die Shard-Vollständigkeitsprüfung und ein fehlender Shard wird als kleinerer erfolgreicher Store geladen.
BELEG: Meta-Lesefehler liefern in 88–93 `null`; die Vollständigkeitskontrolle in 160–172 läuft nur bei wahrheitswertigem Metaobjekt.
REPRO: `_meta.json` beschädigen und einen Shard entfernen; `loadAll` liefert eine kleinere Map statt eines Fehlers.
FIX-SKIZZE: Vorhandene unlesbare Metadaten als Store-Korruption behandeln.

### F-CGPT-9 | datei=pull-yahoo.js:2591 | klasse=sweep1 | schwere=mittel
BEFUND: Ein ungültiger, aber wahrheitswerter `fundamentalsAsOf`-String blockiert den `fetchedAt`-Fallback und kann einen fälligen Vollabruf als `price-only` durchlassen.
BELEG: Auswahl in 2591–2595 und Erfolgsrückgabe in 3723–3726; der Fehler erhöht keinen Zähler.
REPRO: `needsFullPull({ fundamentalsAsOf: 'broken', fetchedAt: <alt> }, ...)` ausführen; Ergebnis bleibt `price-only`.
FIX-SKIZZE: Datumsfelder vor der Prioritätsauswahl validieren.

### F-CGPT-10 | datei=pull-yahoo.js:2086 | klasse=sweep1 | schwere=mittel
BEFUND: Fehlender oder korrupter Earnings-Kalender fällt auf `{}`; dadurch entfallen earningsbedingte Vollabrufe, ohne dass der Lauf fehlschlägt.
BELEG: Zeilen 2086–2091 geben nach `WARN` ein leeres Objekt zurück.
REPRO: Kalenderdatei beschädigen und einen Ticker mit fälligem Earnings-Refresh verarbeiten; er zählt weiterhin als gesund.
FIX-SKIZZE: Kalenderausfall als strukturierten Degradationszustand mit Zähler ausweisen.

### F-CGPT-11 | datei=pull-yahoo.js:1587 | klasse=sweep1 | schwere=mittel
BEFUND: Vier Fundamentals-Time-Series-Unterabrufe werden bei Fehlern durch leere Arrays ersetzt; der Vollpull kann trotzdem `ok` liefern.
BELEG: Catch-/Leerarray-Fallbacks in 1587–1604 und 2858–2875; sichtbar bleiben nur `WARN` bzw. `_ftsPartial`, nicht `n_failed`.
REPRO: Einen der FTS-Endpunkte werfen lassen und den resultierenden Snapshot samt Manifest prüfen; betroffene Reihen fehlen bei gesundem Laufstatus.
FIX-SKIZZE: Teilabrufe in Fehlerzähler und finalen Tickerstatus einbeziehen.

### F-CGPT-12 | datei=pull-yahoo.js:2195 | klasse=sweep1 | schwere=mittel
BEFUND: Fehlschlagende inkrementelle Manifest-Checkpoints werden nur gewarnt; bei späterem Prozessabbruch geht der bereits erreichte Fortschritt ohne maschinenlesbaren Fehler verloren.
BELEG: Manifest-Write in 2195–2240, Catch in 2231–2233 protokolliert nur Warntext.
REPRO: Checkpoint-Write durch Zugriffsfehler scheitern lassen und den Prozess danach hart beenden; das Manifest bleibt auf dem alten Stand.
FIX-SKIZZE: Checkpoint-Fehler im Laufstatus persistieren oder den Lauf stoppen.

### F-CGPT-13 | datei=lib/b1-detect.js:26 | klasse=sweep1 | schwere=mittel
BEFUND: Wirft `factsForCik`, wird das Unternehmen als leere Faktenliste behandelt; Ursache und betroffener CIK verschwinden.
BELEG: Catch in 26–30 gibt `[]` zurück.
REPRO: `factsForCik` für einen bekannten CIK werfen lassen und B1 ausführen; der Name fällt nur in aggregierte Lücken.
FIX-SKIZZE: Abrufausnahme von einem legitimen Nullbefund unterscheiden und zählen.

### F-CGPT-14 | datei=lib/atomic-write.js:209 | klasse=sweep1 | schwere=mittel
BEFUND: Endliche Zahlen werden nur optional geprüft; im Standardpfad serialisiert `JSON.stringify` `NaN`/`Infinity` als `null` und der atomare Write gilt als Erfolg.
BELEG: `assertFinite` ist in 209–216 opt-in; ohne Option wird direkt serialisiert.
REPRO: `writeJsonAtomic` mit `{x: NaN}` ohne `assertFinite:true` aufrufen; die Datei enthält `{ "x": null }` bei Erfolg.
FIX-SKIZZE: Nicht-endliche Zahlen für fachliche JSON-Writer standardmäßig ablehnen.

### F-CGPT-15 | datei=lib/atomic-write.js:118 | klasse=sweep1 | schwere=mittel
BEFUND: Ein Verzeichnis-`fsync`-Fehler nach Rename wird nur gewarnt, der Aufrufer erhält Erfolg; nach Stromverlust ist die zugesagte Dauerhaftigkeit damit nicht belegt.
BELEG: Catch in 118–143 loggt `WARN`, ohne den Fehler erneut zu werfen.
REPRO: Verzeichnis-`fsync` mocken/verbieten und einen atomaren Write ausführen; die Funktion kehrt erfolgreich zurück.
FIX-SKIZZE: Durability-Fehler an den Aufrufer propagieren oder explizit im Ergebnis kennzeichnen.

### F-CGPT-16 | datei=pull-yahoo.js:2652 | klasse=sweep1 | schwere=niedrig
BEFUND: Fehler der IPO-Quote-Prüfung werden nur gewarnt; der Snapshot erhält weder Flag noch Fehlerzähler und kann als `ok` enden.
BELEG: Catch in 2652–2661 schreibt nur `WARN`.
REPRO: IPO-Quote-Abruf werfen lassen und Snapshot/Manifest vergleichen; es existiert kein maschinenlesbares IPO-Fehlermerkmal.
FIX-SKIZZE: IPO-Prüfausfall als Snapshot-Metadatum und Zähler speichern.

### F-CGPT-17 | datei=pull-yahoo.js:3374 | klasse=sweep1 | schwere=niedrig
BEFUND: Kann der Not-found-Zustand nicht geschrieben werden, bleibt der Lauf grün; Streak und Delisting-Kandidat gehen verloren.
BELEG: Catch in 3374–3401 loggt nur `WARN`.
REPRO: Not-found-State schreibsperren und einen 404-Ticker verarbeiten; der nächste Lauf beginnt ohne erhöhten Streak.
FIX-SKIZZE: Persistenzfehler des Zustands im Manifest als Fehler ausweisen.

### F-CGPT-18 | datei=scripts/restore-test-prices-max.ps1:22 | klasse=sweep1 | schwere=hoch
BEFUND: Der Restore-Test hasht nur 20 Dateien und erklärt bei gleicher Gesamtzahl/-größe den ganzen Preisbackupbestand für echt.
BELEG: `Select-Object -Index (0..19 ...)` und `$ok = ($o.Count -eq $b.Count) ... -and ($o.Sample -eq $b.Sample)` (22–25, 37–40).
REPRO: Eine nicht ausgewählte Backup-Datei längengleich verändern; Test meldet weiter GRÜN und Exit 0.
FIX-SKIZZE: Jede Datei nach relativem Pfad, Länge und Hash vergleichen.

### F-CGPT-19 | datei=scripts/fetch-secbulk.js:218 | klasse=sweep1 | schwere=hoch
BEFUND: Fehlgeschlagene Blöcke/ZIP-Einträge erhöhen nur `kaputt`; danach ersetzt die unvollständige Temp-Datei den Vollbestand.
BELEG: `catch (e) { ... kaputt += ...; continue; }` und anschließend `fs.renameSync(OUT + '.tmp', OUT);` (218–239).
REPRO: Einen Range-Block fehlschlagen, einen anderen gelingen lassen; Ausgabe endet Exit 0 mit verkleinertem JSONL.
FIX-SKIZZE: Bei `kaputt > 0` den Altbestand nicht ersetzen.

### F-CGPT-20 | datei=scripts/build-secannual.js:140 | klasse=sweep1 | schwere=hoch
BEFUND: Korrupte akkumulierte SEC-Jahresstores werden wie Erstläufe behandelt und durch den aktuellen Teilbestand ersetzt.
BELEG: `catch (_) { out = {}; }` und später `writeFileAtomic(OUT, JSON.stringify(out));` in `build-secannual.js:140,174` sowie gleiches Muster in `build-secannual-smallcap.js:67,100`.
REPRO: Bestehendes OUT beschädigen und mit nur einem erfolgreichen Kandidaten laufen lassen; alle alten anderen Ticker verschwinden.
FIX-SKIZZE: Nur `ENOENT` als Erstlauf zulassen, Parse-/I/O-Fehler blockieren.

### F-CGPT-21 | datei=scripts/build-krannual.js:92 | klasse=sweep1 | schwere=mittel
BEFUND: Fehler einzelner Jahresabrufe werden übersprungen; der frisch aufgebaute Teilstore ersetzt danach die vollständige koreanische Historie.
BELEG: `catch (_) { continue; }` und `writeFileAtomic(OUT, JSON.stringify(out, null, 1));` (92–113).
REPRO: Drei Jahresrequests gelingen, weitere scheitern; der Ticker wird verkürzt geschrieben, unter drei Jahren ganz entfernt.
FIX-SKIZZE: Erfolgreiche Jahre in den Vorbestand mergen und Teilabrufe nicht verkürzend persistieren.

### F-CGPT-22 | datei=src/scoring/run-screener.js:474 | klasse=sweep1 | schwere=hoch
BEFUND: Eine vorhandene korrupte SEC-Quelle wird wie eine fehlende optionale Datei behandelt; Scoring läuft ohne ihre Tiefenserien weiter.
BELEG: `catch (_) { /* Datei fehlt -> skip */ }` in 474–484.
REPRO: Eine produktive `sec-*annual.json` ungültig machen und den Scorer starten; er beendet regulär mit weniger SEC-Daten.
FIX-SKIZZE: `ENOENT` von vorhandener, unlesbarer Quelle unterscheiden.

### F-CGPT-23 | datei=src/scoring/run-screener.js:320 | klasse=sweep1 | schwere=hoch
BEFUND: Eine korrupte `_last_good_disk.json` schaltet beide Coverage-Floors ab und wird danach durch den niedrigeren aktuellen Stand ersetzt.
BELEG: `catch (_) { /* Erstlauf ... fail-open */ }` sowie Warnpfad `if (!Number.isFinite(baseline) ...)` (320, 330–364).
REPRO: High-Water-Datei beschädigen und nur 50 % der Snapshots bereitstellen; kein Floor wirft und der reduzierte Wert wird neu verankert.
FIX-SKIZZE: Korrupte vorhandene Baseline hart ablehnen.

### F-CGPT-24 | datei=src/scoring/run-screener.js:615 | klasse=sweep1 | schwere=hoch
BEFUND: Scheitert das best-effort-Löschen eines alten QC-/Small-Cap-Index und danach der neue Pass, priorisiert der Export den alten Index vor dem frischen Fehlermarker.
BELEG: `catch (_) { /* best-effort */ }` (`run-screener.js:615–635,819–822`) und `if (fs.existsSync(...'index.json')) return 'export';` (`write-findash-export.js:285–287,390–393`).
REPRO: Index-Löschung per Handle/ACL scheitern lassen und danach den neuen Pass werfen lassen; `_failed` und alter Index koexistieren, Exportmodus bleibt `export`.
FIX-SKIZZE: Fehlermarker vor Index priorisieren oder Index-Löschung fail-loud machen.

### F-CGPT-25 | datei=scripts/write-board-history.js:982 | klasse=sweep1 | schwere=hoch
BEFUND: Eine korrupte Vorgänger-Boarddatei wird zu `null`, sodass alle Vergleiche nur für dieses Board entfallen, ohne die globale Blindwarnung auszulösen.
BELEG: `const priorVintage = priorDate ? readJsonOrNull(...) : null;` (982–992); die Vergleiche liegen in 504–567.
REPRO: Nur `<prior>/<board>.json` beschädigen und einen nichtleeren aktuellen Stand schreiben; der Lauf kann Exit 0 liefern.
FIX-SKIZZE: Vorhandene unlesbare Vorgängerdatei blockieren oder boardgenau blind markieren.

### F-CGPT-26 | datei=scripts/snapshot-ticker-map.js:289 | klasse=sweep1 | schwere=hoch
BEFUND: Parsefehler von `_grundbild.json` gelten als „noch keins“; der historische Anker wird ohne Archiv neu angelegt.
BELEG: `catch (_) { /* noch keins */ }` und anschließend `if (!grundbild) ... writeFileAtomic(GRUNDBILD, ...)` (289–304).
REPRO: Grundbild beschädigen und einen erfolgreichen Quellenlauf starten; Ausgabe behauptet Neuanlage und Exit 0.
FIX-SKIZZE: Nur fehlende Datei als Neuanlage akzeptieren.

### F-CGPT-27 | datei=scripts/snapshot-ticker-map.js:104 | klasse=sweep1 | schwere=hoch
BEFUND: Eine HTTP-200-Antwort mit unparsebarem SEC-Ticker-JSON wird als vollständige Quellenlage behandelt; CIK- und SEC-only-Vortagesübernahmen greifen nicht.
BELEG: `catch (_) { /* kaputtes SEC-JSON darf den Rest nicht kippen */ }` (104–114); die `fehlend`-Logik 269–287 bleibt dabei leer.
REPRO: Große Nasdaq-Listen plus ungültiges SEC-JSON liefern; der Plausibilitätsfloor kann bestehen, obwohl CIKs/SEC-only-Symbole fehlen.
FIX-SKIZZE: Parseerfolg jeder Quelle separat erfassen und SEC-Parsefehler wie Abruffehler behandeln.

### F-CGPT-28 | datei=scripts/pull-insider-form4.js:412 | klasse=sweep1 | schwere=hoch
BEFUND: Fehler auf älteren Submissions-Seiten und Filing-Dokumenten werden nicht als Tickerfehler gezählt; leere/partielle Transaktionen erhalten dennoch ein frisches `fetchedAt`.
BELEG: Best-effort-Catches in 412–419 und 458–483; Persistenz als Erfolg in 590–600.
REPRO: Einen gefundenen Form-4-Dokumentrequest werfen lassen; Ergebnis kann `transactions=[]`, `parseErrors=0` und frischen Zeitstempel tragen.
FIX-SKIZZE: Fetchfehler separat zählen und bei unvollständiger Abdeckung den Vorbestand bewahren.

### F-CGPT-29 | datei=scripts/pull-insider-form4.js:532 | klasse=sweep1 | schwere=hoch
BEFUND: Vier Insider-/13F-Writer behandeln korrupte Caches als leere Erstanlage und überschreiben sie mit einem Teilstand.
BELEG: `const existing = readJsonSafe(...) || {};` in `pull-insider-form4.js:532–535,641–648`, `pull-insider-form4-daily.js:405–411,571–577`, `pull-13f-institutional.js:919–923,1080–1094` und `backfill-form345.js:391–406`.
REPRO: Jeweiligen Cache beschädigen und einen Sample-/Teillauf mit mindestens einem Write starten; frühere Historie/Cursor verschwinden.
FIX-SKIZZE: Nur `ENOENT` als leeren Erstbestand zulassen.

### F-CGPT-30 | datei=scripts/pull-insider-form4-daily.js:463 | klasse=sweep1 | schwere=hoch
BEFUND: Der Tagescursor wird vor 404-/Filing-Verarbeitung vorgerückt; ein noch nicht bereitstehender Werktagsindex oder einzelne fehlgeschlagene Hits werden dauerhaft übersprungen.
BELEG: `if (cursorContiguous) lastIndexedDate = date;` steht vor `if (idxRes.notFound) ... continue;` (463–469), weitere Teilfehler 489–529, Persistenz 568–598.
REPRO: Einen Werktagsindex zunächst als 404 oder zwei Hits mit einem Fehler liefern; der nächste Lauf beginnt hinter diesem Tag.
FIX-SKIZZE: Cursor erst nach vollständig erfolgreicher Tagesverarbeitung fortschreiben.

### F-CGPT-31 | datei=scripts/pull-13f-institutional.js:568 | klasse=sweep1 | schwere=hoch
BEFUND: Scheitert der Basisabruf, wird ein Teil-Amendment allein als frischer Vollbestand persistiert; `baseFetchError` geht auf dem Persistenzweg verloren.
BELEG: `if (base.error) { return { positions: amend.positions, ... lowPositionAmendment: true, baseFetchError: base.error } }` (568–585), Persistenz 987–1034.
REPRO: Amendment erfolgreich, Basis-Information-Table fehlschlagen lassen; nicht geänderte Holdings fehlen im frisch gestempelten Buch.
FIX-SKIZZE: Bei Basisfehler Vorbestand bewahren und Amendment nicht als Vollerfolg persistieren.

### F-CGPT-32 | datei=scripts/b1-validate.js:133 | klasse=sweep1 | schwere=hoch
BEFUND: Submissions-Fehler lösen `null` auf, Versuche werden dennoch als Erfolge gezählt und der Caller ignoriert das Resultat; betroffene Firmen fallen ohne Warnung aus dem Matching.
BELEG: `req.on('error', () => resolve(null));`, `return { fetched: missing.length };` (133–167, 477, 525–535).
REPRO: Für einen fehlenden CIK HTTP 500 liefern; `sic2Of` bleibt null, Records verschwinden aus `usable`, ein Restlauf kann Exit 0 liefern.
FIX-SKIZZE: Reale Erfolge/Fehler zählen und unvollständige Pflichtanreicherung blockieren.

### F-CGPT-33 | datei=scripts/check-pull-stats.js:60 | klasse=sweep1 | schwere=hoch
BEFUND: Korrupte Pull-Stats-Historie fällt nach Warnung auf `[]` und wird sofort mit nur dem aktuellen Tag überschrieben.
BELEG: `let history = loadJson(histPath) || [];` und `writeFileAtomic(histPath, ...)` (60–64,145–165).
REPRO: `pull-stats/history.json` beschädigen und den Wächter starten; bis zu 26 Wochen Baseline verschwinden, Ausgabe kann „no drift detected“ lauten.
FIX-SKIZZE: Vorhandene unlesbare Historie nicht überschreiben.

### F-CGPT-34 | datei=scripts/check-pull-stats.js:95 | klasse=sweep1 | schwere=mittel
BEFUND: Ein korrupter Preis-Shard setzt `priceTickerCount=null`; die Driftprüfung überspringt die unbekannte Metrik vollständig.
BELEG: `catch (_) { /* corrupt shard -> leave null */ }` und `if (todayVal == null) continue;` (95–99,118–137).
REPRO: Einen Preis-Shard beschädigen und andere Metriken stabil halten; Ausgabe kann weiter „no drift detected“ melden.
FIX-SKIZZE: Loaderfehler als eigenen Breach behandeln.

### F-CGPT-35 | datei=scripts/watch-exchange-coverage.js:31 | klasse=sweep1 | schwere=hoch
BEFUND: Eine korrupte Exchange-Baseline wird als leere Historie geladen und durch den heutigen Stand ersetzt; der Vergleichsanker geht mit grünem Exit verloren.
BELEG: `const baseline = loadJson(BASELINE_PATH, {});` (31–32), Schreiben/Gesundmeldung in 125–144.
REPRO: Baseline beschädigen und Wächter ausführen; Ausgabe meldet „No exchange coverage drift“.
FIX-SKIZZE: Nur fehlende Datei darf initial seeden.

### F-CGPT-36 | datei=scripts/watch-fx-sanity.js:44 | klasse=sweep1 | schwere=mittel
BEFUND: Eine korrupte FX-Baseline wird zu `null`; der Tagesvergleich entfällt und der aktuelle Stand wird neu verankert.
BELEG: `const baseline = loadJson(BASELINE_PATH, null);` (44–45), `checkJump`/Persistenz in 207–225.
REPRO: Baseline beschädigen und den Wächter starten; „No FX-sanity drift“ und Exit 0 sind möglich.
FIX-SKIZZE: Vorhandene unlesbare Baseline blockieren.

### F-CGPT-37 | datei=scripts/watch-unrouted-quote.js:30 | klasse=sweep1 | schwere=hoch
BEFUND: Eine korrupte Label-Baseline gilt als Erstseeding; bekannte Labels und der aktuelle Rename-Alarm werden überschrieben.
BELEG: `const baseline = loadJson(BASELINE_PATH, null);` (30–31), Seed-/Writepfad 73–98.
REPRO: Baseline beschädigen und neue Taxonomielabels liefern; Lauf endet ohne Driftalarm.
FIX-SKIZZE: Parsefehler vom legitimen Erstlauf trennen.

### F-CGPT-38 | datei=scripts/watch-unrouted-quote.js:34 | klasse=sweep1 | schwere=mittel
BEFUND: Null geprüfte Snapshots werden als gesunde Quote `0` interpretiert; ein komplett ausgefallener Canary-Scan bleibt grün.
BELEG: `if (!s) continue;`, `catch (e) { continue; }` und `const share = routable > 0 ? ... : 0` (34–52,68–98).
REPRO: Nur ungültige JSONs in den Fixture-Ordner legen; Ausgabe endet „No unrouted/taxonomy drift.“
FIX-SKIZZE: Parse-/Routefehler zählen und `routable===0` als nicht messbar behandeln.

### F-CGPT-39 | datei=scripts/plan-check.js:49 | klasse=sweep1 | schwere=mittel
BEFUND: Manifest- und Snapshot-Verzeichnisfehler werden verschluckt; nicht messbare Kernwerte werden von Rangechecks ausgelassen und als „im Rahmen“ zusammengefasst.
BELEG: `catch (e) {}` sowie `if (Number.isFinite(nTotal) ...` (49–55,70–75,103–105).
REPRO: Manifest beschädigen und Snapshotordner unlesbar machen; Bericht kann „Keine Drift-Flags“ und Exit 0 liefern.
FIX-SKIZZE: Nicht messbare Pflichtfakten als eigenen Driftstatus ausgeben.

### F-CGPT-40 | datei=scripts/write-findash-export.js:834 | klasse=sweep1 | schwere=mittel
BEFUND: `--check` unterscheidet fehlende optionale QC-/Small-Cap-Indizes nicht von vorhandenen korrupten Indizes und meldet deshalb Schema-OK.
BELEG: `if (!idx) return raw;` nach `readJSONOrNull` in 834–837 und 884–887.
REPRO: Gültigen Hauptfeed belassen, `quality/index.json` beschädigen und `--check` ausführen; Exit 0 bleibt möglich.
FIX-SKIZZE: Vorhandene unlesbare Datei als Validierungsfehler melden.

### F-CGPT-41 | datei=src/scoring/profit-streak.js:44 | klasse=sweep1 | schwere=mittel
BEFUND: Fehlende/unlesbare Bulkdatei oder kaputte JSONL-Zeilen werden zu leerer/kleinerer Map; `profitStreak` fehlt ohne Log oder Fehlerstatus.
BELEG: `catch (_) { return m; }` und zeilenweise `catch (_) { continue; }` (44–55).
REPRO: Bulkpfad ungültig machen oder eine Tickerzeile beschädigen; Scoring/Export laufen weiter.
FIX-SKIZZE: Quellen- und Zeilenfehler zählen und sichtbar machen.

### F-CGPT-42 | datei=scripts/rank-ic.js:407 | klasse=sweep1 | schwere=mittel
BEFUND: Ein fehlendes/korruptes Archiv eines kompaktierten Vintages wird still durch die gestrippte Kernversion ohne PIT ersetzt; Delivery-Beobachtungen fallen aus dem Nenner.
BELEG: Catch in 407–419; Auswertung/`evaluable` in 577–607.
REPRO: `archivedTo` eines kompaktierten t0-Vintages entfernen und Delivery-IC rechnen; `delivery.n` sinkt ohne Archivwarnung.
FIX-SKIZZE: Deklariertes Archiv als Pflichtinput behandeln.

### F-CGPT-43 | datei=scripts/write-newcomer-log.js:109 | klasse=sweep1 | schwere=mittel
BEFUND: Eine leere oder strukturell falsche Overview erzeugt keinen Newcomer-Tag und gilt ausdrücklich als Erfolg.
BELEG: `if (!members.length) return { status: 'uebersicht-leer', ... exitCode: 0 };` (109–112,163–178).
REPRO: Overview als `{ "rows": {} }` bereitstellen; Ausgabe „nichts geschrieben“, Exit 0.
FIX-SKIZZE: Leere Pflicht-Overview als nicht messbaren/blockierenden Zustand markieren.

### F-CGPT-44 | datei=scripts/cadence-marker.js:34 | klasse=sweep1 | schwere=mittel
BEFUND: Nach State-Parsefehler wird aus `null` neu gestempelt; dabei verschwindet das Geschwisterfeld des anderen Takts, der Lauf bleibt aber grün.
BELEG: `const updated = stampMarker(existing, field, nowIso);` bei `existing = null` (34–46,59–61).
REPRO: State beschädigen und nur `--field weekly` ausführen; `last_monthly_run` fehlt danach.
FIX-SKIZZE: Korrupte vorhandene State-Datei nicht überschreiben.

### F-CGPT-45 | datei=scripts/heartbeat-preis-abdeckung.js:94 | klasse=sweep1 | schwere=mittel
BEFUND: Watchlist-, Preisstore- oder Messfehler geben `return 0`; der aktuelle Abdeckungswert fehlt, CI bleibt grün.
BELEG: Fehlerpfade in 94–117 und 138–143 enden nach `::warning::` mit Erfolg.
REPRO: Pflichtinput beschädigen und Skript starten; kein Messwert, Exit 0.
FIX-SKIZZE: Pflichtinputfehler mit Nonzero-Exit beenden.

### F-CGPT-46 | datei=scripts/value-spot-check.js:129 | klasse=sweep1 | schwere=mittel
BEFUND: Unlesbarer Snapshotordner, zu kleine Probe oder Crash werden als erfolgreicher, nur ausgefallener Spot-Check behandelt.
BELEG: Frühe Rückkehr 129–130 und Top-Level-Catch 239 enden `process.exit(0)`.
REPRO: Snapshotordner unlesbar machen; unabhängige Wertprüfung fehlt bei grünem Job.
FIX-SKIZZE: „Nicht geprüft“ von „bestanden“ im Exitstatus trennen.

### F-CGPT-47 | datei=scripts/prune-watchlist.js:146 | klasse=sweep1 | schwere=mittel
BEFUND: Watchlist-Parse-/Schemafehler werden mit `console.error` gemeldet, beenden den Prune aber mit Exit 0.
BELEG: Fehlerpfade in 146–157 setzen keinen Nonzero-Exit.
REPRO: Ungültige Watchlist bereitstellen und Exitcode prüfen; der gesamte Prune-Entscheid entfällt bei Erfolgscode.
FIX-SKIZZE: Nicht ausgeführten Pflicht-Prune als Fehler beenden.

### F-CGPT-48 | datei=scripts/walk-forward-perf.js:798 | klasse=sweep1 | schwere=niedrig
BEFUND: Ein korrupter Preis-Shard wird zu `history=null`; der Backtest kehrt grün zurück und alte Reports bleiben als letzter sichtbarer Stand liegen.
BELEG: Fehlerpfad in 798–806 kehrt ohne Nonzero-Exit zurück.
REPRO: Preis-Shard beschädigen und Skript starten; Reports werden nicht aktualisiert, Exit 0.
FIX-SKIZZE: Ausfall mit Failure-/Stale-Marker und Nonzero-Exit kennzeichnen.

### F-CGPT-49 | datei=scripts/b1-instrument.js:28 | klasse=sweep1 | schwere=mittel
BEFUND: Eine kaputte Ticker-Map soll laut Kommentar „n/a“ ergeben, wird im Resultat aber als echte 0-%-Abdeckung ausgegeben.
BELEG: `catch (_) { /* Quote dann n/a */ }`, danach `hasTicker=false` und `tickerMappableRate: ... 0` (28–32,40,60).
REPRO: Ticker-Map beschädigen und Instrumentierung ausführen; Quote ist 0 statt null/nicht messbar.
FIX-SKIZZE: Mapfehler blockieren oder Quote tatsächlich als null ausgeben.

### F-CGPT-50 | datei=scripts/f1-burnverschiebung.js:48 | klasse=sweep1 | schwere=niedrig
BEFUND: Sieben Offline-Messskripte verwerfen kaputte Beobachtungen ohne Parsezähler und rechnen mit unbekannt kleinerem Nenner weiter.
BELEG: Typisches Muster `catch (_) { continue; }` in `f1-burnverschiebung.js:48`, `f1-rekonstruktions-kipppunkte.js:158`, `f4-quartalsvergleich.js:54,73–75,160,168`, `einmalertrag-trefferquote.js:102–104,163–164,229–230`, `k1-boardstruktur-mess.js:124`, `score-digest.js:55`, `roic-reliability.js:205,214`.
REPRO: Je Skript eine Inputdatei beschädigen und ausgegebenen Nenner/Fehlerzähler vergleichen; kein betroffener Pfad wird gemeldet.
FIX-SKIZZE: Parsefehler je Lauf zählen und zusammen mit dem Nenner ausgeben.

## Sweep 2 — Wächter-Qualität der Tests

### F-CGPT-51 | datei=tests/a10-period-ends.test.js:164 | klasse=sweep2 | schwere=mittel
BEFUND: Der Test schneidet den Quelltext von `_priceOnlyUpdate` aus und sucht dort nur das Wort `timeseries`; Verhalten und aufgerufene Helfer bleiben ungeprüft.
BELEG: Quellslice/Stringprüfung in 164–173.
REPRO: Einen von `_priceOnlyUpdate` aufgerufenen Helfer so ändern, dass er `timeseries` löscht; das Wort steht außerhalb des ausgeschnittenen Funktionskörpers, der Test bleibt grün.
FIX-SKIZZE: Snapshot vor/nach echtem Price-only-Aufruf vergleichen.

### F-CGPT-52 | datei=tests/ba-sc-001-tsx-namensfilter.test.js:117 | klasse=sweep2 | schwere=mittel
BEFUND: Ein erwarteter Logging-Aufruf wird nur als Text gesucht und darf in unerreichbarem Code stehen.
BELEG: Quelltextsuche in 117–127 nach `nameFilterLines(...)`.
REPRO: `if (false) nameFilterLines(...)` als Attrappe behalten und den aktiven Logaufruf entfernen; Regex bleibt grün.
FIX-SKIZZE: Filter mit Fixture ausführen und die tatsächliche Ausgabe prüfen.

### F-CGPT-53 | datei=tests/bk-sk-001-mitschnitt-stille-pannen.test.js:110 | klasse=sweep2 | schwere=mittel
BEFUND: Hash-/Workflow-Schutz basiert auf exakten Textvorkommen; fehlt das Ground-Image, kehrt ein weiterer Test still als Pass zurück.
BELEG: Zählung von `createHash('sha256')` in 110–116, Workflowtext in 183–186; `return` bei fehlendem Bild in 175–180.
REPRO: Erwartete Hash-Calls in zwei unbenutzten Helfern belassen, den aktiven Pfad unsortiert hashen und Ground-Image entfernen; Datei bleibt grün.
FIX-SKIZZE: Aktiven Mitschnitt mit temporärem Datenbaum ausführen und fehlende Pflichtfixture fehlschlagen lassen.

### F-CGPT-54 | datei=tests/board-history-gate-blind.test.js:144 | klasse=sweep2 | schwere=hoch
BEFUND: Die Blind-Gate-Warnung wird nur über erforderliche Strings gepinnt; tote Strings genügen.
BELEG: String-/Regexprüfungen in 144–149 und 162–168.
REPRO: Erwartete Warnung in `if (false)` belassen und den aktiven Warnpfad entfernen; Test bleibt grün, ein blindes Gate wird nicht sichtbar.
FIX-SKIZZE: Blindes Vorgänger-Fixture durch den echten Writer schicken und Exit/Output prüfen.

### F-CGPT-55 | datei=tests/daten-waechter-alarm.test.js:49 | klasse=sweep2 | schwere=hoch
BEFUND: Mehrere Alarmtests prüfen nur IDs, Meldungsstrings und lexikalische Reihenfolge; deaktivierte oder nach einem frühen Erfolg liegende Fehlerpfade bestehen.
BELEG: Textprüfungen 49–87; Rückgabe-/Exitfenster 90–112.
REPRO: Vor `::error::` ein `exit 0` setzen oder den Collector mit `if: false` deaktivieren und die erwarteten Strings stehen lassen; alle Regex bleiben grün.
FIX-SKIZZE: Die Workflow-Schritte mit simulierten Outcomes ausführen.

### F-CGPT-56 | datei=tests/dt1-adapter-zeitbudget.test.js:83 | klasse=sweep2 | schwere=mittel
BEFUND: Timeout und Konstanten werden aus Workflow-/Quelltext gelesen; ein deaktivierter Attrappenschritt oder unbenutzte Konstanten erfüllen den Test.
BELEG: Abschnittssuche 83–90 und Konstantenpins 105–121.
REPRO: Ersten passenden Refresh-Schritt `if: false` setzen, einen zweiten aktiven ohne Timeout einfügen; Scanner wertet nur den ersten.
FIX-SKIZZE: Aktiven Schritt eindeutig parsen und Laufzeitverhalten mit erzwungenem Timeout prüfen.

### F-CGPT-57 | datei=tests/dt2-watchlist-schreibbeweis.test.js:139 | klasse=sweep2 | schwere=hoch
BEFUND: Der Schreibbeweis akzeptiert einen deaktivierten Referenzschritt und bloße Ausdrucksstrings als Verdrahtung.
BELEG: Reihenfolge/Stringprüfung 139–160.
REPRO: Referenzstep mit `if: false` belassen, aktiven Write entfernen; Namen und Reihenfolge bleiben im YAML und der Test grün.
FIX-SKIZZE: Schritt unter Testbedingungen tatsächlich ausführen und erzeugte Watchlist prüfen.

### F-CGPT-58 | datei=tests/f12-merge-filter.test.js:324 | klasse=sweep2 | schwere=hoch
BEFUND: Pfade, Filterreihenfolge und Gitignore-Schutz werden lexikalisch gepinnt; Attrappen, tote Filter und spätere Gegenausnahmen passieren.
BELEG: String-/Indexprüfungen 324–357 und 372–376.
REPRO: `snapshots-eingang` nur in Kommentar/ungenutztem Key belassen, aktiven Filter in `if false` setzen und später `!snapshots-eingang/` einfügen; Test bleibt grün.
FIX-SKIZZE: Merge mit temporären Eingangs-/Altdateien verhaltensbasiert testen.

### F-CGPT-59 | datei=tests/gate-coverage.test.js:44 | klasse=sweep2 | schwere=hoch
BEFUND: Der Test prüft Deklarationen und Meldungstext, nicht welche Liste die aktive Schleife wirklich ausführt oder ob der Fehlerexit erreichbar ist.
BELEG: Textpins 44–72.
REPRO: `GATE_GLOB` vollständig deklarieren, aktive Schleife aber über eine feste Teilliste laufen lassen; erwartete Meldung nach frühem Exit 0 belassen.
FIX-SKIZZE: Aus dem Workflow die aktive Shell extrahieren und gegen einen künstlich ungegateten Test laufen lassen.

### F-CGPT-60 | datei=tests/merge-shard-manifests-atomic.test.js:27 | klasse=sweep2 | schwere=mittel
BEFUND: Atomarität wird nur durch Import-/Callstrings und einen engen Verbotsregex geschützt.
BELEG: Quelltextpins in 27–34.
REPRO: Erwartete `writeFileAtomic`-Calls tot belassen und real `fs.writeFileSync(manifestPath, ...)` verwenden; der enge negative Regex lässt die Variante durch.
FIX-SKIZZE: Schreibabbruch am echten Merge simulieren und Manifestintegrität prüfen.

### F-CGPT-61 | datei=tests/monthly-sec-failloud.test.js:41 | klasse=sweep2 | schwere=hoch
BEFUND: Monatlicher SEC-Fail-loud-Schutz beruht auf Tokens, Reihenfolge und Crontext; tote Shell, `continue-on-error` oder früher Erfolg bleiben unentdeckt.
BELEG: Regex-/Stringtests 41–68 und 92–105.
REPRO: Erwartete Fehlerstrings in totem Shellblock belassen und aktiven Befehl mit `|| true` versehen; Test bleibt grün.
FIX-SKIZZE: Workflowjob mit absichtlich fehlschlagendem SEC-Build ausführen und Jobstatus prüfen.

### F-CGPT-62 | datei=tests/newcomer-log.test.js:90 | klasse=sweep2 | schwere=mittel
BEFUND: Der Pfadschutz verbietet nur das Literal `picks-history`; zusammengesetzte gleichwertige Pfade sind unsichtbar.
BELEG: Regex in 90–96.
REPRO: Produktionspfad als `'picks-' + 'history'` bauen; Verhalten bricht den Schutz, Test bleibt grün.
FIX-SKIZZE: Writer gegen temporäre Rootstruktur ausführen und tatsächlichen Zielpfad prüfen.

### F-CGPT-63 | datei=tests/nrb-sk-001-impossible-zero-revenue.test.js:76 | klasse=sweep2 | schwere=mittel
BEFUND: Zwei exakte Calls und ihre Reihenfolge werden im Text gesucht; tote Attrappen können den aktiven defekten Pfad verdecken.
BELEG: Call-/Indexprüfungen 76–85.
REPRO: Zwei erwartete Calls in unbenutztem Block belassen, aktive Pfade ohne Revenue-Guard bauen; Test bleibt grün.
FIX-SKIZZE: Null-/fehlende-Umsatz-Fixtures durch den echten Snapshotbuilder schicken.

### F-CGPT-64 | datei=tests/opinc-feld.test.js:48 | klasse=sweep2 | schwere=mittel
BEFUND: Priorität und Fallback werden über Zahl/Reihenfolge exakter `_ftsValue`-Strings geprüft, nicht über erzeugte Werte.
BELEG: Quelltextpins 48–82.
REPRO: Passende Calls unbenutzt stehen lassen und den Livepfad über einen anderen Helfer mit falscher Priorität führen; Test bleibt grün.
FIX-SKIZZE: Konfligierende as-reported-/derived-Fixture ausführen und Ergebnisfeld prüfen.

### F-CGPT-65 | datei=tests/r5-ops-001-inaktiver-health-check.test.js:52 | klasse=sweep2 | schwere=hoch
BEFUND: Health-Check-Aktivität wird aus Namen, Hints, Calls und Konstanten im Text abgeleitet; aktive Checks dürfen abweichend/stumm sein.
BELEG: Sechs Stringtestgruppen 52–84; Pfad-/Gitignorepins 112–134.
REPRO: Erwartete Calls in Kommentar/`if(false)` belassen, aktiven Check nur warnen lassen und Outputpfad zusammensetzen; Scanner bleibt grün.
FIX-SKIZZE: Healthcheck mit fehlerhafter Fixture ausführen und Alarmartefakt/Exit prüfen.

### F-CGPT-66 | datei=tests/r5-sk-002-fx-frische-drei-zustaende.test.js:64 | klasse=sweep2 | schwere=hoch
BEFUND: FX-Frische-Wächtertests prüfen Shell-/Schwellenstrings und Reihenfolge, nicht den ausgeführten Block.
BELEG: Texttests 64–68,108–129 und 146–151.
REPRO: Frühen `exit 0` vor Fehlermeldung setzen, erwartete Schwellen in totem Block belassen und aktiven Zustand anders behandeln; Test bleibt grün.
FIX-SKIZZE: Alle drei Zustände gegen die extrahierte aktive Shell ausführen.

### F-CGPT-67 | datei=tests/refresh-universe.test.js:105 | klasse=sweep2 | schwere=hoch
BEFUND: Große Teile der Suite scannen Quell-/Workflowtext; tote Calls, deaktivierte Schritte, Alias-Schreibweisen und frühe Returns können Discovery-, Timeout- und Alarmverhalten brechen.
BELEG: Betroffene Scanner u.a. 105–119, 273–490, 508–549, 599–738, 779‗834, 892–903, 1102–1215, 1239–1446.
REPRO: Erwartete Floor-/Alarmcalls in `if(false)` belassen, aktiven Pull mit anderem Variablennamen oder frühem Erfolg ausführen; lexikalische Pins bleiben grün.
FIX-SKIZZE: Discoverypfade mit Netzwerk-Fixtures und den Workflowblock als ausführbare Shell testen.

### F-CGPT-68 | datei=tests/s4-disc-001-teilausfall-sichtbar.test.js:122 | klasse=sweep2 | schwere=hoch
BEFUND: Sichtbarkeit eines Discovery-Teilausfalls wird nur über vorhandene Feld-/Meldungsstrings in engem Textfenster geprüft.
BELEG: Stringtests 122–140.
REPRO: Pflichtfelder unbenutzt stehen lassen, Meldung nach `return` setzen oder Red-Helfer außerhalb des Fensters verschieben; Test bleibt grün.
FIX-SKIZZE: Einen realen Adapterausfall einspeisen und strukturiertes Ergebnis/Exit prüfen.

### F-CGPT-69 | datei=tests/s4-price-001-preis-abdeckung.test.js:110 | klasse=sweep2 | schwere=hoch
BEFUND: Fehlende Messbarkeit führt zu einem stillen Test-Return; der angebliche „kann nicht rot werden“-Check verbietet nur zwei Fehlerschreibweisen.
BELEG: `return` nach Warnung 110–119; enge Verbote in 122–125; Text-/Schrittpins 160–192.
REPRO: `process.exitCode = 1` oder `throw` verwenden und die Messfixture entfernen; die Regex sieht keinen verbotenen Exit, reale Metrikchecks laufen nicht.
FIX-SKIZZE: Pflichtfixture erzwingen und tatsächlichen Schrittstatus ausführen.

### F-CGPT-70 | datei=tests/secbulk.test.js:155 | klasse=sweep2 | schwere=mittel
BEFUND: Geschützter Pfad und Achsenkonstante werden nur als Literale gesucht; zusammengesetzte Pfade oder unbenutzte Konstanten passieren.
BELEG: Quelltextpins 155–160 und 195–200.
REPRO: Pfad per Stringkonkatenation bauen und für die reale Achse eine andere Konstante verwenden; Test bleibt grün.
FIX-SKIZZE: SEC-Bulk-Fixture durch den produktiven Achsenpfad auswerten.

### F-CGPT-71 | datei=tests/sec-user-agent-test.js:69 | klasse=sweep2 | schwere=mittel
BEFUND: Nur fünf fest benannte Skripte und Literal-E-Mailstrings werden geprüft; zusammengesetzte Identitäten oder neue Puller entgehen dem Test.
BELEG: feste Dateiliste/Regex 69–75.
REPRO: E-Mail in Teilstrings zusammensetzen oder einen sechsten SEC-Puller mit hartem Header hinzufügen; Test bleibt grün.
FIX-SKIZZE: Alle getrackten SEC-HTTP-Caller inventarisieren und Requestheader verhaltensbasiert prüfen.

### F-CGPT-72 | datei=tests/t564-datenkanal.test.js:211 | klasse=sweep2 | schwere=hoch
BEFUND: Retry, Heartbeat, Compare, Export und Guard werden fast ausschließlich per Workflowtext gepinnt; komplette Schutzjobs dürfen deaktiviert sein.
BELEG: Textbereiche 211–326,343–418,468–510 und Gitignorepins 647–650.
REPRO: Erwartete Blöcke mit `if:false` belassen und aktiven Publish blind ausführen; Strings/Reihenfolge bleiben erhalten.
FIX-SKIZZE: Den Datenkanalworkflow mit fehlerhaften Zwischenartefakten end-to-end ausführen.

### F-CGPT-73 | datei=tests/tag559-quartals-buendel.test.js:260 | klasse=sweep2 | schwere=mittel
BEFUND: Exakte Assignment-/Merge-Strings dürfen in totem Code stehen, während der aktive Pfad Quartalsbündel verliert.
BELEG: Quelltextpins 260–271.
REPRO: Erwartete Zuweisung und Mergecall in `if(false)` belassen, aktiv per Bracket-Notation ohne Merge schreiben; Test bleibt grün.
FIX-SKIZZE: Mehrere Quartalsfixturen durch den echten Pullpfad mergen.

### F-CGPT-74 | datei=tests/tag561-fts-cache-integritaet.test.js:110 | klasse=sweep2 | schwere=mittel
BEFUND: Cachevalidierung, Log und Assignment werden nur als Strings gesucht und können unerreichbar sein.
BELEG: Textpins 110–128 und 160–164.
REPRO: Validierung hinter `return` oder in totem Helfer belassen und aktiven Cache ungeprüft schreiben; Test bleibt grün.
FIX-SKIZZE: Korrupte FTS-Fixture an den echten Cachewriter übergeben.

### F-CGPT-75 | datei=tests/ticker-map.test.js:108 | klasse=sweep2 | schwere=mittel
BEFUND: Filter-, Guard-, CIK- und Pfadschutz werden lexikalisch geprüft; unbenutzte Filter und nur loggende Guards bestehen.
BELEG: String-/Regexbereiche 108–125,149–169 und 248–266.
REPRO: Filterstrings unbenutzt belassen, Writer anhängen lassen und Guard nur loggen; Test bleibt grün.
FIX-SKIZZE: Quellenfixtures durch den produktiven Map-Writer schicken und fertige Map prüfen.

### F-CGPT-76 | datei=tests/v-sk-001-fx-rate-validation.test.js:75 | klasse=sweep2 | schwere=mittel
BEFUND: Variablennamen und Validierungsmuster werden nur im Quelltext gezählt; tote Prüfungen schützen einen rohen Merge nicht.
BELEG: Textpins 75–99.
REPRO: Drei erwartete Validierungen in unbenutztem Block belassen und aktiv Rohwerte mergen; Test bleibt grün.
FIX-SKIZZE: Ungültige/negative/fehlende FX-Fixtures durch den echten Merge schicken.

### F-CGPT-77 | datei=tests/waechter-absturz.test.js:26 | klasse=sweep2 | schwere=hoch
BEFUND: Der Test erkennt nur `process.exit(0)` in einem ausgeschnittenen Catch-Snippet; andere Erfolgsausgänge verschlucken denselben Absturz.
BELEG: enge Snippet-/Regexprüfung 26–42.
REPRO: Catch auf `process.exitCode = 0; return;` oder benannten Handler umstellen; Wächter bleibt grün und Test passiert.
FIX-SKIZZE: Den Wächterprozess werfen lassen und den realen Exitcode beobachten.

### F-CGPT-78 | datei=tests/discovery/hkex-hk.test.js:22 | klasse=sweep2 | schwere=mittel
BEFUND: Ergibt der Parser null Treffer, beendet sich der Live-Adaptertest absichtlich mit Exit 0 und prüft weder Format, Mindestgröße noch Anker.
BELEG: `if (map.size === 0) process.exit(0);` in 22–24.
REPRO: Parser so brechen, dass jede HKEX-Zeile verworfen wird; der Test bleibt grün.
FIX-SKIZZE: Leeres Resultat als Testfehler behandeln oder eine hermetische HTML-Fixture verwenden.

### F-CGPT-79 | datei=tests/yahoo-schema-canary.js:394 | klasse=sweep2 | schwere=hoch
BEFUND: Jede Ausnahme wird als externe Yahoo-Unerreichbarkeit klassifiziert; auch eigener Request-/Parserbruch endet nach zwei Versuchen mit Exit 0.
BELEG: Catch-Klassifizierung 394–398 und Erfolgsbehandlung 427–437.
REPRO: Requestbody absichtlich falsch benennen, sodass Yahoo HTTP 400 liefert; Canary meldet „unreachable“ und Exit 0.
FIX-SKIZZE: Transportausfall von 4xx-, Schema- und Parserfehlern trennen.

### F-CGPT-80 | datei=tests/scoring/acceleration-invariance.test.js:83 | klasse=sweep2 | schwere=mittel
BEFUND: Zwei von drei Reihenlängen dürfen ohne Assertion `continue` auslösen; eine produktive Fixierung auf genau 12 Quartale bleibt unentdeckt.
BELEG: `if (a === null) continue; // zu kurz ist erlaubt, falsch ist es nicht` (87) im Test 83–89.
REPRO: `revAcceleration()` auf `if (revenueQ.length !== 12) return null` ändern; 8/16 werden nicht mehr geprüft, 12 bleibt grün.
FIX-SKIZZE: Für jede behauptete Reihenlänge eine nicht-null Assertion verlangen.

### F-CGPT-81 | datei=tests/scoring/achsen-redundanz.test.js:260 | klasse=sweep2 | schwere=mittel
BEFUND: Fehlt das reale Kalibrierungsartefakt, wird der Produktionsaudit übersprungen und nur ein synthetischer Selbsttest ausgeführt.
BELEG: `if (!quelle) { console.log('... uebersprungen.'); }` (261–264), ohne Fehler/Skip-Status.
REPRO: `board-history/<datum>/calibration.json` entfernen und zwei Produktionsachsen identisch machen; Prozess endet trotzdem Exit 0.
FIX-SKIZZE: Pflichtartefakt erzwingen oder den Produktionsvergleich mit hermetischer Fixture ausführen.

### F-CGPT-82 | datei=tests/scoring/anchors.rank.test.js:31 | klasse=sweep2 | schwere=hoch
BEFUND: Parsefehler werden geschluckt und bei weniger als 100 Snapshots endet die gesamte Anker-/Ranking-Suite mit Exit 0.
BELEG: Catch 31–35 und `if (universe.length < 100) { ... process.exit(0); }` (37–40); betroffen sind Tests 62–121.
REPRO: Snapshotpfad leer setzen und CRDO aus dem Routing entfernen; Datei meldet Erfolg ohne Ankerassertion.
FIX-SKIZZE: Integrationsfixture verpflichtend machen und Nulltests als Fehler ausweisen.

### F-CGPT-83 | datei=tests/scoring/bh-b03-boardhist.test.js:291 | klasse=sweep2 | schwere=mittel
BEFUND: Der Tempdir-Schutz ist ein negativer Regex auf das Literal `tmpdir`; gleichwertige Schreibweisen passieren.
BELEG: `assert.ok(!/tmpdir/.test(src), ...)` nach `readFileSync` (291–293).
REPRO: Fallback als `os['tmp' + 'dir']()` schreiben; Archiv liegt wieder flüchtig, Test bleibt grün.
FIX-SKIZZE: Writer ausführen und tatsächlichen Archivpfad prüfen.

### F-CGPT-84 | datei=tests/scoring/bh-b06-pullyahoo.test.js:157 | klasse=sweep2 | schwere=mittel
BEFUND: Rate-Limit-Verteilung wird über exakte Assignmentstrings und Callanzahl gepinnt; eine spätere Überschreibung bleibt unentdeckt.
BELEG: Regexpins 161–165 auf `_yfGateSleepMs = rateLimitMs / YF_REQUESTS_PER_TICKER` und `acquireYfSlot()`.
REPRO: Erwartete Division stehen lassen und danach `_yfGateSleepMs = configuredDelay` setzen; reales Warten ist falsch, Test grün.
FIX-SKIZZE: Uhr/Slotter injizieren und gemessene Requestabstände testen.

### F-CGPT-85 | datei=tests/scoring/bh-b07-runscreener.test.js:80 | klasse=sweep2 | schwere=mittel
BEFUND: Der reale SEC-Serienzähler wird bei fehlender optionaler Datei mit nacktem `return` als Pass gewertet.
BELEG: `if (!require('node:fs').existsSync(p)) return;` (85).
REPRO: Reale SEC-Datei entfernen und `hasFiniteSeries` nur für längere Reihen brechen; synthetische Kurzfälle bleiben grün, Realcheck läuft nicht.
FIX-SKIZZE: Reale Fixture verpflichtend machen oder explizit als fehlgeschlagen kennzeichnen.

### F-CGPT-86 | datei=tests/scoring/bh-b09-dailyyml.test.js:25 | klasse=sweep2 | schwere=hoch
BEFUND: 23 Workflowtests lesen YAML nur als Text; deaktivierte Schritte/tote Shell erfüllen Namen, Befehle und Reihenfolge. Vier FX-Tests prüfen zudem einen lokal nachgebauten Helfer statt Workflowcode.
BELEG: `const yml = fs.readFileSync(YML_PATH, 'utf8');` (25), Regex/Stringtests 43–240; eigener `fxFetchedEpochSec` 89–95.
REPRO: Erwartete Befehle in `if: false` belassen und aktiven Schritt entfernen; lokale Helfertests sowie Textpins bleiben grün.
FIX-SKIZZE: Workflow parsen/ausführen und den echten FX-Block testen.

### F-CGPT-87 | datei=tests/scoring/bh-b10-otheryml.test.js:27 | klasse=sweep2 | schwere=hoch
BEFUND: Andere Workflows werden ausschließlich über Regex/Positionen geprüft; tote Befehle, frühe Erfolgs-Exits und anders geschriebene Node-Versionen passieren.
BELEG: `const read = (f) => fs.readFileSync(...)` (27), betroffene Tests 38–129.
REPRO: SEC-Build in totem Block belassen, davor `exit 0` setzen und aktiven Job auf unquoted `node-version: 20` stellen; Scanner bleibt grün.
FIX-SKIZZE: Aktive Jobs/Steps strukturell parsen und Fehlerzweige ausführen.

### F-CGPT-88 | datei=tests/scoring/bh-messlauf3.test.js:195 | klasse=sweep2 | schwere=mittel
BEFUND: Atomare Report-/Checkpointwrites werden nur durch Callstrings und einen engen Verbotsregex geschützt.
BELEG: Quelltextpins 196–199.
REPRO: Erwartete Atomic-Calls in `if(false)` belassen und aktiv `const write=fs.writeFileSync; write(...)` nutzen; Test bleibt grün.
FIX-SKIZZE: Schreibabbruch am realen Messlauf simulieren.

### F-CGPT-89 | datei=tests/scoring/bh-w2-13f.test.js:211 | klasse=sweep2 | schwere=mittel
BEFUND: Der Quartalserhalt wird an einem im Test nachgebauten Objekt bewiesen, nicht am Produktionsskript.
BELEG: Lokales `quarters` plus eigenes `Object.assign` in 217–221.
REPRO: Produktionscode auf `quarters = { [reportPeriod]: currentQuarter }` ändern; lokales Testobjekt behält weiter zwei Quartale.
FIX-SKIZZE: Produktionsmerge exportieren/aufrufen und Vorbestand-Fixture prüfen.

### F-CGPT-90 | datei=tests/scoring/bh-w2-dailyfollow.test.js:47 | klasse=sweep2 | schwere=hoch
BEFUND: Ein selbstgebauter Teilparser akzeptiert ungültige GitHub-Actions-Syntax und bewertet Cache-/Follow-up-Schritte nur textuell.
BELEG: Parser 47–126; betroffene Tests 128,150–233.
REPRO: `if: ${{ success()` mit ungeschlossener Expression einfügen oder Sollkonfiguration in deaktivierten Step verschieben; Parser/Test bleibt grün, GitHub lehnt ab bzw. aktiver Cache driftet.
FIX-SKIZZE: Mit vollwertigem YAML-/Actions-Parser validieren und aktive Schritte ausführen.

### F-CGPT-91 | datei=tests/scoring/bh-w2-fxfollow.test.js:89 | klasse=sweep2 | schwere=mittel
BEFUND: Die Reihenfolge `unpriceable` vor Löschung wird nur über Destructuring-/Delete-Regex gepinnt.
BELEG: Quelltextpins 90–95.
REPRO: Passende Zeilen in unbenutztem Helfer belassen, aktive Löschung nur mit `answered.has(eff)` steuern; Test bleibt grün.
FIX-SKIZZE: Unpriceable-Fixture durch den echten Refreshpfad schicken.

### F-CGPT-92 | datei=tests/scoring/bh-w2-krannual.test.js:46 | klasse=sweep2 | schwere=mittel
BEFUND: Der Jahresbereichstest verbietet nur eine konkrete statische Schreibweise bis 2024.
BELEG: `assert.ok(!/const YEARS = \[2015, 2016.*2024\]/.test(src), ...)` (49).
REPRO: `const YEARS = [2015, ..., 2024 + 0];` verwenden; Folgejahre fehlen weiter, Regex bleibt grün.
FIX-SKIZZE: Produktionsfunktion mit aktueller Jahreszahl ausführen und enthaltenes Maxjahr prüfen.

### F-CGPT-93 | datei=tests/scoring/bh-w2-smallcap.test.js:94 | klasse=sweep2 | schwere=mittel
BEFUND: Entfernte Legacypfade, Atomic-Writes und Kandidatenverdrahtung werden durch Literale/Callstrings statt Verhalten geschützt.
BELEG: Textpins 94–130.
REPRO: erwartete Atomic-Calls tot belassen, aktiv Writeralias und `candidates.slice(0,n)` verwenden, Schutzstrings behalten; Test bleibt grün.
FIX-SKIZZE: Small-Cap-Lauf mit geordneten Fixtures und Write-Abbruch ausführen.

### F-CGPT-94 | datei=tests/scoring/bh-w2-watchers.test.js:144 | klasse=sweep2 | schwere=mittel
BEFUND: Der Korruptionsschutz wird an `readOrThrow` nachgebaut; `update-ath-state.js` selbst wird nicht aufgerufen.
BELEG: Lokaler Helfer 150–157.
REPRO: Produktionscode auf `try { JSON.parse(...) } catch { return; }` zurückstellen; lokaler Helfer wirft weiter, Test grün.
FIX-SKIZZE: Korrupte ATH-State-Fixture an das Produktionsskript geben.

### F-CGPT-95 | datei=tests/scoring/calib-parity.test.js:28 | klasse=sweep2 | schwere=hoch
BEFUND: Parsefehler werden geschluckt und unter 100 Snapshots endet die komplette Paritäts-/Bounds-Suite mit Exit 0.
BELEG: Catch 28–32 und `if (universe.length < 100) ... process.exit(0)` (37–40); Tests 48–94.
REPRO: Snapshotpfad leeren und Produktionsranking für große Universen brechen; Datei meldet 0 Fehler ohne Testausführung.
FIX-SKIZZE: Hermetisches Mindestuniversum mitführen.

### F-CGPT-96 | datei=tests/scoring/calibration-ref.test.js:25 | klasse=sweep2 | schwere=hoch
BEFUND: Unter 100 lesbaren Snapshots werden alle 17 Referenz-, Drift- und Merge-Tests still beendet.
BELEG: Parse-Catch 25–29 und Suite-Exit 31–34; Tests 51–323.
REPRO: Snapshotverzeichnis leer setzen und Referenzkalibrierung im Realpfad beschädigen; Ausgabe `0 ok, 0 fail`.
FIX-SKIZZE: Pflichtfixture statt Erfolgsexit bei fehlender Datenbasis verwenden.

### F-CGPT-97 | datei=tests/scoring/calibration.test.js:29 | klasse=sweep2 | schwere=hoch
BEFUND: Alle vier Tests werden bei kleinem Universum beendet; zusätzlich ist der NaN-/Infinity-Check logisch wirkungslos.
BELEG: Suite-Exit 29–32; `JSON.stringify(o).match(/(NaN|Infinity)/) === null` (54–55), obwohl JSON nicht-endliche Zahlen zu `null` serialisiert.
REPRO: `winsorBounds.opMargin=[NaN,Infinity]` setzen; Assertion bleibt grün. Mit leerem Universum laufen gar keine Assertions.
FIX-SKIZZE: Zahlen rekursiv als Werte prüfen und Pflichtfixture erzwingen.

### F-CGPT-98 | datei=tests/scoring/cycle-damper.test.js:108 | klasse=sweep2 | schwere=mittel
BEFUND: Der Schwellen-Pin testet nur eine lokal festgesetzte Zahl und feste Beispiele, nicht den Produktionswert.
BELEG: `const th = 0.16` in 111–115.
REPRO: Produktiv verwendete Schwelle ändern; lokaler `th` bleibt 0.16 und der Test grün.
FIX-SKIZZE: Produktionskonfiguration importieren und über den echten Scorepfad prüfen.

### F-CGPT-99 | datei=tests/scoring/einmalertrag.test.js:192 | klasse=sweep2 | schwere=mittel
BEFUND: Behauptete Score-Neutralität wird nicht berechnet; `assert.ok(rest)` akzeptiert sogar ein leeres Objekt.
BELEG: `assert.ok(rest, 'LAMPS lesbar');` (196), danach nur Listenmitgliedschaft (198).
REPRO: Im Scorepfad bei aktiver `einmalertrag`-Lampe den Score verändern; Test ruft diesen Pfad nicht auf.
FIX-SKIZZE: Identisches Fixture mit/ohne Lampe durch den echten Scorer vergleichen.

### F-CGPT-100 | datei=tests/scoring/f1-ausschuettungsfelder.test.js:138 | klasse=sweep2 | schwere=mittel
BEFUND: Cache- und `canonical.annual`-Verdrahtung wird nur durch Objekt-/Assignmentstrings geschützt; tote Zuweisungen genügen.
BELEG: Quelltextpins 139–153.
REPRO: Erwartete Calls in totem Block belassen und Felder aus realem Payload entfernen; Extraktions-Unit-Tests bleiben ebenfalls grün.
FIX-SKIZZE: Kompletten Pull-zu-Cache-Pfad mit Feldfixture ausführen.

### F-CGPT-101 | datei=tests/scoring/fairness-guards.test.js:30 | klasse=sweep2 | schwere=hoch
BEFUND: Bei leerem Universum entfallen alle fünf Fairness-Tests; zwei Tests lassen fehlende Länder/Anker zusätzlich per Bedingung oder `continue` durch.
BELEG: Suite-Exit 30–33; `if (us != null && jp != null)` (68) und `if (!e) continue` (75).
REPRO: Japan-Normalisierung sowie CRDO/PLTR-Routing brechen und Snapshotpfad leeren; Exit 0.
FIX-SKIZZE: Fehlende erwartete Gruppen/Anker explizit rot werten.

### F-CGPT-102 | datei=tests/scoring/h-commit-retry-abort-test.js:55 | klasse=sweep2 | schwere=hoch
BEFUND: Konfliktzweige werden durch exakte Startstrings und Verbotsstrings geparst; tote Attrappen können einen destruktiven aktiven Zweig verdecken.
BELEG: Parser 55–84, dynamische Tests 95/102.
REPRO: Drei tote `if false`-Blöcke im erwarteten Muster belassen, aktiven Zweig anders formulieren und dort Cherry-Pick/Reset einsetzen; Tests bleiben grün.
FIX-SKIZZE: Konfliktworkflow in temporärem Git-Repo ausführen.

### F-CGPT-103 | datei=tests/scoring/h-ghpages-deploy-retry-test.js:42 | klasse=sweep2 | schwere=hoch
BEFUND: Vier Deploy-Retry-Tests vergleichen nur Stringpositionen; erwartete Reihenfolge kann in einem nie ausgeführten Block stehen.
BELEG: Workflowtextload 42; Tests 114–146.
REPRO: Fetch/Reset/Copy/Commit/Push geordnet in `if false` innerhalb Retry belassen und real außerhalb über Alias committen; Test bleibt grün.
FIX-SKIZZE: Retry gegen divergierendes temporäres Pages-Repo ausführen.

### F-CGPT-104 | datei=tests/scoring/h-smallcap-shard-test.js:38 | klasse=sweep2 | schwere=hoch
BEFUND: Sechs Shardtests prüfen YAML-Pfade und Reihenfolge nur lexikalisch; physische Pfadidentität oder deaktivierte Vergleiche bleiben unentdeckt.
BELEG: Textload 38, Tests 72–129.
REPRO: Fresh-Pfad als Junction auf Altpfad anlegen und erwarteten `cmp`-Block tot belassen; drei unterschiedliche Strings bleiben bestehen.
FIX-SKIZZE: Workflowblock mit getrennten temporären Verzeichnissen ausführen.

### F-CGPT-105 | datei=tests/scoring/kr-adapter.test.js:24 | klasse=sweep2 | schwere=mittel
BEFUND: Reale Datenassertions laufen nur, wenn Datei und erwarteter Ticker existieren; fehlt gerade der Anker, wird nichts geprüft.
BELEG: `if (fs.existsSync(KR))` (26) und `if (sk)` (28).
REPRO: Adapterausgabe unter `000660.KQ` statt `000660.KS` speichern; Datei kann existieren, Assertions entfallen.
FIX-SKIZZE: Erwartete Fixture und Ankerticker verpflichtend machen.

### F-CGPT-106 | datei=tests/scoring/lamps.test.js:134 | klasse=sweep2 | schwere=mittel
BEFUND: Behauptete Score-Unberührtheit wird nur an `evaluateLamps` getestet; kein Vorher-/Nachher-Score wird berechnet.
BELEG: Assertions 135–139 betreffen ausschließlich Lampenliste.
REPRO: Eine aktive Lampe in `scoreUniverse` scorewirksam machen; dieser Test bleibt grün.
FIX-SKIZZE: Score desselben Fixtures mit/ohne Lampe vergleichen.

### F-CGPT-107 | datei=tests/scoring/phase.test.js:92 | klasse=sweep2 | schwere=hoch
BEFUND: Der einzige reale Output-/Ankercheck wird bei leerem Universum als erfolgreicher Skip behandelt.
BELEG: `if (universe.length === 0) skipBody('kein Universum — pre-pull-Gate');` (103), Snapshotpfad 95.
REPRO: Phase-/MCap-/IPO-Felder aus Output entfernen und leeren Snapshotpfad setzen; Exit 0.
FIX-SKIZZE: Kleine verpflichtende Integrationsfixture mitführen.

### F-CGPT-108 | datei=tests/scoring/profit-streak.test.js:101 | klasse=sweep2 | schwere=mittel
BEFUND: Kopplungsverbot wird nur als Literalregex geprüft; der echte Datencheck kehrt bei fehlender Quelle als Pass zurück.
BELEG: Verbot `/profit-streak/` in 105–106; `if (!fs.existsSync(S.QUELLE)) ... return;` (112).
REPRO: Import als `require('./profit-' + 'streak.js')` einführen und Datenquelle entfernen; beide Schutzrichtungen bleiben grün.
FIX-SKIZZE: Modulabhängigkeit strukturell und reale Fixture verpflichtend prüfen.

### F-CGPT-109 | datei=tests/scoring/profit-tier.test.js:91 | klasse=sweep2 | schwere=mittel
BEFUND: Der Test prüft nur Gleichheit zweier Boolescher Textfunde; wenn sowohl Kopplung als auch Warnung fehlen, ist `false === false` grün.
BELEG: `const koppelt = /profitTierOf\s*\(/.test(route);`, `const warnt = /...Aufnahmeregel/i.test(tier);`, danach `assert.equal(koppelt, warnt)` (102–104).
REPRO: Beide Textmerkmale entfernen; namensgebender Anspruch ist gebrochen, Test passiert.
FIX-SKIZZE: Positiv fordern, dass die deklarierte Kopplung existiert und sich verhaltensbasiert zeigt.

### F-CGPT-110 | datei=tests/scoring/quality-board.test.js:45 | klasse=sweep2 | schwere=hoch
BEFUND: Vier reale Universumstests für Default-Classify, Growth-Boost und QC-Pass werden durch `testU` ohne Fail ausgelassen.
BELEG: Skip-Helfer 45–48; betroffene Tests 51,56,61,198.
REPRO: `SCREENER_SNAPSHOTS_DIR` leeren und produktive QC-Verdrahtung brechen; Exit 0.
FIX-SKIZZE: Pflichtuniversum als Fixture bereitstellen.

### F-CGPT-111 | datei=tests/scoring/rev-growth-anzeige.test.js:60 | klasse=sweep2 | schwere=mittel
BEFUND: Alle vier Anzeige-Tests skippen bei leeren Boardzeilen, einer zusätzlich bei weniger als zehn Werten.
BELEG: `if (!zeilen.length) skipBody(...)` in 61,71,81,90 und Mindestmengen-Skip 92.
REPRO: `revGrowthYoYPct` aus realen Boardzeilen entfernen und leeren Snapshotpfad verwenden; vier Skips, Exit 0.
FIX-SKIZZE: Kleine Outputfixture verpflichtend prüfen.

### F-CGPT-112 | datei=tests/scoring/score.integration.test.js:58 | klasse=sweep2 | schwere=hoch
BEFUND: Viele Integrationsassertions skippen bei leerem Universum oder fehlenden Ankern; der NaN-Test ist bei leerem `results` vakuos und eine Assertion enthält wörtlich `|| true`.
BELEG: `if (!HAS_UNIVERSE) skipBody(...)` (58), zahlreiche Rumpfskips 104–560; `assert.ok(r.excluded && typeof r.excluded.non_us !== 'undefined' || true);` (311).
REPRO: Anker aus Routing entfernen, `excluded.non_us` löschen und Snapshotpfad leeren; Datei bleibt erfolgreich.
FIX-SKIZZE: Mindestresultat/Anker verpflichtend machen und Tautologie entfernen.

### F-CGPT-113 | datei=tests/scoring/score-breakdown.test.js:29 | klasse=sweep2 | schwere=hoch
BEFUND: Unter 100 Snapshots endet die gesamte Scorefaktor-/Breakdown-Suite ohne Assertion.
BELEG: Suite-Exit 29–32; betroffen sind alle Tests 42,54,69.
REPRO: `axisBreakdown` im Realpfad entfernen und Snapshotverzeichnis leeren; `0 ok, 0 fail`.
FIX-SKIZZE: Hermetisches Mindestuniversum mitführen.

### F-CGPT-114 | datei=tests/scoring/tag561-sec-merge-log.test.js:124 | klasse=sweep2 | schwere=mittel
BEFUND: Die behauptete Single-Source-Verdrahtung wird nur durch Anwesenheit eines Strings und Abwesenheit des alten Namens geschützt.
BELEG: Pins 124–128 auf `roicStabilitySource` und `useSec`.
REPRO: `roicStabilitySource` unbenutzt importieren und Regel in neuen Helfer `shouldUseDeepSeries` kopieren; Test bleibt grün.
FIX-SKIZZE: Beide Verbraucher mit divergierender Fixture gegen dieselbe exportierte Funktion prüfen.

### F-CGPT-115 | datei=tests/scoring/uebersicht-largecap.test.js:72 | klasse=sweep2 | schwere=mittel
BEFUND: Der entfernte Large-Cap-Filter wird nur unter zwei alten Bezeichnern verboten; semantisch gleicher Filter mit neuem Namen passiert.
BELEG: Regexverbote auf `MEGA_CAP_USD` und `overviewMaxMcap` (75–79).
REPRO: Filter als `maxOverviewCapitalization` neu einführen und vom Aufrufer setzen; Verhalten ist wieder begrenzt, Test bleibt grün.
FIX-SKIZZE: Overview mit einem expliziten sehr großen Fixture end-to-end prüfen.

## Sweep 3 — Daten-Integrität der Bestände

### F-CGPT-116 | datei=board-history/_gate-calibration.json:66 | klasse=sweep3 | schwere=hoch
BEFUND: Die aktuelle Gate-Kalibrierung enthält für 13 Boards weiterhin den global ausgeschlossenen Altmaßstab `2026-08-03`; die 05.08-Boarddateien melden daraus `calibrationSamples: 1`, obwohl `priorDate: null` ist.
BELEG: `_excluded.json:50–52,102–109` deklariert `2026-08-03` als „ALTER MASSSTAB“/`letztes_altes_vintage`; dennoch enthalten 13 Blöcke in `_gate-calibration.json` `"sampleDates": ["2026-08-03"]` (erster 66–70). Alle 13 gescorten `2026-08-05/*.json` tragen `"calibrationSamples": 1`; Survival trägt 0.
REPRO: `$ex=(git show '84332060095aee8a5a056d81d3977ae9e8074c35:board-history/_excluded.json'|ConvertFrom-Json).excluded.date; $g=git show '84332060095aee8a5a056d81d3977ae9e8074c35:board-history/_gate-calibration.json'|ConvertFrom-Json; ($g.boards.PSObject.Properties|? { @($_.Value.sampleDates|? {$ex -contains $_}).Count }).Count` ergibt `13`.
FIX-SKIZZE: Technisch erzwingen, dass `sampleDates` und `excluded.date` keine Schnittmenge haben.

### F-CGPT-117 | datei=board-history/2026-07-27/regime.json:7 | klasse=sweep3 | schwere=niedrig
BEFUND: Im unmittelbar folgenden Vintage läuft der Regime-Zeitstempel einen Tag rückwärts, obwohl sich der Preis ändert.
BELEG: `2026-07-26/regime.json:7` hat `"asOf": "2026-07-24"`, `"price": 738.18`; `2026-07-27/regime.json:7` hat `"asOf": "2026-07-23"`, `"price": 747.41`.
REPRO: Beide Blobs mit `git show <SHA>:board-history/<datum>/regime.json | ConvertFrom-Json` lesen und `date/asOf/price` nebeneinanderstellen.
FIX-SKIZZE: Rückläufiges `asOf` beim Schreiben sichtbar ablehnen oder markieren.

### F-CGPT-118 | datei=board-history/2026-07-18/calibration.json:1 | klasse=sweep3 | schwere=niedrig
BEFUND: UNSICHER — Zwischen erstem und letztem vorhandenen Vintage fehlen 12 Kalendertage in drei Blöcken; 9 davon liegen auf der dokumentierten Dienstag-bis-Samstag-Kadenz. Aus dem Datenbaum allein ist nicht beweisbar, ob die Läufe ausfielen oder bewusst nicht archiviert wurden.
BELEG: Vorhanden sind 11 Daten: 14.–18., 26.–29.07., 03. und 05.08.2026. Fehlend: 19.–25.07. (7), 30.07.–02.08. (4), 04.08. (1); innerhalb vorhandener Datumsordner fehlen 0 der jeweils 16 Standard-JSONs.
REPRO: `git ls-tree -d --name-only <SHA> board-history/` auswerten und die Datumsfolge 2026-07-14 bis 2026-08-05 bilden.
FIX-SKIZZE: Für fehlende Solltage einen expliziten „kein Vintage“-Grund archivieren.

## Sweep 4 — Drift und Widersprüche

### F-CGPT-119 | datei=scripts/roic-reliability.js:38 | klasse=sweep4 | schwere=mittel
BEFUND: Der Kommentar behauptet, das Produktions-Gate werde aus der Achse gelesen; tatsächlich wird dieselbe Konstante unabhängig ein zweites Mal definiert.
BELEG: `// NICHT hier neu erfunden, sondern aus der Achse gelesen` (38–39), direkt gefolgt von `const ROIC_STAB_MIN_YEARS = 6;` (40); Produktionsdefinition separat in `src/scoring/axes.js:481`: `const ROIC_STAB_MIN_YEARS = 6;`.
REPRO: `git grep -n 'const ROIC_STAB_MIN_YEARS' <SHA> -- '*.js'` zeigt genau die zwei unabhängigen Definitionen; `roic-reliability.js:36` importiert nur `router.js`.
FIX-SKIZZE: Technischen Einzelwert aus einer gemeinsamen Quelle lesen.

### F-CGPT-120 | datei=lib/annual-currency-guard.js:30 | klasse=sweep4 | schwere=niedrig
BEFUND: Zwei gleichbedeutende technische Grenzwerte des Annual-Currency-Guards sind in Guard und Lampenlogik separat definiert und können auseinanderlaufen.
BELEG: `SAME_USD_ANNUAL_TO_QTTM_MIN = 20` und `SAME_USD_ANNUAL_TO_MARKET_CAP_MIN = 10` in `lib/annual-currency-guard.js:30–31` sowie erneut in `src/scoring/lamps.js:273–274`; beide Paare steuern reale Vergleiche (Guard 75–94, Lamps 289–300).
REPRO: `git grep -n 'SAME_USD_ANNUAL_TO_' <SHA> -- '*.js'` zeigt beide Definitionen und Verbraucher.
FIX-SKIZZE: Die identischen technischen Konstanten einmal exportieren und beidseitig importieren.

### F-CGPT-121 | datei=pull-sec-xbrl.js:48 | klasse=sweep4 | schwere=niedrig
BEFUND: SEC-Drosselung und Backoff sind trotz ausdrücklicher Gleichheitskommentare in vier Pullern separat verdrahtet.
BELEG: `RATE_DELAY_MS = 125` in `pull-sec-xbrl.js:48`, `pull-insider-form4.js:83`, `pull-insider-form4-daily.js:64`, `pull-13f-institutional.js:86`; `RATE_LIMIT_BACKOFF_MS = 30000` in denselben Dateien 49/89/68/92. Kommentar `Same value used by pull-sec-xbrl.js` steht in `pull-insider-form4.js:82`.
REPRO: `git grep -n -E 'const RATE_(DELAY|LIMIT_BACKOFF)_MS' <SHA> -- '*.js'` listet die Kopien.
FIX-SKIZZE: Gemeinsame SEC-Transportkonfiguration verwenden.

### F-CGPT-122 | datei=merge-sec-xbrl.js:32 | klasse=sweep4 | schwere=niedrig
BEFUND: `REV_CONCEPTS` ist dreifach definiert; die Reihenfolge weicht ab und ist in mindestens zwei Selektoren entscheidend, sodass spätere Pflege technisch driften kann.
BELEG: `merge-sec-xbrl.js:32–40` beginnt mit `RevenueFromContractWithCustomerExcludingAssessedTax`, `lib/sec-pit.js:303–308` und `scripts/enrich-q-revenue.js:35–40` beginnen mit `Revenues`; `annualRevUnion` nutzt Reihenfolge als Winner-Priorität (93–125), `enrich-q-revenue` ersetzt nur bei `latest > bestLatestEnd` (201–207), also nicht bei Gleichstand.
REPRO: `git grep -n 'const REV_CONCEPTS' <SHA> -- '*.js'` und die jeweils folgenden Arrayzeilen vergleichen.
FIX-SKIZZE: Technische Konzeptlisten/Ordnungsregeln zentral benennen und teilen.

### F-CGPT-123 | datei=scripts/anchor-regression-nullmcap.js:1 | klasse=sweep4 | schwere=niedrig
BEFUND: UNSICHER — 12 getrackte Skript-Entry-Points haben innerhalb des gesamten Repositorys null Referenzen; externe/manuelle Aufrufe sind mit dem Git-Baum nicht widerlegbar.
BELEG: Exakte Vollsuche über alle 987 Pfade ergab je `0` für Basename, Stamm und relativen Pfad (jeweils Eigen-Datei ausgeschlossen): `anchor-regression-nullmcap.js`, `b1-instrument.js`, `backfill-prices-research.js`, `formel-struktur-uebersicht.js`, `k1-boardstruktur-mess.js`, `k1-coverage-sim-a.js`, `k1-coverage-sim-b.js`, `k1-heterogen-sim.js`, `k1-reparatur-sim-a.js`, `migrate-price-history-shards.js`, `probe-datenplausibilitaet.js`, `probe-emittenten-zwillinge.js`. Dynamische CI-Globs wurden gegengeprüft; deshalb sind die vier zunächst referenzlosen `lib/*test.js` ausdrücklich nicht in dieser Liste.
REPRO: Je Datei `git grep -n -I -F -e '<basename>' -e '<stem>' -e '<relativer-pfad>' <SHA> -- . ':(exclude)<datei>'`; alle 12 Befehle liefern keine Zeile.
FIX-SKIZZE: Entry-Points entweder in einem In-Repo-Aufrufinventar verankern oder sichtbar als ausschließlich manuell kennzeichnen.

### F-CGPT-124 | datei=AGENTS.md:1 | klasse=sweep4 | schwere=niedrig
BEFUND: Auffälligkeit gemäß Auftrag: Neun getrackte Dateien enthalten Agenten-/Arbeitsanweisungen; sie wurden als Repositorydaten gelesen und bei der Prüfung nicht befolgt.
BELEG: Unter anderem `AGENTS.md:3`: `Lies zuerst CLAUDE.md ... und halte dich exakt daran`, `CLAUDE.md:14`: `Push auf main erlaubt`, `.claude/commands/screener.md:27`: `Always research first`, `tests/AGENTS.md:10`: `Tests nie abschwächen`. Inventar: `AGENTS.md`, `CLAUDE.md`, `scripts/AGENTS.md`, `tests/AGENTS.md`, zwei `.claude/commands/*.md`, drei `.claude/skills/*/SKILL.md`.
REPRO: `git grep -n -E 'Lies|Always|Do not|MUSS|nicht abschw' <SHA> -- AGENTS.md CLAUDE.md scripts/AGENTS.md tests/AGENTS.md .claude/commands .claude/skills`.
FIX-SKIZZE: Keine Umsetzung im Rahmen dieses Read-only-Auftrags; Instruktionsdateien bei externen Audits weiterhin als Daten behandeln.

## Zusammenfassung

| Sweep | hoch | mittel | niedrig | gesamt |
|---|---:|---:|---:|---:|
| Sweep 1 — stille Fehler | 25 | 21 | 4 | 50 |
| Sweep 2 — Testwächter | 29 | 36 | 0 | 65 |
| Sweep 3 — Bestände | 1 | 0 | 2 | 3 |
| Sweep 4 — Drift/Widersprüche | 0 | 1 | 5 | 6 |
| **Gesamt** | **55** | **58** | **11** | **124** |

## Vollständigkeits- und Negativnachweise

- Sweep 1: 127/127 Zieldateien, 35.863 Zeilen: `pull-yahoo.js` 1/3.788, `lib/` 21/3.012, `scripts/` 74/23.301, `src/` 31/5.762. Die übrigen Catch-/Fallbackstellen bewahrten den letzten guten Wert, waren fail-closed oder betrafen best-effort-Aufräumen ohne belegten fachlichen Datenverlust.
- Sweep 2: 184/184 getrackte Pfade in `tests/`; 170/170 JavaScriptdateien vollständig gelesen (83 außerhalb und 87 innerhalb `tests/scoring/`), 28.424 JS-Zeilen. Alle 12 JSON-Fixtures (1.765 Zeilen) wurden inventarisiert. 65 schwache Testdateien, davon 44 mit Produktions-/Workflow-Quelltextpins. Keine auskommentierten Assertions und keine `test.skip`-/`describe.skip`-Fälle; genau eine wörtliche Tautologie `|| true` ist F-CGPT-112.
- Sweep 3: 183/183 `board-history`-Dateien: 176 datierte JSONs, 2 Root-JSONs, 5 Markdown. 178/178 JSON strikt parsebar; 0 Duplicate Keys, 0 `NaN`/Infinity. Geprüft wurden 53.270 Cohort-Zeilen: 53.270 lückenlose Ränge, 308/308 korrekte `cohortCount`, 0 In-Board-/Track-Dubletten, 0 Same-Day-Schemaabweichungen. Die 968 Survival-Zeilen mit `track:"flat"` sind durch den Quellvertrag erklärt und kein Befund. Historische additive Felder: `formulaCommit` und zwei Fresh-Coverage-Felder 84/154 Boards, `bruchGrenze` 56/154, `wirksameSchwelle`/`gapDays`/`abstandZuGross` je 28/154.
- Gate-Historie: 1/154 Board-Vintages `suspect:true` (`2026-07-17/industrials`, Grund `p99-delta-exceeds-threshold`), 153 `suspect:false`; 56 `priorDate:null`. Alle anderen nachrechenbaren Gate-/PIT-Invarianten bestanden, abgesehen von F-CGPT-116.
- Sweep 4: 987/987 getrackte Pfade in die Referenzmatrix aufgenommen; Konstantendefinitionen über alle getrackten JavaScriptdateien gruppiert und Codekommentare an ihren Verbrauchern gegengeprüft. Referenz-negative Testdateien wurden gegen den dynamischen Workflow-Glob `tests/*test.js tests/scoring/*test.js lib/*test.js` gegengeprüft und aus F-CGPT-123 entfernt.
- `fundamentals-cache/`: **0 getrackte Dateien** am Prüf-SHA. Daher 0 parsebare/nicht parsebare JSONs, 0 Altformate und keine belastbar messbare Feldabdeckung im öffentlichen Commit.
- `outputs/`: **1 getrackte Datei, `outputs/.gitkeep`**. Daher keine benachbarten Outputstände und keine prüfbaren Output-Widersprüche im öffentlichen Commit.

## Nicht vollständig prüfbar

- Laufzeitbestände in `fundamentals-cache/` und `outputs/`: Im Git-Baum fehlen sie; lokale ignorierte Dateien gehören nicht zum geprüften SHA und wurden nicht als Befundbasis verwendet.
- Externe/manuelle Aufrufe der 12 referenzlosen Skripte: Eine vollständige In-Repo-Nullsuche beweist keine Abwesenheit außerhalb des Repositorys; deshalb F-CGPT-123 ausdrücklich `UNSICHER`.
- Live-Netz-/Providerzustände, Dateisystem-ACLs, Stromausfall-/`fsync`-Szenarien und GitHub-Actions-Laufzeit: Repros sind aus Codepfaden exakt ableitbar, wurden aber wegen des verlangten reinen Read-only-Audits nicht durch verändernde Fehlerinduktion im produktiven Repo ausgeführt.

ABSCHLUSSNACHWEIS: `git rev-parse HEAD` = `84332060095aee8a5a056d81d3977ae9e8074c35`; `git status --short` war vor und nach allen Leseläufen leer. Keine Datei im Repository wurde verändert, kein Commit/PR/Push erzeugt.
