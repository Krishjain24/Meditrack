import test from "node:test";
import assert from "node:assert/strict";
import {
  BLUEPRINT_LIMITS,
  buildDashboardPayloadFromRecords,
  buildDisposalLedgerCsv,
  buildFacilityComplianceCsv,
  buildSeedWorkspaceData,
  classifyWasteItemLocal,
  computeOptimizedRoutePlan,
  computeSha256Hex,
  sanitizeIdCode,
} from "./dashboardBuilder";

test("classifyWasteItemLocal classifies all four CPCB biomedical categories", () => {
  assert.equal(classifyWasteItemLocal("Blood-Soaked Surgical Gauze", "Post-op dressing").category, "yellow");
  assert.equal(classifyWasteItemLocal("Used IV Tubing & Saline Bag", "PVC polymer").category, "red");
  assert.equal(classifyWasteItemLocal("22G Hypodermic Needle & Scalpel", "Sharps").category, "white");
  assert.equal(classifyWasteItemLocal("Discarded Glass Ampoule", "Medicine vial").category, "blue");
});

test("buildDashboardPayloadFromRecords aggregates KPIs, breakdowns, trends, and compliance", () => {
  const seed = buildSeedWorkspaceData("2026-11-26T12:00:00+00:00");
  const ledger = seed.ledgerTemplates.map((l, idx) => ({
    id: idx + 1,
    manifest_id: l.manifest_id,
    qr_payload: l.qr_payload,
    bin_code: l.bin_code,
    facility_name: l.facility_name,
    category: l.category,
    weight_kg: l.weight_kg,
    treatment_method: l.treatment_method,
    vehicle_code: l.vehicle_code,
    pickup_time: l.pickup_time,
    disposal_time: l.disposal_time,
    compliance_status: l.compliance_status,
    chain_hash: "ABCDEF0123456789",
  }));

  const payload = buildDashboardPayloadFromRecords({
    bins: seed.bins,
    alerts: seed.alerts,
    vehicles: seed.vehicles,
    events: seed.events,
    ledger,
  });

  assert.equal(payload.kpis.total_bins, 12);
  assert.equal(payload.kpis.overflow_bins, 4);
  assert.equal(payload.kpis.pending_alerts, 4);
  assert.equal(payload.kpis.verified_disposals, 4);
  assert.equal(payload.facilities.length, 4);
  assert.equal(payload.daily_trends.length, 7);
  assert.equal(payload.facility_compliance?.length, 4);
});

test("computeOptimizedRoutePlan assigns nearest vehicle and computes distance savings", () => {
  const seed = buildSeedWorkspaceData("2026-11-26T12:00:00+00:00");
  const { plan, chosenVehicle } = computeOptimizedRoutePlan(
    seed.bins,
    seed.alerts,
    seed.vehicles
  );
  assert.ok(chosenVehicle);
  assert.equal(plan.optimized, true);
  assert.equal(plan.stops.length, 4);
  assert.ok(plan.total_distance_km > 0);
  assert.ok(plan.distance_saved_km > 0);
  assert.ok(plan.stops.length <= BLUEPRINT_LIMITS.ASSIGNED_ROUTE_MAX);
});

test("computeSha256Hex, sanitizeIdCode, and CSV builders produce deterministic valid outputs", async () => {
  const hash1 = await computeSha256Hex("MEDITRACK|MAN-1|BIN-A01-Y");
  const hash2 = await computeSha256Hex("MEDITRACK|MAN-1|BIN-A01-Y");
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 16);
  assert.match(sanitizeIdCode("bin a04 / ward!", "BIN-DEF"), /^[A-Z0-9_-]+$/);

  const seed = buildSeedWorkspaceData("2026-11-26T12:00:00+00:00");
  const payload = buildDashboardPayloadFromRecords({
    bins: seed.bins,
    alerts: seed.alerts,
    vehicles: seed.vehicles,
    events: seed.events,
    ledger: [],
  });
  const facCsv = buildFacilityComplianceCsv(payload.facility_compliance || []);
  assert.ok(facCsv.includes("AIIMS Bhopal"));
  const ledCsv = buildDisposalLedgerCsv([]);
  assert.ok(ledCsv.startsWith("Manifest ID,"));
});
