// -------------------------------------------------------------------
// App settings keys + defaults
// Keys for the generic app_settings key/value table, and the code-level
// defaults used when a key hasn't been set. Kept here so readers and the admin
// editor share one source of truth.
// -------------------------------------------------------------------
export const APP_SETTING_KEYS = {
  // Week of the current term at which each enrolment reminder starts.
  ENROLMENT_TRANSFER_WEEK: "enrolment_transfer_week",
  ENROLMENT_OPEN_WEEK: "enrolment_open_week",
} as const;

export type AppSettingKey = (typeof APP_SETTING_KEYS)[keyof typeof APP_SETTING_KEYS];

export const DEFAULT_ENROLMENT_TRANSFER_WEEK = 4;
export const DEFAULT_ENROLMENT_OPEN_WEEK = 5;
