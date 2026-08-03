# Differential Security Review - Change Email Feature

**Branch:** `feature/reset_password` (uncommitted)
**Scope:** authenticated change-email flow + new `emailVerification` sender
**Strategy:** SMALL / HIGH risk (authentication, account-identity change)
**Reviewer:** automated differential review (Trail of Bits skill)

## Files reviewed

| File | Risk | Notes |
|------|------|-------|
| `src/lib/auth/auth.ts` | HIGH | new `emailVerification.sendVerificationEmail`; `user.changeEmail.enabled` |
| `src/features/settings/components/change-email-form.tsx` | HIGH | `authClient.changeEmail` |
| `src/features/settings/change-email.types.ts` | MEDIUM | input validation |
| `src/lib/email/send-email.ts` | LOW | new `sendVerificationEmail` (via log-only/Azure transport) |
| `src/lib/email/templates/verify-email-template.ts` | LOW | static HTML, `verifyUrl` is server-built |
| `src/features/settings/settings.page.tsx` | LOW | composition |

Chosen flow (Option A): change-email sends a verification link to the **new**
address; the change applies when it's clicked.

---

## Findings

### F1 - Email change enables account takeover from a compromised session (MEDIUM)

`changeEmail` requires only a valid **session** - no password re-auth - and the
verification link is sent to the **new (attacker-chosen)** address. Better Auth
also does **not** notify the current/old address of the change.

- **Scenario:** attacker obtains a session (shared/unlocked device, stolen cookie,
  XSS) → submits change-email to their own address → clicks the verification link
  in *their* inbox → the victim's account email is now the attacker's → attacker
  triggers a password reset to that email → full account takeover. The victim
  gets no warning.
- This is the known trade-off of Option A (verify-new-email) vs Option B
  (confirm-from-current-email). Given the app holds children's data, add at least
  one mitigation:
  - **Notify the old email** when a change is requested/completed (add
    `user.changeEmail.sendChangeEmailConfirmation` as a heads-up to the current
    address), and/or
  - **Require password re-auth** before allowing an email change, and/or
  - switch to **Option B** (confirm from the current address).
- Minimum recommendation: **notify the old address.**

### F2 - New `emailVerification.sendVerificationEmail` activates verification endpoints (LOW-MEDIUM)

Adding the sender doesn't just power change-email - it makes Better Auth's
`/api/auth/send-verification-email` endpoint functional. That endpoint can send a
verification email to a registered address, so it's a (rate-limited) email-bomb
vector. The global rate limit (window 10s, max 5) is permissive.

- **Fix:** be aware of the expanded surface; consider stricter per-endpoint rate
  limiting on the verification/credential endpoints. (Related to the change-password
  review's rate-limit finding.)
- Confirmed **not** triggered on sign-up/sign-in: `requireEmailVerification` is
  `false` and `sendOnSignUp` isn't set, so the sender is only used for change-email
  and explicit verification requests.

### F3 - No test coverage for change-email (LOW, elevated per methodology)

No unit test for `changeEmailSchema` and no E2E for the change-email flow.

- **Fix:** Vitest test for the schema (valid email, match rule), and a Playwright
  E2E (request change → read verify token from `verifications` → confirm → email
  updated).

### F4 - Sessions are not revoked on email change (INFO)

Password reset uses `revokeSessionsOnPasswordReset: true`; email change keeps
existing sessions. Usually acceptable, but worth a conscious decision given F1.

---

## What's done well

- **Enumeration handled by Better Auth** - if the new email already belongs to a
  user, the route returns `{ status: true }` without sending/changing (its own
  comment notes this is to avoid leaking email existence). Good.
- **Input validation** - client `z.email` + confirm-match; the server rejects a
  new email equal to the current one; server re-validates.
- **No injection** - the template interpolates a server-built `verifyUrl`, not
  user input.
- **Change is pending** - for a verified user the email isn't updated until the
  link is clicked (not on request).
- **Adding the sender is scoped** - it does not start sending verification emails
  on sign-up/sign-in (verification stays optional).
- **Log-only outside production** - the verification email (and its token) is
  logged, not sent, in dev/test - no quota use, no PII/token egress; and the
  query-logger fix (F4 from the prior review) keeps params out of non-dev logs.
- **Typo protection** - the confirm-new-email field guards mistyped addresses.

---

## Coverage & confidence

- **Coverage:** all changed files read in full; Better Auth's `change-email`
  route logic (`update-user.mjs`) and the `emailVerification` requirement were
  read directly to confirm behaviour. Verified end-to-end via API (`200`,
  verification email logged to the new address). Better Auth internals treated as
  a trusted dependency otherwise. New files → no git history to mine.
- **Confidence:** high for F1/F2/F4 (verified in code + Better Auth source),
  medium for the exploitability of F1 (requires a pre-existing session).
- **Not a vulnerability in the change itself:** no injection, no auth bypass, no
  data exposure. F1 is a design trade-off (Option A) with clear mitigations; the
  rest is hardening/coverage.

## Priority

1. **F1** - add old-email notification (and/or password re-auth) so an email
   change can't silently take over an account from a stolen session.
2. **F2** - note/limit the now-active verification endpoints.
3. **F3** - add change-email test coverage.
4. **F4** - decide whether to revoke sessions on email change.
