import { BRAND } from "@/lib/brand";
import { renderEmailLayout, EMAIL_ACCENT } from "./email-layout";

type PasswordResetEmailParams = {
  resetUrl: string;
  recipientEmail?: string;
};

// -------------------------------------------------------------------
// Password reset email template
// -------------------------------------------------------------------
export function PasswordResetEmailTemplate({ resetUrl, recipientEmail }: PasswordResetEmailParams) {
  return renderEmailLayout({
    preheader: `Reset your ${BRAND.name} password`,
    accent: EMAIL_ACCENT,
    heading: "Reset your password",
    intro:
      `We received a request to reset the password for your ${BRAND.name} account. Click the button below to choose a new one.`,
    info: recipientEmail ? [{ label: "Account", value: recipientEmail }] : undefined,
    button: { label: "Reset your password", url: resetUrl },
    note: "If you didn't request this, you can safely ignore this email - your password won't be changed.",
  });
}
