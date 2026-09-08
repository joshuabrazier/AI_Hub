import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RATE_BANDS,
  USER_ROLES,
  type RateBand,
  type UserRate,
  type UserRole,
} from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Rates, and the budget report they eventually explain, with everything
// below the service mocked.
//
// THREE THINGS ARE ASSERTED HERE AND THEY ARE THE THREE THE FILE IS BUILT
// AROUND.
//
// THE GUARD. Every exported function is admin-only, and unlike the rest of
// this module that is the whole access model rather than the first half of
// one - a charge rate is what a client is billed and a cost rate is a pay
// proxy, so being on the project the money came from confers nothing. There
// is no membership check underneath to catch a dropped role check, which is
// why every function gets its own refusal below, and why the mocked
// `requireUserRole` ENFORCES the list it is handed rather than waving it
// through: a guard that is removed, or widened to managers, reaches its
// query and fails instead of passing quietly.
//
// THE MONEY CONVENTION. Absent means "not for this viewer" and null means
// "nobody has said what it is worth". They are different facts and a
// component cannot tell them apart, so the tests below assert on the KEY
// where absence is the rule and on the VALUE where null is - `toBeNull()`
// alone would pass against the exact bug.
//
// UNVALUED IS NOT ZERO. Zero says the work was free. Every assertion about
// a missing figure below checks null AND checks it is not 0, because the
// dangerous failure in this file is a plausible wrong number sitting beside
// a right one.
// -------------------------------------------------------------------

vi.mock("server-only", () => ({}));

// notFound() and unstable_rethrow both come from here. The second one is
// not optional: handleError calls it on every catch, so a missing mock
// makes every service in this file throw from the error handler rather than
// from the thing being tested.
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("better-auth", () => ({ generateId: () => "generated-rate-id" }));

vi.mock("@/lib/auth/session-auth-server", () => ({ requireUserRole: vi.fn() }));

vi.mock("@/lib/audit/audit-log.service", () => ({ recordAuditEvent: vi.fn() }));

// Mocked so "today" is a fixed day in the app zone. The point of deriving
// it there is that it is NOT the server's clock, and a test that read the
// real one would pass on any machine while proving nothing.
vi.mock("@/lib/timezone", () => ({
  APP_TIME_ZONE: "Australia/Sydney",
  todayInAppZone: vi.fn(() => "2026-06-17"),
}));

vi.mock("@/lib/data/repositories/projects.repository", () => ({
  getProjectBudgetGroupsRepo: vi.fn(),
  getProjectByIdRepo: vi.fn(),
}));

vi.mock("@/lib/data/repositories/tasks.repository", () => ({
  getProjectEstimateMinutesRepo: vi.fn(),
}));

vi.mock("@/lib/data/repositories/time-entries.repository", () => ({
  getChargeAndCostCentsByBudgetGroupRepo: vi.fn(),
  getChargeAndCostCentsByProjectRepo: vi.fn(),
  getLoggedMinutesByBudgetGroupRepo: vi.fn(),
  getLoggedMinutesByProjectRepo: vi.fn(),
}));

vi.mock("@/lib/data/repositories/user-rates.repository", () => ({
  deleteUserRateRepo: vi.fn(),
  getUserRateByIdRepo: vi.fn(),
  listCurrentUserRatesRepo: vi.fn(),
  listUserRatesForUserRepo: vi.fn(),
  upsertUserRateRepo: vi.fn(),
}));

vi.mock("@/lib/data/repositories/users.repository", () => ({
  getMemberUsersRepo: vi.fn(),
  getStaffUsersRepo: vi.fn(),
  getUserByUserIdRepo: vi.fn(),
}));

import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { requireUserRole } from "@/lib/auth/session-auth-server";
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
} from "@/lib/data/repositories/time-entries.repository";
import {
  deleteUserRateRepo,
  getUserRateByIdRepo,
  listCurrentUserRatesRepo,
  listUserRatesForUserRepo,
  upsertUserRateRepo,
} from "@/lib/data/repositories/user-rates.repository";
import {
  getMemberUsersRepo,
  getStaffUsersRepo,
  getUserByUserIdRepo,
} from "@/lib/data/repositories/users.repository";
import { todayInAppZone } from "@/lib/timezone";

import {
  deleteUserRateService,
  getProjectBudgetReportService,
  getUserRateDeletionImpactService,
  getUserRateHistoryService,
  getUserRatesOverviewService,
  rateDeletionConsequenceOf,
  setUserRateService,
} from "./delivery-rates.service";

