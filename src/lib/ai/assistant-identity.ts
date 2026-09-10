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
//
// IT LIVES IN src/lib/ai RATHER THAN IN THE CHAT FEATURE because the
// navigation reads it too, and the nav is what appKnowledgePrompt generates
// the assistant's knowledge of this app FROM. So the dependency has to run
// layout -> here, not layout -> a feature. Nothing in this file is
// server-only; it is read by client components and by the prompt builder.
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

/**
 * What the CHAT FEATURE is called - the sidebar entry, the page's heading,
 * the thread toolbar when nothing is open. "Saga AI" / "AI chat".
 *
 * A separate thing from the name itself, and the distinction earns its keep:
 * the assistant is called Saga, but a nav entry reading only "Saga" says
 * nothing about what the screen does to somebody who has not met it yet.
 * Hence the suffix, and hence "AI chat" rather than "Assistant" when there
 * is no name to put in front of it.
 *
 * IT FEEDS THE PROMPT AS WELL AS THE SIDEBAR. appKnowledgePrompt generates
 * what the assistant knows about this app from the nav entries, so this
 * string is also how it refers to its own page when telling somebody where
 * to find it.
 */
export function chatFeatureLabel(): string {
  return ASSISTANT_NAME === null ? "AI chat" : `${ASSISTANT_NAME} AI`;
}

/** The sidebar tooltip: "Chat with Saga" / "Chat with the assistant". */
export function chatFeatureTooltip(): string {
  return `Chat with ${assistantObject()}`;
}

/**
 * What every path says when there is no Bedrock key on the environment.
 *
 * Here rather than written out at each call site because there are FOUR of
 * them - the stream route, the attachment route, the service, and the
 * workspace's own empty state - and they were three identical literals plus
 * a heading before this. Three of the four are the text a person actually
 * sees when the feature is dead, so one of them drifting from the name in
 * the sidebar is exactly the case worth spending a function on.
 */
export function chatNotConfiguredMessage(): string {
  return `${chatFeatureLabel()} is not configured on this environment.`;
}
