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
  WandSparkles,
} from "lucide-react";

import { chatFeatureLabel, chatFeatureTooltip } from "@/lib/ai/assistant-identity";
import { ROUTES, projectBoardForRole } from "@/lib/routes";
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
  /**
   * Whether it starts open. Unset means "open when the current page is one of
   * its children", which is right for a group of OTHER screens - somewhere you
   * go occasionally, and which should not take up room until you do.
   *
   * It is wrong for a group that is the point of the sidebar. Projects start
   * open, because a list that is shut on every page except the ones already
   * inside it is a list nobody can navigate WITH.
   */
  defaultOpen?: boolean;
};

export type NavEntry = NavLink | NavCollapsible;

export function isCollapsible(entry: NavEntry): entry is NavCollapsible {
  return "children" in entry;
}

export type NavGroup = {
  label: string;
  items: NavEntry[];
  /**
   * Pinned to the BOTTOM of the rail, below the scrolling list and outside
   * it. For the entries somebody looks for by POSITION rather than by
   * reading - an account row is the standard example, and it is where every
   * other product puts one.
   *
   * Outside the scroll is the point. Last-in-the-list and pinned-to-the-
   * bottom are the same thing only while the nav is short enough to fit; add
   * a dozen projects and a list-ordered account row is somewhere below the
   * fold, which is exactly when somebody is hunting for it.
   */
  footer?: boolean;
};

// -------------------------------------------------------------------
// THE AI TOOLS, AS ONE GROUP.
//
// Chat, transcription and summaries were three sibling rows at the top of
// every tree, which is three of the first four things anybody saw and made
// the tools look like the app. They are a category, so they get a category's
// row and a disclosure triangle.
//
// WRITTEN ONCE RATHER THAN THREE TIMES, which is a departure from the rest of
// this file and is justified by these three being the ONE part of the nav
// that is genuinely identical in all three areas: same feature, same page,
// same words, only the area prefix differs. Everything else is repeated on
// purpose, because the three audiences see different products and a shared
// definition would invite a change meant for one of them to land in all
// three.
//
// IT IS NOT `defaultOpen`. Unset means it opens when you are already inside
// it, which is right for a group of tools somebody reaches for now and then -
// unlike Projects, which is the day job and starts open.
//
// The `label` is a plain "AI" rather than the assistant's name: the name
// belongs to the chat feature, and a deployment that names its assistant
// should not have that name label transcription and summaries too. The chat
// row underneath still carries it.
// -------------------------------------------------------------------
function aiTools(routes: { chat: string; transcription: string; summaries: string }): NavCollapsible {
  return {
    label: "AI",
    icon: WandSparkles,
    tooltip: "Chat, meeting transcription and text summaries",
    children: [
      // DERIVED, NOT LITERAL. A deployment may name its assistant
      // (NEXT_PUBLIC_AI_ASSISTANT_NAME), and this is a base repo - so the
      // name must not be written down here. Named, this reads "Saga AI" and
      // "Chat with Saga"; unnamed, "AI chat" and "Chat with the assistant".
      // Both halves matter: the tooltip is one of the sentences
      // appKnowledgePrompt hands the assistant about its own app, so a
      // literal string here would have it telling people to open a menu
      // entry that no longer exists under that name.
      { label: chatFeatureLabel(), href: routes.chat, icon: Sparkles, tooltip: chatFeatureTooltip() },
      {
        label: "Transcription",
        href: routes.transcription,
        icon: AudioLines,
        tooltip: "Transcribe and summarise a meeting, and file the notes in SharePoint",
      },
      {
        label: "Summaries",
        href: routes.summaries,
        icon: ScrollText,
        tooltip: "Summarise pasted text",
      },
    ],
  };
}

