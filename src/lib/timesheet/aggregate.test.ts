import { describe, expect, it } from "vitest";

import { buildFacts, buildReport, hoursFromSeconds, rollUpByPerson, rollUpByPersonDay, summariseSplit } from "./aggregate";
import { formatDuration } from "./audit-rules";
import { FINDING_CODES, SnapshotIssue, SnapshotWorklog, TimesheetSnapshot } from "./timesheet.types";

// -------------------------------------------------------------------
// Verification suite
//
// The rule these follow: every expected figure below is a literal, worked out
// by hand from the fixture, never produced by calling the engine. A test that
// checks the engine against itself passes just as happily when both sides are
// wrong, and the whole reason this suite exists is to make a refactor of the
// aggregation safe to do.
//
// So: no helper here sums anything, and no expectation imports a total from
// the code under test.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// The fixture.
//
// Two people, three days, two clients, one budgeted item with nothing under
// it. Every quantity is in seconds, and every one of them is small enough to
// add up in your head, which is the point.
//
//   w1  TSSS-43  josh   08-10  09:00  2h      described
//   w2  TSSS-43  josh   08-10  11:00  1h 30m  no description
//   w3  TSSS-44  louis  08-10  09:00  1h      described
//   w4  TSSS-43  louis  08-11  09:00  7h 30m  described
//   w5  DS-7     josh   08-11  09:00  30m     no description
//   w6  TSSS-43  louis  08-12  09:00  2h 30m  no description
//   w7  TSSS-44  louis  08-12  10:37  1h      described   <- overlaps w6 by 53m
//   w8  TSSS-43  josh   08-12  none   45m     no description
// -------------------------------------------------------------------
const ISSUES: SnapshotIssue[] = [
  {
    issueKey: "TSSS-1",
    parentKey: null,
    projectKey: "TSSS",
    issueType: "Project",
    summary: "Swimming school portal",
    category: "External",
    billable: "Billable",
    baselineEstimateSeconds: 144000, // 40h
    currentEstimateSeconds: 72000, // 20h
  },
  // Declares nothing itself, so it inherits Billable from TSSS-1.
  { issueKey: "TSSS-43", parentKey: "TSSS-1", projectKey: "TSSS", summary: "Booking flow" },
  // Overrides its parent: set on the item, so the item wins.
  { issueKey: "TSSS-44", parentKey: "TSSS-1", projectKey: "TSSS", summary: "Internal review", billable: "Non-billable" },
  {
    issueKey: "DS-1",
    parentKey: null,
    projectKey: "DS",
    issueType: "Project",
    summary: "Internal admin",
    category: "Internal",
    billable: "Non-billable",
  },
  { issueKey: "DS-7", parentKey: "DS-1", projectKey: "DS", summary: "Timesheet admin" },
  // A budget with no deliverables and no time under it. This is the RDP-1
  // shape, and it must still appear in the budget roll-up.
  {
    issueKey: "RDP-1",
    parentKey: null,
    projectKey: "RDP",
    issueType: "Project",
    summary: "R&D claim",
    category: "Internal",
    billable: "Non-billable",
    baselineEstimateSeconds: 3240000, // 900h
    currentEstimateSeconds: 3240000,
  },
];

