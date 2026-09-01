"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Circle, Mic, MicOff, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { RECORDING_FORMAT_CANDIDATES, formatDuration } from "../transcription.types";
import {
  IDLE_CLOCK,
  durationSecondsOf,
  elapsedSeconds as elapsedSecondsOf,
  pauseClock,
  resumeClock,
  startClock,
  type ElapsedClock,
} from "./elapsed-clock";
import {
  appendChunk,
  beginRecording,
  completeRecording,
  discardRecording,
  isRecordingStoreAvailable,
} from "./recording-store";

// -------------------------------------------------------------------
// TranscriptionRecorder
//
// Record a meeting on the device, press stop, and hand the audio back.
// This component's whole job is producing a Blob; it does not upload, name
// or navigate, so it can sit inside whatever screen needs a recording.
//
// A MEETING CANNOT BE RECORDED TWICE, and everything awkward here follows
// from that. Chunks are written to IndexedDB as they arrive rather than
// only being accumulated in memory, so a crashed tab, a closed laptop or a
// stray refresh costs the last ten seconds instead of the whole meeting.
// See recording-store.ts.
//
// The rest is the same instinct: warn before an unload, keep the microphone
// stream in a ref rather than in state where a re-render could drop it, and
// release the track only once the recorder has handed over its final chunk.
//
// A PHONE LEFT ON A TABLE IS THE HARD CASE, and it breaks three different
// ways at once. All three are handled here:
//
//   1. THE SCREEN SLEEPS AND THE PAGE IS SUSPENDED. A backgrounded tab has
//      its timers throttled and, on iOS, is frozen outright - the recorder
//      stops receiving audio and the meeting is lost from that point. The
//      answer is a SCREEN WAKE LOCK, held for as long as a recording is
//      running. See the effect below for the part everybody gets wrong: the
//      browser drops the lock every time the page is hidden and does NOT
//      restore it, so it has to be asked for again on every return.
//
//   2. THE CLOCK UNDER-COUNTS. A setInterval in a background tab is
//      throttled to about once a minute, so a timer that counted its own
//      ticks reported a fraction of the real length - and that number is
//      what gets stored as the recording's duration. The elapsed time is
//      therefore read from the WALL CLOCK, which throttling cannot slow: a
//      late tick renders late, but it never counts short.
//
//   3. THE MICROPHONE IS TAKEN AWAY WITHOUT THE RECORDER FAILING. The OS
//      hands the input to a phone call or another app and the track simply
//      ends. Nothing here would have noticed: the timer kept counting and
//      the screen kept saying "Recording" over a device that had stopped
//      listening. A track that ends now stops the recording and says so,
//      keeping everything captured up to that moment.
// -------------------------------------------------------------------

// How often MediaRecorder is asked to hand over what it has, and therefore
// how much a crash can cost. Without a timeslice it holds the whole
// recording as one buffer and produces nothing at all until stop, so there
// would be nothing to persist and a crash would take the lot.
const CHUNK_INTERVAL_MS = 10_000;

type RecorderState = "idle" | "recording" | "paused";

// Whether this browser will record at all. Never changes within a page, so
// the store it is read from has nothing to subscribe to.
const subscribeToNothing = () => () => {};

const isRecordingSupported = () =>
  typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

// Whether this browser can keep the screen awake. Chrome, Edge, Android and
// Safari from 16.4 can; older iOS cannot, and there is that person told to
// keep the screen on themselves rather than left to find out afterwards.
const isWakeLockSupported = () => typeof navigator !== "undefined" && "wakeLock" in navigator;

