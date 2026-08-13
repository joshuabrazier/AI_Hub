import "server-only";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { getTeamMembershipsForUserRepo } from "@/lib/data/repositories/team-members.repository";
import { handleError } from "@/lib/handle-errors";

import { mapDBTeamMembershipToPortalTeamDTO } from "./portal-home.mappers";
import { PortalHomeDTO } from "./portal-home.types";

// -------------------------------------------------------------------
// Member portal home service
//
// The signed-in member is resolved from the SESSION and is the only user id
// that reaches a repository here. That is what makes the portal IDOR-safe by
// construction rather than by checking: there is no id in the URL, no id in
// the arguments, and nothing to compare.
//
// requireUserRole is the guard, and it lives here rather than only in the page
// that calls this - the portal layout checks the same thing, but a service
// that relies on its caller is only as safe as the least careful one it ever
// acquires.
// -------------------------------------------------------------------
export async function getPortalHomeService(): Promise<PortalHomeDTO> {
  try {
    const user = await requireUserRole([USER_ROLES.MEMBER]);

    const memberships = await getTeamMembershipsForUserRepo(user.id);

    const firstName = user.name?.trim().split(" ")[0] || null;

    return {
      firstName,
      teams: memberships.map(mapDBTeamMembershipToPortalTeamDTO),
    };
  } catch (error) {
    throw handleError("getPortalHomeService", error);
  }
}
