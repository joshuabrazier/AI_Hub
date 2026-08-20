import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents, formatRate } from "@/lib/timesheet/revenue";
import { cn } from "@/lib/utils";

import type { RevenueDTO } from "./admin-timesheets-revenue.service";
import { Reveal } from "./timesheet-motion";

// -------------------------------------------------------------------
// The money panels.
//
// Built from HTML and CSS like the rest of the charts here, so nothing scales
// text and the labels stay crisp at any width. Every fill is a design token.
//
// TWO RULES CARRIED FROM THE ENGINE, and both are visible in the markup:
//
//   - a dash is not a zero. An unknown figure renders "-", because a margin
//     shown as 0% when no cost rate exists is a lie somebody would act on.
//   - unvalued hours are stated, not hidden. If billable time had no
//     applicable rate, the value on screen is an UNDERSTATEMENT and the panel
//     says so - otherwise the number reads as the whole picture.
// -------------------------------------------------------------------

function percent(ratio: number | null): string {
  return ratio === null ? "-" : `${Math.round(ratio * 100)}%`;
}

// -------------------------------------------------------------------
// The headline figures.
// -------------------------------------------------------------------
export function RevenueTiles({ revenue, index }: { revenue: RevenueDTO; index: number }) {
  if (!revenue.configured) {
    return (
      <Reveal index={index}>
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-3">
          <p className="text-sm font-medium text-foreground">No charge rates set</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Open somebody on the Staff tab and set a rate to see what this period is worth. Until then only
            hours are reported.
          </p>
        </div>
      </Reveal>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MoneyTile
          label="Chargeable value"
          value={formatCents(revenue.chargeableValueCents)}
          hint={`${revenue.billableHours.toFixed(2)}h billable`}
          index={index}
        />
        <MoneyTile
          label="Effective rate"
          value={formatRate(revenue.effectiveRatePerLoggedHourCents)}
          // The diluted figure. Named explicitly because the difference
          // between this and the achieved rate IS the utilisation story.
          hint={`per logged hour; ${formatRate(revenue.chargeRatePerBillableHourCents)} achieved`}
          index={index + 1}
        />
        <MoneyTile
          label="Margin"
          value={formatCents(revenue.marginCents)}
          hint={
            revenue.marginRatio === null
              ? revenue.uncostedBillableHours > 0
                ? `${revenue.uncostedBillableHours.toFixed(2)}h has no cost rate`
                : "No cost rates recorded"
              : `${percent(revenue.marginRatio)} of value`
          }
          emphasis={revenue.marginRatio === null ? "muted" : "normal"}
          index={index + 2}
        />
        <MoneyTile
          label="Cost"
          value={formatCents(revenue.costCents)}
          hint={revenue.costCents === null ? "Partial or unrecorded" : "At recorded cost rates"}
          emphasis="muted"
          index={index + 3}
        />
      </div>

      {revenue.unratedBillableHours > 0 && (
        <p
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          {revenue.unratedBillableHours.toFixed(2)}h of billable time has no rate for the date it was worked,
          so the value above is an understatement.
        </p>
      )}
    </div>
  );
}

function MoneyTile({
  label,
  value,
  hint,
  emphasis = "normal",
  index,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: "normal" | "muted";
  index: number;
}) {
  return (
    <Reveal index={index}>
      <div className="rounded-xl border border-border bg-card px-4 py-3.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={cn(
            "mt-1 font-heading text-2xl font-bold",
            emphasis === "muted" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
    </Reveal>
  );
}

// -------------------------------------------------------------------
// Concentration: how much of the book sits with one client.
//
// A horizontal ranked bar rather than a pie, because the question is "is any
// one of these too big", and lengths from a common baseline answer that. A pie
// makes the reader compare angles.
//
// The concentration LINE is the point of the panel: a single client above
// forty per cent of value is a business risk, and stating the threshold is
// what turns a chart into a finding. It is drawn from the engine's valueShare,
// never recomputed here.
// -------------------------------------------------------------------
const CONCENTRATION_WARNING = 0.4;

export function ConcentrationCard({
  revenue,
  limit = 8,
  index,
}: {
  revenue: RevenueDTO;
  limit?: number;
  index: number;
}) {
  const slices = revenue.byJob.filter((slice) => slice.chargeableValueCents !== null).slice(0, limit);

  if (!revenue.configured || slices.length === 0) return null;

  const largest = slices[0];
  const concentrated = largest.valueShare !== null && largest.valueShare >= CONCENTRATION_WARNING;

  return (
    <Reveal index={index}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where the value is</CardTitle>
          <CardDescription>
            {concentrated
              ? `${largest.label} is ${percent(largest.valueShare)} of chargeable value this period - worth watching.`
              : "Chargeable value by job, largest first."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-2.5">
          {slices.map((slice) => {
            // Scaled against the LARGEST bar, not against the total, so the
            // smaller rows stay readable. The share is printed as a number
            // beside it, so no information rests on the bar length alone.
            const width =
              largest.chargeableValueCents && slice.chargeableValueCents
                ? Math.max(2, Math.round((slice.chargeableValueCents / largest.chargeableValueCents) * 100))
                : 2;

            const over = slice.valueShare !== null && slice.valueShare >= CONCENTRATION_WARNING;

            return (
              <div key={slice.key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-foreground">{slice.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatCents(slice.chargeableValueCents)}
                    <span className="ml-2">{percent(slice.valueShare)}</span>
                  </span>
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", over ? "bg-amber-500" : "bg-primary")}
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })}

          <p className="pt-1 text-xs text-muted-foreground">
            Amber marks a job at {Math.round(CONCENTRATION_WARNING * 100)}% or more of the period&rsquo;s value.
          </p>
        </CardContent>
      </Card>
    </Reveal>
  );
}
