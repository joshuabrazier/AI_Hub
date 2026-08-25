# Security

The single reference for how this portal protects data. It covers
the controls that are enforced in the codebase, the settings the team owns
outside the repo, the known findings and follow-ups, and incident response.

## What we are protecting

As shipped, the base holds account data (names, email addresses, phone numbers),
team membership - which is what every authorization decision turns on - and
**AI chat transcripts and their attachments**, which can contain anything a user
chose to type, paste or upload. It is written to be subject to the Australian
Privacy Principles. The security model assumes an authenticated attacker (a
stolen or shared session) as well as an anonymous one, and treats credentials
and chat content as the crown jewels.

**A project that adds more sensitive data than this must revisit this document.**
Health, financial or children's data raises the stakes on encryption, retention
and audit, and the controls below were sized for the data listed above.

## Authentication

Configured in `src/lib/auth/auth.ts` (Better Auth), backed by Postgres.

- **Email and password** only. Password length bounds come from
  `NEXT_PUBLIC_PASSWORD_MIN_LENGTH` / `NEXT_PUBLIC_PASSWORD_MAX_LENGTH`, and the
  server (`minPasswordLength` / `maxPasswordLength`) uses the same constants, so
  the client and server policies cannot drift. Set the minimum to at least 8.
- **Sessions** are database-backed (`sessions` table), expire after 5 days, and
  refresh once a day. Cookies are `Secure` and carry the configured prefix; both
  the secure flag and CSRF trusted-origin list are gated on `MODE=production`.
- **Password reset** emails a link and revokes every existing session on reset
  (`revokeSessionsOnPasswordReset`).
- **Change email** sends a verification link to the new address; the change only
  applies when that link is clicked, and all sessions are revoked afterwards so
  the user must sign in again. Email existence is not leaked (Better Auth returns
  success without sending when the new address already belongs to a user).
- **Deactivated accounts** (`isActive = false`) are rejected at session creation,
  so disabling a user takes effect on their next request, not just at next login.

## Two-factor authentication

- Three methods once enabled: a **TOTP authenticator app**, an **emailed one-time
  code** (valid 5 minutes), and a single **backup recovery code**.
- Enabling is staged: a secret is generated, and 2FA only turns on after the user
  verifies a code, so a bad QR scan can never lock someone out.
- **Required for staff** (`admin` and `manager`), who cannot turn it off.
  Optional for `member` accounts.
- Note that Better Auth issues a session at sign-in only while 2FA is off. Once
  it is on, sign-in returns a two-factor challenge and no session. This is
  correct, and it is easy to mistake for an authorization failure when testing.

## Authorization

- **Roles**: `admin`, `manager`, `member`. Admins and managers are staff. Roles
  and `isActive` are **server-assigned** (`input: false` in Better Auth), so the
  public update-user endpoint rejects them and sign-up ignores them. A user
  cannot grant itself a privileged role (no mass-assignment or privilege
  escalation).
- **Server-side guards**: every server entry point and mutation calls
  `requireUser` / `requireUserRole` (`src/lib/auth/session-auth-server.ts`) in the
  service layer, not just in the UI. Authorization is enforced on the server for
  every request.
- **IDOR-safety**: services resolve the acting user from the **session**. The
  member portal carries no id in its path at all, so there is nothing in the URL
  to tamper with.
- **Team scoping** is the app's data boundary, and membership is many-to-many.
  Four rules hold everywhere:
  1. Scope comes from the session, never from a URL, form field or action argument.
  2. Scope helpers return `string[]`. A single-id return would hand a user in two
     teams an arbitrary scope, silently, because Postgres row order is not stable.
  3. An empty scope means nothing, not everything.
  4. A scope failure answers `notFound()`, not "forbidden". Saying "forbidden" to
     a guessed id confirms the record exists and turns the route into an
     enumeration oracle. A role failure may say so plainly.
  The guards are `requireTeamScope`, `requireManagementScope`, `requireTeamAccess`
  and `requireTeamManagement` in `src/lib/auth/session-auth-server.ts`.
