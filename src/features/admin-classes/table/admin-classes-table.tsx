"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable, type DataTableFacet, type DataTableSort, type DataTableToggle } from "@/components/data-table";
import { CreateEditDialogs, RowDialog } from "@/components/row-dialogs";
import { TableFilterNotice } from "@/components/table-filter-notice";
import { ROUTES } from "@/lib/routes";

import { ClassResponseDTO, NO_TEAM, SelectOption, UNASSIGNED_LEAD } from "../admin-classes.types";
import { getAdminClassesColumns } from "./admin-classes-columns";
import { AdminClassFormDialog } from "./admin-classes-form-dialog";
import { AdminClassMembersDialog } from "./admin-class-members-dialog";

type Props = {
  classes: ClassResponseDTO[];
  programOptions: SelectOption[];
  locationOptions: SelectOption[];
  teamOptions: SelectOption[];
  leadOptions: SelectOption[];
  canCreateWithoutTeam: boolean;
};

// First entry is the default order.
const CLASS_SORTS: DataTableSort<ClassResponseDTO>[] = [
  { id: "name", label: "Name (A-Z)", compare: (a, b) => a.name.localeCompare(b.name) },
  // Dates are 'YYYY-MM-DD', so a string compare is a date compare.
  { id: "starts", label: "Starting soonest", compare: (a, b) => a.startDate.localeCompare(b.startDate) },
  { id: "newest", label: "Newest first", compare: (a, b) => b.createdAt.localeCompare(a.createdAt) },
  { id: "oldest", label: "Oldest first", compare: (a, b) => a.createdAt.localeCompare(b.createdAt) },
];

// Hoisted so the reference is stable across renders: passed inline these would
// be a new array/object every render, churning the table's filtered-data memo
// and bouncing it back to page 1 whenever a dialog opens.
const CLASS_SEARCH_KEYS: (keyof ClassResponseDTO & string)[] = [
  "name",
  "programName",
  "locationName",
  "teamName",
  "leadUserName",
];

const CLASS_ACTIVE_FILTERS: DataTableToggle<ClassResponseDTO>[] = [
  // On by default: a class is "running" when it is active AND today falls
  // inside its dates, which is what a scheduling screen is for.
  { id: "running", predicate: (row) => row.isRunning, label: "Running now only" },
];

export function AdminClassesTable({
  classes,
  programOptions,
  locationOptions,
  teamOptions,
  leadOptions,
  canCreateWithoutTeam,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedClass, setSelectedClass] = useState<ClassResponseDTO | null>(null);
  const [membersClass, setMembersClass] = useState<ClassResponseDTO | null>(null);

  // Scope to a single program when arriving from the Programs table's
  // "Classes" action (?programId=...).
  const programId = searchParams.get("programId");
  const shownClasses = useMemo(
    () => (programId ? classes.filter((row) => row.programId === programId) : classes),
    [classes, programId],
  );
  const programLabel =
    programOptions.find((option) => option.value === programId)?.label ??
    shownClasses[0]?.programName ??
    programId ??
    "";

  // One facet per categorical column, built from the classes shown so every
  // option in the list is filterable (independent of the running-only toggle).
  const facetFilters = useMemo<DataTableFacet<ClassResponseDTO>[]>(() => {
    const distinct = (pairs: [string, string][]) =>
      Array.from(new Map(pairs).entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label));

    const programs = distinct(shownClasses.map((row) => [row.programId, row.programName]));
    const locations = distinct(shownClasses.map((row) => [row.locationId, row.locationName]));
    const teams = distinct(shownClasses.map((row) => [row.teamId ?? NO_TEAM, row.teamName ?? "No team"]));
    const leads = distinct(
      shownClasses.map((row) => [row.leadUserId ?? UNASSIGNED_LEAD, row.leadUserName ?? "Unassigned"]),
    );

    return [
      { id: "program", label: "Program", options: programs, getValue: (row) => row.programId },
      { id: "location", label: "Location", options: locations, getValue: (row) => row.locationId },
      { id: "team", label: "Team", options: teams, getValue: (row) => row.teamId ?? NO_TEAM },
      { id: "lead", label: "Lead", options: leads, getValue: (row) => row.leadUserId ?? UNASSIGNED_LEAD },
    ];
  }, [shownClasses]);

  // Active status is toggled from the edit dialog's "Active" switch, not a
  // per-row button.
  const columns = getAdminClassesColumns({
    onEdit: (classRow) => setSelectedClass(classRow),
    onManageMembers: (classRow) => setMembersClass(classRow),
    // Drill down to this class's sessions (scopes the Sessions table).
    onViewSessions: (classRow) => router.push(`${ROUTES.ADMIN_SESSIONS}?classId=${classRow.id}`),
  });

  return (
    <div className="space-y-4">
      {programId && <TableFilterNotice label="Program" value={programLabel} onClear={() => router.push(pathname)} />}

      <DataTable
        columns={columns}
        data={shownClasses}
        searchPlaceholder="Search classes..."
        searchKeys={CLASS_SEARCH_KEYS}
        toolbar={<Button onClick={() => setAddOpen(true)}>Add Class</Button>}
        activeFilter={CLASS_ACTIVE_FILTERS}
        sortOptions={CLASS_SORTS}
        facetFilters={facetFilters}
        emptyMessage="No classes yet. Add one to generate its sessions."
      />

      {/* remountCreate: the create dialog builds a session list in local state,
          so each open has to start from a clean schedule rather than the last
          attempt's. */}
      <CreateEditDialogs
        createOpen={addOpen}
        onCreateOpenChange={setAddOpen}
        remountCreate
        selected={selectedClass}
        onClearSelected={() => setSelectedClass(null)}
        render={(classRow, open, onOpenChange) => (
          <AdminClassFormDialog
            classRow={classRow}
            programOptions={programOptions}
            locationOptions={locationOptions}
            teamOptions={teamOptions}
            leadOptions={leadOptions}
            canCreateWithoutTeam={canCreateWithoutTeam}
            open={open}
            onOpenChange={onOpenChange}
          />
        )}
      />

      {/* Who is in the class */}
      <RowDialog
        row={membersClass}
        onClear={() => setMembersClass(null)}
        render={(classRow, open, onOpenChange) => (
          <AdminClassMembersDialog classId={classRow?.id ?? null} open={open} onOpenChange={onOpenChange} />
        )}
      />
    </div>
  );
}
