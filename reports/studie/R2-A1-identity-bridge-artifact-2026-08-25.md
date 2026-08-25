**Ergebnis: Blocker 1 und 2 sind in Kennungsbruecke v1.1.0 geheilt: zwei getrennte Prozesse scannten beide Panels vollstaendig und trafen den Manifest-Hash `583c30c303014de3d44dfcc42294809a4e4d09b741992e128ffc77657b720ac1` mit 0 Fingerprint-Abweichungen; Auftrag 1 bleibt HOLD fuer Blocker 3 und die offenen Methodik-Korrekturen.**

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

Die Determinismus-Korrektur wurde vor den beiden Neubauten in `protocol/early-detection/2.0.0/r2-a1-blocker2-independent-rebuild-correction.json`
eingefroren. Prozess A und Prozess B starteten mit getrenntem Speicher,
oeffneten jeweils beide Panels und riefen `scan_panel` je zweimal auf.
Verglichen wurden logische Nutzlast, vollstaendige Manifestbytes, geordnete
Shard-Deskriptoren, Shard-Set, Zaehler, Eingangsbelege und Key-Fingerprint:
0 Abweichungen. Ein absichtlich veraenderter Shard-Set-Fingerprint im
zweiten echten Neubau wurde rot abgewiesen. Der fruehere In-Prozess-Check
gilt ausdruecklich nicht als unabhaengiger Determinismusbeleg.

Die unveraenderte, noch `ddate`-basierte Panel-Fassung enthaelt 3159 pseudonymisierte Entitaeten,
6794 Kennungszuordnungen und 5146 Naehte.

## Was ausdruecklich nicht gezeigt ist

- Die Bruecke zeigt keine wirtschaftliche Vergleichbarkeit von Werten auf beiden Seiten einer Naht.
- Es wurde keine deskriptive Schwund- oder Ueberlebensrechnung ausgefuehrt; das ist erst Auftrag 2.
- Es wurde keine Aussage ueber die alte, versiegelte Hypothese abgeleitet und kein Verdikt geaendert.
- Das Endtest-Fenster wurde weder geoeffnet noch gezaehlt oder dargestellt.
- Ergebnisartefakt und Bericht enthalten keine Firmenidentitaeten; das Panel-Artefakt verwendet nur pseudonyme Entitaets- und Kennungs-IDs.
- Blocker 2 ist nur fuer die gebundenen Panelbytes, Python-Laufzeit, Implementierung und denselben externen HMAC-Schluessel bestanden; andere Laufzeiten oder Eingaben wurden nicht verglichen.
- Blocker 3 ist offen: Der bisherige Naht-Waechter vertraut noch Aufrufer-Etiketten und ist nicht im spaeteren Auftrag-2-Pfad installiert.
- Die Quellenwahl verwendet weiterhin `ddate` statt `accepted`; die 5.146 Naehte sind deshalb noch nicht methodisch korrigiert oder abgenommen.
- Die 971 Mehrfachnaht-Entitaeten, maximale Nahtzahl und vollstaendigen Ausschlusszaehler sind noch nicht wiederhergestellt.

## Neue Fragen und Hypothesen

- Offen bleibt, wie stark der beschriebene Schwund auf diesem Substrat sinkt und ob die Groessen-/Sektor-Schieflage bestehen bleibt. Das wird hier nicht vorweggenommen; es gehoert in die eigene Praeregistrierung von Auftrag 2.

Alle Zahlen dieses Berichts stehen in `reports/studie/R2-A1-identity-bridge-artifact-2026-08-25.json`;
das Manifest der einzelnen Zuordnungs- und Naht-Shards steht in `reports/studie/R2-A1-identity-bridge-panel-v1.json`.
