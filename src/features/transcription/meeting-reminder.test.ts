import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamsMeetingSummary } from "@/lib/graph/teams-meetings";

// -------------------------------------------------------------------
// THE ALLOWLIST IS MOCKED, and that is the right call rather than a shortcut.
//
// isEmailDomainAllowed reads the VALIDATED server env, which is parsed once
// at import - so mutating process.env in a beforeEach reaches nothing, and
// the only way to vary it for real is vi.resetModules() plus a dynamic
// import, which throws away the whole module graph and costs a full reload
// per case. account-creation-policy.test.ts does exactly that and documents
// needing a 30 second timeout for it.
//
// Paying that here would also be testing the WRONG thing twice. Whether
// "evil-datasagacity.com.au" is allowed is that module's question and has
// its own tests. The question here is whether shouldRemind CONSULTS it and
// acts on the answer, which a mock states directly - and without it, these
// cases would quietly depend on whatever the machine running them happened
// to have in its environment.
// -------------------------------------------------------------------
const isEmailDomainAllowed = vi.fn<(email: string) => boolean>();

vi.mock("@/lib/auth/account-creation-policy", () => ({
  isEmailDomainAllowed: (email: string) => isEmailDomainAllowed(email),
}));

import {
  REMINDER_LOOKBACK_MINUTES,
  reminderMessage,
  reminderWindow,
  shouldRemind,
} from "./meeting-reminder";

// -------------------------------------------------------------------
// Which meetings earn a "turn the recording on" push.
//
// Every failure here is SILENT in production. A window that is too narrow
// sends nothing and looks exactly like a feature nobody has enabled; one
// that lets a finished meeting through nags somebody about a call they have
// already left. Neither throws, and neither shows up in a log unless
// somebody is looking for it.
// -------------------------------------------------------------------

const MINUTE = 60 * 1000;
const NOW = new Date("2026-09-15T09:00:00.000Z");

beforeEach(() => {
  // The ordinary case: an allowlist is configured and our own domain is on
  // it. Individual tests override this.
  isEmailDomainAllowed.mockReset();
  isEmailDomainAllowed.mockImplementation((email) => email.endsWith("@datasagacity.com.au"));
});

const meeting = (over: Partial<TeamsMeetingSummary> = {}): TeamsMeetingSummary => ({
  eventId: "event-1",
  subject: "Perks weekly",
  joinUrl: "https://teams.microsoft.com/l/meetup-join/abc",
  // Started a minute ago, runs for another half hour, organised by us.
  startsAt: new Date(NOW.getTime() - MINUTE),
  endsAt: new Date(NOW.getTime() + 29 * MINUTE),
  organiser: "joshua.brazier@datasagacity.com.au",
  ...over,
});

describe("reminderWindow", () => {
  it("looks BACKWARDS from now, because a timer cannot fire at a start time", () => {
    const { from, to } = reminderWindow(NOW);

    expect(to.getTime()).toBe(NOW.getTime());
    expect(from.getTime()).toBe(NOW.getTime() - REMINDER_LOOKBACK_MINUTES * MINUTE);
  });

  it("is wider than the timer interval, or a meeting between two runs is missed", () => {
    // The job is documented as running every minute or two. A window equal to
    // the interval leaves no margin for a slow run, a missed run or a deploy.
    expect(REMINDER_LOOKBACK_MINUTES).toBeGreaterThan(2);
  });
});

