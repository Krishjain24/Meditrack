export type WasteCategoryKey = "yellow" | "red" | "white" | "blue";

export type BinStatus = "nominal" | "warning" | "overflow_alert" | "dispatched";

export type ActiveTab =
  | "overview"
  | "segregation"
  | "fleet"
  | "routes"
  | "compliance";

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
