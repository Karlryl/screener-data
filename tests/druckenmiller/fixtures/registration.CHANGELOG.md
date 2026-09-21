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

2026-09-19 * tests/druckenmiller/fixtures/spec-constants.json * Sektion thirteenF (Chunk 3) * Die Schwellen des 13F-Betrachters (acht Quartale, Plausibilitaetsband [1, 5000] USD, 10-%-Quarantaene, Preisverhaeltnis-Band [0,5; 2,0], Options-Emissionsnummern 90/95, dreiwertiger Join, CIK, lokale Zuordnung mit Identitaets-Wache, gemessene Abdeckung 308/697) werden HIER registriert, nicht in einer vierten gehashten Datei - Entscheid Rat/Master 2026-09-19, Option (b). Datenqualitaets-Schwellen eines beschreibenden Betrachters, keine Ergebnis-Parameter; eine Aenderung braucht eine Changelog-Zeile, niemals eine stille Bearbeitung.

2026-09-19 * protocol/BUILD-SPEC-v1-AMENDMENT-02-chunk4-power-policy.md * 167acdc2f14a101092baf1c58a2d2c0ac3467aba07689dd82444c950fe55fb98 * AMENDMENT 02 (Rat 13, Option B 3:1 zu Ende gefuehrt): Power-Politik als zitierbarer Punkt - der Praediktor-Outcome-Kontrast wird nur berechnet, wenn eine registrierte, abhaengigkeitsvalide Power-Rechnung >= 0,80 an der 5-pp-Latte ergibt. Nachgerechnet auf den Eingaben der Akte: erreichte Power 23,9 % an 5 pp und 10,1 % an 3 pp (Holm-schlechtester Arm, guenstigstes Szenario) - 0,80 braeuchte 3.285 unabhaengige Einheiten statt 748. Damit Chunk 4 UNGELESEN ins Grab: kein Vintage-Abruf gebaut, kein Kontrast berechnet, Access-Ledger woertlich als Post-Inspektions-Provenienz. Wiedereroeffnung nur durch ein NEUES vorregistriertes Design mit nachgewiesener Power >= 0,80 an 5 pp; Datei C ist geschlossen, nicht pausiert. Lehre: das >= 20-Bloecke-Tor misst Substrat, nicht Power. Datei C und die Spec bleiben unveraendert.
2026-09-20 * protocol/druckenmiller_loggers_registered_20260914.json * a7b4855b42d63b4b77a2c762c5297a06d6b4d8a11a2ab54d27354126126ed4e0 * Ergaenzung um verifiedPostHashRows fuer die Live-Zeile 2026-09-18; Konstanten und preRegistrationRows byte-unveraendert. Provenienz (i)/(ii)/(iii), numerische Reproduktion ersetzt den gescheiterten Konstruktionsbeweis (6 von 21 Hunks); constants_sha256-Stempel ab dem naechsten Lauf.
