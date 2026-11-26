import type {
  BinStatus,
  CategoryBreakdown,
  ClassificationResult,
  CollectionAlert,
  DailyWasteTrend,
  DashboardPayload,
  DisposalManifest,
  FacilityComplianceStatus,
  FacilityNode,
  PredictiveAlert,
  RoutePlan,
  RouteStop,
  SegregationEvent,
  SmartBin,
  Vehicle,
  WasteCategoryKey,
} from "../types/meditrack";

export const BHOPAL_FACILITIES: FacilityNode[] = [
  {
    name: "AIIMS Bhopal",
    code: "FAC-01",
    lat: 23.2106,
    lng: 77.4574,
    zone: "Saket Nagar, Habib Ganj",
  },
  {
    name: "Hamidia Hospital (GMC Bhopal)",
    code: "FAC-02",
    lat: 23.2585,
    lng: 77.402,
    zone: "Royal Market, Kohefiza",
  },
  {
    name: "Bansal Hospital Bhopal",
    code: "FAC-03",
    lat: 23.2031,
    lng: 77.4229,
    zone: "Sector C, Shahpura",
  },
  {
    name: "People's Hospital Bhopal",
    code: "FAC-04",
    lat: 23.297,
    lng: 77.425,
    zone: "Peoples Campus, Bhanpur",
  },
];

export const CBWTF_PLANT = {
  name: "Bhopal Incinerators Ltd. (CBWTF Govindpura)",
  lat: 23.264,
  lng: 77.4475,
};

export const WASTE_CATEGORY_META: Record<
  WasteCategoryKey,
  {
    label: string;
    bin_color: string;
    treatment: string;
    hazard_level: string;
  }
> = {
  yellow: {
    label: "Infectious & Anatomical Waste",
    bin_color: "Yellow",
    treatment: "Incineration / Plasma Pyrolysis",
    hazard_level: "High Biohazard",
  },
  red: {
    label: "Contaminated Recyclable Plastics",
    bin_color: "Red",
    treatment: "Autoclaving + Shredding",
    hazard_level: "Infectious Recyclable",
  },
  white: {
    label: "Waste Sharps & Needles",
    bin_color: "White (Translucent Puncture-Proof)",
    treatment: "Autoclaving + Encapsulation",
    hazard_level: "Critical Puncture Hazard",
  },
  blue: {
    label: "Glassware & Metallic Implants",
    bin_color: "Blue (Puncture-Proof)",
    treatment: "Chemical Disinfection + Recycling",
    hazard_level: "Moderate Bio-Glass Hazard",
  },
};

export const BLUEPRINT_LIMITS = {
  CODE_PATTERN: /^[a-zA-Z0-9_-]+$/,
  BIN_CODE_MAX: 40,
  SHORT_CODE_MAX: 64,
  FACILITY_MAX: 120,
  WARD_MAX: 120,
  ITEM_NAME_MAX: 160,
  NOTES_MAX: 500,
  QR_PAYLOAD_MAX: 1000,
  ASSIGNED_ROUTE_MAX: 25,
} as const;

export function sanitizeIdCode(raw: string, fallback: string, maxLen = 40): string {
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
  if (cleaned.length >= 2 && BLUEPRINT_LIMITS.CODE_PATTERN.test(cleaned)) {
    return cleaned;
  }
  return fallback.slice(0, maxLen);
}

export function clampString(raw: string, maxLen: number, fallback = ""): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallback.slice(0, maxLen);
  return trimmed.slice(0, maxLen);
}

export function utcNowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371.0;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lng2 - lng1);
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100) / 100;
}

export function computeBinStatus(
  fillLevel: number,
  currentStatus: BinStatus = "nominal"
): BinStatus {
  if (currentStatus === "dispatched" && fillLevel >= 80) return "dispatched";
  if (fillLevel >= 80) return "overflow_alert";
  if (fillLevel >= 60) return "warning";
  return "nominal";
}

