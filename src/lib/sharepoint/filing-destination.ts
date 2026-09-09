// -------------------------------------------------------------------
// Which existing SharePoint folder should a meeting's notes go in?
//
// THE LIBRARY IS A MESS AND THAT IS THE DESIGN CONSTRAINT, not a caveat.
// Folders were made by people over years, names are inconsistent, and there
// is no scheme to follow. So this does not compute a path - it CHOOSES from
// the folders that actually exist, as inventoried by the crawl.
//
// THE FAILURE THAT MATTERS IS NOT "UNFILED", IT IS "WRONG CLIENT". A meeting
// note in a holding folder is untidy and fixed in ten seconds. The same note
// in another client's folder is a confidentiality problem: it is now sitting
// where people who should not read it will find it, and nobody is looking for
// it there. Every rule below prefers the first outcome.
//
// So: three tiers, most certain first, and a refusal at the end rather than a
// best guess.
//
//   1. EXACT-ish NAME MATCH on the client, using the same ladder
//      resolveNamed uses for Jira names - exact, case-insensitive, unique
//      prefix. Ambiguity is a MISS, not a coin toss.
//   2. A MODEL'S CHOICE, admitted only if it names a folder from the list it
//      was given. This is the tier that earns its keep on a messy library,
//      and it is also the one that can be confidently wrong - hence the
//      admission check and the reason travelling with it.
//   3. THE FALLBACK FOLDER. Known, boring, and safe.
//
// Pure, so all of that is testable without a tenant - which matters here
// because the folder structure this reasons about lives in somebody else's
// SharePoint and cannot be reproduced locally.
// -------------------------------------------------------------------

export interface CandidateFolder {
  // The Graph item id. What the upload actually addresses, and the only thing
  // a caller may act on.
  itemId: string;
  // Path relative to the drive root, for display and for the audit trail.
  path: string;
  // The leaf name, which is what a client name is matched against.
  name: string;
}

export type FilingDecision =
  | {
      kind: "matched";
      folder: CandidateFolder;
      // How it was chosen. Recorded and shown, because "we matched the client
      // name" and "a model thought this looked right" are different levels of
      // confidence and a reader has to be able to tell them apart.
      via: "client-name" | "model";
      reason: string | null;
    }
  | {
      kind: "fallback";
      folder: CandidateFolder;
      // Why nothing better was found. Always populated: a note in the holding
      // folder with no explanation is a puzzle for whoever finds it.
      reason: string;
    }
  | {
      // No fallback folder exists either, so nothing can be filed. The caller
      // leaves the transcription alone and says so rather than inventing a
      // folder - creating one is a write nobody asked for.
      kind: "nowhere";
      reason: string;
    };

function normalise(value: string): string {
  return value
    .trim()
    .toLowerCase()
    // Punctuation and doubled spaces are exactly the noise a hand-made folder
    // tree is full of: "Bowhill Engineering", "Bowhill Engineering ",
    // "Bowhill-Engineering". Stripped for MATCHING only; the real name is
    // always what gets displayed.
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// -------------------------------------------------------------------
// Tier 1: the client's name against the folder names.
//
// The same ladder as resolveNamed, and for the same reason: a near miss must
// be a miss. Two folders starting with "Data" is not an answer, it is a
// question, and answering it by picking one is how a note lands in the wrong
// place.
// -------------------------------------------------------------------
export function matchFolderByName(
  clientName: string | null | undefined,
  folders: readonly CandidateFolder[],
): { folder: CandidateFolder | null; ambiguous: CandidateFolder[] } {
  const wanted = normalise(clientName ?? "");

  if (!wanted) return { folder: null, ambiguous: [] };

  const exact = folders.filter((folder) => normalise(folder.name) === wanted);
  if (exact.length === 1) return { folder: exact[0], ambiguous: [] };
  if (exact.length > 1) return { folder: null, ambiguous: exact };

  // A folder whose name starts with the client's, or the other way round -
  // "Bowhill" against "Bowhill Engineering" and vice versa are both the same
  // client in practice.
  const partial = folders.filter((folder) => {
    const name = normalise(folder.name);
    return name.startsWith(wanted) || wanted.startsWith(name);
  });

  if (partial.length === 1) return { folder: partial[0], ambiguous: [] };

  return { folder: null, ambiguous: partial };
}

// -------------------------------------------------------------------
// Tier 2: admit a model's answer, or do not.
//
// The model is handed the candidate list and returns an ITEM ID from it. This
// checks that claim against the list it was actually given, exactly as
// admitOption does for the timesheet query box - because a shape check proves
// the value is a string, never that it is a folder anybody offered.
//
// An unoffered id is dropped and NAMED. Passing it through would address a
// Graph write at a folder nobody chose.
// -------------------------------------------------------------------
export function admitModelFolder(
  itemId: string | null | undefined,
  folders: readonly CandidateFolder[],
): CandidateFolder | null {
  if (!itemId) return null;

  return folders.find((folder) => folder.itemId === itemId) ?? null;
}

export function chooseFilingDestination(input: {
  clientName: string | null;
  folders: readonly CandidateFolder[];
  // What the model picked, when it was asked. Undefined when it was not -
  // tier 1 succeeding means the call is never made.
  modelFolderId?: string | null;
  modelReason?: string | null;
  fallback: CandidateFolder | null;
}): FilingDecision {
  const { clientName, folders, modelFolderId, modelReason, fallback } = input;

  const byName = matchFolderByName(clientName, folders);

  if (byName.folder) {
    return {
      kind: "matched",
      folder: byName.folder,
      via: "client-name",
      reason: clientName ? `Folder name matches the client, ${clientName}.` : null,
    };
  }

  const fromModel = admitModelFolder(modelFolderId, folders);

  if (fromModel) {
    return { kind: "matched", folder: fromModel, via: "model", reason: modelReason ?? null };
  }

  // Nothing landed. Say WHICH kind of nothing, because the remedies differ:
  // an ambiguous name is fixed by renaming a folder, an unoffered id is a
  // prompt problem, and no candidates at all means the crawl found nothing.
  const reason =
    folders.length === 0
      ? "No folders have been catalogued for this library yet."
      : byName.ambiguous.length > 0
        ? `"${clientName}" could be any of ${byName.ambiguous.map((folder) => folder.path).join(", ")}, so none was chosen.`
        : modelFolderId
          ? "The suggested folder was not one of the catalogued options, so it was not used."
          : clientName
            ? `No folder matches "${clientName}".`
            : "This meeting is not linked to a client.";

  if (!fallback) return { kind: "nowhere", reason };

  return { kind: "fallback", folder: fallback, reason };
}
