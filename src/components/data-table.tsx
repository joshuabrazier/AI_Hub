"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTableFilters, type DataTableFacet, type DataTableSort } from "@/components/data-table-filters";
import { cn } from "@/lib/utils";

// Re-export so a table imports its filter types from the DataTable it configures.
export type { DataTableFacet, DataTableSort };

/**
 * One "Active only"-style toggle. `predicate` decides which rows count as
 * active; when the toggle is on, only those rows show. Starts on unless
 * `defaultOn` is false. Give an `id` when a table shows several toggles so
 * their on/off state stays distinct.
 */
export type DataTableToggle<TData> = {
  predicate: (row: TData) => boolean;
  label?: string;
  defaultOn?: boolean;
  id?: string;
};

type DataTableProps<TData> = {
  columns: ColumnDef<TData>[];
  data: TData[];
  emptyMessage?: string;
  /** Extra classes on the root (e.g. a max-width to stop a sparse table sprawling). */
  className?: string;
  /** Placeholder for the built-in search box. */
  searchPlaceholder?: string;
  /**
   * Row fields the search matches against. Keep to user-visible text columns
   * (not ids). If omitted, all string/number fields are searched.
   */
  searchKeys?: (keyof TData & string)[];
  /** Right-aligned toolbar content (e.g. an "Add"/"Invite" button). */
  toolbar?: React.ReactNode;
  /**
   * Optional active toggle(s). Pass one, or an array to show several toggles
   * (all applied together with AND). Each starts on unless its `defaultOn` is
   * false.
   */
  activeFilter?: DataTableToggle<TData> | DataTableToggle<TData>[];
  /** Sort presets in the Filter popover (first is the default order). */
  sortOptions?: DataTableSort<TData>[];
  /** Faceted (single-select) filters in the Filter popover. */
  facetFilters?: DataTableFacet<TData>[];
  /** Initial rows per page (default 10). */
  pageSize?: number;
  pageSizeOptions?: number[];
};

