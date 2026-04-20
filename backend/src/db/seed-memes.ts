import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { db } from "./index.js";
import { memes, users } from "./schema.js";
import { generateEmbedding } from "../services/embedding.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_PATH =
  process.env.MEME_STORAGE_PATH ||
  path.join(__dirname, "..", "..", "data", "memes");
const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

fs.mkdirSync(STORAGE_PATH, { recursive: true });

/**
 * 50 curated seed memes with pre-defined tags.
 * Images are not downloaded from URLs — instead we insert metadata-only records
 * and generate placeholder images so the system works without external downloads.
 */
const SEED_MEMES = [
  { name: "Drake Pointing", emotion: "sarcastic", format_type: "reaction_image", use_cases: ["counter_argument", "agreement"], example_contexts: ["When someone suggests a bad solution vs. the obvious one", "Comparing two approaches to a problem"], is_evergreen: true },
  { name: "This Is Fine", emotion: "absurdist", format_type: "reaction_image", use_cases: ["self_deprecation", "relatability"], example_contexts: ["When everything is on fire at work but you pretend it's okay", "Monday morning standup when prod is down"], is_evergreen: true },
  { name: "Distracted Boyfriend", emotion: "sarcastic", format_type: "reaction_image", use_cases: ["relatability", "counter_argument"], example_contexts: ["When you see a new framework and abandon your current project", "Being tempted by a new tech stack"], is_evergreen: true },
  { name: "Surprised Pikachu", emotion: "sarcastic", format_type: "reaction_image", use_cases: ["dunking", "confusion"], example_contexts: ["When the obvious consequence happens and people are shocked", "When code without tests breaks in production"], is_evergreen: true },
  { name: "Expanding Brain", emotion: "sarcastic", format_type: "text_overlay", use_cases: ["dunking", "counter_argument"], example_contexts: ["Increasingly ridiculous solutions to simple problems", "Levels of overcomplicated approaches"], is_evergreen: true },
  { name: "Two Buttons", emotion: "confused", format_type: "reaction_image", use_cases: ["relatability", "confusion"], example_contexts: ["When you have to choose between two equally bad options", "Deciding between fixing tech debt or shipping features"], is_evergreen: true },
  { name: "Is This A Pigeon", emotion: "confused", format_type: "reaction_image", use_cases: ["confusion", "dunking"], example_contexts: ["When someone misidentifies something obvious", "When PM calls a bug a feature"], is_evergreen: true },
  { name: "Change My Mind", emotion: "sarcastic", format_type: "text_overlay", use_cases: ["counter_argument", "agreement"], example_contexts: ["Stating a controversial but true opinion", "Hot takes about programming languages"], is_evergreen: true },
  { name: "Always Has Been", emotion: "sarcastic", format_type: "text_overlay", use_cases: ["agreement", "dunking"], example_contexts: ["When someone realizes something that was always true", "Wait, it's all JavaScript?"], is_evergreen: true },
  { name: "Stonks", emotion: "absurdist", format_type: "reaction_image", use_cases: ["self_deprecation", "celebration"], example_contexts: ["When you make a terrible financial decision", "When your side project gets 1 star on GitHub"], is_evergreen: true },
  { name: "Not Stonks", emotion: "absurdist", format_type: "reaction_image", use_cases: ["self_deprecation", "disappointment"], example_contexts: ["When crypto crashes after you buy", "When your startup idea already exists"], is_evergreen: true },
  { name: "Sad Cat Thumbs Up", emotion: "wholesome", format_type: "reaction_image", use_cases: ["self_deprecation", "relatability"], example_contexts: ["When you're sad but pretend everything is fine", "Approving something while dying inside"], is_evergreen: true },
  { name: "Monkey Puppet", emotion: "confused", format_type: "reaction_image", use_cases: ["confusion", "self_deprecation"], example_contexts: ["When someone asks about the code you wrote 6 months ago", "When the interviewer asks about your side projects"], is_evergreen: true },
  { name: "Woman Yelling at Cat", emotion: "sarcastic", format_type: "reaction_image", use_cases: ["counter_argument", "dunking"], example_contexts: ["When someone accuses you of something you definitely did", "Developers vs. designers arguments"], is_evergreen: true },
  { name: "One Does Not Simply", emotion: "sarcastic", format_type: "text_overlay", use_cases: ["counter_argument", "relatability"], example_contexts: ["When someone thinks a complex task is easy", "One does not simply deploy on Friday"], is_evergreen: true },
  { name: "Flex Tape", emotion: "absurdist", format_type: "reaction_image", use_cases: ["self_deprecation", "relatability"], example_contexts: ["Quick fixes that barely hold together", "Hotfixing production with duct tape solutions"], is_evergreen: true },
  { name: "Spider-Man Pointing", emotion: "confused", format_type: "reaction_image", use_cases: ["confusion", "relatability"], example_contexts: ["When you find duplicate code that does the same thing", "When two teams are working on the same feature"], is_evergreen: true },
  { name: "Thinking Face", emotion: "sarcastic", format_type: "reaction_image", use_cases: ["counter_argument", "confusion"], example_contexts: ["When someone's logic doesn't add up", "Questioning a suspicious claim"], is_evergreen: true },
  { name: "Panik Kalm Panik", emotion: "absurdist", format_type: "text_overlay", use_cases: ["relatability", "self_deprecation"], example_contexts: ["Bug found -> It's in staging -> It's also in prod", "Deploy succeeds -> Tests pass -> Customer reports issue"], is_evergreen: true },
  { name: "Trade Offer", emotion: "sarcastic", format_type: "text_overlay", use_cases: ["counter_argument", "dunking"], example_contexts: ["Unfair exchanges or deals", "When a company offers exposure instead of payment"], is_evergreen: true },
  { name: "Gigachad", emotion: "celebratory", format_type: "reaction_image", use_cases: ["agreement", "celebration"], example_contexts: ["When someone does something impressively based", "Agreeing with a chad move"], is_evergreen: true },
  { name: "NPC Meme", emotion: "sarcastic", format_type: "reaction_image", use_cases: ["dunking", "counter_argument"], example_contexts: ["When someone repeats the same talking points", "Generic responses to complex issues"], is_evergreen: true },
  { name: "Tuxedo Pooh", emotion: "sarcastic", format_type: "reaction_image", use_cases: ["counter_argument", "agreement"], example_contexts: ["Fancy way of saying the same thing", "Regular vs. sophisticated version of a concept"], is_evergreen: true },
  { name: "Galaxy Brain", emotion: "sarcastic", format_type: "reaction_image", use_cases: ["dunking", "counter_argument"], example_contexts: ["Overthinking a simple problem", "When someone proposes an absurdly complex solution"], is_evergreen: true },
  { name: "Disaster Girl", emotion: "savage", format_type: "reaction_image", use_cases: ["dunking", "celebration"], example_contexts: ["When you cause chaos and enjoy it", "Watching your competition fail"], is_evergreen: true },
  { name: "Hide the Pain Harold", emotion: "wholesome", format_type: "reaction_image", use_cases: ["self_deprecation", "relatability"], example_contexts: ["Smiling through the pain of debugging", "When your code works but you don't know why"], is_evergreen: true },
  { name: "Math Lady", emotion: "confused", format_type: "reaction_image", use_cases: ["confusion", "relatability"], example_contexts: ["Trying to understand complex code", "Reading your own code from last year"], is_evergreen: true },
  { name: "Waiting Skeleton", emotion: "absurdist", format_type: "reaction_image", use_cases: ["self_deprecation", "frustration"], example_contexts: ["Waiting for CI/CD pipeline to finish", "Waiting for code review"], is_evergreen: true },
  { name: "First Time?", emotion: "sarcastic", format_type: "reaction_image", use_cases: ["dunking", "relatability"], example_contexts: ["When a newbie encounters a common problem", "Welcome to production debugging"], is_evergreen: true },
  { name: "Anakin Padme", emotion: "sarcastic", format_type: "text_overlay", use_cases: ["counter_argument", "dunking"], example_contexts: ["When someone makes a promise they can't keep", "For the better, right? ...Right?"], is_evergreen: true },
  { name: "Gru's Plan", emotion: "absurdist", format_type: "text_overlay", use_cases: ["self_deprecation", "relatability"], example_contexts: ["When your plan has an obvious flaw you missed", "Planning a project then realizing the scope"], is_evergreen: true },
  { name: "They're The Same Picture", emotion: "sarcastic", format_type: "reaction_image", use_cases: ["dunking", "counter_argument"], example_contexts: ["When two supposedly different things are identical", "Corporate wants you to find the difference"], is_evergreen: true },
  { name: "Fine I'll Do It Myself", emotion: "savage", format_type: "reaction_image", use_cases: ["frustration", "self_deprecation"], example_contexts: ["When nobody fixes the bug so you do it", "Taking matters into your own hands"], is_evergreen: true },
  { name: "Parkour", emotion: "absurdist", format_type: "reaction_image", use_cases: ["self_deprecation", "relatability"], example_contexts: ["Jumping between random topics or solutions", "Rapid context switching at work"], is_evergreen: true },
  { name: "Doge", emotion: "wholesome", format_type: "reaction_image", use_cases: ["agreement", "celebration"], example_contexts: ["Much wow, very impress", "Simple appreciation of something good"], is_evergreen: true },
  { name: "Pepe Sad", emotion: "wholesome", format_type: "reaction_image", use_cases: ["self_deprecation", "relatability"], example_contexts: ["When something mildly disappointing happens", "TFW your PR gets rejected"], is_evergreen: true },
  { name: "Crying Jordan", emotion: "savage", format_type: "reaction_image", use_cases: ["dunking", "self_deprecation"], example_contexts: ["When someone or something fails spectacularly", "After losing at something competitive"], is_evergreen: true },
  { name: "Vince McMahon Reaction", emotion: "celebratory", format_type: "reaction_image", use_cases: ["excitement", "celebration"], example_contexts: ["Progressively more exciting news", "Each new feature announcement gets better"], is_evergreen: true },
  { name: "Roll Safe", emotion: "sarcastic", format_type: "text_overlay", use_cases: ["counter_argument", "dunking"], example_contexts: ["Can't have bugs if you don't write tests", "Pointing out flawed logic with a smirk"], is_evergreen: true },
  { name: "Sweating Guy", emotion: "confused", format_type: "reaction_image", use_cases: ["confusion", "self_deprecation"], example_contexts: ["When you need to make a tough decision under pressure", "Choosing between two database options"], is_evergreen: true },
  { name: "Mr. Incredible Uncanny", emotion: "absurdist", format_type: "reaction_image", use_cases: ["relatability", "self_deprecation"], example_contexts: ["When things go from bad to worse", "Progressive stages of project deterioration"], is_evergreen: true },
  { name: "Wojak Crying", emotion: "wholesome", format_type: "reaction_image", use_cases: ["self_deprecation", "relatability"], example_contexts: ["Behind the keyboard crying", "When your favorite tool gets deprecated"], is_evergreen: true },
  { name: "Understandable Have A Nice Day", emotion: "wholesome", format_type: "reaction_image", use_cases: ["agreement", "relatability"], example_contexts: ["When you accept something with grace", "When the explanation is fair enough"], is_evergreen: true },
  { name: "Shut Up And Take My Money", emotion: "celebratory", format_type: "reaction_image", use_cases: ["excitement", "agreement"], example_contexts: ["When a product is exactly what you need", "Instant buy reaction to something cool"], is_evergreen: true },
  { name: "Confused Nick Young", emotion: "confused", format_type: "reaction_image", use_cases: ["confusion", "counter_argument"], example_contexts: ["When something makes absolutely no sense", "Reading confusing documentation"], is_evergreen: true },
  { name: "Boardroom Meeting", emotion: "sarcastic", format_type: "text_overlay", use_cases: ["counter_argument", "dunking"], example_contexts: ["When someone suggests the obvious solution and gets thrown out", "Meeting where the right answer is rejected"], is_evergreen: true },
  { name: "I Am Speed", emotion: "celebratory", format_type: "reaction_image", use_cases: ["celebration", "self_deprecation"], example_contexts: ["When you finish a task way faster than expected", "Speedrunning a deadline"], is_evergreen: true },
  { name: "Thomas Had Never Seen", emotion: "confused", format_type: "text_overlay", use_cases: ["confusion", "dunking"], example_contexts: ["When you encounter something truly baffling", "Thomas had never seen such BS before"], is_evergreen: true },
  { name: "Haha Yes", emotion: "absurdist", format_type: "reaction_image", use_cases: ["agreement", "self_deprecation"], example_contexts: ["Laughing at your own pain", "Agreeing with something absurd"], is_evergreen: true },
  { name: "Ight Imma Head Out", emotion: "savage", format_type: "reaction_image", use_cases: ["frustration", "self_deprecation"], example_contexts: ["When a meeting goes sideways", "When someone starts a framework debate"], is_evergreen: true },
];

