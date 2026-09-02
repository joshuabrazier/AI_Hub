import { hoursFromSeconds } from "./aggregate";

// -------------------------------------------------------------------
// Outstanding effort: how much work is left, by project.
//
// This is the one timesheet view that is NOT about a period. Everything else
// here answers "what happened in August"; this answers "what is left", which
// is a fact about right now. Scoping it to a month would be wrong: an
// estimate set in July and worked in September belongs to both.
//
// TWO THINGS ABOUT THE REAL DATA SHAPE THIS WHOLE MODULE, AND BOTH PRODUCE
// PLAUSIBLE WRONG NUMBERS IF IGNORED.
//
// 1. A PARENT ESTIMATE IS SOMETIMES A ROLL-UP OF ITS CHILDREN AND SOMETIMES
//    THE ONLY ESTIMATE THERE IS.
//
//    Measured on live data: TSSS-1 "Notifications" is estimated at 22.5h and
//    its eight estimated children sum to exactly 22.5h - add both levels and
//    the project doubles. But TSSS-88 "Phase 2 - Xero Integration" is
//    estimated at 97.5h across eleven children, NONE of which carry an
//    estimate - count only leaves and the largest committed piece of work in
//    that project reports as zero.
//
//    So neither level can be chosen globally. The rule is decided per branch:
//    a parent's children speak for it if ANY of them carry an estimate,
//    otherwise the parent speaks for itself.
//
// 2. MOST OPEN WORK IS NOT ESTIMATED AT ALL, AND THAT MUST NOT READ AS
//    "NOTHING LEFT".
//
//    Measured on live data: 54 open issues, 5 estimated. A single
//    "outstanding: 121h" tile computed over that is not a small
//    underestimate - it is a number describing a tenth of the work while
//    looking complete. Unestimated open work is therefore carried as its own
//    count with its own hours-to-date, never folded into the totals, and
//    every caller is handed both halves or neither.
//
// The engine is pure and takes the whole snapshot, like the rest of this
// folder. It never queries and never calls a model - see the rule in
// CLAUDE.md about nothing near the timesheet figures computing one.
// -------------------------------------------------------------------

// Statuses that mean the work is finished. Compared case-insensitively but
// otherwise exactly. A workflow status this does not recognise counts as
// OPEN, which is the safe direction: work wrongly shown as outstanding gets
// questioned, work wrongly shown as finished never does.
const DONE_STATUSES = new Set(["done", "closed", "resolved", "complete", "completed", "cancelled", "canceled"]);

export function isDoneStatus(status: string | null | undefined): boolean {
  return status != null && DONE_STATUSES.has(status.trim().toLowerCase());
}

export interface OutstandingIssueInput {
  issueKey: string;
  parentKey?: string | null;
  projectKey: string;
  issueType?: string | null;
  summary: string;
  status?: string | null;
  currentEstimateSeconds?: number | null;
  // Time logged against THIS issue, all time. Not period scoped, and not
  // inclusive of children - any roll-up happens here, where the
  // double-counting rule can see it.
  loggedSeconds: number;
}

export interface OutstandingItem {
  issueKey: string;
  summary: string;
  issueType: string | null;
  status: string | null;
  estimateSeconds: number;
  loggedSeconds: number;
  // max(0, estimate - logged). Floored deliberately: an overrun is a
  // different fact from work remaining, and a negative here would let one
  // overrunning item quietly cancel out another item's real remaining work.
  remainingSeconds: number;
  // True when this line stands in for children beneath it that carry no
  // estimate of their own. The number is real but coarser - one figure
  // covering several items - and a screen that cannot say which lines are
  // which cannot be checked by the person reading it.
  coversChildren: boolean;
  // How many OPEN items sit beneath it. The badge that says a line covers
  // children promises something the reader would otherwise have to open Jira
  // to size: "covers 4 open items beneath it" is checkable, "covers items
  // beneath it" is only a claim. Open ones only - a finished child is not
  // work this figure is still holding.
  coversOpenCount: number;
  // Logged already exceeds the estimate. Not an error and not netted off
  // anywhere - just surfaced, because "0h remaining" on an item 3h over is a
  // different conversation from one that came in exactly on the money.
  isOverrun: boolean;
}

