import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlannedRouteLegs,
  createRouteProgressState,
  getActivePlannedRouteLeg,
  updateRouteProgress,
} from "../app/route-progress.ts";

const startStation = {
  id: "start",
  name: "출발 대여소",
  coordinates: [37.5, 127.001],
};
const firstTransfer = {
  id: "transfer-1",
  name: "첫 경유 대여소",
  coordinates: [37.5, 127.002],
};
const secondTransfer = {
  id: "transfer-2",
  name: "둘째 경유 대여소",
  coordinates: [37.5, 127.003],
};
const endStation = {
  id: "end",
  name: "반납 대여소",
  coordinates: [37.5, 127.004],
};
const destination = {
  id: "destination",
  name: "최종 목적지",
  coordinates: [37.5, 127.005],
};

function geometryWithTransfers() {
  return {
    walkTo: {
      path: [[37.5, 127], startStation.coordinates],
      source: "osrm",
      distanceMeters: 720,
      durationSeconds: 540,
    },
    bike: {
      path: [
        startStation.coordinates,
        firstTransfer.coordinates,
        secondTransfer.coordinates,
        endStation.coordinates,
      ],
      source: "osrm",
      distanceMeters: 3_900,
      durationSeconds: 1_200,
    },
    bikeLegs: [
      { source: "osrm", distanceMeters: 1_000, durationSeconds: 300 },
      { source: "osrm", distanceMeters: 1_200, durationSeconds: 360 },
      { source: "osrm", distanceMeters: 1_700, durationSeconds: 540 },
    ],
    walkFrom: {
      path: [endStation.coordinates, destination.coordinates],
      source: "osrm",
      distanceMeters: 540,
      durationSeconds: 420,
    },
  };
}

function buildLegs() {
  return buildPlannedRouteLegs({
    geometry: geometryWithTransfers(),
    startStation,
    transferStations: [firstTransfer, secondTransfer],
    endStation,
    destination,
  });
}

function fixAt(target, timestamp, accuracyMeters = 10) {
  return { coordinates: target.coordinates, accuracyMeters, timestamp };
}

function confirmArrival(state, routeKey, legs, target, timestamp) {
  const first = updateRouteProgress({
    state,
    routeKey,
    legs,
    fix: fixAt(target, timestamp),
    enabled: true,
  });
  return updateRouteProgress({
    state: first,
    routeKey,
    legs,
    fix: fixAt(target, timestamp + 2_000),
    enabled: true,
  });
}

function initializeAtOrigin(state, routeKey, legs, timestamp = 0) {
  return updateRouteProgress({
    state,
    routeKey,
    legs,
    fix: {
      coordinates: [37.5, 127],
      accuracyMeters: 10,
      timestamp,
    },
    enabled: true,
  });
}

test("builds the ordered next-stop sequence with fixed planned leg distances", () => {
  const legs = buildLegs();

  assert.deepEqual(
    legs.map(({ targetKind, target, plannedDistanceMeters }) => ({
      targetKind,
      targetId: target.id,
      plannedDistanceMeters,
    })),
    [
      {
        targetKind: "start-station",
        targetId: "start",
        plannedDistanceMeters: 720,
      },
      {
        targetKind: "transfer-station",
        targetId: "transfer-1",
        plannedDistanceMeters: 1_000,
      },
      {
        targetKind: "transfer-station",
        targetId: "transfer-2",
        plannedDistanceMeters: 1_200,
      },
      {
        targetKind: "end-station",
        targetId: "end",
        plannedDistanceMeters: 1_700,
      },
      {
        targetKind: "destination",
        targetId: "destination",
        plannedDistanceMeters: 540,
      },
    ],
  );
});

test("defaults to the start station without GPS and keeps its full segment distance", () => {
  const routeKey = "route-a";
  const legs = buildLegs();
  const state = createRouteProgressState("no-route");

  const active = getActivePlannedRouteLeg(legs, state, routeKey);
  assert.equal(active?.target.id, "start");
  assert.equal(active?.plannedDistanceMeters, 720);
});

test("advances one target at a time only after two reliable arrival fixes", () => {
  const routeKey = "route-a";
  const legs = buildLegs();
  let state = initializeAtOrigin(
    createRouteProgressState(routeKey),
    routeKey,
    legs,
  );

  state = updateRouteProgress({
    state,
    routeKey,
    legs,
    fix: fixAt(startStation, 1_000),
    enabled: true,
  });
  assert.equal(getActivePlannedRouteLeg(legs, state, routeKey)?.target.id, "start");
  state = updateRouteProgress({
    state,
    routeKey,
    legs,
    fix: fixAt(startStation, 2_000),
    enabled: true,
  });
  assert.equal(getActivePlannedRouteLeg(legs, state, routeKey)?.target.id, "start");
  state = updateRouteProgress({
    state,
    routeKey,
    legs,
    fix: fixAt(startStation, 3_000),
    enabled: true,
  });
  assert.equal(getActivePlannedRouteLeg(legs, state, routeKey)?.target.id, "transfer-1");

  state = confirmArrival(state, routeKey, legs, firstTransfer, 4_000);
  assert.equal(getActivePlannedRouteLeg(legs, state, routeKey)?.target.id, "transfer-2");

  state = confirmArrival(state, routeKey, legs, secondTransfer, 7_000);
  assert.equal(getActivePlannedRouteLeg(legs, state, routeKey)?.target.id, "end");

  state = confirmArrival(state, routeKey, legs, endStation, 10_000);
  assert.equal(
    getActivePlannedRouteLeg(legs, state, routeKey)?.target.id,
    "destination",
  );
  assert.equal(
    getActivePlannedRouteLeg(legs, state, routeKey)?.plannedDistanceMeters,
    540,
  );

  state = updateRouteProgress({
    state,
    routeKey,
    legs,
    fix: fixAt(destination, 14_000),
    enabled: true,
  });
  assert.equal(
    getActivePlannedRouteLeg(legs, state, routeKey)?.target.id,
    "destination",
  );
  assert.equal(
    getActivePlannedRouteLeg(legs, state, routeKey)?.plannedDistanceMeters,
    540,
  );
});

