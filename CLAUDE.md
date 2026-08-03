# CLAUDE.md

Condensed guidance for AI agents and contributors working in this repo. Full
detail is in `docs/`.

## What this is

A **reusable portal base**: Next.js 16 (App Router) with authentication,
role-based access, teams, scheduling and notifications already built. Projects
are started FROM this repo rather than from scratch.

Three authenticated surfaces plus a public marketing site. Postgres via Kysely,
Better Auth, Azure email. TypeScript, Tailwind CSS 4, shadcn/ui.

Because it is a base, two things matter more than usual:

- **Nothing may be domain-specific.** If a concept only makes sense for one
  industry, it does not belong here.
- **Rebranding must be one file.** Name and description come from the
  environment via `src/lib/brand.ts`; colours and type come from the token block
  in `src/app/globals.css`. Never hardcode a brand string or a hex anywhere else.

## Commands

- `pnpm dev` - dev server at <http://localhost:3000>
- `pnpm build` / `pnpm start` - production build / serve
- `pnpm lint` - ESLint
- `pnpm test` - unit tests (Vitest, co-located as `src/**/*.test.ts`)
- `pnpm test:e2e` - Playwright. Refuses to run against a non-local database.
- Type-check: `pnpm exec tsc --noEmit`

Package manager is **pnpm 10**; Node 20. Run lint and tsc before treating a
change as done - CI enforces both, and it type-checks `tests/**` too, so a
broken spec breaks the build.

## The model

**Users are the centre.** Every person is a user; there is no separate
person-without-a-login concept.

```text
users          admin | manager | member
teams          created and named explicitly by an admin, never implicitly
team_members   (team_id, user_id, team_role)  MANY-TO-MANY and optional
```

- `/admin` admins, everything
- `/manage` managers, scoped to the teams an admin assigned them
- `/portal` members, their own data. **No id in the URL** - the session is the identity.

Delivery: `programs` -> `classes` (own `start_date`/`end_date`) -> `class_sessions`,
with `class_members` for membership and `session_attendees` for the roster.

## Architecture (follow the layering)

Route `page.tsx` (auth guard) -> feature `.page.tsx` (compose) -> `.service.ts`
(server-only: logic + authorization) -> `*.repository.ts` (Kysely, the only DB
access) -> Postgres. Mutations go through `.actions.ts` (`"use server"`), which
validate with Zod and call a service. DTOs and schemas live in `.types.ts`.
Repositories must never import from features. See `docs/architecture.md`.

## Conventions that bite if ignored

- **Team membership is the security boundary, and it is many-to-many.** Any helper answering "which teams is this user in" returns `string[]`. Never `executeTakeFirst` into a single id: row order is not stable, so a user in two teams would silently get an arbitrary scope.
- **Guards belong in the service, not only the action.** A page that calls a service directly must still be safe. Use `requireUserRole`, `requireTeamScope`, `requireManagementScope`, `requireTeamAccess`, `requireTeamManagement` from `src/lib/auth/session-auth-server.ts`.
- **Resolve the actor from the session, never from the URL.** No route parameter is proof of access.
- **An empty scope means nothing, not everything.** A manager with no teams sees no rows.
- **A scope failure answers `notFound()`, not "forbidden".** Saying "forbidden" to a guessed id confirms the record exists and turns the route into an enumeration oracle. A *role* failure may say so plainly.
- **Calendar dates are `'YYYY-MM-DD'` strings, not `Date`.** Postgres `DATE` is parsed to a string on purpose (timezone-safe, React-renderable). Compare lexicographically. See `src/lib/data/kysely-database-client.ts`.
- **The app timezone is `NEXT_PUBLIC_APP_TIME_ZONE`**, read once in `src/lib/timezone.ts`. Never hardcode a zone, and never use `new Date()` to decide what day it is - use `todayInAppZone()`.
- **Roles are server-assigned.** `role` / `isActive` are `input:false` in Better Auth - never accept them from the client.
- **Sanitize rich text** server-side (`src/lib/sanitize-rich-text.ts`) before `dangerouslySetInnerHTML`.
- **Admin-editable JSON is validated on read.** Home page blocks fall back to defaults if malformed rather than throwing, and report which keys fell back.
- **Icons from the database resolve through an allowlist** (`LANDING_ICONS`), never a dynamic module lookup.
- **`updated_at` has no trigger.** Any update that spreads a patch must set `updatedAt` itself, and must strip `id` before spreading or a caller-supplied `id` rewrites the primary key.
- **Errors:** services/repositories use `handleError`; actions return `ServerApiResponse` via `handleServerApiError`. Both call `unstable_rethrow` so Next's `redirect()`/`notFound()` escape the catch - do not wrap them in a plain try/catch.
- **`src/lib/tanstack-table.d.ts` has no importers but is load-bearing** - it declares `ColumnMeta.label`, used by the mobile table layout. Do not delete it as dead code.
- **`data-table.tsx` carries `"use no memo"`** deliberately; removing it makes the table serve stale rows.
- **Never change `BETTER_AUTH_SECRET` or `FIELD_ENCRYPTION_KEY` on a live environment** - it breaks decryption and 2FA. `NEXT_PUBLIC_APP_TITLE` is the TOTP issuer, so changing it relabels every enrolled authenticator.

## Writing style

No em dashes or en dashes anywhere - use hyphens only. Applies to code comments,
docs, commit messages, and UI copy.

## Where things are

- `src/app` - routes: `(admin)` / `(manage)` / `(portal)` / `(public)`.
- `src/features/<x>` - feature modules (page / service / actions / types / components).
- `src/lib` - `auth`, `data` (Kysely client + types + repositories + `sql/`), `email`, `crypto`, `audit`, `brand`, `env`.
- `src/components` - `ui/` (shadcn), `form/`, `brand/`, shared tables and dialogs.
- Unit tests are co-located (`src/**/*.test.ts`); Playwright lives in `tests/e2e`.
- Schema: `src/lib/data/sql/database-schema.sql` (no migration runner; applied manually). No seed file - bootstrap the first admin with `scripts/create-admin.mjs`.

## Deploy

`.github/workflows/deploy.yml` is an **unconfigured template**: manual-only, and
it fails fast unless `AZURE_WEBAPP_NAME` is set. Configure it deliberately per
project. See `docs/deployment.md`.
