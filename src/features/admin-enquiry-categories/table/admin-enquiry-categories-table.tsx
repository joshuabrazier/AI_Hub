"use client";

import { useState } from "react";

import { DataTable, type DataTableFacet, type DataTableToggle } from "@/components/data-table";
import { CreateEditDialogs } from "@/components/row-dialogs";
import { Button } from "@/components/ui/button";

import { EnquiryCategoryResponseDTO } from "../admin-enquiry-categories.types";
import { AdminEnquiryCategoriesFormDialog } from "./admin-enquiry-categories-form-dialog";
import { getAdminEnquiryCategoriesColumns } from "./admin-enquiry-categories-columns";

const ENQUIRY_CATEGORY_FACETS: DataTableFacet<EnquiryCategoryResponseDTO>[] = [
  {
    id: "status",
    label: "Status",
    options: [
      { value: "active", label: "Active" },
      { value: "inactive", label: "Inactive" },
    ],
    getValue: (category) => (category.isActive ? "active" : "inactive"),
  },
];

// Hoisted so the reference is stable across renders: passed inline these would
// be a new array/object every render, churning the table's filtered-data memo
// and bouncing it back to page 1 whenever a dialog opens.
const ENQUIRY_CATEGORY_SEARCH_KEYS: (keyof EnquiryCategoryResponseDTO & string)[] = ["name"];

const ENQUIRY_CATEGORY_ACTIVE_FILTER: DataTableToggle<EnquiryCategoryResponseDTO> = {
  predicate: (category) => category.isActive,
};

export function AdminEnquiryCategoriesTable({
  enquiryCategories,
}: {
  enquiryCategories: EnquiryCategoryResponseDTO[];
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<EnquiryCategoryResponseDTO | null>(null);

  const columns = getAdminEnquiryCategoriesColumns({ onEdit: (category) => setSelected(category) });

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={enquiryCategories}
        searchPlaceholder="Search categories..."
        searchKeys={ENQUIRY_CATEGORY_SEARCH_KEYS}
        toolbar={<Button onClick={() => setAddOpen(true)}>Add category</Button>}
        activeFilter={ENQUIRY_CATEGORY_ACTIVE_FILTER}
        facetFilters={ENQUIRY_CATEGORY_FACETS}
        emptyMessage="No enquiry categories yet."
      />

      <CreateEditDialogs
        createOpen={addOpen}
        onCreateOpenChange={setAddOpen}
        selected={selected}
        onClearSelected={() => setSelected(null)}
        render={(enquiryCategory, open, onOpenChange) => (
          <AdminEnquiryCategoriesFormDialog
            enquiryCategory={enquiryCategory}
            open={open}
            onOpenChange={onOpenChange}
          />
        )}
      />
    </div>
  );
}