export interface UnestimatedItem {
  issueKey: string;
  summary: string;
  issueType: string | null;
  status: string | null;
  // What has already gone into it. The only honest thing that can be said
  // about an unestimated open item, and much better than silence: an item
  // with 12h on it and no estimate is a different conversation from one with
  // nothing on it at all.
  loggedSeconds: number;
}

export interface ProjectOutstanding {
  projectKey: string;
  projectName: string;
  // Open, estimated work only.
  estimateSeconds: number;
  loggedSeconds: number;
  remainingSeconds: number;
  // Estimated work already finished, so a project's whole commitment can be
  // shown without implying all of it is still to come.
  completedEstimateSeconds: number;
  items: OutstandingItem[];
  // Open work carrying no estimate on either level. NEVER added to the
  // figures above.
  unestimated: UnestimatedItem[];
  unestimatedLoggedSeconds: number;
  // How many of the estimated lines stand in for children beneath them.
  coversChildrenCount: number;
}

export interface OutstandingSummary {
  projects: ProjectOutstanding[];
  remainingSeconds: number;
  estimateSeconds: number;
  loggedSeconds: number;
  openIssueCount: number;
  estimatedIssueCount: number;
  unestimatedIssueCount: number;
  unestimatedLoggedSeconds: number;
  // The share of open issues carrying an estimate, 0-1, or null when there is
  // no open work at all. This is the number that says whether the rest of the
  // screen can be trusted, so it is computed here rather than left to a
  // component to derive and get subtly different.
  estimateCoverage: number | null;
}

export function secondsToHours(seconds: number): number {
  return hoursFromSeconds(seconds);
}

function hasEstimate(issue: OutstandingIssueInput | undefined): boolean {
  return issue != null && issue.currentEstimateSeconds != null && issue.currentEstimateSeconds > 0;
}

// -------------------------------------------------------------------
// WHAT PART EACH ISSUE PLAYS. This is the whole double-counting defence, and
// it is one decision rather than several so it can be tested on its own.
//
// Exactly one level of a branch carries its estimate:
//
//   rolled-up-parent  Its children carry the estimates, so its own figure is
//                     those children added up. Contributes no estimate. Its
//                     own logged hours are still real and still counted.
//
//   covered-by-parent Its parent carries an estimate for the whole subtree,
//                     because no child of that parent was estimated.
//                     Contributes nothing at all - not even as unestimated,
//                     since it is not unestimated, it is estimated one level
//                     up. Listing it again is how 97.5h became 97.5h twelve
//                     times over in the first draft of this file.
//
//   carrier           Carries its own estimate.
//
//   unestimated       Open, and nothing above or on it says how long it takes.
// -------------------------------------------------------------------
export type IssueRole = "rolled-up-parent" | "covered-by-parent" | "carrier" | "unestimated";

export function classifyIssue(
  issue: OutstandingIssueInput,
  parent: OutstandingIssueInput | undefined,
  parentHasEstimatedChildren: boolean,
  issueHasEstimatedChildren: boolean,
): IssueRole {
  if (issueHasEstimatedChildren) return "rolled-up-parent";
  if (hasEstimate(issue)) return "carrier";

  // No estimate of its own. Its parent speaks for it only when that parent
  // has a figure AND none of its children were estimated - otherwise the
  // parent is a roll-up and has nothing of its own to lend.
  if (parent != null && !parentHasEstimatedChildren && hasEstimate(parent)) return "covered-by-parent";

  return "unestimated";
}

