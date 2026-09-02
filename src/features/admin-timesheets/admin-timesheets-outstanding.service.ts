import "server-only";

import { getIssuesWithLoggedTimeRepo, getJiraProjectsRepo } from "@/lib/data/repositories/timesheet.repository";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { handleError } from "@/lib/handle-errors";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { buildOutstanding, scopeIssues, type OutstandingSummary } from "@/lib/timesheet/outstanding";

// -------------------------------------------------------------------
// Outstanding effort, across every project.
//
// Guarded on ADMIN here in the SERVICE, not only in the route. The figures
// are commercial - what is committed, what is left, and by implication where
// a project is running over - and a page calling this directly must be safe
// on its own. Same rule as every other timesheet service.
//
// NO PERIOD. Every other timesheet service takes a period and scopes to it;
// this one deliberately does not. "What is left" is a fact about right now,
// and an estimate set in July and worked in September belongs to both months.
// A period argument here would be a filter nobody could interpret.
// -------------------------------------------------------------------
export interface OutstandingScope {
  // A Jira project key, eg "TSSS". What the overview screen calls a client.
  clientKey?: string | null;
  // A parent issue key, eg "TSSS-88". What the overview screen calls a
  // project. Its whole subtree comes with it - see scopeIssues.
  projectKey?: string | null;
}

export async function getOutstandingEffortService(scope: OutstandingScope = {}): Promise<OutstandingSummary> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const [issues, projects] = await Promise.all([getIssuesWithLoggedTimeRepo(), getJiraProjectsRepo()]);

    const projectNames = new Map(projects.map((project) => [project.projectKey, project.name]));

    // Scoped BEFORE the engine runs, on the same rows, so a filtered figure
    // is the same figure the unfiltered page shows for that project rather
    // than a second calculation that could drift from it.
    const rows = scopeIssues(
      issues.map((issue) => ({
        issueKey: issue.issueKey,
        parentKey: issue.parentKey,
        projectKey: issue.projectKey,
        issueType: issue.issueType,
        summary: issue.summary,
        status: issue.status,
        currentEstimateSeconds: issue.currentEstimateSeconds,
        loggedSeconds: issue.loggedSeconds,
      })),
      scope,
    );

    // The engine gets rows and nothing else - no queries, no model, no rate
    // lookups. Everything it needs is already resolved.
    return buildOutstanding(rows, projectNames);
  } catch (error) {
    throw handleError("getOutstandingEffortService", error);
  }
}
