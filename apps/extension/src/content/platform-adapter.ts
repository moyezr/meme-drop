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

const LINKEDIN_POST =
  '[data-urn^="urn:li:activity:"], [data-urn^="urn:li:ugcPost:"], [role="listitem"]';
const LINKEDIN_NATIVE_REPLY = 'button[aria-label="Comment"]';
const LINKEDIN_POST_TEXT = '[data-testid="expandable-text-box"]';
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
    const explicitPostText = Array.from(
      post.querySelectorAll<HTMLElement>(LINKEDIN_POST_TEXT)
    ).find((element) => isBefore(element, nativeReply));
    const fallbackCandidates = Array.from(post.querySelectorAll<HTMLElement>("p"))
      .filter((paragraph) => {
        if (paragraph.closest("button") || paragraph.closest("a")) return false;
        // LinkedIn renders loaded comments after the native Comment action.
        // Limit extraction to content before the action bar so an existing
        // comment can never replace the source post as recommendation input.
        return isBefore(paragraph, nativeReply);
      })
      .map((paragraph) => paragraph.innerText || paragraph.textContent || "");
    const explicitText =
      explicitPostText?.innerText || explicitPostText?.textContent || "";
    const tweetText = selectLinkedInPostText(
      explicitText ? [explicitText] : fallbackCandidates
    );
    const postHref = Array.from(post.querySelectorAll<HTMLAnchorElement>('a[href*="/feed/update/"]'))
      .map((link) => link.href)
      .find((href) => linkedinPostIdFromHref(href));
    const postId =
      linkedinPostIdFromUrn(post.getAttribute("data-urn")) ||
      linkedinPostIdFromHref(postHref) ||
      linkedinPostIdFromComponentKey(
        post
          .querySelector<HTMLElement>(
            ':scope > [data-display-contents="true"] > [componentkey]'
          )
          ?.getAttribute("componentkey") || post.getAttribute("componentkey")
      );
    return {
      tweetText,
      // Keep LinkedIn's namespace in the shared cache identity so an activity
      // cannot collide with an X status that happens to use the same digits.
      tweetId: linkedinPostCacheId(postId),
    };
  },
};

function isBefore(element: Element, reference: Element): boolean {
  return Boolean(
    element.compareDocumentPosition(reference) & Node.DOCUMENT_POSITION_FOLLOWING
  );
}

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

export function linkedinPostIdFromUrn(urn: string | null | undefined): string | null {
  return urn?.match(/^urn:li:(?:activity|ugcPost):(\d+)$/)?.[1] ?? null;
}

export function linkedinPostIdFromComponentKey(
  componentKey: string | null | undefined
): string | null {
  if (!componentKey) return null;

  // LinkedIn's current feed uses a stable 32-byte base64url post key. The
  // list item wraps it as `expanded<key>FeedType_...`; its content child
  // exposes the key directly. Both forms remain stable across page reloads.
  const wrapped = componentKey.match(
    /^expanded([A-Za-z0-9_-]{43})FeedType_[A-Z0-9_]+$/
  )?.[1];
  if (wrapped) return wrapped;
  return /^[A-Za-z0-9_-]{43}$/.test(componentKey) ? componentKey : null;
}

export function linkedinPostCacheId(postId: string | null): string | null {
  return postId ? `linkedin:${postId}` : null;
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