const WORKLOGS: SnapshotWorklog[] = [
  {
    worklogId: "w1",
    issueKey: "TSSS-43",
    personId: "josh",
    personName: "Joshua",
    workDate: "2026-08-10",
    startSecond: 32400,
    timeSpentSeconds: 7200,
    narrative: "Built the booking form",
  },
  {
    worklogId: "w2",
    issueKey: "TSSS-43",
    personId: "josh",
    personName: "Joshua",
    workDate: "2026-08-10",
    startSecond: 39600,
    timeSpentSeconds: 5400,
    narrative: null,
  },
  {
    worklogId: "w3",
    issueKey: "TSSS-44",
    personId: "louis",
    personName: "Louis",
    workDate: "2026-08-10",
    startSecond: 32400,
    timeSpentSeconds: 3600,
    narrative: "Reviewed the sprint",
  },
  {
    worklogId: "w4",
    issueKey: "TSSS-43",
    personId: "louis",
    personName: "Louis",
    workDate: "2026-08-11",
    startSecond: 32400,
    timeSpentSeconds: 27000,
    narrative: "Paired on the booking flow",
  },
  {
    worklogId: "w5",
    issueKey: "DS-7",
    personId: "josh",
    personName: "Joshua",
    workDate: "2026-08-11",
    startSecond: 32400,
    timeSpentSeconds: 1800,
    // Blank rather than absent: Jira hands back empty strings, and "" must
    // count as no description.
    narrative: "   ",
  },
  {
    worklogId: "w6",
    issueKey: "TSSS-43",
    personId: "louis",
    personName: "Louis",
    workDate: "2026-08-12",
    startSecond: 32400,
    timeSpentSeconds: 9000,
    narrative: null,
  },
  {
    worklogId: "w7",
    issueKey: "TSSS-44",
    personId: "louis",
    personName: "Louis",
    workDate: "2026-08-12",
    startSecond: 38220,
    timeSpentSeconds: 3600,
    narrative: "Wrote up the review notes",
  },
  {
    worklogId: "w8",
    issueKey: "TSSS-43",
    personId: "josh",
    personName: "Joshua",
    workDate: "2026-08-12",
    // No start time recorded, so the overlap rule must skip it rather than
    // treat it as midnight.
    startSecond: null,
    timeSpentSeconds: 2700,
    narrative: null,
  },
];

const SNAPSHOT: TimesheetSnapshot = {
  worklogs: WORKLOGS,
  issues: ISSUES,
  today: "2026-08-13",
};

function findingsOf(code: string, snapshot: TimesheetSnapshot = SNAPSHOT) {
  return buildReport(snapshot).findings.filter((finding) => finding.code === code);
}

// -------------------------------------------------------------------
// Seconds to hours
// -------------------------------------------------------------------
describe("hoursFromSeconds", () => {
  it("converts exact hours", () => {
    expect(hoursFromSeconds(3600)).toBe(1);
    expect(hoursFromSeconds(27000)).toBe(7.5);
    expect(hoursFromSeconds(0)).toBe(0);
  });

  it("converts the quarter hours a timesheet is actually made of", () => {
    expect(hoursFromSeconds(900)).toBe(0.25);
    expect(hoursFromSeconds(2700)).toBe(0.75);
    expect(hoursFromSeconds(67500)).toBe(18.75);
  });

  it("rounds to four decimal places rather than carrying a repeating fraction", () => {
    // 20 minutes is 0.3333... hours.
    expect(hoursFromSeconds(1200)).toBe(0.3333);
  });
});

