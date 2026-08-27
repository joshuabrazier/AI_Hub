# Deployment runbook (Azure App Service)

The app runs on **Azure App Service** (Linux, Node 20) as a self-contained
Next.js **standalone** server. GitHub Actions builds the app on the CI runner and
ships a ready-to-run artifact - the App Service does **not** build (it OOM-hangs
on `next build`).

## Plan sizing

For a few hundred accounts, **B2** (2 vCPU / 3.5 GB) is a comfortable
single-instance plan. B1 will run it but leaves thin headroom for bursts; B3 is
usually overkill. If you want autoscale or a staging slot, move to **Standard
(S1+)**. Postgres is a separate service (Azure Database for PostgreSQL Flexible
Server), sized independently.

## How the pipeline works

`.github/workflows/deploy.yml`. It ships **manual-only** (`workflow_dispatch`)
and is inert until configured - see "GitHub configuration" below. Add a
`push: branches: [main]` trigger yourself once you have confirmed the target is
correct, so a project copied from this base cannot deploy by merging:

1. pnpm 10 + Node 20, then `pnpm install --frozen-lockfile`. The repo's `.npmrc`
   sets `node-linker=hoisted` so `node_modules` is a real tree, not pnpm's
   symlinked store. The standalone bundle copies `node_modules` verbatim, and
   symlinks break once unzipped on the App Service, so this setting is required.
2. `pnpm build` with `output: "standalone"` (`next.config.ts`). Build-time env:
   - `NEXT_PUBLIC_*` come from **repo Variables** (they are baked into the client bundle).
   - `DATABASE_URL` is a **repo Secret** supplied only so env validation passes. The build does **not** connect to the database: the public content pages are `dynamic = "force-dynamic"` and render on demand, so an unreachable build-time `DATABASE_URL` is fine.
   - `BETTER_AUTH_SECRET`, `FIELD_ENCRYPTION_KEY`, and the `EMAIL_*` keys are only **validated** at build with placeholder values. The running server re-reads the **real** values at runtime from Azure application settings.
3. Assemble the standalone package: copy `.next/static` and `public` into `.next/standalone` (standalone does not include them).
4. Zip the **contents** of `.next/standalone` so `server.js` sits at the archive root.
5. Deploy the zip via `azure/webapps-deploy` (OneDeploy) to the App Service named by the `AZURE_WEBAPP_NAME` repo Variable, using the publish profile. The workflow fails fast if that Variable is unset, so a project copied from this base cannot deploy anywhere by accident.

## One-time App Service configuration

Set these once on the App Service - the workflow does not manage them:

- **Startup Command** (Configuration -> General settings):
  `HOSTNAME=0.0.0.0 node server.js`
  (`HOSTNAME=0.0.0.0` so it binds all interfaces; Azure otherwise sets `HOSTNAME`
  to the container name and the app is unreachable.)
- **App setting** `SCM_DO_BUILD_DURING_DEPLOYMENT = false` (we ship a built artifact).
- **Always On = On** (keep the Node server warm; no cold starts).
- **Node version 20.**
- **Application settings** (runtime env) - the real server secrets live here, not in GitHub:
  `MODE=production`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `FIELD_ENCRYPTION_KEY`,
  `EMAIL_FROM_ADDRESS`, `EMAIL_AZURE_ENDPOINT`, `EMAIL_AZURE_ACCESS_KEY`,
  `EMAIL_SEND_ENABLED`, plus the `NEXT_PUBLIC_*` values.
  Then, per feature: `AWS_BEARER_TOKEN_BEDROCK` (AI chat),
  `AZURE_STORAGE_CONNECTION_STRING` (attachments), and
  `MICROSOFT_CLIENT_ID` / `MICROSOFT_TENANT_ID` / `MICROSOFT_CLIENT_SECRET` +
  `AUTH_ALLOWED_EMAIL_DOMAINS` (Microsoft sign-in).
  Every secret among these belongs in **Key Vault**, referenced by the App
  Service setting rather than pasted into it.

  **The job secrets are easy to miss and each one silently disables a
  feature rather than breaking it.** Every endpoint below answers 503 until
  its secret is set, which reads as "nothing is happening" rather than as an
  error:
  `RETENTION_JOB_SECRET` (the monthly retention and de-identification job),
  `TRANSCRIPTION_SWEEP_SECRET` (carries transcriptions forward when nobody
  has the page open - without it a locked phone never gets a notification),
  `SHAREPOINT_SWEEP_SECRET` (without it a queued crawl never walks at all),
  and `JIRA_SYNC_SECRET` plus the `JIRA_*` settings for the timesheet sync.

  Setting them is only half of it - see **Scheduled work** below, because
  nothing calls any of these endpoints on its own.

  Optional, with sensible defaults: `SHAREPOINT_INVENTORY_RETENTION_DAYS`
  (180), `TRANSCRIPTION_RETENTION_DAYS` (90), `AI_CHAT_RETENTION_DAYS` (365),
  `AI_CHAT_LOG_RETENTION_DAYS` (30), `AUDIT_LOG_RETENTION_DAYS` (180).

  **Never set `DEV_FAKE_SHAREPOINT_URL` on a deployed environment.** It
  points the SharePoint crawl at a fake server. `MODE=production` refuses it
  regardless, but do not rely on that.

