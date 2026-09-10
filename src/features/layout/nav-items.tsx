import {
  AudioLines,
  Briefcase,
  Building2,
  CalendarClock,
  ChartColumn,
  Clock,
  Coins,
  FileText,
  FolderCog,
  FolderKanban,
  FolderPlus,
  FlaskConical,
  FolderSearch,
  House,
  ListTodo,
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
  Wallet,
} from "lucide-react";

import { chatFeatureLabel, chatFeatureTooltip } from "@/lib/ai/assistant-identity";
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
      // DERIVED, NOT LITERAL. A deployment may name its assistant
      // (NEXT_PUBLIC_AI_ASSISTANT_NAME), and this is a base repo - so the
      // name must not be written down here. Named, this reads "Saga AI" and
      // "Chat with Saga"; unnamed, "AI chat" and "Chat with the assistant".
      // Both halves matter: the tooltip is one of the sentences
      // appKnowledgePrompt hands the assistant about its own app, so a
      // literal string here would have it telling people to open a menu
      // entry that no longer exists under that name.
      { label: chatFeatureLabel(), href: ROUTES.ADMIN_AI_CHAT, icon: Sparkles, tooltip: chatFeatureTooltip() },
      {
        label: "Transcription",
        href: ROUTES.ADMIN_TRANSCRIPTION,
        icon: AudioLines,
        tooltip: "Transcribe and summarise a meeting, and file the notes in SharePoint",
      },
      {
        label: "Summaries",
        href: ROUTES.ADMIN_SUMMARIES,
        icon: ScrollText,
        tooltip: "Summarise pasted text",
      },
    ],
  },
  {
    label: "People",
    items: [
      // FLAT, NOT A COLLAPSIBLE GROUP. It held Users and Teams; Teams went,
      // and a disclosure triangle that opens onto one link is a click for
      // nothing.
      {
        label: "Users",
        href: ROUTES.ADMIN_USERS,
        icon: Users,
        tooltip: "Everyone with an account, and pending invitations",
      },
    ],
  },
  // -------------------------------------------------------------------
  // DELIVERY, AND WHY IT IS ITS OWN GROUP RATHER THAN PART OF THE TWO IT
  // LOOKS LIKE IT BELONGS TO.
  //
  // It is not "Time and billing". That group is the Jira-era reporting
  // screens, which read a different table about work that has already been
  // logged somewhere else. Delivery is where the work is planned and the
  // hours are entered. Filing them together would put two things called
  // some version of "timesheet" under one parent, over two data sets, and
  // the first person to reconcile a figure between them would be comparing
  // the wrong two screens.
  //
  // It is not "Overview" either. Overview is Home plus the three AI
  // features, each of which is a tool somebody opens now and then. This is
  // the day job, and a group of its own is what says so.
  //
  // THE SPLIT INSIDE IT IS THE ACCESS MODEL SHOWING THROUGH. Projects and
  // the timesheet are top-level because MEMBERSHIP decides what they show,
  // not role - they are the same two entries in all three trees, and the
  // identical shape is deliberate. Everything under "Delivery admin" is
  // admin-only: a client is admin-only, a rate is a client's price and a pay
  // proxy, and the budget report is the one screen in the module carrying
  // money. Collapsing those four keeps this section three rows tall in the
  // ordinary case, the same decision Timesheets made below when five
  // siblings at the top level made it the longest thing in the sidebar.
  //
  // "Your timesheet" rather than "Timesheet", because time here is always
  // your own - no screen in the module offers to log an hour for somebody
  // else - and because it has to be told apart at a glance from
  // "Timesheets" under Time and billing.
  //
  // The tooltips are load-bearing beyond the sidebar: appKnowledgePrompt
  // generates what the assistant knows about this app from these entries,
  // so each one is written as a sentence a person could be given.
  // -------------------------------------------------------------------
  {
    label: "Delivery",
    items: [
      {
        label: "Projects",
        href: ROUTES.ADMIN_PROJECTS,
        icon: FolderKanban,
        tooltip: "The projects you are on, and their boards",
      },
      {
        label: "Your timesheet",
        href: ROUTES.ADMIN_TIMESHEET,
        icon: CalendarClock,
        tooltip: "Log your own week across every project you are on",
      },
      {
        label: "Delivery admin",
        icon: FolderCog,
        tooltip: "Clients, new projects, rates and budgets",
        children: [
          { label: "Clients", href: ROUTES.ADMIN_CLIENTS, icon: Building2, tooltip: "Who the work is for" },
          {
            label: "New project",
            href: ROUTES.ADMIN_PROJECT_NEW,
            icon: FolderPlus,
            tooltip: "Start a project for a client",
          },
          {
            label: "Rates",
            href: ROUTES.ADMIN_RATES,
            icon: Coins,
            tooltip: "Charge and cost rates for each person, by band and start date",
          },
          {
            label: "Budgets",
            href: ROUTES.ADMIN_DELIVERY_BUDGET,
            icon: Wallet,
            tooltip: "One project's budget against the time logged on it",
          },
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
          {
            label: "Clients",
            href: ROUTES.ADMIN_TIMESHEETS_CLIENTS,
            icon: Briefcase,
            tooltip: "Who the work is for, and their projects",
          },
          { label: "Staff", href: ROUTES.ADMIN_TIMESHEETS_STAFF, icon: UserRound, tooltip: "Hours and utilisation" },
          {
            label: "Outstanding",
            href: ROUTES.ADMIN_TIMESHEETS_OUTSTANDING,
            icon: ListTodo,
            tooltip: "Effort still to come, by project",
          },
          {
            label: "R&D",
            href: ROUTES.ADMIN_TIMESHEETS_RND,
            icon: FlaskConical,
            tooltip: "Core, supporting and non-R&D hours",
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
          {
            label: "SharePoint",
            href: ROUTES.ADMIN_SHAREPOINT,
            icon: FolderSearch,
            tooltip: "Catalogue a document library and set up filing",
          },
        ],
      },
    ],
  },
];

