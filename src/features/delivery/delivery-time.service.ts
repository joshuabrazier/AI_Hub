import "server-only";

import { generateId } from "better-auth";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/session-auth-server";
import {
  PROJECT_STATUSES,
  USER_ROLES,
  type ProjectStatus,
  type RateBand,
  type TimeEntry,
  type UserRole,
} from "@/lib/data/kysely-database-types";
import {
  getProjectByIdRepo,
  getProjectForMemberRepo,
  getProjectIdsForUserRepo,
  getProjectMemberRepo,
} from "@/lib/data/repositories/projects.repository";
import { getTaskRepo, getTasksByIdsRepo, type AssignedTaskRow } from "@/lib/data/repositories/tasks.repository";
import {
  addTimeEntryRepo,
  adjustTaskEstimateRepo,
  deleteTimeEntryRepo,
  getTimeEntriesForUserInRangeRepo,
  getTimeEntryByIdRepo,
  transferTaskEstimateRepo,
  updateTimeEntryRepo,
} from "@/lib/data/repositories/time-entries.repository";
import { getUserRateAsAtRepo } from "@/lib/data/repositories/user-rates.repository";
import { getUserByUserIdRepo } from "@/lib/data/repositories/users.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { todayInAppZone } from "@/lib/timezone";
import { userDisplayName } from "@/lib/user-display-name";

import {
  DAYS_IN_WEEK,
  DEFAULT_WEEK_START,
  MAX_CALENDAR_DATE,
  MAX_TIMESHEET_ADDED_ROWS,
  MIN_CALENDAR_DATE,
  canEditProjectTasks,
  formatMinutesAsClock,
  isCalendarDate,
  startOfWeek,
  weekDates,
  type AddTimesheetRowOptions,
  type AdjustTaskEstimateRequestDTO,
  type DeleteTimeEntryRequestDTO,
  type LogTimeRequestDTO,
  type TimeEntryDTO,
  type TimesheetCellDTO,
  type TimesheetRowDTO,
  type TimesheetWeekDTO,
  type TimesheetWeekOptions,
  type UpdateTimeEntryRequestDTO,
} from "./delivery.types";

// -------------------------------------------------------------------
// ===================================================================
// DELIVERY: LOGGING TIME, THE TIMESHEET WEEK, AND ESTIMATE CHANGES
// ===================================================================
//
// The numbers this file writes are the ones a client is invoiced against,
// so every decision below is made in favour of a visible blank over a
// plausible wrong figure.
//
// THE ACCESS MODEL, in four parts.
//
//   `project_members` IS THE BOUNDARY. Nothing here trusts an id in a
//   request: a task id is resolved to its project, and the project is
//   resolved AGAINST THE SESSION through getProjectForMemberRepo, which
//   both authorises the read and says what the caller may do. A non-member
//   is answered exactly as a project that never existed is, so a guessed id
//   cannot confirm another client's work exists. Every caller in this file
//   is a WRITE, so that answer is one unvarying sentence rather than
//   notFound() - see requireProjectAccessForWrite for why the difference
//   matters and where the page half would go.
//
//   `is_lead` IS THE SECOND GATE. An ordinary member logs their own time
//   against tasks that already exist. Only a lead - or an admin, who is
//   never a lead and can always act - moves an estimate.
//
//   TIME IS ALWAYS YOUR OWN, and that is the strongest rule in this file.
//   Nothing a caller sends can name another person: LogTimeSchema and
//   AddTimesheetRowSchema carry no userId, and the owner is read off the
//   session. This started out as "only a lead may log for somebody else",
//   which worked but left an authorization branch guarding the module's
//   most sensitive write - and made a lead's entry indistinguishable from
//   the member's own unless the row also recorded who typed it. Removing
//   the capability removed the branch and the audit question together.
//
//   Editing is deliberately NOT the same rule. A lead may correct an entry
//   on their own project, because correcting somebody's mistake is not
//   authoring their work, and the entry keeps its original owner.
//
//   AN EMPTY SCOPE IS NOTHING. Somebody on no projects has no projects,
//   and the one place this file builds an `in` list from a browser-held
//   value (the added timesheet rows) filters it through that person's own
//   membership before it reaches a query.
//
// NO MONEY REACHES ANY DTO HERE. TimeEntryDTO has nowhere to put a rate
// and the week is built from the rate-free reads, deliberately: effort is
// project information and price is not. The snapshots are WRITTEN here and
// read by the budget report, which is gated on its own.
//
// THE RATE SNAPSHOTS ARE THE POINT OF THIS FILE. An hour is worth what it
// was worth when it was worked, so the charge and cost rates are resolved
// as at the WORK DATE, for the person's band ON THIS PROJECT, and copied
// onto the entry. No later rate change restates it, and nothing derives a
// rate at report time.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// The feature is mounted in all three areas and a single write reaches two
// surfaces in each of them: logging an hour changes a timesheet cell, a
// board card's logged-versus-estimate figure and a budget bar. Which area
// the caller is looking at is not knowable from a service, so all six are
// invalidated.
//
// As LAYOUTS rather than pages, because a project board and a task sit
// under a dynamic segment of these roots and a page-level revalidation
// would leave them serving the figures from before the write.
// -------------------------------------------------------------------
function revalidateDeliveryViews(): void {
  revalidatePath(ROUTES.ADMIN_PROJECTS, "layout");
  revalidatePath(ROUTES.MANAGE_PROJECTS, "layout");
  revalidatePath(ROUTES.PORTAL_PROJECTS, "layout");
  revalidatePath(ROUTES.ADMIN_TIMESHEET, "layout");
  revalidatePath(ROUTES.MANAGE_TIMESHEET, "layout");
  revalidatePath(ROUTES.PORTAL_TIMESHEET, "layout");
}

