/**
 * X.com DOM selectors — centralized config.
 * All content script code should reference these instead of hardcoding selectors.
 * data-testid attributes are the most stable; fall back to aria if needed.
 */
export const SELECTORS = {
  /** Contains nested spans/links with the tweet's text content */
  tweetText: 'div[data-testid="tweetText"]',

  /** Root article node for a tweet */
  tweet: 'article[data-testid="tweet"]',

  /** X's native reply action inside a tweet card */
  nativeReply: '[data-testid="reply"]',

  /** Tweet action bar containing reply, repost, like, and view actions */
  tweetActions: 'div[role="group"]',

  /** Contains nested spans with display name and @handle */
  userName: 'div[data-testid="User-Name"]',

  /** Contains nested <img> elements for tweet photos */
  tweetPhoto: 'div[data-testid="tweetPhoto"]',

  /** Inline reply composer on tweet detail pages */
  inlineReply: 'div[data-testid="inline_reply_offscreen"]',

  /** The tweet compose text input area */
  tweetTextarea: 'div[data-testid^="tweetTextarea_"]',

  /** X compose/reply modal dialog */
  composeDialog: 'div[role="dialog"]',

  /** X modal viewport wrapper that contains the reply composer and source tweet */
  viewportView: '[data-viewportview="true"]',

  /** X's hidden file input used by the image-attach button on the composer.
   *  Setting .files + dispatching `change` on this is the only reliable way
   *  to hand X a File; synthetic paste events don't trigger its upload flow. */
  composerFileInput: 'input[data-testid="fileInput"]',
} as const;

/**
 * URL patterns for detecting reply composer modal.
 * Suggestions intentionally only fire for the modal compose route to avoid
 * spending model calls on every inline reply composer.
 */
export const URL_PATTERNS = {
  composeModal: /(x|twitter)\.com\/compose\/post/,
  tweetDetail: /(x|twitter)\.com\/\w+\/status\/\d+/,
} as const;