function createPlaceholderImage(name: string): Buffer {
  // Create a simple SVG placeholder that can be served as an image
  const colors = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7",
    "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9",
  ];
  const color = colors[Math.abs(hashCode(name)) % colors.length];
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <rect width="400" height="400" fill="${color}" rx="8"/>
    <text x="200" y="180" text-anchor="middle" font-family="Arial, sans-serif" font-size="72" font-weight="bold" fill="white">${initials}</text>
    <text x="200" y="240" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="white" opacity="0.8">${escapeXml(name)}</text>
    <text x="200" y="340" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" fill="white" opacity="0.5">MemeDrop Seed</text>
  </svg>`;

  return Buffer.from(svg);
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function seedMemes() {
  console.log("[MemeDrop] Starting meme seed...");

  // Ensure dev user exists
  await db
    .insert(users)
    .values({ id: DEV_USER_ID, email: "dev@memedrop.local" })
    .onConflictDoNothing();

  let inserted = 0;
  let skipped = 0;

  for (const meme of SEED_MEMES) {
    try {
      // Create placeholder image
      const fileName = `seed-${randomUUID()}.svg`;
      const filePath = path.join(STORAGE_PATH, fileName);
      const imageData = createPlaceholderImage(meme.name);
      fs.writeFileSync(filePath, imageData);

      // Generate embedding from name + use cases + example contexts
      const embeddingText = [
        meme.name,
        ...meme.use_cases,
        ...meme.example_contexts,
      ].join(" ");
      const embedding = await generateEmbedding(embeddingText);

      // Insert into memes table
      await db
        .insert(memes)
        .values({
          name: meme.name,
          filePath: `/memes/${fileName}`,
          formatType: meme.format_type,
          isEvergreen: meme.is_evergreen,
          systemTags: {
            emotion: meme.emotion,
            use_cases: meme.use_cases,
            example_contexts: meme.example_contexts,
          },
          embedding,
        })
        .onConflictDoNothing();

      inserted++;
      console.log(`  [${inserted}/${SEED_MEMES.length}] ${meme.name}`);
    } catch (err) {
      console.error(`  Failed to seed "${meme.name}":`, err);
      skipped++;
    }
  }

  console.log(
    `\n[MemeDrop] Seed complete: ${inserted} inserted, ${skipped} skipped`
  );
  process.exit(0);
}

seedMemes().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
