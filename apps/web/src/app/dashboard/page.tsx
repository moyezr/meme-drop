import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Developer dashboard",
  description: "Manage your MemeDrop developer account.",
  robots: { index: false, follow: false },
};

const dashboardCards = [
  {
    title: "Credits",
    description: "Your available generation credits will appear here.",
  },
  {
    title: "API keys",
    description: "Create and revoke keys once account APIs are connected.",
  },
  {
    title: "Recent generations",
    description: "Content-free generation activity will appear here.",
  },
] as const;

export default function DashboardPage() {
  return (
    <main className="dashboardMain">
      <div className="dashboardIntro">
        <p className="eyebrow">Developer dashboard</p>
        <h1>Build humor into your agent.</h1>
        <p>
          Account setup is underway. This shell is authenticated, but it does not
          connect to billing or API-key data yet.
        </p>
      </div>

      <section className="dashboardGrid" aria-label="Account overview">
        {dashboardCards.map((card) => (
          <article className="dashboardCard" key={card.title}>
            <h2>{card.title}</h2>
            <p>{card.description}</p>
            <span className="statusPill">Coming next</span>
          </article>
        ))}
      </section>
    </main>
  );
}
