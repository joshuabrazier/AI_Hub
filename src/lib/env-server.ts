import "server-only";

import { z } from "zod";
import { SITE_MODES } from "./constants";

// -------------------------------------------------------------------
// Validate server environment variables
// -------------------------------------------------------------------
const serverEnvSchema = z.object({
  MODE: z.enum([SITE_MODES.DEVELOPMENT, SITE_MODES.TEST, SITE_MODES.PRODUCTION]).default(SITE_MODES.DEVELOPMENT),

  // DATABASE_USER: z.string().min(1),
  // DATABASE_PASSWORD: z.string().min(1),
  // DATABASE_NAME: z.string().min(1),
  // DATABASE_HOST: z.string().min(1),
  // DATABASE_PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().url(),

  BETTER_AUTH_SECRET: z.string().min(32),

  // Base64-encoded 32-byte key for field-level encryption of sensitive data
  // at the application layer. No callers in the base - see field-encryption.ts.
  // Generate with: openssl rand -base64 32
  FIELD_ENCRYPTION_KEY: z.string().min(44),

  EMAIL_FROM_ADDRESS: z.string().email(),
  EMAIL_AZURE_ENDPOINT: z.string().url().optional(),
  EMAIL_AZURE_ACCESS_KEY: z.string().min(1).optional(),
  // Master switch for actually sending emails. When "false" (default) emails
  // are logged instead of sent, in any environment. Set "true" to send.
  EMAIL_SEND_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  // Data-retention monthly job (see docs/security.md).
  // RETENTION_JOB_SECRET is the bearer token the trigger endpoint requires; the
  // endpoint is inert (503) until it is set. RETENTION_JOB_ENABLED is the master
  // switch: while "false" (default) the job only REPORTS what it would
  // de-identify and changes nothing, so deploying never scrubs data on its own.
  // Set "true" only once the retention policy is signed off.
  RETENTION_JOB_SECRET: z.string().min(16).optional(),
  RETENTION_JOB_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  // -----------------------------------------------------------------
  // Jira timesheet sync (see docs/timesheet-sync.md).
  //
  // All optional, so the app boots without them and the sync endpoint simply
  // reports itself unconfigured rather than the whole process failing to
  // start over a feature not everyone runs.
  //
  // JIRA_EMAIL / JIRA_API_TOKEN must belong to a DEDICATED service account,
  // never a person's own login. A personal token stops working the day that
  // account is deactivated, and the failure mode is billing quietly stopping
  // rather than anything visibly breaking.
  // -----------------------------------------------------------------
  JIRA_BASE_URL: z.string().url().optional(),
  JIRA_EMAIL: z.string().email().optional(),
  JIRA_API_TOKEN: z.string().min(1).optional(),

  // Custom field ids ("customfield_10050"). Jira exposes custom fields by id,
  // not by name, and the ids differ per site - so they are configuration, not
  // constants. Without them the sync still runs and those attributes come
  // back empty, which surfaces as audit findings rather than as a crash.
  //
  // There is deliberately no JIRA_FIELD_CATEGORY. Internal vs External is not
  // a custom field, it is the Jira PROJECT CATEGORY, and it arrives on every
  // issue at fields.project.projectCategory.name. Nothing to configure.
  JIRA_FIELD_BILLABLE: z.string().optional(),
  JIRA_FIELD_BASELINE_ESTIMATE: z.string().optional(),
  JIRA_FIELD_CURRENT_ESTIMATE: z.string().optional(),

  // A full working day, the denominator for utilisation.
  WORKING_DAY_HOURS: z.coerce.number().positive().default(7.5),

  // Bearer token the sync trigger endpoint requires. The endpoint is inert
  // (503) until it is set, exactly like the retention job.
  JIRA_SYNC_SECRET: z.string().min(16).optional(),

  // Master switch. While "false" (default) the sync runs read-only against
  // Jira and reports what it WOULD write, changing nothing in the read model.
  // Deploying therefore never starts rewriting the read model on its own.
  JIRA_SYNC_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  // How far back to re-read on every run, to cover clock skew between this
  // app and Jira. Overlap is free because worklog_fact is keyed on Jira's
  // worklog id; a gap loses billable time silently. Err upward.
  JIRA_SYNC_OVERLAP_MINUTES: z.coerce.number().int().nonnegative().default(10),

  // Where a first-ever run starts from, 'YYYY-MM-DD'. Only used when no
  // watermark exists yet.
  JIRA_SYNC_START_DATE: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "JIRA_SYNC_START_DATE must be YYYY-MM-DD")
    .optional(),

  // The first day this organisation kept time in Jira, 'YYYY-MM-DD'.
  //
  // A DISPLAY AND MEASUREMENT floor, which is why it is not the same setting
  // as JIRA_SYNC_START_DATE above. That one decides what the sync FETCHES;
  // this decides what the screens SHOW and, more importantly, what utilisation
  // is measured against. Before this date the app holds no worklogs, and
  // counting contracted hours for days it never covered reports a shortfall
  // that never happened.
  //
  // Unset means no floor, which is the right default for the base repo: a
  // fresh project has no such date and inventing one would hide real data.
  // Falls back to JIRA_SYNC_START_DATE so one value can drive both.
  TIMESHEET_HISTORY_START: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "TIMESHEET_HISTORY_START must be YYYY-MM-DD")
    .optional(),

  // Activity/audit log retention. The monthly job deletes audit_logs older than
  // this many days. Defaults to 180. Set to 0 to disable purging (keep forever).
  // Unlike the de-identification switch this defaults ON, because it is routine
  // log rotation rather than an irreversible scrub of personal data.
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(180),

  // -------------------------------------------------------------------
  // AI chat (Amazon Bedrock)
  //
  // An Amazon Bedrock API key - a BEARER TOKEN, not an access-key/secret
  // pair. @aws-sdk/client-bedrock-runtime reads this exact variable name
  // itself (fromEnvSigningName with signingName "bedrock" computes
  // AWS_BEARER_TOKEN_BEDROCK), so the name is fixed by the SDK and cannot
  // be renamed. Optional: with it unset the chat routes answer 503 and the
  // rest of the app runs normally.
  //
  // Bedrock API keys EXPIRE and can be revoked from the console. Treat a
  // sudden run of AccessDenied errors as a rotated or revoked key rather
  // than a code fault. The region and model are pinned in
  // src/lib/ai/bedrock-client.ts and are deliberately NOT configurable -
  // see the data-residency note there.
  // -------------------------------------------------------------------
  AWS_BEARER_TOKEN_BEDROCK: z.string().min(1).optional(),

  // AI chat retention. The monthly job deletes conversations with no
  // activity for this many days, and their messages cascade. Defaults to
  // 365. Set to 0 to keep chat history indefinitely.
  //
  // Chat transcripts are user-authored content that can contain anything a
  // person chose to paste in, so unlike the audit log there is no
  // compliance reason to keep them - a bounded window is the safer default.
  AI_CHAT_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(365),

  // Request-log retention. The monthly job deletes ai_chat_request_logs rows
  // older than this. Defaults to 30 - deliberately much shorter than the chat
  // window, for two reasons: the table duplicates private conversation content
  // that admins can read, and every send logs the WHOLE thread, so its size
  // grows with the square of thread length. Set to 0 to keep the log forever,
  // and watch the table if you do.
  AI_CHAT_LOG_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(30),

  // How long a file that was uploaded but never sent is kept, in HOURS.
  // Somebody attached something and closed the tab: the row is owned and
  // private, but nothing else will ever collect it - the message and
  // conversation cascades only reach attachments that have a message.
  //
  // Hours rather than days because there is nothing to preserve here. The
  // default is generous enough to survive an interrupted session picked up
  // the next morning, and short enough that abandoned uploads do not
  // accumulate as bytes nobody will read. Set to 0 to keep them forever,
  // which is only sensible while debugging.
  AI_CHAT_STAGED_ATTACHMENT_HOURS: z.coerce.number().int().nonnegative().default(24),

  // -------------------------------------------------------------------
  // Attachment storage (Azure Blob)
  //
  // Where chat attachment BYTES live. Optional: with it unset the chat
  // still works and the composer simply does not offer the paperclip,
  // rather than accepting a file it has nowhere to put.
  //
  // The container is created on first use and is PRIVATE. Never enable
  // anonymous read on it - the access check that protects these files is
  // in the download route, and a public container routes around it.
  //
  // Locally this points at Azurite, whose connection string is a
  // well-known constant with a published key; that is fine because it is
  // an emulator on localhost, and it must never appear in a real
  // environment. See docs/setup.md.
  // -------------------------------------------------------------------
  AZURE_STORAGE_CONNECTION_STRING: z.string().min(1).optional(),
  AZURE_STORAGE_ATTACHMENT_CONTAINER: z.string().min(3).max(63).default("ai-chat-attachments"),

  // Container for meeting recordings and uploaded media. Separate from the
  // attachment container so the two can have different lifecycle rules -
  // recordings are large and comparatively few, attachments are small and
  // many.
  AZURE_MEDIA_CONTAINER: z.string().min(3).max(63).default("transcription-media"),

  // -------------------------------------------------------------------
  // Azure AI Speech (meeting transcription)
  //
  // Optional. Unset means the Transcription screen explains it is not
  // configured rather than offering a recorder that cannot transcribe.
  //
  // The REGION is part of the endpoint hostname, so it must match the
  // Speech resource exactly - "australiaeast", not "Australia East".
  // Keep it in an Australian region: an audio recording of a meeting is
  // considerably more sensitive than most of what this app holds, and the
  // residency argument that pinned Bedrock to Australia applies here with
  // more force, not less.
  // -------------------------------------------------------------------
  // -----------------------------------------------------------------
  // Web Push
  //
  // The private half of the VAPID pair whose public half is
  // NEXT_PUBLIC_VAPID_PUBLIC_KEY. Generate the pair ONCE with
  // `npx web-push generate-vapid-keys` and keep it: changing it invalidates
  // every existing subscription, and every device has to be turned on again
  // by hand because nothing can notify them to do so.
  //
  // VAPID_SUBJECT identifies the sender to the push service so it has
  // somebody to contact about a misbehaving one. A mailto: or https: URL.
  // -----------------------------------------------------------------
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().min(1).default("mailto:support@example.com"),

  // Bearer token the background transcription sweep requires. The endpoint
  // is inert (503) until it is set, exactly like the retention job.
  TRANSCRIPTION_SWEEP_SECRET: z.string().min(16).optional(),

  AZURE_SPEECH_KEY: z.string().min(1).optional(),
  AZURE_SPEECH_REGION: z.string().min(1).optional(),

  // The language spoken in recordings. Azure needs a specific locale, not
  // a language - "en-AU" transcribes Australian English noticeably better
  // than "en-US" on local place names and accents.
  AZURE_SPEECH_LOCALE: z.string().min(2).default("en-AU"),

  // How long a transcription and its media are kept, in days. Recordings
  // of meetings are the most sensitive thing this app stores, and they are
  // large - so the default window is deliberately shorter than chat.
  // Set to 0 to keep them indefinitely.
  TRANSCRIPTION_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(90),

  // -------------------------------------------------------------------
  // SharePoint inventory
  // -------------------------------------------------------------------

  // Bearer token the crawl sweep requires. The endpoint is inert (503)
  // until it is set, and a crawl cannot finish without it - queueing one
  // from the admin screen only writes a row. Inert by default on purpose:
  // deploying this must not start reading somebody's document library.
  SHAREPOINT_SWEEP_SECRET: z.string().min(16).optional(),

  // How long a record of a crawl RUN is kept, in days. Not the inventory
  // itself: that lives as long as the library stays nominated, because a
  // path is only disclosive while it describes something real and ageing
  // live rows out would just force a re-crawl to rebuild the same data.
  // De-nominating a library is what removes its contents.
  // Set to 0 to keep crawl records indefinitely.
  SHAREPOINT_INVENTORY_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(180),

  // -------------------------------------------------------------------
  // Microsoft sign-in (Entra ID)
  //
  // Optional to the schema, but in a real deployment it is the ONLY way in:
  // with these unset the "Continue with Microsoft" button does not render
  // and, unless DEV_PASSWORD_SIGN_IN is on below, the sign-in page has
  // nothing on it. That is a misconfiguration, not a supported mode.
  //
  // TENANT_ID should be the organisation's own tenant GUID, never
  // "common" - "common" lets ANY Microsoft account in the world reach the
  // callback, leaving the domain allowlist below as the only thing
  // standing between a personal outlook.com account and your app.
  // -------------------------------------------------------------------
  MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
  MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
  MICROSOFT_TENANT_ID: z.string().min(1).optional(),

  // -------------------------------------------------------------------
  // Password sign-in, for LOCAL DEVELOPMENT ONLY.
  //
  // Microsoft is the single front door in any real environment. This opens
  // a second one so the app can be run locally without an Entra app
  // registration - useful before one exists, and for working offline.
  //
  // TWO conditions are required and this variable is only one of them: see
  // isPasswordSignInEnabled in account-creation-policy.ts, which also
  // requires MODE to not be production. A variable copied into a
  // production environment by accident must not be able to open a password
  // door, so neither check is sufficient alone.
  //
  // What it opens is a real password door, not a mock: accounts are created
  // by scripts/create-dev-user.mjs, and the domain allowlist, the
  // deactivated-account check and the audit log all still apply.
  // -------------------------------------------------------------------
  DEV_PASSWORD_SIGN_IN: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  // -------------------------------------------------------------------
  // App-level two-factor authentication.
  //
  // OFF by default, and that default is load-bearing: turning this on
  // requires every user to enrol an authenticator before they can reach any
  // part of the app, so deploying must never do it on its own. Set it
  // deliberately, once people have been told.
  //
  // WHAT IT IS FOR. Entra owns credentials, and enforcing MFA there needs a
  // Conditional Access policy, which needs an Entra ID P1 licence per user.
  // This is the alternative for a tenant on the free tier: a second factor
  // on THIS APP, checked after Microsoft has proved who somebody is.
  //
  // WHAT IT IS NOT. It does not make the tenant two-factor. A stolen
  // password still reaches everything else the person can sign in to -
  // email, Teams, SharePoint - because the identity itself is unchanged.
  // What it protects is the data in here: chat transcripts, meeting
  // recordings, uploaded files. Do not describe it internally as "we have
  // MFA"; it is "the portal requires a second factor", and the difference
  // matters the day somebody asks a compliance question.
  //
  // If the organisation later buys P1, this should come OFF and a
  // Conditional Access policy replace it - two prompts for the same thing
  // trains people to click through both.
  // -------------------------------------------------------------------
  APP_TWO_FACTOR_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  // -------------------------------------------------------------------
  // Email domain allowlist
  //
  // Comma-separated bare domains, e.g. "example.com,example.org". An
  // account can only be CREATED with an address on this list, whichever
  // sign-in method created it.
  //
  // Deliberately configurable rather than hardcoded: this is a reusable
  // base, and a company's domain is exactly the kind of thing that must
  // not be baked into it. Unset means no restriction, which is the right
  // default for a base but almost never right for a deployment - set it.
  // -------------------------------------------------------------------
  AUTH_ALLOWED_EMAIL_DOMAINS: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? "")
        .split(",")
        .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean),
    ),
});

