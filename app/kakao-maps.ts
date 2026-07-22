export type KakaoPlaceResult = {
  id: string;
  place_name: string;
  category_name: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
};

export type KakaoLatLng = {
  getLat(): number;
  getLng(): number;
};

export type KakaoLatLngBounds = {
  extend(position: KakaoLatLng): void;
};

export type KakaoMap = {
  getCenter(): KakaoLatLng;
  setCenter(position: KakaoLatLng): void;
  setBounds(
    bounds: KakaoLatLngBounds,
    paddingTop?: number,
    paddingRight?: number,
    paddingBottom?: number,
    paddingLeft?: number,
  ): void;
  relayout(): void;
  panTo(position: KakaoLatLng): void;
  setLevel(level: number): void;
};

export type KakaoMapObject = {
  setMap(map: KakaoMap | null): void;
};

export type KakaoCustomOverlay = KakaoMapObject & {
  setPosition(position: KakaoLatLng): void;
};

type KakaoPlaces = {
  keywordSearch(
    keyword: string,
    callback: (
      results: KakaoPlaceResult[],
      status: string,
      pagination: unknown,
    ) => void,
    options?: {
      page?: number;
      size?: number;
      sort?: string;
    },
  ): void;
};

export type KakaoSdk = {
  maps: {
    load(callback: () => void): void;
    Map: new (
      container: HTMLElement,
      options: { center: KakaoLatLng; level: number },
    ) => KakaoMap;
    LatLng: new (latitude: number, longitude: number) => KakaoLatLng;
    LatLngBounds: new () => KakaoLatLngBounds;
    Polyline: new (options: {
      map: KakaoMap;
      path: KakaoLatLng[];
      strokeWeight: number;
      strokeColor: string;
      strokeOpacity: number;
      strokeStyle?: string;
      zIndex?: number;
    }) => KakaoMapObject;
    CustomOverlay: new (options: {
      map: KakaoMap;
      position: KakaoLatLng;
      content: HTMLElement;
      clickable?: boolean;
      xAnchor?: number;
      yAnchor?: number;
      zIndex?: number;
    }) => KakaoCustomOverlay;
    event: {
      addListener(
        target: KakaoMap,
        type: string,
        handler: () => void,
      ): void;
      removeListener(
        target: KakaoMap,
        type: string,
        handler: () => void,
      ): void;
    };
    services: {
      Places: new () => KakaoPlaces;
      Status: {
        OK: string;
        ZERO_RESULT: string;
        ERROR: string;
      };
      SortBy: {
        ACCURACY: string;
        DISTANCE: string;
      };
    };
  };
};

declare global {
  interface Window {
    kakao?: KakaoSdk;
  }
}

const KAKAO_SDK_ID = "kakao-maps-javascript-sdk";
const KAKAO_CONFIG_ENDPOINT = "/api/config/kakao";
const SDK_LOAD_TIMEOUT_MS = 10_000;
export const KAKAO_CONFIG_TIMEOUT_MS = 8_000;
export const KAKAO_PLACE_SEARCH_TIMEOUT_MS = 8_000;

let kakaoSdkPromise: Promise<KakaoSdk> | null = null;

function runWithTimeout<T>(
  timeoutMs: number,
  timeoutMessage: string,
  operation: (signal: AbortSignal) => Promise<T>,
) {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeoutId);
      callback();
    };
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => {
      const timeoutError = new Error(timeoutMessage);
      finish(() => {
        reject(timeoutError);
        controller.abort(timeoutError);
      });
    }, timeoutMs);

    void Promise.resolve()
      .then(() => operation(controller.signal))
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
  });
}

export async function getKakaoJavascriptKey(
  timeoutMs = KAKAO_CONFIG_TIMEOUT_MS,
) {
  return runWithTimeout(
    timeoutMs,
    "Kakao Maps configuration request timed out.",
    async (signal) => {
      const response = await fetch(KAKAO_CONFIG_ENDPOINT, {
        headers: { accept: "application/json" },
        signal,
      });

      if (!response.ok) {
        throw new Error("Kakao Maps configuration is unavailable.");
      }

      const body = (await response.json()) as { javascriptKey?: unknown };
      if (
        typeof body.javascriptKey !== "string" ||
        !body.javascriptKey.trim()
      ) {
        throw new Error("Kakao Maps JavaScript key is missing.");
      }

      return body.javascriptKey;
    },
  );
}

function initializeKakaoSdk(resolve: (sdk: KakaoSdk) => void, reject: (error: Error) => void) {
  const sdk = window.kakao;
  if (!sdk?.maps?.load) {
    reject(new Error("Kakao Maps SDK did not initialize."));
    return;
  }

  sdk.maps.load(() => {
    if (!sdk.maps.services?.Places) {
      reject(new Error("Kakao Maps services library did not initialize."));
      return;
    }
    resolve(sdk);
  });
}

