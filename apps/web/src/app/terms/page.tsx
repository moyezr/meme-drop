import type { Metadata } from "next";
import { SiteFooter } from "../site-footer";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "How the MemeDrop private beta works, acceptable use, credits, and support.",
  alternates: { canonical: "/terms/" },
};

export default function TermsPage() {
  return (
    <>
      <main className="contentPage policyPage">
        <nav className="pageNav" aria-label="Primary navigation"><a href="/">← MemeDrop</a><div className="pageNavLinks"><a href="/docs/">API docs</a><a href="/refund-policy/">Credits & refunds</a></div></nav>
        <header><p className="eyebrow">THE PRACTICAL DETAILS</p><h1>Terms of use</h1><p className="pageIntro">A few ground rules for using MemeDrop.</p><p className="policyMeta">Effective date: August 31, 2026 · Private beta</p></header>
        <section><h2>The product</h2><p>MemeDrop is an AI-assisted meme-generation application and API operated by Moyez Rabbani. It selects meme templates, generates captions, and returns rendered images from text supplied by a user or their AI agent.</p><p>The API is in private beta. Access and credits are arranged with the operator. Features and availability may change; the beta is not a promise of uninterrupted service. The Chrome extension shown in the demo is a separate workflow, and its Chrome Web Store release is pending.</p></section>
        <section><h2>Your account and API keys</h2><p>Keep your account and API keys secure. Only use credentials you are authorized to use. You are responsible for requests made by agents and applications you connect to your account. Revoke a key from the dashboard if it is exposed, and contact support if you suspect unauthorized access.</p></section>
        <section><h2>Use it responsibly</h2><p>Only submit content you have the right to use. Do not use MemeDrop for unlawful content, harassment, exploitation, deceptive impersonation, or attempts to bypass safety controls, usage limits, or another user&apos;s access restrictions.</p><p>Review generated memes before sharing them. AI-generated captions may be inaccurate, inappropriate, or simply miss the joke. Access may be restricted to investigate misuse or protect other users.</p></section>
        <section><h2>Images and permissions</h2><p>Templates may contain third-party images, characters, or other protected material. MemeDrop does not grant ownership of those materials or promise that every output is cleared for advertising or other commercial use. Check the rights and permissions required for your intended use.</p><p>Generated images are accessible using the owning user&apos;s credentials for 30 days, then expire and are scheduled for deletion. Download images you want to retain before they expire.</p></section>
        <section><h2>Credits and payments</h2><p>One credit is consumed for each successfully stored and returned meme. Unused generation reservations are released for failed or partial requests. A matching idempotent retry is not charged again.</p><p>Paid checkout is not open, and MemeDrop currently accepts no purchases through this website. Pack prices, credit-expiry rules, and purchase terms will be published before paid checkout opens. See <a href="/refund-policy/">credits and refunds</a> for the current status.</p></section>
        <section><h2>Privacy and changes</h2><p>Our <a href="/privacy-policy/">privacy policy</a> explains how inputs, account details, and generated images are processed. These terms may be updated as the beta evolves; the effective date will change when they do. Nothing here limits rights that cannot be excluded under applicable law.</p></section>
        <section><h2>Questions or account requests?</h2><p>Email <a href="mailto:moyezrabbani.work@gmail.com">moyezrabbani.work@gmail.com</a> for support, access issues, account requests, or content complaints. Include relevant account or request IDs, but never send passwords or API keys.</p></section>
      </main>
      <SiteFooter />
    </>
  );
}
