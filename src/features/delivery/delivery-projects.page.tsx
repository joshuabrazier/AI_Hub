import Link from "next/link";

import { FolderKanban, ListTodo } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import PortalPage from "@/features/layout/portal-page";
import { requireUser } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  TASK_COLUMN_LABELS,
} from "@/lib/data/kysely-database-types";
import { projectBoardForRole } from "@/lib/routes";

import { getMyWorkService } from "./delivery-board.service";
import { getMyProjectsService } from "./delivery-setup.service";
import { formatMinutesAsClock } from "./delivery.types";
import { BoardEmptyState } from "./components/board-empty-state";

// -------------------------------------------------------------------
// Projects, rendered identically in all three areas - MEMBERSHIP decides
// what somebody sees here, not their role, so there is nothing for an area
// to change and the three routes under app/ are thin wrappers around this.
//
// `getMyProjectsService` is "my projects", and that includes for an admin:
// it reads the caller's own memberships, so an admin who administers forty
// projects and is on two sees the two. The service says why at length. An
// admin reaches any other project through the admin screens.
//
// THE WORK LIST IS THE SESSION'S OWN. There is no parameter for whose work
// to show, and a list of somebody else's is a different screen with a
// different guard rather than an argument on this one.
//
// The board links go through `projectBoardForRole` rather than a string
// built here. The proxy REDIRECTS a role that lands in the wrong area
// rather than refusing it, so a hand-built /admin/projects/<id> followed by
// a member is not an error they can see - it is a link that quietly takes
// them somewhere else.
// -------------------------------------------------------------------
export default async function DeliveryProjectsPage({ eyebrow }: { eyebrow: string }) {
  // The services guard again on their first line. This is here so the page
  // is safe read on its own, and because the role is what the board links
  // are built from.
  const user = await requireUser();

  // The empty state differs: an admin on no projects has something to DO
  // about it, and telling them to ask an administrator is telling them to ask
  // themselves.
  const isAdmin = user.role === USER_ROLES.ADMIN;

  const [projects, myWork] = await Promise.all([getMyProjectsService(), getMyWorkService()]);

  return (
    <PortalPage
      eyebrow={eyebrow}
      title="Projects"
      description="The projects you are a member of, and the cards assigned to you across all of them."
    >
      {projects.length === 0 ? (
        // The third of this feature's three empty screens, and the only one
        // whose answer is somebody else's: membership is the boundary, and
        // an administrator is who grants it.
        <BoardEmptyState
          icon={<FolderKanban size={18} aria-hidden="true" />}
          title="You are not on any projects yet"
          detail={
            isAdmin
              ? "This lists the projects you are a member of, which is the working set rather than everything. Create one, or add yourself to an existing project from its setup screen."
              : "Projects appear here once an administrator adds you to one. From there you get its board, and you can log your time against its tasks."
          }
        />
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="your-projects">
            <h2 id="your-projects" className="text-base font-semibold text-foreground">
              Your projects
            </h2>

            <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {projects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={projectBoardForRole(user.role, project.id)}
                    className="block rounded-xl border border-border bg-card p-4 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {/* Titles and client names are typed by people, so they
                        render as text nodes and nothing else. */}
                    <span className="block truncate text-sm font-medium text-foreground">{project.title}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm text-muted-foreground">{project.clientName}</span>
                      {project.status === PROJECT_STATUSES.ACTIVE ? null : (
                        <Badge variant={project.status === PROJECT_STATUSES.ARCHIVED ? "destructive" : "warning"}>
                          {PROJECT_STATUS_LABELS[project.status]}
                        </Badge>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="assigned-to-you">
            <h2 id="assigned-to-you" className="text-base font-semibold text-foreground">
              Assigned to you
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Open cards from every project you are on. Finished work drops off the list.
            </p>

            {myWork.length === 0 ? (
              <BoardEmptyState
                className="mt-3"
                icon={<ListTodo size={18} aria-hidden="true" />}
                title="Nothing is assigned to you"
                detail="Cards appear here when a project lead puts your name on one. Open a project above to see its board in the meantime."
              />
            ) : (
              <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
                {myWork.map((item) => (
                  <li key={item.taskId}>
                    <Link
                      href={projectBoardForRole(user.role, item.projectId)}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {item.clientName} - {item.projectTitle} - {item.phaseName}
                        </span>
                      </span>

                      <span className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {formatMinutesAsClock(item.loggedMinutes)} logged
                          {item.estimateMinutes > 0
                            ? ` of ${formatMinutesAsClock(item.estimateMinutes)}`
                            : ", no estimate"}
                        </span>
                        <Badge variant="outline">{TASK_COLUMN_LABELS[item.boardColumn]}</Badge>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </PortalPage>
  );
}
