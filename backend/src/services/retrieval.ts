import { db } from "../db/index.js";
import { sql } from "drizzle-orm";

export interface Candidate {
  meme_id: string;
  source: "user" | "global";
  name: string;
  image_url: string;
  format_type: "reaction_image" | "text_overlay" | string;
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
  source?: "all" | "user" | "global";
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
  source = "all",
}: RetrieveArgs): Promise<Candidate[]> {
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const userResults =
    source === "global"
      ? { rows: [] }
      : await db.execute(sql`
          SELECT
            user_memes.id,
            user_memes.user_name AS name,
            user_memes.file_path,
            COALESCE(m.format_type, 'text_overlay') AS format_type,
            user_memes.system_tags,
            user_memes.use_count,
            user_memes.last_used_at,
            user_memes.embedding,
            1 - (user_memes.embedding <=> ${embeddingStr}::vector) AS similarity
          FROM user_memes
          LEFT JOIN memes m ON user_memes.global_meme_id = m.id
          WHERE user_id = ${userId}
            AND user_memes.embedding IS NOT NULL
          ORDER BY user_memes.embedding <=> ${embeddingStr}::vector
          LIMIT ${userLimit}
        `);

  const globalResults =
    source === "user"
      ? { rows: [] }
      : await db.execute(sql`
          SELECT
            id,
            name,
            file_path,
            format_type,
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
      format_type: (row.format_type as string) || "text_overlay",
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
      format_type: (row.format_type as string) || "reaction_image",
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

/**
 * Cheap fallback used when embeddings are slow/unavailable. It keeps the app
 * responsive in local dev and still returns sensible memes based on recency,
 * user ownership, evergreen status, and tag overlap scored in application code.
 */
export async function retrieveFallbackCandidates({
  userId,
  userLimit,
  globalLimit,
  source = "all",
}: Omit<RetrieveArgs, "queryEmbedding">): Promise<Candidate[]> {
  const userResults =
    source === "global"
      ? { rows: [] }
      : await db.execute(sql`
          SELECT
            user_memes.id,
            user_memes.user_name AS name,
            user_memes.file_path,
            COALESCE(m.format_type, 'text_overlay') AS format_type,
            user_memes.system_tags,
            user_memes.use_count,
            user_memes.last_used_at,
            user_memes.embedding
          FROM user_memes
          LEFT JOIN memes m ON user_memes.global_meme_id = m.id
          WHERE user_id = ${userId}
          ORDER BY
            user_memes.last_used_at DESC NULLS LAST,
            user_memes.use_count DESC,
            user_memes.created_at DESC
          LIMIT ${userLimit}
        `);

  const globalResults =
    source === "user"
      ? { rows: [] }
      : await db.execute(sql`
          SELECT
            id,
            name,
            file_path,
            format_type,
            system_tags,
            is_evergreen,
            embedding
          FROM memes
          ORDER BY
            is_evergreen DESC,
            created_at DESC
          LIMIT ${globalLimit}
        `);

  const parseEmbedding = (raw: unknown): number[] => {
    if (Array.isArray(raw)) return raw.map(Number);
    if (typeof raw === "string") {
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
      format_type: (row.format_type as string) || "text_overlay",
      system_tags: (row.system_tags as Candidate["system_tags"]) || {},
      embedding: parseEmbedding(row.embedding),
      similarity: 0.5,
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
      format_type: (row.format_type as string) || "reaction_image",
      system_tags: (row.system_tags as Candidate["system_tags"]) || {},
      embedding: parseEmbedding(row.embedding),
      similarity: 0.45,
      use_count: 0,
      last_used_at: null,
      is_evergreen: Boolean(row.is_evergreen),
    });
  }

  return candidates;
}
