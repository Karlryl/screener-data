from AlgorithmImports import *
import hashlib
import json


class FreeCloudMetadataPilotV1(QCAlgorithm):
    """Metadata-only source qualification. Never logs prices, returns, trades or alpha."""

    CASES = []  # Paste the exact 50 frozen case rows from the bound case manifest before cloud execution.
    CONTRACT_SHA256 = "MATERIALIZE_FROM_LOCAL_VERIFIER_BEFORE_CLOUD_EXECUTION"

    def initialize(self):
        self.set_start_date(2009, 1, 1)
        self.set_end_date(2024, 12, 31)
        self.set_cash(100000)
        self._rows = {}
        if len(self.CASES) != 50:
            raise ValueError("exactly 50 frozen cases are required")
        for case in self.CASES:
            row = {
                "caseId": case["caseId"],
                "category": case["category"],
                "querySymbol": case["querySymbol"],
                "securityIdentifier": None,
                "subscriptionAccepted": False,
                "barCount": 0,
                "firstBarDate": None,
                "lastBarDate": None,
                "splitCount": 0,
                "dividendCount": 0,
                "symbolChangeCount": 0,
                "delistingWarningCount": 0,
                "delistedCount": 0,
                "errors": []
            }
            try:
                security = self.add_equity(
                    case["querySymbol"], Resolution.DAILY,
                    data_normalization_mode=DataNormalizationMode.RAW
                )
                row["subscriptionAccepted"] = True
                row["securityIdentifier"] = str(security.symbol.id)
                self._rows[security.symbol] = row
            except Exception as exc:
                row["errors"].append(type(exc).__name__)
            self._rows[case["caseId"]] = row

    def on_data(self, data):
        for symbol, row in list(self._rows.items()):
            if isinstance(symbol, str):
                continue
            bar = data.bars.get(symbol)
            if bar is not None:
                row["barCount"] += 1
                date = self.time.strftime("%Y-%m-%d")
                row["firstBarDate"] = row["firstBarDate"] or date
                row["lastBarDate"] = date
            if data.splits.contains_key(symbol):
                row["splitCount"] += 1
            if data.dividends.contains_key(symbol):
                row["dividendCount"] += 1
            if data.symbol_changed_events.contains_key(symbol):
                row["symbolChangeCount"] += 1
            if data.delistings.contains_key(symbol):
                if int(data.delistings[symbol].type) == 0:
                    row["delistingWarningCount"] += 1
                else:
                    row["delistedCount"] += 1

    def on_end_of_algorithm(self):
        rows = sorted({row["caseId"]: row for row in self._rows.values()}.values(), key=lambda x: x["caseId"])
        report = {
            "schema": "early-detection-quantconnect-free-cloud-metadata-output/v1",
            "contractSha256": self.CONTRACT_SHA256,
            "leanVersion": str(self.get_parameter("lean-version") or "UNAVAILABLE"),
            "caseCount": len(rows),
            "rows": rows,
            "outcomesAccessed": False,
            "priceValuesExported": False,
            "returnsComputed": False,
            "ordersSubmitted": False
        }
        canonical = json.dumps(report, sort_keys=True, separators=(",", ":"))
        report["reportSha256"] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        # Execution remains blocked until the terms snapshot permits this compact metadata evidence.
        self.log("QC_METADATA_V1=" + json.dumps(report, sort_keys=True, separators=(",", ":")))
