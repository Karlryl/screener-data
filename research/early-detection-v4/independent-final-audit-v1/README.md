# Unabhaengiges Abschluss-Audit FEM-SEC-US@1.2.0

Dieses Paket ist fuer einen wirklich unabhaengigen Human-Auditor. Die produzierende Instanz darf sich nicht selbst freigeben. Ergebniszugriff vor der signierten Auditentscheidung ist verboten.

1. Erst nach zehn bestandenen Voraussetzungsgates den exakten Input, das Forschungskorpus und den autorisierten Remote-Stand fixieren.
2. `run-binding-template.json` unter neuem Namen mit der letzten autorisierten Ledger-Zeile ausfuellen.
3. Alle 22 Checklistenpunkte anhand der angegebenen Primaerbelege pruefen; jedes Finding in einer Kopie von `findings-template.csv` erfassen.
4. Offene P0/P1/P2 muessen vor der Signatur geschlossen sein. Offene P3 duerfen nur als `PASS_WITH_P3` sichtbar bleiben.
5. Attestation persoenlich ausfuellen und signieren. Ein LLM, Software-Selbsttest oder Autor der Studie ist kein unabhaengiger Human-Auditor.
6. Den Verifier mit exaktem Input und Gate-Evidence ausfuehren. Seine Entscheidung wird als Beleg des `independentAuditPassed`-Artefakts committed; danach wird die volle Elf-Gate-Kette vor der Ausfuehrungsautorisierung nochmals mechanisch geprueft.

Der leere Vorlagenzustand ist absichtlich RED und darf nie als Audit-PASS zitiert werden.
