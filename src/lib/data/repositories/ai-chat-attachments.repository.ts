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
// TWO SHAPES, DELIBERATELY. `bytes` is a BYTEA column holding up to 4.5 MB,
// so `selectAll()` on a list of them would pull every file a conversation
// has ever carried into memory to render a row of filenames. The metadata
// reads below name their columns and leave the content behind; only the
// send path and the download route ever ask for `bytes`, and both do it one
// conversation or one file at a time.
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
      // Returns the metadata rather than everything, so an insert does not
      // hand the bytes straight back for no reason.
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
// The content of every attachment on one conversation, for the send.
//
// The only read that loads bytes in bulk, and it is bounded by the same
// caps the composer enforces: at most 20 images and 5 documents can be
// live on a conversation at once. Scoped to the owner like everything else.
// -------------------------------------------------------------------
export async function getAiChatAttachmentBytesForSubjectRepo(
  subjectId: string,
  userId: string,
  db: DBClient = database,
): Promise<AiChatAttachment[]> {
  try {
    return await db
      .selectFrom("aiChatAttachments")
      .selectAll()
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
// One file, with its content, for the download route. Undefined when it is
// not the caller's - the same answer a missing id gets.
// -------------------------------------------------------------------
export async function getAiChatAttachmentForUserRepo(
  attachmentId: string,
  userId: string,
  db: DBClient = database,
): Promise<AiChatAttachment | undefined> {
  try {
    return await db
      .selectFrom("aiChatAttachments")
      .selectAll()
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
// referring to something the model can no longer be shown. Deleting the
// message or the conversation still removes it, by cascade.
// -------------------------------------------------------------------
export async function deleteStagedAiChatAttachmentRepo(
  attachmentId: string,
  userId: string,
  db: DBClient = database,
): Promise<number> {
  try {
    const result = await db
      .deleteFrom("aiChatAttachments")
      .where("id", "=", attachmentId)
      .where("userId", "=", userId)
      .where("messageId", "is", null)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
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
): Promise<number> {
  try {
    const result = await db
      .deleteFrom("aiChatAttachments")
      .where("messageId", "is", null)
      .where("createdAt", "<", cutoff)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  } catch (error) {
    throw handleError("deleteStagedAiChatAttachmentsOlderThanRepo", error);
  }
}
