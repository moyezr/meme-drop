import type { MetadataRoute } from "next";

const siteUrl = "https://memedrop.moyezrabani.dev";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl,
      lastModified: "2026-06-22",
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
