"use client";

import { X } from "lucide-react";

// -------------------------------------------------------------------
// TableFilterNotice
// A dismissible chip that surfaces when a table is scoped by an
// upstream link (e.g. "show the classes for this program"). Reads as
// "<label>: <value>  ✕ Clear" and calls onClear to drop the filter.
// -------------------------------------------------------------------
export function TableFilterNotice({
  label,
  value,
  onClear,
}: {
  label: string;
  value: string;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground">{value}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${label.toLowerCase()} filter`}
        className="ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X size={14} aria-hidden="true" />
        Clear
      </button>
    </div>
  );
}
