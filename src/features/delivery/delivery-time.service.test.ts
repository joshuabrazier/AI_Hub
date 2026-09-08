import { beforeEach, describe, expect, it, vi } from "vitest";

import { PROJECT_STATUSES, RATE_BANDS, USER_ROLES } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Logging time, the timesheet week and estimate changes, with everything
// below the service mocked.
//
// WHAT IS WORTH ASSERTING HERE IS THE JUDGEMENT, because every one of these
// fails silently in production and every one of them ends up on an invoice:
// whose id the service believes, which rate lands on the row, whether a
// blank stays blank rather than falling forward to a later rate, and
// whether minutes can leave a task that does not have them.
//
// The week arithmetic is NOT mocked - delivery.types.ts is pure and its
// helpers are the thing being relied on - so the seven dates in these
// assertions are real dates. 2026-06-15 is a Monday.
// -------------------------------------------------------------------

vi.mock("server-only", () => ({}));

// notFound() and unstable_rethrow both come from here. The second one is not
// optional: handleError calls it on every catch, so a missing mock makes
// every service in this file throw from the error handler rather than from
// the thing being tested.
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("better-auth", () => ({ generateId: () => "generated-id" }));

vi.mock("@/lib/auth/session-auth-server", () => ({ requireUser: vi.fn() }));

// Mocked so "today" is a fixed day in the app zone. The point of the guard
// is that it is NOT the server's clock, and a test that read the real one
// would pass on any machine while proving nothing.
vi.mock("@/lib/timezone", () => ({
  APP_TIME_ZONE: "Australia/Sydney",
  todayInAppZone: vi.fn(() => "2026-06-17"),
}));

vi.mock("@/lib/data/repositories/projects.repository", () => ({
  getProjectByIdRepo: vi.fn(),
  getProjectForMemberRepo: vi.fn(),
  getProjectIdsForUserRepo: vi.fn(),
  getProjectMemberRepo: vi.fn(),
}));

vi.mock("@/lib/data/repositories/tasks.repository", () => ({
  getTaskRepo: vi.fn(),
  getTasksByIdsRepo: vi.fn(),
}));

vi.mock("@/lib/data/repositories/time-entries.repository", () => ({
  addTimeEntryRepo: vi.fn(),
  adjustTaskEstimateRepo: vi.fn(),
  deleteTimeEntryRepo: vi.fn(),
  getTimeEntriesForUserInRangeRepo: vi.fn(),
  getTimeEntryByIdRepo: vi.fn(),
  transferTaskEstimateRepo: vi.fn(),
  updateTimeEntryRepo: vi.fn(),
}));

vi.mock("@/lib/data/repositories/user-rates.repository", () => ({ getUserRateAsAtRepo: vi.fn() }));

vi.mock("@/lib/data/repositories/users.repository", () => ({ getUserByUserIdRepo: vi.fn() }));

import { requireUser } from "@/lib/auth/session-auth-server";
import {
  getProjectByIdRepo,
  getProjectForMemberRepo,
  getProjectIdsForUserRepo,
  getProjectMemberRepo,
} from "@/lib/data/repositories/projects.repository";
import { getTaskRepo, getTasksByIdsRepo } from "@/lib/data/repositories/tasks.repository";
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

import {
  addTimesheetRowService,
  adjustTaskEstimateService,
  deleteTimeEntryService,
  getTimesheetWeekService,
  logTimeService,
  updateTimeEntryService,
} from "./delivery-time.service";
import type {
  AdjustTaskEstimateRequestDTO,
  LogTimeRequestDTO,
  UpdateTimeEntryRequestDTO,
} from "./delivery.types";

