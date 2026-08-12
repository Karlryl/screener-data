# Kontinuierliche Gratisquellen-Pipeline V1

Status: `ACTIVE_OUTCOME_BLIND_INFRASTRUCTURE`

Diese Pipeline erweitert ausschließlich den Quellenpool und outcome-blinde
Studieninfrastruktur. Sie verändert oder überschreibt weder Original-V4 noch
den Public-AI-Pfad oder die abgeschlossene SEC-CIK-Studie.

## Harte Grenzen

- Nur Zugänge ohne Zahlung, Zahlungsdaten oder Trial-Zwang.
- Kostenlose Konten und API-Schlüssel sind zulässig; Secrets bleiben außerhalb
  des Repositories.
- Keine Umgehung von Login, CAPTCHA, Paywall, Rate-Limit oder Anbieterregeln.
- Keine Ticker-only-Promotion. Die Arbeitseinheit ist
  `(entity_id, security_id, listing_id, evaluation_date, semantic)`.
- Quellenentdeckung und aktive Studien sind getrennt. Neue Evidenz verändert
  niemals eine bereits versiegelte Studie.
- `NOT_FOUND` ist kein Vollständigkeitsbeleg. Original-V4 erreicht 100 Prozent
  nur bei null ungeklärten Zielzellen über alle fünf Semantiken.
- Original-V4-H-LATE/H-FEM und die reservierten Marktergebnisse 2021-2024
  bleiben bis zu seinen 13 offiziellen Gates geschlossen.
- AI-Audits tragen immer `humanAttestation=false`.

## Dauerbetrieb

Die unveränderliche Startqueue plus das append-only Ereignislog bilden die
einzige operative Wahrheit. Der Controller wählt immer die höchstpriorisierte
autonome Aufgabe, überspringt `RATE_DEFERRED`- und Nutzeraktions-Aufgaben und
schreibt Fortschritt ausschließlich als neues, hashverkettetes Ereignis.

Ein Anbieterfehler darf nur den Anbieter parken. Ohne neue Evidenz oder echte
Testlücke wird keine neue Studienversion erzeugt. Nach Unterbrechungen werden
State, Basis-Commit, Input-Hashes und Ereigniskette vollständig verifiziert,
bevor die Queue fortgesetzt wird.

## Promotion

Quellenevidenz durchläuft:

`DISCOVER -> CONTRACT -> CAPTURE -> REHASH_REPARSE -> RECONCILE`

Eine Ergebnisstudie durchläuft zusätzlich:

`OUTCOME_BLIND_SELECTOR -> ADVERSARIAL_TESTS -> AI_AUDIT -> STAGE_A -> SEAL -> REMOTE_AUTHORIZATION -> ENDPOINT -> LEDGER -> ANALYSIS -> FINAL_LEDGER -> INDEPENDENT_REBUILD`

Promotion stoppt bei unbekannter Lizenz, Hash-/Remote-/Timeline-Drift,
Datenbankmutation, fehlenden Row-IDs, Ticker-only-Identität, nicht
deterministischem Cloud-Lauf oder offenem P0/P1.

## Benachrichtigungen

Keine zeitgesteuerten Chatmeldungen. Benachrichtigt wird nur bei notwendigem
Login/E-Mail-Code/CAPTCHA, unerwarteten Kosten/Trial-Zwang, einer Änderung des
Studienanspruchs, einem vollständigen Meilenstein oder einem nach drei
Prüfungen bestätigten externen Blocker.
