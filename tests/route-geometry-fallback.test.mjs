import assert from "node:assert/strict";
import test from "node:test";

let importSequence = 0;

async function importFreshRouteGeometry() {
  const moduleUrl = new URL("../app/route-geometry.ts", import.meta.url);
  moduleUrl.searchParams.set("fallback-test", String(importSequence += 1));
  return import(moduleUrl.href);
}

function routeInput(offset = 0) {
  return {
    origin: [37.51 + offset, 126.91 + offset],
    startStation: [37.511 + offset, 126.911 + offset],
    endStation: [37.512 + offset, 126.912 + offset],
    destination: [37.513 + offset, 126.913 + offset],
  };
}

function parseRouteRequest(init = {}) {
  assert.equal(init.method, "POST");
  return JSON.parse(String(init.body));
}

function successfulRouteResponse(init = {}) {
  const request = parseRouteRequest(init);
  const coordinates = request.coordinates;
  const legs = coordinates.slice(0, -1).map((from, index) => {
    const to = coordinates[index + 1];
    const midpoint = [
      (from[0] + to[0]) / 2 + 0.00005,
      (from[1] + to[1]) / 2 + 0.00005,
    ];
    return {
      properties: { distance: 180, time: 90 },
      steps: [
        {
          properties: { distance: 180, time: 90, x: from[1], y: from[0] },
          path: {
            points: [
              [from[1], from[0]],
              [midpoint[1], midpoint[0]],
              [to[1], to[0]],
            ],
          },
        },
      ],
    };
  });
  return Response.json({
    status: "OK",
    route: {
      properties: {
        totalDistance: legs.length * 180,
        totalTime: legs.length * 90,
        landingUrl: "https://map.kakao.com/",
      },
      legs,
    },
  });
}

function failedRouteResponse() {
  return Response.json(
    { error: "Route calculation is temporarily unavailable." },
    { status: 503 },
  );
}

test("a failed bicycle route falls back only that segment while both walks keep Kakao geometry", async (t) => {
  const { loadRouteGeometry } = await importFreshRouteGeometry();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async (_url, init) => {
    requestCount += 1;
    const request = parseRouteRequest(init);
    return request.mode === "bike"
      ? failedRouteResponse()
      : successfulRouteResponse(init);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const geometry = await loadRouteGeometry(routeInput(0.01));

  assert.equal(requestCount, 3);
  assert.equal(geometry.walkTo.source, "kakao");
  assert.ok(geometry.walkTo.path.length > 2);
  assert.equal(geometry.bike.source, "direct");
  assert.equal(geometry.bike.path.length, 2);
  assert.deepEqual(geometry.bikeLegs.map((leg) => leg.source), ["direct"]);
  assert.equal(geometry.walkFrom.source, "kakao");
  assert.ok(geometry.walkFrom.path.length > 2);
});

test("one failed walk does not discard the successful Kakao bicycle and other walk routes", async (t) => {
  const input = routeInput(0.03);
  const { loadRouteGeometry } = await importFreshRouteGeometry();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async (_url, init) => {
    requestCount += 1;
    const request = parseRouteRequest(init);
    const startsAtOrigin =
      request.mode === "walk" &&
      request.coordinates[0][0] === input.origin[0] &&
      request.coordinates[0][1] === input.origin[1];
    return startsAtOrigin
      ? failedRouteResponse()
      : successfulRouteResponse(init);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const geometry = await loadRouteGeometry(input);

  assert.equal(requestCount, 3);
  assert.equal(geometry.walkTo.source, "direct");
  assert.equal(geometry.walkTo.path.length, 2);
  assert.equal(geometry.bike.source, "kakao");
  assert.ok(geometry.bike.path.length > 2);
  assert.deepEqual(geometry.bikeLegs.map((leg) => leg.source), ["kakao"]);
  assert.equal(geometry.walkFrom.source, "kakao");
  assert.ok(geometry.walkFrom.path.length > 2);
});

test("all failed requests return a complete direct fallback in finite time", async (t) => {
  const { loadRouteGeometry } = await importFreshRouteGeometry();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return failedRouteResponse();
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const geometry = await loadRouteGeometry(routeInput(0.05));

  assert.equal(requestCount, 3);
  assert.deepEqual(
    [geometry.walkTo.source, geometry.bike.source, geometry.walkFrom.source],
    ["direct", "direct", "direct"],
  );
  assert.deepEqual(geometry.bikeLegs.map((leg) => leg.source), ["direct"]);
  for (const segment of [geometry.walkTo, geometry.bike, geometry.walkFrom]) {
    assert.equal(segment.path.length, 2);
    assert.ok(Number.isFinite(segment.distanceMeters));
    assert.ok(Number.isFinite(segment.durationSeconds));
  }
});
