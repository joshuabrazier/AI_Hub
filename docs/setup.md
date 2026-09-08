# Setup and local development

## Prerequisites

- **Node.js 20** (matches CI and Azure).
- **pnpm 10** (the repo's package manager).
- A **Postgres** database (local or hosted).
- Optional: Azure Communication Services for real email. Not needed locally - emails are logged instead of sent by default.

## 1. Install

```bash
pnpm install
```

## 2. Environment

Copy `.env.example` to `.env` and fill it in. The app validates env at import
time (`src/lib/env-server.ts`, `src/lib/env-client.ts`) and refuses to start if
anything is missing or malformed.

**Server variables**

| Variable | Required | Notes |
| --- | --- | --- |
| `MODE` | default `development` | `development` \| `test` \| `production` |
| `DATABASE_URL` | yes | Postgres connection string; keep `sslmode=verify-full` on hosted databases |
| `BETTER_AUTH_SECRET` | yes | at least 32 characters |
| `FIELD_ENCRYPTION_KEY` | yes | base64 32-byte key. Generate: `openssl rand -base64 32` |
| `EMAIL_FROM_ADDRESS` | yes | a valid from address |
| `EMAIL_AZURE_ENDPOINT` | when sending | Azure Communication Services endpoint |
| `EMAIL_AZURE_ACCESS_KEY` | when sending | Azure Communication Services key |
| `EMAIL_SEND_ENABLED` | default `false` | `"true"` sends real email in any environment; `"false"` logs it instead |

**Client variables** (baked into the browser bundle at build time)

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_TITLE` | yes | |
| `NEXT_PUBLIC_APP_DESCRIPTION` | yes | |
| `NEXT_PUBLIC_APP_URL` | yes | full URL including scheme and port, e.g. `http://localhost:3000`. Source of truth for the port - see "Changing the port" below |
| `NEXT_PUBLIC_APP_TIME_ZONE` | no | IANA zone the app renders dates and times in. Defaults to `Australia/Adelaide`. Set it deliberately per project - see `src/lib/timezone.ts`. |
| `NEXT_PUBLIC_BETTER_AUTH_COOKIE_PREFIX` | yes | non-empty |
| `NEXT_PUBLIC_PASSWORD_MIN_LENGTH` | yes | keep in sync with the server (8) |
| `NEXT_PUBLIC_PASSWORD_MAX_LENGTH` | yes | keep in sync with the server |

**Optional**

| Variable | Notes |
| --- | --- |
| `E2E_OUTPUT_DIR` | Playwright artefact directory. Keep it OFF any OneDrive-synced path (OneDrive locks files, causing `EPERM`). Defaults to the OS temp dir. |
| `DEV_PASSWORD_SIGN_IN` | `true` opens a password form on /sign-in so the app runs without Entra. **Local development only** - ignored unless `MODE` is `development` or `test`. See "Without Entra" below. |

> **Warning:** `BETTER_AUTH_SECRET` and `FIELD_ENCRYPTION_KEY` decrypt existing
> encrypted data and 2FA secrets. Once real data exists, changing either breaks
> decryption. Generate them once and keep them stable.

## 3. Database

There is no migration runner. The schema is raw SQL in `src/lib/data/sql`:

- `database-schema.sql` - the full schema (tables, indexes).

Apply it to your database:

```bash
psql "$DATABASE_URL" -f src/lib/data/sql/database-schema.sql
```

There is no seed file, so no credentials are ever committed.

## 3a. Getting a first account

Sign-in is Microsoft (Entra) only, and new accounts are always members. So a
fresh database has no admin, and there is no in-app way to make one. Which
route you take depends on whether you have an Entra app registration yet.

### With Entra configured (the real path)

Set `MICROSOFT_CLIENT_ID` / `MICROSOFT_TENANT_ID` / `MICROSOFT_CLIENT_SECRET`,
register `http://localhost:3000/api/auth/callback/microsoft` as a redirect URI
on the app registration, and sign in once - which auto-provisions you as a
member. Then promote yourself:

```bash
ADMIN_EMAIL=you@example.com node --env-file=.env scripts/promote-admin.mjs
```

It changes nothing if the account is already an admin, and refuses politely if
no account exists yet - because until somebody signs in, there is nothing to
promote. A row inserted by hand could not work: it would have no linked Entra
identity.

### Without Entra (local development only)

With no `MICROSOFT_*` variables the sign-in page has no button on it, so the
app cannot be run at all. Two steps open a password door instead:

```bash
# 1. in .env
DEV_PASSWORD_SIGN_IN=true

# 2. create the account (PowerShell)
$env:DEV_USER_EMAIL = "you@example.com"
$env:DEV_USER_ROLE  = "admin"
node --env-file=.env scripts/create-dev-user.mjs
```

It prints the generated password once, or uses `DEV_USER_PASSWORD` if you set
one. Re-running it for the same address resets the password and role rather
than failing, so it doubles as the password reset the app does not have.
Restart the dev server after changing the flag - it is read at import time.

Both halves are required and neither is sufficient: the flag is the deliberate
opt-in, and `MODE` not being `production` is the backstop for an `.env` being
copied somewhere it should not be. `scripts/create-dev-user.mjs` refuses to run
against `MODE=production` for the same reason.

**What this costs.** While the flag is on, an account can be signed into without
Entra ever seeing it, which is the whole reason the app normally has a single
front door. Nothing else is relaxed - the domain allowlist still gates account
creation, deactivated accounts are still refused, and sign-ins are still
audited - and the sign-in page says on screen that the form is a development
one. Do not set it on anything deployed.

## 4. Run

```bash
pnpm dev          # dev server at http://localhost:3000
```

| Script | Purpose |
| --- | --- |
| `pnpm dev` | development server |
| `pnpm build` | production build (standalone output) |
| `pnpm start` | serve the production build |
| `pnpm lint` | ESLint |
| `pnpm test` | unit tests (Vitest, one-shot) |
| `pnpm test:watch` | unit tests (watch mode) |
| `pnpm test:e2e` | end-to-end tests (Playwright) |
| `pnpm test:all` | unit + end-to-end |
| `node --env-file=.env scripts/check-bedrock.mjs` | confirm the AI chat key, region and model work |
| `node --env-file=.env scripts/promote-admin.mjs` | make an existing account an admin (needs `ADMIN_EMAIL`) |
| `node --env-file=.env scripts/create-dev-user.mjs` | create a local password account (needs `DEV_USER_EMAIL`; local development only) |

Type-check with `pnpm exec tsc --noEmit`.

### Changing the port

The app runs on **3000** by default. Changing it takes two edits, and they must
agree:

1. `NEXT_PUBLIC_APP_URL` in `.env` - include the port, e.g. `http://localhost:4000`
2. the `-p` flag on **both** the `dev` and `start` scripts in `package.json`

Everything else follows from the first: Better Auth derives its trusted loopback
origins from that URL (so sign-in keeps working on both `localhost` and
`127.0.0.1`), and Playwright uses it as its base URL.

Change only one of the two and the failure is confusing rather than obvious -
the app serves fine, but sign-in fails as a cross-origin request, and the E2E
suite hangs waiting for a URL nothing is listening on. `pnpm start` needs the
flag as well as `pnpm dev`, because Playwright serves a production build.

## Windows: do this first

Real-time virus scanning inspects every file in `node_modules` and `.next`
individually. With ~800 MB across ~1,300 packages that turns a one-package
install into minutes and a build into a coffee break. In an **admin**
PowerShell, once:

```powershell
Add-MpPreference -ExclusionPath "C:\Dev\AI_Hub"
```

Adjust the path if the repo lives elsewhere. This speeds up `pnpm install`,
`pnpm build` and `pnpm dev` startup together.

**And do not use `pnpm build` to check your work.** `pnpm exec tsc --noEmit`,
`pnpm lint` and `pnpm test` catch everything it would and finish quickly.
`next build` type-checks and lints internally, then `output: "standalone"`
traces and copies most of `node_modules` into `.next/standalone` - which is
what you are waiting for after "Compiled successfully" appears. Save it for
when you are actually deploying.

CI runs on Linux and has neither problem, so this is a local annoyance rather
than anything that affects a deploy.

## 5. Tests

**Unit (Vitest)** - co-located as `src/**/*.test.ts`, NOT in a `tests/unit`
directory. Node environment, loads `.env`, mirrors the
`@/` path alias. Covers Zod schemas, validation, formatters, field encryption,
and the rich-text sanitizer.

```bash
pnpm test
```

**End-to-end (Playwright)** - `tests/e2e/**`. Critical auth flows (sign-in, 2FA,
password/email change, accept-invite, portal account, and the team-scoping
boundary). Playwright **builds the
app and serves it with `next start`** (not the dev server) so routes are
precompiled and stable, then shuts it down when the run finishes.

- Install the browser once: `pnpm exec playwright install chromium`
- Stop `pnpm dev` first - the built server uses the same port.
- The runner REFUSES to start against a non-local database. The suite creates
  and deletes users and teams in whatever `.env` points at, so copying a
  production `.env` in would write to live data. Override with
  `E2E_ALLOW_REMOTE_DB=true` only for a database you are certain is disposable.
- Run: `pnpm test:e2e` (routes through `tests/run-e2e.mjs`, which forces plain, non-animated output so Windows terminals do not garble it).
- If artefact writes fail with `EPERM`, set `E2E_OUTPUT_DIR` to a non-OneDrive path.

## Phone / HTTPS testing

`next.config.ts` allows dev origins from `*.trycloudflare.com` and LAN ranges,
and Better Auth trusts the same in non-production. So you can expose `pnpm dev`
through a Cloudflare quick tunnel or a LAN IP to test on a phone over HTTPS.

This is not optional for **transcription**: `getUserMedia` is a secure-context
API, so the browser will refuse the microphone over plain `http://` to anything
but `localhost`. On a phone that means a tunnel, not a LAN IP. Without one the
record tab correctly says recording is unavailable, which looks like a bug and
is not.

## File attachments in local development

Chat file attachments need blob storage. Locally that is **Azurite**, the
official emulator, already a dev dependency:

```bash
pnpm dev:storage   # in a second terminal, alongside pnpm dev
```

Then uncomment `AZURE_STORAGE_CONNECTION_STRING` in `.env` using the emulator
line from `.env.example`. That account key is a published constant that ships
with Azurite - safe on localhost, and it must never appear in a real
environment.

Leave it unset and everything else still works; the composer just does not offer
the paperclip.

Emulator data lands in `.azurite/`, which is git-ignored. Delete the directory to
start clean.

### CORS, which transcription needs and chat does not

Transcription uploads go **browser-to-blob**, so the browser makes a cross-origin
request to storage and the blob service has to answer a preflight. Neither
Azurite nor a fresh Azure account has any CORS rules, so without this the upload
fails before it starts - and it fails in the browser, with nothing in the app's
logs to say why.

```bash
pnpm dev:storage:cors   # once, with Azurite already running
```

Chat attachments do not need it: those are proxied through the app, so the
browser only ever talks to the app's own origin.

The script **refuses to run against anything but the emulator**, on purpose.
CORS is set on the storage ACCOUNT and `setProperties` replaces the whole rule
set, so pointing it at a shared account would delete the rules every other
application on it depends on. Real environments get their rules from the Portal
instead - see `docs/deployment.md`.

## Transcription in local development

Two things, and they fail differently:

1. **Storage**, as above. The media goes in its own container
   (`AZURE_MEDIA_CONTAINER`, default `transcription-media`), created on first
   use, so Azurite covers it with no extra setup.
2. **An Azure AI Speech resource.** There is no emulator for this one. Create a
   Speech resource in an Australian region, then set `AZURE_SPEECH_KEY` and
   `AZURE_SPEECH_REGION`.

With storage but no Speech key, the screen says so rather than accepting a
recording nothing will read. With neither, it says that instead.

**The local catch.** Batch transcription takes a URL and the Speech service
fetches it *itself*, so it has to be able to reach the blob - and it cannot
reach Azurite on your laptop. Transcribing end to end locally therefore needs a
real storage account rather than the emulator, and that account's access granted
to the Speech resource. Everything up to the point of creating the job - the
recorder, the upload, the row, the states - works against Azurite.

In a real environment the app hands over a plain blob URL with no token on it,
and the Speech resource reads it with its **own managed identity**. Grant that
identity `Storage Blob Data Reader` on the storage account or every job fails
with an access error. See `docs/deployment.md`.

### Importing from Teams

The third tab needs **neither of the two above**. It fetches a transcript Teams
already made, through Microsoft Graph, so there is no upload and no Speech job -
an environment with Microsoft sign-in and no Speech key still has a working
Teams tab, and the composer says why the other two are missing.

What it does need:

1. **Microsoft sign-in configured** (`MICROSOFT_CLIENT_ID`,
   `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`). Every Graph call is
   delegated, so with no Entra provider there is no token and no way in. There
   is deliberately no local shortcut: `DEV_FAKE_SHAREPOINT_URL` is excluded, and
   the tab reports itself unavailable rather than sending a fake token to real
   Graph.
2. **Tenant admin consent for three added scopes** - `Calendars.Read`,
   `OnlineMeetings.Read` and `OnlineMeetingTranscript.Read.All`, listed with
   their reasons in `src/lib/sharepoint/graph-client.ts`. `.All` cannot be
   consented to by an ordinary user; without approval every import fails with a
   403 that reads as a bug rather than a permission.
3. **Everyone signs in again, once.** A refresh token already issued carries the
   scopes it was granted with, so adding these does not upgrade an existing one.
   Until somebody signs in again the tab reports that Microsoft would not grant
   access, and tells them to.

Microsoft publishes no delegated scope narrower than `.All` for meeting
transcripts, so that is the only door there is. What bounds it is that the calls
are delegated: Graph will not return a transcript for a meeting the signed-in
person was not part of.

**And two tenant-wide Teams switches, both OFF by default.** Entra consent is
not sufficient on its own, and this is the step most likely to be missed:

```powershell
Set-CsTeamsMeetingConfiguration -Identity Global `
  -EnableGraphTranscriptAccess $true `
  -EnableAttributedTranscripts $true
```

Or in the Teams admin center: **Meetings > Meeting settings > Transcript API
access > Microsoft Graph access = On**, then **Configure > Include speaker
attribution = On**.

Both matter, and they fail differently:

- Without `EnableGraphTranscriptAccess`, every import returns 403 and Microsoft
  states plainly that there is no request-side workaround.
- Without `EnableAttributedTranscripts`, the transcript comes back with no
  speaker names. The app refuses that rather than importing it, because names
  are the whole reason to use Teams here instead of recording - an anonymous
  Teams transcript is strictly worse than what the recorder already produces.

The app names the missing setting in both cases rather than saying "sign in
again", which is why it reads Graph's `innerError.code` instead of the status.

**It only works for meetings this tenant hosts, and only if transcription was
started during the meeting.** Neither is something the app can fix. A meeting a
client ran on their own tenant belongs to their tenant, and the recorder is the
answer for those.

### Presence, for the in-meeting prompt

The app can notice you are in a Teams meeting and offer to have it
transcribed. That reads `/me/presence`, which needs the `Presence.Read`
scope.

`Presence.Read` is your OWN presence. Do not grant `Presence.Read.All`:
it would let the app see when any colleague is in a call, which is a
surveillance capability whatever it was added for, and nothing here needs it.

Like every other Graph scope, adding it costs a tenant admin consent AND one
sign-in from everybody. A refresh token already issued keeps the scopes it
was granted with, so until somebody signs in again the prompt stays silent
for them - by design, not as a failure.

The prompt asks you to start transcription in Teams. It cannot start it for
you: Graph has no API to do that on somebody's behalf. If you want it
automatic, that is a Teams meeting policy that auto-transcribes, set by an
admin:

```powershell
Set-CsTeamsMeetingPolicy -Identity Global -AllowTranscription $true
```

Nothing in the app records a Teams meeting itself, and that is deliberate.
Teams announces transcription to everyone in the meeting; this app cannot put
audio into a Teams call, so it could never announce anything to anybody but
you. See the note at the top of `meeting-prompt.tsx`.
