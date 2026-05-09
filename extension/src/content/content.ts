import { SELECTORS, URL_PATTERNS } from "./selectors";
import { initSaveButton } from "./save-button";
import {
  showSuggestionPanel,
  updateSuggestions,
  insertMemeByUrl,
  hidePanel,
  isPanelVisible,
} from "./suggestion-panel";

const MEME_DROP_MIME_TYPE = "application/x-memedrop-meme";

initSaveButton();

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SUGGESTIONS_RESULT") {
    updateSuggestions(message.suggestions || []);
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

function findVisibleComposeDialog(): HTMLElement | null {
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>(SELECTORS.composeDialog)
  ).filter((dialog) => {
    if (!dialog.querySelector(SELECTORS.tweetTextarea)) return false;
    const rect = dialog.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  return dialogs.at(-1) || null;
}

function getTweetTextForActiveCompose(): string | null {
  const dialog = findVisibleComposeDialog();
  const scopedTweetEls = dialog
    ? Array.from(dialog.querySelectorAll(SELECTORS.tweetText))
    : [];
  const tweetEls =
    scopedTweetEls.length > 0
      ? scopedTweetEls
      : Array.from(document.querySelectorAll(SELECTORS.tweetText));

  const candidates = tweetEls
    .map(extractTweetText)
    .filter((text) => text.length > 0)
    .sort((a, b) => b.length - a.length);

  return candidates[0] || null;
}

// The composer URL we last fired suggestions for. Prevents duplicate fires
// when the same /compose/post page stays open across DOM churn.
let lastComposeUrl: string | null = null;
// The tweet text we last requested suggestions for. Same-URL re-visits that
// yield the same tweet text are served from whatever the panel already shows.
let lastRequestedTweetText: string | null = null;
// Token used to abandon stale waitForTweetText() loops when the URL changes
// again before tweet text appears.
let waitToken = 0;

async function waitForTweetText(token: number): Promise<string | null> {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    if (token !== waitToken) return null;
    const text = getTweetTextForActiveCompose();
    if (text) return text;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

async function requestSuggestionsForCurrentCompose(refresh = false) {
  const token = ++waitToken;
  showSuggestionPanel();

  const text = await waitForTweetText(token);
  if (token !== waitToken) return; // URL changed while waiting
  const suggestionText = text || "A new X post where a funny, broadly useful reaction meme would help.";

  if (!refresh && suggestionText === lastRequestedTweetText && isPanelVisible()) return;
  lastRequestedTweetText = suggestionText;

  chrome.runtime.sendMessage({
    type: "GET_SUGGESTIONS",
    payload: { tweet_text: suggestionText, limit: 10, source: "all", refresh, mode: "fast" },
  });
}

window.addEventListener("memedrop:refresh-suggestions", () => {
  requestSuggestionsForCurrentCompose(true).catch((err) => {
    console.error("[MemeDrop] Refresh suggestions failed:", err);
  });
});

function onUrlChanged() {
  const url = window.location.href;
  const isCompose = URL_PATTERNS.composeModal.test(url);

  if (isCompose) {
    if (url !== lastComposeUrl || !isPanelVisible()) {
      lastComposeUrl = url;
      lastRequestedTweetText = null;
      requestSuggestionsForCurrentCompose();
    }
    return;
  }

  // Navigated away from /compose/post — tear down any panel state so the
  // next compose starts from a clean slate.
  if (lastComposeUrl !== null) {
    lastComposeUrl = null;
    lastRequestedTweetText = null;
    waitToken++;
    hidePanel();
  }
}

// Patch history methods so we can react to SPA navigations (X uses
// pushState). popstate covers back/forward navigations.
(function installHistoryHook() {
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args: Parameters<typeof origPush>) {
    const result = origPush.apply(this, args);
    queueMicrotask(onUrlChanged);
    return result;
  };
  history.replaceState = function (...args: Parameters<typeof origReplace>) {
    const result = origReplace.apply(this, args);
    queueMicrotask(onUrlChanged);
    return result;
  };
  window.addEventListener("popstate", onUrlChanged);
})();

let lastSeenUrl = window.location.href;
function checkForComposeState() {
  const currentUrl = window.location.href;
  if (currentUrl !== lastSeenUrl) {
    lastSeenUrl = currentUrl;
    onUrlChanged();
    return;
  }

  if (URL_PATTERNS.composeModal.test(currentUrl) && !isPanelVisible()) {
    onUrlChanged();
  }
}

const composeObserver = new MutationObserver(() => {
  queueMicrotask(checkForComposeState);
});
composeObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
});
window.addEventListener("focus", checkForComposeState);
document.addEventListener("visibilitychange", checkForComposeState);
setInterval(checkForComposeState, 1000);

// Initial URL check — handles direct loads of /compose/post.
checkForComposeState();

function parseDraggedMeme(dataTransfer: DataTransfer | null): {
  imageUrl: string;
  memeId?: string;
  imageDataUrl?: string;
  source?: "user" | "global";
} | null {
  if (!dataTransfer) return null;

  const customPayload = dataTransfer.getData(MEME_DROP_MIME_TYPE);
  if (customPayload) {
    try {
      const parsed = JSON.parse(customPayload) as {
        imageUrl?: string;
        memeId?: string;
        imageDataUrl?: string;
        source?: "user" | "global";
      };
      if (parsed.imageUrl) {
        return {
          imageUrl: parsed.imageUrl,
          memeId: parsed.memeId,
          imageDataUrl: parsed.imageDataUrl,
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
    target.closest(SELECTORS.tweetTextarea) ||
      target.querySelector(SELECTORS.tweetTextarea)
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
      memeId: draggedMeme.memeId,
      source: draggedMeme.source,
      composerTarget: event.target instanceof Element ? event.target : null,
    }).catch((err) => {
      console.error("[MemeDrop] Drop insert failed:", err);
    });
  },
  true
);
