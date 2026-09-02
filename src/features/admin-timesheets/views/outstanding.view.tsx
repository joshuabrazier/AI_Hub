import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import PortalPage from "@/features/layout/portal-page";
import { USER_ROLES, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";
import { secondsToHours, type ProjectOutstanding } from "@/lib/timesheet/outstanding";
import { cn } from "@/lib/utils";

import { getOutstandingEffortService } from "../admin-timesheets-outstanding.service";
import { RefreshButton } from "../refresh-button";
import { StatTile } from "../timesheet-panels";

// -------------------------------------------------------------------
// Outstanding effort: what is left to do, by project.
//
// THIS SCREEN HAS NO PERIOD CONTROL, AND THAT IS THE POINT.
//
// Every other timesheet view sits in TimesheetShell, which puts a month
// stepper at the top. Reusing it here would have been less code and would
// have been wrong: the figures below do not change with the month, so a
// stepper above them either implies "92h were outstanding in July" - which is
// not what is computed - or makes the page look broken when stepping a month
// changes nothing. So this one builds its own header and says "as things
// stand" in the description instead.
//
// THE HONESTY PROBLEM THIS SCREEN IS BUILT AROUND.
//
// On the live data, 5 of 59 open issues carry an estimate. A single
// "outstanding: 121h" headline computed over that is not slightly low - it
// describes a tenth of the work while looking complete, and it is exactly the
// number somebody would repeat to a client.
//
// So coverage is a TILE, not a footnote, unestimated work gets its own column
// and its own table, and a project whose open work is entirely unestimated
// says so in words rather than showing a confident 0 h. If the reader takes
// one thing off this page it should be how much of it is actually known.
// -------------------------------------------------------------------

function hours(seconds: number): string {
  return `${secondsToHours(seconds).toLocaleString(undefined, { maximumFractionDigits: 1 })} h`;
}

// -------------------------------------------------------------------
// One project.
//
// The estimated and unestimated halves are two tables rather than one with a
// blank column, because they answer different questions: the first is "how
// much is left", the second is "how much do we not know". Merging them puts
// an empty cell where a number should be and invites the reader to add up a
// column that does not total anything.
// -------------------------------------------------------------------
function ProjectCard({ project }: { project: ProjectOutstanding }) {
  const committed = project.estimateSeconds + project.completedEstimateSeconds;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <CardTitle className="text-base">
            {project.projectName}
            <span className="ml-2 text-xs font-normal text-muted-foreground">{project.projectKey}</span>
          </CardTitle>

          <p className="text-sm text-muted-foreground">
            {project.items.length > 0 ? (
              <>
                <span className="font-semibold text-foreground">{hours(project.remainingSeconds)}</span> left of{" "}
                {hours(committed)} committed
              </>
            ) : (
              // Never "0 h left". Nothing here is estimated, so the honest
              // statement is that the figure is unknown, not that it is zero.
              <span className="text-amber-700 dark:text-amber-500">No estimates on any open work</span>
            )}
          </p>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {project.items.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Estimate</TableHead>
                  <TableHead className="text-right">Logged</TableHead>
                  <TableHead className="text-right">Left</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {project.items.map((item) => (
                  <TableRow key={item.issueKey}>
                    <TableCell className="max-w-[28rem]">
                      <span className="text-xs text-muted-foreground">{item.issueKey}</span>{" "}
                      <span className="align-middle">{item.summary}</span>
                      {item.coversChildren && item.coversOpenCount > 0 && (
                        // A coarser figure than the rest of the column: one
                        // estimate standing in for several items beneath it.
                        // The COUNT is what makes that checkable rather than
                        // merely stated - without it the reader has to open
                        // Jira to find out how much this one line is holding.
                        <Badge variant="outline" className="ml-2 align-middle text-[0.65rem] font-normal">
                          covers {item.coversOpenCount} open{" "}
                          {item.coversOpenCount === 1 ? "item" : "items"} beneath it
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.status ?? "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">{hours(item.estimateSeconds)}</TableCell>
                    <TableCell
                      className={cn("text-right tabular-nums", item.isOverrun && "text-destructive font-medium")}
                    >
                      {hours(item.loggedSeconds)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {item.isOverrun ? (
                        // "0 h left" on an item already over its estimate is
                        // true and misleading at the same time. Naming the
                        // overrun costs one word and stops it reading as
                        // "finished, on budget".
                        <span className="text-destructive">over by {hours(item.loggedSeconds - item.estimateSeconds)}</span>
                      ) : (
                        hours(item.remainingSeconds)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {project.unestimated.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {project.unestimated.length} open{" "}
              {project.unestimated.length === 1 ? "item has" : "items have"} no estimate
              {project.unestimatedLoggedSeconds > 0 && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  - {hours(project.unestimatedLoggedSeconds)} already logged against them
                </span>
              )}
            </p>

            <div className="overflow-x-auto rounded-lg border border-dashed border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Logged so far</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {project.unestimated.map((item) => (
                    <TableRow key={item.issueKey}>
                      <TableCell className="max-w-[28rem]">
                        <span className="text-xs text-muted-foreground">{item.issueKey}</span>{" "}
                        <span className="align-middle">{item.summary}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.status ?? "-"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.loggedSeconds > 0 ? hours(item.loggedSeconds) : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default async function OutstandingView() {
  const summary = await getOutstandingEffortService();

  const coveragePercent = summary.estimateCoverage == null ? null : Math.round(summary.estimateCoverage * 100);

  // Below this, the headline figure describes a minority of the open work and
  // the page should lead with that rather than with the number. Half is a
  // judgement, not a standard - it is set here so it is set once.
  const coverageIsPoor = coveragePercent != null && coveragePercent < 50;

  return (
    <PortalPage
      eyebrow={USER_ROLE_LABELS[USER_ROLES.ADMIN]}
      title="Outstanding work"
      description="Effort still to come, as things stand today. Not a period view - an estimate set in July and worked in September counts here either way."
      actions={<RefreshButton />}
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Estimated work left"
            hours={secondsToHours(summary.remainingSeconds)}
            hint={`Across ${summary.estimatedIssueCount} estimated open ${summary.estimatedIssueCount === 1 ? "item" : "items"}`}
            index={0}
          />
          <StatTile
            label="Not estimated"
            hours={summary.unestimatedIssueCount}
            format="count"
            hint={
              summary.unestimatedLoggedSeconds > 0
                ? `Open items with no estimate - ${hours(summary.unestimatedLoggedSeconds)} logged already`
                : "Open items with no estimate"
            }
            emphasis={summary.unestimatedIssueCount > 0 ? "alert" : "normal"}
            index={1}
          />
          <StatTile
            label="Estimate coverage"
            hours={coveragePercent ?? 0}
            format="percent"
            hint={
              coveragePercent == null
                ? "No open work"
                : `${summary.estimatedIssueCount} of ${summary.openIssueCount} open items`
            }
            emphasis={coverageIsPoor ? "alert" : "normal"}
            index={2}
          />
          <StatTile
            label="Logged against it"
            hours={secondsToHours(summary.loggedSeconds)}
            hint="All time, every project"
            emphasis="muted"
            index={3}
          />
        </div>

        {coverageIsPoor && (
          // The most important thing on the page when it is true, so it sits
          // above the figures it qualifies rather than under them. A reader
          // who scrolls past the tiles and quotes the headline should have had
          // to scroll past this first.
          <div className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-50/60 p-4 text-sm dark:bg-amber-950/20">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">
                Only {coveragePercent}% of open work is estimated, so the figure above is a floor, not a forecast.
              </p>
              <p className="text-muted-foreground">
                The {summary.unestimatedIssueCount} unestimated{" "}
                {summary.unestimatedIssueCount === 1 ? "item is" : "items are"} listed under each project with the hours
                already spent on them. Estimating those in Jira is what turns this page into a forecast - nothing here
                can infer them.
              </p>
            </div>
          </div>
        )}

        {summary.projects.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No open work. Every synced item is in a finished status.
            </CardContent>
          </Card>
        ) : (
          summary.projects.map((project) => <ProjectCard key={project.projectKey} project={project} />)
        )}
      </div>
    </PortalPage>
  );
}
