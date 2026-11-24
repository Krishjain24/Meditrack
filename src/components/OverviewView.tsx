import { useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ActiveTab, DashboardPayload } from "../types/meditrack";
import { getCategoryMeta } from "../utils/wasteLogic";

interface OverviewViewProps {
  data: DashboardPayload;
  onNavigate: (tab: ActiveTab) => void;
}

const PIPELINE_STEPS: Array<{
  step: string;
  title: string;
  summary: string;
  target: ActiveTab;
}> = [
  {
    step: "01",
    title: "Waste Request",
    summary: "Hospital ward or ultrasonic threshold triggers pickup",
    target: "fleet",
  },
  {
    step: "02",
    title: "Smart Identification",
    summary: "Python vision & clinical rules classify biomedical stream",
    target: "segregation",
  },
  {
    step: "03",
    title: "Automated Segregation",
    summary: "Target bin unlocks while cross-contamination bins lock",
    target: "segregation",
  },
  {
    step: "04",
    title: "Condition Collection",
    summary: "GPS assigns nearest truck & skips non-full routine stops",
    target: "routes",
  },
  {
    step: "05",
    title: "QR & Disposal",
    summary: "Tamper-evident manifest tracks treatment & CPCB audit",
    target: "compliance",
  },
];

export function OverviewView({ data, onNavigate }: OverviewViewProps) {
  const [trendMode, setTrendMode] = useState<"categories" | "total">("categories");

  const activeAlerts = data.alerts.filter(
    (a) => a.status === "pending" || a.status === "assigned"
  );

  return (
    <div className="space-y-8">
      {/* Hero Operational Header */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="space-y-3 max-w-3xl">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 [text-wrap:balance]">
              Smart Medical Waste Segregation and Condition-Based Collection
            </h1>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl">
              Replaces manual sorting and fixed-schedule pickups found in UPBMW MIS QR and
              Odisha BMWMTS with automated category segregation, ESP32 fill-level alerts,
              GPS route optimization, and QR chain-of-custody reporting.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate("segregation")}
              className="px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-2"
            >
              <span>Run Smart Segregation</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate("routes")}
              className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Optimize Routes
            </button>
          </div>
        </div>

        {/* 4-Column KPI Strip */}
        <div className="mt-8 pt-6 border-t border-slate-200 grid grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <p className="text-xs font-medium text-slate-500">Active Smart Bins</p>
            <p className="mt-1 text-3xl font-bold font-mono tabular-nums text-slate-900">
              {data.kpis.total_bins}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Across {data.facilities.length} hospital facilities
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Overflow Alerts (&ge;80%)</p>
            <p className="mt-1 text-3xl font-bold font-mono tabular-nums text-rose-700">
              {data.kpis.overflow_bins}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {data.kpis.pending_alerts} active pickup tickets
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Tracked Waste Mass</p>
            <p className="mt-1 text-3xl font-bold font-mono tabular-nums text-slate-900">
              {data.kpis.total_mass_kg.toFixed(1)}
              <span className="text-sm font-normal text-slate-500 ml-1">kg</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {data.kpis.segregated_events} classified items logged
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Verified QR Disposals</p>
            <p className="mt-1 text-3xl font-bold font-mono tabular-nums text-emerald-700">
              {data.kpis.verified_disposals}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              SHA-256 chain-of-custody records
            </p>
          </div>
        </div>
      </section>

      {/* 5-Stage Methodology Pipeline */}
      <section aria-labelledby="pipeline-heading" className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <h2 id="pipeline-heading" className="text-base font-semibold text-slate-900">
            End-to-End Traceable Pipeline
          </h2>
          <span className="text-xs text-slate-500">
            Facility &rarr; Segregate &rarr; Collect &rarr; Track &rarr; Dispose
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {PIPELINE_STEPS.map((item) => (
            <button
              key={item.step}
              type="button"
              onClick={() => onNavigate(item.target)}
              className="text-left bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              <div className="flex items-center justify-between text-xs font-mono text-blue-700 font-semibold">
                <span>Step {item.step}</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              </div>
              <p className="mt-2 text-sm font-semibold text-slate-900">{item.title}</p>
              <p className="mt-1 text-xs text-slate-600 leading-relaxed">{item.summary}</p>
            </button>
          ))}
        </div>
      </section>

      {/* 7-Day Medical Waste Production Trends (Recharts) */}
      <section
        aria-labelledby="trends-heading"
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 id="trends-heading" className="text-base font-semibold text-slate-900">
              7-Day Medical Waste Production Trends
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Daily mass (kg) segregated across CPCB streams including today&apos;s live bin and disposal intake
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setTrendMode("categories")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                trendMode === "categories"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              By Category
            </button>
            <button
              type="button"
              onClick={() => setTrendMode("total")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                trendMode === "total"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Total Mass
            </button>
          </div>
        </div>

        <div className="h-[280px] w-full" data-testid="waste-trends-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data.daily_trends ?? []}
              margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="day_label"
                tick={{ fontSize: 12, fill: "#475569" }}
                stroke="#cbd5e1"
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#475569" }}
                stroke="#cbd5e1"
                unit=" kg"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#ffffff",
                  borderColor: "#e2e8f0",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
              {trendMode === "total" ? (
                <Line
                  type="monotone"
                  dataKey="total_kg"
                  name="Total Daily Waste (kg)"
                  stroke="#1d4ed8"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "#1d4ed8" }}
                  activeDot={{ r: 6 }}
                />
              ) : (
                <>
                  <Line
                    type="monotone"
                    dataKey="yellow_kg"
                    name="Yellow (Infectious)"
                    stroke="#d97706"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="red_kg"
                    name="Red (Plastics)"
                    stroke="#dc2626"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="blue_kg"
                    name="Blue (Glassware)"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="white_kg"
                    name="White (Sharps)"
                    stroke="#475569"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </>
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Main Split: Active Condition-Based Queue + Literature Survey Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Condition-Based Collection Alerts
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Triggered automatically by ESP32 ultrasonic fill sensors (&ge;80%) or facility requests
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate("routes")}
              className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Dispatch Fleet
            </button>
          </div>

          {activeAlerts.length === 0 ? (
            <div className="py-10 text-center border border-dashed border-slate-200 rounded-lg">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 mx-auto" aria-hidden="true" />
              <p className="mt-2 text-sm font-medium text-slate-900">
                All smart bins are below overflow thresholds
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Simulate waste drops in IoT Fleet or raise a pickup request to test routing.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                    <th className="py-2.5 pr-3">Alert / Bin</th>
                    <th className="py-2.5 px-3">Facility &amp; Ward</th>
                    <th className="py-2.5 px-3">Stream</th>
                    <th className="py-2.5 px-3 text-right">Fill %</th>
                    <th className="py-2.5 pl-3 text-right">Priority</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {activeAlerts.slice(0, 6).map((alert) => {
                    const cat = getCategoryMeta(alert.category);
                    return (
                      <tr key={alert.alert_code} className="hover:bg-slate-50/80">
                        <td className="py-3 pr-3 font-mono text-xs text-slate-900">
                          <div className="font-semibold">{alert.bin_code}</div>
                          <div className="text-slate-500">{alert.alert_code}</div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-slate-900">{alert.facility_name}</div>
                          <div className="text-xs text-slate-500">{alert.ward}</div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-800">
                            <span className={`w-2.5 h-2.5 rounded-sm ${cat.swatchClass}`} aria-hidden="true" />
                            <span>{cat.shortLabel}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                          {alert.fill_level.toFixed(0)}%
                        </td>
                        <td className="py-3 pl-3 text-right text-xs font-semibold">
                          <span
                            className={
                              alert.priority === "critical"
                                ? "text-rose-700"
                                : alert.priority === "high"
                                ? "text-amber-700"
                                : "text-slate-600"
                            }
                          >
                            {alert.priority === "critical"
                              ? "■ Critical"
                              : alert.priority === "high"
                              ? "▲ High"
                              : "● Normal"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Benchmark Comparison Chart (Slide 5) */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-base font-semibold text-slate-900">
            Legacy Routine vs. MediTrack Smart System
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Addressing manual sorting &amp; fixed-schedule delays in UPBMW MIS QR and Odisha BMWMTS
          </p>

          <div className="mt-4 flex items-center gap-5 text-xs text-slate-600">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-slate-300" aria-hidden="true" />
              <span>Legacy Fixed Schedule</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-emerald-600" aria-hidden="true" />
              <span>With MediTrack IoT</span>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {data.benchmarks.map((row) => (
              <div key={row.metric} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-800">{row.metric}</span>
                  <span className="font-mono tabular-nums text-slate-500">
                    {row.legacy_pct}% &rarr;{" "}
                    <strong className="text-emerald-700">{row.meditrack_pct}%</strong>
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-slate-300 rounded-full"
                      style={{ width: `${row.legacy_pct}%` }}
                    />
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 rounded-full"
                      style={{ width: `${row.meditrack_pct}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* CPCB Category Breakdown */}
      <section aria-labelledby="categories-heading" className="space-y-3">
        <h2 id="categories-heading" className="text-base font-semibold text-slate-900">
          CPCB Color-Coded Biomedical Streams
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {data.category_breakdown.map((cat) => {
            const meta = getCategoryMeta(cat.category);
            return (
              <div
                key={cat.category}
                className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-sm ${meta.swatchClass}`} aria-hidden="true" />
                    <span className="text-sm font-semibold text-slate-900">
                      {meta.shortLabel} Chamber
                    </span>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    {cat.bin_count} bins
                  </span>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-700">{meta.fullLabel}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{cat.treatment}</p>
                </div>
                <div className="pt-2 border-t border-slate-100 flex items-baseline justify-between">
                  <span className="text-xs text-slate-500">Avg. Fill</span>
                  <span className="text-base font-bold font-mono tabular-nums text-slate-900">
                    {cat.avg_fill.toFixed(1)}% · {cat.active_mass_kg.toFixed(1)} kg
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
