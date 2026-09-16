"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { AudioLines, ExternalLink, FileText, FolderOpen, Loader2, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { ModelMarkdown } from "@/components/model-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MESSAGES } from "@/lib/constants";
import {
  TRANSCRIPTION_FILING_STATUSES,
  TRANSCRIPTION_FILING_STATUS_LABELS,
  TRANSCRIPTION_IN_FLIGHT_STATUSES,
  TRANSCRIPTION_STATUSES,
  TRANSCRIPTION_STATUS_LABELS,
  TRANSCRIPTION_SOURCES,
  TRANSCRIPTION_SOURCE_LABELS,
} from "@/lib/data/kysely-database-types";
import { formatDateTime } from "@/lib/format";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import {
  downloadTranscriptAction,
  retryTranscriptionFilingAction,
  retryTranscriptionSummaryAction,
  startTranscriptionAction,
} from "../transcription.actions";
import {
  filingDecisionLabel,
  formatDuration,
  formatTimestamp,
  speakerLabel,
  type TranscriptionDetailDTO,
  type TranscriptionFilingDTO,
} from "../transcription.types";
import { canRetryByReencoding, TRANSCRIPTION_FAILURE_KINDS, type TranscriptionFailureKind } from "../transcription-failure";
import { FilingApproval } from "./filing-approval";
import { TranscriptionProgress } from "./transcription-progress";
import { REENCODE_STAGE_LABELS, useTranscriptionReencode } from "./use-transcription-reencode";

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

  // -------------------------------------------------------------------
  // File these notes now.
  //
  // Two cases behind one button. A filing that ended nowhere or failed is
  // terminal on purpose - the sweep does not retry those, because a folder
  // somebody deleted fails identically every few minutes forever - so a
  // person has to say try again. And a transcription older than the feature
  // has no filing record at all, which is every meeting anybody had recorded
  // before this shipped.
  //
  // It does not take a folder, and there is no way to give it one: the
  // destination is chosen by the same rules as an automatic filing, so a
  // retry cannot put a note somewhere those rules would refuse to.
  // -------------------------------------------------------------------
  const fileNow = () =>
    startTransition(async () => {
      try {
        const response = await retryTranscriptionFilingAction({ transcriptionId: current.id });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        // The outcome is not always success, and saying which is the point.
        // "Nowhere to file it" is a real answer that a green tick would
        // misreport, and the panel below carries the reason.
        if (response.data === TRANSCRIPTION_FILING_STATUSES.FILED) {
          toast.success("Filed in SharePoint.");
        } else if (response.data === null) {
          toast.error("SharePoint filing is not set up on this environment.");
        } else {
          toast.warning(TRANSCRIPTION_FILING_STATUS_LABELS[response.data]);
        }

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

  // A Teams import has no recording and never did - Teams transcribed the
  // meeting and only the text was fetched. Offering the button anyway would
  // hand somebody a download that 404s, which reads as a lost recording
  // rather than as one that never existed.
  const isStalled = current.status === TRANSCRIPTION_STATUSES.AWAITING_MEDIA;

  // -------------------------------------------------------------------
  // ===================================================================
  // A FAILURE IS NOT ONE THING, AND THE SCREEN USED TO TREAT IT AS ONE
  // ===================================================================
  //
  // Every failed transcription showed Azure's sentence and a button that
  // re-sent the identical file. For the commonest failure - the service
  // downloaded the recording and could not decode it - that button could
  // never work, and offering it was the app pretending to have something to
  // try when it did not.
  //
  // So a decode failure now CONVERTS THE RECORDING AND TRIES AGAIN, by
  // itself, before anybody is shown a dead end. Everything else keeps the
  // plain retry, plus a sentence saying what the message actually means.
  // -------------------------------------------------------------------
  const { reencode, stage: reencodeStage, progress: reencodeProgress, isReencoding } =
    useTranscriptionReencode();

  // A Teams import was never uploaded here, so there is no file to convert:
  // Teams transcribed the meeting and only the text was fetched.
  const hasConvertibleMedia = isFailed && current.source !== TRANSCRIPTION_SOURCES.TEAMS;

  // ALREADY CONVERTED ONCE IS THE END OF THE LADDER. Two decoders have now
  // refused it - Azure's and this browser's own, which produced the WAV -
  // so a third attempt would decode the same audio to the same samples and
  // be refused for the same reason.
  const canConvert = hasConvertibleMedia && !current.mediaWasReencoded;

  const shouldConvertAutomatically =
    canConvert && canRetryByReencoding(current.failureKind ?? TRANSCRIPTION_FAILURE_KINDS.OTHER);

  // Offered as a button for a failure nothing recognised, where converting
  // is a reasonable guess rather than the known answer - and deliberately
  // not run automatically, because it is minutes of somebody's laptop.
  const canConvertByHand = canConvert && current.failureKind === TRANSCRIPTION_FAILURE_KINDS.OTHER;

  const convertAndRetry = async () => {
    const updated = await reencode(current.id);

    if (!updated) return;

    setCurrent(updated);
    router.refresh();
  };

  // -------------------------------------------------------------------
  // Run it without being asked, once per row.
  //
  // The ref is what makes "once" true across the re-renders this causes:
  // the conversion finishes by replacing `current`, which re-runs this, and
  // a row that fails AGAIN after converting would otherwise start over. The
  // server-side guard is `mediaWasReencoded`; this is the one that holds
  // within a single visit, before that flag has come back.
  // -------------------------------------------------------------------
  const convertedAutomatically = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!shouldConvertAutomatically) return;
    if (convertedAutomatically.current.has(current.id)) return;

    convertedAutomatically.current.add(current.id);

    let cancelled = false;

    void (async () => {
      const updated = await reencode(current.id);

      // Navigated away mid-conversion. The work still landed on the server -
      // the row has been switched over and a job started - so there is
      // nothing to undo, only a component that must not write to state it no
      // longer owns.
      if (cancelled || !updated) return;

      setCurrent(updated);
      router.refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [shouldConvertAutomatically, current.id, reencode, router]);

  // -------------------------------------------------------------------
  // The sentence that says what to do, which the service's own message does
  // not. Null where there is nothing honest to add.
  // -------------------------------------------------------------------
  const failureGuidance = guidanceFor(current.failureKind, current.mediaWasReencoded, shouldConvertAutomatically);

  // AWAITING_MEDIA IS INCLUDED, and it is the case that matters most. A row
  // sitting there means the blob was committed but the job never started -
  // and once a job HAS started the device copy is discarded, so on a stalled
  // row the blob is frequently the only copy of that meeting left. Offering
  // no way to reach it was the difference between a recoverable upload and a
  // lost meeting.
  const hasRecording =
    current.source !== TRANSCRIPTION_SOURCES.TEAMS &&
    (current.transcript !== null || isFailed || isStalled);

  // Still awaiting media on a screen somebody is LOOKING at means the upload
  // did not finish - during a real upload the composer is what is on screen,
  // and the row is already queued by the time this opens. So it is offered
  // as something to retry rather than as progress: retrying re-checks
  // storage, which either finds the file and starts, or says plainly that it
  // never arrived.


  return (
    <div className="min-w-0 rounded-xl border border-border">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground">{current.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {TRANSCRIPTION_SOURCE_LABELS[current.source]} {formatDateTime(current.createdAt)}
            {current.durationSeconds !== null ? ` - ${formatDuration(current.durationSeconds)}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(current.status)}>{TRANSCRIPTION_STATUS_LABELS[current.status]}</Badge>

          {isCompleted ? (
            <Button type="button" variant="outline" size="sm" onClick={download} disabled={isPending}>
              <FileText size={14} aria-hidden="true" />
              Transcript
            </Button>
          ) : null}

          {/* A plain link, not a fetch. The response is a large streamed
              file, and letting the browser handle it means the download
              manager shows progress and can resume - where pulling it
              through JavaScript would buffer the whole recording in the
              tab before saving it.

              The route re-checks the session and the owner, so nothing is
              granted by this being an ordinary href. It 404s if the
              recording has aged out of the retention window. */}
          {hasRecording ? (
            <Button asChild type="button" variant="outline" size="sm">
              <a href={`/api/transcription/${current.id}/media`} download>
                <AudioLines size={14} aria-hidden="true" />
                Recording
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="p-5">
        {/* ------------------------------------------------------------
            Still working
            ------------------------------------------------------------ */}
        {isInFlight ? (
          <div className="flex flex-col items-center py-14 text-center">
            <TranscriptionProgress status={current.status} source={current.source} />

            <p className="mt-6 max-w-sm text-xs text-muted-foreground">
              You can close this page. The work carries on without you, and it will be collected the next time
              you open this screen.
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

            {/* ------------------------------------------------------------
                WHAT THAT MESSAGE ACTUALLY MEANS, and what is worth doing
                about it. Azure's own sentence names a URI and a kind, which
                is accurate and tells nobody whether to click the button, ring
                an administrator or give up. Only shown when there is
                something to add - an unclassified failure keeps its message
                and nothing else.
                ------------------------------------------------------------ */}
            {isFailed && failureGuidance ? (
              <p className="mt-2 max-w-lg text-sm text-muted-foreground">{failureGuidance}</p>
            ) : null}

            {/* ------------------------------------------------------------
                The conversion, while it runs. A progress bar for the upload,
                and a named stage for everything else - fetching a recording
                back and decoding it are minutes of apparent nothing, and a
                static spinner through that reads as a hung page.
                ------------------------------------------------------------ */}
            {isReencoding ? (
              <div className="mt-5 w-full max-w-sm">
                <p className="flex items-center justify-center gap-2 text-sm text-foreground">
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  {reencodeStage ? REENCODE_STAGE_LABELS[reencodeStage] : ""}
                </p>

                {reencodeProgress !== null ? (
                  <div
                    className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={reencodeProgress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Conversion upload progress"
                  >
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${reencodeProgress}%` }}
                    />
                  </div>
                ) : null}

                <p className="mt-2 text-xs text-muted-foreground">Keep this page open.</p>
              </div>
            ) : (
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={retryTranscription}
                  disabled={isPending}
                  loading={isPending}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  Try again
                </Button>

                {/* Offered by hand only where converting is a guess worth
                    making. Where it is the obvious answer it has already run
                    on its own, and where it cannot help it is not here. */}
                {canConvertByHand ? (
                  <Button type="button" variant="outline" onClick={convertAndRetry} disabled={isPending}>
                    <AudioLines size={14} aria-hidden="true" />
                    Convert and try again
                  </Button>
                ) : null}
              </div>
            )}
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

        {/* Shown on every completed transcription, not only on ones that
            have a filing record. A row with no record is the case somebody
            most needs a button for: it predates the feature, so nothing will
            ever file it on its own and there would be nothing on screen to
            say so. */}
        {isCompleted ? (
          <FilingNote
            transcriptionId={current.id}
            filing={current.filing}
            onFileNow={fileNow}
            isBusy={isPending}
          />
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

  // EITHER kind of speaker counts. A Teams import has real names and a null
  // in the numeric field, so testing only the number would render a
  // perfectly attributed transcript as one anonymous block of text.
  const hasSpeakers = detail.segments.some(
    (segment) => segment.speaker !== null || Boolean(segment.speakerName),
  );

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
              <span className="figure">{formatTimestamp(segment.startMs)}</span>{" "}
              {speakerLabel(segment)}
            </p>
            <p className="text-sm leading-relaxed text-foreground">{segment.text}</p>
          </li>
        ))}
      </ol>
      <TranscriptFootnote isNamed={detail.source === TRANSCRIPTION_SOURCES.TEAMS} />
    </>
  );
}

