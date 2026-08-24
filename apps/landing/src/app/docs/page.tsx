import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agent API documentation",
  description:
    "The current MemeDrop agent meme-generation endpoint, request shape, response shape, and production-readiness status.",
  alternates: {
    canonical: "/docs/",
  },
};

const curlExample = `curl --request POST http://localhost:3001/api/v1/memes/generate \\
  --header "Content-Type: application/json" \\
  --data '{
    "input": "We deployed on Friday and immediately broke checkout"
  }'`;

const typeScriptExample = `const response = await fetch(
  "http://localhost:3001/api/v1/memes/generate",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: "We deployed on Friday and immediately broke checkout",
      options: { direction: "dry and self-aware", count: 1 },
    }),
  },
);

const result = await response.json();
if (result.status === "ok") {
  console.log(result.memes[0].image_url);
}`;

const pythonExample = `import requests

response = requests.post(
    "http://localhost:3001/api/v1/memes/generate",
    json={"input": "We deployed on Friday and immediately broke checkout"},
    timeout=30,
)
response.raise_for_status()
result = response.json()

if result["status"] == "ok":
    print(result["memes"][0]["image_url"])`;

const responseExample = `{
  "status": "ok",
  "memes": [
    {
      "id": "meme_0d42…",
      "image_url": "/memes/generated/agents/0d42….webp",
      "alt_text": "Personalized meme",
      "caption": "THE PLAN / ANOTHER TIMEZONE BUG"
    }
  ]
}`;

export default function AgentDocsPage() {
  return (
    <main className="contentPage">
      <nav className="pageNav" aria-label="Primary navigation">
        <a href="/">← MemeDrop</a>
        <div className="pageNavLinks">
          <a href="/privacy-policy/">Privacy</a>
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
        <h1>Agent API</h1>
        <p className="pageIntro">
          Generate a ready-to-use meme from one piece of context. The current endpoint accepts a
          small JSON body and returns either finished meme data or a stable no-fit result.
        </p>
      </header>

      <aside className="notice" aria-label="Pre-production status">
        <p>
          <strong>Pre-production contract.</strong> The endpoint below exists in the current API,
          but public API-key access, credit billing, idempotency keys, 30-day asset expiry, and
          absolute production image URLs are still being implemented. Do not build a production
          integration against the planned origin yet.
        </p>
      </aside>

      <section aria-labelledby="quickstart">
        <h2 id="quickstart">Quickstart</h2>
        <p>
          Run the API locally, then send the source text your agent wants to react to. The only
          required field is <code className="inlineCode">input</code>.
        </p>
        <pre className="codeBlock"><code>{curlExample}</code></pre>
        <p>
          A successful response has <code className="inlineCode">status: "ok"</code>. When no
          suitable, renderable meme is available, it has{" "}
          <code className="inlineCode">status: "no_fit"</code> and an empty{" "}
          <code className="inlineCode">memes</code> array.
        </p>
      </section>

      <section aria-labelledby="request">
        <h2 id="request">Request</h2>
        <p>
          <code className="inlineCode">POST /api/v1/memes/generate</code> with{" "}
          <code className="inlineCode">Content-Type: application/json</code>.
        </p>
        <table className="contractTable">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Type</th>
              <th scope="col">Rules</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code className="inlineCode">input</code></td>
              <td>string</td>
              <td>Required. Whitespace is trimmed; 1–12,000 characters.</td>
            </tr>
            <tr>
              <td><code className="inlineCode">options.direction</code></td>
              <td>string</td>
              <td>Optional creative steering. Whitespace is trimmed; 1–280 characters.</td>
            </tr>
            <tr>
              <td><code className="inlineCode">options.count</code></td>
              <td>integer</td>
              <td>Optional. Defaults to 1; accepts 1–5.</td>
            </tr>
          </tbody>
        </table>
        <p>
          Unknown fields are rejected. Keep the source text canonical: direction is only a
          creative preference and does not override template, safety, placement, or length
          constraints.
        </p>
      </section>

      <section aria-labelledby="response">
        <h2 id="response">Response</h2>
        <pre className="codeBlock"><code>{responseExample}</code></pre>
        <table className="contractTable">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code className="inlineCode">status</code></td>
              <td><code className="inlineCode">"ok"</code> or <code className="inlineCode">"no_fit"</code>.</td>
            </tr>
            <tr>
              <td><code className="inlineCode">memes</code></td>
              <td>A bounded array of generated memes; empty for <code className="inlineCode">"no_fit"</code>.</td>
            </tr>
            <tr>
              <td><code className="inlineCode">memes[].id</code></td>
              <td>The generated meme identifier. Its current format is provisional.</td>
            </tr>
            <tr>
              <td><code className="inlineCode">memes[].image_url</code></td>
              <td>A rendered-image URL. It is currently relative; production will return an absolute HTTPS URL.</td>
            </tr>
            <tr>
              <td><code className="inlineCode">memes[].alt_text</code></td>
              <td>Short accessible description for the rendered meme.</td>
            </tr>
            <tr>
              <td><code className="inlineCode">memes[].caption</code></td>
              <td>Flattened caption text in the template’s region order.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="examples">
        <h2 id="examples">Client examples</h2>
        <h3>TypeScript</h3>
        <pre className="codeBlock"><code>{typeScriptExample}</code></pre>
        <h3>Python</h3>
        <pre className="codeBlock"><code>{pythonExample}</code></pre>
      </section>

      <section aria-labelledby="current-behavior">
        <h2 id="current-behavior">Current behavior and limits</h2>
        <ul>
          <li>The route can return at most five rendered memes per request.</li>
          <li>
            In the current local/default configuration, it does not require an API key. When the
            legacy install-ID switch is enabled, it requires an{" "}
            <code className="inlineCode">x-memedrop-install-id</code> UUID header. That header is
            not the planned external-agent authentication mechanism.
          </li>
          <li>
            Current input validation failures return HTTP 400. A complete, versioned machine-error
            contract is not published yet.
          </li>
          <li>
            Requests are rate limited by the API runtime. Per-agent limits and retry-safe
            idempotency are still in development, so clients should not retry blindly.
          </li>
          <li>
            The production API will be hosted at{" "}
            <code className="inlineCode">https://memedropapi.moyezrabbani.dev</code>; it is a
            planned base URL, not a current public integration target.
          </li>
        </ul>
      </section>

      <section aria-labelledby="planned-contract">
        <h2 id="planned-contract">What will change before public launch</h2>
        <p>
          The public release will add API-key issuance and rotation, tenant-scoped limits, compact
          public IDs, one-charge idempotent retries, documented credit behavior, stable errors,
          absolute HTTPS asset URLs, and a 30-day generated-image lifecycle. This page will be
          updated and versioned when those behaviors are live and contract-tested.
        </p>
      </section>

      <footer className="contentFooter">
        Questions about the current integration surface? Contact{" "}
        <a href="mailto:moyezrabbani.work@gmail.com">moyezrabbani.work@gmail.com</a>.
      </footer>
    </main>
  );
}
