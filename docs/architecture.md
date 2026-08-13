# Architecture

This is a **reusable portal base**, not a finished product. It ships the parts
every internal portal needs - authentication, two-factor, invitations,
role-based access, teams, notifications, document signing, an audit trail and a
data-retention job - so a new project starts from a working, secured
application rather than from nothing.

It deliberately ships **no domain**. There is nothing in it describing what any
particular project delivers, so the first real work on a new project is adding
that, not unpicking somebody else's.

It is a server-rendered Next.js 16 / React 19 app backed by Postgres, with
Better Auth for authentication and Azure Communication Services for email.

## Tech stack

| Area | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, React Server Components, Server Actions) |
| Language | TypeScript 5 |
| UI | Tailwind CSS 4, shadcn/ui (Radix UI), lucide-react icons |
| Data | Postgres via Kysely (typed query builder) + node-postgres (pg) |
| Auth | Better Auth (email/password, impersonation, two-factor) |
| Validation | Zod, react-hook-form |
| Email | Azure Communication Services |
| Rich text | TipTap editor, sanitize-html on the server |
| Encryption | Node crypto, field-level for sensitive data |
| Tests | Vitest (unit, co-located), Playwright (end-to-end) |
| Hosting | Azure App Service (standalone build), GitHub Actions CI |

## The domain model

**Users are the centre.** Every person in the system is a user with a login.
There is no separate "person without an account" concept.

```text
users          role: admin | manager | member
teams          created and named explicitly by an admin, never implicitly
team_members   (team_id, user_id, team_role)   MANY-TO-MANY, and optional
```

A user can belong to no team, one team, or several. `team_role` (`manager` or
`member`) is that user's role *inside* a team, and is separate from their
platform role: the platform role decides which area they can reach, the team
role decides what they can do inside a team they belong to. An admin assigns a
manager to a team by creating a `team_members` row with `team_role = 'manager'`.

That is the whole domain. Everything else is cross-cutting: `user_invitations`,
`documents` and `document_signatures`, `notifications` (+ types, templates,
broadcasts), `site_content`, `enquiry_categories` / `enquiry_submissions`,
`audit_logs`, plus Better Auth's `sessions` / `accounts` / `verifications` /
`two_factor`.

**Adding a domain.** A new project's own tables go alongside these, not inside
them. The pattern to copy is `admin-teams`: a table, a `*.repository.ts`, a
feature module (`.page` / `.service` / `.actions` / `.types` / `.mappers`), a
route, and a nav entry. If the thing being added belongs to a team, put the
`team_id` on its row and authorize through `requireTeamManagement` - that is what
makes it visible to the right managers and to nobody else.

The authoritative DDL is `src/lib/data/sql/database-schema.sql`. There is no
seed file, deliberately: nothing ships with credentials in it. Bootstrap the
first admin with `scripts/create-admin.mjs`.

## The three areas

| Route | Who | Scope |
| --- | --- | --- |
| `/admin` | admins | everything |
| `/manage` | managers | only the teams an admin assigned them |
| `/portal` | members | their own data |

The member portal carries **no id in its path**. An earlier design namespaced it
as `/client/[clientId]`, which then had to be re-checked against the session on
every request to stop one account reading another's. Keying off the session
alone removes that whole class of mistake: there is no id in the URL to tamper
with.

## Directory layout

- `src/app` - App Router. Route groups `(admin)`, `(manage)`, `(portal)`, `(public)`, plus `api/`, the root layout, `not-found`, `forbidden`, `manifest`.
- `src/features/<feature>` - feature modules (the bulk of the app).
- `src/lib` - cross-cutting infrastructure (auth, data, email, crypto, audit, brand, env).
- `src/components` - shared UI (`ui/` shadcn primitives, `form/`, `brand/`, tables and dialogs).
- `tests/e2e` - Playwright. Unit tests are co-located as `src/**/*.test.ts`.

## The layering (request flow)

Data flows down and never skips a layer:

1. **Route** (`src/app/.../page.tsx`) - a server component. Enforces auth and composes a feature page. Kept thin.
2. **Feature page** (`features/<x>/<x>.page.tsx`) - composition plus data fetching through a service.
3. **Service** (`features/<x>/<x>.service.ts`, marked `import "server-only"`) - business logic **and authorization**. Resolves the acting user from the session. Returns DTOs.
4. **Repository** (`src/lib/data/repositories/*.repository.ts`) - the only place that touches the database. Repositories never import from features.
5. **Database** - Postgres.

Mutations go through **Server Actions** (`features/<x>/<x>.actions.ts`), which
validate input with Zod and call a service.

### The two exceptions to that, both in AI chat

Both are Route Handlers, and both are exceptions because of the **shape of the
HTTP exchange**, never because the layering was inconvenient. Zod still
validates at the boundary and the service still owns authorization and every
write; only the response or request body differs.

| Route | Why it cannot be an action |
| --- | --- |
| `POST /api/ai-chat/stream` | The reply streams, and a server action returns a value. |
| `POST /api/ai-chat/attachments` | Actions are bounded by `serverActions.bodySizeLimit`, which is **global** and defaults to 1 MB. Raising it to clear a 4.5 MB document would weaken that limit for every action in the app. |

