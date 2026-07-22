import {
  areBikeLegsWithinPassLimit,
  getPassSafeRideMinutes,
  initialMinimumStopCount,
  selectRouteCorridorStations,
  TRANSFER_STOP_OVERHEAD_MINUTES,
} from "./pass-planning.ts";
import type {
  PassType,
  RouteCorridorSelectionInput,
  RouteCorridorStation,
} from "./pass-planning";
import type {
  RouteGeometry,
  RouteGeometryInput,
} from "./route-geometry";

export type PassRouteStatus =
  | "loading"
  | "not-needed"
  | "recommended"
  | "unavailable";

export type PassTransferStation = RouteCorridorStation & {
  bikes: number | null;
};

type RouteGeometryLoader = (
  input: RouteGeometryInput,
  signal?: AbortSignal,
) => Promise<RouteGeometry>;

type TransferStationSelector<T extends PassTransferStation> = (
  input: RouteCorridorSelectionInput<T>,
) => T[];

export type PassRouteRecommendationResult<T extends PassTransferStation> = {
  geometry: RouteGeometry;
  transferStops: T[];
  status: Exclude<PassRouteStatus, "loading">;
};

export type PassRouteRecommendationInput<T extends PassTransferStation> = {
  baseInput: RouteGeometryInput;
  passType: PassType;
  stations: readonly T[];
  startStationId: string;
  endStationId: string;
  loadGeometry: RouteGeometryLoader;
  signal?: AbortSignal;
  maximumTransferStops?: number;
  maximumCombinationsPerStopCount?: number;
  selectStations?: TransferStationSelector<T>;
  onBaseGeometry?: (geometry: RouteGeometry) => void;
};

export type RouteGeometryMetrics = {
  walkToMeters: number;
  bikeMeters: number;
  walkFromMeters: number;
  walkToMinutes: number;
  bikeMinutes: number;
  walkFromMinutes: number;
  totalMinutes: number;
  totalMeters: number;
  calories: number;
};

const DEFAULT_MAXIMUM_TRANSFER_STOPS = 8;
const DEFAULT_MAXIMUM_COMBINATIONS_PER_STOP_COUNT = 4;

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("The operation was aborted.", "AbortError");
}

export function calculateRouteGeometryMetrics(
  geometry: RouteGeometry,
  transferStopCount: number,
): RouteGeometryMetrics {
  const walkToMeters = Math.round(geometry.walkTo.distanceMeters);
  const bikeMeters = Math.round(geometry.bike.distanceMeters);
  const walkFromMeters = Math.round(geometry.walkFrom.distanceMeters);
  const walkToMinutes = Math.max(
    1,
    Math.ceil(geometry.walkTo.durationSeconds / 60),
  );
  const bikeMinutes = Math.max(
    1,
    Math.ceil(geometry.bike.durationSeconds / 60),
  );
  const walkFromMinutes = Math.max(
    1,
    Math.ceil(geometry.walkFrom.durationSeconds / 60),
  );
  const transferMinutes =
    Math.max(0, Math.trunc(transferStopCount)) * TRANSFER_STOP_OVERHEAD_MINUTES;

  return {
    walkToMeters,
    bikeMeters,
    walkFromMeters,
    walkToMinutes,
    bikeMinutes,
    walkFromMinutes,
    totalMinutes:
      walkToMinutes + bikeMinutes + walkFromMinutes + transferMinutes,
    totalMeters: walkToMeters + bikeMeters + walkFromMeters,
    calories: Math.round(
      bikeMinutes * 6.2 + (walkToMinutes + walkFromMinutes) * 3.1,
    ),
  };
}

export async function recommendPassTransferRoute<
  T extends PassTransferStation,
>({
  baseInput,
  passType,
  stations,
  startStationId,
  endStationId,
  loadGeometry,
  signal,
  maximumTransferStops = DEFAULT_MAXIMUM_TRANSFER_STOPS,
  maximumCombinationsPerStopCount =
    DEFAULT_MAXIMUM_COMBINATIONS_PER_STOP_COUNT,
  selectStations = selectRouteCorridorStations,
  onBaseGeometry,
}: PassRouteRecommendationInput<T>): Promise<
  PassRouteRecommendationResult<T>