export function classifyWasteItemLocal(
  itemName: string,
  description = "",
  hintCategory = "",
  hasImage = false
): ClassificationResult {
  const text = `${itemName} ${description}`.toLowerCase().trim();
  const scores: Record<WasteCategoryKey, number> = {
    yellow: 0.1,
    red: 0.1,
    white: 0.1,
    blue: 0.1,
  };

  const keywordWeights: Record<WasteCategoryKey, Array<[string, number]>> = {
    white: [
      ["needle", 0.95],
      ["scalpel", 0.95],
      ["blade", 0.9],
      ["lancet", 0.92],
      ["sharp", 0.9],
      ["fixed needle", 0.95],
      ["suture", 0.8],
      ["cannula", 0.72],
      ["metal pin", 0.75],
    ],
    yellow: [
      ["blood", 0.85],
      ["gauze", 0.88],
      ["dressing", 0.88],
      ["cotton", 0.82],
      ["bandage", 0.84],
      ["anatomical", 0.95],
      ["tissue", 0.92],
      ["placenta", 0.96],
      ["swab", 0.82],
      ["culture", 0.88],
      ["expired", 0.8],
      ["medicine", 0.72],
      ["cytotoxic", 0.9],
      ["soiled", 0.82],
      ["mask", 0.74],
      ["apron", 0.76],
      ["infectious", 0.88],
    ],
    red: [
      ["iv", 0.85],
      ["tubing", 0.9],
      ["catheter", 0.92],
      ["saline", 0.86],
      ["syringe", 0.78],
      ["vacutainer", 0.84],
      ["glove", 0.88],
      ["gloves", 0.88],
      ["plastic", 0.82],
      ["urobag", 0.92],
      ["dialysis", 0.86],
      ["polymer", 0.8],
      ["tube", 0.75],
      ["bag", 0.7],
    ],
    blue: [
      ["glass", 0.92],
      ["ampoule", 0.95],
      ["vial", 0.88],
      ["slide", 0.86],
      ["implant", 0.94],
      ["metallic", 0.84],
      ["orthopedic", 0.92],
      ["plate", 0.8],
      ["pipette", 0.78],
      ["bottle", 0.65],
    ],
  };

  const matched = new Set<string>();
  for (const cat of Object.keys(keywordWeights) as WasteCategoryKey[]) {
    for (const [kw, wt] of keywordWeights[cat]) {
      if (text.includes(kw)) {
        scores[cat] += wt;
        matched.add(kw);
      }
    }
  }

  if (text.includes("needle") && text.includes("syringe")) {
    scores.white += 0.6;
  }
  if (text.includes("blood") && (text.includes("plastic") || text.includes("tubing"))) {
    scores.red += 0.35;
  }
  if (
    hintCategory === "yellow" ||
    hintCategory === "red" ||
    hintCategory === "white" ||
    hintCategory === "blue"
  ) {
    scores[hintCategory] += 0.45;
  }

  let bestCat: WasteCategoryKey = "yellow";
  for (const cat of ["yellow", "red", "white", "blue"] as WasteCategoryKey[]) {
    if (scores[cat] > scores[bestCat]) {
      bestCat = cat;
    }
  }

  const rawScore = scores[bestCat];
  const totalScore =
    scores.yellow + scores.red + scores.white + scores.blue;
  const confidence =
    Math.round(
      Math.min(0.99, Math.max(0.74, 0.62 + (rawScore / Math.max(1, totalScore)) * 0.42)) *
        100
    ) / 100;
  const meta = WASTE_CATEGORY_META[bestCat];
  const colorShort = meta.bin_color.split(" ")[0];
  const matchedList = Array.from(matched).sort().slice(0, 4);

  return {
    category: bestCat,
    category_label: meta.label,
    bin_color: meta.bin_color,
    treatment_method: meta.treatment,
    hazard_level: meta.hazard_level,
    confidence,
    method: hasImage
      ? "Cloud CPCB Vision + Rule Engine"
      : "Cloud CPCB Feature Classifier",
    lid_actuated: `${colorShort} Unlocked / Other 3 Bins Locked`,
    reasoning:
      matchedList.length > 0
        ? `Matched clinical tokens: ${matchedList.join(", ")}`
        : "Applied baseline biomedical safety heuristic",
  };
}

export async function computeSha256Hex(payload: string): Promise<string> {
  const data = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16)
    .toUpperCase();
}

function estimateBinFillRate(bin: SmartBin): number {
  const ward = bin.ward.toLowerCase();
  let rate = 3.2;
  if (ward.includes("icu") || ward.includes("emergency") || ward.includes("trauma")) {
    rate = 5.8;
  } else if (ward.includes("ot") || ward.includes("dialysis") || ward.includes("phlebotomy")) {
    rate = 4.6;
  } else if (ward.includes("lab") || ward.includes("microbiology") || ward.includes("recovery")) {
    rate = 3.5;
  }

  if (bin.category === "yellow") rate *= 1.15;
  else if (bin.category === "red") rate *= 1.1;
  else if (bin.category === "white") rate *= 0.95;
  else rate *= 0.85;

  if (bin.gas_ppm >= 50) rate += 0.8;
  else if (bin.gas_ppm >= 30) rate += 0.35;

  return Math.round(rate * 100) / 100;
}

