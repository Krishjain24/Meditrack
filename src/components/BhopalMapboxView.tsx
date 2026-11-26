import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  Loader2,
  MapPin,
  Plus,
  Route as RouteIcon,
  Search,
  Trash2,
} from "lucide-react";
import {
  fetchMapboxDirections,
  searchBhopalMapboxPlaces,
  type MapboxDirectionsResult,
} from "../api/client";
import type { DashboardPayload, Vehicle } from "../types/meditrack";
import {
  buildSeedBhopalHospitalPlaces,
  type BhopalMapPlace,
} from "../utils/wasteLogic";

interface DispatchRouteRequest {
  id: number;
  coordinates: Array<{ lat: number; lng: number }>;
  stopCount: number;
}

interface BhopalMapboxViewProps {
  mapboxToken: string;
  facilities: DashboardPayload["facilities"];
  treatmentPlant: DashboardPayload["treatment_plant"];
  vehicles: Vehicle[];
  routeStopIds: string[];
  onToggleRouteStop: (id: string) => void;
  onClearRouteStops: () => void;
  onSetRouteStops: (ids: string[]) => void;
  dispatchRouteRequest?: DispatchRouteRequest | null;
}

const BHOPAL_CENTER: [number, number] = [77.4126, 23.2599];

const MAPBOX_STYLES: Array<{ id: string; label: string; url: string }> = [
  { id: "streets", label: "Streets", url: "mapbox://styles/mapbox/streets-v12" },
  { id: "light", label: "Light", url: "mapbox://styles/mapbox/light-v11" },
  {
    id: "satellite",
    label: "Satellite",
    url: "mapbox://styles/mapbox/satellite-streets-v12",
  },
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
    // ignore if non-configurable
  }
}

function createPinElement(
  label: string,
  bgColor: string,
  borderColor: string,
  title: string
): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.title = title;
  el.setAttribute("aria-label", title);
  el.textContent = label;
  el.style.width = "28px";
  el.style.height = "28px";
  el.style.borderRadius = "9999px";
  el.style.backgroundColor = bgColor;
  el.style.border = `2px solid ${borderColor}`;
  el.style.color = "#ffffff";
  el.style.fontSize = "11px";
  el.style.fontWeight = "700";
  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.boxShadow = "0 2px 6px rgba(15, 23, 42, 0.35)";
  el.style.cursor = "pointer";
  return el;
}

function buildHospitalPopupDom(
  hospital: BhopalMapPlace,
  isQueued: boolean,
  onToggle: (id: string) => void
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "max-w-[230px] space-y-1.5 p-1 text-slate-900";

  const title = document.createElement("p");
  title.className = "text-xs font-bold leading-snug";
  title.textContent = hospital.name;
  wrap.appendChild(title);

  const loc = document.createElement("p");
  loc.className = "text-[11px] font-medium text-blue-700";
  loc.textContent = `${hospital.locality}, Bhopal`;
  wrap.appendChild(loc);

  const addr = document.createElement("p");
  addr.className = "text-[11px] text-slate-600 leading-snug";
  addr.textContent = hospital.address;
  wrap.appendChild(addr);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className =
    "mt-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded";
  btn.textContent = isQueued ? "Remove from Route" : "Add to Bhopal Route";
  btn.addEventListener("click", () => onToggle(hospital.id));
  wrap.appendChild(btn);

  return wrap;
}

function buildPlantPopupDom(name: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "max-w-[230px] space-y-1 p-1 text-slate-900";

  const title = document.createElement("p");
  title.className = "text-xs font-bold leading-snug";
  title.textContent = name;
  wrap.appendChild(title);

  const sub = document.createElement("p");
  sub.className = "text-[11px] font-medium text-emerald-700";
  sub.textContent = "Authorized MPPCB CBWTF Plant · Govindpura, Bhopal";
  wrap.appendChild(sub);

  const desc = document.createElement("p");
  desc.className = "text-[11px] text-slate-600";
  desc.textContent =
    "Terminal incineration, autoclaving & QR chain-of-custody disposal destination.";
  wrap.appendChild(desc);

  return wrap;
}

