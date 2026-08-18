import Link from "next/link";
import { Briefcase, ClipboardCheck, Clock, Download, UserRound, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import PortalPage from "@/features/layout/portal-page";
import { USER_ROLES, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

import { ALL_CATEGORIES, AdminTimesheetsDTO } from "./admin-timesheets.types";
import { RefreshButton } from "./refresh-button";
import { CategorySegmentedControl, PeriodSelect, PersonSelect, ProjectSelect } from "./timesheet-filters";

// -------------------------------------------------------------------
// The shell every time-and-billing view sits in.
//
// Four views over ONE aggregation: the entries, the book of work, the people,
// and the findings. They were previously stacked on a single page, which meant
// the answer you wanted was always three panels down and the data-quality
// warnings shouted over the numbers. Splitting them lets each view answer one
// question, and puts the findings somewhere you go deliberately.
//
// Filters live in the URL and are carried across tabs, so switching from
// Timesheet to Staff keeps the month and the category you had chosen. A tab
// that silently reset the period would make comparing two views impossible.
// -------------------------------------------------------------------

export type TimesheetView = "timesheet" | "jobs" | "staff" | "review";

const TABS: { view: TimesheetView; label: string; href: string; icon: LucideIcon }[] = [
  { view: "timesheet", label: "Timesheet", href: ROUTES.ADMIN_TIMESHEETS, icon: Clock },
  { view: "jobs", label: "Jobs", href: ROUTES.ADMIN_TIMESHEETS_JOBS, icon: Briefcase },
  { view: "staff", label: "Staff", href: ROUTES.ADMIN_TIMESHEETS_STAFF, icon: UserRound },
  { view: "review", label: "Review", href: ROUTES.ADMIN_TIMESHEETS_REVIEW, icon: ClipboardCheck },
];

// The current filters as a query string, so every tab and the export keep them.
// `week` is included only when overriding the default, which keeps a plain tab
// link short and lets the chart fall back to the week of the latest entry.
export function filterQuery(filters: AdminTimesheetsDTO["filters"], week?: string): string {
  const params = new URLSearchParams({ month: filters.month });
  if (filters.category !== ALL_CATEGORIES) params.set("category", filters.category);
  if (filters.project !== ALL_CATEGORIES) params.set("project", filters.project);
  if (filters.person !== ALL_CATEGORIES) params.set("person", filters.person);
  if (week) params.set("week", week);
  return params.toString();
}

// A week-stepping href for the view the chart is on. The month follows the week
// so the tables below stay in step with the bars above them - stepping into
// September while the tables still said August would be two answers on one
// screen.
//
// This returns a STRING and takes the week as an argument, rather than
// returning a closure the caller can apply. The chart is a Client Component,
// and a function cannot cross the server-to-client boundary: React has to
// serialise every prop, and it throws on anything it cannot. Handing over the
// finished href avoids the whole question.
export function weekHref(pathname: string, filters: AdminTimesheetsDTO["filters"], weekStart: string): string {
  return `${pathname}?${filterQuery({ ...filters, month: weekStart.slice(0, 7) }, weekStart)}`;
}

// -------------------------------------------------------------------
// Tabs are plain links, not client-side state.
//
// Server-rendered anchors mean each view is a real URL that can be
// bookmarked, opened in a new tab and sent to someone - which is what happens
// the moment a client queries an invoice line.
// -------------------------------------------------------------------
function ViewTabs({
  current,
  filters,
  blockingCount,
}: {
  current: TimesheetView;
  filters: AdminTimesheetsDTO["filters"];
  blockingCount: number;
}) {
  const query = filterQuery(filters);

  return (
    <nav aria-label="Time and billing views" className="flex items-center gap-1 border-b border-border">
      {TABS.map((tab) => {
        const isActive = tab.view === current;
        const Icon = tab.icon;

        return (
          <Link
            key={tab.view}
            href={`${tab.href}?${query}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {tab.label}

            {/* The one place the findings intrude on the rest of the app: a
                count, not a wall of text. It only appears when something
                actually blocks an invoice. */}
            {tab.view === "review" && blockingCount > 0 && (
              <Badge variant="destructive" className="ml-0.5">
                {blockingCount}
              </Badge>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

// -------------------------------------------------------------------
// The shell: title, tabs, filters, then the view's own content.
//
// `filterSlots` lets each view show only the filters that make sense for it -
// the Staff view owns the person selector, so it does not also appear in the
// filter row above it.
// -------------------------------------------------------------------
export default function TimesheetShell({
  view,
  data,
  title,
  description,
  showPersonFilter = true,
  showProjectFilter = true,
  children,
}: {
  view: TimesheetView;
  data: AdminTimesheetsDTO;
  title: string;
  description: string;
  showPersonFilter?: boolean;
  showProjectFilter?: boolean;
  children: React.ReactNode;
}) {
  const { filters, monthOptions, categoryOptions, projectOptions, personOptions, report } = data;

  return (
    <PortalPage
      eyebrow={USER_ROLE_LABELS[USER_ROLES.ADMIN]}
      title={title}
      description={description}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {/* On every view, because "the numbers look stale" can strike on any
              of them and having to navigate to find the button is the thing
              that makes people stop trusting the page. */}
          <RefreshButton />

          {report.totals.worklogCount > 0 && (
            <Button asChild variant="outline">
              <Link href={`${ROUTES.ADMIN_TIMESHEETS_EXPORT}?${filterQuery(filters)}`} prefetch={false}>
                <Download aria-hidden />
                Export CSV
              </Link>
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        <ViewTabs current={view} filters={filters} blockingCount={report.blockingCount} />

        {/* One filter row for every view, so the controls never move between
            tabs. Each control hides itself when there is nothing to choose. */}
        <div className="flex flex-wrap items-center gap-2">
          <PeriodSelect filters={filters} options={monthOptions} />
          {showProjectFilter && <ProjectSelect filters={filters} options={projectOptions} />}
          {showPersonFilter && <PersonSelect filters={filters} options={personOptions} />}
          <div className="ms-auto">
            <CategorySegmentedControl filters={filters} options={categoryOptions} />
          </div>
        </div>

        {children}
      </div>
    </PortalPage>
  );
}
