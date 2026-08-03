import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { DocumentRecord, NewDocumentRecord, UpdateDocumentRecord } from "../kysely-database-types";

// -------------------------------------------------------------------
// Get all documents (any status), ordered for display. order_by defaults to
// 1, so ties are common - title breaks them to keep the list stable between
// requests.
// -------------------------------------------------------------------
export async function getAllDocumentsRepo(): Promise<DocumentRecord[]> {
  try {
    return await database.selectFrom("documents").selectAll().orderBy("orderBy").orderBy("title").execute();
  } catch (error) {
    throw handleError("getAllDocumentsRepo", error);
  }
}

// -------------------------------------------------------------------
// Get active documents only - what a member is asked to sign, and what the
// staff signing overview measures people against. Deactivating a document
// retires it without touching the signatures already recorded for it.
// -------------------------------------------------------------------
export async function getActiveDocumentsRepo(): Promise<DocumentRecord[]> {
  try {
    return await database
      .selectFrom("documents")
      .selectAll()
      .where("isActive", "=", true)
      .orderBy("orderBy")
      .orderBy("title")
      .execute();
  } catch (error) {
    throw handleError("getActiveDocumentsRepo", error);
  }
}

// -------------------------------------------------------------------
// Get a document by its stable key. Undefined if the key does not exist -
// the key is what a signature snapshots, so a caller resolving one for
// display must cope with the document having been removed since.
// -------------------------------------------------------------------
export async function getDocumentByKeyRepo(key: string, db: DBClient = database): Promise<DocumentRecord | undefined> {
  try {
    return await db.selectFrom("documents").selectAll().where("key", "=", key).executeTakeFirst();
  } catch (error) {
    throw handleError("getDocumentByKeyRepo", error);
  }
}

// -------------------------------------------------------------------
// Get a document by id. Undefined if not found.
// -------------------------------------------------------------------
export async function getDocumentByIdRepo(id: string, db: DBClient = database): Promise<DocumentRecord | undefined> {
  try {
    return await db.selectFrom("documents").selectAll().where("id", "=", id).executeTakeFirst();
  } catch (error) {
    throw handleError("getDocumentByIdRepo", error);
  }
}

// -------------------------------------------------------------------
// Create a document. `key` is UNIQUE, so a duplicate raises here rather
// than quietly shadowing the existing document.
// -------------------------------------------------------------------
export async function createDocumentRepo(
  newDocument: NewDocumentRecord,
  db: DBClient = database,
): Promise<DocumentRecord> {
  try {
    return await db.insertInto("documents").values(newDocument).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("createDocumentRepo", error);
  }
}

// -------------------------------------------------------------------
// Update a document by id. Undefined if the id does not exist.
//
// Bumping `version` is what forces everyone to re-sign, because a signature
// only counts against the version it snapshotted. Editing the wording alone
// (the site_content row named by contentKey) does not.
// -------------------------------------------------------------------
export async function updateDocumentByIdRepo(
  id: string,
  updateDocument: UpdateDocumentRecord,
  db: DBClient = database,
): Promise<DocumentRecord | undefined> {
  try {
    // The id argument is the one that identifies the row. Strip any id carried
    // in the patch so it cannot repoint the row the WHERE clause just chose.
    const patch = { ...updateDocument };
    delete patch.id;

    return await db
      .updateTable("documents")
      // Nothing stamps updated_at in the database, so the repository does it.
      // It matters here in particular: bumping `version` is what forces
      // everyone to re-sign, and updated_at is the only record of when that
      // happened.
      .set({ ...patch, updatedAt: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateDocumentByIdRepo", error);
  }
}

// -------------------------------------------------------------------
// Delete a document by id. Signatures are NOT lost: document_id is
// ON DELETE SET NULL and every signature carries its own snapshot of the
// key, title, version and text that was signed.
// -------------------------------------------------------------------
export async function deleteDocumentByIdRepo(id: string, db: DBClient = database): Promise<void> {
  try {
    await db.deleteFrom("documents").where("id", "=", id).execute();
  } catch (error) {
    throw handleError("deleteDocumentByIdRepo", error);
  }
}
