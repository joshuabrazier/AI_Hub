"use server";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { SiteContentKey, USER_ROLES } from "@/lib/data/kysely-database-types";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  getLandingContentService,
  getSiteContentService,
  updateContactDetailsService,
  updateLandingBlockService,
  updateSiteContentService,
} from "./admin-content.service";
import {
  LandingContentResponseDTO,
  SiteContentEditorDTO,
  SiteContentResponseDTO,
  UpdateContactDetailsRequestDTO,
  UpdateContactDetailsSchema,
  UpdateLandingBlockRequestDTO,
  UpdateLandingBlockSchema,
  UpdateSiteContentRequestDTO,
  UpdateSiteContentSchema,
} from "./admin-content.types";

// -------------------------------------------------------------------
// Get Site Content
// -------------------------------------------------------------------
export async function getSiteContentAction(): Promise<ServerApiResponse<SiteContentEditorDTO>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const content = await getSiteContentService();

    return {
      success: true,
      data: content,
    } satisfies ServerApiResponse<SiteContentEditorDTO>;
  } catch (error) {
    return handleServerApiError("getSiteContentAction", error);
  }
}

// -------------------------------------------------------------------
// Update Site Content (rich-text pages)
// -------------------------------------------------------------------
export async function updateSiteContentAction(
  requestDTO: UpdateSiteContentRequestDTO,
): Promise<ServerApiResponse<SiteContentResponseDTO>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(UpdateSiteContentSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    // The VALIDATED value, not the raw argument - passing the argument on would
    // make the schema decoration rather than a gate.
    //
    // The service throws when nothing was written, so success here means the
    // row holds `page.contentValue` - which is the sanitised text, not
    // necessarily what was submitted.
    const page = await updateSiteContentService(validatedRequest.data);

    return {
      success: true,
      data: page,
    } satisfies ServerApiResponse<SiteContentResponseDTO>;
  } catch (error) {
    return handleServerApiError("updateSiteContentAction", error);
  }
}

// -------------------------------------------------------------------
// Update Contact Details
// -------------------------------------------------------------------
export async function updateContactDetailsAction(
  requestDTO: UpdateContactDetailsRequestDTO,
): Promise<ServerApiResponse<SiteContentKey>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(UpdateContactDetailsSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    // Throws rather than returning nothing when the write did not happen, so
    // success here really does mean the new address is stored.
    const key = await updateContactDetailsService(validatedRequest.data);

    return {
      success: true,
      data: key,
    } satisfies ServerApiResponse<SiteContentKey>;
  } catch (error) {
    return handleServerApiError("updateContactDetailsAction", error);
  }
}

// -------------------------------------------------------------------
// Get Home Page Content
// -------------------------------------------------------------------
export async function getLandingContentAction(): Promise<ServerApiResponse<LandingContentResponseDTO>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const content = await getLandingContentService();

    return {
      success: true,
      data: content,
    } satisfies ServerApiResponse<LandingContentResponseDTO>;
  } catch (error) {
    return handleServerApiError("getLandingContentAction", error);
  }
}

// -------------------------------------------------------------------
// Update a Home Page block
//
// Validated against the block's own schema - the same one the public page
// reads it back through. A block that would not render is rejected here rather
// than saved and then silently ignored in favour of the shipped default.
// -------------------------------------------------------------------
export async function updateLandingBlockAction(
  requestDTO: UpdateLandingBlockRequestDTO,
): Promise<ServerApiResponse<SiteContentKey>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(UpdateLandingBlockSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    // Throws when nothing was written, so the editor cannot clear its
    // unsaved-changes flag over a block that is still the old copy.
    const key = await updateLandingBlockService(validatedRequest.data);

    return {
      success: true,
      data: key,
    } satisfies ServerApiResponse<SiteContentKey>;
  } catch (error) {
    return handleServerApiError("updateLandingBlockAction", error);
  }
}
