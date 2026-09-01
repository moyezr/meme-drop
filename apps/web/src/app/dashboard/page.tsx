import type { Metadata } from "next";
import { DashboardOverviewClient } from "./dashboard-overview-client";

export const metadata: Metadata = {
  title: "Developer dashboard",
  description: "Manage your MemeDrop developer account.",
  robots: { index: false, follow: false },
};

export default function DashboardPage() {
  return (
    <main className="dashboardMain">
      <div className="dashboardIntro">
        <p className="eyebrow">Developer dashboard</p>
        <h1>Build humor into your agent.</h1>
        <p>
          Check your balance and manage the credentials your agents use to call
          MemeDrop.
        </p>
      </div>
      <DashboardOverviewClient />
    </main>
  );
}
