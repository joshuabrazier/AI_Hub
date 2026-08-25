"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DailySeries } from "@/lib/timesheet/daily-series";
import { cn } from "@/lib/utils";

import { TimesheetPeriodDTO } from "./admin-timesheets.types";

// -------------------------------------------------------------------
// Weekly hours: Monday to Sunday, each day against a full day's capacity.
//
// Built from HTML and CSS rather than SVG, deliberately. The previous version
// used an SVG with preserveAspectRatio="none" so the plot would stretch to the
// container - which also stretched the text inside it, and the day numbers came
// out smeared across the axis. Percentage-height divs inside a flex row scale
// horizontally without touching type at all, so the labels stay crisp at any
// width. There is no viewBox to fight.
//
// Specs it keeps from the chart guidance:
//   - wide columns with a 6px gutter between them. The usual advice is to cap
//     a column near 24px and let the slot breathe, but at seven columns across
//     a full-width card that read as hairlines with a lot of nothing around
//     them. Filling most of the slot makes the day the unit you see.
//   - a 2px gap between stacked segments, so they read apart without a border
//   - solid hairline gridlines one step off the surface, never dashed
//   - the capacity target is a mark PER DAY, at that day's own height. It was
//     one line across, because capacity used to be a constant; recording which
//     days somebody works made that untrue, and a rule drawn straight across
//     claimed a target on days they do not work
//   - no number on every column: the axis, the tooltip and the table carry them
//   - a table view of the same figures, so nothing is hover-only
//
// Non-billable is not red. Training, leave and internal admin are real work;
// red is kept for time whose billable status nobody has set, which IS an error.
// -------------------------------------------------------------------

const PLOT_HEIGHT = 190;

type Band = {
  key: "billable" | "nonBillable" | "unset";
  label: string;
  fill: string;
  hours: (point: SeriesPoint) => number;
};

type SeriesPoint = DailySeries["points"][number];

// Stacked from the baseline up: billable first, so the column reads as "how
// much of this day earns" from the bottom, which is the question being asked.
const BANDS: Band[] = [
  { key: "billable", label: "Billable", fill: "var(--data-billable)", hours: (p) => p.billableHours },
  { key: "nonBillable", label: "Non-billable", fill: "var(--data-nonbillable)", hours: (p) => p.nonBillableHours },
  { key: "unset", label: "Unset", fill: "var(--destructive)", hours: (p) => p.unsetHours },
];

function formatHours(hours: number): string {
  return `${hours.toFixed(2)}h`;
}

// Whole-hour ticks that always include the top of the scale.
function axisTicks(top: number): number[] {
  const step = top <= 8 ? 2 : top <= 16 ? 4 : 6;
  const ticks: number[] = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);
  if (ticks[ticks.length - 1] !== top) ticks.push(top);
  return ticks;
}

