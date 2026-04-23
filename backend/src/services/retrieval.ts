import { db } from "../db/index.js";
import { sql } from "drizzle-orm";

export interface Candidate {
  meme_id: string;
  source: "user" | "global";
  name: string;
  image_url: string;
  system_tags: {
    emotion?: string;
    use_cases?: string[];
    example_contexts?: string[];
    vibes?: string[];
  };
  embedding: number[];
  similarity: number;
  use_count: number;
  last_used_at: string | null;
  is_evergreen: boolean;
}

interface RetrieveArgs {
  userId: string;
  queryEmbedding: number[];
  userLimit: number;
  globalLimit: number;
}

/**
 * Pull the top-K user memes and top-K global memes by cosine distance.
 * We fetch the embedding back because the re-rank and MMR stages both need
 * it — doing one query is cheaper than re-fetching later.
 */
export async function retrieveCandidates({
  userId,
  queryEmbedding,
  userLimit,
  globalLimit,
}: RetrieveArgs): Promise<Candidate[]> {
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const userResults = await db.execute(sql`
    SELECT
      id,
      user_name AS name,
      file_path,
      system_tags,
      use_count,
      last_used_at,
      embedding,
      1 - (embedding <=> ${embeddingStr}::vector) AS similarity
    FROM user_memes
    WHERE user_id = ${userId}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT ${userLimit}
  `);

  const globalResults = await db.execute(sql`
    SELECT
      id,
      name,
      file_path,
      system_tags,
      is_evergreen,
      embedding,
      1 - (embedding <=> ${embeddingStr}::vector) AS similarity
    FROM memes
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT ${globalLimit}
  `);

  const parseEmbedding = (raw: unknown): number[] => {
    if (Array.isArray(raw)) return raw.map(Number);
    if (typeof raw === "string") {
      // pgvector returns '[0.1,0.2,...]'
      const trimmed = raw.replace(/^\[|\]$/g, "");
      if (!trimmed) return [];
      return trimmed.split(",").map(Number);
    }
    return [];
  };

  const candidates: Candidate[] = [];

  for (const row of userResults.rows) {
    candidates.push({
      meme_id: row.id as string,
      source: "user",
      name: (row.name as string) || "Untitled",
      image_url: row.file_path as string,
      system_tags: (row.system_tags as Candidate["system_tags"]) || {},
      embedding: parseEmbedding(row.embedding),
      similarity: Number(row.similarity) || 0,
      use_count: Number(row.use_count) || 0,
      last_used_at: (row.last_used_at as string | null) ?? null,
      is_evergreen: true,
    });
  }

  for (const row of globalResults.rows) {
    candidates.push({
      meme_id: row.id as string,
      source: "global",
      name: (row.name as string) || "Untitled",
      image_url: row.file_path as string,
      system_tags: (row.system_tags as Candidate["system_tags"]) || {},
      embedding: parseEmbedding(row.embedding),
      similarity: Number(row.similarity) || 0,
      use_count: 0,
      last_used_at: null,
      is_evergreen: Boolean(row.is_evergreen),
    });
  }

  // Dedupe by meme_id, keep the one with higher similarity. Users who saved a
  // global meme will see it appear twice otherwise.
  const seen = new Map<string, Candidate>();
  for (const c of candidates) {
    const existing = seen.get(c.meme_id);
    if (!existing || c.similarity > existing.similarity) {
      seen.set(c.meme_id, c);
    }
  }
  return Array.from(seen.values());
}
