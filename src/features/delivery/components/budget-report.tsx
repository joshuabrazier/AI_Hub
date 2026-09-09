import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROUTES } from "@/lib/routes";

import type { BudgetReportDTO } from "../delivery.types";
import { BudgetBar } from "./budget-bar";
import { MoneyCell, MoneyStat } from "./budget-money";

// -------------------------------------------------------------------
// One project's budget report: budget against logged, per budget group and
// for the project as a whole, with what the time is worth beside it.
//
// THREE RULES, AND THEY OUTRANK THE LAYOUT.
//
// 1. EVERY FIGURE IS ALREADY COMPUTED. The service returns integer cents
//    from rollups Postgres grouped, and minute totals through
//    `budgetProgress`. Nothing here multiplies, divides, sums or averages.
//    There is no chart scaled against a total on this screen for exactly
//    that reason: scaling is division, and a plausible wrong number beside
//    a right one discredits both. The only bars drawn are the ones whose
//    width the service already decided (`barPercent`).
//
// 2. UNVALUED IS NOT ZERO. Null money is rendered in words by `MoneyAmount`.
//    See budget-money.tsx.
//
// 3. MONEY RENDERS ON PRESENCE. A column exists only when the DTO carries
//    the property, tested with `in` rather than by truthiness - the DTO
//    omits a field the reader may not see and nulls one nobody has costed,
//    and collapsing those two would show an admin looking at an uncosted
//    project exactly what a lead looking at a costed one sees.
//
// THE PROJECT TOTAL IS NOT A TABLE FOOTER, and that is deliberate. It is
// every task estimate against every minute logged, whereas a group budget
// is a pool carved out of the project - so the groups do not have to add up
// to it, and rendering the project figures under the group column would
// claim they were that column's total. It leads instead, as the headline it
// is, and the groups are the breakdown below it.
// -------------------------------------------------------------------
export function BudgetReport({ report }: { report: BudgetReportDTO }) {
  // PRESENCE, NOT TRUTHINESS - the rule above, written once here and read by
  // every cell below. `report.chargeableCents === 0` is a real answer and
  // `null` is another; only an absent property means "not for this reader".
  const showChargeable = "chargeableCents" in report;
  const showCost = "costCents" in report;
  const showMargin = "marginCents" in report;
  const showAnyMoney = showChargeable || showCost || showMargin;

  return (
    <div className="space-y-6">
      {/* The project as a whole */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span>The project</span>
            {report.isBillable ? null : (
              // Worth saying before somebody reads a null charge as a fault.
              // Nothing is charged for a non-billable project, so there is
              // nothing for the rate snapshots to have valued.
              <Badge variant="secondary">Not billable</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Every task estimate on {report.projectTitle} against every minute logged against it. Budget groups
            are pools carved out of this, so they do not have to add up to it.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <BudgetBar rollup={report.project} />

          {showAnyMoney ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <MoneyStat
                label="Chargeable"
                cents={report.chargeableCents}
                hint={report.isBillable ? undefined : "This project is not billable."}
              />
              <MoneyStat label="Cost" cents={report.costCents} />
              <MoneyStat
                label="Margin"
                cents={report.marginCents}
                hint="Chargeable less cost. Unknown if either side is."
              />
            </div>
          ) : null}

          <p className="text-sm text-muted-foreground">
            Time is valued at the rate each hour was logged at, so{" "}
            <Link
              href={ROUTES.ADMIN_RATES}
              className="rounded text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              changing a rate
            </Link>{" "}
            does not restate anything on this page.
          </p>
        </CardContent>
      </Card>

      {/* The breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Budget groups</CardTitle>
          <CardDescription>
            A group is a budget shared by a named set of people. Its figures cover only the time those people
            logged.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {report.groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This project has no budget groups, so all of its time is in the line below.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Group</TableHead>
                  <TableHead className="min-w-56">Budget and time</TableHead>
                  {showChargeable ? <TableHead className="text-right">Chargeable</TableHead> : null}
                  {showCost ? <TableHead className="text-right">Cost</TableHead> : null}
                  {showMargin ? <TableHead className="text-right">Margin</TableHead> : null}
                </TableRow>
              </TableHeader>

              <TableBody>
                {report.groups.map((group) => (
                  <TableRow key={group.groupId} className="align-top">
                    <TableCell className="py-3">
                      {/* Typed by a person, so a text node and nothing else. */}
                      <span className="font-medium text-foreground">{group.name}</span>

                      {group.members.length === 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Nobody is in this group, so no time can land in it.
                        </p>
                      ) : (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {group.members.map((member) => (
                            <Badge key={member.userId} variant="outline" className="font-normal">
                              {/* Null when the account has been
                                  de-identified. The pool still names the
                                  share, so the row says so rather than
                                  going blank. */}
                              {member.name ?? "De-identified account"}
                            </Badge>
                          ))}
                        </p>
                      )}
                    </TableCell>

                    <TableCell className="py-3">
                      <BudgetBar rollup={group.rollup} />
                    </TableCell>

                    {/* The COLUMN exists because the report carries the
                        field; the CELL still reads its own row, and
                        MoneyCell renders nothing if that row does not carry
                        it. Both are built by the same call, so the second
                        check is a belt on a brace rather than a branch
                        anybody expects to take. */}
                    {showChargeable ? (
                      <TableCell className="py-3 text-right">
                        <MoneyCell cents={group.chargeableCents} />
                      </TableCell>
                    ) : null}
                    {showCost ? (
                      <TableCell className="py-3 text-right">
                        <MoneyCell cents={group.costCents} />
                      </TableCell>
                    ) : null}
                    {showMargin ? (
                      <TableCell className="py-3 text-right">
                        <MoneyCell cents={group.marginCents} />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* -----------------------------------------------------------------
          TIME IN NO GROUP.
          Its own block rather than a row in the table above, because it has
          no money and no budget and would need two apologies in a row that
          is meant to be read across. A group budget is a pool somebody
          carved out; nobody has ever pooled the remainder, so there is no
          figure to show and the service does not invent one by subtracting
          the groups from the project.
          ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Time in no budget group</CardTitle>
          <CardDescription>
            Logged by people who are on the project but not in one of its groups. It counts towards the
            project above, and towards no group.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          <BudgetBar rollup={report.ungrouped} className="max-w-md" />

          {showAnyMoney ? (
            <p className="text-sm text-muted-foreground">
              Not broken out separately: what a pool is worth is a question about a pool, and this is what is
              left over rather than one somebody set up. Its value is inside the project figures above.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
