import { describe, expect, it } from "vitest";

import {
  admitModelFolder,
  chooseFilingDestination,
  matchFolderByName,
  type CandidateFolder,
} from "./filing-destination";

function folder(path: string): CandidateFolder {
  const name = path.split("/").pop() ?? path;
  return { itemId: `id:${path}`, path, name };
}

const CLIENTS = [
  folder("Clients/Bowhill Engineering"),
  folder("Clients/Trainer Suzie Swim School"),
  folder("Clients/Perks"),
  folder("Internal/AI"),
  folder("Internal/Operations"),
];

const FALLBACK = folder("Meetings/Unfiled");

// -------------------------------------------------------------------
// The whole module exists to prefer "unfiled" over "wrong client".
//
// A note in a holding folder is untidy and fixed in ten seconds. The same
// note in another client's folder is sitting where people who should not read
// it will find it, and nobody is looking for it there.
// -------------------------------------------------------------------
describe("matchFolderByName", () => {
  it("matches a client to its folder", () => {
    expect(matchFolderByName("Perks", CLIENTS).folder?.path).toBe("Clients/Perks");
  });

  it("ignores case, punctuation and stray spacing", () => {
    // Exactly the noise a hand-made folder tree is full of.
    expect(matchFolderByName("bowhill engineering", CLIENTS).folder?.path).toBe("Clients/Bowhill Engineering");
    expect(matchFolderByName("Bowhill-Engineering", CLIENTS).folder?.path).toBe("Clients/Bowhill Engineering");
    expect(matchFolderByName("  Trainer  Suzie   Swim School ", CLIENTS).folder?.path).toBe(
      "Clients/Trainer Suzie Swim School",
    );
  });

  it("matches a shorter client name against a longer folder, and the reverse", () => {
    expect(matchFolderByName("Bowhill", CLIENTS).folder?.path).toBe("Clients/Bowhill Engineering");
    expect(matchFolderByName("Perks Accounting Group", CLIENTS).folder?.path).toBe("Clients/Perks");
  });

  it("treats two plausible folders as a MISS and names them", () => {
    // The one that matters. Two folders that could each be the client is a
    // question, not an answer, and picking one is how a note lands in the
    // wrong client's folder.
    const messy = [folder("Clients/Acme Group"), folder("Clients/Acme Holdings")];

    const result = matchFolderByName("Acme", messy);

    expect(result.folder).toBeNull();
    expect(result.ambiguous.map((entry) => entry.path)).toEqual(["Clients/Acme Group", "Clients/Acme Holdings"]);
  });

  it("lets an EXACT match win over a longer one that also starts the same", () => {
    // Not ambiguity, and worth pinning: "Acme" beside "Acme Archive" is
    // answerable, because one of them is exactly the client. Treating that as
    // a tie would send a client's own notes to the holding folder every time
    // somebody made an archive folder next to theirs.
    const withArchive = [folder("Clients/Acme"), folder("Clients/Acme Archive")];

    expect(matchFolderByName("Acme", withArchive).folder?.path).toBe("Clients/Acme");
  });

  it("still refuses when two folders match exactly", () => {
    // Same leaf name in two places. Nothing can tell them apart, so nothing
    // should try.
    const duplicated = [folder("Clients/Acme"), folder("Archive/Acme")];

    expect(matchFolderByName("Acme", duplicated).folder).toBeNull();
  });

  it("finds nothing for a client with no folder", () => {
    expect(matchFolderByName("Somebody Else Ltd", CLIENTS).folder).toBeNull();
  });

  it("finds nothing when there is no client at all", () => {
    expect(matchFolderByName(null, CLIENTS).folder).toBeNull();
    expect(matchFolderByName("   ", CLIENTS).folder).toBeNull();
  });
});

