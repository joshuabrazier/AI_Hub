"use client";

import * as React from "react";
import { ArrowUpDown, Check, ChevronDown, ListFilter, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// Shared table filter model - a Sort preset picker + Linear-style
// multi-select filter chips. The DataTable owns the state; this file
// owns the UI. Facet configs are supplied per table.
// -------------------------------------------------------------------

// A sort preset. The first one a table supplies is its default order.
export type DataTableSort<TData> = {
  id: string;
  label: string;
  compare: (a: TData, b: TData) => number;
};

// A multi-select faceted filter (e.g. "Program", "Role"). `getValue`
// returns the row's value; a row passes when the selected set is empty
// or contains that value.
export type DataTableFacet<TData> = {
  id: string;
  label: string;
  /** Optional/legacy - unused by the chip UI; kept so older configs compile. */
  allLabel?: string;
  options: { value: string; label: string }[];
  getValue: (row: TData) => string | null;
};

type AnyFacet = DataTableFacet<unknown>;
type AnySort = DataTableSort<unknown>;

// Chip label: the single option's label, or "N selected" for many.
function summarize(facet: AnyFacet, values: string[]): string {
  if (values.length === 1) {
    return facet.options.find((o) => o.value === values[0])?.label ?? values[0];
  }
  return `${values.length} selected`;
}

// The checkbox list for one facet - shared by the "+ Filter" panel and
// each chip's editor. Adds a search box once the list gets long.
function FacetValuePanel({
  facet,
  values,
  onChange,
}: {
  facet: AnyFacet;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = React.useState("");
  const showSearch = facet.options.length > 8;
  const q = query.trim().toLowerCase();
  const options = showSearch && q ? facet.options.filter((o) => o.label.toLowerCase().includes(q)) : facet.options;

  const toggle = (value: string) =>
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);

  return (
    <div className="space-y-1.5">
      {showSearch && (
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${facet.label.toLowerCase()}…`}
          className="h-8"
        />
      )}
      <div className="max-h-56 space-y-0.5 overflow-y-auto">
        {options.map((option) => {
          const checked = values.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              role="menuitemcheckbox"
              aria-checked={checked}
              onClick={() => toggle(option.value)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                  checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
                )}
              >
                {checked && <Check size={12} aria-hidden="true" />}
              </span>
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
        {options.length === 0 && <p className="px-2 py-2 text-sm text-muted-foreground">No matches.</p>}
      </div>
    </div>
  );
}

// Sort preset picker.
function SortControl({
  options,
  value,
  onChange,
}: {
  options: AnySort[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const current = options.find((o) => o.id === value) ?? options[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <ArrowUpDown size={15} aria-hidden="true" />
          <span className="text-muted-foreground">Sort:</span>
          {current?.label}
          <ChevronDown size={13} className="text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              onChange(option.id);
              setOpen(false);
            }}
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            {option.label}
            {option.id === value && <Check size={14} className="text-primary" aria-hidden="true" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// "+ Filter" - a two-level popover: a list of columns, then that
// column's value checkboxes.
function AddFilterButton({
  facets,
  facetValues,
  onFacetChange,
}: {
  facets: AnyFacet[];
  facetValues: Record<string, string[]>;
  onFacetChange: (facetId: string, values: string[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [panelId, setPanelId] = React.useState<string | null>(null);

  const panel = panelId ? facets.find((f) => f.id === panelId) : null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPanelId(null); // reset to the column list when closed
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 border-dashed">
          <ListFilter size={15} aria-hidden="true" />
          Filter
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        {panel ? (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setPanelId(null)}
              className="flex items-center gap-1 px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              ‹ All filters
            </button>
            <FacetValuePanel
              facet={panel}
              values={facetValues[panel.id] ?? []}
              onChange={(values) => onFacetChange(panel.id, values)}
            />
          </div>
        ) : (
          <div className="space-y-0.5">
            {facets.map((facet) => {
              const count = facetValues[facet.id]?.length ?? 0;
              return (
                <button
                  key={facet.id}
                  type="button"
                  onClick={() => setPanelId(facet.id)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  {facet.label}
                  {count > 0 && <span className="text-xs font-semibold text-primary">{count}</span>}
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// An active filter, shown as a removable pill that re-opens its editor.
function FacetChip({
  facet,
  values,
  onChange,
  onRemove,
}: {
  facet: AnyFacet;
  values: string[];
  onChange: (values: string[]) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="inline-flex items-center rounded-full border border-primary/40 bg-primary/5 text-sm">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 rounded-l-full py-1 pr-1.5 pl-3 hover:bg-primary/10"
          >
            <span className="text-muted-foreground">{facet.label}:</span>
            <span className="font-medium text-foreground">{summarize(facet, values)}</span>
            <ChevronDown size={13} className="text-muted-foreground" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-2">
          <FacetValuePanel facet={facet} values={values} onChange={onChange} />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label={`Remove ${facet.label} filter`}
        onClick={onRemove}
        className="rounded-r-full py-1 pr-2.5 pl-1 text-muted-foreground hover:text-foreground"
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

export function DataTableFilters<TData>({
  sortOptions,
  sortId,
  defaultSortId,
  onSortChange,
  facetFilters,
  facetValues,
  onFacetChange,
  onClearAll,
}: {
  sortOptions?: DataTableSort<TData>[];
  sortId: string;
  defaultSortId: string;
  onSortChange: (id: string) => void;
  facetFilters?: DataTableFacet<TData>[];
  facetValues: Record<string, string[]>;
  onFacetChange: (facetId: string, values: string[]) => void;
  onClearAll: () => void;
}) {
  const facets = (facetFilters ?? []) as AnyFacet[];
  const sorts = (sortOptions ?? []) as AnySort[];
  const activeFacets = facets.filter((f) => (facetValues[f.id]?.length ?? 0) > 0);
  const sortChanged = sorts.length > 0 && sortId !== defaultSortId;
  const showClear = activeFacets.length > 0 || sortChanged;

  if (sorts.length === 0 && facets.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {sorts.length > 0 && <SortControl options={sorts} value={sortId} onChange={onSortChange} />}
      {facets.length > 0 && (
        <AddFilterButton facets={facets} facetValues={facetValues} onFacetChange={onFacetChange} />
      )}
      {activeFacets.map((facet) => (
        <FacetChip
          key={facet.id}
          facet={facet}
          values={facetValues[facet.id] ?? []}
          onChange={(values) => onFacetChange(facet.id, values)}
          onRemove={() => onFacetChange(facet.id, [])}
        />
      ))}
      {showClear && (
        <Button variant="ghost" size="sm" onClick={onClearAll}>
          Clear
        </Button>
      )}
    </div>
  );
}
