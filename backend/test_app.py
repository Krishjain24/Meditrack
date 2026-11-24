#!/usr/bin/env python3
"""Unit tests for MediTrack Python backend core logic."""

import os
import tempfile
import unittest

import app as meditrack_app


class MediTrackPythonTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmp_dir.name, "test_meditrack.db")
        meditrack_app.init_db(self.db_path)

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    def test_waste_classification_categories(self) -> None:
        y = meditrack_app.classify_waste_item("Blood-soaked surgical gauze")
        self.assertEqual(y["category"], "yellow")
        r = meditrack_app.classify_waste_item("Used IV infusion tubing and saline bag")
        self.assertEqual(r["category"], "red")
        w = meditrack_app.classify_waste_item("22G hypodermic needle and scalpel blade")
        self.assertEqual(w["category"], "white")
        b = meditrack_app.classify_waste_item("Broken medicine glass ampoule")
        self.assertEqual(b["category"], "blue")

    def test_route_optimization_and_collection_flow(self) -> None:
        conn = meditrack_app.get_conn(self.db_path)
        try:
            plan = meditrack_app.optimize_collection_routes(conn)
            self.assertTrue(plan["optimized"])
            self.assertGreaterEqual(len(plan["stops"]), 4)
            self.assertGreater(plan["baseline_distance_km"], plan["total_distance_km"])

            first_bin = plan["stops"][0]["bin_code"]
            res = meditrack_app.complete_bin_collection(conn, first_bin, plan["vehicle_code"])
            self.assertTrue(res["collected"])
            self.assertIsNotNone(res["manifest"])
            self.assertEqual(res["manifest"]["compliance_status"], "verified")

            bin_row = conn.execute("SELECT * FROM smart_bins WHERE bin_code = ?", (first_bin,)).fetchone()
            self.assertEqual(bin_row["fill_level"], 0.0)
            self.assertEqual(bin_row["status"], "nominal")
        finally:
            conn.close()

    def test_overflow_alert_threshold_and_csv(self) -> None:
        conn = meditrack_app.get_conn(self.db_path)
        try:
            bin_row = meditrack_app.row_to_dict(
                conn.execute("SELECT * FROM smart_bins WHERE bin_code = 'BIN-D03-W'").fetchone()
            )
            self.assertIsNone(meditrack_app.create_alert_if_needed(conn, bin_row, "UnitTest"))
            bin_row["fill_level"] = 84.0
            alert = meditrack_app.create_alert_if_needed(conn, bin_row, "UnitTest")
            self.assertIsNotNone(alert)
            self.assertEqual(alert["priority"], "high")

            csv_text = meditrack_app.generate_cpcb_csv(conn)
            self.assertIn("Manifest ID", csv_text)
            self.assertIn("MAN-2026-", csv_text)
        finally:
            conn.close()

    def test_dashboard_trends_and_predictive_alerts(self) -> None:
        conn = meditrack_app.get_conn(self.db_path)
        try:
            payload = meditrack_app.build_dashboard_payload(conn)
            self.assertEqual(len(payload["daily_trends"]), 7)
            self.assertGreater(payload["daily_trends"][-1]["total_kg"], 0)
            self.assertGreaterEqual(len(payload["predictive_alerts"]), 1)
            first_forecast = payload["predictive_alerts"][0]
            self.assertIn("hours_to_full", first_forecast)
            self.assertIn(first_forecast["risk_level"], ("imminent", "upcoming", "stable"))
            self.assertEqual(len(payload["facility_compliance"]), 4)
        finally:
            conn.close()

    def test_facility_compliance_status_and_csv(self) -> None:
        conn = meditrack_app.get_conn(self.db_path)
        try:
            csv_text = meditrack_app.generate_facility_compliance_csv(conn)
            self.assertIn("Facility Code", csv_text)
            self.assertIn("CPCB Compliance Status", csv_text)
            self.assertIn("FAC-01", csv_text)
            self.assertIn("AIIMS Bhopal", csv_text)
            self.assertIn("Hamidia Hospital (GMC Bhopal)", csv_text)
            self.assertIn("Bansal Hospital Bhopal", csv_text)
            self.assertIn("People's Hospital Bhopal", csv_text)
            self.assertIn("Action Required", csv_text)
        finally:
            conn.close()

    def test_real_bhopal_facilities_and_legacy_migration(self) -> None:
        conn = meditrack_app.get_conn(self.db_path)
        try:
            payload = meditrack_app.build_dashboard_payload(conn)
            names = [f["name"] for f in payload["facilities"]]
            self.assertEqual(
                names,
                [
                    "AIIMS Bhopal",
                    "Hamidia Hospital (GMC Bhopal)",
                    "Bansal Hospital Bhopal",
                    "People's Hospital Bhopal",
                ],
            )
            self.assertEqual(
                payload["treatment_plant"]["name"],
                "Bhopal Incinerators Ltd. (CBWTF Govindpura)",
            )
            # Simulate legacy placeholder rows and verify init_db migrates cleanly
            conn.execute(
                "UPDATE smart_bins SET facility_name = 'City General ICU Block' WHERE bin_code = 'BIN-B01-Y'"
            )
            conn.commit()
        finally:
            conn.close()

        meditrack_app.init_db(self.db_path)
        conn2 = meditrack_app.get_conn(self.db_path)
        try:
            legacy_count = conn2.execute(
                "SELECT COUNT(*) FROM smart_bins WHERE facility_name = 'City General ICU Block'"
            ).fetchone()[0]
            self.assertEqual(legacy_count, 0)
            bhopal_count = conn2.execute(
                "SELECT COUNT(*) FROM smart_bins WHERE facility_name = 'Hamidia Hospital (GMC Bhopal)'"
            ).fetchone()[0]
            self.assertGreater(bhopal_count, 0)
        finally:
            conn2.close()


if __name__ == "__main__":
    unittest.main()
