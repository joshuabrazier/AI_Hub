import "server-only";

import { sql } from "kysely";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/audit/audit-log.types";
import { database } from "@/lib/data/kysely-database-client";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { envServer } from "@/lib/env-server";
import { handleError } from "@/lib/handle-errors";

// -------------------------------------------------------------------
// Data retention: de-identifying dormant PEOPLE.
//
// The unit is a user, because a user is the unit of everything now - there is
// no family or household to retire as a group.
//
// The queries here are raw SQL rather than repository calls because they are
// cross-table aggregates that exist for this screen and this job alone, and
// they only ever touch retention concerns. Everything they read is
// non-negotiable: `AUDIT_ACTIONS.AUTH_SIGNED_IN` is interpolated as a bound
// parameter, never spelled out as a string literal, because a literal would
// keep matching nothing after a rename and quietly make every account look
// dormant - and dormant here means scrubbed.
// -------------------------------------------------------------------

// A person becomes a de-identification candidate once dormant for this many
// months (see docs/security.md). Business-configurable.
export const RETENTION_INACTIVE_MONTHS = 12;

// The fixed placeholder written over identifying text. Not reversible - a
// returning person re-enters their details on a new account.
const TOMBSTONE = "[removed]";

export type RetentionCandidate = {
  userId: string;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
  // Most recent sign-in. Null means never.
  lastSignInAt: Date | null;
};

// -------------------------------------------------------------------
// The people who currently meet the retention rule. ALL of these must hold:
//   - an admin has deactivated the account (users.is_active = false),
//   - the account is older than the window, and
//   - they have not signed in within the window,
// and they have not already been de-identified.
//
// The deactivation requirement is a deliberate human gate: nobody is scrubbed
// just for drifting away, an admin has to retire the account first. Dormancy
// is derived rather than stored - there is no `last_active_at` column - so it
// comes from sign-in audit events.
//
// That makes AUDIT_LOG_RETENTION_DAYS load-bearing: sign-in events are the ONLY
// evidence of activity, so a purge window shorter than this one would rotate
// away the very rows that keep an account out of this list. Keep the audit
// window longer than RETENTION_INACTIVE_MONTHS.
//
// SELECT only. This is the single source of truth for "who qualifies", and
// the job below reuses it so the preview an admin sees is the same set the
// job would process.
//
// Unguarded on purpose: it is a private helper. The two callers are the
// admin-guarded service below and the bearer-authenticated job, and each does
// its own check. Do not export it.
// -------------------------------------------------------------------
async function selectRetentionCandidates(): Promise<RetentionCandidate[]> {
  const months = RETENTION_INACTIVE_MONTHS;

  const result = await sql<RetentionCandidate>`
    WITH last_signin AS (
      SELECT al.actor_user_id AS user_id, MAX(al.created_at) AS last_signin_at
      FROM audit_logs al
      WHERE al.action = ${AUDIT_ACTIONS.AUTH_SIGNED_IN}
        AND al.actor_user_id IS NOT NULL
      GROUP BY al.actor_user_id
    )
    SELECT
      u.id AS "userId",
      u.name AS "name",
      u.email AS "email",
      u.role::text AS "role",
      u.created_at AS "createdAt",
      ls.last_signin_at AS "lastSignInAt"
    FROM users u
    LEFT JOIN last_signin ls ON ls.user_id = u.id
    WHERE u.deidentified_at IS NULL
      AND u.is_active = false
      AND u.created_at < now() - make_interval(months => ${months}::int)
      AND (ls.last_signin_at IS NULL OR ls.last_signin_at < now() - make_interval(months => ${months}::int))
    ORDER BY u.name
  `.execute(database);

  return result.rows;
}

// -------------------------------------------------------------------
// READ-ONLY, admin only. The people who would be de-identified on the next
// run. Viewing this changes nothing.
// -------------------------------------------------------------------
export async function getRetentionCandidatesService(): Promise<RetentionCandidate[]> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    return await selectRetentionCandidates();
  } catch (error) {
    throw handleError("getRetentionCandidatesService", error);
  }
}

export type DeidentifiedUser = {
  userId: string;
  deidentifiedAt: Date;
  createdAt: Date;
};

// -------------------------------------------------------------------
// READ-ONLY, admin only. People already de-identified, newest first.
//
// Their identifying fields are tombstoned, so there is nothing to show but
// when it happened - deliberately, since re-displaying a scrubbed name would
// defeat the exercise.
// -------------------------------------------------------------------
export async function getDeidentifiedUsersService(limit = 50): Promise<DeidentifiedUser[]> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const result = await sql<DeidentifiedUser>`
      SELECT
        u.id AS "userId",
        u.deidentified_at AS "deidentifiedAt",
        u.created_at AS "createdAt"
      FROM users u
      WHERE u.deidentified_at IS NOT NULL
      ORDER BY u.deidentified_at DESC
      LIMIT ${limit}
    `.execute(database);

    return result.rows;
  } catch (error) {
    throw handleError("getDeidentifiedUsersService", error);
  }
}