export function DataTable<TData>({
  columns,
  data,
  emptyMessage = "No results.",
  className,
  searchPlaceholder = "Search...",
  searchKeys,
  toolbar,
  activeFilter,
  sortOptions,
  facetFilters,
  pageSize = 10,
  pageSizeOptions = [5, 10, 20, 30, 40, 50],
}: DataTableProps<TData>) {
  // TanStack Table mutates internal state (pagination, filtering) on a stable
  // `table` instance. React Compiler would memoize table.getRowModel() /
  // getPageCount() and serve stale results - e.g. changing "Rows per page"
  // updates the control but not the rendered rows. Opt this component out of
  // the compiler so every table.* read is recomputed on each render.
  "use no memo";

  const [globalFilter, setGlobalFilter] = React.useState("");

  // Normalise to a list so a table can show one or several active toggles,
  // each with its own on/off state (keyed by id, or list position as a
  // fallback). All "on" toggles are applied together (AND).
  const activeToggles = React.useMemo<DataTableToggle<TData>[]>(
    () => (activeFilter ? (Array.isArray(activeFilter) ? activeFilter : [activeFilter]) : []),
    [activeFilter],
  );
  const [toggleState, setToggleState] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(activeToggles.map((toggle, index) => [toggle.id ?? String(index), toggle.defaultOn ?? true])),
  );

  // Filter state: the chosen sort (defaults to the first preset) and the set of
  // selected values per facet (empty/absent = no filter on that facet).
  const defaultSortId = sortOptions?.[0]?.id ?? "";
  const [sortId, setSortId] = React.useState(defaultSortId);
  const [facetValues, setFacetValues] = React.useState<Record<string, string[]>>({});

  // Pipeline: Active-only → facet filters (multi-select OR within a facet, AND
  // across facets) → search → sort. Pagination applies on top. Search is done
  // here rather than via the table's global filter because the global filter
  // only matches columns that have an accessor; display-only columns (e.g. the
  // activity table's id-only columns) would otherwise never match.
  const shownData = React.useMemo(() => {
    let rows = data;
    activeToggles.forEach((toggle, index) => {
      if (toggleState[toggle.id ?? String(index)]) rows = rows.filter(toggle.predicate);
    });

    for (const facet of facetFilters ?? []) {
      const selected = facetValues[facet.id];
      if (selected && selected.length > 0) {
        const set = new Set(selected);
        rows = rows.filter((row) => {
          const value = facet.getValue(row);
          return value !== null && set.has(value);
        });
      }
    }

    const query = globalFilter.trim().toLowerCase();
    if (query) {
      rows = rows.filter((row) => {
        const record = row as Record<string, unknown>;
        const fields = searchKeys ? searchKeys.map((key) => record[key]) : Object.values(record);
        return fields.some((field) => {
          if (typeof field === "string") return field.toLowerCase().includes(query);
          if (typeof field === "number") return String(field).includes(query);
          if (Array.isArray(field)) return field.some((el) => typeof el === "string" && el.toLowerCase().includes(query));
          return false;
        });
      });
    }

    const sort = sortOptions?.find((option) => option.id === sortId);
    if (sort) rows = rows.slice().sort(sort.compare);

    return rows;
  }, [data, activeToggles, toggleState, facetFilters, facetValues, searchKeys, globalFilter, sortOptions, sortId]);

  const setFacetValue = (facetId: string, values: string[]) =>
    setFacetValues((prev) => ({ ...prev, [facetId]: values }));

  const clearFilters = () => {
    setSortId(defaultSortId);
    setFacetValues({});
  };

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: shownData,
    columns,
    initialState: { pagination: { pageSize } },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // Jump back to the first page whenever the filtered/sorted set changes, so a
  // search that shrinks the results never leaves you stranded on an empty page.
  React.useEffect(() => {
    table.setPageIndex(0);
    // table is a stable instance; only the filter/sort inputs should re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalFilter, facetValues, toggleState, sortId]);

  const rows = table.getRowModel().rows;
  // shownData is already filtered (active/facets/search), so its length is the
  // total the pager reports.
  const totalRows = shownData.length;
  const pageCount = table.getPageCount();
  const { pageIndex, pageSize: currentPageSize } = table.getState().pagination;
  const firstRow = totalRows === 0 ? 0 : pageIndex * currentPageSize + 1;
  const lastRow = pageIndex * currentPageSize + rows.length;

  // Always include the active page size among the dropdown options. A controlled
  // <select> whose value matches no <option> renders the first option instead, so
  // a `pageSize` outside `pageSizeOptions` (e.g. 25) would display "5" while the
  // table actually paginated by 25 - the control silently disagreeing with reality.
  const pageSizeChoices = Array.from(new Set([...pageSizeOptions, currentPageSize])).sort((a, b) => a - b);

  const isFiltering = globalFilter.trim().length > 0;
  const noResultsMessage = isFiltering ? `No results for “${globalFilter.trim()}”.` : emptyMessage;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Toolbar: search + optional Active Only toggle (kept together) + actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Search"
          placeholder={searchPlaceholder}
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="w-full sm:w-64"
        />
        <DataTableFilters
          sortOptions={sortOptions}
          sortId={sortId}
          defaultSortId={defaultSortId}
          onSortChange={setSortId}
          facetFilters={facetFilters}
          facetValues={facetValues}
          onFacetChange={setFacetValue}
          onClearAll={clearFilters}
        />
        {activeToggles.map((toggle, index) => {
          const key = toggle.id ?? String(index);
          const inputId = `data-table-toggle-${key}`;
          return (
            <div key={key} className="flex items-center gap-2 whitespace-nowrap">
              <Switch
                id={inputId}
                checked={toggleState[key] ?? toggle.defaultOn ?? true}
                onCheckedChange={(checked) => setToggleState((prev) => ({ ...prev, [key]: checked }))}
              />
              <Label htmlFor={inputId} className="cursor-pointer">
                {toggle.label ?? "Active only"}
              </Label>
            </div>
          );
        })}
        {toolbar && <div className="ml-auto shrink-0">{toolbar}</div>}
      </div>

      {/* Large screens: table */}
      <div className="hidden overflow-hidden rounded-md border lg:block">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {noResultsMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Small / medium screens: stacked cards */}
      <div className="space-y-3 lg:hidden">
        {rows.length ? (
          rows.map((row) => (
            <div key={row.id} className="rounded-lg border p-4">
              <dl className="space-y-2.5">
                {row.getVisibleCells().map((cell) => {
                  const label = cell.column.columnDef.meta?.label;

                  if (cell.column.id === "actions") {
                    return (
                      <div key={cell.id} className="mt-1 border-t pt-3">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    );
                  }

                  return (
                    <div key={cell.id} className="flex items-start justify-between gap-4">
                      {label && (
                        <dt className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {label}
                        </dt>
                      )}
                      <dd className="min-w-0 text-right">{flexRender(cell.column.columnDef.cell, cell.getContext())}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          ))
        ) : (
          <div role="status" className="rounded-lg border p-6 text-center text-muted-foreground">
            {noResultsMessage}
          </div>
        )}
      </div>

      {/* Pagination + result count */}
      {totalRows > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-sm text-muted-foreground">
          <p role="status" aria-live="polite">
            Showing {firstRow}–{lastRow} of {totalRows}
          </p>

          <div className="flex items-center gap-2">
            <Label htmlFor="data-table-page-size" className="whitespace-nowrap">
              Rows per page
            </Label>
            <select
              id="data-table-page-size"
              value={currentPageSize}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
              className="h-8 rounded-md border bg-background px-2 text-sm font-medium text-foreground shadow-sm"
            >
              {pageSizeChoices.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-label="Previous page"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft size={16} />
            </Button>
            <span className="tabular-nums text-foreground">
              Page {pageIndex + 1} of {Math.max(1, pageCount)}
            </span>
            <Button
              variant="outline"
              size="sm"
              aria-label="Next page"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
