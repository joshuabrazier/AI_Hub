import "server-only";

import { addDays, format, parseISO, startOfWeek } from "date-fns";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { getUserSessionsInRangeRepo } from "@/lib/data/repositories/class-sessions.repository";
import { getClosureDaysInRangeRepo } from "@/lib/data/repositories/closure-days.repository";
import { handleError } from "@/lib/handle-errors";
import { todayInAppZone } from "@/lib/timezone";

import { mapDBMemberSessionToPortalScheduleSessionDTO } from "./portal-schedule.mappers";
import { PortalWeekResponseDTO } from "./portal-schedule.types";

// -------------------------------------------------------------------
// Member portal schedule service
//
// The guard opens the one entry point below, and the user id it returns is the
// only one that reaches a repository here. getUserSessionsInRangeRepo filters
// on that id, and that predicate IS the authorization check: it is what stops
// one member reading another's week, not a filter applied afterwards.
//
// The guard lives here rather than only in the page and the action. The portal
// layout checks the same thing, but a service that trusts its caller is only as
// safe as the least careful caller it ever acquires.
// -------------------------------------------------------------------

// Normalise any 'YYYY-MM-DD' to the Monday of its week, so the same week is
// always keyed the same way whichever of its days was asked for.
function toMonday(dateIso: string): string {
  return format(startOfWeek(parseISO(dateIso), { weekStartsOn: 1 }), "yyyy-MM-dd");
}

// -------------------------------------------------------------------
// The signed-in member's sessions for the week containing `weekStartIso`.
//
// Every status is returned. A cancelled session still shows, struck through,
// because "the class is off this week" is exactly what a member needs to know
// and hiding it looks like the session simply vanished.
// -------------------------------------------------------------------
export async function getPortalWeekService(weekStartIso: string): Promise<PortalWeekResponseDTO> {
  try {
    const user = await requireUserRole([USER_ROLES.MEMBER]);

    const start = toMonday(weekStartIso);
    const end = format(addDays(parseISO(start), 6), "yyyy-MM-dd");

    // The app's calendar day in its own time zone. The server runs in UTC, so
    // deriving "today" from the server clock would put the boundary between
    // history and what is still ahead on the wrong day for most of the evening.
    const todayIso = todayInAppZone();

    const [rows, closureDays] = await Promise.all([
      getUserSessionsInRangeRepo(user.id, start, end, todayIso),
      getClosureDaysInRangeRepo(start, end),
    ]);

    const closureReasonByDate = new Map(closureDays.map((day) => [day.dayDate, day.reason]));

    return {
      weekStartIso: start,
      todayIso,
      sessions: rows.map((row) =>
        mapDBMemberSessionToPortalScheduleSessionDTO(row, todayIso, closureReasonByDate),
      ),
    };
  } catch (error) {
    throw handleError("getPortalWeekService", error);
  }
}
