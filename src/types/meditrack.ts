export type WasteCategoryKey = "yellow" | "red" | "white" | "blue";

export type BinStatus = "nominal" | "warning" | "overflow_alert" | "dispatched";

export type ActiveTab =
  | "overview"
  | "segregation"
  | "fleet"
  | "routes"
  | "compliance"
  | "visitors";

export interface SmartBin {
  id: number;
  bin_code: string;
  facility_name: string;
  ward: string;
  category: WasteCategoryKey;
  fill_level: number;
  weight_kg: number;
  capacity_kg: number;
  lid_locked: number;
  lid_status: string;
  temp_c: number;
  gas_ppm: number;
  battery_pct: number;
  lat: number;
  lng: number;
  status: BinStatus;
  last_updated: string;
}

export interface CollectionAlert {
  id: number;
  alert_code: string;
  bin_code: string;
  facility_name: string;
  ward: string;
  category: WasteCategoryKey;
  fill_level: number;
  priority: "critical" | "high" | "normal";
  trigger_source: string;
  status: "pending" | "assigned" | "collected";
  assigned_vehicle: string | null;
  notes: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface RouteStop {
  stop_order: number;
  alert_code: string;
  bin_code: string;
  facility_name: string;
  ward: string;
  category: WasteCategoryKey;
  fill_level: number;
  weight_kg: number;
  priority: string;
  lat: number;
  lng: number;
  leg_distance_km: number;
}

export interface Vehicle {
  id: number;
  vehicle_code: string;
  driver_name: string;
  lat: number;
  lng: number;
  capacity_kg: number;
  current_load_kg: number;
  status: string;
  assigned_route: RouteStop[];
  last_updated: string;
}

export interface SegregationEvent {
  id: number;
  timestamp: string;
  item_name: string;
  detected_category: WasteCategoryKey;
  confidence: number;
  method: string;
  bin_code: string;
  facility_name: string;
  weight_g: number;
  lid_actuated: string;
  treatment_method: string;
  operator: string;
}

export interface DisposalManifest {
  id: number;
  manifest_id: string;
  qr_payload: string;
  bin_code: string;
  facility_name: string;
  category: WasteCategoryKey;
  weight_kg: number;
  treatment_method: string;
  vehicle_code: string;
  pickup_time: string;
  disposal_time: string;
  compliance_status: string;
  chain_hash: string;
}

export interface CategoryBreakdown {
  category: WasteCategoryKey;
  label: string;
  bin_color: string;
  treatment: string;
  bin_count: number;
  avg_fill: number;
  active_mass_kg: number;
}

export interface BenchmarkMetric {
  metric: string;
  legacy_pct: number;
  meditrack_pct: number;
}

export interface FacilityNode {
  name: string;
  code: string;
  lat: number;
  lng: number;
  zone: string;
}

export interface PredictiveAlert {
  bin_code: string;
  facility_name: string;
  ward: string;
  category: WasteCategoryKey;
  fill_level: number;
  fill_rate_pct_per_hr: number;
  hours_to_full: number;
  hours_to_threshold: number;
  projected_full_at: string;
  risk_level: "imminent" | "upcoming" | "stable";
  recommended_action: string;
  already_queued: boolean;
}

export interface DailyWasteTrend {
  date: string;
  day_label: string;
  yellow_kg: number;
  red_kg: number;
  white_kg: number;
  blue_kg: number;
  total_kg: number;
}

export interface FacilityComplianceStatus {
  facility_code: string;
  facility_name: string;
  zone: string;
  total_bins: number;
  overflow_bins: number;
  warning_bins: number;
  locked_bins: number;
  avg_fill_level: number;
  tracked_mass_kg: number;
  pending_alerts: number;
  verified_disposals: number;
  compliance_status: "Action Required" | "Watch" | "Compliant";
  last_updated: string;
}

export interface DashboardPayload {
  kpis: {
    total_bins: number;
    overflow_bins: number;
    pending_alerts: number;
    total_mass_kg: number;
    segregated_events: number;
    verified_disposals: number;
    active_vehicles: number;
  };
  facilities: FacilityNode[];
  treatment_plant: {
    name: string;
    lat: number;
    lng: number;
  };
  bins: SmartBin[];
  alerts: CollectionAlert[];
  vehicles: Vehicle[];
  segregation_events: SegregationEvent[];
  disposal_ledger: DisposalManifest[];
  category_breakdown: CategoryBreakdown[];
  benchmarks: BenchmarkMetric[];
  predictive_alerts: PredictiveAlert[];
  daily_trends: DailyWasteTrend[];
  facility_compliance?: FacilityComplianceStatus[];
}

export interface ClassificationResult {
  category: WasteCategoryKey;
  category_label: string;
  bin_color: string;
  treatment_method: string;
  hazard_level: string;
  confidence: number;
  method: string;
  lid_actuated: string;
  reasoning: string;
}

export interface RoutePlan {
  optimized: boolean;
  message?: string;
  vehicle_code: string | null;
  driver_name?: string;
  stops: RouteStop[];
  to_treatment_plant_km?: number;
  total_distance_km: number;
  baseline_distance_km: number;
  distance_saved_km: number;
  fuel_saved_liters?: number;
  estimated_minutes: number;
}

export type GpsConsentStatus = "unset" | "granted" | "denied" | "revoked";
export type VisitorLocationSource = "gps" | "ip" | "none";
export type DateRangePreset = "today" | "yesterday" | "7d" | "30d" | "all" | "custom";

export interface VisitorSessionState {
  visitorId: string;
  sessionId: string;
  isReturning: boolean;
  gpsConsentStatus: GpsConsentStatus;
  continuousGpsConsent: boolean;
  analyticsOptOut: boolean;
  locationSource: VisitorLocationSource;
}

export interface AdminAuthStatus {
  configured: boolean;
  source: "env" | "claimed" | "unconfigured";
  authenticated: boolean;
  adminLabel: string | null;
  expiresAt: string | null;
}

export interface AdminNotificationItem {
  id: number;
  severity: "info" | "warning";
  title: string;
  message: string;
  created_at: string;
  acknowledged: number;
}

export interface VisitorOverviewPayload {
  kpis: {
    total_visitors: number;
    unique_visitors: number;
    returning_visitors: number;
    returning_sessions: number;
    active_sessions: number;
    gps_visitors: number;
    ip_visitors: number;
    total_page_views: number;
    avg_session_duration_sec: number;
  };
  notifications: AdminNotificationItem[];
  retention_days: number;
  ip_geo_provider: string;
}

export interface VisitorMapMarker {
  session_id: string;
  visitor_id: string;
  location_source: VisitorLocationSource;
  is_estimated: boolean;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  location_timestamp: string | null;
  country: string;
  region: string;
  city: string;
  device_category: string;
  browser: string;
  duration_sec: number;
  is_returning: boolean;
  current_page: string;
  last_active_at: string;
  is_active: boolean;
  gps_consent_status: GpsConsentStatus;
}

export interface VisitorRecord {
  session_id: string;
  visitor_id: string;
  started_at: string;
  last_active_at: string;
  duration_sec: number;
  is_returning: boolean;
  visit_count: number;
  landing_page: string;
  current_page: string;
  referrer_source: string;
  page_views_count: number;
  device_category: string;
  browser: string;
  location_source: VisitorLocationSource;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  location_timestamp: string | null;
  country: string;
  region: string;
  city: string;
  gps_consent_status: GpsConsentStatus;
  is_active: boolean;
}

export interface VisitorListPayload {
  records: VisitorRecord[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface VisitorDetailPayload {
  profile: {
    visitor_id: string;
    first_seen_at: string;
    last_seen_at: string;
    visit_count: number;
    gps_consent_status: GpsConsentStatus;
    gps_consent_updated_at: string | null;
    continuous_gps_consent: boolean;
    analytics_opt_out: boolean;
    device_category: string;
    browser: string;
    os_family: string;
  };
  latest_location: {
    location_source: VisitorLocationSource;
    latitude: number | null;
    longitude: number | null;
    accuracy_m: number | null;
    country: string | null;
    region: string | null;
    city: string | null;
    location_timestamp: string | null;
  };
  sessions: Array<{
    session_id: string;
    started_at: string;
    last_active_at: string;
    duration_sec: number;
    is_returning: number;
    landing_page: string;
    current_page: string;
    referrer_source: string;
    page_views_count: number;
    device_category: string;
    browser: string;
    location_source: VisitorLocationSource;
    latitude: number | null;
    longitude: number | null;
    accuracy_m: number | null;
    country: string | null;
    region: string | null;
    city: string | null;
    gps_consent_status: GpsConsentStatus;
  }>;
  page_views: Array<{
    id: number;
    session_id: string;
    page_path: string;
    page_title: string;
    referrer_source: string;
    viewed_at: string;
  }>;
  location_events: Array<{
    id: number;
    session_id: string;
    location_source: VisitorLocationSource;
    latitude: number | null;
    longitude: number | null;
    accuracy_m: number | null;
    country: string | null;
    region: string | null;
    city: string | null;
    recorded_at: string;
  }>;
  consent_logs: Array<{
    id: number;
    session_id: string;
    consent_type: string;
    status: string;
    recorded_at: string;
  }>;
}

export interface TrafficPoint {
  period: string;
  visits: number;
  unique_visitors: number;
  returning_visits: number;
}

export interface VisitorAnalyticsPayload {
  daily_traffic: TrafficPoint[];
  weekly_traffic: TrafficPoint[];
  monthly_traffic: TrafficPoint[];
  new_vs_returning: {
    new_sessions: number;
    returning_sessions: number;
  };
  countries: Array<{ name: string; count: number }>;
  cities: Array<{ city: string; region: string; country: string; count: number }>;
  top_pages: Array<{ page_path: string; views: number; unique_visitors: number }>;
  referrers: Array<{ source: string; count: number }>;
  devices: Array<{ name: string; count: number }>;
  browsers: Array<{ name: string; count: number }>;
}

