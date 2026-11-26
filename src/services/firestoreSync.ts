import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import type {
  ClassificationResult,
  CollectionAlert,
  DashboardPayload,
  DisposalManifest,
  GpsConsentStatus,
  RoutePlan,
  SegregationEvent,
  SmartBin,
  Vehicle,
  VisitorLocationSource,
  WasteCategoryKey,
} from "../types/meditrack";
import {
  BHOPAL_FACILITIES,
  BLUEPRINT_LIMITS,
  buildDashboardPayloadFromRecords,
  buildSeedWorkspaceData,
  clampString,
  classifyWasteItemLocal,
  computeBinStatus,
  computeOptimizedRoutePlan,
  computeSha256Hex,
  sanitizeIdCode,
  utcNowIso,
  WASTE_CATEGORY_META,
} from "../utils/dashboardBuilder";

function randomCodeSuffix(len = 4): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => (b % 36).toString(36).toUpperCase())
    .join("");
}

export async function ensureUserWorkspaceSeeded(uid: string): Promise<void> {
  const binsRef = collection(db, "smartBins");
  try {
    const snap = await getDocs(
      query(binsRef, where("ownerId", "==", uid), limit(1))
    );
    if (!snap.empty) {
      return;
    }

    const nowIso = utcNowIso();
    const seed = buildSeedWorkspaceData(nowIso);
    const batch = writeBatch(db);

    for (const bin of seed.bins) {
      const binDocRef = doc(db, "smartBins", `${uid}_${bin.bin_code}`);
      batch.set(binDocRef, {
        ownerId: uid,
        bin_code: bin.bin_code,
        facility_name: bin.facility_name,
        ward: bin.ward,
        category: bin.category,
        fill_level: bin.fill_level,
        weight_kg: bin.weight_kg,
        capacity_kg: bin.capacity_kg,
        lid_locked: Math.round(bin.lid_locked),
        lid_status: bin.lid_status,
        temp_c: bin.temp_c,
        gas_ppm: bin.gas_ppm,
        battery_pct: bin.battery_pct,
        lat: bin.lat,
        lng: bin.lng,
        status: bin.status,
        last_updated: bin.last_updated,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const v of seed.vehicles) {
      const vDocRef = doc(db, "vehicles", `${uid}_${v.vehicle_code}`);
      batch.set(vDocRef, {
        ownerId: uid,
        vehicle_code: v.vehicle_code,
        driver_name: v.driver_name,
        lat: v.lat,
        lng: v.lng,
        capacity_kg: v.capacity_kg,
        current_load_kg: v.current_load_kg,
        status: v.status,
        assigned_route: v.assigned_route,
        last_updated: v.last_updated,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const a of seed.alerts) {
      const aDocRef = doc(db, "collectionAlerts", `${uid}_${a.alert_code}`);
      batch.set(aDocRef, {
        ownerId: uid,
        alert_code: a.alert_code,
        bin_code: a.bin_code,
        facility_name: a.facility_name,
        ward: a.ward,
        category: a.category,
        fill_level: a.fill_level,
        priority: a.priority,
        trigger_source: a.trigger_source,
        status: a.status,
        assigned_vehicle: a.assigned_vehicle,
        notes: a.notes,
        created_at: a.created_at,
        resolved_at: a.resolved_at,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (let i = 0; i < seed.events.length; i++) {
      const ev = seed.events[i];
      const evCode = `EVT-SEED-${i + 1}`;
      const evDocRef = doc(db, "segregationEvents", `${uid}_${evCode}`);
      batch.set(evDocRef, {
        ownerId: uid,
        event_code: evCode,
        timestamp: ev.timestamp,
        item_name: ev.item_name,
        detected_category: ev.detected_category,
        confidence: ev.confidence,
        method: ev.method,
        bin_code: ev.bin_code,
        facility_name: ev.facility_name,
        weight_g: ev.weight_g,
        lid_actuated: ev.lid_actuated,
        treatment_method: ev.treatment_method,
        operator: ev.operator,
        createdAt: serverTimestamp(),
      });
    }

    for (const l of seed.ledgerTemplates) {
      const chainHash = await computeSha256Hex(l.qr_payload);
      const lDocRef = doc(db, "disposalLedger", `${uid}_${l.manifest_id}`);
      batch.set(lDocRef, {
        ownerId: uid,
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
        chain_hash: chainHash,
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, "smartBins");
  }
}

export function subscribeToWorkspaceDashboard(
  uid: string,
  onDashboard: (payload: DashboardPayload) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const state: {
    bins: SmartBin[];
    alerts: CollectionAlert[];
    vehicles: Vehicle[];
    events: SegregationEvent[];
    ledger: DisposalManifest[];
    ready: { bins: boolean; alerts: boolean; vehicles: boolean; events: boolean; ledger: boolean };
  } = {
    bins: [],
    alerts: [],
    vehicles: [],
    events: [],
    ledger: [],
    ready: { bins: false, alerts: false, vehicles: false, events: false, ledger: false },
  };

  const emitIfReady = () => {
    if (
      state.ready.bins &&
      state.ready.alerts &&
      state.ready.vehicles &&
      state.ready.events &&
      state.ready.ledger
    ) {
      onDashboard(
        buildDashboardPayloadFromRecords({
          bins: state.bins,
          alerts: state.alerts,
          vehicles: state.vehicles,
          events: state.events,
          ledger: state.ledger,
        })
      );
    }
  };

  const unsubs: Unsubscribe[] = [];

  unsubs.push(
    onSnapshot(
      query(collection(db, "smartBins"), where("ownerId", "==", uid)),
      (snap) => {
        state.bins = snap.docs.map((d, idx) => {
          const r = d.data();
          return {
            id: idx + 1,
            bin_code: String(r.bin_code),
            facility_name: String(r.facility_name),
            ward: String(r.ward),
            category: r.category as WasteCategoryKey,
            fill_level: Number(r.fill_level ?? 0),
            weight_kg: Number(r.weight_kg ?? 0),
            capacity_kg: Number(r.capacity_kg ?? 25),
            lid_locked: Number(r.lid_locked ?? 0),
            lid_status: String(r.lid_status ?? "closed"),
            temp_c: Number(r.temp_c ?? 22),
            gas_ppm: Number(r.gas_ppm ?? 15),
            battery_pct: Number(r.battery_pct ?? 95),
            lat: Number(r.lat ?? 23.2599),
            lng: Number(r.lng ?? 77.4126),
            status: r.status as SmartBin["status"],
            last_updated: String(r.last_updated ?? utcNowIso()),
          };
        });
        state.ready.bins = true;
        emitIfReady();
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, "smartBins");
        } catch (wrapped) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, "collectionAlerts"), where("ownerId", "==", uid)),
      (snap) => {
        state.alerts = snap.docs.map((d, idx) => {
          const r = d.data();
          return {
            id: idx + 1,
            alert_code: String(r.alert_code),
            bin_code: String(r.bin_code),
            facility_name: String(r.facility_name),
            ward: String(r.ward),
            category: r.category as WasteCategoryKey,
            fill_level: Number(r.fill_level ?? 0),
            priority: r.priority as CollectionAlert["priority"],
            trigger_source: String(r.trigger_source ?? ""),
            status: r.status as CollectionAlert["status"],
            assigned_vehicle: r.assigned_vehicle ? String(r.assigned_vehicle) : null,
            notes: r.notes ? String(r.notes) : null,
            created_at: String(r.created_at ?? utcNowIso()),
            resolved_at: r.resolved_at ? String(r.resolved_at) : null,
          };
        });
        state.ready.alerts = true;
        emitIfReady();
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, "collectionAlerts");
        } catch (wrapped) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, "vehicles"), where("ownerId", "==", uid)),
      (snap) => {
        state.vehicles = snap.docs.map((d, idx) => {
          const r = d.data();
          return {
            id: idx + 1,
            vehicle_code: String(r.vehicle_code),
            driver_name: String(r.driver_name),
            lat: Number(r.lat ?? 23.25),
            lng: Number(r.lng ?? 77.42),
            capacity_kg: Number(r.capacity_kg ?? 400),
            current_load_kg: Number(r.current_load_kg ?? 0),
            status: String(r.status ?? "idle"),
            assigned_route: Array.isArray(r.assigned_route) ? r.assigned_route : [],
            last_updated: String(r.last_updated ?? utcNowIso()),
          };
        });
        state.ready.vehicles = true;
        emitIfReady();
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, "vehicles");
        } catch (wrapped) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, "segregationEvents"), where("ownerId", "==", uid)),
      (snap) => {
        state.events = snap.docs.map((d, idx) => {
          const r = d.data();
          return {
            id: idx + 1,
            timestamp: String(r.timestamp ?? utcNowIso()),
            item_name: String(r.item_name),
            detected_category: r.detected_category as WasteCategoryKey,
            confidence: Number(r.confidence ?? 0.9),
            method: String(r.method ?? "Cloud CPCB Classifier"),
            bin_code: String(r.bin_code),
            facility_name: String(r.facility_name),
            weight_g: Number(r.weight_g ?? 0),
            lid_actuated: String(r.lid_actuated ?? ""),
            treatment_method: String(r.treatment_method ?? ""),
            operator: String(r.operator ?? "Hospital-Web-Node"),
          };
        });
        state.ready.events = true;
        emitIfReady();
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, "segregationEvents");
        } catch (wrapped) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, "disposalLedger"), where("ownerId", "==", uid)),
      (snap) => {
        state.ledger = snap.docs.map((d, idx) => {
          const r = d.data();
          return {
            id: idx + 1,
            manifest_id: String(r.manifest_id),
            qr_payload: String(r.qr_payload),
            bin_code: String(r.bin_code),
            facility_name: String(r.facility_name),
            category: r.category as WasteCategoryKey,
            weight_kg: Number(r.weight_kg ?? 0),
            treatment_method: String(r.treatment_method ?? ""),
            vehicle_code: String(r.vehicle_code ?? ""),
            pickup_time: String(r.pickup_time ?? utcNowIso()),
            disposal_time: String(r.disposal_time ?? utcNowIso()),
            compliance_status: String(r.compliance_status ?? "verified"),
            chain_hash: String(r.chain_hash ?? ""),
          };
        });
        state.ready.ledger = true;
        emitIfReady();
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, "disposalLedger");
        } catch (wrapped) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    )
  );

  return () => {
    for (const unsub of unsubs) unsub();
  };
}