A route handler is not covered by the proxy matcher and has no area layout above
it, so its own session check is the outer gate and the service re-checks -
the same two-layer arrangement every guarded page uses.

`GET /api/ai-chat/attachments/[attachmentId]` is a route handler too, but it is
a read that returns bytes, so the mutations rule never applied to it.

## Authentication and authorization

Configured in `src/lib/auth/auth.ts`.

- Email/password with Postgres-backed sessions (5-day expiry). Secure cookies and rate limiting are gated on `MODE=production`.
- **Roles** are server-assigned (`input:false`), so a user cannot escalate its own privileges through the public update endpoint or at sign-up.
- **Two-factor**: TOTP or an emailed one-time code, with one backup code. Required for staff (admin and manager), optional for members. Note that Better Auth issues a session at sign-in only while 2FA is off; once enabled, sign-in returns a challenge instead.
- **Impersonation**: only admins hold the permission, and only admins are protected from being impersonated. Impersonating a manager grants an admin nothing they do not already have, and the act is recorded on the session row and in the audit log.
- Deactivated accounts are rejected at session creation, and their live sessions are deleted at the moment of deactivation.

### Team scoping - the security boundary

`src/lib/auth/session-auth-server.ts` is the single home for this:

| Guard | Answers |
| --- | --- |
| `requireUserRole([...])` | what role is the caller |
| `requireTeamScope()` | which teams may they READ |
| `requireManagementScope()` | which teams may they MANAGE |
| `requireTeamAccess(teamId)` | may they read THIS team |
| `requireTeamManagement(teamId)` | may they manage THIS team |

Four rules hold throughout:

1. **Scope comes from the session**, never from a URL, a form field or an action argument.
2. **Scope helpers return `string[]`.** Membership is many-to-many, so a single-id return would hand a user in two teams an arbitrary scope, silently, because Postgres row order is not stable.
3. **An empty scope means nothing, not everything.**
4. **A scope failure answers `notFound()`, not "forbidden".** Replying "forbidden" to a guessed id confirms the record exists, which turns the route into an enumeration oracle. A *role* failure may say so plainly, because the caller learns nothing new.

Guards live in the **service**, not only the action, so a page that calls a
service directly is still safe. The middleware (`src/proxy.ts`) enforces
area-level access as an outer gate, and each area layout re-checks the role;
neither is load-bearing on its own.

## Data-layer conventions

- **Repositories only.** All database access goes through a `*.repository.ts` using the shared Kysely client. Services call repositories; they never touch the database directly.
- **camelCase to snake_case.** Kysely's `CamelCasePlugin` maps DB columns to TS fields. Because that mapping is at runtime, a typo on either side is invisible to `tsc`.
- **Dates are strings.** Postgres `DATE` columns come back as `'YYYY-MM-DD'` (a pg type-parser override), not `Date`. This is deliberate: a `Date` is a UTC timestamp that day-shifts across timezones and is not a valid React child. Calendar dates stay strings end to end and compare lexicographically. `TIME` columns are `'HH:MM:SS'` strings. Timestamps stay `Date`.
- **The app timezone** is `NEXT_PUBLIC_APP_TIME_ZONE`, read once in `src/lib/timezone.ts`. Never use `new Date()` to decide what day it is.
- **`updated_at` has no database trigger**, so every update that spreads a patch sets it explicitly, and strips `id` first so a caller-supplied `id` cannot rewrite the primary key.
- **Field-level encryption** (`src/lib/crypto/field-encryption.ts`, key `FIELD_ENCRYPTION_KEY`) protects document signer names and signature images. The member read path swallows a decrypt failure; the staff path does not hide one.
- **Rich text is sanitized** server-side before rendering with `dangerouslySetInnerHTML`.
- **Error handling.** Repositories and services wrap with `handleError`; actions return a typed `ServerApiResponse` via `handleServerApiError`. Both call `unstable_rethrow` first so Next's `redirect()` and `notFound()` escape the catch.

## The public site is admin-editable

Page copy lives in `site_content`, not in code. The home page is assembled from
four JSON blocks (`landing_hero`, `landing_highlights`, `landing_features`,
`landing_cta`) edited from the admin area, so changing the headline needs no
deploy.

Two safeguards, because the value in the database is only as trustworthy as the
last thing written to it:

- Every block is **validated against a Zod schema on read**. A malformed block falls back to the shipped default rather than throwing, and the service reports which keys fell back so the editor can say so.
- Icons are stored as **names resolved through a closed allowlist**. Resolving an arbitrary string against the icon module would both pull the whole icon set into the bundle and let stored data choose which component renders.

Links in those blocks are constrained to same-site paths or `mailto:`/`tel:`, so
the home page cannot be turned into an open redirect.

## Security posture

- Security response headers on every route (HSTS, `X-Frame-Options: DENY`, a partial CSP, Referrer-Policy, Permissions-Policy) - see `next.config.ts`. A full `script-src` policy needs per-request nonces and is a known gap.
- Field-level encryption for sensitive data; secrets never leave the server (`env-server.ts` is `server-only`).
- Server-side authorization in every service.
- Append-only audit log with snapshotted actor details, so the trail survives a user being renamed or deleted.
- Input validated with Zod at the action boundary.
- The public enquiry form is rate-limited per IP by a database-backed ledger.

The single security reference is [`security.md`](security.md).