// -------------------------------------------------------------------
// What the reader needs to know about how this transcript was made.
//
// Two different sentences, because the two kinds of transcript carry
// genuinely different certainty about who said what. A Teams transcript has
// real names on it, taken from each participant's signed-in identity; every
// other one has voices this app told apart and numbered without knowing who
// anybody is. Printing the numbered caveat over a named transcript would
// undersell it, and the reverse would be a claim that is not true.
// -------------------------------------------------------------------
function TranscriptFootnote({ isNamed = false }: { isNamed?: boolean }) {
  return (
    <p className="mt-6 border-t border-border pt-3 text-xs text-muted-foreground">
      {isNamed
        ? "Transcribed automatically by Microsoft Teams, so it will contain mistakes. Speakers are named from who was signed in to the meeting."
        : "Transcribed automatically, so it will contain mistakes. Speakers are separated by voice and numbered - the service does not know who anybody is."}
    </p>
  );
}

// -------------------------------------------------------------------
// Where these notes went in SharePoint, and why.
//
// SHOWN RATHER THAN MERELY RECORDED, because a decision the reader cannot
// see the basis of cannot be checked. Three mechanisms of very different
// confidence choose the folder - the client's name matching a folder's, a
// model reading a library of inconsistently named folders, or a holding
// folder because nothing was certain - and the difference between them is
// the difference between "obviously right" and "worth a look".
//
// FOUR STATES, FOUR SENTENCES. "Not filed" and "could not be filed" are
// different problems with different remedies: the first is waiting on a
// person to decide something, the second on somebody to fix a permission.
// Collapsing them into one grey line is how a confidentiality question gets
// mistaken for a spinner that never stopped.
//
// The folder path is a SNAPSHOT from when the decision was made. Folders get
// renamed and moved; the link is the live answer and the path is the one we
// acted on.
// -------------------------------------------------------------------
function FilingNote({
  transcriptionId,
  filing,
  onFileNow,
  isBusy,
}: {
  transcriptionId: string;
  // Null means no filing record at all: filing is not configured, or this
  // transcription finished before the feature existed. Neither is a failure
  // and neither must read like one - but both need a way out, which is the
  // button.
  filing: TranscriptionFilingDTO | null;
  onFileNow: () => void;
  isBusy: boolean;
}) {
  const decision = filing ? filingDecisionLabel(filing.decidedVia) : null;

  const fileNowButton = (label: string) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="mt-3"
      onClick={onFileNow}
      disabled={isBusy}
      loading={isBusy}
    >
      <FolderOpen size={14} aria-hidden="true" />
      {label}
    </Button>
  );

  // No record. Offered rather than explained away: every meeting recorded
  // before this feature shipped is in this state, and without an offer they
  // stay that way forever with nothing on screen to say why.
  if (!filing) {
    return (
      <div className="mt-5 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          These notes have not been filed in SharePoint. That is normal for anything recorded before filing
          was set up.
        </p>
        {fileNowButton("File in SharePoint")}
      </div>
    );
  }

  if (filing.status === TRANSCRIPTION_FILING_STATUSES.PENDING) {
    return (
      <p className="mt-5 flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
        <Loader2 size={13} className="animate-spin" aria-hidden="true" />
        Working out where these notes should go.
      </p>
    );
  }

  // The two states that need a person, and they get the same panel: a
  // proposal to accept or replace, and a failed write to retry or redirect.
  // Splitting them into two components would duplicate the folder picker,
  // which is the part with the actual complexity in it.
  if (
    filing.status === TRANSCRIPTION_FILING_STATUSES.AWAITING_APPROVAL ||
    filing.status === TRANSCRIPTION_FILING_STATUSES.FAILED
  ) {
    return <FilingApproval transcriptionId={transcriptionId} filing={filing} />;
  }

  if (filing.status === TRANSCRIPTION_FILING_STATUSES.FILED) {
    return (
      <div className="mt-5 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <FolderOpen size={13} className="text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">Filed in</span>
          <span className="break-all font-medium text-foreground">{filing.folderPath ?? "SharePoint"}</span>

          {filing.fileWebUrl ? (
            <a
              href={filing.fileWebUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              Open
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          ) : null}
        </div>

        {/* The how and the why, together. Either alone is unfalsifiable. */}
        {decision ? <p className="mt-1.5 text-xs text-muted-foreground">{decision}</p> : null}
        {filing.reason ? (
          <p className="mt-0.5 break-words text-xs text-muted-foreground">{filing.reason}</p>
        ) : null}
      </div>
    );
  }

  // Only 'nowhere' reaches here, and it now means something narrower than it
  // used to: no library could be resolved. A person choosing a folder cannot
  // fix that, which is why this branch offers no picker - the remedy is an
  // administrator's, and the sentence says so.
  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="flex items-center gap-2 text-xs font-medium text-foreground">
        <TriangleAlert size={13} className="text-muted-foreground" aria-hidden="true" />
        These notes have not been filed
      </p>
      <p className="mt-1 break-words text-xs text-muted-foreground">
        {filing.reason ?? filing.error ?? "SharePoint filing is not set up."} The transcript is here either
        way.
      </p>

      {fileNowButton("Try again")}
    </div>
  );
}

