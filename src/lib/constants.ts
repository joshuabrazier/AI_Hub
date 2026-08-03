import { envClient } from "./env-client";

export const SITE_MODES = {
  DEVELOPMENT: "development",
  TEST: "test",
  PRODUCTION: "production",
};

// -------------------------------------------------------------------
// User-facing messages.
//
// One place for the copy that toasts and form errors show, so the same action
// is described the same way everywhere. Keep them in the interface's voice:
// say what happened, in the same words as the control that caused it.
// -------------------------------------------------------------------
export const MESSAGES = {
  SOMETHING_WENT_WRONG: "Something went wrong. Please try again later.",
  INVALID_SIGN_IN_CREDENTIALS: "Only verified accounts can sign in.",
  INVALID_CREDENTIALS: "Invalid credentials",
  EMAIL_NOT_VERIFIED: "Email not verified",
  UNAUTHORIZED: "Unauthorized",
  SIGN_IN_SUCCESSFULL: "Signed in",

  USER_CREATED: "User created",
  USER_UPDATED: "User updated",
  USER_INVITATION_SENT: "Invite sent",
  USER_INVITATION_CANCELLED: "Invite cancelled",

  TEAM_CREATED: "Team created",
  TEAM_UPDATED: "Team updated",
  TEAM_MEMBER_ADDED: "Member added",
  TEAM_MEMBER_UPDATED: "Member updated",
  TEAM_MEMBER_REMOVED: "Member removed",

  PROGRAM_CREATED: "Program created",
  PROGRAM_UPDATED: "Program updated",
  LOCATION_CREATED: "Location created",
  LOCATION_UPDATED: "Location updated",
  CLASS_CREATED: "Class created",
  CLASS_UPDATED: "Class updated",
  SESSION_UPDATED: "Session updated",
  BOOKING_CANCELLED: "Booking cancelled",
  CLOSURE_DAY_CREATED: "Closure day added",
  CLOSURE_DAY_UPDATED: "Closure day updated",

  NOTIFICATION_SENT: "Notification sent",
  DOCUMENT_SIGNED: "Document signed",
  CONTENT_SAVED: "Content saved",

  PASSWORD_RESET_LINK_SENT: "If an account exists for that email, a reset link has been sent.",
  PASSWORD_RESET_SUCCESSFULL: "Password reset",
  PASSWORD_CHANGED_SUCCESSFULL: "Password changed",
  CURRENT_PASSWORD_INCORRECT: "Your current password is incorrect",
  CHANGE_EMAIL_VERIFICATION_SENT: "Check your new email to confirm the change.",
  EMAIL_CHANGED_SIGN_IN_AGAIN: "Your email has been changed. Please sign in with your new email address.",
};

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

export const TABLE_ID_LENGTH = 32;

export const BETTER_AUTH_SIGN_IN_DISABLED_ERROR_CODE = "signup_disabled";

export const PASSWORD_MIN_LENGTH = envClient.NEXT_PUBLIC_PASSWORD_MIN_LENGTH;
export const PASSWORD_MAX_LENGTH = envClient.NEXT_PUBLIC_PASSWORD_MAX_LENGTH;
export const PASSWORD_INVALID_MESSAGE =
  "Password must be between " + PASSWORD_MIN_LENGTH + " and " + PASSWORD_MAX_LENGTH + " characters long";

export const INVITE_EXPIRY_DAYS = 14;
