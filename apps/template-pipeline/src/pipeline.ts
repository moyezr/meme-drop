import { createHash } from "node:crypto";

import type { PipelineConfig } from "./config.js";
import { annotateBatch, annotationInputHash } from "./openrouter.js";
import { downloadTemplateImage } from "./image.js";
import { scrapeImgflipTemplates } from "./scrape.js";
import { loadState, recordKey, saveState, writeManifest } from "./state.js";
import { DevelopmentTemplateStorage } from "./storage.js";
import type { PipelineRecord, PipelineState } from "./types.js";
import { extractVisionFacts } from "./vision.js";

export interface RunOptions {
  limit: number;
  allowTextOnlyLayout: boolean;
  retryFailed: boolean;
  refreshAnnotations: boolean;
  onProgress?: (message: string) => void;
}

export async function scrapeAndStore(
  config: PipelineConfig,
  options: Pick<RunOptions, "limit" | "retryFailed" | "onProgress">,
): Promise<PipelineState> {
  const state = await loadState(config.statePath);
  const sources = await scrapeImgflipTemplates({
    limit: options.limit,
    delayMs: config.scrapeDelayMs,
    onPage: (page, count) => options.onProgress?.(`discovery page=${page} unique=${count}`),
  });
  for (const source of sources) {
    const key = `${source.provider}:${source.source_id}`;
    if (state.records[key]) state.records[key].source = source;
    else {
      state.records[key] = {
        source,
        stage: "discovered",
        attempts: 0,
        updated_at: new Date().toISOString(),
      };
    }
  }
  await saveState(config.statePath, state);

  const storage = new DevelopmentTemplateStorage(config);
  const candidates = Object.values(state.records)
    .filter((record) => record.source.rank <= options.limit)
    .filter((record) => record.stage === "discovered" || (options.retryFailed && record.stage === "failed"))
    .sort(byRank);
  const contentOwners = contentHashOwners(state);
  for (const group of chunks(candidates, Math.max(1, config.batchConcurrency * 4))) {
    const downloads = await parallelMap(group, config.batchConcurrency, async (record) => {
      try {
        return { record, image: await downloadTemplateImage(record.source) };
      } catch (error) {
        return { record, error: error as Error };
      }
    });
    for (const item of downloads) {
      const key = recordKey(item.record);
      const current = state.records[key];
      current.attempts += 1;
      current.updated_at = new Date().toISOString();
      if ("error" in item && item.error) {
        current.stage = "failed";
        current.error = safeError(item.error);
        options.onProgress?.(`store failed ${current.source.name}: ${current.error}`);
        continue;
      }
      const duplicateOf = contentOwners.get(item.image.content_sha256);
      if (duplicateOf && duplicateOf !== key) {
        current.stage = "duplicate";
        current.duplicate_of = duplicateOf;
        current.asset = state.records[duplicateOf]?.asset;
        current.error = undefined;
        options.onProgress?.(`duplicate ${current.source.name} -> ${duplicateOf}`);
        continue;
      }
      try {
        current.source.source_url = item.image.resolved_url;
        current.asset = await storage.putIfAbsent(current.source, item.image);
        current.stage = "stored";
        current.error = undefined;
        contentOwners.set(item.image.content_sha256, key);
        options.onProgress?.(`stored ${current.source.rank}/${options.limit} ${current.source.name}`);
      } catch (error) {
        current.stage = "failed";
        current.error = safeError(error as Error);
        options.onProgress?.(`store failed ${current.source.name}: ${current.error}`);
      }
    }
    await saveState(config.statePath, state);
  }
  return state;
}

