import "server-only";

import { cache } from "react";

import { getJiraIssuesRepo, getStaffTargetsRepo } from "@/lib/data/repositories/timesheet.repository";
import { listStaffRatesRepo } from "@/lib/data/repositories/staff-rate.repository";

// -------------------------------------------------------------------
// Request-scoped reads of the small reference tables.
//
// Rendering one timesheet screen runs several services that do not know about
// each other, and three of them each wanted the whole rate table, the whole
// target table or the whole issue table. Independently they were right to ask;
// together they asked the same question twice and paid a round trip to a
// database in another city for the repeat.
//
// React's cache() memoises per REQUEST, not globally. Two callers inside one
// render share an answer; the next request starts empty. That is what makes
// this safe to do to live data - nothing here is a cache in the sense of
// outliving the thing it describes, and none of it needs invalidating.
//
// READ PATHS ONLY. These deliberately wrap nothing that writes. The sync job
// reads issues and then upserts them in the same request, and a memo there
// would let it read back its own stale answer - it stays on the repository
// directly, which is why these are here rather than in the repository layer.
// -------------------------------------------------------------------

export const loadStaffRates = cache(async function loadStaffRates() {
  return listStaffRatesRepo();
});

export const loadStaffTargets = cache(async function loadStaffTargets() {
  return getStaffTargetsRepo();
});

export const loadJiraIssues = cache(async function loadJiraIssues() {
  return getJiraIssuesRepo();
});