// -------------------------------------------------------------------
// THE THREE REFUSALS A WRITE CAN GIVE, said in one place each.
//
// ONE SENTENCE COVERING BOTH "IT IS GONE" AND "IT IS NOT YOURS", which is
// what makes them safe to say out loud: the two cases are indistinguishable
// to the caller, so the wording cannot be used to find out which one it is.
// That is exactly as much as notFound() leaks, and it is the reasoning
// delivery-board.service.ts already committed to for the same pair of cases.
//
// SAID IN A CONSTANT so they cannot drift apart. Two spellings of "that
// entry has gone" - one for the read that missed, one for the write that
// matched no row - is how a screen ends up telling somebody two different
// stories about one race between two tabs.
//
// The words are duplicated from the board service rather than imported
// because they are not exported there, and a service importing another
// service is a coupling this module does not have. Moving them to
// delivery.types.ts would be the fix, and it is not this file's call - so if
// one of these sentences changes, change both.
// -------------------------------------------------------------------
const TASK_UNAVAILABLE_MESSAGE = "That task is no longer available.";

const PROJECT_UNAVAILABLE_MESSAGE = "That project is no longer available.";

const ENTRY_UNAVAILABLE_MESSAGE = "That time entry is no longer available.";

// -------------------------------------------------------------------
// Everything the guards below need about the caller, and nothing else.
//
// Narrower than SessionUser on purpose: a helper that takes the whole
// session user invites reading a field off it that was never checked. The
// only two facts that decide anything here are which account is acting and
// what role it holds.
// -------------------------------------------------------------------
type Actor = {
  id: string;
  role: UserRole;
};

// -------------------------------------------------------------------
// What the caller is allowed to do inside one project.
//
// Produced by ONE query in the ordinary case, because
// getProjectForMemberRepo returns the membership row alongside the
// project: the join that authorised the read already had `is_lead` and
// `rate_band` in hand, so asking again would be a second round trip for an
// answer we were just given.
// -------------------------------------------------------------------
type ProjectAccess = {
  projectId: string;
  isBillable: boolean;
  status: ProjectStatus;
  // Whether the caller may act on OTHER people's rows in this project - a
  // lead, or an admin. Not `isLead`: an admin is not a lead and can still
  // act, and deriving that from a role plus a flag in each caller would be
  // one authorization decision made in five places.
  canManage: boolean;
  // The caller's own band on THIS project, and null when they hold no
  // membership row - which only an admin can be, since anybody else was
  // refused. It is what an admin logging their OWN time would need, and
  // its absence is refused rather than papered over; see findRateBandFor.
  ownRateBand: RateBand | null;
};

// -------------------------------------------------------------------
// Resolve a project against the SESSION, or null.
//
// NULL COVERS BOTH "no such project" and "not a member of it", and nothing
// downstream may tell them apart: "forbidden" on a guessed id confirms the
// project exists and turns the route into an enumeration oracle over the
// organisation's client list. HOW the null is answered is the caller's
// decision and nothing else about it changes - which is the point of
// splitting the resolve from the require below.
//
// An ADMIN falls through to the unscoped read, and only then - an admin who
// IS on the project takes the first branch and keeps their band, which is
// what lets them log their own time like anybody else.
// -------------------------------------------------------------------
async function resolveProjectAccess(projectId: string, actor: Actor): Promise<ProjectAccess | null> {
  const isAdmin = actor.role === USER_ROLES.ADMIN;

  const membership = await getProjectForMemberRepo(projectId, actor.id);

  if (membership) {
    return {
      projectId: membership.id,
      isBillable: membership.isBillable,
      status: membership.status,
      // The one lead-or-admin rule, imported rather than restated: a screen
      // that hid the button while the server allowed the write, or offered it
      // while the server refused, is what three copies of this line produced.
      canManage: canEditProjectTasks(actor.role, membership.isLead),
      ownRateBand: membership.rateBand,
    };
  }

  if (!isAdmin) return null;

  const project = await getProjectByIdRepo(projectId);

  if (!project) return null;

  return {
    projectId: project.id,
    isBillable: project.isBillable,
    status: project.status,
    // `false` for the flag because an admin holds no membership row here and
    // therefore is not a lead. Still true, and through the same function, so
    // there is no second expression of the rule to keep in step.
    canManage: canEditProjectTasks(actor.role, false),
    ownRateBand: null,
  };
}

// -------------------------------------------------------------------
// THE SAME QUESTION, TWO ANSWERS, AND THE DIFFERENCE IS NOT COSMETIC.
//
// notFound() is right for a PAGE: the route renders the not-found page,
// which is the whole response, and a guessed project id gets the answer a
// project that never existed gets.
//
// It is WRONG for a mutation, and this is the bug it caused. handleError
// calls unstable_rethrow, so Next's notFound() escapes the catch by design -
// which means a notFound() thrown inside a server action propagates out of
// the action and REPLACES THE PAGE THE CALLER IS SITTING ON with the
// not-found page. Two tabs deleting the same entry, or a card a lead removed
// a moment ago, would destroy somebody's half-filled timesheet instead of
// telling them to reload. So a write answers in a sentence, and the sentence
// is identical for "gone" and "not yours" - see the constants above.
//
// ONLY THE WRITE HALF IS WRITTEN HERE, and that is the honest state of this
// file rather than half a job. delivery-board.service.ts has both variants
// because it renders a board and a task panel from one project id.
// Everything in THIS file that resolves a single project is reached by
// pressing something - logging an hour, correcting one, removing one, adding
// a row, moving an estimate - and the one page read it has, the timesheet
// week, is scoped by the person's whole membership LIST rather than by a
// project id, and deliberately falls back to this week rather than refusing
// a bad `?week=`. A requireProjectAccessForPage beside this would have no
// caller, and dead authorization code is worse than absent authorization
// code: it reads as the path that was taken when nothing goes through it.
// resolveProjectAccess answering null is what makes adding the page half
// three lines on the day a page needs one.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// For a mutation: a sentence rather than a 404, and THE SENTENCE IS THE
// CALLER'S TO CHOOSE.
//
// This used to answer PROJECT_UNAVAILABLE_MESSAGE always, and that was an
// enumeration oracle. Every mutation in this file names a TASK or an ENTRY,
// never a project - the project is read off the row. So answering about the
// project told a caller which of two things had happened:
//
//   a task id that does not exist        -> "That task is no longer available."
//   a task id in somebody else's project -> "That project is no longer available."
//
// Two messages, therefore a way to test whether a guessed id is real. That
// is exactly what notFound() prevented by being indistinguishable, and
// replacing it with a sentence quietly gave the property away.
//
// So the caller passes the message its OWN miss uses, and both answers
// become one answer. A future caller that genuinely names a project id may
// take the default, because then the project is the thing being asked about
// and saying so reveals nothing the caller did not supply.
// -------------------------------------------------------------------
async function requireProjectAccessForWrite(
  projectId: string,
  actor: Actor,
  missMessage: string = PROJECT_UNAVAILABLE_MESSAGE,
): Promise<ProjectAccess> {
  const access = await resolveProjectAccess(projectId, actor);

  if (!access) throw new DisplayErrorMessage(missMessage);

  return access;
}

