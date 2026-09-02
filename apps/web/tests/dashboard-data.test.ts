import assert from "node:assert/strict";
import test from "node:test";

import { validatedDodoCheckoutUrl } from "../src/app/dashboard/dashboard-data";

test("Dodo checkout redirects are pinned to the configured environment", () => {
  assert.equal(
    validatedDodoCheckoutUrl(
      "https://test.checkout.dodopayments.com/session/cks_test",
      "test_mode",
    ),
    "https://test.checkout.dodopayments.com/session/cks_test",
  );
  assert.equal(
    validatedDodoCheckoutUrl(
      "https://checkout.dodopayments.com/session/cks_live",
      "live_mode",
    ),
    "https://checkout.dodopayments.com/session/cks_live",
  );
  for (const value of [
    "http://test.checkout.dodopayments.com/session/cks_test",
    "https://test.checkout.dodopayments.com.attacker.example/session/cks_test",
    "https://checkout.dodopayments.com/session/cks_live",
  ]) {
    assert.throws(() => validatedDodoCheckoutUrl(value, "test_mode"), /invalid checkout URL/);
  }
});
