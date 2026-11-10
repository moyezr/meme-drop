/** Bounded reads across open native shadow roots, excluding other reply targets. */
export const REPLY_TARGET_SELECTOR = "shreddit-post, shreddit-comment";
const MAX_VISITED_NODES = 512;
// Native rich-text composers include a large toolbar and Lexical metadata nodes.
// Keep UI discovery bounded separately from the smaller source-text read budget.
const MAX_COMPOSER_NODES = 2_048;

export function composedClosest(element: Element, selector: string): Element | null {
  let current: Element | null = element;
  for (let depth = 0; current && depth < 64; depth++) {
    if (current.matches(selector)) return current;
    const root: Node = current.getRootNode();
    current = current.parentElement || (root instanceof ShadowRoot ? root.host : null);
  }
  return null;
}

/** A target's descendants may contain thousands of other comments; never walk into them. */
export function ownedElements(scope: Element, selector: string): Element[] {
  const result: Element[] = [];
  const pending: Element[] = [scope];
  let visited = 0;
  while (pending.length && visited++ < MAX_COMPOSER_NODES) {
    const element = pending.pop()!;
    if (element !== scope && element.matches(REPLY_TARGET_SELECTOR)) continue;
    if (element !== scope && element.matches(selector)) result.push(element);
    // Exclude whole reply branches before materializing a JS work list, including
    // a selected parent with thousands of direct child comments.
    const groups = [
      element.querySelectorAll(":scope > :not(shreddit-post):not(shreddit-comment)"),
      element.shadowRoot?.children,
    ];
    for (const children of groups) {
      if (!children) continue;
      if (children.length > MAX_COMPOSER_NODES) return [];
      for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
    }
  }
  // Never choose from an incomplete search that might hide a second editor/input.
  return pending.length ? [] : result;
}

export function boundedOwnText(scope: Element, limit: number): { text: string; truncated: boolean } {
  const pending: Node[] = [scope];
  let text = "";
  let visited = 0;
  while (pending.length && text.length <= limit && visited++ < MAX_VISITED_NODES) {
    const node = pending.pop()!;
    if (node.nodeType === Node.TEXT_NODE) {
      text += (node.nodeValue || "").slice(0, limit + 1 - text.length);
    } else {
      if (node instanceof Element && node !== scope &&
          node.matches(`${REPLY_TARGET_SELECTOR}, script, style, button, textarea, [contenteditable]`)) continue;
      if (node instanceof Element && /^(P|DIV|LI|BR)$/.test(node.tagName) && text) text += "\n";
      const children = node.childNodes;
      if (children.length > MAX_VISITED_NODES) return { text: text.trim(), truncated: true };
      for (let index = Math.min(children.length, MAX_VISITED_NODES) - 1; index >= 0; index--) {
        pending.push(children[index]);
      }
    }
  }
  const truncated = Boolean(pending.length || text.length > limit);
  return { text: text.slice(0, limit).replace(/\s+/g, " ").trim(), truncated };
}

export function isVisibleElement(element: Element): element is HTMLElement {
  const rect = element.getBoundingClientRect();
  return element instanceof HTMLElement && element.isConnected && rect.width > 0 && rect.height > 0 &&
    !composedClosest(element, '[hidden], [aria-hidden="true"], [inert]');
}
