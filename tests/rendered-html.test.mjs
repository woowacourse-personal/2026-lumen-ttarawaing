import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_PASS_TYPE,
  PASS_OPTIONS,
  TRANSFER_STOP_OVERHEAD_MINUTES,
  getPassSafeRideMinutes,
  initialMinimumStopCount,
  selectRouteCorridorStations,
  validateBikeLegDurations,
} from "../app/pass-planning.ts";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the ttarawaing route planner", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>따라와잉/);
  assert.match(
    html,
    /<meta name="description" content="따릉이를 더 편하게\. 가까운 대여소부터 반납 대여소와 이동 경로까지 한 번에 알려드려요\."/,
  );
  assert.match(
    html,
    /<meta property="og:description" content="따릉이를 더 편하게\. 가까운 대여소부터 반납 대여소와 이동 경로까지 한 번에 알려드려요\."/,
  );
  assert.match(
    html,
    /<meta property="og:image" content="https?:\/\/localhost(?::\d+)?\/og-v2\.png"/,
  );
  assert.match(
    html,
    /<meta property="og:image:alt" content="따라와잉 — 따릉이를 더 편하게"/,
  );
  assert.match(
    html,
    /<meta name="twitter:description" content="따릉이를 더 편하게\. 가까운 대여소부터 반납 대여소와 이동 경로까지 한 번에 알려드려요\."/,
  );
  assert.match(
    html,
    /<meta name="twitter:image" content="https?:\/\/localhost(?::\d+)?\/og-v2\.png"/,
  );
  assert.doesNotMatch(html, /걷기와 따릉이를 가장 편한 한 경로로/);
  assert.match(html, /대여부터 반납까지 한 번에 알려드려요/);
  assert.doesNotMatch(html, /대여부터 반납까지 한 번에<\/div>/);
  assert.match(html, /오늘은 어디로 가볼까요/);
  assert.doesNotMatch(html, /오늘은 따릉이와 함께 어디로 가볼까요/);
  assert.doesNotMatch(html, /어디로 따라갈까요/);
  assert.match(html, /최적 경로 찾기/);
  assert.match(html, /현재 이용권/);
  assert.match(html, /1시간권/);
  assert.match(html, /2시간권/);
  assert.match(html, /3시간권/);
  assert.match(html, /상관 없음/);
  assert.doesNotMatch(html, /히스토리/);
  assert.match(html, /이전에 찾은 경로가 여기에 표시돼요/);
  assert.match(html, /출발 장소를 검색해 주세요/);
  assert.match(html, /도착 장소를 검색해 주세요/);
  assert.match(html, /장소를 선택하면 따릉이 대여·반납 경로가 지도에 표시돼요/);
  assert.doesNotMatch(html, /value="망원시장"|value="더현대 서울"/);
  assert.doesNotMatch(
    html,
    /예상 추천 경로|카카오맵에서 이어보기|카카오맵 실제 데이터|서울자전거 운영 목록/,
  );
  assert.doesNotMatch(html, /nmap:\/\/|네이버 지도/);
  assert.doesNotMatch(html, /카카오맵 연동|aria-label="도움말"/);
  assert.doesNotMatch(html, /실제 장소 · 예상 경로/);
  assert.doesNotMatch(html, /빈자리 \d+|노들섬 서측 입구/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
  assert.doesNotMatch(
    html,
    /빠른 선택|망원시장 → 더현대|광화문 → 서울숲|홍대 → 여의도/,
  );
});

