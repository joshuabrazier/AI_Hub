import { SESSION_STATUS, type SessionStatus } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// The one place a session's status turns into colour.
//
// Everything here is a design token, so both themes and any later rebrand
// follow automatically - a literal palette colour would be right in light mode
// and wrong in dark, and would drift from the rest of the app the first time
// the brand moved.
//
// The card's left edge and its pill are kept together because they say the same
// thing; splitting them is how one ends up updated and the other forgotten.
// -------------------------------------------------------------------
export const STATUS_ACCENT_CLASSES: Record<SessionStatus, string> = {
  [SESSION_STATUS.SCHEDULED]: "border-l-primary",
  [SESSION_STATUS.COMPLETED]: "border-l-muted-foreground/40",
  [SESSION_STATUS.CANCELLED]: "border-l-destructive",
};

export const STATUS_PILL_CLASSES: Record<SessionStatus, string> = {
  [SESSION_STATUS.SCHEDULED]: "bg-primary/10 text-primary",
  [SESSION_STATUS.COMPLETED]: "bg-muted text-muted-foreground",
  [SESSION_STATUS.CANCELLED]: "bg-destructive/10 text-destructive",
};
