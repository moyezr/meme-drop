import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

test("requires explicit credit-spend confirmation before reading credentials", () => {
  const apiKey = "key_must_not_be_printed";
  const result = spawnSync(process.execPath, ["--import", "tsx", cliPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      MEMEDROP_API_BASE_URL: "https://api.example.com",
      MEMEDROP_API_KEY: apiKey,
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /"code":"confirmation_required"/u);
  assert.ok(!result.stderr.includes(apiKey));
  assert.equal(result.stdout, "");
});

test("reads credentials only from environment variables", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", cliPath, "--confirm-generation", "--api-key", "unsafe"],
    { encoding: "utf8", env: { ...process.env } },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /"code":"invalid_arguments"/u);
  assert.match(result.stderr, /Unknown argument: --api-key/u);
  assert.ok(!result.stderr.includes('"unsafe"'));
});
