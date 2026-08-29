import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agent API documentation",
  description:
    "Integrate with MemeDrop's authenticated, idempotent private-beta meme-generation API.",
  alternates: { canonical: "/docs/" },
};

const apiOrigin = "https://api.memedrop.moyezrabbani.dev";

const curlExample = [
  "curl --request POST " + apiOrigin + "/api/v1/memes/generate \\",
  '  --header "Authorization: Bearer $MEMEDROP_API_KEY" \\',
  '  --header "Idempotency-Key: reply-20260824-001" \\',
  '  --header "Content-Type: application/json" \\',
  "  --data '{",
  '    "input": "We deployed on Friday and immediately broke checkout"',
  "  }'",
].join("\n");

const mediaExample = [
  "curl --output meme.webp \\",
  '  --header "Authorization: Bearer $MEMEDROP_API_KEY" \\',
  '  "' + apiOrigin + '/api/v1/memes/assets/a_23456789ABCD"',
].join("\n");

const typeScriptExample = [
  "const idempotencyKey = crypto.randomUUID();",
  'const response = await fetch("' + apiOrigin + '/api/v1/memes/generate", {',
  '  method: "POST",',
  "  headers: {",
  '    Authorization: "Bearer " + process.env.MEMEDROP_API_KEY,',
  '    "Idempotency-Key": idempotencyKey,',
  '    "Content-Type": "application/json",',
  "  },",
  "  body: JSON.stringify({",
  '    input: "We deployed on Friday and immediately broke checkout",',
  '    options: { direction: "dry and self-aware", count: 1 },',
  "  }),",
  "  signal: AbortSignal.timeout(30_000),",
  "});",
  "",
  "const result = await response.json();",
  'if (response.ok && result.status === "ok") {',
  "  console.log(result.memes[0].image_url);",
  "}",
].join("\n");

const pythonExample = [
  "import os",
  "import uuid",
  "import requests",
  "",
  "response = requests.post(",
  '    "' + apiOrigin + '/api/v1/memes/generate",',
  "    headers={",
  '        "Authorization": f"Bearer {os.environ[\'MEMEDROP_API_KEY\']}",',
  '        "Idempotency-Key": str(uuid.uuid4()),',
  "    },",
  '    json={"input": "We deployed on Friday and immediately broke checkout"},',
  "    timeout=30,",
  ")",
  "result = response.json()",
  "",
  'if response.ok and result["status"] == "ok":',
  '    print(result["memes"][0]["image_url"])',
].join("\n");

const responseExample = JSON.stringify(
  {
    status: "ok",
    memes: [
      {
        id: "a_23456789ABCD",
        image_url: apiOrigin + "/api/v1/memes/assets/a_23456789ABCD",
        expires_at: "2026-09-23T12:00:00Z",
      },
    ],
  },
  null,
  2,
);

