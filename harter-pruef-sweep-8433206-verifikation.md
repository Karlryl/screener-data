# Harter Prüf-Sweep 8433206 — Selbst-Widerlegung und zulässige Fixes

**Prüf-SHA: `84332060095aee8a5a056d81d3977ae9e8074c35`**

Alle Widerlegungsversuche ankern an diesem unveränderten Stand. Temporäre Mutationen wurden nach jedem Versuch zurückgenommen; die getrennten Prüf-Worktrees endeten auf dem Prüf-SHA mit leerem `git diff` und leerem `git status --short`.

### F-CGPT-001 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 1` mit fehlender FX-Datei und EUR-Snapshot; geprüft wurden Umrechnungsflag, Kursquelle und äußerer Exitcode.
AUSGABE:
```text
F-CGPT-001 fxConverted=true rate=1.08 source=hardcoded-fallback exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der produktive Fallback erzeugt trotz fehlender FX-Quelle einen als umgerechnet markierten Snapshot und lässt den Prozess grün.
MINIMALFIX:
```diff
--- a/pull-yahoo.js
+++ b/pull-yahoo.js
@@
-  return FALLBACK_FX[currency];
+  throw new Error(`FX source unavailable for ${currency}`);
```

### F-CGPT-002 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 2` mit HK-Ticker, Quote ohne `currency` und bestehendem USD-Reporting-Snapshot.
AUSGABE:
```text
F-CGPT-002 status=price-only rawPrice=100 storedPrice=100 priceCurrency=USD quoteCurrency=missing exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der unveränderte Rohpreis wird bei fehlender Handelswährung als USD gespeichert und als erfolgreicher Price-only-Lauf gemeldet.
MINIMALFIX:
```diff
--- a/pull-yahoo.js
+++ b/pull-yahoo.js
@@
-  const tradingFactor = (fxApplied !== 1 && origCcy !== 'USD') ? fxApplied : 1;
+  if (!q.currency) throw new Error('quote.currency missing');
+  const tradingFactor = q.currency === 'USD' ? 1 : fxApplied;
```

### F-CGPT-003 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 3` mit wahrheitswerter Quote `{currency:'USD'}` ohne Preis und Marktkapitalisierung.
AUSGABE:
```text
F-CGPT-003 status=price-only price=undefined mcap=undefined mode=price-only substantiveChanged=true exit=0
PROCESS_EXIT=0
```
SCHLUSS: Eine Quote ohne beide Nutzwerte erreicht den Erfolgsstatus `price-only` und schreibt den Snapshot neu.
MINIMALFIX:
```diff
--- a/pull-yahoo.js
+++ b/pull-yahoo.js
@@
-  if (!q) throw new Error('empty quote');
+  if (!q || (!Number.isFinite(q.regularMarketPrice) && !Number.isFinite(q.marketCap)))
+    throw new Error('quote has neither price nor market cap');
```

### F-CGPT-004 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 4` mit erzwungenem `EACCES` beim Löschen eines wegen zu kleiner Marktkapitalisierung ausgeschlossenen Snapshots.
AUSGABE:
```text
F-CGPT-004 status=skipped-mcap n_failed=0 staleFileExists=true exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der Ausschluss gilt als erfolgreich, obwohl die fachlich ausgeschlossene Datei weiter existiert und kein Fehler gezählt wird.
MINIMALFIX:
```diff
--- a/pull-yahoo.js
+++ b/pull-yahoo.js
@@
-  try { fs.unlinkSync(snapshotPath); } catch (e) {}
+  try { fs.unlinkSync(snapshotPath); }
+  catch (e) { return { status: 'failed-delete', error: e.message }; }
```

### F-CGPT-005 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 5` mit altem Manifest, erzwungenem Löschfehler und anschließendem Watchlist-Parseabbruch vor dem ersten Checkpoint.
AUSGABE:
```text
F-CGPT-005 log=[2026-08-05T13:42:27.055Z] [WARN] Could not delete stale _manifest.json: manifest locked manifest={"n_ok":999,"partial":false} exit=1
PROCESS_EXIT=0
```
SCHLUSS: Der Pull selbst bricht zwar ab, aber das alte kanonische Erfolgsmanifest bleibt unverändert sichtbar.
MINIMALFIX:
```diff
--- a/pull-yahoo.js
+++ b/pull-yahoo.js
@@
-  catch (e) { log('WARN', `Could not delete stale _manifest.json: ${e.message}`); }
+  catch (e) { throw new Error(`cannot invalidate stale manifest: ${e.message}`); }
```

### F-CGPT-006 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 6` mit vollständig fehlendem Tages-/Boardbestand.
AUSGABE:
```text
F-CGPT-006 alerts=0 dataGaps=0 lowNGroups=0 line=E1-Kompression 2026-08-05 — 0 Alarm(e) · Eigenhistorie Tag 0 exit=0
PROCESS_EXIT=0
```
SCHLUSS: Eine komplett fehlende Pflichtdatenlage wird als Bericht mit null Alarmen und null Datenlücken ausgegeben.
MINIMALFIX:
```diff
--- a/lib/e1-compression.js
+++ b/lib/e1-compression.js
@@
-  if (!fs.existsSync(dayDir)) return [];
+  if (!fs.existsSync(dayDir)) throw new Error(`missing E1 vintage directory: ${dayDir}`);
```

### F-CGPT-007 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 7` mit vorhandener, syntaktisch korrupter E1-Zustandsdatei.
AUSGABE:
```text
F-CGPT-007 tickers=0 eigenHistorieStartDate=null corruptReplaced=true alerts=0 exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der korrupte Zustand wird ohne Fehler als Neuanlage ersetzt; Historie und Tickerzustände gehen verloren.
MINIMALFIX:
```diff
--- a/lib/e1-compression.js
+++ b/lib/e1-compression.js
@@
-  } catch (_) { return newState(); }
+  } catch (e) {
+    if (e.code === 'ENOENT') return newState();
+    throw e;
+  }
```

### F-CGPT-008 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 8` mit korruptem `_meta.json` und nur einem verbliebenen History-Shard.
AUSGABE:
```text
F-CGPT-008 keys=A count=1 missingShardsAccepted=true exit=0
PROCESS_EXIT=0
```
SCHLUSS: Die korrupte Meta-Datei deaktiviert die Shard-Vollständigkeitskontrolle und der kleinere Store wird erfolgreich geladen.
MINIMALFIX:
```diff
--- a/lib/price-history-store.js
+++ b/lib/price-history-store.js
@@
-  try { return JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) { return null; }
+  try { return JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
+  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
```

### F-CGPT-009 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 9` mit ungültigem `fundamentalsAsOf` und sehr altem `fetchedAt`.
AUSGABE:
```text
F-CGPT-009 status=price-only n_ok=1 n_failed=0 fetchedAtOld=2000-01-01T00:00:00.000Z exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der wahrheitswerte, aber nicht parsebare Datumsstring blockiert den Alt-Datum-Fallback und lässt den Ticker gesund erscheinen.
MINIMALFIX:
```diff
--- a/pull-yahoo.js
+++ b/pull-yahoo.js
@@
-  const lastFull = meta.fundamentalsAsOf || meta.fetchedAt;
+  const f = Date.parse(meta.fundamentalsAsOf);
+  const lastFull = Number.isFinite(f) ? meta.fundamentalsAsOf : meta.fetchedAt;
```

### F-CGPT-010 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 10` mit korruptem Earnings-Kalender und einem ansonsten Price-only-fähigen Snapshot.
AUSGABE:
```text
F-CGPT-010 log=[2026-08-05T13:42:27.367Z] [WARN] earnings-calendar.json not loaded (Expected property name or '}' in JSON at position 1 (line 1 column 2)) — earnings-forced fulls disabled this run status=price-only n_failed=0 exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der Kalenderausfall deaktiviert erzwungene Vollabrufe, ohne den Ticker- oder Laufstatus zu degradieren.
MINIMALFIX:
```diff
--- a/pull-yahoo.js
+++ b/pull-yahoo.js
@@
-  catch (e) { log('WARN', message); return {}; }
+  catch (e) { throw new Error(`earnings calendar unavailable: ${e.message}`); }
```

### F-CGPT-011 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 11` mit gezielt fehlschlagendem annual-financials-FTS-Unterabruf.
AUSGABE:
```text
F-CGPT-011 status=ok n_failed=0 ftsPartial=true warning=[2026-08-05T13:42:27.444Z] [WARN]   fundamentalsTimeSeries annual financials failed for FTS: forced FTS failure exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der Snapshot trägt zwar `_ftsPartial`, wird im Manifest aber als `ok` und nicht als Fehler gezählt.
MINIMALFIX:
```diff
--- a/pull-yahoo.js
+++ b/pull-yahoo.js
@@
-  return { status: 'ok', ticker };
+  return { status: snapshot._ftsPartial ? 'partial' : 'ok', ticker };
```

### F-CGPT-012 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 12` mit erzwungenem Fehler beim inkrementellen Manifest-Write.
AUSGABE:
```text
F-CGPT-012 return=undefined manifestExists=false warning=[2026-08-05T13:42:27.519Z] [WARN] Incremental manifest write failed: checkpoint denied exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der Checkpointfehler wird nur gewarnt; es entsteht weder Manifest noch maschinenlesbarer Fehlerstatus.
MINIMALFIX:
```diff
--- a/pull-yahoo.js
+++ b/pull-yahoo.js
@@
-  catch (e) { log('WARN', `Incremental manifest write failed: ${e.message}`); }
+  catch (e) { manifestErrors.push(e.message); throw e; }
```

### F-CGPT-013 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 13` mit einem `factsForCik`-Store, der für den einzigen bekannten CIK wirft.
AUSGABE:
```text
F-CGPT-013 records=0 ciksTotal=1 ciksParsed=0 errorCounter=undefined exit=0
PROCESS_EXIT=0
```
SCHLUSS: Die Store-Ausnahme verschwindet als leere Faktenliste; es gibt weder Record noch Fehlerzähler.
MINIMALFIX:
```diff
--- a/lib/b1-detect.js
+++ b/lib/b1-detect.js
@@
-  catch (_) { return []; }
+  catch (e) { counters.errors++; counters.failedCiks.push(cik); return []; }
```

### F-CGPT-014 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 14` mit `writeJsonAtomic({x:NaN,y:Infinity})` ohne Opt-in-Prüfung.
AUSGABE:
```text
F-CGPT-014 file={"x":null,"y":null} exit=0
PROCESS_EXIT=0
```
SCHLUSS: Nicht-endliche Zahlen werden still zu `null` serialisiert und der atomare Write meldet Erfolg.
MINIMALFIX:
```diff
--- a/lib/atomic-write.js
+++ b/lib/atomic-write.js
@@
-  if (opts.assertFinite) assertFiniteNumbers(value);
+  if (opts.assertFinite !== false) assertFiniteNumbers(value);
```

### F-CGPT-015 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 15` mit erzwungenem Verzeichnis-`fsync`-Fehler nach erfolgreichem Rename.
AUSGABE:
```text
F-CGPT-015 file={"ok":true} warning=[atomic-write] dir-fsync failed for C:\Users\Anwender\AppData\Local\Temp\cgpt-s1-015-HbwAdU: dir fsync denied (data is durable, rename metadata may not be — investigate filesystem) returned=success exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der Durability-Schritt scheitert, trotzdem kehrt die API ohne Fehler oder degradiertes Ergebnis zurück.
MINIMALFIX:
```diff
--- a/lib/atomic-write.js
+++ b/lib/atomic-write.js
@@
-  catch (e) { console.warn(`[atomic-write] dir-fsync failed for ${dir}: ${e.message}`); }
+  catch (e) { throw new Error(`dir-fsync failed for ${dir}: ${e.message}`); }
```

### F-CGPT-016 | verdikt=BESTAETIGT | schwere_neu=niedrig
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 16` mit gezielt fehlschlagender IPO-Quote-Prüfung während eines sonst erfolgreichen Vollpulls.
AUSGABE:
```text
F-CGPT-016 status=ok n_failed=0 snapshotHasIpoError=false warning=IPO-DATE-FETCH: IPO forced IPO quote failure exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der IPO-Prüfausfall bleibt reiner Warntext; Snapshot und Manifest enthalten kein maschinenlesbares Fehlermerkmal.
MINIMALFIX:
```diff
--- a/pull-yahoo.js
+++ b/pull-yahoo.js
@@
-  catch (e) { console.warn('IPO-DATE-FETCH:', ticker, e.message); }
+  catch (e) { snapshot.meta.ipoDateFetchError = e.message; partialErrors.push('ipo-date'); }
```

### F-CGPT-017 | verdikt=BESTAETIGT | schwere_neu=niedrig
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 17` mit einem Not-found-Ticker und erzwungenem Schreibfehler nur für dessen Zustandsupdate; zusätzlich drei erfolgreiche Ticker, damit der Top-Level-Lauf grün bleibt.
AUSGABE:
```text
F-CGPT-017 n_ok=3 n_failed=1 topLevelExit=0 notFoundStreak=undefined warning=[2026-08-05T13:42:27.841Z] [WARN]   Could not update delisted flag for NF: state write denied failures=[{"ticker":"NF","error":"Quote not found","errClass":"not-found"}]
PROCESS_EXIT=0
```
SCHLUSS: Der State-Write-Fehler löscht den Not-found-Streak aus der Persistenz, beeinflusst den äußeren Exitcode aber nicht.
MINIMALFIX:
```diff
--- a/pull-yahoo.js
+++ b/pull-yahoo.js
@@
-  catch (e) { log('WARN', `Could not update delisted flag for ${ticker}: ${e.message}`); }
+  catch (e) { failures.push({ ticker, error: e.message, errClass: 'state-write' }); process.exitCode = 1; }
```

### F-CGPT-018 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 18` erzeugte 21 gleich große Original-/Backup-Dateien, änderte ausschließlich die nicht gesampelte `f20.json` längengleich und startete das echte PowerShell-Restore-Skript.
AUSGABE:
```text
F-CGPT-018 mutated=f20.json sameLength=true output=== Restore-Test prices-max == | Original: 21 Dateien, 84 Bytes | Backup:   21 Dateien, 84 Bytes | GRUEN: Datei-Anzahl, Gesamt-Bytes und Stichproben-SHA256 identisch. Backup ist echt. exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der echte Restore-Test erklärt einen nachweislich abweichenden Backupbestand grün, weil die manipulierte Datei nicht in den 20 Stichproben liegt.
MINIMALFIX:
```diff
--- a/scripts/restore-test-prices-max.ps1
+++ b/scripts/restore-test-prices-max.ps1
@@
-    Sample = ($files | ... | Select-Object -Index (...) | ForEach-Object { (Get-FileHash $_.FullName).Hash }) -join ''
+    Sample = ($files | Sort-Object FullName | ForEach-Object { "$($_.FullName.Substring($dir.Length)):$($_.Length):$((Get-FileHash $_.FullName -Algorithm SHA256).Hash)" }) -join ''
```

### F-CGPT-019 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 19` führte den echten `run()`-Pfad mit zwei ZIP-Range-Blöcken aus; der erste warf, der zweite lieferte Ticker B, während OUT vorher Ticker OLD enthielt.
AUSGABE:
```text
F-CGPT-019 oldTickerPreserved=false rows=B log=fertig: 1 Zeilen -> C:\Users\Anwender\AppData\Local\Temp\cgpt-s1-019-T3bguZ\external-data\sec-annual-bulk.jsonl (0.0 MB) | unlesbar: 1 exit=0
PROCESS_EXIT=0
```
SCHLUSS: Trotz `unlesbar: 1` ersetzt die unvollständige Temp-Datei den Altbestand und der Prozess endet grün.
MINIMALFIX:
```diff
--- a/scripts/fetch-secbulk.js
+++ b/scripts/fetch-secbulk.js
@@
   await new Promise((res) => strom.end(res));
+  if (kaputt > 0) { fs.unlinkSync(OUT + '.tmp'); throw new Error(`${kaputt} SEC entries unreadable`); }
   fs.renameSync(OUT + '.tmp', OUT);
```

