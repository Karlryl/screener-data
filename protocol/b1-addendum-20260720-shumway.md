# B1-Addendum 2026-07-20 — Shumway-View fail closed (VOR dem Wiederholungslauf)

Bezug: `protocol/b1-registered-20260719.md` (eingefroren, unveraendert) §7 Nr. 6
+ §8-Veto. Dieses Addendum aendert KEINE Hypothese, keinen Test, keine Schwelle —
es dokumentiert, wie die praeregistrierte Shumway-View unter einer NACH dem
Freeze ratifizierten Semantik-Aenderung gefuehrt wird, BEVOR der (einzige)
konfirmatorische Wiederholungslauf startet.

## Sachlage

1. §7 Nr. 6 (eingefroren): "Shumway 1997: performance-bedingte Serienenden =
   −30 % imputiert; Klassifikation via `lib/forward-returns.classify`."
2. Der Tag-392-Lauf ist ANNULLIERT (Kreuz-Review 19.07., 4×P1: Lauf mass das
   Estimand nicht; Karl-ratifiziert — der eine Validation-Schuss gilt als
   NICHT verbraucht). Die dortige Implementierung imputierte zudem JEDES
   Serienende als Miss (auch vor dem Einstieg) — Protokoll-Bruch,
   Dry-Round-#2-Fund T2 (bestaetigt 20.07.).
3. Court E-20260720-5 (Karl-ratifiziert, Tags 402–404, NACH dem Freeze):
   0/negativer Close ist KEIN Preis und NIE Delisting-Beleg; `classify()`
   liefert 'delisted' nur noch in einem praktisch/logisch unerreichbaren
   Defensiv-Zweig. Damit existiert die im Freeze referenzierte preisbasierte
   Performance-Klassifikation nicht mehr.
4. Zweikammer-Duell 20.07. (Codex-Blindkritik, 7 Einwaende; Claude-Richter):
   Eine Shumway-Schaetzung, die gleichzeitig den Freeze und E-20260720-5
   wahrt, existiert nicht (Einwaende 3–5 maschinell bestaetigt). Eine
   degenerierte Ersatz-View (identisch zum Haupttest) koennte den Haupttest
   in BY mechanisch hochstufen (Einwand 6) — verboten. Neue Proxy-Schwellen
   waeren nicht-praeregistrierte Methodik — verboten.
   (Einwand 1 "Schuss verbraucht" zurueckgewiesen: beruhte auf dem
   annullierten Tag-392-Report ohne Vault-Kontext; Annullierung ist
   Karl-ratifiziert. Einwand 2 "Balance-Gate" bereits durch Tag 394 gefixt:
   assessBalance prueft Outcome-Attrition mit.)

## Regelung (fail closed)

- Die Shumway-View wird als **NOT_ESTIMABLE_NO_DELISTING_LABELS** gefuehrt:
  `estimable:false, p=1, mean=null` — sie bleibt in der m=6-BY-Familie
  (bestehende "unmessbar = p=1"-Konvention, kein m-Schrumpfen) und kann nie
  BY-signifikant werden.
- §8-Verdikt: ein BY-signifikanter positiver Haupttest wird OHNE auswertbare
  Shumway-View auf **"nicht belastbar unter Attrition (Shumway-View nicht
  auswertbar)"** gekappt — das Pflicht-Gate wird nie still uebersprungen.
  Ein NULL-Ergebnis bleibt uneingeschraenkt gueltig (§8 verlangt das Veto
  nur fuer POSITIV).
- `firstPassage` imputiert in KEINER View; Serienenden liefern immer die
  ehrlichen Status (`series_ended_pre_entry` / `series_ended_in_window`)
  und laufen in die Missingness-/Balance-Ausweise.
- Eine echte Shumway-View braucht **unabhaengige Delisting-/M&A-Labels**
  (nicht close<=0) + eigene Prae-Registrierung — als Folge-Task gequeued,
  beruehrt diesen Lauf nicht.

Konsequenz fuer den Wiederholungslauf: moegliche Endergebnisse sind
NULL (gueltig), "unterpowert", "nicht belastbar unter Attrition" — ein
zertifiziertes POSITIV ist strukturell nicht erreichbar, bis Labels +
Neu-Registrierung existieren. Das steht VOR dem Lauf fest und ist Karl
in `_KARL-ENTSCHEIDE.md` (E-20260720-6) ausgewiesen.
