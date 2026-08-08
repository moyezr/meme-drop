import { SELECTORS } from "./selectors";
import type { MemeReplySource } from "../shared/meme-reply-intent";
import { tweetIdFromStatusHref } from "../shared/meme-reply-intent";

const BUTTON_ATTRIBUTE = "data-memedrop-reply";
const STYLE_ID = "memedrop-reply-button-styles";

const BUTTON_STYLES = `
[${BUTTON_ATTRIBUTE}] {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 9999px;
  color: rgb(113, 118, 123);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  gap: 4px;
  justify-content: center;
  min-height: 34px;
  min-width: 34px;
  padding: 0 8px;
  transition: background-color 120ms ease, color 120ms ease;
}
[${BUTTON_ATTRIBUTE}]:hover {
  background: rgba(249, 24, 128, 0.1);
  color: rgb(249, 24, 128);
}
[${BUTTON_ATTRIBUTE}]:focus-visible {
  outline: 2px solid rgb(249, 24, 128);
  outline-offset: 2px;
}
[${BUTTON_ATTRIBUTE}] svg {
  height: 18px;
  width: 18px;
}
@media (prefers-color-scheme: light) {
  [${BUTTON_ATTRIBUTE}] { color: rgb(83, 100, 113); }
}
`;

export interface MemeReplyButtonController {
  destroy(): void;
  isForwardingNativeReply(): boolean;
}

export function initMemeReplyButtons(
  onMemeReply: (source: MemeReplySource) => void
): MemeReplyButtonController {
  let forwardingNativeReply = false;
  let scanQueued = false;

  ensureStyles();

  const injectButtons = () => {
    scanQueued = false;
    for (const tweet of document.querySelectorAll<HTMLElement>(SELECTORS.tweet)) {
      injectButton(tweet);
    }
  };

  const queueScan = () => {
    if (scanQueued) return;
    scanQueued = true;
    queueMicrotask(injectButtons);
  };

  const injectButton = (tweet: HTMLElement) => {
    if (tweet.closest(SELECTORS.composeDialog)) return;
    const nativeReply = tweet.querySelector<HTMLElement>(SELECTORS.nativeReply);
    const actionGroup = nativeReply?.closest<HTMLElement>(SELECTORS.tweetActions);
    if (!nativeReply || !actionGroup || actionGroup.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;

    const actionUnit = directChildContaining(actionGroup, nativeReply);
    if (!actionUnit) return;

    const wrapper = document.createElement("div");
    wrapper.style.alignItems = "center";
    wrapper.style.display = "flex";
    wrapper.style.flex = "1 1 0";
    wrapper.style.justifyContent = "flex-start";

    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute(BUTTON_ATTRIBUTE, "true");
    button.setAttribute("aria-label", "Reply with a meme using MemeDrop");
    button.title = "Reply with MemeDrop";
    button.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h8A2.5 2.5 0 0 1 17 5.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-4.5 3v-5.5A2.5 2.5 0 0 1 4 11z"/>
        <path d="m17.5 2 .65 1.85L20 4.5l-1.85.65L17.5 7l-.65-1.85L15 4.5l1.85-.65z"/>
      </svg>
    `;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const tweetText = tweet.querySelector(SELECTORS.tweetText)?.textContent?.trim() || null;
      const statusHref = Array.from(tweet.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'))
        .map((link) => link.href)
        .find((href) => tweetIdFromStatusHref(href));
      onMemeReply({
        tweetText,
        tweetId: tweetIdFromStatusHref(statusHref),
      });

      forwardingNativeReply = true;
      try {
        nativeReply.click();
      } finally {
        forwardingNativeReply = false;
      }
    });

    wrapper.appendChild(button);
    actionUnit.insertAdjacentElement("afterend", wrapper);
  };

  injectButtons();
  const observer = new MutationObserver(queueScan);
  observer.observe(document.body, { childList: true, subtree: true });

  return {
    destroy() {
      observer.disconnect();
      document.querySelectorAll(`[${BUTTON_ATTRIBUTE}]`).forEach((button) => {
        button.parentElement?.remove();
      });
    },
    isForwardingNativeReply() {
      return forwardingNativeReply;
    },
  };
}

function directChildContaining(parent: HTMLElement, descendant: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = descendant;
  while (current?.parentElement && current.parentElement !== parent) {
    current = current.parentElement;
  }
  return current?.parentElement === parent ? current : null;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = BUTTON_STYLES;
  document.head.appendChild(style);
}
