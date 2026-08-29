import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "MemeDrop's private-beta privacy disclosure and support contact.",
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
          A plain-language disclosure of how the MemeDrop private beta handles information, and
          which hosted-provider and billing details remain to be finalized before public launch.
        </p>
        <p className="policyMeta">Effective date: August 24, 2026</p>
      </header>

      <aside className="notice" aria-label="Pre-launch policy status">
        <p>
          <strong>Private-beta notice.</strong> MemeDrop is not yet a public, self-service API.
          User-owned one-way-hashed credentials, credits, authenticated generation, and
          30-day generated-asset cleanup are implemented. Production provider retention,
          infrastructure logging, payment, and billing settings still require hosted verification.
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
          be returned to the authenticated user. Each durable generated asset expires 30 days
          after generation. Expired media is no longer served; a protected daily cleanup job deletes
          its exact stored object and keeps failures visible for operator retry. Rendered pixels
          necessarily contain the generated caption even though caption text is not stored as a
          separate application field.
        </p>
        <h3>Technical and operational data</h3>
        <p>
          The service and its infrastructure may process standard request and diagnostic data, such
          as timestamps, response status, latency, network metadata, browser or device information,
          and rate-limit signals. The implementation excludes raw submitted text, optional creative
          direction, plaintext captions, API-key secrets, and request bodies from application
          persistence and telemetry. Request identity uses a one-way SHA-256 fingerprint rather
          than stored plaintext. A full hosted-infrastructure log and retention audit has not been
          completed yet.
        </p>
        <h3>Account, API, and billing data</h3>
        <p>
          Private-beta users, API keys, and credit transactions are available through an
          operator-only workflow. MemeDrop stores compact IDs, key names, key-use and revocation
          timestamps, signed credit movements, and generation/asset lifecycle metadata.
          API-key secrets are shown once at issuance and stored only as
          one-way SHA-256 hashes. Payments, recharging, and self-service billing are not implemented;
          the future payment processor and billing-record retention remain to be determined.
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
          notices. Their hosted production configuration, provider-side input retention, model
          training controls, log retention, deletion propagation, and subprocessors are still being
          verified; the application-level exclusions above do not control provider-held copies.
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
          include verified provider-specific retention details and a complete list of material
          processors.
        </p>
      </section>

      <section aria-labelledby="retention">
        <h2 id="retention">Retention and your choices</h2>
        <p>
          Generated images expire 30 days after successful generation. Authenticated media access
          stops at expiry, and the implemented scheduled cleanup deletes exact stored objects in
          bounded batches. Retryable and blocked cleanup backlogs remain visible to operators so a
          deletion failure does not disappear silently. Durable user, key, credit-transaction, and
          categorical generation records are retained for private-beta operations and auditing.
        </p>
        <p>
          Final hosted retention periods for application and infrastructure logs, PostgreSQL,
          Redis, OpenRouter, Tavily, analytics, and object storage still require verification.
          Billing retention is not yet applicable because payments are not implemented. API keys
          can be revoked by an operator; full account self-service, early asset deletion, and a
          generated-content complaint workflow remain pending. Contact us for a request.
        </p>
      </section>

      <section aria-labelledby="security">
        <h2 id="security">Security</h2>
        <p>
          We use reasonable technical measures appropriate to the current stage of the product, but
          no internet service can promise absolute security. Private-beta generation and media are
          tenant-authenticated, API-key secrets are one-way hashed, credits are transactionally
          accounted, and generated assets have a scheduled lifecycle job. Public launch still
          depends on hosted observability, incident-response, and production security verification.
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
