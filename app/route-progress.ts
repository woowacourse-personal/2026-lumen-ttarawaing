import type { Coordinates, RouteGeometry } from "./route-geometry";

export type RouteProgressTarget = {
  id: string;
  name: string;
  coordinates: Coordinates;
};

export type PlannedRouteTargetKind =
  | "start-station"
  | "transfer-station"
  | "end-station"
  | "destination";

export type PlannedRouteLeg = {
  id: string;
  mode: "walk" | "bike";
  targetKind: PlannedRouteTargetKind;
  target: RouteProgressTarget;
  path: readonly Coordinates[];
  plannedDistanceMeters: number;
};

export type RouteLocationFix = {
  coordinates: Coordinates;
  accuracyMeters: number;
  timestamp: number;
};

export type RouteProgressState = {
  routeKey: string;
  activeLegIndex: number;
  hasReliableFix: boolean;
  arrivalFixCount: number;
  arrivalCandidateSince: number | null;
  lastFixTimestamp: number | null;
};

export const MAX_RELIABLE_LOCATION_ACCURACY_METERS = 80;
export const MIN_ROUTE_ARRIVAL_RADIUS_METERS = 35;
export const MAX_ROUTE_ARRIVAL_RADIUS_METERS = 60;
export const ROUTE_ARRIVAL_REQUIRED_FIXES = 2;
export const ROUTE_ARRIVAL_DWELL_MS = 1_500;
export const ROUTE_BOOTSTRAP_CORRIDOR_METERS = 120;

function finiteDistance(value: number, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function distanceMeters(a: Coordinates, b: Coordinates) {
  const radius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLatitude = toRadians(b[0] - a[0]);
  const deltaLongitude = toRadians(b[1] - a[1]);
  const latitudeA = toRadians(a[0]);
  const latitudeB = toRadians(b[0]);
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(deltaLongitude / 2) ** 2;
  return (
    radius *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)))
  );
}

function distanceToPathSegment(
  coordinate: Coordinates,
  from: Coordinates,
  to: Coordinates,
) {
  const radius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const referenceLatitude = toRadians(
    (coordinate[0] + from[0] + to[0]) / 3,
  );
  const longitudeScale = Math.max(0.01, Math.cos(referenceLatitude));
  const toLocal = (point: Coordinates) => ({
    x: toRadians(point[1] - from[1]) * radius * longitudeScale,
    y: toRadians(point[0] - from[0]) * radius,
  });
  const end = toLocal(to);
  const point = toLocal(coordinate);
  const squaredLength = end.x ** 2 + end.y ** 2;
  const ratio =
    squaredLength > 0
      ? Math.max(
          0,
          Math.min(1, (point.x * end.x + point.y * end.y) / squaredLength),
        )
      : 0;
  return Math.hypot(point.x - end.x * ratio, point.y - end.y * ratio);
}

function distanceToPath(
  coordinate: Coordinates,
  path: readonly Coordinates[],
) {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return distanceMeters(coordinate, path[0]);
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.length; index += 1) {
    closestDistance = Math.min(
      closestDistance,
      distanceToPathSegment(coordinate, path[index - 1], path[index]),
    );
  }
  return closestDistance;
}

function splitPathAtTargets(
  path: readonly Coordinates[],
  targets: readonly RouteProgressTarget[],
) {
  if (targets.length === 0) return [];
  if (path.length === 0) {
    return targets.map((target) => [target.coordinates]);
  }

  const legs: Coordinates[][] = [];
  let startIndex = 0;
  for (const target of targets) {
    let targetIndex = startIndex;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let index = startIndex; index < path.length; index += 1) {
      const candidateDistance = distanceMeters(path[index], target.coordinates);
      if (candidateDistance < closestDistance) {
        closestDistance = candidateDistance;
        targetIndex = index;
      }
    }
    const legPath = path.slice(startIndex, targetIndex + 1);
    legs.push(
      legPath.length > 0
        ? legPath.map(
            ([latitude, longitude]) => [latitude, longitude] as Coordinates,
          )
        : [target.coordinates],
    );
    startIndex = targetIndex;
  }
  return legs;
}

export function inferInitialRouteLegIndex(
  legs: readonly PlannedRouteLeg[],
  fix: RouteLocationFix,
): number | null {
  if (legs.length === 0) return null;
  const pathDistances = legs.map((leg) =>
    distanceToPath(fix.coordinates, leg.path),
  );
  const closestDistance = Math.min(...pathDistances);
  const corridorLimit = Math.min(
    ROUTE_BOOTSTRAP_CORRIDOR_METERS,
    Math.max(40, fix.accuracyMeters * 1.5),
  );
  if (closestDistance > corridorLimit) return null;

  const ambiguityMargin = Math.max(
    10,
    Math.min(
      MAX_RELIABLE_LOCATION_ACCURACY_METERS,
      fix.accuracyMeters,
    ),
  );
  return pathDistances.findIndex(
    (pathDistance) => pathDistance <= closestDistance + ambiguityMargin,
  );
}

