import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";

import { auth } from "@/lib/auth/auth";
import { isTwoFactorSatisfied, requireSessionUserForTwoFactor } from "@/lib/auth/session-auth-server";
import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/audit/audit-log.types";
import { database } from "@/lib/data/kysely-database-client";
import {
  getSessionTwoFactorRepo,
  markSessionTwoFactorVerifiedRepo,
  recordSessionTwoFactorFailureRepo,
} from "@/lib/data/repositories/session-two-factor.repository";
import { hasCredentialAccountRepo } from "@/lib/data/repositories/accounts.repository";
import { updateUserByIdRepo } from "@/lib/data/repositories/users.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { roleHome } from "@/lib/routes";
import { handleError } from "@/lib/handle-errors";

import {
  TWO_FACTOR_LOCK_MINUTES,
  TWO_FACTOR_MAX_ATTEMPTS,
  type BeginTwoFactorEnrolmentRequestDTO,
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
    const { user, sessionId, twoFactorEnrolled } = await requireSessionUserForTwoFactor();

    // ALREADY THROUGH? Then there is nothing to do here, and showing the
    // form anyway is worse than showing nothing.
    //
    // This screen is the one page in the app that requireUser does NOT gate,
    // because it is where that gate sends people - which also means it is
    // the one page you can still reach after you no longer need it. Without
    // this check somebody whose session is already verified, or an
    // environment with the feature switched off, gets a verification form
    // that can only fail, while every other URL lets them straight in.
    //
    // Sent to their own area rather than to "/" so the answer does not
    // depend on a second redirect hop.
    if (await isTwoFactorSatisfied(sessionId, twoFactorEnrolled)) {
      redirect(roleHome(user.role));
    }

    const state = await readTwoFactorState(user.id);

    return {
      mode: state.verified ? "verify" : "enrol",
      email: user.email,
      // Asked of the database rather than inferred from a flag: the question
      // is whether THIS account has a password, and only an account that has
      // one is ever asked for it.
      requiresPassword: await hasCredentialAccountRepo(user.id),
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
// THE PASSWORD, and why it is optional rather than absent.
//
// `allowPasswordless` in auth.ts makes the plugin skip the password check for
// accounts that have NONE, which is every real Entra account here. An account
// that HAS one is still asked - and that is the local development account,
// which made this call fail with INVALID_PASSWORD and dead-end on a screen
// offering a Microsoft sign-in that is not configured locally. The feature
// could be switched on and then never satisfied by anybody.
//
// So a password is accepted and forwarded when the account has one. That is
// re-authentication before changing a security setting, which is what the
// plugin wants it for, and it is the same thing the Microsoft-issued session
// stands in for on the Entra path.
//
// PRODUCTION IS UNCHANGED, and not because a flag says so: a real account has
// no credential row, requiresPassword is false, the field is never shown, and
// the body sent is the empty one it has always been.
// -------------------------------------------------------------------
export async function beginTwoFactorEnrolmentService(
  requestDTO: BeginTwoFactorEnrolmentRequestDTO = {},
): Promise<TwoFactorEnrolmentDTO> {
  try {
    const { user } = await requireSessionUserForTwoFactor();

    const state = await readTwoFactorState(user.id);

    if (state.verified) {
      throw new DisplayErrorMessage(
        "Two-factor authentication is already set up on this account. Enter a code to continue, or use a backup code.",
      );
    }

    let result;

    try {
      result = await auth.api.enableTwoFactor({
        // Omitted entirely when there is none rather than sent as undefined:
        // the plugin branches on the field being present.
        body: requestDTO.password ? { password: requestDTO.password } : {},
        headers: await headers(),
      });
    } catch (error) {
      // The one predictable failure, and worth naming rather than letting
      // it surface as "we could not start two-factor setup".
      //
      // allowPasswordless only skips the password check for accounts that
      // have NONE. An account with a `credential` row is asked for its
      // password, so this arrives either because none was supplied or because
      // the one supplied was wrong. Those are different mistakes and get
      // different sentences: somebody who just typed a password needs to know
      // it was rejected, not to be told to go and use Microsoft instead.
      if ((error as { body?: { code?: string } }).body?.code === "INVALID_PASSWORD") {
        throw new DisplayErrorMessage(
          requestDTO.password
            ? "That password was not right."
            : "This account needs its password to set up two-factor authentication.",
        );
      }

      throw error;
    }

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
// active, never whether a code was correct. Turning it on before the code
// is proven means somebody who abandons enrolment is gated, which is the
// safe direction - they are sent back here rather than let through.
//
// Note that they come back to the VERIFY screen, not the enrol one, because
// two_factor.verified is true from the moment the secret is created. If
// they never captured the QR, that is a dead end and the way out is
// scripts/reset-two-factor.mjs.
// -------------------------------------------------------------------
export async function verifyTwoFactorService(
  requestDTO: VerifyTwoFactorRequestDTO,
): Promise<{ redirectTo: string }> {
  try {
    const { user, sessionId, twoFactorEnrolled } = await requireSessionUserForTwoFactor();

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

    // ENROLLING IS DECIDED BY THE USER FLAG, not by two_factor.verified.
    //
    // That column defaults to TRUE in the schema, and Better Auth's
    // enableTwoFactor inserts the row without overriding it - so it reads
    // "verified" from the instant enrolment BEGINS, before any code has been
    // proven. Deriving `enrolling` from it made it permanently false, the
    // flag update below never ran, and users.two_factor_enabled stayed
    // false.
    //
    // The effect was a silent loop with no error anywhere: verification
    // genuinely succeeded, the session was marked verified, the action
    // returned 200 - and then isTwoFactorSatisfied read the unset flag,
    // returned false, and redirected the person straight back to this
    // screen. From the outside it looked exactly like the button doing
    // nothing.
    const enrolling = !twoFactorEnrolled;

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

    // Where to send them, decided HERE because this is the only side that
    // knows the role. The screen used to navigate to "/" and let the public
    // home redirect onwards, which worked but made the destination depend on
    // a second hop through a page that has nothing to do with signing in.
    return { redirectTo: roleHome(user.role) };
  } catch (error) {
    throw handleError("verifyTwoFactorService", error);
  }
}

// -------------------------------------------------------------------
// Hand the code to the plugin, which owns the secret and the backup codes.
//
// Both endpoints throw an APIError rather than returning false, so a throw
// is caught here and turned into `false` - the one caller above gets a
// single failure path, and a wrong code always goes through the attempt
// counter rather than escaping as an unhandled error.
//
// A THROW IS NOT NECESSARILY A WRONG CODE, which an earlier version of this
// comment claimed. The plugin throws the same way for a missing secret, a
// rate limit, or an account it refuses to enrol. The reason is logged below
// so the two can be told apart.
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
  } catch (error) {
    // STILL FALSE, because the caller needs one failure path and every
    // wrong code must go through the attempt counter rather than escaping
    // as an unhandled error.
    //
    // But it is LOGGED, and that matters more than it looks. The plugin
    // throws an APIError for a genuinely wrong code AND for everything
    // structural - a missing secret, a rate limit, an account it will not
    // enrol. Swallowing them all silently made a broken configuration
    // indistinguishable from somebody fat-fingering six digits, which cost
    // hours of guessing at exactly the moment the server already knew the
    // answer.
    //
    // The code itself is never logged: it is a live credential for the
    // next thirty seconds.
    const detail = error as { body?: { code?: string; message?: string }; status?: string };

    console.warn(
      `[checkCode] ${requestDTO.useBackupCode ? "backup code" : "TOTP"} rejected -`,
      detail.body?.code ?? detail.status ?? "unknown",
      detail.body?.message ?? "",
    );

    return false;
  }
}
