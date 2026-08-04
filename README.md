# Portal base

A reusable Next.js 16 (App Router) starting point for internal portals. It ships
the parts every one of them needs, already built and secured:

- email/password authentication with mandatory two-factor for staff
- invite-only sign-up, password reset, email change
- three role-scoped areas: admin, manager, member
- teams, with many-to-many membership as the security boundary
- notifications with per-person preferences and unread tracking
- signable documents with field-encrypted signatures
- an append-only audit trail and a data-retention job
- a public marketing site whose copy is edited from inside the app

It carries **no domain of its own**: there is nothing here about what a
particular project delivers. That is the point - the plumbing is finished, the
subject matter is not, and whatever the project actually does gets added as new
feature modules following the layering in
[docs/architecture.md](docs/architecture.md).

Start projects **from** this repo rather than from scratch. See
[docs/README.md](docs/README.md) for the checklist.

## Documentation

- [docs/architecture.md](docs/architecture.md) - the domain model, the three areas, the layering, authorization and team scoping.
- [docs/setup.md](docs/setup.md) - prerequisites, environment, database, running the app and tests.
- [docs/deployment.md](docs/deployment.md) - the Azure App Service runbook.
- [docs/security.md](docs/security.md) - the single security reference.
- [CLAUDE.md](CLAUDE.md) - condensed contributor and agent reference.

## Getting started

```bash
pnpm install
cp .env.example .env          # then fill it in
psql "$DATABASE_URL" -f src/lib/data/sql/database-schema.sql
ADMIN_EMAIL=you@example.com node --env-file=.env scripts/create-admin.mjs
pnpm dev
```

There is no seed file, deliberately: nothing in this repo contains credentials.
`create-admin.mjs` prints a generated password once, makes no changes if that
email already exists, and is safe to run against any environment.

Sign in, complete the mandatory two-factor setup, then change your password in
Settings.

## Rebranding

Three places, and nowhere else:

| What | Where |
| --- | --- |
| Name, description, timezone | `NEXT_PUBLIC_APP_TITLE` / `_APP_DESCRIPTION` / `_APP_TIME_ZONE` |
| Short name, legal name, copyright | `src/lib/brand.ts` |
| Colours, type, radius | the token block at the top of `src/app/globals.css` |

Plus `public/logo.png`. No component hardcodes a brand string or a hex value.

> `NEXT_PUBLIC_APP_TITLE` is also the two-factor issuer, so changing its value on
> a live environment relabels the entry in every enrolled authenticator app.
> Existing secrets keep verifying, but people see a stale name. Choose it once.

## Commands

| Script | Purpose |
| --- | --- |
| `pnpm dev` | development server |
| `pnpm build` / `pnpm start` | production build / serve |
| `pnpm lint` | ESLint |
| `pnpm test` | unit tests (Vitest, co-located as `src/**/*.test.ts`) |
| `pnpm test:e2e` | Playwright end-to-end |
| `pnpm exec tsc --noEmit` | type-check |

CI runs type-check, lint and unit tests, and it type-checks `tests/**` too, so a
broken spec breaks the build.

`pnpm test:e2e` **refuses to run against a non-local database.** The suite
creates and deletes users, teams and notifications in whatever `.env` points at, and
copying a production `.env` in to "get it running" is an easy mistake to make.
Override with `E2E_ALLOW_REMOTE_DB=true` only for a database you are certain is
disposable.

## Data retention

The monthly job at `/api/jobs/data-retention` de-identifies inactive accounts
and rotates the audit log. It is **inert until deliberately enabled**:

- `RETENTION_JOB_SECRET` - the bearer token the endpoint requires. Until it is set, the endpoint returns 503.
- `RETENTION_JOB_ENABLED` - defaults to `false`, meaning the job only reports what it *would* de-identify. Set `true` only once a retention policy is signed off, because de-identification is irreversible.
- `AUDIT_LOG_RETENTION_DAYS` - defaults to 180. Set to 0 to keep the audit trail indefinitely.

Note the ordering: the audit purge runs before the de-identification sweep in
the same request, and the sweep uses sign-in events from the audit log to decide
who is dormant. If the retention window is shorter than the inactivity window,
accounts can look dormant purely because their sign-in records were rotated
away. Keep `AUDIT_LOG_RETENTION_DAYS` longer than the inactivity threshold.

See [docs/security.md](docs/security.md) for the full policy.

## Deploy

`.github/workflows/deploy.yml` builds on CI and ships a standalone artifact to
Azure App Service. It is **manual-only and unconfigured on purpose**: it fails
fast unless `AZURE_WEBAPP_NAME` is set, so a project copied from this base
cannot deploy anywhere by accident. See
[docs/deployment.md](docs/deployment.md).