const mockRequireUserRole = vi.mocked(requireUserRole);
const mockAudit = vi.mocked(recordAuditEvent);
const mockGetBudgetGroups = vi.mocked(getProjectBudgetGroupsRepo);
const mockGetProjectById = vi.mocked(getProjectByIdRepo);
const mockProjectEstimate = vi.mocked(getProjectEstimateMinutesRepo);
const mockGroupCents = vi.mocked(getChargeAndCostCentsByBudgetGroupRepo);
const mockProjectCents = vi.mocked(getChargeAndCostCentsByProjectRepo);
const mockGroupMinutes = vi.mocked(getLoggedMinutesByBudgetGroupRepo);
const mockProjectMinutes = vi.mocked(getLoggedMinutesByProjectRepo);
const mockDeleteRate = vi.mocked(deleteUserRateRepo);
const mockGetRateById = vi.mocked(getUserRateByIdRepo);
const mockCurrentRates = vi.mocked(listCurrentUserRatesRepo);
const mockRatesForUser = vi.mocked(listUserRatesForUserRepo);
const mockUpsertRate = vi.mocked(upsertUserRateRepo);
const mockMemberUsers = vi.mocked(getMemberUsersRepo);
const mockStaffUsers = vi.mocked(getStaffUsersRepo);
const mockGetUser = vi.mocked(getUserByUserIdRepo);
const mockToday = vi.mocked(todayInAppZone);

// -------------------------------------------------------------------
// Fixtures. Cast where a database row would take twenty columns to build,
// and typed where the shape IS the thing under test.
// -------------------------------------------------------------------
type Unsafe = Parameters<typeof expect>[0];

const PROJECT_ID = "project-1";
const GROUP_ID = "group-1";
const USER_ID = "user-1";
const RATE_ID = "rate-1";
const ADMIN_ID = "admin-1";

// requireUserRole redirects to /error/forbidden, and redirect() throws in
// Next. The mock stands in for that throw so a role refusal is recognisable
// in an assertion.
const FORBIDDEN = /NEXT_REDIRECT/;

// Both non-admin roles, every time. A MANAGER is the trap: their scope
// elsewhere in the app comes from the teams an admin assigned them, and
// nothing about that is authority over what a client is charged.
const NON_ADMIN_ROLES: UserRole[] = [USER_ROLES.MEMBER, USER_ROLES.MANAGER];

function rate(id: string, effectiveFrom: string, band: RateBand = RATE_BANDS.STANDARD): UserRate {
  return {
    id,
    userId: USER_ID,
    band,
    chargeRateCents: 25_000,
    costRateCents: 10_000,
    effectiveFrom,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function person(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    name: "Adelaide Lovelace",
    preferredName: "Ada",
    email: "ada@example.com",
    role: USER_ROLES.MEMBER,
    isActive: true,
    deidentifiedAt: null,
    ...overrides,
  } as Unsafe as NonNullable<Awaited<ReturnType<typeof getUserByUserIdRepo>>>;
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    clientId: "client-1",
    clientName: "Perks",
    title: "Data platform",
    description: null,
    isBillable: true,
    status: "active",
    budgetAssignedAt: null,
    createdBy: ADMIN_ID,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as Unsafe as NonNullable<Awaited<ReturnType<typeof getProjectByIdRepo>>>;
}

function group(overrides: Record<string, unknown> = {}) {
  return {
    id: GROUP_ID,
    projectId: PROJECT_ID,
    name: "Interns",
    budgetMinutes: 24_000,
    position: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    members: [
      { groupId: GROUP_ID, userId: USER_ID, name: "Adelaide Lovelace", preferredName: "Ada", email: "ada@example.com" },
    ],
    ...overrides,
  } as Unsafe as Awaited<ReturnType<typeof getProjectBudgetGroupsRepo>>[number];
}

// Who is asking. The rates service resolves the actor through
// requireUserRole alone - there is no requireUser call in it - so the
// session lives here and the guard below reads it.
let currentUser = { id: ADMIN_ID, role: USER_ROLES.ADMIN as UserRole, name: "Root" };

function signedInAs(role: UserRole): void {
  currentUser = { id: role === USER_ROLES.ADMIN ? ADMIN_ID : USER_ID, role, name: "Root" };
}

// The mocked guard ENFORCES the role list it is handed. That is what makes
// every refusal below depend on the service still calling it.
function guardEnforcesRoles(): void {
  mockRequireUserRole.mockImplementation(async (allowedRoles) => {
    if (!allowedRoles.includes(currentUser.role)) {
      throw new Error("NEXT_REDIRECT /error/forbidden");
    }

    return currentUser as Unsafe as Awaited<ReturnType<typeof requireUserRole>>;
  });
}

const SET_RATE = {
  userId: USER_ID,
  band: RATE_BANDS.STANDARD,
  effectiveFrom: "2026-06-01",
  // The schema converted dollars to integer cents at the boundary, so these
  // are cents by the time a service sees them.
  chargeRate: 25_000,
  costRate: 10_000,
};

function repositoryDefaults(): void {
  mockToday.mockReturnValue("2026-06-17");

  mockStaffUsers.mockResolvedValue([]);
  mockMemberUsers.mockResolvedValue([]);
  mockCurrentRates.mockResolvedValue([]);
  mockRatesForUser.mockResolvedValue([]);
  mockGetUser.mockResolvedValue(person());
  mockGetRateById.mockResolvedValue(rate(RATE_ID, "2026-06-01"));
  mockUpsertRate.mockResolvedValue(rate(RATE_ID, "2026-06-01"));
  mockDeleteRate.mockResolvedValue(1);

  mockGetProjectById.mockResolvedValue(project());
  mockGetBudgetGroups.mockResolvedValue([]);
  mockProjectEstimate.mockResolvedValue(0);
  mockProjectMinutes.mockResolvedValue([]);
  mockGroupMinutes.mockResolvedValue([]);
  // The honest default for a project nobody has logged an hour against:
  // null on both sides, never nought.
  mockProjectCents.mockResolvedValue({ chargeCents: null, costCents: null });
  mockGroupCents.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  signedInAs(USER_ROLES.ADMIN);
  guardEnforcesRoles();
  repositoryDefaults();
});

