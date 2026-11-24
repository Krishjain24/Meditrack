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
  minLat: 26.803,
  maxLat: 26.870,
  minLng: 80.915,
  maxLng: 80.993,
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
