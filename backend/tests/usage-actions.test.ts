import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  USAGE_FEEDBACK_ACTIONS,
  usageActionCheckConstraintSql,
} from "../src/db/usage-actions.js";

test("usage action check constraint includes every supported feedback action", () => {
  const constraint = usageActionCheckConstraintSql();

  for (const action of USAGE_FEEDBACK_ACTIONS) {
    assert.match(constraint, new RegExp(`'${action}'`));
  }
  assert.match(constraint, /^action IN \(/);
});

test("schema.sql usage action constraint matches the shared action list", () => {
  const schemaPath = path.resolve(import.meta.dirname, "..", "src", "db", "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  const expected = usageActionCheckConstraintSql();

  assert.match(schemaSql, new RegExp(escapeRegExp(`CHECK (${expected})`)));
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
