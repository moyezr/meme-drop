import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";

type ManifestQuality = "verified" | "draft" | "disabled";

interface MemeInput {
  id: string;
  name: string;
  filePath: string;
  formatType: string;
}

interface TemplateManifest {
  version: number;
  generated_at: string;
  generator: {
    provider: "openai";
    model: string;
    note: string;
  };
  templates: MemeTemplate[];
}

interface MemeTemplate {
  template_id: string;
  meme_id?: string;
  name: string;
  aliases: string[];
  source_image: string;
  image_width: number;
  image_height: number;
  image_aspect_ratio: number;
  supports_overlay: boolean;
  quality: ManifestQuality;
  regions: TextRegion[];
  caption_guidance: CaptionGuidance;
}

interface TextRegion {
  id: string;
  role: string;
  x: number;
  y: number;
  width: number;
  height: number;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  max_lines: number;
  max_chars: number;
  font: {
    family: "Impact";
    min_size: number;
    max_size: number;
    stroke_ratio: number;
  };
  notes?: string;
}

interface CaptionGuidance {
  pattern: string;
  good_examples: Array<Record<string, string>>;
  bad_examples: Array<Record<string, string>>;
}

interface ModelTemplateResponse {
  supports_overlay?: boolean;
  quality?: ManifestQuality;
  regions?: Partial<TextRegion>[];
  caption_guidance?: Partial<CaptionGuidance>;
}

const rootDir = path.resolve(import.meta.dirname, "..", "..");
const backendDir = path.join(rootDir, "backend");
const defaultOutputPath = path.join(
  rootDir,
  "shared",
  "src",
  "data",
  "meme-template-manifest.generated.json"
);
const defaultStoragePath = path.join(backendDir, "data", "memes");

dotenv.config({ path: path.join(rootDir, ".env") });
dotenv.config({ path: path.join(backendDir, ".env"), override: true });

const args = parseArgs(process.argv.slice(2));
const model = args.model || process.env.OPENAI_TEMPLATE_MODEL || "gpt-5.4-mini";
const outputPath = path.resolve(rootDir, args.out || defaultOutputPath);
const storagePath = resolveStoragePath(process.env.MEME_STORAGE_PATH || defaultStoragePath);

async function main() {
  if (!args.dryRun && !hasUsableApiKey(process.env.OPENAI_API_KEY)) {
    throw new Error("A real OPENAI_API_KEY is required. Add it to .env or backend/.env.");
  }

  if (args.batchStatus) {
    await printBatchStatus(args.batchStatus);
    return;
  }

  const memes = await loadMemeInputs();
  const selected = memes
    .filter((meme) => !args.only || new RegExp(args.only, "i").test(meme.name))
    .slice(0, args.limit || memes.length);

  if (selected.length === 0) {
    throw new Error("No memes matched the requested filters.");
  }

  if (args.batchCreate) {
    await createOpenAIBatch(selected);
    return;
  }

  if (args.batchRetrieve) {
    await retrieveOpenAIBatch(args.batchRetrieve, selected);
    return;
  }

  const templates: MemeTemplate[] = [];
  for (const [index, meme] of selected.entries()) {
    const imagePath = toLocalImagePath(meme.filePath);
    const image = await fs.readFile(imagePath);
    const dimensions = readImageDimensions(image);
    const mimeType = guessMimeType(imagePath);

    console.log(
      `[${index + 1}/${selected.length}] ${meme.name} (${dimensions.width}x${dimensions.height})`
    );

    const generated = args.dryRun
      ? buildDryRunResponse(meme)
      : await generateTemplateWithOpenAI({
          meme,
          image,
          mimeType,
          dimensions,
        });

    templates.push(
      normalizeTemplate({
        meme,
        dimensions,
        generated,
      })
    );
  }

  const manifest: TemplateManifest = {
    version: 1,
    generated_at: new Date().toISOString(),
    generator: {
      provider: "openai",
      model,
      note:
        "Generated offline from meme images with OpenAI vision. Treat quality=draft as review-required before runtime use.",
    },
    templates,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`\nWrote ${templates.length} templates to ${path.relative(rootDir, outputPath)}`);
}

