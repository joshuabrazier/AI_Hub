import "server-only";

import { database, DBClient, runInTransaction } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import {
  PROJECT_STATUSES,
  type NewProject,
  type NewProjectBudgetGroup,
  type NewProjectMember,
  type Project,
  type ProjectBudgetGroup,
  type ProjectMember,
  type ProjectStatus,
  type RateBand,
  type UpdateProject,
  type UpdateProjectBudgetGroup,
  type UpdateProjectMember,
} from "../kysely-database-types";

// -------------------------------------------------------------------
// Projects, their members and their budget groups.
//
// FOUR TABLES IN ONE FILE, because a project is never read without also
// asking who is on it. `project_members` IS the security boundary of the
// delivery module: only somebody holding a row there sees a project, its
// board or its tasks, and an admin sees everything. Splitting the two apart
// would put the authorization predicate one import away from the read it
// authorises.
//
// MEMBERSHIP IS MANY-TO-MANY, exactly like team membership. Anything
// answering "which projects" or "who is on this" returns an ARRAY, and
// `getProjectIdsForUserRepo` returns string[] for callers to scope with
// `in`. Reading one row and treating it as "the" project would be a silent
// IDOR: Postgres does not guarantee row order without an ORDER BY, so
// somebody on four projects would get an arbitrary one per request with no
// error to notice.
//
// The only single-row reads here are keyed on (project_id, user_id) or
// (id, project_id), both of which are UNIQUE, so the question genuinely has
// one answer. Every such spot says so.
//
// Two functions take a project id and NO user id - `getProjectByIdRepo` and
// `getAllProjectsRepo`. They are the admin reads, they authorize nothing on
// their own, and the guard for them lives in the service.
//
// `getProjectBudgetGroupRepo` is a third unscoped read, and a narrower one:
// it exists so a caller holding only a group id can find out which project
// to authorise against. It says so at length.
// -------------------------------------------------------------------

// How a project list comes back. "newest" is what the setup flow wants
// (a project created two minutes ago is the one being worked on);
// "alphabetical" is what a nav somebody has lived in for a year wants.
export type ProjectSort = "newest" | "alphabetical";

// A project plus the client it is for. No screen shows a project title
// without the client name beside it - "Data platform" belongs to three
// different clients - so the join is here rather than left to a caller.
export type ProjectWithClient = Project & { clientName: string };

// What a member's read of a project returns: the project, the client, and
// THE CALLER'S OWN MEMBERSHIP. The join that authorised the read already
// had the membership row in hand, so returning `isLead` and `rateBand` from
// it saves the second query every board and task screen would otherwise
// make to find out whether the reader may edit anything.
export type ProjectForMember = ProjectWithClient & { isLead: boolean; rateBand: RateBand };

// The admin list. `memberCount` comes from a correlated subquery rather
// than a join, because a join against project_members multiplies the
// project row by its members and the count then has to be rebuilt from the
// duplicates.
export type ProjectListItem = ProjectWithClient & { memberCount: number };

// One row of the left-hand nav. Deliberately narrow: `description` can be
// several paragraphs and the nav renders a link, so pulling it would make
// the hottest query in the module carry the heaviest column in it.
//
// `isBillable` is here despite that narrowness, because it is a boolean and
// the nav's DTO requires it. Leaving it out and defaulting to `true` in the
// mapper would be wrong for precisely the internal project this module goes
// to trouble to model, and it would be wrong silently - a non-billable
// project would render with every billing affordance a client one has.
export type UserProjectMembership = {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  status: ProjectStatus;
  isBillable: boolean;
  isLead: boolean;
  rateBand: RateBand;
};

// A project member with the display fields of their user account.
// `isActive` is the ACCOUNT's status, so a lead can see that somebody
// deactivated still holds a place on the project.
export type ProjectMemberWithUser = {
  projectId: string;
  userId: string;
  isLead: boolean;
  rateBand: RateBand;
  name: string;
  preferredName: string | null;
  email: string;
  isActive: boolean;
};

