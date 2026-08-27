"use client";

import { useEffect, useState, useTransition } from "react";

import { CalendarClock, Check, Download, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { MESSAGES } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import type { ServerApiResponse } from "@/lib/types";

import { importTeamsMeetingAction, listTeamsMeetingsAction } from "../transcription.actions";
import { formatDuration, type TeamsMeetingDTO, type TeamsMeetingsDTO } from "../transcription.types";

// -------------------------------------------------------------------
// TranscriptionTeamsImport
//
// The third way in, and the only one where this app does no transcribing.
// Teams already did it, against each participant's own microphone and
// signed-in identity, so the transcript comes back WITH REAL NAMES ON IT -
// which is better than anything a single microphone in a meeting room can
// produce, and the whole reason to prefer this tab when it applies.
//
// TWO THINGS IT CANNOT DO, and the screen says both rather than letting
// somebody discover them by failing:
//
//   - It cannot make a meeting have a transcript. Transcription has to have
//     been started while the meeting was running.
//   - It cannot reach a meeting another organisation hosted. Their tenant
//     holds that transcript; the recorder on the previous tab is the answer
//     for those.
//
// THE LIST IS FETCHED WHEN THIS TAB OPENS, not with the page. Rendering the
// transcription screen reads the database and nothing else - a Graph call in
// that path would put the whole screen behind Microsoft answering. So this
// loads on mount, and everything about it is a state this component owns.
//
// It deliberately does not say which meetings HAVE a transcript. Graph gives
// no way to ask that for a list; finding out means two more calls per row,
// which for a fortnight of meetings is dozens of requests to grey out some
// rows. The question is asked once, for the meeting somebody picks.
// -------------------------------------------------------------------

// How a response becomes the next state. One function so the mount path and
// the refresh button cannot end up disagreeing about what a failure looks
// like - a failure is shown IN PLACE rather than as a toast, because it is
// the whole content of this tab and the likeliest message ("sign in again to
// renew access") is an instruction to act on, not a notice to dismiss.
function toLoadState(
  response: ServerApiResponse<TeamsMeetingsDTO>,
): { page: TeamsMeetingsDTO | null; error: string | null } {
  return response.success
    ? { page: response.data, error: null }
    : { page: null, error: response.formError ?? MESSAGES.SOMETHING_WENT_WRONG };
}

export function TranscriptionTeamsImport({ onImported }: { onImported: (transcriptionId: string) => void }) {
  const [page, setPage] = useState<TeamsMeetingsDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Which meeting is being imported, so the button on that row shows the
  // wait and the others simply disable. A single boolean would spin every
  // row at once and hide which one was clicked.
  const [importingId, setImportingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // -------------------------------------------------------------------
  // Ask Microsoft for the meetings.
  //
  // The effect subscribes to an external system and applies the answer in
  // the promise's own callback - never in the effect body, which is both
  // what React asks for and the difference between one render and a
  // cascade. `isLoading` starts true in its initialiser for the same
  // reason.
  //
  // The mapping from a response to the next state is a plain function, so
  // the mount path and the refresh button cannot disagree about what a
  // failure looks like. Only the two setState calls are repeated, and they
  // have to be: the rule is about where they are written, not what they do.
  // -------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    listTeamsMeetingsAction()
      .then((response) => {
        if (cancelled) return;

        const next = toLoadState(response);

        setPage(next.page);
        setLoadError(next.error);
      })
      .catch((error) => {
        console.warn("[teams-import] could not read the meeting list", error);

        if (!cancelled) setLoadError(MESSAGES.SOMETHING_WENT_WRONG);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Refreshing by hand. An event handler rather than an effect, so the
  // spinner and the cleared error can be set straight away - which is what
  // makes the button feel like it did something.
  const refresh = async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const next = toLoadState(await listTeamsMeetingsAction());

      setPage(next.page);
      setLoadError(next.error);
    } catch (error) {
      handleFrontendErrorWithToast(error);
      setLoadError(MESSAGES.SOMETHING_WENT_WRONG);
    } finally {
      setIsLoading(false);
    }
  };

  const importMeeting = (meeting: TeamsMeetingDTO) =>
    startTransition(async () => {
      setImportingId(meeting.eventId);

      try {
        const response = await importTeamsMeetingAction({ eventId: meeting.eventId });

        if (!response.success) {
          // The service's messages are specific on purpose - "transcription
          // was never started", "another organisation hosted this" - so they
          // are shown as they are rather than replaced with a generic one.
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        // The row arrives in `summarising` with its transcript already
        // stored. Opening it puts the reader on the screen that polls, which
        // is what writes the summary - so this is not just navigation, it is
        // how the job finishes.
        onImported(response.data.id);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      } finally {
        setImportingId(null);
      }
    });

  if (isLoading) {
    return <TeamsMessage title="Looking for your recent Teams meetings..." />;
  }

  if (loadError) {
    return (
      <TeamsMessage title="Your meetings could not be loaded" detail={loadError}>
        <Button type="button" variant="outline" className="mt-4" onClick={() => void refresh()}>
          <RefreshCw size={14} aria-hidden="true" />
          Try again
        </Button>
      </TeamsMessage>
    );
  }

  if (!page?.isConfigured) {
    return (
      <TeamsMessage
        title="Importing from Teams is not available here"
        detail="This environment has no Microsoft sign-in configured, so there is no way to reach your calendar. Record the meeting or upload a file instead."
      />
    );
  }

  if (page.meetings.length === 0) {
    return (
      <TeamsMessage
        title="No Teams meetings in the last fortnight"
        detail={`Nothing in your calendar for the past ${page.lookbackDays} days was a Teams meeting. Record one here instead, or upload a file.`}
      >
        <Button type="button" variant="outline" className="mt-4" onClick={() => void refresh()}>
          <RefreshCw size={14} aria-hidden="true" />
          Refresh
        </Button>
      </TeamsMessage>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Your Teams meetings from the last {page.lookbackDays} days. Importing brings across the transcript
          Teams made, with everybody named, and summarises it here. It only works if transcription was started
          during the meeting.
        </p>

        <Button type="button" variant="ghost" size="sm" onClick={() => void refresh()} disabled={isPending}>
          <RefreshCw size={14} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {/* Only when Microsoft actually had more to send. A person with a very
          full fortnight would otherwise scan the list, not find the meeting
          they want, and conclude the import is broken. */}
      {page.truncated ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
        >
          You have more meetings in this period than fit in one list, so the oldest are not shown.
        </p>
      ) : null}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {page.meetings.map((meeting) => (
          <TeamsMeetingRow
            key={meeting.eventId}
            meeting={meeting}
            // Disabled across the whole list while one is running: an import
            // is three calls to Microsoft and a write, and a person clicking
            // four rows in a row would queue four of them behind each other
            // with no way to tell what was happening.
            isBusy={isPending}
            isImporting={importingId === meeting.eventId}
            onImport={() => importMeeting(meeting)}
            onOpen={onImported}
          />
        ))}
      </ul>

      <p className="text-xs text-muted-foreground">
        A meeting hosted by another organisation will not be here even if you attended it - they hold that
        transcript. Record those on the Record tab.
      </p>
    </div>
  );
}

// -------------------------------------------------------------------
// One meeting.
//
// Everything on this row is text from somebody's calendar - a subject and an
// organiser's name - so it renders as text nodes, the same rule the rest of
// this feature follows for a transcript or a filename.
// -------------------------------------------------------------------
function TeamsMeetingRow({
  meeting,
  isBusy,
  isImporting,
  onImport,
  onOpen,
}: {
  meeting: TeamsMeetingDTO;
  isBusy: boolean;
  isImporting: boolean;
  onImport: () => void;
  onOpen: (transcriptionId: string) => void;
}) {
  // Scheduled length, which is what a calendar knows. The real one is only
  // known after the transcript is in, and the detail screen shows it then.
  const minutes = Math.round((meeting.endsAt.getTime() - meeting.startsAt.getTime()) / 60_000);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{meeting.subject}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CalendarClock size={12} aria-hidden="true" />
            {formatDateTime(meeting.startsAt)}
          </span>
          {minutes > 0 ? <span>{formatDuration(minutes * 60)}</span> : null}
          {meeting.organiser ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Users size={12} aria-hidden="true" />
              <span className="truncate">{meeting.organiser}</span>
            </span>
          ) : null}
        </p>
      </div>

      {meeting.importedAs ? (
        // Already imported. Offered as a way to OPEN it rather than as a
        // disabled button: somebody clicking a meeting they did last week
        // wants to read it, and that is what the click should do.
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onOpen(meeting.importedAs as string)}
          disabled={isBusy}
        >
          <Check size={14} aria-hidden="true" />
          Imported - open
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onImport}
          disabled={isBusy}
          loading={isImporting}
        >
          <Download size={14} aria-hidden="true" />
          {isImporting ? "Importing..." : "Import"}
        </Button>
      )}
    </li>
  );
}

// -------------------------------------------------------------------
// The empty, loading and refused states, which are the same shape.
//
// role="status" on all of them so a screen reader is told when the list is
// replaced by one of these rather than being left on a tab that has quietly
// changed underneath it.
// -------------------------------------------------------------------
function TeamsMessage({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center rounded-lg border border-border bg-muted/40 px-6 py-12 text-center"
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Users size={22} aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
      {detail ? <p className="mt-1 max-w-md text-sm text-muted-foreground">{detail}</p> : null}
      {children}
    </div>
  );
}
