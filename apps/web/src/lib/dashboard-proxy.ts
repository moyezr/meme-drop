import "server-only";

import { auth } from "../auth";
import { createDashboardAssertion } from "./dashboard-assertion";
import {
  dashboardJsonError,
  dashboardNoStoreHeaders,
  normalizedUpstreamError,
  validatedRequestId,
  validateDashboardApiOrigin,
} from "./dashboard-proxy-core";

export { requireSameOriginMutation } from "./dashboard-proxy-core";

const DASHBOARD_REQUEST_TIMEOUT_MS = 10_000;
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export interface DashboardProxyInit {
  method?: "GET" | "POST";
  body?: string;
  idempotencyKey?: string;
  requestId?: string;
}

export async function proxyDashboardRequest(
  path: string,
  init: DashboardProxyInit = {},
): Promise<Response> {
  const requestId = validatedRequestId(init.requestId ?? null);
  const session = await auth();
  if (!session?.user?.provider || !session.user.providerAccountId) {
    return dashboardJsonError(401, "authentication_required", requestId);
  }

  try {
    const origin = dashboardApiOrigin();
    const assertion = await createDashboardAssertion({
      provider: session.user.provider,
      providerAccountId: session.user.providerAccountId,
      email: session.user.email,
    });
    const upstream = await fetch(new URL(path, `${origin}/`), {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${assertion}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(init.idempotencyKey === undefined
          ? {}
          : { "Idempotency-Key": init.idempotencyKey }),
        ...(requestId === undefined ? {} : { "x-request-id": requestId }),
      },
      body: init.body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(DASHBOARD_REQUEST_TIMEOUT_MS),
    });

    const responseRequestId = validatedRequestId(upstream.headers.get("x-request-id"));
    if (upstream.status === 204) {
      return new Response(null, {
        status: 204,
        headers: dashboardNoStoreHeaders(undefined, responseRequestId),
      });
    }

    if (!upstream.ok) {
      await upstream.body?.cancel();
      return normalizedUpstreamError(upstream.status, responseRequestId);
    }

    const contentType = upstream.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      return dashboardJsonError(
        502,
        "dashboard_api_invalid_response",
        responseRequestId,
      );
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: dashboardNoStoreHeaders(JSON_CONTENT_TYPE, responseRequestId),
    });
  } catch {
    return dashboardJsonError(502, "dashboard_api_unavailable", requestId);
  }
}

export async function readBoundedJsonBody(
  request: Request,
  maxBytes = 4_096,
): Promise<string | Response> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return dashboardJsonError(
      415,
      "json_content_type_required",
      validatedRequestId(request.headers.get("x-request-id")),
    );
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    return dashboardJsonError(
      413,
      "request_body_too_large",
      validatedRequestId(request.headers.get("x-request-id")),
    );
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    return dashboardJsonError(
      413,
      "request_body_too_large",
      validatedRequestId(request.headers.get("x-request-id")),
    );
  }
  return body;
}

function dashboardApiOrigin(): string {
  return validateDashboardApiOrigin(process.env.MEMEDROP_API_BASE_URL, {
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
  });
}