## Scheduled work

**Nothing in this app runs on a timer by itself.** Four endpoints exist to be
called from outside, and each one is inert until something calls it. This is
the single most common way a deployment ends up half working: the feature is
configured, the secret is set, and nothing ever happens.

| Endpoint | Cadence | What breaks without it |
| --- | --- | --- |
| `/api/jobs/sharepoint-crawl-sweep` | every 1-2 min | A queued crawl never walks. The admin screen sits at "Queued, 0 pages" forever. |
| `/api/jobs/transcription-sweep` | every 1-2 min | A transcription only advances while somebody has the page open, so a locked phone never gets a "ready" notification. |
| `/api/jobs/jira-sync` | hourly or nightly | Timesheet figures stop updating. |
| `/api/jobs/data-retention` | monthly | Nothing is ever purged or de-identified. |

All four take `Authorization: Bearer <secret>` and nothing else. There is no
session behind a scheduler, so the usual role guards do not apply and must
not be added.

### The recommended way: an Azure Logic App

A Consumption Logic App with a Recurrence trigger and one HTTP action. Cheap,
keeps to its schedule, and lives next to the app it drives. One per cadence,
or one with several HTTP actions.

In the Logic App Designer, switch to Code view and use:

```json
{
  "definition": {
    "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
    "triggers": {
      "Every2Minutes": {
        "type": "Recurrence",
        "recurrence": { "frequency": "Minute", "interval": 2 }
      }
    },
    "actions": {
      "SharePointCrawlSweep": {
        "type": "Http",
        "inputs": {
          "method": "POST",
          "uri": "https://YOUR-APP.azurewebsites.net/api/jobs/sharepoint-crawl-sweep",
          "headers": { "Authorization": "Bearer YOUR_SHAREPOINT_SWEEP_SECRET" }
        }
      },
      "TranscriptionSweep": {
        "type": "Http",
        "inputs": {
          "method": "POST",
          "uri": "https://YOUR-APP.azurewebsites.net/api/jobs/transcription-sweep",
          "headers": { "Authorization": "Bearer YOUR_TRANSCRIPTION_SWEEP_SECRET" }
        },
        "runAfter": {}
      }
    }
  }
}
```

Both actions have an empty `runAfter`, so they run in parallel and a failure
of one does not stop the other. Put the secrets in Key Vault and reference
them rather than inlining, exactly as with the App Service settings.

One call of the crawl sweep walks a bounded number of pages and then
re-queues, so a large library needs several. At a 2 minute recurrence that
resolves itself; nothing is lost, it just takes longer.

### The zero-infrastructure fallback

`.github/workflows/sweeps.yml` does the same job from GitHub Actions, and
loops the crawl sweep until nothing is due so a library finishes in one run.
It ships inert - set the repo Secrets
`SHAREPOINT_SWEEP_SECRET` / `TRANSCRIPTION_SWEEP_SECRET` to enable it. The
target comes from the `NEXT_PUBLIC_APP_URL` Variable that `deploy.yml`
already uses, so there is no second copy of the hostname to keep in step.

Understand what you are accepting: GitHub's scheduler has a 5 minute minimum,
is routinely late by 15 minutes or more, drops runs when the platform is
busy, and disables scheduled workflows after 60 days of repository
inactivity. Fine for crawls, which resume exactly where they stopped.
Mediocre for transcription notifications, where a person is waiting.

## GitHub configuration

