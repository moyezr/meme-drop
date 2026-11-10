import type { ReplyContext } from "@memedrop/shared";

export const REPLY_CONTEXT_LIMITS = { title: 300, body: 1_200, comment: 2_000 } as const;

/** Strict runtime boundary: neither extra fields nor unbounded page data cross into the worker. */
export function readReplyContext(value: unknown): ReplyContext | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("Invalid reply context");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => ![
    "platform", "target_kind", "post_title", "post_body", "truncated",
  ].includes(key)) || input.platform !== "reddit" ||
      !["post", "comment"].includes(String(input.target_kind)) ||
      typeof input.post_title !== "string" || !input.post_title.trim() ||
      input.post_title.length > REPLY_CONTEXT_LIMITS.title ||
      typeof input.post_body !== "string" || input.post_body.length > REPLY_CONTEXT_LIMITS.body ||
      typeof input.truncated !== "boolean") throw new Error("Invalid reply context");
  return {
    platform: "reddit", target_kind: input.target_kind as ReplyContext["target_kind"],
    post_title: input.post_title, post_body: input.post_body, truncated: input.truncated,
  };
}
