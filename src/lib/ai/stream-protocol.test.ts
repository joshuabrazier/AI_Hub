import { describe, expect, it } from "vitest";

import { createStreamDecoder, encodeStreamEvent, type StreamEvent } from "./stream-protocol";

// -------------------------------------------------------------------
// The encoder and decoder are tested as a PAIR, because the property that
// matters is a round trip: whatever the model says has to come out the other
// end unchanged, including the characters that would break a framing chosen
// less carefully.
// -------------------------------------------------------------------

function roundTrip(events: StreamEvent[], chunkSize?: number): StreamEvent[] {
  const wire = events.map(encodeStreamEvent).join("");
  const decoder = createStreamDecoder();

  if (chunkSize === undefined) {
    return [...decoder.push(wire), ...decoder.flush()];
  }

  const out: StreamEvent[] = [];

  for (let index = 0; index < wire.length; index += chunkSize) {
    out.push(...decoder.push(wire.slice(index, index + chunkSize)));
  }

  return [...out, ...decoder.flush()];
}

describe("the stream protocol", () => {
  it("round-trips text, status and error events in order", () => {
    const events: StreamEvent[] = [
      { t: "status", v: "Compacting the conversation" },
      { t: "text", v: "Hello" },
      { t: "text", v: " there" },
      { t: "error", v: "It broke" },
    ];

    expect(roundTrip(events)).toEqual(events);
  });

  it("survives a reply containing newlines", () => {
    // THE REASON THIS IS JSON. A sentinel or a delimiter of our own choosing
    // cannot survive a model writing a paragraph break, and there is no
    // string a model will never produce.
    const events: StreamEvent[] = [{ t: "text", v: "One\n\nTwo\nThree" }];

    expect(roundTrip(events)).toEqual(events);
  });

  it("survives a reply that is itself NDJSON", () => {
    // Somebody asking the assistant about this very format. It has to come
    // back as text, not be re-read as framing.
    const events: StreamEvent[] = [{ t: "text", v: '{"t":"error","v":"not a real error"}\n' }];

    expect(roundTrip(events)).toEqual(events);
  });

  it("reassembles an object split across chunks", () => {
    // The network does not respect line boundaries. A one-byte chunk size is
    // the harshest version of the same problem.
    const events: StreamEvent[] = [
      { t: "text", v: "a fairly long fragment of an answer" },
      { t: "text", v: "and another one" },
    ];

    expect(roundTrip(events, 1)).toEqual(events);
    expect(roundTrip(events, 7)).toEqual(events);
  });

  it("holds a partial line over rather than dropping it", () => {
    const decoder = createStreamDecoder();

    expect(decoder.push('{"t":"text","v":"par')).toEqual([]);
    expect(decoder.push('tial"}\n')).toEqual([{ t: "text", v: "partial" }]);
  });

  it("surfaces a final line that arrived without a trailing newline", () => {
    const decoder = createStreamDecoder();

    expect(decoder.push('{"t":"text","v":"last"}')).toEqual([]);
    expect(decoder.flush()).toEqual([{ t: "text", v: "last" }]);
  });

  it("treats a blank line as nothing rather than as damage", () => {
    // A body ending in a newline produces one. Counting that as malformed
    // would report every healthy stream as broken.
    const decoder = createStreamDecoder();

    decoder.push('{"t":"text","v":"x"}\n\n');
    decoder.flush();

    expect(decoder.malformed).toBe(0);
  });

  it("drops a damaged line and keeps the ones after it", () => {
    // Throwing here would discard every valid event that followed, turning
    // one mangled line into a lost reply.
    const decoder = createStreamDecoder();

    const events = decoder.push('{"t":"text","v":"before"}\nnot json at all\n{"t":"text","v":"after"}\n');

    expect(events).toEqual([
      { t: "text", v: "before" },
      { t: "text", v: "after" },
    ]);
    expect(decoder.malformed).toBe(1);
  });

  it("rejects a well-formed object of the wrong shape", () => {
    // A proxy that mangles a line can still leave valid JSON behind, and
    // rendering `undefined` into somebody's reply is worse than a gap.
    const decoder = createStreamDecoder();

    const events = decoder.push('{"t":"text"}\n{"t":"nonsense","v":"x"}\n{"v":"x"}\n[]\n"str"\n');

    expect(events).toEqual([]);
    expect(decoder.malformed).toBe(5);
  });

  it("puts exactly one event on each line", () => {
    // The decoder's whole contract. An encoder that emitted a bare newline
    // or forgot one would break framing for everything after it.
    const line = encodeStreamEvent({ t: "text", v: "x\ny" });

    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1).includes("\n")).toBe(false);
  });
});
