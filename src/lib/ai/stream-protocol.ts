// ===================================================================
// THE WIRE FORMAT FOR A STREAMED REPLY
//
// WHY THIS EXISTS, and it is a bug rather than a preference. The reply used
// to be sent as plain text, on the reasoning that one continuous answer has
// nothing to frame into events. That is true right up until the answer
// fails halfway through.
//
// A failure mid-stream cannot be an HTTP status: the 200 went out with the
// first byte, minutes ago. The old route handled it by calling
// controller.close(), which the browser cannot tell apart from a reply that
// finished - so a request that died at the two-thirds mark rendered as a
// short answer, silently, with nothing in the interface to say so. People
// reported that as "it just stops", and there was no way to distinguish it
// from a model that had genuinely finished early.
//
// A sentinel string in a text stream cannot fix that, because there is no
// string a model will never produce. Framing can. So: newline-delimited
// JSON, one object per line.
//
// THREE EVENT TYPES, and the third is the reason for the whole file:
//
//   text    a fragment of the answer, appended in order
//   status  what the server is doing right now, for the period before any
//           answer exists. A thirty-second wait reads as broken; the same
//           wait labelled "compacting the conversation" reads as working,
//           and this is the only channel that can say so.
//   error   it failed, and WHY - the phase, the timeline and the cause.
//           Delivered in-band precisely because the status code is long
//           gone.
//
// NDJSON RATHER THAN SSE. Server-sent events would work and are more
// standard, but they bring a framing (event:/data:/blank line), a reconnect
// protocol and an EventSource API whose behaviour on POST is awkward, in
// exchange for nothing this needs. One JSON object per line is decoded in
// four lines of client code and cannot collide with model output, because
// the payload is escaped by JSON.stringify.
// ===================================================================

export type StreamEvent =
  | { t: "text"; v: string }
  | { t: "status"; v: string }
  | { t: "error"; v: string };

export const STREAM_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

// -------------------------------------------------------------------
// One event, one line.
//
// JSON.stringify escapes newlines inside the payload, so a model that emits
// a paragraph break cannot end the line early. That property is the whole
// reason this is JSON and not a delimiter of our own choosing.
// -------------------------------------------------------------------
export function encodeStreamEvent(event: StreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

// -------------------------------------------------------------------
// The decoder, which is stateful because the network does not respect our
// line boundaries.
//
// TWO SEPARATE SPLITTING PROBLEMS, and getting either wrong looks like
// corruption rather than like a bug:
//
//   1. A chunk can end mid-line. The tail is held over until the rest
//      arrives, so a JSON object split across two TCP segments still parses.
//   2. A chunk can end mid-CHARACTER. That one is not handled here - it is
//      handled by decoding with TextDecoder({ stream: true }) before this
//      is called, which is why this takes a string and not bytes.
//
// A line that does not parse is DROPPED AND COUNTED rather than thrown,
// because throwing would discard every valid event that came after it. The
// count is returned so a caller can report it instead of silently rendering
// a reply with a hole in the middle.
// -------------------------------------------------------------------
export type StreamDecoder = {
  /** Events completed by this chunk. Incomplete tails are held over. */
  push(chunk: string): StreamEvent[];
  /** Call when the stream ends, to surface anything left in the buffer. */
  flush(): StreamEvent[];
  /** Lines that could not be parsed. Non-zero means the stream was damaged. */
  readonly malformed: number;
};

export function createStreamDecoder(): StreamDecoder {
  let buffer = "";
  let malformed = 0;

  const parseLine = (line: string): StreamEvent | null => {
    const trimmed = line.trim();

    // Blank lines are not an error. A writer that ends the body with a
    // newline produces one, and treating that as damage would report every
    // healthy stream as broken.
    if (trimmed.length === 0) return null;

    try {
      const parsed: unknown = JSON.parse(trimmed);

      if (!isStreamEvent(parsed)) {
        malformed += 1;
        return null;
      }

      return parsed;
    } catch {
      malformed += 1;
      return null;
    }
  };

  return {
    push(chunk) {
      buffer += chunk;

      const lines = buffer.split("\n");

      // The last element is whatever came after the final newline: either an
      // empty string, or a partial line to hold over.
      buffer = lines.pop() ?? "";

      return lines.flatMap((line) => {
        const event = parseLine(line);
        return event ? [event] : [];
      });
    },

    flush() {
      const remaining = buffer;
      buffer = "";

      const event = parseLine(remaining);

      return event ? [event] : [];
    },

    get malformed() {
      return malformed;
    },
  };
}

// Validated rather than cast. The body is our own server's, but a truncated
// or proxy-mangled line can still produce a well-formed JSON object of the
// wrong shape, and rendering `undefined` into a reply is worse than dropping
// the line.
function isStreamEvent(value: unknown): value is StreamEvent {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as { t?: unknown; v?: unknown };

  if (typeof candidate.v !== "string") return false;

  return candidate.t === "text" || candidate.t === "status" || candidate.t === "error";
}
