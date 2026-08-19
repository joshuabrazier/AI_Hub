import Link from "next/link";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import PortalPage from "@/features/layout/portal-page";
import { USER_ROLES, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";
import { ROUTES } from "@/lib/routes";

import { ALL_CATEGORIES, AdminTimesheetsDTO } from "./admin-timesheets.types";
import { RefreshButton } from "./refresh-button";
import { PeriodControl } from "./period-control";
import { CategorySegmentedControl, ProjectSelect } from "./timesheet-filters";

// -------------------------------------------------------------------
// The shell every time-and-billing view sits in.
//
// There is deliberately no tab strip. The sidebar already lists Timesheet,
// Jobs, Staff and Review, so a second row of the same four links restated the
// navigation and ate the top of every screen. One place to navigate is enough.
//
// There is also no person selector here. Picking somebody happens by clicking
// their name in the staff list, which is a shorter path than opening a
// dropdown of account ids and is the only place it makes sense.
//
// Filters live in the URL and carry across views, so moving between screens
// keeps the month and category you had chosen.
// -------------------------------------------------------------------

// The current filters as a query string, so every link and the export keep
// them. `week` is included only when overriding the default, which keeps a
// plain link short and lets the chart fall back to the week of the latest
// entry.
export function filterQuery(filters: AdminTimesheetsDTO["filters"], start?: string): string {
  const params = new URLSearchParams({ granularity: filters.granularity, start: start ?? filters.start });
  if (filters.category !== ALL_CATEGORIES) params.set("category", filters.category);
  if (filters.project !== ALL_CATEGORIES) params.set("project", filters.project);
  if (filters.person !== ALL_CATEGORIES) params.set("person", filters.person);
  return params.toString();
}

// A week-stepping href for the view the chart is on. The month follows the
// week so the tables below stay in step with the bars above them - stepping
// into September while the tables still said August would be two answers on
// one screen.
//
// Returns a STRING rather than a closure: the chart is a Client Component, and
// a function cannot cross the server-to-client boundary.
export function periodHref(pathname: string, filters: AdminTimesheetsDTO["filters"], start: string): string {
  return `${pathname}?${filterQuery(filters, start)}`;
}

export default function TimesheetShell({
  data,
  title,
  description,
  // The route this shell is rendering, so the period arrows keep you on it.
  pathname,
  backLink,
  showProjectFilter = true,
  showCategoryFilter = true,
  children,
}: {
  data: AdminTimesheetsDTO;
  title: string;
  description: string;
  pathname: string;
  // Shown above the title on a detail screen, so there is always a way back to
  // the list you came from.
  backLink?: { href: string; label: string };
  showProjectFilter?: boolean;
  showCategoryFilter?: boolean;
  children: React.ReactNode;
}) {
  const { filters, period, todayIso, categoryOptions, projectOptions, report } = data;

  return (
    <PortalPage
      eyebrow={USER_ROLE_LABELS[USER_ROLES.ADMIN]}
      title={title}
      description={description}
      actions={
        <div className="flex flex-wrap items-center gap-2">
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
        {backLink && (
          <Link
            href={backLink.href}
            className="inline-flex items-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {backLink.label}
          </Link>
        )}

{/* One filter row. Everything flows left to right and wraps together;
            the category control used to be pushed right with ms-auto, which
            stranded it alone on a second line as soon as anything else grew. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-muted/20 p-2">
          <PeriodControl filters={filters} period={period} todayIso={todayIso} pathname={pathname} />

          {(showProjectFilter || showCategoryFilter) && (
            <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />
          )}

          {showCategoryFilter && <CategorySegmentedControl filters={filters} options={categoryOptions} />}
          {showProjectFilter && <ProjectSelect filters={filters} options={projectOptions} />}
        </div>

        {children}
      </div>
    </PortalPage>
  );
}
