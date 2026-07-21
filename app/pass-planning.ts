export type Coordinates = readonly [latitude: number, longitude: number];

export type PassType = "60" | "120" | "180" | "none";

export type PassOption = {
  value: PassType;
  label: string;
};

export const PASS_OPTIONS = [
  { value: "60", label: "1시간권" },
  { value: "120", label: "2시간권" },
  { value: "180", label: "3시간권" },
  { value: "none", label: "상관 없음" },
] as const satisfies readonly PassOption[];

export const DEFAULT_PASS_TYPE: PassType = "60";
export const PASS_TYPE_STORAGE_KEY = "ttarawaing:pass-type:v1";
export const PASS_SAFETY_BUFFER_MINUTES = 5;
export const TRANSFER_STOP_OVERHEAD_MINUTES = 3;

export const PASS_SAFE_RIDE_MINUTES = {
  "60": 55,
  "120": 115,
  "180": 175,
} as const satisfies Readonly<Record<Exclude<PassType, "none">, number>>;

export function isPassType(value: unknown): value is PassType {
  return value === "60" || value === "120" || value === "180" || value === "none";
}

export function getPassSafeRideMinutes(passType: PassType): number | null {
  return passType === "none" ? null : PASS_SAFE_RIDE_MINUTES[passType];
}

/**
 * Returns the theoretical minimum number of return/re-rental stops needed for a
 * bike duration. A later road-route validation must still verify every leg.
 */
export function initialMinimumStopCount(
  actualBikeMinutes: number,
  passType: PassType,
): number {
  const safeMinutes = getPassSafeRideMinutes(passType);
  if (safeMinutes === null || !Number.isFinite(actualBikeMinutes) || actualBikeMinutes <= 0) {
    return 0;
  }
  return Math.max(0, Math.ceil(actualBikeMinutes / safeMinutes) - 1);
}

export type BikeLegValidation = {
  isWithinLimit: boolean;
  safeMinutes: number | null;
  violatingLegIndexes: number[];
};

export function validateBikeLegDurations(
  bikeLegMinutes: readonly number[],
  passType: PassType,
): BikeLegValidation {
  const safeMinutes = getPassSafeRideMinutes(passType);
  if (safeMinutes === null) {
    return { isWithinLimit: true, safeMinutes, violatingLegIndexes: [] };
  }

  const violatingLegIndexes: number[] = [];
  bikeLegMinutes.forEach((minutes, index) => {
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > safeMinutes) {
      violatingLegIndexes.push(index);
    }
  });

  return {
    isWithinLimit: violatingLegIndexes.length === 0,
    safeMinutes,
    violatingLegIndexes,
  };
}

export function areBikeLegsWithinPassLimit(
  bikeLegMinutes: readonly number[],
  passType: PassType,
): boolean {
  return validateBikeLegDurations(bikeLegMinutes, passType).isWithinLimit;
}

export type RouteCorridorStation = {
  id: string;
  coordinates: Coordinates;
};

export type RouteCorridorSelectionInput<T extends RouteCorridorStation> = {
  routePath: readonly Coordinates[];
  stations: readonly T[];
  stopCount: number;
  excludedStationIds?: ReadonlySet<string> | readonly string[];
  /** Maximum allowed distance from the actual route. Defaults to 600m. */
  maxCorridorDistanceMeters?: number;
  /**
   * Allowed offset from each evenly-spaced target, measured as a portion of
   * one ideal leg. Defaults to 0.45 (45% of an ideal leg).
   */
  targetToleranceRatio?: number;
  /** Optional non-negative score penalty, in meter-equivalent units. */
  stationPenaltyMeters?: (station: T) => number;
};

type RouteSegment = {
  from: Coordinates;
  to: Coordinates;
  startMeters: number;
  lengthMeters: number;
};

type ProjectedCandidate<T> = {
  station: T;
  progress: number;
  corridorDistanceMeters: number;
};

const EARTH_RADIUS_METERS = 6_371_000;
const DEFAULT_MAX_CORRIDOR_DISTANCE_METERS = 600;
const DEFAULT_TARGET_TOLERANCE_RATIO = 0.45;
const MAX_PROJECTION_SEGMENTS = 1_600;

