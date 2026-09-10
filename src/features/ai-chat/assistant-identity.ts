import { BRAND } from "@/lib/brand";

// -------------------------------------------------------------------
// What to call the assistant.
//
// A deployment MAY name it (NEXT_PUBLIC_AI_ASSISTANT_NAME, surfaced as
// BRAND.assistantName) and may equally leave it unnamed. Both have to read
// correctly, and that is the whole reason this module exists: without it
// every piece of copy grows its own `?? "the assistant"`, and the first one
// somebody forgets prints "undefined can be wrong" under the composer.
//
// TWO FORMS, because English needs the article in one position and not the
// other. "Saga can be wrong" and "The assistant can be wrong" start a
// sentence; "summarised for Saga" and "summarised for the assistant" sit
// inside one. A single string cannot do both, and the version that tried
// gave us "Summarised for The assistant".
//
// Sentence-initial capitalisation is baked into `assistantSubject` rather
// than left to a CSS transform, because a NAME must not be recapitalised -
// text-transform would turn a deliberately lowercase name into something
// else, and capitalize would mangle one with an internal capital.
// -------------------------------------------------------------------

/** The configured name, or null when this deployment has not named it. */
export const ASSISTANT_NAME: string | null = BRAND.assistantName;

/** True when a name is configured. Use it to gate name-only copy. */
export const IS_ASSISTANT_NAMED: boolean = ASSISTANT_NAME !== null;

/**
 * For the START of a sentence: "Saga can be wrong." / "The assistant can be
 * wrong."
 */
export function assistantSubject(): string {
  return ASSISTANT_NAME ?? "The assistant";
}

/**
 * For the MIDDLE of a sentence: "summarised for Saga" / "summarised for the
 * assistant".
 */
export function assistantObject(): string {
  return ASSISTANT_NAME ?? "the assistant";
}
