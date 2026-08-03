"use client";

import { ColumnDef } from "@tanstack/react-table";

import { actionsColumn, columnHeader, statusColumn } from "@/components/data-table-columns";

import { TeamResponseDTO } from "../admin-teams.types";

type Props = {
  onManageMembers: (team: TeamResponseDTO) => void;
  onEdit: (team: TeamResponseDTO) => void;
};

export function getAdminTeamsColumns({ onManageMembers, onEdit }: Props): ColumnDef<TeamResponseDTO>[] {
  return [
    {
      accessorKey: "name",
      meta: { label: "Name" },
      header: columnHeader("Name"),
      cell: ({ row }) => <div className="text-left font-medium text-foreground">{row.original.name}</div>,
    },
    {
      accessorKey: "description",
      meta: { label: "Description" },
      header: columnHeader("Description"),
      cell: ({ row }) => (
        <div className="max-w-md truncate text-left text-muted-foreground">{row.original.description || "-"}</div>
      ),
    },
    {
      accessorKey: "memberCount",
      meta: { label: "Members" },
      header: columnHeader("Members", "center"),
      cell: ({ row }) => (
        <div className="text-center font-mono tabular-nums text-foreground">{row.original.memberCount}</div>
      ),
    },
    statusColumn((team) => team.isActive),
    actionsColumn([
      { label: "Members", onSelect: onManageMembers },
      { label: "Edit", onSelect: onEdit },
    ]),
  ];
}
