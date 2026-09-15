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

// ===================================================================
// THE SAME VOICE, FOR A REWRITE RATHER THAN A GENERATION
// ===================================================================
//
// A SIBLING FUNCTION, NOT AN OPTION ON THE ONE ABOVE. Chat caches its system
// prefix, which needs buildHouseVoiceBlock's output to stay byte-identical -
// so the rewriter gets its own builder rather than a branch inside that one.
//
// AND IT NEEDS DIFFERENT EXAMPLES, which is the whole reason this exists.
// Every shipped VoiceExample puts a REQUEST on the brief side, and the
// section header says "what we would have written, given the brief". Hand a
// model five demonstrations of request-to-prose and then hand it a finished
// paragraph, and the nearest thing to that paragraph in the demonstrated
// mapping is the BRIEF - so it generates from the draft instead of editing
// it, which is precisely the mechanism by which a figure gets invented and a
// caveat gets dropped. A generation pair also cannot show anything being
// REMOVED, and removal is most of what this task is.
//
// `rules` and `avoid` carry over untouched. They describe the target prose,
// which is the same prose either way, and forking them would give the
// organisation two house styles that drift apart silently.
// -------------------------------------------------------------------

export type RewriteExample = {
  /** A draft as somebody handed it over, or as a model produced it. */
  before: string;
  /** The same content after we rewrote it. Same facts, our voice. */
  after: string;
};

// -------------------------------------------------------------------
// WHAT ACTUALLY MAKES A READER THINK "A MACHINE WROTE THIS", ranked by the
// only measurement available of the cue firing with NO AI in the room.
//
// Russell, Karpinska and Iyyer (ACL 2025, arXiv:2501.15654) looked at
// human-written articles that expert annotators wrongly called AI, and what
// tripped them was not vocabulary first:
//
//   50%  SENTENCE STRUCTURE - contiguous blocks of similar-length
//        sentences, and multiple lists of three
//   31%  vocabulary
//
// The `avoid` array above is 7 of 8 vocabulary, openers and punctuation, so
// on its own it trims the smaller half. These rules put the structural half
// back, and they are ordered by that weighting rather than by intuition.
//
// TWO RULES HERE ARE THE OPPOSITE OF THE USUAL ADVICE, and both are measured:
//
//   NO "VARY YOUR WORD CHOICE". The folk belief is backwards. LLM output is
//   MORE lexically diverse than human writing, not less - close-repetition
//   dispersion of 4.8 to 5.8 against 16.4 for humans (arXiv:2508.00086), and
//   a type-token ratio of 0.883 against 0.770 (arXiv:2507.10475). Reaching
//   for a synonym is itself the machine tell, so the rule below says repeat
//   the noun.
//
//   NO TEMPERATURE. Raising it to break up uniform rhythm is folklore that
//   has been measured: temperature correlates weakly with novelty and
//   MODERATELY WITH INCOHERENCE, with no relationship to cohesion
//   (Peeperkorn et al., ICCC 2024, arXiv:2405.00492). Rhythm is a
//   distributional property, and a countable instruction targets it directly
//   where a sampling knob does not. The caller sets maxTokens and nothing
//   else.
//
// AND THE OBJECTIVE IS A READER, NEVER A DETECTOR. In the same ACL study,
// humanization tools substantially degraded automatic detectors while expert
// annotators still scored 100% on the humanized text. Surface paraphrase
// moves the detector and not the person - so there is no detector here, no
// score, and no deliberate imperfection. Never evaluate this with a detector
// number: that number improves under exactly the shallow edits that do not
// work on people.
// -------------------------------------------------------------------
export const REWRITE_RULES = [
  "Vary sentence length on purpose. In each paragraph use at least one sentence under 8 words and at least one over 25.",
  "Break up any run of three or more sentences of similar length. Uniform rhythm is the single most common reason a person calls writing machine-made.",
  "Do not use a three-item list unless the source itself had exactly three things. Rule-of-three phrasing is the second most common reason.",
  "Repeat a key noun rather than reaching for a synonym. Synonym-hunting reads as machine-written, because a model varies its vocabulary more than a person does.",
  "Use contractions where somebody would say them aloud.",
  "Buy punctuation variety: a colon, a semicolon, a bracketed aside, an occasional deliberate fragment.",
  "Delete any sentence that only restates the one before it.",
  "End where the source ends, even if it feels abrupt. Do not add a closing summary or an offer of further help.",
];

