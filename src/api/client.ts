import type {
  AdminAuthStatus,
  ClassificationResult,
  DashboardPayload,
  DateRangePreset,
  DisposalManifest,
  GpsConsentStatus,
  RoutePlan,
  SmartBin,
  VisitorAnalyticsPayload,
  VisitorDetailPayload,
  VisitorListPayload,
  VisitorLocationSource,
  VisitorMapMarker,
  VisitorOverviewPayload,
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

export async function fetchMapsConfig(): Promise<{ apiKey: string; mapboxToken: string }> {
  const envGoogleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const envMapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
  const initialGoogle =
    envGoogleKey && envGoogleKey !== "MY_GOOGLE_MAPS_API_KEY" ? envGoogleKey : "";
  const initialMapbox =
    envMapboxToken && envMapboxToken !== "MY_MAPBOX_ACCESS_TOKEN" ? envMapboxToken : "";

  if (initialGoogle && initialMapbox) {
    return { apiKey: initialGoogle, mapboxToken: initialMapbox };
  }

  try {
    const res = await fetch("/api/config/maps");
    if (res.ok) {
      const data = (await res.json()) as { apiKey?: string; mapboxToken?: string };
      return {
        apiKey: initialGoogle || data.apiKey || "",
        mapboxToken: initialMapbox || data.mapboxToken || "",
      };
    }
  } catch {
    // fallback to Python config endpoint on serverless deploys
  }
  try {
    const res = await fetch("/api/py/config/maps");
    if (res.ok) {
      const data = (await res.json()) as { apiKey?: string; mapboxToken?: string };
      return {
        apiKey: initialGoogle || data.apiKey || "",
        mapboxToken: initialMapbox || data.mapboxToken || "",
      };
    }
  } catch {
    // ignore
  }
  return { apiKey: initialGoogle, mapboxToken: initialMapbox };
}

export interface MapboxPlaceResult {
  id: string;
  name: string;
  locality: string;
  address: string;
  lat: number;
  lng: number;
  category?: string | null;
}

export async function searchBhopalMapboxPlaces(
  query: string
): Promise<{ places: MapboxPlaceResult[] }> {
  const qs = encodeURIComponent(query);
  const pyRes = await fetch(`/api/py/mapbox/search?q=${qs}`);
  if (pyRes.ok) {
    return parseJsonOrThrow<{ places: MapboxPlaceResult[] }>(pyRes);
  }
  const expressRes = await fetch(`/api/mapbox/search?q=${qs}`);
  if (expressRes.ok) {
    return parseJsonOrThrow<{ places: MapboxPlaceResult[] }>(expressRes);
  }
  return parseJsonOrThrow<{ places: MapboxPlaceResult[] }>(pyRes);
}

export interface MapboxDirectionsResult {
  distanceKm: number;
  durationMin: number;
  geometry: {
    type: "LineString";
    coordinates: Array<[number, number]>;
  };
  steps: Array<{
    instruction: string;
    distanceText: string;
  }>;
}

export async function fetchMapboxDirections(
  coordinates: Array<{ lat: number; lng: number }>
): Promise<MapboxDirectionsResult> {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates }),
  };
  const pyRes = await fetch("/api/py/mapbox/directions", init);
  if (pyRes.ok) {
    return parseJsonOrThrow<MapboxDirectionsResult>(pyRes);
  }
  const expressRes = await fetch("/api/mapbox/directions", init);
  if (expressRes.ok) {
    return parseJsonOrThrow<MapboxDirectionsResult>(expressRes);
  }
  return parseJsonOrThrow<MapboxDirectionsResult>(pyRes);
}

export async function registerVisitorVisit(payload: {
  visitor_id: string;
  session_id: string;
  landing_page: string;
  page_title: string;
  referrer_source: string;
  device_category: string;
  browser: string;
}): Promise<{
  opted_out: boolean;
  visitor_id: string;
  session_id: string;
  is_returning?: boolean;
  gps_consent_status: GpsConsentStatus;
  continuous_gps_consent: boolean;
  location_source?: VisitorLocationSource;
}> {
  const res = await fetch("/api/py/visitor/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function sendVisitorEvent(
  payload: {
    visitor_id: string;
    session_id: string;
    event_type: "pageview" | "heartbeat" | "end";
    page_path?: string;
    page_title?: string;
    referrer_source?: string;
    duration_sec?: number;
  },
  keepalive = false
): Promise<{ ok: boolean; duration_sec?: number; opted_out?: boolean }> {
  const res = await fetch("/api/py/visitor/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive,
  });
  return parseJsonOrThrow(res);
}

export async function updateVisitorConsent(payload: {
  visitor_id: string;
  session_id: string;
  consent_type: "gps" | "continuous_gps" | "analytics";
  status: string;
}): Promise<{
  ok: boolean;
  gps_consent_status: GpsConsentStatus;
  continuous_gps_consent: boolean;
  analytics_opt_out: boolean;
}> {
  const res = await fetch("/api/py/visitor/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function submitVisitorGpsLocation(payload: {
  visitor_id: string;
  session_id: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  location_timestamp: string;
  consent_granted?: boolean;
  is_continuous?: boolean;
}): Promise<{
  ok: boolean;
  location_source: VisitorLocationSource;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
}> {
  const res = await fetch("/api/py/visitor/location/gps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function deleteMyVisitorData(visitorId: string): Promise<{ deleted: boolean }> {
  const res = await fetch(`/api/py/visitor/me?visitor_id=${encodeURIComponent(visitorId)}`, {
    method: "DELETE",
  });
  return parseJsonOrThrow(res);
}

function adminHeaders(token?: string | null): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchAdminAuthStatus(token?: string | null): Promise<AdminAuthStatus> {
  const res = await fetch("/api/py/admin/auth/status", {
    headers: adminHeaders(token),
  });
  return parseJsonOrThrow<AdminAuthStatus>(res);
}

export async function setupInitialAdmin(passcode: string): Promise<{
  token: string;
  expiresAt: string;
  adminLabel: string;
}> {
  const res = await fetch("/api/py/admin/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passcode }),
  });
  return parseJsonOrThrow(res);
}

