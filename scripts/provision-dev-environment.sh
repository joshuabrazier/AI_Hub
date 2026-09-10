#!/usr/bin/env bash
#
# Provision the DEV environment as a copy of PROD.
#
# Run this in Azure Cloud Shell (bash). Nothing to install: az and jq are
# already there and you are already signed in.
#
#   1. portal.azure.com -> the terminal icon in the top bar -> Bash
#   2. upload this file with the upload button, or paste it into a new file
#   3. edit the CONFIG block below
#   4. bash provision-dev-environment.sh
#
# It is SAFE TO RE-RUN. Every create is guarded, so a failure partway through
# is fixed by fixing the cause and running it again.
#
# It NEVER writes to the prod resource group. It only reads from it.
#
# ---------------------------------------------------------------------------
# What it deliberately does NOT copy, and why
#
#   DATABASE_URL              copying it would point dev at the PRODUCTION
#                             database. Dev would then be writing to real
#                             client timesheets and reading real meeting
#                             transcripts. This is the single most dangerous
#                             thing a naive copy would do.
#   BETTER_AUTH_SECRET        sharing it means a session cookie minted in dev
#                             is valid in prod. Generated fresh here.
#   FIELD_ENCRYPTION_KEY      generated fresh. Once dev encrypts a value under
#                             it, it can never change, same rule as prod.
#   AZURE_STORAGE_CONNECTION_STRING
#                             dev gets its own storage account, so dev cannot
#                             read or delete prod attachments and meeting
#                             recordings.
#   RETENTION_JOB_SECRET      a second copy of a secret that authorises a
#                             DELETE job is not something to hand around.
#   JIRA_SYNC_SECRET          same reasoning.
#   NEXT_PUBLIC_APP_URL       the dev hostname, obviously.
#
# And three switches are FORCED OFF in dev regardless of what prod has:
#
#   EMAIL_SEND_ENABLED=false  otherwise a dev test emails real staff and real
#                             clients from the real sender address.
#   JIRA_SYNC_ENABLED=false   turn it on deliberately once you have decided
#                             what dev syncing from live Jira should mean.
#   RETENTION_JOB_ENABLED=false
#                             a deletion job is not something a fresh
#                             environment should start doing on its own.
#
# DEV_PASSWORD_SIGN_IN is never set. A deployed dev environment is still
# deployed, and MODE stays 'production' below precisely so that flag cannot
# take effect even if somebody sets it later by hand.
# ---------------------------------------------------------------------------

set -euo pipefail

# ===========================================================================
# CONFIG - edit this block, then run
# ===========================================================================

# Where prod lives. Find these in the portal on the App Service Overview page.
PROD_RESOURCE_GROUP="rg-aihub-prod"
PROD_APP_NAME="aihub-prod"

# What to create. App names must be globally unique across all of Azure.
DEV_RESOURCE_GROUP="rg-aihub-dev"
DEV_APP_NAME="aihub-dev"
DEV_PLAN_NAME="asp-aihub-dev"
DEV_STORAGE_ACCOUNT="staihubdev"      # 3-24 chars, lowercase letters and digits only
LOCATION="australiaeast"

# B1 is the smallest tier that still gives you Always On. F1 and D1 do not,
# and without Always On the Node server cold-starts on every visit.
DEV_PLAN_SKU="B1"

# Postgres. Set to false if you would rather point dev at a database you
# already have, in which case supply DEV_DATABASE_URL below.
CREATE_POSTGRES=true
DEV_PG_SERVER_NAME="psql-aihub-dev"
DEV_PG_ADMIN_USER="aihubadmin"
DEV_PG_DATABASE="aihub"
DEV_PG_SKU="Standard_B1ms"            # burstable, the cheapest that is not a toy
DEV_PG_STORAGE_GB=32
DEV_PG_VERSION="16"

# Only used when CREATE_POSTGRES=false.
DEV_DATABASE_URL=""

# ===========================================================================
# Nothing below here should need editing
# ===========================================================================

