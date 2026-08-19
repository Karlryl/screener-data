#!/usr/bin/env python3
"""Konzept-Landkarte 1.0.0 -> 1.1.0. GENAU EINE Revision (Beschluss 16.08.).

Auswahlkriterium fuer jeden Tag ist die TAXONOMIE-SEMANTIK, je Tag dokumentiert.
Die Wirkung auf die Auffindbarkeitsquote wurde bei der Auswahl NICHT betrachtet;
die Messung laeuft erst nach dem Einfrieren dieser Datei ("erst Regel, dann zaehlen").
"""
import hashlib, json, sys
from pathlib import Path

alt = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))

# --- (a) Umsatz-Whitelist. Regel: der Tag bezeichnet den ENTITAETS-WEITEN Erloes aus
# Lieferung/Leistung. Komponenten, Kontra-Positionen, Finanzertraege, Zuschuesse und
# Anhang-Fragmente sind ausgeschlossen. Reihenfolge = Prioritaet (hoechste zuerst).
REVENUE = [
    ("RevenueFromContractWithCustomerExcludingAssessedTax",
     "ASC-606-Hauptzeile, Erloes aus Kundenvertraegen ohne durchlaufende Steuern. Ab 2018."),
    ("RevenueFromContractWithCustomerIncludingAssessedTax",
     "ASC-606-Hauptzeile inkl. durchlaufender Steuern. Ab 2018."),
    ("Revenues",
     "Allgemeine Gesamterloes-Zeile der us-gaap-Taxonomie, epochenuebergreifend gueltig."),
    ("RevenueFromContractsWithCustomers",
     "Aeltere Schreibweise der 606-Gesamtzeile, gleiche Bedeutung."),
    ("Revenue",
     "Generische Gesamterloes-Zeile."),
    ("SalesRevenueNet",
     "PRAE-606-Gesamtzeile 'Net Sales'. Traegt 2009-2017 die Rolle, die spaeter 606 uebernimmt."),
    ("SalesRevenueGoodsNet",
     "PRAE-606-Hauptzeile fuer Warenverkauf; bei Warenhaendlern der Entitaets-Gesamterloes."),
    ("SalesRevenueServicesNet",
     "PRAE-606-Hauptzeile fuer Dienstleistung; bei Dienstleistern der Entitaets-Gesamterloes."),
    ("SalesRevenueEnergyServices",
     "PRAE-606-Gesamterloes-Zeile der Energieversorger."),
    ("SalesRevenueFromEnergyCommoditiesAndServices",
     "PRAE-606-Gesamterloes-Zeile Energiehandel und -dienstleistung."),
    ("RegulatedAndUnregulatedOperatingRevenue",
     "Ausdrueckliche SUMME beider Sparten eines Versorgers, also die Gesamtzeile."),
    ("RevenueFromSaleOfGoods",
     "IFRS-naher Hauptposten Warenerloes; bei reinen Warenverkaeufern die Gesamtzeile."),
    ("RevenueFromRenderingOfServices",
     "IFRS-naher Hauptposten Dienstleistungserloes; bei reinen Dienstleistern die Gesamtzeile."),
    ("RevenuesFromExternalCustomers",
     "Erloes mit Konzernfremden; bei unsegmentierten Filern identisch mit dem Gesamterloes."),
    ("SalesRevenueGoodsGross",
     "Brutto-Warenerloes. Nur wenn keine Netto-Zeile vorliegt."),
    ("SalesRevenueServicesGross",
     "Brutto-Dienstleistungserloes. Nur wenn keine Netto-Zeile vorliegt."),
]

