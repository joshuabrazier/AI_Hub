"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DataTable, type DataTableFacet, type DataTableSort, type DataTableToggle } from "@/components/data-table";
import { CreateEditDialogs } from "@/components/row-dialogs";

import { LocationResponseDTO } from "../admin-locations.types";
import { getAdminLocationsColumns } from "./admin-locations-columns";
import { AdminLocationsFormDialog } from "./admin-locations-form-dialog";

type AdminLocationsTableProps = {
  locations: LocationResponseDTO[];
};

const LOCATION_SORTS: DataTableSort<LocationResponseDTO>[] = [
  { id: "name", label: "Name (A-Z)", compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "name-desc", label: "Name (Z-A)", compare: (a, b) => b.name.localeCompare(a.name) },
];

const LOCATION_FACETS: DataTableFacet<LocationResponseDTO>[] = [
  {
    id: "status",
    label: "Status",
    options: [
      { value: "active", label: "Active" },
      { value: "inactive", label: "Inactive" },
    ],
    getValue: (l) => (l.isActive ? "active" : "inactive"),
  },
];

// Hoisted so the reference is stable across renders: passed inline these would
// be a new array/object every render, churning the table's filtered-data memo
// and bouncing it back to page 1 whenever a dialog opens.
const LOCATION_SEARCH_KEYS: (keyof LocationResponseDTO & string)[] = ["name", "address"];

const LOCATION_ACTIVE_FILTER: DataTableToggle<LocationResponseDTO> = { predicate: (l) => l.isActive };

export function AdminLocationsTable({ locations }: AdminLocationsTableProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<LocationResponseDTO | null>(null);

  // Active status is toggled from the edit dialog's "Active" switch, not a
  // per-row button.
  const columns = getAdminLocationsColumns({
    onEdit: (location) => setSelectedLocation(location),
  });

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={locations}
        searchPlaceholder="Search locations..."
        searchKeys={LOCATION_SEARCH_KEYS}
        toolbar={<Button onClick={() => setAddOpen(true)}>Add Location</Button>}
        activeFilter={LOCATION_ACTIVE_FILTER}
        sortOptions={LOCATION_SORTS}
        facetFilters={LOCATION_FACETS}
        emptyMessage="No locations yet."
      />

      <CreateEditDialogs
        createOpen={addOpen}
        onCreateOpenChange={setAddOpen}
        selected={selectedLocation}
        onClearSelected={() => setSelectedLocation(null)}
        render={(location, open, onOpenChange) => (
          <AdminLocationsFormDialog location={location} open={open} onOpenChange={onOpenChange} />
        )}
      />
    </div>
  );
}
