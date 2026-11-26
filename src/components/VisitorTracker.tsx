import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteMyVisitorData,
  registerVisitorVisit,
  sendVisitorEvent,
  submitVisitorGpsLocation,
  updateVisitorConsent,
} from "../api/client";
import type {
  ActiveTab,
  GpsConsentStatus,
  VisitorLocationSource,
  VisitorSessionState,
} from "../types/meditrack";
import {
  clearFirstPartyVisitorStorage,
  detectBrowserAndDevice,
  getOrCreateVisitorIds,
  getStoredConsentPref,
  setStoredConsentPref,
} from "../utils/visitorClient";

export interface VisitorPrivacyControls {
  sessionState: VisitorSessionState;
  bannerDismissed: boolean;
  privacyModalOpen: boolean;
  gpsBusy: boolean;
  gpsFeedback: string;
  gpsAvailable: boolean;
  lastCapturedCoords: {
    latitude: number;
    longitude: number;
    accuracy_m: number | null;
    timestamp: string;
  } | null;
  openPrivacyModal: () => void;
  closePrivacyModal: () => void;
  dismissBanner: () => void;
  requestGpsAccess: () => void;
  declineGpsAccess: () => Promise<void>;
  revokeGpsAccess: () => Promise<void>;
  toggleContinuousGps: (enable: boolean) => Promise<void>;
  optOutAnalytics: () => Promise<void>;
  optInAnalytics: () => Promise<void>;
  deleteOwnRecords: () => Promise<void>;
}

const TAB_TITLES: Record<ActiveTab, string> = {
  overview: "MediTrack Overview",
  segregation: "MediTrack Segregation",
  fleet: "MediTrack IoT Fleet",
  routes: "MediTrack Route Map",
  compliance: "MediTrack Compliance",
  visitors: "MediTrack Visitor Intelligence",
};

function getSafeReferrer(): string {
  if (typeof document === "undefined" || !document.referrer) return "Direct";
  try {
    const refUrl = new URL(document.referrer);
    if (typeof window !== "undefined" && refUrl.hostname === window.location.hostname) {
      return "Internal";
    }
    return refUrl.hostname || "Direct";
  } catch {
    return "Direct";
  }
}

