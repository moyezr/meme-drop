import type { Metadata } from "next";
import { SiteFooter } from "../site-footer";

export const metadata: Metadata = {
  title: "Credits and refunds",
  description: "MemeDrop's current credit accounting, payment availability, and refund support information.",
  alternates: { canonical: "/refund-policy/" },
};

export default function RefundPolicyPage() {
  return (
    <>
      <main className="contentPage policyPage">
        <nav className="pageNav" aria-label="Primary navigation"><a href="/">← MemeDrop</a><div className="pageNavLinks"><a href="/terms/">Terms</a><a href="/#credits">Credits</a></div></nav>
        <header><p className="eyebrow">NO SURPRISES</p><h1>Credits & refunds</h1><p className="pageIntro">What happens when a generation works—and when it doesn&apos;t.</p><p className="policyMeta">Effective date: August 31, 2026 · Private beta</p></header>
        <section><h2>Paid purchases are not available yet</h2><p>MemeDrop is in private beta. Paid checkout, credit-pack purchases, and subscriptions are not available on this website. There is currently no recurring plan to cancel.</p><p>We plan to offer one-time credit packs. Final prices, credit-expiry rules, and monetary refund conditions will be published here before purchases are enabled. This page does not promise a future refund window or credit expiry period.</p></section>
        <section><h2>How generation credits work</h2><p>One successfully stored and returned meme costs one credit. Credits are reserved when a generation starts. If a request fails or returns fewer memes than requested, unused reserved credits are returned to the account.</p><p>A request with no suitable result costs no credits. Replaying the same request with the same idempotency key does not charge again. A successfully returned fallback meme still costs one credit.</p><p>A credit returned after a failed generation is an account adjustment, not a monetary refund.</p></section>
        <section><h2>Something doesn&apos;t add up?</h2><p>For an unexpected balance change or a payment you believe relates to MemeDrop, contact <a href="mailto:moyezrabbani.work@gmail.com">moyezrabbani.work@gmail.com</a>. Include the account email, relevant request or receipt ID, and a short explanation. Do not include API keys or full card details.</p><p>We will investigate account discrepancies. Any mandatory consumer rights remain unaffected.</p></section>
      </main>
      <SiteFooter />
    </>
  );
}