- **Repo Secrets:** `DATABASE_URL`, `AZURE_WEBAPP_PUBLISH_PROFILE`.
- **Repo Variables:** `AZURE_WEBAPP_NAME` (the workflow refuses to run without
  it), `NEXT_PUBLIC_APP_TITLE`, `NEXT_PUBLIC_APP_DESCRIPTION`,
  `NEXT_PUBLIC_APP_URL` (bare hostname, no scheme - the workflow prepends
  `https://`), `NEXT_PUBLIC_APP_TIME_ZONE`,
  `NEXT_PUBLIC_BETTER_AUTH_COOKIE_PREFIX`, `NEXT_PUBLIC_PASSWORD_MIN_LENGTH`,
  `NEXT_PUBLIC_PASSWORD_MAX_LENGTH`, `EMAIL_FROM_ADDRESS`.

## CRITICAL: never rotate these on a live app

`BETTER_AUTH_SECRET` and `FIELD_ENCRYPTION_KEY` decrypt existing encrypted fields
and enrolled 2FA secrets. If you
change either in Azure, that data can no longer be decrypted and 2FA breaks.
Treat them as permanent once real data exists.

`NEXT_PUBLIC_APP_TITLE` is the two-factor **issuer**, so changing its value
relabels the entry in every enrolled authenticator app. Existing secrets keep
verifying, but people see a stale or duplicated name.

## Microsoft sign-in (Entra ID)

Optional, and off unless the three `MICROSOFT_*` settings are present.

**How access actually works, because two things are easy to conflate.**
`AUTH_ALLOWED_EMAIL_DOMAINS` is the gate, and it is the whole gate. Anyone in
the tenant on a listed domain gets an account as a `member` on first sign-in -
the app AUTO-PROVISIONS. Leaving that variable unset means **no restriction**,
not "no access".

An invitation is **not** a gate. It is a pre-assignment: a pending invitation
matching the address Entra verified sets the role and team the person lands
with. Without one they land as a member in no team, but they still land.

So turning Entra on with a domain listed **does** open the app to everyone in
the tenant on that domain, as members. That is the intended design, but it is
the opposite of what an invitation-gated model would do, so decide it
deliberately.

Both rules are enforced in `src/lib/auth/account-creation-policy.ts` from a
Better Auth `databaseHooks.user.create.before` hook - the database layer, not a
page - so they hold for every path that could ever create a user.

### Registering the app

1. Entra admin centre -> **App registrations** -> **New registration**.
2. Supported account types: **Accounts in this organizational directory only
   (single tenant)**.
3. Redirect URI: **Web**, set to
   `https://<your-app-hostname>/api/auth/callback/microsoft`.
   It must match exactly, including scheme and no trailing slash.
4. From **Overview**, copy **Application (client) ID** -> `MICROSOFT_CLIENT_ID`
   and **Directory (tenant) ID** -> `MICROSOFT_TENANT_ID`.
5. **Certificates & secrets** -> **New client secret**. Copy the **Value**, not
   the Secret ID - it is shown once - into `MICROSOFT_CLIENT_SECRET`.
   **Note the expiry**: sign-in stops working the day it lapses, so put the
   renewal in a calendar now.
6. **API permissions**: the defaults (`User.Read`, `openid`, `profile`, `email`)
   are enough. No admin consent needed for those.

### Settings

| Setting | Value |
| --- | --- |
| `MICROSOFT_CLIENT_ID` | Application (client) ID |
| `MICROSOFT_TENANT_ID` | Your tenant GUID - **never `common`** |
| `MICROSOFT_CLIENT_SECRET` | The secret Value. Key Vault. |
| `AUTH_ALLOWED_EMAIL_DOMAINS` | e.g. `datasagacity.com.au` |

`common` accepts any Microsoft account in the world, including personal
outlook.com ones. Better Auth defaults to it, so this must be set explicitly.

### Why the domain allowlist is not redundant

A single-tenant app registration does **not** guarantee everyone is on your
domain. **B2B guest users live inside your tenant with their own external
addresses**, and a single-tenant app authenticates them happily. Two controls
cover it: the allowlist above, and a rejection of any profile whose Entra
`acct` claim is `1` (guest) rather than `0` (member).

### Two-factor

Entra performs its own MFA if your tenant's Conditional Access requires it. The
app's TOTP two-factor is applied on the email-and-password path; a Microsoft
sign-in is not challenged for it again. **Confirm your tenant actually enforces
MFA** - if it does not, an SSO sign-in has only one factor.

### There is no password fallback

`emailAndPassword` is **disabled**. Microsoft is the only way in, and the
forgot-password, reset-password, accept-invite, change-password and app-level
2FA surfaces have been removed with it.

**If the Entra client secret expires or the registration breaks, nobody can
sign in - including admins - and the fix is in Azure, not in this app.** Put the
secret's expiry in a shared calendar.

### Access model

