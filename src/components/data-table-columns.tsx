"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// Shared column pieces for the admin tables.
//
// Every admin table renders headers, a Status column and an Actions column the
// same way. Building them here keeps a header from drifting a font weight, and
// keeps each labelled column's `meta.label` set - the DataTable's mobile card
// layout reads it for the field's heading, and a column without one loses that
// heading on small screens.
//
// The Actions column is the exception: it sets no `meta.label` and does not
// need one, because the card layout special-cases the column whose id is
// "actions" and renders it as a footer before any label is used.
// -------------------------------------------------------------------

type ColumnAlign = "left" | "center";

/** The header renderer used by every admin column. */
export function columnHeader(label: string, align: ColumnAlign = "left") {
  const className = cn("font-semibold", align === "center" ? "text-center" : "text-left");

  function ColumnHeader() {
    return <div className={className}>{label}</div>;
  }
  // TanStack renders this as a component, so name it for React DevTools.
  ColumnHeader.displayName = `ColumnHeader(${label})`;

  return ColumnHeader;
}

/** The centred Active/Inactive pill column. */
export function statusColumn<TRow>(getActive: (row: TRow) => boolean): ColumnDef<TRow> {
  return {
    id: "status",
    meta: { label: "Status" },
    header: columnHeader("Status", "center"),
    cell: ({ row }) => (
      <div className="text-center">
        <StatusBadge active={getActive(row.original)} />
      </div>
    ),
  };
}

export type RowAction<TRow> = {
  label: string;
  onSelect: (row: TRow) => void;
  variant?: React.ComponentProps<typeof Button>["variant"];
  /** Hide the action on rows it does not apply to (e.g. Edit on a pending invitation). */
  hidden?: (row: TRow) => boolean;
};

/**
 * The trailing Actions column. Its id must stay "actions" - that id, not a
 * `meta.label`, is what the DataTable's mobile card layout matches on to render
 * the buttons as a footer rather than as another labelled field.
 */
export function actionsColumn<TRow>(actions: RowAction<TRow>[]): ColumnDef<TRow> {
  return {
    id: "actions",
    header: columnHeader("Actions", "center"),
    cell: ({ row }) => (
      <div className="flex justify-center gap-2">
        {actions
          .filter((action) => !action.hidden?.(row.original))
          .map((action) => (
            <Button
              key={action.label}
              type="button"
              variant={action.variant ?? "outline"}
              size="sm"
              className="w-24"
              onClick={() => action.onSelect(row.original)}
            >
              {action.label}
            </Button>
          ))}
      </div>
    ),
  };
}
