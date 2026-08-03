"use client";

import { ColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { AuditLogEntryDTO } from "../admin-activity.types";

type Props = {
  onView: (entry: AuditLogEntryDTO) => void;
};

// Access changes stand out: they are the events that alter what somebody can
// reach, and are what an admin is usually scanning for. Everything else uses
// the neutral outline badge.
const categoryClassName = (category: string) => (category === "Access" ? "border-primary text-primary" : undefined);

export function getAdminActivityColumns({ onView }: Props): ColumnDef<AuditLogEntryDTO>[] {
  return [
    {
      id: "when",
      meta: { label: "When" },
      header: () => <div className="text-left font-semibold">When</div>,
      cell: ({ row }) => (
        <div className="whitespace-nowrap text-sm text-foreground">{row.original.createdAtLabel}</div>
      ),
    },
    {
      id: "actor",
      meta: { label: "Who" },
      header: () => <div className="text-left font-semibold">Who</div>,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="font-medium text-foreground">{row.original.actorName}</div>
          {row.original.actorRole && (
            <div className="text-xs text-muted-foreground">{row.original.actorRole}</div>
          )}
        </div>
      ),
    },
    {
      id: "action",
      meta: { label: "Action" },
      header: () => <div className="text-left font-semibold">Action</div>,
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1">
          <span className="font-medium text-foreground">{row.original.actionLabel}</span>
          <Badge variant="outline" className={cn("w-fit", categoryClassName(row.original.category))}>
            {row.original.category}
          </Badge>
        </div>
      ),
    },
    {
      id: "details",
      meta: { label: "Details" },
      header: () => <div className="text-left font-semibold">Details</div>,
      cell: ({ row }) => (
        <div className="text-sm text-foreground">
          {row.original.summary || <span className="text-muted-foreground">-</span>}
          {/* Who it was done TO, and which team it belonged to - the two
              questions the summary line usually cannot answer on its own. */}
          {row.original.subjectUserName && (
            <div className="text-xs text-muted-foreground">Person: {row.original.subjectUserName}</div>
          )}
          {row.original.teamName && (
            <div className="text-xs text-muted-foreground">Team: {row.original.teamName}</div>
          )}
        </div>
      ),
    },
    {
      id: "changes",
      meta: { label: "Changes" },
      header: () => <div className="text-center font-semibold">Changes</div>,
      cell: ({ row }) =>
        row.original.hasDetails ? (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={() => onView(row.original)}>
              View
            </Button>
          </div>
        ) : (
          <div className="text-center text-muted-foreground">-</div>
        ),
    },
  ];
}
