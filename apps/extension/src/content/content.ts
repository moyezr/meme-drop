// Caption generation currently targets Latin-language posts. Bundling the
// selected faces here keeps font CSS out of renderer unit-test imports.
import "@fontsource/anton/latin-400.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-900.css";

import { SELECTORS } from "./selectors";
import {
  getPlatformAdapter,
  isInlineComposeSessionActive,
} from "./platform-adapter";
import { initSaveButton } from "./save-button";
import { initMemeReplyButtons } from "./meme-reply-button";
import {
  showSuggestionPanel,
  showSuggestionError,
  updateSuggestions,
  updateSuggestionMedia,
  updateSuggestionPreview,
  insertMemeByUrl,
  hidePanel,
  isPanelVisible,
  setSuggestionComposerTarget,
  setSuggestionSteeringInstruction,
} from "./suggestion-panel";
import {
  buildSuggestionCacheKey,
  createSuggestionRequestId,
  hasSteeringInstructionChanged,
  isCurrentSuggestionGeneration,
  isCurrentSuggestionMessage,
  normalizeSteeringInstruction,
} from "../shared/suggestion-request";
import {
  MemeReplyIntent,
  type MemeReplySource,
} from "../shared/meme-reply-intent";

const MEME_DROP_MIME_TYPE = "application/x-memedrop-meme";
const DEBUG_PREFIX = "[MemeDrop]";
const platform = requirePlatformAdapter();

function requirePlatformAdapter() {
  const resolved = getPlatformAdapter();
  if (!resolved) {
    throw new Error("MemeDrop content script loaded on an unsupported platform");
  }
  return resolved;
}

type DraggedMeme = Pick<
  Parameters<typeof insertMemeByUrl>[0],
  | "imageUrl"
  | "imageDataUrl"
  | "tailoredImageDataUrl"
  | "tailoredOverlay"
  | "memeId"
  | "source"
>;

interface ReplyTweetSnapshot {
  text: string | null;
  viewportCount: number;
  visibleViewportCount: number;
  selectedViewportIndex: number;
  selectedStrategy: string;
  hasReplyContextContainer: boolean;
  hasLikelyTweetContainer: boolean;
  hasTweetRoot: boolean;
  tweetTextNodeCount: number;
}

const memeReplyIntent = new MemeReplyIntent();
const memeReplyButtons = initMemeReplyButtons(platform, (source, post) => {
  logDebug(
    "Meme reply armed",
    `- has tweet id: ${Boolean(source.tweetId)}
- extracted text length: ${source.tweetText?.length || 0}`
  );
  if (platform.id === "linkedin") {
    activateInlineMemeReply(source, post);
  } else {
    memeReplyIntent.arm(source);
  }
});

// A native X Reply click must never inherit an abandoned MemeDrop intent.
// Programmatic forwarding from our own button is synchronous and explicitly exempted.
document.addEventListener(
  "click",
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(platform.selectors.nativeReply)) return;
    if (!memeReplyButtons.isForwardingNativeReply()) {
      memeReplyIntent.clear();
      if (platform.id === "linkedin") resetComposeSession();
    }
  },
  true
);

