import type { MemeTemplateManifest } from "../types/template-manifest.js";

export const MEME_TEMPLATE_MANIFEST: MemeTemplateManifest = {
  version: 1,
  generated_at: "2026-05-14T00:00:00.000Z",
  templates: [
    {
      template_id: "drake-hotline-bling",
      name: "Drake Hotline Bling",
      aliases: ["Drake"],
      supports_overlay: true,
      quality: "verified",
      regions: [
        region("reject", "rejected option", 0.52, 0.07, 0.43, 0.35, 3, 42),
        region("approve", "preferred option", 0.52, 0.56, 0.43, 0.35, 3, 42),
      ],
      caption_guidance: guidance(
        "Contrast the boring or bad option with the funnier preferred option.",
        [
          { reject: "writing tests", approve: "deploying on vibes" },
          { reject: "reading the docs", approve: "asking the timeline" },
        ],
        [
          { reject: "being normal about production", approve: "making it about production" },
        ]
      ),
    },
    {
      template_id: "two-buttons",
      name: "Two Buttons",
      aliases: ["2 Buttons"],
      supports_overlay: true,
      quality: "verified",
      regions: [
        region("left_button", "first painful choice", 0.12, 0.13, 0.27, 0.13, 2, 26, 0.88),
        region("right_button", "second painful choice", 0.48, 0.13, 0.27, 0.13, 2, 26, 0.88),
        region("person", "person stuck choosing", 0.28, 0.69, 0.45, 0.11, 1, 22, 0.82),
      ],
      caption_guidance: guidance(
        "Show someone sweating over two equally bad or tempting choices.",
        [
          { left_button: "ship it", right_button: "fix it", person: "me at 4:59" },
          { left_button: "reply", right_button: "stay employed", person: "the intern" },
        ],
        [{ left_button: "option one", right_button: "option two", person: "person" }]
      ),
    },
    {
      template_id: "distracted-boyfriend",
      name: "Distracted Boyfriend",
      aliases: ["Distracted Boyfriend"],
      supports_overlay: true,
      quality: "verified",
      regions: [
        region("temptation", "tempting bad idea", 0.02, 0.2, 0.28, 0.13, 2, 30, 0.82),
        region("boyfriend", "person being tempted", 0.32, 0.38, 0.2, 0.1, 1, 20, 0.72),
        region("girlfriend", "responsible neglected option", 0.59, 0.32, 0.24, 0.12, 2, 28, 0.78),
      ],
      caption_guidance: guidance(
        "Label the tempting distraction, the person chasing it, and the sensible thing being ignored.",
        [
          { temptation: "new framework", boyfriend: "me", girlfriend: "finishing the app" },
          { temptation: "posting through it", boyfriend: "founder", girlfriend: "sleep" },
        ],
        [{ temptation: "bad thing", boyfriend: "person", girlfriend: "good thing" }]
      ),
    },
    {
      template_id: "change-my-mind",
      name: "Change My Mind",
      aliases: ["Steven Crowder Change My Mind"],
      supports_overlay: true,
      quality: "verified",
      regions: [
        region("sign", "confident hot take on the sign", 0.16, 0.39, 0.44, 0.18, 3, 48, 0.78),
      ],
      caption_guidance: guidance(
        "Write one short opinionated claim that would fit on the sign.",
        [
          { sign: "Friday deploys are performance art" },
          { sign: "Your roadmap is just vibes" },
        ],
        [{ sign: "we should talk about the implications of this issue" }]
      ),
    },
    {
      template_id: "always-has-been",
      name: "Always Has Been",
      aliases: ["Astronaut Gun"],
      supports_overlay: true,
      quality: "verified",
      regions: [
        region("realization", "surprised realization", 0.04, 0.05, 0.44, 0.15, 2, 34, 0.82),
        region("answer", "deadpan answer", 0.5, 0.06, 0.42, 0.14, 2, 30, 0.82),
      ],
      caption_guidance: guidance(
        "Use the first region for a realization and the second for the inevitable answer.",
        [
          { realization: "wait, it's all bugs?", answer: "always has been" },
          { realization: "it's just spreadsheets?", answer: "always has been" },
        ],
        [{ realization: "I have realized a thing", answer: "yes that thing is true" }]
      ),
    },
    {
      template_id: "anakin-padme-4-panel",
      name: "Anakin Padme 4 Panel",
      aliases: ["Anakin Padme"],
      supports_overlay: true,
      quality: "verified",
      regions: [
        region("promise", "confident first statement", 0.05, 0.06, 0.4, 0.16, 2, 34, 0.78),
        region("hope", "hopeful clarification", 0.55, 0.06, 0.4, 0.16, 2, 34, 0.78),
        region("silence", "ominous silence or repeat", 0.05, 0.56, 0.4, 0.16, 2, 34, 0.78),
        region("dread", "worried repeated question", 0.55, 0.56, 0.4, 0.16, 2, 34, 0.78),
      ],
      caption_guidance: guidance(
        "Set up a promise, hopeful interpretation, ominous non-answer, then dread.",
        [
          {
            promise: "we'll ship Friday",
            hope: "with tests, right?",
            silence: "...",
            dread: "with tests, right?",
          },
        ],
        []
      ),
    },
    {
      template_id: "trade-offer",
      name: "Trade Offer",
      aliases: ["Trade Offer"],
      supports_overlay: true,
      quality: "verified",
      regions: [
        region("i_receive", "what I receive", 0.05, 0.16, 0.33, 0.18, 3, 36, 0.8),
        region("you_receive", "what you receive", 0.62, 0.16, 0.33, 0.18, 3, 36, 0.8),
      ],
      caption_guidance: guidance(
        "Make a lopsided exchange: I receive something valuable, you receive a terrible consolation.",
        [
          { i_receive: "your weekend", you_receive: "one hotfix" },
          { i_receive: "free labor", you_receive: "exposure" },
        ],
        []
      ),
    },
    {
      template_id: "bernie-i-am-once-again-asking-for-your-support",
      name: "Bernie I Am Once Again Asking For Your Support",
      aliases: ["Bernie asking"],
      supports_overlay: true,
      quality: "verified",
      regions: [
        region("ask", "repeated polite request", 0.07, 0.05, 0.86, 0.21, 3, 56, 0.88),
      ],
      caption_guidance: guidance(
        "Phrase it as a tired repeated request.",
        [
          { ask: "I am once again asking you to write tests" },
          { ask: "I am once again asking for one normal deploy" },
        ],
        []
      ),
    },
    {
      template_id: "roll-safe-think-about-it",
      name: "Roll Safe Think About It",
      aliases: ["Roll Safe"],
      supports_overlay: true,
      quality: "verified",
      regions: [
        region("wisdom", "smug bad logic", 0.05, 0.05, 0.9, 0.2, 3, 58, 0.88),
      ],
      caption_guidance: guidance(
        "Write fake wisdom where the logic is obviously bad.",
        [
          { wisdom: "can't break prod if you never had staging" },
          { wisdom: "can't miss deadlines if you stop estimating" },
        ],
        []
      ),
    },
    {
      template_id: "evil-kermit",
      name: "Evil Kermit",
      aliases: ["Evil Kermit"],
      supports_overlay: true,
      quality: "verified",
      regions: [
        region("me", "reasonable self", 0.05, 0.05, 0.9, 0.14, 2, 42, 0.82),
        region("evil_me", "bad impulse", 0.05, 0.81, 0.9, 0.15, 2, 42, 0.82),
      ],
      caption_guidance: guidance(
        "Contrast the reasonable self with the bad impulse.",
        [
          { me: "me: stay professional", evil_me: "also me: quote tweet it" },
          { me: "me: wait for CI", evil_me: "also me: merge anyway" },
        ],
        []
      ),
    },
    {
      template_id: "panik-kalm-panik",
      name: "Panik Kalm Panik",
      aliases: ["Panik Kalm Panik"],
      supports_overlay: true,
      quality: "verified",
      regions: [
        region("panic_1", "first panic", 0.5, 0.05, 0.45, 0.14, 2, 30, 0.76),
        region("calm", "brief relief", 0.5, 0.38, 0.45, 0.14, 2, 30, 0.76),
        region("panic_2", "worse second panic", 0.5, 0.72, 0.45, 0.14, 2, 30, 0.76),
      ],
      caption_guidance: guidance(
        "Escalate from panic to relief to a worse panic.",
        [
          { panic_1: "prod is down", calm: "only staging", panic_2: "staging is prod" },
        ],
        []
      ),
    },
    {
      template_id: "gru-s-plan",
      name: "Gru's Plan",
      aliases: ["Gru Plan"],
      supports_overlay: true,
      quality: "verified",
      regions: [
        region("step_1", "plan step one", 0.47, 0.04, 0.47, 0.13, 2, 34, 0.72),
        region("step_2", "plan step two", 0.47, 0.29, 0.47, 0.13, 2, 34, 0.72),
        region("step_3", "plan step three", 0.47, 0.54, 0.47, 0.13, 2, 34, 0.72),
        region("realization", "bad realization", 0.47, 0.79, 0.47, 0.13, 2, 34, 0.72),
      ],
      caption_guidance: guidance(
        "List a plan where the final step reveals the obvious flaw.",
        [
          {
            step_1: "skip tests",
            step_2: "ship faster",
            step_3: "break prod",
            realization: "break prod",
          },
        ],
        []
      ),
    },
    {
      template_id: "boardroom-meeting-suggestion",
      name: "Boardroom Meeting Suggestion",
      aliases: ["Boardroom Suggestion"],
      supports_overlay: true,
      quality: "verified",
      regions: [
        region("bad_idea_1", "bad corporate idea", 0.03, 0.07, 0.27, 0.13, 2, 28, 0.72),
        region("bad_idea_2", "another bad corporate idea", 0.36, 0.06, 0.27, 0.13, 2, 28, 0.72),
        region("good_idea", "reasonable suggestion", 0.68, 0.08, 0.28, 0.14, 2, 32, 0.72),
      ],
      caption_guidance: guidance(
        "Two bad ideas are accepted; the reasonable suggestion gets punished.",
        [
          { bad_idea_1: "more meetings", bad_idea_2: "new dashboard", good_idea: "fix the bug" },
        ],
        []
      ),
    },
    {
      template_id: "mocking-spongebob",
      name: "Mocking Spongebob",
      aliases: ["Mocking SpongeBob"],
      supports_overlay: true,
      quality: "verified",
      regions: [
        region("quote", "mocked quote", 0.05, 0.05, 0.9, 0.2, 3, 54, 0.9),
      ],
      caption_guidance: guidance(
        "Repeat a bad take in mocking mixed-case energy.",
        [{ quote: "wE dOn'T nEeD tEsTs" }],
        []
      ),
    },
  ],
};

function region(
  id: string,
  role: string,
  x: number,
  y: number,
  width: number,
  height: number,
  maxLines: number,
  maxChars: number,
  scale = 1
) {
  return {
    id,
    role,
    x,
    y,
    width,
    height,
    align: "center" as const,
    valign: "middle" as const,
    max_lines: maxLines,
    max_chars: maxChars,
    font: {
      family: "Impact" as const,
      min_size: Math.round(14 * scale),
      max_size: Math.round(44 * scale),
      stroke_ratio: 0.12,
    },
  };
}

function guidance(
  pattern: string,
  goodExamples: Array<Record<string, string>>,
  badExamples: Array<Record<string, string>>
) {
  return {
    pattern,
    good_examples: goodExamples,
    bad_examples: badExamples,
  };
}
