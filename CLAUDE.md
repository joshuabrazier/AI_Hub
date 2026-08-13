# CLAUDE.md

Condensed guidance for AI agents and contributors working in this repo. Full
detail is in `docs/`.

## What this is

A **reusable portal base**: Next.js 16 (App Router) with authentication,
role-based access, teams and notifications already built. Projects are started
FROM this repo rather than from scratch.

It is deliberately a **blank canvas** below that line: there is no delivery or
scheduling domain in it. Whatever a project actually does gets added as new
feature modules following the layering below.

Three authenticated surfaces plus a public marketing site. Postgres via Kysely,
Better Auth, Azure email. TypeScript, Tailwind CSS 4, shadcn/ui.

Because it is a base, two things matter more than usual:

- **Nothing may be domain-specific.** If a concept only makes sense for one
  industry, it does not belong here.
- **Rebranding must be one file.** Name and description come from the
  environment via `src/lib/brand.ts`; colours and type come from the token block
  in `src/app/globals.css`. Never hardcode a brand string or a hex anywhere else.

## Commands

- `pnpm dev` - dev server at <http://localhost:3100> (the port is set in the `dev`/`start` scripts and must match `NEXT_PUBLIC_APP_URL`)
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

Everything else is cross-cutting and domain-neutral: invitations, notifications
(types, templates, broadcasts, per-person preferences), signable documents, site
content, enquiry categories, the audit log and the retention job.

**AI chat** is the one feature with its own data:

```text
ai_chat_subjects   one conversation, owned by one user (+ its compaction summary)
ai_chat_messages   its turns, in order (+ per-turn token and cache usage)
```

It is **per-person, not team-scoped** - a conversation is private to its owner
and no role overrides that, so the guard is `requireUser` and the boundary is
the `userId` predicate on every query. Mounted in all three areas at
`/{admin,manage,portal}/ai-chat`, all rendering one feature page.

## Architecture (follow the layering)

Route `page.tsx` (auth guard) -> feature `.page.tsx` (compose) -> `.service.ts`
(server-only: logic + authorization) -> `*.repository.ts` (Kysely, the only DB
access) -> Postgres. Mutations go through `.actions.ts` (`"use server"`), which
validate with Zod and call a service. DTOs and schemas live in `.types.ts`.
Repositories must never import from features. See `docs/architecture.md`.

**One documented exception:** the AI chat send is a Route Handler
(`src/app/api/ai-chat/stream/route.ts`), not an action, because a server action
cannot return a stream. Everything else holds - Zod still validates at the
boundary, and the service still owns authorization and every write. A route
handler is NOT covered by the proxy matcher and has no area layout above it, so
its own session check is the outer gate; the service re-checks. Do not copy the
pattern for anything that does not genuinely need to stream.

## Conventions that bite if ignored