async function loadMemeInputs(): Promise<MemeInput[]> {
  if (args.filesOnly) return loadMemeInputsFromDisk();

  try {
    const [{ db }, { memes }] = await Promise.all([
      import("../src/db/index.js"),
      import("../src/db/schema.js"),
    ]);
    const rows = await db
      .select({
        id: memes.id,
        name: memes.name,
        filePath: memes.filePath,
        formatType: memes.formatType,
      })
      .from(memes)
      .where(args.id ? eq(memes.id, args.id) : undefined)
      .orderBy(memes.name);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      filePath: row.filePath,
      formatType: row.formatType,
    }));
  } catch (err) {
    console.warn(
      `Could not load memes from DB (${(err as Error).message}). Falling back to files.`
    );
    return loadMemeInputsFromDisk();
  }
}

async function loadMemeInputsFromDisk(): Promise<MemeInput[]> {
  const files = await fs.readdir(storagePath);
  return files
    .filter((file) => /\.(png|jpe?g|webp)$/i.test(file))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const name = file
        .replace(/^seed-/, "")
        .replace(/-[a-f0-9]{8}\.(png|jpe?g|webp)$/i, "")
        .replace(/\.(png|jpe?g|webp)$/i, "")
        .replace(/-/g, " ");
      return {
        id: path.parse(file).name,
        name,
        filePath: `/memes/${file}`,
        formatType: "unknown",
      };
    });
}

async function createOpenAIBatch(memes: MemeInput[]) {
  const jsonl = await buildBatchJsonl(memes);
  const batchDir = path.join(rootDir, ".memedrop", "batches");
  const fileName = `template-manifest-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
  const localPath = path.join(batchDir, fileName);
  await fs.mkdir(batchDir, { recursive: true });
  await fs.writeFile(localPath, jsonl, "utf8");

  console.log(`Prepared ${memes.length} batch requests at ${path.relative(rootDir, localPath)}`);
  const uploaded = await uploadBatchFile(jsonl, fileName);
  console.log(`Uploaded batch input file: ${uploaded.id}`);

  const batch = await createBatch(uploaded.id);
  console.log(`Created OpenAI batch: ${batch.id}`);
  console.log(`Status: ${batch.status}`);
  console.log(`Retrieve later with: npm run manifest:generate --workspace=backend -- --batch-retrieve ${batch.id}`);
}

async function buildBatchJsonl(memes: MemeInput[]): Promise<string> {
  const lines: string[] = [];
  for (const [index, meme] of memes.entries()) {
    const imagePath = toLocalImagePath(meme.filePath);
    const image = await fs.readFile(imagePath);
    const dimensions = readImageDimensions(image);
    const mimeType = guessMimeType(imagePath);
    console.log(
      `[batch ${index + 1}/${memes.length}] ${meme.name} (${dimensions.width}x${dimensions.height})`
    );
    lines.push(
      JSON.stringify({
        custom_id: batchCustomId(meme),
        method: "POST",
        url: "/v1/responses",
        body: buildOpenAIResponseBody({ meme, image, mimeType, dimensions }),
      })
    );
  }
  return `${lines.join("\n")}\n`;
}

async function uploadBatchFile(jsonl: string, filename: string): Promise<{ id: string }> {
  const form = new FormData();
  form.append("purpose", "batch");
  form.append(
    "file",
    new Blob([jsonl], { type: "application/jsonl" }),
    filename
  );

  const response = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI file upload failed ${response.status}: ${body.slice(0, 500)}`);
  }

  return (await response.json()) as { id: string };
}

