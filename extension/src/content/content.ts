import { SELECTORS, URL_PATTERNS } from "./selectors";
import { initSaveButton } from "./save-button";
import {
  showSuggestionPanel,
  updateSuggestions,
  insertMemeByUrl,
  hidePanel,
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
    }).catch((err) => {
      console.error("[MemeDrop] Failed to insert meme from popup:", err);
    });
  }
});

function extractTweetText(tweetTextEl: Element): string {
  return tweetTextEl.textContent?.trim() ?? "";
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
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (token !== waitToken) return null;
    const el = document.querySelector(SELECTORS.tweetText);
    if (el) {
      const text = extractTweetText(el);
      if (text) return text;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

async function requestSuggestionsForCurrentCompose() {
  const token = ++waitToken;
  showSuggestionPanel();

  const text = await waitForTweetText(token);
  if (token !== waitToken) return; // URL changed while waiting
  if (!text) {
    // Couldn't find a tweet to reply to — likely a fresh compose (not a reply).
    hidePanel();
    return;
  }

  if (text === lastRequestedTweetText) return;
  lastRequestedTweetText = text;

  chrome.runtime.sendMessage({
    type: "GET_SUGGESTIONS",
    payload: { tweet_text: text },
  });
}

function onUrlChanged() {
  const url = window.location.href;
  const isCompose = URL_PATTERNS.composeModal.test(url);

  if (isCompose) {
    if (url !== lastComposeUrl) {
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

// Initial URL check — handles direct loads of /compose/post.
onUrlChanged();

function parseDraggedMeme(dataTransfer: DataTransfer | null): {
  imageUrl: string;
  memeId?: string;
  imageDataUrl?: string;
} | null {
  if (!dataTransfer) return null;

  const customPayload = dataTransfer.getData(MEME_DROP_MIME_TYPE);
  if (customPayload) {
    try {
      const parsed = JSON.parse(customPayload) as {
        imageUrl?: string;
        memeId?: string;
        imageDataUrl?: string;
      };
      if (parsed.imageUrl) {
        return {
          imageUrl: parsed.imageUrl,
          memeId: parsed.memeId,
          imageDataUrl: parsed.imageDataUrl,
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

function isComposerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(SELECTORS.tweetTextarea));
}

function isComposerEvent(event: Event): boolean {
  const path = event.composedPath();
  for (const node of path) {
    if (node instanceof Element && node.closest(SELECTORS.tweetTextarea)) {
      return true;
    }
  }

  return isComposerTarget(event.target);
}

document.addEventListener(
  "dragover",
  (event) => {
    if (!isComposerEvent(event)) return;

    const draggedMeme = parseDraggedMeme(event.dataTransfer ?? null);
    if (!draggedMeme) return;

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
    }).catch((err) => {
      console.error("[MemeDrop] Drop insert failed:", err);
    });
  },
  true
);
