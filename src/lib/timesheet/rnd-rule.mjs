// -------------------------------------------------------------------
// The R&D classification rule.
//
// PLAIN JAVASCRIPT ON PURPOSE, and this is the only file in src/lib written
// that way.
//
// The rule has two consumers that cannot share a module format: the sync,
// which is TypeScript, and scripts/backfill-rnd-classification.mjs, which is
// a node script and cannot import a .ts file on Node 20. It was duplicated
// between them, with a comment asking whoever changed one to change the
// other - and the first change after that comment was written updated one
// and not the other, which is exactly what such comments reliably fail to
// prevent.
//
// A backfill classifying hours by a different rule from the sync is a
// quiet, systematic wrong answer in a tax claim, so the two are now
// physically the same code. The types are carried in JSDoc, so TypeScript
// infers them across the import and jira-mapping.ts needs no cast.
// -------------------------------------------------------------------

// Jira labels are case-sensitive: "rnd-core" is a different label from
// "RnD-core". A near miss is a miss, and is reported as unclassified rather
// than quietly admitted - an hour wrongly left out of a claim is a smaller
// problem than an hour wrongly claimed.
export const RND_CORE_LABEL = "RnD-core";
export const RND_SUPPORTING_LABEL = "RnD-supporting";

/**
 * @param {string[]} labels the issue's labels, exactly as Jira sent them
 * @param {{ projectKey?: string | null, coreProjectKeys?: readonly string[] }} [options]
 *   Jira project keys whose work is core R&D by default. Passed in rather
 *   than read from the environment, so this stays pure and testable.
 * @returns {{
 *   rndClass: "core" | "supporting" | null,
 *   rndSource: "label" | "space" | null,
 *   hasBothLabels: boolean,
 * }}
 */
export function classifyRnd(labels, options = {}) {
  const hasCore = labels.includes(RND_CORE_LABEL);
  const hasSupporting = labels.includes(RND_SUPPORTING_LABEL);

  // Both labels on one item is a data entry error, not a third category. It
  // resolves to core - the more conservative reading is NOT the right
  // instinct, because whoever added the core label was asserting core. It is
  // surfaced either way so somebody fixes the item, rather than the number
  // being quietly decided here.
  if (hasCore && hasSupporting) return { rndClass: "core", rndSource: "label", hasBothLabels: true };
  if (hasCore) return { rndClass: "core", rndSource: "label", hasBothLabels: false };
  if (hasSupporting) return { rndClass: "supporting", rndSource: "label", hasBothLabels: false };

  // -----------------------------------------------------------------
  // No label. Only now does the space get a say.
  //
  // A LABEL ALWAYS WINS, and the ordering above is what guarantees it. An
  // item sitting in the R&D space and deliberately marked RnD-supporting
  // stays supporting: somebody said so, and a default that overruled them
  // would make the label pointless exactly where it matters most.
  //
  // So this fills a gap rather than overriding anybody, and an unlabelled
  // item in a space that exists for the R&D programme is far likelier to be
  // an oversight than a considered statement that the work is not R&D.
  // -----------------------------------------------------------------
  const { projectKey, coreProjectKeys } = options;

  if (projectKey && coreProjectKeys?.includes(projectKey)) {
    return { rndClass: "core", rndSource: "space", hasBothLabels: false };
  }

  return { rndClass: null, rndSource: null, hasBothLabels: false };
}
