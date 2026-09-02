import { describe, expect, it } from "vitest";

import {
  buildOutstanding,
  classifyIssue,
  isDoneStatus,
  scopeIssues,
  type OutstandingIssueInput,
  type OutstandingSummary,
} from "./outstanding";

const HOUR = 3600;

// The summary is a tree - clients, then projects, then items - so these keep
// each test asserting about the figures it cares about rather than restating
// the shape of the tree every time.
const allItems = (s: OutstandingSummary) => s.clients.flatMap((c) => c.projects.flatMap((p) => p.items));
const allCovered = (s: OutstandingSummary) => s.clients.flatMap((c) => c.projects.flatMap((p) => p.covered));

function issue(partial: Partial<OutstandingIssueInput> & { issueKey: string }): OutstandingIssueInput {
  return {
    projectKey: partial.issueKey.split("-")[0],
    summary: partial.issueKey,
    loggedSeconds: 0,
    ...partial,
  };
}

// -------------------------------------------------------------------
// The double-counting rule.
//
// Both cases below are taken from the live Jira data rather than invented,
// because they are the two shapes that actually occur and they pull in
// opposite directions - a rule fixing one breaks the other.
// -------------------------------------------------------------------
describe("buildOutstanding - the parent roll-up rule", () => {
  it("does NOT add a parent roll-up on top of the children it rolls up", () => {
    // TSSS-1 "Notifications": 22.5h on the parent, and its estimated children
    // sum to exactly 22.5h. Counting both reports 45h of a 22.5h commitment.
    const summary = buildOutstanding([
      issue({ issueKey: "TSSS-1", issueType: "Project", status: "To Do", currentEstimateSeconds: 22.5 * HOUR }),
      issue({ issueKey: "TSSS-2", parentKey: "TSSS-1", status: "To Do", currentEstimateSeconds: 20 * HOUR }),
      issue({ issueKey: "TSSS-3", parentKey: "TSSS-1", status: "To Do", currentEstimateSeconds: 2.5 * HOUR }),
    ]);

    expect(summary.estimateSeconds).toBe(22.5 * HOUR);
    expect(summary.remainingSeconds).toBe(22.5 * HOUR);
    // The parent itself contributes no line - its children are its estimate.
    expect(allItems(summary).map((item) => item.issueKey)).toEqual(["TSSS-2", "TSSS-3"]);
  });

  it("uses a parent estimate when NO child carries one", () => {
    // TSSS-88 "Phase 2 - Xero Integration": 97.5h across eleven children,
    // none estimated. Counting only leaves reports the largest committed
    // piece of work in the project as zero.
    const summary = buildOutstanding([
      issue({ issueKey: "TSSS-88", issueType: "Project", status: "To Do", currentEstimateSeconds: 97.5 * HOUR }),
      issue({ issueKey: "TSSS-95", parentKey: "TSSS-88", status: "To Do" }),
      issue({ issueKey: "TSSS-97", parentKey: "TSSS-88", status: "To Do" }),
    ]);

    expect(summary.estimateSeconds).toBe(97.5 * HOUR);
    // The parent carries the estimate, so it is the line item.
    expect(allItems(summary)).toHaveLength(1);
    expect(allItems(summary)[0].issueKey).toBe("TSSS-88");
    // And it is marked, because a coarse figure the reader cannot identify is
    // a figure they cannot check.
    expect(allItems(summary)[0].coversChildren).toBe(true);
  });

  it("does NOT also list the children a stand-in parent speaks for", () => {
    // The failure that made this rewrite necessary: the children inherited
    // the parent's 97.5h AND the parent counted it too, so an eleven-child
    // project reported twelve times its real commitment.
    const summary = buildOutstanding([
      issue({ issueKey: "TSSS-88", status: "To Do", currentEstimateSeconds: 97.5 * HOUR }),
      issue({ issueKey: "TSSS-95", parentKey: "TSSS-88", status: "To Do" }),
      issue({ issueKey: "TSSS-97", parentKey: "TSSS-88", status: "To Do" }),
    ]);

    expect(summary.estimateSeconds).toBe(97.5 * HOUR);
    // Nor are they listed as unestimated - they are not unestimated, they are
    // estimated one level up.
    expect(summary.unestimatedCount).toBe(0);
    // They ARE listed as covered, under the line holding them, so the reader
    // can see what the 97.5 h is actually for. This is the detail that makes
    // the figure act-on-able rather than merely quotable.
    expect(allCovered(summary).map((item) => item.issueKey).sort()).toEqual(["TSSS-95", "TSSS-97"]);
    expect(allCovered(summary).every((item) => item.coveredBy === "TSSS-88")).toBe(true);
  });

  it("counts work logged BENEATH a stand-in parent against its estimate", () => {
    // Otherwise Phase 2 reports its full 97.5h outstanding while hours have
    // already gone into the children it is speaking for.
    const summary = buildOutstanding([
      issue({ issueKey: "TSSS-88", status: "To Do", currentEstimateSeconds: 97.5 * HOUR }),
      issue({ issueKey: "TSSS-95", parentKey: "TSSS-88", status: "Done", loggedSeconds: 4 * HOUR }),
      issue({ issueKey: "TSSS-97", parentKey: "TSSS-88", status: "To Do", loggedSeconds: 1.5 * HOUR }),
    ]);

    expect(summary.remainingSeconds).toBe(92 * HOUR);
  });

  it("gathers logged hours from the WHOLE chain, not just direct children", () => {
    // Jira currently allows only Project above Deliverable, so this cannot
    // arise today. It is asserted anyway: "correct given the current issue
    // type scheme" is a fragile thing to bake into a number quoted to a
    // client, and the failure would be a silent overstatement of what is left.
    const summary = buildOutstanding([
      issue({ issueKey: "A-1", status: "To Do", currentEstimateSeconds: 10 * HOUR }),
      issue({ issueKey: "A-2", parentKey: "A-1", status: "To Do" }),
      issue({ issueKey: "A-3", parentKey: "A-2", status: "To Do", loggedSeconds: 4 * HOUR }),
    ]);

    expect(summary.remainingSeconds).toBe(6 * HOUR);
  });

  it("survives a parent cycle rather than hanging the page", () => {
    const summary = buildOutstanding([
      issue({ issueKey: "A-1", parentKey: "A-2", status: "To Do", currentEstimateSeconds: 4 * HOUR }),
      issue({ issueKey: "A-2", parentKey: "A-1", status: "To Do", loggedSeconds: 1 * HOUR }),
    ]);

    expect(summary.clients).toHaveLength(1);
  });

  it("keeps a finished child from inflating what is left", () => {
    // The naive "estimate minus logged" at parent level says 20h outstanding
    // for Notifications while seven of its eight children are Done. Only the
    // open one is work remaining.
    const summary = buildOutstanding([
      issue({ issueKey: "TSSS-1", status: "To Do", currentEstimateSeconds: 22.5 * HOUR, loggedSeconds: 0 }),
      issue({ issueKey: "TSSS-2", parentKey: "TSSS-1", status: "Done", currentEstimateSeconds: 21.5 * HOUR, loggedSeconds: 2.5 * HOUR }),
      issue({ issueKey: "TSSS-9", parentKey: "TSSS-1", status: "To Do", currentEstimateSeconds: 1 * HOUR }),
    ]);

    expect(summary.remainingSeconds).toBe(1 * HOUR);
    // The finished work is still reported, just not as outstanding.
    expect(summary.completedEstimateSeconds).toBe(21.5 * HOUR);
  });
});

