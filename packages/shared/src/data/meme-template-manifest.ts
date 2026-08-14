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
        region("sign", "confident hot take on the sign", 0.16, 0.39, 0.44, 0.18, 3, 38, 0.78),
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
      template_id: "expanding-brain",
      name: "Expanding Brain",
      aliases: ["Expanding Brain"],
      source_image: "/memes/seed-expanding-brain-104ce251.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("level_1", "baseline or simplest idea", 0, 0, 0.5, 0.25, "center", "middle", 2, 28, 28, 44),
        exactRegion("level_2", "slightly more advanced idea", 0, 0.25, 0.5, 0.25, "center", "middle", 2, 28, 28, 44),
        exactRegion("level_3", "absurdly advanced idea", 0, 0.5, 0.5, 0.25, "center", "middle", 2, 28, 28, 44),
        exactRegion("level_4", "ultimate galaxy-brain conclusion", 0, 0.75, 0.5, 0.25, "center", "middle", 2, 28, 28, 44),
      ],
      caption_guidance: guidance(
        "Escalate four versions of the same idea, ending with the most absurd or overbuilt conclusion.",
        [
          {
            level_1: "Use spreadsheet",
            level_2: "Add dashboard",
            level_3: "Add AI button",
            level_4: "Become the platform",
          },
        ],
        [{ level_1: "A long paragraph", level_4: "normal boring ending" }]
      ),
    },
    {
      template_id: "hide-the-pain-harold",
      name: "Hide the Pain Harold",
      aliases: ["Hide the Pain Harold"],
      source_image: "/memes/seed-hide-the-pain-harold-5594557a.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_caption", "setup or situation text", 0.06, 0.02, 0.88, 0.16, "center", "top", 2, 42, 22, 34),
        exactRegion("bottom_caption", "punchline or resigned reaction", 0.06, 0.84, 0.88, 0.14, "center", "bottom", 2, 42, 22, 34),
      ],
      caption_guidance: guidance(
        "Use a setup and resigned punchline; Harold's smile sells the awkward pain.",
        [
          { top_caption: "Everything is fine", bottom_caption: "I checked staging" },
          { top_caption: "One quick meeting", bottom_caption: "Three hours later" },
        ],
        [{ top_caption: "Detailed paragraph about office policy", bottom_caption: "covers Harold's face" }]
      ),
    },
    {
      template_id: "surprised-pikachu",
      name: "Surprised Pikachu",
      aliases: ["Surprised Pikachu"],
      source_image: "/memes/seed-surprised-pikachu-57a20241.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_reaction_caption", "obvious bad choice only; the shocked face supplies the consequence", 0, 0, 1, 0.33, "center", "middle", 3, 90, 34, 68),
      ],
      caption_guidance: guidance(
        "State only the obvious bad choice or ignored warning. Do not write the consequence or describe the shock; the image supplies both.",
        [
          { top_reaction_caption: "Skipping tests before Friday deploy" },
          { top_reaction_caption: "Ignoring warnings then seeing warnings" },
        ],
        [{ top_reaction_caption: "Tiny text placed over Pikachu's face or body" }]
      ),
    },
    {
      template_id: "they-re-the-same-picture",
      name: "They're The Same Picture",
      aliases: ["They're The Same Picture"],
      source_image: "/memes/seed-they-re-the-same-picture-884342d6.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_comparison_caption", "comparison formatted as concise 'X vs Y'", 0.12, 0.42, 0.76, 0.09, "center", "middle", 2, 36, 34, 54),
        exactRegion("bottom_reveal_caption", "short grammatical reveal that X and Y are identical", 0.3, 0.9, 0.48, 0.07, "center", "middle", 1, 24, 36, 58),
      ],
      caption_guidance: guidance(
        "Write the two supposedly different labels as 'X vs Y', then reveal they are the same thing.",
        [
          { top_comparison_caption: "Backlog vs pipeline", bottom_reveal_caption: "Same picture" },
          { top_comparison_caption: "Macros vs platform", bottom_reveal_caption: "Same picture" },
        ],
        [{ top_comparison_caption: "Long explanation of every difference", bottom_reveal_caption: "unrelated joke" }]
      ),
    },
    {
      template_id: "is-this-a-pigeon",
      name: "Is This A Pigeon",
      aliases: ["Is This A Pigeon"],
      source_image: "/memes/seed-is-this-a-pigeon-595698db.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_caption", "what the observer sees or does before misidentifying it", 0.04, 0.02, 0.92, 0.16, "center", "top", 2, 42, 42, 68),
        exactRegion("bottom_caption", "question in the form 'Is this [absurd wrong label]?'", 0.03, 0.82, 0.94, 0.16, "center", "bottom", 2, 44, 42, 68),
      ],
      caption_guidance: guidance(
        "Top: state what the observer sees or does. Bottom: ask 'Is this [the inflated or absurd wrong label]?' Never swap those roles.",
        [
          { top_caption: "Calls backlog a strategy", bottom_caption: "Is this a roadmap?" },
          { top_caption: "Sees one AI button", bottom_caption: "Is this innovation?" },
        ],
        [{ top_caption: "This is definitely a butterfly", bottom_caption: "beautiful window" }]
      ),
    },
    {
      template_id: "monkey-puppet",
      name: "Monkey Puppet",
      aliases: ["Monkey Puppet"],
      source_image: "/memes/seed-monkey-puppet-e1ddb29d.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("left_reaction", "initial reaction", 0.02, 0.03, 0.46, 0.94, "center", "top", 3, 28, 28, 54),
        exactRegion("right_reaction", "awkward follow-up reaction", 0.52, 0.03, 0.46, 0.94, "center", "top", 3, 28, 28, 54),
      ],
      caption_guidance: guidance(
        "Use the two panels as before-and-after reactions: first confidence, then awkward realization.",
        [
          { left_reaction: "Reading the plan", right_reaction: "I am the plan" },
          { left_reaction: "Approved by vibes", right_reaction: "Blocked by silence" },
        ],
        [{ left_reaction: "A long paragraph explaining everything", right_reaction: "text over the eyes" }]
      ),
    },
    {
      template_id: "one-does-not-simply",
      name: "One Does Not Simply",
      aliases: ["One Does Not Simply"],
      source_image: "/memes/seed-one-does-not-simply-d57d64a0.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_statement", "serious setup statement", 0.08, 0.03, 0.84, 0.2, "center", "top", 2, 42, 22, 34, 0.14),
        exactRegion("bottom_statement", "blunt impossible punchline", 0.1, 0.74, 0.8, 0.22, "center", "bottom", 2, 44, 22, 34, 0.14),
      ],
      caption_guidance: guidance(
        "Pair a serious setup with a blunt line about something that cannot simply be done.",
        [
          { top_statement: "One does not simply", bottom_statement: "read the error message" },
          { top_statement: "One does not simply", bottom_statement: "ship Friday safely" },
        ],
        [{ top_statement: "Random setup", bottom_statement: "unrelated punchline" }]
      ),
    },
    {
      template_id: "futurama-fry",
      name: "Futurama Fry",
      aliases: ["Futurama Fry", "Not Sure If Fry"],
      source_image: "/memes/seed-futurama-fry-e3b60758.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_reaction_caption", "suspicious setup", 0.04, 0.04, 0.92, 0.18, "center", "top", 2, 42, 22, 34),
        exactRegion("bottom_reaction_caption", "not sure if punchline", 0.04, 0.78, 0.92, 0.18, "center", "bottom", 2, 42, 22, 34),
      ],
      caption_guidance: guidance(
        "Frame a suspicious claim as a 'not sure if' dilemma with the punchline at the bottom.",
        [
          { top_reaction_caption: "Not sure if autonomous", bottom_reaction_caption: "or just remote control" },
          { top_reaction_caption: "Not sure if roadmap", bottom_reaction_caption: "or vibes in a deck" },
        ],
        [{ top_reaction_caption: "Long explanation", bottom_reaction_caption: "generic reaction" }]
      ),
    },
    {
      template_id: "epic-handshake",
      name: "Epic Handshake",
      aliases: ["Epic Handshake"],
      source_image: "/memes/seed-epic-handshake-92a59c69.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("left_side_label", "left participant or idea", 0.01, 0.08, 0.27, 0.25, "left", "top", 2, 14, 22, 40),
        exactRegion("right_side_label", "right participant or idea", 0.72, 0.08, 0.27, 0.25, "right", "top", 2, 14, 22, 40),
        exactRegion("shared_agreement", "short shared agreement", 0.31, 0.01, 0.38, 0.14, "center", "top", 1, 18, 20, 36),
      ],
      caption_guidance: guidance(
        "Label two unlikely allies with very short side labels, then add the shortest shared thing they agree on.",
        [
          { left_side_label: "DevOps", right_side_label: "Product", shared_agreement: "No rollback" },
          { left_side_label: "Meetings", right_side_label: "Slack", shared_agreement: "Same pain" },
        ],
        [{ left_side_label: "Long department name", right_side_label: "Another long label", shared_agreement: "full sentence" }]
      ),
    },
    {
      template_id: "this-is-fine",
      name: "This Is Fine",
      aliases: ["This Is Fine"],
      source_image: "/memes/seed-this-is-fine-907eec71.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("speech_bubble_text", "deadpan bubble text", 0.56, 0.02, 0.34, 0.22, "center", "middle", 2, 18, 18, 30),
        exactRegion("bottom_caption", "chaotic context", 0.05, 0.78, 0.9, 0.18, "center", "middle", 2, 42, 18, 34),
      ],
      caption_guidance: guidance(
        "Pair a calm, deadpan bubble with a short caption describing the obvious disaster.",
        [
          { speech_bubble_text: "This is fine", bottom_caption: "Prod is down" },
          { speech_bubble_text: "All good", bottom_caption: "Dashboard is red" },
        ],
        [{ speech_bubble_text: "long explanation", bottom_caption: "tiny low-contrast text in the flames" }]
      ),
    },
    {
      template_id: "woman-yelling-at-cat",
      name: "Woman Yelling At Cat",
      aliases: ["Woman Yelling At Cat"],
      source_image: "/memes/seed-woman-yelling-at-cat-4132dfed.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("woman_yelling", "intense accusation or complaint", 0, 0, 0.5, 0.52, "center", "top", 3, 28, 22, 42),
        exactRegion("cat_response", "deadpan response or counterpoint", 0.5, 0, 0.5, 0.52, "center", "top", 3, 28, 22, 42),
      ],
      caption_guidance: guidance(
        "Use the left side for the dramatic complaint and the cat for the calm absurd response.",
        [
          { woman_yelling: "Read the error", cat_response: "Ping channel" },
          { woman_yelling: "Fix the bug", cat_response: "Add flag" },
        ],
        [{ woman_yelling: "tiny label", cat_response: "paragraph that will not fit" }]
      ),
    },
    {
      template_id: "sad-pablo-escobar",
      name: "Sad Pablo Escobar",
      aliases: ["Sad Pablo Escobar"],
      source_image: "/memes/seed-sad-pablo-escobar-eb0e5d4e.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_caption", "lonely setup", 0.06, 0.03, 0.88, 0.18, "center", "top", 2, 42, 28, 54, 0.14),
        exactRegion("bottom_left_caption", "waiting reaction", 0.02, 0.52, 0.46, 0.44, "center", "top", 3, 34, 24, 46, 0.14),
        exactRegion("bottom_right_caption", "second waiting reaction", 0.52, 0.52, 0.44, 0.44, "center", "top", 3, 34, 24, 46, 0.14),
      ],
      caption_guidance: guidance(
        "Show lonely waiting or abandonment, then split the bottom panels into two quiet waiting reactions.",
        [
          { top_caption: "PR approved by vibes", bottom_left_caption: "Blocked by silence" },
          { top_caption: "Waiting for review", bottom_right_caption: "Aging like milk" },
        ],
        [{ top_caption: "long sentence covering the face", bottom_right_caption: "text on the man's head" }]
      ),
    },
    {
      template_id: "laughing-leo",
      name: "Laughing Leo",
      aliases: ["Laughing Leo"],
      source_image: "/memes/seed-laughing-leo-b1c503dc.png",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_caption", "smug setup", 0.06, 0.03, 0.88, 0.18, "center", "top", 2, 42, 22, 34),
        exactRegion("bottom_caption", "amused payoff", 0.06, 0.78, 0.88, 0.18, "center", "bottom", 2, 42, 22, 34),
      ],
      caption_guidance: guidance(
        "Use Leo's laugh for smug recognition, overconfident plans, or watching an obvious mistake happen.",
        [
          { top_caption: "App finally stable", bottom_caption: "Let's rewrite it" },
          { top_caption: "They called it platform", bottom_caption: "It's six macros" },
        ],
        [{ top_caption: "full explanation", bottom_caption: "tiny unreadable text" }]
      ),
    },
    {
      template_id: "megamind-peeking",
      name: "Megamind Peeking",
      aliases: ["Megamind peeking"],
      source_image: "/memes/seed-megamind-peeking-b5887e0c.png",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_caption", "suspicious setup", 0.06, 0.02, 0.88, 0.18, "center", "top", 2, 42, 24, 44),
        exactRegion("bottom_caption", "peek reveal", 0.06, 0.8, 0.88, 0.18, "center", "bottom", 2, 42, 24, 44),
      ],
      caption_guidance: guidance(
        "Use the peeking face for suspicious consequences, awkward reveals, or looking at a self-own unfold.",
        [
          { top_caption: "Skipped tests", bottom_caption: "Shocked it broke" },
          { top_caption: "Urgent roadmap", bottom_caption: "Just vibes" },
        ],
        [{ top_caption: "long setup covering the face", bottom_caption: "tiny text over the eyes" }]
      ),
    },
    {
      template_id: "leonardo-dicaprio-cheers",
      name: "Leonardo Dicaprio Cheers",
      aliases: ["Leonardo DiCaprio Cheers"],
      source_image: "/memes/seed-leonardo-dicaprio-cheers-ba2ae9b2.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_caption", "specific win being celebrated", 0.08, 0.03, 0.84, 0.18, "center", "top", 2, 42, 24, 40),
        exactRegion("bottom_caption", "smug celebratory payoff that heightens the rarity or relief", 0.08, 0.78, 0.84, 0.18, "center", "bottom", 2, 42, 24, 40),
      ],
      caption_guidance: guidance(
        "Name the concrete win, then heighten how rare, relieving, or credit-worthy it feels. Do not merely restate the win.",
        [
          { top_caption: "Deploy stayed green", bottom_caption: "Cheers to no rollback" },
          { top_caption: "Bad idea worked", bottom_caption: "I will take credit" },
        ],
        [{ top_caption: "long sentence covering his face", bottom_caption: "tiny text over the glass" }]
      ),
    },
    {
      template_id: "oprah-you-get-a",
      name: "Oprah You Get A",
      aliases: ["Oprah You Get A"],
      source_image: "/memes/seed-oprah-you-get-a-d094a9fd.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_statement", "giveaway setup", 0.06, 0.03, 0.88, 0.18, "center", "top", 2, 42, 24, 40, 0.14),
        exactRegion("bottom_reveal", "repeated reward or punchline", 0.08, 0.78, 0.84, 0.18, "center", "bottom", 2, 40, 24, 38, 0.14),
      ],
      caption_guidance: guidance(
        "Use when everyone gets the same absurd thing, especially feature bloat or repeated asks.",
        [
          { top_statement: "New product strategy", bottom_reveal: "You get an AI button" },
          { top_statement: "Everyone gets a meeting", bottom_reveal: "And another meeting" },
        ],
        [{ top_statement: "long paragraph", bottom_reveal: "tiny caption in the crowd" }]
      ),
    },
    {
      template_id: "pawn-stars-best-i-can-do",
      name: "Pawn Stars Best I Can Do",
      aliases: ["Pawn Stars Best I Can Do"],
      source_image: "/memes/seed-pawn-stars-best-i-can-do-b48ccef3.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("left_speaker", "request or offer", 0.02, 0.05, 0.42, 0.28, "left", "top", 2, 28, 18, 30),
        exactRegion("right_reaction", "lowball response", 0.56, 0.06, 0.4, 0.3, "left", "top", 2, 28, 18, 30),
      ],
      caption_guidance: guidance(
        "Use for a request or offer getting an absurdly low counteroffer.",
        [
          { left_speaker: "Full redesign by Monday", right_reaction: "Best I can do is exposure" },
          { left_speaker: "Fix the whole system", right_reaction: "Best I can do is flag" },
        ],
        [{ left_speaker: "full backstory paragraph", right_reaction: "unrelated reply" }]
      ),
    },
    {
      template_id: "say-the-line-bart-simpsons",
      name: "Say The Line Bart",
      aliases: ["Say the Line Bart", "Say the Line Bart Simpsons"],
      source_image: "/memes/seed-say-the-line-bart-simpsons-70b5fded.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("bart_prompt", "prompt demanding the expected line", 0.06, 0.03, 0.88, 0.18, "center", "top", 2, 42, 22, 34),
        exactRegion("bart_reaction", "reluctant response", 0.1, 0.34, 0.8, 0.22, "center", "middle", 2, 36, 24, 38),
        exactRegion("crowd_chant", "crowd payoff line", 0.04, 0.78, 0.92, 0.18, "center", "bottom", 2, 48, 22, 34),
      ],
      caption_guidance: guidance(
        "Use when the timeline expects a familiar line and the punchline is repeating it anyway.",
        [
          { bart_prompt: "Say the line", bart_reaction: "It's spreadsheets", crowd_chant: "With extra steps" },
          { bart_prompt: "Say the line", bart_reaction: "It's just vibes", crowd_chant: "Roadmap!" },
        ],
        [{ bart_reaction: "long explanation", bart_prompt: "tiny caption over faces" }]
      ),
    },
    {
      template_id: "tuxedo-winnie-the-pooh",
      name: "Tuxedo Winnie The Pooh",
      aliases: ["Tuxedo Winnie The Pooh", "Fancy Pooh"],
      source_image: "/memes/seed-tuxedo-winnie-the-pooh-e064a62a.png",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_reaction", "ordinary version", 0, 0, 0.42, 0.48, "center", "middle", 3, 28, 24, 44),
        exactRegion("bottom_reaction", "fancier or worse version", 0, 0.52, 0.42, 0.46, "center", "middle", 3, 28, 24, 44),
      ],
      caption_guidance: guidance(
        "Contrast a plain option with a fancier, more overengineered, or more absurd version.",
        [
          { top_reaction: "Fix bug", bottom_reaction: "Add platform layer" },
          { top_reaction: "Spreadsheet", bottom_reaction: "Modern data platform" },
        ],
        [{ top_reaction: "long text over Pooh's face", bottom_reaction: "unrelated label" }]
      ),
    },
    {
      template_id: "two-paths",
      name: "Two Paths",
      aliases: ["Two Paths"],
      source_image: "/memes/seed-two-paths-4a9d07c2.png",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("left_path_label", "safe or correct path", 0.03, 0.03, 0.42, 0.18, "center", "top", 2, 24, 18, 34),
        exactRegion("right_path_label", "tempting chaotic path", 0.55, 0.03, 0.42, 0.18, "center", "top", 2, 24, 18, 34),
        exactRegion("decision_caption", "person choosing the path", 0.18, 0.72, 0.64, 0.22, "center", "bottom", 3, 42, 18, 30),
      ],
      caption_guidance: guidance(
        "Contrast the safe choice with the chaotic choice, then label the person choosing badly.",
        [
          { left_path_label: "Fix root cause", right_path_label: "Add feature flag", decision_caption: "Me at 4:59" },
          { left_path_label: "One metric", right_path_label: "Four dashboards", decision_caption: "The team" },
        ],
        [{ left_path_label: "the easy way", decision_caption: "long sentence that covers the path" }]
      ),
    },
    {
      template_id: "uno-draw-25-cards",
      name: "UNO Draw 25 Cards",
      aliases: ["UNO Draw 25 Cards"],
      source_image: "/memes/seed-uno-draw-25-cards-d75f95a0.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_left_card_text", "rule on the card", 0.08, 0.18, 0.34, 0.42, "center", "middle", 3, 18, 22, 44, 0.14),
        exactRegion("right_player_reaction", "person refusing the rule", 0.56, 0.08, 0.38, 0.34, "center", "top", 2, 22, 20, 40, 0.14),
        exactRegion("bottom_table_comment", "table punchline", 0.52, 0.72, 0.42, 0.22, "center", "middle", 2, 24, 18, 34),
      ],
      caption_guidance: guidance(
        "Put the unavoidable rule on the card and the refusal or consequence on the player/table.",
        [
          { top_left_card_text: "Read docs\nor +25", right_player_reaction: "Draws 25" },
          { top_left_card_text: "Pick metric\nor +25", bottom_table_comment: "Four dashboards" },
        ],
        [{ top_left_card_text: "long paragraph", right_player_reaction: "text over face" }]
      ),
    },
    {
      template_id: "waiting-skeleton",
      name: "Waiting Skeleton",
      aliases: ["Waiting Skeleton"],
      source_image: "/memes/seed-waiting-skeleton-aa1a4889.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_caption", "waiting setup", 0.08, 0.02, 0.84, 0.16, "center", "top", 2, 42, 18, 30),
        exactRegion("bottom_caption", "absurd wait punchline", 0.06, 0.8, 0.88, 0.18, "center", "bottom", 2, 48, 18, 30),
      ],
      caption_guidance: guidance(
        "Use for waiting so long that the delay itself becomes the joke.",
        [
          { top_caption: "Waiting for review", bottom_caption: "Three business eternities" },
          { top_caption: "Waiting for one decision", bottom_caption: "The roadmap fossilized" },
        ],
        [{ top_caption: "text over skull", bottom_caption: "paragraph covering skeleton" }]
      ),
    },
    {
      template_id: "yo-dawg-heard-you",
      name: "Yo Dawg Heard You",
      aliases: ["Yo Dawg Heard You"],
      source_image: "/memes/seed-yo-dawg-heard-you-6e5fb6ad.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_hook", "recursive setup", 0.06, 0.03, 0.88, 0.18, "center", "top", 2, 42, 18, 30),
        exactRegion("bottom_punchline", "recursive punchline", 0.06, 0.78, 0.88, 0.18, "center", "bottom", 2, 46, 18, 30),
      ],
      caption_guidance: guidance(
        "Use for recursive product bloat: putting the same thing inside itself.",
        [
          { top_hook: "Yo dawg, I heard you like dashboards", bottom_punchline: "So we put metrics in your metrics" },
          { top_hook: "Yo dawg, I heard you like AI", bottom_punchline: "So settings gets three AI buttons" },
        ],
        [{ top_hook: "random paragraph", bottom_punchline: "no recursive twist" }]
      ),
    },
    {
      template_id: "the-rock-driving",
      name: "The Rock Driving",
      aliases: ["The Rock Driving"],
      source_image: "/memes/seed-the-rock-driving-b5c68ffd.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_speech_bubble", "confident claim", 0.56, 0.05, 0.41, 0.22, "center", "middle", 3, 42, 20, 34),
        exactRegion("middle_speech_bubble", "ominous counterpoint", 0.56, 0.39, 0.41, 0.22, "center", "middle", 3, 42, 20, 34),
      ],
      caption_guidance: guidance(
        "Use two speech bubbles for a confident statement followed by the realization that it is about to go badly.",
        [
          { top_speech_bubble: "PR approved by vibes", middle_speech_bubble: "Blocked by silence" },
          { top_speech_bubble: "This plan is safe", middle_speech_bubble: "It was not safe" },
        ],
        [{ top_speech_bubble: "long paragraph in the bubble", middle_speech_bubble: "text outside bubble" }]
      ),
    },
    {
      template_id: "scooby-doo-mask-reveal",
      name: "Scooby Doo Mask Reveal",
      aliases: ["Scooby Doo Mask Reveal"],
      source_image: "/memes/seed-scooby-doo-mask-reveal-07c9031c.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("masked_identity", "fake surface identity", 0.06, 0.1, 0.34, 0.3, "center", "middle", 3, 28, 28, 44),
        exactRegion("revealed_identity", "true revealed identity", 0.06, 0.58, 0.34, 0.3, "center", "middle", 3, 28, 28, 44),
        exactRegion("revealer_action", "optional revealing action", 0.48, 0.18, 0.22, 0.22, "center", "middle", 2, 18, 24, 36),
      ],
      caption_guidance: guidance(
        "Label the fake identity, then reveal the actual cause underneath.",
        [
          { masked_identity: "Roadmap", revealed_identity: "Vibes in a deck" },
          { masked_identity: "Platform", revealed_identity: "Spreadsheet macros" },
        ],
        [{ masked_identity: "long sentence that will not fit", revealed_identity: "same thing repeated" }]
      ),
    },
    {
      template_id: "running-away-balloon",
      name: "Running Away Balloon",
      aliases: ["Running Away Balloon"],
      source_image: "/memes/seed-running-away-balloon-741cda07.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_setup", "initial goal or desire", 0.05, 0.03, 0.42, 0.22, "left", "top", 2, 28, 28, 44),
        exactRegion("top_target", "tempting goal", 0.6, 0.03, 0.35, 0.22, "center", "top", 2, 22, 28, 44),
        exactRegion("bottom_interference", "chaotic blocker", 0.05, 0.56, 0.42, 0.38, "left", "top", 3, 34, 26, 40),
        exactRegion("bottom_target", "blocked target", 0.74, 0.56, 0.22, 0.34, "center", "top", 2, 18, 24, 38),
      ],
      caption_guidance: guidance(
        "Show someone reaching for a simple goal, then reveal the chaotic blocker dragging them away.",
        [
          { top_setup: "Trying to focus", top_target: "Work", bottom_interference: "Every notification" },
          { top_setup: "Ship cleanly", top_target: "Launch", bottom_interference: "Friday deploy" },
        ],
        [{ top_setup: "long life story", bottom_target: "detailed economics lecture" }]
      ),
    },
    {
      template_id: "the-scroll-of-truth",
      name: "The Scroll Of Truth",
      aliases: ["The Scroll Of Truth"],
      source_image: "/memes/seed-the-scroll-of-truth-fe819b80.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("scroll_text", "truth revealed on the scroll", 0.18, 0.4, 0.24, 0.34, "center", "middle", 4, 36, 34, 72),
        exactRegion("top_left_reaction", "setup or discovery line", 0.06, 0.02, 0.38, 0.14, "center", "middle", 2, 32, 30, 58),
      ],
      caption_guidance: guidance(
        "Use the bubble as the search for truth and the scroll as the blunt disappointing answer.",
        [
          { top_left_reaction: "I found the answer", scroll_text: "Read the logs" },
          { top_left_reaction: "Show me roadmap", scroll_text: "It's vibes" },
        ],
        [{ top_left_reaction: "tiny corner caption", scroll_text: "unrelated word" }]
      ),
    },
    {
      template_id: "buff-doge-vs-cheems",
      name: "Buff Doge vs Cheems",
      aliases: ["Buff Doge vs. Cheems", "Buff Doge vs Cheems"],
      source_image: "/memes/seed-buff-doge-vs-cheems-66c52ac6.png",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("buff_doge_label", "strong confident version", 0.03, 0.06, 0.42, 0.22, "center", "top", 2, 18, 28, 54, 0.14),
        exactRegion("cheems_label", "weak anxious version", 0.68, 0.1, 0.28, 0.22, "center", "top", 2, 18, 28, 54, 0.14),
      ],
      caption_guidance: guidance(
        "Contrast the strong ideal version with the weaker anxious version.",
        [
          { buff_doge_label: "Past me", cheems_label: "Me now" },
          { buff_doge_label: "Docs reader", cheems_label: "Slack asker" },
        ],
        [{ buff_doge_label: "long sentence over doge", cheems_label: "tiny face label" }]
      ),
    },
    {
      template_id: "inhaling-seagull",
      name: "Inhaling Seagull",
      aliases: ["Inhaling Seagull"],
      source_image: "/memes/seed-inhaling-seagull-82fa7183.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("setup", "calm setup", 0.06, 0.02, 0.88, 0.16, "center", "top", 2, 42, 42, 72),
        exactRegion("reaction", "screaming escalation", 0.08, 0.72, 0.84, 0.22, "center", "middle", 3, 48, 44, 72),
      ],
      caption_guidance: guidance(
        "Use a calm setup followed by a loud overreaction or escalating scream.",
        [
          { setup: "Quick question", reaction: "Twelve-message essay" },
          { setup: "One tiny change", reaction: "Full rewrite" },
        ],
        [{ setup: "bird biology paragraph", reaction: "no escalation" }]
      ),
    },
    {
      template_id: "they-don-t-know",
      name: "They Don't Know",
      aliases: ["They don't know"],
      source_image: "/memes/seed-they-don-t-know-5ac7e661.png",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_left_observer", "outsider with hidden knowledge", 0.06, 0.02, 0.24, 0.28, "center", "top", 3, 28, 22, 40),
        exactRegion("bottom_left_pair", "unaware group label", 0, 0.64, 0.42, 0.34, "left", "bottom", 3, 34, 22, 38),
        exactRegion("right_couple", "main oblivious subject", 0.56, 0.22, 0.4, 0.56, "center", "middle", 4, 42, 22, 38),
      ],
      caption_guidance: guidance(
        "Contrast the person who knows the awkward truth with everyone acting normal.",
        [
          { top_left_observer: "I know staging", right_couple: "Everyone blaming API" },
          { top_left_observer: "Saw the roadmap", right_couple: "They think it's planned" },
        ],
        [{ top_left_observer: "long backstory paragraph", bottom_left_pair: "text over faces" }]
      ),
    },
    {
      template_id: "charlie-conspiracy-always-sunny-in-philidelphia",
      name: "Charlie Conspiracy",
      aliases: ["Charlie Conspiracy", "Always Sunny Conspiracy"],
      source_image: "/memes/seed-charlie-conspiracy-always-sunny-in-philidelphia-55bf4837.jpg",
      supports_overlay: true,
      quality: "verified",
      regions: [
        exactRegion("top_left_claim", "frantic first claim", 0.03, 0.03, 0.42, 0.18, "left", "top", 2, 34, 28, 44),
        exactRegion("top_right_counterclaim", "contradicting detail", 0.56, 0.03, 0.4, 0.18, "right", "top", 2, 34, 28, 44),
        exactRegion("bottom_left_reveal", "absurd conclusion", 0.03, 0.78, 0.44, 0.18, "left", "bottom", 2, 34, 28, 44),
      ],
      caption_guidance: guidance(
        "Use as a frantic conspiracy-board explanation with an absurd final conclusion.",
        [
          { top_left_claim: "The roadmap moved", top_right_counterclaim: "But nobody chose", bottom_left_reveal: "It's indecision" },
          { top_left_claim: "Metrics disagree", top_right_counterclaim: "Dashboards multiply", bottom_left_reveal: "No one knows" },
        ],
        [{ top_left_claim: "very long unreadable sentence", top_right_counterclaim: "happy birthday" }]
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
        {
          ...region("quote", "mocked quote", 0.05, 0.05, 0.9, 0.2, 3, 54, 0.9),
          text_transform: "mocking" as const,
        },
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

function exactRegion(
  id: string,
  role: string,
  x: number,
  y: number,
  width: number,
  height: number,
  align: "left" | "center" | "right",
  valign: "top" | "middle" | "bottom",
  maxLines: number,
  maxChars: number,
  minSize: number,
  maxSize: number,
  strokeRatio = 0.12
) {
  return {
    id,
    role,
    x,
    y,
    width,
    height,
    align,
    valign,
    max_lines: maxLines,
    max_chars: maxChars,
    font: {
      family: "Impact" as const,
      min_size: minSize,
      max_size: maxSize,
      stroke_ratio: strokeRatio,
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
