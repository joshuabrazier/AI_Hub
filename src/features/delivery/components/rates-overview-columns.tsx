"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import { columnHeader, statusColumn } from "@/components/data-table-columns";
import { Button } from "@/components/ui/button";
import { RATE_BANDS, RATE_BAND_LABELS, type RateBand } from "@/lib/data/kysely-database-types";
import { formatIsoDate } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { formatCents } from "@/lib/timesheet/revenue";

import type { UserRateBandsDTO, UserRateDTO } from "../delivery.types";

// -------------------------------------------------------------------
// The rates overview: everybody, with the rate in force in each of the three
// bands.
//
// ALL THREE BANDS ARE ALWAYS A COLUMN, and a band nobody has priced is a
// visible "Not set" rather than an empty cell. The DTO builds the bands by
// walking RATE_BANDS rather than the rows for exactly that reason - showing
// which bands are still blank is most of what this screen is for, and a
// missing key and a priced-at-nothing band look identical to a table that
// renders whatever it finds.
//
// EVERY PERSON IS A ROW, including somebody with no rate at all. They are the
// people this screen exists to find: a person with no rate cannot be given
// one from a list that only shows people who have one.
//
// TWO DECIMAL PLACES on a rate, against `formatCents`' whole-dollar default.
// A rate is a unit price and $220.50 rounded to $221 is a different rate.
// -------------------------------------------------------------------

const RATE_DECIMAL_PLACES = 2;

// The band columns, in the order the enum declares them: discounted,
// standard, high. That is a running order, not an alphabet, so it is taken
// from RATE_BANDS rather than sorted.
const BAND_ORDER: RateBand[] = Object.values(RATE_BANDS);

/** True when any of the three bands has no rate in force today. */
export function hasUnpricedBand(person: UserRateBandsDTO): boolean {
  return BAND_ORDER.some((band) => person.bands[band] === null);
}

export function getRatesOverviewColumns({
  onSetRate,
}: {
  onSetRate: (person: UserRateBandsDTO) => void;
}): ColumnDef<UserRateBandsDTO>[] {
  return [
    {
      accessorKey: "name",
      meta: { label: "Person" },
      header: columnHeader("Person"),
      cell: ({ row }) => (
        <div className="min-w-0">
          {/* Typed by a person and rewritten in place when an account is
              de-identified, so it can be null and renders as a sentence
              rather than an empty cell. Always a text node. */}
          <p className="font-medium text-foreground">{row.original.name ?? "De-identified account"}</p>
          {row.original.email ? (
            // Here to tell two people with the same name apart, on a screen
            // where picking the wrong row misprices a client.
            <p className="text-xs text-muted-foreground">{row.original.email}</p>
          ) : null}
        </div>
      ),
    },

    ...BAND_ORDER.map<ColumnDef<UserRateBandsDTO>>((band) => ({
      id: `band-${band}`,
      meta: { label: RATE_BAND_LABELS[band] },
      header: columnHeader(RATE_BAND_LABELS[band]),
      cell: ({ row }) => <BandCell rate={row.original.bands[band]} />,
    })),

    statusColumn<UserRateBandsDTO>((person) => person.isActive),

    {
      id: "actions",
      header: columnHeader("Actions", "center"),
      cell: ({ row }) => (
        <div className="flex justify-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onSetRate(row.original)}>
            Set rate
          </Button>
          {/* A real link, not a button that pushes: this opens a page, and a
              link can be middle-clicked, copied and read by anything that
              lists the links on a screen. */}
          <Button asChild variant="ghost" size="sm">
            <Link href={ROUTES.adminUserRates(row.original.userId)}>
              History
              <span className="sr-only">
                {row.original.name ? ` for ${row.original.name}` : " for this person"}
              </span>
            </Link>
          </Button>
        </div>
      ),
    },
  ];
}

// -------------------------------------------------------------------
// One band for one person.
//
// NOT SET IS SAID IN WORDS. A blank cell reads as a rendering fault and a
// dash reads as nought; this is neither - nobody has priced that band yet,
// and it is the state an admin opens this screen to find.
//
// NO COST RECORDED IS ALSO SAID, because a null cost is what makes margin
// unknown rather than 100%, and a cost column that simply stops after the
// charge rate does not explain the "Not valued" that then appears on a
// budget report.
// -------------------------------------------------------------------
function BandCell({ rate }: { rate: UserRateDTO | null }) {
  if (!rate) {
    return <span className="text-sm text-muted-foreground">Not set</span>;
  }

  return (
    <div className="min-w-0 text-sm">
      <p className="tabular-nums text-foreground">{formatCents(rate.chargeRateCents, RATE_DECIMAL_PLACES)}/h</p>
      <p className="text-xs text-muted-foreground">
        {rate.costRateCents === null
          ? "No cost recorded"
          : `${formatCents(rate.costRateCents, RATE_DECIMAL_PLACES)}/h cost`}
      </p>
      <p className="text-xs text-muted-foreground">From {formatIsoDate(rate.effectiveFrom)}</p>
    </div>
  );
}
