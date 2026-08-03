"use client";

import { ColumnDef } from "@tanstack/react-table";

import { actionsColumn, columnHeader, statusColumn } from "@/components/data-table-columns";

import { NotificationTypeResponseDTO } from "../admin-notification-types.types";

type Props = {
  onEdit: (notificationType: NotificationTypeResponseDTO) => void;
};

export function getAdminNotificationTypesColumns({ onEdit }: Props): ColumnDef<NotificationTypeResponseDTO>[] {
  return [
    {
      accessorKey: "name",
      meta: { label: "Name" },
      header: columnHeader("Name"),
      cell: ({ row }) => (
        <div className="text-left">
          <div className="font-medium text-foreground">{row.original.name}</div>
          <div className="font-mono text-xs text-muted-foreground">{row.original.key}</div>
        </div>
      ),
    },
    {
      accessorKey: "description",
      meta: { label: "Description" },
      header: columnHeader("Description"),
      cell: ({ row }) => (
        <div className="max-w-xs text-left text-sm text-muted-foreground">
          {row.original.description ?? <span className="italic">None</span>}
        </div>
      ),
    },
    {
      accessorKey: "orderBy",
      meta: { label: "Order" },
      header: columnHeader("Order", "center"),
      cell: ({ row }) => <div className="text-center text-foreground">{row.original.orderBy}</div>,
    },
    statusColumn((notificationType) => notificationType.isActive),
    actionsColumn([{ label: "Edit", onSelect: onEdit }]),
  ];
}
