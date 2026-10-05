import type { BeforeSendEvent } from "@vercel/analytics/next";

const publicPaths = new Set(["/", "/docs", "/privacy-policy", "/terms", "/refund-policy"]);

export function filterAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  // Only public page views are reviewed for telemetry; never forward arbitrary event data.
  if (event.type !== "pageview") return null;

  try {
    const url = new URL(event.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (!publicPaths.has(path) || !["https:", "http:"].includes(url.protocol)) return null;

    return { type: "pageview", url: `${url.origin}${path}` };
  } catch {
    return null;
  }
}
