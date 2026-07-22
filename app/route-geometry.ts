export type Coordinates = [number, number];

export type RouteSource = "kakao" | "direct";

export type BikeRouteMode = "BIKE_ONLY" | "SHORTEST" | "ACCESSIBLE";

export type RouteSegment = {
  path: Coordinates[];
  source: RouteSource;
  distanceMeters: number;
  durationSeconds: number;
};

export type BikeRouteLeg = Pick<
  RouteSegment,
  "source" | "distanceMeters" | "durationSeconds"
>;

export type RouteGeometry = {
  walkTo: RouteSegment;
  bike: RouteSegment;
  bikeLegs: BikeRouteLeg[];
  walkFrom: RouteSegment;
};

export type RouteGeometryInput = {
  origin: Coordinates;
  originAddress?: string;
  startStation: Coordinates;
  endStation: Coordinates;
  destination: Coordinates;
  destinationAddress?: string;
  transferStations?: Coordinates[];
  bikeRouteMode?: BikeRouteMode;
};

export type RouteGeometryLoadOptions = {
  signal?: AbortSignal;
};

type RouteProfile = "walk" | "bike";

type KakaoRouteStep = {
  path?: {
    points?: unknown;
  };
  properties?: {
    distance?: unknown;
    guidance?: unknown;
    time?: unknown;
    x?: unknown;
    y?: unknown;
  };
};

type KakaoRouteLeg = {
  properties?: {
    distance?: unknown;
    time?: unknown;
  };
  steps?: unknown;
};

type KakaoRoutePayload = {
  route?: {
    legs?: unknown;
    properties?: {
      landingUrl?: unknown;
      totalDistance?: unknown;
      totalTime?: unknown;
    };
  };
  status?: unknown;
};

type ParsedKakaoRoute = {
  path: Coordinates[];
  legs: Array<{
    path: Coordinates[];
    distanceMeters: number;
    durationSeconds: number;
  }>;
};

const ROUTE_API_URL = "/api/routes";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_DIRECT_DISTANCE_METERS = 100_000;
const MAX_GEOMETRY_POINTS = 20_000;
const MAX_COORDINATES_PER_KAKAO_REQUEST = 7;
const SEGMENT_CACHE_LIMIT = 48;
const FOOT_METERS_PER_SECOND = 76 / 60;
const BIKE_METERS_PER_SECOND = 245 / 60;
const DEFAULT_BIKE_ROUTE_MODE: BikeRouteMode = "SHORTEST";

const resolvedWalkCache = new Map<string, RouteSegment>();
const inFlightWalkCache = new Map<string, Promise<RouteSegment>>();
const resolvedBikeRouteCache = new Map<
  string,
  { segment: RouteSegment; legs: BikeRouteLeg[] }
>();
const inFlightBikeRouteCache = new Map<
  string,
  Promise<{ segment: RouteSegment; legs: BikeRouteLeg[] }>
>();