# Ausgeschlossen, mit Grund. Steht in der Datei, damit die Auswahl pruefbar ist und
# eine spaetere Sitzung nicht dieselbe Debatte neu fuehrt.
REVENUE_ABGELEHNT = {
    "RevenuesNetOfInterestExpense": "Finanzsektor-Darstellung; Universum schliesst SIC 6000-6799 aus.",
    "RevenuesExcludingInterestAndDividends": "Finanzsektor-Darstellung; siehe oben.",
    "RevenueFromInterest": "Zinsertrag, kein Erloes aus Lieferung/Leistung.",
    "RevenueFromDividends": "Beteiligungsertrag, kein Erloes aus Lieferung/Leistung.",
    "RevenueFromGrants": "Zuwendung, keine Gegenleistung an einen Kunden.",
    "RevenueFromGovernmentGrants": "Zuwendung, keine Gegenleistung an einen Kunden.",
    "RevenueNotFromContractWithCustomer": "Per Konstruktion Teilgroesse (Komplement der Hauptzeile).",
    "RevenueNotFromContractWithCustomerExcludingInterestIncome": "Teilgroesse.",
    "RevenueNotFromContractWithCustomerOther": "Teilgroesse.",
    "RevenueFromCollaborativeArrangementExcludingRevenueFromContractWithCustomer":
        "Per Namen ausdrueckliche Teilgroesse neben der Hauptzeile. Folge: Biotechs, die NUR "
        "Kooperationsertrag zeigen, bleiben ausserhalb des Definitionsbereichs und erscheinen "
        "im Deckungsgrad als Vor-Umsatz. Bewusst so, semantisch begruendet.",
    "RegulatedOperatingRevenue": "Sparten-Komponente, nicht die Gesamtzeile.",
    "UnregulatedOperatingRevenue": "Sparten-Komponente, nicht die Gesamtzeile.",
    "RevenueFromRoyalties": "Lizenz-Teilposten, in der Praxis Komponente neben der Hauptzeile.",
    "RevenueFromLeaseOrRentalOfPropertyOrEquipment": "Miet-/Leasing-Komponente.",
    "RevenueFromRelatedParties": "Verbundene-Parteien-Teilmenge, nicht die Gesamtzeile.",
    "RelatedPartyTransactionRevenuesFromTransactionsWithRelatedParty": "Anhangangabe, Teilmenge.",
    "RevenuesFromTransactionsWithOtherOperatingSegmentsOfSameEntity": "Innenumsatz, kein Aussenerloes.",
    "SalesRevenueServicesNetMember": "XBRL-Member, kein Wert.",
    "SalesAllowancesGoods": "Kontra-Erloes (crdr=D).",
    "SalesDiscountsGoods": "Kontra-Erloes (crdr=D).",
    "SalesReturnsGoods": "Kontra-Erloes (crdr=D).",
    "SalesAndMarketingExpense": "Aufwand, kein Erloes.",
    "SalesCommissionsAndFees": "Aufwand, kein Erloes.",
    "OtherCostOfOperatingRevenue": "Aufwand, kein Erloes.",
    "RevenueRemainingPerformanceObligation": "Bestandsgroesse (iord=I), kein Periodenerloes.",
    "RevenueRecognitionMilestoneMethodRevenueRecognized": "Anhang-Fragment zur Bilanzierungsmethode.",
    "BusinessCombinationSeparatelyRecognizedTransactionsRevenuesAndGainsRecognized":
        "Anhangangabe zum Unternehmenszusammenschluss.",
    "EquityMethodInvestmentSummarizedFinancialInformationNetSalesOrGrossRevenue":
        "Kennzahl einer Beteiligung, nicht der berichtenden Entitaet.",
    "SalesOfRealEstate": "Branchen-Komponente; Immobilienvehikel liegen ohnehin in SIC 6500-6799.",
    "RevenueMineralSales": "Branchen-Komponente neben der Gesamtzeile.",
    "RevenueOilAndGasServices": "Branchen-Komponente neben der Gesamtzeile.",
}

