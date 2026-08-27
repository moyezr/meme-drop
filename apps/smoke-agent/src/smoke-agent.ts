import { isDeepStrictEqual } from "node:util";
import { randomBytes } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_JSON_BYTES = 1_000_000;
const MAX_IMAGE_BYTES = 15_000_000;
const MAX_EXPIRY_WINDOW_MS = 31 * 24 * 60 * 60 * 1_000;
const ASSET_ID = /^asset_[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{22}$/;

export interface SmokeAgentOptions {
  apiBaseUrl: string;
  apiKey: string;
  input: string;
  direction?: string;
  count?: 1 | 2 | 3 | 4 | 5;
  idempotencyKey?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}

export interface SmokeAgentMediaResult {
  id: string;
  content_type: string;
  bytes: number;
}

export interface SmokeAgentReport {
  status: "passed";
  target_origin: string;
  generation_status: "ok" | "no_fit";
  meme_count: number;
  asset_ids: string[];
  liveness_verified: true;
  readiness_verified: true;
  replay_verified: true;
  media: SmokeAgentMediaResult[];
  request_ids: {
    initial: string | null;
    replay: string | null;
  };
  timing_ms: {
    preflight: number;
    initial_generation: number;
    replay: number;
    media: number;
    total: number;
  };
}

export class SmokeAgentError extends Error {
  constructor(
    readonly step: string,
    readonly code: string,
    readonly httpStatus?: number,
  ) {
    super(`${step} failed: ${code}`);
    this.name = "SmokeAgentError";
  }
}

interface GeneratedMeme {
  id: string;
  image_url: string;
  expires_at: string;
}

interface GenerationResponse {
  status: "ok" | "no_fit";
  memes: GeneratedMeme[];
}

export async function runSmokeAgent(options: SmokeAgentOptions): Promise<SmokeAgentReport> {
  const started = performance.now();
  const baseUrl = validateOptions(options);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const idempotencyKey = options.idempotencyKey ?? createIdempotencyKey(now());
  const headers = {
    Authorization: `Bearer ${options.apiKey}`,
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
  };
  const body = generationBody(options);

  const preflightStarted = performance.now();
  await Promise.all([
    assertOperationalEndpoint(fetchImpl, new URL("/live", baseUrl), "liveness", timeoutMs),
    assertOperationalEndpoint(fetchImpl, new URL("/health", baseUrl), "readiness", timeoutMs),
  ]);
  const preflightMs = performance.now() - preflightStarted;

  const initialStarted = performance.now();
  const initialHttp = await fetchWithTimeout(
    fetchImpl,
    new URL("/api/v1/memes/generate", baseUrl),
    { method: "POST", headers, body },
    timeoutMs,
    "initial_generation",
  );
  const initial = await parseGenerationResponse(initialHttp, "initial_generation");
  validateGenerationResponse(initial, baseUrl, now(), options.count ?? 1);
  const initialMs = performance.now() - initialStarted;

  const replayStarted = performance.now();
  const replayHttp = await fetchWithTimeout(
    fetchImpl,
    new URL("/api/v1/memes/generate", baseUrl),
    { method: "POST", headers, body },
    timeoutMs,
    "replay",
  );
  const replay = await parseGenerationResponse(replayHttp, "replay");
  validateGenerationResponse(replay, baseUrl, now(), options.count ?? 1);
  if (!isDeepStrictEqual(replay, initial)) {
    throw new SmokeAgentError("replay", "response_mismatch");
  }
  const replayMs = performance.now() - replayStarted;

  const mediaStarted = performance.now();
  const media = await Promise.all(
    initial.memes.map((meme) => verifyMedia(fetchImpl, meme, baseUrl, options.apiKey, timeoutMs)),
  );
  const mediaMs = performance.now() - mediaStarted;

  return {
    status: "passed",
    target_origin: baseUrl.origin,
    generation_status: initial.status,
    meme_count: initial.memes.length,
    asset_ids: initial.memes.map((meme) => meme.id),
    liveness_verified: true,
    readiness_verified: true,
    replay_verified: true,
    media,
    request_ids: {
      initial: initialHttp.headers.get("x-request-id"),
      replay: replayHttp.headers.get("x-request-id"),
    },
    timing_ms: {
      preflight: roundMs(preflightMs),
      initial_generation: roundMs(initialMs),
      replay: roundMs(replayMs),
      media: roundMs(mediaMs),
      total: roundMs(performance.now() - started),
    },
  };
}

function validateOptions(options: SmokeAgentOptions): URL {
  let baseUrl: URL;
  try {
    baseUrl = new URL(options.apiBaseUrl);
  } catch {
    throw new SmokeAgentError("configuration", "invalid_api_base_url");
  }
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname);
  if (baseUrl.protocol !== "https:" && !(baseUrl.protocol === "http:" && isLoopback)) {
    throw new SmokeAgentError("configuration", "insecure_api_base_url");
  }
  if (
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.pathname !== "/" ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new SmokeAgentError("configuration", "api_base_url_must_be_origin");
  }
  if (!options.apiKey.trim() || /[\s\u0000-\u001f\u007f]/u.test(options.apiKey)) {
    throw new SmokeAgentError("configuration", "invalid_api_key");
  }
  const input = options.input.trim();
  if (input.length < 1 || input.length > 12_000) {
    throw new SmokeAgentError("configuration", "invalid_input");
  }
  if (options.direction !== undefined) {
    const direction = options.direction.trim();
    if (direction.length < 1 || direction.length > 280) {
      throw new SmokeAgentError("configuration", "invalid_direction");
    }
  }
  if (options.count !== undefined && ![1, 2, 3, 4, 5].includes(options.count)) {
    throw new SmokeAgentError("configuration", "invalid_count");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
    throw new SmokeAgentError("configuration", "invalid_timeout");
  }
  if (
    options.idempotencyKey !== undefined &&
    !/^[\x21-\x7e]{1,200}$/u.test(options.idempotencyKey)
  ) {
    throw new SmokeAgentError("configuration", "invalid_idempotency_key");
  }
  return baseUrl;
}

