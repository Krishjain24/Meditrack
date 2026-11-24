import type {
  ClassificationResult,
  DashboardPayload,
  DisposalManifest,
  RoutePlan,
  SmartBin,
  WasteCategoryKey,
} from "../types/meditrack";

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Unexpected server response (${res.status})`);
  }
  if (!res.ok) {
    const errMsg =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed with status ${res.status}`;
    throw new Error(errMsg);
  }
  return data as T;
}

export async function fetchDashboard(): Promise<DashboardPayload> {
  const res = await fetch("/api/py/dashboard");
  return parseJsonOrThrow<DashboardPayload>(res);
}

export async function fetchPythonHealth(): Promise<{
  status: string;
  engine: string;
  database: string;
  smart_bins: number;
}> {
  const res = await fetch("/api/py/health");
  return parseJsonOrThrow(res);
}

export async function segregateWaste(payload: {
  item_name: string;
  description: string;
  facility_name: string;
  weight_g: number;
  image_base64?: string;
  hint_category?: string;
}): Promise<{
  classification: ClassificationResult;
  bin: SmartBin;
  alert_triggered: unknown;
  dashboard: DashboardPayload;
}> {
  const res = await fetch("/api/py/segregate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function classifyImageWithGemini(payload: {
  image_base64: string;
  mime_type: string;
  notes?: string;
}): Promise<{
  item_name: string;
  category: WasteCategoryKey;
  confidence: number;
  reasoning: string;
}> {
  const res = await fetch("/api/ai/classify-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function registerSmartBin(payload: {
  bin_code: string;
  facility_name: string;
  ward: string;
  category: WasteCategoryKey;
  capacity_kg: number;
  fill_level?: number;
}): Promise<{ bin: SmartBin; dashboard: DashboardPayload }> {
  const res = await fetch("/api/py/bins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function sendBinTelemetryAction(payload: {
  action: "record_reading" | "poll_sensors" | "toggle_lock" | "simulate_drop" | "simulate_tick";
  bin_code?: string;
  delta_fill?: number;
  fill_level?: number;
  weight_kg?: number;
  gas_ppm?: number;
}): Promise<{ dashboard: DashboardPayload }> {
  const res = await fetch("/api/py/bins/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function createPickupRequest(payload: {
  facility_name: string;
  category: WasteCategoryKey;
  priority: "critical" | "high" | "normal";
  notes: string;
  bin_code?: string;
}): Promise<{ alert_code: string; dashboard: DashboardPayload }> {
  const res = await fetch("/api/py/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function optimizeRoutes(vehicle_code?: string): Promise<{
  plan: RoutePlan;
  dashboard: DashboardPayload;
}> {
  const res = await fetch("/api/py/routes/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(vehicle_code ? { vehicle_code } : {}),
  });
  return parseJsonOrThrow(res);
}

export async function completeBinCollection(payload: {
  bin_code: string;
  vehicle_code?: string;
}): Promise<{
  collected: boolean;
  bin_code: string;
  vehicle_code: string;
  manifest: DisposalManifest | null;
  dashboard: DashboardPayload;
}> {
  const res = await fetch("/api/py/vehicles/collect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function verifyManifestHash(manifest_id: string): Promise<{
  manifest_id: string;
  valid: boolean;
  chain_hash: string;
  qr_payload: string;
}> {
  const res = await fetch("/api/py/ledger/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manifest_id }),
  });
  return parseJsonOrThrow(res);
}

export async function fetchMapsConfig(): Promise<{ apiKey: string }> {
  const envKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (envKey && envKey !== "MY_GOOGLE_MAPS_API_KEY") {
    return { apiKey: envKey };
  }
  try {
    const res = await fetch("/api/config/maps");
    if (res.ok) {
      const data = (await res.json()) as { apiKey?: string };
      if (data.apiKey) return { apiKey: data.apiKey };
    }
  } catch {
    // fallback to Python config endpoint on serverless deploys
  }
  try {
    const res = await fetch("/api/py/config/maps");
    if (res.ok) {
      const data = (await res.json()) as { apiKey?: string };
      return { apiKey: data.apiKey || "" };
    }
  } catch {
    // ignore
  }
  return { apiKey: "" };
}
