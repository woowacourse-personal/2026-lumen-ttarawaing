export type Coordinates = [number, number];

export type RouteSegment = {
  path: Coordinates[];
  source: "osrm" | "direct";
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
  startStation: Coordinates;
  endStation: Coordinates;
  destination: Coordinates;
  transferStations?: Coordinates[];
};

type RouteProfile = "foot" | "bike";

type OsrmRoute = {
  distance?: unknown;
  duration?: unknown;
  legs?: unknown;
  geometry?: {
    type?: unknown;
    coordinates?: unknown;
  };
};

type OsrmWaypoint = {
  distance?: unknown;
};

type OsrmResponse = {
  code?: unknown;
  routes?: unknown;
  waypoints?: unknown;
};

const ROUTER_ORIGIN = "https://routing.openstreetmap.de";
const REQUEST_INTERVAL_MS = 1_100;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_DIRECT_DISTANCE_METERS = 100_000;
const MAX_GEOMETRY_POINTS = 20_000;
const SEGMENT_CACHE_LIMIT = 48;

const resolvedSegmentCache = new Map<string, RouteSegment>();
const inFlightSegmentCache = new Map<string, Promise<RouteSegment>>();
const resolvedBikeRouteCache = new Map<
  string,
  { segment: RouteSegment; legs: BikeRouteLeg[] }
>();
const inFlightBikeRouteCache = new Map<
  string,
  Promise<{ segment: RouteSegment; legs: BikeRouteLeg[] }>
>();

let requestQueue: Promise<void> = Promise.resolve();
let nextRequestAt = 0;

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

function segmentKey(profile: RouteProfile, from: Coordinates, to: Coordinates) {
  return `${profile}:${coordinateKey(from)}>${coordinateKey(to)}`;
}

function bikeRouteKey(coordinates: Coordinates[]) {
  return `bike:${coordinates.map(coordinateKey).join(">")}`;
}

function getBikeCoordinates(input: RouteGeometryInput) {
  return [
    input.startStation,
    ...(input.transferStations ?? []),
    input.endStation,
  ];
}

export function createRouteGeometryKey(input: RouteGeometryInput) {
  const bikeCoordinates = getBikeCoordinates(input);
  return [
    "v1",
    `foot:${coordinateKey(input.origin)}>${coordinateKey(input.startStation)}`,
    `bike:${bikeCoordinates.map(coordinateKey).join(">")}`,
    `foot:${coordinateKey(input.endStation)}>${coordinateKey(input.destination)}`,
  ].join("|");
}

function createDirectSegment(
  from: Coordinates,
  to: Coordinates,
  profile: RouteProfile,
): RouteSegment {
  const directDistance = distanceMeters(from, to);
  const metersPerSecond = profile === "foot" ? 76 / 60 : 245 / 60;
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
  const segments = coordinates.slice(0, -1).map((from, index) =>
    createDirectSegment(from, coordinates[index + 1], "bike"),
  );
  const path = segments.flatMap((segment, index) =>
    index === 0 ? segment.path : segment.path.slice(1),
  );
  const legs = segments.map(({ source, distanceMeters, durationSeconds }) => ({
    source,
    distanceMeters,
    durationSeconds,
  }));

  return {
    segment: {
      path,
      source: "direct" as const,
      distanceMeters: legs.reduce((total, leg) => total + leg.distanceMeters, 0),
      durationSeconds: legs.reduce((total, leg) => total + leg.durationSeconds, 0),
    },
    legs,
  };
}

