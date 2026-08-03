import z from "zod";

import { TABLE_ID_LENGTH } from "@/lib/constants";
import { TEAM_ROLES, type TeamRole } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Team response DTO (what the teams table consumes)
//
// `memberCount` is carried on the row rather than fetched per team, so the
// list renders from one pass of data.
// -------------------------------------------------------------------
export type TeamResponseDTO = {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  memberCount: number;
};

// -------------------------------------------------------------------
// One member of a team.
//
// `teamRole` is their role INSIDE this team - distinct from their platform
// role. `isActive` is the USER ACCOUNT's status, so an admin can see a
// deactivated person still holding a place in the team.
// -------------------------------------------------------------------
export type TeamMemberResponseDTO = {
  membershipId: string;
  teamId: string;
  userId: string;
  teamRole: TeamRole;
  // The name to greet them by, falling back to their full name.
  displayName: string;
  fullName: string;
  email: string;
  isActive: boolean;
};

// An account the "add member" picker may offer: active, still identifiable,
// and not already in the team.
export type AssignableUserDTO = {
  id: string;
  name: string;
  email: string;
};

// -------------------------------------------------------------------
// One team, its membership, and the accounts that can still be added to it.
// -------------------------------------------------------------------
export type TeamDetailResponseDTO = {
  team: TeamResponseDTO;
  members: TeamMemberResponseDTO[];
  assignableUsers: AssignableUserDTO[];
};

// -------------------------------------------------------------------
// Shared shape
// -------------------------------------------------------------------
const teamBaseShape = {
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500),
  isActive: z.boolean(),
};

// Ids are always re-checked server-side; the length bound only keeps obvious
// rubbish out of the query.
const teamIdSchema = z.string().min(TABLE_ID_LENGTH);
const userIdSchema = z.string().min(TABLE_ID_LENGTH);

// -------------------------------------------------------------------
// Create / Update team schemas + DTOs
// -------------------------------------------------------------------
export const CreateTeamSchema = z.object(teamBaseShape);

export type CreateTeamRequestDTO = z.infer<typeof CreateTeamSchema>;

export const UpdateTeamSchema = z.object({ id: teamIdSchema, ...teamBaseShape });

export type UpdateTeamRequestDTO = z.infer<typeof UpdateTeamSchema>;

export const GetTeamDetailSchema = z.object({ teamId: teamIdSchema });

export type GetTeamDetailRequestDTO = z.infer<typeof GetTeamDetailSchema>;

// -------------------------------------------------------------------
// Membership schemas + DTOs
//
// Every one of these carries a team id and a user id from the client. Neither
// is proof of anything: the service re-checks the caller's own authority
// before touching the row, and these schemas only bound the shape.
// -------------------------------------------------------------------
export const AddTeamMemberSchema = z.object({
  teamId: teamIdSchema,
  userId: userIdSchema,
  teamRole: z.enum(TEAM_ROLES),
});

export type AddTeamMemberRequestDTO = z.infer<typeof AddTeamMemberSchema>;

export const UpdateTeamMemberRoleSchema = z.object({
  teamId: teamIdSchema,
  userId: userIdSchema,
  teamRole: z.enum(TEAM_ROLES),
});

export type UpdateTeamMemberRoleRequestDTO = z.infer<typeof UpdateTeamMemberRoleSchema>;

export const RemoveTeamMemberSchema = z.object({
  teamId: teamIdSchema,
  userId: userIdSchema,
});

export type RemoveTeamMemberRequestDTO = z.infer<typeof RemoveTeamMemberSchema>;