export const envServer = serverEnvSchema.parse({
  MODE: process.env.MODE,

  // DATABASE_USER: process.env.DATABASE_USER,
  // DATABASE_PASSWORD: process.env.DATABASE_PASSWORD,
  // DATABASE_NAME: process.env.DATABASE_NAME,
  // DATABASE_HOST: process.env.DATABASE_HOST,
  // DATABASE_PORT: process.env.DATABASE_PORT,
  DATABASE_URL: process.env.DATABASE_URL,

  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,

  FIELD_ENCRYPTION_KEY: process.env.FIELD_ENCRYPTION_KEY,

  EMAIL_FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS,
  EMAIL_AZURE_ENDPOINT: process.env.EMAIL_AZURE_ENDPOINT,
  EMAIL_AZURE_ACCESS_KEY: process.env.EMAIL_AZURE_ACCESS_KEY,
  EMAIL_SEND_ENABLED: process.env.EMAIL_SEND_ENABLED,

  RETENTION_JOB_SECRET: process.env.RETENTION_JOB_SECRET,
  RETENTION_JOB_ENABLED: process.env.RETENTION_JOB_ENABLED,

  AUDIT_LOG_RETENTION_DAYS: process.env.AUDIT_LOG_RETENTION_DAYS,

  AWS_BEARER_TOKEN_BEDROCK: process.env.AWS_BEARER_TOKEN_BEDROCK,
  AI_CHAT_RETENTION_DAYS: process.env.AI_CHAT_RETENTION_DAYS,
  AI_CHAT_LOG_RETENTION_DAYS: process.env.AI_CHAT_LOG_RETENTION_DAYS,
  AI_CHAT_STAGED_ATTACHMENT_HOURS: process.env.AI_CHAT_STAGED_ATTACHMENT_HOURS,

  AZURE_STORAGE_CONNECTION_STRING: process.env.AZURE_STORAGE_CONNECTION_STRING,
  AZURE_STORAGE_ATTACHMENT_CONTAINER: process.env.AZURE_STORAGE_ATTACHMENT_CONTAINER,
  AZURE_MEDIA_CONTAINER: process.env.AZURE_MEDIA_CONTAINER,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  TRANSCRIPTION_SWEEP_SECRET: process.env.TRANSCRIPTION_SWEEP_SECRET,
  AZURE_SPEECH_KEY: process.env.AZURE_SPEECH_KEY,
  AZURE_SPEECH_REGION: process.env.AZURE_SPEECH_REGION,
  AZURE_SPEECH_LOCALE: process.env.AZURE_SPEECH_LOCALE,
  TRANSCRIPTION_RETENTION_DAYS: process.env.TRANSCRIPTION_RETENTION_DAYS,
  SHAREPOINT_SWEEP_SECRET: process.env.SHAREPOINT_SWEEP_SECRET,
  SHAREPOINT_INVENTORY_RETENTION_DAYS: process.env.SHAREPOINT_INVENTORY_RETENTION_DAYS,

  MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
  MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
  MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID,
  DEV_PASSWORD_SIGN_IN: process.env.DEV_PASSWORD_SIGN_IN,
  APP_TWO_FACTOR_ENABLED: process.env.APP_TWO_FACTOR_ENABLED,
  AUTH_ALLOWED_EMAIL_DOMAINS: process.env.AUTH_ALLOWED_EMAIL_DOMAINS,
  // Every key the schema declares must be listed here too. Zod only ever sees
  // this object, so a variable declared above and omitted below is silently
  // undefined at runtime - which for an optional() field means no error and no
  // clue, just a feature that reports itself unconfigured forever.
  JIRA_BASE_URL: process.env.JIRA_BASE_URL,
  JIRA_EMAIL: process.env.JIRA_EMAIL,
  JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,

  JIRA_FIELD_BILLABLE: process.env.JIRA_FIELD_BILLABLE,
  JIRA_FIELD_BASELINE_ESTIMATE: process.env.JIRA_FIELD_BASELINE_ESTIMATE,
  JIRA_FIELD_CURRENT_ESTIMATE: process.env.JIRA_FIELD_CURRENT_ESTIMATE,

  WORKING_DAY_HOURS: process.env.WORKING_DAY_HOURS,

  JIRA_SYNC_SECRET: process.env.JIRA_SYNC_SECRET,
  JIRA_SYNC_ENABLED: process.env.JIRA_SYNC_ENABLED,
  JIRA_SYNC_OVERLAP_MINUTES: process.env.JIRA_SYNC_OVERLAP_MINUTES,
  JIRA_SYNC_START_DATE: process.env.JIRA_SYNC_START_DATE,
  TIMESHEET_HISTORY_START: process.env.TIMESHEET_HISTORY_START,
});
