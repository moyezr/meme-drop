import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { db } from "./index.js";
import { memes, users } from "./schema.js";
import { generateEmbedding } from "../services/embedding.js";
import { buildMemeDescriptor } from "../services/descriptor.js";
import { sql } from "drizzle-orm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_PATH =
  process.env.MEME_STORAGE_PATH ||
  path.join(__dirname, "..", "..", "data", "memes");
const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

fs.mkdirSync(STORAGE_PATH, { recursive: true });

type SeedMeme = {
  imgflip_name: string;
  emotion: "sarcastic" | "absurdist" | "wholesome" | "savage" | "confused" | "celebratory";
  format_type: "reaction_image" | "text_overlay";
  use_cases: string[];
  example_contexts: string[];
  vibes: string[];
  is_evergreen: boolean;
};

/**
 * Curated metadata keyed by the exact imgflip API `name` field.
 * Images are downloaded from imgflip at seed time so every meme is real.
 */
const SEED_MEMES: SeedMeme[] = [
  {
    imgflip_name: "Drake Hotline Bling",
    emotion: "sarcastic",
    format_type: "reaction_image",
    use_cases: ["counter_argument", "preference", "dunking"],
    example_contexts: [
      "When someone suggests the bad option vs. the obviously correct one",
      "Contrasting a basic take with the galaxy-brain take",
      "Old stack bad, new stack good (or vice versa)",
    ],
    vibes: ["dismissing vs approving", "side-by-side preference", "gentle clowning"],
    is_evergreen: true,
  },
  {
    imgflip_name: "This Is Fine",
    emotion: "absurdist",
    format_type: "reaction_image",
    use_cases: ["self_deprecation", "relatability", "coping"],
    example_contexts: [
      "Everything is on fire at work but you pretend it's okay",
      "Prod is down and you're calmly sipping coffee",
      "Layoffs announced, you keep shipping features",
    ],
    vibes: ["denial through a smile", "calm amid chaos", "cope"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Distracted Boyfriend",
    emotion: "sarcastic",
    format_type: "reaction_image",
    use_cases: ["relatability", "calling_out_hype", "self_deprecation"],
    example_contexts: [
      "When a shiny new framework pulls you away from the project you just started",
      "Chasing trends instead of finishing what you have",
      "Abandoning fundamentals for the latest fad",
    ],
    vibes: ["fickle attention", "hype chasing", "FOMO"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Surprised Pikachu",
    emotion: "sarcastic",
    format_type: "reaction_image",
    use_cases: ["dunking", "mock_shock", "consequences"],
    example_contexts: [
      "When the predictable consequence happens and people are stunned",
      "Shipped untested code, it broke in prod — shocker",
      "Rug pulled, everyone's shocked",
    ],
    vibes: ["fake shock", "told-you-so", "consequences ignored"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Expanding Brain",
    emotion: "sarcastic",
    format_type: "text_overlay",
    use_cases: ["dunking", "levels_of_ridiculousness", "contrarianism"],
    example_contexts: [
      "Increasingly unhinged takes on the same basic idea",
      "Escalating levels of overengineering",
      "From common sense to galaxy-brain",
    ],
    vibes: ["escalating absurdity", "galaxy-brain energy"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Two Buttons",
    emotion: "confused",
    format_type: "reaction_image",
    use_cases: ["relatability", "impossible_choice", "indecision"],
    example_contexts: [
      "Sweating over a false dichotomy",
      "Ship it or fix it — both awful",
      "Two equally bad options",
    ],
    vibes: ["stressful decision", "sweating choice"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Is This A Pigeon",
    emotion: "confused",
    format_type: "reaction_image",
    use_cases: ["dunking", "misidentification", "calling_out_confusion"],
    example_contexts: [
      "When someone confidently labels the wrong thing",
      "Is this a senior engineer? (points at intern)",
      "Mislabeling a common tool as a fancy new paradigm",
    ],
    vibes: ["confident misidentification", "butterfly confusion"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Change My Mind",
    emotion: "sarcastic",
    format_type: "text_overlay",
    use_cases: ["hot_take", "contrarianism", "opinion"],
    example_contexts: [
      "Dropping a spicy opinion",
      "Tabs are superior to spaces. Change my mind.",
      "Stating a controversial truth",
    ],
    vibes: ["smug confidence", "hot take", "debate me"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Always Has Been",
    emotion: "sarcastic",
    format_type: "text_overlay",
    use_cases: ["dunking", "dark_realization", "agreement"],
    example_contexts: [
      "Wait, it's all JavaScript?",
      "Realizing the deep truth that was obvious all along",
      "Astronaut points gun: it's been this way forever",
    ],
    vibes: ["dark realization", "astronaut betrayal", "obvious truth"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Gru's Plan",
    emotion: "absurdist",
    format_type: "text_overlay",
    use_cases: ["self_deprecation", "plans_falling_apart"],
    example_contexts: [
      "Plan falls apart on the last step",
      "Realizing your grand scheme has a fatal flaw",
      "Big plans, smaller execution",
    ],
    vibes: ["plan backfiring", "cartoon villain denial"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Woman Yelling At Cat",
    emotion: "sarcastic",
    format_type: "reaction_image",
    use_cases: ["counter_argument", "dunking", "heated_debate"],
    example_contexts: [
      "Hysterical accusation vs. unbothered target",
      "Devs vs. designers arguments",
      "PM yelling about scope while engineer sits calm",
    ],
    vibes: ["heated vs unbothered", "argument asymmetry"],
    is_evergreen: true,
  },
  {
    imgflip_name: "One Does Not Simply",
    emotion: "sarcastic",
    format_type: "text_overlay",
    use_cases: ["counter_argument", "difficulty_warning"],
    example_contexts: [
      "One does not simply deploy on Friday",
      "When someone thinks a hard thing is trivial",
      "Warning people about an impossible ask",
    ],
    vibes: ["solemn warning", "Boromir wisdom"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Disaster Girl",
    emotion: "savage",
    format_type: "reaction_image",
    use_cases: ["dunking", "chaos_enjoyment", "celebration"],
    example_contexts: [
      "Smug smile while it all burns",
      "Watching a competitor implode",
      "Caused it, enjoying it",
    ],
    vibes: ["gleeful chaos", "smug arsonist"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Hide the Pain Harold",
    emotion: "wholesome",
    format_type: "reaction_image",
    use_cases: ["self_deprecation", "relatability", "suffering_in_silence"],
    example_contexts: [
      "Smiling through the bug hunt from hell",
      "Everything is fine (it's not)",
      "Pretending the PR review didn't hurt",
    ],
    vibes: ["suffering behind a smile", "polite agony"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Waiting Skeleton",
    emotion: "absurdist",
    format_type: "reaction_image",
    use_cases: ["self_deprecation", "long_wait", "frustration"],
    example_contexts: [
      "Still waiting on that code review",
      "Waiting for CI to finish",
      "Me waiting for a promised feature",
    ],
    vibes: ["eternal wait", "bones while waiting"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Anakin Padme 4 Panel",
    emotion: "sarcastic",
    format_type: "text_overlay",
    use_cases: ["counter_argument", "broken_promise", "dunking"],
    example_contexts: [
      "For the better, right? ...Right?",
      "Promise made, promise not kept, dread dawning",
      "Innocent hope meeting cold silence",
    ],
    vibes: ["dread of a broken promise", "silent betrayal"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Trade Offer",
    emotion: "sarcastic",
    format_type: "text_overlay",
    use_cases: ["dunking", "unfair_exchange", "calling_out"],
    example_contexts: [
      "I receive everything, you receive nothing",
      "Exposure instead of payment",
      "When a deal is absurdly one-sided",
    ],
    vibes: ["lopsided deal", "mock negotiation"],
    is_evergreen: true,
  },
  {
    imgflip_name: "They're The Same Picture",
    emotion: "sarcastic",
    format_type: "reaction_image",
    use_cases: ["dunking", "equivalence", "counter_argument"],
    example_contexts: [
      "Both options are identical, corporate",
      "These two things people pretend are different",
      "Claims to be unique, literally identical",
    ],
    vibes: ["fake distinction", "point-out equivalence"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Mocking Spongebob",
    emotion: "savage",
    format_type: "reaction_image",
    use_cases: ["dunking", "mocking_quote", "sarcasm"],
    example_contexts: [
      "Quoting someone in mOcKiNg CaSe",
      "Repeating a take while looking deranged",
      "Pure clowning on a dumb take",
    ],
    vibes: ["mocking repetition", "clowning"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Buff Doge vs. Cheems",
    emotion: "sarcastic",
    format_type: "reaction_image",
    use_cases: ["counter_argument", "generational_gap", "old_vs_new"],
    example_contexts: [
      "How it was vs. how it is",
      "Old-school dev vs. modern stack dev",
      "Built different (literally)",
    ],
    vibes: ["then vs now", "strength decline"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Epic Handshake",
    emotion: "wholesome",
    format_type: "reaction_image",
    use_cases: ["agreement", "common_ground", "unity"],
    example_contexts: [
      "Two sides agreeing on one thing",
      "Dev and ops agreeing to blame product",
      "Surprising overlap of opinions",
    ],
    vibes: ["solidarity moment", "rare agreement"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Tuxedo Winnie The Pooh",
    emotion: "sarcastic",
    format_type: "reaction_image",
    use_cases: ["same_thing_fancy", "agreement", "class_contrast"],
    example_contexts: [
      "Regular vs. sophisticated way of saying the same thing",
      "Fancy rephrase of a basic idea",
      "Casual take vs. PhD take",
    ],
    vibes: ["fancy vs basic", "same thing classier"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Left Exit 12 Off Ramp",
    emotion: "absurdist",
    format_type: "reaction_image",
    use_cases: ["preference_swerve", "avoidance"],
    example_contexts: [
      "Swerving hard away from the sensible option",
      "Rejecting the straight path for chaos",
      "Choosing the bad choice on purpose",
    ],
    vibes: ["violent swerve", "last-second choice"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Bernie I Am Once Again Asking For Your Support",
    emotion: "sarcastic",
    format_type: "text_overlay",
    use_cases: ["repeated_request", "asking_nicely"],
    example_contexts: [
      "Asking again for the thing you already asked for",
      "I am once again asking you to write tests",
      "Repeating yourself politely for the tenth time",
    ],
    vibes: ["polite repetition", "weary asking"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Running Away Balloon",
    emotion: "sarcastic",
    format_type: "text_overlay",
    use_cases: ["temptation", "distraction", "self_deprecation"],
    example_contexts: [
      "Trying to focus while a shiny distraction drifts by",
      "Chasing the dopamine away from the real task",
      "Running after a bad idea while the good one watches",
    ],
    vibes: ["losing to temptation", "chasing the balloon"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Sad Pablo Escobar",
    emotion: "wholesome",
    format_type: "reaction_image",
    use_cases: ["loneliness", "waiting", "self_deprecation"],
    example_contexts: [
      "Waiting for someone to reply",
      "Sitting alone with nothing to do",
      "When your PR has zero reviewers",
    ],
    vibes: ["melancholy waiting", "lonely swing"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Y'all Got Any More Of That",
    emotion: "absurdist",
    format_type: "reaction_image",
    use_cases: ["craving_more", "obsession", "agreement"],
    example_contexts: [
      "Y'all got any more of that good content",
      "Addicted to a trend",
      "Desperate for more of the same",
    ],
    vibes: ["addicted craving", "begging for more"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Batman Slapping Robin",
    emotion: "savage",
    format_type: "text_overlay",
    use_cases: ["interruption", "shutting_down", "dunking"],
    example_contexts: [
      "Interrupting a bad take mid-sentence",
      "Slapping down a dumb idea",
      "Shutting down someone's nonsense instantly",
    ],
    vibes: ["mid-sentence slap", "interrupting dumb take"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Boardroom Meeting Suggestion",
    emotion: "sarcastic",
    format_type: "text_overlay",
    use_cases: ["workplace_absurdity", "rejected_good_idea"],
    example_contexts: [
      "Reasonable suggestion made, immediately defenestrated",
      "Corporate rejects the obvious answer",
      "Good idea punished with a window exit",
    ],
    vibes: ["corporate absurdity", "defenestrated idea"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Roll Safe Think About It",
    emotion: "sarcastic",
    format_type: "text_overlay",
    use_cases: ["fake_wisdom", "dunking", "bad_logic"],
    example_contexts: [
      "Can't have bugs if you don't write tests",
      "Galaxy-brain terrible logic",
      "Smug tap-the-head nonsense",
    ],
    vibes: ["galaxy-brain bad logic", "tap the temple"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Evil Kermit",
    emotion: "sarcastic",
    format_type: "text_overlay",
    use_cases: ["bad_impulse", "temptation", "self_deprecation"],
    example_contexts: [
      "Me to me: just push to main",
      "The devil on your shoulder whispering chaos",
      "Bad idea you know you'll act on",
    ],
    vibes: ["evil whisper", "shoulder devil"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Panik Kalm Panik",
    emotion: "absurdist",
    format_type: "text_overlay",
    use_cases: ["rollercoaster", "self_deprecation", "relatability"],
    example_contexts: [
      "Bug found → it's in staging → also in prod",
      "Emotional whiplash in three steps",
      "Calm sandwiched between two panics",
    ],
    vibes: ["panic-calm-panic escalation", "three-stage rollercoaster"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Pawn Stars Best I Can Do",
    emotion: "sarcastic",
    format_type: "text_overlay",
    use_cases: ["lowball_offer", "negotiation", "dunking"],
    example_contexts: [
      "Best I can do is three fitty",
      "Lowballing a clearly valuable thing",
      "Insulting counter-offer",
    ],
    vibes: ["lowball offer", "insulting counter"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Squidward window",
    emotion: "wholesome",
    format_type: "reaction_image",
    use_cases: ["envy", "loneliness", "watching_from_outside"],
    example_contexts: [
      "Watching others have fun without you",
      "FOMO in pure form",
      "Peering through the blinds, miserable",
    ],
    vibes: ["lonely envy", "window FOMO"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Laughing Leo",
    emotion: "celebratory",
    format_type: "reaction_image",
    use_cases: ["agreement", "celebration", "knowing_laughter"],
    example_contexts: [
      "Pointing and laughing in agreement",
      "When someone nails the joke",
      "Celebrating a savage point",
    ],
    vibes: ["point and laugh", "chef's kiss"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Monkey Puppet",
    emotion: "confused",
    format_type: "reaction_image",
    use_cases: ["awkward_lookaway", "self_deprecation"],
    example_contexts: [
      "Awkward side-eye after saying something dumb",
      "When the question hits too close to home",
      "Quiet denial side-glance",
    ],
    vibes: ["awkward side-eye", "guilty glance"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Futurama Fry",
    emotion: "confused",
    format_type: "reaction_image",
    use_cases: ["suspicion", "squinting_doubt"],
    example_contexts: [
      "Not sure if serious or joking",
      "Squinting at a sus claim",
      "Can't tell if scam or legit offer",
    ],
    vibes: ["can't tell if", "squinting doubt"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Inhaling Seagull",
    emotion: "absurdist",
    format_type: "reaction_image",
    use_cases: ["screaming_agreement", "celebration", "excitement"],
    example_contexts: [
      "Deep breath before unhinged agreement",
      "Screaming your point loudly",
      "Loud, full-lung enthusiasm",
    ],
    vibes: ["wind-up scream", "loud agreement"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Flex Tape",
    emotion: "absurdist",
    format_type: "reaction_image",
    use_cases: ["duct_tape_fix", "quick_hack", "self_deprecation"],
    example_contexts: [
      "Hotfixing prod with prayers and tape",
      "Held together with duct tape",
      "Quick fix that shouldn't work but does",
    ],
    vibes: ["duct-tape fix", "flex-seal it"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Clown Applying Makeup",
    emotion: "savage",
    format_type: "text_overlay",
    use_cases: ["self_deprecation", "self_owning", "escalating_regret"],
    example_contexts: [
      "Slowly realizing you're the clown in the story",
      "Escalating self-owns",
      "Putting on the clown makeup step by step",
    ],
    vibes: ["becoming the clown", "self-own arc"],
    is_evergreen: true,
  },
  {
    imgflip_name: "They don't know",
    emotion: "wholesome",
    format_type: "text_overlay",
    use_cases: ["loner_at_party", "secret_knowledge", "relatability"],
    example_contexts: [
      "Sulking in the corner thinking about your side project",
      "Only one who knows the real truth",
      "They don't know I'm a 10x engineer",
    ],
    vibes: ["lonely knowing", "corner-of-the-party thoughts"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Spider Man Triple",
    emotion: "confused",
    format_type: "reaction_image",
    use_cases: ["duplicates", "pointing_at_same_thing", "confusion"],
    example_contexts: [
      "Two libraries doing exactly the same thing",
      "Three frameworks all pointing at each other",
      "Duplicate PRs from the same team",
    ],
    vibes: ["pointing spidermen", "mutual duplicate blame"],
    is_evergreen: true,
  },
  {
    imgflip_name: "where monkey",
    emotion: "absurdist",
    format_type: "reaction_image",
    use_cases: ["desperation", "searching", "self_deprecation"],
    example_contexts: [
      "Where bug? (demands gif of monkey)",
      "Desperately looking for the missing thing",
      "Primal demand for answers",
    ],
    vibes: ["unhinged demand", "where is it"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Sleeping Shaq",
    emotion: "sarcastic",
    format_type: "reaction_image",
    use_cases: ["wake_up_to_hype", "bored_then_alert", "relatability"],
    example_contexts: [
      "Sleeping through the hype, waking up for the payoff",
      "Uninterested → suddenly locked in",
      "Bored until the good part hits",
    ],
    vibes: ["bored-to-alert", "wake up king"],
    is_evergreen: true,
  },
  {
    imgflip_name: "The Scroll Of Truth",
    emotion: "savage",
    format_type: "reaction_image",
    use_cases: ["uncomfortable_truth", "rejection_of_facts"],
    example_contexts: [
      "Throwing the truth away because it's inconvenient",
      "When the facts don't match the vibe",
      "Reading it, rejecting it, running",
    ],
    vibes: ["rejected truth", "ancient scroll rage"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Megamind peeking",
    emotion: "sarcastic",
    format_type: "text_overlay",
    use_cases: ["no_punchline", "rhetorical_question"],
    example_contexts: [
      "No [expected thing]?",
      "Leading question where the answer is obvious",
      "Asking for a thing that definitely doesn't exist",
    ],
    vibes: ["big-head rhetorical", "no receipts?"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Absolute Cinema",
    emotion: "celebratory",
    format_type: "reaction_image",
    use_cases: ["masterpiece_declared", "excitement", "appreciation"],
    example_contexts: [
      "This is absolute cinema",
      "When a moment is pure art",
      "Old guy tearing up at perfection",
    ],
    vibes: ["cinematic awe", "masterpiece energy"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Gus Fring we are not the same",
    emotion: "savage",
    format_type: "reaction_image",
    use_cases: ["superiority", "dunking", "hot_take"],
    example_contexts: [
      "I don't do what you do. We are not the same.",
      "Calm superiority flex",
      "Quiet dunk with menace",
    ],
    vibes: ["calm superiority", "we are not the same"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Oprah You Get A",
    emotion: "celebratory",
    format_type: "text_overlay",
    use_cases: ["generous_giveaway", "everyone_gets_something"],
    example_contexts: [
      "You get a bug! You get a bug! Everyone gets a bug!",
      "When something is doled out to everyone",
      "Abundance, distributed freely",
    ],
    vibes: ["everyone gets one", "giveaway energy"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Leonardo Dicaprio Cheers",
    emotion: "celebratory",
    format_type: "reaction_image",
    use_cases: ["agreement", "cheers", "toast"],
    example_contexts: [
      "Raising a glass in agreement",
      "Cheers to that take",
      "Toasting a small win",
    ],
    vibes: ["cheers from across the room", "approving toast"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Charlie Conspiracy (Always Sunny in Philidelphia)",
    emotion: "absurdist",
    format_type: "reaction_image",
    use_cases: ["overanalyzing", "paranoia", "deep_dive"],
    example_contexts: [
      "Piecing together an unhinged theory",
      "Red-string-wall explanation energy",
      "Wild deep dive with no sleep",
    ],
    vibes: ["conspiracy board", "red yarn rant"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Grim Reaper Knocking Door",
    emotion: "savage",
    format_type: "text_overlay",
    use_cases: ["looming_dread", "escalating_threat"],
    example_contexts: [
      "Small thing ignored → bigger thing ignored → Reaper",
      "Warnings escalating to doom",
      "Death knocking louder each time",
    ],
    vibes: ["escalating doom", "Reaper at the door"],
    is_evergreen: true,
  },
  {
    imgflip_name: "UNO Draw 25 Cards",
    emotion: "absurdist",
    format_type: "text_overlay",
    use_cases: ["stubborn_refusal", "picking_pain_over_compromise"],
    example_contexts: [
      "Rather draw 25 than admit it",
      "Choosing suffering over compromise",
      "Pick up 25 before you change your mind",
    ],
    vibes: ["refuse and suffer", "card game defiance"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Finding Neverland",
    emotion: "wholesome",
    format_type: "reaction_image",
    use_cases: ["fake_laugh", "polite_suffering"],
    example_contexts: [
      "Laughing to hide the tears",
      "Pretending everything is fine, badly",
      "Polite laugh mid-breakdown",
    ],
    vibes: ["fake laughter", "crying while smiling"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Grandma Finds The Internet",
    emotion: "confused",
    format_type: "text_overlay",
    use_cases: ["out_of_touch", "generational_gap", "tech_confusion"],
    example_contexts: [
      "Treating a basic tech thing as magic",
      "Wide-eyed wonder at the obvious",
      "Out of touch with how things work",
    ],
    vibes: ["wide-eyed tech newbie", "out of touch"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Yo Dawg Heard You",
    emotion: "absurdist",
    format_type: "text_overlay",
    use_cases: ["recursion", "meta", "overdoing_it"],
    example_contexts: [
      "Yo dawg, I heard you like meetings",
      "Nesting a thing inside itself",
      "Meta recursion joke",
    ],
    vibes: ["recursive absurdity", "thing inside a thing"],
    is_evergreen: true,
  },
  {
    imgflip_name: "American Chopper Argument",
    emotion: "savage",
    format_type: "text_overlay",
    use_cases: ["internal_debate", "escalating_fight"],
    example_contexts: [
      "Arguing with yourself in five escalating panels",
      "Heated back-and-forth with no winner",
      "Throwing chairs at your own thoughts",
    ],
    vibes: ["escalating yelling", "chair-throwing debate"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Scooby doo mask reveal",
    emotion: "sarcastic",
    format_type: "text_overlay",
    use_cases: ["unmasking", "it_was_you_all_along"],
    example_contexts: [
      "Pulling off the mask to reveal the real culprit",
      "The bug was you all along",
      "Unmasking a known villain",
    ],
    vibes: ["unmasking reveal", "it-was-you"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Two Paths",
    emotion: "confused",
    format_type: "reaction_image",
    use_cases: ["impossible_choice", "decision", "self_deprecation"],
    example_contexts: [
      "Stuck between two paths, both look terrifying",
      "Which timeline do we pick",
      "Fork in the road and neither way is good",
    ],
    vibes: ["fork in the road", "daunting split"],
    is_evergreen: true,
  },
  {
    imgflip_name: "Whisper and Goosebumps",
    emotion: "absurdist",
    format_type: "reaction_image",
    use_cases: ["minor_thrill", "relatability"],
    example_contexts: [
      "Tiny things that give you goosebumps",
      "Small relatable thrills",
      "When a little thing just hits",
    ],
    vibes: ["tiny thrill", "goosebumps whisper"],
    is_evergreen: true,
  },
  {
    imgflip_name: "say the line bart! simpsons",
    emotion: "sarcastic",
    format_type: "text_overlay",
    use_cases: ["predictable_take", "say_the_line"],
    example_contexts: [
      "Say the line, Bart",
      "When you know exactly what they're about to say",
      "Predictable person about to be predictable",
    ],
    vibes: ["say the line", "predictable catchphrase"],
    is_evergreen: true,
  },
  {
    imgflip_name: "The Rock Driving",
    emotion: "sarcastic",
    format_type: "text_overlay",
    use_cases: ["sudden_turn", "double_take", "shocked_swerve"],
    example_contexts: [
      "Driving chill, passenger drops a bomb, head snaps",
      "Casual chat to horrified stare pipeline",
      "Mid-drive reality check",
    ],
    vibes: ["head snap", "mid-drive double take"],
    is_evergreen: true,
  },
  {
    imgflip_name: "I'm The Captain Now",
    emotion: "savage",
    format_type: "reaction_image",
    use_cases: ["power_grab", "takeover"],
    example_contexts: [
      "Quietly taking over the thing",
      "When the new PM rewrites the roadmap day one",
      "Ousting the old leadership",
    ],
    vibes: ["takeover declared", "new captain energy"],
    is_evergreen: true,
  },
];

function sanitizeFileName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

interface ImgflipTemplate {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
}

async function fetchImgflipTemplates(): Promise<Map<string, ImgflipTemplate>> {
  const res = await fetch("https://api.imgflip.com/get_memes");
  if (!res.ok) throw new Error(`imgflip API error: ${res.status}`);
  const data = (await res.json()) as {
    success: boolean;
    data: { memes: ImgflipTemplate[] };
  };
  const map = new Map<string, ImgflipTemplate>();
  for (const m of data.data.memes) {
    map.set(m.name.toLowerCase(), m);
  }
  return map;
}

async function downloadToDisk(url: string, filePath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buf);
}

async function seedMemes() {
  console.log("[MemeDrop] Starting meme seed with real images from imgflip...");

  // Ensure dev user exists
  await db
    .insert(users)
    .values({ id: DEV_USER_ID, email: "dev@memedrop.local" })
    .onConflictDoNothing();

  const templates = await fetchImgflipTemplates();
  console.log(`[MemeDrop] Fetched ${templates.size} imgflip templates`);

  // Clear previous seed rows so re-running gives a clean catalog.
  await db.execute(sql`DELETE FROM memes WHERE source_url LIKE 'https://i.imgflip.com/%' OR source_url IS NULL`);

  let inserted = 0;
  let missing = 0;
  let failed = 0;

  for (const meme of SEED_MEMES) {
    const tpl = templates.get(meme.imgflip_name.toLowerCase());
    if (!tpl) {
      console.warn(`  ? ${meme.imgflip_name} — not in imgflip top 100, skipping`);
      missing++;
      continue;
    }

    try {
      // Infer extension from URL (imgflip uses jpg/png, sometimes gif)
      const urlExt = path.extname(new URL(tpl.url).pathname).toLowerCase();
      if (urlExt === ".gif") {
        // Skip GIFs — requirements say images only
        console.warn(`  ~ ${meme.imgflip_name} — is a GIF, skipping`);
        missing++;
        continue;
      }
      const ext = [".jpg", ".jpeg", ".png", ".webp"].includes(urlExt)
        ? urlExt
        : ".jpg";
      const slug = sanitizeFileName(meme.imgflip_name);
      const fileName = `seed-${slug}-${randomUUID().slice(0, 8)}${ext}`;
      const filePath = path.join(STORAGE_PATH, fileName);

      await downloadToDisk(tpl.url, filePath);

      const descriptor = buildMemeDescriptor({
        name: meme.imgflip_name,
        emotion: meme.emotion,
        format_type: meme.format_type,
        use_cases: meme.use_cases,
        example_contexts: meme.example_contexts,
        vibes: meme.vibes,
      });

      const embedding = await generateEmbedding(descriptor);

      await db.insert(memes).values({
        name: meme.imgflip_name,
        filePath: `/memes/${fileName}`,
        formatType: meme.format_type,
        isEvergreen: meme.is_evergreen,
        systemTags: {
          emotion: meme.emotion,
          use_cases: meme.use_cases,
          example_contexts: meme.example_contexts,
          vibes: meme.vibes,
        },
        embedding,
        sourceUrl: tpl.url,
      });

      inserted++;
      console.log(`  [${inserted}] ${meme.imgflip_name}`);
    } catch (err) {
      console.error(`  X ${meme.imgflip_name} — ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(
    `\n[MemeDrop] Seed complete: ${inserted} inserted, ${missing} not in imgflip, ${failed} failed`
  );
  process.exit(0);
}

seedMemes().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
