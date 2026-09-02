import "server-only";

import { getIssuesWithLoggedTimeRepo, getJiraProjectsRepo } from "@/lib/data/repositories/timesheet.repository";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { handleError } from "@/lib/handle-errors";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { buildOutstanding, scopeIssues, type OutstandingSummary } from "@/lib/timesheet/outstanding";

// -------------------------------------------------------------------
// Outstanding effort, across every project.
//
// Guarded on ADMIN in the SERVICE, not only in the route. The figures are
// commercial - what is committed, what is left, and by implication where a
// project is running over - and a page calling this directly must be safe on
// its own. Same rule as every other timesheet service.
//
// NO PERIOD. Every other timesheet service takes a period and scopes to it;
// this one deliberately does not. "What is left" is a fact about right now,
// and an estimate set in July and worked in September belongs to both months.
// A period argument here would be a filter nobody could interpret.
// -------------------------------------------------------------------
export interface OutstandingScope {
  // A Jira project key, eg "TSSS". What the business calls a client.
  clientKey?: string | null;
  // A top-level issue key, eg "TSSS-88". What the business calls a project.
  // Its whole subtree comes with it - see scopeIssues.
  projectKey?: string | null;
}

export async function getOutstandingEffortService(scope: OutstandingScope = {}): Promise<OutstandingSummary> {
  try {
    const { rows, projectNames } = await loadOutstandingRows();

    // Scoped BEFORE the engine runs, on the same rows, so a filtered figure is
    // the same figure the unfiltered page shows for that project rather than a
    // second calculation that could drift from it.
    return buildOutstanding(scopeIssues(rows, scope), projectNames);
  } catch (error) {
    throw handleError("getOutstandingEffortService", error);
  }
}

export interface OutstandingOption {
  value: string;
  label: string;
  remainingSeconds: number;
  openCount: number;
  // Whether anything under it is estimated. The dropdown says so, because
  // choosing an option that can only ever show "unknown" is a dead end the
  // reader should be able to see before they click it.
  hasEstimates: boolean;
}

export interface OutstandingBoard {
  // What the current selection narrows to. The whole picture when nothing is
  // selected.
  selected: OutstandingSummary;
  clientOptions: OutstandingOption[];
  // Only for the selected client. Empty when no client is chosen, because a
  // flat list of every project across every client is the thing the client
  // step exists to avoid.
  projectOptions: OutstandingOption[];
  // Echoed back so the view renders what was actually APPLIED rather than what
  // was asked for.
  clientKey: string | null;
  projectKey: string | null;
  // Set when a requested filter was not offered. Named rather than passed
  // through - the same rule the timesheet ask box follows. A filter that
  // silently selects nothing renders an empty page reading as "no work left"
  // when the truth is "that is not a thing here".
  droppedFilters: string[];
}

// -------------------------------------------------------------------
// The drill-down: pick a client, then a project under it.
//
// BOTH OPTION LISTS ARE BUILT FROM OPEN WORK, and that is the one interesting
// decision here. The dropdowns elsewhere in Timesheets are built from the
// period's WORKLOGS, which is right for a screen about time logged - but a
// client with work still open and nothing booked to it this month would be
// missing from a list built that way, and that client is exactly the one
// somebody opens this page to find.
//
// A client with nothing outstanding is not offered either, because selecting
// it could only ever show an empty screen.
// -------------------------------------------------------------------
export async function getOutstandingBoardService(scope: OutstandingScope = {}): Promise<OutstandingBoard> {
  try {
    const { rows, projectNames } = await loadOutstandingRows();

    const all = buildOutstanding(rows, projectNames);

    const clientOptions: OutstandingOption[] = all.clients.map((client) => ({
      value: client.clientKey,
      label: client.clientName,
      remainingSeconds: client.remainingSeconds,
      openCount: client.openCount,
      hasEstimates: client.estimatedCount > 0,
    }));

    const droppedFilters: string[] = [];

    const requestedClient = scope.clientKey && scope.clientKey !== "all" ? scope.clientKey : null;
    const clientKey =
      requestedClient != null && clientOptions.some((option) => option.value === requestedClient)
        ? requestedClient
        : null;

    if (requestedClient != null && clientKey == null) droppedFilters.push(requestedClient);

    const client = clientKey == null ? null : all.clients.find((entry) => entry.clientKey === clientKey);

    const projectOptions: OutstandingOption[] =
      client?.projects.map((project) => ({
        value: project.issueKey,
        label: project.summary,
        remainingSeconds: project.remainingSeconds,
        openCount: project.openCount,
        hasEstimates: project.estimatedCount > 0,
      })) ?? [];

    const requestedProject = scope.projectKey && scope.projectKey !== "all" ? scope.projectKey : null;

    // A project is only valid UNDER the chosen client. Without this check,
    // changing client while a project is still in the URL would put one
    // client's heading above another client's work.
    const projectKey =
      requestedProject != null && projectOptions.some((option) => option.value === requestedProject)
        ? requestedProject
        : null;

    if (requestedProject != null && projectKey == null) droppedFilters.push(requestedProject);

    // Rebuilt from the SAME rows rather than picked out of the tree above, so
    // a scoped figure is computed by exactly the code that computed the
    // unscoped one. Reaching into the tree would have been cheaper and would
    // have made the two paths able to disagree.
    const selected =
      clientKey == null && projectKey == null
        ? all
        : buildOutstanding(scopeIssues(rows, { clientKey, projectKey }), projectNames);

    return { selected, clientOptions, projectOptions, clientKey, projectKey, droppedFilters };
  } catch (error) {
    throw handleError("getOutstandingBoardService", error);
  }
}

// The one read both services share. Private, so nothing outside this file can
// fetch the rows and skip the role guard above them.
async function loadOutstandingRows() {
  await requireUserRole([USER_ROLES.ADMIN]);

  const [issues, projects] = await Promise.all([getIssuesWithLoggedTimeRepo(), getJiraProjectsRepo()]);

  return {
    projectNames: new Map(projects.map((project) => [project.projectKey, project.name])),
    // The engine gets rows and nothing else - no queries, no model, no rate
    // lookups. Everything it needs is already resolved.
    rows: issues.map((issue) => ({
      issueKey: issue.issueKey,
      parentKey: issue.parentKey,
      projectKey: issue.projectKey,
      issueType: issue.issueType,
      summary: issue.summary,
      status: issue.status,
      currentEstimateSeconds: issue.currentEstimateSeconds,
      loggedSeconds: issue.loggedSeconds,
    })),
  };
}
