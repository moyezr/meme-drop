import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { generateEmbedding } from "./embedding.js";
import { db } from "../db/index.js";
import { sql } from "drizzle-orm";

const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

const tweetContextSchema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  tone: z.enum([
    "sarcastic",
    "earnest",
    "rant",
    "celebratory",
    "hot-take",
    "question",
  ]),
  topic: z.enum([
    "tech",
    "finance",
    "politics",
    "sports",
    "entertainment",
    "personal",
    "culture",
  ]),
  intent: z.enum([
    "counter-argument",
    "agreement",
    "sharing-opinion",
    "venting",
    "asking",
  ]),
  intensity: z.number().min(0).max(1),
  reply_style: z
    .string()
    .describe(
      "Brief description of the ideal meme reply style, e.g. 'sarcastic agreement' or 'exaggerated disappointment'"
    ),
});

export interface SuggestionResult {
  meme_id: string;
  name: string;
  image_url: string;
  use_case_label: string;
  match_explanation: string;
  score: number;
  source: "user" | "global";
}

export async function getSuggestions(
  tweetText: string
): Promise<SuggestionResult[]> {
  // 1. Analyze tweet context with gpt-4o-mini
  const { object: context } = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: tweetContextSchema,
    prompt: `Analyze this tweet and classify its context for meme reply matching:\n\n"${tweetText}"`,
    temperature: 0.2,
  });

  console.log("[MemeDrop] Tweet context:", context);

  // 2. Generate embedding from context
  const embeddingText = [
    context.sentiment,
    context.tone,
    context.topic,
    context.intent,
    context.reply_style,
  ].join(" ");
  const embedding = await generateEmbedding(embeddingText);

  const embeddingStr = `[${embedding.join(",")}]`;

  // 3. Query user memes via pgvector cosine similarity
  const userResults = await db.execute(sql`
    SELECT
      id,
      user_name as name,
      file_path,
      system_tags,
      use_count,
      last_used_at,
      1 - (embedding <=> ${embeddingStr}::vector) as similarity
    FROM user_memes
    WHERE user_id = ${DEV_USER_ID}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT 10
  `);

  // 4. Query global seed memes
  const globalResults = await db.execute(sql`
    SELECT
      id,
      name,
      file_path,
      system_tags,
      1 - (embedding <=> ${embeddingStr}::vector) as similarity
    FROM memes
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT 10
  `);

  // 5. Combine and score results
  const now = Date.now();
  const fortyEightHours = 48 * 60 * 60 * 1000;
  const candidates: SuggestionResult[] = [];

  for (const row of userResults.rows) {
    const similarity = Number(row.similarity) || 0;
    const lastUsed = row.last_used_at
      ? new Date(row.last_used_at as string).getTime()
      : 0;
    const recentlyUsed = lastUsed > 0 && now - lastUsed < fortyEightHours;

    // Scoring: 80% context match, -20% recency penalty
    let score = similarity * 0.8;
    if (recentlyUsed) score -= 0.2;

    const systemTags = row.system_tags as Record<string, unknown> | null;
    const useCases = (systemTags?.use_cases as string[]) || [];

    candidates.push({
      meme_id: row.id as string,
      name: row.name as string,
      image_url: row.file_path as string,
      use_case_label: useCases[0] || "reaction",
      match_explanation: `${Math.round(similarity * 100)}% context match`,
      score,
      source: "user",
    });
  }

  for (const row of globalResults.rows) {
    const similarity = Number(row.similarity) || 0;
    const score = similarity * 0.8;

    const systemTags = row.system_tags as Record<string, unknown> | null;
    const useCases = (systemTags?.use_cases as string[]) || [];

    candidates.push({
      meme_id: row.id as string,
      name: row.name as string,
      image_url: row.file_path as string,
      use_case_label: useCases[0] || "reaction",
      match_explanation: `${Math.round(similarity * 100)}% context match`,
      score,
      source: "global",
    });
  }

  // Deduplicate by meme_id, keeping highest score
  const seen = new Map<string, SuggestionResult>();
  for (const c of candidates) {
    const existing = seen.get(c.meme_id);
    if (!existing || c.score > existing.score) {
      seen.set(c.meme_id, c);
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}