if (platform.supportsTimelineSave) initSaveButton();

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SUGGESTIONS_RESULT") {
    if (!isCurrentSuggestionMessage(message, activeSuggestionRequestId)) {
      logDebug("Ignored stale suggestions result", "- reason: request generation changed");
      return;
    }
    if (!isComposeRoute()) {
      logDebug(
        "Ignored suggestions result",
        `- reason: current URL is not compose
- url: ${window.location.href}`
      );
      return;
    }
    if (currentComposeDismissed) {
      logDebug(
        "Ignored suggestions result",
        "- reason: panel was dismissed for this compose"
      );
      return;
    }
    if (message.cache_key && message.cache_key !== lastSuggestionCacheKey) {
      logDebug(
        "Ignored stale suggestions result",
        `- result cache key: ${message.cache_key}
- active cache key: ${lastSuggestionCacheKey || "(none)"}`
      );
      return;
    }
    if (message.cache_key && message.cache_key === dismissedSuggestionCacheKey) {
      logDebug(
        "Ignored dismissed suggestions result",
        `- dismissed cache key: ${dismissedSuggestionCacheKey}`
      );
      return;
    }
    logDebug(
      "Rendering suggestions result",
      `- cache key: ${message.cache_key || "(missing)"}
- suggestions: ${(message.suggestions || []).length}`
    );
    if (message.error) {
      showSuggestionError(
        "Could not reach the MemeDrop API. Check that the API is running, then try again."
      );
      return;
    }
    updateSuggestions(message.suggestions || []);
  }

  if (
    message.type === "SUGGESTION_PREVIEW_READY" &&
    isCurrentSuggestionMessage(message, activeSuggestionRequestId) &&
    message.cache_key === lastSuggestionCacheKey &&
    message.meme_id &&
    message.image_data_url
  ) {
    updateSuggestionPreview(message.meme_id, message.image_data_url);
  }

  if (
    message.type === "SUGGESTION_ORIGINAL_READY" &&
    isCurrentSuggestionMessage(message, activeSuggestionRequestId) &&
    message.cache_key === lastSuggestionCacheKey &&
    message.meme_id &&
    message.image_data_url
  ) {
    updateSuggestionMedia(message.meme_id, message.image_data_url);
  }

  if (
    message.type === "SUGGESTION_PERFORMANCE" &&
    isCurrentSuggestionMessage(message, activeSuggestionRequestId) &&
    message.cache_key === lastSuggestionCacheKey &&
    message.diagnostics
  ) {
    // Diagnostics contain only counts and duration values. They stay local to
    // the extension console and are intentionally not usage telemetry.
    console.debug("[MemeDrop] suggestion performance", message.diagnostics);
  }

  if (message.type === "INSERT_MEME_FROM_POPUP" && message.payload?.image_url) {
    insertMemeByUrl({
      imageUrl: message.payload.image_url,
      memeId: message.payload.meme_id,
      source: message.payload.source,
    }).catch((err) => {
      console.error("[MemeDrop] Failed to insert meme from popup:", err);
    });
  }
});

function extractTweetText(tweetTextEl: Element): string {
  return tweetTextEl.textContent?.trim() ?? "";
}

function logDebug(title: string, details = "") {
  console.log(`${DEBUG_PREFIX}
${title}${details ? `\n${details}` : ""}`);
}

function isComposeRoute(url = window.location.href): boolean {
  if (platform.isRouteCompose(url)) return true;
  if (platform.id !== "linkedin") return false;
  return isInlineComposeSessionActive({
    hasSource: Boolean(activeMemeReplySource),
    elapsedMs: Date.now() - activeInlineComposeStartedAt,
    composerPresent: Boolean(document.querySelector(platform.selectors.composer)),
  });
}

function getReplyViewports(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(SELECTORS.viewportView)
  );
}

