from AlgorithmImports import *
import hashlib
import json
from datetime import datetime


class FreeCloudMetadataPilotV4(QCAlgorithm):
    """Discovery-only metadata pilot; never exports prices, returns, holdings or alpha."""

    PILOT_CORE_SHA256 = "18719c106c7f57013d5a20b038de18e3bf4c17617fac0e01686925d2b7abc053"
    CASES_RAW_SHA256 = "78be68ce710dedf9e7165c340b733e1ec2ebe6637548d35e704aa20961fbfcd6"
    CASES = [
        ("QC-001","ACTIVE_STABLE","AAPL",[],"2009-01-01","2024-12-31"),("QC-002","ACTIVE_STABLE","MSFT",[],"2009-01-01","2024-12-31"),
        ("QC-003","ACTIVE_STABLE","IBM",[],"2009-01-01","2024-12-31"),("QC-004","ACTIVE_STABLE","INTC",[],"2009-01-01","2024-12-31"),
        ("QC-005","ACTIVE_STABLE","CSCO",[],"2009-01-01","2024-12-31"),("QC-006","ACTIVE_STABLE","ORCL",[],"2009-01-01","2024-12-31"),
        ("QC-007","ACTIVE_STABLE","NVDA",[],"2009-01-01","2024-12-31"),("QC-008","ACTIVE_STABLE","AMZN",[],"2009-01-01","2024-12-31"),
        ("QC-009","SYMBOL_CHANGE","META",["FB"],"2011-01-01","2024-12-31"),("QC-010","SYMBOL_CHANGE","ELV",["ANTM"],"2009-01-01","2024-12-31"),
        ("QC-011","SYMBOL_CHANGE","WTW",["WLTW"],"2016-01-01","2024-12-31"),("QC-012","SYMBOL_CHANGE","PARA",["VIAC","CBS"],"2009-01-01","2024-12-31"),
        ("QC-013","SYMBOL_CHANGE","GOOGL",["GOOG"],"2009-01-01","2024-12-31"),("QC-014","SYMBOL_CHANGE","ZG",["Z"],"2011-01-01","2024-12-31"),
        ("QC-015","MULTI_SHARE_CLASS","BRK.B",["BRK.A"],"2009-01-01","2024-12-31"),("QC-016","MULTI_SHARE_CLASS","FOXA",["FOX"],"2019-01-01","2024-12-31"),
        ("QC-017","MULTI_SHARE_CLASS","NWSA",["NWS"],"2013-01-01","2024-12-31"),("QC-018","MULTI_SHARE_CLASS","UAA",["UA"],"2009-01-01","2024-12-31"),
        ("QC-019","MULTI_SHARE_CLASS","DISCK",["DISCA"],"2009-01-01","2022-04-08"),("QC-020","MULTI_SHARE_CLASS","LGF.B",["LGF.A"],"2016-01-01","2024-12-31"),
        ("QC-021","CASH_MERGER","ATVI",[],"2009-01-01","2023-10-13"),("QC-022","CASH_MERGER","TWTR",[],"2013-11-07","2022-10-27"),
        ("QC-023","CASH_MERGER","CERN",[],"2009-01-01","2022-06-08"),("QC-024","CASH_MERGER","ALTR",[],"2009-01-01","2015-12-28"),
        ("QC-025","CASH_MERGER","WFM",[],"2009-01-01","2017-08-28"),("QC-026","CASH_MERGER","RHT",[],"2009-01-01","2019-07-09"),
        ("QC-027","CASH_MERGER","LNKD",[],"2011-05-19","2016-12-08"),("QC-028","CASH_MERGER","CA",[],"2009-01-01","2018-11-05"),
        ("QC-029","STOCK_OR_MIXED_MERGER","XLNX",["AMD"],"2009-01-01","2022-02-14"),("QC-030","STOCK_OR_MIXED_MERGER","CELG",["BMY"],"2009-01-01","2019-11-20"),
        ("QC-031","STOCK_OR_MIXED_MERGER","S",["TMUS"],"2009-01-01","2020-04-01"),("QC-032","STOCK_OR_MIXED_MERGER","WCG",["CNC"],"2009-01-01","2020-01-22"),
        ("QC-033","STOCK_OR_MIXED_MERGER","LVLT",["CTL","LUMN"],"2009-01-01","2017-11-01"),("QC-034","REVERSE_SPLIT","C",[],"2009-01-01","2012-12-31"),
        ("QC-035","REVERSE_SPLIT","AIG",[],"2009-01-01","2012-12-31"),("QC-036","REVERSE_SPLIT","GE",[],"2019-01-01","2022-12-31"),
        ("QC-037","REVERSE_SPLIT","DRYS",[],"2009-01-01","2019-11-01"),("QC-038","REVERSE_SPLIT","TOPS",[],"2009-01-01","2024-12-31"),
        ("QC-039","BANKRUPTCY_OTC_CONTINUATION","BBBY",["BBBYQ"],"2009-01-01","2023-09-29"),("QC-040","BANKRUPTCY_OTC_CONTINUATION","SIVB",["SIVBQ"],"2009-01-01","2023-03-10"),
        ("QC-041","BANKRUPTCY_OTC_CONTINUATION","FRC",["FRCB"],"2009-01-01","2023-05-01"),("QC-042","BANKRUPTCY_OTC_CONTINUATION","HTZ",["HTZGQ"],"2009-01-01","2021-06-30"),
        ("QC-043","BANKRUPTCY_OTC_CONTINUATION","CHK",["CHKAQ"],"2009-01-01","2021-02-09"),("QC-044","BANKRUPTCY_OTC_CONTINUATION","JCP",["JCPNQ"],"2009-01-01","2020-12-31"),
        ("QC-045","BANKRUPTCY_OTC_CONTINUATION","SHLD",["SHLDQ"],"2009-01-01","2019-02-11"),("QC-046","BANKRUPTCY_OTC_CONTINUATION","LEH",["LEHMQ"],"2009-01-01","2012-12-31"),
        ("QC-047","NO_FINAL_VISIBLE_BAR_SENTINEL","GM",["MTLQQ"],"2009-01-01","2010-11-18"),("QC-048","NO_FINAL_VISIBLE_BAR_SENTINEL","EK",["EKDKQ"],"2009-01-01","2013-09-03"),
        ("QC-049","NO_FINAL_VISIBLE_BAR_SENTINEL","BBI",["BLOAQ"],"2009-01-01","2011-09-30"),("QC-050","NO_FINAL_VISIBLE_BAR_SENTINEL","BGP",["BGPIQ"],"2009-01-01","2011-09-30")
    ]

    def initialize(self):
        self.set_start_date(2009, 1, 1)
        self.set_end_date(2024, 12, 31)
        self.set_cash(100000)
        self._rows = {}
        self._subscriptions = {}
        if len(self.CASES) != 50:
            raise ValueError("exactly 50 frozen cases are required")
        for case_id, category, query, alternates, start, end in self.CASES:
            row = {
                "caseId":case_id,"category":category,"querySymbol":query,"alternateSymbols":alternates,
                "referenceStart":start,"referenceEnd":end,"identityAssessment":"DISCOVERY_ONLY_UNRESOLVED",
                "aliasResults":[],"errors":[]
            }
            self._rows[case_id] = row
            for role, ticker in [("PRIMARY", query)] + [("ALTERNATE", x) for x in alternates]:
                alias = {
                    "role":role,"requestedTicker":ticker,"subscriptionAccepted":False,"securityIdentifier":None,
                    "barCount":0,"firstBarDate":None,"lastBarDate":None,"splitDates":[],"dividendDates":[],
                    "symbolChanges":[],"delistingEvents":[],"errors":[]
                }
                row["aliasResults"].append(alias)
                try:
                    security = self.add_equity(ticker, Resolution.DAILY, data_normalization_mode=DataNormalizationMode.RAW)
                    alias["subscriptionAccepted"] = True
                    alias["securityIdentifier"] = str(security.symbol.id)
                    self._subscriptions.setdefault(security.symbol, []).append((row, alias))
                except Exception as exc:
                    alias["errors"].append(type(exc).__name__)

    def _within(self, row):
        today = self.time.strftime("%Y-%m-%d")
        return row["referenceStart"] <= today <= row["referenceEnd"]

    def on_data(self, data):
        day = self.time.strftime("%Y-%m-%d")
        for symbol, bindings in self._subscriptions.items():
            for row, alias in bindings:
                if not self._within(row):
                    continue
                if data.bars.get(symbol) is not None:
                    alias["barCount"] += 1
                    alias["firstBarDate"] = alias["firstBarDate"] or day
                    alias["lastBarDate"] = day
                if data.splits.contains_key(symbol) and day not in alias["splitDates"]:
                    alias["splitDates"].append(day)
                if data.dividends.contains_key(symbol) and day not in alias["dividendDates"]:
                    alias["dividendDates"].append(day)
                if data.symbol_changed_events.contains_key(symbol):
                    event = data.symbol_changed_events[symbol]
                    item = {"date":day,"requestedTicker":alias["requestedTicker"],"oldSymbol":str(event.old_symbol),"newSymbol":str(event.new_symbol)}
                    if item not in alias["symbolChanges"]:
                        alias["symbolChanges"].append(item)
                if data.delistings.contains_key(symbol):
                    event = data.delistings[symbol]
                    item = {"date":day,"requestedTicker":alias["requestedTicker"],"eventType":str(event.type)}
                    if item not in alias["delistingEvents"]:
                        alias["delistingEvents"].append(item)

    def on_end_of_algorithm(self):
        rows = [self._rows[key] for key in sorted(self._rows)]
        report = {
            "schema":"early-detection-quantconnect-free-cloud-metadata-output/v4",
            "pilotCoreSha256":self.PILOT_CORE_SHA256,"casesRawSha256":self.CASES_RAW_SHA256,
            "providerRunId":str(self.get_parameter("provider-run-id") or "MISSING"),
            "executedAt":self.time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "leanVersion":str(self.get_parameter("lean-version") or "UNAVAILABLE"),
            "datasetVersion":str(self.get_parameter("dataset-version") or "UNAVAILABLE"),
            "runMode":"DISCOVERY_ONLY","caseCount":len(rows),"rows":rows,
            "outcomesAccessed":False,"priceValuesExported":False,"returnsComputed":False,"ordersSubmitted":False,
        }
        canonical = json.dumps(report, sort_keys=True, separators=(",", ":"))
        report["reportSha256"] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        self.log("QC_METADATA_V4=" + json.dumps(report, sort_keys=True, separators=(",", ":")))