> {
  throwIfAborted(signal);
  const baseGeometry = await loadGeometry(baseInput, signal);
  throwIfAborted(signal);
  onBaseGeometry?.(baseGeometry);

  const safeRideMinutes = getPassSafeRideMinutes(passType);
  if (safeRideMinutes === null) {
    return { geometry: baseGeometry, transferStops: [], status: "not-needed" };
  }

  if (baseGeometry.bike.source !== "kakao") {
    return { geometry: baseGeometry, transferStops: [], status: "unavailable" };
  }

  const baseBikeLegMinutes = baseGeometry.bikeLegs.map(
    (leg) => leg.durationSeconds / 60,
  );
  if (areBikeLegsWithinPassLimit(baseBikeLegMinutes, passType)) {
    return { geometry: baseGeometry, transferStops: [], status: "not-needed" };
  }

  const initialStopCount = initialMinimumStopCount(
    baseGeometry.bike.durationSeconds / 60,
    passType,
  );
  const maximumStopCount = Math.min(
    Math.max(1, Math.trunc(maximumTransferStops)),
    Math.max(4, initialStopCount + 4),
  );
  const endpointStationIds = new Set([startStationId, endStationId]);
  // A transfer stop must support immediate re-rental. Keep unknown counts
  // eligible, but never recommend a station confirmed at 0.
  const transferCandidateStations = stations.filter(
    (station) => station.bikes !== 0,
  );

  for (
    let stopCount = Math.max(1, initialStopCount);
    stopCount <= maximumStopCount;
    stopCount += 1
  ) {
    const exclusionQueue: Set<string>[] = [new Set(endpointStationIds)];
    const seenExclusionSets = new Set([
      [...endpointStationIds].sort().join(","),
    ]);
    const triedStationSequences = new Set<string>();
    let combinationCount = 0;

    while (
      exclusionQueue.length > 0 &&
      combinationCount < maximumCombinationsPerStopCount
    ) {
      throwIfAborted(signal);
      const excludedStationIds =
        exclusionQueue.shift() ?? endpointStationIds;
      const transferStops = selectStations({
        routePath: baseGeometry.bike.path,
        stations: transferCandidateStations,
        stopCount,
        excludedStationIds,
        stationPenaltyMeters: (station) =>
          station.bikes === null ? 90 : station.bikes === 0 ? 25 : 0,
      });
      if (transferStops.length !== stopCount) continue;

      const stationSequence = transferStops
        .map((station) => station.id)
        .join(">");
      if (triedStationSequences.has(stationSequence)) continue;
      triedStationSequences.add(stationSequence);
      combinationCount += 1;

      for (const station of transferStops) {
        const nextExclusions = new Set(excludedStationIds);
        nextExclusions.add(station.id);
        const exclusionKey = [...nextExclusions].sort().join(",");
        if (!seenExclusionSets.has(exclusionKey)) {
          seenExclusionSets.add(exclusionKey);
          exclusionQueue.push(nextExclusions);
        }
      }

      let geometry: RouteGeometry;
      try {
        geometry = await loadGeometry(
          {
            ...baseInput,
            transferStations: transferStops.map(
              (station) => station.coordinates as RouteGeometryInput["startStation"],
            ),
          },
          signal,
        );
      } catch (error: unknown) {
        if (isAbortError(error) || signal?.aborted) throw error;
        continue;
      }
      throwIfAborted(signal);

      const bikeLegMinutes = geometry.bikeLegs.map(
        (leg) => leg.durationSeconds / 60,
      );
      const allRoadLegs =
        geometry.bike.source === "kakao" &&
        geometry.bikeLegs.every((leg) => leg.source === "kakao");
      if (
        allRoadLegs &&
        areBikeLegsWithinPassLimit(bikeLegMinutes, passType)
      ) {
        return { geometry, transferStops, status: "recommended" };
      }
    }
  }

  return { geometry: baseGeometry, transferStops: [], status: "unavailable" };
}
