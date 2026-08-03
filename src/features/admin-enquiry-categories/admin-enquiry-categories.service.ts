import "server-only";

import { generateId } from "better-auth";
import { revalidatePath } from "next/cache";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { NewEnquiryCategory, UpdateEnquiryCategory, USER_ROLES } from "@/lib/data/kysely-database-types";
import {
  createEnquiryCategoryRepo,
  getActiveEnquiryCategoriesRepo,
  getAllEnquiryCategoriesRepo,
  updateEnquiryCategoryRepo,
} from "@/lib/data/repositories/enquiry-categories.repository";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

import { mapDBEnquiryCategoryToResponseDTO } from "./admin-enquiry-categories.mappers";
import {
  CreateEnquiryCategoryRequestDTO,
  EnquiryCategoryOptionDTO,
  EnquiryCategoryResponseDTO,
  UpdateEnquiryCategoryRequestDTO,
} from "./admin-enquiry-categories.types";

// -------------------------------------------------------------------
// Enquiry categories.
//
// Every management entry point below guards with requireUserRole([ADMIN]).
// The one exception is getActiveEnquiryCategoryOptionsService, which feeds the
// PUBLIC enquiry form and is deliberately unguarded - see its comment.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// All categories, any status - the admin table.
// -------------------------------------------------------------------
export async function getAllEnquiryCategoriesService(): Promise<EnquiryCategoryResponseDTO[]> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const categories = await getAllEnquiryCategoriesRepo();

    return categories.map(mapDBEnquiryCategoryToResponseDTO);
  } catch (error) {
    throw handleError("getAllEnquiryCategoriesService", error);
  }
}

// -------------------------------------------------------------------
// The active categories, as dropdown options for the PUBLIC enquiry form.
//
// Intentionally has NO guard: /contact is open to anyone, and the form cannot
// render its category picker without this. That is safe because the data is
// already public by design - it is a list of the labels shown on that form,
// with no id, status or ordering leaked, and nothing here is team-scoped or
// personal. Do not add a guarded read to this function; add a new one.
// -------------------------------------------------------------------
export async function getActiveEnquiryCategoryOptionsService(): Promise<EnquiryCategoryOptionDTO[]> {
  try {
    const categories = await getActiveEnquiryCategoriesRepo();

    // The name is the value: the enquiry is emailed, not stored, so there is
    // nothing later to resolve an id against.
    return categories.map((category) => ({ value: category.name, label: category.name }));
  } catch (error) {
    throw handleError("getActiveEnquiryCategoryOptionsService", error);
  }
}

// -------------------------------------------------------------------
// Create a category.
// -------------------------------------------------------------------
export async function createEnquiryCategoryService(requestDTO: CreateEnquiryCategoryRequestDTO): Promise<string> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const now = new Date();

    const newEnquiryCategory: NewEnquiryCategory = {
      id: generateId(),
      name: requestDTO.name,
      isActive: requestDTO.isActive,
      orderBy: requestDTO.orderBy,
      createdAt: now,
      updatedAt: now,
    };

    const enquiryCategory = await createEnquiryCategoryRepo(newEnquiryCategory);

    revalidatePath(ROUTES.ADMIN_CONFIGURATIONS);
    // The public form reads the active list, so it has to be rebuilt too.
    revalidatePath(ROUTES.PUBLIC_CONTACT);

    return enquiryCategory.id;
  } catch (error) {
    throw handleError("createEnquiryCategoryService", error);
  }
}

// -------------------------------------------------------------------
// Update a category. Deactivating is how one is retired - there is no delete.
// -------------------------------------------------------------------
export async function updateEnquiryCategoryService(
  requestDTO: UpdateEnquiryCategoryRequestDTO,
): Promise<string | undefined> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const updateEnquiryCategory: UpdateEnquiryCategory = {
      name: requestDTO.name,
      isActive: requestDTO.isActive,
      orderBy: requestDTO.orderBy,
      updatedAt: new Date(),
    };

    const enquiryCategory = await updateEnquiryCategoryRepo(requestDTO.id, updateEnquiryCategory);

    revalidatePath(ROUTES.ADMIN_CONFIGURATIONS);
    revalidatePath(ROUTES.PUBLIC_CONTACT);

    return enquiryCategory?.id;
  } catch (error) {
    throw handleError("updateEnquiryCategoryService", error);
  }
}
