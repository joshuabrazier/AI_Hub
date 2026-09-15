import { describe, expect, it } from "vitest";

import { buildReport } from "./aggregate";
import { buildAppSnapshot, countOrphanedEntries, type AppSnapshotInput } from "./app-snapshot";
import { FINDING_CODES } from "./timesheet.types";

// ===================================================================
// THE MAPPING FROM THE APP'S DELIVERY DATA TO THE ENGINE'S SNAPSHOT
//
// Every figure on every /admin/timesheets screen now comes through this
// function, so what is asserted here is not the mapping's field names - a
// wrong name is a compile error - but the four things that compile perfectly
// and produce wrong numbers:
//
//   1. a task carrying an estimate becomes a row in the project budget table
//      and double-counts its own hours
//   2. billable left to inherit raises a warning per task and buries the
//      findings that matter
//   3. minutes reaching the engine as minutes, which is a 60x error that
//      looks plausible on a dashboard
//   4. an entry whose task is missing being dropped, so hours vanish from a
//      total that is supposed to reconcile
//
// Several of these assert through `buildReport` rather than against the
// snapshot, deliberately: the bug is not in what the mapping SAYS, it is in
// what the engine then DOES with it, and only the second one is observable.
// ===================================================================

const TODAY = "2026-09-10";

function input(overrides: Partial<AppSnapshotInput> = {}): AppSnapshotInput {
  return {
    today: TODAY,
    projects: [
      {
        projectId: "proj-1",
        clientId: "client-1",
        title: "Xero migration",
        category: "external",
        isBillable: true,
        // Sold for 10 hours, currently estimated at 12 - the ordinary state
        // of a project whose estimates have crept.
        chargedMinutes: 600,
        estimateMinutes: 720,
      },
    ],
    tasks: [
      {
        taskId: "task-1",
        projectId: "proj-1",
        clientId: "client-1",
        title: "Build the importer",
        category: "external",
        isBillable: true,
      },
      {
        taskId: "task-2",
        projectId: "proj-1",
        clientId: "client-1",
        title: "Scope the ledger",
        category: "external",
        isBillable: true,
      },
    ],
    entries: [
      {
        entryId: "entry-1",
        taskId: "task-1",
        personId: "user-1",
        personName: "Louis",
        workDate: "2026-09-08",
        minutes: 90,
        notes: "Wrote the mapping",
        rndClass: null,
      },
      {
        entryId: "entry-2",
        taskId: "task-2",
        personId: "user-1",
        personName: "Louis",
        workDate: "2026-09-09",
        minutes: 30,
        notes: null,
        rndClass: "core",
      },
    ],
    ...overrides,
  };
}

