import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { config } from "../config.js";

const STORAGE_PATH = config.memeStoragePath;

// Ensure storage directory exists
fs.mkdirSync(STORAGE_PATH, { recursive: true });

function getExtension(contentType: string, url: string): string {
  const mimeMap: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };

  if (mimeMap[contentType]) return mimeMap[contentType];

  // Try to extract from URL path
  const urlPath = new URL(url).pathname;
  const ext = path.extname(urlPath);
  if (ext && [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext.toLowerCase())) {
    return ext.toLowerCase();
  }

  return ".jpg"; // default
}

export async function downloadImage(imageUrl: string): Promise<{ filePath: string; fileName: string }> {
  const url = parseSafeImageUrl(imageUrl);
  await assertHostnameResolvesPublicly(url.hostname);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(config.imageDownloadTimeoutMs),
    redirect: "error",
  });

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`Refusing to save non-image response: ${contentType}`);
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > config.maxImageBytes) {
    throw new Error(`Image is too large: ${contentLength} bytes`);
  }

  const ext = getExtension(contentType, url.toString());
  const fileName = `${randomUUID()}${ext}`;
  const filePath = path.join(STORAGE_PATH, fileName);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > config.maxImageBytes) {
    throw new Error(`Image is too large: ${buffer.length} bytes`);
  }

  fs.writeFileSync(filePath, buffer);

  console.log(`[MemeDrop] Image saved: ${filePath} (${buffer.length} bytes)`);

  return { filePath, fileName };
}

export function storedImagePathForPublicPath(publicPath: string): string | null {
  if (!publicPath.startsWith("/memes/")) return null;
  const fileName = path.basename(publicPath);
  if (!fileName || fileName !== publicPath.slice("/memes/".length)) return null;
  return path.join(STORAGE_PATH, fileName);
}

export async function deleteStoredImage(publicPath: string): Promise<boolean> {
  const filePath = storedImagePathForPublicPath(publicPath);
  if (!filePath) return false;

  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

function parseSafeImageUrl(imageUrl: string): URL {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new Error("image_url must be an absolute URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http(s) image URLs are allowed");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error("Refusing to fetch local or private image URL");
  }

  return url;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (["localhost", "0.0.0.0", "::1"].includes(normalized)) return true;
  if (isPrivateOrReservedIp(normalized)) return true;
  return false;
}

async function assertHostnameResolvesPublicly(hostname: string): Promise<void> {
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error("Refusing to fetch local or private image URL");
    }
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error("image_url hostname did not resolve");
  }

  const blocked = addresses.find((entry) => isPrivateOrReservedIp(entry.address));
  if (blocked) {
    throw new Error(`Refusing to fetch image URL that resolves to private IP ${blocked.address}`);
  }
}

export function isPrivateOrReservedIp(address: string): boolean {
  if (net.isIPv4(address)) return isPrivateOrReservedIpv4(address);
  if (net.isIPv6(address)) return isPrivateOrReservedIpv6(address);
  return false;
}

function isPrivateOrReservedIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;

  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;

  return false;
}

function isPrivateOrReservedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) {
    return isPrivateOrReservedIp(normalized.slice("::ffff:".length));
  }

  const first = Number.parseInt(normalized.split(":")[0] || "0", 16);
  if (!Number.isFinite(first)) return true;

  if ((first & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((first & 0xff00) === 0xff00) return true; // multicast ff00::/8
  if (normalized.startsWith("2001:db8:") || normalized === "2001:db8::") return true;

  return false;
}
