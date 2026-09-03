import { CHAT_TOOL_CONFIG } from "@/features/ai-chat/ai-chat-tools";
import { describe, expect, it } from "vitest";

import { resolveNamed, resolvePerson } from "./timesheet-chat-facts.service";

// -------------------------------------------------------------------
// Turning a name the model heard into a person id.
//
// Tested directly because it is the one place in the chat tool where a value
// the model produced is matched against real data, and because the dangerous
// failure here is not a crash - it is a confident answer about the wrong
// person. Everything below exists to make that impossible rather than
// unlikely.
//
// The wider boundary - that a member's scope comes from the session and never
// from the question - is enforced by branching on role before this is ever
// reached, so there is no input to this function that could reach it.
// -------------------------------------------------------------------
const PEOPLE = [
  { value: "acct-louis", label: "Louis D'Odorico" },
  { value: "acct-josh", label: "Joshua Brazier" },
  { value: "acct-philipp", label: "Philipp Rohlfshagen" },
];

describe("resolvePerson", () => {
  it("matches a full name exactly", () => {
    expect(resolvePerson("Philipp Rohlfshagen", PEOPLE)).toEqual({ id: "acct-philipp", note: null });
  });

  it("matches regardless of case, because nobody types capitals into a chat box", () => {
    expect(resolvePerson("philipp rohlfshagen", PEOPLE)).toEqual({ id: "acct-philipp", note: null });
  });

  it("matches a unique first name", () => {
    // "what did Philipp cost us" is how the question actually gets asked.
    expect(resolvePerson("Philipp", PEOPLE)).toEqual({ id: "acct-philipp", note: null });
  });

  it("refuses an ambiguous name rather than picking one", () => {
    const ambiguous = [
      { value: "acct-1", label: "Josh Brazier" },
      { value: "acct-2", label: "Josh Turner" },
    ];

    const result = resolvePerson("Josh", ambiguous);

    // No id, and the note NAMES both, so the model can ask which was meant.
    // Picking either would produce real figures attributed to the wrong
    // person, which is the failure this whole function exists to prevent.
    expect(result.id).toBeNull();
    expect(result.note).toContain("Josh Brazier");
    expect(result.note).toContain("Josh Turner");
  });

  it("says so when nobody matches, rather than falling back to everyone silently", () => {
    const result = resolvePerson("Bartholomew Quincewright", PEOPLE);

    expect(result.id).toBeNull();
    // The note is what the model is told to pass on. Without it the answer
    // would be the whole team's figures presented as one person's.
    expect(result.note).toContain("Bartholomew Quincewright");
    expect(result.note).toContain("no person filter was applied");
  });

  it("ignores surrounding whitespace", () => {
    expect(resolvePerson("  Joshua Brazier  ", PEOPLE)).toEqual({ id: "acct-josh", note: null });
  });

  it("treats an empty name as no filter at all, with nothing to report", () => {
    expect(resolvePerson("   ", PEOPLE)).toEqual({ id: null, note: null });
  });

  it("does not match on a substring that is not a prefix", () => {
    // "Odorico" is inside the name but does not start it. Matching it would
    // make the resolver fuzzy, and fuzzy is how the wrong person gets picked.
    const result = resolvePerson("Odorico", PEOPLE);

    expect(result.id).toBeNull();
  });

  it("prefers an exact match over a prefix that would otherwise be ambiguous", () => {
    const tricky = [
      { value: "acct-1", label: "Sam" },
      { value: "acct-2", label: "Samantha" },
    ];

    // "Sam" prefixes both, so the prefix rule alone would refuse. The exact
    // match settles it - somebody actually is called Sam.
    expect(resolvePerson("Sam", tricky)).toEqual({ id: "acct-1", note: null });
  });

  it("finds nobody in an empty period rather than throwing", () => {
    const result = resolvePerson("Philipp", []);

    expect(result.id).toBeNull();
    expect(result.note).toContain("Philipp");
  });
});

