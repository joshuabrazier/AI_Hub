// -------------------------------------------------------------------
// WHICH LIBRARY, before anything asks which folder.
//
// The crawl lets an admin nominate any number of document libraries, because
// inventorying several is useful. Filing INTO several is not - a meeting note
// belongs in one place - so this picks one, and refuses rather than guessing.
//
// It is the wrong-folder problem one level up. A note filed into the wrong
// library is in a place people who should not read it can reach, and nobody
// looking for it will think to check. So the same rule applies: ambiguity is
// named, not resolved.
//
// ONE NOMINATED LIBRARY NEEDS NO CONFIGURATION. Making somebody restate in
// an environment variable what they already chose in the UI is configuration
// that goes stale the first time it is not needed, and then misfiles
// everything when it is.
//
// Pure.
// -------------------------------------------------------------------

export interface FilingLibrary {
  driveId: string;
  siteName: string;
  driveName: string;
}

export type FilingLibraryChoice =
  | { kind: "chosen"; library: FilingLibrary }
  // Named rather than thrown, because every one of these is somebody's
  // configuration to fix and the message is the whole remedy.
  | { kind: "none"; reason: string };

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

// The two names a person could reasonably write: the library on its own, and
// the library qualified by its site for when two sites have a "Documents".
function namesFor(library: FilingLibrary): string[] {
  return [normalise(library.driveName), normalise(`${library.siteName} / ${library.driveName}`)];
}

export function chooseFilingLibrary(
  libraries: readonly FilingLibrary[],
  configuredName: string | null | undefined,
): FilingLibraryChoice {
  if (libraries.length === 0) {
    return {
      kind: "none",
      reason: "No SharePoint library has been nominated, so there is nowhere to file meeting notes.",
    };
  }

  const wanted = normalise(configuredName ?? "");

  // Nothing configured. One library is unambiguous; several is a question
  // only a person can answer.
  if (!wanted) {
    if (libraries.length === 1) return { kind: "chosen", library: libraries[0] };

    return {
      kind: "none",
      reason:
        `${libraries.length} SharePoint libraries are nominated ` +
        `(${libraries.map((library) => `${library.siteName} / ${library.driveName}`).join(", ")}), ` +
        "so SHAREPOINT_FILING_LIBRARY has to say which one to file into.",
    };
  }

  const matches = libraries.filter((library) => namesFor(library).includes(wanted));

  if (matches.length === 1) return { kind: "chosen", library: matches[0] };

  // A configured name matching two libraries means two sites have a library
  // of the same name, and the qualified "Site / Library" form is the fix.
  if (matches.length > 1) {
    return {
      kind: "none",
      reason:
        `SHAREPOINT_FILING_LIBRARY is "${configuredName}", which matches ` +
        `${matches.length} nominated libraries. Qualify it as "Site / Library".`,
    };
  }

  // Configured, and matching nothing. Almost always a library that was
  // removed from the nomination list, or a typo - and it must NOT quietly
  // fall through to "well, there is only one".
  return {
    kind: "none",
    reason:
      `SHAREPOINT_FILING_LIBRARY is "${configuredName}", which is not a nominated library. ` +
      `Nominated: ${libraries.map((library) => `${library.siteName} / ${library.driveName}`).join(", ")}.`,
  };
}
