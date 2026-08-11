import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(import.meta.dirname, "..", "..", "..");
const scriptPath = path.join(
  rootDir,
  "tools",
  "template-tools",
  "scripts",
  "render-annotation-workbench.ts"
);

test("annotation workbench renders one draft without changing runtime data", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-annotation-"));
  const outputPath = path.join(tempDir, "absolute-cinema.html");

  await execFileAsync(
    "node",
    ["--import", "tsx", scriptPath, "--template", "absolute-cinema", "--out", outputPath],
    { cwd: rootDir }
  );

  const html = await fs.readFile(outputPath, "utf8");
  assert.match(html, /Template annotation workbench/);
  assert.match(html, /"template_id":"absolute-cinema"/);
  assert.match(html, /"quality":"draft"/);
  assert.match(html, /Drag a region to move it/);
  assert.match(html, /Export draft JSON/);
  assert.match(html, /this tool never edits the runtime catalog/);
  const browserScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(browserScript);
  assert.doesNotThrow(() => new Function(browserScript));
});

test("annotation workbench requires one known draft template", async () => {
  await assert.rejects(
    execFileAsync("node", ["--import", "tsx", scriptPath], { cwd: rootDir }),
    /Pass exactly one draft/
  );
  await assert.rejects(
    execFileAsync(
      "node",
      ["--import", "tsx", scriptPath, "--template", "not-a-real-template"],
      { cwd: rootDir }
    ),
    /No draft template matched/
  );
});