// -------------------------------------------------------------------
// Manager - the same shape as the admin area, but every screen is scoped to
// the projects they are a member of. No platform settings.
//
// NO "HOME" ITEM. /manage is a redirect to projects now that its teams
// landing page has gone, so a Home row would be a second way to reach the
// row directly under it.
// -------------------------------------------------------------------
const MANAGER_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: chatFeatureLabel(), href: ROUTES.MANAGE_AI_CHAT, icon: Sparkles, tooltip: chatFeatureTooltip() },
      {
        label: "Transcription",
        href: ROUTES.MANAGE_TRANSCRIPTION,
        icon: AudioLines,
        tooltip: "Transcribe and summarise a meeting, and file the notes in SharePoint",
      },
      {
        label: "Summaries",
        href: ROUTES.MANAGE_SUMMARIES,
        icon: ScrollText,
        tooltip: "Summarise pasted text",
      },
    ],
  },
  // The same two entries as the admin tree, in a group with the same name,
  // and nothing else in it. A manager is a member of projects like anybody
  // else; managing a team grants nothing on a project board.
  {
    label: "Delivery",
    items: [
      {
        label: "Projects",
        href: ROUTES.MANAGE_PROJECTS,
        icon: FolderKanban,
        tooltip: "The projects you are on, and their boards",
      },
      {
        label: "Your timesheet",
        href: ROUTES.MANAGE_TIMESHEET,
        icon: CalendarClock,
        tooltip: "Log your own week across every project you are on",
      },
    ],
  },
  {
    label: "Your work",
    items: [
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
      { label: chatFeatureLabel(), href: ROUTES.PORTAL_AI_CHAT, icon: Sparkles, tooltip: chatFeatureTooltip() },
      {
        label: "Transcription",
        href: ROUTES.PORTAL_TRANSCRIPTION,
        icon: AudioLines,
        tooltip: "Transcribe and summarise a meeting, and file the notes in SharePoint",
      },
      {
        label: "Summaries",
        href: ROUTES.PORTAL_SUMMARIES,
        icon: ScrollText,
        tooltip: "Summarise pasted text",
      },
      { label: "Account", href: ROUTES.PORTAL_ACCOUNT, icon: UserCircle, tooltip: "Your details" },
    ],
  },
  // Its own group here too, rather than two more rows under "Your portal".
  // For a member this is the day job, and a group heading is what separates
  // the work from the tools and the account details around it.
  {
    label: "Delivery",
    items: [
      {
        label: "Projects",
        href: ROUTES.PORTAL_PROJECTS,
        icon: FolderKanban,
        tooltip: "The projects you are on, and their boards",
      },
      {
        label: "Your timesheet",
        href: ROUTES.PORTAL_TIMESHEET,
        icon: CalendarClock,
        tooltip: "Log your own week across every project you are on",
      },
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