export function ProductivityChart({
  series,
  period,
  title,
  previousHref,
  nextHref,
  className,
}: {
  series: DailySeries;
  period: TimesheetPeriodDTO;
  title: string;
  // Finished URLs, built on the server. NOT a function: every prop crossing
  // into a Client Component has to be serialisable, and React throws on a
  // function. This component previously took an hrefFor callback and broke the
  // page at runtime for exactly that reason.
  previousHref: string;
  nextHref: string;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  const reduceMotion = useReducedMotion();

  const { points, capacityHours, totals } = series;

  // True when the target is not what a reader would already assume - which is
  // "every weekday is a full day, weekends are not".
  //
  // A WEEKEND WITH NO TARGET IS NOT A VARIATION. It never had one, and saying
  // so would change the subtitle on every ordinary week view for no reason.
  // What counts is a WEEKDAY carrying no target, which only happens once
  // somebody's actual working days are recorded - or two working days
  // disagreeing about how long a full day is.
  const WEEKEND_LABELS = new Set(["Sat", "Sun"]);

  const workingPoints = points.filter((point) => point.capacityHours > 0);

  const daysOff = points.filter(
    (point) => point.capacityHours === 0 && !WEEKEND_LABELS.has(point.weekdayLabel),
  ).length;

  const targetVaries = daysOff > 0 || new Set(workingPoints.map((point) => point.capacityHours)).size > 1;
  const top = Math.max(2, Math.ceil(series.maxHours));
  const ticks = axisTicks(top);

  return (
    <Card className={className}>
      <CardHeader className="gap-3 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {period.granularity === "year"
                ? `One bar per month, each against that month's own working days. ${capacityHours.toFixed(2)}h a day across everyone in view.`
                : targetVaries
                  ? `Each day against its own target${daysOff > 0 ? `, and ${daysOff} ${daysOff === 1 ? "weekday is" : "weekdays are"} not worked` : ""}. No line is drawn where there is no target.`
                  : period.granularity === "week"
                    ? `Monday to Sunday, each day against ${capacityHours.toFixed(2)}h - a full day for everyone in view.`
                    : `Each day against ${capacityHours.toFixed(2)}h - a full day for everyone in view.`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Week stepping is links, not state: a week is a real URL that can
                be bookmarked and sent to the person whose week it is. */}
            <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
              <Button asChild variant="ghost" size="icon" className="size-8">
                <Link href={previousHref} aria-label="Previous week" scroll={false}>
                  <ChevronLeft aria-hidden />
                </Link>
              </Button>

              <span className="min-w-[124px] px-1 text-center text-sm font-medium tabular-nums">{period.label}</span>

              {period.hasNext ? (
                <Button asChild variant="ghost" size="icon" className="size-8">
                  <Link href={nextHref} aria-label="Next week" scroll={false}>
                    <ChevronRight aria-hidden />
                  </Link>
                </Button>
              ) : (
                // Disabled rather than hidden, so the control does not move
                // around as you step back through the weeks.
                <Button variant="ghost" size="icon" className="size-8" disabled aria-label="Next week">
                  <ChevronRight aria-hidden />
                </Button>
              )}
            </div>

            <Button variant="outline" size="sm" onClick={() => setShowTable((shown) => !shown)}>
              {showTable ? "Chart" : "Table"}
            </Button>
          </div>
        </div>

        {/* Two figures, both defined. The tool this replaces shows a "billable
            target" percentage against a target we do not hold, so it is not
            invented here. */}
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <Figure
            label="Utilisation"
            value={totals.utilisation === null ? "n/a" : `${Math.round(totals.utilisation * 100)}%`}
            detail={`${formatHours(totals.loggedHours)} of ${formatHours(totals.availableHours)}`}
          />
          <Figure
            label="Billable share"
            value={totals.billableShare === null ? "n/a" : `${Math.round(totals.billableShare * 100)}%`}
            detail={`${formatHours(totals.billableHours)} billable`}
          />
        </div>
      </CardHeader>

      <CardContent>
        {showTable ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Billable</TableHead>
                  <TableHead className="text-right">Non-billable</TableHead>
                  <TableHead className="text-right">Unset</TableHead>
                  <TableHead className="text-right">Logged</TableHead>
                  <TableHead className="text-right">Capacity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {points.map((point) => (
                  <TableRow key={point.date} className={cn(!point.isWorkingDay && "text-muted-foreground")}>
                    <TableCell className="whitespace-nowrap">
                      {point.weekdayLabel} {point.dayOfMonth}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatHours(point.billableHours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatHours(point.nonBillableHours)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {point.unsetHours > 0 ? formatHours(point.unsetHours) : "-"}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatHours(point.loggedHours)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {point.capacityHours > 0 ? formatHours(point.capacityHours) : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="flex gap-3">
            {/* Y axis. Its own column, so the tick labels sit outside the plot
                and cannot overlap a column. */}
            <div className="relative w-9 shrink-0" style={{ height: PLOT_HEIGHT }} aria-hidden>
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className="absolute right-0 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground"
                  style={{ top: `${(1 - tick / top) * 100}%` }}
                >
                  {tick}h
                </span>
              ))}
            </div>

            <div className="min-w-0 flex-1">
              <div className="relative" style={{ height: PLOT_HEIGHT }}>
                {/* Gridlines: solid hairlines, one step off the surface. */}
                {ticks.map((tick) => (
                  <div
                    key={tick}
                    className="absolute inset-x-0 border-t border-border"
                    style={{ top: `${(1 - tick / top) * 100}%` }}
                    aria-hidden
                  />
                ))}

                {/* THE CAPACITY TARGET, per day rather than one line across.

                    It used to be a single horizontal rule, because capacity was
                    a constant - every weekday was a full day for everyone. Now
                    that a person's actual working days can be recorded, it is
                    not: a Tue-Thu person has no target on Monday, and a rule
                    drawn straight across claimed one.

                    So each day carries its own mark, at its own height, and a
                    day with no capacity gets none. When every day does share a
                    capacity - the team views, and anybody whose days are unset
                    - the marks line up and read as the same rule as before. */}
                <div className="pointer-events-none absolute inset-0 flex items-end" aria-hidden>
                  {points.map((point) => (
                    <div key={`target-${point.date}`} className="relative h-full flex-1 px-[3px]">
                      {point.capacityHours > 0 && (
                        <div
                          className="absolute inset-x-[3px] border-t"
                          style={{
                            top: `${(1 - point.capacityHours / top) * 100}%`,
                            borderColor: "var(--primary)",
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>

                {/* The columns. */}
                <div className="absolute inset-0 flex items-end">
                  {points.map((point, index) => (
                    <div
                      key={point.date}
                      className="group flex h-full flex-1 items-end justify-center px-[3px]"
                      // One tooltip per day on a full-height target, so it is
                      // reachable without landing on a thin column.
                      title={
                        `${point.weekdayLabel} ${point.dayOfMonth}: ${formatHours(point.loggedHours)} logged` +
                        (point.capacityHours > 0
                          ? ` of ${formatHours(point.capacityHours)}`
                          : " (non-working day)") +
                        (point.billableHours > 0 ? `\nBillable ${formatHours(point.billableHours)}` : "") +
                        (point.nonBillableHours > 0 ? `\nNon-billable ${formatHours(point.nonBillableHours)}` : "") +
                        (point.unsetHours > 0 ? `\nUnset ${formatHours(point.unsetHours)}` : "")
                      }
                    >
                      <div className="relative h-full w-full max-w-[72px]">
                        {/* Unused capacity: a recessive track showing the room
                            the day had, never a competing series. */}
                        {point.capacityHours > 0 && (
                          <div
                            className="absolute inset-x-0 bottom-0 rounded-t bg-muted transition-colors group-hover:bg-accent"
                            style={{ height: `${(point.capacityHours / top) * 100}%` }}
                            aria-hidden
                          />
                        )}

                        {/* Stacked bands, bottom up, each offset by the 2px gap
                            that does the separating. */}
                        {(() => {
                          let offsetPx = 0;

                          return BANDS.map((band) => {
                            const hours = band.hours(point);
                            if (hours <= 0) return null;

                            const heightPercent = (hours / top) * 100;
                            const bottom = offsetPx;
                            offsetPx += (heightPercent / 100) * PLOT_HEIGHT + 2;

                            return (
                              <motion.div
                                key={band.key}
                                className="absolute inset-x-0 rounded-t"
                                style={{ background: band.fill, bottom }}
                                initial={reduceMotion ? false : { height: 0 }}
                                animate={{ height: `${heightPercent}%` }}
                                transition={
                                  reduceMotion
                                    ? { duration: 0 }
                                    : { duration: 0.35, ease: [0.22, 1, 0.36, 1], delay: index * 0.03 }
                                }
                              />
                            );
                          });
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Axis labels. Real HTML text in a matching flex row, so they
                  line up under their column and are never scaled.

                  What is shown depends on the granularity, because the same
                  treatment does not work at every length:
                    week/fortnight - the weekday over the date, all of them
                    month          - dates only, thinned; weekday names on 20+
                                     bars were noise and collided
                    year           - the month name, all twelve */}
              <div className="mt-2 flex">
                {points.map((point) => {
                  const isYear = period.granularity === "year";
                  const isShort = period.granularity === "week" || period.granularity === "fortnight";

                  // Every bar gets its date, however many there are: the whole
                  // point of a daily axis is being able to find a particular
                  // day on it.
                  //
                  // Weekday names appear only on a week or a fortnight, where
                  // all of them fit. Scattered across a month they read as
                  // noise - a handful of names over some columns and not
                  // others tells you nothing the dates do not.
                  const showWeekday = isShort;

                  return (
                    <div key={point.date} className="min-w-0 flex-1 text-center">
                      {isYear ? (
                        <p className="text-xs font-medium text-foreground">{point.weekdayLabel}</p>
                      ) : (
                        <>
                          {/* The weekday name is the part that collides, so it
                              thins out on a long period. */}
                          {showWeekday && (
                            <p
                              className={cn(
                                "text-[11px] font-medium leading-tight",
                                point.isWorkingDay ? "text-foreground" : "text-muted-foreground",
                              )}
                            >
                              {point.weekdayLabel}
                            </p>
                          )}
                          {/* Every day keeps its number. */}
                          <p
                            className={cn(
                              "text-[11px] tabular-nums leading-tight",
                              point.isWorkingDay ? "text-muted-foreground" : "text-muted-foreground/60",
                            )}
                          >
                            {point.dayOfMonth}
                          </p>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className="mt-1 text-center text-xs text-muted-foreground">
                {period.granularity === "year" ? "Month" : "Day of month"}
              </p>
            </div>
          </div>
        )}

        {/* A legend is always present for two or more series, so identity never
            depends on remembering a colour. */}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3">
          {BANDS.map((band) => (
            <LegendKey key={band.key} swatch={band.fill} label={band.label} />
          ))}
          <LegendKey swatch="var(--muted)" label="Unused capacity" />
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ background: "var(--primary)" }}
              aria-hidden
            />
            {capacityHours}h target
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// Text wears text tokens; the coloured swatch beside it carries identity.
function LegendKey({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="inline-block size-2.5 rounded-sm" style={{ background: swatch }} aria-hidden />
      {label}
    </span>
  );
}

// Proportional digits, not tabular: at this size tabular makes a number like
// 121 look loose.
function Figure({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-heading text-2xl font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