// -------------------------------------------------------------------
// THREE PAIRS, AND THE COUNT IS A DECISION rather than the cap applied
// twice.
//
// MAX_VOICE_EXAMPLES stays 5 and is the ceiling here too, but the shipped
// set is three. A stylometric comparison of human and AI creative writing
// (Nature HSSC s41599-025-05986-3) reports that adding two examples to a
// prompt pushed output towards shorter sentences with the LOWEST
// sentence-length variability of any condition tested. Few-shot flattens
// rhythm, and rhythm is this feature's main lever.
//
// THAT CLAIM IS MARKED RATHER THAN ASSERTED: it is the one load-bearing
// finding in the research behind this file that could not be read at source,
// because the article sits behind an auth wall. It is a reason to be
// sparing, not a measurement to build on.
//
// THE MITIGATION IS IN THE PAIRS THEMSELVES AND IS UNIT-TESTED: every
// `after` half carries a sentence under 8 words and one over 25, so the
// examples DEMONSTRATE the variance rule rather than averaging it away.
// -------------------------------------------------------------------
export const HOUSE_VOICE_REWRITES: RewriteExample[] = [
  {
    before:
      "We are pleased to inform you that we have successfully completed a comprehensive review of your current data infrastructure. Our analysis has identified several key opportunities for optimisation. We would be delighted to schedule a follow-up discussion at your earliest convenience to explore these findings in greater detail.",
    after:
      "The infrastructure review is done. We found three things worth changing, and one of them is costing you money right now: the nightly export runs twice, so you are paying for the same compute in duplicate.\n\nHappy to walk through it whenever suits.",
  },
  {
    before:
      "It is worth noting that the migration timeline may potentially be impacted by a number of external dependencies. In order to mitigate this risk, we will be leveraging a phased approach that will enable us to deliver incremental value while maintaining operational continuity throughout the transition period.",
    after:
      "The timeline depends on two things we do not control: the vendor's API cutover in March, and your finance team signing off the mapping.\n\nSo we are moving in stages. Each stage stands on its own, which means that if the March cutover slips you still have everything from stage one running exactly as it does now. Nothing switches off until the thing replacing it is live.",
  },
  {
    before:
      "Thank you for reaching out regarding the discrepancy in last month's figures. We have conducted a thorough investigation and can confirm that the variance was attributable to a duplicate entry in the source system. Rest assured, we have implemented appropriate measures to prevent recurrence going forward.",
    after:
      "You were right about the figures. A duplicate row in the source system counted the same 240 units twice, and that duplicate is where the whole of the variance you spotted came from.\n\nIt is corrected, and the import now rejects a duplicate reference instead of loading it. I have not back-checked the months before March. Say the word if you want that done.",
  },
];

// -------------------------------------------------------------------
// Render the voice as instructions for an EDIT.
//
// Same order as buildHouseVoiceBlock and for the same caching reason: rules,
// then prohibitions, then examples, with the longest and most-edited part
// last.
//
// The rewrite rules are APPENDED to the profile's own rather than
// substituted for them - the profile says how our prose reads, and these say
// what to do to somebody else's draft to get there.
// -------------------------------------------------------------------
// RETURNS A STRING, NEVER NULL, which is where it differs from the builder
// above and is not an oversight. That one describes only THIS organisation's
// voice, so an empty profile means there is nothing to say. These rules are
// about what makes any English prose read as machine-written, so they apply
// to a deployment that has never written a house rule - and they are the half
// that actually moves the output. A caller therefore has no null to handle.
export function buildHouseVoiceRewriteBlock(
  profile: HouseVoiceProfile = HOUSE_VOICE,
  rewrites: readonly RewriteExample[] = HOUSE_VOICE_REWRITES,
): string {
  const rules = [...profile.rules.filter((rule) => rule.trim().length > 0), ...REWRITE_RULES];
  const avoid = profile.avoid.filter((rule) => rule.trim().length > 0);

  // Truncated rather than rejected, matching buildHouseVoiceBlock: a profile
  // that grew past the cap is a reasonable thing for somebody to have
  // written, and paying for examples that do not improve the output is the
  // failure worth avoiding.
  const examples = rewrites
    .filter((example) => example.before.trim().length > 0 && example.after.trim().length > 0)
    .slice(0, MAX_VOICE_EXAMPLES);

  const sections: string[] = [
    "Rewrite as this organisation writes. The voice below is how our text looks, and matching it matters as much as keeping the meaning intact.",
  ];

  if (rules.length > 0) {
    sections.push(`<voice_rules>\n${rules.map((rule) => `- ${rule}`).join("\n")}\n</voice_rules>`);
  }

  if (avoid.length > 0) {
    sections.push(`<never_do>\n${avoid.map((rule) => `- ${rule}`).join("\n")}\n</never_do>`);
  }

  if (examples.length > 0) {
    const rendered = examples
      .map(
        (example) =>
          `<example>\n<before>${example.before.trim()}</before>\n<after>${example.after.trim()}</after>\n</example>`,
      )
      .join("\n");

    sections.push(
      `<rewrite_examples>\nThe same content, before and after we rewrote it. Match the EDIT, not the subject.\n${rendered}\n</rewrite_examples>`,
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
