import "server-only";

import sanitizeHtml from "sanitize-html";

// -------------------------------------------------------------------
// sanitizeRichText
// Strict allow-list sanitiser for admin-authored rich text before it is
// rendered with dangerouslySetInnerHTML. Only the tags the editor can
// produce are kept; links are limited to safe URL schemes and forced to
// rel="noopener noreferrer". Runs server-side only.
// -------------------------------------------------------------------
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "strong", "em", "u", "s",
    "h1", "h2", "h3", "h4",
    "ul", "ol", "li",
    "a", "blockquote", "code", "pre", "hr",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  // Drop, don't encode, anything outside the allow-list.
  disallowedTagsMode: "discard",
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
  },
};

export function sanitizeRichText(dirty: string): string {
  return sanitizeHtml(dirty, OPTIONS);
}
