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
