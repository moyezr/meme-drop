import type { UsageFeedbackAction } from "../db/usage-actions.js";

export type { UsageFeedbackAction };

export interface UsageFeedbackRow {
  meme_id: string;
  meme_name: string;
  meme_source: "global" | "user";
  action: UsageFeedbackAction;
  events: number;
}

export interface UsageFeedbackItem {
  meme_id: string;
  meme_name: string;
  meme_source: "global" | "user";
  shown: number;
  clicked: number;
  used: number;
  saved: number;
  dismissed: number;
  click_through_rate: number;
  use_rate: number;
  save_rate: number;
  dismissal_rate: number;
  quality_signal: "promote" | "watch" | "review" | "insufficient_data";
}

export interface UsageFeedbackReport {
  generated_at: string;
  lookback_days: number;
  minimum_shown: number;
  summary: {
    memes: number;
    shown: number;
    clicked: number;
    used: number;
    saved: number;
    dismissed: number;
    promote_candidates: number;
    review_candidates: number;
  };
  items: UsageFeedbackItem[];
}

export async function loadUsageFeedbackReport(options: {
  lookbackDays: number;
  minimumShown: number;
  limit: number;
}): Promise<UsageFeedbackReport> {
  const [{ sql }, { db }] = await Promise.all([
    import("drizzle-orm"),
    import("../db/index.js"),
  ]);
  const result = await db.execute(sql`
    SELECT
      COALESCE(u.global_meme_id, u.user_meme_id)::text AS meme_id,
      COALESCE(m.name, um.user_name, 'unknown meme') AS meme_name,
      CASE WHEN u.user_meme_id IS NULL THEN 'global' ELSE 'user' END AS meme_source,
      u.action,
      COUNT(*)::int AS events
    FROM usage_events u
    LEFT JOIN memes m ON m.id = u.global_meme_id
    LEFT JOIN user_memes um ON um.id = u.user_meme_id
    WHERE u.created_at > NOW() - (${options.lookbackDays}::text || ' days')::interval
      AND COALESCE(u.global_meme_id, u.user_meme_id) IS NOT NULL
    GROUP BY 1, 2, 3, 4
  `);

  return summarizeUsageFeedback(result.rows as unknown as UsageFeedbackRow[], {
    lookbackDays: options.lookbackDays,
    minimumShown: options.minimumShown,
    limit: options.limit,
  });
}

export function summarizeUsageFeedback(
  rows: UsageFeedbackRow[],
  options: { lookbackDays: number; minimumShown: number; limit?: number }
): UsageFeedbackReport {
  const grouped = new Map<string, UsageFeedbackItem>();

  for (const row of rows) {
    const key = `${row.meme_source}:${row.meme_id}`;
    const item = grouped.get(key) || {
      meme_id: row.meme_id,
      meme_name: row.meme_name,
      meme_source: row.meme_source,
      shown: 0,
      clicked: 0,
      used: 0,
      saved: 0,
      dismissed: 0,
      click_through_rate: 0,
      use_rate: 0,
      save_rate: 0,
      dismissal_rate: 0,
      quality_signal: "insufficient_data",
    };

    const count = Number(row.events) || 0;
    if (row.action === "suggested" || row.action === "shown") item.shown += count;
    else if (row.action === "clicked") item.clicked += count;
    else if (row.action === "used" || row.action === "inserted") item.used += count;
    else if (row.action === "saved") item.saved += count;
    else if (row.action === "dismissed") item.dismissed += count;
    grouped.set(key, item);
  }

  const items = Array.from(grouped.values()).map((item) => {
    const shown = Math.max(1, item.shown);
    item.click_through_rate = round(item.clicked / shown);
    item.use_rate = round(item.used / shown);
    item.save_rate = round(item.saved / shown);
    item.dismissal_rate = round(item.dismissed / shown);
    item.quality_signal = classifyQualitySignal(item, options.minimumShown);
    return item;
  });

  items.sort((a, b) => {
    const signalScore = signalRank(b.quality_signal) - signalRank(a.quality_signal);
    if (signalScore !== 0) return signalScore;
    return b.use_rate - a.use_rate || b.click_through_rate - a.click_through_rate || b.shown - a.shown;
  });

  const limitedItems = options.limit && options.limit > 0 ? items.slice(0, options.limit) : items;

  return {
    generated_at: new Date().toISOString(),
    lookback_days: options.lookbackDays,
    minimum_shown: options.minimumShown,
    summary: {
      memes: items.length,
      shown: sum(items, "shown"),
      clicked: sum(items, "clicked"),
      used: sum(items, "used"),
      saved: sum(items, "saved"),
      dismissed: sum(items, "dismissed"),
      promote_candidates: items.filter((item) => item.quality_signal === "promote").length,
      review_candidates: items.filter((item) => item.quality_signal === "review").length,
    },
    items: limitedItems,
  };
}

function classifyQualitySignal(
  item: UsageFeedbackItem,
  minimumShown: number
): UsageFeedbackItem["quality_signal"] {
  if (item.shown < minimumShown) return "insufficient_data";
  if (item.use_rate >= 0.18 || item.save_rate >= 0.08 || item.click_through_rate >= 0.35) {
    return "promote";
  }
  if (item.dismissal_rate >= 0.72 && item.click_through_rate <= 0.08 && item.use_rate <= 0.03) {
    return "review";
  }
  return "watch";
}

function signalRank(signal: UsageFeedbackItem["quality_signal"]): number {
  if (signal === "promote") return 4;
  if (signal === "review") return 3;
  if (signal === "watch") return 2;
  return 1;
}

function sum(items: UsageFeedbackItem[], key: keyof Pick<UsageFeedbackItem, "shown" | "clicked" | "used" | "saved" | "dismissed">): number {
  return items.reduce((total, item) => total + item[key], 0);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
