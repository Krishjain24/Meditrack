import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  Compass,
  ExternalLink,
  Maximize2,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { VisitorMapMarker } from "../types/meditrack";
import {
  formatCoords,
  formatSessionDuration,
  getLocationSourceBadge,
  projectWorldLatLng,
} from "../utils/visitorClient";
import { formatUtcTime } from "../utils/wasteLogic";

interface VisitorMapPanelProps {
  mapboxToken: string;
  markers: VisitorMapMarker[];
  sourceFilter: "all" | "gps" | "ip";
  refreshedAt: string;
  loading: boolean;
  autoRefresh: boolean;
  onChangeSourceFilter: (src: "all" | "gps" | "ip") => void;
  onToggleAutoRefresh: (enabled: boolean) => void;
  onRefresh: () => void;
  onInspectVisitor: (visitorId: string) => void;
}

const SVG_WIDTH = 960;
const SVG_HEIGHT = 480;

// Clean simplified continent silhouettes in equirectangular SVG coordinates (0..960 x 0..480)
const WORLD_LAND_PATHS = [
  // North America
  "M110,85 L220,72 L275,92 L292,135 L258,175 L230,192 L212,216 L195,212 L175,180 L132,148 Z",
  // Greenland
  "M308,42 L362,36 L380,68 L332,84 Z",
  // South America
  "M235,228 L295,236 L334,274 L318,342 L280,404 L256,396 L246,320 L226,272 Z",
  // Europe
  "M442,88 L525,74 L556,104 L535,146 L486,154 L446,138 L434,114 Z",
  // Africa
  "M442,165 L522,162 L566,198 L576,262 L536,342 L494,352 L468,284 L434,225 Z",
  // Asia
  "M542,76 L710,64 L824,94 L832,146 L780,186 L744,218 L690,236 L638,214 L584,186 L552,144 Z",
  // Southeast Asia / Indonesia
  "M712,238 L788,244 L806,268 L742,272 Z",
  // Australia
  "M746,294 L832,292 L852,338 L818,366 L748,354 L736,318 Z",
];

function disableMapboxTelemetry(): void {
  try {
    const cfg = (mapboxgl as unknown as { config?: Record<string, unknown> }).config;
    if (cfg) {
      Object.defineProperty(cfg, "EVENTS_URL", {
        get: () => null,
        configurable: true,
      });
    }
  } catch {
    // ignore
  }
}

