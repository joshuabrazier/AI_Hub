"use client";

import { ColumnDef } from "@tanstack/react-table";

import { columnHeader } from "@/components/data-table-columns";
import { Badge } from "@/components/ui/badge";
import { BudgetRow } from "@/lib/timesheet/timesheet.types";
import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// The jobs table: the whole book of work, including the jobs nobody has
// started. Sortable, because "which job is furthest over budget" and "which
// job has the most hours" are different questions and both get asked.
// -------------------------------------------------------------------

function hoursOrDash(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(2)} h`;
}

export function getJobsColumns(): ColumnDef<BudgetRow>[] {
  return [
    {
      id: "job",
      accessorFn: (row) => row.parentSummary ?? row.parentKey,
      meta: { label: "Job" },
      header: columnHeader("Job"),
      cell: ({ row }) => {
        const untouched = row.original.worklogCount === 0;

        return (
          <div className="flex min-w-0 flex-col">
            <span className={cn("truncate", untouched ? "text-muted-foreground" : "font-medium text-foreground")}>
              {row.original.parentSummary ?? row.original.parentKey}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {row.original.parentKey}
              {row.original.billable && ` - ${row.original.billable}`}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "category",
      meta: { label: "Category" },
      header: columnHeader("Category"),
      cell: ({ row }) =>
        row.original.category ? (
          <Badge variant="outline">{row.original.category}</Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      id: "logged",
      accessorFn: (row) => row.actualSeconds,
      meta: { label: "Logged" },
      header: columnHeader("Logged", "right"),
      cell: ({ row }) =>
        row.original.worklogCount === 0 ? (
          // An explicit phrase, not "0.00 h". Nothing booked is a different
          // statement from a job that netted to zero.
          <div className="text-right text-muted-foreground">not started</div>
        ) : (
          <div className="text-right font-medium tabular-nums text-foreground">
            {row.original.actualHours.toFixed(2)} h
          </div>
        ),
    },
    {
      id: "baseline",
      accessorFn: (row) => row.baselineSeconds ?? -1,
      meta: { label: "Baseline" },
      header: columnHeader("Baseline", "right"),
      cell: ({ row }) => (
        <div className="text-right tabular-nums text-muted-foreground">{hoursOrDash(row.original.baselineHours)}</div>
      ),
    },
    {
      id: "estimate",
      accessorFn: (row) => row.currentSeconds ?? -1,
      meta: { label: "Estimate" },
      header: columnHeader("Estimate", "right"),
      cell: ({ row }) => (
        <div className="text-right tabular-nums text-muted-foreground">{hoursOrDash(row.original.currentHours)}</div>
      ),
    },
    {
      id: "variance",
      accessorFn: (row) => row.varianceSeconds ?? 0,
      meta: { label: "Variance" },
      header: columnHeader("Variance", "right"),
      cell: ({ row }) => {
        const over = row.original.varianceSeconds !== null && row.original.varianceSeconds > 0;

        return (
          <div className={cn("text-right tabular-nums", over && "font-medium text-destructive")}>
            {hoursOrDash(row.original.varianceHours)}
          </div>
        );
      },
    },
    {
      id: "consumed",
      accessorFn: (row) => row.consumedRatio ?? -1,
      meta: { label: "Consumed" },
      header: columnHeader("Consumed", "right"),
      cell: ({ row }) => (
        <div className="text-right tabular-nums text-foreground">
          {/* Null, not zero: no estimate means nothing to be a share of. */}
          {row.original.consumedRatio === null ? "n/a" : `${Math.round(row.original.consumedRatio * 100)}%`}
        </div>
      ),
    },
  ];
}
