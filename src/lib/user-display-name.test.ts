import { describe, expect, it } from "vitest";

import { userDisplayName } from "./user-display-name";

describe("userDisplayName", () => {
  it("prefers the preferred name", () => {
    expect(userDisplayName({ name: "Adelaide Lovelace", preferredName: "Ada" })).toBe("Ada");
  });

  it("falls back to the formal name when there is no preferred one", () => {
    expect(userDisplayName({ name: "Adelaide Lovelace", preferredName: null })).toBe("Adelaide Lovelace");
    expect(userDisplayName({ name: "Adelaide Lovelace" })).toBe("Adelaide Lovelace");
  });

  it("treats a blank or whitespace preferred name as unset", () => {
    // The reason the rule is `||` and not `??`: this is what a cleared text
    // input leaves behind, and a blank label is worse than a formal one.
    expect(userDisplayName({ name: "Adelaide Lovelace", preferredName: "" })).toBe("Adelaide Lovelace");
    expect(userDisplayName({ name: "Adelaide Lovelace", preferredName: "   " })).toBe("Adelaide Lovelace");
  });

  it("trims a preferred name that has padding around it", () => {
    expect(userDisplayName({ name: "Adelaide Lovelace", preferredName: "  Ada  " })).toBe("Ada");
  });

  it("returns the formal name exactly as stored", () => {
    // Matching admin-teams.mappers.ts, which never trimmed this half. The
    // check inside is only asking whether a name exists.
    expect(userDisplayName({ name: "  Adelaide Lovelace  ", preferredName: null })).toBe("  Adelaide Lovelace  ");
  });

  it("answers null for somebody with no name left, rather than a placeholder", () => {
    // De-identification rewrites the column in place, and a file or a time
    // entry belonging to a scrubbed account is still part of the record.
    expect(userDisplayName({ name: null, preferredName: null })).toBeNull();
    expect(userDisplayName({ name: "   ", preferredName: "  " })).toBeNull();
    expect(userDisplayName({})).toBeNull();
  });

  it("answers null for an absent person", () => {
    // A left join and a repository miss both arrive here, so neither caller
    // needs its own guard before asking.
    expect(userDisplayName(null)).toBeNull();
    expect(userDisplayName(undefined)).toBeNull();
  });

  it("still names somebody whose only name is the preferred one", () => {
    expect(userDisplayName({ name: null, preferredName: "Ada" })).toBe("Ada");
  });
});