// The whole member set, as a form submits it.
export type ProjectMemberInput = {
  userId: string;
  isLead: boolean;
  rateBand: RateBand;
};

// Only the two columns of project_members that are ever legitimately
// changed. An explicit shape rather than Updateable<ProjectMembers>,
// because the alternative allows project_id and user_id in a patch, and
// those two ARE the primary key.
export type ProjectMemberPatch = {
  isLead?: boolean;
  rateBand?: RateBand;
};

export type ProjectBudgetGroupMemberWithUser = {
  groupId: string;
  userId: string;
  name: string;
  preferredName: string | null;
  email: string;
};

// A budget group is meaningless without its people - "400 hours between
// them" is a statement about a named set - so the list read returns them
// together and there is no members-only accessor.
export type ProjectBudgetGroupWithMembers = ProjectBudgetGroup & {
  members: ProjectBudgetGroupMemberWithUser[];
};

// -------------------------------------------------------------------
// Projects
// -------------------------------------------------------------------

export async function addProjectRepo(newProject: NewProject, db: DBClient = database): Promise<Project> {
  try {
    return await db.insertInto("projects").values(newProject).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addProjectRepo", error);
  }
}

// -------------------------------------------------------------------
// One project by id, with no membership predicate. Undefined if it does not
// exist.
//
// This is the ADMIN read. It proves nothing about who may see the project,
// so a service reaching for it must already have established the caller is
// an admin; anything else uses `getProjectForMemberRepo`.
// -------------------------------------------------------------------
export async function getProjectByIdRepo(
  projectId: string,
  db: DBClient = database,
): Promise<ProjectWithClient | undefined> {
  try {
    return await db
      .selectFrom("projects")
      .innerJoin("clients", "clients.id", "projects.clientId")
      .selectAll("projects")
      .select("clients.name as clientName")
      .where("projects.id", "=", projectId)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getProjectByIdRepo", error);
  }
}

// -------------------------------------------------------------------
// One project, but ONLY if this user is a member of it. This is the read
// services use AS their authorization check, rather than reading first and
// checking afterwards.
//
// Undefined when they are not a member, which is the same answer a
// non-existent id gets. That is deliberate: telling somebody "forbidden"
// for a guessed id confirms the project exists and turns the route into an
// enumeration oracle. Callers answer notFound().
//
// executeTakeFirst is safe here and only here-ish: (project_id, user_id) is
// the primary key of project_members, so the inner join can match at most
// one row. That is a different question from "which projects is this user
// on", which has many answers and returns an array below.
// -------------------------------------------------------------------
export async function getProjectForMemberRepo(
  projectId: string,
  userId: string,
  db: DBClient = database,
): Promise<ProjectForMember | undefined> {
  try {
    return await db
      .selectFrom("projects")
      .innerJoin("clients", "clients.id", "projects.clientId")
      .innerJoin("projectMembers", "projectMembers.projectId", "projects.id")
      .selectAll("projects")
      .select([
        "clients.name as clientName",
        "projectMembers.isLead as isLead",
        "projectMembers.rateBand as rateBand",
      ])
      .where("projects.id", "=", projectId)
      .where("projectMembers.userId", "=", userId)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getProjectForMemberRepo", error);
  }
}

