"use server";

import { revalidatePath } from "next/cache";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { handleServerApiError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { ServerApiResponse } from "@/lib/types";

import {
  findSharepointLibrariesService,
  listSharepointDrivesService,
  nominateSharepointLibraryService,
  removeSharepointLibraryService,
  startSharepointCrawlService,
} from "./sharepoint.service";
import {
  DriveIdSchema,
  FindLibrariesSchema,
  NominateLibrarySchema,
  type SharepointDriveDTO,
  type SharepointSiteLookup,
  type StartCrawlResultDTO,
} from "./sharepoint.types";

// -------------------------------------------------------------------
// SharePoint inventory actions.
//
// Validate, then call a service. The role check is repeated here AND in
// every service: an action is the only door a browser can knock on, and a
// service is the only door a page uses, so neither can be the single place
// it lives.
//
// There is deliberately NO action that writes to SharePoint. Phase 1 is
// read-only against Microsoft, and the way that stays true is that no
// such path exists to reach.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Look up a pasted site address. A read, and it leaves nothing behind.
// -------------------------------------------------------------------
export async function findSharepointLibrariesAction(
  input: unknown,
): Promise<ServerApiResponse<SharepointSiteLookup>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const parsed = FindLibrariesSchema.parse(input);
    const data = await findSharepointLibrariesService(parsed);

    return { success: true, data } satisfies ServerApiResponse<SharepointSiteLookup>;
  } catch (error) {
    return handleServerApiError("findSharepointLibrariesAction", error);
  }
}

// -------------------------------------------------------------------
// Start tracking one of the libraries the lookup offered.
// -------------------------------------------------------------------
export async function nominateSharepointLibraryAction(input: unknown): Promise<ServerApiResponse<null>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const parsed = NominateLibrarySchema.parse(input);
    await nominateSharepointLibraryService(parsed);

    revalidatePath(ROUTES.ADMIN_SHAREPOINT);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("nominateSharepointLibraryAction", error);
  }
}

// -------------------------------------------------------------------
// Start a crawl of a tracked library, and do some of it.
//
// The service walks a small first slice before returning, so the button
// reports real numbers rather than "queued". A whole library still needs
// the sweep to finish it - the counts come back so the message can say
// which of those two happened.
// -------------------------------------------------------------------
export async function startSharepointCrawlAction(
  input: unknown,
): Promise<ServerApiResponse<StartCrawlResultDTO>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const parsed = DriveIdSchema.parse(input);
    const data = await startSharepointCrawlService(parsed);

    revalidatePath(ROUTES.ADMIN_SHAREPOINT);

    return { success: true, data } satisfies ServerApiResponse<StartCrawlResultDTO>;
  } catch (error) {
    return handleServerApiError("startSharepointCrawlAction", error);
  }
}

// -------------------------------------------------------------------
// Stop tracking a library and drop the inventory of it.
// -------------------------------------------------------------------
export async function removeSharepointLibraryAction(input: unknown): Promise<ServerApiResponse<null>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const parsed = DriveIdSchema.parse(input);
    await removeSharepointLibraryService(parsed);

    revalidatePath(ROUTES.ADMIN_SHAREPOINT);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("removeSharepointLibraryAction", error);
  }
}

// -------------------------------------------------------------------
// What the page renders.
// -------------------------------------------------------------------
export async function getSharepointDrivesAction(): Promise<ServerApiResponse<SharepointDriveDTO[]>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const data = await listSharepointDrivesService();

    return { success: true, data } satisfies ServerApiResponse<SharepointDriveDTO[]>;
  } catch (error) {
    return handleServerApiError("getSharepointDrivesAction", error);
  }
}