// -------------------------------------------------------------------
// ===================================================================
// ADMIN ONLY, EVERY EXPORTED FUNCTION
// ===================================================================
//
// Nine call sites go through one wrapper, `requireRatesAdmin`, so this is
// really one rule asserted six times - and it is asserted six times on
// purpose, because the wrapper is easy to forget on a function added later
// and there is no second boundary here to catch the omission. Elsewhere in
// delivery a missing role check still meets `project_members`; on this
// screen it meets nothing.
// -------------------------------------------------------------------
type AdminOnlyFunction = {
  what: string;
  run: () => Promise<unknown>;
  expectUntouched: () => void;
};

const ADMIN_ONLY_FUNCTIONS: AdminOnlyFunction[] = [
  {
    what: "the rates overview",
    run: () => getUserRatesOverviewService(),
    expectUntouched: () => {
      expect(mockStaffUsers).not.toHaveBeenCalled();
      expect(mockCurrentRates).not.toHaveBeenCalled();
    },
  },
  {
    what: "one person's rate history",
    run: () => getUserRateHistoryService(USER_ID),
    expectUntouched: () => {
      expect(mockGetUser).not.toHaveBeenCalled();
      expect(mockRatesForUser).not.toHaveBeenCalled();
    },
  },
  {
    what: "setting a rate",
    run: () => setUserRateService({ ...SET_RATE }),
    expectUntouched: () => {
      expect(mockUpsertRate).not.toHaveBeenCalled();
      expect(mockAudit).not.toHaveBeenCalled();
    },
  },
  {
    what: "what deleting a rate would do",
    run: () => getUserRateDeletionImpactService(RATE_ID),
    expectUntouched: () => expect(mockGetRateById).not.toHaveBeenCalled(),
  },
  {
    what: "deleting a rate",
    run: () => deleteUserRateService({ rateId: RATE_ID }),
    expectUntouched: () => {
      expect(mockDeleteRate).not.toHaveBeenCalled();
      // Not even the read that names whose rate it is: a rate row is
      // nothing but money, so a non-admin is refused the whole object
      // rather than handed a hollow one.
      expect(mockGetRateById).not.toHaveBeenCalled();
    },
  },
  {
    what: "the budget report",
    run: () => getProjectBudgetReportService(PROJECT_ID),
    expectUntouched: () => {
      expect(mockGetProjectById).not.toHaveBeenCalled();
      // THE CENTS NEVER LEAVE POSTGRES. The absence convention is a fact
      // about what was read, not a field deleted on the way out, so a
      // refused caller must not have caused the money query at all.
      expect(mockProjectCents).not.toHaveBeenCalled();
      expect(mockGroupCents).not.toHaveBeenCalled();
    },
  },
];

describe("every exported function is admin-only", () => {
  for (const target of ADMIN_ONLY_FUNCTIONS) {
    it(`refuses a member and a manager: ${target.what} is gated by requireRatesAdmin -> requireUserRole([ADMIN])`, async () => {
      for (const role of NON_ADMIN_ROLES) {
        signedInAs(role);

        await expect(target.run()).rejects.toThrow(FORBIDDEN);
        target.expectUntouched();
      }
    });
  }

  it("lets an admin through every one of them", async () => {
    // The other half of the pair. A guard asserted only by its refusals is
    // satisfied by a function that refuses everybody, and an admin-only
    // screen locked against admins passes every test above.
    for (const target of ADMIN_ONLY_FUNCTIONS) {
      vi.clearAllMocks();
      signedInAs(USER_ROLES.ADMIN);
      guardEnforcesRoles();
      repositoryDefaults();

      await expect(target.run()).resolves.not.toThrow();
    }
  });
});

