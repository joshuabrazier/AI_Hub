import z from "zod";

import { TABLE_ID_LENGTH } from "@/lib/constants";
import { TEAM_ROLES, USER_ROLES, type TeamRole, type UserRole } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Admin Users
//
// One screen for EVERYONE with an account - admins, managers and members.
// There is no separate "staff" list any more: the platform role is a column,
// not a different page, because a person can be promoted between roles without
// changing what they are.
//
// A row is either a real user account or a pending invitation. They are shown
// together so an admin can see that somebody has been invited but has not
// signed up yet, which is otherwise invisible.
// -------------------------------------------------------------------
export const USER_OR_INVITATION = {
  User: "User",
  Invitation: "Invitation",
} as const;

export type UserOrInvitationType = (typeof USER_OR_INVITATION)[keyof typeof USER_OR_INVITATION];

export const ADMIN_USER_DISPLAY_STATUS = {
  Active: "Active",
  Inactive: "Inactive",
  Pending: "Pending",
} as const;

export type AdminUserDisplayStatusType = (typeof ADMIN_USER_DISPLAY_STATUS)[keyof typeof ADMIN_USER_DISPLAY_STATUS];

// A team the person belongs to, with the role they hold inside it. Shown so an
// admin can see a manager's actual scope: a manager with no 'manager' team
// membership can reach /manage but sees nothing there, and that is otherwise
// impossible to spot from this screen.
export type AdminUserTeamDTO = {
  teamId: string;
  teamName: string;
  teamRole: TeamRole;
};

export type AdminUserResponseDTO = {
  id: string;
  name: string;
  email: string;
  userRole: UserRole;
  userOrInvitation: UserOrInvitationType;
  displayStatus: AdminUserDisplayStatusType;
  // Empty for an invitation that names no team, and for anyone in no team.
  teams: AdminUserTeamDTO[];
  // Denormalised for the table's search/sort, which work on strings.
  teamNames: string;
  // Whether they have an app-level second factor set up. Drives whether the
  // reset is offered at all - there is nothing to reset otherwise, and an
  // always-visible destructive button invites a pointless click.
  hasTwoFactor: boolean;
};

// -------------------------------------------------------------------
// Update a user: platform role and/or active status.
//
// Both are server-assigned. They are accepted here because the ACTION is
// admin-guarded, never because the client sent them - Better Auth keeps both
// `input:false` so no sign-up or profile update can reach them.
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// Clear somebody's app-level second factor.
//
// The id is the SUBJECT - the person being reset - and it is the only field.
// The ACTOR is never in this shape: it is resolved from the session inside
// the service, so there is no request in which one admin could attribute a
// reset to another.
// -------------------------------------------------------------------
export const ResetUserTwoFactorSchema = z.object({
  id: z.string().min(TABLE_ID_LENGTH),
});

export type ResetUserTwoFactorRequestDTO = z.infer<typeof ResetUserTwoFactorSchema>;

export const UpdateAdminUserSchema = z.object({
  id: z.string().min(TABLE_ID_LENGTH),
  userRole: z.enum(USER_ROLES).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateAdminUserRequestDTO = z.infer<typeof UpdateAdminUserSchema>;

// -------------------------------------------------------------------
// Invite somebody. The invitation may optionally place them into a team with
// a team role on acceptance.
//
// teamRole only means anything alongside a teamId, matching the CHECK
// constraint on user_invitations - rejected here as well so the failure is a
// field error on the form rather than a database error the admin cannot read.
// -------------------------------------------------------------------
export const AddAdminUserInvitationSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    email: z.email(),
    userRole: z.enum(USER_ROLES),
    teamId: z.string().min(1).optional(),
    teamRole: z.enum(TEAM_ROLES).optional(),
  })
  .refine((data) => data.teamRole === undefined || data.teamId !== undefined, {
    message: "Choose a team before choosing a role in it",
    path: ["teamRole"],
  });

export type AddAdminUserInvitationRequestDTO = z.infer<typeof AddAdminUserInvitationSchema>;

export const CancelAdminUserInvitationSchema = z.object({
  id: z.string().min(TABLE_ID_LENGTH),
});

export type CancelAdminUserInvitationRequestDTO = z.infer<typeof CancelAdminUserInvitationSchema>;

// A team an admin can drop an invitee into. Active teams only - a retired team
// must not gain new members.
export type InvitableTeamDTO = {
  id: string;
  name: string;
};
