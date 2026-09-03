import { describe, expect, it } from "vitest";

import { describeStreamFailureForTests } from "./ai-chat.service";

// -------------------------------------------------------------------
// Why a streamed reply stopped.
//
// A REGRESSION TEST FOR A REAL DIAGNOSIS THAT COST TIME. A production
// reply failed after 149,946ms with the recorded error "AbortError:
// Request aborted" - four words that name neither the cause nor the
// remedy. The only way anyone worked out it was a stall rather than a
// closed tab was noticing that the duration nearly matched
// CHAT_STALL_TIMEOUT_MS, which is a coincidence somebody spotted, not a
// diagnosis the system offered.
//
// The reason lives on the SIGNAL, because the AWS SDK throws its own
// generic AbortError and discards it. These pin that it is read from
// there.
// -------------------------------------------------------------------
function abortError(): Error {
  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
}

describe("describeStreamFailure", () => {
  it("reports the stall guard's own sentence, not the SDK's", () => {
    const controller = new AbortController();
    controller.abort(new Error("Nothing was received for 150 seconds, so the request was stopped."));

    expect(describeStreamFailureForTests(abortError(), controller.signal)).toBe(
      "Aborted: Nothing was received for 150 seconds, so the request was stopped.",
    );
  });

  it("names a reader who left, which is not a fault", () => {
    // An abort with no reason is the browser's own signal. Chasing this as
    // a bug is the afternoon the distinction exists to save.
    const controller = new AbortController();
    controller.abort();

    expect(describeStreamFailureForTests(abortError(), controller.signal)).toBe(
      "Aborted: the reader disconnected before the reply finished.",
    );
  });

  it("leaves a real model failure exactly as it was", () => {
    // A throttle or a bad key must keep its own name - that name IS the
    // remedy, and wrapping it would hide the one useful word.
    const throttle = new Error("Too many requests");
    throttle.name = "ThrottlingException";

    expect(describeStreamFailureForTests(throttle)).toBe("ThrottlingException: Too many requests");
  });

  it("does not claim an abort when nothing was aborted", () => {
    expect(describeStreamFailureForTests(abortError(), undefined)).toBe("AbortError: Request aborted");
  });

  it("copes with something thrown that is not an Error", () => {
    expect(describeStreamFailureForTests("went wrong")).toBe("went wrong");
  });
});