// -------------------------------------------------------------------
// Fact resolution
// -------------------------------------------------------------------
describe("buildFacts", () => {
  const facts = buildFacts(SNAPSHOT);
  const byId = new Map(facts.map((fact) => [fact.worklogId, fact]));

  it("keeps one fact per worklog, never per issue", () => {
    expect(facts).toHaveLength(8);
    expect(new Set(facts.map((fact) => fact.worklogId)).size).toBe(8);
  });

  it("takes the billable status from the item when the item declares one", () => {
    // TSSS-44 says Non-billable while its parent says Billable. The item wins.
    expect(byId.get("w3")?.billable).toBe("Non-billable");
    expect(byId.get("w3")?.billableSource).toBe("issue");
  });

  it("inherits from the parent when the item declares nothing, and records that it did", () => {
    expect(byId.get("w1")?.billable).toBe("Billable");
    expect(byId.get("w1")?.billableSource).toBe("parent");
    expect(byId.get("w5")?.billable).toBe("Non-billable");
    expect(byId.get("w5")?.billableSource).toBe("parent");
  });

  it("resolves the parent, project and category onto every fact", () => {
    expect(byId.get("w1")?.parentKey).toBe("TSSS-1");
    expect(byId.get("w1")?.parentSummary).toBe("Swimming school portal");
    expect(byId.get("w1")?.projectKey).toBe("TSSS");
    // TSSS-43 sets no category, so it takes its parent's.
    expect(byId.get("w1")?.category).toBe("External");
    expect(byId.get("w5")?.category).toBe("Internal");
  });

  it("treats a blank narrative as no narrative", () => {
    expect(byId.get("w5")?.hasNarrative).toBe(false);
    expect(byId.get("w1")?.hasNarrative).toBe(true);
    expect(byId.get("w6")?.hasNarrative).toBe(false);
  });

  it("preserves the work date as a string, untouched", () => {
    expect(byId.get("w4")?.workDate).toBe("2026-08-11");
  });

  it("orders deterministically by date, then person, then worklog id", () => {
    // Not w1..w8: on the 11th josh's w5 sorts ahead of louis's w4, and on the
    // 12th josh's w8 ahead of louis's w6 and w7. Date first, person second,
    // worklog id only to break a tie.
    expect(facts.map((fact) => fact.worklogId)).toEqual(["w1", "w2", "w3", "w5", "w4", "w8", "w6", "w7"]);
  });

  it("produces the same facts whatever order the worklogs arrive in", () => {
    // Postgres promises no row order without an ORDER BY, so a report that
    // depended on input order would quietly differ between runs.
    const shuffled = buildFacts({ ...SNAPSHOT, worklogs: [...WORKLOGS].reverse() });
    expect(shuffled).toEqual(facts);
  });

  it("marks a worklog whose issue is missing as an orphan instead of dropping it", () => {
    const orphaned = buildFacts({
      ...SNAPSHOT,
      worklogs: [{ ...WORKLOGS[0], worklogId: "w99", issueKey: "GONE-1" }],
    });

    expect(orphaned).toHaveLength(1);
    expect(orphaned[0].isOrphan).toBe(true);
    expect(orphaned[0].projectKey).toBeNull();
    expect(orphaned[0].billableSource).toBe("unset");
    // The time is still counted. Dropping it is the one failure nobody sees.
    expect(orphaned[0].timeSpentSeconds).toBe(7200);
  });

  it("filters to the reporting period, inclusive at both ends", () => {
    const window = buildFacts({
      ...SNAPSHOT,
      options: { periodStart: "2026-08-11", periodEnd: "2026-08-12" },
    });

    // In fact order, which is by date then person: the 11th (josh, louis),
    // then the 12th (josh, louis, louis).
    expect(window.map((fact) => fact.worklogId)).toEqual(["w5", "w4", "w8", "w6", "w7"]);
  });
});

// -------------------------------------------------------------------
// Billable split
// -------------------------------------------------------------------
describe("summariseSplit", () => {
  const split = summariseSplit(buildFacts(SNAPSHOT));

  it("totals billable seconds", () => {
    // w1 7200 + w2 5400 + w4 27000 + w6 9000 + w8 2700
    expect(split.billableSeconds).toBe(51300);
    expect(split.billableHours).toBe(14.25);
  });

  it("totals non-billable seconds", () => {
    // w3 3600 + w5 1800 + w7 3600
    expect(split.nonBillableSeconds).toBe(9000);
    expect(split.nonBillableHours).toBe(2.5);
  });

  it("has nothing unset in a fixture where every item resolves", () => {
    expect(split.unsetSeconds).toBe(0);
  });

  it("computes the billable share", () => {
    // 51300 / 60300
    expect(split.billableRatio).toBe(0.8507);
  });

  it("keeps unset in its own bucket rather than folding it into non-billable", () => {
    const unsetSplit = summariseSplit(
      buildFacts({
        ...SNAPSHOT,
        issues: [{ issueKey: "X-1", parentKey: null, projectKey: "X", summary: "Undeclared" }],
        worklogs: [{ ...WORKLOGS[0], issueKey: "X-1" }],
      }),
    );

    expect(unsetSplit.unsetSeconds).toBe(7200);
    expect(unsetSplit.nonBillableSeconds).toBe(0);
    expect(unsetSplit.billableSeconds).toBe(0);
  });

  it("reports no ratio at all for an empty period, rather than nought per cent", () => {
    expect(summariseSplit([]).billableRatio).toBeNull();
  });
});

