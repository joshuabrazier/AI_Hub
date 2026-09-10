"use client";

import { Fragment, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RATE_BANDS, RATE_BAND_LABELS } from "@/lib/data/kysely-database-types";
import { formatDateTime, formatIsoDate } from "@/lib/format";
import { formatCents } from "@/lib/timesheet/revenue";

import type { UserRateDTO, UserRateHistoryDTO } from "../delivery.types";
import { RatesDeleteDialog } from "./rates-delete-dialog";
import { RatesSetDialog, type RateSetTarget } from "./rates-set-dialog";

// -------------------------------------------------------------------
// One person's whole rate history, in the order the service handed it over.
//
// NEWEST START DATE FIRST, AND NOT RE-SORTED HERE. Three bands can share an
// effective date, and the repository already imposed an order on that tie -
// a second opinion about it in this component would make the list reshuffle
// between loads for no gain.
//
// EVERY ROW STAYS. This is a history, not a current-rates screen: raising
// somebody's rate in July must not restate June's margin, and the way that
// promise is kept is that the June row is still here and every time entry
// snapshots the cents it was charged at. Which is also why removing a row is
// the one act on this screen that needs an explanation rather than a
// confirmation - see RatesDeleteDialog.
// -------------------------------------------------------------------

const RATE_DECIMAL_PLACES = 2;

export function RatesHistoryList({ history }: { history: UserRateHistoryDTO }) {
  const [setTarget, setSetTarget] = useState<RateSetTarget | null>(null);
  const [deleting, setDeleting] = useState<UserRateDTO | null>(null);

  const subject = { userId: history.userId, name: history.name, email: history.email };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Rate history</CardTitle>
          <CardDescription>
            Newest start date first. A rate covers work done on or after its start date, so the earlier rows
            are what earlier work was valued at and stay here for that reason.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => setSetTarget({ subject, band: RATE_BANDS.STANDARD })}
            >
              Set a rate
            </Button>
          </div>

          {history.rates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No rates on record. Until there is one, any time this person logs is reported as unvalued -
              which is not the same as free.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Band</TableHead>
                  <TableHead>Applies from</TableHead>
                  <TableHead className="text-right">Charged</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Last changed</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {history.rates.map((rate) => {
                  const bandLabel = RATE_BAND_LABELS[rate.band];
                  // Said in every action's accessible name, because six
                  // buttons called "Correct" in a column are six identical
                  // announcements.
                  const rowLabel = `the ${bandLabel.toLowerCase()} rate from ${rate.effectiveFrom}`;

                  return (
                    <TableRow key={rate.id}>
                      <TableCell>
                        <Badge variant="outline" className="font-normal">
                          {bandLabel}
                        </Badge>
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-foreground">
                        {formatIsoDate(rate.effectiveFrom)}
                      </TableCell>

                      <TableCell className="text-right figure text-foreground">
                        {formatCents(rate.chargeRateCents, RATE_DECIMAL_PLACES)}/h
                      </TableCell>

                      <TableCell className="text-right">
                        {/* Null is not nought. Nobody recorded a cost, so
                            margin against this rate is unknown rather than
                            all of it. */}
                        {rate.costRateCents === null ? (
                          <span className="text-sm text-muted-foreground">Not recorded</span>
                        ) : (
                          <span className="figure text-foreground">
                            {formatCents(rate.costRateCents, RATE_DECIMAL_PLACES)}/h
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {/* Carried on the DTO because an effective-dated
                            table is read as a history, and "corrected this
                            morning" is the fact that explains a row whose
                            start date is months old. */}
                        {formatDateTime(rate.updatedAt)}
                      </TableCell>

                      <TableCell>
                        <div className="flex justify-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`Correct ${rowLabel}`}
                            onClick={() => setSetTarget({ subject, band: rate.band, rate })}
                          >
                            Correct
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove ${rowLabel}`}
                            onClick={() => setDeleting(rate)}
                          >
                            Remove
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Both dialogs are keyed so opening a second row remounts them and
          re-runs their defaults against the row now selected. */}
      <Fragment key={setTarget ? `${setTarget.band}:${setTarget.rate?.id ?? "new"}` : "none"}>
        <RatesSetDialog
          target={setTarget}
          open={setTarget !== null}
          onOpenChange={(open) => {
            if (!open) setSetTarget(null);
          }}
        />
      </Fragment>

      <Fragment key={deleting?.id ?? "none"}>
        <RatesDeleteDialog
          rate={deleting}
          open={deleting !== null}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
        />
      </Fragment>
    </>
  );
}
