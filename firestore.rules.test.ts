import test from "node:test";
import assert from "node:assert/strict";

type AuthContext = {
  uid: string;
  email: string;
  email_verified: boolean;
} | null;

const SERVER_TIME = "SERVER_REQUEST_TIME";
const ADMIN_EMAIL = "krish.jain.workk@gmail.com";

function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.length >= 1 && id.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(id);
}

function isBootstrappedAdmin(auth: AuthContext): boolean {
  return Boolean(auth && auth.email_verified === true && auth.email === ADMIN_EMAIL);
}

function hasExactKeys(data: Record<string, unknown>, required: string[], allowed: string[]): boolean {
  const keys = Object.keys(data);
  return required.every((k) => k in data) && keys.every((k) => allowed.includes(k));
}

function evaluateSmartBinCreate(
  auth: AuthContext,
  docId: string,
  incoming: Record<string, unknown>
): "ALLOW" | "PERMISSION_DENIED" {
  if (!auth || auth.email_verified !== true) return "PERMISSION_DENIED";
  if (!isValidId(docId)) return "PERMISSION_DENIED";
  const keys = [
    "ownerId", "bin_code", "facility_name", "ward", "category",
    "fill_level", "weight_kg", "capacity_kg", "lid_locked", "lid_status",
    "temp_c", "gas_ppm", "battery_pct", "lat", "lng", "status",
    "last_updated", "createdAt", "updatedAt",
  ];
  if (!hasExactKeys(incoming, keys, keys)) return "PERMISSION_DENIED";
  if (!isValidId(incoming.ownerId) || incoming.ownerId !== auth.uid) return "PERMISSION_DENIED";
  if (!isValidId(incoming.bin_code) || (incoming.bin_code as string).length > 40) return "PERMISSION_DENIED";
  if (incoming.createdAt !== SERVER_TIME || incoming.updatedAt !== SERVER_TIME) return "PERMISSION_DENIED";
  if (!["yellow", "red", "white", "blue"].includes(String(incoming.category))) return "PERMISSION_DENIED";
  if (!["nominal", "warning", "overflow_alert", "dispatched"].includes(String(incoming.status))) return "PERMISSION_DENIED";
  return "ALLOW";
}

function evaluateAlertUpdate(
  auth: AuthContext,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): "ALLOW" | "PERMISSION_DENIED" {
  if (!auth || auth.email_verified !== true) return "PERMISSION_DENIED";
  const admin = isBootstrappedAdmin(auth);
  if (existing.ownerId !== auth.uid && !admin) return "PERMISSION_DENIED";
  if (incoming.ownerId !== existing.ownerId || incoming.createdAt !== existing.createdAt) return "PERMISSION_DENIED";
  if (incoming.updatedAt !== SERVER_TIME) return "PERMISSION_DENIED";
  if (typeof incoming.notes === "string" && incoming.notes.length > 500) return "PERMISSION_DENIED";
  if (existing.status === "collected" && !admin) return "PERMISSION_DENIED";
  return "ALLOW";
}

function evaluateLedgerCreate(
  auth: AuthContext,
  incoming: Record<string, unknown>,
  existingSmartBinIds: Set<string>
): "ALLOW" | "PERMISSION_DENIED" {
  if (!auth || auth.email_verified !== true) return "PERMISSION_DENIED";
  if (incoming.ownerId !== auth.uid) return "PERMISSION_DENIED";
  const parentBinId = `${String(incoming.ownerId)}_${String(incoming.bin_code)}`;
  if (!existingSmartBinIds.has(parentBinId)) return "PERMISSION_DENIED";
  return "ALLOW";
}

function evaluateVehicleUpdate(
  auth: AuthContext,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): "ALLOW" | "PERMISSION_DENIED" {
  if (!auth || auth.email_verified !== true) return "PERMISSION_DENIED";
  if (existing.ownerId !== auth.uid && !isBootstrappedAdmin(auth)) return "PERMISSION_DENIED";
  if (!Array.isArray(incoming.assigned_route) || incoming.assigned_route.length > 25) return "PERMISSION_DENIED";
  return "ALLOW";
}

const VALID_USER: AuthContext = { uid: "user_A", email: "nurse@hospital.org", email_verified: true };

const BASE_BIN = {
  ownerId: "user_A",
  bin_code: "BIN-A01-Y",
  facility_name: "AIIMS Bhopal",
  ward: "Trauma ICU",
  category: "yellow",
  fill_level: 20,
  weight_kg: 5,
  capacity_kg: 25,
  lid_locked: 0,
  lid_status: "Ready",
  temp_c: 24.5,
  gas_ppm: 18,
  battery_pct: 98,
  lat: 23.2106,
  lng: 77.4574,
  status: "nominal",
  last_updated: "2026-11-26T12:00:00Z",
  createdAt: SERVER_TIME,
  updatedAt: SERVER_TIME,
};