// -------------------------------------------------------------------
// An archived project takes no new numbers.
//
// Archiving is this module's soft delete - time entries hold tasks ON
// DELETE RESTRICT, so a project is never really removed - and an archived
// one is out of the nav, out of the pickers and out of the screens anybody
// reads. Time landing on it would be work nobody ever sees again.
//
// APPLIED TO THE WRITES THAT CREATE A NUMBER, and deliberately NOT to
// editing or deleting an entry. Blocking a correction on an archived
// project would trap a wrong figure in the billing record forever, which
// is the opposite of what this rule is for.
//
// `on_hold` and `completed` are allowed through: writing up Friday on
// Monday, after somebody marked the project finished over the weekend, is
// the ordinary case rather than the exception.
// -------------------------------------------------------------------
function requireUnarchivedProject(access: ProjectAccess, act: string): void {
  if (access.status !== PROJECT_STATUSES.ARCHIVED) return;

  throw new DisplayErrorMessage(
    `This project has been archived, so ${act} is no longer possible. An administrator can make it active again first.`,
  );
}

// -------------------------------------------------------------------
// WHOSE time this is, decided from the session and the caller's rights.
//
// THE BRANCH COMES BEFORE THE VALUE IS LOOKED AT. An ordinary member's
// supplied id is DISCARDED - not compared, not validated, not reported -
// so there is nothing here to probe with somebody else's id. A lead or an
// admin may name anybody; whether that person can actually be charged to
// this project is a separate question, answered by findRateBandFor.


// -------------------------------------------------------------------
// Which of the owner's three rates applies on THIS project.
//
// The band is a property of the MEMBERSHIP ROW, not of the person: the
// same consultant is discounted for one client and standard for another.
// So no membership row means no band, and no band means there is no honest
// rate to snapshot.
//
// Null rather than a throw, because the two callers want different things
// from the same answer: logging time refuses, while re-dating an existing
// entry keeps the snapshot it already has.
// -------------------------------------------------------------------
async function findRateBandFor(access: ProjectAccess, ownerId: string, actorId: string): Promise<RateBand | null> {
  // Already in hand from the call that authorised the project.
  if (ownerId === actorId) return access.ownRateBand;

  const membership = await getProjectMemberRepo(access.projectId, ownerId);

  return membership?.rateBand ?? null;
}

// -------------------------------------------------------------------
// The same question, where the answer decides whether time can be logged
// at all.
//
// REFUSED RATHER THAN LOGGED UNVALUED, and that is the decision. An entry
// written with no band behind it would be indistinguishable on the budget
// report from an hour worked by somebody whose rate has genuinely not been
// set - and one of those is a rate card to fill in, while the other is a
// person who is not on the project. Refusing here keeps the report's
// blanks meaning exactly one thing.
//
// The two messages differ because the remedies do, and both are said to
// somebody already authorised on this project - so neither confirms
// anything they could not already see.
// -------------------------------------------------------------------
async function requireRateBandFor(access: ProjectAccess, ownerId: string, actorId: string): Promise<RateBand> {
  const band = await findRateBandFor(access, ownerId, actorId);

  if (band) return band;

  if (ownerId === actorId) {
    throw new DisplayErrorMessage(
      "You are not a member of this project, so there is no rate band to charge your time at. Ask an administrator to add you to it first.",
    );
  }

  throw new DisplayErrorMessage(
    "That person is not a member of this project, so time cannot be logged against it for them. Add them to the project first.",
  );
}

// -------------------------------------------------------------------
// A work date cannot be in the future.
//
// DERIVED IN THE APP ZONE, and this is why the schema does not do it: a
// pure validator would have to ask `new Date()`, which is the server's idea
// of the day. The server runs in UTC, so for most of an Australian evening
// its "today" is yesterday - and somebody filling in their timesheet at 9pm
// would be told the day they are sitting in has not happened yet.
//
// Compared as STRINGS, which is exact for 'YYYY-MM-DD' and never constructs
// a Date from either side.
// -------------------------------------------------------------------
function requireWorkDateNotInFuture(workDate: string): string {
  if (workDate > todayInAppZone()) {
    throw new DisplayErrorMessage("That day has not happened yet, so time cannot be logged against it.");
  }

  return workDate;
}

// -------------------------------------------------------------------
// The two figures copied onto the entry.
//
// A NULL RATE IS STORED AS NULL. The resolver answers with the greatest
// `effective_from` on or before the work date and never a later one, so
// work done before somebody's earliest rate has NO rate. Falling forward to
// the next one that exists would bill an hour at a price that did not exist
// when it was worked, moving a client's invoice with nothing on any screen
// to say so. A blank is visible and reads as unvalued.
//
// A NON-BILLABLE PROJECT HAS NO CHARGE AND STILL HAS A COST. There is
// nothing to charge, so the charge snapshot is null - the same null the
// budget report already reads as "no revenue here" rather than as nought.
// The cost is captured anyway, because internal work costs the organisation
// exactly what client work does, and a non-billable project with no cost on
// it cannot be reported on at all. That is also what the column comments in
// migration 016 say the two nulls mean.
//
// ONE LOOKUP PER ENTRY, not the batch resolver. `resolveUserRatesAsAtRepo`
// exists for a screenful of lines at once; a single log is a single
// (user, band, date) and the indexed single read is the cheaper half.
// -------------------------------------------------------------------
async function resolveRateSnapshot(
  ownerId: string,
  band: RateBand,
  workDate: string,
  isBillable: boolean,
): Promise<{ chargeRateCents: number | null; costRateCents: number | null }> {
  const rate = await getUserRateAsAtRepo(ownerId, band, workDate);

  return {
    chargeRateCents: isBillable ? (rate?.chargeRateCents ?? null) : null,
    costRateCents: rate?.costRateCents ?? null,
  };
}

