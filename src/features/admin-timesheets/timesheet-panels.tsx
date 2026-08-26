import { AlertTriangle, CheckCircle2, CircleSlash, ShieldAlert, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import {
  BillableSplit,
  BudgetRow,
  Finding,
  PersonTotal,
  ProjectTotal,
  TimesheetReport,
} from "@/lib/timesheet/timesheet.types";
import { cn } from "@/lib/utils";

import { SyncStatusDTO } from "./admin-timesheets.types";
import { JobsDataTable } from "./table/timesheet-data-tables";
import { AnimatedNumber, LiftOnHover, ProportionBar, Reveal } from "./timesheet-motion";

// -------------------------------------------------------------------
// Timesheet panels
//
// Presentation only. Every number here was computed by the aggregation engine;
// nothing on this page adds anything up. If a total needs to change it changes
// in the engine, and the dashboard, the export and the sync job move together.
//
// The visual language is data-dense: compact padding, tabular figures, sticky
// table headers, and colour used only where it carries meaning. On a screen
// somebody invoices from, clarity beats decoration every time - so the only
// saturated colour on the page marks money that cannot be billed.
//
// Every colour is a semantic token. No hex appears in this file, which is what
// keeps a rebrand to one edit in globals.css.
// -------------------------------------------------------------------

// Two decimals. A quarter hour is the smallest unit anyone books, and four
// decimals reads as false precision on a screen used to invoice from.
export function formatHours(hours: number): string {
  return `${hours.toFixed(2)} h`;
}

function formatPercent(ratio: number | null): string {
  // Null is "nothing logged", which is not zero per cent. 0% on an empty week
  // reads as a problem that is not there.
  if (ratio === null) return "n/a";
  return `${Math.round(ratio * 100)}%`;
}

// -------------------------------------------------------------------
// The billable state. The loudest thing on the page.
//
// A period with a blocking finding does not get invoiced, so it says so at the
// top with an icon as well as colour - colour alone would leave the state
// invisible to anyone who cannot distinguish it.
// -------------------------------------------------------------------
export function BillableStateBanner({ report }: { report: TimesheetReport }) {
  const blocked = !report.isBillable;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4",
        blocked
          ? "border-destructive/30 bg-destructive/10"
          : "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950",
      )}
    >
      {blocked ? (
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
      ) : (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      )}

      <div className="min-w-0">
        <p className={cn("font-semibold", blocked ? "text-destructive" : "text-emerald-900 dark:text-emerald-100")}>
          {blocked ? "This period is not billable yet" : "This period is ready to bill"}
        </p>
        <p className={cn("mt-1 text-sm", blocked ? "text-destructive/90" : "text-emerald-800 dark:text-emerald-200")}>
          {blocked
            ? `${report.blockingCount} ${report.blockingCount === 1 ? "finding blocks" : "findings block"} it. ` +
              `Fix them in Jira and re-sync - nothing is edited here.`
            : report.warningCount > 0
              ? `No blocking findings. ${report.warningCount} ${report.warningCount === 1 ? "warning" : "warnings"} worth a look.`
              : "No findings at all."}
        </p>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------
// A headline figure, with the number counting up when the filter changes.
// -------------------------------------------------------------------
export function StatTile({
  label,
  hours,
  hint,
  ratio,
  emphasis = "normal",
  // "hours" renders "18.75 h", "count" renders "7", "percent" renders "64%",
  // "currency" renders "$12,480". A count shown with a unit reads as a
  // duration; a percentage shown without its sign reads as a count, which is
  // how "14" ended up on screen where "14%" was meant.
  //
  // A currency tile takes WHOLE UNITS, not cents, because AnimatedNumber
  // counts up to the value it is given and nobody wants to watch it climb
  // through a million cents.
  format = "hours",
  index = 0,
}: {
  label: string;
  hours: number;
  hint?: string;
  ratio?: number | null;
  emphasis?: "normal" | "muted" | "alert";
  format?: "hours" | "count" | "percent" | "currency";
  index?: number;
}) {
  return (
    <Reveal index={index} className="h-full">
      <LiftOnHover className="h-full">
        <Card className={cn("h-full", emphasis === "alert" && "border-destructive/40")}>
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>

            <p
              className={cn(
                "mt-2 font-heading text-3xl font-bold",
                emphasis === "muted" && "text-muted-foreground",
                emphasis === "alert" && "text-destructive",
                emphasis === "normal" && "text-foreground",
              )}
            >
              <AnimatedNumber
                value={hours}
                decimals={format === "hours" ? 2 : 0}
                prefix={format === "currency" ? "$" : undefined}
                grouped={format === "currency"}
                suffix={format === "hours" ? " h" : format === "percent" ? "%" : ""}
              />
            </p>

            {ratio !== undefined && <ProportionBar ratio={ratio} label={label} className="mt-3" />}

            {hint && <p className="mt-2 text-sm text-muted-foreground">{hint}</p>}
          </CardContent>
        </Card>
      </LiftOnHover>
    </Reveal>
  );
}