// -------------------------------------------------------------------
// What the failure means, in terms of what to do next.
//
// SEPARATED BY WHO CAN FIX IT, because that is the only distinction that
// changes anybody's afternoon. A recording the service cannot decode is the
// app's problem and it is already converting it. A recording the service
// cannot REACH is an Azure role assignment, and no amount of clicking from
// a browser has ever moved one - telling somebody to try again there wastes
// their time and hides the real answer from whoever could act on it.
//
// Null for an unclassified failure. The service's own message is still
// shown above, and inventing an explanation for a message nothing here
// recognises would be worse than saying nothing.
// -------------------------------------------------------------------
function guidanceFor(
  kind: TranscriptionFailureKind | null,
  wasReencoded: boolean,
  isConvertingAutomatically: boolean,
): string | null {
  if (kind === TRANSCRIPTION_FAILURE_KINDS.UNREACHABLE) {
    return "The transcription service could not fetch the stored recording, which is a permissions problem on the storage account rather than anything wrong with your file. An administrator needs to give the Speech resource the Storage Blob Data Reader role. Your recording is safe and can be downloaded.";
  }

  if (kind === TRANSCRIPTION_FAILURE_KINDS.SERVICE_CREDENTIALS) {
    // A DIFFERENT PART OF AZURE from the storage case below, and naming the
    // wrong one costs whoever can fix it an afternoon in the wrong blade.
    return "The transcription service refused this app's credentials, which is a key or a subscription problem rather than anything wrong with your recording. An administrator needs to check the Speech resource key. Your recording is safe and can be downloaded.";
  }

  if (kind === TRANSCRIPTION_FAILURE_KINDS.UNUSABLE) {
    // The file is intact and has nothing to transcribe in it. Converting
    // would produce a smaller file with the same absence, so no retry is
    // offered and the sentence says why rather than leaving somebody
    // clicking a button that cannot work.
    return "There is no speech in this file for the service to find, so there is nothing further to try here. If you meant to record the meeting audio, check that the right source was being captured.";
  }

  if (kind === TRANSCRIPTION_FAILURE_KINDS.TOO_LARGE) {
    return "Nothing further can be done with this one here. If it is a screen or video recording, export the audio on its own and upload that instead - it is a fraction of the size.";
  }

  if (kind === TRANSCRIPTION_FAILURE_KINDS.UNDECODABLE) {
    if (wasReencoded) {
      // The end of the ladder, said plainly. Two independent decoders have
      // refused it, so the finding is about the recording rather than about
      // the format - and that is worth stating, because it is the answer to
      // "why does it play on my machine?" (a player reads what it can and
      // stops; a transcriber cannot).
      return "This recording was converted to plain uncompressed audio and the service still could not read it. Two different decoders have now refused it, which points at the recording itself being damaged rather than simply being in an awkward format. Download it and see how much of it will play.";
    }

    return isConvertingAutomatically
      ? "The service could not read that file, so it is being converted to plain uncompressed audio and sent again. Nothing is lost if this does not work - the original recording is kept."
      : "The service could not read that file. Converting it to plain uncompressed audio is the thing most likely to help.";
  }

  return null;
}
