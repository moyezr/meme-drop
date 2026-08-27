import NextAuth, { type NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

export type EnabledAuthProvider = "github" | "google";

function readProviderCredentials(
  provider: EnabledAuthProvider,
  clientId: string | undefined,
  clientSecret: string | undefined,
) {
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new Error(
      `Both the client ID and client secret must be configured for ${provider} authentication.`,
    );
  }

  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

const githubCredentials = readProviderCredentials(
  "github",
  process.env.AUTH_GITHUB_ID,
  process.env.AUTH_GITHUB_SECRET,
);
const googleCredentials = readProviderCredentials(
  "google",
  process.env.AUTH_GOOGLE_ID,
  process.env.AUTH_GOOGLE_SECRET,
);

export const enabledAuthProviders: EnabledAuthProvider[] = [];
const providers: NextAuthConfig["providers"] = [];

if (githubCredentials) {
  enabledAuthProviders.push("github");
  providers.push(GitHub(githubCredentials));
}

if (googleCredentials) {
  enabledAuthProviders.push("google");
  providers.push(Google(googleCredentials));
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
});