Anyone in the tenant whose address is on `AUTH_ALLOWED_EMAIL_DOMAINS` gets an
account on first sign-in, as a **member**. That allowlist is the entire access
boundary; unset means no restriction at all.

An invitation is no longer required. One that exists still pre-assigns the role
and team the person lands with.

### The first admin

New accounts are always members, so a fresh deployment has **no admin**, and
there is no in-app way to make one. The order is:

1. Deploy, with `AUTH_ALLOWED_EMAIL_DOMAINS` set.
2. Sign in with Microsoft yourself. This creates your account as a member and
   sends you to `/welcome` to confirm your name.
3. Promote yourself:

```
$env:DATABASE_URL = "<connection string>"
$env:ADMIN_EMAIL  = "you@yourdomain"
node scripts/promote-admin.mjs
```

4. Sign out and back in. Everyone else is promoted from the admin users screen.

Creating a user row by hand does not work: it would have no linked Entra
identity, so it could never be signed into.

## Attachment storage (Azure Blob)

- A **storage account** with one private container (`ai-chat-attachments` by
  default). The app creates the container on first use.
- `AZURE_STORAGE_CONNECTION_STRING` is a secret and belongs in Key Vault. With
  it unset the app runs normally and the chat composer simply does not offer
  file attachments.
- **Never enable anonymous read on that container.** The access check that keeps
  one user's files private lives in the download route; a public container
  routes around it entirely.
- Consider a lifecycle policy only as a safety net. Deletion is already handled
  by the retention job, which clears blobs before removing rows and runs a
  reconciliation sweep for orphans - see `docs/security.md`.
- Locally this is Azurite: `pnpm dev:storage` in a second terminal, with the
  emulator connection string from `.env.example`. Azurite lags the SDK's API
  version, which is why the script passes `--skipApiVersionCheck`.

## Meeting transcription (Azure AI Speech)

Optional. With it unset the transcription screen says so and nothing else
changes. Two pieces, and **the second is the one that gets forgotten**:

### 1. The Speech resource

- Create an **Azure AI Speech** resource in an Australian region
  (`australiaeast`) so meeting audio does not leave the country. It can live in
  the same resource group as everything else.
- Take **Key 1** and the region into Key Vault, then reference them from App
  Service as `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`.
- `AZURE_SPEECH_LOCALE` defaults to `en-AU`. Batch transcription is told one
  language up front - it does not detect it - so set this if the meetings are
  not in Australian English.
- The media container (`AZURE_MEDIA_CONTAINER`, default `transcription-media`)
  is created on first use in the **same storage account** as attachments. Never
  enable anonymous read on it.

### 2. Let the Speech resource read the storage account

The app hands the Speech service a **plain blob URL with no SAS token on it**.
The service reads it with its own managed identity, so without this step every
job fails with an access error and nothing else will explain why.

1. On the **Speech resource** -> Identity -> System assigned -> **On**. Save.
2. On the **storage account** -> Access Control (IAM) -> Add role assignment.
3. Role: **Storage Blob Data Reader**. Members: Managed identity -> the Speech
   resource. Review + assign.

This is deliberately not a SAS. A role assignment is revocable in one place and
does not expire mid-job, whereas a signed URL is a bearer credential in flight
with a window that a long transcription can outlive.

### 3. Allow the browser to upload to storage (CORS)

Recordings go **browser-to-blob**, so the browser makes a cross-origin request
to the storage account and the blob service has to answer a preflight. A storage
account has **no CORS rules by default**, and without them the upload fails
before it starts - in the browser, with nothing in the app's logs to explain it.

1. Storage account → **Settings** → **Resource sharing (CORS)** → **Blob service** tab.
2. **Add a row. Do not edit or delete the rows already there** - the account is
   shared, and those belong to other applications.
3. Fill it in:

| Field | Value |
| --- | --- |
| Allowed origins | `https://<your app hostname>` (the full one, including the random suffix) |
| Allowed methods | `PUT`, `OPTIONS` (`GET` and `HEAD` are harmless to include) |
| Allowed headers | `x-ms-blob-type,content-type,x-ms-blob-content-type` |
| Exposed headers | leave blank |
| Max age | `3600` |

4. **Save**. Rules take a minute or two to apply.

The origin must match exactly - scheme, host and port. A trailing slash or the
wrong hostname produces the same silent failure as having no rule at all.

Note that chat attachments do **not** need this. Those are proxied through the
app, so the browser only ever talks to the app's own origin. This is the cost of
the browser-direct upload, and it applies only to transcription.

### What to expect once it is on

