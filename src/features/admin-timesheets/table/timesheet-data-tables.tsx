"use client";

import { useMemo } from "react";

import { DataTable } from "@/components/data-table";
import { BudgetRow, WorklogFactRow } from "@/lib/timesheet/timesheet.types";

import { getEntriesColumns } from "./entries-columns";
import { getJobsColumns } from "./jobs-columns";

// -------------------------------------------------------------------
// The timesheet tables, mounted in the shared DataTable the rest of the
// product uses.
//
// Columns are memoised because DataTable builds its row model from them; a new
// array on every render would rebuild the table and throw away the sort and
// page the user had chosen.
//
// The filters below are the questions people actually arrive with, and they
// live inside the table rather than as more controls on the page: a filter
// popover costs nothing until it is opened, whereas another row of buttons
// above the table costs everyone their screen space.
// -------------------------------------------------------------------

export function EntriesDataTable({ facts }: { facts: WorklogFactRow[] }) {
  const columns = useMemo(() => getEntriesColumns(), []);

  const totalHours = facts.reduce((total, fact) => total + fact.timeSpentSeconds, 0) / 3600;

  return (
    <DataTable
      columns={columns}
      data={facts}
      searchPlaceholder="Search by person, job or work..."
      // Ids are excluded on purpose: searching an accountId finds nothing a
      // human was looking for, and matching one floods the results.
      searchKeys={["personName", "issueKey", "issueSummary", "parentSummary", "billable"]}
      emptyMessage="No entries match this filter."
      pageSize={20}
      toolbar={
        <p className="text-sm text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">{totalHours.toFixed(2)} h</span> across{" "}
          {facts.length} {facts.length === 1 ? "entry" : "entries"}
        </p>
      }
      sortOptions={[
        { id: "newest", label: "Newest first", compare: (a, b) => b.workDate.localeCompare(a.workDate) },
        { id: "oldest", label: "Oldest first", compare: (a, b) => a.workDate.localeCompare(b.workDate) },
        { id: "longest", label: "Longest first", compare: (a, b) => b.timeSpentSeconds - a.timeSpentSeconds },
        {
          id: "person",
          label: "By person",
          compare: (a, b) => (a.personName ?? "").localeCompare(b.personName ?? ""),
        },
      ]}
      facetFilters={[
        {
          id: "billable",
          label: "Billable",
          options: [
            { value: "Billable", label: "Billable" },
            { value: "Non-billable", label: "Non-billable" },
            { value: "unset", label: "Unset" },
          ],
          // Unset is its own value rather than folded into non-billable:
          // finding the entries nobody has decided about is the whole point.
          getValue: (row) => row.billable ?? "unset",
        },
        {
          id: "description",
          label: "Description",
          options: [
            { value: "missing", label: "Missing" },
            { value: "present", label: "Present" },
          ],
          getValue: (row) => (row.hasNarrative ? "present" : "missing"),
        },
      ]}
    />
  );
}

export function JobsDataTable({ jobs }: { jobs: BudgetRow[] }) {
  const columns = useMemo(() => getJobsColumns(), []);

  return (
    <DataTable
      columns={columns}
      data={jobs}
      searchPlaceholder="Search jobs..."
      searchKeys={["parentKey", "parentSummary", "category", "billable"]}
      emptyMessage="No jobs match this filter."
      pageSize={20}
      sortOptions={[
        { id: "hours", label: "Most hours", compare: (a, b) => b.actualSeconds - a.actualSeconds },
        {
          id: "over",
          label: "Furthest over budget",
          // A job with no estimate sorts last rather than first: it is not
          // "least over budget", there is simply nothing to be over.
          compare: (a, b) => (b.varianceSeconds ?? -Infinity) - (a.varianceSeconds ?? -Infinity),
        },
        { id: "budget", label: "Largest budget", compare: (a, b) => (b.currentSeconds ?? 0) - (a.currentSeconds ?? 0) },
        { id: "key", label: "By key", compare: (a, b) => a.parentKey.localeCompare(b.parentKey) },
      ]}
      facetFilters={[
        {
          id: "status",
          label: "Status",
          options: [
            { value: "started", label: "Started" },
            { value: "not-started", label: "Not started" },
          ],
          // The unstarted jobs are the ones worth finding: a large budget with
          // nothing under it means the work has not begun, or is being
          // recorded somewhere other than Jira.
          getValue: (row) => (row.worklogCount > 0 ? "started" : "not-started"),
        },
        {
          id: "budget",
          label: "Budget",
          options: [
            { value: "over", label: "Over budget" },
            { value: "within", label: "Within budget" },
            { value: "none", label: "No estimate" },
          ],
          getValue: (row) =>
            row.currentSeconds === null ? "none" : (row.varianceSeconds ?? 0) > 0 ? "over" : "within",
        },
      ]}
    />
  );
}