export function buildOutstanding(
  issues: OutstandingIssueInput[],
  projectNames: Map<string, string> = new Map(),
): OutstandingSummary {
  const byKey = new Map(issues.map((issue) => [issue.issueKey, issue]));

  // Which parents have at least one estimated child. Computed once up front:
  // it is the question every child has to ask, and answering it per child
  // would be quadratic on a project with hundreds of items.
  const rolledUpParents = new Set<string>();
  for (const issue of issues) {
    if (issue.parentKey == null) continue;
    if (issue.currentEstimateSeconds != null && issue.currentEstimateSeconds > 0) {
      rolledUpParents.add(issue.parentKey);
    }
  }

  const projects = new Map<string, ProjectOutstanding>();

  const projectFor = (key: string): ProjectOutstanding => {
    let project = projects.get(key);
    if (!project) {
      project = {
        projectKey: key,
        projectName: projectNames.get(key) ?? key,
        estimateSeconds: 0,
        loggedSeconds: 0,
        remainingSeconds: 0,
        completedEstimateSeconds: 0,
        items: [],
        unestimated: [],
        unestimatedLoggedSeconds: 0,
        coversChildrenCount: 0,
      };
      projects.set(key, project);
    }
    return project;
  };

  // Hours logged BENEATH each parent. Derived here rather than asked of the
  // caller: a caller that forgot to supply it would pass zero, and the screen
  // would silently report a parent's full estimate as outstanding with work
  // already done against it. Deriving it makes that impossible to get wrong.
  //
  // Accumulated up the WHOLE chain rather than one level. Today Jira enforces
  // Project above Deliverable and nothing between, so one level would be
  // enough - but "enough given the current issue type scheme" is a fragile
  // thing to bake into a number somebody quotes to a client, and walking the
  // chain costs nothing.
  //
  // The seen-set is a cycle guard. Jira should never produce one; an infinite
  // loop rendering a page is a bad way to find out it did.
  const childLoggedByParent = new Map<string, number>();
  const openDescendants = new Map<string, number>();

  for (const issue of issues) {
    const seen = new Set<string>([issue.issueKey]);
    let ancestorKey = issue.parentKey;
    const issueIsOpen = !isDoneStatus(issue.status);

    while (ancestorKey != null && !seen.has(ancestorKey)) {
      seen.add(ancestorKey);
      childLoggedByParent.set(ancestorKey, (childLoggedByParent.get(ancestorKey) ?? 0) + issue.loggedSeconds);
      if (issueIsOpen) openDescendants.set(ancestorKey, (openDescendants.get(ancestorKey) ?? 0) + 1);
      ancestorKey = byKey.get(ancestorKey)?.parentKey ?? null;
    }
  }

  for (const issue of issues) {
    const project = projectFor(issue.projectKey);
    const done = isDoneStatus(issue.status);
    const parent = issue.parentKey != null ? byKey.get(issue.parentKey) : undefined;

    const role = classifyIssue(
      issue,
      parent,
      issue.parentKey != null && rolledUpParents.has(issue.parentKey),
      rolledUpParents.has(issue.issueKey),
    );

    // Its children are its estimate. The hours booked directly to it are
    // still real time somebody spent - in the live data 10 hours sit on three
    // such parents - so they stay in the project's logged total.
    if (role === "rolled-up-parent") {
      project.loggedSeconds += issue.loggedSeconds;
      continue;
    }

    // Already counted, one level up, estimate and hours alike.
    if (role === "covered-by-parent") continue;

    if (role === "unestimated") {
      if (done) {
        // Finished, never estimated. Its hours are still real spend and
        // belong in the project's logged total; there is simply nothing
        // outstanding to say about it.
        project.loggedSeconds += issue.loggedSeconds;
        continue;
      }

      project.unestimated.push({
        issueKey: issue.issueKey,
        summary: issue.summary,
        issueType: issue.issueType ?? null,
        status: issue.status ?? null,
        loggedSeconds: issue.loggedSeconds,
      });
      project.unestimatedLoggedSeconds += issue.loggedSeconds;
      continue;
    }

    const estimateSeconds = issue.currentEstimateSeconds as number;

    // A carrier with children stands in for all of them, so work already done
    // beneath it counts against its figure. Without this TSSS-88 reports its
    // full 97.5h outstanding while 5.5h has already gone into the children it
    // is speaking for.
    const childLogged = childLoggedByParent.get(issue.issueKey);
    const coversChildren = childLogged != null;
    const loggedAgainst = issue.loggedSeconds + (childLogged ?? 0);

    if (done) {
      project.completedEstimateSeconds += estimateSeconds;
      project.loggedSeconds += loggedAgainst;
      continue;
    }

    const remainingSeconds = Math.max(0, estimateSeconds - loggedAgainst);

    project.items.push({
      issueKey: issue.issueKey,
      summary: issue.summary,
      issueType: issue.issueType ?? null,
      status: issue.status ?? null,
      estimateSeconds,
      loggedSeconds: loggedAgainst,
      remainingSeconds,
      coversChildren,
      coversOpenCount: openDescendants.get(issue.issueKey) ?? 0,
      isOverrun: loggedAgainst > estimateSeconds,
    });

    project.estimateSeconds += estimateSeconds;
    project.loggedSeconds += loggedAgainst;
    project.remainingSeconds += remainingSeconds;
    if (coversChildren) project.coversChildrenCount += 1;
  }

  const ordered = [...projects.values()]
    .filter((project) => project.items.length > 0 || project.unestimated.length > 0)
    .map((project) => ({
      ...project,
      // Most remaining first. The screen exists to show what is left, so the
      // biggest piece of that belongs at the top rather than whatever happens
      // to sort first alphabetically.
      items: [...project.items].sort((a, b) => b.remainingSeconds - a.remainingSeconds),
      unestimated: [...project.unestimated].sort((a, b) => b.loggedSeconds - a.loggedSeconds),
    }))
    .sort((a, b) => b.remainingSeconds - a.remainingSeconds || a.projectKey.localeCompare(b.projectKey));

  const estimatedIssueCount = ordered.reduce((total, project) => total + project.items.length, 0);
  const unestimatedIssueCount = ordered.reduce((total, project) => total + project.unestimated.length, 0);
  const openIssueCount = estimatedIssueCount + unestimatedIssueCount;

  return {
    projects: ordered,
    remainingSeconds: ordered.reduce((total, project) => total + project.remainingSeconds, 0),
    estimateSeconds: ordered.reduce((total, project) => total + project.estimateSeconds, 0),
    loggedSeconds: ordered.reduce((total, project) => total + project.loggedSeconds, 0),
    openIssueCount,
    estimatedIssueCount,
    unestimatedIssueCount,
    unestimatedLoggedSeconds: ordered.reduce((total, project) => total + project.unestimatedLoggedSeconds, 0),
    estimateCoverage: openIssueCount > 0 ? estimatedIssueCount / openIssueCount : null,
  };
}

