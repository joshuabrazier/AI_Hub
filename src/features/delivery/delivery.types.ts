import z from "zod";

import {
  AI_CHAT_ACCEPT_ATTRIBUTE,
  AI_CHAT_ACCEPTED_SUMMARY,
  MAX_DOCUMENT_BYTES,
} from "@/lib/ai/attachment-formats";
import { TABLE_ID_LENGTH } from "@/lib/constants";
import {
  PROJECT_STATUSES,
  RATE_BANDS,
  TASK_COLUMNS,
  TASK_COLUMN_ORDER,
  USER_ROLES,
  type ProjectStatus,
  type RateBand,
  type TaskColumn,
  type UserRole,
} from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// ===================================================================
// DELIVERY: THE SHARED CONTRACT
// ===================================================================
//
// Every service, action and component in this module codes against this
// file. It holds bounds, the Zod schema for each mutation, the DTOs the
// screens render, and the pure arithmetic that would otherwise be copied
// into four components and disagree in three of them.
//
// NO DATABASE ACCESS, NO "use server", NO REACT. It has to be importable
// from a server component and a client component alike, so it stays free of
// anything that pins it to one side.
//
// FOUR THINGS THAT GOVERN EVERYTHING BELOW:
//
//   1. HOURS ARE THE INPUT UNIT, MINUTES ARE THE STORED UNIT. Somebody
//      types 1.5; 90 is written. The conversion happens ONCE, at the schema
//      boundary, so nothing downstream ever handles a fractional hour - see
//      migration 016 for why a float of hours is not an option. That is why
//      several schemas below export both an INPUT type (what the form
//      holds) and a REQUEST type (what the service receives): conflating
//      them is how a form ends up posting "1.5" into a field the service
//      reads as minutes.
//
//   2. MONEY IS INTEGER CENTS, and the forms work in dollars for the same
//      reason.
//
//   3. CALENDAR DATES ARE 'YYYY-MM-DD' STRINGS. `workDate` and
//      `effectiveFrom` are Postgres DATE columns and the type parser maps
//      them to strings on purpose. Nothing in this file constructs a Date
//      from one, including the week arithmetic - see the note above
//      `dayNumberOf`.
//
//   4. `project_members` IS THE SECURITY BOUNDARY and `is_lead` is a second
//      gate. NONE of the ids in these schemas is proof of anything: the
//      service re-resolves every row against the SESSION user and its own
//      role check before touching it. A schema bounds a shape; it does not
//      grant access.
// -------------------------------------------------------------------

// Ids are always re-checked server-side; the length bound only keeps obvious
// rubbish out of the query.
const clientIdSchema = z.string().min(TABLE_ID_LENGTH);
const projectIdSchema = z.string().min(TABLE_ID_LENGTH);
const phaseIdSchema = z.string().min(TABLE_ID_LENGTH);
const taskIdSchema = z.string().min(TABLE_ID_LENGTH);
const taskAttachmentIdSchema = z.string().min(TABLE_ID_LENGTH);
const timeEntryIdSchema = z.string().min(TABLE_ID_LENGTH);
const budgetGroupIdSchema = z.string().min(TABLE_ID_LENGTH);
const userIdSchema = z.string().min(TABLE_ID_LENGTH);
const userRateIdSchema = z.string().min(TABLE_ID_LENGTH);

// -------------------------------------------------------------------
// ===================================================================
// BOUNDS
// ===================================================================
//
// Text limits are about what the field IS, not about safety - Postgres TEXT
// has no length and the sanitiser handles the dangerous half. A title bound
// exists so a pasted email lands as a validation error rather than as a
// board card that pushes the column off the screen, and so the DTO that
// carries it stays a sensible size.
// -------------------------------------------------------------------

// Matches the 120 used for a team name, because both are the same kind of
// thing: a short label somebody picks from a list.
export const CLIENT_NAME_MAX_CHARS = 120;

// A project title is read in a left-hand nav that is a fixed width, so it
// is generous rather than long.
export const PROJECT_TITLE_MAX_CHARS = 160;

// A task title has to survive being read on a board card, where about six
// words fit. This is the ceiling, not the target.
export const TASK_TITLE_MAX_CHARS = 200;

// A phase is a HEADING with an order. Anything past this is a description
// typed into the wrong field, and the board layout says so before the
// validator does.
export const PHASE_NAME_MAX_CHARS = 80;

// "The two interns", "Principal consultant". A bundle name, not a brief.
export const BUDGET_GROUP_NAME_MAX_CHARS = 80;

// Long enough for a scope note pasted out of an email, short enough that the
// task table is not storing a novel per row. The board card DTO does not
// carry a description at all, so this only ever ships on a task opened.
export const DESCRIPTION_MAX_CHARS = 10_000;

// A time entry note ("what I did"), a client note, an estimate reason. All
// three are a sentence or two by nature.
export const NOTE_MAX_CHARS = 1_000;

// -------------------------------------------------------------------
// The longest one time entry may be, and it is NOT a number chosen here:
// `time_entries_minutes_sane` in migration 016 is CHECK (minutes > 0 AND
// minutes <= 1440). A day has 1440 minutes and anything beyond it is a typo.
//
// The hours figure is DERIVED from it rather than written out, so raising one
// cannot leave the other behind - a mismatch would show up as a friendly
// message accepting a value Postgres then rejects with a constraint
// violation.
// -------------------------------------------------------------------
export const MAX_ENTRY_MINUTES = 1440;
export const MAX_ENTRY_HOURS = MAX_ENTRY_MINUTES / 60;

// -------------------------------------------------------------------
// The ceiling on an estimate or a pooled budget.
//
// Postgres INTEGER stops at 2,147,483,647 minutes, so this is nowhere near a
// storage limit. It is there to catch the one mistake this pair of units
// invites: typing MINUTES into a box labelled hours. 480 in an hours field is
// a plausible year of work; 28,800 is somebody who meant 480 minutes. A wide
// bound catches the second without ever refusing the first.
// -------------------------------------------------------------------
export const MAX_PLANNED_HOURS = 100_000;

// -------------------------------------------------------------------
// The board has FOUR columns and the number is fixed, not configurable.
//
// From migration 016: a board whose columns differ per project cannot be
// reported on across projects, and having `blocked` as a real column rather
// than a flag is most of the point of looking at a board. Derived from
// TASK_COLUMN_ORDER so the count and the order cannot disagree.
// -------------------------------------------------------------------
export const BOARD_COLUMN_COUNT = TASK_COLUMN_ORDER.length;

// Array bounds on the set-replacing schemas. Not a policy about how big a
// project may get - it is what stops one action posting a hundred thousand
// ids and holding a transaction open while the service writes them.
export const MAX_PROJECT_MEMBERS = 200;
export const MAX_PHASES_PER_PROJECT = 100;
export const MAX_BUDGET_GROUP_MEMBERS = MAX_PROJECT_MEMBERS;

// -------------------------------------------------------------------
// How many EMPTY rows one timesheet week may carry.
//
// An empty row is a piece of somebody's screen rather than a fact about the
// business, so it lives in a browser-held store and is handed back to the
// week read as `addedTaskIds`. That makes the list untrusted input, and it
// becomes an `in` list, so it is bounded here rather than trusted. Fifty is
// far more rows than a week of real work has, and small enough that a
// tampered store cannot turn one page load into an unbounded query.
//
// It CAPS rather than refuses - see TimesheetWeekSchema for why.
// -------------------------------------------------------------------
export const MAX_TIMESHEET_ADDED_ROWS = 50;

// The bound on a stored attachment's file name, matching what AI chat puts on
// one and for the same reason: a pathological name must not be able to bloat
// the row. The name is display only - nothing downstream decides anything
// from it - which is why the bound is generous rather than tight.
export const ATTACHMENT_NAME_MAX_CHARS = 255;

// -------------------------------------------------------------------
// The window a work date or a rate start may fall in.
//
// Deliberately wide: it catches a fat-fingered year ("0025-06-01",
// "20265-06-01") and nothing else. It does NOT stop somebody logging time
// next Tuesday, because "today" cannot be decided in a pure schema - the
// answer depends on APP_TIME_ZONE, and `new Date()` would give the server's
// idea of the day rather than the organisation's. THE SERVICE refuses a
// future work date, in the app zone.
// -------------------------------------------------------------------
export const MIN_CALENDAR_DATE = "2000-01-01";
export const MAX_CALENDAR_DATE = "2100-12-31";

// -------------------------------------------------------------------
// ===================================================================
// CALENDAR ARITHMETIC, WITHOUT A Date
// ===================================================================
//
// The timesheet grid is seven columns and every one of them is a
// 'YYYY-MM-DD' string that has to be the right day. The failure this guards
// against is not a crash: it is Monday's hours appearing under Sunday for
// everybody west of the server, which nobody notices until a week is
// invoiced.
//
// So the arithmetic here goes string -> integer day number -> string, with
// no Date object anywhere. The conversion is Howard Hinnant's civil-date
// algorithm, the same one the C++ standard's date library is built on: it is
// exact for every proleptic Gregorian date and has no notion of a clock, a
// zone or a leap second to get wrong.
//
// THE ALTERNATIVE, and why it lost: elsewhere in this codebase the house
// pattern is `new Date(\`${date}T00:00:00Z\`)` and back out through
// `toISOString().slice(0, 10)` - see `addDays` in
// src/lib/timesheet/daily-series.ts, where it is documented as safe BECAUSE
// the values are date-only, and it is. That approach is correct and it is
// two lines. It was not reused here for one reason: the week start is a
// parameter of this grid rather than a fixed Monday, so the offset maths is
// ours either way, and doing it on plain integers makes the whole path
// testable with no dependency on the environment's Date at all. Being able
// to assert the seven strings for a week straddling a daylight-saving
// change, in a test that cannot be affected by the machine's zone, is worth
// twenty lines.
// -------------------------------------------------------------------

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
}

/**
 * Whether a string is a 'YYYY-MM-DD' date that actually exists.
 *
 * Exported and tested directly, because the interesting cases are the ones
 * that look fine: 2026-02-31 and 2026-13-01 both pass a regex, and a Date
 * would silently roll the first into March rather than refusing it.
 */
export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_PATTERN.test(value)) return false;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));

  if (month < 1 || month > 12) return false;

  return day >= 1 && day <= daysInMonth(year, month);
}

// Days since 1970-01-01, negative before it. Hinnant's days_from_civil.
function dayNumberOf(date: string): number {
  const rawYear = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));

  // March is treated as the first month of the year, which is what makes the
  // leap day the LAST day and removes it from the middle of the arithmetic.
  const year = month <= 2 ? rawYear - 1 : rawYear;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;

  // 719468 is the number of days from 0000-03-01 to 1970-01-01.
  return era * 146097 + dayOfEra - 719468;
}

// The inverse. Hinnant's civil_from_days.
function dateOfDayNumber(dayNumber: number): string {
  const shifted = dayNumber + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// -------------------------------------------------------------------
// Days of the week, Sunday = 0.
//
// Sunday-first matches JavaScript's own convention, which is the one every
// date library and every calendar component in the ecosystem uses. It is not
// the week the grid DISPLAYS - that starts on Monday by default - and the
// two being different is exactly why the numbering has to be written down
// rather than assumed.
//
// NUMBERS, and the name says so because `WEEK_DAYS` is already taken:
// enquiry.types.ts exports one holding the day NAMES a person ticks on the
// contact form ("Monday"), and `WeekDay` there is that string union. Two
// exports with the same name and different types is how an import lands the
// other one and a `weekStartsOn` of "Monday" silently offsets a grid by
// NaN days. The longer name is cheaper than that.
// -------------------------------------------------------------------
export const WEEK_DAY_NUMBERS = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
} as const;

