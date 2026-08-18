import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import {
  AiChatAttachment,
  AiChatAttachmentMeta,
  NewAiChatAttachment,
} from "../kysely-database-types";

// -------------------------------------------------------------------
// Files attached to a conversation.
//
// Same boundary as the rest of chat: `user_id` is the authorization check,
// it is denormalised onto every row for that reason, and every function
// here takes it and puts it in the WHERE clause. The one exception is the
// retention sweep at the bottom, which has no session by design.
//
// TWO SHAPES, DELIBERATELY. The file content is not in this table at all -
// `storage_key` points at a blob - but the split is still worth keeping:
// the metadata reads below leave the key behind, so a surface that only
// renders names and sizes cannot leak a storage path into a DTO or a
// component. Only the send path and the download route ask for the key.
// -------------------------------------------------------------------

// Every column except the content. Listed once so the two metadata reads
// cannot drift apart, and so adding a column is a compile error here rather
// than a silently missing field downstream.
const META_COLUMNS = [
  "id",
  "userId",
  "subjectId",
  "messageId",
  "kind",
  "format",
  "fileName",
  "mediaType",
  "byteSize",
  "width",
  "height",
  "createdAt",
] as const;

// Metadata plus the blob pointer, for the two callers that need to reach
// the file itself.
const META_WITH_KEY_COLUMNS = [...META_COLUMNS, "storageKey"] as const;

// -------------------------------------------------------------------
// Store an uploaded file. Always staged (messageId null) - nothing else
// creates a row, so an attachment cannot appear already attached to a turn
// that was not the one being composed.
// -------------------------------------------------------------------
export async function addAiChatAttachmentRepo(
  newAttachment: NewAiChatAttachment,
  db: DBClient = database,
): Promise<AiChatAttachmentMeta> {
  try {
    return await db
      .insertInto("aiChatAttachments")
      .values(newAttachment)
      // Metadata only - the caller already holds the key it just wrote.
      .returning(META_COLUMNS)
      .executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addAiChatAttachmentRepo", error);
  }
}

// -------------------------------------------------------------------
// Everything attached to one conversation, metadata only, oldest first.
//
// Drives both the transcript (grouped by messageId) and the composer's
// staged list (messageId null), so the screen renders from one read.
// -------------------------------------------------------------------
export async function getAiChatAttachmentsForSubjectRepo(
  subjectId: string,
  userId: string,
  db: DBClient = database,
): Promise<AiChatAttachmentMeta[]> {
  try {
    return await db
      .selectFrom("aiChatAttachments")
      .select(META_COLUMNS)
      .where("subjectId", "=", subjectId)
      .where("userId", "=", userId)
      .orderBy("createdAt")
      .orderBy("id")
      .execute();
  } catch (error) {
    throw handleError("getAiChatAttachmentsForSubjectRepo", error);
  }
}

// -------------------------------------------------------------------
// The staged files for one conversation - uploaded, not yet sent.
//
// Read before an upload to enforce the per-request caps, and again on send
// to decide what to claim.
// -------------------------------------------------------------------
export async function getStagedAiChatAttachmentsRepo(
  subjectId: string,
  userId: string,
  db: DBClient = database,
): Promise<AiChatAttachmentMeta[]> {
  try {
    return await db
      .selectFrom("aiChatAttachments")
      .select(META_COLUMNS)
      .where("subjectId", "=", subjectId)
      .where("userId", "=", userId)
      .where("messageId", "is", null)
      .orderBy("createdAt")
      .orderBy("id")
      .execute();
  } catch (error) {
    throw handleError("getStagedAiChatAttachmentsRepo", error);
  }
}

// -------------------------------------------------------------------
// Every attachment on one conversation WITH its blob key, for the send.
//
// The send then fetches each file from storage. Bounded by the same caps
// the composer enforces - at most 20 images and 5 documents live on a
// conversation at once - so this is never an unbounded fan-out. Scoped to
// the owner like everything else.
// -------------------------------------------------------------------
export async function getAiChatAttachmentBytesForSubjectRepo(
  subjectId: string,
  userId: string,
  db: DBClient = database,
): Promise<AiChatAttachment[]> {
  try {
    return await db
      .selectFrom("aiChatAttachments")
      .select(META_WITH_KEY_COLUMNS)
      .where("subjectId", "=", subjectId)
      .where("userId", "=", userId)
      .orderBy("createdAt")
      .orderBy("id")
      .execute();
  } catch (error) {
    throw handleError("getAiChatAttachmentBytesForSubjectRepo", error);
  }
}