test("stores and reopens recent route history on this device", async () => {
  const pageSource = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(pageSource, /ROUTE_HISTORY_STORAGE_KEY/);
  assert.match(pageSource, /readStoredValue\(window\.localStorage/);
  assert.match(pageSource, /writeStoredValue\([\s\S]*window\.localStorage/);
  assert.match(pageSource, /\.slice\(0, ROUTE_HISTORY_LIMIT\)/);
  assert.match(
    pageSource,
    /onClick=\{\(\) => commitRoute\(route\.origin, route\.destination\)\}/,
  );
  assert.doesNotMatch(pageSource, /<span>히스토리<\/span>/);
  assert.doesNotMatch(pageSource, /QUICK_ROUTES|chooseQuickRoute/);
});

test("defaults to a remembered one, two, three-hour, or unlimited pass choice", async () => {
  const [pageSource, planningSource] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/pass-planning.ts", import.meta.url), "utf8"),
  ]);

  assert.equal(DEFAULT_PASS_TYPE, "60");
  assert.deepEqual(
    PASS_OPTIONS.map(({ value, label }) => [value, label]),
    [
      ["60", "1시간권"],
      ["120", "2시간권"],
      ["180", "3시간권"],
      ["none", "상관 없음"],
    ],
  );
  assert.match(pageSource, /type="radio"/);
  assert.match(pageSource, /name="bike-pass"/);
  assert.match(pageSource, /checked=\{passType === option\.value\}/);
  assert.match(
    pageSource,
    /readStoredValue\([\s\S]*window\.localStorage,[\s\S]*PASS_TYPE_STORAGE_KEY/,
  );
  assert.match(
    pageSource,
    /writeStoredValue\(window\.localStorage, PASS_TYPE_STORAGE_KEY/,
  );
  assert.match(planningSource, /DEFAULT_PASS_TYPE: PassType = "60"/);
});

test("offers and remembers the Kakao bicycle-road priority option", async () => {
  const [pageSource, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /자전거도로 우선/);
  assert.match(pageSource, /role="switch"/);
  assert.match(pageSource, /checked=\{preferBikeRoads\}/);
  assert.match(pageSource, /BIKE_ROAD_PRIORITY_STORAGE_KEY/);
  assert.match(pageSource, /bikeRouteMode: preferBikeRoads \? "BIKE_ONLY" : "SHORTEST"/);
  assert.match(pageSource, /writeStoredValue\([\s\S]*BIKE_ROAD_PRIORITY_STORAGE_KEY/);
  assert.match(styles, /\.bike-road-preference/);
  assert.match(styles, /\.bike-road-switch/);
});

test("uses a five-minute buffer and the theoretical minimum transfer count", () => {
  assert.equal(getPassSafeRideMinutes("60"), 55);
  assert.equal(getPassSafeRideMinutes("120"), 115);
  assert.equal(getPassSafeRideMinutes("180"), 175);
  assert.equal(getPassSafeRideMinutes("none"), null);
  assert.equal(TRANSFER_STOP_OVERHEAD_MINUTES, 3);

  assert.equal(initialMinimumStopCount(55, "60"), 0);
  assert.equal(initialMinimumStopCount(55.01, "60"), 1);
  assert.equal(initialMinimumStopCount(110, "60"), 1);
  assert.equal(initialMinimumStopCount(110.01, "60"), 2);
  assert.equal(initialMinimumStopCount(500, "none"), 0);
  assert.deepEqual(validateBikeLegDurations([55, 54.9], "60"), {
    isWithinLimit: true,
    safeMinutes: 55,
    violatingLegIndexes: [],
  });
  assert.deepEqual(validateBikeLegDurations([55.01, 40], "60"), {
    isWithinLimit: false,
    safeMinutes: 55,
    violatingLegIndexes: [0],
  });
});

test("selects distinct ordered stations along the actual route corridor", () => {
  const routePath = [
    [37.5, 126.9],
    [37.5, 127.0],
    [37.5, 127.1],
  ];
  const stations = [
    { id: "start", coordinates: [37.5, 126.9] },
    { id: "first", coordinates: [37.5004, 126.966] },
    { id: "second", coordinates: [37.4997, 127.034] },
    { id: "off-route", coordinates: [37.52, 127.0] },
    { id: "end", coordinates: [37.5, 127.1] },
  ];

  const selected = selectRouteCorridorStations({
    routePath,
    stations,
    stopCount: 2,
    excludedStationIds: new Set(["start", "end"]),
  });
  assert.deepEqual(selected.map(({ id }) => id), ["first", "second"]);
});

test("builds and validates the minimum number of road-routed transfer stops", async () => {
  const [pageSource, routeSource, recommendationSource] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/route-geometry.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/pass-route-recommendation.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(pageSource, /recommendPassTransferRoute\(\{/);
  assert.match(pageSource, /ROUTE_RECOMMENDATION_TIMEOUT_MS = 60_000/);
  assert.match(pageSource, /controller\.abort\(\)/);
  assert.match(recommendationSource, /let stopCount = Math\.max\(1, initialStopCount\)/);
  assert.match(recommendationSource, /stopCount \+= 1/);
  assert.match(
    recommendationSource,
    /DEFAULT_MAXIMUM_COMBINATIONS_PER_STOP_COUNT = 4/,
  );
  assert.match(recommendationSource, /const exclusionQueue: Set<string>\[\]/);
  assert.match(recommendationSource, /triedStationSequences/);
  assert.match(recommendationSource, /selectRouteCorridorStations/);
  assert.match(
    recommendationSource,
    /areBikeLegsWithinPassLimit\(bikeLegMinutes, passType\)/,
  );
  assert.match(
    recommendationSource,
    /geometry\.bikeLegs\.every\(\(leg\) => leg\.source === "kakao"\)/,
  );
  assert.match(recommendationSource, /catch \(error: unknown\)[\s\S]*continue;/);
  assert.match(routeSource, /transferStations\?: Coordinates\[\]/);
  assert.match(routeSource, /response\.route\.legs/);
  assert.match(routeSource, /loadBikeRoute\(bikeCoordinates, getBikeRouteMode\(input\), signal\)/);
  assert.match(routeSource, /bikeLegs: BikeRouteLeg\[\]/);
  assert.match(routeSource, /attachRequestedEndpoints/);
  assert.match(routeSource, /splitKakaoRouteCoordinates/);
  assert.match(routeSource, /throwIfAborted\(signal\)/);
  assert.match(routeSource, /Promise\.all/);
});

test("shows transfer stops consistently in the timeline and maps", async () => {
  const [pageSource, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /bikeLegs\.map\(\(leg, index\)/);
  assert.match(pageSource, /중간 반납·재대여 대여소/);
  assert.match(pageSource, /반납 완료 알림을 확인한 뒤 다시 대여해 주세요/);
  assert.match(pageSource, /transferStops\.length \+ 2/);
  assert.equal((pageSource.match(/transferStops\.forEach\(\(station, index\)/g) ?? []).length, 2);
  assert.match(pageSource, /\.\.\.transferStops/);
  assert.doesNotMatch(
    pageSource,
    /data-note|카카오맵 실제 데이터|서울자전거 운영 목록|데이터 출처: 서울 열린데이터광장|kakao-link|카카오맵에서 이어보기|kakao-route-preview|카카오맵에 전달할 경로|kakao-route-note|첫·마지막 도보 구간/,
  );
  assert.doesNotMatch(
    styles,
    /\.data-note|\.kakao-link(?:\W|$)|\.kakao-route-preview|\.kakao-route-note/,
  );
  assert.match(pageSource, /이 경로를 이용권에 안전한 경로라고 안내할 수 없어요/);
  assert.match(pageSource, /passType === "none" \? "not-needed" : "unavailable"/);
  assert.match(pageSource, /실시간 대여소[\s\S]*이동 중 바뀔 수 있어요/);
  assert.match(styles, /\.route-marker-wrapper\.transfer-marker-wrapper/);
  assert.match(styles, /\.transfer-station \.station-number/);
});

test("clears the active route from a dedicated re-entry button", async () => {
  const pageSource = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(pageSource, /className="reset-route-button"/);
  assert.match(pageSource, /다시 입력하기/);
  assert.match(pageSource, /const resetRoute = \(\) =>/);
  assert.match(pageSource, /setCommittedRoute\(null\)/);
  assert.match(pageSource, /document\.getElementById\("origin"\)\?\.focus\(\)/);
  assert.doesNotMatch(pageSource, /clearInstanceListeners/);
  assert.doesNotMatch(pageSource, /replaceChildren\(\)/);
});

test("draws Kakao REST road geometry instead of manufactured map curves or OSRM routes", async () => {
  const [pageSource, routeSource] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/route-geometry.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(pageSource, /createCurve/);
  assert.match(pageSource, /geometry\.bike\.path/);
  assert.match(pageSource, /OpenStreetMap contributors/);
  assert.match(pageSource, /attributionControl: true/);
  assert.doesNotMatch(pageSource, /openstreetmap\.org\/fixthemap|map-route-source/);
  assert.doesNotMatch(
    pageSource,
    /map-tools|providerLabel|카카오맵 실제 지도|도로 경로 · 짧은 구간 보정/,
  );
  assert.match(routeSource, /ROUTE_API_URL = "\/api\/routes"/);
  assert.match(routeSource, /type KakaoRoutePayload/);
  assert.match(routeSource, /requestKakaoWalkSegment/);
  assert.match(routeSource, /requestKakaoBikeRoute/);
  assert.match(routeSource, /bikeRouteMode/);
  assert.doesNotMatch(routeSource, /routing\.openstreetmap\.de|routed-foot|routed-bike|OSRM/i);
  assert.match(pageSource, /bikeRouteMode: preferBikeRoads/);
});

test("shows a centered spinner instead of temporary dotted route geometry", async () => {
  const [pageSource, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const routeLoadingRule =
    styles.match(/\.route-loading\s*\{([^}]+)\}/)?.[1] ?? "";
  const loadingGuards = pageSource.match(/geometryStatus === "loading"/g) ?? [];

  assert.match(pageSource, /className="route-loading"/);
  assert.match(pageSource, /경로를 불러오고 있어요/);
  assert.equal(loadingGuards.length, 4);
  assert.match(routeLoadingRule, /top:\s*50%/);
  assert.match(routeLoadingRule, /left:\s*50%/);
  assert.match(routeLoadingRule, /pointer-events:\s*none/);
});

test("tracks live location, focuses only on request, and rotates the map for heading", async () => {
  const [pageSource, styles, kakaoSource, cameraSource] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/kakao-maps.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/map-location-camera.ts", import.meta.url), "utf8"),
  ]);
  const guideControlsRule =
    styles.match(/\.map-guide-controls\s*\{([^}]+)\}/)?.[1] ?? "";
  const locationControlRule =
    styles.match(/\.map-location-control\s*\{([^}]+)\}/)?.[1] ?? "";
  const locationControlIndex = pageSource.indexOf("map-location-control");
  const legendIndex = pageSource.indexOf('className="map-legend"');

  assert.ok(locationControlIndex >= 0);
  assert.ok(legendIndex > locationControlIndex);
  assert.doesNotMatch(
    pageSource,
    /<span>\{locationStatus === "loading" \? "확인 중" : "현재 위치"\}<\/span>/,
  );
  assert.match(pageSource, /navigator\.geolocation\.watchPosition/);
  assert.match(pageSource, /navigator\.geolocation\.clearWatch/);
  assert.match(pageSource, /position\.coords\.heading/);
  assert.match(pageSource, /requestPermission/);
  assert.match(pageSource, /deviceorientationabsolute/);
  assert.match(pageSource, /webkitCompassHeading/);
  assert.match(pageSource, /getTiltCompensatedHeading/);
  assert.match(pageSource, /removeEventListener\(\s*"deviceorientationabsolute"/);
  assert.match(pageSource, /removeEventListener\("deviceorientation"/);
  assert.match(pageSource, /mapLocationMode === "tracking"/);
  assert.match(pageSource, /mapLocationMode === "heading"/);
  assert.match(pageSource, /내가 보는 방향 표시/);
  assert.doesNotMatch(pageSource, /aria-pressed=\{locationMode !== "idle"\}/);
  assert.match(pageSource, /map\.flyTo\(userLocation/);
  assert.doesNotMatch(pageSource, /map\.panTo\(userLocation/);
  assert.match(pageSource, /map\.panTo\(position\)/);
  assert.match(pageSource, /consumeLocationFocusRequest/);
  assert.match(pageSource, /setMapLocationFocusRequestId/);
  assert.match(pageSource, /locationFocusRequestId/);
  assert.match(pageSource, /mapHandledLocationFocusRequestIdRef/);
  assert.doesNotMatch(pageSource, /lastHandledLocationFocusRequestRef/);
  assert.match(pageSource, /routeCameraKey/);
  assert.match(pageSource, /marker\.setLatLng\(userLocation\)/);
  assert.match(pageSource, /overlay\.setPosition\(position\)/);
  assert.match(pageSource, /current-location-marker/);
  assert.match(pageSource, /current-location-direction/);
  assert.match(pageSource, /has-heading/);
  assert.match(kakaoSource, /panTo\(position: KakaoLatLng\)/);
  assert.match(kakaoSource, /setPosition\(position: KakaoLatLng\)/);
  assert.match(pageSource, /L\.control\.zoom\(\{ position: "topright" \}\)/);
  assert.match(guideControlsRule, /right:\s*20px/);
  assert.match(guideControlsRule, /bottom:\s*20px/);
  assert.match(guideControlsRule, /align-items:\s*flex-end/);
  assert.match(locationControlRule, /width:\s*44px/);
  assert.match(locationControlRule, /justify-content:\s*center/);
  assert.match(styles, /\.current-location-direction\s*\{/);
  assert.match(styles, /rotate\(var\(--location-heading\)\)/);
  assert.match(styles, /\.current-location-marker\.has-heading/);
  assert.match(styles, /\.map-canvas\[data-heading-up="true"\]/);
  assert.match(pageSource, /node\.style\.transform = `rotate\(\$\{-continuousHeading\}deg\)`/);
  assert.match(pageSource, /getRotatingMapCanvasSide/);
  assert.match(cameraSource, /Math\.ceil\(Math\.hypot\(width, height\)\)/);
});

test("fills the desktop map to the top beside the left-only header", async () => {
  const styles = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  const topbarRule = styles.match(/\.topbar\s*\{([^}]+)\}/)?.[1] ?? "";
  const workspaceRule = styles.match(/\.workspace\s*\{([^}]+)\}/)?.[1] ?? "";
  const routePanelRule = styles.match(/\.route-panel\s*\{([^}]+)\}/)?.[1] ?? "";
  const mapPanelRule = styles.match(/\.map-panel\s*\{([^}]+)\}/)?.[1] ?? "";

  assert.match(topbarRule, /position:\s*absolute/);
  assert.match(topbarRule, /width:\s*455px/);
  assert.match(workspaceRule, /min-height:\s*100vh/);
  assert.match(routePanelRule, /height:\s*100vh/);
  assert.match(routePanelRule, /padding-top:\s*72px/);
  assert.match(mapPanelRule, /height:\s*100vh/);
});

test("centers the route feedback popup over the desktop map area", async () => {
  const styles = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  const toastRule = styles.match(/\.toast\s*\{([^}]+)\}/)?.[1] ?? "";

  assert.match(toastRule, /left:\s*calc\(50% \+ 227\.5px\)/);
  assert.match(
    styles,
    /@media \(max-width: 900px\)[\s\S]*?\.toast\s*\{[^}]*left:\s*50%/,
  );
});

test("keeps the place-swap control in flow between the two input boxes", async () => {
  const [pageSource, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const swapButtonRule = styles.match(/\.swap-button\s*\{([^}]+)\}/)?.[1] ?? "";
  const fieldsStackRule = styles.match(/\.fields-stack\s*\{([^}]+)\}/)?.[1] ?? "";

  assert.doesNotMatch(swapButtonRule, /position:\s*absolute|\btop:|\bright:/);
  assert.match(swapButtonRule, /flex:\s*0 0 auto/);
  assert.match(fieldsStackRule, /gap:\s*6px/);
  assert.match(pageSource, /tone === "destination" && onSwap/);
  assert.match(pageSource, /onSwap=\{swapPlaces\}/);
});

test("does not imply live return-station availability", async () => {
  const pageSource = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(pageSource, /운영 확인|운영 목록 기준/);
  assert.doesNotMatch(pageSource, /반납 가능/);
});

test("uses clear unavailable-data copy and exposes fallback route warnings", async () => {
  const [pageSource, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /수량 미확인/);
  assert.doesNotMatch(pageSource, /현황 확인 필요|실시간 정보 없음/);
  assert.match(pageSource, /도로 경로를 불러오지 못해 전 구간을 직선거리로 예상했어요/);
  assert.match(pageSource, /className="route-geometry-warning" role="alert"/);
  assert.match(pageSource, /aria-selected=\{index === boundedActiveIndex\}/);
  assert.match(pageSource, /기본 장소를 보여드려요/);
  assert.match(
    styles,
    /\.map-canvas \.leaflet-control-zoom a\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s,
  );
});

test("skips an empty nearest rental station and explains the substitution", async () => {
  const [pageSource, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /nearestStation\.bikes !== 0/);
  assert.match(
    pageSource,
    /station\.bikes !== null && station\.bikes > 0/,
  );
  assert.match(pageSource, /startStationAdjustedForAvailability/);
  assert.match(
    pageSource,
    /현재 가장 가까운 정류소의 따릉이가 없어서 다른 최적의 대여소를/,
  );
  assert.match(pageSource, /알려드렸어요!/);
  assert.match(styles, /\.start-station-adjustment-note\s*\{/);
});

test("uses full start and destination labels on both map providers", async () => {
  const [pageSource, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.equal((pageSource.match(/"출발", "origin-marker"/g) ?? []).length, 2);
  assert.equal(
    (pageSource.match(/"도착",\s*"destination-marker"/g) ?? []).length,
    2,
  );
  assert.match(pageSource, /class="route-marker-label">\$\{label\}/);
  assert.match(styles, /\.route-marker-label\s*\{/);
});

test("renders every route marker as a centered teardrop pin", async () => {
  const [pageSource, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /iconSize:\s*\[60, 60\]/);
  assert.match(pageSource, /iconAnchor:\s*\[30, 60\]/);
  assert.match(pageSource, /xAnchor:\s*0\.5,\s*\n\s*yAnchor:\s*1/);
  assert.match(
    styles,
    /\.route-marker-wrapper\s*\{[^}]*width:\s*60px[^}]*height:\s*60px/s,
  );
  assert.match(
    styles,
    /\.route-marker-shape\s*\{[^}]*width:\s*42px[^}]*height:\s*42px[^}]*border-radius:\s*50% 50% 50% 0[^}]*transform:\s*translateX\(-50%\) rotate\(-45deg\)/s,
  );
  assert.match(styles, /\.route-marker-label\s*\{[^}]*transform:\s*rotate\(45deg\)/s);
  assert.match(styles, /\.route-marker\s*\{[^}]*transform-origin:\s*50% 100%/s);
  assert.doesNotMatch(styles, /\.route-marker-wrapper::after/);
  assert.match(styles, /\.origin-marker-wrapper\s*\{[^}]*var\(--blue\)/s);
  assert.match(styles, /\.bike-marker-wrapper\s*\{[^}]*var\(--green\)/s);
  assert.match(styles, /\.return-marker-wrapper\s*\{[^}]*#047a5d/s);
  assert.match(styles, /\.destination-marker-wrapper\s*\{[^}]*var\(--coral\)/s);
  assert.match(pageSource, /\$\{className\}-wrapper/);
});

test("focuses and zooms the map when a route pin is activated", async () => {
  const [pageSource, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const leafletSource = pageSource.slice(
    pageSource.indexOf("function LeafletRouteMap"),
    pageSource.indexOf("function KakaoRouteMap"),
  );
  const kakaoSource = pageSource.slice(
    pageSource.indexOf("function KakaoRouteMap"),
    pageSource.indexOf("function RouteMap("),
  );

  assert.match(pageSource, /onFocusMarker=\{focusMapCoordinates\}/);
  assert.equal(
    (pageSource.match(/onFocusMarker=\{onFocusMarker\}/g) ?? []).length,
    2,
  );
  assert.match(
    leafletSource,
    /\.on\("click", \(\) => onFocusMarker\(coordinates\)\)/,
  );
  assert.match(leafletSource, /keyboard:\s*true/);
  assert.match(
    leafletSource,
    /title:\s*`\$\{tooltip\} 지도 핀으로 이동`/,
  );
  assert.match(
    leafletSource,
    /mapRef\.current\.flyTo\(\s*focusRequest\.coordinates,\s*ROUTE_FOCUS_LEAFLET_ZOOM/,
  );
  assert.match(kakaoSource, /document\.createElement\("button"\)/);
  assert.match(kakaoSource, /wrapper\.type = "button"/);
  assert.match(
    kakaoSource,
    /wrapper\.setAttribute\("aria-label", `\$\{tooltip\} 지도 핀으로 이동`\)/,
  );
  assert.match(
    kakaoSource,
    /wrapper\.addEventListener\("click", \(event\) => \{[\s\S]*?event\.stopPropagation\(\);[\s\S]*?onFocusMarker\(coordinates\);/,
  );
  assert.match(
    kakaoSource,
    /content:\s*wrapper,\s*\n\s*clickable:\s*true/,
  );
  assert.match(
    kakaoSource,
    /map\.setLevel\(ROUTE_FOCUS_KAKAO_LEVEL\);\s*map\.panTo\(position\);/s,
  );
  assert.match(
    styles,
    /\.kakao-route-marker\s*\{[^}]*cursor:\s*pointer[^}]*pointer-events:\s*auto/s,
  );
  assert.doesNotMatch(
    styles,
    /\.kakao-route-marker\s*\{[^}]*pointer-events:\s*none/s,
  );
  assert.match(styles, /\.route-marker-wrapper:focus-visible\s*\{/);
});

test("focuses the map when each route timeline place is selected", async () => {
  const [pageSource, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /focusMapPoint\("origin"\)/);
  assert.match(pageSource, /focusMapPoint\("startStation"\)/);
  assert.match(pageSource, /focusMapPoint\("endStation"\)/);
  assert.match(pageSource, /focusMapPoint\("destination"\)/);
  assert.match(pageSource, /focusMapPoint\(transferStation\)/);
  assert.match(pageSource, /출발지를 지도에서 보기/);
  assert.match(pageSource, /출발 대여소를 지도에서 보기/);
  assert.match(pageSource, /도착 대여소를 지도에서 보기/);
  assert.match(pageSource, /도착지를 지도에서 보기/);
  assert.match(
    pageSource,
    /<RouteMap[\s\S]*?plan=\{plan\}[\s\S]*?focusRequest=\{mapFocusRequest\}/,
  );
  assert.match(
    pageSource,
    /const ROUTE_FOCUS_LEAFLET_ZOOM = 18/,
  );
  assert.match(pageSource, /const ROUTE_FOCUS_KAKAO_LEVEL = 2/);
  assert.match(
    pageSource,
    /mapRef\.current\.flyTo\(\s*focusRequest\.coordinates,\s*ROUTE_FOCUS_LEAFLET_ZOOM/,
  );
  assert.match(pageSource, /requestedFocus\.coordinates/);
  assert.match(
    pageSource,
    /map\.setLevel\(ROUTE_FOCUS_KAKAO_LEVEL\);\s*map\.panTo\(position\);/s,
  );
  assert.match(pageSource, /mapPanelRef\.current\?\.scrollIntoView/);
  assert.match(pageSource, /prefers-reduced-motion:\s*reduce/);
  assert.match(pageSource, /mapLocationRequestIdRef\.current \+= 1/);
  assert.match(pageSource, /stopMapLocationTracking\(true\)/);
  const mapChromeSource = pageSource.slice(
    pageSource.indexOf("function RouteMapChrome"),
    pageSource.indexOf("function LeafletRouteMap"),
  );
  assert.match(
    mapChromeSource,
    /<button\s+className="map-station-card"[\s\S]*?type="button"[\s\S]*?aria-label=\{`지도에서 다음 지점 보기: \$\{nextRouteLeg\.target\.name\}`\}[\s\S]*?onClick=\{onFocusNextTarget\}/,
  );
  assert.match(mapChromeSource, /다음 지점 · 출발 대여소/);
  assert.match(mapChromeSource, /다음 지점 · 경유 대여소/);
  assert.match(mapChromeSource, /다음 지점 · 반납 대여소/);
  assert.match(mapChromeSource, /다음 지점 · 도착지/);
  assert.match(
    mapChromeSource,
    /formatDistance\(Math\.round\(nextRouteLeg\.plannedDistanceMeters\)\)/,
  );
  assert.match(mapChromeSource, /예상 구간 거리/);
  assert.doesNotMatch(mapChromeSource, /plan\.endStation|plan\.walkFromMeters/);
  assert.match(pageSource, /routeProgressSessionId/);
  assert.match(
    pageSource,
    /setRouteProgressSessionId\(\(sessionId\) => sessionId \+ 1\)/,
  );
  assert.match(pageSource, /onFocusNextTarget=\{focusNextRouteTarget\}/);
  assert.ok(
    (pageSource.match(/onFocusNextTarget=\{onFocusNextTarget\}/g) ?? []).length >= 4,
  );
  assert.ok(
    (pageSource.match(/nextRouteLeg=\{nextRouteLeg\}/g) ?? []).length >= 4,
  );
  assert.match(
    pageSource,
    /focusNextRouteTarget[\s\S]*?focusMapCoordinates\(nextRouteLeg\.target\.coordinates, true\)/,
  );
  assert.match(
    pageSource,
    /if \(!preserveLocationTracking\) stopMapLocationTracking\(true\)/,
  );
  assert.match(pageSource, /plan\?\.\[target\]\.coordinates/);
  assert.match(
    pageSource,
    /requestId:\s*\(currentRequest\?\.requestId \?\? 0\) \+ 1/,
  );
  assert.match(
    styles,
    /\.timeline-focus-button\s*\{[^}]*cursor:\s*pointer[^}]*text-align:\s*left/s,
  );
  assert.match(
    styles,
    /\.station-focus-button\s*\{[^}]*cursor:\s*pointer[^}]*text-align:\s*left/s,
  );
  assert.match(
    styles,
    /\.map-station-card\s*\{[^}]*appearance:\s*none[^}]*cursor:\s*pointer[^}]*color:\s*inherit[^}]*text-align:\s*left/s,
  );
  assert.match(styles, /button:focus-visible,[\s\S]*?outline:\s*3px solid/);
});

test("scrolls and focuses the recommendation after the primary route search", async () => {
  const [pageSource, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /onClick=\{findRoute\}/);
  assert.match(pageSource, /if \(!commitRoute\(\)\) return/);
  assert.match(pageSource, /pendingResultFocusRef\.current = true/);
  assert.match(pageSource, /ref=\{resultSectionRef\}/);
  assert.match(pageSource, /tabIndex=\{-1\}/);
  assert.match(pageSource, /resultSection\.focus\(\{ preventScroll: true \}\)/);
  assert.match(
    pageSource,
    /resultSection\.scrollIntoView\(\{[\s\S]*?behavior: reduceMotion \? "auto" : "smooth"[\s\S]*?block: "start"/,
  );
  assert.match(pageSource, /window\.cancelAnimationFrame\(frameId\)/);
  assert.match(
    styles,
    /\.result-section\s*\{[^}]*scroll-margin-block-start:\s*12px/s,
  );
  assert.match(styles, /scroll-margin-block-start:\s*120px/);
  assert.match(styles, /scroll-margin-block-start:\s*116px/);
});

test("provides a draggable mobile route-details sheet that enlarges the map", async () => {
  const [pageSource, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /mobileDetailsMinimized/);
  assert.match(pageSource, /is-mobile-details-minimized/);
  assert.match(pageSource, /aria-controls="route-details-content"/);
  assert.match(pageSource, /aria-expanded=\{!mobileDetailsMinimized\}/);
  assert.match(pageSource, /className="panel-scroll" id="route-details-content"/);
  assert.match(
    pageSource,
    /className="mobile-details-toggle"[\s\S]*?className="panel-scroll" id="route-details-content"/,
  );
  assert.match(pageSource, /경로 상세 정보 최소화/);
  assert.match(pageSource, /경로 상세 정보 펼치기/);
  assert.match(pageSource, /onClick=\{toggleMobileDetails\}/);
  assert.match(pageSource, /onPointerDown=\{startMobileDetailsDrag\}/);
  assert.match(pageSource, /onPointerUp=\{finishMobileDetailsDrag\}/);
  assert.match(pageSource, /onPointerCancel=\{cancelMobileDetailsDrag\}/);
  assert.match(pageSource, /setPointerCapture\(event\.pointerId\)/);
  assert.match(pageSource, /releasePointerCapture\(event\.pointerId\)/);
  assert.match(pageSource, /mobileDetailsIgnoreClickUntilRef\.current/);
  assert.match(
    pageSource,
    /Date\.now\(\) \+ MOBILE_ROUTE_SHEET_CLICK_SUPPRESSION_MS/,
  );
  assert.match(pageSource, /shouldSuppressMobileRouteSheetClick\(start, end\)/);
  assert.match(pageSource, /scrollToMobileMap\(\)/);
  assert.match(pageSource, /setMobileDetailsMinimized\(false\)/);
  assert.match(pageSource, /pendingResultFocusRef\.current = false/);
  assert.match(styles, /\.mobile-details-toggle\s*\{\s*display:\s*none/);
  assert.match(
    styles,
    /@media \(max-width: 900px\)[\s\S]*?\.mobile-details-toggle\s*\{[^}]*display:\s*flex[^}]*height:\s*44px[^}]*touch-action:\s*none/s,
  );
  assert.match(
    styles,
    /\.workspace\.has-route\.is-mobile-details-minimized \.route-panel\s*\{[^}]*height:\s*44px[^}]*flex:\s*0 0 44px[^}]*overflow:\s*hidden/s,
  );
  assert.match(
    styles,
    /\.workspace\.has-route\.is-mobile-details-minimized \.panel-scroll\s*\{[^}]*display:\s*none/s,
  );
  assert.match(
    styles,
    /\.workspace\.has-route\.is-mobile-details-minimized \.map-panel\s*\{[^}]*height:\s*calc\(100dvh - 64px - 44px\)[^}]*min-height:\s*0/s,
  );
  assert.match(styles, /height:\s*calc\(100dvh - 60px - 44px\)/);
});

