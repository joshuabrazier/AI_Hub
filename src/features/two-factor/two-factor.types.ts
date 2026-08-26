import z from "zod";

// -------------------------------------------------------------------
// App-level two-factor authentication.
//
// Sign-in is Microsoft, and Better Auth's twoFactor plugin only challenges
// on the password sign-in endpoints - so this is not part of sign-in at
// all. It is a gate on the SESSION: Entra says who somebody is, and this
// says they are still holding the authenticator they enrolled.
//
// Two screens behind one route, and which one shows is decided by
// `two_factor.verified`, never by `users.two_factor_enabled`:
//
//   verified = false (or no row) -> ENROL. A fresh secret and QR code.
//   verified = true              -> VERIFY. Code or backup code.
//
// That distinction is what makes a bad enrolment recoverable. Somebody who
// scanned a QR badly, or lost the phone mid-setup, still lands on the enrol
// screen and gets a new secret, rather than being locked behind a verify
// screen for an authenticator they never successfully added.
// -------------------------------------------------------------------

export type TwoFactorMode = "enrol" | "verify";

export type TwoFactorScreenDTO = {
  mode: TwoFactorMode;
  /** The address the authenticator entry will be labelled with. Display only. */
  email: string;
};

// -------------------------------------------------------------------
// What enrolment hands back, exactly once.
//
// `qrCodeDataUrl` is rendered server-side into a data: URI rather than the
// browser fetching a QR image from anywhere - the otpauth:// URI contains
// the shared secret, and sending it to a third-party chart service would
// hand over the second factor.
//
// `backupCodes` is shown once and never again. It is not retrievable later
// by design: they are stored encrypted and the plugin only returns them at
// generation time.
// -------------------------------------------------------------------
export type TwoFactorEnrolmentDTO = {
  qrCodeDataUrl: string;
  /** For anyone who cannot scan - the same secret, typed by hand. */
  manualKey: string;
  backupCodes: string[];
};

// -------------------------------------------------------------------
// A TOTP code, or a backup code.
//
// Kept as one shape with a discriminator rather than two endpoints,
// because the screen offers them as one field with a toggle and both end
// in the same place: this session marked verified.
//
// TOTP is exactly six digits. Backup codes are longer and may carry a
// separator, so they are only length-bounded - the real check is the
// cryptographic one, and being strict here would only reject a valid code
// because of a hyphen.
// -------------------------------------------------------------------
export const VerifyTwoFactorSchema = z.object({
  code: z.string().trim().min(1, "Enter the code from your authenticator").max(64),
  useBackupCode: z.boolean().default(false),
});

export type VerifyTwoFactorRequestDTO = z.infer<typeof VerifyTwoFactorSchema>;

// -------------------------------------------------------------------
// How many wrong codes a single session may present before it is locked
// out, and for how long.
//
// This is not belt-and-braces. Better Auth's own attempt limiter runs only
// on the sign-in path - when a session already exists its `beginAttempt`
// returns no-op handlers - so on this path there is nothing between
// somebody holding a stolen session cookie and unlimited guesses at a
// six-digit code.
//
// Five is enough for fat fingers and a clock a little out of step. The
// lock is per SESSION rather than per account on purpose: locking the
// account would let anybody with a stolen cookie deny the real person
// access just by guessing badly.
// -------------------------------------------------------------------
export const TWO_FACTOR_MAX_ATTEMPTS = 5;
export const TWO_FACTOR_LOCK_MINUTES = 15;
