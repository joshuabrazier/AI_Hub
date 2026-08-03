"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DataTable, type DataTableFacet, type DataTableToggle } from "@/components/data-table";
import { CreateEditDialogs } from "@/components/row-dialogs";

import { AdminNotificationTypesFormDialog } from "./admin-notification-types-form-dialog";
import { NotificationTypeResponseDTO } from "../admin-notification-types.types";
import { getAdminNotificationTypesColumns } from "./admin-notification-types-columns";

const STATUS_FACETS: DataTableFacet<NotificationTypeResponseDTO>[] = [
  {
    id: "status",
    label: "Status",
    options: [
      { value: "active", label: "Active" },
      { value: "inactive", label: "Inactive" },
    ],
    getValue: (t) => (t.isActive ? "active" : "inactive"),
  },
];

// Hoisted so the reference is stable across renders: passed inline these would
// be a new array/object every render, churning the table's filtered-data memo
// and bouncing it back to page 1 whenever a dialog opens.
const NOTIFICATION_TYPE_SEARCH_KEYS: (keyof NotificationTypeResponseDTO & string)[] = ["name", "key"];

const NOTIFICATION_TYPE_ACTIVE_FILTER: DataTableToggle<NotificationTypeResponseDTO> = {
  predicate: (t) => t.isActive,
};

export function AdminNotificationTypesTable({
  notificationTypes,
}: {
  notificationTypes: NotificationTypeResponseDTO[];
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<NotificationTypeResponseDTO | null>(null);

  const columns = getAdminNotificationTypesColumns({ onEdit: (t) => setSelected(t) });

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={notificationTypes}
        searchPlaceholder="Search notification types..."
        searchKeys={NOTIFICATION_TYPE_SEARCH_KEYS}
        toolbar={<Button onClick={() => setAddOpen(true)}>Add notification type</Button>}
        activeFilter={NOTIFICATION_TYPE_ACTIVE_FILTER}
        facetFilters={STATUS_FACETS}
        emptyMessage="No notification types yet."
      />

      <CreateEditDialogs
        createOpen={addOpen}
        onCreateOpenChange={setAddOpen}
        selected={selected}
        onClearSelected={() => setSelected(null)}
        render={(notificationType, open, onOpenChange) => (
          <AdminNotificationTypesFormDialog
            notificationType={notificationType}
            open={open}
            onOpenChange={onOpenChange}
          />
        )}
      />
    </div>
  );
}