function isValidCoordinates(value: Coordinates): boolean {
  const [latitude, longitude] = value;
  return (
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceMeters(a: Coordinates, b: Coordinates): number {
  const deltaLatitude = toRadians(b[0] - a[0]);
  const deltaLongitude = toRadians(b[1] - a[1]);
  const latitudeA = toRadians(a[0]);
  const latitudeB = toRadians(b[0]);
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2;
  return (
    EARTH_RADIUS_METERS *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)))
  );
}

function downsamplePath(path: readonly Coordinates[]): Coordinates[] {
  const validPath = path.filter(isValidCoordinates);
  if (validPath.length <= MAX_PROJECTION_SEGMENTS + 1) {
    return validPath.map(([latitude, longitude]) => [latitude, longitude]);
  }

  const sampled: Coordinates[] = [];
  const lastIndex = validPath.length - 1;
  for (let index = 0; index <= MAX_PROJECTION_SEGMENTS; index += 1) {
    const sourceIndex = Math.round((index / MAX_PROJECTION_SEGMENTS) * lastIndex);
    const coordinate = validPath[sourceIndex];
    const previous = sampled[sampled.length - 1];
    if (!previous || previous[0] !== coordinate[0] || previous[1] !== coordinate[1]) {
      sampled.push([coordinate[0], coordinate[1]]);
    }
  }
  return sampled;
}

function buildRouteSegments(path: readonly Coordinates[]): {
  segments: RouteSegment[];
  totalMeters: number;
} {
  const sampledPath = downsamplePath(path);
  const segments: RouteSegment[] = [];
  let totalMeters = 0;

  for (let index = 1; index < sampledPath.length; index += 1) {
    const from = sampledPath[index - 1];
    const to = sampledPath[index];
    const lengthMeters = distanceMeters(from, to);
    if (!Number.isFinite(lengthMeters) || lengthMeters <= 0.01) continue;
    segments.push({ from, to, startMeters: totalMeters, lengthMeters });
    totalMeters += lengthMeters;
  }

  return { segments, totalMeters };
}

function projectOntoSegment(
  coordinate: Coordinates,
  segment: RouteSegment,
): { alongSegmentRatio: number; distanceMeters: number } {
  const referenceLatitude = toRadians(
    (coordinate[0] + segment.from[0] + segment.to[0]) / 3,
  );
  const longitudeScale = Math.max(0.01, Math.cos(referenceLatitude));
  const toLocal = (point: Coordinates) => ({
    x:
      toRadians(point[1] - segment.from[1]) *
      EARTH_RADIUS_METERS *
      longitudeScale,
    y: toRadians(point[0] - segment.from[0]) * EARTH_RADIUS_METERS,
  });

  const end = toLocal(segment.to);
  const point = toLocal(coordinate);
  const squaredLength = end.x ** 2 + end.y ** 2;
  const rawRatio = squaredLength > 0 ? (point.x * end.x + point.y * end.y) / squaredLength : 0;
  const alongSegmentRatio = Math.max(0, Math.min(1, rawRatio));
  const deltaX = point.x - end.x * alongSegmentRatio;
  const deltaY = point.y - end.y * alongSegmentRatio;

  return {
    alongSegmentRatio,
    distanceMeters: Math.hypot(deltaX, deltaY),
  };
}

function projectOntoRoute(
  coordinate: Coordinates,
  segments: readonly RouteSegment[],
  totalMeters: number,
): { progress: number; corridorDistanceMeters: number } | null {
  if (!isValidCoordinates(coordinate) || segments.length === 0 || totalMeters <= 0) {
    return null;
  }

  let closestDistance = Number.POSITIVE_INFINITY;
  let closestAlongRoute = 0;
  for (const segment of segments) {
    const projection = projectOntoSegment(coordinate, segment);
    if (projection.distanceMeters < closestDistance) {
      closestDistance = projection.distanceMeters;
      closestAlongRoute =
        segment.startMeters + segment.lengthMeters * projection.alongSegmentRatio;
    }
  }

  return {
    progress: Math.max(0, Math.min(1, closestAlongRoute / totalMeters)),
    corridorDistanceMeters: closestDistance,
  };
}

function normalizeExcludedIds(
  value: ReadonlySet<string> | readonly string[] | undefined,
): ReadonlySet<string> {
  return value instanceof Set ? value : new Set(value ?? []);
}

/**
 * Selects distinct stations near evenly-spaced points along an actual road
 * route. Ordered dynamic programming finds the lowest-cost sequence while
 * preserving route order; no matching sequence returns an empty array.
 */
