import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/lib/routes";
import { secondsToHours, type OutstandingSummary } from "@/lib/timesheet/outstanding";
import { Reveal } from "./timesheet-motion";

// -------------------------------------------------------------------
// Outstanding effort, beside a filtered period.
//
// Shown on the overview once a client (and optionally a project) is chosen,
// because "we billed 14h against this job in August" and "there are 84h left
// on it" are the two halves of the same question, and having to change screens
// between them is how one gets quoted without the other.
//
// IT IS NOT A PERIOD FIGURE, AND THE CARD SAYS SO IN ITS OWN HEADER.
//
// This is the one thing that could go wrong here. Everything else on the
// overview moves when the month stepper moves; these numbers do not. Sitting
// them among period figures with no label would invite exactly the reading
// they cannot support - "84h outstanding in August" is not what is computed,
// and the number would not change if you stepped to July to check.
//
// So the header carries "as at today" rather than the period label, and the
// comparison against the period's own hours is left to the reader instead of
// being computed into a rate that would imply the two share a timeframe.
// -------------------------------------------------------------------

function hours(seconds: number): string {
  return `${secondsToHours(seconds).toLocaleString(undefined, { maximumFractionDigits: 1 })} h`;
}

export function OutstandingCard({
  summary,
  // What was filtered to, for the heading - so the card names the thing it is
  // describing rather than making the reader remember what the dropdowns say.
  scopeLabel,
  index = 0,
}: {
  summary: OutstandingSummary;
  scopeLabel: string;
  index?: number;
}) {
  const coveragePercent = summary.estimateCoverage == null ? null : Math.round(summary.estimateCoverage * 100);
  const coverageIsPoor = coveragePercent != null && coveragePercent < 50;

  // Nothing open at all is a real answer and worth showing. Nothing open AND
  // nothing unestimated means the filter selected finished work only.
  const nothingOpen = summary.openIssueCount === 0;

  return (
    <Reveal index={index}>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <CardTitle className="text-base">
              Still to come on {scopeLabel}
              {/* Not the period label. See the note at the top of this file:
                  these figures do not move with the month stepper above them. */}
              <span className="ml-2 text-xs font-normal text-muted-foreground">as at today</span>
            </CardTitle>

            <Link
              href={ROUTES.ADMIN_TIMESHEETS_OUTSTANDING}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Every project
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {nothingOpen ? (
            <p className="text-sm text-muted-foreground">No open work. Everything here is in a finished status.</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Estimated work left
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {summary.estimatedIssueCount > 0 ? (
                      hours(summary.remainingSeconds)
                    ) : (
                      // Never "0 h". Nothing here is estimated, so the honest
                      // answer is that it is unknown, not that it is nothing.
                      <span className="text-amber-700 dark:text-amber-500">Unknown</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {summary.estimatedIssueCount > 0
                      ? `Across ${summary.estimatedIssueCount} estimated ${summary.estimatedIssueCount === 1 ? "item" : "items"}`
                      : "No open item here carries an estimate"}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Not estimated
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{summary.unestimatedIssueCount}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {summary.unestimatedLoggedSeconds > 0
                      ? `${hours(summary.unestimatedLoggedSeconds)} logged against them already`
                      : "Open items with no estimate"}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Estimate coverage
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {coveragePercent == null ? "-" : `${coveragePercent}%`}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {summary.estimatedIssueCount} of {summary.openIssueCount} open items
                  </p>
                </div>
              </div>

              {coverageIsPoor && (
                <div className="flex gap-2.5 rounded-lg border border-amber-500/40 bg-amber-50/60 p-3 text-xs dark:bg-amber-950/20">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden />
                  <p>
                    <span className="font-medium">
                      {coveragePercent}% of the open work here is estimated, so this is a floor rather than a
                      forecast.
                    </span>{" "}
                    <span className="text-muted-foreground">
                      Estimating the rest in Jira is what turns it into one - nothing here can infer them.
                    </span>
                  </p>
                </div>
              )}

              {summary.projects.some((project) => project.items.some((item) => item.isOverrun)) && (
                <p className="text-xs text-destructive">
                  Some items are already over their estimate. The outstanding figure counts them as zero left, never
                  as negative, so it does not net an overrun off other work.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </Reveal>
  );
}