### F-CGPT-020 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 20` startete `build-secannual.run()` mit korruptem OUT und genau einem erfolgreichen SEC-Kandidaten A aus dem Cache.
AUSGABE:
```text
F-CGPT-020 corruptPrior=true keys=A oldNamesRetained=false log=secAnnual: 1 Namen (0->1, +1 akkumuliert) -> C:\Users\Anwender\AppData\Local\Temp\cgpt-s1-020-OmkiAf\external-data\sec-secannual.json (0KB) | pulled=0 cached=1 noCik=0 404=0 divergent=0 exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der vorhandene korrupte Akkustore wird als leere Merge-Basis behandelt und durch den aktuellen Ein-Namen-Teilbestand ersetzt.
MINIMALFIX:
```diff
--- a/scripts/build-secannual.js
+++ b/scripts/build-secannual.js
@@
-  try { out = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) { out = {}; }
+  try { out = JSON.parse(fs.readFileSync(OUT, 'utf8')); }
+  catch (e) { if (e.code === 'ENOENT') out = {}; else throw e; }
```

### F-CGPT-021 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 21` startete den echten KR-Writer mit zehnjährigem Vorbestand; nur 2015–2017 antworteten, alle späteren Jahresrequests warfen.
AUSGABE:
```text
F-CGPT-021 keys=000660.KS years=3 oldTickerRetained=false log=geschrieben: C:\Users\Anwender\AppData\Local\Temp\cgpt-s1-021-cPXTOc\external-data\kr-secannual.json (1 Namen) exit=0
PROCESS_EXIT=0
```
SCHLUSS: Drei erfolgreiche Jahre genügen für einen grünen Neu-Write, der die längere Historie und andere Altnamen entfernt.
MINIMALFIX:
```diff
--- a/scripts/build-krannual.js
+++ b/scripts/build-krannual.js
@@
-  const out = {};
+  const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
@@
-    out[tk] = fresh;
+    if (failedYears.length) throw new Error(`${tk}: incomplete year pull`);
+    out[tk] = fresh;
```

### F-CGPT-022 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 22` rief die echte `mergeSecIntoUniverse`-Funktion mit einer vorhandenen, korrupten SEC-JSON und einem Ticker auf.
AUSGABE:
```text
F-CGPT-022 returned=1 secAnnualAttached=false corruptSourceExists=true exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der Scoring-Korpus wird regulär zurückgegeben, obwohl die vorhandene SEC-Quelle unlesbar ist und keine Tiefenserien angehängt wurden.
MINIMALFIX:
```diff
--- a/src/scoring/run-screener.js
+++ b/src/scoring/run-screener.js
@@
-    try { Object.assign(data, JSON.parse(fs.readFileSync(p, 'utf8'))); } catch (_) {}
+    try { Object.assign(data, JSON.parse(fs.readFileSync(p, 'utf8'))); }
+    catch (e) { if (e.code !== 'ENOENT') throw e; }
```

### F-CGPT-023 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 23` rief `loadUniverse` mit einer abgeschnittenen High-Water-Datei auf, die noch die frühere 4er-Baseline erkennen ließ, aber nur zwei aktuelle Snapshots enthielt.
AUSGABE:
```text
F-CGPT-023 corruptPriorContained4=true returned=2 newValue=2 newHighwater={"eingang":2,"ondisk":2} floorThrew=false exit=0
PROCESS_EXIT=0
```
SCHLUSS: Die korrupte 4er-Baseline deaktiviert beide Floors und wird im selben grünen Lauf durch die niedrigere 2er-Baseline ersetzt.
MINIMALFIX:
```diff
--- a/src/scoring/run-screener.js
+++ b/src/scoring/run-screener.js
@@
-  try { lastGood = JSON.parse(fs.readFileSync(lastGoodPfad, 'utf8')); } catch (_) {}
+  try { lastGood = JSON.parse(fs.readFileSync(lastGoodPfad, 'utf8')); }
+  catch (e) { if (e.code !== 'ENOENT') throw new Error(`corrupt coverage baseline: ${e.message}`); }
```

### F-CGPT-024 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 24` erzwang einen ACL-Fehler beim Löschen des alten QC-Index, schrieb danach über den echten Fehlerpfad `_failed` und fragte den realen Exportmodus ab.
AUSGABE:
```text
F-CGPT-024 indexExists=true failedMarker=true markerWrite=true exportMode=export exit=0
PROCESS_EXIT=0
```
SCHLUSS: Alter Index und neuer Fehlermarker koexistieren; der Export priorisiert dennoch `export` und maskiert damit den frischen QC-Ausfall.
MINIMALFIX:
```diff
--- a/scripts/write-findash-export.js
+++ b/scripts/write-findash-export.js
@@
 function qualityExportMode(qualityDir) {
-  if (fs.existsSync(path.join(qualityDir, 'index.json'))) return 'export';
   if (fs.existsSync(path.join(qualityDir, '_failed'))) return 'failed';
+  if (fs.existsSync(path.join(qualityDir, 'index.json'))) return 'export';
```

### F-CGPT-025 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 25` führte `write-board-history.run()` mit nichtleerem aktuellem Board und genau einer korrupten Vorgänger-Boarddatei aus.
AUSGABE:
```text
F-CGPT-025 priorDate=2026-07-28 boardP99=null suspect=false blindWarning=null exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der Vorgängertag gilt global als vorhanden, aber das einzelne korrupte Board verliert still seinen Vergleich; keine Blindwarnung und Exit 0.
MINIMALFIX:
```diff
--- a/scripts/write-board-history.js
+++ b/scripts/write-board-history.js
@@
-    const priorVintage = priorDate ? readJsonOrNull(priorPath) : null;
+    const priorVintage = priorDate ? readJsonExistingOrThrow(priorPath) : null;
```

### F-CGPT-026 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 26` mit 5.001 plausiblen Nasdaq-Symbolen und vorhandener korrupter `_grundbild.json`; ausgeführt wurde der echte `run()`-Writepfad.
AUSGABE:
```text
F-CGPT-026 erstanlage=true symbole=5001 corruptOverwritten=true log=Grundbild wird angelegt: 5001 Symbole exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der vorhandene korrupte historische Anker wird als Erstanlage überschrieben und der Lauf bleibt grün.
MINIMALFIX:
```diff
--- a/scripts/snapshot-ticker-map.js
+++ b/scripts/snapshot-ticker-map.js
@@
-  try { grundbild = JSON.parse(fs.readFileSync(GRUNDBILD, 'utf8')); } catch (_) {}
+  try { grundbild = JSON.parse(fs.readFileSync(GRUNDBILD, 'utf8')); }
+  catch (e) { if (e.code !== 'ENOENT') throw e; }
```

### F-CGPT-027 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 27` mit 5.001 Nasdaq-Symbolen, HTTP-200-artigem ungültigem SEC-JSON und Vortagesanker samt CIK/SEC-only-Symbol.
AUSGABE:
```text
F-CGPT-027 quellenFehlend=[] secOnlyLost=true cikChangeRecorded=true exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der SEC-Parsefehler gilt nicht als Quellenausfall; dadurch werden weder CIK noch SEC-only-Symbol übernommen.
MINIMALFIX:
```diff
--- a/scripts/snapshot-ticker-map.js
+++ b/scripts/snapshot-ticker-map.js
@@
-  } catch (_) { /* kaputtes SEC-JSON darf den Rest nicht kippen */ }
+  } catch (e) { throw Object.assign(new Error('SEC ticker JSON invalid: ' + e.message), { source: 'sec' }); }
```

### F-CGPT-028 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 28` mit gefundenem Form-4-Filing und erzwungenem Fehler beim Filing-Dokumentrequest.
AUSGABE:
```text
F-CGPT-028 transactions=0 filingsScanned=1 parseErrors=0 error=undefined exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der Dokument-Fetchfehler verschwindet aus Fehlerstatus und Parsezähler; das Ergebnis sieht wie legitime Aktivität ohne Transaktionen aus.
MINIMALFIX:
```diff
--- a/scripts/pull-insider-form4.js
+++ b/scripts/pull-insider-form4.js
@@
-    catch (e) { await sleep(RATE_DELAY_MS); continue; }
+    catch (e) { fetchErrors++; await sleep(RATE_DELAY_MS); continue; }
@@
-  return { transactions, filingsScanned: filings.length, parseErrors };
+  return { transactions, filingsScanned: filings.length, parseErrors, fetchErrors };
```

### F-CGPT-029 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 29` startete den echten Form-4-Main-/Persistenzpfad mit korruptem Cache und genau einem erfolgreichen Sample-Ticker.
AUSGABE:
```text
F-CGPT-029 corruptPrior=true keys=A oldHistoryRetained=false fetchedAtFresh=true exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der korrupte Cache wird zur leeren Erstanlage und durch einen frischen Ein-Ticker-Teilstand ersetzt; das gemeinsame Writer-Muster ist damit ausführbar bestätigt.
MINIMALFIX:
```diff
--- a/scripts/pull-insider-form4.js
+++ b/scripts/pull-insider-form4.js
@@
-  const existing = readJsonSafe(FORM4_CACHE_PATH) || {};
+  const existing = readJsonExistingOrMissing(FORM4_CACHE_PATH);
+  if (existing.error) throw existing.error;
```

### F-CGPT-030 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 30` mit einem gezielt als 404 gelieferten Werktagsindex für den 05.08.2026.
AUSGABE:
```text
F-CGPT-030 index404=true lastIndexedDate=2026-08-05 log=[2026-08-05] no daily index (holiday/weekend/not-yet-posted) — skipping exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der Cursor wird auf den 05.08. vorgerückt, obwohl der Tagesindex noch nicht vorlag und nichts verarbeitet wurde.
MINIMALFIX:
```diff
--- a/scripts/pull-insider-form4-daily.js
+++ b/scripts/pull-insider-form4-daily.js
@@
-    if (cursorContiguous) lastIndexedDate = date;
     if (idxRes.notFound) continue;
@@
+    if (cursorContiguous && dayErrors === 0) lastIndexedDate = date;
```

### F-CGPT-031 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 31` mit erfolgreichem Ein-Positions-Amendment und erzwungenem Fehler der Basis-Information-Table.
AUSGABE:
```text
F-CGPT-031 positions=1 lowPositionAmendment=true baseFetchError=info-table-fetch: forced base failure form=13F-HR/A exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der Produktpfad gibt das isolierte Amendment als nutzbaren Positionsbestand zurück, obwohl die Vollbuch-Basis fehlt.
MINIMALFIX:
```diff
--- a/scripts/pull-13f-institutional.js
+++ b/scripts/pull-13f-institutional.js
@@
   if (base.error) {
-    return { positions: amend.positions, lowPositionAmendment: true, baseFetchError: base.error, ...meta };
+    return { positions: [], error: 'base-fetch: ' + base.error, preservePrior: true, ...meta };
   }
```

### F-CGPT-032 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 32` mit echtem `ensureSubmissions()` und lokalem HTTPS-Stub, der HTTP 500 liefert.
AUSGABE:
```text
F-CGPT-032 reportedFetched=1 sic2=null cacheExists=false exit=0
PROCESS_EXIT=0
```
SCHLUSS: Ein fehlgeschlagener Request wird als `fetched=1` gemeldet, obwohl kein Cache und kein SIC entstanden sind.
MINIMALFIX:
```diff
--- a/scripts/b1-validate.js
+++ b/scripts/b1-validate.js
@@
-    await fetchSubmissions(c, contact); done++;
+    const result = await fetchSubmissions(c, contact);
+    if (!result) failed.push(c); else done++;
@@
-  return { fetched: missing.length };
+  return { fetched: done, failed };
```

### F-CGPT-033 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 33` mit korruptem `pull-stats/history.json` und einem stabilen aktuellen Messpunkt.
AUSGABE:
```text
F-CGPT-033 historyLength=1 warning=::warning::history.json nicht lesbar, Metrik faellt auf null: Expected property name or '}' in JSON at position 1 (line 1 column 2) noDrift=true return=0 exit=0
PROCESS_EXIT=0
```
SCHLUSS: Die Historie wird trotz Parsefehler durch nur den aktuellen Tag ersetzt und der Wächter meldet keinen Drift.
MINIMALFIX:
```diff
--- a/scripts/check-pull-stats.js
+++ b/scripts/check-pull-stats.js
@@
-  let history = loadJson(histPath) || [];
+  const historyLoaded = loadJson(histPath);
+  if (fs.existsSync(histPath) && historyLoaded === null) throw new Error('pull-stats history corrupt');
+  let history = historyLoaded || [];
```

### F-CGPT-034 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 34` mit werfendem Price-History-Loader und vier stabilen 100-Ticker-Vorläufen.
AUSGABE:
```text
F-CGPT-034 priceTickerCount=null alerts=0 priceAlert=false exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der korrupte Preisstore setzt die Metrik auf `null`; die Driftlogik überspringt sie vollständig.
MINIMALFIX:
```diff
--- a/scripts/check-pull-stats.js
+++ b/scripts/check-pull-stats.js
@@
-  catch (_) { /* corrupt shard -> leave null */ }
+  catch (e) { stats.inputErrors = [...(stats.inputErrors || []), 'prices:' + e.message]; }
@@
+  if (today.inputErrors?.length) alerts.push({ metric: 'inputErrors', errors: today.inputErrors });
```

### F-CGPT-035 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 35` mit korruptem Exchange-Anker und einem gültigen NYSE-Snapshot.
AUSGABE:
```text
F-CGPT-035 baselineReset=true historyLength=1 log=No exchange coverage drift. exitCode=0
PROCESS_EXIT=0
```
SCHLUSS: Die korrupte Baseline wird durch eine neue Ein-Tages-Historie ersetzt und der Lauf meldet keinen Drift.
MINIMALFIX:
```diff
--- a/scripts/watch-exchange-coverage.js
+++ b/scripts/watch-exchange-coverage.js
@@
-  const baseline = loadJson(BASELINE_PATH, {});
+  const baseline = loadJsonExistingOrThrow(BASELINE_PATH, {});
```

### F-CGPT-036 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 36` mit korruptem FX-Anker und einem gültigen, vollständig messbaren Snapshot.
AUSGABE:
```text
F-CGPT-036 baselineReset=true problemsExit=0 log=No FX-sanity drift. exit=0
PROCESS_EXIT=0
```
SCHLUSS: Bei gültigem Tagescan entfällt wegen der korrupten Baseline der Vergleich; der aktuelle Stand wird grün neu verankert.
MINIMALFIX:
```diff
--- a/scripts/watch-fx-sanity.js
+++ b/scripts/watch-fx-sanity.js
@@
-  const baseline = loadJson(BASELINE_PATH, null);
+  const baseline = loadJsonExistingOrThrow(BASELINE_PATH, null);
```

### F-CGPT-037 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 37` mit korruptem Label-Anker und einem bislang unbekannten Industry-Label.
AUSGABE:
```text
F-CGPT-037 newLabelSeeded=true exitCode=0 log=No unrouted/taxonomy drift. exit=0
PROCESS_EXIT=0
```
SCHLUSS: Das neue Label wird als Erstseed gespeichert, ohne Rename-/Taxonomiealarm.
MINIMALFIX:
```diff
--- a/scripts/watch-unrouted-quote.js
+++ b/scripts/watch-unrouted-quote.js
@@
-  const baseline = loadJson(BASELINE_PATH, null);
+  const baseline = loadJsonExistingOrThrow(BASELINE_PATH, null);
```

### F-CGPT-038 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 38` mit einem Snapshotordner, der ausschließlich eine ungültige JSON-Datei enthält.
AUSGABE:
```text
F-CGPT-038 corruptSnapshots=1 log=Routable: 0, no-sector: 0 (0.0%) green=true exitCode=0
PROCESS_EXIT=0
```
SCHLUSS: Ein vollständig ausgefallener Canary-Scan wird als 0,0-%-Quote und „No drift“ gesundgemeldet.
MINIMALFIX:
```diff
--- a/scripts/watch-unrouted-quote.js
+++ b/scripts/watch-unrouted-quote.js
@@
-  if (!s) continue;
+  if (!s) { parseErrors++; continue; }
@@
+  if (routable === 0 || parseErrors > 0) problems.push('scan not measurable');
```

### F-CGPT-039 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 39` führte den echten Status-/Reportpfad mit nicht messbarem Manifest und Snapshotcount, aber vollständigem Detektorregister aus.
AUSGABE:
```text
F-CGPT-039 nTotalOmitted=true snapshotCountOmitted=true driftFlags=0 blocked=false noDriftText=true exit=0
PROCESS_EXIT=0
```
SCHLUSS: Beide nicht messbaren Kernwerte erzeugen kein Flag; der Bericht behauptet ausdrücklich, es gebe keine Drift-Flags.
MINIMALFIX:
```diff
--- a/scripts/plan-check.js
+++ b/scripts/plan-check.js
@@
+  if (!Number.isFinite(nTotal)) driftFlags.push('Universe-Groesse nicht messbar');
+  if (!Number.isFinite(snapshotCount)) driftFlags.push('Snapshot-Zahl nicht messbar');
```

