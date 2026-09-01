import type { Metadata } from "next";
import { ApiKeysClient } from "../dashboard-client";

export const metadata: Metadata = {
  title: "API keys",
  description: "Create and manage MemeDrop API keys.",
  robots: { index: false, follow: false },
};

export default function ApiKeysPage() {
  return (
    <main className="dashboardMain">
      <div className="dashboardIntro">
        <p className="eyebrow">Credentials</p>
        <h1>API keys</h1>
        <p>Create a separate credential for each agent or environment.</p>
      </div>
      <ApiKeysClient />
    </main>
  );
}
