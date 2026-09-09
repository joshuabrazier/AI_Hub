import "server-only";

import { generateId } from "better-auth";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/audit/audit-log.types";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { SessionUser } from "@/lib/auth/auth.types";
import {
  RATE_BANDS,
  RATE_BAND_LABELS,
  RATE_BAND_ORDER,
  USER_ROLES,
  type RateBand,
  type User,
  type UserRate,
} from "@/lib/data/kysely-database-types";
import {
  getProjectBudgetGroupsRepo,
  getProjectByIdRepo,
} from "@/lib/data/repositories/projects.repository";
import { getProjectEstimateMinutesRepo } from "@/lib/data/repositories/tasks.repository";
import {
  getChargeAndCostCentsByBudgetGroupRepo,
  getChargeAndCostCentsByProjectRepo,
  getLoggedMinutesByBudgetGroupRepo,
  getLoggedMinutesByProjectRepo,
  type ChargeAndCostCents,
} from "@/lib/data/repositories/time-entries.repository";
import {
  deleteUserRateRepo,
  getUserRateByIdRepo,
  listCurrentUserRatesRepo,
  listUserRatesForUserRepo,
  upsertUserRateRepo,
  upsertUserRatesRepo,
} from "@/lib/data/repositories/user-rates.repository";
import {
  getMemberUsersRepo,
  getStaffUsersRepo,
  getUserByUserIdRepo,
} from "@/lib/data/repositories/users.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { todayInAppZone } from "@/lib/timezone";
import { userDisplayName } from "@/lib/user-display-name";

import {
  addCalendarDays,
  budgetProgress,
  marginCents,
  type BudgetGroupReportDTO,
  type BudgetReportDTO,
  type DeleteUserRateRequestDTO,
  type SetUserRateRequestDTO,
  type SetUserRatesRequestDTO,
  type UserRateBandsDTO,
  type UserRateDTO,
  type UserRateDeletionImpactDTO,
  type UserRateHistoryDTO,
  type UserRatesOverviewDTO,
} from "./delivery.types";

// -------------------------------------------------------------------
// Rates, and the budget report they eventually explain.
//
// ADMIN ONLY, EVERY FUNCTION, and unlike the rest of this module that is
// the whole access model rather than the first half of it. Elsewhere in
// delivery, `project_members` is the boundary and `is_lead` is a second
// gate; here neither applies, because a rate is not a fact about a project.
// A charge rate is what a client is billed and a cost rate is a pay proxy,
// so being on the project the money came from confers nothing.
//
// THE BUDGET REPORT IS IN THIS FILE FOR THE SAME REASON. It is the one DTO
// in the module carrying cents, so it is gated the way the rates it
// ultimately derives from are gated, and both halves of that decision sit
// in one file where they can be read together.
//
// THREE RULES GOVERN EVERYTHING BELOW.
//
//   1. NO ARITHMETIC HERE THAT SQL ALREADY DID. Every figure on the report
//      comes from a rollup in `time-entries.repository.ts` or
//      `tasks.repository.ts`, already rounded per entry and summed in
//      Postgres. The only computation this file performs is the subtraction
//      in `marginCents` and the shape in `budgetProgress`, both of which
//      are the pure helpers in delivery.types.ts. Adding entries up here
//      would drag a year of a project across the wire to produce a number
//      Postgres would hand over for free - and would give two surfaces two
//      chances to round it differently.
//
//   2. UNVALUED IS NOT ZERO, AND NULL IS PASSED THROUGH UNTOUCHED. A
//      rollup answers null when a contributing entry has no rate snapshot
//      on that side. Zero would say the work was free; null says nobody has
//      said what it is worth. A dashboard reporting 0 margin on an
//      uncosted project is the exact failure this module is written around:
//      a wrong number that looks right.
//
//   3. RATES ARE SNAPSHOTTED, SO NOTHING HERE MOVES HISTORY. Setting or
//      deleting a rate row cannot change a figure on any report, because
//      every figure on a report comes from the cents copied onto the time
//      entry when the hour was logged. What a rate change moves is what
//      FUTURE entries resolve to, which is why the delete path goes to the
//      trouble it does below.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// The guard, named once.
//
// A wrapper rather than the call repeated nine times, so "admin only, no
// exceptions" is a statement in one place instead of a pattern somebody has
// to notice. A ROLE failure may say "forbidden" plainly - requireUserRole
// redirects there - because the caller learns nothing they did not already
// know. The notFound() answers below are for a missing SUBJECT, which is a
// different question.
//
// It returns the session user, which nothing here reads today: the audit
// entries below name the actor, and `recordAuditEvent` resolves that from
// the session itself rather than from anything passed to it. The return
// type stays because it is the shape every other guard in this app hands
// back, and because the point it makes is worth leaving in the signature -
// the actor comes from the SESSION. Nothing in a request DTO is proof of
// anything: `userId` on a rate request is WHOSE RATE, never who is setting
// it.
// -------------------------------------------------------------------
async function requireRatesAdmin(): Promise<SessionUser> {
  return requireUserRole([USER_ROLES.ADMIN]);
}

