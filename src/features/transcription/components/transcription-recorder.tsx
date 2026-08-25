"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Circle, Mic, MicOff, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { RECORDING_FORMAT_CANDIDATES, formatDuration } from "../transcription.types";
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

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // The device-held copy this recording is being written to, and the next
  // chunk number. Refs because they are read inside the recorder's own
  // handlers, which close over the render that created them.
  const recordingIdRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);
  // Read inside the recorder's own stop handler, which closes over the
  // render it was created in - a ref is the only thing that reads back the
  // duration as it stands at the moment of stopping.
  const elapsedRef = useRef(0);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // The elapsed clock. Driven by an interval rather than by the recorder,
  // which reports no timing of its own.
  useEffect(() => {
    if (state !== "recording") return;

    const timer = setInterval(() => {
      setElapsedSeconds((seconds) => {
        elapsedRef.current = seconds + 1;
        return seconds + 1;
      });
    }, 1000);

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
      elapsedRef.current = 0;

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
        const durationSeconds = elapsedRef.current;

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
        releaseStream();
        setState("idle");
        toast.error("The recording stopped unexpectedly.");
      });

      recorderRef.current = recorder;
      recorder.start(CHUNK_INTERVAL_MS);

      setElapsedSeconds(0);
      setState("recording");
    } catch (error) {
      releaseStream();
      toast.error(microphoneFailureMessage(error));
    }
  };

  const togglePause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;

    if (state === "recording") {
      recorder.pause();
      setState("paused");
      return;
    }

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
            : "Recording, and saving to this device as it goes."}
      </p>

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
          The audio is saved on this device as you record, uploaded when you press stop, then deleted once the
          transcript is saved. If anything goes wrong, the recording is still here.
        </p>
      ) : null}
    </div>
  );
}