export async function loginAdmin(passcode: string): Promise<{
  token: string;
  expiresAt: string;
  adminLabel: string;
}> {
  const res = await fetch("/api/py/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passcode }),
  });
  return parseJsonOrThrow(res);
}

export async function logoutAdmin(token: string): Promise<void> {
  await fetch("/api/py/admin/auth/logout", {
    method: "POST",
    headers: adminHeaders(token),
  });
}

export interface VisitorFilterQuery {
  range?: DateRangePreset;
  start_date?: string;
  end_date?: string;
  source?: "all" | VisitorLocationSource;
  visitor_type?: "all" | "new" | "returning";
  search?: string;
  sort?: "latest" | "started" | "duration" | "page_views" | "visitor";
  dir?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

function buildQueryString(params: VisitorFilterQuery): string {
  const qs = new URLSearchParams();
  if (params.range) qs.set("range", params.range);
  if (params.start_date) qs.set("start_date", params.start_date);
  if (params.end_date) qs.set("end_date", params.end_date);
  if (params.source) qs.set("source", params.source);
  if (params.visitor_type) qs.set("visitor_type", params.visitor_type);
  if (params.search) qs.set("search", params.search);
  if (params.sort) qs.set("sort", params.sort);
  if (params.dir) qs.set("dir", params.dir);
  if (params.page !== undefined) qs.set("page", String(params.page));
  if (params.page_size !== undefined) qs.set("page_size", String(params.page_size));
  return qs.toString();
}

export async function fetchAdminOverview(
  token: string,
  params: Pick<VisitorFilterQuery, "range" | "start_date" | "end_date"> = {}
): Promise<VisitorOverviewPayload> {
  const qs = buildQueryString(params);
  const res = await fetch(`/api/py/admin/overview${qs ? `?${qs}` : ""}`, {
    headers: adminHeaders(token),
  });
  return parseJsonOrThrow<VisitorOverviewPayload>(res);
}

export async function fetchAdminMapMarkers(
  token: string,
  source: "all" | "gps" | "ip" = "all"
): Promise<{ markers: VisitorMapMarker[]; refreshed_at: string }> {
  const res = await fetch(`/api/py/admin/map?source=${encodeURIComponent(source)}`, {
    headers: adminHeaders(token),
  });
  return parseJsonOrThrow(res);
}

export async function fetchAdminVisitors(
  token: string,
  params: VisitorFilterQuery = {}
): Promise<VisitorListPayload> {
  const qs = buildQueryString(params);
  const res = await fetch(`/api/py/admin/visitors${qs ? `?${qs}` : ""}`, {
    headers: adminHeaders(token),
  });
  return parseJsonOrThrow<VisitorListPayload>(res);
}

export async function fetchAdminVisitorDetail(
  token: string,
  visitorId: string
): Promise<VisitorDetailPayload> {
  const res = await fetch(`/api/py/admin/visitors/${encodeURIComponent(visitorId)}`, {
    headers: adminHeaders(token),
  });
  return parseJsonOrThrow<VisitorDetailPayload>(res);
}

export async function deleteAdminVisitorRecord(
  token: string,
  visitorId: string
): Promise<{ deleted: boolean; visitor_id: string }> {
  const res = await fetch(`/api/py/admin/visitors/${encodeURIComponent(visitorId)}`, {
    method: "DELETE",
    headers: adminHeaders(token),
  });
  return parseJsonOrThrow(res);
}

export async function fetchAdminAnalytics(
  token: string,
  params: Pick<VisitorFilterQuery, "range" | "start_date" | "end_date"> = {}
): Promise<VisitorAnalyticsPayload> {
  const qs = buildQueryString(params);
  const res = await fetch(`/api/py/admin/analytics${qs ? `?${qs}` : ""}`, {
    headers: adminHeaders(token),
  });
  return parseJsonOrThrow<VisitorAnalyticsPayload>(res);
}

export async function updateAdminPrivacySettings(
  token: string,
  payload: {
    retention_days?: number;
    ip_geo_provider?: string;
    run_cleanup?: boolean;
  }
): Promise<{
  retention_days: number;
  ip_geo_provider: string;
  pruned_count: number;
}> {
  const res = await fetch("/api/py/admin/settings", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...adminHeaders(token),
    },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function acknowledgeAdminNotification(
  token: string,
  id?: number
): Promise<{ ok: boolean }> {
  const res = await fetch("/api/py/admin/notifications/ack", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...adminHeaders(token),
    },
    body: JSON.stringify(id !== undefined ? { id } : {}),
  });
  return parseJsonOrThrow(res);
}

export async function downloadAdminVisitorsCsv(
  token: string,
  params: VisitorFilterQuery = {}
): Promise<void> {
  const qs = buildQueryString(params);
  const res = await fetch(`/api/py/admin/visitors/export${qs ? `?${qs}` : ""}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) {
    throw new Error(`Export failed with status ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "meditrack_visitor_analytics.csv";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}


