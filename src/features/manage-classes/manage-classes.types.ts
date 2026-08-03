import type { ClassScheduleDay } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Manager-facing class DTOs
//
// Deliberately read-only, for the same reason the manager's team DTOs are: a
// class is created, dated and staffed in the admin area. This view answers
// "what is running for my teams". The `id` is the list's React key and nothing
// else - there is no action on this screen for it to be sent to.
// -------------------------------------------------------------------
export type ManagedClassDTO = {
  id: string;
  name: string;
  description: string;
  programName: string;
  locationName: string;
  // The owning team. Only ever null for an ADMIN looking at this area: a class
  // with no team is admin-only, and the team-scoped query cannot return one.
  teamName: string | null;
  leadUserName: string | null;
  // The weekly pattern - one entry per day the class runs, with that day's
  // times. Times are 'HH:MM' wall clock, not instants.
  schedule: ClassScheduleDay[];
  capacity: number;
  memberCount: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  isActive: boolean;
  // Running TODAY: still flagged active AND today falls inside its dates.
  // Distinct from isActive - a class that has not started yet is active but is
  // not running.
  isRunning: boolean;
};

// -------------------------------------------------------------------
// The classes page's data. `isUnrestricted` is true only for an admin looking
// at the manager area, and is used for copy - never to widen a query.
// -------------------------------------------------------------------
export type ManagedClassesDTO = {
  classes: ManagedClassDTO[];
  isUnrestricted: boolean;
};