// -------------------------------------------------------------------
// Admin - the whole product.
// -------------------------------------------------------------------
const ADMIN_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Home", href: ROUTES.ADMIN_DASHBOARD, icon: House, tooltip: "Home" },
      aiTools({
        chat: ROUTES.ADMIN_AI_CHAT,
        transcription: ROUTES.ADMIN_TRANSCRIPTION,
        summaries: ROUTES.ADMIN_SUMMARIES,
      }),
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
  // It is not "Overview" either. Overview is Home plus the AI group, which
  // holds three tools somebody opens now and then. This is the day job, and
  // a group of its own is what says so.
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
        // "All" because the projects themselves are now listed in their
        // own group below - this is the overview and the way to the ones that
        // group does not carry.
        label: "All projects",
        href: ROUTES.ADMIN_PROJECTS,
        icon: FolderKanban,
        tooltip: "Every project you are on, with what is waiting for you",
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
      aiTools({
        chat: ROUTES.MANAGE_AI_CHAT,
        transcription: ROUTES.MANAGE_TRANSCRIPTION,
        summaries: ROUTES.MANAGE_SUMMARIES,
      }),
    ],
  },
  // The same two entries as the admin tree, in a group with the same name,
  // and nothing else in it. A manager is a member of projects like anybody
  // else; managing a team grants nothing on a project board.
  {
    label: "Delivery",
    items: [
      {
        // "All" because the projects themselves are now listed in their
        // own group below - this is the overview and the way to the ones that
        // group does not carry.
        label: "All projects",
        href: ROUTES.MANAGE_PROJECTS,
        icon: FolderKanban,
        tooltip: "Every project you are on, with what is waiting for you",
      },
      {
        label: "Your timesheet",
        href: ROUTES.MANAGE_TIMESHEET,
        icon: CalendarClock,
        tooltip: "Log your own week across every project you are on",
      },
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
      aiTools({
        chat: ROUTES.PORTAL_AI_CHAT,
        transcription: ROUTES.PORTAL_TRANSCRIPTION,
        summaries: ROUTES.PORTAL_SUMMARIES,
      }),
    ],
  },
  // Its own group here too, rather than two more rows under "Your portal".
  // For a member this is the day job, and a group heading is what separates
  // the work from the tools and the account details around it.
  {
    label: "Delivery",
    items: [
      {
        // "All" because the projects themselves are now listed in their
        // own group below - this is the overview and the way to the ones that
        // group does not carry.
        label: "All projects",
        href: ROUTES.PORTAL_PROJECTS,
        icon: FolderKanban,
        tooltip: "Every project you are on, with what is waiting for you",
      },
      {
        label: "Your timesheet",
        href: ROUTES.PORTAL_TIMESHEET,
        icon: CalendarClock,
        tooltip: "Log your own week across every project you are on",
      },
    ],
  },
  // -------------------------------------------------------------------
  // PINNED TO THE BOTTOM, and last in the array so it is also last in the
  // reading order for anything that flattens this tree - the mobile sheet
  // and appKnowledgePrompt both do.
  //
  // It sat between the AI tools and Delivery, which put a page somebody
  // opens twice a year in the middle of the two they open daily. The bottom
  // of a sidebar is where an account row is looked for.
  // -------------------------------------------------------------------
  {
    label: "Account",
    footer: true,
    items: [
      { label: "Account", href: ROUTES.PORTAL_ACCOUNT, icon: UserCircle, tooltip: "Your details" },
    ],
  },
];

// -------------------------------------------------------------------
// THE PERSON'S OWN PROJECTS, AS A GROUP OF THEIR OWN.
//
// The sidebar carried a "Projects" LINK and nothing else, so the projects
// somebody actually works on were two clicks away on every screen: open the
// list, then pick one. They are the thing this app is used for, and they were
// the only part of it the nav did not name.
//
// A GROUP, NOT A COLLAPSIBLE, and that is the whole reason this is not one
// line. A collapsible in this sidebar opens only when the active route is
// already inside it (`useState(childActive)` in sidebar.tsx), so a "Projects"
// disclosure would sit shut on every other page - which is exactly the
// screens where seeing them is worth anything. A group renders its items
// under a heading, always.
//
// ABSENT WHEN THERE ARE NONE. An empty heading is worse than no heading: it
// is a promise of something that is not there, and somebody on no projects
// already has the "Projects" link telling them so in words.
//
// EVERY ROUTE IS BUILT BY projectBoardForRole, never assembled here. The
// proxy REDIRECTS a role that lands in the wrong area rather than refusing
// it, so a hand-built /admin/projects/<id> followed by a member is not an
// error they can see - it is a link that quietly goes somewhere else.
//
// NOT CAPPED. The list is `getMyProjectsService` - memberships only, archived
// excluded - so it is the working set rather than everything, and a person's
// working set is a handful. Truncating it would hide a project with nothing
// on screen saying so, and the "All projects" link above covers the case
// where somebody wants the full list anyway.
// -------------------------------------------------------------------
export type NavProject = {
  id: string;
  title: string;
  clientName: string;
};

export function projectsNavGroup(role: UserRole, projects: readonly NavProject[]): NavGroup | null {
  if (projects.length === 0) return null;

  return {
    label: "Projects",
    items: [
      {
        label: "Projects",
        icon: FolderKanban,
        tooltip: "The projects you are on",
        // OPEN UNLESS SHUT BY HAND. The sidebar's own default is to open a
        // group only when you are already inside it, which for these would
        // mean the projects were hidden on every screen where seeing them is
        // worth anything.
        defaultOpen: true,
        children: projects.map((project) => ({
          label: project.title,
          href: projectBoardForRole(role, project.id),
          icon: FolderKanban,
          // The client, because two projects called "Website" for two clients
          // is the ordinary case and the label alone cannot tell them apart.
          // It is also what the row shows on hover, since a long title is
          // truncated to the width of the rail.
          tooltip: `${project.title} - ${project.clientName}`,
        })),
      },
    ],
  };
}

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