export type WeekDayNumber = (typeof WEEK_DAY_NUMBERS)[keyof typeof WEEK_DAY_NUMBERS];

// Monday, matching the reporting engine's `mondayOf` and the Australian
// working week. A parameter rather than a constant everywhere because a
// client whose week runs Sunday to Saturday is a setting, not a rewrite.
export const DEFAULT_WEEK_START: WeekDayNumber = WEEK_DAY_NUMBERS.MONDAY;

export const DAYS_IN_WEEK = 7;

/**
 * Add (or subtract) whole days from a 'YYYY-MM-DD' string.
 *
 * Throws on a malformed date rather than returning the input unchanged.
 * Returning the input is what `daily-series.ts` does and is right for a
 * chart - a missing bar is visible. Here the caller is a grid: a fallback
 * date would render seven plausible columns under the wrong headings and
 * nothing would look broken.
 */
export function addCalendarDays(date: string, days: number): string {
  if (!isCalendarDate(date)) {
    throw new Error(`Not a calendar date: ${date}`);
  }

  return dateOfDayNumber(dayNumberOf(date) + Math.trunc(days));
}

/** Which day of the week a date falls on, Sunday = 0. */
export function weekDayOf(date: string): WeekDayNumber {
  if (!isCalendarDate(date)) {
    throw new Error(`Not a calendar date: ${date}`);
  }

  // 1970-01-01 was a Thursday, so the epoch day number is 4. The extra 7
  // keeps the remainder positive for dates before 1970, where JavaScript's %
  // returns a negative.
  return (((dayNumberOf(date) % 7) + 11) % 7) as WeekDayNumber;
}

/** The first day of the week containing `date`, given which day a week starts on. */
export function startOfWeek(date: string, weekStartsOn: WeekDayNumber = DEFAULT_WEEK_START): string {
  const offset = (weekDayOf(date) - weekStartsOn + 7) % 7;

  return addCalendarDays(date, -offset);
}

/**
 * The seven dates of the week containing `date`, in order.
 *
 * This is the timesheet grid's column headings, and every row's day cells
 * are built in the same order - so a cell's index IS its date and nothing
 * has to match them up by value.
 */
export function weekDates(date: string, weekStartsOn: WeekDayNumber = DEFAULT_WEEK_START): string[] {
  const start = startOfWeek(date, weekStartsOn);

  return Array.from({ length: DAYS_IN_WEEK }, (_unused, index) => addCalendarDays(start, index));
}

// -------------------------------------------------------------------
// ===================================================================
// MINUTES, HOURS AND WHAT ROUNDING DOES TO A WEEK
// ===================================================================
// -------------------------------------------------------------------

/**
 * Hours as typed, minutes as stored.
 *
 * ROUNDS TO THE NEAREST MINUTE, half up. Truncating looks tidier and costs
 * up to 59 seconds on every single entry, so a week of seven entries never
 * adds up to the day somebody actually worked and the shortfall grows with
 * how carefully they filled the form in.
 *
 * 1.5 -> 90. 0.25 -> 15. 0.125 -> 8 (7.5 rounds up). 1/3 -> 20 (19.8 rounds
 * up), which is why a third of an hour typed as 0.33 and typed as 0.34 both
 * land on 20 minutes and neither is wrong.
 */
export function hoursToMinutes(hours: number): number {
  return Math.round(hours * 60);
}

/**
 * Minutes as an exact number of hours, unrounded.
 *
 * For arithmetic - a chart axis, a utilisation figure. NOT for display: use
 * `formatMinutesAsHours`, which decides how many decimals to show in one
 * place.
 */
export function minutesToHours(minutes: number): number {
  return minutes / 60;
}

/**
 * "1h 30m", "45m", "2h", "0m".
 *
 * The form for reading a duration. Whole hours drop the minutes rather than
 * printing "2h 0m", because a column of durations is scanned and the zeroes
 * are noise. Negative input keeps its sign - a remaining-budget figure goes
 * negative and "-6h 30m" is the whole point of showing it.
 */
export function formatMinutesAsClock(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const total = Math.abs(Math.round(minutes));
  const hours = Math.floor(total / 60);
  const remainder = total % 60;

  if (hours === 0) return `${sign}${remainder}m`;
  if (remainder === 0) return `${sign}${hours}h`;

  return `${sign}${hours}h ${remainder}m`;
}

/**
 * "1.5", "1", "0.33".
 *
 * The form for a timesheet CELL, because it is also the form somebody types
 * into one: an editable cell showing "1h 30m" cannot be edited by typing
 * over it.
 *
 * Two decimal places, trailing zeros trimmed. It is a DISPLAY value and the
 * minutes remain the truth - 20 minutes shows as "0.33", which is 19.8
 * minutes if read back literally. Never sum these strings; sum the minutes
 * and format the total.
 */
export function formatMinutesAsHours(minutes: number): string {
  return String(Number((minutes / 60).toFixed(2)));
}

// -------------------------------------------------------------------
// ===================================================================
// BUDGET ROLLUP
// ===================================================================
//
// One shape for a progress bar, whether it is drawn for a budget group, a
// project or a single task. Computed here rather than in the component so
// the group bars and the project bar cannot round differently and fail to
// add up.
// -------------------------------------------------------------------
export type BudgetRollupDTO = {
  budgetMinutes: number;
  loggedMinutes: number;
  // NULL when no budget is set. "8 hours left" and "nothing left" are both
  // false when nobody has said what the budget is, and this module already
  // treats an unknown cost as null rather than nought for the same reason.
  remainingMinutes: number | null;
  // How far past the budget, 0 when inside it. A positive number, so a
  // caller does not have to negate `remainingMinutes` to print it.
  overMinutes: number;
  // The true figure, which may exceed 100. Null when there is no budget:
  // dividing by nought gives Infinity or, if guarded to 100, a full bar -
  // and both read as "all spent" when the truth is "nobody budgeted this".
  percentUsed: number | null;
  // Clamped to 0-100 for the width of the filled part. Separate from
  // percentUsed so the bar can be full while the label says 140%.
  barPercent: number;
  isOverBudget: boolean;
};

/**
 * Everything a progress bar needs, from two minute figures.
 *
 * `percentUsed` is rounded to one decimal place. Unrounded it renders as
 * 66.66666666666667 in one place and 66.7 in another depending on which
 * component formats it; rounding once here means every surface shows the
 * same number.
 *
 * Time logged against a budget of nought is NOT flagged as an overrun. It is
 * a group nobody has budgeted yet, and painting it red blames the person who
 * did the work for the omission of the person who planned it.
 */
export function budgetProgress(budgetMinutes: number, loggedMinutes: number): BudgetRollupDTO {
  const budget = Math.max(0, Math.round(budgetMinutes));
  const logged = Math.max(0, Math.round(loggedMinutes));

  if (budget === 0) {
    return {
      budgetMinutes: 0,
      loggedMinutes: logged,
      remainingMinutes: null,
      overMinutes: 0,
      percentUsed: null,
      barPercent: 0,
      isOverBudget: false,
    };
  }

  const remaining = budget - logged;
  const percentUsed = Math.round((logged / budget) * 1000) / 10;

  return {
    budgetMinutes: budget,
    loggedMinutes: logged,
    remainingMinutes: remaining,
    overMinutes: remaining < 0 ? -remaining : 0,
    percentUsed,
    barPercent: Math.min(100, Math.max(0, percentUsed)),
    isOverBudget: remaining < 0,
  };
}

// -------------------------------------------------------------------
// ===================================================================
// MONEY
// ===================================================================
// -------------------------------------------------------------------

/**
 * What some minutes are worth at an hourly rate, in cents.
 *
 * Used for both halves of the margin: a charge rate gives revenue, a cost
 * rate gives cost, and the arithmetic is identical.
 *
 * A NULL RATE GIVES NULL, never nought. A non-billable project has nothing
 * to charge and an unmodelled cost is unknown - calling either of them zero
 * turns "we do not know the margin" into "the margin is 100%", which is the
 * one wrong answer that looks like good news.
 *
 * Rounded to the cent HERE, per entry, because every entry carries its own
 * snapshot rate and there is no single rate a total could be computed from.
 * That also gives the property somebody checking an invoice needs: the total
 * is the sum of the lines shown, exactly.
 */
export function rateValueCents(minutes: number, ratePerHourCents: number | null): number | null {
  if (ratePerHourCents === null) return null;

  return Math.round((minutes * ratePerHourCents) / 60);
}

/**
 * Revenue less cost, in cents, or null when either side is unknown.
 *
 * Unknown propagates on purpose - see `rateValueCents`.
 */
export function marginCents(chargeCents: number | null, costCents: number | null): number | null {
  if (chargeCents === null || costCents === null) return null;

  return chargeCents - costCents;
}

// -------------------------------------------------------------------
// ===================================================================
// THE SECOND GATE, IN ONE LINE
// ===================================================================
//
// `project_members` is this module's security boundary and `is_lead` is a
// second gate on top of it. This is that gate, and it lives in the contract
// file because FOUR CALLERS need the same answer: the setup service resolving
// what a project page may do, the board service resolving a card write, the
// time service resolving an estimate adjustment, and a client component
// deciding whether to render the button at all. It was written three times
// before it was moved here, and three implementations of one authorization
// decision is how a screen ends up offering a member a button the server
// refuses.
//
// `canEditTasks` is the DTO's field and it is deliberately not `isLead`: an
// admin is not a lead and can still edit, so a component deriving the rule
// from a flag plus a role would be a second copy of an authorization
// decision. It is a convenience for the UI either way - every write
// re-checks - but a UI that disagrees with the server shows people buttons
// that fail, so the rule lives in one place and is asserted in a test.
//
// A MANAGER IS NOT SPECIAL HERE. Their scope elsewhere in the app comes from
// the teams an admin assigned them; this module's boundary is project
// membership, and a manager who is a member of a project is a member of it
// like anybody else. Widening it to "manager" would hand every manager every
// project in the organisation.
//
// IT IS PURE AND IT HAS TO STAY PURE. Nothing here reads a session or a row -
// the caller has resolved both already - which is what lets a client
// component import it. It is therefore not an authorization CHECK: it answers
// a question about two values THE SERVER decided, and a service that called
// it on values off a request would be asking the request for permission.
// -------------------------------------------------------------------
export function canEditProjectTasks(role: UserRole, isLead: boolean): boolean {
  return role === USER_ROLES.ADMIN || isLead;
}

