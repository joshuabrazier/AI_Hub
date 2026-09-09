import { describe, expect, it } from "vitest";

import { GIVE_UP_HOURS, MAX_ATTEMPTS, isAutoImportWindowClosed } from "./auto-import-window";

const HOUR = 60 * 60 * 1000;
const ENDED = new Date("2026-09-03T10:00:00.000Z");

describe("isAutoImportWindowClosed", () => {
  it("keeps trying while both bounds have room", () => {
    expect(
      isAutoImportWindowClosed({ attempts: 0, endsAt: ENDED, now: new Date(ENDED.getTime() + HOUR) }),
    ).toBe(false);
  });

  it("closes on the attempt that reaches the cap, not the one after", () => {
    // Otherwise a row on its last try needs one more sweep just to notice it
    // is finished, and spends a Graph call doing it.
    const now = new Date(ENDED.getTime() + HOUR);

    expect(isAutoImportWindowClosed({ attempts: MAX_ATTEMPTS - 2, endsAt: ENDED, now })).toBe(false);
    expect(isAutoImportWindowClosed({ attempts: MAX_ATTEMPTS - 1, endsAt: ENDED, now })).toBe(true);
  });

  it("closes on wall clock even when attempts have room", () => {
    // The case attempts alone cannot bound: the sweep stops for a day and
    // resumes, and a row sitting at two attempts would otherwise be retried
    // long after anybody cared.
    const now = new Date(ENDED.getTime() + (GIVE_UP_HOURS + 1) * HOUR);

    expect(isAutoImportWindowClosed({ attempts: 1, endsAt: ENDED, now })).toBe(true);
  });

  it("does not close early on a meeting that only just ended", () => {
    expect(
      isAutoImportWindowClosed({ attempts: 1, endsAt: ENDED, now: new Date(ENDED.getTime() + 60_000) }),
    ).toBe(false);
  });

  it("is not fooled by a meeting whose end is in the future", () => {
    // A calendar entry moved later while a row was already armed. Negative
    // elapsed time must not read as "long past".
    expect(
      isAutoImportWindowClosed({ attempts: 0, endsAt: ENDED, now: new Date(ENDED.getTime() - 5 * HOUR) }),
    ).toBe(false);
  });
});