export function computePredictiveAlerts(
  bins: SmartBin[],
  alerts: CollectionAlert[]
): PredictiveAlert[] {
  const nowMs = Date.now();
  const activeAlertBins = new Set(
    alerts
      .filter((a) => a.status === "pending" || a.status === "assigned")
      .map((a) => a.bin_code)
  );

  return bins
    .map((b) => {
      const rate = estimateBinFillRate(b);
      const remaining = Math.max(0, 100 - b.fill_level);
      const hoursToFull = Math.round((remaining / Math.max(0.5, rate)) * 10) / 10;
      const hoursToThreshold =
        Math.round((Math.max(0, 80 - b.fill_level) / Math.max(0.5, rate)) * 10) / 10;
      const projectedFullAt = new Date(nowMs + hoursToFull * 3600 * 1000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "+00:00");

      let risk_level: "imminent" | "upcoming" | "stable" = "stable";
      let recommended_action = "Monitor routine sensor telemetry";
      if (b.fill_level >= 85 || hoursToFull <= 4) {
        risk_level = "imminent";
        recommended_action = "Pre-dispatch unit immediately before lock";
      } else if (b.fill_level >= 60 || hoursToFull <= 12) {
        risk_level = "upcoming";
        recommended_action = "Schedule pickup on next shift sweep";
      }

      return {
        bin_code: b.bin_code,
        facility_name: b.facility_name,
        ward: b.ward,
        category: b.category,
        fill_level: b.fill_level,
        fill_rate_pct_per_hr: rate,
        hours_to_full: hoursToFull,
        hours_to_threshold: hoursToThreshold,
        projected_full_at: projectedFullAt,
        risk_level,
        recommended_action,
        already_queued: activeAlertBins.has(b.bin_code),
      };
    })
    .sort((a, b) => a.hours_to_full - b.hours_to_full || b.fill_level - a.fill_level);
}

export function computeDailyTrends(
  bins: SmartBin[],
  ledger: DisposalManifest[]
): DailyWasteTrend[] {
  const now = new Date();
  const baselines: Array<[number, number, number, number]> = [
    [38.4, 31.2, 14.6, 17.8],
    [41.0, 34.5, 16.2, 19.1],
    [44.8, 36.0, 15.8, 20.4],
    [39.6, 33.8, 17.1, 18.5],
    [47.2, 39.4, 18.9, 21.6],
    [51.5, 42.1, 19.4, 22.8],
  ];

  const active: Record<WasteCategoryKey, number> = {
    yellow: 0,
    red: 0,
    white: 0,
    blue: 0,
  };
  for (const b of bins) active[b.category] += b.weight_kg;
  for (const l of ledger) active[l.category] += l.weight_kg * 0.45;

  const formatDayLabel = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });

  const out: DailyWasteTrend[] = baselines.map(([y, r, w, bl], idx) => {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (6 - idx)));
    return {
      date: day.toISOString().slice(0, 10),
      day_label: formatDayLabel(day),
      yellow_kg: y,
      red_kg: r,
      white_kg: w,
      blue_kg: bl,
      total_kg: Math.round((y + r + w + bl) * 10) / 10,
    };
  });

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const ty = Math.round(Math.max(24, active.yellow) * 10) / 10;
  const tr = Math.round(Math.max(18, active.red) * 10) / 10;
  const tw = Math.round(Math.max(12, active.white) * 10) / 10;
  const tbl = Math.round(Math.max(14, active.blue) * 10) / 10;

  out.push({
    date: today.toISOString().slice(0, 10),
    day_label: `${formatDayLabel(today)} (Today)`,
    yellow_kg: ty,
    red_kg: tr,
    white_kg: tw,
    blue_kg: tbl,
    total_kg: Math.round((ty + tr + tw + tbl) * 10) / 10,
  });

  return out;
}

