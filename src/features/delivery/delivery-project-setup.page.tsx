import Link from "next/link";

import PortalPage from "@/features/layout/portal-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, USER_ROLES } from "@/lib/data/kysely-database-types";
import { projectBoardForRole } from "@/lib/routes";


import { SetupBudgetGroupsPanel } from "./components/setup-budget-groups-panel";
import { SetupMembersPanel } from "./components/setup-members-panel";
import { SetupPhasesPanel } from "./components/setup-phases-panel";
import { SetupProjectArchiveButton } from "./components/setup-project-archive-button";
import { SetupProjectEditDialog } from "./components/setup-project-edit-dialog";
import { SetupPlanWithAi } from "./components/setup-plan-with-ai";
import { SetupProjectCreateForm } from "./components/setup-project-create-form";
import { SetupDone, SetupStep } from "./components/setup-step";
import {
  describeBudgetPools,
  describePhases,
  describeTeam,
  missingForBoard,
} from "./components/setup-summary";
import {
  getAssignablePeopleService,
  getClientOptionsService,
  getProjectBudgetGroupsService,
  getProjectDetailService,
} from "./delivery-setup.service";

// -------------------------------------------------------------------
// PROJECT SETUP
//
// ONE PAGE FOR TWO ROUTES, and the id is what tells them apart:
//
//   /{admin,manage}/projects/new        no id  - create the project
//   /{admin,manage}/projects/<id>/setup an id  - its members, its budget
//                                                groups and its phases
//
// They are one component because they are one job done in order. A project
// is created with no members, no phases and no budget groups -
// CreateProjectSchema says so - and the setters that follow each own their
// own write, so the second half of this screen is where a project becomes
// workable at all.
//
// ADMINS AND MANAGERS, and it is FOUR routes now rather than two - the same
// pair under /manage. Managers can create projects, so they need both halves:
// the create form, and the setup screen for the project that creating one
// made them the lead of.
//
// THE ROLE GETS YOU HERE AND DECIDES NOTHING ELSE. Who is on a project and
// how its budget is pooled are gated by requireProjectStructureAccess - admin
// or this project's LEAD - so a manager can set up what they lead and nothing
// else, and a manager who is not on a project at all gets notFound() rather
// than a refusal confirming it exists. The two things that stayed admin-only
// are renaming and archiving, and both are hidden below rather than left to
// fail: renaming carries `status`, and status is how an archive is undone.
//
// The guard is repeated here rather than left to the area layout for the
// reason the layout itself gives - it is one matcher change away from being
// the only gate.
//
// NO MONEY ON THIS SCREEN. It deals in minutes and in rate BANDS, never
// cents: naming which of three tiers applies to somebody says nothing about
// what the client pays, and the figures that do carry money are the budget
// report's, under its own guard.
// -------------------------------------------------------------------
export default async function DeliveryProjectSetupPage({ projectId }: { projectId?: string }) {
  // MANAGERS TOO, and the role is kept because this page has to build links
  // into the caller's OWN area. A manager sent to an /admin/... href is
  // redirected home by the proxy, which does not look like an error - it
  // looks like the app losing your place halfway through setting a project
  // up. Every route below goes through a *ForRole helper for that reason.
  //
  // THE ROLE IS NOT THE PROJECT AUTHORITY, though, and nothing here should
  // read as if it were: being a manager gets you to this screen, and the
  // services decide what you may do once you are on it. A manager who does
  // not lead this project is refused by requireProjectStructureAccess, and
  // one who is not on it at all gets notFound() rather than a message
  // confirming it exists.
  const user = await requireUserRole([USER_ROLES.ADMIN, USER_ROLES.MANAGER]);
  const isAdmin = user.role === USER_ROLES.ADMIN;

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
        description="Start from a brief, or fill it in yourself."
      >
        {/* -----------------------------------------------------------
            ABOVE THE FORM, because it replaces it rather than assisting
            it. Somebody who has the brief in an email should not read
            past a form they are not going to fill in - and somebody who
            does not have one should meet a single line and then the form.
            Collapsed until asked for, so it is an offer rather than a
            detour.
            ----------------------------------------------------------- */}
        {/* MANAGERS TOO, now that the whole path is theirs to walk. It was
            admin-only for one commit - its two actions and three re-checks
            inside project-plan.service all read [ADMIN] - and showing a
            manager a panel whose every button refuses them is worse than not
            showing it, so it was hidden rather than left to fail.

            Widening it needed more than five role lists. The apply step
            REPLACES the member set with the people the brief mentioned, and
            the person pasting the brief is usually not one of them - so a
            manager could have described a project, applied it, and lost it on
            the spot. See the note in applyProjectPlanService. */}
        <SetupPlanWithAi role={user.role} />

        <SetupProjectCreateForm clients={clients} role={user.role} />
      </PortalPage>
    );
  }

  // -----------------------------------------------------------------
  // SET UP. Three reads, and none of them is a repository call: the
  // project's own detail, its budget groups, and the accounts that may be
  // put on it.
  //
  // getAssignablePeopleService RATHER THAN getAdminUsersService, and the swap
  // is the whole reason a manager can be on this page at all. That read is
  // the admin Users SCREEN - every account and every pending invitation, with
  // roles, activity, sign-in state and who has enrolled a second factor - and
  // it could not be opened to managers to get three fields out of it.
  //
  // The filtering that used to be here went with it. Excluding deactivated
  // and de-identified accounts is a rule about who may be staffed, so it
  // belongs beside the other one (`isAssignable`) in the service rather than
  // in a page that happened to have a list in its hands.
  const [detail, groups, people] = await Promise.all([
    getProjectDetailService(projectId),
    getProjectBudgetGroupsService(projectId),
    getAssignablePeopleService(),
  ]);

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
          {/* ADMIN ONLY, BOTH OF THESE, and the page has to say so because
              the services do. Renaming a project carries `status`, and
              setting status back to active is how an archive is undone - so
              a lead who could rename could un-archive, and updateProjectService
              stayed on requireAdminProject for exactly that. Archiving is the
              soft delete and went with it.

              Hidden rather than disabled: a control a manager can see and
              press, which then refuses them, teaches them the app is broken.
              The refusal still exists in the service - this is display. */}
          {isAdmin ? (
            <SetupProjectEditDialog
              project={{
                id: detail.project.id,
                title: detail.project.title,
                description: detail.description,
                isBillable: detail.project.isBillable,
                status: detail.project.status,
                kind: detail.project.kind,
              }}
            />
          ) : null}

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
          {isArchived || !isAdmin ? null : (
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

        {/* READY IS ABOUT THE BOARD, NOT ABOUT THE TICKS. `missing` is empty
            when the project has a lead and somewhere to put a task, which is
            all the board needs. A People step left unticked because nobody
            has confirmed who else is on the project does not make the board
            unusable, and telling somebody working alone that their board is
            not ready would be a nag they can never clear. */}
        <SetupDone isReady={missing.length === 0} missing={missing}>
          <Button asChild>
            <Link href={projectBoardForRole(user.role, detail.project.id)}>Open the board</Link>
          </Button>
        </SetupDone>
      </div>
    </PortalPage>
  );
}
