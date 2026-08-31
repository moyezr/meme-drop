import type { MetadataRoute } from "next";

const siteUrl = "https://memedrop.moyezrabbani.dev";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl,
      lastModified: "2026-08-31",
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteUrl}/docs/`,
      lastModified: "2026-08-24",
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/privacy-policy/`,
      lastModified: "2026-08-31",
      changeFrequency: "monthly",
      priority: 0.4,
    },
    { url: `${siteUrl}/terms/`, lastModified: "2026-08-31", changeFrequency: "monthly", priority: 0.4 },
    { url: `${siteUrl}/refund-policy/`, lastModified: "2026-08-31", changeFrequency: "monthly", priority: 0.4 },
  ];
}
