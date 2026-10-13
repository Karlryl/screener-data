# Findash-Firmenname: Vertrags-Spezifikation

## Ziel

Der bereits vorhandene Firmenname aus `snapshot.meta.name` wird score-neutral und additiv bis in den Findash-v1-Export durchgereicht. Es gibt keinen Live-Abruf und keine Heuristik aus dem Ticker.

## Vertrag

- Neues Feld: `name: string | null`.
- Leerzeichen werden bereinigt; leere oder ungültige Werte werden `null`.
- Scoring, Ränge, Board-Zugehörigkeit und bestehende Felder bleiben byte-identisch.
- Das additive Feld erfordert keinen Versionssprung.
- Producer- und Consumer-Fixture bleiben byte-identisch.

## Abnahme

- Ein Integrationstest beweist `snapshot.meta.name → score result → ranking → export`.
- Negativtests beweisen `null` für fehlende/leere Namen.
- Export-Selftest, Vertragsgate, vollständige Node-Suite und `git diff --check` sind grün.

