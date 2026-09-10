import { beforeEach, describe, expect, it, vi } from "vitest";

import { USER_ROLES } from "@/lib/data/kysely-database-types";
import type { ResolvedProjectPlan } from "@/lib/delivery/project-plan";

// ===================================================================
// WRITING A WHOLE PROJECT IN ONE GO
//
// The resolver's tests cover which plans are allowed to exist. These cover
// what happens to one that is, and they are all failures that would look
// like success: an estimate stored as hours in a minutes column, a task
// written before its assignee is a member, a non-admin reaching a write that
// is admin-only everywhere else in the module.
// ===================================================================

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  redirect: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("better-auth", () => ({ generateId: () => "generated" }));

vi.mock("@/lib/audit/audit-log.service", () => ({ recordAuditEvent: vi.fn() }));

// runInTransaction hands the callback a client. The real one joins or opens
// a transaction; here it just runs the work, because what is being tested is
// the ORDER and CONTENT of the writes rather than Postgres.
vi.mock("@/lib/data/kysely-database-client", () => ({
  database: {},
  runInTransaction: (_db: unknown, work: (trx: unknown) => Promise<unknown>) => work({}),
}));

vi.mock("@/lib/data/repositories/clients.repository", () => ({
  addClientRepo: vi.fn(async () => ({ id: "new-client" })),
  getClientByNameRepo: vi.fn(async () => undefined),
}));

vi.mock("@/lib/data/repositories/phases.repository", () => ({
  addPhaseRepo: vi.fn(async () => ({ id: "phase-1" })),
}));

vi.mock("@/lib/data/repositories/projects.repository", () => ({
  addProjectRepo: vi.fn(async () => ({ id: "project-1" })),
  setProjectMembersRepo: vi.fn(async () => ({ addedUserIds: [], removedUserIds: [] })),
}));

vi.mock("@/lib/data/repositories/tasks.repository", () => ({ addTaskRepo: vi.fn(async () => ({ id: "t" })) }));

const { addClientRepo, getClientByNameRepo } = await import(
  "@/lib/data/repositories/clients.repository"
);
const { addProjectRepo, setProjectMembersRepo } = await import(
  "@/lib/data/repositories/projects.repository"
);
const { addTaskRepo } = await import("@/lib/data/repositories/tasks.repository");
const { recordAuditEvent } = await import("@/lib/audit/audit-log.service");

const { applyProjectPlanService } = await import("./project-plan.service");

const ADMIN = { id: "u1", role: USER_ROLES.ADMIN };

