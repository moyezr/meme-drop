"use client";

import { useDashboardOverview } from "../use-dashboard-overview";

export function BillingClient() {
  const { overview, loading, error, loadOverview } = useDashboardOverview();
  if (loading && !overview) {
    return <section className="dashboardLoading" aria-live="polite">Loading billing…</section>;
  }
  if (!overview) {
    return (
      <section className="dashboardErrorState" role="alert">
        <h2>Billing data is unavailable</h2>
        <p>{error ?? "Your billing information could not be loaded."}</p>
        <button className="secondaryButton" type="button" onClick={() => void loadOverview()}>
          Try again
        </button>
      </section>
    );
  }

  return (
    <section className="dashboardPanel dashboardPanelFirst" aria-labelledby="billing-status-title">
      <div className="dashboardPanelHeader">
        <div>
          <p className="eyebrow">Current balance</p>
          <h2 id="billing-status-title">{overview.user.credits.toLocaleString()} credits</h2>
          <p>One credit is used for each successfully stored and returned meme.</p>
        </div>
        <span className="statusPill">Private beta</span>
      </div>
      <div className="billingAvailability">
        <h3>Self-service packs are not on sale yet</h3>
        <p>
          The one-time credit-pack checkout is being tested. Prices, expiry rules, and purchase
          terms will appear here before live sales open.
        </p>
        <a href="mailto:moyezrabbani.work@gmail.com?subject=MemeDrop%20beta%20credits">
          Ask about beta credits
        </a>
      </div>
    </section>
  );
}
