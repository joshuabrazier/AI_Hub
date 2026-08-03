import { BRAND } from "@/lib/brand";
import { renderEmailLayout } from "./email-layout";

// -------------------------------------------------------------------
// Email change notification template - sent to the OLD address so an
// email change can't happen silently on the account
// -------------------------------------------------------------------
export function EmailChangeNotificationEmailTemplate(newEmail: string) {
  return renderEmailLayout({
    preheader: `Your ${BRAND.name} account email is being changed`,
    accent: "#dc2626",
    heading: "Email change requested",
    intro:
      `We received a request to change the email address on your ${BRAND.name} account. To finish the change, follow the confirmation link we sent to the new address.`,
    info: [{ label: "New email", value: newEmail }],
    note: "If you didn't request this, please change your password immediately and contact us - your account may be at risk.",
  });
}
