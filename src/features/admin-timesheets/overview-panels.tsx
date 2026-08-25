import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InvoiceReadiness, JobSlice, SplitSlice } from "@/lib/timesheet/overview-series";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

import { Reveal } from "./timesheet-motion";

// -------------------------------------------------------------------
// Overview panels.
//
// Built from HTML and CSS, like the weekly chart, so nothing scales text and
// the labels stay crisp at any width. Every fill is a design token.
//
// The colour rule across all of these: teal is billable, warm is
// non-billable, red is only ever time whose billable status nobody has set.
// Non-billable is not a failure - training, leave and internal admin are real
// work - so it never wears the danger colour.
// -------------------------------------------------------------------

function hours(value: number): string {
  return `${value.toFixed(2)}h`;
}

function percent(ratio: number | null): string {
  if (ratio === null) return "n/a";
  return `${Math.round(ratio * 100)}%`;
}

// -------------------------------------------------------------------
// Where the time went: client work versus our own overheads.
//
// One stacked bar rather than a pie. Two or three categories compared at a
// glance is exactly what a bar does better, and it keeps the billable split
// visible inside each category.
// -------------------------------------------------------------------
export function CategorySplitCard({ categories, index }: { categories: SplitSlice[]; index: number }) {
  if (categories.length === 0) return null;

  const total = categories.reduce((sum, slice) => sum + slice.hours, 0);

  return (
    <Reveal index={index}>
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Internal vs external</CardTitle>
          <CardDescription>Where the period&apos;s time went, and how much of each bills.</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {categories.map((slice) => (
            <div key={slice.key}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{slice.label}</span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {hours(slice.hours)} · {Math.round(slice.share * 100)}%
                </span>
              </div>

              {/* The bar is the category; the segments inside are its billable
                  split, so one mark answers two questions. */}
              <div className="mt-1.5 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                {slice.billableHours > 0 && (
                  <div
                    style={{ width: `${(slice.billableHours / slice.hours) * 100}%`, background: "var(--data-billable)" }}
                    aria-hidden
                  />
                )}
                {slice.nonBillableHours > 0 && (
                  <div
                    style={{
                      width: `${(slice.nonBillableHours / slice.hours) * 100}%`,
                      background: "var(--data-nonbillable)",
                    }}
                    aria-hidden
                  />
                )}
                {slice.unsetHours > 0 && (
                  <div
                    style={{ width: `${(slice.unsetHours / slice.hours) * 100}%`, background: "var(--destructive)" }}
                    aria-hidden
                  />
                )}
              </div>

              <p className="mt-1 text-xs text-muted-foreground">
                {hours(slice.billableHours)} billable
                {slice.nonBillableHours > 0 && ` · ${hours(slice.nonBillableHours)} non-billable`}
                {slice.unsetHours > 0 && ` · ${hours(slice.unsetHours)} unset`}
              </p>
            </div>
          ))}

          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            {hours(total)} across {categories.length} {categories.length === 1 ? "category" : "categories"}
          </p>
        </CardContent>
      </Card>
    </Reveal>
  );
}

// -------------------------------------------------------------------
// Which jobs are consuming the time.
//
// Horizontal bars, longest first, because the comparison is between labels of
// very different lengths and a horizontal bar gives the label room to be read.
// -------------------------------------------------------------------
export function TopJobsCard({ jobs, index }: { jobs: JobSlice[]; index: number }) {
  if (jobs.length === 0) return null;

  const top = jobs.reduce((max, job) => Math.max(max, job.hours), 0) || 1;

  return (
    <Reveal index={index}>
      <Card className="h-full">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Where the time went</CardTitle>
              <CardDescription>Jobs consuming the most hours this period.</CardDescription>
            </div>
            <Link
              href={ROUTES.ADMIN_TIMESHEETS_JOBS}
              className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              All jobs
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {jobs.map((job) => (
            <div key={job.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-foreground">{job.label}</span>
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{hours(job.hours)}</span>
              </div>

              <div className="mt-1 flex h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="flex"
                  style={{ width: `${(job.hours / top) * 100}%` }}
                  title={`${job.label}: ${hours(job.hours)}`}
                >
                  {job.billableHours > 0 && (
                    <div
                      style={{
                        width: `${(job.billableHours / job.hours) * 100}%`,
                        background: "var(--data-billable)",
                      }}
                      aria-hidden
                    />
                  )}
                  {job.nonBillableHours > 0 && (
                    <div
                      style={{
                        width: `${(job.nonBillableHours / job.hours) * 100}%`,
                        background: "var(--data-nonbillable)",
                      }}
                      aria-hidden
                    />
                  )}
                  {job.unsetHours > 0 && (
                    <div
                      style={{ width: `${(job.unsetHours / job.hours) * 100}%`, background: "var(--destructive)" }}
                      aria-hidden
                    />
                  )}
                </div>
              </div>

              <p className="mt-0.5 text-xs text-muted-foreground">
                {job.category ?? "No category"}
                {job.peopleCount > 0 && ` · ${job.peopleCount} ${job.peopleCount === 1 ? "person" : "people"}`}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </Reveal>
  );
}

// -------------------------------------------------------------------
// How much of this period could actually go on an invoice today.
//
// Stated in HOURS rather than as a count of entries. "Nine entries need a
// description" is easy to shrug at; "seven hours cannot be itemised" is not.
// -------------------------------------------------------------------
export function ReadinessCard({ readiness, index }: { readiness: InvoiceReadiness; index: number }) {
  const blocked = readiness.undescribedBillableHours > 0 || readiness.unsetHours > 0;

  return (
    <Reveal index={index}>
      <Card className={cn("h-full", blocked && "border-destructive/30")}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ready to invoice</CardTitle>
          <CardDescription>Billable time that also has a work description against it.</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div>
            <p className="font-heading text-3xl font-bold text-foreground">{hours(readiness.readyHours)}</p>
            <p className="text-sm text-muted-foreground">
              of {hours(readiness.billableHours)} billable ({percent(readiness.readyShare)})
            </p>
          </div>

          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
            {readiness.billableHours > 0 && (
              <>
                <div
                  style={{
                    width: `${(readiness.readyHours / readiness.billableHours) * 100}%`,
                    background: "var(--data-billable)",
                  }}
                  aria-hidden
                />
                <div
                  style={{
                    width: `${(readiness.undescribedBillableHours / readiness.billableHours) * 100}%`,
                    background: "var(--destructive)",
                  }}
                  aria-hidden
                />
              </>
            )}
          </div>

          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Billable, no description</dt>
              <dd className={cn("tabular-nums", readiness.undescribedBillableHours > 0 && "font-medium text-destructive")}>
                {hours(readiness.undescribedBillableHours)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Billable status unset</dt>
              <dd className={cn("tabular-nums", readiness.unsetHours > 0 && "font-medium text-destructive")}>
                {hours(readiness.unsetHours)}
              </dd>
            </div>
          </dl>

          {blocked && (
            <Link href={ROUTES.ADMIN_TIMESHEETS_REVIEW}>
              <Badge variant="destructive">Fix these in Review</Badge>
            </Link>
          )}
        </CardContent>
      </Card>
    </Reveal>
  );
}

