# SharePoint integration

Status: SPEC, nothing built. This file is the contract for the work. Read it
before writing any of it, and update it when a decision here turns out to be
wrong.

## What we are trying to do

Company SharePoint is disorganised. We want the portal to be able to look at a
document library, work out what a sensible structure would be, propose one, and
then - only after a person approves it - create the folders and move the files.

## Feasibility, up front

It is all Microsoft Graph against the Entra app registration this app ALREADY
uses for sign-in. There is no separate SharePoint API to learn and no new
identity provider. Four endpoints carry the whole feature:

```text
GET   /sites?search=                                 find sites
GET   /sites/{siteId}/drives                         find libraries
GET   /drives/{driveId}/root/delta                   enumerate, then detect changes
POST  /drives/{driveId}/items/{parentId}/children    create a folder
PATCH /drives/{driveId}/items/{itemId}               move (new parentReference)
```

The API is the easy part. Everything hard about this feature is permissions,
residency, and not destroying anything.

## Identity: UNDECIDED, and it must be decided before code

Two options. They have very different security properties and the choice
changes the shape of the whole feature, so it is not an implementation detail
to be settled while typing.

### Option A - delegated, on behalf of the signed-in user

Add Graph scopes to the existing Better Auth Microsoft provider, keep the
refresh token on the account row, exchange it for a Graph access token per
call.

- **SharePoint enforces access, not our code.** A user cannot use the portal to
  reach a library they could not already open themselves. This is the single
  largest security win available here and it costs nothing to build.
- It matches what this app already promises everywhere else: the session is the
  identity, and the actor is resolved from the session and never from the URL.
- **No background work.** Nothing can happen unless somebody is signed in and
  looking. Transcription already lives with this constraint, so it is familiar,
  but a crawl of a large library will not fit inside one request.
- Access tokens last about an hour and refresh tokens lapse, so token refresh
  and re-consent are real code, not a footnote.
- The `.All` scopes still need tenant admin consent even though the reach is
  bounded by the user.

### Option B - app-only, `Sites.Selected`

One application permission on the Entra app, then a per-site grant through
`/sites/{siteId}/permissions`, so the app can only reach nominated libraries.

- Enables scheduled crawls and jobs that outlive a request.
- **Our service layer becomes the only access control.** Every read and write
  has to re-derive who is asking and whether they may. That is a much larger
  surface to get right than Option A, where the answer is enforced upstream.
- **Site-level write cuts straight through item-level unique permissions.** A
  restricted HR folder inside an otherwise shared site is visible to an app
  with write on that site. This is the thing most likely to cause a real
  incident.
- The Graph SEARCH API does not honour `Sites.Selected` reliably and returns
  sites outside the grant. Never treat this permission as a confidentiality
  boundary for search.

### The recommendation

**Start with Option A only.** Add `Sites.Selected` later, for one specific job
that provably cannot run inside a request, and gate it behind an approval row
that names a human. Do not reach for app-only because it is more convenient to
build. A reorganise that runs as the person who approved it is also the better
audit story.

## Two things to settle outside the codebase

Neither is a code task and both can invalidate the feature, so do them first.

1. **Tenant data location.** The Bedrock pin keeps inference in Australia, but
   the flow becomes SharePoint to App Service to Bedrock. Confirm the App
   Service region is Australian (Speech is already `australiaeast`) and confirm
   the tenant data location in the M365 admin centre under organisation
   profile.
2. **Purview and DLP.** Sending document content to an AI service is exactly
   what a DLP policy exists to catch, and arguably should catch. Separately, a
   file carrying an ENCRYPTION sensitivity label comes back as bytes we cannot
   read, so it cannot be classified at all. Find out the position before
   building, not after.

## The phases

Each phase is useful on its own and shippable on its own. Do not start a later
one before the one before it is in main.

### Phase 1 - crawl and inventory. NO WRITES.

Walk `delta` on each nominated drive and store what is there in our own
Postgres tables.

**This is the load-bearing architectural decision.** All analysis runs against
our database, never against Graph. We crawl once and then iterate on the
analysis for free, with no throttling, no rate limits and no risk of touching
anything. A design that queried Graph during analysis would be throttled, slow,
and impossible to test.

- `$select` only the fields we use. Every extra field is bytes across the wire
  on tens of thousands of items.
- Persist the `@odata.deltaLink` on the drive row. A re-crawl then costs one
  call plus the changes, and re-crawling from scratch becomes a deliberate act
  rather than the default.
- **Honour `Retry-After` and pause EVERYTHING when throttled, not just the
  request that got the 429.** SharePoint throttles per application per tenant,
  so continuing on other threads is what turns a throttle into a block. The
  Jira client in `src/lib/timesheet/jira-client.ts` already has the retry shape
  to copy.
- Heavy crawls run off-peak in `APP_TIME_ZONE`.
- A crawl must be resumable. It will be interrupted.

### Phase 2 - the deterministic mess report. Still no writes.

Compute all of this in CODE. None of it needs a model, and all of it is most of
what "messy" actually means:

- duplicates by hash, and near-duplicates by name (`Report v2 final FINAL.docx`)
- files sitting at the library root
- empty folders, and folders holding one item
- files not modified in three years
- path depth and total path length outliers
- name collisions across folders

**Ship this alone and stop for a week.** It may well be enough, and it tells us
what the real shape of the problem is before we spend a cent on inference.

### Phase 3 - model-proposed taxonomy

Now the model earns its place, on the one thing it is better at than code:
reading names and paths and proposing a structure, then placing the ambiguous
remainder into it.

- **Metadata first.** Names, paths, extensions, authors and dates for
  everything. Extract file CONTENT only for the files that are genuinely
  ambiguous after that, and cap what is extracted.
