# Dev environment runbook (Azure portal)

Stand up a DEV copy of the production environment by hand. Everything here is
portal clicking. No CLI, no scripts.

Read the two warnings below before you start. They are the only two ways this
goes badly wrong, and both are silent.

> **Never point dev at the production database.** Copying `DATABASE_URL` from
> prod is the single most damaging thing you can do here. Dev would be writing
> to real client timesheets and reading real meeting transcripts, and nothing
> in the app would tell you. Dev gets its own database, always.

> **Never leave `EMAIL_SEND_ENABLED=true` in dev.** A dev test then emails real
> staff and real clients from the real sender address. It is set to `false`
> below and should stay that way.

Azure's built-in "Clone App" is not an option for us: it needs Standard tier or
higher, and it does not support Linux apps. Both rule us out.

## Naming used below

Substitute your own if you prefer, but keep them consistent throughout.

| Thing | Name |
| --- | --- |
| Resource group | `rg-aihub-dev` |
| App Service Plan | `asp-aihub-dev` |
| Web App | `aihub-dev` |
| Storage account | `staihubdev` |
| Postgres server | `psql-aihub-dev` |
| Region | Australia East |

The web app name must be globally unique across all of Azure, so `aihub-dev`
may be taken. The dev URL is `https://<web app name>.azurewebsites.net` and
several later steps depend on it, so settle the name at step 2 and do not
change it afterwards.

## Values to record as you go

Keep these somewhere as you collect them. Four of them are shown exactly once
and cannot be retrieved later.

- [ ] Dev URL: `https://__________.azurewebsites.net`
- [ ] Postgres admin password (**shown once**)
- [ ] Storage connection string
- [ ] `BETTER_AUTH_SECRET` (**generated, shown once**)
- [ ] `FIELD_ENCRYPTION_KEY` (**generated, shown once**)
- [ ] `RETENTION_JOB_SECRET` (**generated**)
- [ ] `JIRA_SYNC_SECRET` (**generated**)

Generate the four secrets now, in PowerShell. Run this four times and keep
each result:

```powershell
$b = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
[Convert]::ToBase64String($b)
```

---

## 1. Resource group

A resource group is a folder that holds related resources. Deleting it deletes
everything inside, which is exactly why dev gets its own: you can bin the whole
environment and rebuild without going near prod.

1. Portal search bar -> **Resource groups** -> **Create**.
2. Subscription: the same one prod is in. Check this. Cloud accounts often have
   several and putting dev in the wrong one is tedious to unpick.
3. Name `rg-aihub-dev`, Region **Australia East**.
4. **Review + create** -> **Create**.

## 2. App Service Plan and Web App

Created together in one blade.

1. Search **App Services** -> **Create** -> **Web App**.
2. Resource Group: `rg-aihub-dev`.
3. Name: `aihub-dev`. **Write the resulting URL down now.** Steps 5, 6 and 8
   all depend on it.
4. Publish: **Code**. Runtime stack: **Node 20 LTS**. OS: **Linux**.
   Region: **Australia East**.
5. Pricing plan: **Create new** -> `asp-aihub-dev` -> **Basic B1**.

   B1 is the smallest tier that offers Always On. F1 and D1 do not, and without
   it the Node server cold-starts on every visit, which makes dev feel broken
   when it is not.
6. **Deployment** tab: Continuous deployment **Disable**. We deploy from the
   existing GitHub Actions workflow, not from the portal's own wiring.
7. **Monitoring** tab: Application Insights **No**, unless you want it. It is
   easy to add later and it costs money.
8. **Review + create** -> **Create**. Wait for it to finish.

## 3. Storage account

Dev must not share prod's storage account. If it did, a dev test could delete a
real chat attachment or a real meeting recording.

1. Search **Storage accounts** -> **Create**.
2. Resource group `rg-aihub-dev`, name `staihubdev` (3-24 characters, lowercase
   letters and digits only, no hyphens), region **Australia East**.
