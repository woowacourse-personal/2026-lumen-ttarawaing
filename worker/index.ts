/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  KAKAO_JAVASCRIPT_KEY?: string;
  KAKAO_REST_API_KEY?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const BIKE_SEOUL_REALTIME_URL =
  "https://www.bikeseoul.com/app/station/getStationRealtimeStatus.do";
const BIKE_SEOUL_REALTIME_TIMEOUT_MS = 10_000;
const KAKAO_ROUTE_ORIGIN = "https://dapi.kakao.com";
const KAKAO_ROUTE_TIMEOUT_MS = 10_000;
const KAKAO_ROUTE_MAX_WAYPOINTS = 5;
const KAKAO_ROUTE_REQUEST_FIELDS = new Set([
  "mode",
  "coordinates",
  "bikeRouteMode",
]);
const KAKAO_BIKE_ROUTE_MODES = new Set([
  "BIKE_ONLY",
  "SHORTEST",
  "ACCESSIBLE",
]);

type KakaoRouteMode = "walk" | "bike";
type KakaoBikeRouteMode = "BIKE_ONLY" | "SHORTEST" | "ACCESSIBLE";
type RouteCoordinate = [latitude: number, longitude: number];

interface KakaoRouteRequest {
  mode: KakaoRouteMode;
  coordinates: RouteCoordinate[];
  bikeRouteMode: KakaoBikeRouteMode;
}

interface ParsedRouteRequest {
  request?: KakaoRouteRequest;
  error?: string;
}

const ROUTE_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function routeErrorResponse(
  status: number,
  code: string,
  error: string,
  extraHeaders?: HeadersInit,
) {
  return Response.json(
    { error, code },
    {
      status,
      headers: {
        ...ROUTE_RESPONSE_HEADERS,
        ...extraHeaders,
      },
    },
  );
}

