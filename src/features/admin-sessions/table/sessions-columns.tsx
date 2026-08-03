"use client";

import { ColumnDef } from "@tanstack/react-table";

import { actionsColumn, columnHeader } from "@/components/data-table-columns";
import { Badge } from "@/components/ui/badge";
import { formatIsoDate, formatTimeRange } from "@/lib/format";
import { SESSION_STATUS, SESSION_STATUS_LABELS, SessionStatus } from "@/lib/data/kysely-database-types";

import { SessionResponseDTO } from "../admin-sessions.types";

function SessionStatusBadge({ status }: { status: SessionStatus }) {
  if (status === SESSION_STATUS.COMPLETED) {
    return (
      <Badge variant="success" className="w-24 justify-center">
        {SESSION_STATUS_LABELS[SESSION_STATUS.COMPLETED]}
      </Badge>
    );
  }
  if (status === SESSION_STATUS.CANCELLED) {
    return (
      <Badge variant="destructive" className="w-24 justify-center">
        {SESSION_STATUS_LABELS[SESSION_STATUS.CANCELLED]}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="w-24 justify-center">
      {SESSION_STATUS_LABELS[SESSION_STATUS.SCHEDULED]}
    </Badge>
  );
}

type Props = {
  onEdit: (session: SessionResponseDTO) => void;
  onRoster: (session: SessionResponseDTO) => void;
};

export function getSessionsColumns({ onEdit, onRoster }: Props): ColumnDef<SessionResponseDTO>[] {
  return [
    {
      accessorKey: "sessionDate",
      meta: { label: "Date" },
      header: columnHeader("Date"),
      cell: ({ row }) => (
        <div className="text-left font-medium text-foreground">
          {formatIsoDate(row.original.sessionDate, "EEE d MMM yyyy")}
        </div>
      ),
    },
    {
      id: "time",
      meta: { label: "Time" },
      header: columnHeader("Time"),
      cell: ({ row }) => (
        <div className="text-left text-muted-foreground">
          {formatTimeRange(row.original.sessionStart, row.original.sessionEnd)}
        </div>
      ),
    },
    {
      id: "class",
      meta: { label: "Class" },
      header: columnHeader("Class"),
      cell: ({ row }) => (
        <div className="text-left text-foreground">
          <span className="font-medium">{row.original.className}</span>
          <span className="text-muted-foreground"> · {row.original.programName}</span>
        </div>
      ),
    },
    {
      accessorKey: "teamName",
      meta: { label: "Team" },
      header: columnHeader("Team"),
      cell: ({ row }) => <div className="text-left text-muted-foreground">{row.original.teamName ?? "No team"}</div>,
    },
    {
      // Not the shared statusColumn: a session's status is its own enum, and a
      // session on a retired class reports the class's state instead.
      accessorKey: "status",
      meta: { label: "Status" },
      header: columnHeader("Status", "center"),
      cell: ({ row }) => (
        <div className="text-center">
          {row.original.classIsActive ? (
            <SessionStatusBadge status={row.original.status} />
          ) : (
            <Badge className="w-24 justify-center border bg-muted text-muted-foreground">Inactive</Badge>
          )}
        </div>
      ),
    },
    actionsColumn([
      { label: "Roster", onSelect: onRoster },
      { label: "Edit", onSelect: onEdit },
    ]),
  ];
}
