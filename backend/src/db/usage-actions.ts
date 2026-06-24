export const USAGE_FEEDBACK_ACTIONS = [
  "suggested",
  "shown",
  "clicked",
  "used",
  "inserted",
  "saved",
  "dismissed",
] as const;

export type UsageFeedbackAction = (typeof USAGE_FEEDBACK_ACTIONS)[number];

export function usageActionCheckConstraintSql(): string {
  const values = USAGE_FEEDBACK_ACTIONS.map((action) => `'${action}'`).join(", ");
  return `action IN (${values})`;
}
