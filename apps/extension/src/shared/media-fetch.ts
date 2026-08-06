// Media starts after the bounded suggestion API call, so it must leave room
// inside the five-second worst-case ready-to-attach budget.
export const MEDIA_FETCH_TIMEOUT_MS = 2_500;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

/**
 * Bounds background media hydration so one slow CDN response cannot hold a
 * suggestion's preview/original single-flight request indefinitely.
 */
export async function fetchMediaWithTimeout(
  input: RequestInfo | URL,
  timeoutMs = MEDIA_FETCH_TIMEOUT_MS,
  fetchImplementation: FetchImplementation = fetch
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Media fetch timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    return await fetchImplementation(input, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
