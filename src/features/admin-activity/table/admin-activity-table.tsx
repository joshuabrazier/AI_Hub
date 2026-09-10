"use client";

import { useMemo, useState } from "react";

import { DataTable, type DataTableFacet, type DataTableSort } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { AuditLogEntryDTO } from "../admin-activity.types";
import { AuditDetailsDialog } from "./audit-details-dialog";
import { getAdminActivityColumns } from "./admin-activity-columns";

const ACTIVITY_SORTS: DataTableSort<AuditLogEntryDTO>[] = [
  { id: "newest", label: "Newest first", compare: (a, b) => b.createdAt.localeCompare(a.createdAt) },
  { id: "oldest", label: "Oldest first", compare: (a, b) => a.createdAt.localeCompare(b.createdAt) },
];

// Hoisted so its reference is stable across renders. Passed inline it would be a
// new array every render, which churns the DataTable's filtered-data memo and
// (via autoResetPageIndex) bounces the table back to page 1 on any re-render,
// e.g. when opening the details dialog.
const ACTIVITY_SEARCH_KEYS: (keyof AuditLogEntryDTO & string)[] = [
  "actorName",
  "actionLabel",
  "summary",
  "subjectUserName",
];

// The local calendar day of an ISO timestamp, as "YYYY-MM-DD" - so the range
// compares against what an admin sees in the "When" column (local time), not UTC,
// and lines up lexicographically with the <input type="date"> values.
function localDateKey(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function AdminActivityTable({ entries }: { entries: AuditLogEntryDTO[] }) {
  const [selected, setSelected] = useState<AuditLogEntryDTO | null>(null);

  // Inclusive date range. Empty string = open-ended on that end.
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const hasDateRange = fromDate !== "" || toDate !== "";

  // Facet options come from the full set so choices don't vanish as the date
  // range narrows what's shown.
  const facetFilters = useMemo<DataTableFacet<AuditLogEntryDTO>[]>(() => {
    const categories = Array.from(new Set(entries.map((entry) => entry.category)))
      .sort((a, b) => a.localeCompare(b))
      .map((category) => ({ value: category, label: category }));

    const roles = Array.from(new Set(entries.map((entry) => entry.actorRole).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b))
      .map((role) => ({ value: role, label: role }));

    // A TEAM FACET USED TO SIT HERE and went with teams themselves. The two
    // left are the ones every event has an answer for, which is what a facet
    // needs - a row with no value for one silently drops out of its own
    // filter.
    return [
      { id: "category", label: "Category", options: categories, getValue: (entry) => entry.category },
      { id: "role", label: "Actor role", options: roles, getValue: (entry) => entry.actorRole },
    ] satisfies DataTableFacet<AuditLogEntryDTO>[];
  }, [entries]);

  // Apply the date range first; the DataTable layers search / facets / sort on top.
  const dateFilteredEntries = useMemo(() => {
    if (!hasDateRange) return entries;
    return entries.filter((entry) => {
      const key = localDateKey(entry.createdAt);
      if (fromDate && key < fromDate) return false;
      if (toDate && key > toDate) return false;
      return true;
    });
  }, [entries, fromDate, toDate, hasDateRange]);

  // Stable across renders (setSelected is stable), so opening the dialog does
  // not hand the table a fresh columns reference.
  const columns = useMemo(() => getAdminActivityColumns({ onView: setSelected }), [setSelected]);

  const dateControls = (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor="activity-from" className="text-sm text-muted-foreground">
        From
      </Label>
      <Input
        id="activity-from"
        type="date"
        value={fromDate}
        max={toDate || undefined}
        onChange={(e) => setFromDate(e.target.value)}
        className="h-9 w-auto"
      />
      <Label htmlFor="activity-to" className="text-sm text-muted-foreground">
        To
      </Label>
      <Input
        id="activity-to"
        type="date"
        value={toDate}
        min={fromDate || undefined}
        onChange={(e) => setToDate(e.target.value)}
        className="h-9 w-auto"
      />
      {hasDateRange && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setFromDate("");
            setToDate("");
          }}
        >
          Clear dates
        </Button>
      )}
    </div>
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={dateFilteredEntries}
        searchPlaceholder="Search activity…"
        searchKeys={ACTIVITY_SEARCH_KEYS}
        sortOptions={ACTIVITY_SORTS}
        facetFilters={facetFilters}
        toolbar={dateControls}
        pageSize={25}
        emptyMessage={hasDateRange ? "No activity in the selected date range." : "No activity recorded yet."}
      />

      <AuditDetailsDialog entry={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </>
  );
}