3. Performance **Standard**, Redundancy **LRS**. Dev does not need geo
   redundancy and LRS is the cheapest.
4. **Advanced** tab: **Allow blob public access = Disabled**, minimum TLS
   version **1.2**.
5. Create.

### 3a. Containers

Open the storage account -> **Data storage** -> **Containers** -> **+ Container**.
Create two, both with public access level **Private**:

- `ai-chat-attachments`
- `transcription-media`

Check these names against prod's `AZURE_STORAGE_ATTACHMENT_CONTAINER` and
`AZURE_MEDIA_CONTAINER` settings and match whatever prod uses.

### 3b. CORS

The meeting recorder uploads browser-direct to blob storage. Without CORS that
upload fails silently in the browser with nothing at all in the server logs, so
this step is not optional and its absence is very hard to diagnose later.

In the storage account -> **Settings** -> **Resource sharing (CORS)** ->
**Blob service** tab. Add one row:

| Field | Value |
| --- | --- |
| Allowed origins | `https://aihub-dev.azurewebsites.net` (your dev URL, no trailing slash) |
| Allowed methods | `PUT`, `OPTIONS` |
| Allowed headers | `*` |
| Exposed headers | `*` |
| Max age | `3600` |

**Save.**

### 3c. Connection string

**Security + networking** -> **Access keys** -> **Show** on key1 ->
copy **Connection string**. Record it.

## 4. Postgres

1. Search **Azure Database for PostgreSQL flexible servers** -> **Create** ->
   **Flexible server**.
2. Resource group `rg-aihub-dev`, server name `psql-aihub-dev`, region
   **Australia East**, PostgreSQL version **16** (match prod).
3. Workload preset: **Development**. Compute + storage: **Burstable B1ms**,
   32 GiB. This is the cheap tier and is fine for dev.
4. High availability: **disabled**.
5. Authentication: **PostgreSQL authentication only**. Set an admin username
   and password. **Record the password. It is not retrievable.**
6. **Networking** tab: **Public access**. Tick **Allow public access from any
   Azure service within Azure to this server**. That is what lets the App
   Service connect.
7. Also on that tab, **+ Add current client IP address**, so you can connect
   from your own machine to apply the schema at step 7.
8. Create. This takes five to ten minutes.

### 4a. Create the database

