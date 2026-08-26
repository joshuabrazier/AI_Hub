import { describe, expect, it } from "vitest";

import {
  HOUSE_VOICE,
  MAX_VOICE_EXAMPLES,
  VOICE_EXTRACTION_PROMPT,
  buildHouseVoiceBlock,
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
