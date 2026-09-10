import { describe, expect, it } from "vitest";

import { resolveProjectPlan, type PlanOption, type ProjectPlanDraft } from "./project-plan";

// ===================================================================
// TURNING A SENTENCE INTO A PROJECT
//
// Every case here is a wrong answer that would LOOK right. Nothing in this
// module can be injected - Kysely parameterises everything downstream - so
// the failures worth testing are the ones that succeed: a project under the
// wrong client, twelve tasks quietly unassigned, the whole budget arriving
// as one task's estimate.
// ===================================================================

const CLIENTS: PlanOption[] = [
  { id: "c1", name: "Bowhill Engineering" },
  { id: "c2", name: "Perks" },
  { id: "c3", name: "Perks Accounting" },
];

const PEOPLE: PlanOption[] = [
  { id: "u1", name: "Louis D'Odorico" },
  { id: "u2", name: "Josh Brazier" },
  { id: "u3", name: "Josh Bailey" },
];

function draft(overrides: Partial<ProjectPlanDraft> = {}): ProjectPlanDraft {
  return {
    clientName: "Bowhill Engineering",
    projectTitle: "Portal Rebuild",
    budgetHours: 250,
    phases: [{ name: "Build", tasks: [{ title: "Scope the API", estimateHours: 8 }] }],
    ...overrides,
  };
}

function plan(overrides: Partial<ProjectPlanDraft> = {}) {
  return resolveProjectPlan(draft(overrides), { clients: CLIENTS, people: PEOPLE });
}

describe("the client", () => {
  it("uses an existing client rather than making a second one", () => {
    const result = plan({ clientName: "Bowhill Engineering" });

    expect(result.client).toEqual({ mode: "existing", clientId: "c1", name: "Bowhill Engineering" });
    expect(result.blockers).toEqual([]);
  });

  it("matches regardless of case", () => {
    expect(plan({ clientName: "bowhill engineering" }).client).toMatchObject({ clientId: "c1" });
  });

  it("REFUSES a name that matches two clients", () => {
    // The wrong-client outcome arriving by a different door. "Perks" is a
    // prefix of "Perks Accounting", and picking either is a project filed
    // against a client somebody did not name.
    const result = plan({ clientName: "Perk" });

    expect(result.blockers.join(" ")).toContain("matches more than one client");
    expect(result.blockers.join(" ")).toContain("Perks Accounting");
  });

  it("still prefers an EXACT name over a prefix collision", () => {
    // "Perks" is exactly a client AND a prefix of another. Somebody who
    // named it precisely should get it.
    expect(plan({ clientName: "Perks" }).client).toEqual({
      mode: "existing",
      clientId: "c2",
      name: "Perks",
    });
  });

  it("creates a client nobody has, which is what was asked for", () => {
    const result = plan({ clientName: "Redgum Timber" });

    expect(result.client).toEqual({ mode: "new", name: "Redgum Timber" });
    expect(result.blockers).toEqual([]);
  });

  it("REUSES the real client when a short name is a unique prefix, and says it did", () => {
    // The duplicate trap, closed by the ladder rather than by a warning: a
    // unique prefix reaches the existing client, so no second "Bowhill" is
    // ever created. It is still the app choosing a client somebody did not
    // fully type, so it is said out loud.
    const result = plan({ clientName: "Bowhill" });

    expect(result.client).toEqual({ mode: "existing", clientId: "c1", name: "Bowhill Engineering" });
    expect(result.warnings.join(" ")).toContain('"Bowhill" was matched to the existing client');
  });

  it("says nothing extra when the name was typed in full", () => {
    expect(plan({ clientName: "Bowhill Engineering" }).warnings.join(" ")).not.toContain("was matched to");
  });

  it("WARNS when a genuinely new client extends an existing name", () => {
    // The case the ladder cannot catch: the typed name is LONGER, so no
    // prefix rule reaches it, and a new client really would be created. By
    // the time somebody notices both exist, each has work under it and
    // merging is a billing exercise.
    const result = plan({ clientName: "Bowhill Engineering Pty Ltd" });

    expect(result.client).toMatchObject({ mode: "new" });
    expect(result.blockers).toEqual([]);
    expect(result.warnings.join(" ")).toContain("already exists");
  });

  it("does not warn on a short name that happens to share letters", () => {
    // A loose rule here would warn on every project and be ignored within a
    // week.
    expect(plan({ clientName: "BP" }).warnings.join(" ")).not.toContain("already exists");
  });

  it("blocks a plan with no client at all", () => {
    expect(plan({ clientName: "  " }).blockers.join(" ")).toContain("No client was named");
  });
});

