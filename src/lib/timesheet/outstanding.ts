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
// -------------------------------------------------------------------
// AN OPEN ITEM WHOSE ESTIMATE LIVES ON AN ANCESTOR.
//
// These carry no figure of their own and are never counted - the hours are
// already inside the covering line's estimate. They are listed anyway, and
// that is the point of the type: "84.5 h left on Phase 2" is a number the
// reader cannot act on until they can see the four open items it is holding.
// Without this the covering badge names work nobody can look at.
// -------------------------------------------------------------------
export interface CoveredItem {
  issueKey: string;
  summary: string;
  issueType: string | null;
  status: string | null;
  loggedSeconds: number;
  // The ancestor whose estimate speaks for it, so the reader can see WHICH
  // line is holding it rather than only that some line is.
  coveredBy: string;
}

// -------------------------------------------------------------------
// The figures for any one grouping. Shared by a client and a project so the
// two levels cannot drift into reporting different things by different names.
// -------------------------------------------------------------------
export interface OutstandingTotals {
  // Open, estimated work only.
  estimateSeconds: number;
  loggedSeconds: number;
  remainingSeconds: number;
  // Estimated work already finished, so a commitment can be shown whole
  // without implying all of it is still to come.
  completedEstimateSeconds: number;
  // What that finished work actually took. Kept beside the estimate rather
  // than folded into loggedSeconds, because "we estimated 20h and spent 26h"
  // is the sentence that tells you whether to trust the rest of the page.
  completedLoggedSeconds: number;
  completedCount: number;

  // -----------------------------------------------------------------
  // BUDGET, which is a DIFFERENT QUESTION from work left and the one people
  // usually mean when they say "how much have we got left on this".
  //
  //   remainingSeconds  what the open tasks are estimated at, less what has
  //                     gone into them. "How much work is still to do."
  //
  //   budgetRemaining   everything committed, less everything spent. "How
  //                     much time can we still put into this."
  //
  // They come apart the moment an estimate is wrong, which is always.
  // Measured live on Phase 2: finished items were estimated at 51h and took
  // 5.5h, so 39h of work remains but 84.5h of the 97.5h commitment is still
  // unspent. Coming in under gives the time back to the project, and a page
  // showing only the first figure looks like 45h went missing.
  //
  // Both are shown. Neither is the "real" one - they answer different
  // questions, and which one matters depends on whether you are planning
  // delivery or watching a budget.
  // -----------------------------------------------------------------
  committedSeconds: number;
  // Everything logged in scope: estimated, finished and unestimated alike.
  // loggedSeconds deliberately excludes unestimated work to keep the
  // estimate columns clean; a budget cannot afford that distinction, because
  // time spent on an unestimated task is spent all the same.
  spentSeconds: number;
  // max(0, committed - spent). Floored for the same reason an item's is: an
  // overrun is a different fact from budget remaining, and a negative here
  // would let one overrunning project cancel out another's real headroom.
  budgetRemainingSeconds: number;
  // Spent more than was committed. Surfaced rather than hidden behind the
  // floor above.
  overBudgetSeconds: number;
  openCount: number;
  // Open items carrying an estimate of their own.
  estimatedCount: number;
  // Open items whose size lives on a line above them. SIZED, not unsized -
  // see the note on estimateCoverage.
  coveredCount: number;
  unestimatedCount: number;
  unestimatedLoggedSeconds: number;
  // The share of open work that has been SIZED, 0-1, or null when there is no
  // open work. This is the number that says whether the rest can be trusted,
  // so it is computed once here rather than in each component.
  //
  // COVERED ITEMS COUNT AS SIZED, and getting that wrong is worse than it
  // sounds. Phase 2 is one 97.5h estimate over four deliverables: counting
  // those four as unsized reported 20% coverage on work that is entirely
  // estimated, which fired the "this is only a floor" warning at a project
  // that did not deserve it. A warning that cries wolf on good data is worse
  // than no warning, because it teaches the reader to scroll past the one
  // that matters.
  estimateCoverage: number | null;
}

// -------------------------------------------------------------------
// A PROJECT: one top-level piece of work, keyed by its own issue - TSSS-88
// "Phase 2 - Xero Integration". What the business writes an invoice against.
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// FINISHED WORK, and what it actually took.
//
// The other half of the same question. "39 h left" is only worth as much as
// the estimates behind it, and the way to judge those is to look at what the
// finished items were estimated at against what they actually cost.
//
// varianceSeconds is actual minus estimate, so POSITIVE means it took longer
// than planned. Signed rather than absolute, because a team that consistently
// runs over and a team that consistently runs under have opposite problems
// and an absolute figure hides which one you have.
// -------------------------------------------------------------------
export interface CompletedItem {
  issueKey: string;
  summary: string;
  issueType: string | null;
  status: string | null;
  // null when it was finished without ever being estimated. There is nothing
  // to compare it against, and it is shown that way rather than as zero.
  estimateSeconds: number | null;
  loggedSeconds: number;
  varianceSeconds: number | null;
}

