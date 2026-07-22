export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KAKAO_ROUTE_ORIGIN = "https://dapi.kakao.com";
const KAKAO_ROUTE_TIMEOUT_MS = 10_000;
const KAKAO_ROUTE_MAX_WAYPOINTS = 5;
const ROUTE_PROFILE_HEADER = "X-Ttarawaing-Route-Profile";
const BIKE_ROUTE_MODE_HEADER = "X-Ttarawaing-Bike-Route-Mode";
const REQUEST_FIELDS = new Set(["mode", "coordinates", "bikeRouteMode"]);
const BIKE_ROUTE_MODES = new Set(["BIKE_ONLY", "SHORTEST", "ACCESSIBLE"]);

type KakaoRouteMode = "walk" | "bike";
type KakaoBikeRouteMode = "BIKE_ONLY" | "SHORTEST" | "ACCESSIBLE";
type RouteCoordinate = [latitude: number, longitude: number];

type KakaoRouteRequest = {
  mode: KakaoRouteMode;
  coordinates: RouteCoordinate[];
  bikeRouteMode: KakaoBikeRouteMode;
};

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function errorResponse(
  status: number,
  code: string,
  error: string,
  extraHeaders?: HeadersInit,
) {
  return Response.json(
    { error, code },
    {
      status,
      headers: { ...RESPONSE_HEADERS, ...extraHeaders },
    },
  );
}

function parseRequest(value: unknown):
  | { request: KakaoRouteRequest; error?: never }
  | { request?: never; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "The request body must be a JSON object." };
  }

  const payload = value as Record<string, unknown>;
  const unknownField = Object.keys(payload).find(
    (field) => !REQUEST_FIELDS.has(field),
  );
  if (unknownField) {
    return { error: `Unsupported request field: ${unknownField}.` };
  }

  if (payload.mode !== "walk" && payload.mode !== "bike") {
    return { error: "mode must be either walk or bike." };
  }
  if (!Array.isArray(payload.coordinates)) {
    return { error: "coordinates must be an array." };
  }

  const maximumCoordinates = KAKAO_ROUTE_MAX_WAYPOINTS + 2;
  if (
    payload.coordinates.length < 2 ||
    payload.coordinates.length > maximumCoordinates
  ) {
    return {
      error: `coordinates must contain an origin, a destination, and no more than ${KAKAO_ROUTE_MAX_WAYPOINTS} waypoints.`,
    };
  }

  const coordinates: RouteCoordinate[] = [];
  for (const coordinate of payload.coordinates) {
    if (!Array.isArray(coordinate) || coordinate.length !== 2) {
      return { error: "Each coordinate must be a [latitude, longitude] pair." };
    }

    const [latitude, longitude] = coordinate;
    if (
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      typeof longitude !== "number" ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      return { error: "coordinates must contain valid WGS84 numbers." };
    }
    coordinates.push([latitude, longitude]);
  }

  const bikeRouteMode = payload.bikeRouteMode ?? "BIKE_ONLY";
  if (
    typeof bikeRouteMode !== "string" ||
    !BIKE_ROUTE_MODES.has(bikeRouteMode)
  ) {
    return {
      error: "bikeRouteMode must be BIKE_ONLY, SHORTEST, or ACCESSIBLE.",
    };
  }

  return {
    request: {
      mode: payload.mode,
      coordinates,
      bikeRouteMode: bikeRouteMode as KakaoBikeRouteMode,
    },
  };
}

function buildRouteUrl(routeRequest: KakaoRouteRequest) {
  const endpoint = routeRequest.mode === "walk" ? "walk" : "bicycle";
  const url = new URL(`/v2/routing/${endpoint}`, KAKAO_ROUTE_ORIGIN);
  const origin = routeRequest.coordinates[0];
  const destination = routeRequest.coordinates.at(-1)!;
  const waypoints = routeRequest.coordinates.slice(1, -1);

  url.searchParams.set("start_x", String(origin[1]));
  url.searchParams.set("start_y", String(origin[0]));
  url.searchParams.set("end_x", String(destination[1]));
  url.searchParams.set("end_y", String(destination[0]));

  if (waypoints.length > 0) {
    url.searchParams.set(
      "via_x",
      waypoints.map((coordinate) => coordinate[1]).join(","),
    );
    url.searchParams.set(
      "via_y",
      waypoints.map((coordinate) => coordinate[0]).join(","),
    );
  }
  if (routeRequest.mode === "bike") {
    url.searchParams.set("route_mode", routeRequest.bikeRouteMode);
  }

  return url;
}

function parseJsonBytes(body: ArrayBuffer) {
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    return null;
  }
}

function normalizeUpstreamError(status: number, payload: unknown) {
  const kakaoCode =
    payload &&
    typeof payload === "object" &&
    typeof (payload as Record<string, unknown>).code === "number"
      ? (payload as Record<string, number>).code
      : null;

  if (status === 429 || kakaoCode === -10) {
    return errorResponse(
      503,
      "ROUTE_PROVIDER_QUOTA_EXCEEDED",
      "Route calculation is temporarily unavailable.",
    );
  }
  if (
    status === 401 ||
    status === 403 ||
    kakaoCode === -401 ||
    kakaoCode === -3
  ) {
    return errorResponse(
      503,
      "ROUTE_PROVIDER_CONFIGURATION_ERROR",
      "Route calculation is not configured correctly.",
    );
  }
  return errorResponse(
    502,
    "ROUTE_PROVIDER_ERROR",
    "The route provider could not complete the request.",
  );
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type");
  if (contentType && !contentType.toLowerCase().includes("application/json")) {
    return errorResponse(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "The request body must use application/json.",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "The request body must contain valid JSON.",
    );
  }

  const parsed = parseRequest(body);
  if (!parsed.request) {
    return errorResponse(400, "INVALID_REQUEST", parsed.error);
  }

  const restApiKey = process.env.KAKAO_REST_API_KEY;
  if (!restApiKey) {
    return errorResponse(
      503,
      "ROUTE_PROVIDER_NOT_CONFIGURED",
      "Route calculation is not configured.",
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () =>
      controller.abort(
        new DOMException("The Kakao route request timed out.", "TimeoutError"),
      ),
    KAKAO_ROUTE_TIMEOUT_MS,
  );

  try {
    const upstream = await fetch(buildRouteUrl(parsed.request), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `KakaoAK ${restApiKey}`,
      },
      signal: controller.signal,
    });
    const upstreamBody = await upstream.arrayBuffer();
    const upstreamJson = parseJsonBytes(upstreamBody);

    if (!upstream.ok) {
      return normalizeUpstreamError(upstream.status, upstreamJson);
    }
    if (upstreamJson === null) {
      return errorResponse(
        502,
        "INVALID_ROUTE_PROVIDER_RESPONSE",
        "The route provider returned an invalid response.",
      );
    }

    return new Response(upstreamBody, {
      status: upstream.status,
      headers: {
        ...RESPONSE_HEADERS,
        "Content-Type": "application/json; charset=UTF-8",
        [ROUTE_PROFILE_HEADER]: parsed.request.mode,
        ...(parsed.request.mode === "bike"
          ? { [BIKE_ROUTE_MODE_HEADER]: parsed.request.bikeRouteMode }
          : {}),
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return errorResponse(
        504,
        "ROUTE_PROVIDER_TIMEOUT",
        "Route calculation timed out.",
      );
    }
    console.error(
      "Kakao route request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return errorResponse(
      502,
      "ROUTE_PROVIDER_UNAVAILABLE",
      "The route provider is temporarily unavailable.",
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
