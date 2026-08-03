"use client";

import { ColumnDef } from "@tanstack/react-table";

import { actionsColumn, columnHeader, statusColumn } from "@/components/data-table-columns";

import { LocationResponseDTO } from "../admin-locations.types";

type Props = {
  onEdit: (location: LocationResponseDTO) => void;
};

export function getAdminLocationsColumns({ onEdit }: Props): ColumnDef<LocationResponseDTO>[] {
  return [
    {
      accessorKey: "name",
      meta: { label: "Name" },
      header: columnHeader("Name"),
      cell: ({ row }) => <div className="text-left font-medium text-foreground">{row.original.name}</div>,
    },
    {
      accessorKey: "address",
      meta: { label: "Address" },
      header: columnHeader("Address"),
      cell: ({ row }) => (
        <div className="max-w-md truncate text-left text-muted-foreground">{row.original.address}</div>
      ),
    },
    statusColumn((location) => location.isActive),
    actionsColumn([{ label: "Edit", onSelect: onEdit }]),
  ];
}
