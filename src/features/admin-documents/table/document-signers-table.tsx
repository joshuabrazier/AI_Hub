"use client";

import { DataTable, type DataTableFacet, type DataTableSort, type DataTableToggle } from "@/components/data-table";

import { DocumentSignerDTO } from "../admin-documents.types";
import { getDocumentSignersColumns } from "./document-signers-columns";

const SIGNER_SORTS: DataTableSort<DocumentSignerDTO>[] = [
  {
    id: "outstanding-desc",
    label: "Most outstanding",
    compare: (a, b) => b.outstandingCount - a.outstandingCount || a.name.localeCompare(b.name),
  },
  { id: "name", label: "Name (A-Z)", compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "name-desc", label: "Name (Z-A)", compare: (a, b) => b.name.localeCompare(a.name) },
];

const SIGNER_FACETS: DataTableFacet<DocumentSignerDTO>[] = [
  {
    id: "standing",
    label: "Signing status",
    options: [
      { value: "outstanding", label: "Something outstanding" },
      { value: "complete", label: "Up to date" },
    ],
    getValue: (signer) => (signer.outstandingCount > 0 ? "outstanding" : "complete"),
  },
];

// Hoisted so the reference is stable across renders: passed inline these would
// be a new array/object every render, churning the table's filtered-data memo
// and bouncing it back to page 1 on any parent re-render.
const SIGNER_SEARCH_KEYS: (keyof DocumentSignerDTO & string)[] = ["name", "email"];

// Deactivated accounts are hidden by default: they are not people to chase for
// a signature, but they stay one toggle away.
const SIGNER_ACTIVE_FILTER: DataTableToggle<DocumentSignerDTO> = {
  predicate: (signer) => signer.isActive,
  label: "Active accounts only",
};

// -------------------------------------------------------------------
// DocumentSignersTable
//
// Who has signed what. The rows are already scoped server-side: an admin sees
// every member, a manager sees the members of the teams they hold, and a scope
// with no teams in it shows nobody.
// -------------------------------------------------------------------
export function DocumentSignersTable({ signers }: { signers: DocumentSignerDTO[] }) {
  const columns = getDocumentSignersColumns();

  return (
    <DataTable
      columns={columns}
      data={signers}
      searchPlaceholder="Search people or email..."
      searchKeys={SIGNER_SEARCH_KEYS}
      activeFilter={SIGNER_ACTIVE_FILTER}
      sortOptions={SIGNER_SORTS}
      facetFilters={SIGNER_FACETS}
      emptyMessage="Nobody to show yet."
    />
  );
}
