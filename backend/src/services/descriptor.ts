/**
 * Meme descriptor = the natural-language paragraph we embed.
 *
 * Embedding a bag of keywords ("sarcastic agreement dunking") produces noisy
 * vectors. Embedding a short paragraph that *describes* the meme's vibe
 * (who'd reach for it and when) makes seed-time embeddings useful for search
 * and admin tooling.
 */

interface MemeDescriptorInput {
  name: string;
  emotion: string;
  format_type: string;
  use_cases: string[];
  example_contexts: string[];
  vibes?: string[];
}

export function buildMemeDescriptor(m: MemeDescriptorInput): string {
  const useCases = m.use_cases.join(", ").replace(/_/g, " ");
  const vibes = (m.vibes || []).join(", ");
  const examples = m.example_contexts
    .map((c) => `- ${c}`)
    .join("\n");

  return [
    `${m.name} is a ${m.emotion} ${m.format_type.replace(/_/g, " ")} meme.`,
    vibes ? `Vibe: ${vibes}.` : "",
    useCases ? `Use it for: ${useCases}.` : "",
    examples ? `Perfect when:\n${examples}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
