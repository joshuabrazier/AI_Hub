"use client";

import { ColumnDef } from "@tanstack/react-table";

import { actionsColumn, columnHeader, statusColumn } from "@/components/data-table-columns";
import { cn } from "@/lib/utils";
import { formatIsoDate, formatTime } from "@/lib/format";
import { DAY_OF_WEEK_LABELS } from "@/lib/data/kysely-database-types";

import { ClassResponseDTO, ClassScheduleDay } from "../admin-classes.types";

// e.g. [{monday,16:00,16:30},{wednesday,17:00,17:30}] -> "Mon 4:00 PM-4:30 PM, Wed 5:00 PM-5:30 PM"
function formatSchedule(schedule: ClassScheduleDay[]): string {
  return schedule
    .map(
      (slot) => `${DAY_OF_WEEK_LABELS[slot.day].slice(0, 3)} ${formatTime(slot.startTime)}-${formatTime(slot.endTime)}`,
    )
    .join(", ");
}

type Props = {
  onEdit: (classRow: ClassResponseDTO) => void;
  onManageMembers: (classRow: ClassResponseDTO) => void;
  onViewSessions: (classRow: ClassResponseDTO) => void;
};

export function getAdminClassesColumns({
  onEdit,
  onManageMembers,
  onViewSessions,
}: Props): ColumnDef<ClassResponseDTO>[] {
  return [
    {
      accessorKey: "name",
      meta: { label: "Class" },
      header: columnHeader("Class"),
      cell: ({ row }) => (
        <div className="text-left">
          <span className="font-medium text-foreground">{row.original.name}</span>
          <span className="block text-xs text-muted-foreground">{row.original.programName}</span>
        </div>
      ),
    },
    {
      id: "schedule",
      meta: { label: "Schedule" },
      header: columnHeader("Schedule"),
      cell: ({ row }) => <div className="text-left text-foreground">{formatSchedule(row.original.schedule)}</div>,
    },
    {
      id: "dates",
      meta: { label: "Dates" },
      header: columnHeader("Dates"),
      cell: ({ row }) => (
        <div className="text-left text-muted-foreground">
          {formatIsoDate(row.original.startDate)} - {formatIsoDate(row.original.endDate)}
        </div>
      ),
    },
    {
      accessorKey: "locationName",
      meta: { label: "Location" },
      header: columnHeader("Location"),
      cell: ({ row }) => <div className="text-left text-muted-foreground">{row.original.locationName}</div>,
    },
    {
      accessorKey: "teamName",
      meta: { label: "Team" },
      header: columnHeader("Team"),
      cell: ({ row }) => <div className="text-left text-muted-foreground">{row.original.teamName ?? "No team"}</div>,
    },
    {
      accessorKey: "leadUserName",
      meta: { label: "Lead" },
      header: columnHeader("Lead"),
      cell: ({ row }) => (
        <div className="text-left text-muted-foreground">{row.original.leadUserName ?? "Unassigned"}</div>
      ),
    },
    {
      id: "members",
      meta: { label: "People" },
      header: columnHeader("People", "center"),
      cell: ({ row }) => {
        const full = row.original.memberCount >= row.original.capacity;
        return (
          <div className={cn("text-center font-medium", full ? "text-destructive" : "text-foreground")}>
            {row.original.memberCount} / {row.original.capacity}
          </div>
        );
      },
    },
    statusColumn((classRow) => classRow.isActive),
    actionsColumn([
      { label: "People", onSelect: onManageMembers, variant: "default" },
      { label: "Sessions", onSelect: onViewSessions },
      { label: "Edit", onSelect: onEdit },
    ]),
  ];
}
