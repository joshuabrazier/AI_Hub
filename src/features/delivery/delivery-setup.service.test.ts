import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PROJECT_STATUSES,
  RATE_BANDS,
  USER_ROLES,
  type Client,
  type UserRole,
} from "@/lib/data/kysely-database-types";
import type { PhaseTimeLogged } from "@/lib/data/repositories/phases.repository";

// -------------------------------------------------------------------
// The setup service: the pure rules it owns, and every gate in front of
// them, with the repositories mocked.
//
// TWO KINDS OF TEST LIVE HERE AND THEY ARE ASSERTING TWO DIFFERENT THINGS.
//
// The pure helpers at the bottom are rules: what a typed client name means,
// and the two questions a phase delete has to answer. Every one of them
// fails SILENTLY when it is wrong - a mis-decided client name attaches a
// project to the wrong client, a mis-decided time check hands somebody a
// foreign key violation, and a mis-counted file check orphans a client's
// document in blob storage with nothing anywhere to say it happened.
//
// The rest is AUTHORIZATION, and it is asserted for a sharper reason: this
// file decides who may create a client, who may put somebody on a project
// and at what rate band, and who may restructure a board. A widened guard
// here is not a bug in a screen, it is one client's team editing another
// client's project - and nothing about it looks wrong from the outside,
// because the screen simply works.
//
// So the mocked `requireUserRole` below ENFORCES the role list it is handed
// rather than waving it through. That is the whole reason these tests bite:
// a guard dropped from a service, or widened to include managers, reaches
// its write and fails a refusal instead of passing it quietly.
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

vi.mock("better-auth", () => ({ generateId: () => "generated-id" }));

vi.mock("@/lib/auth/session-auth-server", () => ({
  requireUser: vi.fn(),
  requireUserRole: vi.fn(),
}));

vi.mock("@/lib/audit/audit-log.service", () => ({ recordAuditEvent: vi.fn() }));

vi.mock("@/lib/data/repositories/clients.repository", () => ({
  addClientRepo: vi.fn(),
  countProjectsForClientRepo: vi.fn(),
  getClientByIdRepo: vi.fn(),
  getClientByNameRepo: vi.fn(),
  getClientsRepo: vi.fn(),
  updateClientByIdRepo: vi.fn(),
}));

vi.mock("@/lib/data/repositories/phases.repository", () => ({
  addPhaseRepo: vi.fn(),
  deletePhaseRepo: vi.fn(),
  getPhaseRepo: vi.fn(),
  getPhaseTimeLoggedRepo: vi.fn(),
  getPhasesForProjectRepo: vi.fn(),
  renamePhaseRepo: vi.fn(),
  reorderPhasesForProjectRepo: vi.fn(),
}));

vi.mock("@/lib/data/repositories/projects.repository", () => ({
  addProjectBudgetGroupRepo: vi.fn(),
  addProjectMemberRepo: vi.fn(),
  addProjectRepo: vi.fn(),
  deleteProjectBudgetGroupRepo: vi.fn(),
  // NOT imported by the service, and mocked deliberately - see the nav
  // tests. It is the read a widened "my projects" would reach for, and a
  // mock that answered [] would make that mistake invisible.
  getAllProjectsRepo: vi.fn(),
  getProjectBudgetGroupRepo: vi.fn(),
  getProjectBudgetGroupsRepo: vi.fn(),
  getProjectByIdRepo: vi.fn(),
  getProjectForMemberRepo: vi.fn(),
  getProjectMembersRepo: vi.fn(),
  getProjectsForUserRepo: vi.fn(),
  markProjectBudgetAssignedRepo: vi.fn(),
  removeProjectMemberRepo: vi.fn(),
  setProjectBudgetGroupMembersRepo: vi.fn(),
  setProjectMembersRepo: vi.fn(),
  updateProjectBudgetGroupRepo: vi.fn(),
  updateProjectMemberRepo: vi.fn(),
  updateProjectRepo: vi.fn(),
}));

vi.mock("@/lib/data/repositories/tasks.repository", () => ({
  getAttachmentCountsForProjectRepo: vi.fn(),
  getPhaseEstimateMinutesRepo: vi.fn(),
  getProjectBoardTasksRepo: vi.fn(),
  getProjectEstimateMinutesRepo: vi.fn(),
}));

vi.mock("@/lib/data/repositories/time-entries.repository", () => ({
  getLoggedMinutesByPhaseRepo: vi.fn(),
  getLoggedMinutesByProjectRepo: vi.fn(),
  getLoggedMinutesByUserForProjectRepo: vi.fn(),
}));

vi.mock("@/lib/data/repositories/users.repository", () => ({ getUsersByIdsRepo: vi.fn() }));

import { requireUser, requireUserRole } from "@/lib/auth/session-auth-server";
import {
  addClientRepo,
  countProjectsForClientRepo,
  getClientByIdRepo,
  getClientByNameRepo,
  getClientsRepo,
  updateClientByIdRepo,
} from "@/lib/data/repositories/clients.repository";
import {
  addPhaseRepo,
  deletePhaseRepo,
  getPhaseRepo,
  getPhaseTimeLoggedRepo,
  getPhasesForProjectRepo,
  renamePhaseRepo,
  reorderPhasesForProjectRepo,
} from "@/lib/data/repositories/phases.repository";
import {
  addProjectBudgetGroupRepo,
  addProjectMemberRepo,
  addProjectRepo,
  deleteProjectBudgetGroupRepo,
  getAllProjectsRepo,
  getProjectBudgetGroupRepo,
  getProjectBudgetGroupsRepo,
  getProjectByIdRepo,
  getProjectForMemberRepo,
  getProjectMembersRepo,
  getProjectsForUserRepo,
  markProjectBudgetAssignedRepo,
  removeProjectMemberRepo,
  setProjectBudgetGroupMembersRepo,
  setProjectMembersRepo,
  updateProjectBudgetGroupRepo,
  updateProjectMemberRepo,
  updateProjectRepo,
} from "@/lib/data/repositories/projects.repository";
import {
  getAttachmentCountsForProjectRepo,
  getPhaseEstimateMinutesRepo,
  getProjectBoardTasksRepo,
  getProjectEstimateMinutesRepo,
} from "@/lib/data/repositories/tasks.repository";
import {
  getLoggedMinutesByPhaseRepo,
  getLoggedMinutesByProjectRepo,
  getLoggedMinutesByUserForProjectRepo,
} from "@/lib/data/repositories/time-entries.repository";
import { getUsersByIdsRepo } from "@/lib/data/repositories/users.repository";

