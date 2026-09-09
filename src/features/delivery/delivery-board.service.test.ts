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
  openTaskAttachmentStream: vi.fn(),
  putTaskAttachment: vi.fn(),
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
  addTaskAttachmentRepo,
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
import {
  deleteTaskAttachmentBlob,
  isTaskAttachmentStorageConfigured,
  openTaskAttachmentStream,
  putTaskAttachment,
} from "@/lib/storage/task-attachment-storage";

import {
  createTaskService,
  deleteTaskAttachmentService,
  deleteTaskService,
  getMyWorkService,
  getProjectBoardService,
  getTaskAttachmentDownloadService,
  getTaskDetailForPanelService,
  getTaskDetailService,
  mapEstimateChange,
  moveTaskService,
  placeIdAtPosition,
  updateTaskService,
  uploadTaskAttachmentService,
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
const mockAddAttachmentRow = vi.mocked(addTaskAttachmentRepo);
const mockDeleteBlob = vi.mocked(deleteTaskAttachmentBlob);
const mockStorageConfigured = vi.mocked(isTaskAttachmentStorageConfigured);
const mockPutBlob = vi.mocked(putTaskAttachment);
const mockOpenBlob = vi.mocked(openTaskAttachmentStream);
const mockGetUsers = vi.mocked(getUsersByIdsRepo);

// -------------------------------------------------------------------
// Fixtures. Cast rather than fully built: these stand in for database
// rows, and typing out every column of five tables would bury what each
// test is actually about.
// -------------------------------------------------------------------
type Unsafe = Parameters<typeof expect>[0];

const PROJECT_ID = "project-1";
const PHASE_ID = "phase-1";

// -------------------------------------------------------------------
// The refusals, written out here so a test asserts the SENTENCE and not a
// substring of it.
//
// Every one of these covers two cases that must be indistinguishable: the
// thing is gone, and the thing is real but belongs to a project the caller
// is not on. A regex like /no longer available/ matches "that task is no
// longer available" AND "that project is no longer available", so it passes
// against exactly the oracle it is meant to catch - which is what happened
// here before these were pinned.
// -------------------------------------------------------------------
const TASK_MISS = "That task is no longer available.";
const PHASE_MISS = "That phase is no longer available.";
const ATTACHMENT_MISS = "That attachment is no longer available.";

// -------------------------------------------------------------------
// The exact sentence a call was refused with.
//
// `rejects.toThrow(string)` is a SUBSTRING match and
// `rejects.toThrow(new Error(...))` compares the class, which these are not
// (they are DisplayErrorMessage). Neither says what these tests need to
// say: that two refusals are the same sentence, character for character.
//
// It throws rather than returning when the call SUCCEEDS, so a test that
// stops refusing fails loudly instead of comparing undefined to undefined.
// -------------------------------------------------------------------
async function refusalFrom(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected that call to be refused, and it was not.");
}

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
  mockStorageConfigured.mockReturnValue(true);
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

  it("does not check an assignee when the patch leaves it unchanged", async () => {
    signedInAsMember(true);

    await updateTaskService({ taskId: "task-1", title: "Retitle" } as Parameters<typeof updateTaskService>[0]);

    expect(mockGetProjectMember).not.toHaveBeenCalled();
    expect(mockUpdateTask).toHaveBeenCalledWith("task-1", PROJECT_ID, {
      title: "Retitle",
      description: undefined,
      assigneeId: undefined,
    });
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

// -------------------------------------------------------------------
// THE UPLOAD.
//
// The service writes the blob itself, which is what makes most of this
// testable at all: the order of the checks against the write is the whole
// design, and a route that wrote first could not have it.
// -------------------------------------------------------------------
describe("uploadTaskAttachmentService", () => {
  // Genuine bytes, because the service SNIFFS them. A fixture that only
  // claimed to be a PDF would be refused, which is the point.
  const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n", "latin1");

  const upload = (overrides: Record<string, unknown> = {}) =>
    ({ taskId: "task-1", fileName: "scope.pdf", ...overrides }) as Unsafe as Parameters<
      typeof uploadTaskAttachmentService
    >[0];

  const storedRow = {
    id: "a1",
    taskId: "task-1",
    storageKey: "delivery/project-1/task-1/a1",
    fileName: "scope.pdf",
    mediaType: "application/pdf",
    byteSize: PDF.length,
    uploadedBy: "user-1",
    createdAt: new Date("2026-06-01T00:00:00Z"),
  } as Unsafe as Awaited<ReturnType<typeof addTaskAttachmentRepo>>;

  beforeEach(() => {
    mockGetTask.mockResolvedValue(card() as Unsafe as Awaited<ReturnType<typeof getTaskRepo>>);
    mockAddAttachmentRow.mockResolvedValue(storedRow);
  });

  it("says so when no storage is configured, before reading anything", async () => {
    signedInAsMember();
    mockStorageConfigured.mockReturnValue(false);

    await expect(uploadTaskAttachmentService(upload(), PDF)).rejects.toThrow(/not configured/);
    // The check is ahead of the task read on purpose: a misconfigured
    // environment should say so rather than fail somewhere inside the
    // Azure client with a task already loaded.
    expect(mockGetTask).not.toHaveBeenCalled();
    expect(mockPutBlob).not.toHaveBeenCalled();
  });

  it("refuses a task that is not there, and writes nothing", async () => {
    signedInAsMember();
    mockGetTask.mockResolvedValue(undefined);

    expect(await refusalFrom(() => uploadTaskAttachmentService(upload(), PDF))).toBe(TASK_MISS);
    expect(mockPutBlob).not.toHaveBeenCalled();
    expect(mockAddAttachmentRow).not.toHaveBeenCalled();
  });

  it("refuses a task on a project the caller is not on in EXACTLY the same words", async () => {
    // The two refusals have to be indistinguishable, or a caller can walk
    // task ids and learn which are real from which sentence comes back:
    // "that task is gone" for an id that never existed, "that PROJECT is
    // gone" for one that is real and simply belongs to another client.
    //
    // Asserted as the whole string rather than /no longer available/,
    // because that regex matches both sentences - it passed against the
    // very oracle it was meant to catch.
    mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.MEMBER));
    mockGetProjectForMember.mockResolvedValue(undefined);

    expect(await refusalFrom(() => uploadTaskAttachmentService(upload(), PDF))).toBe(TASK_MISS);
    expect(mockPutBlob).not.toHaveBeenCalled();
  });

  it("refuses an ARCHIVED project BEFORE the bytes are written", async () => {
    // The reason the service takes the bytes rather than a route writing
    // them first. Refusing after the write would leave a blob on the one
    // prefix whose reconciliation sweep is not wired up yet, and nothing
    // pointing at it.
    mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.MEMBER));
    mockGetProjectForMember.mockResolvedValue(project({ status: PROJECT_STATUSES.ARCHIVED }));

    await expect(uploadTaskAttachmentService(upload(), PDF)).rejects.toThrow(/archived/);
    expect(mockPutBlob).not.toHaveBeenCalled();
    expect(mockAddAttachmentRow).not.toHaveBeenCalled();
  });

  it("refuses bytes that are not a format it recognises, whatever the name says", async () => {
    signedInAsMember();

    // Named .pdf and is not one. The name never decides.
    await expect(
      uploadTaskAttachmentService(upload(), Buffer.from([0x00, 0x01, 0x02, 0x03])),
    ).rejects.toThrow(/not supported/);
    expect(mockPutBlob).not.toHaveBeenCalled();
  });

  it("records the SNIFFED type and the REAL byte count, not anything a caller said", async () => {
    signedInAsMember();

    await uploadTaskAttachmentService(upload({ fileName: "anything.docx" }), PDF);

    expect(mockAddAttachmentRow).toHaveBeenCalledWith(
      expect.objectContaining({
        // From the bytes. The name claimed a Word document.
        mediaType: "application/pdf",
        byteSize: PDF.length,
      }),
    );
  });

  it("derives the storage key from the TASK ROW's project, never the request", async () => {
    // A caller-supplied key - or a project id taken from the payload -
    // would let a row on this task address any blob in the container,
    // including another client's, while the download route authorised on
    // the task.
    signedInAsMember();
    mockGetTask.mockResolvedValue(
      card({ id: "task-9", projectId: PROJECT_ID }) as Unsafe as Awaited<ReturnType<typeof getTaskRepo>>,
    );

    await uploadTaskAttachmentService(upload({ taskId: "task-9" }), PDF);

    expect(mockPutBlob).toHaveBeenCalledWith(
      expect.stringMatching(/^delivery\/project-1\/task-9\//),
      PDF,
      "application/pdf",
    );
  });

  it("writes the BLOB first and the row second", async () => {
    // The opposite of every delete path, and deliberately: a blob with no
    // row is invisible and collectable, a row with no blob is a broken
    // attachment somebody can see and nothing will ever repair.
    signedInAsMember();

    await uploadTaskAttachmentService(upload(), PDF);

    expect(mockPutBlob.mock.invocationCallOrder[0]).toBeLessThan(
      mockAddAttachmentRow.mock.invocationCallOrder[0],
    );
  });

  it("lets an ORDINARY MEMBER attach, not just a lead", async () => {
    // Attaching is not editing the card. Somebody logging time against a
    // bug should be able to hang the screenshot of it on the same card.
    signedInAsMember(false);

    await expect(uploadTaskAttachmentService(upload(), PDF)).resolves.toEqual(
      expect.objectContaining({ fileName: "scope.pdf" }),
    );
  });
});