describe("phases and tasks", () => {
  it("blocks a project with no phases, because tasks have nowhere to go", () => {
    expect(plan({ phases: [] }).blockers.join(" ")).toContain("nowhere to put a task");
  });

  it("blocks two phases sharing a name", () => {
    const result = plan({
      phases: [
        { name: "Build", tasks: [] },
        { name: "build", tasks: [] },
      ],
    });

    expect(result.blockers.join(" ")).toContain("Two phases are both called");
  });

  it("blocks a task whose estimate is not a number of hours", () => {
    const result = plan({
      phases: [{ name: "Build", tasks: [{ title: "Scope it", estimateHours: Number.NaN }] }],
    });

    expect(result.blockers.join(" ")).toContain("not a number of hours");
  });

  it("WARNS rather than blocks on an implausibly large task", () => {
    // The exact misread this input invites: "250 hours" for the project
    // arriving as one task's estimate. Occasionally real, so it is not
    // refused - but it is said out loud.
    const result = plan({
      phases: [{ name: "Build", tasks: [{ title: "Do the project", estimateHours: 250 }] }],
    });

    expect(result.blockers).toEqual([]);
    expect(result.warnings.join(" ")).toContain("whole project's budget");
  });
});

describe("assignees", () => {
  it("assigns a task to somebody named exactly", () => {
    const result = plan({
      phases: [
        { name: "Build", tasks: [{ title: "Scope it", estimateHours: 8, assigneeName: "Louis D'Odorico" }] },
      ],
    });

    expect(result.phases[0].tasks[0].assigneeId).toBe("u1");
  });

  it("leaves a task UNASSIGNED rather than guessing between two people", () => {
    // Two people called Josh. Picking one is a wrong answer that looks
    // right, and it is somebody's workload.
    const result = plan({
      phases: [{ name: "Build", tasks: [{ title: "Scope it", estimateHours: 8, assigneeName: "Josh" }] }],
    });

    expect(result.phases[0].tasks[0].assigneeId).toBeNull();
    expect(result.warnings.join(" ")).toContain("matches more than one person");
    expect(result.warnings.join(" ")).toContain("Josh Brazier");
  });

  it("creates the task anyway when the name matches nobody", () => {
    // A MISS DOWNGRADES. Refusing a twelve-task plan over one misspelt name
    // is worse than creating it and pointing at the gap.
    const result = plan({
      phases: [{ name: "Build", tasks: [{ title: "Scope it", estimateHours: 8, assigneeName: "Nobody" }] }],
    });

    expect(result.blockers).toEqual([]);
    expect(result.phases[0].tasks).toHaveLength(1);
    expect(result.phases[0].tasks[0].assigneeId).toBeNull();
    expect(result.warnings.join(" ")).toContain("left unassigned");
  });

  it("keeps the name that was asked for, so the review can say who was missed", () => {
    const result = plan({
      phases: [{ name: "Build", tasks: [{ title: "Scope it", estimateHours: 8, assigneeName: "Nobody" }] }],
    });

    expect(result.phases[0].tasks[0].assigneeName).toBe("Nobody");
  });
});