- **Team membership is the security boundary, and it is many-to-many.** Any helper answering "which teams is this user in" returns `string[]`. Never `executeTakeFirst` into a single id: row order is not stable, so a user in two teams would silently get an arbitrary scope.
- **Guards belong in the service, not only the action.** A page that calls a service directly must still be safe. Use `requireUserRole`, `requireTeamScope`, `requireManagementScope`, `requireTeamAccess`, `requireTeamManagement` from `src/lib/auth/session-auth-server.ts`.
- **Resolve the actor from the session, never from the URL.** No route parameter is proof of access.
- **An empty scope means nothing, not everything.** A manager with no teams sees no rows.
- **A scope failure answers `notFound()`, not "forbidden".** Saying "forbidden" to a guessed id confirms the record exists and turns the route into an enumeration oracle. A *role* failure may say so plainly.
- **Calendar dates are `'YYYY-MM-DD'` strings, not `Date`.** The pg type parser in `src/lib/data/kysely-database-client.ts` maps Postgres `DATE` to a string on purpose (timezone-safe, React-renderable), and `TIME` to `'HH:MM:SS'`. No table currently has a `DATE` column, but the parser stays so the first one a project adds is safe by default. Type such columns as `string` and compare lexicographically.
- **The app timezone is `NEXT_PUBLIC_APP_TIME_ZONE`**, read once in `src/lib/timezone.ts` as `APP_TIME_ZONE`. Never hardcode a zone, and never use `new Date()` to decide what calendar day it is - derive it in the app zone (`formatDateTime` in `src/lib/format.ts` is the pattern).
- **Roles are server-assigned.** `role` / `isActive` are `input:false` in Better Auth - never accept them from the client.
- **Sanitize rich text** server-side (`src/lib/sanitize-rich-text.ts`) before `dangerouslySetInnerHTML`.
- **Admin-editable JSON is validated on read.** Home page blocks fall back to defaults if malformed rather than throwing, and report which keys fell back.
- **Icons from the database resolve through an allowlist** (`LANDING_ICONS`), never a dynamic module lookup.
- **`updated_at` has no trigger.** Any update that spreads a patch must set `updatedAt` itself, and must strip `id` before spreading or a caller-supplied `id` rewrites the primary key.
- **Errors:** services/repositories use `handleError`; actions return `ServerApiResponse` via `handleServerApiError`. Both call `unstable_rethrow` so Next's `redirect()`/`notFound()` escape the catch - do not wrap them in a plain try/catch.
- **`src/lib/tanstack-table.d.ts` has no importers but is load-bearing** - it declares `ColumnMeta.label`, used by the mobile table layout. Do not delete it as dead code.
- **`data-table.tsx` carries `"use no memo"`** deliberately; removing it makes the table serve stale rows.
- **AI chat pins its region and model in code** (`src/lib/ai/bedrock-client.ts`). The Bedrock key is locked to Australia and scoped to one model; the `au.` prefix is a cross-region inference profile that routes only within AU, and `global.`/`us.` are denied by the key's IAM policy. Never make either configurable, and never "fix" throttling by switching prefix. The model id takes no date stamp and no `:0`.
- **Chat content is rendered as a text node, never as HTML.** Both halves are untrusted - the user's because they typed it, the model's because a model repeats back what it was given. There is deliberately no rich-text path in that feature.
- **With prompt caching on, `inputTokens` is only the UNCACHED remainder.** Total input is `inputTokens + cacheReadTokens + cacheWriteTokens`. Measured live: a cached turn reported `inputTokens: 3` for a request that actually sent 8,207. Use `totalInputTokens` off the DTO; reading `inputTokens` alone is how a working cache gets mistaken for a broken counter.
- **The chat cache point goes LAST in the request**, so the cached prefix is the whole conversation. Opus 4.6 needs 4,096 tokens minimum (below that it silently does not cache, which is fine) and has a **5-minute TTL with no 1-hour option** - that short TTL is why compaction exists alongside caching.
- **Anthropic's server-side compaction is not reachable over Bedrock Converse** - it is a Messages-API beta needing an `anthropic-beta` header, and Converse cannot send one. `compactIfNeeded` in the chat service is the client-side equivalent. Compaction only changes what is SENT; the original turns stay in the database and stay readable.
- **Never change `BETTER_AUTH_SECRET` or `FIELD_ENCRYPTION_KEY` on a live environment** - it breaks decryption and 2FA. `NEXT_PUBLIC_APP_TITLE` is the TOTP issuer, so changing it relabels every enrolled authenticator.

## Writing style

No em dashes or en dashes anywhere - use hyphens only. Applies to code comments,
docs, commit messages, and UI copy.

## Where things are

- `src/app` - routes: `(admin)` / `(manage)` / `(portal)` / `(public)`.
- `src/features/<x>` - feature modules (page / service / actions / types / components).
- `src/lib` - `auth`, `data` (Kysely client + types + repositories + `sql/`), `ai` (the pinned Bedrock client), `email`, `crypto`, `audit`, `brand`, `env`.
- `src/components` - `ui/` (shadcn), `form/`, `brand/`, shared tables and dialogs.
- Unit tests are co-located (`src/**/*.test.ts`); Playwright lives in `tests/e2e`.
- Schema: `src/lib/data/sql/database-schema.sql` (no migration runner; applied manually). No seed file - bootstrap the first admin with `scripts/create-admin.mjs`.

## Deploy

`.github/workflows/deploy.yml` is an **unconfigured template**: manual-only, and
it fails fast unless `AZURE_WEBAPP_NAME` is set. Configure it deliberately per
project. See `docs/deployment.md`.