// -------------------------------------------------------------------
// Unestimated work.
//
// The single most important property on this screen: 54 of 59 open issues
// in the live data carry no estimate, so a total that treated them as zero
// would describe a tenth of the work while looking complete.
// -------------------------------------------------------------------
describe("buildOutstanding - unestimated work", () => {
  it("never folds unestimated open work into the totals", () => {
    const summary = buildOutstanding([
      issue({ issueKey: "TSSS-9", status: "To Do", currentEstimateSeconds: 1 * HOUR }),
      issue({ issueKey: "TSSS-101", status: "To Do", loggedSeconds: 3.5 * HOUR }),
      issue({ issueKey: "TSSS-102", status: "To Do", loggedSeconds: 1.5 * HOUR }),
    ]);

    expect(summary.remainingSeconds).toBe(1 * HOUR);
    expect(summary.unestimatedCount).toBe(2);
    // Hours already spent on unestimated work are reported separately, and
    // are the only honest thing that can be said about it.
    expect(summary.unestimatedLoggedSeconds).toBe(5 * HOUR);
  });

  it("reports estimate coverage, which is what says whether to trust the rest", () => {
    const summary = buildOutstanding([
      issue({ issueKey: "A-1", status: "To Do", currentEstimateSeconds: HOUR }),
      issue({ issueKey: "A-2", status: "To Do" }),
      issue({ issueKey: "A-3", status: "To Do" }),
      issue({ issueKey: "A-4", status: "To Do" }),
    ]);

    expect(summary.estimateCoverage).toBe(0.25);
    expect(summary.openCount).toBe(4);
  });

  it("gives null coverage rather than 0 or 1 when there is no open work", () => {
    // A distinction worth keeping: "nothing outstanding" and "nothing
    // estimated" must not render as the same thing.
    expect(buildOutstanding([]).estimateCoverage).toBeNull();
    expect(buildOutstanding([issue({ issueKey: "A-1", status: "Done" })]).estimateCoverage).toBeNull();
  });

  it("does not list finished unestimated work as outstanding", () => {
    const summary = buildOutstanding([issue({ issueKey: "A-1", status: "Done", loggedSeconds: 4 * HOUR })]);

    expect(summary.clients).toHaveLength(0);
    expect(summary.unestimatedCount).toBe(0);
  });
});

