export interface MemeReplySource {
  tweetText: string | null;
  tweetId: string | null;
}

interface PendingMemeReply extends MemeReplySource {
  expiresAt: number;
}

export const MEME_REPLY_INTENT_TTL_MS = 10_000;

/**
 * Keeps MemeDrop inference opt-in while X transitions asynchronously into its
 * native reply composer. Source post data lives in memory only and expires if
 * the composer never opens.
 */
export class MemeReplyIntent {
  private pending: PendingMemeReply | null = null;

  arm(source: MemeReplySource, now = Date.now()): void {
    this.pending = {
      ...source,
      expiresAt: now + MEME_REPLY_INTENT_TTL_MS,
    };
  }

  consume(now = Date.now()): MemeReplySource | null {
    const pending = this.pending;
    this.pending = null;
    if (!pending || pending.expiresAt < now) return null;
    return {
      tweetText: pending.tweetText,
      tweetId: pending.tweetId,
    };
  }

  clear(): void {
    this.pending = null;
  }
}

export function tweetIdFromStatusHref(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, "https://x.com");
    return url.pathname.match(/\/[^/]+\/status\/(\d+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}
