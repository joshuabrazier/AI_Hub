import "server-only";

import { getDelegatedGraphToken } from "@/lib/sharepoint/graph-token";
import {
  GRAPH_OUTCOMES,
  GraphRequestError,
  graphRequest,
  graphStatusOf,
} from "@/lib/sharepoint/graph-client";

// -------------------------------------------------------------------
// Teams meetings and their transcripts, through Microsoft Graph.
//
// This module RETRIEVES; it never records. Teams transcribes the meeting
// itself, against each participant's own microphone and signed-in
// identity, and this collects the result afterwards. Two consequences that
// shape everything below:
//
//   - If nobody turned transcription on, there is nothing to fetch and the
//     list comes back empty. No amount of code changes that.
//   - It only works for meetings YOUR TENANT hosts. A meeting run by a
//     client on their own tenant lives under their permissions, and this
//     will find nothing for it.
//
// THE LOOKUP IS A CHAIN, and there is no shortcut. Graph has no "list my
// meetings that have transcripts" endpoint, so it goes:
//
//   calendar events -> the event's joinUrl -> the onlineMeeting -> its
//   transcripts -> the transcript's content
//
// Four calls to import one meeting, which is why the list is fetched once
// and the content only for the meeting somebody actually picks.
// -------------------------------------------------------------------

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// How far back the meeting list looks. Teams keeps transcripts far longer,
// but a list is something somebody scans - a fortnight is enough to find
// the meeting you just left without becoming a wall of history.
export const MEETING_LOOKBACK_DAYS = 14;

// A hard ceiling on the calendar page, so one person's very full diary
// cannot turn a screen render into an unbounded fetch.
const MAX_EVENTS = 100;

export type TeamsMeetingSummary = {
  /** The calendar event id - stable, and what the import request carries. */
  eventId: string;
  subject: string;
  joinUrl: string;
  startsAt: Date;
  endsAt: Date;
  organiser: string | null;
};

type GraphEvent = {
  id?: string;
  subject?: string;
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string } | null;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  organizer?: { emailAddress?: { name?: string; address?: string } };
};

