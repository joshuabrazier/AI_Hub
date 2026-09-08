import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PROJECT_STATUSES,
  TASK_COLUMNS,
  TASK_COLUMN_ORDER,
  USER_ROLES,
} from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// The board service, with everything below it mocked.
//
// WHAT IS WORTH TESTING HERE IS THE JUDGEMENT, not the queries: which gate
// refuses whom, the sign on an estimate line read from the far side of a
// transfer, whether a card lands where it was dropped, and whether a blob
// is cleared. Every one of those fails SILENTLY in production - a wrong
// number that looks right, a file nobody is paying attention to - which is
// why they are asserted rather than eyeballed.
// -------------------------------------------------------------------

vi.mock("server-only", () => ({}));

// notFound() and unstable_rethrow both come from here. The second one is
// not optional: handleError calls it on every catch, so a missing mock
// makes every service in the file throw from the error handler instead of
// from the thing being tested.
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("better-auth", () => ({ generateId: () => "generated-task-id" }));

vi.mock("@/lib/auth/session-auth-server", () => ({ requireUser: vi.fn() }));

vi.mock("@/lib/data/repositories/phases.repository", () => ({
  getPhaseRepo: vi.fn(),
  getPhasesForProjectRepo: vi.fn(),
}));

vi.mock("@/lib/data/repositories/projects.repository", () => ({
  getProjectByIdRepo: vi.fn(),
  getProjectForMemberRepo: vi.fn(),
  getProjectMemberRepo: vi.fn(),
}));

vi.mock("@/lib/data/repositories/tasks.repository", () => ({
  addTaskAttachmentRepo: vi.fn(),
  addTaskRepo: vi.fn(),
  deleteTaskAttachmentRepo: vi.fn(),
  deleteTaskReturningBlobKeysRepo: vi.fn(),
  getAttachmentCountsForProjectRepo: vi.fn(),
  getProjectBoardTasksRepo: vi.fn(),
  getTaskAttachmentRepo: vi.fn(),
  getTaskAttachmentsRepo: vi.fn(),
  getTaskRepo: vi.fn(),
  getTasksAssignedToUserRepo: vi.fn(),
  getTasksByIdsRepo: vi.fn(),
  moveTaskRepo: vi.fn(),
  updateTaskRepo: vi.fn(),
}));

vi.mock("@/lib/data/repositories/time-entries.repository", () => ({
  getEstimateChangesForTaskRepo: vi.fn(),
  getLoggedMinutesByTaskRepo: vi.fn(),
  getTimeEntriesForTaskRepo: vi.fn(),
}));

vi.mock("@/lib/data/repositories/users.repository", () => ({ getUsersByIdsRepo: vi.fn() }));

// THE DELIVERY STORAGE MODULE, not chat's. The service used to import
// attachment-storage, whose key builder is hard-coded to the `ai-chat/`
// prefix; it now imports the delivery-prefixed one. Mocking the wrong module
// does not fail loudly - the real one runs, reaches for an absent Azurite
// emulator, and the blob tests time out after five seconds while two
// "touches no storage" assertions quietly become unfalsifiable.
vi.mock("@/lib/storage/task-attachment-storage", () => ({
  deleteTaskAttachmentBlob: vi.fn(),
  isTaskAttachmentStorageConfigured: vi.fn(() => true),
  taskAttachmentStorageKey: vi.fn(
    (projectId: string, taskId: string, attachmentId: string) =>
      `delivery/${projectId}/${taskId}/${attachmentId}`,
  ),
}));

import { requireUser } from "@/lib/auth/session-auth-server";
import { getPhaseRepo, getPhasesForProjectRepo } from "@/lib/data/repositories/phases.repository";
import {
  getProjectByIdRepo,
  getProjectForMemberRepo,
  getProjectMemberRepo,
} from "@/lib/data/repositories/projects.repository";
import {
  addTaskRepo,
  deleteTaskAttachmentRepo,
  deleteTaskReturningBlobKeysRepo,
  getAttachmentCountsForProjectRepo,
  getProjectBoardTasksRepo,
  getTaskAttachmentRepo,
  getTaskAttachmentsRepo,
  getTaskRepo,
  getTasksAssignedToUserRepo,
  getTasksByIdsRepo,
  moveTaskRepo,
  updateTaskRepo,
} from "@/lib/data/repositories/tasks.repository";
import {
  getEstimateChangesForTaskRepo,
  getLoggedMinutesByTaskRepo,
  getTimeEntriesForTaskRepo,
} from "@/lib/data/repositories/time-entries.repository";
import { getUsersByIdsRepo } from "@/lib/data/repositories/users.repository";
import { deleteTaskAttachmentBlob } from "@/lib/storage/task-attachment-storage";

