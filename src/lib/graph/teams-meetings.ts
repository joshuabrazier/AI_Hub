import "server-only";

import { getDelegatedGraphToken } from "@/lib/sharepoint/graph-token";
import {
  GRAPH_OUTCOMES,
  GraphRequestError,
  graphRequest,
  graphStatusOf,
  readGraphInnerErrorCode,
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

// -------------------------------------------------------------------
// Ask Outlook for ids that do not change.
//
// AN ORDINARY EVENT ID IS NOT STABLE. Microsoft documents that it changes
// when the item moves between containers - a different calendar, a different
// folder - and this app uses that id as half of `source_ref`, the key that
// makes importing idempotent. Without this header, somebody moving a meeting
// between calendars gets a second row and a second paid summary of a meeting
// they already have: precisely the outcome the unique index exists to stop.
//
// IT MUST BE SENT ON EVERY CALL THAT RETURNS AN ID WE COMPARE. The header
// applies only to the request it travels with, so an id listed with it will
// not match the same event fetched without it. Both calls below carry it, and
// a third one added later must too.
// -------------------------------------------------------------------
const IMMUTABLE_ID_HEADERS = { Prefer: 'IdType="ImmutableId"' } as const;

// -------------------------------------------------------------------
// The two 403s that are NOT about the signed-in person.
//
// Both are tenant-wide Teams settings that default to OFF, and neither can be
// fixed by the person meeting the error - no amount of signing in again
// helps. They are named here so the message can name the setting instead.
// -------------------------------------------------------------------
export const TEAMS_TRANSCRIPT_ERRORS = {
  // Graph access to meeting transcripts is switched off for the whole tenant.
  // Microsoft: "There is no request-side workaround."
  GRAPH_ACCESS_DISABLED: "GraphAccessToTranscriptsDisabled",
  // Transcripts are readable, but not the attributed form that carries who
  // said what - which is the entire reason this app prefers Teams.
  ATTRIBUTION_DISABLED: "SpeakerAttributionNotAllowed",
} as const;

// How far back the meeting list looks. Teams keeps transcripts far longer,
// but a list is something somebody scans - a fortnight is enough to find
// the meeting you just left without becoming a wall of history.
export const MEETING_LOOKBACK_DAYS = 14;

// A hard ceiling on the calendar page, so one person's very full diary
// cannot turn a screen render into an unbounded fetch.
const MAX_EVENTS = 100;

export type TeamsMeetingSummary = {
  /**
   * The calendar event's IMMUTABLE id - see IMMUTABLE_ID_HEADERS. An ordinary
   * event id changes when the event moves between calendars, and this one is
   * half of the key that makes importing idempotent.
   */
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
): Promise<{ meetings: TeamsMeetingSummary[]; truncated: boolean }> {
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

  const payload = (await graphRequest(url, token, { headers: IMMUTABLE_ID_HEADERS })) as {
    value?: GraphEvent[];
    "@odata.nextLink"?: string;
  };

  const meetings = (payload.value ?? [])
    .map(toMeetingSummary)
    .filter((meeting): meeting is TeamsMeetingSummary => meeting !== null)
    // Sorted again here, and it is worth being precise about what this does
    // and does not protect against. It guarantees the ORDER of what came
    // back. It does NOT undo truncation: $top is applied server-side before
    // the response is built, so if Graph ever ignored the $orderby - and
    // Microsoft documents that unsupported query parameters can fail
    // silently - the hundred events kept would be the OLDEST of the
    // fortnight and no amount of re-sorting brings back the meeting somebody
    // just left. `truncated` below is what actually covers that.
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

  // Graph only sends a nextLink when there was more to send, so its presence
  // is proof the window was cut short. Reported rather than swallowed: a list
  // that is quietly missing the meeting somebody is looking for reads as "the
  // import is broken", which is a much worse place to leave them than "there
  // were more than we could show".
  return { meetings, truncated: typeof payload["@odata.nextLink"] === "string" };
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
    // The SAME header as the list, and that is not optional: an id listed as
    // an immutable id will not resolve here without it.
    return toMeetingSummary(
      (await graphRequest(url, token, { headers: IMMUTABLE_ID_HEADERS })) as GraphEvent,
    );
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
// meeting hosted by another tenant - the commonest reason an import cannot
// go ahead, and the one the screen has a real sentence prepared for.
//
// GRAPH ANSWERS "NOT FOUND" TWO WAYS AND BOTH MEAN THE SAME THING HERE: an
// empty `value` array, or a 404. Which one you get is not something the
// reference commits to, so both are treated as null rather than betting on
// one. Getting that wrong is not a crash - it is worse. The 404 would
// propagate as an unclassified GraphRequestError, fall through to the
// generic branch of teamsGraphFailure, and tell somebody "Microsoft could
// not be reached" for the single case this feature exists to explain
// clearly. A wrong sentence sends people looking for a network problem that
// is not there.
// -------------------------------------------------------------------
export async function findOnlineMeetingId(userId: string, joinUrl: string): Promise<string | null> {
  const token = await getDelegatedGraphToken(userId);

  const filter = encodeURIComponent(`JoinWebUrl eq '${joinUrl.replace(/'/g, "''")}'`);
  const url = `${GRAPH_BASE}/me/onlineMeetings?$filter=${filter}`;

  let payload: { value?: { id?: string }[] };

  try {
    payload = (await graphRequest(url, token)) as { value?: { id?: string }[] };
  } catch (error) {
    // graphStatusOf rather than instanceof - class identity is per bundle
    // chunk in a production build. Same treatment as getTeamsMeeting above.
    if (graphStatusOf(error) === 404) return null;

    throw error;
  }

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
// `$format=text/vtt` is not strictly required - it is the documented default
// for /content - but it is pinned along with the Accept header so a future
// change of default cannot silently hand the parser something else.
//
// A 403 HERE IS USUALLY NOT ABOUT THE TOKEN, and that is why the body is
// read. Two tenant-wide Teams settings both refuse this call, both default to
// off, and neither is fixable by the person who met the error. Telling them
// to sign in again would be advice that can never work.
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
    // Read BEFORE the body is needed for anything else, and only on the
    // failure path - a successful response's body is the transcript.
    const innerErrorCode = await readGraphInnerErrorCode(response);

    // 401 and 403 mean no retry will help: either the grant is wrong, or a
    // tenant setting forbids this outright. Which of those it is lives in
    // innerErrorCode, and the caller reads it there.
    throw new GraphRequestError(`Could not download the transcript (${response.status})`, {
      status: response.status,
      outcome:
        response.status === 401 || response.status === 403 ? GRAPH_OUTCOMES.NEEDS_REAUTH : null,
      innerErrorCode,
    });
  }

  return response.text();
}