const mockRequireUser = vi.mocked(requireUser);
const mockGetProjectById = vi.mocked(getProjectByIdRepo);
const mockGetProjectForMember = vi.mocked(getProjectForMemberRepo);
const mockGetProjectIds = vi.mocked(getProjectIdsForUserRepo);
const mockGetProjectMember = vi.mocked(getProjectMemberRepo);
const mockGetTask = vi.mocked(getTaskRepo);
const mockGetTasksByIds = vi.mocked(getTasksByIdsRepo);
const mockAddEntry = vi.mocked(addTimeEntryRepo);
const mockAdjustEstimate = vi.mocked(adjustTaskEstimateRepo);
const mockDeleteEntry = vi.mocked(deleteTimeEntryRepo);
const mockEntriesInRange = vi.mocked(getTimeEntriesForUserInRangeRepo);
const mockGetEntry = vi.mocked(getTimeEntryByIdRepo);
const mockTransferEstimate = vi.mocked(transferTaskEstimateRepo);
const mockUpdateEntry = vi.mocked(updateTimeEntryRepo);
const mockGetRate = vi.mocked(getUserRateAsAtRepo);
const mockGetUser = vi.mocked(getUserByUserIdRepo);

// -------------------------------------------------------------------
// Fixtures. Cast rather than fully built: these stand in for database rows,
// and typing out every column of four tables would bury what each test is
// about.
// -------------------------------------------------------------------
type Unsafe = Parameters<typeof expect>[0];

const PROJECT_ID = "project-1";
const TASK_ID = "task-1";
const ACTOR_ID = "user-1";
const OTHER_ID = "user-2";

function sessionUser(role: (typeof USER_ROLES)[keyof typeof USER_ROLES], id = ACTOR_ID) {
  return { id, role, name: "Ada" } as Unsafe as Awaited<ReturnType<typeof requireUser>>;
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    title: "Data platform",
    clientName: "Perks",
    isBillable: true,
    status: PROJECT_STATUSES.ACTIVE,
    isLead: false,
    rateBand: RATE_BANDS.STANDARD,
    ...overrides,
  } as Unsafe as NonNullable<Awaited<ReturnType<typeof getProjectForMemberRepo>>>;
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    phaseId: "phase-1",
    projectId: PROJECT_ID,
    title: "Model the warehouse",
    estimateMinutes: 480,
    ...overrides,
  } as Unsafe as NonNullable<Awaited<ReturnType<typeof getTaskRepo>>>;
}

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    phaseId: "phase-1",
    projectId: PROJECT_ID,
    title: "Model the warehouse",
    phaseName: "Discovery",
    projectTitle: "Data platform",
    projectStatus: PROJECT_STATUSES.ACTIVE,
    clientId: "client-1",
    clientName: "Perks",
    ...overrides,
  } as Unsafe as Awaited<ReturnType<typeof getTasksByIdsRepo>>[number];
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "entry-1",
    taskId: TASK_ID,
    projectId: PROJECT_ID,
    userId: ACTOR_ID,
    workDate: "2026-06-16",
    minutes: 90,
    notes: null,
    chargeRateCents: 22_000,
    costRateCents: 9_000,
    createdAt: new Date("2026-06-16T09:00:00Z"),
    updatedAt: new Date("2026-06-16T09:00:00Z"),
    ...overrides,
  } as Unsafe as NonNullable<Awaited<ReturnType<typeof getTimeEntryByIdRepo>>>;
}

function rate(overrides: Record<string, unknown> = {}) {
  return {
    id: "rate-1",
    userId: ACTOR_ID,
    band: RATE_BANDS.STANDARD,
    chargeRateCents: 22_000,
    costRateCents: 9_000,
    effectiveFrom: "2026-01-01",
    ...overrides,
  } as Unsafe as NonNullable<Awaited<ReturnType<typeof getUserRateAsAtRepo>>>;
}

function logRequest(overrides: Partial<LogTimeRequestDTO> = {}): LogTimeRequestDTO {
  // `hours` holds MINUTES by the time a service sees it - the schema
  // converted it at the boundary.
  return { taskId: TASK_ID, workDate: "2026-06-16", hours: 90, notes: null, ...overrides };
}

