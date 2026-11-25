import type {
  BinStatus,
  DisposalManifest,
  SmartBin,
  WasteCategoryKey,
} from "../types/meditrack";

export interface CategoryMeta {
  key: WasteCategoryKey;
  shortLabel: string;
  fullLabel: string;
  treatment: string;
  swatchClass: string;
  textClass: string;
  surfaceClass: string;
  borderClass: string;
  barClass: string;
}

const CATEGORY_MAP: Record<WasteCategoryKey, CategoryMeta> = {
  yellow: {
    key: "yellow",
    shortLabel: "Yellow",
    fullLabel: "Infectious & Anatomical",
    treatment: "Incineration / Plasma Pyrolysis",
    swatchClass: "bg-amber-500",
    textClass: "text-amber-800",
    surfaceClass: "bg-amber-50",
    borderClass: "border-amber-200",
    barClass: "bg-amber-500",
  },
  red: {
    key: "red",
    shortLabel: "Red",
    fullLabel: "Contaminated Recyclables",
    treatment: "Autoclaving + Shredding",
    swatchClass: "bg-rose-600",
    textClass: "text-rose-800",
    surfaceClass: "bg-rose-50",
    borderClass: "border-rose-200",
    barClass: "bg-rose-600",
  },
  white: {
    key: "white",
    shortLabel: "White",
    fullLabel: "Waste Sharps & Needles",
    treatment: "Autoclaving + Encapsulation",
    swatchClass: "bg-slate-600",
    textClass: "text-slate-800",
    surfaceClass: "bg-slate-100",
    borderClass: "border-slate-300",
    barClass: "bg-slate-600",
  },
  blue: {
    key: "blue",
    shortLabel: "Blue",
    fullLabel: "Glassware & Implants",
    treatment: "Disinfection + Recycling",
    swatchClass: "bg-blue-600",
    textClass: "text-blue-800",
    surfaceClass: "bg-blue-50",
    borderClass: "border-blue-200",
    barClass: "bg-blue-600",
  },
};

export function getCategoryMeta(category: WasteCategoryKey): CategoryMeta {
  return CATEGORY_MAP[category] ?? CATEGORY_MAP.yellow;
}

export interface StatusDisplay {
  label: string;
  symbol: string;
  textClass: string;
}

export function getBinStatusDisplay(status: BinStatus): StatusDisplay {
  switch (status) {
    case "overflow_alert":
      return {
        label: "Overflow Alert",
        symbol: "■",
        textClass: "text-rose-700",
      };
    case "dispatched":
      return {
        label: "Unit Dispatched",
        symbol: "◆",
        textClass: "text-blue-700",
      };
    case "warning":
      return {
        label: "High Fill",
        symbol: "▲",
        textClass: "text-amber-700",
      };
    default:
      return {
        label: "Nominal",
        symbol: "●",
        textClass: "text-emerald-700",
      };
  }
}

export function formatUtcTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function filterBins(
  bins: SmartBin[],
  statusFilter: string,
  searchQuery: string
): SmartBin[] {
  const q = searchQuery.trim().toLowerCase();
  return bins.filter((b) => {
    const matchesStatus = statusFilter === "all" || b.status === statusFilter;
    const matchesQuery =
      !q ||
      b.bin_code.toLowerCase().includes(q) ||
      b.facility_name.toLowerCase().includes(q) ||
      b.ward.toLowerCase().includes(q) ||
      b.category.toLowerCase().includes(q);
    return matchesStatus && matchesQuery;
  });
}

export function filterLedger(
  ledger: DisposalManifest[],
  categoryFilter: string,
  searchQuery: string
): DisposalManifest[] {
  const q = searchQuery.trim().toLowerCase();
  return ledger.filter((item) => {
    const matchesCat = categoryFilter === "all" || item.category === categoryFilter;
    const matchesQuery =
      !q ||
      item.manifest_id.toLowerCase().includes(q) ||
      item.bin_code.toLowerCase().includes(q) ||
      item.facility_name.toLowerCase().includes(q) ||
      item.vehicle_code.toLowerCase().includes(q);
    return matchesCat && matchesQuery;
  });
}

