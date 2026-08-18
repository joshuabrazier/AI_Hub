import "server-only";

import { revalidatePath } from "next/cache";

import { requireSessionUserAllowingSetup } from "@/lib/auth/session-auth-server";
import { getUserByUserIdRepo, updateUserByIdRepo } from "@/lib/data/repositories/users.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

import type { AccountSetupDTO, CompleteAccountSetupRequestDTO } from "./account-setup.types";

// -------------------------------------------------------------------
// First-run account setup.
//
// Guarded by requireSessionUserAllowingSetup rather than requireUser: the
// ordinary guard redirects anybody whose profile is incomplete TO this
// screen, so using it here would be a redirect loop.
//
// Both functions resolve the account from the session. Nothing takes a user
// id, so there is no request shape that could set up somebody else's
// account.
// -------------------------------------------------------------------

export async function getAccountSetupService(): Promise<AccountSetupDTO> {
  try {
    const sessionUser = await requireSessionUserAllowingSetup();

    const user = await getUserByUserIdRepo(sessionUser.id);

    if (!user) {
      throw new DisplayErrorMessage("We could not load your account. Please sign in again.");
    }

    return {
      // Whatever Entra asserted, for them to confirm.
      name: user.name,
      preferredName: user.preferredName ?? "",
      phoneNumber: user.phoneNumber ?? "",
      email: user.email,
    };
  } catch (error) {
    throw handleError("getAccountSetupService", error);
  }
}

// -------------------------------------------------------------------
// Save it and mark the account set up.
//
// `profileCompletedAt` is what makes this unskippable: until it is set, every
// guard sends them back here. Stamping it is therefore the last thing done,
// so a failed write leaves them on the setup screen rather than through it
// with a half-saved profile.
//
// Email, role, isActive and team are not in the patch. They are not in the
// request shape either, so there is nothing to strip - the schema simply
// cannot express them.
// -------------------------------------------------------------------
export async function completeAccountSetupService(
  requestDTO: CompleteAccountSetupRequestDTO,
): Promise<void> {
  try {
    const sessionUser = await requireSessionUserAllowingSetup();

    await updateUserByIdRepo(sessionUser.id, {
      name: requestDTO.name.trim(),
      preferredName: requestDTO.preferredName.trim() || null,
      phoneNumber: requestDTO.phoneNumber.trim() || null,
      profileCompletedAt: new Date(),
      updatedAt: new Date(),
    });

    revalidatePath(ROUTES.ACCOUNT_SETUP);
  } catch (error) {
    throw handleError("completeAccountSetupService", error);
  }
}
