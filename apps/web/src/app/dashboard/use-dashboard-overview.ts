"use client";

import { useCallback, useEffect, useState } from "react";
import {
  dashboardRequestHeaders,
  dashboardResponseError,
  type DashboardOverview,
} from "./dashboard-data";

export function useDashboardOverview() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/dashboard/overview", {
        cache: "no-store",
        headers: dashboardRequestHeaders(),
        signal,
      });
      if (response.status === 401) {
        window.location.assign("/sign-in");
        return;
      }
      if (!response.ok) throw await dashboardResponseError(response);
      setOverview((await response.json()) as DashboardOverview);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "The dashboard could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadOverview(controller.signal);
    return () => controller.abort();
  }, [loadOverview]);

  return { overview, setOverview, loading, error, setError, loadOverview };
}