import {
  createTaskService,
  deleteTaskAttachmentService,
  deleteTaskService,
  getMyWorkService,
  getProjectBoardService,
  getTaskDetailService,
  mapEstimateChange,
  moveTaskService,
  placeIdAtPosition,
  updateTaskService,
} from "./delivery-board.service";

const mockRequireUser = vi.mocked(requireUser);
const mockGetPhase = vi.mocked(getPhaseRepo);
const mockGetPhases = vi.mocked(getPhasesForProjectRepo);
const mockGetProjectById = vi.mocked(getProjectByIdRepo);
const mockGetProjectForMember = vi.mocked(getProjectForMemberRepo);
const mockGetProjectMember = vi.mocked(getProjectMemberRepo);
const mockAddTask = vi.mocked(addTaskRepo);
const mockBoardTasks = vi.mocked(getProjectBoardTasksRepo);
const mockAttachmentCounts = vi.mocked(getAttachmentCountsForProjectRepo);
const mockLoggedByTask = vi.mocked(getLoggedMinutesByTaskRepo);
const mockTaskEntries = vi.mocked(getTimeEntriesForTaskRepo);
const mockEstimateChanges = vi.mocked(getEstimateChangesForTaskRepo);
const mockGetTask = vi.mocked(getTaskRepo);
const mockGetTasksByIds = vi.mocked(getTasksByIdsRepo);
const mockAssignedTasks = vi.mocked(getTasksAssignedToUserRepo);
const mockUpdateTask = vi.mocked(updateTaskRepo);
const mockMoveTask = vi.mocked(moveTaskRepo);
const mockDeleteTask = vi.mocked(deleteTaskReturningBlobKeysRepo);
const mockGetAttachment = vi.mocked(getTaskAttachmentRepo);
const mockGetAttachments = vi.mocked(getTaskAttachmentsRepo);
const mockDeleteAttachmentRow = vi.mocked(deleteTaskAttachmentRepo);
const mockDeleteBlob = vi.mocked(deleteTaskAttachmentBlob);
const mockGetUsers = vi.mocked(getUsersByIdsRepo);

// -------------------------------------------------------------------
// Fixtures. Cast rather than fully built: these stand in for database
// rows, and typing out every column of five tables would bury what each
// test is actually about.
// -------------------------------------------------------------------
type Unsafe = Parameters<typeof expect>[0];

const PROJECT_ID = "project-1";
const PHASE_ID = "phase-1";

function sessionUser(role: (typeof USER_ROLES)[keyof typeof USER_ROLES], id = "user-1") {
  return { id, role } as Unsafe as Awaited<ReturnType<typeof requireUser>>;
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    title: "Data platform",
    clientName: "Perks",
    isLead: false,
    ...overrides,
  } as Unsafe as NonNullable<Awaited<ReturnType<typeof getProjectForMemberRepo>>>;
}

function phase(overrides: Record<string, unknown> = {}) {
  return {
    id: PHASE_ID,
    projectId: PROJECT_ID,
    name: "Discovery",
    position: 0,
    ...overrides,
  } as Unsafe as NonNullable<Awaited<ReturnType<typeof getPhaseRepo>>>;
}

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    phaseId: PHASE_ID,
    projectId: PROJECT_ID,
    title: "Model the warehouse",
    description: null,
    estimateMinutes: 480,
    boardColumn: TASK_COLUMNS.TODO,
    position: 0,
    assigneeId: null,
    assigneeName: null,
    assigneeImage: null,
    phaseName: "Discovery",
    phasePosition: 0,
    projectTitle: "Data platform",
    projectStatus: PROJECT_STATUSES.ACTIVE,
    clientId: "client-1",
    clientName: "Perks",
    createdBy: "user-1",
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
    // Typed as the WIDER row - the by-id and assigned reads carry the
    // project and client context on top of a board card - so one factory
    // serves every read here. AssignedTaskRow extends TaskBoardRow.
  } as Unsafe as Awaited<ReturnType<typeof getTasksByIdsRepo>>[number];
}

