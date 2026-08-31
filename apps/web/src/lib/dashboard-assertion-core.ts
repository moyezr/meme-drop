import { SignJWT } from "jose";

export const DASHBOARD_ASSERTION_ISSUER = "memedrop-web";
export const DASHBOARD_ASSERTION_AUDIENCE = "memedrop-dashboard-api";
export const DASHBOARD_ASSERTION_TTL_SECONDS = 45;
const DASHBOARD_PROVIDERS = new Set(["github", "google"]);

export interface DashboardIdentity {
  provider: string;
  providerAccountId: string;
  email?: string | null;
}

export async function signDashboardAssertion(
  identity: DashboardIdentity,
  secret: Uint8Array,
  issuedAt = Math.floor(Date.now() / 1000),
): Promise<string> {
  if (
    !DASHBOARD_PROVIDERS.has(identity.provider) ||
    !validClaim(identity.providerAccountId, 255) ||
    (identity.email !== undefined &&
      identity.email !== null &&
      !validClaim(identity.email, 320))
  ) {
    throw new Error("Dashboard identity claims are required.");
  }

  const claims: Record<string, string> = {
    provider: identity.provider,
    provider_account_id: identity.providerAccountId,
  };
  if (identity.email) {
    claims.email = identity.email;
  }

  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(`${identity.provider}:${identity.providerAccountId}`)
    .setIssuer(DASHBOARD_ASSERTION_ISSUER)
    .setAudience(DASHBOARD_ASSERTION_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + DASHBOARD_ASSERTION_TTL_SECONDS)
    .sign(secret);
}

function validClaim(value: string, maxLength: number): boolean {
  const characters = [...value];
  return (
    characters.length > 0 &&
    characters.length <= maxLength &&
    value === value.trim() &&
    characters.every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127;
    })
  );
}