// -------------------------------------------------------------------
// ===================================================================
// SHARED FIELD BUILDERS
// ===================================================================
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// An empty box means NULL, not ''.
//
// Both mean "nobody wrote anything", and storing both means every query and
// every component has to check for two versions of the same absence.
//
// NULL IS ACCEPTED HERE AS WELL AS ABSENT AND '', and it has to be. Every
// action in this module is TYPED on its Request (the schema's OUTPUT) DTO,
// so a component holds `string | null` for one of these fields and posts
// back exactly what it is holding - `notes: null` is what a create dialog
// with no note box sends. The schema refused that as "expected string,
// received null": a validation failure on a form with no field to report it
// against, which is as close to silent as a refusal gets.
//
// Accepting it is only safe because this builder is for a CREATE, where
// there is nothing yet to overwrite. The patch builder below refuses null
// for exactly that reason.
// -------------------------------------------------------------------
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value && value.length > 0 ? value : null));
}

// -------------------------------------------------------------------
// THE PATCH VERSION OF THE ABOVE, and the difference between the two is the
// difference between an edit that keeps somebody's note and one that
// deletes it.
//
// THREE STATES, AND ALL THREE ARE REACHABLE:
//
//   ABSENT       the key is not in the payload, and it is not in the parsed
//                output either. It means UNCHANGED. Kysely drops an
//                `undefined` out of a `set()` object, so a field nobody sent
//                never reaches the SQL and the stored text is untouched.
//   ''           an empty text box, which means CLEARED. It parses to NULL,
//                because the rule above still holds: '' and NULL are two
//                spellings of one absence and only one of them is stored.
//   'something'  the new value, trimmed.
//
// OPTIONAL IS NOT NULLABLE HERE. `notes: null` is REFUSED, and that is the
// point rather than an oversight. null is the spelling the callers of this
// module already reach for when they mean "I do not have this field to
// send" - a board card carries no description, a timesheet cell carries no
// note - and reading it as "delete what is stored" is the whole bug these
// builders close. Refusing it makes the COMPILER name every caller that has
// to decide between omitting the field and clearing it, instead of leaving
// the decision to whoever reads the diff.
//
// (A payload that spells the key out as `undefined` rather than omitting it
// lands with the key present and holding undefined. Absent and
// present-but-undefined behave identically everywhere downstream - both are
// dropped from the update - so the schema does not try to tell them apart.)
//
// THE `.optional()` GOES LAST, AFTER THE TRANSFORM, and the order is not
// cosmetic. Put in front of it, the transform has to handle `undefined`
// itself and Zod no longer reads the field as optional on the way OUT: the
// key comes back REQUIRED on the request type, holding `string | null |
// undefined`, so every caller has to spell out the very field it means to
// leave alone. Last, the optional short-circuits absence before the
// transform runs, and the key is optional on both sides - which is the
// difference between a patch type and a whole-row type with looser values.
// -------------------------------------------------------------------
function patchText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Please use no more than ${max} characters`)
    .transform((value) => (value.length > 0 ? value : null))
    .optional();
}

// A 'YYYY-MM-DD' that exists and sits inside the sane window. Compared
// lexicographically, which is valid for this format and is how the rest of
// the app compares calendar dates.
const calendarDateField = z
  .string()
  .trim()
  .regex(CALENDAR_DATE_PATTERN, "Use a date like 2026-07-01")
  .refine(isCalendarDate, "That date does not exist")
  .refine((value) => value >= MIN_CALENDAR_DATE && value <= MAX_CALENDAR_DATE, "That date looks wrong");

// -------------------------------------------------------------------
// Hours in, integer minutes out.
//
// `z.coerce.number()` because a form field arrives as a string. The finite
// check comes first so "abc" is reported as "enter a number" rather than as
// a range error on NaN.
// -------------------------------------------------------------------
function plannedHoursField(message: string) {
  return z.coerce
    .number()
    .refine((value) => Number.isFinite(value), message)
    .min(0, "Hours cannot be negative")
    .max(MAX_PLANNED_HOURS, `Please enter no more than ${MAX_PLANNED_HOURS} hours`)
    .transform(hoursToMinutes);
}

// The hours on ONE time entry. Bounded by the day the database will accept,
// and rejected after conversion if it rounds away to nothing: 0.004 hours is
// a quarter of a minute, which stores as 0 and violates minutes > 0.
const entryHoursField = z.coerce
  .number()
  .refine((value) => Number.isFinite(value), "Enter a number of hours")
  .max(MAX_ENTRY_HOURS, `One entry cannot be longer than ${MAX_ENTRY_HOURS} hours`)
  .transform(hoursToMinutes)
  .refine((minutes) => minutes >= 1, "Enter at least a minute")
  .refine((minutes) => minutes <= MAX_ENTRY_MINUTES, `One entry cannot be longer than ${MAX_ENTRY_HOURS} hours`);

// -------------------------------------------------------------------
// Dollars in, integer cents out.
//
// At most two decimal places: $150.505 is a typo rather than a rate, and
// rounding it silently buries the mistake in the money instead of showing it
// to the person typing.
//
// This deliberately repeats the same three rules as `dollars` in
// admin-timesheets-rate.types.ts rather than importing them. That file is
// another feature's boundary, and the Jira-era rate table it validates for
// is keyed on an Atlassian account id while `user_rates` is keyed on
// users(id) - two schemas that happen to agree today, not one schema shared
// by two owners.
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// null IS MAPPED TO NaN SO THE REFINE BELOW REFUSES IT, and that one line
// is load-bearing.
//
// z.coerce.number() runs Number(), and Number(null) is 0. Without this, a
// caller sending null - the obvious spelling of "no rate recorded" for
// anybody writing JSON rather than filling in a form - stored a rate of
// $0.00. A cost rate of nought reports 100% margin on every hour that
// person works, and a charge rate of nought reports the work as free.
// Neither is a near miss: both are entirely plausible figures sitting
// beside correct ones, which is the failure this module is written around.
//
// It is done HERE rather than in optionalDollarsField because both rates
// use this field, and because a zod union takes the first branch that
// SUCCEEDS - so an always-failing null branch in that union does not reject
// anything, it just falls through to the coercion. Learned the hard way.
//
// NaN rather than a thrown error, because the "Enter an amount" refine in
// the rules below is already the right message and already runs.
// -------------------------------------------------------------------
// The rules, over a number that has already been coerced. Split out so the
// null guard can sit in front of the coercion and the rules can still be
// written as one chain - `.preprocess()` does not return something `.min()`
// can be called on.
const dollarAmountRules = z
  .number()
  .refine((value) => Number.isFinite(value), "Enter an amount")
  .min(0, "A rate cannot be negative")
  .max(100_000, "That rate looks wrong")
  .refine((value) => {
    // Compared with a tolerance because this is float arithmetic: 150.5 * 100
    // is 15049.999999999998 on some inputs.
    const cents = value * 100;

    return Math.abs(cents - Math.round(cents)) < 1e-6;
  }, "Use at most two decimal places")
  .transform((value) => Math.round(value * 100));

const dollarsField = z
  .preprocess((value) => (value === null ? Number.NaN : value), z.coerce.number())
  .pipe(dollarAmountRules);

// -------------------------------------------------------------------
// Empty means "not recorded", which for a cost rate is a real answer:
// margin stays unknown rather than becoming 100%.
//
// "" IS THE ONE SPELLING OF ABSENCE THIS FIELD ACCEPTS, because it is what
// an empty text input actually sends. null and undefined are both refused -
// null by the guard on dollarsField above, which explains why - so a JSON
// caller cannot reach the coercion and have absence read as nought.
// -------------------------------------------------------------------
const optionalDollarsField = z
  .union([z.literal(""), dollarsField])
  .transform((value) => (value === "" ? null : value));

// -------------------------------------------------------------------
// The name a browser gives a file it is uploading.
//
// It arrives with whatever path the platform put in front of it - one browser
// sends "C:\fakepath\notes.pdf", another a bare name - so the path is
// stripped and the rest bounded HERE, which is the same normalisation the
// board service performs on the row it stores, from the same constant. A
// route that parses this hands over a name the service will not change.
//
// An empty result is REFUSED rather than renamed. The service falls back to
// "Attachment" because its handover type is not parsed from a payload and it
// has nobody to ask; a boundary does have somebody to ask, and "that file
// needs a name" beats a file appearing under a name nobody chose.
// -------------------------------------------------------------------
const attachmentFileNameField = z
  .string()
  .transform((value) => value.split(/[\\/]/).pop()?.trim().slice(0, ATTACHMENT_NAME_MAX_CHARS) ?? "")
  .refine((value) => value.length > 0, "That file needs a name");

// -------------------------------------------------------------------
// Which day the grid's week starts on, as one of the seven numbers
// WEEK_DAY_NUMBERS names.
//
// Coerced, because it reaches an action from a URL or a select as "1".
// REFUSED rather than defaulted when it is something else: a `weekStartsOn`
// of "Monday" is the exact mistake the numbering exists to prevent, and it
// would offset a grid by NaN days instead of failing.
// -------------------------------------------------------------------
const WEEK_DAY_NUMBER_VALUES = Object.values(WEEK_DAY_NUMBERS);

// NULL AND A BOOLEAN ARE KEPT AWAY FROM THE COERCION on purpose. Number(null)
// is 0, which is a legitimate Sunday, so a form posting null for "not chosen"
// would shift the whole grid by a day rather than taking the default - the
// one failure here that looks like a working screen.
const weekDayNumberField = z
  .union([z.number(), z.string()])
  .pipe(z.coerce.number())
  .pipe(z.literal(WEEK_DAY_NUMBER_VALUES));

// -------------------------------------------------------------------
// ===================================================================
// CLIENTS
// ===================================================================
// -------------------------------------------------------------------

// The name is unique case-insensitively in the database (`Perks` and `perks`
// both existing makes every report about either half right), so the service
// has to turn a unique violation into a sentence. Nothing here can check it.
export const CreateClientSchema = z.object({
  name: z.string().trim().min(1, "A client needs a name").max(CLIENT_NAME_MAX_CHARS),
  notes: optionalText(NOTE_MAX_CHARS),
});

// -------------------------------------------------------------------
// THE FIRST OF THE INPUT / REQUEST PAIRS, and the one place the caveat on
// all of them is written down.
//
// An `InputDTO` names the shape a FORM holds and a `RequestDTO` the shape
// the service receives. What an Input DTO does NOT do is type-check the
// form: on any field built from `z.coerce`, Zod's input type is `unknown` -
// `z.coerce.number()` is `ZodCoercedNumber<unknown>` - so
// `CreateTaskInputDTO["estimateHours"]` accepts an object, and the compiler
// says nothing. That is deliberate on Zod's part (coercion exists to take
// whatever a form posts) and it matches `SaveStaffRateInputDTO` in
// admin-timesheets-rate.types.ts, so it is inherited precedent rather than a
// defect here.
//
// The consequence to hold on to: the pair documents WHICH SIDE OF THE
// CONVERSION a value is on, and the conversion is still proved at run time
// by `safeParse` in the action. Do not read an Input DTO as a promise that
// the field was checked at compile time.
// -------------------------------------------------------------------
export type CreateClientInputDTO = z.input<typeof CreateClientSchema>;
export type CreateClientRequestDTO = z.output<typeof CreateClientSchema>;

// -------------------------------------------------------------------
// EDIT A CLIENT: rename it, change its notes, retire or restore it.
//
// `isActive` is the soft delete. There is no delete: projects reference
// clients ON DELETE RESTRICT precisely so that removing one cannot take
// billing history with it.
//
// A PATCH, NOT A WHOLE ROW, for the same reason as the two task schemas
// below. This required `name`, `notes` and `isActive` together, and
// ClientSummaryDTO - the shape the client LIST holds - carries no notes at
// all. So restoring a client from that list had to post `notes: null`
// alongside the name, and the restore wrote NULL over whatever somebody had
// stored. Nothing on screen said so.
//
// THE ALTERNATIVE WAS TO PUT `notes` ON ClientSummaryDTO, and it lost twice.
// It ships a note nobody renders to every row of a list and a picker, which
// is the one rule the DTO section states outright; and it fixes the restore
// by asking every future caller to remember to round-trip a field, where a
// patch fixes it in the shape. ClientDetailDTO already carries the notes for
// the form that actually edits them.
//
// RESTORE IS NOW `{ clientId, isActive: true }` and cannot touch the name or
// the notes even from a form read ten minutes ago. Retiring stays on
// DeactivateClientSchema below: a button that says "retire" should not be
// able to rename anybody either.
// -------------------------------------------------------------------
export const UpdateClientSchema = z.object({
  clientId: clientIdSchema,
  // Absent leaves the name alone; present, it must still be a real name.
  name: z.string().trim().min(1, "A client needs a name").max(CLIENT_NAME_MAX_CHARS).optional(),
  // Absent keeps the stored note, '' clears it. See patchText.
  notes: patchText(NOTE_MAX_CHARS),
  isActive: z.boolean().optional(),
});

export type UpdateClientInputDTO = z.input<typeof UpdateClientSchema>;
export type UpdateClientRequestDTO = z.output<typeof UpdateClientSchema>;

// -------------------------------------------------------------------
// Retire a client, without touching its name or its notes.
//
// A NARROW MUTATION BESIDE A WIDE ONE, deliberately. UpdateClientSchema
// carries `isActive` and can already do this, but it carries the name and the
// notes as well - so a screen that only wants to retire somebody has to post
// those back unchanged, and a stale form renames the client as a side effect
// of a button that says "deactivate". There is still no delete: projects
// reference clients ON DELETE RESTRICT precisely so that removing one cannot
// take billing history with it, and this is what "gone" means instead.
//
// THE FIVE MOVED SHAPES KEEP THEIR NAMES. This one and the four below it
// (archive a project; add, change and remove one member) were declared in
// delivery-setup.service.ts as placeholder types with no validator, so they
// arrive here already imported under those names by the services that call
// them. Renaming them to this file's `...RequestDTO` convention would be
// churn across three files for a shape the schema above it now proves either
// way.
// -------------------------------------------------------------------
export const DeactivateClientSchema = z.object({
  clientId: clientIdSchema,
});

export type DeactivateClientRequest = z.infer<typeof DeactivateClientSchema>;

// -------------------------------------------------------------------
// ===================================================================
// PROJECTS
// ===================================================================
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// The client on a new project: picked, or typed.
//
// A DISCRIMINATED UNION rather than an optional pair, and the reason is that
// `clientId?` plus `clientName?` has four states of which two are wrong -
// both supplied, and neither. Those two are not typos a validator can
// describe: "which client did you mean" is a question about intent. With a
// union, exactly-one-of is a PARSE failure, so the service receives a value
// that cannot be ambiguous and needs no branch to check that it isn't.
//
// The cost is that the form has to carry a mode field. That is a fair trade:
// the form already has a mode, because the control is a combobox with a
// "create <name>" row in it and it knows which one was clicked.
// -------------------------------------------------------------------
export const ProjectClientSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("existing"),
    clientId: clientIdSchema,
  }),
  z.object({
    mode: z.literal("new"),
    // Created inline while setting up a project. The service resolves an
    // existing client with the same name rather than failing on the unique
    // index, because "Perks already exists" is not an error from the point of
    // view of somebody who just wants the project made.
    name: z.string().trim().min(1, "A client needs a name").max(CLIENT_NAME_MAX_CHARS),
  }),
]);

export type ProjectClientRequestDTO = z.infer<typeof ProjectClientSchema>;

// A project is created with no members. It is therefore invisible to
// everybody except an admin until SetProjectMembers runs, which is what the
// setup screen does next - and since an admin sees every project regardless
// of membership, there is no state here that locks anybody out.
//
// `status` is absent on purpose: a new project is active, and offering the
// choice invites somebody to create an archived one.
export const CreateProjectSchema = z.object({
  client: ProjectClientSchema,
  title: z.string().trim().min(1, "A project needs a title").max(PROJECT_TITLE_MAX_CHARS),
  description: optionalText(DESCRIPTION_MAX_CHARS),
  isBillable: z.boolean(),
});

export type CreateProjectInputDTO = z.input<typeof CreateProjectSchema>;
export type CreateProjectRequestDTO = z.output<typeof CreateProjectSchema>;

// The client cannot be changed here. Moving a project to another client would
// silently re-attribute every time entry already logged against it, which is
// billing history and belongs behind a deliberate, audited act rather than a
// dropdown on the edit form.
export const UpdateProjectSchema = z.object({
  projectId: projectIdSchema,
  title: z.string().trim().min(1, "A project needs a title").max(PROJECT_TITLE_MAX_CHARS),
  description: optionalText(DESCRIPTION_MAX_CHARS),
  isBillable: z.boolean(),
  // `archived` is the soft delete - see migration 016. There is no
  // DeleteProject schema, deliberately.
  status: z.enum(PROJECT_STATUSES),
});

export type UpdateProjectInputDTO = z.input<typeof UpdateProjectSchema>;
export type UpdateProjectRequestDTO = z.output<typeof UpdateProjectSchema>;

// Stops the one-time "assign your budget" nudge on the setup screen. A
// separate mutation because `budget_assigned_at` is never cleared: it records
// that somebody finished planning once, and it does not come back if an
// estimate later drops below the total again.
export const MarkProjectBudgetAssignedSchema = z.object({
  projectId: projectIdSchema,
});

export type MarkProjectBudgetAssignedRequestDTO = z.infer<typeof MarkProjectBudgetAssignedSchema>;

// -------------------------------------------------------------------
// Archive a project: the module's soft delete, as an act of its own.
//
// UpdateProjectSchema carries `status` and can already set it, which is why
// nothing was ever blocked for want of this - but it also carries the title,
// the description and the billable flag, so archiving through it means
// posting a whole form back, and a stale one quietly reverts somebody else's
// edit. There is no DeleteProject schema, deliberately: time entries hold
// tasks ON DELETE RESTRICT, so archiving is what removal means here.
// -------------------------------------------------------------------
export const ArchiveProjectSchema = z.object({
  projectId: projectIdSchema,
});

export type ArchiveProjectRequest = z.infer<typeof ArchiveProjectSchema>;

// -------------------------------------------------------------------
// Membership, posted as THE WHOLE SET rather than as add/remove deltas.
//
// Membership is the security boundary of this module, and the failure mode
// of a delta is a member who was removed on screen and is still in the
// table because one request of three was dropped. A complete set makes the
// database match what the person was looking at when they saved, and makes
// the write one transaction.
//
// A project with NO lead is allowed. It is the honest intermediate state
// while a lead is being replaced, and it is not a lock-out: an admin can
// always act on any project, and admins are who assign membership. The
// screen warns; the validator does not refuse.
// -------------------------------------------------------------------
export const SetProjectMembersSchema = z.object({
  projectId: projectIdSchema,
  members: z
    .array(
      z.object({
        userId: userIdSchema,
        // The second gate: only a lead creates or edits tasks.
        isLead: z.boolean(),
        // Which of this person's three rates applies, and it is a PER
        // PROJECT decision - the same consultant can be discounted for one
        // client and standard for another.
        rateBand: z.enum(RATE_BANDS),
      }),
    )
    .max(MAX_PROJECT_MEMBERS)
    .refine(
      (members) => new Set(members.map((member) => member.userId)).size === members.length,
      "Somebody appears twice in that list",
    ),
});

export type SetProjectMembersRequestDTO = z.infer<typeof SetProjectMembersSchema>;

// -------------------------------------------------------------------
// ONE MEMBER AT A TIME, beside the whole-set mutation above.
//
// The set stays what the setup screen posts, for the reason written above it.
// These three are for the places where the act really is about one person -
// the "add somebody" row, changing one member's band, the remove button
// beside their name - and what they give that a set cannot is the thing a set
// is worst at: a request naming ONE person cannot drop the other nine
// because the form was built from a read taken ten minutes ago.
//
// `isLead` and `rateBand` are the same two decisions the set carries. NONE of
// these ids is proof of anything: the service re-resolves the project against
// the session and its own role check before it writes a row.
// -------------------------------------------------------------------
export const AddProjectMemberSchema = z.object({
  projectId: projectIdSchema,
  userId: userIdSchema,
  // The second gate: only a lead creates or edits tasks. The rule itself is
  // canEditProjectTasks above.
  isLead: z.boolean(),
  // Which of this person's three rates applies, and it is a PER PROJECT
  // decision - the same consultant can be discounted for one client and
  // standard for another.
  rateBand: z.enum(RATE_BANDS),
});

export type AddProjectMemberRequest = z.infer<typeof AddProjectMemberSchema>;

// The same four fields, and the same schema - but an UPDATE is a different
// act from an ADD, because one expects a membership row to exist and the
// other expects it not to, and the two services answer differently when they
// are wrong. Two names over one shape is what keeps "already a member" and
// "not a member yet" as separate refusals instead of one vague sentence.
export const UpdateProjectMemberSchema = AddProjectMemberSchema;

export type UpdateProjectMemberRequest = z.infer<typeof UpdateProjectMemberSchema>;

// No band and no lead flag. Removal is about the person, and carrying either
// would invite a caller to think a membership can be half-removed.
export const RemoveProjectMemberSchema = z.object({
  projectId: projectIdSchema,
  userId: userIdSchema,
});

export type RemoveProjectMemberRequest = z.infer<typeof RemoveProjectMemberSchema>;

// -------------------------------------------------------------------
// ===================================================================
// PHASES
// ===================================================================
// -------------------------------------------------------------------

export const CreatePhaseSchema = z.object({
  projectId: projectIdSchema,
  name: z.string().trim().min(1, "A phase needs a name").max(PHASE_NAME_MAX_CHARS),
});

export type CreatePhaseRequestDTO = z.infer<typeof CreatePhaseSchema>;

export const RenamePhaseSchema = z.object({
  phaseId: phaseIdSchema,
  name: z.string().trim().min(1, "A phase needs a name").max(PHASE_NAME_MAX_CHARS),
});

export type RenamePhaseRequestDTO = z.infer<typeof RenamePhaseSchema>;

// -------------------------------------------------------------------
// Reordering sends the FULL ordered list, and `position` is the index.
//
// The alternative - "move phase X to position 3" - has to be interpreted
// against whatever the server currently holds, and two people dragging at
// once resolve it differently. A complete list is idempotent: replaying it
// produces the same order, and the last save wins cleanly instead of
// interleaving.
//
// The project id travels with it so the service can check every phase
// belongs to the project it claims, in one query rather than one per phase.
// -------------------------------------------------------------------
export const ReorderPhasesSchema = z.object({
  projectId: projectIdSchema,
  phaseIds: z
    .array(phaseIdSchema)
    .min(1)
    .max(MAX_PHASES_PER_PROJECT)
    .refine((ids) => new Set(ids).size === ids.length, "A phase appears twice in that order"),
});

export type ReorderPhasesRequestDTO = z.infer<typeof ReorderPhasesSchema>;

// Deleting a phase cascades to its tasks, and `time_entries` references
// tasks ON DELETE RESTRICT - so a phase with logged time cannot be deleted.
// The SERVICE has to say that in a sentence before Postgres says it as a
// constraint violation.
export const DeletePhaseSchema = z.object({
  phaseId: phaseIdSchema,
});

export type DeletePhaseRequestDTO = z.infer<typeof DeletePhaseSchema>;

// -------------------------------------------------------------------
// ===================================================================
// TASKS
// ===================================================================
// -------------------------------------------------------------------

// The task carries `phase_id` and the service derives `project_id` from the
// phase. The client does NOT send a project id: it would be a second claim
// about the same fact, and the composite foreign key on (phase_id,
// project_id) exists so the two can never disagree.
export const CreateTaskSchema = z.object({
  phaseId: phaseIdSchema,
  title: z.string().trim().min(1, "A task needs a title").max(TASK_TITLE_MAX_CHARS),
  description: optionalText(DESCRIPTION_MAX_CHARS),
  // The initial estimate. Every LATER change goes through
  // AdjustTaskEstimateSchema so it lands in the append-only log.
  estimateHours: plannedHoursField("Enter a number of hours"),
  // Optional: a task can exist before anybody is free to take it. The
  // service checks the assignee is a member of the project - assigning work
  // to somebody who cannot see the project is a silent dead end.
  assigneeId: userIdSchema.optional(),
  // Almost always the default. Present because a task created from a card in
  // another column should appear where the person is looking.
  boardColumn: z.enum(TASK_COLUMNS).default(TASK_COLUMNS.TODO),
});

export type CreateTaskInputDTO = z.input<typeof CreateTaskSchema>;
export type CreateTaskRequestDTO = z.output<typeof CreateTaskSchema>;

// -------------------------------------------------------------------
// NO ESTIMATE FIELD HERE, and that is the point of the file it is missing
// from.
//
// `estimate_changes` is append-only and signed. An estimate editable in
// place would leave the current number correct and the record of how it got
// there absent, which is exactly the case the log exists for: when a project
// goes over, the first question is what moved and who moved it. So changing
// an estimate is its own mutation - AdjustTaskEstimateSchema - and it stays
// out of this one however convenient the same form would be.
//
// A PATCH, NOT A WHOLE ROW. Every editable field is optional and ABSENT
// MEANS UNCHANGED:
//
//   title        absent leaves it; present, it must still be a real title.
//   description  absent leaves it; '' clears it; text replaces it.
//   assigneeId   absent leaves it; null unassigns; an id assigns.
//
// WHY IT CHANGED. This required `title` and `description`, so an edit form
// could only be built from a shape carrying both - and TaskCardDTO
// deliberately carries no description, because a hundred of them on a board
// would be a megabyte. An edit opened from a card therefore posted an empty
// box over whatever had been written, and reported success. The description
// is the one field on a task nobody re-reads until they need it, which is
// the worst possible field to lose quietly.
//
// `assigneeId` IS THE ONE FIELD WHERE NULL IS A VALUE rather than a refusal.
// Unassigning is a real edit and there is no empty-string spelling of it, so
// null has to mean something here - which is why it is `.nullable()
// .optional()` and not the patchText treatment. The service still checks the
// person is on the project: an id here is a claim, like every other id in
// this file.
//
// A patch naming nothing but the task is allowed and does nothing. It costs
// one `updated_at` and needs no rule of its own; refusing it would be a
// second thing to get right for a case no screen produces.
// -------------------------------------------------------------------
export const UpdateTaskSchema = z.object({
  taskId: taskIdSchema,
  title: z.string().trim().min(1, "A task needs a title").max(TASK_TITLE_MAX_CHARS).optional(),
  description: patchText(DESCRIPTION_MAX_CHARS),
  assigneeId: userIdSchema.nullable().optional(),
});