// -------------------------------------------------------------------
// Who to name on a returned entry.
//
// The session already carries the caller's own name, so the ordinary case
// costs nothing; only logging FOR somebody else pays for a lookup. Null
// survives on purpose - this app de-identifies dormant accounts in place,
// so a historical member can hold a valid row with no name on it.
//
// THE RULE ITSELF IS userDisplayName, not `name`, and it is imported rather
// than restated. Reading `users.name` straight off the row was the second of
// four disagreeing copies: it showed a person their formal name against
// their time entries while the members list beside it called them by the
// preferred name they had set, which reads as two different people having
// logged the hour.
// -------------------------------------------------------------------
async function displayNameFor(
  userId: string,
  actor: { id: string; name?: string | null; preferredName?: string | null },
): Promise<string | null> {
  if (userId === actor.id) return userDisplayName(actor);

  // Undefined is accepted by the helper and answers null, so a user id with
  // no row behind it needs no branch of its own here.
  return userDisplayName(await getUserByUserIdRepo(userId));
}

// No rates and no value, and the type has nowhere to put one. See the note
// on TimeEntryDTO: effort is project information, price is not.
function toTimeEntryDTO(entry: TimeEntry, userName: string | null): TimeEntryDTO {
  return {
    id: entry.id,
    taskId: entry.taskId,
    userId: entry.userId,
    userName,
    workDate: entry.workDate,
    minutes: entry.minutes,
    notes: entry.notes,
    createdAt: entry.createdAt,
  };
}

// -------------------------------------------------------------------
// Who may change one entry.
//
// A SENTENCE THAT NAMES THE RULE, rather than the unvarying "no longer
// available" the refusals above give, and the difference is earned by what
// has already happened: requireProjectAccessForWrite has refused anybody who
// is not on the project, and every member of a project can already see every
// entry on its tasks - TaskDetailDTO carries them. So naming the rule
// confirms nothing the caller could not read on the screen they came from,
// while "no longer available" for a row visibly sitting in front of them
// would send somebody looking for a bug instead of asking a lead.
// -------------------------------------------------------------------
function requireEntryControl(entry: TimeEntry, access: ProjectAccess, actor: Actor): void {
  if (entry.userId === actor.id || access.canManage) return;

  throw new DisplayErrorMessage(
    "You can only change your own time. A project lead or an administrator can change somebody else's.",
  );
}

// -------------------------------------------------------------------
// ===================================================================
// LOGGING TIME
// ===================================================================
//
// Any member of a project logs their own time against any task on it -
// including tasks nobody assigned them, which is the normal case: people
// help with work that is not their card.
//
// `requestDTO.hours` HOLDS MINUTES by the time it gets here. The field is
// named for what the FORM holds and the schema converted it once at the
// boundary, which is the whole reason delivery.types.ts distinguishes an
// Input DTO from a Request DTO. Reading it as hours would store an hour and
// a half as ninety hours.
// -------------------------------------------------------------------
export async function logTimeService(requestDTO: LogTimeRequestDTO): Promise<TimeEntryDTO> {
  try {
    const actor = await requireUser();

    // The task is the only thing the request names that decides anything,
    // and all it decides is WHICH PROJECT to authorise against.
    const task = await getTaskRepo(requestDTO.taskId);

    // A sentence, not notFound(): a card a lead deleted while somebody had
    // the log dialog open must not take their timesheet screen with it.
    if (!task) throw new DisplayErrorMessage(TASK_UNAVAILABLE_MESSAGE);

    // The caller named a TASK, so a miss here answers about the task - see
    // the note on the helper. Answering about the project would say the
    // task exists.
    const access = await requireProjectAccessForWrite(task.projectId, actor, TASK_UNAVAILABLE_MESSAGE);

    requireUnarchivedProject(access, "logging time against it");

    // THE SESSION, and nothing else. LogTimeSchema carries no userId, so
    // there is no supplied value to weigh a role against - see the note on
    // that schema for why the capability went rather than being left
    // unused.
    const ownerId = actor.id;

    const workDate = requireWorkDateNotInFuture(requestDTO.workDate);

    const band = await requireRateBandFor(access, ownerId, actor.id);
    const snapshot = await resolveRateSnapshot(ownerId, band, workDate, access.isBillable);

    const entry = await addTimeEntryRepo({
      id: generateId(),
      taskId: task.id,
      // From the TASK, never from the request. The composite foreign key on
      // (task_id, project_id) would refuse a mismatch, but as a constraint
      // error rather than as an answer.
      projectId: task.projectId,
      userId: ownerId,
      workDate,
      // Minutes, despite the name - see the note above.
      minutes: requestDTO.hours,
      notes: requestDTO.notes,
      ...snapshot,
      // created_at and updated_at are left to the column defaults, so the
      // row is timestamped by the database about to hold it rather than by
      // a second clock.
    });

    revalidateDeliveryViews();

    return toTimeEntryDTO(entry, await displayNameFor(ownerId, actor));
  } catch (error) {
    throw handleError("logTimeService", error);
  }
}