// -------------------------------------------------------------------
// The same resolver, used for clients.
//
// Added after a live test found the bug it fixes: the model passed a client's
// NAME ("Trainer Suzie Swim School") while the filter validated against the
// Jira KEY ("TSSS"), so the filter silently matched nothing and the answer
// covered every client. It was caught only because the unmatched value is
// dropped and NAMED in the notes rather than passed through - the model read
// the note and said it could not break the figures down, instead of quietly
// presenting the organisation's margin as one client's.
// -------------------------------------------------------------------
const CLIENTS = [
  { value: "TSSS", label: "Trainer Suzie Swim School" },
  { value: "RDP", label: "R&D Programme" },
  { value: "IO", label: "Internal Operations" },
];

describe("resolveNamed for clients", () => {
  it("resolves a client's full name to its Jira key", () => {
    expect(resolveNamed("Trainer Suzie Swim School", CLIENTS, "client")).toEqual({ id: "TSSS", note: null });
  });

  it("resolves a key directly, because a key is unambiguous", () => {
    expect(resolveNamed("TSSS", CLIENTS, "client")).toEqual({ id: "TSSS", note: null });
    expect(resolveNamed("rdp", CLIENTS, "client")).toEqual({ id: "RDP", note: null });
  });

  it("resolves a unique prefix, which is how a client actually gets named", () => {
    expect(resolveNamed("Trainer Suzie", CLIENTS, "client")).toEqual({ id: "TSSS", note: null });
  });

  it("names the client it could not find, rather than filtering nothing in silence", () => {
    const result = resolveNamed("Bowhill", CLIENTS, "client");

    expect(result.id).toBeNull();
    expect(result.note).toContain("Bowhill");
    expect(result.note).toContain("no client filter was applied");
  });

  it("says client, not person, in its note", () => {
    // The note is read out to the user, so the wrong noun is a wrong answer.
    expect(resolveNamed("Nobody", CLIENTS, "client").note).toContain("client");
    expect(resolveNamed("Nobody", CLIENTS, "client").note).not.toContain("person");
  });
});

// -------------------------------------------------------------------
// The tool contract for work outstanding.
//
// Observed live: "how much time is left to do work for the phase 2 project
// for trainer suzie" was answered with 300h of remaining CONTRACTED STAFF
// HOURS. The work outstanding on Phase 2 was 39h. Both numbers were real,
// both answer to "time left", and the wrong one was entirely convincing.
//
// These assert the contract that keeps them apart, since the model reads it
// on every call and nothing else stops the same mistake.
// -------------------------------------------------------------------
describe("the timesheet tool contract", () => {
  const description = CHAT_TOOL_CONFIG.tools?.[0] ?? {};
  const text = JSON.stringify(description);

  it("names both figures and says they must not be confused", () => {
    expect(text).toContain("outstanding.workLeftHours");
    expect(text).toContain("capacity.contractedHours");
    expect(text).toContain("MUST NOT CONFUSE THEM");
  });

  it("routes the wording that failed to the delivery figure", () => {
    expect(text).toContain("How much time is left on Phase 2");
    expect(text).toContain("how much is left to do");
  });

  it("says the outstanding block is not about the period", () => {
    // The payload is headed with a period label, so without this the model
    // reports a live figure as that period's number.
    expect(text).toContain("NOT ABOUT THE PERIOD");
  });

  it("forbids reporting an unestimated scope as zero", () => {
    expect(text).toMatch(/never say zero/i);
  });

  it("offers a project argument, so a job can be asked about by name", () => {
    const schema = CHAT_TOOL_CONFIG.tools?.[0] as {
      toolSpec?: { inputSchema?: { json?: { properties?: Record<string, unknown> } } };
    };

    expect(Object.keys(schema.toolSpec?.inputSchema?.json?.properties ?? {})).toContain("project");
  });
});
