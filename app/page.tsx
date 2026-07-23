"use client";

import {
  ArrowDownUp,
  ArrowRight,
  AlertTriangle,
  Bike,
  Check,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Footprints,
  MapPin,
  Navigation,
  Search,
  RefreshCw,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import type {
  LayerGroup,
  Map as LeafletMap,
  Marker as LeafletMarker,
} from "leaflet";
import {
  isSupportedPlaceAddress,
  loadKakaoMapsSdk,
  reverseGeocodeKakao,
  searchKakaoPlaces,
} from "./kakao-maps";
import {
  createDraggedRoutePlace,
  isSupportedRouteCoordinate,
} from "./route-endpoint-drag";
import {
  createDirectRouteGeometry,
  createRouteGeometryKey,
  loadRouteGeometry,
} from "./route-geometry";
import {
  buildPlannedRouteLegs,
  createRouteProgressState,
  getActivePlannedRouteLeg,
  updateRouteProgress,
} from "./route-progress";
import {
  DEFAULT_PASS_TYPE,
  PASS_OPTIONS,
  PASS_TYPE_STORAGE_KEY,
  TRANSFER_STOP_OVERHEAD_MINUTES,
  getPassSafeRideMinutes,
  isPassType,
} from "./pass-planning";
import {
  calculateRouteGeometryMetrics,
  recommendPassTransferRoute,
} from "./pass-route-recommendation";
import { fetchRealtimeBikeAvailability } from "./realtime-bikes";
import { readStoredValue, writeStoredValue } from "./safe-storage";
import {
  createLatestRequestGate,
  requestCurrentPositionOnce,
} from "./current-location-request";
import { requestDeviceOrientationPermission } from "./device-orientation-permission";
import {
  consumeLocationFocusRequest,
  getRotatingMapCanvasSide,
  relayoutPreservingMapCenter,
  unwrapMapHeading,
} from "./map-location-camera";
import {
  MOBILE_ROUTE_SHEET_CLICK_SUPPRESSION_MS,
  getMobileRouteSheetDragAction,
  shouldSuppressMobileRouteSheetClick,
} from "./mobile-route-sheet";
import {
  getDraggedOverlayPoint,
  hasMeaningfulOverlayDrag,
} from "./kakao-overlay-drag";
import stationCatalog from "./data/seoul-bike-stations.json";
import type {
  KakaoCustomOverlay,
  KakaoMap,
  KakaoMapObject,
  KakaoPlaceResult,
  KakaoSdk,
} from "./kakao-maps";
import type { RouteEndpointKind } from "./route-endpoint-drag";
import type {
  BikeRouteLeg,
  Coordinates,
  RouteGeometry,
  RouteGeometryInput,
} from "./route-geometry";
import type { PlannedRouteLeg, RouteLocationFix } from "./route-progress";
import type { PassType } from "./pass-planning";
import type { PassRouteStatus } from "./pass-route-recommendation";

type Place = {
  id: string;
  name: string;
  address: string;
  hint: string;
  coordinates: Coordinates;
};

type Station = {
  id: string;
  name: string;
  address: string;
  coordinates: Coordinates;
  bikes: number | null;
};

type RoutePlan = {
  origin: Place;
  destination: Place;
  startStation: Station;
  startStationAdjustedForAvailability: boolean;
  endStation: Station;
  alternatives: Station[];
  walkToMeters: number;
  bikeMeters: number;
  walkFromMeters: number;
  walkToMinutes: number;
  bikeMinutes: number;
  walkFromMinutes: number;
  totalMinutes: number;
  totalMeters: number;
  calories: number;
};

type RouteHistoryItem = {
  origin: Place;
  destination: Place;
};

type CommitRouteOptions = {
  remember?: boolean;
  expandMobileDetails?: boolean;
  preserveEndpointMoveRequests?: boolean;
};

type RouteRecommendation = {
  key: string;
  plan: RoutePlan;
  geometry: RouteGeometry;
  geometryStatus: RouteGeometryStatus;
  transferStops: Station[];
  bikeLegs: BikeRouteLeg[];
  passStatus: PassRouteStatus;
};

type MapFocusTarget = "origin" | "startStation" | "endStation" | "destination";

type MapFocusRequest = {
  coordinates: Coordinates;
  requestId: number;
};

type RouteEndpointMoveHandler = (
  endpoint: RouteEndpointKind,
  coordinates: Coordinates,
) => Promise<boolean>;

const ROUTE_FOCUS_LEAFLET_ZOOM = 18;
const ROUTE_FOCUS_KAKAO_LEVEL = 2;
const ROUTE_RECOMMENDATION_TIMEOUT_MS = 60_000;

const PLACES: Place[] = [
  {
    id: "gwanghwamun",
    name: "광화문광장",
    address: "서울 종로구 세종대로 172",
    hint: "광화문역 9번 출구",
    coordinates: [37.57231, 126.97694],
  },
  {
    id: "seoul-forest",
    name: "서울숲",
    address: "서울 성동구 뚝섬로 273",
    hint: "서울숲역 3번 출구",
    coordinates: [37.54442, 127.03741],
  },
  {
    id: "seongsu",
    name: "성수역 3번출구",
    address: "서울 성동구 아차산로 100",
    hint: "2호선 성수역",
    coordinates: [37.54461, 127.05604],
  },
  {
    id: "hongdae",
    name: "홍대입구역",
    address: "서울 마포구 양화로 160",
    hint: "2호선·공항철도",
    coordinates: [37.55719, 126.92538],
  },
  {
    id: "yeouido-park",
    name: "여의도공원",
    address: "서울 영등포구 여의공원로 68",
    hint: "여의도역 3번 출구",
    coordinates: [37.52642, 126.92245],
  },
  {
    id: "banpo-park",
    name: "반포한강공원",
    address: "서울 서초구 신반포로11길 40",
    hint: "달빛무지개분수",
    coordinates: [37.50983, 126.9941],
  },
  {
    id: "gyeongbokgung",
    name: "경복궁",
    address: "서울 종로구 사직로 161",
    hint: "경복궁역 5번 출구",
    coordinates: [37.57962, 126.97704],
  },
  {
    id: "mangwon-market",
    name: "망원시장",
    address: "서울 마포구 포은로8길 14",
    hint: "망원역 2번 출구",
    coordinates: [37.55605, 126.90523],
  },
  {
    id: "the-hyundai-seoul",
    name: "더현대 서울",
    address: "서울 영등포구 여의대로 108",
    hint: "복합쇼핑몰 · 여의도역",
    coordinates: [37.52591, 126.92843],
  },
  {
    id: "bukchon",
    name: "북촌한옥마을",
    address: "서울 종로구 계동길 37",
    hint: "안국역 2번 출구",
    coordinates: [37.5826, 126.9831],
  },
  {
    id: "jamsil",
    name: "잠실한강공원",
    address: "서울 송파구 한가람로 65",
    hint: "잠실새내역 방면",
    coordinates: [37.51777, 127.08646],
  },
  {
    id: "ddp",
    name: "동대문디자인플라자",
    address: "서울 중구 을지로 281",
    hint: "동대문역사문화공원역",
    coordinates: [37.5665, 127.00916],
  },
  {
    id: "nodeul",
    name: "노들섬",
    address: "서울 용산구 양녕로 445",
    hint: "한강대교 중앙",
    coordinates: [37.51764, 126.95804],
  },
];

const STATIONS: Station[] = stationCatalog.stations.map((station) => ({
  id: station.id,
  name: station.name,
  address: station.address,
  coordinates: [station.latitude, station.longitude],
  bikes: null,
}));
const EMPTY_STATIONS: Station[] = [];
const EMPTY_BIKE_LEGS: BikeRouteLeg[] = [];
const EMPTY_PLANNED_ROUTE_LEGS: PlannedRouteLeg[] = [];

const ROUTE_HISTORY_STORAGE_KEY = "ttarawaing-route-history-v1";
const BIKE_ROAD_PRIORITY_STORAGE_KEY = "ttarawaing-bike-road-priority-v1";
const ROUTE_HISTORY_LIMIT = 3;

function isStoredPlace(value: unknown): value is Place {
  if (!value || typeof value !== "object") return false;
  const place = value as Partial<Place>;
  return (
    typeof place.id === "string" &&
    typeof place.name === "string" &&
    typeof place.address === "string" &&
    typeof place.hint === "string" &&
    Array.isArray(place.coordinates) &&
    place.coordinates.length === 2 &&
    place.coordinates.every((coordinate) => Number.isFinite(coordinate))
  );
}

function parseRouteHistory(serialized: string | null): RouteHistoryItem[] {
  if (!serialized) return [];
  try {
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is RouteHistoryItem => {
        if (!item || typeof item !== "object") return false;
        const route = item as Partial<RouteHistoryItem>;
        return (
          isStoredPlace(route.origin) &&
          isStoredPlace(route.destination) &&
          route.origin.id !== route.destination.id
        );
      })
      .slice(0, ROUTE_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function routeHistoryKey(route: RouteHistoryItem) {
  const originCoordinates = route.origin.coordinates.join(",");
  const destinationCoordinates = route.destination.coordinates.join(",");
  return `${route.origin.id}:${originCoordinates}->${route.destination.id}:${destinationCoordinates}`;
}

function distanceMeters(a: Coordinates, b: Coordinates) {
  const radius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(b[0] - a[0]);
  const deltaLng = toRadians(b[1] - a[1]);
  const lat1 = toRadians(a[0]);
  const lat2 = toRadians(b[0]);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function getPlaceMatches(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return PLACES.slice(0, 5);
  return PLACES.filter((place) =>
    `${place.name} ${place.address} ${place.hint}`.toLowerCase().includes(normalized),
  ).slice(0, 5);
}

function kakaoPlaceToPlace(result: KakaoPlaceResult): Place | null {
  const latitude = Number(result.y);
  const longitude = Number(result.x);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const category = result.category_name
    .split(" > ")
    .filter(Boolean)
    .slice(-2)
    .join(" · ");

  return {
    id: `kakao:${result.id}`,
    name: result.place_name,
    address: result.road_address_name || result.address_name || "주소 정보 없음",
    hint: category || "카카오맵 장소",
    coordinates: [latitude, longitude],
  };
}

type PlaceSearchState = {
  matches: Place[];
  loading: boolean;
  source: "kakao" | "static";
  failed: boolean;
};

function usePlaceSuggestions(query: string, open: boolean): PlaceSearchState {
  const fallbackMatches = useMemo(() => getPlaceMatches(query), [query]);
  const requestIdRef = useRef(0);
  const [remoteSearch, setRemoteSearch] = useState<{
    query: string;
    matches: Place[];
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    const normalized = query.trim();
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (!open || normalized.length < 2) return;

    const timeoutId = window.setTimeout(() => {
      void searchKakaoPlaces(normalized)
        .then((results) => {
          if (requestId !== requestIdRef.current) return;
          const places = results
            .map(kakaoPlaceToPlace)
            .filter((place): place is Place => place !== null)
            .filter((place) => isSupportedPlaceAddress(place.address))
            .slice(0, 5);
          setRemoteSearch({ query: normalized, matches: places, failed: false });
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) return;
          setRemoteSearch({ query: normalized, matches: [], failed: true });
        });
    }, 280);

    return () => window.clearTimeout(timeoutId);
  }, [open, query]);

  const normalized = query.trim();
  const eligible = open && normalized.length >= 2;
  const currentRemote = remoteSearch?.query === normalized ? remoteSearch : null;
  const failed = currentRemote?.failed ?? false;
  const useRemote = eligible && currentRemote !== null && !failed;
  return {
    matches: useRemote ? currentRemote.matches : fallbackMatches,
    loading: eligible && currentRemote === null,
    source: useRemote ? "kakao" : "static",
    failed,
  };
}

function selectStartStation(place: Place, stations: Station[]) {
  const rankedStations = [...stations].sort(
    (a, b) =>
      distanceMeters(place.coordinates, a.coordinates) -
      distanceMeters(place.coordinates, b.coordinates),
  );
  const nearestStation = rankedStations[0];
  if (!nearestStation) throw new Error("Bike station catalog is empty.");

  if (nearestStation.bikes !== 0) {
    return { station: nearestStation, adjustedForAvailability: false };
  }

  const nearestAvailableStation = rankedStations.find(
    (station) => station.bikes !== null && station.bikes > 0,
  );
  return {
    station: nearestAvailableStation ?? nearestStation,
    adjustedForAvailability:
      nearestAvailableStation !== undefined &&
      nearestAvailableStation.id !== nearestStation.id,
  };
}

function rankedEndStations(place: Place, stations: Station[]) {
  return [...stations]
    .sort(
      (a, b) =>
        distanceMeters(place.coordinates, a.coordinates) -
        distanceMeters(place.coordinates, b.coordinates),
    )
    .slice(0, 3);
}

function buildPlan(
  origin: Place,
  destination: Place,
  stations: Station[],
  endStationId?: string,
): RoutePlan {
  const {
    station: startStation,
    adjustedForAvailability: startStationAdjustedForAvailability,
  } = selectStartStation(origin, stations);
  const alternatives = rankedEndStations(destination, stations);
  const endStation =
    alternatives.find((station) => station.id === endStationId) ?? alternatives[0];
  const walkToMeters = Math.round(
    distanceMeters(origin.coordinates, startStation.coordinates) * 1.14,
  );
  const bikeMeters = Math.max(
    850,
    Math.round(distanceMeters(startStation.coordinates, endStation.coordinates) * 1.23),
  );
  const walkFromMeters = Math.round(
    distanceMeters(endStation.coordinates, destination.coordinates) * 1.12,
  );
  const walkToMinutes = Math.max(2, Math.ceil(walkToMeters / 76));
  const bikeMinutes = Math.max(5, Math.ceil(bikeMeters / 245));
  const walkFromMinutes = Math.max(2, Math.ceil(walkFromMeters / 76));
  const totalMinutes = walkToMinutes + bikeMinutes + walkFromMinutes;

  return {
    origin,
    destination,
    startStation,
    startStationAdjustedForAvailability,
    endStation,
    alternatives,
    walkToMeters,
    bikeMeters,
    walkFromMeters,
    walkToMinutes,
    bikeMinutes,
    walkFromMinutes,
    totalMinutes,
    totalMeters: walkToMeters + bikeMeters + walkFromMeters,
    calories: Math.round(bikeMinutes * 6.2 + (walkToMinutes + walkFromMinutes) * 3.1),
  };
}

function applyRouteGeometryToPlan(
  plan: RoutePlan,
  geometry: RouteGeometry,
  transferStopCount: number,
): RoutePlan {
  return {
    ...plan,
    ...calculateRouteGeometryMetrics(geometry, transferStopCount),
  };
}

function getPassLabel(passType: PassType) {
  return PASS_OPTIONS.find((option) => option.value === passType)?.label ?? "이용권";
}

function formatDistance(meters: number) {
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

type RouteGeometryStatus = "loading" | "ready" | "partial" | "fallback";
type MapLocationStatus = "idle" | "loading" | "ready" | "error";
type MapLocationMode = "idle" | "tracking" | "heading";
type MapHeadingStatus = "idle" | "requesting" | "active" | "fallback" | "denied";

type CompassOrientationEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

type OrientationEventConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const CURRENT_LOCATION_MARKER_HTML =
  '<span class="current-location-marker" aria-hidden="true"><span class="current-location-direction"></span><span class="current-location-dot"></span></span>';

function normalizeHeading(heading: number) {
  return ((heading % 360) + 360) % 360;
}

function headingDelta(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

function getScreenOrientationAngle() {
  return (
    (typeof screen !== "undefined" ? screen.orientation?.angle : undefined) ??
    (typeof window !== "undefined"
      ? Number((window as Window & { orientation?: number }).orientation ?? 0)
      : 0)
  );
}

function getTiltCompensatedHeading(
  alpha: number,
  beta: number | null,
  gamma: number | null,
) {
  if (beta === null || gamma === null) {
    return normalizeHeading(360 - alpha + getScreenOrientationAngle());
  }

  const degreesToRadians = Math.PI / 180;
  const x = beta * degreesToRadians;
  const y = gamma * degreesToRadians;
  const z = alpha * degreesToRadians;
  const vectorX =
    -Math.cos(z) * Math.sin(y) -
    Math.sin(z) * Math.sin(x) * Math.cos(y);
  const vectorY =
    -Math.sin(z) * Math.sin(y) +
    Math.cos(z) * Math.sin(x) * Math.cos(y);
  const projectedLength = Math.hypot(vectorX, vectorY);
  const heading =
    projectedLength > 0.0001
      ? (Math.atan2(vectorX, vectorY) * 180) / Math.PI
      : 360 - alpha;
  return normalizeHeading(heading + getScreenOrientationAngle());
}

function getDeviceHeading(event: DeviceOrientationEvent, forceAbsolute = false) {
  const compassEvent = event as CompassOrientationEvent;
  if (
    Number.isFinite(compassEvent.webkitCompassAccuracy) &&
    Number(compassEvent.webkitCompassAccuracy) < 0
  ) {
    return null;
  }
  if (Number.isFinite(compassEvent.webkitCompassHeading)) {
    return normalizeHeading(Number(compassEvent.webkitCompassHeading));
  }
  if (!Number.isFinite(event.alpha) || (!forceAbsolute && event.absolute !== true)) {
    return null;
  }
  return getTiltCompensatedHeading(
    Number(event.alpha),
    Number.isFinite(event.beta) ? Number(event.beta) : null,
    Number.isFinite(event.gamma) ? Number(event.gamma) : null,
  );
}

function createCurrentLocationMarkerElement() {
  const marker = document.createElement("span");
  marker.className = "current-location-marker";
  marker.title = "현재 위치";
  marker.setAttribute("aria-hidden", "true");

  const direction = document.createElement("span");
  direction.className = "current-location-direction";
  const dot = document.createElement("span");
  dot.className = "current-location-dot";
  marker.append(direction, dot);
  return marker;
}

function updateCurrentLocationHeading(
  marker: HTMLElement | null,
  heading: number | null,
) {
  if (!marker) return;
  const hasHeading = Number.isFinite(heading);
  marker.classList.toggle("has-heading", hasHeading);
  if (hasHeading) {
    marker.style.setProperty(
      "--location-heading",
      `${normalizeHeading(Number(heading))}deg`,
    );
  } else {
    marker.style.removeProperty("--location-heading");
  }
}

function useHeadingUpMapCanvas({
  nodeRef,
  enabled,
  heading,
  ready,
  onRelayout,
}: {
  nodeRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  heading: number | null;
  ready: boolean;
  onRelayout: () => void;
}) {
  const continuousHeadingRef = useRef<number | null>(null);
  const headingUp = enabled && Number.isFinite(heading);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;

    if (!headingUp || heading === null) {
      continuousHeadingRef.current = null;
      node.removeAttribute("data-heading-up");
      node.style.removeProperty("--map-counter-rotation");
      node.style.removeProperty("transform");
      return;
    }

    const continuousHeading = unwrapMapHeading(
      continuousHeadingRef.current,
      heading,
    );
    continuousHeadingRef.current = continuousHeading;
    node.dataset.headingUp = "true";
    node.style.setProperty(
      "--map-counter-rotation",
      `${continuousHeading}deg`,
    );
    node.style.transform = `rotate(${-continuousHeading}deg)`;
  }, [heading, headingUp, nodeRef]);

  useEffect(() => {
    const node = nodeRef.current;
    const viewport = node?.parentElement;
    if (!ready || !node || !viewport) return;

    let animationFrame = 0;
    const applyLayout = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        if (headingUp) {
          const side = getRotatingMapCanvasSide(
            viewport.clientWidth,
            viewport.clientHeight,
          );
          if (side > 0) {
            node.style.inset = "auto";
            node.style.left = "50%";
            node.style.top = "50%";
            node.style.width = `${side}px`;
            node.style.height = `${side}px`;
            node.style.marginLeft = `${-side / 2}px`;
            node.style.marginTop = `${-side / 2}px`;
          }
        } else {
          node.style.inset = "0";
          node.style.removeProperty("left");
          node.style.removeProperty("top");
          node.style.removeProperty("width");
          node.style.removeProperty("height");
          node.style.removeProperty("margin-left");
          node.style.removeProperty("margin-top");
        }
        onRelayout();
      });
    };

    applyLayout();
    const resizeObserver = new ResizeObserver(applyLayout);
    resizeObserver.observe(viewport);
    return () => {
      resizeObserver.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, [headingUp, nodeRef, onRelayout, ready]);
}

function getRouteGeometryStatus(geometry: RouteGeometry): RouteGeometryStatus {
  const roadSegmentCount = [
    geometry.walkTo,
    geometry.bike,
    geometry.walkFrom,
  ].filter((segment) => segment.source === "kakao").length;

  if (roadSegmentCount === 3) return "ready";
  if (roadSegmentCount > 0) return "partial";
  return "fallback";
}

function useRouteRecommendation(
  basePlan: RoutePlan | null,
  passType: PassType,
  stations: Station[],
  preferBikeRoads: boolean,
): RouteRecommendation | null {
  const stationAvailabilityKey = useMemo(
    () =>
      stations
        .map((station) =>
          station.bikes === null ? "u" : station.bikes === 0 ? "0" : "1",
        )
        .join(""),
    [stations],
  );
  const baseInput = useMemo<RouteGeometryInput | null>(
    () =>
      basePlan
        ? {
            origin: basePlan.origin.coordinates,
            originAddress: basePlan.origin.address,
            startStation: basePlan.startStation.coordinates,
            endStation: basePlan.endStation.coordinates,
            destination: basePlan.destination.coordinates,
            destinationAddress: basePlan.destination.address,
            bikeRouteMode: preferBikeRoads ? "BIKE_ONLY" : "SHORTEST",
          }
        : null,
    [basePlan, preferBikeRoads],
  );
  const key = useMemo(
    () =>
      baseInput
        ? `${createRouteGeometryKey(baseInput)}|pass:${passType}|availability:${stationAvailabilityKey}`
        : "no-route",
    [baseInput, passType, stationAvailabilityKey],
  );
  const fallback = useMemo<RouteRecommendation | null>(() => {
    if (!basePlan || !baseInput) return null;
    const geometry = createDirectRouteGeometry(baseInput);
    return {
      key,
      plan: basePlan,
      geometry,
      geometryStatus: "loading",
      transferStops: [],
      bikeLegs: geometry.bikeLegs,
      passStatus: "loading",
    };
  }, [baseInput, basePlan, key]);
  const [state, setState] = useState<RouteRecommendation | null>(fallback);

  useEffect(() => {
    if (!basePlan || !baseInput || !fallback) {
      return;
    }

    let active = true;
    let latestGeometry = fallback.geometry;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort(
        new DOMException(
          "Route recommendation timed out.",
          "TimeoutError",
        ),
      );
    }, ROUTE_RECOMMENDATION_TIMEOUT_MS);
    const publish = (
      geometry: RouteGeometry,
      transferStops: Station[],
      passStatus: PassRouteStatus,
    ) => {
      if (!active) return;
      setState({
        key,
        plan: applyRouteGeometryToPlan(basePlan, geometry, transferStops.length),
        geometry,
        geometryStatus: getRouteGeometryStatus(geometry),
        transferStops,
        bikeLegs: geometry.bikeLegs,
        passStatus,
      });
    };

    void recommendPassTransferRoute({
      baseInput,
      passType,
      stations,
      startStationId: basePlan.startStation.id,
      endStationId: basePlan.endStation.id,
      signal: controller.signal,
      loadGeometry: (input, signal) =>
        loadRouteGeometry(input, { signal }),
      onBaseGeometry: (geometry) => {
        latestGeometry = geometry;
        if (!active) return;
        setState({
          key,
          plan: applyRouteGeometryToPlan(basePlan, geometry, 0),
          geometry,
          geometryStatus: getRouteGeometryStatus(geometry),
          transferStops: [],
          bikeLegs: geometry.bikeLegs,
          passStatus: "loading",
        });
      },
    })
      .then((recommendation) => {
        if (!active) return;
        publish(
          recommendation.geometry,
          recommendation.transferStops,
          recommendation.status,
        );
      })
      .catch(() => {
        if (!active) return;
        setState({
          key,
          plan: applyRouteGeometryToPlan(basePlan, latestGeometry, 0),
          geometry: latestGeometry,
          transferStops: [],
          bikeLegs: latestGeometry.bikeLegs,
          passStatus: passType === "none" ? "not-needed" : "unavailable",
          geometryStatus: getRouteGeometryStatus(latestGeometry),
        });
      })
      .finally(() => window.clearTimeout(timeoutId));

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [baseInput, basePlan, fallback, key, passType, stations]);

  if (!fallback) return null;
  return state?.key === key ? state : fallback;
}

