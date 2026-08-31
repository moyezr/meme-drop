import process from "node:process";

import { loadConfig } from "./config.js";
import { annotateStoredTemplates, runPipeline, scrapeAndStore } from "./pipeline.js";
import { loadState, summarizeState, writeManifest } from "./state.js";

const [command = "status", ...rawArgs] = process.argv.slice(2);
const args = parseArgs(rawArgs);
const config = loadConfig({
  batchSize: numberArg(args, "batch-size"),
  batchConcurrency: numberArg(args, "concurrency"),
  cooldownMs: numberArg(args, "cooldown-ms"),
  scrapeDelayMs: numberArg(args, "scrape-delay-ms"),
  statePath: stringArg(args, "state"),
  manifestPath: stringArg(args, "out"),
});
const options = {
  limit: numberArg(args, "limit") || 1_000,
  allowTextOnlyLayout: Boolean(args["allow-text-only-layout"]),
  retryFailed: Boolean(args["retry-failed"]),
  refreshAnnotations: Boolean(args["refresh-annotations"]),
  onProgress: (message: string) => console.log(`[template-pipeline] ${message}`),
};

if (options.limit < 1 || options.limit > 1_000) {
  throw new Error("--limit must be between 1 and 1000.");
}

switch (command) {
  case "scrape": {
    const state = await scrapeAndStore(config, options);
    console.log(JSON.stringify(summarizeState(state), null, 2));
    break;
  }
  case "annotate": {
    const state = await annotateStoredTemplates(config, options);
    const manifest = await writeManifest(config.manifestPath, state);
    console.log(JSON.stringify({ ...summarizeState(state), manifest: config.manifestPath, templates: manifest.templates.length }, null, 2));
    break;
  }
  case "run": {
    const state = await runPipeline(config, options);
    const manifest = await writeManifest(config.manifestPath, state);
    console.log(JSON.stringify({ ...summarizeState(state), manifest: config.manifestPath, templates: manifest.templates.length }, null, 2));
    break;
  }
  case "status": {
    const state = await loadState(config.statePath);
    console.log(JSON.stringify({ ...summarizeState(state), state: config.statePath, manifest: config.manifestPath }, null, 2));
    break;
  }
  default:
    throw new Error(`Unknown command ${JSON.stringify(command)}. Use scrape, annotate, run, or status.`);
}

function parseArgs(values: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else { parsed[key] = next; index += 1; }
  }
  return parsed;
}

function numberArg(args: Record<string, string | boolean>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`--${key} must be an integer.`);
  return Number(value);
}

function stringArg(args: Record<string, string | boolean>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`--${key} requires a value.`);
  return value;
}
