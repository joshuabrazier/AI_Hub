import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { DocumentSignature, NewDocumentSignature } from "../kysely-database-types";

// -------------------------------------------------------------------
// Add a document signature (immutable record of one signing event).
//
// The caller passes the snapshot: documentKey, documentVersion,
// documentTitle and documentContent as they were at the moment of signing.
// documentId is only a convenience link - it is ON DELETE SET NULL, so the
// snapshot is the part that has to stand on its own, and every read below
// keys off documentKey rather than documentId for exactly that reason.
//
// signerName and signatureImage arrive already field-encrypted from the
// service; this layer stores whatever string it is handed.
// -------------------------------------------------------------------
export async function addDocumentSignatureRepo(
  newDocumentSignature: NewDocumentSignature,
  db: DBClient = database,
): Promise<DocumentSignature> {
  try {
    return await db
      .insertInto("documentSignatures")
      .values(newDocumentSignature)
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addDocumentSignatureRepo", error);
  }
}

// -------------------------------------------------------------------
// Get all of a user's document signatures, newest first.
// -------------------------------------------------------------------
export async function getDocumentSignaturesByUserRepo(
  userId: string,
  db: DBClient = database,
): Promise<DocumentSignature[]> {
  try {
    return await db
      .selectFrom("documentSignatures")
      .selectAll()
      .where("userId", "=", userId)
      .orderBy("signedAt", "desc")
      .execute();
  } catch (error) {
    throw handleError("getDocumentSignaturesByUserRepo", error);
  }
}

// -------------------------------------------------------------------
// The user's most recent signature for one document, matched on the
// snapshotted key so it still resolves after the document was renamed or
// deleted. It may be for an older version than the one currently published -
// the caller compares documentVersion to decide whether a re-sign is due.
// -------------------------------------------------------------------
export async function getLatestSignatureByUserAndKeyRepo(
  userId: string,
  documentKey: string,
  db: DBClient = database,
): Promise<DocumentSignature | undefined> {
  try {
    return await db
      .selectFrom("documentSignatures")
      .selectAll()
      .where("userId", "=", userId)
      .where("documentKey", "=", documentKey)
      .orderBy("signedAt", "desc")
      // signed_at defaults to the TRANSACTION timestamp, so a backfill can
      // give one user two rows at an identical instant. Without this
      // tiebreaker the winner is arbitrary row order, and the caller compares
      // the returned documentVersion to decide whether a re-sign is due.
      .orderBy("id", "desc")
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getLatestSignatureByUserAndKeyRepo", error);
  }
}

// -------------------------------------------------------------------
// One of the user's OWN signatures by id.
//
// userId is the authorization check, not a filter: signature ids are opaque
// but guessable, and this row carries the field-encrypted signerName and
// signature image, so a lookup on the primary key alone is an IDOR. Undefined
// when the id does not exist or is not this user's - the caller cannot tell
// those apart, which is the point.
//
// This is the default for anything member-facing. Staff use the explicitly
// unscoped sibling below.
// -------------------------------------------------------------------
export async function getDocumentSignatureByIdRepo(
  id: string,
  userId: string,
  db: DBClient = database,
): Promise<DocumentSignature | undefined> {
  try {
    return await db
      .selectFrom("documentSignatures")
      .selectAll()
      .where("id", "=", id)
      .where("userId", "=", userId)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getDocumentSignatureByIdRepo", error);
  }
}

// -------------------------------------------------------------------
// A single signature by id with NO user scope, for the staff viewer that
// opens one signed record.
//
// STAFF ONLY. It reads any user's encrypted signer name and signature image,
// so the caller must already have established that the acting user is
// entitled to see this person's records. The name says "unscoped" so that
// picking it is a decision rather than an accident. Undefined if not found.
// -------------------------------------------------------------------
export async function getDocumentSignatureByIdUnscopedRepo(
  id: string,
  db: DBClient = database,
): Promise<DocumentSignature | undefined> {
  try {
    return await db.selectFrom("documentSignatures").selectAll().where("id", "=", id).executeTakeFirst();
  } catch (error) {
    throw handleError("getDocumentSignatureByIdUnscopedRepo", error);
  }
}