// -------------------------------------------------------------------
// Graph returns event times as a naive local string plus a separate
// timeZone field, NOT as an instant. Reading `dateTime` straight into a
// Date would interpret it in the SERVER's zone and silently move every
// meeting by the offset - an hour or ten, depending on where the process
// happens to be running.
//
// Graph answers in UTC unless a `Prefer: outlook.timezone` header asks it
// not to, and nothing here sends one, so appending "Z" is correct. That is
// stated rather than assumed because it is a property of the request, not
// of the string: the day somebody adds that header, this has to change with
// it.
//
// Nothing is converted to the app timezone here. These become Date objects
// on the DTO and are formatted for display by formatDateTime, which is the
// single place that decides what zone a person sees.
// -------------------------------------------------------------------
function toInstant(value: string | undefined): Date | null {
  if (!value) return null;

  const withZone = value.endsWith("Z") ? value : `${value}Z`;
  const parsed = new Date(withZone);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// -------------------------------------------------------------------
// The person's Teams meetings in the recent past.
//
// Only events that are actually online meetings with a join URL - a normal
// calendar appointment has no transcript and would be noise in the list.
// Ordered newest first, because the meeting somebody wants is nearly always
// the one they just left.
// -------------------------------------------------------------------
export async function listRecentTeamsMeetings(
  userId: string,
  options: { now?: Date } = {},
): Promise<TeamsMeetingSummary[]> {
  const token = await getDelegatedGraphToken(userId);

  const now = options.now ?? new Date();
  const from = new Date(now.getTime() - MEETING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  // calendarView rather than /events, because it expands recurring series
  // into their occurrences. A weekly stand-up is one event with many
  // meetings, and only the occurrences have transcripts.
  const url =
    `${GRAPH_BASE}/me/calendarView` +
    `?startDateTime=${from.toISOString()}` +
    `&endDateTime=${now.toISOString()}` +
    `&$select=id,subject,isOnlineMeeting,onlineMeeting,start,end,organizer` +
    `&$orderby=start/dateTime desc` +
    `&$top=${MAX_EVENTS}`;

  const payload = (await graphRequest(url, token)) as { value?: GraphEvent[] };

  return (payload.value ?? [])
    .map(toMeetingSummary)
    .filter((meeting): meeting is TeamsMeetingSummary => meeting !== null)
    // Sorted here as well as in the query. calendarView's own default is
    // ASCENDING, so if the $orderby were ever dropped or refused, $top would
    // silently keep the OLDEST hundred events of the fortnight and throw
    // away the meeting somebody just left - which is the only one they are
    // ever likely to want. Sorting twice is free; that failure is not.
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
}

// -------------------------------------------------------------------
// One event, by its calendar id.
//
// The import takes an EVENT ID and nothing else, and this is why: the join
// URL and the title are then read back from Graph rather than accepted from
// the browser. A join URL from a client would be substituted into an OData
// filter string, and a title from a client would name a row after something
// the meeting is not.
//
// Null when the id matches nothing the signed-in person can see - a deleted
// event, or somebody else's. Graph answers 404 for both, and the caller
// turns that into "that meeting is no longer there" rather than a failure.
// -------------------------------------------------------------------
export async function getTeamsMeeting(userId: string, eventId: string): Promise<TeamsMeetingSummary | null> {
  const token = await getDelegatedGraphToken(userId);

  const url =
    `${GRAPH_BASE}/me/events/${encodeURIComponent(eventId)}` +
    `?$select=id,subject,isOnlineMeeting,onlineMeeting,start,end,organizer`;

  try {
    return toMeetingSummary((await graphRequest(url, token)) as GraphEvent);
  } catch (error) {
    // graphStatusOf rather than instanceof - see the note on it. Getting
    // this wrong would report a deleted meeting as a Graph fault.
    if (graphStatusOf(error) === 404) return null;

    throw error;
  }
}

// Shared by the list and the single lookup, so a meeting reads the same
// whichever way it was found. Returns null for anything that is not a Teams
// meeting with a usable time - an ordinary appointment has no transcript,
// and an event we cannot place in time cannot be listed.
function toMeetingSummary(event: GraphEvent): TeamsMeetingSummary | null {
  const joinUrl = event.onlineMeeting?.joinUrl;
  const startsAt = toInstant(event.start?.dateTime);
  const endsAt = toInstant(event.end?.dateTime);

  if (!event.id || !event.isOnlineMeeting || !joinUrl || !startsAt || !endsAt) return null;

  return {
    eventId: event.id,
    // A meeting with no subject is legal and happens. Named rather than
    // left blank, because an empty heading in a list reads as a bug.
    subject: event.subject?.trim() || "Untitled meeting",
    joinUrl,
    startsAt,
    endsAt,
    organiser: event.organizer?.emailAddress?.name ?? event.organizer?.emailAddress?.address ?? null,
  };
}

// -------------------------------------------------------------------
// Resolve a join URL to the onlineMeeting behind it.
//
// The filter is on JoinWebUrl and it is the documented way in - there is no
// endpoint that takes a calendar event id. The URL has to go in single
// quotes inside the filter, so a quote in it would break the expression;
// join URLs are Microsoft-generated and do not contain one, but it is
// encoded anyway rather than trusted.
//
// Returns null when Graph knows nothing about it, which happens for a
// meeting hosted by another tenant.
// -------------------------------------------------------------------
export async function findOnlineMeetingId(userId: string, joinUrl: string): Promise<string | null> {
  const token = await getDelegatedGraphToken(userId);

  const filter = encodeURIComponent(`JoinWebUrl eq '${joinUrl.replace(/'/g, "''")}'`);
  const url = `${GRAPH_BASE}/me/onlineMeetings?$filter=${filter}`;

  const payload = (await graphRequest(url, token)) as { value?: { id?: string }[] };

  return payload.value?.[0]?.id ?? null;
}

export type TeamsTranscriptSummary = {
  id: string;
  createdAt: Date | null;
};

// -------------------------------------------------------------------
// The transcripts a meeting has. Usually one, occasionally none.
//
// None is the ordinary case rather than a fault: it means transcription
// was never switched on, or the meeting has only just ended and Teams is
// still generating it. The caller says so plainly rather than treating it
// as a failure.
// -------------------------------------------------------------------
export async function listMeetingTranscripts(
  userId: string,
  onlineMeetingId: string,
): Promise<TeamsTranscriptSummary[]> {
  const token = await getDelegatedGraphToken(userId);

  const url = `${GRAPH_BASE}/me/onlineMeetings/${encodeURIComponent(onlineMeetingId)}/transcripts`;

  const payload = (await graphRequest(url, token)) as {
    value?: { id?: string; createdDateTime?: string }[];
  };

  return (payload.value ?? [])
    .filter((transcript) => transcript.id)
    .map((transcript) => ({
      id: transcript.id as string,
      createdAt: transcript.createdDateTime ? new Date(transcript.createdDateTime) : null,
    }));
}

// -------------------------------------------------------------------
// The transcript itself, as WebVTT.
//
// NOT routed through graphRequest, and that is deliberate: it sends
// `Accept: application/json` and parses the body, which would mangle a VTT
// file. This is a single call rather than a crawl, so it does its own fetch
// and translates failures into the same GraphRequestError the rest of the
// module raises - a caller should not have to care which helper made the
// request.
//
// `$format=text/vtt` is required. Without it Graph answers with its own
// JSON shape, which is not what the parser expects.
// -------------------------------------------------------------------
export async function fetchTranscriptVtt(
  userId: string,
  onlineMeetingId: string,
  transcriptId: string,
): Promise<string> {
  const token = await getDelegatedGraphToken(userId);

  const url =
    `${GRAPH_BASE}/me/onlineMeetings/${encodeURIComponent(onlineMeetingId)}` +
    `/transcripts/${encodeURIComponent(transcriptId)}/content?$format=text/vtt`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "text/vtt" },
    cache: "no-store",
  });

  if (!response.ok) {
    // 401 and 403 mean the grant is wrong or expired, which no retry fixes -
    // somebody has to sign in again or an admin has to consent. Reported
    // distinctly so the screen can say which.
    throw new GraphRequestError(`Could not download the transcript (${response.status})`, {
      status: response.status,
      outcome:
        response.status === 401 || response.status === 403 ? GRAPH_OUTCOMES.NEEDS_REAUTH : null,
    });
  }

  return response.text();
}