// -------------------------------------------------------------------
// Roll-ups
// -------------------------------------------------------------------
describe("rollUpByPerson", () => {
  const byPerson = rollUpByPerson(buildFacts(SNAPSHOT));

  it("orders by hours, longest first", () => {
    expect(byPerson.map((person) => person.personId)).toEqual(["louis", "josh"]);
  });

  it("totals each person's time", () => {
    // louis: 3600 + 27000 + 9000 + 3600
    expect(byPerson[0].seconds).toBe(43200);
    expect(byPerson[0].hours).toBe(12);
    // josh: 7200 + 5400 + 1800 + 2700
    expect(byPerson[1].seconds).toBe(17100);
    expect(byPerson[1].hours).toBe(4.75);
  });

  it("counts entries and distinct days worked", () => {
    expect(byPerson[0].worklogCount).toBe(4);
    expect(byPerson[0].daysWorked).toBe(3);
    expect(byPerson[1].worklogCount).toBe(4);
    expect(byPerson[1].daysWorked).toBe(3);
  });

  it("splits each person's own billable time", () => {
    expect(byPerson[0].split.billableSeconds).toBe(36000);
    expect(byPerson[0].split.nonBillableSeconds).toBe(7200);
    expect(byPerson[1].split.billableSeconds).toBe(15300);
    expect(byPerson[1].split.nonBillableSeconds).toBe(1800);
  });

  it("groups on accountId, not on the display name", () => {
    // The same person, renamed midway through the period. One row, not two.
    const renamed = rollUpByPerson(
      buildFacts({
        ...SNAPSHOT,
        worklogs: [
          { ...WORKLOGS[0], worklogId: "r1", personName: "Joshua Brazier" },
          { ...WORKLOGS[1], worklogId: "r2", personName: "Joshua Smith" },
        ],
      }),
    );

    expect(renamed).toHaveLength(1);
    expect(renamed[0].personId).toBe("josh");
    expect(renamed[0].seconds).toBe(12600);
  });
});

describe("rollUpByPersonDay", () => {
  const byDay = rollUpByPersonDay(buildFacts(SNAPSHOT), 7.5);

  it("makes one row per person per day they logged something", () => {
    expect(byDay).toHaveLength(6);
    expect(byDay.map((day) => `${day.workDate} ${day.personId}`)).toEqual([
      "2026-08-10 josh",
      "2026-08-10 louis",
      "2026-08-11 josh",
      "2026-08-11 louis",
      "2026-08-12 josh",
      "2026-08-12 louis",
    ]);
  });

  it("totals the day", () => {
    // josh on the 10th: 7200 + 5400
    expect(byDay[0].seconds).toBe(12600);
    expect(byDay[0].hours).toBe(3.5);
    // louis on the 12th: 9000 + 3600
    expect(byDay[5].seconds).toBe(12600);
  });

  it("computes utilisation against a full working day", () => {
    // louis on the 11th: 7.5h of 7.5h
    expect(byDay[3].utilisation).toBe(1);
    // josh on the 10th: 3.5 / 7.5
    expect(byDay[0].utilisation).toBe(0.4667);
    // josh on the 12th: 0.75 / 7.5
    expect(byDay[4].utilisation).toBe(0.1);
  });

  it("invents no rows for days nobody logged", () => {
    // Nothing on the 13th, and a zero-utilisation row for it would read as a
    // day wasted rather than a day off.
    expect(byDay.some((day) => day.workDate === "2026-08-13")).toBe(false);
  });
});

describe("rollUpByProject", () => {
  const report = buildReport(SNAPSHOT);

  it("rolls time up to the Project item above the deliverable", () => {
    expect(report.byProject.map((project) => project.parentKey)).toEqual(["TSSS-1", "DS-1"]);
  });

  it("totals every deliverable underneath", () => {
    // w1 7200 + w2 5400 + w3 3600 + w4 27000 + w6 9000 + w7 3600 + w8 2700
    expect(report.byProject[0].seconds).toBe(58500);
    expect(report.byProject[0].worklogCount).toBe(7);
    expect(report.byProject[1].seconds).toBe(1800);
  });

  it("groups parentless work under its own row instead of discarding it", () => {
    const parentless = buildReport({
      ...SNAPSHOT,
      issues: [{ issueKey: "X-1", parentKey: null, projectKey: "X", summary: "Loose", billable: "Billable" }],
      worklogs: [{ ...WORKLOGS[0], issueKey: "X-1" }],
    });

    expect(parentless.byProject).toHaveLength(1);
    expect(parentless.byProject[0].parentKey).toBeNull();
    expect(parentless.byProject[0].seconds).toBe(7200);
  });
});