// -------------------------------------------------------------------
// Rates live on ONE screen in ONE area, because they are admin-only - so
// unlike chat, transcription or projects there is no /manage or /portal
// path to keep in step.
//
// "layout" rather than the default "page", matching `revalidateProjectViews`,
// `revalidateBoardViews` and `revalidateDeliveryViews`. A plain string clears
// that one entry and leaves anything under a nested dynamic segment serving
// the copy it rendered before the write - and `getUserRateHistoryService`
// takes a userId, so one person's history can only live at
// /admin/rates/[userId]. Setting or deleting a rate from somebody's history
// page is exactly that case, on the one screen in this module where a stale
// figure is a mispriced client.
//
// THE BUDGET REPORT IS DELIBERATELY NOT REVALIDATED HERE. Every figure on
// it comes from the rate snapshots on the time entries, so a rate row
// changing cannot move a number on it. Refreshing it anyway would quietly
// assert the opposite - that a report might have been restated - and the
// one thing this module needs everybody to believe about a rate change is
// that it did not.
// -------------------------------------------------------------------
function revalidateRatesViews(): void {
  revalidatePath(ROUTES.ADMIN_RATES, "layout");
}

// -------------------------------------------------------------------
// THE DISPLAY-NAME RULE IS `userDisplayName`, shared with the team screens
// rather than restated here. This file used to carry its own copy of it, and
// a second copy of that rule is how one panel came to call the same person by
// her preferred name in a list and her formal one beside her time entries.
//
// It answers `string | null`, which is why the name fields on these DTOs are
// nullable even though `users.name` is NOT NULL: de-identification rewrites
// the column in place, and a scrubbed value is not a name. Nothing here
// manufactures one.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// A rate row as the screen sees it.
//
// FIELD BY FIELD rather than a spread, so `createdAt` does not ride along
// into a DTO nothing renders - the convention at the top of the response
// DTO block in delivery.types.ts. `updatedAt` is carried because an
// effective-dated table is read as a history, and "corrected this morning"
// is the fact that explains a row whose start date is months old.
// -------------------------------------------------------------------
function toUserRateDTO(rate: UserRate): UserRateDTO {
  return {
    id: rate.id,
    userId: rate.userId,
    band: rate.band,
    effectiveFrom: rate.effectiveFrom,
    chargeRateCents: rate.chargeRateCents,
    costRateCents: rate.costRateCents,
    updatedAt: rate.updatedAt,
  };
}

// -------------------------------------------------------------------
// ===================================================================
// THE RATES SCREEN
// ===================================================================
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Everybody, with the rate in force in each band today.
//
// "TODAY" IS DERIVED IN THE APP ZONE, and the repository takes the date as
// a parameter precisely so it does not have to guess. Deriving it from the
// server's clock would put the boundary in the wrong place for most of an
// Australian evening, and the visible symptom is mild enough to survive
// review: a rate starting tomorrow shows as current.
//
// TWO USER READS AND A MERGE. There is no all-users accessor, and rates are
// not a staff-only concept - a member logs time on a project and their hour
// has to be worth something, so a screen listing only admins and managers
// would leave most of a delivery team unpriced. admin | manager | member
// partition the roles, so the two lists together are everybody and neither
// can contain the same row twice. It is a merge, not a rollup: nothing here
// adds anything up.
//
// PEOPLE WITH NO RATE ARE LISTED, which is why users are read at all rather
// than the rate rows being grouped on their own. A band nobody has priced
// is the thing an admin opens this screen to find.
// -------------------------------------------------------------------
export async function getUserRatesOverviewService(): Promise<UserRatesOverviewDTO> {
  try {
    await requireRatesAdmin();

    const asAtDate = todayInAppZone();

    const [staff, members, currentRates] = await Promise.all([
      getStaffUsersRepo(),
      getMemberUsersRepo(),
      listCurrentUserRatesRepo(asAtDate),
    ]);

    // `listCurrentUserRatesRepo` is DISTINCT ON (user, band), so there is at
    // most one row per pair and the last write into this map cannot be an
    // arbitrary one of several.
    const ratesByUser = new Map<string, Partial<Record<RateBand, UserRate>>>();

    for (const rate of currentRates) {
      const bucket = ratesByUser.get(rate.userId) ?? {};
      bucket[rate.band] = rate;
      ratesByUser.set(rate.userId, bucket);
    }

    // Active first and then by name, which is the order both user reads
    // already use - restated over the merged list because concatenating two
    // sorted lists does not give a sorted list.
    const people = [...staff, ...members].sort(
      (left, right) =>
        Number(right.isActive) - Number(left.isActive) || left.name.localeCompare(right.name),
    );

    return {
      asAtDate,
      people: people.map((person) => toRateBandsDTO(person, ratesByUser.get(person.id))),
    };
  } catch (error) {
    throw handleError("getUserRatesOverviewService", error);
  }
}