describe("buildOutstanding - overruns", () => {
  it("floors remaining at zero rather than letting an overrun cancel other work", () => {
    // Without the floor, an item 5h over would erase 5h of genuinely
    // remaining work elsewhere and the project total would read low.
    const summary = buildOutstanding([
      issue({ issueKey: "A-1", status: "To Do", currentEstimateSeconds: 1 * HOUR, loggedSeconds: 6 * HOUR }),
      issue({ issueKey: "A-2", status: "To Do", currentEstimateSeconds: 5 * HOUR }),
    ]);

    expect(summary.remainingSeconds).toBe(5 * HOUR);
  });

  it("marks an overrun rather than hiding it behind a zero", () => {
    const summary = buildOutstanding([
      issue({ issueKey: "A-1", status: "To Do", currentEstimateSeconds: 1 * HOUR, loggedSeconds: 6 * HOUR }),
    ]);

    expect(allItems(summary)[0]).toMatchObject({ remainingSeconds: 0, isOverrun: true });
  });

  it("does not call an exactly-on-budget item an overrun", () => {
    const summary = buildOutstanding([
      issue({ issueKey: "A-1", status: "To Do", currentEstimateSeconds: 2 * HOUR, loggedSeconds: 2 * HOUR }),
    ]);

    expect(allItems(summary)[0].isOverrun).toBe(false);
  });
});

