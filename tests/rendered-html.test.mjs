import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(html, /대여부터 반납까지 한 번에 알려드려요/);
  assert.doesNotMatch(html, /대여부터 반납까지 한 번에<\/div>/);
  assert.match(html, /오늘은 어디로 가볼까요/);
  assert.doesNotMatch(html, /오늘은 따릉이와 함께 어디로 가볼까요/);
  assert.doesNotMatch(html, /어디로 따라갈까요/);
  assert.match(html, /최적 경로 찾기/);
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
  assert.match(pageSource, /window\.localStorage\.getItem/);
  assert.match(pageSource, /window\.localStorage\.setItem/);
  assert.match(pageSource, /\.slice\(0, ROUTE_HISTORY_LIMIT\)/);
  assert.match(
    pageSource,
    /onClick=\{\(\) => commitRoute\(route\.origin, route\.destination\)\}/,
  );
  assert.doesNotMatch(pageSource, /<span>히스토리<\/span>/);
  assert.doesNotMatch(pageSource, /QUICK_ROUTES|chooseQuickRoute/);
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

test("draws road geometry instead of manufactured map curves", async () => {
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
  assert.match(routeSource, /routing\.openstreetmap\.de/);
  assert.match(routeSource, /routed-foot/);
  assert.match(routeSource, /routed-bike/);
  assert.match(routeSource, /REQUEST_INTERVAL_MS = 1_100/);
  assert.match(routeSource, /routeRatio > 4/);
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

test("tracks live location, then enables heading from the lower-right map control", async () => {
  const [pageSource, styles, kakaoSource] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/kakao-maps.ts", import.meta.url), "utf8"),
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
  assert.match(pageSource, /map\.panTo\(userLocation/);
  assert.match(pageSource, /map\.panTo\(position\)/);
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
  assert.match(locationControlRule, /width:\s*40px/);
  assert.match(locationControlRule, /justify-content:\s*center/);
  assert.match(styles, /\.current-location-direction\s*\{/);
  assert.match(styles, /rotate\(var\(--location-heading\)\)/);
  assert.match(styles, /\.current-location-marker\.has-heading/);
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
  assert.match(pageSource, /반납 가능 여부와 경로 시간은 실제 출발 전/);
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
  assert.match(styles, /\.route-marker\.origin-marker\s*\{[^}]*width:\s*42px/s);
  assert.match(styles, /\.route-marker\.destination-marker\s*\{[^}]*width:\s*42px/s);
});

test("anchors every route marker by its lower-left pointer tip", async () => {
  const [pageSource, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /iconSize:\s*\[42, 42\]/);
  assert.match(pageSource, /iconAnchor:\s*\[0, 42\]/);
  assert.match(pageSource, /xAnchor:\s*0,\s*\n\s*yAnchor:\s*1/);
  assert.match(
    styles,
    /\.route-marker-wrapper\s*\{[^}]*width:\s*42px[^}]*height:\s*42px/s,
  );
  assert.match(
    styles,
    /\.route-marker-wrapper::after\s*\{[^}]*top:\s*32px[^}]*left:\s*0[^}]*height:\s*10px[^}]*clip-path:\s*polygon\(0 0, 100% 0, 0 100%\)/s,
  );
  assert.match(pageSource, /\$\{className\}-wrapper/);
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
  assert.match(pageSource, /출발지를 지도에서 보기/);
  assert.match(pageSource, /출발 대여소를 지도에서 보기/);
  assert.match(pageSource, /도착 대여소를 지도에서 보기/);
  assert.match(pageSource, /도착지를 지도에서 보기/);
  assert.match(
    pageSource,
    /<RouteMap\s+plan=\{plan\}\s+focusRequest=\{mapFocusRequest\}/,
  );
  assert.match(
    pageSource,
    /const ROUTE_FOCUS_LEAFLET_ZOOM = 18/,
  );
  assert.match(pageSource, /const ROUTE_FOCUS_KAKAO_LEVEL = 2/);
  assert.match(
    pageSource,
    /mapRef\.current\.flyTo\(\s*plan\[focusRequest\.target\]\.coordinates,\s*ROUTE_FOCUS_LEAFLET_ZOOM/,
  );
  assert.match(pageSource, /plan\[requestedFocus\.target\]\.coordinates/);
  assert.match(
    pageSource,
    /map\.setLevel\(ROUTE_FOCUS_KAKAO_LEVEL\);\s*map\.panTo\(position\);/s,
  );
  assert.match(pageSource, /mapPanelRef\.current\?\.scrollIntoView/);
  assert.match(pageSource, /prefers-reduced-motion:\s*reduce/);
  assert.match(pageSource, /mapLocationRequestIdRef\.current \+= 1/);
  assert.match(pageSource, /stopMapLocationTracking\(true\)/);
  assert.match(
    styles,
    /\.timeline-focus-button\s*\{[^}]*cursor:\s*pointer[^}]*text-align:\s*left/s,
  );
  assert.match(
    styles,
    /\.station-focus-button\s*\{[^}]*cursor:\s*pointer[^}]*text-align:\s*left/s,
  );
});

test("summarizes route time in travel order without a transfer bucket", async () => {
  const pageSource = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    pageSource,
    /출발 대여소까지 도보 \{plan\.walkToMinutes\}분/,
  );
  assert.match(pageSource, /따릉이 \{plan\.bikeMinutes\}분/);
  assert.match(
    pageSource,
    /도착지까지 도보 \{plan\.walkFromMinutes\}분/,
  );
  assert.match(
    pageSource,
    /const totalMinutes = walkToMinutes \+ bikeMinutes \+ walkFromMinutes;/,
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
