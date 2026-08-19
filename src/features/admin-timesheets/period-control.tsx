"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
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
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const reduceMotion = useReducedMotion();

  function hrefFor(granularity: Granularity): string {
    // Anchored to today, so switching length shows the current period of that
    // length. The service snaps it to the right boundary.
    return `${pathname}?${filterQuery({ ...filters, granularity }, todayIso)}`;
  }

  // "This week" / "This month" - named after the length in view, so the button
  // says where it takes you.
  const thisPeriodLabel = `This ${GRANULARITY_LABELS[period.granularity].toLowerCase()}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Granularity. A segmented control rather than a dropdown: four fixed
          options that people switch between constantly should not cost a click
          to see. */}
      <LayoutGroup id="timesheet-granularity">
        <div
          role="group"
          aria-label="Period length"
          className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/40 p-1"
        >
          {GRANULARITIES.map((granularity) => {
            const isActive = granularity === filters.granularity;

            return (
              <button
                key={granularity}
                type="button"
                disabled={isPending}
                aria-pressed={isActive}
                onClick={() => {
                  if (isActive) return;
                  startTransition(() => router.push(hrefFor(granularity)));
                }}
                className={cn(
                  "relative rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  isPending && "cursor-wait",
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="granularity-pill"
                    className="absolute inset-0 rounded-lg bg-card shadow-sm ring-1 ring-border"
                    transition={reduceMotion ? { duration: 0 } : TRANSITION}
                  />
                )}
                <span className="relative">{GRANULARITY_LABELS[granularity]}</span>
              </button>
            );
          })}
        </div>
      </LayoutGroup>

      {/* Stepping is links, not state: a period is a real URL that can be
          bookmarked and sent to somebody. */}
      <div className="flex items-center gap-1 rounded-xl border border-border p-0.5">
        <Button asChild variant="ghost" size="icon" className="size-8">
          <Link
            href={`${pathname}?${filterQuery(filters, period.previousStart)}`}
            aria-label={`Previous ${GRANULARITY_LABELS[period.granularity].toLowerCase()}`}
            scroll={false}
          >
            <ChevronLeft aria-hidden />
          </Link>
        </Button>

        <span className="min-w-[150px] px-2 text-center text-sm font-medium tabular-nums">{period.label}</span>

        {period.hasNext ? (
          <Button asChild variant="ghost" size="icon" className="size-8">
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
          <Button variant="ghost" size="icon" className="size-8" disabled aria-label="Next period">
            <ChevronRight aria-hidden />
          </Button>
        )}
      </div>

      {/* Disabled rather than hidden when you are already on the current
          period: a control that vanishes is harder to find again than one that
          is visibly unavailable. */}
      {period.isCurrent ? (
        <Button variant="ghost" size="sm" disabled>
          <CalendarCheck aria-hidden />
          {thisPeriodLabel}
        </Button>
      ) : (
        <Button asChild variant="outline" size="sm">
          <Link href={`${pathname}?${filterQuery(filters, todayIso)}`} scroll={false}>
            <CalendarCheck aria-hidden />
            {thisPeriodLabel}
          </Link>
        </Button>
      )}
    </div>
  );
}
