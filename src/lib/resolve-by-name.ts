// ===================================================================
// A NAME TO AN ID, AGAINST A LIST THIS APP ACTUALLY READ
//
// The ladder: an exact id, then an exact name, then a unique
// case-insensitive name, then a unique prefix. Anything matching more than
// one thing is REFUSED and both candidates are named.
//
// WHY REFUSING BEATS GUESSING, which is the whole point of the ladder
// existing rather than a `.find()`. Nothing downstream is injectable -
// Kysely parameterises everything - so a wrong id does not break anything.
// It produces an answer that looks right: a filter on the wrong person, a
// project attached to the wrong client, a task assigned to the other Josh.
// Those get believed. A refusal gets read.
//
// IT RETURNS AN OUTCOME AND NOT A SENTENCE, deliberately. This started as
// one function inside the timesheet chat facts service, whose wording is
// specific to that job - "no client filter was applied", "logged time in
// this period" - and none of that means anything to somebody creating a
// project. Sharing the prose would have meant one of the two callers lying.
// So the ladder is shared and each caller says what a miss means to it.
//
// Pure, so both callers' rules are testable without a database.
// ===================================================================

export type NameCandidate = {
  // The id the caller is trying to reach. Matched against too: a caller that
  // knows the id is allowed to use it, and refusing one would be pedantry.
  id: string;
  name: string;
};

export type NameMatch =
  | { kind: "matched"; id: string; name: string }
  // More than one thing answers to this name. The candidates travel with it
  // so the caller can name them rather than saying "ambiguous".
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "none" };

export function matchByName(wanted: string, options: readonly NameCandidate[]): NameMatch {
  const trimmed = wanted.trim();

  if (!trimmed) return { kind: "none" };

  const byId = options.filter((option) => option.id.toLowerCase() === trimmed.toLowerCase());
  if (byId.length === 1) return { kind: "matched", id: byId[0].id, name: byId[0].name };

  const exact = options.filter((option) => option.name === trimmed);
  if (exact.length === 1) return { kind: "matched", id: exact[0].id, name: exact[0].name };

  const lower = trimmed.toLowerCase();

  const insensitive = options.filter((option) => option.name.toLowerCase() === lower);
  if (insensitive.length === 1) {
    return { kind: "matched", id: insensitive[0].id, name: insensitive[0].name };
  }

  // EXACT BEATS PREFIX, and the order above is what makes that true. With
  // "Perks" and "Perks Accounting" both on the list, an exact match on
  // "Perks" has to win before the prefix rule sees two candidates and
  // refuses the thing somebody named precisely.
  const prefix = options.filter((option) => option.name.toLowerCase().startsWith(lower));
  if (prefix.length === 1) return { kind: "matched", id: prefix[0].id, name: prefix[0].name };

  if (prefix.length > 1) {
    return { kind: "ambiguous", candidates: prefix.map((option) => option.name) };
  }

  return { kind: "none" };
}