describe("classifyIssue", () => {
  const estimatedParent = issue({ issueKey: "P-1", currentEstimateSeconds: 10 * HOUR });

  it("makes an issue with its own estimate a carrier", () => {
    const child = issue({ issueKey: "P-2", parentKey: "P-1", currentEstimateSeconds: 2 * HOUR });
    expect(classifyIssue(child, estimatedParent, false, false)).toBe("carrier");
  });

  it("makes a parent whose children are estimated a roll-up", () => {
    // Its own estimate is those children added up, so counting it too would
    // double the branch. The flag wins even though the issue has an estimate
    // of its own.
    expect(classifyIssue(estimatedParent, undefined, false, true)).toBe("rolled-up-parent");
  });

  it("covers an unestimated child by a parent that no sibling estimated", () => {
    const child = issue({ issueKey: "P-2", parentKey: "P-1" });
    expect(classifyIssue(child, estimatedParent, false, false)).toBe("covered-by-parent");
  });

  it("refuses to be covered by a parent once any sibling carries an estimate", () => {
    // That parent is a roll-up and has nothing of its own to lend. The child
    // is genuinely unestimated and must be reported as such.
    const child = issue({ issueKey: "P-2", parentKey: "P-1" });
    expect(classifyIssue(child, estimatedParent, true, false)).toBe("unestimated");
  });

  it("treats a zero estimate as no estimate", () => {
    // Jira stores an unset estimate as null, but a field mapping that yielded
    // 0 must never be read as "this takes no time".
    const child = issue({ issueKey: "P-2", currentEstimateSeconds: 0 });
    expect(classifyIssue(child, undefined, false, false)).toBe("unestimated");
    expect(classifyIssue(child, issue({ issueKey: "P-1", currentEstimateSeconds: 0 }), false, false)).toBe(
      "unestimated",
    );
  });

  it("leaves an orphan with no estimate unestimated", () => {
    expect(classifyIssue(issue({ issueKey: "X-1" }), undefined, false, false)).toBe("unestimated");
  });
});

describe("isDoneStatus", () => {
  it("recognises the finished statuses regardless of case", () => {
    expect(isDoneStatus("Done")).toBe(true);
    expect(isDoneStatus("done")).toBe(true);
    expect(isDoneStatus(" Closed ")).toBe(true);
    expect(isDoneStatus("Cancelled")).toBe(true);
  });

  it("treats an unrecognised status as OPEN", () => {
    // The safe direction. Work wrongly shown as outstanding gets questioned;
    // work wrongly shown as finished never does.
    expect(isDoneStatus("Awaiting client")).toBe(false);
    expect(isDoneStatus("In Progress")).toBe(false);
    expect(isDoneStatus("To Do")).toBe(false);
    expect(isDoneStatus(null)).toBe(false);
    expect(isDoneStatus(undefined)).toBe(false);
  });
});

// -------------------------------------------------------------------
// Scoping, for the overview screen's client and project filters.
// -------------------------------------------------------------------
describe("scopeIssues", () => {
  const all = [
    issue({ issueKey: "TSSS-88", status: "To Do", currentEstimateSeconds: 97.5 * HOUR }),
    issue({ issueKey: "TSSS-95", parentKey: "TSSS-88", status: "To Do" }),
    issue({ issueKey: "TSSS-97", parentKey: "TSSS-88", status: "To Do" }),
    issue({ issueKey: "TSSS-9", status: "To Do", currentEstimateSeconds: 1 * HOUR }),
    issue({ issueKey: "RDP-1", status: "To Do", currentEstimateSeconds: 900 * HOUR }),
  ];

  it("narrows to one client", () => {
    expect(scopeIssues(all, { clientKey: "TSSS" }).map((i) => i.issueKey)).not.toContain("RDP-1");
    expect(scopeIssues(all, { clientKey: "TSSS" })).toHaveLength(4);
  });

  it("takes the WHOLE subtree for a project, not just the one issue", () => {
    // The property that makes it safe to hand the result to buildOutstanding.
    // A parent arriving without its children would look like a leaf and be
    // counted as one, and children arriving without their parent would start
    // inheriting estimates nobody meant them to have.
    expect(scopeIssues(all, { projectKey: "TSSS-88" }).map((i) => i.issueKey).sort()).toEqual([
      "TSSS-88",
      "TSSS-95",
      "TSSS-97",
    ]);
  });

  it("gives the same figures scoped as it does in the full set", () => {
    // The reason the subtree rule exists. If scoping changed the answer, the
    // overview and the outstanding page would disagree about the same project.
    const full = allItems(buildOutstanding(all)).find((item) => item.issueKey === "TSSS-88");
    const scoped = allItems(buildOutstanding(scopeIssues(all, { projectKey: "TSSS-88" })))[0];

    expect(scoped.remainingSeconds).toBe(full?.remainingSeconds);
  });

  it("reaches deeper than one generation", () => {
    const deep = [
      issue({ issueKey: "A-1", status: "To Do" }),
      issue({ issueKey: "A-2", parentKey: "A-1", status: "To Do" }),
      issue({ issueKey: "A-3", parentKey: "A-2", status: "To Do" }),
    ];

    expect(scopeIssues(deep, { projectKey: "A-1" })).toHaveLength(3);
  });

  it("treats 'all' and null as no narrowing", () => {
    // What the dropdowns actually send. Matching it literally would filter to
    // a client key nobody has and empty every screen.
    expect(scopeIssues(all, { clientKey: "all", projectKey: "all" })).toHaveLength(all.length);
    expect(scopeIssues(all, {})).toHaveLength(all.length);
  });

  it("intersects a client and a project", () => {
    expect(scopeIssues(all, { clientKey: "TSSS", projectKey: "TSSS-88" })).toHaveLength(3);
    // A project belonging to another client selects nothing, rather than
    // quietly ignoring one half of the filter.
    expect(scopeIssues(all, { clientKey: "RDP", projectKey: "TSSS-88" })).toHaveLength(0);
  });
});