// -------------------------------------------------------------------
// One file WITH its blob key, for the download route. Undefined when it is
// not the caller's - the same answer a missing id gets, so a guessed id
// cannot confirm somebody else's file exists.
// -------------------------------------------------------------------
export async function getAiChatAttachmentForUserRepo(
  attachmentId: string,
  userId: string,
  db: DBClient = database,
): Promise<AiChatAttachment | undefined> {
  try {
    return await db
      .selectFrom("aiChatAttachments")
      .select(META_WITH_KEY_COLUMNS)
      .where("id", "=", attachmentId)
      .where("userId", "=", userId)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getAiChatAttachmentForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// Attach every staged file on a conversation to the turn that just landed.
//
// Scoped by user AND by "still staged", so a re-entrant send cannot move
// files that already belong to an earlier message onto a later one.
// Returns the number claimed, which is what the caller logs.
// -------------------------------------------------------------------
export async function claimStagedAiChatAttachmentsRepo(
  subjectId: string,
  userId: string,
  messageId: string,
  db: DBClient = database,
): Promise<number> {
  try {
    const result = await db
      .updateTable("aiChatAttachments")
      .set({ messageId })
      .where("subjectId", "=", subjectId)
      .where("userId", "=", userId)
      .where("messageId", "is", null)
      .executeTakeFirst();

    return Number(result.numUpdatedRows ?? 0);
  } catch (error) {
    throw handleError("claimStagedAiChatAttachmentsRepo", error);
  }
}

// -------------------------------------------------------------------
// Remove a staged file - the composer's "x" on an attachment chip.
//
// Restricted to staged rows on purpose: once a file has been sent it is
// part of the transcript, and deleting it would leave the conversation
// referring to something the model can no longer be shown.
//
// Returns the storage key of what it removed, because the caller has to
// delete the blob too - the row going does not take the file with it.
// -------------------------------------------------------------------
export async function deleteStagedAiChatAttachmentRepo(
  attachmentId: string,
  userId: string,
  db: DBClient = database,
): Promise<string | undefined> {
  try {
    const deleted = await db
      .deleteFrom("aiChatAttachments")
      .where("id", "=", attachmentId)
      .where("userId", "=", userId)
      .where("messageId", "is", null)
      .returning("storageKey")
      .executeTakeFirst();

    return deleted?.storageKey;
  } catch (error) {
    throw handleError("deleteStagedAiChatAttachmentRepo", error);
  }
}

// -------------------------------------------------------------------
// Retention: drop staged files that were never sent.
//
// Somebody attached a file and closed the tab. The row is owned and
// scoped, so it is not a leak, but it is bytes nobody will ever read - and
// unlike a sent attachment nothing else will ever collect it, because the
// message and conversation cascades only reach rows that have a message.
//
// Unscoped by user, like the other retention functions here: it runs from
// the monthly job behind its bearer secret, with no session at all.
// -------------------------------------------------------------------
export async function deleteStagedAiChatAttachmentsOlderThanRepo(
  cutoff: Date,
  db: DBClient = database,
): Promise<string[]> {
  try {
    const deleted = await db
      .deleteFrom("aiChatAttachments")
      .where("messageId", "is", null)
      .where("createdAt", "<", cutoff)
      // The keys come back so the job can remove the blobs as well. A row
      // deleted without its file is the orphan this whole design has to
      // avoid.
      .returning("storageKey")
      .execute();

    return deleted.map((row) => row.storageKey);
  } catch (error) {
    throw handleError("deleteStagedAiChatAttachmentsOlderThanRepo", error);
  }
}

// -------------------------------------------------------------------
// Every storage key the database still claims.
//
// Read by the monthly reconciliation sweep, which lists the container and
// deletes whatever appears there but not here. That sweep is the ONLY
// thing that catches files orphaned by a Postgres cascade - deleting a
// user takes their conversations, messages and attachment rows with it,
// and nothing in that chain can reach into blob storage.
//
// Unscoped by user, like the other retention functions here.
// -------------------------------------------------------------------
export async function getAllAiChatAttachmentKeysRepo(db: DBClient = database): Promise<string[]> {
  try {
    const rows = await db.selectFrom("aiChatAttachments").select("storageKey").execute();

    return rows.map((row) => row.storageKey);
  } catch (error) {
    throw handleError("getAllAiChatAttachmentKeysRepo", error);
  }
}
