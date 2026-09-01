"use client";

import Link from "next/link";
import { readableDashboardDate } from "./dashboard-data";
import { useDashboardOverview } from "./use-dashboard-overview";

export function DashboardOverviewClient() {
  const { overview, loading, error, loadOverview } = useDashboardOverview();
  if (loading && !overview) {
    return <section className="dashboardLoading" aria-live="polite">Loading your account…</section>;
  }
  if (!overview) {
    return (
      <section className="dashboardErrorState" role="alert">
        <h2>Account data is unavailable</h2>
        <p>{error ?? "The dashboard could not be loaded."}</p>
        <button className="secondaryButton" type="button" onClick={() => void loadOverview()}>
          Try again
        </button>
      </section>
    );
  }
  const activeKeyCount = overview.api_keys.filter((apiKey) => !apiKey.revoked_at).length;
  return (
    <>
      <section className="dashboardSummary" aria-label="Account overview">
        <article className="dashboardMetric">
          <span>Available credits</span>
          <strong>{overview.user.credits.toLocaleString()}</strong>
          <small>One credit per durable returned meme</small>
        </article>
        <article className="dashboardMetric">
          <span>Active API keys</span>
          <strong>{activeKeyCount}</strong>
          <small>{5 - activeKeyCount} remaining before the active-key limit</small>
        </article>
        <article className="dashboardMetric">
          <span>Developer account</span>
          <strong className="dashboardAccountValue">{overview.user.email ?? overview.user.id}</strong>
          <small>Created {readableDashboardDate(overview.user.created_at)}</small>
        </article>
      </section>
      <section className="dashboardGrid" aria-label="Developer tools">
        <article className="dashboardCard">
          <h2>API keys</h2>
          <p>Create and revoke credentials for each agent or deployment.</p>
          <Link href="/dashboard/api-keys">Manage API keys →</Link>
        </article>
        <article className="dashboardCard">
          <h2>Billing</h2>
          <p>Review your balance and the current availability of credit packs.</p>
          <Link href="/dashboard/billing">View billing →</Link>
        </article>
      </section>
    </>
  );
}
