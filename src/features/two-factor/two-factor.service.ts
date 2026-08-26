import "server-only";

import { headers } from "next/headers";
import QRCode from "qrcode";

import { auth } from "@/lib/auth/auth";
import { requireSessionUserForTwoFactor } from "@/lib/auth/session-auth-server";
import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/audit/audit-log.types";
import { database } from "@/lib/data/kysely-database-client";
import {
  getSessionTwoFactorRepo,
  markSessionTwoFactorVerifiedRepo,
  recordSessionTwoFactorFailureRepo,
} from "@/lib/data/repositories/session-two-factor.repository";
import { updateUserByIdRepo } from "@/lib/data/repositories/users.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";

import {
  TWO_FACTOR_LOCK_MINUTES,
  TWO_FACTOR_MAX_ATTEMPTS,
  type TwoFactorEnrolmentDTO,
  type TwoFactorScreenDTO,
  type VerifyTwoFactorRequestDTO,
} from "./two-factor.types";

// -------------------------------------------------------------------
// App-level two-factor.
//
// EVERY function here resolves the acting person from the session, through
// requireSessionUserForTwoFactor. Nothing takes a user id or a session id
// from a caller, so there is no request shape in which one person could
// enrol, verify or unlock somebody else.
//
// That guard is the one that applies NEITHER the two-factor gate nor the
// profile-setup gate, because this is the screen those gates redirect to.
// It still requires a valid session. It must not be used anywhere else.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Read the two_factor row directly.
//
// The plugin owns this table and offers no read endpoint for "is there a
// verified secret", which is exactly what decides whether this screen
// enrols or verifies. Only `verified` is selected: the secret and the
// backup codes are the plugin's business and this feature has no reason to
// hold either, even briefly.
// -------------------------------------------------------------------
async function readTwoFactorState(userId: string): Promise<{ exists: boolean; verified: boolean }> {
  const row = await database
    .selectFrom("twoFactor")
    .select("verified")
    .where("userId", "=", userId)
    .executeTakeFirst();

  return { exists: Boolean(row), verified: row?.verified === true };
}

// -------------------------------------------------------------------
// Which screen to show.
// -------------------------------------------------------------------
export async function getTwoFactorScreenService(): Promise<TwoFactorScreenDTO> {
  try {
    const { user } = await requireSessionUserForTwoFactor();

    const state = await readTwoFactorState(user.id);

    return {
      mode: state.verified ? "verify" : "enrol",
      email: user.email,
    };
  } catch (error) {
    throw handleError("getTwoFactorScreenService", error);
  }
}

// -------------------------------------------------------------------
// Start (or restart) enrolment.
//
// Deliberately re-callable. `enableTwoFactor` deletes any existing row and
// writes a fresh secret, so somebody who scanned badly or changed phone
// mid-setup gets a clean one rather than being stuck against a secret their
// authenticator does not have.
//
// It is safe to re-call ONLY while unverified, and that is enforced: once
// `verified` is true this refuses, because otherwise anybody holding a
// stolen session cookie could silently replace the victim's secret with
// their own and walk straight through the gate.
//
// No password is passed. `allowPasswordless` in auth.ts makes the plugin
// skip the password check for accounts that have none, which is every real
// Entra account here; a local dev account WITH a password would still be
// asked for it and this call would fail - which is correct, and only ever
// happens on a developer machine.
// -------------------------------------------------------------------
export async function beginTwoFactorEnrolmentService(): Promise<TwoFactorEnrolmentDTO> {
  try {
    const { user } = await requireSessionUserForTwoFactor();

    const state = await readTwoFactorState(user.id);

    if (state.verified) {
      throw new DisplayErrorMessage(
        "Two-factor authentication is already set up on this account. Enter a code to continue, or use a backup code.",
      );
    }

    const result = await auth.api.enableTwoFactor({
      body: {},
      headers: await headers(),
    });

    if (!result?.totpURI) {
      throw new DisplayErrorMessage("We could not start two-factor setup. Please try again.");
    }

    // Rendered locally into a data: URI. The otpauth:// URI carries the
    // shared secret, so it must never be handed to a third-party QR
    // service - that would be posting the second factor to a stranger.
    const qrCodeDataUrl = await QRCode.toDataURL(result.totpURI, { margin: 1, width: 240 });

    return {
      qrCodeDataUrl,
      manualKey: extractSecret(result.totpURI),
      backupCodes: result.backupCodes ?? [],
    };
  } catch (error) {
    throw handleError("beginTwoFactorEnrolmentService", error);
  }
}

