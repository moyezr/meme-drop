import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import pg from "pg";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const GEMINI_FLASH_MODEL = "google/gemini-3.7-flash";

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
    provider: "openrouter";
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
  retrieval: RetrievalMetadata;
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
  padding_ratio: number;
  text_transform: "uppercase" | "none" | "mocking";
  font: {
    family: "Impact" | "Anton" | "Inter";
    min_size: number;
    max_size: number;
    weight: 400 | 700 | 900;
    fill_color: string;
    stroke_color: string;
    stroke_ratio: number;
    line_height_ratio: number;
  };
  notes?: string;
}

interface CaptionGuidance {
  pattern: string;
  good_examples: Array<Record<string, string>>;
  bad_examples: Array<Record<string, string>>;
}

interface RetrievalMetadata {
  version: 1;
  joke_shapes: string[];
  positive_hints: string[];
  anti_hints: string[];
}

interface ModelTemplateResponse {
  supports_overlay?: boolean;
  quality?: ManifestQuality;
  regions?: Partial<TextRegion>[];
  caption_guidance?: Partial<CaptionGuidance>;
  retrieval?: Partial<RetrievalMetadata>;
}

const rootDir = path.resolve(import.meta.dirname, "..", "..", "..");
const defaultOutputPath = path.join(
  rootDir,
  "packages",
  "shared",
  "src",
  "data",
  "meme-template-manifest.generated.json"
);
const defaultStoragePath = path.join(rootDir, "apps", "api", "data", "memes");

dotenv.config({ path: path.join(rootDir, ".env") });
dotenv.config({ path: path.join(rootDir, "apps", "api", ".env"), override: true });

const args = parseArgs(process.argv.slice(2));
const model = args.model || process.env.OPENROUTER_TEMPLATE_MODEL || GEMINI_FLASH_MODEL;
const outputPath = path.resolve(rootDir, args.out || defaultOutputPath);
const storagePath = resolveStoragePath(process.env.MEME_STORAGE_PATH || defaultStoragePath);

async function main() {
  if (!args.dryRun && !hasUsableApiKey(getOpenRouterApiKey())) {
    throw new Error("A real OPENROUTER_API_KEY is required. Add it to .env or apps/api/.env.");
  }

  const memes = await loadMemeInputs();
  const selected = memes
    .filter((meme) => !args.only || new RegExp(args.only, "i").test(meme.name))
    .slice(0, args.limit || memes.length);

  if (selected.length === 0) {
    throw new Error("No memes matched the requested filters.");
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
      : await generateTemplateWithOpenRouter({
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
      provider: "openrouter",
      model,
      note:
        "Generated offline from meme images with OpenRouter vision. Treat quality=draft as review-required before runtime use.",
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
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const result = await pool.query<MemeInput>(
        `SELECT id::text, name, file_path AS "filePath", format_type AS "formatType"
           FROM memes
          WHERE $1::uuid IS NULL OR id = $1::uuid
          ORDER BY name`,
        [args.id || null]
      );
      return result.rows;
    } finally {
      await pool.end();
    }
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
        // A local file has no database format metadata. This optional override
        // makes deterministic dry-run annotation checks exercise overlay output.
        formatType: args.formatType || "unknown",
      };
    });
}

async function generateTemplateWithOpenRouter({
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
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getOpenRouterApiKey()}`,
      ...openRouterHeaders(),
    },
    body: JSON.stringify(buildOpenRouterChatBody({ meme, image, mimeType, dimensions })),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter template request failed ${response.status}: ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter response did not include output text");
  return JSON.parse(stripJsonFence(content)) as ModelTemplateResponse;
}

function buildOpenRouterChatBody({
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
    max_tokens: 1800,
    reasoning: { effort: "none", exclude: true },
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are creating meme text placement templates. Return valid JSON only. Do not include markdown.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildPrompt(meme, dimensions),
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${image.toString("base64")}`,
              detail: "high",
            },
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
- padding_ratio: 0 to 0.20, usually 0.055, for breathing room inside the box
- text_transform: uppercase | none | mocking. Use mocking only for formats whose joke depends on alternating case.
- font.family: Impact | Anton | Inter (Impact is the default for classic meme text)
- font.min_size and font.max_size in pixels for this image size
- font.weight: 400 | 700 | 900
- font.fill_color and font.stroke_color as #RRGGBB colors
- font.stroke_ratio, 0 to 0.25, usually 0.10 to 0.16
- font.line_height_ratio, 0.8 to 1.5, usually 1.08
- notes, optional

