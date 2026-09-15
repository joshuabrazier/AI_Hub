import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isStaleDeploymentError,
  noteIfStaleDeployment,
  probeForNewDeployment,
  registerDeploymentProbe,
} from "./deployment-probe";

// ===================================================================
// TURNING A REJECTED SERVER ACTION INTO A REASON TO LOOK
//
// This exists because of a production log: after a deploy, one action id was
// rejected over and over for seven minutes. Every one of those rejections was
// the tab being TOLD it was stale, and every one was thrown away - swallowed
// by a background poll that quite reasonably does not want to shout about a
// failed request.
//
// So the two things worth asserting are that the signal is recognised, and
// that recognising it can never blow up an ordinary error path.
// ===================================================================

afterEach(() => {
  // The registry is module state shared by every test in the file.
  registerDeploymentProbe(() => {})();
});

describe("isStaleDeploymentError", () => {
  it("recognises what Next.js actually says", () => {
    // The real message, verbatim from the production log. Matched on text
    // because it is all there is: the request is rejected before any
    // application code runs, so there is no error code to branch on.
    const error = new Error(
      'Failed to find Server Action "00fd2d1a3c47247440dd3646f37233b3f4f4b9b10". ' +
        "This request might be from an older or newer deployment.",
    );

    expect(isStaleDeploymentError(error)).toBe(true);
  });

  it("does not mistake an ordinary failure for a deploy", () => {
    // The cost of a false positive is a reload somebody did not ask for, so
    // anything that is merely a failed request must not qualify.
    expect(isStaleDeploymentError(new Error("Failed to fetch"))).toBe(false);
    expect(isStaleDeploymentError(new Error("NetworkError"))).toBe(false);
    expect(isStaleDeploymentError(null)).toBe(false);
    expect(isStaleDeploymentError(undefined)).toBe(false);
  });

  it("copes with a thrown non-Error", () => {
    // Anything can be thrown, and this runs inside catch blocks that until
    // now did nothing at all. Throwing from one would turn a handled failure
    // into an unhandled one.
    expect(isStaleDeploymentError("Failed to find Server Action \"abc\"")).toBe(true);
    expect(isStaleDeploymentError({ nope: true })).toBe(false);
  });
});

describe("noteIfStaleDeployment", () => {
  it("asks the watcher to look when the tab has been told it is stale", () => {
    const check = vi.fn();
    registerDeploymentProbe(check);

    noteIfStaleDeployment(new Error('Failed to find Server Action "abc".'));

    expect(check).toHaveBeenCalledOnce();
  });

  it("stays quiet for every other failure", () => {
    const check = vi.fn();
    registerDeploymentProbe(check);

    noteIfStaleDeployment(new Error("Failed to fetch"));

    expect(check).not.toHaveBeenCalled();
  });

  it("does nothing when no watcher is running", () => {
    // The watcher never starts in development, and mounts a beat after the
    // first render in production. Callers are ordinary catch blocks that must
    // not have to know either of those things.
    expect(() => noteIfStaleDeployment(new Error('Failed to find Server Action "abc".'))).not.toThrow();
    expect(() => probeForNewDeployment()).not.toThrow();
  });

  it("stops calling a watcher that has unmounted", () => {
    // The release function is returned rather than a general deregister, so
    // a watcher that unmounted after a newer one registered cannot unhook the
    // newer one on its way out.
    const check = vi.fn();
    const release = registerDeploymentProbe(check);

    release();
    noteIfStaleDeployment(new Error('Failed to find Server Action "abc".'));

    expect(check).not.toHaveBeenCalled();
  });
});
