import "server-only";

import { addDays, format, parseISO } from "date-fns";
import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/audit/audit-log.types";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { database } from "@/lib/data/kysely-database-client";
import { ATTENDANCE_STATUS, USER_ROLES } from "@/lib/data/kysely-database-types";
import { getClassByIdRepo } from "@/lib/data/repositories/classes.repository";
import {
  getClassSessionByIdRepo,
  getUserSessionsInRangeRepo,
} from "@/lib/data/repositories/class-sessions.repository";
import { getClosureDaysInRangeRepo } from "@/lib/data/repositories/closure-days.repository";
import {
  getSessionAttendeeByIdRepo,
  setAttendanceStatusRepo,
} from "@/lib/data/repositories/session-attendees.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { formatIsoDate } from "@/lib/format";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { todayInAppZone } from "@/lib/timezone";

import { isCancellableBooking, mapDBMemberSessionToPortalBookingDTO } from "./portal-bookings.mappers";
import { CancelBookingRequestDTO, PortalBookingsResponseDTO } from "./portal-bookings.types";

// -------------------------------------------------------------------
// Member portal bookings service
//
// The generic "give up a place you cannot make". A member cancels their own
// booked place on an upcoming session; the row is UPDATED to
// attendance_status = 'cancelled' rather than deleted, so staff still see who
// dropped out and the place frees up for somebody else.
//
// This is all that survives of the swim-school make-up system. Credits, the
// credit cap, the twelve-hour rule and re-booking into another session are all
// gone - a member may release a place, and nothing more.
//
// Both entry points open with requireUserRole([MEMBER]) and resolve the acting
// member from what it returns. The guard lives HERE rather than only in the
// actions: a service that trusts its caller is only as safe as the least
// careful caller it ever acquires.
// -------------------------------------------------------------------

// How far ahead the bookings page looks. Sessions are generated across a
// class's whole run, so an unbounded list would be most of a year of rows for
// a page whose job is "what is coming up that I might need to cancel".
const BOOKING_HORIZON_DAYS = 90;

// -------------------------------------------------------------------
// One message for two different situations, on purpose.
//
// "There is no such booking" and "that booking is not yours" are answered
// identically. Told apart, this endpoint would confirm which attendee ids
// exist, which is exactly the probe an id in a request invites.
// -------------------------------------------------------------------
const BOOKING_NOT_FOUND_MESSAGE = "We could not find that booking.";

// -------------------------------------------------------------------
// The member's own places over the window ahead: the ones they still hold, and
// the ones they have given up.
//
// getUserSessionsInRangeRepo filters on the session user's id, and that
// predicate IS the authorization check - it is what stops one member reading
// another's bookings, not something applied to the results afterwards.
// -------------------------------------------------------------------
export async function getPortalBookingsService(): Promise<PortalBookingsResponseDTO> {
  try {
    const user = await requireUserRole([USER_ROLES.MEMBER]);

    // The app's calendar day in its own time zone. The server runs in UTC, so
    // taking "today" from the server clock would move the boundary between a
    // cancellable session and a past one onto the wrong day all evening.
    const todayIso = todayInAppZone();
    const horizonIso = format(addDays(parseISO(todayIso), BOOKING_HORIZON_DAYS), "yyyy-MM-dd");

    const [rows, closureDays] = await Promise.all([
      getUserSessionsInRangeRepo(user.id, todayIso, horizonIso, todayIso),
      getClosureDaysInRangeRepo(todayIso, horizonIso),
    ]);

    const closureReasonByDate = new Map(closureDays.map((day) => [day.dayDate, day.reason]));

    const allBookings = rows.map((row) => mapDBMemberSessionToPortalBookingDTO(row, todayIso, closureReasonByDate));

    return {
      todayIso,
      horizonIso,
      // A place given up is kept on the record rather than hidden, so the
      // member can see the cancellation went through and staff and member are
      // looking at the same thing.
      bookings: allBookings.filter((booking) => booking.attendanceStatus !== ATTENDANCE_STATUS.CANCELLED),
      cancelled: allBookings.filter((booking) => booking.attendanceStatus === ATTENDANCE_STATUS.CANCELLED),
    };
  } catch (error) {
    throw handleError("getPortalBookingsService", error);
  }
}

// -------------------------------------------------------------------
// Cancel one of the member's own booked places.
//
// The attendee id comes from the client and is treated as a lookup key only.
// What authorises the write is that the resolved row's user_id equals the
// SESSION user's id - never the id itself, and never anything else the request
// carried.
//
// The reads and the write share one transaction. getSessionAttendeeByIdRepo
// takes the same connection for exactly this reason: a check run on a
// different connection is blind to the transaction's own state, so it can
// authorise a write against a row it never actually saw.
// -------------------------------------------------------------------
export async function cancelBookingService(requestDTO: CancelBookingRequestDTO): Promise<void> {
  try {
    const user = await requireUserRole([USER_ROLES.MEMBER]);

    const todayIso = todayInAppZone();

    const cancelled = await database.transaction().execute(async (trx) => {
      const attendee = await getSessionAttendeeByIdRepo(requestDTO.attendeeId, trx);

      // Missing and not-yours give the same answer. See the message's comment.
      if (!attendee || attendee.userId !== user.id) {
        throw new DisplayErrorMessage(BOOKING_NOT_FOUND_MESSAGE);
      }

      const session = await getClassSessionByIdRepo(attendee.classSessionId, trx);

      if (!session) {
        throw new DisplayErrorMessage(BOOKING_NOT_FOUND_MESSAGE);
      }

      // From here on the row is known to be the caller's own, so these
      // messages can say what is actually wrong without telling anybody
      // anything about a record that is not theirs.
      if (attendee.attendanceStatus === ATTENDANCE_STATUS.CANCELLED) {
        throw new DisplayErrorMessage("You have already cancelled that place.");
      }

      if (!isCancellableBooking(session, attendee.attendanceStatus, todayIso)) {
        throw new DisplayErrorMessage(
          "That place can no longer be cancelled. Please contact us if you need to change it.",
        );
      }

      await setAttendanceStatusRepo(attendee.id, ATTENDANCE_STATUS.CANCELLED, trx);

      // Read for the trail only. The class carries the owning team, which is
      // what scopes the entry for whoever reviews it later.
      const bookedClass = await getClassByIdRepo(session.classId, trx);

      return {
        attendeeId: attendee.id,
        classSessionId: session.id,
        sessionDate: session.sessionDate,
        className: bookedClass?.name ?? "a session",
        teamId: bookedClass?.teamId ?? null,
      };
    });

    // Recorded after the transaction has committed, so the trail only ever
    // claims cancellations that actually happened.
    await recordAuditEvent({
      action: AUDIT_ACTIONS.BOOKING_CANCELLED,
      entityType: AUDIT_ENTITY_TYPES.BOOKING,
      entityId: cancelled.attendeeId,
      teamId: cancelled.teamId,
      // The member did this to themselves, and the trail should say so on both
      // counts rather than leaving the subject blank.
      subjectUserId: user.id,
      summary: `${user.name} cancelled their place in ${cancelled.className} on ${formatIsoDate(cancelled.sessionDate)}`,
      metadata: { classSessionId: cancelled.classSessionId, sessionDate: cancelled.sessionDate },
    });

    revalidatePath(ROUTES.PORTAL_BOOKINGS);
    // The place is gone from their week, and from the home page's next-up list.
    revalidatePath(ROUTES.PORTAL_SCHEDULE);
    revalidatePath(ROUTES.PORTAL);
  } catch (error) {
    throw handleError("cancelBookingService", error);
  }
}
