import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import PortalPage from "@/features/layout/portal-page";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { ROUTES } from "@/lib/routes";

import { BudgetReport } from "./components/budget-report";
import { getProjectBudgetReportService } from "./delivery-rates.service";
import { getMyProjectsService } from "./delivery-setup.service";

// -------------------------------------------------------------------
// THE BUDGET REPORT: one project, its budget against the time logged on it,
// and what that time is worth.
//
// THE PROJECT ARRIVES AS `?projectId=` rather than as a path segment. A path
// segment would announce an index over every project, and there is no read
// behind one: `getProjectBudgetReportService` takes a single id, and the
// long note at the end of delivery-rates.service.ts names the two repository
// functions an across-projects view would need and explains why building it
// from a loop would be worse than not having it. So this screen opens ONE
// report, and with no project chosen it can only offer somewhere to start.
//
// ADMIN ONLY, with its own guard even though the area layout has one and the
// service checks again. It is the only screen in the module carrying cents -
// a charge figure is a client's price and a cost figure is a pay proxy - and
// neither layer is load-bearing alone.
//
// The three rules that matter more than the layout are stated at the top of
// components/budget-report.tsx, where the figures are actually rendered.
// -------------------------------------------------------------------
export default async function DeliveryBudgetPage({ projectId }: { projectId?: string }) {
  await requireUserRole([USER_ROLES.ADMIN]);

  if (!projectId) {
    // -----------------------------------------------------------------
    // NO PROJECT CHOSEN. `getMyProjectsService` is the caller's OWN
    // memberships, not every project - it is the nav read, and it says so.
    // That makes this a starting point rather than a picker, and the copy
    // has to admit it: an admin who is on no projects would otherwise read
    // an empty list as "no project is over budget".
    //
    // A real picker needs an all-projects read, which no service exposes.
    // Reported rather than worked around here: a page does not touch a
    // repository.
    // -----------------------------------------------------------------
    const projects = await getMyProjectsService();

    return (
      <PortalPage
        title="Budgets"
        description="One project's budget against the time logged on it, and what that time is worth."
      >
        <Card>
          <CardHeader>
            <CardTitle>Choose a project</CardTitle>
            <CardDescription>
              A budget report covers one project. These are the projects you are a member of; other projects
              are reached from their own board.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You are not a member of any project. Open a project and follow the budget report link on it.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {projects.map((project) => (
                  <li key={project.id}>
                    <Link
                      href={ROUTES.adminDeliveryBudgetForProject(project.id)}
                      className="rounded text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {project.title}
                    </Link>
                    <span className="text-muted-foreground"> - {project.clientName}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </PortalPage>
    );
  }

  const report = await getProjectBudgetReportService(projectId);

  return (
    <PortalPage
      // The project's own title and its client's name, both typed by
      // somebody. PortalPage renders them as text nodes.
      title={report.projectTitle}
      description={`Budget report for ${report.clientName}. Every figure comes from the rate each hour was logged at, so nothing here is restated by a rate change.`}
    >
      <BudgetReport report={report} />
    </PortalPage>
  );
}
