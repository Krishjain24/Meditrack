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

    def test_mapbox_parsers(self) -> None:
        features = [
            {
                "id": "poi.1001",
                "text": "Hamidia Hospital",
                "place_name": "Hamidia Hospital, Royal Market, Bhopal, Madhya Pradesh 462001, India",
                "center": [77.402, 23.2585],
                "context": [
                    {"id": "neighborhood.10", "text": "Royal Market"},
                    {"id": "place.20", "text": "Bhopal"},
                ],
                "properties": {"category": "hospital"},
            }
        ]
        parsed = meditrack_app.parse_mapbox_geocode_features(features)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["locality"], "Royal Market")
        self.assertEqual(parsed[0]["lat"], 23.2585)
        self.assertEqual(parsed[0]["lng"], 77.402)

        directions = meditrack_app.normalize_mapbox_directions(
            {
                "routes": [
                    {
                        "distance": 12450,
                        "duration": 1620,
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[77.4574, 23.2106], [77.402, 23.2585]],
                        },
                        "legs": [
                            {
                                "steps": [
                                    {
                                        "distance": 1450,
                                        "maneuver": {"instruction": "Head north toward Link Road"},
                                    }
                                ]
                            }
                        ],
                    }
                ]
            }
        )
        self.assertEqual(directions["distanceKm"], 12.4)
        self.assertEqual(directions["durationMin"], 27)
        self.assertEqual(directions["steps"][0]["distanceText"], "1.4 km")

    def test_visitor_registration_returning_and_gps_consent_lifecycle(self) -> None:
        import visitor_intelligence as vi
        from unittest.mock import patch

        conn = meditrack_app.get_conn(self.db_path)
        try:
            # 1. New visitor registers without GPS yet (and with mocked IP geo fallback)
            mocked_ip_geo = {
                "country": "India",
                "region": "Madhya Pradesh",
                "city": "Bhopal",
                "latitude": 23.2599,
                "longitude": 77.4126,
            }
            with patch.object(vi, "lookup_ip_location", return_value=mocked_ip_geo):
                reg1 = vi.register_visit(
                    conn,
                    {
                        "landing_page": "/?tab=overview",
                        "page_title": "MediTrack Overview",
                        "referrer_source": "https://google.com/search?q=meditrack",
                    },
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36",
                    "49.36.120.10",
                )
            self.assertFalse(reg1["is_returning"])
            self.assertEqual(reg1["location_source"], "ip")
            vid = reg1["visitor_id"]
            sid1 = reg1["session_id"]

            # Raw IP must never be stored in visitor_sessions
            sess_row = conn.execute("SELECT * FROM visitor_sessions WHERE session_id = ?", (sid1,)).fetchone()
            self.assertNotIn("49.36.120.10", dict(sess_row).values())
            self.assertEqual(sess_row["referrer_source"], "google.com")
            self.assertEqual(sess_row["browser"], "Chrome")
            self.assertEqual(sess_row["device_category"], "desktop")

            # 2. Recording GPS without explicit consent must be rejected
            with self.assertRaises(PermissionError):
                vi.record_gps_location(
                    conn,
                    {"visitor_id": vid, "session_id": sid1, "latitude": 23.2106, "longitude": 77.4574},
                    "49.36.120.10",
                )

            # 3. Granting GPS consent saves precise coordinates and overrides IP location
            vi.update_visitor_consent(
                conn,
                {"visitor_id": vid, "session_id": sid1, "consent_type": "gps", "status": "granted"},
                "49.36.120.10",
            )
            gps_res = vi.record_gps_location(
                conn,
                {
                    "visitor_id": vid,
                    "session_id": sid1,
                    "latitude": 23.2106,
                    "longitude": 77.4574,
                    "accuracy_m": 14.2,
                },
                "49.36.120.10",
            )
            self.assertEqual(gps_res["location_source"], "gps")
            self.assertEqual(gps_res["accuracy_m"], 14.2)

            # 4. Continuous GPS requires separate explicit consent
            with self.assertRaises(PermissionError):
                vi.record_gps_location(
                    conn,
                    {
                        "visitor_id": vid,
                        "session_id": sid1,
                        "latitude": 23.211,
                        "longitude": 77.458,
                        "is_continuous": True,
                    },
                    "49.36.120.10",
                )

            # 5. Returning visitor with same visitor_id but new session_id is flagged returning
            with patch.object(vi, "lookup_ip_location", return_value=None):
                reg2 = vi.register_visit(
                    conn,
                    {"visitor_id": vid, "landing_page": "/?tab=routes"},
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile Safari/604.1",
                    "49.36.120.10",
                )
            self.assertTrue(reg2["is_returning"])

            # 6. Revoking GPS consent wipes stored GPS coordinates cleanly
            rev_res = vi.update_visitor_consent(
                conn,
                {"visitor_id": vid, "session_id": sid1, "consent_type": "gps", "status": "revoked"},
                "49.36.120.10",
            )
            self.assertEqual(rev_res["gps_consent_status"], "revoked")
            cleared_sess = conn.execute("SELECT * FROM visitor_sessions WHERE session_id = ?", (sid1,)).fetchone()
            self.assertIsNone(cleared_sess["latitude"])
            self.assertIsNone(cleared_sess["longitude"])
            self.assertEqual(cleared_sess["location_source"], "none")
        finally:
            conn.close()

    def test_admin_auth_analytics_csv_and_retention(self) -> None:
        import visitor_intelligence as vi
        from unittest.mock import patch

        conn = meditrack_app.get_conn(self.db_path)
        try:
            # Unauthorized token check fails
            self.assertIsNone(vi.verify_admin_bearer(conn, None))
            self.assertIsNone(vi.verify_admin_bearer(conn, "Bearer invalid-token"))

            # First-run setup creates scrypt hash and issues session token
            old_env = os.environ.pop("ADMIN_PASSCODE", None)
            try:
                setup = vi.setup_initial_admin(conn, "SecureAdmin2026!")
                self.assertIn("token", setup)
                verified = vi.verify_admin_bearer(conn, f"Bearer {setup['token']}")
                self.assertIsNotNone(verified)

                # Bad password rejected, good password works
                code_bad, _ = vi.login_admin(conn, "wrong-pass", "test-ip-hash")
                self.assertEqual(code_bad, 401)
                code_ok, login_ok = vi.login_admin(conn, "SecureAdmin2026!", "test-ip-hash")
                self.assertEqual(code_ok, 200)
                self.assertIsNotNone(vi.verify_admin_bearer(conn, f"Bearer {login_ok['token']}"))
            finally:
                if old_env is not None:
                    os.environ["ADMIN_PASSCODE"] = old_env

            # Seed 2 visitors (1 GPS, 1 IP) and check overview, analytics, map, filters, CSV, retention
            with patch.object(
                vi,
                "lookup_ip_location",
                return_value={"country": "India", "region": "MP", "city": "Indore", "latitude": 22.7196, "longitude": 75.8577},
            ):
                v_ip = vi.register_visit(conn, {"landing_page": "/?tab=overview"}, "Mozilla/5.0 Firefox/130.0", "103.21.124.5")
                v_gps = vi.register_visit(conn, {"landing_page": "/?tab=routes"}, "Mozilla/5.0 Chrome/131.0", "103.21.124.6")

            vi.record_gps_location(
                conn,
                {
                    "visitor_id": v_gps["visitor_id"],
                    "session_id": v_gps["session_id"],
                    "latitude": 23.2599,
                    "longitude": 77.4126,
                    "accuracy_m": 12.0,
                    "consent_granted": True,
                    "city": "Bhopal",
                    "region": "Madhya Pradesh",
                    "country": "India",
                },
                "103.21.124.6",
            )
            vi.record_page_view_or_heartbeat(
                conn,
                {
                    "visitor_id": v_gps["visitor_id"],
                    "session_id": v_gps["session_id"],
                    "event_type": "pageview",
                    "page_path": "/?tab=compliance",
                    "duration_sec": 45,
                },
            )

            ov = vi.build_admin_overview(conn)
            self.assertEqual(ov["kpis"]["unique_visitors"], 2)
            self.assertEqual(ov["kpis"]["gps_visitors"], 1)
            self.assertEqual(ov["kpis"]["ip_visitors"], 1)
            self.assertGreaterEqual(ov["kpis"]["total_page_views"], 3)

            m = vi.build_admin_map_points(conn)
            self.assertEqual(len(m["markers"]), 2)
            sources = {pt["visitor_id"]: pt["location_source"] for pt in m["markers"]}
            self.assertEqual(sources[v_gps["visitor_id"]], "gps")
            self.assertEqual(sources[v_ip["visitor_id"]], "ip")

            filtered = vi.list_admin_visitors(conn, {"source": ["gps"], "search": ["Bhopal"]})
            self.assertEqual(filtered["total"], 1)
            self.assertEqual(filtered["records"][0]["visitor_id"], v_gps["visitor_id"])

            analytics = vi.build_admin_analytics(conn)
            self.assertGreaterEqual(len(analytics["daily_traffic"]), 1)
            self.assertGreaterEqual(len(analytics["top_pages"]), 1)

            csv_out = vi.export_visitors_csv(conn, {})
            self.assertIn("GPS (Consented)", csv_out)
            self.assertIn("IP Estimate (Approximate)", csv_out)

            # Data retention prunes backdated sessions & profile
            conn.execute(
                "UPDATE visitor_sessions SET last_active_at = '2020-01-01T00:00:00+00:00' WHERE visitor_id = ?",
                (v_ip["visitor_id"],),
            )
            conn.execute(
                "UPDATE visitor_profiles SET last_seen_at = '2020-01-01T00:00:00+00:00' WHERE visitor_id = ?",
                (v_ip["visitor_id"],),
            )
            conn.execute(
                "UPDATE visitor_location_events SET recorded_at = '2020-01-01T00:00:00+00:00' WHERE visitor_id = ?",
                (v_ip["visitor_id"],),
            )
            conn.commit()
            pruned = vi.prune_old_visitor_data(conn, 30)
            self.assertGreaterEqual(pruned, 1)
            self.assertIsNone(vi.get_admin_visitor_detail(conn, v_ip["visitor_id"]))
        finally:
            conn.close()

    def test_ssrf_and_configurable_ip_geo_safety(self) -> None:
        import visitor_intelligence as vi

        self.assertFalse(vi.is_safe_public_https_url("http://ipwho.is/8.8.8.8"))
        self.assertFalse(vi.is_safe_public_https_url("https://127.0.0.1/geo"))
        self.assertFalse(vi.is_safe_public_https_url("https://169.254.169.254/latest/meta-data"))
        self.assertFalse(vi.is_safe_public_https_url("https://10.0.0.5/geo"))
        self.assertTrue(vi.is_safe_public_https_url("https://ipwho.is/8.8.8.8"))

        # Private/loopback client IP never triggers external geolocation lookup
        self.assertIsNone(vi.build_ip_geo_url("ipwhois", "127.0.0.1"))
        self.assertIsNone(vi.build_ip_geo_url("ipwhois", "192.168.1.5"))
        self.assertEqual(vi.build_ip_geo_url("ipwhois", "8.8.8.8"), "https://ipwho.is/8.8.8.8")
        self.assertEqual(vi.build_ip_geo_url("ipapi", "8.8.8.8"), "https://ipapi.co/8.8.8.8/json/")
        self.assertIsNone(vi.build_ip_geo_url("disabled", "8.8.8.8"))


if __name__ == "__main__":
    unittest.main()