/** A member of the project who is NOT a lead - the ordinary case. */
function signedInAsMember(isLead = false) {
  mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.MEMBER));
  mockGetProjectForMember.mockResolvedValue(project({ isLead }));
}

function signedInAsAdmin() {
  mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.ADMIN, "admin-1"));
  mockGetProjectById.mockResolvedValue(project() as Unsafe as NonNullable<Awaited<ReturnType<typeof getProjectByIdRepo>>>);
  // An admin holds no membership row, and must not be refused for it.
  mockGetProjectForMember.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();

  mockGetPhases.mockResolvedValue([]);
  mockBoardTasks.mockResolvedValue([]);
  mockAttachmentCounts.mockResolvedValue([]);
  mockLoggedByTask.mockResolvedValue([]);
  mockTaskEntries.mockResolvedValue([]);
  mockEstimateChanges.mockResolvedValue([]);
  mockGetAttachments.mockResolvedValue([]);
  mockGetUsers.mockResolvedValue([]);
  mockGetPhase.mockResolvedValue(phase());
  mockGetProjectMember.mockResolvedValue(undefined);
  mockAddTask.mockResolvedValue(card() as Unsafe as Awaited<ReturnType<typeof addTaskRepo>>);
  mockUpdateTask.mockResolvedValue(card() as Unsafe as Awaited<ReturnType<typeof updateTaskRepo>>);
  mockMoveTask.mockResolvedValue(card() as Unsafe as Awaited<ReturnType<typeof moveTaskRepo>>);
  mockDeleteTask.mockResolvedValue({ deleted: true, storageKeysToClear: [] });
  mockAssignedTasks.mockResolvedValue([]);
});

