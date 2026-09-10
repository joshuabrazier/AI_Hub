import { PROJECT_CATEGORY_LABELS, type ProjectCategory } from "@/lib/data/kysely-database-types";

import { BILLABLE_NO, BILLABLE_YES } from "./revenue";
import type { SnapshotIssue, SnapshotWorklog, TimesheetSnapshot } from "./timesheet.types";

// -------------------------------------------------------------------
// ===================================================================
// THE APP'S DELIVERY DATA -> THE TIMESHEET ENGINE'S SNAPSHOT
// ===================================================================
//
// PURE, AND THAT IS THE WHOLE REASON IT IS A SEPARATE FILE. It takes rows and
// returns a snapshot: no imports from a feature, no I/O, no clock. The engine
// beside it has the same property, which is what lets the mapping be tested
// on its own - and this mapping is worth testing, because every figure on
// every /admin/timesheets screen now depends on it being right.
//
// The reports used to read a Jira-synced read model. The hierarchies line up:
//
//   Jira space        ->  client        (the engine calls this the client)
//   parent issue      ->  project       (Jira called it the "Project item")
//   issue             ->  task
//   worklog           ->  time entry
//
// -------------------------------------------------------------------
// FOUR THINGS ARE EASY TO GET WRONG HERE. All four are load-bearing.
//
// 1. ESTIMATES GO ON THE PROJECT AND NEVER ON THE TASK.
//
//    `rollUpBudget` decides what a budget row is with: every issue that is a
//    parent of something, PLUS every issue carrying an estimate. So putting a
//    task's `estimateMinutes` on its snapshot issue does not add detail - it
//    promotes every task in the business to a row in the project budget
//    table, which then double-counts, because its hours are already in its
//    project's row.
//
//    The task's estimate is not lost. It is summed into the project's
//    `currentEstimateSeconds` by the read that produced these rows.
//
// 2. BILLABLE IS SET ON THE TASK AS WELL AS THE PROJECT.
//
//    The app declares `is_billable` on the project, so the natural mapping
//    leaves the task's null and lets the engine inherit it. Doing that makes
//    `billableSource` "parent" for every fact in the app, and
//    `findInheritedBillable` then raises a warning PER TASK - fifty tasks,
//    fifty warnings, burying every finding that matters.
//
//    That finding exists for a specific hazard: "re-parenting an item then
//    changes its billing status silently". A task in this app cannot be
//    re-parented across projects - the board only ever moves one between
//    phases of the project it is already in - so the hazard does not exist
//    and the warning would be describing something impossible. The value is
//    stamped on both, which is the honest answer for a model where it cannot
//    drift.
//
// 3. THERE IS NO "UNSET" BILLABLE STATE, and that is an improvement rather
//    than an omission. `projects.is_billable` is NOT NULL, so every hour is
//    one or the other. BILLABLE_UNSET is the engine's only BLOCKING finding
//    about billing, and it can no longer fire - a period cannot be held up by
//    somebody having failed to tick a box that has no unticked state.
//
// 4. THE CATEGORY IS THE CLIENT'S, and the engine agrees in writing:
//    "A project with no time booked still has a category, because the
//    category belongs to the client rather than to any worklog." It arrives
//    on these rows already resolved from `clients.category`.
// -------------------------------------------------------------------

/** What the mapping needs about one logged hour. Shaped by the repository. */
export interface AppSnapshotEntry {
  entryId: string;
  taskId: string;
  personId: string;
  personName: string | null;
  workDate: string;
  minutes: number;
  notes: string | null;
  rndClass: string | null;
}

/** What the mapping needs about one task. */
export interface AppSnapshotTask {
  taskId: string;
  projectId: string;
  clientId: string;
  title: string;
  category: ProjectCategory;
  isBillable: boolean;
}

/** What the mapping needs about one project. */
export interface AppSnapshotProject {
  projectId: string;
  clientId: string;
  title: string;
  category: ProjectCategory;
  isBillable: boolean;
  /** What the client agreed to pay for. NULL is "not recorded", not nought. */
  chargedMinutes: number | null;
  /** The sum of its task estimates. Nought when it has no tasks. */
  estimateMinutes: number;
}

export interface AppSnapshotInput {
  entries: readonly AppSnapshotEntry[];
  tasks: readonly AppSnapshotTask[];
  projects: readonly AppSnapshotProject[];
  /** 'YYYY-MM-DD' in the app zone, from todayInAppZone(). Never a clock read. */
  today: string;
  options?: TimesheetSnapshot["options"];
}

// Minutes are the unit everywhere in the delivery schema; the engine works in
// whole seconds. One conversion, in one place, so no caller invents a second.
const MINUTES_TO_SECONDS = 60;

function toSeconds(minutes: number): number {
  return Math.round(minutes) * MINUTES_TO_SECONDS;
}

