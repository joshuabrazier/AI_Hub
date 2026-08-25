"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Download, FileText, Loader2, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { ModelMarkdown } from "@/components/model-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MESSAGES } from "@/lib/constants";
import {
  TRANSCRIPTION_IN_FLIGHT_STATUSES,
  TRANSCRIPTION_STATUSES,
  TRANSCRIPTION_STATUS_LABELS,
  TRANSCRIPTION_SOURCES,
} from "@/lib/data/kysely-database-types";
import { formatDateTime } from "@/lib/format";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import {
  downloadTranscriptAction,
  retryTranscriptionSummaryAction,
  startTranscriptionAction,
} from "../transcription.actions";
import { formatDuration, formatTimestamp, speakerLabel, type TranscriptionDetailDTO } from "../transcription.types";

// -------------------------------------------------------------------
// TranscriptionDetail
//
// One transcription: how it is going, and what came back.
//
// It renders STORED STATE and does not advance anything. A job is moved
// forward by the sweep in the workspace above, which is the single owner of
// that work - see sweepTranscriptionsAction. This component having its own
// poll as well is how the same recording ended up being summarised several
// times over: the sweep and the poll both found it finished.
// -------------------------------------------------------------------

const IN_FLIGHT: readonly string[] = TRANSCRIPTION_IN_FLIGHT_STATUSES;

// What is actually happening, in the words of somebody waiting for it.
const STATUS_EXPLANATIONS: Record<string, string> = {
  [TRANSCRIPTION_STATUSES.QUEUED]: "Waiting for the transcription service to pick this up.",
  [TRANSCRIPTION_STATUSES.TRANSCRIBING]: "Listening to the recording. This takes a few minutes.",
  [TRANSCRIPTION_STATUSES.SUMMARISING]: "The transcript is ready. Writing the summary.",
};

function statusVariant(status: string): "default" | "secondary" | "success" | "warning" | "destructive" {
  if (status === TRANSCRIPTION_STATUSES.COMPLETED) return "success";
  if (status === TRANSCRIPTION_STATUSES.FAILED) return "destructive";
  if (status === TRANSCRIPTION_STATUSES.AWAITING_MEDIA) return "secondary";

  return "warning";
}

