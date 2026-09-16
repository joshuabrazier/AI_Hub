import { describe, expect, it } from "vitest";

import { extractFigures } from "./meaning-check";
import {
  HOUSE_VOICE,
  HOUSE_VOICE_REWRITES,
  MAX_VOICE_EXAMPLES,
  REWRITE_RULES,
  VOICE_EXTRACTION_PROMPT,
  buildHouseVoiceBlock,
  buildHouseVoiceRewriteBlock,
  type HouseVoiceProfile,
} from "./house-voice";

const profile = (overrides: Partial<HouseVoiceProfile> = {}): HouseVoiceProfile => ({
  rules: [],
  avoid: [],
  examples: [],
  ...overrides,
});

describe("buildHouseVoiceBlock", () => {
  it("returns null for an empty profile rather than an empty tag pair", () => {
    // A heading with nothing under it is worse than no block: it spends
    // tokens and tells the model a section exists that it cannot read.
    expect(buildHouseVoiceBlock(profile())).toBeNull();
  });

  it("returns null when every entry is blank", () => {
    expect(
      buildHouseVoiceBlock(profile({ rules: ["", "   "], avoid: [" "] })),
    ).toBeNull();
  });

  it("wraps each section in its own tag", () => {
    const block = buildHouseVoiceBlock(
      profile({
        rules: ["Lead with the answer."],
        avoid: ["Em dashes."],
        examples: [{ brief: "Say no to a deploy.", written: "Friday's deploy is off." }],
      }),
    );

    expect(block).toContain("<voice_rules>");
    expect(block).toContain("<never_do>");
    expect(block).toContain("<voice_examples>");
    expect(block).toContain("<brief>Say no to a deploy.</brief>");
    expect(block).toContain("<written>Friday's deploy is off.</written>");
  });

  it("omits a section that has no entries", () => {
    // Only rules given, so there must be no prohibitions or examples
    // heading - an empty one reads as "we have no rules about this".
    const block = buildHouseVoiceBlock(profile({ rules: ["Lead with the answer."] }));

    expect(block).toContain("<voice_rules>");
    expect(block).not.toContain("<never_do>");
    expect(block).not.toContain("<voice_examples>");
  });

  it("orders rules before prohibitions before examples", () => {
    // The order is what keeps the cached prefix stable: examples are the
    // longest and most-edited part, so everything cheap sits ahead of them.
    const block = buildHouseVoiceBlock(
      profile({
        rules: ["A rule."],
        avoid: ["A prohibition."],
        examples: [{ brief: "b", written: "w" }],
      }),
    ) as string;

    expect(block.indexOf("<voice_rules>")).toBeLessThan(block.indexOf("<never_do>"));
    expect(block.indexOf("<never_do>")).toBeLessThan(block.indexOf("<voice_examples>"));
  });

  it("caps examples at the measured ceiling instead of paying for more", () => {
    // Going from 2 to 10 samples produced negligible gains in the
    // literature, and every example is resent on every request. A profile
    // that grew past the cap is truncated, not rejected.
    const many = Array.from({ length: MAX_VOICE_EXAMPLES + 4 }, (_, index) => ({
      brief: `brief ${index}`,
      written: `written ${index}`,
    }));

    const block = buildHouseVoiceBlock(profile({ examples: many })) as string;

    expect(block.match(/<example>/g)).toHaveLength(MAX_VOICE_EXAMPLES);
    expect(block).toContain("brief 0");
    expect(block).not.toContain(`brief ${MAX_VOICE_EXAMPLES}`);
  });

  it("drops a half-written example rather than sending an empty side", () => {
    // A pair with nothing on one side teaches the model that a brief can be
    // answered with silence, which is the opposite of the point.
    const block = buildHouseVoiceBlock(
      profile({
        examples: [
          { brief: "kept", written: "kept output" },
          { brief: "orphan", written: "   " },
          { brief: "", written: "orphan output" },
        ],
      }),
    ) as string;

    expect(block.match(/<example>/g)).toHaveLength(1);
    expect(block).toContain("kept");
    expect(block).not.toContain("orphan");
  });
});

