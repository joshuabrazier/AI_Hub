"use client";

import Link from "next/link";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";

import { Button } from "@/components/ui/button";
import { GRANULARITIES, GRANULARITY_LABELS, type Granularity } from "@/lib/timesheet/period";
import { cn } from "@/lib/utils";

import { AdminTimesheetsDTO } from "./admin-timesheets.types";
import { filterQuery } from "./timesheet-shell";

// -------------------------------------------------------------------
// The period control: one span of time for the whole screen.
//
// Week, fortnight, month or year, with arrows that step by whatever is
// selected. Everything on the page reads this - the chart, the tables, the
// figures and the export. Before it, the month drove the tables and the week
// drove the chart, so two halves of a page could describe different spans and
// nothing said so.
//
// Switching granularity jumps to the CURRENT week, fortnight, month or year
// rather than carrying the old anchor across. Flicking between lengths is
// nearly always asking "and how does that look this week?", so landing on
// today's period is the answer wanted almost every time; the arrows are there
// to go back once you have chosen a length.
// -------------------------------------------------------------------

const TRANSITION = { duration: 0.2, ease: [0.22, 1, 0.36, 1] } as const;

export function PeriodControl({
  filters,
  period,
  todayIso,
  pathname,
}: {
  filters: AdminTimesheetsDTO["filters"];
  period: AdminTimesheetsDTO["period"];
  todayIso: string;
  pathname: string;
}) {
  const [isPending, startTransition] = useTransition();
  const reduceMotion = useReducedMotion();

  function hrefFor(granularity: Granularity): string {
    // Anchored to today, so switching length shows the current period of that
    // length. The service snaps it to the right boundary.
    return `${pathname}?${filterQuery({ ...filters, granularity }, todayIso)}`;
  }


  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Granularity. A segmented control rather than a dropdown: four fixed
          options that people switch between constantly should not cost a click
          to see. */}
      <LayoutGroup id="timesheet-granularity">
        <div
          role="group"
          aria-label="Period length"
          className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
        >
          {GRANULARITIES.map((granularity) => {
            const isActive = granularity === filters.granularity;

            return (
              // A LINK, not a button. Each of these is a real URL that the
              // arrows beside them already navigate to as links, and the
              // difference is not cosmetic: Next prefetches a Link when it
              // enters the viewport, so the page is being fetched while the
              // pointer is still travelling. A button calling router.push
              // cannot be prefetched, which made every switch between week,
              // month and year a cold round trip to a database in Sydney.
              //
              // It also makes them behave like links, because they are ones -
              // middle-click and copy-address now work.
              <Link
                key={granularity}
                href={hrefFor(granularity)}
                scroll={false}
                aria-current={isActive ? "page" : undefined}
                aria-disabled={isActive || undefined}
                onClick={(event) => {
                  if (isActive) {
                    event.preventDefault();
                    return;
                  }
                  startTransition(() => {});
                }}
                className={cn(
                  "relative rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  isPending && "cursor-wait",
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="granularity-pill"
                    className="absolute inset-0 rounded-md bg-card shadow-sm ring-1 ring-border"
                    transition={reduceMotion ? { duration: 0 } : TRANSITION}
                  />
                )}
                <span className="relative">{GRANULARITY_LABELS[granularity]}</span>
              </Link>
            );
          })}
        </div>
      </LayoutGroup>

      {/* The stepper. Its LABEL is the way back to the current period, rather
          than a separate button beside it - one fewer control, and the thing
          you click is the thing you want to change. */}
      <div className="inline-flex items-center rounded-lg border border-border">
        {/* Stops at the first period on record, the same way the forward
            arrow stops at the current one. Walking back into months that
            predate the records showed empty screens that looked like lost
            data rather than like history that never existed. */}
        {period.hasPrevious ? (
          <Button asChild variant="ghost" size="icon" className="size-8 rounded-r-none">
            <Link
              href={`${pathname}?${filterQuery(filters, period.previousStart)}`}
              aria-label={`Previous ${GRANULARITY_LABELS[period.granularity].toLowerCase()}`}
              scroll={false}
            >
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-r-none"
            disabled
            aria-label={`Previous ${GRANULARITY_LABELS[period.granularity].toLowerCase()}`}
            title="Nothing recorded before this"
          >
            <ChevronLeft aria-hidden />
          </Button>
        )}

        {period.isCurrent ? (
          <span className="min-w-[142px] px-1 text-center text-sm font-medium tabular-nums text-foreground">
            {period.label}
          </span>
        ) : (
          <Link
            href={`${pathname}?${filterQuery(filters, todayIso)}`}
            scroll={false}
            title={`Back to this ${GRANULARITY_LABELS[period.granularity].toLowerCase()}`}
            className="min-w-[142px] px-1 text-center text-sm font-medium tabular-nums text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {period.label}
          </Link>
        )}

        {period.hasNext ? (
          <Button asChild variant="ghost" size="icon" className="size-8 rounded-l-none">
            <Link
              href={`${pathname}?${filterQuery(filters, period.nextStart)}`}
              aria-label={`Next ${GRANULARITY_LABELS[period.granularity].toLowerCase()}`}
              scroll={false}
            >
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        ) : (
          // Disabled rather than hidden, so the control does not shift around
          // as you step back through periods.
          <Button variant="ghost" size="icon" className="size-8 rounded-l-none" disabled aria-label="Next period">
            <ChevronRight aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
