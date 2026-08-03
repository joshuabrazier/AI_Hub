# Differential Security Review - Change Password Feature

**Branch:** `feature/reset_password` (uncommitted)
**Scope:** authenticated change-password flow
**Strategy:** SMALL codebase / HIGH risk (authentication + password handling)
**Reviewer:** automated differential review (Trail of Bits skill)

## Files reviewed

| File | Risk | Notes |
|------|------|-------|
| `src/features/settings/components/change-password-form.tsx` | HIGH | password handling, `authClient.changePassword` |
| `src/features/settings/change-password.types.ts` | MEDIUM | input validation (Zod) |
| `src/app/settings/page.tsx` | HIGH | route auth guard |
| `src/features/settings/settings.page.tsx` | LOW | composition only |
| `src/lib/constants.ts` (MESSAGES) | LOW | additive |
| `src/lib/routes.ts` (SETTINGS) | LOW | additive |

Blast radius: self-contained new feature. The user menu already linked `/settings`
(previously a dead link). No existing code paths changed behaviour.

---

## Findings

### F1 - Password policy mismatch: client min 6 < server min 8 (MEDIUM)

`change-password.types.ts` validates `newPassword` against `PASSWORD_MIN_LENGTH`
(= `NEXT_PUBLIC_PASSWORD_MIN_LENGTH` = **6**). Better Auth's server default
`minPasswordLength` is **8**, and `auth.ts` does not override it.

- **Effect:** a 6-7 character new password passes client validation, is sent to
  `authClient.changePassword`, and is **rejected server-side**. Combined with F2,
  the user sees "Your current password is incorrect" - which is false and
  confusing.
- **Security angle:** the 6-char floor is a weak password policy for an app
  holding children's data. Pre-existing (affects sign-in/reset too) but
  re-surfaces here.
- **Fix:** set `emailAndPassword.minPasswordLength` and
  `NEXT_PUBLIC_PASSWORD_MIN_LENGTH` to the same value (≥ 8).

### F2 - Misleading error handling on failure (MEDIUM, correctness/UX)

`change-password-form.tsx` `onError` unconditionally shows
`MESSAGES.CURRENT_PASSWORD_INCORRECT`. But `changePassword` can fail for reasons
other than a wrong current password (new password rejected by the server per F1,
rate limiting, network error). Attributing every failure to "current password
incorrect" hides the real cause.

- **Fix:** inspect the Better Auth error (`ctx.error.status` / `code`) and show a
  specific message; fall back to `MESSAGES.SOMETHING_WENT_WRONG` for anything
  unexpected. (The sign-in page already does a `status === 401` check as a
  precedent.)

### F3 - Change-password endpoint rate limiting (LOW-MEDIUM)

Only the global Better Auth `rateLimit` (window 10s, max 5) applies. Because
`changePassword` requires the **current** password, a session-holding attacker
(shared/unlocked device, XSS-stolen session) could brute-force the current
password via repeated attempts. `revokeOtherSessions` does not mitigate this.

- **Fix:** consider stricter, per-endpoint rate limiting on `changePassword`
  (and other credential endpoints), and/or step-up protections.

### F4 - Sensitive query parameters are logged (LOW, pre-existing)

`kysely-database-client.ts` logs every query's `params` to the console
(lines ~40-43). A password change UPDATEs the `accounts` row, so the hashed
password and user id are written to logs. Not plaintext, but still sensitive and
contrary to the "never log sensitive fields" rule in `CLAUDE.md`.

- **Fix:** gate the query logger to development only (pre-existing item; the
  change-password write is another reason to do it).

### F5 - No automated test coverage (LOW, elevated per methodology)

There is no unit test for `changePasswordSchema` and no E2E for the change-password
flow (unlike forgot/reset password). Missing tests on an auth flow raise residual
risk.

- **Fix:** add a Vitest test for the schema (match rule, min/max) and a Playwright
  E2E (sign in → change password → old password rejected → new password works).

### F6 - No "new password must differ from current" check (INFO)

Nothing prevents setting the new password equal to the current one. Low priority;
optional hardening.

---

## What's done well

- **`revokeOtherSessions: true`** - other sessions are invalidated on change,
  limiting persistence of a compromised session.
- **Current password required** - a session-only attacker cannot change the
  password without knowing the current one.
- **Route auth guard** - `app/settings/page.tsx` redirects unauthenticated users
  to sign-in; the mutation is additionally protected by Better Auth's own session
  requirement (defence in depth).
- **CSRF/Origin** - `changePassword` runs through the browser `authClient`, which
  sends `Origin`; Better Auth enforces it.
- **Minimal data** - `confirmNewPassword` is client-only (match check); only
  `currentPassword` + `newPassword` are sent to the server.
- **No secrets logged in the feature code** itself (no `console.log` of inputs).

---

## Coverage & confidence

- **Coverage:** all six changed files read in full; Better Auth defaults and the
  DB query logger checked. Better Auth's server-side `changePassword` internals
  were treated as a trusted dependency (not audited here).
- **Confidence:** high for F1/F2/F4 (verified in code), medium for F3 (depends on
  Better Auth rate-limit behaviour), informational for F6.
- **Not a vulnerability:** no auth bypass, injection, or data-exposure defect was
  found in the change. The findings are policy/UX/observability hardening.

## Priority

1. **F1** - align password min length (also fixes the confusing error in F2's common case).
2. **F2** - differentiate error messages.
3. **F4** - gate the query logger (pre-existing, broader than this feature).
4. **F3 / F5 / F6** - hardening / coverage as capacity allows.
