import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MemeTemplateManifest } from "@memedrop/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..", "..");
const manifestPath = path.join(
  rootDir,
  "packages",
  "shared",
  "src",
  "data",
  "meme-template-manifest.generated.json"
);

interface Fix {
  template_id: string;
  region_id: string;
  max_chars: number;
  before: string;
  after: string;
}

const CURATED_EXAMPLES = new Map<string, string>([
  ["anakin-padme-4-panel:top_left_setup:0", "Me: one more task"],
  ["anakin-padme-4-panel:bottom_right_conclusion:1", "Also me: overwhelmed"],
  ["bernie-i-am-once-again-asking-for-your-support:top_caption:0", "Group project begins"],
  ["bernie-i-am-once-again-asking-for-your-support:bottom_caption:1", "Once again asking for help"],
  ["boardroom-meeting-suggestion:top_speaker:0", "Listen to users"],
  ["boardroom-meeting-suggestion:middle_right_speaker:1", "Delete bad reviews"],
  ["buff-doge-vs-cheems:buff_doge_label:0", "One workout"],
  ["charlie-conspiracy-always-sunny-in-philidelphia:bottom_left_reveal:1", "THEY PLANNED MY PARTY"],
  ["clown-applying-makeup:bottom_caption:1", "Me after one tiny fix"],
  ["disaster-girl:top_caption:0", "Group project collapses"],
  ["disaster-girl:bottom_caption:1", "I sent the wrong file"],
  ["drake-hotline-bling:approve:1", "sending an email"],
  ["epic-handshake:left_side_label:0", "Meeting haters"],
  ["epic-handshake:right_side_label:1", "Meeting lovers"],
  ["evil-kermit:evil_kermit:1", "Watch one more episode"],
  ["finding-neverland:top_reaction:0", "GROUP CHAT GOES SILENT"],
  ["finding-neverland:bottom_punchline:1", "HE BROUGHT SNACKS"],
  ["grim-reaper-knocking-door:top_caption:0", "Landlord wants to talk"],
  ["grim-reaper-knocking-door:bottom_caption:1", "Me after 3 missed rents"],
  ["gru-s-plan:top_left:0", "Check one thing"],
  ["gru-s-plan:bottom_right:1", "Still scrolling"],
  ["gus-fring-we-are-not-the-same:top_statement:0", "ME: I'M ORGANIZED"],
  ["hide-the-pain-harold:bottom_caption:0", "Then comes one quick question"],
  ["hide-the-pain-harold:bottom_caption:1", "After opening that email"],
  ["is-this-a-pigeon:top_caption:0", "I found a rare butterfly"],
  ["one-does-not-simply:top_statement:0", "Assignment says submit online"],
  ["one-does-not-simply:bottom_statement:0", "Website requires account"],
  ["pawn-stars-best-i-can-do:right_reaction:1", "Best I can do is $5"],
  ["roll-safe-think-about-it:thought_caption:0", "No email, no new work"],
  ["running-away-balloon:bottom_interference:1", "EVERY DISTRACTION POSSIBLE"],
  ["squidward-window:top_reaction_caption:0", "Party starts next door"],
  ["squidward-window:right_window_caption:1", "neighbors being loud"],
  ["they-don-t-know:top_left_observer:0", "Group chat about to pop"],
  ["they-don-t-know:right_couple:1", "Everyone acting normal"],
  ["trade-offer:you_receive:0", "loyalty"],
  ["two-buttons:reaction_caption:1", "Hardest decision of my life"],
  ["woman-yelling-at-cat:woman_yelling:0", "ME EXPLAINING WHY IT'S WRONG"],
]);

function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as MemeTemplateManifest;
  const fixes: Fix[] = [];

  for (const template of manifest.templates) {
    const regions = new Map(template.regions.map((region) => [region.id, region]));
    for (const [exampleIndex, example] of template.caption_guidance.good_examples.entries()) {
      for (const [regionId, rawText] of Object.entries(example)) {
        const region = regions.get(regionId);
        if (!region) continue;

        const text = String(rawText);
        const curated = CURATED_EXAMPLES.get(`${template.template_id}:${regionId}:${exampleIndex}`);
        if (curated) {
          example[regionId] = curated;
          if (curated !== text) {
            fixes.push({
              template_id: template.template_id,
              region_id: regionId,
              max_chars: region.max_chars,
              before: text,
              after: curated,
            });
          }
          continue;
        }

        if (text.length <= region.max_chars) continue;

        const shortened = shortenExample(text, region.max_chars);
        example[regionId] = shortened;
        fixes.push({
          template_id: template.template_id,
          region_id: regionId,
          max_chars: region.max_chars,
          before: text,
          after: shortened,
        });
      }
    }
  }

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Fixed ${fixes.length} generated manifest examples.`);
  for (const fix of fixes) {
    console.log(
      `${fix.template_id}:${fix.region_id} ${fix.before.length}->${fix.after.length}/${fix.max_chars} "${fix.after}"`
    );
  }
}

function shortenExample(input: string, maxChars: number): string {
  let text = input
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();

  const replacements: Array<[RegExp, string]> = [
    [/\bminutes\b/gi, "min"],
    [/\bbecause\b/gi, "bc"],
    [/\bwithout\b/gi, "w/o"],
    [/\bwith\b/gi, "w/"],
    [/\bpeople\b/gi, "ppl"],
    [/\beveryone\b/gi, "everyone"],
    [/\bcompletely\b/gi, "fully"],
    [/\bimmediately\b/gi, "instantly"],
    [/\bpresentation\b/gi, "deck"],
    [/\bresponsible\b/gi, "adult"],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement).replace(/\s+/g, " ").trim();
    if (text.length <= maxChars) return text;
  }

  text = text
    .replace(/\b(I am|I'm|When|and then|and it's|that|this|the|a|an)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxChars) return text;

  const words = text.split(" ");
  let result = "";
  for (const word of words) {
    const next = result ? `${result} ${word}` : word;
    if (next.length > maxChars) break;
    result = next;
  }

  if (result) return result;
  return text.slice(0, maxChars).trim();
}

main();