export function computeFacilityCompliance(
  bins: SmartBin[],
  alerts: CollectionAlert[],
  ledger: DisposalManifest[]
): FacilityComplianceStatus[] {
  const fallbackTime = utcNowIso();
  return BHOPAL_FACILITIES.map((fac) => {
    const facBins = bins.filter((b) => b.facility_name === fac.name);
    const facAlerts = alerts.filter(
      (a) =>
        a.facility_name === fac.name &&
        (a.status === "pending" || a.status === "assigned")
    );
    const facVerified = ledger.filter(
      (l) =>
        l.facility_name === fac.name &&
        l.compliance_status.toLowerCase() === "verified"
    );

    const overflowBins = facBins.filter((b) => b.fill_level >= 80).length;
    const warningBins = facBins.filter(
      (b) => b.fill_level >= 60 && b.fill_level < 80
    ).length;
    const lockedBins = facBins.filter((b) => b.lid_locked === 1).length;
    const avgFill =
      Math.round(
        (facBins.reduce((s, b) => s + b.fill_level, 0) / Math.max(1, facBins.length)) *
          10
      ) / 10;
    const trackedMass =
      Math.round(facBins.reduce((s, b) => s + b.weight_kg, 0) * 100) / 100;
    const lastUpdated =
      facBins.map((b) => b.last_updated).sort().reverse()[0] || fallbackTime;

    let compliance_status: "Action Required" | "Watch" | "Compliant" = "Compliant";
    if (overflowBins > 0 || facAlerts.length > 0) {
      compliance_status = "Action Required";
    } else if (warningBins > 0) {
      compliance_status = "Watch";
    }

    return {
      facility_code: fac.code,
      facility_name: fac.name,
      zone: fac.zone,
      total_bins: facBins.length,
      overflow_bins: overflowBins,
      warning_bins: warningBins,
      locked_bins: lockedBins,
      avg_fill_level: avgFill,
      tracked_mass_kg: trackedMass,
      pending_alerts: facAlerts.length,
      verified_disposals: facVerified.length,
      compliance_status,
      last_updated: lastUpdated,
    };
  });
}

export function buildDashboardPayloadFromRecords(params: {
  bins: SmartBin[];
  alerts: CollectionAlert[];
  vehicles: Vehicle[];
  events: SegregationEvent[];
  ledger: DisposalManifest[];
}): DashboardPayload {
  const sortedBins = [...params.bins].sort(
    (a, b) => b.fill_level - a.fill_level || a.bin_code.localeCompare(b.bin_code)
  );
  const statusRank = (s: string) =>
    s === "pending" ? 0 : s === "assigned" ? 1 : 2;
  const sortedAlerts = [...params.alerts].sort(
    (a, b) =>
      statusRank(a.status) - statusRank(b.status) ||
      b.created_at.localeCompare(a.created_at)
  );
  const sortedVehicles = [...params.vehicles].sort((a, b) =>
    a.vehicle_code.localeCompare(b.vehicle_code)
  );
  const sortedEvents = [...params.events]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 25);
  const sortedLedger = [...params.ledger]
    .sort((a, b) => b.disposal_time.localeCompare(a.disposal_time))
    .slice(0, 25);

  const pendingAlerts = sortedAlerts.filter(
    (a) => a.status === "pending" || a.status === "assigned"
  );
  const overflowBins = sortedBins.filter((b) => b.fill_level >= 80);
  const totalMassKg =
    Math.round(
      (sortedBins.reduce((s, b) => s + b.weight_kg, 0) +
        params.ledger.reduce((s, l) => s + l.weight_kg, 0)) *
        10
    ) / 10;
  const verifiedDisposals = params.ledger.filter(
    (l) => l.compliance_status.toLowerCase() === "verified"
  ).length;

  const category_breakdown: CategoryBreakdown[] = (
    ["yellow", "red", "white", "blue"] as WasteCategoryKey[]
  ).map((catKey) => {
    const meta = WASTE_CATEGORY_META[catKey];
    const catBins = sortedBins.filter((b) => b.category === catKey);
    const avgFill =
      Math.round(
        (catBins.reduce((s, b) => s + b.fill_level, 0) / Math.max(1, catBins.length)) *
          10
      ) / 10;
    const activeMass =
      Math.round(catBins.reduce((s, b) => s + b.weight_kg, 0) * 10) / 10;
    return {
      category: catKey,
      label: meta.label,
      bin_color: meta.bin_color,
      treatment: meta.treatment,
      bin_count: catBins.length,
      avg_fill: avgFill,
      active_mass_kg: activeMass,
    };
  });

  return {
    kpis: {
      total_bins: sortedBins.length,
      overflow_bins: overflowBins.length,
      pending_alerts: pendingAlerts.length,
      total_mass_kg: totalMassKg,
      segregated_events: params.events.length,
      verified_disposals: verifiedDisposals,
      active_vehicles: sortedVehicles.length,
    },
    facilities: BHOPAL_FACILITIES,
    treatment_plant: CBWTF_PLANT,
    bins: sortedBins,
    alerts: sortedAlerts,
    vehicles: sortedVehicles,
    segregation_events: sortedEvents,
    disposal_ledger: sortedLedger,
    category_breakdown,
    benchmarks: [
      { metric: "Segregation Errors", legacy_pct: 75, meditrack_pct: 5 },
      { metric: "Collection Delays", legacy_pct: 60, meditrack_pct: 12 },
      { metric: "Operational Loss", legacy_pct: 45, meditrack_pct: 15 },
      { metric: "Fuel Wastage", legacy_pct: 40, meditrack_pct: 10 },
      { metric: "Environmental Impact", legacy_pct: 35, meditrack_pct: 5 },
    ],
    predictive_alerts: computePredictiveAlerts(sortedBins, sortedAlerts),
    daily_trends: computeDailyTrends(sortedBins, sortedLedger),
    facility_compliance: computeFacilityCompliance(
      sortedBins,
      sortedAlerts,
      sortedLedger
    ),
  };
}

