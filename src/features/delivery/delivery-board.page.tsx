import Link from "next/link";

import PortalPage from "@/features/layout/portal-page";
import { requireUser } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { ROUTES } from "@/lib/routes";
import { userDisplayName } from "@/lib/user-display-name";

import { getProjectBoardService } from "./delivery-board.service";
import { getProjectBudgetGroupsService, getProjectDetailService } from "./delivery-setup.service";
import { BoardWorkspace } from "./components/board-workspace";
import { SetupBudgetNudge } from "./components/setup-budget-nudge";

// -------------------------------------------------------------------
// The board: one project, in whichever area the viewer is allowed to be in.
//
// THE PROJECT ID IS A ROUTING PARAMETER AND NOTHING MORE. Both reads
// re-check it against `project_members` and answer notFound() for a project
// the caller is not on - a scope failure gets the answer a missing id gets,
// because saying "forbidden" to a guessed id confirms the project exists.
//
// TWO READS, FIXED, AND NOT ONE PER PHASE. The board is four queries
// whatever the project's size and the project header is six. Nothing below
// fetches per card or per phase, which is the property this screen is judged
// on: it is the one people leave open all day. It used to be three - the
// third was "my projects", for a list down the left-hand side that the
// sidebar now carries, so removing that panel took a query with it.
//
// `canEditTasks` COMES OFF THE BOARD DTO, computed on the server as "lead
// OR admin". Nothing here or below re-derives it from a role - an admin is
// not a lead and can still edit, so a component doing that arithmetic would
// be a second copy of an authorization decision. The two links in the
// header ARE decided on the role, and that is a different question: they go
// to admin-only screens, which is navigation rather than editing.
//
// THE PROJECT LIST THAT USED TO BE HERE IS IN THE SIDEBAR. It was an
// in-page nav to the same set of screens the sidebar already lists, sitting
// inside the sidebar's own column and taking 18rem off a board. One
// consequence worth knowing: an admin can open a project they are not a
// member of, and the sidebar's list is memberships, so that board is not
// highlighted anywhere. That is honest - they are not on it - where the old
// panel used to insert it and imply they were.
// -------------------------------------------------------------------
export default async function DeliveryBoardPage({
  eyebrow,
  projectId,
}: {
  eyebrow: string;
  projectId: string;
}) {
  // The services guard again on their first line. This is here so the page
  // is safe read on its own, and because the role is what the board links
  // are built from.
  const user = await requireUser();

  // Known before the reads, so the admin-only fourth one can be skipped
  // entirely for everybody else rather than fetched and thrown away.
  const isAdmin = user.role === USER_ROLES.ADMIN;

  const [detail, board, budgetGroups] = await Promise.all([
    getProjectDetailService(projectId),
    getProjectBoardService(projectId),
    // -----------------------------------------------------------------
    // FOR THE BUDGET NUDGE, WHICH MOVED HERE FROM PROJECT SETUP.
    //
    // It shows how much of the budgeted pool the task estimates have taken,
    // and tasks are made HERE - on setup it read 0% on every project,
    // because a project reaches that screen with no tasks at all.
    //
    // ADMIN ONLY, and undefined rather than an empty array for everybody
    // else: the panel's button calls markProjectBudgetAssignedService, which
    // guards on admin, so offering it to a lead would be a button the server
    // refuses. The read itself is open to any member
    // (getProjectBudgetGroupsService uses requireProjectAccess), so this is
    // about not fetching what will not be rendered.
    // -----------------------------------------------------------------
    isAdmin ? getProjectBudgetGroupsService(projectId) : undefined,
  ]);

  return (
    <PortalPage
      eyebrow={eyebrow}
      // UNCAPPED, because the board is four columns per phase and max-w-7xl
      // was stranding them in the middle of a large window. Not "full": the
      // gutters and the header are both still wanted here, and the title is
      // the only place the project's full name appears in one piece - the
      // sidebar truncates it.
      size="wide"
      // Project titles and client names are typed by people. React renders
      // them as text, here and everywhere else in this feature.
      title={detail.project.title}
      description={`${detail.project.clientName}. Each phase has its own board, with the same four columns.`}
      // NO BUDGET REPORT LINK HERE, and that is a removal rather than an
      // omission. It sat on this header and on the project setup header, so
      // between them it appeared on every project screen an admin opened -
      // and a link repeated everywhere stops reading as a way to somewhere
      // and starts reading as furniture. The sidebar's Budgets entry is the
      // way in, and the page it opens lists every project.
      //
      // Project setup stays, because it is the ONE thing this screen cannot
      // do for itself: the board edits cards, and members, budget groups and
      // phases are all over there.
      actions={
        isAdmin ? (
          <div className="flex flex-wrap gap-4 text-sm">
            <Link
              href={ROUTES.adminProjectSetup(detail.project.id)}
              className="rounded text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Project setup
            </Link>
          </div>
        ) : undefined
      }
    >
      {/* Above the board, because it is a nudge about what to do next rather
          than part of the board itself - and it takes itself away for good
          once planning has been marked finished. */}
      {isAdmin && budgetGroups ? (
        <div className="mb-6">
          <SetupBudgetNudge
            projectId={detail.project.id}
            budgetAssignedAt={detail.budgetAssignedAt}
            groups={budgetGroups}
            // Every task estimate on the project. `rollup.budgetMinutes` is
            // that total - see getProjectDetailService, which builds the
            // rollup from the project's estimates against its logged time.
            assignedMinutes={detail.rollup.budgetMinutes}
          />
        </div>
      ) : null}

      <BoardWorkspace
        // The summary itself, not just its id: the board builds a
        // one-project timesheet catalogue from it so the estimate dialog can
        // be opened from a card. Folding the phases here a second time would
        // be a second answer to what a task option looks like.
        project={detail.project}
        projectStatus={detail.project.status}
        board={board}
        phaseStats={detail.phases}
        members={detail.members}
        rollup={detail.rollup}
        // Named on the log-time dialog, because time here is always the
        // signed-in person's own and the screen should say whose it is.
        yourName={userDisplayName(user) ?? user.email}
        // FROM THE SESSION, never from a route parameter. It decides which
        // time entries the task panel offers an edit button on; the service
        // decides whether the edit is allowed.
        yourUserId={user.id}
      />
    </PortalPage>
  );
}