/** A member of the project who is not a lead - the ordinary case. */
function signedInAsMember(isLead = false) {
  mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.MEMBER));
  mockGetProjectForMember.mockResolvedValue(project({ isLead }));
}

function signedInAsAdmin() {
  mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.ADMIN, "admin-1"));
  // An admin holds no membership row and must not be refused for it.
  mockGetProjectForMember.mockResolvedValue(undefined);
  mockGetProjectById.mockResolvedValue(
    project() as Unsafe as NonNullable<Awaited<ReturnType<typeof getProjectByIdRepo>>>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();

  mockGetTask.mockResolvedValue(task());
  mockGetTasksByIds.mockResolvedValue([]);
  mockEntriesInRange.mockResolvedValue([]);
  mockGetProjectIds.mockResolvedValue([PROJECT_ID]);
  mockGetProjectMember.mockResolvedValue(undefined);
  mockGetRate.mockResolvedValue(rate());
  mockGetUser.mockResolvedValue(undefined);
  mockAddEntry.mockResolvedValue(entry() as Unsafe as Awaited<ReturnType<typeof addTimeEntryRepo>>);
  mockUpdateEntry.mockResolvedValue(entry());
  mockDeleteEntry.mockResolvedValue(1);
});

describe("logTimeService", () => {
  it("refuses a work date in the future, decided in the app zone", async () => {
    signedInAsMember();

    // The day after the mocked "today". A pure schema cannot refuse this,
    // which is the whole reason the check lives in the service.
    await expect(logTimeService(logRequest({ workDate: "2026-06-18" }))).rejects.toThrow(
      /has not happened yet/,
    );

    expect(mockAddEntry).not.toHaveBeenCalled();
  });

  it("accepts today", async () => {
    signedInAsMember();

    await logTimeService(logRequest({ workDate: "2026-06-17" }));

    expect(mockAddEntry).toHaveBeenCalled();
  });

  it("captures the charge and cost rates in force on the WORK DATE", async () => {
    signedInAsMember();

    await logTimeService(logRequest());

    // The person's band on THIS project, as at the day worked - not today.
    expect(mockGetRate).toHaveBeenCalledWith(ACTOR_ID, RATE_BANDS.STANDARD, "2026-06-16");
    expect(mockAddEntry).toHaveBeenCalledWith(
      expect.objectContaining({ chargeRateCents: 22_000, costRateCents: 9_000, minutes: 90 }),
    );
  });

  it("stores NULL rates rather than falling forward when no rate was effective yet", async () => {
    signedInAsMember();
    // The resolver's answer for work done before somebody's earliest rate.
    mockGetRate.mockResolvedValue(null);

    await logTimeService(logRequest());

    expect(mockAddEntry).toHaveBeenCalledWith(
      expect.objectContaining({ chargeRateCents: null, costRateCents: null }),
    );
  });

  it("charges nothing on a non-billable project and still records the cost", async () => {
    mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.MEMBER));
    mockGetProjectForMember.mockResolvedValue(project({ isBillable: false }));

    await logTimeService(logRequest());

    expect(mockAddEntry).toHaveBeenCalledWith(
      expect.objectContaining({ chargeRateCents: null, costRateCents: 9_000 }),
    );
  });

  it("logs the SESSION user's time, whatever else is in the payload", async () => {
    // Time is logged by the person who did the work, always. A lead used to
    // be able to log on somebody's behalf and that capability has gone, so
    // the property to hold is now stronger than "the role was checked
    // first": there is nothing a caller can send that names anybody.
    //
    // Passed through an unknown-shaped payload rather than a typed one on
    // purpose. LogTimeSchema no longer has the field, so a typed fixture
    // could not express the attack, and a service that started reading a
    // stray userId again would not be caught by a test that cannot send
    // one. This is what a hand-rolled fetch to the action could carry.
    signedInAsMember(true);

    await logTimeService({ ...logRequest(), userId: OTHER_ID } as Unsafe as LogTimeRequestDTO);

    expect(mockAddEntry).toHaveBeenCalledWith(expect.objectContaining({ userId: ACTOR_ID }));
    // And nothing was looked up about the named account, so there is not
    // even a probe here: no membership read means no way to learn whether
    // that person is on the project.
    expect(mockGetProjectMember).not.toHaveBeenCalled();
    expect(mockGetRate).toHaveBeenCalledWith(ACTOR_ID, RATE_BANDS.STANDARD, "2026-06-16");
  });

  it("refuses an admin who is not on the project, rather than logging an unvalued hour", async () => {
    signedInAsAdmin();

    await expect(logTimeService(logRequest())).rejects.toThrow(/no rate band/);
    expect(mockAddEntry).not.toHaveBeenCalled();
  });

  it("gives a non-member the SAME answer as a task that does not exist", async () => {
    // THE SAMENESS IS THE TEST, not the wording. Saying "forbidden" to a
    // guessed id confirms the record exists and turns the route into an
    // enumeration oracle, so both misses have to be indistinguishable.
    //
    // And it is a SENTENCE rather than notFound(), because this is reached
    // through a server action and handleError calls unstable_rethrow - a
    // notFound() thrown here propagates and replaces the timesheet with the
    // not-found page on an ordinary race. One message covering both "gone"
    // and "not yours" leaks exactly what a 404 leaks.
    mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.MEMBER));
    mockGetProjectForMember.mockResolvedValue(undefined);

    const notAMember = await logTimeService(logRequest()).catch((error: Error) => error.message);

    mockGetProjectForMember.mockResolvedValue(project());
    mockGetTask.mockResolvedValue(undefined);

    const noSuchTask = await logTimeService(logRequest()).catch((error: Error) => error.message);

    expect(notAMember).toMatch(/no longer available/);
    // Pinned to each other rather than to a literal, so a future change to
    // one message cannot quietly reintroduce the difference.
    expect(noSuchTask).toBe(notAMember);
  });

  it("takes the project from the TASK, never from the request", async () => {
    signedInAsMember();
    mockGetTask.mockResolvedValue(task({ projectId: "project-9" }));
    mockGetProjectForMember.mockResolvedValue(project({ id: "project-9" }));

    await logTimeService(logRequest());

    expect(mockAddEntry).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-9" }));
  });

  it("refuses to log against an archived project", async () => {
    mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.MEMBER));
    mockGetProjectForMember.mockResolvedValue(project({ status: PROJECT_STATUSES.ARCHIVED }));

    await expect(logTimeService(logRequest())).rejects.toThrow(/archived/);
  });
});

