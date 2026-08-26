# CLAUDE.md

Condensed guidance for AI agents and contributors working in this repo. Full
detail is in `docs/`.

## What this is

A **reusable portal base**: Next.js 16 (App Router) with authentication,
role-based access and teams already built. Projects are started
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

- `pnpm dev` - dev server at <http://localhost:3000> (the port is set in the `dev`/`start` scripts and must match `NEXT_PUBLIC_APP_URL`)
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

Everything else is cross-cutting and domain-neutral: invitations, site
content, enquiry categories, the audit log and the retention job.

**AI chat** is the one feature with its own data:

```text
ai_chat_subjects     one conversation, owned by one user (+ its compaction summary)
ai_chat_messages     its turns, in order (+ per-turn token and cache usage)
ai_chat_attachments  files sent with a turn - metadata + a blob pointer
```

It is **per-person, not team-scoped** - a conversation is private from other
users, so the guard is `requireUser` and the boundary is the `userId` predicate
on every query. Mounted in all three areas at `/{admin,manage,portal}/ai-chat`,
all rendering one feature page.

`ai_chat_request_logs` is the deliberate exception: it records **what was
actually sent to the model** on every call, and **admins can read it in full**
at `/admin/ai-chat-log`. So chat is confidential from peers, not from the
organisation - and the chat page says exactly that. Three things hold it
together and none is optional: the service guards on `ADMIN`, opening a payload
writes an `ai_chat.request_viewed` audit entry naming both parties, and the log
has its own shorter retention window. The log records that a file was **sent**
(name, kind, size) and never its **content** - there is no admin path to an
uploaded file, and adding one is a decision about the promise on the chat page.

## Architecture (follow the layering)

Route `page.tsx` (auth guard) -> feature `.page.tsx` (compose) -> `.service.ts`
(server-only: logic + authorization) -> `*.repository.ts` (Kysely, the only DB
access) -> Postgres. Mutations go through `.actions.ts` (`"use server"`), which
validate with Zod and call a service. DTOs and schemas live in `.types.ts`.
Repositories must never import from features. See `docs/architecture.md`.

**Two documented exceptions, both in AI chat, both Route Handlers rather than
actions:**

- `src/app/api/ai-chat/stream/route.ts` - the send, because a server action
  cannot return a stream.
- `src/app/api/ai-chat/attachments/route.ts` - the upload, because actions are
  bounded by `serverActions.bodySizeLimit`, which is global and defaults to
  1 MB. Raising it to clear a 4.5 MB document would weaken that limit for every
  action in the app.

Everything else holds for both - Zod still validates at the boundary, and the
service still owns authorization and every write. A route handler is NOT covered
by the proxy matcher and has no area layout above it, so its own session check
is the outer gate; the service re-checks. Do not copy the pattern for anything
that does not genuinely need to stream or to carry megabytes.

(`GET /api/ai-chat/attachments/[id]` is also a route handler, but it is a read
serving bytes, so the actions rule never applied to it.)

## Conventions that bite if ignored