- The recording is **deleted as soon as its transcript is stored**, so steady
  state in that container is only in-flight and failed jobs.
- Jobs are advanced by somebody opening the page, not by a worker. Nothing to
  deploy, nothing to monitor - see `docs/architecture.md`.
- Summarising the transcript is a **Bedrock** call, so it needs
  `AWS_BEARER_TOKEN_BEDROCK` as well. Without it the transcript still arrives
  and the summary says why it did not.

## Database

- Azure Database for PostgreSQL Flexible Server. Keep `sslmode=verify-full` in `DATABASE_URL`.
- **Firewall.** The build no longer touches the database, but the running app does (auth, dashboards, the dynamic public pages). The App Service must be able to reach the Postgres server, so enable **"Allow public access from Azure services"** (or add the App Service's outbound IPs) on the Postgres firewall. A connection timeout at runtime is almost always this.
- For a brand-new environment, apply `src/lib/data/sql/database-schema.sql` (it creates every table and the `schema_migrations` ledger), then sign in once and promote yourself with `scripts/promote-admin.mjs`. See `setup.md`.
- A single App Service instance means one pg pool - no PgBouncer needed. If you move to autoscale (multiple instances), add PgBouncer and watch the Postgres connection limit.

## CI

`.github/workflows/ci.yml`, on push to `main`/`development` and on PRs:
type-check (`tsc --noEmit`), lint, unit tests, and an informational production
dependency audit (does not fail the build). It uses dummy env values to satisfy
the schema, and generates a throwaway `FIELD_ENCRYPTION_KEY` per run so no
key-shaped value is committed.

Note that `tsconfig.json` includes `tests/**`, so CI type-checks the Playwright
specs too. A broken spec fails the build before the tests even run.

## Deploy checklist

### First deployment of a new environment, in order

1. **Create the Azure resources**: App Service (Linux, Node 20, B2+), Azure
   Database for PostgreSQL Flexible Server, a Storage account with a private
   container, a Key Vault, and - if transcription is wanted - an Azure AI
   Speech resource with `Storage Blob Data Reader` on that storage account.
2. **Postgres firewall**: allow public access from Azure services, or add the
   App Service outbound IPs. A connection timeout at runtime is almost always
   this.
3. **Apply the schema**: `src/lib/data/sql/database-schema.sql`.
4. **Register the Entra app** and note the client id, tenant id and secret.
   The redirect URI needs the final hostname, so do this after the App Service
   exists (or come back and correct it).
5. **Put secrets in Key Vault**, then reference them from App Service
   application settings.
6. **Set every App Service application setting**, plus the startup command
   `HOSTNAME=0.0.0.0 node server.js`, `SCM_DO_BUILD_DURING_DEPLOYMENT=false`,
   Always On, Node 20.
7. **Set the GitHub Secrets and Variables** listed above.
8. **Run the deploy workflow** from the Actions tab.
9. **Sign in with Microsoft yourself**, complete `/welcome`, then promote your
   account with `scripts/promote-admin.mjs`. There is no admin until you do.
10. **Verify in this order**: the site loads; Microsoft sign-in works; you land
    on `/welcome` first time and not again afterwards; you can reach `/admin`
    after promoting; a tenant account on a **different** domain is refused.
11. **If transcription is on**, record a two-minute test. A failure at "Uploading"
    is CORS or the storage connection string; a failure at "Queued" is the
    Speech resource's role assignment on the storage account.

That last check is the one worth doing deliberately. The domain allowlist is
the entire access boundary now - if it is unset or wrong, anyone the Entra app
admits gets an account, and nothing on the sign-in screen would show it.

### Every deployment after that

1. Confirm CI is green.
2. **Apply any new migrations FIRST, before deploying the code.**

   ```powershell
   $env:DATABASE_URL = "<this environment's connection string>"
   node scripts/check-migrations.mjs
   ```

   It reads only - it applies nothing - and lists what is pending, what has been
   applied whose file is missing from the repo, and any duplicate numbers. It
   exits non-zero when anything is outstanding.

   Run whatever it reports as PENDING. Each file wraps itself in
   `BEGIN`/`COMMIT`, so a failure rolls back rather than leaving half a schema.
   Your IP needs allowing on the Postgres firewall to connect; remove the rule
   afterwards.

   Deploying code that expects a table the database does not have takes the
   affected page down with a generic "A server error occurred", and nothing on
   the screen says which table is missing - **App Service → Monitoring → Log
   stream** does.
3. Run the **Deploy to Azure App Service** workflow from the Actions tab.
4. Verify the site loads and sign-in works.
