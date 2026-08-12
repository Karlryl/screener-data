from AlgorithmImports import *
import base64
import hashlib
import json
import zlib
from datetime import datetime, timezone


class FreeCloudMetadataPilotV6(QCAlgorithm):
    """Compact discovery metadata only; no values, returns, holdings, or study results."""

    PILOT_CORE_SHA256 = "7198765a2a6a88ddc7831ab9e59425921a9e7da226924fd50a5cc7f3341dbd13"
    CASES_RAW_SHA256 = "78be68ce710dedf9e7165c340b733e1ec2ebe6637548d35e704aa20961fbfcd6"
    EXPECTED_LEAN_VERSION = "2.5.0.0.17996"
    DATASET_LABEL = "QUANTCONNECT_US_EQUITY_SECURITY_MASTER_PLUS_US_EQUITIES"
    DATASET_VERSION_STATUS = "PROVIDER_DATASET_UNVERSIONED"
    MAX_LOG_BYTES_EXCLUSIVE = 7000
    EVENT_DIGEST_BYTES = 24
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

    @staticmethod
    def _canonical(value):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")

    @staticmethod
    def _b64(raw):
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    def initialize(self):
        self.set_start_date(2009, 1, 1)
        self.set_end_date(2024, 12, 31)
        self._rows = []
        self._subscriptions = {}
        if len(self.CASES) != 50:
            raise ValueError("exactly 50 frozen cases are required")
        for case_id, category, query, alternates, start, end in self.CASES:
            row = {
                "caseId": case_id, "category": category, "querySymbol": query,
                "alternateSymbols": alternates, "referenceStart": start, "referenceEnd": end,
                "aliases": [],
            }
            self._rows.append(row)
            for ticker in [query] + list(alternates):
                alias = {
                    "accepted": False, "securityIdentifier": None, "observationCount": 0,
                    "firstObservationDate": None, "lastObservationDate": None,
                    "eventCounts": [0, 0, 0, 0],
                    "eventHashers": [hashlib.sha256() for _ in range(4)], "errors": [],
                }
                row["aliases"].append(alias)
                try:
                    security = self.add_equity(
                        ticker, Resolution.DAILY, data_normalization_mode=DataNormalizationMode.RAW
                    )
                    alias["accepted"] = True
                    alias["securityIdentifier"] = str(security.symbol.id)
                    self._subscriptions.setdefault(security.symbol, []).append((row, alias))
                except Exception as exc:
                    alias["errors"].append(type(exc).__name__)

    def _within(self, row):
        day = self.time.strftime("%Y-%m-%d")
        return row["referenceStart"] <= day <= row["referenceEnd"]

    def _record_event(self, alias, event_index, event_record):
        encoded = self._canonical(event_record)
        alias["eventHashers"][event_index].update(len(encoded).to_bytes(4, "big"))
        alias["eventHashers"][event_index].update(encoded)
        alias["eventCounts"][event_index] += 1

    def on_data(self, data):
        day = self.time.strftime("%Y-%m-%d")
        for symbol, bindings in self._subscriptions.items():
            for row, alias in bindings:
                if not self._within(row):
                    continue
                if data.bars.get(symbol) is not None:
                    alias["observationCount"] += 1
                    alias["firstObservationDate"] = alias["firstObservationDate"] or day
                    alias["lastObservationDate"] = day
                if data.splits.contains_key(symbol):
                    event = data.splits[symbol]
                    self._record_event(alias, 0, [day, str(event.type)])
                if data.dividends.contains_key(symbol):
                    self._record_event(alias, 1, [day, "DIVIDEND_EVENT"])
                if data.symbol_changed_events.contains_key(symbol):
                    event = data.symbol_changed_events[symbol]
                    self._record_event(alias, 2, [day, str(event.old_symbol), str(event.new_symbol)])
                if data.delistings.contains_key(symbol):
                    event = data.delistings[symbol]
                    self._record_event(alias, 3, [day, str(event.type)])

    def on_end_of_algorithm(self):
        case_rows = []
        event_hash_bytes = bytearray()
        event_hash_count = 0
        for row in self._rows:
            alias_rows = []
            for alias in row["aliases"]:
                for index, count in enumerate(alias["eventCounts"]):
                    if count:
                        event_hash_bytes.extend(alias["eventHashers"][index].digest()[:self.EVENT_DIGEST_BYTES])
                        event_hash_count += 1
                alias_rows.append([
                    alias["accepted"], alias["securityIdentifier"], alias["observationCount"],
                    alias["firstObservationDate"], alias["lastObservationDate"],
                    alias["eventCounts"], sorted(set(alias["errors"])),
                ])
            case_rows.append([row["caseId"], alias_rows])
        payload_raw = self._canonical({"caseRows": case_rows})
        payload = self._b64(zlib.compress(payload_raw, 9))
        now = datetime.now(timezone.utc)
        report = {
            "schema": "early-detection-quantconnect-free-cloud-metadata-output/v6",
            "pilotCoreSha256": self.PILOT_CORE_SHA256,
            "casesRawSha256": self.CASES_RAW_SHA256,
            "providerRunId": str(self.get_parameter("provider-run-id") or "MISSING"),
            "executedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "leanVersion": str(self.get_parameter("lean-version") or "MISSING"),
            "dataset": {
                "label": self.DATASET_LABEL,
                "versionStatus": self.DATASET_VERSION_STATUS,
                "retrievedOn": now.strftime("%Y-%m-%d"),
            },
            "payloadEncoding": "ZLIB9_BASE64URL_CANONICAL_JSON",
            "payloadRawSha256": hashlib.sha256(payload_raw).hexdigest(),
            "payload": payload,
            "eventSequenceHashEncoding": "SHA256_TRUNC192_RAW_CONCAT_BASE64URL_ORDERED_V1",
            "eventSequenceHashCount": event_hash_count,
            "eventSequenceHashes": self._b64(bytes(event_hash_bytes)),
            "claimLocks": {
                "identityResolved": False, "terminalWealthComplete": False,
                "originalV4GateCredit": False, "outcomesAccessed": False,
                "priceValuesExported": False, "returnsComputed": False, "ordersSubmitted": False,
            },
        }
        report["reportSha256"] = hashlib.sha256(self._canonical(report)).hexdigest()
        line = "QC_METADATA_V6=" + self._canonical(report).decode("utf-8")
        if len(line.encode("utf-8")) >= self.MAX_LOG_BYTES_EXCLUSIVE:
            raise ValueError("compact metadata log reached the fail-closed size ceiling")
        self.log(line)
