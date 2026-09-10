import "server-only";

import { sql, type SqlBool } from "kysely";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { type Client, type NewClient, type UpdateClient } from "../kysely-database-types";

// -------------------------------------------------------------------
// Clients - who the delivery work is for.
//
// Unlike transcriptions and chat, a client is NOT owned by one person:
// there is no user column to put in a WHERE clause, so nothing here is
// self-scoping. Every function is unscoped by design and the guard lives
// entirely in the service. Reading this file is not proof that a caller
// may see a client.
//
// THERE IS NO DELETE, and that is a decision rather than an omission.
// `projects.client_id` is ON DELETE RESTRICT (migration 020), because
// removing a client with projects would take their time entries - billing
// history - with it. Deactivating is the intended retirement path: it
// covers the "created it twice by accident" case just as well, since an
// inactive client is out of every picker. A delete would either throw a
// raw Postgres 23503 at whoever pressed the button, or need the same
// project count this file already exposes so the service can explain the
// refusal in words.
// -------------------------------------------------------------------

// The admin list row. `projectCount` is what makes a client undeletable, so
// the screen can say so instead of offering a button that always fails. It
// comes off the list query itself rather than a call per row - see
// `getClientsRepo` for why that shape won over a grouped second read.
export type ClientListItem = Client & { projectCount: number };

export async function addClientRepo(newClient: NewClient, db: DBClient = database): Promise<Client> {
  try {
    return await db.insertInto("clients").values(newClient).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addClientRepo", error);
  }
}

export async function getClientByIdRepo(clientId: string, db: DBClient = database): Promise<Client | undefined> {
  try {
    return await db.selectFrom("clients").selectAll().where("id", "=", clientId).executeTakeFirst();
  } catch (error) {
    throw handleError("getClientByIdRepo", error);
  }
}

// -------------------------------------------------------------------
// Every client, or only the active ones, each with the number of projects
// hanging off it.
//
// Active-only is the default because the common caller is a picker on the
// project setup screen, and offering a retired client there is how a
// project ends up on the wrong one. The admin list passes
// `includeInactive` to show what has been retired.
//
// THE COUNT IS A CORRELATED SUBQUERY, not a second grouped read. Every
// admin list row shows it, and asking `countProjectsForClientRepo` per row
// meant rendering the list cost a query per client. Two ways to fix that,
// and this is the one `getAllProjectsRepo` already took for `memberCount`,
// so the module has one shape for "a list row with a count on it" rather
// than two. The alternative that lost - a `getProjectCountsByClientRepo`
// grouped in SQL and joined up in the service - is a second round trip and
// leaves every caller to remember that GROUP BY returns NO ROW for a
// client with no projects, so an absent key means zero. That defaulting is
// exactly the step that gets dropped, and dropping it reports "0 projects"
// for the client whose row is about to refuse a delete.
//
// The picker pays for a count it throws away. That is the accepted price:
// `idx_projects_client` is on (client_id, status) so the count never
// touches the heap, and a client list is tens of rows. Hiding it behind an
// option would leave the module two near-identical client queries to keep
// in step.
//
// It counts EVERY project, archived ones included, for the same reason
// `countProjectsForClientRepo` does - see there.
//
// Ordered by name alone, which is enough to be stable: the unique index
// below means no two rows can share one.
// -------------------------------------------------------------------
export async function getClientsRepo(
  options: { includeInactive?: boolean } = {},
  db: DBClient = database,
): Promise<ClientListItem[]> {
  try {
    let query = db
      .selectFrom("clients")
      .selectAll()
      .select((eb) =>
        eb
          .selectFrom("projects")
          .whereRef("projects.clientId", "=", "clients.id")
          .select((inner) => inner.fn.countAll<string>().as("count"))
          .as("projectCount"),
      );

    if (!options.includeInactive) {
      query = query.where("isActive", "=", true);
    }

    const rows = await query.orderBy("name").execute();

    // count() comes back as a string because Postgres counts in bigint and
    // node-postgres will not silently narrow one. Converted here, once, at
    // the boundary, so nothing above the repository ever handles the string
    // form and no caller has to know it existed.
    return rows.map(({ projectCount, ...client }) => ({
      ...client,
      projectCount: Number(projectCount ?? 0),
    }));
  } catch (error) {
    throw handleError("getClientsRepo", error);
  }
}

// -------------------------------------------------------------------
// Update one. Undefined when the id matches nothing.
// -------------------------------------------------------------------
export async function updateClientByIdRepo(
  clientId: string,
  patch: UpdateClient,
  db: DBClient = database,
): Promise<Client | undefined> {
  try {
    // Updateable allows id, createdBy and createdAt. None is ever
    // legitimately patched, and an id in a patch would rewrite the primary
    // key of whichever row the WHERE matched - which projects still point
    // at by the old value.
    const safePatch: UpdateClient = { ...patch };
    delete safePatch.id;
    delete safePatch.createdBy;
    delete safePatch.createdAt;

    return await db
      .updateTable("clients")
      // Nothing stamps updated_at in the database, so the repository does.
      .set({ ...safePatch, updatedAt: new Date() })
      .where("id", "=", clientId)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateClientByIdRepo", error);
  }
}

// -------------------------------------------------------------------
// The client of a given name, if one exists. For create-or-reuse: a
// project is set up by typing a client name, and typing one that already
// exists has to reuse it rather than fail.
//
// THE PREDICATE IS THE INDEX EXPRESSION, deliberately character for
// character. `idx_clients_name_unique` is UNIQUE on
// `lower(btrim(name))`, so that expression - not `name` - is what the
// database means by a duplicate. Normalising the argument in TypeScript
// instead would MISS rows Postgres considers duplicates and turn a
// reusable client into a constraint violation: `String.trim()` strips all
// whitespace where `btrim` strips only spaces, and `toLowerCase` follows
// JavaScript's case rules rather than the database's collation. Doing
// both sides in SQL also keeps the read on the index rather than
// scanning.
//
// Matching is exact once normalised. No prefix or fuzzy fallback: quietly
// attaching a project to a similarly named client is a worse outcome than
// creating a second one that an admin can see and merge.
// -------------------------------------------------------------------
export async function getClientByNameRepo(name: string, db: DBClient = database): Promise<Client | undefined> {
  try {
    return await db
      .selectFrom("clients")
      .selectAll()
      .where(sql<SqlBool>`lower(btrim(name)) = lower(btrim(${name}))`)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getClientByNameRepo", error);
  }
}

// -------------------------------------------------------------------
// How many projects hang off ONE client.
//
// Exists so a caller can say "this client has 3 projects" instead of
// refusing with no reason, and so deactivation can warn before it hides a
// client that is still being worked on.
//
// For ONE client only. A list does not call this in a loop - `getClientsRepo`
// carries the count on the row for exactly that reason.
//
// Counts EVERY project, archived ones included. That is not laziness: the
// RESTRICT constraint does not care about status either, so a count
// filtered to active projects would report zero for a client the database
// would still refuse to release. Any caller wanting "how much of this is
// live" is asking a different question and should ask projects directly.
// -------------------------------------------------------------------
export async function countProjectsForClientRepo(clientId: string, db: DBClient = database): Promise<number> {
  try {
    const row = await db
      .selectFrom("projects")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("clientId", "=", clientId)
      .executeTakeFirstOrThrow();

    // Postgres counts in bigint and node-postgres hands that back as a
    // string rather than narrowing it silently. Converted at the boundary,
    // same as the list read above.
    return Number(row.count);
  } catch (error) {
    throw handleError("countProjectsForClientRepo", error);
  }
}