describe("rollUpBudget", () => {
  const budget = buildReport(SNAPSHOT).budget;
  const byKey = new Map(budget.map((row) => [row.parentKey, row]));

  it("reports baseline, current and actual side by side", () => {
    const tsss = byKey.get("TSSS-1");
    expect(tsss?.baselineSeconds).toBe(144000);
    expect(tsss?.baselineHours).toBe(40);
    expect(tsss?.currentSeconds).toBe(72000);
    expect(tsss?.currentHours).toBe(20);
    expect(tsss?.actualSeconds).toBe(58500);
    expect(tsss?.actualHours).toBe(16.25);
  });

  it("computes variance against the current estimate, negative while under", () => {
    expect(byKey.get("TSSS-1")?.varianceSeconds).toBe(-13500);
    expect(byKey.get("TSSS-1")?.varianceHours).toBe(-3.75);
    expect(byKey.get("TSSS-1")?.consumedRatio).toBe(0.8125);
  });

  it("lists a budgeted item with no deliverables and no time under it", () => {
    // The RDP-1 case: 900h of budget and nothing recorded against it. An
    // item-with-hours-only report would not show this at all, and it is the
    // row most worth seeing.
    const rdp = byKey.get("RDP-1");
    expect(rdp).toBeDefined();
    expect(rdp?.baselineHours).toBe(900);
    expect(rdp?.actualSeconds).toBe(0);
    expect(rdp?.consumedRatio).toBe(0);
  });

  it("reports no ratio where there is no estimate to measure against", () => {
    expect(byKey.get("DS-1")?.currentSeconds).toBeNull();
    expect(byKey.get("DS-1")?.varianceSeconds).toBeNull();
    expect(byKey.get("DS-1")?.consumedRatio).toBeNull();
  });

  // -----------------------------------------------------------------
  // The job list. This is what replaces a job-and-timesheet tool, so the
  // guarantee is that EVERY job appears - including the ones nobody has
  // started. A job list that hides unstarted jobs is not a job list.
  // -----------------------------------------------------------------
  it("carries the category onto every job, including one with no time", () => {
    expect(byKey.get("TSSS-1")?.category).toBe("External");
    // RDP-1 has a budget and not a single worklog, and still knows what it is.
    expect(byKey.get("RDP-1")?.category).toBe("Internal");
    expect(byKey.get("RDP-1")?.worklogCount).toBe(0);
  });

  it("carries the job's own billable status, which its deliverables inherit", () => {
    expect(byKey.get("TSSS-1")?.billable).toBe("Billable");
    expect(byKey.get("DS-1")?.billable).toBe("Non-billable");
  });

  it("splits the time booked to each job", () => {
    // TSSS-1: everything except w5, which is on DS-7.
    expect(byKey.get("TSSS-1")?.split.billableSeconds).toBe(51300);
    expect(byKey.get("TSSS-1")?.split.nonBillableSeconds).toBe(7200);
    expect(byKey.get("TSSS-1")?.worklogCount).toBe(7);
  });

  it("gives an unstarted job an all-zero split rather than omitting it", () => {
    const rdp = byKey.get("RDP-1");
    expect(rdp?.split.billableSeconds).toBe(0);
    expect(rdp?.split.nonBillableSeconds).toBe(0);
    expect(rdp?.split.unsetSeconds).toBe(0);
    // Null, not zero: no time logged is not "nought per cent billable".
    expect(rdp?.split.billableRatio).toBeNull();
  });

  it("lists a job that has never been touched at all", () => {
    // No estimates, no worklogs, but it is a parent, so it is a job.
    const untouched = buildReport({
      ...SNAPSHOT,
      issues: [
        ...ISSUES,
        { issueKey: "NEW-1", parentKey: null, projectKey: "NEW", summary: "Not started", category: "Internal" },
        { issueKey: "NEW-2", parentKey: "NEW-1", projectKey: "NEW", summary: "A deliverable" },
      ],
    });

    const job = untouched.budget.find((row) => row.parentKey === "NEW-1");
    expect(job).toBeDefined();
    expect(job?.actualSeconds).toBe(0);
    expect(job?.worklogCount).toBe(0);
    expect(job?.parentSummary).toBe("Not started");
  });
});

