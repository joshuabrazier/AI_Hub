import { describe, expect, it } from "vitest";

import { USER_ROLES } from "@/lib/data/kysely-database-types";

import { appKnowledgePrompt } from "./ai-chat-app-knowledge";

// -------------------------------------------------------------------
// What the assistant is told about the app.
//
// The block is GENERATED from the navigation rather than written by hand, so
// these tests are not checking prose - they are checking the two properties
// that make generating it worthwhile:
//
//   1. It describes the screens that actually exist, so it cannot go stale.
//   2. It is filtered to the caller's role, so a member is never told about
//      an admin screen.
//
// The second is not access control - the tool's own session check is, and the
// nav's own header says hiding a link never counts. But describing a door
// somebody cannot open is a bad answer, and hinting at what is behind it is
// worse, so it is worth pinning.
// -------------------------------------------------------------------
describe("appKnowledgePrompt", () => {
  it("tells an admin about the admin screens, with their real paths", () => {
    const prompt = appKnowledgePrompt(USER_ROLES.ADMIN, "Louis D'Odorico");

    expect(prompt).toContain("/admin/timesheets");
    expect(prompt).toContain("/admin/timesheets/staff");
    // Renamed from "Jobs" - if this block were hand-written it would still
    // say the old name, which is the whole reason it is not.
    expect(prompt).toContain("/admin/timesheets/clients");
  });

  it("never mentions an admin path to a member", () => {
    const prompt = appKnowledgePrompt(USER_ROLES.MEMBER, "Someone");

    expect(prompt).not.toContain("/admin/");
    // Nor the manager area, which is equally not theirs.
    expect(prompt).not.toContain("/manage/");
  });

  it("never mentions an admin path to a manager", () => {
    const prompt = appKnowledgePrompt(USER_ROLES.MANAGER, "Someone");

    expect(prompt).not.toContain("/admin/");
  });

  it("addresses the person by name and states their role", () => {
    const prompt = appKnowledgePrompt(USER_ROLES.MEMBER, "Philipp Rohlfshagen");

    expect(prompt).toContain("Philipp Rohlfshagen");
  });

  it("copes with a user who has no name yet", () => {
    // Names come from Entra and are set at first sign-in, so a half-set-up
    // account really can reach this.
    const prompt = appKnowledgePrompt(USER_ROLES.MEMBER, null);

    expect(prompt).toContain("a signed-in user");
    expect(prompt).not.toContain("null");
  });

  it("carries the vocabulary that would otherwise be guessed at", () => {
    const prompt = appKnowledgePrompt(USER_ROLES.ADMIN, "Louis");

    // Client and project mean specific things here and are the exact pair a
    // model would otherwise use interchangeably.
    expect(prompt).toContain("A CLIENT is who work is for");
    expect(prompt).toContain("A PROJECT is what an invoice is written against");
    // Utilisation against CONTRACTED days, not a flat week - the single most
    // likely figure for a model to reason about wrongly.
    expect(prompt).toContain("not against a flat five-day week");
  });

  it("says what it cannot do, so it declines rather than attempts", () => {
    const prompt = appKnowledgePrompt(USER_ROLES.ADMIN, "Louis");

    expect(prompt).toContain("You cannot change anything");
    expect(prompt).toContain("never writes to Jira");
  });
});
