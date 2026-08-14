import type { MemeReplySource } from "../shared/meme-reply-intent";
import { tweetIdFromStatusHref } from "../shared/meme-reply-intent";

export type SupportedPlatform = "x" | "linkedin";

export interface PlatformAdapter {
  id: SupportedPlatform;
  displayName: string;
  supportsTimelineSave: boolean;
  selectors: {
    post: string;
    nativeReply: string;
    composer: string;
    composeScope: string;
    fileInput: string;
    fileInputActivator?: string;
  };
  isRouteCompose(url: string): boolean;
  findPosts(root?: ParentNode): HTMLElement[];
  findActionGroup(nativeReply: HTMLElement): HTMLElement | null;
  extractReplySource(post: HTMLElement, nativeReply: HTMLElement): MemeReplySource;
}

const X_POST_TEXT = 'div[data-testid="tweetText"]';
const X_TWEET = 'article[data-testid="tweet"]';
const X_NATIVE_REPLY = '[data-testid="reply"]';
const X_TWEET_ACTIONS = 'div[role="group"]';
const X_COMPOSER = 'div[data-testid^="tweetTextarea_"]';
const X_COMPOSE_DIALOG = 'div[role="dialog"]';
const X_FILE_INPUT = 'input[data-testid="fileInput"]';

const LINKEDIN_POST = '[role="listitem"]';
const LINKEDIN_NATIVE_REPLY = 'button[aria-label="Comment"]';
const LINKEDIN_COMPOSER =
  '[contenteditable="true"][role="textbox"][aria-label="Text editor for creating comment"]';
const LINKEDIN_FILE_INPUT = 'input[type="file"][accept*="image"]';
const LINKEDIN_SHARE_PHOTO = 'button[aria-label="Share photo"]';

export const X_ADAPTER: PlatformAdapter = {
  id: "x",
  displayName: "X",
  supportsTimelineSave: true,
  selectors: {
    post: X_TWEET,
    nativeReply: X_NATIVE_REPLY,
    composer: X_COMPOSER,
    composeScope: X_COMPOSE_DIALOG,
    fileInput: X_FILE_INPUT,
  },
  isRouteCompose: (url) => /(x|twitter)\.com\/compose\/post/.test(url),
  findPosts(root = document) {
    return Array.from(root.querySelectorAll<HTMLElement>(X_TWEET));
  },
  findActionGroup(nativeReply) {
    return nativeReply.closest<HTMLElement>(X_TWEET_ACTIONS);
  },
  extractReplySource(post) {
    const tweetText = post.querySelector(X_POST_TEXT)?.textContent?.trim() || null;
    const statusHref = Array.from(post.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'))
      .map((link) => link.href)
      .find((href) => tweetIdFromStatusHref(href));
    return {
      tweetText,
      tweetId: tweetIdFromStatusHref(statusHref),
    };
  },
};

export const LINKEDIN_ADAPTER: PlatformAdapter = {
  id: "linkedin",
  displayName: "LinkedIn",
  supportsTimelineSave: false,
  selectors: {
    post: LINKEDIN_POST,
    nativeReply: LINKEDIN_NATIVE_REPLY,
    composer: LINKEDIN_COMPOSER,
    composeScope: LINKEDIN_POST,
    fileInput: LINKEDIN_FILE_INPUT,
    fileInputActivator: LINKEDIN_SHARE_PHOTO,
  },
  isRouteCompose: () => false,
  findPosts(root = document) {
    return Array.from(root.querySelectorAll<HTMLElement>(LINKEDIN_POST)).filter((post) =>
      Boolean(post.querySelector(LINKEDIN_NATIVE_REPLY))
    );
  },
  findActionGroup(nativeReply) {
    const actionGroup = nativeReply.parentElement;
    return actionGroup instanceof HTMLElement ? actionGroup : null;
  },
  extractReplySource(post, nativeReply) {
    const candidates = Array.from(post.querySelectorAll<HTMLElement>("p"))
      .filter((paragraph) => {
        if (paragraph.closest("button") || paragraph.closest("a")) return false;
        // LinkedIn renders loaded comments after the native Comment action.
        // Limit extraction to content before the action bar so an existing
        // comment can never replace the source post as recommendation input.
        return Boolean(paragraph.compareDocumentPosition(nativeReply) & 4);
      })
      .map((paragraph) => paragraph.innerText || paragraph.textContent || "");
    const tweetText = selectLinkedInPostText(candidates);
    const postHref = Array.from(post.querySelectorAll<HTMLAnchorElement>('a[href*="/feed/update/"]'))
      .map((link) => link.href)
      .find((href) => linkedinPostIdFromHref(href));
    return {
      tweetText,
      tweetId: linkedinPostIdFromHref(postHref),
    };
  },
};

export function getPlatformAdapter(hostname = window.location.hostname): PlatformAdapter | null {
  const normalized = hostname.toLowerCase();
  if (normalized === "x.com" || normalized.endsWith(".x.com")) return X_ADAPTER;
  if (normalized === "twitter.com" || normalized.endsWith(".twitter.com")) return X_ADAPTER;
  if (normalized === "linkedin.com" || normalized.endsWith(".linkedin.com")) {
    return LINKEDIN_ADAPTER;
  }
  return null;
}

export function selectLinkedInPostText(candidates: string[]): string | null {
  const normalized = candidates
    .map((text) =>
      text.replace(/\s+/g, " ").trim().replace(/\s*…\s*more$/i, "").trim()
    )
    .filter(Boolean);
  if (normalized.length === 0) return null;
  // Profile metadata is usually short. The post body is the most substantial
  // pre-action paragraph, including when LinkedIn nests mentions inside it.
  return normalized.reduce((best, candidate) =>
    candidate.length > best.length ? candidate : best
  );
}

export function linkedinPostIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const decoded = decodeURIComponent(href);
    return decoded.match(/urn:li:(?:activity|ugcPost):(\d+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function isInlineComposeSessionActive(input: {
  hasSource: boolean;
  elapsedMs: number;
  composerPresent: boolean;
  mountGraceMs?: number;
}): boolean {
  if (!input.hasSource) return false;
  return input.composerPresent || input.elapsedMs < (input.mountGraceMs ?? 3_500);
}
