import { SELECTORS, URL_PATTERNS } from "./selectors";
import { initSaveButton } from "./save-button";
import {
  showSuggestionPanel,
  updateSuggestions,
  insertMemeByUrl,
} from "./suggestion-panel";

console.log("[MemeDrop] Content script loaded on", window.location.href);

const MEME_DROP_MIME_TYPE = "application/x-memedrop-meme";

// Initialize save button overlay on image hover
initSaveButton();

// Listen for suggestion responses from the background worker
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

/**
 * Debounce helper to avoid excessive callback firing during React re-renders.
 */
function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

/**
 * Extract text content from a tweetText element, traversing through nested spans/links.
 */
function extractTweetText(tweetTextEl: Element): string {
  return tweetTextEl.textContent?.trim() ?? "";
}

// Guard: track which URL we already fired suggestions for, so we only fire once per composer.
let replyDetectedForUrl: string | null = null;
let inlineReplyDetected = false;

/**
 * Called when a reply composer is detected. Only fires once per context.
 */
function onReplyComposerDetected() {
  // Find the tweet being replied to
  const tweetTextEls = document.querySelectorAll(SELECTORS.tweetText);
  if (tweetTextEls.length === 0) return;

  // The first tweetText on the page is typically the tweet being replied to
  const tweetText = extractTweetText(tweetTextEls[0]);
  if (!tweetText) return;

  console.log("[MemeDrop] Reply composer detected. Tweet text:", tweetText);

  // Show loading panel immediately
  showSuggestionPanel();

  chrome.runtime.sendMessage({
    type: "GET_SUGGESTIONS",
    payload: { tweet_text: tweetText },
  });
}

/**
 * Watch for URL changes (compose modal detection).
 */
let lastUrl = window.location.href;
const checkUrlChange = debounce(() => {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;

    // Reset inline reply flag when navigating to a new page
    inlineReplyDetected = false;

    if (URL_PATTERNS.composeModal.test(currentUrl)) {
      if (replyDetectedForUrl !== currentUrl) {
        replyDetectedForUrl = currentUrl;
        onReplyComposerDetected();
      }
    } else {
      // Navigated away from compose modal — allow re-detection
      replyDetectedForUrl = null;
    }
  }
}, 200);

/**
 * MutationObserver to detect DOM changes (inline reply, URL changes via React router).
 */
const observer = new MutationObserver(
  debounce(() => {
    checkUrlChange();

    // Check for inline reply composer — only fire once while it's present
    const inlineReply = document.querySelector(SELECTORS.inlineReply);
    if (inlineReply && !inlineReplyDetected) {
      inlineReplyDetected = true;
      onReplyComposerDetected();
    } else if (!inlineReply) {
      // Element removed — allow re-detection if it reappears
      inlineReplyDetected = false;
    }
  }, 300)
);

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

function parseDraggedMeme(dataTransfer: DataTransfer | null): {
  imageUrl: string;
  memeId?: string;
} | null {
  if (!dataTransfer) return null;

  const customPayload = dataTransfer.getData(MEME_DROP_MIME_TYPE);
  if (customPayload) {
    try {
      const parsed = JSON.parse(customPayload) as {
        imageUrl?: string;
        memeId?: string;
      };
      if (parsed.imageUrl) {
        return {
          imageUrl: parsed.imageUrl,
          memeId: parsed.memeId,
        };
      }
    } catch {
      // Ignore malformed payload and try fallback payload types.
    }
  }

  const uriPayload = dataTransfer.getData("text/uri-list");
  if (uriPayload) {
    return { imageUrl: uriPayload.trim() };
  }

  return null;
}

function isComposerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(SELECTORS.tweetTextarea));
}

document.addEventListener(
  "dragover",
  (event) => {
    if (!isComposerTarget(event.target)) return;

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
    if (!isComposerTarget(event.target)) return;

    const draggedMeme = parseDraggedMeme(event.dataTransfer ?? null);
    if (!draggedMeme) return;

    event.preventDefault();
    event.stopPropagation();

    insertMemeByUrl({
      imageUrl: draggedMeme.imageUrl,
      memeId: draggedMeme.memeId,
    }).catch((err) => {
      console.error("[MemeDrop] Drop insert failed:", err);
    });
  },
  true
);