export type UpdateTaskInputDTO = z.input<typeof UpdateTaskSchema>;
export type UpdateTaskRequestDTO = z.output<typeof UpdateTaskSchema>;

// -------------------------------------------------------------------
// A drag, in one mutation: which phase, which column, which slot.
//
// All three travel together because a card can be dragged across phases as
// well as columns, and applying the move as two writes leaves a card
// momentarily in a phase-and-column pair nobody dropped it on.
//
// `position` is the index the card should end up at. The service rewrites
// its siblings, which migration 016 chose over fractional ordering: a column
// holds tens of cards, not thousands, and rewriting ten rows is cheaper than
// explaining fractional ordering to the next reader.
// -------------------------------------------------------------------
export const MoveTaskSchema = z.object({
  taskId: taskIdSchema,
  phaseId: phaseIdSchema,
  boardColumn: z.enum(TASK_COLUMNS),
  position: z.coerce.number().int("That is not a position").min(0).max(100_000),
});

export type MoveTaskInputDTO = z.input<typeof MoveTaskSchema>;
export type MoveTaskRequestDTO = z.output<typeof MoveTaskSchema>;

// A task with time logged against it cannot be deleted - `time_entries`
// holds it ON DELETE RESTRICT. Same as a phase: the service refuses in
// words, and offers to move the task to done instead.
export const DeleteTaskSchema = z.object({
  taskId: taskIdSchema,
});