// -------------------------------------------------------------------
// Edit one entry: the day, the length, the note.
//
// NOT THE TASK, and not the person. Either would change which project the
// hour belongs to, and therefore which rate band and which snapshot - so
// moving an entry is deleting it and logging another, which is what the
// screen should make somebody do. The repository strips `userId` and
// `projectId` out of a patch for the same reason.
//
// THE SNAPSHOTS ARE RE-RESOLVED ONLY WHEN THE DAY MOVES. Fixing a typo in a
// note must not touch the money, and re-resolving on every edit would
// silently restate an hour at today's rate every time somebody corrected
// their spelling.
// -------------------------------------------------------------------
export async function updateTimeEntryService(requestDTO: UpdateTimeEntryRequestDTO): Promise<TimeEntryDTO> {
  try {
    const actor = await requireUser();

    // Unscoped by necessity - the caller holds an entry id, and the project
    // on the row is what decides whether they may touch it.
    const entry = await getTimeEntryByIdRepo(requestDTO.timeEntryId);

    // Somebody else removed it, or it never existed. One sentence for both,
    // and the SAME sentence the failed write below gives, because from where
    // the caller is sitting they are one event: the row they were looking at
    // has gone.
    if (!entry) throw new DisplayErrorMessage(ENTRY_UNAVAILABLE_MESSAGE);

    // The caller named an ENTRY, so a miss answers about the entry.
    const access = await requireProjectAccessForWrite(entry.projectId, actor, ENTRY_UNAVAILABLE_MESSAGE);

    requireEntryControl(entry, access, actor);

    // ABSENT MEANS THE DAY HAS NOT MOVED, so it resolves to the stored date
    // rather than being validated. Only a date somebody actually supplied is
    // a claim about when the work happened - and resolving it this way keeps
    // the comparison below correct, which is what leaves the rate snapshot
    // alone. Re-pricing an hour nobody moved would rewrite what it was worth
    // when it was worked.
    const workDate =
      requestDTO.workDate === undefined ? entry.workDate : requireWorkDateNotInFuture(requestDTO.workDate);

    // Left out of the patch entirely when the day has not moved, so the
    // stored snapshot is untouched rather than rewritten with the value it
    // already had.
    let snapshot: { chargeRateCents?: number | null; costRateCents?: number | null } = {};

    if (workDate !== entry.workDate) {
      // THE ENTRY'S OWNER, not the person editing it. A lead correcting
      // somebody's Tuesday must not re-price their hour at the lead's band.
      const band = await findRateBandFor(access, entry.userId, actor.id);

      // Resolved as at the NEW work date, which is the whole reason this
      // branch exists: an hour moved from June to July is a July hour.
      if (band) snapshot = await resolveRateSnapshot(entry.userId, band, workDate, access.isBillable);

      // NO BAND MEANS THE SNAPSHOT IS LEFT ALONE. The owner has since been
      // taken off the project, so there is no band to resolve and no honest
      // new figure to write. Blanking what is there would rewrite history
      // that was correct when it was captured, over an edit only ever meant
      // to move a day - so the captured cents stay, and the entry keeps
      // saying what the hour was worth when it was worked.
    }

    const updated = await updateTimeEntryRepo(entry.id, access.projectId, {
      workDate,
      minutes: requestDTO.hours,
      notes: requestDTO.notes,
      ...snapshot,
    });

    // The project predicate matched nothing, which after the reads above can
    // only mean the row went while this request was in flight.
    if (!updated) throw new DisplayErrorMessage(ENTRY_UNAVAILABLE_MESSAGE);

    revalidateDeliveryViews();

    return toTimeEntryDTO(updated, await displayNameFor(updated.userId, actor));
  } catch (error) {
    throw handleError("updateTimeEntryService", error);
  }
}