export function VisitorMapPanel({
  mapboxToken,
  markers,
  sourceFilter,
  refreshedAt,
  loading,
  autoRefresh,
  onChangeSourceFilter,
  onToggleAutoRefresh,
  onRefresh,
  onInspectVisitor,
}: VisitorMapPanelProps) {
  const [selectedMarker, setSelectedMarker] = useState<VisitorMapMarker | null>(
    markers[0] ?? null
  );
  const [mapboxFailed, setMapboxFailed] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapboxMarkersRef = useRef<mapboxgl.Marker[]>([]);

  const useMapbox = Boolean(mapboxToken && !mapboxFailed);

  useEffect(() => {
    if (markers.length === 0) {
      setSelectedMarker(null);
      return;
    }
    setSelectedMarker((prev) => {
      if (!prev) return markers[0];
      return markers.find((m) => m.session_id === prev.session_id) ?? markers[0];
    });
  }, [markers]);

  // Initialize Mapbox GL when token is present
  useEffect(() => {
    if (!useMapbox || !mapContainerRef.current) return;
    disableMapboxTelemetry();
    mapboxgl.accessToken = mapboxToken;

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: "mapbox://styles/mapbox/light-v11",
        center: [25, 20],
        zoom: 1.5,
        attributionControl: true,
      });
    } catch {
      setMapboxFailed(true);
      return;
    }

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("error", () => {
      setMapboxFailed(true);
    });
    mapRef.current = map;

    return () => {
      mapboxMarkersRef.current.forEach((m) => m.remove());
      mapboxMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [useMapbox, mapboxToken]);

  // Sync Mapbox markers
  useEffect(() => {
    const map = mapRef.current;
    if (!useMapbox || !map) return;

    mapboxMarkersRef.current.forEach((m) => m.remove());
    mapboxMarkersRef.current = [];

    const bounds = new mapboxgl.LngLatBounds();
    markers.forEach((marker) => {
      const isGps = marker.location_source === "gps";
      const el = document.createElement("button");
      el.type = "button";
      el.dataset.testid = "visitor-map-marker";
      el.setAttribute(
        "aria-label",
        `${marker.visitor_id} ${isGps ? "GPS" : "IP Estimate"} ${marker.city}`
      );
      el.style.width = isGps ? "18px" : "16px";
      el.style.height = isGps ? "18px" : "16px";
      el.style.borderRadius = isGps ? "9999px" : "4px";
      el.style.backgroundColor = isGps ? "#059669" : "#d97706";
      el.style.border = "2px solid #ffffff";
      el.style.boxShadow = "0 2px 6px rgba(15,23,42,0.35)";
      el.style.cursor = "pointer";
      el.onclick = () => setSelectedMarker(marker);

      const mbMarker = new mapboxgl.Marker({ element: el })
        .setLngLat([marker.longitude, marker.latitude])
        .addTo(map);
      mapboxMarkersRef.current.push(mbMarker);
      bounds.extend([marker.longitude, marker.latitude]);
    });

    if (markers.length === 1) {
      map.flyTo({
        center: [markers[0].longitude, markers[0].latitude],
        zoom: 6,
        essential: true,
      });
    } else if (markers.length > 1) {
      map.fitBounds(bounds, { padding: 48, maxZoom: 9, duration: 500 });
    }
  }, [useMapbox, markers]);

  const gpsCount = useMemo(
    () => markers.filter((m) => m.location_source === "gps").length,
    [markers]
  );
  const ipCount = useMemo(
    () => markers.filter((m) => m.location_source === "ip").length,
    [markers]
  );

  const selectedBadge = selectedMarker
    ? getLocationSourceBadge(selectedMarker.location_source)
    : null;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Live Consented GPS &amp; IP-Estimated Visitor Map
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Circles mark precise browser GPS (consented); squares mark approximate IP geolocation
            (never presented as GPS).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            {(
              [
                { id: "all", label: `All (${markers.length})` },
                { id: "gps", label: `GPS (${gpsCount})` },
                { id: "ip", label: `IP Estimate (${ipCount})` },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeSourceFilter(opt.id)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  sourceFilter === opt.id
                    ? "bg-white text-blue-700 shadow-xs border border-slate-200"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => onToggleAutoRefresh(e.target.checked)}
              className="rounded border-slate-300 text-blue-700"
            />
            <span>Auto-refresh (15s)</span>
          </label>

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 bg-slate-50/70">
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-800">
                <span className="w-3 h-3 rounded-full bg-emerald-600 border border-white inline-block" />
                GPS (Consented)
              </span>
              <span className="inline-flex items-center gap-1.5 font-medium text-amber-800">
                <span className="w-3 h-3 rounded-xs bg-amber-600 border border-white inline-block" />
                IP Estimate (Approximate · Not GPS)
              </span>
            </div>
            <span className="font-mono text-[11px] text-slate-500">
              {refreshedAt ? `Updated ${formatUtcTime(refreshedAt)}` : "Live feed"}
            </span>
          </div>

          {useMapbox ? (
            <div
              ref={mapContainerRef}
              data-testid="visitor-mapbox-canvas"
              className="w-full h-[420px]"
            />
          ) : (
            <div className="relative bg-slate-100/80 select-none">
              <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-white/95 border border-slate-200 rounded-lg p-1 shadow-xs">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(5, +(z + 0.5).toFixed(1)))}
                  aria-label="Zoom in map"
                  className="p-1.5 text-slate-700 hover:bg-slate-100 rounded"
                >
                  <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
                  aria-label="Zoom out map"
                  className="p-1.5 text-slate-700 hover:bg-slate-100 rounded"
                >
                  <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                  aria-label="Reset map view"
                  className="p-1.5 text-slate-700 hover:bg-slate-100 rounded"
                >
                  <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>

              <svg
                viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                data-testid="visitor-svg-map"
                className="w-full h-[360px] sm:h-[420px] cursor-grab active:cursor-grabbing bg-[#eef4f9]"
                onPointerDown={(e) => {
                  dragRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
                }}
                onPointerMove={(e) => {
                  if (!dragRef.current) return;
                  setPan({
                    x: Math.max(-320, Math.min(320, e.clientX - dragRef.current.x)),
                    y: Math.max(-180, Math.min(180, e.clientY - dragRef.current.y)),
                  });
                }}
                onPointerUp={() => {
                  dragRef.current = null;
                }}
                onPointerLeave={() => {
                  dragRef.current = null;
                }}
              >
                <g
                  transform={`translate(${SVG_WIDTH / 2 + pan.x}, ${SVG_HEIGHT / 2 + pan.y}) scale(${zoom}) translate(${-SVG_WIDTH / 2}, ${-SVG_HEIGHT / 2})`}
                >
                  {/* Lat/Lng graticule */}
                  {[-60, -30, 0, 30, 60].map((lat) => {
                    const y = ((90 - lat) / 180) * SVG_HEIGHT;
                    return (
                      <line
                        key={`lat-${lat}`}
                        x1={0}
                        y1={y}
                        x2={SVG_WIDTH}
                        y2={y}
                        stroke={lat === 0 ? "#cbd5e1" : "#dbe7f2"}
                        strokeWidth={lat === 0 ? 1 : 0.7}
                      />
                    );
                  })}
                  {[-120, -60, 0, 60, 120].map((lng) => {
                    const x = ((lng + 180) / 360) * SVG_WIDTH;
                    return (
                      <line
                        key={`lng-${lng}`}
                        x1={x}
                        y1={0}
                        x2={x}
                        y2={SVG_HEIGHT}
                        stroke={lng === 0 ? "#cbd5e1" : "#dbe7f2"}
                        strokeWidth={lng === 0 ? 1 : 0.7}
                      />
                    );
                  })}

                  {/* Continents */}
                  {WORLD_LAND_PATHS.map((d, idx) => (
                    <path
                      key={idx}
                      d={d}
                      fill="#dbe4ee"
                      stroke="#b8c7d9"
                      strokeWidth={1}
                    />
                  ))}

                  {/* Visitor location markers */}
                  {markers.map((marker) => {
                    const pt = projectWorldLatLng(
                      marker.latitude,
                      marker.longitude,
                      SVG_WIDTH,
                      SVG_HEIGHT
                    );
                    const isGps = marker.location_source === "gps";
                    const isSelected = selectedMarker?.session_id === marker.session_id;
                    const r = (isSelected ? 8 : 6) / Math.sqrt(zoom);
                    const strokeW = 2 / Math.sqrt(zoom);

                    return (
                      <g
                        key={marker.session_id}
                        transform={`translate(${pt.x}, ${pt.y})`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedMarker(marker);
                        }}
                        data-testid="visitor-map-marker"
                        role="button"
                        tabIndex={0}
                        aria-label={`${marker.visitor_id} (${isGps ? "GPS" : "IP Estimate"})`}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedMarker(marker);
                          }
                        }}
                        className="cursor-pointer"
                      >
                        {isSelected && (
                          <circle
                            r={r * 1.9}
                            fill="none"
                            stroke={isGps ? "#059669" : "#d97706"}
                            strokeWidth={strokeW * 0.8}
                            opacity={0.45}
                          />
                        )}
                        {isGps ? (
                          <circle
                            r={r}
                            fill="#059669"
                            stroke="#ffffff"
                            strokeWidth={strokeW}
                          />
                        ) : (
                          <rect
                            x={-r}
                            y={-r}
                            width={r * 2}
                            height={r * 2}
                            rx={2 / Math.sqrt(zoom)}
                            fill="#d97706"
                            stroke="#ffffff"
                            strokeWidth={strokeW}
                          />
                        )}
                      </g>
                    );
                  })}
                </g>
              </svg>

              {markers.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-white/95 border border-slate-200 rounded-xl px-4 py-3 text-center max-w-xs shadow-xs">
                    <Compass className="w-5 h-5 text-slate-400 mx-auto mb-1" aria-hidden="true" />
                    <p className="text-xs font-semibold text-slate-800">
                      No geolocated visitor sessions yet
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Markers appear once a visitor grants GPS permission or connects via a public
                      IP address.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Selected marker inspector */}
        <div
          className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
          data-testid="visitor-map-inspector"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Marker Inspector</h3>
            {selectedBadge && (
              <span
                className={`px-2 py-0.5 text-[11px] font-semibold border rounded-md ${selectedBadge.className}`}
              >
                {selectedBadge.label}
              </span>
            )}
          </div>

          {selectedMarker ? (
            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                <p className="font-mono font-semibold text-slate-900">
                  {selectedMarker.visitor_id}
                </p>
                <p className="text-[11px] text-slate-500 font-mono">
                  Session {selectedMarker.session_id}
                </p>
                <p className="text-[11px] text-slate-600 pt-1">
                  {selectedBadge?.detail}
                </p>
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                <div>
                  <dt className="text-slate-500">Region / City</dt>
                  <dd className="font-medium text-slate-900">
                    {[selectedMarker.city, selectedMarker.country]
                      .filter((x) => x && x !== "Unknown")
                      .join(", ") ||
                      (selectedMarker.location_source === "gps"
                        ? "GPS Coordinates Only"
                        : "Unavailable")}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Coordinates</dt>
                  <dd className="font-mono tabular-nums text-slate-900">
                    {formatCoords(selectedMarker.latitude, selectedMarker.longitude)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Accuracy</dt>
                  <dd className="font-mono tabular-nums text-slate-900">
                    {selectedMarker.location_source === "gps" && selectedMarker.accuracy_m !== null
                      ? `±${selectedMarker.accuracy_m} m`
                      : "City/Network Approx."}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Session Duration</dt>
                  <dd className="font-mono tabular-nums text-slate-900">
                    {formatSessionDuration(selectedMarker.duration_sec)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Device &amp; Browser</dt>
                  <dd className="text-slate-900 capitalize">
                    {selectedMarker.device_category} · {selectedMarker.browser}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Visitor Status</dt>
                  <dd className="text-slate-900">
                    {selectedMarker.is_returning ? "Returning" : "New"}
                    {selectedMarker.is_active ? " · Active now" : ""}
                  </dd>
                </div>
              </dl>

              <button
                type="button"
                onClick={() => onInspectVisitor(selectedMarker.visitor_id)}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors"
              >
                <span>Open Full Visitor Profile</span>
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-500 py-8 text-center">
              Select a marker on the map to inspect visitor telemetry and location provenance.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