// -------------------------------------------------------------------
// The two pure helpers, asserted directly. Both produce a number or an
// order that renders as plausible either way, so a wrong answer here does
// not look like a failure anywhere else.
// -------------------------------------------------------------------
describe("placeIdAtPosition", () => {
  it("moves a card within its own column to the slot it was dropped in", () => {
    expect(placeIdAtPosition(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
  });

  it("clamps a position past the end of a column that has since shrunk", () => {
    expect(placeIdAtPosition(["a", "b"], "c", 99)).toEqual(["a", "b", "c"]);
  });

  it("clamps a negative position to the top", () => {
    expect(placeIdAtPosition(["a", "b"], "c", -5)).toEqual(["c", "a", "b"]);
  });

  it("always includes the moved card, which the repository requires", () => {
    expect(placeIdAtPosition([], "a", 0)).toEqual(["a"]);
  });
});

describe("mapEstimateChange", () => {
  const base = {
    id: "change-1",
    taskId: "task-2",
    fromTaskId: "task-1",
    minutes: 120,
    reason: "Moved to the migration",
    changedBy: "user-1",
    changedByName: "Ada",
    fromTaskTitle: "Model the warehouse",
    createdAt: new Date("2026-06-02T00:00:00Z"),
  };

  it("negates the minutes on a transfer read from the task they LEFT", () => {
    const line = mapEstimateChange({
      ...base,
      direction: "out",
      counterpartTaskId: "task-2",
      counterpartTaskTitle: "Migrate the loads",
    } as Unsafe as Parameters<typeof mapEstimateChange>[0]);

    // Stored positive because the row describes the receiver. Rendered as
    // stored it would read as an ADDITION on the task whose estimate just
    // went down.
    expect(line.minutes).toBe(-120);
    expect(line.counterpartTaskTitle).toBe("Migrate the loads");
  });

  it("keeps the minutes as stored on the receiving side", () => {
    const line = mapEstimateChange({
      ...base,
      direction: "in",
      counterpartTaskId: "task-1",
      counterpartTaskTitle: "Model the warehouse",
    } as Unsafe as Parameters<typeof mapEstimateChange>[0]);

    expect(line.minutes).toBe(120);
  });

  it("keeps a reduction negative on a plain adjustment", () => {
    const line = mapEstimateChange({
      ...base,
      minutes: -60,
      fromTaskId: null,
      fromTaskTitle: null,
      direction: "in",
      counterpartTaskId: null,
      counterpartTaskTitle: null,
    } as Unsafe as Parameters<typeof mapEstimateChange>[0]);

    expect(line.minutes).toBe(-60);
    expect(line.counterpartTaskId).toBeNull();
  });
});

describe("getProjectBoardService", () => {
  it("gives every phase all four columns, in board order, even when empty", async () => {
    signedInAsMember();
    mockGetPhases.mockResolvedValue([
      phase(),
      phase({ id: "phase-2", name: "Build", position: 1 }),
    ]);

    const board = await getProjectBoardService(PROJECT_ID);

    expect(board.phases).toHaveLength(2);

    for (const boardPhase of board.phases) {
      expect(boardPhase.columns.map((column) => column.column)).toEqual([...TASK_COLUMN_ORDER]);
    }
  });

  it("puts each card in its own phase and column with its batched totals", async () => {
    signedInAsMember();
    mockGetPhases.mockResolvedValue([phase()]);
    mockBoardTasks.mockResolvedValue([
      card(),
      card({ id: "task-2", boardColumn: TASK_COLUMNS.BLOCKED, position: 0 }),
    ]);
    mockLoggedByTask.mockResolvedValue([{ taskId: "task-1", minutes: 90 }]);
    mockAttachmentCounts.mockResolvedValue([{ taskId: "task-1", attachmentCount: 2 }]);

    const board = await getProjectBoardService(PROJECT_ID);
    const columns = board.phases[0].columns;

    const todo = columns.find((column) => column.column === TASK_COLUMNS.TODO);
    const blocked = columns.find((column) => column.column === TASK_COLUMNS.BLOCKED);

    expect(todo?.tasks.map((task) => task.id)).toEqual(["task-1"]);
    expect(todo?.tasks[0].loggedMinutes).toBe(90);
    expect(todo?.tasks[0].attachmentCount).toBe(2);

    // Absent from both grouped reads means nought, not undefined: a card
    // with no time and no files has no row to group.
    expect(blocked?.tasks[0].loggedMinutes).toBe(0);
    expect(blocked?.tasks[0].attachmentCount).toBe(0);
  });

  it("reads the board once, not once per phase or per card", async () => {
    signedInAsMember();
    mockGetPhases.mockResolvedValue([phase(), phase({ id: "phase-2", position: 1 })]);
    mockBoardTasks.mockResolvedValue([card(), card({ id: "task-2", phaseId: "phase-2" })]);

    await getProjectBoardService(PROJECT_ID);

    expect(mockBoardTasks).toHaveBeenCalledTimes(1);
    expect(mockLoggedByTask).toHaveBeenCalledTimes(1);
    expect(mockAttachmentCounts).toHaveBeenCalledTimes(1);
  });

  it("answers not found for a project the caller has no membership row for", async () => {
    mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.MEMBER));
    mockGetProjectForMember.mockResolvedValue(undefined);

    await expect(getProjectBoardService(PROJECT_ID)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockBoardTasks).not.toHaveBeenCalled();
  });

  it("does not require an admin to be a member", async () => {
    signedInAsAdmin();
    mockGetPhases.mockResolvedValue([phase()]);

    const board = await getProjectBoardService(PROJECT_ID);

    expect(board.canEditTasks).toBe(true);
  });

  it("tells an ordinary member they may not edit, and a lead that they may", async () => {
    signedInAsMember(false);
    expect((await getProjectBoardService(PROJECT_ID)).canEditTasks).toBe(false);

    vi.clearAllMocks();
    signedInAsMember(true);
    mockGetPhases.mockResolvedValue([]);
    expect((await getProjectBoardService(PROJECT_ID)).canEditTasks).toBe(true);
  });
});