function plan(overrides: Partial<ResolvedProjectPlan> = {}): ResolvedProjectPlan {
  return {
    client: { mode: "existing", clientId: "c1", name: "Bowhill Engineering" },
    project: { title: "Portal Rebuild", description: null, isBillable: true },
    phases: [
      {
        name: "Build",
        tasks: [
          {
            title: "Scope the API",
            description: null,
            estimateHours: 8,
            assigneeId: "u2",
            assigneeName: "Josh",
          },
        ],
      },
    ],
    members: [{ userId: "u2", name: "Josh", isLead: true, addedForAssignment: false }],
    totals: { phaseCount: 1, taskCount: 1, estimateHours: 8, budgetHours: 250, overBudgetHours: 0 },
    warnings: [],
    blockers: [],
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("who may apply a plan", () => {
  it("refuses anybody who is not an admin", async () => {
    // Creating a project is admin-only on every other path in this module,
    // and this is the one that can be reached without a browser session - so
    // it is the last place the rule can be enforced.
    await expect(applyProjectPlanService(plan(), { id: "u9", role: USER_ROLES.MEMBER })).rejects.toThrow();

    expect(addProjectRepo).not.toHaveBeenCalled();
  });

  it("refuses a manager too", async () => {
    await expect(
      applyProjectPlanService(plan(), { id: "u9", role: USER_ROLES.MANAGER }),
    ).rejects.toThrow();
  });
});

describe("a plan that is not ready", () => {
  it("writes nothing when a blocker is still on it", async () => {
    // The caller should not have got here. Writing half a plan somebody was
    // told was not ready is worse than saying so again.
    await expect(
      applyProjectPlanService(plan({ blockers: ["The project has no phases."] }), ADMIN),
    ).rejects.toThrow();

    expect(addProjectRepo).not.toHaveBeenCalled();
    expect(addTaskRepo).not.toHaveBeenCalled();
  });
});

describe("what gets written", () => {
  it("stores an estimate in MINUTES", async () => {
    // The column counts minutes and the plan speaks hours, because a person
    // does. Eight hours stored as 8 is a task that reads as eight minutes on
    // every screen and quietly wrecks the budget report.
    await applyProjectPlanService(plan(), ADMIN);

    expect(vi.mocked(addTaskRepo).mock.calls[0][0]).toMatchObject({ estimateMinutes: 480 });
  });

  it("rounds a fractional estimate rather than storing a fraction of a minute", async () => {
    const half = plan({
      phases: [
        {
          name: "Build",
          tasks: [
            { title: "A", description: null, estimateHours: 1.5, assigneeId: null, assigneeName: null },
          ],
        },
      ],
    });

    await applyProjectPlanService(half, ADMIN);

    expect(vi.mocked(addTaskRepo).mock.calls[0][0]).toMatchObject({ estimateMinutes: 90 });
  });

  it("puts members on the project BEFORE any task is written", async () => {
    // Assigning work to somebody who is not on the project is a silent dead
    // end - the board never shows it to them - and the service that would
    // normally catch it is not on this path.
    await applyProjectPlanService(plan(), ADMIN);

    const membersAt = vi.mocked(setProjectMembersRepo).mock.invocationCallOrder[0];
    const taskAt = vi.mocked(addTaskRepo).mock.invocationCallOrder[0];

    expect(membersAt).toBeLessThan(taskAt);
  });

  it("starts every card in the first column, in the order the plan listed them", async () => {
    const many = plan({
      phases: [
        {
          name: "Build",
          tasks: ["A", "B", "C"].map((title) => ({
            title,
            description: null,
            estimateHours: 1,
            assigneeId: null,
            assigneeName: null,
          })),
        },
      ],
    });

    await applyProjectPlanService(many, ADMIN);

    const positions = vi.mocked(addTaskRepo).mock.calls.map((call) => call[0].position);

    expect(positions).toEqual([0, 1, 2]);
  });

  it("creates the project as active and unplanned", async () => {
    // budgetAssignedAt null is what makes the board's setup nudge show. A
    // plan has estimated the work but nobody has assigned the budget to it.
    await applyProjectPlanService(plan(), ADMIN);

    expect(vi.mocked(addProjectRepo).mock.calls[0][0]).toMatchObject({
      status: "active",
      budgetAssignedAt: null,
      createdBy: "u1",
    });
  });
});

describe("the client", () => {
  it("uses the existing client without touching the client table", async () => {
    await applyProjectPlanService(plan(), ADMIN);

    expect(addClientRepo).not.toHaveBeenCalled();
    expect(vi.mocked(addProjectRepo).mock.calls[0][0]).toMatchObject({ clientId: "c1" });
  });

  it("reuses a client with the same name rather than creating a second", async () => {
    // "Perks already exists" is not an error from the point of view of
    // somebody who just wants the project made.
    vi.mocked(getClientByNameRepo).mockResolvedValueOnce({ id: "c9" } as never);

    const result = await applyProjectPlanService(
      plan({ client: { mode: "new", name: "Perks" } }),
      ADMIN,
    );

    expect(addClientRepo).not.toHaveBeenCalled();
    expect(result.clientCreated).toBe(false);
    expect(result.clientId).toBe("c9");
  });

  it("creates the client when there genuinely is not one", async () => {
    const result = await applyProjectPlanService(
      plan({ client: { mode: "new", name: "Redgum Timber" } }),
      ADMIN,
    );

    expect(addClientRepo).toHaveBeenCalled();
    expect(result.clientCreated).toBe(true);
  });
});

describe("the audit trail", () => {
  it("records what the plan actually did, not just that a project appeared", async () => {
    // "Created a project" understates it. Twelve tasks and three people
    // arrived in one act and the trail should say so.
    await applyProjectPlanService(plan(), ADMIN);

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "project-1",
        metadata: expect.objectContaining({ taskCount: 1, phaseCount: 1, memberCount: 1 }),
      }),
    );
  });

  it("is not written when the plan was refused", async () => {
    // An audit entry for something that never happened is worse than a
    // missing one.
    await expect(
      applyProjectPlanService(plan(), { id: "u9", role: USER_ROLES.MEMBER }),
    ).rejects.toThrow();

    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});
