# Registrierungs-Dateien des Druckenmiller-Moduls — Aenderungs-Protokoll (append-only)

**Wozu.** BUILD-SPEC v1 Residual 4 (aus `court/URTEIL-RETRIAL10-richter21/22.md`): eine
Registrierungs-Datei, die sich spaeter still aendern laesst, registriert nichts. Nach demselben
Muster wie der Zeilen-Schluessel-Schnappschuss ([REV3-5]) gilt hier: **jede** Aenderung an
`protocol/druckenmiller_*_registered_*.json` braucht eine Zeile in dieser Datei, die den NEUEN
sha256 nennt. `tests/druckenmiller/registration.test.js` vergleicht den zuletzt hier
protokollierten Hash gegen den tatsaechlichen Datei-Hash und gegen den `.sha256`-Sidecar — wer
die Datei anfasst und den Eintrag vergisst, faellt auf. Erosion wird sichtbar, nicht still.

**Format je Zeile** (die Reihenfolge zaehlt, der LETZTE Eintrag je Datei ist der gueltige):

    <datum> · <datei> · <sha256> · <grund>

## Eintraege

2026-09-14 · protocol/druckenmiller_loggers_registered_20260914.json · 6c7e810037a6339c70b3a510756a6921d44a5ee49c5af0c3ac42a35a82edb619 · Erst-Registrierung (Datei A, Chunk 1). Werte = Council-D3-Konstanten, unter denen Chunk 0 die Saat bereits gerechnet hat (`preRegistration: true`, 87 Zeilen bis 2026-09-11), plus die beiden Gerichts-Tore (Frische 95 %, Churn 5 %) und die nur geloggten R-INT-Parameter.

2026-09-14 · protocol/druckenmiller_loggers_registered_20260914.json · 316e73c85f9727e1a9c26801054966648fd1ad2a9a324ce29ed71ad20a50bb06 · Der Override-Vermerk (Rat D1) zieht in die Registrierung um. Review-Fund: sein sha256 wurde vorher ueber eine Konstante gebildet, die im selben Schreiber-Skript zwei Bildschirme darueber stand — wer den Text aendert, aendert den Hash mit, der Vermerk belegt also nichts. Jetzt haengt er am .sha256-Sidecar und an genau diesem Changelog-Tor. Keine Aenderung an einer bestehenden Konstante; die Sektionen councilD3/courtGates/rIntLoggedOnly sind byte-gleich geblieben. Dieser Eintrag IST der Beleg, dass das Tor traegt (Datei A war vor Chunk 1 nirgends veroeffentlicht, die Registrierung gilt ab diesem Hash).

2026-09-19 * protocol/druckenmiller_scoreboard_registered_20260919.json * 5f55decd1216976bd3618b2e8625dd76fcfc9e8a3c6258f8f5e1c76ca7594dc4 * Erst-Registrierung (Datei B, Chunk 2): M1/M2, Terzil-Schnitte mit inklusiver Kante, Zustands-Regel, Eintritts-Regel inkl. "erste Beobachtung ist kein Wechsel" und "rueckgerechnete Sitzung veroeffentlicht keinen Zustand", Barriere mit der ratifizierten horizont-Skalierung (AMENDMENT 01, sha256 61d4c8ef...), Passage-Regeln, Zensierung inkl. Datenende, Bootstrap, Blockuntergrenzen, Familien und beide alpha*-Literale, Etikett-Grenzen, Stilllegung (i)-(iv) + Sunset, Lese-Plan R1-R3 mit T0 = 2026-09-19, Tafel-Feldlisten, Trennungs-Tor, Warm-up und powerProjection als NULL-Platzhalter. Dazu priorAccess (Offenlegung, dass die Skalierungs-Lesart nach Datensicht gewaehlt wurde), scalingCheck (1,088 / 1,095) und der Arm-Kollaps-Waechter.

2026-09-19 * protocol/druckenmiller_alfred_registered_20260919.json * a2b647477ef2559d7a058aec6cdb777c28cb1904809495b0c2fc79394b372c30 * Erst-Registrierung (Datei C, Chunk 2): das Design des rueckblickenden ALFRED-Tests {T1,T2,T3} - Vintage-Spanne bis 2026-06-30, DGS30-Luecke ausgeschlossen, Wochen-Einheiten auf dem Donnerstags-Raster, SPY-Erstpassage 63 Balken mit derselben Barrieren-Skalierung wie das Scoreboard, stratifizierte Differenz innerhalb des SPY-Zustands, zirkulaerer Block-Bootstrap 26 Wochen, B = 1.000, Holm ueber drei Tests, 20-Bloecke-Untergrenze, Chunk-4-Vertrag (das Skript laeuft nicht ohne diesen Hash und traegt ihn im Ergebnis).