const errorExample = JSON.stringify({ error: { code: "insufficient_credits" } }, null, 2);

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
          Give MemeDrop one piece of context and get a finished, captioned meme. The
          private-beta API uses a small authenticated request, retry-safe idempotency,
          and durable media that expires after 30 days.
        </p>
      </header>

      <aside className="notice" aria-label="Private beta access">
        <p>
          <strong>Private beta.</strong> Credentials and starting credits are issued by
          a MemeDrop operator to approved agent developers. There is no public sign-up,
          payment flow, or self-service key dashboard yet. Keep the issued Bearer
          credential in a secret manager; its plaintext value cannot be retrieved later.
        </p>
      </aside>

      <section aria-labelledby="quickstart">
        <h2 id="quickstart">Quickstart</h2>
        <p>
          The production base URL is <code className="inlineCode">{apiOrigin}</code>.
          Only <code className="inlineCode">input</code> is required in the JSON body;
          authentication and an idempotency key are required headers.
        </p>
        <pre className="codeBlock"><code>{curlExample}</code></pre>
        <p>
          A success has <code className="inlineCode">status: &quot;ok&quot;</code>.
          When no verified template can be rendered, the API returns HTTP 200 with{" "}
          <code className="inlineCode">status: &quot;no_fit&quot;</code> and an empty{" "}
          <code className="inlineCode">memes</code> array.
        </p>
      </section>

      <section aria-labelledby="request">
        <h2 id="request">Request contract</h2>
        <p>
          Send <code className="inlineCode">POST /api/v1/memes/generate</code> with:
        </p>
        <table className="contractTable">
          <thead>
            <tr><th scope="col">Header</th><th scope="col">Rules</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code className="inlineCode">Authorization</code></td>
              <td>
                Required. <code className="inlineCode">Bearer &lt;issued credential&gt;</code>.
                Legacy install IDs are not agent authentication.
              </td>
            </tr>
            <tr>
              <td><code className="inlineCode">Idempotency-Key</code></td>
              <td>
                Required. 1–200 visible, non-whitespace characters. Use a new value for
                each intended generation and preserve it for retries of that exact body.
              </td>
            </tr>
            <tr>
              <td><code className="inlineCode">Content-Type</code></td>
              <td>Required. <code className="inlineCode">application/json</code>.</td>
            </tr>
          </tbody>
        </table>
        <table className="contractTable">
          <thead>
            <tr>
              <th scope="col">JSON field</th>
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
          Unknown fields are rejected. The source input remains canonical; creative
          direction cannot override catalog, safety, placement, or caption-length
          constraints.
        </p>
      </section>

      <section aria-labelledby="response">
        <h2 id="response">Response and media</h2>
        <pre className="codeBlock"><code>{responseExample}</code></pre>
        <table className="contractTable">
          <thead>
            <tr><th scope="col">Field</th><th scope="col">Meaning</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code className="inlineCode">status</code></td>
              <td>
                <code className="inlineCode">&quot;ok&quot;</code> or{" "}
                <code className="inlineCode">&quot;no_fit&quot;</code>.
              </td>
            </tr>
            <tr>
              <td><code className="inlineCode">memes</code></td>
              <td>A bounded array of 1–5 assets, or an empty array for no-fit.</td>
            </tr>
            <tr>
              <td><code className="inlineCode">memes[].id</code></td>
              <td>
                A compact opaque asset ID beginning with{" "}
                <code className="inlineCode">a_</code> followed by 12 Base58 characters.
              </td>
            </tr>
            <tr>
              <td><code className="inlineCode">memes[].image_url</code></td>
              <td>An absolute HTTPS URL on the MemeDrop API origin.</td>
            </tr>
            <tr>
              <td><code className="inlineCode">memes[].expires_at</code></td>
              <td>The asset&apos;s 30-day expiry timestamp.</td>
            </tr>
          </tbody>
        </table>
        <p>
          Media is private. Fetch <code className="inlineCode">image_url</code> with
          the same user&apos;s Bearer credential; generic object paths do not serve
          generated agent images.
        </p>
        <pre className="codeBlock"><code>{mediaExample}</code></pre>
      </section>

      <section aria-labelledby="credits">
        <h2 id="credits">Credits and idempotent replay</h2>
        <ul>
          <li>
            A new generation reserves the requested <code className="inlineCode">count</code>
            of credits before provider work begins.
          </li>
          <li>
            No-fit, provider, rendering, storage, cancellation, and persistence
            failures refund the full reservation. A successful request costs one credit
            per durable returned meme; any unused reservation is refunded.
          </li>
          <li>
            Repeating the same body and{" "}
            <code className="inlineCode">Idempotency-Key</code> returns the existing
            terminal result without generating or charging again. Reusing that key
            with a different body returns{" "}
            <code className="inlineCode">idempotency_conflict</code>.
          </li>
          <li>
            A replay while work is active returns{" "}
            <code className="inlineCode">idempotency_in_progress</code>. A successful
            replay after its media expires returns{" "}
            <code className="inlineCode">asset_expired</code>.
          </li>
        </ul>
      </section>

      <section aria-labelledby="errors">
        <h2 id="errors">Stable errors</h2>
        <p>Machine errors use this JSON envelope:</p>
        <pre className="codeBlock"><code>{errorExample}</code></pre>
        <table className="contractTable">
          <thead>
            <tr><th scope="col">HTTP</th><th scope="col">Codes</th><th scope="col">Action</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>400</td>
              <td><code className="inlineCode">invalid_input</code></td>
              <td>Correct the headers or body; do not retry unchanged.</td>
            </tr>
            <tr>
              <td>401</td>
              <td>
                <code className="inlineCode">authentication_failed</code>,{" "}
                <code className="inlineCode">install_auth_not_supported</code>
              </td>
              <td>Use a valid operator-issued Bearer credential.</td>
            </tr>
            <tr>
              <td>402</td>
              <td><code className="inlineCode">insufficient_credits</code></td>
              <td>Ask the private-beta operator to grant more credits.</td>
            </tr>
            <tr>
              <td>409</td>
              <td>
                <code className="inlineCode">idempotency_conflict</code>,{" "}
                <code className="inlineCode">idempotency_in_progress</code>
              </td>
              <td>Fix a conflict, or briefly wait and poll the in-progress request.</td>
            </tr>
            <tr>
              <td>429</td>
              <td><code className="inlineCode">rate_limited</code></td>
              <td>Back off with jitter before retrying the same request and key.</td>
            </tr>
            <tr>
              <td>500</td>
              <td>
                <code className="inlineCode">render_failure</code>,{" "}
                <code className="inlineCode">storage_failure</code>,{" "}
                <code className="inlineCode">asset_persistence_failure</code>,{" "}
                <code className="inlineCode">internal_failure</code>
              </td>
              <td>The full reservation is refunded. The same key replays the terminal error.</td>
            </tr>
            <tr>
              <td>504</td>
              <td><code className="inlineCode">provider_timeout</code></td>
              <td>The full reservation is refunded. Back off; a new attempt requires a new key.</td>
            </tr>
            <tr>
              <td>404 / 410</td>
              <td>
                <code className="inlineCode">asset_not_found</code>,{" "}
                <code className="inlineCode">asset_expired</code>
              </td>
              <td>Stop fetching that media URL.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="retries">
        <h2 id="retries">Timeouts, rate limits, and retries</h2>
        <p>
          Use a client timeout of at least 30 seconds. If the connection outcome is
          unknown, retry the exact validated body with the same idempotency key. This
          recovers a completed response without a second charge. Do not create a new key
          merely because a client timed out.
        </p>
        <p>
          For <code className="inlineCode">idempotency_in_progress</code> or{" "}
          <code className="inlineCode">rate_limited</code>, use bounded exponential
          backoff with jitter and keep the same key. A terminal provider or generation
          failure is replayed under its original key; use a new key only when you
          intentionally want a new generation attempt.
        </p>
      </section>

      <section aria-labelledby="examples">
        <h2 id="examples">Client examples</h2>
        <h3>TypeScript</h3>
        <pre className="codeBlock"><code>{typeScriptExample}</code></pre>
        <h3>Python</h3>
        <pre className="codeBlock"><code>{pythonExample}</code></pre>
      </section>

      <footer className="contentFooter">
        To request private-beta access or operator support, contact{" "}
        <a href="mailto:moyezrabbani.work@gmail.com">moyezrabbani.work@gmail.com</a>.
      </footer>
    </main>
  );
}