function buildVehiclePopupDom(vehicle: Vehicle): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "max-w-[220px] space-y-1 p-1 text-slate-900";

  const title = document.createElement("p");
  title.className = "text-xs font-bold";
  title.textContent = `${vehicle.vehicle_code} · ${vehicle.driver_name}`;
  wrap.appendChild(title);

  const st = document.createElement("p");
  st.className = "text-[11px] font-medium text-indigo-700";
  st.textContent = `Status: ${vehicle.status}`;
  wrap.appendChild(st);

  const load = document.createElement("p");
  load.className = "text-[11px] font-mono text-slate-600";
  load.textContent = `Load: ${vehicle.current_load_kg.toFixed(1)} / ${vehicle.capacity_kg} kg`;
  wrap.appendChild(load);

  return wrap;
}

export function BhopalMapboxView({
  mapboxToken,
  facilities,
  treatmentPlant,
  vehicles,
  routeStopIds,
  onToggleRouteStop,
  onClearRouteStops,
  onSetRouteStops,
  dispatchRouteRequest,
}: BhopalMapboxViewProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const initialFetchedRef = useRef(false);
  const appliedStyleIdRef = useRef<string>("streets");

  const [styleId, setStyleId] = useState<string>("streets");
  const [hospitals, setHospitals] = useState<BhopalMapPlace[]>(() =>
    buildSeedBhopalHospitalPlaces(facilities)
  );
  const [selectedLocality, setSelectedLocality] = useState<string>("ALL");
  const [searchInput, setSearchInput] = useState<string>("");
  const [suggestions, setSuggestions] = useState<BhopalMapPlace[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState<boolean>(false);
  const [searchingQuery, setSearchingQuery] = useState<boolean>(false);
  const [placesError, setPlacesError] = useState<string>("");
  const [computingRoute, setComputingRoute] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string>("");
  const [roadRoute, setRoadRoute] = useState<
    (MapboxDirectionsResult & { orderedStopIds: string[] }) | null
  >(null);
  const roadRouteRef = useRef<
    (MapboxDirectionsResult & { orderedStopIds: string[] }) | null
  >(null);
  roadRouteRef.current = roadRoute;

  const mergeHospitals = useCallback((incoming: BhopalMapPlace[]) => {
    setHospitals((prev) => {
      const seen: Record<string, BhopalMapPlace> = {};
      const next: BhopalMapPlace[] = [];
      for (const h of prev) {
        seen[h.id] = h;
        next.push(h);
      }
      for (const h of incoming) {
        const dupByName = next.some(
          (existing) => existing.name.toLowerCase() === h.name.toLowerCase()
        );
        if (!seen[h.id] && !dupByName) {
          seen[h.id] = h;
          next.push(h);
        }
      }
      return next;
    });
  }, []);

  // Ensure MediTrack facilities stay seeded if facilities prop changes
  useEffect(() => {
    mergeHospitals(buildSeedBhopalHospitalPlaces(facilities));
  }, [facilities, mergeHospitals]);

  // Initial Mapbox Geocoding discovery for Bhopal hospitals
  useEffect(() => {
    if (!mapboxToken || initialFetchedRef.current) return;
    initialFetchedRef.current = true;
    setLoadingPlaces(true);
    setPlacesError("");
    void searchBhopalMapboxPlaces("hospital Bhopal")
      .then((res) => {
        if (res.places && res.places.length > 0) {
          mergeHospitals(res.places);
        }
      })
      .catch((err) => {
        setPlacesError(
          err instanceof Error
            ? err.message
            : "Unable to query Mapbox Geocoding API for Bhopal."
        );
      })
      .finally(() => setLoadingPlaces(false));
  }, [mapboxToken, mergeHospitals]);

  // Debounced Mapbox Geocoding autocomplete scoped to Bhopal
  useEffect(() => {
    if (!mapboxToken) return;
    const q = searchInput.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await searchBhopalMapboxPlaces(`${q} Bhopal`);
        if (!cancelled) {
          setSuggestions(res.places || []);
        }
      } catch {
        if (!cancelled) {
          setSuggestions([]);
        }
      }
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mapboxToken, searchInput]);

  const localityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const h of hospitals) {
      counts[h.locality] = (counts[h.locality] ?? 0) + 1;
    }
    return Object.entries(counts).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    );
  }, [hospitals]);

  const filteredHospitals = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    return hospitals.filter((h) => {
      const matchesLoc =
        selectedLocality === "ALL" || h.locality === selectedLocality;
      const matchesSearch =
        !q ||
        h.name.toLowerCase().includes(q) ||
        h.locality.toLowerCase().includes(q) ||
        h.address.toLowerCase().includes(q);
      return matchesLoc && matchesSearch;
    });
  }, [hospitals, searchInput, selectedLocality]);

  const drawRouteOnMap = useCallback(
    (
      map: mapboxgl.Map,
      route: (MapboxDirectionsResult & { orderedStopIds: string[] }) | null
    ): boolean => {
      const sourceId = "bhopal-collection-route";
      const casingLayerId = "bhopal-collection-route-casing";
      const layerId = "bhopal-collection-route-line";

      try {
        if (!map.getStyle()) return false;

        if (map.getLayer(layerId)) {
          map.removeLayer(layerId);
        }
        if (map.getLayer(casingLayerId)) {
          map.removeLayer(casingLayerId);
        }
        if (map.getSource(sourceId)) {
          map.removeSource(sourceId);
        }
        if (!route?.geometry) return true;

        map.addSource(sourceId, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: route.geometry,
          },
        });
        map.addLayer({
          id: casingLayerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": "#ffffff",
            "line-width": 8,
            "line-opacity": 0.9,
          },
        });
        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": "#1d4ed8",
            "line-width": 5,
            "line-opacity": 0.95,
          },
        });
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  // Initialize Mapbox GL JS map instance
  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current) return;

    disableMapboxTelemetry();
    mapboxgl.accessToken = mapboxToken;
    const styleObj =
      MAPBOX_STYLES.find((s) => s.id === styleId) ?? MAPBOX_STYLES[0];
    appliedStyleIdRef.current = styleObj.id;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: styleObj.url,
      center: BHOPAL_CENTER,
      zoom: 12,
      attributionControl: true,
      collectResourceTiming: false,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.addControl(new mapboxgl.FullscreenControl(), "top-right");
    mapRef.current = map;

    map.on("error", (ev) => {
      const msg = String(ev?.error?.message || "").replace(/^:\s*/, "");
      if (
        msg.includes("events.mapbox") ||
        msg.includes("ERR_BLOCKED_BY_CLIENT") ||
        msg.includes("Failed to fetch")
      ) {
        return;
      }
      setPlacesError((prev) => prev || msg || "Mapbox rendering error");
    });

    map.on("load", () => {
      drawRouteOnMap(map, roadRouteRef.current);
    });

    map.on("style.load", () => {
      drawRouteOnMap(map, roadRouteRef.current);
    });

    map.on("styledata", () => {
      if (
        roadRouteRef.current?.geometry &&
        !map.getLayer("bhopal-collection-route-line")
      ) {
        drawRouteOnMap(map, roadRouteRef.current);
      }
    });

    return () => {
      for (const m of markersRef.current) {
        m.remove();
      }
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // Only re-create map when token changes; style changes handled via setStyle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapboxToken]);

  // Switch Mapbox style ONLY when user selects a different style
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (appliedStyleIdRef.current === styleId) return;
    appliedStyleIdRef.current = styleId;
    const styleObj =
      MAPBOX_STYLES.find((s) => s.id === styleId) ?? MAPBOX_STYLES[0];
    map.setStyle(styleObj.url);
    const onStyleLoad = () => {
      drawRouteOnMap(map, roadRouteRef.current);
    };
    map.once("style.load", onStyleLoad);
    return () => {
      map.off("style.load", onStyleLoad);
    };
  }, [drawRouteOnMap, styleId]);

  // Sync GeoJSON route polyline whenever roadRoute updates
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const drew = drawRouteOnMap(map, roadRoute);
    if (!drew) {
      const onReady = () => {
        drawRouteOnMap(map, roadRouteRef.current);
      };
      map.once("style.load", onReady);
      return () => {
        map.off("style.load", onReady);
      };
    }
  }, [drawRouteOnMap, roadRoute]);

  // Sync Mapbox Markers (CBWTF Plant, Vehicles, Bhopal Hospitals)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const m of markersRef.current) {
      m.remove();
    }
    markersRef.current = [];

    // 1. CBWTF Treatment Plant marker
    const plantEl = createPinElement(
      "C",
      "#047857",
      "#064e3b",
      treatmentPlant.name
    );
    const plantMarker = new mapboxgl.Marker({ element: plantEl })
      .setLngLat([treatmentPlant.lng, treatmentPlant.lat])
      .setPopup(
        new mapboxgl.Popup({ offset: 18 }).setDOMContent(
          buildPlantPopupDom(treatmentPlant.name)
        )
      )
      .addTo(map);
    markersRef.current.push(plantMarker);

    // 2. Mobile Collection Vehicles
    vehicles.forEach((v, idx) => {
      const vEl = createPinElement(
        `V${idx + 1}`,
        "#4338ca",
        "#312e81",
        `${v.vehicle_code} (${v.driver_name})`
      );
      const vm = new mapboxgl.Marker({ element: vEl })
        .setLngLat([v.lng, v.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 18 }).setDOMContent(
            buildVehiclePopupDom(v)
          )
        )
        .addTo(map);
      markersRef.current.push(vm);
    });

    // 3. Bhopal Hospitals
    filteredHospitals.forEach((h) => {
      const stopIdx = routeStopIds.indexOf(h.id);
      const isQueued = stopIdx !== -1;
      const hEl = createPinElement(
        isQueued ? String(stopIdx + 1) : "H",
        isQueued ? "#1d4ed8" : "#dc2626",
        isQueued ? "#1e3a8a" : "#991b1b",
        `${h.name} (${h.locality})`
      );
      const hm = new mapboxgl.Marker({ element: hEl })
        .setLngLat([h.lng, h.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 18 }).setDOMContent(
            buildHospitalPopupDom(h, isQueued, onToggleRouteStop)
          )
        )
        .addTo(map);
      markersRef.current.push(hm);
    });
  }, [filteredHospitals, onToggleRouteStop, routeStopIds, treatmentPlant, vehicles]);

  const computeMapboxRoadRoute = useCallback(
    async (targetIds: string[]) => {
      const byId: Record<string, BhopalMapPlace> = {};
      for (const h of hospitals) {
        byId[h.id] = h;
      }
      const stops = targetIds
        .map((id) => byId[id])
        .filter((h): h is BhopalMapPlace => Boolean(h));

      if (stops.length < 2) {
        setRouteError(
          "Select at least 2 Bhopal hospitals to compute a Mapbox driving route."
        );
        return;
      }

      setComputingRoute(true);
      setRouteError("");
      try {
        const res = await fetchMapboxDirections(
          stops.map((s) => ({ lat: s.lat, lng: s.lng }))
        );
        setRoadRoute({ ...res, orderedStopIds: stops.map((s) => s.id) });

        const map = mapRef.current;
        if (map && res.geometry.coordinates.length > 1) {
          const bounds = new mapboxgl.LngLatBounds();
          for (const coord of res.geometry.coordinates) {
            bounds.extend(coord);
          }
          map.fitBounds(bounds, { padding: 48, duration: 700 });
        }
      } catch (err) {
        setRouteError(
          err instanceof Error
            ? err.message
            : "Failed to compute Mapbox driving route."
        );
      } finally {
        setComputingRoute(false);
      }
    },
    [hospitals]
  );

  // Automatically plot the dispatched vehicle route on Mapbox when "Optimize Dispatch Queue" is triggered
  useEffect(() => {
    if (!dispatchRouteRequest || dispatchRouteRequest.coordinates.length < 2) {
      return;
    }
    let cancelled = false;
    setComputingRoute(true);
    setRouteError("");
    void fetchMapboxDirections(dispatchRouteRequest.coordinates)
      .then((res) => {
        if (cancelled) return;
        const placeholderIds = Array.from(
          { length: dispatchRouteRequest.stopCount },
          (_, i) => `dispatch-${i + 1}`
        );
        setRoadRoute({ ...res, orderedStopIds: placeholderIds });
        const map = mapRef.current;
        if (map && res.geometry.coordinates.length > 1) {
          const bounds = new mapboxgl.LngLatBounds();
          for (const coord of res.geometry.coordinates) {
            bounds.extend(coord);
          }
          map.fitBounds(bounds, { padding: 48, duration: 700 });
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Fallback to direct waypoint segments so the dispatched path still appears on map
        const fallbackCoords: Array<[number, number]> =
          dispatchRouteRequest.coordinates.map((pt) => [pt.lng, pt.lat]);
        setRoadRoute({
          distanceKm: 0,
          durationMin: 0,
          geometry: { type: "LineString", coordinates: fallbackCoords },
          steps: [],
          orderedStopIds: Array.from(
            { length: dispatchRouteRequest.stopCount },
            (_, i) => `dispatch-${i + 1}`
          ),
        });
      })
      .finally(() => {
        if (!cancelled) setComputingRoute(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dispatchRouteRequest]);

  const handleLocalitySearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) return;
    setSuggestions([]);
    setSearchingQuery(true);
    setPlacesError("");
    try {
      const res = await searchBhopalMapboxPlaces(`hospital ${q} Bhopal`);
      if (res.places.length > 0) {
        mergeHospitals(res.places);
        const first = res.places[0];
        mapRef.current?.flyTo({
          center: [first.lng, first.lat],
          zoom: 13.5,
        });
      }
    } catch (err) {
      setPlacesError(
        err instanceof Error
          ? err.message
          : "Mapbox Geocoding search failed for Bhopal."
      );
    } finally {
      setSearchingQuery(false);
    }
  };

  const handlePickSuggestion = (place: BhopalMapPlace) => {
    mergeHospitals([place]);
    setSuggestions([]);
    setSelectedLocality("ALL");
    setSearchInput("");
    mapRef.current?.flyTo({
      center: [place.lng, place.lat],
      zoom: 14,
    });
  };

  const handleAutoRouteBhopal = () => {
    const candidates = (filteredHospitals.length >= 2 ? filteredHospitals : hospitals)
      .slice(0, 4)
      .map((h) => h.id);
    if (candidates.length >= 2) {
      onSetRouteStops(candidates);
      void computeMapboxRoadRoute(candidates);
    }
  };

  if (!mapboxToken) {
    return (
      <div
        className="h-[480px] rounded-xl border border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center p-6 text-center"
        data-testid="mapbox-token-missing"
      >
        <MapPin className="w-8 h-8 text-blue-700" aria-hidden="true" />
        <p className="mt-2 text-sm font-semibold text-slate-900">
          Mapbox Access Token Required
        </p>
        <p className="mt-1 text-xs text-slate-600 max-w-md">
          Add <code className="font-mono bg-slate-200/70 px-1 py-0.5 rounded">VITE_MAPBOX_ACCESS_TOKEN</code> or{" "}
          <code className="font-mono bg-slate-200/70 px-1 py-0.5 rounded">MAPBOX_ACCESS_TOKEN</code> in AI Studio Secrets or Vercel Environment Variables to activate Mapbox GL vector tiles, Geocoding, and Directions routing.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search Bhopal Hospitals & Localities Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <form onSubmit={handleLocalitySearchSubmit} className="relative flex-1 flex gap-2">
          <div className="relative flex-1">
            <label htmlFor="mapbox-bhopal-search" className="sr-only">
              Search Bhopal hospital or locality via Mapbox
            </label>
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              id="mapbox-bhopal-search"
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search hospital or Bhopal locality via Mapbox (Arera Colony, MP Nagar, Kolar Road)..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />

            {suggestions.length > 0 && (
              <ul className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-30 max-h-60 overflow-y-auto divide-y divide-slate-100">
                {suggestions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => handlePickSuggestion(s)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 transition-colors"
                    >
                      <span className="font-semibold text-slate-900 block">
                        {s.name}
                      </span>
                      <span className="text-slate-500">{s.address}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="submit"
            disabled={searchingQuery || !searchInput.trim()}
            className="px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {searchingQuery ? "Searching..." : "Search Bhopal"}
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (routeStopIds.length >= 2) {
                void computeMapboxRoadRoute(routeStopIds);
              } else {
                handleAutoRouteBhopal();
              }
            }}
            disabled={computingRoute || hospitals.length < 2}
            data-testid="compute-mapbox-route-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
          >
            <RouteIcon className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {computingRoute
                ? "Routing via Mapbox..."
                : routeStopIds.length >= 2
                ? `Route ${routeStopIds.length} Stops`
                : "Compute Mapbox Route"}
            </span>
          </button>

          {routeStopIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onClearRouteStops();
                setRoadRoute(null);
              }}
              className="px-2.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Bhopal Localities & Mapbox Style Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <span className="text-xs font-medium text-slate-500 whitespace-nowrap shrink-0">
            Bhopal Localities ({localityCounts.length}):
          </span>
          <button
            type="button"
            onClick={() => setSelectedLocality("ALL")}
            className={`px-2.5 py-1 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 transition-colors ${
              selectedLocality === "ALL"
                ? "bg-blue-700 text-white border-blue-700"
                : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
            }`}
          >
            All ({hospitals.length})
          </button>
          {localityCounts.map(([locality, count]) => (
            <button
              key={locality}
              type="button"
              onClick={() => setSelectedLocality(locality)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 transition-colors ${
                selectedLocality === locality
                  ? "bg-blue-700 text-white border-blue-700"
                  : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
              }`}
            >
              {locality} ({count})
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg shrink-0">
          {MAPBOX_STYLES.map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => setStyleId(st.id)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                styleId === st.id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      {placesError && (
        <div
          role="alert"
          className="p-3 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg"
        >
          {placesError}
        </div>
      )}

      {routeError && (
        <div
          role="alert"
          className="p-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg"
        >
          {routeError}
        </div>
      )}

      {/* Mapbox GL JS Container */}
      <div className="relative w-full h-[480px] rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
        {loadingPlaces && (
          <div className="absolute top-3 left-3 z-20 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/95 border border-slate-200 shadow-sm text-xs font-medium text-slate-700">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700" aria-hidden="true" />
            <span>Syncing Bhopal hospitals via Mapbox Geocoding...</span>
          </div>
        )}
        <div ref={mapContainerRef} className="w-full h-full" data-testid="mapbox-gl-canvas" />
      </div>

      {/* Live Map Marker Legend */}
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600 px-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-600" aria-hidden="true" />
          <span>H: Bhopal Hospital</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-700" aria-hidden="true" />
          <span>1..N: Queued Route Stop</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-700" aria-hidden="true" />
          <span>V1–V3: Collection Van</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-700" aria-hidden="true" />
          <span>C: {treatmentPlant.name}</span>
        </span>
      </div>

      {/* Mapbox Directions Road Route Summary */}
      {roadRoute && (
        <div
          className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl space-y-3"
          data-testid="mapbox-road-route-summary"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-800">
              Live Bhopal Road Route (Mapbox Directions API)
            </p>
            <p className="text-sm font-bold text-slate-900 mt-0.5">
              {roadRoute.distanceKm} km · Est. {roadRoute.durationMin} min driving across{" "}
              {roadRoute.orderedStopIds.length} Bhopal hospitals
            </p>
          </div>

          {roadRoute.steps.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-blue-200/80">
              {roadRoute.steps.map((st, idx) => (
                <div
                  key={`${idx}-${st.distanceText}`}
                  className="text-xs bg-white/90 border border-blue-100 rounded-lg px-3 py-2 flex items-start justify-between gap-2"
                >
                  <span className="text-slate-800">
                    <strong className="text-blue-700 mr-1">{idx + 1}.</strong>
                    {st.instruction}
                  </span>
                  <span className="font-mono text-[11px] text-slate-500 whitespace-nowrap shrink-0">
                    {st.distanceText}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bhopal Hospitals Directory */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
            Bhopal Hospitals &amp; Localities Directory ({filteredHospitals.length})
          </h3>
          <span className="text-[11px] text-slate-500">Powered by Mapbox GL &amp; Geocoding API</span>
        </div>
        <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
          {filteredHospitals.map((h) => {
            const stopIdx = routeStopIds.indexOf(h.id);
            const isQueued = stopIdx !== -1;
            return (
              <div
                key={h.id}
                className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50"
              >
                <button
                  type="button"
                  onClick={() => {
                    mapRef.current?.flyTo({
                      center: [h.lng, h.lat],
                      zoom: 14,
                    });
                  }}
                  className="min-w-0 text-left flex-1"
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-rose-600 shrink-0" aria-hidden="true" />
                    <span className="text-xs font-semibold text-slate-900 truncate">
                      {h.name}
                    </span>
                    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-700 rounded shrink-0">
                      {h.locality}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate pl-5">{h.address}</p>
                </button>

                <button
                  type="button"
                  onClick={() => onToggleRouteStop(h.id)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                    isQueued
                      ? "bg-blue-700 text-white hover:bg-blue-800"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {isQueued ? (
                    <>
                      <Trash2 className="w-3 h-3" aria-hidden="true" />
                      <span>Stop #{stopIdx + 1}</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3 h-3" aria-hidden="true" />
                      <span>Queue</span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