export function useVisitorIntelligence(activeTab: ActiveTab): VisitorPrivacyControls {
  const initialIdsRef = useRef<{ visitorId: string; sessionId: string; optedOut: boolean } | null>(null);
  if (!initialIdsRef.current) {
    initialIdsRef.current = getOrCreateVisitorIds();
  }

  const [sessionState, setSessionState] = useState<VisitorSessionState>(() => ({
    visitorId: initialIdsRef.current!.visitorId,
    sessionId: initialIdsRef.current!.sessionId,
    isReturning: false,
    gpsConsentStatus: getStoredConsentPref(),
    continuousGpsConsent: false,
    analyticsOptOut: initialIdsRef.current!.optedOut,
    locationSource: "none",
  }));

  const [bannerDismissed, setBannerDismissed] = useState<boolean>(() => {
    const pref = getStoredConsentPref();
    return initialIdsRef.current!.optedOut || pref !== "unset";
  });
  const [privacyModalOpen, setPrivacyModalOpen] = useState<boolean>(false);
  const [gpsBusy, setGpsBusy] = useState<boolean>(false);
  const [gpsFeedback, setGpsFeedback] = useState<string>("");
  const [lastCapturedCoords, setLastCapturedCoords] = useState<{
    latitude: number;
    longitude: number;
    accuracy_m: number | null;
    timestamp: string;
  } | null>(null);

  const gpsAvailable =
    typeof navigator !== "undefined" && "geolocation" in navigator;

  const registeredRef = useRef<boolean>(false);
  const sessionStartMsRef = useRef<number>(Date.now());
  const prevTabRef = useRef<ActiveTab>(activeTab);
  const watchIdRef = useRef<number | null>(null);
  const lastContinuousSentMsRef = useRef<number>(0);

  const stateRef = useRef(sessionState);
  stateRef.current = sessionState;

  // Register initial website visit on mount (unless opted out)
  useEffect(() => {
    const current = stateRef.current;
    if (current.analyticsOptOut || registeredRef.current) return;
    registeredRef.current = true;

    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const meta = detectBrowserAndDevice(ua);
    const landingPage =
      typeof window !== "undefined"
        ? `${window.location.pathname || "/"}?tab=${activeTab}`
        : `/?tab=${activeTab}`;

    void registerVisitorVisit({
      visitor_id: current.visitorId,
      session_id: current.sessionId,
      landing_page: landingPage,
      page_title: TAB_TITLES[activeTab] || "MediTrack",
      referrer_source: getSafeReferrer(),
      device_category: meta.deviceCategory,
      browser: meta.browser,
    })
      .then(async (res) => {
        if (res.opted_out) {
          setSessionState((prev) => ({ ...prev, analyticsOptOut: true }));
          setBannerDismissed(true);
          return;
        }
        const serverConsent: GpsConsentStatus = res.gps_consent_status || "unset";
        const locSource: VisitorLocationSource = res.location_source || "none";

        // Respect browser-level geolocation denial without re-prompting
        let finalConsent = serverConsent;
        if (
          finalConsent === "unset" &&
          typeof navigator !== "undefined" &&
          navigator.permissions &&
          typeof navigator.permissions.query === "function"
        ) {
          try {
            const perm = await navigator.permissions.query({
              name: "geolocation" as PermissionName,
            });
            if (perm.state === "denied") {
              finalConsent = "denied";
              setStoredConsentPref("denied");
              await updateVisitorConsent({
                visitor_id: res.visitor_id,
                session_id: res.session_id,
                consent_type: "gps",
                status: "denied",
              });
            }
          } catch {
            // Permissions API unavailable in some browsers; preserve normal prompt
          }
        } else if (finalConsent !== "unset") {
          setStoredConsentPref(finalConsent);
        }

        setSessionState((prev) => ({
          ...prev,
          visitorId: res.visitor_id,
          sessionId: res.session_id,
          isReturning: Boolean(res.is_returning),
          gpsConsentStatus: finalConsent,
          continuousGpsConsent: Boolean(res.continuous_gps_consent),
          locationSource: locSource,
        }));
        if (finalConsent !== "unset") {
          setBannerDismissed(true);
        }
      })
      .catch(() => {
        // Silent failure: telemetry should never disrupt primary MediTrack workflows
      });
  }, [activeTab]);

  // Track tab / page switches as pageview events
  useEffect(() => {
    if (prevTabRef.current === activeTab) return;
    prevTabRef.current = activeTab;
    const cur = stateRef.current;
    if (cur.analyticsOptOut || !registeredRef.current) return;

    const elapsedSec = Math.max(0, Math.round((Date.now() - sessionStartMsRef.current) / 1000));
    void sendVisitorEvent({
      visitor_id: cur.visitorId,
      session_id: cur.sessionId,
      event_type: "pageview",
      page_path: `/?tab=${activeTab}`,
      page_title: TAB_TITLES[activeTab] || "MediTrack",
      duration_sec: elapsedSec,
    }).catch(() => {});
  }, [activeTab]);

  // Heartbeat every 20s and session end beacon on pagehide
  useEffect(() => {
    const interval = window.setInterval(() => {
      const cur = stateRef.current;
      if (cur.analyticsOptOut || !registeredRef.current) return;
      const elapsedSec = Math.max(0, Math.round((Date.now() - sessionStartMsRef.current) / 1000));
      void sendVisitorEvent({
        visitor_id: cur.visitorId,
        session_id: cur.sessionId,
        event_type: "heartbeat",
        page_path: `/?tab=${prevTabRef.current}`,
        duration_sec: elapsedSec,
      }).catch(() => {});
    }, 20000);

    const handlePageHide = () => {
      const cur = stateRef.current;
      if (cur.analyticsOptOut || !registeredRef.current) return;
      const elapsedSec = Math.max(0, Math.round((Date.now() - sessionStartMsRef.current) / 1000));
      void sendVisitorEvent(
        {
          visitor_id: cur.visitorId,
          session_id: cur.sessionId,
          event_type: "end",
          page_path: `/?tab=${prevTabRef.current}`,
          duration_sec: elapsedSec,
        },
        true
      ).catch(() => {});
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  // Continuous GPS watch only when BOTH base GPS and continuous GPS consent are explicitly granted
  useEffect(() => {
    if (
      !gpsAvailable ||
      sessionState.analyticsOptOut ||
      sessionState.gpsConsentStatus !== "granted" ||
      !sessionState.continuousGpsConsent
    ) {
      if (watchIdRef.current !== null && gpsAvailable) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const nowMs = Date.now();
        if (nowMs - lastContinuousSentMsRef.current < 30000) return;
        lastContinuousSentMsRef.current = nowMs;
        const cur = stateRef.current;
        const ts = new Date(pos.timestamp || nowMs).toISOString();
        const acc = Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null;
        void submitVisitorGpsLocation({
          visitor_id: cur.visitorId,
          session_id: cur.sessionId,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy_m: acc,
          location_timestamp: ts,
          consent_granted: true,
          is_continuous: true,
        })
          .then((res) => {
            setLastCapturedCoords({
              latitude: res.latitude,
              longitude: res.longitude,
              accuracy_m: res.accuracy_m,
              timestamp: ts,
            });
            setSessionState((prev) => ({ ...prev, locationSource: "gps" }));
          })
          .catch(() => {});
      },
      () => {
        // Ignore transient watchPosition errors without re-prompting
      },
      { enableHighAccuracy: false, maximumAge: 30000, timeout: 15000 }
    );
    watchIdRef.current = id;

    return () => {
      navigator.geolocation.clearWatch(id);
      watchIdRef.current = null;
    };
  }, [
    gpsAvailable,
    sessionState.analyticsOptOut,
    sessionState.gpsConsentStatus,
    sessionState.continuousGpsConsent,
  ]);

  const declineGpsAccess = useCallback(async () => {
    const cur = stateRef.current;
    setStoredConsentPref("denied");
    setBannerDismissed(true);
    setSessionState((prev) => ({
      ...prev,
      gpsConsentStatus: "denied",
      continuousGpsConsent: false,
    }));
    setGpsFeedback("GPS sharing declined. Approximate IP-based estimation may apply unless opted out.");
    if (!cur.analyticsOptOut) {
      try {
        await updateVisitorConsent({
          visitor_id: cur.visitorId,
          session_id: cur.sessionId,
          consent_type: "gps",
          status: "denied",
        });
      } catch {
        // ignore network hiccup
      }
    }
  }, []);

  const requestGpsAccess = useCallback(() => {
    const cur = stateRef.current;
    if (cur.analyticsOptOut) {
      setGpsFeedback("Re-enable visitor analytics below before sharing GPS coordinates.");
      return;
    }
    if (!gpsAvailable) {
      setGpsFeedback("Browser Geolocation API is unavailable on this device. Falling back to IP estimate.");
      void declineGpsAccess();
      return;
    }

    setGpsBusy(true);
    setGpsFeedback("Requesting browser location permission...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const ts = new Date(position.timestamp || Date.now()).toISOString();
        const acc = Number.isFinite(position.coords.accuracy)
          ? Math.round(position.coords.accuracy)
          : null;

        void submitVisitorGpsLocation({
          visitor_id: cur.visitorId,
          session_id: cur.sessionId,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy_m: acc,
          location_timestamp: ts,
          consent_granted: true,
        })
          .then((res) => {
            setStoredConsentPref("granted");
            setBannerDismissed(true);
            setLastCapturedCoords({
              latitude: res.latitude,
              longitude: res.longitude,
              accuracy_m: res.accuracy_m,
              timestamp: ts,
            });
            setSessionState((prev) => ({
              ...prev,
              gpsConsentStatus: "granted",
              locationSource: "gps",
            }));
            setGpsFeedback(
              `Precise GPS captured (${res.latitude.toFixed(4)}, ${res.longitude.toFixed(4)}${
                res.accuracy_m !== null ? `, ±${res.accuracy_m}m` : ""
              }).`
            );
          })
          .catch((err) => {
            setGpsFeedback(err instanceof Error ? err.message : "Failed to store GPS location.");
          })
          .finally(() => setGpsBusy(false));
      },
      (err) => {
        setGpsBusy(false);
        if (err.code === 1) {
          setStoredConsentPref("denied");
          setBannerDismissed(true);
          setSessionState((prev) => ({
            ...prev,
            gpsConsentStatus: "denied",
            continuousGpsConsent: false,
          }));
          setGpsFeedback(
            "GPS permission was denied in your browser. We will not prompt again automatically."
          );
          void updateVisitorConsent({
            visitor_id: cur.visitorId,
            session_id: cur.sessionId,
            consent_type: "gps",
            status: "denied",
          }).catch(() => {});
        } else {
          setGpsFeedback("GPS coordinates unavailable right now. Falling back to approximate IP region if enabled.");
          setBannerDismissed(true);
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }, [declineGpsAccess, gpsAvailable]);

  const revokeGpsAccess = useCallback(async () => {
    const cur = stateRef.current;
    if (watchIdRef.current !== null && gpsAvailable) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setStoredConsentPref("revoked");
    setLastCapturedCoords(null);
    setBannerDismissed(true);
    setSessionState((prev) => ({
      ...prev,
      gpsConsentStatus: "revoked",
      continuousGpsConsent: false,
      locationSource: prev.locationSource === "gps" ? "none" : prev.locationSource,
    }));
    try {
      await updateVisitorConsent({
        visitor_id: cur.visitorId,
        session_id: cur.sessionId,
        consent_type: "gps",
        status: "revoked",
      });
      setGpsFeedback("GPS consent revoked and stored GPS coordinates wiped from this record.");
    } catch (err) {
      setGpsFeedback(err instanceof Error ? err.message : "Failed to revoke GPS consent.");
    }
  }, [gpsAvailable]);

  const toggleContinuousGps = useCallback(async (enable: boolean) => {
    const cur = stateRef.current;
    if (enable && cur.gpsConsentStatus !== "granted") {
      setGpsFeedback("Grant one-time GPS location permission first before enabling continuous updates.");
      return;
    }
    try {
      const res = await updateVisitorConsent({
        visitor_id: cur.visitorId,
        session_id: cur.sessionId,
        consent_type: "continuous_gps",
        status: enable ? "granted" : "revoked",
      });
      setSessionState((prev) => ({
        ...prev,
        continuousGpsConsent: res.continuous_gps_consent,
      }));
      setGpsFeedback(
        enable
          ? "Continuous GPS updates enabled (throttled every 30s while tab is active)."
          : "Continuous GPS updates turned off."
      );
    } catch (err) {
      setGpsFeedback(err instanceof Error ? err.message : "Unable to update continuous GPS setting.");
    }
  }, []);

  const optOutAnalytics = useCallback(async () => {
    const cur = stateRef.current;
    if (watchIdRef.current !== null && gpsAvailable) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    try {
      await updateVisitorConsent({
        visitor_id: cur.visitorId,
        session_id: cur.sessionId,
        consent_type: "analytics",
        status: "opted_out",
      });
    } catch {
      // ignore if profile hasn't been registered yet
    }
    clearFirstPartyVisitorStorage(true);
    setBannerDismissed(true);
    setLastCapturedCoords(null);
    setSessionState((prev) => ({
      ...prev,
      analyticsOptOut: true,
      gpsConsentStatus: "revoked",
      continuousGpsConsent: false,
      locationSource: "none",
    }));
    setGpsFeedback("You have opted out of visitor analytics and location collection.");
  }, [gpsAvailable]);

  const optInAnalytics = useCallback(async () => {
    clearFirstPartyVisitorStorage(false);
    const fresh = getOrCreateVisitorIds();
    registeredRef.current = false;
    setSessionState({
      visitorId: fresh.visitorId,
      sessionId: fresh.sessionId,
      isReturning: false,
      gpsConsentStatus: "unset",
      continuousGpsConsent: false,
      analyticsOptOut: false,
      locationSource: "none",
    });
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const meta = detectBrowserAndDevice(ua);
    try {
      const res = await registerVisitorVisit({
        visitor_id: fresh.visitorId,
        session_id: fresh.sessionId,
        landing_page: `/?tab=${prevTabRef.current}`,
        page_title: TAB_TITLES[prevTabRef.current] || "MediTrack",
        referrer_source: getSafeReferrer(),
        device_category: meta.deviceCategory,
        browser: meta.browser,
      });
      registeredRef.current = true;
      setSessionState((prev) => ({
        ...prev,
        locationSource: res.location_source || "none",
      }));
      setGpsFeedback("Visitor analytics re-enabled with a fresh pseudonymous ID.");
    } catch {
      setGpsFeedback("Analytics preference updated.");
    }
  }, []);

  const deleteOwnRecords = useCallback(async () => {
    const cur = stateRef.current;
    if (watchIdRef.current !== null && gpsAvailable) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    try {
      await deleteMyVisitorData(cur.visitorId);
      clearFirstPartyVisitorStorage(true);
      setBannerDismissed(true);
      setLastCapturedCoords(null);
      setSessionState((prev) => ({
        ...prev,
        analyticsOptOut: true,
        gpsConsentStatus: "revoked",
        continuousGpsConsent: false,
        locationSource: "none",
      }));
      setGpsFeedback("Your visitor profile, sessions, page views, and location logs have been deleted.");
    } catch (err) {
      setGpsFeedback(err instanceof Error ? err.message : "Failed to delete visitor records.");
    }
  }, [gpsAvailable]);

  return {
    sessionState,
    bannerDismissed,
    privacyModalOpen,
    gpsBusy,
    gpsFeedback,
    gpsAvailable,
    lastCapturedCoords,
    openPrivacyModal: () => setPrivacyModalOpen(true),
    closePrivacyModal: () => setPrivacyModalOpen(false),
    dismissBanner: () => setBannerDismissed(true),
    requestGpsAccess,
    declineGpsAccess,
    revokeGpsAccess,
    toggleContinuousGps,
    optOutAnalytics,
    optInAnalytics,
    deleteOwnRecords,
  };
}