// The engine compares against these exact strings. They are Jira's field
// values and three files in this directory still spell them as literals -
// aggregate.ts keeps private copies, overview-series.ts inlines them - so
// they are imported from the one place that exports them rather than typed
// out a fourth time.
function toBillableLabel(isBillable: boolean): string {
  return isBillable ? BILLABLE_YES : BILLABLE_NO;
}

// -------------------------------------------------------------------
// The mapping.
// -------------------------------------------------------------------
export function buildAppSnapshot(input: AppSnapshotInput): TimesheetSnapshot {
  const worklogs: SnapshotWorklog[] = input.entries.map((entry) => ({
    worklogId: entry.entryId,
    issueKey: entry.taskId,
    personId: entry.personId,
    personName: entry.personName,
    workDate: entry.workDate,
    // -------------------------------------------------------------
    // ALWAYS NULL: the app records a DAY and a duration, never a clock
    // time. The engine's overlap rule skips a worklog with no start
    // rather than treating it as beginning at midnight, so
    // WORKLOG_OVERLAP simply stops firing.
    //
    // That is the honest outcome, not a regression papered over. Two
    // entries on one day cannot be shown to overlap when neither says
    // when it began, and inventing a start - 9am, or sequentially from
    // midnight - would manufacture overlaps that never happened and
    // mark real periods non-billable for them.
    // -------------------------------------------------------------
    startSecond: null,
    timeSpentSeconds: toSeconds(entry.minutes),
    // The note somebody typed, exactly as typed, including absent. The
    // engine raises MISSING_NARRATIVE as a WARNING for a blank one and its
    // own comment already allows for this being the normal case; filling it
    // in from the task title here would silence a real finding by making
    // every entry look described.
    narrative: entry.notes,
    // Frozen onto the entry when the hour was logged - never the project's
    // current class. See migration 028.
    rndClass: entry.rndClass,
  }));

  // -------------------------------------------------------------------
  // Tasks are the DELIVERABLES: they carry a parent and no estimate. See
  // note 1 at the top for why the estimate is deliberately absent.
  // -------------------------------------------------------------------
  const taskIssues: SnapshotIssue[] = input.tasks.map((task) => ({
    issueKey: task.taskId,
    parentKey: task.projectId,
    projectKey: task.clientId,
    issueType: "Task",
    summary: task.title,
    category: PROJECT_CATEGORY_LABELS[task.category],
    billable: toBillableLabel(task.isBillable),
    baselineEstimateSeconds: null,
    currentEstimateSeconds: null,
  }));

  // -------------------------------------------------------------------
  // Projects are the PARENTS: no parent of their own, and the two estimates
  // the budget table measures against.
  //
  //   baseline  what the client agreed to pay for - `chargedMinutes`. Does
  //             not move because the work took longer.
  //   current   the sum of the task estimates, which climbs as people
  //             revise them.
  //
  // A project with no quote recorded keeps a NULL baseline. The engine
  // answers a null percentage for it rather than drawing a full bar, which
  // is the same convention `chargedProgress` follows in delivery.types.
  // -------------------------------------------------------------------
  const projectIssues: SnapshotIssue[] = input.projects.map((project) => ({
    issueKey: project.projectId,
    parentKey: null,
    projectKey: project.clientId,
    issueType: "Project",
    summary: project.title,
    category: PROJECT_CATEGORY_LABELS[project.category],
    billable: toBillableLabel(project.isBillable),
    baselineEstimateSeconds: project.chargedMinutes === null ? null : toSeconds(project.chargedMinutes),
    currentEstimateSeconds: toSeconds(project.estimateMinutes),
  }));

  // -------------------------------------------------------------------
  // AN ENTRY WHOSE TASK IS MISSING IS PASSED THROUGH, not dropped and not
  // patched. The engine marks such a fact `isOrphan`, still counts its hours
  // - the time was worked - and raises ORPHAN_WORKLOG so somebody can see
  // it. Filtering it out here would make the hours disappear from a total
  // that is supposed to reconcile, and do it silently.
  //
  // So there is nothing to do about it in this function, which is why it
  // makes no attempt to. `countOrphanedEntries` below is how a caller finds
  // out, and it is separate because the snapshot's shape is the engine's
  // contract while that count is a fact about this mapping.
  // -------------------------------------------------------------------
  return {
    worklogs,
    issues: [...taskIssues, ...projectIssues],
    today: input.today,
    options: input.options,
  };
}

/**
 * How many entries in the range name a task that is not in the snapshot.
 *
 * Exposed separately rather than folded into the snapshot, because the
 * snapshot's shape is the engine's contract and this is a fact about the
 * mapping. It should always be nought - `time_entries.task_id` is a foreign
 * key - and a non-zero answer means a read window that fetched entries and
 * tasks inconsistently rather than a data problem.
 */
export function countOrphanedEntries(input: Pick<AppSnapshotInput, "entries" | "tasks">): number {
  const taskIds = new Set(input.tasks.map((task) => task.taskId));

  return input.entries.filter((entry) => !taskIds.has(entry.taskId)).length;
}