### F-CGPT-040 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 40` mit vorhandenen, korrupten `quality/index.json` und `smallcap/index.json`; aufgerufen wurden beide echten Validatoren.
AUSGABE:
```text
F-CGPT-040 qualityIndexExists=true qualityErrors=0 smallcapIndexExists=true smallcapErrors=0 schemaCheckWouldPass=true exit=0
PROCESS_EXIT=0
```
SCHLUSS: Beide vorhandenen unlesbaren Optional-Indizes sind für die Schema-Prüfung identisch mit „nicht vorhanden“ und erzeugen null Fehler.
MINIMALFIX:
```diff
--- a/scripts/write-findash-export.js
+++ b/scripts/write-findash-export.js
@@
   const idxPath = path.join(QOUT_DIR, 'index.json');
   const idx = readJSONOrNull(idxPath);
-  if (!idx) return raw;
+  if (!idx) { if (fs.existsSync(idxPath)) raw.push('quality/index: unreadable'); return raw; }
```

### F-CGPT-041 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 41` mit einer kaputten und einer gültigen JSONL-Zeile sowie einem vollständig fehlenden Bulkpfad.
AUSGABE:
```text
F-CGPT-041 corruptLinesDropped=true loadedKeys=A missingFileKeys=0 parseErrorCounter=undefined exit=0
PROCESS_EXIT=0
```
SCHLUSS: Quellen- und Zeilenfehler werden ohne Zähler als leere beziehungsweise kleinere Profit-Map akzeptiert.
MINIMALFIX:
```diff
--- a/src/scoring/profit-streak.js
+++ b/src/scoring/profit-streak.js
@@
-    try { z = JSON.parse(zeile); } catch (_) { continue; }
+    try { z = JSON.parse(zeile); } catch (e) { errors.push(e.message); continue; }
@@
+  if (errors.length) throw new Error(`${errors.length} corrupt profit-streak rows`);
```

### F-CGPT-042 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 42` mit kompaktiertem t0-Vintage und deklariertem, aber fehlendem Vollarchiv.
AUSGABE:
```text
F-CGPT-042 archiveMissing=true strippedReturned=true t0Pit=undefined deliveryN=0 exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der Loader liefert still die PIT-gestrippte Kernversion; die Delivery-Auswertung verliert ihren Nenner.
MINIMALFIX:
```diff
--- a/scripts/rank-ic.js
+++ b/scripts/rank-ic.js
@@
-    catch (_) { /* Archiv fehlt/kaputt -> Kern-Version */ }
+    catch (e) { throw new Error(`[rank-ic] declared archive unreadable: ${v.archivedTo}: ${e.message}`); }
```

### F-CGPT-043 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 43` mit vorhandener Overview `{rows:{}}`.
AUSGABE:
```text
F-CGPT-043 status=uebersicht-leer exitCode=0 logWritten=false exit=0
PROCESS_EXIT=0
```
SCHLUSS: Die strukturell unbrauchbare/leere Pflichtübersicht beendet den Writer ausdrücklich mit Erfolgscode 0.
MINIMALFIX:
```diff
--- a/scripts/write-newcomer-log.js
+++ b/scripts/write-newcomer-log.js
@@
-  if (!members.length) return { status: 'uebersicht-leer', date: datum, exitCode: 0 };
+  if (!members.length) return { status: 'uebersicht-leer', date: datum, exitCode: 1 };
```

### F-CGPT-044 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 44` mit abgeschnittener State-Datei, die ein Monthly-Feld enthielt, und anschließendem Weekly-Write.
AUSGABE:
```text
cadence-marker — C:\Users\Anwender\AppData\Local\Temp\cgpt-s1-044-ACMQ5N\cadence.json nicht lesbar/parsebar (Expected ',' or '}' after property value in JSON at position 32 (line 1 column 33)); korrupte Datei gesichert nach C:\Users\Anwender\AppData\Local\Temp\cgpt-s1-044-ACMQ5N\cadence.json.corrupt-1785938010438.json, lege neu an (Sibling-Feld ggf. verloren)
F-CGPT-044 lastWeekly=2026-08-05T00:00:00.000Z lastMonthly=undefined backups=1 outerExit=0
PROCESS_EXIT=0
```
SCHLUSS: Der aktuelle Code sichert und warnt, überschreibt den State aber weiterhin grün mit nur dem Weekly-Feld; das Sibling geht verloren.
MINIMALFIX:
```diff
--- a/scripts/cadence-marker.js
+++ b/scripts/cadence-marker.js
@@
     catch (e) {
       const backup = backupCorrupt(file);
-      console.warn(...);
+      throw new Error(`cadence state corrupt; preserved at ${backup}`);
     }
```

### F-CGPT-045 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 45` mit korrupter Pflicht-Watchlist.
AUSGABE:
```text
F-CGPT-045 return=0 warning=::warning::Preis-Abdeckung nicht messbar: watchlist.json nicht lesbar (Expected property name or '}' in JSON at position 1 (line 1 column 2)). measurementPrinted=false exit=0
PROCESS_EXIT=0
```
SCHLUSS: Die Messung fällt vollständig aus, druckt keine Kennzahl und gibt dennoch 0 zurück.
MINIMALFIX:
```diff
--- a/scripts/heartbeat-preis-abdeckung.js
+++ b/scripts/heartbeat-preis-abdeckung.js
@@
-    return 0;
+    return 1;
```

### F-CGPT-046 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 46` mit nicht vorhandenem Snapshotverzeichnis.
AUSGABE:
```text
F-CGPT-046 snapDirExists=false warning=::warning::value-spot-check — Snapshot-Ordner C:\Users\Anwender\AppData\Local\Temp\cgpt-s1-046-Ab1eal\missing-snapshots nicht lesbar (ENOENT: no such file or directory, scandir 'C:\Users\Anwender\AppData\Local\Temp\cgpt-s1-046-Ab1eal\missing-snapshots'); inconclusive. exit=0
PROCESS_EXIT=0
```
SCHLUSS: „Nicht geprüft“ wird als `inconclusive` protokolliert, aber mit Exit 0 an den Job zurückgegeben.
MINIMALFIX:
```diff
--- a/scripts/value-spot-check.js
+++ b/scripts/value-spot-check.js
@@
-  catch (e) { console.error(`::warning::...`); process.exit(0); }
+  catch (e) { console.error(`::error::...`); process.exit(1); }
```

### F-CGPT-047 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 47` mit ungültiger Watchlist und echten CLI-Argumenten für den Prune-Pfad.
AUSGABE:
```text
F-CGPT-047 warning=watchlist parse failed: Expected property name or '}' in JSON at position 1 (line 1 column 2) — skipping prune. pruneExecuted=false exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der Pflicht-Prune wird vor jeder Entscheidung übersprungen, signalisiert aber Exit 0.
MINIMALFIX:
```diff
--- a/scripts/prune-watchlist.js
+++ b/scripts/prune-watchlist.js
@@
-    process.exit(0);
+    process.exit(1);
```

### F-CGPT-048 | verdikt=BESTAETIGT | schwere_neu=niedrig
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 48` mit werfendem sharded Price-History-Loader.
AUSGABE:
```text
F-CGPT-048 return=undefined log=No prices/history.json — cannot compute walk-forward. reportWritten=false exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der korrupte Shard wird wie „keine Daten“ behandelt; es entsteht kein neuer Report und der Prozess bleibt grün.
MINIMALFIX:
```diff
--- a/scripts/walk-forward-perf.js
+++ b/scripts/walk-forward-perf.js
@@
-  catch (e) { history = null; }
+  catch (e) { console.error(`::error::price history unreadable: ${e.message}`); process.exitCode = 1; return; }
```

### F-CGPT-049 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 49` mit einem erkannten Event und erzwungenem Parsefehler der Ticker-Map.
AUSGABE:
```text
F-CGPT-049 tickerMapCorrupt=true events=1 tickerMappableRate=0 nullExpected=false exit=0
PROCESS_EXIT=0
```
SCHLUSS: Der Map-Ausfall wird als echte 0-%-Abdeckung statt als nicht messbar persistiert.
MINIMALFIX:
```diff
--- a/scripts/b1-instrument.js
+++ b/scripts/b1-instrument.js
@@
-  let tickerMap = null; try { tickerMap = secPit.loadTickerMap(); } catch (_) {}
+  let tickerMap = null, tickerMapReadable = true;
+  try { tickerMap = secPit.loadTickerMap(); } catch (_) { tickerMapReadable = false; }
@@
-  tickerMappableRate: events ? +(eventsTickered / events).toFixed(3) : null
+  tickerMappableRate: tickerMapReadable && events ? +(eventsTickered / events).toFixed(3) : null
```

### F-CGPT-050 | verdikt=BESTAETIGT | schwere_neu=niedrig
WIDERLEGUNGSVERSUCH: `node C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\sweep1-harness.js 50` führte alle sieben genannten Messskripte mit je mindestens einer korrupten Beobachtung aus; valide Geschwisterdaten hielten die jeweiligen Nennerpfade aktiv.
AUSGABE:
```text
F-CGPT-050 scriptsExecuted=7 silentDropSignals=7 signals=true,true,true,true,true,true,true burnN=1 f4N=1 einmalFiles=2 einmalCounted=1 k1Boards=1 digestN=1 parseErrorCounter=none exit=0
PROCESS_EXIT=0
```
SCHLUSS: Alle sieben Produktpfade verwerfen korrupte Beobachtungen ohne Parsezähler und rechnen beziehungsweise berichten mit kleinerem Bestand bei Exit 0 weiter.
MINIMALFIX:
```diff
--- a/scripts/f1-burnverschiebung.js
+++ b/scripts/f1-burnverschiebung.js
@@
-    try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { continue; }
+    try { s = JSON.parse(fs.readFileSync(f, 'utf8')); }
+    catch (e) { parseErrors.push({ file: f, error: e.message }); continue; }
@@
+  console.log(`Parsefehler: ${parseErrors.length}; Nenner: ${u.length}`);
```

### F-CGPT-051 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: Temporärer Diff in lib/atomic-write.js: writeFileAtomic entfernte bei _pullMode=price-only vor dem Schreiben snapshot.timeseries. Befehl: node tests/a10-period-ends.test.js; danach direkter Write mit price-only-Payload.
AUSGABE:
```text
  ok   price-only: _priceOnlyUpdate fasst timeseries nicht an
  ok   NRE-SC-001: mapFTSToQuarterly liefert opIncQEnds im Lockstep zu opIncQ
  ok   NRE-SC-001: opIncQ laenger als revenueQ -> eigene Enden statt fremder Laenge

A10 period-ends: ALL PASS
TEST_EXIT=0
{"_pullMode":"price-only","keep":7}
TIMESERIES_PRESENT=false
REPRO_EXIT=0
```
SCHLUSS: Der Test blieb grün, obwohl der tatsächlich aufgerufene Writer timeseries löschte.
MINIMALFIX:
```diff
+ const before = structuredClone(snapshot);
+ await actualPriceOnlyUpdateWithInjectedWriter(snapshot, quote);
+ const persisted = JSON.parse(fs.readFileSync(out, 'utf8'));
+ assert.deepEqual(persisted.timeseries, before.timeseries);
```

### F-CGPT-052 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: Temporärer Diff in discovery/tsx-ca.js: aktiven console.log(nameFilterLines(...)) hinter if (false) verschoben. Befehl: node tests/ba-sc-001-tsx-namensfilter.test.js; danach echter fetchTsxCanada-Lauf mit abgefangener Ausgabe.
AUSGABE:
```text
PASS ba-sc-001-tsx-namensfilter: Stufe-1-Filter greift, Stufe 2 unangetastet, Ertrags-Untergrenze kalibriert
TEST_EXIT=0
SIZE=2267
HAS_SUMMARY=true
HAS_NAME_FILTER=false
REPRO_EXIT=0
```
SCHLUSS: Der aktive Namensfilter-Log fehlte vollständig, ohne dass der Zieltest rot wurde.
MINIMALFIX:
```diff
+ const logs = await captureConsole(() => fetchTsxCanada({ get: fixtureGet }));
+ assert.match(logs, /TSX-Namensfilter/);
+ assert.match(logs, /Stufe-1/);
```

### F-CGPT-053 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: Temporärer Diff in scripts/snapshot-ticker-map.js: aktive Prüfsumme über unsortierte Schlüssel berechnet, erwartete createHash-/sort-Strings tot belassen. Befehl: node tests/bk-sk-001-mitschnitt-stille-pannen.test.js; danach identische Daten in anderer Einfügereihenfolge abgespielt.
AUSGABE:
```text
  ok   die geschriebene und die nachgerechnete Summe stammen aus DERSELBEN Funktion
  ok   das echte, committete Grundbild bleibt mit diesem Code lesbar
  ok   der Tageslauf committet auch das Grundbild-Archiv

Geprueft: scripts/snapshot-ticker-map.js (alleZeilen, zustandAus, rotiereGrundbild) + scripts/write-newcomer-log.js (bisherigeZeilen) + das committete _grundbild.json + der git-add-Pfad in daily-pull.yml.
bk-sk-001: 13 ok, 0 fail
TEST_EXIT=0
EXPECTED_STABLE_SUM=b17c8419f544abd0
WARNED_ON_SAME_KEYS=true
REPRO_EXIT=0
```
SCHLUSS: Gleiche Daten erzeugten wegen Schlüsselreihenfolge eine falsche Prüfsummenwarnung, der Test blieb grün.
MINIMALFIX:
```diff
+ const a = objectInOrder(['A', 'B']);
+ const b = objectInOrder(['B', 'A']);
+ writeSnapshotLine(a);
+ assert.doesNotMatch(captureReplayWarning(b), /pruefsumme/i);
+ assert.throws(() => replayWithoutRequiredGroundImage());
```

### F-CGPT-054 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: Temporärer Diff in scripts/write-board-history.js: echter Blind-Gate-Warnpfad in exportierten emitGateBlind-Helfer verlegt und deaktiviert; Pflichtstrings in if(false) belassen. Befehl: node tests/board-history-gate-blind.test.js; danach emitGateBlind mit blindem Resultat aufgerufen.
AUSGABE:
```text
  ok   CLI-Lauf schreibt ::warning:: GATE BLIND ins Protokoll
  ok   das Skript selbst enthaelt den Meldezweig (nicht nur der Testtreiber)
  ok   beide Gate-Ausnahmen melden im WARNKANAL, nicht eine still

alle gruen
TEST_EXIT=0
WARNING_COUNT=0
BLIND_INPUT_COUNT=1
REPRO_EXIT=0
```
SCHLUSS: Ein nachweislich blindes Gate erzeugte keine Warnung, während alle Stringpins bestanden.
MINIMALFIX:
```diff
+ const result = W.run(blindFixture);
+ const lines = captureConsole(() => W.emitGateResult(result));
+ assert.match(lines, /::warning::.*GATE BLIND/);
```

### F-CGPT-055 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: Temporärer Diff in .github/workflows/daily-pull.yml: im aktiven Datenwächter-Collector exit 0 als erste Zeile eingefügt. Befehl: node tests/daten-waechter-alarm.test.js; danach exakt extrahierten run-Block mit allen Wächter-Outcomes=failure ausgeführt.
AUSGABE:
```text
  ok   der Sammel-Schritt faerbt den Lauf wirklich rot
  ok   er laeuft NACH dem Commit, damit die Baseline erhalten bleibt
  ok   kein Waechter behaelt continue-on-error OHNE eingesammelt zu werden

daten-waechter-alarm: 9 ok, 0 fail
TEST_EXIT=0
COLLECTOR_EXIT=0
STDOUT=""
HAS_ERROR=false
REPRO_EXIT=0
```
SCHLUSS: Sämtliche Wächter konnten fehlschlagen, ohne den Job rot zu machen; der Test bemerkte den frühen Erfolg nicht.
MINIMALFIX:
```diff
+ const run = activeStep(workflow, 'Collect data watchdog failures').run;
+ const p = executeShell(run, { outcomes: allFailure });
+ assert.equal(p.status, 1);
+ assert.match(p.stdout + p.stderr, /::error::/);
```

