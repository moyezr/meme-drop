import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3001",
  "https://x.com",
  "https://twitter.com",
];
const DEFAULT_MEME_STORAGE_PATH = fileURLToPath(new URL("../data/memes", import.meta.url));

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  rateLimitStore: "memory" | "database";
  apiRateLimitWindowMs: number;
  apiRateLimitMax: number;
  expensiveRateLimitWindowMs: number;
  expensiveRateLimitMax: number;
  imageDownloadTimeoutMs: number;
  maxImageBytes: number;
  memeStoragePath: string;
  requireInstallId: boolean;
}

export const config: AppConfig = loadConfig();

function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const databaseUrl = requireEnv("DATABASE_URL");
  const corsOrigins = parseCsv(process.env.MEMEDROP_CORS_ORIGINS);

  if (isProduction) {
    requireEnv("OPENROUTER_API_KEY");
    if (corsOrigins.length === 0) {
      throw new Error(
        "MEMEDROP_CORS_ORIGINS is required in production. Include the Chrome extension origin and any web admin origins."
      );
    }
  }

  return {
    nodeEnv,
    isProduction,
    port: readInt("PORT", 3001),
    databaseUrl,
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : DEFAULT_ALLOWED_ORIGINS,
    rateLimitStore: readEnum("MEMEDROP_RATE_LIMIT_STORE", isProduction ? "database" : "memory", [
      "memory",
      "database",
    ]),
    apiRateLimitWindowMs: readInt("MEMEDROP_RATE_LIMIT_WINDOW_MS", 60_000),
    apiRateLimitMax: readInt("MEMEDROP_RATE_LIMIT_MAX", isProduction ? 120 : 600),
    expensiveRateLimitWindowMs: readInt("MEMEDROP_EXPENSIVE_RATE_LIMIT_WINDOW_MS", 60_000),
    expensiveRateLimitMax: readInt("MEMEDROP_EXPENSIVE_RATE_LIMIT_MAX", isProduction ? 30 : 180),
    imageDownloadTimeoutMs: readInt("MEMEDROP_IMAGE_DOWNLOAD_TIMEOUT_MS", 10_000),
    maxImageBytes: readInt("MEMEDROP_MAX_IMAGE_BYTES", 8 * 1024 * 1024),
    memeStoragePath: readPath("MEME_STORAGE_PATH", DEFAULT_MEME_STORAGE_PATH),
    requireInstallId: readBoolean("MEMEDROP_REQUIRE_INSTALL_ID", isProduction),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return Math.floor(value);
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(raw.toLowerCase())) return false;
  throw new Error(`${name} must be a boolean`);
}

function readEnum<T extends string>(name: string, fallback: T, allowed: T[]): T {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (allowed.includes(raw as T)) return raw as T;
  throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
}

function readPath(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  return path.resolve(raw);
}

function parseCsv(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
