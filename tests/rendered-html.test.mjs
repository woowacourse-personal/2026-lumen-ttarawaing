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
  assert.match(html, /어디로 따라갈까요/);
  assert.match(html, /최적 경로 찾기/);
  assert.match(html, /망원시장/);
  assert.match(html, /더현대 서울/);
  assert.match(
    html,
    /https:\/\/map\.kakao\.com\/link\/by\/bicycle\/[^\"]*37\.55605,126\.90523\/[^\"]*37\.55894852,126\.90775299\/[^\"]*37\.52595139,126\.92987061\/[^\"]*37\.52591,126\.92843/,
  );
  assert.match(html, /카카오맵에서 이어보기/);
  assert.match(html, /출발 · 대여 · 반납 · 도착 4개 지점 자동 입력/);
  assert.doesNotMatch(html, /nmap:\/\/|네이버 지도/);
  assert.match(html, /카카오맵 연동/);
  assert.match(html, /카카오맵 실제 데이터/);
  assert.match(html, /서울자전거 운영 목록/);
  assert.match(html, /현황 확인 중/);
  assert.doesNotMatch(html, /빈자리 \d+|노들섬 서측 입구/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
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