// -------------------------------------------------------------------
// THE DOWNLOAD.
//
// Every miss is one null, and storage is never reached before the row has
// authorised the caller.
// -------------------------------------------------------------------
describe("getTaskAttachmentDownloadService", () => {
  const attachment = {
    id: "a1",
    taskId: "task-1",
    projectId: PROJECT_ID,
    storageKey: "delivery/project-1/task-1/a1",
    fileName: "scope.pdf",
    mediaType: "application/pdf",
    byteSize: 4096,
    uploadedBy: "user-2",
    createdAt: new Date(),
  } as Unsafe as NonNullable<Awaited<ReturnType<typeof getTaskAttachmentRepo>>>;

  const opened = {
    stream: {} as Unsafe as NodeJS.ReadableStream,
    // Deliberately DIFFERENT from the row, so the assertion below can tell
    // which one the service returned.
    byteSize: 999,
    mediaType: "text/html",
  };

  it("answers null for an attachment that is not there, without touching storage", async () => {
    signedInAsMember();
    mockGetAttachment.mockResolvedValue(undefined);

    await expect(getTaskAttachmentDownloadService("a1")).resolves.toBeNull();
    expect(mockOpenBlob).not.toHaveBeenCalled();
  });

  it("answers null for a project the caller is not on, and never opens the blob", async () => {
    // The row is authorization; the blob is just bytes. Reaching storage
    // first would leak that a file exists through timing, and would fetch
    // another client's document to then throw it away.
    mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.MEMBER));
    mockGetProjectForMember.mockResolvedValue(undefined);
    mockGetAttachment.mockResolvedValue(attachment);

    await expect(getTaskAttachmentDownloadService("a1")).resolves.toBeNull();
    expect(mockOpenBlob).not.toHaveBeenCalled();
  });

  it("answers null when the row outlived its blob", async () => {
    // A real state a partial delete can leave, not a fault: the route
    // answers 404 rather than 500.
    signedInAsMember();
    mockGetAttachment.mockResolvedValue(attachment);
    mockOpenBlob.mockResolvedValue(null);

    await expect(getTaskAttachmentDownloadService("a1")).resolves.toBeNull();
  });

  it("returns the ROW's media type and size, not the blob's", async () => {
    // What the blob says about itself is whatever was set when it was
    // written. The row's type was derived by sniffing the bytes, and it is
    // the one the download route puts behind `nosniff` - taking storage's
    // word for it would serve an uploaded file as text/html from this
    // origin.
    signedInAsMember();
    mockGetAttachment.mockResolvedValue(attachment);
    mockOpenBlob.mockResolvedValue(opened);

    await expect(getTaskAttachmentDownloadService("a1")).resolves.toEqual({
      fileName: "scope.pdf",
      mediaType: "application/pdf",
      byteSize: 4096,
      stream: opened.stream,
    });
  });
});

