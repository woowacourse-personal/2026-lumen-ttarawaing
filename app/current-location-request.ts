export type LatestRequestGate = {
  begin(): number;
  invalidate(): void;
  isCurrent(requestId: number): boolean;
};

export function createLatestRequestGate(): LatestRequestGate {
  let latestRequestId = 0;
  return {
    begin() {
      latestRequestId += 1;
      return latestRequestId;
    },
    invalidate() {
      latestRequestId += 1;
    },
    isCurrent(requestId) {
      return latestRequestId === requestId;
    },
  };
}

export type CurrentPositionProvider = Pick<Geolocation, "getCurrentPosition">;

function toGeolocationPositionError(error: unknown): GeolocationPositionError {
  return {
    code: 2,
    message:
      error instanceof Error
        ? error.message
        : "Current position request failed.",
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  };
}

export function requestCurrentPositionOnce({
  geolocation,
  gate,
  onSuccess,
  onError,
  onUnsupported,
  options,
}: {
  geolocation: CurrentPositionProvider | null;
  gate: LatestRequestGate;
  onSuccess: PositionCallback;
  onError: PositionErrorCallback;
  onUnsupported: () => void;
  options?: PositionOptions;
}) {
  const requestId = gate.begin();
  if (!geolocation) {
    onUnsupported();
    return;
  }

  try {
    geolocation.getCurrentPosition(
      (position) => {
        if (gate.isCurrent(requestId)) onSuccess(position);
      },
      (error) => {
        if (gate.isCurrent(requestId)) onError(error);
      },
      options,
    );
  } catch (error: unknown) {
    if (!gate.isCurrent(requestId)) return;
    onError(toGeolocationPositionError(error));
  }
}
