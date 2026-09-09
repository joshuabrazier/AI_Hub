// -------------------------------------------------------------------
// Which client is this meeting about, going only on its title?
//
// The filing decision has a deterministic first tier that matches a client's
// name against a folder name, and it needs a client to match with. A
// transcription has no client: it is a meeting somebody recorded or imported,
// and nothing links it to one.
//
// So this reads the title, which in practice is where the client's name
// actually is - "Bowhill catch-up", "Perks - Xero handover", "TSSS phase 2".
// That is a heuristic and it is treated as one.
//
// AMBIGUITY IS A MISS, AND SO IS A NEAR MISS. The whole filing feature is
// built to prefer an unfiled note over one in the wrong client's folder, and
// this is the tier most able to cause that: two clients named in one title,
// or a client whose name is a common word, are exactly how a note about one
// organisation ends up in another's folder. Both return nothing and let the
// model tier have a go instead.
//
// WORD BOUNDARIES MATTER MORE THAN THEY LOOK. A client called "Ace" would
// otherwise match "Spaces review", "replacement plan" and "interface work" -
// and the shorter the client name, the more of the calendar it swallows. So a
// name has to appear as whole words, and very short names are not matched at
// all.
//
// Pure, so all of that is testable without a database.
// -------------------------------------------------------------------

// Below this, a name is too generic to find in prose safely. Measured
// against the real client list: the shortest genuine names are four or five
// characters ("RWP", "Perks"), and three-letter strings appear inside
// ordinary English constantly.
const MIN_MATCHABLE_LENGTH = 4;

export interface ClientCandidate {
  id: string;
  name: string;
}

export type ClientFromTitle =
  | { kind: "matched"; client: ClientCandidate }
  // More than one client's name is in the title. Named rather than resolved:
  // "Perks and Bowhill joint call" is a real meeting and there is no correct
  // single answer to give it.
  | { kind: "ambiguous"; clients: ClientCandidate[] }
  | { kind: "none" };

// Lower case, punctuation to spaces, runs of space collapsed. Applied to
// both sides so "Trainer Suzie Swim School" matches "trainer-suzie swim
// school" - the same normalisation matchFolderByName uses, for the same
// reason: hand-typed names are inconsistent on exactly these axes.
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Whole-word containment. Both sides are already space-normalised, so
// padding with spaces turns "contains this substring" into "contains these
// whole words" without a regex built from user input.
function containsWords(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

export function clientFromTitle(title: string, clients: readonly ClientCandidate[]): ClientFromTitle {
  const haystack = normalise(title);

  if (!haystack) return { kind: "none" };

  const hits = clients.filter((client) => {
    const name = normalise(client.name);

    if (name.length < MIN_MATCHABLE_LENGTH) return false;

    return containsWords(haystack, name);
  });

  if (hits.length === 0) return { kind: "none" };

  if (hits.length === 1) return { kind: "matched", client: hits[0] };

  // -----------------------------------------------------------------
  // Several matched. One case is resolvable and the rest are not.
  //
  // A client whose name CONTAINS another client's - "Perks" and "Perks
  // Accounting" - is not really two answers: the longer name matching means
  // the title said the longer name, and the shorter one matched as a
  // fragment of it. So the longest wins, and only when it contains every
  // other hit.
  //
  // Anything else is two organisations mentioned in one title, which has no
  // single right answer and must not be given one.
  // -----------------------------------------------------------------
  const byLength = [...hits].sort((a, b) => normalise(b.name).length - normalise(a.name).length);
  const longest = byLength[0];
  const longestName = normalise(longest.name);

  const allNested = byLength
    .slice(1)
    .every((client) => containsWords(longestName, normalise(client.name)));

  if (allNested) return { kind: "matched", client: longest };

  return { kind: "ambiguous", clients: hits };
}
