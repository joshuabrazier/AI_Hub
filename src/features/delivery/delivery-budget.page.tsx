import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import PortalPage from "@/features/layout/portal-page";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { ROUTES } from "@/lib/routes";

import { BudgetReport } from "./components/budget-report";
import { getProjectBudgetReportService } from "./delivery-rates.service";
import { getAllProjectsForAdminService } from "./delivery-setup.service";

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
    // NO PROJECT CHOSEN, so this is the PICKER.
    //
    // It used to call getMyProjectsService, which is the NAV read - the
    // caller's own memberships. That made this a starting point rather than
    // a picker, and it left a real hole: an admin who was not a member of a
    // project had no way to open its budget report at all, while the copy
    // told them those projects were "reached from their own board" - a link
    // that had since been removed from the board. Two wrongs pointing at
    // each other.
    //
    // getAllProjectsForAdminService is every project, archived ones
    // included, which is what a picker for an admin-only money screen should
    // list. The report itself guards on requireRatesAdmin, so nothing here
    // is offered that the service would then refuse.
    // -----------------------------------------------------------------
    const projects = await getAllProjectsForAdminService();

    return (
      <PortalPage
        title="Budgets"
        description="One project's budget against the time logged on it, and what that time is worth."
      >
        <Card>
          <CardHeader>
            <CardTitle>Choose a project</CardTitle>
            <CardDescription>
              A budget report covers one project. Every project is listed, including archived ones - a
              finished project is often the one worth reporting on.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No projects yet. Create one and its budget report appears here.
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
