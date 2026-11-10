/** A dispatched input/paste event is an attempt, not evidence of attachment. */
export type ComposerQuery = (scope: Element, selector: string) => Element[];
export const queryComposer: ComposerQuery = (scope, selector) => Array.from(scope.querySelectorAll(selector));

export function attachmentImageSnapshot(scope: Element, selector: string, query = queryComposer): Map<Element, string> {
  return new Map((query(scope, selector) as HTMLImageElement[])
    .map((image) => [image, image.currentSrc || image.src]));
}

export function hasNewReadyAttachment(
  scope: Element,
  imageSelector: string,
  busySelector: string,
  before: Map<Element, string>,
  query = queryComposer
): boolean {
  if (!scope.isConnected || query(scope, busySelector).length) return false;
  return (query(scope, imageSelector) as HTMLImageElement[]).some((image) => {
    const source = image.currentSrc || image.src;
    return source && image.complete && image.naturalWidth > 0 &&
      (!before.has(image) || before.get(image) !== source);
  });
}

export async function waitForNativeAttachment(
  scope: Element,
  imageSelector: string,
  busySelector: string,
  before: Map<Element, string>,
  isCurrent: () => boolean,
  timeoutMs = 4_000,
  query = queryComposer,
  isRemovable = () => true
): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  // A bounded poll also observes image decoding, which need not mutate DOM.
  while (isCurrent() && scope.isConnected) {
    if (hasNewReadyAttachment(scope, imageSelector, busySelector, before, query) && isRemovable()) return true;
    if (performance.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/** Capture only the image input activated synchronously by this composer's control. */
export function captureComposerFileInput(
  scope: Element,
  buttonSelector: string,
  inputSelector: string,
  isCurrent: () => boolean,
  query = queryComposer
): HTMLInputElement | null {
  const controls = query(scope, buttonSelector);
  const button = controls.length === 1 ? controls[0] as HTMLButtonElement : null;
  if (!button || button.disabled || !button.isConnected || !scope.isConnected || !isCurrent()) return null;
  const bounds = button.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const activated = new Set<HTMLInputElement>();
  const document = scope.ownerDocument;
  const intercept = (event: Event) => {
    const input = event.composedPath().find((node) => node instanceof HTMLInputElement && node.matches(inputSelector));
    if (!(input instanceof HTMLInputElement) || !input.matches(inputSelector)) return;
    // Cancel the file input's native chooser; retain its exact reference even
    // when the platform portals it outside the bound dialog.
    event.preventDefault();
    activated.add(input);
  };
  document.addEventListener("click", intercept, true);
  try {
    button.click();
  } finally {
    document.removeEventListener("click", intercept, true);
  }
  if (activated.size !== 1 || !scope.isConnected || !isCurrent()) return null;
  const input = activated.values().next().value;
  return input?.isConnected && !input.disabled ? input : null;
}