describe("buildAppSnapshot", () => {
  it("turns minutes into whole seconds", () => {
    const snapshot = buildAppSnapshot(input());

    // 90 minutes is 5400 seconds. Passing 90 through would show as a minute
    // and a half on every screen, which is the kind of wrong that looks like
    // a quiet week rather than a bug.
    expect(snapshot.worklogs.map((worklog) => worklog.timeSpentSeconds)).toEqual([5400, 1800]);
  });

  it("never puts a clock time on a worklog, so overlaps cannot be invented", () => {
    const snapshot = buildAppSnapshot(input());

    // The app records a day and a duration. A start of 0 would read as
    // midnight and make two entries on one day overlap.
    expect(snapshot.worklogs.every((worklog) => worklog.startSecond === null)).toBe(true);

    const report = buildReport(snapshot);

    expect(report.findings.some((finding) => finding.code === FINDING_CODES.WORKLOG_OVERLAP)).toBe(false);
  });

  it("carries the note through exactly as typed, including absent", () => {
    const snapshot = buildAppSnapshot(input());

    expect(snapshot.worklogs.map((worklog) => worklog.narrative)).toEqual(["Wrote the mapping", null]);
  });

  it("carries the frozen R&D class off the entry and not off the project", () => {
    // The project says nothing; the entry says 'core'. The engine must report
    // the entry's value, because reclassifying a project cannot be allowed to
    // rewrite what past hours were claimed as.
    const snapshot = buildAppSnapshot(input());

    expect(snapshot.worklogs.map((worklog) => worklog.rndClass)).toEqual([null, "core"]);
  });

  // -----------------------------------------------------------------
  // Trap 1. The failure is silent and it is in the budget table.
  // -----------------------------------------------------------------
  describe("estimates", () => {
    it("puts one budget row per project, not one per task", () => {
      const report = buildReport(buildAppSnapshot(input()));

      expect(report.budget.map((row) => row.projectKey)).toEqual(["proj-1"]);
    });

    it("gives no task an estimate, which is what keeps it out of the budget table", () => {
      const snapshot = buildAppSnapshot(input());
      const tasks = snapshot.issues.filter((issue) => issue.parentKey !== null);

      expect(tasks).toHaveLength(2);
      expect(
        tasks.every(
          (task) => task.baselineEstimateSeconds === null && task.currentEstimateSeconds === null,
        ),
      ).toBe(true);
    });

    it("measures the charged figure as the baseline and the task estimates as the current", () => {
      const report = buildReport(buildAppSnapshot(input()));
      const [row] = report.budget;

      // Sold for 10 hours, forecast at 12, two hours booked. All three are
      // different questions and the table has to keep them apart.
      expect(row.baselineHours).toBe(10);
      expect(row.currentHours).toBe(12);
      expect(row.actualHours).toBe(2);
    });

    it("keeps a missing quote as null rather than treating it as nought", () => {
      const report = buildReport(
        buildAppSnapshot(
          input({
            projects: [{ ...input().projects[0], chargedMinutes: null }],
          }),
        ),
      );

      // Nought would mean "sold for no hours" and would draw a full bar
      // against it. Null means nobody has recorded the quote yet.
      expect(report.budget[0].baselineSeconds).toBeNull();
      expect(report.budget[0].baselineHours).toBeNull();
    });
  });

  // -----------------------------------------------------------------
  // Trap 2. The failure is noise, and noise hides the real findings.
  // -----------------------------------------------------------------
  describe("billable status", () => {
    it("declares billable on the task so nothing is reported as inherited", () => {
      const report = buildReport(buildAppSnapshot(input()));

      expect(report.facts.every((fact) => fact.billableSource === "issue")).toBe(true);
      expect(report.findings.some((finding) => finding.code === FINDING_CODES.BILLABLE_INHERITED)).toBe(
        false,
      );
    });

    it("has no unset bucket, so the one blocking billing finding cannot fire", () => {
      const report = buildReport(buildAppSnapshot(input()));

      expect(report.split.unsetSeconds).toBe(0);
      expect(report.findings.some((finding) => finding.code === FINDING_CODES.BILLABLE_UNSET)).toBe(false);
      expect(report.isBillable).toBe(true);
    });

    it("counts a non-billable project's hours as non-billable rather than as unset", () => {
      const base = input();
      const report = buildReport(
        buildAppSnapshot({
          ...base,
          projects: [{ ...base.projects[0], isBillable: false }],
          tasks: base.tasks.map((task) => ({ ...task, isBillable: false })),
        }),
      );

      expect(report.split.nonBillableSeconds).toBe(7200);
      expect(report.split.billableSeconds).toBe(0);
      expect(report.split.unsetSeconds).toBe(0);
    });
  });

  // -----------------------------------------------------------------
  // The client is the engine's "project key", and the category is the
  // client's. Both are easy to swap and neither fails loudly.
  // -----------------------------------------------------------------
  describe("the hierarchy", () => {
    it("rolls hours up to the project and names the client above it", () => {
      const report = buildReport(buildAppSnapshot(input()));
      const [row] = report.byProject;

      expect(row.projectKey).toBe("proj-1");
      expect(row.clientKey).toBe("client-1");
    });

    it("labels the category from the client, in the words the reports display", () => {
      const base = input();
      const report = buildReport(
        buildAppSnapshot({
          ...base,
          projects: [{ ...base.projects[0], category: "internal" }],
          tasks: base.tasks.map((task) => ({ ...task, category: "internal" as const })),
        }),
      );

      // The breakdown uses this string as both the key and the label, so it
      // is the display form rather than the enum value.
      expect(report.budget[0].category).toBe("Internal");
      expect(report.facts.every((fact) => fact.category === "Internal")).toBe(true);
    });
  });

  // -----------------------------------------------------------------
  // Trap 4. Hours must never quietly leave a total.
  // -----------------------------------------------------------------
  describe("an entry whose task is missing", () => {
    const orphaned = () => input({ tasks: [], projects: [] });

    it("is still counted, because the time was worked", () => {
      const report = buildReport(buildAppSnapshot(orphaned()));

      expect(report.totals.seconds).toBe(7200);
    });

    it("is reported rather than swallowed", () => {
      const report = buildReport(buildAppSnapshot(orphaned()));

      expect(report.facts.every((fact) => fact.isOrphan)).toBe(true);
      expect(report.findings.some((finding) => finding.code === FINDING_CODES.ORPHAN_WORKLOG)).toBe(true);
    });

    it("is countable by the caller without inspecting the snapshot", () => {
      expect(countOrphanedEntries(orphaned())).toBe(2);
      expect(countOrphanedEntries(input())).toBe(0);
    });
  });

  it("produces an empty report rather than throwing when nothing is logged", () => {
    // The state this app is actually in on the day the switch lands, so it
    // had better not be an exception.
    const report = buildReport(buildAppSnapshot(input({ entries: [] })));

    expect(report.totals.seconds).toBe(0);
    expect(report.byPerson).toEqual([]);
    // The project still appears, because it still has a budget worth seeing.
    expect(report.budget.map((row) => row.projectKey)).toEqual(["proj-1"]);
  });
});