test("keeps the planned segment distance fixed while GPS moves within a leg", () => {
  const routeKey = "route-a";
  const legs = buildLegs();
  let state = createRouteProgressState(routeKey);

  for (const [coordinates, timestamp] of [
    [[37.5, 127.0001], 1_000],
    [[37.5, 127.0005], 3_000],
  ]) {
    state = updateRouteProgress({
      state,
      routeKey,
      legs,
      fix: { coordinates, accuracyMeters: 10, timestamp },
      enabled: true,
    });
    const active = getActivePlannedRouteLeg(legs, state, routeKey);
    assert.equal(active?.target.id, "start");
    assert.equal(active?.plannedDistanceMeters, 720);
  }
});

test("bootstraps the next target from the first reliable on-route GPS fix", () => {
  const routeKey = "route-a";
  const legs = buildLegs();
  const state = updateRouteProgress({
    state: createRouteProgressState(routeKey),
    routeKey,
    legs,
    fix: {
      coordinates: [37.5, 127.0025],
      accuracyMeters: 10,
      timestamp: 1_000,
    },
    enabled: true,
  });

  assert.equal(
    getActivePlannedRouteLeg(legs, state, routeKey)?.target.id,
    "transfer-2",
  );
  assert.equal(
    getActivePlannedRouteLeg(legs, state, routeKey)?.plannedDistanceMeters,
    1_200,
  );
});

test("chooses the earlier target when first-fix route legs share an endpoint", () => {
  const routeKey = "route-a";
  const legs = buildLegs();
  const state = updateRouteProgress({
    state: createRouteProgressState(routeKey),
    routeKey,
    legs,
    fix: fixAt(startStation, 1_000),
    enabled: true,
  });

  assert.equal(getActivePlannedRouteLeg(legs, state, routeKey)?.target.id, "start");
  assert.equal(
    getActivePlannedRouteLeg(legs, state, routeKey)?.plannedDistanceMeters,
    720,
  );
});

test("does not skip to a nearby future stop or trust inaccurate fixes", () => {
  const routeKey = "route-a";
  const legs = buildLegs();
  let state = initializeAtOrigin(
    createRouteProgressState(routeKey),
    routeKey,
    legs,
  );

  state = confirmArrival(state, routeKey, legs, secondTransfer, 1_000);
  assert.equal(getActivePlannedRouteLeg(legs, state, routeKey)?.target.id, "start");

  state = updateRouteProgress({
    state,
    routeKey,
    legs,
    fix: fixAt(startStation, 5_000, 150),
    enabled: true,
  });
  state = updateRouteProgress({
    state,
    routeKey,
    legs,
    fix: fixAt(startStation, 8_000, 150),
    enabled: true,
  });
  assert.equal(getActivePlannedRouteLeg(legs, state, routeKey)?.target.id, "start");
});

test("resets progress when the route target sequence changes", () => {
  const legs = buildLegs();
  const progressed = confirmArrival(
    initializeAtOrigin(
      createRouteProgressState("route-a"),
      "route-a",
      legs,
    ),
    "route-a",
    legs,
    startStation,
    1_000,
  );
  assert.equal(progressed.activeLegIndex, 1);

  const reset = updateRouteProgress({
    state: progressed,
    routeKey: "route-b",
    legs,
    fix: null,
    enabled: true,
  });
  assert.equal(reset.activeLegIndex, 0);
  assert.equal(getActivePlannedRouteLeg(legs, reset, "route-b")?.target.id, "start");
});

test("starts from the first leg when the same route opens in a new session", () => {
  const legs = buildLegs();
  const progressed = confirmArrival(
    initializeAtOrigin(
      createRouteProgressState("same-route|session:1"),
      "same-route|session:1",
      legs,
    ),
    "same-route|session:1",
    legs,
    startStation,
    1_000,
  );
  assert.equal(progressed.activeLegIndex, 1);

  const restarted = getActivePlannedRouteLeg(
    legs,
    progressed,
    "same-route|session:2",
  );
  assert.equal(restarted?.target.id, "start");
  assert.equal(restarted?.plannedDistanceMeters, 720);
});

test("uses one bike leg directly to the return station when there are no transfers", () => {
  const geometry = geometryWithTransfers();
  geometry.bikeLegs = [
    { source: "osrm", distanceMeters: 3_900, durationSeconds: 1_200 },
  ];
  const legs = buildPlannedRouteLegs({
    geometry,
    startStation,
    transferStations: [],
    endStation,
    destination,
  });

  assert.deepEqual(
    legs.map(({ targetKind, plannedDistanceMeters }) => ({
      targetKind,
      plannedDistanceMeters,
    })),
    [
      { targetKind: "start-station", plannedDistanceMeters: 720 },
      { targetKind: "end-station", plannedDistanceMeters: 3_900 },
      { targetKind: "destination", plannedDistanceMeters: 540 },
    ],
  );
});
