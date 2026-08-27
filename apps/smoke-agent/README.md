# MemeDrop smoke agent

This workspace is a black-box consumer of the public MemeDrop agent API. It uses only HTTPS,
Bearer authentication, the documented JSON contract, and the returned authenticated media URL. It
does not import the FastAPI application, connect to PostgreSQL or Redis, or access object storage.

The smoke verifies:

1. `/live` and `/health` are ready before spending a credit;
2. the minimal generation request succeeds or returns a valid `no_fit` result;
3. replaying the exact body and idempotency key returns the identical terminal response; and
4. every returned private image is downloadable with the same agent credential, is bounded in
   size, and expires within the documented retention window.

Run the built-in synthetic scenario:

```sh
MEMEDROP_API_BASE_URL=https://api.memedrop.moyezrabbani.dev \
MEMEDROP_API_KEY=<issued-agent-credential> \
npm run smoke:agent -- --confirm-generation
```

A successful new run consumes one credit. The immediate replay uses the same idempotency key and
must not generate or charge again. The report intentionally omits the request input and credential.

For a custom scenario, prefer standard input so source text does not appear in the process list:

```sh
MEMEDROP_API_BASE_URL=https://api.memedrop.moyezrabbani.dev \
MEMEDROP_API_KEY=<issued-agent-credential> \
npm run smoke:agent -- --confirm-generation --stdin < /path/to/private-input.txt
```

Optional controls mirror the public API: `--direction`, `--count 1..5`, `--idempotency-key`, and
`--timeout-ms`. Preserve an explicit idempotency key only when retrying the same intended request.
Do not put the API key in a command-line argument, tracked file, or captured terminal output.
