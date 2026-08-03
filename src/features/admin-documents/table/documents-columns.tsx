"use client";

import { ColumnDef } from "@tanstack/react-table";

import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { DocumentResponseDTO } from "../admin-documents.types";

type Props = {
  onEdit: (doc: DocumentResponseDTO) => void;
  onDelete: (doc: DocumentResponseDTO) => void;
};

export function getDocumentsColumns({ onEdit, onDelete }: Props): ColumnDef<DocumentResponseDTO>[] {
  return [
    {
      accessorKey: "title",
      meta: { label: "Document" },
      header: () => <div className="text-left font-semibold">Document</div>,
      cell: ({ row }) => (
        <div className="text-left">
          <div className="font-medium text-foreground">{row.original.title}</div>
          <div className="font-mono text-xs text-muted-foreground">{row.original.key}</div>
        </div>
      ),
    },
    {
      accessorKey: "version",
      meta: { label: "Version" },
      header: () => <div className="text-center font-semibold">Version</div>,
      cell: ({ row }) => (
        <div className="text-center font-mono tabular-nums text-foreground">{row.original.version}</div>
      ),
    },
    {
      id: "required",
      meta: { label: "Required" },
      header: () => <div className="text-center font-semibold">Required</div>,
      cell: ({ row }) => (
        <div className="flex justify-center">
          {row.original.isRequired ? (
            <Badge variant="default">Required</Badge>
          ) : (
            <Badge variant="secondary">Optional</Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: "signedCount",
      meta: { label: "Signed" },
      header: () => <div className="text-center font-semibold">Signed</div>,
      // Counts only people in the caller's scope, and only signatures against
      // the version that is current right now.
      cell: ({ row }) => (
        <div className="text-center font-mono tabular-nums text-foreground">{row.original.signedCount}</div>
      ),
    },
    {
      accessorKey: "isActive",
      meta: { label: "Status" },
      header: () => <div className="text-center font-semibold">Status</div>,
      cell: ({ row }) => (
        <div className="text-center">
          <StatusBadge active={row.original.isActive} />
        </div>
      ),
    },
    {
      id: "actions",
      meta: { label: "Actions" },
      header: () => <div className="text-center font-semibold">Actions</div>,
      cell: ({ row }) => (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" className="w-20" onClick={() => onEdit(row.original)}>
            Edit
          </Button>
          <Button variant="destructive" size="sm" className="w-20" onClick={() => onDelete(row.original)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];
}