export type DeidentifyRunResult = {
  // True when nothing was written (preview only).
  dryRun: boolean;
  // Whether the master switch was on for this run.
  jobEnabled: boolean;
  // People meeting the rule at the time of the run.
  candidateCount: number;
  // People actually de-identified (0 when dryRun).
  processedCount: number;
  // The candidate ids, so the caller can see what was in scope. Ids only -
  // names and emails are the whole point of not logging.
  userIds: string[];
};

// -------------------------------------------------------------------
// De-identify everybody who currently meets the retention rule.
//
// DESTRUCTIVE and IRREVERSIBLE when it actually runs: it overwrites name,
// email, phone and image with a tombstone, drops the stored credentials and
// any live session, and stamps `deidentified_at`. The user ROW is kept, so team
// membership and the audit trail stay consistent - deleting it would silently
// rewrite history the trail is there to preserve.
//
// GATED. `RETENTION_JOB_ENABLED` is checked here, not only by the caller.
// The route already computes dryRun from the same flag; this second check is
// what makes the guarantee hold for ANY future caller, including one that
// passes dryRun:false by mistake. While the switch is off this function can
// only ever report.
//
// No session guard, and that is correct: the only caller is the job route,
// which authenticates with a bearer secret and has no session to check. It
// must never be reachable from a server action.
//
// Idempotent: candidates already carrying `deidentified_at` are excluded by
// the query, and the UPDATE re-checks the same condition, so a concurrent run
// cannot double-process anyone. Each person is scrubbed in their own
// transaction and gets one audit entry, so a single failure cannot leave the
// run half-applied.
// -------------------------------------------------------------------
export async function deidentifyInactiveUsersService({ dryRun }: { dryRun: boolean }): Promise<DeidentifyRunResult> {
  try {
    const jobEnabled = envServer.RETENTION_JOB_ENABLED;

    // The switch can only ever make the run SAFER, never less safe.
    const effectiveDryRun = dryRun || !jobEnabled;

    const candidates = await selectRetentionCandidates();
    const userIds = candidates.map((candidate) => candidate.userId);

    if (effectiveDryRun || userIds.length === 0) {
      return {
        dryRun: effectiveDryRun,
        jobEnabled,
        candidateCount: userIds.length,
        processedCount: 0,
        userIds,
      };
    }

    let processedCount = 0;

    for (const userId of userIds) {
      // Whether this iteration actually scrubbed somebody. A concurrent run
      // may have taken this person between the SELECT and the UPDATE, in
      // which case the guarded UPDATE matches nothing and there is nothing to
      // audit - counting it anyway would report work that never happened.
      let scrubbed = false;

      await database.transaction().execute(async (trx) => {
        // Identity first, guarded on deidentified_at so only one run can win.
        // Email is UNIQUE, so the tombstone is made unique per user rather
        // than a shared constant.
        const updated = await sql`
          UPDATE users
          SET name = ${TOMBSTONE},
              preferred_name = NULL,
              email = 'removed+' || id || '@deleted.invalid',
              email_verified = FALSE,
              image = NULL,
              phone_number = NULL,
              notification_preferences = '{}'::jsonb,
              two_factor_enabled = FALSE,
              is_active = FALSE,
              deidentified_at = now(),
              updated_at = now()
          WHERE id = ${userId} AND deidentified_at IS NULL
        `.execute(trx);

        if (Number(updated.numAffectedRows ?? 0) === 0) return;

        // Revoke the means to sign in. Without this the account keeps a usable
        // password hash and 2FA secret against a tombstoned identity, which is
        // exactly the personal data the scrub is meant to remove.
        await sql`DELETE FROM sessions WHERE user_id = ${userId}`.execute(trx);
        await sql`DELETE FROM accounts WHERE user_id = ${userId}`.execute(trx);
        await sql`DELETE FROM two_factor WHERE user_id = ${userId}`.execute(trx);

        scrubbed = true;
      });

      if (!scrubbed) continue;

      processedCount += 1;

      // One entry per person, recording only WHICH fields were cleared and
      // never a value - the trail must not become the copy of the data that
      // was just removed.
      await recordAuditEvent({
        action: AUDIT_ACTIONS.USER_DEIDENTIFIED,
        entityType: AUDIT_ENTITY_TYPES.USER,
        entityId: userId,
        subjectUserId: userId,
        summary: `De-identified a dormant account (retention: ${RETENTION_INACTIVE_MONTHS} months)`,
        changes: {
          fields: ["name", "preferredName", "email", "phoneNumber", "image", "notificationPreferences"],
          revoked: ["sessions", "credentials", "twoFactor"],
        },
        // There is no session behind the job, so the actor is stated rather
        // than resolved - otherwise the trail would show no actor at all.
        actor: { id: null, role: "system", name: "Retention job" },
      });
    }

    return { dryRun: false, jobEnabled, candidateCount: userIds.length, processedCount, userIds };
  } catch (error) {
    throw handleError("deidentifyInactiveUsersService", error);
  }
}
