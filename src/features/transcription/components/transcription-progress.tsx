import {
  TRANSCRIPTION_SOURCES,
  TRANSCRIPTION_STATUSES,
  type TranscriptionSource,
  type TranscriptionStatus,
} from "@/lib/data/kysely-database-types";
import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// How far along a running transcription is.
//
// WHY THIS IS STAGES AND NOT A PERCENTAGE, because that is a deliberate
// refusal rather than a shortcut. Azure batch transcription reports one of
// four states - not started, running, succeeded, failed - and no notion of
// how far through a file it is. There is no number to show.
//
// The alternative would be to invent one from elapsed time against a guess
// at how long the job should take. Plenty of software does exactly that,
// and it is worse than a spinner: it moves confidently to 90% and then sits
// there, so the one moment the reader most needs the truth is the moment
// the bar is lying to them. A bar that stops at 60% and stays there is at
// least telling them where it actually is.
//
// So this shows the stages the row genuinely moves through. They are real
// transitions, written to the database, and each one arriving is evidence
// that the thing is alive.
//
// A TEAMS IMPORT HAS ONLY ONE OF THEM, and gets its own list for that
// reason. It arrives with the transcript already stored - Teams did the
// transcribing - so drawing three steps with the first two filled in would
// claim credit for work this app never did, and would put the reader at
// "step 3 of 3" for the entire wait.
// -------------------------------------------------------------------

type Stage = {
  status: TranscriptionStatus;
  label: string;
  detail: string;
};

const STAGES: Stage[] = [
  {
    status: TRANSCRIPTION_STATUSES.QUEUED,
    label: "Queued",
    detail: "Waiting for the transcription service to pick this up.",
  },
  {
    status: TRANSCRIPTION_STATUSES.TRANSCRIBING,
    label: "Transcribing",
    detail: "Listening to the recording and separating the speakers. This is the long part.",
  },
  {
    status: TRANSCRIPTION_STATUSES.SUMMARISING,
    label: "Summarising",
    detail: "The transcript is saved. Writing the summary now.",
  },
];

// The whole of an import, as far as this app is concerned.
const TEAMS_STAGES: Stage[] = [
  {
    status: TRANSCRIPTION_STATUSES.SUMMARISING,
    label: "Summarising",
    detail: "The transcript came across from Teams. Writing the summary now.",
  },
];

export function TranscriptionProgress({
  status,
  source,
}: {
  status: TranscriptionStatus;
  source: TranscriptionSource;
}) {
  const stages = source === TRANSCRIPTION_SOURCES.TEAMS ? TEAMS_STAGES : STAGES;

  const currentIndex = stages.findIndex((stage) => stage.status === status);

  // A status that is not one of the running ones. Nothing to draw - the
  // caller only renders this while a job is in flight, and guessing at a
  // stage for anything else would put the bar in a state the row is not
  // actually in.
  if (currentIndex === -1) return null;

  const current = stages[currentIndex];

  return (
    <div className="w-full max-w-sm">
      <ol className="flex gap-1.5" aria-hidden="true">
        {stages.map((stage, index) => (
          <li key={stage.status} className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full",
                index < currentIndex && "bg-primary",
                // The current stage pulses. It is the only movement on the
                // screen, and without it a bar that will not change for
                // several minutes reads as a frozen page.
                index === currentIndex && "animate-pulse bg-primary",
                index > currentIndex && "w-0",
              )}
            />
          </li>
        ))}
      </ol>

      {/* The bar is decorative; this is what a screen reader announces, and
          it is polite rather than assertive so a stage change does not
          interrupt somebody mid-sentence. */}
      <p role="status" aria-live="polite" className="mt-3 text-sm font-medium text-foreground">
        {current.label}
        {/* Omitted when there is only one stage: "step 1 of 1" is not
            progress, it is noise beside a label that already says it. */}
        {stages.length > 1 ? (
          <span className="ml-1.5 font-normal text-muted-foreground">
            step {currentIndex + 1} of {stages.length}
          </span>
        ) : null}
      </p>

      <p className="mt-1 text-sm text-muted-foreground">{current.detail}</p>
    </div>
  );
}
