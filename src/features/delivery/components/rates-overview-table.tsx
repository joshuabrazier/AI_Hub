"use client";

import { Fragment, useMemo, useState } from "react";

import { DataTable, type DataTableToggle } from "@/components/data-table";

import type { UserRateBandsDTO } from "../delivery.types";
import { RatesPersonDialog } from "./rates-person-dialog";
import { getRatesOverviewColumns, hasUnpricedBand } from "./rates-overview-columns";

// -------------------------------------------------------------------
// Everybody, with their three bands, and a way to set ALL of them.
//
// It used to open a single-band dialog, so pricing one person was three
// passes over one decision - and the effective date had to be retyped each
// time, with nothing checking the three matched. RatesPersonDialog takes the
// date once and every band together. The single-band dialog is still used by
// the history list, where correcting one dated row genuinely is a one-band
// act.
//
// NO SORT PRESETS, deliberately. The service already returns active accounts
// first and then by name, and DataTable applies the FIRST sort option as its
// default - so offering one would silently replace that order with this
// component's opinion of it. A second copy of an ordering rule is how one
// screen comes to list people differently from another.
//
// TWO TOGGLES INSTEAD, because the questions this screen gets asked are
// "who is not priced yet" and "does this still matter for somebody who has
// left".
//
// Hoisted where they can be: passed inline, an array or object literal is a
// new reference every render, which churns the table's filtered-data memo and
// bounces it back to page one whenever a dialog opens.
// -------------------------------------------------------------------

const SEARCH_KEYS: (keyof UserRateBandsDTO & string)[] = ["name", "email"];

const TOGGLES: DataTableToggle<UserRateBandsDTO>[] = [
  {
    id: "active",
    label: "Active accounts only",
    // A deactivated account keeps its rates: they are what the time it
    // already logged was valued at. Off by default it would be, but the
    // working question is nearly always about people still here.
    predicate: (person) => person.isActive,
  },
  {
    id: "unpriced",
    label: "Missing a band",
    defaultOn: false,
    predicate: hasUnpricedBand,
  },
];

export function RatesOverviewTable({ people }: { people: UserRateBandsDTO[] }) {
  // The whole row, because the dialog prices every band and prefills each
  // from what is in force today - which is exactly what this row shows.
  const [target, setTarget] = useState<UserRateBandsDTO | null>(null);

  const columns = useMemo(() => getRatesOverviewColumns({ onSetRate: setTarget }), []);

  return (
    <>
      <DataTable
        columns={columns}
        data={people}
        searchPlaceholder="Search people..."
        searchKeys={SEARCH_KEYS}
        activeFilter={TOGGLES}
        emptyMessage="Nobody has an account yet."
        pageSize={20}
      />

      {/* Keyed on the person, so opening a second row remounts the dialog
          and re-runs its defaults. Without it React keeps the first row's
          figures in the boxes - the RowDialog rule, applied by hand because
          that helper keys on `id` and a person here is a `userId`. */}
      <Fragment key={target?.userId ?? "none"}>
        <RatesPersonDialog
          person={target}
          open={target !== null}
          onOpenChange={(open) => {
            if (!open) setTarget(null);
          }}
        />
      </Fragment>
    </>
  );
}