// Every band, always, null where there is no rate. Built by walking
// RATE_BANDS rather than the rows, so a band nobody has priced is a visible
// blank instead of a missing key.
function toRateBandsDTO(
  person: User,
  rates: Partial<Record<RateBand, UserRate>> | undefined,
): UserRateBandsDTO {
  const bands = Object.values(RATE_BANDS).reduce(
    (accumulator, band) => {
      const rate = rates?.[band];
      accumulator[band] = rate ? toUserRateDTO(rate) : null;

      return accumulator;
    },
    {} as Record<RateBand, UserRateDTO | null>,
  );

  return {
    userId: person.id,
    name: userDisplayName(person),
    email: person.email,
    isActive: person.isActive,
    bands,
  };
}

// -------------------------------------------------------------------
// One person's whole history, newest start date first.
//
// notFound() for an id that resolves to nobody, rather than a message: this
// is a page read keyed on an id in a path, and the module answers a miss
// the same way it answers something out of scope. The mutations below
// answer a miss with a sentence instead, because they arrive from an action
// and the person clicking Save needs words where their form is.
// -------------------------------------------------------------------
export async function getUserRateHistoryService(userId: string): Promise<UserRateHistoryDTO> {
  try {
    await requireRatesAdmin();

    const person = await getUserByUserIdRepo(userId);

    if (!person) {
      notFound();
    }

    const rates = await listUserRatesForUserRepo(userId);

    return {
      userId: person.id,
      name: userDisplayName(person),
      email: person.email,
      // The repository's order is kept rather than re-sorted. Three bands
      // can share an `effectiveFrom`, and a second opinion about the tie
      // here would make the screen reshuffle between loads for no gain.
      rates: rates.map(toUserRateDTO),
    };
  } catch (error) {
    throw handleError("getUserRateHistoryService", error);
  }
}

// -------------------------------------------------------------------
// Set a rate. An UPSERT on (user, band, effective date).
//
// Correcting a figure entered this morning is correcting TODAY'S rate, not
// starting a second one on the same day, and the unique index says so - so
// the write is one statement rather than a read-then-decide, which two tabs
// saving together would resolve into two rows.
//
// NO FUTURE-DATE CHECK, and that is deliberate rather than an omission. The
// future-date refusal this module owes is on a WORK DATE, where the value
// is a claim about work already done. `effectiveFrom` is when a rate
// STARTS: a rise agreed in May and starting on 1 July is the ordinary case,
// and refusing it would make somebody diarise a reminder to come back on
// the day. Backdating is equally ordinary - it is what setting rates up for
// the first time is.
//
// COST ABOVE CHARGE IS NOT REFUSED EITHER. A loss-making rate is a real
// commercial position and the report's job is to show the negative margin,
// not to make it unrecordable.
// -------------------------------------------------------------------
export async function setUserRateService(requestDTO: SetUserRateRequestDTO): Promise<UserRateDTO> {
  try {
    await requireRatesAdmin();

    const person = await getUserByUserIdRepo(requestDTO.userId);

    if (!person) {
      throw new DisplayErrorMessage("That person no longer has an account.");
    }

    // A de-identified account is dormant and scrubbed and will never log
    // another hour, so a rate effective from any date is a figure nobody can
    // use. Its EXISTING rows are left alone and stay readable, because the
    // time already logged against them is billing history.
    if (person.deidentifiedAt) {
      throw new DisplayErrorMessage(
        "That account has been de-identified, so a new rate cannot be set for it. Its existing rates are unchanged.",
      );
    }

    const saved = await upsertUserRateRepo({
      // Spent on a conflict, and that is the cheaper half of the trade: an
      // id generated and discarded costs nothing, where reading first to
      // find out whether one is needed costs a round trip and a race.
      id: generateId(),
      userId: requestDTO.userId,
      band: requestDTO.band,
      effectiveFrom: requestDTO.effectiveFrom,
      // The schema converted dollars to integer cents at the boundary, so
      // there is no money arithmetic to do here. `costRate` is null when the
      // box was empty, which means margin stays unknown.
      chargeRateCents: requestDTO.chargeRate,
      costRateCents: requestDTO.costRate,
    });

    // After the write, so a failed save is not recorded as a change. Both
    // parties are named: one admin deciding what another person's hour is
    // worth is a commercial act about somebody else.
    await recordAuditEvent({
      action: AUDIT_ACTIONS.USER_RATE_SET,
      entityType: AUDIT_ENTITY_TYPES.USER_RATE,
      entityId: saved.id,
      subjectUserId: saved.userId,
      summary: `${RATE_BAND_LABELS[saved.band]} rate for ${userDisplayName(person)} from ${saved.effectiveFrom}`,
      changes: {
        band: saved.band,
        effectiveFrom: saved.effectiveFrom,
        chargeRateCents: saved.chargeRateCents,
        costRateCents: saved.costRateCents,
      },
    });

    revalidateRatesViews();

    return toUserRateDTO(saved);
  } catch (error) {
    throw handleError("setUserRateService", error);
  }
}

