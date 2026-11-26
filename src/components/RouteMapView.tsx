/// <reference types="google.maps" />
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map,
  Pin,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  Navigation,
  Plus,
  Route as RouteIcon,
  Search,
  Star,
  Trash2,
  Truck,
} from "lucide-react";
import { completeBinCollection, optimizeRoutes } from "../api/client";
import type { DashboardPayload, RoutePlan, Vehicle } from "../types/meditrack";
import {
  extractBhopalLocality,
  getCategoryMeta,
  isMapsQuotaError,
} from "../utils/wasteLogic";
import { BhopalMapboxView } from "./BhopalMapboxView";

interface RouteMapViewProps {
  data: DashboardPayload;
  mapsApiKey: string;
  mapboxToken: string;
  onDataUpdated: (dashboard: DashboardPayload) => void;
}

interface BhopalHospitalPlace {
  id: string;
  name: string;
  locality: string;
  address: string;
  lat: number;
  lng: number;
  rating?: number | null;
  userRatingCount?: number | null;
  businessStatus?: string | null;
  primaryType?: string | null;
  googleMapsURI?: string | null;
}

interface ComputedRoadRoute {
  distanceKm: number;
  durationMin: number;
  orderedStopIds: string[];
  steps: Array<{
    instruction: string;
    distanceText: string;
  }>;
}

const BHOPAL_CENTER = { lat: 23.2599, lng: 77.4126 };
const MAPS_LIBRARIES: Array<"maps" | "places" | "marker" | "routes" | "core"> = [
  "maps",
  "places",
  "marker",
  "routes",
  "core",
];

function formatPlaceRecord(place: google.maps.places.Place): BhopalHospitalPlace | null {
  if (!place.id || !place.location) return null;
  const lat =
    typeof place.location.lat === "function"
      ? place.location.lat()
      : (place.location as unknown as { lat: number }).lat;
  const lng =
    typeof place.location.lng === "function"
      ? place.location.lng()
      : (place.location as unknown as { lng: number }).lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const address = place.formattedAddress || "Bhopal, Madhya Pradesh, India";
  const locality = extractBhopalLocality(place.addressComponents, address);
  const primaryType =
    typeof place.primaryTypeDisplayName === "string"
      ? place.primaryTypeDisplayName
      : null;

  return {
    id: place.id,
    name: place.displayName || "Bhopal Healthcare Facility",
    locality,
    address,
    lat,
    lng,
    rating: place.rating ?? null,
    userRatingCount: place.userRatingCount ?? null,
    businessStatus: place.businessStatus ? String(place.businessStatus) : null,
    primaryType,
    googleMapsURI: place.googleMapsURI ?? null,
  };
}

type ActiveMapMarker =
  | { kind: "hospital"; hospital: BhopalHospitalPlace }
  | { kind: "plant" }
  | { kind: "vehicle"; vehicle: Vehicle }
  | null;

interface BhopalLiveMapInnerProps {
  hospitals: BhopalHospitalPlace[];
  treatmentPlant: DashboardPayload["treatment_plant"];
  vehicles: Vehicle[];
  selectedLocality: string;
  onSelectLocality: (loc: string) => void;
  onHospitalsMerged: (incoming: BhopalHospitalPlace[]) => void;
  routeStopIds: string[];
  onToggleRouteStop: (id: string) => void;
  onClearRouteStops: () => void;
  onSetRouteStops: (ids: string[]) => void;
}