Once it finishes: open the server -> **Settings** -> **Databases** -> **+ Add**
-> name it `aihub` (match prod's database name).

Your connection string is then:

```text
postgresql://<admin user>:<password>@psql-aihub-dev.postgres.database.azure.com:5432/aihub?sslmode=require
```

`sslmode=require` is mandatory. Azure Postgres refuses unencrypted connections.

## 5. Entra redirect URI

Dev will use the same app registration as prod, so Entra will reject its
sign-in until the dev callback is registered.

1. [entra.microsoft.com](https://entra.microsoft.com) -> **Entra ID** ->
   **App registrations** -> your app (match the `MICROSOFT_CLIENT_ID` GUID).
2. **Manage** -> **Authentication**.
3. Under **Web** -> **Add URI**:

   ```text
   https://aihub-dev.azurewebsites.net/api/auth/callback/microsoft
   ```

   Exact match. Correct scheme, no trailing slash. A mismatch here produces an
   Entra error page at sign-in rather than anything in our logs.
4. **Save.** Adding a URI does not affect the existing prod one.

**Worth considering:** give dev its own app registration instead. Ten minutes
of work, and it means a fumbled setting in dev cannot lock everyone out of
prod. Our own deployment notes already flag that an expired secret on that app
locks out admins included.

## 6. App Service configuration

Open the `aihub-dev` App Service.

### 6a. Stack and startup

**Settings** -> **Configuration** -> **Stack settings** tab:

- Stack **Node**, major version **Node 20 LTS**.
- Startup Command:

  ```text
  HOSTNAME=0.0.0.0 node server.js
  ```

  `HOSTNAME=0.0.0.0` is load-bearing. Azure otherwise sets `HOSTNAME` to the
  container name and the app binds to an address nothing can reach, so it looks
  like it started fine and simply never responds.

**General settings** tab:

- **Always On: On**
- HTTPS Only: **On**
- Minimum inbound TLS version: **1.2**

**Save**, and accept the restart prompt.

### 6b. Environment variables

**Settings** -> **Environment variables** -> **App settings** tab.

The fast way to do this is copy prod's and edit. On the **prod** App Service,
go to the same blade and click **Advanced edit**, then copy the whole JSON
block. Paste it into **Advanced edit** on dev, then apply the changes in the
table below before saving.

Do it in a text editor, not in the portal's little box. It is easier to see
what you are doing and you get an undo.

**Change these. Every one of them.**

| Setting | Dev value |
| --- | --- |
| `DATABASE_URL` | the dev string from step 4a |
| `AZURE_STORAGE_CONNECTION_STRING` | the dev string from step 3c |
| `NEXT_PUBLIC_APP_URL` | `https://aihub-dev.azurewebsites.net` |
| `NEXT_PUBLIC_BETTER_AUTH_COOKIE_PREFIX` | `portaldev` |
| `BETTER_AUTH_SECRET` | a freshly generated one |
| `FIELD_ENCRYPTION_KEY` | a freshly generated one |
| `RETENTION_JOB_SECRET` | a freshly generated one |
| `JIRA_SYNC_SECRET` | a freshly generated one |
| `EMAIL_SEND_ENABLED` | `false` |
| `JIRA_SYNC_ENABLED` | `false` |
| `RETENTION_JOB_ENABLED` | `false` |

Why each of those is not simply copied:

- `BETTER_AUTH_SECRET` signs session cookies. Share it and a session minted in
  dev is valid in prod.
- `FIELD_ENCRYPTION_KEY` becomes permanent the moment dev encrypts its first
  value under it, exactly as in prod. Give dev its own from the start.
- The two job secrets authorise endpoints that DELETE data. A second copy of
  either is a second thing to leak.
- `JIRA_SYNC_ENABLED` off until you have decided what a dev environment syncing
  from live Jira ought to mean.
- `RETENTION_JOB_ENABLED` off because a brand new environment should not start
  deleting things on its own.

**Delete this if it appears.** `DEV_PASSWORD_SIGN_IN` must not exist on any
deployed environment. Leaving `MODE=production` below means it could not take
effect anyway, and that belt-and-braces is deliberate.

**Keep `MODE=production`.** Counter-intuitive, but this is a deployed
environment and should exercise the same code paths prod does. `development`
here would mean dev tests something prod never runs.

**Copy verbatim from prod:** everything else. That is `MICROSOFT_CLIENT_ID`,
`MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_SECRET`, `AUTH_ALLOWED_EMAIL_DOMAINS`,
`AWS_BEARER_TOKEN_BEDROCK`, the `AZURE_SPEECH_*` values, `EMAIL_FROM_ADDRESS`,
`EMAIL_AZURE_ENDPOINT`, `EMAIL_AZURE_ACCESS_KEY`, the container names, the
retention day counts, the `JIRA_*` connection values, `TIMESHEET_HISTORY_START`,
the remaining `NEXT_PUBLIC_*` values, and
`SCM_DO_BUILD_DURING_DEPLOYMENT=false`.

**If any prod value looks like `@Microsoft.KeyVault(...)`**, that is a Key
Vault reference and it will not resolve in dev until the dev app's managed
identity is granted access to that vault. Either paste the literal value into
dev instead, or go to **Settings** -> **Identity** -> System assigned -> **On**
on the dev app, then add it to the vault's access policy. A reference that
cannot resolve arrives in the app as the literal text `@Microsoft.KeyVault(...)`
rather than as an error, which is a confusing failure.

**Apply** and let the app restart.

## 7. Database schema

There is no migration runner, so nothing has created the tables yet. From a
machine whose IP you allowed at step 4 step 7, apply in this order against the
dev database:

1. `src/lib/data/sql/database-schema.sql`
2. `src/lib/data/sql/migrations/` in filename order, 001 through 010.
   **There are two files numbered 009. Apply both.**

Use pgAdmin, DBeaver, or `psql` if you have it.

**Do not restore a copy of the production database into dev.** It holds real
client timesheets, real meeting transcripts and real chat logs, and dev is by
definition the environment with looser access and more people poking at it. If
you need realistic data, generate it.

## 8. GitHub deployment

Two parts, and the second one catches everybody.

### 8a. Publish profile

On the dev App Service **Overview** page -> **Download publish profile**.
Open the file, copy all of it.

GitHub repo -> **Settings** -> **Secrets and variables** -> **Actions**. Where
this goes depends on 8b, so read that first.

### 8b. The part that will catch you out

`NEXT_PUBLIC_*` values are baked into the client bundle at **build** time from
GitHub repo Variables. Setting them on the dev App Service does nothing for the
browser bundle. So dev needs its own build with its own variables, and right
now the workflow has exactly one set of repo-level Variables and one deploy
target. Pointing that at dev breaks prod's next deploy.

The fix is GitHub Environments:

1. Repo **Settings** -> **Environments** -> **New environment**. Create two:
   `prod` and `dev`.
2. Move these from repo level to **environment** level, with different values
   in each: `AZURE_WEBAPP_NAME`, `NEXT_PUBLIC_APP_URL`, `DATABASE_URL`,
   `AZURE_WEBAPP_PUBLISH_PROFILE`.
3. Edit `.github/workflows/deploy.yml`: add a `workflow_dispatch` choice input
   for the environment, and set `environment:` on the deploy job from it.

That is a code change, not portal work. It is the one part of this worth
handing to Claude Code.

## 9. First deploy and first admin

1. GitHub -> **Actions** -> the deploy workflow -> **Run workflow**, choosing
   the `dev` environment.
2. When it finishes, open `https://aihub-dev.azurewebsites.net`.
3. Sign in with Microsoft. You will land as a **member** in no team, because
   new accounts always do.
4. Run `scripts/promote-admin.mjs` against the **dev** database to make
   yourself an admin. Check twice that it is pointed at dev.

## 10. Verify

- [ ] The sign-in page renders and shows the **Continue with Microsoft** button.
      No button means the `MICROSOFT_*` settings did not take.
- [ ] Sign-in completes without an Entra error. An error here is almost always
      the redirect URI at step 5.
- [ ] You reach `/welcome` and can complete the profile. That proves the
      database is connected and the schema applied.
- [ ] Send a message in AI chat. That proves Bedrock and the database write.
- [ ] Attach a file to a chat message. That proves blob storage.
- [ ] Record ten seconds in transcription and upload it. **That is the CORS
      test**, and it is the one most likely to fail.
- [ ] Admin -> AI chat log shows the requests you just made.
- [ ] Confirm in prod that nothing new appeared in it while you did all of the
      above. If it did, `DATABASE_URL` on dev is wrong, and stop immediately.

## Cost and teardown

Roughly AUD 35-45 a month: about 20-25 for the B1 plan, 15-20 for burstable
Postgres, pennies for storage.

Both compute resources can be stopped when not in use, from the **Overview**
page of each: **Stop** on the App Service, **Stop** on the Postgres server.
Stopped Postgres restarts itself after seven days.

To destroy the whole environment and start over: **Resource groups** ->
`rg-aihub-dev` -> **Delete resource group**. It makes you type the name. This
is the reason dev has its own resource group, and it is why nothing in prod's
group was touched at any point above.
