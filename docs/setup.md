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
| `NEXT_PUBLIC_APP_URL` | yes | full URL including scheme and port, e.g. `http://localhost:3100`. Source of truth for the port - see "Changing the port" below |
| `NEXT_PUBLIC_APP_TIME_ZONE` | no | IANA zone the app renders dates and times in. Defaults to `Australia/Adelaide`. Set it deliberately per project - see `src/lib/timezone.ts`. |
| `NEXT_PUBLIC_BETTER_AUTH_COOKIE_PREFIX` | yes | non-empty |
| `NEXT_PUBLIC_PASSWORD_MIN_LENGTH` | yes | keep in sync with the server (8) |
| `NEXT_PUBLIC_PASSWORD_MAX_LENGTH` | yes | keep in sync with the server |

**Optional**

| Variable | Notes |
| --- | --- |
| `E2E_OUTPUT_DIR` | Playwright artefact directory. Keep it OFF any OneDrive-synced path (OneDrive locks files, causing `EPERM`). Defaults to the OS temp dir. |

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

There is no seed file, so no credentials are ever committed. Sign-up is
invite-only, so bootstrap the first admin account directly:

```bash
ADMIN_EMAIL=you@example.com node --env-file=.env scripts/promote-admin.mjs
```

It prints a generated password once, makes no changes if that email already
exists, and is safe to run against any environment. Sign in, complete the
mandatory staff 2FA setup, then change the password in Settings.

## 4. Run

```bash
pnpm dev          # dev server at http://localhost:3100
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

Type-check with `pnpm exec tsc --noEmit`.

### Changing the port

The app runs on **3100** by default, chosen to stay clear of the 3000-3002 range
most other local servers grab. Changing it takes two edits, and they must agree:

1. `NEXT_PUBLIC_APP_URL` in `.env` - include the port, e.g. `http://localhost:4000`
2. the `-p` flag on **both** the `dev` and `start` scripts in `package.json`

Everything else follows from the first: Better Auth derives its trusted loopback
origins from that URL (so sign-in keeps working on both `localhost` and
`127.0.0.1`), and Playwright uses it as its base URL.

Change only one of the two and the failure is confusing rather than obvious -
the app serves fine, but sign-in fails as a cross-origin request, and the E2E
suite hangs waiting for a URL nothing is listening on. `pnpm start` needs the
flag as well as `pnpm dev`, because Playwright serves a production build.

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