function isCoordinates(value: unknown): value is Coordinates {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [latitude, longitude] = value;
  return (
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function distanceMeters(a: Coordinates, b: Coordinates) {
  const radius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(b[0] - a[0]);
  const deltaLng = toRadians(b[1] - a[1]);
  const latitudeA = toRadians(a[0]);
  const latitudeB = toRadians(b[0]);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function coordinateKey([latitude, longitude]: Coordinates) {
  return `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
}

function walkSegmentKey(from: Coordinates, to: Coordinates) {
  return `walk:${coordinateKey(from)}>${coordinateKey(to)}`;
}

function bikeRouteKey(coordinates: Coordinates[], routeMode: BikeRouteMode) {
  return `bike:${routeMode}:${coordinates.map(coordinateKey).join(">")}`;
}

function getBikeCoordinates(input: RouteGeometryInput) {
  return [
    input.startStation,
    ...(input.transferStations ?? []),
    input.endStation,
  ];
}

function getBikeRouteMode(input: RouteGeometryInput) {
  return input.bikeRouteMode ?? DEFAULT_BIKE_ROUTE_MODE;
}

export function createRouteGeometryKey(input: RouteGeometryInput) {
  const bikeCoordinates = getBikeCoordinates(input);
  return [
    "v3-kakao",
    `walk:${coordinateKey(input.origin)}>${coordinateKey(input.startStation)}`,
    `bike:${getBikeRouteMode(input)}:${bikeCoordinates.map(coordinateKey).join(">")}`,
    `walk:${coordinateKey(input.endStation)}>${coordinateKey(input.destination)}`,
  ].join("|");
}

function createDirectSegment(
  from: Coordinates,
  to: Coordinates,
  profile: RouteProfile,
): RouteSegment {
  const directDistance = distanceMeters(from, to);
  const metersPerSecond =
    profile === "walk" ? FOOT_METERS_PER_SECOND : BIKE_METERS_PER_SECOND;
  return {
    path: [
      [from[0], from[1]],
      [to[0], to[1]],
    ],
    source: "direct",
    distanceMeters: directDistance,
    durationSeconds: directDistance / metersPerSecond,
  };
}

function createDirectBikeRoute(coordinates: Coordinates[]) {
  const legs = coordinates.slice(0, -1).map((from, index) =>
    createDirectSegment(from, coordinates[index + 1], "bike"),
  );
  return {
    segment: {
      path: coordinates.map(
        ([latitude, longitude]) => [latitude, longitude] as Coordinates,
      ),
      source: "direct" as const,
      distanceMeters: legs.reduce(
        (total, segment) => total + segment.distanceMeters,
        0,
      ),
      durationSeconds: legs.reduce(
        (total, segment) => total + segment.durationSeconds,
        0,
      ),
    },
    legs: legs.map(({ source, distanceMeters, durationSeconds }) => ({
      source,
      distanceMeters,
      durationSeconds,
    })),
  };
}

export function createDirectRouteGeometry(
  input: RouteGeometryInput,
): RouteGeometry {
  const directBikeRoute = createDirectBikeRoute(getBikeCoordinates(input));
  return {
    walkTo: createDirectSegment(input.origin, input.startStation, "walk"),
    bike: directBikeRoute.segment,
    bikeLegs: directBikeRoute.legs,
    walkFrom: createDirectSegment(
      input.endStation,
      input.destination,
      "walk",
    ),
  };
}

function createAbortError() {
  return new DOMException("The operation was aborted.", "AbortError");
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : Boolean(
          error &&
            typeof error === "object" &&
            "name" in error &&
            error.name === "AbortError",
        )
  );
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw createAbortError();
}

function readFiniteNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Kakao route returned an invalid ${label}.`);
  }
  return value;
}

function sameCoordinates(a: Coordinates, b: Coordinates) {
  return Math.abs(a[0] - b[0]) < 1e-10 && Math.abs(a[1] - b[1]) < 1e-10;
}

function appendPath(target: Coordinates[], nextPath: Coordinates[]) {
  for (const coordinate of nextPath) {
    if (!target.length || !sameCoordinates(target[target.length - 1], coordinate)) {
      target.push(coordinate);
    }
  }
}

function attachRequestedEndpoints(
  path: Coordinates[],
  from: Coordinates,
  to: Coordinates,
) {
  const connected = path.map(
    ([latitude, longitude]) => [latitude, longitude] as Coordinates,
  );
  if (!connected.length || distanceMeters(from, connected[0]) > 1) {
    connected.unshift([from[0], from[1]]);
  } else {
    connected[0] = [from[0], from[1]];
  }

  const lastIndex = connected.length - 1;
  if (lastIndex < 0 || distanceMeters(connected[lastIndex], to) > 1) {
    connected.push([to[0], to[1]]);
  } else {
    connected[lastIndex] = [to[0], to[1]];
  }
  return connected;
}

function parseKakaoPoint(value: unknown): Coordinates {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error("Kakao route returned an invalid path point.");
  }
  const coordinate: Coordinates = [value[1], value[0]];
  if (!isCoordinates(coordinate)) {
    throw new Error("Kakao route returned an out-of-range path point.");
  }
  return coordinate;
}

function parseKakaoLegPath(leg: KakaoRouteLeg) {
  if (!Array.isArray(leg.steps)) {
    throw new Error("Kakao route returned invalid route steps.");
  }
  const path: Coordinates[] = [];
  for (const rawStep of leg.steps) {
    if (!rawStep || typeof rawStep !== "object") {
      throw new Error("Kakao route returned an invalid route step.");
    }
    const step = rawStep as KakaoRouteStep;
    if (!Array.isArray(step.path?.points)) {
      throw new Error("Kakao route returned invalid step geometry.");
    }
    appendPath(path, step.path.points.map(parseKakaoPoint));
    if (path.length > MAX_GEOMETRY_POINTS) {
      throw new Error("Kakao route returned too many path points.");
    }
  }
  if (!path.length) {
    throw new Error("Kakao route did not return path geometry.");
  }
  return path;
}