// -------------------------------------------------------------------
// Why the microphone would not open.
//
// getUserMedia fails for several genuinely different reasons and reports
// which through DOMException.name, so collapsing them all into "access was
// refused" sends somebody to their browser settings when the microphone is
// really being held by Teams, or is not plugged in.
//
// The browser's own text is not shown - "NotAllowedError: Permission denied
// by system" is accurate and useless. These say what to go and do instead.
//
// The permission case names WINDOWS as well as the browser deliberately:
// "Let desktop apps access your microphone" is off on a lot of Windows 11
// machines, and when it is, the browser never gets to ask - so the site
// permission looks fine and the request fails anyway.
// -------------------------------------------------------------------
function microphoneFailureMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Microphone access was refused. Allow it for this site in your browser, and check that Windows privacy settings let desktop apps use the microphone.";

    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone was found. Check that one is connected and enabled in your sound settings.";

    case "NotReadableError":
    case "TrackStartError":
      return "The microphone is already in use. Close Teams, Zoom or anything else holding it, then try again.";

    case "OverconstrainedError":
      return "The microphone does not support the settings this needs. Try a different input device.";

    case "SecurityError":
      // getUserMedia is secure-context only. The support check above catches
      // this on most browsers, because navigator.mediaDevices is missing
      // entirely - but not all of them, so it is answered here too.
      return "Recording needs a secure connection. Open this page over HTTPS, or on localhost.";

    default:
      return "The microphone could not be opened. Check your browser and system sound settings, then try again.";
  }
}

function pickFormat(): { mimeType: string; extension: string } | null {
  // isTypeSupported is not on every implementation - older Safari has
  // MediaRecorder without it - so a missing function is treated as "cannot
  // tell", and the first candidate is tried rather than refusing outright.
  if (typeof MediaRecorder === "undefined") return null;

  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return { ...RECORDING_FORMAT_CANDIDATES[0] };
  }

  const supported = RECORDING_FORMAT_CANDIDATES.find((candidate) =>
    MediaRecorder.isTypeSupported(candidate.mimeType),
  );

  return supported ? { ...supported } : null;
}

export type FinishedRecording = {
  /** The id under which this is held on the device, so the caller can clear it once uploaded. */
  recordingId: string;
  media: Blob;
  extension: string;
  durationSeconds: number;
};

