import {
  AudioLines,
  Briefcase,
  ChartColumn,
  ClipboardCheck,
  Clock,
  FileText,
  House,
  LayoutPanelLeft,
  type LucideIcon,
  Mail,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserCircle,
  UserRound,
  Users,
  UsersRound,
} from "lucide-react";

import { ROUTES } from "@/lib/routes";
import { USER_ROLES, type UserRole } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Navigation
//
// One definition per area, keyed by the signed-in user's role. Each area is a
// separate tree rather than one tree with per-item visibility predicates: the
// three audiences see genuinely different products, and filtering a single
// list was how the old nav ended up with items that were visible to a role the
// route itself rejected.
//
// This drives DISPLAY only. Every route is independently guarded by the proxy
// and by its area layout, and every team-scoped query re-resolves the caller's
// teams from the session. Hiding a link is not access control.
// -------------------------------------------------------------------

export type NavLink = {
  label: string;
  href: string;
  icon: LucideIcon;
  tooltip: string;
};

/** A collapsible group of related links. */
export type NavCollapsible = {
  label: string;
  icon: LucideIcon;
  tooltip: string;
  children: NavLink[];
};

export type NavEntry = NavLink | NavCollapsible;

export function isCollapsible(entry: NavEntry): entry is NavCollapsible {
  return "children" in entry;
}

export type NavGroup = {
  label: string;
  items: NavEntry[];
};

// -------------------------------------------------------------------
// Admin - the whole product.
// -------------------------------------------------------------------
const ADMIN_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Home", href: ROUTES.ADMIN_DASHBOARD, icon: House, tooltip: "Home" },
      { label: "AI chat", href: ROUTES.ADMIN_AI_CHAT, icon: Sparkles, tooltip: "Chat with the assistant" },
      {
        label: "Transcription",
        href: ROUTES.ADMIN_TRANSCRIPTION,
        icon: AudioLines,
        tooltip: "Transcribe and summarise a meeting",
      },
    ],
  },
  {
    label: "People",
    items: [
      {
        label: "People",
        icon: UsersRound,
        tooltip: "Users and teams",
        children: [
          { label: "Users", href: ROUTES.ADMIN_USERS, icon: Users, tooltip: "Everyone with an account" },
          { label: "Teams", href: ROUTES.ADMIN_TEAMS, icon: LayoutPanelLeft, tooltip: "Teams and their members" },
        ],
      },
    ],
  },
  {
    label: "Time and billing",
    items: [
      {
        // Collapsed under one parent, like People. Five sibling links at the
        // top level made this the longest section in the sidebar.
        label: "Timesheets",
        icon: Clock,
        tooltip: "Time, jobs, staff and data quality",
        children: [
          {
            label: "Overview",
            href: ROUTES.ADMIN_TIMESHEETS,
            icon: ChartColumn,
            tooltip: "How the business is tracking",
          },
          { label: "Entries", href: ROUTES.ADMIN_TIMESHEETS_ENTRIES, icon: Clock, tooltip: "Every time entry" },
          { label: "Jobs", href: ROUTES.ADMIN_TIMESHEETS_JOBS, icon: Briefcase, tooltip: "The book of work" },
          { label: "Staff", href: ROUTES.ADMIN_TIMESHEETS_STAFF, icon: UserRound, tooltip: "Hours and utilisation" },
          {
            label: "Review",
            href: ROUTES.ADMIN_TIMESHEETS_REVIEW,
            icon: ClipboardCheck,
            tooltip: "Data to fix in Jira",
          },
        ],
      },
    ],
  },
  {
    label: "Settings",
    items: [
      {
        label: "Settings",
        icon: SlidersHorizontal,
        tooltip: "Site content, configuration and activity",
        children: [
          { label: "Home page", href: ROUTES.ADMIN_HOME_PAGE, icon: House, tooltip: "Edit the public home page" },
          { label: "Site content", href: ROUTES.ADMIN_CONTENT, icon: FileText, tooltip: "Edit public page content" },
          { label: "Emails", href: ROUTES.ADMIN_EMAILS, icon: Mail, tooltip: "Preview the emails the app sends" },
          {
            label: "Configuration",
            href: ROUTES.ADMIN_CONFIGURATIONS,
            icon: Settings,
            tooltip: "Manage the dropdown option lists",
          },
          { label: "Activity", href: ROUTES.ADMIN_ACTIVITY, icon: ScrollText, tooltip: "Audit trail" },
          {
            label: "AI requests",
            href: ROUTES.ADMIN_AI_CHAT_LOG,
            icon: Sparkles,
            tooltip: "What is sent to the model",
          },
          {
            label: "Data retention",
            href: ROUTES.ADMIN_DATA_RETENTION,
            icon: ShieldCheck,
            tooltip: "Review inactive accounts",
          },
        ],
      },
    ],
  },
];

// -------------------------------------------------------------------
// Manager - the same shape as the admin area, but every screen is scoped to
// the teams an admin assigned them to. No platform settings, no other teams.
// -------------------------------------------------------------------
const MANAGER_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Home", href: ROUTES.MANAGE, icon: House, tooltip: "Home" },
      { label: "AI chat", href: ROUTES.MANAGE_AI_CHAT, icon: Sparkles, tooltip: "Chat with the assistant" },
      {
        label: "Transcription",
        href: ROUTES.MANAGE_TRANSCRIPTION,
        icon: AudioLines,
        tooltip: "Transcribe and summarise a meeting",
      },
    ],
  },
  {
    label: "Your teams",
    items: [
      { label: "Teams", href: ROUTES.MANAGE_TEAMS, icon: LayoutPanelLeft, tooltip: "Teams you manage" },
    ],
  },
];

// -------------------------------------------------------------------
// Member - their own portal.
// -------------------------------------------------------------------
const MEMBER_NAV: NavGroup[] = [
  {
    label: "Your portal",
    items: [
      { label: "Home", href: ROUTES.PORTAL, icon: House, tooltip: "Home" },
      { label: "AI chat", href: ROUTES.PORTAL_AI_CHAT, icon: Sparkles, tooltip: "Chat with the assistant" },
      {
        label: "Transcription",
        href: ROUTES.PORTAL_TRANSCRIPTION,
        icon: AudioLines,
        tooltip: "Transcribe and summarise a meeting",
      },
      { label: "Account", href: ROUTES.PORTAL_ACCOUNT, icon: UserCircle, tooltip: "Your details" },
    ],
  },
];

// -------------------------------------------------------------------
// The nav for a role. An unrecognised role gets the member nav, matching
// roleHome: the least privileged option is the safe default.
// -------------------------------------------------------------------
export function navGroupsForRole(role: UserRole): NavGroup[] {
  switch (role) {
    case USER_ROLES.ADMIN:
      return ADMIN_NAV;
    case USER_ROLES.MANAGER:
      return MANAGER_NAV;
    case USER_ROLES.MEMBER:
      return MEMBER_NAV;
    default:
      return MEMBER_NAV;
  }
}
