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

**How access actually works, because two things are easy to conflate.** The
invitation is the gate: an account can only be created for an address that
already has a usable invitation, whatever sign-in method is used. Microsoft is
how somebody proves they are that address. Turning Entra on does **not** open
the app to everyone in the tenant.

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

### Keep password sign-in during cutover

`emailAndPassword` stays enabled. Your bootstrap admin account is
password-based, and if the Entra registration is misconfigured - wrong redirect
URI, expired secret - that account is the way back in. Disable it only once SSO
is proven end to end.

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

## Database

- Azure Database for PostgreSQL Flexible Server. Keep `sslmode=verify-full` in `DATABASE_URL`.
- **Firewall.** The build no longer touches the database, but the running app does (auth, dashboards, the dynamic public pages). The App Service must be able to reach the Postgres server, so enable **"Allow public access from Azure services"** (or add the App Service's outbound IPs) on the Postgres firewall. A connection timeout at runtime is almost always this.
- For a brand-new environment, apply `src/lib/data/sql/database-schema.sql` (it creates every table and the `schema_migrations` ledger), then create the first admin with `scripts/create-admin.mjs`. See `setup.md`.
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
   container, and a Key Vault.
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
9. **Create the first admin** with `scripts/create-admin.mjs`. Its address must
   be on `AUTH_ALLOWED_EMAIL_DOMAINS`, or it cannot be created.
10. **Verify in this order**: the site loads; password sign-in works as that
    admin; Microsoft sign-in works; an invited colleague can accept with
    Microsoft; an **uninvited** tenant account is refused.

That last check is the one worth doing deliberately - it is the difference
between an invite-only app and one open to your whole tenant, and it is
invisible from the sign-in screen.

### Every deployment after that

1. Confirm CI is green.
2. Run the **Deploy to Azure App Service** workflow from the Actions tab.
3. Verify the site loads and sign-in works.