// -------------------------------------------------------------------
// Narrow the issue set to what a filter selected.
//
// The overview screen shows outstanding effort beside the period figures once
// a client or a project is chosen, and this is how that set is picked.
//
// A PROJECT SCOPE TAKES THE WHOLE SUBTREE, not just the one issue, and that
// is what makes it safe to reuse buildOutstanding on the result. The roll-up
// rule works by comparing an issue against its parent and siblings, so an
// issue arriving without its family would be judged against a family that is
// not there: a child whose siblings were filtered out would look like an only
// child and start inheriting a roll-up nobody meant it to have.
//
// Taking the subtree means every issue in the scoped set still sits beside
// the relatives the rule needs. A child selected on its own is deliberately
// NOT supported for that reason - the filter offers parents.
//
// Scopes combine: a client and a project narrow to the intersection, which is
// what the two dropdowns above the screen look like they do.
// -------------------------------------------------------------------
export function scopeIssues(
  issues: OutstandingIssueInput[],
  scope: { clientKey?: string | null; projectKey?: string | null },
): OutstandingIssueInput[] {
  const { clientKey, projectKey } = scope;

  let scoped = issues;

  // 'all' is what the dropdowns send for "no narrowing". Treated as absent
  // rather than matched, or every screen would filter to a client key nobody
  // has.
  if (clientKey != null && clientKey !== "all") {
    scoped = scoped.filter((issue) => issue.projectKey === clientKey);
  }

  if (projectKey != null && projectKey !== "all") {
    const wanted = new Set<string>([projectKey]);

    // Walk down until nothing new is added, so a deeper tree than today's two
    // levels is included rather than silently cut off at the first generation.
    // The set membership is the termination condition, so a parent cycle
    // cannot spin here either.
    let added = true;
    while (added) {
      added = false;
      for (const issue of scoped) {
        if (issue.parentKey != null && wanted.has(issue.parentKey) && !wanted.has(issue.issueKey)) {
          wanted.add(issue.issueKey);
          added = true;
        }
      }
    }

    scoped = scoped.filter((issue) => wanted.has(issue.issueKey));
  }

  return scoped;
}
