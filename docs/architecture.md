# Architecture

This is a **reusable portal base**, not a finished product. It ships the parts
every internal portal needs - Microsoft (Entra) sign-in, role-based access,
teams, an audit trail and a data-retention job - so a new project starts from
a working, secured
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
| Auth | Better Auth (Microsoft Entra SSO, impersonation) |
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
`site_content`, `enquiry_categories` / `enquiry_submissions`, `audit_logs`, the
`ai_chat_*` tables, `transcriptions`, plus Better Auth's `sessions` /
`accounts` / `verifications`.

**Adding a domain.** A new project's own tables go alongside these, not inside
them. The pattern to copy is `admin-teams`: a table, a `*.repository.ts`, a
feature module (`.page` / `.service` / `.actions` / `.types` / `.mappers`), a
route, and a nav entry. If the thing being added belongs to a team, put the
`team_id` on its row and authorize through `requireTeamManagement` - that is what
makes it visible to the right managers and to nobody else.

The authoritative DDL is `src/lib/data/sql/database-schema.sql`. There is no
seed file, deliberately: nothing ships with credentials in it. Bootstrap the
first admin with `scripts/promote-admin.mjs`, after they have signed in once.

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

### Work that outlives its request - transcription

Transcription is the one feature whose work does not finish inside the request
that started it. Transcribing an hour of audio takes minutes, so `transcriptions`
is a **state machine on a row**, and nothing waits:

```text
awaiting_media -> queued -> transcribing -> summarising -> completed
                                                        \-> failed
```

Four steps, and the middle one does not touch this app at all:

1. `createTranscriptionService` writes the row and signs a **write-only, single-blob**
   upload URL. The row exists first, so the blob key is derived from an id the
   server generated against a row this user owns - the browser never names its
   own destination in a shared container.
2. **The browser PUTs the media straight to Azure Blob.** A meeting recording is
   hundreds of megabytes; proxying it would tie up an instance for the length of
   the transfer.
3. `startTranscriptionService` asks storage whether the file actually landed -
   the app never saw it go past - checks the size, and creates the Speech job.
4. `advanceTranscription` moves the row along. It runs from **two places, both
   of which are just somebody looking at the screen**: the page sweeps this
   user's unfinished rows when it loads, and the open transcription polls while
   it is still running.

There is deliberately **no background worker**. The thing that advances a job is
the thing that displays it, so there is no queue to be down while the page
cheerfully reports progress - and the monthly job's only role here is retention.
The cost is that a job nobody ever looks at again stays unfinished until the
6-hour timeout marks it failed, which is the right trade for a feature where
somebody is always waiting for the answer.

Note also that all of this is **server actions**, including the one that hands
out the upload URL. Neither exception above applies: nothing streams, and the
media never passes through the app, so nothing here is near the body limit.

### A third way in - importing from Teams

A `teams` row is the one exception to all of the above: it does not move
through the state machine at all, because it arrives with the transcript
already in hand. Teams recorded and transcribed the meeting itself, and
`importTeamsMeetingService` fetches the result through Microsoft Graph.

Why it is worth having: Teams transcribes **each participant's own microphone
against their signed-in identity**, so the transcript comes back with real
names on it. Azure Speech can tell voices apart and calls them "Speaker 0".
For a meeting the organisation hosts, that is a better transcript than
anything a single microphone in a room can produce - which is why
`TranscriptionSegment` carries both `speaker` (a number) and `speakerName` (a
name), and `speakerLabel` prefers the name.

Two things it cannot do, and the screen says both rather than letting somebody
discover them by failing:

- **It cannot make a meeting have a transcript.** Transcription has to have
  been started while the meeting was running. There is no retrospective fix.
- **It cannot reach a meeting another organisation hosted.** Their tenant holds
  that transcript. The recorder is still the answer for those, which is why it
  stays.

The lookup is a chain, and Graph offers no shortcut: calendar events -> the
event's `joinUrl` -> the `onlineMeeting` -> its transcripts -> the content, as
WebVTT. Four calls to import one meeting, so the list is fetched once and the
content only for the meeting somebody picks. **Every call is delegated** - made
as the signed-in person - so Graph enforces that they were in the meeting.
Nothing in this app decides who may read a transcript.

Three consequences worth knowing before changing any of it:

- **The row lands in `summarising`, not `completed`.** Its transcript is
  already stored, and the existing sweep writes the summary. So the import is a
  server action rather than a route handler - it stops as soon as the transcript
  is in - and it gets the poll, the push notification, the retry and the
  background sweep for free.
- **It has no media at all.** `storage_key` and `media_type` are NULL, which is
  why migration 014 makes them nullable rather than inventing a key that points
  at nothing. There is no recording to download, and the detail screen does not
  offer one.
- **Importing is idempotent.** `source_ref` holds the event id and the Graph
  transcript id joined together, unique per person, so a second click opens the
  copy that exists rather than paying for a second summary. Both ids are needed:
  the event id is what the meetings list has in hand, and the transcript id is
  what tells two transcripts of the same meeting apart.

The parser is `src/lib/graph/teams-transcript.ts`, deliberately pure and
exported so it can be tested without a tenant, a meeting or a live token -
which every other part of this needs all three of.

## Authentication and authorization

Configured in `src/lib/auth/auth.ts`.

- **Microsoft (Entra) sign-in only.** `emailAndPassword` is disabled; there is no password, reset or app-level 2FA path, because Entra owns credentials and MFA. An expired Entra client secret therefore locks everyone out, admins included - see `deployment.md`.
- **Auto-provisioning.** Anyone in the tenant on `AUTH_ALLOWED_EMAIL_DOMAINS` gets an account as `member` on first sign-in. That allowlist is the entire access boundary, enforced in `databaseHooks.user.create.before` so it holds for every path; **unset means no restriction**.
- **Invitations pre-assign, they do not gate.** A pending invitation matching the address Entra verified sets the role and team the person lands with.
- **First-run setup.** `users.profile_completed_at` is NULL until done, and `requireUser` redirects to `/welcome` until it is set. Use `requireSessionUserAllowingSetup` for anything that must work during setup.
- **Roles** are server-assigned (`input:false`), so a user cannot escalate its own privileges through the public update endpoint.
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
- **Field-level encryption** (`src/lib/crypto/field-encryption.ts`, key `FIELD_ENCRYPTION_KEY`) is available for any field a project needs encrypted at the application layer, on top of the database's own encryption at rest. It has no callers in the base itself - its only user was the signable-documents feature, removed from this repo - and is kept because it is domain-neutral, tested, and the first thing a project storing anything sensitive will reach for. It is unrelated to 2FA, which Better Auth encrypts under `BETTER_AUTH_SECRET`.
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
