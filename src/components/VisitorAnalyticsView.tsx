import { useCallback, useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  Bell,
  Download,
  Globe,
  KeyRound,
  Lock,
  LogOut,
  MapPin,
  Search,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  acknowledgeAdminNotification,
  deleteAdminVisitorRecord,
  downloadAdminVisitorsCsv,
  fetchAdminAnalytics,
  fetchAdminAuthStatus,
  fetchAdminMapMarkers,
  fetchAdminOverview,
  fetchAdminVisitorDetail,
  fetchAdminVisitors,
  loginAdmin,
  logoutAdmin,
  setupInitialAdmin,
  updateAdminPrivacySettings,
  type VisitorFilterQuery,
} from "../api/client";
import type {
  AdminAuthStatus,
  DateRangePreset,
  VisitorAnalyticsPayload,
  VisitorDetailPayload,
  VisitorListPayload,
  VisitorLocationSource,
  VisitorMapMarker,
  VisitorOverviewPayload,
} from "../types/meditrack";
import {
  formatCoords,
  formatSessionDuration,
  getLocationSourceBadge,
} from "../utils/visitorClient";
import { formatUtcTime } from "../utils/wasteLogic";
import { VisitorDetailPanel } from "./VisitorDetailPanel";
import { VisitorMapPanel } from "./VisitorMapPanel";

interface VisitorAnalyticsViewProps {
  mapboxToken: string;
}

type AdminSubTab = "overview" | "map" | "records" | "analytics" | "settings";

const DATE_PRESETS: Array<{ id: DateRangePreset; label: string }> = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "Last 7 Days" },
  { id: "30d", label: "Last 30 Days" },
  { id: "all", label: "All Time" },
  { id: "custom", label: "Custom" },
];