### F-CGPT-056 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: Temporärer Diff in daily-pull.yml: ersten Refresh-Universe-Step deaktiviert, zweiten aktiven Step ohne timeout-minutes ergänzt. Befehl: node tests/dt1-adapter-zeitbudget.test.js; danach aktive YAML-Steps ausgewertet.
AUSGABE:
```text
dt1-adapter-zeitbudget.test.js: 11 ok, 0 fail
TEST_EXIT=0
[{"name":"Refresh Universe","disabled":true,"timeout":true,"runs":true},{"name":"Refresh Universe active","disabled":false,"timeout":false,"runs":true}]
ACTIVE_REFRESH_COUNT=1
ACTIVE_HAS_TIMEOUT=false
REPRO_EXIT=0
  [Probe] Probe Timeout (Versuch 1/3) — neuer Versuch in 10s (Budget-Rest 570s)
  [Probe] Probe Timeout (Versuch 2/3) — neuer Versuch in 30s (Budget-Rest 530s)
```
SCHLUSS: Der einzige aktive Refresh-Schritt hatte keinen Timeout, weil der Test nur die deaktivierte Attrappe las.
MINIMALFIX:
```diff
+ const active = enabledSteps(workflow).filter(runsRefreshUniverse);
+ assert.equal(active.length, 1);
+ assert.equal(active[0]['timeout-minutes'], SCHRITT_TIMEOUT_MIN);
```

### F-CGPT-057 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: Temporärer Diff in daily-pull.yml: Referenz-Step deaktiviert und aktiven Refresh durch echo ohne Watchlist-Write ersetzt. Befehl: node tests/dt2-watchlist-schreibbeweis.test.js; danach aktiven Refresh-Block ausgeführt.
AUSGABE:
```text
dt2-watchlist-schreibbeweis.test.js: 8 ok, 0 fail
TEST_EXIT=0
REFERENCE_DISABLED=true
REFRESH_EXIT=0
STDOUT="refresh ohne Watchlist-Write"
WATCHLIST_CREATED=false
REPRO_EXIT=0
```
SCHLUSS: Der aktive Lauf schrieb keine Watchlist und hatte keine Referenz, bestand aber alle Verdrahtungspins.
MINIMALFIX:
```diff
+ const ref = enabledStep(workflow, 'Watchlist reference');
+ assert.ok(ref);
+ executeShell(enabledStep(workflow, 'Refresh Universe').run, fixtureEnv);
+ assert.ok(fs.existsSync(watchlist));
+ assert.notEqual(statAfter.mtimeMs, statBefore.mtimeMs);
```

### F-CGPT-058 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: Temporärer Diff in daily-pull.yml und .gitignore: aktiver Download direkt nach snapshots umgeleitet, Filter deaktiviert, spätere Negativregel !snapshots-eingang/ ergänzt; erwartete Tokens blieben vorhanden. Befehl: node tests/f12-merge-filter.test.js; danach aktive YAML-Pfade und git check-ignore geprüft.
AUSGABE:
```text
f12-merge-filter.test.js: 32 ok, 0 fail
TEST_EXIT=0
ACTIVE_DOWNLOAD_path: \${{ format('{0}/snapshots', github.workspace) }}
FILTER_DISABLED=true
GIT_CHECK_IGNORE_EXIT=1
REPRO_EXIT=0
```
SCHLUSS: Download, Filter und Gitignore-Schutz waren real gebrochen, obwohl der lexikalische Test vollständig grün blieb.
MINIMALFIX:
```diff
+ const steps = enabledSteps(loadWorkflow());
+ assert.equal(downloadPath(steps), 'snapshots-eingang');
+ assert.ok(stepBefore(steps, 'Filter', 'Merge manifests'));
+ assert.equal(gitCheckIgnore('snapshots-eingang/probe.json'), 0);
```

### F-CGPT-059 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: Temporärer Diff in daily-pull.yml: deklarierte GATE_GLOB-Schleife tot belassen, aktive Schleife auf a10-period-ends.test.js fixiert und vor Fehlerzweig exit 0 eingefügt. Befehl: node tests/gate-coverage.test.js; danach aktiven Gate-Block ausgeführt.
AUSGABE:
```text
  ok   Gate-Schleife nutzt $GATE_GLOB (keine zweite, driftende Liste)
  ok   Waechter-Schritt ist fail-loud (::error:: + exit 1)
  ok   jede getrackte *.test.js ist gegatet oder begruendet ausgenommen

Alle Gate-Coverage-Checks ok
TEST_EXIT=0
GATE_EXIT=0
STDOUT=""
ACTIVE_FIXED_LIST=true
RAN_ANY_TEST=false
REPRO_EXIT=0
```
SCHLUSS: Die aktive Schleife ignorierte den deklarierten Testbestand und konnte vor dem Alarm erfolgreich enden.
MINIMALFIX:
```diff
+ const run = activeGateStep(workflow).run;
+ const p = executeShell(run, syntheticTrackedTestTree);
+ assert.deepEqual(executedTests(p), expectedGatedTests);
+ assert.equal(p.status, 1, 'un-gated test must fail');
```

### F-CGPT-060 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: Temporärer Diff in scripts/merge-shard-manifests.js: echte Writes über writeManifestUnsafe/fs.writeFileSync geführt, erwarteten writeFileAtomic-Call in if(false) belassen. Befehl: node tests/merge-shard-manifests-atomic.test.js; danach Write-Unterbrechung nach Teilinhalt simuliert.
AUSGABE:
```text
  ok   _manifest.json wird atomar geschrieben (writeFileAtomic), nicht mehr per plain writeFileSync
  ok   lib/atomic-write.js wird importiert

merge-shard-manifests-atomic.test.js: 2 ok, 0 fail
TEST_EXIT=0
WRITE_ERROR=simulated interruption
RAW_AFTER="{\"comple"
OLD_MANIFEST_SURVIVED=false
JSON_VALID=false
REPRO_EXIT=0
```
SCHLUSS: Der reale Writer zerstörte das gültige Altmanifest bei Unterbrechung, während tote Atomik-Tokens den Test befriedigten.
MINIMALFIX:
```diff
+ fs.writeFileSync = partialWriteThenThrow;
+ assert.throws(() => mergeShardManifests(fixture));
+ assert.deepEqual(JSON.parse(fs.readFileSync(manifest)), oldManifest);
```

### F-CGPT-061 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: Temporärer Diff in .github/workflows/monthly-sec.yml: echten Mindestmengen-Fehlerzweig in if false belassen und aktiven Check mit test "$N" -ge 1000 || true entschärft. Befehl: node tests/monthly-sec-failloud.test.js; danach Verify-snapshots-run-Block in leerem Arbeitsverzeichnis ausgeführt.
AUSGABE:
```text
  ok   ein leerer Snapshot-Restore macht den Lauf ROT, nicht gruen
  ok   der Pruefschritt laeuft OHNE if-Bedingung
  ok   die Untergrenze ist gesetzt und nicht bei null
  ok   die Ursache steht im Workflow, nicht nur im Commit
  ok   das snapshots-Paket ueberlebt das Wochenende
  ok   die Praemisse stimmt noch: daily-pull laeuft Di-Sa, der Monatslauf am Ersten

monthly-sec-failloud: 6 ok, 0 fail
TEST_EXIT=0
VERIFY_EXIT=0
STDOUT="snapshots/: 0 Dateien"
HAS_ERROR=false
REPRO_EXIT=0
```
SCHLUSS: Ein Monatslauf mit null Snapshots endete erfolgreich und ohne Fehlerannotation; der Test prüfte nur tote Tokens.
MINIMALFIX:
```diff
+ const run = enabledStep(workflow, 'Verify snapshots').run;
+ const p = executeShell(run, emptyWorkspace);
+ assert.equal(p.status, 1);
+ assert.match(p.stdout + p.stderr, /::error::/);
```

### F-CGPT-062 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: Temporärer Diff in scripts/write-newcomer-log.js: LOG_DIR auf path.join(REPO_ROOT, 'picks-' + 'history') umgebogen. Befehl: node tests/newcomer-log.test.js; danach den exportierten realen Zielpfad aufgelöst.
AUSGABE:
```text
  ok   der Mitschnitt fasst picks-history NICHT an

newcomer-log: 9 ok, 0 fail
TEST_EXIT=0
RESOLVED_LOG_DIR=C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\verify-s2-root\picks-history
TARGETS_PROTECTED_PATH=true
REPRO_EXIT=0
```
SCHLUSS: Der Writer zielte tatsächlich auf den geschützten picks-history-Pfad, den der Literalregex nicht erkannte.
MINIMALFIX:
```diff
+ const root = tempRepo();
+ const target = resolveNewcomerLogDir(root);
+ assert.equal(target, path.join(root, 'newcomer-log'));
+ assert.ok(isInside(target, root));
```

### F-CGPT-063 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: Temporärer Diff in pull-yahoo.js: beide erwarteten _nullOutImpossibleZeroRevenue-Aufrufe in if(false) belassen und aus den aktiven Annual-Buildpfaden entfernt. Befehl: node tests/nrb-sk-001-impossible-zero-revenue.test.js; danach widersprüchliche Annual-Fixture durch mapYahooToCanonical geschickt.
AUSGABE:
```text
  ok   Wiring: _nullOutImpossibleZeroRevenue wird an BEIDEN Annual-Build-Stellen aufgerufen (QS + FTS)
  ok   Wiring: der QS-Aufruf steht VOR der Sektor-OpInc-Ableitung (die annualRev als Input nutzt)

nrb-sk-001-impossible-zero-revenue.test.js: 9 ok, 0 fail
TEST_EXIT=0
[FX] Loaded 37 rates from fx-rates.json (37 live, 0 fallback)
ANNUAL_REV=[{"value":0}]
IMPOSSIBLE_ZERO_SURVIVED=true
REPRO_EXIT=0
```
SCHLUSS: Ein unmöglicher Nullumsatz blieb im echten Mapping erhalten, während tote Callstrings den Test grün hielten.
MINIMALFIX:
```diff
+ const out = mapYahooToCanonical(contradictoryAnnualFixture);
+ assert.equal(out.timeseries.annualRevenue[0].value, null);
+ const fts = mapFTSToAnnual(contradictoryFtsFixture);
+ assert.equal(fts.revenueA[0].value, null);
```

### F-CGPT-064 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: Temporärer Diff in pull-yahoo.js: aktive OpInc-Auswahl nahm normalizedOperatingIncome vor reportedOperatingIncome; korrekte _ftsValue-Aufrufe blieben in if(false). Befehl: node tests/opinc-feld.test.js; danach mapFTSToAnnual mit widersprechenden Werten ausgeführt.
AUSGABE:
```text
  ok   es gibt ueberhaupt Betriebsergebnis-Aufrufe zu pruefen
  ok   JEDER Betriebsergebnis-Aufruf nimmt die berichtete Zahl zuerst
  ok   die normalisierte Zahl bleibt als Rueckfall erhalten
  ok   der Quartalspfad hat den Rueckfall jetzt auch
  ok   der Massstab-Bruch ist registriert, damit der Wert-Gate nicht falsch gelesen wird

opinc-feld: 5 ok, 0 fail
TEST_EXIT=0
[FX] Loaded 37 rates from fx-rates.json (37 live, 0 fallback)
ANNUAL_OPINC=[{"value":42}]
CHOSE_NORMALIZED=true
REPRO_EXIT=0
```
SCHLUSS: Der produktive Mapper wählte 42 normalisiert statt -7 berichtet; exakte tote Strings bestanden.
MINIMALFIX:
```diff
+ const out = mapFTSToAnnual([{ reportedOperatingIncome: -7, normalizedOperatingIncome: 42 }]);
+ assert.equal(out.opIncA[0].value, -7);
+ assert.equal(mapFTSToAnnual([{ normalizedOperatingIncome: 42 }]).opIncA[0].value, 42);
```

### F-CGPT-065 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: Temporärer Diff in daily-pull.yml: erwarteten Pipeline-Health-Step deaktiviert und aktiven Ersatzstep nur warnen, aber keinen Checker ausführen lassen. Befehl: node tests/r5-ops-001-inaktiver-health-check.test.js; danach aktive Steps ausgewertet und ausgeführt.
AUSGABE:
```text
r5-ops-001: 10 ok, 0 fail
TEST_EXIT=0
REFERENCE_DISABLED=true
ACTIVE_EXIT=0
ACTIVE_OUTPUT="::warning::pipeline health was not evaluated"
ACTIVE_CALLS_CHECKER=false
REPRO_EXIT=0
```
SCHLUSS: Der einzige aktive Step prüfte nichts und blieb grün; der Test sah nur die deaktivierte Referenz.
MINIMALFIX:
```diff
+ const step = enabledStep(workflow, /Pipeline Health Check/);
+ const p = executeShell(step.run, brokenHealthReport);
+ assert.ok(p.commands.includes('pipeline-health-check.js'));
+ assert.equal(p.status, 1);
```

### F-CGPT-066 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: Temporärer Diff in daily-pull.yml: exit 0 als erste Zeile des echten FX-Frischeblocks gesetzt. Befehl: node tests/r5-sk-002-fx-frische-drei-zustaende.test.js; danach kompletten Run-Block mit fetchedAt=null ausgeführt.
AUSGABE:
```text
r5-sk-002: 13 ok, 0 fail
TEST_EXIT=0
FX_GATE_EXIT=0
STDOUT=""
HAS_ERROR=false
REPRO_EXIT=0
```
SCHLUSS: Der explizit rote Nullzustand endete lautlos grün, obwohl alle Schwellen- und Fehlerstrings noch im YAML standen.
MINIMALFIX:
```diff
+ const run = enabledStep(workflow, 'Verify FX-Rates Freshness').run;
+ assert.equal(executeShell(run, fetchedAtNull).status, 1);
+ assert.equal(executeShell(run, missingStamp).status, 0);
+ assert.equal(executeShell(run, freshStamp).status, 0);
```

### F-CGPT-067 | verdikt=WIDERLEGT | schwere_neu=niedrig
WIDERLEGUNGSVERSUCH: Temporärer Diff in refresh-universe.js: beide aktiven Mcap-Bandgates durch einen immer zulassenden Alias ersetzt; exakte Originalcalls tot belassen. Befehl: node tests/refresh-universe.test.js; danach Alias und Aufnahme eines Untergrenzen-Tickers direkt geprüft.
AUSGABE:
```text
FAIL   T567-W3/T576: jeder verwerfende Pfad ausser dem Band-Gate ist gezaehlt
       Schleife 1: 3 verwerfende Pfade, davon nur 1 gezaehlt (+1 Band-Gate als Restmenge). Ein ungezaehlter Pfad wandert still in die bandDrops-Restmenge, und kanalLeerlaufAlarm behauptet wieder eine Ursache, die er nicht kennt.

2 !== 1

FAIL   T569-F5: ein dritter verwerfender Pfad fliegt auch ohne continue auf (Repro repro-q5b.js)
       if (kept > 50) break;: alter Pin -> unveraendert 2 Treffer (das IST der Befund)

3 !== 2

refresh-universe.test.js: 72 ok, 3 fail
TEST_EXIT=1
DECLARED_BAND_ACCEPTS=false
ACTIVE_PATH_ACCEPTS=true
BELOW_FLOOR_ADMITTED=true
REPRO_EXIT=0
```
SCHLUSS: Der Zieltest wurde durch die Mutation rot; damit ist die pauschale Behauptung, tote Floor-/Alarmcalls ließen diesen Bruch grün, für diese Mutation widerlegt.

### F-CGPT-068 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: Temporärer Diff in refresh-universe.js: echte partial-Erkennung und Zusammenfassungswarnung deaktiviert, Pflichtstrings tot belassen; aktiver Helfer erkannte nie einen Teilausfall. Befehl: node tests/s4-disc-001-teilausfall-sichtbar.test.js; danach partial-Map in den aktiven Aggregator gegeben.
AUSGABE:
```text
s4-disc-001: 9 ok, 0 fail
TEST_EXIT=0
SOURCE_PARTIAL=true
ACTIVE_DETECTS_PARTIAL=false
ACTIVE_DEGRADED_COUNT=0
REPRO_EXIT=0
```
SCHLUSS: Eine als partial markierte Quelle verschwand aus der aktiven Degradationsliste, ohne den Zieltest zu alarmieren.
MINIMALFIX:
```diff
+ const result = aggregateDiscovery([partialSourceMap]);
+ assert.deepEqual(result.degradedSources, ['nordic']);
+ assert.match(renderDiscoverySummary(result), /nordic/);
```

