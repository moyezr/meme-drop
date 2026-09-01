import type { Metadata } from "next";
import { BillingClient } from "./billing-client";

export const metadata: Metadata = {
  title: "Billing",
  description: "Review your MemeDrop credit balance and billing availability.",
  robots: { index: false, follow: false },
};

export default function BillingPage() {
  return (
    <main className="dashboardMain">
      <div className="dashboardIntro">
        <p className="eyebrow">Billing</p>
        <h1>Credits and billing</h1>
        <p>Review your current balance and credit-pack availability.</p>
      </div>
      <BillingClient />
    </main>
  );
}
