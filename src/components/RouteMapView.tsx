import { useState } from "react";
import { CheckCircle2, Navigation, Truck } from "lucide-react";
import { completeBinCollection, optimizeRoutes } from "../api/client";
import type { DashboardPayload, RoutePlan } from "../types/meditrack";
import { getCategoryMeta, projectLatLngToSvg } from "../utils/wasteLogic";

interface RouteMapViewProps {
  data: DashboardPayload;
  onDataUpdated: (dashboard: DashboardPayload) => void;
}

export function RouteMapView({ data, onDataUpdated }: RouteMapViewProps) {
  const [selectedVehicle, setSelectedVehicle] = useState<string>("");
  const [routePlan, setRoutePlan] = useState<RoutePlan | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [collectingBin, setCollectingBin] = useState<string | null>(null);
  const [lastMintMsg, setLastMintMsg] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const activeVehicleObj = data.vehicles.find(
    (v) => v.assigned_route && v.assigned_route.length > 0
  );
  const displayedStops =
    routePlan?.stops && routePlan.stops.length > 0
      ? routePlan.stops
      : activeVehicleObj?.assigned_route ?? [];
  const displayedVehicleCode =
    routePlan?.vehicle_code || activeVehicleObj?.vehicle_code || null;
  const displayedVehicle = data.vehicles.find(
    (v) => v.vehicle_code === displayedVehicleCode
  );

  async function handleOptimize() {
    setOptimizing(true);
    setErrorMsg("");
    setLastMintMsg("");
    try {
      const res = await optimizeRoutes(selectedVehicle || undefined);
      setRoutePlan(res.plan);
      onDataUpdated(res.dashboard);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Route optimization failed");
    } finally {
      setOptimizing(false);
    }
  }

  async function handleCollectStop(binCode: string, vehicleCode?: string | null) {
    setCollectingBin(binCode);
    setErrorMsg("");
    try {
      const res = await completeBinCollection({
        bin_code: binCode,
        vehicle_code: vehicleCode || undefined,
      });
      onDataUpdated(res.dashboard);
      if (routePlan) {
        setRoutePlan({
          ...routePlan,
          stops: routePlan.stops.filter((s) => s.bin_code !== binCode),
        });
      }
      if (res.manifest) {
        setLastMintMsg(
          `Collected ${binCode} (${res.manifest.weight_kg} kg). Minted QR manifest ${res.manifest.manifest_id}.`
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Collection update failed");
    } finally {
      setCollectingBin(null);
    }
  }

  const mapW = 760;
  const mapH = 420;
  const plantPt = projectLatLngToSvg(
    data.treatment_plant.lat,
    data.treatment_plant.lng,
    mapW,
    mapH
  );

  // Build route polyline points
  const polylinePoints: string[] = [];
  if (displayedVehicle && displayedStops.length > 0) {
    const startPt = projectLatLngToSvg(
      displayedVehicle.lat,
      displayedVehicle.lng,
      mapW,
      mapH
    );
    polylinePoints.push(`${startPt.x},${startPt.y}`);
    for (const stop of displayedStops) {
      const p = projectLatLngToSvg(stop.lat, stop.lng, mapW, mapH);
      polylinePoints.push(`${p.x},${p.y}`);
    }
    polylinePoints.push(`${plantPt.x},${plantPt.y}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            GPS Collection &amp; Route Optimization Engine
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Assigns the nearest mobile collection unit and orders stops by fill-level severity,
            eliminating wasted fixed-schedule fleet trips.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <label htmlFor="route-vehicle-select" className="sr-only">
            Collection Vehicle
          </label>
          <select
            id="route-vehicle-select"
            value={selectedVehicle}
            onChange={(e) => setSelectedVehicle(e.target.value)}
            className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
          >
            <option value="">Auto-Assign Nearest Unit</option>
            {data.vehicles.map((v) => (
              <option key={v.vehicle_code} value={v.vehicle_code}>
                {v.vehicle_code} ({v.driver_name})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleOptimize}
            disabled={optimizing}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            <Navigation className="w-4 h-4" aria-hidden="true" />
            <span>{optimizing ? "Optimizing..." : "Optimize Collection Route"}</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-3 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg"
        >
          {errorMsg}
        </div>
      )}

      {lastMintMsg && (
        <div className="p-3 text-xs font-medium text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
          <span>{lastMintMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Interactive Spatial SVG Corridor Map */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              Medical Corridor Spatial Dispatch Map
            </h2>
            <span className="text-xs font-mono text-slate-500">
              {displayedStops.length} active stops queued
            </span>
          </div>

          <div className="border border-slate-200 rounded-lg bg-slate-50 overflow-hidden">
            <svg
              viewBox={`0 0 ${mapW} ${mapH}`}
              className="w-full h-auto block"
              role="img"
              aria-label="Medical waste collection GPS corridor map"
              data-testid="gps-route-map"
            >
              {/* Subtle coordinate grid */}
              {[1, 2, 3, 4, 5].map((i) => (
                <line
                  key={`gx-${i}`}
                  x1={(mapW / 6) * i}
                  y1={0}
                  x2={(mapW / 6) * i}
                  y2={mapH}
                  stroke="#e2e8f0"
                  strokeWidth="1"
                />
              ))}
              {[1, 2, 3].map((i) => (
                <line
                  key={`gy-${i}`}
                  x1={0}
                  y1={(mapH / 4) * i}
                  x2={mapW}
                  y2={(mapH / 4) * i}
                  stroke="#e2e8f0"
                  strokeWidth="1"
                />
              ))}

              {/* Optimized Route Polyline */}
              {polylinePoints.length >= 2 && (
                <polyline
                  points={polylinePoints.join(" ")}
                  fill="none"
                  stroke="#1d4ed8"
                  strokeWidth="3"
                  strokeDasharray="6 4"
                />
              )}

              {/* Facility Nodes */}
              {data.facilities.map((fac) => {
                const pt = projectLatLngToSvg(fac.lat, fac.lng, mapW, mapH);
                const facBins = data.bins.filter((b) => b.facility_name === fac.name);
                const alertCount = facBins.filter((b) => b.fill_level >= 80).length;

                return (
                  <g key={fac.code}>
                    {alertCount > 0 && (
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={19}
                        fill="#fecdd3"
                        stroke="#e11d48"
                        strokeWidth="1.5"
                      />
                    )}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={10}
                      fill={alertCount > 0 ? "#be123c" : "#0f172a"}
                      stroke="#ffffff"
                      strokeWidth="2"
                    />
                    <text
                      x={pt.x}
                      y={pt.y - 16}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="600"
                      fill="#0f172a"
                    >
                      {fac.code} · {fac.name.split(" ")[0]}
                    </text>
                    {alertCount > 0 && (
                      <text
                        x={pt.x}
                        y={pt.y + 24}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="600"
                        fill="#be123c"
                      >
                        {alertCount} overflow
                      </text>
                    )}
                  </g>
                );
              })}

              {/* CBWTF Treatment Plant */}
              <g>
                <rect
                  x={plantPt.x - 11}
                  y={plantPt.y - 11}
                  width={22}
                  height={22}
                  rx={4}
                  fill="#047857"
                  stroke="#ffffff"
                  strokeWidth="2"
                />
                <text
                  x={plantPt.x}
                  y={plantPt.y + 24}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="600"
                  fill="#065f46"
                >
                  CBWTF Disposal Plant
                </text>
              </g>

              {/* Fleet Vehicles */}
              {data.vehicles.map((veh) => {
                const pt = projectLatLngToSvg(veh.lat, veh.lng, mapW, mapH);
                const isSelected = veh.vehicle_code === displayedVehicleCode;
                return (
                  <g key={veh.vehicle_code}>
                    <rect
                      x={pt.x - 14}
                      y={pt.y - 10}
                      width={28}
                      height={20}
                      rx={4}
                      fill={isSelected ? "#1d4ed8" : "#475569"}
                      stroke="#ffffff"
                      strokeWidth="2"
                    />
                    <text
                      x={pt.x}
                      y={pt.y + 3.5}
                      textAnchor="middle"
                      fontSize="9"
                      fontWeight="700"
                      fill="#ffffff"
                    >
                      {veh.vehicle_code.replace("VAN-", "V")}
                    </text>
                  </g>
                );
              })}

              {/* Numbered Stop Markers */}
              {displayedStops.map((stop) => {
                const pt = projectLatLngToSvg(stop.lat, stop.lng, mapW, mapH);
                return (
                  <g key={stop.bin_code}>
                    <circle
                      cx={pt.x + 14}
                      cy={pt.y - 12}
                      r={9}
                      fill="#1d4ed8"
                      stroke="#ffffff"
                      strokeWidth="1.5"
                    />
                    <text
                      x={pt.x + 14}
                      y={pt.y - 8.5}
                      textAnchor="middle"
                      fontSize="9"
                      fontWeight="700"
                      fill="#ffffff"
                    >
                      {stop.stop_order}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Map Legend */}
          <div className="flex flex-wrap items-center gap-5 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-rose-700" aria-hidden="true" />
              <span>Overflowing Facility</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-blue-700" aria-hidden="true" />
              <span>Assigned Truck</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-emerald-700" aria-hidden="true" />
              <span>CBWTF Treatment Plant</span>
            </span>
          </div>
        </section>

        {/* Right: Route Metrics & Dispatch Queue */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Optimized Dispatch Plan
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Priority-weighted Haversine TSP order vs. fixed routine collection
            </p>
          </div>

          {routePlan && routePlan.optimized && (
            <div className="grid grid-cols-2 gap-3 p-4 bg-blue-50/60 border border-blue-200 rounded-xl text-xs">
              <div>
                <span className="text-slate-500 block">Assigned Unit</span>
                <span className="font-mono font-bold text-slate-900 text-sm">
                  {routePlan.vehicle_code} · {routePlan.driver_name}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Optimized Distance</span>
                <span className="font-mono tabular-nums font-bold text-slate-900 text-sm">
                  {routePlan.total_distance_km} km ({routePlan.estimated_minutes} min)
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Distance Saved vs. Routine</span>
                <span className="font-mono tabular-nums font-bold text-emerald-700 text-sm">
                  -{routePlan.distance_saved_km} km
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Est. Fuel Saved</span>
                <span className="font-mono tabular-nums font-bold text-emerald-700 text-sm">
                  {routePlan.fuel_saved_liters} L
                </span>
              </div>
            </div>
          )}

          {displayedStops.length === 0 ? (
            <div className="py-8 px-4 text-center border border-dashed border-slate-200 rounded-lg">
              <Truck className="w-7 h-7 text-slate-400 mx-auto" aria-hidden="true" />
              <p className="mt-2 text-sm font-medium text-slate-900">
                No active route dispatched
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Click &ldquo;Optimize Collection Route&rdquo; to assign the nearest vehicle to
                overflowing bins.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {displayedStops.map((stop) => {
                const cat = getCategoryMeta(stop.category);
                const isBusy = collectingBin === stop.bin_code;
                return (
                  <div
                    key={stop.bin_code}
                    className="p-3.5 border border-slate-200 rounded-lg flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-bold text-blue-700">
                          #{stop.stop_order}
                        </span>
                        <span className="font-mono font-semibold text-slate-900">
                          {stop.bin_code}
                        </span>
                        <span
                          className={`w-2.5 h-2.5 rounded-sm ${cat.swatchClass}`}
                          aria-hidden="true"
                        />
                        <span className="text-slate-700">{cat.shortLabel}</span>
                      </div>
                      <p className="text-xs font-medium text-slate-900 mt-1 truncate">
                        {stop.facility_name} · {stop.ward}
                      </p>
                      <p className="text-xs font-mono tabular-nums text-slate-500 mt-0.5">
                        Fill {stop.fill_level.toFixed(0)}% · {stop.weight_kg.toFixed(1)} kg · Leg{" "}
                        {stop.leg_distance_km} km
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleCollectStop(stop.bin_code, displayedVehicleCode)}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      {isBusy ? "Saving..." : "Mark Stop Collected"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Fleet Status Summary */}
          <div className="pt-4 border-t border-slate-200">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5">
              Mobile Collection Units
            </h3>
            <div className="space-y-2">
              {data.vehicles.map((v) => (
                <div
                  key={v.vehicle_code}
                  className="flex items-center justify-between text-xs py-1.5"
                >
                  <div>
                    <span className="font-mono font-semibold text-slate-900">
                      {v.vehicle_code}
                    </span>
                    <span className="text-slate-500 ml-2">{v.driver_name}</span>
                  </div>
                  <div className="font-mono tabular-nums text-slate-600">
                    {v.current_load_kg.toFixed(1)} / {v.capacity_kg} kg ·{" "}
                    <span className="font-semibold text-slate-900">{v.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
