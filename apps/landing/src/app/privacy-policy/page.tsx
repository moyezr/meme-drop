import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "MemeDrop's current pre-launch privacy disclosure and support contact.",
  alternates: {
    canonical: "/privacy-policy/",
  },
};

export default function PrivacyPolicyPage() {
  return (
    <main className="contentPage">
      <nav className="pageNav" aria-label="Primary navigation">
        <a href="/">← MemeDrop</a>
        <div className="pageNavLinks">
          <a href="/docs/">Agent docs</a>
          <a
            href="https://github.com/moyezr/meme-drop"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </div>
      </nav>

      <header>
        <h1>Privacy policy</h1>
        <p className="pageIntro">
          A plain-language disclosure of how the current MemeDrop development product handles
          information, and what remains to be finalized before a public launch.
        </p>
        <p className="policyMeta">Effective date: August 24, 2026</p>
      </header>

      <aside className="notice" aria-label="Pre-launch policy status">
        <p>
          <strong>Pre-launch notice.</strong> MemeDrop is not yet a public, self-service API. This
          page describes the current implementation and intended launch controls. It will be
          replaced or updated before public access once account, billing, retention, and provider
          settings have been verified.
        </p>
      </aside>

      <section aria-labelledby="scope">
        <h2 id="scope">What this covers</h2>
        <p>
          This notice applies to the MemeDrop website, its Chrome extension, and the current
          meme-suggestion and meme-generation services. It does not replace the privacy policies
          of third-party sites where you may post a generated meme.
        </p>
      </section>

      <section aria-labelledby="information">
        <h2 id="information">Information MemeDrop processes</h2>
        <h3>Submitted content</h3>
        <p>
          When someone asks MemeDrop to suggest or generate a meme, the service processes the
          submitted post or text and any optional creative direction. That content is used to rank
          templates and create caption text. Do not submit passwords, financial details, health
          information, or other sensitive personal information.
        </p>
        <h3>Generated media</h3>
        <p>
          MemeDrop stores rendered meme images in the configured object-storage service so they can
          be returned to the caller. The current implementation does not yet enforce the planned
          30-day expiry and deletion workflow. That workflow is a launch requirement, not a claim
          about the current service.
        </p>
        <h3>Technical and operational data</h3>
        <p>
          The service and its infrastructure may process standard request and diagnostic data, such
          as timestamps, response status, latency, network metadata, browser or device information,
          and rate-limit signals. The application is designed to keep raw submitted text, captions,
          API secrets, and request bodies out of application telemetry. A full production log and
          retention audit has not been completed yet.
        </p>
        <h3>Account, API, and billing data</h3>
        <p>
          Public agent accounts, API keys, credits, and payments are not available yet. When they
          are introduced, this policy will specify the account information collected, key storage
          approach, credit-ledger retention, payment processor, and billing-record retention.
        </p>
      </section>

      <section aria-labelledby="providers">
        <h2 id="providers">Service providers</h2>
        <p>
          MemeDrop uses OpenRouter to reach the model used for template selection and caption
          generation. A generation request can therefore send submitted text, relevant template
          constraints, and bounded trend context to OpenRouter for processing.
        </p>
        <p>
          MemeDrop uses Tavily to discover broadly relevant social and internet-culture trends from
          fixed, curated discovery queries. Individual meme-generation input is not used as a
          Tavily search query. Tavily evidence may be sent to OpenRouter in bounded batches to
          create normalized trend cards.
        </p>
        <p>
          The website uses Vercel Analytics. Meme media is stored through the configured
          object-storage provider. These providers process data under their own terms and privacy
          notices; their precise production configuration and retention settings are still being
          verified.
        </p>
      </section>

      <section aria-labelledby="use">
        <h2 id="use">How information is used</h2>
        <ul>
          <li>To generate, render, deliver, and troubleshoot meme suggestions.</li>
          <li>To maintain service reliability, security, rate limits, and abuse protections.</li>
          <li>To understand aggregate service performance and cost without intentionally retaining raw submitted text in application telemetry.</li>
          <li>To comply with legal obligations and respond to valid requests where required.</li>
        </ul>
      </section>

      <section aria-labelledby="sharing">
        <h2 id="sharing">Sharing and disclosure</h2>
        <p>
          MemeDrop does not sell submitted content. Information is shared with the service
          providers described above only as needed to run the service, and may be disclosed when
          required by law or to protect the service, its users, or the public. A public launch will
          include provider-specific retention details and a complete list of material processors.
        </p>
      </section>

      <section aria-labelledby="retention">
        <h2 id="retention">Retention and your choices</h2>
        <p>
          The intended public policy is that generated images expire 30 days after successful
          generation. This has not been implemented yet, so do not rely on the current development
          service for a 30-day deletion guarantee. Final retention periods for application logs,
          PostgreSQL, Redis, OpenRouter, Tavily, analytics, object storage, and the future payment
          provider will be published before public launch.
        </p>
        <p>
          Account deletion, data export, API-key revocation, early asset deletion, billing-record
          retention, and a generated-content complaint process are also pending public-launch
          implementation. Until self-service controls are available, contact us for a request.
        </p>
      </section>

      <section aria-labelledby="security">
        <h2 id="security">Security</h2>
        <p>
          We use reasonable technical measures appropriate to the current stage of the product, but
          no internet service can promise absolute security. Public launch depends on additional
          authentication, tenant isolation, credit controls, lifecycle jobs, observability, and
          production security checks.
        </p>
      </section>

      <section aria-labelledby="changes">
        <h2 id="changes">Changes to this notice</h2>
        <p>
          We may update this notice as MemeDrop moves from development to private beta and public
          access. The effective date above will change when we do. Material changes to retention,
          providers, or billing will be reflected here before they apply to public users.
        </p>
      </section>

      <section aria-labelledby="contact">
        <h2 id="contact">Privacy and support contact</h2>
        <p>
          For privacy, support, deletion, or data questions, email{" "}
          <a href="mailto:moyezrabbani.work@gmail.com">moyezrabbani.work@gmail.com</a>.
        </p>
      </section>

      <footer className="contentFooter">
        See the <a href="/docs/">agent documentation</a> for the current API contract.
      </footer>
    </main>
  );
}
