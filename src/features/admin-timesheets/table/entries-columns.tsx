"use client";

import { ColumnDef } from "@tanstack/react-table";
import { FileWarning } from "lucide-react";

import { columnHeader } from "@/components/data-table-columns";
import { Badge } from "@/components/ui/badge";
import { formatIsoDate } from "@/lib/format";
import { WorklogFactRow } from "@/lib/timesheet/timesheet.types";

// -------------------------------------------------------------------
// The entries table.
//
// Uses the shared DataTable the rest of the product uses, rather than the hand
// rolled markup this started as. That is worth doing for what it brings for
// free and what a bespoke table quietly lacked: search, sortable columns,
// pagination, and the mobile card layout that `meta.label` drives.
//
// One row per worklog - the grain every other figure is summed from, so this
// is the table somebody checks a total against when they do not believe it.
// -------------------------------------------------------------------

// A start time as a wall clock, from seconds past app-zone midnight. The
// conversion happened at sync time; this only formats it.
function formatStartSecond(startSecond: number | null): string {
  if (startSecond === null) return "-";
  const hours = Math.floor(startSecond / 3600);
  const minutes = Math.floor((startSecond % 3600) / 60);
  const period = hours < 12 ? "am" : "pm";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")}${period}`;
}

export function getEntriesColumns(): ColumnDef<WorklogFactRow>[] {
  return [
    {
      accessorKey: "workDate",
      meta: { label: "Date" },
      header: columnHeader("Date"),
      cell: ({ row }) => (
        <div className="whitespace-nowrap font-medium tabular-nums text-foreground">
          {formatIsoDate(row.original.workDate)}
        </div>
      ),
    },
    {
      id: "start",
      accessorFn: (row) => row.startSecond ?? -1,
      meta: { label: "Start" },
      header: columnHeader("Start"),
      cell: ({ row }) => (
        <div className="tabular-nums text-muted-foreground">{formatStartSecond(row.original.startSecond)}</div>
      ),
    },
    {
      accessorKey: "personName",
      meta: { label: "Who" },
      header: columnHeader("Who"),
      cell: ({ row }) => (
        <div className="whitespace-nowrap text-foreground">{row.original.personName ?? row.original.personId}</div>
      ),
    },
    {
      id: "job",
      accessorFn: (row) => row.parentSummary ?? row.parentKey ?? "No job",
      meta: { label: "Project" },
      header: columnHeader("Project"),
      cell: ({ row }) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-foreground">
            {row.original.parentSummary ?? row.original.parentKey ?? "No job"}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{row.original.issueKey}</span>
        </div>
      ),
    },
    {
      id: "work",
      accessorFn: (row) => row.issueSummary ?? "",
      meta: { label: "Work" },
      header: columnHeader("Work"),
      cell: ({ row }) =>
        row.original.hasNarrative ? (
          <span className="text-sm text-foreground">{row.original.issueSummary}</span>
        ) : (
          // The gap that cannot be defended if a client queries the line.
          // Stated on the row, where it is actionable, rather than buried in a
          // warnings panel somebody has to go and read.
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <FileWarning className="size-3.5 shrink-0" aria-hidden />
            No description
          </span>
        ),
    },
    {
      id: "hours",
      accessorFn: (row) => row.timeSpentSeconds,
      meta: { label: "Hours" },
      header: columnHeader("Hours", "right"),
      cell: ({ row }) => (
        <div className="text-right font-medium tabular-nums text-foreground">
          {(row.original.timeSpentSeconds / 3600).toFixed(2)}
        </div>
      ),
    },
    {
      accessorKey: "billable",
      meta: { label: "Billable" },
      header: columnHeader("Billable"),
      cell: ({ row }) =>
        row.original.billable === null ? (
          <Badge variant="destructive">Unset</Badge>
        ) : (
          <span className="flex flex-col">
            <span className="text-sm text-foreground">{row.original.billable}</span>
            {row.original.billableSource === "parent" && (
              <span className="text-xs text-muted-foreground">inherited</span>
            )}
          </span>
        ),
    },
  ];
}
