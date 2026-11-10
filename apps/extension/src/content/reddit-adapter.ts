import type { PlatformAdapter } from "./platform-adapter";
import type { MemeReplySource } from "../shared/meme-reply-intent";
import { REPLY_CONTEXT_LIMITS } from "../shared/reply-context";
import { boundedOwnText, composedClosest, isVisibleElement, ownedElements, REPLY_TARGET_SELECTOR } from "./composer-dom";

const COMPOSE_SCOPE = "shreddit-composer, comment-composer-host";
const COMPOSER = '[contenteditable="true"][role="textbox"]';
const IMAGE_CONTROL = 'button[aria-label="Add an image"], button[aria-label="Add image"], button[aria-label="Image"]';
const ATTACHMENT = '[data-testid="media-preview"] img, [slot="media-preview"] img, img[data-media-id]';
const REMOVE_IMAGE = 'button[aria-label="Remove image"], button[aria-label="Remove media"]';
const NATIVE_REPLY = [
  'button[aria-label="Reply"]', 'button[slot="comment-reply"]',
  '[slot="comment-reply"] button', 'button[aria-label="Add a comment"]',
  'button[name="comments-action-button"]', 'textarea[placeholder="Join the conversation"]',
].join(", ");
const IMAGE_INPUT = 'input[type="file"][accept*="image"]';

export function redditPostId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "www.reddit.com" || parsed.protocol !== "https:") return null;
    const id = parsed.pathname.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i)?.[1];
    return id ? `t3_${id.toLowerCase()}` : null;
  } catch { return null; }
}

function targetId(target: Element): string | null {
  const value = target.matches("shreddit-comment") ? target.getAttribute("thingid") : target.id;
  return value && /^(t1|t3)_[a-z0-9]+$/.test(value) ? value : null;
}

function rootPost(target: Element): HTMLElement | null {
  const id = redditPostId(window.location.href);
  if (!id || (target.matches("shreddit-comment") && target.getAttribute("postid") !== id)) return null;
  const root = document.getElementById(id);
  if (target.matches("shreddit-post") && root !== target) return null;
  if (root && ["nsfw", "is-nsfw", "quarantined", "locked", "archived"].some((attribute) =>
    root.hasAttribute(attribute) && root.getAttribute(attribute) !== "false")) return null;
  return root?.matches("shreddit-post") ? root : null;
}

function oneOwned(target: Element, selector: string): Element | null {
  const matches = ownedElements(target, selector);
  // Native text posts project an inner text-body slot through an outer slot host.
  // They represent one field; distinct sibling fields must still fail closed.
  const elements = matches.filter((element) => !matches.some((ancestor) =>
    ancestor !== element && ancestor.contains(element)));
  return elements.length === 1 ? elements[0] : null;
}

export function extractRedditReplySource(target: HTMLElement): MemeReplySource {
  const unavailable = { tweetText: null, tweetId: null };
  const post = rootPost(target);
  const id = targetId(target);
  if (!post || !id) return unavailable;
  const rawTitle = post.getAttribute("post-title");
  const titleNode = rawTitle ? null : oneOwned(post, '[slot="title"], h1');
  const title = rawTitle
    ? { text: rawTitle.slice(0, REPLY_CONTEXT_LIMITS.title).trim(), truncated: rawTitle.length > REPLY_CONTEXT_LIMITS.title }
    : titleNode ? boundedOwnText(titleNode, REPLY_CONTEXT_LIMITS.title) : null;
  if (!title?.text) return unavailable;
  const bodyNode = oneOwned(post, '[slot="text-body"]');
  if (post.getAttribute("post-type") === "text" && !bodyNode) return unavailable;
  const body = bodyNode ? boundedOwnText(bodyNode, REPLY_CONTEXT_LIMITS.body) : { text: "", truncated: false };
  const comment = target.matches("shreddit-comment") ? oneOwned(target, '[slot="comment"]') : null;
  const selected = comment ? boundedOwnText(comment, REPLY_CONTEXT_LIMITS.comment) : null;
  if (target.matches("shreddit-comment") && (!selected?.text || /^\[(deleted|removed)\]$/i.test(selected.text))) {
    return unavailable;
  }
  return {
    tweetText: selected?.text || `${title.text}\n${body.text}`.trim(),
    tweetId: `reddit:${post.id}:${id}`,
    replyContext: {
      platform: "reddit", target_kind: selected ? "comment" : "post",
      post_title: title.text, post_body: body.text,
      truncated: Boolean(title.truncated || body.truncated || selected?.truncated),
    },
  };
}