Also include caption_guidance:
- pattern: one sentence explaining how the meme joke works
- good_examples: two examples keyed by region id
- bad_examples: two examples keyed by region id

Also include retrieval, which is used only to retrieve this template before
captioning. It must describe the reusable joke grammar rather than details
visible in this one image:
- joke_shapes: 1 to 4 short normalized labels, for example "contrast" or
  "forced_choice"
- positive_hints: up to 8 short situations or language cues that fit this meme
- anti_hints: up to 8 short situations where this meme would be misleading or
  repetitive

Return exactly this JSON shape:
{
  "supports_overlay": true,
  "quality": "draft",
  "regions": [],
  "caption_guidance": {
    "pattern": "",
    "good_examples": [],
    "bad_examples": []
  },
  "retrieval": {
    "joke_shapes": [],
    "positive_hints": [],
    "anti_hints": []
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
    retrieval: normalizeRetrievalMetadata(generated.retrieval),
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
    padding_ratio: round(clampNumber(region.padding_ratio, 0, 0.2, 0.055), 3),
    text_transform: oneOf(region.text_transform, ["uppercase", "none", "mocking"], "uppercase"),
    font: {
      family: normalizeFontFamily(region.font?.family),
      min_size: minFont,
      max_size: maxFont,
      weight: normalizeFontWeight(region.font?.family, region.font?.weight),
      fill_color: normalizeHexColor(region.font?.fill_color, "#FFFFFF"),
      stroke_color: normalizeHexColor(region.font?.stroke_color, "#000000"),
      stroke_ratio: round(clampNumber(region.font?.stroke_ratio, 0, 0.25, 0.12), 3),
      line_height_ratio: round(clampNumber(region.font?.line_height_ratio, 0.8, 1.5, 1.08), 3),
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

function normalizeRetrievalMetadata(
  metadata: Partial<RetrievalMetadata> | undefined
): RetrievalMetadata {
  return {
    version: 1,
    joke_shapes: normalizeRetrievalValues(metadata?.joke_shapes, 4, 48),
    positive_hints: normalizeRetrievalValues(metadata?.positive_hints, 8, 160),
    anti_hints: normalizeRetrievalValues(metadata?.anti_hints, 8, 160),
  };
}

function normalizeRetrievalValues(
  values: string[] | undefined,
  maxItems: number,
  maxLength: number
): string[] {
  if (!Array.isArray(values)) return [];

  const normalized = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().replace(/\s+/g, " ").slice(0, maxLength))
    .filter(Boolean);
  return [...new Set(normalized)].slice(0, maxItems);
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
          },
        ]
      : [],
    caption_guidance: {
      pattern: `Draft placeholder for ${meme.name}.`,
      good_examples: [],
      bad_examples: [],
    },
    retrieval: {
      version: 1,
      joke_shapes: [],
      positive_hints: [],
      anti_hints: [],
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

  // API-owned .env files conventionally use paths relative to apps/api (for
  // example ./data/memes). Root-level config may instead use a workspace
  // relative path such as ./apps/api/data/memes, so preserve both forms.
  if (input === "data" || input.startsWith("data/") || input.startsWith("./data/")) {
    return path.resolve(rootDir, "apps", "api", input);
  }
  return path.resolve(rootDir, input);
}

function getOpenRouterApiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY;
}

function openRouterHeaders(): Record<string, string> {
  return {
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3001",
    "X-Title": process.env.OPENROUTER_APP_NAME || "MemeDrop",
  };
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

function parseArgs(argv: string[]) {
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
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
    formatType: typeof parsed["format-type"] === "string" ? parsed["format-type"] : undefined,
  };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
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

function oneOf<T extends string | number>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : fallback;
}

function normalizeFontFamily(value: unknown): TextRegion["font"]["family"] {
  return oneOf(value, ["Impact", "Anton", "Inter"], "Impact");
}

function normalizeFontWeight(
  familyValue: unknown,
  weightValue: unknown
): TextRegion["font"]["weight"] {
  return normalizeFontFamily(familyValue) === "Anton"
    ? 400
    : oneOf(weightValue, [400, 700, 900], 900);
}

function round(value: number, precision = 5): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
