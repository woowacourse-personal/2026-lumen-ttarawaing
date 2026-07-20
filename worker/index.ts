/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  KAKAO_JAVASCRIPT_KEY?: string;
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
        const upstream = await fetch(BIKE_SEOUL_REALTIME_URL, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            Referer: "https://www.bikeseoul.com/app/station/moveStationRealtimeStatus.do",
          },
          body: new URLSearchParams({ stationGrpSeq: "ALL" }),
        });

        if (!upstream.ok) throw new Error(`Bike Seoul returned ${upstream.status}.`);

        const payload = (await upstream.json()) as Record<string, unknown>;
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