function SplitCells({ split }: { split: BillableSplit }) {
  return (
    <>
      <TableCell className="text-right tabular-nums">{formatHours(split.billableHours)}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {formatHours(split.nonBillableHours)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {split.unsetSeconds > 0 ? (
          <span className="font-medium text-destructive">{formatHours(split.unsetHours)}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TableCell>
    </>
  );
}

function SplitHeadings() {
  return (
    <>
      <TableHead className="text-right">Billable</TableHead>
      <TableHead className="text-right">Non-billable</TableHead>
      <TableHead className="text-right">Unset</TableHead>
    </>
  );
}

// A card wrapper with the dense header treatment used across the screen.
function PanelCard({
  title,
  description,
  index,
  children,
}: {
  title: string;
  description: string;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <Reveal index={index}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">{children}</CardContent>
      </Card>
    </Reveal>
  );
}

// -------------------------------------------------------------------
// Hours per person, with utilisation against a full working day.
//
// Utilisation averages over the days a person actually logged something, not
// over the calendar. Dividing by the month would make someone who worked one
// full day look 3% utilised, which says nothing about the day they worked.
// -------------------------------------------------------------------
export function PeopleCard({
  people,
  workingHoursPerDay,
  index,
}: {
  people: PersonTotal[];
  workingHoursPerDay: number;
  index: number;
}) {
  return (
    <PanelCard
      title="Hours per person"
      description={`Utilisation is against ${workingHoursPerDay}h a day, averaged over days worked.`}
      index={index}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <SplitHeadings />
            <TableHead className="text-right">Days</TableHead>
            <TableHead className="text-right">Utilisation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {people.map((person) => {
            const utilisation =
              person.daysWorked > 0 ? person.hours / person.daysWorked / workingHoursPerDay : null;

            return (
              <TableRow key={person.personId} className="transition-colors hover:bg-muted/50">
                <TableCell className="font-medium">{person.personName ?? person.personId}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatHours(person.hours)}</TableCell>
                <SplitCells split={person.split} />
                <TableCell className="text-right tabular-nums">{person.daysWorked}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPercent(utilisation)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </PanelCard>
  );
}

// -------------------------------------------------------------------
// Hours per client, rolled up to the Project item an invoice is written at.
// -------------------------------------------------------------------
export function ProjectsCard({
  projects,
  totalHours,
  index,
}: {
  projects: ProjectTotal[];
  totalHours: number;
  index: number;
}) {
  return (
    <PanelCard
      title="Hours per client"
      description="Rolled up to the Project item, which is the level an invoice is written at."
      index={index}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Project item</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <SplitHeadings />
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((project) => (
            <TableRow key={project.parentKey ?? "no-parent"} className="transition-colors hover:bg-muted/50">
              <TableCell>
                {project.parentKey ? (
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">{project.parentSummary ?? project.parentKey}</span>
                    <span className="font-mono text-xs text-muted-foreground">{project.parentKey}</span>
                  </div>
                ) : (
                  <span className="italic text-muted-foreground">No parent item</span>
                )}
              </TableCell>
              <TableCell>
                {project.category ? (
                  <Badge variant="outline">{project.category}</Badge>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatHours(project.hours)}</TableCell>
              <SplitCells split={project.split} />
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>Total</TableCell>
            <TableCell className="text-right font-semibold tabular-nums">{formatHours(totalHours)}</TableCell>
            <TableCell colSpan={3} />
          </TableRow>
        </TableFooter>
      </Table>
    </PanelCard>
  );
}

// -------------------------------------------------------------------
// Baseline vs current vs actual.
//
// Items with a budget and no time logged are included on purpose: a large
// budget with nothing under it is either work that has not started or work
// recorded somewhere else, and a table of only-items-with-hours shows neither.
// -------------------------------------------------------------------
// The book of work.
//
// Every job appears, including the ones nobody has started - a large budget
// with nothing under it means the work has not begun, or is being recorded
// somewhere other than Jira, and a table of only-jobs-with-hours shows
// neither. Sorting and filtering come from the shared DataTable.
// -------------------------------------------------------------------
export function JobsCard({ jobs, index }: { jobs: BudgetRow[]; index: number }) {
  if (jobs.length === 0) return null;

  const started = jobs.filter((job) => job.worklogCount > 0).length;
  const hasAnyEstimate = jobs.some((job) => job.baselineSeconds !== null || job.currentSeconds !== null);

  return (
    <Reveal index={index}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Jobs</CardTitle>
          <CardDescription>
            {`${jobs.length} jobs, ${jobs.length - started} with no time booked in this period. `}
            {hasAnyEstimate
              ? "Baseline and estimate come from Jira; actuals are summed from the entries, never stored."
              : "No baseline or estimate is set in Jira yet, so there is nothing to measure against."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JobsDataTable jobs={jobs} />
        </CardContent>
      </Card>
    </Reveal>
  );
}

// -------------------------------------------------------------------
// The audit, as a first-class panel.
//
// Blocking first, each finding carrying its code. The code stays visible
// because the explanation is the convenience and the finding is the record -
// when Claude starts writing these in plain English, the code is what proves
// the sentence came from a rule and not from a guess.
// -------------------------------------------------------------------
export function AuditCard({ findings, index }: { findings: Finding[]; index: number }) {
  const blocking = findings.filter((finding) => finding.severity === "blocking");
  const warnings = findings.filter((finding) => finding.severity === "warning");

  return (
    <Reveal index={index}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            Audit
            {blocking.length > 0 && <Badge variant="destructive">{blocking.length} blocking</Badge>}
            {warnings.length > 0 && <Badge variant="warning">{warnings.length} warnings</Badge>}
          </CardTitle>
          <CardDescription>
            Findings are reported, never repaired. Fix the entry in Jira and it clears on the next sync.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {findings.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
              Nothing to report for this period.
            </p>
          ) : (
            <ul className="space-y-2">
              {findings.map((finding, position) => (
                <li
                  key={`${finding.code}-${finding.worklogIds?.join("-") ?? finding.issueKey ?? position}`}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 transition-colors",
                    finding.severity === "blocking"
                      ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  <Badge
                    variant={finding.severity === "blocking" ? "destructive" : "warning"}
                    className="mt-0.5 shrink-0"
                  >
                    {finding.severity === "blocking" ? "Blocks" : "Warning"}
                  </Badge>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{finding.message}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{finding.code}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </Reveal>
  );
}

// -------------------------------------------------------------------
// Nothing to show.
//
// An empty dashboard has to say WHY it is empty. "Never synced", "synced and
// genuinely quiet" and "synced but failing" look identical otherwise, and mean
// completely different things.
// -------------------------------------------------------------------
export function EmptyState({
  syncStatus,
  periodLabel,
  filtered,
}: {
  syncStatus: SyncStatusDTO;
  periodLabel: string;
  filtered: boolean;
}) {
  let icon: LucideIcon = CircleSlash;
  let title = `No time logged in ${periodLabel}`;
  let detail = "The sync has run, so this period is genuinely empty.";

  if (filtered) {
    title = "Nothing matches these filters";
    detail = `There is time logged in ${periodLabel}, but none of it is in this category or project. Widen the filter to see the period.`;
  } else if (!syncStatus.configured) {
    icon = AlertTriangle;
    title = "Jira is not configured";
    detail =
      "Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN, then trigger the sync. Nothing can appear here until it runs.";
  } else if (syncStatus.lastError) {
    icon = AlertTriangle;
    title = "The last sync failed";
    detail = syncStatus.lastError;
  } else if (syncStatus.lastSuccessAt === null) {
    icon = AlertTriangle;
    title = "The sync has never run";
    detail = "Jira is configured, but no sync has completed yet, so the read model is empty.";
  } else if (syncStatus.totalWorklogs === 0) {
    title = "The read model is empty";
    detail = `The sync last succeeded ${formatDateTime(syncStatus.lastSuccessAt)} but has never written a worklog.`;
  }

  const Icon = icon;

  return (
    <Reveal>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <Icon className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-semibold text-foreground">{title}</p>
          <p className="max-w-lg text-sm text-muted-foreground">{detail}</p>
        </CardContent>
      </Card>
    </Reveal>
  );
}

// -------------------------------------------------------------------
// Sync state, small and always visible.
//
// A dashboard that silently shows stale numbers is worse than one that shows
// none, so when the read model was last refreshed is on the page, not in a log.
// -------------------------------------------------------------------
export function SyncStatusLine({ syncStatus }: { syncStatus: SyncStatusDTO }) {
  if (!syncStatus.configured) {
    return <p className="text-sm text-muted-foreground">Jira is not configured, so nothing is being synced.</p>;
  }

  if (syncStatus.lastError) {
    return (
      <p className="text-sm text-destructive">
        Last sync failed: {syncStatus.lastError}
        {syncStatus.lastSuccessAt && <> Last success {formatDateTime(syncStatus.lastSuccessAt)}.</>}
      </p>
    );
  }

  if (!syncStatus.lastSuccessAt) {
    return <p className="text-sm text-muted-foreground">The sync has not completed a run yet.</p>;
  }

  return (
    <p className="text-sm text-muted-foreground">
      Synced from Jira {formatDateTime(syncStatus.lastSuccessAt)}. Jira remains the source of truth.
    </p>
  );
}
