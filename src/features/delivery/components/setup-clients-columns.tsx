"use client";

import { ColumnDef } from "@tanstack/react-table";

import { actionsColumn, columnHeader, statusColumn } from "@/components/data-table-columns";

import type { ClientSummaryDTO } from "../delivery.types";

type Props = {
  onRename: (client: ClientSummaryDTO) => void;
  onRetire: (client: ClientSummaryDTO) => void;
  onRestore: (client: ClientSummaryDTO) => void;
};

// -------------------------------------------------------------------
// The client table's columns.
//
// NO DELETE ACTION, and there is none to add: a project holds its client ON
// DELETE RESTRICT so removing one cannot take billing history with it.
// Retire and restore are the pair that replaces it, and each is hidden on
// the rows it does not apply to rather than shown and refused.
//
// The name is typed by somebody, so it renders as a text node.
// -------------------------------------------------------------------
export function getSetupClientsColumns({ onRename, onRetire, onRestore }: Props): ColumnDef<ClientSummaryDTO>[] {
  return [
    {
      accessorKey: "name",
      meta: { label: "Name" },
      header: columnHeader("Name"),
      cell: ({ row }) => <div className="text-left font-medium text-foreground">{row.original.name}</div>,
    },
    {
      accessorKey: "projectCount",
      meta: { label: "Projects" },
      header: columnHeader("Projects", "center"),
      cell: ({ row }) => (
        <div className="text-center figure text-foreground">{row.original.projectCount}</div>
      ),
    },
    statusColumn((client) => client.isActive),
    actionsColumn([
      { label: "Rename", onSelect: onRename },
      { label: "Retire", onSelect: onRetire, hidden: (client) => !client.isActive },
      { label: "Restore", onSelect: onRestore, hidden: (client) => client.isActive },
    ]),
  ];
}