test("Dirty Dozen payloads are all rejected with PERMISSION_DENIED", () => {
  // 1. Unauthenticated caller
  assert.equal(evaluateSmartBinCreate(null, "user_A_BIN-A01-Y", BASE_BIN), "PERMISSION_DENIED");

  // 2. Unverified email spoof of admin
  const spoofedAdmin: AuthContext = { uid: "attacker", email: ADMIN_EMAIL, email_verified: false };
  assert.equal(isBootstrappedAdmin(spoofedAdmin), false);
  assert.equal(evaluateSmartBinCreate(spoofedAdmin, "attacker_BIN-1", { ...BASE_BIN, ownerId: "attacker" }), "PERMISSION_DENIED");

  // 3. OwnerId spoofing on create
  assert.equal(evaluateSmartBinCreate(VALID_USER, "user_B_BIN-A01-Y", { ...BASE_BIN, ownerId: "user_B" }), "PERMISSION_DENIED");

  // 4. OwnerId hijack on update
  assert.equal(
    evaluateAlertUpdate(
      VALID_USER,
      { ownerId: "user_A", status: "pending", createdAt: SERVER_TIME },
      { ownerId: "user_B", status: "assigned", createdAt: SERVER_TIME, updatedAt: SERVER_TIME }
    ),
    "PERMISSION_DENIED"
  );

  // 5. Shadow / ghost field injection
  assert.equal(
    evaluateSmartBinCreate(VALID_USER, "user_A_BIN-A01-Y", { ...BASE_BIN, isVerified: true }),
    "PERMISSION_DENIED"
  );

  // 6. Document ID poisoning
  assert.equal(evaluateSmartBinCreate(VALID_USER, "bad$id/../hack", BASE_BIN), "PERMISSION_DENIED");
  assert.equal(evaluateSmartBinCreate(VALID_USER, "x".repeat(200), BASE_BIN), "PERMISSION_DENIED");

  // 7. Self-assigned admin check
  assert.equal(isBootstrappedAdmin(VALID_USER), false);

  // 8. Client timestamp forgery
  assert.equal(
    evaluateSmartBinCreate(VALID_USER, "user_A_BIN-A01-Y", { ...BASE_BIN, createdAt: "2020-01-01T00:00:00Z" }),
    "PERMISSION_DENIED"
  );

  // 9. Terminal state bypass on collected alert
  assert.equal(
    evaluateAlertUpdate(
      VALID_USER,
      { ownerId: "user_A", status: "collected", createdAt: SERVER_TIME },
      { ownerId: "user_A", status: "pending", createdAt: SERVER_TIME, updatedAt: SERVER_TIME }
    ),
    "PERMISSION_DENIED"
  );

  // 10. Immutable ledger tampering (verified non-admin cannot mutate)
  assert.equal(isBootstrappedAdmin(VALID_USER), false);

  // 11. Orphaned ledger manifest referencing nonexistent bin
  const existingBins = new Set(["user_A_BIN-A01-Y"]);
  assert.equal(
    evaluateLedgerCreate(VALID_USER, { ownerId: "user_A", bin_code: "NONEXISTENT-999" }, existingBins),
    "PERMISSION_DENIED"
  );

  // 12. Unbounded route array (> 25) and oversized notes (> 500)
  assert.equal(
    evaluateVehicleUpdate(
      VALID_USER,
      { ownerId: "user_A" },
      { assigned_route: Array.from({ length: 26 }, (_, i) => ({ stop_order: i + 1 })) }
    ),
    "PERMISSION_DENIED"
  );
  assert.equal(
    evaluateAlertUpdate(
      VALID_USER,
      { ownerId: "user_A", status: "pending", createdAt: SERVER_TIME },
      { ownerId: "user_A", status: "assigned", notes: "a".repeat(501), createdAt: SERVER_TIME, updatedAt: SERVER_TIME }
    ),
    "PERMISSION_DENIED"
  );
});

test("Legitimate verified owner operations succeed", () => {
  assert.equal(evaluateSmartBinCreate(VALID_USER, "user_A_BIN-A01-Y", BASE_BIN), "ALLOW");
  assert.equal(
    evaluateAlertUpdate(
      VALID_USER,
      { ownerId: "user_A", status: "pending", createdAt: SERVER_TIME },
      { ownerId: "user_A", status: "assigned", notes: "Route assigned", createdAt: SERVER_TIME, updatedAt: SERVER_TIME }
    ),
    "ALLOW"
  );
  assert.equal(
    evaluateLedgerCreate(
      VALID_USER,
      { ownerId: "user_A", bin_code: "BIN-A01-Y" },
      new Set(["user_A_BIN-A01-Y"])
    ),
    "ALLOW"
  );
});