DEV_HOSTNAME="${DEV_APP_NAME}.azurewebsites.net"
DEV_APP_URL="https://${DEV_HOSTNAME}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
ok()   { printf '\033[0;32m    ok %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
# Preflight. Confirm the subscription out loud, because Cloud Shell defaults
# to whichever one it feels like and creating dev in the wrong subscription is
# tedious to unpick.
# ---------------------------------------------------------------------------
say "Subscription check"
az account show --query "{name:name, id:id}" -o tsv
read -r -p "    Is that the right subscription? [y/N] " reply
[[ "$reply" == "y" || "$reply" == "Y" ]] || { echo "Aborted. Use: az account set --subscription <name>"; exit 1; }

say "Reading prod configuration (read-only)"
az webapp show -g "$PROD_RESOURCE_GROUP" -n "$PROD_APP_NAME" -o none \
  || { echo "Cannot find the prod app. Check PROD_RESOURCE_GROUP and PROD_APP_NAME."; exit 1; }

PROD_SETTINGS_JSON="$(az webapp config appsettings list -g "$PROD_RESOURCE_GROUP" -n "$PROD_APP_NAME" -o json)"
PROD_LINUX_FX="$(az webapp config show -g "$PROD_RESOURCE_GROUP" -n "$PROD_APP_NAME" --query linuxFxVersion -o tsv)"
PROD_STARTUP="$(az webapp config show -g "$PROD_RESOURCE_GROUP" -n "$PROD_APP_NAME" --query appCommandLine -o tsv)"
ok "runtime: ${PROD_LINUX_FX:-unset}"
ok "startup: ${PROD_STARTUP:-unset}"
ok "$(echo "$PROD_SETTINGS_JSON" | jq 'length') app settings found"

# Any setting whose value is a Key Vault reference is copied as the reference
# text, which will NOT resolve until the dev app's managed identity is granted
# access to that vault. Flag them now rather than at 3am.
KV_REFS="$(echo "$PROD_SETTINGS_JSON" | jq -r '.[] | select(.value | test("@Microsoft.KeyVault")) | .name')"
if [[ -n "$KV_REFS" ]]; then
  warn "These prod settings are Key Vault references and will not resolve in dev until you grant access:"
  echo "$KV_REFS" | sed 's/^/      /'
fi

say "Resource group: $DEV_RESOURCE_GROUP"
az group create -n "$DEV_RESOURCE_GROUP" -l "$LOCATION" -o none
ok "ready"

say "App Service Plan: $DEV_PLAN_NAME ($DEV_PLAN_SKU, Linux)"
az appservice plan create \
  -g "$DEV_RESOURCE_GROUP" -n "$DEV_PLAN_NAME" \
  --sku "$DEV_PLAN_SKU" --is-linux -l "$LOCATION" -o none
ok "ready"

say "Storage account: $DEV_STORAGE_ACCOUNT"
az storage account create \
  -g "$DEV_RESOURCE_GROUP" -n "$DEV_STORAGE_ACCOUNT" \
  -l "$LOCATION" --sku Standard_LRS --kind StorageV2 \
  --min-tls-version TLS1_2 --allow-blob-public-access false -o none
DEV_STORAGE_CONNECTION="$(az storage account show-connection-string \
  -g "$DEV_RESOURCE_GROUP" -n "$DEV_STORAGE_ACCOUNT" --query connectionString -o tsv)"
ok "created"

# Container names are read from prod so dev matches, falling back to the
# defaults in .env.example.
ATTACHMENT_CONTAINER="$(echo "$PROD_SETTINGS_JSON" | jq -r '.[] | select(.name=="AZURE_STORAGE_ATTACHMENT_CONTAINER") | .value' )"
MEDIA_CONTAINER="$(echo "$PROD_SETTINGS_JSON" | jq -r '.[] | select(.name=="AZURE_MEDIA_CONTAINER") | .value' )"
ATTACHMENT_CONTAINER="${ATTACHMENT_CONTAINER:-ai-chat-attachments}"
MEDIA_CONTAINER="${MEDIA_CONTAINER:-transcription-media}"

for c in "$ATTACHMENT_CONTAINER" "$MEDIA_CONTAINER"; do
  az storage container create \
    --account-name "$DEV_STORAGE_ACCOUNT" --name "$c" \
    --connection-string "$DEV_STORAGE_CONNECTION" --public-access off -o none
  ok "container $c"
done

# CORS on the ACCOUNT, not the container. The transcription recorder uploads
# browser-direct on a write-only SAS, and without this the upload fails
# silently in the browser with nothing in the server logs.
say "Blob CORS for $DEV_APP_URL"
az storage cors add --services b --methods PUT OPTIONS \
  --origins "$DEV_APP_URL" --allowed-headers '*' --exposed-headers '*' \
  --max-age 3600 --connection-string "$DEV_STORAGE_CONNECTION" -o none
ok "added (this appends a rule, it does not replace the rule set)"

if [[ "$CREATE_POSTGRES" == "true" ]]; then
  say "Postgres Flexible Server: $DEV_PG_SERVER_NAME (this takes 5-10 minutes)"
  PG_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
  az postgres flexible-server create \
    -g "$DEV_RESOURCE_GROUP" -n "$DEV_PG_SERVER_NAME" -l "$LOCATION" \
    --admin-user "$DEV_PG_ADMIN_USER" --admin-password "$PG_PASSWORD" \
    --sku-name "$DEV_PG_SKU" --tier Burstable \
    --storage-size "$DEV_PG_STORAGE_GB" --version "$DEV_PG_VERSION" \
    --public-access 0.0.0.0 --yes -o none
  az postgres flexible-server db create \
    -g "$DEV_RESOURCE_GROUP" -s "$DEV_PG_SERVER_NAME" -d "$DEV_PG_DATABASE" -o none
  DEV_DATABASE_URL="postgresql://${DEV_PG_ADMIN_USER}:${PG_PASSWORD}@${DEV_PG_SERVER_NAME}.postgres.database.azure.com:5432/${DEV_PG_DATABASE}?sslmode=require"
  ok "created"
  warn "Postgres admin password (save it now, it is not stored anywhere else):"
  printf '      %s\n' "$PG_PASSWORD"
  warn "--public-access 0.0.0.0 allows Azure services only, not the open internet."
  warn "To connect with psql from Cloud Shell, add your IP:"
  warn "  az postgres flexible-server firewall-rule create -g $DEV_RESOURCE_GROUP -n $DEV_PG_SERVER_NAME --rule-name cloudshell --start-ip-address <ip> --end-ip-address <ip>"
else
  [[ -n "$DEV_DATABASE_URL" ]] || { echo "CREATE_POSTGRES is false but DEV_DATABASE_URL is empty."; exit 1; }
  ok "using the supplied DEV_DATABASE_URL"
fi

say "Web app: $DEV_APP_NAME"
az webapp create \
  -g "$DEV_RESOURCE_GROUP" -p "$DEV_PLAN_NAME" -n "$DEV_APP_NAME" \
  --runtime "${PROD_LINUX_FX:-NODE:20-lts}" -o none
ok "created"

say "Web app configuration"
az webapp config set -g "$DEV_RESOURCE_GROUP" -n "$DEV_APP_NAME" \
  --startup-file "${PROD_STARTUP:-HOSTNAME=0.0.0.0 node server.js}" \
  --always-on true --http20-enabled true --min-tls-version 1.2 -o none
az webapp update -g "$DEV_RESOURCE_GROUP" -n "$DEV_APP_NAME" --https-only true -o none
az webapp identity assign -g "$DEV_RESOURCE_GROUP" -n "$DEV_APP_NAME" -o none
ok "startup command, Always On, HTTPS only, managed identity"

# ---------------------------------------------------------------------------
# Build the dev settings.
#
# Start from prod, drop the ones that must never be shared, then layer the
# dev-specific values on top. Doing it as a filter rather than a hand-written
# list means a setting added to prod later is carried across automatically
# instead of being silently missed.
# ---------------------------------------------------------------------------
say "Application settings"

NEVER_COPY='["DATABASE_URL","DATABASE_HOST","DATABASE_PORT","DATABASE_NAME","DATABASE_USER","DATABASE_PASSWORD","BETTER_AUTH_SECRET","FIELD_ENCRYPTION_KEY","AZURE_STORAGE_CONNECTION_STRING","RETENTION_JOB_SECRET","JIRA_SYNC_SECRET","NEXT_PUBLIC_APP_URL","EMAIL_SEND_ENABLED","JIRA_SYNC_ENABLED","RETENTION_JOB_ENABLED","DEV_PASSWORD_SIGN_IN","WEBSITE_RUN_FROM_PACKAGE","WEBSITE_SITE_NAME","WEBSITE_HOSTNAME"]'

CARRIED="$(echo "$PROD_SETTINGS_JSON" \
  | jq -r --argjson skip "$NEVER_COPY" \
      '.[] | select(.name as $n | $skip | index($n) | not) | "\(.name)=\(.value)"')"

NEW_AUTH_SECRET="$(openssl rand -base64 32)"
NEW_FIELD_KEY="$(openssl rand -base64 32)"
NEW_RETENTION_SECRET="$(openssl rand -base64 32)"
NEW_JIRA_SYNC_SECRET="$(openssl rand -base64 32)"

# MODE stays 'production' on purpose. This is a DEPLOYED environment, so it
# should exercise the same code paths prod does, and keeping it here makes
# DEV_PASSWORD_SIGN_IN structurally incapable of taking effect.
DEV_ONLY=(
  "MODE=production"
  "SCM_DO_BUILD_DURING_DEPLOYMENT=false"
  "NEXT_PUBLIC_APP_URL=${DEV_APP_URL}"
  "NEXT_PUBLIC_BETTER_AUTH_COOKIE_PREFIX=portaldev"
  "DATABASE_URL=${DEV_DATABASE_URL}"
  "BETTER_AUTH_SECRET=${NEW_AUTH_SECRET}"
  "FIELD_ENCRYPTION_KEY=${NEW_FIELD_KEY}"
  "RETENTION_JOB_SECRET=${NEW_RETENTION_SECRET}"
  "JIRA_SYNC_SECRET=${NEW_JIRA_SYNC_SECRET}"
  "AZURE_STORAGE_CONNECTION_STRING=${DEV_STORAGE_CONNECTION}"
  "AZURE_STORAGE_ATTACHMENT_CONTAINER=${ATTACHMENT_CONTAINER}"
  "AZURE_MEDIA_CONTAINER=${MEDIA_CONTAINER}"
  "EMAIL_SEND_ENABLED=false"
  "JIRA_SYNC_ENABLED=false"
  "RETENTION_JOB_ENABLED=false"
)

mapfile -t CARRIED_ARR <<< "$CARRIED"
az webapp config appsettings set \
  -g "$DEV_RESOURCE_GROUP" -n "$DEV_APP_NAME" \
  --settings "${CARRIED_ARR[@]}" "${DEV_ONLY[@]}" -o none

ok "$(( ${#CARRIED_ARR[@]} + ${#DEV_ONLY[@]} )) settings applied"
echo
echo "    carried over from prod:"
echo "$CARRIED" | cut -d= -f1 | sed 's/^/      /'
echo "    set for dev:"
printf '      %s\n' "${DEV_ONLY[@]}" | cut -d= -f1

# ---------------------------------------------------------------------------
say "Done. What is left, in order"
cat <<NEXT

  The infrastructure exists. These four cannot be scripted and the app will
  not work until all of them are done.

  1. ENTRA REDIRECT URI
     The dev app is using the SAME app registration as prod, so Entra will
     reject its sign-in until you add the callback:

       ${DEV_APP_URL}/api/auth/callback/microsoft

     entra.microsoft.com -> App registrations -> your app -> Authentication
     -> Web -> Add URI. Exact match, no trailing slash.

     Consider giving dev its OWN app registration instead. It costs ten
     minutes and means a fumbled setting in dev cannot lock prod out.

  2. DATABASE SCHEMA
     There is no migration runner, so nothing has created the tables. From a
     machine that can reach the server, apply in this order:

       src/lib/data/sql/database-schema.sql
       src/lib/data/sql/migrations/001 through 010, in filename order
         (note there are TWO files numbered 009 - apply both)

     Do NOT restore a copy of the prod database. It holds real client
     timesheets, real meeting transcripts and real chat logs, and a dev
     environment is by definition the one with looser access.

  3. GITHUB DEPLOYMENT
     Two things, and the second one catches everybody:

     a. Download the dev publish profile and add it as a repo secret:
          az webapp deployment list-publishing-profiles \\
            -g ${DEV_RESOURCE_GROUP} -n ${DEV_APP_NAME} --xml

     b. NEXT_PUBLIC_* values are baked into the client bundle at BUILD time
        from GitHub repo Variables. Setting them on this App Service does
        nothing for the browser bundle. So a dev deploy needs its OWN build
        with its own variables, which means GitHub Environments:

          repo Settings -> Environments -> New environment: dev, and prod
          move AZURE_WEBAPP_NAME, NEXT_PUBLIC_APP_URL, the publish profile
            and DATABASE_URL from repo-level to environment-level
          add 'environment:' to the deploy job in deploy.yml, driven by a
            workflow_dispatch choice input

        Without this you get one deploy target, and pointing it at dev
        breaks prod's next deploy.

  4. FIRST ADMIN
     New accounts are always members and there is no in-app way to make an
     admin. Sign in once at ${DEV_APP_URL}, then run scripts/promote-admin.mjs
     against the DEV database.

  Cost: roughly AUD 20-25/month for the B1 plan plus about 15-20 for the
  burstable Postgres, plus pennies for storage. Both can be stopped when not
  in use:

    az webapp stop -g ${DEV_RESOURCE_GROUP} -n ${DEV_APP_NAME}
    az postgres flexible-server stop -g ${DEV_RESOURCE_GROUP} -n ${DEV_PG_SERVER_NAME}

  To tear the whole thing down and start again:

    az group delete -n ${DEV_RESOURCE_GROUP} --yes

NEXT
