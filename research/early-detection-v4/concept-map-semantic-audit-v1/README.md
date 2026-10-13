# Unabhaengiger Human-Semantikaudit der SEC-Konzeptkarte

Dieser Kit prueft ausschliesslich die eingefrorene Semantik. Der Reviewer darf keine Wachstums-, Kurs- oder Studienergebnisse sehen und muss von Erstellung und Implementierung unabhaengig sein.

1. `audit-items-template.csv` unter neuem Namen kopieren und jede der 50 Zeilen entscheiden.
2. Fuer jede Zeile `reviewerDecision`, `findingSeverity`, `evidenceCitation` und `reviewerComment` ausfuellen.
3. Nur offizielle SEC-/FASB-/US-GAAP-Primarquellen als tragende Semantikbelege verwenden.
4. `attestation-template.json` unter neuem Namen ausfuellen und persoenlich signieren.
5. Den Verifier ausfuehren. Ein Software-Selbsttest oder LLM ist kein unabhaengiger Human-Audit.

Ein Semantik-PASS schliesst das offizielle Gate noch nicht allein: Der exakte autorisierte Gesamtinput und sein run-gebundener conceptMap-Komponentenhash bleiben zusaetzlich Pflicht.