export async function firestoreSegregateWaste(
  uid: string,
  payload: {
    item_name: string;
    description: string;
    facility_name: string;
    weight_g: number;
    image_base64?: string;
    hint_category?: string;
  },
  currentBins: SmartBin[],
  currentAlerts: CollectionAlert[]
): Promise<{
  classification: ClassificationResult;
  bin: SmartBin;
  alert_triggered: boolean;
}> {
  const classification = classifyWasteItemLocal(
    payload.item_name,
    payload.description,
    payload.hint_category || "",
    Boolean(payload.image_base64)
  );
  const nowIso = utcNowIso();
  const targetBin =
    currentBins.find(
      (b) =>
        b.facility_name === payload.facility_name &&
        b.category === classification.category
    ) ||
    currentBins.find((b) => b.facility_name === payload.facility_name) ||
    currentBins[0];

  if (!targetBin) {
    throw new Error("No smart bin found in Firestore workspace.");
  }

  const addedKg = Math.max(0.01, payload.weight_g / 1000);
  const newWeightKg = Math.min(
    500,
    Math.round((targetBin.weight_kg + addedKg) * 100) / 100
  );
  const capKg = Math.max(1, targetBin.capacity_kg);
  const newFill = Math.min(
    100,
    Math.round(((newWeightKg / capKg) * 100) * 10) / 10
  );
  const effectiveFill = Math.max(targetBin.fill_level, newFill);
  const newStatus = computeBinStatus(effectiveFill, targetBin.status);
  const newLocked = effectiveFill >= 95 ? 1 : 0;

  const updatedBin: SmartBin = {
    ...targetBin,
    fill_level: effectiveFill,
    weight_kg: newWeightKg,
    lid_locked: newLocked,
    lid_status: newLocked ? "locked" : "unlocked",
    status: newStatus,
    last_updated: nowIso,
  };

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "smartBins", `${uid}_${targetBin.bin_code}`), {
      fill_level: updatedBin.fill_level,
      weight_kg: updatedBin.weight_kg,
      lid_locked: updatedBin.lid_locked,
      lid_status: updatedBin.lid_status,
      temp_c: updatedBin.temp_c,
      gas_ppm: updatedBin.gas_ppm,
      battery_pct: updatedBin.battery_pct,
      status: updatedBin.status,
      last_updated: nowIso,
      updatedAt: serverTimestamp(),
    });

    // Lock non-target bins at the same facility to prevent cross-contamination
    for (const b of currentBins) {
      if (
        b.facility_name === targetBin.facility_name &&
        b.bin_code !== targetBin.bin_code
      ) {
        batch.update(doc(db, "smartBins", `${uid}_${b.bin_code}`), {
          lid_locked: 1,
          lid_status: "locked",
          last_updated: nowIso,
          updatedAt: serverTimestamp(),
        });
      }
    }

    const eventCode = sanitizeIdCode(
      `EVT-${Date.now()}-${randomCodeSuffix(3)}`,
      `EVT-${Date.now()}`,
      BLUEPRINT_LIMITS.SHORT_CODE_MAX
    );
    batch.set(doc(db, "segregationEvents", `${uid}_${eventCode}`), {
      ownerId: uid,
      event_code: eventCode,
      timestamp: nowIso,
      item_name: clampString(payload.item_name, BLUEPRINT_LIMITS.ITEM_NAME_MAX, "Medical Item"),
      detected_category: classification.category,
      confidence: classification.confidence,
      method: clampString(classification.method, 120, "Cloud CPCB Classifier"),
      bin_code: targetBin.bin_code,
      facility_name: clampString(targetBin.facility_name, BLUEPRINT_LIMITS.FACILITY_MAX),
      weight_g: Math.max(1, Math.min(100000, payload.weight_g)),
      lid_actuated: clampString(classification.lid_actuated, 120),
      treatment_method: clampString(classification.treatment_method, 140),
      operator: "Cloud-Hospital-Client",
      createdAt: serverTimestamp(),
    });

    let alertTriggered = false;
    if (effectiveFill >= 80) {
      alertTriggered = true;
      const existingAlert = currentAlerts.find(
        (a) =>
          a.bin_code === targetBin.bin_code &&
          (a.status === "pending" || a.status === "assigned")
      );
      const priority = effectiveFill >= 88 ? "critical" : "high";
      if (existingAlert) {
        batch.update(
          doc(db, "collectionAlerts", `${uid}_${existingAlert.alert_code}`),
          {
            fill_level: effectiveFill,
            priority,
            updatedAt: serverTimestamp(),
          }
        );
      } else {
        const alertCode = `ALT-${randomCodeSuffix(4)}`;
        batch.set(doc(db, "collectionAlerts", `${uid}_${alertCode}`), {
          ownerId: uid,
          alert_code: alertCode,
          bin_code: targetBin.bin_code,
          facility_name: targetBin.facility_name,
          ward: targetBin.ward,
          category: targetBin.category,
          fill_level: effectiveFill,
          priority,
          trigger_source: "Automated Segregation >= 80%",
          status: "pending",
          assigned_vehicle: null,
          notes: clampString(
            `Triggered during segregation of ${payload.item_name} (${effectiveFill.toFixed(1)}% full)`,
            BLUEPRINT_LIMITS.NOTES_MAX
          ),
          created_at: nowIso,
          resolved_at: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    await batch.commit();
    return {
      classification,
      bin: updatedBin,
      alert_triggered: alertTriggered,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, "segregationEvents");
  }
}

export async function firestoreRegisterSmartBin(
  uid: string,
  payload: {
    bin_code: string;
    facility_name: string;
    ward: string;
    category: WasteCategoryKey;
    capacity_kg: number;
    fill_level?: number;
  }
): Promise<SmartBin> {
  const binCode = sanitizeIdCode(
    payload.bin_code,
    `BIN-${randomCodeSuffix(4)}`,
    BLUEPRINT_LIMITS.BIN_CODE_MAX
  );
  const fac =
    BHOPAL_FACILITIES.find((f) => f.name === payload.facility_name) ||
    BHOPAL_FACILITIES[0];
  const fill = Math.max(0, Math.min(100, Number(payload.fill_level ?? 0)));
  const cap = Math.max(1, Math.min(500, Number(payload.capacity_kg || 25)));
  const weightKg = Math.round(((fill / 100) * cap) * 100) / 100;
  const status = computeBinStatus(fill, "nominal");
  const nowIso = utcNowIso();
  const lidLocked = fill >= 90 ? 1 : 0;

  const newBin: SmartBin = {
    id: Date.now(),
    bin_code: binCode,
    facility_name: clampString(fac.name, BLUEPRINT_LIMITS.FACILITY_MAX),
    ward: clampString(payload.ward, BLUEPRINT_LIMITS.WARD_MAX, "General Ward"),
    category: payload.category,
    fill_level: fill,
    weight_kg: weightKg,
    capacity_kg: cap,
    lid_locked: lidLocked,
    lid_status: lidLocked ? "locked" : "closed",
    temp_c: 22.4,
    gas_ppm: 16,
    battery_pct: 99,
    lat: fac.lat,
    lng: fac.lng,
    status,
    last_updated: nowIso,
  };

  try {
    await setDoc(doc(db, "smartBins", `${uid}_${binCode}`), {
      ownerId: uid,
      bin_code: newBin.bin_code,
      facility_name: newBin.facility_name,
      ward: newBin.ward,
      category: newBin.category,
      fill_level: newBin.fill_level,
      weight_kg: newBin.weight_kg,
      capacity_kg: newBin.capacity_kg,
      lid_locked: newBin.lid_locked,
      lid_status: newBin.lid_status,
      temp_c: newBin.temp_c,
      gas_ppm: newBin.gas_ppm,
      battery_pct: newBin.battery_pct,
      lat: newBin.lat,
      lng: newBin.lng,
      status: newBin.status,
      last_updated: newBin.last_updated,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return newBin;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `smartBins/${uid}_${binCode}`);
  }
}

export async function firestoreSendBinTelemetryAction(
  uid: string,
  payload: {
    action: "record_reading" | "poll_sensors" | "toggle_lock" | "simulate_drop" | "simulate_tick";
    bin_code?: string;
    delta_fill?: number;
  },
  currentBins: SmartBin[],
  currentAlerts: CollectionAlert[]
): Promise<void> {
  const nowIso = utcNowIso();
  try {
    if (payload.action === "toggle_lock" && payload.bin_code) {
      const bin = currentBins.find((b) => b.bin_code === payload.bin_code);
      if (!bin) return;
      const nextLock = bin.lid_locked ? 0 : 1;
      await updateDoc(doc(db, "smartBins", `${uid}_${bin.bin_code}`), {
        lid_locked: nextLock,
        lid_status: nextLock ? "locked" : "closed",
        last_updated: nowIso,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    if (
      (payload.action === "record_reading" || payload.action === "simulate_drop") &&
      payload.bin_code
    ) {
      const bin = currentBins.find((b) => b.bin_code === payload.bin_code);
      if (!bin) return;
      const delta = Number(payload.delta_fill ?? 15);
      const nextFill = Math.min(100, Math.max(0, Math.round((bin.fill_level + delta) * 10) / 10));
      const nextWeight = Math.min(
        500,
        Math.round(((nextFill / 100) * bin.capacity_kg) * 100) / 100
      );
      const nextStatus = computeBinStatus(nextFill, bin.status);
      const nextLock = nextFill >= 90 ? 1 : bin.lid_locked;
      const nextGas = Math.min(10000, Math.round(bin.gas_ppm + delta * 0.6));

      const batch = writeBatch(db);
      batch.update(doc(db, "smartBins", `${uid}_${bin.bin_code}`), {
        fill_level: nextFill,
        weight_kg: nextWeight,
        lid_locked: nextLock,
        lid_status: nextLock ? "locked" : "closed",
        temp_c: bin.temp_c,
        gas_ppm: nextGas,
        battery_pct: Math.max(10, bin.battery_pct - 0.1),
        status: nextStatus,
        last_updated: nowIso,
        updatedAt: serverTimestamp(),
      });

      if (nextFill >= 80) {
        const existingAlert = currentAlerts.find(
          (a) =>
            a.bin_code === bin.bin_code &&
            (a.status === "pending" || a.status === "assigned")
        );
        const priority = nextFill >= 88 ? "critical" : "high";
        if (existingAlert) {
          batch.update(
            doc(db, "collectionAlerts", `${uid}_${existingAlert.alert_code}`),
            {
              fill_level: nextFill,
              priority,
              updatedAt: serverTimestamp(),
            }
          );
        } else {
          const alertCode = `ALT-${randomCodeSuffix(4)}`;
          batch.set(doc(db, "collectionAlerts", `${uid}_${alertCode}`), {
            ownerId: uid,
            alert_code: alertCode,
            bin_code: bin.bin_code,
            facility_name: bin.facility_name,
            ward: bin.ward,
            category: bin.category,
            fill_level: nextFill,
            priority,
            trigger_source: "ESP32 Ultrasonic >= 80%",
            status: "pending",
            assigned_vehicle: null,
            notes: `Automated telemetry alert at ${nextFill.toFixed(1)}% capacity`,
            created_at: nowIso,
            resolved_at: null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
      await batch.commit();
      return;
    }

    // poll_sensors / simulate_tick: refresh timestamps & subtle realistic delta on active bins
    const batch = writeBatch(db);
    for (const bin of currentBins) {
      const bump = bin.fill_level < 92 ? 1.5 : 0;
      const nextFill = Math.min(100, Math.round((bin.fill_level + bump) * 10) / 10);
      const nextWeight = Math.min(
        500,
        Math.round(((nextFill / 100) * bin.capacity_kg) * 100) / 100
      );
      batch.update(doc(db, "smartBins", `${uid}_${bin.bin_code}`), {
        fill_level: nextFill,
        weight_kg: nextWeight,
        lid_locked: bin.lid_locked,
        lid_status: bin.lid_status,
        temp_c: bin.temp_c,
        gas_ppm: bin.gas_ppm,
        battery_pct: Math.max(10, Math.round((bin.battery_pct - 0.1) * 10) / 10),
        status: computeBinStatus(nextFill, bin.status),
        last_updated: nowIso,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, "smartBins");
  }
}

export async function firestoreCreatePickupRequest(
  uid: string,
  payload: {
    facility_name: string;
    category: WasteCategoryKey;
    priority: "critical" | "high" | "normal";
    notes: string;
    bin_code?: string;
  },
  currentBins: SmartBin[]
): Promise<{ alert_code: string }> {
  const targetBin =
    (payload.bin_code
      ? currentBins.find((b) => b.bin_code === payload.bin_code)
      : undefined) ||
    currentBins.find(
      (b) =>
        b.facility_name === payload.facility_name &&
        b.category === payload.category
    ) ||
    currentBins.find((b) => b.facility_name === payload.facility_name) ||
    currentBins[0];

  if (!targetBin) {
    throw new Error("No registered smart bin available for pickup request.");
  }

  const alertCode = `ALT-${randomCodeSuffix(4)}`;
  const nowIso = utcNowIso();

  try {
    await setDoc(doc(db, "collectionAlerts", `${uid}_${alertCode}`), {
      ownerId: uid,
      alert_code: alertCode,
      bin_code: targetBin.bin_code,
      facility_name: clampString(payload.facility_name || targetBin.facility_name, BLUEPRINT_LIMITS.FACILITY_MAX),
      ward: clampString(targetBin.ward, BLUEPRINT_LIMITS.WARD_MAX),
      category: payload.category,
      fill_level: targetBin.fill_level,
      priority: payload.priority,
      trigger_source: "Hospital Staff Request",
      status: "pending",
      assigned_vehicle: null,
      notes: clampString(payload.notes, BLUEPRINT_LIMITS.NOTES_MAX, "Pickup requested"),
      created_at: nowIso,
      resolved_at: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { alert_code: alertCode };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `collectionAlerts/${uid}_${alertCode}`);
  }
}

export async function firestoreOptimizeRoutes(
  uid: string,
  vehicleCode: string | undefined,
  currentBins: SmartBin[],
  currentAlerts: CollectionAlert[],
  currentVehicles: Vehicle[]
): Promise<RoutePlan> {
  const { plan, chosenVehicle } = computeOptimizedRoutePlan(
    currentBins,
    currentAlerts,
    currentVehicles,
    vehicleCode
  );
  if (!chosenVehicle || plan.stops.length === 0) {
    return plan;
  }

  const nowIso = utcNowIso();
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "vehicles", `${uid}_${chosenVehicle.vehicle_code}`), {
      lat: chosenVehicle.lat,
      lng: chosenVehicle.lng,
      current_load_kg: chosenVehicle.current_load_kg,
      status: "en_route",
      assigned_route: plan.stops.slice(0, BLUEPRINT_LIMITS.ASSIGNED_ROUTE_MAX),
      last_updated: nowIso,
      updatedAt: serverTimestamp(),
    });

    for (const stop of plan.stops) {
      batch.update(doc(db, "collectionAlerts", `${uid}_${stop.alert_code}`), {
        status: "assigned",
        assigned_vehicle: chosenVehicle.vehicle_code,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    return plan;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, "vehicles");
  }
}

export async function firestoreCompleteBinCollection(
  uid: string,
  payload: { bin_code: string; vehicle_code?: string },
  currentBins: SmartBin[],
  currentAlerts: CollectionAlert[],
  currentVehicles: Vehicle[]
): Promise<{
  collected: boolean;
  bin_code: string;
  vehicle_code: string;
  manifest: DisposalManifest;
}> {
  const bin = currentBins.find((b) => b.bin_code === payload.bin_code);
  if (!bin) {
    throw new Error(`Smart bin ${payload.bin_code} not found.`);
  }
  const nowIso = utcNowIso();
  const matchingAlerts = currentAlerts.filter(
    (a) =>
      a.bin_code === bin.bin_code &&
      (a.status === "pending" || a.status === "assigned")
  );
  const vehCode =
    payload.vehicle_code ||
    matchingAlerts.find((a) => a.assigned_vehicle)?.assigned_vehicle ||
    currentVehicles[0]?.vehicle_code ||
    "VAN-01";
  const vehicle = currentVehicles.find((v) => v.vehicle_code === vehCode);

  const manifestId = `MAN-${new Date().getUTCFullYear()}-${randomCodeSuffix(4)}`;
  const treatmentMethod = WASTE_CATEGORY_META[bin.category].treatment;
  const collectedWeight = Math.max(0.5, Math.round(bin.weight_kg * 100) / 100);
  const qrPayload = clampString(
    `MEDITRACK|${manifestId}|${bin.bin_code}|${bin.category.toUpperCase()}|${collectedWeight}KG|${treatmentMethod}|${nowIso}`,
    BLUEPRINT_LIMITS.QR_PAYLOAD_MAX
  );
  const chainHash = await computeSha256Hex(qrPayload);

  const manifest: DisposalManifest = {
    id: Date.now(),
    manifest_id: manifestId,
    qr_payload: qrPayload,
    bin_code: bin.bin_code,
    facility_name: bin.facility_name,
    category: bin.category,
    weight_kg: collectedWeight,
    treatment_method: treatmentMethod,
    vehicle_code: vehCode,
    pickup_time: nowIso,
    disposal_time: nowIso,
    compliance_status: "verified",
    chain_hash: chainHash,
  };

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "smartBins", `${uid}_${bin.bin_code}`), {
      fill_level: 0,
      weight_kg: 0,
      lid_locked: 0,
      lid_status: "closed",
      temp_c: 22.0,
      gas_ppm: 12,
      battery_pct: bin.battery_pct,
      status: "nominal",
      last_updated: nowIso,
      updatedAt: serverTimestamp(),
    });

    for (const al of matchingAlerts) {
      batch.update(doc(db, "collectionAlerts", `${uid}_${al.alert_code}`), {
        status: "collected",
        resolved_at: nowIso,
        assigned_vehicle: vehCode,
        updatedAt: serverTimestamp(),
      });
    }

    if (vehicle) {
      const remainingStops = (vehicle.assigned_route || [])
        .filter((s) => s.bin_code !== bin.bin_code)
        .slice(0, BLUEPRINT_LIMITS.ASSIGNED_ROUTE_MAX);
      batch.update(doc(db, "vehicles", `${uid}_${vehicle.vehicle_code}`), {
        lat: bin.lat,
        lng: bin.lng,
        current_load_kg: Math.min(
          vehicle.capacity_kg,
          Math.round((vehicle.current_load_kg + collectedWeight) * 100) / 100
        ),
        status: remainingStops.length > 0 ? "en_route" : "idle",
        assigned_route: remainingStops,
        last_updated: nowIso,
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(doc(db, "disposalLedger", `${uid}_${manifestId}`), {
      ownerId: uid,
      manifest_id: manifest.manifest_id,
      qr_payload: manifest.qr_payload,
      bin_code: manifest.bin_code,
      facility_name: manifest.facility_name,
      category: manifest.category,
      weight_kg: manifest.weight_kg,
      treatment_method: manifest.treatment_method,
      vehicle_code: manifest.vehicle_code,
      pickup_time: manifest.pickup_time,
      disposal_time: manifest.disposal_time,
      compliance_status: manifest.compliance_status,
      chain_hash: manifest.chain_hash,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return {
      collected: true,
      bin_code: bin.bin_code,
      vehicle_code: vehCode,
      manifest,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, "disposalLedger");
  }
}

export async function firestoreSyncVisitorSession(
  uid: string,
  payload: {
    visitor_id: string;
    session_id: string;
    landing_page: string;
    current_page: string;
    device_category: string;
    browser: string;
    location_source: VisitorLocationSource;
    gps_consent_status: GpsConsentStatus;
    latitude: number | null;
    longitude: number | null;
    accuracy_m: number | null;
  }
): Promise<void> {
  const sessionId = sanitizeIdCode(
    payload.session_id,
    `SES-${randomCodeSuffix(6)}`,
    BLUEPRINT_LIMITS.SHORT_CODE_MAX
  );
  const visitorId = sanitizeIdCode(
    payload.visitor_id,
    `VIS-${randomCodeSuffix(6)}`,
    BLUEPRINT_LIMITS.SHORT_CODE_MAX
  );
  const docId = `${uid}_${sessionId}`;
  const docRef = doc(db, "visitorSessions", docId);
  try {
    const existing = await getDoc(docRef);
    if (existing.exists()) {
      await updateDoc(docRef, {
        current_page: clampString(payload.current_page, 200, "/"),
        location_source: payload.location_source,
        gps_consent_status: payload.gps_consent_status,
        latitude: payload.latitude,
        longitude: payload.longitude,
        accuracy_m: payload.accuracy_m,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(docRef, {
        ownerId: uid,
        visitor_id: visitorId,
        session_id: sessionId,
        landing_page: clampString(payload.landing_page, 200, "/"),
        current_page: clampString(payload.current_page, 200, "/"),
        device_category: clampString(payload.device_category, 40, "Desktop"),
        browser: clampString(payload.browser, 40, "Browser"),
        location_source: payload.location_source,
        gps_consent_status: payload.gps_consent_status,
        latitude: payload.latitude,
        longitude: payload.longitude,
        accuracy_m: payload.accuracy_m,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `visitorSessions/${docId}`);
  }
}
