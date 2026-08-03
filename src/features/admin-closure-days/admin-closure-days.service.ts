import "server-only";

import { generateId } from "better-auth";
import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/audit/audit-log.types";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { NewClosureDay, USER_ROLES } from "@/lib/data/kysely-database-types";
import {
  createClosureDayRepo,
  deleteClosureDayRepo,
  getClosureDayByDateRepo,
  getClosureDayByIdRepo,
  getClosureDaysRepo,
} from "@/lib/data/repositories/closure-days.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

import { mapClosureDayToDTO } from "./admin-closure-days.mappers";
import {
  ClosureDayDTO,
  CreateClosureDayRequestDTO,
  DeleteClosureDayRequestDTO,
} from "./admin-closure-days.types";

// -------------------------------------------------------------------
// Admin closure days service
//
// A closure day closes the date for EVERYONE - every team's sessions on it are
// shown as cancelled. There is no per-team version of it, so it is admin-only
// and every entry point below says so itself rather than trusting its caller.
// -------------------------------------------------------------------

// Adding or removing a day changes what every schedule shows, so refresh them
// all: the admin views, the manager's team schedule, and the member portal.
function revalidateSchedules(): void {
  revalidatePath(ROUTES.ADMIN_CLOSURE_DAYS);
  revalidatePath(ROUTES.ADMIN_SCHEDULE);
  revalidatePath(ROUTES.ADMIN_SESSIONS);
  revalidatePath(ROUTES.ADMIN_DASHBOARD);
  revalidatePath(ROUTES.MANAGE_SCHEDULE);
  revalidatePath(ROUTES.PORTAL_SCHEDULE);
}

// -------------------------------------------------------------------
// Get all closure days, soonest first.
// -------------------------------------------------------------------
export async function getClosureDaysService(): Promise<ClosureDayDTO[]> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const rows = await getClosureDaysRepo();
    return rows.map(mapClosureDayToDTO);
  } catch (error) {
    throw handleError("getClosureDaysService", error);
  }
}

// -------------------------------------------------------------------
// Add a closure day. Rejects a date that has already been added: the day_date
// UNIQUE constraint is the real guard, this only gets in first with a message
// worth reading.
// -------------------------------------------------------------------
export async function createClosureDayService(requestDTO: CreateClosureDayRequestDTO): Promise<string> {
  try {
    // The creator is taken from the SESSION, not from the request - who added a
    // closure day is a fact about the caller, never something they can supply.
    const user = await requireUserRole([USER_ROLES.ADMIN]);

    const existing = await getClosureDayByDateRepo(requestDTO.dayDate);
    if (existing) throw new DisplayErrorMessage("That date is already a closure day.");

    const now = new Date();
    const row: NewClosureDay = {
      id: generateId(),
      dayDate: requestDTO.dayDate,
      reason: requestDTO.reason.trim(),
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    };

    const created = await createClosureDayRepo(row);

    await recordAuditEvent({
      action: AUDIT_ACTIONS.CLOSURE_DAY_ADDED,
      entityType: AUDIT_ENTITY_TYPES.CLOSURE_DAY,
      entityId: created.id,
      summary: `Added closure day ${created.dayDate}`,
      metadata: { reason: created.reason },
    });

    revalidateSchedules();

    return created.id;
  } catch (error) {
    throw handleError("createClosureDayService", error);
  }
}

// -------------------------------------------------------------------
// Remove a closure day. Non-destructive: the sessions on that date were never
// changed, so they simply return to the schedule.
// -------------------------------------------------------------------
export async function deleteClosureDayService(requestDTO: DeleteClosureDayRequestDTO): Promise<void> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    // Read the row before deleting it: afterwards there is nothing left to name
    // in the trail. An id that matches nothing is a no-op, not an error - the
    // day is already gone, which is what the caller asked for.
    const existing = await getClosureDayByIdRepo(requestDTO.id);
    if (!existing) return;

    await deleteClosureDayRepo(existing.id);

    await recordAuditEvent({
      action: AUDIT_ACTIONS.CLOSURE_DAY_REMOVED,
      entityType: AUDIT_ENTITY_TYPES.CLOSURE_DAY,
      entityId: existing.id,
      summary: `Removed closure day ${existing.dayDate}`,
      metadata: { reason: existing.reason },
    });

    revalidateSchedules();
  } catch (error) {
    throw handleError("deleteClosureDayService", error);
  }
}
