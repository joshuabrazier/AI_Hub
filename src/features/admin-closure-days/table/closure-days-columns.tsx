"use client";

import { ColumnDef } from "@tanstack/react-table";

import { actionsColumn, columnHeader } from "@/components/data-table-columns";
import { formatIsoDate } from "@/lib/format";

import { ClosureDayDTO } from "../admin-closure-days.types";

type Props = {
  onRemove: (day: ClosureDayDTO) => void;
};

export function getClosureDaysColumns({ onRemove }: Props): ColumnDef<ClosureDayDTO>[] {
  return [
    {
      accessorKey: "dayDate",
      meta: { label: "Date" },
      header: columnHeader("Date"),
      cell: ({ row }) => (
        <div className="text-left font-medium text-foreground">
          {formatIsoDate(row.original.dayDate, "EEE d MMM yyyy")}
        </div>
      ),
    },
    {
      accessorKey: "reason",
      meta: { label: "Reason" },
      header: columnHeader("Reason"),
      cell: ({ row }) => <div className="text-left text-foreground">{row.original.reason}</div>,
    },
    actionsColumn([{ label: "Remove", onSelect: onRemove }]),
  ];
}
