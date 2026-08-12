export const LOCAL_API_BASE_URL = "http://localhost:3001";

export function resolveApiBaseUrl(mode: string, configuredUrl?: string): string {
  if (mode !== "release") {
    return LOCAL_API_BASE_URL;
  }

  const releaseUrl = configuredUrl?.trim();
  if (!releaseUrl) {
    throw new Error("VITE_API_BASE_URL is required in release mode");
  }

  return releaseUrl;
}
