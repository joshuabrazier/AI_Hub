// -------------------------------------------------------------------
// House voice.
//
// WHAT THIS IS FOR, AND WHAT IT DELIBERATELY IS NOT.
//
// It makes model output sound like this organisation wrote it: our register,
// our vocabulary, the phrases we do not use. It does NOT imitate a named
// individual, and that limit is evidence-based rather than cautious.
//
// PersonalBench (50 authors, 1,000 generations) measured author similarity
// with LUAR authorship verification. Every inference-time method scored in a
// band of 0.024:
//
//   non-personalised control   0.484
//   five-shot examples         0.508
//   extracted style profile    0.502
//   contrastive + stylometry   0.494
//   ---
//   cross-author FLOOR         0.626
//   real author CEILING        0.756
//
// Read the floor twice. Every method landed BELOW the score a randomly
// chosen different human gets against the target - the model's own
// fingerprint dominates whatever it is conditioned with. Individual
// impersonation is not available at inference time; the paper's own
// conclusion is that closing that gap needs training-time adaptation
// (LoRA, style-reward RL), which is not reachable through Bedrock Converse
// on a pinned model.
//
// A HOUSE voice is a different and much easier target, and the same
// technique does deliver it. Two findings from the same literature shape
// everything below:
//
//   - Examples plateau fast. Going from 2 to 10 samples produced negligible
//     gains, so this caps them (see MAX_VOICE_EXAMPLES) rather than letting
//     a well-meaning edit pay per-request tokens for nothing.
//   - Structured registers work far better than casual ones - 95% authorship
//     accuracy on news articles against 64% on forum posts. So this is aimed
//     at the writing the app actually produces: replies, summaries, drafts.
//
// AND ONE WARNING WORTH MORE THAN THE REST. In that study an
// LLM-as-judge rated the extracted-profile method best (0.542 trait match)
// while LUAR showed no improvement at all - the judge was scoring
// instruction-following, not style. If this is ever measured, an LLM judge
// on its own will report success whether or not any exists.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// The cap on worked examples.
//
// Five, because the measured curve is flat from about two and every example
// is resent on every request. Raising this buys tokens, not fidelity.
// -------------------------------------------------------------------
export const MAX_VOICE_EXAMPLES = 5;

export type VoiceExample = {
  /** What was asked for. */
  brief: string;
  /** What we would actually have written. */
  written: string;
};

export type HouseVoiceProfile = {
  /**
   * How we write, as testable instructions rather than adjectives. "Sound
   * professional" is unfollowable; "no sentence over 25 words" is not.
   */
  rules: string[];
  /**
   * What we never do. Kept separate from `rules` because a prohibition is
   * the more reliable half - a model can comply with "avoid X" exactly,
   * where "be warm" it has to interpret. This is also where the phrases
   * that make text read as machine-written belong.
   */
  avoid: string[];
  /**
   * Brief-and-response pairs. PAIRED on purpose: an unpaired sample teaches
   * the model what we write ABOUT, and a pair teaches it what we do with a
   * request. Capped at MAX_VOICE_EXAMPLES.
   */
  examples: VoiceExample[];
};

// -------------------------------------------------------------------
// The shipped profile.
//
// Derived from what this repo already enforces on itself - the dash rule,
// the ban on filler openers, the habit of saying why rather than only what -
// so the assistant's prose matches the codebase and the docs around it
// instead of being a second, blander house style.
//
// Australian English is stated because the model will otherwise drift to
// American spelling mid-paragraph, which reads as machine-written faster
// than almost anything else on this list.
// -------------------------------------------------------------------
export const HOUSE_VOICE: HouseVoiceProfile = {
  rules: [
    "Write in Australian English: organisation, summarise, recognise, licence as a noun.",
    "Lead with the answer, then the reasoning. Never build up to a conclusion.",
    "Say why something is the case, not only what is the case - a claim without a reason reads as filler.",
    "Prefer a plain short word to a formal long one: use rather than utilise, before rather than prior to, about rather than regarding.",
    "Keep sentences under about 25 words. Break a longer one in two.",
    "Give a number or a name where there is one, instead of 'several' or 'a number of'.",
    "When something is uncertain, say so in the sentence that makes the claim, not in a caveat afterwards.",
  ],
  avoid: [
    "Em dashes and en dashes. Use a hyphen, a comma, or a full stop.",
    "Opening with filler: Certainly, Of course, Great question, I hope this finds you well.",
    "Closing with an offer nobody asked for: Let me know if you need anything else.",
    "Consultant vocabulary: leverage, utilise, synergy, robust, seamless, streamline, deep dive, circle back, going forward, at this juncture.",
    "Announcing structure instead of writing it: In this document we will, It is worth noting that, As mentioned above.",
    "Hedging stacks: it may potentially be possible that.",
    "Rhetorical questions, and 'not just X, but Y' constructions.",
    "Emoji, and exclamation marks outside direct quotation.",
  ],
  examples: [
    {
      brief: "Tell the team the Friday deploy is postponed because a migration is not ready.",
      written:
        "Friday's deploy is off. The migration behind it is not ready, and shipping the code without it would take the app down rather than degrade it.\n\nNew target is Tuesday. Nothing else in the release changes.",
    },
    {
      brief: "Reply to a client asking why last month's invoice is higher than usual.",
      written:
        "The March invoice is higher because of the data migration work in weeks two and three - 34 hours against a normal month's 12.\n\nThat work is finished, so April should return to the usual range. I have attached the breakdown by day if you want to see where it went.",
    },
    {
      brief: "Summarise a meeting where a decision was deferred.",
      written:
        "No decision on the reporting tool. Sam wants to see the migration cost before committing, and that estimate is not done.\n\nAgreed: Priya scopes the migration by the 14th, and we decide at the next fortnightly. Nobody is doing further evaluation until then.",
    },
  ],
};