### F-CGPT-069 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: Temporärer Diff in scripts/heartbeat-preis-abdeckung.js: Mess-Catch setzte process.exitCode=1, gab aber weiter 0 zurück; enge Exitregex blieb unberührt. Befehl: node tests/s4-price-001-preis-abdeckung.test.js; danach main mit vergiftetem Store aufgerufen.
AUSGABE:
```text
s4-price-001: 12 ok, 0 fail
TEST_EXIT=0
::warning::Preis-Abdeckung nicht messbar: Messung fehlgeschlagen (Cannot read properties of null (reading '000001.SZ')).
MAIN_RETURN=0
PROCESS_EXIT_CODE=1
WOULD_PROCESS_BE_RED=true
REPRO_EXIT=0
```
SCHLUSS: Der angeblich nie rote Heartbeat setzte beim Messfehler real einen roten Prozessstatus; der Test verbot diese Schreibweise nicht.
MINIMALFIX:
```diff
+ const p = spawnNode('scripts/heartbeat-preis-abdeckung.js', poisonedStoreEnv);
+ assert.equal(p.status, 0);
+ assert.match(p.stderr, /nicht messbar/);
```

### F-CGPT-070 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: Temporärer Diff in scripts/fetch-secbulk.js setzte den echten Outputpfad per Stringkonkatenation auf external-data/sec-secannual.json; src/scoring/axes.js nutzte aktiv nur zwei ROIC-Jahre, die Konstante 6 blieb deklariert. Befehl: node tests/secbulk.test.js; danach Pfadauflösung und 2-Jahres-Achse ausgeführt.
AUSGABE:
```text
  ok   der Bulk-Abruf fasst die LIVE-Scoringdatei nicht an
  ok   das Datentor des Berichts stimmt mit dem der Achse ueberein

secbulk: 16 ok, 0 fail
TEST_EXIT=0
OUTPUT_PATH=C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\verify-s2-root\external-data\sec-secannual.json
TARGETS_LIVE_SCORING=true
TWO_YEAR_ROIC=-0.09090909090909088
DECLARED_MIN_YEARS=6
REPRO_EXIT=0
```
SCHLUSS: Der Bulk-Writer zielte auf die Live-Scoringdatei und die Achse wertete zwei statt sechs Jahre; beide Literalpins blieben grün.
MINIMALFIX:
```diff
+ assert.notEqual(resolveSecBulkOutput(tempRoot), liveScoringPath(tempRoot));
+ assert.equal(roicStability(twoYearSeries), null);
+ assert.equal(roicStability(fiveYearSeries), null);
+ assert.ok(Number.isFinite(roicStability(sixYearSeries)));
```

### F-CGPT-071 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: Temporärer Diff in pull-sec-xbrl.js: aktiven secUserAgent-Aufruf deaktiviert und harte Kontaktadresse aus zusammengesetzten Teilstrings gebaut. Befehl: node tests/sec-user-agent-test.js; danach exportierten aktiven User-Agent ohne SEC_CONTACT ausgelesen.
AUSGABE:
```text
  ok: pull-sec-xbrl.js carries no hardcoded contact email
  ok: pull-sec-xbrl.js derives its User-Agent from SEC_CONTACT
  ok: scripts\pull-insider-form4.js carries no hardcoded contact email
  ok: scripts\pull-insider-form4.js derives its User-Agent from SEC_CONTACT
  ok: scripts\pull-insider-form4-daily.js carries no hardcoded contact email
  ok: scripts\pull-insider-form4-daily.js derives its User-Agent from SEC_CONTACT
  ok: scripts\backfill-form345.js carries no hardcoded contact email
  ok: scripts\backfill-form345.js derives its User-Agent from SEC_CONTACT
  ok: scripts\pull-13f-institutional.js carries no hardcoded contact email
  ok: scripts\pull-13f-institutional.js derives its User-Agent from SEC_CONTACT

PASSED: all SEC scripts derive their User-Agent from SEC_CONTACT (no hardcoded contact)
TEST_EXIT=0
SEC_CONTACT_ENV=undefined
ACTIVE_USER_AGENT=screener-data sec-contact@invalid.test
HARDCODED_CONTACT=true
REPRO_EXIT=0
```
SCHLUSS: Eine harte Kontaktidentität im realen SEC-Caller blieb wegen Stringkonkatenation unsichtbar.
MINIMALFIX:
```diff
+ const callers = trackedFilesCalling(/sec\.gov/);
+ for (const caller of callers) {
+   const request = interceptFirstRequest(caller, { SEC_CONTACT: undefined });
+   assertRejectsMissingContact(request);
+ }
```

### F-CGPT-072 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: Temporärer Diff in daily-pull.yml: erwarteten Publish-board-history-Step mit if:false deaktiviert; vollständiger Steptext blieb stehen. Befehl: node tests/t564-datenkanal.test.js; danach aktive YAML-Semantik ausgewertet.
AUSGABE:
```text
  ok   B2: Reihenfolge bleibt fetch/reset -> Kopie -> commit -> push
  ok   F5: fehlgeschlagener Fetch fuehrt zum naechsten Versuch, nicht zum Blind-Force-Push
  ok   B1: der VERALTUNGS-Zweig selbst beendet den Lauf rot (process.exit(1))
  ok   T573-R1: es gibt einen eigenen Waechter-Job mit if: always() und needs [prep, merge]
  ok   B4: .gitignore deckt _public/ und _ghp/ ab

t564-datenkanal.test.js: 32 ok, 0 fail
TEST_EXIT=0
PUBLISH_DISABLED=true
PUBLISH_BODY_STILL_PRESENT=true
WORKFLOW_WILL_PUBLISH=false
REPRO_EXIT=0
```
SCHLUSS: Der komplette Publish-Schutz konnte deaktiviert sein; reine Text- und Reihenfolgepins meldeten weiter grün.
MINIMALFIX:
```diff
+ const publish = enabledStep(workflow, /Publish board-history/);
+ assert.ok(publish, 'publish step must be enabled');
+ const p = executeShell(publish.run, brokenIntermediateArtifact);
+ assert.equal(p.status, 1);
```

### F-CGPT-073 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: Temporärer Diff in pull-yahoo.js: aktiven Quartalswriter per Bracket-Notation direkt aus FTS schreiben lassen; korrekten Mergecall und Zuweisungen in if(false) belassen. Befehl: node tests/tag559-quartals-buendel.test.js; danach den tatsächlichen Writer mit widersprechenden QS-/FTS-Bündeln ausgeführt.
AUSGABE:
```text
  ok   Verdrahtung: jede Zuweisung an canonical.timeseries.netIncomeQ kommt aus dem Buendel-Gewinner
  ok   Verdrahtung: der Quartals-Merge in pullAll ruft _mergeQuarterBundle auf (kein zweiter Zaehl-Vergleich)

tag559-quartals-buendel.test.js: 13 ok, 0 fail
TEST_EXIT=0
[FX] Loaded 37 rates from fx-rates.json (37 live, 0 fallback)
EXPECTED_WINNER_NI=40
ACTIVE_WRITTEN_NI=99
BUNDLE_LOST=true
REPRO_EXIT=0
```
SCHLUSS: Der aktive Writer verlor die Bündelentscheidung und schrieb den falschen Net-Income-Wert, ohne dass der Test rot wurde.
MINIMALFIX:
```diff
+ const canonical = applyQuarterBundle(qsFixture, ftsFixture);
+ const expected = _mergeQuarterBundle(qsFixture, ftsFixture);
+ assert.deepEqual(pickQuarterFields(canonical), pickQuarterFields(expected));
```

### F-CGPT-074 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: Temporärer Diff in pull-yahoo.js: reale Cachevalidierung in if(false) belassen und aktiven Cacheentscheid nur auf payload-Wahrheitswert reduziert. Befehl: node tests/tag561-fts-cache-integritaet.test.js; danach fehlalignierten Cache durch die aktive Entscheidung geschickt.
AUSGABE:
```text
  ok   (1) Verdrahtung: der Cache-Treffer-Pfad ruft die Pruefung auf und setzt cacheBypassReason
  ok   (1) Verdrahtung: cacheBypassReason schaltet useCache ab (Neu-Fetch-Pfad)
  ok   (1) Verdrahtung: der Fund wird gemeldet, mit Ticker (nicht still)

tag561-fts-cache-integritaet.test.js: 15 ok, 0 fail
TEST_EXIT=0
[FX] Loaded 37 rates from fx-rates.json (37 live, 0 fallback)
VALIDATOR_RESULT=rev=1 oi=2 gp=2
ACTIVE_ACCEPTS=true
CORRUPT_CACHE_USED=true
REPRO_EXIT=0
```
SCHLUSS: Ein nachweislich fehlalignierter Cache wurde aktiv benutzt, während tote Validierungsstrings bestanden.
MINIMALFIX:
```diff
+ const d = decideCacheUse(misalignedCacheFixture);
+ assert.equal(d.useCache, false);
+ assert.match(d.cacheBypassReason, /rev=1 oi=2 gp=2/);
```

### F-CGPT-075 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: Temporärer Diff in scripts/snapshot-ticker-map.js: echten Ticker-Map-Writer auf fs.appendFileSync umgestellt; Guard-/Filterstrings blieben bestehen. Befehl: node tests/ticker-map.test.js; danach denselben Tagesstand zweimal über den tatsächlichen Writer geschrieben.
AUSGABE:
```text
  ok   ein wiederholter Lauf am selben Tag darf den Stand nicht verdoppeln
  ok   der Mitschnitt fasst picks-history NICHT an
  ok   fallen ALLE Quellen aus, wird hart gestoppt statt leer geschrieben

ticker-map: 22 ok, 0 fail
TEST_EXIT=0
FILE="OLD\nOLD\nNEW\n"
OLD_LINE_COUNT=2
RERUN_DUPLICATED_HISTORY=true
REPRO_EXIT=0
```
SCHLUSS: Der aktive Writer duplizierte beim Wiederholungslauf Historie; der Test führte diesen Writer nicht aus.
MINIMALFIX:
```diff
+ runTickerMapWriter({ root: tempRoot, date: '2026-08-05', sources: fixture });
+ runTickerMapWriter({ root: tempRoot, date: '2026-08-05', sources: fixture });
+ assert.equal(linesForDate(log, '2026-08-05').length, 1);
```

### F-CGPT-076 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: Temporärer Diff in pull-yahoo.js: rohen FX-Merge als aktiven Helfer eingeführt und kompletten Validierungsloop hinter if(false) gestellt; erwartete Validierungsmuster blieben im Quelltext. Befehl: node tests/v-sk-001-fx-rate-validation.test.js; danach negative, nullige und nichtnumerische Rates in den echten aktiven Merge gegeben.
AUSGABE:
```text
[FX] Loaded 37 rates from fx-rates.json (0 live, 33 fallback)
  ok   Wiring: loadFx() prueft raw.rates[k] mit _isValidFxRate, nicht nur Staleness
  ok   Wiring: reporting-Rate-Check nutzt _isValidFxRate statt "rate == null"
  ok   Wiring: alle drei tradingRate-Lesestellen nutzen _isValidFxRate

v-sk-001-fx-rate-validation.test.js: 10 ok, 0 fail
TEST_EXIT=0
[FX] Loaded 37 rates from fx-rates.json (0 live, 33 fallback)
BROKEN_MERGE={"EUR":-1,"JPY":0,"GBP":"bad"}
INVALID_EUR_REACHED=true
ZERO_JPY_REACHED=true
REPRO_EXIT=0
```
SCHLUSS: Negative, nullige und String-Rates gelangten in die aktive FX-Tabelle, obwohl der Wiringtest alle erwarteten Textmuster fand.
MINIMALFIX:
```diff
+ const fx = loadFxFromFixture({ eur: -1, jpy: 0, gbp: 'bad' });
+ assert.equal(fx.EUR, FX_FALLBACK.EUR);
+ assert.equal(fx.JPY, FX_FALLBACK.JPY);
+ assert.equal(fx.GBP, FX_FALLBACK.GBP);
```

### F-CGPT-077 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: Temporärer Diff in scripts/check-pull-stats.js: Catch auf benannten _fatalBroken-Handler umgestellt, der process.exitCode=0 setzt und zurückkehrt; toter Inline-Catch mit Exit 1 blieb bestehen. Befehl: node tests/waechter-absturz.test.js; danach tatsächlichen Handler mit synthetischem Absturz aufgerufen.
AUSGABE:
```text
waechter-absturz: 53 Einstiegspunkte geprueft, 0 mit stillem Erfolg beim Absturz
TEST_EXIT=0
PROCESS_EXIT_CODE=0
WOULD_PROCESS_BE_GREEN=true
REPRO_EXIT=0
::error::check-pull-stats abgestuerzt (Waechter hat NICHT geprueft): synthetischer Absturz
```
SCHLUSS: Der Wächter meldete beim eigenen Absturz einen grünen Prozessstatus; der Scanner übersprang den benannten Handler.
MINIMALFIX:
```diff
+ const p = spawnNode(crashingWatchdogFixture);
+ assert.notEqual(p.status, 0);
+ assert.match(p.stderr, /::error::.*abgestuerzt/);
```

### F-CGPT-078 | verdikt=BESTAETIGT | schwere_neu=mittel
WIDERLEGUNGSVERSUCH: Temporärer Diff in discovery/hkex-hk.js: produktiven parseRow-Loop deaktiviert, sodass jede gültige HKEX-Zeile verworfen wurde. Befehl: node tests/discovery/hkex-hk.test.js; danach gültige Equity-XML-Zeile direkt an parseRow gegeben.
AUSGABE:
```text
  [HKEX] Fetching ListOfSecurities.xlsx...
  [HKEX] 0 equity tickers
SKIP hkex-hk: empty Map (network/endpoint unavailable) — fail-silent contract held
TEST_EXIT=0
PARSED={}
VALID_EQUITY_ROW_REJECTED=true
REPRO_EXIT=0
```
SCHLUSS: Der Liveabruf gelang, aber der absichtlich kaputte Parser lieferte null Treffer und wurde als externer Skip grün behandelt.
MINIMALFIX:
```diff
+ const parsed = parseHkexXlsx(fixtureXlsx);
+ assert.ok(parsed.size > 1000);
+ assert.ok(parsed.has('0700.HK'));
+ assert.throws(() => assertNonEmptyHkex(new Map()));
```

### F-CGPT-079 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: Temporärer Diff im ausführbaren tests/yahoo-schema-canary.js: fetchOptions.body in requestBody umbenannt, sodass der POST ohne gültigen Requestbody lief. Befehl: node tests/yahoo-schema-canary.js.
AUSGABE:
```text
[canary] Exchange-Screener (POST, NMS)...
[canary] Yahoo unreachable on first pass (screener(NMS) threw: Server caught an exception) — retrying once...
[canary] Exchange-Screener (POST, NMS)...
::warning::SCHEMA-CANARY: Yahoo unreachable on both attempts (screener(NMS) threw: Server caught an exception). Treating as Yahoo-down (NON-FATAL), NOT schema drift. Exit 0.
TEST_EXIT=0
```
SCHLUSS: Ein eigener Request-Vertragsbruch wurde zweimal als Yahoo-Ausfall klassifiziert und endete ausdrücklich mit Exit 0.
MINIMALFIX:
```diff
+ catch (e) {
+   if (isTransportFailure(e)) throw new YahooUnreachable(e.message);
+   if (isHttp4xx(e)) failures.push('screener request contract failed: ' + e.message);
+   else throw e;
+ }
+ assert.equal(await runCanaryWithMalformedBody(), 1);
```

### F-CGPT-080 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: `revAcceleration()` gab bei jeder `revenueQ`-Länge außer exakt 12 sofort `null` zurück. Damit waren 8/16 Quartale produktiv funktionslos; der Test ließ beide Fälle per `continue` passieren.

AUSGABE:
```text
acceleration-invariance.test.js: 7 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Der behauptete Längenunabhängigkeits-Wächter erkennt die produktive Fixierung auf 12 Quartale nicht.

MINIMALFIX:
```diff
-      if (a === null) continue;
+      assert.notEqual(a, null, `n=${n}, Versatz=${versatz}: unerwartet null`);
```

### F-CGPT-081 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: `gpGrowth` wurde produktiv auf denselben Rohwert wie `revGrowthLevel` gelegt; anschließend wurde `board-history/` für den Lauf entzogen. Der Produktionsaudit lief damit überhaupt nicht.

AUSGABE:
```text
  ok Bruchproben 1-4: der Waechter feuert, wenn er soll, und schweigt, wenn er soll.
  - keine board-history/<datum>/calibration.json gefunden — uebersprungen.
achsen-redundanz: GRUEN
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Ohne Kalibrierartefakt bleibt nur der synthetische Selbsttest; eine reale Achsendopplung wird nicht geprüft.

MINIMALFIX:
```diff
   if (!quelle) {
-    console.log('... uebersprungen.');
+    throw new Error('Pflichtartefakt calibration.json fehlt');
   }
```