describe("updateTimeEntryService", () => {
  function updateRequest(overrides: Partial<UpdateTimeEntryRequestDTO> = {}): UpdateTimeEntryRequestDTO {
    return { timeEntryId: "entry-1", workDate: "2026-06-16", hours: 120, notes: "Reviewed", ...overrides };
  }

  it("leaves the rate snapshot alone when the day has not moved", async () => {
    signedInAsMember();
    mockGetEntry.mockResolvedValue(entry());

    await updateTimeEntryService(updateRequest());

    expect(mockGetRate).not.toHaveBeenCalled();
    const patch = mockUpdateEntry.mock.calls[0][2];
    expect(patch).not.toHaveProperty("chargeRateCents");
    expect(patch).not.toHaveProperty("costRateCents");
  });

  it("re-resolves the snapshot as at the NEW day when the entry moves", async () => {
    signedInAsMember();
    mockGetEntry.mockResolvedValue(entry());
    mockGetRate.mockResolvedValue(rate({ chargeRateCents: 25_000, costRateCents: 10_000 }));

    await updateTimeEntryService(updateRequest({ workDate: "2026-06-15" }));

    expect(mockGetRate).toHaveBeenCalledWith(ACTOR_ID, RATE_BANDS.STANDARD, "2026-06-15");
    expect(mockUpdateEntry).toHaveBeenCalledWith(
      "entry-1",
      PROJECT_ID,
      expect.objectContaining({ chargeRateCents: 25_000, costRateCents: 10_000 }),
    );
  });

  it("re-prices at the OWNER's band, not the lead's, when a lead moves somebody's day", async () => {
    signedInAsMember(true);
    mockGetEntry.mockResolvedValue(entry({ userId: OTHER_ID }));
    mockGetProjectMember.mockResolvedValue({
      projectId: PROJECT_ID,
      userId: OTHER_ID,
      isLead: false,
      rateBand: RATE_BANDS.HIGH,
    } as Unsafe as NonNullable<Awaited<ReturnType<typeof getProjectMemberRepo>>>);

    await updateTimeEntryService(updateRequest({ workDate: "2026-06-15" }));

    expect(mockGetRate).toHaveBeenCalledWith(OTHER_ID, RATE_BANDS.HIGH, "2026-06-15");
  });

  it("keeps the captured cents when the owner is no longer on the project", async () => {
    signedInAsMember(true);
    mockGetEntry.mockResolvedValue(entry({ userId: OTHER_ID }));
    // Taken off the project since, so there is no band to resolve.
    mockGetProjectMember.mockResolvedValue(undefined);

    await updateTimeEntryService(updateRequest({ workDate: "2026-06-15" }));

    expect(mockGetRate).not.toHaveBeenCalled();
    const patch = mockUpdateEntry.mock.calls[0][2];
    expect(patch).not.toHaveProperty("chargeRateCents");
  });

  it("refuses a future day on an edit too", async () => {
    signedInAsMember();
    mockGetEntry.mockResolvedValue(entry());

    await expect(updateTimeEntryService(updateRequest({ workDate: "2026-07-01" }))).rejects.toThrow(
      /has not happened yet/,
    );
  });

  it("stops an ordinary member editing somebody else's entry, and lets a lead", async () => {
    signedInAsMember();
    mockGetEntry.mockResolvedValue(entry({ userId: OTHER_ID }));

    await expect(updateTimeEntryService(updateRequest())).rejects.toThrow(/only change your own time/);

    signedInAsMember(true);
    mockGetEntry.mockResolvedValue(entry({ userId: OTHER_ID }));

    await updateTimeEntryService(updateRequest());
    expect(mockUpdateEntry).toHaveBeenCalled();
  });

  it("scopes the write to the project the caller was authorised against", async () => {
    signedInAsMember();
    mockGetEntry.mockResolvedValue(entry());

    await updateTimeEntryService(updateRequest());

    expect(mockUpdateEntry).toHaveBeenCalledWith("entry-1", PROJECT_ID, expect.anything());
  });
});

