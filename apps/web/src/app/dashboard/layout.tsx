import { redirect } from "next/navigation";
import { auth, signOut } from "../../auth";
import { DashboardNavigation } from "./dashboard-navigation";

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
        <DashboardNavigation />
        {children}
      </div>
    </div>
  );
}
