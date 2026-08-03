"use server";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { STAFF_ROLES } from "@/lib/data/kysely-database-types";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  AddClassMembersRequestDTO,
  AddClassMembersSchema,
  ClassMembershipData,
  ClassSessionEditDTO,
  ClassesPageData,
  CreateClassRequestDTO,
  CreateClassSchema,
  GetClassMembershipRequestDTO,
  GetClassMembershipSchema,
  GetClassSessionsRequestDTO,
  GetClassSessionsSchema,
  RemoveClassMemberRequestDTO,
  RemoveClassMemberSchema,
  UpdateClassRequestDTO,
  UpdateClassResult,
  UpdateClassSchema,
} from "./admin-classes.types";
import {
  addClassMembersService,
  createClassService,
  getClassMembershipService,
  getClassSessionsService,
  getClassesPageDataService,
  removeClassMemberService,
  updateClassService,
} from "./admin-classes.service";

// -------------------------------------------------------------------
// Class actions
//
// The role check here is the OUTER gate only - it keeps members out of a staff
// entry point. Which classes the caller may actually see or touch is decided in
// the service, from the session, against the owning team of the class itself. A
// class that belongs to a team may be administered by that team's managers, so
// the gate is staff rather than admin.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Get Classes (Classes tab)
// -------------------------------------------------------------------
export async function getClassesPageAction(): Promise<ServerApiResponse<ClassesPageData>> {
  try {
    await requireUserRole(STAFF_ROLES);

    const data = await getClassesPageDataService();

    return {
      success: true,
      data,
    } satisfies ServerApiResponse<ClassesPageData>;
  } catch (error) {
    return handleServerApiError("getClassesPageAction", error);
  }
}

// -------------------------------------------------------------------
// Create Class (generates its sessions across its date range)
// -------------------------------------------------------------------
export async function createClassAction(requestDTO: CreateClassRequestDTO): Promise<ServerApiResponse<string>> {
  try {
    await requireUserRole(STAFF_ROLES);

    const validatedRequest = await validateRequest(CreateClassSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const classId = await createClassService(validatedRequest.data);

    return {
      success: true,
      data: classId,
    } satisfies ServerApiResponse<string>;
  } catch (error) {
    return handleServerApiError("createClassAction", error);
  }
}

// -------------------------------------------------------------------
// Update Class
// -------------------------------------------------------------------
export async function updateClassAction(
  requestDTO: UpdateClassRequestDTO,
): Promise<ServerApiResponse<UpdateClassResult>> {
  try {
    await requireUserRole(STAFF_ROLES);

    const validatedRequest = await validateRequest(UpdateClassSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const result = await updateClassService(validatedRequest.data);

    return {
      success: true,
      data: result,
    } satisfies ServerApiResponse<UpdateClassResult>;
  } catch (error) {
    return handleServerApiError("updateClassAction", error);
  }
}

// -------------------------------------------------------------------
// Get a class's sessions (for the edit dialog's editable list)
// -------------------------------------------------------------------
export async function getClassSessionsAction(
  requestDTO: GetClassSessionsRequestDTO,
): Promise<ServerApiResponse<ClassSessionEditDTO[]>> {
  try {
    await requireUserRole(STAFF_ROLES);

    const validatedRequest = await validateRequest(GetClassSessionsSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const data = await getClassSessionsService(validatedRequest.data.classId);

    return { success: true, data } satisfies ServerApiResponse<ClassSessionEditDTO[]>;
  } catch (error) {
    return handleServerApiError("getClassSessionsAction", error);
  }
}

// -------------------------------------------------------------------
// Get a class's membership (for the membership dialog)
// -------------------------------------------------------------------
export async function getClassMembershipAction(
  requestDTO: GetClassMembershipRequestDTO,
): Promise<ServerApiResponse<ClassMembershipData>> {
  try {
    await requireUserRole(STAFF_ROLES);

    const validatedRequest = await validateRequest(GetClassMembershipSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const data = await getClassMembershipService(validatedRequest.data.classId);

    return { success: true, data } satisfies ServerApiResponse<ClassMembershipData>;
  } catch (error) {
    return handleServerApiError("getClassMembershipAction", error);
  }
}

// -------------------------------------------------------------------
// Add one or more people to a class
// -------------------------------------------------------------------
export async function addClassMembersAction(
  requestDTO: AddClassMembersRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUserRole(STAFF_ROLES);

    const validatedRequest = await validateRequest(AddClassMembersSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await addClassMembersService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("addClassMembersAction", error);
  }
}

// -------------------------------------------------------------------
// Remove somebody from a class
// -------------------------------------------------------------------
export async function removeClassMemberAction(
  requestDTO: RemoveClassMemberRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUserRole(STAFF_ROLES);

    const validatedRequest = await validateRequest(RemoveClassMemberSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await removeClassMemberService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("removeClassMemberAction", error);
  }
}
