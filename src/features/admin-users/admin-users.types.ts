import z from "zod";

import { TABLE_ID_LENGTH } from "@/lib/constants";
import { USER_ROLES, type UserRole } from "@/lib/data/kysely-database-types";

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

export type AdminUserResponseDTO = {
  id: string;
  name: string;
  email: string;
  userRole: UserRole;
  userOrInvitation: UserOrInvitationType;
  displayStatus: AdminUserDisplayStatusType;
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
// Invite somebody. The invitation says what ROLE they land with; teams are
// gone, so there is nothing else to pre-assign.
// -------------------------------------------------------------------
export const AddAdminUserInvitationSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.email(),
  userRole: z.enum(USER_ROLES),
});

export type AddAdminUserInvitationRequestDTO = z.infer<typeof AddAdminUserInvitationSchema>;

export const CancelAdminUserInvitationSchema = z.object({
  id: z.string().min(TABLE_ID_LENGTH),
});

export type CancelAdminUserInvitationRequestDTO = z.infer<typeof CancelAdminUserInvitationSchema>;