// -------------------------------------------------------------------
// Audit rules
// -------------------------------------------------------------------
describe("WORKLOG_OVERLAP", () => {
  const overlaps = findingsOf(FINDING_CODES.WORKLOG_OVERLAP);

  it("catches one person booked to two items over the same clock time", () => {
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].personId).toBe("louis");
    expect(overlaps[0].workDate).toBe("2026-08-12");
    expect(overlaps[0].worklogIds).toEqual(["w6", "w7"]);
  });

  it("measures how much time is double-booked", () => {
    // w6 runs 09:00-11:30, w7 starts 10:37. 11:30 - 10:37 = 53 minutes.
    expect(overlaps[0].detail?.overlapSeconds).toBe(3180);
    expect(overlaps[0].message).toContain("53m");
  });

  it("blocks the period", () => {
    expect(overlaps[0].severity).toBe("blocking");
  });

  it("does not flag entries that merely touch", () => {
    // w1 ends at 11:00 and w2 starts at 11:00 on the same day, same person.
    expect(overlaps.some((finding) => finding.worklogIds?.includes("w1"))).toBe(false);
  });

  it("skips entries with no start time rather than assuming midnight", () => {
    // w8 has no start. Assuming midnight would collide it with everything.
    expect(overlaps.some((finding) => finding.worklogIds?.includes("w8"))).toBe(false);
  });

  it("does not compare across people or across days", () => {
    // josh and louis both start at 09:00 on the 10th, on different items.
    const sameClockDifferentPeople = findingsOf(FINDING_CODES.WORKLOG_OVERLAP, {
      ...SNAPSHOT,
      worklogs: [WORKLOGS[0], WORKLOGS[2]],
    });

    expect(sameClockDifferentPeople).toHaveLength(0);
  });
});

describe("BILLABLE_INHERITED", () => {
  const inherited = findingsOf(FINDING_CODES.BILLABLE_INHERITED);

  it("reports once per item, not once per entry", () => {
    // TSSS-43 (five entries) and DS-7 (one). TSSS-44 sets its own, so it is
    // not here.
    expect(inherited).toHaveLength(2);
    expect(inherited.map((finding) => finding.issueKey).sort()).toEqual(["DS-7", "TSSS-43"]);
  });

  it("carries the time affected, so the exposure is visible", () => {
    const tsss43 = inherited.find((finding) => finding.issueKey === "TSSS-43");
    // w1 7200 + w2 5400 + w4 27000 + w6 9000 + w8 2700
    expect(tsss43?.detail?.seconds).toBe(51300);
    expect(tsss43?.detail?.worklogCount).toBe(5);
  });

  it("warns rather than blocks, because it bills correctly today", () => {
    expect(inherited.every((finding) => finding.severity === "warning")).toBe(true);
  });
});

describe("MISSING_NARRATIVE", () => {
  const missing = findingsOf(FINDING_CODES.MISSING_NARRATIVE);

  it("flags every entry with no work description", () => {
    // Four of the eight, reported in fact order.
    expect(missing.map((finding) => finding.worklogIds?.[0])).toEqual(["w2", "w5", "w8", "w6"]);
  });

  it("warns rather than blocks", () => {
    // Blocking would make every period non-billable today, and a state that
    // is always on carries no information.
    expect(missing.every((finding) => finding.severity === "warning")).toBe(true);
  });
});

describe("BILLABLE_UNSET", () => {
  it("blocks when neither the item nor its parent declares a status", () => {
    const unset = findingsOf(FINDING_CODES.BILLABLE_UNSET, {
      ...SNAPSHOT,
      issues: [{ issueKey: "X-1", parentKey: null, projectKey: "X", summary: "Undeclared" }],
      worklogs: [{ ...WORKLOGS[0], issueKey: "X-1" }],
    });

    expect(unset).toHaveLength(1);
    expect(unset[0].severity).toBe("blocking");
  });

  it("stays quiet where everything resolves", () => {
    expect(findingsOf(FINDING_CODES.BILLABLE_UNSET)).toHaveLength(0);
  });

  it("does not double up on an orphan, which already blocks for the real reason", () => {
    const orphan = buildReport({
      ...SNAPSHOT,
      worklogs: [{ ...WORKLOGS[0], issueKey: "GONE-1" }],
    });

    expect(orphan.findings.filter((finding) => finding.code === FINDING_CODES.ORPHAN_WORKLOG)).toHaveLength(1);
    expect(orphan.findings.filter((finding) => finding.code === FINDING_CODES.BILLABLE_UNSET)).toHaveLength(0);
  });
});

