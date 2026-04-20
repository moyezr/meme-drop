/**
 * X.com DOM selectors — centralized config.
 * All content script code should reference these instead of hardcoding selectors.
 * data-testid attributes are the most stable; fall back to aria if needed.
 */
export const SELECTORS = {
  /** Contains nested spans/links with the tweet's text content */
  tweetText: 'div[data-testid="tweetText"]',

  /** Contains nested spans with display name and @handle */
  userName: 'div[data-testid="User-Name"]',

  /** Contains nested <img> elements for tweet photos */
  tweetPhoto: 'div[data-testid="tweetPhoto"]',

  /** Inline reply composer on tweet detail pages */
  inlineReply: 'div[data-testid="inline_reply_offscreen"]',

  /** The tweet compose text input area */
  tweetTextarea: 'div[data-testid="tweetTextarea_0"]',
} as const;

/**
 * URL patterns for detecting reply composer modal.
 * The modal appears when navigating to x.com/compose/post.
 */
export const URL_PATTERNS = {
  composeModal: /x\.com\/compose\/post/,
  tweetDetail: /x\.com\/\w+\/status\/\d+/,
} as const;