function BhopalLiveMapInner({
  hospitals,
  treatmentPlant,
  vehicles,
  selectedLocality,
  onSelectLocality,
  onHospitalsMerged,
  routeStopIds,
  onToggleRouteStop,
  onClearRouteStops,
  onSetRouteStops,
}: BhopalLiveMapInnerProps) {
  const map = useMap();
  const placesLib = useMapsLibrary("places");
  const routesLib = useMapsLibrary("routes");

  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [placesError, setPlacesError] = useState("");
  const [activeMarker, setActiveMarker] = useState<ActiveMapMarker>(null);
  const [searchInput, setSearchInput] = useState("");
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [searchingQuery, setSearchingQuery] = useState(false);

  const [computingRoute, setComputingRoute] = useState(false);
  const [roadRoute, setRoadRoute] = useState<ComputedRoadRoute | null>(null);
  const [routeError, setRouteError] = useState("");

  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const initialLoadedRef = useRef(false);

  const clearMapPolylines = useCallback(() => {
    for (const line of polylinesRef.current) {
      line.setMap(null);
    }
    polylinesRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      clearMapPolylines();
    };
  }, [clearMapPolylines]);

  const fetchBhopalHospitalsByText = useCallback(
    async (textQuery: string) => {
      if (!placesLib) return;
      setLoadingPlaces(true);
      setPlacesError("");
      try {
        const res = await placesLib.Place.searchByText({
          textQuery,
          fields: [
            "id",
            "displayName",
            "formattedAddress",
            "location",
            "addressComponents",
            "rating",
            "userRatingCount",
            "businessStatus",
            "primaryTypeDisplayName",
            "googleMapsURI",
          ],
          language: "en-IN",
          region: "in",
          locationBias: {
            center: BHOPAL_CENTER,
            radius: 18000,
          },
          maxResultCount: 20,
        });

        const parsed: BhopalHospitalPlace[] = [];
        for (const p of res.places ?? []) {
          const item = formatPlaceRecord(p);
          if (item && item.address.toLowerCase().includes("bhopal")) {
            parsed.push(item);
          } else if (item) {
            parsed.push(item);
          }
        }
        if (parsed.length > 0) {
          onHospitalsMerged(parsed);
        }
      } catch (err) {
        if (isMapsQuotaError(err)) {
          window.dispatchEvent(new CustomEvent("gmp-quota-exceeded"));
        }
        setPlacesError(
          err instanceof Error ? err.message : "Unable to load Bhopal hospitals from Google Places."
        );
      } finally {
        setLoadingPlaces(false);
      }
    },
    [onHospitalsMerged, placesLib]
  );

  // Initial Bhopal hospital & locality discovery via Places API (New)
  useEffect(() => {
    if (!placesLib || initialLoadedRef.current) return;
    initialLoadedRef.current = true;
    void (async () => {
      await fetchBhopalHospitalsByText("hospital in Bhopal, Madhya Pradesh, India");
      await fetchBhopalHospitalsByText("medical college hospital in Bhopal, Madhya Pradesh, India");
    })();
  }, [fetchBhopalHospitalsByText, placesLib]);

  // Autocomplete predictions scoped to Bhopal
  useEffect(() => {
    if (!placesLib) return;
    const q = searchInput.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new placesLib.AutocompleteSessionToken();
        }
        const res = await placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: q,
          sessionToken: sessionTokenRef.current,
          includedRegionCodes: ["in"],
          locationBias: {
            center: BHOPAL_CENTER,
            radius: 20000,
          },
          language: "en-IN",
        });
        if (!cancelled) {
          setSuggestions(res.suggestions ?? []);
        }
      } catch (err) {
        if (isMapsQuotaError(err)) {
          window.dispatchEvent(new CustomEvent("gmp-quota-exceeded"));
        }
        if (!cancelled) {
          setSuggestions([]);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [placesLib, searchInput]);

  const handlePickSuggestion = useCallback(
    async (suggestion: google.maps.places.AutocompleteSuggestion) => {
      if (!placesLib || !suggestion.placePrediction) return;
      setSearchingQuery(true);
      try {
        const place = suggestion.placePrediction.toPlace();
        await place.fetchFields({
          fields: [
            "id",
            "displayName",
            "formattedAddress",
            "location",
            "addressComponents",
            "rating",
            "userRatingCount",
            "businessStatus",
            "primaryTypeDisplayName",
            "googleMapsURI",
          ],
        });
        sessionTokenRef.current = null;
        setSuggestions([]);
        const formatted = formatPlaceRecord(place);
        if (formatted) {
          onHospitalsMerged([formatted]);
          setActiveMarker({ kind: "hospital", hospital: formatted });
          onSelectLocality("ALL");
          setSearchInput("");
          if (map) {
            map.panTo({ lat: formatted.lat, lng: formatted.lng });
            map.setZoom(14);
          }
        }
      } catch (err) {
        if (isMapsQuotaError(err)) {
          window.dispatchEvent(new CustomEvent("gmp-quota-exceeded"));
        }
      } finally {
        setSearchingQuery(false);
      }
    },
    [map, onHospitalsMerged, onSelectLocality, placesLib]
  );

  const handleLocalitySearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q || !placesLib) return;
    setSuggestions([]);
    setSearchingQuery(true);
    await fetchBhopalHospitalsByText(`hospital in ${q}, Bhopal, Madhya Pradesh, India`);
    setSearchingQuery(false);
  };

  // Compute live driving route in Bhopal via Routes API (Route.computeRoutes)
  const computeBhopalRoadRoute = useCallback(
    async (targetIds: string[]) => {
      if (!routesLib || !map) return;
      const hospitalById: Record<string, BhopalHospitalPlace> = {};
      for (const h of hospitals) {
        hospitalById[h.id] = h;
      }
      const stops = targetIds
        .map((id) => hospitalById[id])
        .filter((h): h is BhopalHospitalPlace => Boolean(h));

      if (stops.length < 2) {
        setRouteError("Select at least 2 Bhopal hospitals to compute a driving route.");
        return;
      }

      setComputingRoute(true);
      setRouteError("");
      clearMapPolylines();

      try {
        const originStop = stops[0];
        const destStop = stops[stops.length - 1];
        const midStops = stops.slice(1, -1);

        const request: google.maps.routes.ComputeRoutesRequest = {
          origin: { lat: originStop.lat, lng: originStop.lng },
          destination: { lat: destStop.lat, lng: destStop.lng },
          intermediates:
            midStops.length > 0
              ? midStops.map((s) => ({ location: { lat: s.lat, lng: s.lng } }))
              : undefined,
          optimizeWaypointOrder: midStops.length > 1,
          travelMode: routesLib.TravelMode.DRIVING,
          fields: [
            "durationMillis",
            "distanceMeters",
            "path",
            "viewport",
            "legs",
            "optimizedIntermediateWaypointIndices",
          ],
          language: "en-IN",
          region: "in",
        };

        const response = await routesLib.Route.computeRoutes(request);
        const primaryRoute = response.routes?.[0];
        if (!primaryRoute) {
          setRouteError("No drivable Bhopal road route returned for the selected hospitals.");
          return;
        }

        const createdLines = primaryRoute.createPolylines({
          polylineOptions: {
            strokeColor: "#1d4ed8",
            strokeOpacity: 0.9,
            strokeWeight: 5,
          },
        });
        for (const line of createdLines) {
          line.setMap(map);
        }
        polylinesRef.current = createdLines;

        if (primaryRoute.viewport) {
          map.fitBounds(primaryRoute.viewport);
        }

        const orderedIntermediates =
          primaryRoute.optimizedIntermediateWaypointIndices &&
          primaryRoute.optimizedIntermediateWaypointIndices.length === midStops.length
            ? primaryRoute.optimizedIntermediateWaypointIndices.map((idx) => midStops[idx].id)
            : midStops.map((s) => s.id);

        const orderedStopIds = [originStop.id, ...orderedIntermediates, destStop.id];

        const steps: Array<{ instruction: string; distanceText: string }> = [];
        for (const leg of primaryRoute.legs ?? []) {
          for (const step of leg.steps ?? []) {
            if (step.instructions) {
              const meters = step.distanceMeters ?? 0;
              steps.push({
                instruction: step.instructions,
                distanceText:
                  meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`,
              });
            }
          }
        }

        const distKm = Math.round(((primaryRoute.distanceMeters ?? 0) / 1000) * 10) / 10;
        const durMin = Math.max(1, Math.round((primaryRoute.durationMillis ?? 0) / 60000));

        setRoadRoute({
          distanceKm: distKm,
          durationMin: durMin,
          orderedStopIds,
          steps: steps.slice(0, 8),
        });
      } catch (err) {
        if (isMapsQuotaError(err)) {
          window.dispatchEvent(new CustomEvent("gmp-quota-exceeded"));
        }
        setRouteError(
          err instanceof Error ? err.message : "Failed to compute Bhopal collection route."
        );
      } finally {
        setComputingRoute(false);
      }
    },
    [clearMapPolylines, hospitals, map, routesLib]
  );

  // Build locality filter summary from live Places results
  const localityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const h of hospitals) {
      counts[h.locality] = (counts[h.locality] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [hospitals]);

  const filteredHospitals = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    return hospitals.filter((h) => {
      const matchesLoc = selectedLocality === "ALL" || h.locality === selectedLocality;
      const matchesSearch =
        !q ||
        h.name.toLowerCase().includes(q) ||
        h.locality.toLowerCase().includes(q) ||
        h.address.toLowerCase().includes(q);
      return matchesLoc && matchesSearch;
    });
  }, [hospitals, searchInput, selectedLocality]);

  const activeHospital =
    activeMarker?.kind === "hospital" ? activeMarker.hospital : null;
  const activeVehicle =
    activeMarker?.kind === "vehicle" ? activeMarker.vehicle : null;

  const handleAutoRouteBhopal = () => {
    const candidates = (filteredHospitals.length >= 2 ? filteredHospitals : hospitals)
      .slice(0, 4)
      .map((h) => h.id);
    if (candidates.length >= 2) {
      onSetRouteStops(candidates);
      void computeBhopalRoadRoute(candidates);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search Bhopal Hospitals & Localities Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <form onSubmit={handleLocalitySearchSubmit} className="relative flex-1 flex gap-2">
          <div className="relative flex-1">
            <label htmlFor="bhopal-places-search" className="sr-only">
              Search Bhopal hospital or locality
            </label>
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              id="bhopal-places-search"
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search hospital or Bhopal locality (Arera Colony, MP Nagar, Kolar Road)..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />

            {suggestions.length > 0 && (
              <ul className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-30 max-h-60 overflow-y-auto divide-y divide-slate-100">
                {suggestions.map((s, idx) => (
                  <li key={s.placePrediction?.placeId ?? idx}>
                    <button
                      type="button"
                      onClick={() => handlePickSuggestion(s)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 transition-colors"
                    >
                      <span className="font-semibold text-slate-900 block">
                        {s.placePrediction?.mainText?.text || s.placePrediction?.text.text}
                      </span>
                      {s.placePrediction?.secondaryText?.text && (
                        <span className="text-slate-500">
                          {s.placePrediction.secondaryText.text}
                        </span>
                      )}
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
                void computeBhopalRoadRoute(routeStopIds);
              } else {
                handleAutoRouteBhopal();
              }
            }}
            disabled={computingRoute || hospitals.length < 2}
            data-testid="compute-bhopal-route-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
          >
            <RouteIcon className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {computingRoute
                ? "Computing Road Route..."
                : routeStopIds.length >= 2
                ? `Route ${routeStopIds.length} Stops`
                : "Compute Bhopal Route"}
            </span>
          </button>

          {routeStopIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onClearRouteStops();
                clearMapPolylines();
                setRoadRoute(null);
              }}
              className="px-2.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Discovered Bhopal Localities Filter Strip */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1" data-testid="bhopal-localities-bar">
        <span className="text-xs font-medium text-slate-500 whitespace-nowrap shrink-0">
          Bhopal Localities ({localityCounts.length}):
        </span>
        <button
          type="button"
          onClick={() => onSelectLocality("ALL")}
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
            onClick={() => onSelectLocality(locality)}
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

      {/* Live Google Map of Bhopal */}
      <div className="relative w-full h-[480px] rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
        {loadingPlaces && hospitals.length === 0 && (
          <div className="absolute top-3 left-3 z-20 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/95 border border-slate-200 shadow-sm text-xs font-medium text-slate-700">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700" aria-hidden="true" />
            <span>Loading Bhopal hospitals &amp; localities...</span>
          </div>
        )}

        <Map
          defaultCenter={BHOPAL_CENTER}
          defaultZoom={12}
          mapId="DEMO_MAP_ID"
          gestureHandling="greedy"
          internalUsageAttributionIds={["gmp_mcp_codeassist_v1_aistudio"]}
          onClick={() => setActiveMarker(null)}
          className="w-full h-full"
        >
          {/* Authorized Bhopal CBWTF Treatment Plant */}
          <AdvancedMarker
            position={{ lat: treatmentPlant.lat, lng: treatmentPlant.lng }}
            title={treatmentPlant.name}
            onClick={() => setActiveMarker({ kind: "plant" })}
          >
            <Pin
              background="#047857"
              borderColor="#064e3b"
              glyphColor="#ffffff"
              glyphText="C"
            />
          </AdvancedMarker>

          {/* Active Mobile Biomedical Waste Collection Vans */}
          {vehicles.map((v, idx) => (
            <AdvancedMarker
              key={v.vehicle_code}
              position={{ lat: v.lat, lng: v.lng }}
              title={`${v.vehicle_code} (${v.driver_name})`}
              onClick={() => setActiveMarker({ kind: "vehicle", vehicle: v })}
            >
              <Pin
                background="#4338ca"
                borderColor="#312e81"
                glyphColor="#ffffff"
                glyphText={`V${idx + 1}`}
              />
            </AdvancedMarker>
          ))}

          {filteredHospitals.map((hospital) => {
            const stopIdx = routeStopIds.indexOf(hospital.id);
            const isQueued = stopIdx !== -1;
            return (
              <AdvancedMarker
                key={hospital.id}
                position={{ lat: hospital.lat, lng: hospital.lng }}
                title={`${hospital.name} (${hospital.locality})`}
                onClick={() => setActiveMarker({ kind: "hospital", hospital })}
              >
                <Pin
                  background={isQueued ? "#1d4ed8" : "#dc2626"}
                  borderColor={isQueued ? "#1e3a8a" : "#991b1b"}
                  glyphColor="#ffffff"
                  glyphText={isQueued ? String(stopIdx + 1) : "H"}
                />
              </AdvancedMarker>
            );
          })}

          {activeMarker?.kind === "plant" && (
            <InfoWindow
              position={{ lat: treatmentPlant.lat, lng: treatmentPlant.lng }}
              onCloseClick={() => setActiveMarker(null)}
            >
              <div className="max-w-[230px] space-y-1 p-1 text-slate-900">
                <p className="text-xs font-bold leading-snug">{treatmentPlant.name}</p>
                <p className="text-[11px] font-medium text-emerald-700">
                  Authorized MPPCB CBWTF Plant · Govindpura, Bhopal
                </p>
                <p className="text-[11px] text-slate-600">
                  Terminal incineration, autoclaving &amp; QR chain-of-custody disposal destination.
                </p>
              </div>
            </InfoWindow>
          )}

          {activeVehicle && (
            <InfoWindow
              position={{ lat: activeVehicle.lat, lng: activeVehicle.lng }}
              onCloseClick={() => setActiveMarker(null)}
            >
              <div className="max-w-[220px] space-y-1 p-1 text-slate-900">
                <p className="text-xs font-bold">
                  {activeVehicle.vehicle_code} · {activeVehicle.driver_name}
                </p>
                <p className="text-[11px] font-medium text-indigo-700">
                  Status: {activeVehicle.status}
                </p>
                <p className="text-[11px] font-mono text-slate-600">
                  Load: {activeVehicle.current_load_kg.toFixed(1)} / {activeVehicle.capacity_kg} kg
                </p>
              </div>
            </InfoWindow>
          )}

          {activeHospital && (
            <InfoWindow
              position={{ lat: activeHospital.lat, lng: activeHospital.lng }}
              onCloseClick={() => setActiveMarker(null)}
            >
              <div className="max-w-[240px] space-y-1.5 p-1 text-slate-900">
                <p className="text-xs font-bold leading-snug">{activeHospital.name}</p>
                <p className="text-[11px] font-medium text-blue-700">
                  {activeHospital.locality}, Bhopal
                </p>
                <p className="text-[11px] text-slate-600 leading-snug">
                  {activeHospital.address}
                </p>
                {activeHospital.rating != null && (
                  <p className="text-[11px] font-medium text-amber-700 flex items-center gap-1">
                    <Star className="w-3 h-3 fill-amber-500 text-amber-500" aria-hidden="true" />
                    <span>
                      {activeHospital.rating.toFixed(1)} ({activeHospital.userRatingCount ?? 0} reviews)
                    </span>
                  </p>
                )}
                <div className="pt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onToggleRouteStop(activeHospital.id)}
                    className="px-2.5 py-1 text-[11px] font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded"
                  >
                    {routeStopIds.includes(activeHospital.id)
                      ? "Remove from Route"
                      : "Add to Bhopal Route"}
                  </button>
                  {activeHospital.googleMapsURI && (
                    <a
                      href={activeHospital.googleMapsURI}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-medium text-blue-700 hover:underline inline-flex items-center gap-0.5"
                    >
                      <span>Maps</span>
                      <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
            </InfoWindow>
          )}
        </Map>
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

      {/* Road Route Summary + Turn-by-Turn Navigation (from PPT Fleet Route Optimization App) */}
      {roadRoute && (
        <div
          className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl space-y-3"
          data-testid="bhopal-road-route-summary"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-800">
                Live Bhopal Road Route (Routes API)
              </p>
              <p className="text-sm font-bold text-slate-900 mt-0.5">
                {roadRoute.distanceKm} km · Est. {roadRoute.durationMin} min driving across{" "}
                {roadRoute.orderedStopIds.length} Bhopal hospitals
              </p>
            </div>
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

      {/* Live Bhopal Hospitals & Localities Directory */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
            Bhopal Hospitals &amp; Localities Directory ({filteredHospitals.length})
          </h3>
          <span className="text-[11px] text-slate-500">Powered by Google Places API (New)</span>
        </div>
        {filteredHospitals.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            {loadingPlaces
              ? "Discovering Bhopal hospitals..."
              : "No hospitals match the selected Bhopal locality filter."}
          </div>
        ) : (
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
                      setActiveMarker({ kind: "hospital", hospital: h });
                      if (map) {
                        map.panTo({ lat: h.lat, lng: h.lng });
                        map.setZoom(14);
                      }
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
        )}
      </div>
    </div>
  );
}

export function RouteMapView({
  data,
  mapsApiKey,
  mapboxToken,
  onDataUpdated,
}: RouteMapViewProps) {
  const [selectedVehicle, setSelectedVehicle] = useState<string>("");
  const [routePlan, setRoutePlan] = useState<RoutePlan | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [collectingBin, setCollectingBin] = useState<string | null>(null);
  const [lastMintMsg, setLastMintMsg] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [mapProvider, setMapProvider] = useState<"mapbox" | "google">(() =>
    mapboxToken ? "mapbox" : mapsApiKey ? "google" : "mapbox"
  );
  const [userPickedProvider, setUserPickedProvider] = useState(false);
  const [bhopalHospitals, setBhopalHospitals] = useState<BhopalHospitalPlace[]>([]);
  const [selectedLocality, setSelectedLocality] = useState<string>("ALL");
  const [routeStopIds, setRouteStopIds] = useState<string[]>([]);
  const [dispatchRouteRequest, setDispatchRouteRequest] = useState<{
    id: number;
    coordinates: Array<{ lat: number; lng: number }>;
    stopCount: number;
  } | null>(null);

  useEffect(() => {
    if (userPickedProvider) return;
    if (mapboxToken) {
      setMapProvider("mapbox");
    } else if (mapsApiKey) {
      setMapProvider("google");
    }
  }, [mapboxToken, mapsApiKey, userPickedProvider]);

  const handleHospitalsMerged = useCallback((incoming: BhopalHospitalPlace[]) => {
    setBhopalHospitals((prev) => {
      const seen: Record<string, BhopalHospitalPlace> = {};
      const next: BhopalHospitalPlace[] = [];
      for (const h of prev) {
        seen[h.id] = h;
        next.push(h);
      }
      for (const h of incoming) {
        if (!seen[h.id]) {
          seen[h.id] = h;
          next.push(h);
        }
      }
      return next;
    });
  }, []);

  const handleToggleRouteStop = useCallback((id: string) => {
    setRouteStopIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }, []);

  const activeVehicleObj = data.vehicles.find(
    (v) => v.assigned_route && v.assigned_route.length > 0
  );
  const displayedStops =
    routePlan?.stops && routePlan.stops.length > 0
      ? routePlan.stops
      : activeVehicleObj?.assigned_route ?? [];
  const displayedVehicleCode =
    routePlan?.vehicle_code || activeVehicleObj?.vehicle_code || null;

  async function handleOptimize() {
    setOptimizing(true);
    setErrorMsg("");
    setLastMintMsg("");
    try {
      const res = await optimizeRoutes(selectedVehicle || undefined);
      setRoutePlan(res.plan);
      onDataUpdated(res.dashboard);

      if (res.plan.stops && res.plan.stops.length > 0) {
        const assignedVeh = res.dashboard.vehicles.find(
          (v) => v.vehicle_code === res.plan.vehicle_code
        );
        const coords: Array<{ lat: number; lng: number }> = [];
        if (assignedVeh) {
          coords.push({ lat: assignedVeh.lat, lng: assignedVeh.lng });
        }
        for (const s of res.plan.stops) {
          const prev = coords[coords.length - 1];
          if (
            !prev ||
            Math.abs(prev.lat - s.lat) > 0.0001 ||
            Math.abs(prev.lng - s.lng) > 0.0001
          ) {
            coords.push({ lat: s.lat, lng: s.lng });
          }
        }
        coords.push({
          lat: res.dashboard.treatment_plant.lat,
          lng: res.dashboard.treatment_plant.lng,
        });
        if (coords.length >= 2) {
          setDispatchRouteRequest({
            id: Date.now(),
            coordinates: coords,
            stopCount: res.plan.stops.length,
          });
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Route optimization failed");
    } finally {
      setOptimizing(false);
    }
  }

  async function handleCollectStop(binCode: string, vehicleCode?: string | null) {
    setCollectingBin(binCode);
    setErrorMsg("");
    try {
      const res = await completeBinCollection({
        bin_code: binCode,
        vehicle_code: vehicleCode || undefined,
      });
      onDataUpdated(res.dashboard);
      if (routePlan) {
        setRoutePlan({
          ...routePlan,
          stops: routePlan.stops.filter((s) => s.bin_code !== binCode),
        });
      }
      if (res.manifest) {
        setLastMintMsg(
          `Collected ${binCode} (${res.manifest.weight_kg} kg). Minted QR manifest ${res.manifest.manifest_id}.`
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Collection update failed");
    } finally {
      setCollectingBin(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Bhopal Real-Time Fleet Map &amp; Route Optimization
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Live Mapbox GL &amp; Google Maps view of Bhopal hospitals and localities paired with
            MediTrack&apos;s condition-based collection dispatch queue.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <label htmlFor="route-vehicle-select" className="sr-only">
            Collection Vehicle
          </label>
          <select
            id="route-vehicle-select"
            value={selectedVehicle}
            onChange={(e) => setSelectedVehicle(e.target.value)}
            className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
          >
            <option value="">Auto-Assign Nearest Unit</option>
            {data.vehicles.map((v) => (
              <option key={v.vehicle_code} value={v.vehicle_code}>
                {v.vehicle_code} ({v.driver_name})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleOptimize}
            disabled={optimizing}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            <Navigation className="w-4 h-4" aria-hidden="true" />
            <span>{optimizing ? "Optimizing..." : "Optimize Dispatch Queue"}</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-3 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg"
        >
          {errorMsg}
        </div>
      )}

      {lastMintMsg && (
        <div className="p-3 text-xs font-medium text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
          <span>{lastMintMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Live Bhopal Hospital & Locality Dispatch Map (Mapbox GL / Google Maps) */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Bhopal Hospitals &amp; Localities Live Map
              </h2>
              <p className="text-xs text-slate-500">
                Bhopal, Madhya Pradesh · {mapProvider === "mapbox" ? "Mapbox GL, Geocoding & Directions API" : "Google Maps Places & Routes API"}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div
                role="group"
                aria-label="Map provider"
                className="inline-flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200"
              >
                <button
                  type="button"
                  onClick={() => {
                    setUserPickedProvider(true);
                    setMapProvider("mapbox");
                  }}
                  aria-pressed={mapProvider === "mapbox"}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                    mapProvider === "mapbox"
                      ? "bg-white text-blue-700 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Mapbox API
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUserPickedProvider(true);
                    setMapProvider("google");
                  }}
                  aria-pressed={mapProvider === "google"}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                    mapProvider === "google"
                      ? "bg-white text-blue-700 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Google Maps
                </button>
              </div>
              {mapProvider === "google" && (
                <span className="text-xs font-mono text-slate-500 whitespace-nowrap">
                  {bhopalHospitals.length} hospitals
                </span>
              )}
            </div>
          </div>

          {mapProvider === "mapbox" ? (
            <BhopalMapboxView
              mapboxToken={mapboxToken}
              facilities={data.facilities}
              treatmentPlant={data.treatment_plant}
              vehicles={data.vehicles}
              routeStopIds={routeStopIds}
              onToggleRouteStop={handleToggleRouteStop}
              onClearRouteStops={() => setRouteStopIds([])}
              onSetRouteStops={setRouteStopIds}
              dispatchRouteRequest={dispatchRouteRequest}
            />
          ) : !mapsApiKey ? (
            <div
              className="h-[480px] rounded-xl border border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center p-6 text-center"
              data-testid="maps-key-missing"
            >
              <MapPin className="w-8 h-8 text-slate-400" aria-hidden="true" />
              <p className="mt-2 text-sm font-semibold text-slate-900">
                Google Maps API Key Required
              </p>
              <p className="mt-1 text-xs text-slate-500 max-w-sm">
                Configure GOOGLE_MAPS_API_KEY or VITE_GOOGLE_MAPS_API_KEY in your environment to
                load the Google Maps view, or switch to Mapbox API.
              </p>
            </div>
          ) : (
            <APIProvider
              apiKey={mapsApiKey}
              language="en"
              region="IN"
              libraries={MAPS_LIBRARIES}
            >
              <BhopalLiveMapInner
                hospitals={bhopalHospitals}
                treatmentPlant={data.treatment_plant}
                vehicles={data.vehicles}
                selectedLocality={selectedLocality}
                onSelectLocality={setSelectedLocality}
                onHospitalsMerged={handleHospitalsMerged}
                routeStopIds={routeStopIds}
                onToggleRouteStop={handleToggleRouteStop}
                onClearRouteStops={() => setRouteStopIds([])}
                onSetRouteStops={setRouteStopIds}
              />
            </APIProvider>
          )}
        </section>

        {/* Right: MediTrack Condition-Based Dispatch Queue */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Optimized Dispatch Plan
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Priority-weighted condition-based stops vs. fixed routine collection
            </p>
          </div>

          {routePlan && routePlan.optimized && (
            <div className="grid grid-cols-2 gap-3 p-4 bg-blue-50/60 border border-blue-200 rounded-xl text-xs">
              <div>
                <span className="text-slate-500 block">Assigned Unit</span>
                <span className="font-mono font-bold text-slate-900 text-sm">
                  {routePlan.vehicle_code} · {routePlan.driver_name}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Optimized Distance</span>
                <span className="font-mono tabular-nums font-bold text-slate-900 text-sm">
                  {routePlan.total_distance_km} km ({routePlan.estimated_minutes} min)
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Distance Saved vs. Routine</span>
                <span className="font-mono tabular-nums font-bold text-emerald-700 text-sm">
                  -{routePlan.distance_saved_km} km
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Est. Fuel Saved</span>
                <span className="font-mono tabular-nums font-bold text-emerald-700 text-sm">
                  {routePlan.fuel_saved_liters} L
                </span>
              </div>
            </div>
          )}

          {displayedStops.length === 0 ? (
            <div className="py-8 px-4 text-center border border-dashed border-slate-200 rounded-lg">
              <Truck className="w-7 h-7 text-slate-400 mx-auto" aria-hidden="true" />
              <p className="mt-2 text-sm font-medium text-slate-900">
                No active route dispatched
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Click &ldquo;Optimize Dispatch Queue&rdquo; to assign the nearest vehicle to
                overflowing smart bins.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {displayedStops.map((stop) => {
                const cat = getCategoryMeta(stop.category);
                const isBusy = collectingBin === stop.bin_code;
                return (
                  <div
                    key={stop.bin_code}
                    className="p-3.5 border border-slate-200 rounded-lg flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-bold text-blue-700">
                          #{stop.stop_order}
                        </span>
                        <span className="font-mono font-semibold text-slate-900">
                          {stop.bin_code}
                        </span>
                        <span
                          className={`w-2.5 h-2.5 rounded-sm ${cat.swatchClass}`}
                          aria-hidden="true"
                        />
                        <span className="text-slate-700">{cat.shortLabel}</span>
                      </div>
                      <p className="text-xs font-medium text-slate-900 mt-1 truncate">
                        {stop.facility_name} · {stop.ward}
                      </p>
                      <p className="text-xs font-mono tabular-nums text-slate-500 mt-0.5">
                        Fill {stop.fill_level.toFixed(0)}% · {stop.weight_kg.toFixed(1)} kg · Leg{" "}
                        {stop.leg_distance_km} km
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleCollectStop(stop.bin_code, displayedVehicleCode)}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      {isBusy ? "Saving..." : "Mark Stop Collected"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Fleet Status Summary */}
          <div className="pt-4 border-t border-slate-200">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5">
              Mobile Collection Units
            </h3>
            <div className="space-y-2">
              {data.vehicles.map((v) => (
                <div
                  key={v.vehicle_code}
                  className="flex items-center justify-between text-xs py-1.5"
                >
                  <div>
                    <span className="font-mono font-semibold text-slate-900">
                      {v.vehicle_code}
                    </span>
                    <span className="text-slate-500 ml-2">{v.driver_name}</span>
                  </div>
                  <div className="font-mono tabular-nums text-slate-600">
                    {v.current_load_kg.toFixed(1)} / {v.capacity_kg} kg ·{" "}
                    <span className="font-semibold text-slate-900">{v.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
