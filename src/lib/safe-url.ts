// -------------------------------------------------------------------
// Protocol allowlist for links that came from somewhere untrusted.
//
// The attack this exists to stop is `[click me](javascript:...)`, which
// renders as an ordinary link and executes on this app's origin when
// somebody follows it. `data:` is just as bad - a data: URL can carry a
// whole HTML document - and `vbscript:` and `file:` are no better.
//
// An ALLOWLIST rather than a blocklist, because the set of things a link
// may safely be is small and known, and the set of things it may not be
// keeps growing.
//
// Relative URLs are allowed through: they have no protocol of their own,
// resolve against this origin, and cannot execute. The base below is a
// deliberately unusable hostname so that `new URL` can resolve them
// without any chance of it being mistaken for a real destination.
// -------------------------------------------------------------------
export const SAFE_URL_PROTOCOLS = ["http:", "https:", "mailto:", "tel:"];

const RELATIVE_URL_BASE = "https://relative.invalid";

/**
 * Returns the URL unchanged when its protocol is on the allowlist, and an
 * empty string when it is not. Callers treat "" as "render this as plain
 * text", so a rejected link never becomes a dead one that still looks
 * clickable.
 */
export function safeUrl(url: string): string {
  try {
    const parsed = new URL(url, RELATIVE_URL_BASE);

    return SAFE_URL_PROTOCOLS.includes(parsed.protocol) ? url : "";
  } catch {
    // Unparseable is not something to guess at.
    return "";
  }
}