- **Batch hard.** One call classifying two hundred files, never two hundred
  calls. Fifty thousand files at 200 tokens of metadata each is 10M input
  tokens, so this is a cost decision rather than a rounding error. Cache the
  taxonomy prefix.
- **CLOSED VOCABULARY, exactly as the admin timesheet query does it.** The
  model is handed the list of candidate destination folder ids and returns one
  of them per file. Every returned value is checked against that exact set and
  a non-match is DROPPED AND NAMED, never passed through. The model must never
  emit a path string, a URL or a drive id. Reuse the `admitOption` shape.
- The dangerous failure here is the same as in timesheets: a wrong answer that
  looks right. A misfiled invoice reads as a filing decision, not as an error.
  So the model's one-line reason travels with every proposed move and is always
  shown.

### Phase 4 - the plan as a reviewable record

The proposal is ROWS IN POSTGRES, not an action. One row per file: item id,
current path, proposed path, the reason, a confidence. Nothing has touched
SharePoint at this point and nothing can.

A person filters it, edits destinations, bulk approves or rejects. Approval
writes an audit entry naming them and the plan. **The approval record is what
authorises the writes in phase 5, and there is no other path to a write.**

### Phase 5 - execute, deterministically

Code walks approved rows. No model is involved. Folders first, then moves.

- Record before and after for EVERY item, so a reverse plan can be generated.
  **That reverse plan is the only undo we get.** The recycle bin does not help
  with a move.
- Idempotent and resumable. A twelve thousand file reorganise will be throttled
  partway through, and re-running it must not double-move anything.
- Set `@microsoft.graph.conflictBehavior` deliberately rather than taking the
  default.
- A failure on one item skips and reports. It never retries forever and it
  never aborts the batch.

## Rules that bite if ignored

- **Permission inheritance is the sharpest edge in this whole feature.** A move
  WITHIN a library keeps an item's unique permissions. A move to a DIFFERENT
  library or site does not carry them cleanly, and a restricted file can land
  somewhere broader. A tidy-up that quietly widens access to a contract or a
  salary review is a far worse outcome than a messy library. So: **phase one of
  execution moves only within a library, and any item with unique permissions
  is excluded from automatic movement and flagged for a human.** Cross-library
  moves are a separate, later, deliberate decision.
- **Unique permission scopes have a hard ceiling.** SharePoint caps them at
  50,000 per list and throws `uniqueScopesExceeded`. Creating many folders with
  broken inheritance can reach it.
- **Moving a file breaks links to it.** Teams tabs, OneNote references,
  bookmarks and paths written inside other documents do not follow. Decide
  whether we are warning people or absorbing the complaints, and say which.
- **Retention labels, holds and checkouts make individual moves fail.** Check
  for them during the crawl and exclude, rather than discovering it mid-run.
- **Job, project, site, library, folder and file names reaching a prompt are
  untrusted input**, on exactly the same footing as the Jira names and the
  attachment filenames already handled. They travel inside the FACTS markers,
  and nothing the model returns drives control flow.
- **Any new non-chat path to Bedrock writes an `ai_chat_request_logs` row.**
  That table is a promise about what was actually sent, and a path that skipped
  it would quietly turn the promise into "every call except the ones added
  later". Use `converseText` in `src/lib/ai/converse.ts` rather than a second
  client. A new `kind` enum member is an additive `ALTER TYPE` in a migration,
  and enum values cannot be dropped later, so name it once and name it well.
- **Crawled metadata is company data and needs a retention window** like
  everything else in this app. File paths and document names are themselves
  disclosive.
- **This changes the AI chat promise, and that is a decision, not a
  consequence.** Right now chat is confidential from peers but admins read the
  request log in full, and the log records that a file was SENT and never its
  content. If SharePoint documents flow into chat, that promise now spans other
  people's documents. `sanitizeDocumentName` also carries an explicit note that
  its reasoning assumes chat has no tools and no sharing, and it says to revisit
  if that changes. This is that change. Settle it, in writing, and update the
  copy on the chat page before shipping anything that puts a company document
  in front of the model.

## Where the code goes

Follow the existing layering. Nothing here justifies an exception.

```text
src/lib/sharepoint/graph-client.ts        Graph HTTP, retry, throttle. Mirrors
                                          src/lib/timesheet/jira-client.ts.
src/lib/sharepoint/graph-token.ts         delegated token acquisition/refresh
src/lib/data/repositories/sharepoint-*.repository.ts
src/lib/data/sql/migrations/011_sharepoint_inventory.sql
src/features/sharepoint-sync/             the crawl, service-only at first
src/features/sharepoint/                  page / service / actions / types
```

- Repositories stay the only database access and must not import from features.
- Guards live in the service, not only in the action, using the helpers in
  `src/lib/auth/session-auth-server.ts`.
- Mutations go through `.actions.ts` with Zod validation.
- A scope failure answers `notFound()`, not "forbidden".
- Next migration number is **011**. There are two 009 files already, so check
  before assuming.
- `pnpm lint` and `pnpm exec tsc --noEmit` before anything is done.

## Where the work runs

Phase 1 and phase 5 both outlive a request. The transcription pattern (a state
machine on a row, advanced by whoever is looking at it) is the precedent in
this codebase and is workable. But a crawl of a large library is the honest
argument for a real background worker, an Azure Container App job or a
Function. Decide it when phase 1 has real throughput numbers, not before.

## Alternative worth pricing before building any of this

If the goal is a ONE-OFF cleanup rather than an ongoing capability, PnP
PowerShell doing the crawl and the moves, with the portal used only to produce
the taxonomy and the classification, gets there for a fraction of the build.
SharePoint Premium also classifies documents natively, but it processes in
Microsoft's cloud rather than Bedrock AU, which cuts against the whole reason
inference is pinned to Australia.
