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
          <div className="flex items-end gap-1.5 sm:gap-2" style={{ height: "10rem" }}>
            {points.map((point) => {
              const cost = point.cumulativeCostCents;
              const value = point.cumulativeValueCents;

              const costHeight = cost === null ? 0 : Math.max(1, Math.round((cost / ceiling) * 100));
              const valueHeight = value === null ? 0 : Math.max(1, Math.round((value / ceiling) * 100));

              const { weekday, day } = dayLabel(point.date);

              return (
                <div key={point.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  {/* Two bars side by side rather than stacked: cost and value
                      are not parts of a whole, they are two quantities being
                      compared, and stacking would imply they sum. */}
                  <div className="flex h-full w-full items-end justify-center gap-0.5">
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

                  <span
                    className={cn(
                      "text-[10px] leading-none tabular-nums",
                      point.date === lastActual?.date ? "font-semibold text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {day}
                  </span>
                  <span className="text-[10px] leading-none text-muted-foreground">{weekday}</span>
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
            <Key className="bg-amber-500" label="Cost" />
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
  const solid = tone === "cost" ? "bg-amber-500" : "bg-primary";
  // Hatched and outlined rather than merely paler: a lighter fill of the same
  // colour reads as "less of the same thing", which is exactly the wrong
  // message for a figure that has not happened yet.
  const projected =
    tone === "cost"
      ? "border border-dashed border-amber-500 bg-amber-500/20"
      : "border border-dashed border-primary bg-primary/20";

  return (
    <div
      title={title}
      className={cn("w-full max-w-3 rounded-t-sm", isActual ? solid : projected)}
      style={{ height: `${heightPercent}%` }}
    />
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-sm", className)} aria-hidden="true" />
      {label}
    </span>
  );
}
