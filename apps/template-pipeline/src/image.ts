import { createHash } from "node:crypto";

import * as cheerio from "cheerio";

import type { ScrapedTemplate, StoredAsset } from "./types.js";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export interface DownloadedImage {
  bytes: Uint8Array;
  content_sha256: string;
  mime_type: StoredAsset["mime_type"];
  extension: "jpg" | "png" | "webp";
  width: number;
  height: number;
  resolved_url: string;
}

export async function downloadTemplateImage(
  template: ScrapedTemplate,
  fetchImpl: typeof fetch = fetch,
): Promise<DownloadedImage> {
  let resolvedUrl = template.source_url;
  let response = await fetchImpl(resolvedUrl, {
    headers: { "User-Agent": "MemeDropCatalogResearch/0.1 (+development-only)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    resolvedUrl = await resolveBlankImageUrl(template, fetchImpl);
    response = await fetchImpl(resolvedUrl, {
      headers: { "User-Agent": "MemeDropCatalogResearch/0.1 (+development-only)" },
      signal: AbortSignal.timeout(30_000),
    });
  }
  if (!response.ok) throw new Error(`Image download returned ${response.status}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_IMAGE_BYTES) throw new Error(`Image exceeds ${MAX_IMAGE_BYTES} bytes`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image size ${bytes.length} is outside the allowed range`);
  }
  const detected = detectImage(bytes);
  return {
    bytes,
    ...detected,
    resolved_url: resolvedUrl,
    content_sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function detectImage(
  bytes: Uint8Array,
): Omit<DownloadedImage, "bytes" | "content_sha256" | "resolved_url"> {
  if (isPng(bytes)) {
    return {
      mime_type: "image/png",
      extension: "png",
      width: readUInt32BE(bytes, 16),
      height: readUInt32BE(bytes, 20),
    };
  }
  if (isWebp(bytes)) {
    const dimensions = webpDimensions(bytes);
    return { mime_type: "image/webp", extension: "webp", ...dimensions };
  }
  if (isJpeg(bytes)) {
    return { mime_type: "image/jpeg", extension: "jpg", ...jpegDimensions(bytes) };
  }
  throw new Error("Downloaded content is not a supported JPEG, PNG, or WebP image");
}

async function resolveBlankImageUrl(
  template: ScrapedTemplate,
  fetchImpl: typeof fetch,
): Promise<string> {
  const pageUrl = template.page_url.replace("/meme/", "/memetemplate/");
  const page = await fetchImpl(pageUrl, {
    headers: { "User-Agent": "MemeDropCatalogResearch/0.1 (+development-only)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!page.ok) {
    if (template.thumbnail_url) return template.thumbnail_url;
    throw new Error(`Blank template page returned ${page.status}`);
  }
  const $ = cheerio.load(await page.text());
  const source = $("#mtm-img").attr("src") || $("#mtm-video source").attr("src");
  if (source) return new URL(source, "https://imgflip.com").toString();
  if (template.thumbnail_url) return template.thumbnail_url;
  throw new Error("Blank template page did not expose an image");
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 24 && bytes.slice(0, 8).every((value, index) => value === [137,80,78,71,13,10,26,10][index]);
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 30 && text(bytes, 0, 4) === "RIFF" && text(bytes, 8, 12) === "WEBP";
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const segmentLength = readUInt16BE(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: readUInt16BE(bytes, offset + 3), width: readUInt16BE(bytes, offset + 5) };
    }
    offset += segmentLength;
  }
  throw new Error("JPEG dimensions could not be read");
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } {
  const kind = text(bytes, 12, 16);
  if (kind === "VP8X") {
    return { width: readUInt24LE(bytes, 24) + 1, height: readUInt24LE(bytes, 27) + 1 };
  }
  if (kind === "VP8 ") {
    return { width: readUInt16LE(bytes, 26) & 0x3fff, height: readUInt16LE(bytes, 28) & 0x3fff };
  }
  if (kind === "VP8L") {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  throw new Error(`Unsupported WebP chunk ${kind}`);
}

function readUInt16BE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 256 + bytes[offset + 1];
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 256;
}

function readUInt24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65_536;
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 16_777_216 + bytes[offset + 1] * 65_536 + bytes[offset + 2] * 256 + bytes[offset + 3];
}

function text(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}