describe("the shipped profile", () => {
  it("renders", () => {
    expect(buildHouseVoiceBlock(HOUSE_VOICE)).not.toBeNull();
  });

  it("stays inside the example cap", () => {
    // Guards the file itself, not the builder: the builder would silently
    // truncate, so an edit that added a sixth example would cost tokens on
    // every request and never appear in the prompt.
    expect(HOUSE_VOICE.examples.length).toBeLessThanOrEqual(MAX_VOICE_EXAMPLES);
  });

  it("carries prohibitions, which are the half that actually lands", () => {
    // A profile of only positive rules is the common failure. "Be concise"
    // is interpreted; "never open with Certainly" is obeyed.
    expect(HOUSE_VOICE.avoid.length).toBeGreaterThan(0);
  });

  it("obeys its own dash rule", () => {
    // The repo bans em and en dashes in every kind of text it produces, and
    // a voice profile telling the model not to use them while using them is
    // the one inconsistency the model is most likely to copy.
    const everything = [
      ...HOUSE_VOICE.rules,
      ...HOUSE_VOICE.avoid,
      ...HOUSE_VOICE.examples.flatMap((example) => [example.brief, example.written]),
    ].join(" ");

    expect(everything).not.toMatch(/[–—]/);
  });

  it("gives testable instructions rather than adjectives", () => {
    // Not exhaustive, but it catches the drift back towards "be
    // professional" - a rule a model cannot check itself against.
    const vague = ["professional", "engaging", "high-quality", "best practice"];

    for (const word of vague) {
      expect(HOUSE_VOICE.rules.join(" ").toLowerCase(), word).not.toContain(word);
    }
  });
});

describe("VOICE_EXTRACTION_PROMPT", () => {
  it("forbids describing the subject matter", () => {
    // The load-bearing line. Without it the model returns a summary of what
    // the samples were about, which is the same confusion that makes
    // unpaired examples teach topic instead of voice.
    expect(VOICE_EXTRACTION_PROMPT.toLowerCase()).toContain("never mention the subject matter");
  });

  it("asks for testable instructions", () => {
    expect(VOICE_EXTRACTION_PROMPT.toLowerCase()).toContain("not adjectives");
  });
});

// -------------------------------------------------------------------
// The rewrite voice.
//
// The interesting assertions here are not about the string shape - they are
// about the CLAIMS the file's header makes. A comment citing a study is
// worth nothing if the data underneath it quietly stops matching, so the
// properties those citations argue for are pinned.
// -------------------------------------------------------------------
describe("buildHouseVoiceRewriteBlock", () => {
  it("still returns rules for an EMPTY profile with no examples, unlike its sibling", () => {
    // The difference is deliberate. buildHouseVoiceBlock describes only this
    // organisation's voice, so an empty profile has nothing to say and it
    // returns null. These rules are about what makes any English prose read
    // as machine-written, so they hold for a deployment that has never
    // written a house rule - and they are the half that moves the output.
    const block = buildHouseVoiceRewriteBlock(profile(), []);

    expect(block).toContain("Vary sentence length on purpose.");
    expect(block).not.toContain("<never_do>");
    expect(block).not.toContain("<example>");
  });

  it("uses before and after tags, not brief and written", () => {
    // The whole reason this function exists. Brief-to-written demonstrates
    // generating from a request, and handed a finished paragraph the model
    // treats it as the brief - which is how a figure gets invented.
    const block = buildHouseVoiceRewriteBlock();

    expect(block).toContain("<before>");
    expect(block).toContain("<after>");
    expect(block).not.toContain("<brief>");
    expect(block).not.toContain("<written>");
  });

  it("tells the model to match the edit rather than the subject", () => {
    expect(buildHouseVoiceRewriteBlock()).toContain("Match the EDIT, not the subject.");
  });

  it("carries the profile's own rules AND the rewrite rules", () => {
    const block = buildHouseVoiceRewriteBlock(profile({ rules: ["Write in Australian English."] }));

    expect(block).toContain("Write in Australian English.");
    expect(block).toContain("Vary sentence length on purpose.");
  });

  it("keeps the profile's prohibitions, which carry over unchanged", () => {
    const block = buildHouseVoiceRewriteBlock(profile({ avoid: ["Em dashes."] }));

    expect(block).toContain("<never_do>");
    expect(block).toContain("Em dashes.");
  });

  it("caps examples at MAX_VOICE_EXAMPLES", () => {
    const many = Array.from({ length: MAX_VOICE_EXAMPLES + 4 }, (_, i) => ({
      before: `before ${i}`,
      after: `after ${i}`,
    }));

    const block = buildHouseVoiceRewriteBlock(profile(), many) ?? "";

    expect(block.split("<example>")).toHaveLength(MAX_VOICE_EXAMPLES + 1);
  });

  it("drops a half-written pair rather than rendering an empty tag", () => {
    const block = buildHouseVoiceRewriteBlock(profile(), [{ before: "something", after: "   " }]) ?? "";

    expect(block).not.toContain("<example>");
  });

  it("orders rules, then prohibitions, then examples, for the cached prefix", () => {
    // Same ordering as buildHouseVoiceBlock and for the same reason: the
    // longest and most-edited part goes last, so everything before it stays
    // byte-identical when the examples change.
    const block =
      buildHouseVoiceRewriteBlock(profile({ rules: ["A rule."], avoid: ["A prohibition."] })) ?? "";

    expect(block.indexOf("<voice_rules>")).toBeLessThan(block.indexOf("<never_do>"));
    expect(block.indexOf("<never_do>")).toBeLessThan(block.indexOf("<rewrite_examples>"));
  });
});

