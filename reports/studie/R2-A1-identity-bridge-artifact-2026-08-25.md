**Ergebnis: Blocker 1 ist in Kennungsbruecke v1.1.0 geheilt: 0 von 50 veroeffentlichten Entity-IDs waren im CIK-Raum 1 bis 2100000 oeffentlich invertierbar; Auftrag 1 bleibt HOLD fuer Blocker 2 und 3.**

# R2-A1 - Die Kennungsbruecke als Panel-Artefakt

## Wie gemessen

Die Identitaetskorrektur wurde vor dem Neubau in `protocol/early-detection/2.0.0/r2-a1-blocker1-identity-protection-correction.json` eingefroren.
Version 1.0.0 mit Manifest-Hash `d6e6af0bded542bdc104f35a5b2d2a1e35d1ef95acc63fb4f17ebab3ea8414bc` ist wegen reversibler IDs verworfen;
die aktuelle Nutzlast traegt deshalb Version 1.1.0. Gelesen wurden
nur die zwei freigegebenen Paneldateien bis 2020-12-31. Die Bruecke verwendet
interne CIK-Gleichheit zusammen mit normalisierter Namenskontinuitaet oder
einer expliziten Umbenennungskette. Boersenplatzdaten sind im Panel nicht
vorhanden; das Artefakt behauptet deshalb keine solche Evidenz (verfuegbare
Boersenplatz-Zeilen: 0). Mehrdeutige Namensketten werden ausgeschlossen.

Die Faktentabelle wurde ausschliesslich ueber Kennungs-Metadaten gelesen;
numerische Faktspalten, Signale, Outcomes und Preise blieben unberuehrt.
Die Entity-, Identifier- und Seam-IDs werden mit HMAC-SHA-256 und einem
256-Bit-Schluessel ausserhalb des Repos abgeleitet. Der oeffentliche Waechter
las den Schluessel nicht: Er probierte fuer 50 veroeffentlichte Entity-IDs
alle CIKs von 1 bis 2100000 durch die im Repo bekannte alte Abbildung; 0 IDs
waren invertierbar. Die absichtlich alte Abbildung wurde mit 50 von 50
Treffern rot erkannt.

Das versionierte Panel-Artefakt enthaelt 3159 pseudonymisierte Entitaeten,
6794 Kennungszuordnungen und 5146 Naehte.

## Was ausdruecklich nicht gezeigt ist

- Die Bruecke zeigt keine wirtschaftliche Vergleichbarkeit von Werten auf beiden Seiten einer Naht.
- Es wurde keine deskriptive Schwund- oder Ueberlebensrechnung ausgefuehrt; das ist erst Auftrag 2.
- Es wurde keine Aussage ueber die alte, versiegelte Hypothese abgeleitet und kein Verdikt geaendert.
- Das Endtest-Fenster wurde weder geoeffnet noch gezaehlt oder dargestellt.
- Ergebnisartefakt und Bericht enthalten keine Firmenidentitaeten; das Panel-Artefakt verwendet nur pseudonyme Entitaets- und Kennungs-IDs.
- Blocker 2 ist offen: Es liefen noch keine zwei unabhaengigen Prozesse ueber beide Panels; die fruehere Determinismus-Behauptung ist zurueckgenommen.
- Blocker 3 ist offen: Der bisherige Naht-Waechter vertraut noch Aufrufer-Etiketten und ist nicht im spaeteren Auftrag-2-Pfad installiert.

## Neue Fragen und Hypothesen

- Offen bleibt, wie stark der beschriebene Schwund auf diesem Substrat sinkt und ob die Groessen-/Sektor-Schieflage bestehen bleibt. Das wird hier nicht vorweggenommen; es gehoert in die eigene Praeregistrierung von Auftrag 2.

Alle Zahlen dieses Berichts stehen in `reports/studie/R2-A1-identity-bridge-artifact-2026-08-25.json`;
das Manifest der einzelnen Zuordnungs- und Naht-Shards steht in `reports/studie/R2-A1-identity-bridge-panel-v1.json`.