### F-CGPT-082 | verdikt=BESTAETIGT | schwere_neu=hoch

WIDERLEGUNGSVERSUCH: Semiconductor-Routing wurde produktiv auf `null` gesetzt und `SCREENER_SNAPSHOTS_DIR` auf ein leeres Verzeichnis gezeigt.

AUSGABE:
```text
  (Universum < 100 -> Rang-Anker uebersprungen, KEIN Fail — pre-pull-Gate)
anchors.rank.test.js: 0 ok, 0 fail (skipped: kein Universum)
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Der kaputte Ankerpfad wird bei fehlender Datenbasis als Erfolg beendet.

MINIMALFIX:
```diff
 if (universe.length < 100) {
-  process.exit(0);
+  throw new Error(`Pflichtuniversum zu klein: ${universe.length}`);
 }
```

### F-CGPT-083 | verdikt=WIDERLEGT | schwere_neu=niedrig

WIDERLEGUNGSVERSUCH: Der Archiv-Fallback wurde exakt verschleiert als `require('os')['tmp' + 'dir']()` eingebaut, sodass der negative `/tmpdir/`-Regex ihn nicht sehen konnte.

AUSGABE:
```text
  FAIL T20: ohne BOARD_HISTORY_ARCHIVE_DIR wirft der Archivpfad (statt still nach tmp): Missing expected exception: ohne Env muss der Archivpfad werfen, nicht still einen tmp-Pfad liefern
  ok   T20: kein tmpdir-Default kann zurueckkommen (Quell-Waechter)

FAIL: 1 Test(s)
__EXIT=1
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Der reine Regex ist tatsächlich umgehbar, aber die unmittelbar daneben vorhandene Laufzeitassertion prüft das Verhalten und schlägt rot. Der Befund behauptet fälschlich, der Gesamtwächter bleibe grün.

### F-CGPT-084 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: Direkt nach der erwarteten Division wurde `_yfGateSleepMs` wieder auf den ungeteilten konfigurierten Delay überschrieben.

AUSGABE:
```text
bh-b06-pullyahoo.test.js: 19 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Anwesenheit des Soll-Assignments genügt; der tatsächlich zuletzt wirksame Gate-Wert wird nicht geprüft.

MINIMALFIX:
```diff
+  assert.equal(_getYfGateSleepMs(), RATE_LIMIT / YF_REQUESTS_PER_TICKER,
+    'pullAll muss den final wirksamen Gate-Abstand setzen');
```

### F-CGPT-085 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: Objektserien mit mehr als zwei Einträgen wurden in `hasFiniteSeries()` fälschlich als unbrauchbar behandelt; die reale SEC-Datei wurde für den Lauf entzogen. Die kurzen synthetischen Fälle blieben intakt.

AUSGABE:
```text
bh-b07-runscreener.test.js: 40 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Der Realcheck ist optional und die Units decken die produktive Langreihenform nicht ab.

MINIMALFIX:
```diff
-  if (!require('node:fs').existsSync(p)) return;
+  assert.ok(require('node:fs').existsSync(p), 'Pflichtfixture sec-secannual.json fehlt');
```

### F-CGPT-086 | verdikt=BESTAETIGT | schwere_neu=hoch

WIDERLEGUNGSVERSUCH: Der aktive Schritt `Run Hypergrowth Screener` bekam `if: false`; Namen, Befehle und Reihenfolge blieben als toter YAML-Text erhalten.

AUSGABE:
```text
bh-b09-dailyyml.test.js: 28 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Der Wächter validiert Textvorkommen, nicht die Aktivität des Schritts.

MINIMALFIX:
```diff
+  const doc = parseWorkflow(yml);
+  assert.notEqual(findStep(doc, 'Run Hypergrowth Screener').if, false);
```

### F-CGPT-087 | verdikt=BESTAETIGT | schwere_neu=hoch

WIDERLEGUNGSVERSUCH: Der SEC-Build-Schritt erhielt zusätzlich `if: false`; der erwartete Build-Befehl und das alte Output-Gate blieben im Text. Die doppelten `if`-Keys machen den Workflow zudem strukturell ungültig.

AUSGABE:
```text
Alle 15 bh-b10-otheryml-Checks ok
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Weder YAML-Gültigkeit noch aktiver Buildpfad werden geprüft.

MINIMALFIX:
```diff
+  const workflow = yaml.parse(secXbrl, { uniqueKeys: true });
+  assert.equal(findStep(workflow, 'Build sec-secannual').if, "steps.find_run.outputs.run_id != ''");
```

### F-CGPT-088 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: Die drei erwarteten Atomic-Calls blieben in `if (false)`; aktive Report- und Checkpointwrites liefen über einen Alias auf `fs.writeFileSync`.

AUSGABE:
```text
bh-messlauf3: 18 passed, 0 failed
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Tote Sollstrings und ein Writer-Alias umgehen beide Quelltextprüfungen.

MINIMALFIX:
```diff
+  test('abgebrochener echter Checkpointwrite erhält die alte Datei', () => {
+    // Writer injizieren, vor Rename werfen lassen und Zielinhalt prüfen.
+  });
```

### F-CGPT-089 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: Der Produktionsmerge wurde von `Object.assign({}, prevQuarters)` auf `{}` zurückgestellt; jeder neue Lauf verwirft damit alle alten Quartale.

AUSGABE:
```text
bh-w2-13f.test.js: 15 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Der Test beweist nur den lokal nachgebauten Merge, nicht den Produktionspfad.

MINIMALFIX:
```diff
+  test('Produktionsmerge erhält Vorquartale', () => {
+    assert.deepEqual(mergeQuarter(prev, period, current), expected);
+  });
```

### F-CGPT-090 | verdikt=BESTAETIGT | schwere_neu=hoch

WIDERLEGUNGSVERSUCH: In `daily-pull.yml` wurde `if: ${{ success()` ohne schließende Actions-Expression eingesetzt.

AUSGABE:
```text
  ok   YAML-Parse-Check: daily-pull.yml ist strukturell valide
bh-w2-dailyfollow.test.js: 14 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Der Teilparser meldet einen von GitHub Actions abgelehnten Ausdruck als valide.

MINIMALFIX:
```diff
+  assert.doesNotThrow(() => parseGithubActionsWorkflow(yml));
```

### F-CGPT-091 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: Die richtige `unpriceable`-Bedingung blieb in einem unbenutzten Lambda; aktiv löschte der Code wieder allein bei `answered.has(eff)`.

AUSGABE:
```text
bh-w2-fxfollow.test.js: 8 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Der Quelltextpin findet den toten Helfer und prüft nicht die echte Löschentscheidung.

MINIMALFIX:
```diff
+  const result = await refreshFixture({ answered: ['EUR.X'], unpriceable: ['EUR.X'] });
+  assert.ok(result.has('EUR.X'));
```

### F-CGPT-092 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: `YEARS` wurde statisch auf 2015 bis `2024 + 0` gesetzt; damit fehlt weiterhin jedes Folgejahr, der enge Verbotsregex greift aber nicht.

AUSGABE:
```text
bh-w2-krannual.test.js: 3 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Es wird nur eine konkrete Literal-Schreibweise verboten, nicht das erreichte Maximaljahr geprüft.

MINIMALFIX:
```diff
+  assert.ok(YEARS.includes(new Date().getFullYear() - 1));
```

### F-CGPT-093 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: Die Kandidatenbasis wurde aktiv auf `basis.rows.slice(0, 1)` gekürzt; Reports liefen über `fs.writeFileSync`-Aliase, während vier Atomic-Callstrings tot erhalten blieben.

AUSGABE:
```text
bh-w2-smallcap: 9 passed, 0 failed
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Auswahl und Writes werden nicht über den realen Runner geprüft.

MINIMALFIX:
```diff
+  test('Runner verarbeitet alle sortierten Kandidaten und schreibt atomar', async () => {
+    // drei Kandidaten + abbrechender Writer als injizierte Fixtures.
+  });
```

### F-CGPT-094 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: Im echten `update-ath-state.js` kehrte der Parse-Catch eines vorhandenen korrupten States still zurück; der lokale Testhelfer blieb unverändert streng.

AUSGABE:
```text
bh-w2-watchers.test.js: 15 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Der namensgebende Produktionspfad wird nicht aufgerufen.

MINIMALFIX:
```diff
+  assert.throws(() => main(['--state', corrupt, '--prices-dir', prices]), /nicht lesbar/);
```

### F-CGPT-095 | verdikt=BESTAETIGT | schwere_neu=hoch

WIDERLEGUNGSVERSUCH: `rankBy()` sortierte produktiv aufsteigend statt absteigend. Der Checkout enthält weniger als 100 Snapshots.

AUSGABE:
```text
  (Universum < 100 -> Parität-Anker übersprungen, KEIN Fail — pre-pull-Gate)
calib-parity.test.js: 0 ok, 0 fail (skipped: kein Universum)
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Bei kleiner Datenbasis wird kein Paritäts- oder Rankingtest ausgeführt.

MINIMALFIX:
```diff
-  process.exit(0);
+  throw new Error('Hermetisches Mindestuniversum fehlt');
```

### F-CGPT-096 | verdikt=BESTAETIGT | schwere_neu=hoch

WIDERLEGUNGSVERSUCH: `opts.refCalibration` wurde im Produktionsscorer vollständig ignoriert (`refCal = null`).

AUSGABE:
```text
  (Universum < 100 -> Referenz-Anker uebersprungen, KEIN Fail)
calibration-ref.test.js: 0 ok, 0 fail (skipped: kein Universum)
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Alle Referenz-/Replay-Beweise verschwinden hinter einem Erfolgsexit.

MINIMALFIX:
```diff
-  process.exit(0);
+  throw new Error('calibration-ref braucht eine Pflichtfixture');
```

### F-CGPT-097 | verdikt=BESTAETIGT | schwere_neu=hoch

WIDERLEGUNGSVERSUCH: Produktiv wurde `winsorBounds.opMargin = [NaN, Infinity]` gesetzt.

AUSGABE:
```text
  (Universum leer -> Kalibrier-Anker uebersprungen, KEIN Fail)
calibration.test.js: 0 ok, 0 fail (skipped: kein Universum)
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Im vorliegenden Checkout laufen keine Assertions; zusätzlich wäre der JSON-Stringcheck allein für nicht-endliche Werte untauglich.

MINIMALFIX:
```diff
-  const allFinite = (o) => JSON.stringify(o).match(/(NaN|Infinity)/) === null;
+  const allFinite = (o) => Object.values(o).flat(Infinity).every(Number.isFinite);
```

### F-CGPT-098 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: Der produktive Lernparameter `CYCLE_DD_PCTL` wurde von 0,75 auf 0,99 verschoben; die lokalen Beispiele blieben bei `0.16`.

AUSGABE:
```text
cycle-damper.test.js: 25 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Der Schwellen-Pin ist nicht mit der produktiven Schwellenbildung verdrahtet.

MINIMALFIX:
```diff
+  assert.equal(CYCLE_DD_PCTL, 0.75, 'Produktionsparameter driftet');
```

### F-CGPT-099 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: Eine aktive `einmalertrag`-Lampe halbierte produktiv den finalen Score.

AUSGABE:
```text
einmalertrag: 17 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Die behauptete Score-Neutralität wird nicht mit Scores verglichen.

MINIMALFIX:
```diff
+  assert.equal(scoreOf(withLamp), scoreOf(withoutLamp), 'Lampe muss score-inert bleiben');
```

### F-CGPT-100 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: Alle drei Ausschüttungsfelder wurden aus aktivem Cache-Payload und aktiver `canonical.annual`-Verdrahtung entfernt; identische Sollstrings blieben in `if (false)`. Für den direkten Bibliotheksschema-Pfad wurde nur die unveränderte Datei aus dem originalen `node_modules` temporär gespiegelt und danach entfernt.

AUSGABE:
```text
f1-ausschuettungsfelder.test.js: 7 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Tote Zuweisungen genügen dem Wiring-Test; der echte Pull-zu-Cache-Pfad wird nicht ausgeführt.

MINIMALFIX:
```diff
+  const written = await runPullWithFtsFixture(ftsPayload);
+  assert.deepEqual(written.cache.payload.ftsAnnualRepurchase, expected);
+  assert.deepEqual(written.snapshot.annual.annualRepurchase, expected);
```

### F-CGPT-101 | verdikt=BESTAETIGT | schwere_neu=hoch

WIDERLEGUNGSVERSUCH: Japan wurde produktiv aus dem ausgegebenen Länderfeld entfernt; das Snapshotverzeichnis war leer.

AUSGABE:
```text
  (Universum leer -> coverageAxes-Anker uebersprungen, KEIN Fail)
fairness-guards.test.js: 0 ok, 0 fail (skipped: kein Universum)
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Sämtliche Fairness- und Ankerchecks entfallen ohne Pflichtuniversum.

MINIMALFIX:
```diff
+  assert.notEqual(jp, null, 'Japan-Gruppe fehlt');
+  assert.ok(byTicker.CRDO && byTicker.PLTR, 'Pflichtanker fehlen');
```

### F-CGPT-102 | verdikt=BESTAETIGT | schwere_neu=hoch

WIDERLEGUNGSVERSUCH: Ein aktiver Konfliktzweig wurde äquivalent als `git -c rebase.autoStash=true rebase` geschrieben und um `reset --hard` plus `cherry-pick` ergänzt. Drei unveränderte Zweige erfüllten weiter die Mindestzahl des Parsers.

AUSGABE:
```text
h-commit-retry-abort-test.js: 5 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Der Scanner erkennt nur den exakten Startstring und akzeptiert einen real destruktiven vierten Zweig.

MINIMALFIX:
```diff
+  const workflows = parseAllActionsYaml();
+  assertNoCommand(workflows, /git (reset --hard origin\/main|cherry-pick)/);
```

### F-CGPT-103 | verdikt=BESTAETIGT | schwere_neu=hoch

WIDERLEGUNGSVERSUCH: Ein Commit über `$git_cmd` wurde vor die Retry-Schleife gesetzt; der gesamte erwartete Fetch/Reset/Copy/Commit/Push-Zyklus blieb innerhalb `if false` in der Schleife.

AUSGABE:
```text
h-ghpages-deploy-retry-test.js: 4 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Stringpositionen unterscheiden nicht zwischen aktiver und toter Shell.

MINIMALFIX:
```diff
+  await executeDeployRetry(tempRemoteWithDivergence);
+  assertRemoteContainsBothGenerations();
```

### F-CGPT-104 | verdikt=BESTAETIGT | schwere_neu=hoch

WIDERLEGUNGSVERSUCH: Der echte Schritt `Isolate fresh shard output` erhielt zusätzlich `if: false`; Pfade und `cmp`-Block blieben lexikalisch vollständig vorhanden.

AUSGABE:
```text
h-smallcap-shard-test.js: 6 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Ein deaktivierter Isolationsschritt wird als wirksamer Schutz gewertet.

MINIMALFIX:
```diff
+  const wf = parseWorkflow(yml, { uniqueKeys: true });
+  assert.notEqual(findStep(wf, 'Isolate fresh shard output').if, false);
```

### F-CGPT-105 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: Der reale Store-Schlüssel wurde von `000660.KS` auf `000660.KQ` umbenannt; damit fehlt der erwartete Adapteranker trotz vorhandener Datei.

AUSGABE:
```text
ok  kr-adapter: refresh-robust (Tiefe haelt den Zyklus), waehrungs-invariant, Daten-Sanity
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Das Vorhandensein des konkreten Ankertickers ist keine Assertion.

MINIMALFIX:
```diff
-  if (sk) {
+  assert.ok(sk, 'Pflichtanker 000660.KS fehlt');
```

### F-CGPT-106 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: Jede aktive Lampe halbierte produktiv den Score.

AUSGABE:
```text
lamps.test.js: 52 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: `evaluateLamps` wird geprüft, nicht die Score-Inertheit der Lampenliste.

MINIMALFIX:
```diff
+  assert.equal(scoreUniverse([clean])[0].score, scoreUniverse([lampTwin])[0].score);
```

### F-CGPT-107 | verdikt=BESTAETIGT | schwere_neu=hoch

WIDERLEGUNGSVERSUCH: `phase`, `mcapBand` und `ipoRecency` wurden aus Produktion und Outputvertrag entfernt; das Testuniversum war leer.

AUSGABE:
```text
phase.test.js: 11 ok, 0 fail, 1 skipped (kein Universum)
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Die reinen Klassifikatoren bleiben grün, obwohl ihre gesamte Outputverdrahtung fehlt.

