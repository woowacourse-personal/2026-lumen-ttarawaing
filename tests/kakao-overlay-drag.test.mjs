import assert from "node:assert/strict";
import test from "node:test";
import {
  getDraggedOverlayPoint,
  hasMeaningfulOverlayDrag,
} from "../app/kakao-overlay-drag.ts";

test("moves a Kakao custom overlay by the same pointer delta", () => {
  assert.deepEqual(
    getDraggedOverlayPoint(
      { x: 320, y: 180 },
      { x: 100, y: 200 },
      { x: 142, y: 169 },
    ),
    { x: 362, y: 149 },
  );
});

test("keeps a long drag independent of intermediate pointer events", () => {
  const startOverlayPoint = { x: 320.25, y: 180.75 };
  const startPointer = { x: 100, y: 200 };
  const sampledPointerEvents = Array.from({ length: 1_500 }, (_, index) => ({
    x: 100 + ((index + 1) * 600) / 1_500,
    y: 200 + ((index + 1) * 420) / 1_500,
  }));

  const sampledResult = sampledPointerEvents
    .map((currentPointer) =>
      getDraggedOverlayPoint(
        startOverlayPoint,
        startPointer,
        currentPointer,
      ),
    )
    .at(-1);
  const oneMoveResult = getDraggedOverlayPoint(
    startOverlayPoint,
    startPointer,
    { x: 700, y: 620 },
  );

  assert.deepEqual(sampledResult, oneMoveResult);
  assert.deepEqual(oneMoveResult, { x: 920.25, y: 600.75 });
});

test("distinguishes a drag from a tap", () => {
  assert.equal(
    hasMeaningfulOverlayDrag({ x: 10, y: 10 }, { x: 12, y: 12 }),
    false,
  );
  assert.equal(
    hasMeaningfulOverlayDrag({ x: 10, y: 10 }, { x: 15, y: 10 }),
    false,
  );
  assert.equal(
    hasMeaningfulOverlayDrag({ x: 10, y: 10 }, { x: 16, y: 10 }),
    true,
  );
});