async function createBatch(inputFileId: string): Promise<{ id: string; status: string }> {
  const response = await fetch("https://api.openai.com/v1/batches", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      input_file_id: inputFileId,
      endpoint: "/v1/responses",
      completion_window: "24h",
      metadata: {
        job: "memedrop-template-manifest",
        model,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI batch create failed ${response.status}: ${body.slice(0, 500)}`);
  }

  return (await response.json()) as { id: string; status: string };
}

async function printBatchStatus(batchId: string) {
  const batch = await getBatch(batchId);
  console.log(JSON.stringify(batch, null, 2));
}

async function retrieveOpenAIBatch(batchId: string, memes: MemeInput[]) {
  const batch = await getBatch(batchId);
  console.log(`Batch ${batch.id} status: ${batch.status}`);
  if (batch.status !== "completed") {
    console.log("Batch is not completed yet. Run this command again later.");
    return;
  }
  if (!batch.output_file_id) {
    throw new Error("Batch completed without an output_file_id.");
  }

  const output = await downloadFile(batch.output_file_id);
  const templates = await parseBatchOutput(output, memes);
  const manifest: TemplateManifest = {
    version: 1,
    generated_at: new Date().toISOString(),
    generator: {
      provider: "openai",
      model,
      note:
        "Generated offline from meme images with OpenAI Batch API. Treat quality=draft as review-required before runtime use.",
    },
    templates,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote ${templates.length} templates to ${path.relative(rootDir, outputPath)}`);

  if (batch.error_file_id) {
    console.log(`Batch has an error file: ${batch.error_file_id}`);
  }
}

async function getBatch(batchId: string): Promise<{
  id: string;
  status: string;
  output_file_id?: string | null;
  error_file_id?: string | null;
  request_counts?: { total: number; completed: number; failed: number };
}> {
  const response = await fetch(`https://api.openai.com/v1/batches/${batchId}`, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI batch retrieve failed ${response.status}: ${body.slice(0, 500)}`);
  }
  return (await response.json()) as Awaited<ReturnType<typeof getBatch>>;
}

async function downloadFile(fileId: string): Promise<string> {
  const response = await fetch(`https://api.openai.com/v1/files/${fileId}/content`, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI file download failed ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.text();
}

async function parseBatchOutput(output: string, memes: MemeInput[]): Promise<MemeTemplate[]> {
  const byCustomId = new Map(memes.map((meme) => [batchCustomId(meme), meme]));
  const templates: MemeTemplate[] = [];

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const item = JSON.parse(line) as {
      custom_id: string;
      response?: { status_code?: number; body?: { output_text?: string; output?: unknown[] } };
      error?: { message?: string };
    };

    const meme = byCustomId.get(item.custom_id);
    if (!meme) continue;
    if (item.error || item.response?.status_code !== 200) {
      console.warn(`Skipping failed batch result for ${meme.name}: ${item.error?.message || item.response?.status_code}`);
      continue;
    }

    const body = item.response?.body;
    const content = body?.output_text || extractResponseText(body?.output);
    if (!content) {
      console.warn(`Skipping batch result without output text for ${meme.name}`);
      continue;
    }

    const imagePath = toLocalImagePath(meme.filePath);
    const image = await fs.readFile(imagePath);
    const dimensions = readImageDimensions(image);
    const generated = JSON.parse(stripJsonFence(content)) as ModelTemplateResponse;
    templates.push(normalizeTemplate({ meme, dimensions, generated }));
  }

  templates.sort((a, b) => a.name.localeCompare(b.name));
  return templates;
}

async function generateTemplateWithOpenAI({
  meme,
  image,
  mimeType,
  dimensions,
}: {
  meme: MemeInput;
  image: Buffer;
  mimeType: string;
  dimensions: { width: number; height: number };
}): Promise<ModelTemplateResponse> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(buildOpenAIResponseBody({ meme, image, mimeType, dimensions })),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI template request failed ${response.status}: ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as { output_text?: string; output?: unknown[] };
  const content = data.output_text || extractResponseText(data.output);
  if (!content) throw new Error("OpenAI response did not include output text");
  return JSON.parse(stripJsonFence(content)) as ModelTemplateResponse;
}

function buildOpenAIResponseBody({
  meme,
  image,
  mimeType,
  dimensions,
}: {
  meme: MemeInput;
  image: Buffer;
  mimeType: string;
  dimensions: { width: number; height: number };
}) {
  return {
    model,
    temperature: 0.1,
    max_output_tokens: 1800,
    text: {
      format: { type: "json_object" },
    },
    input: [
      {
        type: "message",
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are creating meme text placement templates. Return valid JSON only. Do not include markdown.",
          },
        ],
      },
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildPrompt(meme, dimensions),
          },
          {
            type: "input_image",
            image_url: `data:${mimeType};base64,${image.toString("base64")}`,
            detail: "high",
          },
        ],
      },
    ],
  };
}