export type DeleteTaskRequestDTO = z.infer<typeof DeleteTaskSchema>;

// -------------------------------------------------------------------
// ===================================================================
// TASK ATTACHMENTS
// ===================================================================
//
// A file on a card: metadata in Postgres, bytes in Azure Blob, streamed back
// through a download route and never handed out as a signed URL.
//
// TWO SHAPES, AND ONE DELIBERATE ABSENCE.
//
//   WHAT THE BROWSER SENDS BESIDE THE BYTES is a task and a file name. That
//   is UploadTaskAttachmentSchema, and it is validated like anything else
//   here.
//
//   THE BYTES THEMSELVES HAVE NO SCHEMA, and could not usefully have one.
//   The media type is DERIVED by sniffing them in the service, never taken
//   from the browser's `Content-Type` and never guessed from the name, and
//   the byte count is the length of what was actually written. A schema over
//   either would check a shape while proving nothing about the only thing
//   that matters - where the value came from - and would afterwards read as
//   the check that had been done. The download route serves the stored type
//   back behind `nosniff`, so accepting a browser's word for it is a
//   stored-XSS decision made in the wrong file.
//
//   (There was a third shape here, `TaskAttachmentUpload`, for a route that
//   wrote the blob and handed the service a type and a size to record. The
//   service takes the bytes now and does both itself, which is what let the
//   archived-project refusal happen BEFORE the write instead of never.)
//
// The delete and the download hold an ATTACHMENT id rather than a task id, so
// they share one schema: the row carries the task, the task carries the
// project, and the service authorises on that project. An id here is a claim,
// as everywhere else in this file.
// -------------------------------------------------------------------

// The two by-id reads on the board service: one task opened, and its files.
// Both answer a miss with notFound(), so this bounds an id and decides
// nothing about who may see what it names.
export const TaskIdSchema = z.object({
  taskId: taskIdSchema,
});

export type TaskIdRequestDTO = z.infer<typeof TaskIdSchema>;

// What a multipart upload carries BESIDE the bytes. Everything else about the
// stored row is derived server-side.
export const UploadTaskAttachmentSchema = z.object({
  taskId: taskIdSchema,
  fileName: attachmentFileNameField,
});

export type UploadTaskAttachmentInputDTO = z.input<typeof UploadTaskAttachmentSchema>;
export type UploadTaskAttachmentRequestDTO = z.output<typeof UploadTaskAttachmentSchema>;

// -------------------------------------------------------------------
// WHAT A CARD WILL TAKE, named here and DERIVED FROM ONE PLACE.
//
// All three come from src/lib/ai/attachment-formats.ts, which is chat's
// module, and the sharing is deliberate rather than incidental. That file
// holds the only tested byte-sniffer in the app: it proves a format from the
// header, measures an image in the same pass, and maps `html` to text/plain
// - which is what stops a file uploaded here and served back from this
// origin being stored XSS. A second allowlist would be a second answer to
// "may this be served inline", and the wrong one would not fail a test.
//
// SO THE CEILING IS CHAT'S DOCUMENT CAP, and it is aliased rather than
// re-chosen because inspectAttachment enforces its own limits regardless: a
// larger number here would be refused a layer down with a message about
// chat's cap, which is worse than being refused honestly. The route checks
// this before reading the body so an oversized upload is turned away without
// being buffered; the inspector is the real gate.
//
// IF A CARD EVER NEEDS TO CARRY MORE THAN THIS - a screen recording of a bug
// is the obvious one - the answer is a delivery-owned sniffer with its own
// allowlist and its own caps, NOT a bigger number here. The limits and the
// formats travel together, and splitting them is how a video ends up
// accepted by the route and rejected by the inspector.
// -------------------------------------------------------------------
export const MAX_TASK_ATTACHMENT_BYTES = MAX_DOCUMENT_BYTES;

/** For the file input's `accept`, which is a hint to the picker and never a check. */
export const TASK_ATTACHMENT_ACCEPT = AI_CHAT_ACCEPT_ATTRIBUTE;

/** Said on screen, so nobody discovers the allowlist by being refused. */
export const TASK_ATTACHMENT_ACCEPTED_SUMMARY = AI_CHAT_ACCEPTED_SUMMARY;

// Removing one file, and serving one back. One shape for both, because the id
// is the whole request in each case.
export const TaskAttachmentIdSchema = z.object({
  attachmentId: taskAttachmentIdSchema,
});

export type TaskAttachmentIdRequestDTO = z.infer<typeof TaskAttachmentIdSchema>;

// -------------------------------------------------------------------
// ===================================================================
// TIME
// ===================================================================
//
// NO RATE FIELDS IN EITHER SCHEMA, and that is not an omission. The rates on
// a time entry are SNAPSHOTS the service captures at the moment the time is
// logged, by looking up the person's band on this project and the rate in
// force on the work date. A client-supplied rate would be a client-supplied
// invoice.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// THERE IS NO userId HERE, AND THAT IS THE POINT.
//
// Time is logged by the person who did the work, always. This carried an
// optional userId for a while so that a lead could log on somebody's
// behalf, and it has been removed rather than left unused: an
// authorization branch nothing exercises is a branch nothing protects
// either, and this one guarded the most sensitive write in the module.
//
// It also removes a question the schema could not answer. An entry logged
// by a lead for a member is indistinguishable from the member's own unless
// the row records who typed it, so allowing it would have needed an
// entered_by column to stay auditable. Not allowing it needs nothing.
//
// The owner is resolved from the SESSION in the service. Nothing a caller
// sends can name somebody else, so there is no branch to get wrong.
// -------------------------------------------------------------------
export const LogTimeSchema = z.object({
  taskId: taskIdSchema,
  workDate: calendarDateField,
  hours: entryHoursField,
  notes: optionalText(NOTE_MAX_CHARS),
});

export type LogTimeInputDTO = z.input<typeof LogTimeSchema>;
export type LogTimeRequestDTO = z.output<typeof LogTimeSchema>;