describe("shouldRemind", () => {
  it("sends for a meeting of ours that has just started", () => {
    expect(shouldRemind(meeting(), NOW)).toEqual({ send: true });
  });

  it("does NOT send before the start, because nobody can press record yet", () => {
    const soon = meeting({ startsAt: new Date(NOW.getTime() + 2 * MINUTE) });

    expect(shouldRemind(soon, NOW)).toEqual({ send: false, because: "not-started" });
  });

  it("still sends well into the window, because a partial recording beats none", () => {
    const eightMinutesIn = meeting({ startsAt: new Date(NOW.getTime() - 8 * MINUTE) });

    expect(shouldRemind(eightMinutesIn, NOW)).toEqual({ send: true });
  });

  it("stops sending once the meeting has fallen out of the window", () => {
    const old = meeting({
      startsAt: new Date(NOW.getTime() - (REMINDER_LOOKBACK_MINUTES + 1) * MINUTE),
    });

    expect(shouldRemind(old, NOW)).toEqual({ send: false, because: "too-old" });
  });

  it("does not nag about a meeting that has already ENDED", () => {
    // The short meeting that began and finished between two sweeps. Its start
    // is still in the window, so the window alone would let it through.
    const finished = meeting({
      startsAt: new Date(NOW.getTime() - 9 * MINUTE),
      endsAt: new Date(NOW.getTime() - MINUTE),
    });

    expect(shouldRemind(finished, NOW)).toEqual({ send: false, because: "already-over" });
  });

  it("skips a meeting organised outside our tenant, which cannot be transcribed at all", () => {
    // The transcript would belong to the client's tenant and we could never
    // fetch it, so the nudge asks for something undeliverable.
    const theirs = meeting({ organiser: "someone@aclient.com" });

    expect(shouldRemind(theirs, NOW)).toEqual({ send: false, because: "not-our-meeting" });
  });

  it("treats an event with NO organiser as not ours", () => {
    // Graph populates it for every real event, so an absent one is a shape we
    // do not understand. Guessing in favour of sending would nudge people
    // about calls they cannot record.
    expect(shouldRemind(meeting({ organiser: null }), NOW)).toEqual({
      send: false,
      because: "not-our-meeting",
    });
  });

  it("asks the allowlist about the ORGANISER, not about anybody else", () => {
    // The coupling worth pinning. Passing the wrong address would make the
    // filter answer a question nobody asked - and it would still look like a
    // working filter, because most of the time both are ours.
    shouldRemind(meeting({ organiser: "someone@aclient.com" }), NOW);

    expect(isEmailDomainAllowed).toHaveBeenCalledWith("someone@aclient.com");
  });

  it("sends whenever the allowlist says yes, however it decided", () => {
    // With no allowlist configured isEmailDomainAllowed answers true for
    // everything, which is how the rest of the app reads an unset one. This
    // states that shouldRemind inherits that rather than second-guessing it,
    // so the feature fails towards one notification too many rather than a
    // silence nobody can explain.
    isEmailDomainAllowed.mockReturnValue(true);

    expect(shouldRemind(meeting({ organiser: "someone@aclient.com" }), NOW)).toEqual({ send: true });
  });

  it("does not even ask the allowlist about a meeting that is already over", () => {
    // Order matters for cost as well as correctness: the cheap time checks
    // come first, so a sweep over a busy calendar is not doing string work
    // per event it was never going to send.
    const finished = meeting({ endsAt: new Date(NOW.getTime() - MINUTE) });

    shouldRemind(finished, NOW);

    expect(isEmailDomainAllowed).not.toHaveBeenCalled();
  });

  it("sends at exactly the start instant, which is the commonest case of all", () => {
    // Boundary, and the one a strict inequality would silently drop on a
    // sweep that happened to land on the second.
    expect(shouldRemind(meeting({ startsAt: NOW }), NOW)).toEqual({ send: true });
  });
});

describe("reminderMessage", () => {
  it("names the meeting, so the notification can be acted on without opening the app", () => {
    expect(reminderMessage("Perks weekly").body).toContain("Perks weekly");
  });

  it("asks for the action in TEAMS, because this app cannot start a recording", () => {
    // Teams is what announces a recording to the room, and a recording that
    // started without the room being told is not something this app will do.
    expect(reminderMessage("Perks weekly").body).toContain("Teams");
  });

  it("says what is lost by ignoring it, rather than only what to press", () => {
    expect(reminderMessage("Perks weekly").body).toContain("no transcript");
  });

  it("copes with an untitled meeting rather than rendering an empty gap", () => {
    expect(reminderMessage("   ").body).toContain("Your meeting");
  });
});
