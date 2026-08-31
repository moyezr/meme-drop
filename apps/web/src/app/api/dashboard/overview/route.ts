import { proxyDashboardRequest } from "../../../../lib/dashboard-proxy";
import { validatedRequestId } from "../../../../lib/dashboard-proxy-core";

export async function GET(request: Request): Promise<Response> {
  return proxyDashboardRequest("/api/v1/dashboard/overview", {
    requestId: validatedRequestId(request.headers.get("x-request-id")),
  });
}