- **Impersonation**: only admins hold the permission; a manager cannot
  impersonate anyone, including their own team's members. Sessions are capped at
  1 hour, recorded on the session row (`impersonated_by`) and logged.
  Admins cannot impersonate each other. Managers and members CAN be impersonated
  by an admin - deliberately, since an admin already holds every permission a
  manager does, so it grants nothing new and the act is attributable.

## Data protection

- **Field-level encryption** is available for any field a project needs
  encrypted at the application layer, on top of the database's own encryption at
  rest: **AES-256-GCM** (`src/lib/crypto/field-encryption.ts`), a fresh random
  12-byte IV per value and a pinned 128-bit auth tag so tampered or truncated
  ciphertext is rejected. The key is `FIELD_ENCRYPTION_KEY`. It has **no callers
  in the base itself** - its only user was the signable-documents feature, since
  removed - and is kept because it is domain-neutral, tested, and the first
  thing a project storing anything sensitive will reach for. It is unrelated to
  2FA, which Better Auth encrypts under `BETTER_AUTH_SECRET`.
- **Rich text is sanitized**: admin-authored HTML (TipTap) is sanitized on the
  server (`src/lib/sanitize-rich-text.ts`) before any `dangerouslySetInnerHTML`,
  preventing stored XSS from editable content.
- **Secrets stay on the server**: encryption keys and auth secrets are never sent
  to the browser. Only `NEXT_PUBLIC_*` values reach the client bundle.

## SQL injection and input validation

- **No string-concatenated SQL.** All database access goes through Kysely or
  parameterised tagged `sql` templates in the repositories.
- **Zod at the boundary.** Server actions validate input with a Zod schema before
  calling a service, and return a typed `ServerApiResponse` rather than leaking
  internal errors.

## File uploads (AI chat attachments)

Uploads exist in exactly one place - files attached to an AI chat turn - and
`src/lib/ai/attachment-formats.ts` is the whole trust boundary for them.

- **The type is decided by the bytes.** The header is parsed to identify the
  format, and neither the filename nor the browser's `Content-Type` is treated
  as evidence. For images the same pass that proves the format also reads the
  pixel dimensions, so an oversized image is refused at upload rather than by
  Bedrock after the user has waited. Text formats are admitted only on proof of
  valid UTF-8 with no NUL bytes.
- **The allowlist is the Amazon Bedrock Converse contract**, not Anthropic's
  first-party API - four image formats and nine document formats. A unit test
  asserts the tables against the AWS SDK's `ImageFormat` / `DocumentFormat`
  enums, so a drift in either direction fails the build.
- **Serving an uploaded file back is where the real risk sits**, because the
  bytes are user-controlled and the origin is ours. Four controls, all
  load-bearing: `X-Content-Type-Options: nosniff`; a `Content-Type` derived from
  the sniffed format server-side; `Content-Disposition: attachment` for
  everything except the four image formats; and `Content-Security-Policy:
  sandbox; default-src 'none'` on the response. `html` maps to `text/plain`
  deliberately - serving user markup as `text/html` here would be stored XSS.
  The filename is emitted RFC 5987 encoded so it cannot break out of the header.
- **Access is the owner predicate.** Every query carries the session user id,
  including the download route, and a file that is not the caller's answers 404.
  There is no admin override: the request log records that a file was sent - its
  name, kind and size - and never its content.
- **Size is bounded twice** on upload, once on the declared `Content-Length` and
  again on what actually arrived, because the header is client-supplied.

## Meeting recordings (transcription)

Recordings do **not** follow the rule above, and the difference is deliberate.
A chat attachment is at most 4.5 MB and is proxied through the app, so the only
way to read one is a live session that owns it. A meeting recording is hundreds
of megabytes: proxying it would hold an instance for the length of the transfer,
and an hour of video would simply fail. So the upload is a **SAS URL**, and that
is a real reduction in guarantees taken because the alternative does not work at
this size. Do not copy it for small files.

What keeps it defensible:

