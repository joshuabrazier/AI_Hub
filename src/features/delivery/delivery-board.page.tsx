import Link from "next/link";

import PortalPage from "@/features/layout/portal-page";
import { requireUser } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { ROUTES, projectBoardForRole } from "@/lib/routes";
import { userDisplayName } from "@/lib/user-display-name";

import { getProjectBoardService } from "./delivery-board.service";
import { getMyProjectsService, getProjectDetailService } from "./delivery-setup.service";
import { BoardWorkspace, type BoardProjectLink } from "./components/board-workspace";

// -------------------------------------------------------------------
// The board: one project, in whichever area the viewer is allowed to be in.
//
// THE PROJECT ID IS A ROUTING PARAMETER AND NOTHING MORE. Both reads
// re-check it against `project_members` and answer notFound() for a project
// the caller is not on - a scope failure gets the answer a missing id gets,
// because saying "forbidden" to a guessed id confirms the project exists.
//
// THREE READS, FIXED, AND NOT ONE PER PHASE. The board is four queries
// whatever the project's size, the project header is six, and the left-hand
// list is one. Nothing below fetches per card or per phase, which is the
// property this screen is judged on: it is the one people leave open all
// day.
//
// `canEditTasks` COMES OFF THE BOARD DTO, computed on the server as "lead
// OR admin". Nothing here or below re-derives it from a role - an admin is
// not a lead and can still edit, so a component doing that arithmetic would
// be a second copy of an authorization decision. The two links in the
// header ARE decided on the role, and that is a different question: they go
// to admin-only screens, which is navigation rather than editing.
//
// THE LEFT-HAND LIST IS "MY PROJECTS", memberships and not everything - the
// service says why at length. An admin can open a project they are not a
// member of, so the open one is added to the list when it is missing from
// it: a board with nothing highlighted in its own nav reads as a broken
// page.
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

  const [projects, detail, board] = await Promise.all([
    getMyProjectsService(),
    getProjectDetailService(projectId),
    getProjectBoardService(projectId),
  ]);

  // Through projectBoardForRole rather than a string built here: the proxy
  // REDIRECTS a role that lands in the wrong area rather than refusing it,
  // so a hand-built /admin/projects/<id> followed by a member is not an
  // error they can see - it is a link that quietly goes somewhere else.
  const links: BoardProjectLink[] = projects.map((project) => ({
    id: project.id,
    title: project.title,
    clientName: project.clientName,
    status: project.status,
    href: projectBoardForRole(user.role, project.id),
  }));

  if (!links.some((link) => link.id === detail.project.id)) {
    links.unshift({
      id: detail.project.id,
      title: detail.project.title,
      clientName: detail.project.clientName,
      status: detail.project.status,
      href: projectBoardForRole(user.role, detail.project.id),
    });
  }

  const isAdmin = user.role === USER_ROLES.ADMIN;

  return (
    <PortalPage
      eyebrow={eyebrow}
      // Project titles and client names are typed by people. React renders
      // them as text, here and everywhere else in this feature.
      title={detail.project.title}
      description={`${detail.project.clientName}. Each phase has its own board, with the same four columns.`}
      actions={
        isAdmin ? (
          <div className="flex flex-wrap gap-4 text-sm">
            <Link
              href={ROUTES.adminProjectSetup(detail.project.id)}
              className="rounded text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Project setup
            </Link>
            <Link
              href={ROUTES.adminDeliveryBudgetForProject(detail.project.id)}
              className="rounded text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Budget report
            </Link>
          </div>
        ) : undefined
      }
    >
      <BoardWorkspace
        projects={links}
        activeProjectId={detail.project.id}
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
