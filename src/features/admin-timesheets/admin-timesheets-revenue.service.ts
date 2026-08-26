import "server-only";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { loadStaffRates } from "./admin-timesheets-loaders";
import { handleError } from "@/lib/handle-errors";
import { computeRevenue, computeRevenueBy, type RevenueSlice, type RevenueTotals } from "@/lib/timesheet/revenue";
import type { WorklogFactRow } from "@/lib/timesheet/timesheet.types";

import { toRateRows } from "./admin-timesheets-rate.service";

// -------------------------------------------------------------------
// Valuing the hours a screen has already fetched.
//
// TAKES THE FACTS, does not re-query them - the same reasoning as the summary
// read path. A screen has just built its report; asking the database for the
// same worklogs again to put a dollar sign on them would double the query
// count on every timesheet page.
//
// The only query here is the rate table, which is one row per person per rate
// change and therefore tiny.
//
// The guard is the ADMIN check: charge rates are commercial and cost rates are
// a pay proxy, so this is more sensitive than the hours it values.
// -------------------------------------------------------------------

export interface RevenueDTO extends RevenueTotals {
  // True when there is at least one rate row at all. False means the feature
  // is simply unconfigured, and the UI should say "no rates set" rather than
  // showing a row of dashes as though something had failed.
  configured: boolean;
  byPerson: RevenueSlice[];
  byJob: RevenueSlice[];
  byCategory: RevenueSlice[];
}

export async function getRevenueForFactsService(facts: WorklogFactRow[]): Promise<RevenueDTO> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const rates = toRateRows(await loadStaffRates());
    const totals = computeRevenue(facts, rates);

    return {
      ...totals,
      configured: rates.length > 0,
      byPerson: computeRevenueBy(facts, rates, (fact) => ({
        key: fact.personId,
        label: fact.personName ?? fact.personId,
      })),
      // Grouped on the PARENT, which is the job somebody is billed for - not
      // the issue, which is a task inside it. "No job" is kept as its own
      // group rather than dropped: unattributed billable time is a finding,
      // and a valuation that quietly omits it understates the period.
      byJob: computeRevenueBy(facts, rates, (fact) => ({
        key: fact.parentKey ?? "none",
        label: fact.parentSummary ?? fact.parentKey ?? "No job",
      })),
      byCategory: computeRevenueBy(facts, rates, (fact) => ({
        key: fact.category ?? "none",
        label: fact.category ?? "Uncategorised",
      })),
    };
  } catch (error) {
    throw handleError("getRevenueForFactsService", error);
  }
}
