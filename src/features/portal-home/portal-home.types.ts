import type { TeamRole } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Member portal home DTOs
//
// Everything here belongs to the SIGNED-IN member. There is no id anywhere in
// this shape, and no page under /portal takes one: the session is the
// identity, so there is nothing to tamper with.
// -------------------------------------------------------------------

// A team the member belongs to. `teamRole` is their role INSIDE the team.
export type PortalTeamDTO = {
  teamId: string;
  teamName: string;
  teamRole: TeamRole;
  isActive: boolean;
};

export type PortalHomeDTO = {
  // What to greet them by, from the session. Null when their account has no
  // usable name.
  firstName: string | null;
  teams: PortalTeamDTO[];
};