export function TranscriptionRecorder({
  onRecorded,
  defaultTitle,
  disabled,
}: {
  /** Called once, with the finished recording. The caller owns clearing it from the store. */
  onRecorded: (recording: FinishedRecording) => void;
  // A FUNCTION rather than a string, because the default name is built from
  // the current time. Computing that during render would produce different
  // markup on the server and the client and break hydration; calling it in
  // the event handler that starts a recording does not.
  //
  // Only used for the device-held copy, so that a recording recovered after
  // a crash has something to call itself. A recording that survives to the
  // upload is named from the field on screen.
  defaultTitle: () => string;
  disabled?: boolean;
}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // MediaRecorder is missing on some older browsers and, more often, on any
  // page not served over HTTPS - getUserMedia is a secure-context API. Said
  // once, up front, rather than as a failure after somebody has pressed
  // record and started talking.
  //
  // Read through useSyncExternalStore because this is a browser capability
  // and the server cannot know it. The server snapshot assumes support, so
  // the markup React hydrates against is the markup the server sent, and a
  // browser without it re-renders once straight afterwards. An effect that
  // set state instead would do the same thing a beat later and warn.
  const isSupported = useSyncExternalStore(subscribeToNothing, isRecordingSupported, () => true);
  // Assumed present on the server for the same reason as isSupported: the
  // markup React hydrates against has to be the markup the server sent.
  const canHoldScreenAwake = useSyncExternalStore(subscribeToNothing, isWakeLockSupported, () => true);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // The device-held copy this recording is being written to, and the next
  // chunk number. Refs because they are read inside the recorder's own
  // handlers, which close over the render that created them.
  const recordingIdRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);
  // Elapsed time. A ref rather than state because the recorder's own
  // handlers close over the render that created them and have to read the
  // clock as it stands at the moment of stopping, not as it stood then.
  //
  // The arithmetic lives in elapsed-clock.ts, pure and tested. See the note
  // at the top of that file for why this is derived from a clock reading
  // rather than counted in ticks - it is the difference between an
  // hour-long meeting recording its real length and recording two minutes.
  const clockRef = useRef<ElapsedClock>(IDLE_CLOCK);

  // The screen wake lock held while a recording is running. Null whenever
  // one is not held, including every moment the page is hidden - see the
  // effect below.
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // The elapsed clock. Driven by an interval rather than by the recorder,
  // which reports no timing of its own - but the interval only decides how
  // often the display REFRESHES. What it shows is read from the clock, so a
  // tab that was throttled in the background catches up on its next tick
  // instead of having silently lost the time.
  useEffect(() => {
    if (state !== "recording") return;

    const tick = () => setElapsedSeconds(elapsedSecondsOf(clockRef.current, performance.now()));

    const timer = setInterval(tick, 1000);

    return () => clearInterval(timer);
  }, [state]);

  // The unload guard. A browser will not let a page choose the wording, so
  // this is the standard "changes you made may not be saved" prompt - but
  // an accidental reload during a meeting is precisely the accident worth
  // one extra click to avoid.
  useEffect(() => {
    if (state === "idle") return;

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();

    window.addEventListener("beforeunload", warn);

    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  // -----------------------------------------------------------------
  // Keep the screen awake for as long as a recording is running.
  //
  // THIS IS THE FIX FOR A PHONE LEFT ON A TABLE. Without it the screen
  // sleeps, the page is backgrounded, and on iOS it is frozen outright -
  // the recorder stops receiving audio part-way through a meeting that
  // cannot be held again.
  //
  // THE RE-ACQUIRE IS THE PART THAT MATTERS. A wake lock is released by the
  // browser every time the page becomes hidden and is NOT restored when it
  // comes back, so asking once on start would protect only until the first
  // notification shade or app switch. It is asked for again on every
  // return to visibility.
  //
  // It is allowed to fail. Battery saver refuses it, and older iOS has no
  // wake lock at all - neither is a reason to stop somebody recording, so
  // the failure is logged and the screen tells them to keep the display on
  // themselves.
  //
  // Held while PAUSED as well as while recording: a paused recording is one
  // somebody intends to resume, and letting the phone sleep in between puts
  // them right back in the failure this exists to prevent.
  // -----------------------------------------------------------------
  const isActive = state !== "idle";

  useEffect(() => {
    if (!isActive) return;

    let cancelled = false;

    const acquire = () => {
      if (cancelled || !isWakeLockSupported()) return;

      navigator.wakeLock
        .request("screen")
        .then((sentinel) => {
          // The recording may have stopped while the request was in flight.
          if (cancelled) {
            void sentinel.release().catch(() => {});
            return;
          }

          wakeLockRef.current = sentinel;
        })
        .catch((error) => {
          // Battery saver, or a browser that has the API and refuses. Not
          // fatal - the recording carries on either way.
          console.warn("[recorder] the screen wake lock was refused", error);
        });
    };

    acquire();

    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);

      const held = wakeLockRef.current;
      wakeLockRef.current = null;
      // Nothing to do if this fails: the lock goes with the page anyway.
      void held?.release().catch(() => {});
    };
  }, [isActive]);

  // Unmounting mid-recording must not leave the microphone live. The
  // recording itself is lost either way - there is nothing to hand it to -
  // but a device still listening after its UI has gone is much worse.
  useEffect(() => releaseStream, [releaseStream]);

  const start = async () => {
    const format = pickFormat();

    if (!format) {
      toast.error("This browser cannot record audio. Upload a file instead.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Meeting audio, not music. All three help a room microphone
          // considerably and every one of them is a hint - a device that
          // does not implement them ignores the constraint rather than
          // failing, which is why they are not in a try of their own.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;
      chunksRef.current = [];

      clockRef.current = startClock(performance.now());

      // -------------------------------------------------------------
      // The microphone being taken away WITHOUT the recorder failing.
      //
      // A phone call arrives, another app grabs the input, a headset
      // disconnects, the OS reclaims it - the track ends and MediaRecorder
      // simply stops producing data. It does not error, so nothing here
      // would have noticed: the timer kept counting and the screen kept
      // saying "Recording" over a device that had stopped listening.
      //
      // Stopping through the recorder rather than tearing down directly is
      // deliberate - it flushes the last chunk, marks the device copy
      // complete and hands over what was captured, all through the path
      // that already works.
      // -------------------------------------------------------------
      for (const track of stream.getAudioTracks()) {
        track.addEventListener("ended", () => {
          const recorder = recorderRef.current;

          if (recorder && recorder.state !== "inactive") {
            recorderRef.current = null;
            recorder.stop();
          }

          toast.error(
            "Recording stopped because the microphone was taken away, usually a phone call or another app using it. Everything captured up to that point has been kept.",
          );
        });
      }

      // Held on the device from the first chunk. The id is generated here so
      // every chunk can be filed against it as it arrives, rather than at
      // stop - which is far too late to help anything that goes wrong
      // during the meeting.
      const recordingId = crypto.randomUUID();
      recordingIdRef.current = recordingId;
      sequenceRef.current = 0;

      const canPersist = isRecordingStoreAvailable();

      if (canPersist) {
        try {
          await beginRecording({
            id: recordingId,
            title: defaultTitle(),
            extension: format.extension,
            mimeType: format.mimeType,
            durationSeconds: 0,
            createdAt: Date.now(),
          });
        } catch (error) {
          // Recording still works without the safety net, so this warns
          // rather than refuses. Losing the net is much better than losing
          // the ability to record at all.
          console.warn("[recorder] could not open the local recording store", error);
          toast.warning("This recording cannot be saved on the device. Do not close the tab before it uploads.");
        }
      }

      const recorder = new MediaRecorder(stream, { mimeType: format.mimeType });

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size === 0) return;

        // Kept in memory as well, so the common path assembles without
        // touching the database at all.
        chunksRef.current.push(event.data);

        if (!canPersist) return;

        const seq = sequenceRef.current;
        sequenceRef.current += 1;

        // Deliberately not awaited: this fires on the recorder's own
        // schedule and must not hold it up. A write that fails is logged and
        // the in-memory copy still carries the recording through a normal
        // stop - what is lost is only the protection against a crash.
        appendChunk(recordingId, seq, event.data).catch((error) => {
          console.warn(`[recorder] could not persist chunk ${seq}`, error);
        });
      });

      recorder.addEventListener("stop", () => {
        // Assembled from the chunks rather than from the recorder, which
        // hands back nothing on stop. The type is the one that was
        // recorded, so the Blob describes itself correctly even though the
        // server derives its own from the filename.
        const media = new Blob(chunksRef.current, { type: format.mimeType });

        // Read BEFORE the clock is cleared, so the figure stored is the real
        // length of the meeting rather than the number of times a throttled
        // interval happened to fire.
        const durationSeconds = durationSecondsOf(clockRef.current, performance.now());

        clockRef.current = IDLE_CLOCK;

        chunksRef.current = [];
        releaseStream();
        setState("idle");
        setElapsedSeconds(0);

        if (media.size === 0) {
          toast.error("Nothing was recorded. Check that the microphone is working.");
          if (canPersist) void discardRecording(recordingId);
          return;
        }

        // Marked complete before it is handed on, so that if the upload
        // fails - or the tab dies between here and there - recovery finds a
        // finished recording rather than one that looks abandoned.
        if (canPersist) {
          completeRecording(recordingId, durationSeconds).catch((error) => {
            console.warn("[recorder] could not mark the recording complete", error);
          });
        }

        onRecorded({ recordingId, media, extension: format.extension, durationSeconds });
      });

      recorder.addEventListener("error", () => {
        clockRef.current = IDLE_CLOCK;
        releaseStream();
        setState("idle");
        // The chunks written so far are still in the device store and are
        // NOT cleared here, so the recovery panel on the composer offers
        // them back rather than the meeting being gone.
        toast.error("The recording stopped unexpectedly. What was captured is still on this device.");
      });

      recorderRef.current = recorder;
      recorder.start(CHUNK_INTERVAL_MS);

      setElapsedSeconds(0);
      setState("recording");
    } catch (error) {
      clockRef.current = IDLE_CLOCK;
      releaseStream();
      toast.error(microphoneFailureMessage(error));
    }
  };

  const togglePause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;

    if (state === "recording") {
      clockRef.current = pauseClock(clockRef.current, performance.now());

      recorder.pause();
      setState("paused");
      return;
    }

    clockRef.current = resumeClock(clockRef.current, performance.now());

    recorder.resume();
    setState("recording");
  };

  const stop = () => {
    // The blob is assembled in the stop handler above, not here - stopping
    // is asynchronous and the final chunk arrives after this returns.
    recorderRef.current?.stop();
    recorderRef.current = null;
  };

  if (!isSupported) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-border bg-muted/40 px-6 py-10 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <MicOff size={22} aria-hidden="true" />
        </span>
        <p className="mt-3 text-sm font-medium text-foreground">Recording is not available here</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          This browser will not give a page access to the microphone. Upload a file instead, or open this page
          in Chrome, Edge or Safari over a secure connection.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center rounded-xl border border-border px-6 py-10 text-center">
      <span
        className={
          state === "recording"
            ? "flex size-16 items-center justify-center rounded-full bg-destructive/10 text-destructive"
            : "flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary"
        }
      >
        {state === "recording" ? (
          // Pulses only while actually recording, so "paused" is visibly
          // different from "running" at a glance across a meeting room.
          <Circle size={26} className="animate-pulse fill-current" aria-hidden="true" />
        ) : (
          <Mic size={26} aria-hidden="true" />
        )}
      </span>

      {/* role="timer" marks this as elapsed time rather than a number, and
          carries an implicit aria-live of "off" - stated explicitly here
          because announcing it once a second is exactly what a screen
          reader must not do during an hour-long meeting. */}
      <p role="timer" aria-live="off" className="mt-4 font-mono text-2xl tabular-nums text-foreground">
        {formatDuration(elapsedSeconds)}
      </p>

      <p className="mt-1 text-sm text-muted-foreground">
        {state === "idle"
          ? "Press record, then leave this page open until the meeting ends."
          : state === "paused"
            ? "Paused. Nothing is being recorded."
            : canHoldScreenAwake
              ? "Recording, and saving to this device as it goes. The screen stays on."
              : "Recording, and saving to this device as it goes."}
      </p>

      {/* Only when the browser cannot keep the screen on itself - which is
          older iOS, and the exact case where a phone left on a table sleeps
          and stops recording. Said while it still matters rather than
          discovered afterwards, and only then, because a warning shown to
          everybody is one nobody reads. */}
      {isActive && !canHoldScreenAwake ? (
        <p
          role="status"
          className="mt-3 max-w-sm rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          This browser cannot keep the screen on by itself. Set your screen timeout to never, or check the
          phone every few minutes - if it sleeps, recording stops.
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {state === "idle" ? (
          <Button type="button" onClick={start} disabled={disabled}>
            <Mic size={16} aria-hidden="true" />
            Start recording
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={togglePause} disabled={disabled}>
              {state === "paused" ? "Resume" : "Pause"}
            </Button>
            <Button type="button" variant="destructive" onClick={stop} disabled={disabled}>
              <Square size={16} aria-hidden="true" />
              Stop and transcribe
            </Button>
          </>
        )}
      </div>

      {state === "idle" ? (
        <p className="mt-4 max-w-sm text-xs text-muted-foreground">
          The audio is saved on this device as you record, and uploaded when you press stop. If anything goes
          wrong, the recording is still here.
          {canHoldScreenAwake ? " The screen is kept awake while recording, so the phone will not sleep." : ""}
        </p>
      ) : null}
    </div>
  );
}