export interface ProjectOutstanding extends OutstandingTotals {
  issueKey: string;
  summary: string;
  issueType: string | null;
  status: string | null;
  items: OutstandingItem[];
  unestimated: UnestimatedItem[];
  covered: CoveredItem[];
  completed: CompletedItem[];
}

// -------------------------------------------------------------------
// A CLIENT: the Jira project, keyed "TSSS", named "Trainer Suzie Swim
// School". Holds the projects above.
// -------------------------------------------------------------------
export interface ClientOutstanding extends OutstandingTotals {
  clientKey: string;
  clientName: string;
  projects: ProjectOutstanding[];
}

export interface OutstandingSummary extends OutstandingTotals {
  clients: ClientOutstanding[];
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
//                     Contributes no figure of its own - it is not
//                     unestimated, it is estimated one level up. Counting it
//                     again is how 97.5h became 97.5h twelve times over in
//                     the first draft of this file. It IS listed, under the
//                     line that covers it, so the reader can see what that
//                     line is holding.
//
//   carrier           Carries its own estimate.
//
//   unestimated       Open, and nothing above or on it says how long it takes.
//
// Coverage looks at the DIRECT parent only. Jira allows exactly two levels
// here - Project above Deliverable, verified against the live read model - so
// a deeper tree cannot arise today. If one ever does, a grandchild falls
// through to "unestimated", which is the safe direction: it appears as work
// nobody has sized rather than being silently absorbed into a figure above it.
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

// Totals that add nothing yet. Written as a factory rather than a shared
// constant so two groupings can never end up mutating the same object.
// Record a finished item, with its estimate where it had one of its own.
// loggedOverride carries the subtree total for a parent that spoke for its
// children, so a finished project is compared on everything spent beneath it.
function recordCompleted(
  project: ProjectOutstanding,
  issue: OutstandingIssueInput,
  estimateSeconds: number | null,
  loggedOverride?: number,
): void {
  const loggedSeconds = loggedOverride ?? issue.loggedSeconds;

  project.completed.push({
    issueKey: issue.issueKey,
    summary: issue.summary,
    issueType: issue.issueType ?? null,
    status: issue.status ?? null,
    estimateSeconds,
    loggedSeconds,
    // Positive means it took longer than planned. Null when there was no
    // estimate, because there is nothing to be over or under.
    varianceSeconds: estimateSeconds === null ? null : loggedSeconds - estimateSeconds,
  });

  project.completedLoggedSeconds += loggedSeconds;
  project.completedCount += 1;
}

function emptyTotals(): OutstandingTotals {
  return {
    estimateSeconds: 0,
    loggedSeconds: 0,
    remainingSeconds: 0,
    completedEstimateSeconds: 0,
    completedLoggedSeconds: 0,
    completedCount: 0,
    committedSeconds: 0,
    spentSeconds: 0,
    budgetRemainingSeconds: 0,
    overBudgetSeconds: 0,
    openCount: 0,
    estimatedCount: 0,
    coveredCount: 0,
    unestimatedCount: 0,
    unestimatedLoggedSeconds: 0,
    estimateCoverage: null,
  };
}

function addInto(target: OutstandingTotals, source: OutstandingTotals): void {
  target.estimateSeconds += source.estimateSeconds;
  target.loggedSeconds += source.loggedSeconds;
  target.remainingSeconds += source.remainingSeconds;
  // committedSeconds, spentSeconds, budgetRemainingSeconds and
  // overBudgetSeconds are deliberately NOT summed here. They are derived, and
  // finaliseBudget recomputes each level from that levels own totals - see
  // the note there about why adding floored figures hides an overrun.
  target.completedEstimateSeconds += source.completedEstimateSeconds;
  target.completedLoggedSeconds += source.completedLoggedSeconds;
  target.completedCount += source.completedCount;
  target.openCount += source.openCount;
  target.estimatedCount += source.estimatedCount;
  target.coveredCount += source.coveredCount;
  target.unestimatedCount += source.unestimatedCount;
  target.unestimatedLoggedSeconds += source.unestimatedLoggedSeconds;
}

// Coverage is a RATIO, so it is recomputed from the counts at each level
// rather than averaged up from the level below. Averaging ratios of different
// sizes is how a client with one fully estimated project and one with forty
// unestimated items reports 50% coverage.
function finaliseCoverage(totals: OutstandingTotals): void {
  const sized = totals.estimatedCount + totals.coveredCount;
  totals.estimateCoverage = totals.openCount > 0 ? sized / totals.openCount : null;
}

// -------------------------------------------------------------------
// The budget figures, derived at each level from THAT LEVEL'S OWN totals.
//
// Not summed up from the level below, which would be the obvious shortcut and
// would be wrong: budgetRemaining is floored at zero, so adding floored
// figures hides an overrunning project behind a healthy one's headroom. Every
// level subtracts its own spend from its own commitment, once.
// -------------------------------------------------------------------
function finaliseBudget(totals: OutstandingTotals): void {
  totals.committedSeconds = totals.estimateSeconds + totals.completedEstimateSeconds;
  totals.spentSeconds = totals.loggedSeconds + totals.unestimatedLoggedSeconds;

  const difference = totals.committedSeconds - totals.spentSeconds;

  totals.budgetRemainingSeconds = Math.max(0, difference);

  // YOU CANNOT BE OVER A BUDGET NOBODY SET. With nothing committed the
  // subtraction makes every hour ever logged look like an overrun: Internal
  // Operations has no estimates at all and reported "13.5 h over" beside a
  // budget of "unknown", which is two contradictory statements about the same
  // project.
  //
  // The view guarded against showing it; the AI paths read these fields
  // directly and would have said it out loud. So the guard belongs here,
  // where every caller gets it.
  totals.overBudgetSeconds = totals.committedSeconds > 0 ? Math.max(0, -difference) : 0;
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

  // Hours logged BENEATH each issue, and how many OPEN items sit under it.
  //
  // Derived here rather than asked of the caller: a caller that forgot would
  // pass zero, and the screen would report a parent's full estimate as
  // outstanding with work already done against it.
  //
  // Accumulated up the WHOLE chain rather than one level. Today Jira enforces
  // Project above Deliverable and nothing between, so one level would do -
  // but "enough given the current issue type scheme" is a fragile thing to
  // bake into a number somebody quotes to a client, and walking costs nothing.
  //
  // The seen-set is a cycle guard. Jira should never produce one; an infinite
  // loop rendering a page is a bad way to find out it did.
  const childLoggedByParent = new Map<string, number>();
  const openDescendants = new Map<string, number>();
  // The top of each issue's chain, which is the project it belongs to. An
  // issue with no parent is its own root.
  const rootOf = new Map<string, string>();

  for (const issue of issues) {
    const seen = new Set<string>([issue.issueKey]);
    const issueIsOpen = !isDoneStatus(issue.status);
    let ancestorKey = issue.parentKey;
    let root = issue.issueKey;

    while (ancestorKey != null && byKey.has(ancestorKey) && !seen.has(ancestorKey)) {
      seen.add(ancestorKey);
      root = ancestorKey;
      childLoggedByParent.set(ancestorKey, (childLoggedByParent.get(ancestorKey) ?? 0) + issue.loggedSeconds);
      if (issueIsOpen) openDescendants.set(ancestorKey, (openDescendants.get(ancestorKey) ?? 0) + 1);
      ancestorKey = byKey.get(ancestorKey)?.parentKey ?? null;
    }

    rootOf.set(issue.issueKey, root);
  }

  const clients = new Map<string, ClientOutstanding>();
  const projects = new Map<string, ProjectOutstanding>();

  const clientFor = (key: string): ClientOutstanding => {
    let client = clients.get(key);
    if (!client) {
      client = {
        ...emptyTotals(),
        clientKey: key,
        clientName: projectNames.get(key) ?? key,
        projects: [],
      };
      clients.set(key, client);
    }
    return client;
  };

  const projectFor = (issue: OutstandingIssueInput): ProjectOutstanding => {
    const rootKey = rootOf.get(issue.issueKey) ?? issue.issueKey;
    let project = projects.get(rootKey);

    if (!project) {
      // The root's own row, where it is in the set. A scoped query can leave a
      // child whose parent was filtered out, so the child stands as its own
      // project rather than being dropped.
      const root = byKey.get(rootKey) ?? issue;
      project = {
        ...emptyTotals(),
        issueKey: rootKey,
        summary: root.summary,
        issueType: root.issueType ?? null,
        status: root.status ?? null,
        items: [],
        unestimated: [],
        covered: [],
        completed: [],
      };
      projects.set(rootKey, project);
      clientFor(issue.projectKey).projects.push(project);
    }

    return project;
  };

  for (const issue of issues) {
    const done = isDoneStatus(issue.status);
    const parent = issue.parentKey != null ? byKey.get(issue.parentKey) : undefined;

    const role = classifyIssue(
      issue,
      parent,
      issue.parentKey != null && rolledUpParents.has(issue.parentKey),
      rolledUpParents.has(issue.issueKey),
    );

    const project = projectFor(issue);

    // Its children are its estimate. The hours booked directly to it are still
    // real time somebody spent - in the live data 10 hours sit on three such
    // parents - so they stay in the logged total.
    if (role === "rolled-up-parent") {
      project.loggedSeconds += issue.loggedSeconds;
      continue;
    }

    if (role === "covered-by-parent") {
      if (done) {
        // Finished, and sized by a line above it. There is no estimate of its
        // own to compare against, so it is recorded with a null one rather
        // than a zero somebody would read as "estimated at nothing".
        recordCompleted(project, issue, null);
        continue;
      }

      // Open, and its figure is already inside the covering line's estimate,
      // so nothing is added to the totals. It is listed so the reader can see
      // what that line is holding.
      project.covered.push({
        issueKey: issue.issueKey,
        summary: issue.summary,
        issueType: issue.issueType ?? null,
        status: issue.status ?? null,
        loggedSeconds: issue.loggedSeconds,
        coveredBy: issue.parentKey as string,
      });
      project.coveredCount += 1;
      project.openCount += 1;
      continue;
    }

    if (role === "unestimated") {
      if (done) {
        // Finished, never estimated. Its hours are still real spend and belong
        // in the logged total; there is simply nothing outstanding to say.
        project.loggedSeconds += issue.loggedSeconds;
        recordCompleted(project, issue, null);
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
      project.unestimatedCount += 1;
      project.openCount += 1;
      continue;
    }

    const estimateSeconds = issue.currentEstimateSeconds as number;

    // A carrier with children stands in for all of them, so work already done
    // beneath it counts against its figure. Without this TSSS-88 reports its
    // full 97.5h outstanding while 13h has already gone into the children it
    // is speaking for.
    const childLogged = childLoggedByParent.get(issue.issueKey);
    const coversChildren = childLogged != null;
    const loggedAgainst = issue.loggedSeconds + (childLogged ?? 0);

    if (done) {
      project.completedEstimateSeconds += estimateSeconds;
      project.loggedSeconds += loggedAgainst;
      recordCompleted(project, issue, estimateSeconds, loggedAgainst);
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
    project.estimatedCount += 1;
    project.openCount += 1;
  }

  const summary: OutstandingSummary = { ...emptyTotals(), clients: [] };

  for (const client of clients.values()) {
    // A project holding nothing at all is dropped. One holding only FINISHED
    // work is kept, because what it was estimated at against what it took is
    // the evidence for every "work left" figure on the page - and dropping it
    // here would take that evidence with it.
    //
    // WHICH OF THESE TO SHOW IS THE CALLER'S DECISION, not this function's.
    // The client list is headed "with work open" and filters on openCount
    // itself; a reader who has drilled into a client wants the finished
    // projects too.
    client.projects = client.projects
      .filter((project) => project.openCount > 0 || project.completedCount > 0)
      .map((project) => {
        finaliseCoverage(project);
        finaliseBudget(project);
        return {
          ...project,
          // Most remaining first. The screen exists to show what is left, so
          // the biggest piece of it belongs at the top.
          items: [...project.items].sort((a, b) => b.remainingSeconds - a.remainingSeconds),
          // Biggest actual first. A finished list is read to find where the
          // time went, and the largest number is where it went.
          completed: [...project.completed].sort((a, b) => b.loggedSeconds - a.loggedSeconds),
          unestimated: [...project.unestimated].sort((a, b) => b.loggedSeconds - a.loggedSeconds),
          covered: [...project.covered].sort((a, b) => b.loggedSeconds - a.loggedSeconds),
        };
      })
      .sort((a, b) => b.remainingSeconds - a.remainingSeconds || a.issueKey.localeCompare(b.issueKey));

    for (const project of client.projects) addInto(client, project);
    finaliseCoverage(client);
    finaliseBudget(client);
  }

  summary.clients = [...clients.values()]
    .filter((client) => client.projects.length > 0)
    .sort((a, b) => b.remainingSeconds - a.remainingSeconds || a.clientKey.localeCompare(b.clientKey));

  for (const client of summary.clients) addInto(summary, client);
  finaliseCoverage(summary);
  finaliseBudget(summary);

  return summary;
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
