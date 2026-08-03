"use client";

import { ColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";

import { DocumentSignerDTO } from "../admin-documents.types";
import { ViewSignatureDialog } from "./view-signature-dialog";

export function getDocumentSignersColumns(): ColumnDef<DocumentSignerDTO>[] {
  return [
    {
      accessorKey: "name",
      meta: { label: "Person" },
      header: () => <div className="text-left font-semibold">Person</div>,
      cell: ({ row }) => (
        <div className="text-left">
          <div className="font-medium text-foreground">{row.original.name}</div>
          <div className="text-xs text-muted-foreground">{row.original.email}</div>
        </div>
      ),
    },
    {
      id: "teams",
      meta: { label: "Teams" },
      header: () => <div className="text-left font-semibold">Teams</div>,
      // Membership is optional in both directions, so no team is a normal
      // answer rather than missing data.
      cell: ({ row }) =>
        row.original.teamNames.length === 0 ? (
          <div className="text-left text-muted-foreground">-</div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.original.teamNames.map((teamName) => (
              <Badge key={teamName} variant="secondary">
                {teamName}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      accessorKey: "outstandingCount",
      meta: { label: "Documents" },
      header: () => <div className="text-center font-semibold">Documents</div>,
      cell: ({ row }) => {
        const { signedCount, documents, outstandingCount } = row.original;

        return (
          <div className="flex flex-col items-center gap-1">
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {signedCount} of {documents.length} signed
            </span>
            {outstandingCount > 0 ? (
              <Badge variant="destructive">
                {outstandingCount} outstanding
              </Badge>
            ) : (
              <Badge variant="success">Up to date</Badge>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "isActive",
      meta: { label: "Account" },
      header: () => <div className="text-center font-semibold">Account</div>,
      // The account's own status, so a deactivated person still owing a
      // signature is visibly not somebody to chase.
      cell: ({ row }) => (
        <div className="text-center">
          {row.original.isActive ? (
            <Badge variant="secondary">Active</Badge>
          ) : (
            <Badge variant="outline">Deactivated</Badge>
          )}
        </div>
      ),
    },
    {
      id: "actions",
      meta: { label: "Actions" },
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <ViewSignatureDialog signer={row.original} />
        </div>
      ),
    },
  ];
}
