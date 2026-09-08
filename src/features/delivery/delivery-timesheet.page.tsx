import PortalPage from "@/features/layout/portal-page";
import { todayInAppZone } from "@/lib/timezone";

import { getProjectBoardService } from "./delivery-board.service";
import { getTimesheetWeekService } from "./delivery-time.service";
import { getMyProjectsService } from "./delivery-setup.service";
import { buildTimesheetCatalogue } from "./components/timesheet-catalogue";
import { TimesheetWorkspace } from "./components/timesheet-workspace";

// -------------------------------------------------------------------
// ===================================================================
// THE TIMESHEET
// ===================================================================
//
// One week, laid out like a calendar: the days are the COLUMNS and the tasks
// are the ROWS, so somebody working on three tasks in a week fills in three
// rows rather than twenty-one cells.
//
// ONE PERSON'S WEEK, AND THE PERSON IS THE SESSION. There is no user id in
// the path and none in the props: time is always your own, and nothing on
// this screen offers to log an hour for somebody else - LogTimeSchema and
// AddTimesheetRowSchema carry no userId at all. The service will open
// another person's week for an ADMIN, and nothing routes to that: it is a
// decision to make deliberately rather than one to leak in through a search
// parameter.
//
// `week` arrives straight off the URL and is NOT validated here. The service
// normalises it - an unusable date falls back to this week, a mid-week date
// returns the week containing it - so a bookmarked or forwarded link lands
// on a working screen. The week it settled on is in the DTO, which is what
// the heading reads from.
//
// NOTHING HERE CONSTRUCTS A Date. Every date on this screen is a
// 'YYYY-MM-DD' string, the week arithmetic is the pure helpers in
// delivery.types.ts, and "today" comes from `todayInAppZone` so the
// highlighted column is the organisation's day rather than the reader's.
//
// NO GUARD OF ITS OWN, matching transcription.page.tsx and the rest of this
// module: `getTimesheetWeekService` opens with requireUser, every board read
// authorises against project membership, and every write re-checks. There is
// nothing on this page that a service has not already answered for.
//
// -------------------------------------------------------------------
// WHY THE BOARDS ARE READ HERE, which is the one costly thing on the page.
//
// Two controls need what the WEEK does not carry: the add-row picker needs
// every project, phase and task the person could log to, and the estimate
// dialog needs the estimates on the task in hand and on the others it could
// take hours from. Neither can fetch it - the delivery actions are the
// writes plus this grid's own two entry points, and there is no read action
// on the board service for a client component to call.
//
// So it is read on the server, in parallel, and TRIMMED before it is handed
// down: buildTimesheetCatalogue keeps a title and two figures per task out
// of a BoardDTO that also carries assignees, positions, attachment counts
// and four columns per phase. The cost is one board read per project the
// person is a MEMBER of - archived ones are already out - which is a
// working set of a handful rather than the organisation's whole portfolio.
// A narrower "tasks I could log to" read would be the better answer if this
// becomes a problem; it does not exist yet.
//
// THE PICKER IS SCOPED TO MEMBERSHIPS EVEN FOR AN ADMIN, and that is
// consistent rather than a gap: `getMyProjectsService` reads the caller's own
// memberships by design, and an admin who is not on a project has no rate
// band on it, so `requireRateBandFor` would refuse the first hour they
// entered. Offering the row would be offering a cell that cannot be filled
// in.
// -------------------------------------------------------------------
export default async function DeliveryTimesheetPage({
  eyebrow,
  week,
}: {
  eyebrow: string;
  week?: string;
}) {
  const [timesheet, projects] = await Promise.all([
    getTimesheetWeekService(week ?? ""),
    getMyProjectsService(),
  ]);

  // Only after the memberships are known, and only for those - each read
  // authorises the caller against the project again.
  const boards = await Promise.all(projects.map((project) => getProjectBoardService(project.id)));

  return (
    <PortalPage
      eyebrow={eyebrow}
      title="Your timesheet"
      description="The hours you have logged, week by week, across every project you are on. Time here is always your own."
    >
      {/* KEYED ON THE WEEK. Moving to another week remounts the grid, which
          is what lets it own its week outright: the empty rows the browser
          is holding are restored once, on mount, instead of a component
          reconciling a changing prop against state it has since re-read.
          A refresh of THIS week (after an estimate change) keeps the key and
          the state, so nothing on screen jumps. */}
      <TimesheetWorkspace
        key={timesheet.weekStart}
        week={timesheet}
        catalogue={buildTimesheetCatalogue(projects, boards)}
        today={todayInAppZone()}
      />
    </PortalPage>
  );
}