// -------------------------------------------------------------------
// Editing an entry can move it to another DAY but not to another TASK.
//
// A different task can be a different project, and therefore a different
// rate band and a different snapshot - so "moving" one is deleting an entry
// and logging another, which is what the UI should make somebody do. The
// work date is editable because getting the day wrong is the ordinary
// mistake, and the service re-resolves the rate snapshot when it changes.
//
// A PATCH, NOT A WHOLE ROW, and the field that forced it is `notes`. This
// required all three, so editing an entry from a timesheet cell - which
// shows a total and holds no note - deleted the note the moment somebody
// corrected an hour. A time entry note is what a client's invoice narrative
// is written from, so that is somebody's billable explanation gone, with a
// success toast over it.
//
//   workDate  absent leaves the day, and therefore leaves the captured rate
//             snapshot untouched. That is not a new rule, it is the existing
//             one the service already applies ("re-resolve only when the day
//             moves") finally expressible in the request: an edit that never
//             mentions the day cannot restate an hour at today's rate.
//   hours     absent leaves the minutes.
//   notes     absent leaves the note; '' clears it. See patchText.
// -------------------------------------------------------------------
export const UpdateTimeEntrySchema = z.object({
  timeEntryId: timeEntryIdSchema,
  workDate: calendarDateField.optional(),
  hours: entryHoursField.optional(),
  notes: patchText(NOTE_MAX_CHARS),
});

export type UpdateTimeEntryInputDTO = z.input<typeof UpdateTimeEntrySchema>;
export type UpdateTimeEntryRequestDTO = z.output<typeof UpdateTimeEntrySchema>;

export const DeleteTimeEntrySchema = z.object({
  timeEntryId: timeEntryIdSchema,
});

export type DeleteTimeEntryRequestDTO = z.infer<typeof DeleteTimeEntrySchema>;

// -------------------------------------------------------------------
// ===================================================================
// THE TIMESHEET GRID'S TWO ENTRY POINTS
// ===================================================================
//
// TWO CALLS THAT WRITE NOTHING AND STILL NEED A BOUND. Opening a week takes a
// date and a list of empty rows; adding a row takes a task. Neither stores
// anything - there is no `timesheet_week_rows` table and an empty row is
// screen furniture - but both reach a query, and until these schemas existed
// neither could be driven from a control on a screen at all: the services
// take positional arguments and this file carried nothing for an action to
// validate them against.
//
// THE VALIDATION AND THE NORMALISATION MOVED HERE FROM THE SERVICE, which is
// where they belong. The week read was doing isCalendarDate plus the MIN/MAX
// window itself, and de-duplicating and capping the added rows, so the work
// was happening one layer too late for an action to do it at the boundary.
//
// THE SERVICE KEEPS ITS OWN TOLERANCE, AND THAT IS NOT A DUPLICATE. A week is
// keyed on the URL's own `?week=`, which somebody may have bookmarked, edited
// or been sent, and a bad one should land on THIS week rather than on an
// error - the same reasoning the transcription page applies to an unknown id.
// A page calls the service directly and gets that. An action gets this
// schema, and an action's caller is a control the app itself wrote: a date it
// made up is a bug worth reporting rather than one worth papering over.
// -------------------------------------------------------------------
export const TimesheetWeekSchema = z
  .object({
    // Any day in the week; normalised to the week's first day below.
    weekStart: calendarDateField,
    // Absent means the session user. THE SERVICE decides who may name
    // somebody else, and the answer there is narrow - admins only, not leads,
    // because a week is one person's time across every project they are on.
    userId: userIdSchema.optional(),
    // Tasks added to this week that have no time on them yet, handed back by
    // the browser holding them. Not proof of anything: every one is
    // re-authorised against the target's own membership.
    //
    // DE-DUPLICATED AND CAPPED RATHER THAN REFUSED. These ids are furniture
    // out of a store a browser has been carrying for weeks, not a field
    // somebody just filled in, so a stale list of sixty should open a working
    // week rather than fail one. The cap is what keeps the `in` list bounded,
    // and the service applies it again because a page calls the service
    // directly.
    addedTaskIds: z
      .array(taskIdSchema)
      .default([])
      .transform((taskIds) => [...new Set(taskIds)].slice(0, MAX_TIMESHEET_ADDED_ROWS)),
    weekStartsOn: weekDayNumberField.default(DEFAULT_WEEK_START),
  })
  .transform((request) => ({
    ...request,
    // NORMALISED THROUGH startOfWeek even when it parses, so a mid-week date
    // opens the week containing it instead of seven columns beginning on a
    // Wednesday. Idempotent - the start of a week is its own start - so the
    // service normalising again cannot move it.
    weekStart: startOfWeek(request.weekStart, request.weekStartsOn),
  }));

export type TimesheetWeekRequestDTO = z.output<typeof TimesheetWeekSchema>;

// -------------------------------------------------------------------
// The service's own parameter shape, moved off delivery-time.service.ts.
//
// IT IS NOT THE REQUEST DTO, and the difference is not cosmetic: the service
// takes `weekStart` positionally and the rest as options, so a page that
// already holds a date can call it without assembling a request. A parsed
// TimesheetWeekRequestDTO is assignable to this, which is what lets an action
// hand its validated value straight over.
// -------------------------------------------------------------------
export type TimesheetWeekOptions = {
  // Absent means the session user. Only an admin may name somebody else - see
  // the service's guard for why a lead cannot.
  userId?: string;
  // Tasks added to this week that have no time on them yet. Not proof of
  // anything: every one is re-authorised.
  addedTaskIds?: readonly string[];
  weekStartsOn?: WeekDayNumber;
};

// -------------------------------------------------------------------
// Add a row to the week.
//
// `weekStart` is here because the row comes back with seven empty cells in
// the week's own order, so the grid can render it beside rows that came from
// the week read without building cells of its own. It is normalised the same
// way, for the same reason.
//
// Whether the row is allowed at all is the service's answer, and there it is
// a refusal in words rather than a silent drop: the week read leaves out a
// row somebody may no longer log to, because an empty row is furniture, but
// here a person is asking for it and deserves to be told.
// -------------------------------------------------------------------
export const AddTimesheetRowSchema = z
  .object({
    taskId: taskIdSchema,
    weekStart: calendarDateField,
    // NO userId, for the same reason LogTimeSchema has none: a row is added
    // to your OWN week. It used to carry one, justified as matching who may
    // log time for somebody else, and that rule has gone.
    //
    // The timesheet WEEK read still takes a userId, and that is not an
    // inconsistency: an admin LOOKING at somebody's week is a different act
    // from writing to it, and is wanted for a rates conversation.
    weekStartsOn: weekDayNumberField.default(DEFAULT_WEEK_START),
  })
  .transform((request) => ({
    ...request,
    weekStart: startOfWeek(request.weekStart, request.weekStartsOn),
  }));

export type AddTimesheetRowRequestDTO = z.output<typeof AddTimesheetRowSchema>;

// The service's parameter shape, moved off delivery-time.service.ts. Same
// relationship to the schema above as TimesheetWeekOptions has to its own.
export type AddTimesheetRowOptions = {
  weekStartsOn?: WeekDayNumber;
};

// -------------------------------------------------------------------
// ===================================================================
// ESTIMATE ADJUSTMENTS
// ===================================================================
//
// Two shapes, because there are two different acts and only one of them is
// self-contained.
//
//   `project`  - the project's total goes up (or down). One row, `fromTaskId`
//                null, `minutes` signed.
//   `transfer` - the minutes come OUT of a named task. Two tasks change, and
//                it is the form that can hide an overrun, which is why
//                `estimate_changes` records where they came from.
//
// A discriminated union rather than a nullable `fromTaskId`, for the same
// reason as the project client: the transfer branch needs rules the other
// does not - the amount must be positive, and the source cannot be the
// destination - and expressing them on an optional field means writing
// "if this is present then" three times.
// -------------------------------------------------------------------

// Signed hours: a reduction is negative. Rejected if it rounds to zero
// minutes, mirroring `estimate_changes_not_zero` - an adjustment of nothing
// is an audit entry that records nothing.
const adjustmentHoursField = z.coerce
  .number()
  .refine((value) => Number.isFinite(value), "Enter a number of hours")
  .min(-MAX_PLANNED_HOURS, `Please enter no less than -${MAX_PLANNED_HOURS} hours`)
  .max(MAX_PLANNED_HOURS, `Please enter no more than ${MAX_PLANNED_HOURS} hours`)
  .transform(hoursToMinutes)
  .refine((minutes) => minutes !== 0, "Enter how many hours to add or remove");

export const AdjustTaskEstimateSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("project"),
    taskId: taskIdSchema,
    hours: adjustmentHoursField,
    reason: optionalText(NOTE_MAX_CHARS),
  }),
  z
    .object({
      source: z.literal("transfer"),
      taskId: taskIdSchema,
      // Possibly in another phase. The service checks it is in the same
      // PROJECT, because minutes cannot move between clients' budgets.
      fromTaskId: taskIdSchema,
      // Positive only: taking a negative amount out of another task is an
      // addition wearing a disguise, and it would record the transfer
      // backwards.
      hours: z.coerce
        .number()
        .refine((value) => Number.isFinite(value), "Enter a number of hours")
        .max(MAX_PLANNED_HOURS, `Please enter no more than ${MAX_PLANNED_HOURS} hours`)
        .transform(hoursToMinutes)
        .refine((minutes) => minutes >= 1, "Enter how many hours to transfer"),
      reason: optionalText(NOTE_MAX_CHARS),
    })
    // Mirrors `estimate_changes_not_self`, so it reads as a sentence rather
    // than as a constraint violation. Taking minutes from the task they are
    // being added to is a no-op dressed up as an audit entry.
    .refine((value) => value.fromTaskId !== value.taskId, {
      message: "Choose a different task to take the hours from",
      path: ["fromTaskId"],
    }),
]);

export type AdjustTaskEstimateInputDTO = z.input<typeof AdjustTaskEstimateSchema>;
export type AdjustTaskEstimateRequestDTO = z.output<typeof AdjustTaskEstimateSchema>;

// -------------------------------------------------------------------
// ===================================================================
// BUDGET GROUPS
// ===================================================================
//
// "These two interns have 400 hours between them; this principal has 50." A
// named bundle of specific people with a POOLED budget, per project.
// -------------------------------------------------------------------

// `position` is not settable. A new group is appended, and there is
// deliberately no reorder mutation yet: the order of two or three bundles on
// one report is not something anybody has asked to control, and a reorder
// schema with no screen behind it is a shape somebody later has to guess the
// meaning of.
export const CreateBudgetGroupSchema = z.object({
  projectId: projectIdSchema,
  name: z.string().trim().min(1, "A group needs a name").max(BUDGET_GROUP_NAME_MAX_CHARS),
  budgetHours: plannedHoursField("Enter a number of hours"),
});

export type CreateBudgetGroupInputDTO = z.input<typeof CreateBudgetGroupSchema>;
export type CreateBudgetGroupRequestDTO = z.output<typeof CreateBudgetGroupSchema>;

