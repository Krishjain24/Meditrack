import type { GpsConsentStatus, VisitorLocationSource } from "../types/meditrack";

export const VISITOR_ID_STORAGE_KEY = "meditrack_visitor_id";
export const SESSION_ID_STORAGE_KEY = "meditrack_session_id";
export const CONSENT_PREF_STORAGE_KEY = "meditrack_location_pref";
export const OPT_OUT_STORAGE_KEY = "meditrack_analytics_opt_out";

export function generateRandomHex(bytesLen: number): string {
  const bytes = new Uint8Array(bytesLen);
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export function getOrCreateVisitorIds(): {
  visitorId: string;
  sessionId: string;
  optedOut: boolean;
} {
  if (typeof window === "undefined") {
    return {
      visitorId: `VIS-${generateRandomHex(6)}`,
      sessionId: `SES-${generateRandomHex(8)}`,
      optedOut: false,
    };
  }
  const optedOut = window.localStorage.getItem(OPT_OUT_STORAGE_KEY) === "1";
  let visitorId = window.localStorage.getItem(VISITOR_ID_STORAGE_KEY) || "";
  if (!optedOut && !/^[A-Za-z0-9_-]{8,64}$/.test(visitorId)) {
    visitorId = `VIS-${generateRandomHex(6)}`;
    window.localStorage.setItem(VISITOR_ID_STORAGE_KEY, visitorId);
  }
  let sessionId = window.sessionStorage.getItem(SESSION_ID_STORAGE_KEY) || "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(sessionId)) {
    sessionId = `SES-${generateRandomHex(8)}`;
    window.sessionStorage.setItem(SESSION_ID_STORAGE_KEY, sessionId);
  }
  return {
    visitorId: visitorId || `VIS-${generateRandomHex(6)}`,
    sessionId,
    optedOut,
  };
}

export function getStoredConsentPref(): GpsConsentStatus {
  if (typeof window === "undefined") return "unset";
  const val = window.localStorage.getItem(CONSENT_PREF_STORAGE_KEY);
  if (val === "granted" || val === "denied" || val === "revoked") {
    return val;
  }
  return "unset";
}

export function setStoredConsentPref(status: GpsConsentStatus): void {
  if (typeof window === "undefined") return;
  if (status === "unset") {
    window.localStorage.removeItem(CONSENT_PREF_STORAGE_KEY);
  } else {
    window.localStorage.setItem(CONSENT_PREF_STORAGE_KEY, status);
  }
}

export function clearFirstPartyVisitorStorage(markOptOut: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(VISITOR_ID_STORAGE_KEY);
  window.localStorage.removeItem(CONSENT_PREF_STORAGE_KEY);
  window.sessionStorage.removeItem(SESSION_ID_STORAGE_KEY);
  if (markOptOut) {
    window.localStorage.setItem(OPT_OUT_STORAGE_KEY, "1");
  } else {
    window.localStorage.removeItem(OPT_OUT_STORAGE_KEY);
  }
}

export function detectBrowserAndDevice(userAgent: string): {
  deviceCategory: string;
  browser: string;
} {
  const ua = (userAgent || "").toLowerCase();
  let deviceCategory = "desktop";
  if (/bot|crawler|spider/.test(ua)) {
    deviceCategory = "bot";
  } else if (/ipad|tablet/.test(ua) || (/android/.test(ua) && !/mobile/.test(ua))) {
    deviceCategory = "tablet";
  } else if (/mobile|iphone|ipod|android/.test(ua)) {
    deviceCategory = "mobile";
  } else if (!ua) {
    deviceCategory = "unknown";
  }

  let browser = "Other";
  if (ua.includes("edg/") || ua.includes("edge/")) {
    browser = "Edge";
  } else if (ua.includes("opr/") || ua.includes("opera")) {
    browser = "Opera";
  } else if (ua.includes("firefox/") || ua.includes("fxios/")) {
    browser = "Firefox";
  } else if (ua.includes("brave")) {
    browser = "Brave";
  } else if (ua.includes("chrome/") || ua.includes("crios/")) {
    browser = "Chrome";
  } else if (ua.includes("safari/")) {
    browser = "Safari";
  }

  return { deviceCategory, browser };
}

export function formatSessionDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s < 60) return `${s}s`;
  const mins = Math.floor(s / 60);
  const remSec = s % 60;
  if (mins < 60) return `${mins}m ${remSec}s`;
  const hrs = Math.floor(mins / 60);
  const remMin = mins % 60;
  return `${hrs}h ${remMin}m`;
}

export function formatCoords(lat: number | null, lng: number | null): string {
  if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return "Unavailable";
  }
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

export function getLocationSourceBadge(source: VisitorLocationSource): {
  label: string;
  detail: string;
  className: string;
} {
  if (source === "gps") {
    return {
      label: "GPS (Consented)",
      detail: "Browser Geolocation API · Precise",
      className: "text-emerald-800 bg-emerald-50 border-emerald-200",
    };
  }
  if (source === "ip") {
    return {
      label: "IP Estimate",
      detail: "Approximate network location · Not GPS",
      className: "text-amber-800 bg-amber-50 border-amber-200",
    };
  }
  return {
    label: "Unavailable",
    detail: "No location recorded",
    className: "text-slate-600 bg-slate-100 border-slate-200",
  };
}

export function projectWorldLatLng(
  lat: number,
  lng: number,
  width: number,
  height: number
): { x: number; y: number } {
  const clampedLng = Math.max(-180, Math.min(180, lng));
  const clampedLat = Math.max(-85, Math.min(85, lat));
  const x = ((clampedLng + 180) / 360) * width;
  const y = ((90 - clampedLat) / 180) * height;
  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
  };
}
