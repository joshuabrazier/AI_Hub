"use server";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  createEnquiryCategoryService,
  getAllEnquiryCategoriesService,
  updateEnquiryCategoryService,
} from "./admin-enquiry-categories.service";
import {
  CreateEnquiryCategoryRequestDTO,
  createEnquiryCategorySchema,
  EnquiryCategoryResponseDTO,
  UpdateEnquiryCategoryRequestDTO,
  updateEnquiryCategorySchema,
} from "./admin-enquiry-categories.types";

// -------------------------------------------------------------------
// Get all enquiry categories (admin only)
// -------------------------------------------------------------------
export async function getAllEnquiryCategoriesAction(): Promise<ServerApiResponse<EnquiryCategoryResponseDTO[]>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const enquiryCategories = await getAllEnquiryCategoriesService();

    return { success: true, data: enquiryCategories } satisfies ServerApiResponse<EnquiryCategoryResponseDTO[]>;
  } catch (error) {
    return handleServerApiError("getAllEnquiryCategoriesAction", error);
  }
}

// -------------------------------------------------------------------
// Create an enquiry category (admin only)
// -------------------------------------------------------------------
export async function createEnquiryCategoryAction(
  requestDTO: CreateEnquiryCategoryRequestDTO,
): Promise<ServerApiResponse<string>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(createEnquiryCategorySchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const id = await createEnquiryCategoryService(validatedRequest.data);

    return { success: true, data: id } satisfies ServerApiResponse<string>;
  } catch (error) {
    return handleServerApiError("createEnquiryCategoryAction", error);
  }
}

// -------------------------------------------------------------------
// Update an enquiry category (admin only)
// -------------------------------------------------------------------
export async function updateEnquiryCategoryAction(
  requestDTO: UpdateEnquiryCategoryRequestDTO,
): Promise<ServerApiResponse<string | undefined>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(updateEnquiryCategorySchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const id = await updateEnquiryCategoryService(validatedRequest.data);

    return { success: true, data: id } satisfies ServerApiResponse<string | undefined>;
  } catch (error) {
    return handleServerApiError("updateEnquiryCategoryAction", error);
  }
}