// -------------------------------------------------------------------
// The otpauth:// URI's `secret` parameter, for anyone who cannot scan.
//
// Returns an empty string rather than throwing if the shape ever changes:
// a missing manual key costs somebody the typed-entry fallback, and
// throwing would cost them enrolment altogether.
// -------------------------------------------------------------------
function extractSecret(totpURI: string): string {
  try {
    return new URL(totpURI).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

// -------------------------------------------------------------------
// Check a code and, if it is right, let this session through.
//
// THE ORDER OF THE FIRST TWO STEPS IS THE WHOLE RATE LIMIT. The lock is
// read and enforced BEFORE the code is checked, so a locked session cannot
// keep guessing, and every wrong code is recorded before the caller learns
// it was wrong.
//
// WHY twoFactorEnabled IS SET BEFORE THE CHECK, which looks backwards.
// Better Auth rotates the session on the first successful verification -
// it creates a new session, deletes the current one, and sets a new cookie
// - but only when `user.twoFactorEnabled` is still false. That rotation
// would strip the verification we are about to write, because the row it
// is keyed on belongs to a session that no longer exists, and the new
// session id is not knowable from inside this request. Setting the flag
// first makes the plugin skip the rotation and keep the session we have.
//
// It is not a security shortcut: the flag only decides whether the GATE is
// active. Turning it on before the code is proven means somebody who
// abandons enrolment is gated - and that is the safe direction, because
// `two_factor.verified` is still false, so they land back on the enrol
// screen with a fresh secret rather than locked out.
// -------------------------------------------------------------------
export async function verifyTwoFactorService(
  requestDTO: VerifyTwoFactorRequestDTO,
): Promise<void> {
  try {
    const { user, sessionId } = await requireSessionUserForTwoFactor();

    const lock = await getSessionTwoFactorRepo(sessionId);

    if (lock?.lockedUntil && lock.lockedUntil.getTime() > Date.now()) {
      throw new DisplayErrorMessage(
        `Too many incorrect codes. Try again in ${TWO_FACTOR_LOCK_MINUTES} minutes, or sign out and back in.`,
      );
    }

    const state = await readTwoFactorState(user.id);

    if (!state.exists) {
      throw new DisplayErrorMessage("Set up two-factor authentication first.");
    }

    const enrolling = !state.verified;

    if (enrolling) {
      await updateUserByIdRepo(user.id, { twoFactorEnabled: true, updatedAt: new Date() });
    }

    const accepted = await checkCode(requestDTO);

    if (!accepted) {
      const failures = await recordSessionTwoFactorFailureRepo(
        sessionId,
        TWO_FACTOR_MAX_ATTEMPTS,
        { minutes: TWO_FACTOR_LOCK_MINUTES },
      );

      const remaining = Math.max(0, TWO_FACTOR_MAX_ATTEMPTS - failures);

      throw new DisplayErrorMessage(
        remaining > 0
          ? `That code was not right. ${remaining} ${remaining === 1 ? "attempt" : "attempts"} left.`
          : `Too many incorrect codes. Try again in ${TWO_FACTOR_LOCK_MINUTES} minutes, or sign out and back in.`,
      );
    }

    await markSessionTwoFactorVerifiedRepo(sessionId);

    // Enrolment is a change to how an account is secured, so it is recorded
    // like a role change. Routine per-session verifications are not logged:
    // one per person per sign-in would bury the events worth reading, and a
    // sign-in is already audited.
    if (enrolling) {
      await recordAuditEvent({
        action: AUDIT_ACTIONS.AUTH_TWO_FACTOR_ENABLED,
        entityType: AUDIT_ENTITY_TYPES.USER,
        entityId: user.id,
        subjectUserId: user.id,
        summary: `${user.name ?? user.email} set up two-factor authentication`,
      });
    }
  } catch (error) {
    throw handleError("verifyTwoFactorService", error);
  }
}

// -------------------------------------------------------------------
// Hand the code to the plugin, which owns the secret and the backup codes.
//
// Both endpoints throw an APIError on a bad code rather than returning
// false, so a throw is a wrong code and not an outage. That is caught here
// and turned into `false` so the one caller above has a single failure
// path - and so a wrong code always goes through the attempt counter
// rather than escaping as an unhandled error.
//
// A backup code is single use: the plugin consumes it, so the same one
// cannot be replayed.
// -------------------------------------------------------------------
async function checkCode(requestDTO: VerifyTwoFactorRequestDTO): Promise<boolean> {
  const requestHeaders = await headers();
  const code = requestDTO.code.trim();

  try {
    if (requestDTO.useBackupCode) {
      await auth.api.verifyBackupCode({ body: { code }, headers: requestHeaders });
      return true;
    }

    await auth.api.verifyTOTP({ body: { code }, headers: requestHeaders });
    return true;
  } catch {
    return false;
  }
}
