// Media has an independent deadline after the suggestion response.
// This bounds both response headers and the complete image body.
export const MEDIA_FETCH_TIMEOUT_MS = 2_500;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

/**
 * Bounds background media hydration so one slow CDN response cannot hold a
 * suggestion's preview/original single-flight request indefinitely.
 */
export async function fetchMediaBlobWithTimeout(
  input: RequestInfo | URL,
  timeoutMs = MEDIA_FETCH_TIMEOUT_MS,
  fetchImplementation: FetchImplementation = fetch
): Promise<{ response: Response; blob: Blob }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Media fetch timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    const response = await fetchImplementation(input, { signal: controller.signal });
    const blob = await response.blob();
    return { response, blob };
  } finally {
    clearTimeout(timeout);
  }
}
