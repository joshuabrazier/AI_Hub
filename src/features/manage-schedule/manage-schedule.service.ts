import "server-only";

import { addDays, format, parseISO } from "date-fns";

import { mapToWeekSessionDTO } from "@/features/admin-schedule/admin-schedule.mappers";
import { requireManagementScope } from "@/lib/auth/session-auth-server";
import {
  getSessionsInRangeForTeamsRepo,
  getSessionsInRangeRepo,
} from "@/lib/data/repositories/class-sessions.repository";
import { getClosureDaysInRangeRepo } from "@/lib/data/repositories/closure-days.repository";
import { getAttendanceCountsForSessionsRepo } from "@/lib/data/repositories/session-attendees.repository";
import { handleError } from "@/lib/handle-errors";
import { todayInAppZone } from "@/lib/timezone";
import { toMondayIso } from "@/lib/week";

import { ManagedScheduleWeekDTO } from "./manage-schedule.types";

// -------------------------------------------------------------------
// Manager schedule service
//
// The week is a WINDOW, not a permission. Which sessions appear inside it is
// resolved from the SESSION by requireManagementScope():
//
//   - isUnrestricted means admin, so no team filter;
//   - everyone else gets only the sessions of their teams' classes, because
//     getSessionsInRangeForTeamsRepo filters on the owning class's teamId;
//   - an EMPTY scope gets nothing - that repository short-circuits an empty id
//     list rather than dropping its WHERE, so "no teams" never widens into
//     "every team".
//
// Sessions of team-less (admin-only) classes are structurally absent from the
// scoped query, so a manager cannot see one here.
//
// The rows are mapped to the shared grid's DTO, which carries no editable
// field: this screen shows the week, it does not change it.
// -------------------------------------------------------------------

const DAYS_IN_WEEK = 7;

// -------------------------------------------------------------------
// The caller's week: the sessions of the teams they manage, plus the closures
// that cover whole days of it.
// -------------------------------------------------------------------
export async function getManagedScheduleWeekService(weekParam?: string): Promise<ManagedScheduleWeekDTO> {
  try {
    const scope = await requireManagementScope();

    // The app's own calendar day. It decides which dates are history - both for
    // the repositories (an inactive class hides only its UPCOMING sessions) and
    // for the grid's dimming - and it anchors the week when ?week= is missing
    // or malformed.
    const today = todayInAppZone();

    const weekStartIso = toMondayIso(weekParam, today);
    const weekEndIso = format(addDays(parseISO(weekStartIso), DAYS_IN_WEEK - 1), "yyyy-MM-dd");

    const [rows, closureDays] = await Promise.all([
      scope.isUnrestricted
        ? getSessionsInRangeRepo(weekStartIso, weekEndIso, today)
        : getSessionsInRangeForTeamsRepo(scope.teamIds, weekStartIso, weekEndIso, today),
      getClosureDaysInRangeRepo(weekStartIso, weekEndIso),
    ]);

    // Counted only for the sessions already inside the caller's scope.
    const counts = await getAttendanceCountsForSessionsRepo(rows.map((row) => row.id));
    const countBySession = new Map(counts.map((count) => [count.classSessionId, count]));
    // Keyed by the 'YYYY-MM-DD' string, so no date arithmetic is involved.
    const closureReasonByDate = new Map(closureDays.map((day) => [day.dayDate, day.reason]));

    return {
      weekStartIso,
      todayIso: today,
      sessions: rows.map((row) => {
        const count = countBySession.get(row.id);
        return mapToWeekSessionDTO(
          row,
          count?.total ?? 0,
          count?.cancelled ?? 0,
          closureReasonByDate.get(row.sessionDate) ?? null,
        );
      }),
      closureDays: closureDays.map((day) => ({ dateIso: day.dayDate, reason: day.reason })),
      isUnrestricted: scope.isUnrestricted,
    };
  } catch (error) {
    throw handleError("getManagedScheduleWeekService", error);
  }
}
