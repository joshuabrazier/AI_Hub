import "server-only";

import { handleError } from "@/lib/handle-errors";

import { getMyWorkService } from "./delivery-board.service";
import { getMyProjectsService } from "./delivery-setup.service";
import { getTimesheetWeekService } from "./delivery-time.service";
import {
  byAttention,
  countByColumn,
  type MyDeliverySummaryDTO,
} from "./delivery.types";

// -------------------------------------------------------------------
// ===================================================================
// WHAT A LANDING PAGE SHOWS SOMEBODY ABOUT THEIR OWN WORK
// ===================================================================
//
// COMPOSITION, NOT A FOURTH WAY IN. Every figure here comes from a read that
// already exists, is already guarded and is already tested - the same calls
// the pages behind each card make. That is the whole point: a dashboard is
// where two answers to one question get noticed, and the only way to be sure
// a tile agrees with the screen it links to is for both to have asked the
// same function.
//
// NO GUARD OF ITS OWN, and that is deliberate rather than an omission. Each
// of the three opens with requireUser and resolves the caller from the
// SESSION, so there is no id to check here and nothing this function could
// usefully re-decide. Adding a role guard would be worse than redundant: it
// would make the summary role-shaped when what it actually is is
// membership-shaped, and an admin is a member of projects like anybody else.
//
// THREE READS IN PARALLEL, and the cost is worth stating because this is a
// LANDING page - the one everybody loads first, every morning:
//
//   getMyProjectsService     one query.
//   getTimesheetWeekService  one week for the caller. It normalises an
//                            unusable date to the current week, which is why
//                            "" is passed rather than a date built here -
//                            nothing in this app decides what day it is
//                            without going through the app timezone.
//   getMyWorkService         one query, plus one per DISTINCT project the
//                            caller has an open task on. That is the shape
//                            it already has on the projects page, and a
//                            person's working set is a handful.
//
// So it is a handful of queries rather than a fixed two, and the fan-out is
// bounded by memberships rather than by anything an anonymous caller can
// influence. If this page ever becomes slow, the fix is the narrower read
// getMyWorkService already documents as missing - not a cache here.
// -------------------------------------------------------------------
export async function getMyDeliverySummaryService(): Promise<MyDeliverySummaryDTO> {
  try {
    const [work, projects, week] = await Promise.all([
      getMyWorkService(),
      getMyProjectsService(),
      // "" rather than a date: the service normalises anything unusable to
      // the current week in the app's own timezone, and the week it settled
      // on comes back in the DTO for the heading and the link to read.
      getTimesheetWeekService(""),
    ]);

    return {
      // Sorted HERE rather than in a card, so the order is a decision with a
      // test on it rather than a line of JSX. See byAttention.
      work: [...work].sort(byAttention),
      counts: countByColumn(work),
      projectCount: projects.length,
      week: {
        weekStart: week.weekStart,
        dates: week.dates,
        dayTotalMinutes: week.dayTotalMinutes,
        totalMinutes: week.totalMinutes,
      },
    };
  } catch (error) {
    throw handleError("getMyDeliverySummaryService", error);
  }
}
