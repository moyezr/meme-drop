import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(appDirectory, "..", "..", "..");

dotenv.config({ path: path.join(repositoryRoot, ".env"), quiet: true });
dotenv.config({
  path: path.join(repositoryRoot, "apps", "api", ".env"),
  override: false,
  quiet: true,
});

export interface PipelineConfig {
  semanticModel: string;
  openRouterApiKey: string;
  visionModel: string;
  s3Endpoint: string;
  s3Region: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  bucket: "meme-drop-dev";
  statePath: string;
  manifestPath: string;
  batchSize: number;
  batchConcurrency: number;
  cooldownMs: number;
  scrapeDelayMs: number;
}

export function loadConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  const bucket = overrides.bucket || process.env.S3_BUCKET_NAME;
  if (bucket !== "meme-drop-dev") {
    throw new Error(
      `Template pipeline refuses bucket ${JSON.stringify(bucket || "unset")}; S3_BUCKET_NAME must be meme-drop-dev.`,
    );
  }
  return {
    openRouterApiKey: overrides.openRouterApiKey ?? process.env.OPENROUTER_API_KEY ?? "",
    semanticModel:
      overrides.semanticModel ??
      process.env.TEMPLATE_PIPELINE_SEMANTIC_MODEL ??
      process.env.OPENROUTER_TEMPLATE_MODEL ??
      "google/gemini-3.7-flash",
    visionModel:
      overrides.visionModel ??
      process.env.TEMPLATE_PIPELINE_VISION_MODEL ??
      process.env.OPENROUTER_TEMPLATE_MODEL ??
      "google/gemini-3.7-flash",
    s3Endpoint: required(overrides.s3Endpoint ?? process.env.S3_ENDPOINT, "S3_ENDPOINT"),
    s3Region: required(overrides.s3Region ?? process.env.S3_REGION, "S3_REGION"),
    s3AccessKeyId: required(
      overrides.s3AccessKeyId ?? process.env.S3_ACCESS_KEY_ID,
      "S3_ACCESS_KEY_ID",
    ),
    s3SecretAccessKey: required(
      overrides.s3SecretAccessKey ?? process.env.S3_SECRET_ACCESS_KEY,
      "S3_SECRET_ACCESS_KEY",
    ),
    bucket,
    statePath:
      overrides.statePath ??
      process.env.TEMPLATE_PIPELINE_STATE_PATH ??
      path.join(repositoryRoot, ".memedrop", "template-pipeline", "state.json"),
    manifestPath:
      overrides.manifestPath ??
      process.env.TEMPLATE_PIPELINE_MANIFEST_PATH ??
      path.join(repositoryRoot, ".memedrop", "template-pipeline", "manifest.json"),
    batchSize: positiveInteger(
      overrides.batchSize ?? process.env.TEMPLATE_PIPELINE_BATCH_SIZE ?? 5,
      "TEMPLATE_PIPELINE_BATCH_SIZE",
    ),
    batchConcurrency: positiveInteger(
      overrides.batchConcurrency ?? process.env.TEMPLATE_PIPELINE_CONCURRENCY ?? 2,
      "TEMPLATE_PIPELINE_CONCURRENCY",
    ),
    cooldownMs: nonNegativeInteger(
      overrides.cooldownMs ?? process.env.TEMPLATE_PIPELINE_COOLDOWN_MS ?? 15_000,
      "TEMPLATE_PIPELINE_COOLDOWN_MS",
    ),
    scrapeDelayMs: nonNegativeInteger(
      overrides.scrapeDelayMs ?? process.env.TEMPLATE_PIPELINE_SCRAPE_DELAY_MS ?? 1_000,
      "TEMPLATE_PIPELINE_SCRAPE_DELAY_MS",
    ),
  };
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required for the template pipeline.`);
  return value.trim();
}

function positiveInteger(value: string | number, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function nonNegativeInteger(value: string | number, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}
