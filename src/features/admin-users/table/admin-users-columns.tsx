"use client";

import { ColumnDef } from "@tanstack/react-table";

import { actionsColumn, columnHeader } from "@/components/data-table-columns";
import { Badge } from "@/components/ui/badge";
import { TEAM_ROLES, TEAM_ROLE_LABELS, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";

import { ADMIN_USER_DISPLAY_STATUS, AdminUserResponseDTO, USER_OR_INVITATION } from "../admin-users.types";

const isInvitation = (user: AdminUserResponseDTO) => user.userOrInvitation === USER_OR_INVITATION.Invitation;

type Props = {
  onEdit: (user: AdminUserResponseDTO) => void;
  onCancelUserInvitation: (user: AdminUserResponseDTO) => void;
};

export function getAdminUsersColumns({ onEdit, onCancelUserInvitation }: Props): ColumnDef<AdminUserResponseDTO>[] {
  return [
    {
      accessorKey: "name",
      meta: { label: "Name" },
      header: columnHeader("Name"),
      cell: ({ row }) => <div className="text-left font-medium text-foreground">{row.original.name}</div>,
    },
    {
      accessorKey: "email",
      meta: { label: "Email" },
      header: columnHeader("Email"),
      cell: ({ row }) => <div className="text-left text-foreground">{row.original.email}</div>,
    },
    {
      accessorKey: "userRole",
      meta: { label: "Role" },
      header: columnHeader("Role", "center"),
      cell: ({ row }) => (
        <div className="text-center">
          <Badge variant="secondary" className="w-20 justify-center">
            {USER_ROLE_LABELS[row.original.userRole]}
          </Badge>
        </div>
      ),
    },
    {
      id: "teams",
      meta: { label: "Teams" },
      header: columnHeader("Teams"),
      cell: ({ row }) =>
        row.original.teams.length === 0 ? (
          <div className="text-sm text-muted-foreground">No teams</div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.original.teams.map((team) => (
              <Badge key={team.teamId} variant="outline" className="font-normal">
                {team.teamName}
                {/* Only a manager's team role is called out: 'member' is the
                    default and labelling every row with it is just noise. */}
                {team.teamRole === TEAM_ROLES.MANAGER && (
                  <span className="ml-1 text-muted-foreground">({TEAM_ROLE_LABELS[team.teamRole]})</span>
                )}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      accessorKey: "displayStatus",
      meta: { label: "Status" },
      header: columnHeader("Status", "center"),
      cell: ({ row }) => (
        <div className="text-center">
          {row.original.displayStatus === ADMIN_USER_DISPLAY_STATUS.Active && (
            <Badge variant="success" className="w-20 justify-center">
              Active
            </Badge>
          )}
          {row.original.displayStatus === ADMIN_USER_DISPLAY_STATUS.Pending && (
            <Badge variant="warning" className="w-20 justify-center">
              Pending
            </Badge>
          )}
          {row.original.displayStatus === ADMIN_USER_DISPLAY_STATUS.Inactive && (
            <Badge variant="destructive" className="w-20 justify-center">
              Inactive
            </Badge>
          )}
        </div>
      ),
    },
    // An invitation has no account to edit yet - its row id is the invitation
    // id, not a user id - so it only offers Cancel.
    actionsColumn<AdminUserResponseDTO>([
      { label: "Cancel", onSelect: onCancelUserInvitation, hidden: (user) => !isInvitation(user) },
      { label: "Edit", onSelect: onEdit, hidden: isInvitation },
    ]),
  ];
}
