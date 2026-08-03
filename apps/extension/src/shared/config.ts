const DEFAULT_API_BASE_URL = "http://localhost:3001";

export const API_BASE_URL = normalizeBaseUrl(
  import.meta.env?.VITE_API_BASE_URL || DEFAULT_API_BASE_URL
);

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