- **Team membership is the security boundary, and it is many-to-many.** Any helper answering "which teams is this user in" returns `string[]`. Never `executeTakeFirst` into a single id: row order is not stable, so a user in two teams would silently get an arbitrary scope.
- **Guards belong in the service, not only the action.** A page that calls a service directly must still be safe. Use `requireUserRole`, `requireTeamScope`, `requireManagementScope`, `requireTeamAccess`, `requireTeamManagement` from `src/lib/auth/session-auth-server.ts`.
- **Resolve the actor from the session, never from the URL.** No route parameter is proof of access.
- **An empty scope means nothing, not everything.** A manager with no teams sees no rows.
- **A scope failure answers `notFound()`, not "forbidden".** Saying "forbidden" to a guessed id confirms the record exists and turns the route into an enumeration oracle. A *role* failure may say so plainly.
- **Calendar dates are `'YYYY-MM-DD'` strings, not `Date`.** The pg type parser in `src/lib/data/kysely-database-client.ts` maps Postgres `DATE` to a string on purpose (timezone-safe, React-renderable), and `TIME` to `'HH:MM:SS'`. No table currently has a `DATE` column, but the parser stays so the first one a project adds is safe by default. Type such columns as `string` and compare lexicographically.
- **The app timezone is `NEXT_PUBLIC_APP_TIME_ZONE`**, read once in `src/lib/timezone.ts` as `APP_TIME_ZONE`. Never hardcode a zone, and never use `new Date()` to decide what calendar day it is - derive it in the app zone (`formatDateTime` in `src/lib/format.ts` is the pattern).
- **Roles are server-assigned.** `role` / `isActive` are `input:false` in Better Auth - never accept them from the client.
- **Sign-in is Microsoft (Entra) ONLY.** The forgot/reset/accept-invite/change-password/2FA surfaces are gone with it - Entra owns credentials and MFA. The operational consequence is real: an expired Entra client secret locks everyone out, admins included, and the fix is in Azure. Diarise it. Because Entra owns MFA and the enrolment screens are gone, the proxy has **no 2FA gate** - one could only redirect staff to a `/setup-2fa` page that does not exist.
- **The one exception is `DEV_PASSWORD_SIGN_IN`, and it is local-only by construction.** `emailAndPassword` is enabled when that flag is set AND `MODE` is not `production` (`isPasswordSignInEnabled`) - two conditions because an `.env` gets copied. It exists because with no `MICROSOFT_*` variables the sign-in page has no button on it and the app cannot be run at all. It opens a door and hands out no keys: no sign-up, no reset, accounts come from `scripts/create-dev-user.mjs`, and the domain allowlist / deactivated-account check / audit log all still apply. Never set it on a deployed environment.
- **The app AUTO-PROVISIONS.** Anyone in the tenant on `AUTH_ALLOWED_EMAIL_DOMAINS` gets an account as `member` on first sign-in. That allowlist is the entire access boundary - unset means *no restriction*. It is enforced in `databaseHooks.user.create.before`, the database layer, so it holds for every path.
- **An invitation is no longer a gate, it is a pre-assignment.** A pending invitation matching the address Entra verified sets the role and team the person lands with (`apply-invitation.ts`); without one they land as a member in no team.
- **`requireUser` redirects an incomplete profile to `/welcome`.** `users.profile_completed_at` is NULL until first-run setup is done. Anything that must work *during* setup uses `requireSessionUserAllowingSetup` instead, or it redirects to itself.
- **The email address is the Entra identity.** It is not editable anywhere - the domain allowlist only runs at creation, so an editable email would separate an account from the directory it is trusted because of.
- **Account linking is explicit and `requireLocalEmailVerified` stays on.** It is what lets a pre-existing password account keep working after passwords were disabled, and what stops an unverified account at somebody's address capturing their Entra identity.
- **The first admin is made with `scripts/promote-admin.mjs`, after they have signed in once.** New accounts are always members, so a fresh deployment has no admin and no in-app way to make one. Creating a user row by hand cannot work - it would have no linked Entra identity.
- **Sanitize rich text** server-side (`src/lib/sanitize-rich-text.ts`) before `dangerouslySetInnerHTML`.
- **Admin-editable JSON is validated on read.** Home page blocks fall back to defaults if malformed rather than throwing, and report which keys fell back.
- **Icons from the database resolve through an allowlist** (`LANDING_ICONS`), never a dynamic module lookup.
- **`updated_at` has no trigger.** Any update that spreads a patch must set `updatedAt` itself, and must strip `id` before spreading or a caller-supplied `id` rewrites the primary key.
- **Errors:** services/repositories use `handleError`; actions return `ServerApiResponse` via `handleServerApiError`. Both call `unstable_rethrow` so Next's `redirect()`/`notFound()` escape the catch - do not wrap them in a plain try/catch.
- **`src/lib/tanstack-table.d.ts` has no importers but is load-bearing** - it declares `ColumnMeta.label`, used by the mobile table layout. Do not delete it as dead code.
- **`data-table.tsx` carries `"use no memo"`** deliberately; removing it makes the table serve stale rows.
- **Rendering a timesheet page never calls the model.** `getTimesheetSummaryService` only reads the cache; `generateTimesheetSummaryService` is the only path that spends, and it short-circuits on a matching fingerprint. Staleness is decided by `data_fingerprint` (a hash of the FIGURES), not by age, so a Jira sync that moves the numbers invalidates the prose describing them. The fingerprint deliberately excludes `periodLabel` - hashing presentation would let a copy change invalidate every cached row at one Opus call each to restore.
- **`converseText` in `src/lib/ai/converse.ts` is the only non-chat path to Bedrock, and it writes an `ai_chat_request_logs` row on every call, success or failure.** That table is a promise - it records what was actually sent, and admins read it in full - so a second path that skipped it would quietly turn the promise into "every call except the ones added later". Its `kind` is what tells those rows apart in the viewer. It sets no cache point on purpose: these are one-shot calls, and the minimum cacheable prefix is larger than most of them.
- **No model near the timesheet figures may compute one.** Period summaries and saved reports were removed as restating what the tiles already said, but the rule they were built around governs whatever replaces them: a model asked to derive utilisation will sometimes divide by five days for somebody contracted to three, and a plausible wrong number in prose beside the right one in a tile discredits both. The arithmetic is finished before the model sees anything. The ask box holds the same line - it returns FILTERS and the engine computes what they select. `timesheet_summary` and `timesheet_report` survive as `ai_chat_request_logs` kinds only: nothing writes them, but rows already carry them and a Postgres enum value cannot be dropped.
- **Job and project names reaching a prompt are untrusted input**, on the same footing as the attachment filenames `sanitizeDocumentName` handles - staff type them in Jira. They travel inside `BEGIN FACTS`/`END FACTS` markers, the system prompt says content there is data and never instruction, and any reply is rendered through `AiChatMarkdown` (React elements, no `dangerouslySetInnerHTML`). Nothing the model returns is ever allowed to drive control flow.
- **The natural-language view box returns FILTERS, never SQL and never a URL.** The model picks from a CLOSED VOCABULARY the prompt hands it (the period's own category / project / person options, id as the value), `admitOption` checks every returned value against that exact set, and the SERVICE builds the path. Repositories stay the only DB access and the ordinary typed query runs unchanged, so the widest thing the feature can do is show an admin a page the filter controls could already reach. A model-supplied URL would be an open redirect; `admin-timesheets-query.prompt.test.ts` asserts the schema has no field one could arrive in.
- **The dangerous failure there is a wrong answer that LOOKS right, not injection.** Kysely parameterises everything, so an invented person id was never injectable - it just renders an empty dashboard, which reads as "nobody logged time" rather than "I misunderstood you". Hence: unoffered values are dropped and named rather than passed through, `admitStart` rejects 2026-02-31 (which JS would roll into March), matching is EXACT so a near miss is a miss, and the model's one-sentence `interpretation` is always shown so a misreading is visible. `admitOption`/`admitStart` are exported and tested directly - the live model refuses injections politely, but that is a property of a model version, not a guarantee.
- **AI chat pins its region and model in code** (`src/lib/ai/bedrock-client.ts`). The Bedrock key is locked to Australia and scoped to one model; the `au.` prefix is a cross-region inference profile that routes only within AU, and `global.`/`us.` are denied by the key's IAM policy. Never make either configurable, and never "fix" throttling by switching prefix. The model id takes no date stamp and no `:0`.
- **Chat content never becomes an HTML string.** Both halves are untrusted - the user's because they typed it, the model's because a model repeats back what it was given. The user's turn renders as a text node; the model's goes through `AiChatMarkdown`, which parses to an AST and emits **React elements**, so no markup is ever produced and text still lands in the DOM escaped. There is no `dangerouslySetInnerHTML` in this feature and adding one would undo the whole argument. Filenames are untrusted too, and get the same treatment.
- **Three things keep that markdown safe, and `ai-chat-markdown.test.ts` asserts all of them against rendered output:** no `rehype-raw` (raw HTML in a reply stays literal text), an explicit protocol allowlist via `safeUrl` (`javascript:` / `data:` links render as plain text), and images shown as links rather than fetched - a reply cannot contain a real picture, so an image URL is either invented or reflected user input, and fetching it would leak the reader's IP and let a URL path exfiltrate conversation text. If a change seems to need `rehype-raw`, it does not.
- **An attachment's type comes from its BYTES, never its name or its `Content-Type`.** `src/lib/ai/attachment-formats.ts` sniffs the header, and for images the same pass that proves the format also reads the dimensions. The allowlist is the Converse contract - 4 image formats, 9 document formats - and a unit test asserts it against the AWS SDK enums so drift fails the build rather than a send.
- **Attachment BYTES live in Azure Blob, not Postgres** (`src/lib/storage/attachment-storage.ts`); the row holds metadata and a `storage_key`. Steady state is ~a file per user per day against a 365-day window, and Azure Postgres storage cannot be shrunk once grown - plus serving a 4.5 MB file out of BYTEA held a DB connection for the whole transfer.
- **A Postgres cascade CANNOT delete a blob, and that is the sharp edge of the above.** Every path that removes attachment rows clears the files FIRST - deleting a conversation, the retention sweep, removing a staged file - and the monthly job runs a reconciliation pass for what a cascade removed behind its back (de-identifying a user is the big one: it reaches attachment rows without any chat code running). If `aiChatOrphanedBlobsPurged` is steadily non-zero, a delete path is missing its blob cleanup.
- **Attachments are streamed through the download route, never handed out as SAS URLs.** A signed URL is a bearer token that outlives the session check that produced it; proxying costs bandwidth and keeps "a live session that owns it" the only way to read a file.
- **Uploaded files are served back with `nosniff`, a server-derived type, and `attachment` disposition for everything except images.** `html` deliberately maps to `text/plain`. Serving user-uploaded markup as `text/html` from this origin is stored XSS; all of that is load-bearing, not belt-and-braces.
- **Bedrock's attachment caps are per REQUEST, and every send replays the whole thread** - so 20 images / 5 documents / the payload cap are really limits on the *conversation*. `selectAttachments` admits newest-first and lets the oldest fall out, replacing an evicted file with a note so the model can say it can no longer see it. Do not "fix" that by capping per message; the newest file is the one being asked about.
- **A document's `name` is restricted by Bedrock** to alphanumerics, single spaces, hyphens, parens and brackets - most real filenames need rewriting, and AWS flags the field as prompt-injection-prone. `sanitizeDocumentName` handles both. Its reasoning assumes chat has no tools and no sharing; revisit it if that changes.
- **With prompt caching on, `inputTokens` is only the UNCACHED remainder.** Total input is `inputTokens + cacheReadTokens + cacheWriteTokens`. Measured live: a cached turn reported `inputTokens: 3` for a request that actually sent 8,207. Use `totalInputTokens` off the DTO; reading `inputTokens` alone is how a working cache gets mistaken for a broken counter.
- **The chat cache point goes LAST in the request**, so the cached prefix is the whole conversation. Opus 4.6 needs 4,096 tokens minimum (below that it silently does not cache, which is fine) and has a **5-minute TTL with no 1-hour option** - that short TTL is why compaction exists alongside caching.
- **Anthropic's server-side compaction is not reachable over Bedrock Converse** - it is a Messages-API beta needing an `anthropic-beta` header, and Converse cannot send one. `compactIfNeeded` in the chat service is the client-side equivalent. Compaction only changes what is SENT; the original turns stay in the database and stay readable.
- **Never change `BETTER_AUTH_SECRET` on a live environment** - it invalidates sessions and breaks enrolled 2FA, which Better Auth encrypts under it. `NEXT_PUBLIC_APP_TITLE` is the TOTP issuer, so changing it relabels every enrolled authenticator.
- **`FIELD_ENCRYPTION_KEY` has no callers in the base** (`src/lib/crypto/field-encryption.ts` is kept as domain-neutral, tested infrastructure - its only user was signable documents, removed). It is unrelated to 2FA. The moment a project encrypts its first value with it, it becomes permanent: rotating it makes that value unreadable.

## Writing style

No em dashes or en dashes anywhere - use hyphens only. Applies to code comments,
docs, commit messages, and UI copy.

## Where things are

- `src/app` - routes: `(admin)` / `(manage)` / `(portal)` / `(public)`.
- `src/features/<x>` - feature modules (page / service / actions / types / components).
- `src/lib` - `auth`, `data` (Kysely client + types + repositories + `sql/`), `ai` (the pinned Bedrock client), `email`, `crypto`, `audit`, `brand`, `env`.
- `src/components` - `ui/` (shadcn), `form/`, `brand/`, shared tables and dialogs.
- Unit tests are co-located (`src/**/*.test.ts`); Playwright lives in `tests/e2e`.
- Schema: `src/lib/data/sql/database-schema.sql` (no migration runner; applied manually). No seed file - the first admin signs in with Microsoft, then is promoted with `scripts/promote-admin.mjs`.

## Deploy

`.github/workflows/deploy.yml` is an **unconfigured template**: manual-only, and
it fails fast unless `AZURE_WEBAPP_NAME` is set. Configure it deliberately per
project. See `docs/deployment.md`.
