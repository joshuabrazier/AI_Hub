import { formatCents } from "@/lib/timesheet/revenue";
import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// Money on the budget report, and the two rules that decide how it renders.
//
// PRESENCE, NOT TRUTHINESS. The budget DTOs OMIT a cents property for a
// reader who may not see that side of the money and put NULL in it when the
// figure is genuinely unknown. The two are different answers to different
// questions, so they get different code paths: a caller decides whether a
// column exists at all with `"costCents" in dto`, and only then asks these
// components to render the value. `MoneyStat` guards `undefined` as well,
// so a caller who forgets cannot leak an absent field as "$0.00" - but the
// `in` check at the call site is the one that is meant to be read.
//
// UNVALUED IS NOT ZERO. Null means nobody has said what the work is worth -
// an uncosted rate, a non-billable project - and it is spelled out in words
// rather than shown as a dash. A dash in a money column reads as "nothing
// owed", which is the one wrong answer on this screen that looks like good
// news: it turns "we do not know the margin" into "the margin is all of it".
// Zero is a real and different answer, and it renders as $0.00.
//
// NOTHING HERE COMPUTES ANYTHING. Every figure arrives as cents from a
// rollup that Postgres summed, and `formatCents` is the only thing applied
// to it. The comparison against zero is a question about a number, not a
// second opinion about its value.
// -------------------------------------------------------------------

/** Said in words, because a dash in a money column reads as "nothing owed". */
export const MONEY_UNVALUED_LABEL = "Not valued";

// -------------------------------------------------------------------
// TWO DECIMAL PLACES, against `formatCents`' whole-dollar default.
//
// That default is right for a leadership pack, where the cents are noise at
// the scale being read. This is the screen somebody prices a client from,
// and a margin quoted to the nearest dollar is a figure that will not
// reconcile with the invoice it is checked against.
// -------------------------------------------------------------------
const MONEY_DECIMAL_PLACES = 2;

/**
 * One money figure. Null renders as "Not valued", never as 0 or a dash.
 *
 * A negative amount is tinted rather than only signed: a margin below zero
 * is the finding somebody opens this screen for, and a leading minus in a
 * column of similar-looking numbers is easy to read past.
 */
export function MoneyAmount({ cents, className }: { cents: number | null; className?: string }) {
  if (cents === null) {
    return <span className={cn("text-muted-foreground", className)}>{MONEY_UNVALUED_LABEL}</span>;
  }

  return (
    <span className={cn("tabular-nums", cents < 0 && "text-data-caution", className)}>
      {formatCents(cents, MONEY_DECIMAL_PLACES)}
    </span>
  );
}

/**
 * One money figure in a table cell, or nothing at all.
 *
 * The same guard `MoneyStat` makes, for a caller that has already decided
 * the COLUMN exists from the report-level DTO: `undefined` here would mean
 * one row disagreed with the report about what its reader may see, and the
 * cell stays empty rather than inventing a value for it.
 */
export function MoneyCell({ cents }: { cents?: number | null }) {
  if (cents === undefined) return null;

  return <MoneyAmount cents={cents} />;
}

/**
 * A labelled money figure for the summary row.
 *
 * `cents` is deliberately optional: `undefined` is the DTO saying the field
 * is not for this reader, and the whole stat disappears rather than showing
 * an empty one, which would advertise that there is something being kept
 * back.
 */
export function MoneyStat({
  label,
  cents,
  hint,
}: {
  label: string;
  cents?: number | null;
  hint?: string;
}) {
  if (cents === undefined) return null;

  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-2xl font-bold text-foreground">
        <MoneyAmount cents={cents} />
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
