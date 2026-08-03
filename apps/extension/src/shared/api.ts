import { apiUrl } from "./config";
import { withInstallIdHeaders } from "./identity";

export const REQUEST_ID_HEADER = "X-Request-Id";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly requestId: string | null
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(apiUrl(`/api/v1${path}`), {
    ...options,
    headers: await withApiRequestHeaders(options?.headers),
  });

  if (!res.ok) {
    throw await apiErrorFromResponse(res);
  }

  return res.json() as Promise<T>;
}

export async function withApiRequestHeaders(headers?: HeadersInit): Promise<Headers> {
  return withInstallIdHeaders({
    "Content-Type": "application/json",
    [REQUEST_ID_HEADER]: createRequestId(),
    ...headersToObject(headers),
  });
}

export async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  const responseRequestId = res.headers.get(REQUEST_ID_HEADER);
  const body = await readJsonBody(res);
  const bodyError = typeof body?.error === "string" ? body.error : null;
  const bodyRequestId = typeof body?.request_id === "string" ? body.request_id : null;
  const requestId = responseRequestId || bodyRequestId;
  const baseMessage = bodyError
    ? `API error: ${res.status} ${bodyError}`
    : `API error: ${res.status} ${res.statusText}`;
  const message = requestId ? `${baseMessage} (request ${requestId})` : baseMessage;

  return new ApiError(message, res.status, res.statusText, requestId);
}

async function readJsonBody(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return null;
    const body = (await res.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createRequestId(): string {
  return `ext-${crypto.randomUUID()}`;
}

function headersToObject(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers;
}
