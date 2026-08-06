import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MEME_TEMPLATE_MANIFEST } from "../packages/shared/src/data/meme-template-manifest.ts";
import { MEME_TEMPLATE_RETRIEVAL } from "../packages/shared/src/data/meme-template-retrieval.ts";
import generatedManifest from "../packages/shared/src/data/meme-template-manifest.generated.json" with {
  type: "json",
};
import promotedManifest from "../packages/shared/src/data/meme-template-manifest.promoted.json" with {
  type: "json",
};

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputPath = path.join(
  root,
  "apps",
  "api",
  "src",
  "memedrop_api",
  "data",
  "meme_catalog.json"
);
const sourceTemplates = [
  ...MEME_TEMPLATE_MANIFEST.templates,
  ...promotedManifest.templates,
  ...generatedManifest.templates,
];
const verifiedTemplateIds = new Set(
  sourceTemplates
    .filter((template) => template.supports_overlay && template.quality === "verified")
    .map((template) => template.template_id)
);
const annotatedTemplateIds = new Set(Object.keys(MEME_TEMPLATE_RETRIEVAL));
const missingRetrievalMetadata = [...verifiedTemplateIds].filter(
  (templateId) => !annotatedTemplateIds.has(templateId)
);
const unknownRetrievalMetadata = [...annotatedTemplateIds].filter(
  (templateId) => !verifiedTemplateIds.has(templateId)
);

if (missingRetrievalMetadata.length || unknownRetrievalMetadata.length) {
  throw new Error(
    "Retrieval metadata must cover exactly the verified runtime templates. " +
      `Missing: ${missingRetrievalMetadata.join(", ") || "none"}. ` +
      `Unknown: ${unknownRetrievalMetadata.join(", ") || "none"}.`
  );
}

const templates = sourceTemplates.map((template) => ({
  ...template,
  retrieval:
    MEME_TEMPLATE_RETRIEVAL[template.template_id] ??
    template.retrieval ?? {
      version: 1,
      joke_shapes: [],
      positive_hints: [],
      anti_hints: [],
    },
}));
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
