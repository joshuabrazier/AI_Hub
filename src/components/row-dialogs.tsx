"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Renders one instance of a row dialog. `row` is null for the create instance.
 */
type RenderRowDialog<TRow> = (row: TRow | null, open: boolean, onOpenChange: (open: boolean) => void) => ReactNode;

type RowDialogProps<TRow extends { id: string }> = {
  /** The selected row, or null when nothing is selected (dialog closed). */
  row: TRow | null;
  /** Clear the selection. Called when the dialog asks to close. */
  onClear: () => void;
  render: RenderRowDialog<TRow>;
};

// -------------------------------------------------------------------
// RowDialog
//
// A dialog driven by "which row is selected". Selecting a row opens it;
// closing it clears the selection.
//
// The key is load-bearing. Without it React keeps the mounted dialog and its
// form state when the selected row changes, so opening a second row shows the
// FIRST one's values. Keying on the row id forces a remount, which re-runs the
// dialog's own defaults/reset against the row now selected.
// -------------------------------------------------------------------
export function RowDialog<TRow extends { id: string }>({ row, onClear, render }: RowDialogProps<TRow>) {
  return (
    <Fragment key={row?.id ?? "none"}>
      {render(row, row !== null, (open) => {
        if (!open) onClear();
      })}
    </Fragment>
  );
}

type CreateEditDialogsProps<TRow extends { id: string }> = {
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  /**
   * Remount the create instance each time it opens. For a dialog holding local
   * state beyond the form (a generated list, a multi-step confirm), reopening
   * otherwise resumes the last attempt instead of starting clean.
   */
  remountCreate?: boolean;
  selected: TRow | null;
  onClearSelected: () => void;
  render: RenderRowDialog<TRow>;
};

// -------------------------------------------------------------------
// CreateEditDialogs
//
// The create + edit pair every admin table mounts: one instance with no row
// (create), and one keyed on the selected row (edit). Both come from the same
// render function, so the two call sites cannot drift apart.
// -------------------------------------------------------------------
export function CreateEditDialogs<TRow extends { id: string }>({
  createOpen,
  onCreateOpenChange,
  remountCreate = false,
  selected,
  onClearSelected,
  render,
}: CreateEditDialogsProps<TRow>) {
  return (
    <>
      <Fragment key={remountCreate ? (createOpen ? "create-open" : "create-closed") : "create"}>
        {render(null, createOpen, onCreateOpenChange)}
      </Fragment>

      <RowDialog row={selected} onClear={onClearSelected} render={render} />
    </>
  );
}
