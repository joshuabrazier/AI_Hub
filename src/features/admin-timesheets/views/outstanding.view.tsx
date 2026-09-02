import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import PortalPage from "@/features/layout/portal-page";
import { USER_ROLES, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";
import {
  secondsToHours,
  type ClientOutstanding,
  type OutstandingSummary,
  type ProjectOutstanding,
} from "@/lib/timesheet/outstanding";
import { cn } from "@/lib/utils";

import { getOutstandingBoardService } from "../admin-timesheets-outstanding.service";
import { OutstandingFilters } from "../outstanding-filters";
import { RefreshButton } from "../refresh-button";
import { StatTile } from "../timesheet-panels";

// -------------------------------------------------------------------
// Outstanding work: pick a client, then a project, and see what is left.
//
// THIS SCREEN HAS NO PERIOD CONTROL, AND THAT IS THE POINT.
//
// Every other timesheet view sits in TimesheetShell, which puts a month
// stepper at the top. Reusing it here would have been less code and would
// have been wrong: these figures do not change with the month, so a stepper
// above them either implies "84h were outstanding in July" - which is not
// what is computed - or makes the page look broken when stepping a month
// changes nothing.
//
// THE HONESTY PROBLEM THE WHOLE SCREEN IS BUILT AROUND.
//
// On the live data a handful of open items carry an estimate and dozens do
// not. A single headline computed over that is not slightly low - it
// describes a fraction of the work while looking complete, and it is exactly
// the number somebody would repeat to a client.
//
// So: coverage is a TILE rather than a footnote, unestimated work gets its
// own table and is never folded into a total, anything with no estimates says
// "Unknown" rather than a confident 0 h, and below half coverage a banner
// sits ABOVE the figures it qualifies.
//
// AND THE THIRD TABLE, WHICH IS WHAT MAKES THE PAGE ACTIONABLE. Where one
// estimate covers several items beneath it, those items are listed under it.
// "84.5 h left on Phase 2" is not something anybody can act on until they can
// see the four open deliverables that figure is holding.
// -------------------------------------------------------------------

function hours(seconds: number): string {
  return `${secondsToHours(seconds).toLocaleString(undefined, { maximumFractionDigits: 1 })} h`;
}

function IssueCell({ issueKey, summary }: { issueKey: string; summary: string }) {
  return (
    <TableCell className="max-w-[30rem]">
      <span className="text-xs text-muted-foreground">{issueKey}</span>{" "}
      <span className="align-middle">{summary}</span>
    </TableCell>
  );
}

// A table of items with nothing but hours-to-date to say about them. Used for
// the covered list and the unestimated list, which look alike and mean
// completely different things - so each supplies its own heading.
function ItemsTable({
  items,
  dashed = false,
}: {
  items: { issueKey: string; summary: string; status: string | null; loggedSeconds: number }[];
  dashed?: boolean;
}) {
  return (
    <div className={cn("overflow-x-auto rounded-lg border border-border", dashed && "border-dashed")}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Logged so far</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.issueKey}>
              <IssueCell issueKey={item.issueKey} summary={item.summary} />
              <TableCell className="text-muted-foreground">{item.status ?? "-"}</TableCell>
              <TableCell className="text-right tabular-nums">
                {item.loggedSeconds > 0 ? hours(item.loggedSeconds) : "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// -------------------------------------------------------------------
// One project: its estimated lines, then what those lines are holding, then
// what nobody has sized.
//
// Three tables rather than one with blank columns, because they answer three
// different questions and a merged table invites the reader to add up a
// column that does not total anything.
// -------------------------------------------------------------------
function ProjectPanel({ project }: { project: ProjectOutstanding }) {
  const committed = project.estimateSeconds + project.completedEstimateSeconds;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <CardTitle className="text-base">
            {project.summary}
            <span className="ml-2 text-xs font-normal text-muted-foreground">{project.issueKey}</span>
            {project.status && (
              <Badge variant="outline" className="ml-2 align-middle text-[0.65rem] font-normal">
                {project.status}
              </Badge>
            )}
          </CardTitle>

          <p className="text-sm text-muted-foreground">
            {project.estimatedCount > 0 ? (
              <>
                <span className="font-semibold text-foreground">{hours(project.remainingSeconds)}</span> left of{" "}
                {hours(committed)} committed
              </>
            ) : (
              // Never "0 h left". Nothing here is estimated, so the honest
              // statement is that the figure is unknown, not that it is zero.
              <span className="text-amber-700 dark:text-amber-500">
                {project.openCount} open {project.openCount === 1 ? "item" : "items"}, none estimated
              </span>
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
                    <TableCell className="max-w-[30rem]">
                      <span className="text-xs text-muted-foreground">{item.issueKey}</span>{" "}
                      <span className="align-middle">{item.summary}</span>
                      {item.coversChildren && item.coversOpenCount > 0 && (
                        // A coarser figure than the rest of the column: one
                        // estimate standing in for several items. The COUNT is
                        // what makes that checkable rather than merely stated,
                        // and the table below names them.
                        <Badge variant="outline" className="ml-2 align-middle text-[0.65rem] font-normal">
                          covers {item.coversOpenCount} open {item.coversOpenCount === 1 ? "item" : "items"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.status ?? "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">{hours(item.estimateSeconds)}</TableCell>
                    <TableCell
                      className={cn("text-right tabular-nums", item.isOverrun && "font-medium text-destructive")}
                    >
                      {hours(item.loggedSeconds)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {item.isOverrun ? (
                        // "0 h left" on an item already over its estimate is
                        // true and misleading at once. Naming the overrun costs
                        // one word and stops it reading as "done, on budget".
                        <span className="text-destructive">
                          over by {hours(item.loggedSeconds - item.estimateSeconds)}
                        </span>
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

        {project.covered.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              What that estimate covers
              <span className="ml-2 font-normal text-muted-foreground">
                {project.covered.length} open {project.covered.length === 1 ? "item" : "items"}, sized together above
                rather than one by one
              </span>
            </p>

            <ItemsTable items={project.covered} />
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

            <ItemsTable items={project.unestimated} dashed />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// -------------------------------------------------------------------
// The unfiltered view: one row per client, so the first question the page
// answers is "who has work left" rather than "here is everything at once".
// -------------------------------------------------------------------
function ClientSummaryCard({ clients }: { clients: ClientOutstanding[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Every client with work open</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Projects</TableHead>
                <TableHead className="text-right">Open items</TableHead>
                <TableHead className="text-right">Sized</TableHead>
                <TableHead className="text-right">Left</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => (
                <TableRow key={client.clientKey}>
                  <TableCell>
                    {client.clientName}
                    <span className="ml-2 text-xs text-muted-foreground">{client.clientKey}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{client.projects.length}</TableCell>
                  <TableCell className="text-right tabular-nums">{client.openCount}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {/* Sized, not estimated. An item covered by a parent's
                        estimate has a size - it just does not have one of its
                        own - and calling that unsized understates how much of
                        the work is actually known. */}
                    {client.estimatedCount + client.coveredCount} of {client.openCount}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {client.estimatedCount > 0 ? (
                      hours(client.remainingSeconds)
                    ) : (
                      // The same rule as everywhere else on this page: nothing
                      // estimated means unknown, never zero.
                      <span className="text-amber-700 dark:text-amber-500">Unknown</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function Tiles({ summary }: { summary: OutstandingSummary }) {
  const coveragePercent = summary.estimateCoverage == null ? null : Math.round(summary.estimateCoverage * 100);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label="Estimated work left"
        hours={secondsToHours(summary.remainingSeconds)}
        hint={`Across ${summary.estimatedCount} estimated open ${summary.estimatedCount === 1 ? "item" : "items"}`}
        index={0}
      />
      <StatTile
        label="Not estimated"
        hours={summary.unestimatedCount}
        format="count"
        hint={
          summary.unestimatedLoggedSeconds > 0
            ? `Open items with no estimate - ${hours(summary.unestimatedLoggedSeconds)} logged already`
            : "Open items with no estimate"
        }
        emphasis={summary.unestimatedCount > 0 ? "alert" : "normal"}
        index={1}
      />
      <StatTile
        label="Estimate coverage"
        hours={coveragePercent ?? 0}
        format="percent"
        hint={
          coveragePercent == null
            ? "No open work"
            : `${summary.estimatedCount + summary.coveredCount} of ${summary.openCount} open items are sized`
        }
        emphasis={coveragePercent != null && coveragePercent < 50 ? "alert" : "normal"}
        index={2}
      />
      <StatTile
        label="Logged against it"
        hours={secondsToHours(summary.loggedSeconds)}
        hint="All time"
        emphasis="muted"
        index={3}
      />
    </div>
  );
}

export interface OutstandingSearchParams {
  client?: string;
  project?: string;
}

export default async function OutstandingView({ client, project }: OutstandingSearchParams) {
  const board = await getOutstandingBoardService({ clientKey: client, projectKey: project });
  const { selected } = board;

  const coveragePercent = selected.estimateCoverage == null ? null : Math.round(selected.estimateCoverage * 100);

  // Below this the headline describes a minority of the open work and the page
  // should lead with that rather than with the number. Half is a judgement,
  // not a standard - it is set here so it is set once.
  const coverageIsPoor = coveragePercent != null && coveragePercent < 50;

  const selectedClient = board.clientKey == null ? null : selected.clients[0];

  const heading =
    board.projectKey != null
      ? (selectedClient?.projects[0]?.summary ?? board.projectKey)
      : (selectedClient?.clientName ?? "Every client");

  return (
    <PortalPage
      eyebrow={USER_ROLE_LABELS[USER_ROLES.ADMIN]}
      title="Outstanding work"
      description="Effort still to come, as things stand today. Not a period view - an estimate set in July and worked in September counts here either way."
      actions={<RefreshButton />}
    >
      <div className="space-y-6">
        <OutstandingFilters
          clientOptions={board.clientOptions}
          projectOptions={board.projectOptions}
          clientKey={board.clientKey}
          projectKey={board.projectKey}
        />

        {board.droppedFilters.length > 0 && (
          // Named rather than silently ignored. An unrecognised filter that
          // simply selected nothing would render an empty page reading as "no
          // work left" when the truth is "that is not a thing here".
          <p className="text-sm text-muted-foreground">
            Ignored {board.droppedFilters.join(", ")} - nothing with open work here goes by that. Showing{" "}
            {board.clientKey == null ? "every client" : heading} instead.
          </p>
        )}

        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold text-foreground">{heading}</h2>
          {board.projectKey != null && selectedClient && (
            <p className="text-sm text-muted-foreground">{selectedClient.clientName}</p>
          )}
        </div>

        <Tiles summary={selected} />

        {coverageIsPoor && (
          // The most important thing on the page when it is true, so it sits
          // above the figures it qualifies rather than under them. Somebody
          // who scrolls past the tiles to quote the headline should have had
          // to scroll past this first.
          <div className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-50/60 p-4 text-sm dark:bg-amber-950/20">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">
                Only {coveragePercent}% of the open work here is sized, so the figure above is a floor, not a
                forecast.
              </p>
              <p className="text-muted-foreground">
                The {selected.unestimatedCount} unestimated{" "}
                {selected.unestimatedCount === 1 ? "item is" : "items are"} listed below with the hours already spent
                on them. Estimating those in Jira is what turns this page into a forecast - nothing here can infer
                them.
              </p>
            </div>
          </div>
        )}

        {selected.clients.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No open work here. Every synced item is in a finished status.
            </CardContent>
          </Card>
        ) : board.clientKey == null ? (
          // Nothing chosen: answer "who has work left" first and let the
          // dropdowns take it from there. Dumping every project of every client
          // onto one page is what the client step exists to avoid.
          <ClientSummaryCard clients={selected.clients} />
        ) : (
          selected.clients.flatMap((entry) =>
            entry.projects.map((entryProject) => (
              <ProjectPanel key={entryProject.issueKey} project={entryProject} />
            )),
          )
        )}
      </div>
    </PortalPage>
  );
}