// -------------------------------------------------------------------
// THE HOTTEST QUERY IN THE MODULE: every project this user is on, for the
// left-hand nav, run on every page load. It starts from project_members so
// it can use idx_project_members_user, and joins outwards from the handful
// of rows that index returns.
//
// Archived projects are out by default. Archiving is the module's soft
// delete - time entries reference tasks, so a project is never actually
// removed - and a nav that keeps every project anybody has ever finished
// grows without limit. `includeArchived` is there for the admin-facing
// screens that genuinely want the history.
// -------------------------------------------------------------------
export async function getProjectsForUserRepo(
  userId: string,
  options: { sort?: ProjectSort; includeArchived?: boolean } = {},
  db: DBClient = database,
): Promise<UserProjectMembership[]> {
  try {
    let query = db
      .selectFrom("projectMembers as pm")
      .innerJoin("projects as p", "p.id", "pm.projectId")
      .innerJoin("clients as c", "c.id", "p.clientId")
      .select([
        "p.id as id",
        "p.clientId as clientId",
        "c.name as clientName",
        "p.title as title",
        "p.status as status",
        "p.isBillable as isBillable",
        "pm.isLead as isLead",
        "pm.rateBand as rateBand",
      ])
      .where("pm.userId", "=", userId);

    if (!options.includeArchived) {
      query = query.where("p.status", "!=", PROJECT_STATUSES.ARCHIVED);
    }

    // `p.id` last in both orderings is a stable tiebreak. Two projects
    // created in the same millisecond, or two with the same title for the
    // same client, would otherwise swap places between requests and make a
    // nav look like it was reshuffling itself.
    return await (options.sort === "newest"
      ? query.orderBy("p.createdAt", "desc").orderBy("p.id")
      : query.orderBy("p.title").orderBy("c.name").orderBy("p.id")
    ).execute();
  } catch (error) {
    throw handleError("getProjectsForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// Every project id this user is on, for the reads that span projects -
// "my tasks", a personal timesheet - where the scope is a set to filter
// with rather than a list to display.
//
// string[], never one id, and [] means NOTHING rather than everything.
// Callers scope with `in` and must return an empty result for an empty
// scope; an `in ()` with no values is also a SQL syntax error, so the
// mistake fails loudly if it is ever made.
// -------------------------------------------------------------------
export async function getProjectIdsForUserRepo(userId: string, db: DBClient = database): Promise<string[]> {
  try {
    const rows = await db
      .selectFrom("projectMembers")
      .select("projectId")
      // Deterministic, so a scope list is stable between requests.
      .orderBy("projectId")
      .where("userId", "=", userId)
      .execute();

    return rows.map((row) => row.projectId);
  } catch (error) {
    throw handleError("getProjectIdsForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// EVERY project, for an admin. No membership predicate at all, so the role
// check in the service is the only thing standing in front of it.
//
// The member count is a subquery per row rather than a second query
// stitched in the service: a project list is tens of rows, and the count is
// the column that tells an admin a project was set up but never staffed.
// -------------------------------------------------------------------
export async function getAllProjectsRepo(
  options: { sort?: ProjectSort; includeArchived?: boolean } = {},
  db: DBClient = database,
): Promise<ProjectListItem[]> {
  try {
    let query = db
      .selectFrom("projects")
      .innerJoin("clients", "clients.id", "projects.clientId")
      .selectAll("projects")
      .select((eb) => [
        "clients.name as clientName",
        eb
          .selectFrom("projectMembers")
          .whereRef("projectMembers.projectId", "=", "projects.id")
          .select((inner) => inner.fn.countAll<string>().as("count"))
          .as("memberCount"),
      ]);

    if (!options.includeArchived) {
      query = query.where("projects.status", "!=", PROJECT_STATUSES.ARCHIVED);
    }

    const rows = await (options.sort === "newest"
      ? query.orderBy("projects.createdAt", "desc").orderBy("projects.id")
      : query.orderBy("projects.title").orderBy("clients.name").orderBy("projects.id")
    ).execute();

    // count() comes back as a string because Postgres counts in bigint and
    // node-postgres will not silently narrow one.
    return rows.map(({ memberCount, ...project }) => ({
      ...project,
      memberCount: Number(memberCount ?? 0),
    }));
  } catch (error) {
    throw handleError("getAllProjectsRepo", error);
  }
}

// -------------------------------------------------------------------
// Update a project. Undefined if the id does not exist.
//
// Unscoped, because there is no such thing as a member-editable project
// field: editing is a lead-or-admin decision the service makes before
// getting here.
// -------------------------------------------------------------------
export async function updateProjectRepo(
  projectId: string,
  updateProject: UpdateProject,
  db: DBClient = database,
): Promise<Project | undefined> {
  try {
    const patch: UpdateProject = { ...updateProject };

    // Updateable<Projects> allows all of these and none is ever
    // legitimately patched. An `id` in a patch would rewrite the primary
    // key of whichever row the WHERE matched, dragging every member,
    // phase, task and time entry pointing at it onto a new id.
    delete patch.id;
    delete patch.createdAt;
    delete patch.createdBy;

    // budgetAssignedAt has its own one-way setter below. Stripped here
    // because a general patch could CLEAR it, and the whole point of the
    // column is that the setup nudge does not come back.
    delete patch.budgetAssignedAt;

    return await db
      .updateTable("projects")
      // Nothing stamps updated_at in the database, so the repository does.
      .set({ ...patch, updatedAt: new Date() })
      .where("id", "=", projectId)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateProjectRepo", error);
  }
}

// -------------------------------------------------------------------
// Stamp budget_assigned_at, but ONLY if it is still null.
//
// That predicate is the entire column. The setup screen shows a progress
// bar of how much of the budget has been allocated to tasks, and it is a
// one-time nudge rather than a rule: once somebody has finished planning it
// stops appearing, and it must NOT return if an estimate is later reduced
// below the total again.
//
// One statement, and it has to be one. Two tabs finishing setup together
// would both read "not yet assigned" and both write, and the second write
// would move the timestamp. Here the second UPDATE waits on the first row
// lock, re-evaluates the predicate against the committed row, and matches
// nothing.
//
// Undefined therefore means two different things - already stamped, or no
// such project - and neither is an error worth distinguishing: both say
// there is nothing to do.
// -------------------------------------------------------------------
export async function markProjectBudgetAssignedRepo(
  projectId: string,
  assignedAt: Date = new Date(),
  db: DBClient = database,
): Promise<Project | undefined> {
  try {
    return await db
      .updateTable("projects")
      .set({ budgetAssignedAt: assignedAt, updatedAt: new Date() })
      .where("id", "=", projectId)
      .where("budgetAssignedAt", "is", null)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("markProjectBudgetAssignedRepo", error);
  }
}

// -------------------------------------------------------------------
// Project members
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// One user's membership row for one project, or undefined if they are not
// on it. This is what a service reads to check `is_lead` before letting
// somebody create or edit a task, and to find which of their three rates
// applies here.
//
// The answer is derived from A ROW EXISTING, not from an array index:
// undefined means not a member, and there is no ordering involved for a
// caller to get wrong. Safe as a single row because (project_id, user_id)
// is the primary key.
// -------------------------------------------------------------------
export async function getProjectMemberRepo(
  projectId: string,
  userId: string,
  db: DBClient = database,
): Promise<ProjectMember | undefined> {
  try {
    return await db
      .selectFrom("projectMembers")
      .selectAll()
      .where("projectId", "=", projectId)
      .where("userId", "=", userId)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getProjectMemberRepo", error);
  }
}

// -------------------------------------------------------------------
// Everybody on one project, leads first and then by name - a project's
// leads are who you go to about it, so they belong at the top of the list
// rather than wherever the alphabet puts them.
// -------------------------------------------------------------------
export async function getProjectMembersRepo(
  projectId: string,
  db: DBClient = database,
): Promise<ProjectMemberWithUser[]> {
  try {
    return await db
      .selectFrom("projectMembers as pm")
      .innerJoin("users as u", "u.id", "pm.userId")
      .select([
        "pm.projectId as projectId",
        "pm.userId as userId",
        "pm.isLead as isLead",
        "pm.rateBand as rateBand",
        "u.name as name",
        "u.preferredName as preferredName",
        "u.email as email",
        "u.isActive as isActive",
      ])
      .where("pm.projectId", "=", projectId)
      .orderBy("pm.isLead", "desc")
      .orderBy("u.name")
      .execute();
  } catch (error) {
    throw handleError("getProjectMembersRepo", error);
  }
}

// -------------------------------------------------------------------
// Unassign the tasks of people who have just left a project, in whatever
// unit of work is removing them.
//
// THIS IS A SECURITY CLEANUP, not tidying. "My tasks" reads by assignee, and
// a task row carries its phase name, its project title and the CLIENT's
// name, so an assignment left behind keeps somebody reading four facts about
// a project they can no longer open. Membership is this module's boundary
// and that cross-project read was the one path not consulting it.
//
// TWO THINGS FIX IT AND BOTH ARE KEPT. `getTasksAssignedToUserRepo` joins
// project_members as well, so the read is safe even if a cleanup is ever
// missed on a path added later - a predicate at the point of access is the
// only defence that does not depend on every writer remembering. This
// cleanup then keeps the DATA honest rather than merely the read: without
// it a board would show a card assigned to somebody who cannot open the
// project, and a lead would be waiting on work nobody can see. Neither is
// sufficient alone, so neither is an argument for dropping the other.
//
// One UPDATE, not a read-then-write, and `assignee_id` is nulled rather than
// moved: who inherits the work is a judgement for whoever removed them, and
// guessing a lead would put a name against an estimate they never agreed to.
// Time entries are untouched - that is billing history, and removing access
// must never rewrite what somebody did.
// -------------------------------------------------------------------
async function clearAssignmentsForDepartedMembers(
  projectId: string,
  userIds: string[],
  trx: DBClient,
): Promise<void> {
  if (userIds.length === 0) return;

  await trx
    .updateTable("tasks")
    // Nothing stamps updated_at in the database, so the repository does.
    .set({ assigneeId: null, updatedAt: new Date() })
    .where("projectId", "=", projectId)
    .where("assigneeId", "in", userIds)
    .execute();
}

// -------------------------------------------------------------------
// Replace a project's whole member set in one call, and report who moved.
//
// The added and removed lists are computed rather than inferred from the
// writes, because an upsert's RETURNING cannot tell an inserted row from an
// updated one - and the removed ids are the half worth auditing: they name
// the people who just lost access to the project.
//
// THE UPSERT UPDATES ON CONFLICT, unlike addProjectMemberRepo below which
// does nothing. The difference is what the caller meant: a form submitting
// the whole set is stating the rate band and lead flag it wants, so
// ignoring them for people already on the project would silently discard
// half the edit.
//
// Departing members lose their budget group place too, and their open task
// assignments with it. Both have to happen here: neither
// project_budget_group_members nor tasks references the MEMBERSHIP row, so
// no foreign key can cascade either. Leaving the group place behind would
// keep somebody who is no longer on the project inside a pooled budget,
// where their name would still appear against hours they can no longer log.
// `clearAssignmentsForDepartedMembers` says why the assignment goes.
//
// An empty set is allowed. The database does not require a project to have
// members, and whether one must keep a lead is a rule for the service.
// -------------------------------------------------------------------
export async function setProjectMembersRepo(
  projectId: string,
  members: ProjectMemberInput[],
  db: DBClient = database,
): Promise<{ addedUserIds: string[]; removedUserIds: string[] }> {
  try {
    // Last mention of a user wins. A duplicated user id would make the
    // upsert below touch one row twice in a single statement, which
    // Postgres refuses outright ("cannot affect row a second time") - a
    // 500 for somebody who only submitted a form with a repeated pick.
    const desired = new Map(members.map((member) => [member.userId, member]));

    return await runInTransaction(db, async (trx) => {
      const existing = await trx
        .selectFrom("projectMembers")
        .select("userId")
        .where("projectId", "=", projectId)
        .execute();

      const existingUserIds = new Set(existing.map((row) => row.userId));
      const removedUserIds = [...existingUserIds].filter((userId) => !desired.has(userId)).sort();
      const addedUserIds = [...desired.keys()].filter((userId) => !existingUserIds.has(userId)).sort();

      if (removedUserIds.length > 0) {
        await clearAssignmentsForDepartedMembers(projectId, removedUserIds, trx);

        await trx
          .deleteFrom("projectBudgetGroupMembers")
          .where("projectId", "=", projectId)
          .where("userId", "in", removedUserIds)
          .execute();

        await trx
          .deleteFrom("projectMembers")
          .where("projectId", "=", projectId)
          .where("userId", "in", removedUserIds)
          .execute();
      }

      if (desired.size > 0) {
        await trx
          .insertInto("projectMembers")
          .values(
            [...desired.values()].map((member) => ({
              projectId,
              userId: member.userId,
              isLead: member.isLead,
              rateBand: member.rateBand,
            })),
          )
          .onConflict((oc) =>
            oc.columns(["projectId", "userId"]).doUpdateSet((eb) => ({
              isLead: eb.ref("excluded.isLead"),
              rateBand: eb.ref("excluded.rateBand"),
            })),
          )
          .execute();
      }

      return { addedUserIds, removedUserIds };
    });
  } catch (error) {
    throw handleError("setProjectMembersRepo", error);
  }
}

// -------------------------------------------------------------------
// Add one person to a project. Undefined if they were already on it: the
// existing row is left exactly as it is, so re-adding somebody can never
// quietly change the rate band the client is being charged or hand them a
// lead's editing rights. Use updateProjectMemberRepo when a change is what
// is intended.
// -------------------------------------------------------------------
export async function addProjectMemberRepo(
  newProjectMember: NewProjectMember,
  db: DBClient = database,
): Promise<ProjectMember | undefined> {
  try {
    return await db
      .insertInto("projectMembers")
      .values(newProjectMember)
      .onConflict((oc) => oc.columns(["projectId", "userId"]).doNothing())
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("addProjectMemberRepo", error);
  }
}

// -------------------------------------------------------------------
// Change what somebody is on a project - lead or not, and which rate band
// applies. Undefined if they are not a member.
//
// project_members has no updated_at column, so nothing is stamped here.
// That is the schema's decision, not an omission: created_at records when
// somebody joined, and there is no screen asking when their band last
// moved. The rates that reach an invoice are snapshotted on the time entry
// anyway, so changing a band never restates work already logged.
// -------------------------------------------------------------------
export async function updateProjectMemberRepo(
  projectId: string,
  userId: string,
  changes: ProjectMemberPatch,
  db: DBClient = database,
): Promise<ProjectMember | undefined> {
  try {
    const patch: UpdateProjectMember = {};
    if (changes.isLead !== undefined) patch.isLead = changes.isLead;
    if (changes.rateBand !== undefined) patch.rateBand = changes.rateBand;

    // An UPDATE with an empty SET is a SQL error, and "nothing moved" is a
    // legitimate outcome of a form where neither field was touched. Read
    // the row back so the caller gets the same shape either way.
    if (Object.keys(patch).length === 0) {
      return await getProjectMemberRepo(projectId, userId, db);
    }

    return await db
      .updateTable("projectMembers")
      .set(patch)
      .where("projectId", "=", projectId)
      .where("userId", "=", userId)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateProjectMemberRepo", error);
  }
}

// -------------------------------------------------------------------
// Take one person off a project. Returns how many rows went, so a caller
// can tell "removed" from "was not a member" without a second read.
//
// Their task assignments and their budget group place go first, in the same
// unit of work as the removal, for the reason set out on
// setProjectMembersRepo: no foreign key connects either to the membership
// row, so nothing else would clear them. Splitting them across two
// transactions would leave a window in which the row is gone and the
// assignment still reads.
//
// What is deliberately NOT touched: the time they logged. time_entries is
// billing history, and removing somebody's access must not rewrite what
// they did.
// -------------------------------------------------------------------
export async function removeProjectMemberRepo(
  projectId: string,
  userId: string,
  db: DBClient = database,
): Promise<number> {
  try {
    return await runInTransaction(db, async (trx) => {
      await clearAssignmentsForDepartedMembers(projectId, [userId], trx);

      await trx
        .deleteFrom("projectBudgetGroupMembers")
        .where("projectId", "=", projectId)
        .where("userId", "=", userId)
        .execute();

      const result = await trx
        .deleteFrom("projectMembers")
        .where("projectId", "=", projectId)
        .where("userId", "=", userId)
        .executeTakeFirst();

      return Number(result.numDeletedRows ?? 0);
    });
  } catch (error) {
    throw handleError("removeProjectMemberRepo", error);
  }
}

// -------------------------------------------------------------------
// Budget groups
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// A project's budget groups with the people in each, in board order.
//
// TWO QUERIES AND A STITCH, rather than one join. A join returns one row
// per member, so a group with nobody in it disappears (an inner join) or
// arrives with a row of nulls (a left one), and every caller then has to
// regroup the duplicates before it can render anything. An empty group is
// a real and common state - it is created before the people are picked -
// so it has to survive the read.
//
// The members query filters on project_budget_group_members.project_id
// rather than joining back through the groups, which is what that
// denormalised column is for.
// -------------------------------------------------------------------
export async function getProjectBudgetGroupsRepo(
  projectId: string,
  db: DBClient = database,
): Promise<ProjectBudgetGroupWithMembers[]> {
  try {
    const groups = await db
      .selectFrom("projectBudgetGroups")
      .selectAll()
      .where("projectId", "=", projectId)
      .orderBy("position")
      .orderBy("name")
      .execute();

    if (groups.length === 0) return [];

    const members = await db
      .selectFrom("projectBudgetGroupMembers as gm")
      .innerJoin("users as u", "u.id", "gm.userId")
      .select([
        "gm.groupId as groupId",
        "gm.userId as userId",
        "u.name as name",
        "u.preferredName as preferredName",
        "u.email as email",
      ])
      .where("gm.projectId", "=", projectId)
      .orderBy("u.name")
      .execute();

    const byGroup = new Map<string, ProjectBudgetGroupMemberWithUser[]>();
    for (const member of members) {
      const bucket = byGroup.get(member.groupId);
      if (bucket) bucket.push(member);
      else byGroup.set(member.groupId, [member]);
    }

    return groups.map((group) => ({ ...group, members: byGroup.get(group.id) ?? [] }));
  } catch (error) {
    throw handleError("getProjectBudgetGroupsRepo", error);
  }
}

// -------------------------------------------------------------------
// One budget group by id, whichever project it is in.
//
// Unscoped on purpose, and it is the only read here that is, exactly as
// `getPhaseRepo` is in the phases repository: every write below is keyed on
// (group_id, project_id), but the forms that drive them submit a GROUP id
// and nothing else, so a caller holding one has no project to authorise
// against and cannot reach any of them. This answers "which project is this
// group in", and the service checks membership against that project before
// editing, deleting or setting members.
//
// Without it the workaround is to pass a project id from somewhere else in
// the request, which does not fail safe: a mismatched pair matches no row on
// the updates but hits the composite foreign key on the member insert, so a
// guessed id would surface as a database error rather than the notFound()
// the module answers everywhere else.
//
// Safe as a single row because `id` is the primary key.
// -------------------------------------------------------------------
export async function getProjectBudgetGroupRepo(
  groupId: string,
  db: DBClient = database,
): Promise<ProjectBudgetGroup | undefined> {
  try {
    return await db.selectFrom("projectBudgetGroups").selectAll().where("id", "=", groupId).executeTakeFirst();
  } catch (error) {
    throw handleError("getProjectBudgetGroupRepo", error);
  }
}

export async function addProjectBudgetGroupRepo(
  newGroup: NewProjectBudgetGroup,
  db: DBClient = database,
): Promise<ProjectBudgetGroup> {
  try {
    return await db.insertInto("projectBudgetGroups").values(newGroup).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addProjectBudgetGroupRepo", error);
  }
}

// -------------------------------------------------------------------
// Rename a group, change its pooled minutes or move it. Undefined if the
// group does not exist or belongs to another project.
//
// KEYED ON BOTH IDS, and every group function here is. A service has
// already established what the caller may do on THIS project; taking the
// group id alone would let a stray or guessed id edit a group belonging to
// a project the caller has never seen. (id, project_id) is unique, so the
// pair still matches at most one row.
// -------------------------------------------------------------------
export async function updateProjectBudgetGroupRepo(
  groupId: string,
  projectId: string,
  updateGroup: UpdateProjectBudgetGroup,
  db: DBClient = database,
): Promise<ProjectBudgetGroup | undefined> {
  try {
    const patch: UpdateProjectBudgetGroup = { ...updateGroup };

    // As on projects: an id in a patch rewrites the primary key of the row
    // the WHERE matched, and moving a group to another project would take
    // its members with it while their project_id column stayed behind.
    delete patch.id;
    delete patch.projectId;
    delete patch.createdAt;

    return await db
      .updateTable("projectBudgetGroups")
      // No trigger stamps updated_at, so the repository does.
      .set({ ...patch, updatedAt: new Date() })
      .where("id", "=", groupId)
      .where("projectId", "=", projectId)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateProjectBudgetGroupRepo", error);
  }
}

// -------------------------------------------------------------------
// Delete a group. Returns how many rows went, so a caller can tell
// "deleted" from "not this project's group".
//
// A real delete, unlike a project: a group holds no history. Its member
// rows go with it through the composite foreign key, which is a cascade
// Postgres can actually honour because nothing here addresses a blob.
// -------------------------------------------------------------------
export async function deleteProjectBudgetGroupRepo(
  groupId: string,
  projectId: string,
  db: DBClient = database,
): Promise<number> {
  try {
    const result = await db
      .deleteFrom("projectBudgetGroups")
      .where("id", "=", groupId)
      .where("projectId", "=", projectId)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  } catch (error) {
    throw handleError("deleteProjectBudgetGroupRepo", error);
  }
}

// -------------------------------------------------------------------
// Set exactly who is in one group.
//
// SETTING A LIST IS INHERENTLY A MOVE. A person may be in at most one group
// per project - the database enforces it on (project_id, user_id) - so
// adding somebody who is currently in another group of the same project has
// to take them out of it. Inserting without that first would answer a
// tickbox with a unique-constraint violation the caller can do nothing
// useful with.
//
// So three statements, in one unit because a failure between them empties
// a group without refilling it: take the named users out of the project's
// OTHER groups, drop whoever this group is losing, then insert.
//
// The insert does nothing on conflict rather than replacing, so somebody
// already in the group keeps the created_at that says when they joined it.
// Re-saving an unchanged form should not read as everybody joining again.
//
// It does NOT check the users are project members. That belongs in the
// service, which can say whose name it refused; filtering here would
// silently drop them.
// -------------------------------------------------------------------
export async function setProjectBudgetGroupMembersRepo(
  groupId: string,
  projectId: string,
  userIds: string[],
  db: DBClient = database,
): Promise<void> {
  try {
    // Deduplicated for the same reason as the member set above: one row
    // cannot be inserted twice by a single statement.
    const desired = [...new Set(userIds)];

    await runInTransaction(db, async (trx) => {
      if (desired.length > 0) {
        await trx
          .deleteFrom("projectBudgetGroupMembers")
          .where("projectId", "=", projectId)
          .where("groupId", "!=", groupId)
          .where("userId", "in", desired)
          .execute();
      }

      // Whoever was in this group and is not in the new list. Scoped by
      // group, so the other groups on the project keep their people.
      let removals = trx.deleteFrom("projectBudgetGroupMembers").where("groupId", "=", groupId);
      if (desired.length > 0) {
        removals = removals.where("userId", "not in", desired);
      }
      await removals.execute();

      if (desired.length > 0) {
        await trx
          .insertInto("projectBudgetGroupMembers")
          .values(desired.map((userId) => ({ groupId, projectId, userId })))
          .onConflict((oc) => oc.columns(["groupId", "userId"]).doNothing())
          .execute();
      }
    });
  } catch (error) {
    throw handleError("setProjectBudgetGroupMembersRepo", error);
  }
}
