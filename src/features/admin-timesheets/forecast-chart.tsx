import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BurnUpPoint } from "@/lib/timesheet/forecast";
import { formatCents } from "@/lib/timesheet/revenue";
import { cn } from "@/lib/utils";

import { Reveal } from "./timesheet-motion";

// -------------------------------------------------------------------
// The forecast chart: cumulative cost and value across a period, with the
// committed remainder carried to the end.
//
// CUMULATIVE BARS rather than a line, and built from HTML and CSS like every
// other chart here - no dependency, nothing scales text, every fill is a
// token. A rising bar per weekday reads as "where this lands" without the
// reader adding daily figures up in their head, and it needs no diagonal,
// which is the thing CSS is bad at.
//
// THE FORECAST IS VISUALLY DIFFERENT, and that is the whole job of this
// component. A projected segment that looked measured would be worse than no
// chart: forecast bars are hatched and outlined, actual bars are solid, the
// legend says which is which, and today is marked. Nothing here infers actual
// versus forecast from the date - the engine flags each point, so the drawing
// and the arithmetic cannot disagree.
//
// A NULL POINT ENDS THE SERIES rather than dropping to zero. Once a day cannot
// be costed - somebody without a rate - every later cumulative figure is
// unknowable too, and a bar returning to the axis would read as a day that
// cost nothing.
// -------------------------------------------------------------------

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayLabel(iso: string): { weekday: string; day: string } {
  const parsed = new Date(`${iso}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime())) return { weekday: "", day: "" };

  return {
    weekday: WEEKDAY_SHORT[parsed.getUTCDay()] ?? "",
    day: String(parsed.getUTCDate()),
  };
}

export function ForecastChart({
  points,
  periodLabel,
  projectedCostCents,
  projectedValueCents,
  weekdaysRemaining,
  index,
}: {
  points: BurnUpPoint[];
  periodLabel: string;
  projectedCostCents: number | null;
  projectedValueCents: number | null;
  weekdaysRemaining: number;
  index: number;
}) {
  const drawable = points.filter((point) => point.cumulativeCostCents !== null);

  // Nothing to draw is not an error state worth a panel. One weekday period,
  // or no cost rates at all, and this simply does not appear.
  if (drawable.length < 2) return null;

  // Scaled to the largest figure across BOTH series, so cost and value are
  // measured against one axis and can be compared by height. Two scales would
  // make a smaller value look larger than the cost it has to beat.
  const ceiling = Math.max(
    ...drawable.map((point) =>
      Math.max(point.cumulativeCostCents ?? 0, point.cumulativeValueCents ?? 0),
    ),
    1,
  );

  const lastActual = [...points].reverse().find((point) => point.isActual);

  return (
    <Reveal index={index}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where this period lands</CardTitle>
          <CardDescription>
            Cumulative cost and chargeable value across {periodLabel}.{" "}
            {weekdaysRemaining > 0
              ? `The last ${weekdaysRemaining} ${weekdaysRemaining === 1 ? "bar is" : "bars are"} projected from contracted days, assuming no leave.`
              : "The period has finished, so every bar is actual."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* THE COLUMNS MUST STRETCH, not sit at the end.
              `items-end` here made every column shrink to the height of its
              own date label, so the bar row's `h-full` resolved against about
              nothing and the whole chart rendered as invisible slivers. The
              bars need a box with real height to grow inside, which is what
              `items-stretch` plus `flex-1` on the bar row gives them. */}
          {/* A baseline, so the bars are read as standing on something rather
              than floating in the card. */}
          <div className="flex h-48 items-stretch gap-1 border-b border-border sm:gap-1.5">
            {points.map((point) => {
              const cost = point.cumulativeCostCents;
              const value = point.cumulativeValueCents;

              // A floor of 1% only for a NON-ZERO figure, so a small amount
              // stays visible. A cumulative zero draws nothing: a sliver there
              // would imply a little of something on a day with none of it.
              const costHeight = barHeight(cost, ceiling);
              const valueHeight = barHeight(value, ceiling);

              const { weekday, day } = dayLabel(point.date);
              const isToday = point.date === lastActual?.date;

              return (
                <div key={point.date} className="flex h-full min-w-0 flex-1 flex-col">
                  {/* Takes every pixel the labels do not, so the percentages
                      above are measured against something. */}
                  <div className="flex min-h-0 flex-1 items-end justify-center gap-0.5">
                    {/* Side by side rather than stacked: cost and value are not
                        parts of a whole, they are two quantities being
                        compared, and stacking would imply they sum. */}
                    <Bar
                      heightPercent={valueHeight}
                      isActual={point.isActual}
                      tone="value"
                      title={`${point.date}: ${formatCents(value)} value${point.isActual ? "" : " (projected)"}`}
                    />
                    <Bar
                      heightPercent={costHeight}
                      isActual={point.isActual}
                      tone="cost"
                      title={`${point.date}: ${formatCents(cost)} cost${point.isActual ? "" : " (projected)"}`}
                    />
                  </div>

                  <div className="mt-2 flex flex-col items-center gap-0.5">
                    <span
                      className={cn(
                        "text-[10px] leading-none tabular-nums",
                        isToday ? "font-semibold text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {day}
                    </span>
                    <span className="text-[10px] leading-none text-muted-foreground">{weekday}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <dl className="grid grid-cols-2 gap-4 border-t border-border pt-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Projected value
              </dt>
              <dd className="mt-0.5 font-heading text-lg font-semibold text-foreground">
                {formatCents(projectedValueCents)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Projected cost
              </dt>
              <dd className="mt-0.5 font-heading text-lg font-semibold text-foreground">
                {formatCents(projectedCostCents)}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <Key className="bg-primary" label="Value" />
            <Key className="bg-data-cost" label="Cost" />
            <Key className="border border-dashed border-muted-foreground/60 bg-transparent" label="Projected" />
          </div>
        </CardContent>
      </Card>
    </Reveal>
  );
}

// -------------------------------------------------------------------
// One bar. `title` carries the figure so a pointer reveals it without this
// needing to become a client component for a tooltip.
// -------------------------------------------------------------------
function Bar({
  heightPercent,
  isActual,
  tone,
  title,
}: {
  heightPercent: number;
  isActual: boolean;
  tone: "cost" | "value";
  title: string;
}) {
  const solid = tone === "cost" ? "bg-data-cost" : "bg-primary";
  // Hatched and outlined rather than merely paler: a lighter fill of the same
  // colour reads as "less of the same thing", which is exactly the wrong
  // message for a figure that has not happened yet.
  const projected =
    tone === "cost"
      ? "border border-dashed border-data-cost bg-data-cost/20"
      : "border border-dashed border-primary bg-primary/20";

  return (
    <div
      title={title}
      // Capped rather than fixed, so five weekdays give substantial bars and
      // twenty-one give thin ones without either overflowing.
      className={cn("w-full max-w-[16px] rounded-t-sm", isActual ? solid : projected)}
      style={{ height: `${heightPercent}%` }}
    />
  );
}

function barHeight(cents: number | null, ceiling: number): number {
  if (cents === null || cents <= 0) return 0;
  return Math.max(1, Math.round((cents / ceiling) * 100));
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-sm", className)} aria-hidden="true" />
      {label}
    </span>
  );
}
