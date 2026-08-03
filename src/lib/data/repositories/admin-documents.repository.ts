import "server-only";

import { sql } from "kysely";
import { database } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { USER_ROLES } from "../kysely-database-types";

// -------------------------------------------------------------------
// Staff view of who has signed what (READ-ONLY - do not add writes here).
//
// Two halves, deliberately kept apart: the people in scope, and their latest
// signatures. Nothing here knows which documents exist or which version is
// current; the service reads that from the documents table and compares. That
// is what stops a version string being frozen into SQL, which is how the old
// two-document query went stale every time a version was bumped.
// -------------------------------------------------------------------

// One person the staff overview lists, with the teams they belong to.
export type DocumentSignerRow = {
  userId: string;
  name: string;
  email: string;
  isActive: boolean;
  // Empty when they are in no team - membership is optional in both directions.
  teamNames: string[];
};

// Members are the people a document is put to (documents.is_required is "every
// member must sign it"), so they are who the overview lists.
//
// Left joins keep a member with no team on the list; the team names are
// aggregated so one row comes back per person however many teams they are in.
const documentSignersBaseQuery = () =>
  database
    .selectFrom("users as u")
    .leftJoin("teamMembers as tm", "tm.userId", "u.id")
    .leftJoin("teams as t", "t.id", "tm.teamId")
    .where("u.role", "=", USER_ROLES.MEMBER)
    .select([
      "u.id as userId",
      "u.name as name",
      "u.email as email",
      "u.isActive as isActive",
      sql<string[]>`coalesce(array_agg(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), ARRAY[]::text[])`.as(
        "teamNames",
      ),
    ])
    .groupBy(["u.id", "u.name", "u.email", "u.isActive"])
    .orderBy("u.name");

// -------------------------------------------------------------------
// Every member, unscoped. Admin only - a manager must go through the
// team-scoped query below.
// -------------------------------------------------------------------
export async function getAllDocumentSignersRepo(): Promise<DocumentSignerRow[]> {
  try {
    return await documentSignersBaseQuery().execute();
  } catch (error) {
    throw handleError("getAllDocumentSignersRepo", error);
  }
}

// -------------------------------------------------------------------
// The members of the given teams. `teamIds` is the caller's full set of
// managed teams, resolved from the session - a user can manage several, so
// this takes a list and never a single id.
//
// No teams means no scope, so no rows: managing nothing must show nobody, and
// an empty IN list is not valid SQL either. Filtering the joined team rows
// also narrows teamNames to the teams in scope, so a manager is not shown the
// names of teams they cannot see.
// -------------------------------------------------------------------
export async function getDocumentSignersByTeamsRepo(teamIds: string[]): Promise<DocumentSignerRow[]> {
  try {
    if (teamIds.length === 0) return [];
    return await documentSignersBaseQuery().where("tm.teamId", "in", teamIds).execute();
  } catch (error) {
    throw handleError("getDocumentSignersByTeamsRepo", error);
  }
}

// The latest signature a person holds for one document. documentKey/-Version/
// -Title are the snapshot taken at signing, not the document's values today.
export type LatestDocumentSignatureRow = {
  signatureId: string;
  userId: string;
  documentKey: string;
  documentVersion: string;
  documentTitle: string;
  signedAt: Date;
};

// -------------------------------------------------------------------
// The most recent signature per (user, document) for the given users.
//
// Keyed on the snapshotted documentKey rather than document_id, so a
// signature still reports what it was for after the document row was renamed
// or deleted (document_id is ON DELETE SET NULL).
//
// This applies no scoping of its own: pass the ids from whichever signer
// query above the caller was entitled to run.
// -------------------------------------------------------------------
export async function getLatestDocumentSignaturesRepo(userIds: string[]): Promise<LatestDocumentSignatureRow[]> {
  try {
    if (userIds.length === 0) return [];
    return await database
      .selectFrom("documentSignatures as ds")
      // DISTINCT ON keeps the first row of each (user, document) group, which
      // the ORDER BY below makes the newest signature.
      .distinctOn(["ds.userId", "ds.documentKey"])
      .where("ds.userId", "in", userIds)
      .select([
        "ds.id as signatureId",
        "ds.userId as userId",
        "ds.documentKey as documentKey",
        "ds.documentVersion as documentVersion",
        "ds.documentTitle as documentTitle",
        "ds.signedAt as signedAt",
      ])
      .orderBy("ds.userId")
      .orderBy("ds.documentKey")
      .orderBy("ds.signedAt", "desc")
      // signed_at defaults to the TRANSACTION timestamp, so a backfill can
      // give one user two rows at an identical instant. Without this
      // tiebreaker DISTINCT ON keeps whichever row the plan happened to emit
      // first, and the service compares the winner's documentVersion against
      // the current document to decide who still owes a signature.
      .orderBy("ds.id", "desc")
      .execute();
  } catch (error) {
    throw handleError("getLatestDocumentSignaturesRepo", error);
  }
}