import {
  addProjectMemberService,
  archiveProjectService,
  attachmentsUnderPhase,
  createBudgetGroupService,
  createClientService,
  createPhaseService,
  createProjectService,
  deactivateClientService,
  deleteBudgetGroupService,
  deletePhaseService,
  getClientDetailService,
  getClientOptionsService,
  getClientsService,
  getMyProjectsService,
  getProjectBudgetGroupsService,
  getProjectDetailService,
  markProjectBudgetAssignedService,
  phaseAttachmentRefusal,
  phaseDeletionRefusal,
  removeProjectMemberService,
  renamePhaseService,
  reorderPhasesService,
  setBudgetGroupMembersService,
  setProjectMembersService,
  typedClientOutcome,
  updateBudgetGroupService,
  updateClientService,
  updateProjectMemberService,
  updateProjectService,
} from "./delivery-setup.service";
// The second gate now lives in the contract file, because the board and time
// services need the same answer. The assertions below are unchanged and stay
// here: they were written against this behaviour, and moving the function is
// not a reason to stop checking it.
import { canEditProjectTasks } from "./delivery.types";

const mockRequireUser = vi.mocked(requireUser);
const mockRequireUserRole = vi.mocked(requireUserRole);
const mockAddClient = vi.mocked(addClientRepo);
const mockCountProjectsForClient = vi.mocked(countProjectsForClientRepo);
const mockGetClientById = vi.mocked(getClientByIdRepo);
const mockGetClientByName = vi.mocked(getClientByNameRepo);
const mockGetClients = vi.mocked(getClientsRepo);
const mockUpdateClient = vi.mocked(updateClientByIdRepo);
const mockAddPhase = vi.mocked(addPhaseRepo);
const mockDeletePhase = vi.mocked(deletePhaseRepo);
const mockGetPhase = vi.mocked(getPhaseRepo);
const mockGetPhaseTimeLogged = vi.mocked(getPhaseTimeLoggedRepo);
const mockGetPhases = vi.mocked(getPhasesForProjectRepo);
const mockRenamePhase = vi.mocked(renamePhaseRepo);
const mockReorderPhases = vi.mocked(reorderPhasesForProjectRepo);
const mockAddBudgetGroup = vi.mocked(addProjectBudgetGroupRepo);
const mockAddProjectMember = vi.mocked(addProjectMemberRepo);
const mockAddProject = vi.mocked(addProjectRepo);
const mockDeleteBudgetGroup = vi.mocked(deleteProjectBudgetGroupRepo);
const mockGetAllProjects = vi.mocked(getAllProjectsRepo);
const mockGetBudgetGroup = vi.mocked(getProjectBudgetGroupRepo);
const mockGetBudgetGroups = vi.mocked(getProjectBudgetGroupsRepo);
const mockGetProjectById = vi.mocked(getProjectByIdRepo);
const mockGetProjectForMember = vi.mocked(getProjectForMemberRepo);
const mockGetProjectMembers = vi.mocked(getProjectMembersRepo);
const mockGetProjectsForUser = vi.mocked(getProjectsForUserRepo);
const mockMarkBudgetAssigned = vi.mocked(markProjectBudgetAssignedRepo);
const mockRemoveProjectMember = vi.mocked(removeProjectMemberRepo);
const mockSetBudgetGroupMembers = vi.mocked(setProjectBudgetGroupMembersRepo);
const mockSetProjectMembers = vi.mocked(setProjectMembersRepo);
const mockUpdateBudgetGroup = vi.mocked(updateProjectBudgetGroupRepo);
const mockUpdateProjectMember = vi.mocked(updateProjectMemberRepo);
const mockUpdateProject = vi.mocked(updateProjectRepo);
const mockAttachmentCounts = vi.mocked(getAttachmentCountsForProjectRepo);
const mockPhaseEstimates = vi.mocked(getPhaseEstimateMinutesRepo);
const mockBoardTasks = vi.mocked(getProjectBoardTasksRepo);
const mockProjectEstimate = vi.mocked(getProjectEstimateMinutesRepo);
const mockLoggedByPhase = vi.mocked(getLoggedMinutesByPhaseRepo);
const mockLoggedByProject = vi.mocked(getLoggedMinutesByProjectRepo);
const mockLoggedByUser = vi.mocked(getLoggedMinutesByUserForProjectRepo);
const mockGetUsersByIds = vi.mocked(getUsersByIdsRepo);

// -------------------------------------------------------------------
// Fixtures. Cast rather than fully built: these stand in for database rows,
// and typing out every column of six tables would bury what each test is
// about.
// -------------------------------------------------------------------
type Unsafe = Parameters<typeof expect>[0];

const PROJECT_ID = "project-1";
const OTHER_PROJECT_ID = "project-2";
const CLIENT_ID = "client-1";
const PHASE_ID = "phase-1";
const GROUP_ID = "group-1";
const ADMIN_ID = "admin-1";
const MEMBER_ID = "user-1";
const OUTSIDER_ID = "outsider-1";

// requireUserRole redirects to /error/forbidden, and redirect() throws in
// Next. The mock below stands in for that throw, so a role refusal is
// recognisable in an assertion.
const FORBIDDEN = /NEXT_REDIRECT/;

// Both non-admin roles, every time. A MANAGER is the trap: their scope
// elsewhere in the app comes from the teams an admin assigned them, and
// reading that as "manages projects too" would hand every manager every
// client's project.
const NON_ADMIN_ROLES: UserRole[] = [USER_ROLES.MEMBER, USER_ROLES.MANAGER];

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: CLIENT_ID,
    name: "Perks",
    notes: null,
    isActive: true,
    createdBy: ADMIN_ID,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function logged(overrides: Partial<PhaseTimeLogged> = {}): PhaseTimeLogged {
  return { taskCount: 0, timeEntryCount: 0, loggedMinutes: 0, ...overrides };
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    clientId: CLIENT_ID,
    clientName: "Perks",
    title: "Data platform",
    description: null,
    isBillable: true,
    status: PROJECT_STATUSES.ACTIVE,
    budgetAssignedAt: null,
    createdBy: ADMIN_ID,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as Unsafe as NonNullable<Awaited<ReturnType<typeof getProjectByIdRepo>>>;
}

// The membership join: the same project, plus what THIS caller is on it.
function projectForMember(overrides: Record<string, unknown> = {}) {
  return {
    ...(project() as Unsafe as Record<string, unknown>),
    isLead: false,
    rateBand: RATE_BANDS.STANDARD,
    ...overrides,
  } as Unsafe as NonNullable<Awaited<ReturnType<typeof getProjectForMemberRepo>>>;
}

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    clientId: CLIENT_ID,
    clientName: "Perks",
    title: "Data platform",
    status: PROJECT_STATUSES.ACTIVE,
    isBillable: true,
    isLead: false,
    rateBand: RATE_BANDS.STANDARD,
    ...overrides,
  } as Unsafe as Awaited<ReturnType<typeof getProjectsForUserRepo>>[number];
}

function budgetGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: GROUP_ID,
    projectId: PROJECT_ID,
    name: "Interns",
    budgetMinutes: 24_000,
    position: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as Unsafe as NonNullable<Awaited<ReturnType<typeof getProjectBudgetGroupRepo>>>;
}

