import type { MemeRetrievalMetadata } from "../types/template-manifest.js";

/**
 * Human-reviewed retrieval semantics for verified runtime templates.
 *
 * These annotations describe reusable joke mechanics, not benchmark phrases or
 * social-media domains. They are deliberately separate from image/layout data so
 * retrieval quality can evolve through catalog review without touching rendering.
 */
export const MEME_TEMPLATE_RETRIEVAL: Record<string, MemeRetrievalMetadata> = {
  "drake-hotline-bling": retrieval(
    ["preference contrast", "reject versus approve"],
    ["reject one option prefer another", "bad choice versus better choice", "before and after preference"],
    ["equally painful dilemma", "quiet waiting", "hidden identity reveal"]
  ),
  "two-buttons": retrieval(
    ["forced choice", "painful dilemma"],
    ["choose between two bad options", "impossible tradeoff", "either choice has a cost", "torn between alternatives", "one option or another unpleasant option"],
    ["single confident opinion", "celebration", "passive waiting"]
  ),
  "distracted-boyfriend": retrieval(
    ["shiny object temptation", "neglected responsibility"],
    ["tempted by a new distraction", "abandon the sensible option", "chasing novelty instead of finishing", "new trend pulls attention away"],
    ["balanced dilemma", "patient waiting", "successful outcome"]
  ),
  "change-my-mind": retrieval(
    ["confident hot take", "provocative opinion"],
    ["direct unpopular opinion", "bold claim inviting disagreement", "workplace hot take", "confident thesis"],
    ["uncertain suspicion", "quiet embarrassment", "long narrative sequence"]
  ),
  "always-has-been": retrieval(
    ["hidden truth reveal", "inevitable realization"],
    ["discover it was true all along", "the reality was always obvious", "dark realization", "nothing actually changed"],
    ["new achievement", "negotiation", "forced choice"]
  ),
  "anakin-padme-4-panel": retrieval(
    ["ominous promise", "hope turning to dread"],
    ["confident promise followed by worried clarification", "silence reveals bad implication", "hopeful question gets no reassurance"],
    ["simple celebration", "equal comparison", "quiet observation"]
  ),
  "trade-offer": retrieval(
    ["exploitative exchange", "lopsided deal"],
    ["one side receives value and the other gets scraps", "unfair offer", "bad compensation for a large request", "terrible consolation"],
    ["clean win", "equal partnership", "patient waiting"]
  ),
  "bernie-i-am-once-again-asking-for-your-support": retrieval(
    ["recurring request", "tired repetition"],
    ["asking for the same thing again", "repeated promise or request", "once again waiting for action", "familiar appeal returns"],
    ["one-time victory", "secret suspicion", "luxury makeover"]
  ),
  "roll-safe-think-about-it": retrieval(
    ["confident bad solution", "fake wisdom"],
    ["clever sounding logic with an obvious flaw", "solve a problem by denying it", "smug shortcut creates consequences", "confidently irrational plan", "fix a serious problem with a slogan poster or superficial gimmick"],
    ["genuine useful advice", "earned celebration", "balanced debate"]
  ),
  "evil-kermit": retrieval(
    ["bad impulse", "internal temptation"],
    ["responsible self versus chaotic impulse", "temptation to make the selfish choice", "inner voice recommends trouble"],
    ["external argument", "public celebration", "waiting alone"]
  ),
  "panik-kalm-panik": retrieval(
    ["panic reversal", "escalating crisis"],
    ["panic then relief then worse panic", "temporary calm before new disaster", "rapid emotional reversal during chaos"],
    ["stable success", "quiet loneliness", "straight comparison"]
  ),
  "gru-s-plan": retrieval(
    ["flawed plan", "overengineered sequence"],
    ["multi-step plan reveals its own flaw", "elaborate itinerary or process goes wrong", "confident plan ends in realization", "too many steps for a simple goal", "simple outing becomes a detailed itinerary with maps rules and contingencies", "hours of effort end with realizing a personal mistake"],
    ["simple preference", "clean success", "unrelated argument"]
  ),
  "expanding-brain": retrieval(
    ["absurd escalation", "overengineering"],
    ["each idea gets more elaborate", "simple task becomes absurd system", "overthinking a tiny issue", "escalating levels of sophistication", "pile on more categories until the combined hybrid becomes absurd", "complex problem receives a grand superficial solution"],
    ["quiet waiting", "ordinary achievement", "two-sided argument"]
  ),
  "hide-the-pain-harold": retrieval(
    ["awkward suffering", "forced composure"],
    ["smiling through discomfort", "quietly endure a self-own", "pretend everything is fine while hurting", "resigned embarrassment", "spend hours before realizing your own mistake", "calm face during surrounding noise and disorder"],
    ["genuine excitement", "loud confrontation", "confident accusation"]
  ),
  "surprised-pikachu": retrieval(
    ["predictable consequence", "obvious outcome"],
    ["ignored warning produces expected result", "bad choice followed by fake surprise", "who could have predicted the consequence"],
    ["unexpected good luck", "patient waiting", "careful decision"]
  ),
  "they-re-the-same-picture": retrieval(
    ["fake distinction", "euphemistic rebrand"],
    ["two labels describe the same thing", "rebrand changes wording not reality", "new name for an unchanged idea", "supposed alternatives are identical", "change presentation and price while the base product stays unchanged"],
    ["genuine transformation", "unfair offer", "celebration"]
  ),
  "is-this-a-pigeon": retrieval(
    ["false label", "pretentious relabeling"],
    ["call an ordinary thing an inflated title", "misidentify something obvious", "corporate euphemism", "fancy label for a basic object", "ordinary product called a premium sensory experience"],
    ["correct definition", "reciprocal agreement", "quiet waiting"]
  ),
  "monkey-puppet": retrieval(
    ["guilty reaction", "awkward self-own"],
    ["act innocent after causing the problem", "look away when noticed", "embarrassed realization", "caught and pretending not to see", "realize your own mistake after hours of effort", "overbuild a simple plan and act awkward about it"],
    ["public victory", "confident debate", "long wait"]
  ),
  "one-does-not-simply": retrieval(
    ["hard constraint", "not that simple"],
    ["simple request is actually difficult", "cannot casually complete the task", "obvious obstacle blocks an easy claim"],
    ["easy success", "luxury rebrand", "guilty reaction"]
  ),
  "futurama-fry": retrieval(
    ["suspicious ambiguity", "doubtful claim"],
    ["not sure whether claim is true", "something feels suspicious", "question a convenient explanation", "uncertain hidden motive"],
    ["certain revelation", "celebration", "simple preference"]
  ),
  "epic-handshake": retrieval(
    ["unlikely agreement", "shared outcome"],
    ["different groups unite over one thing", "unlikely allies share a belief", "both sides agree", "common victory"],
    ["tribal accusation", "lonely waiting", "one-sided exploitation"]
  ),
  "this-is-fine": retrieval(
    ["calm amid mayhem", "forced optimism"],
    ["remain calm while everything collapses", "pretend disaster is acceptable", "chaos surrounds an unbothered person", "label a bad situation as positive growth", "someone calmly sits amid horns crowds and surrounding disorder"],
    ["clean success", "active forced choice", "sincere tragedy"]
  ),
  "woman-yelling-at-cat": retrieval(
    ["dramatic confrontation", "absurd rebuttal"],
    ["angry complaint meets calm absurd response", "two sides shout past each other", "heated accusation and dismissive answer"],
    ["quiet agreement", "solitary waiting", "clean celebration"]
  ),
  "sad-pablo-escobar": retrieval(
    ["abandoned waiting", "lonely delay"],
    ["left alone waiting for a response", "coordination never happens", "silence stretches for months", "everyone else has disappeared", "group chat scheduling is abandoned and nobody participates"],
    ["fast action", "crowded celebration", "confident solution"]
  ),
  "laughing-leo": retrieval(
    ["smug amusement", "watching a mistake"],
    ["laugh at an obvious mistake", "recognize an overconfident plan", "amused reaction", "victory with smug energy"],
    ["sad abandonment", "serious harm", "uncertain suspicion"]
  ),
  "megamind-peeking": retrieval(
    ["awkward observation", "consequence watching"],
    ["peek at a self-own unfolding", "watch suspicious consequences arrive", "awkward reveal from the sidelines"],
    ["direct argument", "large celebration", "formal negotiation"]
  ),
  "leonardo-dicaprio-cheers": retrieval(
    ["small win celebration", "earned relief"],
    ["celebrate a rare concrete success", "raise a glass to finally winning", "milestone after repeated attempts", "victory feels unusually important"],
    ["ongoing crisis", "failure disguised as growth", "lonely waiting"]
  ),
  "oprah-you-get-a": retrieval(
    ["everyone gets one", "feature proliferation"],
    ["give the same thing to every person", "every page receives another feature", "indiscriminate giveaway", "repeat the addition everywhere", "same addition repeated across every category"],
    ["exclusive choice", "single lowball offer", "abandoned coordination"]
  ),
  "pawn-stars-best-i-can-do": retrieval(
    ["lowball offer", "exploitative bargain"],
    ["huge request gets tiny compensation", "absurdly cheap counteroffer", "offered exposure instead of payment", "buyer undervalues the work"],
    ["generous reward", "mutual celebration", "waiting in silence"]
  ),
  "say-the-line-bart-simpsons": retrieval(
    ["recurring broken promise", "predictable refrain"],
    ["same familiar line appears again", "everyone expects the repeated claim", "promise returns every year", "audience waits for the catchphrase"],
    ["novel discovery", "private guilt", "successful completion"]
  ),
  "tuxedo-winnie-the-pooh": retrieval(
    ["luxury makeover", "pretentious upgrade"],
    ["ordinary thing gets a fancy presentation", "plain option versus inflated premium version", "charge more after renaming it sophisticated", "make basic idea sound luxurious", "turn a basic product into a premium sensory experience with a higher price"],
    ["unchanged identical labels", "serious crisis", "patient waiting"]
  ),
  "two-paths": retrieval(
    ["safe versus chaotic path", "bad direction"],
    ["choose the reckless route over the sensible one", "fork between safe and chaotic options", "person actively picks trouble", "take one route or a worse alternative"],
    ["equal painful dilemma", "quiet reveal", "celebration"]
  ),
  "uno-draw-25-cards": retrieval(
    ["stubborn refusal", "self-inflicted consequence"],
    ["accept a ridiculous penalty instead of simple action", "choose costly consequence with confidence", "refuse the obvious rule", "would rather suffer than comply", "do a simple action or accept an expensive consequence"],
    ["accidental misfortune", "clean victory", "equal collaboration"]
  ),
  "waiting-skeleton": retrieval(
    ["extreme waiting", "endless delay"],
    ["wait so long it becomes the joke", "still waiting after seasons pass", "promise never arrives", "coordination remains unresolved", "which day works scheduling chat repeats for months"],
    ["immediate result", "energetic argument", "celebration"]
  ),
  "yo-dawg-heard-you": retrieval(
    ["recursive hype", "thing inside itself"],
    ["put the same feature inside itself", "combine two trends into a recursive version", "nested product bloat", "meta repetition", "repeat the same word and combine it into a hybrid category"],
    ["single simple feature", "long abandonment", "forced dilemma"]
  ),
  "the-rock-driving": retrieval(
    ["confidence before disaster", "sudden realization"],
    ["confident statement followed by bad realization", "conversation turns ominous", "about to discover the plan fails"],
    ["extended waiting", "shared agreement", "luxury relabeling"]
  ),
  "scooby-doo-mask-reveal": retrieval(
    ["hidden cause reveal", "fake identity"],
    ["remove the disguise to expose real cause", "supposed new thing is old problem underneath", "unmask the culprit"],
    ["open celebration", "balanced choice", "simple request"]
  ),
  "running-away-balloon": retrieval(
    ["goal blocked by chaos", "pulled away"],
    ["simple goal dragged away by obstacle", "responsibility loses to outside chaos", "reaching for something while blocker intervenes"],
    ["completed success", "stationary waiting", "direct opinion"]
  ),
  "the-scroll-of-truth": retrieval(
    ["uncomfortable truth", "truth rejection"],
    ["search for truth then reject blunt answer", "real cause is disappointing", "honest explanation nobody wants", "unwelcome fact"],
    ["pleasant surprise", "marketing celebration", "uncertain rumor"]
  ),
  "buff-doge-vs-cheems": retrieval(
    ["past versus present", "strong versus weak"],
    ["ideal powerful version compared with anxious weak version", "then versus now decline", "expectation compared with diminished reality"],
    ["equal alternatives", "hidden identity", "one-time victory"]
  ),
  "inhaling-seagull": retrieval(
    ["sudden overreaction", "loud escalation"],
    ["calm setup followed by yelling", "tiny issue causes dramatic scream", "reaction becomes disproportionately loud"],
    ["quiet endurance", "patient waiting", "subtle suspicion"]
  ),
  "they-don-t-know": retrieval(
    ["private knowledge", "social isolation"],
    ["one person knows awkward truth while room acts normal", "secret fact separates observer from crowd", "quiet internal realization at a gathering"],
    ["public confrontation", "everyone agrees", "obvious giveaway"]
  ),
  "charlie-conspiracy-always-sunny-in-philidelphia": retrieval(
    ["elaborate suspicion", "overinterpretation"],
    ["build a sprawling theory from tiny clues", "corkboard of arrows and hidden connections", "overanalyze a short message", "frantic investigation"],
    ["simple proven fact", "earned celebration", "calm acceptance"]
  ),
  "boardroom-meeting-suggestion": retrieval(
    ["reasonable idea rejected", "group bad judgment"],
    ["group accepts bad ideas and punishes sensible suggestion", "meeting ignores obvious solution", "organization chooses nonsense"],
    ["individual private guilt", "patient waiting", "successful agreement"]
  ),
  "mocking-spongebob": retrieval(
    ["mocking repetition", "ridicule bad take"],
    ["repeat a statement in sarcastic voice", "mock an annoying claim", "parody the exact words"],
    ["sincere support", "quiet sadness", "complex plan"]
  ),
  "absolute-cinema": retrieval(
    ["grandiose art defense", "pretentious over-explanation"],
    ["describe low effort work as profound art", "grand analysis of something obviously basic", "crowd solemnly praises empty or silly artwork", "inflated cultural critique"],
    ["real emergency", "simple practical choice", "lonely waiting"]
  ),
  "disaster-girl": retrieval(
    ["smug chaos", "guilty destruction"],
    ["small reckless action causes mayhem", "quietly proud while damage unfolds", "culprit looks unbothered near chaos"],
    ["sincere tragedy", "clean win", "careful prevention"]
  ),
  "spider-man-triple": retrieval(
    ["mirror-image grievance", "tribal hypocrisy"],
    ["nearly identical sides accuse each other", "rival groups make the same complaint", "everyone points blame in a circular argument", "mutual hypocrisy"],
    ["one-sided abuse", "lonely waiting", "shared celebration"]
  ),
  "squidward-window": retrieval(
    ["annoyed observer", "excluded from nearby fun"],
    ["watch noisy people nearby with resentment", "stuck observing neighbors create chaos", "outsider watches others have fun", "annoyed by repeated noise"],
    ["active participant", "major success", "formal negotiation"]
  ),
};

function retrieval(
  joke_shapes: string[],
  positive_hints: string[],
  anti_hints: string[]
): MemeRetrievalMetadata {
  return { version: 1, joke_shapes, positive_hints, anti_hints };
}
