import { describe, expect, it } from "vitest";

import { findClientByTypedName } from "./setup-client-picker";

// -------------------------------------------------------------------
// The rule that decides whether the client picker offers to CREATE a client
// or says one of that name already exists.
//
// It matters because of what the server does next: createProjectService
// resolves a typed name onto the client that already holds it rather than
// failing, so a name this says is new, and which is not, quietly attaches a
// project to an existing client's history. The screen's job is to make that
// reuse a choice, which it can only do if this agrees with the database.
//
// So the cases below are the two ways it can be wrong: missing a match the
// unique index would find, and inventing one it would not.
// -------------------------------------------------------------------
const CLIENTS = [
  { id: "client-perks", name: "Perks" },
  { id: "client-acme", name: "Acme Consolidated" },
];

describe("findClientByTypedName", () => {
  it("finds nothing for a name no client holds", () => {
    expect(findClientByTypedName(CLIENTS, "Wayland")).toBeUndefined();
  });

  it("matches the way the unique index does: trimmed, ignoring capitals", () => {
    expect(findClientByTypedName(CLIENTS, "  perks ")?.id).toBe("client-perks");
    expect(findClientByTypedName(CLIENTS, "PERKS")?.id).toBe("client-perks");
  });

  it("is EXACT, so a near miss is a miss", () => {
    // "Perk" and "Perkses" are different clients as far as the index is
    // concerned, and offering to reuse either would attach a project to a
    // client nobody named.
    expect(findClientByTypedName(CLIENTS, "Perk")).toBeUndefined();
    expect(findClientByTypedName(CLIENTS, "Perkses")).toBeUndefined();
    expect(findClientByTypedName(CLIENTS, "Acme")).toBeUndefined();
  });

  it("treats an empty or blank box as nothing typed", () => {
    expect(findClientByTypedName(CLIENTS, "")).toBeUndefined();
    expect(findClientByTypedName(CLIENTS, "   ")).toBeUndefined();
  });
});