export function createDirectRouteGeometry(input: RouteGeometryInput): RouteGeometry {
  const directBikeRoute = createDirectBikeRoute(getBikeCoordinates(input));
  return {
    walkTo: createDirectSegment(input.origin, input.startStation, "foot"),
    bike: directBikeRoute.segment,
    bikeLegs: directBikeRoute.legs,
    walkFrom: createDirectSegment(input.endStation, input.destination, "foot"),
  };
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function scheduleRequest<T>(request: () => Promise<T>) {
  const scheduled = requestQueue.then(async () => {
    const delay = Math.max(0, nextRequestAt - Date.now());
    if (delay > 0) await wait(delay);
    nextRequestAt = Date.now() + REQUEST_INTERVAL_MS;
    return request();
  });

  requestQueue = scheduled.then(
    () => undefined,
    () => undefined,
  );
  return scheduled;
}

function buildRouteUrl(profile: RouteProfile, routeCoordinates: Coordinates[]) {
  const endpoint = profile === "foot" ? "routed-foot" : "routed-bike";
  const coordinates = routeCoordinates
    .map(([latitude, longitude]) => `${longitude.toFixed(6)},${latitude.toFixed(6)}`)
    .join(";");
  const query = new URLSearchParams({
    steps: "false",
    overview: "full",
    geometries: "geojson",
    alternatives: "false",
  });
  return `${ROUTER_ORIGIN}/${endpoint}/route/v1/driving/${coordinates}?${query}`;
}

function readFiniteNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid OSRM ${label}.`);
  }
  return value;
}

function parsePath(route: OsrmRoute) {
  const geometry = route.geometry;
  if (geometry?.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    throw new Error("OSRM did not return a GeoJSON LineString.");
  }
  if (geometry.coordinates.length < 2 || geometry.coordinates.length > MAX_GEOMETRY_POINTS) {
    throw new Error("OSRM returned an invalid number of route points.");
  }

  return geometry.coordinates.map((rawCoordinate) => {
    if (!Array.isArray(rawCoordinate) || rawCoordinate.length < 2) {
      throw new Error("OSRM returned an invalid route coordinate.");
    }
    const longitude = rawCoordinate[0];
    const latitude = rawCoordinate[1];
    const coordinate: Coordinates = [latitude, longitude];
    if (!isCoordinates(coordinate)) {
      throw new Error("OSRM returned an out-of-range route coordinate.");
    }
    return coordinate;
  });
}

function attachRequestedEndpoints(
  path: Coordinates[],
  from: Coordinates,
  to: Coordinates,
) {
  const connected = path.map(
    ([latitude, longitude]) => [latitude, longitude] as Coordinates,
  );
  if (distanceMeters(from, connected[0]) > 1) {
    connected.unshift([from[0], from[1]]);
  } else {
    connected[0] = [from[0], from[1]];
  }

  const lastIndex = connected.length - 1;
  if (distanceMeters(connected[lastIndex], to) > 1) {
    connected.push([to[0], to[1]]);
  } else {
    connected[lastIndex] = [to[0], to[1]];
  }
  return connected;
}

function attachRequestedWaypoints(
  path: Coordinates[],
  requestedCoordinates: Coordinates[],
) {
  const connected = attachRequestedEndpoints(
    path,
    requestedCoordinates[0],
    requestedCoordinates[requestedCoordinates.length - 1],
  );
  let searchStartIndex = 1;

  for (const requested of requestedCoordinates.slice(1, -1)) {
    let closestIndex = searchStartIndex;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let index = searchStartIndex; index < connected.length - 1; index += 1) {
      const distance = distanceMeters(requested, connected[index]);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    }

    if (closestDistance <= 1) {
      connected[closestIndex] = [requested[0], requested[1]];
    } else {
      connected.splice(closestIndex, 0, [requested[0], requested[1]]);
    }
    searchStartIndex = closestIndex + 1;
  }

  return connected;
}

function shouldUseDirectCorrection(
  profile: RouteProfile,
  from: Coordinates,
  to: Coordinates,
  routeDistance: number,
  waypoints: OsrmWaypoint[],
) {
  const directDistance = distanceMeters(from, to);
  if (directDistance > MAX_DIRECT_DISTANCE_METERS) return true;

  const routeRatio = routeDistance / Math.max(1, directDistance);
  const excessiveShortWalk =
    profile === "foot" &&
    directDistance <= 250 &&
    routeDistance >= 750 &&
    routeRatio > 4;
  const excessiveSnap = waypoints.some(
    (waypoint) =>
      typeof waypoint.distance === "number" &&
      Number.isFinite(waypoint.distance) &&
      waypoint.distance > 250,
  );
  return excessiveShortWalk || excessiveSnap;
}

type OsrmRouteResult = {
  route: OsrmRoute;
  routeDistance: number;
  durationSeconds: number;
  path: Coordinates[];
  waypoints: OsrmWaypoint[];
};

async function requestOsrmRoute(
  profile: RouteProfile,
  coordinates: Coordinates[],
): Promise<OsrmRouteResult> {
  if (coordinates.length < 2 || coordinates.some((coordinate) => !isCoordinates(coordinate))) {
    throw new Error("Route coordinates are invalid.");
  }
  if (
    coordinates
      .slice(0, -1)
      .some((coordinate, index) =>
        distanceMeters(coordinate, coordinates[index + 1]) > MAX_DIRECT_DISTANCE_METERS,
      )
  ) {
    throw new Error("Route is outside the prototype service area.");
  }

  const response = await scheduleRequest(async () => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(buildRouteUrl(profile, coordinates), {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  });

  if (!response.ok) throw new Error(`OSRM returned ${response.status}.`);

  const payload = (await response.json()) as OsrmResponse;
  if (payload.code !== "Ok" || !Array.isArray(payload.routes) || !payload.routes.length) {
    throw new Error("OSRM could not find a route.");
  }

  const route = payload.routes[0] as OsrmRoute;
  const routeDistance = readFiniteNumber(route.distance, "distance");
  const durationSeconds = readFiniteNumber(route.duration, "duration");
  const waypoints = Array.isArray(payload.waypoints)
    ? (payload.waypoints as OsrmWaypoint[])
    : [];

  return {
    route,
    routeDistance,
    durationSeconds,
    path: parsePath(route),
    waypoints,
  };
}

async function requestOsrmSegment(
  profile: RouteProfile,
  from: Coordinates,
  to: Coordinates,
): Promise<RouteSegment> {
  const { routeDistance, durationSeconds, path, waypoints } = await requestOsrmRoute(
    profile,
    [from, to],
  );

  if (shouldUseDirectCorrection(profile, from, to, routeDistance, waypoints)) {
    return createDirectSegment(from, to, profile);
  }

  return {
    path: attachRequestedEndpoints(path, from, to),
    source: "osrm",
    distanceMeters: routeDistance,
    durationSeconds,
  };
}

async function requestOsrmBikeRoute(
  coordinates: Coordinates[],
): Promise<{ segment: RouteSegment; legs: BikeRouteLeg[] }> {
  const { route, routeDistance, path, waypoints } =
    await requestOsrmRoute("bike", coordinates);
  const from = coordinates[0];
  const to = coordinates[coordinates.length - 1];

  if (shouldUseDirectCorrection("bike", from, to, routeDistance, waypoints)) {
    return createDirectBikeRoute(coordinates);
  }
  if (!Array.isArray(route.legs) || route.legs.length !== coordinates.length - 1) {
    throw new Error("OSRM did not return the expected bicycle route legs.");
  }

  const snapDistances = coordinates.map((_, index) => {
    const distance = waypoints[index]?.distance;
    return typeof distance === "number" && Number.isFinite(distance) && distance > 0
      ? distance
      : 0;
  });
  const bicycleMetersPerSecond = 245 / 60;

  const legs = route.legs.map((rawLeg, index) => {
    if (!rawLeg || typeof rawLeg !== "object") {
      throw new Error(`OSRM returned an invalid bicycle route leg ${index + 1}.`);
    }
    const leg = rawLeg as { distance?: unknown; duration?: unknown };
    const connectorDistance = snapDistances[index] + snapDistances[index + 1];
    return {
      source: "osrm" as const,
      distanceMeters:
        readFiniteNumber(leg.distance, `leg ${index + 1} distance`) +
        connectorDistance,
      durationSeconds:
        readFiniteNumber(leg.duration, `leg ${index + 1} duration`) +
        connectorDistance / bicycleMetersPerSecond,
    };
  });

  return {
    segment: {
      path: attachRequestedWaypoints(path, coordinates),
      source: "osrm",
      distanceMeters: legs.reduce((total, leg) => total + leg.distanceMeters, 0),
      durationSeconds: legs.reduce((total, leg) => total + leg.durationSeconds, 0),
    },
    legs,
  };
}

function rememberSegment(key: string, segment: RouteSegment) {
  if (resolvedSegmentCache.has(key)) resolvedSegmentCache.delete(key);
  resolvedSegmentCache.set(key, segment);
  while (resolvedSegmentCache.size > SEGMENT_CACHE_LIMIT) {
    const oldestKey = resolvedSegmentCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    resolvedSegmentCache.delete(oldestKey);
  }
}

function loadSegment(profile: RouteProfile, from: Coordinates, to: Coordinates) {
  const key = segmentKey(profile, from, to);
  const resolved = resolvedSegmentCache.get(key);
  if (resolved) {
    rememberSegment(key, resolved);
    return Promise.resolve(resolved);
  }

  const inFlight = inFlightSegmentCache.get(key);
  if (inFlight) return inFlight;

  const pending = requestOsrmSegment(profile, from, to)
    .then((segment) => {
      rememberSegment(key, segment);
      return segment;
    })
    .finally(() => inFlightSegmentCache.delete(key));
  inFlightSegmentCache.set(key, pending);
  return pending;
}

function rememberBikeRoute(
  key: string,
  route: { segment: RouteSegment; legs: BikeRouteLeg[] },
) {
  if (resolvedBikeRouteCache.has(key)) resolvedBikeRouteCache.delete(key);
  resolvedBikeRouteCache.set(key, route);
  while (resolvedBikeRouteCache.size > SEGMENT_CACHE_LIMIT) {
    const oldestKey = resolvedBikeRouteCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    resolvedBikeRouteCache.delete(oldestKey);
  }
}

function loadBikeRoute(coordinates: Coordinates[]) {
  const key = bikeRouteKey(coordinates);
  const resolved = resolvedBikeRouteCache.get(key);
  if (resolved) {
    rememberBikeRoute(key, resolved);
    return Promise.resolve(resolved);
  }

  const inFlight = inFlightBikeRouteCache.get(key);
  if (inFlight) return inFlight;

  const pending = requestOsrmBikeRoute(coordinates)
    .then((route) => {
      rememberBikeRoute(key, route);
      return route;
    })
    .finally(() => inFlightBikeRouteCache.delete(key));
  inFlightBikeRouteCache.set(key, pending);
  return pending;
}

export async function loadRouteGeometry(
  input: RouteGeometryInput,
): Promise<RouteGeometry> {
  const directGeometry = createDirectRouteGeometry(input);
  const result: RouteGeometry = { ...directGeometry };

  try {
    result.walkTo = await loadSegment("foot", input.origin, input.startStation);
  } catch {
    result.walkTo = directGeometry.walkTo;
  }

  try {
    const bikeRoute = await loadBikeRoute(getBikeCoordinates(input));
    result.bike = bikeRoute.segment;
    result.bikeLegs = bikeRoute.legs;
  } catch {
    result.bike = directGeometry.bike;
    result.bikeLegs = directGeometry.bikeLegs;
  }

  try {
    result.walkFrom = await loadSegment("foot", input.endStation, input.destination);
  } catch {
    result.walkFrom = directGeometry.walkFrom;
  }

  if ([result.walkTo, result.bike, result.walkFrom].every(({ source }) => source === "direct")) {
    throw new Error("Road route geometry is temporarily unavailable.");
  }
  return result;
}