function parseKakaoRoutePayload(
  payload: unknown,
  requestedCoordinates: Coordinates[],
): ParsedKakaoRoute {
  if (!payload || typeof payload !== "object") {
    throw new Error("Kakao route returned an invalid response.");
  }
  const response = payload as KakaoRoutePayload;
  if (response.status !== "OK") {
    const status =
      typeof response.status === "string" ? response.status : "UNKNOWN";
    throw new Error(`Kakao route could not find a route (${status}).`);
  }
  if (!Array.isArray(response.route?.legs)) {
    throw new Error("Kakao route did not return route legs.");
  }
  if (response.route.legs.length !== requestedCoordinates.length - 1) {
    throw new Error("Kakao route returned an unexpected number of route legs.");
  }

  const path: Coordinates[] = [];
  const legs = response.route.legs.map((rawLeg, index) => {
    if (!rawLeg || typeof rawLeg !== "object") {
      throw new Error(`Kakao route returned an invalid leg ${index + 1}.`);
    }
    const leg = rawLeg as KakaoRouteLeg;
    const legPath = attachRequestedEndpoints(
      parseKakaoLegPath(leg),
      requestedCoordinates[index],
      requestedCoordinates[index + 1],
    );
    appendPath(path, legPath);
    return {
      path: legPath,
      distanceMeters: readFiniteNumber(
        leg.properties?.distance,
        `leg ${index + 1} distance`,
      ),
      durationSeconds: readFiniteNumber(
        leg.properties?.time,
        `leg ${index + 1} time`,
      ),
    };
  });

  if (path.length < 2 || path.length > MAX_GEOMETRY_POINTS) {
    throw new Error("Kakao route returned invalid combined geometry.");
  }
  return { path, legs };
}

