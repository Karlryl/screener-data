**Ergebnis: Blocker 1 und 2 sind in Kennungsbruecke v1.2.0 geheilt: zwei getrennte Prozesse scannten beide Panels vollstaendig und trafen den Manifest-Hash `4cd71577b8cf84e7c0ba3781b266b8380ae1400eb1147778c5e7013b15a0044b` mit 0 Fingerprint-Abweichungen; die drei Methodik-Korrekturen A/B/C sind gebaut, die neue Nahtmenge (4864) steht noch zur Methodik-Abnahme, und Auftrag 1 bleibt HOLD fuer Blocker 3.**

# R2-A1 - Die Kennungsbruecke als Panel-Artefakt

## Wie gemessen

Die Identitaetskorrektur wurde vor dem Neubau in `protocol/early-detection/2.0.0/r2-a1-blocker1-identity-protection-correction.json` eingefroren.
Version 1.0.0 mit Manifest-Hash `d6e6af0bded542bdc104f35a5b2d2a1e35d1ef95acc63fb4f17ebab3ea8414bc` ist wegen reversibler IDs verworfen;
die aktuelle Nutzlast traegt deshalb Version 1.2.0. Gelesen wurden
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

Die Panel-Fassung enthaelt 3159 pseudonymisierte Entitaeten,
6794 Kennungszuordnungen und 4864 Naehte. `ddate` bleibt Perioden-Schluessel;
das Naht-EREIGNIS traegt das `accepted` der Einreichung, die die neue Quelle
erstmals traegt. 282 Perioden-Uebergaenge fielen dadurch mit einem frueheren
Ereignis derselben Einreichung zusammen; 0 Naehte hatten keinen
Annahme-Zeitstempel und fielen auf den Perioden-Schluessel zurueck.

971 der 3159 Entitaeten tragen mehr als eine Naht; die hoechste Nahtzahl
einer einzelnen Entitaet betraegt 11. Verteilung: 1 Naehte: 2188 Entitaeten, 2 Naehte: 576 Entitaeten, 3 Naehte: 204 Entitaeten, 4 Naehte: 105 Entitaeten, 5 Naehte: 52 Entitaeten, 6 Naehte: 18 Entitaeten, 7 Naehte: 9 Entitaeten, 8 Naehte: 4 Entitaeten, 9 Naehte: 2 Entitaeten, 11 Naehte: 1 Entitaeten.
Alle drei Groessen stehen als Felder im Artefakt und werden hier nur
wiedergegeben, nicht im Bericht gerechnet.

## Ausschluesse je Fenster

Alle 10 Zaehler sind mit 0 vorbelegt; eine 0 heisst gemessen und nie
eingetreten, nicht ungemessen. Nenner ist die jeweils bereits gelesene
Zeilenzahl desselben Fensters; es wurde dafuer nichts zusaetzlich gelesen.

- entdeckung / coregFactMetadataExcluded: 132528 von 798111 gelesenen Zeilen
- entdeckung / customTaxonomyMetadataExcluded: 0 von 798111 gelesenen Zeilen
- entdeckung / factMetadataOutsideDateExcluded: 0 von 798111 gelesenen Zeilen
- entdeckung / factMetadataWithoutIdentityExcluded: 23050 von 798111 gelesenen Zeilen
- entdeckung / factMetadataWithoutUnitExcluded: 0 von 798111 gelesenen Zeilen
- entdeckung / nonperiodicFactMetadataExcluded: 189125 von 798111 gelesenen Zeilen
- entdeckung / nonperiodicReportsExcluded: 5892 von 176502 gelesenen Zeilen
- entdeckung / reportsWithoutAcceptedExcluded: 0 von 176502 gelesenen Zeilen
- entdeckung / reportsWithoutNameExcluded: 0 von 176502 gelesenen Zeilen
- entdeckung / reportsWithoutValidCikExcluded: 0 von 176502 gelesenen Zeilen
- pruefung / coregFactMetadataExcluded: 24732 von 398108 gelesenen Zeilen
- pruefung / customTaxonomyMetadataExcluded: 94 von 398108 gelesenen Zeilen
- pruefung / factMetadataOutsideDateExcluded: 0 von 398108 gelesenen Zeilen
- pruefung / factMetadataWithoutIdentityExcluded: 11453 von 398108 gelesenen Zeilen
- pruefung / factMetadataWithoutUnitExcluded: 0 von 398108 gelesenen Zeilen
- pruefung / nonperiodicFactMetadataExcluded: 89337 von 398108 gelesenen Zeilen
- pruefung / nonperiodicReportsExcluded: 49093 von 148912 gelesenen Zeilen
- pruefung / reportsWithoutAcceptedExcluded: 0 von 148912 gelesenen Zeilen
- pruefung / reportsWithoutNameExcluded: 0 von 148912 gelesenen Zeilen
- pruefung / reportsWithoutValidCikExcluded: 0 von 148912 gelesenen Zeilen

## Was ausdruecklich nicht gezeigt ist

- Die Bruecke zeigt keine wirtschaftliche Vergleichbarkeit von Werten auf beiden Seiten einer Naht.
- Es wurde keine deskriptive Schwund- oder Ueberlebensrechnung ausgefuehrt; das ist erst Auftrag 2.
- Es wurde keine Aussage ueber die alte, versiegelte Hypothese abgeleitet und kein Verdikt geaendert.
- Das Endtest-Fenster wurde weder geoeffnet noch gezaehlt oder dargestellt.
- Ergebnisartefakt und Bericht enthalten keine Firmenidentitaeten; das Panel-Artefakt verwendet nur pseudonyme Entitaets- und Kennungs-IDs.
- Blocker 2 ist nur fuer die gebundenen Panelbytes, Python-Laufzeit, Implementierung und denselben externen HMAC-Schluessel bestanden; andere Laufzeiten oder Eingaben wurden nicht verglichen.
- Blocker 3 ist offen: Der bisherige Naht-Waechter vertraut noch Aufrufer-Etiketten und ist nicht im spaeteren Auftrag-2-Pfad installiert.
- Die Naht-Datierung auf `accepted` ist gebaut, aber methodisch noch nicht abgenommen; die neue Nahtmenge (4864) braucht die Abnahme durch den Orchestrator.
- Die Mehrfachnaht-Verteilung ist nur veroeffentlicht, nicht ausgewertet: eine segmentweise Kontiguitaets- oder Schwundmessung ist von der Praeregistrierung ausgeschlossen und gehoert in Auftrag 2.
- Die Ausschlusszaehler sind vollstaendig und fenstergetrennt veroeffentlicht, aber nicht ausgewertet; ob ein Ausschluss inhaltlich richtig ist, sagt der Zaehler nicht.

## Neue Fragen und Hypothesen

- Offen bleibt, wie stark der beschriebene Schwund auf diesem Substrat sinkt und ob die Groessen-/Sektor-Schieflage bestehen bleibt. Das wird hier nicht vorweggenommen; es gehoert in die eigene Praeregistrierung von Auftrag 2.

Alle Zahlen dieses Berichts stehen in `reports/studie/R2-A1-identity-bridge-artifact-2026-08-25.json`;
das Manifest der einzelnen Zuordnungs- und Naht-Shards steht in `reports/studie/R2-A1-identity-bridge-panel-v1.json`.
