"use client";

import { cn } from "@/lib/utils";

import { formatMinutesAsClock, type BudgetRollupDTO } from "../delivery.types";

// -------------------------------------------------------------------
// One progress bar, drawn from a BudgetRollupDTO and nothing else.
//
// THE ARITHMETIC IS ALREADY FINISHED when it gets here. `budgetProgress` in
// delivery.types.ts rounds `percentUsed` once, clamps `barPercent` for the
// width and answers the two cases a naive division gets wrong - so this
// component divides nothing, and every bar on the screen rounds the same
// way. A percentage computed in a component is how a group bar and the
// project bar above it end up disagreeing about the same minutes.
//
// THE TWO AWKWARD CASES, and what each one looks like here:
//
//   NO BUDGET. `percentUsed` is null, and there is no bar at all - not an
//   empty one and certainly not a full one. Dividing by nought gives
//   Infinity, and a bar guarded to 100% reads as "all spent" when the truth
//   is that nobody has budgeted this yet. A sentence is the honest answer.
//
//   OVER BUDGET. The bar is full and the figure beside it says 140%, which
//   is why `barPercent` and `percentUsed` are two fields rather than one.
//
// Colour comes from the semantic tokens only, so rebranding stays a one-file
// change.
// -------------------------------------------------------------------
type Props = {
  rollup: BudgetRollupDTO;
  /** The accessible name of the bar, e.g. "Interns budget". */
  label: string;
  /** What the used half IS: "logged" for spend, "assigned" for planning. */
  usedWord?: string;
  /** Shown instead of the bar when nobody has set a budget. */
  emptyMessage?: string;
  className?: string;
};

export function SetupBudgetBar({
  rollup,
  label,
  usedWord = "logged",
  emptyMessage = "No budget set, so there is nothing to measure this against.",
  className,
}: Props) {
  // Null exactly when the budget is nought - see budgetProgress. Time
  // against no budget is NOT an overrun, and painting it red would blame the
  // person who did the work for the omission of the person who planned it.
  if (rollup.percentUsed === null) {
    return (
      <div className={cn("space-y-1", className)}>
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        {rollup.loggedMinutes > 0 && (
          <p className="text-sm text-foreground">
            {formatMinutesAsClock(rollup.loggedMinutes)} {usedWord} so far.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="text-foreground">
          {formatMinutesAsClock(rollup.loggedMinutes)} {usedWord} of {formatMinutesAsClock(rollup.budgetMinutes)}
        </span>
        <span className={cn("figure", rollup.isOverBudget ? "text-destructive" : "text-muted-foreground")}>
          {rollup.percentUsed}%
        </span>
      </div>

      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        // The CLAMPED figure, because a value above the maximum is not a
        // valid progressbar value. The true percentage is in the text
        // beside it, and in the value text below.
        aria-valuenow={Math.round(rollup.barPercent)}
        aria-valuetext={`${rollup.percentUsed}% of ${formatMinutesAsClock(rollup.budgetMinutes)}`}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full transition-[width]", rollup.isOverBudget ? "bg-destructive" : "bg-primary")}
          style={{ width: `${rollup.barPercent}%` }}
        />
      </div>

      <p className={cn("text-sm", rollup.isOverBudget ? "text-destructive" : "text-muted-foreground")}>
        {rollup.isOverBudget
          ? `${formatMinutesAsClock(rollup.overMinutes)} over budget.`
          : `${formatMinutesAsClock(rollup.remainingMinutes ?? 0)} left.`}
      </p>
    </div>
  );
}
