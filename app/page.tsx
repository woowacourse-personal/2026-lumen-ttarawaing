"use client";

import {
  ArrowDownUp,
  ArrowRight,
  Bike,
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Clock3,
  Crosshair,
  ExternalLink,
  Footprints,
  LocateFixed,
  MapPin,
  Navigation,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import {
  loadKakaoMapsSdk,
  searchKakaoPlaces,
} from "./kakao-maps";
import type {
  KakaoMap,
  KakaoMapObject,
  KakaoPlaceResult,
  KakaoSdk,
} from "./kakao-maps";

type Coordinates = [number, number];

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
  bikes: number;
  docks: number;
};

type RoutePlan = {
  origin: Place;
  destination: Place;
  startStation: Station;
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

const STATIONS: Station[] = [
  {
    id: "ST-101",
    name: "광화문역 6번출구 옆",
    address: "세종대로 172 인근",
    coordinates: [37.57081, 126.97667],
    bikes: 12,
    docks: 6,
  },
  {
    id: "ST-102",
    name: "세종문화회관 앞",
    address: "세종대로 175 인근",
    coordinates: [37.57186, 126.97508],
    bikes: 5,
    docks: 11,
  },
  {
    id: "ST-103",
    name: "경복궁역 4번출구 뒤",
    address: "사직로 130 인근",
    coordinates: [37.57622, 126.97277],
    bikes: 8,
    docks: 4,
  },
  {
    id: "ST-201",
    name: "서울숲역 2번출구 앞",
    address: "왕십리로 77 인근",
    coordinates: [37.54362, 127.04449],
    bikes: 9,
    docks: 8,
  },
  {
    id: "ST-202",
    name: "서울숲 남문 버스정류소",
    address: "뚝섬로 273 인근",
    coordinates: [37.54191, 127.03764],
    bikes: 4,
    docks: 13,
  },
  {
    id: "ST-203",
    name: "성수역 3번출구 앞",
    address: "아차산로 100 인근",
    coordinates: [37.54488, 127.05593],
    bikes: 15,
    docks: 3,
  },
  {
    id: "ST-301",
    name: "홍대입구역 2번출구 앞",
    address: "양화로 160 인근",
    coordinates: [37.55756, 126.92349],
    bikes: 14,
    docks: 6,
  },
  {
    id: "ST-302",
    name: "102. 망원역 1번출구 앞",
    address: "월드컵로 80 인근",
    coordinates: [37.5556488, 126.91062927],
    bikes: 9,
    docks: 6,
  },
  {
    id: "ST-401",
    name: "여의도공원 1번출입구 앞",
    address: "여의공원로 68 인근",
    coordinates: [37.52814, 126.9197],
    bikes: 18,
    docks: 4,
  },
  {
    id: "ST-402",
    name: "여의나루역 1번출구 앞",
    address: "여의동로 343 인근",
    coordinates: [37.52713, 126.9328],
    bikes: 6,
    docks: 12,
  },
  {
    id: "ST-403",
    name: "210. IFC몰",
    address: "국제금융로 10 인근",
    coordinates: [37.52606583, 126.92553711],
    bikes: 8,
    docks: 7,
  },
  {
    id: "ST-501",
    name: "반포한강공원 세빛섬 앞",
    address: "올림픽대로 2085-14 인근",
    coordinates: [37.51118, 126.99572],
    bikes: 3,
    docks: 15,
  },
  {
    id: "ST-601",
    name: "DDP 동문 앞",
    address: "을지로 281 인근",
    coordinates: [37.56617, 127.01014],
    bikes: 11,
    docks: 7,
  },
  {
    id: "ST-701",
    name: "잠실새내 나들목",
    address: "한가람로 65 인근",
    coordinates: [37.51939, 127.08675],
    bikes: 10,
    docks: 10,
  },
  {
    id: "ST-801",
    name: "노들섬 서측 입구",
    address: "양녕로 445 인근",
    coordinates: [37.51806, 126.95542],
    bikes: 6,
    docks: 8,
  },
  {
    id: "ST-901",
    name: "안국역 2번출구 앞",
    address: "율곡로 62 인근",
    coordinates: [37.5764, 126.98503],
    bikes: 7,
    docks: 5,
  },
];

const QUICK_ROUTES = [
  { label: "망원시장 → 더현대", origin: "mangwon-market", destination: "the-hyundai-seoul" },
  { label: "광화문 → 서울숲", origin: "gwanghwamun", destination: "seoul-forest" },
  { label: "홍대 → 여의도", origin: "hongdae", destination: "yeouido-park" },
];

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
    address: result.road_address_name || result.address_name || "서울",
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
            .filter((place) => place.address.includes("서울"))
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

function nearestStartStation(place: Place) {
  return [...STATIONS]
    .filter((station) => station.bikes > 0)
    .sort(
      (a, b) =>
        distanceMeters(place.coordinates, a.coordinates) -
        distanceMeters(place.coordinates, b.coordinates),
    )[0];
}

function rankedEndStations(place: Place) {
  return [...STATIONS]
    .filter((station) => station.docks > 0)
    .sort((a, b) => {
      const scoreA = distanceMeters(place.coordinates, a.coordinates) - a.docks * 18;
      const scoreB = distanceMeters(place.coordinates, b.coordinates) - b.docks * 18;
      return scoreA - scoreB;
    })
    .slice(0, 3);
}

function buildPlan(origin: Place, destination: Place, endStationId?: string): RoutePlan {
  const startStation = nearestStartStation(origin);
  const alternatives = rankedEndStations(destination);
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
  const totalMinutes = walkToMinutes + bikeMinutes + walkFromMinutes + 2;

  return {
    origin,
    destination,
    startStation,
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

function buildKakaoRoutePoint(point: { name: string; coordinates: Coordinates }) {
  const [latitude, longitude] = point.coordinates;
  return `${encodeURIComponent(point.name)},${latitude},${longitude}`;
}

function buildKakaoBicycleRouteUrl(plan: RoutePlan) {
  const points = [
    plan.origin,
    plan.startStation,
    plan.endStation,
    plan.destination,
  ].map(buildKakaoRoutePoint);

  return `https://map.kakao.com/link/by/bicycle/${points.join("/")}`;
}

function formatDistance(meters: number) {
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function createCurve(a: Coordinates, b: Coordinates, bends = 5) {
  const result: Coordinates[] = [];
  const deltaLat = b[0] - a[0];
  const deltaLng = b[1] - a[1];
  for (let index = 0; index <= bends; index += 1) {
    const t = index / bends;
    const wave = Math.sin(Math.PI * t) * 0.0022;
    result.push([
      a[0] + deltaLat * t + wave * Math.sign(deltaLng || 1),
      a[1] + deltaLng * t - wave * Math.sign(deltaLat || 1),
    ]);
  }
  return result;
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
}: PlaceFieldProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const { matches, loading, source, failed } = usePlaceSuggestions(query, open);
  const boundedActiveIndex = Math.min(activeIndex, Math.max(0, matches.length - 1));

  const choose = (place: Place) => {
    onSelect(place);
    setOpen(false);
    setActiveIndex(0);
  };

  return (
    <div className="place-field">
      <div className="field-heading">
        <label htmlFor={id}>{label}</label>
        {tone === "origin" && onUseLocation ? (
          <button className="location-link" type="button" onClick={onUseLocation}>
            <Crosshair size={13} strokeWidth={2.3} aria-hidden="true" />
            현재 위치
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
          <div className="suggestion-eyebrow">
            {loading
              ? "카카오맵에서 검색 중…"
              : source === "kakao"
                ? "카카오맵 실제 장소"
                : failed
                  ? "데모 장소로 검색 중"
                  : query
                    ? "검색 결과"
                    : "서울의 인기 장소"}
          </div>
          {matches.length ? (
            matches.map((place, index) => (
              <button
                id={`${id}-option-${index}`}
                type="button"
                role="option"
                aria-selected={selected?.id === place.id}
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
            <div className="empty-suggestion">
              {loading ? (
                <span className="suggestion-loader" aria-hidden="true" />
              ) : (
                <Search size={18} aria-hidden="true" />
              )}
              <p>{loading ? "장소를 찾고 있어요." : "서울에서 검색 결과를 찾지 못했어요."}</p>
              <small>
                {failed
                  ? "카카오맵 연결이 지연되어 데모 장소만 확인했어요."
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
  plan,
  ready,
  providerLabel,
}: {
  plan: RoutePlan;
  ready: boolean;
  providerLabel: string;
}) {
  return (
    <>
      {!ready ? (
        <div className="map-loading" role="status">
          <span className="loading-wheel" aria-hidden="true" />
          지도를 불러오고 있어요
        </div>
      ) : null}
      <div className="map-tools" aria-label="지도 정보">
        <span className="live-chip">
          <span className="live-dot" />
          {providerLabel}
        </span>
        <span className="map-mode">실제 장소 · 예상 경로</span>
      </div>
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
      <div className="map-station-card">
        <div className="station-mini-icon">
          <Bike size={18} aria-hidden="true" />
        </div>
        <div>
          <span>추천 반납 대여소</span>
          <strong>{plan.endStation.name}</strong>
        </div>
        <div className="dock-count">
          <b>{plan.endStation.docks}</b>
          <small>빈자리</small>
        </div>
      </div>
    </>
  );
}

function LeafletRouteMap({ plan }: { plan: RoutePlan }) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const routeLayerRef = useRef<LayerGroup | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void import("leaflet").then((leafletModule) => {
      if (!active || !nodeRef.current || mapRef.current) return;
      const L = leafletModule.default;
      const map = L.map(nodeRef.current, {
        zoomControl: false,
        attributionControl: true,
      }).setView([37.561, 127.006], 13);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(map);
      mapRef.current = map;
      setReady(true);
    });

    return () => {
      active = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    let active = true;

    void import("leaflet").then((leafletModule) => {
      if (!active || !mapRef.current) return;
      const L = leafletModule.default;
      if (routeLayerRef.current) routeLayerRef.current.remove();
      const group = L.layerGroup().addTo(mapRef.current);
      routeLayerRef.current = group;

      const marker = (
        coordinates: Coordinates,
        label: string,
        className: string,
        tooltip: string,
      ) => {
        L.marker(coordinates, {
          icon: L.divIcon({
            className: "route-marker-wrapper",
            html: `<span class="route-marker ${className}">${label}</span>`,
            iconSize: [42, 42],
            iconAnchor: [21, 38],
          }),
        })
          .bindTooltip(tooltip, { direction: "top", offset: [0, -34] })
          .addTo(group);
      };

      const walkTo = createCurve(plan.origin.coordinates, plan.startStation.coordinates, 3);
      const bike = createCurve(plan.startStation.coordinates, plan.endStation.coordinates, 9);
      const walkFrom = createCurve(
        plan.endStation.coordinates,
        plan.destination.coordinates,
        3,
      );

      L.polyline(walkTo, {
        color: "#3759c7",
        weight: 5,
        opacity: 0.9,
        dashArray: "3 9",
        lineCap: "round",
      }).addTo(group);
      L.polyline(bike, {
        color: "#00a77b",
        weight: 7,
        opacity: 0.92,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(group);
      L.polyline(bike, {
        color: "#baf4df",
        weight: 2,
        opacity: 0.9,
        dashArray: "1 10",
        lineCap: "round",
      }).addTo(group);
      L.polyline(walkFrom, {
        color: "#ef704f",
        weight: 5,
        opacity: 0.9,
        dashArray: "3 9",
        lineCap: "round",
      }).addTo(group);

      marker(plan.origin.coordinates, "출", "origin-marker", plan.origin.name);
      marker(
        plan.startStation.coordinates,
        "대여",
        "bike-marker",
        plan.startStation.name,
      );
      marker(
        plan.endStation.coordinates,
        "반납",
        "return-marker",
        plan.endStation.name,
      );
      marker(
        plan.destination.coordinates,
        "도",
        "destination-marker",
        plan.destination.name,
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
            .bindTooltip(`${station.name} · 빈자리 ${station.docks}`)
            .addTo(group);
        });

      const bounds = L.latLngBounds([
        plan.origin.coordinates,
        plan.startStation.coordinates,
        plan.endStation.coordinates,
        plan.destination.coordinates,
      ]);
      mapRef.current.fitBounds(bounds, {
        paddingTopLeft: [80, 110],
        paddingBottomRight: [90, 90],
        maxZoom: 15,
      });
    });

    return () => {
      active = false;
    };
  }, [plan, ready]);

  return (
    <div className="map-wrap">
      <div ref={nodeRef} className="map-canvas" aria-label="따라와잉 경로 지도" />
      <RouteMapChrome plan={plan} ready={ready} providerLabel="대체 지도 · 데모 현황" />
    </div>
  );
}

function KakaoRouteMap({ plan, onError }: { plan: RoutePlan; onError: () => void }) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const sdkRef = useRef<KakaoSdk | null>(null);
  const mapObjectsRef = useRef<KakaoMapObject[]>([]);
  const [ready, setReady] = useState(false);

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
      if (mapRef.current && sdkRef.current) {
        sdkRef.current.maps.event.clearInstanceListeners(mapRef.current);
      }
      mapRef.current = null;
      sdkRef.current = null;
      mapNode?.replaceChildren();
    };
  }, [clearMapObjects, onError]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let animationFrame = 0;
    const relayoutMap = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => map.relayout());
    };
    window.addEventListener("resize", relayoutMap);
    return () => {
      window.removeEventListener("resize", relayoutMap);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [ready]);

  useEffect(() => {
    const sdk = sdkRef.current;
    const map = mapRef.current;
    if (!ready || !sdk || !map) return;

    clearMapObjects();
    const toLatLng = ([latitude, longitude]: Coordinates) =>
      new sdk.maps.LatLng(latitude, longitude);
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
    const addMarker = (
      coordinates: Coordinates,
      label: string,
      className: string,
      tooltip: string,
    ) => {
      const wrapper = document.createElement("span");
      wrapper.className = "route-marker-wrapper kakao-route-marker";
      wrapper.title = tooltip;
      wrapper.setAttribute("aria-hidden", "true");
      const marker = document.createElement("span");
      marker.className = `route-marker ${className}`;
      marker.textContent = label;
      wrapper.appendChild(marker);
      const overlay = new sdk.maps.CustomOverlay({
        map,
        position: toLatLng(coordinates),
        content: wrapper,
        xAnchor: 0.5,
        yAnchor: 1,
        zIndex: 4,
      });
      mapObjectsRef.current.push(overlay);
    };

    const walkTo = createCurve(plan.origin.coordinates, plan.startStation.coordinates, 3);
    const bike = createCurve(plan.startStation.coordinates, plan.endStation.coordinates, 9);
    const walkFrom = createCurve(
      plan.endStation.coordinates,
      plan.destination.coordinates,
      3,
    );

    addPolyline(walkTo, "#3759c7", 5, "shortdash");
    addPolyline(bike, "#00a77b", 7);
    addPolyline(bike, "#baf4df", 2, "shortdot", 0.95);
    addPolyline(walkFrom, "#ef704f", 5, "shortdash");

    addMarker(plan.origin.coordinates, "출", "origin-marker", plan.origin.name);
    addMarker(plan.startStation.coordinates, "대여", "bike-marker", plan.startStation.name);
    addMarker(plan.endStation.coordinates, "반납", "return-marker", plan.endStation.name);
    addMarker(
      plan.destination.coordinates,
      "도",
      "destination-marker",
      plan.destination.name,
    );

    plan.alternatives
      .filter((station) => station.id !== plan.endStation.id)
      .forEach((station) => {
        const dot = document.createElement("span");
        dot.className = "alternative-map-dot";
        dot.title = `${station.name} · 빈자리 ${station.docks}`;
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
      plan.origin.coordinates,
      plan.startStation.coordinates,
      plan.endStation.coordinates,
      plan.destination.coordinates,
    ].forEach((coordinates) => bounds.extend(toLatLng(coordinates)));

    const animationFrame = window.requestAnimationFrame(() => {
      map.relayout();
      map.setBounds(bounds, 110, 90, 90, 80);
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      clearMapObjects();
    };
  }, [clearMapObjects, plan, ready]);

  return (
    <div className="map-wrap">
      <div
        ref={nodeRef}
        className="map-canvas kakao-map-canvas"
        aria-label="카카오맵으로 보는 따라와잉 경로"
      />
      <RouteMapChrome plan={plan} ready={ready} providerLabel="카카오맵 실제 지도" />
    </div>
  );
}

function RouteMap({ plan }: { plan: RoutePlan }) {
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
    return <KakaoRouteMap plan={plan} onError={useLeafletFallback} />;
  }
  if (provider === "leaflet") {
    return <LeafletRouteMap plan={plan} />;
  }

  return (
    <div className="map-wrap">
      <div className="map-canvas" aria-hidden="true" />
      <RouteMapChrome plan={plan} ready={false} providerLabel="카카오맵 연결 중" />
    </div>
  );
}

export default function Home() {
  const initialOrigin = PLACES.find((place) => place.id === "mangwon-market") ?? PLACES[0];
  const initialDestination =
    PLACES.find((place) => place.id === "the-hyundai-seoul") ?? PLACES[1];
  const [originQuery, setOriginQuery] = useState(initialOrigin.name);
  const [destinationQuery, setDestinationQuery] = useState(initialDestination.name);
  const [origin, setOrigin] = useState<Place | null>(initialOrigin);
  const [destination, setDestination] = useState<Place | null>(initialDestination);
  const [committedOrigin, setCommittedOrigin] = useState(initialOrigin);
  const [committedDestination, setCommittedDestination] = useState(initialDestination);
  const [selectedEndStationId, setSelectedEndStationId] = useState<string>();
  const [alternativesOpen, setAlternativesOpen] = useState(false);
  const [routeDetailsOpen, setRouteDetailsOpen] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");

  const plan = useMemo(
    () => buildPlan(committedOrigin, committedDestination, selectedEndStationId),
    [committedDestination, committedOrigin, selectedEndStationId],
  );
  const kakaoRouteUrl = useMemo(() => buildKakaoBicycleRouteUrl(plan), [plan]);

  const commitRoute = useCallback(
    (nextOrigin?: Place | null, nextDestination?: Place | null) => {
      const resolvedOrigin = nextOrigin ?? origin;
      const resolvedDestination = nextDestination ?? destination;

      if (!resolvedOrigin || !resolvedDestination) {
        setErrorMessage("출발지와 도착지를 검색 결과에서 선택해 주세요.");
        return;
      }
      if (resolvedOrigin.id === resolvedDestination.id) {
        setErrorMessage("서로 다른 출발지와 도착지를 선택해 주세요.");
        return;
      }

      setOrigin(resolvedOrigin);
      setDestination(resolvedDestination);
      setOriginQuery(resolvedOrigin.name);
      setDestinationQuery(resolvedDestination.name);
      setCommittedOrigin(resolvedOrigin);
      setCommittedDestination(resolvedDestination);
      setSelectedEndStationId(undefined);
      setAlternativesOpen(false);
      setErrorMessage("");
      setNotice("가장 편한 따릉이 경로를 찾았어요.");
      window.setTimeout(() => setNotice(""), 2800);
    }, [destination, origin],
  );

  const selectOrigin = (place: Place) => {
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
    if (!navigator.geolocation) {
      setErrorMessage("이 브라우저에서는 현재 위치를 사용할 수 없어요.");
      return;
    }
    setNotice("현재 위치를 확인하고 있어요…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const currentPlace: Place = {
          id: "current-location",
          name: "내 현재 위치",
          address: "기기에서 확인한 위치",
          hint: "현재 위치",
          coordinates: [position.coords.latitude, position.coords.longitude],
        };
        selectOrigin(currentPlace);
        setNotice("현재 위치를 출발지로 설정했어요.");
        window.setTimeout(() => setNotice(""), 2600);
      },
      () => {
        setNotice("");
        setErrorMessage("위치 권한을 허용하면 현재 위치에서 출발할 수 있어요.");
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const swapPlaces = () => {
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

  const chooseQuickRoute = (originId: string, destinationId: string) => {
    const nextOrigin = PLACES.find((place) => place.id === originId) ?? PLACES[0];
    const nextDestination =
      PLACES.find((place) => place.id === destinationId) ?? PLACES[1];
    selectOrigin(nextOrigin);
    selectDestination(nextDestination);
    commitRoute(nextOrigin, nextDestination);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="따라와잉 홈">
          <span className="brand-mark">
            <Bike size={23} strokeWidth={2.4} aria-hidden="true" />
          </span>
          <span>
            <strong>따라와잉</strong>
            <small>따릉이로 잇는 서울</small>
          </span>
        </a>
        <div className="header-actions">
          <span className="service-badge">
            <span />
            카카오맵 연동
          </span>
          <button className="icon-button" type="button" aria-label="도움말">
            <CircleHelp size={19} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="workspace" id="top">
        <aside className="route-panel">
          <div className="panel-scroll">
            <section className="search-section" aria-labelledby="route-search-title">
              <div className="section-kicker">
                <Sparkles size={14} aria-hidden="true" />
                대여부터 반납까지 한 번에
              </div>
              <div className="title-row">
                <div>
                  <h1 id="route-search-title">어디로 따라갈까요?</h1>
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
                  />
                </div>
                <button
                  className="swap-button"
                  type="button"
                  aria-label="출발지와 도착지 바꾸기"
                  onClick={swapPlaces}
                >
                  <ArrowDownUp size={17} aria-hidden="true" />
                </button>
              </div>

              {errorMessage ? (
                <p className="form-error" role="alert">
                  {errorMessage}
                </p>
              ) : null}

              <button className="find-route-button" type="button" onClick={() => commitRoute()}>
                <Navigation size={17} fill="currentColor" aria-hidden="true" />
                최적 경로 찾기
                <ArrowRight className="button-arrow" size={18} aria-hidden="true" />
              </button>

              <div className="quick-routes" aria-label="추천 경로">
                <span>빠른 선택</span>
                <div>
                  {QUICK_ROUTES.map((route) => (
                    <button
                      type="button"
                      key={route.label}
                      onClick={() => chooseQuickRoute(route.origin, route.destination)}
                    >
                      {route.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="result-section" aria-labelledby="route-result-title">
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
                <div className="mode-bar" aria-hidden="true">
                  <span
                    className="mode-walk-one"
                    style={{ flex: plan.walkToMinutes }}
                  />
                  <span className="mode-bike" style={{ flex: plan.bikeMinutes }} />
                  <span
                    className="mode-walk-two"
                    style={{ flex: plan.walkFromMinutes }}
                  />
                </div>
                <div className="mode-labels">
                  <span>
                    <Footprints size={14} aria-hidden="true" /> 걷기 {plan.walkToMinutes + plan.walkFromMinutes}분
                  </span>
                  <span>
                    <Bike size={15} aria-hidden="true" /> 따릉이 {plan.bikeMinutes}분
                  </span>
                  <span>
                    <Clock3 size={14} aria-hidden="true" /> 환승 2분
                  </span>
                </div>
              </div>

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
                    <span className="timeline-dot" aria-hidden="true" />
                    <div>
                      <small>출발</small>
                      <strong>{plan.origin.name}</strong>
                    </div>
                  </li>
                  <li className="timeline-segment walking-segment">
                    <span className="segment-icon">
                      <Footprints size={16} aria-hidden="true" />
                    </span>
                    <div>
                      <strong>걸어서 {plan.walkToMinutes}분</strong>
                      <small>{formatDistance(plan.walkToMeters)} · 직선거리 기반 예상</small>
                    </div>
                  </li>
                  <li className="timeline-station">
                    <span className="station-number">1</span>
                    <div className="station-card-copy">
                      <div className="station-title-line">
                        <div>
                          <small>가장 가까운 대여소</small>
                          <strong>{plan.startStation.name}</strong>
                        </div>
                        <span className="availability bikes-available">
                          <Bike size={13} aria-hidden="true" /> {plan.startStation.bikes}대
                        </span>
                      </div>
                      <p>{plan.startStation.address}</p>
                    </div>
                  </li>
                  <li className="timeline-segment bike-segment">
                    <span className="segment-icon">
                      <Bike size={16} aria-hidden="true" />
                    </span>
                    <div>
                      <strong>따릉이로 {plan.bikeMinutes}분</strong>
                      <small>{formatDistance(plan.bikeMeters)} · 예상 이동 거리</small>
                    </div>
                  </li>
                  <li className="timeline-station return-station">
                    <span className="station-number">2</span>
                    <div className="station-card-copy">
                      <div className="station-title-line">
                        <div>
                          <small>
                            최적의 반납 대여소
                            <span className="best-badge">추천</span>
                          </small>
                          <strong>{plan.endStation.name}</strong>
                        </div>
                        <span className="availability docks-available">
                          빈자리 {plan.endStation.docks}
                        </span>
                      </div>
                      <p>{plan.endStation.address}</p>
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
                              key={station.id}
                              onClick={() => setSelectedEndStationId(station.id)}
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
                              <span className="alternative-docks">빈자리 {station.docks}</span>
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
                      <small>{formatDistance(plan.walkFromMeters)} · 목적지까지</small>
                    </div>
                  </li>
                  <li className="timeline-place destination-place">
                    <span className="timeline-dot" aria-hidden="true" />
                    <div>
                      <small>도착</small>
                      <strong>{plan.destination.name}</strong>
                    </div>
                  </li>
                </ol>
              ) : null}

              <div className="data-note">
                <LocateFixed size={15} aria-hidden="true" />
                <span>
                  장소 검색과 지도는 <strong>카카오맵 실제 데이터</strong>, 따릉이 수량과 경로 시간은 프로토타입 예상치예요. 실제 출발 전 따릉이 앱에서 확인해 주세요.
                  {" "}
                  <a
                    href="https://data.seoul.go.kr/dataList/OA-15493/A/1/datasetView.do"
                    target="_blank"
                    rel="noreferrer"
                  >
                    데이터 출처: 서울 열린데이터광장
                  </a>
                </span>
              </div>

              <a
                className="kakao-link"
                href={kakaoRouteUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="출발지, 대여소, 반납 대여소, 도착지를 포함해 카카오맵 자전거 길찾기에서 열기"
              >
                <span className="kakao-link-icon">
                  <Navigation size={16} fill="currentColor" aria-hidden="true" />
                </span>
                <span className="kakao-link-copy">
                  <strong>카카오맵에서 이어보기</strong>
                  <small>출발 · 대여 · 반납 · 도착 4개 지점 자동 입력</small>
                </span>
                <ExternalLink className="kakao-link-arrow" size={15} aria-hidden="true" />
              </a>
              <div className="kakao-route-preview" aria-label="카카오맵에 전달할 경로">
                <span>{plan.origin.name}</span>
                <ArrowRight size={11} aria-hidden="true" />
                <span>{plan.startStation.name}</span>
                <ArrowRight size={11} aria-hidden="true" />
                <span>{plan.endStation.name}</span>
                <ArrowRight size={11} aria-hidden="true" />
                <span>{plan.destination.name}</span>
              </div>
              <p className="kakao-route-note">
                카카오맵에서는 네 지점을 하나의 자전거 경로로 열어요. 첫·마지막 도보 구간은 따라와잉 안내를 확인해 주세요.
              </p>
            </section>
          </div>
        </aside>

        <section className="map-panel" aria-label="경로 지도">
          <RouteMap plan={plan} />
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
