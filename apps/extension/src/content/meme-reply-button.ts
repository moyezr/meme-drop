import type { MemeReplySource } from "../shared/meme-reply-intent";
import type { PlatformAdapter } from "./platform-adapter";

const BUTTON_ATTRIBUTE = "data-memedrop-reply";
const STYLE_ID = "memedrop-reply-button-styles";

export const MEME_REPLY_BUTTON_STYLES = `
[${BUTTON_ATTRIBUTE}] {
  align-items: center;
  background: rgba(249, 24, 128, 0.13);
  border: 1px solid rgba(249, 24, 128, 0.38);
  border-radius: 9999px;
  box-shadow: 0 1px 4px rgba(249, 24, 128, 0.12);
  color: rgb(249, 24, 128);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  gap: 4px;
  justify-content: center;
  min-height: 34px;
  min-width: 34px;
  padding: 0 8px;
  transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease;
}
[${BUTTON_ATTRIBUTE}]:hover {
  background: rgba(249, 24, 128, 0.22);
  border-color: rgba(249, 24, 128, 0.7);
  transform: translateY(-1px);
}
[${BUTTON_ATTRIBUTE}]:focus-visible {
  outline: 2px solid rgb(249, 24, 128);
  outline-offset: 2px;
}
[${BUTTON_ATTRIBUTE}] svg {
  height: 18px;
  width: 18px;
}
[${BUTTON_ATTRIBUTE}] .memedrop-reply-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.01em;
}
@media (max-width: 620px) {
  [${BUTTON_ATTRIBUTE}] .memedrop-reply-label { display: none; }
}
`;

export interface MemeReplyButtonController {
  destroy(): void;
  isForwardingNativeReply(): boolean;
}

export function initMemeReplyButtons(
  platform: PlatformAdapter,
  onMemeReply: (source: MemeReplySource, post: HTMLElement) => void
): MemeReplyButtonController {
  let forwardingNativeReply = false;
  let scanQueued = false;

  ensureStyles();

  const injectButtons = () => {
    scanQueued = false;
    for (const post of platform.findPosts()) {
      injectButton(post);
    }
  };

  const queueScan = () => {
    if (scanQueued) return;
    scanQueued = true;
    queueMicrotask(injectButtons);
  };

  const injectButton = (post: HTMLElement) => {
    if (platform.id === "x" && post.closest(platform.selectors.composeScope)) return;
    const nativeReply = post.querySelector<HTMLElement>(platform.selectors.nativeReply);
    const actionGroup = nativeReply ? platform.findActionGroup(nativeReply) : null;
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
      <span class="memedrop-reply-label">Meme</span>
    `;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      onMemeReply(platform.extractReplySource(post, nativeReply), post);

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
  style.textContent = MEME_REPLY_BUTTON_STYLES;
  document.head.appendChild(style);
}
