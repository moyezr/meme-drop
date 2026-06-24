import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const validExtensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const repoRoot = process.cwd();
const planPath = path.join(repoRoot, ".memedrop", "template-promotion-plan.json");

test("launch status reports a valid Chrome extension CORS origin as ready", () => {
  const result = runLaunchStatus({
    MEMEDROP_CORS_ORIGINS: validExtensionOrigin,
    VITE_API_BASE_URL: "https://api.memedrop.example",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Backend CORS includes a final Chrome extension origin/);
  assert.doesNotMatch(result.stdout, /MEMEDROP_CORS_ORIGINS must include the final chrome-extension/);
  assert.doesNotMatch(result.stdout, /Chrome extension origin must use the final 32-character/);
});

test("launch status blocks placeholder Chrome extension CORS origins", () => {
  const result = runLaunchStatus({
    MEMEDROP_CORS_ORIGINS: "chrome-extension://your-published-extension-id",
    VITE_API_BASE_URL: "https://api.memedrop.example",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Chrome extension origin must use the final 32-character Web Store extension ID/);
});

test("launch status requires a Chrome extension CORS origin", () => {
  const result = runLaunchStatus({
    MEMEDROP_CORS_ORIGINS: "https://app.memedrop.com",
    VITE_API_BASE_URL: "https://api.memedrop.example",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /must include the final chrome-extension/);
});

test("launch status warns when dataset promotion plan is missing", () => {
  withPromotionPlan(null, () => {
    const result = runLaunchStatus({
      MEMEDROP_CORS_ORIGINS: validExtensionOrigin,
      VITE_API_BASE_URL: "https://api.memedrop.example",
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Dataset promotion plan is missing/);
  });
});

test("launch status reports mechanically ready draft templates from the promotion plan", () => {
  withPromotionPlan(
    {
      summary: {
        approved_blocked: 0,
        approved_ready: 0,
        ready_for_review: 7,
        selected_for_next_batch: 0,
      },
    },
    () => {
      const result = runLaunchStatus({
        MEMEDROP_CORS_ORIGINS: validExtensionOrigin,
        VITE_API_BASE_URL: "https://api.memedrop.example",
      });

      assert.equal(result.status, 1);
      assert.match(result.stdout, /7 mechanically ready draft templates still awaiting human visual QA/);
    }
  );
});

test("launch status blocks approved dataset templates that are not promotion-safe", () => {
  withPromotionPlan(
    {
      summary: {
        approved_blocked: 2,
        approved_ready: 1,
        ready_for_review: 0,
        selected_for_next_batch: 1,
      },
    },
    () => {
      const result = runLaunchStatus({
        MEMEDROP_CORS_ORIGINS: validExtensionOrigin,
        VITE_API_BASE_URL: "https://api.memedrop.example",
      });

      assert.equal(result.status, 1);
      assert.match(result.stdout, /1 approved templates ready; selected next batch size is 1/);
      assert.match(result.stdout, /2 approved templates blocked by missing benchmark coverage or stale QA warnings/);
    }
  );
});

function runLaunchStatus(env) {
  return spawnSync(process.execPath, ["scripts/launch-status.mjs"], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH || "",
      ...env,
    },
    encoding: "utf8",
  });
}

function withPromotionPlan(plan, callback) {
  const previous = fs.existsSync(planPath) ? fs.readFileSync(planPath, "utf8") : null;
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  try {
    if (plan === null) {
      if (fs.existsSync(planPath)) fs.unlinkSync(planPath);
    } else {
      fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    }
    callback();
  } finally {
    if (previous === null) {
      if (fs.existsSync(planPath)) fs.unlinkSync(planPath);
    } else {
      fs.writeFileSync(planPath, previous);
    }
  }
}
