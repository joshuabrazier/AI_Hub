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
(document signer names and signature images) and enrolled 2FA secrets. If you
change either in Azure, that data can no longer be decrypted and 2FA breaks.
Treat them as permanent once real data exists.

`NEXT_PUBLIC_APP_TITLE` is the two-factor **issuer**, so changing its value
relabels the entry in every enrolled authenticator app. Existing secrets keep
verifying, but people see a stale or duplicated name.

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

1. Confirm CI is green.
2. Run the **Deploy to Azure App Service** workflow from the Actions tab.
3. Verify the site loads and sign-in works.
4. For a brand-new environment, do this first: apply the schema, create the first
   admin with `scripts/create-admin.mjs`, confirm the Postgres firewall lets the
   App Service in, set all App Service application settings, and set the startup
   command.