export function buildPlannedRouteLegs(input: {
  geometry: RouteGeometry;
  startStation: RouteProgressTarget;
  transferStations: readonly RouteProgressTarget[];
  endStation: RouteProgressTarget;
  destination: RouteProgressTarget;
}): PlannedRouteLeg[] {
  const bikeTargets = [
    ...input.transferStations.map((target) => ({
      target,
      targetKind: "transfer-station" as const,
    })),
    { target: input.endStation, targetKind: "end-station" as const },
  ];
  const fallbackBikeDistance =
    finiteDistance(input.geometry.bike.distanceMeters) /
    Math.max(1, bikeTargets.length);
  const bikeLegPaths = splitPathAtTargets(
    input.geometry.bike.path,
    bikeTargets.map(({ target }) => target),
  );

  return [
    {
      id: `walk:${input.startStation.id}`,
      mode: "walk",
      targetKind: "start-station",
      target: input.startStation,
      path: input.geometry.walkTo.path,
      plannedDistanceMeters: finiteDistance(input.geometry.walkTo.distanceMeters),
    },
    ...bikeTargets.map(({ target, targetKind }, index) => ({
      id: `bike:${target.id}`,
      mode: "bike" as const,
      targetKind,
      target,
      path: bikeLegPaths[index] ?? [target.coordinates],
      plannedDistanceMeters: finiteDistance(
        input.geometry.bikeLegs[index]?.distanceMeters,
        fallbackBikeDistance,
      ),
    })),
    {
      id: `walk:${input.destination.id}`,
      mode: "walk",
      targetKind: "destination",
      target: input.destination,
      path: input.geometry.walkFrom.path,
      plannedDistanceMeters: finiteDistance(input.geometry.walkFrom.distanceMeters),
    },
  ];
}

export function createRouteProgressState(routeKey: string): RouteProgressState {
  return {
    routeKey,
    activeLegIndex: 0,
    hasReliableFix: false,
    arrivalFixCount: 0,
    arrivalCandidateSince: null,
    lastFixTimestamp: null,
  };
}

function resetArrivalCandidate(
  state: RouteProgressState,
  lastFixTimestamp: number | null,
): RouteProgressState {
  if (
    state.arrivalFixCount === 0 &&
    state.arrivalCandidateSince === null &&
    state.lastFixTimestamp === lastFixTimestamp
  ) {
    return state;
  }
  return {
    ...state,
    arrivalFixCount: 0,
    arrivalCandidateSince: null,
    lastFixTimestamp,
  };
}

export function updateRouteProgress(input: {
  state: RouteProgressState;
  routeKey: string;
  legs: readonly PlannedRouteLeg[];
  fix: RouteLocationFix | null;
  enabled: boolean;
}): RouteProgressState {
  const state =
    input.state.routeKey === input.routeKey
      ? input.state
      : createRouteProgressState(input.routeKey);
  if (!input.enabled || input.legs.length === 0 || !input.fix) return state;

  const { fix } = input;
  if (
    !Number.isFinite(fix.coordinates[0]) ||
    !Number.isFinite(fix.coordinates[1]) ||
    !Number.isFinite(fix.accuracyMeters) ||
    fix.accuracyMeters < 0 ||
    fix.accuracyMeters > MAX_RELIABLE_LOCATION_ACCURACY_METERS ||
    !Number.isFinite(fix.timestamp) ||
    (state.lastFixTimestamp !== null && fix.timestamp <= state.lastFixTimestamp)
  ) {
    return state;
  }

  if (!state.hasReliableFix) {
    const inferredLegIndex = inferInitialRouteLegIndex(input.legs, fix);
    if (inferredLegIndex === null) {
      return { ...state, lastFixTimestamp: fix.timestamp };
    }
    return {
      ...state,
      activeLegIndex: inferredLegIndex,
      hasReliableFix: true,
      arrivalFixCount: 0,
      arrivalCandidateSince: null,
      lastFixTimestamp: fix.timestamp,
    };
  }

  const activeLegIndex = Math.min(
    Math.max(0, state.activeLegIndex),
    input.legs.length - 1,
  );
  if (activeLegIndex >= input.legs.length - 1) {
    return resetArrivalCandidate(
      { ...state, activeLegIndex },
      fix.timestamp,
    );
  }

  const target = input.legs[activeLegIndex].target;
  const arrivalRadius = Math.min(
    MAX_ROUTE_ARRIVAL_RADIUS_METERS,
    Math.max(
      MIN_ROUTE_ARRIVAL_RADIUS_METERS,
      fix.accuracyMeters * 1.5,
    ),
  );
  if (distanceMeters(fix.coordinates, target.coordinates) > arrivalRadius) {
    return resetArrivalCandidate(
      { ...state, activeLegIndex },
      fix.timestamp,
    );
  }

  const arrivalCandidateSince =
    state.arrivalCandidateSince ?? fix.timestamp;
  const arrivalFixCount = state.arrivalFixCount + 1;
  const hasConfirmedArrival =
    arrivalFixCount >= ROUTE_ARRIVAL_REQUIRED_FIXES &&
    fix.timestamp - arrivalCandidateSince >= ROUTE_ARRIVAL_DWELL_MS;

  if (hasConfirmedArrival) {
    return {
      ...state,
      activeLegIndex: Math.min(activeLegIndex + 1, input.legs.length - 1),
      hasReliableFix: true,
      arrivalFixCount: 0,
      arrivalCandidateSince: null,
      lastFixTimestamp: fix.timestamp,
    };
  }

  return {
    ...state,
    activeLegIndex,
    arrivalFixCount,
    arrivalCandidateSince,
    lastFixTimestamp: fix.timestamp,
  };
}

export function getActivePlannedRouteLeg(
  legs: readonly PlannedRouteLeg[],
  state: RouteProgressState,
  routeKey: string,
): PlannedRouteLeg | null {
  if (legs.length === 0) return null;
  const activeLegIndex =
    state.routeKey === routeKey
      ? Math.min(Math.max(0, state.activeLegIndex), legs.length - 1)
      : 0;
  return legs[activeLegIndex];
}
