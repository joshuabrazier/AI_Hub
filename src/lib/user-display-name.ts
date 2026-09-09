// -------------------------------------------------------------------
// The one display-name rule.
//
// TAKEN FROM `src/features/admin-teams/admin-teams.mappers.ts` (and its
// identical twin in `manage-teams.mappers.ts`), which is the oldest and
// most-seen expression of it: `member.preferredName?.trim() || member.name`.
// It is matched here, not invented - the team screens are what everybody has
// already learnt the rule from, so anywhere else showing a different name is
// the thing that is wrong.
//
// It exists because the rule had drifted into four copies: two preferring the
// preferred name, two reading `users.name` straight off a join, and the
// symptom was one panel calling the same person "Ada" in its members list and
// "Adelaide Lovelace" against her time entries. One function, so the next
// disagreement is impossible rather than merely unlikely.
//
// `||` and NOT `??`, deliberately: a preferred name of "" or "   " is what a
// text input leaves behind when somebody clears the field, and it must fall
// through to the formal name rather than render as blank. `portal-account`
// stores an emptied field as NULL, but nothing guarantees every future writer
// will, and a screen is not the place to find out.
//
// DEPENDENCY-FREE ON PURPOSE. No "server-only", no imports: a client
// component that already holds a person's fields must be able to label them
// without a round trip, which is only true while this file stays pure.
// -------------------------------------------------------------------

// The fields a name can come from. Kept loose on `name` because the callers
// are not uniform: a `users` row has it NOT NULL, whereas a session user and
// a left-joined uploader both type it nullable.
type PersonNameFields = {
  name?: string | null;
  preferredName?: string | null;
};

/**
 * The name to show for a person: their preferred name if they have set one,
 * otherwise their formal name.
 *
 * The return type follows the input. Given a person whose `name` is known to
 * be present - a `users` row, a member join - it is a `string` and callers can
 * interpolate it. Given a person who may be absent or nameless, it is
 * `string | null`, and NULL survives rather than becoming a placeholder:
 * this app de-identifies dormant accounts IN PLACE, so a historical member can
 * own a perfectly valid row with nothing left to call them. "Unknown" is a
 * decision for the screen, which knows whether it is rendering a list item or
 * a sentence; manufacturing one here would take that choice away from every
 * caller at once.
 */
export function userDisplayName(person: { name: string; preferredName?: string | null }): string;
export function userDisplayName(person: PersonNameFields | null | undefined): string | null;
export function userDisplayName(person: PersonNameFields | null | undefined): string | null {
  const preferred = person?.preferredName?.trim();
  if (preferred) return preferred;

  // The formal name is returned AS STORED, not trimmed. `trim()` here only
  // answers "is there a name at all", because whitespace is not one; trimming
  // the value as well would quietly hand back a different string from the one
  // the team mappers have always shown.
  const formal = person?.name;

  return formal && formal.trim() ? formal : null;
}
