"use client";

import { ColumnDef } from "@tanstack/react-table";

import { actionsColumn, columnHeader, statusColumn } from "@/components/data-table-columns";

import { EnquiryCategoryResponseDTO } from "../admin-enquiry-categories.types";

type Props = {
  onEdit: (enquiryCategory: EnquiryCategoryResponseDTO) => void;
};

export function getAdminEnquiryCategoriesColumns({ onEdit }: Props): ColumnDef<EnquiryCategoryResponseDTO>[] {
  return [
    {
      accessorKey: "name",
      meta: { label: "Name" },
      header: columnHeader("Name"),
      cell: ({ row }) => <div className="text-left font-medium text-foreground">{row.original.name}</div>,
    },
    {
      accessorKey: "orderBy",
      meta: { label: "Order" },
      header: columnHeader("Order", "center"),
      cell: ({ row }) => <div className="text-center text-foreground">{row.original.orderBy}</div>,
    },
    statusColumn((category) => category.isActive),
    actionsColumn([{ label: "Edit", onSelect: onEdit }]),
  ];
}
