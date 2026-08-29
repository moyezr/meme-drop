const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const IDEMPOTENCY_KEY_MAX_LENGTH = 200;
const PRODUCTION_API_ORIGIN = "https://api.memedrop.moyezrabbani.dev";

export function validateDashboardApiOrigin(
  configuredOrigin: string | undefined,
  environment: { vercelEnv?: string; nodeEnv?: string },
): string {
  if (!configuredOrigin || configuredOrigin !== configuredOrigin.trim()) {
    throw new Error("MEMEDROP_API_BASE_URL is required.");
  }
  if (
    environment.vercelEnv === "production" &&
    configuredOrigin !== PRODUCTION_API_ORIGIN
  ) {
    throw new Error("The production dashboard API origin is invalid.");
  }

  const url = new URL(configuredOrigin);
  const isLoopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  const allowedProtocol =
    url.protocol === "https:" ||
    (environment.nodeEnv === "development" && url.protocol === "http:" && isLoopback);
  if (
    !allowedProtocol ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("MEMEDROP_API_BASE_URL must be an allowed origin.");
  }
  return url.origin;
}

export function validatedRequestId(value: string | null): string | undefined {
  return value && SAFE_REQUEST_ID_PATTERN.test(value) ? value : undefined;
}

export function readIdempotencyKey(request: Request): string | Response {
  const value = request.headers.get("idempotency-key");
  if (
    !value ||
    value.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
    ![...value].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 33 && codePoint <= 126;
    })
  ) {
    return dashboardJsonError(
      400,
      "invalid_idempotency_key",
      validatedRequestId(request.headers.get("x-request-id")),
    );
  }
  return value;
}

export function requireSameOriginMutation(request: Request): Response | null {
  const suppliedOrigin = request.headers.get("origin");
  if (!suppliedOrigin) {
    return dashboardJsonError(
      403,
      "invalid_request_origin",
      validatedRequestId(request.headers.get("x-request-id")),
    );
  }

  try {
    if (suppliedOrigin !== new URL(request.url).origin) {
      return dashboardJsonError(
        403,
        "invalid_request_origin",
        validatedRequestId(request.headers.get("x-request-id")),
      );
    }
  } catch {
    return dashboardJsonError(
      403,
      "invalid_request_origin",
      validatedRequestId(request.headers.get("x-request-id")),
    );
  }
  return null;
}

export function normalizedUpstreamError(
  status: number,
  requestId?: string,
): Response {
  switch (status) {
    case 400:
    case 422:
      return dashboardJsonError(400, "dashboard_request_invalid", requestId);
    case 404:
      return dashboardJsonError(404, "dashboard_resource_not_found", requestId);
    case 409:
      return dashboardJsonError(409, "dashboard_conflict", requestId);
    case 429:
      return dashboardJsonError(429, "dashboard_rate_limited", requestId);
    case 401:
    case 403:
      return dashboardJsonError(502, "dashboard_api_auth_failed", requestId);
    default:
      return dashboardJsonError(502, "dashboard_api_unavailable", requestId);
  }
}

export function dashboardJsonError(
  status: number,
  code: string,
  requestId?: string,
): Response {
  return Response.json(
    { error: { code } },
    { status, headers: dashboardNoStoreHeaders(JSON_CONTENT_TYPE, requestId) },
  );
}

export function dashboardNoStoreHeaders(
  contentType?: string,
  requestId?: string,
): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
  });
  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  const safeRequestId = validatedRequestId(requestId ?? null);
  if (safeRequestId) {
    headers.set("x-request-id", safeRequestId);
  }
  return headers;
}