export interface MapBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export const CORRIDOR_BOUNDS: MapBounds = {
  minLat: 23.19,
  maxLat: 23.31,
  minLng: 77.39,
  maxLng: 77.47,
};

export function projectLatLngToSvg(
  lat: number,
  lng: number,
  width = 760,
  height = 420,
  padding = 48,
  bounds: MapBounds = CORRIDOR_BOUNDS
): { x: number; y: number } {
  const usableW = width - padding * 2;
  const usableH = height - padding * 2;
  const xNorm = (lng - bounds.minLng) / Math.max(0.0001, bounds.maxLng - bounds.minLng);
  const yNorm = (lat - bounds.minLat) / Math.max(0.0001, bounds.maxLat - bounds.minLat);

  const x = Math.round(padding + Math.min(1, Math.max(0, xNorm)) * usableW);
  const y = Math.round(height - padding - Math.min(1, Math.max(0, yNorm)) * usableH);
  return { x, y };
}

export interface ClinicalSpecimen {
  id: string;
  item_name: string;
  description: string;
  weight_g: number;
  expected_category: WasteCategoryKey;
}

export const CLINICAL_SPECIMENS: ClinicalSpecimen[] = [
  {
    id: "spec-gauze",
    item_name: "Blood-Soaked Surgical Gauze",
    description: "Post-operative dressing saturated with patient blood and exudate",
    weight_g: 320,
    expected_category: "yellow",
  },
  {
    id: "spec-iv",
    item_name: "Used IV Tubing & Saline Bag",
    description: "Contaminated PVC intravenous infusion line and empty polymer bag",
    weight_g: 280,
    expected_category: "red",
  },
  {
    id: "spec-needle",
    item_name: "22G Hypodermic Needle & Scalpel",
    description: "Stainless steel phlebotomy needle and disposable surgical blade",
    weight_g: 65,
    expected_category: "white",
  },
  {
    id: "spec-ampoule",
    item_name: "Discarded Glass Medicine Ampoule",
    description: "Opened glass antibiotic vial and broken laboratory slide",
    weight_g: 140,
    expected_category: "blue",
  },
  {
    id: "spec-gloves",
    item_name: "Contaminated Nitrile Gloves & Catheter",
    description: "Single-use examination gloves and latex urinary catheter",
    weight_g: 195,
    expected_category: "red",
  },
  {
    id: "spec-culture",
    item_name: "Microbiology Agar Culture Plate",
    description: "Pathology specimen dish with expired diagnostic reagents",
    weight_g: 210,
    expected_category: "yellow",
  },
];

export function formatDurationHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "At capacity";
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export interface LocalBinForecast {
  bin_code: string;
  fill_rate_pct_per_hr: number;
  hours_to_full: number;
  risk_level: "imminent" | "upcoming" | "stable";
}

export function computeBinForecasts(bins: SmartBin[]): LocalBinForecast[] {
  return bins
    .map((b) => {
      const ward = b.ward.toLowerCase();
      let rate = 3.2;
      if (ward.includes("icu") || ward.includes("emergency") || ward.includes("trauma")) {
        rate = 5.8;
      } else if (ward.includes("ot") || ward.includes("dialysis") || ward.includes("phlebotomy")) {
        rate = 4.6;
      } else if (ward.includes("lab") || ward.includes("microbiology") || ward.includes("recovery")) {
        rate = 3.5;
      }
      if (b.category === "yellow") rate *= 1.15;
      else if (b.category === "red") rate *= 1.1;
      else if (b.category === "white") rate *= 0.95;
      else rate *= 0.85;

      if (b.gas_ppm >= 50) rate += 0.8;
      else if (b.gas_ppm >= 30) rate += 0.35;

      const roundedRate = Math.round(rate * 100) / 100;
      const hoursToFull =
        Math.round((Math.max(0, 100 - b.fill_level) / Math.max(0.5, roundedRate)) * 10) / 10;

      const risk_level: "imminent" | "upcoming" | "stable" =
        b.fill_level >= 85 || hoursToFull <= 4
          ? "imminent"
          : b.fill_level >= 60 || hoursToFull <= 12
          ? "upcoming"
          : "stable";

      return {
        bin_code: b.bin_code,
        fill_rate_pct_per_hr: roundedRate,
        hours_to_full: hoursToFull,
        risk_level,
      };
    })
    .sort((a, b) => a.hours_to_full - b.hours_to_full);
}

