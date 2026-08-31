import * as cheerio from "cheerio";

import type { ScrapedTemplate } from "./types.js";

const IMGFLIP_BASE_URL = "https://imgflip.com";
const IMGFLIP_LIST_URL = `${IMGFLIP_BASE_URL}/memetemplates?sort=top-all-time`;

export interface ScrapeOptions {
  limit: number;
  delayMs: number;
  fetchImpl?: typeof fetch;
  onPage?: (page: number, found: number) => void;
}

export async function scrapeImgflipTemplates(options: ScrapeOptions): Promise<ScrapedTemplate[]> {
  const request = options.fetchImpl || fetch;
  const templates: ScrapedTemplate[] = [];
  const seen = new Set<string>();
  let page = 1;
  while (templates.length < options.limit) {
    const response = await request(`${IMGFLIP_LIST_URL}&page=${page}`, {
      headers: { "User-Agent": "MemeDropCatalogResearch/0.1 (+development-only)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Imgflip template page ${page} returned ${response.status}`);
    const pageTemplates = parseImgflipTemplatePage(await response.text(), templates.length);
    if (!pageTemplates.length) break;
    for (const template of pageTemplates) {
      const identity = `${template.provider}:${template.source_id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      templates.push({ ...template, rank: templates.length + 1 });
      if (templates.length >= options.limit) break;
    }
    options.onPage?.(page, templates.length);
    page += 1;
    if (templates.length < options.limit && options.delayMs) await delay(options.delayMs);
  }
  return templates;
}

export function parseImgflipTemplatePage(html: string, rankOffset = 0): ScrapedTemplate[] {
  const $ = cheerio.load(html);
  return $(".mt-box")
    .toArray()
    .flatMap((element, index) => {
      const name = $(element).find(".mt-title a").first().text().trim();
      const href = $(element).find(".mt-title a").first().attr("href");
      const rawImage = $(element).find(".mt-img-wrap img").first().attr("src");
      if (!name || !href || !rawImage) return [];
      const thumbnailUrl = new URL(rawImage, IMGFLIP_BASE_URL);
      if (thumbnailUrl.hostname !== "i.imgflip.com") return [];
      const originalPath = thumbnailUrl.pathname.replace(/^\/4\//, "/");
      const sourceUrl = new URL(originalPath, "https://i.imgflip.com").toString();
      const sourceId = originalPath.split("/").pop()?.replace(/\.[a-z0-9]+$/i, "");
      if (!sourceId) return [];
      return [
        {
          provider: "imgflip" as const,
          source_id: sourceId,
          name,
          source_url: sourceUrl,
          thumbnail_url: thumbnailUrl.toString(),
          page_url: new URL(href, IMGFLIP_BASE_URL).toString(),
          rank: rankOffset + index + 1,
        },
      ];
    });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