- **The SAS is write-only, single-blob and short-lived.** `cw` permissions, one
  blob name, one hour. It cannot read anything - not that file, not any other -
  cannot list, and expires. The worst a leaked one does is let somebody
  overwrite a file whose exact random name they already knew.
- **The client never names the destination.** The row is created first and the
  key is `transcription/{userId}/{transcriptionId}` derived from ids the server
  generated, so a caller cannot aim an upload at another user's prefix.
- **Nothing hands out a read URL, ever.** There is no play-back or download path
  for the media. `createReadUrl` does not exist, and adding one would mean
  minting a bearer credential that outlives the session check that produced it.
- **The size limit is checked after the upload, from storage.** A SAS grants a
  write; it does not cap one. The first moment the real size is known is when
  the app asks the container, which is what it does before creating a job.
- **The Speech service is not given a token at all.** It gets a plain blob URL
  and reads it with its own managed identity, which needs `Storage Blob Data
  Reader` on the account. That authorization is an Azure role assignment
  revocable in one place, not a signed string in flight.
- **The recording is deleted as soon as its transcript is stored.** The
  transcript is the deliverable; the audio is the most sensitive thing the
  feature holds. Only failed and abandoned jobs keep their media, so that a
  failure can be retried without asking somebody to hold the meeting again.
- **The transcript is untrusted text like a chat message.** It is a record of
  what people said, rendered as text nodes; the model's summary goes through the
  same `ModelMarkdown` renderer as a chat reply, which emits React elements and
  never an HTML string.
- **Summarising is logged like any other model call**, in `ai_chat_request_logs`
  with kind `transcription`. Admins can read it, for the same accountability
  reason chat is logged, and the transcription screen does not claim otherwise.

## Response headers

Applied to every route in `next.config.ts`:

| Header | Value | Purpose |
| --- | --- | --- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | Force HTTPS for two years |
| `X-Frame-Options` | `DENY` | Block click-jacking |
| `Content-Security-Policy` | `base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'` | Lock down tag-injection and form hijacking |
| `X-Content-Type-Options` | `nosniff` | Stop MIME sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Do not leak full URLs cross-origin |
| `Permissions-Policy` | `camera=(), microphone=(self), geolocation=(), browsing-topics=()` | Switch off unused device APIs. The microphone is allowed for **same-origin documents only**, because the transcription recorder needs it; `(self)` still denies every embedded third-party frame, which omitting the directive would allow. |

The CSP is deliberately **partial**: it does not yet restrict `script-src` /
`style-src`, because a strict policy needs per-request nonces (Next injects inline
bootstrap scripts) and live testing. See "Known follow-ups".

## Transport and network

- **TLS everywhere.** Keep `sslmode=verify-full` in `DATABASE_URL`.
- **Database firewall.** Restrict the Postgres server to the App Service (Azure
  services or specific outbound IPs); do not expose `0.0.0.0/0`.
- **Least-privilege DB user.** The app should connect as a non-superuser role.

## CSRF and trusted origins

Auth mutations run through the browser `authClient`, which sends an `Origin`
header that Better Auth enforces. `trustedOrigins` allows only the app's own URL
in production; in development it also allows localhost, LAN ranges, and
`*.trycloudflare.com` for phone and HTTPS testing (mirroring
`allowedDevOrigins` in `next.config.ts`).

## Rate limiting

- Better Auth global rate limiting is **enabled in production only**
  (`MODE=production`), with a window of 10 seconds and a max of 5 requests.
- **Two known limitations** (see follow-ups): it is global, not per-endpoint, so
  credential endpoints get no stricter treatment; and behind Azure App Service it
  currently cannot resolve the client IP from `X-Forwarded-For`, so it falls back
  to a single shared bucket per path rather than per-IP. Brute-force throttling
  still applies, but coarsely.

## Audit logging

`src/lib/audit/` records privileged and auth actions to `audit_logs`:

- Sign-in, failed sign-in, sign-out, password change, and impersonation start.
- An admin opening a user's AI chat request payload (`ai_chat.request_viewed`),
  naming both the admin and the person whose conversation was read.
- Account changes: creation, update, role change, activation/deactivation,
  invitation sent and cancelled, and de-identification.
