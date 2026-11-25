import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSeedBhopalHospitalPlaces,
  computeBinForecasts,
  extractBhopalLocality,
  filterBins,
  filterLedger,
  formatDurationHours,
  formatUtcTime,
  getBinStatusDisplay,
  getCategoryMeta,
  getComplianceStatusDisplay,
  isMapsQuotaError,
  parseMapboxPlaceFeatures,
  projectLatLngToSvg,
} from "./wasteLogic";
import type { DisposalManifest, SmartBin } from "../types/meditrack";

test("getCategoryMeta returns accurate CPCB treatment protocols", () => {
  assert.equal(getCategoryMeta("yellow").shortLabel, "Yellow");
  assert.match(getCategoryMeta("red").treatment, /Autoclaving/);
  assert.match(getCategoryMeta("white").fullLabel, /Sharps/);
  assert.match(getCategoryMeta("blue").fullLabel, /Glassware/);
});

test("getBinStatusDisplay provides text + symbol for non-hue-only signaling", () => {
  const overflow = getBinStatusDisplay("overflow_alert");
  assert.equal(overflow.label, "Overflow Alert");
  assert.ok(overflow.symbol.length > 0);

  const nominal = getBinStatusDisplay("nominal");
  assert.equal(nominal.label, "Nominal");
});

test("projectLatLngToSvg clamps and projects within SVG bounds", () => {
  const pt = projectLatLngToSvg(23.2106, 77.4574, 760, 420, 48);
  assert.ok(pt.x >= 48 && pt.x <= 712);
  assert.ok(pt.y >= 48 && pt.y <= 372);
});

test("filterBins filters by status and search term", () => {
  const bhopalBins: SmartBin[] = [
    {
      id: 1,
      bin_code: "BIN-A01-Y",
      facility_name: "AIIMS Bhopal",
      ward: "Trauma & Emergency OT-1",
      category: "yellow",
      fill_level: 88,
      weight_kg: 19.4,
      capacity_kg: 22,
      lid_locked: 1,
      lid_status: "locked",
      temp_c: 24.8,
      gas_ppm: 62,
      battery_pct: 91,
      lat: 23.2106,
      lng: 77.4574,
      status: "overflow_alert",
      last_updated: "2026-11-24T10:00:00Z",
    },
    {
      id: 2,
      bin_code: "BIN-D01-R",
      facility_name: "People's Hospital Bhopal",
      ward: "Post-Op Recovery Ward",
      category: "red",
      fill_level: 37,
      weight_kg: 8.5,
      capacity_kg: 25,
      lid_locked: 0,
      lid_status: "closed",
      temp_c: 21.9,
      gas_ppm: 17,
      battery_pct: 98,
      lat: 23.297,
      lng: 77.425,
      status: "nominal",
      last_updated: "2026-11-24T10:00:00Z",
    },
  ];

  assert.equal(filterBins(bhopalBins, "overflow_alert", "").length, 1);
  assert.equal(filterBins(bhopalBins, "all", "People").length, 1);
  assert.equal(filterBins(bhopalBins, "nominal", "AIIMS").length, 0);

  const forecasts = computeBinForecasts(bhopalBins);
  assert.equal(forecasts[0].bin_code, "BIN-A01-Y");
  assert.equal(forecasts[0].risk_level, "imminent");
  assert.equal(forecasts[1].risk_level, "stable");
  assert.equal(formatDurationHours(1.5), "1h 30m");
  assert.equal(formatDurationHours(0), "At capacity");
});

test("filterLedger and formatUtcTime behave deterministically", () => {
  const bhopalLedger: DisposalManifest[] = [
    {
      id: 1,
      manifest_id: "MAN-2026-8841",
      qr_payload: "MEDITRACK|MAN-2026-8841",
      bin_code: "BIN-A01-Y",
      facility_name: "AIIMS Bhopal",
      category: "yellow",
      weight_kg: 18.2,
      treatment_method: "Incineration",
      vehicle_code: "VAN-01",
      pickup_time: "2026-11-24T10:00:00Z",
      disposal_time: "2026-11-24T10:30:00Z",
      compliance_status: "verified",
      chain_hash: "ABCDEF1234567890",
    },
  ];

  assert.equal(filterLedger(bhopalLedger, "yellow", "8841").length, 1);
  assert.equal(filterLedger(bhopalLedger, "red", "").length, 0);
  assert.equal(formatUtcTime("2026-11-24T10:30:00Z"), "2026-11-24 10:30 UTC");
});

test("extractBhopalLocality, compliance display, and quota error helpers", () => {
  assert.equal(
    extractBhopalLocality([
      { longText: "Saket Nagar", types: ["sublocality_level_1", "sublocality"] },
      { longText: "Bhopal", types: ["locality"] },
    ]),
    "Saket Nagar"
  );
  assert.equal(
    extractBhopalLocality([], "MP Nagar Zone-I, Bhopal, Madhya Pradesh 462011, India"),
    "MP Nagar Zone-I"
  );
  assert.equal(getComplianceStatusDisplay("Action Required").symbol, "■");
  assert.equal(getComplianceStatusDisplay("Compliant").label, "Compliant");
  assert.equal(isMapsQuotaError(new Error("RESOURCE_EXHAUSTED 429")), true);
  assert.equal(isMapsQuotaError(new Error("ZERO_RESULTS")), false);
});

test("parseMapboxPlaceFeatures and buildSeedBhopalHospitalPlaces normalize Bhopal places", () => {
  const parsed = parseMapboxPlaceFeatures([
    {
      id: "poi.123",
      text: "AIIMS Bhopal",
      place_name: "AIIMS Bhopal, Saket Nagar, Bhopal, Madhya Pradesh 462020, India",
      center: [77.4574, 23.2106],
      context: [
        { id: "neighborhood.1", text: "Saket Nagar" },
        { id: "place.2", text: "Bhopal" },
      ],
    },
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].locality, "Saket Nagar");
  assert.equal(parsed[0].lat, 23.2106);
  assert.equal(parsed[0].lng, 77.4574);

  const seeded = buildSeedBhopalHospitalPlaces([
    {
      name: "Bansal Hospital Bhopal",
      code: "FAC-03",
      lat: 23.2031,
      lng: 77.4229,
      zone: "Sector C, Shahpura",
    },
  ]);
  assert.equal(seeded[0].id, "FAC-03");
  assert.equal(seeded[0].locality, "Sector C");
});

