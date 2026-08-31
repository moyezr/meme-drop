import {
  proxyDashboardRequest,
  requireSameOriginMutation,
} from "../../../../../../lib/dashboard-proxy";
import {
  dashboardJsonError,
  validatedRequestId,
} from "../../../../../../lib/dashboard-proxy-core";

const API_KEY_ID_PATTERN = /^k_[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{12}$/;

export async function POST(
  request: Request,
  context: { params: Promise<{ keyId: string }> },
): Promise<Response> {
  const originError = requireSameOriginMutation(request);
  if (originError) {
    return originError;
  }
  const { keyId } = await context.params;
  if (!API_KEY_ID_PATTERN.test(keyId)) {
    return dashboardJsonError(
      400,
      "invalid_api_key_id",
      validatedRequestId(request.headers.get("x-request-id")),
    );
  }

  return proxyDashboardRequest(`/api/v1/dashboard/api-keys/${keyId}/revoke`, {
    method: "POST",
    requestId: validatedRequestId(request.headers.get("x-request-id")),
  });
}