export function VisitorAnalyticsView({ mapboxToken }: VisitorAnalyticsViewProps) {
  // Bearer token stored strictly in React memory (never localStorage/sessionStorage)
  const [adminToken, setAdminToken] = useState<string>("");
  const [authStatus, setAuthStatus] = useState<AdminAuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [passcodeInput, setPasscodeInput] = useState<string>("");
  const [confirmPasscodeInput, setConfirmPasscodeInput] = useState<string>("");
  const [authError, setAuthError] = useState<string>("");
  const [authSubmitting, setAuthSubmitting] = useState<boolean>(false);

  const [subTab, setSubTab] = useState<AdminSubTab>("overview");
  const [dateRange, setDateRange] = useState<DateRangePreset>("30d");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");

  const [overview, setOverview] = useState<VisitorOverviewPayload | null>(null);
  const [mapMarkers, setMapMarkers] = useState<VisitorMapMarker[]>([]);
  const [mapRefreshedAt, setMapRefreshedAt] = useState<string>("");
  const [mapSourceFilter, setMapSourceFilter] = useState<"all" | "gps" | "ip">("all");
  const [mapAutoRefresh, setMapAutoRefresh] = useState<boolean>(true);

  const [visitorList, setVisitorList] = useState<VisitorListPayload | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<"all" | VisitorLocationSource>("all");
  const [visitorTypeFilter, setVisitorTypeFilter] = useState<"all" | "new" | "returning">("all");
  const [sortBy, setSortBy] = useState<VisitorFilterQuery["sort"]>("latest");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState<number>(1);

  const [selectedDetail, setSelectedDetail] = useState<VisitorDetailPayload | null>(null);
  const [detailDeleting, setDetailDeleting] = useState<boolean>(false);

  const [analytics, setAnalytics] = useState<VisitorAnalyticsPayload | null>(null);
  const [chartGranularity, setChartGranularity] = useState<"daily" | "weekly" | "monthly">("daily");

  const [retentionDaysInput, setRetentionDaysInput] = useState<number>(90);
  const [ipProviderInput, setIpProviderInput] = useState<string>("ipwhois");
  const [settingsMsg, setSettingsMsg] = useState<string>("");
  const [settingsSaving, setSettingsSaving] = useState<boolean>(false);

  const [dataLoading, setDataLoading] = useState<boolean>(false);
  const [dataError, setDataError] = useState<string>("");
  const [exportingCsv, setExportingCsv] = useState<boolean>(false);

  const checkAuth = useCallback(async (tok?: string) => {
    setAuthLoading(true);
    try {
      const status = await fetchAdminAuthStatus(tok || undefined);
      setAuthStatus(status);
      if (tok && !status.authenticated) {
        setAdminToken("");
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Failed to verify administrator status.");
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  const handleUnauthorized = useCallback((err: unknown) => {
    const msg = err instanceof Error ? err.message : "Request failed";
    if (msg.toLowerCase().includes("authentication required") || msg.includes("401")) {
      setAdminToken("");
      setAuthStatus((prev) => (prev ? { ...prev, authenticated: false } : prev));
    }
    setDataError(msg);
  }, []);

  const loadOverviewAndAnalytics = useCallback(async () => {
    if (!adminToken) return;
    setDataLoading(true);
    setDataError("");
    const rangeParams = {
      range: dateRange,
      start_date: dateRange === "custom" ? customStart : undefined,
      end_date: dateRange === "custom" ? customEnd : undefined,
    };
    try {
      const [ov, an] = await Promise.all([
        fetchAdminOverview(adminToken, rangeParams),
        fetchAdminAnalytics(adminToken, rangeParams),
      ]);
      setOverview(ov);
      setAnalytics(an);
      setRetentionDaysInput(ov.retention_days);
      setIpProviderInput(ov.ip_geo_provider);
    } catch (err) {
      handleUnauthorized(err);
    } finally {
      setDataLoading(false);
    }
  }, [adminToken, dateRange, customStart, customEnd, handleUnauthorized]);

  const loadMap = useCallback(async () => {
    if (!adminToken) return;
    try {
      const res = await fetchAdminMapMarkers(adminToken, mapSourceFilter);
      setMapMarkers(res.markers);
      setMapRefreshedAt(res.refreshed_at);
    } catch (err) {
      handleUnauthorized(err);
    }
  }, [adminToken, mapSourceFilter, handleUnauthorized]);

  const loadVisitors = useCallback(async () => {
    if (!adminToken) return;
    try {
      const res = await fetchAdminVisitors(adminToken, {
        range: dateRange,
        start_date: dateRange === "custom" ? customStart : undefined,
        end_date: dateRange === "custom" ? customEnd : undefined,
        source: sourceFilter,
        visitor_type: visitorTypeFilter,
        search: searchQuery,
        sort: sortBy,
        dir: sortDir,
        page,
        page_size: 12,
      });
      setVisitorList(res);
    } catch (err) {
      handleUnauthorized(err);
    }
  }, [
    adminToken,
    dateRange,
    customStart,
    customEnd,
    sourceFilter,
    visitorTypeFilter,
    searchQuery,
    sortBy,
    sortDir,
    page,
    handleUnauthorized,
  ]);

  useEffect(() => {
    if (!adminToken) return;
    void loadOverviewAndAnalytics();
  }, [adminToken, loadOverviewAndAnalytics]);

  useEffect(() => {
    if (!adminToken) return;
    void loadMap();
  }, [adminToken, loadMap]);

  useEffect(() => {
    if (!adminToken) return;
    void loadVisitors();
  }, [adminToken, loadVisitors]);

  // Periodic refresh for live counter & map
  useEffect(() => {
    if (!adminToken || !mapAutoRefresh) return;
    const timer = window.setInterval(() => {
      void loadMap();
      if (subTab === "overview") {
        void loadOverviewAndAnalytics();
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [adminToken, mapAutoRefresh, subTab, loadMap, loadOverviewAndAnalytics]);

  async function handleSetupSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    if (passcodeInput.trim().length < 8) {
      setAuthError("Passcode must be at least 8 characters long.");
      return;
    }
    if (passcodeInput !== confirmPasscodeInput) {
      setAuthError("Passcodes do not match.");
      return;
    }
    setAuthSubmitting(true);
    try {
      const res = await setupInitialAdmin(passcodeInput);
      setAdminToken(res.token);
      setPasscodeInput("");
      setConfirmPasscodeInput("");
      setAuthStatus({
        configured: true,
        source: "claimed",
        authenticated: true,
        adminLabel: res.adminLabel,
        expiresAt: res.expiresAt,
      });
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Failed to configure administrator access.");
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    if (!passcodeInput.trim()) {
      setAuthError("Enter the administrator passcode.");
      return;
    }
    setAuthSubmitting(true);
    try {
      const res = await loginAdmin(passcodeInput);
      setAdminToken(res.token);
      setPasscodeInput("");
      setAuthStatus((prev) => ({
        configured: true,
        source: prev?.source ?? "claimed",
        authenticated: true,
        adminLabel: res.adminLabel,
        expiresAt: res.expiresAt,
      }));
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Invalid administrator passcode.");
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleLogout() {
    const tok = adminToken;
    setAdminToken("");
    setSelectedDetail(null);
    setOverview(null);
    setVisitorList(null);
    setAnalytics(null);
    setMapMarkers([]);
    if (tok) {
      await logoutAdmin(tok).catch(() => {});
    }
    await checkAuth();
  }

  async function handleInspectVisitor(visitorId: string) {
    if (!adminToken) return;
    setDataError("");
    try {
      const detail = await fetchAdminVisitorDetail(adminToken, visitorId);
      setSelectedDetail(detail);
      setSubTab("records");
    } catch (err) {
      handleUnauthorized(err);
    }
  }

  async function handleDeleteVisitor(visitorId: string) {
    if (!adminToken) return;
    setDetailDeleting(true);
    try {
      await deleteAdminVisitorRecord(adminToken, visitorId);
      setSelectedDetail(null);
      await Promise.all([loadVisitors(), loadOverviewAndAnalytics(), loadMap()]);
    } catch (err) {
      handleUnauthorized(err);
    } finally {
      setDetailDeleting(false);
    }
  }

  async function handleExportCsv() {
    if (!adminToken) return;
    setExportingCsv(true);
    setDataError("");
    try {
      await downloadAdminVisitorsCsv(adminToken, {
        range: dateRange,
        start_date: dateRange === "custom" ? customStart : undefined,
        end_date: dateRange === "custom" ? customEnd : undefined,
        source: sourceFilter,
        visitor_type: visitorTypeFilter,
        search: searchQuery,
      });
    } catch (err) {
      handleUnauthorized(err);
    } finally {
      setExportingCsv(false);
    }
  }

  async function handleSaveSettings(runCleanup: boolean) {
    if (!adminToken) return;
    setSettingsSaving(true);
    setSettingsMsg("");
    try {
      const res = await updateAdminPrivacySettings(adminToken, {
        retention_days: retentionDaysInput,
        ip_geo_provider: ipProviderInput,
        run_cleanup: runCleanup,
      });
      setRetentionDaysInput(res.retention_days);
      setIpProviderInput(res.ip_geo_provider);
      setSettingsMsg(
        runCleanup
          ? `Policy saved (${res.retention_days} days, provider: ${res.ip_geo_provider}). Pruned ${res.pruned_count} expired location records.`
          : `Privacy settings saved (${res.retention_days} days retention, IP provider: ${res.ip_geo_provider}).`
      );
      if (runCleanup) {
        await Promise.all([loadOverviewAndAnalytics(), loadVisitors(), loadMap()]);
      }
    } catch (err) {
      handleUnauthorized(err);
    } finally {
      setSettingsSaving(false);
    }
  }

  async function handleAckNotifications(id?: number) {
    if (!adminToken) return;
    try {
      await acknowledgeAdminNotification(adminToken, id);
      await loadOverviewAndAnalytics();
    } catch (err) {
      handleUnauthorized(err);
    }
  }

  if (authLoading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-600">
        Verifying administrator access status...
      </div>
    );
  }

  // Admin First-Run Setup or Sign-In Gate
  if (!adminToken) {
    const isUnconfigured = authStatus?.source === "unconfigured";

    return (
      <div className="max-w-md mx-auto py-8" data-testid="admin-auth-gate">
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-7 space-y-5 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
              {isUnconfigured ? (
                <KeyRound className="w-5 h-5" aria-hidden="true" />
              ) : (
                <Lock className="w-5 h-5" aria-hidden="true" />
              )}
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">
                {isUnconfigured
                  ? "Configure Visitor Admin Access"
                  : "Visitor Intelligence Admin Sign-In"}
              </h1>
              <p className="text-xs text-slate-500">
                {isUnconfigured
                  ? "Create an initial administrator passcode (8+ characters) to protect visitor & location analytics."
                  : "Authorized administrators only. Enter your administrator passcode to view visitor sessions and maps."}
              </p>
            </div>
          </div>

          <form
            onSubmit={isUnconfigured ? handleSetupSubmit : handleLoginSubmit}
            className="space-y-4"
          >
            <div>
              <label
                htmlFor="admin-passcode-input"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {isUnconfigured ? "New Administrator Passcode" : "Administrator Passcode"}
              </label>
              <input
                id="admin-passcode-input"
                type="password"
                autoComplete={isUnconfigured ? "new-password" : "current-password"}
                value={passcodeInput}
                onChange={(e) => setPasscodeInput(e.target.value)}
                placeholder="Minimum 8 characters"
                data-testid="admin-passcode-input"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>

            {isUnconfigured && (
              <div>
                <label
                  htmlFor="admin-passcode-confirm"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Confirm Passcode
                </label>
                <input
                  id="admin-passcode-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPasscodeInput}
                  onChange={(e) => setConfirmPasscodeInput(e.target.value)}
                  placeholder="Re-enter passcode"
                  data-testid="admin-passcode-confirm"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>
            )}

            {authError && (
              <p
                role="alert"
                data-testid="admin-auth-error"
                className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2"
              >
                {authError}
              </p>
            )}

            <button
              type="submit"
              disabled={authSubmitting}
              data-testid="admin-auth-submit"
              className="w-full py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors"
            >
              {authSubmitting
                ? "Verifying..."
                : isUnconfigured
                ? "Set Passcode & Open Dashboard"
                : "Sign In to Visitor Analytics"}
            </button>
          </form>

          <p className="text-[11px] text-slate-500 border-t border-slate-100 pt-3">
            Session tokens are kept strictly in memory and expire automatically. For production
            deployments, set <code className="font-mono text-slate-700">ADMIN_PASSCODE</code> in
            server environment variables.
          </p>
        </div>
      </div>
    );
  }

  const trafficSeries =
    chartGranularity === "daily"
      ? analytics?.daily_traffic ?? []
      : chartGranularity === "weekly"
      ? analytics?.weekly_traffic ?? []
      : analytics?.monthly_traffic ?? [];

  const totalNewVsRet =
    (analytics?.new_vs_returning.new_sessions ?? 0) +
    (analytics?.new_vs_returning.returning_sessions ?? 0);

  return (
    <div className="space-y-6" data-testid="admin-visitor-dashboard">
      {/* Header + Real-time Counter + Sign Out */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Visitor Intelligence &amp; Location Analytics
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Consent-first traffic telemetry, live GPS vs approximate IP mapping, and retention
            governance.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div
            data-testid="live-active-sessions-counter"
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg"
          >
            <Activity className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
            <span className="font-mono tabular-nums">
              {overview?.kpis.active_sessions ?? 0} Active Sessions (5m)
            </span>
          </div>

          <button
            type="button"
            onClick={() => void handleLogout()}
            data-testid="admin-logout-btn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Sub-tabs & Global Date Filter */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: "overview", label: "Overview", icon: Users },
              { id: "map", label: "Live Map", icon: MapPin },
              { id: "records", label: "Visitor Records", icon: Search },
              { id: "analytics", label: "Analytics", icon: Globe },
              { id: "settings", label: "Privacy & Retention", icon: Settings },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = subTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setSubTab(tab.id);
                  if (tab.id !== "records") setSelectedDetail(null);
                }}
                data-testid={`visitor-subtab-${tab.id}`}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  active
                    ? "bg-blue-700 text-white"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setDateRange(preset.id);
                  setPage(1);
                }}
                data-testid={`date-preset-${preset.id}`}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  dateRange === preset.id
                    ? "bg-white text-blue-700 border border-slate-200 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {dateRange === "custom" && (
            <div className="flex items-center gap-1.5 text-xs">
              <input
                type="date"
                value={customStart}
                onChange={(e) => {
                  setCustomStart(e.target.value);
                  setPage(1);
                }}
                aria-label="Start date"
                className="px-2 py-1 border border-slate-300 rounded-md"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => {
                  setCustomEnd(e.target.value);
                  setPage(1);
                }}
                aria-label="End date"
                className="px-2 py-1 border border-slate-300 rounded-md"
              />
            </div>
          )}
        </div>
      </div>

      {dataError && (
        <div
          role="alert"
          className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-4 py-3 text-xs"
        >
          {dataError}
        </div>
      )}

      {/* SUBTAB 1: OVERVIEW */}
      {subTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              {
                label: "Total Visits",
                value: overview?.kpis.total_visitors ?? 0,
                hint: "Registered sessions",
              },
              {
                label: "Unique Visitors",
                value: overview?.kpis.unique_visitors ?? 0,
                hint: "First-party IDs",
              },
              {
                label: "Returning Visitors",
                value: overview?.kpis.returning_visitors ?? 0,
                hint: `${overview?.kpis.returning_sessions ?? 0} repeat visits`,
              },
              {
                label: "Active Sessions",
                value: overview?.kpis.active_sessions ?? 0,
                hint: "Live in last 5m",
              },
              {
                label: "GPS-Enabled Visitors",
                value: overview?.kpis.gps_visitors ?? 0,
                hint: "Explicit GPS consent",
              },
              {
                label: "IP-Estimated Visitors",
                value: overview?.kpis.ip_visitors ?? 0,
                hint: "Approximate fallback",
              },
            ].map((kpi) => (
              <div
                key={kpi.label}
                className="bg-white border border-slate-200 rounded-xl p-4"
              >
                <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
                <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
                  {kpi.value}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">{kpi.hint}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">Total Page Views</p>
                <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                  {overview?.kpis.total_page_views ?? 0}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium text-slate-500">Avg. Session Duration</p>
                <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-blue-700">
                  {formatSessionDuration(overview?.kpis.avg_session_duration_sec ?? 0)}
                </p>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">Retention &amp; Geolocation</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {overview?.retention_days ?? 90}-day retention · Provider:{" "}
                  <span className="font-mono text-blue-700">
                    {overview?.ip_geo_provider ?? "ipwhois"}
                  </span>
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Raw IPs are never saved; only HMAC hashes and regional estimates are kept.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSubTab("settings")}
                className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg shrink-0"
              >
                Configure
              </button>
            </div>
          </div>

          {/* Admin Traffic Notifications */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-blue-700" aria-hidden="true" />
                <h2 className="text-sm font-bold text-slate-900">
                  Administrator Traffic Notifications
                </h2>
              </div>
              {(overview?.notifications.some((n) => !n.acknowledged) ?? false) && (
                <button
                  type="button"
                  onClick={() => void handleAckNotifications()}
                  className="text-xs font-semibold text-blue-700 hover:underline"
                >
                  Acknowledge All
                </button>
              )}
            </div>
            <div className="divide-y divide-slate-100">
              {!overview || overview.notifications.length === 0 ? (
                <p className="px-5 py-6 text-xs text-slate-500 text-center">
                  No traffic spike or milestone notifications yet. Alerts trigger automatically at 5+
                  concurrent sessions or 10+ daily visits without exposing personal details.
                </p>
              ) : (
                overview.notifications.map((note) => (
                  <div
                    key={note.id}
                    className="px-5 py-3 flex items-center justify-between gap-4 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">{note.title}</p>
                      <p className="text-slate-600 mt-0.5">{note.message}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono text-[11px] text-slate-500">
                        {formatUtcTime(note.created_at)}
                      </span>
                      {!note.acknowledged && (
                        <button
                          type="button"
                          onClick={() => void handleAckNotifications(note.id)}
                          className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded"
                        >
                          Ack
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 2: LIVE MAP */}
      {subTab === "map" && (
        <VisitorMapPanel
          mapboxToken={mapboxToken}
          markers={mapMarkers}
          sourceFilter={mapSourceFilter}
          refreshedAt={mapRefreshedAt}
          loading={dataLoading}
          autoRefresh={mapAutoRefresh}
          onChangeSourceFilter={setMapSourceFilter}
          onToggleAutoRefresh={setMapAutoRefresh}
          onRefresh={() => void loadMap()}
          onInspectVisitor={(id) => void handleInspectVisitor(id)}
        />
      )}

      {/* SUBTAB 3: VISITOR RECORDS & VISITOR DETAIL */}
      {subTab === "records" && (
        selectedDetail ? (
          <VisitorDetailPanel
            detail={selectedDetail}
            deleting={detailDeleting}
            onBack={() => setSelectedDetail(null)}
            onDelete={(id) => void handleDeleteVisitor(id)}
          />
        ) : (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5 flex-1">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search
                    className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search ID, city, country, browser..."
                    data-testid="visitor-records-search"
                    className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>

                <select
                  value={sourceFilter}
                  onChange={(e) => {
                    setSourceFilter(e.target.value as "all" | VisitorLocationSource);
                    setPage(1);
                  }}
                  aria-label="Filter by location source"
                  data-testid="visitor-source-filter"
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="all">All Location Sources</option>
                  <option value="gps">GPS (Consented)</option>
                  <option value="ip">IP Estimate</option>
                  <option value="none">Unavailable</option>
                </select>

                <select
                  value={visitorTypeFilter}
                  onChange={(e) => {
                    setVisitorTypeFilter(e.target.value as "all" | "new" | "returning");
                    setPage(1);
                  }}
                  aria-label="Filter by visitor type"
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="all">New &amp; Returning</option>
                  <option value="new">New Visitors Only</option>
                  <option value="returning">Returning Only</option>
                </select>

                <select
                  value={`${sortBy}:${sortDir}`}
                  onChange={(e) => {
                    const [s, d] = e.target.value.split(":");
                    setSortBy(s as VisitorFilterQuery["sort"]);
                    setSortDir(d as "asc" | "desc");
                    setPage(1);
                  }}
                  aria-label="Sort visitor records"
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="latest:desc">Latest Activity (Newest)</option>
                  <option value="started:desc">Visit Start (Newest)</option>
                  <option value="duration:desc">Duration (Longest)</option>
                  <option value="page_views:desc">Page Views (Highest)</option>
                  <option value="visitor:asc">Visitor ID (A–Z)</option>
                </select>
              </div>

              <button
                type="button"
                disabled={exportingCsv}
                onClick={() => void handleExportCsv()}
                data-testid="export-visitors-csv-btn"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg shrink-0"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{exportingCsv ? "Exporting..." : "Export CSV"}</span>
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs" data-testid="visitor-records-table">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">Visitor ID</th>
                      <th className="py-2.5 px-4 font-semibold">Visit Date &amp; Time</th>
                      <th className="py-2.5 px-4 font-semibold">Location</th>
                      <th className="py-2.5 px-4 font-semibold">Coordinates</th>
                      <th className="py-2.5 px-4 font-semibold">Source</th>
                      <th className="py-2.5 px-4 font-semibold">Accuracy</th>
                      <th className="py-2.5 px-4 font-semibold">Device / Browser</th>
                      <th className="py-2.5 px-4 font-semibold">Duration</th>
                      <th className="py-2.5 px-4 font-semibold">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {!visitorList || visitorList.records.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-10 px-4 text-center text-slate-500">
                          No visitor sessions match the active filters.
                        </td>
                      </tr>
                    ) : (
                      visitorList.records.map((rec) => {
                        const badge = getLocationSourceBadge(rec.location_source);
                        const place =
                          [rec.city, rec.region, rec.country]
                            .filter((x) => x && x !== "Unknown")
                            .join(", ") ||
                          (rec.location_source === "gps"
                            ? "GPS Coordinates Only"
                            : "Unavailable");
                        return (
                          <tr
                            key={rec.session_id}
                            onClick={() => void handleInspectVisitor(rec.visitor_id)}
                            data-testid="visitor-record-row"
                            className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                          >
                            <td className="py-2.5 px-4 font-mono font-semibold text-blue-700">
                              {rec.visitor_id}
                            </td>
                            <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">
                              {formatUtcTime(rec.started_at)}
                            </td>
                            <td className="py-2.5 px-4 text-slate-800">{place}</td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                              {formatCoords(rec.latitude, rec.longitude)}
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 text-[11px] font-medium border rounded ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600">
                              {rec.location_source === "gps" && rec.accuracy_m !== null
                                ? `±${rec.accuracy_m}m`
                                : rec.location_source === "ip"
                                ? "Approx."
                                : "—"}
                            </td>
                            <td className="py-2.5 px-4 text-slate-700 capitalize whitespace-nowrap">
                              {rec.device_category} · {rec.browser}
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-slate-900">
                              {formatSessionDuration(rec.duration_sec)}
                            </td>
                            <td className="py-2.5 px-4">
                              <span
                                className={`px-2 py-0.5 text-[11px] font-semibold rounded ${
                                  rec.is_returning
                                    ? "bg-indigo-50 text-indigo-800 border border-indigo-200"
                                    : "bg-slate-100 text-slate-700 border border-slate-200"
                                }`}
                              >
                                {rec.is_returning ? "Returning" : "New"}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {visitorList && visitorList.total > 0 && (
                <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                  <span>
                    Showing page {visitorList.page} of {visitorList.total_pages} ({visitorList.total}{" "}
                    sessions)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={visitorList.page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="px-2.5 py-1 border border-slate-300 rounded disabled:opacity-40 hover:bg-slate-50"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={visitorList.page >= visitorList.total_pages}
                      onClick={() => setPage((p) => p + 1)}
                      className="px-2.5 py-1 border border-slate-300 rounded disabled:opacity-40 hover:bg-slate-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      )}

      {/* SUBTAB 4: ANALYTICS CHARTS */}
      {subTab === "analytics" && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Traffic Trend ({chartGranularity === "daily" ? "Daily" : chartGranularity === "weekly" ? "Weekly" : "Monthly"})
                </h2>
                <p className="text-xs text-slate-500">
                  Total visits vs unique pseudonymous visitors over the selected period.
                </p>
              </div>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
                {(["daily", "weekly", "monthly"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setChartGranularity(g)}
                    className={`px-3 py-1 rounded-md font-medium capitalize ${
                      chartGranularity === g
                        ? "bg-white text-blue-700 border border-slate-200 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-64 w-full">
              {trafficSeries.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-500">
                  No traffic data recorded in this date window yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trafficSeries} margin={{ top: 10, right: 12, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#64748b" }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="visits"
                      name="Total Visits"
                      stroke="#1d4ed8"
                      fill="#dbeafe"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="unique_visitors"
                      name="Unique Visitors"
                      stroke="#059669"
                      fill="#d1fae5"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* New vs Returning + Devices/Browsers */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-bold text-slate-900">New vs. Returning Visitors</h3>
              <div className="space-y-3 text-xs">
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-slate-600">New Sessions</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {analytics?.new_vs_returning.new_sessions ?? 0}
                    </span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-700 rounded-full"
                      style={{
                        width: `${
                          totalNewVsRet
                            ? ((analytics?.new_vs_returning.new_sessions ?? 0) / totalNewVsRet) * 100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-slate-600">Returning Sessions</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {analytics?.new_vs_returning.returning_sessions ?? 0}
                    </span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 rounded-full"
                      style={{
                        width: `${
                          totalNewVsRet
                            ? ((analytics?.new_vs_returning.returning_sessions ?? 0) /
                                totalNewVsRet) *
                              100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="font-semibold text-slate-700 mb-2">Device Categories</p>
                  <div className="space-y-1.5">
                    {(analytics?.devices ?? []).map((d) => (
                      <div key={d.name} className="flex justify-between">
                        <span className="capitalize text-slate-600">{d.name}</span>
                        <span className="font-mono text-slate-900">{d.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-semibold text-slate-700 mb-2">Browsers</p>
                  <div className="space-y-1.5">
                    {(analytics?.browsers ?? []).map((b) => (
                      <div key={b.name} className="flex justify-between">
                        <span className="text-slate-600">{b.name}</span>
                        <span className="font-mono text-slate-900">{b.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Most Visited Pages */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">Most Visited Pages</h3>
              <div className="h-52 w-full">
                {(analytics?.top_pages.length ?? 0) === 0 ? (
                  <p className="text-xs text-slate-500 py-16 text-center">
                    No page view telemetry yet.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={analytics?.top_pages ?? []}
                      layout="vertical"
                      margin={{ top: 4, right: 16, left: 20, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis
                        dataKey="page_path"
                        type="category"
                        width={120}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip />
                      <Bar dataKey="views" name="Page Views" fill="#1d4ed8" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Geo Distribution & Referrers */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">Countries</h3>
              <div className="space-y-2 text-xs">
                {(analytics?.countries ?? []).length === 0 ? (
                  <p className="text-slate-500">No country data recorded yet.</p>
                ) : (
                  analytics?.countries.map((c) => (
                    <div key={c.name} className="flex justify-between">
                      <span className="text-slate-700">{c.name}</span>
                      <span className="font-mono font-semibold text-slate-900">{c.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">Cities &amp; Regions</h3>
              <div className="space-y-2 text-xs">
                {(analytics?.cities ?? []).length === 0 ? (
                  <p className="text-slate-500">No city data recorded yet.</p>
                ) : (
                  analytics?.cities.map((c, idx) => (
                    <div key={`${c.city}-${idx}`} className="flex justify-between gap-2">
                      <span className="text-slate-700 truncate">
                        {[c.city, c.region, c.country].filter(Boolean).join(", ")}
                      </span>
                      <span className="font-mono font-semibold text-slate-900 shrink-0">
                        {c.count}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">Referral Sources</h3>
              <div className="space-y-2 text-xs">
                {(analytics?.referrers ?? []).length === 0 ? (
                  <p className="text-slate-500">No referral sources recorded yet.</p>
                ) : (
                  analytics?.referrers.map((r) => (
                    <div key={r.source} className="flex justify-between">
                      <span className="text-slate-700 truncate">{r.source}</span>
                      <span className="font-mono font-semibold text-slate-900">{r.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 5: PRIVACY & RETENTION */}
      {subTab === "settings" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-5 h-5 text-blue-700" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-900">
                Data Retention &amp; Geolocation Provider
              </h2>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label
                  htmlFor="retention-days-input"
                  className="block font-semibold text-slate-700 mb-1"
                >
                  Location &amp; Session Retention Policy (Days)
                </label>
                <input
                  id="retention-days-input"
                  type="number"
                  min={1}
                  max={3650}
                  value={retentionDaysInput}
                  onChange={(e) => setRetentionDaysInput(Number(e.target.value) || 90)}
                  className="w-40 px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Records older than {retentionDaysInput} days are automatically pruned when retention
                  cleanup runs.
                </p>
              </div>

              <div>
                <label
                  htmlFor="ip-provider-select"
                  className="block font-semibold text-slate-700 mb-1"
                >
                  Configurable IP Geolocation Provider (Fallback Only)
                </label>
                <select
                  id="ip-provider-select"
                  value={ipProviderInput}
                  onChange={(e) => setIpProviderInput(e.target.value)}
                  className="w-full max-w-xs px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="ipwhois">ipwho.is (Default HTTPS)</option>
                  <option value="ipapi">ipapi.co (Supports IP_GEO_API_KEY)</option>
                  <option value="ipinfo">ipinfo.io (Supports IP_GEO_API_KEY)</option>
                  <option value="custom">Custom HTTPS Provider (IP_GEO_ENDPOINT_TEMPLATE)</option>
                  <option value="disabled">Disabled (GPS Consent Only)</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Used strictly for approximate city/region estimation when GPS is unavailable or
                  declined. Never stored as GPS coordinates.
                </p>
              </div>

              <div className="flex flex-wrap gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={settingsSaving}
                  onClick={() => void handleSaveSettings(false)}
                  data-testid="save-privacy-settings-btn"
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
                >
                  Save Policy
                </button>
                <button
                  type="button"
                  disabled={settingsSaving}
                  onClick={() => void handleSaveSettings(true)}
                  data-testid="run-retention-cleanup-btn"
                  className="px-4 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 rounded-lg"
                >
                  Run Retention Cleanup Now
                </button>
              </div>

              {settingsMsg && (
                <p
                  role="status"
                  className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2"
                >
                  {settingsMsg}
                </p>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-3 text-xs text-slate-600">
            <h3 className="text-sm font-bold text-slate-900">
              Active Privacy &amp; Security Guarantees
            </h3>
            <ul className="space-y-2 list-disc pl-4 leading-relaxed">
              <li>
                <strong>No raw IP storage:</strong> Incoming network addresses are processed in-memory
                for configurable geolocation lookup and hashed via salted HMAC-SHA256 for rate limiting.
              </li>
              <li>
                <strong>Explicit GPS consent:</strong> Browser Geolocation is never triggered without
                explicit user approval; separate consent is required for continuous updates.
              </li>
              <li>
                <strong>Instant revocation &amp; self-deletion:</strong> Visitors can revoke GPS sharing
                or delete all stored records from the footer Privacy Preferences modal at any time.
              </li>
              <li>
                <strong>No invasive fingerprinting:</strong> Sessions use a transparent first-party
                pseudonymous ID and non-invasive browser/device category headers only.
              </li>
              <li>
                <strong>Protected admin routes:</strong> All <code className="font-mono">/api/py/admin/*</code>{" "}
                endpoints enforce Bearer token verification, strict <code className="font-mono">no-store</code>{" "}
                cache headers, no wildcard CORS, and brute-force rate limiting.
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