function generationBody(options: SmokeAgentOptions): string {
  const request: { input: string; options?: { direction?: string; count?: number } } = {
    input: options.input.trim(),
  };
  if (options.direction !== undefined || options.count !== undefined) {
    request.options = {};
    if (options.direction !== undefined) request.options.direction = options.direction.trim();
    if (options.count !== undefined) request.options.count = options.count;
  }
  return JSON.stringify(request);
}

async function assertOperationalEndpoint(
  fetchImpl: typeof globalThis.fetch,
  url: URL,
  step: "liveness" | "readiness",
  timeoutMs: number,
): Promise<void> {
  const response = await fetchWithTimeout(fetchImpl, url, { method: "GET" }, timeoutMs, step);
  const payload = await readJson(response, step);
  if (!response.ok || !isRecord(payload) || payload.status !== "ok") {
    throw new SmokeAgentError(step, response.ok ? "invalid_response" : "service_unavailable", response.status);
  }
}

async function parseGenerationResponse(
  response: Response,
  step: "initial_generation" | "replay",
): Promise<GenerationResponse> {
  const payload = await readJson(response, step);
  if (!response.ok) {
    throw new SmokeAgentError(step, errorCode(payload), response.status);
  }
  if (!isRecord(payload) || (payload.status !== "ok" && payload.status !== "no_fit")) {
    throw new SmokeAgentError(step, "invalid_response", response.status);
  }
  if (!Array.isArray(payload.memes)) {
    throw new SmokeAgentError(step, "invalid_response", response.status);
  }
  return payload as unknown as GenerationResponse;
}