function parseKakaoRouteRequest(value: unknown): ParsedRouteRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "The request body must be a JSON object." };
  }

  const payload = value as Record<string, unknown>;
  const unknownField = Object.keys(payload).find(
    (field) => !KAKAO_ROUTE_REQUEST_FIELDS.has(field),
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
    !KAKAO_BIKE_ROUTE_MODES.has(bikeRouteMode)
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

function buildKakaoRouteUrl(routeRequest: KakaoRouteRequest) {
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

function normalizeKakaoUpstreamError(status: number, payload: unknown) {
  const kakaoCode =
    payload &&
    typeof payload === "object" &&
    typeof (payload as Record<string, unknown>).code === "number"
      ? (payload as Record<string, number>).code
      : null;

  if (status === 429 || kakaoCode === -10) {
    return routeErrorResponse(
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
    return routeErrorResponse(
      503,
      "ROUTE_PROVIDER_CONFIGURATION_ERROR",
      "Route calculation is not configured correctly.",
    );
  }

  return routeErrorResponse(
    502,
    "ROUTE_PROVIDER_ERROR",
    "The route provider could not complete the request.",
  );
}

async function handleKakaoRouteRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return routeErrorResponse(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed.",
      { Allow: "POST" },
    );
  }

  const contentType = request.headers.get("content-type");
  if (contentType && !contentType.toLowerCase().includes("application/json")) {
    return routeErrorResponse(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "The request body must use application/json.",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return routeErrorResponse(
      400,
      "INVALID_REQUEST",
      "The request body must contain valid JSON.",
    );
  }

  const parsed = parseKakaoRouteRequest(body);
  if (!parsed.request) {
    return routeErrorResponse(
      400,
      "INVALID_REQUEST",
      parsed.error ?? "The route request is invalid.",
    );
  }

  if (!env.KAKAO_REST_API_KEY) {
    return routeErrorResponse(
      503,
      "ROUTE_PROVIDER_NOT_CONFIGURED",
      "Route calculation is not configured.",
    );
  }

  const controller = new AbortController();
  let timedOut = false;
  let rejectInterruption: (reason: unknown) => void = () => {};
  const interruption = new Promise<never>((_resolve, reject) => {
    rejectInterruption = reject;
  });
  const abortFromClient = () => {
    const reason =
      request.signal.reason ??
      new DOMException("The route request was cancelled.", "AbortError");
    controller.abort(reason);
    rejectInterruption(reason);
  };
  request.signal.addEventListener("abort", abortFromClient, { once: true });

  const timeoutId = setTimeout(() => {
    timedOut = true;
    const reason = new DOMException(
      "The Kakao route request timed out.",
      "TimeoutError",
    );
    controller.abort(reason);
    rejectInterruption(reason);
  }, KAKAO_ROUTE_TIMEOUT_MS);

  if (request.signal.aborted) abortFromClient();

  try {
    const upstreamRequest = (async () => {
      const upstream = await fetch(buildKakaoRouteUrl(parsed.request!), {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}`,
        },
        signal: controller.signal,
      });
      const upstreamBody = await upstream.arrayBuffer();
      return { upstream, upstreamBody };
    })();

    const { upstream, upstreamBody } = await Promise.race([
      upstreamRequest,
      interruption,
    ]);
    const upstreamJson = parseJsonBytes(upstreamBody);

    if (!upstream.ok) {
      return normalizeKakaoUpstreamError(upstream.status, upstreamJson);
    }

    if (upstreamJson === null) {
      return routeErrorResponse(
        502,
        "INVALID_ROUTE_PROVIDER_RESPONSE",
        "The route provider returned an invalid response.",
      );
    }

    return new Response(upstreamBody, {
      status: upstream.status,
      headers: {
        ...ROUTE_RESPONSE_HEADERS,
        "Content-Type": "application/json; charset=UTF-8",
      },
    });
  } catch (error) {
    if (timedOut) {
      return routeErrorResponse(
        504,
        "ROUTE_PROVIDER_TIMEOUT",
        "Route calculation timed out.",
      );
    }

    if (request.signal.aborted) {
      return routeErrorResponse(
        499,
        "REQUEST_ABORTED",
        "The route request was cancelled.",
      );
    }

    console.error(
      "Kakao route request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return routeErrorResponse(
      502,
      "ROUTE_PROVIDER_UNAVAILABLE",
      "The route provider is temporarily unavailable.",
    );
  } finally {
    clearTimeout(timeoutId);
    request.signal.removeEventListener("abort", abortFromClient);
  }
}

function getBikeCount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function parseRealtimeBikeStation(value: unknown) {
  if (!value || typeof value !== "object") return null;

  const station = value as Record<string, unknown>;
  const stationName = typeof station.stationName === "string" ? station.stationName : "";
  const numberMatch = stationName.match(/^\s*(\d+)\./);
  if (!numberMatch) return null;

  return {
    id: numberMatch[1],
    availableBikes:
      getBikeCount(station.parkingBikeTotCnt) +
      getBikeCount(station.parkingQRBikeCnt) +
      getBikeCount(station.parkingELECBikeCnt),
  };
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/routes") {
      return handleKakaoRouteRequest(request, env);
    }

    if (url.pathname === "/api/config/kakao") {
      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET" },
        });
      }

      if (!env.KAKAO_JAVASCRIPT_KEY) {
        return Response.json(
          { error: "Kakao Maps is not configured." },
          {
            status: 503,
            headers: {
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            },
          },
        );
      }

      return Response.json(
        { javascriptKey: env.KAKAO_JAVASCRIPT_KEY },
        {
          headers: {
            "Cache-Control": "public, max-age=300",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }

    if (url.pathname === "/api/bike-stations/realtime") {
      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET" },
        });
      }

      try {
        const controller = new AbortController();
        const abortFromClient = () => controller.abort(request.signal.reason);
        request.signal.addEventListener("abort", abortFromClient, { once: true });
        const timeoutId = setTimeout(
          () =>
            controller.abort(
              new DOMException("Bike Seoul request timed out.", "TimeoutError"),
            ),
          BIKE_SEOUL_REALTIME_TIMEOUT_MS,
        );
        let upstream: Response;
        let payload: Record<string, unknown>;
        try {
          upstream = await fetch(BIKE_SEOUL_REALTIME_URL, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
              Referer: "https://www.bikeseoul.com/app/station/moveStationRealtimeStatus.do",
            },
            body: new URLSearchParams({ stationGrpSeq: "ALL" }),
            signal: controller.signal,
          });

          if (!upstream.ok) {
            throw new Error(`Bike Seoul returned ${upstream.status}.`);
          }
          payload = (await upstream.json()) as Record<string, unknown>;
        } finally {
          clearTimeout(timeoutId);
          request.signal.removeEventListener("abort", abortFromClient);
        }

        const rawStations = Array.isArray(payload.realtimeList)
          ? payload.realtimeList
          : [];
        const parsedStations = rawStations
          .map(parseRealtimeBikeStation)
          .filter((station): station is NonNullable<typeof station> => station !== null);
        const stations = [
          ...new Map(parsedStations.map((station) => [station.id, station])).values(),
        ];

        if (stations.length < 2_700) {
          throw new Error("Bike Seoul returned an incomplete station list.");
        }

        return Response.json(
          { updatedAt: new Date().toISOString(), stations },
          {
            headers: {
              "Cache-Control": "public, max-age=20, stale-while-revalidate=90",
              "X-Content-Type-Options": "nosniff",
            },
          },
        );
      } catch (error) {
        console.error("Bike Seoul realtime request failed", error);
        return Response.json(
          { error: "Realtime bike station data is temporarily unavailable." },
          {
            status: 502,
            headers: {
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            },
          },
        );
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