function buildPrompt(
  meme: MemeInput,
  dimensions: { width: number; height: number }
): string {
  return `Analyze this meme template and create a reusable text placement manifest.

Meme name: ${meme.name}
Format hint: ${meme.formatType}
Image size: ${dimensions.width}x${dimensions.height}

Coordinate system:
- x, y, width, height must be normalized numbers from 0 to 1.
- x/y are the top-left corner of the text-safe box.
- Boxes must stay within the image.
- Avoid faces, bodies, important objects, existing logos, and existing printed text unless the classic meme format expects text there.
- Prefer fewer, high-confidence regions over many weak regions.
- If this is mainly a reaction image with no good editable area, set supports_overlay=false and regions=[].

For each region include:
- id: snake_case semantic id, e.g. reject, approve, label_left, punchline
- role: what joke role this text plays
- x, y, width, height
- align: left | center | right
- valign: top | middle | bottom
- max_lines: 1 to 4
- max_chars: realistic character budget for this box
- font.family must be Impact
- font.min_size and font.max_size in pixels for this image size
- font.stroke_ratio, usually 0.10 to 0.16
- notes, optional

Also include caption_guidance:
- pattern: one sentence explaining how the meme joke works
- good_examples: two examples keyed by region id
- bad_examples: two examples keyed by region id

Return exactly this JSON shape:
{
  "supports_overlay": true,
  "quality": "draft",
  "regions": [],
  "caption_guidance": {
    "pattern": "",
    "good_examples": [],
    "bad_examples": []
  }
}`;
}

function normalizeTemplate({
  meme,
  dimensions,
  generated,
}: {
  meme: MemeInput;
  dimensions: { width: number; height: number };
  generated: ModelTemplateResponse;
}): MemeTemplate {
  const supportsOverlay = Boolean(generated.supports_overlay);
  const regions = supportsOverlay
    ? (generated.regions || [])
        .map((region, index) => normalizeRegion(region, index, dimensions))
        .filter((region): region is TextRegion => Boolean(region))
    : [];

  return {
    template_id: slugify(meme.name),
    meme_id: meme.id,
    name: meme.name,
    aliases: [meme.name],
    source_image: meme.filePath,
    image_width: dimensions.width,
    image_height: dimensions.height,
    image_aspect_ratio: round(dimensions.width / dimensions.height, 4),
    supports_overlay: supportsOverlay && regions.length > 0,
    quality: generated.quality === "verified" ? "draft" : generated.quality || "draft",
    regions,
    caption_guidance: normalizeCaptionGuidance(generated.caption_guidance, regions),
  };
}

function normalizeRegion(
  region: Partial<TextRegion>,
  index: number,
  dimensions: { width: number; height: number }
): TextRegion | null {
  const width = clampNumber(region.width, 0.08, 1);
  const height = clampNumber(region.height, 0.05, 1);
  const x = clampNumber(region.x, 0, 1 - width);
  const y = clampNumber(region.y, 0, 1 - height);

  if (width * height < 0.008) return null;

  const maxFont = clampInteger(
    region.font?.max_size,
    12,
    Math.max(14, Math.floor(dimensions.height * 0.18)),
    Math.max(24, Math.floor(height * dimensions.height * 0.45))
  );
  const minFont = clampInteger(region.font?.min_size, 10, maxFont, 14);

  return {
    id: slugify(region.id || `region_${index + 1}`).replace(/-/g, "_"),
    role: String(region.role || `text region ${index + 1}`).slice(0, 120),
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
    align: oneOf(region.align, ["left", "center", "right"], "center"),
    valign: oneOf(region.valign, ["top", "middle", "bottom"], "middle"),
    max_lines: clampInteger(region.max_lines, 1, 4, 2),
    max_chars: clampInteger(region.max_chars, 8, 90, 36),
    font: {
      family: "Impact",
      min_size: minFont,
      max_size: maxFont,
      stroke_ratio: round(clampNumber(region.font?.stroke_ratio, 0.06, 0.2, 0.12), 3),
    },
    notes: region.notes ? String(region.notes).slice(0, 180) : undefined,
  };
}

