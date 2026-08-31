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
  "generate-template-manifest.ts",
);

test("generated manifests include normalized versioned retrieval metadata", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "memedrop-manifest-"),
  );
  const storagePath = path.join(tempDir, "memes");
  const outputPath = path.join(tempDir, "generated.json");
  await fs.mkdir(storagePath);
  await fs.writeFile(
    path.join(storagePath, "seed-drake-hotline-bling.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQAAAAB0CZXLAAAANUlEQVR42u3KoQEAAAgDoOn/P+sHZgNkanLrCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgvA4LAt8C/7gxw98AAAAASUVORK5CYII=",
      "base64",
    ),
  );

  await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      generatorPath,
      "--dry-run",
      "--files-only",
      "--format-type",
      "text_overlay",
      "--only",
      "Drake Hotline Bling",
      "--out",
      outputPath,
    ],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        MEME_STORAGE_PATH: storagePath,
      },
    },
  );

  const manifest = JSON.parse(await fs.readFile(outputPath, "utf8")) as {
    templates: Array<{
      regions: Array<{
        padding_ratio: number;
        text_transform: string;
        font: {
          family: string;
          weight: number;
          fill_color: string;
          stroke_color: string;
          stroke_ratio: number;
          line_height_ratio: number;
        };
      }>;
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
  assert.deepEqual(manifest.templates[0]?.regions[0], {
    id: "top",
    role: "setup text",
    x: 0.05,
    y: 0.05,
    width: 0.9,
    height: 0.18,
    align: "center",
    valign: "middle",
    max_lines: 2,
    max_chars: 42,
    padding_ratio: 0.055,
    text_transform: "uppercase",
    font: {
      family: "Impact",
      min_size: 16,
      max_size: 42,
      weight: 900,
      fill_color: "#FFFFFF",
      stroke_color: "#000000",
      stroke_ratio: 0.12,
      line_height_ratio: 1.08,
    },
  });
});