function groupWithMembers(overrides: Record<string, unknown> = {}) {
  return {
    ...(budgetGroup() as Unsafe as Record<string, unknown>),
    members: [
      { groupId: GROUP_ID, userId: MEMBER_ID, name: "Adelaide Lovelace", preferredName: "Ada", email: "ada@example.com" },
    ],
    ...overrides,
  } as Unsafe as Awaited<ReturnType<typeof getProjectBudgetGroupsRepo>>[number];
}

function phase(overrides: Record<string, unknown> = {}) {
  return {
    id: PHASE_ID,
    projectId: PROJECT_ID,
    name: "Discovery",
    position: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as Unsafe as NonNullable<Awaited<ReturnType<typeof getPhaseRepo>>>;
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: MEMBER_ID,
    name: "Adelaide Lovelace",
    preferredName: "Ada",
    email: "ada@example.com",
    role: USER_ROLES.MEMBER,
    isActive: true,
    deidentifiedAt: null,
    ...overrides,
  } as Unsafe as Awaited<ReturnType<typeof getUsersByIdsRepo>>[number];
}

function projectMember(overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT_ID,
    userId: MEMBER_ID,
    isLead: false,
    rateBand: RATE_BANDS.STANDARD,
    name: "Adelaide Lovelace",
    preferredName: "Ada",
    email: "ada@example.com",
    isActive: true,
    ...overrides,
  } as Unsafe as Awaited<ReturnType<typeof getProjectMembersRepo>>[number];
}

function sessionUser(role: UserRole, id: string) {
  return { id, role, name: "Ada" } as Unsafe as Awaited<ReturnType<typeof requireUser>>;
}

/** Whoever is asking, at whatever role. Says nothing about a project. */
function signedInAs(role: UserRole, id = role === USER_ROLES.ADMIN ? ADMIN_ID : MEMBER_ID): void {
  mockRequireUser.mockResolvedValue(sessionUser(role, id));
}

function signedInAsAdmin(): void {
  signedInAs(USER_ROLES.ADMIN);
  mockGetProjectById.mockResolvedValue(project());
  // An admin holds no membership row, and must not be refused for it.
  mockGetProjectForMember.mockResolvedValue(undefined);
}

/** On the project, at `role`, lead or not. */
function signedInAsProjectMember(isLead: boolean, role: UserRole = USER_ROLES.MEMBER): void {
  signedInAs(role);
  mockGetProjectForMember.mockResolvedValue(projectForMember({ isLead }));
}

/** Signed in, and not on the project at all: the membership read misses. */
function signedInAsOutsider(role: UserRole = USER_ROLES.MEMBER): void {
  signedInAs(role, OUTSIDER_ID);
  mockGetProjectForMember.mockResolvedValue(undefined);
}

// The mocked guard, which ENFORCES the list it is handed. Applied in
// beforeEach and again wherever a test clears the mocks mid-way.
function guardEnforcesRoles(): void {
  mockRequireUserRole.mockImplementation(async (allowedRoles) => {
    const user = await mockRequireUser();

    if (!allowedRoles.includes(user.role)) {
      throw new Error("NEXT_REDIRECT /error/forbidden");
    }

    return user;
  });
}

// The request shapes, built once. Every `*Hours` field holds MINUTES by the
// time a service sees it - the schema converted it at the boundary.
const CREATE_CLIENT = { name: "Perks", notes: null };
const UPDATE_CLIENT = { clientId: CLIENT_ID, name: "Perks", notes: null, isActive: true };
const CREATE_PROJECT = {
  client: { mode: "new" as const, name: "Perks" },
  title: "Data platform",
  description: null,
  isBillable: true,
};
const UPDATE_PROJECT = {
  projectId: PROJECT_ID,
  title: "Data platform",
  description: null,
  isBillable: true,
  status: PROJECT_STATUSES.ACTIVE,
};
const MEMBER_REQUEST = {
  projectId: PROJECT_ID,
  userId: MEMBER_ID,
  isLead: false,
  rateBand: RATE_BANDS.STANDARD,
};

// Every repository answer a success path needs. A function rather than the
// body of beforeEach, because two tests clear the mocks part-way through.
function repositoryDefaults(): void {
  mockGetClientById.mockResolvedValue(client());
  mockGetClientByName.mockResolvedValue(undefined);
  mockGetClients.mockResolvedValue([]);
  mockAddClient.mockResolvedValue(client());
  mockUpdateClient.mockResolvedValue(client());
  mockCountProjectsForClient.mockResolvedValue(0);

  mockGetProjectById.mockResolvedValue(project());
  mockGetProjectForMember.mockResolvedValue(undefined);
  mockGetProjectsForUser.mockResolvedValue([]);
  mockAddProject.mockResolvedValue(project());
  mockUpdateProject.mockResolvedValue(project());
  mockMarkBudgetAssigned.mockResolvedValue(project());
  // Answered NON-EMPTY on purpose. A "my projects" read that widened for an
  // admin would come back with this in it, and a mock that answered []
  // would let that mistake pass.
  mockGetAllProjects.mockResolvedValue([project()] as Unsafe as Awaited<ReturnType<typeof getAllProjectsRepo>>);

  mockGetProjectMembers.mockResolvedValue([projectMember()]);
  mockSetProjectMembers.mockResolvedValue({ addedUserIds: [], removedUserIds: [] });
  mockAddProjectMember.mockResolvedValue({ projectId: PROJECT_ID, userId: MEMBER_ID } as Unsafe as Awaited<
    ReturnType<typeof addProjectMemberRepo>
  >);
  mockUpdateProjectMember.mockResolvedValue({ projectId: PROJECT_ID, userId: MEMBER_ID } as Unsafe as Awaited<
    ReturnType<typeof updateProjectMemberRepo>
  >);
  mockRemoveProjectMember.mockResolvedValue(1);
  mockGetUsersByIds.mockResolvedValue([account()]);

  mockGetBudgetGroup.mockResolvedValue(budgetGroup());
  mockGetBudgetGroups.mockResolvedValue([]);
  mockAddBudgetGroup.mockResolvedValue(budgetGroup());
  mockUpdateBudgetGroup.mockResolvedValue(budgetGroup());
  mockDeleteBudgetGroup.mockResolvedValue(1);
  mockSetBudgetGroupMembers.mockResolvedValue(undefined);

  mockGetPhase.mockResolvedValue(phase());
  mockGetPhases.mockResolvedValue([]);
  mockAddPhase.mockResolvedValue(phase());
  mockRenamePhase.mockResolvedValue(phase());
  mockReorderPhases.mockResolvedValue([phase()]);
  mockDeletePhase.mockResolvedValue(1);
  mockGetPhaseTimeLogged.mockResolvedValue(logged());

  mockBoardTasks.mockResolvedValue([]);
  mockAttachmentCounts.mockResolvedValue([]);
  mockPhaseEstimates.mockResolvedValue([]);
  mockProjectEstimate.mockResolvedValue(0);
  mockLoggedByPhase.mockResolvedValue([]);
  mockLoggedByProject.mockResolvedValue([]);
  mockLoggedByUser.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  guardEnforcesRoles();
  repositoryDefaults();
});