export interface PlaceAddressComponentLike {
  longText?: string | null;
  shortText?: string | null;
  types?: string[];
}

export function extractBhopalLocality(
  addressComponents?: PlaceAddressComponentLike[] | null,
  formattedAddress?: string | null
): string {
  if (addressComponents && addressComponents.length > 0) {
    const priorityTypes = [
      "sublocality_level_1",
      "sublocality_level_2",
      "sublocality",
      "neighborhood",
      "sublocality_level_3",
    ];
    for (const targetType of priorityTypes) {
      const match = addressComponents.find((c) => c.types?.includes(targetType));
      const label = (match?.longText || match?.shortText || "").trim();
      if (label && label.toLowerCase() !== "bhopal") {
        return label;
      }
    }
  }

  if (formattedAddress) {
    const parts = formattedAddress
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    for (const part of parts) {
      const lower = part.toLowerCase();
      if (
        !lower.includes("bhopal") &&
        !lower.includes("madhya pradesh") &&
        lower !== "india" &&
        !/^\d{6}$/.test(part)
      ) {
        return part;
      }
    }
  }
  return "Bhopal";
}

export function getComplianceStatusDisplay(
  status: "Action Required" | "Watch" | "Compliant"
): StatusDisplay {
  switch (status) {
    case "Action Required":
      return { label: "Action Required", symbol: "■", textClass: "text-rose-700" };
    case "Watch":
      return { label: "Watch", symbol: "▲", textClass: "text-amber-700" };
    default:
      return { label: "Compliant", symbol: "●", textClass: "text-emerald-700" };
  }
}

export function isMapsQuotaError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
      ? err
      : JSON.stringify(err || "");
  const upper = msg.toUpperCase();
  return (
    upper.includes("RESOURCE_EXHAUSTED") ||
    upper.includes("OVER_QUERY_LIMIT") ||
    upper.includes("OVERQUOTAMAPERROR") ||
    upper.includes("QUOTAEXCEEDED") ||
    upper.includes("429")
  );
}

export interface BhopalMapPlace {
  id: string;
  name: string;
  locality: string;
  address: string;
  lat: number;
  lng: number;
  rating?: number | null;
  userRatingCount?: number | null;
  googleMapsURI?: string | null;
}

export function buildSeedBhopalHospitalPlaces(
  facilities: Array<{ name: string; code: string; lat: number; lng: number; zone: string }>
): BhopalMapPlace[] {
  return facilities.map((f) => ({
    id: f.code,
    name: f.name,
    locality: f.zone.split(",")[0].trim() || "Bhopal",
    address: `${f.zone}, Bhopal, Madhya Pradesh, India`,
    lat: f.lat,
    lng: f.lng,
  }));
}

export interface MapboxFeatureLike {
  id?: string;
  text?: string;
  place_name?: string;
  center?: [number, number];
  context?: Array<{ id?: string; text?: string }>;
}

export function parseMapboxPlaceFeatures(
  features: MapboxFeatureLike[]
): BhopalMapPlace[] {
  const out: BhopalMapPlace[] = [];
  for (const feat of features) {
    if (!feat.center || feat.center.length < 2) continue;
    const [lng, lat] = feat.center;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const address = (feat.place_name || "Bhopal, Madhya Pradesh, India").trim();
    let locality = "Bhopal";
    for (const ctx of feat.context || []) {
      const id = ctx.id || "";
      const txt = (ctx.text || "").trim();
      if (
        (id.startsWith("neighborhood.") || id.startsWith("locality.") || id.startsWith("district.")) &&
        txt &&
        txt.toLowerCase() !== "bhopal"
      ) {
        locality = txt;
        break;
      }
    }
    if (locality === "Bhopal") {
      locality = extractBhopalLocality(null, address);
    }
    out.push({
      id: feat.id || `mb-${lat.toFixed(5)}-${lng.toFixed(5)}`,
      name: (feat.text || address).trim(),
      locality,
      address,
      lat,
      lng,
    });
  }
  return out;
}


