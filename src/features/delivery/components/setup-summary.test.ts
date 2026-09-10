import { describe, expect, it } from "vitest";

import { RATE_BANDS } from "@/lib/data/kysely-database-types";

import type { PhaseDTO, ProjectMemberDTO } from "../delivery.types";
import { describeBudgetPools, describePhases, describeTeam, missingForBoard } from "./setup-summary";

// -------------------------------------------------------------------
// The one line each setup step shows once it is closed.
//
// Every case here is prose going wrong quietly rather than code throwing: a
// missing plural, a lead who is not there, a name that was de-identified
// away. None of them break anything, all of them make an admin screen look
// like nobody read it.
// -------------------------------------------------------------------

function member(overrides: Partial<ProjectMemberDTO> = {}): ProjectMemberDTO {
  return {
    userId: "u1",
    name: "Louis",
    email: "louis@example.com",
    isLead: false,
    rateBand: RATE_BANDS.STANDARD,
    ...overrides,
  };
}

function phase(name: string): PhaseDTO {
  return { id: `p:${name}`, name, position: 0, taskCount: 0, estimateMinutes: 0, loggedMinutes: 0 };
}

describe("describeTeam", () => {
  it("invites somebody to start when the project is empty", () => {
    expect(describeTeam([])).toEqual({ summary: "Nobody on it yet", isComplete: false });
  });

  it("is NOT complete without a lead, however many people are on it", () => {
    // The case worth having a test for. canEditProjectTasks turns on being
    // an admin or the lead, so this project's board can only be changed by
    // an admin - while a member list four rows long looks entirely finished.
    const result = describeTeam([member({ userId: "a" }), member({ userId: "b" })]);

    expect(result.isComplete).toBe(false);
    expect(result.summary).toBe("2 people, but nobody leading yet");
  });

  it("gets the singular right for one person with no lead", () => {
    expect(describeTeam([member()]).summary).toBe("1 person, but nobody leading yet");
  });

  it("names the lead and counts the rest", () => {
    const result = describeTeam([
      member({ userId: "a", name: "Louis", isLead: true }),
      member({ userId: "b", name: "Josh" }),
      member({ userId: "c", name: "Sam" }),
    ]);

    expect(result).toEqual({ summary: "Louis leading, and 2 others", isComplete: true });
  });

  it("says one OTHER, not one others", () => {
    const result = describeTeam([
      member({ userId: "a", isLead: true }),
      member({ userId: "b", name: "Josh" }),
    ]);

    expect(result.summary).toBe("Louis leading, and 1 other");
  });

  it("has a sentence for a lead working alone", () => {
    // "Louis leading, and 0 others" is what a count gets you here.
    expect(describeTeam([member({ isLead: true })]).summary).toBe("Louis, leading and working alone");
  });

  it("copes with a lead whose account was de-identified", () => {
    // De-identifying a dormant account keeps its project membership and
    // drops its name, so a real lead can have none. The step is still
    // complete - somebody IS leading.
    const result = describeTeam([member({ name: null, email: null, isLead: true })]);

    expect(result.isComplete).toBe(true);
    expect(result.summary).toBe("Somebody, leading and working alone");
  });
});

describe("describePhases", () => {
  it("says what is missing and why it matters", () => {
    // An empty step is an invitation, not a blank. "No phases" alone does
    // not tell somebody why they should care.
    const result = describePhases([]);

    expect(result.isComplete).toBe(false);
    expect(result.summary).toContain("nowhere to put a task");
  });

  it("names the phases rather than counting them", () => {
    const result = describePhases([phase("Discovery"), phase("Build"), phase("Handover")]);

    expect(result).toEqual({ summary: "Discovery, Build, Handover", isComplete: true });
  });

  it("keeps the line readable when a project has many phases", () => {
    const result = describePhases(
      ["Discovery", "Design", "Build", "Test", "Handover", "Support"].map(phase),
    );

    expect(result.summary).toBe("Discovery, Design, Build and 3 more");
    expect(result.isComplete).toBe(true);
  });

  it("names exactly four without truncating", () => {
    // The boundary. Four fit on the line; five is where it wraps.
    expect(describePhases(["A", "B", "C", "D"].map(phase)).summary).toBe("A, B, C, D");
  });
});

describe("describeBudgetPools", () => {
  it("says an empty pool list is normal, not unfinished", () => {
    // The wording this exists for. A step that reads as incomplete is how
    // somebody ends up creating a "pool" of one person to tidy the screen.
    expect(describeBudgetPools([])).toContain("suits most projects");
  });

  it("names the pools", () => {
    expect(describeBudgetPools([{ name: "Interns" }, { name: "Contractors" }])).toBe(
      "Interns, Contractors",
    );
  });
});

describe("missingForBoard", () => {
  it("names nothing when both steps are done", () => {
    expect(missingForBoard({ summary: "", isComplete: true }, { summary: "", isComplete: true })).toEqual(
      [],
    );
  });

  it("names both when neither is", () => {
    // Named rather than "setup is incomplete", which sends somebody back
    // through all of it to find out which half.
    expect(
      missingForBoard({ summary: "", isComplete: false }, { summary: "", isComplete: false }),
    ).toEqual(["a lead", "a phase"]);
  });

  it("names only the one that is missing", () => {
    expect(
      missingForBoard({ summary: "", isComplete: true }, { summary: "", isComplete: false }),
    ).toEqual(["a phase"]);
  });
});