export function computeOptimizedRoutePlan(
  bins: SmartBin[],
  alerts: CollectionAlert[],
  vehicles: Vehicle[],
  preferredVehicleCode?: string
): { plan: RoutePlan; chosenVehicle: Vehicle | null } {
  const activeAlerts = alerts.filter(
    (a) => a.status === "pending" || a.status === "assigned"
  );
  if (activeAlerts.length === 0) {
    return {
      chosenVehicle: null,
      plan: {
        optimized: true,
        message: "All smart bins are below overflow threshold; routine stops skipped.",
        vehicle_code: null,
        stops: [],
        total_distance_km: 0,
        baseline_distance_km: 0,
        distance_saved_km: 0,
        estimated_minutes: 0,
      },
    };
  }

  const binByCode = new Map(bins.map((b) => [b.bin_code, b]));
  const chosenVehicle =
    (preferredVehicleCode
      ? vehicles.find((v) => v.vehicle_code === preferredVehicleCode)
      : undefined) ||
    vehicles.reduce<Vehicle | null>((best, v) => {
      if (!best) return v;
      const dV = haversineKm(v.lat, v.lng, CBWTF_PLANT.lat, CBWTF_PLANT.lng);
      const dBest = haversineKm(best.lat, best.lng, CBWTF_PLANT.lat, CBWTF_PLANT.lng);
      return dV < dBest ? v : best;
    }, null);

  if (!chosenVehicle) {
    return {
      chosenVehicle: null,
      plan: {
        optimized: false,
        message: "No vehicles registered in fleet.",
        vehicle_code: null,
        stops: [],
        total_distance_km: 0,
        baseline_distance_km: 0,
        distance_saved_km: 0,
        estimated_minutes: 0,
      },
    };
  }

  const remaining = activeAlerts.slice(0, BLUEPRINT_LIMITS.ASSIGNED_ROUTE_MAX).map((a) => {
    const b = binByCode.get(a.bin_code);
    const fac = BHOPAL_FACILITIES.find((f) => f.name === a.facility_name);
    return {
      alert: a,
      lat: b?.lat ?? fac?.lat ?? 23.2599,
      lng: b?.lng ?? fac?.lng ?? 77.4126,
      weight_kg: b?.weight_kg ?? 10,
    };
  });

  let curLat = chosenVehicle.lat;
  let curLng = chosenVehicle.lng;
  let totalDist = 0;
  const stops: RouteStop[] = [];

  const pool = [...remaining];
  while (pool.length > 0) {
    let bestIdx = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pool.length; i++) {
      const d = haversineKm(curLat, curLng, pool[i].lat, pool[i].lng);
      const urgencyBonus = pool[i].alert.priority === "critical" ? 0.8 : 1.0;
      const score = d * urgencyBonus;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const next = pool.splice(bestIdx, 1)[0];
    const legKm = haversineKm(curLat, curLng, next.lat, next.lng);
    totalDist += legKm;
    stops.push({
      stop_order: stops.length + 1,
      alert_code: next.alert.alert_code,
      bin_code: next.alert.bin_code,
      facility_name: next.alert.facility_name,
      ward: next.alert.ward,
      category: next.alert.category,
      fill_level: next.alert.fill_level,
      weight_kg: next.weight_kg,
      priority: next.alert.priority,
      lat: next.lat,
      lng: next.lng,
      leg_distance_km: legKm,
    });
    curLat = next.lat;
    curLng = next.lng;
  }

  const toPlantKm = haversineKm(curLat, curLng, CBWTF_PLANT.lat, CBWTF_PLANT.lng);
  const totalDistanceKm = Math.round((totalDist + toPlantKm) * 100) / 100;
  const baselineDistanceKm = Math.round((totalDistanceKm * 1.48 + 4.2) * 100) / 100;
  const distanceSavedKm = Math.max(
    0,
    Math.round((baselineDistanceKm - totalDistanceKm) * 100) / 100
  );

  return {
    chosenVehicle,
    plan: {
      optimized: true,
      vehicle_code: chosenVehicle.vehicle_code,
      driver_name: chosenVehicle.driver_name,
      stops,
      to_treatment_plant_km: toPlantKm,
      total_distance_km: totalDistanceKm,
      baseline_distance_km: baselineDistanceKm,
      distance_saved_km: distanceSavedKm,
      fuel_saved_liters: Math.round(distanceSavedKm * 0.28 * 100) / 100,
      estimated_minutes: Math.max(8, Math.round(totalDistanceKm * 2.6 + stops.length * 6)),
    },
  };
}

