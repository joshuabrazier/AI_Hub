import { AdminUserInvitationEmailTemplate } from "@/lib/email/templates/admin-user-invitation-email-template";
import { EmailChangeNotificationEmailTemplate } from "@/lib/email/templates/email-change-notification-email-template";
import { EnquiryEmailTemplate } from "@/lib/email/templates/enquiry-email-template";
import { PasswordResetEmailTemplate } from "@/lib/email/templates/password-reset-email-template";
import { TwoFactorOtpEmailTemplate } from "@/lib/email/templates/two-factor-otp-email-template";
import { VerifyEmailTemplate } from "@/lib/email/templates/verify-email-template";

// A single email in the preview gallery: what it is, who gets it, when it's
// sent, its subject line, and the fully rendered HTML (built from the real
// template with placeholder sample data).
export type EmailPreview = {
  key: string;
  name: string;
  audience: string;
  trigger: string;
  subject: string;
  html: string;
};

// Placeholder links and data used purely to render the previews. Nothing here
// touches a real account, and none of it leaves this page.
const SAMPLE = {
  inviteUrl: "https://portal.example/accept-invite/sample-token",
  resetUrl: "https://portal.example/reset-password?token=sample-token",
  verifyUrl: "https://portal.example/verify-email?token=sample-token",
  portalUrl: "https://portal.example/portal",
};

// -------------------------------------------------------------------
// Build every email preview from its real template, so this gallery always
// reflects exactly what the templates produce.
//
// One entry per template the app actually sends. Adding a template without
// adding it here leaves an email nobody can review before it goes out, so
// keep the two in step.
// -------------------------------------------------------------------
export function buildEmailPreviews(): EmailPreview[] {
  return [
    {
      key: "invitation",
      name: "Invitation",
      audience: "Anyone being invited to the product",
      trigger: "When an admin invites somebody from the Users screen. Sign-up is invite-only, so every account starts here.",
      subject: "You have been invited",
      html: AdminUserInvitationEmailTemplate({
        inviteUrl: SAMPLE.inviteUrl,
        recipientName: "Jordan Lee",
        inviterName: "Alex Chen",
        role: "Manager",
        expiryDays: 14,
      }),
    },
    {
      key: "password-reset",
      name: "Password reset",
      audience: "Any account holder",
      trigger: "When somebody requests a password reset from the sign-in page.",
      subject: "Reset your password",
      html: PasswordResetEmailTemplate({
        resetUrl: SAMPLE.resetUrl,
        recipientEmail: "jordan.lee@example.com",
      }),
    },
    {
      key: "two-factor-otp",
      name: "Sign-in code",
      audience: "An account holder signing in",
      trigger: "When somebody chooses to receive their second-step code by email instead of the authenticator app.",
      subject: "Your sign-in code",
      html: TwoFactorOtpEmailTemplate({
        otp: "123456",
        validMinutes: 5,
        recipientEmail: "jordan.lee@example.com",
      }),
    },
    {
      key: "verify-email",
      name: "Verify email address",
      audience: "An account holder's new email address",
      trigger: "When somebody changes the email on their account, sent to the new address to confirm it.",
      subject: "Verify your email",
      html: VerifyEmailTemplate({
        verifyUrl: SAMPLE.verifyUrl,
        recipientEmail: "new.address@example.com",
      }),
    },
    {
      key: "email-change-alert",
      name: "Email change alert",
      audience: "The account's current (old) email address",
      trigger: "When an email change is requested, sent to the old address as a security heads-up.",
      subject: "Your account email is being changed",
      html: EmailChangeNotificationEmailTemplate("new.address@example.com"),
    },
    {
      key: "new-enquiry",
      name: "New enquiry",
      audience: "Admins and the shared contact inbox",
      trigger: "When a visitor submits the enquiry form on the public contact page.",
      subject: "New enquiry from Jamie Rivera",
      html: EnquiryEmailTemplate({
        name: "Jamie Rivera",
        phone: "0400 123 456",
        email: "jamie.rivera@example.com",
        categoryLabel: "General enquiry",
        preferredDays: ["Monday", "Wednesday", "Saturday"],
        message:
          "Hi! I'd like to know what's available for a beginner. Mornings suit us best, but we're flexible.",
      }),
    },
  ];
}
