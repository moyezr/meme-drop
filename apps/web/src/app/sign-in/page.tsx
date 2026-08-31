import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  auth,
  enabledAuthProviders,
  signIn,
  type EnabledAuthProvider,
} from "../../auth";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to manage your MemeDrop API access.",
  robots: { index: false, follow: false },
};

const providerLabels: Record<EnabledAuthProvider, string> = {
  github: "Continue with GitHub",
  google: "Continue with Google",
};

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="authPage">
      <section className="authCard" aria-labelledby="sign-in-title">
        <a className="authBrand" href="/" aria-label="MemeDrop home">
          MemeDrop
        </a>
        <h1 id="sign-in-title">Developer sign in</h1>
        <p>
          Manage API keys, credits, and generation activity from one place.
        </p>

        {enabledAuthProviders.length > 0 ? (
          <div className="authActions">
            {enabledAuthProviders.map((provider) => (
              <form
                key={provider}
                action={async () => {
                  "use server";
                  await signIn(provider, { redirectTo: "/dashboard" });
                }}
              >
                <button className="authButton" type="submit">
                  {providerLabels[provider]}
                </button>
              </form>
            ))}
          </div>
        ) : (
          <p className="authNotice" role="status">
            Sign-in is not configured in this environment yet.
          </p>
        )}

        <p className="authFinePrint">
          By continuing, you agree to the MemeDrop{" "}
          <a href="/privacy-policy/">privacy policy</a>.
        </p>
      </section>
    </main>
  );
}