export async function annotateStoredTemplates(
  config: PipelineConfig,
  options: Pick<RunOptions, "limit" | "allowTextOnlyLayout" | "retryFailed" | "refreshAnnotations" | "onProgress">,
): Promise<PipelineState> {
  const state = await loadState(config.statePath);
  const visionCandidates = Object.values(state.records)
    .filter((record) => record.source.rank <= options.limit)
    .filter((record) => record.stage === "stored" || (options.retryFailed && record.stage === "failed" && record.asset))
    .sort(byRank);

  for (const group of chunks(visionCandidates, config.batchConcurrency)) {
    const results = await parallelMap(group, config.batchConcurrency, async (record) => {
      try {
        const image = await downloadTemplateImage(record.source);
        if (image.content_sha256 !== record.asset!.content_sha256) {
          throw new Error("Source image changed after it was stored; rerun scraping before annotation.");
        }
        const vision = await withVisionRetry(
          () =>
            extractVisionFacts(record.source, image, config, {
              allowTextOnly: options.allowTextOnlyLayout,
            }),
          3,
        );
        return { record, vision };
      } catch (error) {
        return { record, error: error as Error };
      }
    });
    for (const result of results) {
      const current = state.records[recordKey(result.record)];
      current.attempts += 1;
      current.updated_at = new Date().toISOString();
      if ("error" in result && result.error) {
        current.stage = "failed";
        current.error = safeError(result.error);
        options.onProgress?.(`vision failed ${current.source.name}: ${current.error}`);
      } else {
        current.vision = result.vision;
        current.stage = "vision_ready";
        current.error = undefined;
        options.onProgress?.(`vision ${current.source.rank}/${options.limit} ${current.source.name}`);
      }
    }
    await saveState(config.statePath, state);
  }

  const annotationCandidates = Object.values(state.records)
    .filter(
      (record) =>
        record.source.rank <= options.limit &&
        Boolean(record.asset && record.vision) &&
        (record.stage === "vision_ready" || (options.refreshAnnotations && Boolean(record.annotation))),
    )
    .filter((record) => {
      const model = record.vision?.geometry_source === "vision_model" ? config.visionModel : null;
      return record.annotation_input_sha256 !== annotationInputHash(record, model, config.semanticModel);
    })
    .sort(byRank);
  const batches = chunks(annotationCandidates, config.batchSize);
  const indexedBatches = batches.map((batch, batchIndex) => ({ batch, batchIndex }));
  const waves = chunks(indexedBatches, config.batchConcurrency);
  for (const [waveIndex, wave] of waves.entries()) {
    let providerHalt: Error | undefined;
    await parallelMap(wave, config.batchConcurrency, async ({ batch, batchIndex }) => {
      options.onProgress?.(`${config.semanticModel} batch=${batchIndex + 1}/${batches.length} size=${batch.length}`);
      try {
        const annotations = await annotateBatch(batch, config);
        for (const record of batch) {
          applyAnnotation(state, record, annotations.get(record.source.source_id));
        }
      } catch (batchError) {
        const message = safeError(batchError as Error);
        options.onProgress?.(`${config.semanticModel} batch quarantined for item retry: ${message}`);
        for (const record of batch) {
          const current = state.records[recordKey(record)];
          current.stage = current.annotation ? "annotated" : "failed";
          current.attempts += 1;
          current.error = current.annotation ? `annotation refresh failed: ${message}` : message;
          current.updated_at = new Date().toISOString();
        }
        if (shouldHaltProvider(message)) {
          providerHalt = new Error(
            `${config.semanticModel} annotation halted after bounded retries: ${message}`,
          );
        }
      }
    });
    await saveState(config.statePath, state);
    await writeManifest(config.manifestPath, state);
    if (providerHalt) throw providerHalt;
    if (waveIndex < waves.length - 1 && config.cooldownMs) {
      options.onProgress?.(`cooldown ${config.cooldownMs}ms`);
      await delay(config.cooldownMs);
    }
  }
  await writeManifest(config.manifestPath, state);
  return state;
}

export function shouldHaltProvider(message: string): boolean {
  return /\b(?:401|402|403|429)\b/.test(message) || /\b(?:billing|quota)\b/i.test(message);
}

export async function runPipeline(config: PipelineConfig, options: RunOptions): Promise<PipelineState> {
  await scrapeAndStore(config, options);
  return annotateStoredTemplates(config, options);
}

function applyAnnotation(
  state: PipelineState,
  record: PipelineRecord,
  annotation: PipelineRecord["annotation"] | undefined,
): void {
  const current = state.records[recordKey(record)];
  if (!annotation) throw new Error(`Annotation missing for ${record.source.source_id}`);
  current.annotation = annotation;
  current.annotation_input_sha256 = annotation.annotation_meta.input_sha256;
  current.stage = "annotated";
  current.attempts += 1;
  current.error = undefined;
  current.updated_at = new Date().toISOString();
}

function contentHashOwners(state: PipelineState): Map<string, string> {
  const owners = new Map<string, string>();
  for (const [key, record] of Object.entries(state.records)) {
    if (record.asset && record.stage !== "duplicate") owners.set(record.asset.content_sha256, key);
  }
  return owners;
}

async function parallelMap<T, R>(
  values: T[],
  concurrency: number,
  work: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await work(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function byRank(left: PipelineRecord, right: PipelineRecord): number {
  return left.source.rank - right.source.rank;
}

function safeError(error: Error): string {
  return error.message.replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]").slice(0, 500);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withVisionRetry<T>(work: () => Promise<T>, attempts: number): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error as Error;
      if (lastError.message.includes("data_inspection_failed") || attempt === attempts) throw lastError;
      await delay(750 * 2 ** (attempt - 1));
    }
  }
  throw lastError || new Error("Vision extraction failed");
}

export function stableJsonHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