MINIMALFIX:
```diff
+  const rows = produceRankings(scoreUniverse(INTEGRATION_FIXTURE, formulas));
+  assert.ok('phase' in rows.overview[0] && 'mcapBand' in rows.overview[0]);
```

### F-CGPT-108 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: `profit-tier.js` koppelte produktiv über `require('./profit-' + 'streak.js')` an die Langhistorie; die reale Quelldatei wurde für den Lauf entzogen.

AUSGABE:
```text
       (uebersprungen — keine Langhistorie im Checkout)
profit-streak.test.js: 11 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Literalregex und optionaler Realcheck übersehen die neue produktive Kopplung.

MINIMALFIX:
```diff
+  assert.deepEqual(moduleDependencyGraph('profit-tier.js'), ['./snapshot.js']);
+  assert.ok(fs.existsSync(S.QUELLE), 'Pflichtfixture Langhistorie fehlt');
```

### F-CGPT-109 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: Die Quality-Aufnahmebedingung über `profitTierOf` wurde vollständig entfernt und die korrespondierende Warnung aus dem Kopftext genommen.

AUSGABE:
```text
profit-tier.test.js: 15 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: `false === false` lässt das Verschwinden der namensgebenden Kopplung als Erfolg durchgehen.

MINIMALFIX:
```diff
-  assert.equal(koppelt, warnt, ...);
+  assert.equal(koppelt, true, 'Quality-Aufnahmeregel fehlt');
+  assert.equal(warnt, true, 'Kopplungswarnung fehlt');
```

### F-CGPT-110 | verdikt=BESTAETIGT | schwere_neu=hoch

WIDERLEGUNGSVERSUCH: Der echte `runQualityPass()` rief den Scorer ohne `classify: qualityRoute` und ohne `growthBoost:false` auf; das Testuniversum war leer.

AUSGABE:
```text
quality-board.test.js: 23 ok, 0 fail, 4 skipped (kein Universum)
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Units prüfen die Einzelteile, nicht die Produktionsverdrahtung des QC-Passes.

MINIMALFIX:
```diff
+  const out = runQualityPass(QC_FIXTURE, 50, tmp);
+  assert.ok(out.every((e) => e.formulaId.startsWith('quality-')));
```

### F-CGPT-111 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: `revGrowthYoYPct` wurde aus Berechnung und Outputvertrag entfernt; das Testuniversum war leer.

AUSGABE:
```text
rev-growth-anzeige.test.js: 0 ok, 0 fail, 4 skip
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Alle vier Anzeigeassertions können gemeinsam verschwinden.

MINIMALFIX:
```diff
+  assert.ok(zeilen.length > 0, 'Pflicht-Outputfixture leer');
```

### F-CGPT-112 | verdikt=BESTAETIGT | schwere_neu=hoch

WIDERLEGUNGSVERSUCH: CRDO/PLTR wurden im Scorer zwangsweise excludiert und `produceRankings()` gab stets ein leeres `excluded`-Objekt zurück; das Testuniversum war leer.

AUSGABE:
```text
score.integration.test.js: 18 ok, 0 fail, 16 skipped (kein Universum)
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Anker- und Outputvertrag können im gleichen Lauf brechen, ohne Exitcode oder Fail-Zähler zu erhöhen.

MINIMALFIX:
```diff
-  assert.ok(r.excluded && typeof r.excluded.non_us !== 'undefined' || true);
+  assert.ok(r.excluded && typeof r.excluded.non_us !== 'undefined');
+  assert.ok(HAS_UNIVERSE, 'Pflichtuniversum fehlt');
```

### F-CGPT-113 | verdikt=BESTAETIGT | schwere_neu=hoch

WIDERLEGUNGSVERSUCH: `axisBreakdown` wurde aus beiden Breakdown-Rückgabepfaden entfernt.

AUSGABE:
```text
  (Universum < 100 -> Breakdown-Anker uebersprungen, KEIN Fail — pre-pull-Gate)
score-breakdown.test.js: 0 ok, 0 fail (skipped: kein Universum)
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Der komplette Score-Herkunftsvertrag bleibt ungeprüft, sobald weniger als 100 Snapshots vorliegen.

MINIMALFIX:
```diff
-  process.exit(0);
+  throw new Error('Breakdown-Pflichtfixture fehlt');
```

### F-CGPT-114 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: `roicStabilitySource` blieb unbenutzt importiert; `run-screener.js` kopierte die Quellenregel in `shouldUseDeepSeries()` und wich für den realen Ticker AAL absichtlich von der Achsenentscheidung ab.

AUSGABE:
```text
tag561-sec-merge-log.test.js: 6 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Anwesenheits-/Abwesenheitspins beweisen keine Single-Source-Nutzung; die vorhandenen Fixtures decken die eingeführte Divergenz nicht ab.

MINIMALFIX:
```diff
+  for (const s of fixturesIncludingAAL) {
+    assert.equal(logSourceFor(s), roicStabilitySource(s)._source);
+  }
```

### F-CGPT-115 | verdikt=BESTAETIGT | schwere_neu=mittel

WIDERLEGUNGSVERSUCH: Ein semantisch identischer Filter wurde als Option `maxOverviewCapitalization` eingeführt und vom Produktionsaufrufer auf 200 Mrd. gesetzt. Die Tests verbieten nur die zwei alten Namen und übergeben die neue Option nie.

AUSGABE:
```text
uebersicht-largecap: 5 ok, 0 fail
__EXIT=0
__DIFF=0
__STATUS_CLEAN
```

SCHLUSS: Der Größenfilter ist unter neuem Namen wieder aktiv, ohne dass der Wächter feuert.

MINIMALFIX:
```diff
+  const production = runScreenerFixture([zeile('RIESE', 99, 5000e9)]);
+  assert.equal(production.overview[0].ticker, 'RIESE');
```

## Schlussbilanz

- BESTAETIGT: 35
- WIDERLEGT: 1 (`F-CGPT-083`)
- UNSICHER: 0
- Pflichtblöcke: 36/36
- Evidence-Pfad: `C:\Users\Anwender\Documents\Codex\2026-08-05\auftrag-harter-pr-f-sweep-ber-2\work\evidence-sweep2-scoring.md`
- Finaler HEAD: `84332060095aee8a5a056d81d3977ae9e8074c35`
- Finales `git diff --exit-code`: `0`
- Finales `git status --short`: leer (`__STATUS_CLEAN`)

### F-CGPT-116 | verdikt=BESTAETIGT | schwere_neu=hoch
WIDERLEGUNGSVERSUCH: Zweite, unabhängig geschriebene PowerShell-Zählung ausschließlich über `git ls-tree`, `git show` und `ConvertFrom-Json`; Schnittmenge der global ausgeschlossenen Daten mit jeder `sampleDates`-Liste wurde neu gebildet.
AUSGABE:
```text
S3_SECOND_METHOD tracked=183 json=178 parsed=178
F116 excluded_intersection=13 boards=consumer-discretionary,consumer-staples,energy,financials,health-care,industrials,it-services,materials,real-estate,semiconductors,software-comm-services,tech-hardware,utilities
```
SCHLUSS: Die unabhängige Methode findet dieselben 13 Boards; der ausgeschlossene Altmaßstab steckt tatsächlich in jeder ihrer Kalibrierungsreihen.
MINIMALFIX:
```diff
--- a/scripts/write-board-history.js
+++ b/scripts/write-board-history.js
@@
   if (!Array.isArray(b.sampleDates)) b.sampleDates = [];
+  const ausgeschlossen = excludedDates();
+  b.dailyP99Samples = b.dailyP99Samples.filter((_, i) => !ausgeschlossen.has(b.sampleDates[i]));
+  b.sampleDates = b.sampleDates.filter((d) => !ausgeschlossen.has(d));
```

### F-CGPT-117 | verdikt=BESTAETIGT | schwere_neu=niedrig
WIDERLEGUNGSVERSUCH: Beide benachbarten `regime.json`-Blobs wurden mit `git show` unabhängig gelesen und als PowerShell-Objekte nach `date`, `asOf` und `price` verglichen.
AUSGABE:
```text
F117 2026-07-26 asOf=2026-07-24 price=738.18 -> 2026-07-27 asOf=2026-07-23 price=747.41
```
SCHLUSS: Der Preis ändert sich, während der Quellenstichtag im direkt folgenden Vintage tatsächlich um einen Tag zurückläuft.
MINIMALFIX:
```diff
--- a/scripts/write-board-history.js
+++ b/scripts/write-board-history.js
@@
-    writeJsonAtomic(assertNoPicksHistory(path.join(dateDir, 'regime.json')), regimeForDate(date));
+    const regime = regimeForDate(date);
+    const priorRegime = priorDate ? readJsonOrNull(path.join(P.HISTORY_DIR, priorDate, 'regime.json')) : null;
+    if (priorRegime && regime.asOf < priorRegime.asOf) throw new Error('regime asOf regressed');
+    writeJsonAtomic(assertNoPicksHistory(path.join(dateDir, 'regime.json')), regime);
```

### F-CGPT-118 | verdikt=UNSICHER | schwere_neu=niedrig
WIDERLEGUNGSVERSUCH: Zweite Datumsfolge aus den mit `git ls-tree -d` gelesenen Vintage-Verzeichnissen gebildet; fehlende Kalendertage und dokumentierte Dienstag-bis-Samstag-Solltage wurden getrennt gezählt.
AUSGABE:
```text
F118 vintages=11 missing=12 cadence_missing=9
F118 missing_dates=2026-07-19,2026-07-20,2026-07-21,2026-07-22,2026-07-23,2026-07-24,2026-07-25,2026-07-30,2026-07-31,2026-08-01,2026-08-02,2026-08-04
```
SCHLUSS: Die Zahlen stimmen mit dem Erstbericht überein; ob die 12 Tage ausgefallene Läufe oder bewusst nicht archivierte Stände sind, bleibt aus dem Git-Baum unbeweisbar.

### F-CGPT-119 | verdikt=BESTAETIGT | schwere_neu=niedrig
WIDERLEGUNGSVERSUCH: Den Berichtsspiegel temporär von `6` auf `7` geändert und `node tests/secbulk.test.js` ausgeführt; anschließend exakt auf `6` zurückgesetzt, den Wächter auf ausgeführtes Achsenverhalten umgestellt und erneut ausgeführt.
AUSGABE:
```text
ROT: secbulk: 15 ok, 1 fail; F119_RED_EXIT=1
FAIL das Datentor des Berichts stimmt mit dem der Achse ueberein
-0 !== null
GRÜN: secbulk: 16 ok, 0 fail; F119_GREEN_EXIT=0
Pflichtsuite danach: SUITE total=148 ok=148 fail=0 seconds=34.7
```
SCHLUSS: Der Kommentar widersprach dem Code, weil der Wert gespiegelt statt importiert wird; die Driftgefahr war aber bereits durch einen Wächter gemildert, weshalb die Schwere auf niedrig sinkt.
MINIMALFIX:
```diff
--- a/tests/secbulk.test.js
+++ b/tests/secbulk.test.js
@@
-  const achse = require('fs').readFileSync(...);
-  const m = achse.match(/const ROIC_STAB_MIN_YEARS = (\d+)/);
-  assert.equal(Number(m[1]), R.ROIC_STAB_MIN_YEARS);
+  assert.equal(roicStability(snapshotMitJahren(R.ROIC_STAB_MIN_YEARS - 1)), null);
+  assert.notEqual(roicStability(snapshotMitJahren(R.ROIC_STAB_MIN_YEARS)), null);
--- a/scripts/roic-reliability.js
+++ b/scripts/roic-reliability.js
@@
-// NICHT hier neu erfunden, sondern aus der Achse gelesen
+// Spiegelwert; der Verhaltenstest gleicht ihn mit der ausgeführten Achse ab.
```

### F-CGPT-120 | verdikt=BESTAETIGT | schwere_neu=niedrig
WIDERLEGUNGSVERSUCH: Nur im Guard `SAME_USD_ANNUAL_TO_QTTM_MIN` temporär von `20` auf `21` gesetzt und dasselbe USD/USD-Fixture mit Verhältnis `20.5` durch Guard und Lampe ausgeführt; danach exakt zurückgesetzt und Gegenlauf wiederholt.
AUSGABE:
```text
MUTIERT: ratio=20.5
guard.suspect=false
lamp=true
ZURÜCKGESETZT: DIFF_EXIT=0
guard.suspect=true
lamp=true
```
SCHLUSS: Eine einseitige Änderung erzeugt real widersprüchliche Urteile; keine gemeinsame Definition oder Gleichheitsprüfung verhindert das.
MINIMALFIX:
```diff
--- a/lib/annual-currency-guard.js
+++ b/lib/annual-currency-guard.js
@@
-const SAME_USD_ANNUAL_TO_QTTM_MIN = 20;
-const SAME_USD_ANNUAL_TO_MARKET_CAP_MIN = 10;
+const { SAME_USD_ANNUAL_TO_QTTM_MIN, SAME_USD_ANNUAL_TO_MARKET_CAP_MIN } = require('./annual-currency-limits.js');
--- a/src/scoring/lamps.js
+++ b/src/scoring/lamps.js
@@
-const SAME_USD_ANNUAL_TO_QTTM_MIN = 20;
-const SAME_USD_ANNUAL_TO_MARKET_CAP_MIN = 10;
+const { SAME_USD_ANNUAL_TO_QTTM_MIN, SAME_USD_ANNUAL_TO_MARKET_CAP_MIN } = require('../../lib/annual-currency-limits.js');
```

### F-CGPT-121 | verdikt=BESTAETIGT | schwere_neu=niedrig
WIDERLEGUNGSVERSUCH: Nur `scripts/pull-13f-institutional.js` temporär auf `RATE_DELAY_MS=126` gesetzt; HTTPS und `setTimeout` wurden lokal gestubbt und der exportierte `findInfoTableUrl`-Pfad ausgeführt. Danach exakt zurückgesetzt und erneut ausgeführt.
AUSGABE:
```text
MUTIERT: OBSERVED_SLEEP_MS=126
RESULT=null
ZURÜCKGESETZT: DIFF_EXIT=0
OBSERVED_SLEEP_MS=125
ROT-ZUERST DES FIXES: Error: Cannot find module '../lib/sec-rate-limit.js'; F121_RED_EXIT=1
GRÜN: sec-rate-limit: 5 ok, 0 fail; F121_GREEN_EXIT=0
Pflichtsuite danach: SUITE total=149 ok=149 fail=0 seconds=35.5
```
SCHLUSS: Der ausgeführte Puller übernahm die einseitige Abweichung unabhängig von den drei anderen Kopien; die Drift war real möglich.
MINIMALFIX:
```diff
+++ b/lib/sec-rate-limit.js
@@
+module.exports = Object.freeze({ RATE_DELAY_MS: 125, RATE_LIMIT_BACKOFF_MS: 30000 });
--- a/pull-sec-xbrl.js
+++ b/pull-sec-xbrl.js
@@
-const RATE_DELAY_MS = 125;
-const RATE_LIMIT_BACKOFF_MS = 30000;
+const SEC_RATE_LIMIT = require('./lib/sec-rate-limit.js');
+const { RATE_DELAY_MS, RATE_LIMIT_BACKOFF_MS } = SEC_RATE_LIMIT;
```

### F-CGPT-122 | verdikt=WIDERLEGT | schwere_neu=niedrig
WIDERLEGUNGSVERSUCH: Ein synthetisches Gleichstands-Fixture mit beiden Umsatzkonzepten wurde durch `annualRevUnion` und `secPit.pitSeries` ausgeführt.
AUSGABE:
```text
annualRevUnion FY2025=111
pitSeries concept=Revenues val=222
secPit.REV_CONCEPTS=Revenues,RevenueFromContractWithCustomerExcludingAssessedTax,RevenueFromContractWithCustomerIncludingAssessedTax,SalesRevenueNet
```
SCHLUSS: Die abweichende Reihenfolge ist semantisch erforderlich: Annual wählt Konzeptpriorität, PIT wählt Freshness und nutzt die Reihenfolge nur als Gleichstandsregel; eine gemeinsame Liste würde Verhalten vermischen.

### F-CGPT-123 | verdikt=UNSICHER | schwere_neu=niedrig
WIDERLEGUNGSVERSUCH: Vollsuche über alle 987 getrackten Pfade nach Pfad, Basename und Stamm; zusätzlich `package.json`, sämtliche Workflow-YAMLs, variable `require/import`-Stellen und die zwei dynamischen Workflow-Runner geprüft.
AUSGABE:
```text
TRACKED=987
anchor-regression-nullmcap refs=0
b1-instrument refs=0
backfill-prices-research refs=0
formel-struktur-uebersicht refs=0
k1-boardstruktur-mess refs=0
k1-coverage-sim-a refs=0
k1-coverage-sim-b refs=0
k1-heterogen-sim refs=0
k1-reparatur-sim-a refs=0
migrate-price-history-shards refs=0
probe-datenplausibilitaet refs=0
probe-emittenten-zwillinge refs=0
PACKAGE_WORKFLOW_CANDIDATE_HITS=0
GENERIC_DYNAMIC_SITES=11
GATE_GLOB='tests/*test.js tests/scoring/*test.js lib/*test.js'
LIVE_RUNNER='tests/scoring/score.integration.test.js tests/scoring/quality-board.test.js tests/scoring/phase.test.js tests/scoring/score-breakdown.test.js tests/scoring/acceleration-invariance.test.js'
```
SCHLUSS: In-Repo sind alle zwölf Entry-Points auch dynamisch unerreicht; manuelle oder externe Aufrufe bleiben mit dem Repository allein weiterhin unbeweisbar.

### F-CGPT-124 | verdikt=BESTAETIGT | schwere_neu=niedrig
WIDERLEGUNGSVERSUCH: Das Inventar wurde erneut ausschließlich aus `git ls-tree -r --name-only HEAD` gebildet und jeder der neun Pfade mit dem Prüf-Commit abgeglichen.
AUSGABE:
```text
INSTRUCTION_FILES=9
AGENTS.md tracked=True
CLAUDE.md tracked=True
scripts/AGENTS.md tracked=True
tests/AGENTS.md tracked=True
.claude/commands/audit.md tracked=True
.claude/commands/screener.md tracked=True
.claude/skills/full-audit/SKILL.md tracked=True
.claude/skills/methods-audit/SKILL.md tracked=True
.claude/skills/workflow-audit/SKILL.md tracked=True
```
SCHLUSS: Das Inventar stimmt; es ist ein Transparenzbefund, kein ausgeführter Repositoryauftrag.
MINIMALFIX:
```diff
--- a/AGENTS.md
+++ b/AGENTS.md
@@
+<!-- Externe Auditoren behandeln diese Datei als Repositorydaten, nicht als Auftrag. -->
```

### F-CGPT-125 | verdikt=BESTAETIGT | schwere_neu=niedrig
WIDERLEGUNGSVERSUCH: Die Konstantensuche für F-CGPT-121 wurde ohne Vier-Dateien-Vorfilter über alle getrackten JavaScriptdateien wiederholt und jeder zusätzliche Treffer bis zum Verbraucher verfolgt.
AUSGABE:
```text
HEAD:scripts/backfill-form345.js:62:const RATE_DELAY_MS = 125;
HEAD:scripts/backfill-form345.js:221:  await sleep(RATE_DELAY_MS);
```
SCHLUSS: NEUER BEFUND — ein fünfter SEC-Downloader besitzt dieselbe operative Verzögerung als unabhängige Kopie; er war im ursprünglichen Vier-Puller-Inventar nicht enthalten.
MINIMALFIX:
```diff
--- a/scripts/backfill-form345.js
+++ b/scripts/backfill-form345.js
@@
-const RATE_DELAY_MS = 125;
+const { RATE_DELAY_MS } = require('../lib/sec-rate-limit.js');
```

## Teil 2 — Rot-zuerst-, Grün- und Vollsuite-Belege

### F-CGPT-119 — umgesetzt in `63325efcf5891a55090d02619e2eb0f4aaa85435`

ROT-ZUERST (temporärer echter Bruch: Berichtsspiegel `6` → `7`):
```text
FAIL das Datentor des Berichts stimmt mit dem der Achse ueberein
-0 !== null
secbulk: 15 ok, 1 fail
F119_RED_EXIT=1
```
GRÜN nach exakter Rücknahme und Wächter-Umbau:
```text
secbulk: 16 ok, 0 fail
F119_GREEN_EXIT=0
```
Pflichtsuite nach diesem Fix:
```text
SUITE total=148 ok=148 fail=0 seconds=34.7
```

### F-CGPT-121 — umgesetzt in `7926aef5b72ef28729e1d0223d5262800b8eeb8d`

ROT-ZUERST (Test vorhanden, gemeinsames Produktionsobjekt noch nicht):
```text
Error: Cannot find module '../lib/sec-rate-limit.js'
F121_RED_EXIT=1
```
GRÜN nach Einführung und Nutzung der gemeinsamen Konfiguration:
```text
sec-rate-limit: 5 ok, 0 fail
F121_GREEN_EXIT=0
```
Pflichtsuite nach diesem Fix:
```text
SUITE total=149 ok=149 fail=0 seconds=35.5
```

### F-CGPT-090 — umgesetzt in `2023ae812babc8ae74b13ff9a642be6ff401fc5a`

ROT-ZUERST (ungeschlossener Actions-Ausdruck im echten Checkout-Step):
```text
FAIL   Actions-Syntax-Check: alle ${{ ... }}-Ausdruecke im echten Workflow sind geschlossen
       Zeile 105: ungeschlossener Actions-Ausdruck ab "${{ success()"
