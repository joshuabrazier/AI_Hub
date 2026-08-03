import type { TeamRole } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Manager-facing team DTOs
//
// Deliberately read-only. Who is in a team is an authorization decision, so
// only an admin changes it; a manager sees the team they were given and works
// inside it.
// -------------------------------------------------------------------
export type ManagedTeamDTO = {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  memberCount: number;
  managerCount: number;
};

export type ManagedTeamMemberDTO = {
  membershipId: string;
  userId: string;
  teamRole: TeamRole;
  // The name to greet them by, falling back to their full name.
  displayName: string;
  fullName: string;
  email: string;
  // The USER ACCOUNT's status, so a manager can see a deactivated person still
  // holding a place in the team.
  isActive: boolean;
};

export type ManagedTeamDetailDTO = {
  team: ManagedTeamDTO;
  members: ManagedTeamMemberDTO[];
};

// -------------------------------------------------------------------
// The manager's landing view: the teams they hold, plus the totals across
// them. `isUnrestricted` is true only for an admin looking at the manager
// area, and is used for copy, never to widen a query.
// -------------------------------------------------------------------
export type ManageOverviewDTO = {
  teams: ManagedTeamDTO[];
  totalMembers: number;
  isUnrestricted: boolean;
};
