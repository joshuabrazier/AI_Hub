# Documentation

Documentation for the portal base.

- [architecture.md](architecture.md) - how the codebase is structured: the domain model, the three areas, the layering, authorization and team scoping, and the data conventions.
- [setup.md](setup.md) - prerequisites, environment variables, database, and running the app and tests.
- [deployment.md](deployment.md) - the Azure App Service deploy runbook. The workflow ships unconfigured on purpose.
- [security.md](security.md) - the single security reference: auth, authorization, encryption, headers, secrets, rate limiting, audit logging, known gaps and incident response.

The data-retention job is documented in [security.md](security.md) rather than in
its own file. An earlier `data-retention.md` was referenced from nine places but
was gitignored, so it never actually existed for anyone cloning the repo.

See also [`CLAUDE.md`](../CLAUDE.md) in the repo root for a condensed
contributor and agent quick reference.

## Starting a new project from this base

1. Copy the repo and set `NEXT_PUBLIC_APP_TITLE`, `NEXT_PUBLIC_APP_DESCRIPTION`
   and `NEXT_PUBLIC_APP_TIME_ZONE` in the environment. Adjust the short name and
   legal name in `src/lib/brand.ts` if they differ.
2. Swap the palette and type in the token block at the top of
   `src/app/globals.css`. Nothing else references a colour directly.
3. Replace `public/logo.png`.
4. Apply `src/lib/data/sql/database-schema.sql`, then bootstrap the first admin
   with `scripts/create-admin.mjs`.
5. Sign in and edit the public pages from the admin area. The home page and all
   legal copy are content, not code.
6. Configure `.github/workflows/deploy.yml` deliberately - it is inert until you
   set `AZURE_WEBAPP_NAME`.

Then add the project's own domain. The base carries none: users, teams,
invitations, audit and retention are all
domain-neutral, and nothing above them presumes what the project delivers. See
"Adding a domain" in [architecture.md](architecture.md) for the shape to follow.
