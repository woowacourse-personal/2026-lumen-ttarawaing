import assert from "node:assert/strict";
import test from "node:test";

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
};

async function importWorker(label) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(
    "test",
    `kakao-routes-${label}-${process.pid}-${Date.now()}-${Math.random()}`,
  );
  return (await import(workerUrl.href)).default;
}

function routeRequest(body, init = {}) {
  return new Request("http://localhost/api/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });
}

test("proxies walking coordinates to the public Kakao route endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const upstreamPayload =
    '{"status":"OK","route":{"properties":{"totalDistance":123}}}';
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://dapi.kakao.com");
    assert.equal(url.pathname, "/v2/routing/walk");
    assert.equal(url.searchParams.get("start_x"), "127.1");
    assert.equal(url.searchParams.get("start_y"), "37.1");
    assert.equal(url.searchParams.get("via_x"), "127.2");
    assert.equal(url.searchParams.get("via_y"), "37.2");
    assert.equal(url.searchParams.get("end_x"), "127.3");
    assert.equal(url.searchParams.get("end_y"), "37.3");
    assert.equal(url.searchParams.has("route_mode"), false);
    assert.equal(init?.method, "GET");
    assert.equal(init?.headers?.Authorization, "KakaoAK test-rest-key");
    assert.equal(init?.body, undefined);
    assert.equal(init?.signal instanceof AbortSignal, true);
    return new Response(upstreamPayload, {
      headers: { "Content-Type": "application/json;charset=UTF-8" },
    });
  };

  try {
    const worker = await importWorker("walk");
    const response = await worker.fetch(
      routeRequest({
        mode: "walk",
        coordinates: [
          [37.1, 127.1],
          [37.2, 127.2],
          [37.3, 127.3],
        ],
      }),
      { KAKAO_REST_API_KEY: "test-rest-key" },
      ctx,
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), upstreamPayload);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-type") ?? "", /application\/json/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards five bicycle waypoints and the whitelisted route mode", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/v2/routing/bicycle");
    assert.equal(url.searchParams.get("via_x"), "127.2,127.3,127.4,127.5,127.6");
    assert.equal(url.searchParams.get("via_y"), "37.2,37.3,37.4,37.5,37.6");
    assert.equal(url.searchParams.get("route_mode"), "BIKE_ONLY");
    assert.equal(init?.headers?.Authorization, "KakaoAK test-rest-key");
    return Response.json({ status: "OK", route: { legs: [] } });
  };

  try {
    const worker = await importWorker("bike");
    const response = await worker.fetch(
      routeRequest({
        mode: "bike",
        bikeRouteMode: "BIKE_ONLY",
        coordinates: [
          [37.1, 127.1],
          [37.2, 127.2],
          [37.3, 127.3],
          [37.4, 127.4],
          [37.5, 127.5],
          [37.6, 127.6],
          [37.7, 127.7],
        ],
      }),
      { KAKAO_REST_API_KEY: "test-rest-key" },
      ctx,
    );

    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects non-whitelisted and invalid route payloads before calling Kakao", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return Response.json({ status: "OK" });
  };

  const invalidBodies = [
    {
      mode: "walk",
      coordinates: [[37.1, 127.1], [37.2, 127.2]],
      priority: "SHORTEST",
    },
    { mode: "car", coordinates: [[37.1, 127.1], [37.2, 127.2]] },
    { mode: "walk", coordinates: [[37.1, 127.1]] },
    {
      mode: "bike",
      coordinates: Array.from({ length: 8 }, (_, index) => [37, 127 + index / 10]),
    },
    { mode: "walk", coordinates: [[91, 127.1], [37.2, 127.2]] },
    {
      mode: "bike",
      bikeRouteMode: "MAIN_STREET",
      coordinates: [[37.1, 127.1], [37.2, 127.2]],
    },
  ];

  try {
    const worker = await importWorker("validation");
    for (const body of invalidBodies) {
      const response = await worker.fetch(
        routeRequest(body),
        { KAKAO_REST_API_KEY: "test-rest-key" },
        ctx,
      );
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, "INVALID_REQUEST");
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requires POST and a configured Kakao REST key", async () => {
  const worker = await importWorker("method-key");
  const methodResponse = await worker.fetch(
    new Request("http://localhost/api/routes"),
    {},
    ctx,
  );
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get("allow"), "POST");

  const keyResponse = await worker.fetch(
    routeRequest({
      mode: "walk",
      coordinates: [[37.1, 127.1], [37.2, 127.2]],
    }),
    {},
    ctx,
  );
  assert.equal(keyResponse.status, 503);
  assert.equal((await keyResponse.json()).code, "ROUTE_PROVIDER_NOT_CONFIGURED");
});

test("normalizes Kakao HTTP failures without exposing the upstream body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      { code: -10, msg: "upstream details must stay private" },
      { status: 400 },
    );

  try {
    const worker = await importWorker("upstream-error");
    const response = await worker.fetch(
      routeRequest({
        mode: "bike",
        bikeRouteMode: "SHORTEST",
        coordinates: [[37.1, 127.1], [37.2, 127.2]],
      }),
      { KAKAO_REST_API_KEY: "test-rest-key" },
      ctx,
    );

    assert.equal(response.status, 503);
    const text = await response.text();
    assert.match(text, /ROUTE_PROVIDER_QUOTA_EXCEEDED/);
    assert.doesNotMatch(text, /upstream details/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("aborts a stalled Kakao request at the route deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const originalFetch = globalThis.fetch;
  let notifyFetchStarted;
  const fetchStarted = new Promise((resolve) => {
    notifyFetchStarted = resolve;
  });
  let upstreamWasAborted = false;
  globalThis.fetch = async (_input, init) => {
    notifyFetchStarted();
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener(
        "abort",
        () => {
          upstreamWasAborted = true;
          reject(init.signal.reason);
        },
        { once: true },
      );
    });
  };

  try {
    const worker = await importWorker("timeout");
    const pendingResponse = worker.fetch(
      routeRequest({
        mode: "walk",
        coordinates: [[37.1, 127.1], [37.2, 127.2]],
      }),
      { KAKAO_REST_API_KEY: "test-rest-key" },
      ctx,
    );
    await fetchStarted;
    t.mock.timers.tick(10_000);

    const response = await pendingResponse;
    assert.equal(response.status, 504);
    assert.equal((await response.json()).code, "ROUTE_PROVIDER_TIMEOUT");
    assert.equal(upstreamWasAborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
