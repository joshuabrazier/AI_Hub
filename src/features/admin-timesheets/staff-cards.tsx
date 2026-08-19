import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

import { StaffSummaryDTO, TimesheetFiltersDTO } from "./admin-timesheets.types";
import { StaffTargetDialog } from "./staff-target-dialog";
import { LiftOnHover, Reveal } from "./timesheet-motion";
import { filterQuery } from "./timesheet-shell";

// -------------------------------------------------------------------
// The team list.
//
// One row per person, clickable, replacing the dropdown that used to sit in
// the filter bar. Clicking a name is a shorter path than opening a menu of
// account ids, and it puts the list of people on the page where the comparison
// between them is the point.
//
// Each row carries the two numbers the dashboard exists for: how much of their
// capacity they used, and how much of their time billed against their target.
// -------------------------------------------------------------------

function formatPercent(ratio: number | null): string {
  if (ratio === null) return "n/a";
  return `${Math.round(ratio * 100)}%`;
}

// A meter whose fill carries the state. The unfilled track is a lighter step
// of the same idea, so the bar reads across its whole width rather than only
// where it happens to stop.
function Meter({ ratio, tone }: { ratio: number | null; tone: "neutral" | "good" | "under" }) {
  const clamped = ratio === null ? 0 : Math.max(0, Math.min(1, ratio));

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          tone === "good" && "bg-[var(--data-billable)]",
          tone === "under" && "bg-[var(--data-nonbillable)]",
          tone === "neutral" && "bg-primary",
        )}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}

export function StaffList({ people, filters }: { people: StaffSummaryDTO[]; filters: TimesheetFiltersDTO }) {
  if (people.length === 0) return null;

  return (
    <div className="grid gap-3">
      {people.map((person, index) => {
        const href = `${ROUTES.ADMIN_TIMESHEETS_STAFF}/${encodeURIComponent(person.personId)}?${filterQuery(filters)}`;

        return (
          <Reveal key={person.personId} index={index}>
            <LiftOnHover>
              <Card className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                    {/* The whole name area is the link, so the click target is
                        generous rather than the width of the text. */}
                    <Link
                      href={href}
                      className="group flex min-w-0 flex-1 items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground group-hover:underline">
                          {person.personName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {person.target.workingDaysPerWeek} {person.target.workingDaysPerWeek === 1 ? "day" : "days"} a
                          week, {person.target.hoursPerDay}h a day
                          {person.target.isDefault && " (default)"}
                        </p>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>

                    <div className="grid grid-cols-2 gap-4 sm:w-[420px] sm:shrink-0 sm:grid-cols-2">
                      {/* Utilisation against THEIR capacity. */}
                      <div>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Utilisation</span>
                          <span className="text-sm font-semibold tabular-nums text-foreground">
                            {formatPercent(person.utilisation)}
                          </span>
                        </div>
                        <Meter ratio={person.utilisation} tone="neutral" />
                        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                          {person.loggedHours.toFixed(2)}h of {person.capacityHours.toFixed(2)}h
                        </p>
                      </div>

                      {/* Billable share against their target. */}
                      <div>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Billable</span>
                          <span className="text-sm font-semibold tabular-nums text-foreground">
                            {formatPercent(person.billableShare)}
                          </span>
                        </div>
                        <Meter
                          ratio={person.billableShare}
                          tone={
                            person.meetsBillableTarget === null
                              ? "neutral"
                              : person.meetsBillableTarget
                                ? "good"
                                : "under"
                          }
                        />
                        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                          {person.billableTargetPercent === null ? (
                            "No target set"
                          ) : (
                            <>
                              Target {person.billableTargetPercent}%
                              {person.billableVariance !== null && (
                                <>
                                  {" "}
                                  <span
                                    className={cn(
                                      person.billableVariance >= 0
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : "text-destructive",
                                    )}
                                  >
                                    ({person.billableVariance >= 0 ? "+" : ""}
                                    {person.billableVariance.toFixed(0)} pts)
                                  </span>
                                </>
                              )}
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0">
                      <StaffTargetDialog
                        personId={person.personId}
                        personName={person.personName}
                        target={person.target}
                      />
                    </div>
                  </div>

                  {/* Somebody contracted to work who logged nothing is the most
                      important row on this page, so it says so rather than
                      showing a silent row of zeroes. */}
                  {person.worklogCount === 0 && (
                    <div className="border-t border-border bg-muted/40 px-4 py-2">
                      <Badge variant="warning">Nothing logged in this period</Badge>
                    </div>
                  )}
                </CardContent>
              </Card>
            </LiftOnHover>
          </Reveal>
        );
      })}
    </div>
  );
}