function getVisibleReplyViewports(viewports: HTMLElement[]): HTMLElement[] {
  return viewports.filter((viewport) => {
    const rect = viewport.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

function uniqueElements(elements: Array<Element | null | undefined>): Element[] {
  const seen = new Set<Element>();
  const result: Element[] = [];

  for (const element of elements) {
    if (!element || seen.has(element)) continue;
    seen.add(element);
    result.push(element);
  }

  return result;
}

function findTweetRootInScope(scope: Element | null | undefined): Element | null {
  if (!scope) return null;
  const tweetRoots = [
    ...(scope.matches(SELECTORS.tweet) ? [scope] : []),
    ...Array.from(scope.querySelectorAll(SELECTORS.tweet)),
  ];

  return (
    tweetRoots.find(
      (tweetRoot) =>
        tweetRoot.querySelector(SELECTORS.tweetText) &&
        !tweetRoot.querySelector(SELECTORS.tweetTextarea)
    ) || null
  );
}

function readSnapshotFromViewport(
  viewport: HTMLElement,
  viewportCount: number,
  visibleViewportCount: number,
  selectedViewportIndex: number,
  selectedStrategy: string
): ReplyTweetSnapshot {
  const lastChildElement =
    viewport.lastChild instanceof Element ? viewport.lastChild : viewport.lastElementChild;
  const replyContextContainer = lastChildElement || viewport.lastElementChild;
  const likelyTweetContainer = replyContextContainer?.firstElementChild || replyContextContainer;
  const searchScopes = uniqueElements([
    likelyTweetContainer,
    replyContextContainer,
    viewport,
  ]);
  const tweetRoot = searchScopes
    .map(findTweetRootInScope)
    .find((root): root is Element => Boolean(root)) || null;
  const tweetTextNodes = tweetRoot
    ? Array.from(tweetRoot.querySelectorAll(SELECTORS.tweetText))
    : [];
  const candidates = tweetTextNodes
    .map(extractTweetText)
    .filter((text) => text.length > 0);

  return {
    text: candidates[0] || null,
    viewportCount,
    visibleViewportCount,
    selectedViewportIndex,
    selectedStrategy,
    hasReplyContextContainer: Boolean(replyContextContainer),
    hasLikelyTweetContainer: Boolean(likelyTweetContainer),
    hasTweetRoot: Boolean(tweetRoot),
    tweetTextNodeCount: tweetTextNodes.length,
  };
}

function buildEmptySnapshot(
  viewportCount: number,
  visibleViewportCount: number,
  selectedViewportIndex = -1,
  selectedStrategy = "none"
): ReplyTweetSnapshot {
  return {
    text: null,
    viewportCount,
    visibleViewportCount,
    selectedViewportIndex,
    selectedStrategy,
    hasReplyContextContainer: false,
    hasLikelyTweetContainer: false,
    hasTweetRoot: false,
    tweetTextNodeCount: 0,
  };
}

function readReplyTweetSnapshot(): ReplyTweetSnapshot {
  const viewports = getReplyViewports();
  const visibleViewports = getVisibleReplyViewports(viewports);
  const firstViewport = document.querySelector<HTMLElement>(SELECTORS.viewportView);
  const viewportAttempts = uniqueElements([
    firstViewport,
    ...visibleViewports.filter((viewport) => viewport.querySelector(SELECTORS.tweetTextarea)),
    ...visibleViewports,
    ...viewports,
  ]) as HTMLElement[];

  if (viewportAttempts.length === 0) {
    return buildEmptySnapshot(viewports.length, visibleViewports.length);
  }

  let fallback = readSnapshotFromViewport(
    viewportAttempts[0],
    viewports.length,
    visibleViewports.length,
    viewports.indexOf(viewportAttempts[0]),
    viewportAttempts[0] === firstViewport ? "first viewport" : "first candidate"
  );

  for (const viewport of viewportAttempts) {
    const snapshot = readSnapshotFromViewport(
      viewport,
      viewports.length,
      visibleViewports.length,
      viewports.indexOf(viewport),
      viewport === firstViewport
        ? "first viewport"
        : viewport.querySelector(SELECTORS.tweetTextarea)
          ? "viewport with composer"
          : "viewport fallback"
    );

    if (!fallback.hasTweetRoot || snapshot.hasTweetRoot) {
      fallback = snapshot;
    }
    if (snapshot.text) return snapshot;
  }

  return fallback;
}

function logReplyTweetSnapshot(snapshot: ReplyTweetSnapshot, label: string) {
  logDebug(
    label,
    `- viewport count: ${snapshot.viewportCount}
- visible viewport count: ${snapshot.visibleViewportCount}
- selected viewport index: ${snapshot.selectedViewportIndex}
- selected strategy: ${snapshot.selectedStrategy}
- has reply context container: ${snapshot.hasReplyContextContainer}
- has likely tweet container: ${snapshot.hasLikelyTweetContainer}
- has tweet root: ${snapshot.hasTweetRoot}
- tweet text nodes: ${snapshot.tweetTextNodeCount}
- extracted text length: ${snapshot.text?.length || 0}`
  );
}

// The compose cache key we last requested suggestions for. It is normally the
// source tweet id parsed from the canonical URL, with a SHA-256 text hash as
// fallback.
let lastSuggestionCacheKey: string | null = null;
let dismissedSuggestionCacheKey: string | null = null;
let currentComposeDismissed = false;
// Every compose request gets a new generation, including refreshes for the
// same tweet. This keeps late media/results from a prior request out of the
// currently visible panel.
let activeSuggestionRequestId: string | null = null;
// Set only when the composer was opened through MemeDrop's explicit tweet-card button.
// The source is in-memory for the lifetime of this composer and powers refreshes.
let activeMemeReplySource: MemeReplySource | null = null;
// Optional guidance stays in memory only for the active compose. Request and
// cache identity use a hash so it never appears in diagnostics or telemetry.
let activeSteeringInstruction: string | undefined;
// Token used to abandon stale waitForTweetText() loops when the URL changes
// again before tweet text appears.
let waitToken = 0;
// LinkedIn opens comment composers inline without changing routes. Keep a
// short grace period while its editor is mounting, then require the editor to
// remain present so abandoned comment boxes do not retain stale suggestions.
let activeInlineComposeStartedAt = 0;

function activateInlineMemeReply(source: MemeReplySource, post: HTMLElement) {
  activeMemeReplySource = source;
  activeInlineComposeStartedAt = Date.now();
  setSuggestionComposerTarget(post);
  activeSteeringInstruction = undefined;
  setSuggestionSteeringInstruction(undefined);
  lastSuggestionCacheKey = null;
  dismissedSuggestionCacheKey = null;
  currentComposeDismissed = false;
  activeSuggestionRequestId = null;
  waitToken++;
  requestSuggestionsForCurrentCompose(false, source).catch((err) => {
    console.error("[MemeDrop] LinkedIn suggestions failed:", err);
  });
}

function resetComposeSession() {
  memeReplyIntent.clear();
  activeMemeReplySource = null;
  activeInlineComposeStartedAt = 0;
  setSuggestionComposerTarget(null);
  activeSteeringInstruction = undefined;
  setSuggestionSteeringInstruction(undefined);
  lastSuggestionCacheKey = null;
  dismissedSuggestionCacheKey = null;
  currentComposeDismissed = false;
  activeSuggestionRequestId = null;
  waitToken++;
  hidePanel();
}

async function waitForTweetText(token: number): Promise<string | null> {
  const deadline = Date.now() + 2500;
  let lastSnapshot: ReplyTweetSnapshot | null = null;
  while (Date.now() < deadline) {
    if (token !== waitToken) return null;
    if (!isComposeRoute()) return null;
    const snapshot = readReplyTweetSnapshot();
    lastSnapshot = snapshot;
    if (snapshot.text) {
      logReplyTweetSnapshot(snapshot, "Found reply tweet context");
      return snapshot.text;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (lastSnapshot) {
    logReplyTweetSnapshot(lastSnapshot, "Failed to find reply tweet context");
  }
  return null;
}

function getCanonicalTweetId(): string | null {
  const canonicalHref = document
    .querySelector<HTMLLinkElement>('link[rel="canonical"]')
    ?.href;
  if (!canonicalHref) return null;

  try {
    const url = new URL(canonicalHref);
    const match = url.pathname.match(/\/[^/]+\/status\/(\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function requestSuggestionsForCurrentCompose(
  refresh = false,
  source = activeMemeReplySource,
  steeringInstruction = activeSteeringInstruction
) {
  if (!isComposeRoute()) {
    logDebug(
      "Suggestion request skipped",
      `- reason: current URL is not compose
- url: ${window.location.href}`
    );
    return;
  }
  if (refresh) {
    currentComposeDismissed = false;
  }
  if (!refresh && currentComposeDismissed) {
    logDebug(
      "Suggestion request skipped",
      `- reason: panel was dismissed for this compose before request start
- url: ${window.location.href}`
    );
    return;
  }

  const token = ++waitToken;
  const requestId = createSuggestionRequestId(token);
  showSuggestionPanel();
  logDebug(
    "Suggestion request started",
    `- token: ${token}
- refresh: ${refresh}
- url: ${window.location.href}`
  );

  const text = source?.tweetText || (await waitForTweetText(token));
  if (token !== waitToken) {
    logDebug(
      "Suggestion request abandoned",
      `- reason: URL changed or a newer request started
- token: ${token}
- current token: ${waitToken}`
    );
    return;
  }
  if (!isComposeRoute()) {
    logDebug(
      "Suggestion request abandoned",
      `- reason: user left compose before suggestions were requested
- url: ${window.location.href}`
    );
    return;
  }
  if (!text) {
    lastSuggestionCacheKey = null;
    // No replacement request will be sent, so stop accepting results from an
    // earlier compose request while the error is visible.
    if (token === waitToken) activeSuggestionRequestId = null;
    showSuggestionError(
      "Could not find the tweet you are replying to. Reopen the reply dialog and try again."
    );
    return;
  }

  const suggestionText = text;
  const normalizedSteering = normalizeSteeringInstruction(steeringInstruction);
  const cacheKey = await buildSuggestionCacheKey(
    suggestionText,
    source?.tweetId || getCanonicalTweetId(),
    normalizedSteering
  );
  if (!isCurrentSuggestionGeneration(token, waitToken)) return;

  if (!refresh && (currentComposeDismissed || cacheKey === dismissedSuggestionCacheKey)) {
    logDebug(
      "Suggestion request skipped",
      `- reason: panel was dismissed for this compose
- cache key: ${cacheKey}`
    );
    return;
  }
  if (refresh) {
    logDebug("Suggestion refresh requested", "- clearing dismissed compose key");
    dismissedSuggestionCacheKey = null;
  }

  if (!refresh && cacheKey === lastSuggestionCacheKey && isPanelVisible()) {
    logDebug(
      "Suggestion request skipped",
      `- reason: panel already visible for this compose
- cache key: ${cacheKey}`
    );
    return;
  }
  // Only replace the active generation when this invocation will actually
  // send. A duplicate route event must keep receiving the in-flight request's
  // progressive media updates.
  activeSuggestionRequestId = requestId;
  lastSuggestionCacheKey = cacheKey;

  logDebug(
    "Sending suggestions request",
    `- cache key: ${cacheKey}
- text length: ${suggestionText.length}
- steered: ${Boolean(normalizedSteering)}`
  );

  chrome.runtime.sendMessage({
    type: "GET_SUGGESTIONS",
    payload: {
      tweet_text: suggestionText,
      limit: 5,
      refresh,
      cache_key: cacheKey,
      request_id: requestId,
      ...(normalizedSteering
        ? { steering_instruction: normalizedSteering }
        : {}),
    },
  });
}

window.addEventListener("memedrop:steer-suggestions", (event) => {
  if (!isComposeRoute()) return;
  const detail = (event as CustomEvent<{ instruction?: unknown }>).detail;
  if (!hasSteeringInstructionChanged(activeSteeringInstruction, detail?.instruction)) return;
  const nextSteeringInstruction = normalizeSteeringInstruction(detail?.instruction);
  activeSteeringInstruction = nextSteeringInstruction;
  setSuggestionSteeringInstruction(activeSteeringInstruction);
  requestSuggestionsForCurrentCompose(
    false,
    activeMemeReplySource,
    activeSteeringInstruction
  ).catch((err) => {
    console.error("[MemeDrop] Steered suggestions failed:", err);
  });
});

window.addEventListener("memedrop:refresh-suggestions", () => {
  if (!isComposeRoute()) {
    logDebug(
      "Refresh ignored",
      `- reason: current URL is not compose
- url: ${window.location.href}`
    );
    return;
  }
  requestSuggestionsForCurrentCompose(true).catch((err) => {
    console.error("[MemeDrop] Refresh suggestions failed:", err);
  });
});

window.addEventListener("memedrop:suggestion-attach-performance", (event) => {
  const diagnostics = (event as CustomEvent<unknown>).detail;
  if (!diagnostics || typeof diagnostics !== "object") return;
  // The panel emits durations only, never post text, captions, or template ids.
  console.debug("[MemeDrop] selected meme performance", diagnostics);
});

window.addEventListener("memedrop:suggestions-dismissed", () => {
  currentComposeDismissed = true;
  dismissedSuggestionCacheKey = lastSuggestionCacheKey;
  logDebug(
    "Suggestions panel dismissed",
    `- dismissed cache key: ${dismissedSuggestionCacheKey || "(none)"}`
  );
});

function onUrlChanged(url = window.location.href) {
  const isCompose = isComposeRoute(url);
  logDebug(
    "URL change detected",
    `- url: ${url}
- is compose: ${isCompose}`
  );

  if (platform.id === "linkedin") {
    if (!isCompose) resetComposeSession();
    return;
  }

  if (isCompose) {
    const source = memeReplyIntent.consume();
    if (!source) {
      // X's own Reply button and direct compose routes remain completely native.
      activeMemeReplySource = null;
      activeSteeringInstruction = undefined;
      setSuggestionSteeringInstruction(undefined);
      lastSuggestionCacheKey = null;
      dismissedSuggestionCacheKey = null;
      currentComposeDismissed = false;
      activeSuggestionRequestId = null;
      waitToken++;
      hidePanel();
      logDebug("Native compose detected", "- MemeDrop inference not requested");
      return;
    }
    activeMemeReplySource = source;
    activeSteeringInstruction = undefined;
    setSuggestionSteeringInstruction(undefined);
    currentComposeDismissed = false;
    requestSuggestionsForCurrentCompose(false, source);
    return;
  }

  resetComposeSession();
}

let lastSeenUrl = window.location.href;
let lastSeenIsCompose = isComposeRoute(lastSeenUrl);

function handlePotentialUrlChange(reason = "history") {
  const currentUrl = window.location.href;
  const currentIsCompose = isComposeRoute(currentUrl);
  if (currentUrl === lastSeenUrl && currentIsCompose === lastSeenIsCompose) return;

  logDebug(
    "Route state changed",
    `- reason: ${reason}
- previous url: ${lastSeenUrl}
- current url: ${currentUrl}
- previous is compose: ${lastSeenIsCompose}
- current is compose: ${currentIsCompose}`
  );

  lastSeenUrl = currentUrl;
  lastSeenIsCompose = currentIsCompose;
  onUrlChanged(currentUrl);
}

// Patch history methods so we can react to SPA navigations (X uses
// pushState). popstate covers back/forward navigations.
(function installHistoryHook() {
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args: Parameters<typeof origPush>) {
    const result = origPush.apply(this, args);
    queueMicrotask(() => handlePotentialUrlChange("pushState"));
    return result;
  };
  history.replaceState = function (...args: Parameters<typeof origReplace>) {
    const result = origReplace.apply(this, args);
    queueMicrotask(() => handlePotentialUrlChange("replaceState"));
    return result;
  };
  window.addEventListener("popstate", () => {
    setTimeout(() => handlePotentialUrlChange("popstate"), 0);
  });
})();

// X can miss content-script history hooks during modal transitions. This
// backstop keeps compose/timeline state in sync without firing suggestions
// unless the URL is actually /compose/post.
setInterval(() => handlePotentialUrlChange("route poll"), 500);
window.addEventListener("focus", () => handlePotentialUrlChange("focus"));

// Initial URL check — handles direct loads of /compose/post.
if (platform.isRouteCompose(window.location.href)) {
  onUrlChanged(window.location.href);
}

function parseDraggedMeme(dataTransfer: DataTransfer | null): DraggedMeme | null {
  if (!dataTransfer) return null;

  const customPayload = dataTransfer.getData(MEME_DROP_MIME_TYPE);
  if (customPayload) {
    try {
      const parsed = JSON.parse(customPayload) as {
        imageUrl?: string;
        memeId?: string;
        imageDataUrl?: string;
        tailoredImageDataUrl?: string;
        tailoredOverlay?: DraggedMeme["tailoredOverlay"];
        source?: "user" | "global";
      };
      if (parsed.imageUrl) {
        return {
          imageUrl: parsed.imageUrl,
          memeId: parsed.memeId,
          imageDataUrl: parsed.imageDataUrl,
          tailoredImageDataUrl: parsed.tailoredImageDataUrl,
          tailoredOverlay: parsed.tailoredOverlay,
          source: parsed.source,
        };
      }
    } catch {
      // Ignore malformed payload and fall through to generic handlers.
    }
  }

  const uriPayload = dataTransfer.getData("text/uri-list");
  if (uriPayload) {
    const first = uriPayload.split(/\r?\n/).find((l) => l && !l.startsWith("#"));
    if (first) return { imageUrl: first.trim() };
  }

  return null;
}

function mayBeDraggedMeme(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types || []);
  return (
    types.includes(MEME_DROP_MIME_TYPE) ||
    types.includes("text/uri-list") ||
    types.includes("text/plain")
  );
}

function isComposerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(platform.selectors.composer) ||
      target.querySelector(platform.selectors.composer)
  );
}

function isComposerEvent(event: Event): boolean {
  const path = event.composedPath();
  for (const node of path) {
    if (node instanceof Element && isComposerTarget(node)) {
      return true;
    }
  }

  if (isComposerTarget(event.target)) return true;

  if (event instanceof DragEvent) {
    return document
      .elementsFromPoint(event.clientX, event.clientY)
      .some((el) => isComposerTarget(el));
  }

  return false;
}

document.addEventListener(
  "dragover",
  (event) => {
    if (!isComposerEvent(event)) return;
    if (!mayBeDraggedMeme(event.dataTransfer ?? null)) return;

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  },
  true
);

document.addEventListener(
  "drop",
  (event) => {
    if (!isComposerEvent(event)) return;

    const draggedMeme = parseDraggedMeme(event.dataTransfer ?? null);
    if (!draggedMeme) return;

    event.preventDefault();
    event.stopPropagation();

    insertMemeByUrl({
      imageUrl: draggedMeme.imageUrl,
      imageDataUrl: draggedMeme.imageDataUrl,
      tailoredImageDataUrl: draggedMeme.tailoredImageDataUrl,
      tailoredOverlay: draggedMeme.tailoredOverlay,
      memeId: draggedMeme.memeId,
      source: draggedMeme.source,
      composerTarget: event.target instanceof Element ? event.target : null,
    }).catch((err) => {
      console.error("[MemeDrop] Drop insert failed:", err);
    });
  },
  true
);
