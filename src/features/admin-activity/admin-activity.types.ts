import { AUDIT_ACTIONS } from "@/lib/audit/audit-log.types";

// A single before -> after change on a plain (non-sensitive) field.
export type AuditFieldChange = { label: string; from: string; to: string };

// One row in the admin Activity table. Display-ready strings so the shared
// DataTable can search/sort/filter them directly, plus the expandable detail.
export type AuditLogEntryDTO = {
  id: string;
  createdAt: string; // ISO, for sorting
  createdAtLabel: string; // formatted for display
  actorName: string; // "System" when there's no actor
  actorRole: string; // role label, or "" when unknown
  action: string; // raw action key
  actionLabel: string; // friendly label
  category: string; // grouping for the Category filter
  summary: string; // human line, or ""
  // Scope. Both are soft references, so the named row may no longer exist -
  // hence the "(removed ...)" fallbacks rather than a blank.
  teamId: string; // "" when the event belongs to no team
  teamName: string; // resolved team name, or "" / "(removed team)"
  subjectUserId: string; // "" when the event is not about one person
  subjectUserName: string; // resolved name, or "" / "(removed user)"
  entityType: string;
  // Expandable detail:
  fieldChanges: AuditFieldChange[];
  ipAddress: string;
  userAgent: string;
  hasDetails: boolean; // whether there's anything to expand
};

// -------------------------------------------------------------------
// Friendly label + category per audit action.
//
// Keyed off AUDIT_ACTIONS rather than the literal strings so a rename in the
// vocabulary is a compile error here instead of a row that silently falls
// through to "Other". Every action in AUDIT_ACTIONS should have an entry.
//
// The categories are the Category filter's options, so keep them few and
// meaningful: they are how an admin narrows "who changed access" apart from
// "who signed in".
// -------------------------------------------------------------------
export const AUDIT_ACTION_META: Record<string, { label: string; category: string }> = {
  // Accounts
  [AUDIT_ACTIONS.USER_CREATED]: { label: "Account created", category: "Account" },
  [AUDIT_ACTIONS.USER_UPDATED]: { label: "Account updated", category: "Account" },
  [AUDIT_ACTIONS.USER_STATUS_CHANGED]: { label: "Account enabled/disabled", category: "Account" },
  [AUDIT_ACTIONS.USER_INVITED]: { label: "Person invited", category: "Account" },
  [AUDIT_ACTIONS.USER_INVITATION_CANCELLED]: { label: "Invitation cancelled", category: "Account" },
  [AUDIT_ACTIONS.USER_DEIDENTIFIED]: { label: "Data de-identified", category: "Retention" },

  // Access. A platform role and a team role both decide what somebody can
  // reach, so they share a category an admin can filter to on its own.
  [AUDIT_ACTIONS.USER_ROLE_CHANGED]: { label: "Role changed", category: "Access" },
  [AUDIT_ACTIONS.TEAM_MEMBER_ADDED]: { label: "Added to team", category: "Access" },
  [AUDIT_ACTIONS.TEAM_MEMBER_ROLE_CHANGED]: { label: "Team role changed", category: "Access" },
  [AUDIT_ACTIONS.TEAM_MEMBER_REMOVED]: { label: "Removed from team", category: "Access" },

  // Teams
  [AUDIT_ACTIONS.TEAM_CREATED]: { label: "Team created", category: "Teams" },
  [AUDIT_ACTIONS.TEAM_UPDATED]: { label: "Team updated", category: "Teams" },
  [AUDIT_ACTIONS.TEAM_STATUS_CHANGED]: { label: "Team enabled/disabled", category: "Teams" },

  // Documents
  [AUDIT_ACTIONS.DOCUMENT_SIGNED]: { label: "Document signed", category: "Documents" },

  // Authentication
  [AUDIT_ACTIONS.AUTH_SIGNED_IN]: { label: "Signed in", category: "Auth" },
  [AUDIT_ACTIONS.AUTH_SIGNED_OUT]: { label: "Signed out", category: "Auth" },
  [AUDIT_ACTIONS.AUTH_SIGN_IN_FAILED]: { label: "Failed sign-in", category: "Auth" },
  [AUDIT_ACTIONS.AUTH_PASSWORD_CHANGED]: { label: "Password changed", category: "Auth" },
  [AUDIT_ACTIONS.AUTH_IMPERSONATION_STARTED]: { label: "Impersonation started", category: "Auth" },
};

// An action with no entry still shows, labelled with its raw key. Hiding it
// would make the trail quietly incomplete, which is the one thing an audit
// viewer must never be.
export function auditActionMeta(action: string): { label: string; category: string } {
  return AUDIT_ACTION_META[action] ?? { label: action, category: "Other" };
}
