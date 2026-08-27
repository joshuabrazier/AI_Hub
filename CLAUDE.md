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

- `pnpm dev` - dev server at <http://localhost:3100> (the port is set in the `dev`/`start` scripts and must match `NEXT_PUBLIC_APP_URL`)
- `pnpm build` / `pnpm start` - production build / serve
- `pnpm lint` - ESLint
- `pnpm test` - unit tests (Vitest, co-located as `src/**/*.test.ts`)
- `pnpm test:e2e` - Playwright. Refuses to run against a non-local database.
- Type-check: `pnpm exec tsc --noEmit`

Package manager is **pnpm 10**; Node 20. Run lint and tsc before treating a
change as done - CI enforces both, and it type-checks `tests/**` too, so a
broken spec breaks the build.

**Do NOT run `pnpm build` to check your work.** Verify with `pnpm exec tsc
--noEmit`, `pnpm lint` and `pnpm test` - between them they catch everything a
build would, in a fraction of the time. `next build` runs type checking and
linting itself, so chaining them in front of it pays for the same work twice,
and `output: "standalone"` then traces and COPIES most of an 800 MB
`node_modules` into `.next/standalone`. On Windows that is minutes, not
seconds. Build only when you are about to deploy and want it proven.

**On Windows, exclude the repo from Defender before doing anything else.**
Real-time scanning inspects every file in `node_modules` and `.next`
individually, which is why a one-package install can take minutes. In an
admin PowerShell, once: `Add-MpPreference -ExclusionPath "C:\Dev\AI_Hub"`.

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

**Transcription** is the other feature with its own data, and the only one
whose work outlives its request:

```text
transcriptions   one recording, owned by one user (+ its transcript,
                 speaker segments and model-written summary)
```

Same boundary as chat - per-person, `requireUser`, a `userId` predicate on
every query - mounted at `/{admin,manage,portal}/transcription`.

**Summaries** is the one AI feature with NO data of its own:

```text
(no table)   text in, a summary out, nothing kept
```

