import fs from "node:fs/promises";
import path from "node:path";

import type { PipelineManifest, PipelineRecord, PipelineState } from "./types.js";

export async function loadState(filePath: string): Promise<PipelineState> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as PipelineState;
    if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== "object") {
      throw new Error("unsupported state shape");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, records: {} };
    throw new Error(`Cannot read pipeline state ${filePath}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

export async function saveState(filePath: string, state: PipelineState): Promise<void> {
  await writeJsonAtomically(filePath, state);
}

export function recordKey(record: Pick<PipelineRecord, "source">): string {
  return `${record.source.provider}:${record.source.source_id}`;
}

export async function writeManifest(filePath: string, state: PipelineState): Promise<PipelineManifest> {
  const templates = Object.values(state.records)
    .flatMap((record) => (record.annotation ? [record.annotation] : []))
    .sort((left, right) => left.template_id.localeCompare(right.template_id));
  const manifest: PipelineManifest = {
    version: 2,
    generated_at: new Date().toISOString(),
    generator: {
      app: "@memedrop/template-pipeline",
      semantic_model: dominantSemanticModel(templates),
      note: "Machine-generated development drafts. Human review, rendered QA, benchmark coverage, and promotion remain mandatory.",
    },
    templates,
  };
  await writeJsonAtomically(filePath, manifest);
  return manifest;
}

function dominantSemanticModel(templates: PipelineManifest["templates"]): string {
  const counts = new Map<string, number>();
  for (const template of templates) {
    const model = template.annotation_meta.semantic_model;
    counts.set(model, (counts.get(model) || 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || "unknown";
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, filePath);
}

export function summarizeState(state: PipelineState): Record<string, number> {
  const summary: Record<string, number> = {
    total: 0,
    discovered: 0,
    stored: 0,
    vision_ready: 0,
    annotated: 0,
    duplicate: 0,
    failed: 0,
  };
  for (const record of Object.values(state.records)) {
    summary.total += 1;
    summary[record.stage] = (summary[record.stage] || 0) + 1;
  }
  return summary;
}
