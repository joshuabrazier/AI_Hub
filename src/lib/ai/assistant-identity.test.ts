import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// -------------------------------------------------------------------
// The assistant's name.
//
// WHAT IS ACTUALLY WORTH TESTING HERE is not that a getter returns a string.
// It is that BOTH configurations produce grammatical copy, because each one
// only ever appears on deployments that chose it - so a wording bug in the
// unnamed branch ships to every project built on this base and is invisible
// on the one that has a name set, and vice versa. Neither state fails; they
// just read wrong, which nothing else in the build can catch.
//
// The module reads its value at import time (BRAND is a const built from the
// environment), so each case sets the variable and re-imports with a reset
// registry rather than trying to mutate it afterwards.
// -------------------------------------------------------------------

const ORIGINAL = process.env.NEXT_PUBLIC_AI_ASSISTANT_NAME;

async function loadWithName(name: string | undefined) {
  vi.resetModules();

  if (name === undefined) delete process.env.NEXT_PUBLIC_AI_ASSISTANT_NAME;
  else process.env.NEXT_PUBLIC_AI_ASSISTANT_NAME = name;

  return import("./assistant-identity");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_AI_ASSISTANT_NAME;
  else process.env.NEXT_PUBLIC_AI_ASSISTANT_NAME = ORIGINAL;
});

describe("assistant identity, unnamed", () => {
  it("reports no name", async () => {
    const identity = await loadWithName(undefined);

    expect(identity.ASSISTANT_NAME).toBeNull();
    expect(identity.IS_ASSISTANT_NAMED).toBe(false);
  });

  it("carries the article, capitalised only at the start of a sentence", async () => {
    const identity = await loadWithName(undefined);

    // "The assistant can be wrong." / "summarised for the assistant"
    expect(identity.assistantSubject()).toBe("The assistant");
    expect(identity.assistantObject()).toBe("the assistant");
  });

  it("names the feature without inventing a name for the assistant", async () => {
    const identity = await loadWithName(undefined);

    // "Assistant" as a nav entry would read as a name this deployment never
    // chose, so an unnamed one describes the screen instead.
    expect(identity.chatFeatureLabel()).toBe("AI chat");
    expect(identity.chatFeatureTooltip()).toBe("Chat with the assistant");
  });
});

describe("assistant identity, named", () => {
  it("reports the configured name", async () => {
    const identity = await loadWithName("Saga");

    expect(identity.ASSISTANT_NAME).toBe("Saga");
    expect(identity.IS_ASSISTANT_NAMED).toBe(true);
  });

  it("drops the article in both positions", async () => {
    const identity = await loadWithName("Saga");

    // A name takes no article. "The Saga can be wrong" is the bug this
    // catches, and it is the one a single-string implementation produces.
    expect(identity.assistantSubject()).toBe("Saga");
    expect(identity.assistantObject()).toBe("Saga");
  });

  it("suffixes the feature label so a nav entry still says what it is", async () => {
    const identity = await loadWithName("Saga");

    // The assistant is Saga; the SCREEN is "Saga AI". A sidebar entry
    // reading only "Saga" tells somebody who has not met it nothing.
    expect(identity.chatFeatureLabel()).toBe("Saga AI");
    expect(identity.chatFeatureTooltip()).toBe("Chat with Saga");
  });

  it("never recapitalises the name it was given", async () => {
    // A name is somebody's choice, including its casing. Sentence-initial
    // position must not turn a deliberately lowercase or internally
    // capitalised name into something else.
    const lower = await loadWithName("saga");
    expect(lower.assistantSubject()).toBe("saga");

    const inner = await loadWithName("McSaga");
    expect(inner.assistantSubject()).toBe("McSaga");
  });
});
