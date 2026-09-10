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
import { SetupMembersPanel, type SetupAssignablePerson } from "./components/setup-members-panel";
import { SetupPhasesPanel } from "./components/setup-phases-panel";
import { SetupProjectArchiveButton } from "./components/setup-project-archive-button";
import { SetupProjectEditDialog } from "./components/setup-project-edit-dialog";
import { SetupProjectCreateForm } from "./components/setup-project-create-form";
import { SetupDone, SetupStep } from "./components/setup-step";
import {
  describeBudgetPools,
  describePhases,
  describeTeam,
  missingForBoard,
} from "./components/setup-summary";
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

  // -----------------------------------------------------------------
  // WHAT EACH STEP SAYS WHEN IT IS CLOSED.
  //
  // The answer to the step's own question, phrased as a fact - "Louis
  // leading, and 3 others" rather than "4 members". A count is a thing you
  // have to open the step to make sense of, which defeats collapsing it.
  //
  // The wording lives in setup-summary.ts, tested, because every way it goes
  // wrong is prose rather than a crash: a missing plural, a lead who is not
  // there, a de-identified account with no name.
  // -----------------------------------------------------------------
  const team = describeTeam(detail.members);
  const phases = describePhases(detail.phases);
  const budgetSummary = describeBudgetPools(groups);
  const missing = missingForBoard(team, phases);

  return (
    <PortalPage
      // Typed by somebody, so it renders as a text node.
      title={detail.project.title}
      description="Two things to set, and one you probably will not need."
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
          {/* "Open the board" is deliberately NOT here any more. It was in
              this header AND at the foot of the page, and the one at the
              foot is the real end of the job - the header is where somebody
              looks to leave a screen, not to finish one. Two buttons with
              one label is a choice nobody should have to make.

              The budget report link is not here either, for the reason on
              the board page: it was on every project screen. The sidebar's
              Budgets entry is the way in. */}
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
      <div className="mb-8 flex flex-wrap items-center gap-2">
        {/* The client's name is typed by somebody, so it renders as a text
            node. */}
        <span className="text-sm text-muted-foreground">For {detail.project.clientName}</span>
        <Badge variant={detail.project.status === PROJECT_STATUSES.ACTIVE ? "success" : "warning"}>
          {PROJECT_STATUS_LABELS[detail.project.status]}
        </Badge>
        <Badge variant="outline">{detail.project.isBillable ? "Billable" : "Not billable"}</Badge>
      </div>

      {isArchived && (
        // Said up front, because archiving is this module's soft delete and
        // the phase step below is refused on an archived project. Membership
        // and pooled budgets still work - restoring the project should bring
        // back the team that was on it.
        <p
          role="status"
          className="mb-8 rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground"
        >
          This project is archived. Its phases cannot be changed until an administrator makes it active
          again, which is a status change in <strong>Edit project</strong>.
        </p>
      )}

      {/* -------------------------------------------------------------
          THE ORDER IS THE DEPENDENCY, NOT A PREFERENCE.

          SetupBudgetGroupsPanel takes the member list, so people genuinely
          come before pools. A board with no phases has nowhere to put a
          task, so phases come before anybody opens it. Those two are the
          sequence; pooling is a thing some projects do and most do not.

          It used to run people, pools, phases - the dependent step in the
          middle and a required one last, which is the order they happened to
          be written in rather than the order they are done in.
          ------------------------------------------------------------- */}
      <div>
        <SetupStep
          step={1}
          title="People"
          question="Add everyone working on this, and mark one of them the lead."
          summary={team.summary}
          isComplete={team.isComplete}
          defaultOpen={!team.isComplete}
        >
          <SetupMembersPanel projectId={detail.project.id} members={detail.members} people={people} />
        </SetupStep>

        <SetupStep
          step={2}
          title="Phases"
          question="Name the stages of work. The board gets a column of cards under each one."
          summary={phases.summary}
          isComplete={phases.isComplete}
          // Opens only once people are sorted, so arriving at a brand new
          // project shows one thing to do rather than two.
          defaultOpen={team.isComplete && !phases.isComplete}
        >
          <SetupPhasesPanel
            projectId={detail.project.id}
            phases={detail.phases}
            // The server's own answer to "lead or admin", never re-derived
            // from a role in a component - AND the archived check, which it
            // does not carry: canEditProjectTasks looks at role and lead,
            // never at status. Without this the banner above says phases
            // cannot be changed while Add, Rename, Reorder and Delete all
            // stay live, and the service refuses each one only after
            // somebody has filled it in.
            canEditTasks={detail.project.canEditTasks && !isArchived}
          />
        </SetupStep>

        <SetupStep
          title="Pooled budgets"
          question="Give a group of people one budget between them, where a project needs it."
          summary={budgetSummary}
          isComplete={groups.length > 0}
          // Never opens on arrival. Most projects do not pool, and a panel
          // that unfolds itself is a panel that looks like it wants filling
          // in - which is how the old page had people building groups of one.
          defaultOpen={false}
        >
          <SetupBudgetGroupsPanel
            projectId={detail.project.id}
            groups={groups}
            members={detail.members}
          />
        </SetupStep>

        <SetupDone isReady={team.isComplete && phases.isComplete} missing={missing}>
          <Button asChild>
            <Link href={ROUTES.adminProject(detail.project.id)}>Open the board</Link>
          </Button>
        </SetupDone>
      </div>
    </PortalPage>
  );
}
