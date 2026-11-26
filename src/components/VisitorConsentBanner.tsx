import { useEffect } from "react";
import { MapPin, ShieldCheck, Trash2, X } from "lucide-react";
import type { VisitorPrivacyControls } from "./VisitorTracker";

interface VisitorConsentBannerProps {
  controls: VisitorPrivacyControls;
}

export function VisitorConsentBanner({ controls }: VisitorConsentBannerProps) {
  const {
    sessionState,
    bannerDismissed,
    privacyModalOpen,
    gpsBusy,
    gpsFeedback,
    gpsAvailable,
    lastCapturedCoords,
    openPrivacyModal,
    closePrivacyModal,
    requestGpsAccess,
    declineGpsAccess,
    revokeGpsAccess,
    toggleContinuousGps,
    optOutAnalytics,
    optInAnalytics,
    deleteOwnRecords,
  } = controls;

  useEffect(() => {
    if (!privacyModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePrivacyModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [privacyModalOpen, closePrivacyModal]);

  const showBanner =
    !bannerDismissed &&
    !sessionState.analyticsOptOut &&
    sessionState.gpsConsentStatus === "unset";

  return (
    <>
      {showBanner && (
        <aside
          role="region"
          aria-label="Location & Analytics Privacy Notice"
          data-testid="visitor-consent-banner"
          className="fixed bottom-16 right-3 left-3 sm:left-auto sm:right-4 sm:max-w-md z-40 bg-white border border-slate-200 rounded-xl shadow-lg p-3.5 sm:p-4"
        >
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0 mt-0.5">
              <MapPin className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs sm:text-sm font-bold text-slate-900">
                  Location &amp; Traffic Analytics Consent
                </h2>
                <button
                  type="button"
                  onClick={() => void declineGpsAccess()}
                  aria-label="Decline GPS prompt"
                  className="p-1 text-slate-400 hover:text-slate-600 rounded"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-1 text-[11px] sm:text-xs text-slate-600 leading-relaxed">
                MediTrack measures regional reach and service demand. Share your browser GPS
                location only if you choose; otherwise an approximate city/region may be
                estimated from network routing without storing raw IP addresses.
              </p>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={gpsBusy}
                  onClick={requestGpsAccess}
                  data-testid="consent-allow-gps"
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors"
                >
                  {gpsBusy ? "Requesting GPS..." : "Allow GPS Location"}
                </button>
                <button
                  type="button"
                  disabled={gpsBusy}
                  onClick={() => void declineGpsAccess()}
                  data-testid="consent-decline-gps"
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  Decline GPS
                </button>
                <button
                  type="button"
                  onClick={openPrivacyModal}
                  data-testid="consent-open-privacy"
                  className="px-2 py-1.5 text-xs font-medium text-blue-700 hover:text-blue-900 underline"
                >
                  Privacy &amp; Opt-Out
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}

      {privacyModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="privacy-modal-title"
          data-testid="visitor-privacy-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={closePrivacyModal}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl shadow-xl max-w-lg w-full p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 id="privacy-modal-title" className="text-base font-bold text-slate-900">
                    Visitor Privacy &amp; Location Controls
                  </h2>
                  <p className="text-xs text-slate-500">
                    Pseudonymous analytics with explicit GPS consent &amp; instant revocation
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closePrivacyModal}
                aria-label="Close privacy preferences"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Pseudonymous Visitor ID</span>
                <span className="font-mono text-slate-900" data-testid="privacy-visitor-id">
                  {sessionState.analyticsOptOut ? "Opted Out" : sessionState.visitorId}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">GPS Sharing Status</span>
                <span className="font-semibold text-slate-900 capitalize" data-testid="privacy-gps-status">
                  {sessionState.gpsConsentStatus}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Current Location Source</span>
                <span className="font-medium text-slate-900">
                  {sessionState.locationSource === "gps"
                    ? "Precise GPS (Consented)"
                    : sessionState.locationSource === "ip"
                    ? "IP Estimate (Approximate · Not GPS)"
                    : "None recorded"}
                </span>
              </div>
              {lastCapturedCoords && (
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200">
                  <span className="text-slate-500">Captured GPS Coordinates</span>
                  <span className="font-mono text-emerald-700">
                    {lastCapturedCoords.latitude.toFixed(4)}, {lastCapturedCoords.longitude.toFixed(4)}
                    {lastCapturedCoords.accuracy_m !== null
                      ? ` (±${lastCapturedCoords.accuracy_m}m)`
                      : ""}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-3 text-xs text-slate-600">
              <p>
                <strong>How location is handled:</strong> Precise browser GPS coordinates are only
                collected after you click Allow GPS. Raw IP addresses are never stored; only a
                salted hash is used for rate limiting, and approximate IP geolocation is clearly
                marked as an estimate when GPS is declined or unavailable.
              </p>

              <div className="flex flex-wrap gap-2">
                {sessionState.gpsConsentStatus !== "granted" ? (
                  <button
                    type="button"
                    disabled={gpsBusy || sessionState.analyticsOptOut || !gpsAvailable}
                    onClick={requestGpsAccess}
                    data-testid="modal-allow-gps"
                    className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors"
                  >
                    {gpsBusy ? "Locating..." : "Share GPS Location"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void revokeGpsAccess()}
                    data-testid="modal-revoke-gps"
                    className="px-3.5 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg transition-colors"
                  >
                    Revoke GPS &amp; Wipe Coordinates
                  </button>
                )}

                {!sessionState.analyticsOptOut ? (
                  <button
                    type="button"
                    onClick={() => void optOutAnalytics()}
                    data-testid="modal-opt-out"
                    className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    Opt Out of Analytics
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void optInAnalytics()}
                    data-testid="modal-opt-in"
                    className="px-3.5 py-2 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg transition-colors"
                  >
                    Re-Enable Analytics
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void deleteOwnRecords()}
                  data-testid="modal-delete-my-data"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-rose-700 bg-white border border-rose-200 hover:bg-rose-50 rounded-lg transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Delete My Data</span>
                </button>
              </div>

              {sessionState.gpsConsentStatus === "granted" && !sessionState.analyticsOptOut && (
                <label className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 cursor-pointer">
                  <span>
                    <span className="block font-semibold text-slate-800">
                      Continuous GPS Location Updates (Separate Consent)
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Periodically refreshes position while MediTrack remains open
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={sessionState.continuousGpsConsent}
                    onChange={(e) => void toggleContinuousGps(e.target.checked)}
                    data-testid="modal-continuous-gps-toggle"
                    className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                  />
                </label>
              )}

              {gpsFeedback && (
                <p
                  role="status"
                  data-testid="privacy-feedback"
                  className="text-xs font-medium text-slate-800 bg-blue-50/70 border border-blue-100 rounded-lg px-3 py-2"
                >
                  {gpsFeedback}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