// -------------------------------------------------------------------
// Render the profile into a system block.
//
// XML tags rather than markdown headings, which is the structure Anthropic
// documents for this: they delimit unambiguously, so a rule containing a
// colon or a dash cannot be read as the start of a new section, and an
// example containing markdown cannot be mistaken for instructions.
//
// ORDER MATTERS AND IS DELIBERATE. Rules, then prohibitions, then worked
// examples. The examples go last because they are the longest part and the
// most likely to be edited - and everything before them stays byte-identical
// when they change, which is what a cached prefix needs.
//
// Returns null for an empty profile rather than an empty tag pair, so a
// caller can leave the block out entirely instead of sending the model a
// heading with nothing under it.
// -------------------------------------------------------------------
export function buildHouseVoiceBlock(profile: HouseVoiceProfile = HOUSE_VOICE): string | null {
  const rules = profile.rules.filter((rule) => rule.trim().length > 0);
  const avoid = profile.avoid.filter((rule) => rule.trim().length > 0);

  // Truncated rather than rejected. A profile that grew past the cap is a
  // reasonable thing for somebody to have written, and silently paying for
  // examples that do not improve the output is the failure worth avoiding.
  const examples = profile.examples
    .filter((example) => example.brief.trim().length > 0 && example.written.trim().length > 0)
    .slice(0, MAX_VOICE_EXAMPLES);

  if (rules.length === 0 && avoid.length === 0 && examples.length === 0) return null;

  const sections: string[] = [
    "Write as this organisation writes. The voice below is not a suggestion - it is how our text looks, and matching it matters as much as being correct.",
  ];

  if (rules.length > 0) {
    sections.push(`<voice_rules>\n${rules.map((rule) => `- ${rule}`).join("\n")}\n</voice_rules>`);
  }

  if (avoid.length > 0) {
    sections.push(
      `<never_do>\n${avoid.map((rule) => `- ${rule}`).join("\n")}\n</never_do>`,
    );
  }

  if (examples.length > 0) {
    const rendered = examples
      .map(
        (example) =>
          `<example>\n<brief>${example.brief.trim()}</brief>\n<written>${example.written.trim()}</written>\n</example>`,
      )
      .join("\n");

    sections.push(
      `<voice_examples>\nWhat we would have written, given the brief. Match the shape and the register, not the subject.\n${rendered}\n</voice_examples>`,
    );
  }

  return sections.join("\n\n");
}

// -------------------------------------------------------------------
// The instruction that turns a profile into a style EXTRACTOR.
//
// The one part of the literature that is unambiguously worth copying: ask
// the model to describe the style of a set of samples, and it names things
// people cannot articulate about their own writing - sentence rhythm,
// punctuation habits, how they open. Use the output as a starting profile
// and edit it; do not wire it into a request path.
//
// "Never mention the subject matter" is the load-bearing line. Without it
// the description comes back as a summary of what the samples were about,
// which is exactly the confusion that makes unpaired examples teach topic
// instead of voice.
// -------------------------------------------------------------------
export const VOICE_EXTRACTION_PROMPT = [
  "Below are several pieces of writing by the same organisation.",
  "Describe their writing style so precisely that somebody else could imitate it without seeing the samples.",
  "Cover: sentence length and rhythm, vocabulary level, how they open and close, punctuation habits, use of lists and headings, how they express uncertainty, and anything they conspicuously never do.",
  "Give testable instructions, not adjectives: 'sentences average 15 words' rather than 'concise'.",
  "Never mention the subject matter of the samples. You are describing how they write, not what they wrote about.",
].join(" ");
