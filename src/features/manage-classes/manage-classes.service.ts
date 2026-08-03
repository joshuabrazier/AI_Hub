import "server-only";

import { requireManagementScope } from "@/lib/auth/session-auth-server";
import { getClassMemberCountsRepo } from "@/lib/data/repositories/class-members.repository";
import {
  deactivateEndedClassesRepo,
  getAllClassesRepo,
  getClassesForTeamsRepo,
} from "@/lib/data/repositories/classes.repository";
import { handleError } from "@/lib/handle-errors";
import { todayInAppZone } from "@/lib/timezone";

import { mapDBClassToManagedClassDTO } from "./manage-classes.mappers";
import { ManagedClassesDTO } from "./manage-classes.types";

// -------------------------------------------------------------------
// Manager classes service
//
// The scope rules, the same three that govern the manager's team views:
//
//   1. The caller's teams come from requireManagementScope(), which resolves
//      them from the SESSION user id. Nothing here reads a team id from a URL
//      or an argument and treats it as evidence.
//   2. isUnrestricted means admin - no team filter at all.
//   3. An EMPTY scope returns NOTHING. getClassesForTeamsRepo short-circuits an
//      empty id list rather than dropping its WHERE, so there is no path where
//      "no teams" widens into "every class".
//
// A class with NO owning team is admin-only. The team-scoped query cannot
// return one (it filters on `teamId in (...)`, and NULL matches nothing), so a
// manager never sees an admin-only class here - that exclusion is structural
// rather than a filter this file has to remember to apply.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// The classes of every team the caller manages.
// -------------------------------------------------------------------
export async function getManagedClassesService(): Promise<ManagedClassesDTO> {
  try {
    const scope = await requireManagementScope();

    // The app's own calendar day, which decides which classes count as running
    // now. A server clock either side of midnight would answer that against a
    // different day than the rest of the app sees.
    const today = todayInAppZone();

    // Retire classes whose end date has passed, exactly as the admin list does
    // - otherwise the same class reads "Active" here and "Inactive" there.
    // This is housekeeping over a calendar fact, not a scoped decision, so it
    // is safe on a manager's read.
    await deactivateEndedClassesRepo(today);

    // Admins are unrestricted, so they get every class - including the
    // team-less ones, which are theirs alone to administer. Everyone else gets
    // exactly their teams', and an empty list in means an empty list out.
    const classRows = scope.isUnrestricted
      ? await getAllClassesRepo(today)
      : await getClassesForTeamsRepo(scope.teamIds, today);

    // The counts are grouped across every class, so they are only read once
    // there is something in scope to attach them to, and are looked up BY the
    // ids already inside that scope - a class outside it has no row to land on.
    const memberCounts = classRows.length === 0 ? [] : await getClassMemberCountsRepo();
    const countByClass = new Map(memberCounts.map((row) => [row.classId, row.count]));

    return {
      // Classes with nobody in them are absent from the counts, so a miss is 0.
      classes: classRows.map((row) => mapDBClassToManagedClassDTO(row, countByClass.get(row.id) ?? 0)),
      isUnrestricted: scope.isUnrestricted,
    };
  } catch (error) {
    throw handleError("getManagedClassesService", error);
  }
}