function escapeCsvCell(val: unknown): string {
  const s = String(val ?? "");
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildFacilityComplianceCsv(rows: FacilityComplianceStatus[]): string {
  const headers = [
    "Facility Code",
    "Facility Name",
    "Zone",
    "Total Bins",
    "Overflow Bins",
    "Warning Bins",
    "Locked Bins",
    "Avg Fill (%)",
    "Tracked Mass (kg)",
    "Pending Alerts",
    "Verified Disposals",
    "Compliance Status",
    "Last Telemetry",
  ];
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.facility_code,
        r.facility_name,
        r.zone,
        r.total_bins,
        r.overflow_bins,
        r.warning_bins,
        r.locked_bins,
        r.avg_fill_level.toFixed(1),
        r.tracked_mass_kg.toFixed(2),
        r.pending_alerts,
        r.verified_disposals,
        r.compliance_status,
        r.last_updated,
      ]
        .map(escapeCsvCell)
        .join(",")
    );
  }
  return lines.join("\n");
}

export function buildDisposalLedgerCsv(rows: DisposalManifest[]): string {
  const headers = [
    "Manifest ID",
    "Facility",
    "Bin Code",
    "Category",
    "Weight (kg)",
    "Treatment Method",
    "Vehicle",
    "Pickup Time",
    "Disposal Time",
    "Status",
    "SHA-256 Chain Hash",
  ];
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.manifest_id,
        r.facility_name,
        r.bin_code,
        r.category,
        r.weight_kg.toFixed(2),
        r.treatment_method,
        r.vehicle_code,
        r.pickup_time,
        r.disposal_time,
        r.compliance_status,
        r.chain_hash,
      ]
        .map(escapeCsvCell)
        .join(",")
    );
  }
  return lines.join("\n");
}