function validateGenerationResponse(
  response: GenerationResponse,
  baseUrl: URL,
  now: Date,
  requestedCount: number,
): void {
  if (response.status === "no_fit") {
    if (response.memes.length !== 0) {
      throw new SmokeAgentError("response_validation", "invalid_no_fit_response");
    }
    return;
  }
  if (response.memes.length < 1 || response.memes.length > requestedCount) {
    throw new SmokeAgentError("response_validation", "invalid_meme_count");
  }
  const seenIds = new Set<string>();
  for (const meme of response.memes) {
    if (!isRecord(meme) || typeof meme.id !== "string" || !ASSET_ID.test(meme.id)) {
      throw new SmokeAgentError("response_validation", "invalid_asset_id");
    }
    if (seenIds.has(meme.id)) {
      throw new SmokeAgentError("response_validation", "duplicate_asset_id");
    }
    seenIds.add(meme.id);
    const imageUrl = trustedAssetUrl(meme, baseUrl);
    if (imageUrl.pathname !== `/api/v1/memes/assets/${meme.id}`) {
      throw new SmokeAgentError("response_validation", "invalid_asset_path");
    }
    const expiresAt = Date.parse(meme.expires_at);
    const remainingMs = expiresAt - now.getTime();
    if (!Number.isFinite(expiresAt) || remainingMs <= 0 || remainingMs > MAX_EXPIRY_WINDOW_MS) {
      throw new SmokeAgentError("response_validation", "invalid_asset_expiry");
    }
  }
}

async function verifyMedia(
  fetchImpl: typeof globalThis.fetch,
  meme: GeneratedMeme,
  baseUrl: URL,
  apiKey: string,
  timeoutMs: number,
): Promise<SmokeAgentMediaResult> {
  const imageUrl = trustedAssetUrl(meme, baseUrl);
  const response = await fetchWithTimeout(
    fetchImpl,
    imageUrl,
    { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } },
    timeoutMs,
    "media",
  );
  if (!response.ok) {
    const payload = await readJson(response, "media");
    throw new SmokeAgentError("media", errorCode(payload), response.status);
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
  if (!contentType.startsWith("image/")) {
    throw new SmokeAgentError("media", "invalid_content_type", response.status);
  }
  const bytes = await readBoundedBody(response, MAX_IMAGE_BYTES, "media");
  if (bytes.byteLength === 0) {
    throw new SmokeAgentError("media", "empty_asset", response.status);
  }
  return { id: meme.id, content_type: contentType, bytes: bytes.byteLength };
}

function trustedAssetUrl(meme: GeneratedMeme, baseUrl: URL): URL {
  if (typeof meme.image_url !== "string") {
    throw new SmokeAgentError("response_validation", "invalid_asset_url");
  }
  let imageUrl: URL;
  try {
    imageUrl = new URL(meme.image_url);
  } catch {
    throw new SmokeAgentError("response_validation", "invalid_asset_url");
  }
  if (imageUrl.origin !== baseUrl.origin || imageUrl.username || imageUrl.password) {
    throw new SmokeAgentError("response_validation", "untrusted_asset_url");
  }
  if (imageUrl.search || imageUrl.hash) {
    throw new SmokeAgentError("response_validation", "invalid_asset_url");
  }
  return imageUrl;
}

async function fetchWithTimeout(
  fetchImpl: typeof globalThis.fetch,
  url: URL,
  init: RequestInit,
  timeoutMs: number,
  step: string,
): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const code = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network_error";
    throw new SmokeAgentError(step, code);
  }
}

async function readJson(response: Response, step: string): Promise<unknown> {
  const bytes = await readBoundedBody(response, MAX_JSON_BYTES, step);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SmokeAgentError(step, "invalid_json", response.status);
  }
}

async function readBoundedBody(response: Response, maxBytes: number, step: string): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new SmokeAgentError(step, "response_too_large", response.status);
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new SmokeAgentError(step, "response_too_large", response.status);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function errorCode(payload: unknown): string {
  if (!isRecord(payload) || !isRecord(payload.error) || typeof payload.error.code !== "string") {
    return "http_error";
  }
  return /^[a-z][a-z0-9_]{0,63}$/u.test(payload.error.code) ? payload.error.code : "http_error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createIdempotencyKey(now: Date): string {
  return `smoke_${now.getTime().toString(36)}_${randomBytes(10).toString("hex")}`;
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}