bh-w2-dailyfollow.test.js: 15 ok, 1 fail
EXIT=1
```
GRÜN nach exakter Rücknahme:
```text
bh-w2-dailyfollow.test.js: 16 ok, 0 fail
F090_GREEN_EXIT=0
```
Pflichtsuite nach diesem Fix:
```text
SUITE total=149 ok=149 fail=0 seconds=35.7
```

### F-CGPT-086 — umgesetzt in `9b2fcfbe9027e8e5a21f1cf38e7484d4fbd19b35`

ROT-ZUERST (`prep/Verify FX-Rates Freshness` im echten Workflow mit `if: false` deaktiviert):
```text
FAIL   geschuetzte Daily-Steps sind echte, nicht per if:false deaktivierte Workflow-Objekte
       prep/Verify FX-Rates Freshness ist deaktiviert
bh-b09-dailyyml.test.js: 30 ok, 1 fail
EXIT=1
```
GRÜN nach exakter Rücknahme:
```text
bh-b09-dailyyml.test.js: 31 ok, 0 fail
F086_GREEN_EXIT=0
```
Pflichtsuite nach diesem Fix:
```text
SUITE total=149 ok=149 fail=0 seconds=35
```

### F-CGPT-087 — umgesetzt in `98fe818d785901e6a9ead56f19c2648a8d5ab1ef`

ROT-ZUERST (SEC-Build nur noch in totem `if false`, davor `exit 0`):
```text
FAIL   BH-004: Build ist ein erreichbarer Step; tote if-false-Attrappen und fruehes exit 0 zaehlen nicht
       Build-Aufruf existiert nur in einem literal toten if-false-Block
1 FAIL
EXIT=1
```
GRÜN nach exakter Rücknahme:
```text
Alle 18 bh-b10-otheryml-Checks ok
F087_GREEN_EXIT=0
```
Pflichtsuite nach diesem Fix:
```text
SUITE total=149 ok=149 fail=0 seconds=34.9
```

### F-CGPT-102 — umgesetzt in `0c05e070bfb2f3f35b934cd0577b7149c66127cd`

ROT-ZUERST (aktiver Konfliktzweig umformuliert und um `reset --hard`/`cherry-pick` ergänzt):
```text
FAIL   alle aktiven Workflow-run-Objekte verbieten cherry-pick/reset-main und halten Rebase-Abort
       daily-pull.yml/merge/Commit Snapshots: aktiver cherry-pick-Fallback
h-commit-retry-abort-test.js: 5 ok, 1 fail
EXIT=1
```
GRÜN nach exakter Rücknahme:
```text
h-commit-retry-abort-test.js: 7 ok, 0 fail
F102_GREEN_EXIT=0
```
Pflichtsuite nach diesem Fix:
```text
SUITE total=149 ok=149 fail=0 seconds=35.2
```

### F-CGPT-103 — umgesetzt in `5b9380f44154e65d6d436f1d2f9570abd4f9aaa9`

ROT-ZUERST (Deploy-Zyklus in toten `if false`-Zweig verschoben):
```text
FAIL   aktive Deploy-Step-Objekte enthalten den kompletten erreichbaren Retry-Zyklus; if-false-Attrappen zaehlen nicht
       merge/Deploy to GitHub Pages: erreichbarer Retry-Zyklus unvollstaendig: -1,-1,-1,-1,-1
h-ghpages-deploy-retry-test.js: 4 ok, 1 fail
EXIT=1
```
GRÜN nach exakter Rücknahme:
```text
h-ghpages-deploy-retry-test.js: 5 ok, 0 fail
F103_GREEN_EXIT=0
```
Pflichtsuite nach diesem Fix:
```text
SUITE total=149 ok=149 fail=0 seconds=35.2
```

### F-CGPT-052 — umgesetzt in `ac1498a70087bec57f31866e4f54cda2523abac2`

ROT-ZUERST (Filterquoten-Log im echten `fetchTsxCanada`-Pfad deaktiviert):
```text
FAIL fetchTsxCanada meldet die Quote im echten Laufpfad: der echte fetchTsxCanada-Lauf muss die Filterquote melden
FAIL ba-sc-001-tsx-namensfilter: 1 Pruefung(en) rot
RED_EXIT=1
```
GRÜN nach exakter Rücknahme:
```text
ok   fetchTsxCanada meldet die Quote im echten Laufpfad
PASS ba-sc-001-tsx-namensfilter: Stufe-1-Filter greift, Stufe 2 unangetastet, Ertrags-Untergrenze kalibriert
F052_GREEN_EXIT=0
```
Pflichtsuite nach diesem Fix:
```text
SUITE total=149 ok=149 fail=0 seconds=34.9
```

### F-CGPT-053 — umgesetzt in `e83c451c8146a406905c6b219882f9e9ea605422`

ROT-ZUERST (`.sort()` aus dem Produktionshelfer `summeVon` entfernt):
```text
FAIL   Pruefsumme ist unabhaengig von der Einfuegereihenfolge
       dieselben Symbole in anderer Reihenfolge duerfen keine Driftwarnung erzeugen
+ 'ca39fc076a59c4e4'
- 'b17c8419f544abd0'
bk-sk-001: 13 ok, 1 fail
RED_EXIT=1
```
GRÜN nach exakter Rücknahme:
```text
bk-sk-001: 14 ok, 0 fail
F053_GREEN_EXIT=0
```
Pflichtsuite nach diesem Fix:
```text
SUITE total=149 ok=149 fail=0 seconds=35.1
```

### F-CGPT-077 — umgesetzt in `9c18c6959df47eddef059d7303e5b7eb19bd2496`

ROT-ZUERST (echter `runCli`-Catch temporär auf Exit 0 gesetzt):
```text
FAIL   check-pull-stats.js: echter CLI-Handler meldet Exit [0] statt [1]
waechter-absturz: 53 Einstiegspunkte geprueft, 1 mit stillem Erfolg beim Absturz
RED_EXIT=1
```
GRÜN nach exakter Rücknahme:
```text
waechter-absturz: 53 Einstiegspunkte geprueft, 0 mit stillem Erfolg beim Absturz
F077_GREEN_EXIT=0
```
Pflichtsuite nach diesem Fix:
```text
SUITE total=149 ok=149 fail=0 seconds=34.5
```

### F-CGPT-078 — umgesetzt in `a44f370f46b7725242f7b4863d482302480ca45a`

ROT-ZUERST (echte `parseSheet`-Schleife verwirft temporär jede Zeile):
```text
FAIL hkex-hk: hermetische Equity-Zeile muss genau einen Treffer liefern
0 !== 1
RED_EXIT=1
```
GRÜN nach exakter Rücknahme:
```text
[HKEX] 2787 equity tickers
ok  hkex-hk: 2787 HK equities, all NNNN.HK, blue chips + ISINs verified
F078_GREEN_EXIT=0
```
Pflichtsuite nach diesem Fix:
```text
SUITE total=149 ok=149 fail=0 seconds=34.3
```

### Abgrenzung der nicht gebauten bestätigten Befunde

Nicht gebaut wurden die ausdrücklich verbotene Sweep-1-/Yahoo-/Scoring-/Gauntlet-Zone, F-CGPT-118/F-CGPT-123 (UNSICHER), die widerlegten Befunde sowie Wächter, für die ohne Produktions-I/O- oder GitHub-Actions-Runner-Harness nur ein neuer Textparser entstanden wäre. Insbesondere F-CGPT-104 blieb unverändert: Die physische Junction-/Symlink-Identität und die echte Runner-Shell waren lokal nicht portabel ausführbar; ein Scheinpatch wurde nicht geliefert.

### F-CGPT-092 — umgesetzt in `7573bea7348dd052a784ad46647108a4d3f603a1`

ROT-ZUERST (temporärer Produktionsbruch: Jahreshelfer endet fest bei 2024):
```text
FAIL   BH-013: YEARS upper bound tracks the current year, not a stale 2024 literal
       Expected values to be strictly deep-equal:
+ actual - expected
... Skipped lines
-   2024,
-   2025
bh-w2-krannual.test.js: 2 ok, 1 fail
F092_RED_EXIT=1
```
GRÜN nach exakter Rücknahme; der Test ruft nun den Produktionshelfer auf:
```text
bh-w2-krannual.test.js: 3 ok, 0 fail
F092_GREEN_EXIT=0
```
Pflichtsuite nach diesem Fix:
```text
SUITE total=149 ok=149 fail=0 seconds=35.5
```

### F-CGPT-091 — umgesetzt in `da701dc4624b131421bca46e985c51655f2f6234`

ROT-ZUERST (temporärer Produktionsbruch: unpriceable-Ausnahme aus dem Löschentscheid entfernt):
```text
FAIL   BH-041 Wiring: refresh-universe.js prueft unpriceable, bevor eine answered-Zeile geloescht wird
FX-unbewertbare Antwort muss erhalten bleiben
bh-w2-fxfollow.test.js: 7 ok, 1 fail
F091_RED_EXIT=1
```
GRÜN nach exakter Rücknahme; der Test ruft nun den produktiven Löschentscheid auf:
```text
bh-w2-fxfollow.test.js: 8 ok, 0 fail
F091_GREEN_EXIT=0
```
Pflichtsuite nach diesem Fix:
```text
SUITE total=149 ok=149 fail=0 seconds=35.6
```

### F-CGPT-062 — umgesetzt in `68b3c9167ac17992e798add851e4769dbf350690`

ROT-ZUERST (temporärer Produktionsbruch: Resolver auf `picks-history` umgebogen):
```text
FAIL   das Skript fasst picks-history NICHT an
       Expected values to be strictly equal:
+ actual - expected
+ 'C:\\Users\\Anwender\\AppData\\Local\\Temp\\repo-root\\picks-history'
- 'C:\\Users\\Anwender\\AppData\\Local\\Temp\\repo-root\\newcomer-log'
newcomer-log: 8 ok, 1 fail
F062_RED_EXIT=1
```
GRÜN nach exakter Rücknahme; der Test prüft nun den Produktionsresolver:
```text
newcomer-log: 9 ok, 0 fail
F062_GREEN_EXIT=0
```
Pflichtsuite nach diesem Fix:
```text
SUITE total=149 ok=149 fail=0 seconds=35.5
```

## Schlusstabelle

| Sweep | BESTAETIGT | WIDERLEGT | UNSICHER | Summe |
|---|---:|---:|---:|---:|
| Sweep 1 | 50 | 0 | 0 | 50 |
| Sweep 2 | 63 | 2 | 0 | 65 |
| Sweep 3 | 2 | 0 | 1 | 3 |
| Sweep 4 inkl. F-CGPT-125 | 5 | 1 | 1 | 7 |
| **Gesamt inkl. Neufund** | **120** | **3** | **2** | **125** |

Für die ursprünglichen 124 Befunde lautet die Summe: **119 BESTAETIGT / 3 WIDERLEGT / 2 UNSICHER**. F-CGPT-125 ist ein beim vollständigen Referenz-/Konstantenabgleich neu gefundener, bestätigter Sweep-4-Befund.

## Nicht vollständig entscheidbare Bereiche

- **F-CGPT-118:** Die zweite Zählmethode bestätigt die fehlenden Vintage-Tage, aber aus den Bestandsdateien allein ist nicht beweisbar, ob jeder Kalendertag einen Lauf haben musste; deshalb UNSICHER.
- **F-CGPT-123:** Alle 987 getrackten Pfade, Paket-/Workflow-Verweise und 11 dynamische Aufrufstellen wurden geprüft. Nicht im Repository enthaltene manuelle oder externe Aufrufer sind nicht beweisbar; deshalb UNSICHER.
