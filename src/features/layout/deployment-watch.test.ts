import { describe, expect, it } from "vitest";

import {
  UNKNOWN_BUILD_ID,
  decideDeploymentAction,
  type DeploymentState,
} from "./deployment-watch";

// ===================================================================
// WHEN A STALE TAB RELOADS ITSELF
//
// THE FAILURE MODE THIS FILE EXISTS FOR IS A RELOAD LOOP. Everything else it
// can get wrong is a nuisance - a tab stays stale for another minute, or
// somebody has to press the Reload toast that already exists. A loop makes
// the app unusable and the only way out is closing the tab, so most of what
// is asserted here is about NOT reloading.
//
// The decision is pure precisely so it can be tested like this, with no
// timers, no fetch and no document.
// ===================================================================

const OLD = "build-one";
const NEW = "build-two";

function state(overrides: Partial<DeploymentState> = {}): DeploymentState {
  return {
    seenBuildId: OLD,
    currentBuildId: OLD,
    reloadedForBuildId: null,
    wouldLoseWork: false,
    ...overrides,
  };
}

describe("decideDeploymentAction", () => {
  it("does nothing while the build has not changed", () => {
    // The overwhelmingly common case, and the one that must be boring.
    expect(decideDeploymentAction(state())).toEqual({ action: "wait" });
  });

  it("adopts the first build it is told about rather than reloading for it", () => {
    // Only reachable when the server could not stamp its own build into the
    // page. Reloading here would mean reloading once on every page load.
    expect(decideDeploymentAction(state({ seenBuildId: null, currentBuildId: NEW }))).toEqual({
      action: "adopt",
      buildId: NEW,
    });
  });

  it("reloads a tab whose HTML came from a build that has already moved on", () => {
    // THE CASE THE SERVED-BY STAMP EXISTS FOR. A tab that loaded while a
    // deployment was rolling gets old HTML and a new first poll. Discovering
    // `seenBuildId` from that poll made it adopt the new id and stay exempt
    // for as long as it stayed open, holding action hashes the running server
    // rejects. Told what actually served it, it reloads on the first poll.
    expect(
      decideDeploymentAction(state({ seenBuildId: OLD, currentBuildId: NEW })),
    ).toEqual({ action: "reload", buildId: NEW });
  });

  it("reloads when the build has moved on", () => {
    expect(decideDeploymentAction(state({ currentBuildId: NEW }))).toEqual({
      action: "reload",
      buildId: NEW,
    });
  });

  // -----------------------------------------------------------------
  // The three guards, each of which on its own prevents a loop.
  // -----------------------------------------------------------------
  describe("not looping", () => {
    it("treats an unknown build as no information, never as a change", () => {
      // A failed poll, a blocked request, a deploy caught mid-flight. None of
      // them is evidence of anything, and throwing a page away on no evidence
      // is the worst thing this could do.
      expect(decideDeploymentAction(state({ currentBuildId: null }))).toEqual({ action: "wait" });
    });

    it("does not reload when the server answered but could not say which build", () => {
      // `next dev` has no BUILD_ID, and a deployment can fail to read its
      // own. Both answer UNKNOWN_BUILD_ID, which is "no information" exactly
      // like a failed poll - NOT a different build.
      //
      // This assertion was written the other way round first, matching what
      // the code did rather than what the comment beside it promised, and
      // the test name disagreed with its own expectation. Left unguarded, a
      // production tab that got one "unknown" answer would have thrown the
      // page away, and a deployment whose BUILD_ID became unreadable would
      // have done it to everybody at once.
      expect(decideDeploymentAction(state({ currentBuildId: UNKNOWN_BUILD_ID }))).toEqual({
        action: "wait",
      });
    });

    it("does not adopt an unknown build as the one this tab is running", () => {
      // The other half. Adopting "unknown" would make the tab compare every
      // real build id against it afterwards and reload on the next poll.
      expect(
        decideDeploymentAction(state({ seenBuildId: null, currentBuildId: UNKNOWN_BUILD_ID })),
      ).toEqual({ action: "wait" });
    });

    it("refuses to reload twice for the same build", () => {
      // THE GUARD THAT ACTUALLY STOPS A LOOP. If the tab reloaded for this
      // build and still does not think it is on it, more reloading cannot
      // help - so it stops and leaves the Reload toast in handle-errors.ts
      // to catch the click that eventually fails.
      expect(
        decideDeploymentAction(state({ currentBuildId: NEW, reloadedForBuildId: NEW })),
      ).toEqual({ action: "wait" });
    });

    it("still reloads for a build it has not tried yet", () => {
      // The guard is per build, not a permanent off switch: two deploys in a
      // row must both be picked up.
      expect(
        decideDeploymentAction(state({ currentBuildId: NEW, reloadedForBuildId: "build-zero" })),
      ).toEqual({ action: "reload", buildId: NEW });
    });
  });

  // -----------------------------------------------------------------
  // WHEN, given that it is going to.
  // -----------------------------------------------------------------
  describe("choosing its moment", () => {
    it("waits rather than throwing away something half-written", () => {
      // Not a softening of "reload automatically" - it is what makes an
      // automatic reload safe enough to do at all. Losing a half-written
      // message to save a click is a worse bug than the one being fixed,
      // and it would be the app doing it rather than the deploy.
      expect(
        decideDeploymentAction(state({ currentBuildId: NEW, wouldLoseWork: true })),
      ).toEqual({ action: "wait" });
    });

    it("reloads as soon as the work is gone", () => {
      // The wait is short by nature: the decision is re-made on every poll
      // and on every visibility change, so sending the message or clearing
      // the box is enough.
      expect(
        decideDeploymentAction(state({ currentBuildId: NEW, wouldLoseWork: false })),
      ).toEqual({ action: "reload", buildId: NEW });
    });

    it("protects work in a HIDDEN tab exactly as much as a visible one", () => {
      // This is the one that was wrong. A hidden tab reloaded immediately on
      // the reasoning that nobody is looking - but alt-tabbing away from a
      // half-written message hides the tab, and a recording, an upload or a
      // streaming reply all keep running in one. Looking something up in
      // another window was the way to lose your draft, and a meeting cannot
      // be recorded twice.
      //
      // Visibility is no longer an input at all: it prompts a re-check and
      // never overrides the answer. The state type not having the field is
      // the assertion; this is here so the reasoning has somewhere to live.
      expect(
        decideDeploymentAction(state({ currentBuildId: NEW, wouldLoseWork: true })),
      ).toEqual({ action: "wait" });
    });
  });
});
