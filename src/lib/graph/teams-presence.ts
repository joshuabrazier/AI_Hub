import "server-only";

import { getDelegatedGraphToken } from "@/lib/sharepoint/graph-token";
import { GraphRequestError, graphRequest, graphStatusOf } from "@/lib/sharepoint/graph-client";

import type { PresenceSnapshot, ScheduledMeeting } from "./meeting-now";

// -------------------------------------------------------------------
// "Are you in a meeting right now?" - the two reads behind the prompt.
//
// Both are DELEGATED and both are about the signed-in person only. There is
// no path here to anybody else's presence or anybody else's diary, and that
// is deliberate rather than incidental: a feature that can see when a
// colleague is in a call is a surveillance feature, whatever it was built
// for. Graph would allow it with Presence.Read.All; this asks for
// Presence.Read, which is your own and nothing more.
//
// COST IS THE OTHER CONSTRAINT. This is polled while somebody has the app
// open, so it is two Graph calls per poll per person, against a
// per-application-per-tenant throttle shared with the SharePoint crawl and
// the meeting import. The caller decides the interval; these keep the
// payloads as small as Graph will allow and fail quiet rather than throwing
// a poll into an error boundary.
// -------------------------------------------------------------------

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// The same header the import sends, for the same reason: an ordinary event id
// changes when the item moves between calendars, and the id from here is
// handed to the import as the meeting to fetch. Two calls disagreeing about
// an id is how a prompt opens the wrong meeting.
const IMMUTABLE_ID_HEADERS = { Prefer: 'IdType="ImmutableId"' } as const;

// A diary window either side of now. Wide enough for a meeting somebody
// joined early or one running well over, narrow enough that a busy day is
// still a handful of entries rather than a page of them.
const WINDOW_BEFORE_MS = 4 * 60 * 60 * 1000;
const WINDOW_AFTER_MS = 2 * 60 * 60 * 1000;

const MAX_EVENTS = 25;

interface GraphPresence {
  availability?: string;
  activity?: string;
}

interface GraphEvent {
  id?: string;
  subject?: string;
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string } | null;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
}

// -------------------------------------------------------------------
// Graph hands back a naive local string plus a zone name, and the zone is
// UTC because that is what we ask for. Appending Z is therefore correct and
// not a guess - but only because of the Prefer header on the request.
// -------------------------------------------------------------------
function toInstant(value: string | undefined): Date | null {
  if (!value) return null;

  const parsed = new Date(value.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// -------------------------------------------------------------------
// A poll must not become an error page.
//
// This runs on a timer behind a floating prompt. A token that has lost the
// new scope, a tenant that has not consented yet, a 429 from a busy sweep -
// all of them are ordinary here and none should surface as a failure. The
// prompt simply does not appear, which is the correct behaviour for a
// feature nobody asked to be interrupted by.
//
// The one thing NOT swallowed is the distinction itself: the caller is told
// whether the read failed, so a screen that wants to explain "sign in again
// to enable this" can, without every poll shouting about it.
// -------------------------------------------------------------------
export type PresenceRead = { ok: true; presence: PresenceSnapshot } | { ok: false; reason: "unavailable" | "forbidden" };

export async function getMyPresence(userId: string): Promise<PresenceRead> {
  try {
    const token = await getDelegatedGraphToken(userId);

    const payload = (await graphRequest(`${GRAPH_BASE}/me/presence`, token)) as GraphPresence;

    return {
      ok: true,
      presence: {
        availability: payload.availability?.trim() || null,
        activity: payload.activity?.trim() || null,
      },
    };
  } catch (error) {
    // 403 means the scope was never consented, or this token predates it
    // being added. Worth telling apart, because the remedy is "sign in
    // again" rather than "wait".
    const status = error instanceof GraphRequestError ? graphStatusOf(error) : null;

    return { ok: false, reason: status === 403 || status === 401 ? "forbidden" : "unavailable" };
  }
}

// -------------------------------------------------------------------
// The diary AROUND NOW.
//
// Deliberately not listRecentTeamsMeetings, which looks only backwards
// because the import is about meetings that have finished. This one has to
// span now, and include the meeting starting in five minutes that somebody
// has already joined.
//
// calendarView rather than /events, for the same reason as the import: it
// expands a recurring series into occurrences, and a weekly stand-up is one
// event with many meetings.
// -------------------------------------------------------------------
export async function listMeetingsAroundNow(
  userId: string,
  options: { now?: Date } = {},
): Promise<ScheduledMeeting[]> {
  try {
    const token = await getDelegatedGraphToken(userId);

    const now = options.now ?? new Date();
    const from = new Date(now.getTime() - WINDOW_BEFORE_MS);
    const until = new Date(now.getTime() + WINDOW_AFTER_MS);

    const url =
      `${GRAPH_BASE}/me/calendarView` +
      `?startDateTime=${from.toISOString()}` +
      `&endDateTime=${until.toISOString()}` +
      `&$select=id,subject,isOnlineMeeting,onlineMeeting,start,end` +
      `&$orderby=start/dateTime` +
      `&$top=${MAX_EVENTS}`;

    const payload = (await graphRequest(url, token, { headers: IMMUTABLE_ID_HEADERS })) as {
      value?: GraphEvent[];
    };

    return (payload.value ?? [])
      .map((event): ScheduledMeeting | null => {
        const startsAt = toInstant(event.start?.dateTime);
        const endsAt = toInstant(event.end?.dateTime);

        if (!event.id || !startsAt || !endsAt) return null;

        return {
          eventId: event.id,
          subject: event.subject?.trim() || "Untitled meeting",
          joinUrl: event.onlineMeeting?.joinUrl ?? null,
          startsAt,
          endsAt,
          // Kept rather than filtered here, so the matcher can say why a
          // diary entry was ignored. An event Outlook has not marked as an
          // online meeting cannot be transcribed by Teams.
          isOnlineMeeting: Boolean(event.isOnlineMeeting && event.onlineMeeting?.joinUrl),
        };
      })
      .filter((meeting): meeting is ScheduledMeeting => meeting !== null);
  } catch {
    // Same reasoning as presence: a poll that cannot read the diary shows no
    // prompt. It does not interrupt somebody with an error about a feature
    // they did not invoke.
    return [];
  }
}
