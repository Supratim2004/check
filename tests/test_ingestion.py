import shutil
import tempfile
import unittest
from pathlib import Path
from urllib.parse import quote

from app import app
from data import DataError, load_district, number, _load_district

SOURCE = Path(__file__).resolve().parents[1] / "Data" / "Purba Medinipur"

class IngestionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for district, source in [("District A", "Monthly_CJM.xlsx"), ("District B", "Monthly_DJ.xlsx")]:
            folder = self.root / district
            folder.mkdir()
            shutil.copyfile(SOURCE / source, folder / "Monthly_CJM.xlsx")
        self.previous = app.config["DATA_DIR"]
        app.config["DATA_DIR"] = str(self.root)
        self.client = app.test_client()

    def tearDown(self):
        app.config["DATA_DIR"] = self.previous
        _load_district.cache_clear()
        self.temp.cleanup()

    def test_discovery_and_district_isolation(self):
        self.assertEqual(len(self.client.get("/api/districts").json["districts"]), 2)
        a = self.client.get("/api/districts/District%20A/court/CJM").json
        b = self.client.get("/api/districts/District%20B/court/CJM").json
        self.assertEqual(a["arrivals"][0]["filings"], 31136)
        self.assertEqual(b["arrivals"][0]["filings"], 20372)
        self.assertNotEqual(a["full_name"], b["full_name"])
        self.assertEqual(self.client.get("/api/court/CJM?district=District%20B").json, b)
        page = self.client.get("/?district=District%20B")
        self.assertEqual(page.status_code, 200)
        self.assertIn(b'District B Courts', page.data)

    def test_real_monthly_panel_and_complete_register(self):
        data = load_district(self.root, "District A")["courts"]["CJM"]
        self.assertEqual(len(data["arrivals"]), 26)
        self.assertEqual(sum(a["filings"] for a in data["arrivals"]), 61638)
        for row in data["arrivals"]:
            if row["case_type"] in data["arrival_series"]:
                self.assertEqual(sum(data["arrival_series"][row["case_type"]]), row["filings"])
        trend = self.client.get("/api/court/CJM/trend?district=District%20A").json
        self.assertEqual(trend["values"][:3], [59, 55, 67])
        self.assertEqual((trend["labels"][0], trend["labels"][-1]), ("2010-01", "2026-06"))
        self.assertEqual(len(trend["values"]), 198)
        self.assertTrue(trend["available"])

    def test_hearing_rate_tables_are_ingested(self):
        data = load_district(self.root, "District A")["courts"]["CJM"]
        self.assertGreater(len(data["hearing_rate_monthly"]), 0)
        self.assertGreater(len(data["hearing_rate_casewise"]), 0)
        self.assertIn("wd_median", data["hearing_rate_casewise"][0])

    def test_refresh_and_lock_files(self):
        first = load_district(self.root, "District A")
        self.assertIs(first, load_district(self.root, "District A"))
        (self.root / "District A" / "~$Monthly_other.xlsx").write_text("Excel lock")
        self.assertEqual(len(load_district(self.root, "District A")["courts"]), 1)
        shutil.copyfile(SOURCE / "Monthly_DJ.xlsx", self.root / "District A" / "Monthly_CJM.xlsx")
        updated = load_district(self.root, "District A")
        self.assertNotEqual(first["courts"]["CJM"]["full_name"], updated["courts"]["CJM"]["full_name"])

    def test_bad_workbook_and_unknown_selection(self):
        self.assertEqual(self.client.get("/api/meta?district=missing").status_code, 404)
        self.assertEqual(self.client.get("/api/court/missing").status_code, 404)
        (self.root / "District A" / "Monthly_CJM.xlsx").write_text("invalid")
        response = self.client.get("/api/meta?district=District%20A")
        self.assertEqual(response.status_code, 503)
        self.assertIn("Monthly_CJM.xlsx", response.json["error"])
        self.assertEqual(self.client.get("/api/meta?district=District%20B").status_code, 200)

    def test_missing_values_preserve_zero(self):
        self.assertIsNone(number("—", "test", optional=True))
        self.assertEqual(number(0, "test", optional=True), 0)
        for invalid in [None, -1, float("nan"), "not a number", True]:
            with self.assertRaises(DataError):
                number(invalid, "test")

    def test_all_source_courts_and_empty_root(self):
        app.config["DATA_DIR"] = str(SOURCE.parent)
        meta = self.client.get("/api/meta").json
        self.assertEqual(meta["grand_total_filings"], 142240)
        for code in meta["court_totals"]:
            for suffix in ["", "/trend", "/insights"]:
                response = self.client.get("/api/court/" + quote(code) + suffix)
                self.assertEqual(response.status_code, 200)
        app.config["DATA_DIR"] = str(self.root / "missing")
        self.assertEqual(self.client.get("/api/meta").status_code, 503)

if __name__ == "__main__":
    unittest.main()
