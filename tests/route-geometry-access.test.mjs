import assert from "node:assert/strict";
import test from "node:test";

let importSequence = 0;

async function importFreshRouteGeometry() {
  const moduleUrl = new URL("../app/route-geometry.ts", import.meta.url);
  moduleUrl.searchParams.set("kakao-route-test", String(importSequence += 1));
  return import(moduleUrl.href);
}

const origin = [37.488248973536535, 126.96780616783967];
const startStation = [37.48683548, 126.9680481];
const endStation = [37.47608948, 126.98133087];
const destination = [37.47656223234824, 126.98155858357366];

const input = {
  origin,
  originAddress: "서울 동작구 사당로9가길 82",
  startStation,
  endStation,
  destination,
  destinationAddress: "서울 동작구 사당로 지하 310",
};

function parseRouteRequest(init = {}) {
  return JSON.parse(String(init.body));
}

function successfulRouteResponse(init = {}, customizeLeg) {
  const request = parseRouteRequest(init);
  const legs = request.coordinates.slice(0, -1).map((from, index) => {
    const to = request.coordinates[index + 1];
    const customPoints = customizeLeg?.({ request, from, to, index });
    const points = customPoints ?? [
      [from[1], from[0]],
      [(from[1] + to[1]) / 2, (from[0] + to[0]) / 2],
      [to[1], to[0]],
    ];
    return {
      properties: { distance: 240 + index, time: 120 + index },
      steps: [
        {
          properties: {
            distance: 240 + index,
            time: 120 + index,
            x: from[1],
            y: from[0],
          },
          path: { points },
        },
      ],
    };
  });
  return Response.json({
    status: "OK",
    route: {
      properties: {
        totalDistance: legs.reduce((sum, leg) => sum + leg.properties.distance, 0),
        totalTime: legs.reduce((sum, leg) => sum + leg.properties.time, 0),
        landingUrl: "https://map.kakao.com/",
      },
      legs,
    },
  });
}

test("uses coordinates and the bicycle route mode—not address text—in the Kakao cache key", async () => {
  const { createRouteGeometryKey } = await importFreshRouteGeometry();
  const shortestKey = createRouteGeometryKey({
    ...input,
    bikeRouteMode: "SHORTEST",
  });
  const bikeRoadKey = createRouteGeometryKey({
    ...input,
    bikeRouteMode: "BIKE_ONLY",
  });
  const changedAddressKey = createRouteGeometryKey({
    ...input,
    originAddress: "다른 표시용 주소",
    bikeRouteMode: "SHORTEST",
  });

  assert.match(shortestKey, /^v3-kakao\|/);
  assert.match(shortestKey, /bike:SHORTEST:/);
  assert.match(bikeRoadKey, /bike:BIKE_ONLY:/);
  assert.notEqual(shortestKey, bikeRoadKey);
  assert.equal(shortestKey, changedAddressKey);
});

test("parses Kakao [longitude, latitude] points and pins every path to the requested places", async (t) => {
  const { loadRouteGeometry } = await importFreshRouteGeometry();
  const originalFetch = globalThis.fetch;
  const requests = [];
  const sadangRoadPoint = [126.9677, 37.4876];
  globalThis.fetch = async (_url, init) => {
    const request = parseRouteRequest(init);
    requests.push(request);
    return successfulRouteResponse(init, ({ request: currentRequest }) => {
      if (
        currentRequest.mode === "walk" &&
        currentRequest.coordinates[0][0] === origin[0]
      ) {
        return [
          [origin[1] + 0.00002, origin[0] - 0.00002],
          sadangRoadPoint,
          [startStation[1] - 0.00002, startStation[0] + 0.00002],
        ];
      }
      return undefined;
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const geometry = await loadRouteGeometry({
    ...input,
    bikeRouteMode: "BIKE_ONLY",
  });
  const requestCountAfterFirstLoad = requests.length;
  const cachedGeometry = await loadRouteGeometry({
    ...input,
    bikeRouteMode: "BIKE_ONLY",
  });

  assert.equal(requestCountAfterFirstLoad, 3);
  assert.equal(requests.length, 3, "the completed Kakao route is cached");
  assert.equal(geometry.walkTo.source, "kakao");
  assert.deepEqual(geometry.walkTo.path[0], origin);
  assert.deepEqual(geometry.walkTo.path.at(-1), startStation);
  assert.ok(
    geometry.walkTo.path.some(
      ([latitude, longitude]) =>
        latitude === sadangRoadPoint[1] && longitude === sadangRoadPoint[0],
    ),
  );
  assert.deepEqual(geometry.bike.path[0], startStation);
  assert.deepEqual(geometry.bike.path.at(-1), endStation);
  assert.deepEqual(geometry.walkFrom.path.at(-1), destination);
  assert.deepEqual(cachedGeometry, geometry);
  assert.equal(
    requests.find((request) => request.mode === "bike")?.bikeRouteMode,
    "BIKE_ONLY",
  );
});

test("changing the bicycle-road option reuses both walks but requests a new Kakao bicycle route", async (t) => {
  const { loadRouteGeometry } = await importFreshRouteGeometry();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(parseRouteRequest(init));
    return successfulRouteResponse(init);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await loadRouteGeometry({ ...input, bikeRouteMode: "SHORTEST" });
  await loadRouteGeometry({ ...input, bikeRouteMode: "BIKE_ONLY" });

  assert.equal(requests.filter((request) => request.mode === "walk").length, 2);
  assert.deepEqual(
    requests
      .filter((request) => request.mode === "bike")
      .map((request) => request.bikeRouteMode),
    ["SHORTEST", "BIKE_ONLY"],
  );
});

test("splits more than five transfer waypoints into valid Kakao requests and preserves every leg", async (t) => {
  const { loadRouteGeometry } = await importFreshRouteGeometry();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(parseRouteRequest(init));
    return successfulRouteResponse(init);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const transferStations = Array.from({ length: 8 }, (_, index) => [
    37.48 - index * 0.0003,
    126.97 + index * 0.001,
  ]);
  const geometry = await loadRouteGeometry({
    ...input,
    transferStations,
    bikeRouteMode: "BIKE_ONLY",
  });
  const bikeRequests = requests.filter((request) => request.mode === "bike");

  assert.equal(bikeRequests.length, 2);
  assert.deepEqual(
    bikeRequests.map((request) => request.coordinates.length),
    [7, 4],
  );
  assert.equal(geometry.bikeLegs.length, 9);
  assert.equal(geometry.bikeLegs.every((leg) => leg.source === "kakao"), true);
  for (const transferStation of transferStations) {
    assert.ok(
      geometry.bike.path.some(
        (coordinate) =>
          coordinate[0] === transferStation[0] &&
          coordinate[1] === transferStation[1],
      ),
    );
  }
});