describe("the shipped rewrite pairs", () => {
  // Sentence splitting good enough for a length check. Not exported,
  // because nothing outside this assertion needs it.
  const sentences = (text: string) =>
    text
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0);

  const words = (sentence: string) => sentence.split(/\s+/).filter(Boolean).length;

  it("DEMONSTRATES the variance rule rather than averaging it away", () => {
    // The header argues few-shot examples flatten rhythm, and rhythm is this
    // feature's main lever. That makes the pairs themselves the mitigation:
    // an `after` of uniform sentence length teaches the opposite of the rule
    // sitting above it, and nothing else in the build would notice.
    for (const example of HOUSE_VOICE_REWRITES) {
      const lengths = sentences(example.after).map(words);

      expect(Math.min(...lengths), `short sentence in: ${example.after}`).toBeLessThan(8);
      expect(Math.max(...lengths), `long sentence in: ${example.after}`).toBeGreaterThan(25);
    }
  });

  it("puts consultant vocabulary on the BEFORE side and never on the after", () => {
    // A pair only teaches a removal if the thing being removed is present in
    // one half and absent from the other.
    const tells = ["leverage", "utilise", "comprehensive", "it is worth noting", "rest assured"];
    const before = HOUSE_VOICE_REWRITES.map((example) => example.before.toLowerCase()).join(" ");
    const after = HOUSE_VOICE_REWRITES.map((example) => example.after.toLowerCase()).join(" ");

    expect(tells.some((tell) => before.includes(tell))).toBe(true);

    for (const tell of tells) {
      expect(after, tell).not.toContain(tell);
    }
  });

  it("keeps the figures across each pair, because the examples model the safety rule too", () => {
    // An example that dropped a number would teach the model that dropping
    // numbers is what we do.
    for (const example of HOUSE_VOICE_REWRITES) {
      for (const figure of extractFigures(example.before)) {
        expect(extractFigures(example.after), `${figure} in: ${example.after}`).toContain(figure);
      }
    }
  });

  it("never uses an em dash or an en dash, which the house rules forbid", () => {
    for (const example of HOUSE_VOICE_REWRITES) {
      expect(example.after).not.toMatch(/[–—]/);
    }
  });
});

describe("REWRITE_RULES", () => {
  it("leads with structure, which is what the measurement says matters most", () => {
    // 50% of human articles wrongly called AI were flagged on sentence
    // structure against 31% on vocabulary, so a rules list that opened with
    // word choice would be ordered by intuition rather than by evidence.
    expect(REWRITE_RULES[0].toLowerCase()).toContain("sentence length");
  });

  it("tells the model to REPEAT a noun rather than vary it", () => {
    // The opposite of the usual advice, and deliberately so: LLM output is
    // measurably MORE lexically diverse than human writing, so synonym
    // hunting is itself the tell.
    const joined = REWRITE_RULES.join(" ").toLowerCase();

    expect(joined).toContain("repeat a key noun");
    expect(joined).not.toContain("vary your word choice");
  });

  it("is written as countable instructions rather than adjectives", () => {
    // "Sound natural" is unfollowable. Every rule here has to be something
    // the model can check itself against.
    const vague = ["engaging", "natural-sounding", "high-quality", "authentic"];

    for (const word of vague) {
      expect(REWRITE_RULES.join(" ").toLowerCase(), word).not.toContain(word);
    }
  });
});
