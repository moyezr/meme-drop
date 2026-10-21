/** A dispatched input/paste event is an attempt, not evidence of attachment. */
export function attachmentImageSnapshot(scope: Element, selector: string): Map<Element, string> {
  return new Map(Array.from(scope.querySelectorAll<HTMLImageElement>(selector))
    .map((image) => [image, image.currentSrc || image.src]));
}

export function hasNewReadyAttachment(
  scope: Element,
  imageSelector: string,
  busySelector: string,
  before: Map<Element, string>
): boolean {
  if (!scope.isConnected || scope.querySelector(busySelector)) return false;
  return Array.from(scope.querySelectorAll<HTMLImageElement>(imageSelector)).some((image) => {
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
  timeoutMs = 4_000
): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  // A bounded poll also observes image decoding, which need not mutate DOM.
  while (isCurrent() && scope.isConnected) {
    if (hasNewReadyAttachment(scope, imageSelector, busySelector, before)) return true;
    if (performance.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
