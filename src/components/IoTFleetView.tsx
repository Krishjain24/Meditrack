import { useState } from "react";
import { Clock, Lock, Plus, RefreshCw, Search, ServerCog, Unlock, X } from "lucide-react";
import {
  completeBinCollection,
  createPickupRequest,
  registerSmartBin,
  sendBinTelemetryAction,
} from "../api/client";
import type { DashboardPayload, PredictiveAlert, WasteCategoryKey } from "../types/meditrack";
import {
  filterBins,
  formatDurationHours,
  formatUtcTime,
  getBinStatusDisplay,
  getCategoryMeta,
} from "../utils/wasteLogic";

interface IoTFleetViewProps {
  data: DashboardPayload;
  onDataUpdated: (dashboard: DashboardPayload) => void;
}

const STATUS_TABS: Array<{ id: string; label: string }> = [
  { id: "all", label: "All Bins" },
  { id: "overflow_alert", label: "Overflow Alert" },
  { id: "dispatched", label: "Dispatched" },
  { id: "warning", label: "High Fill" },
  { id: "nominal", label: "Nominal" },
];

export function IoTFleetView({ data, onDataUpdated }: IoTFleetViewProps) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [busyBin, setBusyBin] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [dispatchMsg, setDispatchMsg] = useState<string>("");

  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [newBinCode, setNewBinCode] = useState("");
  const [newFacility, setNewFacility] = useState(
    data.facilities[0]?.name || "AIIMS Bhopal"
  );
  const [newWard, setNewWard] = useState("");
  const [newCategory, setNewCategory] = useState<WasteCategoryKey>("yellow");
  const [newCapacityKg, setNewCapacityKg] = useState("25");
  const [newFillLevel, setNewFillLevel] = useState("0");
  const [registering, setRegistering] = useState(false);

  const filtered = filterBins(data.bins, statusFilter, searchQuery);
  const forecasts = data.predictive_alerts ?? [];
  const forecastMap = new Map<string, PredictiveAlert>(
    forecasts.map((f) => [f.bin_code, f])
  );
  const proactiveAlerts = forecasts.filter(
    (f) => f.risk_level === "imminent" || f.risk_level === "upcoming"
  );

  async function handlePreDispatch(alert: PredictiveAlert) {
    setBusyBin(alert.bin_code);
    setErrorMsg("");
    setDispatchMsg("");
    try {
      const res = await createPickupRequest({
        facility_name: alert.facility_name,
        category: alert.category,
        priority: alert.risk_level === "imminent" ? "critical" : "high",
        bin_code: alert.bin_code,
        notes: `Predictive alert pre-dispatch: ${alert.fill_level.toFixed(0)}% full (+${alert.fill_rate_pct_per_hr}%/hr), 100% forecast in ${formatDurationHours(alert.hours_to_full)}`,
      });
      onDataUpdated(res.dashboard);
      setDispatchMsg(
        `Pre-dispatched pickup ticket ${res.alert_code} for ${alert.bin_code}.`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to pre-dispatch pickup"
      );
    } finally {
      setBusyBin(null);
    }
  }

  async function handleSyncSensors() {
    setSyncing(true);
    setErrorMsg("");
    try {
      const res = await sendBinTelemetryAction({ action: "poll_sensors" });
      onDataUpdated(res.dashboard);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Sensor sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleLogIntake(binCode: string) {
    setBusyBin(binCode);
    setErrorMsg("");
    try {
      const res = await sendBinTelemetryAction({
        action: "record_reading",
        bin_code: binCode,
        delta_fill: 15,
      });
      onDataUpdated(res.dashboard);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Telemetry update failed");
    } finally {
      setBusyBin(null);
    }
  }

  async function handleToggleLock(binCode: string) {
    setBusyBin(binCode);
    setErrorMsg("");
    try {
      const res = await sendBinTelemetryAction({
        action: "toggle_lock",
        bin_code: binCode,
      });
      onDataUpdated(res.dashboard);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Lid lock toggle failed");
    } finally {
      setBusyBin(null);
    }
  }

  async function handleQuickCollect(binCode: string) {
    setBusyBin(binCode);
    setErrorMsg("");
    try {
      const res = await completeBinCollection({ bin_code: binCode });
      onDataUpdated(res.dashboard);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Collection failed");
    } finally {
      setBusyBin(null);
    }
  }

  async function handleRegisterBinSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = newBinCode.trim().toUpperCase();
    const ward = newWard.trim();
    if (!code || !ward) {
      setErrorMsg("Enter both a bin code (e.g., BIN-A04-Y) and hospital ward name.");
      return;
    }
    setRegistering(true);
    setErrorMsg("");
    setDispatchMsg("");
    try {
      const res = await registerSmartBin({
        bin_code: code,
        facility_name: newFacility,
        ward,
        category: newCategory,
        capacity_kg: Math.max(5, Number(newCapacityKg) || 25),
        fill_level: Math.max(0, Math.min(100, Number(newFillLevel) || 0)),
      });
      onDataUpdated(res.dashboard);
      setDispatchMsg(
        `Registered ESP32 smart bin ${res.bin.bin_code} at ${res.bin.facility_name} (${res.bin.ward}).`
      );
      setNewBinCode("");
      setNewWard("");
      setNewFillLevel("0");
      setShowRegisterForm(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to register smart bin");
    } finally {
      setRegistering(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            ESP32 Smart Bin Telemetry &amp; Fleet Monitor
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Live ultrasonic fill levels, load cell mass, bio-gas VOC readings, and automated lid
            interlocks across Bhopal hospital wards.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowRegisterForm((prev) => !prev)}
            aria-expanded={showRegisterForm}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
          >
            {showRegisterForm ? (
              <X className="w-4 h-4 text-slate-600" aria-hidden="true" />
            ) : (
              <ServerCog className="w-4 h-4 text-blue-700" aria-hidden="true" />
            )}
            <span>{showRegisterForm ? "Close Form" : "Register Smart Bin"}</span>
          </button>

          <button
            type="button"
            onClick={handleSyncSensors}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCw
              className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            <span>{syncing ? "Syncing Sensors..." : "Sync Live Sensors"}</span>
          </button>
        </div>
      </div>

      {showRegisterForm && (
        <section
          aria-labelledby="register-bin-heading"
          className="bg-white border border-blue-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 id="register-bin-heading" className="text-sm font-semibold text-slate-900">
                Onboard ESP32 Smart Bin Node
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Register a new ward bin endpoint in Bhopal SQLite telemetry storage.
              </p>
            </div>
          </div>

          <form onSubmit={handleRegisterBinSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            <div>
              <label htmlFor="new-bin-code" className="block text-xs font-medium text-slate-700 mb-1">
                Bin Code
              </label>
              <input
                id="new-bin-code"
                type="text"
                value={newBinCode}
                onChange={(e) => setNewBinCode(e.target.value)}
                placeholder="BIN-A04-Y"
                required
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 font-mono"
              />
            </div>

            <div>
              <label htmlFor="new-bin-facility" className="block text-xs font-medium text-slate-700 mb-1">
                Bhopal Hospital
              </label>
              <select
                id="new-bin-facility"
                value={newFacility}
                onChange={(e) => setNewFacility(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
              >
                {data.facilities.map((fac) => (
                  <option key={fac.code} value={fac.name}>
                    {fac.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="new-bin-ward" className="block text-xs font-medium text-slate-700 mb-1">
                Ward / Unit
              </label>
              <input
                id="new-bin-ward"
                type="text"
                value={newWard}
                onChange={(e) => setNewWard(e.target.value)}
                placeholder="NICU Isolation Ward"
                required
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
              />
            </div>

            <div>
              <label htmlFor="new-bin-category" className="block text-xs font-medium text-slate-700 mb-1">
                CPCB Stream
              </label>
              <select
                id="new-bin-category"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as WasteCategoryKey)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
              >
                <option value="yellow">Yellow (Infectious)</option>
                <option value="red">Red (Plastics)</option>
                <option value="white">White (Sharps)</option>
                <option value="blue">Blue (Glassware)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="new-bin-cap" className="block text-xs font-medium text-slate-700 mb-1">
                  Cap (kg)
                </label>
                <input
                  id="new-bin-cap"
                  type="number"
                  min={5}
                  max={100}
                  value={newCapacityKg}
                  onChange={(e) => setNewCapacityKg(e.target.value)}
                  className="w-full px-2.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 font-mono"
                />
              </div>
              <div>
                <label htmlFor="new-bin-fill" className="block text-xs font-medium text-slate-700 mb-1">
                  Fill %
                </label>
                <input
                  id="new-bin-fill"
                  type="number"
                  min={0}
                  max={100}
                  value={newFillLevel}
                  onChange={(e) => setNewFillLevel(e.target.value)}
                  className="w-full px-2.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 font-mono"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={registering}
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap disabled:opacity-60"
            >
              {registering ? "Saving..." : "Add Bin Node"}
            </button>
          </form>
        </section>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="p-3 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg"
        >
          {errorMsg}
        </div>
      )}

      {dispatchMsg && (
        <div className="p-3 text-xs font-medium text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg">
          {dispatchMsg}
        </div>
      )}

      {/* Proactive Predictive Capacity Alerts */}
      <section
        aria-labelledby="predictive-alerts-heading"
        className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2
              id="predictive-alerts-heading"
              className="text-base font-semibold text-slate-900"
            >
              Predictive Capacity Alerts (100% Fill Forecast)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Proactive forecast estimating hours until 100% capacity from ward fill velocity and bio-gas VOC telemetry
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums font-semibold text-slate-700">
            {proactiveAlerts.length} bins flagged
          </span>
        </div>

        {proactiveAlerts.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center border border-dashed border-slate-200 rounded-lg">
            All smart bins are forecasted to remain below capacity for more than 12 hours.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {proactiveAlerts.slice(0, 6).map((item) => {
              const cat = getCategoryMeta(item.category);
              const isImminent = item.risk_level === "imminent";
              return (
                <div
                  key={item.bin_code}
                  className="p-4 border border-slate-200 rounded-xl bg-slate-50/50 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono font-semibold text-slate-900">
                        {item.bin_code}
                      </span>
                      <span
                        className={`font-semibold ${
                          isImminent ? "text-rose-700" : "text-amber-700"
                        }`}
                      >
                        {isImminent ? "■ Imminent" : "▲ Upcoming"}
                      </span>
                    </div>
                    <div className="text-xs font-medium text-slate-900 truncate">
                      {item.facility_name} · {item.ward}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      <span
                        className={`w-2.5 h-2.5 rounded-sm ${cat.swatchClass}`}
                        aria-hidden="true"
                      />
                      <span>{cat.shortLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {item.fill_level.toFixed(0)}% (+{item.fill_rate_pct_per_hr}%/hr)
                      </span>
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-slate-200 flex items-center justify-between gap-2">
                    <div className="text-xs">
                      <div className="inline-flex items-center gap-1 font-mono tabular-nums font-bold text-slate-900">
                        <Clock className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                        <span>100% in {formatDurationHours(item.hours_to_full)}</span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-500">
                        Est. {formatUtcTime(item.projected_full_at)}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={busyBin === item.bin_code || item.already_queued}
                      onClick={() => handlePreDispatch(item)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                        item.already_queued
                          ? "bg-emerald-50 text-emerald-800 border border-emerald-200 cursor-default"
                          : "bg-blue-700 hover:bg-blue-800 text-white"
                      }`}
                    >
                      {item.already_queued ? "Queued" : "Pre-Dispatch"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Filter & Search Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {STATUS_TABS.map((tab) => {
            const active = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="relative w-full lg:w-72">
          <label htmlFor="fleet-search" className="sr-only">
            Search bins by code, facility, or ward
          </label>
          <Search
            className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            id="fleet-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search bin code, facility, ward..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      {/* Telemetry Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-12 px-4 text-center">
            <p className="text-sm font-medium text-slate-900">
              No smart bins match your current filter
            </p>
            <button
              type="button"
              onClick={() => {
                setStatusFilter("all");
                setSearchQuery("");
              }}
              className="mt-3 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Bin Code</th>
                  <th className="py-3 px-3">Facility &amp; Ward</th>
                  <th className="py-3 px-3">Stream</th>
                  <th className="py-3 px-3">Fill Level</th>
                  <th className="py-3 px-3">100% Forecast</th>
                  <th className="py-3 px-3 text-right">Mass</th>
                  <th className="py-3 px-3 text-right">VOC / Temp</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((bin) => {
                  const cat = getCategoryMeta(bin.category);
                  const st = getBinStatusDisplay(bin.status);
                  const isBusy = busyBin === bin.bin_code;
                  const forecast = forecastMap.get(bin.bin_code);

                  return (
                    <tr key={bin.bin_code} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                        <div>{bin.bin_code}</div>
                        <div className="text-slate-500 font-normal">
                          Bat {bin.battery_pct}%
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-medium text-slate-900">{bin.facility_name}</div>
                        <div className="text-xs text-slate-500">{bin.ward}</div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-800">
                          <span
                            className={`w-2.5 h-2.5 rounded-sm ${cat.swatchClass}`}
                            aria-hidden="true"
                          />
                          <span>{cat.shortLabel}</span>
                        </span>
                      </td>
                      <td className="py-3 px-3 min-w-[140px]">
                        <div className="flex items-center justify-between text-xs font-mono tabular-nums mb-1">
                          <span className="font-semibold text-slate-900">
                            {bin.fill_level.toFixed(1)}%
                          </span>
                          <span className="text-slate-500">{bin.capacity_kg} kg cap</span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              bin.fill_level >= 80
                                ? "bg-rose-600"
                                : bin.fill_level >= 60
                                ? "bg-amber-500"
                                : "bg-emerald-600"
                            }`}
                            style={{ width: `${Math.min(100, bin.fill_level)}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-xs font-mono tabular-nums">
                        {forecast ? (
                          <div>
                            <div
                              className={`font-semibold ${
                                forecast.risk_level === "imminent"
                                  ? "text-rose-700"
                                  : forecast.risk_level === "upcoming"
                                  ? "text-amber-700"
                                  : "text-slate-700"
                              }`}
                            >
                              {formatDurationHours(forecast.hours_to_full)}
                            </div>
                            <div className="text-slate-500">
                              +{forecast.fill_rate_pct_per_hr}%/hr
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">&mdash;</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-xs font-medium text-slate-900 whitespace-nowrap">
                        {bin.weight_kg.toFixed(2)} kg
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                        <div>{bin.gas_ppm} ppm</div>
                        <div>{bin.temp_c.toFixed(1)} &deg;C</div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className={`text-xs font-semibold ${st.textClass}`}>
                          {st.symbol} {st.label}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {bin.lid_locked ? "Lid Locked" : "Lid Unlocked"}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isBusy || bin.fill_level >= 100}
                            onClick={() => handleLogIntake(bin.bin_code)}
                            aria-label={`Log waste intake into ${bin.bin_code}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md disabled:opacity-50"
                          >
                            <Plus className="w-3 h-3" aria-hidden="true" />
                            <span>+15% Intake</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleToggleLock(bin.bin_code)}
                            aria-label={`${bin.lid_locked ? "Unlock" : "Lock"} lid on ${bin.bin_code}`}
                            className="p-1.5 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md disabled:opacity-50"
                            title={bin.lid_locked ? "Unlock lid" : "Lock lid"}
                          >
                            {bin.lid_locked ? (
                              <Lock className="w-3.5 h-3.5 text-rose-600" aria-hidden="true" />
                            ) : (
                              <Unlock className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                            )}
                          </button>
                          {bin.fill_level > 0 && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleQuickCollect(bin.bin_code)}
                              aria-label={`Mark ${bin.bin_code} collected`}
                              className="px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md disabled:opacity-50"
                            >
                              Collect
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