describe("admitModelFolder", () => {
  it("admits an id from the list it was given", () => {
    expect(admitModelFolder("id:Internal/AI", CLIENTS)?.path).toBe("Internal/AI");
  });

  it("refuses an id nobody offered", () => {
    // A shape check proves it is a string, never that it is a folder anybody
    // offered. Passing it through would address a Graph write at a folder
    // nobody chose.
    expect(admitModelFolder("id:Clients/Invented", CLIENTS)).toBeNull();
    expect(admitModelFolder("../../Finance", CLIENTS)).toBeNull();
    expect(admitModelFolder("", CLIENTS)).toBeNull();
    expect(admitModelFolder(null, CLIENTS)).toBeNull();
  });
});

describe("chooseFilingDestination", () => {
  it("prefers a client-name match over the model, and says which", () => {
    // Tier 1 is more defensible than tier 2, so when both would answer the
    // stronger provenance is the one recorded - the same rule rnd_source
    // follows on the timesheet side.
    const decision = chooseFilingDestination({
      clientName: "Perks",
      folders: CLIENTS,
      modelFolderId: "id:Internal/AI",
      fallback: FALLBACK,
    });

    expect(decision).toMatchObject({ kind: "matched", via: "client-name" });
    expect(decision.kind === "matched" && decision.folder.path).toBe("Clients/Perks");
  });

  it("uses the model when the name matched nothing", () => {
    const decision = chooseFilingDestination({
      clientName: null,
      folders: CLIENTS,
      modelFolderId: "id:Internal/AI",
      modelReason: "An internal discussion about the AI features.",
      fallback: FALLBACK,
    });

    expect(decision).toMatchObject({ kind: "matched", via: "model" });
    expect(decision.kind === "matched" && decision.reason).toBe("An internal discussion about the AI features.");
  });

  it("falls back rather than guessing when the name is ambiguous", () => {
    const messy = [folder("Clients/Acme Group"), folder("Clients/Acme Holdings")];

    const decision = chooseFilingDestination({ clientName: "Acme", folders: messy, fallback: FALLBACK });

    expect(decision.kind).toBe("fallback");
    // And names both, so somebody can fix the folder tree rather than wonder.
    expect(decision.kind === "fallback" && decision.reason).toContain("Clients/Acme Holdings");
  });

  it("falls back when the model named a folder nobody offered, and says so", () => {
    const decision = chooseFilingDestination({
      clientName: null,
      folders: CLIENTS,
      modelFolderId: "id:Clients/Somewhere Else",
      fallback: FALLBACK,
    });

    expect(decision.kind).toBe("fallback");
    expect(decision.kind === "fallback" && decision.reason).toMatch(/not one of the catalogued options/);
  });

  it("explains an empty catalogue rather than blaming the meeting", () => {
    // The remedy is "run a crawl", which is nothing like "rename a folder",
    // so the two must not read the same.
    const decision = chooseFilingDestination({ clientName: "Perks", folders: [], fallback: FALLBACK });

    expect(decision).toMatchObject({ kind: "fallback" });
    expect(decision.kind === "fallback" && decision.reason).toMatch(/no folders have been catalogued/i);
  });

  it("files nowhere when there is not even a fallback", () => {
    // Nothing is uploaded and nothing is invented. Creating a folder is a
    // write nobody asked for.
    const decision = chooseFilingDestination({ clientName: "Nobody", folders: CLIENTS, fallback: null });

    expect(decision.kind).toBe("nowhere");
  });

  it("never returns a folder outside the offered list", () => {
    // The property the whole module is for, asserted directly: whatever comes
    // back is one of the folders that were handed in, or the fallback that
    // was handed in, and never anything else.
    const offered = new Set([...CLIENTS, FALLBACK].map((entry) => entry.itemId));

    for (const clientName of ["Perks", "Data Sagacity", null, "", "../../Finance"]) {
      for (const modelFolderId of [null, "id:Internal/AI", "id:nope", "../.."]) {
        const decision = chooseFilingDestination({
          clientName,
          folders: CLIENTS,
          modelFolderId,
          fallback: FALLBACK,
        });

        if (decision.kind !== "nowhere") expect(offered.has(decision.folder.itemId)).toBe(true);
      }
    }
  });
});