Paste text, choose detailed / summary / executive, read it stream back.
Mounted at `/{admin,manage,portal}/summaries`. `requireUser` is the whole
access model, because there is no stored object for one person to reach
another's copy of. Its model calls ARE recorded, under the `text_summary`
kind - a feature whose purpose is sending somebody's document to a model
belongs in the record of exactly that.

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
- **Sign-in is Microsoft (Entra) ONLY.** The forgot/reset/accept-invite/change-password surfaces are gone with it - Entra owns credentials. The operational consequence is real: an expired Entra client secret locks everyone out, admins included, and the fix is in Azure. Diarise it.
- **App-level 2FA exists again, behind `APP_TWO_FACTOR_ENABLED`, and it is a SECOND factor on top of whatever Entra's Conditional Access already asks for.** Off by default; `false` is a legitimate permanent answer. The gate is `isTwoFactorSatisfied` inside `requireUser`, so it covers every guarded surface at once, and state is per SESSION (`session_two_factor`) rather than per user. The proxy gates it too - not as a duplicate, but because the root layout paints the navbar and sidebar before an area layout has awaited its guard, so without an edge redirect the whole shell flashes up before bouncing. It reads `two_factor_enabled` FRESH rather than from the session, which snapshots it at sign-in and would send somebody who just enrolled straight back. Enrolment needs `allowPasswordless: true` on the plugin because an Entra account has no password to re-authenticate with - which also means **a local dev password account cannot enrol at all**, by design, and answers `INVALID_PASSWORD`. Turning the flag on with `session_two_factor` missing locks everybody at the enrolment screen; the flag is the way out.
- **The one exception is `DEV_PASSWORD_SIGN_IN`, and it is local-only by construction.** `emailAndPassword` is enabled when that flag is set AND `MODE` is not `production` (`isPasswordSignInEnabled`) - two conditions because an `.env` gets copied. It exists because with no `MICROSOFT_*` variables the sign-in page has no button on it and the app cannot be run at all. It opens a door and hands out no keys: no sign-up, no reset, accounts come from `scripts/create-dev-user.mjs`, and the domain allowlist / deactivated-account check / audit log all still apply. Never set it on a deployed environment.
- **The app AUTO-PROVISIONS.** Anyone in the tenant on `AUTH_ALLOWED_EMAIL_DOMAINS` gets an account as `member` on first sign-in. That allowlist is the entire access boundary - unset means *no restriction*. It is enforced in `databaseHooks.user.create.before`, the database layer, so it holds for every path.
- **An invitation is no longer a gate, it is a pre-assignment.** A pending invitation matching the address Entra verified sets the role and team the person lands with (`apply-invitation.ts`); without one they land as a member in no team.
- **`requireUser` redirects an incomplete profile to `/welcome`.** `users.profile_completed_at` is NULL until first-run setup is done. Anything that must work *during* setup uses `requireSessionUserAllowingSetup` instead, or it redirects to itself.
- **The email address is the Entra identity.** It is not editable anywhere - the domain allowlist only runs at creation, so an editable email would separate an account from the directory it is trusted because of.
- **Account linking is explicit and `requireLocalEmailVerified` stays on.** It is what lets a pre-existing password account keep working after passwords were disabled, and what stops an unverified account at somebody's address capturing their Entra identity.
- **The first admin is made with `scripts/promote-admin.mjs`, after they have signed in once.** New accounts are always members, so a fresh deployment has no admin and no in-app way to make one. Creating a user row by hand cannot work - it would have no linked Entra identity.
- **App-level 2FA is a gate on the SESSION, not part of sign-in, and it is off unless `APP_TWO_FACTOR_ENABLED`.** Better Auth's twoFactor plugin only challenges on `/sign-in/email|username|phone-number`; Microsoft sign-in never touches those, so an SSO sign-in lands with a valid session having shown one factor. The gate lives in `requireUser` and in `getVerifiedApiSession` (`session-auth-server.ts`), NOT in the proxy - the matcher covers only the three areas, so a gate there would leave `/api/ai-chat/stream` and `/api/transcription/[id]/media` ungated. **Every route handler must use `getVerifiedApiSession`, never `getSession`.** State is `session_two_factor`, keyed on the session and cascading with it. Which screen shows is decided by `two_factor.verified`, never `users.two_factor_enabled`, so a bad scan is recoverable. The attempt limiter is ours: the plugin's `beginAttempt` is a no-op once a session exists. It exists because Entra MFA needs a P1 licence per user - it protects this app's data, not the tenant, and should be turned OFF if Conditional Access is ever bought.
- **Only an admin can reset a second factor, and the reset MUST clear session verifications too.** `resetUserTwoFactorService` removes the secret, clears `users.two_factor_enabled`, then clears `session_two_factor` for that user - drop the third step and a stolen phone's still-signed-in session keeps access on the factor just revoked. Sessions are deliberately not deleted. There is no self-service reset (it would be a way around the factor), and the act is audited naming both parties. `two-factor.repository.ts` is the one place the app writes Better Auth's `two_factor` table, because `disableTwoFactor` only ever acts on the caller's own account.
- **House voice is a HOUSE voice, not a person's.** `src/lib/ai/house-voice.ts` conditions model output on our register and our banned phrases, and is appended as its own system block by AI chat and by transcription summaries. Do NOT extend it to imitate a named individual: PersonalBench measured every inference-time method (few-shot 0.508, extracted profile 0.502, contrastive 0.494) *below* the 0.626 cross-author floor - the output resembles the target less than a random different human does, because the model's own fingerprint dominates. Closing that needs training-time adaptation, which a pinned Bedrock model rules out. Three consequences baked into the file: examples are capped at 5 (2->10 gave negligible gains and every example is resent per request), prohibitions matter more than positive rules, and **an LLM judge will report success that is not there** - it rated the profile method best while authorship metrics showed no gain, so never evaluate this with a judge alone. The block goes last among the cached prefix blocks because it is the most-edited.
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
- **A document's `name` is restricted by Bedrock** to alphanumerics, single spaces, hyphens, parens and brackets - most real filenames need rewriting, and AWS flags the field as prompt-injection-prone. `sanitizeDocumentName` handles both. It used to assume chat had no tools; **it now has one**, so the assumption is replaced by the three properties in the next bullet rather than merely noted.
- **Chat has exactly ONE tool, and its three properties are what make an injected filename harmless: it only READS, its scope comes from the SESSION, and it returns FINISHED numbers.** `get_timesheet_figures` hands the model timesheet aggregates. No argument it can emit widens what the caller may see - a member asking about a colleague gets their own time, because `timesheet-chat-facts.service.ts` branches on role BEFORE the person argument is looked at, and discards it rather than validating it. Cost and margin are admin-only and absent (not null) otherwise. A tool that wrote, or that took a user id, would need that reasoning redone from scratch rather than extended.
- **AI chat is available to every signed-in user, so anything it can reach must be role-scoped at the point of access.** Chat guards on `requireUser`; timesheets guard on `requireUserRole([ADMIN])`. Wiring the two together without a check in between is a privilege escalation through a side channel. The admin path goes through `getOverviewService` - the SAME call the dashboard makes - so the chat cannot report a figure the screen would disagree with; the member path is a separate, narrower read scoped by `users.atlassian_account_id`, and an unlinked account is told so rather than shown zeroes.
- **A name the model supplies is resolved against the period's OWN list and dropped-and-named if it misses** (`resolveNamed`). Exact, then case-insensitive, then unique prefix; anything ambiguous is refused and both candidates named. This is the `admitOption` rule from the ask box, and it earns its keep: a live test had the model pass a client's NAME where the filter wanted its Jira KEY, and because the miss was reported in `scope.notes` the model said it could not break the figures down instead of presenting the organisation's margin as one client's.
- **The request log records tool traffic, both halves.** `ai_chat_request_logs` promises what was actually sent, and the serialiser extracts only the block types it knows - so `toolUse` and `toolResult` had to be added explicitly or the log would have shown a question and an answer with the figures between them invisible. The arguments are kept so a lookup of the wrong period is visible; the result is kept because that is the data itself.
- **With prompt caching on, `inputTokens` is only the UNCACHED remainder.** Total input is `inputTokens + cacheReadTokens + cacheWriteTokens`. Measured live: a cached turn reported `inputTokens: 3` for a request that actually sent 8,207. Use `totalInputTokens` off the DTO; reading `inputTokens` alone is how a working cache gets mistaken for a broken counter.
- **The chat cache point goes LAST in the request**, so the cached prefix is the whole conversation. Opus 4.6 needs 4,096 tokens minimum (below that it silently does not cache, which is fine) and has a **5-minute TTL with no 1-hour option** - that short TTL is why compaction exists alongside caching.
- **Anthropic's server-side compaction is not reachable over Bedrock Converse** - it is a Messages-API beta needing an `anthropic-beta` header, and Converse cannot send one. `compactIfNeeded` in the chat service is the client-side equivalent. Compaction only changes what is SENT; the original turns stay in the database and stay readable.
- **Never change `BETTER_AUTH_SECRET` on a live environment** - it invalidates sessions and breaks enrolled 2FA, which Better Auth encrypts under it. `NEXT_PUBLIC_APP_TITLE` is the TOTP issuer, so changing it relabels every enrolled authenticator.
- **Transcription is a state machine on a row, advanced by whoever looks at it.** `awaiting_media -> queued -> transcribing -> summarising -> completed | failed`. There is NO background worker: the page sweeps this user's unfinished rows on load, and the open one polls. That is why the thing displaying a job is the thing advancing it, and why a 6-hour timeout exists for one nobody comes back to.
- **The transcription media goes browser-to-blob on a write-only SAS, and that is the one place this app signs a URL.** `cw`, one blob, one hour, on a key derived from a row the caller already owns - the row is created BEFORE the URL is signed for exactly that reason. Nothing hands out a read URL; there is no playback path, and adding one would mint a bearer credential that outlives the session check behind it. Do not copy the pattern for small files - chat attachments are proxied on purpose.
- **A browser-direct upload needs CORS on the storage ACCOUNT, and a SAS whose protocol matches the endpoint.** Both fail silently in the browser with nothing in the server logs. CORS is set per account and `setProperties` replaces the whole rule set, so it is never done from app code - `pnpm dev:storage:cors` for the emulator (which refuses any other target), the Portal for real environments. The SAS protocol is derived from the connection string because pinning `https` is right for Azure and rejected by Azurite's plain-HTTP endpoint.
- **A meeting cannot be recorded twice, so a recording is never discarded until the SERVER confirms it.** Chunks go to IndexedDB as they arrive (`recording-store.ts`), keyed one record per chunk so a long meeting is a constant-size write rather than a growing rewrite; the first chunk carries the container header, so order is load-bearing. A failed upload, a crashed tab or a closed laptop leaves a panel offering upload / save a copy / delete. `discardRecording` is called on exactly two paths - a confirmed upload, and a deliberate delete - and adding a third is how somebody loses an hour of a client meeting.
- **A SAS grants a write, it does not cap one**, so the size limit is checked from storage after the upload lands and before a job is created. The app never sees the bytes go past.
- **Azure Speech reads the blob with its OWN managed identity, not a token from us.** It needs `Storage Blob Data Reader` on the storage account; without it every job fails with an access error. `contentUrl` is deliberately a plain URL with nothing on it.
- **A recording is KEPT for the retention window and can be downloaded** - speech recognition makes mistakes, so being able to hear what was said is worth pennies a month of blob storage. It is streamed back through `/api/transcription/[id]/media`, NEVER as a signed URL: the upload SAS is write-only and scoped to one not-yet-existing blob, whereas a read URL would be a bearer token for a private meeting that outlives the session behind it. Same cascade problem as chat attachments, same three answers: blob-first deletes, a retention pass, and a reconciliation sweep (`transcriptionOrphanedMediaPurged`).
- **Summarising STREAMS, and a page render never triggers it.** A non-streaming `ConverseCommand` sends nothing until the model finishes, and `READ_TIMEOUT_MS` in `bedrock-client.ts` abandons a stream idle for 120s - so every summary of a real meeting timed out, five times over, because `maxAttempts: 5` retried it. `ConverseStreamCommand` keeps the socket busy. Separately, `advanceTranscription` takes `allowSummarise`: false from the page-load sweep (a server component that waits on a model call renders a blank tab, and a killed request leaves the row to retry forever), true from the poll. A row stuck in `summarising` past `SUMMARY_GIVE_UP_MINUTES` is completed without one.
- **`completed` means the TRANSCRIPT is stored, not the summary.** Summarising is a second model call and is allowed to fail: a completed row with `summary` NULL and `error` set is that case, and the screen offers to try again. A failed summary must never cost somebody their transcript.
- **Azure Speech REFUSES the MP4 family, so the browser converts it before upload.** Documented formats are WAV, MP3, OPUS/OGG, FLAC, WMA, AAC, AMR, WebM, SPEEX. An `.m4a` - a phone voice memo, and the commonest upload there is - is AAC in an MP4 container and comes back `InvalidData: The recordings URI contains invalid data` (note: `InvalidData` is a decode failure, `InvalidUri` is a download failure - the latter means storage is unreachable, usually Azurite). `audio-convert.ts` decodes it with Web Audio and re-encodes 16 kHz mono WAV in the browser, because ffmpeg is not on the App Service Node runtime and this also sends ~a tenth of the bytes. **Conversion never gates the upload**: anything it cannot decode is uploaded untouched for the service to judge. It re-checks `MAX_MEDIA_BYTES` afterwards, since WAV is uncompressed and can come out bigger. `replaceExtension` is load-bearing - the server derives the stored media type from the filename, so a WAV still called `.m4a` would be handed back to Azure as the thing it just refused. `RECORDING_FORMAT_CANDIDATES` stays ordered documented-first.
- **`Permissions-Policy` in `next.config.ts` gates the recorder.** It reads `microphone=(self)`, and `(self)` is load-bearing in both directions: tightening it to `()` makes the browser refuse `getUserMedia` with no prompt and nothing in the UI to explain why, and removing the directive entirely would let embedded third-party frames use the microphone. Camera and geolocation stay `()`. Changing `next.config.ts` needs a dev-server restart - it does not hot-reload.
- **Summaries store NOTHING, and that is a decision rather than a gap.** The input is whatever somebody pasted - a contract, a medical letter - so keeping a copy of it plus the model's reading of it would make it the most sensitive table in the app for no benefit anybody asked for. The page says so, because a refresh loses the summary. The one place it does persist is `ai_chat_request_logs`, on that log's own shorter retention window, and the screen says admins can review it.
- **The three summary styles are three different PROMPTS, not one prompt with a length.** "The same but shorter" gets a truncated answer that stops mid-thought; asking a different question gets a different answer. Each has its own `SUMMARY_MAX_TOKENS`, ordered detailed > summary > executive, and a test asserts that ordering - an executive summary allowed to run as long as a detailed one has missed the point of being asked for.
- **Pasted text is fenced in `<source_text>` and named as material, never instructions.** It was written by somebody else and can contain anything aimed at the model. The fence lowers the chance; the system prompt saying so and `ModelMarkdown` emitting React elements limit the damage. All three are needed - none is sufficient.
- **Model output renders through `ModelMarkdown`** (`src/components/model-markdown.tsx`), shared by chat replies and meeting summaries. Its three controls - no `rehype-raw`, a `safeUrl` protocol allowlist, images as links - are asserted against rendered output in `model-markdown.test.ts`. A transcript is untrusted text like a chat message and renders as text nodes.
- **`FIELD_ENCRYPTION_KEY` has no callers in the base** (`src/lib/crypto/field-encryption.ts` is kept as domain-neutral, tested infrastructure - its only user was signable documents, removed). It is unrelated to 2FA. The moment a project encrypts its first value with it, it becomes permanent: rotating it makes that value unreadable.

## Writing style

No em dashes or en dashes anywhere - use hyphens only. Applies to code comments,
docs, commit messages, and UI copy.

## Where things are

- `src/app` - routes: `(admin)` / `(manage)` / `(portal)` / `(public)`.
- `src/features/<x>` - feature modules (page / service / actions / types / components).
- `src/lib` - `auth`, `data` (Kysely client + types + repositories + `sql/`), `ai` (the pinned Bedrock client), `speech` (Azure batch transcription), `storage` (blob), `email`, `crypto`, `audit`, `brand`, `env`.
- `src/components` - `ui/` (shadcn), `form/`, `brand/`, shared tables and dialogs.
- Unit tests are co-located (`src/**/*.test.ts`); Playwright lives in `tests/e2e`.
- Schema: `src/lib/data/sql/database-schema.sql` (no migration runner; applied manually). No seed file - the first admin signs in with Microsoft, then is promoted with `scripts/promote-admin.mjs`.

## Deploy

`.github/workflows/deploy.yml` is an **unconfigured template**: manual-only, and
it fails fast unless `AZURE_WEBAPP_NAME` is set. Configure it deliberately per
project. See `docs/deployment.md`.
