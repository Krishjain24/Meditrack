import { ArrowLeft, MapPin, ShieldCheck, Trash2 } from "lucide-react";
import type { VisitorDetailPayload } from "../types/meditrack";
import {
  formatCoords,
  formatSessionDuration,
  getLocationSourceBadge,
} from "../utils/visitorClient";
import { formatUtcTime } from "../utils/wasteLogic";

interface VisitorDetailPanelProps {
  detail: VisitorDetailPayload;
  deleting: boolean;
  onBack: () => void;
  onDelete: (visitorId: string) => void;
}

export function VisitorDetailPanel({
  detail,
  deleting,
  onBack,
  onDelete,
}: VisitorDetailPanelProps) {
  const { profile, latest_location, sessions, page_views, consent_logs } = detail;
  const locBadge = getLocationSourceBadge(latest_location.location_source);

  return (
    <div className="space-y-5" data-testid="visitor-detail-panel">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Back to Records</span>
          </button>
          <div>
            <h2 className="text-base font-bold text-slate-900 font-mono">
              {profile.visitor_id}
            </h2>
            <p className="text-xs text-slate-500">
              {profile.visit_count > 1 ? "Returning Visitor" : "New Visitor"} ·{" "}
              {profile.visit_count} total sessions · {profile.device_category} ({profile.browser})
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={deleting}
          onClick={() => onDelete(profile.visitor_id)}
          data-testid="admin-delete-visitor-btn"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 disabled:opacity-50 rounded-lg"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{deleting ? "Deleting..." : "Delete Visitor Record"}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Visit Timeline
          </p>
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">First Seen</dt>
              <dd className="font-mono text-slate-900">{formatUtcTime(profile.first_seen_at)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Latest Visit</dt>
              <dd className="font-mono text-slate-900">{formatUtcTime(profile.last_seen_at)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">OS / Device</dt>
              <dd className="text-slate-900 capitalize">
                {profile.os_family} · {profile.device_category}
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Latest Location
            </p>
            <span className={`px-2 py-0.5 text-[11px] font-semibold border rounded ${locBadge.className}`}>
              {locBadge.label}
            </span>
          </div>
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Place</dt>
              <dd className="text-slate-900 flex items-center gap-1">
                <MapPin className="w-3 h-3 text-slate-400" aria-hidden="true" />
                <span>
                  {[latest_location.city, latest_location.region, latest_location.country]
                    .filter((v) => v && v !== "Unknown")
                    .join(", ") ||
                    (latest_location.location_source === "gps"
                      ? "GPS Coordinates Only"
                      : "Unavailable")}
                </span>
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Coordinates</dt>
              <dd className="font-mono text-slate-900">
                {formatCoords(latest_location.latitude, latest_location.longitude)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Accuracy</dt>
              <dd className="font-mono text-slate-900">
                {latest_location.location_source === "gps" && latest_location.accuracy_m !== null
                  ? `±${latest_location.accuracy_m} m`
                  : "Approximate / N/A"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-blue-700" aria-hidden="true" />
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Consent Status
            </p>
          </div>
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">GPS Consent</dt>
              <dd className="font-semibold text-slate-900 capitalize">
                {profile.gps_consent_status}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Continuous GPS</dt>
              <dd className="text-slate-900">
                {profile.continuous_gps_consent ? "Enabled" : "Off"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Consent Updated</dt>
              <dd className="font-mono text-slate-900">
                {profile.gps_consent_updated_at
                  ? formatUtcTime(profile.gps_consent_updated_at)
                  : "Not recorded"}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Session History */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900">
            Session History ({sessions.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4 font-semibold">Session ID</th>
                <th className="py-2.5 px-4 font-semibold">Started (UTC)</th>
                <th className="py-2.5 px-4 font-semibold">Duration</th>
                <th className="py-2.5 px-4 font-semibold">Landing Page</th>
                <th className="py-2.5 px-4 font-semibold">Referrer</th>
                <th className="py-2.5 px-4 font-semibold">Location Source</th>
                <th className="py-2.5 px-4 font-semibold">Coordinates</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sessions.map((s) => {
                const badge = getLocationSourceBadge(s.location_source);
                return (
                  <tr key={s.session_id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono text-slate-900">{s.session_id}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">
                      {formatUtcTime(s.started_at)}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-900">
                      {formatSessionDuration(s.duration_sec)}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-700">{s.landing_page}</td>
                    <td className="py-2.5 px-4 text-slate-700">{s.referrer_source}</td>
                    <td className="py-2.5 px-4">
                      <span className={`px-2 py-0.5 text-[11px] font-medium border rounded ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-700">
                      {formatCoords(s.latitude, s.longitude)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pages Visited & Consent Audit Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">
              Pages Visited ({page_views.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto text-xs">
            {page_views.map((pv) => (
              <div key={pv.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-slate-900">{pv.page_path}</p>
                  <p className="text-[11px] text-slate-500">{pv.page_title}</p>
                </div>
                <span className="font-mono text-[11px] text-slate-500 shrink-0">
                  {formatUtcTime(pv.viewed_at)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">
              Consent Audit Log ({consent_logs.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto text-xs">
            {consent_logs.length === 0 ? (
              <p className="px-4 py-6 text-slate-500 text-center">
                Visitor has not submitted an explicit consent change yet.
              </p>
            ) : (
              consent_logs.map((log) => (
                <div key={log.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900 capitalize">
                      {log.consent_type.replace("_", " ")} → {log.status}
                    </p>
                    <p className="text-[11px] font-mono text-slate-500">{log.session_id}</p>
                  </div>
                  <span className="font-mono text-[11px] text-slate-500 shrink-0">
                    {formatUtcTime(log.recorded_at)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
