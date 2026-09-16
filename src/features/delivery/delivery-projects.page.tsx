import Link from "next/link";

import { FolderKanban, ListTodo } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import PortalPage from "@/features/layout/portal-page";
import { requireUser } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import {
  PROJECT_STATUSES,
  PROJECT_KINDS,
  PROJECT_KIND_LABELS,
  PROJECT_STATUS_LABELS,
  TASK_COLUMN_LABELS,
} from "@/lib/data/kysely-database-types";
import { projectBoardForRole } from "@/lib/routes";

import { getMyWorkService } from "./delivery-board.service";
import { getAllProjectsForAdminService, getMyProjectsService } from "./delivery-setup.service";
import { formatMinutesAsClock } from "./delivery.types";
import { BoardEmptyState } from "./components/board-empty-state";

// -------------------------------------------------------------------
// Projects, rendered identically in all three areas - MEMBERSHIP decides
// what somebody sees here, not their role, so there is nothing for an area
// to change and the three routes under app/ are thin wrappers around this.
//
// -------------------------------------------------------------------
// AN ADMIN SEES EVERY PROJECT HERE. EVERYBODY ELSE SEES THEIRS.
//
// This page used to call getMyProjectsService for all three roles, and said
// so deliberately: "an admin who administers forty projects and is on two
// sees the two ... an admin reaches any other project through the admin
// screens". That was a real position and it was the wrong one. There is no
// admin screen that lists projects - the budget report has a picker, which is
// not the same thing - so a project created by somebody else was reachable
// only by knowing its id. An admin looking at the app's list of projects and
// not finding the one a colleague made has no way to tell whether it exists.
//
// The two services are unchanged and both still correct. getMyProjectsService
// means MY projects and answers that for an admin too - the sidebar rail
// still calls it, which is right: the rail is a jump list of the work you are
// actually on, and it would be useless with forty rows in it.
//
// So the rail and this page now show different sets for an admin, and that is
// the point rather than a wrinkle: the rail is your shortcuts, the page is
// the directory.
//
// ARCHIVED ARE EXCLUDED even for an admin. Archiving is this module's soft
// delete, and a directory that keeps everything anybody ever finished buries
// what is live. The budget report still includes them, because a finished
// project is exactly what somebody asks that report about.
//
// THE LANDING PAGE'S TILE STILL COUNTS MEMBERSHIPS, so for an admin it can
// read 2 while this page lists 40. Both labels are honest - the tile says
// "projects you are on" - but they no longer answer the same question, and
// the comment below that used to promise they did has gone with this change.
// -------------------------------------------------------------------
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

  const [projects, myWork] = await Promise.all([
    isAdmin ? getAllProjectsForAdminService({ includeArchived: false }) : getMyProjectsService(),
    getMyWorkService(),
  ]);

  // -----------------------------------------------------------------
  // DELIVERY WORK FIRST, STANDING BUCKETS AFTER, IN ONE LIST.
  //
  // One grid rather than two sections. For everybody but an admin this list
  // and the landing page's "Projects you are on" tile still come from the
  // same service and therefore agree; for an admin they no longer do, and the
  // note at the top of this file says why. What changes here is the ORDER
  // and a badge: a standing bucket of time codes interleaved alphabetically
  // between two client projects reads as a third client project.
  //
  // A stable partition rather than a sort, so the alphabetical order the
  // repository already applied survives inside each half. The nav reads the
  // same rows, which is why this is done here and not in the query.
  // -----------------------------------------------------------------
  const ordered = [
    ...projects.filter((project) => project.kind !== PROJECT_KINDS.ONGOING),
    ...projects.filter((project) => project.kind === PROJECT_KINDS.ONGOING),
  ];

  return (
    <PortalPage
      eyebrow={eyebrow}
      title="Projects"
      description={
        isAdmin
          ? "Every project in the app, and the cards assigned to you across the ones you are on."
          : "The projects you are a member of, and the cards assigned to you across all of them."
      }
    >
      {projects.length === 0 ? (
        // The third of this feature's three empty screens, and the only one
        // whose answer is somebody else's: membership is the boundary, and
        // an administrator is who grants it.
        <BoardEmptyState
          icon={<FolderKanban size={18} aria-hidden="true" />}
          title={isAdmin ? "No projects yet" : "You are not on any projects yet"}
          detail={
            isAdmin
              ? "Nothing has been created in the app yet. This lists every project rather than only the ones you are on, so an empty screen here means an empty app. Start one and it appears."
              : "Projects appear here once an administrator adds you to one. From there you get its board, and you can log your time against its tasks."
          }
        />
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="your-projects">
            {/* The heading names what was actually read, which differs by
                role. "Your projects" over a list of every project in the app
                would be wrong in the one way an admin could not detect: it
                would look right. */}
            <h2 id="your-projects" className="text-base font-semibold text-foreground">
              {isAdmin ? "All projects" : "Your projects"}
            </h2>

            <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {ordered.map((project) => (
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
                      {/* Only the ongoing ones are labelled. Badging every
                          card "Project" would be a word on every row that
                          distinguishes nothing - the absence IS the ordinary
                          case, which is the same reason an active project
                          shows no status badge above. */}
                      {project.kind === PROJECT_KINDS.ONGOING ? (
                        <Badge variant="outline">{PROJECT_KIND_LABELS[project.kind]}</Badge>
                      ) : null}
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
              Open cards from every project you are on. Finished work drops off the list, and ongoing work is
              left out: a standing time code is not a card waiting on anybody.
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