- Team membership changes, which are authorization changes and are recorded as
  carefully as a role change.

When a project audits a field that is sensitive or encrypted, record only *that*
it changed, never the value - otherwise the trail becomes a plaintext copy of
the thing being protected. `changes` on `RecordAuditEventInput` says so too.

Audit writes are best-effort and fully guarded, so a logging failure never breaks
the auth or business flow. Rows are pruned by the monthly retention job (see
below), default 180 days.

## Secrets management

- Server env is validated at import time (`src/lib/env-server.ts`); the app
  refuses to start if a secret is missing or malformed.
- **Never commit `.env*`** (git-ignored). Store real values in **Azure Key Vault**
  or App Service application settings, not in GitHub.
- `BETTER_AUTH_SECRET` can be rotated, but doing so forces every user to sign in
  again.
- **`FIELD_ENCRYPTION_KEY` must never change** once data is encrypted with it.
  Nothing in the base encrypts anything today, so on a fresh deployment it is
  free to set - but the moment a project field-encrypts its first value,
  rotating the key makes that value permanently unreadable, and a rotation then
  requires a decrypt-with-old / re-encrypt-with-new migration. Treat it as
  permanent once real data exists. The same caution applies to enrolled 2FA
  secrets, which sit under `BETTER_AUTH_SECRET` rather than this key.

## Data retention and privacy

Personal data is governed by a retention and
de-identification policy (APP 11.2). A gated monthly job de-identifies dormant
accounts and prunes the audit log.

The trigger endpoint (`POST /api/jobs/data-retention`) is protected by a bearer
secret (`RETENTION_JOB_SECRET`) and returns 503 until that secret is set. It only
scrubs data when `RETENTION_JOB_ENABLED=true`; by default it runs as a no-op
preview, so deploying can never scrub data on its own. De-identification is
**irreversible**.

One ordering hazard worth knowing, and it matters more than it looks: the audit
purge runs BEFORE the de-identification sweep in the same request, and sign-in
events from the audit log are the **only** evidence of activity the sweep has -
there is no `last_active_at` column. If `AUDIT_LOG_RETENTION_DAYS` is shorter
than `RETENTION_INACTIVE_MONTHS`, accounts can look dormant purely because their
sign-in records were rotated away, and dormant here means scrubbed. Keep the
audit window comfortably longer than the inactivity window.

A project that adds its own record of activity (something dated that only a
present person produces) should widen the dormancy query to consider it, so the
rule does not rest on the audit log alone.

The same job also rotates the AI chat data, on three independent windows. None
of these is gated on `RETENTION_JOB_ENABLED` - that switch guards an
irreversible scrub of a person's identity, whereas these are routine rotation of
the user's own content on a window they can see.

| Setting | Default | What it removes |
| --- | --- | --- |
| `AI_CHAT_RETENTION_DAYS` | 365 | Conversations idle longer than this. Messages and their attachments cascade. |
| `AI_CHAT_LOG_RETENTION_DAYS` | 30 | Request-log rows. Much shorter on purpose: the table duplicates private content that admins can read, and grows with the **square** of thread length. |
| `AI_CHAT_STAGED_ATTACHMENT_HOURS` | 24 | Files uploaded but never sent. Nothing else collects these - the cascades only reach a file once it belongs to a turn. |
| `TRANSCRIPTION_RETENTION_DAYS` | 90 | Transcriptions and any recording still held for them. Shorter than chat on purpose: a meeting transcript is a record of other people, who did not choose to be recorded. |

Attachment BYTES live in Azure Blob, not Postgres - the database holds
metadata and a `storage_key`. That means a Postgres cascade removes the row and
**cannot touch the file**, so the job does three things for attachments rather
than one: it clears an expiring conversation's blobs before deleting its rows,
deletes the blobs behind swept staged uploads, and finally runs a
**reconciliation sweep** that removes any blob the database no longer claims.