function normalizeCaptionGuidance(
  guidance: Partial<CaptionGuidance> | undefined,
  regions: TextRegion[]
): CaptionGuidance {
  const fallbackExample = Object.fromEntries(
    regions.map((region) => [region.id, region.role])
  );
  const goodExamples = normalizeExamples(guidance?.good_examples, regions);
  const badExamples = normalizeExamples(guidance?.bad_examples, regions);

  return {
    pattern:
      guidance?.pattern ||
      "Use short, natural meme text that matches each region's semantic role.",
    good_examples: goodExamples.length ? goodExamples : [fallbackExample],
    bad_examples: badExamples,
  };
}

function normalizeExamples(
  examples: Array<Record<string, string>> | undefined,
  regions: TextRegion[]
): Array<Record<string, string>> {
  if (!examples?.length) return [];
  const regionIds = new Set(regions.map((region) => region.id));

  return examples
    .map((example) => {
      if (
        typeof example.region_id === "string" &&
        typeof example.text === "string" &&
        regionIds.has(example.region_id)
      ) {
        return { [example.region_id]: example.text };
      }

      const cleaned: Record<string, string> = {};
      for (const [key, value] of Object.entries(example)) {
        if (regionIds.has(key) && typeof value === "string") cleaned[key] = value;
      }
      return cleaned;
    })
    .filter((example) => Object.keys(example).length > 0);
}

function buildDryRunResponse(meme: MemeInput): ModelTemplateResponse {
  const textOverlay = meme.formatType === "text_overlay";
  return {
    supports_overlay: textOverlay,
    quality: "draft",
    regions: textOverlay
      ? [
          {
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
            font: {
              family: "Impact",
              min_size: 16,
              max_size: 42,
              stroke_ratio: 0.12,
            },
          },
        ]
      : [],
    caption_guidance: {
      pattern: `Draft placeholder for ${meme.name}.`,
      good_examples: [],
      bad_examples: [],
    },
  };
}

function toLocalImagePath(filePath: string): string {
  const relative = filePath.startsWith("/memes/")
    ? filePath.replace(/^\/memes\//, "")
    : filePath;
  if (path.isAbsolute(relative)) return relative;
  return path.join(storagePath, relative);
}

function resolveStoragePath(input: string): string {
  if (path.isAbsolute(input)) return input;
  const backendRelative = path.resolve(backendDir, input);
  return backendRelative;
}

function readImageDimensions(buffer: Buffer): { width: number; height: number } {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
  }

  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    const chunk = buffer.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X") {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
    if (chunk === "VP8 ") {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }
    if (chunk === "VP8L") {
      const bits = buffer.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
  }

  throw new Error("Unsupported image format or unreadable dimensions.");
}

function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function hasUsableApiKey(value: string | undefined): boolean {
  if (!value) return false;
  return !/your-|placeholder|example/i.test(value);
}

function stripJsonFence(content: string): string {
  return content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

function extractResponseText(output: unknown): string | null {
  if (!Array.isArray(output)) return null;

  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") chunks.push(text);
    }
  }

  return chunks.length ? chunks.join("\n") : null;
}

function parseArgs(argv: string[]) {
  const parsed: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i++;
    }
  }

  return {
    dryRun: Boolean(parsed["dry-run"]),
    filesOnly: Boolean(parsed["files-only"]),
    limit: parsed.limit ? Number(parsed.limit) : undefined,
    only: typeof parsed.only === "string" ? parsed.only : undefined,
    id: typeof parsed.id === "string" ? parsed.id : undefined,
    out: typeof parsed.out === "string" ? parsed.out : undefined,
    model: typeof parsed.model === "string" ? parsed.model : undefined,
    batchCreate: Boolean(parsed["batch-create"]),
    batchStatus:
      typeof parsed["batch-status"] === "string"
        ? parsed["batch-status"]
        : parsed["batch-status"]
          ? positional[0]
          : undefined,
    batchRetrieve:
      typeof parsed["batch-retrieve"] === "string"
        ? parsed["batch-retrieve"]
        : parsed["batch-retrieve"]
          ? positional[0]
          : undefined,
  };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function batchCustomId(meme: MemeInput): string {
  return `meme:${meme.id}`;
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback = min
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  return Math.round(clampNumber(value, min, max, fallback));
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function round(value: number, precision = 5): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