// -------------------------------------------------------------------
// ===================================================================
// THE MONEY CONVENTION
// ===================================================================
//
// ABSENT means "not for this viewer". NULL means "nobody has said what it
// is worth" - a non-billable project, an hour logged against an uncosted
// rate. The two are different facts, a component cannot tell them apart,
// and the whole viewer-dependent shape of BudgetReportDTO exists to keep
// them apart.
//
// WHAT CAN AND CANNOT BE ASSERTED FROM HERE, stated plainly rather than
// left as a gap somebody has to notice. `getProjectBudgetReportService` is
// the only way into `buildBudgetReport` and it passes `full`, so the
// PRESENT-AND-NULL half is asserted below on the real DTO. The ABSENT half
// lives in the `none` / `chargeOnly` branches of `moneyFields`, which no
// exported function reaches today - it is written for the project lead who
// is meant to read this report without its cost side - so the closest
// reachable assertion of absence is in delivery-setup.service.test.ts,
// where `getProjectBudgetGroupsService` returns the SAME
// BudgetGroupReportDTO with no cents on it for anybody, admin included, and
// the money keys are optional so a version that attached them type-checks.
// If `moneyFields` is ever exported, its two skipping branches belong here
// asserted on the key.
// -------------------------------------------------------------------
describe("the budget report's money", () => {
  it("carries all three money KEYS for an admin, present even when the value is unknown", async () => {
    mockProjectCents.mockResolvedValue({ chargeCents: null, costCents: null });

    const report = await getProjectBudgetReportService(PROJECT_ID);

    // Present-and-null, which is what "an admin may see money, and nobody
    // has valued this" looks like. Absence would say something else
    // entirely, and a viewer cannot tell the difference from the value.
    expect("chargeableCents" in report).toBe(true);
    expect("costCents" in report).toBe(true);
    expect("marginCents" in report).toBe(true);
  });

  it("reports a project nobody has valued as null, NOT as nought", async () => {
    // The failure this whole file is written around: 0 says the work was
    // free, and "$0.00" beside "0h" invites nobody to ask why. Both halves
    // are asserted, because `?? 0` passes a null check written as
    // `not.toBe(undefined)`.
    mockProjectMinutes.mockResolvedValue([]);
    mockProjectCents.mockResolvedValue({ chargeCents: null, costCents: null });

    const report = await getProjectBudgetReportService(PROJECT_ID);

    expect(report.chargeableCents).toBeNull();
    expect(report.chargeableCents).not.toBe(0);
    expect(report.costCents).toBeNull();
    expect(report.costCents).not.toBe(0);
    expect(report.marginCents).toBeNull();
    expect(report.marginCents).not.toBe(0);
    // And the contrast that makes the rule legible: MINUTES do default to
    // nought, because nobody logging an hour means there are no hours.
    expect(report.project.loggedMinutes).toBe(0);
  });

  it("leaves the margin unknown when only the COST side is unvalued", async () => {
    // The sharpest case, and the one a plausible wrong implementation gets
    // wrong: `charge - (cost ?? 0)` reports the whole charge as margin,
    // which is the one wrong answer that reads as good news.
    mockProjectCents.mockResolvedValue({ chargeCents: 500_000, costCents: null });

    const report = await getProjectBudgetReportService(PROJECT_ID);

    expect(report.chargeableCents).toBe(500_000);
    expect(report.costCents).toBeNull();
    expect(report.marginCents).toBeNull();
    expect(report.marginCents).not.toBe(500_000);
  });

  it("subtracts the two figures Postgres already summed, and nothing else", async () => {
    mockProjectCents.mockResolvedValue({ chargeCents: 500_000, costCents: 200_000 });

    const report = await getProjectBudgetReportService(PROJECT_ID);

    expect(report.marginCents).toBe(300_000);
  });

  it("reports a budget group with no time against it as null, not nought", async () => {
    // A group is ABSENT from both rollups when nothing has been logged
    // against it, which the repositories document. The default has to be
    // null for money and 0 for minutes, so an untouched group reads the
    // same way an untouched project does.
    mockGetBudgetGroups.mockResolvedValue([group()]);
    mockGroupMinutes.mockResolvedValue([]);
    mockGroupCents.mockResolvedValue([]);

    const [reported] = (await getProjectBudgetReportService(PROJECT_ID)).groups;

    expect(reported.chargeableCents).toBeNull();
    expect(reported.chargeableCents).not.toBe(0);
    expect(reported.costCents).toBeNull();
    expect(reported.marginCents).toBeNull();
    expect(reported.rollup.loggedMinutes).toBe(0);
  });

  it("gives each group ITS OWN money, keyed on the group id", async () => {
    mockGetBudgetGroups.mockResolvedValue([
      group(),
      group({ id: "group-2", name: "Principals", budgetMinutes: 3_000, members: [] }),
    ]);
    mockGroupMinutes.mockResolvedValue([
      { groupId: GROUP_ID, minutes: 600 },
      { groupId: "group-2", minutes: 120 },
    ]);
    mockGroupCents.mockResolvedValue([
      { groupId: GROUP_ID, chargeCents: 250_000, costCents: 100_000 },
      { groupId: "group-2", chargeCents: 80_000, costCents: null },
    ]);

    const { groups } = await getProjectBudgetReportService(PROJECT_ID);

    expect(groups.map((row) => [row.groupId, row.chargeableCents, row.marginCents])).toEqual([
      [GROUP_ID, 250_000, 150_000],
      // Uncosted, so the margin is unknown rather than the whole charge.
      ["group-2", 80_000, null],
    ]);
  });

  it("keeps the ungrouped line free of money altogether", async () => {
    // A pool's value is a question about a pool, and the no-group bucket is
    // not one - so the DTO gives `ungrouped` no cents fields and the
    // null-key money row is read and deliberately not used. Asserted on the
    // KEY: adding them is a decision about the report, and this is what
    // makes that decision visible rather than something that happens in
    // passing.
    mockGroupMinutes.mockResolvedValue([{ groupId: null, minutes: 300 }]);
    mockGroupCents.mockResolvedValue([{ groupId: null, chargeCents: 90_000, costCents: 40_000 }]);

    const report = await getProjectBudgetReportService(PROJECT_ID);

    expect("chargeableCents" in report.ungrouped).toBe(false);
    expect("costCents" in report.ungrouped).toBe(false);
    // The MINUTES of that bucket are carried, and they are the reason the
    // null key is read at all: time logged by somebody in no group is still
    // the project's.
    expect(report.ungrouped.loggedMinutes).toBe(300);
    // Its budget is 0 and that is not a placeholder - nobody pooled the
    // remainder - so the remainder and the percentage are unknown rather
    // than a full bar, and it is not flagged as an overrun.
    expect(report.ungrouped.budgetMinutes).toBe(0);
    expect(report.ungrouped.remainingMinutes).toBeNull();
    expect(report.ungrouped.percentUsed).toBeNull();
    expect(report.ungrouped.isOverBudget).toBe(false);
  });

  it("answers notFound() for a project that does not exist, before reading any money", async () => {
    mockGetProjectById.mockResolvedValue(undefined);

    await expect(getProjectBudgetReportService(PROJECT_ID)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockProjectCents).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------
// ===================================================================
// SETTING A RATE
// ===================================================================
// -------------------------------------------------------------------
describe("setUserRateService", () => {
  it("writes the cents it was handed, and keeps an EMPTY cost box as null", async () => {
    // The same convention one field lower down. An empty box means nobody
    // has recorded a cost, so margin stays unknown - `costRate ?? 0` here
    // would make every uncosted rate look like 100% margin on every report
    // built from it afterwards.
    mockUpsertRate.mockResolvedValue({ ...rate(RATE_ID, "2026-06-01"), costRateCents: null });

    const saved = await setUserRateService({ ...SET_RATE, costRate: null });

    expect(mockUpsertRate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        band: RATE_BANDS.STANDARD,
        effectiveFrom: "2026-06-01",
        chargeRateCents: 25_000,
        costRateCents: null,
      }),
    );
    expect(saved.costRateCents).toBeNull();
    expect(saved.costRateCents).not.toBe(0);
  });

  it("refuses a rate for an account that has gone, and writes nothing", async () => {
    mockGetUser.mockResolvedValue(undefined);

    await expect(setUserRateService({ ...SET_RATE })).rejects.toThrow(/no longer has an account/);
    expect(mockUpsertRate).not.toHaveBeenCalled();
  });

  it("refuses a rate for a DE-IDENTIFIED account, and leaves its existing rows alone", async () => {
    mockGetUser.mockResolvedValue(person({ deidentifiedAt: new Date("2026-05-01T00:00:00Z") }));

    // A scrubbed account is dormant and will never log another hour, so a
    // rate effective from any date is a figure nobody can use. Its existing
    // rows stay readable, because the time already logged against them is
    // billing history.
    await expect(setUserRateService({ ...SET_RATE })).rejects.toThrow(/de-identified/);
    expect(mockUpsertRate).not.toHaveBeenCalled();
  });

  it("records the act naming both parties, AFTER the write", async () => {
    await setUserRateService({ ...SET_RATE });

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ subjectUserId: USER_ID, summary: expect.stringContaining("Ada") }),
    );
    // One admin deciding what another person's hour is worth is a
    // commercial act about somebody else - and a failed save must not be
    // recorded as a change.
    expect(mockUpsertRate.mock.invocationCallOrder[0]).toBeLessThan(mockAudit.mock.invocationCallOrder[0]);
  });

  it("does not record anything when the write throws", async () => {
    mockUpsertRate.mockRejectedValue(new Error("unique violation"));

    await expect(setUserRateService({ ...SET_RATE })).rejects.toThrow();
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------
// ===================================================================
// DELETING A RATE
// ===================================================================
// -------------------------------------------------------------------
describe("deleteUserRateService", () => {
  it("works out the consequence BEFORE the row goes, and returns it", async () => {
    // Neither the cents nor the answer to "was this the earliest of its
    // band" survives the delete, and returning the impact is what makes the
    // warning unskippable from a keyboard shortcut or a stale screen.
    mockGetRateById.mockResolvedValue(rate(RATE_ID, "2026-06-01"));
    mockRatesForUser.mockResolvedValue([rate(RATE_ID, "2026-06-01")]);

    const impact = await deleteUserRateService({ rateId: RATE_ID });

    expect(mockGetRateById.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteRate.mock.invocationCallOrder[0],
    );
    expect(impact.leavesGap).toBe(true);
    expect(impact.unvaluedFrom).toBe("2026-06-01");
  });

  it("weighs only the row's OWN band when deciding whether a gap opens", async () => {
    // A rate in another band cannot fill a hole in this one, so a history
    // read that was not filtered would report "no gap" on the one case that
    // has one.
    mockGetRateById.mockResolvedValue(rate(RATE_ID, "2026-06-01", RATE_BANDS.STANDARD));
    mockRatesForUser.mockResolvedValue([
      rate(RATE_ID, "2026-06-01", RATE_BANDS.STANDARD),
      rate("discounted-earlier", "2026-01-01", RATE_BANDS.DISCOUNTED),
    ]);

    const impact = await deleteUserRateService({ rateId: RATE_ID });

    expect(impact.leavesGap).toBe(true);
    expect(impact.fallsBackToEffectiveFrom).toBeNull();
  });

  it("says the row has already gone when the delete removes nothing", async () => {
    mockDeleteRate.mockResolvedValue(0);

    await expect(deleteUserRateService({ rateId: RATE_ID })).rejects.toThrow(/already been removed/);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("says the same thing when the row was already gone at the read", async () => {
    mockGetRateById.mockResolvedValue(undefined);

    // From the reader's side it is the same situation, so it gets the same
    // sentence - and nothing is deleted on the strength of a row nobody
    // could read.
    await expect(deleteUserRateService({ rateId: RATE_ID })).rejects.toThrow(/already been removed/);
    expect(mockDeleteRate).not.toHaveBeenCalled();
  });

  it("records the gap it opened, since the row that would explain it is gone", async () => {
    mockGetRateById.mockResolvedValue(rate(RATE_ID, "2026-01-01"));
    mockRatesForUser.mockResolvedValue([rate(RATE_ID, "2026-01-01"), rate("july", "2026-07-01")]);

    await deleteUserRateService({ rateId: RATE_ID });

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectUserId: USER_ID,
        changes: expect.objectContaining({
          leavesGap: true,
          unvaluedFrom: "2026-01-01",
          unvaluedTo: "2026-06-30",
        }),
      }),
    );
  });

  it("still deletes a scrubbed account's rate, naming nobody", async () => {
    mockGetUser.mockResolvedValue(undefined);

    const impact = await deleteUserRateService({ rateId: RATE_ID });

    // A de-identified account's rate card is not history worth keeping, and
    // a name that no longer exists is not manufactured.
    expect(impact.personName).toBeNull();
    expect(mockDeleteRate).toHaveBeenCalledWith(RATE_ID);
  });

  it("promises the dialog and the delete the same answer", async () => {
    mockGetRateById.mockResolvedValue(rate(RATE_ID, "2026-01-01"));
    mockRatesForUser.mockResolvedValue([rate(RATE_ID, "2026-01-01"), rate("july", "2026-07-01")]);

    const previewed = await getUserRateDeletionImpactService(RATE_ID);
    const performed = await deleteUserRateService({ rateId: RATE_ID });

    // One computation, called twice. A second implementation for the dialog
    // could promise one outcome and let the delete produce another.
    expect(performed).toEqual(previewed);
  });
});

// -------------------------------------------------------------------
// ===================================================================
// THE OVERVIEW AND ONE PERSON'S HISTORY
// ===================================================================
// -------------------------------------------------------------------
describe("getUserRatesOverviewService", () => {
  it("asks for the rates in force on TODAY IN THE APP ZONE, and says which day that was", async () => {
    const overview = await getUserRatesOverviewService();

    // The repository takes the date as a parameter precisely so it does not
    // have to guess. Deriving it from the server's clock puts the boundary
    // in the wrong place for most of an Australian evening, and the visible
    // symptom - a rate starting tomorrow showing as current - is mild
    // enough to survive review.
    expect(mockCurrentRates).toHaveBeenCalledWith("2026-06-17");
    expect(overview.asAtDate).toBe("2026-06-17");
  });

  it("lists members as well as staff, because a member's hour has to be worth something too", async () => {
    mockStaffUsers.mockResolvedValue([person({ id: "admin-2", name: "Root", role: USER_ROLES.ADMIN })]);
    mockMemberUsers.mockResolvedValue([person()]);

    const overview = await getUserRatesOverviewService();

    // A screen listing only admins and managers would leave most of a
    // delivery team unpriced.
    expect(overview.people.map((row) => row.userId).sort()).toEqual(["admin-2", USER_ID]);
  });

  it("gives every band a place, null where nobody has priced it", async () => {
    mockMemberUsers.mockResolvedValue([person()]);
    mockCurrentRates.mockResolvedValue([rate("standard", "2026-06-01", RATE_BANDS.STANDARD)]);

    const [listed] = (await getUserRatesOverviewService()).people;

    // Built by walking the bands rather than the rows, so an unpriced band
    // is a visible blank instead of a missing key - which is the thing an
    // admin opens this screen to find.
    expect(Object.keys(listed.bands).sort()).toEqual([...Object.values(RATE_BANDS)].sort());
    expect(listed.bands[RATE_BANDS.STANDARD]?.id).toBe("standard");
    expect(listed.bands[RATE_BANDS.DISCOUNTED]).toBeNull();
    expect(listed.bands[RATE_BANDS.HIGH]).toBeNull();
  });

  it("sorts active people first, then by name", async () => {
    mockStaffUsers.mockResolvedValue([person({ id: "zoe", name: "Zoe" })]);
    mockMemberUsers.mockResolvedValue([
      person({ id: "gone", name: "Alice", isActive: false }),
      person({ id: "ada", name: "Ada" }),
    ]);

    const overview = await getUserRatesOverviewService();

    // Restated over the merged list on purpose: concatenating two sorted
    // lists does not give a sorted list.
    expect(overview.people.map((row) => row.userId)).toEqual(["ada", "zoe", "gone"]);
  });
});

describe("getUserRateHistoryService", () => {
  it("answers notFound() for an id that resolves to nobody", async () => {
    mockGetUser.mockResolvedValue(undefined);

    // A page read keyed on an id in a path, answered the way the module
    // answers anything out of scope - and no rate rows are read for a
    // person who does not exist.
    await expect(getUserRateHistoryService(USER_ID)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockRatesForUser).not.toHaveBeenCalled();
  });

  it("keeps the repository's order rather than re-sorting it", async () => {
    mockRatesForUser.mockResolvedValue([
      rate("july", "2026-07-01"),
      rate("june-high", "2026-06-01", RATE_BANDS.HIGH),
      rate("june", "2026-06-01"),
    ]);

    const history = await getUserRateHistoryService(USER_ID);

    // Three bands can share an effectiveFrom, and a second opinion about
    // the tie here would make the screen reshuffle between loads for no
    // gain.
    expect(history.rates.map((row) => row.id)).toEqual(["july", "june-high", "june"]);
  });
});

// -------------------------------------------------------------------
// ===================================================================
// WHAT DELETING A RATE DOES TO FUTURE ENTRIES
// ===================================================================
//
// Tested directly, and it is the one piece of this service that has to be,
// because both ways of getting it wrong are silent. `deleteUserRateRepo`
// spells out the rule: a rate is the greatest `effectiveFrom` on or before
// the work date and NEVER a later one, so removing the earliest row of a
// band leaves a window with no rate at all. An entry backdated into that
// window comes back unvalued with nothing on any screen to explain it.
//
// Every case below is an off-by-one or a boundary, which is why the wording
// is asserted alongside the flags: the sentence is what somebody actually
// reads before they click, and a correct `unvaluedTo` printed into the
// wrong half of a sentence is no warning at all.
// -------------------------------------------------------------------
describe("rateDeletionConsequenceOf", () => {
  it("falls back to the previous rate when there is one", () => {
    const june = rate("june", "2026-06-01");
    const july = rate("july", "2026-07-01");

    const result = rateDeletionConsequenceOf(july, [june, july]);

    expect(result.leavesGap).toBe(false);
    expect(result.fallsBackToEffectiveFrom).toBe("2026-06-01");
    expect(result.unvaluedFrom).toBeNull();
    expect(result.unvaluedTo).toBeNull();
    expect(result.consequence).toContain("fall back to the Standard rate starting 2026-06-01");
  });

  it("picks the LATEST earlier rate as the fallback, not the earliest", () => {
    const january = rate("january", "2026-01-01");
    const june = rate("june", "2026-06-01");
    const july = rate("july", "2026-07-01");

    // Deliberately out of order: the repository returns a person's history
    // newest first, and a caller filtering by band can hand these over in
    // any order at all.
    const result = rateDeletionConsequenceOf(july, [july, january, june]);

    expect(result.fallsBackToEffectiveFrom).toBe("2026-06-01");
  });

  it("reports a CLOSED unvalued window when the earliest of several goes", () => {
    const january = rate("january", "2026-01-01");
    const july = rate("july", "2026-07-01");

    const result = rateDeletionConsequenceOf(january, [january, july]);

    expect(result.leavesGap).toBe(true);
    expect(result.fallsBackToEffectiveFrom).toBeNull();
    expect(result.unvaluedFrom).toBe("2026-01-01");
    // The day BEFORE the next rate starts, because the window is inclusive.
    // 2026-07-01 here would overstate the gap by a day and, worse, would
    // read as if the July rate did not apply on the day it starts.
    expect(result.unvaluedTo).toBe("2026-06-30");
    expect(result.consequence).toContain("2026-01-01 to 2026-06-30");
    expect(result.consequence).toContain("unvalued");
  });

  it("crosses a month boundary correctly when the successor starts on the 1st", () => {
    const first = rate("first", "2026-02-15");
    const next = rate("next", "2026-03-01");

    const result = rateDeletionConsequenceOf(first, [first, next]);

    // 28 days in February 2026, so the day before 1 March is the 28th. This
    // is the case a Date built from a date-only string gets wrong by an
    // offset, which is why the module does the arithmetic on day numbers.
    expect(result.unvaluedTo).toBe("2026-02-28");
  });

  it("crosses a leap day correctly", () => {
    const first = rate("first", "2028-02-01");
    const next = rate("next", "2028-03-01");

    const result = rateDeletionConsequenceOf(first, [first, next]);

    expect(result.unvaluedTo).toBe("2028-02-29");
  });

  it("reports an OPEN-ENDED window when the only rate in the band goes", () => {
    const only = rate("only", "2026-06-01");

    const result = rateDeletionConsequenceOf(only, [only]);

    expect(result.leavesGap).toBe(true);
    expect(result.unvaluedFrom).toBe("2026-06-01");
    // Null, not a far-future date: there is no end to the window, and a
    // sentinel would eventually be printed as one.
    expect(result.unvaluedTo).toBeNull();
    expect(result.consequence).toContain("2026-06-01 or later");
  });

  it("ignores a LATER rate when deciding whether there is a fallback", () => {
    // The trap this exists for: the resolver never falls FORWARD, so a rate
    // starting after the deleted one does not fill the gap. Treating any
    // sibling as a fallback would report "no gap" on the one case that has
    // one.
    const january = rate("january", "2026-01-01");
    const july = rate("july", "2026-07-01");

    const result = rateDeletionConsequenceOf(january, [january, july]);

    expect(result.leavesGap).toBe(true);
    expect(result.fallsBackToEffectiveFrom).toBeNull();
  });

  it("names the deleted row's own band in the copy", () => {
    const discounted = rate("discounted", "2026-06-01", RATE_BANDS.DISCOUNTED);

    const result = rateDeletionConsequenceOf(discounted, [discounted]);

    expect(result.consequence).toContain("Discounted");
    expect(result.consequence).not.toContain("Standard");
  });

  it("always says that time already logged is unaffected", () => {
    const june = rate("june", "2026-06-01");
    const july = rate("july", "2026-07-01");

    // On both branches, because it is the half people expect to be false: a
    // time entry snapshots the cents it was charged at, so nothing already
    // reported moves.
    for (const result of [
      rateDeletionConsequenceOf(june, [june, july]),
      rateDeletionConsequenceOf(july, [june, july]),
    ]) {
      expect(result.consequence).toContain("keeps the rate it was charged at");
    }
  });

  it("does not treat the row being deleted as its own predecessor", () => {
    const only = rate("only", "2026-06-01");

    // Passed a list that includes itself, which is what the caller does -
    // it filters a history read by band, not by id. Matching on
    // effectiveFrom instead of id would find itself and report no gap.
    const result = rateDeletionConsequenceOf(only, [only, only]);

    expect(result.leavesGap).toBe(true);
  });
});