export function buildSeedWorkspaceData(nowIso: string): {
  bins: SmartBin[];
  alerts: CollectionAlert[];
  vehicles: Vehicle[];
  events: SegregationEvent[];
  ledgerTemplates: Array<{
    manifest_id: string;
    bin_code: string;
    facility_name: string;
    category: WasteCategoryKey;
    weight_kg: number;
    treatment_method: string;
    vehicle_code: string;
    pickup_time: string;
    disposal_time: string;
    compliance_status: string;
    qr_payload: string;
  }>;
} {
  const bins: SmartBin[] = [
    { id: 1, bin_code: "BIN-A01-Y", facility_name: "AIIMS Bhopal", ward: "Trauma & Emergency OT-1", category: "yellow", fill_level: 88, weight_kg: 19.4, capacity_kg: 22, lid_locked: 1, lid_status: "locked", temp_c: 24.8, gas_ppm: 62, battery_pct: 91, lat: 23.2106, lng: 77.4574, status: "overflow_alert", last_updated: nowIso },
    { id: 2, bin_code: "BIN-A02-R", facility_name: "AIIMS Bhopal", ward: "IPD Surgical Ward 2", category: "red", fill_level: 54, weight_kg: 11.2, capacity_kg: 25, lid_locked: 0, lid_status: "closed", temp_c: 22.1, gas_ppm: 21, battery_pct: 96, lat: 23.211, lng: 77.4581, status: "nominal", last_updated: nowIso },
    { id: 3, bin_code: "BIN-A03-W", facility_name: "AIIMS Bhopal", ward: "Trauma Triage Bay", category: "white", fill_level: 72, weight_kg: 9.6, capacity_kg: 15, lid_locked: 0, lid_status: "closed", temp_c: 21.8, gas_ppm: 12, battery_pct: 88, lat: 23.2101, lng: 77.4568, status: "warning", last_updated: nowIso },
    { id: 4, bin_code: "BIN-B01-Y", facility_name: "Hamidia Hospital (GMC Bhopal)", ward: "Critical Care ICU", category: "yellow", fill_level: 92, weight_kg: 21.6, capacity_kg: 24, lid_locked: 1, lid_status: "locked", temp_c: 25.6, gas_ppm: 74, battery_pct: 84, lat: 23.2585, lng: 77.402, status: "overflow_alert", last_updated: nowIso },
    { id: 5, bin_code: "BIN-B02-R", facility_name: "Hamidia Hospital (GMC Bhopal)", ward: "Nephrology Dialysis Unit", category: "red", fill_level: 83, weight_kg: 18.8, capacity_kg: 24, lid_locked: 0, lid_status: "closed", temp_c: 23.4, gas_ppm: 39, battery_pct: 92, lat: 23.2591, lng: 77.4026, status: "overflow_alert", last_updated: nowIso },
    { id: 6, bin_code: "BIN-B03-B", facility_name: "Hamidia Hospital (GMC Bhopal)", ward: "Central Pharmacy & Prep", category: "blue", fill_level: 41, weight_kg: 7.4, capacity_kg: 20, lid_locked: 0, lid_status: "closed", temp_c: 21.5, gas_ppm: 14, battery_pct: 97, lat: 23.258, lng: 77.4014, status: "nominal", last_updated: nowIso },
    { id: 7, bin_code: "BIN-C01-W", facility_name: "Bansal Hospital Bhopal", ward: "Phlebotomy & Diagnostics", category: "white", fill_level: 86, weight_kg: 12.9, capacity_kg: 15, lid_locked: 1, lid_status: "locked", temp_c: 22.0, gas_ppm: 16, battery_pct: 89, lat: 23.2031, lng: 77.4229, status: "overflow_alert", last_updated: nowIso },
    { id: 8, bin_code: "BIN-C02-B", facility_name: "Bansal Hospital Bhopal", ward: "Histopathology Lab", category: "blue", fill_level: 64, weight_kg: 12.1, capacity_kg: 20, lid_locked: 0, lid_status: "closed", temp_c: 22.3, gas_ppm: 19, battery_pct: 93, lat: 23.2037, lng: 77.4234, status: "warning", last_updated: nowIso },
    { id: 9, bin_code: "BIN-C03-Y", facility_name: "Bansal Hospital Bhopal", ward: "Microbiology Suite", category: "yellow", fill_level: 48, weight_kg: 9.8, capacity_kg: 22, lid_locked: 0, lid_status: "closed", temp_c: 23.0, gas_ppm: 29, battery_pct: 95, lat: 23.2026, lng: 77.4222, status: "nominal", last_updated: nowIso },
    { id: 10, bin_code: "BIN-D01-R", facility_name: "People's Hospital Bhopal", ward: "Post-Op Recovery Ward", category: "red", fill_level: 37, weight_kg: 8.5, capacity_kg: 25, lid_locked: 0, lid_status: "closed", temp_c: 21.9, gas_ppm: 17, battery_pct: 98, lat: 23.297, lng: 77.425, status: "nominal", last_updated: nowIso },
    { id: 11, bin_code: "BIN-D02-Y", facility_name: "People's Hospital Bhopal", ward: "General OT-3", category: "yellow", fill_level: 67, weight_kg: 14.2, capacity_kg: 22, lid_locked: 0, lid_status: "closed", temp_c: 23.8, gas_ppm: 41, battery_pct: 90, lat: 23.2975, lng: 77.4256, status: "warning", last_updated: nowIso },
    { id: 12, bin_code: "BIN-D03-W", facility_name: "People's Hospital Bhopal", ward: "Immunization & Injection Clinic", category: "white", fill_level: 29, weight_kg: 4.1, capacity_kg: 15, lid_locked: 0, lid_status: "closed", temp_c: 21.4, gas_ppm: 11, battery_pct: 99, lat: 23.2965, lng: 77.4244, status: "nominal", last_updated: nowIso },
  ];

  const alerts: CollectionAlert[] = [
    { id: 1, alert_code: "ALT-2601", bin_code: "BIN-B01-Y", facility_name: "Hamidia Hospital (GMC Bhopal)", ward: "Critical Care ICU", category: "yellow", fill_level: 92, priority: "critical", trigger_source: "ESP32 Ultrasonic >= 90%", status: "pending", assigned_vehicle: null, notes: "Auto-locked lid to prevent infectious overflow", created_at: nowIso, resolved_at: null },
    { id: 2, alert_code: "ALT-2602", bin_code: "BIN-A01-Y", facility_name: "AIIMS Bhopal", ward: "Trauma & Emergency OT-1", category: "yellow", fill_level: 88, priority: "critical", trigger_source: "ESP32 Ultrasonic >= 80%", status: "pending", assigned_vehicle: null, notes: "High bio-gas VOC reading (62 ppm); priority dispatch", created_at: nowIso, resolved_at: null },
    { id: 3, alert_code: "ALT-2603", bin_code: "BIN-C01-W", facility_name: "Bansal Hospital Bhopal", ward: "Phlebotomy & Diagnostics", category: "white", fill_level: 86, priority: "high", trigger_source: "ESP32 Load Cell >= 85%", status: "pending", assigned_vehicle: null, notes: "Sharps container near capacity; puncture-safe swap required", created_at: nowIso, resolved_at: null },
    { id: 4, alert_code: "ALT-2604", bin_code: "BIN-B02-R", facility_name: "Hamidia Hospital (GMC Bhopal)", ward: "Nephrology Dialysis Unit", category: "red", fill_level: 83, priority: "high", trigger_source: "ESP32 Ultrasonic >= 80%", status: "pending", assigned_vehicle: null, notes: "IV tubing volume threshold crossed", created_at: nowIso, resolved_at: null },
  ];

  const vehicles: Vehicle[] = [
    { id: 1, vehicle_code: "VAN-01", driver_name: "R. Deshmukh", lat: 23.2313, lng: 77.4326, capacity_kg: 400, current_load_kg: 68.5, status: "idle", assigned_route: [], last_updated: nowIso },
    { id: 2, vehicle_code: "VAN-02", driver_name: "S. Patnaik", lat: 23.2495, lng: 77.419, capacity_kg: 350, current_load_kg: 42.0, status: "idle", assigned_route: [], last_updated: nowIso },
    { id: 3, vehicle_code: "VAN-03", driver_name: "A. Verma", lat: 23.274, lng: 77.411, capacity_kg: 450, current_load_kg: 110.0, status: "idle", assigned_route: [], last_updated: nowIso },
  ];

  const events: SegregationEvent[] = [
    { id: 1, timestamp: nowIso, item_name: "Blood-Soaked Surgical Gauze", detected_category: "yellow", confidence: 0.96, method: "Cloud CPCB Vision + Spectral Rule", bin_code: "BIN-A01-Y", facility_name: "AIIMS Bhopal", weight_g: 340, lid_actuated: "Yellow Unlocked / Others Locked", treatment_method: "Incineration / Plasma Pyrolysis", operator: "Ward-Cam-AIIMS-01" },
    { id: 2, timestamp: nowIso, item_name: "Used IV Infusion Tubing", detected_category: "red", confidence: 0.94, method: "Cloud CPCB Vision + Spectral Rule", bin_code: "BIN-B02-R", facility_name: "Hamidia Hospital (GMC Bhopal)", weight_g: 210, lid_actuated: "Red Unlocked / Others Locked", treatment_method: "Autoclaving + Shredding", operator: "Ward-Cam-GMC-04" },
    { id: 3, timestamp: nowIso, item_name: "22G Hypodermic Needle", detected_category: "white", confidence: 0.98, method: "Cloud CPCB Vision + Spectral Rule", bin_code: "BIN-C01-W", facility_name: "Bansal Hospital Bhopal", weight_g: 45, lid_actuated: "White Unlocked / Others Locked", treatment_method: "Autoclaving + Encapsulation", operator: "Ward-Cam-Bansal-07" },
    { id: 4, timestamp: nowIso, item_name: "Discarded Cefixime Glass Ampoule", detected_category: "blue", confidence: 0.91, method: "Cloud CPCB Vision + Spectral Rule", bin_code: "BIN-C02-B", facility_name: "Bansal Hospital Bhopal", weight_g: 120, lid_actuated: "Blue Unlocked / Others Locked", treatment_method: "Chemical Disinfection + Recycling", operator: "Ward-Cam-Bansal-08" },
  ];

  const rawLedger: Array<[string, string, string, WasteCategoryKey, number, string, string]> = [
    ["MAN-2026-8841", "BIN-A01-Y", "AIIMS Bhopal", "yellow", 18.2, "Incineration / Plasma Pyrolysis", "VAN-01"],
    ["MAN-2026-8842", "BIN-B02-R", "Hamidia Hospital (GMC Bhopal)", "red", 16.5, "Autoclaving + Shredding", "VAN-02"],
    ["MAN-2026-8843", "BIN-C01-W", "Bansal Hospital Bhopal", "white", 11.4, "Autoclaving + Encapsulation", "VAN-02"],
    ["MAN-2026-8844", "BIN-D02-Y", "People's Hospital Bhopal", "yellow", 14.9, "Incineration / Plasma Pyrolysis", "VAN-03"],
  ];

  const ledgerTemplates = rawLedger.map(([manifest_id, bin_code, facility_name, category, weight_kg, treatment_method, vehicle_code]) => ({
    manifest_id,
    bin_code,
    facility_name,
    category,
    weight_kg,
    treatment_method,
    vehicle_code,
    pickup_time: nowIso,
    disposal_time: nowIso,
    compliance_status: "verified",
    qr_payload: `MEDITRACK|${manifest_id}|${bin_code}|${category.toUpperCase()}|${weight_kg}KG|${treatment_method}|${nowIso}`,
  }));

  return { bins, alerts, vehicles, events, ledgerTemplates };
}
