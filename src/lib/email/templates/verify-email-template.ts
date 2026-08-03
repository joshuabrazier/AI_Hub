import { BRAND } from "@/lib/brand";
import { renderEmailLayout, EMAIL_ACCENT } from "./email-layout";

type VerifyEmailParams = {
  verifyUrl: string;
  recipientEmail?: string;
};

// -------------------------------------------------------------------
// Verify email template
// -------------------------------------------------------------------
export function VerifyEmailTemplate({ verifyUrl, recipientEmail }: VerifyEmailParams) {
  return renderEmailLayout({
    preheader: `Confirm your email for ${BRAND.name}`,
    accent: EMAIL_ACCENT,
    heading: "Confirm your email address",
    intro:
      `Please confirm this email address to keep your ${BRAND.name} account secure and up to date.`,
    info: recipientEmail ? [{ label: "Email address", value: recipientEmail }] : undefined,
    button: { label: "Verify email", url: verifyUrl },
    note: "If you didn't request this, you can safely ignore this email.",
  });
}