describe("members", () => {
  it("puts anybody with a task on the project, and says so", () => {
    // The service refuses an assignee who is not a member, so a plan that
    // assigns work and lists no members would fail at the last step having
    // already created the project. Doing it silently is worse: membership
    // decides who can edit the board.
    const result = plan({
      phases: [
        { name: "Build", tasks: [{ title: "Scope it", estimateHours: 8, assigneeName: "Josh Brazier" }] },
      ],
    });

    expect(result.members).toEqual([
      { userId: "u2", name: "Josh Brazier", isLead: false, addedForAssignment: true },
    ]);
    expect(result.warnings.join(" ")).toContain("added to the project because");
  });

  it("does not add somebody twice when they are listed and assigned", () => {
    const result = plan({
      members: [{ name: "Josh Brazier", isLead: true }],
      phases: [
        { name: "Build", tasks: [{ title: "Scope it", estimateHours: 8, assigneeName: "Josh Brazier" }] },
      ],
    });

    expect(result.members).toHaveLength(1);
    expect(result.members[0].isLead).toBe(true);
    expect(result.members[0].addedForAssignment).toBe(false);
  });

  it("WARNS when nobody is the lead", () => {
    // canEditProjectTasks turns on admin-or-lead, so a project with people
    // and no lead has a board only an admin can change.
    const result = plan({ members: [{ name: "Josh Brazier" }] });

    expect(result.warnings.join(" ")).toContain("only an admin will be able to edit the board");
  });

  it("never invents a lead", () => {
    // Picking one would be this module deciding who runs the project.
    const result = plan({ members: [{ name: "Josh Brazier" }, { name: "Louis D'Odorico" }] });

    expect(result.members.some((member) => member.isLead)).toBe(false);
  });

  it("drops a member nobody can be matched to, and keeps the rest", () => {
    const result = plan({ members: [{ name: "Ghost" }, { name: "Louis D'Odorico", isLead: true }] });

    expect(result.members.map((member) => member.userId)).toEqual(["u1"]);
    expect(result.warnings.join(" ")).toContain("Nobody here is called");
  });
});

describe("the totals", () => {
  it("adds the estimates up across every phase", () => {
    const result = plan({
      phases: [
        { name: "Discovery", tasks: [{ title: "A", estimateHours: 8 }] },
        { name: "Build", tasks: [{ title: "B", estimateHours: 12 }, { title: "C", estimateHours: 4 }] },
      ],
    });

    expect(result.totals).toMatchObject({ phaseCount: 2, taskCount: 3, estimateHours: 24 });
  });

  it("reports being over budget, with both figures", () => {
    const result = plan({
      budgetHours: 10,
      phases: [{ name: "Build", tasks: [{ title: "A", estimateHours: 16 }] }],
    });

    expect(result.totals.overBudgetHours).toBe(6);
    expect(result.warnings.join(" ")).toContain("6 hours over");
  });

  it("tells 'not over budget' apart from 'there was no budget'", () => {
    // Null rather than zero. A reader has to be able to tell those apart, and
    // a zero here reads as a project that exactly hit its number.
    expect(plan({ budgetHours: null }).totals.overBudgetHours).toBeNull();
    expect(plan({ budgetHours: 250 }).totals.overBudgetHours).toBe(0);
  });

  it("does not warn when the plan fits", () => {
    expect(plan({ budgetHours: 250 }).warnings.join(" ")).not.toContain("over");
  });
});

describe("the project itself", () => {
  it("is billable unless somebody says otherwise", () => {
    // A project created non-billable by omission is money nobody invoices.
    expect(plan().project.isBillable).toBe(true);
    expect(plan({ isBillable: false }).project.isBillable).toBe(false);
  });

  it("blocks a project with no title", () => {
    expect(plan({ projectTitle: "   " }).blockers.join(" ")).toContain("no title");
  });

  it("trims what it was given rather than storing the whitespace", () => {
    expect(plan({ projectTitle: "  Portal Rebuild  " }).project.title).toBe("Portal Rebuild");
  });
});

describe("a person matched on a prefix", () => {
  it("reports the person it actually chose, not the name that was typed", () => {
    // "is that the right person" is the question a review asks, and echoing
    // back what was typed answers a different one.
    const result = plan({
      phases: [{ name: "Build", tasks: [{ title: "Scope it", estimateHours: 8, assigneeName: "Louis" }] }],
    });

    expect(result.phases[0].tasks[0].assigneeId).toBe("u1");
    expect(result.phases[0].tasks[0].assigneeName).toBe("Louis D'Odorico");
  });

  it("says out loud that it widened a short name", () => {
    // The same silent widening the client path warns about, and for the same
    // reason: this is somebody's workload.
    const result = plan({
      phases: [{ name: "Build", tasks: [{ title: "Scope it", estimateHours: 8, assigneeName: "Louis" }] }],
    });

    expect(result.warnings.join(" ")).toContain('"Louis" was matched to Louis D\'Odorico');
  });

  it("stays quiet when the name was typed in full", () => {
    const result = plan({
      phases: [
        { name: "Build", tasks: [{ title: "Scope it", estimateHours: 8, assigneeName: "Josh Brazier" }] },
      ],
    });

    expect(result.warnings.join(" ")).not.toContain("was matched to");
  });
});