// -------------------------------------------------------------------
// Delete one entry.
//
// The same two gates as the edit, and deliberately allowed on an archived
// project: a wrong number must always be removable.
//
// THE READ MISS AND THE WRITE MISS ARE ONE ANSWER, which they were not
// before: the read answered notFound() and the write answered a sentence,
// for the identical race. Two tabs deleting the same entry hit whichever of
// the two the timing picked, so the same act destroyed the screen half the
// time and explained itself the other half.
// -------------------------------------------------------------------
export async function deleteTimeEntryService(requestDTO: DeleteTimeEntryRequestDTO): Promise<void> {
  try {
    const actor = await requireUser();

    const entry = await getTimeEntryByIdRepo(requestDTO.timeEntryId);

    if (!entry) throw new DisplayErrorMessage(ENTRY_UNAVAILABLE_MESSAGE);

    // The caller named an ENTRY, so a miss answers about the entry.
    const access = await requireProjectAccessForWrite(entry.projectId, actor, ENTRY_UNAVAILABLE_MESSAGE);

    requireEntryControl(entry, access, actor);

    // Scoped to the project the caller was authorised against, so a bug in
    // any of the above matches no row rather than reaching an entry
    // belonging to another client.
    const deleted = await deleteTimeEntryRepo(entry.id, access.projectId);

    if (deleted === 0) throw new DisplayErrorMessage(ENTRY_UNAVAILABLE_MESSAGE);

    revalidateDeliveryViews();
  } catch (error) {
    throw handleError("deleteTimeEntryService", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// THE TIMESHEET WEEK
// ===================================================================
//
// Seven columns and one row per task, for ONE person.
//
// ROWS COME FROM THE TIME ENTRIES, NOT FROM ASSIGNMENT. Somebody routinely
// logs an hour against a task that is on a colleague's card - they helped,
// they reviewed it, they sat in the meeting about it - so a grid built from
// `assignee_id` would be missing most of a real week and would silently
// drop the rows a person actually needs. Assignment is a board concept; a
// timesheet is the record of what happened.
//
// NOTHING HERE CONSTRUCTS A Date. The week arithmetic is the pure
// string-to-integer-day helpers in delivery.types.ts, and the range
// predicate compares 'YYYY-MM-DD' strings, which is what keeps Monday's
// hours under Monday for a reader in any zone.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// THE BOUND, THE PARAMETER SHAPES AND THE SCHEMAS ALL LIVE IN
// delivery.types.ts, and what stays here is the page's tolerance.
//
// TimesheetWeekOptions, AddTimesheetRowOptions and MAX_TIMESHEET_ADDED_ROWS
// were declared in this file and are now imported: an action needs
// TimesheetWeekSchema and AddTimesheetRowSchema to validate a control's
// input at the boundary, and a schema whose cap and a service whose cap are
// two separate constants is one edit away from disagreeing about how long an
// `in` list may get.
//
// WHAT THE SCHEMAS DO NOT COVER IS THIS SERVICE'S OWN CALLERS. A page reads
// the week directly, straight off the URL's `?week=`, so nothing has parsed
// its arguments by the time they arrive - which is why the two rules below
// stay:
//
//   isUsableCalendarDate PLUS THE FALLBACK TO THIS WEEK. calendarDateField
//   REFUSES a bad date, which is right for an action - a date the app's own
//   control made up is a bug worth reporting - and wrong for a bookmarked or
//   forwarded link, which should land on a working screen. The schema's own
//   comment says so.
//
//   THE DE-DUPLICATION AND THE CAP ON `addedTaskIds`. The schema does both,
//   and it is not the only way in: these ids come out of a browser-held
//   store, reach a page as furniture, and become an `in` list. Bounding them
//   only in the schema would leave the page path unbounded. It is also not
//   quite the same filter - the service drops ids that already have time on
//   them BEFORE it counts to fifty, which no schema can do because it does
//   not know what the week contains.
// -------------------------------------------------------------------

// A 'YYYY-MM-DD' that exists and sits inside the sane window, matching what
// the Zod schemas accept for a work date.
function isUsableCalendarDate(value: string): boolean {
  return isCalendarDate(value) && value >= MIN_CALENDAR_DATE && value <= MAX_CALENDAR_DATE;
}

export async function getTimesheetWeekService(
  weekStart: string,
  options: TimesheetWeekOptions = {},
): Promise<TimesheetWeekDTO> {
  try {
    const actor = await requireUser();

    const targetUserId = options.userId ?? actor.id;

    // -----------------------------------------------------------------
    // ADMIN ONLY TO OPEN SOMEBODY ELSE'S WEEK, and a lead deliberately
    // cannot - which is narrower than the rest of this file.
    //
    // A week is one person's time across EVERY project they are on, so a
    // lead of one project shown a colleague's week would be reading that
    // colleague's work for three other clients. No repository read answers
    // "this person's week, restricted to these projects", and building that
    // scope in a service by filtering rows after the fact is how a boundary
    // ends up depending on a `filter` call nobody reviews again.
    //
    // A lead asking "how much has Ada put on my project" is answered by the
    // task panel and the budget report, both scoped to one project by
    // construction.
    //
    // Said plainly, because it is a ROLE failure: nothing about the named
    // account is confirmed either way.
    // -----------------------------------------------------------------
    if (targetUserId !== actor.id && actor.role !== USER_ROLES.ADMIN) {
      throw new DisplayErrorMessage("Only an administrator can open somebody else's timesheet.");
    }

    const weekStartsOn = options.weekStartsOn ?? DEFAULT_WEEK_START;

    // -----------------------------------------------------------------
    // A BAD DATE FALLS BACK TO THIS WEEK rather than throwing.
    //
    // The value arrives from a URL somebody may have bookmarked, edited or
    // been sent, and the helpers throw on a malformed date by design. A
    // stale or tampered `?week=` should land on a working screen - the same
    // reasoning the transcription page applies to an unknown id - and there
    // is nothing to leak either way, because the week rendered is stated in
    // the DTO.
    //
    // NORMALISED THROUGH startOfWeek even when it parses, so a mid-week
    // date returns the week containing it instead of seven columns
    // beginning on a Wednesday.
    // -----------------------------------------------------------------
    const anchor = isUsableCalendarDate(weekStart) ? weekStart : todayInAppZone();
    const start = startOfWeek(anchor, weekStartsOn);
    const dates = weekDates(start, weekStartsOn);
    const end = dates[DAYS_IN_WEEK - 1];

    // Inclusive of both ends, compared as strings, on
    // idx_time_entries_person_week.
    const entries = await getTimeEntriesForUserInRangeRepo(targetUserId, start, end);

    const loggedTaskIds = [...new Set(entries.map((entry) => entry.taskId))];
    const loggedTaskIdSet = new Set(loggedTaskIds);

    // De-duplicated and bounded before it becomes part of a query, on the
    // schema's own constant so the two cannot disagree.
    const requestedRowIds = [...new Set(options.addedTaskIds ?? [])]
      .filter((taskId) => !loggedTaskIdSet.has(taskId))
      .slice(0, MAX_TIMESHEET_ADDED_ROWS);

    const candidateIds = [...loggedTaskIds, ...requestedRowIds];

    // One query for every row's title, phase, project and client. The read
    // is unscoped by design and every row carries its project id back, so
    // the authorising happens below.
    const tasks = candidateIds.length > 0 ? await getTasksByIdsRepo(candidateIds) : [];

    // -----------------------------------------------------------------
    // TWO DIFFERENT AUTHORISATION ANSWERS, and the difference is real.
    //
    // A task somebody has LOGGED TIME AGAINST is shown whatever their
    // membership says now. The ids came out of their own time entries, and
    // a project they have since been taken off is their own history rather
    // than somebody else's data - which is exactly the reasoning
    // getTasksByIdsRepo documents for not joining membership.
    //
    // A task with NO TIME on it is a row somebody asked for, so it has to be
    // in a project they can currently log to: a member of it, and not
    // archived. Otherwise the grid offers a row where every cell will be
    // refused. Dropped silently, because an empty row is furniture rather
    // than data - the loud refusal lives in addTimesheetRowService, where
    // the person is actually asking for it.
    // -----------------------------------------------------------------
    const requestedRows = tasks.filter((task) => !loggedTaskIdSet.has(task.id));

    const admittedRowIds = new Set<string>(loggedTaskIdSet);

    if (requestedRows.length > 0) {
      // An empty membership list is nothing, not everything: somebody on no
      // projects admits no added rows.
      const scope = new Set(await getProjectIdsForUserRepo(targetUserId));

      for (const task of requestedRows) {
        if (scope.has(task.projectId) && task.projectStatus !== PROJECT_STATUSES.ARCHIVED) {
          admittedRowIds.add(task.id);
        }
      }
    }

    // Keyed on task and day, so a cell is one lookup rather than a scan of
    // the week per row.
    const cells = new Map<string, { minutes: number; entries: { id: string; minutes: number; notes: string | null }[] }>();

    for (const entry of entries) {
      const key = `${entry.taskId}|${entry.workDate}`;
      const cell = cells.get(key);

      // ENTRIES ARE A LIST, because there is no unique index on
      // (task, user, day) and there should not be: an hour before lunch and
      // another after it, with different notes, are two real entries. The
      // cell shows the total, and a caller can only edit in place when the
      // list holds exactly one.
      if (cell) {
        cell.minutes += entry.minutes;
        cell.entries.push({ id: entry.id, minutes: entry.minutes, notes: entry.notes });
      } else {
        cells.set(key, { minutes: entry.minutes, entries: [{ id: entry.id, minutes: entry.minutes, notes: entry.notes }] });
      }
    }

    // Ordered by client, project, phase and board position, straight out of
    // the repository - the same ordering "my work" uses, so a timesheet and
    // a task list can never disagree about what comes first.
    const rows: TimesheetRowDTO[] = tasks
      .filter((task: AssignedTaskRow) => admittedRowIds.has(task.id))
      .map((task: AssignedTaskRow) => {
        const days: TimesheetCellDTO[] = dates.map((date) => {
          const cell = cells.get(`${task.id}|${date}`);

          return {
            date,
            minutes: cell?.minutes ?? 0,
            entries: cell?.entries ?? [],
          };
        });

        return {
          taskId: task.id,
          taskTitle: task.title,
          phaseName: task.phaseName,
          projectId: task.projectId,
          projectTitle: task.projectTitle,
          clientName: task.clientName,
          days,
          totalMinutes: days.reduce((total, day) => total + day.minutes, 0),
        };
      });

    // SUMMED FROM THE ROWS BEING RENDERED, not from `entries` a second time.
    // Adding the entries up separately is a second answer to the same
    // question, and the one place the two could differ - a task row that
    // failed to resolve - is precisely where a footer including its minutes
    // would show a total the visible rows do not reach. The foreign key
    // makes that unreachable; the arithmetic is arranged so the grid stays
    // self-consistent if it ever were not.
    const dayTotalMinutes = dates.map((_date, index) =>
      rows.reduce((total, row) => total + row.days[index].minutes, 0),
    );

    return {
      userId: targetUserId,
      userName: await displayNameFor(targetUserId, actor),
      weekStartsOn,
      weekStart: start,
      weekEnd: end,
      dates,
      rows,
      dayTotalMinutes,
      totalMinutes: dayTotalMinutes.reduce((total, minutes) => total + minutes, 0),
    };
  } catch (error) {
    throw handleError("getTimesheetWeekService", error);
  }
}

// -------------------------------------------------------------------
// Add a row to the week: project, then phase, then task, then add.
//
// IT WRITES NOTHING, AND THAT IS A DESIGN RATHER THAN AN OMISSION.
//
// An empty row is a piece of somebody's screen, not a fact about the
// business, and there are only three places it could live:
//
//   1. A TABLE OF ITS OWN (`timesheet_week_rows`, keyed on user and week).
//      The schema has none, and inventing one is not this file's decision -
//      so it is REPORTED as missing rather than assumed. It is also the
//      only option that survives moving to another device.
//
//   2. A ZERO-MINUTE TIME ENTRY. Refused by the database, correctly:
//      `time_entries_minutes_sane` is CHECK (minutes > 0 AND <= 1440). It
//      would be wrong even if it were allowed - the row would carry a rate
//      snapshot and appear on the budget report as work, so a placeholder
//      somebody added and never filled in would become a line on a client's
//      report.
//
//   3. THE BROWSER, which is what happens today: the caller holds the
//      admitted task ids (in the URL, or in session storage) and hands them
//      back to getTimesheetWeekService as `addedTaskIds`, where every one is
//      re-authorised against the target's own membership. It survives a
//      page load and a refresh, and it does not survive a new device -
//      which, for an empty row nobody has typed into, is a fair price for
//      keeping screen furniture out of the billing database.
//
// So what this service is FOR is the authorization: it proves the task
// exists, that the caller may see its project, and that the person whose
// week it is can actually log time to it - then hands back the row shape
// the grid renders. A purely client-side "add" would let a row appear for a
// project the person is not on, and the refusal would arrive only when they
// typed an hour into it.
// -------------------------------------------------------------------
// IT REFUSES LIKE A WRITE, because somebody pressed something. It stores
// nothing, but it is reached from an "add" control rather than from a page
// render - AddTimesheetRowSchema exists for exactly that action - so a
// notFound() from here would land inside a server action and replace the
// half-filled week the caller is looking at with the not-found page.
export async function addTimesheetRowService(
  taskId: string,
  weekStart: string,
  options: AddTimesheetRowOptions = {},
): Promise<TimesheetRowDTO> {
  try {
    const actor = await requireUser();

    const task = await getTaskRepo(taskId);

    if (!task) throw new DisplayErrorMessage(TASK_UNAVAILABLE_MESSAGE);

    // The caller named a TASK, so a miss here answers about the task - see
    // the note on the helper. Answering about the project would say the
    // task exists.
    const access = await requireProjectAccessForWrite(task.projectId, actor, TASK_UNAVAILABLE_MESSAGE);

    requireUnarchivedProject(access, "adding one of its tasks to a timesheet");

    // The session, like logging time. A row belongs to the week of whoever
    // is looking at it.
    const ownerId = actor.id;

    // The band is DISCARDED - nothing is being priced yet. It is called for
    // its refusal: a row for somebody who is not on the project is a row
    // whose every cell would be rejected, and finding that out now rather
    // than after they type an hour is worth one query.
    await requireRateBandFor(access, ownerId, actor.id);

    // The title, phase, project and client the row renders. A second read,
    // because getTaskRepo answered the authorization question and this one
    // answers the display question - and it is the same shape the week
    // builds its rows from, so an added row cannot look different from a row
    // with time on it.
    const [row] = await getTasksByIdsRepo([task.id]);

    // Unreachable through the foreign keys - a task always has a phase, a
    // project and a client - so this is the honest answer to a row that
    // vanished mid-request rather than a fallback. Said in the same sentence
    // as a task that had already gone, which is what it is.
    if (!row) throw new DisplayErrorMessage(TASK_UNAVAILABLE_MESSAGE);

    const weekStartsOn = options.weekStartsOn ?? DEFAULT_WEEK_START;
    const anchor = isUsableCalendarDate(weekStart) ? weekStart : todayInAppZone();

    return {
      taskId: row.id,
      taskTitle: row.title,
      phaseName: row.phaseName,
      projectId: row.projectId,
      projectTitle: row.projectTitle,
      clientName: row.clientName,
      // Seven empty cells in the week's own order, so the row renders beside
      // rows that came from the week read without the caller building cells
      // of its own.
      days: weekDates(anchor, weekStartsOn).map((date) => ({ date, minutes: 0, entries: [] })),
      totalMinutes: 0,
    };
  } catch (error) {
    throw handleError("addTimesheetRowService", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// ADJUSTING AN ESTIMATE
// ===================================================================
//
// LEAD OR ADMIN ONLY, in two forms that are two different acts:
//
//   `project`  - the project's total goes up (or down). One row in
//                estimate_changes with no source.
//   `transfer` - the minutes come out of another task in the same project.
//                Both estimates move and ONE row records where from.
//
// EACH IS ONE REPOSITORY CALL, and the transfer's is a transaction that
// locks both tasks. Done as three writes from here, a failure between them
// would leave minutes taken off one task and appearing nowhere, or a budget
// rearranged with no record of who rearranged it - and the record is the
// entire reason the table exists.
//
// `requestDTO.hours` is MINUTES here too, and SIGNED on the `project`
// branch.
// -------------------------------------------------------------------
export async function adjustTaskEstimateService(requestDTO: AdjustTaskEstimateRequestDTO): Promise<void> {
  try {
    const actor = await requireUser();

    const task = await getTaskRepo(requestDTO.taskId);

    if (!task) throw new DisplayErrorMessage(TASK_UNAVAILABLE_MESSAGE);

    // The caller named a TASK, so a miss here answers about the task - see
    // the note on the helper. Answering about the project would say the
    // task exists.
    const access = await requireProjectAccessForWrite(task.projectId, actor, TASK_UNAVAILABLE_MESSAGE);

    requireUnarchivedProject(access, "changing an estimate on it");

    // A ROLE-SHAPED FAILURE, SAID PLAINLY. The caller is a member of this
    // project and can already see the task and its estimate history, so
    // naming the rule confirms nothing - and notFound() on a card they are
    // looking at would read as a bug rather than as a permission.
    if (!access.canManage) {
      throw new DisplayErrorMessage("Only a project lead or an administrator can change an estimate.");
    }

    if (requestDTO.source === "project") {
      const adjusted = await adjustTaskEstimateRepo({
        changeId: generateId(),
        taskId: task.id,
        // The project the caller was authorised against, so the write cannot
        // reach a task in another one even if the read above were ever wrong.
        projectId: access.projectId,
        minutes: requestDTO.hours,
        reason: requestDTO.reason,
        changedBy: actor.id,
      });

      if (!adjusted) {
        // Refused for one of two reasons, and only one of them is reachable
        // per sign of the adjustment. A REDUCTION larger than the estimate
        // is the real case: the repository refuses it rather than letting
        // tasks_estimate_non_negative fire, because a negative estimate is a
        // number that would then be reported on.
        if (requestDTO.hours < 0) {
          throw new DisplayErrorMessage(
            `This task is only estimated at ${formatMinutesAsClock(task.estimateMinutes)}, so ${formatMinutesAsClock(-requestDTO.hours)} cannot be taken off it.`,
          );
        }

        throw new DisplayErrorMessage(TASK_UNAVAILABLE_MESSAGE);
      }

      revalidateDeliveryViews();

      return;
    }

    const source = await getTaskRepo(requestDTO.fromTaskId);

    // -----------------------------------------------------------------
    // THE SOURCE MUST BE IN THE SAME PROJECT, checked here rather than left
    // to the composite key - which would refuse it, but as a raw constraint
    // error on somebody's screen.
    //
    // ONE SENTENCE FOR BOTH FAILURES, deliberately: a task that does not
    // exist and a task belonging to another client get the same answer, so
    // this box cannot be used to find out what work exists on a project the
    // caller is not on. Minutes cannot move between clients' budgets in any
    // case.
    // -----------------------------------------------------------------
    if (!source || source.projectId !== access.projectId) {
      throw new DisplayErrorMessage("The hours have to come from another task on this project.");
    }

    // -----------------------------------------------------------------
    // A TRANSFER CANNOT TAKE MORE THAN THE SOURCE HAS. It is REFUSED, not
    // clamped to what is available: asking to move eight hours when five
    // exist is a misunderstanding about the plan, and quietly moving five
    // would leave two estimates matching neither the plan nor the request,
    // with a log entry saying it went as asked.
    //
    // Checked here so the message can name what IS available, and checked
    // again inside the transaction because between these two statements
    // somebody else may have spent them.
    // -----------------------------------------------------------------
    if (source.estimateMinutes < requestDTO.hours) {
      throw new DisplayErrorMessage(
        `"${source.title}" is only estimated at ${formatMinutesAsClock(source.estimateMinutes)}, so ${formatMinutesAsClock(requestDTO.hours)} cannot be moved from it.`,
      );
    }

    const transferred = await transferTaskEstimateRepo({
      changeId: generateId(),
      toTaskId: task.id,
      fromTaskId: source.id,
      projectId: access.projectId,
      minutes: requestDTO.hours,
      reason: requestDTO.reason,
      changedBy: actor.id,
    });

    // Nothing was written - the transaction refused and unwound. After the
    // checks above this is the race: the source's minutes went while this
    // request was in flight.
    if (!transferred) {
      throw new DisplayErrorMessage(
        `Those hours are no longer available on "${source.title}". Reload the page and check the estimates before trying again.`,
      );
    }

    revalidateDeliveryViews();
  } catch (error) {
    throw handleError("adjustTaskEstimateService", error);
  }
}
