/**
 * Coalesce concurrent work for the same key. Failures are deliberately not
 * cached: a later user action can retry the request.
 */
export function createSingleFlight<T>() {
  const inFlight = new Map<string, Promise<T>>();

  return {
    run(key: string, operation: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key);
      if (existing) return existing;

      const request = Promise.resolve().then(operation);
      inFlight.set(key, request);
      const clear = () => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      };
      void request.then(clear, clear);
      return request;
    },
  };
}
