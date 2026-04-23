/**
 * Maximal Marginal Relevance (MMR) — classic retrieval trick to avoid
 * returning 5 near-duplicate results.
 *
 *   next = argmax[ λ * relevance(c) - (1-λ) * max similarity(c, already_picked) ]
 *
 * λ=1 is pure relevance, λ=0 is pure diversity. We use λ≈0.7 so the top
 * picks still lead with relevance but we avoid a strip of five "This Is
 * Fine"-adjacent memes.
 */

interface MmrItem {
  id: string;
  score: number;
  embedding: number[];
}

export function mmrSelect<T extends MmrItem>(
  items: T[],
  k: number,
  lambda: number = 0.7
): T[] {
  if (items.length <= k) return [...items];

  const remaining = [...items];
  const picked: T[] = [];

  // Seed with the highest-score item.
  remaining.sort((a, b) => b.score - a.score);
  picked.push(remaining.shift()!);

  while (picked.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestMmr = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];

      // Max similarity to anything already picked.
      let maxSim = 0;
      for (const p of picked) {
        const s = cosineSimilarity(cand.embedding, p.embedding);
        if (s > maxSim) maxSim = s;
      }

      const mmr = lambda * cand.score - (1 - lambda) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }

    picked.push(remaining.splice(bestIdx, 1)[0]);
  }

  return picked;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
