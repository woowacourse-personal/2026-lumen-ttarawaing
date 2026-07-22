import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateRouteGeometryMetrics,
  recommendPassTransferRoute,
} from "../app/pass-route-recommendation.ts";

const baseInput = {
  origin: [37.49, 126.89],
  startStation: [37.5, 126.9],
  endStation: [37.5, 127.1],
  destination: [37.51, 127.11],
};

const stations = [
  { id: "start", coordinates: baseInput.startStation, bikes: 4 },
  { id: "primary", coordinates: [37.5, 126.99], bikes: 3 },
  { id: "secondary", coordinates: [37.5, 127.01], bikes: null },
  { id: "third", coordinates: [37.5, 127.04], bikes: 8 },
  { id: "end", coordinates: baseInput.endStation, bikes: 2 },
];

function makeGeometry({
  totalBikeMinutes,
  legMinutes = [totalBikeMinutes],
  source = "kakao",
  transferStations = [],
}) {
  const bikePath = [
    baseInput.startStation,
    ...transferStations,
    baseInput.endStation,
  ];
  return {
    walkTo: {
      path: [baseInput.origin, baseInput.startStation],
      source: "kakao",
      distanceMeters: 120,
      durationSeconds: 120,
    },
    bike: {
      path: bikePath,
      source,
      distanceMeters: totalBikeMinutes * 250,
      durationSeconds: totalBikeMinutes * 60,
    },
    bikeLegs: legMinutes.map((minutes) => ({
      source,
      distanceMeters: minutes * 250,
      durationSeconds: minutes * 60,
    })),
    walkFrom: {
      path: [baseInput.endStation, baseInput.destination],
      source: "kakao",
      distanceMeters: 80,
      durationSeconds: 60,
    },
  };
}

test("첫 조합이 도로 검증에 실패해도 같은 경유 수의 다음 조합을 검증한다", async () => {
  const calls = [];
  const result = await recommendPassTransferRoute({
    baseInput,
    passType: "60",
    stations,
    startStationId: "start",
    endStationId: "end",
    loadGeometry: async (input) => {
      calls.push(input.transferStations ?? []);
      if (!input.transferStations) return makeGeometry({ totalBikeMinutes: 70 });
      if (input.transferStations[0][1] === 126.99) {
        return makeGeometry({
          totalBikeMinutes: 66,
          legMinutes: [56, 10],
          transferStations: input.transferStations,
        });
      }
      return makeGeometry({
        totalBikeMinutes: 62,
        legMinutes: [31, 31],
        transferStations: input.transferStations,
      });
    },
    selectStations: ({ excludedStationIds }) =>
      excludedStationIds.has("primary")
        ? [stations[2]]
        : [stations[1]],
  });

  assert.equal(result.status, "recommended");
  assert.deepEqual(result.transferStops.map(({ id }) => id), ["secondary"]);
  assert.equal(calls.length, 3);
});

test("첫 조합의 경로 요청 자체가 실패해도 같은 경유 수의 다음 조합을 시도한다", async () => {
  let candidateCallCount = 0;
  const result = await recommendPassTransferRoute({
    baseInput,
    passType: "60",
    stations,
    startStationId: "start",
    endStationId: "end",
    loadGeometry: async (input) => {
      if (!input.transferStations) return makeGeometry({ totalBikeMinutes: 70 });
      candidateCallCount += 1;
      if (candidateCallCount === 1) throw new Error("mock route failure");
      return makeGeometry({
        totalBikeMinutes: 60,
        legMinutes: [30, 30],
        transferStations: input.transferStations,
      });
    },
    selectStations: ({ excludedStationIds }) =>
      excludedStationIds.has("primary")
        ? [stations[2]]
        : [stations[1]],
  });

  assert.equal(result.status, "recommended");
  assert.equal(candidateCallCount, 2);
  assert.deepEqual(result.transferStops.map(({ id }) => id), ["secondary"]);
});

test("이론상 최소 경유 수부터 시작하고 안전하면 더 많은 경유를 찾지 않는다", async () => {
  const requestedStopCounts = [];
  const result = await recommendPassTransferRoute({
    baseInput,
    passType: "60",
    stations,
    startStationId: "start",
    endStationId: "end",
    loadGeometry: async (input) =>
      input.transferStations
        ? makeGeometry({
            totalBikeMinutes: 108,
            legMinutes: [36, 36, 36],
            transferStations: input.transferStations,
          })
        : makeGeometry({ totalBikeMinutes: 110.01 }),
    selectStations: ({ stopCount }) => {
      requestedStopCounts.push(stopCount);
      return stopCount === 2 ? [stations[1], stations[3]] : [];
    },
  });

  assert.equal(result.status, "recommended");
  assert.deepEqual(result.transferStops.map(({ id }) => id), ["primary", "third"]);
  assert.deepEqual(requestedStopCounts, [2]);
});

