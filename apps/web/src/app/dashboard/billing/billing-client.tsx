"use client";

import { useEffect, useState } from "react";

import {
  dashboardRequestHeaders,
  dashboardResponseError,
  type DashboardCheckout,
  validatedDodoCheckoutUrl,
} from "../dashboard-data";
import { useDashboardOverview } from "../use-dashboard-overview";

export function BillingClient() {
  const { overview, loading, error, loadOverview } = useDashboardOverview();
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [returnedFromCheckout, setReturnedFromCheckout] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("checkout") !== "return") return;
    setReturnedFromCheckout(true);
    void loadOverview();
  }, [loadOverview]);

  async function startCheckout() {
    if (!overview?.billing.checkout_enabled || !overview.billing.environment) return;
    setCheckoutPending(true);
    setCheckoutError(null);
    try {
      const response = await fetch("/api/dashboard/billing/checkout", {
        method: "POST",
        headers: {
          ...dashboardRequestHeaders(),
          "Idempotency-Key": `checkout_${crypto.randomUUID()}`,
        },
      });
      if (response.status === 401) {
        window.location.assign("/sign-in");
        return;
      }
      if (!response.ok) throw await dashboardResponseError(response);
      const checkout = (await response.json()) as DashboardCheckout;
      window.location.assign(
        validatedDodoCheckoutUrl(checkout.checkout_url, overview.billing.environment),
      );
    } catch (caught) {
      setCheckoutError(
        caught instanceof Error ? caught.message : "The checkout could not be started.",
      );
      setCheckoutPending(false);
    }
  }
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
        {overview.billing.checkout_enabled && overview.billing.environment === "test_mode" ? (
          <>
            <h3>100-credit test pack</h3>
            <p>
              Test mode only. Dodo&apos;s test checkout simulates the payment and no real money is
              charged. Credits appear after MemeDrop receives the signed payment confirmation.
            </p>
            <button
              className="primaryButton"
              type="button"
              disabled={checkoutPending}
              onClick={() => void startCheckout()}
            >
              {checkoutPending ? "Opening test checkout…" : "Buy 100 test credits"}
            </button>
          </>
        ) : (
          <>
            <h3>Self-service packs are not on sale yet</h3>
            <p>
              The one-time credit-pack checkout is being tested. Prices, expiry rules, and purchase
              terms will appear here before live sales open.
            </p>
            <a href="mailto:moyezrabbani.work@gmail.com?subject=MemeDrop%20beta%20credits">
              Ask about beta credits
            </a>
          </>
        )}
        {returnedFromCheckout ? (
          <p className="billingNotice" role="status">
            Checkout returned. The balance above refreshes from the signed payment confirmation.
          </p>
        ) : null}
        {checkoutError ? (
          <p className="billingError" role="alert">{checkoutError}</p>
        ) : null}
      </div>
    </section>
  );
}
