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
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