export function redditComposerCandidates(target: HTMLElement): HTMLElement[] {
  const id = targetId(target);
  if (!id || !rootPost(target)) return [];
  const candidates = new Set(ownedElements(target, COMPOSE_SCOPE));
  // A portaled composer is eligible only with an explicit target identifier.
  document.querySelectorAll(`${COMPOSE_SCOPE.split(", ").map((tag) => `${tag}[parent-id="${id}"]`).join(", ")}`)
    .forEach((scope) => candidates.add(scope));
  if (id.startsWith("t3_")) {
    document.querySelectorAll(`comment-composer-host[post-id="${id}"]:not([parent-id])`)
      .forEach((scope) => candidates.add(scope));
  }
  return [...candidates].filter((scope): scope is HTMLElement => {
    // The outer native host owns the form, editor and nested image toolbar.
    if (scope.matches("shreddit-composer") && composedClosest(scope, "comment-composer-host")) return false;
    const parentId = composerTargetId(scope);
    if (parentId ? parentId !== id : composedClosest(scope, REPLY_TARGET_SELECTOR) !== target) return false;
    const editors = ownedElements(scope, COMPOSER)
      .filter((editor) => composerScope(editor) === scope && isVisibleElement(editor));
    return scope instanceof HTMLElement && scope.isConnected && editors.length === 1 &&
      editors[0].getAttribute("aria-disabled") !== "true" && !editors[0].hasAttribute("disabled");
  });
}

function composerScope(element: Element): Element | null {
  return composedClosest(element, "comment-composer-host") || composedClosest(element, COMPOSE_SCOPE);
}

function composerTargetId(scope: Element): string | null {
  return scope.getAttribute("parent-id") || scope.getAttribute("post-id");
}

function queryRedditComposer(scope: Element, selector: string): Element[] {
  const matches = ownedElements(scope, selector);
  if (selector !== IMAGE_CONTROL) return matches;
  // Reddit labels the image button through its native custom element, rather
  // than an aria-label on the inner button. Do not match arbitrary button text.
  const nativeButtons = ownedElements(scope, "rte-toolbar-button-image")
    .flatMap((host) => ownedElements(host, "button").filter(isVisibleElement));
  return [...new Set([...matches, ...nativeButtons])];
}

export function hasRedditRemovableAttachment(scope: Element): boolean {
  if (ownedElements(scope, REMOVE_IMAGE).some(isVisibleElement)) return true;
  // Current Reddit uses a native Lexical image object removed by selecting it
  // and pressing Backspace. Its media identity must agree with the decoded img.
  return ownedElements(scope, "rte-image[media-id][key]").some((host) => {
    const editor = composedClosest(host, COMPOSER);
    const mediaId = host.getAttribute("media-id");
    return Boolean(editor && composerScope(editor) === scope && host.getAttribute("key") && mediaId &&
      ownedElements(host, "img[data-media-id]").some((element) => {
        const image = element as HTMLImageElement;
        return image.getAttribute("data-media-id") === mediaId && image.complete && image.naturalWidth > 0;
      }));
  });
}

export function redditCanAttach(scope: Element): boolean {
  const controls = queryRedditComposer(scope, IMAGE_CONTROL).filter(isVisibleElement);
  return controls.length === 1 && controls[0] instanceof HTMLButtonElement && !controls[0].disabled &&
    controls[0].getAttribute("aria-disabled") !== "true" &&
    !composedClosest(scope,
      '[locked]:not([locked="false"]), [archived]:not([archived="false"]), [aria-disabled="true"]');
}

