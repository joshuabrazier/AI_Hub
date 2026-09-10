import { cn } from "@/lib/utils";

import { formatMinutesAsClock, type BudgetRollupDTO } from "../delivery.types";

// -------------------------------------------------------------------
// A budget group's, or a project's, time against its budget.
//
// EVERY FIGURE ON IT IS ALREADY DECIDED. `budgetProgress` in
// delivery.types.ts produced `remainingMinutes`, `overMinutes`,
// `percentUsed`, `barPercent` and `isOverBudget` from the two minute totals
// the database summed, so this draws what it is handed and works nothing
// out. `barPercent` is separate from `percentUsed` precisely so the bar can
// be full while the label says 140%, and reproducing either here would give
// two surfaces two chances to disagree about the same overrun.
//
// NO BUDGET IS NOT A FULL BAR AND NOT AN EMPTY ONE. `budgetMinutes` of 0
// gives a null remainder and a null percentage, and the honest rendering is
// to say nobody has budgeted it - a bar drawn at 0% would read as "none of
// the budget used" and one drawn at 100% as "all of it gone", and both are
// claims about a figure that does not exist.
//
// THE BAR CARRIES NO INFORMATION OF ITS OWN and is hidden from assistive
// technology on purpose. Everything it shows is printed beside it as text,
// so it is a second reading of the same numbers rather than the only place
// one of them appears - which is also why it needs no progressbar role and
// no aria-valuenow to fake.
// -------------------------------------------------------------------
export function BudgetBar({ rollup, className }: { rollup: BudgetRollupDTO; className?: string }) {
  const hasBudget = rollup.budgetMinutes > 0;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <span className="figure text-foreground">
          {formatMinutesAsClock(rollup.loggedMinutes)} logged
          {hasBudget ? (
            <span className="text-muted-foreground"> of {formatMinutesAsClock(rollup.budgetMinutes)}</span>
          ) : null}
        </span>

        {hasBudget && rollup.percentUsed !== null ? (
          <span
            className={cn(
              "shrink-0 figure",
              rollup.isOverBudget ? "font-semibold text-data-caution" : "text-muted-foreground",
            )}
          >
            {rollup.percentUsed}%
          </span>
        ) : (
          <span className="shrink-0 text-muted-foreground">No budget set</span>
        )}
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {hasBudget ? (
          <div
            className={cn("h-full rounded-full", rollup.isOverBudget ? "bg-data-caution" : "bg-primary")}
            style={{ width: `${rollup.barPercent}%` }}
          />
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {rollup.isOverBudget ? (
          <span className="font-medium text-data-caution">
            {formatMinutesAsClock(rollup.overMinutes)} over budget
          </span>
        ) : rollup.remainingMinutes !== null ? (
          <>{formatMinutesAsClock(rollup.remainingMinutes)} left</>
        ) : (
          <>Nobody has budgeted this, so there is nothing to be over or under.</>
        )}
      </p>
    </div>
  );
}
