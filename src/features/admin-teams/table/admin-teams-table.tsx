"use client";

import { useState } from "react";

import { DataTable, type DataTableFacet, type DataTableSort, type DataTableToggle } from "@/components/data-table";
import { CreateEditDialogs, RowDialog } from "@/components/row-dialogs";
import { Button } from "@/components/ui/button";

import { TeamResponseDTO } from "../admin-teams.types";
import { AdminTeamMembersDialog } from "./admin-team-members-dialog";
import { getAdminTeamsColumns } from "./admin-teams-columns";
import { AdminTeamsFormDialog } from "./admin-teams-form-dialog";

type AdminTeamsTableProps = {
  teams: TeamResponseDTO[];
};

const TEAM_SORTS: DataTableSort<TeamResponseDTO>[] = [
  { id: "name", label: "Name (A-Z)", compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "name-desc", label: "Name (Z-A)", compare: (a, b) => b.name.localeCompare(a.name) },
  { id: "members-desc", label: "Most members", compare: (a, b) => b.memberCount - a.memberCount },
];

const TEAM_FACETS: DataTableFacet<TeamResponseDTO>[] = [
  {
    id: "status",
    label: "Status",
    options: [
      { value: "active", label: "Active" },
      { value: "inactive", label: "Inactive" },
    ],
    getValue: (team) => (team.isActive ? "active" : "inactive"),
  },
];

// Hoisted so the reference is stable across renders: passed inline these would
// be a new array/object every render, churning the table's filtered-data memo
// and bouncing it back to page 1 whenever a dialog opens.
const TEAM_SEARCH_KEYS: (keyof TeamResponseDTO & string)[] = ["name", "description"];

const TEAM_ACTIVE_FILTER: DataTableToggle<TeamResponseDTO> = { predicate: (team) => team.isActive };

export function AdminTeamsTable({ teams }: AdminTeamsTableProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<TeamResponseDTO | null>(null);
  const [membersTeam, setMembersTeam] = useState<TeamResponseDTO | null>(null);

  // Active status is toggled from the edit dialog's "Active" switch, not a
  // per-row button.
  const columns = getAdminTeamsColumns({
    onManageMembers: (team) => setMembersTeam(team),
    onEdit: (team) => setSelectedTeam(team),
  });

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={teams}
        searchPlaceholder="Search teams..."
        searchKeys={TEAM_SEARCH_KEYS}
        toolbar={<Button onClick={() => setAddOpen(true)}>Add Team</Button>}
        activeFilter={TEAM_ACTIVE_FILTER}
        sortOptions={TEAM_SORTS}
        facetFilters={TEAM_FACETS}
        emptyMessage="No teams yet."
      />

      <CreateEditDialogs
        createOpen={addOpen}
        onCreateOpenChange={setAddOpen}
        selected={selectedTeam}
        onClearSelected={() => setSelectedTeam(null)}
        render={(team, open, onOpenChange) => (
          <AdminTeamsFormDialog team={team} open={open} onOpenChange={onOpenChange} />
        )}
      />

      {/* View one team and manage its membership */}
      <RowDialog
        row={membersTeam}
        onClear={() => setMembersTeam(null)}
        render={(team, open, onOpenChange) => (
          <AdminTeamMembersDialog team={team} open={open} onOpenChange={onOpenChange} />
        )}
      />
    </div>
  );
}