describe("getTaskDetailService", () => {
  it("sums the logged total from the entries it already shows", async () => {
    signedInAsMember();
    mockGetTasksByIds.mockResolvedValue([card({ estimateMinutes: 240 })]);
    mockTaskEntries.mockResolvedValue([
      { id: "e1", taskId: "task-1", userId: "user-1", userName: "Ada", workDate: "2026-06-01", minutes: 60, notes: null, createdAt: new Date() },
      { id: "e2", taskId: "task-1", userId: "user-2", userName: "Grace", workDate: "2026-06-02", minutes: 30, notes: null, createdAt: new Date() },
    ] as Unsafe as Awaited<ReturnType<typeof getTimeEntriesForTaskRepo>>);

    const detail = await getTaskDetailService("task-1");

    expect(detail.task.loggedMinutes).toBe(90);
    expect(detail.rollup.budgetMinutes).toBe(240);
    expect(detail.rollup.loggedMinutes).toBe(90);
    expect(detail.timeEntries).toHaveLength(2);
    // A calendar date stays a string all the way to the DTO.
    expect(detail.timeEntries[0].workDate).toBe("2026-06-01");
  });

  it("answers not found for a task in a project the caller is not on", async () => {
    mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.MEMBER));
    mockGetTasksByIds.mockResolvedValue([card()]);
    mockGetProjectForMember.mockResolvedValue(undefined);

    await expect(getTaskDetailService("task-1")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockTaskEntries).not.toHaveBeenCalled();
  });

  it("names the uploader of each file", async () => {
    signedInAsMember();
    mockGetTasksByIds.mockResolvedValue([card()]);
    mockGetAttachments.mockResolvedValue([
      { id: "a1", taskId: "task-1", fileName: "scope.pdf", mediaType: "application/pdf", byteSize: 10, uploadedBy: "user-2", createdAt: new Date() },
      { id: "a2", taskId: "task-1", fileName: "notes.txt", mediaType: "text/plain", byteSize: 10, uploadedBy: null, createdAt: new Date() },
    ] as Unsafe as Awaited<ReturnType<typeof getTaskAttachmentsRepo>>);
    mockGetUsers.mockResolvedValue([{ id: "user-2", name: "Grace" }] as Unsafe as Awaited<ReturnType<typeof getUsersByIdsRepo>>);

    const detail = await getTaskDetailService("task-1");

    expect(detail.attachments.map((file) => file.uploadedByName)).toEqual(["Grace", null]);
    // One query for however many uploaders, not one per file.
    expect(mockGetUsers).toHaveBeenCalledTimes(1);
  });
});

describe("createTaskService", () => {
  const request = {
    phaseId: PHASE_ID,
    title: "Model the warehouse",
    description: null,
    estimateHours: 480,
    boardColumn: TASK_COLUMNS.TODO,
  } as Unsafe as Parameters<typeof createTaskService>[0];

  it("refuses a member who is not a lead", async () => {
    signedInAsMember(false);

    await expect(createTaskService(request)).rejects.toThrow(/lead or an admin/);
    expect(mockAddTask).not.toHaveBeenCalled();
  });

  it("refuses an assignee who is not on the project", async () => {
    signedInAsMember(true);
    mockGetProjectMember.mockResolvedValue(undefined);

    await expect(
      createTaskService({ ...request, assigneeId: "outsider-1" } as Unsafe as Parameters<typeof createTaskService>[0]),
    ).rejects.toThrow(/not on this project/);
    expect(mockAddTask).not.toHaveBeenCalled();
  });

  it("appends the card after the last one in its column", async () => {
    signedInAsMember(true);
    mockBoardTasks.mockResolvedValue([
      card({ id: "task-1", position: 0 }),
      card({ id: "task-2", position: 3 }),
      // Another column's card must not move the new one down.
      card({ id: "task-3", boardColumn: TASK_COLUMNS.DONE, position: 9 }),
    ]);

    await createTaskService(request);

    expect(mockAddTask).toHaveBeenCalledWith(
      expect.objectContaining({ position: 4, projectId: PROJECT_ID, phaseId: PHASE_ID }),
    );
  });

  it("stores the schema's converted minutes, and the actor from the session", async () => {
    signedInAsMember(true);

    await createTaskService(request);

    expect(mockAddTask).toHaveBeenCalledWith(
      expect.objectContaining({ estimateMinutes: 480, createdBy: "user-1" }),
    );
  });
});