describe("FUTURE_DATED", () => {
  it("blocks work booked after today", () => {
    const future = findingsOf(FINDING_CODES.FUTURE_DATED, {
      ...SNAPSHOT,
      worklogs: [{ ...WORKLOGS[0], worklogId: "f1", workDate: "2026-08-14" }],
    });

    expect(future).toHaveLength(1);
    expect(future[0].severity).toBe("blocking");
  });

  it("accepts today itself", () => {
    const todayEntry = findingsOf(FINDING_CODES.FUTURE_DATED, {
      ...SNAPSHOT,
      worklogs: [{ ...WORKLOGS[0], worklogId: "t1", workDate: "2026-08-13" }],
    });

    expect(todayEntry).toHaveLength(0);
  });

  it("judges the date against the injected today, never the machine clock", () => {
    // Same entry, a different "today". If the engine read the clock this
    // could not change.
    const asOfEarlier = findingsOf(FINDING_CODES.FUTURE_DATED, { ...SNAPSHOT, today: "2026-08-09" });
    expect(asOfEarlier).toHaveLength(8);
  });
});

describe("NON_POSITIVE_DURATION", () => {
  it("blocks a zero-length entry", () => {
    const zero = findingsOf(FINDING_CODES.NON_POSITIVE_DURATION, {
      ...SNAPSHOT,
      worklogs: [{ ...WORKLOGS[0], worklogId: "z1", timeSpentSeconds: 0 }],
    });

    expect(zero).toHaveLength(1);
    expect(zero[0].severity).toBe("blocking");
  });
});

describe("NO_PARENT_ITEM", () => {
  it("warns once per item that rolls up to nothing", () => {
    const loose = findingsOf(FINDING_CODES.NO_PARENT_ITEM, {
      ...SNAPSHOT,
      issues: [{ issueKey: "X-1", parentKey: null, projectKey: "X", summary: "Loose", billable: "Billable" }],
      worklogs: [
        { ...WORKLOGS[0], worklogId: "p1", issueKey: "X-1" },
        { ...WORKLOGS[1], worklogId: "p2", issueKey: "X-1" },
      ],
    });

    expect(loose).toHaveLength(1);
    expect(loose[0].detail?.worklogCount).toBe(2);
  });

  it("stays quiet where everything has a parent", () => {
    expect(findingsOf(FINDING_CODES.NO_PARENT_ITEM)).toHaveLength(0);
  });
});

describe("EXCESSIVE_DAY", () => {
  it("warns above the daily threshold", () => {
    const long = findingsOf(FINDING_CODES.EXCESSIVE_DAY, {
      ...SNAPSHOT,
      worklogs: [{ ...WORKLOGS[0], worklogId: "l1", timeSpentSeconds: 46800 }], // 13h
      options: { maxDailyHours: 12 },
    });

    expect(long).toHaveLength(1);
    expect(long[0].severity).toBe("warning");
  });

  it("leaves a normal long day alone", () => {
    expect(findingsOf(FINDING_CODES.EXCESSIVE_DAY)).toHaveLength(0);
  });
});

describe("BUDGET_EXCEEDED", () => {
  it("warns when actuals pass the current estimate", () => {
    const over = findingsOf(FINDING_CODES.BUDGET_EXCEEDED, {
      ...SNAPSHOT,
      issues: ISSUES.map((issue) =>
        issue.issueKey === "TSSS-1" ? { ...issue, currentEstimateSeconds: 3600 } : issue,
      ),
    });

    expect(over).toHaveLength(1);
    expect(over[0].detail?.overSeconds).toBe(54900); // 58500 - 3600
  });

  it("stays quiet while under budget", () => {
    expect(findingsOf(FINDING_CODES.BUDGET_EXCEEDED)).toHaveLength(0);
  });
});

