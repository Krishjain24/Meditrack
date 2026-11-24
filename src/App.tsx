import { useCallback, useEffect, useState } from "react";
import { fetchDashboard, fetchMapsConfig } from "./api/client";
import { ComplianceView } from "./components/ComplianceView";
import { IoTFleetView } from "./components/IoTFleetView";
import { OverviewView } from "./components/OverviewView";
import { PickupRequestModal } from "./components/PickupRequestModal";
import { RouteMapView } from "./components/RouteMapView";
import { SegregationView } from "./components/SegregationView";
import { TopBar } from "./components/TopBar";
import type { ActiveTab, DashboardPayload } from "./types/meditrack";

function getInitialTab(): ActiveTab {
  if (typeof window === "undefined") return "overview";
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  if (
    tab === "overview" ||
    tab === "segregation" ||
    tab === "fleet" ||
    tab === "routes" ||
    tab === "compliance"
  ) {
    return tab;
  }
  return "overview";
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>(getInitialTab);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [pickupModalOpen, setPickupModalOpen] = useState<boolean>(false);
  const [mapsApiKey, setMapsApiKey] = useState<string>("");
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState<boolean>(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const payload = await fetchDashboard();
      setDashboard(payload);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Unable to connect to MediTrack Python backend."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
    void fetchMapsConfig().then((cfg) => {
      if (cfg.apiKey) setMapsApiKey(cfg.apiKey);
    });
  }, [loadDashboard]);

  useEffect(() => {
    const onQuotaExceeded = () => setMapsQuotaExceeded(true);
    window.addEventListener("gmp-quota-exceeded", onQuotaExceeded);
    return () => window.removeEventListener("gmp-quota-exceeded", onQuotaExceeded);
  }, []);

  function handleSelectTab(tab: ActiveTab) {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url.toString());
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {mapsQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{" "}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{" "}
            for instructions to update your account.
          </span>
        </div>
      )}
      <TopBar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onOpenPickupModal={() => setPickupModalOpen(true)}
      />

      <main className="flex-1 max-w-[1360px] w-full mx-auto px-4 sm:px-6 py-8">
        {loading && !dashboard ? (
          <div
            aria-busy="true"
            className="space-y-6"
            data-testid="loading-skeleton"
          >
            <div className="h-48 bg-white border border-slate-200 rounded-xl animate-pulse" />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse"
                />
              ))}
            </div>
          </div>
        ) : errorMsg && !dashboard ? (
          <div
            role="alert"
            className="bg-white border border-rose-200 rounded-xl p-8 text-center max-w-lg mx-auto"
          >
            <h1 className="text-lg font-bold text-slate-900">
              Backend Connection Unavailable
            </h1>
            <p className="mt-2 text-sm text-slate-600">{errorMsg}</p>
            <button
              type="button"
              onClick={() => void loadDashboard()}
              className="mt-4 px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
            >
              Retry Connection
            </button>
          </div>
        ) : dashboard ? (
          <>
            {activeTab === "overview" && (
              <OverviewView data={dashboard} onNavigate={handleSelectTab} />
            )}
            {activeTab === "segregation" && (
              <SegregationView
                data={dashboard}
                onDataUpdated={(updated) => setDashboard(updated)}
              />
            )}
            {activeTab === "fleet" && (
              <IoTFleetView
                data={dashboard}
                onDataUpdated={(updated) => setDashboard(updated)}
              />
            )}
            {activeTab === "routes" && (
              <RouteMapView
                data={dashboard}
                mapsApiKey={mapsApiKey}
                onDataUpdated={(updated) => setDashboard(updated)}
              />
            )}
            {activeTab === "compliance" && <ComplianceView data={dashboard} />}
          </>
        ) : null}
      </main>

      <footer className="border-t border-slate-200 bg-white py-5">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>
          created by -krish jain
          </span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => handleSelectTab("compliance")}
              className="hover:text-slate-900 transition-colors"
            >
              CPCB Compliance Ledger
            </button>
            <button
              type="button"
              onClick={() => setPickupModalOpen(true)}
              className="hover:text-slate-900 transition-colors"
            >
              Raise Pickup Request
            </button>
          </div>
        </div>
      </footer>

      {dashboard && (
        <PickupRequestModal
          isOpen={pickupModalOpen}
          facilities={dashboard.facilities}
          onClose={() => setPickupModalOpen(false)}
          onCreated={(updated) => {
            setDashboard(updated);
            handleSelectTab("routes");
          }}
        />
      )}
    </div>
  );
}