// -------------------------------------------------------------------
// ALL THREE BANDS FOR ONE PERSON, IN ONE TRANSACTION.
//
// WHY IT IS NOT A LOOP OVER setUserRateService. Three calls would be three
// transactions and three audit entries, and the failure between them is the
// reason this exists as its own service: a second save failing leaves the
// person priced in one band from the new date and in another from the old
// one, which is a pricing error nothing on any screen would show. Either all
// the bands somebody entered move to the new date or none of them do.
//
// ONE AUDIT ENTRY, and it names every band written. Three entries for one
// decision would read as three decisions to whoever is reconciling a client's
// invoice, and the thing that happened was one conversation about what a
// person is worth.
//
// A BAND NOT SUPPLIED IS NOT TOUCHED, which is the schema's doing rather
// than this file's - the key is simply absent. That is what makes this safe
// for an edit and not only for first-time setup.
//
// THE ENTITY ID ON THE AUDIT ROW is the first rate written. A row has to
// point somewhere, there is no "rate set" entity above the individual rows,
// and inventing one to hold three ids would be a table for an audit
// convenience. The band list in `changes` is what actually answers "what
// happened", and `subjectUserId` is what makes it findable for the person it
// was about.
//
// EVERY GUARD IS THE SINGLE-BAND ONE. Admin only, the account must exist,
// and a de-identified account is refused - it is dormant and scrubbed and
// will never log another hour, so a rate effective from any date is a figure
// nobody can use. Existing rows are left alone either way, because the time
// already logged against them is billing history.
// -------------------------------------------------------------------
export async function setUserRatesService(requestDTO: SetUserRatesRequestDTO): Promise<UserRateDTO[]> {
  try {
    await requireRatesAdmin();

    const person = await getUserByUserIdRepo(requestDTO.userId);

    if (!person) {
      throw new DisplayErrorMessage("That person no longer has an account.");
    }

    if (person.deidentifiedAt) {
      throw new DisplayErrorMessage(
        "That account has been de-identified, so a new rate cannot be set for it. Its existing rates are unchanged.",
      );
    }

    // Ordered rather than taken from Object.entries, so the audit summary
    // and the returned rows read discounted, standard, high every time
    // regardless of the order the keys arrived in.
    const supplied = RATE_BAND_ORDER.flatMap((band) => {
      const entered = requestDTO.bands[band];

      return entered ? [{ band, ...entered }] : [];
    });

    // The schema refuses this, so reaching it means a caller bypassed the
    // boundary. A plain error rather than a DisplayErrorMessage: there is no
    // form behind it to show a sentence to.
    if (supplied.length === 0) {
      throw new Error("setUserRatesService was given no bands to write");
    }

    // ONE CALL, ONE TRANSACTION, and the transaction lives in the
    // repository because that is the only layer here that touches the
    // database - deciding what shares one included.
    const saved = await upsertUserRatesRepo(
      supplied.map((entry) => ({
        // Spent on a conflict, which is the cheaper half of the trade - see
        // the single-band service above.
        id: generateId(),
        userId: requestDTO.userId,
        band: entry.band,
        // THE SAME DATE FOR EVERY BAND. Three separate saves could not
        // promise that, and nothing stopped them disagreeing.
        effectiveFrom: requestDTO.effectiveFrom,
        // The schema converted dollars to integer cents at the boundary, so
        // there is no money arithmetic here.
        chargeRateCents: entry.chargeRate,
        costRateCents: entry.costRate,
      })),
    );

    // After the write, so a failed save is not recorded as a change. Both
    // parties are named: one admin deciding what another person's hour is
    // worth is a commercial act about somebody else.
    await recordAuditEvent({
      action: AUDIT_ACTIONS.USER_RATE_SET,
      entityType: AUDIT_ENTITY_TYPES.USER_RATE,
      entityId: saved[0].id,
      subjectUserId: requestDTO.userId,
      summary:
        `${saved.map((rate) => RATE_BAND_LABELS[rate.band]).join(", ")} ` +
        `${saved.length === 1 ? "rate" : "rates"} for ${userDisplayName(person)} from ${requestDTO.effectiveFrom}`,
      changes: {
        effectiveFrom: requestDTO.effectiveFrom,
        bands: saved.map((rate) => ({
          band: rate.band,
          chargeRateCents: rate.chargeRateCents,
          costRateCents: rate.costRateCents,
        })),
      },
    });

    revalidateRatesViews();

    return saved.map(toUserRateDTO);
  } catch (error) {
    throw handleError("setUserRatesService", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// DELETING A RATE, AND THE GAP IT CAN LEAVE
// ===================================================================
//
// `deleteUserRateRepo` spells out what this does and does not do, and both
// halves matter to the copy. It does NOT restate history: a time entry
// carries the cents it was charged at, so no margin already reported moves.
// What it DOES change is what future entries resolve to - and because a
// rate is the greatest `effectiveFrom` on or before the work date and never
// a later one, removing the EARLIEST row of a band leaves a window of dates
// with no rate at all. The resolver is being correct there, not failing.
//
// The failure that follows is silent: an entry backdated into that window
// comes back unvalued, and nothing on any screen says the rate it needed
// was deleted. So it is refused-or-warned in words, worked out from the
// rows while they still exist.
//
// A REFUSAL WAS THE ALTERNATIVE AND IT LOST. The earliest row of a band is
// exactly the one most likely to have been mistyped - it is the one entered
// first - and the repository's own note says an admin who typed 150000 for
// 15000 should not have to live with it forever. So the answer is a warning
// that cannot be missed rather than a rule that cannot be worked around.
// -------------------------------------------------------------------

// The part of the impact that is derivable from the rows alone.
type RateDeletionConsequence = Pick<
  UserRateDeletionImpactDTO,
  "leavesGap" | "fallsBackToEffectiveFrom" | "unvaluedFrom" | "unvaluedTo" | "consequence"
>;

// -------------------------------------------------------------------
// PURE, EXPORTED AND TESTED DIRECTLY, for the reason `admitOption` is in
// admin-timesheets-query.service.ts: it is the part that has to be right,
// every interesting case is an off-by-one, and both failure directions are
// silent. Warning when there is no gap only over-warns; failing to warn
// lets somebody remove the earliest rate of a band and find out months
// later, from an unvalued entry, that they opened a hole.
//
// `bandRates` is every rate for THE SAME (user, band), in any order. The
// repository returns a person's whole history across all three bands, so
// filtering is the caller's job - doing it in here would make the answer
// depend on a filter having already happened, which is the sort of implicit
// precondition this module keeps out of its arithmetic.
//
// Dates are compared LEXICOGRAPHICALLY, exact for 'YYYY-MM-DD', and
// `unvaluedTo` is the day BEFORE the next start rather than the next start
// itself, because the sentence on the screen reads as an inclusive window.
// `addCalendarDays` does that subtraction on integers with no Date
// involved, which is the whole reason it exists.
// -------------------------------------------------------------------
export function rateDeletionConsequenceOf(
  rate: UserRate,
  bandRates: readonly UserRate[],
): RateDeletionConsequence {
  const bandLabel = RATE_BAND_LABELS[rate.band];
  const others = bandRates.filter((candidate) => candidate.id !== rate.id);

  // Said on every branch, because it is the half people get wrong: a delete
  // here looks like it should move money and does not.
  const historyIsSafe =
    "Time already logged keeps the rate it was charged at, so no figure already reported will change.";

  // What the resolver would pick instead for a date on this row's start: the
  // greatest start still before it. Strictly before, because (user, band,
  // effective_from) is unique and a tie cannot exist.
  const predecessor = others
    .filter((candidate) => candidate.effectiveFrom < rate.effectiveFrom)
    .reduce<UserRate | undefined>(
      (latest, candidate) =>
        !latest || candidate.effectiveFrom > latest.effectiveFrom ? candidate : latest,
      undefined,
    );

  if (predecessor) {
    return {
      leavesGap: false,
      fallsBackToEffectiveFrom: predecessor.effectiveFrom,
      unvaluedFrom: null,
      unvaluedTo: null,
      consequence: `Work logged from ${rate.effectiveFrom} onwards will fall back to the ${bandLabel} rate starting ${predecessor.effectiveFrom}. ${historyIsSafe}`,
    };
  }

  // No earlier rate, so every date from this one until the next rate starts
  // resolves to nothing at all. The successor closes the window; with none,
  // it is open-ended.
  const successor = others
    .filter((candidate) => candidate.effectiveFrom > rate.effectiveFrom)
    .reduce<UserRate | undefined>(
      (earliest, candidate) =>
        !earliest || candidate.effectiveFrom < earliest.effectiveFrom ? candidate : earliest,
      undefined,
    );

  const unvaluedTo = successor ? addCalendarDays(successor.effectiveFrom, -1) : null;

  return {
    leavesGap: true,
    fallsBackToEffectiveFrom: null,
    unvaluedFrom: rate.effectiveFrom,
    unvaluedTo,
    consequence: unvaluedTo
      ? `This is the earliest ${bandLabel} rate, so there is nothing to fall back to: work dated ${rate.effectiveFrom} to ${unvaluedTo} will have no ${bandLabel} rate and will be reported as unvalued. ${historyIsSafe}`
      : `This is the only ${bandLabel} rate, so there is nothing to fall back to: work dated ${rate.effectiveFrom} or later will have no ${bandLabel} rate and will be reported as unvalued. ${historyIsSafe}`,
  };
}

// Read the row, name the person, and work out the consequence - all before
// anything is removed, because none of it survives the delete.
async function resolveRateDeletionImpact(rateId: string): Promise<UserRateDeletionImpactDTO> {
  const rate = await getUserRateByIdRepo(rateId);

  // Undefined here is only a miss on an id - the repository distinguishes it
  // from the meaningful null `getUserRateAsAtRepo` returns - and the likely
  // cause is two admins on the same screen. A sentence rather than a 404,
  // because the second one needs to be told the row has already gone.
  if (!rate) {
    throw new DisplayErrorMessage("That rate has already been removed.");
  }

  const [person, history] = await Promise.all([
    getUserByUserIdRepo(rate.userId),
    listUserRatesForUserRepo(rate.userId),
  ]);

  return {
    rate: toUserRateDTO(rate),
    // Null when the account has since been de-identified. The row is still
    // deletable: a scrubbed account's rate card is not history worth keeping.
    personName: person ? userDisplayName(person) : null,
    ...rateDeletionConsequenceOf(
      rate,
      // Only the row's OWN band can change what a date in it resolves to.
      history.filter((candidate) => candidate.band === rate.band),
    ),
  };
}

// -------------------------------------------------------------------
// What deleting this rate would do, for the confirmation dialog.
//
// A read, so nothing is written and it is safe to call on hover. It is the
// same computation the delete performs, from the same function, so the
// dialog cannot promise one outcome and the delete produce another.
// -------------------------------------------------------------------
export async function getUserRateDeletionImpactService(
  rateId: string,
): Promise<UserRateDeletionImpactDTO> {
  try {
    await requireRatesAdmin();

    return await resolveRateDeletionImpact(rateId);
  } catch (error) {
    throw handleError("getUserRateDeletionImpactService", error);
  }
}

// -------------------------------------------------------------------
// Delete a rate row, and RETURN WHAT IT DID.
//
// Returning the impact rather than void is what makes the warning
// unskippable. The dialog shows it beforehand; the action still holds it
// afterwards, so a delete reached from a keyboard shortcut, a stale screen
// or a second tab still reports the gap it left. A void return would make
// being warned depend on one component having remembered to ask.
// -------------------------------------------------------------------
export async function deleteUserRateService(
  requestDTO: DeleteUserRateRequestDTO,
): Promise<UserRateDeletionImpactDTO> {
  try {
    await requireRatesAdmin();

    // BEFORE the delete, because neither the cents nor the answer to "was
    // this the earliest of its band" survives it, and reading it back
    // afterwards is not an option.
    const impact = await resolveRateDeletionImpact(requestDTO.rateId);

    const deleted = await deleteUserRateRepo(requestDTO.rateId);

    // Zero means it went between that read and this line. The same sentence
    // as a miss on the read, because from the reader's side it is the same
    // situation.
    if (deleted === 0) {
      throw new DisplayErrorMessage("That rate has already been removed.");
    }

    // The only lasting record of who opened an unvalued window, since the
    // row that would have explained it is what was deleted. `leavesGap`
    // rides along so the log answers that question without the reader
    // having to reconstruct the band's history at the time.
    await recordAuditEvent({
      action: AUDIT_ACTIONS.USER_RATE_DELETED,
      entityType: AUDIT_ENTITY_TYPES.USER_RATE,
      entityId: impact.rate.id,
      subjectUserId: impact.rate.userId,
      summary: `${RATE_BAND_LABELS[impact.rate.band]} rate from ${impact.rate.effectiveFrom} removed`,
      changes: {
        band: impact.rate.band,
        effectiveFrom: impact.rate.effectiveFrom,
        chargeRateCents: impact.rate.chargeRateCents,
        costRateCents: impact.rate.costRateCents,
        leavesGap: impact.leavesGap,
        unvaluedFrom: impact.unvaluedFrom,
        unvaluedTo: impact.unvaluedTo,
      },
    });

    revalidateRatesViews();

    return impact;
  } catch (error) {
    throw handleError("deleteUserRateService", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// THE BUDGET REPORT
// ===================================================================
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// WHO MAY SEE CENTS, as a value rather than an assumption.
//
// `full` is the only one any exported function here passes, because every
// one of them is admin-only. It is a parameter anyway for two reasons.
//
// The DTO models three states - `chargeableCents` "present when the viewer
// may see money at all", cost and margin "admin only" - so the shape is
// already viewer-dependent whether or not this file admits it, and the
// report is meant to become readable by a project LEAD without the cost
// side. When that happens the omission needs to be one decision in one
// place, not a second builder.
//
// Second, and the reason it is not merely documentation: `none` and
// `chargeOnly` SKIP THE QUERIES. The cents never leave Postgres, so the
// absence in the DTO is a fact about what was read rather than a field
// somebody deleted on the way out.
//
// THE ALTERNATIVE THAT LOST: always attach the cents and let the component
// decide. That turns the absence convention into decoration - the figure
// has already crossed the wire - and it makes a leak a rendering bug
// instead of an impossibility.
// -------------------------------------------------------------------
type MoneyVisibility = "none" | "chargeOnly" | "full";

// -------------------------------------------------------------------
// Money onto one rollup line, or nothing at all.
//
// `chargeableCents` and `costCents` come STRAIGHT FROM THE SQL, already
// rounded per entry and summed in Postgres. The only arithmetic is the
// subtraction, through the shared `marginCents`, so the three figures on a
// line cannot disagree with each other or with the same line drawn
// elsewhere.
//
// OMITTED, NOT NULLED, when the viewer may not see a side. Null already
// means "unknown" here - a non-billable project, an unmodelled cost - and a
// component cannot tell that apart from "not for you".
//
// A LINE ABSENT FROM THE ROLLUP BECOMES NULL, NOT ZERO. Absent means no
// time has been logged against it at all, and null is what the
// project-level read itself returns for that state, so a group with no
// hours reads the same way as a project with none. Zero would be a claim
// that the work was worth nothing, and "$0.00" beside "0h" invites nobody
// to ask why - which is the whole objection to it.
// -------------------------------------------------------------------
function moneyFields(
  visibility: MoneyVisibility,
  cents: ChargeAndCostCents | undefined,
): Pick<BudgetReportDTO, "chargeableCents" | "costCents" | "marginCents"> {
  if (visibility === "none") return {};

  const chargeableCents = cents?.chargeCents ?? null;

  if (visibility === "chargeOnly") return { chargeableCents };

  const costCents = cents?.costCents ?? null;

  return { chargeableCents, costCents, marginCents: marginCents(chargeableCents, costCents) };
}

// -------------------------------------------------------------------
// The report itself: budget minutes and logged minutes per budget group and
// for the project as a whole, with the money beside them.
//
// SIX READS, EVERY ONE A ROLLUP, and nothing is added up here. The project
// estimate, the project's logged minutes, the per-group logged minutes and
// both money reads are all GROUP BY in Postgres; the groups and their
// members come back from one call because a pooled budget is a statement
// about a named set of people.
//
// The reads are issued together rather than in sequence. They are
// independent - none of them needs another's answer - and a budget report
// asking six times in series is six round trips on a screen somebody opens
// to look at one number.
// -------------------------------------------------------------------
async function buildBudgetReport(
  projectId: string,
  visibility: MoneyVisibility,
): Promise<BudgetReportDTO> {
  const project = await getProjectByIdRepo(projectId);

  // `getProjectByIdRepo` is the ADMIN read and authorises nothing on its
  // own, which is why the guard above it is not optional. notFound() for a
  // miss, so a guessed id cannot confirm a project exists.
  if (!project) {
    notFound();
  }

  const [estimateMinutes, projectLogged, groups, groupLogged] = await Promise.all([
    getProjectEstimateMinutesRepo(projectId),
    getLoggedMinutesByProjectRepo([projectId]),
    getProjectBudgetGroupsRepo(projectId),
    getLoggedMinutesByBudgetGroupRepo(projectId),
  ]);

  const [projectCents, groupCents] =
    visibility === "none"
      ? [undefined, []]
      : await Promise.all([
          getChargeAndCostCentsByProjectRepo(projectId),
          getChargeAndCostCentsByBudgetGroupRepo(projectId),
        ]);

  // A project with no time against it is absent from the per-project read
  // rather than present as a zero, which the repository documents and the
  // caller answers with a default. That default is zero for MINUTES and
  // null for money, and the difference is rule 2 at the top of this file:
  // nobody has logged an hour, so there are no hours - but there is also
  // nothing that has been valued.
  const projectMinutes = projectLogged.find((row) => row.projectId === projectId)?.minutes ?? 0;

  const loggedByGroup = new Map(groupLogged.map((row) => [row.groupId, row.minutes]));
  const centsByGroup = new Map(groupCents.map((row) => [row.groupId, row]));

  const groupReports: BudgetGroupReportDTO[] = groups.map((group) => ({
    groupId: group.id,
    name: group.name,
    members: group.members.map((member) => ({
      userId: member.userId,
      name: userDisplayName(member),
    })),
    rollup: budgetProgress(group.budgetMinutes, loggedByGroup.get(group.id) ?? 0),
    ...moneyFields(visibility, centsByGroup.get(group.id)),
  }));

  return {
    projectId: project.id,
    projectTitle: project.title,
    clientName: project.clientName,
    isBillable: project.isBillable,
    project: budgetProgress(estimateMinutes, projectMinutes),
    groups: groupReports,
    // The no-group bucket, which both group reads return under a null key
    // rather than dropping - time logged by somebody in no group is still
    // the project's.
    //
    // ITS BUDGET IS 0 AND THAT IS NOT A PLACEHOLDER. A group budget is a
    // pool carved out of the project and nobody has ever pooled the
    // remainder, so there is no figure to show. `budgetProgress(0, n)`
    // answers a null remainder and a null percentage rather than a full
    // bar, which is the honest reading, and it does not flag an overrun -
    // painting the remainder red would blame the people who did the work
    // for the omission of the person who planned it.
    //
    // THE ALTERNATIVE THAT LOST: the project's budget less the sum of the
    // groups. That invents a number nobody set, can go negative for
    // perfectly sound planning, and is exactly the arithmetic rule 1
    // forbids.
    //
    // The null-key MONEY row is read and deliberately not used: the DTO
    // gives `ungrouped` no cents fields, because a pool's value is a
    // question about a pool. Adding them is a decision about the report,
    // not a gap to be filled in passing.
    ungrouped: budgetProgress(0, loggedByGroup.get(null) ?? 0),
    ...moneyFields(visibility, projectCents),
  };
}

// -------------------------------------------------------------------
// One project's budget report, for an admin.
//
// `full` because the guard is ADMIN. The report is the only DTO in the
// module carrying cents, and this is the only way in.
// -------------------------------------------------------------------
export async function getProjectBudgetReportService(projectId: string): Promise<BudgetReportDTO> {
  try {
    await requireRatesAdmin();

    return await buildBudgetReport(projectId, "full");
  } catch (error) {
    throw handleError("getProjectBudgetReportService", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// THE OVER-BUDGET VIEW ACROSS PROJECTS IS NOT HERE, AND WHY
// ===================================================================
//
// It needs two figures per project for every project at once, and both of
// the reads that produce them are keyed on ONE project id:
//
//   - estimated minutes grouped by project. `getProjectEstimateMinutesRepo`
//     takes a single id and returns a single number; there is no
//     `getEstimateMinutesByProjectsRepo` alongside
//     `getLoggedMinutesByProjectRepo`, which already takes a LIST for
//     exactly this reason.
//   - charge and cost cents grouped by project.
//     `getChargeAndCostCentsByProjectRepo` is also one project at a time.
//
// So the only way to build it from what exists is a loop over
// `getAllProjectsRepo`, which is two queries per project on the screen most
// likely to be opened with every project on it. A service does not run its
// own SQL and a loop is not a substitute for a GROUP BY, so this is
// reported as two missing repository functions rather than written badly.
//
// Both belong beside the rollups they mirror - the estimate one in
// `tasks.repository.ts`, the money one in `time-entries.repository.ts` -
// and both should take `projectIds: string[]`, return a row per project
// that HAS any, and leave the caller to default a missing one, which is the
// contract every other rollup in those files already documents.
//
// When they land, the view is `buildBudgetReport`'s arithmetic applied per
// row: `budgetProgress(estimate, logged)` and `moneyFields`, with
// `isOverBudget` and `overMinutes` already computed by the shared helper so
// the list and the per-project report cannot disagree about who is over.
// -------------------------------------------------------------------