describe("updateTaskService", () => {
  const request = {
    taskId: "task-1",
    title: "Model the warehouse",
    description: null,
    assigneeId: null,
  } as Unsafe as Parameters<typeof updateTaskService>[0];

  beforeEach(() => {
    mockGetTask.mockResolvedValue(card() as Unsafe as Awaited<ReturnType<typeof getTaskRepo>>);
  });

  it("refuses a member who is not a lead", async () => {
    signedInAsMember(false);

    await expect(updateTaskService(request)).rejects.toThrow(/lead or an admin/);
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it("writes only the three editable fields, scoped to the project", async () => {
    signedInAsMember(true);

    await updateTaskService(request);

    expect(mockUpdateTask).toHaveBeenCalledWith("task-1", PROJECT_ID, {
      title: "Model the warehouse",
      description: null,
      assigneeId: null,
    });
  });

  it("checks a new assignee is a project member", async () => {
    signedInAsMember(true);
    mockGetProjectMember.mockResolvedValue(undefined);

    await expect(
      updateTaskService({ ...request, assigneeId: "outsider-1" } as Unsafe as Parameters<typeof updateTaskService>[0]),
    ).rejects.toThrow(/not on this project/);
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });
});

describe("moveTaskService", () => {
  const request = {
    taskId: "task-2",
    phaseId: PHASE_ID,
    boardColumn: TASK_COLUMNS.IN_PROGRESS,
    position: 1,
  } as Unsafe as Parameters<typeof moveTaskService>[0];

  beforeEach(() => {
    mockGetTask.mockResolvedValue(card({ id: "task-2" }) as Unsafe as Awaited<ReturnType<typeof getTaskRepo>>);
  });

  it("hands the repository the destination column's whole ordered list", async () => {
    signedInAsMember(true);
    mockBoardTasks.mockResolvedValue([
      card({ id: "task-a", boardColumn: TASK_COLUMNS.IN_PROGRESS, position: 0 }),
      card({ id: "task-b", boardColumn: TASK_COLUMNS.IN_PROGRESS, position: 1 }),
      card({ id: "task-c", boardColumn: TASK_COLUMNS.TODO, position: 0 }),
    ]);

    await moveTaskService(request);

    expect(mockMoveTask).toHaveBeenCalledWith({
      taskId: "task-2",
      projectId: PROJECT_ID,
      phaseId: PHASE_ID,
      boardColumn: TASK_COLUMNS.IN_PROGRESS,
      orderedTaskIds: ["task-a", "task-2", "task-b"],
    });
  });

  it("refuses a destination phase in another project", async () => {
    signedInAsMember(true);
    mockGetPhase.mockResolvedValue(phase({ projectId: "project-2" }));

    await expect(moveTaskService(request)).rejects.toThrow(/phase is no longer available/);
    expect(mockMoveTask).not.toHaveBeenCalled();
  });

  it("refuses a member who is not a lead", async () => {
    signedInAsMember(false);

    await expect(moveTaskService(request)).rejects.toThrow(/lead or an admin/);
    expect(mockMoveTask).not.toHaveBeenCalled();
  });
});

describe("deleteTaskService", () => {
  const request = { taskId: "task-1" } as Unsafe as Parameters<typeof deleteTaskService>[0];

  beforeEach(() => {
    mockGetTask.mockResolvedValue(card() as Unsafe as Awaited<ReturnType<typeof getTaskRepo>>);
  });

  it("refuses in words when time has been logged, and touches nothing", async () => {
    signedInAsMember(true);
    mockTaskEntries.mockResolvedValue([
      { id: "e1", taskId: "task-1", minutes: 30 },
    ] as Unsafe as Awaited<ReturnType<typeof getTimeEntriesForTaskRepo>>);

    await expect(deleteTaskService(request)).rejects.toThrow(/time logged against it/);
    expect(mockDeleteTask).not.toHaveBeenCalled();
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it("clears the attachment blobs the repository handed back", async () => {
    signedInAsMember(true);
    mockDeleteTask.mockResolvedValue({
      deleted: true,
      storageKeysToClear: ["delivery/project-1/task-1/a1", "delivery/project-1/task-1/a2"],
    });

    await deleteTaskService(request);

    expect(mockDeleteBlob.mock.calls.map((call) => call[0])).toEqual([
      "delivery/project-1/task-1/a1",
      "delivery/project-1/task-1/a2",
    ]);
  });

  it("refuses a member who is not a lead", async () => {
    signedInAsMember(false);

    await expect(deleteTaskService(request)).rejects.toThrow(/lead or an admin/);
    expect(mockDeleteTask).not.toHaveBeenCalled();
  });
});

describe("getMyWorkService", () => {
  it("asks for the session user's own cards, without done and without archived projects", async () => {
    mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.MEMBER));

    await getMyWorkService();

    const [userId, filter] = mockAssignedTasks.mock.calls[0];

    expect(userId).toBe("user-1");
    expect(filter?.boardColumns).not.toContain(TASK_COLUMNS.DONE);
    expect(filter?.projectStatuses).not.toContain(PROJECT_STATUSES.ARCHIVED);
    // A completed project can still hold open work, and hiding it is how
    // that work goes missing.
    expect(filter?.projectStatuses).toContain(PROJECT_STATUSES.COMPLETED);
  });

  it("carries the client and project a card belongs to, with its logged total", async () => {
    mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.MEMBER));
    mockAssignedTasks.mockResolvedValue([card({ id: "task-1" })]);
    mockLoggedByTask.mockResolvedValue([{ taskId: "task-1", minutes: 45 }]);

    const work = await getMyWorkService();

    expect(work).toEqual([
      expect.objectContaining({
        taskId: "task-1",
        clientName: "Perks",
        projectTitle: "Data platform",
        loggedMinutes: 45,
      }),
    ]);
  });

  it("reads logged minutes once per project rather than once per card", async () => {
    mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.MEMBER));
    mockAssignedTasks.mockResolvedValue([
      card({ id: "task-1" }),
      card({ id: "task-2" }),
      card({ id: "task-3", projectId: "project-2" }),
    ]);

    await getMyWorkService();

    expect(mockLoggedByTask).toHaveBeenCalledTimes(2);
  });
});