async function requestKakaoRoute(
  profile: RouteProfile,
  coordinates: Coordinates[],
  bikeRouteMode: BikeRouteMode,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  if (
    coordinates.length < 2 ||
    coordinates.length > MAX_COORDINATES_PER_KAKAO_REQUEST ||
    coordinates.some((coordinate) => !isCoordinates(coordinate))
  ) {
    throw new Error("Route coordinates are invalid.");
  }
  if (
    coordinates
      .slice(0, -1)
      .some(
        (coordinate, index) =>
          distanceMeters(coordinate, coordinates[index + 1]) >
          MAX_DIRECT_DISTANCE_METERS,
      )
  ) {
    throw new Error("Route is outside the prototype service area.");
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(signal?.reason);
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort(
      new DOMException("Kakao route request timed out.", "TimeoutError"),
    );
  }, REQUEST_TIMEOUT_MS);
  signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const response = await fetch(ROUTE_API_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: profile,
        coordinates,
        ...(profile === "bike" ? { bikeRouteMode } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Kakao route proxy returned ${response.status}.`);
    }
    const payload = (await response.json()) as unknown;
    throwIfAborted(signal);
    return parseKakaoRoutePayload(payload, coordinates);
  } catch (error) {
    if (signal?.aborted) throw createAbortError();
    if (timedOut) throw new Error("Kakao route request timed out.");
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function requestKakaoWalkSegment(
  from: Coordinates,
  to: Coordinates,
  signal?: AbortSignal,
) {
  const parsed = await requestKakaoRoute(
    "walk",
    [from, to],
    DEFAULT_BIKE_ROUTE_MODE,
    signal,
  );
  const leg = parsed.legs[0];
  return {
    path: parsed.path,
    source: "kakao" as const,
    distanceMeters: leg.distanceMeters,
    durationSeconds: leg.durationSeconds,
  };
}

function splitKakaoRouteCoordinates(coordinates: Coordinates[]) {
  const chunks: Coordinates[][] = [];
  let startIndex = 0;
  while (startIndex < coordinates.length - 1) {
    const endIndex = Math.min(
      coordinates.length - 1,
      startIndex + MAX_COORDINATES_PER_KAKAO_REQUEST - 1,
    );
    chunks.push(coordinates.slice(startIndex, endIndex + 1));
    startIndex = endIndex;
  }
  return chunks;
}

async function requestKakaoBikeRoute(
  coordinates: Coordinates[],
  bikeRouteMode: BikeRouteMode,
  signal?: AbortSignal,
): Promise<{ segment: RouteSegment; legs: BikeRouteLeg[] }> {
  throwIfAborted(signal);
  if (coordinates.length < 2) throw new Error("Bicycle route needs two points.");

  const chunks = splitKakaoRouteCoordinates(coordinates);
  const parsedChunks = await Promise.all(
    chunks.map((chunk) =>
      requestKakaoRoute("bike", chunk, bikeRouteMode, signal),
    ),
  );
  throwIfAborted(signal);

  const path: Coordinates[] = [];
  const legs: BikeRouteLeg[] = [];
  for (const parsed of parsedChunks) {
    appendPath(path, parsed.path);
    legs.push(
      ...parsed.legs.map((leg) => ({
        source: "kakao" as const,
        distanceMeters: leg.distanceMeters,
        durationSeconds: leg.durationSeconds,
      })),
    );
  }
  if (legs.length !== coordinates.length - 1) {
    throw new Error("Kakao route did not return every bicycle leg.");
  }

  return {
    segment: {
      path,
      source: "kakao",
      distanceMeters: legs.reduce(
        (total, leg) => total + leg.distanceMeters,
        0,
      ),
      durationSeconds: legs.reduce(
        (total, leg) => total + leg.durationSeconds,
        0,
      ),
    },
    legs,
  };
}

function rememberValue<T>(cache: Map<string, T>, key: string, value: T) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > SEGMENT_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    cache.delete(oldestKey);
  }
}

function loadWalkSegment(
  from: Coordinates,
  to: Coordinates,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  const key = walkSegmentKey(from, to);
  const resolved = resolvedWalkCache.get(key);
  if (resolved) {
    rememberValue(resolvedWalkCache, key, resolved);
    return Promise.resolve(resolved);
  }

  if (signal) {
    return requestKakaoWalkSegment(from, to, signal).then((segment) => {
      rememberValue(resolvedWalkCache, key, segment);
      return segment;
    });
  }

  const inFlight = inFlightWalkCache.get(key);
  if (inFlight) return inFlight;
  const pending = requestKakaoWalkSegment(from, to)
    .then((segment) => {
      rememberValue(resolvedWalkCache, key, segment);
      return segment;
    })
    .finally(() => inFlightWalkCache.delete(key));
  inFlightWalkCache.set(key, pending);
  return pending;
}

function loadBikeRoute(
  coordinates: Coordinates[],
  bikeRouteMode: BikeRouteMode,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  const key = bikeRouteKey(coordinates, bikeRouteMode);
  const resolved = resolvedBikeRouteCache.get(key);
  if (resolved) {
    rememberValue(resolvedBikeRouteCache, key, resolved);
    return Promise.resolve(resolved);
  }

  if (signal) {
    return requestKakaoBikeRoute(coordinates, bikeRouteMode, signal).then(
      (route) => {
        rememberValue(resolvedBikeRouteCache, key, route);
        return route;
      },
    );
  }

  const inFlight = inFlightBikeRouteCache.get(key);
  if (inFlight) return inFlight;
  const pending = requestKakaoBikeRoute(coordinates, bikeRouteMode)
    .then((route) => {
      rememberValue(resolvedBikeRouteCache, key, route);
      return route;
    })
    .finally(() => inFlightBikeRouteCache.delete(key));
  inFlightBikeRouteCache.set(key, pending);
  return pending;
}

function recoverSegment<T>(
  promise: Promise<T>,
  fallback: T,
  signal?: AbortSignal,
) {
  return promise.catch((error: unknown) => {
    if (isAbortError(error) || signal?.aborted) throw createAbortError();
    return fallback;
  });
}

export async function loadRouteGeometry(
  input: RouteGeometryInput,
  signalOrOptions?: AbortSignal | RouteGeometryLoadOptions,
): Promise<RouteGeometry> {
  const signal: AbortSignal | undefined =
    signalOrOptions && "signal" in signalOrOptions
      ? signalOrOptions.signal
      : (signalOrOptions as AbortSignal | undefined);
  throwIfAborted(signal);

  const directGeometry = createDirectRouteGeometry(input);
  const bikeCoordinates = getBikeCoordinates(input);
  const [walkTo, bikeRoute, walkFrom] = await Promise.all([
    recoverSegment(
      loadWalkSegment(input.origin, input.startStation, signal),
      directGeometry.walkTo,
      signal,
    ),
    recoverSegment(
      loadBikeRoute(bikeCoordinates, getBikeRouteMode(input), signal),
      {
        segment: directGeometry.bike,
        legs: directGeometry.bikeLegs,
      },
      signal,
    ),
    recoverSegment(
      loadWalkSegment(input.endStation, input.destination, signal),
      directGeometry.walkFrom,
      signal,
    ),
  ]);

  throwIfAborted(signal);
  return {
    walkTo,
    bike: bikeRoute.segment,
    bikeLegs: bikeRoute.legs,
    walkFrom,
  };
}