export function selectRouteCorridorStations<T extends RouteCorridorStation>(
  input: RouteCorridorSelectionInput<T>,
): T[] {
  const requestedStopCount = Math.trunc(input.stopCount);
  if (!Number.isInteger(input.stopCount) || requestedStopCount <= 0) return [];

  const maxCorridorDistanceMeters =
    input.maxCorridorDistanceMeters ?? DEFAULT_MAX_CORRIDOR_DISTANCE_METERS;
  const targetToleranceRatio =
    input.targetToleranceRatio ?? DEFAULT_TARGET_TOLERANCE_RATIO;
  if (
    !Number.isFinite(maxCorridorDistanceMeters) ||
    maxCorridorDistanceMeters <= 0 ||
    !Number.isFinite(targetToleranceRatio) ||
    targetToleranceRatio <= 0
  ) {
    return [];
  }

  const { segments, totalMeters } = buildRouteSegments(input.routePath);
  if (segments.length === 0 || totalMeters <= 0) return [];

  const excludedIds = normalizeExcludedIds(input.excludedStationIds);
  const candidatesById = new Map<string, ProjectedCandidate<T>>();
  for (const station of input.stations) {
    if (!station.id || excludedIds.has(station.id)) continue;
    const projection = projectOntoRoute(station.coordinates, segments, totalMeters);
    if (
      !projection ||
      projection.corridorDistanceMeters > maxCorridorDistanceMeters ||
      projection.progress <= 0 ||
      projection.progress >= 1
    ) {
      continue;
    }

    const candidate = { station, ...projection };
    const duplicate = candidatesById.get(station.id);
    if (!duplicate || candidate.corridorDistanceMeters < duplicate.corridorDistanceMeters) {
      candidatesById.set(station.id, candidate);
    }
  }

  const candidates = [...candidatesById.values()].sort(
    (a, b) => a.progress - b.progress || a.station.id.localeCompare(b.station.id),
  );
  if (candidates.length < requestedStopCount) return [];

  const candidateCount = candidates.length;
  const choices: boolean[][] = Array.from(
    { length: requestedStopCount + 1 },
    () => new Array<boolean>(candidateCount + 1).fill(false),
  );
  let previousCosts = new Array<number>(candidateCount + 1).fill(0);
  const targetTolerance = targetToleranceRatio / (requestedStopCount + 1);

  for (let targetIndex = 1; targetIndex <= requestedStopCount; targetIndex += 1) {
    const targetProgress = targetIndex / (requestedStopCount + 1);
    const currentCosts = new Array<number>(candidateCount + 1).fill(
      Number.POSITIVE_INFINITY,
    );

    for (let candidateIndex = 1; candidateIndex <= candidateCount; candidateIndex += 1) {
      const candidate = candidates[candidateIndex - 1];
      const skipCost = currentCosts[candidateIndex - 1];
      const progressOffset = Math.abs(candidate.progress - targetProgress);
      let selectCost = Number.POSITIVE_INFINITY;

      if (progressOffset <= targetTolerance && Number.isFinite(previousCosts[candidateIndex - 1])) {
        const rawPenalty = input.stationPenaltyMeters?.(candidate.station) ?? 0;
        const stationPenalty =
          Number.isFinite(rawPenalty) && rawPenalty > 0 ? rawPenalty : 0;
        selectCost =
          previousCosts[candidateIndex - 1] +
          progressOffset * totalMeters +
          candidate.corridorDistanceMeters * 1.75 +
          stationPenalty;
      }

      if (selectCost < skipCost) {
        currentCosts[candidateIndex] = selectCost;
        choices[targetIndex][candidateIndex] = true;
      } else {
        currentCosts[candidateIndex] = skipCost;
      }
    }
    previousCosts = currentCosts;
  }

  if (!Number.isFinite(previousCosts[candidateCount])) return [];

  const selected: T[] = [];
  let targetIndex = requestedStopCount;
  let candidateIndex = candidateCount;
  while (targetIndex > 0 && candidateIndex > 0) {
    if (choices[targetIndex][candidateIndex]) {
      selected.push(candidates[candidateIndex - 1].station);
      targetIndex -= 1;
      candidateIndex -= 1;
    } else {
      candidateIndex -= 1;
    }
  }

  if (targetIndex !== 0 || selected.length !== requestedStopCount) return [];
  return selected.reverse();
}
