import "@tanstack/react-table";

// Extra per-column metadata used by our responsive DataTable.
declare module "@tanstack/react-table" {
  // Type params are required to match the interface signature for declaration merging.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Short label shown for this column in the mobile card layout. */
    label?: string;
  }
}