test("minimizes mobile details on map drag without animating the handle", async () => {
  const [pageSource, kakaoSource, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/kakao-maps.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /map\.on\("dragstart", onMapDragStart\)/);
  assert.match(pageSource, /map\.off\("dragstart", onMapDragStart\)/);
  assert.match(
    pageSource,
    /sdk\.maps\.event\.addListener\(map, "dragstart", onMapDragStart\)/,
  );
  assert.match(
    pageSource,
    /sdk\.maps\.event\.removeListener\(map, "dragstart", onMapDragStart\)/,
  );
  assert.match(pageSource, /onMapDragStart=\{minimizeMobileDetailsFromMapDrag\}/);
  assert.match(
    pageSource,
    /minimizeMobileDetailsFromMapDrag[\s\S]*?max-width: 900px[\s\S]*?pendingResultFocusRef\.current = false[\s\S]*?setMobileDetailsMinimized\(true\)/,
  );
  assert.match(kakaoSource, /event:\s*\{[\s\S]*?addListener[\s\S]*?removeListener/);
  assert.doesNotMatch(styles, /\.mobile-details-toggle:hover \.mobile-details-grip/);
  assert.doesNotMatch(
    styles,
    /\.mobile-details-toggle:focus-visible \.mobile-details-grip/,
  );
  assert.doesNotMatch(styles, /\.mobile-details-toggle:active \.mobile-details-grip/);
  const gripRule = styles.match(/\.mobile-details-grip\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(gripRule, /width:\s*42px/);
  assert.match(gripRule, /background:\s*#b9c3bd/);
  assert.doesNotMatch(gripRule, /transition:|transform:|var\(--green\)/);
  assert.match(pageSource, /new ResizeObserver\(applyLayout\)/);
});

test("keeps the mobile heading-up camera centered through map relayout", async () => {
  const [pageSource, kakaoSource, cameraSource, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/kakao-maps.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/map-location-camera.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const mapCanvasRule =
    styles.match(/\.map-canvas\s*\{(\s*z-index:[^}]+)\}/)?.[1] ?? "";

  assert.match(
    pageSource,
    /invalidateSize\(\{ pan: true, animate: false \}\)/,
  );
  assert.doesNotMatch(pageSource, /invalidateSize\(\{ pan: false/);
  assert.match(pageSource, /relayoutPreservingMapCenter\(map\)/);
  assert.match(kakaoSource, /getCenter\(\): KakaoLatLng/);
  assert.match(kakaoSource, /setCenter\(position: KakaoLatLng\): void/);
  assert.match(
    cameraSource,
    /const center = map\.getCenter\(\);[\s\S]*map\.relayout\(\);[\s\S]*map\.setCenter\(center\);/,
  );
  assert.match(pageSource, /node\.style\.left = "50%"/);
  assert.match(pageSource, /node\.style\.top = "50%"/);
  assert.match(pageSource, /node\.style\.marginLeft = `\$\{-side \/ 2\}px`/);
  assert.match(pageSource, /node\.style\.marginTop = `\$\{-side \/ 2\}px`/);
  assert.match(mapCanvasRule, /transform-origin:\s*50% 50%/);
});

test("centers each route time label under its proportional segment", async () => {
  const [pageSource, recommendationSource, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/pass-route-recommendation.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /<Footprints[^>]*\/> \{plan\.walkToMinutes\}분/);
  assert.match(pageSource, /<Bike[^>]*\/> \{plan\.bikeMinutes\}분/);
  assert.match(pageSource, /<Footprints[^>]*\/> \{plan\.walkFromMinutes\}분/);
  assert.match(
    pageSource,
    /className="mode-segment"[\s\S]*?style=\{\{ flex: plan\.walkToMinutes \}\}[\s\S]*?mode-segment-bar mode-walk-one[\s\S]*?mode-segment-label walk-to-label/,
  );
  assert.match(
    pageSource,
    /className="mode-segment" style=\{\{ flex: plan\.bikeMinutes \}\}[\s\S]*?mode-segment-bar mode-bike[\s\S]*?mode-segment-label bike-label/,
  );
  assert.match(
    pageSource,
    /className="mode-segment"[\s\S]*?style=\{\{ flex: plan\.walkFromMinutes \}\}[\s\S]*?mode-segment-bar mode-walk-two[\s\S]*?mode-segment-label walk-from-label/,
  );
  assert.match(pageSource, /aria-label=\{`출발 대여소까지 도보 \$\{plan\.walkToMinutes\}분`\}/);
  assert.match(pageSource, /aria-label=\{`도착지까지 도보 \$\{plan\.walkFromMinutes\}분`\}/);
  assert.match(
    styles,
    /\.mode-segment\s*\{[^}]*display:\s*flex[^}]*min-width:\s*40px[^}]*align-items:\s*center[^}]*flex-direction:\s*column/s,
  );
  assert.match(
    styles,
    /\.mode-segment-label\s*\{[^}]*justify-content:\s*center[^}]*white-space:\s*nowrap/s,
  );
  assert.match(
    pageSource,
    /const totalMinutes = walkToMinutes \+ bikeMinutes \+ walkFromMinutes;/,
  );
  assert.match(
    recommendationSource,
    /Math\.trunc\(transferStopCount\)\) \* TRANSFER_STOP_OVERHEAD_MINUTES/,
  );
  assert.doesNotMatch(pageSource, /환승 2분/);
  assert.doesNotMatch(
    pageSource,
    /plan\.walkToMinutes \+ plan\.walkFromMinutes/,
  );
});

