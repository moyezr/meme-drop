import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface AutoTagResult {
  name: string;
  emotion: string;
  format_type: string;
  use_cases: string[];
  example_contexts: string[];
  is_evergreen: boolean;
}

export async function autoTagMeme(imagePath: string): Promise<AutoTagResult> {
  // Read image as base64
  const absolutePath = path.isAbsolute(imagePath)
    ? imagePath
    : path.resolve(imagePath);
  const imageBuffer = fs.readFileSync(absolutePath);
  const base64Image = imageBuffer.toString("base64");

  // Determine mime type from extension
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
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a meme analysis expert. Analyze the given meme image and return a JSON object with these fields:
- name: A short recognizable name for this meme (e.g., "Drake Pointing", "This Is Fine", "Distracted Boyfriend")
- emotion: One of: sarcastic, absurdist, wholesome, savage, confused, celebratory
- format_type: One of: reaction_image, text_overlay
- use_cases: Array of 2-4 use case labels from: counter_argument, agreement, self_deprecation, dunking, relatability, confusion, celebration, disappointment, excitement, frustration
- example_contexts: Array of 2-3 example tweet contexts where this meme would be a perfect reply (e.g., "When someone says they'll fix a bug and introduces 3 more")
- is_evergreen: boolean - true if this meme is timeless, false if it's tied to a specific trend

Return ONLY valid JSON, no markdown fences or explanation.`,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
            {
              type: "text",
              text: "Analyze this meme image and return the structured JSON.",
            },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      console.warn("[MemeDrop] Empty response from GPT-4o Vision, using defaults");
      return fallbackTags();
    }

    // Strip markdown fences if present
    const cleaned = content.replace(/^```json?\n?/i, "").replace(/\n?```$/i, "");
    const parsed = JSON.parse(cleaned) as AutoTagResult;

    return {
      name: parsed.name || "Unnamed Meme",
      emotion: parsed.emotion || "confused",
      format_type: parsed.format_type || "reaction_image",
      use_cases: Array.isArray(parsed.use_cases) ? parsed.use_cases : [],
      example_contexts: Array.isArray(parsed.example_contexts)
        ? parsed.example_contexts
        : [],
      is_evergreen: parsed.is_evergreen ?? true,
    };
  } catch (err) {
    console.error("[MemeDrop] Auto-tagger failed:", err);
    return fallbackTags();
  }
}

function fallbackTags(): AutoTagResult {
  return {
    name: "Unnamed Meme",
    emotion: "confused",
    format_type: "reaction_image",
    use_cases: [],
    example_contexts: [],
    is_evergreen: false,
  };
}
