import Link from "next/link";

import { getAdminUsersService } from "@/features/admin-users/admin-users.service";
import { ADMIN_USER_DISPLAY_STATUS, USER_OR_INVITATION } from "@/features/admin-users/admin-users.types";
import PortalPage from "@/features/layout/portal-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, USER_ROLES } from "@/lib/data/kysely-database-types";
import { ROUTES } from "@/lib/routes";

import { SetupBudgetGroupsPanel } from "./components/setup-budget-groups-panel";
import { SetupBudgetNudge } from "./components/setup-budget-nudge";
import { SetupMembersPanel, type SetupAssignablePerson } from "./components/setup-members-panel";
import { SetupPhasesPanel } from "./components/setup-phases-panel";
import { SetupProjectArchiveButton } from "./components/setup-project-archive-button";
import { SetupProjectEditDialog } from "./components/setup-project-edit-dialog";
import { SetupProjectCreateForm } from "./components/setup-project-create-form";
import {
  getClientOptionsService,
  getProjectBudgetGroupsService,
  getProjectDetailService,
} from "./delivery-setup.service";

// -------------------------------------------------------------------
// PROJECT SETUP
//
// ONE PAGE FOR TWO ROUTES, and the id is what tells them apart:
//
//   /admin/projects/new                 no id  - create the project
//   /admin/projects/<id>/setup          an id  - its members, its budget
//                                                groups and its phases
//
// They are one component because they are one job done in order. A project
// is created with no members, no phases and no budget groups -
// CreateProjectSchema says so - and the setters that follow each own their
// own write, so the second half of this screen is where a project becomes
// workable at all.
//
// ADMIN ONLY, both halves. A lead runs the board; who is ON a project, what
// their band is and how the budget is pooled are admin decisions, and every
// service behind this guards on that independently. The guard is repeated
// here rather than left to the area layout for the reason the layout itself
// gives - it is one matcher change away from being the only gate.
//
// NO MONEY ON THIS SCREEN. It deals in minutes and in rate BANDS, never
// cents: naming which of three tiers applies to somebody says nothing about
// what the client pays, and the figures that do carry money are the budget
// report's, under its own guard.
// -------------------------------------------------------------------
export default async function DeliveryProjectSetupPage({ projectId }: { projectId?: string }) {
  await requireUserRole([USER_ROLES.ADMIN]);

  // -----------------------------------------------------------------
  // CREATE. Only ACTIVE clients are offered: putting a retired one in the
  // picker is how a project ends up attached to a client somebody
  // deliberately took out of circulation.
  // -----------------------------------------------------------------
  if (!projectId) {
    const clients = await getClientOptionsService();

    return (
      <PortalPage
        title="New project"
        description="Start a project for a client. Members, phases and budget groups come next."
      >
        <SetupProjectCreateForm clients={clients} />
      </PortalPage>
    );
  }

  // -----------------------------------------------------------------
  // SET UP. Three reads, and none of them is a repository call: the
  // project's own detail, its budget groups, and the accounts that may be
  // put on it.
  //
  // THE PEOPLE LIST COMES FROM THE ADMIN USERS SERVICE, which is another
  // feature's read and is used here because this module has none of its
  // own - see the note returned with this work. It guards on ADMIN itself,
  // the same role this page and every membership write require, so nothing
  // is widened by borrowing it. Its rows are filtered to real ACCOUNTS that
  // are active: a pending invitation's id is an invitation, not a user, and
  // offering one would post an id that resolves to nobody. That filter is
  // presentation only - setProjectMembers and addProjectMember re-resolve
  // every account server-side and refuse anything that is not assignable.
  // -----------------------------------------------------------------
  const [detail, groups, accounts] = await Promise.all([
    getProjectDetailService(projectId),
    getProjectBudgetGroupsService(projectId),
    getAdminUsersService(),
  ]);

  const people: SetupAssignablePerson[] = accounts
    .filter(
      (account) =>
        account.userOrInvitation === USER_OR_INVITATION.User &&
        account.displayStatus === ADMIN_USER_DISPLAY_STATUS.Active,
    )
    .map((account) => ({ userId: account.id, name: account.name, email: account.email }));

  const isArchived = detail.project.status === PROJECT_STATUSES.ARCHIVED;

  return (
    <PortalPage
      // Typed by somebody, so it renders as a text node.
      title={detail.project.title}
      description="Who is on the project, how its budget is pooled, and the phases its board is organised under."
      actions={
        <div className="flex flex-wrap gap-2">
          {/* -------------------------------------------------------------
              EDITING A PROJECT, WHICH THIS SCREEN COULD NOT DO.

              updateProjectAction had existed with no caller anywhere in the
              app, so a project's title, description and billable flag were
              whatever the create form was given, permanently.

              The dialog is seeded from `detail`, which carries all four
              editable fields - the summary has the title, status and
              billable flag, and the detail read adds the description - so
              the form opens on the real values rather than on blanks. That
              matters more than it looks: the description is the one field
              nobody re-reads until they need it, and a form built from a
              shape that did not carry it would post an empty box over
              whatever was written.
              ------------------------------------------------------------- */}
          <SetupProjectEditDialog
            project={{
              id: detail.project.id,
              title: detail.project.title,
              description: detail.description,
              isBillable: detail.project.isBillable,
              status: detail.project.status,
            }}
          />
          <Button asChild variant="outline">
            <Link href={ROUTES.adminProject(detail.project.id)}>Open the board</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={ROUTES.adminDeliveryBudgetForProject(detail.project.id)}>Budget report</Link>
          </Button>
          {/* Only where there is something to do - restoring an archived
              project is an edit, and the dialog above owns it. */}
          {isArchived ? null : (
            <SetupProjectArchiveButton
              projectId={detail.project.id}
              projectTitle={detail.project.title}
            />
          )}
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          {/* The client's name is typed by somebody too. */}
          <span className="text-sm text-muted-foreground">For {detail.project.clientName}</span>
          <Badge variant={detail.project.status === PROJECT_STATUSES.ACTIVE ? "success" : "warning"}>
            {PROJECT_STATUS_LABELS[detail.project.status]}
          </Badge>
          <Badge variant="outline">{detail.project.isBillable ? "Billable" : "Not billable"}</Badge>
        </div>

        {isArchived && (
          // Said up front, because archiving is this module's soft delete
          // and the phase mutations below are refused on an archived
          // project. Membership and budget groups still work - restoring
          // the project should bring back the team that was on it.
          <p role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
            This project is archived. Its phases cannot be changed until an administrator makes it active
            again, which is a status change in <strong>Edit project</strong>.
          </p>
        )}

        <SetupBudgetNudge
          projectId={detail.project.id}
          budgetAssignedAt={detail.budgetAssignedAt}
          groups={groups}
          // Every task estimate on the project. `rollup.budgetMinutes` is
          // that total - see getProjectDetailService, which builds the
          // rollup from the project's estimates against its logged time.
          assignedMinutes={detail.rollup.budgetMinutes}
        />

        <SetupMembersPanel projectId={detail.project.id} members={detail.members} people={people} />

        <SetupBudgetGroupsPanel projectId={detail.project.id} groups={groups} members={detail.members} />

        <SetupPhasesPanel
          projectId={detail.project.id}
          phases={detail.phases}
          // The server's own answer to "lead or admin", never re-derived
          // from a role in a component.
          canEditTasks={detail.project.canEditTasks}
        />
      </div>
    </PortalPage>
  );
}