describe("deleteTaskAttachmentService", () => {
  const attachment = {
    id: "a1",
    taskId: "task-1",
    projectId: PROJECT_ID,
    storageKey: "delivery/project-1/task-1/a1",
    fileName: "scope.pdf",
    mediaType: "application/pdf",
    byteSize: 10,
    uploadedBy: "user-2",
    createdAt: new Date(),
  } as Unsafe as NonNullable<Awaited<ReturnType<typeof getTaskAttachmentRepo>>>;

  it("refuses somebody who neither uploaded it nor leads the project", async () => {
    signedInAsMember(false);
    mockGetAttachment.mockResolvedValue(attachment);

    await expect(deleteTaskAttachmentService("a1")).rejects.toThrow(/person who attached a file/);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
    expect(mockDeleteAttachmentRow).not.toHaveBeenCalled();
  });

  it("lets the uploader remove their own file, blob first", async () => {
    signedInAsMember(false);
    mockGetAttachment.mockResolvedValue({ ...attachment, uploadedBy: "user-1" } as typeof attachment);
    mockDeleteAttachmentRow.mockResolvedValue("delivery/project-1/task-1/a1");

    await deleteTaskAttachmentService("a1");

    expect(mockDeleteBlob).toHaveBeenCalledWith("delivery/project-1/task-1/a1");
    expect(mockDeleteAttachmentRow).toHaveBeenCalledWith("a1", "task-1");
    expect(mockDeleteBlob.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteAttachmentRow.mock.invocationCallOrder[0],
    );
  });

  it("lets a lead remove somebody else's file", async () => {
    signedInAsMember(true);
    mockGetAttachment.mockResolvedValue(attachment);
    mockDeleteAttachmentRow.mockResolvedValue("delivery/project-1/task-1/a1");

    await expect(deleteTaskAttachmentService("a1")).resolves.toBeUndefined();
  });
});
