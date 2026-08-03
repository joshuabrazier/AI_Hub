"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable, type DataTableFacet, type DataTableSort, type DataTableToggle } from "@/components/data-table";
import { CreateEditDialogs } from "@/components/row-dialogs";

import { ProgramResponseDTO } from "../admin-programs.types";
import { getAdminProgramsColumns } from "./admin-programs-columns";
import { AdminProgramsFormDialog } from "./admin-programs-form-dialog";

type AdminProgramsTableProps = {
  programs: ProgramResponseDTO[];
};

// First entry is the default order (matches the repo's name ordering).
const PROGRAM_SORTS: DataTableSort<ProgramResponseDTO>[] = [
  { id: "name", label: "Name (A-Z)", compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "newest", label: "Newest first", compare: (a, b) => b.createdAt.localeCompare(a.createdAt) },
  { id: "oldest", label: "Oldest first", compare: (a, b) => a.createdAt.localeCompare(b.createdAt) },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const PROGRAM_FACETS: DataTableFacet<ProgramResponseDTO>[] = [
  { id: "status", label: "Status", options: STATUS_OPTIONS, getValue: (p) => (p.isActive ? "active" : "inactive") },
];

// Hoisted so the reference is stable across renders: passed inline these would
// be a new array/object every render, churning the table's filtered-data memo
// and bouncing it back to page 1 whenever a dialog opens.
const PROGRAM_SEARCH_KEYS: (keyof ProgramResponseDTO & string)[] = ["name", "description"];

const PROGRAM_ACTIVE_FILTER: DataTableToggle<ProgramResponseDTO> = { predicate: (p) => p.isActive };

export function AdminProgramsTable({ programs }: AdminProgramsTableProps) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedProgram, setSelectedProgram] = useState<ProgramResponseDTO | null>(null);

  // Active status is toggled from the edit dialog's "Active" switch, not a
  // per-row button.
  const columns = getAdminProgramsColumns({
    onEdit: (program) => setSelectedProgram(program),
    // Drill down to this program's classes (scopes the Classes table).
    onViewClasses: (program) => router.push(`/admin/classes?programId=${program.id}`),
  });

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={programs}
        searchPlaceholder="Search programs..."
        searchKeys={PROGRAM_SEARCH_KEYS}
        toolbar={<Button onClick={() => setAddOpen(true)}>Add Program</Button>}
        activeFilter={PROGRAM_ACTIVE_FILTER}
        sortOptions={PROGRAM_SORTS}
        facetFilters={PROGRAM_FACETS}
        emptyMessage="No programs yet."
      />

      <CreateEditDialogs
        createOpen={addOpen}
        onCreateOpenChange={setAddOpen}
        selected={selectedProgram}
        onClearSelected={() => setSelectedProgram(null)}
        render={(program, open, onOpenChange) => (
          <AdminProgramsFormDialog program={program} open={open} onOpenChange={onOpenChange} />
        )}
      />
    </div>
  );
}
