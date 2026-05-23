import fs from "node:fs";
import path from "node:path";
import { generateObject } from "ai";
import { z } from "zod";
import { openrouter, QWEN_PLUS_MODEL } from "./llm-provider.js";

const schema = z.object({
  name: z
    .string()
    .describe(
      "Short recognizable name. If this is a known meme template, use its canonical name (e.g. 'Drake Hotline Bling'). Otherwise coin a short descriptive one."
    ),
  emotion: z.enum([
    "sarcastic",
    "absurdist",
    "wholesome",
    "savage",
    "confused",
    "celebratory",
  ]),
  format_type: z.enum(["reaction_image", "text_overlay"]),
  use_cases: z
    .array(z.string())
    .min(2)
    .max(4)
    .describe(
      "2-4 use-case labels, e.g. counter_argument, agreement, self_deprecation, dunking, relatability, confusion, celebration, disappointment, excitement, frustration, cope, hot_take."
    ),
  example_contexts: z
    .array(z.string())
    .min(2)
    .max(4)
    .describe(
      "2-4 short example tweet contexts where this meme would be a perfect reply."
    ),
  vibes: z
    .array(z.string())
    .min(1)
    .max(4)
    .describe(
      "1-4 short vibe phrases describing the comedic feel, e.g. 'calm amid chaos', 'smug dunk', 'mock shock'. Think meme culture, not corporate."
    ),
  is_evergreen: z.boolean(),
});

export type AutoTagResult = z.infer<typeof schema>;

export async function autoTagMeme(imagePath: string): Promise<AutoTagResult> {
  const absolutePath = path.isAbsolute(imagePath)
    ? imagePath
    : path.resolve(imagePath);
  const imageBuffer = fs.readFileSync(absolutePath);
  const base64Image = imageBuffer.toString("base64");

  const ext = path.extname(imagePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  const mimeType = mimeMap[ext] || "image/jpeg";

  try {
    const { object } = await generateObject({
      model: openrouter.chat(QWEN_PLUS_MODEL),
      schema,
      temperature: 0.3,
      maxOutputTokens: 900,
      system: `You tag meme images for a recommendation engine. Return JSON only. Lean into meme culture: 'smug dunk', 'panik arc', 'calm cope' are better vibe phrases than 'happy' or 'angry'. Use canonical template names when you recognize them.`,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: `data:${mimeType};base64,${base64Image}`,
            },
            {
              type: "text",
              text: "Tag this meme image. Think about when a person would actually reach for it as a reply on X.",
            },
          ],
        },
      ],
    });

    return object;
  } catch (err) {
    console.error("[MemeDrop] Auto-tagger failed:", err);
    return {
      name: "Unnamed Meme",
      emotion: "confused",
      format_type: "reaction_image",
      use_cases: ["reaction", "relatability"],
      example_contexts: ["Generic meme reaction"],
      vibes: ["unknown vibe"],
      is_evergreen: false,
    };
  }
}
