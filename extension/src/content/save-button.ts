import { SELECTORS } from "./selectors";
import { showToast } from "./toast";

const BUTTON_SIZE = 32;
const BUTTON_MARGIN = 8;

let currentHoverTarget: Element | null = null;
let saveButton: HTMLDivElement | null = null;

function createSaveButton(): HTMLDivElement {
  const btn = document.createElement("div");
  btn.id = "memedrop-save-btn";
  btn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
  `;
  Object.assign(btn.style, {
    position: "absolute",
    width: `${BUTTON_SIZE}px`,
    height: `${BUTTON_SIZE}px`,
    borderRadius: "50%",
    background: "rgba(0, 0, 0, 0.7)",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    zIndex: "9999",
    transition: "background 0.15s, transform 0.15s",
    pointerEvents: "auto",
    backdropFilter: "blur(4px)",
  });

  btn.addEventListener("mouseenter", () => {
    btn.style.background = "rgba(29, 155, 240, 0.9)";
    btn.style.transform = "scale(1.1)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "rgba(0, 0, 0, 0.7)";
    btn.style.transform = "scale(1)";
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleSaveClick(btn);
  });

  return btn;
}

function getImageUrl(photoContainer: Element): string | null {
  const img = photoContainer.querySelector("img");
  if (!img) return null;

  // X serves images with query params for sizing — get the base URL with best quality
  const src = img.src;
  if (!src) return null;

  // For pbs.twimg.com images, request the original format
  try {
    const url = new URL(src);
    if (url.hostname === "pbs.twimg.com") {
      url.searchParams.set("name", "large");
    }
    return url.toString();
  } catch {
    return src;
  }
}

async function handleSaveClick(btn: HTMLDivElement) {
  if (!currentHoverTarget) return;

  const imageUrl = getImageUrl(currentHoverTarget);
  if (!imageUrl) {
    showToast("Could not find image URL", "error");
    return;
  }

  // Visual feedback — fill the icon
  btn.style.background = "rgba(29, 155, 240, 0.9)";
  btn.style.transform = "scale(0.9)";
  setTimeout(() => {
    btn.style.transform = "scale(1)";
  }, 150);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "SAVE_MEME",
      payload: { image_url: imageUrl },
    });

    if (response?.error) {
      showToast(`Save failed: ${response.error}`, "error");
    } else if (response?.meme) {
      const tags = response.meme.systemTags;
      const tagNames = tags?.use_cases?.length
        ? tags.use_cases.join(", ")
        : "meme saved";
      showToast(`Saved! Tags: ${tagNames}`, "success");

      // Mark button as saved
      btn.style.background = "rgba(0, 186, 124, 0.9)";
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      `;
    } else {
      showToast("Meme saved!", "success");
    }
  } catch (err) {
    console.error("[MemeDrop] Save error:", err);
    showToast("Save failed — is the backend running?", "error");
  }
}

function positionButton(btn: HTMLDivElement, container: Element) {
  const rect = container.getBoundingClientRect();
  const scrollTop = window.scrollY;
  const scrollLeft = window.scrollX;

  btn.style.top = `${rect.top + scrollTop + BUTTON_MARGIN}px`;
  btn.style.left = `${rect.right + scrollLeft - BUTTON_SIZE - BUTTON_MARGIN}px`;
}

function showSaveButton(photoContainer: Element) {
  if (currentHoverTarget === photoContainer && saveButton) return;

  hideSaveButton();
  currentHoverTarget = photoContainer;

  saveButton = createSaveButton();
  document.body.appendChild(saveButton);
  positionButton(saveButton, photoContainer);
}

function hideSaveButton() {
  if (saveButton) {
    saveButton.remove();
    saveButton = null;
  }
  currentHoverTarget = null;
}

export function initSaveButton() {
  // Use event delegation on document for efficiency
  document.addEventListener("mouseover", (e) => {
    const target = e.target as Element;
    const photoContainer = target.closest(SELECTORS.tweetPhoto);

    if (photoContainer) {
      showSaveButton(photoContainer);
    }
  });

  document.addEventListener("mouseout", (e) => {
    const target = e.target as Element;
    const relatedTarget = (e as MouseEvent).relatedTarget as Element | null;

    // Don't hide if moving to the save button or within the photo container
    if (
      relatedTarget &&
      (relatedTarget.id === "memedrop-save-btn" ||
        relatedTarget.closest("#memedrop-save-btn") ||
        relatedTarget.closest(SELECTORS.tweetPhoto) === currentHoverTarget)
    ) {
      return;
    }

    // Don't hide if moving from save button back to the photo
    if (
      target.id === "memedrop-save-btn" ||
      target.closest("#memedrop-save-btn")
    ) {
      if (
        relatedTarget &&
        relatedTarget.closest(SELECTORS.tweetPhoto) === currentHoverTarget
      ) {
        return;
      }
    }

    // Check if we're leaving both the photo and the save button
    const stillInPhoto = relatedTarget?.closest(SELECTORS.tweetPhoto);
    const stillInButton =
      relatedTarget?.id === "memedrop-save-btn" ||
      relatedTarget?.closest("#memedrop-save-btn");

    if (!stillInPhoto && !stillInButton) {
      hideSaveButton();
    }
  });

  // Handle scroll — reposition or hide the button
  window.addEventListener(
    "scroll",
    () => {
      if (saveButton && currentHoverTarget) {
        positionButton(saveButton, currentHoverTarget);
      }
    },
    { passive: true }
  );

  console.log("[MemeDrop] Save button initialized");
}
