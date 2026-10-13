# Unabhaengiger Human-Semantikaudit der SEC-Konzeptkarte

Dieser Kit prueft ausschliesslich die eingefrorene Semantik. Der Reviewer darf keine Wachstums-, Kurs- oder Studienergebnisse sehen und muss von Erstellung und Implementierung unabhaengig sein.

1. `audit-items-template.csv` unter neuem Namen kopieren und jede der 50 Zeilen entscheiden.
2. Fuer jede Zeile `reviewerDecision`, `findingSeverity`, `evidenceCitation` und `reviewerComment` ausfuellen; `evidenceCitation` enthaelt eine oder mehrere mit Semikolon getrennte evidenceIds.
3. Jeden tragenden SEC-/FASB-/US-GAAP-Primarbeleg in `evidence-manifest-template.csv` erfassen, unveraenderlich im Repository ablegen und an einen von origin/main erreichbaren Commit binden.
4. `attestation-template.json` unter neuem Namen ausfuellen, die SHA-256-Werte von Kit, Review und Evidenzmanifest eintragen und mit exakt demselben Namen wie `reviewerName` persoenlich signieren.
5. Den Verifier mit Review, Evidenzmanifest und Attest ausfuehren. Ein Software-Selbsttest oder LLM ist kein unabhaengiger Human-Audit.

Ein Semantik-PASS schliesst das offizielle Gate noch nicht allein: Der exakte autorisierte Gesamtinput und sein run-gebundener conceptMap-Komponentenhash bleiben zusaetzlich Pflicht.