test("적합한 후보가 없으면 검증되지 않은 기본 경로를 안전하다고 표시하지 않는다", async () => {
  let loadCount = 0;
  const result = await recommendPassTransferRoute({
    baseInput,
    passType: "60",
    stations,
    startStationId: "start",
    endStationId: "end",
    loadGeometry: async () => {
      loadCount += 1;
      return makeGeometry({ totalBikeMinutes: 70 });
    },
    selectStations: () => [],
  });

  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.transferStops, []);
  assert.equal(loadCount, 1);
});

test("상관 없음은 긴 기본 경로에도 이용권 경유를 추가하지 않는다", async () => {
  let loadCount = 0;
  const result = await recommendPassTransferRoute({
    baseInput,
    passType: "none",
    stations,
    startStationId: "start",
    endStationId: "end",
    loadGeometry: async () => {
      loadCount += 1;
      return makeGeometry({ totalBikeMinutes: 500 });
    },
  });

  assert.equal(result.status, "not-needed");
  assert.deepEqual(result.transferStops, []);
  assert.equal(loadCount, 1);
});

test("직선 폴백만 남으면 제한 이용권에 안전한 경로라고 표시하지 않는다", async () => {
  const result = await recommendPassTransferRoute({
    baseInput,
    passType: "60",
    stations,
    startStationId: "start",
    endStationId: "end",
    loadGeometry: async () =>
      makeGeometry({ totalBikeMinutes: 20, source: "direct" }),
  });

  assert.equal(result.status, "unavailable");
});

test("0대로 확인된 대여소는 반납 후 재대여 경유 후보에서 제외한다", async () => {
  const emptyStation = {
    id: "empty",
    coordinates: [37.5, 126.98],
    bikes: 0,
  };
  const result = await recommendPassTransferRoute({
    baseInput,
    passType: "60",
    stations: [...stations, emptyStation],
    startStationId: "start",
    endStationId: "end",
    loadGeometry: async (input) =>
      input.transferStations
        ? makeGeometry({
            totalBikeMinutes: 60,
            legMinutes: [30, 30],
            transferStations: input.transferStations,
          })
        : makeGeometry({ totalBikeMinutes: 70 }),
    selectStations: ({ stations: candidates }) => {
      assert.equal(candidates.some(({ id }) => id === "empty"), false);
      return [candidates.find(({ id }) => id === "third")];
    },
  });

  assert.equal(result.status, "recommended");
  assert.deepEqual(result.transferStops.map(({ id }) => id), ["third"]);
});

test("기본 도로 경로를 후보 탐색 전에 전달해 제한시간 폴백에 보존할 수 있다", async () => {
  let capturedBaseGeometry;
  const result = await recommendPassTransferRoute({
    baseInput,
    passType: "60",
    stations,
    startStationId: "start",
    endStationId: "end",
    loadGeometry: async () => makeGeometry({ totalBikeMinutes: 20 }),
    onBaseGeometry: (geometry) => {
      capturedBaseGeometry = geometry;
    },
  });

  assert.equal(capturedBaseGeometry?.bike.source, "kakao");
  assert.equal(capturedBaseGeometry, result.geometry);
});

test("경유당 3분을 총 소요시간에 정확히 더한다", () => {
  const geometry = makeGeometry({ totalBikeMinutes: 10 });
  const noTransfer = calculateRouteGeometryMetrics(geometry, 0);
  const twoTransfers = calculateRouteGeometryMetrics(geometry, 2);

  assert.equal(noTransfer.totalMinutes, 13);
  assert.equal(twoTransfers.totalMinutes, 19);
  assert.equal(twoTransfers.totalMinutes - noTransfer.totalMinutes, 6);
});

test("이미 취소된 추천은 경로 요청을 시작하지 않는다", async () => {
  const controller = new AbortController();
  controller.abort();
  let loadCount = 0;

  await assert.rejects(
    recommendPassTransferRoute({
      baseInput,
      passType: "60",
      stations,
      startStationId: "start",
      endStationId: "end",
      signal: controller.signal,
      loadGeometry: async () => {
        loadCount += 1;
        return makeGeometry({ totalBikeMinutes: 20 });
      },
    }),
    { name: "AbortError" },
  );
  assert.equal(loadCount, 0);
});
