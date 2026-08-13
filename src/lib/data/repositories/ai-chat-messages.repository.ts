import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { AiChatMessage, NewAiChatMessage } from "../kysely-database-types";

// -------------------------------------------------------------------
// The turns of a conversation.
//
// These functions take a subject id and NOT a user id, which is the one
// place in this feature that looks like a gap and is not: a message row
// carries no owner of its own, so there is nothing here to filter on.
// Ownership lives on the subject, and the service resolves it there first
// (getAiChatSubjectForUserRepo) before calling anything below. Do not call
// these with a subject id straight from a request.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Every turn of one conversation, oldest first - the order the model must
// see them in.
//
// `id` is the tiebreaker after createdAt, and it is load-bearing: a user
// turn and its assistant reply can land in the same microsecond, and
// without it Postgres may return them in either order, which would replay
// the model's own answer before the question that prompted it.
// -------------------------------------------------------------------
export async function getAiChatMessagesBySubjectRepo(
  subjectId: string,
  db: DBClient = database,
): Promise<AiChatMessage[]> {
  try {
    return await db
      .selectFrom("aiChatMessages")
      .selectAll()
      .where("subjectId", "=", subjectId)
      .orderBy("createdAt")
      .orderBy("id")
      .execute();
  } catch (error) {
    throw handleError("getAiChatMessagesBySubjectRepo", error);
  }
}

// -------------------------------------------------------------------
// Append one turn.
// -------------------------------------------------------------------
export async function addAiChatMessageRepo(
  newMessage: NewAiChatMessage,
  db: DBClient = database,
): Promise<AiChatMessage> {
  try {
    return await db.insertInto("aiChatMessages").values(newMessage).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addAiChatMessageRepo", error);
  }
}

// -------------------------------------------------------------------
// The first user turn of a conversation, used to derive its title.
// -------------------------------------------------------------------
export async function getFirstUserMessageRepo(
  subjectId: string,
  db: DBClient = database,
): Promise<AiChatMessage | undefined> {
  try {
    return await db
      .selectFrom("aiChatMessages")
      .selectAll()
      .where("subjectId", "=", subjectId)
      .where("role", "=", "user")
      .orderBy("createdAt")
      .orderBy("id")
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getFirstUserMessageRepo", error);
  }
}