# --- (b) R10: verwaesserte Aktienzahl, Fallback-Kette. Fehlend bleibt NICHT BERECHENBAR.
DILUTED = [
    ("WeightedAverageNumberOfDilutedSharesOutstanding",
     "Gewichteter Durchschnitt verwaesserter Aktien - die von R10 verlangte Groesse."),
    ("WeightedAverageNumberOfDilutedSharesOutstandingIncludingConvertible",
     "Gleiche Groesse inklusive Wandelrechten."),
    ("WeightedAverageNumberOfSharesOutstandingBasic",
     "Unverwaesserter Durchschnitt. Ersatz, wenn keine verwaesserte Zahl gemeldet ist - "
     "unterschaetzt die Verwaesserung, faengt den Kapitalerhoehungs-Effekt aber weiterhin."),
    ("WeightedAverageNumberOfSharesOutstanding",
     "Aeltere Schreibweise der unverwaesserten Groesse."),
    ("EntityCommonStockSharesOutstanding",
     "Deckblatt-Stichtagszahl. Letzter Rueckfall; Stichtag statt Durchschnitt, deshalb "
     "niedrigste Prioritaet und im Report als solcher auszuweisen."),
]

neu = dict(alt)
neu["version"] = "FEM-SEC-CONCEPT-MAP@1.1.0"
neu["status"] = "FROZEN_BEFORE_E1B_ACCEPTANCE_RUN"
neu["frozenAt"] = "2026-08-16T18:45:00Z"
neu["protocol"] = "FEM-SEC-US@2.0.0"
neu["parentVersion"] = alt["version"]
neu["parentSha256"] = hashlib.sha256(
    json.dumps(alt, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
neu["revisionGrundlage"] = "_BESCHLUSS-AUFFINDBARKEIT-2026-08-16.md"
neu["revisionRegel"] = (
    "GENAU EINE Revision. Auswahlkriterium ist Taxonomie-Semantik, je Tag dokumentiert; "
    "die Wirkung auf die Auffindbarkeitsquote wurde bei der Auswahl nicht betrachtet. "
    "Besteht der E1b-Abnahmelauf nicht, endet Strang B als INCONCLUSIVE_DATA - eine zweite "
    "Revision ist ausgeschlossen."
)

neu["roles"] = dict(alt["roles"])
neu["roles"]["revenue"] = dict(alt["roles"]["revenue"])
neu["roles"]["revenue"]["conceptPriority"] = [t for t, _ in REVENUE]
neu["roles"]["revenue"]["conceptRationale"] = {t: r for t, r in REVENUE}
neu["roles"]["revenue"]["rejected"] = REVENUE_ABGELEHNT
neu["roles"]["revenue"]["limitation"] = (
    "Prioritaetsliste, keine Summierung. Meldet eine Firma Waren- und Dienstleistungserloes "
    "getrennt OHNE Gesamtzeile, wird nur der hoeherpriorisierte Teil gelesen. Fuer die "
    "Beschleunigungsmessung bleibt die Reihe konsistent, das NIVEAU ist dann untererfasst. "
    "Als Deckungsgrenze auszuweisen; eine Summierungs-Ableitung waere eine zweite Revision "
    "und ist ausgeschlossen."
)
neu["roles"]["dilutedShares"] = {
    "destinationFields": ["metrics.revenuePerShare"],
    "conceptPriority": [t for t, _ in DILUTED],
    "conceptRationale": {t: r for t, r in DILUTED},
    "requiredQtrs": [0, 1, 2, 3, 4],
    "derivations": ["direct_qtrs1", "direct_instant"],
    "missingRule": "NICHT BERECHENBAR - nie 0, nie geschaetzt, nie aus einer Nachbarperiode uebernommen (R5).",
    "zweck": "R10-Waechter gegen Kapitalerhoehungs-Scheinwachstum: Pflicht-Nebenrechnung Umsatz je Aktie.",
}

# --- (c) 20-F: durch Messung entschieden, nicht durch Geschmack.
neu["forms"] = list(alt["forms"])
neu["formsDecision"] = {
    "aufgenommen": neu["forms"],
    "abgelehnt": ["20-F", "20-F/A"],
    "grund": "Gemessen im Entdeckungsfenster: 98,7 % der 20-F-Firmenjahre haben genau EIN "
             "Perioden-Ende, 1,3 % haben zwei, KEIN einziger Filer erreicht drei oder mehr "
             "(459 Filer, Median 1,0; fp-Feld 3 460-mal 'FY'). 20-F-Filer berichten jaehrlich "
             "und koennen strukturell kein Quartalssignal tragen.",
    "folge": "Dokumentierte Deckungsgrenze, nicht stilles Verschlucken. 16 143 20-F-Einreichungen "
             "bleiben ausserhalb; namentlich betroffen ist NBIS (Vorgaenger Yandex). Der "
             "Deckungsgrad-Pflichtsatz weist den Anteil je Fenster aus.",
}

# --- (d) Universums-Regel
neu["universe"] = {
    "kategorieAusschluss": {"sicVon": 6000, "sicBis": 6799,
                            "grund": "Finanzintermediaere und Kapitalvehikel berichten Zins-, "
                                     "Gebuehren- und Anlageertrag, keinen Leistungsumsatz."},
    "keinWeitererSektorAusschluss": "Biotech, Bergbau und SPACs bleiben im Universum. Vor-Umsatz "
                                    "ist eine Firmen-Eigenschaft, keine Sektor-Eigenschaft "
                                    "(Beleg: LQDA laeuft unter SIC 2834 und hat durchgehend Umsatz).",
    "eintrittskriterium": ">=8 Quartale Umsatzreihe im Signalteil des Fensters (bestehend, unveraendert).",
}

# --- (e) Gate-Metrik: praezisiert, nicht gesenkt.
neu["gateMetric"] = {
    "population": "Firmen im Universum mit mindestens einem Umsatztraeger nach dieser Landkarte.",
    "schwelle": 0.90,
    "maxFensterDifferenzPunkte": 10,
    "maxRestSprung2017_2018Punkte": 5,
    "pflichtfeldDeckungsgrad": "Je Fenster ausweisen, wie viele Firmen und Einreichungen ausserhalb "
                               "des Definitionsbereichs bleiben und warum: Finanzsektor, Vor-Umsatz, 20-F.",
    "unveraendert": "Schwelle und Differenz sind gegenueber R9 NICHT gesenkt.",
}
neu["changeControl"] = alt["changeControl"]

roh = json.dumps(neu, sort_keys=True, ensure_ascii=False).encode()
neu["mapSha256"] = hashlib.sha256(roh).hexdigest()
Path(sys.argv[2]).write_text(json.dumps(neu, indent=1, ensure_ascii=False), encoding="utf-8")

print(f"Landkarte {neu['version']} eingefroren")
print(f"  Eltern              : {neu['parentVersion']}  {neu['parentSha256'][:16]}")
print(f"  Umsatz-Tags         : {len(REVENUE)} aufgenommen, {len(REVENUE_ABGELEHNT)} begruendet abgelehnt")
print(f"  dilutedShares-Kette : {len(DILUTED)} Tags")
print(f"  Formulare           : {neu['forms']}  (20-F abgelehnt, gemessen)")
print(f"  Universum           : SIC {neu['universe']['kategorieAusschluss']['sicVon']}-"
      f"{neu['universe']['kategorieAusschluss']['sicBis']} ausgeschlossen")
print(f"  mapSha256           : {neu['mapSha256']}")

# ponytail: Selbstpruefung statt Testdatei - faellt aus, wenn die Revision still etwas verliert.
assert set(alt["roles"]) <= set(neu["roles"]), "Rolle aus 1.0.0 verschwunden"
for t, _ in REVENUE:
    assert t not in REVENUE_ABGELEHNT, f"{t} steht in Whitelist UND Ablehnliste"
for t in alt["roles"]["revenue"]["conceptPriority"]:
    assert t in dict(REVENUE), f"1.0.0-Tag {t} in 1.1.0 verloren"
assert neu["gateMetric"]["schwelle"] == 0.90, "Gate-Schwelle veraendert"
print("  Selbstpruefung      : PASS (keine Rolle verloren, kein 1.0.0-Tag verloren, Gate unveraendert)")