export const UpdateBudgetGroupSchema = z.object({
  groupId: budgetGroupIdSchema,
  name: z.string().trim().min(1, "A group needs a name").max(BUDGET_GROUP_NAME_MAX_CHARS),
  budgetHours: plannedHoursField("Enter a number of hours"),
});

export type UpdateBudgetGroupInputDTO = z.input<typeof UpdateBudgetGroupSchema>;
export type UpdateBudgetGroupRequestDTO = z.output<typeof UpdateBudgetGroupSchema>;

// The whole set again, same reasoning as project membership.
//
// ONE GROUP PER PERSON PER PROJECT is enforced by a unique index, so adding
// somebody who is already in a sibling group is a database error the service
// has to turn into "Ada is already in Interns". Nothing in this schema can
// see the sibling groups.
export const SetBudgetGroupMembersSchema = z.object({
  groupId: budgetGroupIdSchema,
  userIds: z
    .array(userIdSchema)
    .max(MAX_BUDGET_GROUP_MEMBERS)
    .refine((ids) => new Set(ids).size === ids.length, "Somebody appears twice in that list"),
});

export type SetBudgetGroupMembersRequestDTO = z.infer<typeof SetBudgetGroupMembersSchema>;

// Deleting a group cascades its membership rows and nothing else. The time
// logged by those people stays exactly where it is - it just stops being
// counted against a pool, and reappears as ungrouped on the report.
export const DeleteBudgetGroupSchema = z.object({
  groupId: budgetGroupIdSchema,
});

export type DeleteBudgetGroupRequestDTO = z.infer<typeof DeleteBudgetGroupSchema>;

// -------------------------------------------------------------------
// ===================================================================
// RATES
// ===================================================================
//
// An UPSERT, not an insert: `user_rates_one_per_band_per_day` is unique on
// (user_id, band, effective_from), so saving twice for the same day corrects
// the rate rather than adding a second one. Correcting a rate that has
// already been snapshotted onto time entries does NOT restate those entries -
// an hour is worth what it was worth when it was worked.
//
// Admin-only, in the service. Nothing in the schema or the schema's table
// stops a read.
// -------------------------------------------------------------------
export const SetUserRateSchema = z.object({
  userId: userIdSchema,
  band: z.enum(RATE_BANDS),
  // The date the rate applies FROM, not the date it was entered. Backdating
  // is the normal case when somebody sets rates up for the first time.
  effectiveFrom: calendarDateField,
  // Required: a row with no charge rate is not a rate.
  chargeRate: dollarsField,
  // Optional. Empty means nobody has recorded a cost, so margin stays
  // unknown rather than looking like 100%.
  costRate: optionalDollarsField,
});

export type SetUserRateInputDTO = z.input<typeof SetUserRateSchema>;
export type SetUserRateRequestDTO = z.output<typeof SetUserRateSchema>;

// -------------------------------------------------------------------
// Removing a rate ROW, not a rate: `user_rates` is a history, and deleting
// the row that starts on a date makes the previous one apply from that date
// again. It is how a mistyped effective date is undone.
//
// THE ID IS THE WHOLE REQUEST, and that is enough because it is not proof of
// anything: the service is admin-only and reads the row back to find out
// whose rate and which band it is before deleting it. Sending the user and
// the band alongside would be a second claim about the same row, and the two
// could disagree.
//
// Time entries already snapshotted at that rate are NOT restated - an hour
// is worth what it was worth when it was worked - so this cannot move money
// that has already been reported.
// -------------------------------------------------------------------
export const DeleteUserRateSchema = z.object({
  rateId: userRateIdSchema,
});

export type DeleteUserRateRequestDTO = z.infer<typeof DeleteUserRateSchema>;

// -------------------------------------------------------------------
// ===================================================================
// RESPONSE DTOs
// ===================================================================
//
// TWO RULES ACROSS ALL OF THEM.
//
// A DTO CARRIES NOTHING THE BROWSER HAS NO USE FOR. No `storageKey` - a blob
// address is an internal handle and shipping it invites somebody to try
// building a URL out of it. No description on a board card, because a card
// does not render one and a hundred of them would be a megabyte.
//
// MONEY IS ABSENT RATHER THAN NULL when the viewer may not see it. Null says
// "unknown", which is a real answer here - an unmodelled cost rate. An
// absent field says "not for you", and the two must not be confused: a
// margin shown as null because the reader is not an admin looks exactly like
// a margin nobody has costed. The same convention the chat timesheet tool
// uses for cost and margin.
// -------------------------------------------------------------------

/** A client in a picker. */
export type ClientOptionDTO = {
  id: string;
  name: string;
};

export type ClientSummaryDTO = ClientOptionDTO & {
  isActive: boolean;
  // What makes a client undeletable, so the screen can say so instead of
  // offering a button that always fails.
  projectCount: number;
};

export type ClientDetailDTO = ClientSummaryDTO & {
  notes: string | null;
  createdAt: Date;
};

// -------------------------------------------------------------------
// One project in the left-hand nav.
//
// `canEditTasks` is the viewer's own answer to "lead or admin", resolved
// server-side. It is deliberately not `isLead`: an admin is not a lead and
// can still edit, so a component deriving the rule from `isLead` plus a role
// would be a second copy of an authorization decision. One field, one place
// it is decided, and it is a convenience for the UI - the service checks
// again on every write.
// -------------------------------------------------------------------
export type ProjectSummaryDTO = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  status: ProjectStatus;
  isBillable: boolean;
  canEditTasks: boolean;
};

export type PhaseDTO = {
  id: string;
  name: string;
  position: number;
  taskCount: number;
  estimateMinutes: number;
  loggedMinutes: number;
};

// `email` is here to tell two people with the same name apart, which happens
// often enough in a member picker to be worth the field. `name` is nullable
// because this app DE-IDENTIFIES dormant accounts in place rather than
// deleting them, so a historical member can have no name and still hold a
// valid row.
export type ProjectMemberDTO = {
  userId: string;
  name: string | null;
  email: string | null;
  isLead: boolean;
  // The BAND, not a rate. Naming which of three tiers applies tells a member
  // nothing about what the client pays, and the report that does carry cents
  // is gated separately.
  rateBand: RateBand;
};

export type ProjectDetailDTO = {
  project: ProjectSummaryDTO;
  description: string | null;
  members: ProjectMemberDTO[];
  phases: PhaseDTO[];
  // Every task estimate against every minute logged. Present here so the
  // header can show the bar without loading the whole board.
  rollup: BudgetRollupDTO;
  // Null until somebody has finished planning once, and never cleared after
  // that - which is what stops the setup nudge coming back if an estimate is
  // later reduced.
  budgetAssignedAt: Date | null;
  createdAt: Date;
};

// -------------------------------------------------------------------
// One card on the board.
//
// `loggedMinutes` beside `estimateMinutes` is the whole reason a card is
// worth looking at, so both travel even though only one is stored on the
// task.
// -------------------------------------------------------------------
export type TaskCardDTO = {
  id: string;
  phaseId: string;
  title: string;
  boardColumn: TaskColumn;
  position: number;
  estimateMinutes: number;
  loggedMinutes: number;
  assigneeId: string | null;
  assigneeName: string | null;
  // For the paperclip. The names are not needed until the task is opened.
  attachmentCount: number;
};

// -------------------------------------------------------------------
// One column of one phase's board.
//
// ALL FOUR COLUMNS ARE ALWAYS PRESENT, in TASK_COLUMN_ORDER, even when
// empty. An empty column is a drop target: omit it and there is nowhere to
// drag the first card that ever gets blocked.
// -------------------------------------------------------------------
export type BoardColumnDTO = {
  column: TaskColumn;
  tasks: TaskCardDTO[];
};

export type BoardPhaseDTO = {
  phaseId: string;
  phaseName: string;
  position: number;
  // Length is always BOARD_COLUMN_COUNT.
  columns: BoardColumnDTO[];
};

export type BoardDTO = {
  projectId: string;
  canEditTasks: boolean;
  phases: BoardPhaseDTO[];
};

// -------------------------------------------------------------------
// One line of "my work": a card assigned to the signed-in person, from any
// project they are on.
//
// HERE RATHER THAN ON THE SERVICE, because a client component renders this
// list and a component importing a type out of a `server-only` module drags
// the module in with it. That is most of what this file is for.
//
// NO userId FIELD, and the absence is the guard showing through the shape:
// the actor is the session, and a list of somebody ELSE's work is a different
// screen with a different guard rather than a parameter on this one.
// `clientName` travels because "who is this for" is the first question a
// cross-project work list has to answer.
//
// WHICH cards is the service's decision and not the DTO's: done is left out
// because a work list is what remains, and archived projects are left out
// because archiving is the module's soft delete - while a COMPLETED project
// with open cards on it stays, since hiding those is how work goes missing.
// -------------------------------------------------------------------
export type MyWorkItemDTO = {
  taskId: string;
  title: string;
  boardColumn: TaskColumn;
  phaseName: string;
  projectId: string;
  projectTitle: string;
  clientName: string;
  estimateMinutes: number;
  loggedMinutes: number;
};

// Metadata only. The bytes live in Azure Blob and are streamed back through a
// download route, never handed out as a signed URL - the same decision chat
// attachments made, for the same reason: a signed URL is a bearer token that
// outlives the session check that produced it.
export type TaskAttachmentDTO = {
  id: string;
  fileName: string;
  // Server-derived from the bytes, never the browser's Content-Type.
  mediaType: string;
  byteSize: number;
  uploadedByName: string | null;
  createdAt: Date;
};

// -------------------------------------------------------------------
// One time entry, as any member of the project sees it.
//
// NO RATES AND NO VALUE. Effort is project information; price is not, and
// the only DTO carrying cents is the budget report, which is gated on its
// own. Adding a value here would leak a client's rate card to everybody who
// can open a task.
// -------------------------------------------------------------------
export type TimeEntryDTO = {
  id: string;
  taskId: string;
  userId: string;
  userName: string | null;
  // 'YYYY-MM-DD'.
  workDate: string;
  minutes: number;
  notes: string | null;
  createdAt: Date;
};

// -------------------------------------------------------------------
// One line of the append-only estimate log, AS THE TASK BEING VIEWED SEES
// IT.
//
// A transfer writes ONE row, keyed to the RECEIVING task with `from_task_id`
// naming the source - so the same row is part of two tasks' histories, and
// the history query reads `ec.task_id = $1 OR ec.from_task_id = $1`. The
// task that GAVE the minutes away has to be able to explain where its
// estimate went, and before this it could not: the row it needed was filed
// under the other task.
//
// `direction` is which side this line was read from. `in` means the minutes
// arrived (an adjustment against the project's total, or a transfer landing
// here); `out` means they left for `counterpartTaskTitle`.
//
// `minutes` IS SIGNED FROM THIS TASK'S POINT OF VIEW, which is why the
// direction is not merely decoration: the stored amount on a transfer is
// positive because it describes the receiver, and handing that number
// straight to the source's history would render minutes leaving as minutes
// added. Whoever maps the row NEGATES it for an `out` line. That keeps the
// property the log is read for - the lines sum to the difference between
// this task's original estimate and its current one - true on both sides.
//
// THE ALTERNATIVE, and why it lost: carry the amount exactly as stored and
// let each component consult `direction` before printing it. Every surface
// that forgot would show a plausible positive number under an overrun, and
// this module's whole rule about the arithmetic being finished before
// anything renders exists to stop that.
//
// `counterpartTaskId` / `counterpartTaskTitle` replace the old
// `fromTaskId` / `fromTaskTitle` pair, which could only name the source.
// On an `out` line the interesting task is the RECEIVER, and a field called
// `fromTaskId` holding the task you are looking at is a fact about nothing.
// Both are null on an adjustment, and the title is null when the other task
// has since been deleted - `from_task_id` is ON DELETE SET NULL, and a line
// with less to say still belongs in the record. The title travels with the
// id because naming the other end IS the point of showing a transfer, and a
// round trip per line would make the history the slowest part of the page.
// -------------------------------------------------------------------
export type EstimateChangeDirection = "in" | "out";