That last pass is not belt-and-braces. De-identifying a dormant user cascades
through their conversations to their attachment rows without the chat code being
involved at all, so it is the only thing standing between that and files paid for
forever. A steadily non-zero `aiChatOrphanedBlobsPurged` in the job log means
something is deleting rows without clearing files first, and is worth
investigating rather than tolerating.

Transcription media has the same problem and the same three answers, in its own
container: expiring rows have their recordings cleared first, every delete path
clears storage before the row, and a reconciliation pass removes anything the
database no longer claims. `transcriptionOrphanedMediaPurged` reads exactly like
`aiChatOrphanedBlobsPurged` - steadily non-zero means a delete path is missing
its storage cleanup.

## Supply chain and CI

- **Dependency audit**: `pnpm audit --prod` is part of CI (informational) and is
  currently clean.
- **Dependabot**: weekly npm and github-actions update PRs (`.github/dependabot.yml`).
- **CI on every push/PR**: type-check, lint, and unit tests (`.github/workflows/ci.yml`).

## Known findings and follow-ups

From the differential security reviews (`tests/docs/security-review-*.md`) and the
security program. Status reflects the current code.

**Addressed**

- Client/server password-length policy now share the same constants (no drift).
- Email change now revokes all sessions after the new address is verified.
- The database query logger no longer writes query params outside development, so
  hashed passwords and ids are not logged.
- Change-email and change-password now have E2E coverage (`tests/e2e/`).
- The `/forbidden` route now exists. It was referenced by all three auth guards
  but had no page, so every authorization failure rendered "Page Not Found".
- Invitation errors now extend `DisplayErrorMessage`, so an expired link says so
  instead of falling back to the generic "Something went wrong".
- `env-server.ts`, the Kysely client and the sessions repository now carry
  `import "server-only"`; every module holding a secret is guarded.
- Update paths strip `id` before spreading a caller-supplied patch, so a supplied
  `id` cannot rewrite a primary key.
  addressed teams receives one message rather than two.
- The end-to-end runner refuses to run against a non-local database.

**Open / hardening**

- **Email change from a compromised session.** A change requires only a valid
  session (no password re-auth) and the verification link goes to the new address;
  the old address is **not** notified. Recommended: notify the old address on a
  change request, and/or require password re-auth. Session revocation after the
  change is the current partial mitigation.
- **Per-endpoint rate limiting.** Credential endpoints (change-password, verify,
  reset) rely on the permissive global limit. Consider stricter per-endpoint
  limits and step-up protection.
- **Client IP for rate limiting behind Azure.** Configure a trustworthy client-IP
  source (for example a front door that injects `x-azure-clientip`) so throttling
  is per-IP rather than a shared bucket.
- **Full CSP.** Add a nonce-based `script-src` / `style-src` policy via middleware,
  tested live so a bad policy cannot white-screen the app.
- **New password must differ from current** (informational hardening).

## Team-owned operational items

Outside the repo, the team should:

1. **GitHub**: enable Dependabot alerts and security updates, secret scanning with
   push protection, and branch protection on `main` and `development` (require CI
   green and review before merge).
2. **Database**: private endpoint or firewall rules (no public `0.0.0.0/0`),
   enforced TLS, least-privilege app user.
3. **Dynamic scanning**: run an OWASP ZAP baseline scan against staging each
   release and verify headers at securityheaders.com after deploy.
4. **Azure monitoring**: enable Microsoft Defender for Cloud and wire up
   Application Insights for request/exception telemetry and alerting.

## Incident response

1. **Contain.** If a session or credential is suspected compromised, disable the
   affected user (`isActive = false`, which is enforced at the next request) and,
   for a broader incident, rotate `BETTER_AUTH_SECRET` (forces all users to sign
   in again). Do **not** rotate `FIELD_ENCRYPTION_KEY`.
2. **Assess.** Use `audit_logs` (sign-ins, failed sign-ins, password changes,
   impersonation, sensitive-field changes) and Application Insights to scope what
   was accessed.
3. **Eradicate and recover.** Patch the cause, deploy, and confirm headers and
   auth flows post-deploy.
4. **Notify.** If personal information was exposed, follow the Notifiable Data
   Breaches obligations under the Privacy Act.
