import test from "node:test";
import assert from "node:assert/strict";
import {
  filterBins,
  filterLedger,
  formatUtcTime,
  getBinStatusDisplay,
  getCategoryMeta,
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
  const pt = projectLatLngToSvg(26.8467, 80.9462, 760, 420, 48);
  assert.ok(pt.x >= 48 && pt.x <= 712);
  assert.ok(pt.y >= 48 && pt.y <= 372);
});

test("filterBins filters by status and search term", () => {
  const sampleBins: SmartBin[] = [
    {
      id: 1,
      bin_code: "BIN-A01-Y",
      facility_name: "AIIMS Trauma & Ward A",
      ward: "Emergency OT-1",
      category: "yellow",
      fill_level: 88,
      weight_kg: 19.4,
      capacity_kg: 22,
      lid_locked: 1,
      lid_status: "locked",
      temp_c: 24.8,
      gas_ppm: 62,
      battery_pct: 91,
      lat: 26.8467,
      lng: 80.9462,
      status: "overflow_alert",
      last_updated: "2026-11-24T10:00:00Z",
    },
    {
      id: 2,
      bin_code: "BIN-D01-R",
      facility_name: "Metro Surgical Center",
      ward: "Post-Op Recovery",
      category: "red",
      fill_level: 37,
      weight_kg: 8.5,
      capacity_kg: 25,
      lid_locked: 0,
      lid_status: "closed",
      temp_c: 21.9,
      gas_ppm: 17,
      battery_pct: 98,
      lat: 26.824,
      lng: 80.9315,
      status: "nominal",
      last_updated: "2026-11-24T10:00:00Z",
    },
  ];

  assert.equal(filterBins(sampleBins, "overflow_alert", "").length, 1);
  assert.equal(filterBins(sampleBins, "all", "Metro").length, 1);
  assert.equal(filterBins(sampleBins, "nominal", "AIIMS").length, 0);
});

test("filterLedger and formatUtcTime behave deterministically", () => {
  const sampleLedger: DisposalManifest[] = [
    {
      id: 1,
      manifest_id: "MAN-2026-8841",
      qr_payload: "MEDITRACK|MAN-2026-8841",
      bin_code: "BIN-A01-Y",
      facility_name: "AIIMS Trauma & Ward A",
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

  assert.equal(filterLedger(sampleLedger, "yellow", "8841").length, 1);
  assert.equal(filterLedger(sampleLedger, "red", "").length, 0);
  assert.equal(formatUtcTime("2026-11-24T10:30:00Z"), "2026-11-24 10:30 UTC");
});