export type EstimateChangeDTO = {
  id: string;
  minutes: number;
  reason: string | null;
  changedByName: string | null;
  createdAt: Date;
  direction: EstimateChangeDirection;
  counterpartTaskId: string | null;
  counterpartTaskTitle: string | null;
};

export type TaskDetailDTO = {
  task: TaskCardDTO;
  projectId: string;
  projectTitle: string;
  phaseName: string;
  description: string | null;
  attachments: TaskAttachmentDTO[];
  // Everybody's time on this task, not just the viewer's - a task's cost in
  // effort is what the panel is for.
  timeEntries: TimeEntryDTO[];
  estimateHistory: EstimateChangeDTO[];
  // Estimate against logged, for the bar on the panel.
  rollup: BudgetRollupDTO;
  canEditTasks: boolean;
};

// -------------------------------------------------------------------
// ===================================================================
// THE TIMESHEET WEEK
// ===================================================================
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// One entry behind one cell: enough to EDIT it, and nothing more.
//
// NO RATE, NO VALUE AND NO OWNER, which is the same line TimeEntryDTO holds
// and for the same reason - effort is project information and price is not,
// and a client's rate card must not reach everybody who can open a
// timesheet. The owner is absent because a week belongs to one person: the
// grid is already scoped to them, so a userId per cell would be a field that
// can only ever hold one value.
// -------------------------------------------------------------------
export type TimesheetCellEntryDTO = {
  id: string;
  minutes: number;
  notes: string | null;
};

// -------------------------------------------------------------------
// One day cell of one task's row.
//
// `entries` IS A LIST, and it has to be. There is no unique index on
// (task, user, day) - somebody can log an hour in the morning and another
// after lunch with different notes, and both are real entries. A cell
// therefore shows a TOTAL, and a caller that wants to edit in place can only
// do so when the list holds exactly one entry; two means opening the day.
//
// Modelling this as a single `entryId` would work until the second entry,
// then silently edit whichever row the query happened to return first.
//
// IT CARRIES THE ENTRIES AND NOT JUST THEIR IDS, which is what makes an edit
// possible at all. A cell used to hold `entryIds: string[]`, so a dialog
// opened on a day had the handles but neither the hours nor the notes behind
// them - it could not fill a form in, could not round-trip an edit, and the
// only honest thing left to offer was "clear the day and type it again".
// The ids are still here, one per entry; nothing needs a parallel array of
// them, and two lists that have to agree is how they stop agreeing.
// -------------------------------------------------------------------
export type TimesheetCellDTO = {
  // 'YYYY-MM-DD', and always equal to the week's `dates` entry at the same
  // index. Carried anyway so a cell can be passed to a handler on its own.
  date: string;
  // The total of `entries`, summed server-side so a footer and a cell cannot
  // disagree.
  minutes: number;
  entries: TimesheetCellEntryDTO[];
};

export type TimesheetRowDTO = {
  taskId: string;
  taskTitle: string;
  phaseName: string;
  projectId: string;
  projectTitle: string;
  clientName: string;
  // Seven cells, in the same order as the week's `dates`.
  days: TimesheetCellDTO[];
  totalMinutes: number;
};

// -------------------------------------------------------------------
// One person's week.
//
// There is no `previousWeekStart` / `nextWeekStart` here on purpose: both
// are `addCalendarDays(weekStart, -+7)`, the browser has the helper, and a
// DTO field that only ever restates an exported pure function is a second
// place for the same answer to be wrong.
// -------------------------------------------------------------------
export type TimesheetWeekDTO = {
  // Whose week. Present so a lead looking at somebody else's timesheet is
  // never in doubt about which one is on screen.
  userId: string;
  userName: string | null;
  weekStartsOn: WeekDayNumber;
  // 'YYYY-MM-DD', inclusive. `weekEnd` is derived but travels because it is
  // in the heading.
  weekStart: string;
  weekEnd: string;
  // Exactly DAYS_IN_WEEK entries, ascending.
  dates: string[];
  rows: TimesheetRowDTO[];
  // Column totals, same order and length as `dates`. Summed server-side so
  // the footer cannot disagree with the rows through a rounding difference.
  dayTotalMinutes: number[];
  totalMinutes: number;
};

// -------------------------------------------------------------------
// ===================================================================
// THE BUDGET REPORT
// ===================================================================
//
// The one DTO in this module that carries money, and the one whose shape
// depends on who is asking. See the note on money above: cost and margin are
// ABSENT for a non-admin, not null.
// -------------------------------------------------------------------

export type BudgetGroupReportDTO = {
  groupId: string;
  name: string;
  // Who shares the pool. The whole idea is "these two between them", so the
  // names are the label rather than a detail.
  members: { userId: string; name: string | null }[];
  rollup: BudgetRollupDTO;
  // Present when the viewer may see money at all. Null inside that means
  // genuinely unknown - a non-billable project has nothing to charge.
  chargeableCents?: number | null;
  // Admin only, and absent otherwise.
  costCents?: number | null;
  marginCents?: number | null;
};

export type BudgetReportDTO = {
  projectId: string;
  projectTitle: string;
  clientName: string;
  isBillable: boolean;
  // The project as a whole: every task estimate against every minute logged.
  // Not the sum of the groups - a group budget is a pool carved out of the
  // project, and people in no group log time too.
  project: BudgetRollupDTO;
  groups: BudgetGroupReportDTO[];
  // Time logged by people in no group. Its own line rather than folded into
  // the project total, because the interesting question about a pooled budget
  // is how much of the project it does NOT cover, and hiding the remainder
  // makes the groups look like they add up to the whole.
  ungrouped: BudgetRollupDTO;
  chargeableCents?: number | null;
  costCents?: number | null;
  marginCents?: number | null;
};

// -------------------------------------------------------------------
// ===================================================================
// RATES, AS THE ADMIN SCREEN READS THEM
// ===================================================================
//
// THE MONEY-BY-ABSENCE RULE DOES NOT APPLY TO THESE, and the reason is
// worth writing down rather than left looking like an inconsistency.
//
// Absence exists so ONE DTO can serve TWO audiences: the budget report is
// read by an admin now and is meant to be readable by a project lead later,
// and a margin omitted has to be distinguishable from a margin nobody has
// costed. A rate DTO has one audience. It is nothing but money, so a
// non-admin is refused the whole object rather than handed a hollow one -
// which is why the service that builds these guards on ADMIN with no
// viewer-dependent shape to decide.
//
// `costRateCents` is therefore nullable and ALWAYS PRESENT, and its null
// means what null means everywhere else in this file: nobody has recorded
// a cost, so margin is unknown rather than 100%.
// -------------------------------------------------------------------
export type UserRateDTO = {
  id: string;
  userId: string;
  band: RateBand;
  // 'YYYY-MM-DD', the date the rate applies FROM. Routinely in the past
  // (rates entered after the fact) and legitimately in the future ("the new
  // rate starts on 1 July"), so nothing may treat a later date as an error.
  effectiveFrom: string;
  chargeRateCents: number;
  costRateCents: number | null;
  updatedAt: Date;
};

// -------------------------------------------------------------------
// One person's row on the rates screen: what they are worth in each of the
// three bands, as at one date.
//
// ALL THREE BANDS ARE ALWAYS PRESENT, null where the person has no rate -
// the same decision BoardColumnDTO makes about empty columns, for the same
// reason. A missing key and a priced-at-nothing band look identical to a
// table that renders whatever it finds, and showing which bands are still
// blank is most of what this screen is for.
// -------------------------------------------------------------------
export type UserRateBandsDTO = {
  userId: string;
  // Nullable for the reason it is on ProjectMemberDTO: this app
  // DE-IDENTIFIES dormant accounts in place rather than deleting them, so
  // somebody with rate history can have no usable name and still hold a
  // valid row.
  name: string | null;
  // Here to tell two people with the same name apart, which is worth a
  // column on a screen where picking the wrong row misprices a client.
  email: string | null;
  // The ACCOUNT's status, so an admin can see that somebody deactivated
  // still has the rates behind the time they already logged.
  isActive: boolean;
  bands: Record<RateBand, UserRateDTO | null>;
};

export type UserRatesOverviewDTO = {
  // 'YYYY-MM-DD' in the APP timezone, and it travels because "current" is a
  // question about a day. A heading that cannot say which date it resolved
  // leaves a forward-dated rate looking like a missing one.
  asAtDate: string;
  people: UserRateBandsDTO[];
};

// One person's whole history, newest start date first and then by band -
// the order the repository imposes, because three bands can share a start
// date and an unordered pair reshuffles between loads.
export type UserRateHistoryDTO = {
  userId: string;
  name: string | null;
  email: string | null;
  rates: UserRateDTO[];
};

// -------------------------------------------------------------------
// WHAT DELETING A RATE ROW WILL DO, worked out BEFORE it is done.
//
// Deleting a rate does not restate history: a time entry snapshots the
// cents it was charged at, so nothing already reported moves. What it
// changes is what FUTURE entries resolve to - and because a rate is the
// greatest `effectiveFrom` on or before the work date and never a later
// one, removing the EARLIEST row of a band leaves a window of dates with no
// rate at all rather than falling forward onto the next one.
//
// THAT WINDOW IS INVISIBLE AFTERWARDS. An entry backdated into it comes
// back unvalued and no screen says the rate it needed was deleted. So the
// consequence is computed from the rows while they still exist and handed
// back: the confirmation dialog says it beforehand, and the delete returns
// the same shape so the act can be reported even if the dialog was skipped.
//
// `consequence` is a finished SENTENCE rather than three booleans for a
// component to assemble, on the same principle as the rest of this file -
// the arithmetic, and here the wording, is finished before anything renders
// it. Four surfaces phrasing this from the parts is four chances to get the
// off-by-one in the window wrong.
// -------------------------------------------------------------------
export type UserRateDeletionImpactDTO = {
  rate: UserRateDTO;
  personName: string | null;
  // True when this is the earliest row in its band. Then, and only then,
  // removing it leaves work dates with no rate.
  leavesGap: boolean;
  // 'YYYY-MM-DD': the earlier row that will apply instead. Null exactly
  // when `leavesGap` is true.
  fallsBackToEffectiveFrom: string | null;
  // The window that becomes unvalued, INCLUSIVE at both ends. Both null
  // unless `leavesGap`. `unvaluedTo` is null when there is no later row in
  // the band either, so the window is open-ended - the state a band is in
  // once its only rate is gone.
  unvaluedFrom: string | null;
  unvaluedTo: string | null;
  consequence: string;
};
