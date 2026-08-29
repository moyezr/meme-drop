import "server-only";

import {
  signDashboardAssertion,
  type DashboardIdentity,
} from "./dashboard-assertion-core";

const encoder = new TextEncoder();

export function createDashboardAssertion(identity: DashboardIdentity): Promise<string> {
  const configuredSecret = process.env.MEMEDROP_DASHBOARD_TOKEN_SECRET;
  const secretLength = configuredSecret ? [...configuredSecret].length : 0;
  if (!configuredSecret || secretLength < 32 || secretLength > 512) {
    throw new Error(
      "MEMEDROP_DASHBOARD_TOKEN_SECRET must contain 32 to 512 characters.",
    );
  }

  return signDashboardAssertion(identity, encoder.encode(configuredSecret));
}