export function TranscriptionDetail({ detail }: { detail: TranscriptionDetailDTO }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Seeded from the server, and replaced by the server whenever it
  // re-renders. The retry buttons below hand back an updated row so the
  // screen answers immediately rather than waiting for the next sweep.
  const [current, setCurrent] = useState(detail);
  const [renderedFrom, setRenderedFrom] = useState(detail);

  // Adjusted DURING render rather than in an effect, which is React's own
  // pattern for a prop change that has to reset state: an effect would
  // paint the stale copy first and then immediately re-render over it.
  if (renderedFrom !== detail) {
    setRenderedFrom(detail);
    setCurrent(detail);
  }

  const isInFlight = IN_FLIGHT.includes(current.status);

  const retryTranscription = () =>
    startTransition(async () => {
      try {
        const response = await startTranscriptionAction({ transcriptionId: current.id });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        setCurrent(response.data);
        toast.success(MESSAGES.TRANSCRIPTION_STARTED);
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  const retrySummary = () =>
    startTransition(async () => {
      try {
        const response = await retryTranscriptionSummaryAction({ transcriptionId: current.id });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        setCurrent(response.data);
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  const download = () =>
    startTransition(async () => {
      try {
        const response = await downloadTranscriptAction({ transcriptionId: current.id });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        // Built as a blob in the page rather than served from a route, so
        // the transcript never gets a second, separately-guarded way out of
        // the app. The object URL is revoked immediately - the click has
        // already happened by then.
        const url = URL.createObjectURL(new Blob([response.data.text], { type: "text/plain;charset=utf-8" }));

        const link = document.createElement("a");
        link.href = url;
        link.download = response.data.fileName;
        link.click();

        URL.revokeObjectURL(url);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  const isCompleted = current.status === TRANSCRIPTION_STATUSES.COMPLETED;
  const isFailed = current.status === TRANSCRIPTION_STATUSES.FAILED;

  // Still awaiting media on a screen somebody is LOOKING at means the upload
  // did not finish - during a real upload the composer is what is on screen,
  // and the row is already queued by the time this opens. So it is offered
  // as something to retry rather than as progress: retrying re-checks
  // storage, which either finds the file and starts, or says plainly that it
  // never arrived.
  const isStalled = current.status === TRANSCRIPTION_STATUSES.AWAITING_MEDIA;

  return (
    <div className="min-w-0 rounded-xl border border-border">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground">{current.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {current.source === TRANSCRIPTION_SOURCES.RECORDING ? "Recorded" : "Uploaded"}{" "}
            {formatDateTime(current.createdAt)}
            {current.durationSeconds !== null ? ` - ${formatDuration(current.durationSeconds)}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(current.status)}>{TRANSCRIPTION_STATUS_LABELS[current.status]}</Badge>

          {isCompleted ? (
            <Button type="button" variant="outline" size="sm" onClick={download} disabled={isPending}>
              <Download size={14} aria-hidden="true" />
              Download
            </Button>
          ) : null}
        </div>
      </div>

      <div className="p-5">
        {/* ------------------------------------------------------------
            Still working
            ------------------------------------------------------------ */}
        {isInFlight ? (
          <div role="status" className="flex flex-col items-center py-14 text-center">
            <Loader2 size={26} className="animate-spin text-primary" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-foreground">
              {TRANSCRIPTION_STATUS_LABELS[current.status]}
            </p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {STATUS_EXPLANATIONS[current.status]}
            </p>
            <p className="mt-4 max-w-sm text-xs text-muted-foreground">
              You can close this page. It carries on without you, and the transcript will be here when you come
              back.
            </p>
          </div>
        ) : null}

        {/* ------------------------------------------------------------
            Failed, or never finished uploading. The recording is kept for
            exactly these cases, so the offer to try again is a real one.
            ------------------------------------------------------------ */}
        {isFailed || isStalled ? (
          <div className="flex flex-col items-center py-14 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <TriangleAlert size={22} aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-medium text-foreground">
              {isStalled ? "The upload did not finish" : "This did not transcribe"}
            </p>
            <p className="mt-1 max-w-lg break-words text-sm text-muted-foreground">
              {isStalled
                ? "Nothing was handed to the transcription service. Try again, or delete this and upload the file once more."
                : (current.error ?? "")}
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-5"
              onClick={retryTranscription}
              disabled={isPending}
              loading={isPending}
            >
              <RefreshCw size={14} aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : null}

        {/* ------------------------------------------------------------
            Done
            ------------------------------------------------------------ */}
        {isCompleted ? (
          <Tabs defaultValue={current.summary ? "summary" : "transcript"}>
            <TabsList>
              <TabsTrigger value="summary">
                <Sparkles size={15} aria-hidden="true" />
                Summary
              </TabsTrigger>
              <TabsTrigger value="transcript">
                <FileText size={15} aria-hidden="true" />
                Transcript
              </TabsTrigger>
            </TabsList>

            <TabsContent value="summary">
              {current.summary ? (
                <>
                  {/* The summary is model output, so it goes through the
                      same renderer as a chat reply - React elements, never
                      an HTML string. See ModelMarkdown. */}
                  <ModelMarkdown content={current.summary} />
                  <p className="mt-6 border-t border-border pt-3 text-xs text-muted-foreground">
                    Written by the assistant from the transcript below. Check anything that matters against it.
                  </p>
                </>
              ) : (
                <div className="flex flex-col items-center py-10 text-center">
                  <p className="text-sm font-medium text-foreground">There is no summary</p>
                  <p className="mt-1 max-w-md text-sm text-muted-foreground">
                    {current.error ?? "The summary was not written."} The transcript is unaffected.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4"
                    onClick={retrySummary}
                    disabled={isPending}
                    loading={isPending}
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                    Write it now
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="transcript">
              <TranscriptBody detail={current} />
            </TabsContent>
          </Tabs>
        ) : null}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------
// The transcript itself.
//
// Rendered as speaker turns when the service could tell voices apart, and
// as plain text when it could not - a single microphone in a meeting room
// often produces one speaker for everybody, and pretending otherwise by
// labelling every line "Speaker 0" is worse than not labelling it.
//
// EVERY PIECE OF THIS IS A TEXT NODE. A transcript is a recording of what
// people said, so it is untrusted text in the same way a chat message is,
// and nothing here turns it into markup.
// -------------------------------------------------------------------
function TranscriptBody({ detail }: { detail: TranscriptionDetailDTO }) {
  if (!detail.transcript) {
    return <p className="py-10 text-center text-sm text-muted-foreground">There is no transcript.</p>;
  }

  const hasSpeakers = detail.segments.some((segment) => segment.speaker !== null);

  if (!hasSpeakers || detail.segments.length === 0) {
    return (
      <>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{detail.transcript}</p>
        <TranscriptFootnote />
      </>
    );
  }

  return (
    <>
      <ol className="space-y-4">
        {detail.segments.map((segment, index) => (
          // Index as the key: segments have no ids, and the list is
          // rendered once from an immutable transcript - it is never
          // reordered or spliced, which is what makes an index unsafe.
          <li key={index} className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <p className="text-xs font-medium text-muted-foreground">
              <span className="tabular-nums">{formatTimestamp(segment.startMs)}</span>{" "}
              {speakerLabel(segment.speaker)}
            </p>
            <p className="text-sm leading-relaxed text-foreground">{segment.text}</p>
          </li>
        ))}
      </ol>
      <TranscriptFootnote />
    </>
  );
}

function TranscriptFootnote() {
  return (
    <p className="mt-6 border-t border-border pt-3 text-xs text-muted-foreground">
      Transcribed automatically, so it will contain mistakes. Speakers are separated by voice and numbered - the
      service does not know who anybody is.
    </p>
  );
}
