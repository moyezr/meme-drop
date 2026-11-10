export function platformForUrl(value?: string): "x" | "linkedin" | "reddit" | null {
  try {
    const url = new URL(value || "");
    if (url.protocol !== "https:") return null;
    if (["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname)) return "x";
    if (["linkedin.com", "www.linkedin.com"].includes(url.hostname)) return "linkedin";
    return url.hostname === "www.reddit.com" ? "reddit" : null;
  } catch { return null; }
}
