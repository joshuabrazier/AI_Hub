"use server";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { handleServerApiError } from "@/lib/handle-errors";
import { ServerApiResponse } from "@/lib/types";
import { type ResolvedProjectPlan } from "@/lib/delivery/project-plan";

import { applyProjectPlanService, draftProjectPlanService } from "./project-plan.service";
import { revalidateProjectViews } from "./delivery-setup.service";

// ===================================================================
// "CREATE WITH AI", IN TWO ACTS
//
// Reading a brief and creating a project are two actions on purpose, and the
// gap between them is where a person stands.
//
// draft READS AND WRITES NOTHING. It calls the model, resolves every name
// against real records, and hands back what it WOULD do - which client, how
// many tasks, who each is assigned to, what it could not match. Somebody
// looks at that.
//
// apply TAKES THE PLAN BACK and writes it in one transaction. It re-resolves
// nothing, because the plan it is given has already been through the
// resolver and its ids came from there.
//
// THAT LAST PART IS WHY apply RE-CHECKS EVERYTHING IT CAN. The plan makes a
// round trip through a browser, so what comes back is a request body like
// any other - Zod-shaped, but a caller could edit an id inside it. The
// service refuses a non-admin, refuses a plan carrying a blocker, and every
// id lands in a foreign key that will not accept an invented one. What a
// tampered plan CANNOT do is reach a client or a person the caller could not
// already reach: creating a project is admin-only, and an admin can already
// pick any client and any member on the setup screen. So the round trip
// costs nothing here, where on a member-facing surface it would need the
// plan held server-side instead.
// ===================================================================

export async function draftProjectPlanAction(
  brief: string,
): Promise<ServerApiResponse<ResolvedProjectPlan>> {
  try {
    const actor = await requireUserRole([USER_ROLES.ADMIN]);

    const plan = await draftProjectPlanService(brief, { id: actor.id, role: actor.role });

    return { success: true, data: plan } satisfies ServerApiResponse<ResolvedProjectPlan>;
  } catch (error) {
    return handleServerApiError("draftProjectPlanAction", error);
  }
}

export async function applyProjectPlanAction(
  plan: ResolvedProjectPlan,
): Promise<ServerApiResponse<{ projectId: string }>> {
  try {
    const actor = await requireUserRole([USER_ROLES.ADMIN]);

    const applied = await applyProjectPlanService(plan, { id: actor.id, role: actor.role });

    revalidateProjectViews();

    return {
      success: true,
      data: { projectId: applied.projectId },
    } satisfies ServerApiResponse<{ projectId: string }>;
  } catch (error) {
    return handleServerApiError("applyProjectPlanAction", error);
  }
}