describe("deleteTimeEntryService", () => {
  it("scopes the delete by project and reports a row that had already gone", async () => {
    signedInAsMember();
    mockGetEntry.mockResolvedValue(entry());
    mockDeleteEntry.mockResolvedValue(0);

    // ONE message for both misses, and that is the point rather than a
    // wording change. The service used to answer notFound() for the read
    // miss and a different sentence for the identical zero-rows race, so
    // two tabs deleting the same entry got two different outcomes. Asserting
    // the shared constant is what stops them diverging again.
    await expect(deleteTimeEntryService({ timeEntryId: "entry-1" })).rejects.toThrow(
      /no longer available/,
    );
    expect(mockDeleteEntry).toHaveBeenCalledWith("entry-1", PROJECT_ID);
  });

  it("is allowed on an archived project, because a wrong number must be removable", async () => {
    mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.MEMBER));
    mockGetProjectForMember.mockResolvedValue(project({ status: PROJECT_STATUSES.ARCHIVED }));
    mockGetEntry.mockResolvedValue(entry());

    await deleteTimeEntryService({ timeEntryId: "entry-1" });

    expect(mockDeleteEntry).toHaveBeenCalled();
  });
});

describe("getTimesheetWeekService", () => {
  it("returns seven days from the Monday of the week the date falls in", async () => {
    signedInAsMember();

    // A Wednesday. The grid must still start on its Monday.
    const week = await getTimesheetWeekService("2026-06-17");

    expect(week.weekStart).toBe("2026-06-15");
    expect(week.weekEnd).toBe("2026-06-21");
    expect(week.dates).toEqual([
      "2026-06-15",
      "2026-06-16",
      "2026-06-17",
      "2026-06-18",
      "2026-06-19",
      "2026-06-20",
      "2026-06-21",
    ]);
    expect(mockEntriesInRange).toHaveBeenCalledWith(ACTOR_ID, "2026-06-15", "2026-06-21");
  });

  it("falls back to the current week when the date is rubbish, rather than throwing", async () => {
    signedInAsMember();

    const week = await getTimesheetWeekService("2026-02-31");

    expect(week.weekStart).toBe("2026-06-15");
  });

  it("builds rows from the ENTRIES, totals a day with two entries, and lists both ids", async () => {
    signedInAsMember();
    mockEntriesInRange.mockResolvedValue([
      entry({ id: "entry-1", workDate: "2026-06-16", minutes: 60 }),
      entry({ id: "entry-2", workDate: "2026-06-16", minutes: 30 }),
      entry({ id: "entry-3", workDate: "2026-06-18", minutes: 45 }),
    ]);
    mockGetTasksByIds.mockResolvedValue([taskRow()]);

    const week = await getTimesheetWeekService("2026-06-15");

    expect(week.rows).toHaveLength(1);
    expect(week.rows[0].days[1]).toEqual({ date: "2026-06-16", minutes: 90, entryIds: ["entry-1", "entry-2"] });
    expect(week.rows[0].days[3].minutes).toBe(45);
    expect(week.rows[0].totalMinutes).toBe(135);
    expect(week.dayTotalMinutes).toEqual([0, 90, 0, 45, 0, 0, 0]);
    expect(week.totalMinutes).toBe(135);
    // The row is not driven off assignment, so nothing here needed an
    // assignee: people log time against work that is not their card.
    expect(week.rows[0].clientName).toBe("Perks");
  });

  it("keeps a row for a project the person has since been taken off, if they logged time to it", async () => {
    signedInAsMember();
    mockEntriesInRange.mockResolvedValue([entry()]);
    mockGetTasksByIds.mockResolvedValue([taskRow()]);
    mockGetProjectIds.mockResolvedValue([]);

    const week = await getTimesheetWeekService("2026-06-15");

    expect(week.rows).toHaveLength(1);
  });

  it("admits an added row only for a project the person is currently on", async () => {
    signedInAsMember();
    mockGetTasksByIds.mockResolvedValue([
      taskRow({ id: "task-mine" }),
      taskRow({ id: "task-theirs", projectId: "project-9" }),
    ]);
    mockGetProjectIds.mockResolvedValue([PROJECT_ID]);

    const week = await getTimesheetWeekService("2026-06-15", {
      addedTaskIds: ["task-mine", "task-theirs"],
    });

    expect(week.rows.map((row) => row.taskId)).toEqual(["task-mine"]);
    expect(week.rows[0].days).toHaveLength(7);
    expect(week.rows[0].totalMinutes).toBe(0);
  });

  it("drops an added row in an archived project", async () => {
    signedInAsMember();
    mockGetTasksByIds.mockResolvedValue([taskRow({ projectStatus: PROJECT_STATUSES.ARCHIVED })]);

    const week = await getTimesheetWeekService("2026-06-15", { addedTaskIds: [TASK_ID] });

    expect(week.rows).toEqual([]);
  });

  it("admits nothing extra for somebody on no projects", async () => {
    signedInAsMember();
    mockGetTasksByIds.mockResolvedValue([taskRow()]);
    mockGetProjectIds.mockResolvedValue([]);

    const week = await getTimesheetWeekService("2026-06-15", { addedTaskIds: [TASK_ID] });

    expect(week.rows).toEqual([]);
  });

  it("refuses a non-admin asking for somebody else's week", async () => {
    signedInAsMember(true);

    await expect(getTimesheetWeekService("2026-06-15", { userId: OTHER_ID })).rejects.toThrow(
      /Only an administrator/,
    );
    expect(mockEntriesInRange).not.toHaveBeenCalled();
  });

  it("lets an admin open somebody else's week, and names whose it is", async () => {
    signedInAsAdmin();
    mockGetUser.mockResolvedValue({ id: OTHER_ID, name: "Grace" } as Unsafe as Awaited<
      ReturnType<typeof getUserByUserIdRepo>
    >);

    const week = await getTimesheetWeekService("2026-06-15", { userId: OTHER_ID });

    expect(mockEntriesInRange).toHaveBeenCalledWith(OTHER_ID, "2026-06-15", "2026-06-21");
    expect(week.userId).toBe(OTHER_ID);
    expect(week.userName).toBe("Grace");
  });

  it("asks for no tasks at all when the week is empty", async () => {
    signedInAsMember();

    const week = await getTimesheetWeekService("2026-06-15");

    // An `in ()` with no values is a Postgres syntax error, so an empty
    // week must not reach the query at all.
    expect(mockGetTasksByIds).not.toHaveBeenCalled();
    expect(week.rows).toEqual([]);
    expect(week.dayTotalMinutes).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("addTimesheetRowService", () => {
  it("returns an empty seven-day row and writes nothing", async () => {
    signedInAsMember();
    mockGetTasksByIds.mockResolvedValue([taskRow()]);

    const row = await addTimesheetRowService(TASK_ID, "2026-06-17");

    expect(row.taskId).toBe(TASK_ID);
    expect(row.days.map((day) => day.date)).toEqual([
      "2026-06-15",
      "2026-06-16",
      "2026-06-17",
      "2026-06-18",
      "2026-06-19",
      "2026-06-20",
      "2026-06-21",
    ]);
    expect(row.days.every((day) => day.minutes === 0 && day.entryIds.length === 0)).toBe(true);
    expect(mockAddEntry).not.toHaveBeenCalled();
  });

  it("refuses a row on a project the caller is not on", async () => {
    mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.MEMBER));
    mockGetProjectForMember.mockResolvedValue(undefined);

    await expect(addTimesheetRowService(TASK_ID, "2026-06-15")).rejects.toThrow(
      /no longer available/,
    );
  });
});

describe("adjustTaskEstimateService", () => {
  function addRequest(overrides: Record<string, unknown> = {}): AdjustTaskEstimateRequestDTO {
    return {
      source: "project",
      taskId: TASK_ID,
      hours: 120,
      reason: null,
      ...overrides,
    } as AdjustTaskEstimateRequestDTO;
  }

  function transferRequest(overrides: Record<string, unknown> = {}): AdjustTaskEstimateRequestDTO {
    return {
      source: "transfer",
      taskId: TASK_ID,
      fromTaskId: "task-2",
      hours: 120,
      reason: null,
      ...overrides,
    } as AdjustTaskEstimateRequestDTO;
  }

  it("refuses an ordinary member plainly", async () => {
    signedInAsMember();

    await expect(adjustTaskEstimateService(addRequest())).rejects.toThrow(/project lead or an administrator/);
    expect(mockAdjustEstimate).not.toHaveBeenCalled();
  });

  it("adds minutes as one adjustment row, scoped to the authorised project", async () => {
    signedInAsMember(true);
    mockAdjustEstimate.mockResolvedValue({} as Unsafe as Awaited<ReturnType<typeof adjustTaskEstimateRepo>>);

    await adjustTaskEstimateService(addRequest());

    expect(mockAdjustEstimate).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: TASK_ID, projectId: PROJECT_ID, minutes: 120, changedBy: ACTOR_ID }),
    );
  });

  it("explains a reduction bigger than the estimate rather than leaking the constraint", async () => {
    signedInAsMember(true);
    mockGetTask.mockResolvedValue(task({ estimateMinutes: 60 }));
    mockAdjustEstimate.mockResolvedValue(undefined);

    await expect(adjustTaskEstimateService(addRequest({ hours: -120 }))).rejects.toThrow(
      /only estimated at 1h, so 2h cannot be taken off it/,
    );
  });

  it("refuses a transfer whose source is in another project", async () => {
    signedInAsMember(true);
    mockGetTask.mockImplementation(async (id: string) =>
      id === TASK_ID ? task() : task({ id: "task-2", projectId: "project-9" }),
    );

    await expect(adjustTaskEstimateService(transferRequest())).rejects.toThrow(
      /come from another task on this project/,
    );
    expect(mockTransferEstimate).not.toHaveBeenCalled();
  });

  it("gives a source that does not exist the SAME answer, so nothing is confirmed", async () => {
    signedInAsMember(true);
    mockGetTask.mockImplementation(async (id: string) => (id === TASK_ID ? task() : undefined));

    await expect(adjustTaskEstimateService(transferRequest())).rejects.toThrow(
      /come from another task on this project/,
    );
  });

  it("refuses to take more minutes than the source has, rather than clamping", async () => {
    signedInAsMember(true);
    mockGetTask.mockImplementation(async (id: string) =>
      id === TASK_ID ? task() : task({ id: "task-2", title: "Write the tests", estimateMinutes: 60 }),
    );

    await expect(adjustTaskEstimateService(transferRequest({ hours: 120 }))).rejects.toThrow(
      /"Write the tests" is only estimated at 1h, so 2h cannot be moved from it/,
    );
    expect(mockTransferEstimate).not.toHaveBeenCalled();
  });

  it("moves the minutes in ONE atomic call when the source has them", async () => {
    signedInAsMember(true);
    mockGetTask.mockImplementation(async (id: string) =>
      id === TASK_ID ? task() : task({ id: "task-2", estimateMinutes: 600 }),
    );
    mockTransferEstimate.mockResolvedValue({} as Unsafe as Awaited<ReturnType<typeof transferTaskEstimateRepo>>);

    await adjustTaskEstimateService(transferRequest());

    expect(mockTransferEstimate).toHaveBeenCalledTimes(1);
    expect(mockTransferEstimate).toHaveBeenCalledWith(
      expect.objectContaining({
        toTaskId: TASK_ID,
        fromTaskId: "task-2",
        projectId: PROJECT_ID,
        minutes: 120,
        changedBy: ACTOR_ID,
      }),
    );
    // No separate estimate writes: the repository does all three inside one
    // transaction, and a log that is occasionally missing an entry cannot
    // answer the question the table exists for.
    expect(mockAdjustEstimate).not.toHaveBeenCalled();
  });

  it("reports a race where the source's minutes went while the request was in flight", async () => {
    signedInAsMember(true);
    mockGetTask.mockImplementation(async (id: string) =>
      id === TASK_ID ? task() : task({ id: "task-2", title: "Write the tests", estimateMinutes: 600 }),
    );
    mockTransferEstimate.mockResolvedValue(undefined);

    await expect(adjustTaskEstimateService(transferRequest())).rejects.toThrow(/no longer available/);
  });

  it("refuses an estimate change on an archived project", async () => {
    mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.MEMBER));
    mockGetProjectForMember.mockResolvedValue(project({ isLead: true, status: PROJECT_STATUSES.ARCHIVED }));

    await expect(adjustTaskEstimateService(addRequest())).rejects.toThrow(/archived/);
  });
});
