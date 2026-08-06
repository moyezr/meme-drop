import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(import.meta.dirname, "..", "..", "..");
const generatorPath = path.join(
  rootDir,
  "tools",
  "template-tools",
  "scripts",
  "generate-template-manifest.ts"
);

test("generated manifests include normalized versioned retrieval metadata", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-manifest-"));
  const outputPath = path.join(tempDir, "generated.json");

  await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      generatorPath,
      "--dry-run",
      "--files-only",
      "--only",
      "Drake Hotline Bling",
      "--out",
      outputPath,
    ],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        MEME_STORAGE_PATH: path.join(rootDir, "apps", "api", "data", "memes"),
      },
    }
  );

  const manifest = JSON.parse(await fs.readFile(outputPath, "utf8")) as {
    templates: Array<{
      retrieval?: {
        version: number;
        joke_shapes: string[];
        positive_hints: string[];
        anti_hints: string[];
      };
    }>;
  };

  assert.equal(manifest.templates.length, 1);
  assert.deepEqual(manifest.templates[0]?.retrieval, {
    version: 1,
    joke_shapes: [],
    positive_hints: [],
    anti_hints: [],
  });
});