describe("buildOutstanding - what a covering line is holding", () => {
  it("counts the OPEN items a covering estimate stands in for", () => {
    // The badge says a line covers items beneath it. Without the count that
    // is a claim the reader has to open Jira to size.
    const summary = buildOutstanding([
      issue({ issueKey: "TSSS-88", status: "To Do", currentEstimateSeconds: 97.5 * HOUR }),
      issue({ issueKey: "TSSS-89", parentKey: "TSSS-88", status: "In Progress" }),
      issue({ issueKey: "TSSS-95", parentKey: "TSSS-88", status: "To Do" }),
      issue({ issueKey: "TSSS-90", parentKey: "TSSS-88", status: "Done" }),
    ]);

    // Two open, not three. A finished child is not work the figure is still
    // holding, so counting it would overstate what is left to do.
    expect(allItems(summary)[0].coversOpenCount).toBe(2);
  });

  it("is zero for a line that covers nothing", () => {
    const summary = buildOutstanding([issue({ issueKey: "A-1", status: "To Do", currentEstimateSeconds: HOUR })]);

    expect(allItems(summary)[0]).toMatchObject({ coversChildren: false, coversOpenCount: 0 });
  });
});

describe("buildOutstanding - coverage counts covered work as sized", () => {
  it("does not report a fully covered project as barely estimated", () => {
    // Measured on the live data and wrong at first: Phase 2 is one 97.5h
    // estimate over four deliverables, and counting those four as unsized
    // reported 20% coverage on work that is entirely estimated. That fired
    // the "this is only a floor" warning at a project that did not deserve
    // it - and a warning that cries wolf on good data teaches the reader to
    // scroll past the one that matters.
    const summary = buildOutstanding([
      issue({ issueKey: "TSSS-88", status: "To Do", currentEstimateSeconds: 97.5 * HOUR }),
      issue({ issueKey: "TSSS-89", parentKey: "TSSS-88", status: "In Progress" }),
      issue({ issueKey: "TSSS-95", parentKey: "TSSS-88", status: "To Do" }),
      issue({ issueKey: "TSSS-97", parentKey: "TSSS-88", status: "To Do" }),
      issue({ issueKey: "TSSS-99", parentKey: "TSSS-88", status: "To Do" }),
    ]);

    expect(summary.openCount).toBe(5);
    expect(summary.estimatedCount).toBe(1);
    expect(summary.coveredCount).toBe(4);
    expect(summary.estimateCoverage).toBe(1);
  });

  it("still counts genuinely unsized work against coverage", () => {
    const summary = buildOutstanding([
      issue({ issueKey: "A-1", status: "To Do", currentEstimateSeconds: 10 * HOUR }),
      issue({ issueKey: "A-2", parentKey: "A-1", status: "To Do" }),
      issue({ issueKey: "B-1", projectKey: "A", status: "To Do" }),
      issue({ issueKey: "B-2", projectKey: "A", status: "To Do" }),
    ]);

    // Two sized (the carrier and the one it covers), two not.
    expect(summary.estimateCoverage).toBe(0.5);
  });
});