test("searches and accepts both Seoul and Gyeonggi Kakao places", async () => {
  const [pageSource, kakaoSource] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/kakao-maps.ts", import.meta.url), "utf8"),
  ]);

  assert.match(kakaoSource, /`서울 \$\{normalized\}`/);
  assert.match(kakaoSource, /`경기 \$\{normalized\}`/);
  assert.match(kakaoSource, /서울\(\?:특별시\)\?/);
  assert.match(kakaoSource, /경기\(\?:도\)\?/);
  assert.match(kakaoSource, /Promise\.allSettled/);
  assert.match(kakaoSource, /result\.value\.filter/);
  assert.match(kakaoSource, /result\.id \|\| `\$\{result\.place_name\}/);
  assert.doesNotMatch(pageSource, /카카오맵 서울·경기 실제 장소/);
  assert.match(pageSource, /isSupportedPlaceAddress\(place\.address\)/);
  assert.doesNotMatch(pageSource, /place\.address\.includes\("서울"\)/);
});

test("uses the current operating-station catalog for the Sadang regression", async () => {
  const catalogUrl = new URL(
    "../app/data/seoul-bike-stations.json",
    import.meta.url,
  );
  const catalog = JSON.parse(await readFile(catalogUrl, "utf8"));
  const stations = catalog.stations;

  assert.ok(Array.isArray(stations));
  assert.ok(stations.length > 2_500);
  assert.equal(new Set(stations.map((station) => station.id)).size, stations.length);
  assert.equal(stations.some((station) => station.id === "2068"), false);

  const apartment = [37.48824897, 126.96780617];
  const toRadians = (value) => (value * Math.PI) / 180;
  const distanceMeters = (station) => {
    const radius = 6_371_000;
    const deltaLat = toRadians(station.latitude - apartment[0]);
    const deltaLng = toRadians(station.longitude - apartment[1]);
    const lat1 = toRadians(apartment[0]);
    const lat2 = toRadians(station.latitude);
    const h =
      Math.sin(deltaLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  };
  const nearest = [...stations].sort(
    (a, b) => distanceMeters(a) - distanceMeters(b),
  )[0];

  assert.equal(nearest.id, "2041");
  assert.equal(nearest.name, "2041. 사당중학교 버스정류소");
  assert.equal(nearest.address, "서울특별시 동작구 사당로 169");
  assert.ok(distanceMeters(nearest) < 160);
});

test("serves the Kakao JavaScript key from the runtime binding", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `kakao-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/config/kakao", {
      headers: { accept: "application/json" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
      KAKAO_JAVASCRIPT_KEY: "test-public-js-key",
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { javascriptKey: "test-public-js-key" });
  assert.match(response.headers.get("cache-control") ?? "", /max-age=300/);
});

test("normalizes the official Seoul Bike realtime station response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(
      String(input),
      "https://www.bikeseoul.com/app/station/getStationRealtimeStatus.do",
    );
    assert.equal(init?.method, "POST");
    assert.match(String(init?.body), /stationGrpSeq=ALL/);

    return Response.json({
      realtimeList: Array.from({ length: 2_701 }, (_, index) => ({
        stationName: `${index + 1}. 테스트 대여소`,
        parkingBikeTotCnt: "0",
        parkingQRBikeCnt: index === 0 ? "3" : "0",
        parkingELECBikeCnt: index === 0 ? "1" : "0",
      })),
    });
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("test", `bike-${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/bike-stations/realtime"),
      {},
      {
        waitUntil() {},
        passThroughOnException() {},
      },
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.stations.length, 2_701);
    assert.deepEqual(payload.stations[0], { id: "1", availableBikes: 4 });
    assert.match(response.headers.get("cache-control") ?? "", /max-age=20/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