// -------------------------------------------------------------------
// ===================================================================
// EVERY ADMIN-ONLY SURFACE, REFUSED
// ===================================================================
//
// Clients, projects, membership and budget groups are admin-only, and most
// of this file has NO scope filter as a result - that is the role check's
// decision rather than an omission, which is exactly why the role check has
// to be asserted on every one of them. A dropped guard on any of these
// leaves a function that reads and writes across every client in the
// organisation with nothing else standing in the way.
//
// Each case also asserts that NOTHING WAS READ OR WRITTEN. The guard runs
// first on purpose: a role failure carries no information about what
// exists, and a check moved below the lookup would still refuse while
// having already answered "does this id exist" through its timing.
// -------------------------------------------------------------------
type AdminOnlySurface = {
  what: string;
  guard: string;
  run: () => Promise<unknown>;
  expectUntouched: () => void;
};

const ADMIN_ONLY_SURFACES: AdminOnlySurface[] = [
  {
    what: "listing clients",
    guard: "requireUserRole([ADMIN])",
    run: () => getClientsService(),
    expectUntouched: () => expect(mockGetClients).not.toHaveBeenCalled(),
  },
  {
    what: "the client picker",
    guard: "requireUserRole([ADMIN])",
    run: () => getClientOptionsService(),
    expectUntouched: () => expect(mockGetClients).not.toHaveBeenCalled(),
  },
  {
    what: "opening one client",
    guard: "requireUserRole([ADMIN])",
    run: () => getClientDetailService(CLIENT_ID),
    expectUntouched: () => expect(mockGetClientById).not.toHaveBeenCalled(),
  },
  {
    what: "creating a client",
    guard: "requireUserRole([ADMIN])",
    run: () => createClientService({ ...CREATE_CLIENT }),
    expectUntouched: () => {
      expect(mockAddClient).not.toHaveBeenCalled();
      expect(mockGetClientByName).not.toHaveBeenCalled();
    },
  },
  {
    what: "renaming, retiring or restoring a client",
    guard: "requireUserRole([ADMIN])",
    run: () => updateClientService({ ...UPDATE_CLIENT }),
    expectUntouched: () => expect(mockUpdateClient).not.toHaveBeenCalled(),
  },
  {
    what: "retiring a client",
    guard: "requireUserRole([ADMIN])",
    run: () => deactivateClientService({ clientId: CLIENT_ID }),
    expectUntouched: () => expect(mockUpdateClient).not.toHaveBeenCalled(),
  },
  {
    what: "creating a project",
    guard: "requireUserRole([ADMIN])",
    run: () => createProjectService({ ...CREATE_PROJECT }),
    expectUntouched: () => {
      expect(mockAddProject).not.toHaveBeenCalled();
      // The client is resolved inside the same call and a typed name
      // CREATES one, so a dropped guard here would let a member add a
      // client as a side effect of a project that was never made.
      expect(mockAddClient).not.toHaveBeenCalled();
    },
  },
  {
    what: "editing a project",
    guard: "requireAdminProject -> requireUserRole([ADMIN])",
    run: () => updateProjectService({ ...UPDATE_PROJECT }),
    expectUntouched: () => {
      expect(mockUpdateProject).not.toHaveBeenCalled();
      expect(mockGetProjectById).not.toHaveBeenCalled();
    },
  },
  {
    what: "archiving a project",
    guard: "requireAdminProject -> requireUserRole([ADMIN])",
    run: () => archiveProjectService({ projectId: PROJECT_ID }),
    expectUntouched: () => expect(mockUpdateProject).not.toHaveBeenCalled(),
  },
  {
    what: "stamping the budget as assigned",
    guard: "requireAdminProject -> requireUserRole([ADMIN])",
    run: () => markProjectBudgetAssignedService({ projectId: PROJECT_ID }),
    expectUntouched: () => expect(mockMarkBudgetAssigned).not.toHaveBeenCalled(),
  },
  {
    what: "replacing a project's whole member set",
    guard: "requireAdminProject -> requireUserRole([ADMIN])",
    run: () =>
      setProjectMembersService({
        projectId: PROJECT_ID,
        members: [{ userId: MEMBER_ID, isLead: false, rateBand: RATE_BANDS.STANDARD }],
      }),
    expectUntouched: () => expect(mockSetProjectMembers).not.toHaveBeenCalled(),
  },
  {
    what: "putting one person on a project",
    guard: "requireAdminProject -> requireUserRole([ADMIN])",
    run: () => addProjectMemberService({ ...MEMBER_REQUEST }),
    expectUntouched: () => expect(mockAddProjectMember).not.toHaveBeenCalled(),
  },
  {
    what: "changing somebody's lead flag or rate band",
    guard: "requireAdminProject -> requireUserRole([ADMIN])",
    run: () => updateProjectMemberService({ ...MEMBER_REQUEST }),
    expectUntouched: () => expect(mockUpdateProjectMember).not.toHaveBeenCalled(),
  },
  {
    what: "taking somebody off a project",
    guard: "requireAdminProject -> requireUserRole([ADMIN])",
    run: () => removeProjectMemberService({ projectId: PROJECT_ID, userId: MEMBER_ID }),
    expectUntouched: () => expect(mockRemoveProjectMember).not.toHaveBeenCalled(),
  },
  {
    what: "creating a budget group",
    guard: "requireAdminProject -> requireUserRole([ADMIN])",
    run: () => createBudgetGroupService({ projectId: PROJECT_ID, name: "Interns", budgetHours: 24_000 }),
    expectUntouched: () => expect(mockAddBudgetGroup).not.toHaveBeenCalled(),
  },
  {
    what: "renaming a budget group or changing its pool",
    guard: "requireAdminBudgetGroup -> requireUserRole([ADMIN])",
    run: () => updateBudgetGroupService({ groupId: GROUP_ID, name: "Interns", budgetHours: 24_000 }),
    expectUntouched: () => {
      expect(mockUpdateBudgetGroup).not.toHaveBeenCalled();
      expect(mockGetBudgetGroup).not.toHaveBeenCalled();
    },
  },
  {
    what: "deleting a budget group",
    guard: "requireAdminBudgetGroup -> requireUserRole([ADMIN])",
    run: () => deleteBudgetGroupService({ groupId: GROUP_ID }),
    expectUntouched: () => expect(mockDeleteBudgetGroup).not.toHaveBeenCalled(),
  },
  {
    what: "setting who is in a budget group",
    guard: "requireAdminBudgetGroup -> requireUserRole([ADMIN])",
    run: () => setBudgetGroupMembersService({ groupId: GROUP_ID, userIds: [MEMBER_ID] }),
    expectUntouched: () => expect(mockSetBudgetGroupMembers).not.toHaveBeenCalled(),
  },
];