export function loadKakaoMapsSdk() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Kakao Maps SDK is only available in the browser."));
  }

  if (window.kakao?.maps?.services?.Places) {
    return Promise.resolve(window.kakao);
  }

  if (kakaoSdkPromise) return kakaoSdkPromise;

  const pendingSdk = getKakaoJavascriptKey().then(
    (javascriptKey) =>
      new Promise<KakaoSdk>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          callback();
        };
        const resolveSdk = (sdk: KakaoSdk) => finish(() => resolve(sdk));
        const rejectSdk = (error: Error) => finish(() => reject(error));
        const timeoutId = window.setTimeout(
          () => rejectSdk(new Error("Kakao Maps SDK load timed out.")),
          SDK_LOAD_TIMEOUT_MS,
        );

        const existingScript = document.getElementById(
          KAKAO_SDK_ID,
        ) as HTMLScriptElement | null;

        if (existingScript) {
          if (window.kakao) {
            initializeKakaoSdk(resolveSdk, rejectSdk);
            return;
          }
          existingScript.addEventListener(
            "load",
            () => initializeKakaoSdk(resolveSdk, rejectSdk),
            { once: true },
          );
          existingScript.addEventListener(
            "error",
            () => rejectSdk(new Error("Kakao Maps SDK could not be loaded.")),
            { once: true },
          );
          return;
        }

        const script = document.createElement("script");
        script.id = KAKAO_SDK_ID;
        script.async = true;
        script.src =
          `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(javascriptKey)}` +
          "&autoload=false&libraries=services";
        script.addEventListener(
          "load",
          () => initializeKakaoSdk(resolveSdk, rejectSdk),
          { once: true },
        );
        script.addEventListener(
          "error",
          () => rejectSdk(new Error("Kakao Maps SDK could not be loaded.")),
          { once: true },
        );
        document.head.appendChild(script);
      }),
  );
  kakaoSdkPromise = pendingSdk;
  void pendingSdk.catch(() => {
    if (kakaoSdkPromise === pendingSdk) kakaoSdkPromise = null;
    document.getElementById(KAKAO_SDK_ID)?.remove();
  });

  return pendingSdk;
}

export function searchKakaoKeyword(
  sdk: KakaoSdk,
  keyword: string,
  timeoutMs = KAKAO_PLACE_SEARCH_TIMEOUT_MS,
) {
  return new Promise<KakaoPlaceResult[]>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeoutId);
      callback();
    };
    const timeoutId = globalThis.setTimeout(
      () =>
        finish(() =>
          reject(new Error("Kakao place search request timed out.")),
        ),
      timeoutMs,
    );

    try {
      const places = new sdk.maps.services.Places();
      places.keywordSearch(
        keyword,
        (results, status) => {
          if (status === sdk.maps.services.Status.OK) {
            finish(() => resolve(results));
            return;
          }
          if (status === sdk.maps.services.Status.ZERO_RESULT) {
            finish(() => resolve([]));
            return;
          }
          finish(() => reject(new Error("Kakao place search failed.")));
        },
        {
          page: 1,
          size: 10,
          sort: sdk.maps.services.SortBy.ACCURACY,
        },
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

function buildRegionalKeywords(query: string) {
  const normalized = query.trim();
  if (normalized.includes("서울") || normalized.includes("경기")) {
    return [normalized];
  }
  return [`서울 ${normalized}`, `경기 ${normalized}`];
}

function interleavePlaceResults(groups: KakaoPlaceResult[][]) {
  const merged: KakaoPlaceResult[] = [];
  const seenIds = new Set<string>();
  const longestGroup = Math.max(0, ...groups.map((group) => group.length));

  for (let index = 0; index < longestGroup && merged.length < 10; index += 1) {
    for (const group of groups) {
      const result = group[index];
      if (!result) continue;
      const resultKey = result.id || `${result.place_name}|${result.x}|${result.y}`;
      if (seenIds.has(resultKey)) continue;
      seenIds.add(resultKey);
      merged.push(result);
      if (merged.length === 10) break;
    }
  }
  return merged;
}

export function isSupportedPlaceAddress(address: string) {
  return /^(서울(?:특별시)?|경기(?:도)?)(?:\s|$)/.test(address.trim());
}

export async function searchKakaoPlaces(query: string) {
  const sdk = await loadKakaoMapsSdk();
  const requests = buildRegionalKeywords(query).map((keyword) =>
    searchKakaoKeyword(sdk, keyword),
  );
  const settledResults = await Promise.allSettled(requests);
  const successfulGroups = settledResults.flatMap((result) =>
    result.status === "fulfilled"
      ? [
          result.value.filter((place) =>
            isSupportedPlaceAddress(
              place.road_address_name || place.address_name || "",
            ),
          ),
        ]
      : [],
  );

  if (!successfulGroups.length) {
    throw new Error("Kakao place search failed.");
  }
  return interleavePlaceResults(successfulGroups);
}
