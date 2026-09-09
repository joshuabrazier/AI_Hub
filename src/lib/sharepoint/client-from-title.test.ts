import { describe, expect, it } from "vitest";

import { clientFromTitle, type ClientCandidate } from "./client-from-title";

function client(name: string): ClientCandidate {
  return { id: `id:${name}`, name };
}

const CLIENTS = [
  client("Bowhill Engineering"),
  client("Trainer Suzie Swim School"),
  client("Perks"),
  client("RWP"),
];

describe("clientFromTitle", () => {
  it("finds a client named in the title", () => {
    expect(clientFromTitle("Perks - Xero handover", CLIENTS)).toMatchObject({
      kind: "matched",
      client: { name: "Perks" },
    });
  });

  it("ignores case, punctuation and spacing on both sides", () => {
    // Meeting titles are typed into a calendar in a hurry; client names were
    // typed into a form months earlier. They agree on the words and nothing
    // else.
    for (const title of [
      "bowhill engineering catch up",
      "BOWHILL ENGINEERING - weekly",
      "Bowhill-Engineering / weekly",
      "Weekly:  Bowhill   Engineering",
    ]) {
      expect(clientFromTitle(title, CLIENTS)).toMatchObject({ kind: "matched", client: { name: "Bowhill Engineering" } });
    }
  });

  it("finds a client in the middle of a sentence", () => {
    expect(clientFromTitle("Kickoff for Trainer Suzie Swim School phase 2", CLIENTS)).toMatchObject({
      kind: "matched",
      client: { name: "Trainer Suzie Swim School" },
    });
  });

  it("REQUIRES WHOLE WORDS, so a name is not found inside another word", () => {
    // The failure this rule exists for. Without it a client called "Perks"
    // matches "Perkstone", and every shorter name swallows more of the
    // calendar than the last.
    expect(clientFromTitle("Perkstone review", CLIENTS).kind).toBe("none");
    expect(clientFromTitle("Superperks planning", CLIENTS).kind).toBe("none");
  });

  it("refuses to match a name too short to find safely", () => {
    // "Ace" would match "Spaces review", "replacement plan" and "interface
    // work". A three-letter client is not findable in prose and pretending
    // otherwise files notes into a stranger's folder.
    const withShort = [...CLIENTS, client("Ace")];

    expect(clientFromTitle("Spaces review", withShort).kind).toBe("none");
    expect(clientFromTitle("Ace kickoff", withShort).kind).toBe("none");
  });

  it("does not match RWP either, being three letters", () => {
    // Deliberately asserted, because it is a REAL client on the list and
    // this rule silently excludes it. The model tier still gets a go, and a
    // note in the holding folder beats one in the wrong place.
    expect(clientFromTitle("RWP spreadsheet review", CLIENTS).kind).toBe("none");
  });

  it("REFUSES two different clients in one title", () => {
    // "Perks and Bowhill joint call" is a real meeting with no correct
    // single answer, so it gets none rather than whichever sorted first.
    const result = clientFromTitle("Perks and Bowhill Engineering joint call", CLIENTS);

    expect(result.kind).toBe("ambiguous");
    expect(result.kind === "ambiguous" && result.clients.map((entry) => entry.name).sort()).toEqual([
      "Bowhill Engineering",
      "Perks",
    ]);
  });

  it("resolves a nested name to the longer one", () => {
    // "Perks" and "Perks Accounting" both matching is not two answers - the
    // title said the longer one and the shorter matched as a fragment of it.
    const nested = [client("Perks"), client("Perks Accounting")];

    expect(clientFromTitle("Perks Accounting quarterly", nested)).toMatchObject({
      kind: "matched",
      client: { name: "Perks Accounting" },
    });
  });

  it("still refuses when the longer name does not contain the other", () => {
    // Nesting is the only resolvable case. Two unrelated names stay
    // ambiguous however different their lengths are.
    const both = [client("Perks"), client("Bowhill Engineering")];

    expect(clientFromTitle("Perks and Bowhill Engineering", both).kind).toBe("ambiguous");
  });

  it("finds nothing in a title that names no client", () => {
    for (const title of ["Weekly standup", "1:1", "Internal AI catch-up", "", "   ", "???"]) {
      expect(clientFromTitle(title, CLIENTS).kind).toBe("none");
    }
  });

  it("finds nothing when there are no clients to match against", () => {
    expect(clientFromTitle("Perks - Xero handover", []).kind).toBe("none");
  });

  it("does NOT match a dotted abbreviation, and that is the trade", () => {
    // Punctuation becomes a SEPARATOR, so "T.S.S.S." normalises to four
    // one-letter words and does not match "tsss". Written as a test because
    // it looks like a bug and is not.
    //
    // The alternative is stripping punctuation without inserting a space,
    // which would collapse "Perkstone" to something containing "perks" and
    // reopen the substring hole this whole module is built to close. A
    // dotted abbreviation in a meeting title is rare; a note in the wrong
    // client's folder is expensive. So separators win, and the model tier
    // picks up what this misses.
    const abbreviated = [client("TSSS")];

    expect(clientFromTitle("T.S.S.S. phase 2", abbreviated).kind).toBe("none");
    expect(clientFromTitle("TSSS phase 2", abbreviated)).toMatchObject({ kind: "matched" });
  });
});