type PlaceFieldProps = {
  id: string;
  label: string;
  query: string;
  selected: Place | null;
  tone: "origin" | "destination";
  placeholder: string;
  onQueryChange: (value: string) => void;
  onSelect: (place: Place) => void;
  onUseLocation?: () => void;
  onSwap?: () => void;
};

function PlaceField({
  id,
  label,
  query,
  selected,
  tone,
  placeholder,
  onQueryChange,
  onSelect,
  onUseLocation,
  onSwap,
}: PlaceFieldProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const { matches, loading, failed } = usePlaceSuggestions(query, open);
  const boundedActiveIndex = Math.min(activeIndex, Math.max(0, matches.length - 1));

  const choose = (place: Place) => {
    onSelect(place);
    setOpen(false);
    setActiveIndex(0);
  };

  return (
    <div className={`place-field ${tone}`}>
      <div className="field-heading">
        <label htmlFor={id}>{label}</label>
        {tone === "origin" && onUseLocation ? (
          <button className="location-link" type="button" onClick={onUseLocation}>
            <Crosshair size={13} strokeWidth={2.3} aria-hidden="true" />
            현재 위치
          </button>
        ) : null}
        {tone === "destination" && onSwap ? (
          <button
            className="swap-button"
            type="button"
            aria-label="출발지와 도착지 바꾸기"
            onClick={onSwap}
          >
            <ArrowDownUp size={17} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className={`input-shell ${tone} ${open ? "is-open" : ""}`}>
        <span className="field-marker" aria-hidden="true" />
        <input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-suggestions`}
          aria-activedescendant={
            open && matches.length ? `${id}-option-${boundedActiveIndex}` : undefined
          }
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (!open || matches.length === 0) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) =>
                Math.min(Math.min(index, matches.length - 1) + 1, matches.length - 1),
              );
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) =>
                Math.max(Math.min(index, matches.length - 1) - 1, 0),
              );
            }
            if (event.key === "Enter") {
              event.preventDefault();
              choose(matches[boundedActiveIndex]);
            }
            if (event.key === "Escape") setOpen(false);
          }}
        />
        {query ? (
          <button
            className="clear-field"
            type="button"
            aria-label={`${label} 지우기`}
            onClick={() => {
              onQueryChange("");
              setOpen(true);
            }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        ) : (
          <Search className="search-glyph" size={17} aria-hidden="true" />
        )}
      </div>
      {open ? (
        <div className="suggestions" id={`${id}-suggestions`} role="listbox">
          {loading || failed ? (
            <div className="suggestion-eyebrow" role="status" aria-live="polite">
              {loading ? "카카오맵에서 검색 중…" : "기본 장소를 보여드려요"}
            </div>
          ) : null}
          {matches.length ? (
            matches.map((place, index) => (
              <button
                id={`${id}-option-${index}`}
                type="button"
                role="option"
                aria-selected={index === boundedActiveIndex}
                className={`suggestion-item ${index === boundedActiveIndex ? "is-active" : ""}`}
                key={place.id}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(place)}
              >
                <span className="suggestion-icon">
                  <MapPin size={16} aria-hidden="true" />
                </span>
                <span className="suggestion-copy">
                  <strong>{place.name}</strong>
                  <small>{place.address}</small>
                </span>
                {selected?.id === place.id ? (
                  <Check size={16} className="selected-check" aria-hidden="true" />
                ) : null}
              </button>
            ))
          ) : (
            <div className="empty-suggestion" role="status" aria-live="polite">
              {loading ? (
                <span className="suggestion-loader" aria-hidden="true" />
              ) : (
                <Search size={18} aria-hidden="true" />
              )}
              <p>
                {loading
                  ? "장소를 찾고 있어요."
                  : "서울·경기에서 검색 결과를 찾지 못했어요."}
              </p>
              <small>
                {failed
                  ? "카카오맵 연결이 지연되어 기본 장소만 확인했어요."
                  : "건물명, 역명 또는 도로명 주소를 입력해 보세요."}
              </small>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RouteMapChrome({
  nextRouteLeg,
  ready,
  geometryStatus,
  locationStatus,
  locationMode,
  headingStatus,
  onLocate,
  onFocusNextTarget,
}: {
  nextRouteLeg: PlannedRouteLeg;
  ready: boolean;
  geometryStatus: RouteGeometryStatus;
  locationStatus: MapLocationStatus;
  locationMode: MapLocationMode;
  headingStatus: MapHeadingStatus;
  onLocate: () => void;
  onFocusNextTarget: () => void;
}) {
  const locationControlBusy =
    locationStatus === "loading" || headingStatus === "requesting";
  const locationControlLabel =
    locationStatus === "error"
      ? "현재 위치를 확인하지 못했어요. 실시간 추적 다시 시도"
      : locationMode === "heading" || headingStatus === "denied"
        ? "현재 위치와 방향 추적을 종료하고 지도를 북쪽 기준으로 되돌리기"
        : locationMode === "tracking"
          ? "내가 보는 방향 표시"
          : "실시간 현재 위치 추적 시작";
  const headingMessage =
    headingStatus === "denied"
      ? "방향 권한을 허용하면 보는 방향을 표시할 수 있어요"
      : headingStatus === "fallback"
        ? "방향 센서가 없어 이동 중일 때만 방향을 표시해요"
        : "";
  const nextTargetLabel =
    nextRouteLeg.targetKind === "start-station"
      ? "다음 지점 · 출발 대여소"
      : nextRouteLeg.targetKind === "transfer-station"
        ? "다음 지점 · 경유 대여소"
        : nextRouteLeg.targetKind === "end-station"
          ? "다음 지점 · 반납 대여소"
          : "다음 지점 · 도착지";
  const NextTargetIcon =
    nextRouteLeg.targetKind === "destination" ? MapPin : Bike;

  return (
    <>
      {!ready ? (
        <div className="map-loading" role="status">
          <span className="loading-wheel" aria-hidden="true" />
          지도를 불러오고 있어요
        </div>
      ) : null}
      {ready && geometryStatus === "loading" ? (
        <div className="route-loading" role="status" aria-live="polite">
          <span className="loading-wheel" aria-hidden="true" />
          <span className="screen-reader-only">경로를 불러오고 있어요</span>
        </div>
      ) : null}
      <div className="map-guide-controls">
        <button
          className={`map-location-control ${locationStatus} ${locationMode}`}
          type="button"
          aria-label={locationControlLabel}
          disabled={
            !ready || geometryStatus === "loading" || locationControlBusy
          }
          onClick={onLocate}
        >
          <Crosshair
            className={locationControlBusy ? "is-spinning" : undefined}
            size={17}
            strokeWidth={2.3}
            aria-hidden="true"
          />
        </button>
        {locationStatus === "error" ? (
          <span className="map-location-error" role="alert">
            위치를 확인할 수 없어요
          </span>
        ) : null}
        {headingMessage ? (
          <span className="map-location-error is-guidance" role="status">
            {headingMessage}
          </span>
        ) : null}
        <div className="map-legend">
          <div>
            <span className="legend-line walk" />
            걷기
          </div>
          <div>
            <span className="legend-line bike" />
            따릉이
          </div>
        </div>
      </div>
      <button
        className="map-station-card"
        type="button"
        aria-label={`지도에서 다음 지점 보기: ${nextRouteLeg.target.name}`}
        onClick={onFocusNextTarget}
      >
        <div className="station-mini-icon">
          <NextTargetIcon size={18} aria-hidden="true" />
        </div>
        <div>
          <span>{nextTargetLabel}</span>
          <strong>{nextRouteLeg.target.name}</strong>
        </div>
        <div className="station-distance">
          <b>
            {formatDistance(Math.round(nextRouteLeg.plannedDistanceMeters))}
          </b>
          <small>예상 구간 거리</small>
        </div>
      </button>
    </>
  );
}

function LeafletRouteMap({
  plan,
  nextRouteLeg,
  geometry,
  geometryStatus,
  transferStops,
  focusRequest,
  userLocation,
  userHeading,
  locationFocusRequestId,
  tryConsumeLocationFocusRequest,
  locationStatus,
  locationMode,
  headingStatus,
  onLocate,
  onFocusNextTarget,
  onFocusMarker,
  onMapDragStart,
  onEndpointDragStart,
  onEndpointMove,
}: {
  plan: RoutePlan;
  nextRouteLeg: PlannedRouteLeg;
  geometry: RouteGeometry;
  geometryStatus: RouteGeometryStatus;
  transferStops: Station[];
  focusRequest: MapFocusRequest | null;
  userLocation: Coordinates | null;
  userHeading: number | null;
  locationFocusRequestId: number;
  tryConsumeLocationFocusRequest: (requestId: number) => boolean;
  locationStatus: MapLocationStatus;
  locationMode: MapLocationMode;
  headingStatus: MapHeadingStatus;
  onLocate: () => void;
  onFocusNextTarget: () => void;
  onFocusMarker: (coordinates: Coordinates) => void;
  onMapDragStart: () => void;
  onEndpointDragStart: () => void;
  onEndpointMove: RouteEndpointMoveHandler;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const routeLayerRef = useRef<LayerGroup | null>(null);
  const locationLayerRef = useRef<LayerGroup | null>(null);
  const locationMarkerRef = useRef<LeafletMarker | null>(null);
  const locationMarkerElementRef = useRef<HTMLElement | null>(null);
  const hasLocatedRef = useRef(false);
  const userHeadingRef = useRef(userHeading);
  const focusRequestRef = useRef<MapFocusRequest | null>(focusRequest);
  const [ready, setReady] = useState(false);
  const routeCameraKey = [
    plan.origin.id,
    plan.startStation.id,
    ...transferStops.map((station) => station.id),
    plan.endStation.id,
    plan.destination.id,
  ].join("|");

  useEffect(() => {
    hasLocatedRef.current = false;
  }, [routeCameraKey]);

  const relayoutMapForHeading = useCallback(() => {
    mapRef.current?.invalidateSize({ pan: true, animate: false });
  }, []);
  useHeadingUpMapCanvas({
    nodeRef,
    enabled: locationMode === "heading",
    heading: userHeading,
    ready,
    onRelayout: relayoutMapForHeading,
  });

  useEffect(() => {
    focusRequestRef.current = focusRequest;
  }, [focusRequest]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.on("dragstart", onMapDragStart);
    return () => {
      map.off("dragstart", onMapDragStart);
    };
  }, [onMapDragStart, ready]);

  useEffect(() => {
    let active = true;
    void import("leaflet").then((leafletModule) => {
      if (!active || !nodeRef.current || mapRef.current) return;
      const L = leafletModule.default;
      const map = L.map(nodeRef.current, {
        zoomControl: false,
        attributionControl: true,
      }).setView([37.561, 127.006], 13);
      map.attributionControl.setPrefix(false);
      L.control.zoom({ position: "topright" }).addTo(map);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      }).addTo(map);
      mapRef.current = map;
      setReady(true);
    });

    return () => {
      active = false;
      locationLayerRef.current = null;
      locationMarkerRef.current = null;
      locationMarkerElementRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    routeLayerRef.current?.remove();
    routeLayerRef.current = null;
    let active = true;

    void import("leaflet").then((leafletModule) => {
      if (!active || !mapRef.current) return;
      const L = leafletModule.default;
      if (geometryStatus === "loading") {
        const requestedFocus = focusRequestRef.current;
        if (requestedFocus) {
          mapRef.current.flyTo(
            requestedFocus.coordinates,
            ROUTE_FOCUS_LEAFLET_ZOOM,
            { duration: 0.45 },
          );
          return;
        }
        if (hasLocatedRef.current) return;
        const bounds = L.latLngBounds([
          plan.origin.coordinates,
          plan.startStation.coordinates,
          ...transferStops.map((station) => station.coordinates),
          plan.endStation.coordinates,
          plan.destination.coordinates,
        ]);
        mapRef.current.fitBounds(bounds, {
          paddingTopLeft: [80, 110],
          paddingBottomRight: [90, 90],
          maxZoom: 15,
        });
        return;
      }
      const group = L.layerGroup().addTo(mapRef.current);
      routeLayerRef.current = group;

      const marker = (
        coordinates: Coordinates,
        label: string,
        className: string,
        tooltip: string,
        endpoint?: RouteEndpointKind,
      ) => {
        const routeMarker = L.marker(coordinates, {
          icon: L.divIcon({
            className: `route-marker-wrapper ${className}-wrapper`,
            html: `<span class="route-marker ${className}"><span class="route-marker-shape"><span class="route-marker-label">${label}</span></span></span>`,
            iconSize: [60, 60],
            iconAnchor: [30, 60],
          }),
          keyboard: true,
          title: endpoint
            ? `${tooltip} 핀. 드래그해서 위치 변경`
            : `${tooltip} 지도 핀으로 이동`,
          draggable: Boolean(endpoint),
          autoPan: Boolean(endpoint),
        })
          .bindTooltip(tooltip, { direction: "top", offset: [0, -54] })
          .on("click", () => {
            const position = routeMarker.getLatLng();
            onFocusMarker([position.lat, position.lng]);
          });
        if (endpoint) {
          routeMarker.on("dragstart", onEndpointDragStart);
          routeMarker.on("dragend", () => {
            routeMarker.dragging?.disable();
            const position = routeMarker.getLatLng();
            void onEndpointMove(endpoint, [position.lat, position.lng]).then(
              (accepted) => {
                if (!active) return;
                if (!accepted) routeMarker.setLatLng(coordinates);
                routeMarker.dragging?.enable();
              },
            );
          });
        }
        routeMarker.addTo(group);
      };

      const walkTo = geometry.walkTo.path;
      const bike = geometry.bike.path;
      const walkFrom = geometry.walkFrom.path;
      const bikeIsDirect = geometry.bike.source === "direct";

      L.polyline(walkTo, {
        color: "#3759c7",
        weight: 5,
        opacity: geometry.walkTo.source === "direct" ? 0.5 : 0.9,
        dashArray: "3 9",
        lineCap: "round",
      }).addTo(group);
      L.polyline(bike, {
        color: "#00a77b",
        weight: bikeIsDirect ? 5 : 7,
        opacity: bikeIsDirect ? 0.5 : 0.92,
        dashArray: bikeIsDirect ? "6 10" : undefined,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(group);
      if (!bikeIsDirect) {
        L.polyline(bike, {
          color: "#baf4df",
          weight: 2,
          opacity: 0.9,
          dashArray: "1 10",
          lineCap: "round",
        }).addTo(group);
      }
      L.polyline(walkFrom, {
        color: "#ef704f",
        weight: 5,
        opacity: geometry.walkFrom.source === "direct" ? 0.5 : 0.9,
        dashArray: "3 9",
        lineCap: "round",
      }).addTo(group);

      marker(
        plan.origin.coordinates,
        "출발",
        "origin-marker",
        plan.origin.name,
        "origin",
      );
      marker(
        plan.startStation.coordinates,
        "대여",
        "bike-marker",
        plan.startStation.name,
      );
      transferStops.forEach((station, index) => {
        marker(
          station.coordinates,
          `경유${index + 1}`,
          "transfer-marker",
          `${station.name} · 중간 반납·재대여`,
        );
      });
      marker(
        plan.endStation.coordinates,
        "반납",
        "return-marker",
        plan.endStation.name,
      );
      marker(
        plan.destination.coordinates,
        "도착",
        "destination-marker",
        plan.destination.name,
        "destination",
      );

      plan.alternatives
        .filter((station) => station.id !== plan.endStation.id)
        .forEach((station) => {
          L.circleMarker(station.coordinates, {
            radius: 7,
            color: "#ffffff",
            weight: 3,
            fillColor: "#71907f",
            fillOpacity: 1,
          })
            .bindTooltip(
              `${station.name} · 목적지까지 ${formatDistance(
                Math.round(
                  distanceMeters(station.coordinates, plan.destination.coordinates) * 1.12,
                ),
              )}`,
            )
            .addTo(group);
        });

      const bounds = L.latLngBounds([
        ...walkTo,
        ...bike,
        ...walkFrom,
        plan.origin.coordinates,
        plan.startStation.coordinates,
        ...transferStops.map((station) => station.coordinates),
        plan.endStation.coordinates,
        plan.destination.coordinates,
      ]);
      const requestedFocus = focusRequestRef.current;
      if (requestedFocus) {
        mapRef.current.flyTo(
          requestedFocus.coordinates,
          ROUTE_FOCUS_LEAFLET_ZOOM,
          { duration: 0.45 },
        );
      } else if (!hasLocatedRef.current) {
        mapRef.current.fitBounds(bounds, {
          paddingTopLeft: [80, 110],
          paddingBottomRight: [90, 90],
          maxZoom: 15,
        });
      }
    });

    return () => {
      active = false;
    };
  }, [
    geometry,
    geometryStatus,
    onEndpointDragStart,
    onEndpointMove,
    onFocusMarker,
    plan,
    ready,
    transferStops,
  ]);

  useEffect(() => {
    if (!ready || !mapRef.current || !focusRequest) return;
    mapRef.current.flyTo(
      focusRequest.coordinates,
      ROUTE_FOCUS_LEAFLET_ZOOM,
      { duration: 0.45 },
    );
  }, [focusRequest, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let animationFrame = 0;
    let active = true;
    const resizeMap = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        map.invalidateSize();
        if (focusRequestRef.current || hasLocatedRef.current) return;
        void import("leaflet").then((leafletModule) => {
          if (!active || !mapRef.current) return;
          const bounds = leafletModule.default.latLngBounds([
            ...geometry.walkTo.path,
            ...geometry.bike.path,
            ...geometry.walkFrom.path,
            plan.origin.coordinates,
            plan.startStation.coordinates,
            ...transferStops.map((station) => station.coordinates),
            plan.endStation.coordinates,
            plan.destination.coordinates,
          ]);
          map.fitBounds(bounds, {
            paddingTopLeft: [80, 110],
            paddingBottomRight: [90, 90],
            maxZoom: 15,
          });
        });
      });
    };
    window.addEventListener("resize", resizeMap);
    return () => {
      active = false;
      window.removeEventListener("resize", resizeMap);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [geometry, plan, ready, transferStops]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    if (!userLocation) {
      locationLayerRef.current?.remove();
      locationLayerRef.current = null;
      locationMarkerRef.current = null;
      locationMarkerElementRef.current = null;
      hasLocatedRef.current = false;
      return;
    }
    let active = true;

    void import("leaflet").then((leafletModule) => {
      if (!active || !mapRef.current) return;
      const L = leafletModule.default;
      let marker = locationMarkerRef.current;
      if (!marker) {
        const group = L.layerGroup().addTo(mapRef.current);
        locationLayerRef.current = group;
        marker = L.marker(userLocation, {
          icon: L.divIcon({
            className: "current-location-marker-wrapper",
            html: CURRENT_LOCATION_MARKER_HTML,
            iconSize: [44, 44],
            iconAnchor: [22, 22],
          }),
        })
          .bindTooltip("현재 위치", { direction: "top", offset: [0, -18] })
          .addTo(group);
        locationMarkerRef.current = marker;
      } else {
        marker.setLatLng(userLocation);
      }
      locationMarkerElementRef.current =
        marker.getElement()?.querySelector<HTMLElement>(
          ".current-location-marker",
        ) ?? null;
      updateCurrentLocationHeading(
        locationMarkerElementRef.current,
        userHeadingRef.current,
      );

    });

    return () => {
      active = false;
    };
  }, [ready, userLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !userLocation) return;
    if (!tryConsumeLocationFocusRequest(locationFocusRequestId)) return;
    hasLocatedRef.current = true;
    map.flyTo(userLocation, Math.max(map.getZoom(), 16), { duration: 0.45 });
  }, [
    locationFocusRequestId,
    ready,
    tryConsumeLocationFocusRequest,
    userLocation,
  ]);

  useEffect(() => {
    userHeadingRef.current = userHeading;
    updateCurrentLocationHeading(locationMarkerElementRef.current, userHeading);
  }, [userHeading]);

  return (
    <div className="map-wrap">
      <div ref={nodeRef} className="map-canvas" aria-label="따라와잉 경로 지도" />
      <RouteMapChrome
        nextRouteLeg={nextRouteLeg}
        ready={ready}
        geometryStatus={geometryStatus}
        locationStatus={locationStatus}
        locationMode={locationMode}
        headingStatus={headingStatus}
        onLocate={onLocate}
        onFocusNextTarget={onFocusNextTarget}
      />
    </div>
  );
}

function KakaoRouteMap({
  plan,
  nextRouteLeg,
  geometry,
  geometryStatus,
  transferStops,
  focusRequest,
  userLocation,
  userHeading,
  locationFocusRequestId,
  tryConsumeLocationFocusRequest,
  locationStatus,
  locationMode,
  headingStatus,
  onLocate,
  onFocusNextTarget,
  onFocusMarker,
  onMapDragStart,
  onEndpointDragStart,
  onEndpointMove,
  onError,
}: {
  plan: RoutePlan;
  nextRouteLeg: PlannedRouteLeg;
  geometry: RouteGeometry;
  geometryStatus: RouteGeometryStatus;
  transferStops: Station[];
  focusRequest: MapFocusRequest | null;
  userLocation: Coordinates | null;
  userHeading: number | null;
  locationFocusRequestId: number;
  tryConsumeLocationFocusRequest: (requestId: number) => boolean;
  locationStatus: MapLocationStatus;
  locationMode: MapLocationMode;
  headingStatus: MapHeadingStatus;
  onLocate: () => void;
  onFocusNextTarget: () => void;
  onFocusMarker: (coordinates: Coordinates) => void;
  onMapDragStart: () => void;
  onEndpointDragStart: () => void;
  onEndpointMove: RouteEndpointMoveHandler;
  onError: () => void;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const sdkRef = useRef<KakaoSdk | null>(null);
  const mapObjectsRef = useRef<KakaoMapObject[]>([]);
  const locationObjectRef = useRef<KakaoCustomOverlay | null>(null);
  const locationMarkerElementRef = useRef<HTMLElement | null>(null);
  const hasLocatedRef = useRef(false);
  const userHeadingRef = useRef(userHeading);
  const focusRequestRef = useRef<MapFocusRequest | null>(focusRequest);
  const [ready, setReady] = useState(false);
  const routeCameraKey = [
    plan.origin.id,
    plan.startStation.id,
    ...transferStops.map((station) => station.id),
    plan.endStation.id,
    plan.destination.id,
  ].join("|");

  useEffect(() => {
    hasLocatedRef.current = false;
  }, [routeCameraKey]);

  const relayoutMapForHeading = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    relayoutPreservingMapCenter(map);
  }, []);
  useHeadingUpMapCanvas({
    nodeRef,
    enabled: locationMode === "heading",
    heading: userHeading,
    ready,
    onRelayout: relayoutMapForHeading,
  });

  useEffect(() => {
    focusRequestRef.current = focusRequest;
  }, [focusRequest]);

  useEffect(() => {
    const map = mapRef.current;
    const sdk = sdkRef.current;
    if (!ready || !map || !sdk) return;
    sdk.maps.event.addListener(map, "dragstart", onMapDragStart);
    return () => {
      sdk.maps.event.removeListener(map, "dragstart", onMapDragStart);
    };
  }, [onMapDragStart, ready]);

  const clearMapObjects = useCallback(() => {
    mapObjectsRef.current.forEach((mapObject) => mapObject.setMap(null));
    mapObjectsRef.current = [];
  }, []);

  useEffect(() => {
    let active = true;
    const mapNode = nodeRef.current;
    void loadKakaoMapsSdk()
      .then((sdk) => {
        if (!active || !mapNode || mapRef.current) return;
        sdkRef.current = sdk;
        mapRef.current = new sdk.maps.Map(mapNode, {
          center: new sdk.maps.LatLng(37.561, 127.006),
          level: 6,
        });
        setReady(true);
      })
      .catch(() => {
        if (active) onError();
      });

    return () => {
      active = false;
      clearMapObjects();
      locationObjectRef.current?.setMap(null);
      locationObjectRef.current = null;
      locationMarkerElementRef.current = null;
      mapRef.current = null;
      sdkRef.current = null;
    };
  }, [clearMapObjects, onError]);

  useEffect(() => {
    const map = mapRef.current;
    const sdk = sdkRef.current;
    if (!ready || !map || !sdk) return;
    let animationFrame = 0;
    const relayoutMap = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        map.relayout();
        if (focusRequestRef.current || hasLocatedRef.current) return;
        const bounds = new sdk.maps.LatLngBounds();
        [
          ...geometry.walkTo.path,
          ...geometry.bike.path,
          ...geometry.walkFrom.path,
          plan.origin.coordinates,
          plan.startStation.coordinates,
          ...transferStops.map((station) => station.coordinates),
          plan.endStation.coordinates,
          plan.destination.coordinates,
        ].forEach(([latitude, longitude]) =>
          bounds.extend(new sdk.maps.LatLng(latitude, longitude)),
        );
        map.setBounds(bounds, 110, 90, 90, 80);
      });
    };
    window.addEventListener("resize", relayoutMap);
    return () => {
      window.removeEventListener("resize", relayoutMap);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [geometry, plan, ready, transferStops]);

  useEffect(() => {
    const sdk = sdkRef.current;
    const map = mapRef.current;
    if (!ready || !sdk || !map) return;
    let active = true;

    clearMapObjects();
    const toLatLng = ([latitude, longitude]: Coordinates) =>
      new sdk.maps.LatLng(latitude, longitude);
    if (geometryStatus === "loading") {
      const bounds = new sdk.maps.LatLngBounds();
      [
        plan.origin.coordinates,
        plan.startStation.coordinates,
        ...transferStops.map((station) => station.coordinates),
        plan.endStation.coordinates,
        plan.destination.coordinates,
      ].forEach((coordinates) => bounds.extend(toLatLng(coordinates)));
      const animationFrame = window.requestAnimationFrame(() => {
        map.relayout();
        const requestedFocus = focusRequestRef.current;
        if (requestedFocus) {
          const position = toLatLng(requestedFocus.coordinates);
          map.setLevel(ROUTE_FOCUS_KAKAO_LEVEL);
          map.panTo(position);
        } else if (!hasLocatedRef.current) {
          map.setBounds(bounds, 110, 90, 90, 80);
        }
      });

      return () => {
        active = false;
        window.cancelAnimationFrame(animationFrame);
        clearMapObjects();
      };
    }
    const addPolyline = (
      coordinates: Coordinates[],
      color: string,
      weight: number,
      style = "solid",
      opacity = 0.9,
    ) => {
      const polyline = new sdk.maps.Polyline({
        map,
        path: coordinates.map(toLatLng),
        strokeWeight: weight,
        strokeColor: color,
        strokeOpacity: opacity,
        strokeStyle: style,
        zIndex: 2,
      });
      mapObjectsRef.current.push(polyline);
    };
    const endpointDragCleanups: Array<() => void> = [];
    const addMarker = (
      coordinates: Coordinates,
      label: string,
      className: string,
      tooltip: string,
      endpoint?: RouteEndpointKind,
    ) => {
      const wrapper = document.createElement("button");
      wrapper.type = "button";
      wrapper.className = `route-marker-wrapper kakao-route-marker ${className}-wrapper`;
      if (endpoint) wrapper.classList.add("is-draggable-visual");
      wrapper.title = endpoint
        ? `${tooltip} 핀. 드래그해서 위치 변경`
        : tooltip;
      wrapper.setAttribute(
        "aria-label",
        endpoint
          ? `${tooltip} 핀. 드래그해서 위치 변경`
          : `${tooltip} 지도 핀으로 이동`,
      );
      const marker = document.createElement("span");
      marker.className = `route-marker ${className}`;
      const markerShape = document.createElement("span");
      markerShape.className = "route-marker-shape";
      const markerLabel = document.createElement("span");
      markerLabel.className = "route-marker-label";
      markerLabel.textContent = label;
      markerShape.appendChild(markerLabel);
      marker.appendChild(markerShape);
      wrapper.appendChild(marker);
      const markerPosition = toLatLng(coordinates);
      const overlay = new sdk.maps.CustomOverlay({
        map,
        position: markerPosition,
        content: wrapper,
        clickable: true,
        xAnchor: 0.5,
        yAnchor: 1,
        zIndex: 4,
      });
      mapObjectsRef.current.push(overlay);

      let suppressClickUntil = 0;
      wrapper.addEventListener("click", (event) => {
        event.stopPropagation();
        if (Date.now() < suppressClickUntil) {
          event.preventDefault();
          return;
        }
        const position = overlay.getPosition();
        onFocusMarker([position.getLat(), position.getLng()]);
      });

      if (!endpoint) return;
      let endpointMovePending = false;
      let dragState: {
        pointerId: number;
        startPointer: { x: number; y: number };
        startOverlayPoint: { x: number; y: number };
        moved: boolean;
        mapWasDraggable: boolean;
      } | null = null;

      const moveOverlayWithPointer = (
        state: NonNullable<typeof dragState>,
        event: PointerEvent,
      ) => {
        const projection = map.getProjection();
        const currentPointer = { x: event.clientX, y: event.clientY };
        const point = getDraggedOverlayPoint(
          state.startOverlayPoint,
          state.startPointer,
          currentPointer,
        );
        const position = projection.coordsFromContainerPoint(
          new sdk.maps.Point(point.x, point.y),
        );
        overlay.setPosition(position);
      };

      const finishPointerDrag = (
        event: PointerEvent,
        canceled = false,
      ) => {
        const state = dragState;
        if (!state || state.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        sdk.maps.event.preventMap();
        if (!canceled && state.moved) {
          moveOverlayWithPointer(state, event);
        }
        dragState = null;
        wrapper.classList.remove("is-dragging");
        map.setDraggable(state.mapWasDraggable);
        if (
          event.type !== "lostpointercapture" &&
          wrapper.hasPointerCapture(event.pointerId)
        ) {
          wrapper.releasePointerCapture(event.pointerId);
        }

        if (canceled) {
          overlay.setPosition(markerPosition);
          return;
        }

        suppressClickUntil = Date.now() + 500;
        if (!state.moved) {
          const position = overlay.getPosition();
          onFocusMarker([position.getLat(), position.getLng()]);
          return;
        }

        endpointMovePending = true;
        wrapper.setAttribute("aria-busy", "true");
        const position = overlay.getPosition();
        const settleEndpointMove = (accepted: boolean) => {
          if (active && !accepted) overlay.setPosition(markerPosition);
          endpointMovePending = false;
          if (active) wrapper.removeAttribute("aria-busy");
        };
        void onEndpointMove(endpoint, [
          position.getLat(),
          position.getLng(),
        ]).then(settleEndpointMove, () => settleEndpointMove(false));
      };

      wrapper.addEventListener("pointerdown", (event) => {
        if (
          !event.isPrimary ||
          (event.pointerType === "mouse" && event.button !== 0)
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        sdk.maps.event.preventMap();
        if (endpointMovePending || dragState) return;
        const startPointer = { x: event.clientX, y: event.clientY };
        const mapWasDraggable = map.getDraggable();
        const startOverlayPoint = map
          .getProjection()
          .containerPointFromCoords(overlay.getPosition());
        dragState = {
          pointerId: event.pointerId,
          startPointer,
          startOverlayPoint,
          moved: false,
          mapWasDraggable,
        };
        map.setDraggable(false);
        try {
          wrapper.setPointerCapture(event.pointerId);
        } catch {
          dragState = null;
          map.setDraggable(mapWasDraggable);
        }
      });

      wrapper.addEventListener("pointermove", (event) => {
        const state = dragState;
        if (!state || state.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        sdk.maps.event.preventMap();
        if (
          !state.moved &&
          hasMeaningfulOverlayDrag(state.startPointer, {
            x: event.clientX,
            y: event.clientY,
          })
        ) {
          state.moved = true;
          wrapper.classList.add("is-dragging");
          onEndpointDragStart();
        }
        if (state.moved) moveOverlayWithPointer(state, event);
      });
      wrapper.addEventListener("pointerup", (event) => {
        finishPointerDrag(event);
      });
      wrapper.addEventListener("pointercancel", (event) => {
        finishPointerDrag(event, true);
      });
      wrapper.addEventListener("lostpointercapture", (event) => {
        finishPointerDrag(event, true);
      });
      endpointDragCleanups.push(() => {
        const state = dragState;
        if (!state) return;
        dragState = null;
        wrapper.classList.remove("is-dragging");
        map.setDraggable(state.mapWasDraggable);
        if (wrapper.hasPointerCapture(state.pointerId)) {
          wrapper.releasePointerCapture(state.pointerId);
        }
        overlay.setPosition(markerPosition);
      });
    };

    const walkTo = geometry.walkTo.path;
    const bike = geometry.bike.path;
    const walkFrom = geometry.walkFrom.path;
    const bikeIsDirect = geometry.bike.source === "direct";

    addPolyline(
      walkTo,
      "#3759c7",
      5,
      "shortdash",
      geometry.walkTo.source === "direct" ? 0.5 : 0.9,
    );
    addPolyline(
      bike,
      "#00a77b",
      bikeIsDirect ? 5 : 7,
      bikeIsDirect ? "shortdash" : "solid",
      bikeIsDirect ? 0.5 : 0.9,
    );
    if (!bikeIsDirect) addPolyline(bike, "#baf4df", 2, "shortdot", 0.95);
    addPolyline(
      walkFrom,
      "#ef704f",
      5,
      "shortdash",
      geometry.walkFrom.source === "direct" ? 0.5 : 0.9,
    );

    addMarker(
      plan.origin.coordinates,
      "출발",
      "origin-marker",
      plan.origin.name,
      "origin",
    );
    addMarker(plan.startStation.coordinates, "대여", "bike-marker", plan.startStation.name);
    transferStops.forEach((station, index) => {
      addMarker(
        station.coordinates,
        `경유${index + 1}`,
        "transfer-marker",
        `${station.name} · 중간 반납·재대여`,
      );
    });
    addMarker(plan.endStation.coordinates, "반납", "return-marker", plan.endStation.name);
    addMarker(
      plan.destination.coordinates,
      "도착",
      "destination-marker",
      plan.destination.name,
      "destination",
    );

    plan.alternatives
      .filter((station) => station.id !== plan.endStation.id)
      .forEach((station) => {
        const dot = document.createElement("span");
        dot.className = "alternative-map-dot";
        dot.title = `${station.name} · 목적지까지 ${formatDistance(
          Math.round(
            distanceMeters(station.coordinates, plan.destination.coordinates) * 1.12,
          ),
        )}`;
        dot.setAttribute("aria-hidden", "true");
        const overlay = new sdk.maps.CustomOverlay({
          map,
          position: toLatLng(station.coordinates),
          content: dot,
          xAnchor: 0.5,
          yAnchor: 0.5,
          zIndex: 3,
        });
        mapObjectsRef.current.push(overlay);
      });

    const bounds = new sdk.maps.LatLngBounds();
    [
      ...walkTo,
      ...bike,
      ...walkFrom,
      plan.origin.coordinates,
      plan.startStation.coordinates,
      ...transferStops.map((station) => station.coordinates),
      plan.endStation.coordinates,
      plan.destination.coordinates,
    ].forEach((coordinates) => bounds.extend(toLatLng(coordinates)));

    const animationFrame = window.requestAnimationFrame(() => {
      map.relayout();
      const requestedFocus = focusRequestRef.current;
      if (requestedFocus) {
        const position = toLatLng(requestedFocus.coordinates);
        map.setLevel(ROUTE_FOCUS_KAKAO_LEVEL);
        map.panTo(position);
      } else if (!hasLocatedRef.current) {
        map.setBounds(bounds, 110, 90, 90, 80);
      }
    });

    return () => {
      active = false;
      window.cancelAnimationFrame(animationFrame);
      endpointDragCleanups.forEach((cleanup) => cleanup());
      clearMapObjects();
    };
  }, [
    clearMapObjects,
    geometry,
    geometryStatus,
    onEndpointDragStart,
    onEndpointMove,
    onFocusMarker,
    plan,
    ready,
    transferStops,
  ]);

  useEffect(() => {
    const sdk = sdkRef.current;
    const map = mapRef.current;
    if (!ready || !sdk || !map || !focusRequest) return;
    const coordinates = focusRequest.coordinates;
    const position = new sdk.maps.LatLng(
      coordinates[0],
      coordinates[1],
    );
    map.setLevel(ROUTE_FOCUS_KAKAO_LEVEL);
    map.panTo(position);
  }, [focusRequest, ready]);

  useEffect(() => {
    const sdk = sdkRef.current;
    const map = mapRef.current;
    if (!ready || !sdk || !map) return;
    if (!userLocation) {
      locationObjectRef.current?.setMap(null);
      locationObjectRef.current = null;
      locationMarkerElementRef.current = null;
      hasLocatedRef.current = false;
      return;
    }

    const position = new sdk.maps.LatLng(userLocation[0], userLocation[1]);
    let overlay = locationObjectRef.current;
    if (!overlay) {
      const marker = createCurrentLocationMarkerElement();
      overlay = new sdk.maps.CustomOverlay({
        map,
        position,
        content: marker,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: 6,
      });
      locationObjectRef.current = overlay;
      locationMarkerElementRef.current = marker;
    } else {
      overlay.setPosition(position);
    }
    updateCurrentLocationHeading(
      locationMarkerElementRef.current,
      userHeadingRef.current,
    );

  }, [ready, userLocation]);

  useEffect(() => {
    const sdk = sdkRef.current;
    const map = mapRef.current;
    if (!ready || !sdk || !map || !userLocation) return;
    if (!tryConsumeLocationFocusRequest(locationFocusRequestId)) return;
    hasLocatedRef.current = true;
    const position = new sdk.maps.LatLng(userLocation[0], userLocation[1]);
    map.setLevel(4);
    map.panTo(position);
  }, [
    locationFocusRequestId,
    ready,
    tryConsumeLocationFocusRequest,
    userLocation,
  ]);

  useEffect(() => {
    userHeadingRef.current = userHeading;
    updateCurrentLocationHeading(locationMarkerElementRef.current, userHeading);
  }, [userHeading]);

  return (
    <div className="map-wrap">
      <div
        ref={nodeRef}
        className="map-canvas kakao-map-canvas"
        aria-label="카카오맵으로 보는 따라와잉 경로"
      />
      <RouteMapChrome
        nextRouteLeg={nextRouteLeg}
        ready={ready}
        geometryStatus={geometryStatus}
        locationStatus={locationStatus}
        locationMode={locationMode}
        headingStatus={headingStatus}
        onLocate={onLocate}
        onFocusNextTarget={onFocusNextTarget}
      />
    </div>
  );
}

function RouteMap({
  plan,
  nextRouteLeg,
  geometry,
  geometryStatus,
  transferStops,
  focusRequest,
  userLocation,
  userHeading,
  locationFocusRequestId,
  tryConsumeLocationFocusRequest,
  locationStatus,
  locationMode,
  headingStatus,
  onLocate,
  onFocusNextTarget,
  onFocusMarker,
  onMapDragStart,
  onEndpointDragStart,
  onEndpointMove,
}: {
  plan: RoutePlan;
  nextRouteLeg: PlannedRouteLeg;
  geometry: RouteGeometry;
  geometryStatus: RouteGeometryStatus;
  transferStops: Station[];
  focusRequest: MapFocusRequest | null;
  userLocation: Coordinates | null;
  userHeading: number | null;
  locationFocusRequestId: number;
  tryConsumeLocationFocusRequest: (requestId: number) => boolean;
  locationStatus: MapLocationStatus;
  locationMode: MapLocationMode;
  headingStatus: MapHeadingStatus;
  onLocate: () => void;
  onFocusNextTarget: () => void;
  onFocusMarker: (coordinates: Coordinates) => void;
  onMapDragStart: () => void;
  onEndpointDragStart: () => void;
  onEndpointMove: RouteEndpointMoveHandler;
}) {
  const [provider, setProvider] = useState<"loading" | "kakao" | "leaflet">("loading");
  const useLeafletFallback = useCallback(() => setProvider("leaflet"), []);

  useEffect(() => {
    let active = true;
    void loadKakaoMapsSdk()
      .then(() => {
        if (active) setProvider("kakao");
      })
      .catch(() => {
        if (active) setProvider("leaflet");
      });
    return () => {
      active = false;
    };
  }, []);

  if (provider === "kakao") {
    return (
      <KakaoRouteMap
        plan={plan}
        nextRouteLeg={nextRouteLeg}
        geometry={geometry}
        geometryStatus={geometryStatus}
        transferStops={transferStops}
        focusRequest={focusRequest}
        userLocation={userLocation}
        userHeading={userHeading}
        locationFocusRequestId={locationFocusRequestId}
        tryConsumeLocationFocusRequest={tryConsumeLocationFocusRequest}
        locationStatus={locationStatus}
        locationMode={locationMode}
        headingStatus={headingStatus}
        onLocate={onLocate}
        onFocusNextTarget={onFocusNextTarget}
        onFocusMarker={onFocusMarker}
        onMapDragStart={onMapDragStart}
        onEndpointDragStart={onEndpointDragStart}
        onEndpointMove={onEndpointMove}
        onError={useLeafletFallback}
      />
    );
  }
  if (provider === "leaflet") {
    return (
      <LeafletRouteMap
        plan={plan}
        nextRouteLeg={nextRouteLeg}
        geometry={geometry}
        geometryStatus={geometryStatus}
        transferStops={transferStops}
        focusRequest={focusRequest}
        userLocation={userLocation}
        userHeading={userHeading}
        locationFocusRequestId={locationFocusRequestId}
        tryConsumeLocationFocusRequest={tryConsumeLocationFocusRequest}
        locationStatus={locationStatus}
        locationMode={locationMode}
        headingStatus={headingStatus}
        onLocate={onLocate}
        onFocusNextTarget={onFocusNextTarget}
        onFocusMarker={onFocusMarker}
        onMapDragStart={onMapDragStart}
        onEndpointDragStart={onEndpointDragStart}
        onEndpointMove={onEndpointMove}
      />
    );
  }

  return (
    <div className="map-wrap">
      <div className="map-canvas" aria-hidden="true" />
      <RouteMapChrome
        nextRouteLeg={nextRouteLeg}
        ready={false}
        geometryStatus={geometryStatus}
        locationStatus={locationStatus}
        locationMode={locationMode}
        headingStatus={headingStatus}
        onLocate={onLocate}
        onFocusNextTarget={onFocusNextTarget}
      />
    </div>
  );
}

export default function Home() {
  const [originQuery, setOriginQuery] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [committedRoute, setCommittedRoute] = useState<{
    origin: Place;
    destination: Place;
  } | null>(null);
  const committedRouteRef = useRef<RouteHistoryItem | null>(null);
  const endpointMoveRequestIdRef = useRef<Record<RouteEndpointKind, number>>({
    origin: 0,
    destination: 0,
  });
  const [routeHistory, setRouteHistory] = useState<RouteHistoryItem[]>([]);
  const [passType, setPassType] = useState<PassType>(DEFAULT_PASS_TYPE);
  const [preferBikeRoads, setPreferBikeRoads] = useState(false);
  const [selectedEndStationId, setSelectedEndStationId] = useState<string>();
  const [alternativesOpen, setAlternativesOpen] = useState(false);
  const [routeDetailsOpen, setRouteDetailsOpen] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const noticeTimerRef = useRef<number | null>(null);
  const completedRouteNoticeKeyRef = useRef<string | null>(null);
  const originLocationRequestGateRef = useRef(createLatestRequestGate());
  const [mapFocusRequest, setMapFocusRequest] = useState<MapFocusRequest | null>(
    null,
  );
  const [mapUserLocation, setMapUserLocation] = useState<Coordinates | null>(null);
  const [routeProgressState, setRouteProgressState] = useState(() =>
    createRouteProgressState("no-route"),
  );
  const [routeProgressSessionId, setRouteProgressSessionId] = useState(0);
  const routeProgressConfigRef = useRef<{
    routeKey: string;
    legs: readonly PlannedRouteLeg[];
    enabled: boolean;
  }>({
    routeKey: "no-route",
    legs: EMPTY_PLANNED_ROUTE_LEGS,
    enabled: false,
  });
  const [mapLocationStatus, setMapLocationStatus] =
    useState<MapLocationStatus>("idle");
  const [mapLocationMode, setMapLocationMode] =
    useState<MapLocationMode>("idle");
  const [mapLocationFocusRequestId, setMapLocationFocusRequestId] = useState(0);
  const mapHandledLocationFocusRequestIdRef = useRef(0);
  const [mapHeadingStatus, setMapHeadingStatus] =
    useState<MapHeadingStatus>("idle");
  const [mapDeviceHeading, setMapDeviceHeading] = useState<number | null>(null);
  const [mapTravelHeading, setMapTravelHeading] = useState<number | null>(null);
  const mapLocationRequestIdRef = useRef(0);
  const mapLocationWatchIdRef = useRef<number | null>(null);
  const mapOrientationCleanupRef = useRef<(() => void) | null>(null);
  const mapHeadingTimerRef = useRef<number | null>(null);
  const mapHeadingFallbackTimerRef = useRef<number | null>(null);
  const mapPendingHeadingRef = useRef<number | null>(null);
  const mapLastHeadingRef = useRef<number | null>(null);
  const mapHasLocationFixRef = useRef(false);
  const mapPanelRef = useRef<HTMLElement>(null);
  const resultSectionRef = useRef<HTMLElement>(null);
  const pendingResultFocusRef = useRef(false);
  const [resultFocusRequestId, setResultFocusRequestId] = useState(0);
  const [mobileDetailsMinimized, setMobileDetailsMinimized] = useState(false);
  const mobileDetailsDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const mobileDetailsIgnoreClickUntilRef = useRef(0);
  const [stations, setStations] = useState(STATIONS);
  const [liveBikeStatus, setLiveBikeStatus] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");

  const showNotice = useCallback((message: string, durationMs?: number) => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    setNotice(message);
    if (durationMs !== undefined) {
      noticeTimerRef.current = window.setTimeout(() => {
        noticeTimerRef.current = null;
        setNotice("");
      }, durationMs);
    }
  }, []);

  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
      originLocationRequestGateRef.current.invalidate();
    },
    [],
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setRouteHistory(
        parseRouteHistory(
          readStoredValue(window.localStorage, ROUTE_HISTORY_STORAGE_KEY),
        ),
      );
      const storedPassType = readStoredValue(
        window.localStorage,
        PASS_TYPE_STORAGE_KEY,
      );
      if (isPassType(storedPassType)) setPassType(storedPassType);
      const storedBikeRoadPriority = readStoredValue(
        window.localStorage,
        BIKE_ROAD_PRIORITY_STORAGE_KEY,
      );
      if (storedBikeRoadPriority === "true" || storedBikeRoadPriority === "false") {
        setPreferBikeRoads(storedBikeRoadPriority === "true");
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void fetchRealtimeBikeAvailability(controller.signal)
      .then((realtimeAvailability) => {
        const availabilityById = new Map<string, number>();
        for (const station of realtimeAvailability) {
          availabilityById.set(station.id, station.availableBikes);
        }

        const minimumRealtimeStationCount = Math.floor(STATIONS.length * 0.98);
        if (availabilityById.size < minimumRealtimeStationCount) {
          throw new Error("Realtime bike station data is incomplete.");
        }

        const updatedStations = STATIONS.map((station) => ({
          ...station,
          bikes: availabilityById.get(station.id) ?? null,
        }));

        setStations(updatedStations);
        setLiveBikeStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLiveBikeStatus("unavailable");
      });

    return () => controller.abort();
  }, []);

  const basePlan = useMemo(
    () =>
      committedRoute
        ? buildPlan(
            committedRoute.origin,
            committedRoute.destination,
            stations,
            selectedEndStationId,
          )
        : null,
    [committedRoute, selectedEndStationId, stations],
  );
  const routeRecommendation = useRouteRecommendation(
    basePlan,
    passType,
    stations,
    preferBikeRoads,
  );
  const plan = routeRecommendation?.plan ?? null;
  const transferStops = routeRecommendation?.transferStops ?? EMPTY_STATIONS;
  const bikeLegs = routeRecommendation?.bikeLegs ?? EMPTY_BIKE_LEGS;
  const passRouteStatus = routeRecommendation?.passStatus ?? "loading";
  const plannedRouteLegs = useMemo(
    () =>
      routeRecommendation
        ? buildPlannedRouteLegs({
            geometry: routeRecommendation.geometry,
            startStation: routeRecommendation.plan.startStation,
            transferStations: routeRecommendation.transferStops,
            endStation: routeRecommendation.plan.endStation,
            destination: routeRecommendation.plan.destination,
          })
        : EMPTY_PLANNED_ROUTE_LEGS,
    [routeRecommendation],
  );
  const routeProgressKey = useMemo(
    () =>
      plan
        ? [
            routeProgressSessionId,
            passType,
            preferBikeRoads ? "bike-roads" : "shortest",
            plan.origin.id,
            plan.origin.coordinates.join(","),
            ...plannedRouteLegs.map(
              (leg) => `${leg.targetKind}:${leg.target.id}`,
            ),
          ].join("|")
        : "no-route",
    [passType, plan, plannedRouteLegs, preferBikeRoads, routeProgressSessionId],
  );
  useEffect(() => {
    routeProgressConfigRef.current = {
      routeKey: routeProgressKey,
      legs: plannedRouteLegs,
      enabled: Boolean(plan) && passRouteStatus !== "loading",
    };
  }, [passRouteStatus, plan, plannedRouteLegs, routeProgressKey]);
  const nextRouteLeg = getActivePlannedRouteLeg(
    plannedRouteLegs,
    routeProgressState,
    routeProgressKey,
  );
  useEffect(() => {
    if (!committedRoute) {
      completedRouteNoticeKeyRef.current = null;
      return;
    }
    if (
      !routeRecommendation ||
      routeRecommendation.passStatus === "loading" ||
      routeRecommendation.passStatus === "unavailable" ||
      completedRouteNoticeKeyRef.current === routeRecommendation.key
    ) {
      return;
    }

    completedRouteNoticeKeyRef.current = routeRecommendation.key;
    showNotice("가장 편한 따릉이 경로를 찾았어요.", 2_800);
  }, [committedRoute, routeRecommendation, showNotice]);

  const choosePassType = useCallback(
    (nextPassType: PassType) => {
      if (nextPassType === passType) return;
      setRouteProgressSessionId((sessionId) => sessionId + 1);
      setPassType(nextPassType);
      writeStoredValue(window.localStorage, PASS_TYPE_STORAGE_KEY, nextPassType);
    },
    [passType],
  );

  const chooseBikeRoadPriority = useCallback((enabled: boolean) => {
    setRouteProgressSessionId((sessionId) => sessionId + 1);
    setPreferBikeRoads(enabled);
    writeStoredValue(
      window.localStorage,
      BIKE_ROAD_PRIORITY_STORAGE_KEY,
      String(enabled),
    );
  }, []);

  const rememberRoute = useCallback((route: RouteHistoryItem) => {
    if (
      route.origin.id === "current-location" ||
      route.destination.id === "current-location"
    ) {
      return;
    }

    setRouteHistory((currentHistory) => {
      const nextRouteKey = routeHistoryKey(route);
      const nextHistory = [
        route,
        ...currentHistory.filter(
          (historyItem) => routeHistoryKey(historyItem) !== nextRouteKey,
        ),
      ].slice(0, ROUTE_HISTORY_LIMIT);

      writeStoredValue(
        window.localStorage,
        ROUTE_HISTORY_STORAGE_KEY,
        JSON.stringify(nextHistory),
      );
      return nextHistory;
    });
  }, []);

  const commitRoute = useCallback(
    (
      nextOrigin?: Place | null,
      nextDestination?: Place | null,
      options: CommitRouteOptions = {},
    ) => {
      const resolvedOrigin = nextOrigin ?? origin;
      const resolvedDestination = nextDestination ?? destination;

      if (!resolvedOrigin || !resolvedDestination) {
        setErrorMessage("출발지와 도착지를 검색 결과에서 선택해 주세요.");
        return false;
      }
      if (resolvedOrigin.id === resolvedDestination.id) {
        setErrorMessage("서로 다른 출발지와 도착지를 선택해 주세요.");
        return false;
      }

      setOrigin(resolvedOrigin);
      setDestination(resolvedDestination);
      setOriginQuery(resolvedOrigin.name);
      setDestinationQuery(resolvedDestination.name);
      const nextRoute = {
        origin: resolvedOrigin,
        destination: resolvedDestination,
      };
      committedRouteRef.current = nextRoute;
      setCommittedRoute(nextRoute);
      setRouteProgressSessionId((sessionId) => sessionId + 1);
      setMapFocusRequest(null);
      if (options.remember !== false) rememberRoute(nextRoute);
      if (!options.preserveEndpointMoveRequests) {
        endpointMoveRequestIdRef.current.origin += 1;
        endpointMoveRequestIdRef.current.destination += 1;
      }
      setSelectedEndStationId(undefined);
      setAlternativesOpen(false);
      if (options.expandMobileDetails !== false) {
        setMobileDetailsMinimized(false);
      }
      setErrorMessage("");
      originLocationRequestGateRef.current.invalidate();
      return true;
    }, [destination, origin, rememberRoute],
  );

  const findRoute = useCallback(() => {
    if (!commitRoute()) return;
    pendingResultFocusRef.current = true;
    setResultFocusRequestId((requestId) => requestId + 1);
  }, [commitRoute]);

  useEffect(() => {
    if (!plan || !pendingResultFocusRef.current) return;

    const frameId = window.requestAnimationFrame(() => {
      const resultSection = resultSectionRef.current;
      if (!resultSection || !pendingResultFocusRef.current) return;
      pendingResultFocusRef.current = false;
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      resultSection.focus({ preventScroll: true });
      resultSection.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
        inline: "nearest",
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [plan, resultFocusRequestId]);

  const scrollToMobileMap = useCallback(() => {
    if (!window.matchMedia("(max-width: 900px)").matches) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.requestAnimationFrame(() => {
      mapPanelRef.current?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
        inline: "nearest",
      });
    });
  }, []);

  const toggleMobileDetails = useCallback(() => {
    if (Date.now() < mobileDetailsIgnoreClickUntilRef.current) {
      mobileDetailsIgnoreClickUntilRef.current = 0;
      return;
    }
    const shouldMinimize = !mobileDetailsMinimized;
    if (shouldMinimize) {
      pendingResultFocusRef.current = false;
      scrollToMobileMap();
    }
    setMobileDetailsMinimized(shouldMinimize);
  }, [mobileDetailsMinimized, scrollToMobileMap]);

  const startMobileDetailsDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      mobileDetailsDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  const finishMobileDetailsDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = mobileDetailsDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      mobileDetailsDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const start = { x: drag.startX, y: drag.startY };
      const end = { x: event.clientX, y: event.clientY };
      if (shouldSuppressMobileRouteSheetClick(start, end)) {
        mobileDetailsIgnoreClickUntilRef.current =
          Date.now() + MOBILE_ROUTE_SHEET_CLICK_SUPPRESSION_MS;
      }
      const action = getMobileRouteSheetDragAction(start, end);
      if (!action) return;
      const shouldMinimize = action === "minimize";
      if (shouldMinimize) {
        pendingResultFocusRef.current = false;
        scrollToMobileMap();
      }
      setMobileDetailsMinimized(shouldMinimize);
    },
    [scrollToMobileMap],
  );

  const cancelMobileDetailsDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (mobileDetailsDragRef.current?.pointerId !== event.pointerId) return;
      mobileDetailsDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [],
  );

  const minimizeMobileDetailsFromMapDrag = useCallback(() => {
    if (!window.matchMedia("(max-width: 900px)").matches) return;
    pendingResultFocusRef.current = false;
    setMobileDetailsMinimized(true);
  }, []);

  const selectOrigin = (place: Place) => {
    originLocationRequestGateRef.current.invalidate();
    setOrigin(place);
    setOriginQuery(place.name);
    setErrorMessage("");
  };

  const selectDestination = (place: Place) => {
    setDestination(place);
    setDestinationQuery(place.name);
    setErrorMessage("");
  };

  const useCurrentLocation = () => {
    showNotice("현재 위치를 확인하고 있어요…");
    requestCurrentPositionOnce({
      geolocation: navigator.geolocation ?? null,
      gate: originLocationRequestGateRef.current,
      onSuccess: (position) => {
        const currentPlace: Place = {
          id: "current-location",
          name: "내 현재 위치",
          address: "기기에서 확인한 위치",
          hint: "현재 위치",
          coordinates: [position.coords.latitude, position.coords.longitude],
        };
        selectOrigin(currentPlace);
        showNotice("현재 위치를 출발지로 설정했어요.", 2_600);
      },
      onError: (error) => {
        showNotice("");
        setErrorMessage(
          error.code === error.PERMISSION_DENIED
            ? "위치 권한을 허용하면 현재 위치에서 출발할 수 있어요."
            : "현재 위치를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
      },
      onUnsupported: () => {
        showNotice("");
        setErrorMessage("이 브라우저에서는 현재 위치를 사용할 수 없어요.");
      },
      options: { enableHighAccuracy: true, timeout: 8_000 },
    });
  };

  const swapPlaces = () => {
    originLocationRequestGateRef.current.invalidate();
    const nextOrigin = destination;
    const nextDestination = origin;
    const nextOriginQuery = destinationQuery;
    const nextDestinationQuery = originQuery;
    setOrigin(nextOrigin);
    setDestination(nextDestination);
    setOriginQuery(nextOriginQuery);
    setDestinationQuery(nextDestinationQuery);
    setErrorMessage("");
  };

  const teardownMapOrientation = useCallback(() => {
    mapOrientationCleanupRef.current?.();
    mapOrientationCleanupRef.current = null;
    if (mapHeadingTimerRef.current !== null) {
      window.clearTimeout(mapHeadingTimerRef.current);
      mapHeadingTimerRef.current = null;
    }
    if (mapHeadingFallbackTimerRef.current !== null) {
      window.clearTimeout(mapHeadingFallbackTimerRef.current);
      mapHeadingFallbackTimerRef.current = null;
    }
    mapPendingHeadingRef.current = null;
    mapLastHeadingRef.current = null;
  }, []);

  const stopMapLocationTracking = useCallback(
    (clearMarker = false) => {
      mapLocationRequestIdRef.current += 1;
      if (mapLocationWatchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(mapLocationWatchIdRef.current);
        mapLocationWatchIdRef.current = null;
      }
      teardownMapOrientation();
      setMapLocationMode("idle");
      setMapLocationStatus("idle");
      setMapHeadingStatus("idle");
      setMapDeviceHeading(null);
      setMapTravelHeading(null);
      mapHasLocationFixRef.current = false;
      if (clearMarker) setMapUserLocation(null);
    },
    [teardownMapOrientation],
  );

  const prepareRouteEndpointDrag = useCallback(() => {
    pendingResultFocusRef.current = false;
    minimizeMobileDetailsFromMapDrag();
    stopMapLocationTracking(true);
    setMapFocusRequest(null);
  }, [minimizeMobileDetailsFromMapDrag, stopMapLocationTracking]);

  const moveRouteEndpoint = useCallback<RouteEndpointMoveHandler>(
    async (endpoint, coordinates) => {
      const requestId = endpointMoveRequestIdRef.current[endpoint] + 1;
      endpointMoveRequestIdRef.current[endpoint] = requestId;
      const endpointLabel = endpoint === "origin" ? "출발지" : "도착지";

      if (!isSupportedRouteCoordinate(coordinates)) {
        setErrorMessage(
          "출발지와 도착지는 서울·경기 지역 안에서 지정해 주세요.",
        );
        return false;
      }

      showNotice(`${endpointLabel} 위치를 확인하고 있어요…`);
      let reverseGeocodedAddress = null;
      let reverseGeocodeFailed = false;
      try {
        reverseGeocodedAddress = await reverseGeocodeKakao(coordinates);
      } catch {
        reverseGeocodeFailed = true;
      }

      if (endpointMoveRequestIdRef.current[endpoint] !== requestId) {
        return false;
      }

      const resolvedAddress =
        reverseGeocodedAddress?.roadAddress ||
        reverseGeocodedAddress?.address ||
        "";
      if (
        resolvedAddress &&
        !isSupportedPlaceAddress(resolvedAddress)
      ) {
        showNotice("");
        setErrorMessage(
          "출발지와 도착지는 서울·경기 지역 안에서 지정해 주세요.",
        );
        return false;
      }

      const currentRoute = committedRouteRef.current;
      if (!currentRoute) {
        showNotice("");
        return false;
      }

      const movedPlace = createDraggedRoutePlace(
        endpoint,
        coordinates,
        reverseGeocodedAddress,
      );
      const nextOrigin =
        endpoint === "origin" ? movedPlace : currentRoute.origin;
      const nextDestination =
        endpoint === "destination" ? movedPlace : currentRoute.destination;
      const committed = commitRoute(nextOrigin, nextDestination, {
        remember: false,
        expandMobileDetails: false,
        preserveEndpointMoveRequests: true,
      });
      if (!committed) {
        showNotice("");
        return false;
      }

      showNotice(
        reverseGeocodeFailed || !resolvedAddress
          ? `주소 정보는 찾지 못했지만 ${endpointLabel} 핀 위치로 경로를 다시 찾고 있어요.`
          : `${endpointLabel}를 바꾸고 새 경로를 찾고 있어요.`,
        2_800,
      );
      return true;
    },
    [commitRoute, showNotice],
  );

  useEffect(
    () => () => {
      endpointMoveRequestIdRef.current.origin += 1;
      endpointMoveRequestIdRef.current.destination += 1;
      mapLocationRequestIdRef.current += 1;
      if (mapLocationWatchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(mapLocationWatchIdRef.current);
        mapLocationWatchIdRef.current = null;
      }
      teardownMapOrientation();
    },
    [teardownMapOrientation],
  );

  const startMapLocationTracking = useCallback(() => {
    setMapFocusRequest(null);
    setMapLocationFocusRequestId((requestId) => requestId + 1);
    if (!navigator.geolocation) {
      setMapLocationMode("idle");
      setMapLocationStatus("error");
      return;
    }

    if (mapLocationWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(mapLocationWatchIdRef.current);
      mapLocationWatchIdRef.current = null;
    }
    teardownMapOrientation();
    const requestId = mapLocationRequestIdRef.current + 1;
    mapLocationRequestIdRef.current = requestId;
    setMapLocationMode("tracking");
    setMapLocationStatus("loading");
    setMapHeadingStatus("idle");
    setMapDeviceHeading(null);
    setMapTravelHeading(null);
    mapHasLocationFixRef.current = false;

    try {
      mapLocationWatchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          if (mapLocationRequestIdRef.current !== requestId) return;
          const travelHeading =
            Number.isFinite(position.coords.heading) &&
            (position.coords.speed === null || position.coords.speed >= 0.8)
              ? normalizeHeading(Number(position.coords.heading))
              : null;
          setMapUserLocation([
            position.coords.latitude,
            position.coords.longitude,
          ]);
          const routeFix: RouteLocationFix = {
            coordinates: [
              position.coords.latitude,
              position.coords.longitude,
            ],
            accuracyMeters: position.coords.accuracy,
            timestamp: position.timestamp,
          };
          const progressConfig = routeProgressConfigRef.current;
          setRouteProgressState((currentState) =>
            updateRouteProgress({
              state: currentState,
              routeKey: progressConfig.routeKey,
              legs: progressConfig.legs,
              fix: routeFix,
              enabled: progressConfig.enabled,
            }),
          );
          setMapTravelHeading(travelHeading);
          setMapLocationStatus("ready");
          mapHasLocationFixRef.current = true;
        },
        (error) => {
          if (mapLocationRequestIdRef.current !== requestId) return;
          if (error.code !== error.PERMISSION_DENIED) {
            setMapLocationStatus(
              mapHasLocationFixRef.current ? "ready" : "error",
            );
            return;
          }
          if (mapLocationWatchIdRef.current !== null) {
            navigator.geolocation.clearWatch(mapLocationWatchIdRef.current);
            mapLocationWatchIdRef.current = null;
          }
          teardownMapOrientation();
          setMapLocationMode("idle");
          setMapLocationStatus("error");
          setMapHeadingStatus("idle");
          setMapDeviceHeading(null);
          setMapTravelHeading(null);
          setMapUserLocation(null);
          mapHasLocationFixRef.current = false;
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 2_000 },
      );
    } catch {
      setMapLocationMode("idle");
      setMapLocationStatus("error");
      setMapUserLocation(null);
      mapHasLocationFixRef.current = false;
    }
  }, [teardownMapOrientation]);

  const tryConsumeMapLocationFocusRequest = useCallback(
    (requestId: number) => {
      const focusDecision = consumeLocationFocusRequest(
        requestId,
        mapHandledLocationFocusRequestIdRef.current,
        true,
      );
      if (!focusDecision.shouldFocus) return false;
      mapHandledLocationFocusRequestIdRef.current =
        focusDecision.nextHandledRequestId;
      return true;
    },
    [],
  );

  const enableMapHeading = useCallback(async () => {
    const requestId = mapLocationRequestIdRef.current;
    setMapHeadingStatus("requesting");
    const orientationConstructor =
      typeof DeviceOrientationEvent === "undefined"
        ? null
        : (DeviceOrientationEvent as OrientationEventConstructor);

    const permission = await requestDeviceOrientationPermission(
      orientationConstructor,
    );
    if (mapLocationRequestIdRef.current !== requestId) return;
    if (permission === "unsupported") {
      if (mapLocationRequestIdRef.current !== requestId) return;
      setMapLocationMode("heading");
      setMapHeadingStatus("fallback");
      return;
    }
    if (permission === "denied") {
      setMapLocationMode("tracking");
      setMapHeadingStatus("denied");
      return;
    }

    if (mapLocationRequestIdRef.current !== requestId) return;
    teardownMapOrientation();
    const queueHeading = (heading: number | null) => {
      if (heading === null) return;
      if (mapHeadingFallbackTimerRef.current !== null) {
        window.clearTimeout(mapHeadingFallbackTimerRef.current);
        mapHeadingFallbackTimerRef.current = null;
      }
      setMapHeadingStatus("active");
      mapPendingHeadingRef.current = heading;
      if (mapHeadingTimerRef.current !== null) return;
      mapHeadingTimerRef.current = window.setTimeout(() => {
        mapHeadingTimerRef.current = null;
        const nextHeading = mapPendingHeadingRef.current;
        mapPendingHeadingRef.current = null;
        if (nextHeading === null) return;
        const previousHeading = mapLastHeadingRef.current;
        const delta =
          previousHeading === null
            ? 0
            : headingDelta(previousHeading, nextHeading);
        if (previousHeading !== null && Math.abs(delta) < 0.8) return;
        const smoothedHeading =
          previousHeading === null
            ? nextHeading
            : normalizeHeading(previousHeading + delta * 0.28);
        mapLastHeadingRef.current = smoothedHeading;
        setMapDeviceHeading(smoothedHeading);
      }, 80);
    };
    const handleAbsoluteOrientation = (event: Event) => {
      queueHeading(getDeviceHeading(event as DeviceOrientationEvent, true));
    };
    const handleOrientation = (event: Event) => {
      queueHeading(getDeviceHeading(event as DeviceOrientationEvent));
    };
    window.addEventListener(
      "deviceorientationabsolute",
      handleAbsoluteOrientation,
    );
    window.addEventListener("deviceorientation", handleOrientation);
    mapOrientationCleanupRef.current = () => {
      window.removeEventListener(
        "deviceorientationabsolute",
        handleAbsoluteOrientation,
      );
      window.removeEventListener("deviceorientation", handleOrientation);
    };
    setMapLocationMode("heading");
    mapHeadingFallbackTimerRef.current = window.setTimeout(() => {
      mapHeadingFallbackTimerRef.current = null;
      if (
        mapLocationRequestIdRef.current === requestId &&
        mapLastHeadingRef.current === null
      ) {
        setMapHeadingStatus("fallback");
      }
    }, 1_500);
  }, [teardownMapOrientation]);

  const locateMapUser = useCallback(() => {
    if (mapLocationMode === "idle" || mapLocationStatus === "error") {
      startMapLocationTracking();
      return;
    }
    if (
      mapLocationMode === "heading" ||
      (mapLocationMode === "tracking" && mapHeadingStatus === "denied")
    ) {
      stopMapLocationTracking(true);
      return;
    }
    if (mapLocationMode === "tracking") {
      setMapFocusRequest(null);
      setMapLocationFocusRequestId((requestId) => requestId + 1);
      void enableMapHeading();
      return;
    }
  }, [
    enableMapHeading,
    mapHeadingStatus,
    mapLocationMode,
    mapLocationStatus,
    startMapLocationTracking,
    stopMapLocationTracking,
  ]);

  const focusMapCoordinates = useCallback(
    (coordinates: Coordinates, preserveLocationTracking = false) => {
      if (!preserveLocationTracking) stopMapLocationTracking(true);
      setMapFocusRequest((currentRequest) => ({
        coordinates: [coordinates[0], coordinates[1]],
        requestId: (currentRequest?.requestId ?? 0) + 1,
      }));
      if (window.matchMedia("(max-width: 900px)").matches) {
        const reduceMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        window.requestAnimationFrame(() => {
          mapPanelRef.current?.scrollIntoView({
            behavior: reduceMotion ? "auto" : "smooth",
            block: "start",
          });
        });
      }
    },
    [stopMapLocationTracking],
  );

  const focusMapPoint = useCallback(
    (target: MapFocusTarget | { coordinates: Coordinates }) => {
      const coordinates =
        typeof target === "string" ? plan?.[target].coordinates : target.coordinates;
      if (!coordinates) return;
      focusMapCoordinates(coordinates);
    },
    [focusMapCoordinates, plan],
  );

  const focusNextRouteTarget = useCallback(() => {
    if (!nextRouteLeg) return;
    focusMapCoordinates(nextRouteLeg.target.coordinates, true);
  }, [focusMapCoordinates, nextRouteLeg]);

  const resetRoute = (focusOrigin = true) => {
    originLocationRequestGateRef.current.invalidate();
    pendingResultFocusRef.current = false;
    setMobileDetailsMinimized(false);
    stopMapLocationTracking(true);
    setOriginQuery("");
    setDestinationQuery("");
    setOrigin(null);
    setDestination(null);
    committedRouteRef.current = null;
    endpointMoveRequestIdRef.current.origin += 1;
    endpointMoveRequestIdRef.current.destination += 1;
    setCommittedRoute(null);
    setRouteProgressSessionId((sessionId) => sessionId + 1);
    setMapFocusRequest(null);
    setSelectedEndStationId(undefined);
    setAlternativesOpen(false);
    setRouteDetailsOpen(true);
    setErrorMessage("");
    showNotice("");
    if (focusOrigin) {
      window.requestAnimationFrame(() =>
        document.getElementById("origin")?.focus(),
      );
    }
  };

  const returnToHome = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    resetRoute(false);
    window.history.replaceState(null, "", "/");
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const mapUserHeading =
    mapLocationMode === "heading"
      ? (mapDeviceHeading ?? mapTravelHeading)
      : null;
  const startStationAvailabilityLabel =
    plan && liveBikeStatus === "ready" && plan.startStation.bikes !== null
      ? `대여 가능 따릉이 ${plan.startStation.bikes}대`
      : liveBikeStatus === "loading"
        ? "실시간 대여 가능 수량 확인 중"
        : "수량 미확인";

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link
          className="brand"
          href="/"
          aria-label="따라와잉 홈으로 돌아가기"
          onClick={returnToHome}
        >
          <span className="brand-mark">
            <Bike size={23} strokeWidth={2.4} aria-hidden="true" />
          </span>
          <span>
            <strong>따라와잉</strong>
            <small>따릉이로 잇는 서울</small>
          </span>
        </Link>
      </header>

      <div
        className={`workspace${plan ? " has-route" : ""}${
          plan && mobileDetailsMinimized ? " is-mobile-details-minimized" : ""
        }`}
        id="top"
      >
        <aside className="route-panel">
          {plan ? (
            <button
              className="mobile-details-toggle"
              type="button"
              aria-label={
                mobileDetailsMinimized
                  ? "경로 상세 정보 펼치기"
                  : "경로 상세 정보 최소화"
              }
              aria-expanded={!mobileDetailsMinimized}
              aria-controls="route-details-content"
              title={
                mobileDetailsMinimized
                  ? "경로 상세 정보 펼치기"
                  : "경로 상세 정보 최소화"
              }
              onClick={toggleMobileDetails}
              onPointerDown={startMobileDetailsDrag}
              onPointerUp={finishMobileDetailsDrag}
              onPointerCancel={cancelMobileDetailsDrag}
            >
              <span className="mobile-details-grip" aria-hidden="true" />
            </button>
          ) : null}
          <div className="panel-scroll" id="route-details-content">
            <section className="search-section" aria-labelledby="route-search-title">
              <div className="section-kicker">
                대여부터 반납까지 한 번에 알려드려요
              </div>
              <div className="title-row">
                <div>
                  <h1 id="route-search-title">오늘은 어디로 가볼까요?</h1>
                  <p>출발지와 도착지만 고르면 나머지는 맡겨주세요.</p>
                </div>
              </div>

              <div className="route-form">
                <div className="route-rail" aria-hidden="true">
                  <span className="rail-origin" />
                  <span className="rail-dash" />
                  <span className="rail-destination" />
                </div>
                <div className="fields-stack">
                  <PlaceField
                    id="origin"
                    label="출발"
                    query={originQuery}
                    selected={origin}
                    tone="origin"
                    placeholder="출발 장소를 검색해 주세요"
                    onQueryChange={(value) => {
                      originLocationRequestGateRef.current.invalidate();
                      setOriginQuery(value);
                      if (origin?.name !== value) setOrigin(null);
                    }}
                    onSelect={selectOrigin}
                    onUseLocation={useCurrentLocation}
                  />
                  <PlaceField
                    id="destination"
                    label="도착"
                    query={destinationQuery}
                    selected={destination}
                    tone="destination"
                    placeholder="도착 장소를 검색해 주세요"
                    onQueryChange={(value) => {
                      setDestinationQuery(value);
                      if (destination?.name !== value) setDestination(null);
                    }}
                    onSelect={selectDestination}
                    onSwap={swapPlaces}
                  />
                </div>
              </div>

              <fieldset className="pass-selector" aria-describedby="pass-selector-help">
                <legend>현재 이용권</legend>
                <div className="pass-options">
                  {PASS_OPTIONS.map((option) => (
                    <label
                      className={`pass-option${passType === option.value ? " is-selected" : ""}`}
                      key={option.value}
                    >
                      <input
                        type="radio"
                        name="bike-pass"
                        value={option.value}
                        checked={passType === option.value}
                        onChange={() => choosePassType(option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
                <p id="pass-selector-help">
                  기본 이용시간보다 5분 여유를 두고 중간 반납·재대여 대여소를
                  찾아드려요.
                </p>
              </fieldset>

              <label
                className={`bike-road-preference${preferBikeRoads ? " is-selected" : ""}`}
              >
                <span className="bike-road-preference-copy">
                  <strong>자전거도로 우선</strong>
                  <small>
                    출발·반납 대여소 사이에서 자전거도로를 우선한 경로를 찾아요.
                  </small>
                </span>
                <span className="bike-road-switch" aria-hidden="true">
                  <span />
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={preferBikeRoads}
                  aria-label="자전거도로 우선 경로 사용"
                  onChange={(event) =>
                    chooseBikeRoadPriority(event.currentTarget.checked)
                  }
                />
              </label>

              {errorMessage ? (
                <p className="form-error" role="alert">
                  {errorMessage}
                </p>
              ) : null}

              <button className="find-route-button" type="button" onClick={findRoute}>
                <Navigation size={17} fill="currentColor" aria-hidden="true" />
                최적 경로 찾기
                <ArrowRight className="button-arrow" size={18} aria-hidden="true" />
              </button>

              {plan ? (
                <button
                  className="reset-route-button"
                  type="button"
                  onClick={() => resetRoute()}
                >
                  다시 입력하기
                </button>
              ) : null}

              <div className="route-history" aria-label="최근 검색 경로">
                <div>
                  {routeHistory.length ? (
                    routeHistory.map((route) => {
                      const label = `${route.origin.name} → ${route.destination.name}`;
                      return (
                        <button
                          type="button"
                          key={routeHistoryKey(route)}
                          aria-label={`${route.origin.name}에서 ${route.destination.name} 경로 다시 보기`}
                          title={label}
                          onClick={() => commitRoute(route.origin, route.destination)}
                        >
                          {label}
                        </button>
                      );
                    })
                  ) : (
                    <p className="route-history-empty">
                      이전에 찾은 경로가 여기에 표시돼요.
                    </p>
                  )}
                </div>
              </div>
            </section>

            {plan ? (
              <section
                ref={resultSectionRef}
                className="result-section"
                aria-labelledby="route-result-title"
                tabIndex={-1}
              >
              <div className="result-heading">
                <div>
                  <span className="result-kicker">예상 추천 경로</span>
                  <h2 id="route-result-title">
                    약 <strong>{plan.totalMinutes}분</strong>
                  </h2>
                </div>
                <div className="result-distance">
                  <strong>{formatDistance(plan.totalMeters)}</strong>
                  <span>약 {plan.calories} kcal</span>
                </div>
              </div>

              <div className="mode-summary">
                <div className="mode-segments">
                  <div
                    className="mode-segment"
                    style={{ flex: plan.walkToMinutes }}
                  >
                    <span className="mode-segment-bar mode-walk-one" aria-hidden="true" />
                    <span
                      className="mode-segment-label walk-to-label"
                      aria-label={`출발 대여소까지 도보 ${plan.walkToMinutes}분`}
                    >
                      <Footprints size={14} aria-hidden="true" /> {plan.walkToMinutes}분
                    </span>
                  </div>
                  <div className="mode-segment" style={{ flex: plan.bikeMinutes }}>
                    <span className="mode-segment-bar mode-bike" aria-hidden="true" />
                    <span
                      className="mode-segment-label bike-label"
                      aria-label={`따릉이 ${plan.bikeMinutes}분`}
                    >
                      <Bike size={15} aria-hidden="true" /> {plan.bikeMinutes}분
                    </span>
                  </div>
                  <div
                    className="mode-segment"
                    style={{ flex: plan.walkFromMinutes }}
                  >
                    <span className="mode-segment-bar mode-walk-two" aria-hidden="true" />
                    <span
                      className="mode-segment-label walk-from-label"
                      aria-label={`도착지까지 도보 ${plan.walkFromMinutes}분`}
                    >
                      <Footprints size={14} aria-hidden="true" /> {plan.walkFromMinutes}분
                    </span>
                  </div>
                </div>
              </div>

              {routeRecommendation?.geometryStatus === "partial" ? (
                <div className="route-geometry-warning" role="alert">
                  <AlertTriangle size={15} aria-hidden="true" />
                  <span>
                    일부 구간은 직선거리 기반 예상이에요. 출발 전에 지도 앱에서 실제
                    이동 경로를 확인해 주세요.
                  </span>
                </div>
              ) : routeRecommendation?.geometryStatus === "fallback" ? (
                <div className="route-geometry-warning" role="alert">
                  <AlertTriangle size={15} aria-hidden="true" />
                  <span>
                    도로 경로를 불러오지 못해 전 구간을 직선거리로 예상했어요. 실제
                    경로 안내로 사용하지 마세요.
                  </span>
                </div>
              ) : null}

              {passRouteStatus === "loading" ? (
                <div className="pass-route-status" role="status" aria-live="polite">
                  <span className="loading-wheel" aria-hidden="true" />
                  실제 도로 경로와 이용권에 맞는 중간 대여소를 찾고 있어요.
                </div>
              ) : passRouteStatus === "recommended" ? (
                <div className="pass-route-notice" role="status">
                  <RefreshCw size={16} aria-hidden="true" />
                  <div>
                    <strong>
                      {getPassLabel(passType)}에 맞춰 중간 반납 {transferStops.length}회를
                      추천해요.
                    </strong>
                    <p>
                      각 자전거 구간은 {getPassSafeRideMinutes(passType)}분 이내로
                      확인했고, 반납·재대여 시간은 회당 약{" "}
                      {`${TRANSFER_STOP_OVERHEAD_MINUTES}분`}을 총 소요시간에 포함했어요.
                    </p>
                    <p>
                      반납 완료 알림을 확인한 뒤 다시 대여해 주세요. 실시간 대여소
                      현황은 이동 중 바뀔 수 있어요.
                    </p>
                  </div>
                </div>
              ) : passRouteStatus === "unavailable" ? (
                <div className="pass-route-notice is-warning" role="alert">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <div>
                    <strong>이용권 시간 안에 안전하게 나눌 대여소를 찾지 못했어요.</strong>
                    <p>
                      이 경로를 이용권에 안전한 경로라고 안내할 수 없어요. 출발 전
                      따릉이와 지도 앱에서 경로·운영 현황을 다시 확인해 주세요.
                    </p>
                  </div>
                </div>
              ) : passType !== "none" ? (
                <p className="pass-route-safe" role="status">
                  {getPassLabel(passType)} 기준 {getPassSafeRideMinutes(passType)}분의 안전
                  이용시간 안이라 중간 반납이 필요하지 않아요.
                </p>
              ) : null}

              <button
                className="details-toggle"
                type="button"
                aria-expanded={routeDetailsOpen}
                onClick={() => setRouteDetailsOpen((open) => !open)}
              >
                구간별 경로
                {routeDetailsOpen ? (
                  <ChevronUp size={17} aria-hidden="true" />
                ) : (
                  <ChevronDown size={17} aria-hidden="true" />
                )}
              </button>

              {routeDetailsOpen ? (
                <ol className="route-timeline">
                  <li className="timeline-place start-place">
                    <button
                      className="timeline-focus-button"
                      type="button"
                      aria-label={`${plan.origin.name} 출발지를 지도에서 보기`}
                      onClick={() => focusMapPoint("origin")}
                    >
                      <span className="timeline-dot" aria-hidden="true" />
                      <span className="timeline-place-copy">
                        <small>출발</small>
                        <strong>{plan.origin.name}</strong>
                      </span>
                    </button>
                  </li>
                  <li className="timeline-segment walking-segment">
                    <span className="segment-icon">
                      <Footprints size={16} aria-hidden="true" />
                    </span>
                    <div>
                      <strong>걸어서 {plan.walkToMinutes}분</strong>
                      <small>
                        {formatDistance(plan.walkToMeters)}
                        {passRouteStatus === "loading"
                          ? " · 경로 계산 중"
                          : routeRecommendation?.geometry.walkTo.source === "direct"
                            ? " · 직선거리 기반 예상"
                            : null}
                      </small>
                    </div>
                  </li>
                  <li className="timeline-station">
                    <span className="station-number">1</span>
                    <div className="station-card-copy">
                      <button
                        className="station-focus-button"
                        type="button"
                        aria-label={`${plan.startStation.name} 출발 대여소를 지도에서 보기. ${startStationAvailabilityLabel}`}
                        onClick={() => focusMapPoint("startStation")}
                      >
                        <span className="station-title-line">
                          <span className="station-title-copy">
                            <small>
                              {plan.startStationAdjustedForAvailability
                                ? "가까운 최적 대여소"
                                : "가장 가까운 대여소"}
                            </small>
                            <strong>{plan.startStation.name}</strong>
                          </span>
                          <span
                            className={`availability ${
                              liveBikeStatus !== "ready" || plan.startStation.bikes === null
                                ? "status-unlinked"
                                : plan.startStation.bikes === 0
                                  ? "bikes-empty"
                                  : "bikes-live"
                            }`}
                            aria-hidden="true"
                            title={
                              liveBikeStatus === "unavailable"
                                ? "현재 대여 가능 수량을 불러오지 못했어요."
                                : undefined
                            }
                          >
                            {liveBikeStatus === "ready" && plan.startStation.bikes !== null ? (
                              <>
                                <Bike size={13} aria-hidden="true" /> {plan.startStation.bikes}대
                              </>
                            ) : liveBikeStatus === "loading" ? (
                              "현황 확인 중"
                            ) : (
                              "수량 미확인"
                            )}
                          </span>
                        </span>
                        <span className="station-address">{plan.startStation.address}</span>
                      </button>
                      <span
                        className="screen-reader-only"
                        role="status"
                        aria-live="polite"
                      >
                        {startStationAvailabilityLabel}
                      </span>
                      {plan.startStationAdjustedForAvailability ? (
                        <p className="start-station-adjustment-note" role="status">
                          현재 가장 가까운 정류소의 따릉이가 없어서 다른 최적의 대여소를
                          알려드렸어요!
                        </p>
                      ) : null}
                    </div>
                  </li>
                  {bikeLegs.map((leg, index) => {
                    const transferStation = transferStops[index];
                    const legMinutes = Math.max(
                      1,
                      Math.ceil(leg.durationSeconds / 60),
                    );
                    return (
                      <Fragment key={`bike-leg-${index}-${transferStation?.id ?? "end"}`}>
                        <li className="timeline-segment bike-segment">
                          <span className="segment-icon">
                            <Bike size={16} aria-hidden="true" />
                          </span>
                          <div>
                            <strong>
                              {transferStops.length
                                ? `따릉이 구간 ${index + 1} · ${legMinutes}분`
                                : `따릉이로 ${legMinutes}분`}
                            </strong>
                            <small>
                              {formatDistance(Math.round(leg.distanceMeters))}
                              {passRouteStatus === "loading"
                                ? " · 경로 계산 중"
                                : leg.source === "direct"
                                  ? " · 직선거리 기반 예상"
                                  : null}
                            </small>
                          </div>
                        </li>
                        {transferStation ? (
                          <li className="timeline-station transfer-station">
                            <span className="station-number">{index + 2}</span>
                            <div className="station-card-copy">
                              <button
                                className="station-focus-button"
                                type="button"
                                aria-label={`${transferStation.name} 중간 반납·재대여 대여소를 지도에서 보기`}
                                onClick={() => focusMapPoint(transferStation)}
                              >
                                <span className="station-title-line">
                                  <span className="station-title-copy">
                                    <small>
                                      중간 반납·재대여 대여소
                                      <span className="best-badge transfer-badge">
                                        {getPassLabel(passType)}
                                      </span>
                                    </small>
                                    <strong>{transferStation.name}</strong>
                                  </span>
                                </span>
                                <span className="station-address">
                                  {transferStation.address}
                                </span>
                              </button>
                              <p className="transfer-instruction">
                                <RefreshCw size={12} aria-hidden="true" />
                                반납 완료 알림을 확인한 뒤 다시 대여해 주세요.
                              </p>
                            </div>
                          </li>
                        ) : null}
                      </Fragment>
                    );
                  })}
                  <li className="timeline-station return-station">
                    <span className="station-number">{transferStops.length + 2}</span>
                    <div className="station-card-copy">
                      <button
                        className="station-focus-button"
                        type="button"
                        aria-label={`${plan.endStation.name} 도착 대여소를 지도에서 보기`}
                        onClick={() => focusMapPoint("endStation")}
                      >
                        <span className="station-title-line">
                          <span className="station-title-copy">
                            <small>
                              목적지와 가까운 반납 대여소
                              <span className="best-badge">추천</span>
                            </small>
                            <strong>{plan.endStation.name}</strong>
                          </span>
                        </span>
                        <span className="station-address">{plan.endStation.address}</span>
                      </button>
                      <button
                        className="alternative-toggle"
                        type="button"
                        aria-expanded={alternativesOpen}
                        onClick={() => setAlternativesOpen((open) => !open)}
                      >
                        다른 반납 대여소 보기
                        {alternativesOpen ? (
                          <ChevronUp size={14} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={14} aria-hidden="true" />
                        )}
                      </button>
                      {alternativesOpen ? (
                        <div className="alternative-list">
                          {plan.alternatives.map((station) => (
                            <button
                              type="button"
                              className={station.id === plan.endStation.id ? "selected" : ""}
                              aria-pressed={station.id === plan.endStation.id}
                              key={station.id}
                              onClick={() => {
                                if (station.id === plan.endStation.id) return;
                                setRouteProgressSessionId(
                                  (sessionId) => sessionId + 1,
                                );
                                setMapFocusRequest(null);
                                setSelectedEndStationId(station.id);
                              }}
                            >
                              <span>
                                <strong>{station.name}</strong>
                                <small>
                                  목적지까지 {formatDistance(
                                    Math.round(
                                      distanceMeters(
                                        station.coordinates,
                                        plan.destination.coordinates,
                                      ) * 1.12,
                                    ),
                                  )}
                                </small>
                              </span>
                              <span className="alternative-distance">
                                거리순
                              </span>
                              {station.id === plan.endStation.id ? (
                                <Check size={14} aria-hidden="true" />
                              ) : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </li>
                  <li className="timeline-segment final-walk-segment">
                    <span className="segment-icon">
                      <Footprints size={16} aria-hidden="true" />
                    </span>
                    <div>
                      <strong>걸어서 {plan.walkFromMinutes}분</strong>
                      <small>{formatDistance(plan.walkFromMeters)}</small>
                    </div>
                  </li>
                  <li className="timeline-place destination-place">
                    <button
                      className="timeline-focus-button"
                      type="button"
                      aria-label={`${plan.destination.name} 도착지를 지도에서 보기`}
                      onClick={() => focusMapPoint("destination")}
                    >
                      <span className="timeline-dot" aria-hidden="true" />
                      <span className="timeline-place-copy">
                        <small>도착</small>
                        <strong>{plan.destination.name}</strong>
                      </span>
                    </button>
                  </li>
                </ol>
              ) : null}

              </section>
            ) : null}
          </div>
        </aside>

        <section
          ref={mapPanelRef}
          className={`map-panel${plan ? "" : " is-empty"}`}
          aria-label={plan ? "경로 지도" : "경로 검색 안내"}
        >
          {plan && routeRecommendation && nextRouteLeg ? (
            <RouteMap
              plan={plan}
              nextRouteLeg={nextRouteLeg}
              geometry={routeRecommendation.geometry}
              geometryStatus={routeRecommendation.geometryStatus}
              transferStops={transferStops}
              focusRequest={mapFocusRequest}
              userLocation={mapUserLocation}
              userHeading={mapUserHeading}
              locationFocusRequestId={mapLocationFocusRequestId}
              tryConsumeLocationFocusRequest={
                tryConsumeMapLocationFocusRequest
              }
              locationStatus={mapLocationStatus}
              locationMode={mapLocationMode}
              headingStatus={mapHeadingStatus}
              onLocate={locateMapUser}
              onFocusNextTarget={focusNextRouteTarget}
              onFocusMarker={focusMapCoordinates}
              onMapDragStart={minimizeMobileDetailsFromMapDrag}
              onEndpointDragStart={prepareRouteEndpointDrag}
              onEndpointMove={moveRouteEndpoint}
            />
          ) : (
            <div className="map-empty-state">
              <span className="map-empty-icon">
                <MapPin size={24} aria-hidden="true" />
              </span>
              <strong>출발지와 도착지를 검색해 주세요</strong>
              <p>장소를 선택하면 따릉이 대여·반납 경로가 지도에 표시돼요.</p>
            </div>
          )}
        </section>
      </div>

      {notice ? (
        <div className="toast" role="status">
          <span>
            <Check size={14} aria-hidden="true" />
          </span>
          {notice}
        </div>
      ) : null}
    </main>
  );
}
