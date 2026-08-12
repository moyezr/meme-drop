import type { CatalogDraft, CatalogStatus, CreateDraftInput, TemplateAnnotation } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const catalogUrl = `${API_BASE}/internal/api/catalog/templates`;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function listDrafts(filters: {
  status?: CatalogStatus;
  search?: string;
}): Promise<CatalogDraft[]> {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.search) query.set("search", filters.search);
  const response = await request<{ drafts: CatalogDraft[] }>(`${catalogUrl}?${query}`);
  return response.drafts;
}

export async function getDraft(id: string): Promise<CatalogDraft> {
  return (await request<{ draft: CatalogDraft }>(`${catalogUrl}/${id}`)).draft;
}

export async function createDraft(input: CreateDraftInput): Promise<CatalogDraft> {
  return (
    await request<{ draft: CatalogDraft }>(catalogUrl, {
      method: "POST",
      body: JSON.stringify(input),
    })
  ).draft;
}

export async function updateDraft(input: {
  id: string;
  revision: number;
  status: CatalogStatus;
  annotation: TemplateAnnotation;
}): Promise<CatalogDraft> {
  return (
    await request<{ draft: CatalogDraft }>(`${catalogUrl}/${input.id}`, {
      method: "PUT",
      body: JSON.stringify({
        revision: input.revision,
        status: input.status,
        annotation: input.annotation,
      }),
    })
  ).draft;
}

export interface VisualQaCheck {
  fingerprint: string;
  issues: Array<{ region_id?: string; code?: string; message: string }>;
}

export async function checkVisualQa(annotation: TemplateAnnotation): Promise<VisualQaCheck> {
  return request<VisualQaCheck>(`${API_BASE}/internal/api/catalog/visual-qa/check`, {
    method: "POST",
    body: JSON.stringify({ annotation }),
  });
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    details?: Array<{ path?: string; message?: string }>;
  };
  if (!response.ok) {
    const details = body.details
      ?.map((issue) => `${issue.path || "request"}: ${issue.message || "Invalid value"}`)
      .join("; ");
    throw new ApiError(details || body.error || `Request failed (${response.status})`, response.status);
  }
  return body as T;
}