// -------------------------------------------------------------------
// The report as a whole
// -------------------------------------------------------------------
describe("buildReport", () => {
  const report = buildReport(SNAPSHOT);

  it("totals the period", () => {
    // 7200 + 5400 + 3600 + 27000 + 1800 + 9000 + 3600 + 2700
    expect(report.totals.seconds).toBe(60300);
    expect(report.totals.hours).toBe(16.75);
    expect(report.totals.worklogCount).toBe(8);
  });

  it("agrees with itself across every roll-up", () => {
    // The whole point of one engine: person, day and project totals are three
    // views of one number, and if they ever disagree the dashboard is lying.
    const personSeconds = report.byPerson.reduce((total, person) => total + person.seconds, 0);
    const daySeconds = report.byPersonDay.reduce((total, day) => total + day.seconds, 0);
    const projectSeconds = report.byProject.reduce((total, project) => total + project.seconds, 0);
    const splitSeconds =
      report.split.billableSeconds + report.split.nonBillableSeconds + report.split.unsetSeconds;

    expect(personSeconds).toBe(60300);
    expect(daySeconds).toBe(60300);
    expect(projectSeconds).toBe(60300);
    expect(splitSeconds).toBe(60300);
  });

  it("refuses to call the period billable while anything blocking stands", () => {
    expect(report.blockingCount).toBe(1);
    expect(report.isBillable).toBe(false);
  });

  it("counts the warnings separately", () => {
    // 2 inherited + 4 missing narratives
    expect(report.warningCount).toBe(6);
    expect(report.findings).toHaveLength(7);
  });

  it("puts blocking findings first", () => {
    expect(report.findings[0].severity).toBe("blocking");
  });

  it("calls a clean period billable", () => {
    const clean = buildReport({
      ...SNAPSHOT,
      worklogs: [WORKLOGS[0], WORKLOGS[2]],
    });

    expect(clean.blockingCount).toBe(0);
    expect(clean.isBillable).toBe(true);
  });

  it("handles an empty period without inventing anything", () => {
    const empty = buildReport({ worklogs: [], issues: [], today: "2026-08-13" });

    expect(empty.totals.seconds).toBe(0);
    expect(empty.totals.worklogCount).toBe(0);
    expect(empty.byPerson).toEqual([]);
    expect(empty.split.billableRatio).toBeNull();
    // Nothing logged is not a problem, so nothing blocks.
    expect(empty.isBillable).toBe(true);
  });

  it("is deterministic: the same snapshot gives byte-identical output", () => {
    expect(buildReport(SNAPSHOT)).toEqual(report);
  });
});

// -------------------------------------------------------------------
// Arithmetic that has to stay exact
// -------------------------------------------------------------------
describe("summing does not drift", () => {
  it("adds a hundred twenty-minute entries to exactly the right total", () => {
    // In floating-point hours this is the classic drift case: 0.3333... added
    // a hundred times is not 33.3333. Summing seconds and converting once is
    // why it holds.
    const many = Array.from({ length: 100 }, (unused, index) => ({
      worklogId: `m${index}`,
      issueKey: "TSSS-43",
      personId: "josh",
      workDate: "2026-08-10",
      startSecond: null,
      timeSpentSeconds: 1200,
      narrative: "Work",
    }));

    const report = buildReport({ ...SNAPSHOT, worklogs: many });

    expect(report.totals.seconds).toBe(120000);
    expect(report.totals.hours).toBe(33.3333);
  });
});

// -------------------------------------------------------------------
// Dates are strings, and stay strings
// -------------------------------------------------------------------
describe("calendar dates survive daylight saving", () => {
  it("keeps dates either side of the October change exactly as given", () => {
    // Adelaide moves to ACDT on 2026-10-04. These are strings and are never
    // parsed, so there is no offset to apply and no day to lose.
    const across = buildReport({
      ...SNAPSHOT,
      today: "2026-10-31",
      worklogs: [
        { ...WORKLOGS[0], worklogId: "d1", workDate: "2026-10-03" },
        { ...WORKLOGS[0], worklogId: "d2", workDate: "2026-10-04" },
        { ...WORKLOGS[0], worklogId: "d3", workDate: "2026-10-05" },
      ],
    });

    expect(across.byPersonDay.map((day) => day.workDate)).toEqual(["2026-10-03", "2026-10-04", "2026-10-05"]);
    expect(across.byPersonDay).toHaveLength(3);
  });
});

// -------------------------------------------------------------------
// Message formatting
// -------------------------------------------------------------------
describe("formatDuration", () => {
  it("writes hours and minutes the way a person would", () => {
    expect(formatDuration(9000)).toBe("2h 30m");
    expect(formatDuration(3180)).toBe("53m");
    expect(formatDuration(7200)).toBe("2h");
    expect(formatDuration(0)).toBe("0m");
  });
});
