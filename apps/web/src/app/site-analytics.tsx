"use client";

import { Analytics } from "@vercel/analytics/next";
import { filterAnalyticsEvent } from "../lib/analytics";

export function SiteAnalytics() {
  return <Analytics beforeSend={filterAnalyticsEvent} debug={false} />;
}
