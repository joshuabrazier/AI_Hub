"use client";

import { startTransition, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { DataTable, type DataTableFacet, type DataTableSort, type DataTableToggle } from "@/components/data-table";
import { RowDialog } from "@/components/row-dialogs";
import { Button } from "@/components/ui/button";
import { MESSAGES } from "@/lib/constants";
import { USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";

import { cancelAdminInvitationAction } from "../admin-users.actions";
import {
  ADMIN_USER_DISPLAY_STATUS,
  AdminUserResponseDTO,
  USER_OR_INVITATION,
} from "../admin-users.types";
import { AdminUsersEditDialog } from "./admin-users-edit-dialog";
import { AdminUsersInvitationDialog } from "./admin-users-invite-dialog";
import { getAdminUsersColumns } from "./admin-users-columns";

type AdminUsersTableProps = {
  users: AdminUserResponseDTO[];
};

const USER_SORTS: DataTableSort<AdminUserResponseDTO>[] = [
  { id: "name", label: "Name (A-Z)", compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "name-desc", label: "Name (Z-A)", compare: (a, b) => b.name.localeCompare(a.name) },
];

// Hoisted so the reference is stable across renders: passed inline these would
// be a new array/object every render, churning the table's filtered-data memo
// and bouncing it back to page 1 whenever a dialog opens.
const USER_SEARCH_KEYS: (keyof AdminUserResponseDTO & string)[] = ["name", "email"];

const USER_ACTIVE_FILTER: DataTableToggle<AdminUserResponseDTO> = {
  predicate: (user) => user.displayStatus === ADMIN_USER_DISPLAY_STATUS.Active,
};

export function AdminUsersTable({ users }: AdminUsersTableProps) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUserResponseDTO | null>(null);

  const facetFilters = useMemo<DataTableFacet<AdminUserResponseDTO>[]>(() => {
    const roles = Array.from(new Set(users.map((user) => user.userRole)))
      .map((role) => ({ value: role, label: USER_ROLE_LABELS[role] }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const statuses = Array.from(new Set(users.map((user) => user.displayStatus)))
      .map((status) => ({ value: status, label: status }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return [
      { id: "role", label: "Role", options: roles, getValue: (user) => user.userRole },
      { id: "status", label: "Status", options: statuses, getValue: (user) => user.displayStatus },
    ];
  }, [users]);

  // Active status is toggled from the edit dialog's switch, not a per-row
  // button. A pending invitation keeps a Cancel row action instead.
  const columns = useMemo(
    () =>
      getAdminUsersColumns({
        onEdit: (user) => setSelectedUser(user),
        onCancelUserInvitation: (invitation) => {
          startTransition(async () => {
            try {
              const response = await cancelAdminInvitationAction({ id: invitation.id });

              if (!response.success) {
                if (response.formError) toast.error(response.formError);
                return;
              }

              toast.success(MESSAGES.USER_INVITATION_CANCELLED);
              router.refresh();
            } catch (error) {
              console.error("Error cancelling invitation:", error);
              toast.error(MESSAGES.SOMETHING_WENT_WRONG);
            }
          });
        },
      }),
    [router],
  );

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={users}
        searchPlaceholder="Search people…"
        searchKeys={USER_SEARCH_KEYS}
        toolbar={<Button onClick={() => setAddOpen(true)}>Invite person</Button>}
        activeFilter={USER_ACTIVE_FILTER}
        sortOptions={USER_SORTS}
        facetFilters={facetFilters}
        emptyMessage="No people found."
      />

      {/* Inviting is not "create the selected row" - it takes the assignable
          an invitation rather than a person - so it stays its own dialog. */}
      <AdminUsersInvitationDialog open={addOpen} onOpenChange={setAddOpen} />

      <RowDialog
        row={selectedUser}
        onClear={() => setSelectedUser(null)}
        render={(user, open, onOpenChange) => (
          <AdminUsersEditDialog
            // An invitation has no account behind it yet, so there is nothing
            // to edit; the dialog renders nothing for one.
            user={user?.userOrInvitation === USER_OR_INVITATION.User ? user : null}
            open={open}
            onOpenChange={onOpenChange}
          />
        )}
      />
    </div>
  );
}
