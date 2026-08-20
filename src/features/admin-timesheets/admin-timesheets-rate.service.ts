import "server-only";

import { generateId } from "better-auth";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES, type StaffRate } from "@/lib/data/kysely-database-types";
import {
  deleteStaffRateRepo,
  listStaffRatesForPersonRepo,
  listStaffRatesRepo,
  upsertStaffRateRepo,
} from "@/lib/data/repositories/staff-rate.repository";
import { handleError } from "@/lib/handle-errors";
import { resolveRateFor, type StaffRateRow } from "@/lib/timesheet/revenue";
import { todayInAppZone } from "@/lib/timezone";

import type { PersonRatesDTO, SaveStaffRateRequestDTO, StaffRateDTO } from "./admin-timesheets-rate.types";

// -------------------------------------------------------------------
// Staff charge rates.
//
// THE GUARD IS HERE on every function including the reads. Charge rates are
// commercial figures and cost rates are a pay proxy, so this is more sensitive
// than the hours it values, and the repository is unscoped by design.
// -------------------------------------------------------------------

function toDTO(row: StaffRate): StaffRateDTO {
  return {
    id: row.id,
    personId: row.personId,
    personName: row.personName,
    effectiveFrom: row.effectiveFrom,
    chargeRateCents: row.chargeRateCents,
    costRateCents: row.costRateCents,
    notes: row.notes,
  };
}

// The shape the pure valuation engine wants. Narrowed deliberately: it has no
// business with ids, names or notes, and handing it the whole row would invite
// it to grow a dependency on them.
export function toRateRows(rows: StaffRate[]): StaffRateRow[] {
  return rows.map((row) => ({
    personId: row.personId,
    effectiveFrom: row.effectiveFrom,
    chargeRateCents: row.chargeRateCents,
    costRateCents: row.costRateCents,
  }));
}

// -------------------------------------------------------------------
// Every rate row, for valuation.
//
// Not filtered to "current": a period's worklogs are each valued at the rate
// in force on their own date, so the whole history is the input. The table is
// one row per person per rate change, so it stays small.
// -------------------------------------------------------------------
export async function getStaffRateRowsService(): Promise<StaffRateRow[]> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    return toRateRows(await listStaffRatesRepo());
  } catch (error) {
    throw handleError("getStaffRateRowsService", error);
  }
}

export async function getPersonRatesService(personId: string): Promise<PersonRatesDTO> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const rows = await listStaffRatesForPersonRepo(personId);
    const rates = rows.map(toDTO);

    // "Current" means in force TODAY, resolved the same way a worklog resolves
    // its own rate - not simply the newest row, because a rate can be entered
    // with a future start date.
    const current = resolveRateFor(toRateRows(rows), personId, todayInAppZone());

    return {
      personId,
      rates,
      currentChargeRateCents: current?.chargeRateCents ?? null,
      currentCostRateCents: current?.costRateCents ?? null,
    };
  } catch (error) {
    throw handleError("getPersonRatesService", error);
  }
}

export async function saveStaffRateService(request: SaveStaffRateRequestDTO): Promise<void> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    await upsertStaffRateRepo({
      id: generateId(),
      personId: request.personId,
      personName: request.personName ?? null,
      effectiveFrom: request.effectiveFrom,
      chargeRateCents: request.chargeRate,
      costRateCents: request.costRate,
      notes: request.notes ?? null,
    });
  } catch (error) {
    throw handleError("saveStaffRateService", error);
  }
}

export async function deleteStaffRateService(id: string): Promise<void> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    // No existence check. Removing something already gone is the outcome the
    // caller wanted, and answering "no such rate" to a guessed id is the
    // enumeration oracle this codebase avoids elsewhere.
    await deleteStaffRateRepo(id);
  } catch (error) {
    throw handleError("deleteStaffRateService", error);
  }
}
