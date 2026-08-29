import {
  proxyDashboardRequest,
  readBoundedJsonBody,
  requireSameOriginMutation,
} from "../../../../lib/dashboard-proxy";
import {
  readIdempotencyKey,
  validatedRequestId,
} from "../../../../lib/dashboard-proxy-core";

export async function POST(request: Request): Promise<Response> {
  const originError = requireSameOriginMutation(request);
  if (originError) {
    return originError;
  }
  const idempotencyKey = readIdempotencyKey(request);
  if (idempotencyKey instanceof Response) {
    return idempotencyKey;
  }
  const body = await readBoundedJsonBody(request);
  if (body instanceof Response) {
    return body;
  }
  return proxyDashboardRequest("/api/v1/dashboard/api-keys", {
    method: "POST",
    body,
    idempotencyKey,
    requestId: validatedRequestId(request.headers.get("x-request-id")),
  });
}
