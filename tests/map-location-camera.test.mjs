import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeLocationFocusRequest,
  getRotatingMapCanvasSide,
  relayoutPreservingMapCenter,
  shouldPrepareHeadingMapTouch,
  updateMapPinchActive,
  unwrapMapHeading,
} from "../app/map-location-camera.ts";

test("첫 위치 버튼 요청은 첫 GPS 좌표에서 정확히 한 번만 소비한다", () => {
  const pending = consumeLocationFocusRequest(1, 0, false);
  assert.deepEqual(pending, {
    shouldFocus: false,
    nextHandledRequestId: 0,
  });

  const firstFix = consumeLocationFocusRequest(1, 0, true);
  assert.deepEqual(firstFix, {
    shouldFocus: true,
    nextHandledRequestId: 1,
  });

  assert.equal(consumeLocationFocusRequest(1, 1, true).shouldFocus, false);
});

test("연속 GPS 갱신은 같은 요청으로 지도를 다시 포커스하지 않는다", () => {
  let handledRequestId = 1;
  for (let index = 0; index < 5; index += 1) {
    const decision = consumeLocationFocusRequest(1, handledRequestId, true);
    assert.equal(decision.shouldFocus, false);
    handledRequestId = decision.nextHandledRequestId;
  }
});

test("현재 위치 버튼을 다시 누르면 새 요청만 한 번 포커스한다", () => {
  const secondClick = consumeLocationFocusRequest(2, 1, true);
  assert.equal(secondClick.shouldFocus, true);
  assert.equal(secondClick.nextHandledRequestId, 2);
  assert.equal(consumeLocationFocusRequest(2, 2, true).shouldFocus, false);
});

test("지도 제공자가 바뀌어도 이미 소비한 위치 요청은 다시 실행하지 않는다", () => {
  const kakaoDecision = consumeLocationFocusRequest(3, 2, true);
  assert.equal(kakaoDecision.shouldFocus, true);

  const leafletDecision = consumeLocationFocusRequest(
    3,
    kakaoDecision.nextHandledRequestId,
    true,
  );
  assert.equal(leafletDecision.shouldFocus, false);
  assert.equal(leafletDecision.nextHandledRequestId, 3);
});

test("방향 각도는 북쪽 경계에서 가장 짧은 방향으로 연속화한다", () => {
  assert.equal(unwrapMapHeading(null, 359), 359);
  assert.equal(unwrapMapHeading(359, 1), 361);
  assert.equal(unwrapMapHeading(1, 359), -1);
  assert.equal(unwrapMapHeading(721, 2), 722);
});

test("회전 지도 캔버스는 뷰포트 대각선 크기로 모서리 공백을 막는다", () => {
  assert.equal(getRotatingMapCanvasSide(320, 312), 447);
  assert.equal(getRotatingMapCanvasSide(768, 450), 891);
  assert.equal(getRotatingMapCanvasSide(0, 450), 0);
  assert.equal(getRotatingMapCanvasSide(Number.NaN, 450), 0);
});

test("핀치 상태는 두 손가락부터 시작하고 모든 손가락을 뗄 때 끝난다", () => {
  assert.equal(updateMapPinchActive(false, 1), false);
  assert.equal(updateMapPinchActive(false, 2), true);
  assert.equal(updateMapPinchActive(false, 3), true);
  assert.equal(updateMapPinchActive(true, 1), true);
  assert.equal(updateMapPinchActive(true, 0), false);
  assert.equal(updateMapPinchActive(false, Number.NaN), false);
  assert.equal(updateMapPinchActive(false, -1), false);
});

test("방향 보기 지도는 SDK가 첫 터치 좌표를 기록하기 전에 준비한다", () => {
  assert.equal(shouldPrepareHeadingMapTouch(true, 1), true);
  assert.equal(shouldPrepareHeadingMapTouch(true, 2), true);
  assert.equal(shouldPrepareHeadingMapTouch(false, 1), false);
  assert.equal(shouldPrepareHeadingMapTouch(true, 0), false);
  assert.equal(shouldPrepareHeadingMapTouch(true, Number.NaN), false);
  assert.equal(shouldPrepareHeadingMapTouch(true, -1), false);
});

test("지도 컨테이너를 다시 배치해도 기존 지리적 중심을 복원한다", () => {
  const center = { latitude: 37.544, longitude: 127.037 };
  const calls = [];

  relayoutPreservingMapCenter({
    getCenter() {
      calls.push(["get-center"]);
      return center;
    },
    relayout() {
      calls.push(["relayout"]);
    },
    setCenter(nextCenter) {
      calls.push(["set-center", nextCenter]);
    },
  });

  assert.deepEqual(calls, [
    ["get-center"],
    ["relayout"],
    ["set-center", center],
  ]);
});