export const REDDIT_ADAPTER: PlatformAdapter = {
  id: "reddit", displayName: "Reddit", supportsTimelineSave: false,
  selectors: {
    post: REPLY_TARGET_SELECTOR, nativeReply: NATIVE_REPLY, composer: COMPOSER,
    composeScope: COMPOSE_SCOPE, fileInput: IMAGE_INPUT,
    fileInputActivator: IMAGE_CONTROL,
    attachmentImage: ATTACHMENT,
    attachmentBusy: '[role="progressbar"], [aria-busy="true"]',
  },
  isRouteCompose: () => false,
  findPosts(root = document) {
    if (!redditPostId(window.location.href)) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(REPLY_TARGET_SELECTOR));
  },
  findNativeReply(target) {
    const replies = ownedElements(target, NATIVE_REPLY).filter(isVisibleElement);
    return replies.length === 1 ? replies[0] : null;
  },
  findActionGroup(nativeReply) {
    const root = nativeReply.getRootNode();
    return nativeReply.parentElement || (root instanceof ShadowRoot ? root : null);
  },
  openNativeReply(target, nativeReply) {
    if (target.matches("shreddit-post") && rootPost(target) === target) {
      const main = target.closest("main");
      const headers = main ? Array.from(main.querySelectorAll("comment-body-header")) : [];
      const openers = headers.length === 1
        ? ownedElements(headers[0], 'textarea[placeholder="Join the conversation"]').filter(isVisibleElement) : [];
      if (openers.length === 1) {
        const opener = openers[0] as HTMLElement;
        // The collapsed native textarea opens its rich-text composer on focus.
        // HTMLElement.click() alone does not focus a textarea.
        opener.focus({ preventScroll: true });
        opener.click();
        return;
      }
    }
    nativeReply.click();
  },
  extractReplySource: extractRedditReplySource,
  inlineComposer: {
    candidates: redditComposerCandidates,
    canSuggest(scope) {
      const inputs = ownedElements(scope, IMAGE_INPUT) as HTMLInputElement[];
      const allInputs = ownedElements(scope, 'input[type="file"]') as HTMLInputElement[];
      return redditCanAttach(scope) && inputs.length <= 1 &&
        !inputs.some((input) => input.disabled) && !allInputs.some((input) => input.files?.length) &&
        ownedElements(scope, ATTACHMENT).length === 0 &&
        ownedElements(scope, '[role="progressbar"], [aria-busy="true"]').length === 0;
    },
    isSourceCurrent: (target, source) => {
      if (!target.isConnected) return false;
      const current = extractRedditReplySource(target);
      return Boolean(current.tweetText && current.tweetId === source.tweetId &&
        current.tweetText === source.tweetText &&
        JSON.stringify(current.replyContext) === JSON.stringify(source.replyContext));
    },
  },
  queryComposerElements: queryRedditComposer,
  resolveComposerScope(target) {
    if (!target?.isConnected) return null;
    const scope = composerScope(target);
    if (!(scope instanceof HTMLElement) || !scope.isConnected) return null;
    const id = composerTargetId(scope) || targetId(composedClosest(scope, REPLY_TARGET_SELECTOR) || scope);
    if (!id || !/^(t1|t3)_[a-z0-9]+$/.test(id) || !redditPostId(window.location.href)) return null;
    const owner = id.startsWith("t3_") ? document.getElementById(id)
      : document.querySelector<HTMLElement>(`shreddit-comment[thingid="${id}"]`);
    return owner && redditComposerCandidates(owner).includes(scope) ? scope : null;
  },
  canAttachImage: redditCanAttach,
  attachmentMaxDimension: 240,
  hasRemovableAttachment: hasRedditRemovableAttachment,
};
