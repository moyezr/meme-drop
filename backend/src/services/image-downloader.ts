import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_PATH =
  process.env.MEME_STORAGE_PATH ||
  path.join(__dirname, "..", "..", "data", "memes");

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
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const ext = getExtension(contentType, imageUrl);
  const fileName = `${randomUUID()}${ext}`;
  const filePath = path.join(STORAGE_PATH, fileName);

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  console.log(`[MemeDrop] Image saved: ${filePath} (${buffer.length} bytes)`);

  return { filePath, fileName };
}