describe("the admin-only surfaces", () => {
  for (const surface of ADMIN_ONLY_SURFACES) {
    it(`refuses a member and a manager: ${surface.what} is gated by ${surface.guard}`, async () => {
      for (const role of NON_ADMIN_ROLES) {
        signedInAs(role);

        await expect(surface.run()).rejects.toThrow(FORBIDDEN);
        surface.expectUntouched();
      }
    });
  }

  it("lets an admin through every one of them", async () => {
    // The other half of the pair, and not a formality: a guard asserted only
    // by its refusals is satisfied by a function that refuses everybody, and
    // an admin-only module locked against admins passes every test above.
    for (const surface of ADMIN_ONLY_SURFACES) {
      vi.clearAllMocks();
      guardEnforcesRoles();
      repositoryDefaults();
      signedInAsAdmin();

      await expect(surface.run()).resolves.not.toThrow();
    }
  });
});

// -------------------------------------------------------------------
// ===================================================================
// THE PHASE MUTATIONS: THE SECOND GATE
// ===================================================================
//
// The one part of this file that is NOT admin-only, and the only place
// `is_lead` decides a write here. Two failures are worth a test each and
// they point opposite ways: a gate that reads membership as permission lets
// any member of a project restructure its board, and a gate that reads the
// admin role as the only way in makes a lead's own board read-only while
// the screen goes on offering the buttons.
// -------------------------------------------------------------------
type PhaseMutation = {
  what: string;
  act: string;
  run: () => Promise<unknown>;
  expectUntouched: () => void;
};

const PHASE_MUTATIONS: PhaseMutation[] = [
  {
    what: "adding a phase",
    act: "adding a phase to it",
    run: () => createPhaseService({ projectId: PROJECT_ID, name: "Discovery" }),
    expectUntouched: () => expect(mockAddPhase).not.toHaveBeenCalled(),
  },
  {
    what: "renaming a phase",
    act: "renaming one of its phases",
    run: () => renamePhaseService({ phaseId: PHASE_ID, name: "Build" }),
    expectUntouched: () => expect(mockRenamePhase).not.toHaveBeenCalled(),
  },
  {
    what: "reordering the phases",
    act: "reordering its phases",
    run: () => reorderPhasesService({ projectId: PROJECT_ID, phaseIds: [PHASE_ID] }),
    expectUntouched: () => expect(mockReorderPhases).not.toHaveBeenCalled(),
  },
  {
    what: "deleting a phase",
    act: "deleting one of its phases",
    run: () => deletePhaseService({ phaseId: PHASE_ID }),
    expectUntouched: () => expect(mockDeletePhase).not.toHaveBeenCalled(),
  },
];

