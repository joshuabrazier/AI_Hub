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
  // (e.g. signatures). Generate with: openssl rand -base64 32
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

  // Data-retention monthly job (see docs/data-retention.md).
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

  // Activity/audit log retention. The monthly job deletes audit_logs older than
  // this many days. Defaults to 180. Set to 0 to disable purging (keep forever).
  // Unlike the de-identification switch this defaults ON, because it is routine
  // log rotation rather than an irreversible scrub of personal data.
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(180),
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
});
