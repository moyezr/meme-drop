export interface DashboardApiKey {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface DashboardOverview {
  user: {
    id: string;
    email: string | null;
    credits: number;
    created_at: string;
  };
  api_keys: DashboardApiKey[];
}

export interface IssuedDashboardApiKey {
  api_key: DashboardApiKey;
  credential: string;
}

export interface RevokedDashboardApiKey {
  api_key: DashboardApiKey;
}

const ERROR_MESSAGES: Record<string, string> = {
  authentication_required: "Your session has expired. Sign in again to continue.",
  dashboard_request_invalid: "Check the request and try again.",
  dashboard_resource_not_found: "That API key is no longer available.",
  dashboard_conflict: "That request conflicts with an earlier API-key request.",
  dashboard_rate_limited: "You can have up to five active API keys. Revoke one to continue.",
  dashboard_api_auth_failed: "MemeDrop could not verify the dashboard connection.",
  dashboard_api_invalid_response: "MemeDrop returned an unexpected dashboard response.",
  dashboard_api_unavailable: "The dashboard service is temporarily unavailable.",
  invalid_idempotency_key: "The API-key request could not be safely retried.",
  invalid_api_key_id: "That API key identifier is invalid.",
  invalid_request_origin: "The dashboard rejected this request origin.",
  json_content_type_required: "The dashboard request format is invalid.",
  request_body_too_large: "The dashboard request is too large.",
};

export async function dashboardResponseError(response: Response): Promise<Error> {
  let code = "dashboard_api_unavailable";
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    if (typeof body.error?.code === "string") {
      code = body.error.code;
    }
  } catch {
    // The same-origin bridge normally returns JSON. Keep malformed responses generic.
  }
  return new Error(ERROR_MESSAGES[code] ?? "The dashboard request could not be completed.");
}

export function mergeDashboardApiKey(
  apiKeys: DashboardApiKey[],
  next: DashboardApiKey,
): DashboardApiKey[] {
  const existingIndex = apiKeys.findIndex((apiKey) => apiKey.id === next.id);
  if (existingIndex === -1) {
    return [...apiKeys, next];
  }
  return apiKeys.map((apiKey, index) => (index === existingIndex ? next : apiKey));
}