describe("the phase mutations, gated by requireProjectStructureAccess", () => {
  for (const mutation of PHASE_MUTATIONS) {
    it(`refuses an ordinary MEMBER of the project: ${mutation.what}`, async () => {
      signedInAsProjectMember(false);

      // A scope failure about a project they can already see, so it says so
      // plainly - and "ask a lead" is advice they can act on. This is the
      // gate a widened `canEditTasks` would open to every member of every
      // project, and nothing asserted it before.
      await expect(mutation.run()).rejects.toThrow(/Only a project lead or an administrator/);
      mutation.expectUntouched();
    });

    it(`lets the project's LEAD do it: ${mutation.what}`, async () => {
      signedInAsProjectMember(true);

      await expect(mutation.run()).resolves.not.toThrow();
    });

    it(`refuses a MANAGER who is only a member: ${mutation.what}`, async () => {
      // The trap. A manager's scope elsewhere comes from the teams an admin
      // assigned them; this module's boundary is project membership, and
      // reading the role as delivery authority hands every manager every
      // project in the organisation.
      signedInAsProjectMember(false, USER_ROLES.MANAGER);

      await expect(mutation.run()).rejects.toThrow(/Only a project lead or an administrator/);
      mutation.expectUntouched();
    });
  }

  it("lets an admin restructure a project they are not a member of", async () => {
    signedInAsAdmin();

    await expect(createPhaseService({ projectId: PROJECT_ID, name: "Discovery" })).resolves.toBe(PHASE_ID);
    expect(mockAddPhase).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJECT_ID }));
    // Their editing rights do not come from a membership row, so the
    // membership read is not what let them in - and they are not refused
    // for the absence of one.
    expect(mockGetProjectForMember).not.toHaveBeenCalled();
  });

  it("refuses a LEAD on an ARCHIVED project, naming the act they attempted", async () => {
    for (const mutation of PHASE_MUTATIONS) {
      vi.clearAllMocks();
      guardEnforcesRoles();
      repositoryDefaults();
      signedInAs(USER_ROLES.MEMBER);
      mockGetProjectForMember.mockResolvedValue(
        projectForMember({ isLead: true, status: PROJECT_STATUSES.ARCHIVED }),
      );

      // Archiving is this module's soft delete, so a phase built on an
      // archived project is a heading on a board nobody can log an hour
      // against. Each act names itself, because "that is no longer
      // possible" is a shrug.
      await expect(mutation.run()).rejects.toThrow(
        new RegExp(`archived, so ${mutation.act} is no longer possible`),
      );
      mutation.expectUntouched();
    }
  });

  it("resolves the phase's project from the ROW, so a foreign phase id buys nothing", async () => {
    // The phase id came off the browser. The project it belongs to is read
    // from the row and the caller is authorised against THAT - so handing
    // over another project's phase id is refused by the membership read
    // rather than let through on the caller's own lead flag.
    signedInAs(USER_ROLES.MEMBER);
    mockGetPhase.mockResolvedValue(phase({ projectId: OTHER_PROJECT_ID }));
    mockGetProjectForMember.mockResolvedValue(undefined);

    await expect(renamePhaseService({ phaseId: PHASE_ID, name: "Build" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockGetProjectForMember).toHaveBeenCalledWith(OTHER_PROJECT_ID, MEMBER_ID);
    expect(mockRenamePhase).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------
// ===================================================================
// A NON-MEMBER GETS THE SAME ANSWER AS A MISSING ID
// ===================================================================
//
// The enumeration-oracle rule. Replying "you are not on that project" to a
// guessed id confirms the project exists, which turns a page route into a
// list of every client's projects one request at a time. notFound() is the
// answer an id that never existed gets, and the two must stay
// indistinguishable from outside.
// -------------------------------------------------------------------
describe("a project the caller is not on", () => {
  it("answers notFound() for the project page rather than a refusal that admits it exists", async () => {
    signedInAsOutsider();

    await expect(getProjectDetailService(PROJECT_ID)).rejects.toThrow("NEXT_NOT_FOUND");
    // Nothing about the project was read, so nothing about it can leak
    // through a partial DTO or a timing difference either.
    expect(mockGetPhases).not.toHaveBeenCalled();
    expect(mockGetProjectMembers).not.toHaveBeenCalled();
  });

  it("gives a non-member and a missing id the SAME answer", async () => {
    // Both go through the membership join, which returns undefined either
    // way. Asserted rather than assumed, because the tempting
    // "optimisation" is an existence check on the project first, whose
    // refusal would differ - and one differing sentence is the whole oracle.
    signedInAsOutsider();
    const notOnIt = await getProjectDetailService(PROJECT_ID).catch((error: Error) => error.message);

    signedInAsOutsider();
    const doesNotExist = await getProjectDetailService("no-such-project").catch(
      (error: Error) => error.message,
    );

    expect(notOnIt).toBe("NEXT_NOT_FOUND");
    expect(doesNotExist).toBe(notOnIt);
  });

  it("answers notFound() for a phase mutation rather than the lead refusal", async () => {
    // The ORDER of the two gates is what is being asserted. Membership is
    // resolved first, so somebody who is not on the project never reaches
    // the sentence naming a lead - and that sentence is an admission the
    // project exists.
    signedInAsOutsider();

    const message = await createPhaseService({ projectId: PROJECT_ID, name: "Discovery" }).catch(
      (error: Error) => error.message,
    );

    expect(message).toBe("NEXT_NOT_FOUND");
    expect(message).not.toMatch(/lead/i);
    expect(mockAddPhase).not.toHaveBeenCalled();
  });

  it("answers notFound() for the budget groups of a project they are not on", async () => {
    signedInAsOutsider();

    await expect(getProjectBudgetGroupsService(PROJECT_ID)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockGetBudgetGroups).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------
// ===================================================================
// AN EMPTY SCOPE IS NOTHING, NOT EVERYTHING
// ===================================================================
// -------------------------------------------------------------------
describe("getMyProjectsService", () => {
  it("shows no projects to somebody on none, and asks with the SESSION id", async () => {
    signedInAs(USER_ROLES.MEMBER);
    mockGetProjectsForUser.mockResolvedValue([]);

    await expect(getMyProjectsService()).resolves.toEqual([]);
    // The actor comes from the session. There is no id in this call to be
    // tempted by, and that is the point of the shape.
    expect(mockGetProjectsForUser).toHaveBeenCalledWith(MEMBER_ID, { sort: "alphabetical" });
  });

  it("does not widen to every project for an ADMIN on no projects", async () => {
    // The nav is "my projects". An admin who is on two and administers forty
    // wants the two - and the failure that matters is the other direction:
    // an unscoped read here puts every client's project in every admin's
    // sidebar and makes the empty case unreachable.
    signedInAs(USER_ROLES.ADMIN);
    mockGetProjectsForUser.mockResolvedValue([]);

    await expect(getMyProjectsService()).resolves.toEqual([]);
    expect(mockGetAllProjects).not.toHaveBeenCalled();
  });

  it("marks a lead's project editable and an ordinary member's not", async () => {
    signedInAs(USER_ROLES.MEMBER);
    mockGetProjectsForUser.mockResolvedValue([
      membership({ id: "project-lead", isLead: true }),
      membership({ id: "project-plain", isLead: false }),
    ]);

    const projects = await getMyProjectsService();

    expect(projects.map((row) => [row.id, row.canEditTasks])).toEqual([
      ["project-lead", true],
      ["project-plain", false],
    ]);
  });

  it("marks every one of an admin's own projects editable, lead or not", async () => {
    signedInAs(USER_ROLES.ADMIN);
    mockGetProjectsForUser.mockResolvedValue([membership({ isLead: false })]);

    const projects = await getMyProjectsService();

    expect(projects[0].canEditTasks).toBe(true);
  });
});

// -------------------------------------------------------------------
// ===================================================================
// A BUDGET GROUP IS AUTHORISED AGAINST ITS OWN PROJECT
// ===================================================================
//
// Every mutation here is handed a GROUP ID and nothing else, because that is
// what the forms have. So the project is resolved from the group ROW and the
// caller authorised against THAT - and the reason it matters is that the
// alternative does not fail safe: a project id carried in from elsewhere in
// the request matches no row on the updates but hits the composite foreign
// key on a member insert, so a guessed pair surfaces as a database error
// instead of a refusal.
// -------------------------------------------------------------------
describe("the budget group mutations", () => {
  beforeEach(() => {
    // The group belongs to a DIFFERENT project from the one the fixtures
    // default to, so every assertion below tells "resolved from the group"
    // apart from "the project that happened to be lying about".
    mockGetBudgetGroup.mockResolvedValue(budgetGroup({ projectId: OTHER_PROJECT_ID }));
    mockGetProjectById.mockResolvedValue(project({ id: OTHER_PROJECT_ID }));
    mockUpdateBudgetGroup.mockResolvedValue(budgetGroup({ projectId: OTHER_PROJECT_ID }));
  });

  it("resolves the project from the GROUP ID and writes against that project", async () => {
    signedInAs(USER_ROLES.ADMIN);

    await updateBudgetGroupService({ groupId: GROUP_ID, name: "Principals", budgetHours: 3_000 });

    expect(mockGetBudgetGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(mockGetProjectById).toHaveBeenCalledWith(OTHER_PROJECT_ID);
    // Keyed on BOTH ids, so a group id belonging to another project matches
    // nothing. `budgetHours` already holds minutes; a second multiplication
    // here is the mistake the field's name invites.
    expect(mockUpdateBudgetGroup).toHaveBeenCalledWith(GROUP_ID, OTHER_PROJECT_ID, {
      name: "Principals",
      budgetMinutes: 3_000,
    });
  });

  it("deletes against the group's own project id too", async () => {
    signedInAs(USER_ROLES.ADMIN);

    await deleteBudgetGroupService({ groupId: GROUP_ID });

    expect(mockDeleteBudgetGroup).toHaveBeenCalledWith(GROUP_ID, OTHER_PROJECT_ID);
  });

  it("checks the people against the GROUP's project, and refuses a stranger without naming them", async () => {
    signedInAs(USER_ROLES.ADMIN);
    mockGetProjectMembers.mockResolvedValue([projectMember({ projectId: OTHER_PROJECT_ID })]);

    const message = await setBudgetGroupMembersService({
      groupId: GROUP_ID,
      userIds: [MEMBER_ID, OUTSIDER_ID],
    }).catch((error: Error) => error.message);

    expect(mockGetProjectMembers).toHaveBeenCalledWith(OTHER_PROJECT_ID);
    expect(message).toMatch(/not on this project/);
    // An id that is not on the project did not come from this screen, so
    // echoing it back is an account oracle.
    expect(message).not.toContain(OUTSIDER_ID);
    expect(mockSetBudgetGroupMembers).not.toHaveBeenCalled();
  });

  it("writes the group's own project id alongside the member set", async () => {
    signedInAs(USER_ROLES.ADMIN);
    mockGetProjectMembers.mockResolvedValue([projectMember({ projectId: OTHER_PROJECT_ID })]);

    await setBudgetGroupMembersService({ groupId: GROUP_ID, userIds: [MEMBER_ID] });

    expect(mockSetBudgetGroupMembers).toHaveBeenCalledWith(GROUP_ID, OTHER_PROJECT_ID, [MEMBER_ID]);
  });

  it("says so in words when the group has gone, and writes nothing", async () => {
    signedInAs(USER_ROLES.ADMIN);
    mockGetBudgetGroup.mockResolvedValue(undefined);

    await expect(
      updateBudgetGroupService({ groupId: GROUP_ID, name: "Interns", budgetHours: 60 }),
    ).rejects.toThrow(/budget group no longer exists/);
    expect(mockUpdateBudgetGroup).not.toHaveBeenCalled();
    // A sentence rather than notFound(): an admin's scope is every project,
    // so there is nothing here to enumerate.
    expect(mockGetProjectById).not.toHaveBeenCalled();
  });

  it("says so in words when the group's project has gone, and writes nothing", async () => {
    signedInAs(USER_ROLES.ADMIN);
    mockGetProjectById.mockResolvedValue(undefined);

    await expect(deleteBudgetGroupService({ groupId: GROUP_ID })).rejects.toThrow(/project no longer exists/);
    expect(mockDeleteBudgetGroup).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------
// ===================================================================
// MONEY IS ABSENT FROM THE SETUP VIEWS, NOT NULL
// ===================================================================
//
// The module's money convention, from this side of it: a viewer who may not
// see cents gets no KEY at all, because null already means something else
// here - a non-billable project, an uncosted rate, an hour nobody has
// valued. A component cannot tell "unknown" from "not for you", so the two
// are never allowed to look alike.
//
// THE SETUP VIEW CARRIES NO MONEY FOR ANYBODY, ADMIN INCLUDED. Cents are the
// budget report's work under its own guard in delivery-rates.service.ts, and
// this is the absence half of the convention - it can be asserted here
// because the money fields are OPTIONAL on BudgetGroupReportDTO. A version
// of this service that attached cents for an admin "since they may see them
// anyway" type-checks perfectly and fails only this test.
//
// ASSERTED ON THE KEY, never on the value: `toBeNull()` would pass against
// exactly the bug being guarded against.
// -------------------------------------------------------------------
describe("getProjectBudgetGroupsService", () => {
  beforeEach(() => {
    mockGetBudgetGroups.mockResolvedValue([groupWithMembers()]);
  });

  it("carries NO money for an admin - the keys are absent, not null", async () => {
    signedInAsAdmin();

    const [group] = await getProjectBudgetGroupsService(PROJECT_ID);

    expect("chargeableCents" in group).toBe(false);
    expect("costCents" in group).toBe(false);
    expect("marginCents" in group).toBe(false);
  });

  it("carries no money for a member either", async () => {
    signedInAsProjectMember(false);

    const [group] = await getProjectBudgetGroupsService(PROJECT_ID);

    expect("chargeableCents" in group).toBe(false);
    expect("costCents" in group).toBe(false);
  });

  it("pools the minutes of the group's OWN people, counting an absent one as nought", async () => {
    signedInAsAdmin();
    mockGetBudgetGroups.mockResolvedValue([
      groupWithMembers({
        members: [
          { groupId: GROUP_ID, userId: MEMBER_ID, name: "Ada", preferredName: null, email: "ada@example.com" },
          { groupId: GROUP_ID, userId: "user-2", name: "Grace", preferredName: null, email: "grace@example.com" },
        ],
      }),
    ]);
    // A pooled budget's spend IS the sum of its people's, and somebody who
    // has logged nothing is ABSENT from the grouped read rather than present
    // as a zero. The second member is that case.
    mockLoggedByUser.mockResolvedValue([
      { userId: MEMBER_ID, minutes: 90 },
      // Somebody on the project and in no group. Their time is the
      // project's, and it is not this pool's.
      { userId: "user-9", minutes: 500 },
    ]);

    const [group] = await getProjectBudgetGroupsService(PROJECT_ID);

    expect(group.rollup.loggedMinutes).toBe(90);
    expect(mockLoggedByUser).toHaveBeenCalledWith(PROJECT_ID);
  });
});

// -------------------------------------------------------------------
// ===================================================================
// THE PURE RULES
// ===================================================================
//
// The decisions in the setup service that are worth asserting on their
// own: the second gate, what a typed client name means, and the two
// questions a phase delete has to answer - whether there is time under it,
// and whether there are files under it.
// -------------------------------------------------------------------

describe("canEditProjectTasks", () => {
  it("lets an admin edit without being a lead", () => {
    expect(canEditProjectTasks(USER_ROLES.ADMIN, false)).toBe(true);
  });

  it("lets a project lead edit", () => {
    expect(canEditProjectTasks(USER_ROLES.MEMBER, true)).toBe(true);
  });

  it("refuses an ordinary member of the project", () => {
    // They still log time against tasks that exist; what they cannot do is
    // create, move or delete one.
    expect(canEditProjectTasks(USER_ROLES.MEMBER, false)).toBe(false);
  });

  it("gives a MANAGER nothing extra", () => {
    // The trap. A manager's scope elsewhere in the app comes from the teams
    // an admin assigned them, and reading that as "manages projects too"
    // would hand every manager every project in the organisation.
    expect(canEditProjectTasks(USER_ROLES.MANAGER, false)).toBe(false);
    // A manager who IS a lead may edit - because of the lead row, not the
    // role.
    expect(canEditProjectTasks(USER_ROLES.MANAGER, true)).toBe(true);
  });
});

describe("typedClientOutcome", () => {
  it("creates when nothing exists under that name", () => {
    expect(typedClientOutcome(undefined)).toEqual({ kind: "create" });
  });

  it("reuses an existing active client rather than failing on the index", () => {
    // The whole point of create-or-reuse: "Perks already exists" is not an
    // error from the point of view of somebody who just wants the project
    // made.
    expect(typedClientOutcome(client())).toEqual({ kind: "reuse" });
  });

  it("refuses a RETIRED match, and names it", () => {
    const outcome = typedClientOutcome(client({ isActive: false, name: "Perks Group" }));

    expect(outcome.kind).toBe("refuse");

    // Named rather than silently reused: somebody deliberately took that
    // client out of circulation, and a second one cannot be created because
    // the unique index covers retired rows too - so the message has to say
    // which client and what to do about it.
    if (outcome.kind === "refuse") {
      expect(outcome.message).toContain("Perks Group");
      expect(outcome.message).toContain("Restore it");
    }
  });
});

describe("phaseDeletionRefusal", () => {
  it("allows a phase with no time logged, tasks or not", () => {
    expect(phaseDeletionRefusal("Discovery", logged())).toBeNull();
    // Cards but no hours: the tasks cascade away and nothing refuses.
    expect(phaseDeletionRefusal("Discovery", logged({ taskCount: 4 }))).toBeNull();
  });

  it("refuses on the ENTRY COUNT and says how much time is there", () => {
    const refusal = phaseDeletionRefusal("Discovery", logged({ taskCount: 2, timeEntryCount: 3, loggedMinutes: 150 }));

    expect(refusal).toContain("Discovery");
    // The clock form, so the sentence reads as a duration rather than as a
    // count of minutes.
    expect(refusal).toContain("2h 30m");
  });

  it("still refuses when the minutes sum to nothing but rows exist", () => {
    // RESTRICT cares about the ROWS. Deciding this on `loggedMinutes` would
    // offer a delete Postgres then refuses, which is exactly the constraint
    // error this function exists to prevent.
    expect(phaseDeletionRefusal("Discovery", logged({ timeEntryCount: 1, loggedMinutes: 0 }))).not.toBeNull();
  });
});

// -------------------------------------------------------------------
// The other half of a phase delete: the files.
//
// This pair fails SILENTLY and PERMANENTLY when it is wrong, which is why
// it is asserted at all. Nothing refuses a phase whose cards carry
// attachments - `tasks` cascades from `phases` and `task_attachments`
// cascades from `tasks`, so the rows go and the blobs stay - and with no
// reconciliation sweep over the delivery prefix, a miscounted phase means a
// client's document paid for forever with nothing pointing at it. There is
// no error anywhere to notice.
// -------------------------------------------------------------------

function task(id: string, phaseId: string): { id: string; phaseId: string } {
  return { id, phaseId };
}

describe("attachmentsUnderPhase", () => {
  it("counts only the cards in THAT phase", () => {
    // The one that matters: a project-wide read goes in, and a count for one
    // phase comes out. Summing the whole project instead would refuse every
    // phase on a project with a single file anywhere on it.
    const tasks = [task("t1", "phase-1"), task("t2", "phase-1"), task("t3", "phase-2")];
    const counts = [
      { taskId: "t1", attachmentCount: 2 },
      { taskId: "t3", attachmentCount: 5 },
    ];

    expect(attachmentsUnderPhase("phase-1", tasks, counts)).toBe(2);
    expect(attachmentsUnderPhase("phase-2", tasks, counts)).toBe(5);
  });

  it("sums several cards in one phase", () => {
    const tasks = [task("t1", "phase-1"), task("t2", "phase-1")];

    expect(
      attachmentsUnderPhase("phase-1", tasks, [
        { taskId: "t1", attachmentCount: 1 },
        { taskId: "t2", attachmentCount: 3 },
      ]),
    ).toBe(4);
  });

  it("is nought for a phase with no cards, and for cards with no files", () => {
    // A card with no files is ABSENT from the grouped read rather than
    // present as a zero, so both of these arrive as a miss.
    expect(attachmentsUnderPhase("phase-9", [task("t1", "phase-1")], [{ taskId: "t1", attachmentCount: 2 }])).toBe(0);
    expect(attachmentsUnderPhase("phase-1", [task("t1", "phase-1")], [])).toBe(0);
  });

  it("ignores a count for a card in another project", () => {
    // The counts are read per project and the tasks are read per project, so
    // this should not happen - but the reads are two round trips and a stale
    // pair must not inflate the number that decides a refusal.
    const counts = [{ taskId: "elsewhere", attachmentCount: 9 }];

    expect(attachmentsUnderPhase("phase-1", [task("t1", "phase-1")], counts)).toBe(0);
  });
});

describe("phaseAttachmentRefusal", () => {
  it("allows a phase with no files", () => {
    expect(phaseAttachmentRefusal("Discovery", 0)).toBeNull();
  });

  it("refuses on a single file, and reads as one", () => {
    const refusal = phaseAttachmentRefusal("Discovery", 1);

    expect(refusal).toContain("Discovery");
    expect(refusal).toContain("1 file is attached");
  });

  it("refuses on several, and reads as several", () => {
    // Not cosmetic: this sentence is the whole of what somebody is told, so
    // "3 files is attached" undermines the instruction that follows it.
    expect(phaseAttachmentRefusal("Discovery", 3)).toContain("3 files are attached");
  });

  it("says what to do about it", () => {
    // A refusal somebody cannot act on is just a locked door. The files have
    // to come off the cards first, and the sentence has to say so.
    expect(phaseAttachmentRefusal("Discovery", 2)).toContain("Remove them from their cards first");
  });
});

// -------------------------------------------------------------------
// The phase delete's two refusals THROUGH THE SERVICE, because a service
// that computed both of them correctly and then deleted anyway would pass
// every test above.
// -------------------------------------------------------------------
describe("deletePhaseService", () => {
  it("refuses on logged time, and deletes nothing", async () => {
    signedInAsProjectMember(true);
    mockGetPhaseTimeLogged.mockResolvedValue(logged({ taskCount: 2, timeEntryCount: 3, loggedMinutes: 150 }));

    await expect(deletePhaseService({ phaseId: PHASE_ID })).rejects.toThrow(/2h 30m/);
    expect(mockDeletePhase).not.toHaveBeenCalled();
  });

  it("refuses a phase whose cards carry files, because a cascade cannot delete a blob", async () => {
    signedInAsProjectMember(true);
    mockBoardTasks.mockResolvedValue([
      { id: "t1", phaseId: PHASE_ID } as Unsafe as Awaited<ReturnType<typeof getProjectBoardTasksRepo>>[number],
    ]);
    mockAttachmentCounts.mockResolvedValue([{ taskId: "t1", attachmentCount: 2 }]);

    await expect(deletePhaseService({ phaseId: PHASE_ID })).rejects.toThrow(/2 files are attached/);
    expect(mockDeletePhase).not.toHaveBeenCalled();
  });

  it("deletes keyed on the phase AND its project once both questions come back clear", async () => {
    signedInAsProjectMember(true);

    await deletePhaseService({ phaseId: PHASE_ID });

    expect(mockDeletePhase).toHaveBeenCalledWith(PHASE_ID, PROJECT_ID);
  });

  it("asks the time question again when the delete fails, and claims the refusal only if it says so", async () => {
    signedInAsProjectMember(true);
    mockDeletePhase.mockRejectedValue(new Error("update or delete violates foreign key constraint"));
    mockGetPhaseTimeLogged
      .mockResolvedValueOnce(logged())
      .mockResolvedValueOnce(logged({ taskCount: 1, timeEntryCount: 1, loggedMinutes: 30 }));

    // The read is not a lock, so somebody can log time between the check and
    // the delete. Rare, and entirely possible.
    await expect(deletePhaseService({ phaseId: PHASE_ID })).rejects.toThrow(/30m/);
  });

  it("rethrows the original error when the second answer does NOT say time was logged", async () => {
    signedInAsProjectMember(true);
    mockDeletePhase.mockRejectedValue(new Error("connection terminated unexpectedly"));

    // Telling somebody their phase has time logged against it when the real
    // problem was the database being unreachable sends them looking in the
    // wrong place.
    await expect(deletePhaseService({ phaseId: PHASE_ID })).rejects.toThrow(/connection terminated/);
  });
});
