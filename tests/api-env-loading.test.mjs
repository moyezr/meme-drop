import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const apiPackage = JSON.parse(fs.readFileSync("apps/api/package.json", "utf8"));
const localOperationalScripts = [
  "dev",
  "usage-feedback",
  "storage:check",
  "storage:latency",
  "db:init",
  "db:seed",
  "db:seed-memes",
  "db:migrate",
];

test("local API operations load the repository development environment", () => {
  for (const name of localOperationalScripts) {
    assert.match(
      apiPackage.scripts[name],
      /uv run --env-file \.\.\/\.\.\/\.env /,
      `${name} must load the root .env when npm runs it from apps/api`
    );
  }
});

test("tests and production preflight do not implicitly load development secrets", () => {
  for (const name of ["test", "test:integration", "production-env", "typecheck", "lint"]) {
    assert.doesNotMatch(apiPackage.scripts[name], /--env-file/);
  }
});
