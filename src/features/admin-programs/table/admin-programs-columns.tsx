"use client";

import { ColumnDef } from "@tanstack/react-table";

import { actionsColumn, columnHeader, statusColumn } from "@/components/data-table-columns";

import { ProgramResponseDTO } from "../admin-programs.types";

type Props = {
  onEdit: (program: ProgramResponseDTO) => void;
  onViewClasses: (program: ProgramResponseDTO) => void;
};

export function getAdminProgramsColumns({ onEdit, onViewClasses }: Props): ColumnDef<ProgramResponseDTO>[] {
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
    statusColumn((program) => program.isActive),
    actionsColumn([
      { label: "Classes", onSelect: onViewClasses },
      { label: "Edit", onSelect: onEdit },
    ]),
  ];
}