// -------------------------------------------------------------------
// THE PANEL READ.
//
// Same query as the page read, different refusal. That difference is the
// only reason both exist, so it is what these assert.
// -------------------------------------------------------------------
describe("getTaskDetailForPanelService", () => {
  it("refuses a missing task IN WORDS rather than with notFound()", async () => {
    // notFound() thrown inside a server action is propagated by
    // unstable_rethrow and REPLACES THE PAGE, so a card a lead deleted a
    // second ago would take the whole board away.
    signedInAsMember();
    mockGetTasksByIds.mockResolvedValue([]);

    expect(await refusalFrom(() => getTaskDetailForPanelService("task-1"))).toBe(TASK_MISS);
  });

  it("gives EXACTLY the same sentence for a project the caller is not on", async () => {
    // Whole-string, not a regex: this read is reachable by anybody signed
    // in, from a board, with an id they can type - so it is the easiest
    // place in the module to walk task ids from.
    mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.MEMBER));
    mockGetProjectForMember.mockResolvedValue(undefined);
    mockGetTasksByIds.mockResolvedValue([card()]);

    expect(await refusalFrom(() => getTaskDetailForPanelService("task-1"))).toBe(TASK_MISS);
  });

  it("returns the same detail the page read does when the caller is on it", async () => {
    signedInAsMember();
    mockGetTasksByIds.mockResolvedValue([card()]);

    await expect(getTaskDetailForPanelService("task-1")).resolves.toEqual(
      expect.objectContaining({ projectId: PROJECT_ID, canEditTasks: false }),
    );
  });
});

