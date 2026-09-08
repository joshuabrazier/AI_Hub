import "server-only";

import { requireUser } from "@/lib/auth/session-auth-server";
import { handleError } from "@/lib/handle-errors";
import { transcriptionHomeForRole } from "@/lib/routes";
import { getMyPresence, listMeetingsAroundNow } from "@/lib/graph/teams-presence";
import { resolveMeetingNow } from "@/lib/graph/meeting-now";

// -------------------------------------------------------------------
// "Are you in a meeting right now, and shall I prompt you about it?"
//
// PER-PERSON AND ONLY EVER YOUR OWN. The guard is requireUser and the actor
// comes from the SESSION - there is no argument here naming whose presence
// to read, and there must never be one. Graph would allow reading a
// colleague's presence with a wider scope; this app asks for Presence.Read,
// which is your own, and the absence of a user-id parameter is the second
// half of that promise.
//
// IT ANSWERS A QUESTION, IT DOES NOT START ANYTHING. Nothing here records,
// transcribes or writes. The prompt this feeds asks somebody to press a
// button in Teams, because Teams is what announces the recording to the
// people in the meeting - see the note on the component.
// -------------------------------------------------------------------

export interface MeetingNowDTO {
  // Whether to show the prompt at all.
  prompt: boolean;
  // The meeting, when one could be named. Null for an ad hoc call.
  meeting: { eventId: string; subject: string; startsAt: string; endsAt: string } | null;
  // Several meetings overlap and we will not choose between them. The prompt
  // says so and names them rather than presenting one as the answer.
  ambiguous: { eventId: string; subject: string }[];
  // Presence said InAMeeting, which Teams derives from the calendar as well
  // as from a real join. The wording softens rather than claiming you are
  // definitely in a call.
  certain: boolean;
  // Set when the read could not be done. "forbidden" means the Presence.Read
  // scope has not been consented, or this sign-in predates it being added -
  // and the remedy is to sign in again, which is worth saying rather than
  // showing nothing forever.
  unavailable: "forbidden" | "unavailable" | null;
  // WHERE THIS PERSON'S TRANSCRIPTION PAGE IS. Resolved here from their role
  // rather than guessed in the component, because the prompt mounts in all
  // three areas and a hardcoded /portal link would send an admin to a page
  // their own area has its own copy of. transcriptionHomeForRole already
  // exists for exactly this, and its note says why: a link built for one role
  // and followed by another does not error, it lands somewhere else entirely.
  transcriptionHref: string;
}

function nothing(href: string): MeetingNowDTO {
  return { prompt: false, meeting: null, ambiguous: [], certain: false, unavailable: null, transcriptionHref: href };
}

export async function getMeetingNowService(): Promise<MeetingNowDTO> {
  try {
    const user = await requireUser();

    const href = transcriptionHomeForRole(user.role);
    const NOTHING = nothing(href);

    const presenceRead = await getMyPresence(user.id);

    // Presence is the gate, so a failed presence read means no prompt AND no
    // diary call. Cheaper, and it keeps a tenant that has not consented from
    // paying a calendar request per poll for a feature it cannot use.
    if (!presenceRead.ok) return { ...NOTHING, unavailable: presenceRead.reason };

    const meetings = await listMeetingsAroundNow(user.id);

    const now = new Date();
    const resolved = resolveMeetingNow({ presence: presenceRead.presence, meetings, now });

    switch (resolved.kind) {
      case "not-in-meeting":
        return NOTHING;

      case "in-unknown-call":
        // A call with nothing in the diary behind it. Still worth prompting:
        // it is a real meeting, it just is not one of ours to import
        // afterwards, and the prompt says exactly that.
        return { ...NOTHING, prompt: true, certain: true };

      case "ambiguous":
        return {
          ...NOTHING,
          prompt: true,
          certain: true,
          ambiguous: resolved.meetings.map((meeting) => ({
            eventId: meeting.eventId,
            subject: meeting.subject,
          })),
        };

      case "in-meeting":
        return {
          prompt: true,
          meeting: {
            eventId: resolved.meeting.eventId,
            subject: resolved.meeting.subject,
            startsAt: resolved.meeting.startsAt.toISOString(),
            endsAt: resolved.meeting.endsAt.toISOString(),
          },
          ambiguous: [],
          certain: resolved.certainty === "confirmed",
          unavailable: null,
          transcriptionHref: href,
        };
    }
  } catch (error) {
    throw handleError("getMeetingNowService", error);
  }
}
