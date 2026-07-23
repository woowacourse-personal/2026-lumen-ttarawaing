export type LocationFocusDecision = {
  shouldFocus: boolean;
  nextHandledRequestId: number;
};

type CenterPreservingMap<TCenter> = {
  getCenter(): TCenter;
  relayout(): void;
  setCenter(center: TCenter): void;
};

export function consumeLocationFocusRequest(
  requestId: number,
  lastHandledRequestId: number,
  hasLocation: boolean,
): LocationFocusDecision {
  const normalizedRequestId = Math.max(0, Math.trunc(requestId));
  const normalizedHandledRequestId = Math.max(
    0,
    Math.trunc(lastHandledRequestId),
  );
  const shouldFocus =
    hasLocation && normalizedRequestId > normalizedHandledRequestId;

  return {
    shouldFocus,
    nextHandledRequestId: shouldFocus
      ? normalizedRequestId
      : normalizedHandledRequestId,
  };
}

function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

export function unwrapMapHeading(
  previousContinuousHeading: number | null,
  nextHeading: number,
) {
  const normalizedNextHeading = normalizeHeading(nextHeading);
  if (!Number.isFinite(previousContinuousHeading)) {
    return normalizedNextHeading;
  }

  const previous = Number(previousContinuousHeading);
  const delta =
    ((normalizedNextHeading - normalizeHeading(previous) + 540) % 360) - 180;
  return previous + delta;
}

export function getRotatingMapCanvasSide(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return 0;
  }
  return Math.ceil(Math.hypot(width, height));
}

export function updateMapPinchActive(
  previousActive: boolean,
  touchCount: number,
) {
  if (!Number.isFinite(touchCount) || touchCount < 0) {
    return previousActive;
  }
  if (touchCount >= 2) return true;
  if (touchCount === 0) return false;
  return previousActive;
}

export function shouldPrepareHeadingMapTouch(
  headingUp: boolean,
  touchCount: number,
) {
  return (
    headingUp &&
    Number.isFinite(touchCount) &&
    touchCount >= 1
  );
}

export function relayoutPreservingMapCenter<TCenter>(
  map: CenterPreservingMap<TCenter>,
) {
  const center = map.getCenter();
  map.relayout();
  map.setCenter(center);
}
