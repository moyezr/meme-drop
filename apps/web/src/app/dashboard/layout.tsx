import { redirect } from "next/navigation";
import { auth, signOut } from "../../auth";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  if (!session?.user) {
    redirect("/sign-in");
  }

  const identity = session.user.name ?? session.user.email ?? "Signed-in developer";

  return (
    <div className="dashboardShell">
      <header className="dashboardHeader">
        <a className="dashboardBrand" href="/">
          MemeDrop
        </a>
        <div className="dashboardIdentity">
          <span title={session.user.email ?? undefined}>{identity}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button className="textButton" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="dashboardBody">
        <nav className="dashboardNav" aria-label="Dashboard navigation">
          <a aria-current="page" href="/dashboard">
            Overview
          </a>
          <span aria-disabled="true">API keys</span>
          <span aria-disabled="true">Usage</span>
          <span aria-disabled="true">Billing</span>
        </nav>
        {children}
      </div>
    </div>
  );
}
