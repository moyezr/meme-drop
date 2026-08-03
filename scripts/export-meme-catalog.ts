import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MEME_TEMPLATE_MANIFEST } from "../packages/shared/src/data/meme-template-manifest.ts";
import generatedManifest from "../packages/shared/src/data/meme-template-manifest.generated.json" with {
  type: "json",
};
import promotedManifest from "../packages/shared/src/data/meme-template-manifest.promoted.json" with {
  type: "json",
};

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputPath = path.join(root, "packages", "meme-catalog", "manifest.json");
const templates = [
  ...MEME_TEMPLATE_MANIFEST.templates,
  ...promotedManifest.templates,
  ...generatedManifest.templates,
];
const manifest = {
  version: MEME_TEMPLATE_MANIFEST.version,
  generated_at: new Date().toISOString(),
  sources: {
    curated: MEME_TEMPLATE_MANIFEST.templates.length,
    promoted: promotedManifest.templates.length,
    generated: generatedManifest.templates.length,
  },
  templates,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Exported ${templates.length} templates to ${outputPath}`);
