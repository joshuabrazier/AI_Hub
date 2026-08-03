// -------------------------------------------------------------------
// System notification templates
// These back built-in features (birthday wishes, enrolment reminders, the
// "taking a break" email). They live in notification_templates with fixed ids
// and is_system = true, so they're looked up by id (not by their editable name)
// and can't be deleted.
// -------------------------------------------------------------------
export const SYSTEM_TEMPLATE_IDS = {
  BIRTHDAY: "sys-birthday",
  ENROLMENT_REMINDER: "sys-enrolment-reminder",
  TAKING_A_BREAK: "sys-taking-a-break",
  CONTINUING: "sys-continuing",
  WANT_CHANGES: "sys-want-changes",
  CHANGES_RESOLVED: "sys-changes-resolved",
} as const;

export type SystemTemplateId = (typeof SYSTEM_TEMPLATE_IDS)[keyof typeof SYSTEM_TEMPLATE_IDS];