// -------------------------------------------------------------------
// ONE REFUSAL PER THING NAMED, ACROSS EVERY MUTATION THAT RESOLVES A
// PROJECT FROM SOMETHING ELSE.
//
// These all share one shape: the caller holds an id for a task, a phase or
// an attachment, the service reads that row, and the project on it decides
// whether they may go on. So there are always TWO ways to be refused - the
// row is missing, or the project behind it is out of reach - and if they
// answer differently, the pair is an oracle: a caller learns that a guessed
// id is REAL from the fact that the second sentence came back instead of
// the first.
//
// Kept in one block rather than spread through each service's own describe,
// because the property is about the two answers AGREEING, and a test that
// only ever sees one of them cannot check that.
// -------------------------------------------------------------------
describe("a scope miss is indistinguishable from a missing row", () => {
  /** Signed in, but on no project - so every project read misses. */
  function signedInOnNothing() {
    mockRequireUser.mockResolvedValue(sessionUser(USER_ROLES.MEMBER));
    mockGetProjectForMember.mockResolvedValue(undefined);
  }

  it("updateTaskService says the same thing both ways", async () => {
    const patch = { taskId: "task-1", title: "Renamed" } as Unsafe as Parameters<typeof updateTaskService>[0];

    signedInAsMember(true);
    mockGetTask.mockResolvedValue(undefined);
    expect(await refusalFrom(() => updateTaskService(patch))).toBe(TASK_MISS);

    signedInOnNothing();
    mockGetTask.mockResolvedValue(card() as Unsafe as Awaited<ReturnType<typeof getTaskRepo>>);
    expect(await refusalFrom(() => updateTaskService(patch))).toBe(TASK_MISS);
  });

  it("moveTaskService says the same thing both ways", async () => {
    const move = {
      taskId: "task-1",
      phaseId: PHASE_ID,
      boardColumn: TASK_COLUMNS.DONE,
      position: 0,
    } as Unsafe as Parameters<typeof moveTaskService>[0];

    signedInAsMember(true);
    mockGetTask.mockResolvedValue(undefined);
    expect(await refusalFrom(() => moveTaskService(move))).toBe(TASK_MISS);

    signedInOnNothing();
    mockGetTask.mockResolvedValue(card() as Unsafe as Awaited<ReturnType<typeof getTaskRepo>>);
    expect(await refusalFrom(() => moveTaskService(move))).toBe(TASK_MISS);
  });

  it("deleteTaskService says the same thing both ways", async () => {
    const request = { taskId: "task-1" } as Unsafe as Parameters<typeof deleteTaskService>[0];

    signedInAsMember(true);
    mockGetTask.mockResolvedValue(undefined);
    expect(await refusalFrom(() => deleteTaskService(request))).toBe(TASK_MISS);

    signedInOnNothing();
    mockGetTask.mockResolvedValue(card() as Unsafe as Awaited<ReturnType<typeof getTaskRepo>>);
    expect(await refusalFrom(() => deleteTaskService(request))).toBe(TASK_MISS);
  });

  it("createTaskService answers about the PHASE, both ways", async () => {
    // A different noun from the others, and correctly so: the caller named
    // a phase here, so the answer is about a phase. What matters is that
    // ITS two cases agree with each other.
    const request = {
      phaseId: PHASE_ID,
      title: "New card",
      description: null,
      estimateHours: 60,
      assigneeId: undefined,
      boardColumn: TASK_COLUMNS.TODO,
    } as Unsafe as Parameters<typeof createTaskService>[0];

    signedInAsMember(true);
    mockGetPhase.mockResolvedValue(undefined);
    expect(await refusalFrom(() => createTaskService(request))).toBe(PHASE_MISS);

    signedInOnNothing();
    mockGetPhase.mockResolvedValue(phase());
    expect(await refusalFrom(() => createTaskService(request))).toBe(PHASE_MISS);
  });

  it("deleteTaskAttachmentService answers about the ATTACHMENT, both ways", async () => {
    signedInAsMember(true);
    mockGetAttachment.mockResolvedValue(undefined);
    expect(await refusalFrom(() => deleteTaskAttachmentService("a1"))).toBe(ATTACHMENT_MISS);

    signedInOnNothing();
    mockGetAttachment.mockResolvedValue({
      id: "a1",
      taskId: "task-1",
      projectId: PROJECT_ID,
      storageKey: "delivery/project-1/task-1/a1",
      fileName: "scope.pdf",
      mediaType: "application/pdf",
      byteSize: 10,
      uploadedBy: "user-2",
      createdAt: new Date(),
    } as Unsafe as NonNullable<Awaited<ReturnType<typeof getTaskAttachmentRepo>>>);

    expect(await refusalFrom(() => deleteTaskAttachmentService("a1"))).toBe(ATTACHMENT_MISS);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });
});
